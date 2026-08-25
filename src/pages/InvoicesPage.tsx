import { useState } from 'react';
import { queryKeys } from '@/lib/queryKeys';
import { invalidateAfterIncome } from '@/lib/queryInvalidation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronRight,
  ArrowLeft,
  CreditCard,
  CheckCircle,
  X,
  FileDown,
  Receipt,
  Truck,
  Eye,
} from 'lucide-react';
import { formatMwkDetailed } from '@/lib/formatters';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto } from '@/dal/types/database';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { createInvoiceSettlementEntry } from '@/services/journalService';
import { resolveTransactionRate } from '@/lib/currency';
import { DocumentDownloadButton } from '@/components/documents/DocumentDownloadButton';
import { generateInvoiceDocument, generateDeliveryNoteDocument, generateReceiptDocument } from '@/lib/documents/documentGenerator';
import {
  businessRowToBranding,
  invoiceLineRowToDocumentLine,
  type BusinessBranding,
} from '@/lib/documents/types';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '@/hooks/useIsMobile';
import { SwipeableRow } from '@/components/mobile/SwipeableRow';
import { EmptyState } from '@/components/ui/EmptyState';
import { useDensity } from '@/hooks/useDensity';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/mobile/PullToRefreshIndicator';
import { useCallback } from 'react';

// ── Formatters ────────────────────────────────────────────────────────────────
import { formatDateShort } from '@/lib/formatters';
function formatDate(date: string): string {
  return formatDateShort(date);
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
    void: 'bg-gray-100 text-gray-400',
    voided: 'bg-gray-100 text-gray-400',
    credit_note: 'bg-gray-100 text-gray-400',
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
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
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
    exchange_rate: '',
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
          `Amount cannot exceed the outstanding balance of ${formatMwkDetailed(amountDue)}`,
        );

      const functionalCurrency = currentBusiness?.business?.base_currency || 'MWK';
      const paymentCurrency = invoice.original_currency ?? invoice.currency ?? functionalCurrency;
      const manualRate = form.exchange_rate ? parseFloat(form.exchange_rate) : null;
      const rate = await resolveTransactionRate({
        businessId,
        originalCurrency: paymentCurrency,
        functionalCurrency,
        date: form.payment_date,
        manualRate,
        userId: currentUser?.id ?? null,
      });

      const { payment } = await repos.invoice.recordPayment({
        business_id: businessId,
        invoice_id: invoice.id,
        payment_date: form.payment_date,
        amount,
        currency: paymentCurrency,
        exchange_rate: rate.rate,
        original_currency: paymentCurrency,
        original_amount: amount,
        functional_currency: functionalCurrency,
        functional_amount: amount * rate.rate,
        rate_date: rate.rateDate,
        rate_is_stale: rate.isStale,
        payment_method: form.payment_method as Row<'invoice_payments'>['payment_method'],
        reference: form.reference || null,
        bank_account_id: bankAccountId || null,
        notes: form.notes || null,
        created_by: currentUser?.id ?? null,
      } as InsertDto<'invoice_payments'>);

      await createInvoiceSettlementEntry(
        businessId,
        invoice,
        payment,
        functionalCurrency,
        invoice.branch_id ?? null,
        invoice.department_id ?? null,
      );
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Payment recorded successfully.' });
      invalidateAfterIncome(queryClient);
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
            <span>{formatMwkDetailed(Number(invoice.total_amount))}</span>
          </div>
          <div className="mt-1 flex justify-between text-gray-600">
            <span>Already Paid</span>
            <span>{formatMwkDetailed(Number(invoice.amount_paid))}</span>
          </div>
          <div className="mt-2 flex justify-between border-t border-gray-200 pt-2 font-semibold text-gray-900">
            <span>Outstanding</span>
            <span className="text-brand-700">{formatMwkDetailed(amountDue)}</span>
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

          {(invoice.original_currency ?? invoice.currency) !== (currentBusiness?.business?.base_currency || 'MWK') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Settlement exchange rate ({invoice.original_currency ?? invoice.currency} → {currentBusiness?.business?.base_currency || 'MWK'})
              </label>
              <input
                type="number"
                min="0"
                step="0.000001"
                value={form.exchange_rate}
                onChange={(e) => setForm((f) => ({ ...f, exchange_rate: e.target.value }))}
                placeholder={`1 ${invoice.original_currency ?? invoice.currency} = ? ${currentBusiness?.business?.base_currency || 'MWK'}`}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-gray-600">Leave blank to use the cached closing/transaction-date rate if available.</p>
            </div>
          )}

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
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { logoUrl, businessName, tradingName, business: businessData } = useBrandTheme();

  const { data: withLines, isLoading } = useQuery({
    queryKey: queryKeys.invoiceLines(businessId, invoice.id),
    queryFn: () => repos.invoice.findByIdWithLines(invoice.id, businessId),
    enabled: Boolean(businessId && invoice.id),
  });

  const { data: payments = [] } = useQuery({
    queryKey: queryKeys.invoicePayments(businessId, invoice.id),
    queryFn: () => repos.invoice.findPayments(businessId, invoice.id),
    enabled: Boolean(businessId && invoice.id),
  });

  // Fetch contact for professional invoice PDF
  const { data: contact } = useQuery({
    queryKey: queryKeys.contact(businessId, invoice.contact_id ?? ''),
    queryFn: async () => {
      if (!invoice.contact_id) return null;
      const { data, error } = await supabase
        .from('contacts')
        .select('*')
        .eq('business_id', businessId)
        .eq('id', invoice.contact_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Row<'contacts'> | null;
    },
    enabled: Boolean(invoice.contact_id),
  });

  const amountDue =
    invoice.amount_due !== null
      ? Number(invoice.amount_due)
      : Number(invoice.total_amount) - Number(invoice.amount_paid);

  const canPay = !['paid', 'void', 'credit_note'].includes(invoice.status);

  const businessBranding: BusinessBranding = businessData
    ? businessRowToBranding(businessData as Row<'businesses'>)
    : {
        name: businessName || 'Business',
        tradingName: tradingName,
        logoUrl: logoUrl,
        // This is the no-business-data fallback branch, so brand_color is
        // never readable here — use the default brand color outright.
        brandColor: '#0E7C5A',
      };

  const handleDownloadInvoice = async () => {
    setIsDownloading(true);
    setDownloadSuccess(false);
    setDownloadError(null);
    try {
      await generateInvoiceDocument({
        business: businessBranding,
        invoice: {
          invoice_number: invoice.invoice_number,
          issue_date: invoice.issue_date,
          due_date: invoice.due_date,
          status: invoice.status,
          subtotal: invoice.subtotal,
          vat_amount: invoice.vat_amount,
          wht_amount: invoice.wht_amount,
          discount_amount: invoice.discount_amount,
          total_amount: invoice.total_amount,
          amount_paid: invoice.amount_paid,
          currency: invoice.currency,
          notes: invoice.notes,
          terms: invoice.terms,
          po_number: invoice.po_number,
        },
        lines: (withLines?.lines ?? []).map(invoiceLineRowToDocumentLine),
        contact: contact
          ? {
              name: contact.name,
              trading_name: contact.trading_name,
              email: contact.email,
              phone: contact.phone,
              address_line1: contact.address_line1,
              address_line2: contact.address_line2,
              city: contact.city,
              country: contact.country,
              tpin: contact.tpin,
              vat_number: contact.vat_number,
            }
          : null,
        payments: payments.map((p) => ({
          payment_date: p.payment_date,
          amount: p.amount,
          payment_method: p.payment_method,
          reference: p.reference,
        })),
      });
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      setDownloadError((err as Error).message || String(err));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadReceipt = async () => {
    setIsDownloading(true);
    setDownloadSuccess(false);
    setDownloadError(null);
    try {
      // Receipt after payment - professional
      const curr = invoice.currency || 'MWK';
      await generateReceiptDocument({
        business: businessBranding,
        title: 'Payment Receipt',
        number: `RCPT-${invoice.invoice_number}`,
        date: new Date().toISOString(),
        status: 'paid',
        from: {
          name: businessBranding.name,
          details: [
            businessBranding.addressLine1 || '',
            businessBranding.city || '',
            businessBranding.phone || '',
            businessBranding.email || '',
          ].filter(Boolean),
        },
        to: contact
          ? {
              name: contact.name,
              details: [contact.email || '', contact.phone || ''].filter(Boolean),
            }
          : undefined,
        lines: [
          { description: `Payment for Invoice ${invoice.invoice_number}`, amount: invoice.amount_paid },
        ],
        totals: [
          { label: 'Invoice Total', value: invoice.total_amount },
          { label: 'Amount Paid', value: invoice.amount_paid, bold: true },
          { label: 'Balance Due', value: amountDue, isTotal: true },
        ],
        currency: curr,
        notes: `Receipt for invoice ${invoice.invoice_number}. Thank you for your payment.`,
      });
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      setDownloadError((err as Error).message || String(err));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDownloadDeliveryNote = async () => {
    setIsDownloading(true);
    setDownloadSuccess(false);
    setDownloadError(null);
    try {
      // Create a delivery note from invoice lines
      await generateDeliveryNoteDocument({
        business: businessBranding,
        transfer: {
          transfer_number: `DN-${invoice.invoice_number}`,
          status: 'dispatched',
          created_at: invoice.issue_date,
          dispatched_at: new Date().toISOString(),
          notes: invoice.notes,
          from_location_name: businessBranding.name,
          to_location_name: contact?.name || 'Customer',
        },
        lines: (withLines?.lines ?? []).map((l) => ({
          product_name: l.description,
          sku: null,
          quantity_requested: Number(l.quantity),
          quantity_dispatched: Number(l.quantity),
          quantity_received: undefined,
        })),
      });
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      setDownloadError((err as Error).message || String(err));
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div>
      {/* Back button + header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Invoices
          </button>
        </div>
        <div className="flex items-center gap-2">
          <DocumentDownloadButton
            label="Download"
            variant="secondary"
            options={[
              {
                id: 'invoice',
                label: 'Invoice PDF',
                description: 'Professional invoice with logo & branding',
                icon: <FileDown className="h-4 w-4" />,
                onClick: handleDownloadInvoice,
              },
              {
                id: 'delivery',
                label: 'Delivery Note',
                description: 'Goods delivery / waybill',
                icon: <Truck className="h-4 w-4" />,
                onClick: handleDownloadDeliveryNote,
              },
              ...(Number(invoice.amount_paid) > 0
                ? [
                    {
                      id: 'receipt',
                      label: 'Payment Receipt',
                      description: 'Proof of payment',
                      icon: <Receipt className="h-4 w-4" />,
                      onClick: handleDownloadReceipt,
                    },
                  ]
                : []),
            ]}
          />
          {canPay && amountDue > 0 && (
            <button
              onClick={() => setShowPaymentModal(true)}
              className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 transition-colors shadow-sm"
            >
              <CreditCard className="h-4 w-4" />
              Record Payment
            </button>
          )}
        </div>
      </div>

      {isDownloading && (
        <div className="mb-4 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800 flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          Generating document... Please wait.
        </div>
      )}
      {downloadSuccess && (
        <div className="mb-4 rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          ✓ Document generated and downloaded successfully!
        </div>
      )}
      {downloadError && (
        <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
          ⚠️ Failed to generate document: {downloadError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Main invoice card */}
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            {/* Invoice header with business branding */}
            <div className="mb-6 flex items-start justify-between">
              <div className="flex items-start gap-4">
                {/* Business logo */}
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={businessName}
                    className="h-14 w-14 shrink-0 rounded-lg object-contain"
                  />
                ) : (
                  <div
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-white"
                    style={{ backgroundColor: 'var(--color-brand-500, #0F766E)' }}
                  >
                    {(businessName || 'L').charAt(0).toUpperCase()}
                  </div>
                )}
                {/* Business info */}
                <div>
                  <h1 className="text-lg font-semibold" style={{ color: 'var(--color-brand-700, #334155)' }}>
                    {tradingName || businessName}
                  </h1>
                  {businessData && (
                    <div className="mt-0.5 text-xs text-gray-500">
                      {businessData.address_line1 && (
                        <span>{businessData.address_line1}{businessData.city ? `, ${businessData.city}` : ''}</span>
                      )}
                      {businessData.phone && (
                        <span> · {businessData.phone}</span>
                      )}
                      {businessData.email && (
                        <span> · {businessData.email}</span>
                      )}
                      {businessData.tpin && (
                        <div className="mt-0.5">TPIN: {businessData.tpin}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Invoice</p>
                <h2 className="text-xl font-semibold text-gray-900">
                  {invoice.invoice_number}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Issued {formatDate(invoice.issue_date)}
                  {invoice.due_date &&
                    ` · Due ${formatDate(invoice.due_date)}`}
                </p>
                <div className="mt-2">
                  <StatusBadge status={invoice.status} />
                </div>
              </div>
            </div>

            {/* Line items — discount-aware */}
            {isLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="h-10 animate-pulse rounded-lg bg-gray-100"
                  />
                ))}
              </div>
            ) : (() => {
              const linesArr = (withLines?.lines ?? []) as unknown as Array<Row<'invoice_lines'> & { discount_percent?: number; discount_amount?: number }>;
              const totalDiscount = Number(invoice.discount_amount ?? 0) || linesArr.reduce((s, l) => s + Number(l.discount_amount ?? 0), 0);
              const hasDiscount = totalDiscount > 0.005 || linesArr.some((l) => Number(l.discount_percent ?? 0) > 0);
              return (
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-left">Description</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Qty</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Unit Price</th>
                      {hasDiscount && <th scope="col" className="px-4 py-2.5 text-right">Disc %</th>}
                      {hasDiscount && <th scope="col" className="px-4 py-2.5 text-right">Discount</th>}
                      <th scope="col" className="px-4 py-2.5 text-right">Tax</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {linesArr.map((line) => {
                      const discPct = Number((line as unknown as { discount_percent?: number }).discount_percent ?? 0);
                      const discAmt = Number((line as unknown as { discount_amount?: number }).discount_amount ?? 0);
                      return (
                      <tr key={line.id}>
                        <td className="px-4 py-3 text-gray-700">
                          <div>{line.description}</div>
                          {(line as unknown as { product_name?: string }).product_name ? <div className="text-xs text-gray-500">{String((line as unknown as { product_name?: string }).product_name)}</div> : null}
                          {discPct > 0 && <div className="text-xs text-emerald-600">{discPct}% off{discAmt > 0 ? ` • -${formatMwkDetailed(discAmt)}` : ''}</div>}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {line.quantity}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500">
                          {formatMwkDetailed(Number(line.unit_price))}
                        </td>
                        {hasDiscount && <td className="px-4 py-3 text-right" style={{ color: discPct > 0 ? '#059669' : '#94a3b8' }}>{discPct > 0 ? `${discPct}%` : '—'}</td>}
                        {hasDiscount && <td className="px-4 py-3 text-right" style={{ color: discAmt > 0 ? '#059669' : '#94a3b8' }}>{discAmt > 0 ? `-${formatMwkDetailed(discAmt)}` : '—'}</td>}
                        <td className="px-4 py-3 text-right text-gray-500">
                          {formatMwkDetailed(Number(line.tax_amount))}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatMwkDetailed(Number(line.line_total))}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              );
            })()}

            {/* Totals — discount-aware */}
            {(() => {
              const linesArr = (withLines?.lines ?? []) as unknown as Array<Row<'invoice_lines'> & { discount_amount?: number }>;
              const totalDiscount = Number(invoice.discount_amount ?? 0) || linesArr.reduce((s, l) => s + Number(l.discount_amount ?? 0), 0);
              const grossSubtotal = Number(invoice.subtotal) + totalDiscount;
              const hasDiscount = totalDiscount > 0.005;
              return (
              <div className="mt-4 flex justify-end">
                <div className="w-64 space-y-1.5 text-sm">
                  {hasDiscount ? (
                    <>
                      <div className="flex justify-between text-gray-600"><span>Gross Subtotal</span><span>{formatMwkDetailed(grossSubtotal)}</span></div>
                      <div className="flex justify-between text-emerald-700"><span>Less: Discount</span><span>-{formatMwkDetailed(totalDiscount)}</span></div>
                      <div className="flex justify-between font-medium text-gray-900"><span>Net Subtotal</span><span>{formatMwkDetailed(Number(invoice.subtotal))}</span></div>
                    </>
                  ) : (
                    <div className="flex justify-between text-gray-600">
                      <span>Subtotal</span>
                      <span>{formatMwkDetailed(Number(invoice.subtotal))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-600">
                    <span>VAT (17.5%)</span>
                    <span>{formatMwkDetailed(Number(invoice.vat_amount))}</span>
                  </div>
                  {Number(invoice.wht_amount) > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>WHT</span>
                      <span>−{formatMwkDetailed(Number(invoice.wht_amount))}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900">
                    <span>Total</span>
                    <span>{formatMwkDetailed(Number(invoice.total_amount))}</span>
                  </div>
                </div>
              </div>
              );
            })()}

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
                <span>{formatMwkDetailed(Number(invoice.total_amount))}</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>Amount Paid</span>
                <span className="text-brand-700">
                  {formatMwkDetailed(Number(invoice.amount_paid))}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold text-gray-900">
                <span>Outstanding</span>
                <span className={amountDue > 0 ? 'text-red-600' : 'text-brand-700'}>
                  {formatMwkDetailed(amountDue)}
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
              <p className="mt-1.5 text-xs text-gray-600">
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
                        {formatMwkDetailed(Number(p.amount))}
                      </p>
                      <p className="text-xs text-gray-600">
                        {formatDate(p.payment_date)} ·{' '}
                        {p.payment_method.replace(/_/g, ' ')}
                      </p>
                    </div>
                    {p.reference && (
                      <span className="text-xs text-gray-600">
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
              queryKey: queryKeys.invoicePayments(businessId, invoice.id),
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isMobile = useIsMobile();
  const { tdClass, thClass } = useDensity();
  const queryClient = useQueryClient();

  const onRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoices', businessId] });
  }, [queryClient, businessId]);

  const { containerRef, pullDistance, isRefreshing, progress } = usePullToRefresh({ onRefresh, disabled: !isMobile });

  const { data: invoices = [], isLoading, isError } = useQuery({
    queryKey: ['invoices', businessId],
    queryFn: () => repos.invoice.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const filtered =
    statusFilter === 'all'
      ? invoices
      : invoices.filter((inv) => inv.status === statusFilter);

  const filteredIds = filtered.map((i) => i.id);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const someSelected = filteredIds.some((id) => selectedIds.has(id));

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  }

  const totalSelectedAmount = filtered
    .filter((inv) => selectedIds.has(inv.id))
    .reduce((sum, inv) => sum + Number(inv.total_amount), 0);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
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
    <div ref={containerRef}>
      <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} progress={progress} />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
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
                    statusFilter === tab.value ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm border border-brand-100">
            <span className="font-semibold text-brand-800">{selectedIds.size} selected</span>
            <span className="text-brand-600">{formatMwkDetailed(totalSelectedAmount)} total</span>
            <button onClick={() => setSelectedIds(new Set())} className="ml-2 rounded-lg bg-white px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 border">Clear</button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={statusFilter === 'all' ? 'No invoices yet' : `No ${statusFilter.replace('_', ' ')} invoices`}
          description={statusFilter === 'all' ? 'Create your first invoice to start billing.' : 'Try a different status filter.'}
          actionLabel={statusFilter === 'all' ? 'New Invoice' : undefined}
          onAction={statusFilter === 'all' ? () => (window.location.href = '/income?action=invoice') : undefined}
          variant="finance"
        />
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map((inv) => {
            const amountDue = inv.amount_due !== null ? Number(inv.amount_due) : Number(inv.total_amount) - Number(inv.amount_paid);
            const isSel = selectedIds.has(inv.id);
            const canPay = !['paid', 'void', 'credit_note'].includes(inv.status) && amountDue > 0;
            return (
              <SwipeableRow
                key={inv.id}
                actions={[
                  { label: 'View', icon: Eye, color: 'bg-gray-700', action: () => onSelect(inv) },
                  ...(canPay ? [{ label: 'Pay', icon: CreditCard, color: 'bg-brand-500', action: () => onSelect(inv) } as const] : []),
                ]}
              >
                <div className={`flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm ${isSel ? 'border-brand-300 ring-1 ring-brand-100' : 'border-gray-200'}`}>
                  <input type="checkbox" checked={isSel} onChange={() => toggleOne(inv.id)} className="h-4 w-4 rounded border-gray-300 text-brand-600" />
                  <div className="min-w-0 flex-1" onClick={() => onSelect(inv)}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-brand-700">{inv.invoice_number}</p>
                      <StatusBadge status={inv.status} />
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-xs text-gray-500">{formatDate(inv.issue_date)} {inv.due_date ? `→ ${formatDate(inv.due_date)}` : ''}</p>
                      <p className="text-sm font-bold text-gray-900">{formatMwkDetailed(Number(inv.total_amount))}</p>
                    </div>
                    {amountDue > 0 && amountDue !== Number(inv.total_amount) && (
                      <p className="mt-1 text-xs font-medium text-red-600">{formatMwkDetailed(amountDue)} due</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                </div>
              </SwipeableRow>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="data-table w-full text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500 shadow-sm">
                <tr>
                  <th scope="col" className={`w-10 ${thClass}`}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allSelected && someSelected;
                      }}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                      aria-label="Select all invoices"
                    />
                  </th>
                  <th scope="col" className={`${thClass} text-left`}>Invoice #</th>
                  <th scope="col" className={`hidden sm:table-cell ${thClass} text-left`}>Issue Date</th>
                  <th scope="col" className={`hidden sm:table-cell ${thClass} text-left`}>Due Date</th>
                  <th scope="col" className={`${thClass} text-right numeric`}>Total</th>
                  <th scope="col" className={`hidden sm:table-cell ${thClass} text-right numeric`}>Outstanding</th>
                  <th scope="col" className={`${thClass} text-center`}>Status</th>
                  <th scope="col" className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((inv) => {
                  const amountDue =
                    inv.amount_due !== null ? Number(inv.amount_due) : Number(inv.total_amount) - Number(inv.amount_paid);
                  const isSel = selectedIds.has(inv.id);
                  return (
                    <tr
                      key={inv.id}
                      className={`transition-colors ${isSel ? 'bg-brand-50/50' : 'hover:bg-gray-50'}`}
                    >
                      <td className={`${tdClass}`}>
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={(e) => {
                            e.stopPropagation();
                            toggleOne(inv.id);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        />
                      </td>
                      <td className={`${tdClass} font-medium text-brand-700 cursor-pointer`} onClick={() => onSelect(inv)}>
                        {inv.invoice_number}
                      </td>
                      <td className={`hidden sm:table-cell ${tdClass} text-gray-500`}>{formatDate(inv.issue_date)}</td>
                      <td className={`hidden sm:table-cell ${tdClass} text-gray-500`}>{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                      <td className={`${tdClass} text-right font-medium`}>{formatMwkDetailed(Number(inv.total_amount))}</td>
                      <td className={`hidden sm:table-cell ${tdClass} text-right ${amountDue > 0 ? 'font-medium text-red-600' : 'text-gray-400'}`}>
                        {amountDue > 0 ? formatMwkDetailed(amountDue) : '—'}
                      </td>
                      <td className={`${tdClass} text-center`}>
                        <StatusBadge status={inv.status} />
                      </td>
                      <td className={`px-3 ${tdClass} cursor-pointer`} onClick={() => onSelect(inv)}>
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
