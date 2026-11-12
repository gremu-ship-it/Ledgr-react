// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { offlineDB } from '@/offline/db';
import { queryClient } from '@/lib/queryClient';
import {
  createIDBPersister,
  getPersistedCacheKey,
} from '@/lib/queryPersister';
import { LEGACY_POS_QUEUE_KEY, OFFLINE_QUEUE_DB_NAME, RQ_PERSIST_DB_NAME } from '@/lib/cacheWipe';
import { useAppStore } from '@/store/useAppStore';

const userA = 'sec04-user-a';
const businessA = 'sec04-business-a';
const businessB = 'sec04-business-b';

async function deleteDatabase(name: string): Promise<void> {
  try {
    await Dexie.delete(name);
  } catch {
    // A prior test may already have removed it.
  }
}

function testClient(data: unknown) {
  return {
    timestamp: Date.now(),
    buster: 'sec04-test',
    clientState: {
      mutations: [],
      queries: [
        {
          queryKey: ['invoices', 'list', businessA],
          queryHash: JSON.stringify(['invoices', 'list', businessA]),
          state: { status: 'success', data },
        },
      ],
    },
  } as never;
}

async function withRQCacheDB<T>(work: (db: Dexie) => Promise<T>): Promise<T> {
  const db = new Dexie(RQ_PERSIST_DB_NAME);
  db.version(1).stores({ cache: 'id, updatedAt, businessId' });
  db.version(2).stores({ cache: 'id, updatedAt, businessId, userId' });
  await db.open();
  try {
    return await work(db);
  } finally {
    db.close();
  }
}

async function readRQRow(id: string) {
  return withRQCacheDB((db) => db.table('cache').get(id));
}

describe('SEC-04 principal-bound persisted cache and tenant purge', () => {
  beforeEach(async () => {
    queryClient.clear();
    useAppStore.getState().reset();
    await deleteDatabase(RQ_PERSIST_DB_NAME);
    await offlineDB.open();
    await offlineDB.queue.clear();
    window.localStorage.removeItem(LEGACY_POS_QUEUE_KEY);
  });

  it('clears the in-memory React Query cache before switching businesses', async () => {
    const membershipA = { business: { id: businessA } } as never;
    const membershipB = { business: { id: businessB } } as never;
    useAppStore.setState({
      currentUser: { id: userA } as never,
      currentBusiness: membershipA,
      businesses: [membershipA, membershipB],
    });
    queryClient.setQueryData(['invoices', 'list', businessA], [{ id: 'private-a-invoice' }]);
    queryClient.setQueryData(['sofp', businessA], { total: 2500 });

    useAppStore.getState().switchBusiness(businessB);

    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(useAppStore.getState().currentBusiness?.business.id).toBe(businessB);
    await expect(
      queryClient.fetchQuery({
        queryKey: ['invoices', 'list', businessB],
        queryFn: async () => [{ id: 'fresh-business-b-invoice' }],
      }),
    ).resolves.toEqual([{ id: 'fresh-business-b-invoice' }]);
  });

  it('uses a persisted key and metadata envelope containing both principal and business ids', async () => {
    const identity = { userId: userA, businessId: businessA };
    const persister = createIDBPersister({
      getIdentity: () => identity,
      getSessionUserId: async () => userA,
    });
    const key = getPersistedCacheKey(userA, businessA);
    await persister.persistClient(testClient([{ id: 'invoice-a' }]));

    expect(key).toBe(`rq-state-${userA}-${businessA}`);
    await expect(readRQRow(key)).resolves.toMatchObject({
      id: key,
      userId: userA,
      businessId: businessA,
    });
  });

  it.each([
    { userId: 'sec04-user-b', businessId: businessA, sessionUserId: 'sec04-user-b' },
    { userId: userA, businessId: businessB, sessionUserId: userA },
  ])('discards persisted state when $userId / $businessId differs from the stored envelope', async (mismatch) => {
    const oldPersister = createIDBPersister({
      getIdentity: () => ({ userId: userA, businessId: businessA }),
      getSessionUserId: async () => userA,
    });
    const oldKey = getPersistedCacheKey(userA, businessA);
    await oldPersister.persistClient(testClient([{ id: 'prior-tenant-invoice' }]));
    expect(await readRQRow(oldKey)).toBeDefined();

    const newPersister = createIDBPersister({
      getIdentity: () => ({ userId: mismatch.userId, businessId: mismatch.businessId }),
      getSessionUserId: async () => mismatch.sessionUserId,
    });
    await expect(newPersister.restoreClient()).resolves.toBeUndefined();
    await expect(readRQRow(oldKey)).resolves.toBeUndefined();
  });

  it.each([
    { userId: 'sec04-other-user', businessId: businessA },
    { userId: userA, businessId: 'sec04-other-business' },
  ])('rejects an envelope mismatch under the active namespace ($userId / $businessId)', async (metadata) => {
    const key = getPersistedCacheKey(userA, businessA);
    await withRQCacheDB((db) =>
      db.table('cache').put({
        id: key,
        client: JSON.stringify(testClient([{ id: 'forged-namespace-data' }])),
        updatedAt: Date.now(),
        ...metadata,
      }),
    );

    const persister = createIDBPersister({
      getIdentity: () => ({ userId: userA, businessId: businessA }),
      getSessionUserId: async () => userA,
    });
    await expect(persister.restoreClient()).resolves.toBeUndefined();
    await expect(readRQRow(key)).resolves.toBeUndefined();
  });

  it('leaves both offline financial-evidence queues intact during a tenant cache purge', async () => {
    const queueRecordId = await offlineDB.queue.add({
      sequence: 1,
      operationType: 'pos_sale',
      status: 'pending',
      businessId: businessA,
      payload: { invoice: {}, lines: [] } as never,
      clientKey: 'sec04-offline-key',
      createdAt: new Date().toISOString(),
      attemptCount: 0,
    });
    const legacyEvidence = JSON.stringify([{ receiptNumber: 'SEC04-POS-1', total: 1700 }]);
    window.localStorage.setItem(LEGACY_POS_QUEUE_KEY, legacyEvidence);

    const membershipA = { business: { id: businessA } } as never;
    const membershipB = { business: { id: businessB } } as never;
    useAppStore.setState({
      currentUser: { id: userA } as never,
      currentBusiness: membershipA,
      businesses: [membershipA, membershipB],
    });
    queryClient.setQueryData(['invoices', 'list', businessA], [{ id: 'cached-only' }]);
    useAppStore.getState().switchBusiness(businessB);

    const rows = await offlineDB.queue.toArray();
    expect(OFFLINE_QUEUE_DB_NAME).toBe('ledgr-offline');
    expect(rows).toHaveLength(1);
    expect(rows[0].localId).toBe(queueRecordId);
    expect(window.localStorage.getItem(LEGACY_POS_QUEUE_KEY)).toBe(legacyEvidence);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});
