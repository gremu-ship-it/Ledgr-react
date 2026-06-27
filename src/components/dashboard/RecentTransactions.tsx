import { ArrowUpRight, ArrowDownLeft, RefreshCw } from 'lucide-react';
import type { Row } from '@/dal/types/database';

interface RecentTransactionsProps {
  entries?: Row<'journal_entries'>[];
  isLoading?: boolean;
  isError?: boolean;
}

const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
  posted:   { label: 'Posted',   bg: 'bg-emerald-50', text: 'text-brand-600' },
  draft:    { label: 'Draft',    bg: 'bg-amber-50',   text: 'text-amber-600' },
  reversed: { label: 'Reversed', bg: 'bg-gray-100',   text: 'text-gray-500'  },
};

const sourceIcon: Record<string, React.ElementType> = {
  invoice:  ArrowUpRight,
  expense:  ArrowDownLeft,
  payroll:  ArrowDownLeft,
  default:  RefreshCw,
};

function EntryIcon({ sourceType }: { sourceType: string | null }) {
  const isIncome  = sourceType === 'invoice';
  const isExpense = sourceType === 'expense' || sourceType === 'payroll';
  const Icon = sourceIcon[sourceType ?? 'default'] ?? sourceIcon.default;

  const bg    = isIncome  ? 'bg-emerald-50'  : isExpense ? 'bg-red-50'   : 'bg-gray-50';
  const color = isIncome  ? 'text-brand-500' : isExpense ? 'text-red-400' : 'text-gray-400';

  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${bg}`}>
      <Icon size={14} className={color} />
    </div>
  );
}

export function RecentTransactions({ entries, isLoading, isError }: RecentTransactionsProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gray-100" />
            <div className="flex-1">
              <div className="mb-1.5 h-3 w-40 rounded bg-gray-100" />
              <div className="h-2.5 w-24 rounded bg-gray-100" />
            </div>
            <div className="h-3 w-20 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="text-sm text-red-500">Failed to load recent transactions.</p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <RefreshCw size={28} className="text-gray-200" />
        <p className="text-sm font-medium text-gray-400">No journal entries yet</p>
        <p className="text-xs text-gray-300">
          Transactions will appear here once invoices or expenses are recorded
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-50">
      {entries.map((entry) => {
        const status = statusConfig[entry.status] ?? statusConfig.posted;
        const date = new Date(entry.entry_date).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        });

        return (
          <div key={entry.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <EntryIcon sourceType={entry.source_type} />

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-800">
                {entry.description}
              </p>
              <div className="mt-0.5 flex items-center gap-2">
                <span className="text-xs text-gray-400">{date}</span>
                {entry.reference && (
                  <>
                    <span className="text-gray-200">·</span>
                    <span className="text-xs text-gray-400">{entry.reference}</span>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-1">
              <span className="text-sm font-semibold text-gray-800">
                {entry.currency} {entry.entry_number}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.bg} ${status.text}`}>
                {status.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
