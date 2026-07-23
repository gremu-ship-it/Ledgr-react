import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';

/**
 * Persistent top-of-app banner with three states:
 *
 * 1. Offline (regardless of queue size) — "You are offline — transactions
 *    will sync when connected."
 * 2. Online + actively syncing — "Syncing X transactions..." with a spinner.
 * 3. Online + just finished syncing with failures — a brief failure notice
 *    with a retry action.
 *
 * Renders nothing when online, not syncing, and no failed items — i.e. the
 * normal, fully-synced state stays out of the way.
 */
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const { isSyncing, progress, syncNow } = useSyncQueue();
  const { pendingCount, failedCount } = useOfflineQueue();

  if (!isOnline) {
    return (
      <div className="flex items-center justify-center gap-2 bg-warning px-4 py-2 text-sm font-medium text-white">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>You are offline — transactions will sync when connected.</span>
        {pendingCount > 0 && (
          <span className="ml-1 rounded-full bg-card/20 px-2 py-0.5 text-xs font-semibold">
            {pendingCount} queued
          </span>
        )}
      </div>
    );
  }

  if (isSyncing && progress) {
    return (
      <div className="flex items-center justify-center gap-2 bg-brand-600 px-4 py-2 text-sm font-medium text-white">
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
        <span>
          Syncing {progress.total} transaction{progress.total === 1 ? '' : 's'}...
          {progress.completed > 0 && ` (${progress.completed}/${progress.total})`}
        </span>
      </div>
    );
  }

  if (failedCount > 0) {
    return (
      <div className="flex items-center justify-center gap-3 bg-danger px-4 py-2 text-sm font-medium text-white">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          {failedCount} transaction{failedCount === 1 ? '' : 's'} failed to sync.
        </span>
        <button
          onClick={() => void syncNow()}
          className="rounded-full bg-card/20 px-3 py-0.5 text-xs font-semibold transition-colors hover:bg-card/30"
        >
          Retry
        </button>
      </div>
    );
  }

  // Briefly confirm a clean sync completion, then disappear on next render
  // once progress is cleared by the next online-status check.
  if (progress && progress.completed > 0 && progress.failed === 0 && pendingCount === 0) {
    return (
      <div className="flex items-center justify-center gap-2 bg-brand-600 px-4 py-2 text-sm font-medium text-white">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span>All transactions synced.</span>
      </div>
    );
  }

  return null;
}