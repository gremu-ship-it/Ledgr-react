import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Package } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { formatCurrency } from '@/lib/formatters';
import { ModuleCard, ModuleEmpty, ModuleError, ModuleLoading, ModuleMetrics, Metric } from './ModulePrimitives';

export function InventorySummarySection({ businessId, currencyCode }: { businessId: string; currencyCode: string }) {
  const { t, i18n } = useTranslation();
  const metadata = t('dashboard.metadata.asOf', { date: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) });
  const summary = useQuery({ queryKey: ['dashboard', 'inventory-summary', businessId], queryFn: () => repos.inventory.getDashboardSummary(businessId), enabled: Boolean(businessId), staleTime: 5 * 60 * 1000 });
  const hasActivity = (summary.data?.trackedBalanceCount ?? 0) > 0;
  return <ModuleCard title={t('dashboard.verticals.inventoryTitle')} href="/warehouse" action={t('dashboard.verticals.manageInventory')} icon={Package} testId="inventory-summary-section" metadata={metadata}>
    {summary.isLoading ? <ModuleLoading /> : summary.isError ? <ModuleError message={t('dashboard.verticals.inventoryError')} retry={() => void summary.refetch()} /> : !hasActivity ? <ModuleEmpty /> : <ModuleMetrics>
      <Metric label={t('dashboard.verticals.totalStockValue')} value={formatCurrency(summary.data?.stockValue ?? 0, currencyCode, i18n.language)} />
      <Metric label={t('dashboard.verticals.lowStockCount')} value={String(summary.data?.lowStockCount ?? 0)} />
      <Metric label={t('dashboard.verticals.stockouts')} value={String(summary.data?.stockoutCount ?? 0)} />
    </ModuleMetrics>}
  </ModuleCard>;
}
