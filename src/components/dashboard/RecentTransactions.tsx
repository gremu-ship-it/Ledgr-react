import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocaleFormat } from '@/i18n';
import { ArrowUpRight, ArrowDownLeft, RefreshCw, Search } from 'lucide-react';
import type { Row } from '@/dal/types/database';
import { LockedPeriodBadge } from '@/components/ui/LockedPeriodBadge';
import { JournalEntryDetailModal } from './JournalEntryDetailModal';

interface RecentTransactionsProps {
  entries?: (Row<'journal_entries'> & { isLocked?: boolean })[];
  isLoading?: boolean;
  isError?: boolean;
}

const statusConfig: Record<string, { labelKey: string; bg: string; text: string }> = {
  posted:   { labelKey: 'dashboard.posted',   bg: 'bg-emerald-50', text: 'text-emerald-800' },
  draft:    { labelKey: 'dashboard.draft',    bg: 'bg-amber-50',   text: 'text-amber-800'  },
  reversed: { labelKey: 'dashboard.reversed', bg: 'bg-gray-100',   text: 'text-gray-700'   },
};

export function RecentTransactions({ entries, isLoading, isError }: RecentTransactionsProps) {
  const { t } = useTranslation();
  const format = useLocaleFormat();
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
    return (
      <p className="flex items-center gap-2 text-sm text-red-700" role="alert">
        <span aria-hidden="true">⚠</span> {t('dashboard.failedRecent')}
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10 text-center" role="status">
        <RefreshCw size={28} className="text-gray-300" aria-hidden="true" />
        <p className="text-sm font-medium text-gray-500">{t('dashboard.noJournalEntries')}</p>
        <p className="text-xs text-gray-600">{t('dashboard.transactionsAppearRecorded')}</p>
      </div>
    );
  }

  const filtered = entries.filter((e) =>
    e.description.toLowerCase().includes(search.toLowerCase()) ||
    (e.reference ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const sorted = [...filtered].sort((a, b) => {
    const x: string = a[sortKey] ?? '';
    const y: string = b[sortKey] ?? '';
    return sortDir === 'asc' ? x.localeCompare(y) : y.localeCompare(x);
  });

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const rows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function renderSortTh(col: typeof sortKey, label: string) {
    const active = sortKey === col;
    return (
      <th
        key={col}
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className="cursor-pointer select-none px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-gray-600 hover:text-brand-700"
        onClick={() => handleSort(col)}
      >
        <button
          type="button"
          onClick={() => handleSort(col)}
          className="inline-flex items-center gap-1 font-bold uppercase tracking-wide text-gray-600 hover:text-brand-700"
        >
          {label}
          <span className="opacity-50" aria-hidden="true">{active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}</span>
        </button>
      </th>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
        <Search className="h-4 w-4 text-gray-500 shrink-0" aria-hidden="true" />
        <label htmlFor="recent-tx-search" className="sr-only">
          {t('dashboard.searchTransactions')}
        </label>
        <input
          id="recent-tx-search"
          type="search"
          placeholder={t('dashboard.searchTransactions')}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-500"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {renderSortTh('entry_date', t('dashboard.date'))}
              {renderSortTh('description', t('dashboard.description'))}
              <th scope="col" className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-gray-600">{t('dashboard.type')}</th>
              {renderSortTh('status', t('dashboard.status'))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  {t('dashboard.noTransactionsMatch')}
                </td>
              </tr>
            ) : rows.map((entry) => {
              const status = statusConfig[entry.status] ?? statusConfig.posted;
              const isIncome  = entry.source_type === 'invoice';
              const isExpense = entry.source_type === 'expense' || entry.source_type === 'payroll';
              const date = format.date(entry.entry_date, { day: '2-digit', month: 'short' });

              // Highlight income/expense descriptions for easy identification
              const descColor = isIncome
                ? 'text-emerald-800'
                : isExpense
                  ? 'text-red-800'
                  : 'text-gray-900';

              return (
                <tr
                  key={entry.id}
                  onClick={() => setSelectedEntryId(entry.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedEntryId(entry.id);
                    }
                  }}
                  tabIndex={0}
                  className="cursor-pointer border-b border-gray-50 transition-colors hover:bg-[#e6f4ef]/40 focus-visible:bg-[#e6f4ef]/40 last:border-0"
                >
                  <th scope="row" className="px-4 py-3 font-normal text-gray-600 whitespace-nowrap">{date}</th>
                  <td className="px-4 py-3">
                    <p className={`font-medium truncate max-w-[180px] ${descColor}`}>{entry.description}</p>
                    {entry.reference && (
                      <p className="text-xs text-gray-500">{entry.reference}</p>
                    )}
                    {!entry.branch_id && !entry.department_id && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        <span aria-hidden="true">⚠</span> Assign cost center
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-semibold text-gray-700">
                      {isIncome  && <ArrowUpRight className="h-3 w-3 text-brand-700" aria-hidden="true" />}
                      {isExpense && <ArrowDownLeft className="h-3 w-3 text-red-700" aria-hidden="true" />}
                      {entry.source_type ?? t('dashboard.journal')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${status.bg} ${status.text}`}>
                        {t(status.labelKey)}
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
          <p className="text-xs text-gray-600" aria-live="polite">
            {t('dashboard.showing', { from: total ? (safePage - 1) * pageSize + 1 : 0, to: Math.min(safePage * pageSize, total), total })}
          </p>
          <div className="flex gap-1" role="group" aria-label="Pagination">
            <button
              type="button"
              disabled={safePage === 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 transition-colors hover:border-brand-600 hover:bg-brand-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >‹</button>
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPage(p)}
                aria-label={`Page ${p}`}
                aria-current={p === safePage ? 'page' : undefined}
                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition-colors ${
                  p === safePage
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-gray-200 text-gray-700 hover:border-brand-600 hover:bg-brand-600 hover:text-white'
                }`}
              >{p}</button>
            ))}
            <button
              type="button"
              disabled={safePage === pages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-semibold text-gray-700 transition-colors hover:border-brand-600 hover:bg-brand-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
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