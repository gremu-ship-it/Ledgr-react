import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatMwk } from '@/lib/formatters';

interface CashFlowIndicatorProps {
  income?: number;
  expenses?: number;
  isLoading?: boolean;
  isError?: boolean;
}

export function CashFlowIndicator({
  income,
  expenses,
  isLoading,
  isError,
}: CashFlowIndicatorProps) {
  const net = (income ?? 0) - (expenses ?? 0);
  const margin =
    (income ?? 0) > 0 ? Math.round((net / (income ?? 1)) * 100) : 0;

  const status: 'profit' | 'loss' | 'breakeven' =
    net > 0 ? 'profit' : net < 0 ? 'loss' : 'breakeven';

  const config = {
    profit: {
      label: 'Profitable',
      icon: TrendingUp,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-brand-500',
      barColor: 'bg-brand-500',
      textColor: 'text-brand-600',
      borderColor: 'border-brand-100',
    },
    loss: {
      label: 'Loss Making',
      icon: TrendingDown,
      iconBg: 'bg-red-50',
      iconColor: 'text-red-500',
      barColor: 'bg-red-400',
      textColor: 'text-red-600',
      borderColor: 'border-red-100',
    },
    breakeven: {
      label: 'Break Even',
      icon: Minus,
      iconBg: 'bg-gray-50',
      iconColor: 'text-gray-400',
      barColor: 'bg-gray-300',
      textColor: 'text-gray-500',
      borderColor: 'border-gray-100',
    },
  }[status];

  const Icon = config.icon;

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-soft animate-pulse">
        <div className="h-4 w-24 rounded bg-gray-100 mb-4" />
        <div className="h-8 w-32 rounded bg-gray-100 mb-2" />
        <div className="h-3 w-20 rounded bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-soft flex items-center justify-center">
        <p className="text-sm text-red-500">Failed to load</p>
      </div>
    );
  }

  // Income bar width as % of the larger of income/expenses
  const maxVal = Math.max(income ?? 0, expenses ?? 0, 1);
  const incomeWidth = Math.round(((income ?? 0) / maxVal) * 100);
  const expensesWidth = Math.round(((expenses ?? 0) / maxVal) * 100);

  return (
    <div className={`rounded-2xl border ${config.borderColor} bg-white p-5 shadow-soft`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-900">Cash Flow</h2>
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${config.iconBg}`}>
          <Icon className={`h-3.5 w-3.5 ${config.iconColor}`} />
          <span className={`text-xs font-semibold ${config.textColor}`}>{config.label}</span>
        </div>
      </div>

      {/* Net profit figure */}
      <div className="mb-4">
        <p className="text-xs text-gray-400 mb-0.5">Net this month</p>
        <p className={`text-2xl font-bold ${config.textColor}`}>
          {formatMwk(Math.abs(net))}
        </p>
        {(income ?? 0) > 0 && (
          <p className="text-xs text-gray-400 mt-0.5">
            {Math.abs(margin)}% {status === 'profit' ? 'margin' : status === 'loss' ? 'loss rate' : ''}
          </p>
        )}
      </div>

      {/* Stacked bars */}
      <div className="space-y-2.5">
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-gray-500">Income</span>
            <span className="text-xs font-medium text-gray-700">{formatMwk(income ?? 0)}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className="h-1.5 rounded-full bg-brand-500 transition-all duration-500"
              style={{ width: `${incomeWidth}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex justify-between mb-1">
            <span className="text-xs text-gray-500">Expenses</span>
            <span className="text-xs font-medium text-gray-700">{formatMwk(expenses ?? 0)}</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-gray-100">
            <div
              className="h-1.5 rounded-full bg-red-400 transition-all duration-500"
              style={{ width: `${expensesWidth}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
