// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Dexie from 'dexie';
import {
  wipeIdentityTransitionCaches,
  verifyBusinessCacheEmptiness,
  WORKBOX_API_CACHE_NAME,
  RQ_PERSIST_DB_NAME,
  LEGACY_POS_QUEUE_KEY,
  OFFLINE_QUEUE_DB_NAME,
} from '@/lib/cacheWipe';
import { MemoryCacheStorage } from '@/lib/cacheWipeTestAdapters';
import { createIDBPersister } from '@/lib/queryPersister';
import { offlineDB } from '@/offline/db';

async function countRQEntries(): Promise<number> {
  const db = new Dexie(RQ_PERSIST_DB_NAME);
  await db.open();
  const n = db.tables.length === 0 ? 0 : await db.table('cache').count();
  db.close();
  return n;
}

async function deleteDb(name: string): Promise<void> {
  try {
    await Dexie.delete(name);
  } catch {
    /* ignore */
  }
}

async function seedRQEntry(): Promise<void> {
  const persister = createIDBPersister();
  await persister.persistClient({
    timestamp: Date.now(),
    buster: 'r13-test',
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ['invoices', 'list', 'r13-business'],
          queryHash: '["invoices","list","r13-business"]',
          state: { status: 'success', data: [{ id: 'r13-invoice', total: 1500 }] },
        } as never,
      ],
    },
  } as Parameters<typeof persister.persistClient>[0]);
}

describe('R09.1 cache confidentiality wipe (D-5, WIPE model)', () => {
  let memCaches: MemoryCacheStorage;

  beforeEach(async () => {
    vi.unstubAllGlobals();
    memCaches = new MemoryCacheStorage().install(globalThis as unknown as Record<string, unknown>);
    try {
      await offlineDB.open();
      await offlineDB.queue.clear();
    } catch {
      /* queue db may not exist yet */
    }
    await deleteDb(RQ_PERSIST_DB_NAME);
    window.sessionStorage.clear();
    window.localStorage.clear();
  });

  it('1. removes the persisted React Query cache after logout (verified, not assumed)', async () => {
    await seedRQEntry();
    expect(await countRQEntries()).toBeGreaterThan(0);
    const result = await wipeIdentityTransitionCaches('signed-out');
    expect(result.rqEntriesRemaining).toBe(0);
    expect((await verifyBusinessCacheEmptiness()).rqEntries).toBe(0);
    expect(result.verifiedEmpty).toBe(true);
  });

  it('2. removes the Workbox ledgr-api-cache after logout (verified absent)', async () => {
    memCaches.seed(WORKBOX_API_CACHE_NAME, ['GET /rest/v1/invoices 200 A-data']);
    const result = await wipeIdentityTransitionCaches('signed-out');
    expect(result.apiCacheStillPresent).toBe(false);
    expect(memCaches.keysOf(WORKBOX_API_CACHE_NAME)).toEqual([]);
  });

  it('3+9. a subsequent user cannot read the prior user’s cached business data (all addressed layers)', async () => {
    await seedRQEntry();
    memCaches.seed(WORKBOX_API_CACHE_NAME, ['GET /rest/v1/journal_entries 200 A-data']);
    window.sessionStorage.setItem('ledgr_tax_reminder_shown', '1');
    window.sessionStorage.setItem('ledgr_draft_invoice-form_r13-biz', JSON.stringify({ total: 1500 }));
    window.sessionStorage.setItem('ledgr_chunk_recovery_v1', '/assets/chunk-abc.js');
    await wipeIdentityTransitionCaches('user-switch');
    // "User B" reads back every surface the A session could have left.
    const probe = await verifyBusinessCacheEmptiness();
    expect(probe.rqEntries).toBe(0);
    expect(probe.apiCachePresent).toBe(false);
    expect(window.sessionStorage.length).toBe(0);
    expect(memCaches.keysOf(WORKBOX_API_CACHE_NAME)).toEqual([]);
  });

  it('4. repeated logout wipes are idempotent and safe', async () => {
    await seedRQEntry();
    const first = await wipeIdentityTransitionCaches('signed-out');
    const second = await wipeIdentityTransitionCaches('signed-out');
    expect(first.verifiedEmpty).toBe(true);
    expect(second.verifiedEmpty).toBe(true);
    expect(second.storageKeysRemoved).toEqual([]);
  });

  it('5. wipe with no existing cache succeeds safely', async () => {
    const result = await wipeIdentityTransitionCaches('signed-out');
    expect(result.verifiedEmpty).toBe(true);
    expect(result.rqEntriesRemaining).toBe(0);
    expect(result.apiCacheStillPresent).toBe(false);
  });

  it('6. ledgr_pos_offline_queue (accepted financial evidence) survives byte-identical', async () => {
    const legacy = JSON.stringify([{ receiptNumber: 'R13-LEGACY-1', payload: { total: 1500 }, queuedAt: '2026-09-20T08:00:00Z' }]);
    window.localStorage.setItem(LEGACY_POS_QUEUE_KEY, legacy);
    const result = await wipeIdentityTransitionCaches('signed-out');
    expect(window.localStorage.getItem(LEGACY_POS_QUEUE_KEY)).toBe(legacy);
    expect(result.storageKeysRemoved).not.toContain(LEGACY_POS_QUEUE_KEY);
  });

  it('7. the offline queue database (ledgr-offline) survives with every row', async () => {
    const id = await offlineDB.queue.add({
      sequence: 1,
      operationType: 'pos_sale',
      status: 'pending',
      businessId: 'r13-business',
      payload: { invoice: {}, lines: [] } as never,
      clientKey: 'r13-key-1',
      createdAt: '2026-09-22T08:00:00Z',
      attemptCount: 0,
    });
    await wipeIdentityTransitionCaches('signed-out');
    const rows = await offlineDB.queue.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].localId).toBe(id);
  });

  it('8. no wildcard deletion: non-target ledgr_* keys survive; preserved keys never enumerated', async () => {
    window.localStorage.setItem('ledgr-mobile-dashboard-preferences', '{"quickActions":[]}');
    window.localStorage.setItem('ledgr_cookie_consent', 'accepted');
    window.localStorage.setItem(LEGACY_POS_QUEUE_KEY, '[]');
    window.sessionStorage.setItem('ledgr_draft_expense-form_r13-biz', '{"amount":100}');
    const result = await wipeIdentityTransitionCaches('signed-out');
    expect(window.localStorage.getItem('ledgr-mobile-dashboard-preferences')).toBe('{"quickActions":[]}');
    expect(window.localStorage.getItem('ledgr_cookie_consent')).toBe('accepted');
    expect(result.storageKeysRemoved).toEqual(['ledgr_draft_expense-form_r13-biz']);
    for (const removed of result.storageKeysRemoved) {
      expect(removed).not.toBe(LEGACY_POS_QUEUE_KEY);
    }
  });

  it('10. repopulation race: a late put after delete is re-defeated until verified empty', async () => {
    memCaches.seed(WORKBOX_API_CACHE_NAME, ['GET /rest/v1/invoices 200 v1']);
    memCaches.scheduleRepopulate(WORKBOX_API_CACHE_NAME, ['GET /rest/v1/invoices 200 late-1']);
    memCaches.scheduleRepopulate(WORKBOX_API_CACHE_NAME, ['GET /rest/v1/invoices 200 late-2']);
    const result = await wipeIdentityTransitionCaches('signed-out');
    expect(result.apiCacheDeleteAttempts).toBeGreaterThanOrEqual(3);
    expect(result.apiCacheStillPresent).toBe(false);
    expect(result.verifiedEmpty).toBe(true);
    expect(memCaches.keysOf(WORKBOX_API_CACHE_NAME)).toEqual([]);
  });

  it('SW coordination: acknowledged when an active worker answers the flush', async () => {
    const listeners: Array<(ev: unknown) => void> = [];
    const fakeController = {
      postMessage(data: Record<string, unknown>, ports: MessagePort[]) {
        setTimeout(() => {
          expect(data.type).toBe('R09_CACHE_FLUSH');
          ports[0].postMessage({ type: 'R09_CACHE_FLUSHED', requestId: data.requestId });
        }, 0);
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { controller: fakeController, addEventListener: (_t: string, fn: never) => listeners.push(fn) },
      configurable: true,
    });
    const result = await wipeIdentityTransitionCaches('signed-out', { swFlushMaxWaitMs: 500 });
    expect(result.swFlushAcknowledged).toBe(true);
  });

  it('SW coordination: no controller is normal and never blocks or fails the wipe', async () => {
    Object.defineProperty(navigator, 'serviceWorker', { value: undefined, configurable: true });
    const result = await wipeIdentityTransitionCaches('signed-out');
    expect(result.swFlushAcknowledged).toBeNull();
    expect(result.verifiedEmpty).toBe(true);
    expect(OFFLINE_QUEUE_DB_NAME).toBe('ledgr-offline');
  });
});
