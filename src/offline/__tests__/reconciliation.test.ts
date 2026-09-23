// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { offlineDB, type QueueItem } from '@/offline/db';
import { enqueue } from '@/offline/queueApi';
import { reconcileQueueItem, isReconcilable, getExceptionItems } from '@/offline/reconciliation';
import { useAppStore } from '@/store/useAppStore';
import type { PosSaleQueuePayload } from '@/offline/payloads';

/**
 * R09.3 Model 4 client gate: every guard is exercised against the real queue
 * store with the server transport mocked. Server-side authority itself is
 * proven against disposable PostgreSQL in tests/release/r093-reconciliation.test.ts.
 */
const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  realSupabase: { rpc: rpcMock },
  supabase: { rpc: rpcMock },
  isAbortError: () => false,
  supabaseConfigError: null,
}));

const USER = { id: 'r093-unit-user', email: 'u@r13.test', profile: null };

function posPayload(total = 1500): PosSaleQueuePayload {
  return {
    invoice: { business_id: 'r093-biz', branch_id: 'r093-branch', total_amount: total } as never,
    lines: [{ product_id: 'r093-product', quantity: 1, unit_price: total, line_total: total } as never],
    payments: [{ amount: total, payment_method: 'cash' } as never],
    customer: { name: 'R093 unit customer' },
    shiftId: 'r093-shift',
    cashSales: total,
    otherSales: 0,
    receiptNumber: `R093-U-${total}`,
    cashierId: USER.id,
    cashierName: 'R093 unit cashier',
    isCreditSale: false,
    total,
    itemCount: 1,
  };
}

async function exceptionItem(total = 1500): Promise<number> {
  const id = await enqueue('pos_sale', 'r093-biz', posPayload(total));
  await offlineDB.queue.update(id, {
    status: 'failed',
    exceptionClass: 'stock-denied',
    exceptionAt: '2026-09-23T09:00:00.000Z',
    exceptionDetails: 'R093 synthetic stock exception',
  });
  return id;
}

describe('R09.3 Model 4 reconciliation — client gate', () => {
  beforeEach(async () => {
    await offlineDB.open();
    await offlineDB.queue.clear();
    useAppStore.setState({ currentUser: USER });
    rpcMock.mockReset();
  });

  it('enqueue stamps a capture-time payload hash (64-hex) on every new item', async () => {
    const id = await enqueue('pos_sale', 'r093-biz', posPayload());
    const item = (await offlineDB.queue.get(id))!;
    expect(item.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(item.exceptionClass).toBeNull();
    expect(item.reconcileAttempts).toBe(0);
  });

  it('rejects non-exception items without touching the server', async () => {
    const id = await enqueue('pos_sale', 'r093-biz', posPayload());
    const result = await reconcileQueueItem(id, 'reason');
    expect(result.disposition).toBe('rejected');
    expect(result.code).toBe('not-an-exception');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('rejects integrity quarantines locally with zero mutation', async () => {
    const id = await enqueue('pos_sale', 'r093-biz', posPayload());
    await offlineDB.queue.update(id, {
      status: 'quarantined',
      quarantineReason: 'actor-mismatch',
      quarantinedAt: '2026-09-23T09:00:00.000Z',
    });
    const before = (await offlineDB.queue.get(id))!;
    const result = await reconcileQueueItem(id, 'reason');
    expect(result.disposition).toBe('rejected');
    expect(result.code).toBe('integrity-class');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(await offlineDB.queue.get(id)).toEqual(before);
  });

  it('requires a bounded reason', async () => {
    const id = await exceptionItem();
    expect((await reconcileQueueItem(id, '   ')).code).toBe('reason-required');
    expect((await reconcileQueueItem(id, 'x'.repeat(501))).code).toBe('reason-required');
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it('rejects non-POS operation types (stays classified, not replayable)', async () => {
    const id = await enqueue('expense', 'r093-biz', {
      expense: { business_id: 'r093-biz', expense_date: '2026-09-23', total_amount: 500 },
      lines: [],
    } as never);
    await offlineDB.queue.update(id, { status: 'failed', exceptionClass: 'policy-denied' });
    const result = await reconcileQueueItem(id, 'reason');
    expect(result.code).toBe('unsupported-operation-type');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(((await offlineDB.queue.get(id))!).exceptionClass).toBe('policy-denied');
  });

  it('a tampered exception payload becomes a payload-tampered quarantine before any call', async () => {
    const id = await exceptionItem();
    const item = (await offlineDB.queue.get(id))!;
    const tampered = JSON.parse(JSON.stringify(item.payload)) as PosSaleQueuePayload;
    tampered.total = 1;
    await offlineDB.queue.update(id, { payload: tampered });
    const result = await reconcileQueueItem(id, 'reason');
    expect(result.code).toBe('payload-tampered');
    expect(rpcMock).not.toHaveBeenCalled();
    const after = (await offlineDB.queue.get(id))!;
    expect(after.status).toBe('quarantined');
    expect(after.quarantineReason).toBe('payload-tampered');
  });

  it('accepted server decision → synced with original identity preserved and lease released', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, disposition: 'replay-accepted', document_id: 'doc-1', idempotent: false }, error: null });
    const id = await exceptionItem();
    const before = (await offlineDB.queue.get(id))!;
    const result = await reconcileQueueItem(id, ' verified restock ');
    expect(result.ok).toBe(true);
    expect(result.documentId).toBe('doc-1');
    const request = rpcMock.mock.calls[0][1].p_request;
    expect(request.client_key).toBe(before.clientKey);
    expect(request.exception_class).toBe('stock-denied');
    expect(request.origin_user_id).toBe(USER.id);
    expect(request.reason).toBe('verified restock'); // trimmed
    expect(request.payload.client_key).toBe(before.clientKey);
    const after = (await offlineDB.queue.get(id))!;
    expect(after.status).toBe('synced');
    expect(after.resolvedServerId).toBe('doc-1');
    expect(after.clientKey).toBe(before.clientKey);
    expect(after.payload).toEqual(before.payload); // never altered
    expect(after.originUserId).toBe(before.originUserId); // never replaced
    expect(after.exceptionClass).toBe('stock-denied'); // kept as evidence
    expect(after.reconcileAttempts).toBe(1);
    expect(after.lease).toBeNull();
  });

  it('denied server decision → exception restored unchanged, attempt evidenced', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, disposition: 'replay-denied', code: 'P0QLT', message: 'limit' }, error: null });
    const id = await exceptionItem();
    const before = (await offlineDB.queue.get(id))!;
    const result = await reconcileQueueItem(id, 'reason');
    expect(result.ok).toBe(false);
    expect(result.disposition).toBe('replay-denied');
    expect(result.code).toBe('P0QLT');
    const after = (await offlineDB.queue.get(id))!;
    expect(after.status).toBe('failed');
    expect(after.exceptionClass).toBe('stock-denied');
    expect(after.payload).toEqual(before.payload);
    expect(after.clientKey).toBe(before.clientKey);
    expect(after.reconcileAttempts).toBe(1);
    expect(after.lastReconcileAt).toBeTruthy();
    expect(after.lease).toBeNull();
  });

  it('server refusal (e.g. 42501) → rejected, exception restored unchanged', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    const id = await exceptionItem();
    const result = await reconcileQueueItem(id, 'reason');
    expect(result.disposition).toBe('rejected');
    expect(result.code).toBe('42501');
    const after = (await offlineDB.queue.get(id))!;
    expect(after.status).toBe('failed');
    expect(after.exceptionClass).toBe('stock-denied');
    expect(after.lease).toBeNull();
  });

  it('getExceptionItems surfaces exactly the live typed exceptions', async () => {
    const a = await exceptionItem(100);
    await exceptionItem(200);
    await enqueue('pos_sale', 'r093-biz', posPayload(300)); // plain pending
    const items = await getExceptionItems('r093-biz');
    expect(items.map((i) => i.localId)).toEqual([a, expect.any(Number)]);
    expect(items.every((i) => isReconcilable(i))).toBe(true);
  });
});

describe('R09.3 reconcilable predicate', () => {
  it('only failed items carrying a typed exception are reconcilable', () => {
    const base = { status: 'failed', exceptionClass: 'stock-denied' } as QueueItem;
    expect(isReconcilable(base)).toBe(true);
    expect(isReconcilable({ ...base, status: 'pending' })).toBe(false);
    expect(isReconcilable({ ...base, exceptionClass: null })).toBe(false);
    expect(isReconcilable({ ...base, exceptionClass: 'policy-denied' })).toBe(true);
  });
});
