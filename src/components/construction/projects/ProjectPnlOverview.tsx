import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { repos } from '@/lib/repositories';
import type {
  Project,
  ProjectCostSummary,
  ProjectPnl,
  ProjectValuationTrendPoint,
} from '@/dal/repositories/ProjectRepository';
import { PROJECT_BUTTON } from './ProjectForm';

const pk = 'construction.projects';
const rk = 'construction.reports.pnl';

function fmtNumber(value: number): string {
  return Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

function fmtPct(value: number): string {
  return `${Number(value || 0).toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}%`;
}

function costVarianceColorClass(variance: number): string {
  return variance < 0
    ? 'border-red-200 bg-red-50 text-red-800'
    : 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

function profitMarginColorClass(marginPct: number): string {
  if (marginPct > 15) return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (marginPct >= 5) return 'border-yellow-200 bg-yellow-50 text-yellow-800';
  return 'border-red-200 bg-red-50 text-red-800';
}

export function ProjectPnlOverview({
  project,
  onNotice,
}: {
  project: Project & { site_count: number; cost: ProjectCostSummary };
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation();

  const pnlQuery = useQuery<ProjectPnl | null>({
    queryKey: ['construction', 'project-pnl', project.id],
    queryFn: async () => {
      if (typeof repos.projects.getProjectPnl !== 'function') return null;
      return (await repos.projects.getProjectPnl(project.id)) ?? null;
    },
  });

  const trendQuery = useQuery<ProjectValuationTrendPoint[]>({
    queryKey: ['construction', 'project-valuation-trend', project.id],
    queryFn: async () => {
      if (typeof repos.projects.getValuationTrend !== 'function') return [];
      return (await repos.projects.getValuationTrend(project.id)) ?? [];
    },
  });

  const pnl = pnlQuery.data ?? null;
  const trend = trendQuery.data ?? [];

  const contractSum = Number(pnl?.contract_sum ?? project.contract_sum ?? 0);
  const boqTotal = Number(pnl?.boq_total ?? 0);
  const boqVariance = contractSum - boqTotal;
  const budget = Number(pnl?.budget ?? project.budget ?? 0);
  const completionPct = Number(pnl?.completion_pct ?? 0);

  const poValue = Number(project.cost?.total_po_value ?? 0);
  const issuedValue = Number(project.cost?.total_issued_value ?? 0);
  const returnedValue = Number(project.cost?.total_returned_value ?? 0);
  const netCost = Number(pnl?.total_costs ?? project.cost?.net_cost ?? 0);
  const costVariance = Number(pnl?.cost_variance ?? budget - netCost);

  const totalBilled = Number(pnl?.total_billed ?? 0);
  const billingPct = Number(
    pnl?.billing_pct ?? (contractSum > 0 ? (totalBilled / contractSum) * 100 : 0),
  );
  const totalPaid = Number(pnl?.total_paid ?? 0);
  const outstanding = totalBilled - totalPaid;

  const retentionWithheld = Number(pnl?.total_retention_withheld ?? 0);
  const retentionReleased = Number(pnl?.total_retention_released ?? 0);
  const retentionBalance = Number(
    pnl?.retention_balance ?? retentionWithheld - retentionReleased,
  );

  const grossMargin = totalBilled - netCost;
  const marginPct = Number(
    pnl?.profit_margin ?? (totalBilled > 0 ? (grossMargin / totalBilled) * 100 : 0),
  );

  const chartData = trend.map((point) => ({
    ...point,
    label: `V-${point.valuation_number}`,
    gross_amount: Number(point.gross_amount),
    retention_amount: Number(point.retention_amount),
    net_amount: Number(point.net_amount),
    cumulative_billed: Number(point.cumulative_billed),
  }));

  return (
    <div className="space-y-6" data-testid="project-pnl-report">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-900">
          {t(`${rk}.title`)}
        </h3>
        <button
          type="button"
          className={PROJECT_BUTTON}
          onClick={() => onNotice(t(`${rk}.exportComingSoon`))}
        >
          {t(`${rk}.downloadReport`)}
        </button>
      </div>

      {/* Contract & Budget */}
      <section aria-label={t(`${rk}.sections.contractAndBudget`)}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t(`${rk}.sections.contractAndBudget`)}
        </h4>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.contractSum`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(contractSum)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.boqTotal`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(boqTotal)}</p>
            <p className="mt-1 text-xs text-gray-500">
              {t(`${rk}.fields.boqVariance`, { variance: fmtNumber(boqVariance) })}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.budget`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(budget)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.completionPct`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtPct(completionPct)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${pk}.fields.retention_pct`)}</p>
            <p className="mt-2 text-xl font-semibold">
              {fmtNumber(Number(project.retention_pct))}
            </p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${pk}.siteCount`)}</p>
            <p className="mt-2 text-xl font-semibold">
              {fmtNumber(Number(project.site_count))}
            </p>
          </div>
        </div>
      </section>

      {/* Costs */}
      <section aria-label={t(`${rk}.sections.costs`)}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t(`${rk}.sections.costs`)}
        </h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.totalPoValue`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(poValue)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.totalIssued`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(issuedValue)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.totalReturned`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(returnedValue)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.netCost`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(netCost)}</p>
          </div>
          <div
            data-testid="pnl-cost-variance"
            className={`rounded-xl border p-4 ${costVarianceColorClass(costVariance)}`}
          >
            <p className="text-sm">{t(`${rk}.fields.costVariance`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(costVariance)}</p>
            <p className="mt-1 text-xs">
              {costVariance < 0
                ? t(`${rk}.legend.overBudget`)
                : t(`${rk}.legend.underBudget`)}
            </p>
          </div>
        </div>
      </section>

      {/* Revenue */}
      <section aria-label={t(`${rk}.sections.revenue`)}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t(`${rk}.sections.revenue`)}
        </h4>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.totalBilled`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(totalBilled)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.billingPct`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtPct(billingPct)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.totalPaid`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(totalPaid)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.outstanding`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(outstanding)}</p>
          </div>
        </div>
      </section>

      {/* Retention */}
      <section aria-label={t(`${rk}.sections.retention`)}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t(`${rk}.sections.retention`)}
        </h4>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.totalWithheld`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(retentionWithheld)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.totalReleased`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(retentionReleased)}</p>
          </div>
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.balanceHeld`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(retentionBalance)}</p>
          </div>
        </div>
      </section>

      {/* Profitability */}
      <section aria-label={t(`${rk}.sections.profitability`)}>
        <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t(`${rk}.sections.profitability`)}
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border p-4">
            <p className="text-sm text-gray-500">{t(`${rk}.fields.grossMargin`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtNumber(grossMargin)}</p>
          </div>
          <div
            data-testid="pnl-profit-margin"
            className={`rounded-xl border p-4 ${profitMarginColorClass(marginPct)}`}
          >
            <p className="text-sm">{t(`${rk}.fields.marginPct`)}</p>
            <p className="mt-2 text-xl font-semibold">{fmtPct(marginPct)}</p>
            <p className="mt-1 text-xs">
              {marginPct > 15
                ? t(`${rk}.legend.healthyMargin`)
                : marginPct >= 5
                  ? t(`${rk}.legend.moderateMargin`)
                  : t(`${rk}.legend.lowMargin`)}
            </p>
          </div>
        </div>
      </section>

      {/* Valuation Trend Mini-Chart */}
      <section
        aria-label={t(`${rk}.valuationTrend.title`)}
        className="rounded-xl border border-gray-200 bg-white p-4"
        data-testid="valuation-trend-section"
      >
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-gray-900">
            {t(`${rk}.valuationTrend.title`)}
          </h4>
          <p className="text-xs text-gray-500">
            {t(`${rk}.valuationTrend.subtitle`)}
          </p>
        </div>
        {chartData.length === 0 ? (
          <p className="py-4 text-sm text-gray-500">
            {t(`${rk}.valuationTrend.empty`)}
          </p>
        ) : (
          <div className="space-y-3" data-testid="valuation-trend-chart">
            <div className="h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="cumulative_billed"
                    name={t(`${rk}.valuationTrend.cumulativeBilled`)}
                    stroke="#0a7c5a"
                    strokeWidth={2.5}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-600">
                <thead>
                  <tr className="border-b">
                    <th className="py-1.5 pr-3">{t(`${rk}.valuationTrend.xAxis`)}</th>
                    <th className="py-1.5 pr-3">{t('construction.projects.valuations.fields.valuationDate')}</th>
                    <th className="py-1.5 pr-3 text-right">{t(`${rk}.valuationTrend.netAmount`)}</th>
                    <th className="py-1.5 text-right">{t(`${rk}.valuationTrend.cumulativeBilled`)}</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((point) => (
                    <tr key={point.valuation_number} className="border-b last:border-b-0">
                      <td className="py-1.5 pr-3 font-medium text-gray-900">{point.label}</td>
                      <td className="py-1.5 pr-3">{point.valuation_date}</td>
                      <td className="py-1.5 pr-3 text-right">{fmtNumber(point.net_amount)}</td>
                      <td className="py-1.5 text-right font-semibold text-gray-900">
                        {fmtNumber(point.cumulative_billed)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <p className="text-xs text-gray-500">{t(`${pk}.costNote`)}</p>
    </div>
  );
}
