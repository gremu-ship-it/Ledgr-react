import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, AlertCircle, CheckCircle,
  X, Search, Building2, Tag, ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto, DepreciationMethod, AssetStatus } from '@/dal/types/database';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEPRECIATION_METHODS: { value: DepreciationMethod; label: string }[] = [
  { value: 'straight_line',       label: 'Straight Line' },
  { value: 'reducing_balance',    label: 'Reducing Balance' },
  { value: 'units_of_production', label: 'Units of Production' },
  { value: 'sum_of_years_digits', label: 'Sum of Years Digits' },
];

const ASSET_STATUSES: { value: AssetStatus; label: string; color: string }[] = [
  { value: 'active',             label: 'Active',              color: 'bg-brand-50 text-brand-700' },
  { value: 'disposed',           label: 'Disposed',            color: 'bg-gray-100 text-gray-500' },
  { value: 'fully_depreciated',  label: 'Fully Depreciated',   color: 'bg-amber-50 text-amber-700' },
  { value: 'impaired',           label: 'Impaired',            color: 'bg-red-50 text-red-600' },
  { value: 'under_construction', label: 'Under Construction',  color: 'bg-purple-50 text-purple-700' },
];

function statusColor(status: string) {
  return ASSET_STATUSES.find((s) => s.value === status)?.color ?? 'bg-gray-100 text-gray-500';
}

function statusLabel(status: string) {
  return ASSET_STATUSES.find((s) => s.value === status)?.label ?? status;
}

function formatMwk(amount: number): string {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
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

// ── Category Modal ────────────────────────────────────────────────────────────

interface CategoryForm {
  name: string;
  depreciation_method: DepreciationMethod;
  useful_life_years: string;
  residual_percent: string;
  mra_depreciation_rate: string;
}

function CategoryModal({
  existing, businessId, onClose,
}: {
  existing?: Row<'asset_categories'>;
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CategoryForm>(
    existing ? {
      name: existing.name ?? '',
      depreciation_method: existing.depreciation_method as DepreciationMethod,
      useful_life_years: String(existing.useful_life_years ?? ''),
      residual_percent: String(existing.residual_percent ?? ''),
      mra_depreciation_rate: String(existing.mra_depreciation_rate ?? ''),
    } : {
      name: '',
      depreciation_method: 'straight_line',
      useful_life_years: '',
      residual_percent: '0',
      mra_depreciation_rate: '',
    },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof CategoryForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Category name is required');
      const payload: InsertDto<'asset_categories'> = {
        business_id: businessId,
        name: form.name.trim(),
        depreciation_method: form.depreciation_method,
        useful_life_years: form.useful_life_years ? parseInt(form.useful_life_years) : null,
        residual_percent: parseFloat(form.residual_percent) || 0,
        mra_depreciation_rate: form.mra_depreciation_rate ? parseFloat(form.mra_depreciation_rate) : null,
        is_active: true,
      };
      if (existing) {
        const { error } = await repos.asset['client']
          .from('asset_categories').update(payload as never).eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await repos.asset['client']
          .from('asset_categories').insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset_categories'] });
      setAlert({ type: 'success', message: existing ? 'Category updated.' : 'Category created.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{existing ? 'Edit Category' : 'New Asset Category'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Motor Vehicles"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Depreciation Method *</label>
              <select value={form.depreciation_method} onChange={(e) => set('depreciation_method', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                {DEPRECIATION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Useful Life (years)</label>
              <input type="number" min="1" value={form.useful_life_years} onChange={(e) => set('useful_life_years', e.target.value)}
                placeholder="e.g. 5"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Residual Value (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={form.residual_percent}
                onChange={(e) => set('residual_percent', e.target.value)} placeholder="e.g. 10"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">MRA Depreciation Rate (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={form.mra_depreciation_rate}
                onChange={(e) => set('mra_depreciation_rate', e.target.value)} placeholder="e.g. 25"
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
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Create Category'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Asset Modal ───────────────────────────────────────────────────────────────

interface AssetForm {
  asset_number: string;
  name: string;
  description: string;
  category_id: string;
  status: AssetStatus;
  acquisition_date: string;
  acquisition_cost: string;
  residual_value: string;
  depreciation_method: DepreciationMethod;
  useful_life_years: string;
  depreciation_start_date: string;
  serial_number: string;
  location: string;
  purchase_invoice_ref: string;
  notes: string;
}

function AssetModal({
  existing, businessId, categories, onClose,
}: {
  existing?: Row<'fixed_assets'>;
  businessId: string;
  categories: Row<'asset_categories'>[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<AssetForm>(
    existing ? {
      asset_number: existing.asset_number ?? '',
      name: existing.name ?? '',
      description: existing.description ?? '',
      category_id: existing.category_id ?? '',
      status: existing.status as AssetStatus,
      acquisition_date: existing.acquisition_date ?? today(),
      acquisition_cost: String(existing.acquisition_cost ?? ''),
      residual_value: String(existing.residual_value ?? '0'),
      depreciation_method: existing.depreciation_method as DepreciationMethod,
      useful_life_years: String(existing.useful_life_years ?? ''),
      depreciation_start_date: existing.depreciation_start_date ?? today(),
      serial_number: existing.serial_number ?? '',
      location: existing.location ?? '',
      purchase_invoice_ref: existing.purchase_invoice_ref ?? '',
      notes: existing.notes ?? '',
    } : {
      asset_number: '', name: '', description: '', category_id: '',
      status: 'active', acquisition_date: today(), acquisition_cost: '',
      residual_value: '0', depreciation_method: 'straight_line',
      useful_life_years: '', depreciation_start_date: today(),
      serial_number: '', location: '', purchase_invoice_ref: '', notes: '',
    },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof AssetForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.asset_number.trim()) throw new Error('Asset number is required');
      if (!form.name.trim()) throw new Error('Asset name is required');
      if (!form.category_id) throw new Error('Select a category');
      const cost = parseFloat(form.acquisition_cost);
      if (isNaN(cost) || cost <= 0) throw new Error('Enter a valid acquisition cost');

      const payload: InsertDto<'fixed_assets'> = {
        business_id: businessId,
        asset_number: form.asset_number.trim(),
        name: form.name.trim(),
        description: form.description || null,
        category_id: form.category_id,
        status: form.status,
        acquisition_date: form.acquisition_date,
        acquisition_cost: cost,
        residual_value: parseFloat(form.residual_value) || 0,
        depreciation_method: form.depreciation_method,
        useful_life_years: form.useful_life_years ? parseInt(form.useful_life_years) : null,
        depreciation_start_date: form.depreciation_start_date,
        accumulated_depreciation: 0,
        serial_number: form.serial_number || null,
        location: form.location || null,
        purchase_invoice_ref: form.purchase_invoice_ref || null,
        notes: form.notes || null,
        is_active: true,
      };

      if (existing) {
        const { error } = await repos.asset['client']
          .from('fixed_assets').update(payload as never).eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await repos.asset['client']
          .from('fixed_assets').insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setAlert({ type: 'success', message: existing ? 'Asset updated.' : 'Asset added.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">{existing ? 'Edit Asset' : 'Add Fixed Asset'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Asset Number *</label>
              <input type="text" value={form.asset_number} onChange={(e) => set('asset_number', e.target.value)}
                placeholder="e.g. FA-001"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Toyota Hilux"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Category *</label>
              <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="">Select category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Status</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                {ASSET_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Acquisition Date *</label>
              <input type="date" value={form.acquisition_date} onChange={(e) => set('acquisition_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Acquisition Cost (MWK) *</label>
              <input type="number" min="0" step="0.01" value={form.acquisition_cost}
                onChange={(e) => set('acquisition_cost', e.target.value)} placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Residual Value (MWK)</label>
              <input type="number" min="0" step="0.01" value={form.residual_value}
                onChange={(e) => set('residual_value', e.target.value)} placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Depreciation Method *</label>
              <select value={form.depreciation_method} onChange={(e) => set('depreciation_method', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                {DEPRECIATION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Useful Life (years)</label>
              <input type="number" min="1" value={form.useful_life_years}
                onChange={(e) => set('useful_life_years', e.target.value)} placeholder="e.g. 5"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Depreciation Start Date *</label>
              <input type="date" value={form.depreciation_start_date}
                onChange={(e) => set('depreciation_start_date', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Serial Number</label>
              <input type="text" value={form.serial_number} onChange={(e) => set('serial_number', e.target.value)}
                placeholder="e.g. SN123456"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Location</label>
              <input type="text" value={form.location} onChange={(e) => set('location', e.target.value)}
                placeholder="e.g. Head Office"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Purchase Invoice Ref</label>
              <input type="text" value={form.purchase_invoice_ref}
                onChange={(e) => set('purchase_invoice_ref', e.target.value)} placeholder="e.g. INV-001"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Description</label>
              <input type="text" value={form.description} onChange={(e) => set('description', e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
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
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Add Asset'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Confirm ────────────────────────────────────────────────────────────

function DeleteConfirm({ label, onConfirm, onCancel, isPending }: {
  label: string; onConfirm: () => void; onCancel: () => void; isPending: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-gray-900">Delete?</h3>
        <p className="mt-2 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{label}</span> will be removed permanently.
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

// ── Asset Register Tab ────────────────────────────────────────────────────────

function AssetRegisterTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<AssetStatus | 'all'>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'fixed_assets'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'fixed_assets'> | undefined>();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: assets = [], isLoading } = useQuery({
    queryKey: ['assets', businessId],
    queryFn: () => repos.asset.findByBusiness(businessId),
    enabled: Boolean(businessId),
  });

  const { data: categories = [] } = useQuery({
    queryKey: ['asset_categories', businessId],
    queryFn: () => repos.asset.findCategories(businessId),
    enabled: Boolean(businessId),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => repos.asset.softDelete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setDeleting(undefined);
    },
  });

  const categoryMap = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  const filtered = assets.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.asset_number.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'all' || a.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search assets…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as AssetStatus | 'all')}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="all">All Statuses</option>
            {ASSET_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <button onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
          <Plus className="h-4 w-4" />Add Asset
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <Building2 className="h-7 w-7 text-brand-400" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">{search ? 'No assets match your search' : 'No assets yet'}</h2>
          {!search && (
            <button onClick={() => { setEditing(undefined); setShowModal(true); }}
              className="mt-1 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
              <Plus className="h-4 w-4" />Add Asset
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3 text-left">Asset</th>
                <th className="px-4 py-3 text-left">Category</th>
                <th className="px-4 py-3 text-right">Cost</th>
                <th className="px-4 py-3 text-right">Accum. Dep.</th>
                <th className="px-4 py-3 text-right">Net Book Value</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((asset) => (
                <>
                  <tr key={asset.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <button onClick={() => setExpandedId(expandedId === asset.id ? null : asset.id)}
                        className="text-gray-400 hover:text-gray-600">
                        <ChevronDown className={`h-4 w-4 transition-transform ${expandedId === asset.id ? 'rotate-180' : ''}`} />
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{asset.name}</div>
                      <div className="text-xs text-gray-400">{asset.asset_number}</div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{categoryMap[asset.category_id] ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatMwk(Number(asset.acquisition_cost))}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatMwk(Number(asset.accumulated_depreciation))}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {formatMwk(Number(asset.net_book_value ?? (Number(asset.acquisition_cost) - Number(asset.accumulated_depreciation))))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(asset.status)}`}>
                        {statusLabel(asset.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => { setEditing(asset); setShowModal(true); }}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setDeleting(asset)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedId === asset.id && (
                    <tr key={`${asset.id}-detail`} className="bg-gray-50">
                      <td colSpan={8} className="px-8 py-3">
                        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-gray-600 sm:grid-cols-4">
                          <div><span className="text-gray-400">Depreciation Method:</span> {asset.depreciation_method?.replace(/_/g, ' ')}</div>
                          <div><span className="text-gray-400">Useful Life:</span> {asset.useful_life_years ? `${asset.useful_life_years} years` : '—'}</div>
                          <div><span className="text-gray-400">Acquisition Date:</span> {asset.acquisition_date}</div>
                          <div><span className="text-gray-400">Dep. Start Date:</span> {asset.depreciation_start_date}</div>
                          <div><span className="text-gray-400">Residual Value:</span> {formatMwk(Number(asset.residual_value))}</div>
                          <div><span className="text-gray-400">Last Dep. Date:</span> {asset.last_depreciation_date ?? '—'}</div>
                          <div><span className="text-gray-400">Serial Number:</span> {asset.serial_number ?? '—'}</div>
                          <div><span className="text-gray-400">Location:</span> {asset.location ?? '—'}</div>
                          {asset.notes && <div className="col-span-4"><span className="text-gray-400">Notes:</span> {asset.notes}</div>}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <AssetModal
          existing={editing}
          businessId={businessId}
          categories={categories}
          onClose={() => { setShowModal(false); setEditing(undefined); }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          label={deleting.name}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(undefined)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ── Categories Tab ────────────────────────────────────────────────────────────

function CategoriesTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'asset_categories'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'asset_categories'> | undefined>();

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ['asset_categories', businessId],
    queryFn: () => repos.asset.findCategories(businessId),
    enabled: Boolean(businessId),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await repos.asset['client']
        .from('asset_categories')
        .update({ is_active: false } as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset_categories'] });
      setDeleting(undefined);
    },
  });

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
          <Plus className="h-4 w-4" />New Category
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : categories.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
            <Tag className="h-7 w-7 text-brand-400" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">No asset categories yet</h2>
          <button onClick={() => { setEditing(undefined); setShowModal(true); }}
            className="mt-1 flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors">
            <Plus className="h-4 w-4" />New Category
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Method</th>
                <th className="px-4 py-3 text-right">Useful Life</th>
                <th className="px-4 py-3 text-right">Residual %</th>
                <th className="px-4 py-3 text-right">MRA Rate %</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{cat.name}</td>
                  <td className="px-4 py-3 text-gray-500 capitalize">{cat.depreciation_method?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{cat.useful_life_years ? `${cat.useful_life_years} yrs` : '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{Number(cat.residual_percent).toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right text-gray-500">{cat.mra_depreciation_rate != null ? `${Number(cat.mra_depreciation_rate).toFixed(1)}%` : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => { setEditing(cat); setShowModal(true); }}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleting(cat)}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <CategoryModal
          existing={editing}
          businessId={businessId}
          onClose={() => { setShowModal(false); setEditing(undefined); }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          label={deleting.name}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onCancel={() => setDeleting(undefined)}
          isPending={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AssetsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const [tab, setTab] = useState<'register' | 'categories'>('register');

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Fixed Assets</h1>
          <p className="mt-1 text-sm text-gray-500">Manage fixed assets and depreciation for {currentBusiness.business.name}</p>
        </div>
      </div>

      <div className="mb-6 flex w-fit gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1">
        <button onClick={() => setTab('register')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'register' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <Building2 className="h-4 w-4" />Asset Register
        </button>
        <button onClick={() => setTab('categories')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'categories' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}>
          <Tag className="h-4 w-4" />Categories
        </button>
      </div>

      {tab === 'register' && <AssetRegisterTab businessId={businessId} />}
      {tab === 'categories' && <CategoriesTab businessId={businessId} />}
    </div>
  );
}
