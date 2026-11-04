import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Printer, Save, Target, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BudgetAccountType, BudgetStatus, BudgetVsActualRow } from '@/dal/repositories/BudgetRepository';
import type { Row } from '@/dal/types/database';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

type Account = Row<'accounts'>;
interface PeriodChoice { from: string; to: string; label: string; }
interface EditableLine { id: string | null; key: string; accountId: string; amount: string; }
type Granularity = 'month' | 'quarter' | 'year';

const EMPTY_VARIANCE_ROWS: BudgetVsActualRow[] = [];

const STATUS_CLASSES: Record<BudgetStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-700',
};

function addMonths(date: Date, amount: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  return result;
}
function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }
function monthCount(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + 1;
}
function buildPeriods(start: string, end: string, granularity: Granularity, locale: string, labels: { month: string; quarter: string; year: string }): PeriodChoice[] {
  const size = granularity === 'month' ? 1 : granularity === 'quarter' ? 3 : 12;
  const months = monthCount(start, end);
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const groups: PeriodChoice[] = [];
  for (let offset = 0; offset < months; offset += size) {
    const groupEnd = Math.min(months, offset + size);
    const firstMonth = addMonths(startDate, offset);
    const lastMonth = addMonths(startDate, groupEnd - 1);
    const first = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth(), 1));
    const last = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 0));
    const from = isoDate(first < startDate ? startDate : first);
    const to = isoDate(last > endDate ? endDate : last);
    const monthLabel = (date: Date) => new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(date);
    const label = granularity === 'month'
      ? monthLabel(firstMonth)
      : `${granularity === 'quarter' ? labels.quarter : labels.year} ${Math.floor(offset / size) + 1} · ${monthLabel(firstMonth)} – ${monthLabel(lastMonth)}`;
    groups.push({ from, to, label });
  }
  return groups;
}
function formatMoney(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function formatDate(value: string, locale: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
}
function statusLabel(status: BudgetStatus, t: (key: string) => string): string {
  return t(`budgets.status${status[0].toUpperCase()}${status.slice(1)}`);
}
function favorable(row: BudgetVsActualRow): boolean {
  return row.accountType === 'income' ? row.variance >= 0 : row.variance <= 0;
}
function addSummary(rows: BudgetVsActualRow[]) {
  const income = rows.filter((row) => row.accountType === 'income');
  const expense = rows.filter((row) => row.accountType === 'expense');
  const sum = (items: BudgetVsActualRow[], key: 'budgeted' | 'actual' | 'variance') => items.reduce((total, row) => total + row[key], 0);
  const incomeBudgeted = sum(income, 'budgeted');
  const incomeActual = sum(income, 'actual');
  const expenseBudgeted = sum(expense, 'budgeted');
  const expenseActual = sum(expense, 'actual');
  const netBudgeted = incomeBudgeted - expenseBudgeted;
  const netActual = incomeActual - expenseActual;
  return {
    incomeBudgeted, incomeActual, incomeVariance: incomeActual - incomeBudgeted,
    expenseBudgeted, expenseActual, expenseVariance: expenseActual - expenseBudgeted,
    netBudgeted, netActual, netVariance: netActual - netBudgeted,
  };
}

export function BudgetVsActualPage() {
  const { t, i18n } = useTranslation();
  const { id: budgetId = '' } = useParams();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [periodIndex, setPeriodIndex] = useState(0);
  const [lineEdits, setLineEdits] = useState<Record<string, Pick<EditableLine, 'accountId' | 'amount'>>>({});
  const [newLines, setNewLines] = useState<EditableLine[]>([]);
  const [removedLineIds, setRemovedLineIds] = useState<string[]>([]);
  const [nextLineKey, setNextLineKey] = useState(1);
  const [lineError, setLineError] = useState('');
  const [lineSaved, setLineSaved] = useState(false);

  const budgetQuery = useQuery({
    queryKey: ['budget', businessId, budgetId],
    enabled: Boolean(businessId && budgetId),
    queryFn: () => repos.budget.getById(businessId, budgetId),
  });
  const budget = budgetQuery.data ?? null;
  const editableLines = useMemo(() => {
    const removed = new Set(removedLineIds);
    const persisted = (budget?.lines ?? [])
      .filter((line) => !removed.has(line.id))
      .map((line) => ({ id: line.id, key: line.id, accountId: lineEdits[line.id]?.accountId ?? line.account_id, amount: lineEdits[line.id]?.amount ?? String(line.annual_total ?? 0) }));
    return [...persisted, ...newLines];
  }, [budget?.lines, lineEdits, newLines, removedLineIds]);
  const periods = useMemo(() => budget ? buildPeriods(budget.period_start, budget.period_end, granularity, i18n.language, { month: t('budgets.month'), quarter: t('budgets.quarter'), year: t('budgets.year') }) : [], [budget, granularity, i18n.language, t]);
  const selectedPeriod = periods[Math.min(periodIndex, Math.max(0, periods.length - 1))];
  const reportQuery = useQuery({
    queryKey: ['budget-vs-actual', businessId, budgetId, selectedPeriod?.from, selectedPeriod?.to],
    enabled: Boolean(businessId && budgetId && selectedPeriod),
    queryFn: () => repos.budget.getBudgetVsActual(businessId, budgetId, selectedPeriod!.from, selectedPeriod!.to),
  });
  const accountsQuery = useQuery({
    queryKey: ['budget-accounts', businessId],
    enabled: Boolean(businessId && budget?.status === 'draft'),
    queryFn: () => repos.account.findPostingAccounts(businessId),
  });
  const accounts = (accountsQuery.data ?? []).filter((account) => account.account_type === 'income' || account.account_type === 'expense');
  const usedAccountIds = useMemo(() => new Set(editableLines.map((line) => line.accountId).filter(Boolean)), [editableLines]);

  const statusMutation = useMutation({
    mutationFn: (status: BudgetStatus) => repos.budget.setBudgetStatus(businessId, budgetId, status),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['budget', businessId, budgetId] }),
        queryClient.invalidateQueries({ queryKey: ['budgets', businessId] }),
      ]);
    },
  });
  const saveLinesMutation = useMutation({
    mutationFn: async () => {
      if (!editableLines.length) throw new Error('lines');
      if (editableLines.some((line) => !line.accountId)) throw new Error('account');
      if (editableLines.some((line) => line.amount === '' || !Number.isFinite(Number(line.amount)) || Number(line.amount) < 0)) throw new Error('amount');
      for (const lineId of removedLineIds) await repos.budget.removeLine(businessId, lineId);
      for (const line of editableLines) {
        const amount = Number(line.amount);
        if (line.id) await repos.budget.updateLine(businessId, budgetId, line.id, { accountId: line.accountId, amount });
        else await repos.budget.addLine(businessId, budgetId, { accountId: line.accountId, amount });
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['budget', businessId, budgetId] }),
        queryClient.invalidateQueries({ queryKey: ['budgets', businessId] }),
        queryClient.invalidateQueries({ queryKey: ['budget-vs-actual', businessId, budgetId] }),
      ]);
      setLineEdits({});
      setNewLines([]);
      setRemovedLineIds([]);
      setLineSaved(true);
      setLineError('');
    },
    onError: (error) => {
      setLineSaved(false);
      setLineError(error instanceof Error && ['lines', 'account', 'amount'].includes(error.message) ? error.message : 'saveFailed');
    },
  });

  const rows = reportQuery.data ?? EMPTY_VARIANCE_ROWS;
  const summary = useMemo(() => addSummary(rows), [rows]);
  const incomeRows = rows.filter((row) => row.accountType === 'income');
  const expenseRows = rows.filter((row) => row.accountType === 'expense');
  const addLine = () => {
    setNewLines((current) => [...current, { id: null, key: `new-${nextLineKey}`, accountId: '', amount: '' }]);
    setNextLineKey((current) => current + 1);
  };
  const removeLine = (index: number) => {
    const removed = editableLines[index];
    if (removed?.id) setRemovedLineIds((ids) => [...ids, removed.id!]);
    else if (removed) setNewLines((current) => current.filter((line) => line.key !== removed.key));
  };
  const updateLine = (index: number, field: 'accountId' | 'amount', value: string) => {
    const target = editableLines[index];
    if (!target) return;
    if (target.id) setLineEdits((current) => ({ ...current, [target.id!]: { ...(current[target.id!] ?? { accountId: target.accountId, amount: target.amount }), [field]: value } }));
    else setNewLines((current) => current.map((line) => line.key === target.key ? { ...line, [field]: value } : line));
  };
  const changeStatus = (next: BudgetStatus) => {
    const confirmation = next === 'active' ? t('budgets.confirmActivate') : t('budgets.confirmClose');
    if (window.confirm(confirmation)) statusMutation.mutate(next);
  };

  if (budgetQuery.isLoading) return <main className="p-6 text-sm text-gray-600" role="status">{t('budgets.loadingDetail')}</main>;
  if (budgetQuery.isError || !budget) return <main className="p-6 text-sm text-red-700" role="alert">{t('budgets.loadFailed')}</main>;

  const renderRows = (type: BudgetAccountType, groupRows: BudgetVsActualRow[]) => {
    const budgeted = groupRows.reduce((sum, row) => sum + row.budgeted, 0);
    const actual = groupRows.reduce((sum, row) => sum + row.actual, 0);
    const variance = groupRows.reduce((sum, row) => sum + row.variance, 0);
    const subtotalFavorable = type === 'income' ? variance >= 0 : variance <= 0;
    return (
      <tbody key={type}>
        <tr className="bg-gray-50"><th colSpan={6} className="px-4 py-3 text-left font-semibold text-gray-800">{t(type === 'income' ? 'budgets.income' : 'budgets.expenses')}</th></tr>
        {groupRows.map((row) => (
          <tr key={row.accountId} className="border-t border-gray-100">
            <td className="px-4 py-3 text-gray-600">{row.accountCode}</td><td className="px-4 py-3">{row.accountName}</td>
            <td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.budgeted, i18n.language, currency)}</td><td className="px-4 py-3 text-right tabular-nums">{formatMoney(row.actual, i18n.language, currency)}</td>
            <td aria-label={t(favorable(row) ? 'budgets.favorable' : 'budgets.unfavorable')} className={`px-4 py-3 text-right font-medium tabular-nums ${favorable(row) ? 'text-green-700' : 'text-red-700'}`}>{formatMoney(row.variance, i18n.language, currency)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{row.variancePercent === null ? '—' : `${formatNumber(row.variancePercent, i18n.language)}%`}</td>
          </tr>
        ))}
        <tr className="border-t border-gray-200 bg-gray-50 font-semibold">
          <td colSpan={2} className="px-4 py-3">{t('budgets.subtotal', { type: t(type === 'income' ? 'budgets.income' : 'budgets.expenses') })}</td>
          <td className="px-4 py-3 text-right tabular-nums">{formatMoney(budgeted, i18n.language, currency)}</td><td className="px-4 py-3 text-right tabular-nums">{formatMoney(actual, i18n.language, currency)}</td>
          <td className={`px-4 py-3 text-right tabular-nums ${subtotalFavorable ? 'text-green-700' : 'text-red-700'}`}>{formatMoney(variance, i18n.language, currency)}</td><td className="px-4 py-3 text-right">{budgeted === 0 ? '—' : `${formatNumber((variance / budgeted) * 100, i18n.language)}%`}</td>
        </tr>
      </tbody>
    );
  };

  const cards = [
    { label: t('budgets.incomeBudget'), value: summary.incomeBudgeted, kind: 'normal' },
    { label: t('budgets.actualIncome'), value: summary.incomeActual, kind: 'normal' },
    { label: t('budgets.incomeVariance'), value: summary.incomeVariance, percent: summary.incomeBudgeted ? (summary.incomeVariance / summary.incomeBudgeted) * 100 : null, favorable: summary.incomeVariance >= 0 },
    { label: t('budgets.expenseBudget'), value: summary.expenseBudgeted, kind: 'normal' },
    { label: t('budgets.actualExpenses'), value: summary.expenseActual, kind: 'normal' },
    { label: t('budgets.expenseVariance'), value: summary.expenseVariance, percent: summary.expenseBudgeted ? (summary.expenseVariance / summary.expenseBudgeted) * 100 : null, favorable: summary.expenseVariance <= 0 },
    { label: t('budgets.netVariance'), value: summary.netVariance, percent: summary.netBudgeted ? (summary.netVariance / summary.netBudgeted) * 100 : null, favorable: summary.netVariance >= 0 },
  ];

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link to="/reports/budgets" className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('budgets.title')}</Link>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"><Printer className="h-4 w-4" aria-hidden="true" />{t('budgets.print')}</button>
      </div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3"><Target className="h-7 w-7 text-brand-600" aria-hidden="true" /><h1 className="text-2xl font-bold text-gray-900">{budget.name}</h1></div>
          <p className="mt-1 text-sm text-gray-600">{t('reports.period', { start: formatDate(budget.period_start, i18n.language), end: formatDate(budget.period_end, i18n.language) })}</p>
          <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[budget.status]}`}>{statusLabel(budget.status, t)}</span>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {budget.status === 'draft' && <button type="button" disabled={statusMutation.isPending} onClick={() => changeStatus('active')} className="rounded-md bg-green-700 px-3 py-2 text-sm font-semibold text-white hover:bg-green-800 disabled:opacity-60">{t('budgets.activate')}</button>}
          {budget.status === 'active' && <button type="button" disabled={statusMutation.isPending} onClick={() => changeStatus('closed')} className="rounded-md bg-slate-700 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">{t('budgets.close')}</button>}
        </div>
      </header>

      <section className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm print:hidden">
        <label className="grid gap-1 text-sm font-medium text-gray-700">{t('budgets.periodType')}
          <select value={granularity} onChange={(event) => { setGranularity(event.target.value as Granularity); setPeriodIndex(0); }} className="min-w-36 rounded-md border border-gray-300 bg-white px-3 py-2">
            {(['month', 'quarter', 'year'] as const).map((period) => <option key={period} value={period}>{t(`budgets.${period}`)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-gray-700">{t('budgets.selectPeriod')}
          <select value={String(periodIndex)} onChange={(event) => setPeriodIndex(Number(event.target.value))} className="min-w-64 rounded-md border border-gray-300 bg-white px-3 py-2">
            {periods.map((period, index) => <option key={period.from} value={index}>{period.label}</option>)}
          </select>
        </label>
        <p className="pb-2 text-sm text-gray-600">{selectedPeriod && t('reports.period', { start: formatDate(selectedPeriod.from, i18n.language), end: formatDate(selectedPeriod.to, i18n.language) })}</p>
      </section>

      {statusMutation.isError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{t('budgets.saveFailed')}</p>}
      {reportQuery.isError && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{t('budgets.reportFailed')}</p>}
      {reportQuery.isLoading ? <p role="status" className="text-sm text-gray-600">{t('budgets.loadingDetail')}</p> : (
        <>
          <section aria-label={t('budgets.title')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {cards.map((card) => <article key={card.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm text-gray-600">{card.label}</p>
              <p className={`mt-1 text-xl font-semibold tabular-nums ${card.favorable === undefined ? 'text-gray-900' : card.favorable ? 'text-green-700' : 'text-red-700'}`}>{formatMoney(card.value, i18n.language, currency)}</p>
              {card.percent !== undefined && card.percent !== null && <p className="mt-1 text-xs text-gray-500">{formatNumber(card.percent, i18n.language)}%</p>}
            </article>)}
          </section>
          <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 p-4"><h2 className="font-semibold text-gray-900">{t('budgets.title')} — {t('budgets.variance')}</h2><p className="mt-1 text-xs text-gray-500">{t('budgets.varianceDirection')}</p></div>
            {rows.length === 0 ? <p className="p-6 text-sm text-gray-600">{t('budgets.noLines')}</p> : <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-600"><tr>
                <th className="px-4 py-3">{t('budgets.accountCode')}</th><th className="px-4 py-3">{t('budgets.accountName')}</th><th className="px-4 py-3 text-right">{t('budgets.budgeted')}</th><th className="px-4 py-3 text-right">{t('budgets.actual')}</th><th className="px-4 py-3 text-right">{t('budgets.variance')}</th><th className="px-4 py-3 text-right">{t('budgets.variancePercent')}</th>
              </tr></thead>
              {renderRows('income', incomeRows)}
              {renderRows('expense', expenseRows)}
              <tfoot className="border-t-2 border-gray-300 bg-slate-50 font-bold"><tr>
                <th colSpan={2} className="px-4 py-3 text-left">{t('budgets.grandTotal')}</th>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(summary.incomeBudgeted + summary.expenseBudgeted, i18n.language, currency)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(summary.incomeActual + summary.expenseActual, i18n.language, currency)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney((summary.incomeActual + summary.expenseActual) - (summary.incomeBudgeted + summary.expenseBudgeted), i18n.language, currency)}</td><td className="px-4 py-3 text-right">—</td>
              </tr><tr><th colSpan={2} className="px-4 py-3 text-left">{t('budgets.net')}</th><td className="px-4 py-3 text-right">{formatMoney(summary.netBudgeted, i18n.language, currency)}</td><td className="px-4 py-3 text-right">{formatMoney(summary.netActual, i18n.language, currency)}</td><td className={`px-4 py-3 text-right ${summary.netVariance >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatMoney(summary.netVariance, i18n.language, currency)}</td><td className="px-4 py-3 text-right">{summary.netBudgeted === 0 ? '—' : `${formatNumber((summary.netVariance / summary.netBudgeted) * 100, i18n.language)}%`}</td></tr></tfoot>
            </table>}
          </section>
        </>
      )}

      {budget.status === 'draft' && <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-gray-900">{t('budgets.editDraft')}</h2><p className="mt-1 text-sm text-gray-600">{t('budgets.lineCount', { count: editableLines.length })}</p></div><button type="button" onClick={addLine} className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50">{t('budgets.addLine')}</button></div>
        {accountsQuery.isLoading && <p role="status" className="text-sm text-gray-600">{t('budgets.loadingAccounts')}</p>}
        {editableLines.length === 0 ? <p className="text-sm text-gray-600">{t('budgets.noLines')}</p> : <div className="space-y-3">
          {editableLines.map((line, index) => <div key={line.key} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
            <div><label htmlFor={`edit-account-${index}`} className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.account')}</label><select id={`edit-account-${index}`} value={line.accountId} onChange={(event) => updateLine(index, 'accountId', event.target.value)} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2"><option value="">{t('budgets.selectAccount')}</option>{accounts.map((account: Account) => <option key={account.id} value={account.id} disabled={usedAccountIds.has(account.id) && account.id !== line.accountId}>{account.code} — {account.name} ({t(account.account_type === 'income' ? 'budgets.income' : 'budgets.expenses')})</option>)}</select></div>
            <div><label htmlFor={`edit-amount-${index}`} className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.amount')}</label><input id={`edit-amount-${index}`} type="number" min="0" step="0.01" value={line.amount} onChange={(event) => updateLine(index, 'amount', event.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2" /></div>
            <div className="flex items-end"><button type="button" aria-label={`${t('budgets.removeLine')} ${index + 1}`} onClick={() => removeLine(index)} className="rounded-md p-2 text-red-700 hover:bg-red-50"><Trash2 className="h-5 w-5" aria-hidden="true" /></button></div>
          </div>)}
        </div>}
        {accounts.length === 0 && !accountsQuery.isLoading && <p className="text-sm text-gray-600">{t('budgets.noAccounts')}</p>}
        {lineError && <p role="alert" className="text-sm text-red-700">{t(`budgets.${lineError === 'lines' ? 'addFirstLine' : lineError === 'account' ? 'accountRequired' : lineError === 'amount' ? 'amountInvalid' : 'saveFailed'}`)}</p>}
        {lineSaved && <p role="status" className="text-sm text-green-700">{t('budgets.saveSuccess')}</p>}
        <div className="flex justify-end"><button type="button" disabled={saveLinesMutation.isPending || accountsQuery.isLoading} onClick={() => saveLinesMutation.mutate()} className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"><Save className="h-4 w-4" aria-hidden="true" />{saveLinesMutation.isPending ? t('budgets.saving') : t('budgets.saveLines')}</button></div>
      </section>}
    </main>
  );
}
