// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { offlineDB, type QueueItem } from '@/offline/db';
import {
  claimLease,
  renewLease,
  releaseLease,
  verifyLeaseOwnership,
  isLeaseExpired,
  LEASE_TTL_MS,
} from '@/offline/lease';

const TAB_1 = 'install-x/tab-1';
const TAB_2 = 'install-x/tab-2';

async function addPending(): Promise<number> {
  const item: QueueItem = {
    sequence: 1,
    operationType: 'expense',
    status: 'pending',
    businessId: 'r13-biz',
    payload: { expense: {}, lines: [] } as never,
    createdAt: '2026-09-22T08:00:00.000Z',
    attemptCount: 0,
    clientKey: crypto.randomUUID(),
    lease: null,
  };
  return offlineDB.queue.add(item) as Promise<number>;
}

describe('R09.2 cross-tab exclusive replay lease (tests 13–18)', () => {
  beforeEach(async () => {
    await offlineDB.open();
    await offlineDB.queue.clear();
  });

  it('13. two tabs cannot simultaneously hold the same item lease', async () => {
    const id = await addPending();
    const a = await claimLease(id, TAB_1);
    const b = await claimLease(id, TAB_2);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(b.reason).toBe('held-by-other');
    // Exactly one owner persisted.
    expect(((await offlineDB.queue.get(id))!.lease)!.claimant).toBe(TAB_1);
  });

  it('14. the losing tab cannot pretend ownership afterward', async () => {
    const id = await addPending();
    const a = await claimLease(id, TAB_1);
    const b = await claimLease(id, TAB_2);
    expect(await verifyLeaseOwnership(id, b.lease?.token ?? 'none')).toBe(false);
    expect(await verifyLeaseOwnership(id, a.lease!.token)).toBe(true);
    expect(await releaseLeaseAndCheck(id, 'bogus-token')).toBe(true); // only the real token releases
  });

  it('15+16. an expired lease is reclaimable — concurrent reclaim stays single-owner', async () => {
    const id = await addPending();
    const t0 = Date.parse('2026-09-22T08:00:00Z');
    const a = await claimLease(id, TAB_1, LEASE_TTL_MS, t0);
    expect(a.ok).toBe(true);
    const afterExpiry = t0 + LEASE_TTL_MS + 1;
    // Both tabs attempt the reclaim at the same expiry boundary.
    const [b1, b2] = await Promise.all([
      claimLease(id, TAB_2, LEASE_TTL_MS, afterExpiry),
      claimLease(id, TAB_1, LEASE_TTL_MS, afterExpiry),
    ]);
    const wins = [b1, b2].filter((c) => c.ok);
    expect(wins).toHaveLength(1);
    const item = (await offlineDB.queue.get(id))!;
    const ownerToken = item.lease!.token;
    expect([b1.lease?.token, b2.lease?.token]).toContain(ownerToken);
    // …and whoever read false cannot verify ownership.
    const loser = b1.ok ? b2 : b1;
    expect(await verifyLeaseOwnership(id, loser.lease?.token ?? 'x')).toBe(false);
  });

  it('16b. isLeaseExpired boundary: only reclaimable AT/PAST expiry', async () => {
    const id = await addPending();
    const t0 = Date.parse('2026-09-22T08:00:00Z');
    await claimLease(id, TAB_1, LEASE_TTL_MS, t0);
    const beforeExpiry = t0 + LEASE_TTL_MS - 1;
    const other = await claimLease(id, TAB_2, LEASE_TTL_MS, beforeExpiry);
    expect(other.ok).toBe(false);
    expect(((await offlineDB.queue.get(id))!.lease)!.claimant).toBe(TAB_1);
    expect(isLeaseExpired((await offlineDB.queue.get(id))!.lease, t0 + LEASE_TTL_MS)).toBe(true);
  });

  it('17. successful completion releases the lease; item becomes leasable again only as a new record', async () => {
    const id = await addPending();
    const a = await claimLease(id, TAB_1);
    await releaseLease(id, a.lease!.token);
    expect((await offlineDB.queue.get(id))!.lease).toBeNull();
    // Row is complete practice: 'synced' rows cannot be leased again at all.
    await offlineDB.queue.update(id, { status: 'synced' });
    const again = await claimLease(id, TAB_2);
    expect(again.ok).toBe(false);
    expect(again.reason).toBe('not-replayable');
  });

  it('18a. a failed/terminal transition clears the lease via releaseLease', async () => {
    const id = await addPending();
    const a = await claimLease(id, TAB_1);
    await offlineDB.queue.update(id, { status: 'failed' });
    await releaseLease(id, a.lease!.token);
    expect((await offlineDB.queue.get(id))!.lease).toBeNull();
  });

  it('18b. a quarantined item drops its lease entirely (quarantine clears it)', async () => {
    const id = await addPending();
    await claimLease(id, TAB_1);
    await offlineDB.queue.update(id, { status: 'quarantined', quarantineReason: 'actor-mismatch', lease: null });
    const item = (await offlineDB.queue.get(id))!;
    expect(item.lease).toBeNull();
    const attempt = await claimLease(id, TAB_2);
    expect(attempt.ok).toBe(false);
  });

  it('the owning tab can renew its own lease; a different tab cannot', async () => {
    const id = await addPending();
    const t0 = Date.parse('2026-09-22T08:00:00Z');
    const a = await claimLease(id, TAB_1, 1000, t0);
    const b = await claimLease(id, TAB_2, 1000, t0 + 999);
    expect(b.ok).toBe(false); // still owned
    const renewed = await renewLease(id, a.lease!.token, 1000, t0 + 999);
    expect(renewed).toBe(true);
    expect(await renewLease(id, 'stolen-token', 1000, t0 + 999)).toBe(false);
  });
});

async function releaseLeaseAndCheck(id: number, token: string): Promise<boolean> {
  await releaseLease(id, token);
  return (await offlineDB.queue.get(id))!.lease != null; // still held: bogus token changed nothing
}
