import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt, Zap, Trash2, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { InsertDto, Row } from '@/dal/types/database';
import { createExpenseJournalEntry, type ExpenseAccountAllocation } from '@/services/journalService';

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tab = 'list' | 'quick' | 'expense';

// ── Shared hooks ──────────────────────────────────────────────────────────────

function useExpenseAccounts(businessId?: string) {
  return useQuery({
    queryKey: ['accounts_expense', businessId],
    queryFn: async () => {
      const all = await repos.account.findByBusiness(businessId!);
      return all
        .filter((a: Row<'accounts'>) => a.account_type === 'expense' && !a.is_group && a.is_active)
        .sort((a: Row<'accounts'>, b: Row<'accounts'>) => a.code.localeCompare(b.code));
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });
}

function useBranches(businessId?: string) {
  return useQuery({
    queryKey: ['branches', businessId],
    queryFn: async () => {
      const { data, error } = await (repos.inventory as any).client
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

// ── Stock addition on purchase ───────────────────────────────────────────────
// Mirror of IncomePage.tsx's deductStockForBranchSale, but for buying stock
// IN rather than selling it out. Non-blocking: if the branch has no linked
// inventory location, or a line has no product, we skip silently rather
// than failing the whole expense — stock tracking is additive, not a
// precondition for recording the purchase itself.

async function addStockForBranchPurchase(
  businessId: string,
  branchId: string | null,
  purchaseLines: { productId: string; quantity: number; unitCost: number }[],
  sourceId: string,
  reference: string,
  createdBy: string | null,
): Promise<void> {
  if (!branchId) return;
  const linesWithProducts = purchaseLines.filter((l) => l.productId && l.quantity > 0);
  if (linesWithProducts.length === 0) return;

  const locations = await repos.inventory.findLocations(businessId);
  const branchLocation = (locations as any[]).find((l) => l.branch_id === branchId);
  if (!branchLocation) {
    console.warn(`No inventory location linked to branch ${branchId} — stock not adjusted for this purchase.`);
    return;
  }

  const movements = linesWithProducts.map((line) => ({
    business_id: businessId,
    product_id: line.productId,
    location_id: branchLocation.id,
    movement_type: 'purchase' as const,
    movement_date: new Date().toISOString().slice(0, 10),
    // Positive: stock is arriving at this location as part of the purchase.
    quantity: line.quantity,
    unit_cost: line.unitCost,
    source_type: 'expense',
    source_id: sourceId,
    reference,
    created_by: createdBy,
  }));

  try {
    await repos.inventory.recordMovements(movements as any);
  } catch (err) {
    console.error('Stock addition failed for purchase', reference, err);
  }
}

function useAllProducts(businessId?: string) {
  return useQuery({
    queryKey: ['products_all', businessId],
    queryFn: () => repos.inventory.findAllProducts(businessId!),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

// ── Reusable selectors ────────────────────────────────────────────────────────

function AccountSelect({
  value,
  onChange,
  accounts,
  placeholder = 'Select category…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  accounts: Row<'accounts'>[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className ?? 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'}
    >
      <option value="">{placeholder}</option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
      ))}
    </select>
  );
}

function BranchSelect({
  value,
  onChange,
  branches,
  label = 'Cost Centre / Branch',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  branches: { id: string; name: string; code: string | null }[];
  label?: string;
  className?: string;
}) {
  if (branches.length === 0) return null;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">
        {label} <span className="font-normal text-gray-400">(optional)</span>
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className ?? 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500'}
      >
        <option value="">No cost centre</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}{b.code ? ` (${b.code})` : ''}
          </option>
        ))}
      </select>
    </div>
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

const VAT_RATE = 0.175;

const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money',  label: 'Mobile Money (Airtel/TNM)' },
  { value: 'cheque',        label: 'Cheque' },
  { value: 'card',          label: 'Card' },
  { value: 'other',         label: 'Other' },
];

const TAX_OPTIONS = [
  { value: 'vat_standard', label: 'VAT 17.5%' },
  { value: 'vat_exempt',   label: 'VAT Exempt' },
  { value: 'vat_zero',     label: 'VAT Zero Rated' },
  { value: 'none',         label: 'No Tax' },
];

// ── Form types ────────────────────────────────────────────────────────────────

interface QuickExpenseForm {
  expense_date:    string;
  description:     string;
  amount:          string;
  account_id:      string;
  payment_method:  string;
  reference:       string;
  notes:           string;
  include_vat:     boolean;
  product_id:      string;   // NEW
  branch_id:       string;   // NEW
  quantity:        string;   // NEW: units purchased, for stock addition
}

interface ExpenseLine {
  description: string;
  quantity:    string;
  unit_price:  string;
  tax_code:    string;
  account_id:  string;
  product_id:  string;   // NEW
}

interface ExpenseForm {
  contact_id:     string;
  expense_number: string;
  expense_date:   string;
  due_date:       string;
  notes:          string;
  branch_id:      string;   // NEW
  lines:          ExpenseLine[];
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft:           'bg-gray-100 text-gray-600',
    approved:        'bg-blue-50 text-blue-700',
    partially_paid:  'bg-amber-50 text-amber-700',
    paid:            'bg-brand-50 text-brand-700',
    void:            'bg-gray-100 text-gray-400',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'}`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

function EmptyState({ onRecord }: { onRecord: () => void }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
        <Receipt className="h-7 w-7 text-red-400" />
      </div>
      <h2 className="text-base font-semibold text-gray-900">No expenses recorded yet</h2>
      <p className="max-w-xs text-sm text-gray-500">Record your first expense to start tracking your business costs.</p>
      <button onClick={onRecord}
        className="mt-2 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
        <Plus className="h-4 w-4" />Record Expense
      </button>
    </div>
  );
}

// ── Quick Expense Tab ─────────────────────────────────────────────────────────

function QuickExpenseTab({ businessId, onSuccess }: { businessId: string; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useExpenseAccounts(businessId);
  const { data: branches = [] }  = useBranches(businessId);
  const { data: products = [] }  = useAllProducts(businessId);

  const [form, setForm] = useState<QuickExpenseForm>({
    expense_date: today(), description: '', amount: '', account_id: '',
    payment_method: 'cash', reference: '', notes: '', include_vat: false,
    product_id: '', branch_id: '', quantity: '1',
  });
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async (values: QuickExpenseForm) => {
      const rawAmount = parseFloat(values.amount);
      if (isNaN(rawAmount) || rawAmount <= 0) throw new Error('Enter a valid amount');
      if (!values.description.trim()) throw new Error('Description is required');
      if (!values.account_id) throw new Error('Please select an expense category');

      const netAmount   = values.include_vat ? rawAmount / 1.175 : rawAmount;
      const vatAmount   = values.include_vat ? rawAmount - netAmount : 0;
      const totalAmount = rawAmount;
      const qty         = parseFloat(values.quantity) || 1;

      const expenseNumber = await repos.business.reserveNextExpenseNumber(businessId);

      // Resolve COGS account from product if one is selected
      const selectedProduct = values.product_id
        ? products.find((p) => p.id === values.product_id)
        : undefined;
      const cogsAccountId = selectedProduct?.cogs_account_id ?? null;

      await repos.expense.createWithLines(
        {
          business_id:     businessId,
          expense_number:  expenseNumber,
          expense_type:    'receipt',
          status:          'paid',
          expense_date:    values.expense_date,
          currency:        'MWK',
          exchange_rate:   1,
          subtotal:        netAmount,
          vat_amount:      vatAmount,
          wht_amount:      0,
          total_amount:    totalAmount,
          amount_paid:     totalAmount,
          reference:       values.reference || null,
          notes:           values.notes || null,
          // NEW: cost centre / branch flows from form into expense header
          // and then into journal_entries.branch_id for branch P&L reporting
          branch_id:       values.branch_id || null,
          created_by:      null,
        } as InsertDto<'expenses'>,
        [{
          line_number:  1,
          description:  values.description,
          quantity:     qty,
          unit_price:   qty > 0 ? netAmount / qty : netAmount,
          tax_code:     values.include_vat ? 'vat_standard' : 'none',
          tax_rate:     values.include_vat ? VAT_RATE : 0,
          tax_amount:   vatAmount,
          line_total:   totalAmount,
          account_id:   values.account_id,
          // NEW: link the expense line to the product/service being purchased
          // so inventory, COGS, and product-level reports stay connected
          product_id:   values.product_id || null,
          // If a COGS account exists on the product, override the category
          // account so COGS posts correctly (e.g. buying bags of maize)
          ...(cogsAccountId ? { account_id: cogsAccountId } : {}),
        } as Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>],
      );

      const allExpenses = await repos.expense.findByBusiness(businessId);
      const created     = allExpenses.find((e) => e.expense_number === expenseNumber);
      if (!created) return;

      try {
        const allocations: ExpenseAccountAllocation[] = [{
          accountId:   cogsAccountId ?? values.account_id,
          amount:      netAmount,
          description: values.description,
        }];
        const journalEntryId = await createExpenseJournalEntry(
          businessId,
          expenseNumber,
          values.expense_date,
          totalAmount,
          allocations,
          vatAmount,
          'receipt',
          created.id,
          values.branch_id || null,  // NEW: pass cost centre to journal entry
        );
        await (repos.expense as any).update(created.id, { journal_entry_id: journalEntryId });

        // NEW: if a branch + product were selected, add stock at that
        // branch's linked location.
        await addStockForBranchPurchase(
          businessId,
          values.branch_id || null,
          [{ productId: values.product_id, quantity: qty, unitCost: qty > 0 ? netAmount / qty : netAmount }],
          created.id,
          expenseNumber,
          null,
        );
      } catch (err) {
        console.error('Journal entry failed for', expenseNumber, err);
        throw new Error(
          `Expense saved, but posting to the ledger failed: ${(err as Error).message}. ` +
          `It will show as "Needs Posting" — you can retry from the expense list.`,
        );
      }
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Expense recorded and posted successfully.' });
      setForm({
        expense_date: today(), description: '', amount: '', account_id: '',
        payment_method: 'cash', reference: '', notes: '', include_vat: false,
        product_id: '', branch_id: '', quantity: '1',
      });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setTimeout(() => { setAlert(null); onSuccess(); }, 1500);
    },
    onError: (err: Error) => {
      setAlert({ type: 'error', message: err.message });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
  });

  function set(field: keyof QuickExpenseForm, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <Zap className="h-5 w-5 text-brand-500" />
          <h2 className="text-base font-semibold text-gray-900">Quick Expense Entry</h2>
        </div>

        {alert && <Alert type={alert.type} message={alert.message} />}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input type="date" value={form.expense_date} onChange={(e) => set('expense_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount (MWK)</label>
              <input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => set('amount', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          {/* NEW: Product / service selector */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Product / Service (COGS) <span className="font-normal text-gray-400">(optional)</span>
            </label>
            <ProductSelect
              value={form.product_id}
              onChange={(v) => {
                set('product_id', v);
                // Auto-select COGS account from product if available
                if (v) {
                  const p = products.find((p) => p.id === v);
                  if (p?.cogs_account_id && !form.account_id) {
                    set('account_id', p.cogs_account_id);
                  }
                }
              }}
              products={products}
              placeholder="Select product being purchased…"
            />
            {form.product_id && products.find((p) => p.id === form.product_id)?.cogs_account_id && (
              <p className="mt-1 text-xs text-gray-400">
                COGS account auto-selected from product. Override below if needed.
              </p>
            )}
          </div>

          {/* NEW: Quantity — drives stock addition at the chosen branch */}
          {form.product_id && (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Quantity Purchased</label>
              <input type="number" min="0" step="1" value={form.quantity}
                onChange={(e) => set('quantity', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              <p className="mt-1 text-xs text-gray-400">Amount above is the total for all units — stock will increase by this quantity.</p>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Category</label>
            <AccountSelect value={form.account_id} onChange={(v) => set('account_id', v)} accounts={accounts} />
          </div>

          {/* NEW: Cost centre / branch selector */}
          <BranchSelect
            value={form.branch_id}
            onChange={(v) => set('branch_id', v)}
            branches={branches}
          />

          <div className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <input type="checkbox" id="include_vat" checked={form.include_vat}
              onChange={(e) => set('include_vat', e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-500" />
            <label htmlFor="include_vat" className="text-sm text-gray-700">
              Amount includes VAT (17.5%) — split automatically
            </label>
          </div>

          {form.include_vat && form.amount && (
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              Net: MK {(parseFloat(form.amount) / 1.175).toFixed(2)} ·{' '}
              VAT: MK {(parseFloat(form.amount) - parseFloat(form.amount) / 1.175).toFixed(2)}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <input type="text" placeholder="e.g. 10 bags of maize — Blantyre branch" value={form.description}
              onChange={(e) => set('description', e.target.value)}
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
              <input type="text" placeholder="e.g. Receipt #002" value={form.reference}
                onChange={(e) => set('reference', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea rows={2} placeholder="Any additional notes..." value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}
            className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : 'Record Expense'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Expense Builder Tab ───────────────────────────────────────────────────────

function ExpenseBuilderTab({ businessId, onSuccess }: { businessId: string; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const { data: accounts = [] } = useExpenseAccounts(businessId);
  const { data: branches = [] }  = useBranches(businessId);
  const { data: products = [] }  = useAllProducts(businessId);

  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm]   = useState<ExpenseForm>({
    contact_id: '', expense_number: '', expense_date: today(), due_date: '', notes: '',
    branch_id: '',
    lines: [{ description: '', quantity: '1', unit_price: '', tax_code: 'vat_standard', account_id: '', product_id: '' }],
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['contacts', 'suppliers', businessId],
    queryFn: () => repos.contact.findByBusiness(businessId, 'supplier'),
    enabled: Boolean(businessId),
  });

  useState(() => {
    repos.business.reserveNextExpenseNumber(businessId).then((num) => {
      setForm((f) => ({ ...f, expense_number: num }));
    });
  });

  function setField(field: keyof Omit<ExpenseForm, 'lines'>, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function setLine(idx: number, field: keyof ExpenseLine, value: string) {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, i) => {
        if (i !== idx) return l;
        const updated = { ...l, [field]: value };
        // When product is selected: auto-fill description and COGS account
        if (field === 'product_id' && value) {
          const p = products.find((p) => p.id === value);
          if (p) {
            if (!updated.description) updated.description = p.name;
            if (!updated.unit_price)  updated.unit_price  = String(p.purchase_price);
            if (p.cogs_account_id && !updated.account_id) updated.account_id = p.cogs_account_id;
          }
        }
        return updated;
      }),
    }));
  }

  function addLine() {
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { description: '', quantity: '1', unit_price: '', tax_code: 'vat_standard', account_id: '', product_id: '' }],
    }));
  }

  function removeLine(idx: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  }

  const lineCalcs = form.lines.map((l) => {
    const qty      = parseFloat(l.quantity) || 0;
    const price    = parseFloat(l.unit_price) || 0;
    const subtotal = qty * price;
    const taxRate  = l.tax_code === 'vat_standard' ? VAT_RATE : 0;
    const taxAmount = subtotal * taxRate;
    return { subtotal, taxAmount, lineTotal: subtotal + taxAmount };
  });

  const subtotal  = lineCalcs.reduce((s, l) => s + l.subtotal, 0);
  const vatAmount = lineCalcs.reduce((s, l) => s + l.taxAmount, 0);
  const total     = lineCalcs.reduce((s, l) => s + l.lineTotal, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.expense_number) throw new Error('Expense number is required');
      const validLines = form.lines.filter((l) => l.description.trim() && parseFloat(l.unit_price) > 0);
      if (validLines.length === 0) throw new Error('Add at least one line item');
      if (validLines.some((l) => !l.account_id)) throw new Error('Every line needs an expense category');

      await repos.expense.createWithLines(
        {
          business_id:    businessId,
          expense_number: form.expense_number,
          expense_type:   'bill',
          status:         'draft',
          contact_id:     form.contact_id || null,
          expense_date:   form.expense_date,
          due_date:       form.due_date || null,
          currency:       'MWK',
          exchange_rate:  1,
          subtotal,
          vat_amount:     vatAmount,
          wht_amount:     0,
          total_amount:   total,
          amount_paid:    0,
          notes:          form.notes || null,
          branch_id:      form.branch_id || null,  // NEW: cost centre
          created_by:     null,
        } as InsertDto<'expenses'>,
        validLines.map((l, idx) => {
          const qty      = parseFloat(l.quantity) || 1;
          const price    = parseFloat(l.unit_price) || 0;
          const lineSub  = qty * price;
          const taxRate  = l.tax_code === 'vat_standard' ? VAT_RATE : 0;
          const taxAmt   = lineSub * taxRate;
          const product  = l.product_id ? products.find((p) => p.id === l.product_id) : undefined;
          return {
            line_number: idx + 1,
            description: l.description,
            quantity:    qty,
            unit_price:  price,
            tax_code:    l.tax_code,
            tax_rate:    taxRate,
            tax_amount:  taxAmt,
            line_total:  lineSub + taxAmt,
            account_id:  product?.cogs_account_id ?? l.account_id,  // COGS overrides if product has it
            product_id:  l.product_id || null,   // NEW
          } as Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>;
        }),
      );

      const allExpenses = await repos.expense.findByBusiness(businessId);
      const created     = allExpenses.find((e) => e.expense_number === form.expense_number);
      if (!created) return;

      try {
        // Group allocations by effective account (COGS account takes priority)
        const allocationMap = new Map<string, number>();
        for (const l of validLines) {
          const qty     = parseFloat(l.quantity) || 1;
          const price   = parseFloat(l.unit_price) || 0;
          const net     = qty * price;
          const product = l.product_id ? products.find((p) => p.id === l.product_id) : undefined;
          const acctId  = product?.cogs_account_id ?? l.account_id;
          allocationMap.set(acctId, (allocationMap.get(acctId) ?? 0) + net);
        }
        const allocations: ExpenseAccountAllocation[] = Array.from(allocationMap.entries())
          .map(([accountId, amount]) => ({ accountId, amount }));

        const journalEntryId = await createExpenseJournalEntry(
          businessId,
          form.expense_number,
          form.expense_date,
          total,
          allocations,
          vatAmount,
          'bill',
          created.id,
          form.branch_id || null,  // NEW: cost centre flows to journal entry
        );
        await (repos.expense as any).update(created.id, { journal_entry_id: journalEntryId });

        // NEW: add stock for every line that has a product selected.
        await addStockForBranchPurchase(
          businessId,
          form.branch_id || null,
          validLines
            .filter((l) => l.product_id)
            .map((l) => ({
              productId: l.product_id,
              quantity: parseFloat(l.quantity) || 0,
              unitCost: parseFloat(l.unit_price) || 0,
            })),
          created.id,
          form.expense_number,
          null,
        );
      } catch (err) {
        console.error('Journal entry failed for', form.expense_number, err);
        throw new Error(
          `Expense saved, but posting to the ledger failed: ${(err as Error).message}. ` +
          `It will show as "Needs Posting" — you can retry from the expense list.`,
        );
      }
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Expense created and posted successfully.' });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setTimeout(() => { setAlert(null); onSuccess(); }, 1500);
    },
    onError: (err: Error) => {
      setAlert({ type: 'error', message: err.message });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <Receipt className="h-5 w-5 text-brand-500" />
          <h2 className="text-base font-semibold text-gray-900">New Expense / Supplier Bill</h2>
        </div>

        {alert && <Alert type={alert.type} message={alert.message} />}

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Supplier (optional)</label>
              <select value={form.contact_id} onChange={(e) => setField('contact_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">Select supplier…</option>
                {suppliers.map((s: { id: string; name: string }) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Expense Number</label>
              <input type="text" value={form.expense_number} onChange={(e) => setField('expense_number', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Expense Date</label>
              <input type="date" value={form.expense_date} onChange={(e) => setField('expense_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Due Date (optional)</label>
              <input type="date" value={form.due_date} onChange={(e) => setField('due_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          {/* NEW: Cost centre selector at bill header level */}
          <BranchSelect
            value={form.branch_id}
            onChange={(v) => setField('branch_id', v)}
            branches={branches}
          />

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Line Items</label>
              <button onClick={addLine} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <Plus className="h-3.5 w-3.5" /> Add Line
              </button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Product / Service</th>  {/* NEW */}
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="w-40 px-3 py-2 text-left">Category</th>
                    <th className="w-20 px-3 py-2 text-right">Qty</th>
                    <th className="w-32 px-3 py-2 text-right">Unit Price</th>
                    <th className="w-36 px-3 py-2 text-center">Tax</th>
                    <th className="w-32 px-3 py-2 text-right">Total</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {form.lines.map((line, idx) => (
                    <tr key={idx}>
                      {/* NEW: per-line product picker */}
                      <td className="px-3 py-2 min-w-[150px]">
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
                        <AccountSelect
                          value={line.account_id}
                          onChange={(v) => setLine(idx, 'account_id', v)}
                          accounts={accounts}
                          placeholder="Category…"
                          className="w-full rounded bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="1" value={line.quantity}
                          onChange={(e) => setLine(idx, 'quantity', e.target.value)}
                          className="w-full rounded bg-transparent px-1 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-500" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" placeholder="0.00" value={line.unit_price}
                          onChange={(e) => setLine(idx, 'unit_price', e.target.value)}
                          className="w-full rounded bg-transparent px-1 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-500" />
                      </td>
                      <td className="px-3 py-2">
                        <select value={line.tax_code} onChange={(e) => setLine(idx, 'tax_code', e.target.value)}
                          className="w-full rounded bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500">
                          {TAX_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-right text-sm font-medium">{formatMwk(lineCalcs[idx]?.lineTotal ?? 0)}</td>
                      <td className="px-2 py-2">
                        {form.lines.length > 1 && (
                          <button onClick={() => removeLine(idx)} className="text-gray-400 transition-colors hover:text-red-500">
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
              <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>{formatMwk(subtotal)}</span></div>
              <div className="flex justify-between text-gray-600"><span>VAT (17.5%)</span><span>{formatMwk(vatAmount)}</span></div>
              <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900"><span>Total</span><span>{formatMwk(total)}</span></div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <div className="flex justify-end">
            <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
              className="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
              {mutation.isPending ? 'Saving…' : 'Create Expense'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Retry posting ─────────────────────────────────────────────────────────────

function useRetryPosting(businessId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (expense: Row<'expenses'>) => {
      const { data: lines, error } = await (repos.expense as any).client
        .from('expense_lines')
        .select('*')
        .eq('expense_id', expense.id);
      if (error) throw new Error(error.message);
      if (!lines || lines.length === 0) throw new Error('No line items found for this expense.');
      if (lines.some((l: Row<'expense_lines'>) => !l.account_id)) {
        throw new Error('This expense has line(s) with no category — edit it before retrying.');
      }
      const allocationMap = new Map<string, number>();
      for (const l of lines as Row<'expense_lines'>[]) {
        const acctId = l.account_id!;
        allocationMap.set(acctId, (allocationMap.get(acctId) ?? 0) + Number(l.unit_price) * Number(l.quantity));
      }
      const allocations: ExpenseAccountAllocation[] = Array.from(allocationMap.entries())
        .map(([accountId, amount]) => ({ accountId, amount }));

      const journalEntryId = await createExpenseJournalEntry(
        businessId,
        expense.expense_number,
        expense.expense_date,
        Number(expense.total_amount),
        allocations,
        Number(expense.vat_amount),
        expense.expense_type,
        expense.id,
        (expense as any).branch_id ?? null,  // preserve branch on retry
      );
      await (repos.expense as any).update(expense.id, { journal_entry_id: journalEntryId });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

// ── Expense List ──────────────────────────────────────────────────────────────

function ExpenseList({ businessId }: { businessId: string }) {
  const { data: expenses = [], isLoading, isError } = useQuery({
    queryKey: ['expenses', businessId],
    queryFn: () => repos.expense.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });
  const retry = useRetryPosting(businessId);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  if (isLoading) return <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (isError) return (
    <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertCircle className="h-4 w-4 shrink-0" />Failed to load expenses.
    </div>
  );
  if (expenses.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Expense #</th>
              <th className="hidden sm:table-cell px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Description / Notes</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="hidden sm:table-cell px-4 py-3 text-right">Paid</th>
              <th className="hidden sm:table-cell px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Posting</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {expenses.map((exp: Row<'expenses'>) => {
              const needsPosting = !exp.journal_entry_id;
              return (
                <tr key={exp.id} className="transition-colors hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-brand-700">{exp.expense_number}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-500">{exp.expense_date}</td>
                  <td className="px-4 py-3 text-gray-700">{exp.notes ?? exp.reference ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMwk(exp.total_amount)}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-500">{formatMwk(exp.amount_paid)}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-center"><StatusBadge status={exp.status} /></td>
                  <td className="px-4 py-3 text-center">
                    {needsPosting ? (
                      <button
                        onClick={() => { setRetryingId(exp.id); retry.mutate(exp, { onSettled: () => setRetryingId(null) }); }}
                        disabled={retry.isPending && retryingId === exp.id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-60"
                        title="Not posted to ledger — click to retry."
                      >
                        <RefreshCw className={`h-3 w-3 ${retry.isPending && retryingId === exp.id ? 'animate-spin' : ''}`} />
                        Needs Posting
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-brand-600">
                        <CheckCircle className="h-3 w-3" /> Posted
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {retry.isError && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          Retry failed: {(retry.error as Error).message}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function ExpensesPage() {
  const [searchParams]  = useSearchParams();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId      = currentBusiness?.business?.id;

  const initialTab = (
    searchParams.get('action') === 'record'  ? 'quick'   :
    searchParams.get('action') === 'expense' ? 'expense' : 'list'
  ) as Tab;

  const [tab, setTab] = useState<Tab>(initialTab);

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', businessId],
    queryFn: () => repos.expense.findByBusiness(businessId!),
    enabled: Boolean(businessId),
  });

  const hasExpenses = expenses.length > 0;

  if (!businessId) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-sm text-gray-500">No business selected.</p>
    </div>
  );

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
          <p className="mt-1 text-sm text-gray-500">Track and manage expenses for {currentBusiness.business.name}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setTab('quick')}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Zap className="h-4 w-4 text-brand-500" />Quick Entry
          </button>
          <button onClick={() => setTab('expense')}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
            <Plus className="h-4 w-4" />New Expense
          </button>
        </div>
      </div>

      {(tab === 'quick' || tab === 'expense') && (
        <div className="mb-6">
          <div className="flex w-fit gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <button onClick={() => setTab('quick')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'quick' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Zap className="h-4 w-4" />Quick Entry
            </button>
            <button onClick={() => setTab('expense')}
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'expense' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Receipt className="h-4 w-4" />Expense Builder
            </button>
            <button onClick={() => setTab('list')}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {tab === 'quick'   && <QuickExpenseTab   businessId={businessId} onSuccess={() => setTab('list')} />}
      {tab === 'expense' && <ExpenseBuilderTab  businessId={businessId} onSuccess={() => setTab('list')} />}
      {tab === 'list'    && (hasExpenses ? <ExpenseList businessId={businessId} /> : <EmptyState onRecord={() => setTab('quick')} />)}
    </div>
  );
}
