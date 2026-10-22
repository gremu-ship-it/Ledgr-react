import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link2, Search, ShieldAlert } from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  CONSTRUCTION_CAPABILITY_LABELS,
  type BillMatchInput,
  type ConstructionSupplierInvoiceReference,
} from '@/dal/repositories/ConstructionProcurementRepository';
import { describeConstructionFailure } from '@/lib/construction/constructionCommandFeedback';
import {
  formatDate,
  formatMoney,
  formatQuantity,
  gateForCapability,
  matchesSearch,
  newIdempotencyKey,
  normalizeReference,
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
 * Supplier-bill matching.
 *
 * The invoice source stays where it is: existing supplier bills
 * (`expenses` / `expense_lines`), with `expenses.reference` carrying the
 * supplier's own invoice reference. This screen registers that reference (the
 * duplicate guard) and matches a bill line to a receipt line. Matching never
 * creates a receipt and never asks the ordinary purchase hook to move stock; the
 * server refuses a bill that already did (`bill-already-inventoried`).
 */
export function ConstructionBillMatchingSection({
  businessId,
  capabilities,
}: {
  businessId: string;
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const dataQuery = useQuery({
    queryKey: ['construction', 'bill-matching', businessId],
    queryFn: async () => {
      const [bills, billLines, references, receipts, sites, products, contacts] = await Promise.all([
        repos.expense.findByBusiness(businessId),
        repos.construction.findSupplierBillLines(businessId),
        repos.construction.findSupplierInvoiceReferences(businessId),
        repos.construction.findReceipts(businessId),
        repos.construction.findSites(businessId),
        repos.inventory.findAllProducts(businessId),
        repos.contact.findByBusiness(businessId),
      ]);
      return { bills, billLines, references, receipts, sites, products, contacts };
    },
  });

  if (dataQuery.isLoading) return <LoadingBlock label={t('construction.procurement.billMatching.loading')} />;
  if (dataQuery.isError) {
    return (
      <ErrorBanner
        message={t('construction.procurement.billMatching.loadError', {
          detail: dataQuery.error instanceof Error ? dataQuery.error.message : t('construction.procurement.shared.unknownError'),
        })}
      />
    );
  }

  const { bills, billLines, references, receipts, sites, products, contacts } = dataQuery.data!;
  const supplierBills = bills.filter((bill) => bill.expense_type === 'bill' && !bill.deleted_at);
  const contactsById = new Map(contacts.map((contact) => [contact.id, contact]));
  const referencesByExpense = new Map(references.map((reference) => [reference.expense_id, reference]));

  const filtered = supplierBills.filter((bill) =>
    matchesSearch([bill.expense_number, bill.reference, contactsById.get(bill.contact_id ?? '')?.name, bill.currency], search),
  );

  return (
    <div className="space-y-6">
      {notice ? <SuccessBanner message={notice} /> : null}

      <InfoNote>
        <p>
          {t('construction.procurement.billMatching.infoNote')}
        </p>
      </InfoNote>

      <SectionCard
        title={t('construction.procurement.billMatching.title')}
        description={t('construction.procurement.billMatching.description')}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('construction.procurement.billMatching.searchPlaceholder')}
              aria-label={t('construction.procurement.billMatching.searchAria')}
              className="w-64 rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        }
      >
        {supplierBills.length === 0 ? (
          <EmptyState
            title={t('construction.procurement.billMatching.noneTitle')}
            detail={t('construction.procurement.billMatching.noneDetail')}
          />
        ) : filtered.length === 0 ? (
          <EmptyState title={t('construction.procurement.billMatching.noMatchTitle')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">{t('construction.procurement.billMatching.thBill')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.billMatching.thSupplierReference')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.billMatching.thSupplier')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.billMatching.thCurrency')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.billMatching.thRegistration')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.billMatching.thAction')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((bill) => {
                  const registration = referencesByExpense.get(bill.id);
                  return (
                    <tr key={bill.id} className="border-t border-gray-100">
                      <td className="px-2 py-2 font-mono text-xs text-gray-800">{bill.expense_number}</td>
                      <td className="px-2 py-2 text-gray-800">{bill.reference ?? <span className="text-gray-400">{t('construction.procurement.billMatching.noneRecorded')}</span>}</td>
                      <td className="px-2 py-2 text-gray-700">{contactsById.get(bill.contact_id ?? '')?.name ?? '—'}</td>
                      <td className="px-2 py-2 text-gray-700">{bill.currency}</td>
                      <td className="px-2 py-2">
                        {registration ? (
                          <StatusPill
                            label={registration.status === 'active' ? t('construction.procurement.billMatching.registeredPill') : t('construction.procurement.billMatching.exceptionPillShort')}
                            className={registration.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}
                          />
                        ) : (
                          <StatusPill label={t('construction.procurement.billMatching.notRegisteredPill')} className="bg-slate-100 text-slate-700" />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {registration ? (
                          <span className="text-xs text-gray-500">
                            {registration.reference_normalized}
                            {registration.exception_of ? t('construction.procurement.billMatching.exceptionSuffix') : ''}
                          </span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <RegisterReferenceButton
                              businessId={businessId}
                              expenseId={bill.id}
                              capabilities={capabilities}
                              hasReference={Boolean(bill.reference)}
                              onDone={(message) => setNotice(message)}
                            />
                            <SupplierReferenceExceptionTrigger
                              bill={{
                                id: bill.id,
                                expense_number: bill.expense_number,
                                reference: bill.reference,
                                supplierContactId: bill.contact_id,
                                supplierName: contactsById.get(bill.contact_id ?? '')?.name ?? '—',
                              }}
                              capabilities={capabilities}
                              registrations={references}
                              onDone={(message) => setNotice(message)}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <MatchForm
        businessId={businessId}
        capabilities={capabilities}
        receipts={receipts}
        sites={sites}
        products={products}
        bills={supplierBills.map((bill) => ({
          id: bill.id,
          expense_number: bill.expense_number,
          reference: bill.reference,
          currency: bill.currency,
          contact_id: bill.contact_id,
          registered: referencesByExpense.has(bill.id),
        }))}
        billLines={billLines}
        onDone={(message) => setNotice(message)}
      />
    </div>
  );
}

function RegisterReferenceButton({
  businessId,
  expenseId,
  capabilities,
  hasReference,
  onDone,
}: {
  businessId: string;
  expenseId: string;
  capabilities: string[];
  hasReference: boolean;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.billMatch,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.billMatch],
  );

  const mutation = useMutation({
    mutationFn: () => repos.construction.registerSupplierInvoiceReference(expenseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['construction'] });
      onDone(t('construction.procurement.billMatching.registeredNotice'));
    },
  });

  void businessId;

  return (
    <div className="flex flex-col items-end gap-1">
      <GatedButton
        allowed={gate.allowed && hasReference}
        reason={!hasReference ? t('construction.procurement.billMatching.addReferenceFirst') : gate.reason}
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 disabled:cursor-not-allowed disabled:text-gray-400"
      >
        <>
          <Link2 className="h-3.5 w-3.5" aria-hidden /> {mutation.isPending ? t('construction.procurement.billMatching.registering') : t('construction.procurement.billMatching.registerReference')}
        </>
      </GatedButton>
      {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}
    </div>
  );
}

/**
 * The duplicate-reference exception path.
 *
 * Registering a reference is refused when the same supplier already has it
 * registered (`supplier-invoice-reference-duplicate`). The documented next step
 * is an evidenced exception naming that registration — this is that screen. The
 * candidates shown are the ACTIVE registrations for the same supplier; the
 * database re-checks sameness of business, supplier and normalized reference, and
 * it refuses a bill that is already registered, so nothing here is trusted.
 *
 * The command takes no idempotency key. It does not need one for safety — a second
 * call for the same bill is refused because the bill already has a registration —
 * but that means a retry after a lost response is reported rather than silently
 * replayed, and the screen says so instead of offering a blind retry.
 */
function SupplierReferenceExceptionTrigger({
  bill,
  capabilities,
  registrations,
  onDone,
}: {
  bill: { id: string; expense_number: string; reference: string | null; supplierContactId: string | null; supplierName: string };
  capabilities: string[];
  registrations: ConstructionSupplierInvoiceReference[];
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.exceptionAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.exceptionAuthorize],
  );

  if (!open) {
    return (
      <GatedButton
        allowed={gate.allowed}
        reason={gate.reason}
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-white disabled:text-gray-400"
      >
        <>
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> {t('construction.procurement.billMatching.duplicateTrigger')}
        </>
      </GatedButton>
    );
  }

  return (
    <SupplierReferenceExceptionPanel
      bill={bill}
      capabilities={capabilities}
      registrations={registrations}
      onDone={(message) => {
        setOpen(false);
        onDone(message);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function SupplierReferenceExceptionPanel({
  bill,
  capabilities,
  registrations,
  onDone,
  onCancel,
}: {
  bill: { id: string; expense_number: string; reference: string | null; supplierContactId: string | null; supplierName: string };
  capabilities: string[];
  registrations: ConstructionSupplierInvoiceReference[];
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [conflictId, setConflictId] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');

  const normalized = normalizeReference(bill.reference);
  // Only the SAME SUPPLIER's active registrations can be the named conflict; the
  // server also requires the same business and the same normalized reference, and
  // recomputes all three itself.
  const supplierRegistrations = useMemo(
    () =>
      registrations.filter(
        (entry) =>
          entry.status === 'active' &&
          entry.reference_normalized &&
          entry.supplier_contact_id === bill.supplierContactId,
      ),
    [registrations, bill.supplierContactId],
  );
  const conflict = supplierRegistrations.find((entry) => entry.id === conflictId) ?? null;
  const matchesReference = conflict ? conflict.reference_normalized === normalized : false;

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.exceptionAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.exceptionAuthorize],
  );

  const mutation = useMutation({
    mutationFn: () =>
      repos.construction.registerSupplierInvoiceReferenceException({
        expenseId: bill.id,
        exceptionOf: conflictId,
        reason: reason.trim(),
        evidence: evidence.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['construction'] });
      onDone(
        t('construction.procurement.billMatching.exceptionNotice'),
      );
    },
    onError: () => {
      // A refusal here can mean the bill was registered while this screen was
      // open (including by a retry whose first response was lost). Re-read rather
      // than leave a stale row, and show the server's own words.
      queryClient.invalidateQueries({ queryKey: ['construction'] });
    },
  });

  const canSubmit =
    gate.allowed &&
    conflict !== null &&
    matchesReference &&
    reason.trim().length > 0 &&
    evidence.trim().length > 0;

  return (
    <form
      aria-label={t('construction.procurement.billMatching.exceptionFormAria')}
      className="mt-2 w-full space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-amber-900">{t('construction.procurement.billMatching.exceptionTitle')}</h4>
        <StatusPill label={t('construction.procurement.billMatching.exceptionPill')} className="bg-amber-100 text-amber-900" />
      </div>
      <p className="text-xs text-amber-900">
        {t('construction.procurement.billMatching.exceptionInfo')}
      </p>

      <div className="rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs text-gray-700">
        <p className="font-medium text-gray-900">{t('construction.procurement.billMatching.billBeingRegistered')}</p>
        <p>
          <span className="font-mono">{bill.expense_number}</span>{t('construction.procurement.billMatching.billLineMiddle', { supplier: bill.supplierName })}
          <span className="font-mono">{bill.reference ?? t('construction.procurement.billMatching.noReferenceFallback')}</span>
          {normalized ? <>{t('construction.procurement.billMatching.normalizedSuffix')}<span className="font-mono">{normalized}</span></> : null}
        </p>
      </div>

      <Field label={t('construction.procurement.billMatching.conflictLabel')} required hint={t('construction.procurement.billMatching.conflictHint')}>
        <select
          aria-label={t('construction.procurement.billMatching.conflictLabel')}
          value={conflictId}
          onChange={(event) => setConflictId(event.target.value)}
          className={FIELD_CLASS}
        >
          <option value="">{t('construction.procurement.billMatching.selectConflict')}</option>
          {supplierRegistrations.map((registration) => (
            <option key={registration.id} value={registration.id}>
              {registration.reference_normalized}
              {registration.reference_normalized === normalized ? t('construction.procurement.billMatching.sameReferenceSuffix') : ''}{t('construction.procurement.billMatching.recordedSuffix', { date: registration.recorded_at.slice(0, 10) })}
            </option>
          ))}
        </select>
      </Field>

      {supplierRegistrations.length === 0 ? (
        <p className="text-xs text-amber-900">
          {t('construction.procurement.billMatching.noActiveRegistrations')}
        </p>
      ) : null}

      {conflict && !matchesReference ? (
        <p className="text-xs text-amber-900">
          {t('construction.procurement.billMatching.mismatchBefore')}<strong>{t('construction.procurement.billMatching.mismatchStrong')}</strong>{t('construction.procurement.billMatching.mismatchMiddle')}{normalized || t('construction.procurement.billMatching.mismatchFallback')}{t('construction.procurement.billMatching.mismatchAfter')}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={t('construction.procurement.billMatching.exceptionReason')} required>
          <input
            aria-label={t('construction.procurement.billMatching.exceptionReason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD_CLASS}
            placeholder={t('construction.procurement.billMatching.exceptionReasonPlaceholder')}
          />
        </Field>
        <Field label={t('construction.procurement.billMatching.exceptionEvidence')} required>
          <input
            aria-label={t('construction.procurement.billMatching.exceptionEvidence')}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            className={FIELD_CLASS}
            placeholder={t('construction.procurement.billMatching.exceptionEvidencePlaceholder')}
          />
        </Field>
      </div>

      {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}
      {mutation.isError ? (
        <p className="text-xs text-gray-600">
          {t('construction.procurement.billMatching.alreadyRegisteredNote')}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <GatedButton
          allowed={canSubmit}
          reason={
            !gate.allowed
              ? gate.reason
              : conflict === null
                ? t('construction.procurement.billMatching.selectConflictReason')
                : !matchesReference
                  ? t('construction.procurement.billMatching.differentReferenceReason')
                  : t('construction.procurement.billMatching.reasonEvidenceRequired')
          }
          disabled={mutation.isPending}
          type="submit"
        >
          <>
            <ShieldAlert className="h-4 w-4" aria-hidden />{' '}
            {mutation.isPending ? t('construction.procurement.billMatching.recording') : t('construction.procurement.billMatching.recordException')}
          </>
        </GatedButton>
        <button type="button" onClick={onCancel} className="text-xs text-gray-600 hover:text-gray-900">
          {t('construction.procurement.shared.cancel')}
        </button>
      </div>
    </form>
  );
}

function MatchForm({
  businessId,
  capabilities,
  receipts,
  sites,
  products,
  bills,
  billLines,
  onDone,
}: {
  businessId: string;
  capabilities: string[];
  receipts: Array<{ id: string; grn_number: string; receipt_date: string; site_id: string; project_ref: string; po_id: string }>;
  sites: Array<{ id: string; site_code: string }>;
  products: Array<{ id: string; name: string }>;
  bills: Array<{ id: string; expense_number: string; reference: string | null; currency: string; contact_id: string | null; registered: boolean }>;
  billLines: Array<{ id: string; expense_id: string; line_number: number; description: string; product_id: string | null; quantity: number | string; unit_price: number | string; tax_code: string }>;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [grnId, setGrnId] = useState('');
  const [receiptLineId, setReceiptLineId] = useState('');
  const [billId, setBillId] = useState('');
  const [billLineId, setBillLineId] = useState('');
  const [billUom, setBillUom] = useState('');
  const [billQuantity, setBillQuantity] = useState('');
  const [receiptQuantity, setReceiptQuantity] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionEvidence, setExceptionEvidence] = useState('');
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const receipt = receipts.find((entry) => entry.id === grnId) ?? null;
  const selectedBill = bills.find((bill) => bill.id === billId) ?? null;
  const billLinesForBill = billLines.filter((line) => line.expense_id === billId);
  const selectedBillLine = billLinesForBill.find((line) => line.id === billLineId) ?? null;

  const receiptLinesQuery = useQuery({
    queryKey: ['construction', 'receipt-lines', grnId],
    queryFn: () => repos.construction.findReceiptLines(grnId),
    enabled: Boolean(grnId),
  });

  const acceptedLines = (receiptLinesQuery.data ?? []).filter((line) => toNumber(line.accepted_base) > 0);
  /**
   * Which receipt line the match targets. A receipt can carry several accepted
   * lines, and only the operator knows which one a bill line corresponds to, so
   * the screen shows the choice instead of picking one behind their back. With
   * exactly one accepted line there is no decision to make, so it is selected —
   * the common case stays a single click.
   */
  const selectedReceiptLine =
    acceptedLines.length === 1 ? acceptedLines[0] : acceptedLines.find((line) => line.id === receiptLineId) ?? null;

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.billMatch,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.billMatch],
  );
  const exceptionGate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.exceptionAuthorize,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.exceptionAuthorize],
  );

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const sitesById = useMemo(() => new Map(sites.map((site) => [site.id, site])), [sites]);

  const mutation = useMutation({
    mutationFn: ({ grnLineId }: { grnLineId: string }) => {
      const payload: BillMatchInput = {
        business_id: businessId,
        grn_line_id: grnLineId,
        expense_line_id: billLineId,
        bill_uom: billUom.trim().toUpperCase(),
        bill_quantity: billQuantity,
        receipt_quantity: receiptQuantity,
        ...(exceptionReason.trim() ? { exception_reason: exceptionReason.trim() } : {}),
        ...(exceptionEvidence.trim() ? { exception_evidence: exceptionEvidence.trim() } : {}),
      };
      return repos.construction.matchBillLineToReceipt(payload, clientKey);
    },
    onSuccess: (result) => {
      setClientKey(newIdempotencyKey());
      setBillQuantity('');
      setReceiptQuantity('');
      setExceptionReason('');
      setExceptionEvidence('');
      queryClient.invalidateQueries({ queryKey: ['construction'] });
      onDone(
        result.is_exception
          ? t('construction.procurement.billMatching.matchExceptionNotice')
          : t('construction.procurement.billMatching.matchNotice'),
      );
    },
  });

  const ready = Boolean(receipt && selectedReceiptLine && selectedBill && selectedBillLine && billUom && billQuantity && receiptQuantity);
  const currencyMismatch = receipt && selectedBill ? selectedBill.currency !== (bills.find((bill) => bill.id === billId)?.currency ?? '') : false;

  return (
    <SectionCard
      title={t('construction.procurement.billMatching.matchTitle')}
      description={t('construction.procurement.billMatching.matchDescription')}
    >
      <form
        aria-label={t('construction.procurement.billMatching.matchTitle')}
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedReceiptLine) mutation.mutate({ grnLineId: selectedReceiptLine.id });
        }}
      >
        <Field label={t('construction.procurement.billMatching.goodsReceipt')} required>
          <select
            aria-label={t('construction.procurement.billMatching.goodsReceipt')}
            value={grnId}
            onChange={(event) => {
              setGrnId(event.target.value);
              // The lines below belong to the previous receipt; the target is
              // re-chosen rather than carried across.
              setReceiptLineId('');
            }}
            className={FIELD_CLASS}
          >
            <option value="">{t('construction.procurement.billMatching.selectReceipt')}</option>
            {receipts.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t('construction.procurement.billMatching.receiptOption', {
                  number: entry.grn_number,
                  site: sitesById.get(entry.site_id)?.site_code ?? '',
                  project: entry.project_ref,
                })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('construction.procurement.billMatching.supplierBill')} required hint={t('construction.procurement.billMatching.supplierBillHint')}>
          <select aria-label={t('construction.procurement.billMatching.supplierBill')} value={billId} onChange={(event) => { setBillId(event.target.value); setBillLineId(''); }} className={FIELD_CLASS}>
            <option value="">{t('construction.procurement.billMatching.selectBill')}</option>
            {bills.map((bill) => (
              <option key={bill.id} value={bill.id} disabled={!bill.registered}>
                {t('construction.procurement.billMatching.billOption', {
                  number: bill.expense_number,
                  reference: bill.reference ?? t('construction.procurement.billMatching.noReference'),
                  currency: bill.currency,
                  suffix: bill.registered ? '' : t('construction.procurement.billMatching.referenceNotRegistered'),
                })}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('construction.procurement.billMatching.billLine')} required>
          <select aria-label={t('construction.procurement.billMatching.billLine')} value={billLineId} onChange={(event) => setBillLineId(event.target.value)} className={FIELD_CLASS} disabled={!billId}>
            <option value="">{t('construction.procurement.billMatching.selectBillLine')}</option>
            {billLinesForBill.map((line) => (
              <option key={line.id} value={line.id}>
                {t('construction.procurement.billMatching.billLineOption', {
                  line: line.line_number,
                  description: line.description,
                  quantity: formatQuantity(line.quantity),
                  price: formatMoney(line.unit_price, selectedBill?.currency),
                })}
                {line.tax_code !== 'none' ? t('construction.procurement.billMatching.taxSuffix', { taxCode: line.tax_code }) : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label={t('construction.procurement.billMatching.receiptLine')}
          required
          hint={t('construction.procurement.billMatching.receiptLineHint')}
        >
          <select
            aria-label={t('construction.procurement.billMatching.receiptLine')}
            value={selectedReceiptLine?.id ?? ''}
            onChange={(event) => setReceiptLineId(event.target.value)}
            className={FIELD_CLASS}
            disabled={!grnId || acceptedLines.length === 0}
          >
            <option value="">{t('construction.procurement.billMatching.selectReceiptLine')}</option>
            {acceptedLines.map((line) => (
              <option key={line.id} value={line.id}>
                {/* `accepted_base` is the product base unit, which is not necessarily
                    the unit the line was recorded in — label it as what it is. */}
                {t('construction.procurement.billMatching.receiptLineOption', {
                  line: line.line_number,
                  product: productsById.get(line.product_id)?.name ?? line.product_id,
                  quantity: formatQuantity(line.accepted_base),
                })}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t('construction.procurement.billMatching.billUnit')} required hint={t('construction.procurement.billMatching.billUnitHint')}>
          <input aria-label={t('construction.procurement.billMatching.billUnit')} value={billUom} onChange={(event) => setBillUom(event.target.value.toUpperCase())} className={FIELD_CLASS} />
        </Field>
        <Field label={t('construction.procurement.billMatching.billQuantityLabel')} required>
          <input aria-label={t('construction.procurement.billMatching.billQuantityLabel')} type="number" min="0" step="any" value={billQuantity} onChange={(event) => setBillQuantity(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <Field label={t('construction.procurement.billMatching.receiptQuantity')} required hint={t('construction.procurement.billMatching.receiptQuantityHint')}>
          <input aria-label={t('construction.procurement.billMatching.receiptQuantity')} type="number" min="0" step="any" value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} className={FIELD_CLASS} />
        </Field>

        <details className="sm:col-span-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-800">
            {t('construction.procurement.billMatching.exceptionSummary')}
          </summary>
          <p className="mt-1 text-xs text-gray-600">
            {t('construction.procurement.billMatching.exceptionInfoMatch')}
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t('construction.procurement.billMatching.exceptionReason')}>
              <input aria-label={t('construction.procurement.billMatching.exceptionReason')} value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} className={FIELD_CLASS} />
            </Field>
            <Field label={t('construction.procurement.billMatching.exceptionEvidence')}>
              <input aria-label={t('construction.procurement.billMatching.exceptionEvidence')} value={exceptionEvidence} onChange={(event) => setExceptionEvidence(event.target.value)} className={FIELD_CLASS} />
            </Field>
          </div>
          {!exceptionGate.allowed ? (
            <p className="mt-2 flex items-start gap-1 text-xs text-amber-800">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {exceptionGate.reason}
            </p>
          ) : null}
        </details>

        <div className="sm:col-span-3">
          <div className="flex flex-wrap items-center gap-3">
            <GatedButton
              type="submit"
              allowed={gate.allowed && ready}
              reason={
                gate.allowed
                  ? !grnId
                    ? t('construction.procurement.billMatching.chooseAll')
                    : acceptedLines.length === 0
                      ? t('construction.procurement.billMatching.nothingAccepted')
                      : t('construction.procurement.billMatching.chooseRest')
                  : gate.reason
              }
            >
              <>
                <Link2 className="h-4 w-4" aria-hidden /> {mutation.isPending ? t('construction.procurement.billMatching.matching') : t('construction.procurement.billMatching.matchButton')}
              </>
            </GatedButton>
            {receipt ? (
              <span className="text-xs text-gray-600">
                {acceptedLines.length === 0
                  ? t('construction.procurement.billMatching.receiptNothingAccepted', { number: receipt.grn_number })
                  : t('construction.procurement.billMatching.receiptAcceptedLines', {
                      number: receipt.grn_number,
                      lines: acceptedLines.length,
                      lineWord: acceptedLines.length === 1 ? t('construction.procurement.billMatching.lineWordOne') : t('construction.procurement.billMatching.lineWordOther'),
                    })}
              </span>
            ) : null}
          </div>
          {currencyMismatch ? (
            <p className="mt-2 text-xs text-amber-800">
              {t('construction.procurement.billMatching.currencyMismatchNote')}
            </p>
          ) : null}
          {mutation.isError ? (
            <div className="mt-3">
              <FailureBanner failure={describeConstructionFailure(mutation.error)} />
            </div>
          ) : null}
          <p className="mt-3 text-xs text-gray-500">
            {t('construction.procurement.billMatching.matchFooter')}
          </p>
        </div>
      </form>

      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('construction.procurement.billMatching.productsHeading')}</h4>
        {acceptedLines.length === 0 ? (
          <EmptyState title={t('construction.procurement.billMatching.noAcceptedLineTitle')} detail={t('construction.procurement.billMatching.noAcceptedLineDetail')} />
        ) : (
          <ul className="space-y-1 text-xs text-gray-700">
            {acceptedLines.map((line) => (
              <li key={line.id}>
                {t('construction.procurement.billMatching.productLine', {
                  line: line.line_number,
                  product: productsById.get(line.product_id)?.name ?? line.product_id,
                  quantity: formatQuantity(line.accepted_base),
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('construction.procurement.billMatching.recentMatchesHeading')}</h4>
        <RecentMatches businessId={businessId} />
      </div>
    </SectionCard>
  );
}

function RecentMatches({ businessId }: { businessId: string }) {
  const { t } = useTranslation();
  const allocationsQuery = useQuery({
    queryKey: ['construction', 'allocations', businessId],
    queryFn: () => repos.construction.findAllocationsForBusiness(businessId),
  });

  if (allocationsQuery.isLoading) return <LoadingBlock label={t('construction.procurement.billMatching.matchesLoading')} />;
  if (allocationsQuery.isError) return <ErrorBanner message={t('construction.procurement.billMatching.matchesLoadError')} />;
  const rows = (allocationsQuery.data ?? []).slice(0, 10);
  if (rows.length === 0) return <EmptyState title={t('construction.procurement.billMatching.noMatchesTitle')} />;

  return (
    <ul className="space-y-1 text-xs text-gray-700">
      {rows.map((row) => (
        <li key={row.id}>
          {t('construction.procurement.billMatching.matchLine', {
            bill: formatQuantity(row.bill_quantity, row.bill_uom),
            receipt: formatQuantity(row.receipt_quantity, row.receipt_uom),
            date: formatDate(row.matched_at),
          })}
          {row.is_exception ? t('construction.procurement.billMatching.authorizedExceptionSuffix') : ''}
        </li>
      ))}
    </ul>
  );
}
