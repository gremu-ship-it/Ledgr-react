import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
        `Issued ${formatQuantity(String(result.quantity_base ?? ''))} base units at ${formatMoney(
          String(result.unit_cost_base ?? ''),
          String(result.currency ?? ''),
        )} per base unit (project ${String(result.project_ref ?? '')}). One outbound stock movement; no journal entry.`,
      );
    },
  });

  if (dataQuery.isLoading) return <LoadingBlock label="Loading sites, products and stock…" />;
  if (dataQuery.isError) {
    return (
      <ErrorBanner
        message={`Material issues could not be loaded: ${dataQuery.error instanceof Error ? dataQuery.error.message : 'unknown error'}`}
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
        title="Issue material to a construction site"
        description="Consumption is valued by the server at the pool weighted-average cost. You supply the site, the product, the unit and the quantity — never the cost."
      >
        <InfoNote>
          <p>
            An issue is gated on the same approved policy as receipt posting. It writes one outbound stock movement and <strong>no journal
            entry</strong>: the project-cost debit has no approved account mapping, so only the inventory side is recorded.
          </p>
          {!postingEnabled ? (
            <p>Movement posting is disabled for this business, so the database will refuse this issue even when the form is complete.</p>
          ) : null}
        </InfoNote>

        <form
          className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="Construction site" required hint="The site fixes the branch, inventory location and project reference.">
            <select
              aria-label="Construction site"
              value={siteId}
              onChange={(event) => {
                setSiteId(event.target.value);
                setProductId('');
              }}
              className={FIELD_CLASS}
            >
              <option value="">Select a site…</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.site_code} — {site.site_name} ({site.project_ref})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Product" required>
            <select aria-label="Product" value={productId} onChange={(event) => setProductId(event.target.value)} className={FIELD_CLASS} disabled={!siteId}>
              <option value="">Select a product…</option>
              {products.map((product) => {
                const balance = balanceRows.find((row) => row.product_id === product.id);
                return (
                  <option key={product.id} value={product.id}>
                    {product.name}
                    {balance ? ` — on hand ${formatQuantity(balance.quantity_on_hand)}` : ''}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field
            label="Unit"
            required
            hint={productId ? `Base unit: ${String(productsById.get(productId)?.unit_of_measure ?? 'not set')}` : 'Select a product first.'}
          >
            <input aria-label="Issue unit" value={uom} onChange={(event) => setUom(event.target.value.toUpperCase())} className={FIELD_CLASS} />
          </Field>
          <Field label="Quantity" required>
            <input aria-label="Issue quantity" type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Issue date" required>
            <input aria-label="Issue date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Issued to" hint="For example the crew or the works supervisor.">
            <input aria-label="Issued to" value={issuedTo} onChange={(event) => setIssuedTo(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Evidence reference" required hint="The signed site requisition or issue note.">
            <input aria-label="Evidence reference" value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
          </Field>

          <div className="sm:col-span-3">
            {selectedBalance ? (
              <p className="mb-2 text-xs text-gray-600">
                Available at {selectedSite?.site_code}: <strong>{formatQuantity(selectedBalance.quantity_on_hand)}</strong> base units · pool
                weighted-average cost <strong>{String(selectedBalance.average_cost)}</strong>. The issue is valued at that cost and cannot exceed the
                available quantity.
              </p>
            ) : productId ? (
              <p className="mb-2 text-xs text-amber-800">No stock balance exists yet for this product at that site store.</p>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
              <GatedButton
                allowed={gate.allowed && canSubmit}
                reason={gate.allowed ? 'A site, a product, a unit, a quantity and an evidence reference are required.' : gate.reason}
                disabled={mutation.isPending}
                type="submit"
              >
                <>
                  <PackageMinus className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Recording…' : 'Record material issue'}
                </>
              </GatedButton>
              {!postingEnabled ? (
                <StatusPill label="Movement posting disabled for this business" className="bg-slate-100 text-slate-700" />
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
        title="Project material cost"
        description="Derived by the server from the append-only issue register, grouped by project reference. There is no stored project-cost balance."
      >
        {projectCost.length === 0 ? (
          <EmptyState title="No material issued yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Project reference</th>
                  <th className="px-2 py-2 text-right">Issues</th>
                  <th className="px-2 py-2 text-right">Base quantity</th>
                  <th className="px-2 py-2 text-right">Material cost</th>
                  <th className="px-2 py-2">First issue</th>
                  <th className="px-2 py-2">Last issue</th>
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

      <SectionCard title="Issued material" description="Append-only history of every issue, with the cost the server applied.">
        {issues.length === 0 ? (
          <EmptyState title="No issues recorded" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Project</th>
                  <th className="px-2 py-2">Product</th>
                  <th className="px-2 py-2 text-right">Quantity</th>
                  <th className="px-2 py-2 text-right">Unit cost</th>
                  <th className="px-2 py-2 text-right">Total</th>
                  <th className="px-2 py-2">Issued to</th>
                  <th className="px-2 py-2">Evidence</th>
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

      <SectionCard title="Site store balances" description="Read from the shared inventory balance table — the same table the stock commands maintain.">
        {sites.length === 0 ? (
          <EmptyState title="No sites registered" />
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
                    <span className="ml-2 text-xs text-gray-500">no stock on hand</span>
                  ) : (
                    <ul className="mt-1 space-y-0.5 text-xs text-gray-600">
                      {held.map((row) => (
                        <li key={row.id}>
                          {productsById.get(row.product_id)?.name ?? row.product_id}: {formatQuantity(row.quantity_on_hand)} on hand · average cost{' '}
                          {String(row.average_cost)}
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
