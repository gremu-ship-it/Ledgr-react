import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, AlertTriangle, Warehouse, Loader2, X, ChevronDown, AlertCircle,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { formatMwk } from '@/lib/formatters';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Row } from '@/dal/types/database';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReceiveLineForm {
  productId: string;
  quantity: number;
  unitCost: number;
}

// ── Receive Stock Modal ───────────────────────────────────────────────────────
// FIX: Added `locationId` field so the user can pick which location to receive
// into. Previously the modal used a hard-coded default location lookup, which
// silently failed (and did nothing) when no default location was configured.

function ReceiveStockModal({
  open,
  products,
  locations,
  onClose,
  onSubmit,
  isLoading,
  error,
}: {
  open: boolean;
  products: Row<'products'>[];
  locations: Row<'inventory_locations'>[];
  onClose: () => void;
  onSubmit: (lines: ReceiveLineForm[], locationId: string, notes: string) => void;
  isLoading: boolean;
  error: string | null;
}) {
  const [lines, setLines] = useState<ReceiveLineForm[]>([
    { productId: '', quantity: 1, unitCost: 0 },
  ]);
  const [notes, setNotes] = useState('');
  // Pre-select the default location if one exists
  const defaultLocation = locations.find((l) => l.is_default);
  const [locationId, setLocationId] = useState(defaultLocation?.id ?? '');

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
          return {
            ...line,
            productId: value as string,
            unitCost: p ? Number(p.purchase_price) : 0,
          };
        }
        return { ...line, [field]: value };
      }),
    );

  const valid =
    lines.every((l) => l.productId && l.quantity > 0) && Boolean(locationId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-card p-5 sm:p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Receive Stock</h2>
          <button onClick={onClose} className="text-muted hover:text-sub">
            <X size={18} />
          </button>
        </div>

        {/* FIX: surface any mutation error inside the modal */}
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger">
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {/* FIX: location picker — required, pre-filled with default if available */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-muted">
            Receive into location <span className="text-danger">*</span>
          </label>
          {locations.length === 0 ? (
            <p className="rounded-lg border border-warning/20 bg-warning/12 px-3 py-2 text-xs text-warning">
              No warehouse locations found. Go to Settings → Locations to add one first.
            </p>
          ) : (
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">Select location…</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}{l.is_default ? ' (default)' : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-5">
                <label className="mb-1 block text-xs font-medium text-muted">Product</label>
                <select
                  value={line.productId}
                  onChange={(e) => updateLine(i, 'productId', e.target.value)}
                  className="w-full rounded-lg border border-line px-2 py-2 text-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Select product…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:col-span-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Quantity</label>
                  <input
                    type="number" min={1} value={line.quantity}
                    onChange={(e) => updateLine(i, 'quantity', Number(e.target.value))}
                    className="w-full rounded-lg border border-line px-2 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted">Unit Cost</label>
                  <input
                    type="number" min={0} value={line.unitCost}
                    onChange={(e) => updateLine(i, 'unitCost', Number(e.target.value))}
                    className="w-full rounded-lg border border-line px-2 py-2 text-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-end justify-end pb-0.5">
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} className="text-muted/50 hover:text-danger">
                      <X size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={addLine}
          className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:text-brand-300"
        >
          <Plus size={13} /> Add line
        </button>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-muted">Notes (optional)</label>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Reference, supplier, delivery note number…"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(lines, locationId, notes)}
            disabled={!valid || isLoading}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            Receive Stock
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared row type ───────────────────────────────────────────────────────────

type BalanceRow = Awaited<ReturnType<typeof repos.inventory.findAllWithDetails>>[number];

// ── Mobile stock card ─────────────────────────────────────────────────────────

function StockCard({ balance }: { balance: BalanceRow }) {
  const reorderLevel = balance.products?.reorder_level;
  const available    = Number(balance.quantity_available ?? 0);
  const isLow        = reorderLevel != null && available <= Number(reorderLevel);
  const stockValue   = available * Number(balance.average_cost);

  return (
    <div className="rounded-2xl border border-line bg-card p-4 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{balance.products?.name ?? '—'}</p>
          <p className="text-xs text-muted">
            {balance.products?.sku ?? '—'} · {balance.inventory_locations?.name ?? '—'}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${isLow ? 'bg-warning/12 text-warning' : 'bg-brand-500/10 text-brand-600 dark:text-brand-300'}`}>
          {isLow ? 'Low Stock' : 'OK'}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-center">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">On Hand</p>
          <p className="text-sm font-semibold text-ink">{Number(balance.quantity_on_hand).toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">Available</p>
          <p className="text-sm font-semibold text-ink">{available.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted">Value</p>
          <p className="text-sm font-semibold text-ink">{formatMwk(stockValue)}</p>
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
  const isMobile    = useIsMobile();

  const [search, setSearch]               = useState('');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [receiveOpen, setReceiveOpen]     = useState(false);
  const [receiveError, setReceiveError]   = useState<string | null>(null);

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

  // FIX: mutationFn now accepts locationId from the modal instead of looking
  // up the default location internally. onError is wired to surface errors
  // inside the modal rather than swallowing them.
  const receiveMutation = useMutation({
    mutationFn: async ({
      lines,
      locationId,
      notes,
    }: {
      lines: ReceiveLineForm[];
      locationId: string;
      notes: string;
    }) => {
      if (!locationId) throw new Error('Please select a location to receive stock into.');
      const movements = lines.map((l) => ({
        business_id:   businessId!,
        product_id:    l.productId,
        location_id:   locationId,
        movement_type: 'purchase' as const,
        movement_date: new Date().toISOString().slice(0, 10),
        quantity:      l.quantity,
        unit_cost:     l.unitCost,
        notes:         notes || null,
        created_by:    currentUser?.id ?? null,
      }));
      return repos.inventory.recordMovements(movements);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory_balances', businessId] });
      setReceiveError(null);
      setReceiveOpen(false);
    },
    onError: (err: Error) => {
      setReceiveError(err.message);
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
    <div className={isMobile ? 'pb-4' : undefined}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={isMobile ? 'text-lg font-semibold text-ink' : 'text-2xl font-semibold text-ink'}>
            Warehouse
          </h1>
          {!isMobile && <p className="mt-1 text-sm text-muted">Stock levels across all locations</p>}
        </div>
        <button
          onClick={() => { setReceiveError(null); setReceiveOpen(true); }}
          className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
        >
          <Plus size={16} /> {isMobile ? 'Receive' : 'Receive Stock'}
        </button>
      </div>

      {lowStock.length > 0 && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-warning/20 bg-warning/12 px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 text-warning" />
          <p className="text-sm text-warning">
            <span className="font-semibold">{lowStock.length} product{lowStock.length > 1 ? 's' : ''}</span>{' '}
            at or below reorder level
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="w-full rounded-xl border border-line bg-card py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <div className="relative">
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="appearance-none rounded-xl border border-line bg-card py-2 pl-3 pr-8 text-sm text-sub focus:border-brand-500 focus:outline-none"
          >
            <option value="all">All locations</option>
            {locations?.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted" />
        </div>
      </div>

      {isMobile ? (
        balancesLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-surface" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line py-12 text-center">
            <Warehouse size={28} className="mb-2 text-muted" />
            <p className="text-sm text-muted">No stock records found</p>
            <p className="text-xs text-muted/50">Receive stock to start tracking inventory</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => <StockCard key={b.id} balance={b} />)}
          </div>
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-bg">
                {['Product', 'Location', 'On Hand', 'Reserved', 'Available', 'Avg Cost', 'Stock Value', 'Status'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted ${
                      i >= 2 && i <= 6 ? 'text-right' : i === 7 ? 'text-center' : 'text-left'
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {balancesLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-5 py-4">
                        <div className="h-3 rounded bg-surface" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Warehouse size={28} className="text-muted" />
                      <p className="text-sm text-muted">No stock records found</p>
                      <p className="text-xs text-muted/50">Receive stock to start tracking inventory</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((b) => {
                  const reorderLevel = b.products?.reorder_level;
                  const available    = Number(b.quantity_available ?? 0);
                  const isLow        = reorderLevel != null && available <= Number(reorderLevel);
                  const stockValue   = available * Number(b.average_cost);

                  return (
                    <tr key={b.id} className="transition-colors hover:bg-bg/50">
                      <td className="px-5 py-3.5">
                        <p className="font-medium text-ink">{b.products?.name ?? '—'}</p>
                        {b.products?.sku && <p className="text-xs text-muted">{b.products.sku}</p>}
                      </td>
                      <td className="px-5 py-3.5 text-muted">{b.inventory_locations?.name ?? '—'}</td>
                      <td className="px-5 py-3.5 text-right font-medium text-ink">{Number(b.quantity_on_hand).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-muted">{Number(b.quantity_reserved).toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right font-semibold text-ink">{available.toLocaleString()}</td>
                      <td className="px-5 py-3.5 text-right text-muted">{formatMwk(Number(b.average_cost))}</td>
                      <td className="px-5 py-3.5 text-right font-semibold text-ink">{formatMwk(stockValue)}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${isLow ? 'bg-warning/12 text-warning' : 'bg-brand-500/10 text-brand-600 dark:text-brand-300'}`}>
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
      )}

      <ReceiveStockModal
        open={receiveOpen}
        products={products ?? []}
        locations={locations ?? []}
        onClose={() => { setReceiveOpen(false); setReceiveError(null); }}
        onSubmit={(lines, locationId, notes) =>
          receiveMutation.mutate({ lines, locationId, notes })
        }
        isLoading={receiveMutation.isPending}
        error={receiveError}
      />
    </div>
  );
}
