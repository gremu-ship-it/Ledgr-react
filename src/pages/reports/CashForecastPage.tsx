import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, LoaderCircle, RefreshCw, Save, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Row } from '@/dal/types/database';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

type CashForecastScenario = Row<'cash_forecast_scenarios'>;
type ForecastAssumptions = Pick<
  CashForecastScenario,
  'receivable_delay_days' | 'payable_delay_days' | 'payroll_growth_percent' | 'include_construction' | 'horizon_months'
>;

interface ForecastMonth {
  month: string;
  opening: number;
  inflows: number;
  outflows: number;
  net: number;
  closing: number;
  receivables: number;
  payables: number;
  payroll: number;
  construction_inflows: number;
  purchase_orders: number;
}

interface CashForecastResult {
  as_of_date: string;
  base_currency: string;
  horizon_months: number;
  opening_balance: number;
  months: ForecastMonth[];
  source_counts: Record<string, number>;
  shortfall_months: number;
  average_monthly_payroll: number;
  foreign_cash_account_count: number;
  construction_available: boolean;
  unpriced_purchase_order_lines: number;
  foreign_currency_purchase_order_lines: number;
  unlinked_certificate_count: number;
  estimated_retention_projects: number;
}

const DEFAULT_ASSUMPTIONS: ForecastAssumptions = {
  receivable_delay_days: 0,
  payable_delay_days: 0,
  payroll_growth_percent: 0,
  include_construction: true,
  horizon_months: 12,
};
const EMPTY_MONTHS: ForecastMonth[] = [];

function formatMonth(value: string, locale: string): string {
  const [year, month] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, 1);
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(date);
}

function formatDate(value: string, locale: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function buildClosingPath(months: ForecastMonth[]): string {
  if (!months.length) return '';
  const values = months.map((month) => Number(month.closing) || 0);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const spread = max - min || 1;
  const left = 24;
  const right = 976;
  const top = 18;
  const bottom = 194;
  return values.map((value, index) => {
    const x = months.length === 1 ? (left + right) / 2 : left + (index / (months.length - 1)) * (right - left);
    const y = bottom - ((value - min) / spread) * (bottom - top);
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
}

function zeroLineY(months: ForecastMonth[]): number {
  const values = months.map((month) => Number(month.closing) || 0);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const spread = max - min || 1;
  return 194 - ((0 - min) / spread) * 176;
}

function chartPoint(months: ForecastMonth[], index: number): { x: number; y: number } {
  const values = months.map((month) => Number(month.closing) || 0);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const spread = max - min || 1;
  const x = months.length === 1 ? 500 : 24 + (index / (months.length - 1)) * 952;
  const y = 194 - (((values[index] ?? 0) - min) / spread) * 176;
  return { x, y };
}

export function CashForecastPage() {
  const business = useAppStore((state) => state.currentBusiness?.business);
  const supportsConstruction = Boolean(
    business?.operating_models?.includes('PROJECT_BASED') || business?.operating_models?.includes('CONSTRUCTION'),
  );
  return <CashForecastContent key={`${business?.id ?? ''}:${supportsConstruction}`} />;
}

function CashForecastContent() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const currentUser = useAppStore((state) => state.currentUser);
  const businessId = currentBusiness?.business?.id ?? '';
  const operatingModels = currentBusiness?.business?.operating_models ?? [];
  const supportsConstruction = operatingModels.includes('PROJECT_BASED') || operatingModels.includes('CONSTRUCTION');

  const [assumptions, setAssumptions] = useState<ForecastAssumptions>({
    ...DEFAULT_ASSUMPTIONS,
    include_construction: supportsConstruction,
  });
  const [scenarioId, setScenarioId] = useState('');
  const [scenarioName, setScenarioName] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  const scenariosQuery = useQuery<CashForecastScenario[]>({
    queryKey: ['cash-forecast-scenarios', businessId],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cash_forecast_scenarios')
        .select('*')
        .eq('business_id', businessId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const forecastQuery = useQuery<CashForecastResult>({
    queryKey: ['cash-forecast', businessId, assumptions],
    enabled: Boolean(businessId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('generate_cash_forecast', {
        p_business_id: businessId,
        p_horizon_months: assumptions.horizon_months,
        p_receivable_delay_days: assumptions.receivable_delay_days,
        p_payable_delay_days: assumptions.payable_delay_days,
        p_payroll_growth_percent: assumptions.payroll_growth_percent,
        p_include_construction: assumptions.include_construction,
      });
      if (error) throw error;
      return data as unknown as CashForecastResult;
    },
  });

  const saveScenario = useMutation({
    mutationFn: async () => {
      if (!currentUser?.id || !businessId) throw new Error('Missing session');
      const values = {
        ...assumptions,
        name: scenarioName.trim(),
        updated_at: new Date().toISOString(),
      };
      if (scenarioId) {
        const { data, error } = await supabase
          .from('cash_forecast_scenarios')
          .update(values)
          .eq('id', scenarioId)
          .eq('business_id', businessId)
          .select('*')
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from('cash_forecast_scenarios')
        .insert({ ...values, business_id: businessId, created_by: currentUser.id })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (scenario) => {
      setScenarioId(scenario.id);
      setScenarioName(scenario.name);
      setSaveMessage(t('reports.cashForecast.scenarioSaved'));
      await queryClient.invalidateQueries({ queryKey: ['cash-forecast-scenarios', businessId] });
    },
    onError: () => setSaveMessage(t('reports.cashForecast.scenarioSaveError')),
  });

  const forecast = forecastQuery.data;
  const months = forecast?.months ?? EMPTY_MONTHS;
  const chartPath = useMemo(() => buildClosingPath(months), [months]);
  const currency = forecast?.base_currency ?? currentBusiness?.business?.base_currency ?? 'MWK';
  const amountFormatter = useMemo(() => new Intl.NumberFormat(i18n.language, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    maximumFractionDigits: 2,
  }), [currency, i18n.language]);
  const formatAmount = (value: number) => amountFormatter.format(Number.isFinite(Number(value)) ? Number(value) : 0);

  const selectScenario = (id: string) => {
    setSaveMessage('');
    setScenarioId(id);
    if (!id) {
      setScenarioName('');
      setAssumptions({ ...DEFAULT_ASSUMPTIONS, include_construction: supportsConstruction });
      return;
    }
    const scenario = (scenariosQuery.data ?? []).find((item) => item.id === id);
    if (!scenario) return;
    setScenarioName(scenario.name);
    setAssumptions({
      receivable_delay_days: scenario.receivable_delay_days,
      payable_delay_days: scenario.payable_delay_days,
      payroll_growth_percent: scenario.payroll_growth_percent,
      include_construction: scenario.include_construction,
      horizon_months: scenario.horizon_months,
    });
  };

  const sourceRows = [
    ['receivables', 'reports.cashForecast.sources.receivables'],
    ['payables', 'reports.cashForecast.sources.payables'],
    ['payroll', 'reports.cashForecast.sources.payroll'],
    ['certificates', 'reports.cashForecast.sources.certificates'],
    ['retention', 'reports.cashForecast.sources.retention'],
    ['purchase_orders', 'reports.cashForecast.sources.purchaseOrders'],
  ] as const;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex items-start gap-3">
        <div className="rounded-xl bg-brand-50 p-3 text-brand-700"><TrendingUp className="h-6 w-6" aria-hidden="true" /></div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('reports.cashForecast.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-600">{t('reports.cashForecast.description')}</p>
          {forecast && <p className="mt-2 text-xs text-gray-500">{t('reports.cashForecast.asOf', { date: formatDate(forecast.as_of_date, i18n.language), currency })}</p>}
        </div>
      </header>

      <section aria-label={t('reports.cashForecast.scenarios')} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 lg:grid-cols-[minmax(12rem,0.8fr)_minmax(16rem,1fr)_auto] lg:items-end">
          <label className="block text-sm font-medium text-gray-700">
            {t('reports.cashForecast.selectScenario')}
            <select
              value={scenarioId}
              onChange={(event) => selectScenario(event.target.value)}
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            >
              <option value="">{t('reports.cashForecast.baseCase')}</option>
              {(scenariosQuery.data ?? []).map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium text-gray-700">
            {t('reports.cashForecast.scenarioName')}
            <input
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              maxLength={80}
              placeholder={t('reports.cashForecast.scenarioNamePlaceholder')}
              className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => { setSaveMessage(''); saveScenario.mutate(); }}
            disabled={!scenarioName.trim() || saveScenario.isPending || !currentUser?.id}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saveScenario.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            {scenarioId ? t('reports.cashForecast.updateScenario') : t('reports.cashForecast.saveScenario')}
          </button>
        </div>
        {saveMessage && <p role={saveScenario.isError ? 'alert' : 'status'} className={`mt-3 text-sm ${saveScenario.isError ? 'text-red-700' : 'text-emerald-700'}`}>{saveMessage}</p>}
        {scenariosQuery.isError && <p role="alert" className="mt-3 text-sm text-red-700">{t('reports.cashForecast.scenariosError')}</p>}

        <div className="mt-5 grid gap-4 border-t border-gray-100 pt-5 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-medium text-gray-700">
            {t('reports.cashForecast.receivableDelay')}
            <span className="mt-1 flex items-center gap-2">
              <input aria-label={t('reports.cashForecast.receivableDelay')} type="number" min={0} max={365} value={assumptions.receivable_delay_days} onChange={(event) => setAssumptions((current) => ({ ...current, receivable_delay_days: Number(event.target.value) || 0 }))} className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2" />
              <span className="shrink-0 text-gray-500">{t('reports.cashForecast.days')}</span>
            </span>
          </label>
          <label className="text-sm font-medium text-gray-700">
            {t('reports.cashForecast.payableDelay')}
            <span className="mt-1 flex items-center gap-2">
              <input aria-label={t('reports.cashForecast.payableDelay')} type="number" min={0} max={365} value={assumptions.payable_delay_days} onChange={(event) => setAssumptions((current) => ({ ...current, payable_delay_days: Number(event.target.value) || 0 }))} className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2" />
              <span className="shrink-0 text-gray-500">{t('reports.cashForecast.days')}</span>
            </span>
          </label>
          <label className="text-sm font-medium text-gray-700">
            {t('reports.cashForecast.payrollGrowth')}
            <span className="mt-1 flex items-center gap-2">
              <input aria-label={t('reports.cashForecast.payrollGrowth')} type="number" min={-100} max={300} step={0.5} value={assumptions.payroll_growth_percent} onChange={(event) => setAssumptions((current) => ({ ...current, payroll_growth_percent: Number(event.target.value) || 0 }))} className="min-h-11 w-full rounded-lg border border-gray-300 px-3 py-2" />
              <span className="shrink-0 text-gray-500">%</span>
            </span>
          </label>
          <label className="text-sm font-medium text-gray-700">
            {t('reports.cashForecast.horizon')}
            <select value={assumptions.horizon_months} onChange={(event) => setAssumptions((current) => ({ ...current, horizon_months: Number(event.target.value) }))} className="mt-1 block min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
              {[3, 6, 9, 12].map((monthCount) => <option key={monthCount} value={monthCount}>{t('reports.cashForecast.monthCount', { count: monthCount })}</option>)}
            </select>
          </label>
          {supportsConstruction && (
            <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-gray-700 sm:col-span-2 lg:col-span-1">
              <input type="checkbox" checked={assumptions.include_construction} onChange={(event) => setAssumptions((current) => ({ ...current, include_construction: event.target.checked }))} className="h-4 w-4 rounded border-gray-300 text-brand-600" />
              {t('reports.cashForecast.includeConstruction')}
            </label>
          )}
        </div>
      </section>

      {forecastQuery.isError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{t('reports.cashForecast.error')}</span>
          <button type="button" onClick={() => void forecastQuery.refetch()} className="inline-flex items-center gap-2 font-semibold underline">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />{t('common.retry')}
          </button>
        </div>
      )}

      {forecastQuery.isLoading && <div role="status" className="flex items-center gap-2 rounded-xl bg-white p-6 text-sm text-gray-600"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />{t('reports.cashForecast.loading')}</div>}

      {forecast && !forecastQuery.isLoading && (
        <>
          {forecast.shortfall_months > 0 && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{t('reports.cashForecast.shortfallAlert', { count: forecast.shortfall_months })}</span>
            </div>
          )}

          <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{t('reports.cashForecast.closingBalanceChart')}</h2>
                <p className="mt-1 text-sm text-gray-600">{t('reports.cashForecast.chartDescription')}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-500">{t('reports.cashForecast.openingBalance')}</span>
                <span className="ml-2 font-semibold tabular-nums text-gray-900">{formatAmount(forecast.opening_balance)}</span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <svg viewBox="0 0 1000 240" role="img" aria-label={t('reports.cashForecast.chartAriaLabel')} className="h-64 min-w-[640px] w-full">
                <line x1="24" x2="976" y1={zeroLineY(months)} y2={zeroLineY(months)} stroke="#cbd5e1" strokeDasharray="4 6" />
                <path d={chartPath} fill="none" stroke="#0f766e" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                {months.map((month, index) => {
                  const point = chartPoint(months, index);
                  return <g key={month.month}>
                    <circle cx={point.x} cy={point.y} r="5" fill={month.closing < 0 ? '#dc2626' : '#0f766e'} />
                    <text x={point.x} y="222" textAnchor="middle" className="fill-gray-500 text-[12px]">{formatMonth(month.month, i18n.language)}</text>
                  </g>;
                })}
              </svg>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
              <h2 className="text-lg font-semibold text-gray-900">{t('reports.cashForecast.monthlyBuckets')}</h2>
              <p className="mt-1 text-sm text-gray-600">{t('reports.cashForecast.rollForwardExplanation')}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-right text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left">{t('reports.cashForecast.month')}</th>
                    <th scope="col" className="px-4 py-3">{t('reports.cashForecast.openingBalance')}</th>
                    <th scope="col" className="px-4 py-3">{t('reports.cashForecast.inflows')}</th>
                    <th scope="col" className="px-4 py-3">{t('reports.cashForecast.outflows')}</th>
                    <th scope="col" className="px-4 py-3">{t('reports.cashForecast.netCash')}</th>
                    <th scope="col" className="px-4 py-3">{t('reports.cashForecast.closingBalance')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {months.map((month) => (
                    <tr key={month.month} className={month.closing < 0 ? 'bg-rose-50/60' : ''}>
                      <th scope="row" className="whitespace-nowrap px-4 py-3 text-left font-semibold text-gray-900">{formatMonth(month.month, i18n.language)}</th>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatAmount(month.opening)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-emerald-700">{formatAmount(month.inflows)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-rose-700">{formatAmount(month.outflows)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums font-medium ${month.net < 0 ? 'text-rose-700' : 'text-gray-900'}`}>{formatAmount(month.net)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 tabular-nums font-semibold ${month.closing < 0 ? 'text-rose-700' : 'text-gray-900'}`}>{formatAmount(month.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <details className="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <summary className="cursor-pointer list-none px-4 py-4 font-semibold text-gray-900 sm:px-5">
              <span className="flex items-center justify-between gap-3">
                <span>{t('reports.cashForecast.dataSources')}</span>
                <span className="text-xs font-normal text-gray-500">{t('reports.cashForecast.dataSourcesHint')}</span>
              </span>
            </summary>
            <div className="border-t border-gray-100 p-4 sm:p-5">
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {sourceRows.map(([key, labelKey]) => (
                  <li key={key} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <span className="text-gray-700">{t(labelKey)}</span>
                    <span className="font-semibold tabular-nums text-gray-900">{forecast.source_counts[key] ?? 0}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-gray-600">{t('reports.cashForecast.payrollMethod', { amount: formatAmount(forecast.average_monthly_payroll) })}</p>
              {forecast.unpriced_purchase_order_lines > 0 && <p className="mt-2 text-sm text-amber-800">{t('reports.cashForecast.unpricedPurchaseOrders', { count: forecast.unpriced_purchase_order_lines })}</p>}
              {forecast.foreign_currency_purchase_order_lines > 0 && <p className="mt-2 text-sm text-amber-800">{t('reports.cashForecast.foreignPurchaseOrders', { count: forecast.foreign_currency_purchase_order_lines, currency })}</p>}
              {forecast.unlinked_certificate_count > 0 && <p className="mt-2 text-sm text-gray-600">{t('reports.cashForecast.certificateCurrencyNote', { count: forecast.unlinked_certificate_count, currency })}</p>}
              {forecast.estimated_retention_projects > 0 && <p className="mt-2 text-sm text-gray-600">{t('reports.cashForecast.retentionEstimateNote', { count: forecast.estimated_retention_projects })}</p>}
              {!forecast.construction_available && supportsConstruction && <p className="mt-2 text-sm text-gray-600">{t('reports.cashForecast.constructionAccessNote')}</p>}
              <div className="mt-4 space-y-2 border-t border-gray-200 pt-4 text-xs leading-5 text-gray-500">
                <p>{t('reports.cashForecast.currencyLimitation', { currency })}</p>
                {forecast.foreign_cash_account_count > 0 && <p>{t('reports.cashForecast.foreignCashAccounts', { count: forecast.foreign_cash_account_count, currency })}</p>}
                <p>{t('reports.cashForecast.retentionLimitation')}</p>
                <p>{t('reports.cashForecast.purchaseOrderLimitation', { currency })}</p>
              </div>
            </div>
          </details>
        </>
      )}
    </main>
  );
}
