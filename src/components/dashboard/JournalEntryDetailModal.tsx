import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, RotateCcw, Lock, AlertCircle } from 'lucide-react';
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card shadow-xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">Journal Entry</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-muted hover:bg-surface hover:text-sub">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-6 animate-pulse rounded bg-surface" />
              ))}
            </div>
          ) : isError || !data ? (
            <p className="text-sm text-danger">Failed to load this entry.</p>
          ) : (
            <>
              <div className="mb-4 space-y-1">
                <p className="text-sm font-medium text-ink">{data.entry.description}</p>
                <p className="text-xs text-muted">
                  {data.entry.entry_number} · {new Date(data.entry.entry_date).toLocaleDateString('en-MW', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold capitalize text-sub">
                    {data.entry.status}
                  </span>
                  {period?.is_closed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
                      <Lock className="h-3 w-3" /> Locked period
                    </span>
                  )}
                  {data.entry.reversal_of && (
                    <span className="rounded-full bg-warning/12 px-2 py-0.5 text-[11px] font-semibold text-warning">
                      This is a reversal entry
                    </span>
                  )}
                  {data.entry.reversed_by && (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-muted">
                      Reversed
                    </span>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-xl border border-line">
                <table className="w-full text-sm">
                  <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2 text-left">Account</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.lines.map((line) => {
                      const acc = accountMap[line.account_id];
                      return (
                        <tr key={line.id}>
                          <td className="px-3 py-2 text-sub">
                            {acc ? `${acc.code} — ${acc.name}` : line.account_id}
                          </td>
                          <td className="px-3 py-2 text-right text-sub">
                            {line.is_debit ? formatMwk(Number(line.amount_base)) : ''}
                          </td>
                          <td className="px-3 py-2 text-right text-sub">
                            {!line.is_debit ? formatMwk(Number(line.amount_base)) : ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* View-only notice: no edit action is offered for posted entries.
                  Per product decision, editing a posted entry is never exposed —
                  only viewing and, where permitted, reversing. */}
              {data.entry.status === 'posted' && (
                <p className="mt-3 text-xs text-muted">
                  Posted entries are permanent and cannot be edited. To correct a mistake, reverse this entry instead.
                </p>
              )}

              {error && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-danger/20 bg-danger/10 px-3 py-2">
                  <AlertCircle className="h-4 w-4 text-danger shrink-0" />
                  <p className="text-sm text-danger">{error}</p>
                </div>
              )}

              {canActuallyReverse && !showReverseForm && (
                <button
                  onClick={() => setShowReverseForm(true)}
                  className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-sub transition-colors hover:bg-bg"
                >
                  <RotateCcw className="h-4 w-4" /> Reverse Entry
                </button>
              )}

              {canActuallyReverse && showReverseForm && (
                <div className="mt-4 rounded-xl border border-line p-3">
                  <label className="mb-1.5 block text-xs font-semibold text-sub">
                    Reason for reversal (required)
                  </label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Duplicate entry, incorrect account, wrong amount…"
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => { setShowReverseForm(false); setReason(''); setError(null); }}
                      disabled={submitting}
                      className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-bg disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleConfirmReverse}
                      disabled={submitting || !reason.trim()}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
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