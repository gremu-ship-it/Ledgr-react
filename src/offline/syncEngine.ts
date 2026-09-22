import { repos } from '@/lib/repositories';
import { retryNonCritical } from '@/lib/nonCriticalRetry';
import { usageService } from '@/lib/billing/UsageService';

import {
  createInvoiceJournalEntry,
  createInvoiceReceivableEntry,
  createExpenseJournalEntry,
  createInvoiceSettlementEntry,
  createExpenseSettlementEntry,
} from '@/services/journalService';
import {
  deductStockAndPostCogs,
  resolveExpenseLineAccountId,
} from '@/services/inventoryJournalService';
import {
  saveQuickExpenseViaRpc,
  saveQuickSaleViaRpc,
  isMissingFunctionError,
  newSaveClientKey,
  type QuickExpenseRpcPayload,
  type QuickSaleRpcPayload,
} from '@/services/quickSaveService';
import { commitPosSaleDocuments } from '@/services/posService';
import { createLogger } from '@/lib/logger';
import { recoverStaleSyncClaims } from './queueApi';
import { offlineDB, type QueueItem } from './db';
import { useAppStore } from '@/store/useAppStore';
import { sweepUnverifiableItems, replayViolation } from './provenance';
import { claimLease, releaseLease, verifyLeaseOwnership } from './lease';
import { getLeaseClaimantId } from './deviceIdentity';
import { isQuotaDenial, QUOTA_DENIAL_SQLSTATE } from '@/lib/billing/quotaContract';
import type {
  IncomeQueuePayload,
  InvoiceQueuePayload,
  ExpenseQueuePayload,
  InvoicePaymentQueuePayload,
  ExpensePaymentQueuePayload,
  PayrollRunQueuePayload,
  StockMovementQueuePayload,
  PosSaleQueuePayload,
} from './payloads';

const log = createLogger('SyncEngine');

export interface SyncProgress {
  total: number;
  completed: number;
  failed: number;
  current?: string;
  /** R09.2: items skipped because this pass could not verify the self actor,
   *  or another tab owns the replay lease. Not failed — retriable next pass. */
  skipped?: number;
}

export interface SyncQueueOptions {
  /**
   * R09.2 actor binding: the authenticated actor for THIS pass. Defaults to
   * the hydrated app session user (never a network lookup — the sync engine
   * runs offline-tolerant and the identity that matters is the app session
   * whose token the repository layer will send).
   */
  currentUserId?: string | null;
}

export type SyncProgressListener = (progress: SyncProgress) => void;

function resolveForeignKey(item: QueueItem, parentServerId: string): void {
  if (!item.dependentFkField) return;
  const payload = item.payload as unknown as Record<string, unknown>;

  for (const key of Object.keys(payload)) {
    const inner = payload[key];
    if (inner && typeof inner === 'object' && item.dependentFkField in inner) {
      (inner as Record<string, unknown>)[item.dependentFkField] = parentServerId;
    }
  }
}

async function syncItem(item: QueueItem): Promise<string> {
  switch (item.operationType) {
    case 'income':
    case 'invoice': {
      const { invoice, lines } = item.payload as IncomeQueuePayload | InvoiceQueuePayload;
      const baseInvoice = { ...invoice };

      // ── FAST PATH: atomic RPC for quick income (plain paid invoice) ────
      // Same guarantees as the online quick entry: one round trip, all-or-
      // nothing, idempotent on the queue item's client_key. The RPC reserves
      // the real document number itself, so this must run BEFORE the legacy
      // reservation below (otherwise each sync burns two numbers).
      // Discounts, VAT or builder-style drafts fall back to the legacy path.
      if (item.operationType === 'income') {
        const inv = baseInvoice as unknown as Record<string, unknown>;
        const vatAmount = Number(inv.vat_amount ?? 0);
        const discountAmount = Number(inv.discount_amount ?? 0);
        const needsContact =
          !inv.contact_id || inv.contact_id === 'offline_walk_in_customer';
        const isOfflineNumbered =
          typeof inv.invoice_number === 'string' && inv.invoice_number.startsWith('INV-OFFLINE-');
        if (vatAmount <= 0.005 && discountAmount <= 0.005 && inv.status === 'paid') {
          try {
            let nextInvoice = baseInvoice;
            if (needsContact) {
              const walkIn = await repos.contact.findDefaultSaleContact(item.businessId);
              if (!walkIn) {
                throw new Error(
                  'No customer contacts found. Please add a "Walk-in Customer" contact first.',
                );
              }
              nextInvoice = { ...nextInvoice, contact_id: walkIn.id };
            }
            // Strip the offline placeholder — the RPC reserves the real one.
            if (isOfflineNumbered) {
              const { invoice_number: _drop, ...rest } = nextInvoice as Record<string, unknown>;
              void _drop;
              nextInvoice = rest as typeof nextInvoice;
            }
            const rpcLines = (lines as unknown as Record<string, unknown>[]).map((l) => {
              const { line_id: _localId, ...rest } = l as Record<string, unknown>;
              void _localId;
              return rest;
            });
            const stockLines = rpcLines
              .filter((l) => l.product_id && Number(l.quantity) > 0)
              .map((l) => ({
                product_id: l.product_id as string,
                quantity: Number(l.quantity),
              }));
            const rpcResult = await saveQuickSaleViaRpc({
              business_id: item.businessId,
              client_key: item.clientKey ?? newSaveClientKey(),
              invoice: nextInvoice as unknown as Record<string, unknown>,
              lines: rpcLines,
              subtotal: Number((nextInvoice as unknown as Record<string, unknown>).subtotal),
              vat_amount: 0,
              stock_lines: stockLines,
            } satisfies QuickSaleRpcPayload);
            return rpcResult.id;
          } catch (rpcErr) {
            if (!isMissingFunctionError(rpcErr)) {
              // Atomic failure — nothing was committed; the item stays
              // queued and the client_key makes the retry idempotent.
              throw rpcErr;
            }
            log.info('save_quick_sale unavailable — legacy income sync');
          }
        }
      }

      let nextInvoice = baseInvoice;
      if (nextInvoice.invoice_number && nextInvoice.invoice_number.startsWith('INV-OFFLINE-')) {
        const realNumber = await repos.business.reserveNextInvoiceNumber(item.businessId);
        nextInvoice = { ...nextInvoice, invoice_number: realNumber };
      }
      if (!nextInvoice.contact_id || nextInvoice.contact_id === 'offline_walk_in_customer') {
        const walkIn = await repos.contact.findDefaultSaleContact(item.businessId);
        if (walkIn) {
          nextInvoice = { ...nextInvoice, contact_id: walkIn.id };
        }
      }
      // Plan limit, checked before the document is written and skipped for a
      // replay of a document already committed under this client key.
      await usageService.assertCanCreateDocument(item.businessId, item.clientKey);

      const result = await repos.invoice.createWithLines(nextInvoice, lines, item.clientKey);
      await retryNonCritical(async () => {
        if (item.operationType === 'income') {
          await createInvoiceJournalEntry(
            item.businessId,
            result.invoice,
            Number(result.invoice.subtotal),
            Number(result.invoice.vat_amount),
            result.invoice.branch_id,
            result.invoice.department_id,
          );
        } else {
          await createInvoiceReceivableEntry(
            item.businessId,
            result.invoice,
            result.invoice.branch_id,
            result.invoice.department_id,
          );
        }
      }, { module: 'SyncEngine', operation: 'invoice_journal_entry', businessId: item.businessId });

      // PERPETUAL INVENTORY: an offline sale still has to release stock and
      // its cost. Done here rather than at enqueue time because the average
      // cost must be read against live server balances — the device may have
      // been offline for days and other tills may have moved the same stock.
      await retryNonCritical(async () => {
        const productLines = result.lines
          .filter((l) => l.product_id)
          .map((l) => ({ productId: l.product_id as string, quantity: Number(l.quantity) }));
        if (productLines.length > 0) {
          await deductStockAndPostCogs(
            item.businessId,
            result.invoice,
            productLines,
            result.invoice.branch_id,
            result.invoice.department_id,
            null,
          );
        }
      }, { module: 'SyncEngine', operation: 'stock_cogs_posting', businessId: item.businessId });

      return result.invoice.id;
    }

    case 'expense': {
      const { expense, lines } = item.payload as ExpenseQueuePayload;
      const baseExpense = { ...expense };

      // ── FAST PATH: atomic RPC — one round trip for document + journal +
      // stock movements (the legacy path below never recorded stock for
      // offline expenses; the RPC does, so offline and online converge).
      // The RPC reserves the real document number itself, so this runs
      // BEFORE the legacy reservation to avoid burning two numbers.
      {
        const exp = baseExpense as unknown as Record<string, unknown>;
        const isOfflineNumbered =
          typeof exp.expense_number === 'string' && exp.expense_number.startsWith('EXP-OFFLINE-');
        try {
          let nextExpense = baseExpense;
          if (isOfflineNumbered) {
            const { expense_number: _drop, ...rest } = nextExpense as Record<string, unknown>;
            void _drop;
            nextExpense = rest as typeof nextExpense;
          }
          const allocations = (lines as unknown as Record<string, unknown>[]).map((l) => ({
            account_id: l.account_id as string,
            amount: Number(
              (l as { line_subtotal?: number }).line_subtotal ??
                (Number(l.line_total) - Number((l as { tax_amount?: number }).tax_amount ?? 0)),
            ),
            description: (l.description as string) || '',
          }));
          const stockLines = (lines as unknown as Record<string, unknown>[])
            .filter((l) => l.product_id && Number(l.quantity) > 0)
            .map((l) => ({
              product_id: l.product_id as string,
              quantity: Number(l.quantity),
              unit_cost: Number(l.unit_price ?? 0),
            }));
          const rpcResult = await saveQuickExpenseViaRpc({
            business_id: item.businessId,
            client_key: item.clientKey ?? newSaveClientKey(),
            expense: nextExpense as unknown as Record<string, unknown>,
            lines: lines as unknown as Record<string, unknown>[],
            allocations,
            vat_amount: Number(exp.vat_amount ?? 0),
            stock_lines: stockLines,
          } satisfies QuickExpenseRpcPayload);
          return rpcResult.id;
        } catch (rpcErr) {
          if (!isMissingFunctionError(rpcErr)) {
            // Atomic failure — nothing was committed; the item stays queued
            // and the client_key makes the retry idempotent.
            throw rpcErr;
          }
          log.info('save_quick_expense unavailable — legacy expense sync');
        }
      }

      let nextExpense = baseExpense;
      if (nextExpense.expense_number && nextExpense.expense_number.startsWith('EXP-OFFLINE-')) {
        const realNumber = await repos.business.reserveNextExpenseNumber(item.businessId);
        nextExpense = { ...nextExpense, expense_number: realNumber };
      }
      await usageService.assertCanCreateDocument(item.businessId, item.clientKey, 'expense');

      const result = await repos.expense.createWithLines(nextExpense, lines, item.clientKey);

      // PERPETUAL INVENTORY: the queued line carries whatever account the
      // form picked while offline, where the products table wasn't
      // available to consult. Re-resolve against the server now so an
      // inventory-tracked purchase capitalises to the asset account rather
      // than being expensed — and correct the stored line to match, so the
      // expense document and the ledger tell the same story.
      await retryNonCritical(async () => {
        const products = await repos.inventory.findAllProducts(item.businessId);
        for (const line of result.lines) {
          if (!line.product_id || !line.account_id) continue;
          const product = products.find((p) => p.id === line.product_id) ?? null;
          const resolved = await resolveExpenseLineAccountId(
            item.businessId, product, line.account_id,
          );
          if (resolved !== line.account_id) {
            await repos.expense.db
              .from('expense_lines')
              .update({ account_id: resolved } as never)
              .eq('id', line.id)
              .eq('business_id', item.businessId);
            line.account_id = resolved;
          }
        }
      }, { module: 'SyncEngine', operation: 'inventory_account_resolution', businessId: item.businessId });

      await retryNonCritical(async () => {
        const allocations = result.lines.map((l) => ({
          accountId: l.account_id || '',
          amount: Number((l as unknown as { line_subtotal?: number }).line_subtotal ?? (Number(l.line_total) - Number((l as unknown as { tax_amount?: number }).tax_amount ?? 0))),
          description: l.description || '',
        }));
        if (allocations.length > 0) {
          // createExpenseJournalEntry already links journal_entry_id on the
          // expense row — no duplicate update needed.
          await createExpenseJournalEntry(
            item.businessId,
            result.expense,
            allocations,
            Number(result.expense.vat_amount),
            result.expense.branch_id,
            result.expense.department_id,
          );
        }
      }, { module: 'SyncEngine', operation: 'expense_journal_entry', businessId: item.businessId });
      return result.expense.id;
    }

    case 'invoice_payment': {
      const { payment } = item.payload as InvoicePaymentQueuePayload;
      const result = await repos.invoice.recordPayment(payment, item.clientKey);
      await retryNonCritical(async () => {
        await createInvoiceSettlementEntry(
          item.businessId,
          result.invoice,
          result.payment,
          'MWK',
          result.invoice.branch_id,
          result.invoice.department_id,
        );
      }, { module: 'SyncEngine', operation: 'invoice_payment_settlement', businessId: item.businessId });
      return result.payment.id;
    }

    case 'expense_payment': {
      const { payment } = item.payload as ExpensePaymentQueuePayload;
      const result = await repos.expense.recordPayment(payment, item.clientKey);
      await retryNonCritical(async () => {
        await createExpenseSettlementEntry(
          item.businessId,
          result.expense,
          result.payment,
          'MWK',
          result.expense.branch_id,
          result.expense.department_id,
        );
      }, { module: 'SyncEngine', operation: 'expense_payment_settlement', businessId: item.businessId });
      return result.payment.id;
    }

    case 'payroll_run': {
      const { run, lines } = item.payload as PayrollRunQueuePayload;
      const linesWithBusiness = lines.map((l) => ({
        ...l,
        business_id: item.businessId,
      }));
      await usageService.assertCanCreateDocument(item.businessId, item.clientKey, 'payroll');

      const result = await repos.payroll.createWithLines(run, linesWithBusiness, item.clientKey);
      return result.id;
    }

    case 'pos_sale': {
      // A whole till sale, replayed exactly as the online till would have
      // written it: invoice + lines, payment rows, stock with COGS, journal,
      // shift totals and audit. The payload was built before the till lost
      // connectivity, so the document carries its real totals, discounts and
      // payment split — only the ids and document number come from the server.
      const posPayload = item.payload as PosSaleQueuePayload;
      const committed = await commitPosSaleDocuments(posPayload, {
        businessId: item.businessId,
        clientKey: item.clientKey,
      });
      if (committed.warnings.length > 0) {
        // The sale is in the books, but a derived step (stock, COGS, journal,
        // drawer totals) did not post. Store the warning with the item so the
        // offline drawer can show it: a synced item that quietly lost its
        // stock movement is exactly the kind of gap nobody finds later.
        log.warn(`POS sale ${posPayload.receiptNumber} synced with warnings`, {
          warnings: committed.warnings,
          businessId: item.businessId,
        });
        await offlineDB.queue.update(item.localId!, {
          lastError: committed.warnings.join(' '),
        });
      }
      return committed.invoice.id;
    }

    case 'stock_movement': {
      const { movement } = item.payload as StockMovementQueuePayload;
      const result = await repos.inventory.recordMovement(movement, item.clientKey);
      return result.movement.id;
    }

    default: {
      const _exhaustive: never = item.operationType;
      throw new Error(`Unhandled queue operation type: ${_exhaustive}`);
    }
  }
}

export async function syncQueue(onProgress?: SyncProgressListener, options: SyncQueueOptions = {}): Promise<SyncProgress> {
  // Recover anything a previous session abandoned mid-write (app closed,
  // tab killed, crash): those items are stuck in `syncing` and would never be
  // selected below, so a queued sale could sit on the device forever with
  // nothing on screen saying so.
  const recovered = await recoverStaleSyncClaims();
  if (recovered > 0) {
    log.warn(`${recovered} queue item(s) were left mid-sync by a previous session — retrying them`, {
      recovered,
    });
  }

  // R09.2 provenance + actor binding: decide, BEFORE any network replay,
  // which items may leave for the server at all. Cross-user and
  // unverifiable items are quarantined — durable, visible, never silently
  // retried. Everything below only ever replays Case A (same actor).
  const currentUserId = options.currentUserId !== undefined
    ? options.currentUserId
    : useAppStore.getState().currentUser?.id ?? null;
  await sweepUnverifiableItems(currentUserId);

  const items = await offlineDB.queue
    .where('status')
    .anyOf('pending', 'failed')
    .sortBy('sequence');

  const progress: SyncProgress = { total: items.length, completed: 0, failed: 0, skipped: 0 };
  const claimant = getLeaseClaimantId();
  onProgress?.(progress);

  if (items.length === 0) return progress;

  const resolvedIds = new Map<number, string>();
  const deferred: QueueItem[] = [];

  for (const item of items) {
    if (item.dependsOnLocalId !== undefined) {
      const parentServerId =
        resolvedIds.get(item.dependsOnLocalId) ??
        (await offlineDB.queue.get(item.dependsOnLocalId))?.resolvedServerId;

      if (!parentServerId) {
        deferred.push(item);
        continue;
      }

      resolveForeignKey(item, parentServerId);
    }

    // R09.2 fail-closed replay gate (defense in depth after the sweep):
    // self actor unknown -> never replays, never mutates status.
    if (!currentUserId) {
      progress.skipped = (progress.skipped ?? 0) + 1;
      continue;
    }
    const violation = replayViolation(item, currentUserId);
    if (violation) {
      continue; // already quarantined by the sweep; never selected again.
    }

    // R09.2 cross-tab exclusive lease: claim BEFORE writing 'syncing', so two
    // tabs can never both process the same item.
    const claim = await claimLease(item.localId!, claimant);
    if (!claim.ok) {
      progress.skipped = (progress.skipped ?? 0) + 1;
      continue;
    }

    progress.current = item.operationType;
    onProgress?.(progress);

    await offlineDB.queue.update(item.localId!, {
      status: 'syncing',
      lastAttemptAt: new Date().toISOString(),
      attemptCount: item.attemptCount + 1,
    });

    // Lease-loss guard: if another force took the item (e.g. after tab death
    // recovery raced us), this tab must not continue replay (§14).
    if (!(await verifyLeaseOwnership(item.localId!, claim.lease!.token))) {
      progress.skipped = (progress.skipped ?? 0) + 1;
      continue;
    }

    try {
      const serverId = await syncItem(item);
      if (!(await verifyLeaseOwnership(item.localId!, claim.lease!.token))) {
        // We lost the item mid-write: the operation already reached the
        // server, so do NOT write local state the owner should own.
        progress.skipped = (progress.skipped ?? 0) + 1;
        continue;
      }
      resolvedIds.set(item.localId!, serverId);

      await offlineDB.queue.update(item.localId!, {
        status: 'synced',
        resolvedServerId: serverId,
        lease: null,
      });

      progress.completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';

      await offlineDB.queue.update(item.localId!, {
        status: 'failed',
        lastError: message,
        // P-D2: expose the typed quota-denial signal at the boundary. No
        // retry/quarantine behavior changes here — that is R09.3's decision.
        lastErrorCode: isQuotaDenial(error) ? QUOTA_DENIAL_SQLSTATE : null,
      });

      progress.failed += 1;
    } finally {
      // Terminal or successful: never retain an unusable lease (§17/§18).
      await releaseLease(item.localId!, claim.lease!.token);
    }

    onProgress?.(progress);
  }

  for (const item of deferred) {
    const parent = await offlineDB.queue.get(item.dependsOnLocalId!);
    if (parent?.status === 'synced' && parent.resolvedServerId) {
      // Same R09.2 gates as the main loop: actor binding + cross-tab lease.
      if (!currentUserId || replayViolation(item, currentUserId)) {
        progress.skipped = (progress.skipped ?? 0) + 1;
        continue;
      }
      const claim = await claimLease(item.localId!, claimant);
      if (!claim.ok) {
        progress.skipped = (progress.skipped ?? 0) + 1;
        continue;
      }
      resolveForeignKey(item, parent.resolvedServerId);

      await offlineDB.queue.update(item.localId!, {
        status: 'syncing',
        lastAttemptAt: new Date().toISOString(),
        attemptCount: item.attemptCount + 1,
      });

      try {
        const serverId = await syncItem(item);
        await offlineDB.queue.update(item.localId!, {
          status: 'synced',
          resolvedServerId: serverId,
          lease: null,
        });
        progress.completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown sync error';
        await offlineDB.queue.update(item.localId!, {
          status: 'failed',
          lastError: message,
          lastErrorCode: isQuotaDenial(error) ? QUOTA_DENIAL_SQLSTATE : null,
        });
        progress.failed += 1;
      } finally {
        await releaseLease(item.localId!, claim.lease!.token);
      }
      onProgress?.(progress);
    }
  }

  return progress;
}