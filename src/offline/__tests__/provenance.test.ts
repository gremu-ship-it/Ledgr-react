// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { offlineDB, type QueueItem } from '@/offline/db';
import { enqueue } from '@/offline/queueApi';
import { syncQueue } from '@/offline/syncEngine';
import {
  QUEUE_PAYLOAD_VERSION,
  hasTrustworthyProvenance,
  replayViolation,
  sweepUnverifiableItems,
  quarantineItem,
} from '@/offline/provenance';
import { useAppStore } from '@/store/useAppStore';
import { getInstallId } from '@/offline/deviceIdentity';

const USER_A = { id: 'r09-user-a', email: 'a@r13.test', profile: null };
const USER_B = { id: 'r09-user-b', email: 'b@r13.test', profile: null };

function seedUser(user: typeof USER_A | null): void {
  useAppStore.setState({ currentUser: user });
}

async function addExpense(originUser: typeof USER_A | null = USER_A): Promise<number> {
  seedUser(originUser);
  return enqueue('expense', 'r13-biz', {
    expense: { business_id: 'r13-biz', expense_date: '2026-09-22', total: 5000 },
    lines: [],
  } as never);
}

/** v1-shape row: no provenance, as an actual pre-v2 database stored it. */
async function addV1Row(): Promise<number> {
  const item: QueueItem = {
    sequence: 99,
    operationType: 'expense',
    status: 'pending',
    businessId: 'r13-biz',
    payload: { expense: {}, lines: [] } as never,
    createdAt: '2026-09-01T08:00:00.000Z',
    attemptCount: 0,
    clientKey: crypto.randomUUID(),
  };
  return offlineDB.queue.add(item) as Promise<number>;
}

describe('R09.2 provenance capture (tests 1–5)', () => {
  beforeEach(async () => {
    await offlineDB.open();
    await offlineDB.queue.clear();
    localStorage.clear();
  });

  it('1+2. a new queue item records origin user and origin device identity', async () => {
    const id = await addExpense();
    const item = (await offlineDB.queue.get(id))!;
    expect(item.originUserId).toBe(USER_A.id);
    expect(item.originDeviceId).toBe(getInstallId());
    expect(item.originDeviceId).not.toBe(USER_A.id); // never a user alone
  });

  it('3+4. payload version and capture timestamp are recorded', async () => {
    const before = new Date(Date.now() - 1000).toISOString();
    const id = await addExpense();
    const item = (await offlineDB.queue.get(id))!;
    expect(item.payloadVersion).toBe(QUEUE_PAYLOAD_VERSION);
    expect(item.capturedAt!).toSatisfy((t: string) => t >= before);
  });

  it('5. business/branch/shift context is preserved where the payload carries it', async () => {
    const id = await enqueue('pos_sale', 'r13-biz', {
      invoice: { business_id: 'r13-biz', branch_id: 'r13-branch-7' },
      lines: [], payments: [],
      customer: { name: 'Walk-in' },
      shiftId: 'r13-shift-9',
      cashSales: 100, otherSales: 0,
      receiptNumber: 'RC-1',
      cashierId: USER_A.id, cashierName: 'Cashier',
      isCreditSale: false, total: 100, itemCount: 1,
    } as never);
    const item = (await offlineDB.queue.get(id))!;
    expect(item.businessId).toBe('r13-biz');
    expect(item.branchId).toBe('r13-branch-7');
    expect(item.shiftId).toBe('r13-shift-9');
    // No terminal context in the payload — recorded honestly as absent.
    expect(item.terminalId).toBeNull();
  });

  it('enqueue without an authenticated capture user records null provenance (never fabricated)', async () => {
    const id = await addExpense(null);
    const item = (await offlineDB.queue.get(id))!;
    expect(item.originUserId).toBeNull();
    expect(hasTrustworthyProvenance(item)).toBe(false);
  });
});

describe('R09.2 actor binding at replay gate (tests 7–12 pure parts)', () => {
  beforeEach(async () => {
    await offlineDB.open();
    await offlineDB.queue.clear();
  });

  it('7. same-user items pass the gate (Case A, May enter the normal replay path)', async () => {
    const id = await addExpense();
    const item = (await offlineDB.queue.get(id))!;
    expect(replayViolation(item, USER_A.id)).toBeNull();
    const sweep = await sweepUnverifiableItems(USER_A.id);
    expect(sweep).toEqual({ actorMismatch: 0, missingProvenance: 0, staleVersion: 0, unknownVersion: 0 });
    expect((await offlineDB.queue.get(id))!.status).toBe('pending');
  });

  it('8. different user: quarantined before any network submission (Case B)', async () => {
    const id = await addExpense(); // captured by A
    const sweep = await sweepUnverifiableItems(USER_B.id);
    expect(sweep.actorMismatch).toBe(1);
    const item = (await offlineDB.queue.get(id))!;
    expect(item.status).toBe('quarantined');
    expect(item.quarantineReason).toBe('actor-mismatch');
    // Evidence untouched: payload + provenance preserved verbatim.
    expect(item.payload).toMatchObject({ expense: { business_id: 'r13-biz' } });
    expect(item.originUserId).toBe(USER_A.id);
  });

  it('9. a forged origin_user_id cannot widen anything: it only mismatches more users', async () => {
    const id = await addExpense();
    // Attacker edits the row to claim another user as origin.
    await offlineDB.queue.update(id, { originUserId: 'admin-user-uuid' } as never);
    const item = (await offlineDB.queue.get(id))!;
    expect(replayViolation(item, USER_A.id)).toBe('actor-mismatch');
    // ...and the real server's auth.uid() still governs authorization.
  });

  it('10. missing provenance is quarantined (Case C, incl. v1 legacy rows)', async () => {
    const id = await addV1Row();
    const sweep = await sweepUnverifiableItems(USER_A.id);
    expect(sweep.missingProvenance).toBe(1);
    const item = (await offlineDB.queue.get(id))!;
    expect(item.status).toBe('quarantined');
    expect(item.quarantineReason).toBe('missing-provenance');
  });

  it('11. a quarantined item is never automatically retried by the sync loop', async () => {
    const id = await addExpense();
    await quarantineItem(id, 'missing-provenance', 'test hold');
    seedUser(USER_A);
    const progress = await syncQueue(undefined, { currentUserId: USER_A.id });
    expect(progress.total).toBe(0); // quarantined rows are not selected at all
    expect((await offlineDB.queue.get(id))!.status).toBe('quarantined');
  });

  it('12. a reload does not release quarantine into replay (durable state)', async () => {
    const id = await addExpense();
    await quarantineItem(id, 'legacy', 'reload test');
    await offlineDB.close();
    await offlineDB.open(); // simulated restart/reload
    const item = (await offlineDB.queue.get(id))!;
    expect(item.status).toBe('quarantined');
    const pending = await offlineDB.queue.where('status').anyOf('pending', 'failed').count();
    expect(pending).toBe(0);
  });

  it('unknown self-actor replays nothing and mutates nothing (fail closed)', async () => {
    const id = await addExpense();
    const progress = await syncQueue(undefined, { currentUserId: null });
    expect(progress.completed).toBe(0);
    expect(progress.skipped).toBeGreaterThanOrEqual(1);
    expect((await offlineDB.queue.get(id))!.status).toBe('pending');
  });
});
