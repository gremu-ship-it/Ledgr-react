import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { GitCompare, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { ConstructionChangeOrderRow, ConstructionChangeOrderStatus } from '@/dal/repositories/ConstructionChangeOrderRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { loadAllProjects } from './changeOrderPageData';

const EMPTY_CHANGE_ORDERS: ConstructionChangeOrderRow[] = [];
const STATUSES: ConstructionChangeOrderStatus[] = ['draft', 'submitted', 'approved', 'rejected', 'cancelled'];
const STATUS_CLASSES: Record<ConstructionChangeOrderStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  submitted: 'bg-blue-100 text-blue-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-slate-100 text-slate-700',
};

function formatCurrency(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function signedCurrency(value: number, currency: string, locale: string): string {
  const formatted = formatCurrency(value, currency, locale);
  return value > 0 ? `+${formatted}` : formatted;
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function knownStatus(status: string): ConstructionChangeOrderStatus {
  return STATUSES.includes(status as ConstructionChangeOrderStatus)
    ? status as ConstructionChangeOrderStatus
    : 'draft';
}

export function ChangeOrderListPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentBusiness = useAppStore((state) => state.currentBusiness?.business ?? null);
  const businessId = currentBusiness?.id ?? null;
  const currency = currentBusiness?.base_currency ?? 'MWK';
  const [projectId, setProjectId] = useState('all');
  const [status, setStatus] = useState<'all' | ConstructionChangeOrderStatus>('all');

  const projectsQuery = useQuery({
    queryKey: ['construction', 'change-order-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const changeOrdersQuery = useQuery({
    queryKey: ['construction', 'changeOrders', businessId],
    queryFn: () => repos.changeOrder.list(businessId as string),
    enabled: Boolean(businessId),
  });
  const summaryQuery = useQuery({
    queryKey: ['construction', 'changeOrderSummary', businessId, projectId],
    queryFn: () => repos.changeOrder.getProjectSummary(businessId as string, projectId),
    enabled: Boolean(businessId && projectId !== 'all'),
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const projectById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const changeOrders = changeOrdersQuery.data ?? EMPTY_CHANGE_ORDERS;
  const filtered = changeOrders.filter((changeOrder) =>
    (projectId === 'all' || changeOrder.project_id === projectId)
      && (status === 'all' || changeOrder.status === status),
  );
  const isLoading = projectsQuery.isLoading || changeOrdersQuery.isLoading;
  const hasError = projectsQuery.isError || changeOrdersQuery.isError;

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('changeOrders.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('changeOrders.overview')}</p>
        </div>
        <Button type="button" onClick={() => navigate('/construction/change-orders/new')}>
          <Plus className="h-4 w-4" aria-hidden="true" />{t('changeOrders.new')}
        </Button>
      </header>

      <section aria-label={t('changeOrders.filters.title')} className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.project')}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            <option value="all">{t('changeOrders.filters.allProjects')}</option>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.status')}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={status} onChange={(event) => setStatus(event.target.value as 'all' | ConstructionChangeOrderStatus)}>
            <option value="all">{t('changeOrders.filters.allStatuses')}</option>
            {STATUSES.map((value) => <option key={value} value={value}>{t(`changeOrders.statuses.${value}`)}</option>)}
          </select>
        </label>
      </section>

      {hasError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('changeOrders.errors.load')}</p> : null}
      {isLoading ? <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t('changeOrders.loading')}</div> : null}

      {projectId !== 'all' && !summaryQuery.isError ? (
        <section aria-label={t('changeOrders.projectSummary')} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900">{t('changeOrders.projectSummary')}</h2>
          {summaryQuery.isLoading ? <p className="mt-3 text-sm text-gray-500">{t('changeOrders.loadingSummary')}</p> : null}
          {summaryQuery.data ? (
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-gray-600">{t('changeOrders.totalCostImpact')}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{signedCurrency(summaryQuery.data.total_cost_impact, currency, i18n.language)}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-600">{t('changeOrders.totalTimeImpact')}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{summaryQuery.data.total_time_impact_days > 0 ? '+' : ''}{summaryQuery.data.total_time_impact_days}</dd>
              </div>
            </dl>
          ) : null}
          {summaryQuery.isError ? <p role="alert" className="mt-3 text-sm text-red-700">{t('changeOrders.errors.summary')}</p> : null}
        </section>
      ) : null}

      {!isLoading && !hasError && filtered.length === 0 ? (
        <EmptyState
          icon={GitCompare}
          title={t('changeOrders.empty')}
          description={t('changeOrders.emptyDescription')}
          actionLabel={t('changeOrders.new')}
          onAction={() => navigate('/construction/change-orders/new')}
          variant="default"
        />
      ) : null}

      {!isLoading && !hasError && filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-4 py-3">{t('changeOrders.columns.number')}</th>
                <th scope="col" className="px-4 py-3">{t('changeOrders.columns.title')}</th>
                <th scope="col" className="px-4 py-3">{t('changeOrders.columns.project')}</th>
                <th scope="col" className="px-4 py-3">{t('changeOrders.columns.status')}</th>
                <th scope="col" className="px-4 py-3 text-right">{t('changeOrders.columns.costImpact')}</th>
                <th scope="col" className="px-4 py-3 text-right">{t('changeOrders.columns.timeImpact')}</th>
                <th scope="col" className="px-4 py-3">{t('changeOrders.columns.created')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((changeOrder) => {
                const rowStatus = knownStatus(changeOrder.status);
                const costImpact = Number(changeOrder.cost_impact ?? 0);
                const timeImpact = Number(changeOrder.time_impact_days ?? 0);
                return (
                  <tr
                    key={changeOrder.id}
                    role="link"
                    tabIndex={0}
                    aria-label={t('changeOrders.open', { number: changeOrder.co_number })}
                    className="cursor-pointer hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
                    onClick={() => navigate(`/construction/change-orders/${changeOrder.id}`)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(`/construction/change-orders/${changeOrder.id}`);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-brand-700">{changeOrder.co_number}</td>
                    <td className="min-w-56 px-4 py-3 text-gray-900">{changeOrder.title}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{projectById.get(changeOrder.project_id) ?? t('common.unknown')}</td>
                    <td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[rowStatus]}`}>{t(`changeOrders.statuses.${rowStatus}`)}</span></td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${costImpact > 0 ? 'text-emerald-700' : costImpact < 0 ? 'text-red-700' : 'text-gray-700'}`}>{signedCurrency(costImpact, currency, i18n.language)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{timeImpact > 0 ? '+' : ''}{timeImpact}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDate(changeOrder.created_at, i18n.language)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}
