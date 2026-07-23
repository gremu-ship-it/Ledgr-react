import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Plus, Trash2, AlertTriangle, Loader2 } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

interface LineDraft {
  id: string; // client-side key only
  accountId: string;
  description: string;
  debit: string; // kept as string while editing, parsed on submit
  credit: string;
}

function newLine(): LineDraft {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: '',
    description: '',
    debit: '',
    credit: '',
  };
}

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  businessId: string;
  onClose: () => void;
  onCreated?: () => void;
}

export function NewJournalEntryModal({ businessId, onClose, onCreated }: Props) {
  const currentUser = useAppStore((s) => s.currentUser);
  const queryClient = useQueryClient();

  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([newLine(), newLine()]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['posting_accounts', businessId],
    queryFn: () => repos.account.findPostingAccounts(businessId),
    enabled: Boolean(businessId),
  });

  const { data: periods = [] } = useQuery({
    queryKey: ['periods', businessId],
    queryFn: () => repos.period.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  // Same locked-period detection logic as useJournalEntries.ts — entry_date
  // falling within any closed period's [period_start, period_end] range.
  // The DB trigger (fn_check_period_not_locked) is the real enforcement;
  // this is an early warning so the user isn't surprised by a failed
  // submit after filling out the whole form.
  const isDateLocked = useMemo(() => {
    return periods
      .filter((p) => p.is_closed)
      .some((p) => entryDate >= p.period_start && entryDate <= p.period_end);
  }, [periods, entryDate]);

  const totalDebits = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0),
    [lines],
  );
  const totalCredits = useMemo(
    () => lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0),
    [lines],
  );
  const difference = totalDebits - totalCredits;
  const isBalanced = Math.abs(difference) < 0.005 && totalDebits > 0;

  const hasValidLines = lines.filter((l) => {
    const debit = parseFloat(l.debit) || 0;
    const credit = parseFloat(l.credit) || 0;
    return l.accountId && (debit > 0 || credit > 0);
  }).length >= 2;

  const canSubmit = isBalanced && hasValidLines && description.trim().length > 0 && !isDateLocked;

  function updateLine(id: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(id: string) {
    setLines((prev) => (prev.length > 2 ? prev.filter((l) => l.id !== id) : prev));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!currentUser) throw new Error('You must be signed in to post a journal entry.');

      const entryLines = lines
        .filter((l) => {
          const debit = parseFloat(l.debit) || 0;
          const credit = parseFloat(l.credit) || 0;
          return l.accountId && (debit > 0 || credit > 0);
        })
        .map((l, i) => {
          const debit = parseFloat(l.debit) || 0;
          const credit = parseFloat(l.credit) || 0;
          const isDebit = debit > 0;
          const amount = isDebit ? debit : credit;
          return {
            line_number: i + 1,
            account_id: l.accountId,
            description: l.description || description,
            is_debit: isDebit,
            amount,
            amount_base: amount, // MWK-only manual entries — no FX conversion needed
            currency: 'MWK',
            exchange_rate: 1,
            tax_code: 'none' as const,
            tax_amount: 0,
            reconciled: false,
          };
        });

      const entryNumber = `JNL-MAN-${Date.now()}`;

      const { entry } = await repos.journal.createBalancedEntry(
        {
          business_id: businessId,
          entry_number: entryNumber,
          entry_date: entryDate,
          description: description.trim(),
          reference: reference.trim() || null,
          source_type: null,
          source_id: null,
          currency: 'MWK',
          exchange_rate: 1,
          status: 'draft',
        },
        entryLines,
      );

      await repos.journal.post(entry.id, currentUser.id);
      return entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journal'] });
      onCreated?.();
      onClose();
    },
    onError: (err: unknown) => {
      setSubmitError(err instanceof Error ? err.message : 'Failed to post journal entry.');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">New Journal Entry</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-600">Date</label>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-600">Reference (optional)</label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. Loan agreement #, invoice ref"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Loan drawdown from NBS Bank"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {isDateLocked && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                This date falls within a closed accounting period. Posting will be rejected — choose a date
                in an open period, or unlock the period first if this is intentional.
              </span>
            </div>
          )}

          {/* Lines */}
          <div className="rounded-xl border border-gray-200">
            <div className="grid grid-cols-12 gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-xs font-medium uppercase tracking-wide text-gray-500">
              <div className="col-span-5">Account</div>
              <div className="col-span-3">Line description</div>
              <div className="col-span-2 text-right">Debit</div>
              <div className="col-span-2 text-right">Credit</div>
            </div>
            {lines.map((line) => (
              <div key={line.id} className="grid grid-cols-12 items-center gap-2 border-b border-gray-50 px-3 py-2 last:border-b-0">
                <div className="col-span-5">
                  <select
                    value={line.accountId}
                    onChange={(e) => updateLine(line.id, { accountId: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="">Select account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <input
                    type="text"
                    value={line.description}
                    onChange={(e) => updateLine(line.id, { description: e.target.value })}
                    placeholder="Optional"
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div className="col-span-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={line.debit}
                    onChange={(e) => updateLine(line.id, { debit: e.target.value, credit: e.target.value ? '' : line.credit })}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div className="col-span-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    value={line.credit}
                    onChange={(e) => updateLine(line.id, { credit: e.target.value, debit: e.target.value ? '' : line.debit })}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button
                    onClick={() => removeLine(line.id)}
                    disabled={lines.length <= 2}
                    className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
            <div className="px-3 py-2">
              <button
                onClick={addLine}
                className="flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                <Plus className="h-3.5 w-3.5" /> Add line
              </button>
            </div>
          </div>

          {/* Balance summary */}
          <div className={`flex items-center justify-between rounded-lg px-4 py-3 text-sm ${isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-600'}`}>
            <span>Debits: {formatMwk(totalDebits)} · Credits: {formatMwk(totalCredits)}</span>
            <span className="font-semibold">
              {isBalanced ? '✓ Balanced' : `Difference: ${formatMwk(Math.abs(difference))}`}
            </span>
          </div>

          {submitError && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{submitError}</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => { setSubmitError(null); mutation.mutate(); }}
            disabled={!canSubmit || mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Post Entry
          </button>
        </div>
      </div>
    </div>
  );
}