import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useOnlineStatus } from './useOnlineStatus';
import { syncQueue, type SyncProgress } from '@/offline/syncEngine';
import { getPendingCount } from '@/offline/queueApi';
import { QUEUE_TYPE_LABELS } from '@/offline/db';
import { invalidateAfterSync } from '@/lib/queryInvalidation';
import { isServiceWorkerSyncRequest } from '@/offline/backgroundSync';
import { migrateLegacyPosQueue } from '@/offline/legacyPosQueue';

export interface SyncQueueState {
  /** True while a sync pass is actively running. */
  isSyncing: boolean;
  /** Progress of the in-flight (or most recently completed) sync pass. */
  progress: SyncProgress | null;
  /** Human label for the currently syncing item type, e.g. "Syncing invoice...". */
  currentLabel: string | null;
  /**
   * Manually trigger a sync pass (e.g. a "Retry" button). Resolves with the
   * pass's result so a caller can report it, or null when a pass was already
   * running and this call was a no-op.
   */
  syncNow: () => Promise<SyncProgress | null>;
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
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();

  const [isSyncing, setIsSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress | null>(null);

  const inFlightRef = useRef(false);
  const wasOnlineRef = useRef(isOnline);

  const syncNow = useCallback(async () => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setIsSyncing(true);

    try {
      const res = await syncQueue((p) => setProgress({ ...p }));
      if (res.completed > 0) {
        // Refresh the caches the queue can have written to, so synced items
        // appear immediately. Scoped rather than a blanket invalidate: the
        // queue only flushes expenses and invoices, so payroll, team, partner
        // and settings data cannot have changed.
        invalidateAfterSync(queryClient);
      }
      return res;
    } finally {
      setIsSyncing(false);
      inFlightRef.current = false;
    }
  }, [queryClient]);

  // Trigger on offline -> online transition.
  useEffect(() => {
    const justCameOnline = isOnline && !wasOnlineRef.current;
    wasOnlineRef.current = isOnline;

    if (justCameOnline) {
      void syncNow();
    }
  }, [isOnline, syncNow]);

  // Chromium's Background Sync wakes the service worker when connectivity
  // returns. The worker cannot safely perform our semantic accounting writes
  // without the current app/auth context, so it asks an open client to run the
  // same idempotent queue processor used by the online-event fallback.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleServiceWorkerMessage = (event: MessageEvent<unknown>) => {
      if (isOnline && isServiceWorkerSyncRequest(event.data)) {
        void syncNow();
      }
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
    };
  }, [isOnline, syncNow]);

  // On mount: reconcile the retired POS queue, then flush any backlog left by
  // a previous session (app closed while offline, reopened while connected).
  //
  // The migration has to run first. Queued items from an older POS build are
  // *unsyncable as written*, and a sync pass that ran before the repair would
  // mark them failed with a misleading error — which is exactly the "needs
  // attention" state users could not act on.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const migration = await migrateLegacyPosQueue().catch((err: unknown) => {
        // Never block syncing on the cleanup of an old local store.
        console.warn('Could not reconcile the retired POS offline queue', err);
        return null;
      });
      if (cancelled) return;
      if (migration && (migration.migrated > 0 || migration.repaired > 0)) {
        console.info('Recovered offline POS sales into the sync queue', migration);
      }

      const pending = await getPendingCount();
      if (!cancelled && isOnline && pending > 0 && !inFlightRef.current) {
        void syncNow();
      }
    })();
    return () => {
      cancelled = true;
    };
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