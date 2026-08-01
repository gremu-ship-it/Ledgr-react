import type { ReactNode } from 'react';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { OfflineSyncContext } from './offlineSyncContext';

/**
 * Keeps one sync controller alive for the whole signed-in app. This prevents
 * separate offline UI surfaces from starting competing sync passes.
 */
export function OfflineSyncProvider({ children }: { children: ReactNode }) {
  const syncState = useSyncQueue();
  return <OfflineSyncContext.Provider value={syncState}>{children}</OfflineSyncContext.Provider>;
}
