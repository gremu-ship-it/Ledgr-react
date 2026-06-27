import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnlineStatus } from './useOnlineStatus';
import { useOfflineQueue } from './useOfflineQueue';
import { syncQueue, type SyncProgress } from '@/offline/syncEngine';
import { QUEUE_TYPE_LABELS } from '@/offline/db';

export interface SyncQueueState {
  /** True while a sync pass is actively running. */
  isSyncing: boolean;
  /** Progress of the in-flight (or most recently completed) sync pass. */
  progress: SyncProgress | null;
  /** Human label for the currently syncing item type, e.g. "Syncing invoice...". */
  currentLabel: string | null;
  /** Manually trigger a sync pass (e.g. a "Retry" button). */
  syncNow: () => Promise<void>;
}

/**
 * Drives the offline sync engine:
 * - Automatically runs a sync pass whenever the browser transitions from
 *   offline to online.
 * - Automatically runs a sync pass on mount if there's already a pending
 *   queue and the browser is online (e.g. app reopened while connected,
 *   with items queued from a previous offline session).
 * - Exposes live progress (`{ total, completed, failed }`) for a
 *   "Syncing X transactions..." indicator.
 * - Guards against overlapping sync passes (e.g. rapid online/offline
 *   flapping) with an internal in-flight ref.
 */
export function useSyncQueue(): SyncQueueState {
  const isOnline = useOnlineStatus();
  const { pendingCount } = useOfflineQueue();

  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const inFlightRef = useRef(false);
  const wasOnlineRef = useRef(isOnline);

  const syncNow = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsSyncing(true);

    try {
      await syncQueue((p) => setProgress({ ...p }));
    } finally {
      setIsSyncing(false);
      inFlightRef.current = false;
    }
  }, []);

  // Trigger on offline -> online transition.
  useEffect(() => {
    const justCameOnline = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    if (justCameOnline) {
      void syncNow();
    }
  }, [isOnline, syncNow]);

  // Trigger once on mount if already online and there's a backlog
  // (e.g. app was closed while offline, reopened later while connected).
  useEffect(() => {
    if (isOnline && pendingCount > 0 && !inFlightRef.current) {
      void syncNow();
    }
    // Only run this check once on mount — subsequent pending-count changes
    // shouldn't re-trigger here (the online-transition effect above and
    // explicit user actions cover those cases), avoiding a sync-on-every-
    // enqueue loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentLabel = progress?.current
    ? `Syncing ${QUEUE_TYPE_LABELS[progress.current as keyof typeof QUEUE_TYPE_LABELS] ?? progress.current}...`
    : null;

  return { isSyncing, progress, currentLabel, syncNow };
}