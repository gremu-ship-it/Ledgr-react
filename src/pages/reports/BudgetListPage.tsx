import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BudgetStatus } from '@/dal/repositories/BudgetRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

const STATUSES: BudgetStatus[] = ['draft', 'active', 'closed'];
const STATUS_CLASSES: Record<BudgetStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  closed: 'bg-slate-100 text-slate-700',
};

function formatDate(value: string, locale: string): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function formatMoney(value: number, locale: string, currency: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 2 })
    .format(Number(value) || 0);
}

export function BudgetListPage() {
  const { t, i18n } = useTranslation();
  const business = useAppStore((state) => state.currentBusiness?.business);
  const businessId = business?.id ?? '';
  const currency = business?.base_currency ?? 'MWK';
  const [status, setStatus] = useState<BudgetStatus | ''>('');
  const budgetsQuery = useQuery({
    queryKey: ['budgets', businessId, status],
    enabled: Boolean(businessId),
    queryFn: () => repos.budget.list(businessId, status ? { status } : {}),
  });
  const budgets = budgetsQuery.data ?? [];

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <Target className="h-7 w-7 text-brand-600" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-gray-900">{t('budgets.title')}</h1>
          </div>
          <p className="mt-1 text-sm text-gray-600">{t('budgets.description')}</p>
        </div>
        <Link to="/reports/budgets/new" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          <Plus className="h-4 w-4" aria-hidden="true" />{t('budgets.new')}
        </Link>
      </header>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900">{t('budgets.title')}</h2>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <span>{t('budgets.status')}</span>
            <select aria-label={t('budgets.status')} value={status} onChange={(event) => setStatus(event.target.value as BudgetStatus | '')} className="rounded-md border border-gray-300 bg-white px-3 py-2">
              <option value="">{t('budgets.allStatuses')}</option>
              {STATUSES.map((value) => <option key={value} value={value}>{t(`budgets.status${value[0].toUpperCase()}${value.slice(1)}`)}</option>)}
            </select>
          </label>
        </div>
        {budgetsQuery.isLoading ? (
          <p className="p-6 text-sm text-gray-600" role="status">{t('budgets.loading')}</p>
        ) : budgetsQuery.isError ? (
          <p className="p-6 text-sm text-red-700" role="alert">{t('budgets.loadFailed')}</p>
        ) : budgets.length === 0 ? (
          <p className="p-6 text-sm text-gray-600">{t('budgets.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
                <tr>
                  <th className="px-4 py-3">{t('budgets.name')}</th>
                  <th className="px-4 py-3">{t('budgets.period')}</th>
                  <th className="px-4 py-3">{t('budgets.status')}</th>
                  <th className="px-4 py-3 text-right">{t('budgets.totalBudgeted')}</th>
                  <th className="px-4 py-3">{t('budgets.created')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {budgets.map((budget) => (
                  <tr key={budget.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900"><Link className="hover:text-brand-700 hover:underline" to={`/reports/budgets/${budget.id}`} aria-label={`${t('budgets.open')}: ${budget.name}`}>{budget.name}</Link></td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-700">{t('reports.period', { start: formatDate(budget.period_start, i18n.language), end: formatDate(budget.period_end, i18n.language) })}</td>
                    <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[budget.status]}`}>{t(`budgets.status${budget.status[0].toUpperCase()}${budget.status.slice(1)}`)}</span></td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMoney(budget.total_budgeted, i18n.language, currency)}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-gray-600">{formatDate(budget.created_at, i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
