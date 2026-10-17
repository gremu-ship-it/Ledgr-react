import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ClipboardCheck, FlaskConical, Lock, Search, Unlock } from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  CONSTRUCTION_CAPABILITY_LABELS,
  type ConstructionGoodsReceipt,
  type ConstructionGoodsReceiptLine,
} from '@/dal/repositories/ConstructionProcurementRepository';
import { describeConstructionFailure, type ConstructionFailure } from '@/lib/construction/constructionCommandFeedback';
import {
  describeReceiptLineProgress,
  formatDate,
  formatMoney,
  formatQuantity,
  gateForCapability,
  matchesSearch,
  newIdempotencyKey,
  receiptStageClassName,
  toNumber,
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

/**
 * Receipts: inspection, holds, quality release, cost basis and posting
 * preparation.
 *
 * The screen states the accounting position for every receipt line and refuses
 * to imply more than the database does: an accepted quantity that has no cost
 * basis cannot be posted, a policy-disabled business cannot post at all, and a
 * posted receipt is a stock movement — never a journal entry.
 */
export function ConstructionReceiptsSection({
  businessId,
  capabilities,
}: {
  businessId: string;
  capabilities: string[];
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('grn');
  const [search, setSearch] = useState('');

  const listQuery = useQuery({
    queryKey: ['construction', 'receipts', businessId],
    queryFn: async () => {
      const [receipts, sites, purchaseOrders] = await Promise.all([
        repos.construction.findReceipts(businessId),
        repos.construction.findSites(businessId),
        repos.construction.findPurchaseOrders(businessId),
      ]);
      return { receipts, sites, purchaseOrders };
    },
  });

  if (listQuery.isLoading) return <LoadingBlock label="Loading goods receipts…" />;
  if (listQuery.isError) {
    return (
      <ErrorBanner
        message={`Goods receipts could not be loaded: ${listQuery.error instanceof Error ? listQuery.error.message : 'unknown error'}`}
      />
    );
  }

  const { receipts, sites, purchaseOrders } = listQuery.data!;
  const sitesById = new Map(sites.map((site) => [site.id, site]));
  const posById = new Map(purchaseOrders.map((po) => [po.id, po]));

  const filtered = receipts.filter((receipt) =>
    matchesSearch([receipt.grn_number, receipt.project_ref, receipt.receipt_date, posById.get(receipt.po_id)?.po_number], search),
  );

  const select = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('grn', id);
    else next.delete('grn');
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <SectionCard
        title="Goods receipts"
        description="A receipt records what was physically received and classified. Only accepted quantities can reach stock, and only after an evidenced cost basis and an approved policy."
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search receipt number, project…"
              aria-label="Search goods receipts"
              className="w-60 rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        }
      >
        {receipts.length === 0 ? (
          <EmptyState
            title="No goods receipts yet"
            detail="Record one against an authorized purchase order from the Purchase orders screen."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No receipt matches that search" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Receipt</th>
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Purchase order</th>
                  <th className="px-2 py-2">Site / project</th>
                  <th className="px-2 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((receipt) => (
                  <tr key={receipt.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 font-mono text-xs text-gray-800">{receipt.grn_number}</td>
                    <td className="px-2 py-2 text-gray-700">{formatDate(receipt.receipt_date)}</td>
                    <td className="px-2 py-2 font-mono text-xs text-gray-700">{posById.get(receipt.po_id)?.po_number ?? '—'}</td>
                    <td className="px-2 py-2 text-gray-700">
                      <span className="font-mono text-xs">{sitesById.get(receipt.site_id)?.site_code ?? '—'}</span>
                      <span className="ml-2 text-xs text-gray-500">{receipt.project_ref}</span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => select(receipt.id === selectedId ? null : receipt.id)}
                        className="text-sm font-medium text-brand-700 hover:underline"
                      >
                        {receipt.id === selectedId ? 'Hide' : 'Review'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {selectedId ? <ReceiptReview businessId={businessId} grnId={selectedId} capabilities={capabilities} /> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ReceiptReview({ businessId, grnId, capabilities }: { businessId: string; grnId: string; capabilities: string[] }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [postingFailure, setPostingFailure] = useState<ConstructionFailure | null>(null);

  const detailQuery = useQuery({
    queryKey: ['construction', 'receipt', grnId],
    queryFn: async () => {
      const [receipts, lines, sites, purchaseOrders, products, policy, bills, billLines] = await Promise.all([
        repos.construction.findReceipts(businessId),
        repos.construction.findReceiptLines(grnId),
        repos.construction.findSites(businessId),
        repos.construction.findPurchaseOrders(businessId),
        repos.inventory.findAllProducts(businessId),
        repos.construction.findPostingPolicy(businessId),
        repos.expense.findByBusiness(businessId),
        repos.construction.findSupplierBillLines(businessId),
      ]);
      const [holds, inspections, reclassifications, allocations, costBases] = await Promise.all([
        Promise.all(lines.map((line) => repos.construction.findReceiptHolds(line.id))).then((rows) => rows.flat()),
        Promise.all(lines.map((line) => repos.construction.findInspections(line.id))).then((rows) => rows.flat()),
        Promise.all(lines.map((line) => repos.construction.findReclassifications(line.id))).then((rows) => rows.flat()),
        Promise.all(lines.map((line) => repos.construction.findAllocationsForReceiptLine(line.id))).then((rows) => rows.flat()),
        Promise.all(lines.map((line) => repos.construction.findCostBasesForReceiptLine(line.id))).then((rows) => rows.flat()),
      ]);
      return {
        receipt: receipts.find((entry) => entry.id === grnId) ?? null,
        lines,
        sites,
        purchaseOrders,
        products,
        policy,
        bills,
        billLines,
        holds,
        inspections,
        reclassifications,
        allocations,
        costBases,
      };
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['construction'] });

  if (detailQuery.isLoading) return <LoadingBlock label="Loading the receipt…" />;
  if (detailQuery.isError) {
    return (
      <ErrorBanner
        message={`The receipt could not be loaded: ${detailQuery.error instanceof Error ? detailQuery.error.message : 'unknown error'}`}
      />
    );
  }

  const data = detailQuery.data!;
  if (!data.receipt) return <ErrorBanner message="That goods receipt is not visible to you in this business." />;
  const receipt: ConstructionGoodsReceipt = data.receipt;
  const site = data.sites.find((entry) => entry.id === receipt.site_id);
  const po = data.purchaseOrders.find((entry) => entry.id === receipt.po_id);
  const productsById = new Map(data.products.map((product) => [product.id, product]));
  const billsById = new Map(data.bills.map((bill) => [bill.id, bill]));

  const journalNote = (
    <InfoNote>
      <p>
        A posted receipt writes <strong>one stock movement per receipt line</strong> through the shared weighted-average-cost writer. It does not
        write a journal entry: general-ledger posting for construction receipts is not approved.
      </p>
    </InfoNote>
  );

  return (
    <SectionCard
      title={`Receipt ${receipt.grn_number}`}
      description={`${site ? `${site.site_code} — ${site.site_name}` : 'Site'} · project ${receipt.project_ref} · received ${formatDate(receipt.receipt_date)}${
        po ? ` · purchase order ${po.po_number}` : ''
      }`}
      actions={<StatusPill label="Stock effect only when posted" className="bg-blue-50 text-blue-700" />}
    >
      <div className="space-y-5">
        {notice ? <SuccessBanner message={notice} /> : null}
        {journalNote}

        {data.lines.length === 0 ? (
          <EmptyState title="This receipt has no lines" />
        ) : (
          data.lines.map((line) => {
            const progress = describeReceiptLineProgress(line, data.costBases, data.holds, data.policy);
            return (
              <div key={line.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    Line {line.line_number} · {productsById.get(line.product_id)?.name ?? line.product_id}
                  </span>
                  <StatusPill label={progress.label} className={receiptStageClassName(progress.stage)} />
                  {progress.holdBase > 0 ? (
                    <StatusPill label={`${formatQuantity(progress.holdBase)} held`} className="bg-amber-50 text-amber-800" />
                  ) : null}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-gray-600 sm:grid-cols-6">
                  <span>Received: <strong className="text-gray-900">{formatQuantity(line.quantity_received, line.uom)}</strong></span>
                  <span>Accepted: <strong className="text-gray-900">{formatQuantity(line.quantity_accepted, line.uom)}</strong></span>
                  <span>Rejected: <strong className="text-gray-900">{formatQuantity(line.quantity_rejected)}</strong></span>
                  <span>Quarantined: <strong className="text-gray-900">{formatQuantity(line.quantity_quarantined)}</strong></span>
                  <span>Disputed: <strong className="text-gray-900">{formatQuantity(line.quantity_disputed)}</strong></span>
                  <span>In stock: <strong className="text-gray-900">{formatQuantity(line.quantity_posted_base)}</strong></span>
                </div>

                <p className="mt-2 text-xs text-gray-600">{progress.detail}</p>

                <LineHolds
                  receiptLine={line}
                  holds={data.holds.filter((hold) => hold.grn_line_id === line.id)}
                  capabilities={capabilities}
                  onDone={(message) => {
                    setNotice(message);
                    invalidate();
                  }}
                />

                <LineInspection
                  businessId={businessId}
                  receiptLine={line}
                  inspections={data.inspections.filter((inspection) => inspection.grn_line_id === line.id)}
                  capabilities={capabilities}
                  onDone={(message) => {
                    setNotice(message);
                    invalidate();
                  }}
                />

                <LineCostBasis
                  receiptLine={line}
                  allocations={data.allocations.filter((allocation) => allocation.grn_line_id === line.id)}
                  costBases={data.costBases.filter((basis) => basis.grn_line_id === line.id)}
                  billsById={billsById}
                  billLines={data.billLines}
                  progress={progress}
                  policy={data.policy}
                  capabilities={capabilities}
                  onFailure={setPostingFailure}
                  onDone={(message) => {
                    setNotice(message);
                    invalidate();
                  }}
                />
              </div>
            );
          })
        )}

        {postingFailure ? <FailureBanner failure={postingFailure} /> : null}

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h4 className="text-sm font-semibold text-gray-900">Post this receipt&rsquo;s stock movements</h4>
          <p className="mt-1 text-xs text-gray-600">
            Posting is refused by the database unless (a) an approved policy enables movement posting, and (b) every accepted quantity on every
            line has an evidenced cost basis. Quantities already posted are skipped, so pressing this twice never doubles stock.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill
              label={data.policy?.movement_posting_enabled ? 'Policy: enabled' : 'Policy: disabled'}
              className={data.policy?.movement_posting_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}
            />
            <PostReceiptButton
              grnId={grnId}
              capabilities={capabilities}
              policyEnabled={data.policy?.movement_posting_enabled === true}
              onFailure={setPostingFailure}
              onDone={(message) => {
                setPostingFailure(null);
                setNotice(message);
                invalidate();
              }}
            />
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Quality releases recorded</h4>
          {data.reclassifications.length === 0 ? (
            <EmptyState title="No quality release recorded" detail="Quarantined or disputed quantities stay outside inventory until released." />
          ) : (
            <ul className="space-y-2">
              {data.reclassifications.map((row) => (
                <li key={row.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700">
                  {formatQuantity(row.quantity_base)} base units from {row.from_bucket} to {row.to_bucket} · {row.reason} · evidence {row.evidence_reference}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Holds
// ─────────────────────────────────────────────────────────────────────────────

function LineHolds({
  receiptLine,
  holds,
  capabilities,
  onDone,
}: {
  receiptLine: ConstructionGoodsReceiptLine;
  holds: Array<{ id: string; hold_type: string; quantity: number | string; quantity_base: number | string; reason: string; evidence_reference: string; status: string }>;
  capabilities: string[];
  onDone: (message: string) => void;
}) {
  const [releaseReason, setReleaseReason] = useState<Record<string, string>>({});
  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.exceptionAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.exceptionAuthorize],
  );

  const mutation = useMutation({
    mutationFn: ({ holdId, reason }: { holdId: string; reason: string }) => repos.construction.releaseHold(holdId, reason),
    onSuccess: (_result, variables) => onDone(`Hold released: ${variables.reason}`),
  });

  if (holds.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Holds on line {receiptLine.line_number}</h5>
      <ul className="mt-2 space-y-2">
        {holds.map((hold) => (
          <li key={hold.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label={hold.hold_type} className="bg-amber-100 text-amber-900" />
              <span className="font-medium text-gray-900">{formatQuantity(hold.quantity_base)} base units</span>
              <StatusPill
                label={hold.status}
                className={hold.status === 'open' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}
              />
            </div>
            <p className="mt-1 text-gray-700">{hold.reason}</p>
            <p className="text-[11px] text-gray-500">Evidence: {hold.evidence_reference}</p>
            {hold.status === 'open' ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label={`Release reason for the ${hold.hold_type} hold`}>
                  <input
                    aria-label={`Release reason for hold ${hold.id}`}
                    value={releaseReason[hold.id] ?? ''}
                    onChange={(event) => setReleaseReason((current) => ({ ...current, [hold.id]: event.target.value }))}
                    className={`${FIELD_CLASS} mt-0 w-64`}
                  />
                </Field>
                <GatedButton
                  allowed={gate.allowed && (releaseReason[hold.id] ?? '').trim().length > 0}
                  reason={gate.allowed ? 'A written reason is required to release a hold.' : gate.reason}
                  onClick={() => mutation.mutate({ holdId: hold.id, reason: (releaseReason[hold.id] ?? '').trim() })}
                  disabled={mutation.isPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  <>
                    <Unlock className="h-3.5 w-3.5" aria-hidden /> Release hold
                  </>
                </GatedButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-amber-900">
        Releasing a hold records the decision. It does not move stock: a quarantined or disputed quantity must also pass an inspection and be
        reclassified before it can be accepted.
      </p>
      {mutation.isError ? (
        <div className="mt-2">
          <FailureBanner failure={describeConstructionFailure(mutation.error)} />
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inspection and quality release
// ─────────────────────────────────────────────────────────────────────────────

function LineInspection({
  businessId,
  receiptLine,
  inspections,
  capabilities,
  onDone,
}: {
  businessId: string;
  receiptLine: ConstructionGoodsReceiptLine;
  inspections: Array<{ id: string; outcome: string; quantity_inspected: number | string; inspection_date: string; method: string; evidence_reference: string }>;
  capabilities: string[];
  onDone: (message: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [outcome, setOutcome] = useState<'passed' | 'failed' | 'partial'>('passed');
  const [quantity, setQuantity] = useState('');
  const [method, setMethod] = useState('');
  const [certificate, setCertificate] = useState('');
  const [evidence, setEvidence] = useState('');
  const [inspectionDate, setInspectionDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const [fromBucket, setFromBucket] = useState<'quarantined' | 'disputed'>('quarantined');
  const [releaseQuantity, setReleaseQuantity] = useState('');
  const [inspectionId, setInspectionId] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [releaseEvidence, setReleaseEvidence] = useState('');
  const [releaseKey, setReleaseKey] = useState(() => newIdempotencyKey());

  const inspectGate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.receiptInspect,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.receiptInspect],
  );
  const exceptionGate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.exceptionAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.exceptionAuthorize],
  );

  const inspectionMutation = useMutation({
    mutationFn: () =>
      repos.construction.recordInspection(
        {
          business_id: businessId,
          grn_line_id: receiptLine.id,
          inspection_date: inspectionDate,
          outcome,
          quantity_inspected: quantity,
          method: method.trim(),
          certificate_reference: certificate.trim() || null,
          evidence_reference: evidence.trim(),
        },
        clientKey,
      ),
    onSuccess: () => {
      setClientKey(newIdempotencyKey());
      setShowForm(false);
      setQuantity('');
      setMethod('');
      setCertificate('');
      setEvidence('');
      onDone(`Inspection recorded on line ${receiptLine.line_number}. An inspection does not move stock by itself.`);
    },
  });

  const releaseMutation = useMutation({
    mutationFn: () =>
      repos.construction.reclassifyReceiptLine(
        {
          business_id: businessId,
          grn_line_id: receiptLine.id,
          from_bucket: fromBucket,
          quantity: releaseQuantity,
          inspection_id: inspectionId,
          reason: releaseReason.trim(),
          evidence_reference: releaseEvidence.trim(),
        },
        releaseKey,
      ),
    onSuccess: () => {
      setReleaseKey(newIdempotencyKey());
      setReleaseQuantity('');
      setReleaseReason('');
      setReleaseEvidence('');
      onDone(
        `Quantity released from ${fromBucket} into accepted on line ${receiptLine.line_number}. Request an evidenced cost basis before posting.`,
      );
    },
  });

  const passedInspections = inspections.filter((inspection) => inspection.outcome === 'passed');
  const heldBase = toNumber(receiptLine.quarantined_base) + toNumber(receiptLine.disputed_base);

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Inspection and quality release</h5>
        <GatedButton
          allowed={inspectGate.allowed}
          reason={inspectGate.reason}
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 disabled:cursor-not-allowed disabled:text-gray-400"
        >
          <>
            <FlaskConical className="h-3.5 w-3.5" aria-hidden /> {showForm ? 'Hide inspection form' : 'Record inspection'}
          </>
        </GatedButton>
      </div>

      {inspections.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {inspections.map((inspection) => (
            <li key={inspection.id}>
              <span className="font-medium uppercase">{inspection.outcome}</span> · {formatQuantity(inspection.quantity_inspected)} inspected on{' '}
              {formatDate(inspection.inspection_date)} · {inspection.method} · evidence {inspection.evidence_reference}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-gray-500">No inspection recorded for this line.</p>
      )}

      {showForm ? (
        <form
          className="mt-3 grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            inspectionMutation.mutate();
          }}
        >
          <Field label="Inspection date" required>
            <input aria-label="Inspection date" type="date" value={inspectionDate} onChange={(event) => setInspectionDate(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Outcome" required>
            <select aria-label="Inspection outcome" value={outcome} onChange={(event) => setOutcome(event.target.value as 'passed' | 'failed' | 'partial')} className={FIELD_CLASS}>
              <option value="passed">passed</option>
              <option value="failed">failed</option>
              <option value="partial">partial</option>
            </select>
          </Field>
          <Field label="Quantity inspected" required hint={`Received on this line: ${formatQuantity(receiptLine.quantity_received, receiptLine.uom)}`}>
            <input aria-label="Quantity inspected" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Method" required>
            <input aria-label="Inspection method" value={method} onChange={(event) => setMethod(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Certificate reference">
            <input aria-label="Certificate reference" value={certificate} onChange={(event) => setCertificate(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Evidence reference" required>
            <input aria-label="Inspection evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={inspectionMutation.isPending || !quantity || !method.trim() || !evidence.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden /> {inspectionMutation.isPending ? 'Recording…' : 'Record inspection'}
            </button>
          </div>
          {inspectionMutation.isError ? (
            <div className="sm:col-span-3">
              <FailureBanner failure={describeConstructionFailure(inspectionMutation.error)} />
            </div>
          ) : null}
        </form>
      ) : null}

      {heldBase > 0 ? (
        <form
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            releaseMutation.mutate();
          }}
        >
          <h6 className="text-xs font-semibold text-amber-900">
            Release held quantity into accepted (quarantined {formatQuantity(receiptLine.quarantined_base)} · disputed{' '}
            {formatQuantity(receiptLine.disputed_base)})
          </h6>
          <p className="mt-1 text-[11px] text-amber-900">
            A release needs a <strong>passed</strong> inspection of this line covering the released quantity, plus the exception authority and a
            written reason. Rejected material can never be released, and accepted stock can never be released back out.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="From bucket" required>
              <select aria-label="From bucket" value={fromBucket} onChange={(event) => setFromBucket(event.target.value as 'quarantined' | 'disputed')} className={FIELD_CLASS}>
                <option value="quarantined">quarantined</option>
                <option value="disputed">disputed</option>
              </select>
            </Field>
            <Field label="Quantity" required>
              <input aria-label="Release quantity" type="number" min="0" step="any" value={releaseQuantity} onChange={(event) => setReleaseQuantity(event.target.value)} className={FIELD_CLASS} />
            </Field>
            <Field label="Passed inspection" required>
              <select aria-label="Passed inspection" value={inspectionId} onChange={(event) => setInspectionId(event.target.value)} className={FIELD_CLASS}>
                <option value="">Select an inspection…</option>
                {passedInspections.map((inspection) => (
                  <option key={inspection.id} value={inspection.id}>
                    {formatDate(inspection.inspection_date)} · {formatQuantity(inspection.quantity_inspected)} inspected
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Release reason" required>
              <input aria-label="Release reason" value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} className={FIELD_CLASS} />
            </Field>
            <Field label="Release evidence" required>
              <input aria-label="Release evidence" value={releaseEvidence} onChange={(event) => setReleaseEvidence(event.target.value)} className={FIELD_CLASS} />
            </Field>
            <div className="flex items-end">
              <GatedButton
                allowed={
                  exceptionGate.allowed &&
                  inspectGate.allowed &&
                  Boolean(inspectionId) &&
                  releaseQuantity.trim().length > 0 &&
                  releaseReason.trim().length > 0 &&
                  releaseEvidence.trim().length > 0
                }
                reason={
                  exceptionGate.allowed && inspectGate.allowed
                    ? 'A quantity, a passed inspection, a reason and evidence are all required.'
                    : `${inspectGate.reason} ${exceptionGate.reason}`.trim()
                }
                onClick={() => releaseMutation.mutate()}
                disabled={releaseMutation.isPending}
              >
                <>
                  <Unlock className="h-3.5 w-3.5" aria-hidden /> {releaseMutation.isPending ? 'Releasing…' : 'Release into accepted'}
                </>
              </GatedButton>
            </div>
          </div>
          {releaseMutation.isError ? (
            <div className="mt-2">
              <FailureBanner failure={describeConstructionFailure(releaseMutation.error)} />
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cost basis and posting preparation
// ─────────────────────────────────────────────────────────────────────────────

function LineCostBasis({
  receiptLine,
  allocations,
  costBases,
  billsById,
  billLines,
  progress,
  policy,
  capabilities,
  onDone,
  onFailure,
}: {
  receiptLine: ConstructionGoodsReceiptLine;
  allocations: Array<{ id: string; expense_id: string; expense_line_id: string; bill_uom: string; bill_quantity: number | string; bill_quantity_base: number | string; receipt_quantity: number | string; is_exception: boolean }>;
  costBases: Array<{ id: string; expense_line_id: string; quantity_base: number | string; unit_cost_base: number | string; cost_currency: string; exchange_rate_used: number | string; discount_deducted: number | string; nonrecoverable_tax: number | string; vat_recoverable: boolean; evidence_reference: string }>;
  billsById: Map<string, { expense_number: string; reference: string | null; currency: string; contact_id: string | null }>;
  billLines: Array<{ id: string; description: string; unit_price: number | string; quantity: number | string; tax_code: string }>;
  progress: { coveredBase: number; acceptedBase: number };
  policy: { movement_posting_enabled: boolean } | null;
  capabilities: string[];
  onDone: (message: string) => void;
  onFailure: (failure: ConstructionFailure | null) => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [evidence, setEvidence] = useState('');
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());
  const billLinesById = useMemo(() => new Map(billLines.map((line) => [line.id, line])), [billLines]);

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.receiptPost,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.receiptPost],
  );

  const mutation = useMutation({
    mutationFn: ({ allocationId }: { allocationId: string }) => {
      const allocation = allocations.find((entry) => entry.id === allocationId)!;
      return repos.construction.recordReceiptCostBasis({
        grnLineId: receiptLine.id,
        expenseLineId: allocation.expense_line_id,
        quantity: quantity,
        evidenceReference: evidence.trim(),
        clientKey,
      });
    },
    onSuccess: (result) => {
      setClientKey(newIdempotencyKey());
      setQuantity('');
      setEvidence('');
      onFailure(null);
      onDone(
        `Cost basis recorded at ${formatMoney(String(result.unit_cost_base ?? ''), String(result.cost_currency ?? ''))} per base unit (rate ${String(
          result.exchange_rate_used ?? '',
        )}, discount ${String(result.discount_deducted ?? 0)}, non-recoverable tax ${String(result.nonrecoverable_tax ?? 0)}${
          result.vat_recoverable ? ', recoverable VAT excluded' : ''
        }).`,
      );
    },
  });

  const claimable = allocations.filter((allocation) => {
    const factor = toNumber(allocation.bill_quantity_base) / Math.max(toNumber(allocation.bill_quantity), 1);
    const alreadyClaimed = costBases
      .filter((basis) => basis.expense_line_id === allocation.expense_line_id)
      .reduce((total, basis) => total + toNumber(basis.quantity_base), 0);
    const claimedBase = toNumber(allocation.bill_quantity) * factor;
    return alreadyClaimed < claimedBase;
  });

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Supplier bill match and cost basis</h5>

      {allocations.length === 0 ? (
        <EmptyState
          title="Not matched to a supplier bill line"
          detail="Cost cannot be claimed until a bill line is matched to this receipt line (Bill matching screen)."
        />
      ) : (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {allocations.map((allocation) => {
            const bill = billsById.get(allocation.expense_id);
            const billLine = billLinesById.get(allocation.expense_line_id);
            return (
              <li key={allocation.id}>
                Matched {formatQuantity(allocation.bill_quantity, allocation.bill_uom)} of{' '}
                <span className="font-mono">{bill?.expense_number ?? allocation.expense_id}</span>
                {bill?.reference ? ` (supplier ref ${bill.reference})` : ''} · {billLine?.description ?? 'line'} · matched{' '}
                {formatQuantity(allocation.receipt_quantity)} against the receipt
                {allocation.is_exception ? ' · authorized exception' : ''}
              </li>
            );
          })}
        </ul>
      )}

      {costBases.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {costBases.map((basis) => (
            <li key={basis.id}>
              Cost basis: {formatQuantity(basis.quantity_base)} base units at{' '}
              <strong>{formatMoney(basis.unit_cost_base, basis.cost_currency)}</strong> (rate {String(basis.exchange_rate_used)}; discount{' '}
              {String(basis.discount_deducted)}; non-recoverable tax {String(basis.nonrecoverable_tax)}
              {basis.vat_recoverable ? '; recoverable VAT excluded' : ''}) · evidence {basis.evidence_reference}
            </li>
          ))}
        </ul>
      ) : null}

      {allocations.length > 0 ? (
        <form
          className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4"
          onSubmit={(event) => {
            event.preventDefault();
            const allocation = claimable[0] ?? allocations[0];
            mutation.mutate({ allocationId: allocation.id });
          }}
        >
          <Field
            label="Quantity to cost"
            required
            hint={`Covered so far: ${formatQuantity(progress.coveredBase)} of ${formatQuantity(progress.acceptedBase)} accepted.`}
          >
            <input aria-label="Quantity to cost" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Cost evidence" required hint="For example the supplier invoice page reference.">
            <input aria-label="Cost evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <div className="flex items-end">
            <GatedButton
              allowed={gate.allowed && quantity.trim().length > 0 && evidence.trim().length > 0 && claimable.length > 0}
              reason={
                gate.allowed
                  ? claimable.length === 0
                    ? 'Every matched bill quantity on this line has already been claimed.'
                    : 'A quantity and an evidence reference are required.'
                  : gate.reason
              }
              onClick={() => mutation.mutate({ allocationId: claimable[0].id })}
              disabled={mutation.isPending}
            >
              <>
                <Lock className="h-3.5 w-3.5" aria-hidden /> {mutation.isPending ? 'Recording…' : 'Prepare cost basis'}
              </>
            </GatedButton>
          </div>
          <p className="self-center text-[11px] text-gray-500">
            Posting policy: {policy?.movement_posting_enabled ? 'enabled' : 'disabled'}. Cost is derived by the server from the bill line: price net
            of the stated trade discount, plus tax only when it is not recoverable, at the rate recorded for the bill date.
          </p>
          {mutation.isError ? (
            <div className="sm:col-span-4">
              <FailureBanner failure={describeConstructionFailure(mutation.error)} />
            </div>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

function PostReceiptButton({
  grnId,
  capabilities,
  policyEnabled,
  onDone,
  onFailure,
}: {
  grnId: string;
  capabilities: string[];
  policyEnabled: boolean;
  onDone: (message: string) => void;
  onFailure: (failure: ConstructionFailure | null) => void;
}) {
  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.receiptPost,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.receiptPost],
  );

  const mutation = useMutation({
    mutationFn: () => repos.construction.postReceiptMovement(grnId),
    onSuccess: (result) => {
      onFailure(null);
      const movements = Number(result.movements ?? 0);
      onDone(
        result.idempotent || movements === 0
          ? 'Nothing to post: every accepted quantity on this receipt has already reached stock.'
          : `${movements} stock movement(s) posted through the shared weighted-average-cost writer. No journal entry was created.`,
      );
    },
    onError: (error) => {
      onFailure(describeConstructionFailure(error));
    },
  });

  return (
    <GatedButton
      allowed={gate.allowed}
      reason={policyEnabled ? gate.reason : `${gate.reason} Movement posting is also disabled for this business.`}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <>
        <Unlock className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Posting…' : 'Post stock movements'}
      </>
    </GatedButton>
  );
}
