import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BudgetLineInput } from '@/dal/repositories/BudgetRepository';
import type { Row } from '@/dal/types/database';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

type Account = Row<'accounts'>;
interface DraftLine { key: number; accountId: string; amount: string; }

function countMonths(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = new Date(`${start}T00:00:00Z`);
  const b = new Date(`${end}T00:00:00Z`);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + 1;
}

function formatMoney(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

export function BudgetNewPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const currentUser = useAppStore((state) => state.currentUser);
  const businessId = currentBusiness?.business?.id ?? '';
  const currency = currentBusiness?.business?.base_currency ?? 'MWK';
  const thisYear = new Date().getFullYear();
  const [name, setName] = useState('');
  const [periodStart, setPeriodStart] = useState(`${thisYear}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${thisYear}-12-31`);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [errorKey, setErrorKey] = useState('');
  const [nextKey, setNextKey] = useState(1);

  const accountsQuery = useQuery({
    queryKey: ['budget-accounts', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.account.findPostingAccounts(businessId),
  });
  const accounts = (accountsQuery.data ?? []).filter((account) => account.account_type === 'income' || account.account_type === 'expense');
  const selectedAccounts = useMemo(() => new Set(lines.map((line) => line.accountId).filter(Boolean)), [lines]);
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const months = countMonths(periodStart, periodEnd);

  const createBudget = useMutation({
    mutationFn: async () => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('name');
      if (!periodStart || !periodEnd || periodStart > periodEnd || months < 1 || months > 12) throw new Error('period');
      if (!lines.length) throw new Error('lines');
      if (lines.some((line) => !line.accountId)) throw new Error('account');
      if (lines.some((line) => line.amount === '' || !Number.isFinite(Number(line.amount)) || Number(line.amount) < 0)) throw new Error('amount');
      const budgetLines: BudgetLineInput[] = lines.map((line) => ({ accountId: line.accountId, amount: Number(line.amount) }));
      return repos.budget.create(businessId, {
        name: trimmedName,
        periodStart,
        periodEnd,
        notes,
        createdBy: currentUser?.id ?? null,
        lines: budgetLines,
      });
    },
    onSuccess: async (budget) => {
      await queryClient.invalidateQueries({ queryKey: ['budgets', businessId] });
      navigate(`/reports/budgets/${budget.id}`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : '';
      setErrorKey(['name', 'period', 'lines', 'account', 'amount'].includes(message) ? message : 'saveFailed');
    },
  });

  const addLine = () => {
    setLines((current) => [...current, { key: nextKey, accountId: '', amount: '' }]);
    setNextKey((current) => current + 1);
  };
  const updateLine = (key: number, field: 'accountId' | 'amount', value: string) => {
    setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Link to="/reports/budgets" className="inline-flex items-center gap-2 text-sm font-medium text-brand-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('budgets.title')}</Link>
      <header>
        <h1 className="text-2xl font-bold text-gray-900">{t('budgets.new')}</h1>
        <p className="mt-1 text-sm text-gray-600">{t('budgets.description')}</p>
      </header>

      <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); setErrorKey(''); createBudget.mutate(); }}>
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div>
            <label htmlFor="budget-name" className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.name')}</label>
            <input id="budget-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="budget-period-start" className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.periodStart')}</label>
              <input id="budget-period-start" type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
            <div>
              <label htmlFor="budget-period-end" className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.periodEnd')}</label>
              <input id="budget-period-end" type="date" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2" />
            </div>
          </div>
          <div>
            <label htmlFor="budget-notes" className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.notes')}</label>
            <textarea id="budget-notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('budgets.notesPlaceholder')} className="w-full rounded-md border border-gray-300 px-3 py-2" />
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-gray-900">{t('budgets.addLine')}</h2>
            <button type="button" onClick={addLine} className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"><Plus className="h-4 w-4" aria-hidden="true" />{t('budgets.addLine')}</button>
          </div>
          {accountsQuery.isError && <p className="text-sm text-red-700" role="alert">{t('budgets.noAccounts')}</p>}
          {accounts.length === 0 && !accountsQuery.isLoading && !accountsQuery.isError && <p className="text-sm text-gray-600">{t('budgets.noAccounts')}</p>}
          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={line.key} className="grid gap-3 sm:grid-cols-[1fr_12rem_auto]">
                <div>
                  <label htmlFor={`budget-account-${line.key}`} className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.account')}</label>
                  <select id={`budget-account-${line.key}`} required value={line.accountId} onChange={(event) => updateLine(line.key, 'accountId', event.target.value)} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2">
                    <option value="">{t('budgets.selectAccount')}</option>
                    {accounts.map((account: Account) => <option key={account.id} value={account.id} disabled={selectedAccounts.has(account.id) && account.id !== line.accountId}>{account.code} — {account.name} ({t(account.account_type === 'income' ? 'budgets.income' : 'budgets.expenses')})</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`budget-amount-${line.key}`} className="mb-1 block text-sm font-medium text-gray-700">{t('budgets.amount')}</label>
                  <input id={`budget-amount-${line.key}`} required type="number" min="0" step="0.01" value={line.amount} onChange={(event) => updateLine(line.key, 'amount', event.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2" />
                </div>
                <div className="flex items-end">
                  <button type="button" aria-label={`${t('budgets.removeLine')} ${index + 1}`} onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))} className="rounded-md p-2 text-red-700 hover:bg-red-50"><Trash2 className="h-5 w-5" aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
          {lines.length === 0 && <p className="text-sm text-gray-600">{t('budgets.noLines')}</p>}
          <div className="flex justify-end border-t border-gray-100 pt-4 text-right">
            <p className="text-sm text-gray-700">{t('budgets.totalBudgeted')}: <strong className="text-base text-gray-900">{formatMoney(total, i18n.language, currency)}</strong></p>
          </div>
        </section>

        {errorKey && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-800">{t(`budgets.${errorKey === 'name' ? 'nameRequired' : errorKey === 'period' ? 'periodInvalid' : errorKey === 'lines' ? 'addFirstLine' : errorKey === 'account' ? 'accountRequired' : errorKey === 'amount' ? 'amountInvalid' : 'saveFailed'}`)}</p>}
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Link to="/reports/budgets" className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">{t('budgets.cancel')}</Link>
          <button type="submit" disabled={createBudget.isPending || accountsQuery.isLoading} className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">{createBudget.isPending ? t('budgets.saving') : t('budgets.save')}</button>
        </div>
      </form>
    </main>
  );
}
