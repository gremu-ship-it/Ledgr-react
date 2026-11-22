import React from 'react';
import { AlertTriangle, ShieldAlert, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSubscriptionLease } from '../../hooks/useSubscriptionLease';

interface SubscriptionLeaseBannerProps {
  businessId: string | null | undefined;
}

export const SubscriptionLeaseBanner: React.FC<SubscriptionLeaseBannerProps> = ({
  businessId,
}) => {
  const { t } = useTranslation();
  const { evaluation, isRefreshing, refresh } = useSubscriptionLease(businessId);

  if (
    evaluation.status !== 'GRACE_PERIOD' &&
    evaluation.status !== 'EXPIRED' &&
    evaluation.status !== 'CLOCK_TAMPERED'
  ) {
    return null;
  }

  const isGrace = evaluation.status === 'GRACE_PERIOD';

  const message = isGrace
    ? t('subscription.errors.gracePeriodWarning', {
        days: evaluation.daysRemaining,
      })
    : evaluation.status === 'CLOCK_TAMPERED'
      ? t('subscription.errors.clockTampered')
      : t('subscription.errors.leaseExpired');

  const handleRefresh = () => {
    void refresh().catch(() => {
      // Handled by evaluation state
    });
  };

  return (
    <div
      role="alert"
      className={
        isGrace
          ? 'flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900'
          : 'flex items-center justify-between gap-3 border-b border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900'
      }
    >
      <div className="flex items-center gap-2.5">
        {isGrace ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
        ) : (
          <ShieldAlert className="h-4 w-4 shrink-0 text-red-600" aria-hidden="true" />
        )}
        <span>{message}</span>
      </div>

      <button
        type="button"
        onClick={handleRefresh}
        disabled={isRefreshing}
        className={
          isGrace
            ? 'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50'
            : 'inline-flex shrink-0 items-center gap-1.5 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-50'
        }
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
          aria-hidden="true"
        />
        <span>{t('subscription.lease.refreshButton')}</span>
      </button>
    </div>
  );
};
