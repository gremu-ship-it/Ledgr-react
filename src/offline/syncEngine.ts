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
      let nextInvoice = { ...invoice };
      if (nextInvoice.invoice_number && nextInvoice.invoice_number.startsWith('INV-OFFLINE-')) {
        const realNumber = await repos.business.reserveNextInvoiceNumber(item.businessId);
        nextInvoice = { ...nextInvoice, invoice_number: realNumber };
      }
      if (!nextInvoice.contact_id || nextInvoice.contact_id === 'offline_walk_in_customer') {
        const contacts = await repos.contact.findByBusiness(item.businessId, 'customer');
        const walkIn = contacts.find((c) => c.name === 'Walk-in Customer') ?? contacts[0];
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
      let nextExpense = { ...expense };
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
          const journalEntryId = await createExpenseJournalEntry(
            item.businessId,
            result.expense,
            allocations,
            Number(result.expense.vat_amount),
            result.expense.branch_id,
            result.expense.department_id,
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- update exposed on repo
          await (repos.expense as any).update(result.expense.id, { journal_entry_id: journalEntryId });
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