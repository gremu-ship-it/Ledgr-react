import { repos } from '@/lib/repositories';
import {
  createInvoiceJournalEntry,
  createInvoiceReceivableEntry,
  createExpenseJournalEntry,
  createInvoiceSettlementEntry,
  createExpenseSettlementEntry,
} from '@/services/journalService';
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
      const result = await repos.invoice.createWithLines(nextInvoice, lines);
      try {
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
      } catch (err) {
        console.warn('Invoice journal entry failed during offline sync:', err);
      }
      return result.invoice.id;
    }

    case 'expense': {
      const { expense, lines } = item.payload as ExpenseQueuePayload;
      let nextExpense = { ...expense };
      if (nextExpense.expense_number && nextExpense.expense_number.startsWith('EXP-OFFLINE-')) {
        const realNumber = await repos.business.reserveNextExpenseNumber(item.businessId);
        nextExpense = { ...nextExpense, expense_number: realNumber };
      }
      const result = await repos.expense.createWithLines(nextExpense, lines);
      try {
        const allocations = result.lines.map((l) => ({
          accountId: l.account_id || '',
          amount: Number(l.line_total),
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
      } catch (err) {
        console.warn('Expense journal entry failed during offline sync:', err);
      }
      return result.expense.id;
    }

    case 'invoice_payment': {
      const { payment } = item.payload as InvoicePaymentQueuePayload;
      const result = await repos.invoice.recordPayment(payment);
      try {
        await createInvoiceSettlementEntry(
          item.businessId,
          result.invoice,
          result.payment,
          'MWK',
          result.invoice.branch_id,
          result.invoice.department_id,
        );
      } catch (err) {
        console.warn('Invoice payment settlement journal entry failed during offline sync:', err);
      }
      return result.payment.id;
    }

    case 'expense_payment': {
      const { payment } = item.payload as ExpensePaymentQueuePayload;
      const result = await repos.expense.recordPayment(payment);
      try {
        await createExpenseSettlementEntry(
          item.businessId,
          result.expense,
          result.payment,
          'MWK',
          result.expense.branch_id,
          result.expense.department_id,
        );
      } catch (err) {
        console.warn('Expense payment settlement journal entry failed during offline sync:', err);
      }
      return result.payment.id;
    }

    case 'payroll_run': {
      const { run, lines } = item.payload as PayrollRunQueuePayload;
      const linesWithBusiness = lines.map((l) => ({
        ...l,
        business_id: item.businessId,
      }));
      const result = await repos.payroll.createWithLines(run, linesWithBusiness);
      return result.id;
    }

    case 'stock_movement': {
      const { movement } = item.payload as StockMovementQueuePayload;
      const result = await repos.inventory.recordMovement(movement);
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