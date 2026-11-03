import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PackageMinus } from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  CONSTRUCTION_CAPABILITY_LABELS,
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
 * Material issues: consumption from a site store to a project reference.
 *
 * The quantity and the site/project reference come from the operator; the COST
 * does not. The server values the issue at the pool weighted-average cost at the
 * moment of issue, writes one outbound stock movement through the shared balance
 * writer, and writes no journal entry. Stock availability is displayed from the
 * inventory balance for information only — the command re-checks it.
 */
export function ConstructionMaterialIssuesSection({
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
  const [siteId, setSiteId] = useState('');
  const [productId, setProductId] = useState('');
  const [uom, setUom] = useState('');
  const [quantity, setQuantity] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [issuedTo, setIssuedTo] = useState('');
  const [evidence, setEvidence] = useState('');
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const dataQuery = useQuery({
    queryKey: ['construction', 'material-issues', businessId, ...(projectId ? [projectId] : [])],
    queryFn: async () => {
      const [sites, products, issues, projectCost, policy] = await Promise.all([
        repos.construction.findSites(businessId),
        repos.inventory.findAllProducts(businessId),
        projectId ? repos.construction.findMaterialIssues(businessId, projectId) : repos.construction.findMaterialIssues(businessId),
        repos.construction.findProjectMaterialCost(businessId),
        repos.construction.findPostingPolicy(businessId),
      ]);
      const balances = await Promise.all(
        sites.map(async (site) => ({ siteId: site.id, rows: await repos.inventory.findBalancesByLocation(businessId, site.location_id) })),
      );
      return { sites, products, issues, projectCost, policy, balances };
    },
  });

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.materialIssue,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.materialIssue],
  );

  const mutation = useMutation({
    mutationFn: () =>
      repos.construction.issueMaterialsToProject(
        {
          business_id: businessId,
          site_id: siteId,
          product_id: productId,
          uom,
          quantity,
          issue_date: issueDate,
          issued_to: issuedTo.trim() || null,
          evidence_reference: evidence.trim(),
        },
        clientKey,
        ...(projectId ? [projectId] as [string] : []),
      ),
    onSuccess: (result) => {
      setClientKey(newIdempotencyKey());
      setQuantity('');
      setEvidence('');
      setIssuedTo('');
      queryClient.invalidateQueries({ queryKey: ['construction'] });
      setNotice(
        t('construction.procurement.materialIssues.successNotice', {
          quantity: formatQuantity(String(result.quantity_base ?? '')),
          cost: formatMoney(String(result.unit_cost_base ?? ''), String(result.currency ?? '')),
          project: String(result.project_ref ?? ''),
        }),
      );
    },
  });

  if (dataQuery.isLoading) return <LoadingBlock label={t('construction.procurement.materialIssues.loading')} />;
  if (dataQuery.isError) {
    return (
      <ErrorBanner
        message={t('construction.procurement.materialIssues.loadError', {
          detail: dataQuery.error instanceof Error ? dataQuery.error.message : t('construction.procurement.shared.unknownError'),
        })}
      />
    );
  }

  const { sites, products, issues, projectCost, policy, balances } = dataQuery.data!;
  const productsById = new Map(products.map((product) => [product.id, product]));
  const selectedSite = sites.find((site) => site.id === siteId) ?? null;
  const balanceRows = selectedSite ? balances.find((entry) => entry.siteId === selectedSite.id)?.rows ?? [] : [];
  const selectedBalance = balanceRows.find((row) => row.product_id === productId) ?? null;
  const postingEnabled = policy?.movement_posting_enabled === true;

  const canSubmit = Boolean(siteId && productId && uom.trim() && quantity && evidence.trim());

  return (
    <div className="space-y-6">
      {notice ? <SuccessBanner message={notice} /> : null}

      <SectionCard
        title={t('construction.procurement.materialIssues.issueTitle')}
        description={t('construction.procurement.materialIssues.issueDescription')}
      >
        <InfoNote>
          <p>
            {t('construction.procurement.materialIssues.policyNoteBefore')}<strong>{t('construction.procurement.materialIssues.policyNoteStrong')}</strong>{t('construction.procurement.materialIssues.policyNoteAfter')}
          </p>
          {!postingEnabled ? (
            <p>{t('construction.procurement.materialIssues.postingDisabledNote')}</p>
          ) : null}
        </InfoNote>

        <form
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t('construction.procurement.materialIssues.siteLabel')} required hint={t('construction.procurement.materialIssues.siteHint')}>
            <select
              aria-label={t('construction.procurement.materialIssues.siteLabel')}
              value={siteId}
              onChange={(event) => {
                setSiteId(event.target.value);
                setProductId('');
              }}
              className={FIELD_CLASS}
            >
              <option value="">{t('construction.procurement.materialIssues.selectSite')}</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {t('construction.procurement.materialIssues.siteOption', { code: site.site_code, name: site.site_name, projectRef: site.project_ref })}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('construction.procurement.materialIssues.productLabel')} required>
            <select aria-label={t('construction.procurement.materialIssues.productLabel')} value={productId} onChange={(event) => setProductId(event.target.value)} className={FIELD_CLASS} disabled={!siteId}>
              <option value="">{t('construction.procurement.materialIssues.selectProduct')}</option>
              {products.map((product) => {
                const balance = balanceRows.find((row) => row.product_id === product.id);
                return (
                  <option key={product.id} value={product.id}>
                    {product.name}
                    {balance ? t('construction.procurement.materialIssues.onHandSuffix', { quantity: formatQuantity(balance.quantity_on_hand) }) : ''}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field
            label={t('construction.procurement.materialIssues.unitLabel')}
            required
            hint={
              productId
                ? t('construction.procurement.materialIssues.baseUnitHint', {
                    unit: String(productsById.get(productId)?.unit_of_measure ?? t('construction.procurement.materialIssues.notSet')),
                  })
                : t('construction.procurement.materialIssues.selectProductFirst')
            }
          >
            <input aria-label={t('construction.procurement.materialIssues.issueUnitAria')} value={uom} onChange={(event) => setUom(event.target.value.toUpperCase())} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.materialIssues.quantityLabel')} required>
            <input aria-label={t('construction.procurement.materialIssues.issueQuantityAria')} type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.materialIssues.issueDateLabel')} required>
            <input aria-label={t('construction.procurement.materialIssues.issueDateLabel')} type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.materialIssues.issuedToLabel')} hint={t('construction.procurement.materialIssues.issuedToHint')}>
            <input aria-label={t('construction.procurement.materialIssues.issuedToLabel')} value={issuedTo} onChange={(event) => setIssuedTo(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label={t('construction.procurement.materialIssues.evidenceLabel')} required hint={t('construction.procurement.materialIssues.evidenceHint')}>
            <input aria-label={t('construction.procurement.materialIssues.evidenceLabel')} value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
          </Field>

          <div className="sm:col-span-3">
            {selectedBalance ? (
              <p className="mb-2 text-xs text-gray-600">
                {t('construction.procurement.materialIssues.availablePrefix', { site: selectedSite?.site_code })}<strong>{formatQuantity(selectedBalance.quantity_on_hand)}</strong>{t('construction.procurement.materialIssues.availableMiddle')}<strong>{String(selectedBalance.average_cost)}</strong>{t('construction.procurement.materialIssues.availableSuffix')}
              </p>
            ) : productId ? (
              <p className="mb-2 text-xs text-amber-800">{t('construction.procurement.materialIssues.noStockBalance')}</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <GatedButton
                allowed={gate.allowed && canSubmit}
                reason={gate.allowed ? t('construction.procurement.materialIssues.requiredReason') : gate.reason}
                disabled={mutation.isPending}
                type="submit"
              >
                <>
                  <PackageMinus className="h-4 w-4" aria-hidden /> {mutation.isPending ? t('construction.procurement.materialIssues.recording') : t('construction.procurement.materialIssues.recordIssue')}
                </>
              </GatedButton>
              {!postingEnabled ? (
                <StatusPill label={t('construction.procurement.materialIssues.postingDisabledPill')} className="bg-slate-100 text-slate-700" />
              ) : null}
            </div>
            {mutation.isError ? (
              <div className="mt-3">
                <FailureBanner failure={describeConstructionFailure(mutation.error)} />
              </div>
            ) : null}
          </div>
        </form>
      </SectionCard>

      {!projectId && <SectionCard
        title={t('construction.procurement.materialIssues.projectCostTitle')}
        description={t('construction.procurement.materialIssues.projectCostDescription')}
      >
        {projectCost.length === 0 ? (
          <EmptyState title={t('construction.procurement.materialIssues.noMaterialIssued')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thProjectReference')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.materialIssues.thIssues')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.materialIssues.thBaseQuantity')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.materialIssues.thMaterialCost')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thFirstIssue')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thLastIssue')}</th>
                </tr>
              </thead>
              <tbody>
                {projectCost.map((row) => (
                  <tr key={row.project_ref} className="border-t border-gray-100">
                    <td className="px-2 py-2 font-mono text-xs text-gray-800">{row.project_ref}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{row.issue_count}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{formatQuantity(row.quantity_base)}</td>
                    <td className="px-2 py-2 text-right font-medium text-gray-900">{formatMoney(row.material_cost, row.currency)}</td>
                    <td className="px-2 py-2 text-gray-700">{formatDate(row.first_issue_date)}</td>
                    <td className="px-2 py-2 text-gray-700">{formatDate(row.last_issue_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>}

      <SectionCard title={t('construction.procurement.materialIssues.issuedTitle')} description={t('construction.procurement.materialIssues.issuedDescription')}>
        {issues.length === 0 ? (
          <EmptyState title={t('construction.procurement.materialIssues.noIssuesRecorded')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thDate')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thProject')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thProduct')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.materialIssues.thQuantity')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.materialIssues.thUnitCost')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.materialIssues.thTotal')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thIssuedTo')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.materialIssues.thEvidence')}</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 text-gray-700">{formatDate(issue.issue_date)}</td>
                    <td className="px-2 py-2 font-mono text-xs text-gray-700">{issue.project_ref}</td>
                    <td className="px-2 py-2 text-gray-900">{productsById.get(issue.product_id)?.name ?? issue.product_id}</td>
                    <td className="px-2 py-2 text-right text-gray-800">{formatQuantity(issue.quantity, issue.uom)}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{formatMoney(issue.unit_cost_base, issue.currency)}</td>
                    <td className="px-2 py-2 text-right font-medium text-gray-900">{formatMoney(issue.total_cost_base, issue.currency)}</td>
                    <td className="px-2 py-2 text-gray-700">{issue.issued_to ?? '—'}</td>
                    <td className="px-2 py-2 text-xs text-gray-500">{issue.evidence_reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title={t('construction.procurement.materialIssues.balancesTitle')} description={t('construction.procurement.materialIssues.balancesDescription')}>
        {sites.length === 0 ? (
          <EmptyState title={t('construction.procurement.materialIssues.noSitesRegistered')} />
        ) : (
          <ul className="space-y-2">
            {sites.map((site) => {
              const rows = balances.find((entry) => entry.siteId === site.id)?.rows ?? [];
              const held = rows.filter((row) => toNumber(row.quantity_on_hand) !== 0);
              return (
                <li key={site.id} className="rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-800">{site.site_code}</span>
                  <span className="ml-2 text-gray-700">{site.site_name}</span>
                  {held.length === 0 ? (
                    <span className="ml-2 text-xs text-gray-500">{t('construction.procurement.materialIssues.noStockOnHand')}</span>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                      {held.map((row) => (
                        <li key={row.id}>
                          {t('construction.procurement.materialIssues.balanceLine', {
                            product: productsById.get(row.product_id)?.name ?? row.product_id,
                            quantity: formatQuantity(row.quantity_on_hand),
                            cost: String(row.average_cost),
                          })}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
