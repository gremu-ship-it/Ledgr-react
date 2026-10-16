import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

  if (dataQuery.isLoading) return <LoadingBlock label="Loading supplier bills and receipts…" />;
  if (dataQuery.isError) {
    return (
      <ErrorBanner
        message={`Bill matching could not be loaded: ${dataQuery.error instanceof Error ? dataQuery.error.message : 'unknown error'}`}
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
          One supplier reference can only be registered once per supplier. A genuine duplicate (for example a re-issued invoice number) needs an
          evidenced exception that names the conflicting registration. Matching is exact: same product, same supplier, same currency, explicit unit
          conversion — no tolerance is applied automatically.
        </p>
      </InfoNote>

      <SectionCard
        title="Supplier bills and their registered references"
        description="The supplier's own invoice reference lives on the existing bill (expenses.reference). Registration is the duplicate guard that matching depends on."
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-gray-400" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search bill, reference, supplier…"
              aria-label="Search supplier bills"
              className="w-64 rounded-lg border border-gray-300 py-2 pl-8 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        }
      >
        {supplierBills.length === 0 ? (
          <EmptyState
            title="No supplier bills yet"
            detail="Record the bill in Expenses (with the supplier's own invoice reference) and mark it a construction procurement bill so the ordinary purchase hook does not receipt the stock."
          />
        ) : filtered.length === 0 ? (
          <EmptyState title="No bill matches that search" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Bill</th>
                  <th className="px-2 py-2">Supplier reference</th>
                  <th className="px-2 py-2">Supplier</th>
                  <th className="px-2 py-2">Currency</th>
                  <th className="px-2 py-2">Registration</th>
                  <th className="px-2 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((bill) => {
                  const registration = referencesByExpense.get(bill.id);
                  return (
                    <tr key={bill.id} className="border-t border-gray-100">
                      <td className="px-2 py-2 font-mono text-xs text-gray-800">{bill.expense_number}</td>
                      <td className="px-2 py-2 text-gray-800">{bill.reference ?? <span className="text-gray-400">none recorded</span>}</td>
                      <td className="px-2 py-2 text-gray-700">{contactsById.get(bill.contact_id ?? '')?.name ?? '—'}</td>
                      <td className="px-2 py-2 text-gray-700">{bill.currency}</td>
                      <td className="px-2 py-2">
                        {registration ? (
                          <StatusPill
                            label={registration.status === 'active' ? 'registered' : 'exception'}
                            className={registration.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}
                          />
                        ) : (
                          <StatusPill label="not registered" className="bg-slate-100 text-slate-700" />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {registration ? (
                          <span className="text-xs text-gray-500">
                            {registration.reference_normalized}
                            {registration.exception_of ? ' · exception' : ''}
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
      onDone('Supplier invoice reference registered.');
    },
  });

  void businessId;

  return (
    <div className="flex flex-col items-end gap-1">
      <GatedButton
        allowed={gate.allowed && hasReference}
        reason={!hasReference ? 'Add the supplier’s own invoice reference to this bill first (Expenses).' : gate.reason}
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-800 disabled:cursor-not-allowed disabled:text-gray-400"
      >
        <>
          <Link2 className="h-3.5 w-3.5" aria-hidden /> {mutation.isPending ? 'Registering…' : 'Register reference'}
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
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Duplicate reference? Record an exception
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
        'Supplier reference registered as an authorized duplicate exception. No stock movement and no journal entry were created.',
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
      aria-label="Record duplicate supplier reference exception"
      className="mt-2 w-full space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold text-amber-900">Duplicate supplier reference — authorized exception</h4>
        <StatusPill label="Exception" className="bg-amber-100 text-amber-900" />
      </div>
      <p className="text-xs text-amber-900">
        The supplier reused an invoice reference that is already registered for them. This records the bill as an exception against that
        registration. The conflicting registration is not edited — registrations are append-only — and this command creates no stock
        movement and no journal entry.
      </p>

      <div className="rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-xs text-gray-700">
        <p className="font-medium text-gray-900">Bill being registered</p>
        <p>
          <span className="font-mono">{bill.expense_number}</span> · {bill.supplierName} · reference{' '}
          <span className="font-mono">{bill.reference ?? '(none)'}</span>
          {normalized ? <> · normalized <span className="font-mono">{normalized}</span></> : null}
        </p>
      </div>

      <Field label="Registered reference this conflicts with" required hint="Only active registrations can be named. The server refuses anything else.">
        <select
          aria-label="Registered reference this conflicts with"
          value={conflictId}
          onChange={(event) => setConflictId(event.target.value)}
          className={FIELD_CLASS}
        >
          <option value="">Select the conflicting registration…</option>
          {supplierRegistrations.map((registration) => (
            <option key={registration.id} value={registration.id}>
              {registration.reference_normalized}
              {registration.reference_normalized === normalized ? ' · same reference' : ''} · recorded {registration.recorded_at.slice(0, 10)}
            </option>
          ))}
        </select>
      </Field>

      {supplierRegistrations.length === 0 ? (
        <p className="text-xs text-amber-900">
          No active registration is visible in this business. An exception must name an existing active registration for the same supplier
          and the same reference, so there is nothing to record against yet.
        </p>
      ) : null}

      {conflict && !matchesReference ? (
        <p className="text-xs text-amber-900">
          That registration carries a different reference from this bill. An exception must name the registration that holds the{' '}
          <strong>same</strong> reference ({normalized || 'this bill has no reference recorded'}), so the server would refuse this choice.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label="Exception reason" required>
          <input
            aria-label="Exception reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={FIELD_CLASS}
            placeholder="e.g. supplier reissued the same invoice number"
          />
        </Field>
        <Field label="Exception evidence" required>
          <input
            aria-label="Exception evidence"
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            className={FIELD_CLASS}
            placeholder="e.g. supplier e-mail thread 2026-10-16"
          />
        </Field>
      </div>

      {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}
      {mutation.isError ? (
        <p className="text-xs text-gray-600">
          If the server says this bill already has a registered reference, the registration exists — the list above has been refreshed and no
          duplicate was created. Check the registration column before submitting again.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <GatedButton
          allowed={canSubmit}
          reason={
            !gate.allowed
              ? gate.reason
              : conflict === null
                ? 'Select the registered reference this bill conflicts with.'
                : !matchesReference
                  ? 'The named registration holds a different reference from this bill.'
                  : 'A written reason and an evidence reference are required.'
          }
          disabled={mutation.isPending}
          type="submit"
        >
          <>
            <ShieldAlert className="h-4 w-4" aria-hidden />{' '}
            {mutation.isPending ? 'Recording…' : 'Record exception'}
          </>
        </GatedButton>
        <button type="button" onClick={onCancel} className="text-xs text-gray-600 hover:text-gray-900">
          Cancel
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
  const queryClient = useQueryClient();
  const [grnId, setGrnId] = useState('');
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
          ? 'Match recorded as an authorized exception. No stock movement and no journal entry were created.'
          : 'Bill line matched to the receipt line. Matching creates no stock movement and no journal entry.',
      );
    },
  });

  const ready = Boolean(receipt && selectedBill && selectedBillLine && billUom && billQuantity && receiptQuantity);
  const currencyMismatch = receipt && selectedBill ? selectedBill.currency !== (bills.find((bill) => bill.id === billId)?.currency ?? '') : false;

  return (
    <SectionCard
      title="Match a supplier bill line to a receipt line"
      description="Split allocations across partial receipts and combined allocations to several bill lines are both supported. The server caps the matched quantity at the remaining bill-line quantity and the remaining accepted receipt quantity."
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          const line = acceptedLines[0];
          if (line) mutation.mutate({ grnLineId: line.id });
        }}
      >
        <Field label="Goods receipt" required>
          <select aria-label="Goods receipt" value={grnId} onChange={(event) => setGrnId(event.target.value)} className={FIELD_CLASS}>
            <option value="">Select a receipt…</option>
            {receipts.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.grn_number} · {sitesById.get(entry.site_id)?.site_code ?? ''} · {entry.project_ref}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier bill" required hint="Only bills whose supplier reference is registered can be matched.">
          <select aria-label="Supplier bill" value={billId} onChange={(event) => { setBillId(event.target.value); setBillLineId(''); }} className={FIELD_CLASS}>
            <option value="">Select a bill…</option>
            {bills.map((bill) => (
              <option key={bill.id} value={bill.id} disabled={!bill.registered}>
                {bill.expense_number} · {bill.reference ?? 'no reference'} · {bill.currency} {bill.registered ? '' : '(reference not registered)'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bill line" required>
          <select aria-label="Bill line" value={billLineId} onChange={(event) => setBillLineId(event.target.value)} className={FIELD_CLASS} disabled={!billId}>
            <option value="">Select a bill line…</option>
            {billLinesForBill.map((line) => (
              <option key={line.id} value={line.id}>
                {line.line_number} · {line.description} · {formatQuantity(line.quantity)} @ {formatMoney(line.unit_price, selectedBill?.currency)}
                {line.tax_code !== 'none' ? ` · ${line.tax_code}` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Bill unit" required hint="The unit the bill line is priced in. The server refuses a unit it cannot convert to the product base unit.">
          <input aria-label="Bill unit" value={billUom} onChange={(event) => setBillUom(event.target.value.toUpperCase())} className={FIELD_CLASS} />
        </Field>
        <Field label="Bill quantity" required>
          <input aria-label="Bill quantity" type="number" min="0" step="any" value={billQuantity} onChange={(event) => setBillQuantity(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <Field label="Receipt quantity" required hint="What the bill quantity corresponds to on the receipt.">
          <input aria-label="Receipt quantity" type="number" min="0" step="any" value={receiptQuantity} onChange={(event) => setReceiptQuantity(event.target.value)} className={FIELD_CLASS} />
        </Field>

        <details className="sm:col-span-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-800">
            Quantity difference or duplicate reference? Record an authorized exception
          </summary>
          <p className="mt-1 text-xs text-gray-600">
            A bill quantity that differs from the receipt quantity is refused unless an authorizer records a reason and evidence. Left blank, the
            quantities must agree exactly — no tolerance is applied automatically.
          </p>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Exception reason">
              <input aria-label="Exception reason" value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} className={FIELD_CLASS} />
            </Field>
            <Field label="Exception evidence">
              <input aria-label="Exception evidence" value={exceptionEvidence} onChange={(event) => setExceptionEvidence(event.target.value)} className={FIELD_CLASS} />
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
            <GatedButton allowed={gate.allowed && ready && acceptedLines.length > 0} reason={gate.allowed ? 'Choose a receipt, a bill line, the bill unit and both quantities. The receipt must have an accepted quantity.' : gate.reason}>
              <>
                <Link2 className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Matching…' : 'Match bill line to the receipt'}
              </>
            </GatedButton>
            {receipt ? (
              <span className="text-xs text-gray-600">
                Accepted quantities on {receipt.grn_number}:{' '}
                {acceptedLines.length === 0
                  ? 'none yet — a receipt with nothing accepted cannot be matched'
                  : acceptedLines
                      .map((line) => `line ${line.line_number}: ${formatQuantity(line.accepted_base)} base units`)
                      .join(' · ')}
              </span>
            ) : null}
          </div>
          {currencyMismatch ? (
            <p className="mt-2 text-xs text-amber-800">
              This bill is in a different currency from the purchase order behind the receipt. The server refuses that match rather than inventing a
              rate.
            </p>
          ) : null}
          {mutation.isError ? (
            <div className="mt-3">
              <FailureBanner failure={describeConstructionFailure(mutation.error)} />
            </div>
          ) : null}
          <p className="mt-3 text-xs text-gray-500">
            The first accepted receipt line is used when you submit. Use the Receipts screen to see per-line allocations, and re-open this form to
            allocate additional bill lines to other receipt lines.
          </p>
        </div>
      </form>

      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Products on the receipt</h4>
        {acceptedLines.length === 0 ? (
          <EmptyState title="No accepted receipt line selected" detail="Choose a receipt above to see its accepted lines." />
        ) : (
          <ul className="space-y-1 text-xs text-gray-700">
            {acceptedLines.map((line) => (
              <li key={line.id}>
                Line {line.line_number} · {productsById.get(line.product_id)?.name ?? line.product_id} · accepted{' '}
                {formatQuantity(line.accepted_base)} base units
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Recent matches in this business</h4>
        <RecentMatches businessId={businessId} />
      </div>
    </SectionCard>
  );
}

function RecentMatches({ businessId }: { businessId: string }) {
  const allocationsQuery = useQuery({
    queryKey: ['construction', 'allocations', businessId],
    queryFn: () => repos.construction.findAllocationsForBusiness(businessId),
  });

  if (allocationsQuery.isLoading) return <LoadingBlock label="Loading matches…" />;
  if (allocationsQuery.isError) return <ErrorBanner message="Recent matches could not be loaded." />;
  const rows = (allocationsQuery.data ?? []).slice(0, 10);
  if (rows.length === 0) return <EmptyState title="No bill line has been matched yet" />;

  return (
    <ul className="space-y-1 text-xs text-gray-700">
      {rows.map((row) => (
        <li key={row.id}>
          {formatQuantity(row.bill_quantity, row.bill_uom)} matched to {formatQuantity(row.receipt_quantity, row.receipt_uom)} on{' '}
          {formatDate(row.matched_at)}
          {row.is_exception ? ' · authorized exception' : ''}
        </li>
      ))}
    </ul>
  );
}
