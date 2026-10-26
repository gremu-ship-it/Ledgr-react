import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, LoaderCircle, RefreshCw } from 'lucide-react';
import { ReportExportButtons } from '@/components/reports/ReportExportButtons';
import { downloadFile, generateCSV, printReport, reportFilename } from '@/lib/reports/export';
import { useTranslation } from 'react-i18next';
import { BranchFilter } from '@/components/reports/BranchFilter';
import { PeriodPicker } from '@/components/reports/PeriodPicker';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';
import { ReportRepository, type TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { supabase } from '@/lib/supabase';
import { computeBalanceSheet, hasActiveRetainedEarningsBalance } from '@/lib/reports/balanceSheet';
import {
  CASH_FLOW_BALANCE_START_DATE,
  computeCashFlow,
  dayBefore,
  detectCashAccountCodes,
  isValidCashFlowPeriod,
} from '@/lib/reports/cashFlow';
import { computePnl } from '@/lib/reports/pnl';
import { periodForPreset } from '@/lib/reports/periods';
import { useAppStore } from '@/store/useAppStore';

const initialPeriod = periodForPreset('thisMonth');
const EMPTY_ROWS: TrialBalanceRow[] = [];
const amountFormatter = new Intl.NumberFormat('en-MW', {
  style: 'currency',
  currency: 'MWK',
  currencyDisplay: 'code',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface CashFlowQueryData {
  pnlRows: TrialBalanceRow[];
  currentRows: TrialBalanceRow[];
  priorRows: TrialBalanceRow[];
}

function formatDate(dateValue: string, locale: string): string {
  if (!dateValue) return dateValue;
  const [year, month, day] = dateValue.split('-').map(Number);
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setDate(1);
  date.setFullYear(year, month - 1, day);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function formatAmount(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return safeValue < 0
    ? `(${amountFormatter.format(Math.abs(safeValue))})`
    : amountFormatter.format(safeValue);
}

export function CashFlowPage() {
  const { t, i18n } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const [period, setPeriod] = useState(initialPeriod);
  const [branchId, setBranchId] = useState<string | null>(null);
  const { data: branches = [] } = useAccessibleReportBranches(businessId);
  const priorDate = dayBefore(period.from);
  const validPeriod = isValidCashFlowPeriod(period);
  const branchLabel = branchId
    ? branches.find((branch) => branch.id === branchId)?.name ?? t('reports.shared.selectedBranch')
    : t('reports.shared.allBranches');

  const reportQuery = useQuery<CashFlowQueryData>({
    queryKey: ['cash-flow', businessId, period.from, period.to, branchId],
    queryFn: async () => {
      const priorRequest = priorDate && priorDate >= CASH_FLOW_BALANCE_START_DATE
        ? ReportRepository.getTrialBalance(supabase, {
          businessId,
          dateFrom: CASH_FLOW_BALANCE_START_DATE,
          dateTo: priorDate,
          branchId,
        })
        : Promise.resolve(EMPTY_ROWS);
      const [pnlRows, currentRows, priorRows] = await Promise.all([
        ReportRepository.getTrialBalance(supabase, {
          businessId,
          dateFrom: period.from,
          dateTo: period.to,
          branchId,
        }),
        ReportRepository.getTrialBalance(supabase, {
          businessId,
          dateFrom: CASH_FLOW_BALANCE_START_DATE,
          dateTo: period.to,
          branchId,
        }),
        priorRequest,
      ]);
      return { pnlRows, currentRows, priorRows };
    },
    enabled: Boolean(businessId && validPeriod && priorDate),
  });

  const pnlRows = reportQuery.data?.pnlRows ?? EMPTY_ROWS;
  const currentRows = reportQuery.data?.currentRows ?? EMPTY_ROWS;
  const priorRows = reportQuery.data?.priorRows ?? EMPTY_ROWS;
  const cashAccountCodes = useMemo(
    () => detectCashAccountCodes([...currentRows, ...priorRows]),
    [currentRows, priorRows],
  );
  const pnl = useMemo(() => computePnl(pnlRows), [pnlRows]);
  const bsCurrent = useMemo(
    () => computeBalanceSheet(currentRows, hasActiveRetainedEarningsBalance(currentRows)),
    [currentRows],
  );
  const bsPrior = useMemo(
    () => computeBalanceSheet(priorRows, hasActiveRetainedEarningsBalance(priorRows)),
    [priorRows],
  );
  const report = useMemo(
    () => computeCashFlow(pnl, bsCurrent, bsPrior, pnlRows, cashAccountCodes),
    [pnl, bsCurrent, bsPrior, pnlRows, cashAccountCodes],
  );
  const priorBalancesById = new Map(priorRows.map((row) => [row.account_id, Number(row.balance ?? 0)]));
  const hasBalanceSheetMovement = currentRows.some((row) => {
    const type = String(row.account_type ?? '').trim().toLowerCase();
    if (!['asset', 'liability', 'equity'].includes(type)) return false;
    return Math.abs(Number(row.balance ?? 0) - (priorBalancesById.get(row.account_id) ?? 0)) > 0.000001;
  });
  const hasActivity = pnl.sections.some((section) =>
    section.accounts.some((account) => Math.abs(account.amount) > 0.000001),
  ) || hasBalanceSheetMovement || report.sections.some((section) =>
    section.lines.some((line) => !line.isSubtotal && Math.abs(line.amount) > 0.000001),
  ) || Math.abs(report.cashEnd - report.cashBeginning) > 0.000001;

  const refresh = () => void reportQuery.refetch();
  const updatePeriod = (from: string, to: string) => setPeriod({ from, to });

  const handleExportCSV = () => {
    const csvRows: (string | number | null)[][] = [];
    for (const section of report.sections) {
      csvRows.push([t(section.labelKey), '', null]);
      for (const line of section.lines) {
        csvRows.push(['', t(line.labelKey), line.amount]);
      }
    }
    csvRows.push(['', t('reports.cashFlow.netCashChange'), report.netCashChange]);
    csvRows.push(['', t('reports.cashFlow.cashBeginning'), report.cashBeginning]);
    csvRows.push(['', t('reports.cashFlow.cashEnd'), report.cashEnd]);

    downloadFile(
      generateCSV([
        t('reports.shared.section'),
        t('reports.shared.accountName'),
        t('reports.shared.balanceMwk'),
      ], csvRows),
      reportFilename('cash-flow', period.from, period.to),
      'text/csv;charset=utf-8',
    );
  };

  const isLoading = reportQuery.isFetching;
  const hasError = reportQuery.isError;

  return (
    <main className="report-container mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="report-header mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('reports.cashFlow.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('reports.cashFlow.description')}</p>
        <p className="subtitle mt-2 text-sm text-gray-500">
          {t('reports.cashFlow.subtitle', {
            from: formatDate(period.from, i18n.language),
            to: formatDate(period.to, i18n.language),
            branch: branchLabel,
          })}
        </p>
      </header>

      <section aria-label={t('reports.shared.filters')} className="report-filters mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <PeriodPicker value={period} onChange={updatePeriod} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <BranchFilter businessId={businessId} value={branchId} onChange={setBranchId} />
          <div className="flex flex-wrap items-center gap-2 self-start sm:self-end">
            <button
              type="button"
              onClick={refresh}
              disabled={!businessId || !validPeriod || isLoading}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('reports.shared.runReport')}
            </button>
            <ReportExportButtons
              onExportCSV={handleExportCSV}
              onExportPDF={printReport}
              disabled={isLoading || hasError || !validPeriod || !hasActivity}
            />
          </div>
        </div>
      </section>

      {hasError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{t('reports.cashFlow.error')}</span>
          <button type="button" onClick={refresh} className="font-semibold underline">{t('common.retry')}</button>
        </div>
      )}

      {validPeriod && !isLoading && !hasError && hasActivity && (
        <div
          role={report.isReconciled ? 'status' : 'alert'}
          className={`mb-4 flex items-center gap-2 rounded-xl border p-4 text-sm font-medium ${
            report.isReconciled
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {report.isReconciled
            ? <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
            : <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />}
          <span>
            {report.isReconciled
              ? t('reports.cashFlow.reconciled')
              : t('reports.cashFlow.notReconciled', { amount: formatAmount(Math.abs(report.discrepancy)) })}
          </span>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('reports.cashFlow.title')}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-gray-800">{t('reports.cashFlow.title')}</h2>
          <p className="text-xs text-gray-500">
            {t('reports.shared.period')}: {formatDate(period.from, i18n.language)} – {formatDate(period.to, i18n.language)}
          </p>
        </div>

        {isLoading ? (
          <div role="status" aria-label={t('reports.shared.loading')} className="flex min-h-72 items-center justify-center text-brand-700">
            <LoaderCircle className="h-8 w-8 animate-spin" aria-hidden="true" />
          </div>
        ) : !validPeriod ? (
          <div role="alert" className="flex min-h-56 items-center justify-center px-5 py-10 text-center text-sm text-red-700">
            {t('reports.cashFlow.invalidPeriod')}
          </div>
        ) : !hasActivity && !hasError ? (
          <div className="flex min-h-56 items-center justify-center px-5 py-10 text-center text-sm text-gray-600">
            {t('reports.cashFlow.noData')}
          </div>
        ) : !hasError ? (
          <div className="overflow-x-auto">
            <table className="report-table cash-flow-table w-full min-w-[36rem] border-collapse text-sm">
              <tbody>
                {report.sections.map((section) => (
                  <FragmentSection key={section.key} section={section} formatAmount={formatAmount} />
                ))}
                <tr className="total-row border-y-2 border-gray-400 bg-brand-50 font-bold text-gray-950">
                  <th scope="row" className="px-4 py-3 text-left">{t('reports.cashFlow.netCashChange')}</th>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAmount(report.netCashChange)}</td>
                </tr>
                <tr className="font-medium text-gray-800">
                  <th scope="row" className="px-4 py-3 text-left">{t('reports.cashFlow.cashBeginning')}</th>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAmount(report.cashBeginning)}</td>
                </tr>
                <tr className="border-t border-gray-300 font-semibold text-gray-900">
                  <th scope="row" className="px-4 py-3 text-left">{t('reports.cashFlow.cashEnd')}</th>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAmount(report.cashEnd)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : null}
        {!isLoading && hasActivity && !hasError && (
          <p className="border-t border-gray-100 px-4 py-2 text-right text-xs text-gray-500">
            {t('reports.cashFlow.currencyNote')}
          </p>
        )}
      </section>
    </main>
  );
}

function FragmentSection({
  section,
  formatAmount,
}: {
  section: ReturnType<typeof computeCashFlow>['sections'][number];
  formatAmount: (value: number) => string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <tr className="section-header bg-gray-100 text-gray-900">
        <th scope="colgroup" colSpan={2} className="px-4 py-3 text-left font-bold uppercase tracking-wide">
          {t(section.labelKey)}
        </th>
      </tr>
      {section.lines.map((line) => (
        <tr key={line.key} className={line.isSubtotal ? 'computed-line total-row border-t border-gray-300 bg-gray-50 font-bold text-gray-900' : line.amount < 0 ? 'text-red-700' : 'text-gray-700'}>
          <th scope="row" className="px-4 py-2.5 text-left font-medium">
            {t(line.labelKey)}
          </th>
          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
            {line.isSubtotal || Math.abs(line.amount) > 0.000001
              ? formatAmount(line.amount)
              : t('reports.cashFlow.noActivityAmount')}
          </td>
        </tr>
      ))}
    </>
  );
}
