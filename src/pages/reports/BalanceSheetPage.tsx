import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { ReportExportButtons } from '@/components/reports/ReportExportButtons';
import { downloadFile, generateCSV, printReport, reportFilename } from '@/lib/reports/export';
import { useTranslation } from 'react-i18next';
import { BranchFilter } from '@/components/reports/BranchFilter';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';
import { ReportRepository, type TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { supabase } from '@/lib/supabase';
import {
  balanceSheetDateForPreset,
  computeBalanceSheet,
  hasActiveRetainedEarningsBalance,
  isValidAsOfDate,
} from '@/lib/reports/balanceSheet';
import { useAppStore } from '@/store/useAppStore';

const CUMULATIVE_FROM_DATE = '0001-01-01';
const EMPTY_ROWS: TrialBalanceRow[] = [];
const amountFormatter = new Intl.NumberFormat('en-MW', {
  style: 'currency',
  currency: 'MWK',
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type DatePreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastYear';
type ActiveDatePreset = DatePreset | 'custom';

const DATE_PRESETS: { key: DatePreset; labelKey: string }[] = [
  { key: 'thisMonth', labelKey: 'reports.balanceSheet.endOfMonth' },
  { key: 'lastMonth', labelKey: 'reports.balanceSheet.endOfLastMonth' },
  { key: 'thisQuarter', labelKey: 'reports.balanceSheet.endOfQuarter' },
  { key: 'lastYear', labelKey: 'reports.balanceSheet.endOfLastYear' },
];

const ASSET_TOTAL_LABELS = {
  currentAssets: 'reports.balanceSheet.totalCurrentAssets',
  nonCurrentAssets: 'reports.balanceSheet.totalNonCurrentAssets',
} as const;
const LIABILITY_TOTAL_LABELS = {
  currentLiabilities: 'reports.balanceSheet.totalCurrentLiabilities',
  nonCurrentLiabilities: 'reports.balanceSheet.totalNonCurrentLiabilities',
} as const;

function formatAmount(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return safeValue < 0
    ? `(${amountFormatter.format(Math.abs(safeValue))})`
    : amountFormatter.format(safeValue);
}

function formatDate(date: string, locale: string): string {
  if (!date) return date;
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function AccountRows({ accounts }: { accounts: ReturnType<typeof computeBalanceSheet>['assets'][number]['accounts'] }) {
  return (
    <>
      {accounts.map((account) => {
        if (Math.abs(account.amount) < 0.000001) return null;
        return (
          <div key={account.accountId} className={`report-line flex items-baseline justify-between gap-4 px-3 py-2 text-sm ${account.amount < 0 ? 'text-red-700' : 'text-gray-700'}`}>
            <div className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: `${account.level}rem` }}>
              <span className="shrink-0 font-mono text-[11px] text-gray-500">{account.accountCode}</span>
              <span className="truncate">{account.accountName}</span>
            </div>
            <span className="shrink-0 whitespace-nowrap text-right tabular-nums">{formatAmount(account.amount)}</span>
          </div>
        );
      })}
    </>
  );
}

function StatementSection({
  section,
  totalLabelKey,
}: {
  section: ReturnType<typeof computeBalanceSheet>['assets'][number];
  totalLabelKey: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="report-section border-t border-gray-100 py-3 first:border-t-0">
      <h3 className="section-header px-3 py-2 text-sm font-semibold text-gray-800">{t(section.labelKey)}</h3>
      <AccountRows accounts={section.accounts} />
      <div className="total-row mt-1 flex items-center justify-between gap-4 border-t border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">
        <span>{t(totalLabelKey)}</span>
        <span className="whitespace-nowrap text-right tabular-nums">{formatAmount(section.total)}</span>
      </div>
    </section>
  );
}

export function BalanceSheetPage() {
  const { t, i18n } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const [asOfDate, setAsOfDate] = useState(() => balanceSheetDateForPreset('thisMonth'));
  const [activePreset, setActivePreset] = useState<ActiveDatePreset>('thisMonth');
  const [branchId, setBranchId] = useState<string | null>(null);
  const { data: branches = [] } = useAccessibleReportBranches(businessId);
  const validAsOfDate = isValidAsOfDate(asOfDate);
  const selectedBranch = branches.find((branch) => branch.id === branchId);
  const branchLabel = branchId
    ? selectedBranch?.name ?? t('reports.shared.selectedBranch')
    : t('reports.shared.allBranches');

  const reportQuery = useQuery<TrialBalanceRow[]>({
    queryKey: ['balance-sheet', businessId, asOfDate, branchId],
    queryFn: () => ReportRepository.getTrialBalance(supabase, {
      businessId,
      dateFrom: CUMULATIVE_FROM_DATE,
      dateTo: asOfDate,
      branchId,
    }),
    enabled: Boolean(businessId && validAsOfDate),
  });

  const rows = reportQuery.data ?? EMPTY_ROWS;
  const retainedEarningsAccountHasBalance = hasActiveRetainedEarningsBalance(rows);
  const report = useMemo(
    () => computeBalanceSheet(rows, retainedEarningsAccountHasBalance),
    [rows, retainedEarningsAccountHasBalance],
  );
  const hasActivity = [...report.assets, ...report.liabilities, ...report.equity]
    .some((section) => section.accounts.some((account) => Math.abs(account.amount) > 0.000001))
    || Math.abs(report.retainedEarnings) > 0.000001;
  const totalLiabilitiesAndEquity = report.totalLiabilities + report.totalEquity;

  const selectPreset = (preset: DatePreset) => {
    setActivePreset(preset);
    setAsOfDate(balanceSheetDateForPreset(preset));
  };
  const refresh = () => void reportQuery.refetch();

  const handleExportCSV = () => {
    const csvRows: (string | number | null)[][] = [];
    const addGroup = (label: string) => csvRows.push([label, '', '', null]);
    const addAccounts = (section: ReturnType<typeof computeBalanceSheet>['assets'][number]) => {
      const sectionLabel = t(section.labelKey);
      addGroup(sectionLabel);
      for (const account of section.accounts) {
        if (Math.abs(account.amount) < 0.000001) continue;
        csvRows.push([sectionLabel, account.accountCode, account.accountName, account.amount]);
      }
    };
    const addSubtotal = (label: string, amount: number) => csvRows.push(['', '', label, amount]);

    addGroup(t('reports.balanceSheet.assets'));
    for (const section of report.assets) {
      addAccounts(section);
      const totalLabelKey = ASSET_TOTAL_LABELS[section.key as keyof typeof ASSET_TOTAL_LABELS];
      addSubtotal(t(totalLabelKey), section.total);
    }
    addSubtotal(t('reports.balanceSheet.totalAssets'), report.totalAssets);

    addGroup(t('reports.balanceSheet.liabilities'));
    for (const section of report.liabilities) {
      addAccounts(section);
      const totalLabelKey = LIABILITY_TOTAL_LABELS[section.key as keyof typeof LIABILITY_TOTAL_LABELS];
      addSubtotal(t(totalLabelKey), section.total);
    }
    addSubtotal(t('reports.balanceSheet.totalLiabilities'), report.totalLiabilities);

    addGroup(t('reports.balanceSheet.equity'));
    for (const section of report.equity) {
      for (const account of section.accounts) {
        if (Math.abs(account.amount) < 0.000001) continue;
        csvRows.push([t(section.labelKey), account.accountCode, account.accountName, account.amount]);
      }
    }
    addSubtotal(t('reports.balanceSheet.retainedEarnings'), report.retainedEarnings);
    addSubtotal(t('reports.balanceSheet.totalEquity'), report.totalEquity);
    addSubtotal(t('reports.balanceSheet.totalLiabilitiesAndEquity'), totalLiabilitiesAndEquity);

    downloadFile(
      generateCSV([
        t('reports.shared.section'),
        t('reports.shared.accountCode'),
        t('reports.shared.accountName'),
        t('reports.shared.balanceMwk'),
      ], csvRows),
      reportFilename('balance-sheet', asOfDate, asOfDate),
      'text/csv;charset=utf-8',
    );
  };

  return (
    <main className="report-container mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="report-header mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('reports.balanceSheet.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('reports.balanceSheet.description')}</p>
        <p className="subtitle mt-2 text-sm text-gray-500">
          {t('reports.balanceSheet.subtitle', { date: formatDate(asOfDate, i18n.language), branch: branchLabel })}
        </p>
      </header>

      <section aria-label={t('reports.shared.filters')} className="report-filters mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-gray-800">{t('reports.balanceSheet.asOf')}</legend>
          <div className="flex flex-wrap items-center gap-2">
            {DATE_PRESETS.map(({ key, labelKey }) => (
              <button
                key={key}
                type="button"
                aria-pressed={activePreset === key}
                onClick={() => selectPreset(key)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  activePreset === key
                    ? 'border-brand-600 bg-brand-50 text-brand-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {t(labelKey)}
              </button>
            ))}
            <label htmlFor="balance-sheet-as-of-date" className="sr-only">{t('reports.balanceSheet.asOf')}</label>
            <input
              id="balance-sheet-as-of-date"
              aria-label={t('reports.balanceSheet.asOf')}
              type="date"
              value={asOfDate}
              onChange={(event) => {
                setActivePreset('custom');
                setAsOfDate(event.target.value);
              }}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </fieldset>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <BranchFilter businessId={businessId} value={branchId} onChange={setBranchId} />
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-end">
            <button
              type="button"
              onClick={refresh}
              disabled={!businessId || !validAsOfDate || reportQuery.isFetching}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${reportQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('reports.shared.runReport')}
            </button>
            <ReportExportButtons
              onExportCSV={handleExportCSV}
              onExportPDF={printReport}
              disabled={reportQuery.isFetching || reportQuery.isError || !hasActivity || !validAsOfDate}
            />
          </div>
        </div>
      </section>

      {reportQuery.isError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{t('reports.balanceSheet.error')}</span>
          <button type="button" onClick={refresh} className="font-semibold underline">{t('common.retry')}</button>
        </div>
      )}

      {validAsOfDate && !reportQuery.isFetching && !reportQuery.isError && hasActivity && (
        <div
          role={report.isBalanced ? 'status' : 'alert'}
          className={`mb-4 flex items-center gap-2 rounded-xl border p-4 text-sm font-medium ${
            report.isBalanced
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {report.isBalanced
            ? <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />}
          <span>
            {report.isBalanced
              ? t('reports.balanceSheet.balanced')
              : t('reports.balanceSheet.imbalanced', { amount: formatAmount(Math.abs(report.discrepancy)) })}
          </span>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('reports.balanceSheet.title')}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-gray-800">{t('reports.balanceSheet.title')}</h2>
          <p className="text-xs text-gray-500">{t('reports.balanceSheet.asOf')} {formatDate(asOfDate, i18n.language)}</p>
        </div>

        {reportQuery.isFetching ? (
          <div className="space-y-3 p-5" aria-label={t('reports.shared.loading')}>
            {Array.from({ length: 10 }, (_, index) => <div key={index} className="h-8 animate-pulse rounded bg-gray-100" />)}
          </div>
        ) : !validAsOfDate ? (
          <div role="alert" className="flex min-h-56 items-center justify-center px-5 py-10 text-center text-sm text-red-700">
            {t('reports.balanceSheet.invalidAsOfDate')}
          </div>
        ) : !hasActivity && !reportQuery.isError ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
            <p className="font-medium text-gray-800">{t('reports.balanceSheet.noData')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('reports.shared.noData')}</p>
          </div>
        ) : !reportQuery.isError ? (
          <div className="balance-sheet-grid grid grid-cols-1 gap-4 p-4 md:grid-cols-2 sm:p-5">
            <section aria-label={t('reports.balanceSheet.assets')} className="report-section rounded-xl border border-gray-200 p-3 sm:p-4">
              <h2 className="section-header mb-2 border-b-2 border-gray-300 px-3 py-3 text-base font-bold uppercase tracking-wide text-gray-900">
                {t('reports.balanceSheet.assets')}
              </h2>
              {report.assets.map((section) => (
                <StatementSection key={section.key} section={section} totalLabelKey={ASSET_TOTAL_LABELS[section.key as keyof typeof ASSET_TOTAL_LABELS]} />
              ))}
              <div className="total-row mt-2 flex items-center justify-between gap-4 border-t-2 border-gray-400 px-3 py-3 text-sm font-bold text-gray-900">
                <span>{t('reports.balanceSheet.totalAssets')}</span>
                <span className="whitespace-nowrap text-right tabular-nums">{formatAmount(report.totalAssets)}</span>
              </div>
            </section>

            <section aria-label={t('reports.balanceSheet.liabilitiesAndEquity')} className="report-section rounded-xl border border-gray-200 p-3 sm:p-4">
              <h2 className="section-header mb-2 border-b-2 border-gray-300 px-3 py-3 text-base font-bold uppercase tracking-wide text-gray-900">
                {t('reports.balanceSheet.liabilitiesAndEquity')}
              </h2>
              {report.liabilities.map((section) => (
                <StatementSection key={section.key} section={section} totalLabelKey={LIABILITY_TOTAL_LABELS[section.key as keyof typeof LIABILITY_TOTAL_LABELS]} />
              ))}
              <div className="total-row mt-1 flex items-center justify-between gap-4 border-t-2 border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900">
                <span>{t('reports.balanceSheet.totalLiabilities')}</span>
                <span className="whitespace-nowrap text-right tabular-nums">{formatAmount(report.totalLiabilities)}</span>
              </div>

              {report.equity.map((section) => (
                <section key={section.key} className="border-t border-gray-100 py-3">
                  <h3 className="section-header px-3 py-2 text-sm font-semibold text-gray-800">{t(section.labelKey)}</h3>
                  <AccountRows accounts={section.accounts} />
                  <div className="flex items-center justify-between gap-4 px-3 py-2 text-sm text-gray-700">
                    <span>{t('reports.balanceSheet.retainedEarnings')}</span>
                    <span className={`whitespace-nowrap text-right tabular-nums ${report.retainedEarnings < 0 ? 'text-red-700' : ''}`}>
                      {formatAmount(report.retainedEarnings)}
                    </span>
                  </div>
                  <div className="total-row mt-1 flex items-center justify-between gap-4 border-t border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">
                    <span>{t('reports.balanceSheet.totalEquity')}</span>
                    <span className="whitespace-nowrap text-right tabular-nums">{formatAmount(report.totalEquity)}</span>
                  </div>
                </section>
              ))}
              <div className="total-row mt-2 flex items-center justify-between gap-4 border-t-2 border-gray-400 px-3 py-3 text-sm font-bold text-gray-900">
                <span>{t('reports.balanceSheet.totalLiabilitiesAndEquity')}</span>
                <span className="whitespace-nowrap text-right tabular-nums">{formatAmount(totalLiabilitiesAndEquity)}</span>
              </div>
            </section>
          </div>
        ) : null}
        {!reportQuery.isFetching && hasActivity && !reportQuery.isError && (
          <p className="border-t border-gray-100 px-4 py-2 text-right text-xs text-gray-500">
            {t('reports.balanceSheet.currencyNote')}
          </p>
        )}
      </section>
    </main>
  );
}
