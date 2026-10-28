import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BranchFilter } from '@/components/reports/BranchFilter';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';
import { classifyTaxAccounts, type TaxAccount } from '@/lib/tax-accounts';
import { downloadFile, generateCSV, reportFilename } from '@/lib/reports/export';
import { fetchAllRows } from '@/lib/paginateQuery';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

interface DateRange { from: string; to: string }
interface WhtJournalLine {
  id: string;
  account_id: string;
  amount_base: number;
  is_debit: boolean;
  tax_code: string | null;
  accounts: { code: string; name: string };
  journal_entries: {
    entry_date: string;
    entry_number: string;
    reference: string | null;
    description: string;
  };
}
interface WhtScheduleLine {
  id: string;
  date: string;
  reference: string;
  description: string;
  accountCode: string;
  accountName: string;
  taxCode: 'wht_10' | 'wht_15' | 'wht_20' | 'unknown';
  amount: number;
}

const amountFormatter = new Intl.NumberFormat('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFor = (year: number, monthIndex: number, day: number) =>
  `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

function formatAmount(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return amount < 0 ? `(${amountFormatter.format(Math.abs(amount))})` : amountFormatter.format(amount);
}

function formatDate(value: string, locale: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function normalizeTaxCode(value: string | null): WhtScheduleLine['taxCode'] {
  if (value === 'wht_10' || value === 'wht_15' || value === 'wht_20') return value;
  return 'unknown';
}

function labelForTaxCode(code: WhtScheduleLine['taxCode'], t: (key: string) => string): string {
  if (code === 'unknown') return t('reports.whtSchedule.unknownTaxCode');
  return t(`reports.whtSchedule.${code}`);
}

function MonthYearControls({ month, year, onMonthChange, onYearChange }: {
  month: number;
  year: number;
  onMonthChange: (value: number) => void;
  onYearChange: (value: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const currentYear = new Date().getFullYear();
  const months = Array.from({ length: 12 }, (_, index) => index + 1);
  const years = Array.from({ length: 6 }, (_, index) => currentYear - 5 + index);
  const selectClass = 'min-h-10 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold text-gray-800">{t('reports.whtSchedule.period')}</legend>
      <div className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="wht-period-month">{t('reports.whtSchedule.month')}</label>
        <select id="wht-period-month" value={month} onChange={(event) => onMonthChange(Number(event.target.value))} className={selectClass}>
          {months.map((value) => <option key={value} value={value}>{new Intl.DateTimeFormat(i18n.language, { month: 'long' }).format(new Date(2020, value - 1, 1))}</option>)}
        </select>
        <label className="sr-only" htmlFor="wht-period-year">{t('reports.whtSchedule.year')}</label>
        <select id="wht-period-year" value={year} onChange={(event) => onYearChange(Number(event.target.value))} className={selectClass}>
          {years.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
    </fieldset>
  );
}

export function WhtSchedulePage() {
  const { t, i18n } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [branchId, setBranchId] = useState<string | null>(null);
  const period = useMemo<DateRange>(() => ({
    from: dateFor(year, month - 1, 1),
    to: dateFor(year, month, 0),
  }), [year, month]);
  const { data: branches = [] } = useAccessibleReportBranches(businessId);
  const branchLabel = branchId
    ? branches.find((branch) => branch.id === branchId)?.name ?? t('reports.shared.selectedBranch')
    : t('reports.shared.allBranches');

  const accountsQuery = useQuery<TaxAccount[]>({
    queryKey: ['wht-schedule-accounts', businessId],
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
  const classifications = useMemo(() => classifyTaxAccounts(accountsQuery.data ?? []), [accountsQuery.data]);
  const whtAccountIds = useMemo(() => classifications.whtPayable.map((account) => account.id), [classifications]);

  const linesQuery = useQuery<WhtScheduleLine[]>({
    queryKey: ['wht-schedule-lines', businessId, period.from, period.to, branchId, whtAccountIds],
    queryFn: async () => {
      if (whtAccountIds.length === 0) return [];
      let query = supabase.from('journal_lines')
        .select(`id, account_id, amount_base, is_debit, tax_code,
          accounts!inner(code, name),
          journal_entries!inner(entry_date, entry_number, reference, description, status, business_id, branch_id)`)
        .eq('business_id', businessId)
        .eq('journal_entries.business_id', businessId)
        .eq('journal_entries.status', 'posted')
        .gte('journal_entries.entry_date', period.from)
        .lte('journal_entries.entry_date', period.to)
        .in('account_id', whtAccountIds);
      if (branchId) query = query.eq('journal_entries.branch_id', branchId);
      const rows = await fetchAllRows<WhtJournalLine>(query);
      return rows.map((row) => ({
        id: row.id,
        date: row.journal_entries.entry_date,
        reference: row.journal_entries.reference || row.journal_entries.entry_number,
        description: row.journal_entries.description,
        accountCode: row.accounts.code,
        accountName: row.accounts.name,
        taxCode: normalizeTaxCode(row.tax_code),
        amount: (row.is_debit ? -1 : 1) * Number(row.amount_base ?? 0),
      }));
    },
    enabled: Boolean(businessId && accountsQuery.isSuccess),
  });

  const groupedLines = useMemo(() => {
    const groups = new Map<WhtScheduleLine['taxCode'], WhtScheduleLine[]>([
      ['wht_10', []], ['wht_15', []], ['wht_20', []], ['unknown', []],
    ]);
    for (const line of linesQuery.data ?? []) groups.get(line.taxCode)?.push(line);
    return [...groups.entries()].filter(([, rows]) => rows.length > 0);
  }, [linesQuery.data]);
  const summaryRows = groupedLines.map(([taxCode, rows]) => ({ taxCode, total: rows.reduce((sum, row) => sum + row.amount, 0), count: rows.length }));
  const totalWithheld = summaryRows.reduce((sum, row) => sum + row.total, 0);
  const isFetching = accountsQuery.isFetching || linesQuery.isFetching;
  const hasError = accountsQuery.isError || linesQuery.isError;
  const hasActivity = (linesQuery.data?.length ?? 0) > 0;

  const runReport = () => {
    void accountsQuery.refetch();
    void linesQuery.refetch();
  };
  const handleExportCSV = () => {
    const headers = [
      t('reports.whtSchedule.taxCode'),
      t('reports.whtSchedule.date'),
      t('reports.whtSchedule.reference'),
      t('reports.whtSchedule.description'),
      t('reports.shared.accountCode'),
      t('reports.shared.accountName'),
      t('reports.whtSchedule.amountMwk'),
    ];
    const rows: (string | number | null)[][] = (linesQuery.data ?? []).map((line) => [
      labelForTaxCode(line.taxCode, (key) => t(key)),
      line.date,
      line.reference,
      line.description,
      line.accountCode,
      line.accountName,
      line.amount,
    ]);
    downloadFile(generateCSV(headers, rows), reportFilename('wht-schedule', period.from, period.to), 'text/csv;charset=utf-8');
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('reports.whtSchedule.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('reports.whtSchedule.description')}</p>
        <p className="mt-2 text-sm text-gray-500">
          {t('reports.whtSchedule.subtitle', { from: formatDate(period.from, i18n.language), to: formatDate(period.to, i18n.language), branch: branchLabel })}
        </p>
      </header>

      <section aria-label={t('reports.shared.filters')} className="mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-1 flex-col gap-4">
          <MonthYearControls month={month} year={year} onMonthChange={setMonth} onYearChange={setYear} />
          <BranchFilter businessId={businessId} value={branchId} onChange={setBranchId} />
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start lg:self-end">
          <button type="button" onClick={runReport} disabled={!businessId || isFetching} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            {t('reports.shared.runReport')}
          </button>
          <button type="button" onClick={handleExportCSV} disabled={isFetching || hasError || !hasActivity} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50">
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('reports.shared.exportCSV')}
          </button>
        </div>
      </section>

      {hasError && <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <span>{t('reports.whtSchedule.error')}</span>
        <button type="button" onClick={runReport} className="font-semibold underline">{t('common.retry')}</button>
      </div>}

      <section aria-label={t('reports.whtSchedule.summary')} className="mb-6 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold text-gray-800">{t('reports.whtSchedule.summary')}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th scope="col" className="px-4 py-3 text-left">{t('reports.whtSchedule.taxCode')}</th><th scope="col" className="px-4 py-3 text-right">{t('reports.whtSchedule.transactionCount')}</th><th scope="col" className="px-4 py-3 text-right">{t('reports.whtSchedule.amountMwk')}</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {summaryRows.length === 0 ? (
                <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-500">{t('reports.whtSchedule.noData')}</td></tr>
              ) : <>
                {summaryRows.map(({ taxCode, total, count }) => <tr key={taxCode}><th scope="row" className="px-4 py-3 text-left font-medium">{labelForTaxCode(taxCode, (key) => t(key))}</th><td className="px-4 py-3 text-right tabular-nums">{count}</td><td className="px-4 py-3 text-right tabular-nums">{formatAmount(total)}</td></tr>)}
                <tr className="bg-gray-50 font-semibold"><th scope="row" colSpan={2} className="px-4 py-3 text-left">{t('reports.whtSchedule.totalWithheld')}</th><td className="px-4 py-3 text-right tabular-nums">{formatAmount(totalWithheld)}</td></tr>
              </>}
            </tbody>
          </table>
        </div>
      </section>

      {isFetching && <p role="status" className="mb-4 text-sm text-gray-500">{t('reports.shared.loading')}</p>}
      <section aria-label={t('reports.whtSchedule.details')} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3 sm:px-5"><h2 className="text-sm font-semibold text-gray-800">{t('reports.whtSchedule.details')}</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500"><tr><th scope="col" className="px-4 py-3 text-left">{t('reports.whtSchedule.date')}</th><th scope="col" className="px-4 py-3 text-left">{t('reports.whtSchedule.reference')}</th><th scope="col" className="px-4 py-3 text-left">{t('reports.whtSchedule.description')}</th><th scope="col" className="px-4 py-3 text-left">{t('reports.shared.accountCode')}</th><th scope="col" className="px-4 py-3 text-left">{t('reports.whtSchedule.taxCode')}</th><th scope="col" className="px-4 py-3 text-right">{t('reports.whtSchedule.amountMwk')}</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {groupedLines.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">{t('reports.whtSchedule.noData')}</td></tr>
              ) : groupedLines.map(([taxCode, rows]) => <FragmentGroup key={taxCode} label={labelForTaxCode(taxCode, (key) => t(key))} rows={rows} locale={i18n.language} t={t} />)}
              {groupedLines.length > 0 && <tr className="bg-gray-50 font-semibold"><th scope="row" colSpan={5} className="px-4 py-3 text-left">{t('reports.whtSchedule.totalWithheld')}</th><td className="px-4 py-3 text-right tabular-nums">{formatAmount(totalWithheld)}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function FragmentGroup({ label, rows, locale, t }: {
  label: string;
  rows: WhtScheduleLine[];
  locale: string;
  t: (key: string) => string;
}) {
  return <>
    <tr className="bg-gray-50 font-semibold text-gray-800"><th colSpan={6} className="px-4 py-2 text-left">{label}</th></tr>
    {rows.map((row) => <tr key={row.id}>
      <td className="whitespace-nowrap px-4 py-3">{formatDate(row.date, locale)}</td>
      <td className="whitespace-nowrap px-4 py-3">{row.reference || t('reports.whtSchedule.noReference')}</td>
      <td className="px-4 py-3">{row.description || t('reports.whtSchedule.noDescription')}</td>
      <td className="px-4 py-3 font-mono text-xs">{row.accountCode}</td>
      <td className="px-4 py-3">{labelForTaxCode(row.taxCode, t)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{formatAmount(row.amount)}</td>
    </tr>)}
  </>;
}
