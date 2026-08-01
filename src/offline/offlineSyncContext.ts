import { createContext, useContext } from 'react';
import type { SyncQueueState } from '@/hooks/useSyncQueue';

export const OfflineSyncContext = createContext<SyncQueueState | null>(null);

export function useOfflineSync(): SyncQueueState {
  const syncState = useContext(OfflineSyncContext);
  if (!syncState) {
    throw new Error('useOfflineSync must be used within OfflineSyncProvider.');
  }
  return syncState;
}
