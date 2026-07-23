import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, Pencil, AlertCircle, CheckCircle,
  Package, BarChart3, ArrowUpDown, X, Search,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row, InsertDto } from '@/dal/types/database';

// ── Formatters ────────────────────────────────────────────────────────────────

function formatMwk(amount: number): string {
  return `MK ${amount.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = 'products' | 'stock' | 'movements';

interface ProductForm {
  name: string;
  sku: string;
  description: string;
  product_type: 'product' | 'service';
  unit_of_measure: string;
  sale_price: string;
  purchase_price: string;
  track_inventory: boolean;
  reorder_level: string;
  reorder_quantity: string;
}

interface MovementForm {
  product_id: string;
  location_id: string;
  movement_type: 'adjustment_in' | 'adjustment_out' | 'purchase' | 'opening_balance';
  movement_date: string;
  quantity: string;
  unit_cost: string;
  reference: string;
  notes: string;
}

const EMPTY_PRODUCT: ProductForm = {
  name: '', sku: '', description: '', product_type: 'product',
  unit_of_measure: '', sale_price: '', purchase_price: '',
  track_inventory: false, reorder_level: '', reorder_quantity: '',
};

const MOVEMENT_TYPES = [
  { value: 'purchase', label: 'Purchase (Stock In)' },
  { value: 'adjustment_in', label: 'Adjustment In' },
  { value: 'adjustment_out', label: 'Adjustment Out' },
  { value: 'opening_balance', label: 'Opening Balance' },
];

// ── Alert ─────────────────────────────────────────────────────────────────────

function Alert({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg px-4 py-3 text-sm ${
      type === 'success' ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300' : 'bg-danger/10 text-danger'
    }`}>
      {type === 'success' ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      {message}
    </div>
  );
}

// ── Product Modal ─────────────────────────────────────────────────────────────

function ProductModal({
  existing, businessId, onClose,
}: {
  existing?: Row<'products'>;
  businessId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProductForm>(
    existing ? {
      name: existing.name ?? '',
      sku: existing.sku ?? '',
      description: existing.description ?? '',
      product_type: (existing.product_type as 'product' | 'service') ?? 'product',
      unit_of_measure: existing.unit_of_measure ?? '',
      sale_price: String(existing.sale_price ?? ''),
      purchase_price: String(existing.purchase_price ?? ''),
      track_inventory: existing.track_inventory ?? false,
      reorder_level: String(existing.reorder_level ?? ''),
      reorder_quantity: String(existing.reorder_quantity ?? ''),
    } : { ...EMPTY_PRODUCT },
  );
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  function set(field: keyof ProductForm, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Product name is required');
      const salePrice = parseFloat(form.sale_price);
      if (isNaN(salePrice) || salePrice < 0) throw new Error('Enter a valid sale price');

      const payload: InsertDto<'products'> = {
        business_id: businessId,
        name: form.name.trim(),
        sku: form.sku || null,
        description: form.description || null,
        product_type: form.product_type,
        unit_of_measure: form.unit_of_measure || null,
        sale_price: salePrice,
        purchase_price: parseFloat(form.purchase_price) || 0,
        currency: 'MWK',
        sales_tax_code: 'vat_standard',
        purchase_tax_code: 'vat_standard',
        track_inventory: form.product_type === 'product' ? form.track_inventory : false,
        reorder_level: form.reorder_level ? parseFloat(form.reorder_level) : null,
        reorder_quantity: form.reorder_quantity ? parseFloat(form.reorder_quantity) : null,
        is_active: true,
      };

      if (existing) {
        const { error } = await repos.inventory['client']
          .from('products')
          .update(payload as never)
          .eq('id', existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await repos.inventory['client']
          .from('products')
          .insert(payload as never);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setAlert({ type: 'success', message: existing ? 'Product updated.' : 'Product added.' });
      setTimeout(onClose, 1000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-2xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-ink">{existing ? 'Edit Product' : 'Add Product / Service'}</h2>
          <button onClick={onClose} className="text-muted hover:text-sub"><X className="h-5 w-5" /></button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {alert && <Alert type={alert.type} message={alert.message} />}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-sub">Name *</label>
              <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)}
                placeholder="e.g. Consulting Package"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Type</label>
              <select value={form.product_type} onChange={(e) => set('product_type', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
                <option value="product">Physical Product</option>
                <option value="service">Service</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">SKU (optional)</label>
              <input type="text" value={form.sku} onChange={(e) => set('sku', e.target.value)}
                placeholder="e.g. PROD-001"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Sale Price (MWK) *</label>
              <input type="number" min="0" step="0.01" value={form.sale_price}
                onChange={(e) => set('sale_price', e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Purchase Price (MWK)</label>
              <input type="number" min="0" step="0.01" value={form.purchase_price}
                onChange={(e) => set('purchase_price', e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-sub">Unit of Measure</label>
              <input type="text" value={form.unit_of_measure} onChange={(e) => set('unit_of_measure', e.target.value)}
                placeholder="e.g. kg, litre, piece, hour"
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            <div className="col-span-2">
              <label className="mb-1 block text-sm font-medium text-sub">Description (optional)</label>
              <textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
            </div>

            {form.product_type === 'product' && (
              <>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" id="track_inventory" checked={form.track_inventory}
                    onChange={(e) => set('track_inventory', e.target.checked)}
                    className="h-4 w-4 rounded border-line text-brand-600 dark:text-brand-400 focus:ring-brand-500" />
                  <label htmlFor="track_inventory" className="text-sm text-sub">Track inventory for this product</label>
                </div>

                {form.track_inventory && (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-sub">Reorder Level</label>
                      <input type="number" min="0" value={form.reorder_level}
                        onChange={(e) => set('reorder_level', e.target.value)}
                        placeholder="e.g. 10"
                        className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-sub">Reorder Quantity</label>
                      <input type="number" min="0" value={form.reorder_quantity}
                        onChange={(e) => set('reorder_quantity', e.target.value)}
                        placeholder="e.g. 50"
                        className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <button onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors">
            Cancel
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Saving…' : existing ? 'Save Changes' : 'Add Product'}
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
      <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-xl">
        <h3 className="text-base font-semibold text-ink">Delete product?</h3>
        <p className="mt-2 text-sm text-muted">
          <span className="font-medium text-sub">{name}</span> will be removed. This cannot be undone.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={isPending}
            className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger disabled:opacity-60 transition-colors">
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Products Tab ──────────────────────────────────────────────────────────────

function ProductsTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Row<'products'> | undefined>();
  const [deleting, setDeleting] = useState<Row<'products'> | undefined>();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', businessId],
    queryFn: async () => {
      const { data, error } = await repos.inventory['client']
        .from('products')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(businessId),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await repos.inventory['client']
        .from('products')
        .update({ deleted_at: new Date().toISOString(), is_active: false } as never)
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setDeleting(undefined);
    },
  });

  const filtered = (products as Row<'products'>[]).filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.sku ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input type="text" placeholder="Search products…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-line bg-card py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
        </div>
        <button onClick={() => { setEditing(undefined); setShowModal(true); }}
          className="flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
          <Plus className="h-4 w-4" />Add Product
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
            <Package className="h-7 w-7 text-brand-600 dark:text-brand-400" />
          </div>
          <h2 className="text-base font-semibold text-ink">{search ? 'No products match your search' : 'No products yet'}</h2>
          {!search && (
            <button onClick={() => { setEditing(undefined); setShowModal(true); }}
              className="mt-1 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors">
              <Plus className="h-4 w-4" />Add Product
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left">Type</th>
                <th className="hidden sm:table-cell px-4 py-3 text-left">SKU</th>
                <th className="px-4 py-3 text-right">Sale Price</th>
                <th className="hidden sm:table-cell px-4 py-3 text-right">Purchase Price</th>
                <th className="hidden sm:table-cell px-4 py-3 text-center">Inventory</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((p) => (
                <tr key={p.id} className="hover:bg-bg transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{p.name}</div>
                    {p.description && <div className="text-xs text-muted truncate max-w-xs">{p.description}</div>}
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3">
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      p.product_type === 'service' ? 'bg-accent/12 text-accent dark:text-accent-light' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    }`}>
                      {p.product_type === 'service' ? 'Service' : 'Product'}
                    </span>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-muted">{p.sku ?? '—'}</td>
                  <td className="px-4 py-3 text-right font-medium">{formatMwk(p.sale_price)}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-right text-muted">{formatMwk(p.purchase_price)}</td>
                  <td className="hidden sm:table-cell px-4 py-3 text-center">
                    {p.track_inventory
                      ? <span className="inline-flex rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">Tracked</span>
                      : <span className="text-xs text-muted">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => { setEditing(p); setShowModal(true); }}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-sub transition-colors">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => setDeleting(p)}
                        className="rounded-lg p-1.5 text-muted hover:bg-danger/10 hover:text-danger transition-colors">
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
        <ProductModal
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

// ── Stock Tab ─────────────────────────────────────────────────────────────────

function StockTab({ businessId }: { businessId: string }) {
  const { data: products = [] } = useQuery({
    queryKey: ['products', businessId],
    queryFn: async () => {
      const { data, error } = await repos.inventory['client']
        .from('products')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row<'products'>[];
    },
    enabled: Boolean(businessId),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', businessId],
    queryFn: () => repos.inventory.findLocations(businessId),
    enabled: Boolean(businessId),
  });

  const { data: balances = [], isLoading } = useQuery({
    queryKey: ['balances', businessId],
    queryFn: async () => {
      const { data, error } = await repos.inventory['client']
        .from('inventory_balances')
        .select('*')
        .eq('business_id', businessId);
      if (error) throw new Error(error.message);
      return (data ?? []) as Row<'inventory_balances'>[];
    },
    enabled: Boolean(businessId),
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['reorder_alerts', businessId],
    queryFn: () => repos.inventory.findReorderAlerts(businessId),
    enabled: Boolean(businessId),
  });

  const trackedProducts = (products as Row<'products'>[]).filter((p) => p.track_inventory);

  function getBalance(productId: string, locationId: string) {
    return balances.find((b) => b.product_id === productId && b.location_id === locationId);
  }

  function isLowStock(productId: string) {
    return (alerts as any[]).some((a) => a.product_id === productId);
  }

  if (isLoading) return <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-surface" />)}</div>;

  if (trackedProducts.length === 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-500/10">
          <BarChart3 className="h-7 w-7 text-brand-600 dark:text-brand-400" />
        </div>
        <h2 className="text-base font-semibold text-ink">No tracked products</h2>
        <p className="max-w-xs text-sm text-muted">Enable inventory tracking on a product to see stock levels here.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-3 text-left">Product</th>
            {locations.map((loc) => (
              <th key={loc.id} className="px-4 py-3 text-right">{loc.name}</th>
            ))}
            <th className="px-4 py-3 text-right">Total On Hand</th>
            <th className="hidden sm:table-cell px-4 py-3 text-right">Avg Cost</th>
            <th className="px-4 py-3 text-center">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {trackedProducts.map((p) => {
            const totalOnHand = balances
              .filter((b) => b.product_id === p.id)
              .reduce((s, b) => s + Number(b.quantity_on_hand), 0);
            const avgCost = balances.find((b) => b.product_id === p.id)?.average_cost ?? 0;
            const low = isLowStock(p.id);

            return (
              <tr key={p.id} className="hover:bg-bg transition-colors">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{p.name}</div>
                  {p.sku && <div className="text-xs text-muted">{p.sku}</div>}
                </td>
                {locations.map((loc) => {
                  const bal = getBalance(p.id, loc.id);
                  return (
                    <td key={loc.id} className="px-4 py-3 text-right text-sub">
                      {bal ? Number(bal.quantity_on_hand).toFixed(2) : '—'}
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-right font-semibold text-ink">{totalOnHand.toFixed(2)}</td>
                <td className="hidden sm:table-cell px-4 py-3 text-right text-muted">{formatMwk(Number(avgCost))}</td>
                <td className="px-4 py-3 text-center">
                  {low
                    ? <span className="inline-flex rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">Low Stock</span>
                    : <span className="inline-flex rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300">OK</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Movements Tab ─────────────────────────────────────────────────────────────

function MovementsTab({ businessId }: { businessId: string }) {
  const queryClient = useQueryClient();
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [form, setForm] = useState<MovementForm>({
    product_id: '', location_id: '', movement_type: 'purchase',
    movement_date: today(), quantity: '', unit_cost: '', reference: '', notes: '',
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', businessId],
    queryFn: async () => {
      const { data, error } = await repos.inventory['client']
        .from('products')
        .select('*')
        .eq('business_id', businessId)
        .eq('is_active', true)
        .eq('track_inventory', true)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row<'products'>[];
    },
    enabled: Boolean(businessId),
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations', businessId],
    queryFn: () => repos.inventory.findLocations(businessId),
    enabled: Boolean(businessId),
  });

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['movements', businessId, selectedProduct],
    queryFn: () => repos.inventory.findMovementHistory(businessId, selectedProduct),
    enabled: Boolean(businessId) && Boolean(selectedProduct),
  });

  function setF(field: keyof MovementForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.product_id) throw new Error('Select a product');
      if (!form.location_id) throw new Error('Select a location');
      const qty = parseFloat(form.quantity);
      if (isNaN(qty) || qty <= 0) throw new Error('Enter a valid quantity');
      const unitCost = parseFloat(form.unit_cost) || 0;

      await repos.inventory.recordMovement({
        business_id: businessId,
        product_id: form.product_id,
        location_id: form.location_id,
        movement_type: form.movement_type,
        movement_date: form.movement_date,
        quantity: qty,
        unit_cost: unitCost,
        reference: form.reference || null,
        notes: form.notes || null,
        created_by: null,
      } as InsertDto<'stock_movements'>);
    },
    onSuccess: () => {
      setAlert({ type: 'success', message: 'Stock movement recorded.' });
      setForm((f) => ({ ...f, quantity: '', unit_cost: '', reference: '', notes: '' }));
      queryClient.invalidateQueries({ queryKey: ['balances'] });
      queryClient.invalidateQueries({ queryKey: ['movements'] });
      queryClient.invalidateQueries({ queryKey: ['reorder_alerts'] });
      setTimeout(() => setAlert(null), 2000);
    },
    onError: (err: Error) => setAlert({ type: 'error', message: err.message }),
  });

  const locationMap = Object.fromEntries(locations.map((l) => [l.id, l.name]));

  return (
    <div className="space-y-6">
      {/* Record Movement Form */}
      <div className="rounded-2xl border border-line bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          <h2 className="text-base font-semibold text-ink">Record Stock Movement</h2>
        </div>

        {alert && <Alert type={alert.type} message={alert.message} />}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Product *</label>
            <select value={form.product_id}
              onChange={(e) => { setF('product_id', e.target.value); setSelectedProduct(e.target.value); }}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="">Select product…</option>
              {(products as Row<'products'>[]).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Location *</label>
            <select value={form.location_id} onChange={(e) => setF('location_id', e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="">Select location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Movement Type *</label>
            <select value={form.movement_type} onChange={(e) => setF('movement_type', e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
              {MOVEMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Date *</label>
            <input type="date" value={form.movement_date} onChange={(e) => setF('movement_date', e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Quantity *</label>
            <input type="number" min="0" step="0.01" value={form.quantity}
              onChange={(e) => setF('quantity', e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Unit Cost (MWK)</label>
            <input type="number" min="0" step="0.01" value={form.unit_cost}
              onChange={(e) => setF('unit_cost', e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-sub">Reference (optional)</label>
            <input type="text" value={form.reference} onChange={(e) => setF('reference', e.target.value)}
              placeholder="e.g. PO-001"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-sub">Notes (optional)</label>
            <input type="text" value={form.notes} onChange={(e) => setF('notes', e.target.value)}
              placeholder="Any additional notes…"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 transition-colors">
            <ArrowUpDown className="h-4 w-4" />
            {mutation.isPending ? 'Recording…' : 'Record Movement'}
          </button>
        </div>
      </div>

      {/* Movement History */}
      <div className="rounded-2xl border border-line bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-ink">Movement History</h2>
          <select value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
            <option value="">Select product…</option>
            {(products as Row<'products'>[]).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {!selectedProduct ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted">Select a product to view history</div>
        ) : historyLoading ? (
          <div className="space-y-2 p-4">{[...Array(4)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-surface" />)}</div>
        ) : (history as Row<'stock_movements'>[]).length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted">No movements recorded yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-xs font-medium uppercase tracking-wide text-muted">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left">Location</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-right">Unit Cost</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(history as Row<'stock_movements'>[]).map((m) => (
                  <tr key={m.id} className="hover:bg-bg transition-colors">
                    <td className="px-4 py-3 text-muted">{m.movement_date}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        m.movement_type.includes('in') || m.movement_type === 'purchase' || m.movement_type === 'opening_balance'
                          ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
                          : 'bg-danger/10 text-danger'
                      }`}>
                        {m.movement_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-sub">{locationMap[m.location_id] ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-medium">{Number(m.quantity).toFixed(2)}</td>
                    <td className="hidden sm:table-cell px-4 py-3 text-right text-muted">{formatMwk(Number(m.unit_cost))}</td>
                    <td className="hidden sm:table-cell px-4 py-3 text-muted">{m.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ProductsPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const [tab, setTab] = useState<Tab>('products');

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Products & Inventory</h1>
          <p className="mt-1 text-sm text-muted">Manage products, stock levels, and movements for {currentBusiness.business.name}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex w-fit gap-1 rounded-xl border border-line bg-bg p-1">
        <button onClick={() => setTab('products')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'products' ? 'bg-card text-brand-700 dark:text-brand-300 shadow-sm' : 'text-muted hover:text-sub'
          }`}>
          <Package className="h-4 w-4" />Products
        </button>
        <button onClick={() => setTab('stock')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'stock' ? 'bg-card text-brand-700 dark:text-brand-300 shadow-sm' : 'text-muted hover:text-sub'
          }`}>
          <BarChart3 className="h-4 w-4" />Stock Levels
        </button>
        <button onClick={() => setTab('movements')}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'movements' ? 'bg-card text-brand-700 dark:text-brand-300 shadow-sm' : 'text-muted hover:text-sub'
          }`}>
          <ArrowUpDown className="h-4 w-4" />Movements
        </button>
      </div>

      {tab === 'products' && <ProductsTab businessId={businessId} />}
      {tab === 'stock' && <StockTab businessId={businessId} />}
      {tab === 'movements' && <MovementsTab businessId={businessId} />}
    </div>
  );
}
