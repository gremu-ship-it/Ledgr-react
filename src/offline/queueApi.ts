import { offlineDB, type QueueOperationType, type QueueItem } from './db';
import type { QueuePayloadFor } from './payloads';

/**
 * Returns the next monotonically increasing sequence number, used to
 * preserve creation order across all queued operations regardless of
 * `operationType`. We can't rely on `localId` alone for ordering once
 * synced items are cleaned up (their localIds are freed/reused by IndexedDB
 * key generation in some browsers), so we track our own counter.
 */
async function nextSequence(): Promise<number> {
  const last = await offlineDB.queue.orderBy('sequence').last();
  return (last?.sequence ?? 0) + 1;
}

export interface EnqueueOptions {
  /** localId of a parent queue item this operation depends on. */
  dependsOnLocalId?: number;
  /** Field in the payload to rewrite with the parent's server id once resolved. */
  dependentFkField?: string;
  /** Client-side modification timestamp, for last-write-wins on tables with updated_at. */
  localUpdatedAt?: string;
}

/**
 * Add a new operation to the offline queue.
 *
 * @param operationType - Which of the 7 financial write operations this is.
 * @param businessId - The tenant this record belongs to — preserved so the
 * item syncs into the correct business even if the user switches business
 * context while offline.
 * @param payload - The exact data the corresponding repository method needs.
 * @param options - Optional dependency linkage and conflict-resolution metadata.
 * @returns The localId of the newly queued item.
 */
export async function enqueue<T extends QueueOperationType>(
  operationType: T,
  businessId: string,
  payload: QueuePayloadFor<T>,
  options?: EnqueueOptions,
): Promise<number> {
  const sequence = await nextSequence();

  const item: QueueItem = {
    sequence,
    operationType,
    status: 'pending',
    businessId,
    payload,
    dependsOnLocalId: options?.dependsOnLocalId,
    dependentFkField: options?.dependentFkField,
    localUpdatedAt: options?.localUpdatedAt,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
  };

  const localId = await offlineDB.queue.add(item);
  return localId as number;
}

/** Fetch all queue items for a business, in creation order. */
export async function getQueueForBusiness(businessId: string): Promise<QueueItem[]> {
  return offlineDB.queue.where('businessId').equals(businessId).sortBy('sequence');
}

/** Fetch all pending or failed items across all businesses, in creation order. */
export async function getPendingItems(): Promise<QueueItem[]> {
  const items = await offlineDB.queue
    .where('status')
    .anyOf('pending', 'failed')
    .sortBy('sequence');
  return items;
}

/** Count of items not yet successfully synced. */
export async function getPendingCount(): Promise<number> {
  return offlineDB.queue.where('status').anyOf('pending', 'failed').count();
}

/** Remove a queue item entirely (used after successful sync, or manual discard). */
export async function removeQueueItem(localId: number): Promise<void> {
  await offlineDB.queue.delete(localId);
}

/** Clear all successfully synced items older than the given age, to keep IndexedDB tidy. */
export async function pruneSyncedItems(olderThanMs = 1000 * 60 * 60 * 24 * 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  const stale = await offlineDB.queue
    .where('status')
    .equals('synced')
    .filter((item) => Boolean(item.lastAttemptAt) && item.lastAttemptAt! < cutoff)
    .toArray();

  await offlineDB.queue.bulkDelete(stale.map((i) => i.localId!));
  return stale.length;
}