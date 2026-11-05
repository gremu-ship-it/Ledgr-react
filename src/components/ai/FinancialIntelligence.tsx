import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Activity, CircleDollarSign, Clock3, Gauge, LoaderCircle, ShieldAlert, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { aiRepository } from '@/lib/repositories/aiRepository';
import type { AiFinancialSummary, CashRunwayForecast, FinancialSummaryMetrics } from '@/types/ai';

function formatMoney(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale, { maximumFractionDigits: 0 })}`;
  }
}

function formatPercent(value: number | null, locale: string, unavailable: string): string {
  return value === null ? unavailable : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`;
}

function formatRatio(value: number | null, locale: string, unavailable: string): string {
  return value === null ? unavailable : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

function FinancialMetric({ label, value, detail, icon: Icon, tone }: {
  label: string;
  value: string;
  detail?: string;
  icon: typeof Activity;
  tone: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <span className={`rounded-xl p-2 ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
      </div>
      <p className="mt-4 text-xl font-bold tabular-nums text-slate-950 sm:text-2xl">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
    </article>
  );
}

function WorkingCapitalHealth({ metrics, currency, locale }: { metrics: FinancialSummaryMetrics | CashRunwayForecast['metrics']; currency: string; locale: string }) {
  const { t } = useTranslation();
  const score = Math.max(0, Math.min(100, metrics.health_score));
  const stateKey = metrics.cash_history_days === 0 ? 'healthLimited' : score >= 80 ? 'healthStrong' : score >= 60 ? 'healthWatch' : 'healthCritical';
  const ringColor = score >= 80 ? '#059669' : score >= 60 ? '#d97706' : '#dc2626';
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div
          role="meter"
          aria-label={t('ai.summary.healthScore')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={score}
          className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full"
          style={{ background: `conic-gradient(${ringColor} ${score * 3.6}deg, #e2e8f0 0deg)` }}
        >
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-full bg-white">
            <span className="text-2xl font-bold tabular-nums text-slate-950">{score}</span>
            <span className="text-[10px] font-semibold uppercase text-slate-500">/ 100</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-800">{t('ai.summary.healthScore')}</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">{t(`ai.summary.${stateKey}`)}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{t('ai.summary.healthMethod')}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FinancialMetric label={t('ai.summary.runway')} value={metrics.runway_days === null ? t('ai.summary.runwayStable') : t('ai.summary.runwayDays', { days: Math.round(metrics.runway_days) })} icon={Clock3} tone="bg-emerald-50 text-emerald-700" />
        <FinancialMetric label={t('ai.summary.dailyBurnRate')} value={t('ai.summary.perDay', { amount: formatMoney(metrics.daily_net_burn_rate, currency, locale) })} icon={TrendingDown} tone="bg-amber-50 text-amber-700" />
        <FinancialMetric label={t('ai.summary.dso')} value={metrics.dso_days === null ? t('ai.summary.notAvailable') : t('ai.summary.daysValue', { days: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metrics.dso_days) })} icon={Wallet} tone="bg-sky-50 text-sky-700" />
        <FinancialMetric label={t('ai.summary.dpo')} value={metrics.dpo_days === null ? t('ai.summary.notAvailable') : t('ai.summary.daysValue', { days: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(metrics.dpo_days) })} icon={Clock3} tone="bg-violet-50 text-violet-700" />
        <FinancialMetric label={t('ai.summary.currentRatio')} value={formatRatio(metrics.current_ratio, locale, t('ai.summary.notAvailable'))} icon={Gauge} tone="bg-indigo-50 text-indigo-700" />
        <FinancialMetric label={t('ai.summary.quickRatio')} value={formatRatio(metrics.quick_ratio, locale, t('ai.summary.notAvailable'))} icon={CircleDollarSign} tone="bg-teal-50 text-teal-700" />
      </div>
    </section>
  );
}

function ForecastProjection({ forecast }: { forecast: CashRunwayForecast }) {
  const { t, i18n } = useTranslation();
  const values = forecast.projections.map((projection) => projection.projected_ending_cash);
  const scale = Math.max(...values.map(Math.abs), Math.abs(forecast.metrics.cash_balance), 1);
  const title = (days: number) => t(`ai.forecast.day${days}`);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><TrendingUp className="h-5 w-5" aria-hidden="true" /></span>
        <div>
          <h2 className="text-lg font-bold text-slate-950">{t('ai.forecast.title')}</h2>
          <p className="mt-1 text-sm text-slate-600">{t('ai.forecast.description')}</p>
        </div>
      </div>
      <div role="img" aria-label={t('ai.forecast.chartDescription')} className="mt-6 grid grid-cols-3 gap-3 sm:gap-5">
        {forecast.projections.map((projection) => {
          const height = Math.max(8, Math.abs(projection.projected_ending_cash) / scale * 100);
          const barColor = projection.projected_ending_cash < 0 ? 'bg-red-500' : 'bg-emerald-500';
          return (
            <div key={projection.days} className="flex min-w-0 flex-col items-center text-center">
              <p className="min-h-10 text-xs font-semibold text-slate-600 sm:text-sm">{title(projection.days)}</p>
              <div className="flex h-32 w-full items-end justify-center rounded-xl bg-slate-50 p-2">
                <div className={`w-10 rounded-t-lg ${barColor} transition-all`} style={{ height: `${height}%` }} />
              </div>
              <p className="mt-2 text-sm font-bold tabular-nums text-slate-950">{formatMoney(projection.projected_ending_cash, forecast.currency, i18n.language)}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        {forecast.projections.map((projection) => (
          <article key={`breakdown-${projection.days}`} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <h3 className="mb-3 text-sm font-bold text-slate-800">{title(projection.days)}</h3>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-slate-500">{t('ai.forecast.startingCash')}</dt><dd className="font-semibold tabular-nums text-slate-800">{formatMoney(projection.starting_cash, forecast.currency, i18n.language)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">{t('ai.forecast.expectedCollections')}</dt><dd className="font-semibold tabular-nums text-emerald-700">{formatMoney(projection.expected_collections, forecast.currency, i18n.language)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">{t('ai.forecast.expectedOutflows')}</dt><dd className="font-semibold tabular-nums text-red-700">−{formatMoney(projection.expected_outflows, forecast.currency, i18n.language)}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-slate-500">{t('ai.forecast.baselineNetCash')}</dt><dd className="font-semibold tabular-nums text-slate-700">{formatMoney(projection.baseline_net_cash, forecast.currency, i18n.language)}</dd></div>
              <div className="flex justify-between gap-2 border-t border-slate-200 pt-2"><dt className="font-semibold text-slate-700">{t('ai.forecast.projectedEndingCash')}</dt><dd className="font-bold tabular-nums text-slate-950">{formatMoney(projection.projected_ending_cash, forecast.currency, i18n.language)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      {forecast.metrics.cash_history_days === 0 && <p className="mt-4 text-xs text-amber-800">{t('ai.forecast.cashHistoryLimited')}</p>}
      <p className="mt-4 text-xs leading-5 text-slate-500">{t('ai.forecast.assumptions')}</p>
    </section>
  );
}

function ExecutiveSummary({ snapshot, forecast }: { snapshot: AiFinancialSummary | null; forecast: CashRunwayForecast }) {
  const { t, i18n } = useTranslation();
  const metrics = snapshot?.metrics;
  const noComparison = t('ai.summary.noComparison');
  const marginChange = metrics?.gross_margin_change_pp ?? null;
  const expenseChange = metrics?.operating_expense_change_pct ?? null;
  const runway = forecast.metrics.runway_days === null
    ? t(forecast.metrics.cash_history_days === 0 ? 'ai.summary.notAvailable' : 'ai.summary.runwayStable')
    : t('ai.summary.runwayDays', { days: Math.round(forecast.metrics.runway_days) });
  const values = {
    revenue: metrics ? formatMoney(metrics.current_revenue, metrics.currency, i18n.language) : t('ai.summary.notAvailable'),
    revenueChange: metrics ? formatPercent(metrics.revenue_change_pct, i18n.language, noComparison) : noComparison,
    marginDirection: t(`ai.summary.${marginChange === null ? 'noComparison' : marginChange >= 0 ? 'improved' : 'declined'}`),
    grossMargin: formatPercent(metrics?.gross_margin_pct ?? null, i18n.language, noComparison),
    priorGrossMargin: formatPercent(metrics?.prior_gross_margin_pct ?? null, i18n.language, noComparison),
    expenseDirection: t(`ai.summary.${expenseChange === null ? 'noComparison' : expenseChange >= 0 ? 'increased' : 'decreased'}`),
    expenseChange: formatPercent(expenseChange, i18n.language, noComparison),
    topExpenseDriver: metrics?.top_expense_driver || t('ai.summary.notAvailable'),
    runway,
    day90Cash: formatMoney(forecast.projections.find((point) => point.days === 90)?.projected_ending_cash ?? 0, forecast.currency, i18n.language),
  };
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-indigo-50 p-2 text-indigo-700"><Activity className="h-5 w-5" aria-hidden="true" /></span>
          <div>
            <h2 className="text-lg font-bold text-slate-950">{t('ai.summary.executiveOverview')}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('ai.summary.executiveOverviewHint')}</p>
          </div>
        </div>
        {snapshot && <time className="text-xs text-slate-500" dateTime={snapshot.created_at}>{t('ai.summary.generatedAt', { date: new Date(snapshot.created_at).toLocaleDateString(i18n.language) })}</time>}
      </div>
      {snapshot ? (
        <p className="mt-5 rounded-xl bg-indigo-50/70 p-4 text-sm leading-7 text-slate-800">{t(snapshot.executive_summary, values)}</p>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">{t('ai.summary.noSnapshot')}</p>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />{t('ai.summary.keyRisks')}</h3>
          <ul className="mt-3 space-y-2">
            {(snapshot?.key_risks ?? []).map((risk, index) => <li key={`${risk.key}-${index}`} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">{t(risk.key, risk.values)}</li>)}
          </ul>
        </div>
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Wallet className="h-4 w-4 text-emerald-700" aria-hidden="true" />{t('ai.summary.recommendationsTitle')}</h3>
          <ul className="mt-3 space-y-2">
            {(snapshot?.recommendations ?? []).map((item, index) => <li key={`${item.key}-${index}`} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-950">{t(item.key, item.values)}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function FinancialIntelligence() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? '');
  const summaryQuery = useQuery({
    queryKey: ['ai-financial-summary', businessId],
    queryFn: () => aiRepository.getLatestFinancialSummary(businessId),
    enabled: Boolean(businessId),
  });
  const forecastQuery = useQuery({
    queryKey: ['ai-cash-runway', businessId],
    queryFn: () => aiRepository.calculateCashRunway(businessId),
    enabled: Boolean(businessId),
  });
  const generateMutation = useMutation({
    mutationFn: () => aiRepository.generateFinancialSummary(businessId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ai-financial-summary', businessId] });
      void queryClient.invalidateQueries({ queryKey: ['ai-cash-runway', businessId] });
    },
  });
  const loading = summaryQuery.isLoading || forecastQuery.isLoading;
  const failed = summaryQuery.isError || forecastQuery.isError;
  const forecast = forecastQuery.data;
  const snapshot = summaryQuery.data ?? null;
  const healthMetrics = forecast?.metrics ?? snapshot?.metrics;

  return (
    <div className="space-y-6 py-4">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800"><Activity className="h-3.5 w-3.5" aria-hidden="true" />{t('ai.summary.tabTitle')}</div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">{t('ai.summary.executiveOverview')}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{t('ai.summary.executiveOverviewHint')}</p>
        </div>
        <button type="button" onClick={() => generateMutation.mutate()} disabled={!businessId || generateMutation.isPending} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50">
          {generateMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Activity className="h-4 w-4" aria-hidden="true" />}
          {generateMutation.isPending ? t('ai.summary.generatingSummary') : t('ai.summary.generateSummary')}
        </button>
      </header>
      {generateMutation.isSuccess && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{t('ai.summary.saved')}</p>}
      {generateMutation.isError && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('ai.summary.generateFailed')}</p>}
      {failed ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">{t('ai.summary.loadFailed')}</p>
      ) : loading || !forecast ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white p-10 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />{t('ai.summary.loading')}</div>
      ) : (
        <>
          {healthMetrics && <WorkingCapitalHealth metrics={healthMetrics} currency={forecast.currency} locale={i18n.language} />}
          <ExecutiveSummary snapshot={snapshot} forecast={forecast} />
          <ForecastProjection forecast={forecast} />
        </>
      )}
    </div>
  );
}
