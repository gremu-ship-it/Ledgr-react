import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Factory } from 'lucide-react';
import { getManufacturingDashboardMetrics } from '@/dal/repositories/ManufacturingDashboardRepository';
import { formatCurrency, formatDateRange } from '@/lib/formatters';
import { ModuleCard, ModuleEmpty, ModuleError, ModuleLoading, ModuleMetrics, Metric } from './ModulePrimitives';

function currentMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: key(start), end: key(now) };
}

export function ManufacturingSummarySection({ businessId, currencyCode }: { businessId: string; currencyCode: string }) {
  const { t, i18n } = useTranslation();
  const range = currentMonthRange();
  const summary = useQuery({ queryKey: ['dashboard', 'manufacturing-summary', businessId, range], queryFn: () => getManufacturingDashboardMetrics(businessId, range.start, range.end), enabled: Boolean(businessId), staleTime: 5 * 60 * 1000 });
  const data = summary.data;
  const hasActivity = (data?.active_work_orders ?? 0) > 0 || (data?.total_output_this_period ?? 0) > 0;

  return <ModuleCard title={t('dashboard.verticals.manufacturingTitle')} href="/manufacturing" action={t('dashboard.verticals.productionDashboard')} icon={Factory} testId="manufacturing-summary-section" metadata={t('dashboard.metadata.period', { period: formatDateRange(range.start, range.end, i18n.language) })}>
    {summary.isLoading ? <ModuleLoading /> : summary.isError ? <ModuleError message={t('dashboard.verticals.manufacturingError')} retry={() => void summary.refetch()} /> : !hasActivity ? <ModuleEmpty /> : <ModuleMetrics>
      <Metric label={t('manufacturing.dashboard.activeWorkOrders')} value={String(data?.active_work_orders ?? 0)} />
      <Metric label={t('dashboard.verticals.workInProgressValue')} value={formatCurrency(data?.wip_value ?? 0, currencyCode, i18n.language)} />
      <Metric label={t('manufacturing.dashboard.outputThisPeriod')} value={Number(data?.total_output_this_period ?? 0).toLocaleString(i18n.language)} />
      <Metric label={t('manufacturing.dashboard.averageYield')} value={`${Number(data?.avg_yield_pct ?? 0).toFixed(1)}%`} />
    </ModuleMetrics>}
  </ModuleCard>;
}

