import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Calculator, CheckCircle2, History, LoaderCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { DepreciationHistoryRecord } from '@/dal/repositories/DepreciationRepository';

type PeriodKind = 'month' | 'quarter';
interface PeriodOption { key: string; start: string; end: string; label: string; }
interface HistoryGroup {
  key: string;
  createdAt: string;
  periodStart: string;
  periodEnd: string;
  assetsCount: number;
  totalAmount: number;
  journalEntries: Array<{ id: string; number: string }>;
}

function dateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildPeriodOptions(
  kind: PeriodKind,
  language: string,
  currentYear: number,
  quarterLabel: (quarter: number, year: number) => string,
): PeriodOption[] {
  const options: PeriodOption[] = [];
  for (let year = currentYear - 4; year <= currentYear + 1; year += 1) {
    if (kind === 'month') {
      for (let month = 1; month <= 12; month += 1) {
        const start = dateString(year, month, 1);
        const end = dateString(year, month, new Date(Date.UTC(year, month, 0)).getUTCDate());
        options.push({
          key: start,
          start,
          end,
          label: new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' })
            .format(new Date(`${start}T00:00:00.000Z`)),
        });
      }
    } else {
      for (let quarter = 1; quarter <= 4; quarter += 1) {
        const startMonth = (quarter - 1) * 3 + 1;
        const endMonth = startMonth + 2;
        const start = dateString(year, startMonth, 1);
        const end = dateString(year, endMonth, new Date(Date.UTC(year, endMonth, 0)).getUTCDate());
        options.push({ key: start, start, end, label: quarterLabel(quarter, year) });
      }
    }
  }
  return options.sort((a, b) => b.start.localeCompare(a.start));
}

function formatCurrency(value: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatDate(value: string, language: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}

function groupHistory(records: DepreciationHistoryRecord[]): HistoryGroup[] {
  const groups = new Map<string, HistoryGroup>();
  for (const record of records) {
    const key = `${record.periodStart}:${record.periodEnd}`;
    const group = groups.get(key) ?? {
      key,
      createdAt: record.createdAt,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      assetsCount: 0,
      totalAmount: 0,
      journalEntries: [],
    };
    group.assetsCount += 1;
    group.totalAmount += record.depreciationCharge;
    if (record.createdAt > group.createdAt) group.createdAt = record.createdAt;
    if (record.journalEntryId && record.journalEntryNumber) {
      group.journalEntries.push({ id: record.journalEntryId, number: record.journalEntryNumber });
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, totalAmount: Math.round(group.totalAmount * 100) / 100 }))
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

function methodLabel(method: string, t: (key: string) => string): string {
  if (method === 'straight_line') return t('depreciation.straightLine');
  if (method === 'reducing_balance') return t('depreciation.decliningBalance');
  return t('depreciation.unsupportedMethod');
}

export function DepreciationRunPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const userId = useAppStore((state) => state.currentUser?.id);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const currentYear = useMemo(() => new Date().getFullYear(), []);
  const [periodKind, setPeriodKind] = useState<PeriodKind>('month');
  const [periodKey, setPeriodKey] = useState(() => dateString(new Date().getFullYear(), new Date().getMonth() + 1, 1));
  const [confirmOpen, setConfirmOpen] = useState(false);

  const periods = useMemo(() => buildPeriodOptions(
    periodKind,
    i18n.language,
    currentYear,
    (quarter, year) => t('depreciation.quarterPeriod', { quarter, year }),
  ), [periodKind, i18n.language, currentYear, t]);
  const selectedPeriod = periods.find((period) => period.key === periodKey)
    ?? periods.find((period) => periodKey >= period.start && periodKey <= period.end)
    ?? periods[0];

  const previewQuery = useQuery({
    queryKey: ['depreciation-preview', businessId, selectedPeriod?.start, selectedPeriod?.end],
    enabled: Boolean(businessId && selectedPeriod),
    queryFn: () => repos.depreciation.getDepreciationPreview(businessId, selectedPeriod!.start, selectedPeriod!.end),
  });
  const historyQuery = useQuery({
    queryKey: ['depreciation-history', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.depreciation.getDepreciationHistory(businessId),
  });
  const summaryQuery = useQuery({
    queryKey: ['depreciation-summary', businessId, selectedPeriod?.start, selectedPeriod?.end],
    enabled: Boolean(businessId && selectedPeriod),
    queryFn: () => repos.depreciation.getDepreciationSummary(businessId, selectedPeriod!.start, selectedPeriod!.end),
  });

  const runMutation = useMutation({
    mutationFn: () => {
      if (!selectedPeriod || !userId) throw new Error('run');
      return repos.depreciation.runDepreciation(businessId, selectedPeriod.start, selectedPeriod.end, userId);
    },
    onSuccess: async () => {
      setConfirmOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['depreciation-preview', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['depreciation-history', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['depreciation-summary', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['assets', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['journal_entries', businessId] }),
      ]);
    },
  });

  const preview = previewQuery.data ?? [];
  const historyGroups = useMemo(() => groupHistory(historyQuery.data ?? []), [historyQuery.data]);
  const previewTotal = preview.reduce((sum, item) => sum + item.periodDepreciation, 0);
  const runResult = runMutation.data;

  const changePeriod = (next: string) => {
    setPeriodKey(next);
    runMutation.reset();
  };

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Calculator className="h-7 w-7 text-brand-600" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('depreciation.title')}</h1>
            <p className="mt-1 text-sm text-gray-600">{t('depreciation.description')}</p>
          </div>
        </div>
        <button
          type="button"
          disabled={!preview.some((item) => item.periodDepreciation > 0) || previewQuery.isLoading || runMutation.isPending || !userId}
          onClick={() => setConfirmOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Calculator className="h-4 w-4" aria-hidden="true" />}
          {t('depreciation.runDepreciation')}
        </button>
      </header>

      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="grid gap-1 text-sm font-medium text-gray-700">
          {t('depreciation.periodType')}
          <select value={periodKind} onChange={(event) => { setPeriodKind(event.target.value as PeriodKind); runMutation.reset(); }} className="min-w-36 rounded-md border border-gray-300 bg-white px-3 py-2">
            <option value="month">{t('depreciation.month')}</option>
            <option value="quarter">{t('depreciation.quarter')}</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-gray-700">
          {t('depreciation.selectPeriod')}
          <select value={selectedPeriod?.key ?? ''} onChange={(event) => changePeriod(event.target.value)} className="min-w-56 rounded-md border border-gray-300 bg-white px-3 py-2">
            {periods.map((period) => <option key={period.key} value={period.key}>{period.label}</option>)}
          </select>
        </label>
        {selectedPeriod && <p className="pb-2 text-sm text-gray-600">{t('depreciation.periodRange', { start: formatDate(selectedPeriod.start, i18n.language), end: formatDate(selectedPeriod.end, i18n.language) })}</p>}
      </section>

      {previewQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('depreciation.loadFailed')}</p>}
      {runMutation.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('depreciation.runFailed')}</p>}
      {runResult?.alreadyRun && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('depreciation.alreadyRun')}</p>}
      {runResult && !runResult.alreadyRun && <div role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-900">
        <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5" aria-hidden="true" />{t('depreciation.runSuccess')}</div>
        <p className="mt-1">{t('depreciation.assetsProcessed')}: {runResult.assetsProcessed} · {t('depreciation.totalAmount')}: {formatCurrency(runResult.totalAmount, currency, i18n.language)}</p>
        {runResult.entries.length > 0 && <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {runResult.entries.map((entry) => <li key={entry.journalEntryId}><Link className="font-medium underline" to={`/journals?entry=${encodeURIComponent(entry.journalEntryId)}`}>{t('depreciation.journalEntryLink', { number: entry.journalEntryNumber })}</Link></li>)}
        </ul>}
      </div>}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
          <div><h2 className="font-semibold text-gray-900">{t('depreciation.preview')}</h2><p className="mt-1 text-sm text-gray-600">{t('depreciation.previewDescription')}</p></div>
          {previewQuery.isLoading && <span role="status" className="text-sm text-gray-500">{t('depreciation.loading')}</span>}
        </div>
        {preview.length === 0 && !previewQuery.isLoading ? <p className="p-6 text-center text-sm text-gray-500">{t('depreciation.noAssets')}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1040px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600"><tr>
                <th className="px-4 py-3">{t('depreciation.assetName')}</th><th className="px-4 py-3">{t('depreciation.category')}</th>
                <th className="px-4 py-3 text-right">{t('depreciation.cost')}</th><th className="px-4 py-3 text-right">{t('depreciation.accumulatedDepreciation')}</th>
                <th className="px-4 py-3 text-right">{t('depreciation.netBookValue')}</th><th className="px-4 py-3">{t('depreciation.method')}</th>
                <th className="px-4 py-3 text-right">{t('depreciation.rateOrLife')}</th><th className="px-4 py-3 text-right">{t('depreciation.periodDepreciation')}</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((item) => <tr key={item.asset.id}>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.asset.name}<span className="ml-2 text-xs font-normal text-gray-500">{item.asset.asset_number}</span></td>
                  <td className="px-4 py-3 text-gray-700">{item.category.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.asset.acquisition_cost, currency, i18n.language)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.accumulatedDepreciation, currency, i18n.language)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(item.netBookValue, currency, i18n.language)}</td>
                  <td className="px-4 py-3">{methodLabel(item.asset.depreciation_method, t)}</td>
                  <td className="px-4 py-3 text-right">{item.asset.depreciation_method === 'reducing_balance'
                    ? (item.annualRatePercent == null ? t('depreciation.rateMissing') : t('depreciation.rateValue', { rate: Number(item.annualRatePercent).toLocaleString(i18n.language) }))
                    : (item.usefulLifeMonths == null ? t('depreciation.usefulLifeMissing') : t('depreciation.usefulLifeValue', { months: item.usefulLifeMonths }))}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatCurrency(item.periodDepreciation, currency, i18n.language)}</td>
                </tr>)}
              </tbody>
              {preview.length > 0 && <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold"><tr>
                <td className="px-4 py-3" colSpan={7}>{t('depreciation.totalDepreciation')}</td><td className="px-4 py-3 text-right tabular-nums">{formatCurrency(previewTotal, currency, i18n.language)}</td>
              </tr></tfoot>}
            </table>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-200 p-4"><History className="h-5 w-5 text-gray-500" aria-hidden="true" /><h2 className="font-semibold text-gray-900">{t('depreciation.history')}</h2></div>
        {historyQuery.isError && <p role="alert" className="p-4 text-sm text-red-700">{t('depreciation.historyFailed')}</p>}
        {historyGroups.length === 0 && !historyQuery.isLoading ? <p className="p-6 text-center text-sm text-gray-500">{t('depreciation.noHistory')}</p> : (
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600"><tr>
              <th className="px-4 py-3">{t('depreciation.date')}</th><th className="px-4 py-3">{t('depreciation.period')}</th>
              <th className="px-4 py-3 text-right">{t('depreciation.assetsProcessed')}</th><th className="px-4 py-3 text-right">{t('depreciation.totalAmount')}</th><th className="px-4 py-3">{t('depreciation.journalEntries')}</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-100">{historyGroups.map((group) => <tr key={group.key}>
              <td className="px-4 py-3 whitespace-nowrap">{formatDate(group.createdAt, i18n.language)}</td>
              <td className="px-4 py-3 whitespace-nowrap">{t('depreciation.periodRange', { start: formatDate(group.periodStart, i18n.language), end: formatDate(group.periodEnd, i18n.language) })}</td>
              <td className="px-4 py-3 text-right tabular-nums">{group.assetsCount}</td><td className="px-4 py-3 text-right tabular-nums">{formatCurrency(group.totalAmount, currency, i18n.language)}</td>
              <td className="px-4 py-3">{group.journalEntries.map((entry, index) => <span key={entry.id}>{index > 0 ? ', ' : ''}<Link className="text-brand-700 underline" to={`/journals?entry=${encodeURIComponent(entry.id)}`}>{entry.number}</Link></span>)}</td>
            </tr>)}</tbody>
          </table></div>
        )}
      </section>

      {summaryQuery.data && summaryQuery.data.length > 0 && <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 p-4"><h2 className="font-semibold text-gray-900">{t('depreciation.categorySummary')}</h2></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600"><tr><th className="px-4 py-3">{t('depreciation.category')}</th><th className="px-4 py-3 text-right">{t('depreciation.assetsProcessed')}</th><th className="px-4 py-3 text-right">{t('depreciation.totalAmount')}</th></tr></thead>
          <tbody className="divide-y divide-gray-100">{summaryQuery.data.map((row) => <tr key={row.categoryId}><td className="px-4 py-3">{row.categoryName}</td><td className="px-4 py-3 text-right">{row.assetsCount}</td><td className="px-4 py-3 text-right">{formatCurrency(row.totalDepreciation, currency, i18n.language)}</td></tr>)}</tbody>
        </table></div>
      </section>}

      {confirmOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
        <section role="dialog" aria-modal="true" aria-labelledby="depreciation-confirm-title" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
          <h2 id="depreciation-confirm-title" className="text-lg font-semibold text-gray-900">{t('depreciation.confirmTitle')}</h2>
          <p className="mt-3 text-sm text-gray-700">{t('depreciation.confirmRun')}</p>
          {selectedPeriod && <p className="mt-2 text-sm font-medium text-gray-800">{t('depreciation.periodRange', { start: formatDate(selectedPeriod.start, i18n.language), end: formatDate(selectedPeriod.end, i18n.language) })}</p>}
          <div className="mt-5 flex justify-end gap-3">
            <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700">{t('common.cancel')}</button>
            <button type="button" disabled={runMutation.isPending} onClick={() => runMutation.mutate()} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{t('depreciation.confirmAction')}</button>
          </div>
        </section>
      </div>}

      {historyQuery.isLoading && <p role="status" className="text-sm text-gray-500">{t('depreciation.loadingHistory')}</p>}
    </main>
  );
}
