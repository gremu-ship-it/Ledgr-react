import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleDollarSign, RefreshCw, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { FxBalanceCategory, FxOpenForeignBalance } from '@/dal/repositories/FxRevaluationRepository';
import type { Row } from '@/dal/types/database';

const categories: FxBalanceCategory[] = ['receivables', 'payables', 'bank', 'loan'];
const EMPTY_BALANCES: FxOpenForeignBalance[] = [];

function money(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

export function FxRevaluationPage() {
  const { t } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business.id;
  const functionalCurrency = currentBusiness?.business.base_currency ?? 'MWK';
  const queryClient = useQueryClient();
  const [revaluationDate, setRevaluationDate] = useState(new Date().toISOString().slice(0, 10));
  const [notice, setNotice] = useState<'success' | 'error' | null>(null);

  const previewQuery = useQuery({
    queryKey: ['fx-revaluation-preview', businessId, revaluationDate, functionalCurrency],
    queryFn: () => repos.fxRevaluation.getOpenForeignBalances(businessId!, revaluationDate, functionalCurrency),
    enabled: Boolean(businessId && revaluationDate),
  });
  const historyQuery = useQuery({
    queryKey: ['fx-revaluation-history', businessId],
    queryFn: () => repos.fxRevaluation.getRevaluationHistory(businessId!),
    enabled: Boolean(businessId),
  });
  const runMutation = useMutation({
    mutationFn: () => repos.fxRevaluation.runRevaluation(businessId!, revaluationDate, {}, functionalCurrency),
    onSuccess: async () => {
      setNotice('success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['fx-revaluation-preview', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['fx-revaluation-history', businessId] }),
      ]);
    },
    onError: () => setNotice('error'),
  });

  const history = historyQuery.data ?? [];
  const alreadyRun = history.some((item) => item.revaluation_date === revaluationDate);
  const balances = previewQuery.data ?? EMPTY_BALANCES;
  const totals = useMemo(() => balances.reduce((result, balance) => {
    if (balance.unrealisedGainLoss > 0) result.gains += balance.unrealisedGainLoss;
    else result.losses += Math.abs(balance.unrealisedGainLoss);
    return result;
  }, { gains: 0, losses: 0 }), [balances]);
  const groupedTotals = useMemo(() => categories.map((category) => ({
    category,
    count: balances.filter((balance) => balance.category === category).length,
    bookValue: balances.filter((balance) => balance.category === category).reduce((sum, balance) => sum + balance.currentBookValue, 0),
    closingValue: balances.filter((balance) => balance.category === category).reduce((sum, balance) => sum + balance.revaluedAmount, 0),
  })), [balances]);
  const formatMoney = (value: number) => money(value, functionalCurrency);

  const submitRevaluation = () => {
    if (alreadyRun || runMutation.isPending || balances.length === 0) return;
    if (!window.confirm(t('fxRevaluation.confirmRun', { date: revaluationDate }))) return;
    setNotice(null);
    runMutation.mutate();
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-700">{t('fxRevaluation.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{t('fxRevaluation.title')}</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">{t('fxRevaluation.subtitle')}</p>
        </div>
        <Link to="/settings/exchange-rates" className="text-sm font-semibold text-brand-700 hover:text-brand-800">{t('fxRevaluation.manageRates')}</Link>
      </header>

      <section className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:grid-cols-[minmax(180px,1fr)_minmax(220px,1fr)_auto] md:items-end">
        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>{t('fxRevaluation.asOfDate')}</span>
          <input type="date" value={revaluationDate} onChange={(event) => { setRevaluationDate(event.target.value); setNotice(null); }} className="w-full rounded-lg border border-gray-300 px-3 py-2.5" />
        </label>
        <label className="space-y-1 text-sm font-medium text-gray-700">
          <span>{t('fxRevaluation.functionalCurrency')}</span>
          <select value={functionalCurrency} disabled className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2.5 text-gray-700" aria-describedby="fx-functional-help">
            <option value={functionalCurrency}>{functionalCurrency}</option>
          </select>
          <span id="fx-functional-help" className="block text-xs font-normal text-gray-500">{t('fxRevaluation.functionalCurrencyHelp')}</span>
        </label>
        <button type="button" onClick={submitRevaluation} disabled={alreadyRun || historyQuery.isLoading || runMutation.isPending || previewQuery.isLoading || balances.length === 0} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
          {runMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RotateCw className="h-4 w-4" />}
          {alreadyRun ? t('fxRevaluation.alreadyRun') : t('fxRevaluation.runRevaluation')}
        </button>
      </section>

      {alreadyRun && notice !== 'success' && <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{t('fxRevaluation.dateAlreadyRun')}</div>}
      {notice === 'success' && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />{t('fxRevaluation.runSuccess')}</div>}
      {notice === 'error' && <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertTriangle className="h-4 w-4" />{t('fxRevaluation.runFailed')}</div>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {groupedTotals.map((group) => (
          <article key={group.category} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-medium text-gray-500">{t(`fxRevaluation.categories.${group.category}`)}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-gray-900">{group.count}</p>
            <p className="mt-1 text-xs text-gray-500">{t('fxRevaluation.accounts')}</p>
            <div className="mt-4 flex justify-between gap-3 border-t border-gray-100 pt-3 text-xs"><span className="text-gray-500">{t('fxRevaluation.bookValue')}</span><span className="font-medium text-gray-700">{formatMoney(group.bookValue)}</span></div>
            <div className="mt-2 flex justify-between gap-3 text-xs"><span className="text-gray-500">{t('fxRevaluation.closingValue')}</span><span className="font-medium text-gray-700">{formatMoney(group.closingValue)}</span></div>
          </article>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><div className="flex items-center gap-2 text-sm font-medium text-emerald-800"><CircleDollarSign className="h-4 w-4" />{t('fxRevaluation.totalUnrealisedGain')}</div><p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-900">{formatMoney(totals.gains)}</p></div>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5"><div className="flex items-center gap-2 text-sm font-medium text-rose-800"><CircleDollarSign className="h-4 w-4" />{t('fxRevaluation.totalUnrealisedLoss')}</div><p className="mt-2 text-2xl font-semibold tabular-nums text-rose-900">{formatMoney(totals.losses)}</p></div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-5"><h2 className="text-base font-semibold text-gray-900">{t('fxRevaluation.openBalances')}</h2><p className="mt-1 text-sm text-gray-500">{t('fxRevaluation.openBalancesDescription')}</p></div>
        {previewQuery.isLoading ? <div className="p-8 text-center text-sm text-gray-500">{t('common.loading')}</div>
          : previewQuery.isError ? <div role="alert" className="p-6 text-sm text-red-700">{t('fxRevaluation.previewFailed')}</div>
            : balances.length === 0 ? <div className="p-10 text-center"><p className="font-medium text-gray-800">{t('fxRevaluation.noBalances')}</p><p className="mt-1 text-sm text-gray-500">{t('fxRevaluation.noBalancesHint')}</p></div>
              : <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-4 py-3">{t('common.account')}</th><th className="px-4 py-3">{t('fxRevaluation.category')}</th><th className="px-4 py-3">{t('fxRevaluation.currency')}</th><th className="px-4 py-3 text-right">{t('fxRevaluation.foreignBalance')}</th><th className="px-4 py-3 text-right">{t('fxRevaluation.currentBookValue')}</th><th className="px-4 py-3 text-right">{t('fxRevaluation.closingRate')}</th><th className="px-4 py-3 text-right">{t('fxRevaluation.revaluedValue')}</th><th className="px-4 py-3 text-right">{t('fxRevaluation.gainLoss')}</th></tr></thead>
                <tbody className="divide-y divide-gray-100">{balances.map((balance) => <tr key={`${balance.accountId}:${balance.currency}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3"><span className="font-mono text-xs text-gray-500">{balance.accountCode}</span><span className="ml-2 font-medium text-gray-800">{balance.accountName}</span></td>
                  <td className="px-4 py-3 text-gray-600">{t(`fxRevaluation.categories.${balance.category}`)}</td>
                  <td className="px-4 py-3 font-medium">{balance.currency}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(balance.originalAmount, balance.currency)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(balance.currentBookValue)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{balance.closingRate.toLocaleString(undefined, { maximumFractionDigits: 8 })}<span className="block text-xs text-gray-400">{balance.closingRateDate}{balance.rateIsStale ? ` · ${t('fxRevaluation.staleRate')}` : ''}</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(balance.revaluedAmount)}</td>
                  <td className={`px-4 py-3 text-right font-semibold tabular-nums ${balance.unrealisedGainLoss >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{balance.unrealisedGainLoss > 0 ? '+' : ''}{formatMoney(balance.unrealisedGainLoss)}</td>
                </tr>)}</tbody>
              </table></div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-5"><h2 className="text-base font-semibold text-gray-900">{t('fxRevaluation.history')}</h2><p className="mt-1 text-sm text-gray-500">{t('fxRevaluation.historyDescription')}</p></div>
        {historyQuery.isLoading ? <div className="p-8 text-center text-sm text-gray-500">{t('common.loading')}</div>
          : historyQuery.isError ? <div role="alert" className="p-6 text-sm text-red-700">{t('fxRevaluation.historyFailed')}</div>
            : history.length === 0 ? <div className="p-8 text-center text-sm text-gray-500">{t('fxRevaluation.noHistory')}</div>
              : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th className="px-5 py-3">{t('fxRevaluation.date')}</th><th className="px-5 py-3">{t('fxRevaluation.journalEntry')}</th><th className="px-5 py-3 text-right">{t('fxRevaluation.lines')}</th><th className="px-5 py-3 text-right">{t('fxRevaluation.totalUnrealisedGain')}</th><th className="px-5 py-3 text-right">{t('fxRevaluation.totalUnrealisedLoss')}</th><th className="px-5 py-3">{t('common.status')}</th></tr></thead>
                <tbody className="divide-y divide-gray-100">{history.map((item: Row<'fx_revaluations'>) => <tr key={item.id} className="hover:bg-gray-50"><td className="px-5 py-3 font-medium text-gray-800">{item.revaluation_date}</td><td className="px-5 py-3 font-mono text-xs text-gray-500">{item.journal_entry_id ?? '—'}</td><td className="px-5 py-3 text-right tabular-nums">{item.line_count}</td><td className="px-5 py-3 text-right tabular-nums text-emerald-700">{formatMoney(Number(item.total_unrealised_gain))}</td><td className="px-5 py-3 text-right tabular-nums text-rose-700">{formatMoney(Number(item.total_unrealised_loss))}</td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.status === 'posted' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>{item.status === 'posted' ? t('fxRevaluation.posted') : t('fxRevaluation.reversed')}</span></td></tr>)}</tbody>
              </table></div>}
      </section>
    </div>
  );
}
