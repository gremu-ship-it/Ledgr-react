import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Receipt } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { formatCurrency } from '@/lib/formatters';
import { usePosOwnerAnalytics } from '@/hooks/usePosOwnerAnalytics';
import { ModuleCard, ModuleEmpty, ModuleError, ModuleLoading, ModuleMetrics, Metric } from './ModulePrimitives';

export function PosSummarySection({ businessId, currencyCode }: { businessId: string; currencyCode: string }) {
  const { t, i18n } = useTranslation();
  const metadata = t('dashboard.metadata.asOf', { date: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) });
  const shifts = useQuery({
    queryKey: ['dashboard', 'pos-open-shift', businessId],
    queryFn: () => repos.pos.findDashboardActiveShift(businessId),
    enabled: Boolean(businessId), staleTime: 60_000,
  });
  const activeShift = shifts.data ?? null;
  // If an open shift identifies the active branch, scope the server aggregate to it.
  // With no active shift the dashboard shows the organisation-wide daily aggregate.
  const sales = usePosOwnerAnalytics(businessId, activeShift?.branch_id ?? null, 'today');
  const isLoading = sales.isLoading || shifts.isLoading;
  const isError = sales.isError || shifts.isError;
  const hasActivity = (sales.data?.order_count ?? 0) > 0 || Boolean(activeShift);

  return <ModuleCard title={t('dashboard.verticals.posTitle')} href="/pos" action={t('dashboard.verticals.openWorkspace')} icon={Receipt} testId="pos-summary-section" metadata={metadata}>
    {isLoading ? <ModuleLoading /> : isError ? <ModuleError message={t('dashboard.verticals.posError')} retry={() => { void sales.refetch(); void shifts.refetch(); }} /> : <>
      <ModuleMetrics>
        <Metric label={t('dashboard.verticals.todayNetSales')} value={formatCurrency(sales.data?.net_sales ?? 0, currencyCode, i18n.language)} />
        <Metric label={t('dashboard.verticals.ordersToday')} value={String(sales.data?.order_count ?? 0)} />
        <Metric label={t('dashboard.verticals.shiftStatus')} value={t(activeShift ? 'dashboard.verticals.shiftOpen' : 'dashboard.verticals.noActiveShift')} detail={activeShift?.shift_number ? t('dashboard.verticals.shiftNumber', { number: activeShift.shift_number }) : undefined} />
        {activeShift ? <>
          <Metric label={t('dashboard.verticals.activeCashier')} value={activeShift.cashier_name || t('dashboard.verticals.notAvailable')} />
          <Metric label={t('dashboard.verticals.openingBalance')} value={formatCurrency(activeShift.opening_cash ?? activeShift.opening_float ?? 0, currencyCode, i18n.language)} />
          <Metric label={t('dashboard.verticals.cashDrawerTotal')} value={formatCurrency(activeShift.expected_cash ?? 0, currencyCode, i18n.language)} />
        </> : null}
      </ModuleMetrics>
      {!hasActivity ? <div className="mt-3"><ModuleEmpty /></div> : null}
    </>}
  </ModuleCard>;
}
