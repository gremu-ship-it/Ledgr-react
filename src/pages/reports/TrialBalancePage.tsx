import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BranchFilter } from '@/components/reports/BranchFilter';
import { useAccessibleReportBranches } from '@/hooks/useAccessibleReportBranches';
import { PeriodPicker } from '@/components/reports/PeriodPicker';
import { ReportRepository } from '@/dal/repositories/ReportRepository';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import {
  accountIdsWithChildren,
  buildAccountTree,
  defaultExpandedAccountIds,
  visibleAccountRows,
} from '@/lib/reports/trialBalance';
import { periodForPreset } from '@/lib/reports/periods';
import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';

const initialPeriod = periodForPreset('thisMonth');
const EMPTY_ROWS: TrialBalanceRow[] = [];
const amountFormatter = new Intl.NumberFormat('en-MW', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

export function TrialBalancePage() {
  const { t, i18n } = useTranslation();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const [period, setPeriod] = useState(initialPeriod);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string> | null>(null);
  const { data: branches = [] } = useAccessibleReportBranches(businessId);

  const reportQuery = useQuery<TrialBalanceRow[]>({
    queryKey: ['trial-balance', businessId, period.from, period.to, branchId],
    queryFn: () => ReportRepository.getTrialBalance(supabase, {
      businessId,
      dateFrom: period.from,
      dateTo: period.to,
      branchId,
    }),
    enabled: Boolean(businessId && period.from && period.to && period.from <= period.to),
  });

  const rows = reportQuery.data ?? EMPTY_ROWS;
  const tree = useMemo(() => buildAccountTree(rows), [rows]);
  const allExpandableIds = useMemo(() => accountIdsWithChildren(tree), [tree]);
  const effectiveExpandedIds = expandedIds ?? defaultExpandedAccountIds(tree);
  const visibleRows = useMemo(
    () => visibleAccountRows(tree, effectiveExpandedIds),
    [tree, effectiveExpandedIds],
  );

  const totalDebit = rows.reduce((sum, row) => sum + Number(row.total_debit ?? 0), 0);
  const totalCredit = rows.reduce((sum, row) => sum + Number(row.total_credit ?? 0), 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = Math.abs(difference) <= 0.01;
  const hasActivity = rows.some((row) => Number(row.total_debit ?? 0) !== 0 || Number(row.total_credit ?? 0) !== 0);
  const selectedBranch = branches.find((branch) => branch.id === branchId);
  const branchLabel = branchId
    ? selectedBranch?.name ?? t('reports.shared.selectedBranch')
    : t('reports.shared.allBranches');
  const hasInvalidPeriod = !period.from || !period.to || period.from > period.to;

  const setRange = (from: string, to: string) => {
    setPeriod({ from, to });
    setExpandedIds(null);
  };

  const toggleExpanded = (accountId: string) => {
    const next = new Set(effectiveExpandedIds);
    if (next.has(accountId)) next.delete(accountId);
    else next.add(accountId);
    setExpandedIds(next);
  };

  const setAllExpanded = (expanded: boolean) => {
    setExpandedIds(expanded ? new Set(allExpandableIds) : new Set());
  };

  return (
    <main className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('reports.trialBalance.title')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('reports.trialBalance.description')}</p>
        <p className="mt-2 text-sm text-gray-500">
          {t('reports.trialBalance.subtitle', {
            from: formatDate(period.from, i18n.language),
            to: formatDate(period.to, i18n.language),
            branch: branchLabel,
          })}
        </p>
      </header>

      <section aria-label={t('reports.shared.filters')} className="mb-6 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-1 flex-col gap-4">
          <PeriodPicker value={period} onChange={setRange} />
          <BranchFilter businessId={businessId} value={branchId} onChange={setBranchId} />
        </div>
        <button
          type="button"
          onClick={() => void reportQuery.refetch()}
          disabled={!businessId || hasInvalidPeriod || reportQuery.isFetching}
          className="inline-flex min-h-10 items-center justify-center gap-2 self-start rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60 lg:self-end"
        >
          <RefreshCw className={`h-4 w-4 ${reportQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          {t('reports.shared.runReport')}
        </button>
      </section>

      {reportQuery.isError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <span>{t('reports.shared.error')}</span>
          <button type="button" onClick={() => void reportQuery.refetch()} className="font-semibold underline">
            {t('common.retry')}
          </button>
        </div>
      )}

      {hasActivity && !isBalanced && !reportQuery.isFetching && !reportQuery.isError && (
        <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-900">
          {t('reports.shared.imbalanced', { amount: formatAmount(difference) })}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('reports.trialBalance.title')}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
          <p className="text-sm font-semibold text-gray-800">{t('reports.trialBalance.title')}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAllExpanded(true)}
              disabled={allExpandableIds.length === 0}
              className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('reports.trialBalance.expandAll')}
            </button>
            <button
              type="button"
              onClick={() => setAllExpanded(false)}
              disabled={allExpandableIds.length === 0}
              className="rounded-md px-2 py-1 text-xs font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('reports.trialBalance.collapseAll')}
            </button>
          </div>
        </div>

        {reportQuery.isFetching ? (
          <div className="space-y-3 p-5" aria-label={t('reports.shared.loading')}>
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="h-8 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        ) : !hasActivity && !reportQuery.isError ? (
          <div className="flex min-h-56 flex-col items-center justify-center px-5 py-10 text-center">
            <p className="font-medium text-gray-800">{t('reports.trialBalance.noEntries')}</p>
            <p className="mt-1 text-sm text-gray-500">{t('reports.shared.noData')}</p>
          </div>
        ) : !reportQuery.isError ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-sm">
              <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3 text-left">{t('reports.shared.accountCode')}</th>
                  <th scope="col" className="px-4 py-3 text-left">{t('reports.shared.accountName')}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t('reports.shared.debitMwk')}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t('reports.shared.creditMwk')}</th>
                  <th scope="col" className="px-4 py-3 text-right">{t('reports.shared.balanceMwk')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleRows.map(({ node, depth }) => {
                  const hasChildren = node.children.length > 0;
                  const debit = hasChildren ? node.rollupDebit : node.total_debit;
                  const credit = hasChildren ? node.rollupCredit : node.total_credit;
                  const balance = hasChildren ? node.rollupBalance : node.balance;
                  const expanded = effectiveExpandedIds.has(node.account_id);
                  return (
                    <tr key={node.account_id} className={hasChildren ? 'bg-gray-50/70 font-semibold text-gray-900' : 'text-gray-700'}>
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs">{node.account_code}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex min-w-0 items-center" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={t(expanded ? 'reports.trialBalance.collapseAccount' : 'reports.trialBalance.expandAccount', { account: node.account_name })}
                              onClick={() => toggleExpanded(node.account_id)}
                              className="mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-200 hover:text-gray-900"
                            >
                              {expanded
                                ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                            </button>
                          ) : <span className="mr-1 inline-block h-6 w-6 shrink-0" aria-hidden="true" />}
                          <span className="truncate">{node.account_name}</span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatAmount(debit)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{formatAmount(credit)}</td>
                      <td className={`whitespace-nowrap px-4 py-2.5 text-right tabular-nums ${balance < 0 ? 'text-red-700' : ''}`}>
                        {formatAmount(balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50 font-bold text-gray-900">
                <tr>
                  <td colSpan={2} className="px-4 py-3">{t('reports.shared.total')}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAmount(totalDebit)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{formatAmount(totalCredit)}</td>
                  <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums ${isBalanced ? '' : 'text-red-700'}`}>
                    {formatAmount(difference)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}

        {!reportQuery.isFetching && hasActivity && !reportQuery.isError && (
          <p className="border-t border-gray-100 px-4 py-2 text-right text-xs text-gray-500">
            {isBalanced ? t('reports.shared.balanced') : t('reports.shared.imbalancedShort')}
          </p>
        )}
      </section>
    </main>
  );
}
