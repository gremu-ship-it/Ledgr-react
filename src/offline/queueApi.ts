import { offlineDB, type QueueOperationType, type QueueItem } from './db';
import type { QueuePayloadFor } from './payloads';
import { requestBackgroundSync } from './backgroundSync';
import { useAppStore } from '@/store/useAppStore';
import { buildProvenance, captureContext } from './provenance';
import { hashQueuePayload } from './payloadIntegrity';
import { usageService } from '@/lib/billing/UsageService';
import { isQuotaDenial } from '@/lib/billing/quotaContract';

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

  // P5-C (Q13 C) capture-time quota guard — per-tenant monthly document
  // entitlement (invoices + expenses + payroll_runs dated this month).
  // This is UX early feedback: it throws P0QLT immediately when the tenant
  // is over quota, instead of queueing and failing later during sync.
  // It is NOT authoritative — the BEFORE INSERT triggers + locked
  // _ledgr_assert_usage_limit are. On any failure that is not a quota
  // denial (offline, network, count RPC unavailable) we fail OPEN and
  // enqueue anyway — the server will enforce. Only P0QLT is propagated.
  const documentKind: 'invoice' | 'expense' | 'payroll' | null =
    operationType === 'expense'
      ? 'expense'
      : operationType === 'payroll_run'
        ? 'payroll'
        : operationType === 'income' || operationType === 'invoice' || operationType === 'pos_sale'
          ? 'invoice'
          : null;
  // Generate the idempotency key before the quota probe so the probe can
  // correctly consider an already-committed replay (same client_key) as
  // idempotent and not a new billable document. Reuse the same key for the
  // queue item — one logical document, one key.
  const clientKey =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
  if (documentKind) {
    try {
      // Bound the capture-time probe so a hanging count RPC (e.g. DNS
      // ENOTFOUND to placeholder.supabase.co in unit tests, or a slow
      // mobile link) never stalls the UI or the test suite. Production
      // quota is still enforced authoritatively by the BEFORE INSERT
      // triggers + locked _ledgr_assert_usage_limit — this is only the
      // UX early guard (fail-open on any non-P0QLT, including timeout).
      // In unit tests the Supabase URL is the placeholder and the RPC
      // would otherwise hang for seconds — use a very short timeout so
      // those tests stay fast, while production keeps a realistic budget.
      const probeTimeoutMs = (() => {
        try {
          const url = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SUPABASE_URL ?? '';
          if (!url || String(url).includes('placeholder')) return 80;
        } catch {
          // ignore — fall through to production timeout
        }
        return 1500;
      })();
      await Promise.race([
        usageService.assertCanCreateDocument(businessId, clientKey, documentKind),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('quota probe timeout')), probeTimeoutMs),
        ),
      ]);
    } catch (err) {
      if (isQuotaDenial(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'quota probe timeout') {
        // eslint-disable-next-line no-console
        console.warn('[queueApi] quota capture check timed out — fail open (server will enforce)');
      } else {
        // Fail open — offline/unreachable count must not block queueing;
        // the server trigger is the authority. Log at warn for observability.
        // eslint-disable-next-line no-console
        console.warn('[queueApi] quota capture check failed open', err);
      }
    }
  }

  const sequence = await nextSequence();

  // R09.2 provenance: captured at enqueue from the hydrated app session.
  // Never manufactured — when no authenticated user is hydrated, originUserId
  // is null and the sync engine will quarantine the item before any replay
  // (Case C), exactly like an old-build v1 row.
  const provenance = buildProvenance(useAppStore.getState().currentUser?.id ?? null);
  const context = captureContext(operationType, payload);

  // R09.3 integrity: freeze the payload's identity at capture. Replay and
  // reconciliation re-verify against this hash; a mismatch quarantines the
  // item as 'payload-tampered' before any network submission.
  const payloadHash = await hashQueuePayload(payload);

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
    // Reused from the quota probe above — one key per logical document.
    clientKey,
    ...provenance,
    ...context,
    payloadHash,
    exceptionClass: null,
    reconcileAttempts: 0,
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