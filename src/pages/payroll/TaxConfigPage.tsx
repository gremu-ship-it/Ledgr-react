import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { TaxBandInput } from '@/lib/repositories/payroll.repository';

interface TaxBand extends TaxBandInput {
  id?: string;
}

function estimatePaye(monthlyGross: number, bands: TaxBand[]): number {
  const taxableIncome = Math.max(0, monthlyGross);
  return Math.round(bands.reduce((total, band) => {
    const taxableInBand = Math.max(0, Math.min(taxableIncome, band.upper_bound ?? taxableIncome) - band.lower_bound);
    return total + taxableInBand * band.rate;
  }, 0) * 100) / 100;
}

function mapTaxBands(rows: Record<string, unknown>[], fallbackCurrency: string): TaxBand[] {
  return rows.map((row) => ({
    id: String(row.id),
    band_number: Number(row.band_number),
    lower_bound: Number(row.lower_bound),
    upper_bound: row.upper_bound == null ? null : Number(row.upper_bound),
    rate: Number(row.rate),
    currency: String(row.currency ?? fallbackCurrency),
  }));
}

function money(value: number, currency: string, language: string): string {
  try {
    return new Intl.NumberFormat(language, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function TaxConfigPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const fiscalYear = useMemo(() => {
    const now = new Date();
    return now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  }, []);
  const [editedBands, setEditedBands] = useState<TaxBand[] | null>(null);
  const [monthlyGross, setMonthlyGross] = useState('2000000');

  const bandsQuery = useQuery({
    queryKey: ['payroll-tax-bands', businessId, fiscalYear],
    enabled: Boolean(businessId),
    queryFn: () => repos.payrollFullCycle.getTaxBands(businessId, fiscalYear),
  });

  const queriedBands = useMemo(() => mapTaxBands(Array.isArray(bandsQuery.data) ? bandsQuery.data : [], currency), [bandsQuery.data, currency]);
  const bands = editedBands ?? queriedBands;

  const saveMutation = useMutation({
    mutationFn: () => repos.payrollFullCycle.updateTaxBands(businessId, fiscalYear, bands),
    onSuccess: async (savedBands) => {
      setEditedBands(mapTaxBands(savedBands, currency));
      await queryClient.invalidateQueries({ queryKey: ['payroll-tax-bands', businessId, fiscalYear] });
    },
  });

  const updateBand = (index: number, update: Partial<TaxBand>) => {
    setEditedBands((current) => (current ?? queriedBands).map((band, bandIndex) => bandIndex === index ? { ...band, ...update } : band));
    saveMutation.reset();
  };

  const addBand = () => {
    setEditedBands((current) => {
      const source = current ?? queriedBands;
      const last = source[source.length - 1];
      const nextLower = last?.upper_bound ?? (last ? last.lower_bound + 1_000_000 : 0);
      const next = [...source];
      if (last && last.upper_bound === null) next[next.length - 1] = { ...last, upper_bound: nextLower };
      next.push({
        band_number: next.length + 1,
        lower_bound: nextLower,
        upper_bound: null,
        rate: 0,
        currency,
      });
      return next;
    });
    saveMutation.reset();
  };

  const removeBand = (index: number) => {
    setEditedBands((current) => (current ?? queriedBands).filter((_, bandIndex) => bandIndex !== index)
      .map((band, bandIndex) => ({ ...band, band_number: bandIndex + 1 })));
    saveMutation.reset();
  };

  const estimatedTax = estimatePaye(Number(monthlyGross) || 0, bands);
  const invalidPreview = bands.length === 0;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{t('payroll.taxConfig')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('payroll.taxConfigDescription')}</p>
      </header>

      {bandsQuery.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.taxConfigLoadFailed')}</p>}
      {saveMutation.isError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.taxConfigSaveFailed')}</p>}
      {saveMutation.isSuccess && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{t('payroll.taxConfigSaved')}</p>}

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
          <div>
            <h2 className="font-semibold text-gray-900">{t('payroll.payeBandsTitle')}</h2>
            <p className="mt-1 text-sm text-gray-600">{t('payroll.fiscalYear')}: {fiscalYear} · {currency}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={addBand} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Plus className="h-4 w-4" aria-hidden="true" />{t('payroll.addBand')}
            </button>
            <button type="button" disabled={saveMutation.isPending || bands.length === 0} onClick={() => saveMutation.mutate()} className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">
              <Save className="h-4 w-4" aria-hidden="true" />{saveMutation.isPending ? t('payroll.savingBands') : t('payroll.saveBands')}
            </button>
          </div>
        </div>
        {bandsQuery.isLoading ? <p role="status" className="p-6 text-sm text-gray-500">{t('payroll.loadingTaxBands')}</p> : bands.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-500">{t('payroll.noTaxBands')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600"><tr>
                <th className="px-4 py-3">{t('payroll.bandNumber')}</th>
                <th className="px-4 py-3">{t('payroll.lowerBound')}</th>
                <th className="px-4 py-3">{t('payroll.upperBound')}</th>
                <th className="px-4 py-3">{t('payroll.rate')}</th>
                <th className="px-4 py-3"><span className="sr-only">{t('payroll.actions')}</span></th>
              </tr></thead>
              <tbody className="divide-y divide-gray-100">
                {bands.map((band, index) => <tr key={band.id ?? band.band_number}>
                  <td className="px-4 py-3">{band.band_number}</td>
                  <td className="px-4 py-3"><input aria-label={`${t('payroll.lowerBound')} ${band.band_number}`} type="number" min="0" value={band.lower_bound} onChange={(event) => updateBand(index, { lower_bound: Number(event.target.value), currency })} className="w-40 rounded-md border border-gray-300 px-2 py-1.5" /></td>
                  <td className="px-4 py-3"><input aria-label={`${t('payroll.upperBound')} ${band.band_number}`} type="number" min="0" value={band.upper_bound ?? ''} placeholder={t('payroll.noUpperLimit')} onChange={(event) => updateBand(index, { upper_bound: event.target.value === '' ? null : Number(event.target.value), currency })} className="w-40 rounded-md border border-gray-300 px-2 py-1.5" /></td>
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><input aria-label={`${t('payroll.rate')} ${band.band_number}`} type="number" min="0" max="100" step="0.01" value={band.rate * 100} onChange={(event) => updateBand(index, { rate: Number(event.target.value) / 100, currency })} className="w-24 rounded-md border border-gray-300 px-2 py-1.5" /><span>%</span></div></td>
                  <td className="px-4 py-3 text-right"><button type="button" aria-label={`${t('payroll.removeBand')} ${band.band_number}`} disabled={bands.length <= 1 || Boolean(band.id)} onClick={() => removeBand(index)} className="rounded-md p-2 text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" aria-hidden="true" /></button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-gray-900">{t('payroll.previewCalculation')}</h2>
        <p className="mt-1 text-sm text-gray-600">{t('payroll.previewCalculationDescription')}</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium text-gray-700">
            {t('payroll.monthlyGross')}
            <input type="number" min="0" value={monthlyGross} onChange={(event) => setMonthlyGross(event.target.value)} className="rounded-md border border-gray-300 px-3 py-2" />
          </label>
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="text-sm text-gray-600">{t('payroll.estimatedPaye')}</p>
            <p className="mt-1 text-xl font-semibold text-gray-900">{invalidPreview ? t('payroll.notAvailable') : money(estimatedTax, currency, i18n.language)}</p>
          </div>
        </div>
      </section>
    </main>
  );
}
