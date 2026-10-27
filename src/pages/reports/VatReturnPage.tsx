import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BranchFilter } from '@/components/reports/BranchFilter';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';
import { ReportRepository, type TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { classifyTaxAccounts, type TaxAccount } from '@/lib/tax-accounts';
import { downloadFile, generateCSV, reportFilename } from '@/lib/reports/export';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

type VatPeriodType = 'monthly' | 'quarterly' | 'ytd';
interface DateRange { from: string; to: string }

const amountFormatter = new Intl.NumberFormat('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFor = (year: number, monthIndex: number, day: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function rangeForVatPeriod(type: VatPeriodType, year: number, selection: number): DateRange {
  if (type === 'monthly') {
    return {
      from: dateFor(year, selection - 1, 1),
      to: dateFor(year, selection, 0),
    };
  }
  if (type === 'quarterly') {
    const firstMonth = (selection - 1) * 3;
    return { from: dateFor(year, firstMonth, 1), to: dateFor(year, firstMonth + 3, 0) };
  }
  const today = new Date();
  const to = year < today.getFullYear()
    ? dateFor(year, 11, 31)
    : dateFor(year, today.getMonth(), today.getDate());
  return { from: dateFor(year, 0, 1), to };
}

function formatAmount(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return amount < 0 ? `(${amountFormatter.format(Math.abs(amount))})` : amountFormatter.format(amount);
}

function formatDate(value: string, locale: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function PeriodControls({
  periodType,
  year,
  selection,
  onPeriodTypeChange,
  onYearChange,
  onSelectionChange,
}: {
  periodType: VatPeriodType;
  year: number;
  selection: number;
  onPeriodTypeChange: (value: VatPeriodType) => void;
  onYearChange: (value: number) => void;
  onSelectionChange: (value: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 5 + index);
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const quarters = [1, 2, 3, 4];
  const selectClass = 'min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold text-gray-800">{t('reports.vatReturn.period')}</legend>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="vat-period-type">{t('reports.vatReturn.periodType')}</label>
        <select id="vat-period-type" value={periodType} onChange={(event) => onPeriodTypeChange(event.target.value as VatPeriodType)} className={selectClass}>
          <option value="monthly">{t('reports.vatReturn.monthly')}</option>
          <option value="quarterly">{t('reports.vatReturn.quarterly')}</option>
          <option value="ytd">{t('reports.vatReturn.yearToDate')}</option>
        </select>
        {periodType !== 'ytd' && (
          <>
            <label className="sr-only" htmlFor="vat-period-selection">
              {t(periodType === 'monthly' ? 'reports.vatReturn.month' : 'reports.vatReturn.quarter')}
            </label>
            <select id="vat-period-selection" value={selection} onChange={(event) => onSelectionChange(Number(event.target.value))} className={selectClass}>
              {(periodType === 'monthly' ? months : quarters).map((value) => {
                const label = periodType === 'monthly'
                  ? new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(2020, value - 1, 1))
                  : t('reports.vatReturn.quarterOption', { quarter: value });
                return <option key={value} value={value}>{label}</option>;
              })}
            </select>
          </>
        )}
        <label className="sr-only" htmlFor="vat-period-year">{t('reports.vatReturn.year')}</label>
        <select id="vat-period-year" value={year} onChange={(event) => onYearChange(Number(event.target.value))} className={selectClass}>
          {years.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
    </fieldset>
  );
}

export function VatReturnPage() {
  const { t, i18n } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const now = new Date();
  const [periodType, setPeriodType] = useState<VatPeriodType>('quarterly');
  const [year, setYear] = useState(now.getFullYear());
  const [selection, setSelection] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [branchId, setBranchId] = useState<string | null>(null);
  const period = useMemo(() => rangeForVatPeriod(periodType, year, selection), [periodType, year, selection]);
  const { data: branches = [] } = useAccessibleReportBranches(businessId);
  const branchLabel = branchId
    ? branches.find((branch) => branch.id === branchId)?.name ?? t('reports.shared.selectedBranch')
    : t('reports.shared.allBranches');

  const accountsQuery = useQuery<TaxAccount[]>({
    queryKey: ['vat-return-accounts', businessId],
    queryFn: async () => {
      const { data, error } = await supabase.from('accounts')
        .select('id, code, name, account_type')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .eq('is_group', false)
        .is('deleted_at', null);
      if (error) throw error;
      return (data ?? []) as TaxAccount[];
    },
    enabled: Boolean(businessId),
  });
  const trialBalanceQuery = useQuery<TrialBalanceRow[]>({
    queryKey: ['vat-return-trial-balance', businessId, period.from, period.to, branchId],
    queryFn: () => ReportRepository.getTrialBalance(supabase, {
      businessId,
      dateFrom: period.from,
      dateTo: period.to,
      branchId,
    }),
    enabled: Boolean(businessId && period.from && period.to && period.from <= period.to),
  });

  const classifications = useMemo(() => classifyTaxAccounts(accountsQuery.data ?? []), [accountsQuery.data]);
  const balancesById = useMemo(() => new Map((trialBalanceQuery.data ?? []).map((row) => [row.account_id, row])), [trialBalanceQuery.data]);
  const detailRows = useMemo(() => [
    ...classifications.outputVat.map((account) => ({
      account,
      categoryKey: 'vatCollected' as const,
      amount: (() => {
        const row = balancesById.get(account.id);
        return Number(row?.total_credit ?? 0) - Number(row?.total_debit ?? 0);
      })(),
    })),
    ...classifications.inputVat.map((account) => ({
      account,
      categoryKey: 'vatPaid' as const,
      amount: (() => {
        const row = balancesById.get(account.id);
        return Number(row?.total_debit ?? 0) - Number(row?.total_credit ?? 0);
      })(),
    })),
  ], [classifications, balancesById]);
  const vatCollected = detailRows.filter((row) => row.categoryKey === 'vatCollected').reduce((sum, row) => sum + row.amount, 0);
  const vatPaid = detailRows.filter((row) => row.categoryKey === 'vatPaid').reduce((sum, row) => sum + row.amount, 0);
  const netPayable = vatCollected - vatPaid;
  const isFetching = accountsQuery.isFetching || trialBalanceQuery.isFetching;
  const hasError = accountsQuery.isError || trialBalanceQuery.isError;
  const hasActivity = detailRows.some((row) => Math.abs(row.amount) > 0.000001);

  const runReport = () => {
    void accountsQuery.refetch();
    void trialBalanceQuery.refetch();
  };
  const handleExportCSV = () => {
    const headers = [
      t('reports.vatReturn.category'),
      t('reports.shared.accountCode'),
      t('reports.shared.accountName'),
      t('reports.vatReturn.amountMwk'),
    ];
    const rows: (string | number | null)[][] = detailRows.map(({ categoryKey, account, amount }) => [t(`reports.vatReturn.${categoryKey}`), account.code, account.name, amount]);
    rows.push([t('reports.vatReturn.vatCollected'), '', '', vatCollected]);
    rows.push([t('reports.vatReturn.vatPaid'), '', '', vatPaid]);
    rows.push([t('reports.vatReturn.netPayable'), '', '', netPayable]);
    downloadFile(generateCSV(headers, rows), reportFilename('vat-return', period.from, period.to), 'text/csv;charset=utf-8');
  };

  const selectPeriodType = (value: VatPeriodType) => {
    setPeriodType(value);
    if (value === 'monthly') setSelection(now.getMonth() + 1);
    else if (value === 'quarterly') setSelection(Math.floor(now.getMonth() / 3) + 1);
  };
  const validPeriod = period.from <= period.to;

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('reports.vatReturn.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('reports.vatReturn.description')}</p>
        <p className="mt-2 text-sm text-gray-500">
          {t('reports.vatReturn.subtitle', { from: formatDate(period.from, i18n.language), to: formatDate(period.to, i18n.language), branch: branchLabel })}
        </p>
      </header>

      <section aria-label={t('reports.shared.filters')} className="mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-1 flex-col gap-4">
          <PeriodControls
            periodType={periodType}
            year={year}
            selection={selection}
            onPeriodTypeChange={selectPeriodType}
            onYearChange={setYear}
            onSelectionChange={setSelection}
          />
          <BranchFilter businessId={businessId} value={branchId} onChange={setBranchId} />
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-end">
          <button type="button" onClick={runReport} disabled={!businessId || !validPeriod || isFetching} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('reports.shared.runReport')}
          </button>
          <button type="button" onClick={handleExportCSV} disabled={isFetching || hasError || !hasActivity || !validPeriod} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('reports.shared.exportCSV')}
          </button>
        </div>
      </section>

      {hasError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <span>{t('reports.vatReturn.error')}</span>
        <button type="button" onClick={runReport} className="font-semibold underline">{t('common.retry')}</button>
      </div>}

      <section aria-label={t('reports.vatReturn.summary')} className="mb-6">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">{t('reports.vatReturn.summary')}</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: t('reports.vatReturn.vatCollected'), value: vatCollected },
            { label: t('reports.vatReturn.vatPaid'), value: vatPaid },
            { label: t('reports.vatReturn.netPayable'), value: netPayable },
          ].map(({ label, value }) => (
            <article key={label} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-sm font-medium text-gray-600">{label}</p>
              <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{formatAmount(value)} <span className="text-sm font-medium text-gray-500">{t('reports.shared.mwk')}</span></p>
            </article>
          ))}
        </div>
      </section>

      {!isFetching && !hasError && !hasActivity && (
        <p role="status" className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">{t('reports.vatReturn.noData')}</p>
      )}
      {isFetching && <p role="status" className="mb-4 text-sm text-gray-500">{t('reports.shared.loading')}</p>}

      <section aria-label={t('reports.vatReturn.details')} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold text-gray-800">{t('reports.vatReturn.details')}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr><th scope="col" className="px-4 py-3 text-left">{t('reports.vatReturn.category')}</th><th scope="col" className="px-4 py-3 text-left">{t('reports.shared.accountCode')}</th><th scope="col" className="px-4 py-3 text-left">{t('reports.shared.accountName')}</th><th scope="col" className="px-4 py-3 text-right">{t('reports.vatReturn.amountMwk')}</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detailRows.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-500">{t('reports.vatReturn.noAccounts')}</td></tr>
              ) : detailRows.map(({ categoryKey, account, amount }) => (
                <tr key={`${categoryKey}-${account.id}`}>
                  <td className="px-4 py-3">{t(`reports.vatReturn.${categoryKey}`)}</td><td className="px-4 py-3 font-mono text-xs">{account.code}</td><td className="px-4 py-3">{account.name}</td><td className="px-4 py-3 text-right tabular-nums">{formatAmount(amount)}</td>
                </tr>
              ))}
              {detailRows.length > 0 && <tr className="bg-gray-50 font-semibold"><th scope="row" colSpan={3} className="px-4 py-3 text-left">{t('reports.vatReturn.netPayable')}</th><td className="px-4 py-3 text-right tabular-nums">{formatAmount(netPayable)}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
