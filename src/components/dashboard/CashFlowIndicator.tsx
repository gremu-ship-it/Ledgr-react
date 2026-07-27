import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatMwk } from '@/lib/formatters';

interface CashFlowIndicatorProps {
  income?: number;
  expenses?: number;
  isLoading?: boolean;
  isError?: boolean;
}

export function CashFlowIndicator({ income, expenses, isLoading, isError }: CashFlowIndicatorProps) {
  const { t } = useTranslation();
  const net = (income ?? 0) - (expenses ?? 0);
  const margin = (income ?? 0) > 0 ? Math.round((net / (income ?? 1)) * 100) : 0;
  const status = net > 0 ? 'profit' : net < 0 ? 'loss' : 'breakeven';

  const config = {
    profit: { label: t('dashboard.profitable'), Icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    loss: { label: t('dashboard.loss'), Icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
    breakeven: { label: t('dashboard.breakEven'), Icon: Minus, color: 'text-gray-500', bg: 'bg-gray-100' },
  }[status];

  const maxVal = Math.max(income ?? 0, expenses ?? 0, 1);
  const incomeW = Math.round(((income ?? 0) / maxVal) * 100);
  const expensesW = Math.round(((expenses ?? 0) / maxVal) * 100);

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 h-4 w-24 rounded bg-gray-100" />
        <div className="mb-2 h-8 w-32 rounded bg-gray-100" />
        <div className="h-3 w-20 rounded bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-5">
        <p className="text-sm text-red-700">{t('dashboard.failedToLoad')}</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">{t('dashboard.cashFlow')}</h3>
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${config.bg}`}>
          <config.Icon className={`h-3.5 w-3.5 ${config.color}`} />
          <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
        </div>
      </div>

      <div className="mb-5">
        <p className="mb-0.5 text-xs text-gray-600">{t('dashboard.netThisMonth')}</p>
        <p className={`text-2xl font-extrabold ${config.color}`}>{formatMwk(Math.abs(net))}</p>
        {(income ?? 0) > 0 && (
          <p className="mt-0.5 text-xs text-gray-600">
            {Math.abs(margin)}% {status === 'profit' ? t('dashboard.profitMargin') : status === 'loss' ? t('dashboard.lossRate') : ''}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <div className="mb-1 flex justify-between">
            <span className="text-xs text-gray-500">{t('dashboard.income')}</span>
            <span className="text-xs font-semibold text-gray-700">{formatMwk(income ?? 0)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-2 rounded-full transition-all duration-700" style={{ width: `${incomeW}%`, background: 'linear-gradient(90deg, #065c42, #14b886)' }} />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between">
            <span className="text-xs text-gray-500">{t('dashboard.expenses')}</span>
            <span className="text-xs font-semibold text-gray-700">{formatMwk(expenses ?? 0)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-2 rounded-full bg-red-400 transition-all duration-700" style={{ width: `${expensesW}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
