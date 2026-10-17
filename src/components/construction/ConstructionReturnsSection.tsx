import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PackagePlus } from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  CONSTRUCTION_CAPABILITY_LABELS,
  type ConstructionMaterialIssue,
} from '@/dal/repositories/ConstructionProcurementRepository';
import { describeConstructionFailure } from '@/lib/construction/constructionCommandFeedback';
import {
  formatDate,
  formatMoney,
  formatQuantity,
  gateForCapability,
  newIdempotencyKey,
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
 * Usable-material returns: material going back to the store it was issued from.
 *
 * The operator chooses the ORIGINAL ISSUE and enters a quantity in that issue's own
 * unit. Everything else — site, branch, store location, project, product, unit cost
 * and the base quantity — is derived by the server from the issue itself, and the
 * server refuses a request that tries to supply any of them.
 *
 * The return is valued at the issue's recorded unit cost, so the project's derived
 * material cost falls by exactly what it was charged, while the store's
 * weighted-average pool re-prices as the material re-enters stock. No journal entry
 * is written: general-ledger posting remains unapproved.
 *
 * What this section deliberately does NOT offer: wastage, damage, write-downs,
 * supplier returns or cross-site returns. Those are outside Phase 1 by decision.
 */

const CONDITIONS = [
  { value: 'usable', label: 'Usable' },
  { value: 'usable_with_restriction', label: 'Usable with restriction' },
] as const;

export function ConstructionReturnsSection({
  businessId,
  capabilities,
  projectId,
}: {
  businessId: string;
  capabilities: string[];
  projectId?: string;
}) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [sourceIssueId, setSourceIssueId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [condition, setCondition] = useState<string>('usable');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [receivedBy, setReceivedBy] = useState('');
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const dataQuery = useQuery({
    queryKey: ['construction', 'material-returns', businessId, ...(projectId ? [projectId] : [])],
    queryFn: async () => {
      const [issues, returns, productRows] = await Promise.all([
        projectId ? repos.construction.findMaterialIssues(businessId, projectId) : repos.construction.findMaterialIssues(businessId),
        projectId ? repos.construction.findMaterialReturns(businessId, projectId) : repos.construction.findMaterialReturns(businessId),
        repos.inventory.findAllProducts(businessId),
      ]);
      return { issues, returns, products: productRows };
    },
  });

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.materialReturn,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.materialReturn],
  );

  const mutation = useMutation({
    mutationFn: () =>
      repos.construction.returnMaterialsToStore(
        {
          business_id: businessId,
          source_issue_id: sourceIssueId,
          quantity,
          return_date: returnDate,
          condition: condition === 'usable_with_restriction' ? 'usable_with_restriction' : 'usable',
          reason: reason.trim(),
          evidence_reference: evidence.trim(),
          received_by: receivedBy.trim() || null,
        },
        clientKey,
        ...(projectId ? [projectId] as [string] : []),
      ),
    onSuccess: (result) => {
      setClientKey(newIdempotencyKey());
      setQuantity('');
      setReason('');
      setEvidence('');
      setReceivedBy('');
      queryClient.invalidateQueries({ queryKey: ['construction'] });
      setNotice(
        `Returned ${formatQuantity(String(result.quantity_base ?? ''))} base units at ${formatMoney(
          String(result.unit_cost_base ?? ''),
          String(result.currency ?? ''),
        )} per base unit (project ${String(result.project_ref ?? '')}). One inbound stock movement at the original issue cost; the project's net material cost falls by the same amount. No journal entry.`,
      );
    },
  });

  const { issues, returns, products } = dataQuery.data ?? { issues: [], returns: [], products: [] };
  const productsById = useMemo(
    () => new Map((products ?? []).map((product) => [product.id, product])),
    [products],
  );

  /**
   * Returnable quantity per issue: what was issued less what the register has
   * already taken back. This is display arithmetic for the operator; the server
   * re-checks the same bound under a row lock and is the authority.
   */
  const returnedByIssue = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of returns ?? []) {
      totals.set(row.source_issue_id, (totals.get(row.source_issue_id) ?? 0) + toNumber(row.quantity_base));
    }
    return totals;
  }, [returns]);

  const eligibleIssues = useMemo(
    () =>
      (issues ?? []).filter(
        (issue: ConstructionMaterialIssue) =>
          toNumber(issue.quantity_base) - (returnedByIssue.get(issue.id) ?? 0) > 0.000001,
      ),
    [issues, returnedByIssue],
  );

  const selectedIssue = eligibleIssues.find((issue) => issue.id === sourceIssueId) ?? null;
  const selectedRemaining = selectedIssue
    ? toNumber(selectedIssue.quantity_base) - (returnedByIssue.get(selectedIssue.id) ?? 0)
    : 0;
  const selectedRatio = selectedIssue ? toNumber(selectedIssue.quantity_base) / toNumber(selectedIssue.quantity) : 0;
  const requestedBase = toNumber(quantity) * (selectedRatio || 0);
  const exceedsRemaining = selectedIssue !== null && requestedBase > selectedRemaining + 0.000001;
  const canSubmit = Boolean(sourceIssueId && toNumber(quantity) > 0 && returnDate && reason.trim() && evidence.trim());

  if (dataQuery.isLoading) return <LoadingBlock label="Loading material issues and returns…" />;
  if (dataQuery.isError) {
    return (
      <ErrorBanner
        message={`Material returns could not be loaded: ${dataQuery.error instanceof Error ? dataQuery.error.message : 'unknown error'}`}
      />
    );
  }

  return (
    <div className="space-y-6">
      {notice ? <SuccessBanner message={notice} /> : null}

      <SectionCard
        title="Return usable material to the store"
        description="Choose the original material issue and the quantity coming back. The server takes the site, store, project, unit cost and base quantity from that issue."
      >
        <InfoNote>
          <p>
            A return is recorded at the <strong>original issue&rsquo;s recorded unit cost</strong>, so the project&rsquo;s net material cost
            falls by exactly what it was charged. The material re-enters the store&rsquo;s weighted-average pool, which re-prices that pool —
            including for later issues to other projects.
          </p>
          <p>
            One inbound stock movement and <strong>no journal entry</strong>: general-ledger posting is not approved. Returns cannot exceed
            what the issue still has outstanding, and the unit of measure is always the issue&rsquo;s own.
          </p>
          <p>
            Wastage, damage, write-downs and cross-site returns are deliberately not available here — they are outside the approved Phase 1
            scope.
          </p>
        </InfoNote>

        {eligibleIssues.length === 0 ? (
          <EmptyState
            title="No material is currently returnable"
            detail="Every recorded issue has already been returned in full, or no material has been issued to a construction site yet."
          />
        ) : (
          <form
            className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <Field
              label="Original material issue"
              required
              hint="Only issues with quantity still outstanding are listed. The issue fixes the branch, store, project and cost."
            >
              <select
                aria-label="Original material issue"
                value={sourceIssueId}
                onChange={(event) => setSourceIssueId(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">Select an issue…</option>
                {eligibleIssues.map((issue) => {
                  const product = productsById.get(issue.product_id);
                  const outstanding = toNumber(issue.quantity_base) - (returnedByIssue.get(issue.id) ?? 0);
                  return (
                    <option key={issue.id} value={issue.id}>
                      {issue.project_ref} — {product?.name ?? issue.product_id} — {formatQuantity(outstanding)} of{' '}
                      {formatQuantity(toNumber(issue.quantity_base))} base units outstanding ({formatDate(issue.issue_date)})
                    </option>
                  );
                })}
              </select>
            </Field>

            <Field
              label="Quantity returned"
              required
              hint={selectedIssue ? `In ${selectedIssue.uom} (the unit the material was issued in).` : 'Choose an issue first.'}
            >
              <input
                aria-label="Quantity returned"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="decimal"
                className={FIELD_CLASS}
                disabled={!selectedIssue}
              />
            </Field>

            <Field label="Return date" required hint="Cannot be earlier than the issue date, and must fall in an open period.">
              <input
                aria-label="Return date"
                type="date"
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <Field label="Material condition" required>
              <select
                aria-label="Material condition"
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                className={FIELD_CLASS}
              >
                {CONDITIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Received by" hint="The person who took the material back into the store.">
              <input
                aria-label="Received by"
                value={receivedBy}
                onChange={(event) => setReceivedBy(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <Field label="Evidence reference" required hint="The document that authorises the return (site note, requisition, sign-off).">
              <input
                aria-label="Evidence reference"
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <Field label="Reason" required hint="Why the material is coming back, e.g. surplus to the pour.">
              <input
                aria-label="Reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <div className="sm:col-span-3 space-y-3">
              {selectedIssue ? (
                <p className="text-sm text-slate-600">
                  Returning <strong>{formatQuantity(toNumber(quantity) || 0, selectedIssue.uom)}</strong> ={' '}
                  <strong>{formatQuantity(requestedBase)} base units</strong> at{' '}
                  <strong>{formatMoney(toNumber(selectedIssue.unit_cost_base), selectedIssue.currency)}</strong> per base unit ={' '}
                  <strong>{formatMoney(requestedBase * toNumber(selectedIssue.unit_cost_base), selectedIssue.currency)}</strong> relieved from
                  project {selectedIssue.project_ref}. {formatQuantity(selectedRemaining)} base units remain returnable on this issue.
                </p>
              ) : null}
              {exceedsRemaining ? (
                <ErrorBanner message="That quantity is more than the issue still has outstanding. Reduce it, or choose another issue." />
              ) : null}
              {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}
              <GatedButton
                allowed={gate.allowed && canSubmit && !exceedsRemaining}
                reason={
                  gate.allowed
                    ? 'An original issue, a positive quantity, a return date, a reason and an evidence reference are required.'
                    : gate.reason
                }
                disabled={mutation.isPending}
                type="submit"
              >
                <>
                  <PackagePlus className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Recording…' : 'Record return'}
                </>
              </GatedButton>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard
        title="Returns register"
        description="Append-only. A posted return is never edited or deleted; a mistake is corrected by a new opposite record."
      >
        {(returns ?? []).length === 0 ? (
          <EmptyState title="No returns recorded yet" detail="Returns appear here as soon as one is posted." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">Date</th>
                  <th className="py-2 pr-4">Project</th>
                  <th className="py-2 pr-4">Product</th>
                  <th className="py-2 pr-4">Quantity</th>
                  <th className="py-2 pr-4">Base quantity</th>
                  <th className="py-2 pr-4">Unit cost</th>
                  <th className="py-2 pr-4">Value</th>
                  <th className="py-2 pr-4">Condition</th>
                  <th className="py-2 pr-4">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {(returns ?? []).map((row) => {
                  const product = productsById.get(row.product_id);
                  return (
                    <tr key={row.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4">{formatDate(row.return_date)}</td>
                      <td className="py-2 pr-4">{row.project_ref}</td>
                      <td className="py-2 pr-4">{product?.name ?? row.product_id}</td>
                      <td className="py-2 pr-4">
                        {formatQuantity(row.quantity, row.uom)}
                      </td>
                      <td className="py-2 pr-4">{formatQuantity(row.quantity_base)}</td>
                      <td className="py-2 pr-4">{formatMoney(row.unit_cost_base, row.currency)}</td>
                      <td className="py-2 pr-4">{formatMoney(row.total_cost_base, row.currency)}</td>
                      <td className="py-2 pr-4">
                        <StatusPill
                          label={row.condition === 'usable' ? 'Usable' : 'Usable with restriction'}
                          className="bg-emerald-50 text-emerald-700"
                        />
                      </td>
                      <td className="py-2 pr-4">{row.evidence_reference}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
