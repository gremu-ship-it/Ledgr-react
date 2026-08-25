import { offlineDB, type QueueOperationType, type QueueItem } from './db';
import type { QueuePayloadFor } from './payloads';
import { requestBackgroundSync } from './backgroundSync';

/**
 * Determines whether an error occurred because the device is offline or
 * network connectivity failed.
 */
export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (!error) return false;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Network request failed') ||
    msg.includes('fetch failed') ||
    msg.includes('offline') ||
    msg.includes('ERR_INTERNET_DISCONNECTED') ||
    msg.includes('ERR_NETWORK_CHANGED')
  );
}

/**
 * Generates a unique temporary reference number for an offline transaction
 * (e.g. 'EXP-OFFLINE-123456'). Will be replaced with a genuine sequence
 * number from BusinessRepository upon syncing online.
 */
let lastOfflineNumberTimestamp = 0;
let offlineNumberSequence = 0;

export function generateOfflineNumber(prefix = 'OFF'): string {
  const timestamp = Date.now();
  if (timestamp === lastOfflineNumberTimestamp) {
    offlineNumberSequence += 1;
  } else {
    lastOfflineNumberTimestamp = timestamp;
    offlineNumberSequence = 0;
  }

  // Keep the temporary number numeric: several document-number integrations
  // validate this suffix, while the per-millisecond sequence keeps rapid
  // local creations unique.
  return `${prefix}-OFFLINE-${timestamp}${offlineNumberSequence.toString().padStart(3, '0')}`;
}

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
 * @param businessId - The tenant this record belongs to.
 * @param ownerUserId - Auth identity that owns the queued financial write.
 * @param payload - The exact data the corresponding repository method needs.
 * @param options - Optional dependency linkage and conflict-resolution metadata.
 * @returns The localId of the newly queued item.
 */
/**
 * Phase 10.4 backpressure: cap the number of unsynced items. Prevents an
 * unbounded offline queue (which would stall sync and blow up IndexedDB)
 * when the device stays offline for a long time.
 */
export const MAX_PENDING_QUEUE_ITEMS = 2_000;

export async function enqueue<T extends QueueOperationType>(
  operationType: T,
  businessId: string,
  ownerUserId: string,
  payload: QueuePayloadFor<T>,
  options?: EnqueueOptions,
): Promise<number> {
  if (!businessId || !ownerUserId) {
    throw new Error('Offline transactions require an authenticated user and active business.');
  }
  const pending = await getPendingCount();
  if (pending >= MAX_PENDING_QUEUE_ITEMS) {
    throw new Error(
      `Offline queue is full (${MAX_PENDING_QUEUE_ITEMS} items). Go online and sync before creating more transactions.`,
    );
  }
  const sequence = await nextSequence();

  const item: QueueItem = {
    sequence,
    operationType,
    status: 'pending',
    businessId,
    ownerUserId,
    payload,
    dependsOnLocalId: options?.dependsOnLocalId,
    dependentFkField: options?.dependentFkField,
    localUpdatedAt: options?.localUpdatedAt,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    // Idempotency key: a stable, unique value so a retried sync can recognise
    // an already-committed record instead of inserting a duplicate.
    clientKey: crypto.randomUUID(),
  };

  const localId = await offlineDB.queue.add(item);

  // Best-effort only. Browsers without Background Sync still flush through
  // the online event and the mount-time backlog check in useSyncQueue.
  void requestBackgroundSync();

  return localId as number;
}

/** Fetch queue items owned by one user in one business, in creation order. */
export async function getQueueForBusiness(
  businessId: string,
  ownerUserId: string,
): Promise<QueueItem[]> {
  const items = await offlineDB.queue.where('businessId').equals(businessId).sortBy('sequence');
  return items.filter((item) => item.ownerUserId === ownerUserId);
}

/** Fetch pending/failed items for the exact active user and business. */
export async function getPendingItems(
  businessId: string,
  ownerUserId: string,
): Promise<QueueItem[]> {
  const items = await getQueueForBusiness(businessId, ownerUserId);
  return items.filter((item) => item.status === 'pending' || item.status === 'failed');
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