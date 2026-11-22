import { evaluateLease } from './subscriptionLeaseService';
import {
  putLocalEntity,
  enqueueSyncItem,
  getPendingSyncItems,
  removeSyncItem,
} from '../lib/offline/indexedDbStore';
import { supabase } from '../lib/supabase';

/**
 * Request browser OS to protect local database against storage purges.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
    return await navigator.storage.persist();
  }
  return false;
}

/**
 * Executes a write mutation: verifies lease validity, writes locally to IndexedDB,
 * and enqueues to the offline sync queue.
 */
export async function recordLocalMutation(
  businessId: string,
  tableName: string,
  id: string,
  data: Record<string, unknown>,
  action: 'INSERT' | 'UPDATE' | 'DELETE' | 'RPC' = 'INSERT'
): Promise<void> {
  // 1. Cryptographic Lease Enforcement Guard
  const leaseEvaluation = evaluateLease(businessId);
  if (!leaseEvaluation.canWrite) {
    throw new Error(
      `Write rejected: Subscription lease is invalid or expired (Status: ${leaseEvaluation.status}). Connect to the internet to renew.`
    );
  }

  const now = new Date().toISOString();

  // 2. Write to local IndexedDB store
  await putLocalEntity({
    business_id: businessId,
    table_name: tableName,
    id,
    data,
    updated_at: now,
  });

  // 3. Enqueue to sync queue
  await enqueueSyncItem({
    business_id: businessId,
    table_name: tableName,
    action,
    payload: { id, ...data },
    created_at: now,
    attempts: 0,
  });

  // 4. If online, trigger background sync
  if (typeof navigator !== 'undefined' && navigator.onLine) {
    drainSyncQueue(businessId).catch((err) => {
      console.warn('Background sync attempt deferred:', err);
    });
  }
}

/**
 * Processes pending sync queue items against Supabase.
 */
export async function drainSyncQueue(
  businessId: string
): Promise<{ synced: number; failed: number }> {
  const pending = await getPendingSyncItems(businessId);
  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    if (!item.id) continue;
    try {
      if (item.action === 'RPC') {
        const { rpc_name, params } = item.payload as {
          rpc_name: string;
          params: Record<string, unknown>;
        };
        const { error } = await supabase.rpc(rpc_name as never, params as never);
        if (error) throw error;
      } else if (item.action === 'INSERT' || item.action === 'UPDATE') {
        const { error } = await supabase
          .from(item.table_name as never)
          .upsert(item.payload as never);
        if (error) throw error;
      } else if (item.action === 'DELETE') {
        const { error } = await supabase
          .from(item.table_name as never)
          .delete()
          .eq('id', item.payload.id as never);
        if (error) throw error;
      }

      await removeSyncItem(item.id);
      synced++;
    } catch (err) {
      console.error(`Sync error for item ${item.id}:`, err);
      failed++;
    }
  }

  return { synced, failed };
}
