// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { offlineDB, type QueueItem } from '@/offline/db';
import {
  LEGACY_POS_QUEUE_KEY,
  migrateLegacyPosQueue,
  readLegacyPosQueue,
} from '@/offline/legacyPosQueue';
import type { PosSalePayload } from '@/types/pos';

/**
 * Retirement of the POS module's device-local queue.
 *
 * Two stores have to be reconciled: the entries the old code left in
 * localStorage (which nothing else could read, retry or report on) and the
 * broken `income` stubs it queued into the canonical queue at the same time,
 * whose payload the sync engine could never turn into an invoice.
 */

const salePayload: PosSalePayload = {
  businessId: 'biz-legacy-1',
  branchId: null,
  items: [
    {
      product_id: 'prod-abc',
      name: 'Sugar 2kg',
      quantity: 1,
      unit_price: 4500,
      line_total: 4500,
    },
  ],
  payments: [{ payment_method: 'cash', amount: 4500, tendered: 5000 }],
  totalPaid: 5000,
  changeGiven: 500,
};

/** What the retired code wrote into localStorage. */
function legacyEntry(receiptNumber: string) {
  return {
    offlineNum: `POS-OFFLINE-${receiptNumber}`,
    receiptNumber,
    payload: salePayload,
    queuedAt: '2026-09-18T08:15:00.000Z',
  };
}

/** What the retired code wrote into the canonical queue: a receipt summary. */
function stubPayload(receiptNumber: string) {
  return {
    notes: `POS offline sale ${receiptNumber} (POS-OFFLINE-${receiptNumber})`,
    items: [{ productId: 'prod-abc', name: 'Sugar 2kg', quantity: 1, unitPrice: 4500 }],
    receiptNumber,
  };
}

async function addStub(receiptNumber: string): Promise<number> {
  const item: QueueItem = {
    sequence: 1,
    operationType: 'income',
    status: 'failed',
    businessId: 'biz-legacy-1',
    payload: stubPayload(receiptNumber) as never,
    createdAt: '2026-09-18T08:15:00.000Z',
    attemptCount: 3,
    lastError: "Cannot read properties of undefined (reading 'map')",
  };
  return (await offlineDB.queue.add(item)) as number;
}

describe('migrateLegacyPosQueue', () => {
  beforeEach(async () => {
    await offlineDB.queue.clear();
    localStorage.clear();
  });

  it('moves a retired localStorage sale onto the canonical queue', async () => {
    localStorage.setItem(LEGACY_POS_QUEUE_KEY, JSON.stringify([legacyEntry('REC-1001')]));

    const summary = await migrateLegacyPosQueue();

    expect(summary.migrated).toBe(1);
    const items = await offlineDB.queue.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      operationType: 'pos_sale',
      status: 'pending',
      businessId: 'biz-legacy-1',
      // The sale keeps the time it was actually taken, not the time it was
      // recovered.
      createdAt: '2026-09-18T08:15:00.000Z',
    });
    const payload = items[0].payload as { receiptNumber: string; invoice: { invoice_number: string } };
    expect(payload.receiptNumber).toBe('REC-1001');
    expect(payload.invoice.invoice_number).toBe('POS-OFFLINE-REC-1001');

    expect(localStorage.getItem(LEGACY_POS_QUEUE_KEY)).toBeNull();

    // Running again must not duplicate the sale.
    const second = await migrateLegacyPosQueue();
    expect(second.migrated).toBe(0);
    expect(await offlineDB.queue.count()).toBe(1);
  });

  it('repairs an unsyncable income stub in place, keeping its queue position', async () => {
    const localId = await addStub('REC-2002');
    localStorage.setItem(LEGACY_POS_QUEUE_KEY, JSON.stringify([legacyEntry('REC-2002')]));

    const summary = await migrateLegacyPosQueue();

    expect(summary.repaired).toBe(1);
    const item = await offlineDB.queue.get(localId);
    expect(item).toMatchObject({
      localId,
      sequence: 1,
      operationType: 'pos_sale',
      status: 'pending',
      attemptCount: 0,
    });
    expect(item?.lastError).toBeUndefined();
    expect((item?.payload as { receiptNumber: string }).receiptNumber).toBe('REC-2002');
    // The converted entry is not also imported as a second sale.
    expect(await offlineDB.queue.count()).toBe(1);
    expect(localStorage.getItem(LEGACY_POS_QUEUE_KEY)).toBeNull();
  });

  it('flags a stub whose sale details are gone instead of retrying it forever', async () => {
    const localId = await addStub('REC-3003');

    const summary = await migrateLegacyPosQueue();

    expect(summary.flagged).toBe(1);
    const item = await offlineDB.queue.get(localId);
    expect(item?.status).toBe('failed');
    expect(item?.lastError).toMatch(/older POS build/i);
    expect(item?.lastError).toMatch(/REC-3003/);
  });

  it('leaves real queued income entries alone', async () => {
    const localId = (await offlineDB.queue.add({
      sequence: 1,
      operationType: 'income',
      status: 'pending',
      businessId: 'biz-legacy-1',
      payload: { invoice: { business_id: 'biz-legacy-1' }, lines: [] } as never,
      createdAt: '2026-09-18T08:15:00.000Z',
      attemptCount: 0,
    })) as number;

    const summary = await migrateLegacyPosQueue();

    expect(summary).toEqual({ migrated: 0, repaired: 0, flagged: 0, discarded: 0 });
    const item = await offlineDB.queue.get(localId);
    expect(item).toMatchObject({ operationType: 'income', status: 'pending' });
  });

  it('drops an entry that has no business to file it under', async () => {
    localStorage.setItem(
      LEGACY_POS_QUEUE_KEY,
      JSON.stringify([{ ...legacyEntry('REC-4004'), payload: { ...salePayload, businessId: undefined } }]),
    );

    const summary = await migrateLegacyPosQueue();

    expect(summary.discarded).toBe(1);
    expect(await offlineDB.queue.count()).toBe(0);
  });
});

describe('readLegacyPosQueue', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ignores junk left by older builds instead of throwing', () => {
    localStorage.setItem(LEGACY_POS_QUEUE_KEY, '{not json');
    expect(readLegacyPosQueue()).toEqual([]);

    localStorage.setItem(LEGACY_POS_QUEUE_KEY, JSON.stringify([{ payload: {} }, null, 42]));
    expect(readLegacyPosQueue()).toEqual([]);
  });
});
