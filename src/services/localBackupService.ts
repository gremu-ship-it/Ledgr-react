import {
  openLedgrLocalDb,
  putLocalEntity,
  type OfflineEntity,
} from '../lib/offline/indexedDbStore';

export interface LocalBackupPayload {
  version: number;
  business_id: string;
  exported_at: string;
  entities: OfflineEntity[];
}

/**
 * Exports all local data for a business to a downloadable .ledgr backup file.
 */
export async function exportLocalBackup(businessId: string): Promise<void> {
  const db = await openLedgrLocalDb();
  const allEntities: OfflineEntity[] = [];

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('entities', 'readonly');
    const store = tx.objectStore('entities');
    const req = store.openCursor();

    req.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        const entity = cursor.value as OfflineEntity;
        if (entity.business_id === businessId) {
          allEntities.push(entity);
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    req.onerror = () => reject(req.error);
  });

  const backupData: LocalBackupPayload = {
    version: 1,
    business_id: businessId,
    exported_at: new Date().toISOString(),
    entities: allEntities,
  };

  const jsonString = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `Ledgr_Backup_${businessId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.ledgr`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Restores local data from a .ledgr backup file.
 */
export async function importLocalBackup(
  businessId: string,
  backupFile: File
): Promise<number> {
  const text = await backupFile.text();
  const payload = JSON.parse(text) as LocalBackupPayload;

  if (payload.business_id !== businessId) {
    throw new Error('Backup file belongs to a different business entity.');
  }

  let restored = 0;
  for (const entity of payload.entities) {
    await putLocalEntity(entity);
    restored++;
  }

  return restored;
}
