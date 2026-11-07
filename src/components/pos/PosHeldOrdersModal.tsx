import { useEffect, useState } from 'react';
import { PauseCircle, PlayCircle, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PosHeldOrder } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosHeldOrdersModalProps {
  open: boolean;
  orders: PosHeldOrder[];
  isLoading: boolean;
  canViewHistory: boolean;
  initialIncludeHistory?: boolean;
  currentCartIsEmpty: boolean;
  error?: string | null;
  onClose: () => void;
  onLoadOrders: (includeHistory: boolean) => Promise<void>;
  onResume: (order: PosHeldOrder) => Promise<void>;
}

export function PosHeldOrdersModal({
  open,
  orders,
  isLoading,
  canViewHistory,
  initialIncludeHistory = false,
  currentCartIsEmpty,
  error,
  onClose,
  onLoadOrders,
  onResume,
}: PosHeldOrdersModalProps) {
  const { t } = useTranslation();
  const [includeHistory, setIncludeHistory] = useState(initialIncludeHistory);
  const [resumingId, setResumingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) void onLoadOrders(includeHistory);
  }, [open, onLoadOrders, includeHistory]);

  const handleClose = () => {
    setIncludeHistory(initialIncludeHistory);
    onClose();
  };

  if (!open) return null;

  const handleResume = async (order: PosHeldOrder) => {
    if (!currentCartIsEmpty || order.status !== 'held') return;
    setResumingId(order.id);
    try {
      await onResume(order);
    } finally {
      setResumingId(null);
    }
  };

  const statusLabel = (status: PosHeldOrder['status']) =>
    status === 'held' ? t('pos.hold.statusHeld')
      : status === 'resumed' ? t('pos.hold.statusResumed')
        : t('pos.hold.statusExpired');

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-held-orders-title"
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <PauseCircle className="h-5 w-5 text-amber-600" />
            <div>
              <h2 id="pos-held-orders-title" className="text-lg font-black text-gray-900">{t('pos.hold.title')}</h2>
              <p className="text-xs text-gray-500">{t('pos.hold.shiftBoundDescription')}</p>
            </div>
          </div>
          <button type="button" onClick={handleClose} aria-label={t('pos.hold.close')} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-bold text-gray-700">{t('pos.hold.orderCount', { count: orders.length })}</p>
          <div className="flex items-center gap-2">
            {canViewHistory && (
              <button
                type="button"
                aria-pressed={includeHistory}
                onClick={() => {
                  setIncludeHistory((current) => !current);
                }}
                className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
              >
                {includeHistory ? t('pos.hold.showActive') : t('pos.hold.showHistory')}
              </button>
            )}
            <button
              type="button"
              onClick={() => void onLoadOrders(includeHistory)}
              disabled={isLoading}
              aria-label={t('pos.hold.refresh')}
              className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {!currentCartIsEmpty && (
          <p className="mx-5 mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">{t('pos.hold.clearCartToResume')}</p>
        )}
        {error && <p role="alert" className="mx-5 mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">{error}</p>}

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {isLoading && orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">{t('pos.hold.loading')}</p>
          ) : orders.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">{t(includeHistory ? 'pos.hold.noOrdersInHistory' : 'pos.hold.noActiveOrders')}</p>
          ) : orders.map((order) => {
            const createdAt = new Date(order.created_at).toLocaleString();
            const itemCount = order.cart_items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
            return (
              <article key={order.id} className="rounded-2xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-black text-gray-900">{order.reference_note}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${order.status === 'held' ? 'bg-amber-100 text-amber-800' : order.status === 'resumed' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-600'}`}>
                        {statusLabel(order.status)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {order.customer_snapshot?.name || t('pos.hold.walkInCustomer')} · {t('pos.hold.itemCount', { count: itemCount })} · {t('pos.hold.heldAt', { time: createdAt })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-black text-gray-900">{formatMwkDetailed(order.total_amount)}</p>
                    <p className="text-[11px] text-gray-500">{t('pos.hold.subtotal')}: {formatMwkDetailed(order.subtotal)}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
                  <p className="text-[11px] text-gray-500">{t('pos.hold.createdBy', { name: order.cashier_name || order.cashier_id })}</p>
                  {order.status === 'held' && (
                    <button
                      type="button"
                      disabled={!currentCartIsEmpty || resumingId === order.id}
                      onClick={() => void handleResume(order)}
                      className="flex items-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <PlayCircle className="h-4 w-4" />
                      {resumingId === order.id ? t('pos.hold.resuming') : t('pos.hold.resume')}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

interface PosHoldOrderModalProps {
  open: boolean;
  total: number;
  isSaving: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (referenceNote: string) => Promise<void>;
}

export function PosHoldOrderModal({ open, total, isSaving, error, onClose, onConfirm }: PosHoldOrderModalProps) {
  const { t } = useTranslation();
  const [referenceNote, setReferenceNote] = useState('');
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setReferenceNote('');
    setWasOpen(true);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  if (!open) return null;
  const canSubmit = referenceNote.trim().length > 0 && referenceNote.trim().length <= 120 && !isSaving;

  return (
    <div className="fixed inset-0 z-[71] flex items-center justify-center bg-black/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="pos-hold-order-title" className="w-full max-w-md rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="pos-hold-order-title" className="text-lg font-black text-gray-900">{t('pos.hold.confirmTitle')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('pos.hold.confirmDescription')}</p>
          </div>
          <button type="button" onClick={onClose} disabled={isSaving} aria-label={t('pos.hold.close')} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-50"><X className="h-5 w-5" /></button>
        </div>
        <label htmlFor="pos-hold-reference" className="mb-1 block text-xs font-bold uppercase tracking-wide text-gray-700">{t('pos.hold.referenceLabel')}</label>
        <input
          id="pos-hold-reference"
          autoFocus
          maxLength={120}
          value={referenceNote}
          onChange={(event) => setReferenceNote(event.target.value)}
          placeholder={t('pos.hold.referencePlaceholder')}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
        />
        {error && <p role="alert" className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">{error}</p>}
        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-4">
          <span className="text-xs font-semibold text-gray-500">{t('pos.hold.cartTotal')}</span>
          <span className="text-lg font-black text-gray-900">{formatMwkDetailed(total)}</span>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-600 disabled:opacity-50">{t('pos.hold.cancel')}</button>
          <button type="button" disabled={!canSubmit} onClick={() => void onConfirm(referenceNote.trim())} className="flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
            <PauseCircle className="h-4 w-4" /> {isSaving ? t('pos.hold.holding') : t('pos.hold.holdCart')}
          </button>
        </div>
      </section>
    </div>
  );
}
