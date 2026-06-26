import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, AlertCircle, CheckCircle,
  X, Search, ChevronDown, ChevronRight, BookOpen,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto, AccountType, AccountSubtype } from '@/dal/types/database';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES: { value: AccountType; label: string; color: string }[] = [
  { value: 'asset',     label: 'Asset',     color: 'bg-blue-50 text-blue-700' },
  { value: 'liability', label: 'Liability', color: 'bg-red-50 text-red-700' },
  { value: 'equity',    label: 'Equity',    color: 'bg-purple-50 text-purple-700' },
  { value: 'income',    label: 'Income',    color: 'bg-brand-50 text-brand-700' },
  { value: 'expense',   label: 'Expense',   color: 'bg-amber-50 text-amber-700' },
];

const ACCOUNT_SUBTYPES: { value: AccountSubtype; label: string; type: AccountType }[] = [
  { value: 'current_asset',            label: 'Current Asset',              type: 'asset' },
  { value: 'non_current_asset',        label: 'Non-Current Asset',          type: 'asset' },
  { value: 'fixed_asset',              label: 'Fixed Asset',                type: 'asset' },
  { value: 'current_liability',        label: 'Current Liability',          type: 'liability' },
  { value: 'non_current_liability',    label: 'Non-Current Liability',      type: 'liability' },
  { value: 'share_capital',            label: 'Share Capital',              type: 'equity' },
  { value: 'retained_earnings',        label: 'Retained Earnings',          type: 'equity' },
  { value: 'reserves',                 label: 'Reserves',                   type: 'equity' },
  { value: 'revenue',                  label: 'Revenue',                    type: 'income' },
  { value: 'other_income',             label: 'Other Income',               type: 'income' },
  { value: 'cost_of_sales',            label: 'Cost of Sales',              type: 'expense' },
  { value: 'operating_expense',        label: 'Operating Expense',          type: 'expense' },
  { value: 'finance_cost',             label: 'Finance Cost',               type: 'expense' },
  { value: 'tax_expense',              label: 'Tax Expense',                type: 'expense' },
  { value: 'depreciation_amortisation',label: 'Depreciation & Amortisation',type: 'expense' },
];

const NORMAL_BALANCE: Record<AccountType, string> = {
  asset: 'debit', liability: 'credit', equity: 'credit', income: 'credit', expense: 'debit',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeColor(type: string) {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.color ?? 'bg-gray-100 text-gray-600';
}

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Alert ─────────────────────────────────────────────────────────────────────

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
      type === 'success' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

// ── Account Form ──────────────────────────────────────────────────────────────

interface AccountForm {
  code: string;
  name: string;
  description: string;
  account_type: AccountType;
  account_subtype: AccountSubtype | '';
  is_group: boolean;
  is_bank_account: boolean;
  bank_name: string;
  bank_account_number: string;
  bank_branch: string;
  opening_balance: string;
  opening_balance_date: string;
  notes: string;
}

const EMPTY_FORM: AccountForm = {
  code: '', name: '', description: '', account_type: 'asset', account_subtype: '',
  is_group: false, is_bank_account: false, bank_name: '', bank_account_number: '',
  bank_branch: '', opening_balance: '0', opening_balance_date: '', notes: '',
};

function AccountModal({
  existing, businessId, onClose,
}: {
  existing?: Row<'accounts'>;
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AccountForm>(
    existing ? {
      code: existing.code ?? '',
      name: existing.name ?? '',
      description: existing.description ?? '',
      account_type: existing.account_type as AccountType,
      account_subtype: (existing.account_subtype as AccountSubtype) ?? '',
      is_group: existing.is_group ?? false,
      is_bank_account: existing.is_bank_account ?? false,
      bank_name: existing.bank_name ?? '',
      bank_account_number: existing.bank_account_number ?? '',
      bank_branch: existing.bank_branch ?? '',
      opening_balance: String(existing.opening_balance ?? '0'),
      opening_balance_date: existing.opening_balance_date ?? '',
      notes: existing.notes ?? '',
    } : { ...EMPTY_FORM },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof AccountForm, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const availableSubtypes = ACCOUNT_SUBTYPES.filter((s) => s.type === form.account_type);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.code.trim()) throw new Error('Account code is required');
      if (!form.name.trim()) throw new Error('Account name is required');

      const payload: InsertDto<'accounts'> = {
        business_id: businessId,
        code: form.code.trim(),
        name: form.name.trim(),
        description: form.description || null,
        account_type: form.account_type,
        account_subtype: (form.account_subtype as AccountSubtype) || null,
        normal_balance: NORMAL_BALANCE[form.account_type],
        is_group: form.is_group,
        is_system: false,
        is_bank_account: form.is_bank_account,
        bank_name: form.is_bank_account ? form.bank_name || null : null,
        bank_account_number: form.is_bank_account ? form.bank_account_number || null : null,
        bank_branch: form.is_bank_account ? form.bank_branch || null : null,
        currency: 'MWK',
        opening_balance: parseFloat(form.opening_balance) || 0,
        opening_balance_date: form.opening_balance_date || null,
        notes: form.notes || null,
        is_active: true,
      };

      if (existing) {
        const { error } = await repos.account['client']
          .from('accounts').update(payload as never).eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await repos.account['client']
          .from('accounts').insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setAlert({ type: 'success', message: existing ? 'Account updated.' : 'Account created.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{existing ? 'Edit Account' : 'New Account'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[72vh] overflow-y-auto px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Code *</label>
              <input type="text" value={form.code} onChange={(e) => set('code', e.target.value)}
                placeholder="e.g. 1100"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Cash on Hand"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Type *</label>
              <select value={form.account_type}
                onChange={(e) => { set('account_type', e.target.value); set('account_subtype', ''); }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Subtype</label>
              <select value={form.account_subtype} onChange={(e) => set('account_subtype', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">— None —</option>
                {availableSubtypes.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Opening Balance (MWK)</label>
              <input type="number" step="0.01" value={form.opening_balance}
                onChange={(e) => set('opening_balance', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Opening Balance Date</label>
              <input type="date" value={form.opening_balance_date}
                onChange={(e) => set('opening_balance_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Description (optional)</label>
              <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2 flex gap-6">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.is_group} onChange={(e) => set('is_group', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                Group account (no postings)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.is_bank_account} onChange={(e) => set('is_bank_account', e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                Bank / mobile money account
              </label>
            </div>

            {form.is_bank_account && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Bank Name</label>
                  <input type="text" value={form.bank_name} onChange={(e) => set('bank_name', e.target.value)}
                    placeholder="e.g. National Bank of Malawi"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">Account Number</label>
                  <input type="text" value={form.bank_account_number} onChange={(e) => set('bank_account_number', e.target.value)}
                    placeholder="e.g. 0123456789"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
                <div className="col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700">Branch</label>
                  <input type="text" value={form.bank_branch} onChange={(e) => set('bank_branch', e.target.value)}
                    placeholder="e.g. Lilongwe City Branch"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                </div>
              </>
            )}

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
              <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Create Account'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ name, onConfirm, onCancel, isPending }: {
  name: string; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">Delete account?</h3>
        <p className="mt-2 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{name}</span> will be removed. System accounts cannot be deleted.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60 transition-colors">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Account Row ───────────────────────────────────────────────────────────────

function AccountRow({ account, depth, onEdit, onDelete }: {
  account: Row<'accounts'>; depth: number;
  onEdit: () => void; onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
          {account.is_group
            ? <button onClick={() => setExpanded((e) => !e)} className="text-gray-400 hover:text-gray-600">
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            : <span className="w-3.5" />}
          <span className={`font-mono text-xs text-gray-400 mr-2`}>{account.code}</span>
          <span className={`${account.is_group ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>{account.name}</span>
          {account.is_bank_account && (
            <span className="ml-2 rounded-full bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">Bank</span>
          )}
          {account.is_system && (
            <span className="ml-1 rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400">System</span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500">{account.account_subtype?.replace(/_/g, ' ') ?? '—'}</td>
      <td className="px-4 py-2.5 text-right text-sm text-gray-600">{formatMwk(Number(account.opening_balance))}</td>
      <td className="px-4 py-2.5 text-center">
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${typeColor(account.account_type)}`}>
          {account.account_type}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center justify-center gap-1">
          {!account.is_system && (
            <>
              <button onClick={onEdit}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={onDelete}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AccountsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<AccountType | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'accounts'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'accounts'> | undefined>();

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts', businessId],
    queryFn: () => repos.account.findByBusiness(businessId!),
    enabled: Boolean(businessId),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await repos.account['client']
        .from('accounts')
        .update({ deleted_at: new Date().toISOString(), is_active: false } as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      setDeleting(undefined);
    },
  });

  const filtered = accounts.filter((a) => {
    const matchesSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.code.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'all' || a.account_type === filterType;
    return matchesSearch && matchesType;
  });

  // Group by type for display
  const grouped = ACCOUNT_TYPES.map((type) => ({
    ...type,
    accounts: filtered.filter((a) => a.account_type === type.value)
      .sort((a, b) => a.code.localeCompare(b.code)),
  })).filter((g) => g.accounts.length > 0);

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">Manage accounts for {currentBusiness.business.name}</p>
        </div>
        <button
          onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
        >
          <Plus className="h-4 w-4" />New Account
        </button>
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name or code…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <div className="flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 flex-wrap">
          <button onClick={() => setFilterType('all')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filterType === 'all' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            All
          </button>
          {ACCOUNT_TYPES.map((t) => (
            <button key={t.value} onClick={() => setFilterType(t.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${filterType === t.value ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {ACCOUNT_TYPES.map((type) => {
          const count = accounts.filter((a) => a.account_type === type.value).length;
          return (
            <div key={type.value} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <p className="text-xs text-gray-500 capitalize">{type.label}</p>
              <p className="mt-1 text-xl font-semibold text-gray-900">{count}</p>
              <p className="text-xs text-gray-400">accounts</p>
            </div>
          );
        })}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-3">{[...Array(8)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : grouped.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <BookOpen className="h-7 w-7 text-brand-400" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">{search ? 'No accounts match your search' : 'No accounts yet'}</h2>
          {!search && (
            <button onClick={() => { setEditing(undefined); setShowModal(true); }}
              className="mt-1 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
              <Plus className="h-4 w-4" />New Account
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.value} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className={`flex items-center gap-2 px-4 py-2.5 ${group.color} border-b border-gray-100`}>
                <span className="text-xs font-semibold uppercase tracking-wider">{group.label}s</span>
                <span className="rounded-full bg-white/60 px-1.5 py-0.5 text-xs font-medium">{group.accounts.length}</span>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-400">
                  <tr>
                    <th className="px-4 py-2 text-left">Account</th>
                    <th className="px-4 py-2 text-left">Subtype</th>
                    <th className="px-4 py-2 text-right">Opening Balance</th>
                    <th className="px-4 py-2 text-center">Type</th>
                    <th className="px-4 py-2 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {group.accounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      depth={0}
                      onEdit={() => { setEditing(account); setShowModal(true); }}
                      onDelete={() => setDeleting(account)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <AccountModal
          existing={editing}
          businessId={businessId}
          onClose={() => { setShowModal(false); setEditing(undefined); }}
        />
      )}

      {deleting && (
        <DeleteConfirm
          name={deleting.name}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(undefined)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
