import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { ReportExportButtons } from '@/components/reports/ReportExportButtons';
import { downloadFile, generateCSV, printReport, reportFilename } from '@/lib/reports/export';
import { useTranslation } from 'react-i18next';
import { BranchFilter } from '@/components/reports/BranchFilter';
import { PeriodPicker } from '@/components/reports/PeriodPicker';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';
import { ReportRepository, type TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { supabase } from '@/lib/supabase';
import { computePnl, computeVariance, type PnlAccountLine, type PnlComputedLine, type PnlSection } from '@/lib/reports/pnl';
import { periodForPreset, previousPeriod, type PeriodPreset } from '@/lib/reports/periods';
import { useAppStore } from '@/store/useAppStore';

const initialPeriod = periodForPreset('thisMonth');
const EMPTY_ROWS: TrialBalanceRow[] = [];
const amountFormatter = new Intl.NumberFormat('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatDate(date: string, locale: string): string {
  if (!date) return date;
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function formatAmount(value: number): string {
  const safeValue = Number.isFinite(value) ? value : 0;
  return safeValue < 0
    ? `(${amountFormatter.format(Math.abs(safeValue))})`
    : amountFormatter.format(safeValue);
}

function formatPercentage(value: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(Math.abs(value) / 100);
  return value < 0 ? `(${formatted})` : formatted;
}

interface MetricCellsProps {
  current: number;
  prior: number;
  comparePrior: boolean;
  locale: string;
}

function MetricCells({ current, prior, comparePrior, locale }: MetricCellsProps) {
  const { t } = useTranslation();
  if (!comparePrior) {
    return <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatAmount(current)}</td>;
  }
  const variance = computeVariance(current, prior);
  return (
    <>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatAmount(current)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatAmount(prior)}</td>
      <td className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${variance.absolute < 0 ? 'text-red-700' : ''}`}>
        {formatAmount(variance.absolute)}
      </td>
      <td className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${variance.percentage !== null && variance.percentage < 0 ? 'text-red-700' : ''}`}>
        {variance.percentage === null ? t('reports.profitLoss.notAvailable') : formatPercentage(variance.percentage, locale)}
      </td>
    </>
  );
}

function AccountLine({
  account,
  priorAmount,
  comparePrior,
  locale,
}: {
  account: PnlAccountLine;
  priorAmount: number;
  comparePrior: boolean;
  locale: string;
}) {
  return (
    <tr className={account.amount < 0 ? 'text-red-700' : 'text-gray-700'}>
      <th scope="row" className="px-4 py-2 text-left font-normal">
        <div className="flex min-w-0 items-baseline gap-2" style={{ paddingLeft: `${Math.max(0, account.level)}rem` }}>
          <span className="shrink-0 font-mono text-[11px] text-gray-500">{account.accountCode}</span>
          <span className="truncate">{account.accountName}</span>
        </div>
      </th>
      <MetricCells current={account.amount} prior={priorAmount} comparePrior={comparePrior} locale={locale} />
    </tr>
  );
}

function SectionRows({
  section,
  priorSection,
  comparePrior,
  locale,
}: {
  section: PnlSection;
  priorSection?: PnlSection;
  comparePrior: boolean;
  locale: string;
}) {
  const { t } = useTranslation();
  const priorAccounts = new Map((priorSection?.accounts ?? []).map((account) => [account.accountId, account.amount]));
  return (
    <>
      <tr className={`section-header bg-gray-100 font-semibold ${section.total < 0 ? 'text-red-800' : 'text-gray-900'}`}>
        <th scope="row" className="px-4 py-3 text-left">{t(section.labelKey)}</th>
        <MetricCells current={section.total} prior={priorSection?.total ?? 0} comparePrior={comparePrior} locale={locale} />
      </tr>
      {section.accounts.map((account) => {
        const priorAmount = priorAccounts.get(account.accountId) ?? 0;
        if (Math.abs(account.amount) < 0.000001 && Math.abs(priorAmount) < 0.000001) return null;
        return (
          <AccountLine
            key={account.accountId}
            account={account}
            priorAmount={priorAmount}
            comparePrior={comparePrior}
            locale={locale}
          />
        );
      })}
    </>
  );
}

function ComputedLineRow({
  line,
  priorAmount,
  comparePrior,
  locale,
  label,
}: {
  line: PnlComputedLine;
  priorAmount: number;
  comparePrior: boolean;
  locale: string;
  label: string;
}) {
  const emphasis = line.key === 'netProfit';
  const tone = emphasis
    ? line.amount > 0 ? 'bg-emerald-50 text-emerald-900' : line.amount < 0 ? 'bg-red-50 text-red-900' : 'bg-gray-50 text-gray-900'
    : 'bg-white text-gray-900';
  return (
    <tr className={`computed-line border-t-2 border-gray-300 font-bold ${tone}`}>
      <th scope="row" className="px-4 py-3 text-left">{label}</th>
      <MetricCells current={line.amount} prior={priorAmount} comparePrior={comparePrior} locale={locale} />
    </tr>
  );
}

export function ProfitLossPage() {
  const { t, i18n } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const [period, setPeriod] = useState(initialPeriod);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset | 'custom'>('thisMonth');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [comparePrior, setComparePrior] = useState(true);
  const { data: branches = [] } = useAccessibleReportBranches(businessId);
  const priorPeriod = useMemo(() => previousPeriod(period, periodPreset), [period, periodPreset]);
  const validPeriod = Boolean(period.from && period.to && period.from <= period.to);
  const branchLabel = branchId
    ? branches.find((branch) => branch.id === branchId)?.name ?? t('reports.shared.selectedBranch')
    : t('reports.shared.allBranches');

  const currentQuery = useQuery<TrialBalanceRow[]>({
    queryKey: ['profit-loss-current', businessId, period.from, period.to, branchId],
    queryFn: () => ReportRepository.getTrialBalance(supabase, {
      businessId,
      dateFrom: period.from,
      dateTo: period.to,
      branchId,
    }),
    enabled: Boolean(businessId && validPeriod),
  });
  const priorQuery = useQuery<TrialBalanceRow[]>({
    queryKey: ['profit-loss-prior', businessId, priorPeriod.from, priorPeriod.to, branchId],
    queryFn: () => ReportRepository.getTrialBalance(supabase, {
      businessId,
      dateFrom: priorPeriod.from,
      dateTo: priorPeriod.to,
      branchId,
    }),
    enabled: Boolean(businessId && comparePrior && validPeriod && priorPeriod.from && priorPeriod.to),
  });

  const currentRows = currentQuery.data ?? EMPTY_ROWS;
  const priorRows = comparePrior ? priorQuery.data ?? EMPTY_ROWS : EMPTY_ROWS;
  const currentReport = useMemo(() => computePnl(currentRows), [currentRows]);
  const priorReport = useMemo(() => computePnl(priorRows), [priorRows]);
  const priorSections = new Map(priorReport.sections.map((section) => [section.key, section]));
  const currentLines = new Map(currentReport.computedLines.map((line) => [line.key, line]));
  const priorLines = new Map(priorReport.computedLines.map((line) => [line.key, line.amount]));
  const isFetching = currentQuery.isFetching || (comparePrior && priorQuery.isFetching);
  const hasError = currentQuery.isError || (comparePrior && priorQuery.isError);
  const hasActivity = [...currentReport.sections, ...(comparePrior ? priorReport.sections : [])]
    .some((section) => section.accounts.some((account) => Math.abs(account.amount) > 0.000001));
  const columnCount = comparePrior ? 5 : 2;

  const refresh = () => {
    void currentQuery.refetch();
    if (comparePrior) void priorQuery.refetch();
  };
  const updatePeriod = (from: string, to: string) => setPeriod({ from, to });

  const handleExportCSV = () => {
    const headers = [
      t('reports.shared.section'),
      t('reports.shared.accountCode'),
      t('reports.shared.accountName'),
      t('reports.pnl.current'),
      ...(comparePrior ? [
        t('reports.pnl.prior'),
        t('reports.pnl.variance'),
        t('reports.pnl.variancePct'),
      ] : []),
    ];
    const csvRows: (string | number | null)[][] = [];
    const metrics = (current: number, prior: number) => {
      if (!comparePrior) return [current];
      const variance = computeVariance(current, prior);
      return [current, prior, variance.absolute, variance.percentage];
    };

    for (const section of currentReport.sections) {
      const priorSection = priorSections.get(section.key);
      const sectionLabel = t(section.labelKey);
      csvRows.push([sectionLabel, '', '', ...metrics(section.total, priorSection?.total ?? 0)]);
      const priorAccounts = new Map((priorSection?.accounts ?? []).map((account) => [account.accountId, account.amount]));
      for (const account of section.accounts) {
        const priorAmount = priorAccounts.get(account.accountId) ?? 0;
        if (Math.abs(account.amount) < 0.000001 && Math.abs(priorAmount) < 0.000001) continue;
        csvRows.push([
          sectionLabel,
          account.accountCode,
          account.accountName,
          ...metrics(account.amount, priorAmount),
        ]);
      }

      const computedKey = section.key === 'costOfSales'
        ? 'grossProfit'
        : section.key === 'depreciationAmortisation'
          ? 'operatingProfit'
          : section.key === 'financeCosts'
            ? 'profitBeforeTax'
            : section.key === 'taxExpense'
              ? 'netProfit'
              : null;
      if (computedKey !== null) {
        const computedLine = currentLines.get(computedKey);
        if (computedLine) {
          const label = computedKey === 'netProfit' && computedLine.amount < 0
            ? t('reports.pnl.netLoss')
            : t(computedLine.labelKey);
          csvRows.push([
            '',
            '',
            label,
            ...metrics(computedLine.amount, priorLines.get(computedKey) ?? 0),
          ]);
        }
      }
    }

    downloadFile(
      generateCSV(headers, csvRows),
      reportFilename('profit-loss', period.from, period.to),
      'text/csv;charset=utf-8',
    );
  };

  const renderComputedLine = (key: PnlComputedLine['key']) => {
    const line = currentLines.get(key);
    if (!line) return null;
    const label = key === 'netProfit' && line.amount < 0
      ? t('reports.pnl.netLoss')
      : t(line.labelKey);
    return (
      <ComputedLineRow
        key={key}
        line={line}
        priorAmount={priorLines.get(key) ?? 0}
        comparePrior={comparePrior}
        locale={i18n.language}
        label={label}
      />
    );
  };

  return (
    <main className="report-container mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="report-header mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('reports.profitLoss.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('reports.profitLoss.description')}</p>
        <p className="subtitle mt-2 text-sm text-gray-500">
          {t('reports.profitLoss.subtitle', {
            from: formatDate(period.from, i18n.language),
            to: formatDate(period.to, i18n.language),
            branch: branchLabel,
          })}
        </p>
      </header>

      <section aria-label={t('reports.shared.filters')} className="report-filters mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <PeriodPicker value={period} onChange={updatePeriod} onPresetChange={setPeriodPreset} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <BranchFilter businessId={businessId} value={branchId} onChange={setBranchId} />
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex min-h-10 items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={comparePrior}
                onChange={(event) => setComparePrior(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
              />
              {t('reports.pnl.comparePrior')}
            </label>
            <button
              type="button"
              onClick={refresh}
              disabled={!businessId || !validPeriod || isFetching}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
              {t('reports.shared.runReport')}
            </button>
            <ReportExportButtons
              onExportCSV={handleExportCSV}
              onExportPDF={printReport}
              disabled={isFetching || hasError || !hasActivity || !validPeriod}
            />
          </div>
        </div>
      </section>

      {hasError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{t('reports.profitLoss.error')}</span>
          <button type="button" onClick={refresh} className="font-semibold underline">{t('common.retry')}</button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('reports.profitLoss.title')}>
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-gray-800">{t('reports.profitLoss.title')}</h2>
          {comparePrior && <p className="text-xs text-gray-500">{formatDate(priorPeriod.from, i18n.language)} – {formatDate(priorPeriod.to, i18n.language)}</p>}
        </div>

        {isFetching ? (
          <div className="space-y-3 p-5" aria-label={t('reports.shared.loading')}>
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-8 animate-pulse rounded bg-gray-100" />)}
          </div>
        ) : !validPeriod ? (
          <div role="alert" className="flex min-h-56 items-center justify-center px-5 py-10 text-center text-sm text-red-700">
            {t('reports.shared.invalidDateRange')}
          </div>
        ) : !hasActivity && !hasError ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
            <p className="font-medium text-gray-800">{t('reports.profitLoss.noActivity')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('reports.shared.noData')}</p>
          </div>
        ) : !hasError ? (
          <div className="overflow-x-auto">
            <table className="report-table w-full min-w-[640px] border-collapse text-sm">
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">{t('reports.pnl.account')}</th>
                  <th scope="col" className="px-3 py-3 text-right">{t('reports.pnl.current')}</th>
                  {comparePrior && (
                    <>
                      <th scope="col" className="px-3 py-3 text-right">{t('reports.pnl.prior')}</th>
                      <th scope="col" className="px-3 py-3 text-right">{t('reports.pnl.variance')}</th>
                      <th scope="col" className="px-3 py-3 text-right">{t('reports.pnl.variancePct')}</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {currentReport.sections.map((section) => {
                  const priorSection = priorSections.get(section.key);
                  return (
                    <Fragment key={section.key}>
                      <SectionRows section={section} priorSection={priorSection} comparePrior={comparePrior} locale={i18n.language} />
                      {section.key === 'costOfSales' && renderComputedLine('grossProfit')}
                      {section.key === 'depreciationAmortisation' && renderComputedLine('operatingProfit')}
                      {section.key === 'financeCosts' && renderComputedLine('profitBeforeTax')}
                      {section.key === 'taxExpense' && renderComputedLine('netProfit')}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-gray-200">
                <tr>
                  <td colSpan={columnCount} className="px-4 py-2 text-xs text-gray-500">
                    {t('reports.profitLoss.currencyNote')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
