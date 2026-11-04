import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { HardHat } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import {
  PROJECT_STATUSES,
  type ConstructionDashboardMetrics,
  type Project,
  type ProjectCostBreakdownRow,
  type ProjectStatus,
  type ProjectValuationDocument,
  type ProjectValuationTrendPoint,
  type RetentionAgingRow,
} from '@/dal/repositories/ProjectRepository';
import { ErrorBanner, LoadingBlock } from '../constructionUi';
import { ProjectStatusBadge } from '../projects/ProjectsSection';
import { PROJECT_BUTTON } from '../projects/ProjectForm';

function retentionAgeRowClass(daysHeld: number): string {
  if (daysHeld > 365) return 'bg-red-50 text-red-900';
  if (daysHeld > 180) return 'bg-yellow-50 text-yellow-900';
  return '';
}

function retentionAgeBadgeClass(daysHeld: number): string {
  if (daysHeld > 365) return 'bg-red-100 text-red-800 font-semibold';
  if (daysHeld > 180) return 'bg-yellow-100 text-yellow-800 font-semibold';
  return 'bg-gray-100 text-gray-700';
}

const dk = 'construction.dashboard';
const pk = 'construction.projects';

export type DashboardDateRange = '3m' | '6m' | '12m' | 'all';

const DATE_RANGE_MONTHS: Record<DashboardDateRange, number | null> = {
  '3m': 3,
  '6m': 6,
  '12m': 12,
  all: null,
};

const STATUS_CHART_COLORS: Record<ProjectStatus, string> = {
  tender: '#6b7280',
  active: '#16a34a',
  practical_completion: '#2563eb',
  defect_liability: '#ca8a04',
  closed: '#1f2937',
};

function formatCurrency(value: number, currency = 'MWK'): string {
  const formatted = Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${formatted}`;
}

export function ConstructionDashboard({
  businessId: propBusinessId,
}: {
  businessId?: string;
} = {}) {
  const { t } = useTranslation();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = propBusinessId ?? currentBusiness?.business?.id ?? '';
  const businessName = currentBusiness?.business?.name ?? '';
  const currency =
    (currentBusiness?.business as { base_currency?: string } | undefined)
      ?.base_currency ?? 'MWK';

  const [dateRange, setDateRange] = useState<DashboardDateRange>('12m');
  const months = DATE_RANGE_MONTHS[dateRange];

  const projectsQuery = useQuery({
    queryKey: ['construction', 'dashboard-projects', businessId],
    queryFn: () => repos.projects.list(businessId),
    enabled: Boolean(businessId),
  });

  const metricsQuery = useQuery<ConstructionDashboardMetrics>({
    queryKey: ['construction', 'dashboard-metrics', businessId, months],
    queryFn: () =>
      months === 12
        ? repos.projects.getDashboardMetrics(businessId)
        : repos.projects.getDashboardMetrics(businessId, months),
    enabled: Boolean(businessId),
  });

  const costBreakdownQuery = useQuery<ProjectCostBreakdownRow[]>({
    queryKey: ['construction', 'dashboard-cost-breakdown', businessId],
    queryFn: () => repos.projects.getCostBreakdownByProject(businessId),
    enabled: Boolean(businessId),
  });

  const retentionAgingQuery = useQuery<RetentionAgingRow[]>({
    queryKey: ['construction', 'dashboard-retention-aging', businessId],
    queryFn: () => repos.projects.getRetentionAging(businessId),
    enabled: Boolean(businessId),
  });

  const projects: Project[] = useMemo(
    () => projectsQuery.data?.rows ?? [],
    [projectsQuery.data],
  );

  const activeProjectIds = useMemo(
    () =>
      projects
        .filter((project) => project.status === 'active')
        .map((project) => project.id),
    [projects],
  );

  const billingTrendQuery = useQuery({
    queryKey: [
      'construction',
      'dashboard-billing-progress',
      businessId,
      activeProjectIds,
      months,
    ],
    queryFn: async () => {
      if (
        !activeProjectIds.length ||
        typeof repos.projects.getValuationTrend !== 'function'
      ) {
        return [] as Array<{ month: string; cumulative_billed: number }>;
      }
      const trends = await Promise.all(
        activeProjectIds.map((projectId) =>
          repos.projects.getValuationTrend(projectId).catch(() => [] as ProjectValuationTrendPoint[]),
        ),
      );
      const sinceDate =
        months != null
          ? (() => {
              const d = new Date();
              d.setMonth(d.getMonth() - months);
              return d.toISOString().slice(0, 10);
            })()
          : null;

      const byMonth = new Map<string, number>();
      for (const projectTrend of trends) {
        for (const point of projectTrend) {
          if (sinceDate && point.valuation_date < sinceDate) continue;
          const monthKey = String(point.valuation_date).slice(0, 7);
          byMonth.set(
            monthKey,
            (byMonth.get(monthKey) ?? 0) + Number(point.net_amount || 0),
          );
        }
      }

      const sortedMonths = [...byMonth.keys()].sort();
      let running = 0;
      return sortedMonths.map((month) => {
        running += byMonth.get(month) ?? 0;
        return { month, cumulative_billed: Number(running.toFixed(2)) };
      });
    },
    enabled: Boolean(businessId),
  });

  const recentActivityQuery = useQuery({
    queryKey: [
      'construction',
      'dashboard-recent-activity',
      businessId,
      projects.map((p) => p.id),
    ],
    queryFn: async () => {
      if (
        !projects.length ||
        typeof repos.projects.getValuationHistory !== 'function'
      ) {
        return { valuations: [], invoices: [] };
      }
      const histories = await Promise.all(
        projects.slice(0, 10).map(async (project) => {
          try {
            const history = await repos.projects.getValuationHistory(project.id);
            return {
              project,
              valuations: history?.valuations ?? [],
            };
          } catch {
            return { project, valuations: [] as ProjectValuationDocument[] };
          }
        }),
      );

      const allValuations = histories.flatMap(({ project, valuations }) =>
        valuations.map((doc) => ({
          projectName: project.name,
          projectId: project.id,
          valuationNumber: doc.valuation.valuation_number,
          amount: Number(doc.valuation.net_amount || 0),
          date: doc.valuation.valuation_date,
          status: doc.valuation.status,
          invoice: doc.invoice,
        })),
      );

      const recentValuations = [...allValuations]
        .sort((a, b) => b.date.localeCompare(a.date) || b.valuationNumber - a.valuationNumber)
        .slice(0, 5);

      const recentInvoices = allValuations
        .filter((item) => item.invoice != null)
        .sort((a, b) => b.date.localeCompare(a.date) || b.valuationNumber - a.valuationNumber)
        .slice(0, 5);

      return { valuations: recentValuations, invoices: recentInvoices };
    },
    enabled: Boolean(businessId) && projects.length > 0,
  });

  const statusBreakdown = useMemo(() => {
    const counts: Record<ProjectStatus, number> = {
      tender: 0,
      active: 0,
      practical_completion: 0,
      defect_liability: 0,
      closed: 0,
    };
    for (const project of projects) {
      if (project.status in counts) {
        counts[project.status] += 1;
      }
    }
    return PROJECT_STATUSES.map((status) => ({
      status,
      label: t(`${pk}.statuses.${status}`),
      count: counts[status],
      color: STATUS_CHART_COLORS[status],
    }));
  }, [projects, t]);

  if (projectsQuery.isLoading || metricsQuery.isLoading) {
    return <LoadingBlock label={t(`${dk}.loading`)} />;
  }

  if (projectsQuery.isError) {
    return (
      <ErrorBanner
        message={
          projectsQuery.error instanceof Error
            ? projectsQuery.error.message
            : t(`${pk}.error`)
        }
      />
    );
  }

  if (metricsQuery.isError) {
    return (
      <ErrorBanner
        message={
          metricsQuery.error instanceof Error
            ? metricsQuery.error.message
            : t(`${pk}.error`)
        }
      />
    );
  }

  const metrics: ConstructionDashboardMetrics = metricsQuery.data ?? {
    active_projects: 0,
    total_contract_value: 0,
    total_billed_this_period: 0,
    total_paid_this_period: 0,
    total_costs_this_period: 0,
    total_retention_held: 0,
    outstanding_receivables: 0,
    projects_over_budget: 0,
    avg_completion_pct: 0,
  };

  const topCosts = (costBreakdownQuery.data ?? []).slice(0, 5);
  const retentionRows = retentionAgingQuery.data ?? [];
  const billingProgress = billingTrendQuery.data ?? [];
  const recentValuations = recentActivityQuery.data?.valuations ?? [];
  const recentInvoices = recentActivityQuery.data?.invoices ?? [];

  const noProjects =
    projects.length === 0 &&
    Number(metrics.active_projects) === 0 &&
    Number(metrics.total_contract_value) === 0;

  const hasValuations =
    Number(metrics.total_billed_this_period) > 0 ||
    Number(metrics.total_retention_held) > 0 ||
    billingProgress.length > 0 ||
    recentValuations.length > 0;

  return (
    <div className="space-y-6" data-testid="construction-dashboard">
      {/* Header & Date Range Filter */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <HardHat className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">
              {t(`${dk}.title`)}
            </h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {businessName
                ? t(`${dk}.subtitle`, { business: businessName })
                : t(`${dk}.subtitleDefault`)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span>{t(`${dk}.dateRange.label`)}</span>
            <select
              aria-label={t(`${dk}.dateRange.label`)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900"
              value={dateRange}
              onChange={(event) =>
                setDateRange(event.target.value as DashboardDateRange)
              }
            >
              <option value="3m">{t(`${dk}.dateRange.3m`)}</option>
              <option value="6m">{t(`${dk}.dateRange.6m`)}</option>
              <option value="12m">{t(`${dk}.dateRange.12m`)}</option>
              <option value="all">{t(`${dk}.dateRange.all`)}</option>
            </select>
          </label>
          <Link to="/construction/projects" className={PROJECT_BUTTON}>
            {t(`${dk}.openProjects`)}
          </Link>
        </div>
      </div>

      {noProjects ? (
        <div
          className="rounded-2xl border border-gray-200 bg-white p-8 text-center"
          data-testid="construction-dashboard-empty-projects"
        >
          <p className="text-base font-medium text-gray-700">
            {t(`${pk}.empty`)}
          </p>
          <div className="mt-4">
            <Link to="/construction/projects" className={PROJECT_BUTTON}>
              {t(`${pk}.new`)}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {!hasValuations && (
            <div
              className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
              data-testid="construction-dashboard-no-valuations"
            >
              {t(`${dk}.noValuationsPrompt`)}
            </div>
          )}

          {/* Row 1 — Key Metric Cards */}
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6"
            data-testid="construction-dashboard-metrics"
          >
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                {t(`${dk}.metrics.activeProjects`)}
              </p>
              <p
                className="mt-2 text-2xl font-extrabold text-gray-900"
                data-testid="metric-active-projects"
              >
                {Number(metrics.active_projects)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t(`${dk}.metrics.avgCompletion`, {
                  pct: Number(metrics.avg_completion_pct || 0).toLocaleString(
                    undefined,
                    { maximumFractionDigits: 2 },
                  ),
                })}
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                {t(`${dk}.metrics.totalContractValue`)}
              </p>
              <p
                className="mt-2 text-xl font-extrabold text-gray-900"
                data-testid="metric-contract-value"
              >
                {formatCurrency(Number(metrics.total_contract_value), currency)}
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                {t(`${dk}.metrics.billedThisPeriod`)}
              </p>
              <p
                className="mt-2 text-xl font-extrabold text-gray-900"
                data-testid="metric-billed-period"
              >
                {formatCurrency(
                  Number(metrics.total_billed_this_period),
                  currency,
                )}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {t(`${dk}.metrics.paidThisPeriod`, {
                  amount: formatCurrency(
                    Number(metrics.total_paid_this_period),
                    currency,
                  ),
                })}
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                {t(`${dk}.metrics.outstandingReceivables`)}
              </p>
              <p
                className="mt-2 text-xl font-extrabold text-gray-900"
                data-testid="metric-outstanding-receivables"
              >
                {formatCurrency(
                  Number(metrics.outstanding_receivables),
                  currency,
                )}
              </p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                {t(`${dk}.metrics.totalRetentionHeld`)}
              </p>
              <p
                className="mt-2 text-xl font-extrabold text-gray-900"
                data-testid="metric-retention-held"
              >
                {formatCurrency(Number(metrics.total_retention_held), currency)}
              </p>
            </div>

            <div
              data-testid="metric-over-budget-card"
              className={`rounded-2xl border p-5 shadow-sm ${
                Number(metrics.projects_over_budget) > 0
                  ? 'border-red-300 bg-red-50 text-red-900'
                  : 'border-gray-200 bg-white text-gray-900'
              }`}
            >
              <p
                className={`text-xs font-bold uppercase tracking-wider ${
                  Number(metrics.projects_over_budget) > 0
                    ? 'text-red-700'
                    : 'text-gray-400'
                }`}
              >
                {t(`${dk}.metrics.projectsOverBudget`)}
              </p>
              <p
                className={`mt-2 text-2xl font-extrabold ${
                  Number(metrics.projects_over_budget) > 0
                    ? 'text-red-700'
                    : 'text-gray-900'
                }`}
                data-testid="metric-over-budget"
              >
                {Number(metrics.projects_over_budget)}
              </p>
              <p className="mt-1 text-xs">
                {Number(metrics.projects_over_budget) > 0
                  ? t(`${dk}.metrics.overBudgetAlert`)
                  : t(`${dk}.metrics.withinBudget`)}
              </p>
            </div>
          </div>

          {/* Row 2 — Charts (2 columns) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Left: Billing Progress (line chart) */}
            <div
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              data-testid="chart-billing-progress"
            >
              <div className="mb-4">
                <h2 className="text-base font-bold text-gray-900">
                  {t(`${dk}.charts.billingProgress.title`)}
                </h2>
                <p className="text-xs text-gray-500">
                  {t(`${dk}.charts.billingProgress.subtitle`)}
                </p>
              </div>
              {billingProgress.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-500">
                  {t(`${dk}.charts.billingProgress.empty`)}
                </p>
              ) : (
                <div className="space-y-3">
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={billingProgress}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Line
                          type="monotone"
                          dataKey="cumulative_billed"
                          name={t(`${dk}.charts.billingProgress.seriesLabel`)}
                          stroke="#0a7c5a"
                          strokeWidth={2.5}
                          dot={{ r: 4 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <ul className="flex flex-wrap gap-3 text-xs text-gray-600">
                    {billingProgress.map((point) => (
                      <li key={point.month}>
                        <span className="font-medium text-gray-900">
                          {point.month}:
                        </span>{' '}
                        {formatCurrency(point.cumulative_billed, currency)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Right: Project Status Breakdown (donut/pie chart) */}
            <div
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              data-testid="chart-status-breakdown"
            >
              <div className="mb-4">
                <h2 className="text-base font-bold text-gray-900">
                  {t(`${dk}.charts.statusBreakdown.title`)}
                </h2>
                <p className="text-xs text-gray-500">
                  {t(`${dk}.charts.statusBreakdown.subtitle`)}
                </p>
              </div>
              <div className="grid items-center gap-4 sm:grid-cols-2">
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusBreakdown.filter((s) => s.count > 0)}
                        dataKey="count"
                        nameKey="label"
                        innerRadius={45}
                        outerRadius={75}
                      >
                        {statusBreakdown
                          .filter((s) => s.count > 0)
                          .map((entry) => (
                            <Cell key={entry.status} fill={entry.color} />
                          ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2 text-sm">
                  {statusBreakdown.map((entry) => (
                    <li
                      key={entry.status}
                      className="flex items-center justify-between"
                      data-testid={`status-breakdown-${entry.status}`}
                    >
                      <ProjectStatusBadge status={entry.status} />
                      <span className="font-semibold text-gray-900">
                        {entry.count}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Row 3 — Tables / Cost vs Budget & Retention Aging */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Left: Cost vs Budget by Project */}
            <div
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              data-testid="table-cost-vs-budget"
            >
              <div className="mb-4">
                <h2 className="text-base font-bold text-gray-900">
                  {t(`${dk}.tables.costVsBudget.title`)}
                </h2>
                <p className="text-xs text-gray-500">
                  {t(`${dk}.tables.costVsBudget.subtitle`)}
                </p>
              </div>
              {topCosts.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  {t(`${dk}.tables.costVsBudget.empty`)}
                </p>
              ) : (
                <div className="space-y-4">
                  <div className="h-48 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topCosts} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis
                          type="category"
                          dataKey="project_name"
                          width={100}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip />
                        <Legend />
                        <Bar
                          dataKey="budget"
                          name={t(`${dk}.tables.costVsBudget.columns.budget`)}
                          fill="#94a3b8"
                        />
                        <Bar
                          dataKey="net_cost"
                          name={t(
                            `${dk}.tables.costVsBudget.columns.actualCost`,
                          )}
                          fill="#0a7c5a"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b text-xs font-semibold uppercase text-gray-500">
                          <th className="p-2">
                            {t(`${dk}.tables.costVsBudget.columns.project`)}
                          </th>
                          <th className="p-2 text-right">
                            {t(`${dk}.tables.costVsBudget.columns.budget`)}
                          </th>
                          <th className="p-2 text-right">
                            {t(`${dk}.tables.costVsBudget.columns.actualCost`)}
                          </th>
                          <th className="p-2 text-right">
                            {t(`${dk}.tables.costVsBudget.columns.variance`)}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {topCosts.map((row) => {
                          const overBudget =
                            Number(row.net_cost) > Number(row.budget);
                          return (
                            <tr
                              key={row.project_id}
                              data-testid={`cost-row-${row.project_id}`}
                              className={`border-t ${
                                overBudget
                                  ? 'bg-red-50 text-red-900'
                                  : 'text-gray-900'
                              }`}
                            >
                              <td className="p-2 font-medium">
                                <Link
                                  to={`/construction/projects/${row.project_id}`}
                                  className="text-brand-700 underline"
                                >
                                  {row.project_name}
                                </Link>
                              </td>
                              <td className="p-2 text-right">
                                {formatCurrency(Number(row.budget), currency)}
                              </td>
                              <td
                                className={`p-2 text-right font-semibold ${
                                  overBudget ? 'text-red-700' : ''
                                }`}
                              >
                                {formatCurrency(Number(row.net_cost), currency)}
                              </td>
                              <td
                                className={`p-2 text-right font-semibold ${
                                  overBudget
                                    ? 'text-red-700'
                                    : 'text-emerald-700'
                                }`}
                              >
                                {formatCurrency(Number(row.variance), currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            {/* Right: Retention Aging (table) */}
            <div
              className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
              data-testid="table-retention-aging"
            >
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    {t(`${dk}.tables.retentionAging.title`)}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {t(`${dk}.tables.retentionAging.subtitle`)}
                  </p>
                </div>
                <Link
                  to="/construction/retention"
                  className="text-xs font-semibold text-brand-700 underline"
                >
                  {t(`${dk}.tables.retentionAging.viewAll`)}
                </Link>
              </div>

              {retentionRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">
                  {t(`${dk}.tables.retentionAging.empty`)}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs font-semibold uppercase text-gray-500">
                        <th className="p-2">
                          {t(`${dk}.tables.retentionAging.columns.project`)}
                        </th>
                        <th className="p-2">
                          {t(`${dk}.tables.retentionAging.columns.client`)}
                        </th>
                        <th className="p-2 text-right">
                          {t(`${dk}.tables.retentionAging.columns.balance`)}
                        </th>
                        <th className="p-2 text-right">
                          {t(`${dk}.tables.retentionAging.columns.daysHeld`)}
                        </th>
                        <th className="p-2">
                          {t(`${dk}.tables.retentionAging.columns.status`)}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {retentionRows.map((row) => (
                        <tr
                          key={row.project_id}
                          data-testid={`dashboard-retention-row-${row.project_id}`}
                          className={`border-t ${retentionAgeRowClass(Number(row.days_held))}`}
                        >
                          <td className="p-2 font-medium">
                            <Link
                              to={`/construction/projects/${row.project_id}`}
                              className="text-brand-700 underline"
                            >
                              {row.project_name}
                            </Link>
                          </td>
                          <td className="p-2">{row.client_name}</td>
                          <td className="p-2 text-right font-medium">
                            {formatCurrency(
                              Number(row.retention_balance),
                              currency,
                            )}
                          </td>
                          <td className="p-2 text-right">
                            <span
                              className={`inline-block rounded-full px-2 py-0.5 text-xs ${retentionAgeBadgeClass(Number(row.days_held))}`}
                            >
                              {row.days_held}
                            </span>
                          </td>
                          <td className="p-2">
                            <ProjectStatusBadge status={row.project_status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Row 4 — Recent Activity */}
          {(recentValuations.length > 0 || recentInvoices.length > 0) && (
            <div
              className="grid grid-cols-1 gap-4 lg:grid-cols-2"
              data-testid="construction-recent-activity"
            >
              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-base font-bold text-gray-900">
                  {t(`${dk}.recentActivity.valuationsTitle`)}
                </h2>
                {recentValuations.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {t(`${dk}.recentActivity.valuationsEmpty`)}
                  </p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs font-semibold uppercase text-gray-500">
                        <th className="p-2">
                          {t(`${dk}.recentActivity.columns.project`)}
                        </th>
                        <th className="p-2">
                          {t(`${dk}.recentActivity.columns.valuation`)}
                        </th>
                        <th className="p-2 text-right">
                          {t(`${dk}.recentActivity.columns.amount`)}
                        </th>
                        <th className="p-2">
                          {t(`${dk}.recentActivity.columns.date`)}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentValuations.map((item) => (
                        <tr
                          key={`${item.projectId}-${item.valuationNumber}`}
                          className="border-t"
                        >
                          <td className="p-2">{item.projectName}</td>
                          <td className="p-2">V-{item.valuationNumber}</td>
                          <td className="p-2 text-right">
                            {formatCurrency(item.amount, currency)}
                          </td>
                          <td className="p-2">{item.date}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <h2 className="mb-3 text-base font-bold text-gray-900">
                  {t(`${dk}.recentActivity.invoicesTitle`)}
                </h2>
                {recentInvoices.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    {t(`${dk}.recentActivity.invoicesEmpty`)}
                  </p>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b text-xs font-semibold uppercase text-gray-500">
                        <th className="p-2">
                          {t(`${dk}.recentActivity.columns.project`)}
                        </th>
                        <th className="p-2">
                          {t(`${dk}.recentActivity.columns.invoice`)}
                        </th>
                        <th className="p-2 text-right">
                          {t(`${dk}.recentActivity.columns.amount`)}
                        </th>
                        <th className="p-2">
                          {t(`${dk}.recentActivity.columns.status`)}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentInvoices.map((item) => (
                        <tr
                          key={`${item.projectId}-${item.valuationNumber}-${item.invoice?.id}`}
                          className="border-t"
                        >
                          <td className="p-2">{item.projectName}</td>
                          <td className="p-2">
                            {item.invoice?.invoice_number}
                          </td>
                          <td className="p-2 text-right">
                            {formatCurrency(item.amount, currency)}
                          </td>
                          <td className="p-2">{item.invoice?.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
