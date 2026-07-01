import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight, Plus, Search, X, Loader2, Truck,
  CheckCircle, Printer,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { useIsMobile } from '@/hooks/useIsMobile';
import type { Row } from '@/dal/types/database';
import type { TransferWithLines, TransferStatus } from '@/dal/repositories/TransferRepository';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS: Record<TransferStatus, { label: string; bg: string; text: string }> = {
  draft:            { label: 'Draft',           bg: 'bg-gray-100',   text: 'text-gray-500'   },
  pending_approval: { label: 'Pending Approval', bg: 'bg-amber-50',   text: 'text-amber-600'  },
  approved:         { label: 'Approved',         bg: 'bg-blue-50',    text: 'text-blue-600'   },
  dispatched:       { label: 'Dispatched',       bg: 'bg-purple-50',  text: 'text-purple-600' },
  received:         { label: 'Received',         bg: 'bg-emerald-50', text: 'text-brand-600'  },
};

// ── Delivery note printer ─────────────────────────────────────────────────────

function printDeliveryNote(
  transfer: Row<'stock_transfers'>,
  lines: Row<'stock_transfer_lines'>[],
  locations: Row<'inventory_locations'>[],
  products: Row<'products'>[],
  businessName: string,
) {
  const fromLoc = locations.find((l) => l.id === transfer.from_location_id)?.name ?? '—';
  const toLoc   = locations.find((l) => l.id === transfer.to_location_id)?.name ?? '—';

  const lineRows = lines.map((l) => {
    const p = products.find((p) => p.id === l.product_id);
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;">${p?.name ?? '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:center;">${p?.sku ?? '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">${Number(l.quantity_requested)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">${l.quantity_dispatched != null ? Number(l.quantity_dispatched) : '—'}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;text-align:right;">${l.quantity_received != null ? Number(l.quantity_received) : '—'}</td>
    </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Delivery Note – ${transfer.transfer_number}</title>
<style>
  body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:32px;}
  h1{font-size:22px;margin:0 0 4px;color:#1D9E75;}
  .meta{display:flex;justify-content:space-between;margin-bottom:24px;}
  .label{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;}
  table{width:100%;border-collapse:collapse;margin-top:16px;}
  thead tr{background:#f9fafb;}
  th{padding:8px 12px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:2px solid #e5e7eb;text-align:left;}
  th:nth-child(n+3){text-align:right;}th:nth-child(2){text-align:center;}
  .footer{margin-top:40px;display:flex;justify-content:space-between;}
  .sig-line{border-top:1px solid #d1d5db;margin-top:40px;padding-top:6px;font-size:11px;color:#9ca3af;}
  .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:600;background:#ecfdf5;color:#1D9E75;}
</style></head><body>
<h1>${businessName}</h1>
<p style="color:#6b7280;margin:0 0 24px;">Delivery Note / Waybill</p>
<div class="meta">
  <div>
    <div class="label">Transfer No.</div><strong>${transfer.transfer_number}</strong>
    <br/><div class="label" style="margin-top:8px">Status</div>
    <span class="badge">${STATUS[transfer.status as TransferStatus]?.label ?? transfer.status}</span>
  </div>
  <div style="text-align:right">
    <div class="label">Date</div>
    ${new Date(transfer.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}
    ${transfer.dispatched_at ? `<br/><div class="label" style="margin-top:8px">Dispatched</div>${new Date(transfer.dispatched_at).toLocaleDateString('en-GB')}` : ''}
    ${transfer.received_at ? `<br/><div class="label" style="margin-top:8px">Received</div>${new Date(transfer.received_at).toLocaleDateString('en-GB')}` : ''}
  </div>
</div>
<div class="meta">
  <div><div class="label">From</div><strong>${fromLoc}</strong></div>
  <div style="font-size:22px;color:#d1d5db;align-self:center;">→</div>
  <div style="text-align:right"><div class="label">To</div><strong>${toLoc}</strong></div>
</div>
${transfer.notes ? `<p style="background:#f9fafb;padding:10px 14px;border-radius:8px;color:#6b7280;font-size:12px;">${transfer.notes}</p>` : ''}
<table><thead><tr>
  <th>Product</th><th style="text-align:center">SKU</th>
  <th style="text-align:right">Requested</th>
  <th style="text-align:right">Dispatched</th>
  <th style="text-align:right">Received</th>
</tr></thead><tbody>${lineRows}</tbody></table>
<div class="footer">
  <div style="width:200px"><div class="sig-line">Dispatched by</div></div>
  <div style="width:200px"><div class="sig-line">Received by</div></div>
</div>
</body></html>`;

  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

// ── Create transfer modal ─────────────────────────────────────────────────────
// 1-column stacked layout on mobile (below sm), original 12-column grid on
// larger screens — same fields, same submit logic.

interface TransferLineForm {
  productId: string;
  quantityRequested: number;
  unitCost: number;
}

function CreateTransferModal({
  open,
  locations,
  products,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  locations: Row<'inventory_locations'>[];
  products: Row<'products'>[];
  onClose: () => void;
  onSubmit: (fromId: string, toId: string, lines: TransferLineForm[], notes: string) => void;
  isLoading: boolean;
}) {
  const [fromId, setFromId] = useState('');
  const [toId, setToId]     = useState('');
  const [notes, setNotes]   = useState('');
  const [lines, setLines]   = useState<TransferLineForm[]>([
    { productId: '', quantityRequested: 1, unitCost: 0 },
  ]);

  if (!open) return null;

  const addLine    = () => setLines((l) => [...l, { productId: '', quantityRequested: 1, unitCost: 0 }]);
  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof TransferLineForm, value: string | number) =>
    setLines((l) => l.map((line, idx) => {
      if (idx !== i) return line;
      if (field === 'productId') {
        const p = products.find((p) => p.id === value);
        return { ...line, productId: value as string, unitCost: p ? Number(p.purchase_price) : 0 };
      }
      return { ...line, [field]: value };
    }));

  const valid = fromId && toId && fromId !== toId && lines.every((l) => l.productId && l.quantityRequested > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-5 sm:p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">New Stock Transfer</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">From Location</label>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none">
              <option value="">Select…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">To Location</label>
            <select value={toId} onChange={(e) => setToId(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none">
              <option value="">Select…</option>
              {locations.filter((l) => l.id !== fromId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        </div>

        <div className="max-h-56 space-y-3 overflow-y-auto pr-1">
          {lines.map((line, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-12 sm:items-end">
              <div className="sm:col-span-6">
                <label className="mb-1 block text-xs font-medium text-gray-500">Product</label>
                <select value={line.productId} onChange={(e) => updateLine(i, 'productId', e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none">
                  <option value="">Select product…</option>
                  {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:col-span-6 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Qty</label>
                  <input type="number" min={1} value={line.quantityRequested}
                    onChange={(e) => updateLine(i, 'quantityRequested', Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500">Cost</label>
                  <input type="number" min={0} value={line.unitCost}
                    onChange={(e) => updateLine(i, 'unitCost', Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-200 px-2 py-2 text-sm focus:border-brand-500 focus:outline-none" />
                </div>
                <div className="flex items-end justify-end pb-0.5">
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-400"><X size={15} /></button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={addLine} className="mt-2 flex items-center gap-1.5 text-xs font-medium text-brand-500 hover:text-brand-700">
          <Plus size={13} /> Add product
        </button>

        <div className="mt-3">
          <label className="mb-1 block text-xs font-medium text-gray-500">Notes (optional)</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Reason for transfer, instructions…"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={() => onSubmit(fromId, toId, lines, notes)} disabled={!valid || isLoading}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            Create Transfer
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Transfer detail drawer ────────────────────────────────────────────────────
// Already renders full-width on small screens (max-w-lg only kicks in above
// that breakpoint), so no structural change needed here — left as-is.

function TransferDrawer({
  data, locations, products, businessName, isOwner,
  onClose, onApprove, onDispatch, onReceive, isMutating,
}: {
  data: TransferWithLines;
  locations: Row<'inventory_locations'>[];
  products: Row<'products'>[];
  businessName: string;
  isOwner: boolean;
  onClose: () => void;
  onApprove: () => void;
  onDispatch: (quantities: { lineId: string; quantityDispatched: number }[]) => void;
  onReceive: (quantities: { lineId: string; quantityReceived: number }[]) => void;
  isMutating: boolean;
}) {
  const { transfer, lines } = data;
  const [dispatchQtys, setDispatchQtys] = useState<Record<string, number>>(
    Object.fromEntries(lines.map((l: Row<'stock_transfer_lines'>) => [l.id, Number(l.quantity_requested)])),
  );
  const [receiveQtys, setReceiveQtys] = useState<Record<string, number>>(
    Object.fromEntries(lines.map((l: Row<'stock_transfer_lines'>) => [l.id, Number(l.quantity_dispatched ?? l.quantity_requested)])),
  );

  const fromLoc = locations.find((l) => l.id === transfer.from_location_id)?.name ?? '—';
  const toLoc   = locations.find((l) => l.id === transfer.to_location_id)?.name ?? '—';
  const status  = STATUS[transfer.status as TransferStatus] ?? STATUS.draft;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white px-6 py-4">
          <div>
            <p className="text-xs text-gray-400">Transfer</p>
            <p className="font-semibold text-gray-900">{transfer.transfer_number}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => printDeliveryNote(transfer, lines, locations, products, businessName)}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              <Printer size={13} /> Delivery Note
            </button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
            <div className="text-center">
              <p className="text-xs text-gray-400">From</p>
              <p className="text-sm font-semibold text-gray-800">{fromLoc}</p>
            </div>
            <ArrowRight size={16} className="mx-auto flex-1 flex-shrink-0 text-gray-300" />
            <div className="text-center">
              <p className="text-xs text-gray-400">To</p>
              <p className="text-sm font-semibold text-gray-800">{toLoc}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="mb-1 text-xs text-gray-400">Status</p>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${status.bg} ${status.text}`}>
                {status.label}
              </span>
            </div>
            {transfer.dispatched_at && (
              <div>
                <p className="mb-1 text-xs text-gray-400">Dispatched</p>
                <p className="text-sm text-gray-700">{new Date(transfer.dispatched_at).toLocaleDateString('en-GB')}</p>
              </div>
            )}
            {transfer.received_at && (
              <div>
                <p className="mb-1 text-xs text-gray-400">Received</p>
                <p className="text-sm text-gray-700">{new Date(transfer.received_at).toLocaleDateString('en-GB')}</p>
              </div>
            )}
          </div>

          {transfer.notes && (
            <div className="rounded-xl bg-gray-50 px-4 py-3 text-sm text-gray-600">{transfer.notes}</div>
          )}

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Items</p>
            <div className="space-y-2">
              {lines.map((line: Row<'stock_transfer_lines'>) => {
                const product = products.find((p) => p.id === line.product_id);
                return (
                  <div key={line.id} className="rounded-xl border border-gray-100 p-3">
                    <p className="text-sm font-medium text-gray-800">{product?.name ?? '—'}</p>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-gray-400">Requested</p>
                        <p className="font-semibold text-gray-700">{Number(line.quantity_requested)}</p>
                      </div>
                      <div>
                        <p className="text-gray-400">Dispatched</p>
                        {transfer.status === 'approved' ? (
                          <input type="number" min={0} max={Number(line.quantity_requested)}
                            value={dispatchQtys[line.id] ?? Number(line.quantity_requested)}
                            onChange={(e) => setDispatchQtys((q) => ({ ...q, [line.id]: Number(e.target.value) }))}
                            className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-xs focus:border-brand-500 focus:outline-none" />
                        ) : (
                          <p className="font-semibold text-gray-700">
                            {line.quantity_dispatched != null ? Number(line.quantity_dispatched) : '—'}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-gray-400">Received</p>
                        {transfer.status === 'dispatched' ? (
                          <input type="number" min={0} max={Number(line.quantity_dispatched ?? line.quantity_requested)}
                            value={receiveQtys[line.id] ?? Number(line.quantity_dispatched ?? line.quantity_requested)}
                            onChange={(e) => setReceiveQtys((q) => ({ ...q, [line.id]: Number(e.target.value) }))}
                            className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-xs focus:border-brand-500 focus:outline-none" />
                        ) : (
                          <p className="font-semibold text-gray-700">
                            {line.quantity_received != null ? Number(line.quantity_received) : '—'}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-2">
            {transfer.status === 'pending_approval' && isOwner && (
              <button onClick={onApprove} disabled={isMutating}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 py-2.5 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50">
                {isMutating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={16} />}
                Approve Transfer
              </button>
            )}
            {transfer.status === 'approved' && isOwner && (
              <button
                onClick={() => onDispatch(lines.map((l: Row<'stock_transfer_lines'>) => ({ lineId: l.id, quantityDispatched: dispatchQtys[l.id] ?? Number(l.quantity_requested) })))}
                disabled={isMutating}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-500 py-2.5 text-sm font-semibold text-white hover:bg-purple-600 disabled:opacity-50">
                {isMutating ? <Loader2 size={14} className="animate-spin" /> : <Truck size={16} />}
                Dispatch
              </button>
            )}
            {transfer.status === 'dispatched' && (
              <button
                onClick={() => onReceive(lines.map((l: Row<'stock_transfer_lines'>) => ({ lineId: l.id, quantityReceived: receiveQtys[l.id] ?? Number(l.quantity_dispatched ?? l.quantity_requested) })))}
                disabled={isMutating}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50">
                {isMutating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={16} />}
                Confirm Receipt
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Mobile transfer card ────────────────────────────────────────────────────

function TransferCard({
  transfer,
  fromName,
  toName,
  onClick,
}: {
  transfer: Row<'stock_transfers'>;
  fromName: string;
  toName: string;
  onClick: () => void;
}) {
  const status = STATUS[transfer.status as TransferStatus] ?? STATUS.draft;
  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm active:scale-[0.99] transition-transform"
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-900">{transfer.transfer_number}</p>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${status.bg} ${status.text}`}>
          {status.label}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="truncate">{fromName}</span>
        <ArrowRight size={12} className="shrink-0 text-gray-300" />
        <span className="truncate">{toName}</span>
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        {new Date(transfer.created_at).toLocaleDateString('en-GB')}
      </p>
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TransfersPage() {
  const businessId   = useAppStore((s) => s.currentBusiness?.business.id);
  const currentUser  = useAppStore((s) => s.currentUser);
  const businesses   = useAppStore((s) => s.businesses);
  const businessName = useAppStore((s) => s.currentBusiness?.business.name ?? 'Business');
  const queryClient  = useQueryClient();
  const isMobile     = useIsMobile();

  const membership = businesses.find((m) => m.business.id === businessId);
  const isOwner    = membership?.role === 'owner';
  const currentUserId = currentUser?.id ?? '';

  const [createOpen, setCreateOpen]           = useState(false);
  const [statusFilter, setStatusFilter]       = useState<TransferStatus | 'all'>('all');
  const [search, setSearch]                   = useState('');
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);

  const { data: transfers, isLoading } = useQuery({
    queryKey: ['transfers', businessId, statusFilter],
    queryFn: () => repos.transfer.findByBusiness(businessId!, statusFilter === 'all' ? undefined : statusFilter),
    enabled: Boolean(businessId),
  });

  const { data: locations } = useQuery({
    queryKey: ['locations', businessId],
    queryFn: () => repos.inventory.findLocations(businessId!),
    enabled: Boolean(businessId),
  });

  const { data: products } = useQuery({
    queryKey: ['products_all', businessId],
    queryFn: () => repos.inventory.findAllProducts(businessId!),
    enabled: Boolean(businessId),
  });

  const { data: selectedDetail } = useQuery({
    queryKey: ['transfer_detail', selectedTransferId],
    queryFn: () => repos.transfer.findWithLines(selectedTransferId!),
    enabled: Boolean(selectedTransferId),
  });

  const createMutation = useMutation({
    mutationFn: async ({ fromLocationId, toLocationId, lines, notes }: {
      fromLocationId: string;
      toLocationId: string;
      lines: TransferLineForm[];
      notes: string;
    }) => {
      const transferNumber = await repos.transfer.generateTransferNumber(businessId!);
      const status: TransferStatus = isOwner ? 'approved' : 'pending_approval';

      return repos.transfer.createWithLines(
        {
          business_id: businessId!,
          transfer_number: transferNumber,
          from_location_id: fromLocationId,
          to_location_id: toLocationId,
          status,
          requested_by: currentUserId,
          approved_by: isOwner ? currentUserId : null,
          approved_at: isOwner ? new Date().toISOString() : null,
          notes: notes || null,
          dispatched_at: null,
          received_at: null,
          received_by: null,
        },
        lines.map((l) => ({
          business_id: businessId!,
          product_id: l.productId,
          quantity_requested: l.quantityRequested,
          quantity_dispatched: null,
          quantity_received: null,
          unit_cost: l.unitCost,
          notes: null,
        })),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers', businessId] });
      setCreateOpen(false);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (transferId: string) =>
      repos.transfer.updateStatus(transferId, 'approved', {
        approved_by: currentUserId,
        approved_at: new Date().toISOString(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers', businessId] });
      queryClient.invalidateQueries({ queryKey: ['transfer_detail', selectedTransferId] });
    },
  });

  const dispatchMutation = useMutation({
    mutationFn: ({ transferId, quantities }: { transferId: string; quantities: { lineId: string; quantityDispatched: number }[] }) =>
      repos.transfer.dispatch(transferId, currentUserId, quantities),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers', businessId] });
      queryClient.invalidateQueries({ queryKey: ['transfer_detail', selectedTransferId] });
      queryClient.invalidateQueries({ queryKey: ['inventory_balances', businessId] });
    },
  });

  const receiveMutation = useMutation({
    mutationFn: ({ transferId, quantities }: { transferId: string; quantities: { lineId: string; quantityReceived: number }[] }) =>
      repos.transfer.confirmReceipt(transferId, currentUserId, quantities),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transfers', businessId] });
      queryClient.invalidateQueries({ queryKey: ['transfer_detail', selectedTransferId] });
      queryClient.invalidateQueries({ queryKey: ['inventory_balances', businessId] });
    },
  });

  const isMutating = approveMutation.isPending || dispatchMutation.isPending || receiveMutation.isPending;
  const locMap     = new Map((locations ?? []).map((l) => [l.id, l.name]));
  const filtered   = (transfers ?? []).filter((t: Row<'stock_transfers'>) => t.transfer_number.toLowerCase().includes(search.toLowerCase()));

  if (!businessId) return null;

  return (
    <div className={isMobile ? 'pb-4' : undefined}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className={isMobile ? 'text-lg font-semibold text-gray-900' : 'text-2xl font-semibold text-gray-900'}>Stock Transfers</h1>
          {!isMobile && <p className="mt-1 text-sm text-gray-500">Dispatch stock between warehouse and branches</p>}
        </div>
        <button onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">
          <Plus size={16} /> {isMobile ? 'New' : 'New Transfer'}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-48 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by transfer number…"
            className="w-full rounded-xl border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none" />
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-gray-200 bg-white p-1">
          {(['all', 'pending_approval', 'approved', 'dispatched', 'received'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${statusFilter === s ? 'bg-brand-500 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              {s === 'all' ? 'All' : STATUS[s]?.label}
            </button>
          ))}
        </div>
      </div>

      {isMobile ? (
        // ── Mobile: card list ──────────────────────────────────────────────
        isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-12 text-center">
            <Truck size={28} className="mb-2 text-gray-200" />
            <p className="text-sm text-gray-400">No transfers yet</p>
            <p className="text-xs text-gray-300">Create a transfer to dispatch stock to a branch</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((t: Row<'stock_transfers'>) => (
              <TransferCard
                key={t.id}
                transfer={t}
                fromName={locMap.get(t.from_location_id) ?? '—'}
                toName={locMap.get(t.to_location_id) ?? '—'}
                onClick={() => setSelectedTransferId(t.id)}
              />
            ))}
          </div>
        )
      ) : (
        // ── Desktop: table ─────────────────────────────────────────────────
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-soft">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Transfer #', 'From', 'To', 'Date', 'Status', ''].map((h) => (
                  <th key={h} className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-400 ${h === 'Status' ? 'text-center' : 'text-left'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-5 py-4"><div className="h-3 rounded bg-gray-100" /></td>
                    ))}
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Truck size={28} className="text-gray-200" />
                      <p className="text-sm text-gray-400">No transfers yet</p>
                      <p className="text-xs text-gray-300">Create a transfer to dispatch stock to a branch</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((t: Row<'stock_transfers'>) => {
                  const status = STATUS[t.status as TransferStatus] ?? STATUS.draft;
                  return (
                    <tr key={t.id} onClick={() => setSelectedTransferId(t.id)}
                      className="cursor-pointer transition-colors hover:bg-gray-50/50">
                      <td className="px-5 py-3.5 font-semibold text-gray-800">{t.transfer_number}</td>
                      <td className="px-5 py-3.5 text-gray-600">{locMap.get(t.from_location_id) ?? '—'}</td>
                      <td className="px-5 py-3.5 text-gray-600">{locMap.get(t.to_location_id) ?? '—'}</td>
                      <td className="px-5 py-3.5 text-gray-500">{new Date(t.created_at).toLocaleDateString('en-GB')}</td>
                      <td className="px-5 py-3.5 text-center">
                        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${status.bg} ${status.text}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right"><ArrowRight size={14} className="text-gray-300" /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      <CreateTransferModal
        open={createOpen}
        locations={locations ?? []}
        products={products ?? []}
        onClose={() => setCreateOpen(false)}
        onSubmit={(from, to, lines, notes) =>
          createMutation.mutate({ fromLocationId: from, toLocationId: to, lines, notes })
        }
        isLoading={createMutation.isPending}
      />

      {selectedDetail && (
        <TransferDrawer
          data={selectedDetail}
          locations={locations ?? []}
          products={products ?? []}
          businessName={businessName}
          isOwner={isOwner}
          onClose={() => setSelectedTransferId(null)}
          onApprove={() => approveMutation.mutate(selectedDetail.transfer.id)}
          onDispatch={(quantities) => dispatchMutation.mutate({ transferId: selectedDetail.transfer.id, quantities })}
          onReceive={(quantities) => receiveMutation.mutate({ transferId: selectedDetail.transfer.id, quantities })}
          isMutating={isMutating}
        />
      )}
    </div>
  );
}
