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
  posted:   { label: 'Posted',   bg: 'bg-emerald-50', text: 'text-emerald-700' },
  draft:    { label: 'Draft',    bg: 'bg-amber-50',   text: 'text-amber-600'  },
  reversed: { label: 'Reversed', bg: 'bg-gray-100',   text: 'text-gray-500'   },
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
            <div className="h-8 w-8 rounded-lg bg-gray-100" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-40 rounded bg-gray-100" />
              <div className="h-2.5 w-24 rounded bg-gray-100" />
            </div>
            <div className="h-3 w-20 rounded bg-gray-100" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return <p className="text-sm text-red-500">Failed to load recent transactions.</p>;
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
        <RefreshCw size={28} className="text-gray-200" />
        <p className="text-sm font-medium text-gray-400">No journal entries yet</p>
        <p className="text-xs text-gray-300">Transactions will appear here once recorded</p>
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
        className="cursor-pointer select-none px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-400 hover:text-brand-600"
        onClick={() => handleSort(col)}
      >
        {label}
        <span className="ml-1 opacity-50">{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
      </th>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <Search className="h-4 w-4 text-gray-400 shrink-0" />
        <input
          type="text"
          placeholder="Search transactions…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <SortTh col="entry_date"   label="Date" />
              <SortTh col="description"  label="Description" />
              <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-400">Type</th>
              <SortTh col="status"       label="Status" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">
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
                  className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-[#e6f4ef]/40 last:border-0"
                >
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{date}</td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-800 truncate max-w-[180px]">{entry.description}</p>
                    {entry.reference && (
                      <p className="text-xs text-gray-400">{entry.reference}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-500">
                      {isIncome  && <ArrowUpRight className="h-3 w-3 text-brand-500" />}
                      {isExpense && <ArrowDownLeft className="h-3 w-3 text-red-400" />}
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
          <p className="text-xs text-gray-400">
            Showing {total ? (safePage - 1) * pageSize + 1 : 0}–{Math.min(safePage * pageSize, total)} of {total}
          </p>
          <div className="flex gap-1">
            <button
              disabled={safePage === 1}
              onClick={() => setPage((p) => p - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-semibold text-gray-500 transition-colors hover:border-brand-500 hover:bg-brand-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >‹</button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition-colors ${
                  p === safePage
                    ? 'border-brand-500 bg-brand-500 text-white'
                    : 'border-gray-200 text-gray-500 hover:border-brand-500 hover:bg-brand-500 hover:text-white'
                }`}
              >{p}</button>
            ))}
            <button
              disabled={safePage === pages}
              onClick={() => setPage((p) => p + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-semibold text-gray-500 transition-colors hover:border-brand-500 hover:bg-brand-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
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