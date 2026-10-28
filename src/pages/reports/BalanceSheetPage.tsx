import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { ReportExportButtons } from '@/components/reports/ReportExportButtons';
import { downloadFile, generateCSV, printReport, reportFilename } from '@/lib/reports/export';
import { useTranslation } from 'react-i18next';
import { BranchFilter } from '@/components/reports/BranchFilter';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import { ReportRepository, type TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { supabase } from '@/lib/supabase';
import {
  balanceSheetDateForPreset,
  computeBalanceSheet,
  hasActiveRetainedEarningsBalance,
  hasUnclosedProfitVariance,
  isValidAsOfDate,
  priorYearAsOfDate,
  type BsSection,
} from '@/lib/reports/balanceSheet';
import { computePnl } from '@/lib/reports/pnl';
import { useAppStore } from '@/store/useAppStore';

const CUMULATIVE_FROM_DATE = '0001-01-01';
const EMPTY_ROWS: TrialBalanceRow[] = [];
const financialStatementRepo = new FinancialStatementRepository(supabase);
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

function ComparisonValues({
  current,
  prior,
  comparePrior,
}: {
  current: number;
  prior: number;
  comparePrior: boolean;
}) {
  if (!comparePrior) {
    return <span className="shrink-0 whitespace-nowrap text-right tabular-nums">{formatAmount(current)}</span>;
  }
  const variance = current - prior;
  return (
    <span className="grid shrink-0 grid-cols-3 gap-x-3 text-right tabular-nums sm:gap-x-4">
      <span className="whitespace-nowrap">{formatAmount(current)}</span>
      <span className="whitespace-nowrap text-gray-500">{formatAmount(prior)}</span>
      <span className={`whitespace-nowrap ${variance < 0 ? 'text-red-700' : 'text-gray-700'}`}>{formatAmount(variance)}</span>
    </span>
  );
}

function ComparisonHeader() {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] gap-x-3 border-b border-gray-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 sm:gap-x-4 sm:text-xs">
      <span />
      <span className="text-right">{t('reports.bs.current')}</span>
      <span className="text-right">{t('reports.bs.priorYear')}</span>
      <span className="text-right">{t('reports.bs.variance')}</span>
    </div>
  );
}

function mergedAccounts(current: BsSection, prior?: BsSection) {
  const accounts = new Map(current.accounts.map((account) => [account.accountId, {
    ...account,
    currentAmount: account.amount,
    priorAmount: 0,
  }]));
  for (const account of prior?.accounts ?? []) {
    const match = accounts.get(account.accountId);
    if (match) match.priorAmount = account.amount;
    else accounts.set(account.accountId, { ...account, currentAmount: 0, priorAmount: account.amount });
  }
  return [...accounts.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode, undefined, { numeric: true }));
}

function AccountRows({
  section,
  priorSection,
  comparePrior,
}: {
  section: BsSection;
  priorSection?: BsSection;
  comparePrior: boolean;
}) {
  return (
    <>
      {mergedAccounts(section, priorSection).map((account) => {
        if (Math.abs(account.currentAmount) < 0.000001 && Math.abs(account.priorAmount) < 0.000001) return null;
        return (
          <div key={account.accountId} className={`report-line flex items-baseline justify-between gap-3 px-3 py-2 text-sm ${account.currentAmount < 0 ? 'text-red-700' : 'text-gray-700'}`}>
            <div className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: `${account.level}rem` }}>
              <span className="shrink-0 font-mono text-[11px] text-gray-500">{account.accountCode}</span>
              <span className="truncate">{account.accountName}</span>
            </div>
            <ComparisonValues current={account.currentAmount} prior={account.priorAmount} comparePrior={comparePrior} />
          </div>
        );
      })}
    </>
  );
}

function StatementSection({
  section,
  priorSection,
  totalLabelKey,
  comparePrior,
}: {
  section: BsSection;
  priorSection?: BsSection;
  totalLabelKey: string;
  comparePrior: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="report-section border-t border-gray-100 py-3 first:border-t-0">
      <h3 className="section-header px-3 py-2 text-sm font-semibold text-gray-800">{t(section.labelKey)}</h3>
      <AccountRows section={section} priorSection={priorSection} comparePrior={comparePrior} />
      <div className="total-row mt-1 flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">
        <span>{t(totalLabelKey)}</span>
        <ComparisonValues current={section.total} prior={priorSection?.total ?? 0} comparePrior={comparePrior} />
      </div>
    </section>
  );
}

function sectionByKey(sections: BsSection[], key: BsSection['key']): BsSection | undefined {
  return sections.find((section) => section.key === key);
}

export function BalanceSheetPage() {
  const { t, i18n } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const [asOfDate, setAsOfDate] = useState(() => balanceSheetDateForPreset('thisMonth'));
  const [activePreset, setActivePreset] = useState<ActiveDatePreset>('thisMonth');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [comparePriorYear, setComparePriorYear] = useState(false);
  const { data: branches = [] } = useAccessibleReportBranches(businessId);
  const validAsOfDate = isValidAsOfDate(asOfDate);
  const priorDate = priorYearAsOfDate(asOfDate);
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
  const priorQuery = useQuery<TrialBalanceRow[]>({
    queryKey: ['balance-sheet-prior-year', businessId, priorDate, branchId],
    queryFn: () => ReportRepository.getTrialBalance(supabase, {
      businessId,
      dateFrom: CUMULATIVE_FROM_DATE,
      dateTo: priorDate,
      branchId,
    }),
    enabled: Boolean(businessId && comparePriorYear && validAsOfDate && priorDate),
  });
  // This existing read-only audit checks the GL against locked statement closing
  // balances at each statement's own date. bank_accounts is a mapping table in
  // the deployed schema (it has no balance column), so this is the meaningful
  // cash/bank reconciliation source without changing the SQL/RPC contract.
  const integrityQuery = useQuery({
    queryKey: ['balance-sheet-integrity', businessId, asOfDate],
    queryFn: () => financialStatementRepo.auditStatementIntegrity(businessId, asOfDate),
    enabled: Boolean(businessId && validAsOfDate),
    staleTime: 5 * 60_000,
  });

  const rows = reportQuery.data ?? EMPTY_ROWS;
  const priorRows = comparePriorYear ? priorQuery.data ?? EMPTY_ROWS : EMPTY_ROWS;
  const retainedEarningsAccountHasBalance = hasActiveRetainedEarningsBalance(rows);
  const report = useMemo(
    () => computeBalanceSheet(rows, retainedEarningsAccountHasBalance),
    [rows, retainedEarningsAccountHasBalance],
  );
  const priorRetainedEarningsAccountHasBalance = hasActiveRetainedEarningsBalance(priorRows);
  const priorReport = useMemo(
    () => computeBalanceSheet(priorRows, priorRetainedEarningsAccountHasBalance),
    [priorRows, priorRetainedEarningsAccountHasBalance],
  );
  const cumulativeProfit = useMemo(() => computePnl(rows).netIncome, [rows]);
  const showUnclosedProfitWarning = hasUnclosedProfitVariance(
    report.discrepancy,
    cumulativeProfit,
    retainedEarningsAccountHasBalance,
  );
  const checks = integrityQuery.data?.checks ?? [];
  const bankCheck = checks.find((check) => check.key === 'bank-reconciliation');
  const fixedAssetCheck = checks.find((check) => check.key === 'fixed-assets');
  const showBankWarning = Boolean(bankCheck && (!bankCheck.ok || bankCheck.findings.length > 0));
  const showFixedAssetWarning = Boolean(fixedAssetCheck && (!fixedAssetCheck.ok || fixedAssetCheck.findings.length > 0));
  const hasIntegrityWarnings = showUnclosedProfitWarning || showBankWarning || showFixedAssetWarning || integrityQuery.isError;
  const isFetching = reportQuery.isFetching || (comparePriorYear && priorQuery.isFetching);
  const hasError = reportQuery.isError || (comparePriorYear && priorQuery.isError);
  const hasActivity = [...report.assets, ...report.liabilities, ...report.equity]
    .some((section) => section.accounts.some((account) => Math.abs(account.amount) > 0.000001))
    || Math.abs(report.retainedEarnings) > 0.000001
    || (comparePriorYear && ([...priorReport.assets, ...priorReport.liabilities, ...priorReport.equity]
      .some((section) => section.accounts.some((account) => Math.abs(account.amount) > 0.000001))
      || Math.abs(priorReport.retainedEarnings) > 0.000001));
  const totalLiabilitiesAndEquity = report.totalLiabilities + report.totalEquity;
  const priorTotalLiabilitiesAndEquity = priorReport.totalLiabilities + priorReport.totalEquity;

  const selectPreset = (preset: DatePreset) => {
    setActivePreset(preset);
    setAsOfDate(balanceSheetDateForPreset(preset));
  };
  const refresh = () => {
    void reportQuery.refetch();
    if (comparePriorYear) void priorQuery.refetch();
    void integrityQuery.refetch();
  };

  const metrics = (current: number, prior: number): (number | null)[] => (
    comparePriorYear ? [current, prior, current - prior] : [current]
  );

  const handleExportCSV = () => {
    const csvRows: (string | number | null)[][] = [];
    const addGroup = (label: string) => csvRows.push([label, '', '', ...metrics(0, 0).map(() => null)]);
    const addAccounts = (section: BsSection, priorSection?: BsSection) => {
      const sectionLabel = t(section.labelKey);
      addGroup(sectionLabel);
      for (const account of mergedAccounts(section, priorSection)) {
        if (Math.abs(account.currentAmount) < 0.000001 && Math.abs(account.priorAmount) < 0.000001) continue;
        csvRows.push([
          sectionLabel,
          account.accountCode,
          account.accountName,
          ...metrics(account.currentAmount, account.priorAmount),
        ]);
      }
    };
    const addSubtotal = (label: string, current: number, prior: number) => {
      csvRows.push(['', '', label, ...metrics(current, prior)]);
    };

    addGroup(t('reports.balanceSheet.assets'));
    for (const section of report.assets) {
      const priorSection = sectionByKey(priorReport.assets, section.key);
      addAccounts(section, priorSection);
      const totalLabelKey = ASSET_TOTAL_LABELS[section.key as keyof typeof ASSET_TOTAL_LABELS];
      addSubtotal(t(totalLabelKey), section.total, priorSection?.total ?? 0);
    }
    addSubtotal(t('reports.balanceSheet.totalAssets'), report.totalAssets, priorReport.totalAssets);

    addGroup(t('reports.balanceSheet.liabilities'));
    for (const section of report.liabilities) {
      const priorSection = sectionByKey(priorReport.liabilities, section.key);
      addAccounts(section, priorSection);
      const totalLabelKey = LIABILITY_TOTAL_LABELS[section.key as keyof typeof LIABILITY_TOTAL_LABELS];
      addSubtotal(t(totalLabelKey), section.total, priorSection?.total ?? 0);
    }
    addSubtotal(t('reports.balanceSheet.totalLiabilities'), report.totalLiabilities, priorReport.totalLiabilities);

    addGroup(t('reports.balanceSheet.equity'));
    const currentEquity = report.equity[0];
    const priorEquity = priorReport.equity[0];
    if (currentEquity) {
      for (const account of mergedAccounts(currentEquity, priorEquity)) {
        if (Math.abs(account.currentAmount) < 0.000001 && Math.abs(account.priorAmount) < 0.000001) continue;
        csvRows.push([
          t(currentEquity.labelKey), account.accountCode, account.accountName,
          ...metrics(account.currentAmount, account.priorAmount),
        ]);
      }
    }
    addSubtotal(t('reports.balanceSheet.retainedEarnings'), report.retainedEarnings, priorReport.retainedEarnings);
    addSubtotal(t('reports.balanceSheet.totalEquity'), report.totalEquity, priorReport.totalEquity);
    addSubtotal(t('reports.balanceSheet.totalLiabilitiesAndEquity'), totalLiabilitiesAndEquity, priorTotalLiabilitiesAndEquity);

    downloadFile(
      generateCSV([
        t('reports.shared.section'),
        t('reports.shared.accountCode'),
        t('reports.shared.accountName'),
        t(comparePriorYear ? 'reports.bs.current' : 'reports.shared.balanceMwk'),
        ...(comparePriorYear ? [t('reports.bs.priorYear'), t('reports.bs.variance')] : []),
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
          <div className="flex flex-wrap items-center gap-4 self-start sm:self-end">
            <label className="inline-flex min-h-10 items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={comparePriorYear}
                onChange={(event) => setComparePriorYear(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              {t('reports.bs.comparePriorYear')}
            </label>
            <button
              type="button"
              onClick={refresh}
              disabled={!businessId || !validAsOfDate || isFetching}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('reports.shared.runReport')}
            </button>
            <ReportExportButtons
              onExportCSV={handleExportCSV}
              onExportPDF={printReport}
              disabled={isFetching || hasError || !hasActivity || !validAsOfDate}
            />
          </div>
        </div>
      </section>

      {(reportQuery.isError || (comparePriorYear && priorQuery.isError)) && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{t('reports.balanceSheet.error')}</span>
          <button type="button" onClick={refresh} className="font-semibold underline">{t('common.retry')}</button>
        </div>
      )}

      {validAsOfDate && !isFetching && !hasError && hasActivity && (
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

      {validAsOfDate && !isFetching && !hasError && hasActivity
        && (showUnclosedProfitWarning || showBankWarning || showFixedAssetWarning || integrityQuery.isSuccess || integrityQuery.isError) && (
        <section
          aria-label={t('reports.bs.integrityTitle')}
          role="status"
          className={`mb-4 space-y-1 rounded-xl border p-4 text-sm ${hasIntegrityWarnings
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          <h2 className="flex items-center gap-2 font-semibold">
            {hasIntegrityWarnings
              ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              : <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {t(hasIntegrityWarnings ? 'reports.bs.integrityWarningTitle' : 'reports.bs.integrityTitle')}
          </h2>
          {showUnclosedProfitWarning && <p>{t('reports.bs.retainedEarningsProfitWarning')}</p>}
          {showBankWarning && <p>{t('reports.bs.bankReconciliationWarning')}</p>}
          {showFixedAssetWarning && <p>{t('reports.bs.fixedAssetWarning')}</p>}
          {integrityQuery.isError && <p>{t('reports.bs.integrityUnavailable')}</p>}
          {!showUnclosedProfitWarning && !showBankWarning && !showFixedAssetWarning && !integrityQuery.isError && (
            <p>{t('reports.bs.integrityClear')}</p>
          )}
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('reports.balanceSheet.title')}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-gray-800">{t('reports.balanceSheet.title')}</h2>
          <div className="text-right text-xs text-gray-500">
            <p>{t('reports.balanceSheet.asOf')} {formatDate(asOfDate, i18n.language)}</p>
            {comparePriorYear && <p>{t('reports.bs.priorYear')}: {formatDate(priorDate, i18n.language)}</p>}
          </div>
        </div>

        {isFetching ? (
          <div className="space-y-3 p-5" aria-label={t('reports.shared.loading')}>
            {Array.from({ length: 10 }, (_, index) => <div key={index} className="h-8 animate-pulse rounded bg-gray-100" />)}
          </div>
        ) : !validAsOfDate ? (
          <div role="alert" className="flex min-h-56 items-center justify-center px-5 py-10 text-center text-sm text-red-700">
            {t('reports.balanceSheet.invalidAsOfDate')}
          </div>
        ) : !hasActivity && !hasError ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
            <p className="font-medium text-gray-800">{t('reports.balanceSheet.noData')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('reports.shared.noData')}</p>
          </div>
        ) : !hasError ? (
          <div className="balance-sheet-grid grid grid-cols-1 gap-4 p-4 md:grid-cols-2 sm:p-5">
            <section aria-label={t('reports.balanceSheet.assets')} className="report-section rounded-xl border border-gray-200 p-3 sm:p-4">
              <h2 className="section-header mb-2 border-b-2 border-gray-300 px-3 py-3 text-base font-bold uppercase tracking-wide text-gray-900">
                {t('reports.balanceSheet.assets')}
              </h2>
              {comparePriorYear && <ComparisonHeader />}
              {report.assets.map((section) => (
                <StatementSection
                  key={section.key}
                  section={section}
                  priorSection={sectionByKey(priorReport.assets, section.key)}
                  comparePrior={comparePriorYear}
                  totalLabelKey={ASSET_TOTAL_LABELS[section.key as keyof typeof ASSET_TOTAL_LABELS]}
                />
              ))}
              <div className="total-row mt-2 flex items-center justify-between gap-3 border-t-2 border-gray-400 px-3 py-3 text-sm font-bold text-gray-900">
                <span>{t('reports.balanceSheet.totalAssets')}</span>
                <ComparisonValues current={report.totalAssets} prior={priorReport.totalAssets} comparePrior={comparePriorYear} />
              </div>
            </section>

            <section aria-label={t('reports.balanceSheet.liabilitiesAndEquity')} className="report-section rounded-xl border border-gray-200 p-3 sm:p-4">
              <h2 className="section-header mb-2 border-b-2 border-gray-300 px-3 py-3 text-base font-bold uppercase tracking-wide text-gray-900">
                {t('reports.balanceSheet.liabilitiesAndEquity')}
              </h2>
              {comparePriorYear && <ComparisonHeader />}
              {report.liabilities.map((section) => (
                <StatementSection
                  key={section.key}
                  section={section}
                  priorSection={sectionByKey(priorReport.liabilities, section.key)}
                  comparePrior={comparePriorYear}
                  totalLabelKey={LIABILITY_TOTAL_LABELS[section.key as keyof typeof LIABILITY_TOTAL_LABELS]}
                />
              ))}
              <div className="total-row mt-1 flex items-center justify-between gap-3 border-t border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900">
                <span>{t('reports.balanceSheet.totalLiabilities')}</span>
                <ComparisonValues current={report.totalLiabilities} prior={priorReport.totalLiabilities} comparePrior={comparePriorYear} />
              </div>

              {report.equity.map((section) => {
                const priorSection = sectionByKey(priorReport.equity, section.key);
                return (
                  <section key={section.key} className="border-t border-gray-100 py-3">
                    <h3 className="section-header px-3 py-2 text-sm font-semibold text-gray-800">{t(section.labelKey)}</h3>
                    <AccountRows section={section} priorSection={priorSection} comparePrior={comparePriorYear} />
                    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm text-gray-700">
                      <span>{t('reports.balanceSheet.retainedEarnings')}</span>
                      <ComparisonValues current={report.retainedEarnings} prior={priorReport.retainedEarnings} comparePrior={comparePriorYear} />
                    </div>
                    <div className="total-row mt-1 flex items-center justify-between gap-3 border-t border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900">
                      <span>{t('reports.balanceSheet.totalEquity')}</span>
                      <ComparisonValues current={report.totalEquity} prior={priorReport.totalEquity} comparePrior={comparePriorYear} />
                    </div>
                  </section>
                );
              })}
              <div className="total-row mt-2 flex items-center justify-between gap-3 border-t-2 border-gray-400 px-3 py-3 text-sm font-bold text-gray-900">
                <span>{t('reports.balanceSheet.totalLiabilitiesAndEquity')}</span>
                <ComparisonValues current={totalLiabilitiesAndEquity} prior={priorTotalLiabilitiesAndEquity} comparePrior={comparePriorYear} />
              </div>
            </section>
          </div>
        ) : null}
        {!isFetching && hasActivity && !hasError && (
          <p className="border-t border-gray-100 px-4 py-2 text-right text-xs text-gray-500">
            {t('reports.balanceSheet.currencyNote')}
          </p>
        )}
      </section>
    </main>
  );
}
