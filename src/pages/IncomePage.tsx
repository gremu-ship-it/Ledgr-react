import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, FileText, Zap, Trash2, AlertCircle, CheckCircle, Eye, CreditCard } from 'lucide-react';
import { formatMwkDetailed } from '@/lib/formatters';
import { VAT_STANDARD_RATE, VAT_STANDARD_RATE_PERCENT } from '@/lib/vat';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { InsertDto, Row } from '@/dal/types/database';
import { AddContactModal } from '@/components/AddContactModal';
import { createInvoiceJournalEntry, createInvoiceReceivableEntry } from '@/services/journalService';
import { deductStockAndPostCogs } from '@/services/inventoryJournalService';
import { CurrencySelector } from '@/components/CurrencySelector';
import { resolveTransactionRate } from '@/lib/currency';
import { enqueue, generateOfflineNumber, isOfflineError } from '@/offline/queueApi';
import { invalidateAfterIncome } from '@/lib/queryInvalidation';
import { createLogger } from '@/lib/logger';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDensity } from '@/hooks/useDensity';
import { useBrandTheme } from '@/hooks/useBrandTheme';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { PullToRefreshIndicator } from '@/components/mobile/PullToRefreshIndicator';
import { SwipeableRow } from '@/components/mobile/SwipeableRow';
import { EmptyState } from '@/components/ui/EmptyState';

const log = createLogger('IncomePage');

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tab = 'list' | 'quick' | 'invoice';

// ── Shared hooks ──────────────────────────────────────────────────────────────

function useBranches(businessId?: string) {
  return useQuery({
    queryKey: ['branches', businessId],
    queryFn: async () => {
      const { data, error } = await repos.inventory.db
        .from('branches')
        .select('id, name, code')
        .eq('business_id', businessId!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string; code: string | null }[];
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });
}

function useDepartments(businessId?: string) {
  return useQuery({
    queryKey: ['departments', businessId],
    queryFn: async () => {
      const { data, error } = await repos.inventory.db
        .from('departments')
        .select('id, name, code, cost_centre')
        .eq('business_id', businessId!)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string; code: string | null; cost_centre: string | null }[];
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });
}

function useAllProducts(businessId?: string) {
  return useQuery({
    queryKey: ['products_all', businessId],
    queryFn: () => repos.inventory.findAllProducts(businessId!),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

// ── Stock deduction on sale ──────────────────────────────────────────────────
// Reduces stock at the branch's linked inventory location (falling back to
// the default warehouse) AND posts the matching perpetual-inventory entry
// DR Cost of Sales / CR Inventory at weighted-average cost.
//
// Both halves live in inventoryJournalService.deductStockAndPostCogs so the
// desktop page, the mobile quick-sale sheet and the offline sync engine all
// value stock the same way. Non-blocking by design: stock tracking is a
// bonus on top of the sale, never a precondition for recording it.

// ── Reusable selectors ────────────────────────────────────────────────────────

function BranchSelect({
  value,
  onChange,
  branches,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  branches: { id: string; name: string; code: string | null }[];
  className?: string;
}) {
  if (branches.length === 0) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'}
    >
      <option value="">All branches / no branch</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}{b.code ? ` (${b.code})` : ''}
        </option>
      ))}
    </select>
  );
}

function DepartmentSelect({
  value,
  onChange,
  departments,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  departments: { id: string; name: string; code: string | null; cost_centre: string | null }[];
  className?: string;
}) {
  if (departments.length === 0) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'}
    >
      <option value="">No department</option>
      {departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}{d.code ? ` (${d.code})` : ''}
        </option>
      ))}
    </select>
  );
}

function ProductSelect({
  value,
  onChange,
  products,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  products: Row<'products'>[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'}
    >
      <option value="">{placeholder ?? 'Select product / service…'}</option>
      {products.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}{p.sku ? ` — ${p.sku}` : ''}
        </option>
      ))}
    </select>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money (Airtel/TNM)' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const TAX_OPTIONS = [
  { value: 'vat_standard', label: `VAT ${VAT_STANDARD_RATE_PERCENT}%` },
  { value: 'vat_exempt', label: 'VAT Exempt' },
  { value: 'vat_zero', label: 'VAT Zero Rated' },
  { value: 'none', label: 'No Tax' },
];

// ── Form types ────────────────────────────────────────────────────────────────

interface QuickEntryForm {
  issue_date: string;
  description: string;
  amount: string;
  currency: string;
  exchange_rate: string;
  payment_method: string;
  reference: string;
  notes: string;
  product_id: string;   // NEW
  branch_id: string;    // NEW
  department_id: string; // NEW
  quantity: string;     // NEW: units sold, for stock deduction
}

interface InvoiceLine {
  description: string;
  quantity: string;
  unit_price: string;
  /** Percentage discount is calculated before line tax. */
  discount_percent: string;
  tax_code: string;
  product_id: string;   // NEW
}

interface InvoiceForm {
  contact_id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  notes: string;
  terms: string;
  template: 'professional' | 'minimal' | 'ngo' | 'government';
  project_code: string;
  lpo_number: string;
  payment_provider: '' | 'airtel_money' | 'tnm_mpamba';
  payment_reference: string;
  branch_id: string;    // NEW
  department_id: string; // NEW
  currency: string;
  exchange_rate: string;
  lines: InvoiceLine[];
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    sent: 'bg-blue-50 text-blue-700',
    partially_paid: 'bg-amber-50 text-amber-700',
    paid: 'bg-brand-50 text-brand-700',
    overdue: 'bg-red-50 text-red-700',
    void: 'bg-gray-100 text-gray-400',
    voided: 'bg-gray-100 text-gray-400',
    credit_note: 'bg-gray-100 text-gray-400',
    credited: 'bg-gray-100 text-gray-400',
    viewed: 'bg-purple-50 text-purple-700',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function IncomeEmptyState({ onRecord }: { onRecord: () => void }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
        <FileText className="h-7 w-7 text-brand-500" />
      </div>
      <h2 className="text-base font-semibold text-gray-900">No income recorded yet</h2>
      <p className="max-w-xs text-sm text-gray-500">
        Record your first income entry or create an invoice to get started.
      </p>
      <button
        onClick={onRecord}
        className="mt-2 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
      >
        <Plus className="h-4 w-4" />Record Income
      </button>
    </div>
  );
}

// ── Quick Entry Tab ───────────────────────────────────────────────────────────

function QuickEntryTab({ businessId, onSuccess }: { businessId: string; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const { data: branches = [] } = useBranches(businessId);
  const { data: departments = [] } = useDepartments(businessId);
  const { data: products = [] } = useAllProducts(businessId);

  const [form, setForm] = useState<QuickEntryForm>({
    issue_date: today(), description: '', amount: '', currency: currentBusiness?.business?.base_currency || 'MWK', exchange_rate: '', payment_method: 'cash',
    reference: '', notes: '', product_id: '', branch_id: '', department_id: '', quantity: '1',
  });
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async (values: QuickEntryForm) => {
      const amount = parseFloat(values.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Enter a valid amount');
      if (!values.description.trim()) throw new Error('Description is required');
      const qty = parseFloat(values.quantity) || 1;

      const contacts = await repos.contact.findByBusiness(businessId, 'customer');
      const walkIn   = contacts.find((c) => c.name === 'Walk-in Customer') ?? contacts[0];
      if (!walkIn) {
        throw new Error(
          'No customer contacts found. Please add a "Walk-in Customer" contact first, or use the Invoice Builder.',
        );
      }

      const functionalCurrency = currentBusiness?.business?.base_currency || 'MWK';
      const originalCurrency = values.currency || functionalCurrency;
      const manualRate = values.exchange_rate ? parseFloat(values.exchange_rate) : null;
      const rate = await resolveTransactionRate({
        businessId,
        originalCurrency,
        functionalCurrency,
        date: values.issue_date,
        manualRate,
      });
      const functionalAmount = amount * rate.rate;

      const accounts      = await repos.account.findByBusiness(businessId);
      const arAccount     = accounts.find((a) => a.account_type === 'asset' && a.is_bank_account);

      // Resolve product's sales account if a product is selected
      const selectedProduct = values.product_id
        ? products.find((p) => p.id === values.product_id)
        : undefined;

      const isOfflineNow = typeof navigator !== 'undefined' && !navigator.onLine;
      const buildPayload = (num: string, contactId: string) => ({
        invoice: {
          business_id:      businessId,
          invoice_number:   num,
          invoice_type:     'invoice' as const,
          status:           'paid' as const,
          contact_id:       contactId,
          issue_date:       values.issue_date,
          due_date:         values.issue_date,
          currency:         originalCurrency,
          exchange_rate:    rate.rate,
          original_currency: originalCurrency,
          original_amount:   amount,
          functional_currency: functionalCurrency,
          functional_amount: functionalAmount,
          rate_date:        rate.rateDate,
          rate_is_stale:    rate.isStale,
          subtotal:         amount,
          discount_amount:  0,
          discount_percent: 0,
          taxable_amount:   amount,
          vat_amount:       0,
          wht_amount:       0,
          total_amount:     amount,
          amount_paid:      amount,
          ar_account_id:    arAccount?.id ?? null,
          notes:            values.notes || values.description || null,
          branch_id:        values.branch_id || null,
          department_id:    values.department_id || null,
          created_by:       null,
        } as InsertDto<'invoices'>,
        lines: [{
          line_number:      1,
          description:      values.description,
          quantity:         qty,
          unit_price:       qty > 0 ? amount / qty : amount,
          discount_percent: 0,
          tax_code:         'none',
          tax_rate:         0,
          tax_amount:       0,
          line_total:       amount,
          product_id:       values.product_id || null,
          account_id:       selectedProduct?.sales_account_id ?? null,
        } as Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>],
      });

      if (isOfflineNow) {
        const offlineNum = generateOfflineNumber('INV');
        await enqueue('income', businessId, buildPayload(offlineNum, 'offline_walk_in_customer'));
        return { offline: true, invoice_number: offlineNum, touchedInventory: false };
      }

      try {
        const invoiceNumber = await repos.business.reserveNextInvoiceNumber(businessId);
        // Use the row createWithLines returns rather than refetching every
        // invoice for the business and scanning for this one.
        const { invoice: created } = await repos.invoice.createWithLines(
          buildPayload(invoiceNumber, walkIn.id).invoice,
          buildPayload(invoiceNumber, walkIn.id).lines,
        );

        if (created) {
          try {
            await createInvoiceJournalEntry(
              businessId,
              created,
              amount,
              0,
              values.branch_id || null,
              values.department_id || null,
            );
          } catch (err) {
            log.error('Journal entry failed', { error: err });
            throw new Error(`Accounting journal entry failed: ${(err as Error).message}`, { cause: err });
          }

          // Releases stock and posts DR Cost of Sales / CR Inventory in the
          // same period as the revenue above (IAS 2.34).
          await deductStockAndPostCogs(
            businessId,
            created,
            [{ productId: values.product_id, quantity: qty }],
            values.branch_id || null,
            values.department_id || null,
            null,
          );
        }
        return {
          offline: false,
          invoice_number: invoiceNumber,
          touchedInventory: Boolean(selectedProduct?.track_inventory),
        };
      } catch (err) {
        if (isOfflineError(err)) {
          const offlineNum = generateOfflineNumber('INV');
          await enqueue('income', businessId, buildPayload(offlineNum, 'offline_walk_in_customer'));
          return { offline: true, invoice_number: offlineNum, touchedInventory: false };
        }
        throw err;
      }
    },
    onSuccess: (result) => {
      setAlert({ type: 'success', message: 'Income recorded successfully.' });
      setForm({
        issue_date: today(), description: '', amount: '', currency: currentBusiness?.business?.base_currency || 'MWK', exchange_rate: '', payment_method: 'cash',
        reference: '', notes: '', product_id: '', branch_id: '', department_id: '', quantity: '1',
      });
      // Scoped: see queryInvalidation.ts.
      invalidateAfterIncome(queryClient, { touchedInventory: result.touchedInventory });
      setTimeout(() => { setAlert(null); onSuccess(); }, 1500);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  function set(field: keyof QuickEntryForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <Zap className="h-5 w-5 text-brand-500" />
          <h2 className="text-base font-semibold text-gray-900">Quick Income Entry</h2>
        </div>

        {alert && (
          <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
            {alert.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {alert.message}
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={form.issue_date} onChange={(e) => set('issue_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <div className="flex gap-2">
                <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => set('amount', e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                <CurrencySelector
                  value={form.currency || currentBusiness?.business?.base_currency || 'MWK'}
                  onChange={(c) => set('currency', c)}
                  className="w-28"
                />
              </div>
            </div>
          </div>

          {(form.currency || currentBusiness?.business?.base_currency || 'MWK') !== (currentBusiness?.business?.base_currency || 'MWK') && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Exchange rate ({form.currency} → {currentBusiness?.business?.base_currency || 'MWK'})
              </label>
              <input
                type="number"
                min="0"
                step="0.000001"
                placeholder={`1 ${form.currency} = ? ${currentBusiness?.business?.base_currency || 'MWK'}`}
                value={form.exchange_rate}
                onChange={(e) => set('exchange_rate', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-gray-600">Leave blank to use a cached/Frankfurter rate where available. Enter the bank rate for MWK/ZMW/TZS/MZN pairs.</p>
            </div>
          )}

          {/* NEW: Product selector */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Product / Service <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <ProductSelect
              value={form.product_id}
              onChange={(v) => set('product_id', v)}
              products={products}
            />
          </div>

          {/* NEW: Quantity — only meaningful once a product is selected, since
              that's what drives the stock deduction at the chosen branch */}
          {form.product_id && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Quantity Sold</label>
              <input type="number" min="0" step="1" value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              <p className="mt-1 text-xs text-gray-600">Amount above is the total for all units — stock will reduce by this quantity.</p>
            </div>
          )}

          {/* NEW: Branch selector — only shown when business has branches */}
          {branches.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Branch <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <BranchSelect
                value={form.branch_id}
                onChange={(v) => set('branch_id', v)}
                branches={branches}
              />
            </div>
          )}

          {/* NEW: Department selector — only shown when business has departments */}
          {departments.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Department <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <DepartmentSelect
                value={form.department_id}
                onChange={(v) => set('department_id', v)}
                departments={departments}
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <input type="text" placeholder="e.g. 2 bags of maize — Lilongwe branch" value={form.description} onChange={(e) => set('description', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Payment Method</label>
              <select value={form.payment_method} onChange={(e) => set('payment_method', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Reference (optional)</label>
              <input type="text" placeholder="e.g. Receipt #001" value={form.reference} onChange={(e) => set('reference', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea rows={2} placeholder="Any additional notes..." value={form.notes} onChange={(e) => set('notes', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending}
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
          >
            {mutation.isPending ? 'Saving…' : 'Record Income'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invoice Builder Tab ───────────────────────────────────────────────────────

function InvoiceBuilderTab({ businessId, onSuccess }: { businessId: string; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const { data: branches = [] } = useBranches(businessId);
  const { data: departments = [] } = useDepartments(businessId);
  const { data: products = [] } = useAllProducts(businessId);

  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [form, setForm] = useState<InvoiceForm>({
    contact_id: '', invoice_number: '', issue_date: today(), due_date: '',
    notes: '', terms: 'Payment due within 30 days.', template: 'professional', project_code: '', lpo_number: '', payment_provider: '', payment_reference: '', branch_id: '', department_id: '', currency: currentBusiness?.business?.base_currency || 'MWK', exchange_rate: '',
    lines: [{ description: '', quantity: '1', unit_price: '', discount_percent: '0', tax_code: 'vat_standard', product_id: '' }],
  });

  const { data: contacts = [], refetch: refetchContacts } = useQuery({
    queryKey: ['contacts', businessId, 'customer'],
    queryFn: () => repos.contact.findByBusiness(businessId, 'customer'),
    enabled: Boolean(businessId),
  });

  useEffect(() => {
    repos.business.reserveNextInvoiceNumber(businessId).then((num) => {
      setForm((f) => ({ ...f, invoice_number: num }));
    });
   
  }, [businessId]);

  function setField(field: keyof Omit<InvoiceForm, 'lines'>, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setLine(idx: number, field: keyof InvoiceLine, value: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => {
        if (i !== idx) return l;
        const updated = { ...l, [field]: value };
        // Auto-fill unit_price from product's sale_price when product is selected
        if (field === 'product_id' && value) {
          const p = products.find((p) => p.id === value);
          if (p) {
            updated.description = updated.description || p.name;
            updated.unit_price  = updated.unit_price  || String(p.sale_price);
          }
        }
        return updated;
      }),
    }));
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { description: '', quantity: '1', unit_price: '', discount_percent: '0', tax_code: 'vat_standard', product_id: '' }],
    }));
  }

  function removeLine(idx: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  }

  const { business: businessData } = useBrandTheme();
  const isVatRegistered = businessData?.vat_registered ?? false;
  const effectiveVatRate = isVatRegistered ? VAT_STANDARD_RATE : 0;

  const lineCalcs = form.lines.map((l) => {
    const qty      = parseFloat(l.quantity) || 0;
    const price    = parseFloat(l.unit_price) || 0;
    const discPct  = parseFloat(l.discount_percent) || 0;
    const gross    = qty * price;
    const discountAmt = gross * discPct / 100;
    const subtotal = gross - discountAmt;
    const taxRate  = l.tax_code === 'vat_standard' ? effectiveVatRate : 0;
    const taxAmount = subtotal * taxRate;
    return { gross, discountAmt, subtotal, taxRate, taxAmount, lineTotal: subtotal + taxAmount };
  });

  const grossSubtotal = lineCalcs.reduce((s, l) => s + l.gross, 0);
  const totalDiscount = lineCalcs.reduce((s, l) => s + l.discountAmt, 0);
  const subtotal  = lineCalcs.reduce((s, l) => s + l.subtotal, 0);
  const vatAmount = lineCalcs.reduce((s, l) => s + l.taxAmount, 0);
  const total     = lineCalcs.reduce((s, l) => s + l.lineTotal, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.contact_id) throw new Error('Please select a customer');
      if (!form.invoice_number) throw new Error('Invoice number is required');
      const validLines = form.lines.filter((l) => l.description.trim() && parseFloat(l.unit_price) > 0);
      if (validLines.length === 0) throw new Error('Add at least one line item');

      const functionalCurrency = currentBusiness?.business?.base_currency || 'MWK';
      const originalCurrency = form.currency || functionalCurrency;
      const manualRate = form.exchange_rate ? parseFloat(form.exchange_rate) : null;
      const rate = await resolveTransactionRate({
        businessId,
        originalCurrency,
        functionalCurrency,
        date: form.issue_date,
        manualRate,
      });
      const functionalTotal = total * rate.rate;

      const { invoice: created } = await repos.invoice.createWithLines(
        {
          business_id:      businessId,
          invoice_number:   form.invoice_number,
          invoice_type:     'invoice',
          status:           'draft',
          contact_id:       form.contact_id,
          issue_date:       form.issue_date,
          due_date:         form.due_date || null,
          currency:         originalCurrency,
          exchange_rate:    rate.rate,
          original_currency: originalCurrency,
          original_amount:   total,
          functional_currency: functionalCurrency,
          functional_amount: functionalTotal,
          rate_date:        rate.rateDate,
          rate_is_stale:    rate.isStale,
          subtotal,
          discount_amount:  totalDiscount,
          discount_percent: grossSubtotal > 0 ? (totalDiscount / grossSubtotal) * 100 : 0,
          taxable_amount:   subtotal,
          vat_amount:       vatAmount,
          wht_amount:       0,
          total_amount:     total,
          amount_paid:      0,
          notes:            form.notes || null,
          terms:            form.terms || null,
          template:         form.template,
          project_code:     form.project_code || null,
          lpo_number:       form.lpo_number || null,
          payment_provider: form.payment_provider || null,
          payment_reference: form.payment_reference || null,
          branch_id:        form.branch_id || null,  // NEW
          department_id:    form.department_id || null,  // NEW
          created_by:       null,
        } as InsertDto<'invoices'>,
        validLines.map((l, idx) => {
          const qty      = parseFloat(l.quantity) || 1;
          const price    = parseFloat(l.unit_price) || 0;
          const lineSub  = qty * price * (1 - (parseFloat(l.discount_percent) || 0) / 100);
          const taxRate  = l.tax_code === 'vat_standard' ? effectiveVatRate : 0;
          const taxAmt   = lineSub * taxRate;
          const product  = l.product_id ? products.find((p) => p.id === l.product_id) : undefined;
          return {
            line_number:      idx + 1,
            description:      l.description,
            quantity:         qty,
            unit_price:       price,
            discount_percent: parseFloat(l.discount_percent) || 0,
            discount_amount: qty * price * ((parseFloat(l.discount_percent) || 0) / 100),
            tax_code:         l.tax_code,
            tax_rate:         taxRate,
            tax_amount:       taxAmt,
            line_total:       lineSub + taxAmt,
            product_id:       l.product_id || null,     // NEW
            account_id:       product?.sales_account_id ?? null,  // NEW: use product's sales account
          } as Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>;
        }),
      );

      // createWithLines returns the inserted row; no need to refetch the
      // whole invoice list to find it.
      if (created && created.status !== 'draft') {
        try {
          await createInvoiceReceivableEntry(
            businessId,
            created,
            form.branch_id || null,
            form.department_id || null,
          );
        } catch (err) {
          log.warn('Journal entry failed (non-critical)', { error: err });
        }

        // Reduce stock for every line that has a product selected, and post
        // the cost of those goods. On issue rather than on settlement — the
        // goods leave the shelf when the invoice is raised, regardless of
        // when the customer pays.
        await deductStockAndPostCogs(
          businessId,
          created,
          validLines
            .filter((l) => l.product_id)
            .map((l) => ({ productId: l.product_id, quantity: parseFloat(l.quantity) || 0 })),
          form.branch_id || null,
          form.department_id || null,
          null,
        );
      }
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Invoice created successfully.' });
      queryClient.invalidateQueries({ queryKey: ['income'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setTimeout(() => { setAlert(null); onSuccess(); }, 1500);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <FileText className="h-5 w-5 text-brand-500" />
          <h2 className="text-base font-semibold text-gray-900">New Invoice</h2>
        </div>

        {alert && (
          <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${alert.type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
            {alert.type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            {alert.message}
          </div>
        )}

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">Customer</label>
                <button type="button" onClick={() => setShowAddCustomer(true)}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700">
                  + New Customer
                </button>
              </div>
              <select value={form.contact_id} onChange={(e) => setField('contact_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">Select customer…</option>
                {contacts.map((c: { id: string; name: string }) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Invoice Number</label>
              <input type="text" value={form.invoice_number} onChange={(e) => setField('invoice_number', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Issue Date</label>
              <input type="date" value={form.issue_date} onChange={(e) => setField('issue_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => setField('due_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <label className="text-sm font-medium text-gray-700">Template<select value={form.template} onChange={e => setField('template', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="professional">Professional</option><option value="minimal">Minimal</option><option value="ngo">NGO / Donor</option><option value="government">Government</option></select></label>
            <label className="text-sm font-medium text-gray-700">Payment terms<select value={form.terms} onChange={e => setField('terms', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option>Net 7</option><option>Net 14</option><option>Net 30</option><option>Net 60</option></select></label>
            {form.template === 'ngo' && <label className="text-sm font-medium text-gray-700">Project code<input value={form.project_code} onChange={e => setField('project_code', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>}
            {form.template === 'government' && <label className="text-sm font-medium text-gray-700">LPO number<input value={form.lpo_number} onChange={e => setField('lpo_number', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>}
            <label className="text-sm font-medium text-gray-700">Mobile money<select value={form.payment_provider} onChange={e => setField('payment_provider', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"><option value="">None</option><option value="airtel_money">Airtel Money</option><option value="tnm_mpamba">TNM Mpamba</option></select></label>
            {form.payment_provider && <label className="text-sm font-medium text-gray-700">Till / payment reference<input value={form.payment_reference} onChange={e => setField('payment_reference', e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" /></label>}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Invoice Currency</label>
              <CurrencySelector
                value={form.currency || currentBusiness?.business?.base_currency || 'MWK'}
                onChange={(c) => setField('currency', c)}
              />
            </div>
            {(form.currency || currentBusiness?.business?.base_currency || 'MWK') !== (currentBusiness?.business?.base_currency || 'MWK') && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Exchange rate ({form.currency} → {currentBusiness?.business?.base_currency || 'MWK'})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.000001"
                  value={form.exchange_rate}
                  onChange={(e) => setField('exchange_rate', e.target.value)}
                  placeholder={`1 ${form.currency} = ? ${currentBusiness?.business?.base_currency || 'MWK'}`}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            )}
          </div>

          {/* NEW: Branch selector at invoice level */}
          {branches.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Branch <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <BranchSelect
                value={form.branch_id}
                onChange={(v) => setField('branch_id', v)}
                branches={branches}
              />
            </div>
          )}

          {/* NEW: Department selector at invoice level */}
          {departments.length > 0 && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Department <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <DepartmentSelect
                value={form.department_id}
                onChange={(v) => setField('department_id', v)}
                departments={departments}
              />
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Line Items</label>
              <button onClick={addLine} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <Plus className="h-3.5 w-3.5" /> Add Line
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-medium text-gray-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left">Product / Service</th>  {/* NEW column */}
                    <th scope="col" className="px-3 py-2 text-left">Description</th>
                    <th scope="col" className="px-3 py-2 text-right w-20">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right w-32">Unit Price</th>
                    <th scope="col" className="px-3 py-2 text-right w-20">Disc. %</th>
                    <th scope="col" className="px-3 py-2 text-center w-36">Tax</th>
                    <th scope="col" className="px-3 py-2 text-right w-32">Total</th>
                    <th scope="col" className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.lines.map((line, idx) => (
                    <tr key={idx}>
                      {/* NEW: per-line product picker */}
                      <td className="px-3 py-2 min-w-[160px]">
                        <ProductSelect
                          value={line.product_id}
                          onChange={(v) => setLine(idx, 'product_id', v)}
                          products={products}
                          placeholder="Select…"
                          className="w-full rounded bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input type="text" placeholder="Description" value={line.description}
                          onChange={(e) => setLine(idx, 'description', e.target.value)}
                          className="w-full rounded bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="1" value={line.quantity}
                          onChange={(e) => setLine(idx, 'quantity', e.target.value)}
                          aria-label="Quantity"
                          className="w-full rounded bg-transparent px-1 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-600" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" placeholder="0.00" value={line.unit_price}
                          onChange={(e) => setLine(idx, 'unit_price', e.target.value)}
                          aria-label="Unit price"
                          className="w-full rounded bg-transparent px-1 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-600" />
                      </td>
                      <td className="px-3 py-2"><input aria-label="Line discount percentage" type="number" min="0" max="100" value={line.discount_percent} onChange={(e) => setLine(idx, 'discount_percent', e.target.value)} className="w-full rounded bg-transparent px-1 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-600" /></td>
                      <td className="px-3 py-2">
                        <select value={line.tax_code} onChange={(e) => setLine(idx, 'tax_code', e.target.value)}
                          aria-label="Tax code"
                          className="w-full rounded bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-600">
                          {TAX_OPTIONS.map((t) => (
                            <option key={t.value} value={t.value}>
                              {t.value === 'vat_standard'
                                ? `VAT ${(effectiveVatRate * 100).toFixed(1).replace(/\.0$/, '')}%`
                                : t.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-medium">{formatMwkDetailed(lineCalcs[idx]?.lineTotal ?? 0)}</td>
                      <td className="px-2 py-2">
                        {form.lines.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="text-gray-400 hover:text-red-500 transition-colors">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              {totalDiscount > 0.005 ? (
                <>
                  <div className="flex justify-between text-gray-600"><span>Gross Subtotal</span><span>{formatMwkDetailed(grossSubtotal)}</span></div>
                  <div className="flex justify-between text-emerald-700"><span>Less: Discount</span><span>- {formatMwkDetailed(totalDiscount)}</span></div>
                  <div className="flex justify-between font-medium text-gray-900"><span>Net Subtotal</span><span>{formatMwkDetailed(subtotal)}</span></div>
                </>
              ) : (
                <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatMwkDetailed(subtotal)}</span></div>
              )}
              <div className="flex justify-between text-gray-600"><span>VAT ({VAT_STANDARD_RATE_PERCENT}%)</span><span>{formatMwkDetailed(vatAmount)}</span></div>
              <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900"><span>Total</span><span>{formatMwkDetailed(total)}</span></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
              <textarea rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Terms</label>
              <textarea rows={2} value={form.terms} onChange={(e) => setField('terms', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
              {mutation.isPending ? 'Saving…' : 'Create Invoice'}
            </button>
          </div>
        </div>
      </div>

      {showAddCustomer && (
        <AddContactModal
          contactType="customer"
          businessId={businessId}
          onClose={() => setShowAddCustomer(false)}
          onCreated={(id) => {
            refetchContacts().then(() => setField('contact_id', id));
            setShowAddCustomer(false);
          }}
        />
      )}
    </div>
  );
}


// ── Income List ───────────────────────────────────────────────────────────────

function IncomeList({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { tdClass, thClass } = useDensity();

  const onRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['invoices', 'income', businessId] });
  };

  const { containerRef, pullDistance, isRefreshing, progress } = usePullToRefresh({ onRefresh, disabled: !isMobile });

  const { data: invoices = [], isLoading, isError } = useQuery({
    queryKey: ['invoices', 'income', businessId],
    queryFn: () => repos.invoice.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  if (isLoading)
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />
        ))}
      </div>
    );
  if (isError)
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" />
        Failed to load income records.
      </div>
    );

  const incomeInvoices = invoices.filter((inv) => inv.invoice_type === 'invoice');
  if (incomeInvoices.length === 0)
    return (
      <EmptyState
        title="No income yet"
        description="Record your first income or create an invoice. Swipe actions will appear here."
        actionLabel="Record Income"
        onAction={() => (window.location.href = '/income?action=record')}
        variant="finance"
      />
    );

  return (
    <div ref={containerRef}>
      <PullToRefreshIndicator pullDistance={pullDistance} isRefreshing={isRefreshing} progress={progress} />
      {isMobile ? (
        <div className="space-y-3">
          {incomeInvoices.map((inv) => (
            <SwipeableRow
              key={inv.id}
              actions={[
                { label: 'View', icon: Eye, color: 'bg-gray-700', action: () => {} },
                { label: 'Paid', icon: CreditCard, color: 'bg-brand-500', action: () => {} },
              ]}
            >
              <div className="flex items-center justify-between rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-brand-700">{inv.invoice_number}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-500">{inv.notes || inv.po_number || inv.issue_date}</p>
                  <div className="mt-1">
                    <StatusBadge status={inv.status} />
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-gray-900">{formatMwkDetailed(inv.total_amount)}</p>
                  <p className="text-xs text-gray-500">{formatMwkDetailed(inv.amount_paid)} paid</p>
                </div>
              </div>
            </SwipeableRow>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className={`${thClass} text-left`}>Invoice #</th>
                  <th scope="col" className={`hidden sm:table-cell ${thClass} text-left`}>Date</th>
                  <th scope="col" className={`${thClass} text-left`}>Description / Contact</th>
                  <th scope="col" className={`${thClass} text-right`}>Amount</th>
                  <th scope="col" className={`hidden sm:table-cell ${thClass} text-right`}>Paid</th>
                  <th scope="col" className={`hidden sm:table-cell ${thClass} text-center`}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incomeInvoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50 transition-colors">
                    <td className={`${tdClass} font-medium text-brand-700`}>{inv.invoice_number}</td>
                    <td className={`hidden sm:table-cell ${tdClass} text-gray-500`}>{inv.issue_date}</td>
                    <td className={`${tdClass} font-medium text-gray-900`}>{inv.notes || inv.po_number || '—'}</td>
                    <td className={`${tdClass} text-right font-medium`}>{formatMwkDetailed(inv.total_amount)}</td>
                    <td className={`hidden sm:table-cell ${tdClass} text-right text-gray-500`}>{formatMwkDetailed(inv.amount_paid)}</td>
                    <td className={`hidden sm:table-cell ${tdClass} text-center`}>
                      <StatusBadge status={inv.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Page ──────────────────────────────────────────────────────────────────────

export function IncomePage() {
  const [searchParams] = useSearchParams();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId      = currentBusiness?.business?.id;

  const initialTab = (
    searchParams.get('action') === 'record'  ? 'quick'   :
    searchParams.get('action') === 'invoice' ? 'invoice' : 'list'
  ) as Tab;
  const [tab, setTab] = useState<Tab>(initialTab);

  const { data: invoices = [] } = useQuery({
    queryKey: ['invoices', 'income', businessId],
    queryFn: () => repos.invoice.findByBusiness(businessId!),
    enabled: Boolean(businessId),
  });

  const hasIncome = invoices.filter((i) => i.invoice_type === 'invoice').length > 0;

  if (!businessId) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-sm text-gray-500">No business selected.</p>
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Income</h1>
          <p className="mt-1 text-sm text-gray-500">
            Record income and manage invoices for {currentBusiness.business.name}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setTab('quick')}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Zap className="h-4 w-4 text-brand-500" />Quick Entry
          </button>
          <button onClick={() => setTab('invoice')}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
            <Plus className="h-4 w-4" />New Invoice
          </button>
        </div>
      </div>

      {(tab === 'quick' || tab === 'invoice') && (
        <div className="mb-6">
          <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
            <button onClick={() => setTab('quick')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'quick' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Zap className="h-4 w-4" />Quick Entry
            </button>
            <button onClick={() => setTab('invoice')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'invoice' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <FileText className="h-4 w-4" />Invoice Builder
            </button>
            <button onClick={() => setTab('list')}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {tab === 'quick'   && <QuickEntryTab    businessId={businessId} onSuccess={() => setTab('list')} />}
      {tab === 'invoice' && <InvoiceBuilderTab businessId={businessId} onSuccess={() => setTab('list')} />}
      {tab === 'list'    && (hasIncome ? <IncomeList businessId={businessId} /> : <IncomeEmptyState onRecord={() => setTab('quick')} />)}
    </div>
  );
}
