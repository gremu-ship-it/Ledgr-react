import { repos } from '@/lib/repositories';
import { withRetry } from '@/lib/errorHandler';

/**
 * Wraps a non-critical sync operation with retry logic.
 * If all retries fail, logs the error and returns null (doesn't throw).
 */
async function retryNonCritical<T>(
  operation: () => Promise<T>,
  context: { operation: string; businessId?: string },
): Promise<T | null> {
  return withRetry(operation, {
    module: 'SyncEngine',
    operation: context.operation,
    businessId: context.businessId,
    maxAttempts: 2, // Quick retry for transient failures
    initialDelay: 500,
    backoffMultiplier: 2,
  });
}
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
import { createLogger } from '@/lib/logger';
import { offlineDB, type QueueItem } from './db';
import type {
  IncomeQueuePayload,
  InvoiceQueuePayload,
  ExpenseQueuePayload,
  InvoicePaymentQueuePayload,
  ExpensePaymentQueuePayload,
  PayrollRunQueuePayload,
  StockMovementQueuePayload,
} from './payloads';

const log = createLogger('SyncEngine');

export interface SyncProgress {
  total: number;
  completed: number;
  failed: number;
  current?: string;
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
      }, { operation: 'invoice_journal_entry', businessId: item.businessId });

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
      }, { operation: 'stock_cogs_posting', businessId: item.businessId });

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
      }, { operation: 'inventory_account_resolution', businessId: item.businessId });

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
      }, { operation: 'expense_journal_entry', businessId: item.businessId });
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
      }, { operation: 'invoice_payment_settlement', businessId: item.businessId });
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
      }, { operation: 'expense_payment_settlement', businessId: item.businessId });
      return result.payment.id;
    }

    case 'payroll_run': {
      const { run, lines } = item.payload as PayrollRunQueuePayload;
      const linesWithBusiness = lines.map((l) => ({
        ...l,
        business_id: item.businessId,
      }));
      const result = await repos.payroll.createWithLines(run, linesWithBusiness, item.clientKey);
      return result.id;
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

export async function syncQueue(onProgress?: SyncProgressListener): Promise<SyncProgress> {
  const items = await offlineDB.queue
    .where('status')
    .anyOf('pending', 'failed')
    .sortBy('sequence');

  const progress: SyncProgress = { total: items.length, completed: 0, failed: 0 };
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

    progress.current = item.operationType;
    onProgress?.(progress);

    await offlineDB.queue.update(item.localId!, {
      status: 'syncing',
      lastAttemptAt: new Date().toISOString(),
      attemptCount: item.attemptCount + 1,
    });

    try {
      const serverId = await syncItem(item);
      resolvedIds.set(item.localId!, serverId);

      await offlineDB.queue.update(item.localId!, {
        status: 'synced',
        resolvedServerId: serverId,
      });

      progress.completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown sync error';

      await offlineDB.queue.update(item.localId!, {
        status: 'failed',
        lastError: message,
      });

      progress.failed += 1;
    }

    onProgress?.(progress);
  }

  for (const item of deferred) {
    const parent = await offlineDB.queue.get(item.dependsOnLocalId!);
    if (parent?.status === 'synced' && parent.resolvedServerId) {
      resolveForeignKey(item, parent.resolvedServerId);

      await offlineDB.queue.update(item.localId!, {
        status: 'syncing',
        lastAttemptAt: new Date().toISOString(),
        attemptCount: item.attemptCount + 1,
      });

      try {
        const serverId = await syncItem(item);
        await offlineDB.queue.update(item.localId!, { status: 'synced', resolvedServerId: serverId });
        progress.completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown sync error';
        await offlineDB.queue.update(item.localId!, { status: 'failed', lastError: message });
        progress.failed += 1;
      }
      onProgress?.(progress);
    }
  }

  return progress;
}