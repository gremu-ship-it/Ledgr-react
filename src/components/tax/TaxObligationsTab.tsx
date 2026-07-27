import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Wallet } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import {
  useTaxObligations,
  useGenerateVatReturn,
  type TaxObligation,
} from '@/hooks/useTaxObligations';
import { TaxObligationCard } from './TaxObligationCard';
import { RecordTaxPaymentModal } from './RecordTaxPaymentModal';
import { TaxReturnDetailModal } from './TaxReturnDetailModal';
import { MarkFiledModal } from './MarkFiledModal';
import { formatCurrencyAmount } from '@/lib/currency';
import { todayIso } from '@/lib/taxDates';
import { getJurisdictionRules } from '@/lib/taxRules';
import { nextEntryNumber } from '@/services/journalService';

/** Previous calendar month as 'YYYY-MM' — the period a VAT return is normally filed for. */
function previousPeriod(): string {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return prev.toISOString().slice(0, 7);
}

export function TaxObligationsTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
  const business = currentBusiness?.business;
  const currency = business?.base_currency ?? 'MWK';

  const { obligations, summary, jurisdiction, isLoading } = useTaxObligations(businessId);
  const rules = getJurisdictionRules(jurisdiction);

  const [payingFor, setPayingFor] = useState<TaxObligation | null>(null);
  const [viewing, setViewing] = useState<TaxObligation | null>(null);
  const [filing, setFiling] = useState<TaxObligation | null>(null);
  const [period, setPeriod] = useState(previousPeriod());
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const generateVat = useGenerateVatReturn(businessId);

  const postJournal = useMutation({
    mutationFn: async (o: TaxObligation) => {
      if (!currentUser?.id) throw new Error('You must be signed in.');
      const entryNumber = await nextEntryNumber(businessId);
      // VAT clears its own control accounts, so no expense account is needed.
      // PAYE/TPR liabilities were already expensed by the payroll journal, so
      // they post against the same payable account rather than re-expensing.
      const expenseAccountId =
        o.taxReturn.tax_code === 'vat_standard' ? null : await resolveExpenseAccount(o);
      return repos.taxReturn.postToJournal(
        o.taxReturn.id, expenseAccountId, currentUser.id, entryNumber,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax_returns'] });
      queryClient.invalidateQueries({ queryKey: ['journal_entries'] });
      setBanner({ type: 'success', message: 'Liability posted to the journal.' });
    },
    onError: (err: Error) => setBanner({ type: 'error', message: err.message }),
  });

  /**
   * PAYE and TPR liabilities are already recognised as an expense by the
   * payroll journal entry, so there is no second expense to book here. The
   * tax return only needs its own payable recognised when it was created
   * outside payroll — which currently cannot happen, so we surface a clear
   * message instead of guessing an account.
   */
  async function resolveExpenseAccount(o: TaxObligation): Promise<string | null> {
    if (o.taxReturn.source_type === 'payroll_run') {
      throw new Error(
        `${o.label} for ${o.periodDisplay} was already posted to the journal by the payroll run that created it. ` +
        `No further posting is required.`,
      );
    }
    return null;
  }

  async function handleGenerateVat() {
    setBanner(null);
    try {
      await generateVat.mutateAsync(period);
      setBanner({ type: 'success', message: `VAT return generated for ${period}.` });
    } catch (err) {
      setBanner({ type: 'error', message: (err as Error).message });
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-gray-100" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {banner && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
          banner.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
        }`}>
          {banner.type === 'success'
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {banner.message}
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-gray-500">
            <Wallet className="h-4 w-4" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wide">Total owed</p>
          </div>
          <p className="mt-1.5 text-2xl font-semibold text-gray-900">
            {formatCurrencyAmount(summary.totalOwed, currency)}
          </p>
          {summary.totalCredit > 0 && (
            <p className="mt-0.5 text-xs text-brand-700">
              plus {formatCurrencyAmount(summary.totalCredit, currency)} recoverable
            </p>
          )}
        </div>

        <div className={`rounded-2xl border p-4 shadow-sm ${
          summary.overdueCount > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
        }`}>
          <div className={`flex items-center gap-2 ${summary.overdueCount > 0 ? 'text-red-600' : 'text-gray-500'}`}>
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            <p className="text-xs font-semibold uppercase tracking-wide">Overdue</p>
          </div>
          <p className={`mt-1.5 text-2xl font-semibold ${summary.overdueCount > 0 ? 'text-red-700' : 'text-gray-900'}`}>
            {summary.overdueCount}
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            {summary.criticalCount} due within 7 days
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Next deadline</p>
          {summary.nextDue ? (
            <>
              <p className="mt-1.5 text-lg font-semibold text-gray-900">
                {summary.nextDue.shortLabel} · {summary.nextDue.dueDateDisplay}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {summary.nextDue.daysRemaining === 0
                  ? 'Due today'
                  : `${summary.nextDue.daysRemaining} days remaining`}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-gray-500">Nothing scheduled</p>
          )}
        </div>
      </div>

      {/* Generate VAT return */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div>
          <label htmlFor="vat-period" className="mb-1 block text-sm font-medium text-gray-700">
            VAT period
          </label>
          <input
            id="vat-period"
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          onClick={handleGenerateVat}
          disabled={generateVat.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
        >
          {generateVat.isPending
            ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            : <Plus className="h-4 w-4" aria-hidden="true" />}
          Generate VAT return
        </button>
        <p className="text-xs text-gray-500">
          Closes the period and calculates output vs input tax. Runs automatically on the 1st of each month.
        </p>
      </div>

      {/* Obligations */}
      {obligations.length === 0 ? (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-3 rounded-2xl border border-gray-200 bg-white text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <CheckCircle2 className="h-7 w-7 text-brand-400" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">Nothing outstanding</h2>
          <p className="max-w-sm text-sm text-gray-500">
            No open {rules.authority} obligations. Returns appear here automatically when payroll is
            approved or a VAT period is closed.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {obligations.map((o) => (
            <TaxObligationCard
              key={o.taxReturn.id}
              obligation={o}
              currency={currency}
              onRecordPayment={setPayingFor}
              onMarkFiled={setFiling}
              onPostJournal={(x) => postJournal.mutate(x)}
              onViewReturn={setViewing}
            />
          ))}
        </div>
      )}

      {payingFor && (
        <RecordTaxPaymentModal
          obligation={payingFor}
          businessId={businessId}
          currency={currency}
          onClose={() => setPayingFor(null)}
        />
      )}
      {viewing && (
        <TaxReturnDetailModal
          obligation={viewing}
          jurisdiction={jurisdiction}
          currency={currency}
          businessName={business?.name ?? ''}
          tpin={business?.tpin}
          onClose={() => setViewing(null)}
        />
      )}
      {filing && (
        <MarkFiledModal obligation={filing} onClose={() => setFiling(null)} />
      )}
    </div>
  );
}
