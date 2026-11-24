import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle, CreditCard, X } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { formatMwkDetailed } from '@/lib/formatters';
import { useAppStore } from '@/store/useAppStore';
import { resolveTransactionRate } from '@/lib/currency';
import type { InsertDto, Row } from '@/dal/types/database';

/**
 * Record a payment against an expense bill.
 *
 * WHY THIS EXISTS
 * `repos.expense.recordPayment` — the atomic `record_expense_payment`
 * command — has been implemented and tested server-side for a while, but no
 * screen ever called it, so a bill could be created (DR Inventory /
 * CR Trade Creditors) and then never settled from inside the app. Every part
 * payment had to be a manual journal, which is both error-prone and puts the
 * DR Trade Creditors / CR Bank entry outside the supplier subledger.
 *
 * This modal is the missing call site. It mirrors the invoice payment dialog
 * deliberately — same fields, same idempotency-key-per-dialog pattern, same
 * bank-account picker — so paying a bill and paying an invoice feel identical.
 */

const PAYMENT_METHODS: { value: Row<'expense_payments'>['payment_method']; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'airtel_money', label: 'Airtel Money' },
  { value: 'tnm_mpamba', label: 'TNM Mpamba' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RecordBillPaymentModal({
  bill,
  businessId,
  onClose,
  onSuccess,
}: {
  bill: Row<'expenses'>;
  businessId: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);

  const outstanding = Math.max(
    0,
    Number(bill.total_amount) - Number(bill.amount_paid ?? 0),
  );
  const functionalCurrency = currentBusiness?.business?.base_currency || 'MWK';
  const billCurrency = bill.original_currency ?? bill.currency ?? functionalCurrency;

  const [form, setForm] = useState({
    payment_date: today(),
    amount: outstanding.toFixed(2),
    payment_method: 'bank_transfer' as Row<'expense_payments'>['payment_method'],
    reference: '',
    notes: '',
    exchange_rate: '',
  });
  const [bankAccountId, setBankAccountId] = useState('');
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // One idempotency key per dialog: a double-submit or a retry after a lost
  // response replays the committed payment instead of recording it twice
  // (record_expense_payment de-duplicates by this key).
  const [paymentKey] = useState(() => crypto.randomUUID());

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['accounts', 'bank', businessId],
    queryFn: () => repos.account.findBankAccounts(businessId),
    enabled: Boolean(businessId),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(form.amount);
      if (Number.isNaN(amount) || amount <= 0) throw new Error('Enter a valid payment amount.');
      if (amount > outstanding + 0.01) {
        throw new Error(
          `Amount cannot exceed the outstanding balance of ${formatMwkDetailed(outstanding)}`,
        );
      }

      const manualRate = form.exchange_rate ? parseFloat(form.exchange_rate) : null;
      const rate = await resolveTransactionRate({
        businessId,
        originalCurrency: billCurrency,
        functionalCurrency,
        date: form.payment_date,
        manualRate,
        userId: currentUser?.id ?? null,
      });

      // Atomic: payment row + amount_paid + DR Trade Creditors / CR Cash
      // settlement entry + overpayment guard, in ONE server transaction.
      // recordPaymentForBill then moves the bill's own status to match the
      // amounts so a part-paid bill stops looking untouched.
      return repos.expense.recordPaymentForBill(
        {
          business_id: businessId,
          expense_id: bill.id,
          payment_date: form.payment_date,
          amount,
          currency: billCurrency,
          exchange_rate: rate.rate,
          original_currency: billCurrency,
          original_amount: amount,
          functional_currency: functionalCurrency,
          functional_amount: amount * rate.rate,
          rate_date: rate.rateDate,
          rate_is_stale: rate.isStale,
          payment_method: form.payment_method,
          reference: form.reference || null,
          bank_account_id: bankAccountId || null,
          notes: form.notes || null,
          created_by: currentUser?.id ?? null,
        } as InsertDto<'expense_payments'>,
        paymentKey,
      );
    },
    onSuccess: (result) => {
      setAlert({ type: 'success', message: 'Payment recorded successfully.' });
      // The payment moves the payable total, the ledger and the bank balance.
      for (const key of ['expenses', 'expenses_outstanding', 'journal', 'sofp', 'cash_flow', 'accounts']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 1000);
      return result;
    },
    onError: (err: Error) => {
      setAlert({ type: 'error', message: err.message });
    },
  });

  const remainingAfter = outstanding - (parseFloat(form.amount) || 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">Record bill payment</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 transition-colors hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-5 rounded-xl bg-gray-50 px-4 py-3 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Bill</span>
            <span className="font-medium text-gray-900">{bill.expense_number}</span>
          </div>
          <div className="mt-1 flex justify-between text-gray-600">
            <span>Total</span>
            <span>{formatMwkDetailed(Number(bill.total_amount))}</span>
          </div>
          <div className="mt-1 flex justify-between text-gray-600">
            <span>Already paid</span>
            <span>{formatMwkDetailed(Number(bill.amount_paid ?? 0))}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 font-semibold text-gray-900">
            <span>Outstanding</span>
            <span className="text-brand-700">{formatMwkDetailed(outstanding)}</span>
          </div>
        </div>

        {alert && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
              alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {alert.type === 'success' ? (
              <CheckCircle className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
            )}
            {alert.message}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Payment date</label>
              <input
                type="date"
                value={form.payment_date}
                onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Amount ({billCurrency})
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                {remainingAfter > 0.01
                  ? `${formatMwkDetailed(remainingAfter)} will remain outstanding (part payment).`
                  : 'Settles this bill in full.'}
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Payment method</label>
            <select
              value={form.payment_method}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  payment_method: e.target.value as Row<'expense_payments'>['payment_method'],
                }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {bankAccounts.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Pay from account</label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Cash on Hand (default)</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.bank_account_number ? ` — ${a.bank_account_number}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {billCurrency !== functionalCurrency && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Settlement exchange rate ({billCurrency} → {functionalCurrency})
              </label>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={form.exchange_rate}
                onChange={(e) => setForm((f) => ({ ...f, exchange_rate: e.target.value }))}
                placeholder={`1 ${billCurrency} = ? ${functionalCurrency}`}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Reference (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. supplier receipt no."
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || outstanding <= 0}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {mutation.isPending ? 'Saving…' : 'Record payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
