import { repos } from '@/lib/repositories';
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
  const payload = item.payload as Record<string, unknown>;

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
      const result = await repos.invoice.createWithLines(invoice, lines);
      return result.invoice.id;
    }

    case 'expense': {
      const { expense, lines } = item.payload as ExpenseQueuePayload;
      const result = await repos.expense.createWithLines(expense, lines);
      return result.expense.id;
    }

    case 'invoice_payment': {
      const { payment } = item.payload as InvoicePaymentQueuePayload;
      const result = await repos.invoice.recordPayment(payment);
      return result.payment.id;
    }

    case 'expense_payment': {
      const { payment } = item.payload as ExpensePaymentQueuePayload;
      const result = await repos.expense.recordPayment(payment);
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