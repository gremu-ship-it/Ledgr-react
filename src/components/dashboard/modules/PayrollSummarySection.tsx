import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Users } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { formatCurrency } from '@/lib/formatters';
import { ModuleCard, ModuleEmpty, ModuleError, ModuleLoading, ModuleMetrics, Metric } from './ModulePrimitives';

const RUN_STATES = ['draft', 'approved', 'paid'] as const;

export function PayrollSummarySection({ businessId, currencyCode }: { businessId: string; currencyCode: string }) {
  const { t, i18n } = useTranslation();
  const metadata = t('dashboard.metadata.asOf', { date: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) });
  const snapshot = useQuery({
    queryKey: ['dashboard', 'payroll-summary', businessId],
    queryFn: async () => {
      const [runs, returns] = await Promise.all([repos.payroll.findByBusiness(businessId), repos.taxReturn.findOpenByBusiness(businessId)]);
      const activeRun = runs.find((run) => run.status === 'draft' || run.status === 'approved');
      const latestRun = activeRun ?? runs[0] ?? null;
      const employeeCount = latestRun ? await repos.payroll.countEmployeesForRun(latestRun.id) : 0;
      const remittances = returns.filter((item) => item.tax_code === 'paye' || item.tax_code === 'tpr_pension');
      return { latestRun, employeeCount, remittances };
    },
    enabled: Boolean(businessId), staleTime: 5 * 60 * 1000,
  });
  const run = snapshot.data?.latestRun;
  const hasActivity = Boolean(run || snapshot.data?.remittances.length);
  const status = RUN_STATES.includes(run?.status as (typeof RUN_STATES)[number]) ? run?.status : 'periodEnd';

  return <ModuleCard title={t('dashboard.verticals.payrollTitle')} href="/payroll/pay-runs" action={t('dashboard.verticals.payrollWorkspaces')} icon={Users} testId="payroll-summary-section" metadata={metadata}>
    {snapshot.isLoading ? <ModuleLoading /> : snapshot.isError ? <ModuleError message={t('dashboard.verticals.payrollError')} retry={() => void snapshot.refetch()} /> : !hasActivity ? <ModuleEmpty /> : <ModuleMetrics>
      {run ? <>
        <Metric label={t('dashboard.verticals.latestPayRun')} value={run.run_number} detail={t(`dashboard.verticals.payrollStatuses.${status}`)} />
        <Metric label={t('dashboard.verticals.committedNetPayroll')} value={formatCurrency(run.total_net, currencyCode, i18n.language)} />
        <Metric label={t('dashboard.verticals.employeesInRun')} value={String(snapshot.data?.employeeCount ?? 0)} />
        <Metric label={t('dashboard.verticals.payPeriodEnd')} value={new Date(`${run.period_end}T00:00:00`).toLocaleDateString(i18n.language)} />
      </> : null}
      {snapshot.data?.remittances.length ? snapshot.data.remittances.slice(0, 2).map((item) => <Metric key={item.id} label={t('dashboard.verticals.nextRemittance', { tax: t(`dashboard.verticals.remittanceTypes.${item.tax_code}`) })} value={new Date(`${item.due_date}T00:00:00`).toLocaleDateString(i18n.language)} detail={formatCurrency(item.amount_due, currencyCode, i18n.language)} />) : <Metric label={t('dashboard.verticals.remittanceDue')} value={t('dashboard.verticals.noUpcomingRemittance')} />}
    </ModuleMetrics>}
  </ModuleCard>;
}
