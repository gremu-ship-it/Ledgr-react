import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Shield, CheckCircle2, XCircle, AlertTriangle, Download,
  Search, Filter, ChevronDown, ChevronRight, RefreshCw,
  Eye, Clock, User, Database, FileText,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import { AuditLogRepository } from '@/dal/repositories/AuditLogRepository';
import { PermissionGate } from '@/components/rbac/PermissionGate';
import type { AuditLogEntry, ChainVerificationResult } from '@/dal/repositories/AuditLogRepository';

const auditRepo = new AuditLogRepository(supabase);

// ── Helpers ───────────────────────────────────────────────────────────────────

function cls(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('en-MW', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtTable(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const EVENT_COLORS: Record<string, string> = {
  INSERT:                    'bg-emerald-50 text-emerald-700',
  UPDATE:                    'bg-blue-50 text-blue-700',
  DELETE:                    'bg-red-50 text-red-700',
  journal_entry_reversed:    'bg-purple-50 text-purple-700',
};

function EventBadge({ type }: { type: string }) {
  const color = EVENT_COLORS[type] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={cls('inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', color)}>
      {type}
    </span>
  );
}

function ChainBadge({ valid, hash }: { valid?: boolean; hash?: string | null }) {
  if (!hash) return <span className="text-xs text-gray-400">—</span>;
  if (valid === undefined) return <span className="font-mono text-xs text-gray-400">{hash.slice(0, 8)}…</span>;
  return (
    <span className={cls(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
      valid ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
    )}>
      {valid
        ? <><CheckCircle2 className="h-3 w-3" />{hash.slice(0, 8)}…</>
        : <><XCircle className="h-3 w-3" />TAMPERED</>}
    </span>
  );
}

// ── JSON Diff Viewer ──────────────────────────────────────────────────────────

function JsonDiff({ old: oldVal, next: newVal, fields }: {
  old?: Record<string, unknown> | null;
  next?: Record<string, unknown> | null;
  fields?: string[] | null;
}) {
  if (!oldVal && !newVal) return <p className="text-xs text-gray-400">No data</p>;

  const keys = Array.from(new Set([
    ...Object.keys(oldVal ?? {}),
    ...Object.keys(newVal ?? {}),
  ])).filter((k) => !['updated_at', 'created_at'].includes(k));

  const changedKeys = new Set(fields ?? []);

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-100 bg-gray-50">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-100">
            <th className="px-3 py-1.5 text-left font-semibold text-gray-500">Field</th>
            {oldVal && <th className="px-3 py-1.5 text-left font-semibold text-gray-500">Before</th>}
            {newVal && <th className="px-3 py-1.5 text-left font-semibold text-gray-500">After</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {keys.map((k) => {
            const isChanged = changedKeys.size > 0 ? changedKeys.has(k) : oldVal?.[k] !== newVal?.[k];
            return (
              <tr key={k} className={isChanged ? 'bg-amber-50' : ''}>
                <td className="px-3 py-1.5 font-mono text-gray-600">{k}</td>
                {oldVal && (
                  <td className="px-3 py-1.5 font-mono text-red-700">
                    {oldVal[k] !== undefined ? JSON.stringify(oldVal[k]) : '—'}
                  </td>
                )}
                {newVal && (
                  <td className="px-3 py-1.5 font-mono text-emerald-700">
                    {newVal[k] !== undefined ? JSON.stringify(newVal[k]) : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Audit Entry Row ───────────────────────────────────────────────────────────

function AuditRow({
  entry,
  chainResult,
}: {
  entry: AuditLogEntry;
  chainResult?: ChainVerificationResult;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            <Clock className="h-3 w-3" />
            {fmtDate(entry.occurred_at)}
          </div>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <Database className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <span className="text-xs font-medium text-gray-700">{fmtTable(entry.resource_type)}</span>
          </div>
          {entry.resource_ref && (
            <p className="mt-0.5 text-xs text-gray-400">{entry.resource_ref}</p>
          )}
        </td>
        <td className="px-4 py-3">
          <EventBadge type={entry.event_type} />
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5">
            <User className="h-3 w-3 text-gray-400" />
            <span className="text-xs text-gray-600">{entry.user_email ?? entry.user_id?.slice(0, 8) ?? '—'}</span>
          </div>
        </td>
        <td className="px-4 py-3">
          <ChainBadge
            valid={chainResult?.chain_valid}
            hash={entry.entry_hash}
          />
        </td>
        <td className="px-4 py-3 text-right">
          {expanded
            ? <ChevronDown className="h-4 w-4 text-gray-400 ml-auto" />
            : <ChevronRight className="h-4 w-4 text-gray-400 ml-auto" />}
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={6} className="px-4 pb-4 pt-0 bg-gray-50 border-b border-gray-100">
            <div className="space-y-3 pt-2">
              {/* Hash chain info */}
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Hash Chain</p>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <div>
                    <p className="text-xs text-gray-500">Previous hash</p>
                    <p className="font-mono text-xs text-gray-700 break-all">{entry.prev_hash ?? 'GENESIS'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Entry hash</p>
                    <p className="font-mono text-xs text-gray-700 break-all">{entry.entry_hash ?? '—'}</p>
                  </div>
                </div>
                {chainResult && !chainResult.chain_valid && (
                  <div className="mt-2 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    Chain integrity violation detected — this entry may have been tampered with.
                  </div>
                )}
              </div>

              {/* Data diff */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {entry.event_type === 'INSERT' ? 'Created Values' :
                   entry.event_type === 'DELETE' ? 'Deleted Values' : 'Changes'}
                </p>
                <JsonDiff
                  old={entry.old_values as Record<string, unknown> | null}
                  next={entry.new_values as Record<string, unknown> | null}
                  fields={entry.changed_fields}
                />
              </div>

              {/* Notes */}
              {entry.notes && (
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Notes</p>
                  <p className="text-sm text-gray-700">{entry.notes}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  const [page, setPage]             = useState(0);
  const [search, setSearch]         = useState('');
  const [fromDate, setFromDate]     = useState('');
  const [toDate, setToDate]         = useState('');
  const [resourceType, setResourceType] = useState('');
  const [eventType, setEventType]   = useState('');
  const [userId, setUserId]         = useState('');
  const [showVerify, setShowVerify] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // ── Audit log query ───────────────────────────────────────────
  const { data: logData, isLoading, isError, refetch } = useQuery({
    queryKey: ['audit_log', businessId, page, search, fromDate, toDate, resourceType, eventType, userId],
    queryFn: () => auditRepo.findByBusiness({
      businessId: businessId!,
      fromDate:     fromDate || undefined,
      toDate:       toDate   || undefined,
      userId:       userId   || undefined,
      resourceType: resourceType || undefined,
      eventType:    eventType    || undefined,
      search:       search       || undefined,
      limit:  PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    enabled: Boolean(businessId),
    staleTime: 30_000,
  });

  // ── Chain verification query ──────────────────────────────────
  const { data: chainData, isLoading: chainLoading, refetch: refetchChain } = useQuery({
    queryKey: ['audit_chain', businessId, resourceType],
    queryFn: () => auditRepo.verifyChain(businessId!, resourceType || undefined),
    enabled: Boolean(businessId) && showVerify,
    staleTime: 60_000,
  });

  // ── Resource types ────────────────────────────────────────────
  const { data: resourceTypes = [] } = useQuery({
    queryKey: ['audit_resource_types', businessId],
    queryFn: () => auditRepo.getDistinctResourceTypes(businessId!),
    enabled: Boolean(businessId),
    staleTime: 5 * 60_000,
  });

  // ── Users ─────────────────────────────────────────────────────
  const { data: users = [] } = useQuery({
    queryKey: ['audit_users', businessId],
    queryFn: () => auditRepo.getDistinctUsers(businessId!),
    enabled: Boolean(businessId),
    staleTime: 5 * 60_000,
  });

  // Chain lookup map for O(1) access
  const chainMap = new Map<number, ChainVerificationResult>(
    (chainData ?? []).map((r) => [r.id, r]),
  );

  const totalPages = Math.ceil((logData?.count ?? 0) / PAGE_SIZE);
  const tamperCount = showVerify
    ? (chainData ?? []).filter((r) => !r.chain_valid).length
    : 0;

  // ── CSV Export ────────────────────────────────────────────────
  const handleExportCSV = useCallback(() => {
    if (!logData?.data.length) return;

    const headers = [
      'occurred_at', 'resource_type', 'resource_ref', 'event_type',
      'user_email', 'changed_fields', 'entry_hash', 'prev_hash', 'chain_valid',
    ];

    const rows = logData.data.map((e) => {
      const chain = chainMap.get(e.id as unknown as number);
      return [
        e.occurred_at,
        e.resource_type,
        e.resource_ref ?? '',
        e.event_type,
        e.user_email ?? e.user_id ?? '',
        (e.changed_fields ?? []).join('; '),
        e.entry_hash ?? '',
        e.prev_hash ?? '',
        chain ? (chain.chain_valid ? 'VALID' : 'TAMPERED') : '',
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledgr_audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logData, chainMap]);

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <PermissionGate
      check={(p) => p.canExport}
      fallback={
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <Shield className="h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">Access Restricted</p>
          <p className="text-xs text-gray-400">You need at least Auditor role to view the audit log.</p>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">Audit Log</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              Immutable, hash-chained record of all financial changes · IFRS compliant
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => { setShowVerify((v) => !v); if (!showVerify) refetchChain(); }}
              className={cls(
                'flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                showVerify
                  ? 'bg-brand-500 text-white hover:bg-brand-600'
                  : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
              )}
            >
              {chainLoading
                ? <RefreshCw className="h-4 w-4 animate-spin" />
                : <CheckCircle2 className="h-4 w-4" />}
              {showVerify ? 'Verification On' : 'Verify Chain'}
            </button>
            <button
              onClick={handleExportCSV}
              disabled={!logData?.data.length}
              className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
            >
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Tamper alert */}
        {showVerify && tamperCount > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-red-500" />
            <div>
              <p className="text-sm font-bold text-red-800">
                {tamperCount} integrity violation{tamperCount !== 1 ? 's' : ''} detected
              </p>
              <p className="text-xs text-red-700">
                Hash chain is broken. Entries marked in red may have been tampered with. Contact your system administrator immediately.
              </p>
            </div>
          </div>
        )}

        {/* Chain OK banner */}
        {showVerify && !chainLoading && tamperCount === 0 && (chainData?.length ?? 0) > 0 && (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
            <p className="text-sm font-semibold text-emerald-800">
              Hash chain verified — {chainData?.length} entries, all intact.
            </p>
          </div>
        )}

        {/* Filters */}
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by reference, email, or notes…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={cls(
                'flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition-colors',
                filtersOpen
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50',
              )}
            >
              <Filter className="h-4 w-4" />
              Filters
            </button>
            <button
              onClick={() => { refetch(); if (showVerify) refetchChain(); }}
              className="rounded-xl border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {filtersOpen && (
            <div className="mt-4 grid grid-cols-1 gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); setPage(0); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); setPage(0); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Table</label>
                <select
                  value={resourceType}
                  onChange={(e) => { setResourceType(e.target.value); setPage(0); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="">All tables</option>
                  {resourceTypes.map((t) => (
                    <option key={t} value={t}>{fmtTable(t)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Action</label>
                <select
                  value={eventType}
                  onChange={(e) => { setEventType(e.target.value); setPage(0); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="">All actions</option>
                  <option value="INSERT">INSERT</option>
                  <option value="UPDATE">UPDATE</option>
                  <option value="DELETE">DELETE</option>
                  <option value="journal_entry_reversed">Reversal</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">User</label>
                <select
                  value={userId}
                  onChange={(e) => { setUserId(e.target.value); setPage(0); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="">All users</option>
                  {users.map((u) => (
                    <option key={u.user_id} value={u.user_id}>
                      {u.user_email ?? u.user_id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-3">
                <button
                  onClick={() => {
                    setFromDate(''); setToDate(''); setResourceType('');
                    setEventType(''); setUserId(''); setSearch(''); setPage(0);
                  }}
                  className="text-sm font-medium text-gray-400 hover:text-gray-600"
                >
                  Clear filters
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Entries', value: logData?.count ?? '—', icon: FileText, color: 'text-gray-900' },
            { label: 'Shown',         value: logData?.data.length ?? '—', icon: Eye, color: 'text-brand-700' },
            { label: 'Verified',      value: showVerify ? (chainData?.length ?? '—') : '—', icon: CheckCircle2, color: 'text-emerald-700' },
            { label: 'Violations',    value: showVerify ? tamperCount : '—', icon: AlertTriangle, color: tamperCount > 0 ? 'text-red-600' : 'text-gray-400' },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2">
                  <Icon className={cls('h-4 w-4', stat.color)} />
                  <p className="text-xs text-gray-500">{stat.label}</p>
                </div>
                <p className={cls('mt-1 text-xl font-bold', stat.color)}>{stat.value}</p>
              </div>
            );
          })}
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <AlertTriangle className="h-8 w-8 text-red-400" />
              <p className="text-sm font-medium text-red-600">Failed to load audit log</p>
              <button onClick={() => refetch()} className="text-xs text-brand-600 hover:underline">Try again</button>
            </div>
          ) : !logData?.data.length ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Shield className="h-8 w-8 text-gray-200" />
              <p className="text-sm font-medium text-gray-500">No audit entries found</p>
              <p className="text-xs text-gray-400">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-400">Timestamp</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-400">Resource</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-400">Action</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-400">User</th>
                    <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-gray-400">Hash</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {logData.data.map((entry) => (
                    <AuditRow
                      key={entry.id}
                      entry={entry}
                      chainResult={chainMap.get(entry.id as unknown as number)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
              <p className="text-xs text-gray-500">
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, logData?.count ?? 0)} of {logData?.count ?? 0}
              </p>
              <div className="flex gap-1">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-semibold text-gray-500 transition-colors hover:border-brand-500 hover:bg-brand-500 hover:text-white disabled:opacity-40"
                >‹</button>
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i).map((i) => (
                  <button
                    key={i}
                    onClick={() => setPage(i)}
                    className={cls(
                      'flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold transition-colors',
                      i === page
                        ? 'border-brand-500 bg-brand-500 text-white'
                        : 'border-gray-200 text-gray-500 hover:border-brand-500 hover:bg-brand-500 hover:text-white',
                    )}
                  >{i + 1}</button>
                ))}
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-gray-200 text-sm font-semibold text-gray-500 transition-colors hover:border-brand-500 hover:bg-brand-500 hover:text-white disabled:opacity-40"
                >›</button>
              </div>
            </div>
          )}
        </div>

        {/* IFRS compliance note */}
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />
            <div className="text-xs text-gray-500">
              <span className="font-semibold text-gray-700">IFRS Compliance: </span>
              This audit log is append-only and immutable at the database level via trigger enforcement.
              Each entry is SHA-256 hash-chained to the previous entry — any tampering breaks the chain and is immediately detectable.
              The log captures all INSERT, UPDATE, and DELETE operations on financial tables including journal entries, invoices, expenses, and payroll.
              Export as CSV for external auditors or regulators.
            </div>
          </div>
        </div>
      </div>
    </PermissionGate>
  );
}
