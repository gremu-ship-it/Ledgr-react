import { useState, useMemo } from 'react';
import { Search, AlertCircle, ScrollText, Plus } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useJournalEntries } from '@/hooks/useJournalEntries';
import { LockedPeriodBadge } from '@/components/ui/LockedPeriodBadge';
import { JournalEntryDetailModal } from '@/components/dashboard/JournalEntryDetailModal';
import { NewJournalEntryModal } from '@/components/dashboard/NewJournalEntryModal';

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

interface DateRange { from: string; to: string; }

const PRESETS = [
  { label: 'This Month', from: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; }, to: todayStr },
  { label: 'This Year', from: startOfYear, to: todayStr },
  { label: 'Last Year', from: () => `${new Date().getFullYear()-1}-01-01`, to: () => `${new Date().getFullYear()-1}-12-31` },
  { label: 'All Time', from: () => '2000-01-01', to: todayStr },
];

const statusColors: Record<string, { bg: string; text: string }> = {
  posted: { bg: 'bg-brand-500/10', text: 'text-brand-700 dark:text-brand-300' },
  draft:  { bg: 'bg-warning/12',   text: 'text-warning' },
};

export function JournalsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  const [range, setRange] = useState<DateRange>({ from: startOfYear(), to: todayStr() });
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [reversedOnly, setReversedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [showNewEntry, setShowNewEntry] = useState(false);
  const pageSize = 15;

  const { data: entries, isLoading, isError } = useJournalEntries(businessId, range.from, range.to);

  const sourceTypes = useMemo(() => {
    if (!entries) return [];
    return Array.from(new Set(entries.map((e) => e.source_type).filter(Boolean))) as string[];
  }, [entries]);

  const statuses = useMemo(() => {
    if (!entries) return [];
    return Array.from(new Set(entries.map((e) => e.status)));
  }, [entries]);

  const filtered = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (sourceFilter !== 'all' && e.source_type !== sourceFilter) return false;
      if (reversedOnly && !e.reversed_by) return false;
      if (search) {
        const q = search.toLowerCase();
        const matches =
          e.description.toLowerCase().includes(q) ||
          e.entry_number.toLowerCase().includes(q) ||
          (e.reference ?? '').toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [entries, statusFilter, sourceFilter, reversedOnly, search]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Journals</h1>
          <p className="mt-1 text-sm text-muted">Browse and search all journal entries for {currentBusiness?.business.name}</p>
        </div>
        <button
          onClick={() => setShowNewEntry(true)}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="h-4 w-4" /> New Entry
        </button>
      </div>

      {/* Date range presets */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-sub">From</label>
          <input
            type="date"
            value={range.from}
            onChange={(e) => { setRange({ ...range, from: e.target.value }); setPage(1); }}
            className="rounded-lg border border-line px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-sub">To</label>
          <input
            type="date"
            value={range.to}
            onChange={(e) => { setRange({ ...range, to: e.target.value }); setPage(1); }}
            className="rounded-lg border border-line px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="flex gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => { setRange({ from: p.from(), to: p.to() }); setPage(1); }}
              className="rounded-lg border border-line bg-card px-3 py-1.5 text-xs font-medium text-sub hover:bg-bg transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-1 min-w-[200px] items-center gap-2 rounded-xl border border-line bg-bg px-3 py-2">
          <Search className="h-4 w-4 text-muted shrink-0" />
          <input
            type="text"
            placeholder="Search description, entry number, reference…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full bg-transparent text-sm text-sub outline-none placeholder:text-muted"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-line px-3 py-2 text-sm text-sub focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>

        <select
          value={sourceFilter}
          onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-line px-3 py-2 text-sm text-sub focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="all">All types</option>
          {sourceTypes.map((s) => (
            <option key={s} value={s} className="capitalize">{s}</option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-sm text-sub">
          <input
            type="checkbox"
            checked={reversedOnly}
            onChange={(e) => { setReversedOnly(e.target.checked); setPage(1); }}
            className="rounded border-line text-brand-600 dark:text-brand-300 focus:ring-brand-500"
          />
          Reversed only
        </label>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-surface" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-danger shrink-0" />
          <p className="text-sm text-danger">Failed to load journal entries.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-12 text-center">
          <ScrollText className="h-8 w-8 text-muted/50" />
          <p className="text-sm font-medium text-muted">No journal entries match your filters</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Entry #</th>
                  <th className="px-4 py-3 text-left">Description</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setSelectedEntryId(entry.id)}
                    className="cursor-pointer hover:bg-bg transition-colors"
                  >
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {new Date(entry.entry_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted">{entry.entry_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink truncate max-w-[220px]">{entry.description}</p>
                      {entry.reference && <p className="text-xs text-muted">{entry.reference}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-line bg-bg px-2 py-0.5 text-xs font-semibold capitalize text-muted">
                        {entry.source_type ?? 'journal'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${statusColors[entry.status]?.bg ?? 'bg-surface'} ${statusColors[entry.status]?.text ?? 'text-sub'}`}>
                          {entry.status}
                        </span>
                        {entry.reversed_by && (
                          <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
                            Reversed
                          </span>
                        )}
                        {entry.isLocked && <LockedPeriodBadge />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3">
              <p className="text-xs text-muted">
                Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, total)} of {total}
              </p>
              <div className="flex gap-1">
                <button
                  disabled={safePage === 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-sm font-semibold text-muted hover:border-brand-500 hover:bg-brand-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >‹</button>
                <button
                  disabled={safePage === pages}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-line text-sm font-semibold text-muted hover:border-brand-500 hover:bg-brand-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                >›</button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedEntryId && (
        <JournalEntryDetailModal
          entryId={selectedEntryId}
          onClose={() => setSelectedEntryId(null)}
        />
      )}

      {showNewEntry && (
        <NewJournalEntryModal
          businessId={businessId}
          onClose={() => setShowNewEntry(false)}
        />
      )}
    </div>
  );
}
