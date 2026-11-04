import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ArrowUpRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import type { PayrollFullCycleStatus } from '@/lib/repositories/payroll.repository';
import { formatDate, numeric, text } from './employeeUtils';
import { PayRunStatusBadge } from './payRunComponents';
import { formatPayPeriod, formatPayRunMoney } from './payRunUtils';

const PAGE_SIZE = 25;
type FilterStatus = '' | PayrollFullCycleStatus;

export function PayRunListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [status, setStatus] = useState<FilterStatus>('');
  const [page, setPage] = useState(1);

  const runsQuery = useQuery({
    queryKey: ['payroll-pay-runs', businessId, { status, page, pageSize: PAGE_SIZE }],
    enabled: Boolean(businessId),
    queryFn: () => repos.payrollFullCycle.getPayRuns(businessId, {
      status: status || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
  });

  const rows = runsQuery.data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil((runsQuery.data?.count ?? 0) / PAGE_SIZE));
  const summaryGross = rows.reduce((sum, row) => sum + numeric(row.total_gross), 0);
  const summaryNet = rows.reduce((sum, row) => sum + numeric(row.total_net), 0);

  const openPayRun = (id: unknown) => navigate(`/payroll/pay-runs/${encodeURIComponent(String(id))}`);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('payroll.payRuns')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('payroll.payRunsDescription')}</p>
        </div>
        <Button onClick={() => navigate('/payroll/pay-runs/new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('payroll.newPayRun')}
        </Button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label={t('payroll.payRunSummaries')}>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">{t('payroll.payRunsInResults')}</p>
          <p className="mt-2 text-xl font-semibold text-gray-900">{runsQuery.data?.count ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">{t('payroll.grossOnPage')}</p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-gray-900">{formatPayRunMoney(summaryGross, currency, i18n.language)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-gray-500">{t('payroll.netOnPage')}</p>
          <p className="mt-2 text-xl font-semibold tabular-nums text-gray-900">{formatPayRunMoney(summaryNet, currency, i18n.language)}</p>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm" aria-label={t('payroll.payRunFilters')}>
        <label className="flex w-full items-center gap-3 text-sm text-gray-600 sm:w-auto">
          <span className="shrink-0">{t('payroll.filterByStatus')}</span>
          <select
            value={status}
            onChange={(event) => { setStatus(event.target.value as FilterStatus); setPage(1); }}
            className="h-10 min-w-44 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            <option value="">{t('payroll.allStatuses')}</option>
            {(['draft', 'calculated', 'approved', 'posted', 'reversed'] as const).map((item) => (
              <option key={item} value={item}>{t(`payroll.${item}`)}</option>
            ))}
          </select>
        </label>
      </section>

      {runsQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.payRunsLoadFailed')}</p>}

      {runsQuery.isPending ? <TableSkeleton rows={6} /> : rows.length === 0 ? (
        <EmptyState
          title={status ? t('payroll.noPayRunsMatch') : t('payroll.noPayRunsYet')}
          description={status ? t('payroll.adjustPayRunFilters') : t('payroll.noPayRunsDescription')}
          actionLabel={!status ? t('payroll.newPayRun') : undefined}
          onAction={!status ? () => navigate('/payroll/pay-runs/new') : undefined}
          variant={status ? 'search' : 'finance'}
        />
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('payroll.period')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.periodStart')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.payDate')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.totalEmployees')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.totalGross')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.totalNetPay')}</th>
                  <th scope="col" className="px-4 py-3">{t('payroll.status')}</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">{t('payroll.openPayRun')}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((run, index) => {
                  const id = text(run.id, `pay-run-${index}`);
                  return (
                    <tr
                      key={id}
                      onClick={() => run.id && openPayRun(run.id)}
                      onKeyDown={(event) => {
                        if ((event.key === 'Enter' || event.key === ' ') && run.id) {
                          event.preventDefault();
                          openPayRun(run.id);
                        }
                      }}
                      tabIndex={0}
                      aria-label={t('payroll.openPayRunForPeriod', { period: formatPayPeriod(run.period_start, i18n.language) })}
                      className="cursor-pointer outline-none hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                    >
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium text-gray-900">{formatPayPeriod(run.period_start, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{formatDate(run.period_start, i18n.language)} – {formatDate(run.period_end, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-gray-700">{formatDate(run.pay_date, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-gray-700">{numeric(run.employee_count)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-gray-700">{formatPayRunMoney(run.total_gross, currency, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 font-medium tabular-nums text-gray-900">{formatPayRunMoney(run.total_net, currency, i18n.language)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5"><PayRunStatusBadge status={text(run.status, 'draft')} /></td>
                      <td className="px-4 py-3.5 text-right text-gray-400"><ArrowUpRight className="ml-auto h-4 w-4" aria-hidden="true" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-600">{t('payroll.pageOf', { page, total: totalPages })}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>{t('payroll.previous')}</Button>
                <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>{t('payroll.next')}</Button>
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
