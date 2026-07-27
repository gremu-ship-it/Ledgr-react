import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, RotateCcw, Lock, AlertCircle, MapPin, Loader2 } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { nextEntryNumber } from '@/services/journalService';

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface JournalEntryDetailModalProps {
  entryId: string;
  onClose: () => void;
}

export function JournalEntryDetailModal({ entryId, onClose }: JournalEntryDetailModalProps) {
  const currentUser = useAppStore((s) => s.currentUser);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const role = currentBusiness?.role;
  const canReverse = role === 'owner' || role === 'admin';

  const queryClient = useQueryClient();
  const [showReverseForm, setShowReverseForm] = useState(false);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAssignCenter, setShowAssignCenter] = useState(false);
  const [assignBranchId, setAssignBranchId] = useState('');
  const [assignDeptId, setAssignDeptId] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['journal_entry_detail', entryId],
    queryFn: () => repos.journal.findByIdWithLines(entryId),
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', data?.entry.business_id],
    queryFn: () => repos.account.findByBusiness(data!.entry.business_id),
    enabled: Boolean(data?.entry.business_id),
  });

  const { data: period } = useQuery({
    queryKey: ['period_for_entry', data?.entry.period_id],
    queryFn: () => repos.period.findById(data!.entry.period_id!),
    enabled: Boolean(data?.entry.period_id),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', data?.entry.business_id],
    queryFn: () => repos.branch.findActive(data!.entry.business_id),
    enabled: Boolean(data?.entry.business_id),
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['departments', data?.entry.business_id],
    queryFn: () => repos.department.findActive(data!.entry.business_id),
    enabled: Boolean(data?.entry.business_id),
  });

  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a])),
    [accounts],
  );

  async function handleConfirmReverse() {
    if (!data || !currentUser) return;
    if (!reason.trim()) {
      setError('A reason is required to reverse this entry.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const entryNumber = await nextEntryNumber(data.entry.business_id);
      const today = new Date().toISOString().slice(0, 10);
      await repos.journal.reverse(data.entry.id, entryNumber, today, currentUser.id, reason.trim());

      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal_entry_detail', entryId] });
      queryClient.invalidateQueries({ queryKey: ['accounting_periods'] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reverse entry.');
    } finally {
      setSubmitting(false);
    }
  }

  const canActuallyReverse =
    canReverse &&
    data?.entry.status === 'posted' &&
    !data.entry.reversal_of &&
    !data.entry.reversed_by;

  const needsCostCenter = data?.entry && !data.entry.branch_id && !data.entry.department_id;
  const canAssignCenter = data?.entry && (role === 'owner' || role === 'admin' || role === 'accountant');

  const assignCenterMutation = useMutation({
    mutationFn: async () => {
      if (!data) return;
      // Entry, lines and any linked source document are updated together by
      // the repository, tenant-scoped by business_id.
      await repos.journal.assignCostCentre(
        data.entry.id,
        assignBranchId || null,
        assignDeptId || null,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      queryClient.invalidateQueries({ queryKey: ['journal_entry_detail', entryId] });
      setShowAssignCenter(false);
      setAssignBranchId('');
      setAssignDeptId('');
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to assign cost center.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Journal Entry</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-6 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          ) : isError || !data ? (
            <p className="text-sm text-red-500">Failed to load this entry.</p>
          ) : (
            <>
              <div className="mb-4 space-y-1">
                <p className="text-sm font-medium text-gray-900">{data.entry.description}</p>
                <p className="text-xs text-gray-400">
                  {data.entry.entry_number} · {new Date(data.entry.entry_date).toLocaleDateString('en-MW', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-gray-600">
                    {data.entry.status}
                  </span>
                  {period?.is_closed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                      <Lock className="h-3 w-3" /> Locked period
                    </span>
                  )}
                  {data.entry.reversal_of && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      This is a reversal entry
                    </span>
                  )}
                  {data.entry.reversed_by && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
                      Reversed
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-gray-100">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {data.lines.map((line) => {
                      const acc = accountMap[line.account_id];
                      return (
                        <tr key={line.id}>
                          <td className="px-3 py-2 text-gray-700">
                            {acc ? `${acc.code} — ${acc.name}` : line.account_id}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {line.is_debit ? formatMwk(Number(line.amount_base)) : ''}
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">
                            {!line.is_debit ? formatMwk(Number(line.amount_base)) : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Cost/Revenue center assignment */}
              {needsCostCenter && canAssignCenter && !showAssignCenter && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                  <MapPin className="h-4 w-4 text-amber-600 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-amber-800">No cost center assigned</p>
                    <p className="text-[11px] text-amber-600">Assign a branch or department for reporting purposes.</p>
                  </div>
                  <button
                    onClick={() => setShowAssignCenter(true)}
                    className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                  >
                    Assign
                  </button>
                </div>
              )}

              {!needsCostCenter && data.entry.status === 'posted' && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  {data.entry.branch_id && branches.find((b) => b.id === data.entry.branch_id) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-brand-700">
                      <MapPin className="h-3 w-3" />
                      {branches.find((b) => b.id === data.entry.branch_id)?.name}
                    </span>
                  )}
                  {data.entry.department_id && departments.find((d) => d.id === data.entry.department_id) && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">
                      {departments.find((d) => d.id === data.entry.department_id)?.name}
                    </span>
                  )}
                </div>
              )}

              {showAssignCenter && (
                <div className="mt-3 rounded-xl border border-gray-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-600">Assign Cost / Revenue Center</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-gray-500">Branch</label>
                      <select
                        value={assignBranchId}
                        onChange={(e) => setAssignBranchId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">None</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-medium text-gray-500">Department</label>
                      <select
                        value={assignDeptId}
                        onChange={(e) => setAssignDeptId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                      >
                        <option value="">None</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}{d.cost_centre ? ` [${d.cost_centre}]` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => { setShowAssignCenter(false); setAssignBranchId(''); setAssignDeptId(''); setError(null); }}
                      disabled={assignCenterMutation.isPending}
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => assignCenterMutation.mutate()}
                      disabled={assignCenterMutation.isPending || (!assignBranchId && !assignDeptId)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {assignCenterMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Save
                    </button>
                  </div>
                </div>
              )}

              {/* View-only notice: no edit action is offered for posted entries.
                  Per product decision, editing a posted entry is never exposed —
                  only viewing and, where permitted, reversing. */}
              {data.entry.status === 'posted' && (
                <p className="mt-3 text-xs text-gray-400">
                  Posted entries are permanent and cannot be edited. To correct a mistake, reverse this entry instead.
                </p>
              )}

              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2">
                  <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              {canActuallyReverse && !showReverseForm && (
                <button
                  onClick={() => setShowReverseForm(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                >
                  <RotateCcw className="h-4 w-4" /> Reverse Entry
                </button>
              )}

              {canActuallyReverse && showReverseForm && (
                <div className="mt-4 rounded-xl border border-gray-200 p-3">
                  <label className="mb-1.5 block text-xs font-semibold text-gray-600">
                    Reason for reversal (required)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Duplicate entry, incorrect account, wrong amount…"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => { setShowReverseForm(false); setReason(''); setError(null); }}
                      disabled={submitting}
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmReverse}
                      disabled={submitting || !reason.trim()}
                      className="rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {submitting ? 'Reversing…' : 'Confirm Reversal'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}