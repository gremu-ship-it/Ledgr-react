import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, AlertTriangle, Warehouse, Loader2, X, ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { formatMwk } from '@/lib/formatters';
import type { Row } from '@/dal/types/database';

// ── Receive stock modal ───────────────────────────────────────────────────────

interface ReceiveLineForm {
  productId: string;
  quantity: number;
  unitCost: number;
}

function ReceiveStockModal({
  open,
  products,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  products: Row<'products'>[];
  onClose: () => void;
  onSubmit: (lines: ReceiveLineForm[], notes: string) => void;
  isLoading: boolean;
}) {
  const [lines, setLines] = useState<ReceiveLineForm[]>([
    { productId: '', quantity: 1, unitCost: 0 },
  ]);
  const [notes, setNotes] = useState('');

  if (!open) return null;

  const addLine = () =>
    setLines((l) => [...l, { productId: '', quantity: 1, unitCost: 0 }]);

  const removeLine = (i: number) =>
    setLines((l) => l.filter((_, idx) => idx !== i));

  const updateLine = (i: number, field: keyof ReceiveLineForm, value: string | number) =>
    setLines((l) =>
      l.map((line, idx) => {
        if (idx !== i) return line;
        if (field === 'productId') {
          const p = products.find((p) => p.id === value);
          return { ...line, productId: value as string, unitCost: p ? Number(p.purchase_price) : 0 };
        }
        return { ...line, [field]: value };
      }),
    );

  const valid = lines.every((l) => l.productId && l.quantity > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Receive Stock</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-12 items-end gap-2">
              <div className="col-span-5">
                {i === 0 && <label className="mb-1 block text-xs font-medium text-gray-500">Product</label>}
                <select
                  value={line.productId}
                  onChange={(e) => updateLine(i, 'productId', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Select product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                {i === 0 && <label className="mb-1 block text-xs font-medium text-gray-500">Quantity</label>}
                <input
                  type="number" min={1} value={line.quantity}
                  onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div className="col-span-3">
                {i === 0 && <label className="mb-1 block text-xs font-medium text-gray-500">Unit Cost</label>}
                <input
                  type="number" min={0} value={line.unitCost}
                  onChange={(e) => updateLine(i, 'unitCost', Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div className="col-span-1 flex justify-center pb-0.5">
                {lines.length > 1 && (
                  <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400">
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addLine}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-700"
        >
          <Plus size={13} /> Add line
        </button>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">Notes (optional)</label>
          <input
            value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Reference, supplier, delivery note number…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            onClick={() => onSubmit(lines, notes)}
            disabled={!valid || isLoading}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            Receive Stock
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WarehousePage() {
  const businessId  = useAppStore((s) => s.currentBusiness?.business.id);
  const currentUser = useAppStore((s) => s.currentUser);
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [receiveOpen, setReceiveOpen] = useState(false);

  const { data: locations } = useQuery({
    queryKey: ['locations', businessId],
    queryFn: () => repos.inventory.findLocations(businessId!),
    enabled: Boolean(businessId),
  });

  const { data: balances, isLoading: balancesLoading } = useQuery({
    queryKey: ['inventory_balances', businessId, locationFilter],
    queryFn: () =>
      repos.inventory.findAllWithDetails(
        businessId!,
        locationFilter !== 'all' ? locationFilter : undefined,
      ),
    enabled: Boolean(businessId),
  });

  const { data: products } = useQuery({
    queryKey: ['products_trackable', businessId],
    queryFn: () => repos.inventory.findTrackableProducts(businessId!),
    enabled: Boolean(businessId),
  });

  const warehouseLocation = locations?.find((l) => l.is_default);

  const receiveMutation = useMutation({
    mutationFn: async ({ lines, notes }: { lines: ReceiveLineForm[]; notes: string }) => {
      if (!warehouseLocation) throw new Error('No warehouse location found');
      const movements = lines.map((l) => ({
        business_id: businessId!,
        product_id: l.productId,
        location_id: warehouseLocation.id,
        movement_type: 'purchase' as const,
        movement_date: new Date().toISOString().slice(0, 10),
        quantity: l.quantity,
        unit_cost: l.unitCost,
        total_cost: l.quantity * l.unitCost,
        notes: notes || null,
        created_by: currentUser?.id ?? null,
      }));
      return repos.inventory.recordMovements(movements);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory_balances', businessId] });
      setReceiveOpen(false);
    },
  });

  const filtered = (balances ?? []).filter((b) => {
    const name = b.products?.name ?? '';
    const sku  = b.products?.sku ?? '';
    return (
      name.toLowerCase().includes(search.toLowerCase()) ||
      sku.toLowerCase().includes(search.toLowerCase())
    );
  });

  const lowStock = filtered.filter((b) => {
    const reorderLevel = b.products?.reorder_level;
    return reorderLevel != null && Number(b.quantity_available) <= Number(reorderLevel);
  });

  if (!businessId) return null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Warehouse</h1>
          <p className="mt-1 text-sm text-gray-500">Stock levels across all locations</p>
        </div>
        <button
          onClick={() => setReceiveOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
        >
          <Plus size={16} /> Receive Stock
        </button>
      </div>

      {lowStock.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <AlertTriangle size={16} className="text-amber-500" />
          <p className="text-sm text-amber-700">
            <span className="font-semibold">{lowStock.length} product{lowStock.length > 1 ? 's' : ''}</span>{' '}
            at or below reorder level
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="relative">
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="appearance-none rounded-xl border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-brand-500 focus:outline-none"
          >
            <option value="all">All locations</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-soft">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {['Product', 'Location', 'On Hand', 'Reserved', 'Available', 'Avg Cost', 'Stock Value', 'Status'].map((h, i) => (
                <th key={h} className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 ${i >= 2 && i <= 6 ? 'text-right' : i === 7 ? 'text-center' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {balancesLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-5 py-4"><div className="h-3 rounded bg-gray-100" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Warehouse size={28} className="text-gray-200" />
                    <p className="text-sm text-gray-400">No stock records found</p>
                    <p className="text-xs text-gray-300">Receive stock to start tracking inventory</p>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((b) => {
                const reorderLevel = b.products?.reorder_level;
                const available   = Number(b.quantity_available ?? 0);
                const isLow       = reorderLevel != null && available <= Number(reorderLevel);
                const stockValue  = available * Number(b.average_cost);

                return (
                  <tr key={b.id} className="transition-colors hover:bg-gray-50/50">
                    <td className="px-5 py-3.5">
                      <p className="font-medium text-gray-800">{b.products?.name ?? '—'}</p>
                      {b.products?.sku && <p className="text-xs text-gray-400">{b.products.sku}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{b.inventory_locations?.name ?? '—'}</td>
                    <td className="px-5 py-3.5 text-right font-medium text-gray-800">{Number(b.quantity_on_hand).toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right text-gray-500">{Number(b.quantity_reserved).toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-800">{available.toLocaleString()}</td>
                    <td className="px-5 py-3.5 text-right text-gray-500">{formatMwk(Number(b.average_cost))}</td>
                    <td className="px-5 py-3.5 text-right font-semibold text-gray-800">{formatMwk(stockValue)}</td>
                    <td className="px-5 py-3.5 text-center">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${isLow ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-brand-600'}`}>
                        {isLow ? 'Low Stock' : 'OK'}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <ReceiveStockModal
        open={receiveOpen}
        products={products ?? []}
        onClose={() => setReceiveOpen(false)}
        onSubmit={(lines, notes) => receiveMutation.mutate({ lines, notes })}
        isLoading={receiveMutation.isPending}
      />
    </div>
  );
}
