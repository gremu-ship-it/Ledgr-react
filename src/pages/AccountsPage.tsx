/**
 * AccountsPage.tsx
 *
 * Full Chart of Accounts management:
 *   - Hierarchical tree view with roll-up indicators
 *   - Add / edit custom accounts
 *   - IFRS vs local GAAP template switching (persisted on businesses.coa_template)
 *   - Validation: no posting to group accounts, debit/credit nature warnings
 *   - Repair / seed missing accounts
 */

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, ChevronRight, ChevronDown, AlertTriangle,
  CheckCircle, AlertCircle, RefreshCw, Settings2, X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import type { Row, InsertDto } from '@/dal/types/database';
import {
  seedChartOfAccounts,
  switchCoaTemplate,
  isDebitNature,
  validateDebitCredit,
  type CoaTemplate,
  type AccountType,
  type AccountSubtype,
} from '@/services/seedChartOfAccounts';

// ── Constants ─────────────────────────────────────────────────────────────────

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'asset',         label: 'Asset' },
  { value: 'liability',     label: 'Liability' },
  { value: 'equity',        label: 'Equity' },
  { value: 'income',        label: 'Income / Revenue' },
  { value: 'expense' as AccountType, label: 'Cost of Sales (COGS)' },
  { value: 'expense',       label: 'Expense' },
];

const SUBTYPES: { value: AccountSubtype; label: string; for: AccountType[] }[] = [
  { value: 'current_asset',        label: 'Current Asset',            for: ['asset'] },
  { value: 'fixed_asset',          label: 'Fixed Asset (PP&E)',       for: ['asset'] },
  { value: 'non_current_asset',    label: 'Non-Current Asset',        for: ['asset'] },
  { value: 'current_liability',    label: 'Current Liability',        for: ['liability'] },
  { value: 'non_current_liability',label: 'Non-Current Liability',    for: ['liability'] },
  { value: 'share_capital',        label: 'Share Capital',            for: ['equity'] },
  { value: 'retained_earnings',    label: 'Retained Earnings',        for: ['equity'] },
  { value: 'reserves',             label: 'Reserves',                 for: ['equity'] },
  { value: 'revenue',              label: 'Revenue',                  for: ['income'] },
  { value: 'other_income',         label: 'Other Income',             for: ['income'] },
  { value: 'cost_of_sales',        label: 'Cost of Sales',            for: ['expense'] },
  { value: 'operating_expense',    label: 'Operating Expense',        for: ['expense'] },
  { value: 'operating_expense',    label: 'Payroll Expense',          for: ['expense'] },
  { value: 'depreciation_amortisation', label: 'Depreciation & Amortisation', for: ['expense'] },
  { value: 'finance_cost',         label: 'Finance Cost',             for: ['expense'] },
  { value: 'tax_expense',          label: 'Tax Expense',              for: ['expense'] },
];

const TYPE_COLOURS: Record<AccountType, string> = {
  asset:         'bg-blue-50 text-blue-700 border-blue-200',
  liability:     'bg-red-50 text-red-700 border-red-200',
  equity:        'bg-purple-50 text-purple-700 border-purple-200',
  income:        'bg-emerald-50 text-emerald-700 border-emerald-200',
  expense:       'bg-orange-50 text-orange-700 border-orange-200',
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Account = Row<'accounts'>;

interface TreeNode {
  account: Account;
  children: TreeNode[];
  depth: number;
}

// ── Build tree ────────────────────────────────────────────────────────────────

function buildTree(accounts: Account[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const a of accounts) {
    map.set(a.id, { account: a, children: [], depth: 0 });
  }
  const roots: TreeNode[] = [];
  for (const node of map.values()) {
    const parentId = node.account.parent_id;
    if (parentId && map.has(parentId)) {
      map.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Sort children by code within each node
  function sortNodes(nodes: TreeNode[], depth: number) {
    nodes.sort((a, b) => a.account.code.localeCompare(b.account.code));
    for (const n of nodes) {
      n.depth = depth;
      sortNodes(n.children, depth + 1);
    }
  }
  sortNodes(roots, 0);
  return roots;
}

function flattenTree(nodes: TreeNode[], expanded: Set<string>): TreeNode[] {
  const result: TreeNode[] = [];
  function walk(list: TreeNode[]) {
    for (const n of list) {
      result.push(n);
      if (n.children.length > 0 && expanded.has(n.account.id)) {
        walk(n.children);
      }
    }
  }
  walk(nodes);
  return result;
}

// ── Account form modal ────────────────────────────────────────────────────────

interface AccountFormProps {
  initial?: Account;
  accounts: Account[];
  businessId: string;
  onSave: (data: InsertDto<'accounts'> & { id?: string }) => Promise<void>;
  onClose: () => void;
}

function AccountFormModal({ initial, accounts, businessId, onSave, onClose }: AccountFormProps) {
  const isEdit = Boolean(initial?.id);

  const [form, setForm] = useState({
    code:            initial?.code            ?? '',
    name:            initial?.name            ?? '',
    description:     initial?.description     ?? '',
    account_type:    (initial?.account_type   ?? 'expense') as AccountType,
    account_subtype: (initial?.account_subtype ?? null)     as AccountSubtype,
    normal_balance:  (initial?.normal_balance  ?? 'debit')  as 'debit' | 'credit',
    is_group:        initial?.is_group         ?? false,
    is_bank_account: initial?.is_bank_account  ?? false,
    parent_id:       initial?.parent_id        ?? '',
    currency:        initial?.currency         ?? 'MWK',
    opening_balance: initial?.opening_balance  ?? 0,
    is_active:       initial?.is_active        ?? true,
  });

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const set = (k: keyof typeof form, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  // Auto-set normal_balance when type changes
  function handleTypeChange(type: AccountType) {
    set('account_type', type);
    set('normal_balance', isDebitNature(type) ? 'debit' : 'credit');
    set('account_subtype', null);
  }

  const debitCreditWarning = validateDebitCredit(
    form.account_type,
    form.normal_balance === 'debit',
  ).warning;

  // Code uniqueness check
  const codeExists = accounts.some(
    (a) => a.code === form.code && a.id !== initial?.id,
  );

  const filteredSubtypes = SUBTYPES.filter((s) =>
    s.for.includes(form.account_type),
  );

  const postableParents = accounts.filter(
    (a) => a.account_type === form.account_type && a.id !== initial?.id,
  );

  async function handleSubmit() {
    if (!form.code.trim()) return setError('Account code is required.');
    if (!form.name.trim()) return setError('Account name is required.');
    if (codeExists)        return setError(`Code "${form.code}" is already in use.`);

    setSaving(true); setError('');
    try {
      await onSave({
        ...(isEdit ? { id: initial!.id } : {}),
        business_id:     businessId,
        code:            form.code.trim(),
        name:            form.name.trim(),
        description:     form.description.trim() || null,
        account_type:    form.account_type as any,
        account_subtype: form.account_subtype as any,
        normal_balance:  form.normal_balance,
        is_group:        form.is_group,
        is_system:       false,
        is_bank_account: form.is_bank_account,
        parent_id:       form.parent_id || null,
        currency:        form.currency as any,
        opening_balance: form.opening_balance,
        is_active:       form.is_active,
      } as any);
      onClose();
    } catch (e: unknown) {
      setError((e as Error).message ?? 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {isEdit ? 'Edit Account' : 'New Account'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {error && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle size={14} className="shrink-0" />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Code <span className="text-red-400">*</span>
              </label>
              <input
                value={form.code}
                onChange={e => set('code', e.target.value)}
                placeholder="e.g. 6910"
                className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 ${codeExists ? 'border-red-300' : 'border-gray-300'}`}
              />
              {codeExists && <p className="mt-1 text-xs text-red-500">Code already in use</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Name <span className="text-red-400">*</span>
              </label>
              <input
                value={form.name}
                onChange={e => set('name', e.target.value)}
                placeholder="e.g. Cleaning Supplies"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Account Type *</label>
              <select
                value={form.account_type}
                onChange={e => handleTypeChange(e.target.value as AccountType)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {ACCOUNT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Subtype</label>
              <select
                value={form.account_subtype ?? ''}
                onChange={e => set('account_subtype', e.target.value || null)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">— None —</option>
                {filteredSubtypes.map(s => (
                  <option key={s.value} value={s.value ?? ''}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Normal Balance</label>
              <select
                value={form.normal_balance}
                onChange={e => set('normal_balance', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="debit">Debit</option>
                <option value="credit">Credit</option>
              </select>
              {debitCreditWarning && (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                  <AlertTriangle size={11} />{debitCreditWarning}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Currency</label>
              <select
                value={form.currency}
                onChange={e => set('currency', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="MWK">MWK — Malawi Kwacha</option>
                <option value="USD">USD — US Dollar</option>
                <option value="ZAR">ZAR — South African Rand</option>
                <option value="GBP">GBP — British Pound</option>
                <option value="EUR">EUR — Euro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Parent Account</label>
            <select
              value={form.parent_id}
              onChange={e => set('parent_id', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">— No parent (top-level) —</option>
              {postableParents
                .sort((a, b) => a.code.localeCompare(b.code))
                .map(a => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Description</label>
            <textarea
              rows={2}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="Optional description"
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">Opening Balance (MWK)</label>
            <input
              type="number" min={0} step="0.01"
              value={form.opening_balance}
              onChange={e => set('opening_balance', parseFloat(e.target.value) || 0)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex flex-wrap gap-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
            {[
              { key: 'is_group',        label: 'Header / group account (no posting)' },
              { key: 'is_bank_account', label: 'Bank / cash account' },
              { key: 'is_active',       label: 'Active' },
            ].map(({ key, label }) => (
              <label key={key} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={form[key as keyof typeof form] as boolean}
                  onChange={e => set(key as keyof typeof form, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-500"
                />
                <span className="text-gray-700">{label}</span>
              </label>
            ))}
          </div>

          {form.is_group && (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle size={13} className="shrink-0" />
              Header accounts cannot be posted to — transactions must use child accounts.
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="flex-1 rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {saving ? 'Saving…' : isEdit ? 'Update' : 'Create Account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AccountsPage() {
  const businessId  = useAppStore(s => s.currentBusiness?.business.id);
  const queryClient = useQueryClient();

  const [search,   setSearch]   = useState('');
  const [typeFilter, setType]   = useState<AccountType | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [modal,    setModal]    = useState<{ open: boolean; account?: Account }>({ open: false });
  const [selectedTemplate, setSelectedTemplate] = useState<CoaTemplate>('gaap');
  const [seeding,  setSeeding]  = useState(false);
  const [seedMsg,  setSeedMsg]  = useState<{ type: 'success'|'error'; text: string } | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts', businessId],
    queryFn:  () => repos.account.findByBusiness(businessId!),
    enabled:  Boolean(businessId),
  });

  // The template actually stored on the business — the source of truth.
  // `selectedTemplate` is just what's highlighted in the toggle; it syncs
  // to this once loaded, and diverges only while the user is picking a
  // different one to switch to.
  const { data: businessTemplate } = useQuery({
    queryKey: ['business_coa_template', businessId],
    queryFn: async () => {
      const { data, error } = await (supabase.from('businesses') as any)
        .select('coa_template')
        .eq('id', businessId!)
        .single();
      if (error) throw new Error(error.message);
      return ((data as any)?.coa_template ?? 'gaap') as CoaTemplate;
    },
    enabled: Boolean(businessId),
  });

  useEffect(() => {
    if (businessTemplate) setSelectedTemplate(businessTemplate);
  }, [businessTemplate]);

  const templateChanged = businessTemplate != null && selectedTemplate !== businessTemplate;

  // Build tree & flatten with expansion state
  const tree = useMemo(() => buildTree(accounts), [accounts]);

  const allExpanded = useMemo(() => {
    const ids = new Set<string>();
    function collect(nodes: TreeNode[]) {
      for (const n of nodes) { ids.add(n.account.id); collect(n.children); }
    }
    collect(tree);
    return ids;
  }, [tree]);

  const displayed = useMemo(() => {
    if (search || typeFilter !== 'all') {
      // Flat filtered list
      return accounts
        .filter(a => {
          const matchSearch = !search ||
            a.code.toLowerCase().includes(search.toLowerCase()) ||
            a.name.toLowerCase().includes(search.toLowerCase());
          const matchType = typeFilter === 'all' || a.account_type === typeFilter;
          return matchSearch && matchType;
        })
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(a => ({ account: a, children: [], depth: 0 } as TreeNode));
    }
    return flattenTree(tree, expanded);
  }, [accounts, search, typeFilter, tree, expanded]);

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data: InsertDto<'accounts'> & { id?: string }) => {
      if ((data as any).id) {
        const { id, ...patch } = data as any;
        const { error } = await (supabase.from('accounts') as any).update(patch).eq('id', id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from('accounts').insert(data as any);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts', businessId] }),
  });

  // Deactivate mutation
  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from('accounts') as any).update({ is_active: false }).eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['accounts', businessId] }),
  });

  // Repair: seed anything missing for the CURRENT (stored) template — does
  // not touch template assignment.
  async function runRepair() {
    if (!businessId) return;
    setSeeding(true); setSeedMsg(null);
    try {
      const templateToUse = businessTemplate ?? 'gaap';
      const { inserted, skipped } = await seedChartOfAccounts(supabase, businessId, templateToUse);
      queryClient.invalidateQueries({ queryKey: ['accounts', businessId] });
      setSeedMsg({
        type: 'success',
        text: inserted > 0
          ? `Added ${inserted} missing accounts (${skipped} already existed).`
          : `Chart of Accounts is already complete — nothing to add.`,
      });
    } catch (e: unknown) {
      setSeedMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setSeeding(false);
    }
  }

  // Switch: change the business's template, adding new-template accounts
  // and deactivating old-template-exclusive ones. Requires confirmation
  // since it changes which accounts are selectable.
  async function runSwitch() {
    if (!businessId || !businessTemplate) return;
    const confirmed = window.confirm(
      `Switch this business from ${businessTemplate.toUpperCase()} to ${selectedTemplate.toUpperCase()}?\n\n` +
      `Accounts specific to ${businessTemplate.toUpperCase()} that don't exist under ${selectedTemplate.toUpperCase()} ` +
      `will be deactivated (not deleted — any existing transactions are preserved). ` +
      `Accounts needed for ${selectedTemplate.toUpperCase()} that don't exist yet will be added.`,
    );
    if (!confirmed) return;

    setSeeding(true); setSeedMsg(null);
    try {
      const { added, deactivated } = await switchCoaTemplate(supabase, businessId, selectedTemplate);
      queryClient.invalidateQueries({ queryKey: ['accounts', businessId] });
      queryClient.invalidateQueries({ queryKey: ['business_coa_template', businessId] });
      setSeedMsg({
        type: 'success',
        text: `Switched to ${selectedTemplate.toUpperCase()}. Added ${added} account(s), deactivated ${deactivated}.`,
      });
    } catch (e: unknown) {
      setSeedMsg({ type: 'error', text: (e as Error).message });
    } finally {
      setSeeding(false);
    }
  }

  if (!businessId) return null;

  const stats = {
    total:  accounts.length,
    active: accounts.filter(a => a.is_active).length,
    groups: accounts.filter(a => a.is_group).length,
  };

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Chart of Accounts</h1>
          <p className="mt-1 text-sm text-gray-500">
            {stats.total} accounts · {stats.active} active · {stats.groups} groups
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setModal({ open: true })}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors"
          >
            <Plus size={15} /> Add Account
          </button>
        </div>
      </div>

      {/* Seed / repair / switch panel */}
      <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Settings2 size={16} className="text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-gray-700">COA Template</span>

          <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-0.5">
            {(['gaap', 'ifrs'] as CoaTemplate[]).map(t => (
              <button
                key={t}
                onClick={() => setSelectedTemplate(t)}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  selectedTemplate === t ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'gaap' ? 'Local GAAP / MRA' : 'IFRS'}
                {businessTemplate === t && <span className="ml-1 text-brand-400">●</span>}
              </button>
            ))}
          </div>

          {templateChanged ? (
            <button
              onClick={runSwitch}
              disabled={seeding}
              className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={seeding ? 'animate-spin' : ''} />
              {seeding ? 'Switching…' : `Switch to ${selectedTemplate.toUpperCase()}`}
            </button>
          ) : (
            <button
              onClick={runRepair}
              disabled={seeding}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={seeding ? 'animate-spin' : ''} />
              {seeding ? 'Seeding…' : 'Repair / Seed Missing Accounts'}
            </button>
          )}

          {seedMsg && (
            <div className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${
              seedMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
            }`}>
              {seedMsg.type === 'success'
                ? <CheckCircle size={13} />
                : <AlertCircle size={13} />}
              {seedMsg.text}
            </div>
          )}
        </div>
        {businessTemplate && (
          <p className="mt-2 text-xs text-gray-400">
            Current template: <span className="font-medium text-gray-600">{businessTemplate.toUpperCase()}</span>
            {templateChanged && ' — select "Switch" above to change it, or click the current template to cancel.'}
          </p>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by code or name…"
          className="min-w-48 flex-1 rounded-xl border border-gray-200 bg-white py-2 px-4 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <select
          value={typeFilter}
          onChange={e => setType(e.target.value as AccountType | 'all')}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-brand-500 focus:outline-none"
        >
          <option value="all">All types</option>
          {ACCOUNT_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>

        {!search && typeFilter === 'all' && (
          <div className="flex gap-1">
            <button
              onClick={() => setExpanded(new Set(allExpanded))}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Expand all
            </button>
            <button
              onClick={() => setExpanded(new Set())}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Collapse all
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-gray-50 px-5 py-3">
                <div className="h-3 w-16 animate-pulse rounded bg-gray-100" />
                <div className="h-3 flex-1 animate-pulse rounded bg-gray-100" />
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-sm">No accounts found.</p>
            {accounts.length === 0 && (
              <p className="mt-1 text-xs">Use "Repair / Seed" above to populate the Chart of Accounts.</p>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Code</th>
                <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Name</th>
                <th className="hidden sm:table-cell px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Type</th>
                <th className="hidden md:table-cell px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Balance</th>
                <th className="hidden md:table-cell px-5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-400">Postable</th>
                <th className="hidden sm:table-cell px-5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-gray-400">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map(({ account: a, depth, children }) => {
                const hasChildren = children.length > 0 || accounts.some(x => x.parent_id === a.id);
                const isExpanded  = expanded.has(a.id);

                return (
                  <tr
                    key={a.id}
                    className={`transition-colors hover:bg-gray-50/50 ${!a.is_active ? 'opacity-50' : ''}`}
                  >
                    {/* Code */}
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      <div style={{ paddingLeft: `${depth * 20}px` }} className="flex items-center gap-1">
                        {hasChildren && !search && typeFilter === 'all' ? (
                          <button
                            onClick={() => toggleExpand(a.id)}
                            className="text-gray-400 hover:text-gray-700"
                          >
                            {isExpanded
                              ? <ChevronDown size={13} />
                              : <ChevronRight size={13} />}
                          </button>
                        ) : (
                          <span className="w-[13px]" />
                        )}
                        {a.code}
                      </div>
                    </td>

                    {/* Name */}
                    <td className="px-5 py-3">
                      <span className={`font-medium ${a.is_group ? 'text-gray-900' : 'text-gray-700'}`}>
                        {a.is_group ? <strong>{a.name}</strong> : a.name}
                      </span>
                      {a.is_system && (
                        <span className="ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                          System
                        </span>
                      )}
                      {a.description && (
                        <p className="mt-0.5 text-xs text-gray-400 truncate max-w-xs">{a.description}</p>
                      )}
                    </td>

                    {/* Type */}
                    <td className="hidden sm:table-cell px-5 py-3">
                      <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold capitalize ${TYPE_COLOURS[a.account_type as AccountType] ?? ''}`}>
                        {a.account_type.replace('_', ' ')}
                      </span>
                    </td>

                    {/* Normal balance */}
                    <td className="hidden md:table-cell px-5 py-3 text-xs capitalize text-gray-500">
                      {a.normal_balance}
                    </td>

                    {/* Postable indicator */}
                    <td className="hidden md:table-cell px-5 py-3 text-center">
                      {a.is_group ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <CheckCircle size={14} className="mx-auto text-emerald-500" />
                      )}
                    </td>

                    {/* Status */}
                    <td className="hidden sm:table-cell px-5 py-3 text-center">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${
                        a.is_active
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-gray-100 text-gray-400'
                      }`}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setModal({ open: true, account: a })}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          title="Edit"
                        >
                          <Settings2 size={14} />
                        </button>
                        {!a.is_system && a.is_active && (
                          <button
                            onClick={() => {
                              if (confirm(`Deactivate "${a.name}"?`)) deactivateMutation.mutate(a.id);
                            }}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                            title="Deactivate"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal.open && (
        <AccountFormModal
          initial={modal.account}
          accounts={accounts}
          businessId={businessId}
          onSave={data => saveMutation.mutateAsync(data)}
          onClose={() => setModal({ open: false })}
        />
      )}
    </div>
  );
}
