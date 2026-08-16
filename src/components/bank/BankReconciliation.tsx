import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Sparkles, Upload, X, Link2, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { supabase } from '@/lib/supabase';
import { parseBankStatement, type BankTransaction } from '@/services/bank/statementParser';
import { useAppStore } from '@/store/useAppStore';
import { pushBankReconciliationComplete, pushBankStatementImported } from '@/lib/notifications';
import { announce } from '@/lib/a11y';

type Account = { id: string; code: string; name: string; is_bank_account: boolean };
type Entry = { id: string; entry_date: string; entry_number: string; description: string; reference: string | null; amount: number; journalLineId?: string };
type Pair = { bank: BankTransaction; entry: Entry; confidence?: number; confirmed: boolean; journalLineId?: string };
type ScoredEntry = { entry: Entry; confidence: number };
type BankKey = string;

const mwk = new Intl.NumberFormat('en-MW', { style: 'currency', currency: 'MWK', maximumFractionDigits: 2 });
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
const similarity = (a: string, b: string) => {
  const x = norm(a), y = norm(b);
  return x.length ? x.filter(v => y.includes(v)).length / x.length : 0;
};
const bankKey = (b: BankTransaction, i: number): BankKey => `${b.date}-${b.amount}-${b.description}-${i}`;
const confidenceLabel = (c: number) => `${Math.round(c * 100)}% confidence`;

function scoreEntry(bank: BankTransaction, entry: Entry): number {
  const days = Math.abs(new Date(entry.entry_date).getTime() - new Date(bank.date).getTime()) / 86400000;
  const amountScore = Math.abs(entry.amount - bank.amount) < 0.01 ? 0.55 : 0;
  const dateScore = days <= 3 ? 0.2 * (1 - days / 4) : 0;
  const textScore = 0.2 * similarity(bank.description, entry.description);
  const refScore =
    bank.reference && entry.reference && bank.reference.toLowerCase() === entry.reference.toLowerCase() ? 0.15 : 0;
  return amountScore + dateScore + textScore + refScore;
}

type RawEntry = {
  id: string;
  entry_date: string;
  entry_number: string;
  description: string;
  reference: string | null;
  journal_lines: Array<{
    id: string;
    account_id: string;
    amount: number | null;
    is_debit: boolean | null;
    reconciled: boolean | null;
  }>;
};

export function BankReconciliation({ businessId }: { businessId: string }) {
  const user = useAppStore(s => s.currentUser);
  const qc = useQueryClient();
  const [lines, setLines] = useState<BankTransaction[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [bankAccount, setBankAccount] = useState('');
  const [contraAccount, setContraAccount] = useState('');
  const [opening, setOpening] = useState<number | undefined>();
  const [closing, setClosing] = useState<number | undefined>();
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragged, setDragged] = useState<BankTransaction | null>(null);
  const [pickerOpenFor, setPickerOpenFor] = useState<BankKey | null>(null);
  const [selectedBankKeys, setSelectedBankKeys] = useState<Set<BankKey>>(new Set());

  const { data: accounts = [] } = useQuery({
    queryKey: ['bank-accounts', businessId],
    enabled: !!businessId,
    queryFn: async () =>
      (await supabase
        .from('accounts')
        .select('id,code,name,is_bank_account')
        .eq('business_id', businessId)
        .eq('is_active', true)).data as Account[] || [],
  });
  const { data: rawEntries = [] } = useQuery({
    queryKey: ['reconciliation-entries', businessId],
    enabled: !!businessId,
    queryFn: async () =>
      (await supabase
        .from('journal_entries')
        .select('id,entry_date,entry_number,description,reference,journal_lines(id,account_id,amount,is_debit,reconciled)')
        .eq('business_id', businessId)
        .order('entry_date', { ascending: false })
        .limit(250)).data || [],
  });

  // Only consider journal_lines on the selected bank account for the candidate pool.
  // Store the specific journal_line.id so we can link it later.
  const ledger = useMemo(
    () => {
      if (!bankAccount) return [] as Entry[];
      return (rawEntries as unknown as RawEntry[])
        .map(e => {
          const bankLeg = (e.journal_lines || []).find(
            l => l.account_id === bankAccount && !l.reconciled
          );
          if (!bankLeg) return null;
          return {
            id: e.id,
            entry_date: e.entry_date,
            entry_number: e.entry_number,
            description: e.description,
            reference: e.reference,
            amount: Number(bankLeg.amount || 0),
            journalLineId: bankLeg.id,
          } as Entry;
        })
        .filter((e): e is Entry => !!e && e.amount > 0);
    },
    [rawEntries, bankAccount],
  );
  const unmatchedEntries = entries.length ? entries : ledger;

  const suggested = useMemo(
    () =>
      lines.map(bank => {
        const candidates: ScoredEntry[] = unmatchedEntries.map(entry => ({
          entry,
          confidence: scoreEntry(bank, entry),
        }));
        candidates.sort((a, b) => b.confidence - a.confidence);
        return candidates[0]?.confidence >= 0.55 ? { bank, ...candidates[0] } : null;
      }).filter(Boolean) as Array<{ bank: BankTransaction; entry: Entry; confidence: number }>,
    [lines, unmatchedEntries],
  );

  async function upload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseBankStatement(file);
      setLines(parsed.transactions);
      setEntries(ledger);
      setOpening(parsed.openingBalance);
      setClosing(parsed.closingBalance);
      setSource(parsed.source);
      setPairs([]);
      const accountName = accounts.find(a => a.id === bankAccount)?.name || 'Bank account';
      pushBankStatementImported(accountName, parsed.transactions.length, businessId);
      announce(`Imported ${parsed.transactions.length} bank lines from ${file.name}.`);
    } catch (e) {
      const message = (e as Error).message;
      alert(message);
      announce(`Import failed: ${message}`, 'assertive');
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  }

  function accept(bank: BankTransaction, entry: Entry, confidence?: number) {
    setPairs(p => [...p, { bank, entry, confidence, confirmed: true, journalLineId: entry.journalLineId }]);
    setLines(x => x.filter(v => v !== bank));
    setEntries(x => x.filter(v => v.id !== entry.id));
    setPickerOpenFor(null);
    announce(
      `Matched ${bank.description} on ${bank.date} to ledger entry ${entry.entry_number} for ${mwk.format(bank.amount)}.`,
    );
  }

  function unmatch(index: number) {
    const removed = pairs[index];
    if (!removed) return;
    setPairs(p => p.filter((_, i) => i !== index));
    setLines(x => [...x, removed.bank]);
    setEntries(x => [...x, removed.entry]);
    announce(`Removed match: ${removed.bank.description} unlinked from ${removed.entry.entry_number}.`);
  }

  // Checkbox helpers
  const toggleBankSelection = (key: BankKey) => {
    setSelectedBankKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selectAllBankLines = () => {
    const allKeys = lines.map((b, i) => bankKey(b, i));
    setSelectedBankKeys(new Set(allKeys));
  };

  const clearBankSelection = () => setSelectedBankKeys(new Set());

  const autoReconcileSelected = () => {
    if (selectedBankKeys.size === 0 || unmatchedEntries.length === 0) return;

    const toReconcile: BankTransaction[] = [];
    lines.forEach((b, i) => {
      if (selectedBankKeys.has(bankKey(b, i))) toReconcile.push(b);
    });

    toReconcile.forEach(bank => {
      const best = unmatchedEntries
        .map(entry => ({ entry, confidence: scoreEntry(bank, entry) }))
        .sort((a, b) => b.confidence - a.confidence)[0];
      if (best && best.confidence >= 0.55) {
        accept(bank, best.entry, best.confidence);
      }
    });
    clearBankSelection();
    announce(`Auto-reconciled ${toReconcile.length} selected bank lines.`);
  };

  async function runAiMatching() {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('suggest-bank-matches', {
        body: { bankLines: lines, ledgerEntries: unmatchedEntries },
      });
      if (error) throw error;
      const matches = data?.matches || [];
      if (!matches.length) {
        announce('Claude found no high-confidence matches.', 'assertive');
        alert('Claude found no high-confidence matches.');
        return;
      }
      matches.forEach((m: { bankIndex: number; entryId: string; confidence: number }) => {
        const bank = lines[m.bankIndex];
        const entry = unmatchedEntries.find(e => e.id === m.entryId);
        if (bank && entry) accept(bank, entry, m.confidence);
      });
      announce(`Accepted ${matches.length} AI-suggested matches.`);
    } catch {
      suggested.forEach(s => accept(s.bank, s.entry, s.confidence));
      const msg = 'Claude is unavailable; amount/date/payee/reference matching was used instead.';
      alert(msg);
      announce(msg, 'assertive');
    } finally {
      setBusy(false);
    }
  }

  async function createTransaction(bank: BankTransaction) {
    if (!bankAccount || !contraAccount) {
      const msg = 'Select the bank/mobile-money account and a balancing account first.';
      alert(msg);
      announce(msg, 'assertive');
      return;
    }
    setBusy(true);
    try {
      const random = crypto.randomUUID().replace(/-/g, '').slice(0, 5).toUpperCase();
      const number = `BANK-${bank.date.replaceAll('-', '')}-${random}`;
      const { data: entry, error } = await supabase
        .from('journal_entries')
        .insert({
          business_id: businessId,
          entry_date: bank.date,
          entry_number: number,
          description: bank.description,
          reference: bank.reference || null,
          source_type: 'bank_import',
          created_by: user?.id,
          currency: 'MWK' as const,
          exchange_rate: 1,
          status: 'draft' as const,
        })
        .select('id')
        .single();
      if (error || !entry) throw error || new Error('Unable to create journal entry');
      const debitBank = bank.type === 'credit';
      const { error: lineError } = await supabase.from('journal_lines').insert([
        {
          business_id: businessId,
          journal_entry_id: entry.id,
          account_id: bankAccount,
          line_number: 1,
          amount: bank.amount,
          amount_base: bank.amount,
          is_debit: debitBank,
        },
        {
          business_id: businessId,
          journal_entry_id: entry.id,
          account_id: contraAccount,
          line_number: 2,
          amount: bank.amount,
          amount_base: bank.amount,
          is_debit: !debitBank,
        },
      ] as never);
      if (lineError) throw lineError;
      setLines(x => x.filter(v => v !== bank));
      qc.invalidateQueries({ queryKey: ['reconciliation-entries', businessId] });
      announce(`Created journal entry ${number} for ${bank.description}, ${mwk.format(bank.amount)}.`);
    } catch (e) {
      const message = (e as Error).message;
      alert(message);
      announce(`Failed to create transaction: ${message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (!bankAccount || (!lines.length && !pairs.length)) {
      const msg = 'Choose an account and import a statement first.';
      alert(msg);
      announce(msg, 'assertive');
      return;
    }
    if (lines.length > 0) {
      const msg = 'Please match all bank statement lines before saving and locking.';
      alert(msg);
      announce(msg, 'assertive');
      return;
    }
    if (!reconciled) {
      const msg = `Reconciliation difference must be zero (current difference: ${difference.toFixed(2)}).`;
      alert(msg);
      announce(msg, 'assertive');
      return;
    }
    setBusy(true);
    try {
      const date = pairs.at(-1)?.bank.date || new Date().toISOString().slice(0, 10);
      const { data: statement, error } = await supabase
        .from('bank_statements')
        .insert({
          business_id: businessId,
          account_id: bankAccount,
          statement_date: date,
          opening_balance: opening || 0,
          closing_balance:
            closing ??
            (opening || 0) +
              pairs.reduce((n, p) => n + (p.bank.type === 'credit' ? p.bank.amount : -p.bank.amount), 0),
          source,
          uploaded_by: user?.id,
        } as never)
        .select('id')
        .single();
      if (error || !statement) throw error || new Error('Unable to save reconciliation');

      // Persist matched pairs + link to journal_line (issue #51)
      const matchedJournalLineIds: string[] = [];
      if (pairs.length) {
        const { error: linesError } = await supabase.from('bank_statement_lines').insert(
          pairs.map(p => {
            if (p.journalLineId) matchedJournalLineIds.push(p.journalLineId);
            return {
              business_id: businessId,
              statement_id: statement.id,
              transaction_date: p.bank.date,
              description: p.bank.description,
              reference: p.bank.reference || null,
              debit_amount: p.bank.type === 'debit' ? p.bank.amount : 0,
              credit_amount: p.bank.type === 'credit' ? p.bank.amount : 0,
              is_reconciled: true,
              journal_line_id: p.journalLineId || null,
            };
          }) as never,
        );
        if (linesError) throw linesError;
      }

      // Mark the matched journal_lines as reconciled (only the bank leg)
      if (matchedJournalLineIds.length > 0) {
        const { error: journalUpdateError } = await supabase
          .from('journal_lines')
          .update({
            reconciled: true,
            reconciled_at: new Date().toISOString(),
          } as never)
          .in('id', matchedJournalLineIds)
          .eq('business_id', businessId);
        if (journalUpdateError) throw journalUpdateError;
      }

      const { error: lockError } = await supabase
        .from('bank_statements')
        .update({
          is_locked: true,
          reconciled_at: new Date().toISOString(),
          reconciled_by: user?.id,
          locked_at: new Date().toISOString(),
        } as never)
        .eq('id', statement.id);
      if (lockError) throw lockError;

      const accountName = accounts.find(a => a.id === bankAccount)?.name || 'Bank account';
      pushBankReconciliationComplete(accountName, pairs.length, businessId);
      announce(`Reconciliation saved. ${pairs.length} matched transactions locked.`);
      alert('Reconciliation saved and its matched bank lines are locked.');
    } catch (e) {
      const message = (e as Error).message;
      alert(message);
      announce(`Reconciliation failed: ${message}`, 'assertive');
    } finally {
      setBusy(false);
    }
  }

  const movement = pairs.reduce((n, p) => n + (p.bank.type === 'credit' ? p.bank.amount : -p.bank.amount), 0);
  const calculated = (opening || 0) + movement;
  const difference = (closing ?? calculated) - calculated;
  const reconciled = Math.abs(difference) < 0.01;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Bank reconciliation</h2>
          <p className="text-sm text-gray-700">
            NBS, FDH, Standard Bank, National Bank, Airtel Money and TNM Mpamba
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
          <Upload size={16} aria-hidden="true" />
          Import CSV / OFX / MT940
          <input
            className="sr-only"
            type="file"
            accept=".csv,.ofx,.mt940,.sta"
            onChange={upload}
            aria-label="Import bank statement (CSV, OFX, or MT940)"
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label htmlFor="bank-account" className="mb-1 block text-xs font-medium text-gray-700">
            Bank or mobile-money account
          </label>
          <select
            id="bank-account"
            value={bankAccount}
            onChange={e => setBankAccount(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="">Select bank or mobile-money account</option>
            {accounts.filter(a => a.is_bank_account).map(a => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="contra-account" className="mb-1 block text-xs font-medium text-gray-700">
            Balancing account for new transactions
          </label>
          <select
            id="contra-account"
            value={contraAccount}
            onChange={e => setContraAccount(e.target.value)}
            className="w-full rounded border border-gray-300 p-2 focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          >
            <option value="">Balancing account for new transactions</option>
            {accounts.map(a => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {busy && (
        <p className="flex items-center gap-2 text-sm text-gray-700" role="status" aria-live="polite">
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" aria-hidden="true" />
          Working…
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border p-3" aria-labelledby="bank-lines-heading">
          <div className="mb-3 flex items-center justify-between">
            <h3 id="bank-lines-heading" className="font-semibold">
              Unmatched bank lines ({lines.length})
            </h3>
            {lines.length > 0 && (
              <div className="flex items-center gap-2 text-xs">
                <button onClick={selectAllBankLines} className="text-brand-600 hover:underline">Select all</button>
                <button onClick={clearBankSelection} className="text-gray-500 hover:underline">Clear</button>
                <button
                  onClick={autoReconcileSelected}
                  disabled={selectedBankKeys.size === 0 || unmatchedEntries.length === 0}
                  className="rounded bg-emerald-600 px-2.5 py-0.5 font-medium text-white disabled:opacity-50"
                >
                  Auto-reconcile selected ({selectedBankKeys.size})
                </button>
              </div>
            )}
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-gray-500">No unmatched bank lines. Import a statement above.</p>
          ) : (
            <p className="mb-3 text-xs text-gray-600">
              Drag a line onto an entry, or use the <strong>Match</strong> button on each line for keyboard access.
            </p>
          )}
          <ul className="space-y-2" role="list">
            {lines.map((b, i) => {
              const key = bankKey(b, i);
              return (
                <li key={key} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={selectedBankKeys.has(key)}
                    onChange={() => toggleBankSelection(key)}
                    className="mt-3 accent-emerald-600"
                    aria-label={`Select ${b.description}`}
                  />
                  <div className="flex-1">
                    <BankLineCard
                      bank={b}
                      isDragging={dragged === b}
                      onDragStart={() => setDragged(b)}
                      onDragEnd={() => setDragged(null)}
                      isPickerOpen={pickerOpenFor === key}
                      onOpenPicker={() => setPickerOpenFor(key)}
                      onClosePicker={() => setPickerOpenFor(null)}
                      unmatchedEntries={unmatchedEntries}
                      onPickEntry={entry => accept(b, entry, scoreEntry(b, entry))}
                      onCreateTransaction={() => createTransaction(b)}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <section
          className="rounded-xl border border-emerald-200 bg-emerald-50/30 p-3"
          aria-labelledby="matched-pairs-heading"
          onDragOver={e => e.preventDefault()}
          onDrop={() => {
            if (dragged && unmatchedEntries[0]) accept(dragged, unmatchedEntries[0]);
          }}
        >
          <h3 id="matched-pairs-heading" className="mb-3 flex items-center gap-2 font-semibold">
            <Sparkles size={16} aria-hidden="true" />
            Matched pairs
          </h3>
          <button
            type="button"
            onClick={runAiMatching}
            disabled={busy || lines.length === 0}
            className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:text-brand-800 hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:no-underline"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            Accept AI suggestions ({suggested.length})
          </button>
          <ul className="space-y-2" role="list">
            {pairs.length === 0 ? (
              <li className="text-xs text-gray-600">
                No matched pairs yet. Drag a bank line here to manually match the next ledger entry, or use the
                Match button on a bank line.
              </li>
            ) : (
              pairs.map((p, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded border border-emerald-200 bg-white p-2 text-sm"
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div>
                      <b>{p.bank.description}</b> → {p.entry.description}
                    </div>
                    {p.confidence !== undefined && (
                      <div className="text-xs text-gray-600" aria-label={`Match confidence: ${confidenceLabel(p.confidence)}`}>
                        {confidenceLabel(p.confidence)}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => unmatch(i)}
                    aria-label={`Unmatch ${p.bank.description} from ${p.entry.entry_number}`}
                    className="shrink-0 rounded p-1 text-gray-500 hover:bg-red-50 hover:text-red-700"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section
          className="rounded-xl border p-3"
          aria-labelledby="ledger-entries-heading"
        >
          <h3 id="ledger-entries-heading" className="mb-3 font-semibold">
            Unmatched Ledgr entries ({unmatchedEntries.length})
          </h3>
          <ul className="space-y-2" role="list">
            {unmatchedEntries.map(e => (
              <li
                key={e.id}
                onDragOver={ev => ev.preventDefault()}
                onDrop={() => {
                  if (dragged) accept(dragged, e);
                }}
                className="rounded border border-gray-200 bg-white p-3 text-sm hover:border-brand-300"
              >
                <b className="block truncate">{e.description}</b>
                <div className="text-xs text-gray-600">
                  {e.entry_date} · {e.entry_number}
                </div>
                <div className="mt-1 font-medium text-gray-900">{mwk.format(e.amount)}</div>
                {dragged && (
                  <button
                    type="button"
                    onClick={() => accept(dragged, e)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 hover:underline"
                  >
                    <Link2 className="h-3 w-3" aria-hidden="true" />
                    Match with {dragged.description.slice(0, 30)}
                    {dragged.description.length > 30 ? '…' : ''}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border p-4" aria-labelledby="report-heading">
        <h3 id="report-heading" className="font-semibold">
          Reconciliation report
        </h3>
        <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-gray-600">Opening balance</dt>
            <dd className="font-medium text-gray-900">{mwk.format(opening || 0)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600">Matched movement</dt>
            <dd className="font-medium text-gray-900">{mwk.format(movement)}</dd>
          </div>
          <div>
            <dt className="text-xs text-gray-600">Closing balance</dt>
            <dd className="font-medium text-gray-900">{mwk.format(closing ?? calculated)}</dd>
          </div>
        </dl>
        <p
          className={clsx(
            'mt-2 flex items-center gap-1.5 text-sm font-semibold',
            reconciled ? 'text-emerald-800' : 'text-red-700',
          )}
          role="status"
          aria-live="polite"
        >
          {reconciled ? (
            <Check className="h-4 w-4" aria-hidden="true" />
          ) : (
            <X className="h-4 w-4" aria-hidden="true" />
          )}
          <span>
            Difference: {mwk.format(difference)}
            {reconciled ? ' (reconciled)' : ' (does not balance — review matches)'}
          </span>
        </p>
        {pairs.length > 0 && (
          <details className="mt-2 text-xs text-gray-700">
            <summary className="cursor-pointer font-medium">
              Reconciled transactions ({pairs.length})
            </summary>
            <ul className="mt-2 space-y-0.5">
              {pairs.map((p, i) => (
                <li key={i}>
                  {p.bank.date} · {p.bank.description} · {mwk.format(p.bank.amount)}
                </li>
              ))}
            </ul>
          </details>
        )}
        <div className="mt-4">
          <button
            type="button"
            onClick={finalize}
            disabled={busy || !bankAccount || (!lines.length && !pairs.length) || lines.length > 0 || !reconciled}
            className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Lock className="h-4 w-4" aria-hidden="true" />
            Save & lock period
          </button>
        </div>
      </section>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────
   BankLineCard — one unmatched bank line, with:
   • drag affordance (mouse, preserved as an enhancement)
   • a "Match" button that opens a keyboard-accessible picker dialog
     (combo-box) listing unmatched ledger entries, ranked by the same
     confidence score the AI uses
   • a "Create transaction" button (for lines with no matching entry)
   ────────────────────────────────────────────────────────────────────── */

function BankLineCard({
  bank,
  isDragging,
  onDragStart,
  onDragEnd,
  isPickerOpen,
  onOpenPicker,
  onClosePicker,
  unmatchedEntries,
  onPickEntry,
  onCreateTransaction,
}: {
  bank: BankTransaction;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  isPickerOpen: boolean;
  onOpenPicker: () => void;
  onClosePicker: () => void;
  unmatchedEntries: Entry[];
  onPickEntry: (entry: Entry) => void;
  onCreateTransaction: () => void;
}) {
  const pickerId = useId();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const scored = useMemo(() => {
    return unmatchedEntries
      .map(entry => ({ entry, confidence: scoreEntry(bank, entry) }))
      .filter(s => s.confidence > 0.05)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 20);
  }, [bank, unmatchedEntries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scored;
    return scored.filter(
      s =>
        s.entry.description.toLowerCase().includes(q) ||
        s.entry.entry_number.toLowerCase().includes(q) ||
        (s.entry.reference ?? '').toLowerCase().includes(q),
    );
  }, [scored, query]);

  const safeActiveIndex = filtered.length > 0 ? Math.min(activeIndex, filtered.length - 1) : 0;

  // Callback ref for the search input — runs once on mount after paint,
  // focusing it without needing a setState-in-effect.
  const setInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      requestAnimationFrame(() => el.focus());
    }
  }, []);

  const handleTogglePicker = useCallback(() => {
    if (isPickerOpen) {
      onClosePicker();
      requestAnimationFrame(() => triggerRef.current?.focus());
    } else {
      setQuery('');
      setActiveIndex(0);
      onOpenPicker();
    }
  }, [isPickerOpen, onClosePicker, onOpenPicker]);

  // Close on outside click.
  useEffect(() => {
    if (!isPickerOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClosePicker();
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isPickerOpen, onClosePicker]);

  return (
    <div
      ref={cardRef}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={clsx(
        'rounded-lg border bg-white p-3 shadow-sm transition-colors',
        isDragging && 'opacity-50 ring-2 ring-brand-500',
        isPickerOpen && 'ring-2 ring-brand-500',
      )}
    >
      <div>
        <b className="block break-words">{bank.description}</b>
        <div className="text-xs text-gray-600">
          {bank.date} · {bank.reference || 'No reference'}
        </div>
        <div
          className={clsx(
            'mt-1 font-semibold',
            bank.type === 'credit' ? 'text-emerald-800' : 'text-red-800',
          )}
        >
          {bank.type === 'credit' ? '+' : '−'}
          {mwk.format(bank.amount)}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <button
          ref={triggerRef}
          type="button"
          onClick={handleTogglePicker}
          aria-expanded={isPickerOpen}
          aria-controls={pickerId}
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1 rounded border border-brand-200 bg-white px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
        >
          <Link2 className="h-3 w-3" aria-hidden="true" />
          {isPickerOpen ? 'Cancel' : 'Match'}
          <ChevronDown
            className={clsx('h-3 w-3 transition-transform', isPickerOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          onClick={onCreateTransaction}
          className="rounded px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
        >
          Create transaction
        </button>
      </div>

      {isPickerOpen && (
        <div
          ref={pickerRef}
          id={pickerId}
          role="dialog"
          aria-label={`Match ${bank.description} to a ledger entry`}
          className="mt-2 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
        >
          <label htmlFor={`${pickerId}-search`} className="mb-1 block text-xs font-medium text-gray-700">
            Search unmatched entries
          </label>
          <input
            id={`${pickerId}-search`}
            ref={setInputRef}
            type="search"
            value={query}
            onChange={e => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex(i => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex(i => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[activeIndex]) {
                  onPickEntry(filtered[activeIndex].entry);
                }
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClosePicker();
              }
            }}
            placeholder="Description, entry #, or reference"
            className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600"
          />
          {filtered.length === 0 ? (
            <p className="mt-2 text-xs text-gray-600">
              No matching entries. Try a different search, or use{' '}
              <strong>Create transaction</strong> above to add a new one.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[10px] uppercase tracking-wider text-gray-500">
                {filtered.length} suggestion{filtered.length === 1 ? '' : 's'} · use ↑ ↓ and Enter
              </p>
              <ul
                className="mt-1 max-h-64 overflow-y-auto"
                role="listbox"
                aria-label="Suggested ledger entries"
                aria-activedescendant={filtered[safeActiveIndex] ? `${pickerId}-opt-${filtered[safeActiveIndex].entry.id}` : undefined}
              >
                {filtered.map((s, idx) => (
                  <li
                    key={s.entry.id}
                    role="option"
                    id={`${pickerId}-opt-${s.entry.id}`}
                    aria-selected={idx === safeActiveIndex}
                  >
                    <button
                      type="button"
                      onClick={() => onPickEntry(s.entry)}
                      onMouseEnter={() => setActiveIndex(idx)}
                      className={clsx(
                        'flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left text-sm',
                        idx === safeActiveIndex
                          ? 'bg-brand-50 text-brand-900'
                          : 'hover:bg-gray-50 text-gray-800',
                      )}
                    >
                      <span className="truncate font-medium">{s.entry.description}</span>
                      <span className="flex justify-between text-xs text-gray-600">
                        <span>
                          {s.entry.entry_date} · {s.entry.entry_number}
                        </span>
                        <span className="font-semibold text-gray-900">
                          {mwk.format(s.entry.amount)} · {confidenceLabel(s.confidence)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
