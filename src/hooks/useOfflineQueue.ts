import { useLiveQuery } from 'dexie-react-hooks';
import { offlineDB, type QueueItem, type QueueOperationType, QUEUE_TYPE_LABELS } from '@/offline/db';
import { enqueue, type EnqueueOptions } from '@/offline/queueApi';
import type { QueuePayloadFor } from '@/offline/payloads';
import { useAppStore } from '@/store/useAppStore';

export interface OfflineQueueSummary {
  /** All queue items for the current business, in creation order. */
  items: QueueItem[];
  /** Items not yet successfully synced (pending or failed). */
  pendingItems: QueueItem[];
  pendingCount: number;
  failedCount: number;
  /** Human-readable summary, e.g. "2 invoices, 1 payroll run". */
  pendingSummary: string;
}

function summarize(items: QueueItem[]): string {
  const counts = new Map<QueueOperationType, number>();
  for (const item of items) {
    counts.set(item.operationType, (counts.get(item.operationType) ?? 0) + 1);
  }

  const parts: string[] = [];
  for (const [type, count] of counts) {
    const label = QUEUE_TYPE_LABELS[type];
    parts.push(`${count} ${label}${count > 1 ? 's' : ''}`);
  }
  return parts.join(', ');
}

/**
 * Reactive hook exposing the offline queue for the current business, plus
 * an `add` function for enqueueing new operations. Re-renders automatically
 * whenever the underlying IndexedDB table changes (via Dexie's live query),
 * so UI like the sync banner stays in sync without manual polling.
 */
export function useOfflineQueue(): OfflineQueueSummary & {
  add: <T extends QueueOperationType>(
    operationType: T,
    payload: QueuePayloadFor<T>,
    options?: EnqueueOptions,
  ) => Promise<number>;
} {
  const businessId = useAppStore((s) => s.currentBusiness?.business.id);

  const items = useLiveQuery(
    () => (businessId ? offlineDB.queue.where('businessId').equals(businessId).sortBy('sequence') : []),
    [businessId],
    [] as QueueItem[],
  );

  const pendingItems = items.filter((i) => i.status === 'pending' || i.status === 'failed');
  const failedCount = items.filter((i) => i.status === 'failed').length;

  async function add<T extends QueueOperationType>(
    operationType: T,
    payload: QueuePayloadFor<T>,
    options?: EnqueueOptions,
  ): Promise<number> {
    if (!businessId) {
      throw new Error('Cannot queue an offline operation without a selected business.');
    }
    return enqueue(operationType, businessId, payload, options);
  }

  return {
    items,
    pendingItems,
    pendingCount: pendingItems.length,
    failedCount,
    pendingSummary: summarize(pendingItems),
    add,
  };
}