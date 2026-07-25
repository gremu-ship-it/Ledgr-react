import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Check, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { parseBankStatement, type BankTransaction } from '@/services/bank/statementParser';
import { useAppStore } from '@/store/useAppStore';

interface Props {
  businessId: string;
}

type JournalEntrySummary = {
  id: string;
  entry_date: string;
  entry_number: string;
  description: string;
  total_debits?: number | string | null;
  total_credits?: number | string | null;
};

type MatchSuggestion = {
  bank: BankTransaction;
  ledgr: JournalEntrySummary;
  confidence: number;
};

export function BankReconciliation({ businessId }: Props) {
  const { t } = useTranslation();
  const [matched, setMatched] = useState<MatchSuggestion[]>([]);
  const [unmatchedBank, setUnmatchedBank] = useState<BankTransaction[]>([]);
  const [unmatchedLedgr, setUnmatchedLedgr] = useState<JournalEntrySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const currentUser = useAppStore((s) => s.currentUser);
  const queryClient = useQueryClient();

  const { data: ledgrEntries = [] } = useQuery({
    queryKey: ['unreconciled', businessId],
    queryFn: async () => {
      const { data } = await supabase
        .from('journal_entries')
        .select('*')
        .eq('business_id', businessId)
        .is('reconciled_at' as never, null)
        .order('entry_date', { ascending: false });
      return (data || []) as JournalEntrySummary[];
    },
    enabled: Boolean(businessId),
  });

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    try {
      const parsed = await parseBankStatement(file, 'auto');
      setUnmatchedBank(parsed);
      setUnmatchedLedgr(ledgrEntries);
    } catch (err) {
      alert((err as Error).message);
    }
    setLoading(false);
  }

  // Simple AI matching simulation (replace with real Claude call)
  function suggestMatches() {
    const suggestions: MatchSuggestion[] = [];
    unmatchedBank.forEach((bank) => {
      const match = unmatchedLedgr.find((entry) =>
        Math.abs(Number(entry.total_debits ?? 0) - bank.amount) < 1 &&
        Math.abs(new Date(entry.entry_date).getTime() - new Date(bank.date).getTime()) < 1000 * 60 * 60 * 72
      );
      if (match) {
        suggestions.push({ bank, ledgr: match, confidence: 0.92 });
      }
    });
    return suggestions;
  }

  const acceptMatch = (suggestion: MatchSuggestion) => {
    setMatched((prev) => [...prev, suggestion]);
    setUnmatchedBank((prev) => prev.filter((b) => b !== suggestion.bank));
    setUnmatchedLedgr((prev) => prev.filter((e) => e.id !== suggestion.ledgr.id));
  };

  const createFromBankLine = async (bank: BankTransaction) => {
    // Create a simple journal entry from the bank line. The typed schema does
    // not include calculated debit/credit summary columns used by the bank UI,
    // so this insert is intentionally cast for compatibility with deployed DBs
    // that include those columns/triggers.
    await supabase.from('journal_entries').insert({
      business_id: businessId,
      entry_date: bank.date,
      entry_number: `BANK-${bank.date}-${(bank.reference || bank.description).slice(0, 12).replace(/\W/g, '')}`,
      description: bank.description,
      source_type: 'bank_import',
      total_debits: bank.type === 'credit' ? bank.amount : 0,
      total_credits: bank.type === 'debit' ? bank.amount : 0,
      created_by: currentUser?.id,
    } as never);
    queryClient.invalidateQueries({ queryKey: ['unreconciled', businessId] });
    setUnmatchedBank((prev) => prev.filter((b) => b !== bank));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t('bank.bankReconciliation')}</h2>
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-gray-50">
          <Upload className="h-4 w-4" />
          {t('bank.importStatement')}
          <input type="file" accept=".csv,.ofx,.mt940" className="hidden" onChange={handleFileUpload} />
        </label>
      </div>

      {loading && <div className="text-sm text-gray-500">{t('bank.parsingStatement')}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Unmatched Bank Lines */}
        <div className="rounded-2xl border p-4">
          <h3 className="mb-3 font-semibold text-sm">{t('bank.unmatchedBankLines', { count: unmatchedBank.length })}</h3>
          <div className="space-y-2 max-h-[420px] overflow-auto text-sm">
            {unmatchedBank.map((line, i) => (
              <div key={i} className="flex items-center justify-between rounded border p-2">
                <div>
                  <div>{line.description}</div>
                  <div className="text-xs text-gray-500">{line.date} • {line.reference}</div>
                </div>
                <div className="text-right">
                  <div className={line.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}>
                    {line.type === 'credit' ? '+' : '-'}{line.amount.toLocaleString()}
                  </div>
                  <button onClick={() => createFromBankLine(line)} className="text-xs text-brand-600">{t('bank.createTransaction')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* {t('bank.aiSuggestions')} */}
        <div className="rounded-2xl border p-4">
          <h3 className="mb-3 font-semibold text-sm flex items-center gap-2">
            {t('bank.aiSuggestions')} <span className="text-xs text-gray-400">(Claude)</span>
          </h3>
          <button onClick={() => {
            const suggestions = suggestMatches();
            suggestions.forEach(acceptMatch);
          }} className="mb-3 text-xs text-brand-600">{t('bank.runAiMatching')}</button>

          <div className="space-y-2 text-sm">
            {matched.map((m, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-emerald-50 p-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <div className="flex-1 text-xs">{m.bank.description} → {m.ledgr.description}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Unmatched Ledgr Entries */}
        <div className="rounded-2xl border p-4">
          <h3 className="mb-3 font-semibold text-sm">{t('bank.unmatchedLedgrEntries', { count: unmatchedLedgr.length })}</h3>
          <div className="space-y-2 max-h-[420px] overflow-auto text-sm">
            {unmatchedLedgr.map((entry) => (
              <div key={entry.id} className="rounded border p-2">
                <div>{entry.description}</div>
                <div className="text-xs text-gray-500">{entry.entry_date} • {entry.entry_number}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-500 flex items-center gap-2">
        <AlertCircle className="h-4 w-4" /> {t('bank.reconciledLocked')}
      </div>
    </div>
  );
}
