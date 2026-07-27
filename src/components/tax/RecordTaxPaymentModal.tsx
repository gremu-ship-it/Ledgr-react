import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Upload, AlertCircle, CheckCircle, Paperclip } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { useBankAccounts } from '@/hooks/useTaxObligations';
import type { TaxObligation } from '@/hooks/useTaxObligations';
import { formatCurrencyAmount } from '@/lib/currency';
import { todayIso } from '@/lib/taxDates';
import { nextEntryNumber } from '@/services/journalService';
import type { Row } from '@/dal/types/database';

const PAYMENT_METHODS: { value: Row<'tax_payments'>['payment_method']; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash',          label: 'Cash' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'airtel_money',  label: 'Airtel Money' },
  { value: 'tnm_mpamba',    label: 'TNM Mpamba' },
  { value: 'card',          label: 'Card' },
  { value: 'other',         label: 'Other' },
];

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export function RecordTaxPaymentModal({
  obligation,
  businessId,
  currency,
  onClose,
}: {
  obligation: TaxObligation;
  businessId: string;
  currency: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const currentUser = useAppStore((s) => s.currentUser);
  const { data: bankAccounts = [] } = useBankAccounts(businessId);

  const [form, setForm] = useState({
    payment_date: todayIso(),
    amount: String(obligation.outstanding.toFixed(2)),
    payment_method: 'bank_transfer' as Row<'tax_payments'>['payment_method'],
    bank_account_id: '',
    reference: '',
    notes: '',
  });
  const [receipt, setReceipt] = useState<File | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set<K extends keyof typeof form>(field: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_RECEIPT_BYTES) {
      setAlert({ type: 'error', message: 'Receipt must be 10 MB or smaller.' });
      return;
    }
    setAlert(null);
    setReceipt(file);
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(form.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Enter a valid payment amount.');
      if (!form.bank_account_id) throw new Error('Select the account the payment was made from.');
      if (!currentUser?.id) throw new Error('You must be signed in to record a payment.');

      let receiptPath: string | undefined;
      if (receipt) {
        receiptPath = await repos.taxPayment.uploadReceipt(
          businessId, obligation.taxReturn.id, receipt,
        );
      }

      const entryNumber = await nextEntryNumber(businessId);

      return repos.taxPayment.recordPayment({
        businessId,
        taxReturnId: obligation.taxReturn.id,
        paymentDate: form.payment_date,
        amount,
        paymentMethod: form.payment_method,
        bankAccountId: form.bank_account_id,
        reference: form.reference || undefined,
        receiptPath,
        notes: form.notes || undefined,
        createdBy: currentUser.id,
        entryNumber,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax_returns'] });
      queryClient.invalidateQueries({ queryKey: ['tax_payments'] });
      queryClient.invalidateQueries({ queryKey: ['journal_entries'] });
      setAlert({ type: 'success', message: 'Payment recorded and posted to the journal.' });
      setTimeout(onClose, 1200);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Record tax payment</h2>
            <p className="text-xs text-gray-500">
              {obligation.label} · {obligation.periodDisplay}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          {alert && (
            <div className={`flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
              alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
            }`}>
              {alert.type === 'success'
                ? <CheckCircle className="h-4 w-4 shrink-0" />
                : <AlertCircle className="h-4 w-4 shrink-0" />}
              {alert.message}
            </div>
          )}

          <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm">
            <div className="flex justify-between text-gray-600">
              <span>Outstanding balance</span>
              <span className="font-semibold text-gray-900">
                {formatCurrencyAmount(obligation.outstanding, currency)}
              </span>
            </div>
            <div className="mt-1 flex justify-between text-gray-600">
              <span>Due</span>
              <span>{obligation.dueDateDisplay}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="tp-date" className="mb-1 block text-sm font-medium text-gray-700">Payment date *</label>
              <input id="tp-date" type="date" value={form.payment_date}
                onChange={(e) => set('payment_date', e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="tp-amount" className="mb-1 block text-sm font-medium text-gray-700">Amount *</label>
              <input id="tp-amount" type="number" min="0" step="0.01" value={form.amount}
                onChange={(e) => set('amount', e.target.value)} className={inputClass} />
            </div>

            <div>
              <label htmlFor="tp-method" className="mb-1 block text-sm font-medium text-gray-700">Method *</label>
              <select id="tp-method" value={form.payment_method}
                onChange={(e) => set('payment_method', e.target.value as Row<'tax_payments'>['payment_method'])}
                className={inputClass}>
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="tp-account" className="mb-1 block text-sm font-medium text-gray-700">Paid from *</label>
              <select id="tp-account" value={form.bank_account_id}
                onChange={(e) => set('bank_account_id', e.target.value)} className={inputClass}>
                <option value="">Select account…</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label htmlFor="tp-ref" className="mb-1 block text-sm font-medium text-gray-700">
                Reference (optional)
              </label>
              <input id="tp-ref" type="text" value={form.reference}
                onChange={(e) => set('reference', e.target.value)}
                placeholder="e.g. MRA receipt number" className={inputClass} />
            </div>

            <div className="col-span-2">
              <span className="mb-1 block text-sm font-medium text-gray-700">Payment receipt (optional)</span>
              <label
                htmlFor="tp-receipt"
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-600 transition-colors hover:border-brand-400 hover:bg-brand-50/40"
              >
                {receipt ? <Paperclip className="h-4 w-4 text-brand-500" /> : <Upload className="h-4 w-4" />}
                <span className="truncate">
                  {receipt ? receipt.name : 'Attach a photo or PDF (max 10 MB)'}
                </span>
              </label>
              <input id="tp-receipt" type="file" className="sr-only"
                accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                onChange={onFileChange} />
            </div>

            <div className="col-span-2">
              <label htmlFor="tp-notes" className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
              <textarea id="tp-notes" rows={2} value={form.notes}
                onChange={(e) => set('notes', e.target.value)} className={inputClass} />
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Recording a payment posts Dr Tax Payable / Cr {bankAccounts.find((a) => a.id === form.bank_account_id)?.name ?? 'Bank'} to the journal.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60">
            {mutation.isPending ? 'Recording…' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  );
}
