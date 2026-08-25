import { useEffect, useId, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  CloudOff,
  CloudUpload,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useOfflineQueue } from '@/hooks/useOfflineQueue';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useOfflineSync } from '@/offline/offlineSyncContext';
import { announce } from '@/lib/a11y';
import { QUEUE_TYPE_LABELS, type QueueItem, type QueueItemStatus } from '@/offline/db';
import { removeQueueItem } from '@/offline/queueApi';
import { useAppStore } from '@/store/useAppStore';

const STATUS_STYLES: Record<QueueItemStatus, { label: string; className: string }> = {
  pending: { label: 'Queued', className: 'bg-amber-100 text-amber-900' },
  syncing: { label: 'Syncing', className: 'bg-blue-100 text-blue-900' },
  synced: { label: 'Synced', className: 'bg-emerald-100 text-emerald-900' },
  failed: { label: 'Needs attention', className: 'bg-red-100 text-red-900' },
};

function formatQueuedAt(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return 'Unknown time';
  return parsed.toLocaleString('en-MW', { dateStyle: 'medium', timeStyle: 'short' });
}

function QueueRow({ item, onDiscard, canDiscard }: {
  item: QueueItem;
  onDiscard: (item: QueueItem) => void;
  canDiscard: boolean;
}) {
  const status = STATUS_STYLES[item.status];
  const label = QUEUE_TYPE_LABELS[item.operationType];

  return (
    <li className="border-b border-gray-100 px-5 py-4 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          {item.status === 'synced' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <CloudUpload className="h-4 w-4" aria-hidden="true" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold capitalize text-gray-900">{label}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${status.className}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-600">Queued {formatQueuedAt(item.createdAt)}</p>
          {item.status === 'failed' && (
            <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-5 text-red-800">
              {item.lastError || 'This change could not be synced. Retry when your connection is stable.'}
            </p>
          )}
          {item.attemptCount > 0 && item.status !== 'synced' && (
            <p className="mt-1 text-[11px] text-gray-500">
              {item.attemptCount} sync attempt{item.attemptCount === 1 ? '' : 's'}
            </p>
          )}
        </div>
        {canDiscard && (
          <button
            type="button"
            onClick={() => onDiscard(item)}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-700"
            aria-label={`Discard queued ${label}`}
            title="Discard this queued change"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {!canDiscard && item.status !== 'synced' && (
        <p className="mt-2 pl-11 text-[11px] text-gray-500">
          This change is needed by another queued item and cannot be discarded yet.
        </p>
      )}
    </li>
  );
}

/** A header-triggered drawer for reviewing and managing locally queued offline changes. */
export function OfflineQueueDrawer() {
  const { items, pendingCount, failedCount } = useOfflineQueue();
  const userId = useAppStore((state) => state.currentUser?.id);
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id);
  const isOnline = useOnlineStatus();
  const { isSyncing, progress, syncNow } = useOfflineSync();
  const [isOpen, setIsOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState<number | null>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const visibleItems = [...items].sort((a, b) => b.sequence - a.sequence);
  const activeItems = visibleItems.filter((item) => item.status !== 'synced');
  const syncedItems = visibleItems.filter((item) => item.status === 'synced');

  useEffect(() => {
    if (!isOpen) return;

    closeButtonRef.current?.focus();
    const triggerButton = openButtonRef.current;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      triggerButton?.focus();
    };
  }, [isOpen]);

  function closeDrawer() {
    setIsOpen(false);
  }

  async function handleRetry() {
    await syncNow();
    announce('Offline queue sync finished.');
  }

  async function handleDiscard(item: QueueItem) {
    if (item.localId === undefined || !userId || !businessId) return;
    const label = QUEUE_TYPE_LABELS[item.operationType];
    const confirmed = window.confirm(`Discard this queued ${label}? This cannot be undone.`);
    if (!confirmed) return;

    setIsDiscarding(item.localId);
    try {
      await removeQueueItem(item.localId, { userId, businessId });
      announce(`Queued ${label} discarded.`);
    } finally {
      setIsDiscarding(null);
    }
  }

  function canDiscard(item: QueueItem): boolean {
    if (item.status === 'syncing' || item.localId === undefined || isDiscarding === item.localId) return false;
    return !items.some((candidate) => candidate.dependsOnLocalId === item.localId && candidate.status !== 'synced');
  }

  return (
    <>
      <button
        ref={openButtonRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className="relative rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800"
        aria-label={pendingCount > 0 ? `Offline queue, ${pendingCount} change${pendingCount === 1 ? '' : 's'} pending` : 'Offline queue'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? titleId : undefined}
      >
        <CloudUpload className="h-5 w-5" aria-hidden="true" />
        {pendingCount > 0 && (
          <span className="absolute end-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[9px] font-bold text-white ring-2 ring-white" aria-hidden="true">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-slate-950/40"
            onClick={closeDrawer}
            aria-label="Close offline queue"
          />
          <aside
            id={titleId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${titleId}-heading`}
            className="absolute inset-y-0 end-0 flex w-full max-w-md flex-col bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-gray-200 px-5 py-5">
              <div>
                <div className="flex items-center gap-2">
                  <CloudUpload className="h-5 w-5 text-brand-700" aria-hidden="true" />
                  <h2 id={`${titleId}-heading`} className="text-lg font-bold text-gray-900">Offline queue</h2>
                </div>
                <p className="mt-1 text-sm text-gray-600">
                  Changes saved on this device will sync when you are connected.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                aria-label="Close offline queue"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="border-b border-gray-100 bg-gray-50 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {pendingCount === 0 ? 'All changes are synced' : `${pendingCount} change${pendingCount === 1 ? '' : 's'} waiting`}
                  </p>
                  {failedCount > 0 && <p className="mt-0.5 text-xs font-medium text-red-700">{failedCount} need{failedCount === 1 ? 's' : ''} attention</p>}
                  {!isOnline && <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-800"><CloudOff className="h-3.5 w-3.5" /> You are offline</p>}
                  {isSyncing && progress && <p className="mt-0.5 text-xs font-medium text-brand-700">Syncing {progress.completed + progress.failed} of {progress.total}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void handleRetry()}
                  disabled={!isOnline || pendingCount === 0 || isSyncing}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {isSyncing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                  {isSyncing ? 'Syncing' : 'Sync now'}
                </button>
              </div>
              <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-2.5 text-[11px] text-blue-800 leading-normal">
                <strong>Offline scope:</strong> Quick cash income/expense only; invoices, payments, and transfers require active internet connection.
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {visibleItems.length === 0 ? (
                <div className="mx-auto flex max-w-xs flex-col items-center px-6 py-20 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-6 w-6" aria-hidden="true" /></div>
                  <h3 className="mt-4 font-semibold text-gray-900">Nothing queued</h3>
                  <p className="mt-1 text-sm text-gray-600">Offline changes will appear here until they have synced.</p>
                </div>
              ) : (
                <>
                  {activeItems.length > 0 && (
                    <section aria-labelledby={`${titleId}-active`}>
                      <h3 id={`${titleId}-active`} className="bg-gray-50 px-5 py-2 text-xs font-bold uppercase tracking-wider text-gray-600">Waiting to sync</h3>
                      <ul>{activeItems.map((item) => <QueueRow key={item.localId} item={item} onDiscard={(queuedItem) => void handleDiscard(queuedItem)} canDiscard={canDiscard(item)} />)}</ul>
                    </section>
                  )}
                  {syncedItems.length > 0 && (
                    <section aria-labelledby={`${titleId}-synced`}>
                      <h3 id={`${titleId}-synced`} className="bg-gray-50 px-5 py-2 text-xs font-bold uppercase tracking-wider text-gray-600">Recently synced</h3>
                      <ul>{syncedItems.map((item) => <QueueRow key={item.localId} item={item} onDiscard={(queuedItem) => void handleDiscard(queuedItem)} canDiscard={canDiscard(item)} />)}</ul>
                    </section>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-gray-100 px-5 py-3 text-xs text-gray-500">
              <ChevronRight className="h-3.5 w-3.5 text-brand-700" aria-hidden="true" />
              Synced activity is kept on this device for up to 7 days.
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
