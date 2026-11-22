const DB_NAME = 'ledgr_local_erp_db';
const DB_VERSION = 1;

export interface OfflineEntity {
  business_id: string;
  table_name: string;
  id: string;
  data: Record<string, unknown>;
  updated_at: string;
}

export interface SyncQueueItem {
  id?: number;
  business_id: string;
  table_name: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'RPC';
  payload: Record<string, unknown>;
  created_at: string;
  attempts: number;
  last_error?: string;
}

let dbInstance: IDBDatabase | null = null;

export async function openLedgrLocalDb(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 1. Entity Store: [business_id, table_name, id]
      if (!db.objectStoreNames.contains('entities')) {
        const entityStore = db.createObjectStore('entities', {
          keyPath: ['business_id', 'table_name', 'id'],
        });
        entityStore.createIndex('by_business_table', ['business_id', 'table_name'], {
          unique: false,
        });
      }

      // 2. Outgoing Sync Queue Store
      if (!db.objectStoreNames.contains('sync_queue')) {
        const syncStore = db.createObjectStore('sync_queue', {
          keyPath: 'id',
          autoIncrement: true,
        });
        syncStore.createIndex('by_business', 'business_id', { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves or updates an entity in local IndexedDB.
 */
export async function putLocalEntity(entity: OfflineEntity): Promise<void> {
  const db = await openLedgrLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entities', 'readwrite');
    const store = tx.objectStore('entities');
    const req = store.put(entity);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Fetches an entity by business, table, and ID.
 */
export async function getLocalEntity(
  businessId: string,
  tableName: string,
  id: string
): Promise<OfflineEntity | null> {
  const db = await openLedgrLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entities', 'readonly');
    const store = tx.objectStore('entities');
    const req = store.get([businessId, tableName, id]);
    req.onsuccess = () => resolve((req.result as OfflineEntity) || null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Lists all entities for a table in a business.
 */
export async function listLocalEntities(
  businessId: string,
  tableName: string
): Promise<OfflineEntity[]> {
  const db = await openLedgrLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('entities', 'readonly');
    const store = tx.objectStore('entities');
    const index = store.index('by_business_table');
    const req = index.getAll(IDBKeyRange.only([businessId, tableName]));
    req.onsuccess = () => resolve((req.result as OfflineEntity[]) || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Enqueues a mutation into the sync queue.
 */
export async function enqueueSyncItem(item: Omit<SyncQueueItem, 'id'>): Promise<number> {
  const db = await openLedgrLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');
    const req = store.add(item);
    req.onsuccess = () => resolve(req.result as number);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Gets all pending sync items for a business.
 */
export async function getPendingSyncItems(businessId: string): Promise<SyncQueueItem[]> {
  const db = await openLedgrLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sync_queue', 'readonly');
    const store = tx.objectStore('sync_queue');
    const index = store.index('by_business');
    const req = index.getAll(IDBKeyRange.only(businessId));
    req.onsuccess = () => resolve((req.result as SyncQueueItem[]) || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Removes an item from the sync queue once successfully processed.
 */
export async function removeSyncItem(id: number): Promise<void> {
  const db = await openLedgrLocalDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('sync_queue', 'readwrite');
    const store = tx.objectStore('sync_queue');
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
