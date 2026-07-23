import { useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, RefreshCw, Search } from 'lucide-react';
import type { Row } from '@/dal/types/database';
import { LockedPeriodBadge } from '@/components/ui/LockedPeriodBadge';
import { JournalEntryDetailModal } from './JournalEntryDetailModal';

interface RecentTransactionsProps {
  entries?: (Row<'journal_entries'> & { isLocked?: boolean })[];
  isLoading?: boolean;
  isError?: boolean;
}

const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
  posted:   { label: 'Posted',   bg: 'bg-brand-500/10', text: 'text-brand-700 dark:text-brand-300' },
  draft:    { label: 'Draft',    bg: 'bg-warning/12',   text: 'text-warning'  },
  reversed: { label: 'Reversed', bg: 'bg-surface',   text: 'text-muted'   },
};

export function RecentTransactions({ entries, isLoading, isError }: RecentTransactionsProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey]   = useState<'entry_date' | 'description' | 'status'>('entry_date');
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('desc');
  const [page, setPage]         = useState(1);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const pageSize = 5;

  function handleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
    setPage(1);
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex animate-pulse items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-surface" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-40 rounded bg-surface" />
              <div className="h-2.5 w-24 rounded bg-surface" />
            </div>
            <div className="h-3 w-20 rounded bg-surface" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-danger">Failed to load recent transactions.</p>;
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <RefreshCw size={28} className="text-muted" />
        <p className="text-sm font-medium text-muted">No journal entries yet</p>
        <p className="text-xs text-muted/50">Transactions will appear here once recorded</p>
      </div>
    );
  }

  const filtered = entries.filter((e) =>
    e.description.toLowerCase().includes(search.toLowerCase()) ||
    (e.reference ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const sorted = [...filtered].sort((a, b) => {
    let x: string = a[sortKey] ?? '';
    let y: string = b[sortKey] ?? '';
    return sortDir === 'asc' ? x.localeCompare(y) : y.localeCompare(x);
  });

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const rows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function SortTh({ col, label }: { col: typeof sortKey; label: string }) {
    const active = sortKey === col;
    return (
      <th
        className="cursor-pointer select-none px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted hover:text-brand-600 dark:text-brand-300"
        onClick={() => handleSort(col)}
      >
        {label}
        <span className="ml-1 opacity-50">{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2">
        <Search className="h-4 w-4 text-muted shrink-0" />
        <input
          type="text"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full bg-transparent text-sm text-sub outline-none placeholder:text-muted"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <SortTh col="entry_date"   label="Date" />
              <SortTh col="description"  label="Description" />
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-muted">Type</th>
              <SortTh col="status"       label="Status" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-muted">
                  No transactions match your search.
                </td>
              </tr>
            ) : rows.map((entry) => {
              const status = statusConfig[entry.status] ?? statusConfig.posted;
              const isIncome  = entry.source_type === 'invoice';
              const isExpense = entry.source_type === 'expense' || entry.source_type === 'payroll';
              const date = new Date(entry.entry_date).toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short',
              });

              return (
                <tr
                  key={entry.id}
                  onClick={() => setSelectedEntryId(entry.id)}
                  className="cursor-pointer border-b border-line transition-colors hover:bg-brand-500/8 last:border-0"
                >
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{date}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink truncate max-w-[180px]">{entry.description}</p>
                    {entry.reference && (
                      <p className="text-xs text-muted">{entry.reference}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-0.5 text-xs font-semibold text-muted">
                      {isIncome  && <ArrowUpRight className="h-3 w-3 text-brand-600 dark:text-brand-400" />}
                      {isExpense && <ArrowDownLeft className="h-3 w-3 text-danger" />}
                      {entry.source_type ?? 'journal'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${status.bg} ${status.text}`}>
                        {status.label}
                      </span>
                      {entry.isLocked && <LockedPeriodBadge />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {total > pageSize && (
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted">
            Showing {total ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, total)} of {total}
          </p>
          <div className="flex gap-1">
            <button
              disabled={safePage === 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-sm font-semibold text-muted transition-colors hover:border-brand-500 hover:bg-brand-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >‹</button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition-colors ${
                  p === safePage
                    ? 'border-brand-500 bg-brand-600 text-white'
                    : 'border-line text-muted hover:border-brand-500 hover:bg-brand-700 hover:text-white'
                }`}
              >{p}</button>
            ))}
            <button
              disabled={safePage === pages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-sm font-semibold text-muted transition-colors hover:border-brand-500 hover:bg-brand-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >›</button>
          </div>
        </div>
      )}

      {selectedEntryId && (
        <JournalEntryDetailModal
          entryId={selectedEntryId}
          onClose={() => setSelectedEntryId(null)}
        />
      )}
    </div>
  );
}