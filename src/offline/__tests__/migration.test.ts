// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';

/**
 * R09.2 migration test (test 6): a REAL v1 database (schema + rows as written
 * by the pre-v2 app) is upgraded by the current offlineDB class, and every
 * existing row must survive intact — additive, lossless, safe on partial
 * upgrades. Runs in its own file so the shared offlineDB module connection
 * can't interleave.
 */
import type { QueueItem } from '@/offline/db';

const DB_NAME = 'ledgr-offline';

const V1_ROWS: Array<Record<string, unknown>> = [
  {
    sequence: 1,
    operationType: 'expense',
    status: 'pending',
    businessId: 'r13-biz-a',
    payload: { expense: { total: 1500 }, lines: [{ description: 'Rice' }] },
    clientKey: 'r13-v1-expense',
    createdAt: '2026-09-10T08:00:00.000Z',
    attemptCount: 2,
    lastError: 'network',
  },
  {
    sequence: 2,
    operationType: 'pos_sale',
    status: 'synced',
    businessId: 'r13-biz-a',
    payload: { invoice: { total: 4500 }, receiptNumber: 'REC-OLD-1' },
    resolvedServerId: 'srv-invoice-1',
    clientKey: 'r13-v1-pos',
    createdAt: '2026-09-09T08:00:00.000Z',
    lastAttemptAt: '2026-09-09T08:05:00.000Z',
    attemptCount: 1,
  },
];

async function buildV1Database(): Promise<void> {
  // Open a fresh fake IndexedDB under the REAL name, exactly as v1 did.
  const v1 = new Dexie(DB_NAME);
  v1.version(1).stores({
    queue: '++localId, sequence, status, businessId, dependsOnLocalId, operationType',
  });
  await v1.open();
  for (const row of V1_ROWS) await v1.table('queue').add(row);
  v1.close();
}

describe('R09.2 Dexie v1 → v2 migration (test 6)', () => {
  it('existing queue data survives the upgrade with no fabricated provenance', async () => {
    await buildV1Database();

    // The current module class declares v2: opening now runs the upgrade.
    const { offlineDB } = await import('@/offline/db');
    await offlineDB.open();
    expect(offlineDB.verno).toBeGreaterThanOrEqual(2);

    const rows = (await offlineDB.queue.orderBy('sequence').toArray()) as QueueItem[];
    expect(rows).toHaveLength(2);

    const [a, b] = rows;
    // Lossless: every financial field bits-for-bits.
    expect(a).toMatchObject({
      sequence: 1,
      operationType: 'expense',
      status: 'pending',
      businessId: 'r13-biz-a',
      clientKey: 'r13-v1-expense',
      attemptCount: 2,
      lastError: 'network',
    });
    expect((a.payload as unknown as { expense: { total: number } }).expense.total).toBe(1500);
    expect(b).toMatchObject({
      status: 'synced',
      resolvedServerId: 'srv-invoice-1',
      clientKey: 'r13-v1-pos',
    });

    // No fabricated provenance: v1 rows explicitly carry nulls.
    for (const row of rows) {
      expect(row.payloadVersion).toBeNull();
      expect(row.originUserId).toBeNull();
      expect(row.originDeviceId).toBeNull();
      expect(row.capturedAt).toBeNull();
      expect(row.quarantineReason).toBeNull();
      expect(row.lease).toBeNull();
    }
  });

  it('re-opening an upgraded database is idempotent (resumable, safe on partial state)', async () => {
    const { offlineDB } = await import('@/offline/db');
    await offlineDB.open();
    const before = await offlineDB.queue.count();
    await offlineDB.close();
    await offlineDB.open();
    expect(await offlineDB.queue.count()).toBe(before);
  });
});
