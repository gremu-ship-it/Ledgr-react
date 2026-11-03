import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { repos } from '@/lib/repositories';
import {
  formatDate,
  formatMoney,
  formatQuantity,
  summariseOpenItems,
} from '@/lib/construction/constructionWorkspaceView';
import {
  EmptyState,
  ErrorBanner,
  InfoNote,
  LoadingBlock,
  Metric,
  SectionCard,
  StatusPill,
} from '@/components/construction/constructionUi';

/**
 * Construction overview.
 *
 * Every figure comes from a server read: the open-item command
 * (`construction_procurement_open_items`), the append-only document tables and
 * the project material-cost command. Nothing is estimated in the browser.
 */
export function ConstructionOverviewSection({
  businessId,
  capabilities,
}: {
  businessId: string;
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const overviewQuery = useQuery({
    queryKey: ['construction', 'overview', businessId],
    queryFn: async () => {
      const [openItems, purchaseOrders, sites, projectCost, policy] = await Promise.all([
        repos.construction.findOpenItems(businessId),
        repos.construction.findPurchaseOrders(businessId),
        repos.construction.findSites(businessId),
        repos.construction.findProjectMaterialCost(businessId),
        repos.construction.findPostingPolicy(businessId),
      ]);
      return { openItems, purchaseOrders, sites, projectCost, policy };
    },
  });

  if (overviewQuery.isLoading) return <LoadingBlock label={t('construction.procurement.overview.loading')} />;
  if (overviewQuery.isError) {
    return (
      <ErrorBanner
        message={t('construction.procurement.overview.loadError', {
          detail:
            overviewQuery.error instanceof Error
              ? overviewQuery.error.message
              : t('construction.procurement.shared.unknownError'),
        })}
      />
    );
  }

  const { openItems, purchaseOrders, sites, projectCost, policy } = overviewQuery.data!;
  const numbers = summariseOpenItems(openItems);
  const postingEnabled = openItems.movement_posting_enabled === true;

  const poCounts = purchaseOrders.reduce<Record<string, number>>((acc, po) => {
    acc[po.status] = (acc[po.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label={t('construction.procurement.overview.openHolds')}
          value={String(numbers.holdsOpen)}
          detail={
            numbers.holdsOpen > 0
              ? t('construction.procurement.overview.holdsDetail', {
                  quantity: formatQuantity(numbers.heldQuantityBase),
                  days: numbers.oldestHoldDays,
                })
              : t('construction.procurement.overview.noHoldsDetail')
          }
          tone={numbers.holdsOpen > 0 ? 'attention' : 'default'}
        />
        <Metric
          label={t('construction.procurement.overview.awaitingCostBasisLabel')}
          value={String(numbers.acceptedAwaitingCostBasisLines)}
          detail={t('construction.procurement.overview.awaitingCostBasisDetail')}
          tone={numbers.acceptedAwaitingCostBasisLines > 0 ? 'attention' : 'default'}
        />
        <Metric
          label={t('construction.procurement.overview.awaitingPostingLabel')}
          value={String(numbers.acceptedAwaitingPostingLines)}
          detail={t('construction.procurement.overview.awaitingPostingDetail', {
            quantity: formatQuantity(numbers.acceptedAwaitingPostingBase),
          })}
        />
        <Metric
          label={t('construction.procurement.overview.claimsLabel')}
          value={formatQuantity(numbers.outstandingClaimsBase)}
          detail={t('construction.procurement.overview.claimsDetail')}
        />
      </div>

      <SectionCard
        title={t('construction.procurement.overview.policyTitle')}
        description={t('construction.procurement.overview.policyDescription')}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill
            label={postingEnabled ? t('construction.procurement.overview.movementEnabled') : t('construction.procurement.overview.movementDisabled')}
            className={postingEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}
          />
          <StatusPill label={t('construction.procurement.overview.glNotApproved')} className="bg-slate-100 text-slate-700" />
          <span className="text-xs text-gray-500">
            {policy
              ? `${t('construction.procurement.overview.policyRecorded', { date: formatDate(policy.approved_at ?? policy.updated_at) })}${policy.cost_basis_source ? t('construction.procurement.overview.policyCostBasisSource', { source: policy.cost_basis_source }) : ''}`
              : t('construction.procurement.overview.noPolicyRow')}
          </span>
        </div>
        {policy?.approved_reason ? (
          <p className="mt-2 text-xs text-gray-600">{t('construction.procurement.overview.approvedReason', { reason: policy.approved_reason })}</p>
        ) : null}
        {!postingEnabled ? (
          <div className="mt-3">
            <InfoNote>
              <p>
                {t('construction.procurement.overview.policyDisabledNote', {
                  capability:
                    capabilities.length > 0
                      ? t('construction.procurement.overview.approvePolicyCapability')
                      : t('construction.procurement.overview.approvePolicyCapability'),
                })}
              </p>
            </InfoNote>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title={t('construction.procurement.overview.sitesTitle')}
        description={t('construction.procurement.overview.sitesDescription')}
      >
        {sites.length === 0 ? (
          <EmptyState
            title={t('construction.procurement.overview.noSitesTitle')}
            detail={t('construction.procurement.overview.noSitesDetail')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">{t('construction.procurement.overview.thSite')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.overview.thProjectReference')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.overview.thStatus')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.overview.thMaterialIssued')}</th>
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => {
                  const cost = projectCost.find((row) => row.project_ref === site.project_ref);
                  return (
                    <tr key={site.id} className="border-t border-gray-100">
                      <td className="px-2 py-2">
                        <span className="font-medium text-gray-900">{site.site_code}</span>
                        <span className="ml-2 text-gray-600">{site.site_name}</span>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs text-gray-700">{site.project_ref}</td>
                      <td className="px-2 py-2">
                        <StatusPill
                          label={site.is_active ? t('construction.procurement.overview.statusActive') : t('construction.procurement.overview.statusInactive')}
                          className={site.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}
                        />
                      </td>
                      <td className="px-2 py-2 text-gray-700">
                        {cost
                          ? t('construction.procurement.overview.materialIssuedDetail', {
                              amount: formatMoney(cost.material_cost, cost.currency),
                              quantity: formatQuantity(cost.quantity_base),
                              issues: cost.issue_count,
                            })
                          : t('construction.procurement.overview.noIssueRecorded')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title={t('construction.procurement.overview.poByStatusTitle')} description={t('construction.procurement.overview.poByStatusDescription')}>
          {purchaseOrders.length === 0 ? (
            <EmptyState title={t('construction.procurement.overview.noPosTitle')} detail={t('construction.procurement.overview.noPosDetail')} />
          ) : (
            <div className="flex flex-wrap gap-3">
              {(['draft', 'authorized', 'cancelled'] as const).map((status) => (
                <div key={status} className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{status}</p>
                  <p className="text-lg font-semibold text-gray-900">{poCounts[status] ?? 0}</p>
                </div>
              ))}
              <Link to="/construction/purchase-orders" className="self-center text-sm font-medium text-brand-700 hover:underline">
                {t('construction.procurement.overview.openPurchaseOrders')}
              </Link>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title={t('construction.procurement.overview.holdsTitle')}
          description={t('construction.procurement.overview.holdsDescription')}
        >
          {openItems.open_holds.length === 0 ? (
            <EmptyState title={t('construction.procurement.overview.nothingHeldTitle')} detail={t('construction.procurement.overview.nothingHeldDetail')} />
          ) : (
            <ul className="space-y-2">
              {openItems.open_holds.map((hold, index) => (
                <li key={`${hold.hold_type}-${index}`} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={hold.hold_type} className="bg-amber-100 text-amber-800" />
                    <span className="font-medium text-gray-900">{t('construction.procurement.overview.baseUnits', { quantity: formatQuantity(hold.quantity_base) })}</span>
                    <span className="text-xs text-gray-600">{t('construction.procurement.overview.daysOld', { days: hold.age_days })}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-700">{hold.reason}</p>
                  <p className="text-[11px] text-gray-500">{t('construction.procurement.overview.evidencePrefix', { reference: hold.evidence_reference })}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title={t('construction.procurement.overview.costBasisTitle')}
          description={t('construction.procurement.overview.costBasisDescription')}
          actions={
            <Link to="/construction/receipts" className="text-sm font-medium text-brand-700 hover:underline">
              {t('construction.procurement.overview.reviewReceipts')}
            </Link>
          }
        >
          {openItems.awaiting_cost_basis.length === 0 ? (
            <EmptyState title={t('construction.procurement.overview.nothingOutstandingTitle')} detail={t('construction.procurement.overview.allCostBasedDetail')} />
          ) : (
            <ul className="space-y-2">
              {openItems.awaiting_cost_basis.map((row) => (
                <li key={`${row.grn_number}-${row.line_number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-700">
                    {t('construction.procurement.overview.grnLine', { grn: row.grn_number, line: row.line_number })}
                  </span>
                  <span className="text-gray-700">
                    {t('construction.procurement.overview.costedProgress', {
                      covered: formatQuantity(row.covered_base),
                      accepted: formatQuantity(row.accepted_base),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t('construction.procurement.overview.postingTitle')}
          description={
            postingEnabled
              ? t('construction.procurement.overview.postingDescriptionEnabled')
              : t('construction.procurement.overview.postingDescriptionDisabled')
          }
        >
          {openItems.awaiting_posting.length === 0 ? (
            <EmptyState title={t('construction.procurement.overview.nothingOutstandingTitle')} detail={t('construction.procurement.overview.allPostedDetail')} />
          ) : (
            <ul className="space-y-2">
              {openItems.awaiting_posting.map((row) => (
                <li key={`${row.grn_number}-${row.line_number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-700">
                    {t('construction.procurement.overview.grnLine', { grn: row.grn_number, line: row.line_number })}
                  </span>
                  <span className="text-gray-700">
                    {t('construction.procurement.overview.outstandingBaseUnits', {
                      quantity: formatQuantity(Number(row.accepted_base) - Number(row.quantity_posted_base)),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title={t('construction.procurement.overview.claimsTitle')}
        description={t('construction.procurement.overview.claimsDescription')}
      >
        {openItems.outstanding_supplier_claims.length === 0 ? (
          <EmptyState title={t('construction.procurement.overview.noClaimsTitle')} detail={t('construction.procurement.overview.noClaimsDetail')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">{t('construction.procurement.overview.thSupplier')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.overview.thReceiptDate')}</th>
                  <th className="px-2 py-2">{t('construction.procurement.overview.thAge')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.overview.thRejected')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.overview.thQuarantined')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.overview.thDisputed')}</th>
                  <th className="px-2 py-2 text-right">{t('construction.procurement.overview.thOutstanding')}</th>
                </tr>
              </thead>
              <tbody>
                {openItems.outstanding_supplier_claims.map((claim, index) => (
                  <tr key={`${claim.supplier}-${claim.receipt_date}-${index}`} className="border-t border-gray-100">
                    <td className="px-2 py-2 text-gray-900">{claim.supplier}</td>
                    <td className="px-2 py-2 text-gray-700">{formatDate(claim.receipt_date)}</td>
                    <td className="px-2 py-2 text-gray-700">{t('construction.procurement.overview.days', { days: claim.age_days })}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{formatQuantity(claim.rejected_base)}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{formatQuantity(claim.quarantined_base)}</td>
                    <td className="px-2 py-2 text-right text-gray-700">{formatQuantity(claim.disputed_base)}</td>
                    <td className="px-2 py-2 text-right font-medium text-gray-900">{formatQuantity(claim.outstanding_base)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {numbers.blockedBills > 0 ? (
        <SectionCard
          title={t('construction.procurement.overview.blockedBillsTitle')}
          description={t('construction.procurement.overview.blockedBillsDescription')}
        >
          <ul className="space-y-2">
            {openItems.blocked_bills.map((bill) => (
              <li key={bill.expense_number} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-gray-700">{bill.expense_number}</span>
                <span className="ml-2 text-gray-800">{bill.reference ?? t('construction.procurement.overview.noSupplierReference')}</span>
                <span className="ml-2 text-xs text-gray-600">
                  {t('construction.procurement.overview.legacyMovements', { movements: bill.legacy_movements })}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
