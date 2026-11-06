import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { refreshDashboardQueries } from '@/hooks/useDashboardData';

function isDashboardQuery(queryKey: readonly unknown[], businessId: string): boolean {
  const [family, scope] = queryKey;
  if (!queryKey.includes(businessId)) return false;
  if (family === 'dashboard') return true;
  if (family === 'journal') return scope === 'recent';
  if (family === 'pos') return scope === 'owner-analytics';
  if (family === 'vat' || family === 'paye') return scope === 'summary';
  return ['income', 'expenses', 'profit_loss', 'invoices', 'trend', 'reorder_alerts'].includes(String(family));
}

function latestSuccessfulDashboardUpdate(queryClient: ReturnType<typeof useQueryClient>, businessId: string): number | null {
  const timestamps = queryClient.getQueryCache().getAll()
    .filter((query) => isDashboardQuery(query.queryKey, businessId) && query.state.status === 'success')
    .map((query) => query.state.dataUpdatedAt)
    .filter((timestamp) => timestamp > 0);
  return timestamps.length ? Math.max(...timestamps) : null;
}

export function DashboardFreshnessToolbar({ businessId, compact = false }: { businessId: string; compact?: boolean }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [updatedAt, setUpdatedAt] = useState<number | null>(() => latestSuccessfulDashboardUpdate(queryClient, businessId));
  const [now, setNow] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const scheduleTimestampRefresh = () => {
      // Query-cache notifications can fire while sibling queries are being
      // created during render. Defer the state update until after that render.
      if (refreshTimer !== undefined) return;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = undefined;
        setUpdatedAt(latestSuccessfulDashboardUpdate(queryClient, businessId));
      }, 0);
    };
    const unsubscribe = queryClient.getQueryCache().subscribe(scheduleTimestampRefresh);
    const initialSync = window.setTimeout(() => {
      setUpdatedAt(latestSuccessfulDashboardUpdate(queryClient, businessId));
      setNow(Date.now());
    }, 0);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      unsubscribe();
      window.clearTimeout(initialSync);
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      window.clearInterval(timer);
    };
  }, [businessId, queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshDashboardQueries(queryClient, businessId);
    } finally {
      setRefreshing(false);
      setUpdatedAt(latestSuccessfulDashboardUpdate(queryClient, businessId));
    }
  }, [businessId, queryClient]);

  let freshness = t('dashboard.freshness.never');
  if (updatedAt) {
    const minutes = Math.max(0, Math.floor((now - updatedAt) / 60_000));
    freshness = minutes < 1 ? t('dashboard.freshness.justNow')
      : minutes < 60 ? t('dashboard.freshness.minutesAgo', { count: minutes })
        : t('dashboard.freshness.timeAt', { time: new Date(updatedAt).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' }) });
  }

  return <div className={`flex min-w-0 flex-wrap items-center gap-2 ${compact ? 'justify-between' : 'justify-end'}`}>
    <span className="inline-flex min-h-11 items-center rounded-full bg-gray-100 px-3 text-xs font-medium text-gray-600" aria-live="polite">
      {t('dashboard.freshness.lastUpdated', { time: freshness })}
    </span>
    <button type="button" onClick={() => void onRefresh()} disabled={refreshing} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-wait disabled:opacity-70 touch-manipulation" aria-label={t(refreshing ? 'dashboard.refreshing' : 'dashboard.freshness.refresh')} aria-busy={refreshing}>
      {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
      <span>{t('dashboard.freshness.refresh')}</span>
    </button>
  </div>;
}
