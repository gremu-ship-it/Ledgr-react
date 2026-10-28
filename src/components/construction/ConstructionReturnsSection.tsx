import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  { value: 'usable', labelKey: 'construction.procurement.materialReturns.conditionUsable' },
  { value: 'usable_with_restriction', labelKey: 'construction.procurement.materialReturns.conditionWithRestriction' },
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
  const { t } = useTranslation();
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
        t('construction.procurement.materialReturns.successNotice', {
          quantity: formatQuantity(String(result.quantity_base ?? '')),
          cost: formatMoney(String(result.unit_cost_base ?? ''), String(result.currency ?? '')),
          project: String(result.project_ref ?? ''),
        }),
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

  if (dataQuery.isLoading) return <LoadingBlock label={t('construction.procurement.materialReturns.loading')} />;
  if (dataQuery.isError) {
    return (
      <ErrorBanner
        message={t('construction.procurement.materialReturns.loadError', {
          detail: dataQuery.error instanceof Error ? dataQuery.error.message : t('construction.procurement.shared.unknownError'),
        })}
      />
    );
  }

  return (
    <div className="space-y-6">
      {notice ? <SuccessBanner message={notice} /> : null}

      <SectionCard
        title={t('construction.procurement.materialReturns.returnTitle')}
        description={t('construction.procurement.materialReturns.returnDescription')}
      >
        <InfoNote>
          <p>
            {t('construction.procurement.materialReturns.noteP1Before')}<strong>{t('construction.procurement.materialReturns.noteP1Strong')}</strong>{t('construction.procurement.materialReturns.noteP1After')}
          </p>
          <p>
            {t('construction.procurement.materialReturns.noteP2Before')}<strong>{t('construction.procurement.materialReturns.noteP2Strong')}</strong>{t('construction.procurement.materialReturns.noteP2After')}
          </p>
          <p>
            {t('construction.procurement.materialReturns.noteP3')}
          </p>
        </InfoNote>

        {eligibleIssues.length === 0 ? (
          <EmptyState
            title={t('construction.procurement.materialReturns.noneReturnableTitle')}
            detail={t('construction.procurement.materialReturns.noneReturnableDetail')}
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
              label={t('construction.procurement.materialReturns.sourceIssueLabel')}
              required
              hint={t('construction.procurement.materialReturns.sourceIssueHint')}
            >
              <select
                aria-label={t('construction.procurement.materialReturns.sourceIssueLabel')}
                value={sourceIssueId}
                onChange={(event) => setSourceIssueId(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="">{t('construction.procurement.materialReturns.selectIssue')}</option>
                {eligibleIssues.map((issue) => {
                  const product = productsById.get(issue.product_id);
                  const outstanding = toNumber(issue.quantity_base) - (returnedByIssue.get(issue.id) ?? 0);
                  return (
                    <option key={issue.id} value={issue.id}>
                      {t('construction.procurement.materialReturns.issueOption', {
                        project: issue.project_ref,
                        product: product?.name ?? issue.product_id,
                        outstanding: formatQuantity(outstanding),
                        issued: formatQuantity(toNumber(issue.quantity_base)),
                        date: formatDate(issue.issue_date),
                      })}
                    </option>
                  );
                })}
              </select>
            </Field>

            <Field
              label={t('construction.procurement.materialReturns.quantityLabel')}
              required
              hint={
                selectedIssue
                  ? t('construction.procurement.materialReturns.quantityHint', { uom: selectedIssue.uom })
                  : t('construction.procurement.materialReturns.chooseIssueFirst')
              }
            >
              <input
                aria-label={t('construction.procurement.materialReturns.quantityLabel')}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                inputMode="decimal"
                className={FIELD_CLASS}
                disabled={!selectedIssue}
              />
            </Field>

            <Field label={t('construction.procurement.materialReturns.returnDateLabel')} required hint={t('construction.procurement.materialReturns.returnDateHint')}>
              <input
                aria-label={t('construction.procurement.materialReturns.returnDateLabel')}
                type="date"
                value={returnDate}
                onChange={(event) => setReturnDate(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <Field label={t('construction.procurement.materialReturns.conditionLabel')} required>
              <select
                aria-label={t('construction.procurement.materialReturns.conditionLabel')}
                value={condition}
                onChange={(event) => setCondition(event.target.value)}
                className={FIELD_CLASS}
              >
                {CONDITIONS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {t(entry.labelKey)}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('construction.procurement.materialReturns.receivedByLabel')} hint={t('construction.procurement.materialReturns.receivedByHint')}>
              <input
                aria-label={t('construction.procurement.materialReturns.receivedByLabel')}
                value={receivedBy}
                onChange={(event) => setReceivedBy(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <Field label={t('construction.procurement.materialReturns.evidenceLabel')} required hint={t('construction.procurement.materialReturns.evidenceHint')}>
              <input
                aria-label={t('construction.procurement.materialReturns.evidenceLabel')}
                value={evidence}
                onChange={(event) => setEvidence(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <Field label={t('construction.procurement.materialReturns.reasonLabel')} required hint={t('construction.procurement.materialReturns.reasonHint')}>
              <input
                aria-label={t('construction.procurement.materialReturns.reasonLabel')}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className={FIELD_CLASS}
              />
            </Field>

            <div className="sm:col-span-3 space-y-3">
              {selectedIssue ? (
                <p className="text-sm text-slate-600">
                  {t('construction.procurement.materialReturns.summaryReturning')}<strong>{formatQuantity(toNumber(quantity) || 0, selectedIssue.uom)}</strong>{t('construction.procurement.materialReturns.summaryEquals')}<strong>{formatQuantity(requestedBase)}{t('construction.procurement.materialReturns.summaryBaseUnits')}</strong>{t('construction.procurement.materialReturns.summaryAt')}<strong>{formatMoney(toNumber(selectedIssue.unit_cost_base), selectedIssue.currency)}</strong>{t('construction.procurement.materialReturns.summaryPerUnit')}<strong>{formatMoney(requestedBase * toNumber(selectedIssue.unit_cost_base), selectedIssue.currency)}</strong>{t('construction.procurement.materialReturns.summaryTail', { project: selectedIssue.project_ref, remaining: formatQuantity(selectedRemaining) })}
                </p>
              ) : null}
              {exceedsRemaining ? (
                <ErrorBanner message={t('construction.procurement.materialReturns.exceedsError')} />
              ) : null}
              {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}
              <GatedButton
                allowed={gate.allowed && canSubmit && !exceedsRemaining}
                reason={
                  gate.allowed
                    ? t('construction.procurement.materialReturns.requiredReason')
                    : gate.reason
                }
                disabled={mutation.isPending}
                type="submit"
              >
                <>
                  <PackagePlus className="h-4 w-4" aria-hidden /> {mutation.isPending ? t('construction.procurement.materialReturns.recording') : t('construction.procurement.materialReturns.recordReturn')}
                </>
              </GatedButton>
            </div>
          </form>
        )}
      </SectionCard>

      <SectionCard
        title={t('construction.procurement.materialReturns.registerTitle')}
        description={t('construction.procurement.materialReturns.registerDescription')}
      >
        {(returns ?? []).length === 0 ? (
          <EmptyState title={t('construction.procurement.materialReturns.noReturnsTitle')} detail={t('construction.procurement.materialReturns.noReturnsDetail')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thDate')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thProject')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thProduct')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thQuantity')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thBaseQuantity')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thUnitCost')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thValue')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thCondition')}</th>
                  <th className="py-2 pr-4">{t('construction.procurement.materialReturns.thEvidence')}</th>
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
                          label={row.condition === 'usable' ? t('construction.procurement.materialReturns.conditionUsable') : t('construction.procurement.materialReturns.conditionWithRestriction')}
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
