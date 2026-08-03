import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Boxes, ChevronDown, ChevronRight, FileDown,
  Package, Search, Warehouse,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { formatMwkDetailed } from '@/lib/formatters';
import {
  isLowStock,
  rollupByProduct,
  type ProductRollup,
} from '@/lib/inventoryRollup';

// ── CSV export ────────────────────────────────────────────────────────────────

function exportCsv(products: ProductRollup[]) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const headers = ['Product', 'SKU', 'On Hand', 'Reserved', 'Available', 'Avg Cost (MK)', 'Stock Value (MK)'];
  const rows = products.map((p) => [
    p.name,
    p.sku ?? '',
    String(p.onHand),
    String(p.reserved),
    String(p.available),
    p.weightedCost.toFixed(2),
    p.value.toFixed(2),
  ]);
  const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `inventory_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Small UI pieces ───────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon, accent }: {
  label: string; value: string; icon: ReactNode; accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'border-brand-200 bg-brand-50' : 'border-gray-200 bg-white'}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500">{icon}{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function fmtQty(n: number): string {
  return n.toLocaleString('en-MW', { maximumFractionDigits: 2 });
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function InventoryPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const [search, setSearch] = useState('');
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const { data: balances = [], isLoading } = useQuery({
    queryKey: ['inventory_balances', businessId],
    queryFn: () => repos.inventory.findAllWithDetails(businessId!),
    enabled: Boolean(businessId),
  });
  const { data: reorderAlerts = [] } = useQuery({
    queryKey: ['reorder_alerts', businessId],
    queryFn: () => repos.inventory.findReorderAlerts(businessId!),
    enabled: Boolean(businessId),
  });

  const products = useMemo(() => rollupByProduct(balances), [balances]);

  const totals = useMemo(() => ({
    units: products.reduce((s, p) => s + p.onHand, 0),
    reserved: products.reduce((s, p) => s + p.reserved, 0),
    value: products.reduce((s, p) => s + p.value, 0),
    lowStock: products.filter(isLowStock).length,
  }), [products]);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? products.filter((p) =>
        p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q))
    : products;

  function toggleRow(id: string) {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Inventory</h1>
        <p className="mt-1 text-sm text-gray-500">
          Stock position and valuation across all locations. Receive stock in{' '}
          <Link to="/warehouse" className="font-medium text-brand-600 hover:underline">Warehouse</Link>,
          move it in <Link to="/transfers" className="font-medium text-brand-600 hover:underline">Transfers</Link>.
        </p>
      </div>

      {/* Summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="Tracked Products" value={String(products.length)} icon={<Package className="h-4 w-4" />} />
        <SummaryCard label="Units On Hand" value={fmtQty(totals.units)} icon={<Boxes className="h-4 w-4" />} />
        <SummaryCard label="Stock Value" value={formatMwkDetailed(totals.value)} icon={<Warehouse className="h-4 w-4" />} accent />
        <SummaryCard label="Low-Stock Products" value={String(totals.lowStock)} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      {/* Reorder alerts */}
      {reorderAlerts.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {reorderAlerts.length} product{reorderAlerts.length !== 1 ? 's' : ''} at or below reorder level
          </div>
          <ul className="space-y-1 text-sm text-amber-900">
            {reorderAlerts.slice(0, 8).map((a, i) => (
              <li key={`${a.product_id}-${a.location_name}-${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{a.product_name ?? 'Unknown product'}</span>
                {a.location_name && <span className="text-xs text-amber-700">({a.location_name})</span>}
                <span className="text-xs">
                  — {fmtQty(Number(a.quantity_available ?? 0))} available · reorder level {fmtQty(Number(a.reorder_level ?? 0))}
                </span>
              </li>
            ))}
            {reorderAlerts.length > 8 && (
              <li className="text-xs text-amber-700">…and {reorderAlerts.length - 8} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="relative w-64">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search product or SKU…"
            aria-label="Search product or SKU"
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
          className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <FileDown className="h-4 w-4" />Export CSV
        </button>
      </div>

      {/* Stock table */}
      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th scope="col" className="px-4 py-3">Product</th>
              <th scope="col" className="px-4 py-3 text-right">On Hand</th>
              <th scope="col" className="px-4 py-3 text-right">Reserved</th>
              <th scope="col" className="px-4 py-3 text-right">Available</th>
              <th scope="col" className="px-4 py-3 text-right">Avg Cost</th>
              <th scope="col" className="px-4 py-3 text-right">Stock Value</th>
              <th scope="col" className="px-4 py-3">Locations</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                  {q
                    ? `No products match “${search}”.`
                    : 'No stock recorded yet. Receive your first stock in the Warehouse page.'}
                </td>
              </tr>
            )}
            {filtered.map((p) => {
              const open = openRows.has(p.productId);
              const low = isLowStock(p);
              return (
                <Fragment key={p.productId}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => toggleRow(p.productId)}
                        className="flex items-center gap-2 text-left"
                        aria-expanded={open}
                      >
                        {open
                          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" />}
                        <span>
                          <span className="font-medium text-gray-900">{p.name}</span>
                          {p.sku && <span className="ml-2 text-xs text-gray-400">{p.sku}</span>}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">{fmtQty(p.onHand)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{fmtQty(p.reserved)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${low ? 'text-amber-600' : ''}`}>
                      {fmtQty(p.available)}
                      {low && <AlertTriangle className="ml-1 inline h-3.5 w-3.5" aria-label="Below reorder level" />}
                    </td>
                    <td className="px-4 py-3 text-right">{formatMwkDetailed(p.weightedCost)}</td>
                    <td className="px-4 py-3 text-right font-medium">{formatMwkDetailed(p.value)}</td>
                    <td className="px-4 py-3 text-gray-500">{p.locations.length}</td>
                  </tr>
                  {open && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={7} className="px-4 pb-3 pt-0">
                        <table className="mt-1 min-w-full text-xs">
                          <thead>
                            <tr className="text-left uppercase tracking-wide text-gray-400">
                              <th scope="col" className="px-3 py-1.5">Location</th>
                              <th scope="col" className="px-3 py-1.5 text-right">On Hand</th>
                              <th scope="col" className="px-3 py-1.5 text-right">Reserved</th>
                              <th scope="col" className="px-3 py-1.5 text-right">Available</th>
                              <th scope="col" className="px-3 py-1.5 text-right">Avg Cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {p.locations.map((l) => (
                              <tr key={l.locationId}>
                                <td className="px-3 py-1.5 font-medium text-gray-700">{l.locationName}</td>
                                <td className="px-3 py-1.5 text-right">{fmtQty(l.onHand)}</td>
                                <td className="px-3 py-1.5 text-right text-gray-500">{fmtQty(l.reserved)}</td>
                                <td className="px-3 py-1.5 text-right">{fmtQty(l.available)}</td>
                                <td className="px-3 py-1.5 text-right">{formatMwkDetailed(l.averageCost)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
