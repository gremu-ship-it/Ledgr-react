import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AlertTriangle, CheckCircle2, FilePlus2, Plus, Search, Send, XCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  CONSTRUCTION_CAPABILITY_LABELS,
  type PurchaseOrderLineInput,
} from '@/dal/repositories/ConstructionProcurementRepository';
import { describeConstructionFailure } from '@/lib/construction/constructionCommandFeedback';
import {
  formatDateTime,
  formatMoney,
  formatQuantity,
  gateForCapability,
  matchesSearch,
  newIdempotencyKey,
} from '@/lib/construction/constructionWorkspaceView';
import {
  EmptyState,
  ErrorBanner,
  FailureBanner,
  Field,
  FIELD_CLASS,
  GatedButton,
  InfoNote,
  LoadingBlock,
  SectionCard,
  StatusPill,
  SuccessBanner,
} from '@/components/construction/constructionUi';
import { ConstructionDeliveryNoteForm } from '@/components/construction/ConstructionDeliveryNoteForm';
import { ConstructionGoodsReceiptForm } from '@/components/construction/ConstructionGoodsReceiptForm';

const PO_STATUS_STYLE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  authorized: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-700',
};

/**
 * Purchase orders: list, create, authorize, cancel — plus the two downstream
 * documents a purchase order authorizes (delivery-note evidence and a goods
 * receipt). Every action calls the database command; nothing is validated only
 * in the browser.
 */
export function ConstructionPurchaseOrdersSection({
  businessId,
  capabilities,
}: {
  businessId: string;
  capabilities: string[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedPoId = searchParams.get('po');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const baseCurrency = currentBusiness?.business?.base_currency ? String(currentBusiness.business.base_currency).toUpperCase() : '';

  const listQuery = useQuery({
    queryKey: ['construction', 'purchase-orders', businessId],
    queryFn: async () => {
      const [purchaseOrders, sites, contacts, products] = await Promise.all([
        repos.construction.findPurchaseOrders(businessId),
        repos.construction.findSites(businessId),
        repos.contact.findByBusiness(businessId),
        repos.inventory.findAllProducts(businessId),
      ]);
      return { purchaseOrders, sites, contacts, products };
    },
  });

  if (listQuery.isLoading) return <LoadingBlock label="Loading purchase orders…" />;
  if (listQuery.isError) {
    return (
      <ErrorBanner
        message={`Purchase orders could not be loaded: ${
          listQuery.error instanceof Error ? listQuery.error.message : 'unknown error'
        }`}
      />
    );
  }

  const { purchaseOrders, sites, contacts, products } = listQuery.data!;
  // Supplier identity is the existing business-scoped `contacts` record. The
  // server refuses a contact that is not an active supplier, so the list is a
  // narrowing for convenience only.
  const suppliers = contacts.filter((contact) => contact.is_active !== false && String(contact.contact_type ?? '').includes('supplier'));
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));

  const filtered = purchaseOrders.filter((po) =>
    matchesSearch([po.po_number, po.project_ref, po.status, po.currency, contactsById.get(po.supplier_contact_id)?.name, sitesById.get(po.site_id)?.site_code], search),
  );

  const selectPo = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('po', id);
    else next.delete('po');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      {notice ? <SuccessBanner message={notice} /> : null}

      <SectionCard
        title="Purchase orders"
        description="A purchase order authorizes procurement. It never moves stock, and it needs a different person to authorize it than the person who raised it."
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search number, supplier, project…"
                aria-label="Search purchase orders"
                className="w-56 rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <WithCapabilityButton
              capabilities={capabilities}
              capability={CONSTRUCTION_CAPABILITIES.poManage}
              onClick={() => setShowCreate((open) => !open)}
            >
              <>
                <Plus className="h-4 w-4" aria-hidden /> New purchase order
              </>
            </WithCapabilityButton>
          </>
        }
      >
        {sites.length === 0 ? (
          <EmptyState
            title="Register a construction site first"
            detail="A purchase order must name a registered site, which fixes its branch, inventory location and project reference."
          />
        ) : null}

        {showCreate && sites.length > 0 ? (
          <CreatePurchaseOrderForm
            businessId={businessId}
            sites={sites}
            suppliers={suppliers}
            products={products}
            baseCurrency={baseCurrency}
            onCreated={(poId, number) => {
              setShowCreate(false);
              setNotice(`Purchase order ${number} created as a draft. A different person must authorize it.`);
              selectPo(poId);
            }}
          />
        ) : null}

        {purchaseOrders.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No purchase orders yet" detail="Create the first one to start the procurement chain." />
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No purchase order matches that search" />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Number</th>
                  <th className="px-2 py-2">Supplier</th>
                  <th className="px-2 py-2">Site / project</th>
                  <th className="px-2 py-2">Currency</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((po) => (
                  <tr key={po.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 font-mono text-xs text-gray-800">{po.po_number}</td>
                    <td className="px-2 py-2 text-gray-800">{contactsById.get(po.supplier_contact_id)?.name ?? '—'}</td>
                    <td className="px-2 py-2 text-gray-700">
                      <span className="font-mono text-xs">{sitesById.get(po.site_id)?.site_code ?? '—'}</span>
                      <span className="ml-2 text-xs text-gray-500">{po.project_ref}</span>
                    </td>
                    <td className="px-2 py-2 text-gray-700">{po.currency}</td>
                    <td className="px-2 py-2">
                      <StatusPill label={po.status} className={PO_STATUS_STYLE[po.status] ?? 'bg-slate-100 text-slate-700'} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => selectPo(po.id === selectedPoId ? null : po.id)}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {po.id === selectedPoId ? 'Hide details' : 'Open'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selectedPoId ? (
        <PurchaseOrderDetail
          businessId={businessId}
          poId={selectedPoId}
          capabilities={capabilities}
          onNotice={setNotice}
          onClosed={() => selectPo(null)}
        />
      ) : null}
    </div>
  );
}

/** Small wrapper so the capability label and reason travel with the button. */
function WithCapabilityButton({
  capabilities,
  capability,
  onClick,
  children,
}: {
  capabilities: string[];
  capability: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const gate = gateForCapability(capabilities, capability, CONSTRUCTION_CAPABILITY_LABELS[capability] ?? capability);
  return (
    <GatedButton allowed={gate.allowed} reason={gate.reason} onClick={onClick}>
      {children}
    </GatedButton>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

interface DraftLine {
  product_id: string;
  uom: string;
  quantity_ordered: string;
  expected_unit_price: string;
  line_note: string;
}

const EMPTY_LINE: DraftLine = { product_id: '', uom: '', quantity_ordered: '1', expected_unit_price: '', line_note: '' };

function CreatePurchaseOrderForm({
  businessId,
  sites,
  suppliers,
  products,
  baseCurrency,
  onCreated,
}: {
  businessId: string;
  sites: Array<{ id: string; site_code: string; site_name: string; project_ref: string }>;
  suppliers: Array<{ id: string; name: string }>;
  products: Array<{ id: string; name: string; unit_of_measure?: string | null }>;
  baseCurrency: string;
  onCreated: (poId: string, number: string) => void;
}) {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  const [supplierId, setSupplierId] = useState('');
  const [currency, setCurrency] = useState(baseCurrency || 'MWK');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);
  // One retry key per form submission. Retrying after a network failure reuses it,
  // so the server returns the committed purchase order instead of creating a
  // second one; editing the form afterwards starts a new key.
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        business_id: businessId,
        site_id: siteId,
        supplier_contact_id: supplierId,
        currency: currency.trim().toUpperCase(),
        notes: notes.trim() || null,
        lines: lines
          .filter((line) => line.product_id)
          .map<PurchaseOrderLineInput>((line) => ({
            product_id: line.product_id,
            uom: line.uom,
            quantity_ordered: line.quantity_ordered,
            expected_unit_price: line.expected_unit_price || null,
            line_note: line.line_note.trim() || null,
          })),
      };
      return repos.construction.createPurchaseOrder(payload, clientKey);
    },
    onSuccess: (result) => {
      setClientKey(newIdempotencyKey());
      setLines([{ ...EMPTY_LINE }]);
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['construction', 'purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['construction', 'overview'] });
      onCreated(String(result.id), String(result.number ?? ''));
    },
  });

  const canSubmit = Boolean(siteId && supplierId && currency.trim().length === 3 && lines.some((line) => line.product_id && line.uom && line.quantity_ordered));

  return (
    <form
      className="mt-4 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Construction site" required>
          <select aria-label="Construction site" value={siteId} onChange={(event) => setSiteId(event.target.value)} className={FIELD_CLASS}>
            <option value="">Select a site…</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.site_code} — {site.site_name} ({site.project_ref})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier" required hint="Only active supplier contacts of this business can be used.">
          <select aria-label="Supplier" value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className={FIELD_CLASS}>
            <option value="">Select a supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Order currency" required hint="The bill that later matches this order must be in the same currency.">
          <input aria-label="Order currency" value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} className={FIELD_CLASS} />
        </Field>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-800">Lines</h4>
          <button
            type="button"
            onClick={() => setLines((current) => [...current, { ...EMPTY_LINE }])}
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
          >
            <Plus className="h-4 w-4" aria-hidden /> Add line
          </button>
        </div>
        {lines.map((line, index) => {
          const product = productsById.get(line.product_id);
          const baseUom = product?.unit_of_measure ? String(product.unit_of_measure).toUpperCase() : '';
          return (
            <div key={index} className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-5">
              <Field label={`Line ${index + 1} product`}>
                <select
                  aria-label={`Line ${index + 1} product`}
                  value={line.product_id}
                  onChange={(event) => {
                    const selected = productsById.get(event.target.value);
                    setLines((current) =>
                      current.map((entry, i) =>
                        i === index
                          ? { ...entry, product_id: event.target.value, uom: selected?.unit_of_measure ? String(selected.unit_of_measure).toUpperCase() : '' }
                          : entry,
                      ),
                    );
                  }}
                  className={FIELD_CLASS}
                >
                  <option value="">Select a product…</option>
                  {products.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Unit" hint={baseUom ? `Base unit: ${baseUom}` : 'Set a base unit on the product first.'}>
                <input
                  aria-label={`Line ${index + 1} unit`}
                  value={line.uom}
                  onChange={(event) => setLines((current) => current.map((entry, i) => (i === index ? { ...entry, uom: event.target.value.toUpperCase() } : entry)))}
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Quantity">
                <input
                  aria-label={`Line ${index + 1} quantity`}
                  type="number"
                  min="0"
                  step="any"
                  value={line.quantity_ordered}
                  onChange={(event) => setLines((current) => current.map((entry, i) => (i === index ? { ...entry, quantity_ordered: event.target.value } : entry)))}
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Expected unit price">
                <input
                  aria-label={`Line ${index + 1} expected unit price`}
                  type="number"
                  min="0"
                  step="any"
                  value={line.expected_unit_price}
                  onChange={(event) => setLines((current) => current.map((entry, i) => (i === index ? { ...entry, expected_unit_price: event.target.value } : entry)))}
                  className={FIELD_CLASS}
                />
              </Field>
              <div className="flex items-end">
                {lines.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove line
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <Field label="Notes">
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={FIELD_CLASS} />
      </Field>

      <InfoNote>
        <p>The order is created as a draft. Authorization is a separate step and must be done by a different person (four eyes).</p>
        <p>Quantities are converted to the product base unit by the server using registered conversions only — an unregistered unit is refused.</p>
      </InfoNote>

      {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
        >
          <FilePlus2 className="h-4 w-4" aria-hidden />
          {mutation.isPending ? 'Creating…' : 'Create draft purchase order'}
        </button>
        {!canSubmit ? (
          <span className="text-xs text-gray-500">Choose a site, a supplier, a 3-letter currency and at least one complete line.</span>
        ) : null}
      </div>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail
// ─────────────────────────────────────────────────────────────────────────────

function PurchaseOrderDetail({
  businessId,
  poId,
  capabilities,
  onNotice,
  onClosed,
}: {
  businessId: string;
  poId: string;
  capabilities: string[];
  onNotice: (message: string) => void;
  onClosed: () => void;
}) {
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.currentUser);
  const [cancelReason, setCancelReason] = useState('');
  const [showDeliveryNote, setShowDeliveryNote] = useState(false);
  const [showDeliveryNoteException, setShowDeliveryNoteException] = useState(false);
  const [showReceipt, setShowReceipt] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['construction', 'purchase-order', poId],
    queryFn: async () => {
      const [purchaseOrders, lines, events, sites, deliveryNotes, receipts, products, contacts] = await Promise.all([
        repos.construction.findPurchaseOrders(businessId),
        repos.construction.findPurchaseOrderLines(poId),
        repos.construction.findPurchaseOrderEvents(poId),
        repos.construction.findSites(businessId),
        repos.construction.findDeliveryNotes(businessId),
        repos.construction.findReceipts(businessId),
        repos.inventory.findAllProducts(businessId),
        repos.contact.findByBusiness(businessId),
      ]);
      const po = purchaseOrders.find((entry) => entry.id === poId) ?? null;
      return {
        po,
        lines,
        events,
        sites,
        deliveryNotes: deliveryNotes.filter((note) => note.po_id === poId),
        // Candidates for a duplicate exception: the recorded, non-exception notes
        // for the SAME SUPPLIER (they may sit on another purchase order — the
        // server only requires same business, same supplier, same reference). No
        // extra read: this is a filter over the business-wide list already loaded.
        supplierRecordedNotes: po
          ? deliveryNotes.filter((note) => !note.is_exception && note.supplier_contact_id === po.supplier_contact_id)
          : [],
        receipts: receipts.filter((receipt) => receipt.po_id === poId),
        products,
        contacts,
      };
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['construction'] });
  };

  const authorizeMutation = useMutation({
    mutationFn: () => repos.construction.authorizePurchaseOrder(poId),
    onSuccess: () => {
      invalidate();
      onNotice('Purchase order authorized.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => repos.construction.cancelPurchaseOrder(poId, cancelReason),
    onSuccess: () => {
      invalidate();
      setCancelReason('');
      onNotice('Purchase order cancelled.');
    },
  });

  if (detailQuery.isLoading) return <LoadingBlock label="Loading the purchase order…" />;
  if (detailQuery.isError) {
    return (
      <ErrorBanner
        message={`The purchase order could not be loaded: ${
          detailQuery.error instanceof Error ? detailQuery.error.message : 'unknown error'
        }`}
      />
    );
  }

  const { po, lines, events, sites, deliveryNotes, supplierRecordedNotes, receipts, products, contacts } = detailQuery.data!;
  if (!po) {
    return <ErrorBanner message="That purchase order is not visible to you in this business." />;
  }

  const site = sites.find((entry) => entry.id === po.site_id);
  const supplier = contacts.find((entry) => entry.id === po.supplier_contact_id);
  const productsById = new Map(products.map((product) => [product.id, product]));
  const exceptionGate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.exceptionAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.exceptionAuthorize],
  );
  const authorizeGate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.poAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.poAuthorize],
  );
  const manageGate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.poManage,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.poManage],
  );
  const isCreator = Boolean(currentUser?.id && po.created_by === currentUser.id);
  const fourEyesBlocked = po.status === 'draft' && isCreator;

  return (
    <SectionCard
      title={`Purchase order ${po.po_number}`}
      description={`${site ? `${site.site_code} — ${site.site_name}` : 'Site'} · project ${po.project_ref} · supplier ${supplier?.name ?? '—'}`}
      actions={
        <>
          <StatusPill label={po.status} className={PO_STATUS_STYLE[po.status] ?? 'bg-slate-100 text-slate-700'} />
          <button type="button" onClick={onClosed} className="text-sm text-gray-500 hover:text-gray-800">
            Close
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {po.status === 'cancelled' ? (
          <ErrorBanner message={`Cancelled ${formatDateTime(po.cancelled_at)}${po.cancel_reason ? ` — ${po.cancel_reason}` : ''}`} />
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-2 py-2">Line</th>
                <th className="px-2 py-2">Product</th>
                <th className="px-2 py-2 text-right">Ordered</th>
                <th className="px-2 py-2 text-right">Base quantity</th>
                <th className="px-2 py-2 text-right">Expected unit price</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-t border-gray-100">
                  <td className="px-2 py-2 text-gray-700">{line.line_number}</td>
                  <td className="px-2 py-2 text-gray-900">{productsById.get(line.product_id)?.name ?? line.product_id}</td>
                  <td className="px-2 py-2 text-right text-gray-800">
                    {formatQuantity(line.quantity_ordered, line.uom)}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-600">
                    {formatQuantity(line.quantity_ordered_base)}
                  </td>
                  <td className="px-2 py-2 text-right text-gray-700">
                    {line.expected_unit_price ? formatMoney(line.expected_unit_price, po.currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-start gap-3">
          {po.status === 'draft' ? (
            <>
              <GatedButton
                allowed={authorizeGate.allowed && !fourEyesBlocked}
                reason={fourEyesBlocked ? 'You raised this purchase order. Authorization must be recorded by a different person.' : authorizeGate.reason}
                onClick={() => authorizeMutation.mutate()}
                disabled={authorizeMutation.isPending}
              >
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> {authorizeMutation.isPending ? 'Authorizing…' : 'Authorize'}
                </>
              </GatedButton>
              <div className="flex items-end gap-2">
                <Field label="Cancellation reason">
                  <input
                    aria-label="Cancellation reason"
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                <GatedButton
                  allowed={manageGate.allowed && cancelReason.trim().length > 0}
                  reason={manageGate.allowed ? 'A written reason is required to cancel.' : manageGate.reason}
                  onClick={() => cancelMutation.mutate()}
                  disabled={cancelMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                >
                  <>
                    <XCircle className="h-4 w-4" aria-hidden /> Cancel order
                  </>
                </GatedButton>
              </div>
            </>
          ) : null}

          {po.status === 'authorized' ? (
            <>
              <GatedButton
                allowed={deliveryNoteButtonAllowed(capabilities)}
                reason={gateForCapability(capabilities, CONSTRUCTION_CAPABILITIES.deliveryNoteRecord, CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.deliveryNoteRecord]).reason}
                onClick={() => setShowDeliveryNote((open) => !open)}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 transition disabled:cursor-not-allowed disabled:text-gray-400"
              >
                <>
                  <FilePlus2 className="h-4 w-4" aria-hidden /> Record delivery note
                </>
              </GatedButton>
              <GatedButton
                allowed={exceptionGate.allowed && supplierRecordedNotes.length > 0}
                reason={
                  supplierRecordedNotes.length === 0
                    ? 'No delivery note is recorded for this supplier yet. Record the first note normally — this path only records a duplicate of an existing note.'
                    : exceptionGate.reason
                }
                onClick={() => {
                  setShowDeliveryNote(false);
                  setShowDeliveryNoteException((open) => !open);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 transition disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-white disabled:text-gray-400"
              >
                <>
                  <FilePlus2 className="h-4 w-4" aria-hidden /> Record duplicate note (exception)
                </>
              </GatedButton>
              <GatedButton
                allowed={capabilities.includes(CONSTRUCTION_CAPABILITIES.grnRecord)}
                reason={gateForCapability(capabilities, CONSTRUCTION_CAPABILITIES.grnRecord, CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.grnRecord]).reason}
                onClick={() => setShowReceipt((open) => !open)}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
              >
                <>
                  <Send className="h-4 w-4" aria-hidden /> Record goods receipt
                </>
              </GatedButton>
            </>
          ) : null}
        </div>

        {authorizeMutation.isError ? <FailureBanner failure={describeConstructionFailure(authorizeMutation.error)} /> : null}
        {cancelMutation.isError ? <FailureBanner failure={describeConstructionFailure(cancelMutation.error)} /> : null}

        {showDeliveryNote ? (
          <ConstructionDeliveryNoteForm
            businessId={businessId}
            po={po}
            lines={lines}
            products={products}
            existingNotes={deliveryNotes}
            onRecorded={(number) => {
              setShowDeliveryNote(false);
              invalidate();
              onNotice(`Delivery note ${number} recorded as evidence. No stock or ledger effect.`);
            }}
            onCancel={() => setShowDeliveryNote(false)}
          />
        ) : null}

        {showDeliveryNoteException ? (
          <ConstructionDeliveryNoteForm
            businessId={businessId}
            po={po}
            lines={lines}
            products={products}
            existingNotes={deliveryNotes}
            exception={{ candidates: supplierRecordedNotes }}
            onRecorded={(number) => {
              setShowDeliveryNoteException(false);
              invalidate();
              onNotice(
                `Delivery note ${number} recorded as an authorized duplicate exception. The recorded note was not changed; no stock or ledger effect.`,
              );
            }}
            onCancel={() => setShowDeliveryNoteException(false)}
          />
        ) : null}

        {showReceipt ? (
          <ConstructionGoodsReceiptForm
            businessId={businessId}
            po={po}
            lines={lines}
            products={products}
            deliveryNotes={deliveryNotes}
            capabilities={capabilities}
            onRecorded={(number, acceptedBase) => {
              setShowReceipt(false);
              invalidate();
              onNotice(
                acceptedBase > 0
                  ? `Goods receipt ${number} recorded. ${formatQuantity(acceptedBase)} base units were accepted and need an evidenced cost basis before posting.`
                  : `Goods receipt ${number} recorded. Nothing was accepted, so no quantity can reach stock.`,
              );
            }}
            onCancel={() => setShowReceipt(false)}
          />
        ) : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Delivery notes (evidence only)</h4>
            {deliveryNotes.length === 0 ? (
              <EmptyState title="No delivery note recorded" detail="A delivery note records what the supplier's paperwork says; it never moves stock." />
            ) : (
              <ul className="space-y-2">
                {deliveryNotes.map((note) => (
                  <li key={note.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-800">{note.delivery_note_number}</span>
                      <span className="text-xs text-gray-500">{note.document_date}</span>
                      {note.is_exception ? <StatusPill label="exception" className="bg-amber-50 text-amber-800" /> : null}
                    </div>
                    <p className="mt-1 text-xs text-gray-600">Evidence: {note.evidence_reference}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Goods receipts</h4>
            {receipts.length === 0 ? (
              <EmptyState title="No goods receipt recorded" detail="A goods receipt is the only document that can lead to stock." />
            ) : (
              <ul className="space-y-2">
                {receipts.map((receipt) => (
                  <li key={receipt.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-800">{receipt.grn_number}</span>
                      <span className="text-xs text-gray-500">{receipt.receipt_date}</span>
                    </div>
                    <Link
                      to={`/construction/receipts?grn=${receipt.id}`}
                      className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline"
                    >
                      Open receipt, inspection and cost review →
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">History</h4>
          {events.length === 0 ? (
            <EmptyState title="No events yet" />
          ) : (
            <ul className="space-y-1 text-xs text-gray-600">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{event.action}</span>
                  <span>{formatDateTime(event.created_at)}</span>
                  {event.detail ? <span className="text-gray-500">{event.detail}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {po.status === 'authorized' ? (
          <InfoNote>
            <p>
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              Goods receipt quantities are converted by the server with registered unit conversions only. Rejected, quarantined and disputed
              quantities each need a hold with a reason and evidence, and need the receipt-inspection capability.
            </p>
          </InfoNote>
        ) : null}
      </div>
    </SectionCard>
  );
}

function deliveryNoteButtonAllowed(capabilities: string[]): boolean {
  return capabilities.includes(CONSTRUCTION_CAPABILITIES.deliveryNoteRecord);
}
