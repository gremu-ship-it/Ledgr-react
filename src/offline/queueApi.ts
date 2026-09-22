import { offlineDB, type QueueOperationType, type QueueItem } from './db';
import type { QueuePayloadFor } from './payloads';
import { requestBackgroundSync } from './backgroundSync';
import { useAppStore } from '@/store/useAppStore';
import { buildProvenance, captureContext } from './provenance';

/**
 * Determines whether an error occurred because the device is offline or
 * network connectivity failed — including browser-side aborts (tab
 * backgrounding, network switch, Wi‑Fi toggle) and our own request
 * timeout. These are all cases where the client cannot tell whether the
 * server actually committed the write, so callers should either queue
 * the operation for retry or surface a retry-safe message rather than
 * declaring "nothing was saved".
 */
export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (!error) return false;
  if ((error as { name?: string }).name === 'AbortError') return true;
  if ((error as { name?: string }).name === 'TimeoutError') return true;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('NetworkError') ||
    msg.includes('Network request failed') ||
    msg.includes('fetch failed') ||
    msg.includes('offline') ||
    msg.includes('ERR_INTERNET_DISCONNECTED') ||
    msg.includes('ERR_NETWORK_CHANGED') ||
    /signal is aborted/i.test(msg) ||
    /timed out/i.test(msg) ||
    /The operation was aborted/i.test(msg)
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
  /**
   * When the user actually performed the action, for items recovered from an
   * older store that recorded its own timestamp. Defaults to now — a queued
   * item should otherwise carry the moment it was queued, not the moment it
   * happened to be imported.
   */
  createdAt?: string;
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
/**
 * Phase 10.4 backpressure: cap the number of unsynced items. Prevents an
 * unbounded offline queue (which would stall sync and blow up IndexedDB)
 * when the device stays offline for a long time.
 */
export const MAX_PENDING_QUEUE_ITEMS = 2_000;

export async function enqueue<T extends QueueOperationType>(
  operationType: T,
  businessId: string,
  payload: QueuePayloadFor<T>,
  options?: EnqueueOptions,
): Promise<number> {
  const pending = await getPendingCount();
  if (pending >= MAX_PENDING_QUEUE_ITEMS) {
    throw new Error(
      `Offline queue is full (${MAX_PENDING_QUEUE_ITEMS} items). Go online and sync before creating more transactions.`,
    );
  }
  const sequence = await nextSequence();

  // R09.2 provenance: captured at enqueue from the hydrated app session.
  // Never manufactured — when no authenticated user is hydrated, originUserId
  // is null and the sync engine will quarantine the item before any replay
  // (Case C), exactly like an old-build v1 row.
  const provenance = buildProvenance(useAppStore.getState().currentUser?.id ?? null);
  const context = captureContext(operationType, payload);

  const item: QueueItem = {
    sequence,
    operationType,
    status: 'pending',
    businessId,
    payload,
    dependsOnLocalId: options?.dependsOnLocalId,
    dependentFkField: options?.dependentFkField,
    localUpdatedAt: options?.localUpdatedAt,
    createdAt: options?.createdAt ?? new Date().toISOString(),
    attemptCount: 0,
    // Idempotency key: a stable, unique value so a retried sync can recognise
    // an already-committed record instead of inserting a duplicate.
    clientKey: crypto.randomUUID(),
    ...provenance,
    ...context,
    lease: null,
  };

  const localId = await offlineDB.queue.add(item);

  // Best-effort only. Browsers without Background Sync still flush through
  // the online event and the mount-time backlog check in useSyncQueue.
  void requestBackgroundSync();

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

/**
 * How long an item may sit in `syncing` before its claim is treated as dead.
 *
 * `syncQueue` marks an item `syncing` while it writes, and clears it on the
 * way out. If the tab is closed, reloaded or crashes in that window the item
 * stays `syncing` forever — invisible to the queue (which only selects
 * `pending`/`failed`), missing from the "waiting" count, and not retryable
 * from the drawer. That is the one failure mode where a sale can be lost
 * without anything on screen saying so. A commit takes seconds, so anything
 * still claimed two minutes later is abandoned, not in flight.
 */
export const STALE_SYNC_CLAIM_MS = 2 * 60 * 1000;

/** True when a `syncing` item has outlived its claim and should be retried. */
export function isStaleSyncClaim(item: QueueItem, now = Date.now()): boolean {
  if (item.status !== 'syncing') return false;
  const claimedAt = item.lastAttemptAt ? Date.parse(item.lastAttemptAt) : Number.NaN;
  if (Number.isNaN(claimedAt)) return true; // no timestamp: cannot still be in flight
  return now - claimedAt > STALE_SYNC_CLAIM_MS;
}

/**
 * Return abandoned `syncing` items to the queue so the next pass (or the
 * user's Retry) picks them up again. Returns how many were recovered.
 *
 * Safe to call often: a claim younger than the lease is left alone, so a pass
 * running in another tab is never interrupted.
 */
export async function recoverStaleSyncClaims(now = Date.now()): Promise<number> {
  const claimed = await offlineDB.queue.where('status').equals('syncing').toArray();
  const stale = claimed.filter((item) => isStaleSyncClaim(item, now));
  if (stale.length === 0) return 0;

  // Only the status is rewritten. `lastError` is deliberately left alone: the
  // drawer reads it as "synced, but a follow-up step did not post", and a
  // recovered item that then syncs cleanly must not inherit that banner.
  await Promise.all(
    stale.map((item) => offlineDB.queue.update(item.localId!, { status: 'pending' })),
  );
  return stale.length;
}

/**
 * Count of items not yet successfully synced.
 *
 * Abandoned `syncing` items count too: they are not on the server, and a
 * count that hides them lets the till believe an offline sale made it.
 */
export async function getPendingCount(): Promise<number> {
  const [unfinished, claimed] = await Promise.all([
    offlineDB.queue.where('status').anyOf('pending', 'failed').count(),
    offlineDB.queue.where('status').equals('syncing').toArray(),
  ]);
  const now = Date.now();
  return unfinished + claimed.filter((item) => isStaleSyncClaim(item, now)).length;
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