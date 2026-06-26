import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Receipt, Zap, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { InsertDto } from '@/dal/types/database';
import { createExpenseJournalEntry } from '@/services/journalService';

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type Tab = 'list' | 'quick' | 'expense';

interface QuickExpenseForm {
  expense_date: string;
  description: string;
  amount: string;
  payment_method: string;
  reference: string;
  notes: string;
}

interface ExpenseLine {
  description: string;
  quantity: string;
  unit_price: string;
  tax_code: string;
}

interface ExpenseForm {
  contact_id: string;
  expense_number: string;
  expense_date: string;
  due_date: string;
  notes: string;
  lines: ExpenseLine[];
}

const VAT_RATE = 0.175;

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money (Airtel/TNM)' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
  { value: 'other', label: 'Other' },
];

const TAX_OPTIONS = [
  { value: 'vat_standard', label: 'VAT 17.5%' },
  { value: 'vat_exempt', label: 'VAT Exempt' },
  { value: 'vat_zero', label: 'VAT Zero Rated' },
  { value: 'none', label: 'No Tax' },
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600',
    approved: 'bg-blue-50 text-blue-700',
    partially_paid: 'bg-amber-50 text-amber-700',
    paid: 'bg-brand-50 text-brand-700',
    void: 'bg-gray-100 text-gray-400',
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
      <button onClick={onRecord} className="mt-2 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
        <Plus className="h-4 w-4" />Record Expense
      </button>
    </div>
  );
}

function QuickExpenseTab({ businessId, onSuccess }: { businessId: string; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<QuickExpenseForm>({
    expense_date: today(), description: '', amount: '', payment_method: 'cash', reference: '', notes: '',
  });
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const mutation = useMutation({
    mutationFn: async (values: QuickExpenseForm) => {
      const amount = parseFloat(values.amount);
      if (isNaN(amount) || amount <= 0) throw new Error('Enter a valid amount');
      if (!values.description.trim()) throw new Error('Description is required');

      const expenseNumber = await repos.business.reserveNextExpenseNumber(businessId);

      await repos.expense.createWithLines(
        {
          business_id: businessId,
          expense_number: expenseNumber,
          expense_type: 'receipt',
          status: 'paid',
          expense_date: values.expense_date,
          currency: 'MWK',
          exchange_rate: 1,
          subtotal: amount,
          vat_amount: 0,
          wht_amount: 0,
          total_amount: amount,
          amount_paid: amount,
          reference: values.reference || null,
          notes: values.notes || null,
          created_by: null,
        } as InsertDto<'expenses'>,
        [{
          line_number: 1,
          description: values.description,
          quantity: 1,
          unit_price: amount,
          tax_code: 'none',
          tax_rate: 0,
          tax_amount: 0,
          line_total: amount,
        } as Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>],
      );

      // Create journal entry
      const allExpenses = await repos.expense.findByBusiness(businessId);
      const created = allExpenses.find((e) => e.expense_number === expenseNumber);
      if (created) {
        try {
          await createExpenseJournalEntry(
            businessId,
            expenseNumber,
            values.expense_date,
            amount,
            amount,
            0,
            'receipt',
            created.id,
          );
        } catch (err) {
          console.warn('Journal entry failed (non-critical):', err);
        }
      }
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Expense recorded successfully.' });
      setForm({ expense_date: today(), description: '', amount: '', payment_method: 'cash', reference: '', notes: '' });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setTimeout(() => { setAlert(null); onSuccess(); }, 1500);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  function set(field: keyof QuickExpenseForm, value: string) {
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

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
            <input type="text" placeholder="e.g. Office supplies, fuel, rent..." value={form.description} onChange={(e) => set('description', e.target.value)}
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
              <input type="text" placeholder="e.g. Receipt #002" value={form.reference} onChange={(e) => set('reference', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea rows={2} placeholder="Any additional notes..." value={form.notes} onChange={(e) => set('notes', e.target.value)}
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

function ExpenseBuilderTab({ businessId, onSuccess }: { businessId: string; onSuccess: () => void }) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm] = useState<ExpenseForm>({
    contact_id: '', expense_number: '', expense_date: today(), due_date: '', notes: '',
    lines: [{ description: '', quantity: '1', unit_price: '', tax_code: 'vat_standard' }],
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
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, [field]: value } : l) }));
  }

  function addLine() {
    setForm((f) => ({ ...f, lines: [...f.lines, { description: '', quantity: '1', unit_price: '', tax_code: 'vat_standard' }] }));
  }

  function removeLine(idx: number) {
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  }

  const lineCalcs = form.lines.map((l) => {
    const qty = parseFloat(l.quantity) || 0;
    const price = parseFloat(l.unit_price) || 0;
    const subtotal = qty * price;
    const taxRate = l.tax_code === 'vat_standard' ? VAT_RATE : 0;
    const taxAmount = subtotal * taxRate;
    return { subtotal, taxAmount, lineTotal: subtotal + taxAmount };
  });

  const subtotal = lineCalcs.reduce((s, l) => s + l.subtotal, 0);
  const vatAmount = lineCalcs.reduce((s, l) => s + l.taxAmount, 0);
  const total = lineCalcs.reduce((s, l) => s + l.lineTotal, 0);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.expense_number) throw new Error('Expense number is required');
      const validLines = form.lines.filter((l) => l.description.trim() && parseFloat(l.unit_price) > 0);
      if (validLines.length === 0) throw new Error('Add at least one line item');

      await repos.expense.createWithLines(
        {
          business_id: businessId,
          expense_number: form.expense_number,
          expense_type: 'bill',
          status: 'draft',
          contact_id: form.contact_id || null,
          expense_date: form.expense_date,
          due_date: form.due_date || null,
          currency: 'MWK',
          exchange_rate: 1,
          subtotal,
          vat_amount: vatAmount,
          wht_amount: 0,
          total_amount: total,
          amount_paid: 0,
          notes: form.notes || null,
          created_by: null,
        } as InsertDto<'expenses'>,
        validLines.map((l, idx) => {
          const qty = parseFloat(l.quantity) || 1;
          const price = parseFloat(l.unit_price) || 0;
          const lineSub = qty * price;
          const taxRate = l.tax_code === 'vat_standard' ? VAT_RATE : 0;
          const taxAmt = lineSub * taxRate;
          return {
            line_number: idx + 1, description: l.description, quantity: qty, unit_price: price,
            tax_code: l.tax_code, tax_rate: taxRate, tax_amount: taxAmt, line_total: lineSub + taxAmt,
          } as Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>;
        }),
      );

      // Create journal entry
      const allExpenses = await repos.expense.findByBusiness(businessId);
      const created = allExpenses.find((e) => e.expense_number === form.expense_number);
      if (created) {
        try {
          await createExpenseJournalEntry(
            businessId,
            form.expense_number,
            form.expense_date,
            total,
            subtotal,
            vatAmount,
            'bill',
            created.id,
          );
        } catch (err) {
          console.warn('Journal entry failed (non-critical):', err);
        }
      }
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Expense created successfully.' });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setTimeout(() => { setAlert(null); onSuccess(); }, 1500);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
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
                {suppliers.map((s: { id: string; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
                    <th className="px-3 py-2 text-left">Description</th>
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
                      <td className="px-3 py-2">
                        <input type="text" placeholder="Description" value={line.description} onChange={(e) => setLine(idx, 'description', e.target.value)}
                          className="w-full rounded bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="1" value={line.quantity} onChange={(e) => setLine(idx, 'quantity', e.target.value)}
                          className="w-full rounded bg-transparent px-1 py-0.5 text-right text-sm focus:outline-none focus:ring-1 focus:ring-brand-500" />
                      </td>
                      <td className="px-3 py-2">
                        <input type="number" min="0" step="0.01" placeholder="0.00" value={line.unit_price} onChange={(e) => setLine(idx, 'unit_price', e.target.value)}
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

function ExpenseList({ businessId }: { businessId: string }) {
  const { data: expenses = [], isLoading, isError } = useQuery({
    queryKey: ['expenses', businessId],
    queryFn: () => repos.expense.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (isError) return <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertCircle className="h-4 w-4 shrink-0" />Failed to load expenses.</div>;
  if (expenses.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left">Expense #</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">Description / Notes</th>
              <th className="px-4 py-3 text-right">Amount</th>
              <th className="px-4 py-3 text-right">Paid</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {expenses.map((exp) => (
              <tr key={exp.id} className="transition-colors hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-brand-700">{exp.expense_number}</td>
                <td className="px-4 py-3 text-gray-500">{exp.expense_date}</td>
                <td className="px-4 py-3 text-gray-700">{exp.notes ?? exp.reference ?? '—'}</td>
                <td className="px-4 py-3 text-right font-medium">{formatMwk(exp.total_amount)}</td>
                <td className="px-4 py-3 text-right text-gray-500">{formatMwk(exp.amount_paid)}</td>
                <td className="px-4 py-3 text-center"><StatusBadge status={exp.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ExpensesPage() {
  const [searchParams] = useSearchParams();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  const initialTab = (
    searchParams.get('action') === 'record' ? 'quick'
    : searchParams.get('action') === 'expense' ? 'expense'
    : 'list'
  ) as Tab;

  const [tab, setTab] = useState<Tab>(initialTab);

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', businessId],
    queryFn: () => repos.expense.findByBusiness(businessId!),
    enabled: Boolean(businessId),
  });

  const hasExpenses = expenses.length > 0;

  if (!businessId) return <div className="flex min-h-[60vh] items-center justify-center"><p className="text-sm text-gray-500">No business selected.</p></div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Expenses</h1>
          <p className="mt-1 text-sm text-gray-500">Track and manage expenses for {currentBusiness.business.name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setTab('quick')} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            <Zap className="h-4 w-4 text-brand-500" />Quick Entry
          </button>
          <button onClick={() => setTab('expense')} className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
            <Plus className="h-4 w-4" />New Expense
          </button>
        </div>
      </div>

      {(tab === 'quick' || tab === 'expense') && (
        <div className="mb-6">
          <div className="flex w-fit gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
            <button onClick={() => setTab('quick')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'quick' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Zap className="h-4 w-4" />Quick Entry
            </button>
            <button onClick={() => setTab('expense')} className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${tab === 'expense' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Receipt className="h-4 w-4" />Expense Builder
            </button>
            <button onClick={() => setTab('list')} className="rounded-lg px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">Cancel</button>
          </div>
        </div>
      )}

      {tab === 'quick' && <QuickExpenseTab businessId={businessId} onSuccess={() => setTab('list')} />}
      {tab === 'expense' && <ExpenseBuilderTab businessId={businessId} onSuccess={() => setTab('list')} />}
      {tab === 'list' && (hasExpenses ? <ExpenseList businessId={businessId} /> : <EmptyState onRecord={() => setTab('quick')} />)}
    </div>
  );
}
