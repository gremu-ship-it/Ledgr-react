import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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

  if (listQuery.isLoading) return <LoadingBlock label={t('construction.procurement.receipts.loading')} />;
  if (listQuery.isError) {
    return (
      <ErrorBanner
        message={t('construction.procurement.receipts.loadError', {
          detail: listQuery.error instanceof Error ? listQuery.error.message : t('construction.procurement.shared.unknownError'),
        })}
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
        title={t('construction.procurement.receipts.title')}
        description={t('construction.procurement.receipts.description')}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('construction.procurement.receipts.searchPlaceholder')}
              aria-label={t('construction.procurement.receipts.searchAria')}
              className="w-60 rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        }
      >
        {receipts.length === 0 ? (
          <EmptyState
            title={t('construction.procurement.receipts.noneTitle')}
            detail={t('construction.procurement.receipts.noneDetail')}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('construction.procurement.receipts.noMatchTitle')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">{t('construction.procurement.receipts.thReceipt')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.receipts.thDate')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.receipts.thPurchaseOrder')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.receipts.thSiteProject')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.receipts.thAction')}</th>
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
                        {receipt.id === selectedId ? t('construction.procurement.receipts.hide') : t('construction.procurement.receipts.review')}
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
  const { t } = useTranslation();
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

  if (detailQuery.isLoading) return <LoadingBlock label={t('construction.procurement.receipts.detailLoading')} />;
  if (detailQuery.isError) {
    return (
      <ErrorBanner
        message={t('construction.procurement.receipts.detailLoadError', {
          detail: detailQuery.error instanceof Error ? detailQuery.error.message : t('construction.procurement.shared.unknownError'),
        })}
      />
    );
  }

  const data = detailQuery.data!;
  if (!data.receipt) return <ErrorBanner message={t('construction.procurement.receipts.notVisible')} />;
  const receipt: ConstructionGoodsReceipt = data.receipt;
  const site = data.sites.find((entry) => entry.id === receipt.site_id);
  const po = data.purchaseOrders.find((entry) => entry.id === receipt.po_id);
  const productsById = new Map(data.products.map((product) => [product.id, product]));
  const billsById = new Map(data.bills.map((bill) => [bill.id, bill]));

  const journalNote = (
    <InfoNote>
      <p>
        {t('construction.procurement.receipts.journalNoteBefore')}<strong>{t('construction.procurement.receipts.journalNoteStrong')}</strong>{t('construction.procurement.receipts.journalNoteAfter')}
      </p>
    </InfoNote>
  );

  return (
    <SectionCard
      title={t('construction.procurement.receipts.detailTitle', { number: receipt.grn_number })}
      description={
        po
          ? t('construction.procurement.receipts.detailDescriptionPo', {
              site: site ? `${site.site_code} — ${site.site_name}` : t('construction.procurement.receipts.siteFallback'),
              project: receipt.project_ref,
              received: formatDate(receipt.receipt_date),
              poNumber: po.po_number,
            })
          : t('construction.procurement.receipts.detailDescription', {
              site: site ? `${site.site_code} — ${site.site_name}` : t('construction.procurement.receipts.siteFallback'),
              project: receipt.project_ref,
              received: formatDate(receipt.receipt_date),
            })
      }
      actions={<StatusPill label={t('construction.procurement.receipts.stockEffectPill')} className="bg-blue-50 text-blue-700" />}
    >
      <div className="space-y-5">
        {notice ? <SuccessBanner message={notice} /> : null}
        {journalNote}

        {data.lines.length === 0 ? (
          <EmptyState title={t('construction.procurement.receipts.noLinesTitle')} />
        ) : (
          data.lines.map((line) => {
            const progress = describeReceiptLineProgress(line, data.costBases, data.holds, data.policy);
            return (
              <div key={line.id} className="rounded-xl border border-gray-200 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">
                    {t('construction.procurement.receipts.lineHeading', {
                      line: line.line_number,
                      product: productsById.get(line.product_id)?.name ?? line.product_id,
                    })}
                  </span>
                  <StatusPill label={progress.label} className={receiptStageClassName(progress.stage)} />
                  {progress.holdBase > 0 ? (
                    <StatusPill label={t('construction.procurement.receipts.heldPill', { quantity: formatQuantity(progress.holdBase) })} className="bg-amber-50 text-amber-800" />
                  ) : null}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-3 text-xs text-gray-600 sm:grid-cols-6">
                  <span>{t('construction.procurement.receipts.statReceived')}<strong className="text-gray-900">{formatQuantity(line.quantity_received, line.uom)}</strong></span>
                  <span>{t('construction.procurement.receipts.statAccepted')}<strong className="text-gray-900">{formatQuantity(line.quantity_accepted, line.uom)}</strong></span>
                  <span>{t('construction.procurement.receipts.statRejected')}<strong className="text-gray-900">{formatQuantity(line.quantity_rejected)}</strong></span>
                  <span>{t('construction.procurement.receipts.statQuarantined')}<strong className="text-gray-900">{formatQuantity(line.quantity_quarantined)}</strong></span>
                  <span>{t('construction.procurement.receipts.statDisputed')}<strong className="text-gray-900">{formatQuantity(line.quantity_disputed)}</strong></span>
                  <span>{t('construction.procurement.receipts.statInStock')}<strong className="text-gray-900">{formatQuantity(line.quantity_posted_base)}</strong></span>
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
          <h4 className="text-sm font-semibold text-gray-900">{t('construction.procurement.receipts.postTitle')}</h4>
          <p className="mt-1 text-xs text-gray-600">
            {t('construction.procurement.receipts.postInfo')}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusPill
              label={data.policy?.movement_posting_enabled ? t('construction.procurement.receipts.policyEnabledPill') : t('construction.procurement.receipts.policyDisabledPill')}
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
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('construction.procurement.receipts.releasesHeading')}</h4>
          {data.reclassifications.length === 0 ? (
            <EmptyState title={t('construction.procurement.receipts.noReleasesTitle')} detail={t('construction.procurement.receipts.noReleasesDetail')} />
          ) : (
            <ul className="space-y-2">
              {data.reclassifications.map((row) => (
                <li key={row.id} className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700">
                  {t('construction.procurement.receipts.releaseLine', {
                    quantity: formatQuantity(row.quantity_base),
                    from: row.from_bucket,
                    to: row.to_bucket,
                    reason: row.reason,
                    evidence: row.evidence_reference,
                  })}
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
  const { t } = useTranslation();
  const [releaseReason, setReleaseReason] = useState<Record<string, string>>({});
  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.exceptionAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.exceptionAuthorize],
  );

  const mutation = useMutation({
    mutationFn: ({ holdId, reason }: { holdId: string; reason: string }) => repos.construction.releaseHold(holdId, reason),
    onSuccess: (_result, variables) => onDone(t('construction.procurement.receipts.holdReleased', { reason: variables.reason })),
  });

  if (holds.length === 0) return null;

  return (
    <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3">
      <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-900">{t('construction.procurement.receipts.holdsHeading', { line: receiptLine.line_number })}</h5>
      <ul className="mt-2 space-y-2">
        {holds.map((hold) => (
          <li key={hold.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill label={hold.hold_type} className="bg-amber-100 text-amber-900" />
              <span className="font-medium text-gray-900">{t('construction.procurement.receipts.holdBaseUnits', { quantity: formatQuantity(hold.quantity_base) })}</span>
              <StatusPill
                label={hold.status}
                className={hold.status === 'open' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'}
              />
            </div>
            <p className="mt-1 text-gray-700">{hold.reason}</p>
            <p className="text-[11px] text-gray-500">{t('construction.procurement.receipts.evidenceLine', { evidence: hold.evidence_reference })}</p>
            {hold.status === 'open' ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <Field label={t('construction.procurement.receipts.releaseReasonLabel', { holdType: hold.hold_type })}>
                  <input
                    aria-label={t('construction.procurement.receipts.releaseReasonAria', { holdId: hold.id })}
                    value={releaseReason[hold.id] ?? ''}
                    onChange={(event) => setReleaseReason((current) => ({ ...current, [hold.id]: event.target.value }))}
                    className={`${FIELD_CLASS} mt-0 w-64`}
                  />
                </Field>
                <GatedButton
                  allowed={gate.allowed && (releaseReason[hold.id] ?? '').trim().length > 0}
                  reason={gate.allowed ? t('construction.procurement.receipts.releaseRequiresReason') : gate.reason}
                  onClick={() => mutation.mutate({ holdId: hold.id, reason: (releaseReason[hold.id] ?? '').trim() })}
                  disabled={mutation.isPending}
                  className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-900 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  <>
                    <Unlock className="h-3.5 w-3.5" aria-hidden /> {t('construction.procurement.receipts.releaseHold')}
                  </>
                </GatedButton>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-amber-900">
        {t('construction.procurement.receipts.releaseFooter')}
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
  const { t } = useTranslation();
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
      onDone(t('construction.procurement.receipts.inspectionNotice', { line: receiptLine.line_number }));
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
        t('construction.procurement.receipts.releaseNotice', { bucket: fromBucket, line: receiptLine.line_number }),
      );
    },
  });

  const passedInspections = inspections.filter((inspection) => inspection.outcome === 'passed');
  const heldBase = toNumber(receiptLine.quarantined_base) + toNumber(receiptLine.disputed_base);

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('construction.procurement.receipts.inspectionHeading')}</h5>
        <GatedButton
          allowed={inspectGate.allowed}
          reason={inspectGate.reason}
          onClick={() => setShowForm((open) => !open)}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 disabled:cursor-not-allowed disabled:text-gray-400"
        >
          <>
            <FlaskConical className="h-3.5 w-3.5" aria-hidden /> {showForm ? t('construction.procurement.receipts.hideInspectionForm') : t('construction.procurement.receipts.recordInspection')}
          </>
        </GatedButton>
      </div>

      {inspections.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {inspections.map((inspection) => (
            <li key={inspection.id}>
              <span className="font-medium uppercase">{inspection.outcome}</span>{t('construction.procurement.receipts.inspectionLine', {
                quantity: formatQuantity(inspection.quantity_inspected),
                date: formatDate(inspection.inspection_date),
                method: inspection.method,
                evidence: inspection.evidence_reference,
              })}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-gray-500">{t('construction.procurement.receipts.noInspection')}</p>
      )}

      {showForm ? (
        <form
          className="mt-3 grid grid-cols-1 gap-3 rounded-lg bg-gray-50 p-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            inspectionMutation.mutate();
          }}
        >
          <Field label={t('construction.procurement.receipts.inspectionDate')} required>
            <input aria-label={t('construction.procurement.receipts.inspectionDate')} type="date" value={inspectionDate} onChange={(event) => setInspectionDate(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.receipts.outcomeLabel')} required>
            <select aria-label={t('construction.procurement.receipts.outcomeAria')} value={outcome} onChange={(event) => setOutcome(event.target.value as 'passed' | 'failed' | 'partial')} className={FIELD_CLASS}>
              <option value="passed">passed</option>
              <option value="failed">failed</option>
              <option value="partial">partial</option>
            </select>
          </Field>
          <Field label={t('construction.procurement.receipts.quantityInspected')} required hint={t('construction.procurement.receipts.receivedOnLine', { quantity: formatQuantity(receiptLine.quantity_received, receiptLine.uom) })}>
            <input aria-label={t('construction.procurement.receipts.quantityInspected')} type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.receipts.methodLabel')} required>
            <input aria-label={t('construction.procurement.receipts.methodAria')} value={method} onChange={(event) => setMethod(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.receipts.certificateReference')}>
            <input aria-label={t('construction.procurement.receipts.certificateReference')} value={certificate} onChange={(event) => setCertificate(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.receipts.evidenceLabel')} required>
            <input aria-label={t('construction.procurement.receipts.inspectionEvidenceAria')} value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={inspectionMutation.isPending || !quantity || !method.trim() || !evidence.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <ClipboardCheck className="h-3.5 w-3.5" aria-hidden /> {inspectionMutation.isPending ? t('construction.procurement.receipts.recording') : t('construction.procurement.receipts.recordInspection')}
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
            {t('construction.procurement.receipts.releaseHeading', {
              quarantined: formatQuantity(receiptLine.quarantined_base),
              disputed: formatQuantity(receiptLine.disputed_base),
            })}
          </h6>
          <p className="mt-1 text-[11px] text-amber-900">
            {t('construction.procurement.receipts.releasePBefore')}<strong>{t('construction.procurement.receipts.releasePStrong')}</strong>{t('construction.procurement.receipts.releasePAfter')}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label={t('construction.procurement.receipts.fromBucket')} required>
              <select aria-label={t('construction.procurement.receipts.fromBucket')} value={fromBucket} onChange={(event) => setFromBucket(event.target.value as 'quarantined' | 'disputed')} className={FIELD_CLASS}>
                <option value="quarantined">quarantined</option>
                <option value="disputed">disputed</option>
              </select>
            </Field>
            <Field label={t('construction.procurement.receipts.quantityLabel')} required>
              <input aria-label={t('construction.procurement.receipts.releaseQuantityAria')} type="number" min="0" step="any" value={releaseQuantity} onChange={(event) => setReleaseQuantity(event.target.value)} className={FIELD_CLASS} />
            </Field>
            <Field label={t('construction.procurement.receipts.passedInspection')} required>
              <select aria-label={t('construction.procurement.receipts.passedInspection')} value={inspectionId} onChange={(event) => setInspectionId(event.target.value)} className={FIELD_CLASS}>
                <option value="">{t('construction.procurement.receipts.selectInspection')}</option>
                {passedInspections.map((inspection) => (
                  <option key={inspection.id} value={inspection.id}>
                    {t('construction.procurement.receipts.inspectionOption', {
                      date: formatDate(inspection.inspection_date),
                      quantity: formatQuantity(inspection.quantity_inspected),
                    })}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('construction.procurement.receipts.releaseReason')} required>
              <input aria-label={t('construction.procurement.receipts.releaseReason')} value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} className={FIELD_CLASS} />
            </Field>
            <Field label={t('construction.procurement.receipts.releaseEvidence')} required>
              <input aria-label={t('construction.procurement.receipts.releaseEvidence')} value={releaseEvidence} onChange={(event) => setReleaseEvidence(event.target.value)} className={FIELD_CLASS} />
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
                    ? t('construction.procurement.receipts.releaseSubmitHint')
                    : `${inspectGate.reason} ${exceptionGate.reason}`.trim()
                }
                onClick={() => releaseMutation.mutate()}
                disabled={releaseMutation.isPending}
              >
                <>
                  <Unlock className="h-3.5 w-3.5" aria-hidden /> {releaseMutation.isPending ? t('construction.procurement.receipts.releasing') : t('construction.procurement.receipts.releaseIntoAccepted')}
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
  const { t } = useTranslation();
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
        t('construction.procurement.receipts.costBasisNotice', {
          cost: formatMoney(String(result.unit_cost_base ?? ''), String(result.cost_currency ?? '')),
          rate: String(result.exchange_rate_used ?? ''),
          discount: String(result.discount_deducted ?? 0),
          tax: String(result.nonrecoverable_tax ?? 0),
          vatSuffix: result.vat_recoverable ? t('construction.procurement.receipts.vatExcludedSuffix') : '',
        }),
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
      <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('construction.procurement.receipts.costBasisHeading')}</h5>

      {allocations.length === 0 ? (
        <EmptyState
          title={t('construction.procurement.receipts.unmatchedTitle')}
          detail={t('construction.procurement.receipts.unmatchedDetail')}
        />
      ) : (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {allocations.map((allocation) => {
            const bill = billsById.get(allocation.expense_id);
            const billLine = billLinesById.get(allocation.expense_line_id);
            return (
              <li key={allocation.id}>
                {t('construction.procurement.receipts.allocationPrefix', { quantity: formatQuantity(allocation.bill_quantity, allocation.bill_uom) })}
                <span className="font-mono">{bill?.expense_number ?? allocation.expense_id}</span>
                {bill?.reference ? t('construction.procurement.receipts.allocationRefSuffix', { reference: bill.reference }) : ''}{t('construction.procurement.receipts.allocationMiddle', { description: billLine?.description ?? t('construction.procurement.receipts.allocationLineFallback') })}
                {formatQuantity(allocation.receipt_quantity)}{t('construction.procurement.receipts.allocationSuffix')}
                {allocation.is_exception ? t('construction.procurement.receipts.allocationExceptionSuffix') : ''}
              </li>
            );
          })}
        </ul>
      )}

      {costBases.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          {costBases.map((basis) => (
            <li key={basis.id}>
              {t('construction.procurement.receipts.costBasisPrefix', { quantity: formatQuantity(basis.quantity_base) })}
              <strong>{formatMoney(basis.unit_cost_base, basis.cost_currency)}</strong>{t('construction.procurement.receipts.costBasisMiddle', {
                rate: String(basis.exchange_rate_used),
                discount: String(basis.discount_deducted),
                tax: String(basis.nonrecoverable_tax),
                vatSuffix: basis.vat_recoverable ? t('construction.procurement.receipts.vatExcludedSuffixSemicolon') : '',
                evidence: basis.evidence_reference,
              })}
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
            label={t('construction.procurement.receipts.quantityToCost')}
            required
            hint={t('construction.procurement.receipts.coveredHint', {
              covered: formatQuantity(progress.coveredBase),
              accepted: formatQuantity(progress.acceptedBase),
            })}
          >
            <input aria-label={t('construction.procurement.receipts.quantityToCost')} type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.receipts.costEvidence')} required hint={t('construction.procurement.receipts.costEvidenceHint')}>
            <input aria-label={t('construction.procurement.receipts.costEvidence')} value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <div className="flex items-end">
            <GatedButton
              allowed={gate.allowed && quantity.trim().length > 0 && evidence.trim().length > 0 && claimable.length > 0}
              reason={
                gate.allowed
                  ? claimable.length === 0
                    ? t('construction.procurement.receipts.allClaimed')
                    : t('construction.procurement.receipts.costSubmitHint')
                  : gate.reason
              }
              onClick={() => mutation.mutate({ allocationId: claimable[0].id })}
              disabled={mutation.isPending}
            >
              <>
                <Lock className="h-3.5 w-3.5" aria-hidden /> {mutation.isPending ? t('construction.procurement.receipts.recording') : t('construction.procurement.receipts.prepareCostBasis')}
              </>
            </GatedButton>
          </div>
          <p className="self-center text-[11px] text-gray-500">
            {t('construction.procurement.receipts.policyLine', {
              state: policy?.movement_posting_enabled ? t('construction.procurement.receipts.policyEnabled') : t('construction.procurement.receipts.policyDisabled'),
            })}
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
  const { t } = useTranslation();
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
          ? t('construction.procurement.receipts.nothingToPost')
          : t('construction.procurement.receipts.movementsPosted', { movements }),
      );
    },
    onError: (error) => {
      onFailure(describeConstructionFailure(error));
    },
  });

  return (
    <GatedButton
      allowed={gate.allowed}
      reason={policyEnabled ? gate.reason : `${gate.reason} ${t('construction.procurement.receipts.policyAlsoDisabled')}`}
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      <>
        <Unlock className="h-4 w-4" aria-hidden /> {mutation.isPending ? t('construction.procurement.receipts.posting') : t('construction.procurement.receipts.postStockMovements')}
      </>
    </GatedButton>
  );
}
