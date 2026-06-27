import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  CreditCard,
  CheckCircle,
  X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto } from '@/dal/types/database';

// ── Formatters ────────────────────────────────────────────────────────────────

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('en-MW', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'draft' | 'sent' | 'paid' | 'overdue' | 'partially_paid';

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Draft', value: 'draft' },
  { label: 'Sent', value: 'sent' },
  { label: 'Partially Paid', value: 'partially_paid' },
  { label: 'Paid', value: 'paid' },
  { label: 'Overdue', value: 'overdue' },
];

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money (Airtel/TNM)' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-50 text-blue-700',
    viewed: 'bg-purple-50 text-purple-700',
    partially_paid: 'bg-amber-50 text-amber-700',
    paid: 'bg-brand-50 text-brand-700',
    overdue: 'bg-red-50 text-red-700',
    voided: 'bg-gray-100 text-gray-400',
    credited: 'bg-gray-100 text-gray-400',
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        map[status] ?? 'bg-gray-100 text-gray-600'
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

// ── Record Payment Modal ──────────────────────────────────────────────────────

function RecordPaymentModal({
  invoice,
  businessId,
  onClose,
  onSuccess,
}: {
  invoice: Row<'invoices'>;
  businessId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const queryClient = useQueryClient();
  const amountDue =
    invoice.amount_due !== null
      ? Number(invoice.amount_due)
      : Number(invoice.total_amount) - Number(invoice.amount_paid);

  const [form, setForm] = useState({
    payment_date: today(),
    amount: amountDue.toFixed(2),
    payment_method: 'bank_transfer',
    reference: '',
    notes: '',
  });
  const [alert, setAlert] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Load bank accounts for payment
  const { data: bankAccounts = [] } = useQuery({
    queryKey: ['accounts', 'bank', businessId],
    queryFn: () => repos.account.findBankAccounts(businessId),
    enabled: Boolean(businessId),
  });

  const [bankAccountId, setBankAccountId] = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(form.amount);
      if (isNaN(amount) || amount <= 0)
        throw new Error('Enter a valid payment amount');
      if (amount > amountDue)
        throw new Error(
          `Amount cannot exceed the outstanding balance of ${formatMwk(amountDue)}`,
        );

      await repos.invoice.recordPayment({
        business_id: businessId,
        invoice_id: invoice.id,
        payment_date: form.payment_date,
        amount,
        currency: 'MWK',
        exchange_rate: 1,
        payment_method: form.payment_method as Row<'invoice_payments'>['payment_method'],
        reference: form.reference || null,
        bank_account_id: bankAccountId || null,
        notes: form.notes || null,
        created_by: null,
      } as InsertDto<'invoice_payments'>);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Payment recorded successfully.' });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1200);
    },
    onError: (err: Error) => {
      setAlert({ type: 'error', message: err.message });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-brand-500" />
            <h2 className="text-base font-semibold text-gray-900">
              Record Payment
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Invoice summary */}
        <div className="mb-5 rounded-xl bg-gray-50 px-4 py-3 text-sm">
          <div className="flex justify-between text-gray-600">
            <span>Invoice</span>
            <span className="font-medium text-gray-900">
              {invoice.invoice_number}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-gray-600">
            <span>Total</span>
            <span>{formatMwk(Number(invoice.total_amount))}</span>
          </div>
          <div className="mt-1 flex justify-between text-gray-600">
            <span>Already Paid</span>
            <span>{formatMwk(Number(invoice.amount_paid))}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 font-semibold text-gray-900">
            <span>Outstanding</span>
            <span className="text-brand-700">{formatMwk(amountDue)}</span>
          </div>
        </div>

        {alert && (
          <div
            className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
              alert.type === 'success'
                ? 'bg-brand-50 text-brand-700'
                : 'bg-red-50 text-red-700'
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
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Payment Date
              </label>
              <input
                type="date"
                value={form.payment_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, payment_date: e.target.value }))
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Amount (MWK)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value }))
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Payment Method
            </label>
            <select
              value={form.payment_method}
              onChange={(e) =>
                setForm((f) => ({ ...f, payment_method: e.target.value }))
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
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Deposit to Account
              </label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">Select account…</option>
                {bankAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.bank_account_number ? ` — ${a.bank_account_number}` : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Reference (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. TXN-12345"
              value={form.reference}
              onChange={(e) =>
                setForm((f) => ({ ...f, reference: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Notes (optional)
            </label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="flex-1 rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
            >
              {mutation.isPending ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Invoice Detail View ───────────────────────────────────────────────────────

function InvoiceDetail({
  invoice,
  businessId,
  onBack,
}: {
  invoice: Row<'invoices'>;
  businessId: string;
  onBack: () => void;
}) {
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const queryClient = useQueryClient();

  const { data: withLines, isLoading } = useQuery({
    queryKey: ['invoice', 'lines', invoice.id],
    queryFn: () => repos.invoice.findByIdWithLines(invoice.id),
    enabled: Boolean(invoice.id),
  });

  const { data: payments = [] } = useQuery({
    queryKey: ['invoice', 'payments', invoice.id],
    queryFn: () => repos.invoice.findPayments(businessId, invoice.id),
    enabled: Boolean(invoice.id),
  });

  const amountDue =
    invoice.amount_due !== null
      ? Number(invoice.amount_due)
      : Number(invoice.total_amount) - Number(invoice.amount_paid);

  const canPay = !['paid', 'voided', 'credited'].includes(invoice.status);

  return (
    <div>
      {/* Back button + header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Invoices
          </button>
        </div>
        {canPay && amountDue > 0 && (
          <button
            onClick={() => setShowPaymentModal(true)}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
          >
            <CreditCard className="h-4 w-4" />
            Record Payment
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Main invoice card */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            {/* Invoice header */}
            <div className="mb-6 flex items-start justify-between">
              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  {invoice.invoice_number}
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  Issued {formatDate(invoice.issue_date)}
                  {invoice.due_date &&
                    ` · Due ${formatDate(invoice.due_date)}`}
                </p>
              </div>
              <StatusBadge status={invoice.status} />
            </div>

            {/* Line items */}
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-gray-100"
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Description</th>
                      <th className="px-4 py-2.5 text-right">Qty</th>
                      <th className="px-4 py-2.5 text-right">Unit Price</th>
                      <th className="px-4 py-2.5 text-right">Tax</th>
                      <th className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(withLines?.lines ?? []).map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3 text-gray-700">
                          {line.description}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {line.quantity}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {formatMwk(Number(line.unit_price))}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {formatMwk(Number(line.tax_amount))}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatMwk(Number(line.line_total))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Totals */}
            <div className="mt-4 flex justify-end">
              <div className="w-64 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatMwk(Number(invoice.subtotal))}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>VAT (17.5%)</span>
                  <span>{formatMwk(Number(invoice.vat_amount))}</span>
                </div>
                {Number(invoice.wht_amount) > 0 && (
                  <div className="flex justify-between text-gray-600">
                    <span>WHT</span>
                    <span>−{formatMwk(Number(invoice.wht_amount))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900">
                  <span>Total</span>
                  <span>{formatMwk(Number(invoice.total_amount))}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            {invoice.notes && (
              <div className="mt-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
                <span className="font-medium text-gray-700">Notes: </span>
                {invoice.notes}
              </div>
            )}
          </div>
        </div>

        {/* Sidebar — payment status + history */}
        <div className="space-y-4">
          {/* Payment summary */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <h3 className="mb-4 text-sm font-semibold text-gray-900">
              Payment Status
            </h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-gray-600">
                <span>Invoice Total</span>
                <span>{formatMwk(Number(invoice.total_amount))}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Amount Paid</span>
                <span className="text-brand-700">
                  {formatMwk(Number(invoice.amount_paid))}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold text-gray-900">
                <span>Outstanding</span>
                <span className={amountDue > 0 ? 'text-red-600' : 'text-brand-700'}>
                  {formatMwk(amountDue)}
                </span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-2 rounded-full bg-brand-500 transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (Number(invoice.amount_paid) /
                        Number(invoice.total_amount)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-400">
                {Math.round(
                  (Number(invoice.amount_paid) /
                    Number(invoice.total_amount)) *
                    100,
                )}
                % paid
              </p>
            </div>

            {canPay && amountDue > 0 && (
              <button
                onClick={() => setShowPaymentModal(true)}
                className="mt-4 w-full rounded-lg bg-brand-500 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
              >
                Record Payment
              </button>
            )}
          </div>

          {/* Payment history */}
          {payments.length > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">
                Payment History
              </h3>
              <div className="space-y-3">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        {formatMwk(Number(p.amount))}
                      </p>
                      <p className="text-xs text-gray-400">
                        {formatDate(p.payment_date)} ·{' '}
                        {p.payment_method.replace(/_/g, ' ')}
                      </p>
                    </div>
                    {p.reference && (
                      <span className="text-xs text-gray-400">
                        {p.reference}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showPaymentModal && (
        <RecordPaymentModal
          invoice={invoice}
          businessId={businessId}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['invoices'] });
            queryClient.invalidateQueries({
              queryKey: ['invoice', 'payments', invoice.id],
            });
          }}
        />
      )}
    </div>
  );
}

// ── Invoice List ──────────────────────────────────────────────────────────────

function InvoiceList({
  businessId,
  onSelect,
}: {
  businessId: string;
  onSelect: (invoice: Row<'invoices'>) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: invoices = [], isLoading, isError } = useQuery({
    queryKey: ['invoices', businessId],
    queryFn: () => repos.invoice.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const filtered =
    statusFilter === 'all'
      ? invoices
      : invoices.filter((inv) => inv.status === statusFilter);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-xl bg-gray-100"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load invoices.
      </div>
    );
  }

  return (
    <div>
      {/* Status filter tabs */}
      <div className="mb-5 flex flex-wrap gap-1">
        {STATUS_TABS.map((tab) => {
          const count =
            tab.value === 'all'
              ? invoices.length
              : invoices.filter((inv) => inv.status === tab.value).length;
          return (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === tab.value
                  ? 'bg-brand-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {tab.label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs ${
                  statusFilter === tab.value
                    ? 'bg-white/20 text-white'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
          <FileText className="h-10 w-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">
            {statusFilter === 'all'
              ? 'No invoices yet'
              : `No ${statusFilter.replace('_', ' ')} invoices`}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="hidden sm:table-cell px-4 py-3 text-left">Issue Date</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left">Due Date</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-right">Outstanding</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((inv) => {
                  const amountDue =
                    inv.amount_due !== null
                      ? Number(inv.amount_due)
                      : Number(inv.total_amount) - Number(inv.amount_paid);
                  return (
                    <tr
                      key={inv.id}
                      onClick={() => onSelect(inv)}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 font-medium text-brand-700">
                        {inv.invoice_number}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-gray-500">
                        {formatDate(inv.issue_date)}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-gray-500">
                        {inv.due_date ? formatDate(inv.due_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {formatMwk(Number(inv.total_amount))}
                      </td>
                      <td
                        className={`hidden sm:table-cell px-4 py-3 text-right ${
                          amountDue > 0
                            ? 'font-medium text-red-600'
                            : 'text-gray-400'
                        }`}
                      >
                        {amountDue > 0 ? formatMwk(amountDue) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className="px-3 py-3">
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Invoices Page ────────────────────────────────────────────────────────

export function InvoicesPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const [selectedInvoice, setSelectedInvoice] =
    useState<Row<'invoices'> | null>(null);

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      {!selectedInvoice && (
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Invoices</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage invoices for {currentBusiness.business.name}
          </p>
        </div>
      )}

      {selectedInvoice ? (
        <InvoiceDetail
          invoice={selectedInvoice}
          businessId={businessId}
          onBack={() => setSelectedInvoice(null)}
        />
      ) : (
        <InvoiceList
          businessId={businessId}
          onSelect={setSelectedInvoice}
        />
      )}
    </div>
  );
}
