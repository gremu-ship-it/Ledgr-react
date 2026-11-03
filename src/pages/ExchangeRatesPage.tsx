import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownUp, CircleAlert, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import type { FxRateWithNames } from '@/dal/repositories/FxRevaluationRepository';

export function ExchangeRatesPage() {
  const { t } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const currentUser = useAppStore((state) => state.currentUser);
  const businessId = currentBusiness?.business.id;
  const queryClient = useQueryClient();
  const [pairFilter, setPairFilter] = useState('');
  const [fromCurrency, setFromCurrency] = useState('');
  const [toCurrency, setToCurrency] = useState('');
  const [rate, setRate] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [formError, setFormError] = useState('');
  const [saved, setSaved] = useState(false);

  const currenciesQuery = useQuery({
    queryKey: ['fx-revaluation', 'currencies'],
    queryFn: () => repos.fxRevaluation.getCurrencies(),
  });
  const ratesQuery = useQuery({
    queryKey: ['exchange-rates', businessId],
    queryFn: () => repos.fxRevaluation.getCurrentRates(businessId!),
    enabled: Boolean(businessId),
  });

  const rates = useMemo(() => {
    const needle = pairFilter.trim().toLowerCase();
    if (!needle) return ratesQuery.data ?? [];
    return (ratesQuery.data ?? []).filter((item) =>
      `${item.from_currency} ${item.fromCurrencyName} ${item.to_currency} ${item.toCurrencyName}`.toLowerCase().includes(needle),
    );
  }, [pairFilter, ratesQuery.data]);

  const mutation = useMutation({
    mutationFn: () => repos.fxRevaluation.setRate(
      businessId!, fromCurrency, toCurrency, Number(rate), effectiveDate, currentUser?.id,
    ),
    onSuccess: async () => {
      setFormError('');
      setSaved(true);
      setRate('');
      await queryClient.invalidateQueries({ queryKey: ['exchange-rates', businessId] });
    },
    onError: () => {
      setSaved(false);
      setFormError(t('exchangeRates.saveFailed'));
    },
  });

  const currencies = currenciesQuery.data ?? [];
  const currencyName = (code: string) => currencies.find((item) => item.code === code)?.name ?? code;
  const canSubmit = Boolean(fromCurrency && toCurrency && fromCurrency !== toCurrency && rate && effectiveDate);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <p className="text-sm font-medium text-brand-700">{t('exchangeRates.eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-semibold text-gray-900">{t('exchangeRates.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">{t('exchangeRates.subtitle')}</p>
      </header>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <Plus className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <h2 className="text-base font-semibold text-gray-900">{t('exchangeRates.addRate')}</h2>
        </div>
        <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" onSubmit={(event) => {
          event.preventDefault();
          setSaved(false);
          setFormError('');
          mutation.mutate();
        }}>
          <label className="space-y-1 text-sm font-medium text-gray-700">
            <span>{t('exchangeRates.fromCurrency')}</span>
            <select required value={fromCurrency} onChange={(event) => setFromCurrency(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5">
              <option value="">{t('exchangeRates.chooseCurrency')}</option>
              {currencies.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-gray-700">
            <span>{t('exchangeRates.toCurrency')}</span>
            <select required value={toCurrency} onChange={(event) => setToCurrency(event.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5">
              <option value="">{t('exchangeRates.chooseCurrency')}</option>
              {currencies.map((item) => <option key={item.code} value={item.code}>{item.code} — {item.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-gray-700">
            <span>{t('exchangeRates.rate')}</span>
            <input required min="0.0000000001" step="any" type="number" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} placeholder="1.000000" className="w-full rounded-lg border border-gray-300 px-3 py-2.5" />
          </label>
          <label className="space-y-1 text-sm font-medium text-gray-700">
            <span>{t('exchangeRates.effectiveDate')}</span>
            <input required type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2.5" />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={!canSubmit || mutation.isPending} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50">
              {mutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t('exchangeRates.saveRate')}
            </button>
          </div>
        </form>
        {fromCurrency && toCurrency && fromCurrency === toCurrency && <p className="mt-3 text-sm text-amber-700">{t('exchangeRates.distinctCurrencies')}</p>}
        {formError && <p role="alert" className="mt-3 text-sm text-red-700">{formError}</p>}
        {saved && <p role="status" className="mt-3 text-sm text-emerald-700">{t('exchangeRates.saved')}</p>}
        <p className="mt-3 text-xs text-gray-500">{t('exchangeRates.manualRateNote')}</p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{t('exchangeRates.currentRates')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t('exchangeRates.currentRatesDescription')}</p>
          </div>
          <label className="relative block sm:w-72">
            <span className="sr-only">{t('exchangeRates.filterPairs')}</span>
            <ArrowDownUp className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input value={pairFilter} onChange={(event) => setPairFilter(event.target.value)} placeholder={t('exchangeRates.filterPairs')} className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" />
          </label>
        </div>
        {ratesQuery.isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">{t('common.loading')}</div>
        ) : ratesQuery.isError ? (
          <div role="alert" className="flex items-center gap-2 p-6 text-sm text-red-700"><CircleAlert className="h-4 w-4" />{t('exchangeRates.loadFailed')}</div>
        ) : rates.length === 0 ? (
          <div className="p-10 text-center">
            <p className="font-medium text-gray-800">{pairFilter ? t('exchangeRates.noFilteredRates') : t('exchangeRates.noRates')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('exchangeRates.noRatesHint')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-5 py-3">{t('exchangeRates.currencyPair')}</th><th className="px-5 py-3 text-right">{t('exchangeRates.rate')}</th><th className="px-5 py-3">{t('exchangeRates.effectiveDate')}</th><th className="px-5 py-3">{t('exchangeRates.source')}</th><th className="px-5 py-3">{t('exchangeRates.updated')}</th></tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rates.map((item: FxRateWithNames) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3"><span className="font-semibold text-gray-900">{item.from_currency}/{item.to_currency}</span><span className="ml-2 text-xs text-gray-500">{currencyName(item.from_currency)} → {currencyName(item.to_currency)}</span></td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums">{Number(item.rate).toLocaleString(undefined, { maximumFractionDigits: 10 })}</td>
                    <td className="px-5 py-3 text-gray-600">{item.rate_date}</td>
                    <td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${item.source === 'manual' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{item.source === 'manual' ? t('exchangeRates.manual') : t('exchangeRates.automatic')}</span></td>
                    <td className="px-5 py-3 text-gray-500">{new Date(item.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
