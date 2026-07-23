import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatMwk } from '@/lib/formatters';

interface CashFlowIndicatorProps {
  income?: number;
  expenses?: number;
  isLoading?: boolean;
  isError?: boolean;
}

export function CashFlowIndicator({ income, expenses, isLoading, isError }: CashFlowIndicatorProps) {
  const net    = (income ?? 0) - (expenses ?? 0);
  const margin = (income ?? 0) > 0 ? Math.round((net / (income ?? 1)) * 100) : 0;
  const status = net > 0 ? 'profit' : net < 0 ? 'loss' : 'breakeven';

  const config = {
    profit:    { label: 'Profitable', Icon: TrendingUp,   color: 'text-brand-600 dark:text-brand-400', bg: 'bg-brand-500/10'  },
    loss:      { label: 'Loss',       Icon: TrendingDown, color: 'text-danger',     bg: 'bg-danger/10'      },
    breakeven: { label: 'Break Even', Icon: Minus,        color: 'text-muted',    bg: 'bg-surface'    },
  }[status];

  const maxVal = Math.max(income ?? 0, expenses ?? 0, 1);
  const incomeW  = Math.round(((income  ?? 0) / maxVal) * 100);
  const expensesW = Math.round(((expenses ?? 0) / maxVal) * 100);

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl border border-line bg-card p-5">
        <div className="mb-4 h-4 w-24 rounded bg-surface" />
        <div className="mb-2 h-8 w-32 rounded bg-surface" />
        <div className="h-3 w-20 rounded bg-surface" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-line bg-card p-5">
        <p className="text-sm text-danger">Failed to load</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-5 shadow-sm">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-ink">Cash Flow</h3>
        <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${config.bg}`}>
          <config.Icon className={`h-3.5 w-3.5 ${config.color}`} />
          <span className={`text-xs font-bold ${config.color}`}>{config.label}</span>
        </div>
      </div>

      {/* Net figure */}
      <div className="mb-5">
        <p className="text-xs text-muted mb-0.5">Net this month</p>
        <p className={`text-2xl font-extrabold ${config.color}`}>
          {formatMwk(Math.abs(net))}
        </p>
        {(income ?? 0) > 0 && (
          <p className="text-xs text-muted mt-0.5">
            {Math.abs(margin)}% {status === 'profit' ? 'profit margin' : status === 'loss' ? 'loss rate' : ''}
          </p>
        )}
      </div>

      {/* Bars */}
      <div className="space-y-3">
        <div>
          <div className="mb-1 flex justify-between">
            <span className="text-xs text-muted">Income</span>
            <span className="text-xs font-semibold text-sub">{formatMwk(income ?? 0)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-2 rounded-full transition-all duration-700"
              style={{ width: `${incomeW}%`, background: 'linear-gradient(90deg, #0F766E, #2DD4A7)' }}
            />
          </div>
        </div>
        <div>
          <div className="mb-1 flex justify-between">
            <span className="text-xs text-muted">Expenses</span>
            <span className="text-xs font-semibold text-sub">{formatMwk(expenses ?? 0)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface">
            <div
              className="h-2 rounded-full bg-danger/80 transition-all duration-700"
              style={{ width: `${expensesW}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
