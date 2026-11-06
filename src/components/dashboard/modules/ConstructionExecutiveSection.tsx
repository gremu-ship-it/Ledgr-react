import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { HardHat } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { formatCurrency } from '@/lib/formatters';
import { ModuleCard, ModuleEmpty, ModuleError, ModuleLoading, ModuleMetrics, Metric } from './ModulePrimitives';

export function ConstructionExecutiveSection({ businessId, currencyCode }: { businessId: string; currencyCode: string }) {
  const { t, i18n } = useTranslation();
  const metadata = t('dashboard.metadata.asOf', { date: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) });
  const metrics = useQuery({
    queryKey: ['dashboard', 'construction-executive-v2', businessId],
    queryFn: async () => {
      const [period, portfolio] = await Promise.all([repos.projects.getDashboardMetrics(businessId), repos.projects.getPortfolioSummary(businessId)]);
      return { period, portfolio };
    },
    enabled: Boolean(businessId), staleTime: 5 * 60 * 1000,
  });
  const data = metrics.data;
  const hasActivity = (data?.portfolio.active_projects ?? 0) > 0 || (data?.portfolio.total_contract_value ?? 0) > 0;

  return <ModuleCard title={t('dashboard.verticals.constructionTitle')} href="/construction" action={t('dashboard.verticals.operationalProcurement')} icon={HardHat} testId="construction-executive-section" metadata={metadata}>
    {metrics.isLoading ? <ModuleLoading /> : metrics.isError ? <ModuleError message={t('dashboard.verticals.constructionError')} retry={() => void metrics.refetch()} /> : !hasActivity ? <ModuleEmpty /> : <>
      <ModuleMetrics>
        <Metric label={t('construction.dashboard.metrics.activeProjects')} value={String(data?.portfolio.active_projects ?? 0)} />
        <Metric label={t('dashboard.verticals.contractValue')} value={formatCurrency(data?.portfolio.total_contract_value ?? 0, currencyCode, i18n.language)} />
        <Metric label={t('dashboard.verticals.billedVsPaid')} value={formatCurrency(data?.period.total_billed_this_period ?? 0, currencyCode, i18n.language)} detail={t('dashboard.verticals.paidAmount', { amount: formatCurrency(data?.period.total_paid_this_period ?? 0, currencyCode, i18n.language) })} />
        <Metric label={t('construction.dashboard.metrics.totalRetentionHeld')} value={formatCurrency(data?.portfolio.total_retention_held ?? 0, currencyCode, i18n.language)} />
        <Metric label={t('construction.dashboard.metrics.projectsOverBudget')} value={String(data?.portfolio.projects_over_budget ?? 0)} />
      </ModuleMetrics>
      <Link className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-brand-700 hover:text-brand-900 touch-manipulation" to="/construction/projects">{t('dashboard.verticals.viewConstructionProjects')}</Link>
    </>}
  </ModuleCard>;
}
