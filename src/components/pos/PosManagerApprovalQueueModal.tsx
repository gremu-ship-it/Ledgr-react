import { RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PosPendingPriceOverride } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosManagerApprovalQueueModalProps {
  open: boolean;
  requests: PosPendingPriceOverride[];
  isLoading: boolean;
  approvingId: string | null;
  error?: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onAuthorize: (request: PosPendingPriceOverride) => void;
}

export function PosManagerApprovalQueueModal({
  open,
  requests,
  isLoading,
  approvingId,
  error,
  onClose,
  onRefresh,
  onAuthorize,
}: PosManagerApprovalQueueModalProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-black/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="pos-override-queue-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-brand-600" />
            <div>
              <h2 id="pos-override-queue-title" className="text-lg font-black text-gray-900">{t('pos.override.queueTitle')}</h2>
              <p className="text-xs text-gray-500">{t('pos.override.queueInstructions')}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label={t('pos.override.closeQueue')} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </header>

        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <p className="text-sm font-bold text-gray-700">{t('pos.override.pendingCount', { count: requests.length })}</p>
          <button type="button" onClick={onRefresh} disabled={isLoading} aria-label={t('pos.override.refreshQueue')} className="rounded-xl border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {error && <p role="alert" className="mx-5 mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">{error}</p>}

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {isLoading && requests.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">{t('pos.override.loadingQueue')}</p>
          ) : requests.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-500">{t('pos.override.noPendingRequests')}</p>
          ) : requests.map((request) => (
            <article key={request.id} className="rounded-2xl border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-black text-gray-900">
                    {request.kind === 'discount'
                      ? t('pos.override.discountRequest', { percent: request.max_discount_percent })
                      : t('pos.override.priceRequest', { product: request.product_name || t('pos.override.unknownProduct') })}
                  </h3>
                  <p className="mt-1 text-xs text-gray-600">{request.reason || t('pos.override.noReason')}</p>
                  <p className="mt-1 text-[11px] text-gray-400">{t('pos.override.requestedBy', { user: request.requested_by })} · {t('pos.override.expiresAt', { time: new Date(request.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</p>
                </div>
                <div className="text-right">
                  {request.unit_price !== null && <p className="text-sm font-black text-gray-900">{formatMwkDetailed(request.unit_price)}</p>}
                  {request.max_discount_percent !== null && <p className="text-sm font-black text-gray-900">{request.max_discount_percent}%</p>}
                </div>
              </div>
              <div className="mt-3 flex justify-end border-t border-gray-100 pt-3">
                <button type="button" disabled={approvingId === request.id} onClick={() => onAuthorize(request)} className="rounded-xl bg-brand-600 px-3 py-2 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50">
                  {approvingId === request.id ? t('pos.override.authorizing') : t('pos.override.authorizeRequest')}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
