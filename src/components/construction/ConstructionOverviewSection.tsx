import { useQuery } from '@tanstack/react-query';
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

  if (overviewQuery.isLoading) return <LoadingBlock label="Loading the construction overview…" />;
  if (overviewQuery.isError) {
    return (
      <ErrorBanner
        message={`The construction overview could not be loaded: ${
          overviewQuery.error instanceof Error ? overviewQuery.error.message : 'unknown error'
        }`}
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
          label="Open holds"
          value={String(numbers.holdsOpen)}
          detail={
            numbers.holdsOpen > 0
              ? `${formatQuantity(numbers.heldQuantityBase)} base units held · oldest ${numbers.oldestHoldDays} day(s)`
              : 'No rejected, quarantined or disputed quantity is held.'
          }
          tone={numbers.holdsOpen > 0 ? 'attention' : 'default'}
        />
        <Metric
          label="Accepted, awaiting cost basis"
          value={String(numbers.acceptedAwaitingCostBasisLines)}
          detail="Receipt lines whose accepted quantity has no evidenced cost basis yet. Posting is refused for these."
          tone={numbers.acceptedAwaitingCostBasisLines > 0 ? 'attention' : 'default'}
        />
        <Metric
          label="Accepted, not yet in stock"
          value={String(numbers.acceptedAwaitingPostingLines)}
          detail={`${formatQuantity(numbers.acceptedAwaitingPostingBase)} base units outstanding across all receipts.`}
        />
        <Metric
          label="Outstanding supplier claims"
          value={formatQuantity(numbers.outstandingClaimsBase)}
          detail="Rejected, quarantined and disputed quantities the supplier still has to settle."
        />
      </div>

      <SectionCard
        title="Receipt posting policy"
        description="The only switch that allows a goods receipt to move stock. It is off unless an approver has recorded it, and general-ledger posting is structurally disabled."
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill
            label={postingEnabled ? 'Movement posting enabled' : 'Movement posting disabled'}
            className={postingEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}
          />
          <StatusPill label="GL posting: not approved" className="bg-slate-100 text-slate-700" />
          <span className="text-xs text-gray-500">
            {policy
              ? `Recorded ${formatDate(policy.approved_at ?? policy.updated_at)}${policy.cost_basis_source ? ` · cost basis source: ${policy.cost_basis_source}` : ''}`
              : 'No policy row exists for this business.'}
          </span>
        </div>
        {policy?.approved_reason ? (
          <p className="mt-2 text-xs text-gray-600">Approved reason: {policy.approved_reason}</p>
        ) : null}
        {!postingEnabled ? (
          <div className="mt-3">
            <InfoNote>
              <p>
                Receipts can be recorded, inspected and costed while posting is disabled. Their stock movements are refused by the
                database until an approver holding “{capabilities.length > 0 ? 'Approve the receipt posting policy' : 'Approve the receipt posting policy'}”
                records the policy.
              </p>
            </InfoNote>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Project and site references"
        description="Sites are registered with an explicit site code, project reference, branch and inventory location. Consumption is always booked against this reference."
      >
        {sites.length === 0 ? (
          <EmptyState
            title="No construction sites registered yet"
            detail="Register a site (setup screen) before raising purchase orders or issuing material."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Site</th>
                  <th className="px-2 py-2">Project reference</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Material issued</th>
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
                          label={site.is_active ? 'Active' : 'Inactive'}
                          className={site.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}
                        />
                      </td>
                      <td className="px-2 py-2 text-gray-700">
                        {cost
                          ? `${formatMoney(cost.material_cost, cost.currency)} · ${formatQuantity(cost.quantity_base)} base units in ${cost.issue_count} issue(s)`
                          : 'No issue recorded'}
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
        <SectionCard title="Purchase orders by status" description="Procurement documents only — a purchase order authorizes ordering, never stock.">
          {purchaseOrders.length === 0 ? (
            <EmptyState title="No purchase orders yet" detail="Create one from the Purchase orders screen." />
          ) : (
            <div className="flex flex-wrap gap-3">
              {(['draft', 'authorized', 'cancelled'] as const).map((status) => (
                <div key={status} className="rounded-lg border border-gray-200 px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-gray-500">{status}</p>
                  <p className="text-lg font-semibold text-gray-900">{poCounts[status] ?? 0}</p>
                </div>
              ))}
              <Link to="/construction/purchase-orders" className="self-center text-sm font-medium text-brand-700 hover:underline">
                Open purchase orders →
              </Link>
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Receipts awaiting inspection or acceptance"
          description="Held quantities are outside inventory until an inspection passes; only accepted quantities are eligible for stock."
        >
          {openItems.open_holds.length === 0 ? (
            <EmptyState title="Nothing is held" detail="No rejected, quarantined or disputed quantity is waiting on a decision." />
          ) : (
            <ul className="space-y-2">
              {openItems.open_holds.map((hold, index) => (
                <li key={`${hold.hold_type}-${index}`} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={hold.hold_type} className="bg-amber-100 text-amber-800" />
                    <span className="font-medium text-gray-900">{formatQuantity(hold.quantity_base)} base units</span>
                    <span className="text-xs text-gray-600">{hold.age_days} day(s) old</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-700">{hold.reason}</p>
                  <p className="text-[11px] text-gray-500">Evidence: {hold.evidence_reference}</p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard
          title="Accepted quantities awaiting a cost basis"
          description="Until an evidenced cost basis exists for every accepted unit, the receipt cannot be posted."
          actions={
            <Link to="/construction/receipts" className="text-sm font-medium text-brand-700 hover:underline">
              Review receipts →
            </Link>
          }
        >
          {openItems.awaiting_cost_basis.length === 0 ? (
            <EmptyState title="Nothing outstanding" detail="Every accepted quantity already has an evidenced cost basis." />
          ) : (
            <ul className="space-y-2">
              {openItems.awaiting_cost_basis.map((row) => (
                <li key={`${row.grn_number}-${row.line_number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-700">
                    {row.grn_number} · line {row.line_number}
                  </span>
                  <span className="text-gray-700">
                    {formatQuantity(row.covered_base)} of {formatQuantity(row.accepted_base)} base units costed
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Accepted quantities not yet in stock"
          description={
            postingEnabled
              ? 'Posting is enabled for this business; these receipts will move stock once their cost basis is complete.'
              : 'Posting is disabled for this business, so these receipts stay out of stock even when fully costed.'
          }
        >
          {openItems.awaiting_posting.length === 0 ? (
            <EmptyState title="Nothing outstanding" detail="Every accepted quantity has reached stock." />
          ) : (
            <ul className="space-y-2">
              {openItems.awaiting_posting.map((row) => (
                <li key={`${row.grn_number}-${row.line_number}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-gray-700">
                    {row.grn_number} · line {row.line_number}
                  </span>
                  <span className="text-gray-700">
                    {formatQuantity(Number(row.accepted_base) - Number(row.quantity_posted_base))} base units outstanding
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard
        title="Outstanding supplier claims"
        description="Rejected material never entered inventory, and quarantined or disputed material is not yet the entity's. Both are listed here for period close."
      >
        {openItems.outstanding_supplier_claims.length === 0 ? (
          <EmptyState title="No outstanding claims" detail="No rejected, quarantined or disputed quantity is open with a supplier." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Supplier</th>
                  <th className="px-2 py-2">Receipt date</th>
                  <th className="px-2 py-2">Age</th>
                  <th className="px-2 py-2 text-right">Rejected</th>
                  <th className="px-2 py-2 text-right">Quarantined</th>
                  <th className="px-2 py-2 text-right">Disputed</th>
                  <th className="px-2 py-2 text-right">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {openItems.outstanding_supplier_claims.map((claim, index) => (
                  <tr key={`${claim.supplier}-${claim.receipt_date}-${index}`} className="border-t border-gray-100">
                    <td className="px-2 py-2 text-gray-900">{claim.supplier}</td>
                    <td className="px-2 py-2 text-gray-700">{formatDate(claim.receipt_date)}</td>
                    <td className="px-2 py-2 text-gray-700">{claim.age_days} day(s)</td>
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
          title="Bills blocked from receipt matching"
          description="These bills already moved stock through the ordinary purchase path, so the construction matcher refuses them: one bill must not create two receipts."
        >
          <ul className="space-y-2">
            {openItems.blocked_bills.map((bill) => (
              <li key={bill.expense_number} className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm">
                <span className="font-mono text-xs text-gray-700">{bill.expense_number}</span>
                <span className="ml-2 text-gray-800">{bill.reference ?? 'no supplier reference'}</span>
                <span className="ml-2 text-xs text-gray-600">
                  {bill.legacy_movements} legacy stock movement(s)
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  );
}
