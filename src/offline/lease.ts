/**
 * R09.2 cross-tab exclusive replay lease.
 *
 * Shared browser-visible coordination lives in the IndexedDB queue row
 * itself (Dexie), inside a single readwrite IndexedDB transaction on the
 * `queue` store: the read-check-write of a claim is ordered serially by the
 * engine, so two tabs can never interleave a claim of the same item. An
 * in-memory ref is explicitly NOT a cross-tab lock (§6) and is not used.
 *
 * Lease terms (§6/§7):
 *  - item-specific:  stored on the queue row;
 *  - short-lived:    LEASE_TTL_MS, renewable while processing;
 *  - claimant-labeled: install/tab pair (never a user id alone);
 *  - released on completion and on terminal failure;
 *  - reclaimable ONLY after expiry — and reclaim is the same serialized
 *    claim, so two tabs racing an expired item still end single-owner;
 *  - complements — never replaces — the pre-existing stale-'syncing'-claim
 *    recovery (STALE_SYNC_CLAIM_MS), which is untouched.
 */
import { offlineDB, type QueueLease } from './db';
import { getLeaseClaimantId } from './deviceIdentity';

export const LEASE_TTL_MS = 30_000;

export function isLeaseExpired(lease: QueueLease | null | undefined, now = Date.now()): boolean {
  if (!lease) return true;
  const expires = Date.parse(lease.expiresAt);
  if (Number.isNaN(expires)) return true;
  return now >= expires;
}

function newLease(claimant: string, now: number, ttlMs: number): QueueLease {
  return {
    token: crypto.randomUUID(),
    claimant,
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
}

export interface LeaseClaim {
  ok: boolean;
  lease: QueueLease | null;
  /** Why a claim failed: another tab owns it, or the item is not replayable. */
  reason?: 'held-by-other' | 'not-replayable';
}

/**
 * Attempt to claim the replay lease for one queue item. Single-owner or
 * fail. Only 'pending'/'failed' items are leasable; the claim never revives
 * 'quarantined'/'synced' rows.
 */
export async function claimLease(
  localId: number,
  claimant = getLeaseClaimantId(),
  ttlMs = LEASE_TTL_MS,
  now = Date.now(),
): Promise<LeaseClaim> {
  const granted = await offlineDB.transaction('rw', offlineDB.queue, async () => {
    const item = await offlineDB.queue.get(localId);
    if (!item || (item.status !== 'pending' && item.status !== 'failed')) {
      return { ok: false as const, reason: 'not-replayable' as const };
    }
    const mine = item.lease?.claimant === claimant;
    if (item.lease && !isLeaseExpired(item.lease, now) && !mine) {
      return { ok: false as const, reason: 'held-by-other' as const };
    }
    const lease = newLease(claimant, now, ttlMs);
    await offlineDB.queue.update(localId, { lease });
    return { ok: true as const, lease };
  });
  if (!granted.ok) return { ok: false, lease: null, reason: granted.reason };

  // Post-claim verification (defense in depth): re-read and confirm the row
  // carries OUR token — never assume the write won.
  const after = await offlineDB.queue.get(localId);
  if (after?.lease?.token !== granted.lease.token) {
    return { ok: false, lease: null, reason: 'held-by-other' };
  }
  return { ok: true, lease: granted.lease };
}

/** Extend OUR lease while processing; never extend someone else's. */
export async function renewLease(
  localId: number,
  token: string,
  ttlMs = LEASE_TTL_MS,
  now = Date.now(),
): Promise<boolean> {
  return offlineDB.transaction('rw', offlineDB.queue, async () => {
    const item = await offlineDB.queue.get(localId);
    if (!item || item.lease?.token !== token) return false;
    await offlineDB.queue.update(localId, {
      lease: { ...item.lease, expiresAt: new Date(now + ttlMs).toISOString() },
    });
    return true;
  });
}

/**
 * Release OUR lease (success or terminal failure). Compact+correct — a
 * completed or dead item must not retain an unusable lock (§17/§18).
 */
export async function releaseLease(localId: number, token: string): Promise<void> {
  await offlineDB.transaction('rw', offlineDB.queue, async () => {
    const item = await offlineDB.queue.get(localId);
    if (item?.lease?.token === token) {
      await offlineDB.queue.update(localId, { lease: null });
    }
  });
}

/** True when this tab still owns the lease (heartbeat before each replay step). */
export async function verifyLeaseOwnership(localId: number, token: string): Promise<boolean> {
  const item = await offlineDB.queue.get(localId);
  return item?.lease?.token === token;
}
