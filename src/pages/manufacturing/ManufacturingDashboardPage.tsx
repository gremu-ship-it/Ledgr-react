import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PlanGate } from '@/components/billing/PlanGate';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Factory, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { getManufacturingDashboard, type DashboardRange } from '@/dal/repositories/ManufacturingDashboardRepository';
import { pushError } from '@/lib/notifications';

const tPrefix = 'manufacturing.dashboard';
type Period = 'thisWeek' | 'thisMonth' | 'thisQuarter' | 'thisYear' | 'custom';

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfWeek(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function periodRange(period: Period, customStart: string, customEnd: string, now = new Date()): DashboardRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start: Date;
  let end = today;
  let granularity: DashboardRange['granularity'] = 'day';

  if (period === 'thisWeek') {
    start = startOfWeek(today);
  } else if (period === 'thisQuarter') {
    start = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
    granularity = 'week';
  } else if (period === 'thisYear') {
    start = new Date(today.getFullYear(), 0, 1);
    granularity = 'month';
  } else if (period === 'custom') {
    start = customStart ? new Date(`${customStart}T00:00:00`) : new Date(today.getFullYear(), today.getMonth(), 1);
    end = customEnd ? new Date(`${customEnd}T00:00:00`) : today;
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
    granularity = days > 120 ? 'month' : days > 35 ? 'week' : 'day';
  } else {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  }

  // Compare the selected window with the immediately preceding window of equal length.
  const spanDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - spanDays + 1);

  return {
    startDate: dateKey(start),
    endDate: dateKey(end),
    previousStartDate: dateKey(previousStart),
    previousEndDate: dateKey(previousEnd),
    granularity,
  };
}

function formatQuantity(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatCurrency(value: number | null | undefined, currency: string): string {
  return `${currency} ${Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function yieldColor(value: number): string {
  if (value >= 95) return '#16a34a';
  if (value >= 85) return '#d97706';
  return '#dc2626';
}

function ageBucketClass(bucket: string): string {
  if (bucket === '0-7 days') return 'bg-green-100 text-green-800';
  if (bucket === '8-14 days') return 'bg-amber-100 text-amber-800';
  if (bucket === '15-30 days') return 'bg-orange-100 text-orange-800';
  return 'bg-red-100 text-red-800';
}

function statusLabelKey(status: string): string {
  const statusKey = status === 'in_progress' ? 'inProgress' : status;
  return `manufacturing.wo.status.${statusKey}`;
}

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} className="space-y-6 animate-pulse">
      <div className="h-9 w-64 rounded bg-gray-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => <div key={item} className="h-28 rounded-2xl bg-gray-200" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1].map((item) => <div key={item} className="h-80 rounded-2xl bg-gray-200" />)}
      </div>
      <div className="h-72 rounded-2xl bg-gray-200" />
    </div>
  );
}

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-gray-900">{title}</h2>
      {children}
    </section>
  );
}

export function ManufacturingDashboardPage() {
  return (
    <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.manufacturing">
      <ManufacturingDashboardPageContent />
    </PlanGate>
  );
}

function ManufacturingDashboardPageContent() {
  const { t } = useTranslation();
  const business = useAppStore((state) => state.currentBusiness?.business);
  const businessId = business?.id ?? '';
  const businessName = business?.name ?? '';
  const currency = (business as { base_currency?: string } | undefined)?.base_currency ?? 'MWK';
  const [period, setPeriod] = useState<Period>('thisMonth');
  const today = dateKey(new Date());
  const [customStart, setCustomStart] = useState(`${today.slice(0, 7)}-01`);
  const [customEnd, setCustomEnd] = useState(today);

  const range = useMemo(
    () => periodRange(period, customStart, customEnd),
    [period, customStart, customEnd],
  );
  const query = useQuery({
    queryKey: ['manufacturing', 'dashboard', businessId, range],
    queryFn: () => getManufacturingDashboard(businessId, range),
    enabled: Boolean(businessId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (query.error) {
      pushError(t(`${tPrefix}.errorTitle`), t(`${tPrefix}.errorMessage`), { businessId });
    }
  }, [query.error, businessId, t]);

  const data = query.data;
  const trend = useMemo(() => {
    const current = Number(data?.metrics.total_output_this_period ?? 0);
    const previous = Number(data?.previousMetrics.total_output_this_period ?? 0);
    return previous === 0 ? (current === 0 ? 0 : null) : ((current - previous) / previous) * 100;
  }, [data]);

  if (query.isLoading) return <div className="mx-auto max-w-[1440px] px-4 py-6"><LoadingSkeleton label={t(`${tPrefix}.loading`)} /></div>;

  if (query.isError) {
    return (
      <main className="mx-auto max-w-[1440px] px-4 py-6">
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
          <p>{t(`${tPrefix}.errorMessage`)}</p>
          <button type="button" onClick={() => void query.refetch()} className="mt-3 inline-flex items-center gap-2 font-semibold underline">
            <RefreshCw className="h-4 w-4" aria-hidden />{t(`${tPrefix}.retry`)}
          </button>
        </div>
      </main>
    );
  }

  const metrics = data?.metrics;
  const throughputData = (data?.throughput ?? []).map((row) => ({
    ...row,
    period_label: formatDate(row.period_start),
  }));
  const yields = data?.yieldByProduct ?? [];
  const wipRows = data?.wipAging ?? [];
  const varianceRows = data?.costVariance ?? [];
  const summaryRows = data?.productionSummary ?? [];

  const outputTrendLabel = trend === null
    ? t(`${tPrefix}.newOutput`)
    : `${trend > 0 ? '+' : ''}${trend.toFixed(1)}% ${t(`${tPrefix}.vsPreviousPeriod`)}`;

  return (
    <main className="mx-auto max-w-[1440px] space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Factory className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{t(`${tPrefix}.title`)}</h1>
            {businessName ? <p className="text-sm text-gray-500">{businessName}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-medium text-gray-600">
            <span>{t(`${tPrefix}.period.label`)}</span>
            <select
              aria-label={t(`${tPrefix}.period.label`)}
              value={period}
              onChange={(event) => setPeriod(event.target.value as Period)}
              className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900"
            >
              <option value="thisWeek">{t(`${tPrefix}.period.thisWeek`)}</option>
              <option value="thisMonth">{t(`${tPrefix}.period.thisMonth`)}</option>
              <option value="thisQuarter">{t(`${tPrefix}.period.thisQuarter`)}</option>
              <option value="thisYear">{t(`${tPrefix}.period.thisYear`)}</option>
              <option value="custom">{t(`${tPrefix}.period.custom`)}</option>
            </select>
          </label>
          {period === 'custom' ? (
            <>
              <label className="grid gap-1 text-xs font-medium text-gray-600">
                <span>{t(`${tPrefix}.period.from`)}</span>
                <input type="date" aria-label={t(`${tPrefix}.period.from`)} value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900" />
              </label>
              <label className="grid gap-1 text-xs font-medium text-gray-600">
                <span>{t(`${tPrefix}.period.to`)}</span>
                <input type="date" aria-label={t(`${tPrefix}.period.to`)} value={customEnd} min={customStart} max={today} onChange={(event) => setCustomEnd(event.target.value)} className="min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900" />
              </label>
            </>
          ) : null}
        </div>
      </header>

      <section aria-label={t(`${tPrefix}.summary`)} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard title={t(`${tPrefix}.activeWorkOrders`)} value={formatQuantity(metrics?.active_work_orders)} href="/manufacturing/production?status=in_progress" detail={t(`${tPrefix}.openWorkOrders`)} />
        <MetricCard
          title={t(`${tPrefix}.outputThisPeriod`)}
          value={`${formatQuantity(metrics?.total_output_this_period)} ${t(`${tPrefix}.units`)}`}
          detail={outputTrendLabel}
          trend={trend}
        />
        <MetricCard
          title={t(`${tPrefix}.averageYield`)}
          value={`${formatQuantity(metrics?.avg_yield_pct)}%`}
          accent={yieldColor(Number(metrics?.avg_yield_pct ?? 0))}
        />
        <MetricCard title={t(`${tPrefix}.wipValue`)} value={formatCurrency(metrics?.wip_value, currency)} href="#wip-aging" detail={t(`${tPrefix}.viewAging`)} />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={t(`${tPrefix}.throughputTrend`)}>
          {throughputData.length ? (
            <div className="h-72" role="img" aria-label={t(`${tPrefix}.throughputTrend`)}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={throughputData} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="period_label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Legend />
                  <Tooltip
                    labelFormatter={(label, payload) => `${label} · ${t(`${tPrefix}.workOrderCount`)}: ${payload?.[0]?.payload?.work_order_count ?? 0}`}
                    formatter={(value, name) => [formatQuantity(Number(value)), name === 'output_quantity' ? t(`${tPrefix}.output`) : t(`${tPrefix}.scrap`)]}
                  />
                  <Line type="monotone" dataKey="output_quantity" name={t(`${tPrefix}.output`)} stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="scrap_quantity" name={t(`${tPrefix}.scrap`)} stroke="#dc2626" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState>{t(`${tPrefix}.emptyThroughput`)}</EmptyState>}
        </Section>

        <Section title={t(`${tPrefix}.yieldByProduct`)}>
          {yields.length ? (
            <div className="h-72" role="img" aria-label={t(`${tPrefix}.yieldByProduct`)}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={yields} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="product_name" width={112} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => [`${formatQuantity(Number(value))}%`, t(`${tPrefix}.averageYield`)]} labelFormatter={(label, payload) => `${label} · ${t(`${tPrefix}.workOrderCount`)}: ${payload?.[0]?.payload?.work_order_count ?? 0} · ${t(`${tPrefix}.totalOutput`)}: ${formatQuantity(payload?.[0]?.payload?.total_output ?? 0)}`} />
                  <Bar dataKey="yield_pct" name={t(`${tPrefix}.averageYield`)} radius={[0, 5, 5, 0]}>
                    {yields.map((row) => <Cell key={row.product_id} fill={yieldColor(Number(row.yield_pct))} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState>{t(`${tPrefix}.emptyYield`)}</EmptyState>}
          {yields.length ? (
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-gray-600">
              {(['good', 'warning', 'poor'] as const).map((level) => (
                <span key={level} className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: level === 'good' ? '#16a34a' : level === 'warning' ? '#d97706' : '#dc2626' }} aria-hidden />
                  {t(`${tPrefix}.yieldThreshold.${level}`)}
                </span>
              ))}
            </div>
          ) : null}
        </Section>
      </div>

      <Section id="wip-aging" title={t(`${tPrefix}.wipAging`)}>
        {wipRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead><tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">{t(`${tPrefix}.workOrder`)}</th><th className="px-3 py-3">{t(`${tPrefix}.product`)}</th><th className="px-3 py-3">{t('common.status')}</th><th className="px-3 py-3">{t(`${tPrefix}.planned`)}</th><th className="px-3 py-3">{t(`${tPrefix}.completed`)}</th><th className="px-3 py-3">{t(`${tPrefix}.daysInWip`)}</th><th className="px-3 py-3">{t(`${tPrefix}.wipCost`)}</th><th className="px-3 py-3">{t(`${tPrefix}.ageBucket`)}</th>
              </tr></thead>
              <tbody>{wipRows.map((row) => (
                <tr key={row.work_order_id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-3 font-medium"><Link className="text-brand-700 hover:underline" to={`/manufacturing/production/${row.work_order_id}`}>{row.work_order_number}</Link></td>
                  <td className="px-3 py-3">{row.product_name}</td><td className="px-3 py-3">{t(statusLabelKey(row.status))}</td><td className="px-3 py-3">{formatQuantity(row.planned_quantity)}</td><td className="px-3 py-3">{formatQuantity(row.completed_quantity)}</td><td className="px-3 py-3">{formatQuantity(row.days_in_wip)}</td><td className="px-3 py-3">{formatCurrency(row.wip_cost, currency)}</td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${ageBucketClass(row.age_bucket)}`}>{t(`${tPrefix}.ageBucket.${row.age_bucket === '0-7 days' ? '0to7' : row.age_bucket === '8-14 days' ? '8to14' : row.age_bucket === '15-30 days' ? '15to30' : '30plus'}`)}</span></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState>{t(`${tPrefix}.emptyWip`)}</EmptyState>}
      </Section>

      <Section title={t(`${tPrefix}.costVariance`)}>
        {varianceRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead><tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">{t(`${tPrefix}.workOrder`)}</th><th className="px-3 py-3">{t(`${tPrefix}.product`)}</th><th className="px-3 py-3">{t(`${tPrefix}.plannedCost`)}</th><th className="px-3 py-3">{t(`${tPrefix}.actualCost`)}</th><th className="px-3 py-3">{t(`${tPrefix}.variance`)}</th><th className="px-3 py-3">{t(`${tPrefix}.variancePct`)}</th>
              </tr></thead>
              <tbody>{varianceRows.map((row) => (
                <tr key={row.work_order_id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-3 font-medium"><Link className="text-brand-700 hover:underline" to={`/manufacturing/production/${row.work_order_id}`}>{row.work_order_number}</Link></td><td className="px-3 py-3">{row.product_name}</td><td className="px-3 py-3">{formatCurrency(row.planned_cost, currency)}</td><td className="px-3 py-3">{formatCurrency(row.actual_cost, currency)}</td><td className={`px-3 py-3 font-medium ${Number(row.variance) <= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatCurrency(row.variance, currency)}</td><td className={`px-3 py-3 font-medium ${Number(row.variance_pct) <= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatQuantity(row.variance_pct)}%</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState>{t(`${tPrefix}.emptyVariance`)}</EmptyState>}
      </Section>

      <Section title={t(`${tPrefix}.productionSummary`)}>
        {summaryRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead><tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-3">{t(`${tPrefix}.product`)}</th><th className="px-3 py-3">{t(`${tPrefix}.totalPlanned`)}</th><th className="px-3 py-3">{t(`${tPrefix}.totalCompleted`)}</th><th className="px-3 py-3">{t(`${tPrefix}.totalScrapped`)}</th><th className="px-3 py-3">{t(`${tPrefix}.averageYield`)}</th><th className="px-3 py-3">{t(`${tPrefix}.totalMaterialCost`)}</th><th className="px-3 py-3">{t(`${tPrefix}.costPerUnit`)}</th><th className="px-3 py-3">{t(`${tPrefix}.workOrderCount`)}</th><th className="px-3 py-3">{t(`${tPrefix}.productionRunCount`)}</th>
              </tr></thead>
              <tbody>{summaryRows.map((row) => (
                <tr key={row.product_id} className="border-b border-gray-100 last:border-0"><td className="px-3 py-3 font-medium">{row.product_name}</td><td className="px-3 py-3">{formatQuantity(row.total_planned)}</td><td className="px-3 py-3">{formatQuantity(row.total_completed)}</td><td className="px-3 py-3">{formatQuantity(row.total_scrapped)}</td><td className="px-3 py-3">{formatQuantity(row.yield_pct)}%</td><td className="px-3 py-3">{formatCurrency(row.total_material_cost, currency)}</td><td className="px-3 py-3">{formatCurrency(row.cost_per_unit, currency)}</td><td className="px-3 py-3">{formatQuantity(row.work_order_count)}</td><td className="px-3 py-3">{formatQuantity(row.production_run_count)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState>{t(`${tPrefix}.emptyVariance`)}</EmptyState>}
      </Section>
    </main>
  );
}

function MetricCard({
  title,
  value,
  detail,
  href,
  trend,
  accent,
}: {
  title: string;
  value: string;
  detail?: string;
  href?: string;
  trend?: number | null;
  accent?: string;
}) {
  const content = (
    <>
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900" style={accent ? { color: accent } : undefined}>{value}</p>
      {detail ? <p className="mt-2 flex items-center gap-1 text-xs text-gray-500">
        {trend == null ? null : trend > 0 ? <ArrowUpRight className="h-4 w-4 text-green-700" aria-hidden /> : trend < 0 ? <ArrowDownRight className="h-4 w-4 text-red-700" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
        {detail}
      </p> : null}
    </>
  );
  const className = 'block min-h-32 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm';
  return href ? <Link to={href} className={`${className} transition hover:border-brand-300 hover:shadow`}>{content}</Link> : <article className={className}>{content}</article>;
}

function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 px-5 py-9 text-center text-sm text-gray-500">{children}</div>;
}

export default ManufacturingDashboardPage;
