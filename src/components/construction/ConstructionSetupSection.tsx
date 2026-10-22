import { useState } from 'react';
import type { ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MapPin, Pencil, Power, Ruler, ShieldCheck } from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  CONSTRUCTION_CAPABILITY_LABELS,
  type ConstructionProcurementSite,
} from '@/dal/repositories/ConstructionProcurementRepository';
import { describeConstructionFailure } from '@/lib/construction/constructionCommandFeedback';
import { formatDate, gateForCapability } from '@/lib/construction/constructionWorkspaceView';
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
 * Workspace setup: the operational master data a purchase order depends on
 * (sites and explicit unit conversions) and the receipt posting policy.
 *
 * No screen can grant a capability: the database refuses a self-grant, and the
 * capability vocabulary is written against a user id, not a role name. The header
 * of the workspace shows what the signed-in person holds; an approver with
 * `procurement.master.manage` records sites and conversions.
 */
export function ConstructionSetupSection({ businessId, capabilities }: { businessId: string; capabilities: string[] }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<ConstructionProcurementSite | null>(null);
  const [statusSite, setStatusSite] = useState<ConstructionProcurementSite | null>(null);

  const invalidateSetup = () => {
    void queryClient.invalidateQueries({ queryKey: ['construction'] });
  };

  // Site lifecycle mutations (20261108). Both go through the lifecycle RPCs;
  // the server enforces capability, deactivation guards and the append-only
  // bypass. Refusals surface as ConstructionCommandError.
  const updateSiteMutation = useMutation({
    mutationFn: (input: { siteId: string; siteName: string; projectId: string | null; projectRef: string }) =>
      repos.construction.updateSite(input.siteId, {
        siteName: input.siteName,
        projectId: input.projectId,
        projectRef: input.projectRef,
      }),
    onSuccess: () => {
      setEditingSite(null);
      setNotice(t('construction.sites.updated'));
      invalidateSetup();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (input: { siteId: string; active: boolean; reason?: string }) =>
      repos.construction.setSiteStatus(input.siteId, input.active, input.reason),
    onSuccess: (_result, input) => {
      setStatusSite(null);
      setNotice(input.active ? t('construction.sites.reactivated') : t('construction.sites.deactivated'));
      invalidateSetup();
    },
  });

  const dataQuery = useQuery({
    queryKey: ['construction', 'setup', businessId],
    queryFn: async () => {
      const [sites, conversions, branches, locations, products, policy, projectPage] = await Promise.all([
        repos.construction.findSites(businessId),
        repos.construction.findUomConversions(businessId),
        repos.branch.findByBusiness(businessId),
        repos.branch.findLocations(businessId),
        repos.inventory.findAllProducts(businessId),
        repos.construction.findPostingPolicy(businessId),
        repos.projects.list(businessId),
      ]);
      return { sites, conversions, branches, locations, products, policy, projects: projectPage.rows };
    },
  });

  if (dataQuery.isLoading) return <LoadingBlock label="Loading construction master data…" />;
  if (dataQuery.isError) {
    return (
      <ErrorBanner
        message={`Construction master data could not be loaded: ${
          dataQuery.error instanceof Error ? dataQuery.error.message : 'unknown error'
        }`}
      />
    );
  }

  const { sites, conversions, branches, locations, products, policy, projects } = dataQuery.data!;
  const productsById = new Map(products.map((product) => [product.id, product]));
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]));
  const locationsById = new Map(locations.map((location) => [location.id, location]));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['construction'] });
  };

  // One gate for every lifecycle affordance: without procurement.master.manage
  // the action buttons are hidden entirely (not disabled), matching the house
  // GatedButton semantics used by the register forms below.
  const manageGate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.masterManage,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.masterManage],
  );

  const statusFailure = statusMutation.isError ? describeConstructionFailure(statusMutation.error) : null;
  const statusBlocked = statusFailure ? localizeSiteBlock(statusFailure.message, t) : null;

  return (
    <div className="space-y-6">
      {notice ? <SuccessBanner message={notice} /> : null}
      {statusBlocked ? <ErrorBanner message={statusBlocked} /> : null}
      {!statusBlocked && statusFailure ? <FailureBanner failure={statusFailure} /> : null}
      {updateSiteMutation.isError ? <FailureBanner failure={describeConstructionFailure(updateSiteMutation.error)} /> : null}

      <SiteForm
        businessId={businessId}
        capabilities={capabilities}
        branches={branches}
        locations={locations}
        products={products}
        projects={projects}
        onDone={(message) => {
          setNotice(message);
          invalidate();
        }}
      />

      <SectionCard title="Registered sites" description="A site fixes the branch, the inventory location and the project reference every document inherits.">
        {sites.length === 0 ? (
          <EmptyState title="No sites registered" detail="Register the first site above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Site code</th>
                  <th className="px-2 py-2">Name</th>
                  <th className="px-2 py-2">Project reference</th>
                  <th className="px-2 py-2">Branch</th>
                  <th className="px-2 py-2">Inventory location</th>
                  <th className="px-2 py-2">Status</th>
                  {manageGate.allowed ? <th className="px-2 py-2">{t('construction.sites.actions')}</th> : null}
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr
                    key={site.id}
                    className={`border-t border-gray-100${site.is_active ? '' : ' bg-slate-50 opacity-60'}`}
                  >
                    <td className="px-2 py-2 font-mono text-xs text-gray-800">{site.site_code}</td>
                    <td className="px-2 py-2 text-gray-900">{site.site_name}</td>
                    <td className="px-2 py-2 font-mono text-xs text-gray-700">{site.project_ref}</td>
                    <td className="px-2 py-2 text-gray-700">{branchesById.get(site.branch_id)?.name ?? '—'}</td>
                    <td className="px-2 py-2 text-gray-700">{locationsById.get(site.location_id)?.name ?? '—'}</td>
                    <td className="px-2 py-2">
                      <StatusPill
                        label={site.is_active ? 'Active' : 'Inactive'}
                        className={site.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}
                      />
                    </td>
                    {manageGate.allowed ? (
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setEditingSite(site)}
                            className="rounded border border-gray-200 p-1.5 text-gray-700 hover:bg-gray-50"
                            aria-label={t('construction.sites.editSite')}
                            title={t('construction.sites.editSite')}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatusSite(site)}
                            className="inline-flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                            aria-label={site.is_active ? t('construction.sites.deactivateSite') : t('construction.sites.reactivateSite')}
                          >
                            <Power className="h-3.5 w-3.5" aria-hidden />
                            {site.is_active ? t('construction.sites.deactivateSite') : t('construction.sites.reactivateSite')}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <UomForm
        businessId={businessId}
        capabilities={capabilities}
        products={products}
        onDone={(message) => {
          setNotice(message);
          invalidate();
        }}
      />

      <SectionCard
        title="Registered unit conversions"
        description="Conversions are product-specific, explicit and evidenced, and always target the product base unit. No conversion is inferred or chained."
      >
        {conversions.length === 0 ? (
          <EmptyState title="No conversions registered" detail="Without one, a purchase order can only use the product base unit." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-2 py-2">Product</th>
                  <th className="px-2 py-2">From</th>
                  <th className="px-2 py-2">To (base)</th>
                  <th className="px-2 py-2 text-right">Factor</th>
                  <th className="px-2 py-2">Evidence</th>
                  <th className="px-2 py-2">Approved</th>
                </tr>
              </thead>
              <tbody>
                {conversions.map((conversion) => (
                  <tr key={conversion.id} className="border-t border-gray-100">
                    <td className="px-2 py-2 text-gray-900">
                      {productsById.get(conversion.product_id)?.name ?? conversion.product_id}
                    </td>
                    <td className="px-2 py-2 text-gray-700">{conversion.from_uom}</td>
                    <td className="px-2 py-2 text-gray-700">{conversion.to_uom}</td>
                    <td className="px-2 py-2 text-right text-gray-800">{String(conversion.factor)}</td>
                    <td className="px-2 py-2 text-xs text-gray-600">{conversion.evidence_reference}</td>
                    <td className="px-2 py-2 text-gray-700">{formatDate(conversion.approved_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <PolicyForm
        businessId={businessId}
        capabilities={capabilities}
        policy={policy}
        onDone={(message) => {
          setNotice(message);
          invalidate();
        }}
      />

      {editingSite ? (
        <SiteEditModal
          site={editingSite}
          projects={projects}
          isPending={updateSiteMutation.isPending}
          onClose={() => setEditingSite(null)}
          onSubmit={(input) => updateSiteMutation.mutate({ siteId: editingSite.id, ...input })}
        />
      ) : null}
      {statusSite ? (
        <SiteStatusDialog
          site={statusSite}
          isPending={statusMutation.isPending}
          onClose={() => setStatusSite(null)}
          onSubmit={(reason) => statusMutation.mutate({ siteId: statusSite.id, active: !statusSite.is_active, reason })}
        />
      ) : null}
    </div>
  );
}

function SiteForm({
  businessId,
  capabilities,
  branches,
  locations,
  products,
  projects,
  onDone,
}: {
  businessId: string;
  capabilities: string[];
  branches: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; branch_id: string | null }>;
  products: Array<{ id: string; name: string }>;
  projects: Array<{ id: string; name: string }>;
  onDone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [siteName, setSiteName] = useState('');
  const [projectRef, setProjectRef] = useState('');
  const [projectId, setProjectId] = useState('');

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.masterManage,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.masterManage],
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const registered = await repos.construction.registerSite({
        businessId,
        branchId,
        locationId,
        siteCode: siteCode.trim(),
        siteName: siteName.trim(),
        projectRef: projectRef.trim(),
      });
      // Optional authoritative project link: register owns the immutable
      // identity fields, so the FK is set through the lifecycle RPC right
      // after a successful (or idempotent) registration.
      if (projectId && registered.id) {
        await repos.construction.updateSite(String(registered.id), { projectId });
      }
      return registered;
    },
    onSuccess: () => {
      setSiteCode('');
      setSiteName('');
      setProjectRef('');
      setProjectId('');
      onDone('Construction site registered.');
    },
  });

  void products;

  const locationsForBranch = branchId ? locations.filter((location) => location.branch_id === branchId) : locations;

  return (
    <SectionCard
      title="Register a construction site"
      description="The site maps a project reference to exactly one branch and one inventory location. Repeat registration of the same site code is idempotent."
      actions={<MapPin className="h-4 w-4 text-gray-400" aria-hidden />}
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Branch" required>
          <select aria-label="Branch" value={branchId} onChange={(event) => { setBranchId(event.target.value); setLocationId(''); }} className={FIELD_CLASS}>
            <option value="">Select a branch…</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Inventory location" required hint="The store that holds the material for this site.">
          <select aria-label="Inventory location" value={locationId} onChange={(event) => setLocationId(event.target.value)} className={FIELD_CLASS}>
            <option value="">Select a location…</option>
            {locationsForBranch.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Site code" required hint="Short code used on every document for this site.">
          <input aria-label="Site code" value={siteCode} onChange={(event) => setSiteCode(event.target.value.toUpperCase())} className={FIELD_CLASS} />
        </Field>
        <Field label="Site name" required>
          <input aria-label="Site name" value={siteName} onChange={(event) => setSiteName(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <Field label={t('construction.sites.projectLink')} hint={t('construction.sites.projectLinkPlaceholder')}>
          <select
            aria-label={t('construction.sites.projectLink')}
            value={projectId}
            onChange={(event) => {
              const next = event.target.value;
              setProjectId(next);
              // Auto-fill (not auto-submit) the project reference: selecting a
              // project copies its name, and the field stays editable.
              const project = projects.find((entry) => entry.id === next);
              if (project) setProjectRef(project.name);
            }}
            className={FIELD_CLASS}
          >
            <option value="">{t('construction.sites.noProject')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project reference" required hint="The reference material issues are booked against.">
          <input aria-label="Project reference" value={projectRef} onChange={(event) => setProjectRef(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <div className="flex items-end">
          <GatedButton
            allowed={gate.allowed && Boolean(branchId && locationId && siteCode.trim() && siteName.trim() && projectRef.trim())}
            reason={gate.allowed ? 'Branch, location, site code, site name and project reference are required.' : gate.reason}
            disabled={mutation.isPending}
            type="submit"
          >
            <>
              <MapPin className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Registering…' : 'Register site'}
            </>
          </GatedButton>
        </div>
        {mutation.isError ? (
          <div className="sm:col-span-3">
            <FailureBanner failure={describeConstructionFailure(mutation.error)} />
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

function UomForm({
  businessId,
  capabilities,
  products,
  onDone,
}: {
  businessId: string;
  capabilities: string[];
  products: Array<{ id: string; name: string; unit_of_measure?: string | null }>;
  onDone: (message: string) => void;
}) {
  const [productId, setProductId] = useState('');
  const [fromUom, setFromUom] = useState('');
  const [toUom, setToUom] = useState('');
  const [factor, setFactor] = useState('');
  const [evidence, setEvidence] = useState('');

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.masterManage,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.masterManage],
  );

  const mutation = useMutation({
    mutationFn: () =>
      repos.construction.registerUomConversion({
        businessId,
        productId,
        fromUom: fromUom.trim().toUpperCase(),
        toUom: toUom.trim().toUpperCase(),
        factor: Number(factor),
        evidenceReference: evidence.trim(),
      }),
    onSuccess: () => {
      setFromUom('');
      setFactor('');
      setEvidence('');
      onDone('Unit conversion registered.');
    },
  });

  const selected = products.find((product) => product.id === productId);

  return (
    <SectionCard
      title="Register a product unit conversion"
      description="One factor, one product, one direction — always into the product base unit. The server refuses chained or mismatched targets."
      actions={<Ruler className="h-4 w-4 text-gray-400" aria-hidden />}
    >
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Product" required>
          <select
            aria-label="Conversion product"
            value={productId}
            onChange={(event) => {
              setProductId(event.target.value);
              const product = products.find((entry) => entry.id === event.target.value);
              setToUom(product?.unit_of_measure ? String(product.unit_of_measure).toUpperCase() : '');
            }}
            className={FIELD_CLASS}
          >
            <option value="">Select a product…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="From unit" required hint="For example CTN.">
          <input aria-label="From unit" value={fromUom} onChange={(event) => setFromUom(event.target.value.toUpperCase())} className={FIELD_CLASS} />
        </Field>
        <Field label="To unit (product base unit)" required hint={selected ? `Base unit: ${String(selected.unit_of_measure ?? 'not set')}` : 'Select a product first.'}>
          <input aria-label="To unit" value={toUom} onChange={(event) => setToUom(event.target.value.toUpperCase())} className={FIELD_CLASS} />
        </Field>
        <Field label="Factor" required hint="How many base units one “from” unit contains.">
          <input aria-label="Conversion factor" type="number" min="0" step="any" value={factor} onChange={(event) => setFactor(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <Field label="Evidence reference" required hint="For example the supplier’s packaging specification.">
          <input aria-label="Conversion evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <div className="flex items-end">
          <GatedButton
            allowed={gate.allowed && Boolean(productId && fromUom.trim() && toUom.trim() && Number(factor) > 0 && evidence.trim())}
            reason={gate.allowed ? 'Product, both units, a positive factor and an evidence reference are required.' : gate.reason}
            disabled={mutation.isPending}
            type="submit"
          >
            <>
              <Ruler className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Registering…' : 'Register conversion'}
            </>
          </GatedButton>
        </div>
        {mutation.isError ? (
          <div className="sm:col-span-3">
            <FailureBanner failure={describeConstructionFailure(mutation.error)} />
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

function PolicyForm({
  businessId,
  capabilities,
  policy,
  onDone,
}: {
  businessId: string;
  capabilities: string[];
  policy: { business_id: string; movement_posting_enabled: boolean; approved_reason: string | null; approved_at: string | null; cost_basis_source: string | null } | null;
  onDone: (message: string) => void;
}) {
  const [enable, setEnable] = useState(policy?.movement_posting_enabled ?? false);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.policyApprove,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.policyApprove],
  );

  const mutation = useMutation({
    mutationFn: () => repos.construction.approvePostingPolicy({ businessId, enable, reason: reason.trim(), evidence: evidence.trim() }),
    onSuccess: () => {
      setReason('');
      setEvidence('');
      onDone(`Receipt posting policy ${enable ? 'enabled' : 'withdrawn'}. GL posting remains structurally disabled.`);
    },
  });

  return (
    <SectionCard
      title="Receipt posting policy"
      description="The only switch that lets a goods receipt or a material issue move stock. Approving it needs a written reason and evidence, and it never enables journal posting."
      actions={<ShieldCheck className="h-4 w-4 text-gray-400" aria-hidden />}
    >
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill
          label={policy?.movement_posting_enabled ? 'Movement posting enabled' : 'Movement posting disabled'}
          className={policy?.movement_posting_enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700'}
        />
        <StatusPill label="GL posting: not approved" className="bg-slate-100 text-slate-700" />
        {policy?.cost_basis_source ? <span className="text-xs text-gray-600">Cost basis source: {policy.cost_basis_source}</span> : null}
      </div>
      {policy?.approved_reason ? (
        <p className="mt-2 text-xs text-gray-600">
          Approved {formatDate(policy.approved_at)} — {policy.approved_reason}
        </p>
      ) : null}

      <form
        className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3"
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Field label="Policy state" required>
          <select aria-label="Policy state" value={enable ? 'enable' : 'disable'} onChange={(event) => setEnable(event.target.value === 'enable')} className={FIELD_CLASS}>
            <option value="disable">Keep movement posting disabled</option>
            <option value="enable">Enable movement posting from the matched bill line</option>
          </select>
        </Field>
        <Field label="Approval reason" required>
          <input aria-label="Approval reason" value={reason} onChange={(event) => setReason(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <Field label="Approval evidence" required hint="For example the board minute or accounting policy reference.">
          <input aria-label="Approval evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <div className="sm:col-span-3">
          <InfoNote>
            <p>
              Enabling this policy allows accepted quantities to reach stock at the evidenced bill-line cost. It does not create journal entries and
              does not change any expense treatment.
            </p>
          </InfoNote>
          <div className="mt-3">
            <GatedButton
              allowed={gate.allowed && reason.trim().length > 0 && evidence.trim().length > 0}
              reason={gate.allowed ? 'A written reason and an evidence reference are required.' : gate.reason}
              disabled={mutation.isPending}
              type="submit"
            >
              <>
                <ShieldCheck className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Recording…' : 'Record policy decision'}
              </>
            </GatedButton>
          </div>
          {mutation.isError ? (
            <div className="mt-3">
              <FailureBanner failure={describeConstructionFailure(mutation.error)} />
            </div>
          ) : null}
        </div>
      </form>
    </SectionCard>
  );
}

/**
 * Maps the lifecycle RPC's guard refusals onto the localized
 * `construction.sites.deactivateBlocked*` strings, extracting the count from
 * the server message. Anything unrecognized returns null and falls through to
 * the house FailureBanner, which shows the raw server message verbatim.
 */
function localizeSiteBlock(message: string, t: TFunction): string | null {
  const poMatch = /(\d+)\s+open purchase order\(s\)/.exec(message);
  if (poMatch) return t('construction.sites.deactivateBlockedPOs', { count: Number(poMatch[1]) });
  const issueMatch = /(\d+)\s+open material issue\(s\)/.exec(message);
  if (issueMatch) return t('construction.sites.deactivateBlockedIssues', { count: Number(issueMatch[1]) });
  const stockMatch = /linked location has\s+([\d.]+)\s+units on hand/.exec(message);
  if (stockMatch) {
    return t('construction.sites.deactivateBlockedStock', { count: Number(stockMatch[1].replace(/,/g, '')) });
  }
  return null;
}

function DialogShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={label}>
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-lg">{children}</div>
    </div>
  );
}

/**
 * Edit modal for a registered site (P2-4). Site name, the authoritative
 * project link (with an explicit "No project linked" unlink option) and the
 * project reference — auto-filled from the selected project's name but still
 * editable. Branch, location and site_code are deliberately absent: those are
 * owned by the immutable registration and re-registering with the same site
 * code is the documented way to move them.
 */
function SiteEditModal({
  site,
  projects,
  isPending,
  onClose,
  onSubmit,
}: {
  site: ConstructionProcurementSite;
  projects: Array<{ id: string; name: string }>;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (input: { siteName: string; projectId: string | null; projectRef: string }) => void;
}) {
  const { t } = useTranslation();
  const [siteName, setSiteName] = useState(site.site_name);
  const [projectId, setProjectId] = useState(site.project_id ?? '');
  const [projectRef, setProjectRef] = useState(site.project_ref);
  const canSubmit = siteName.trim().length > 0 && projectRef.trim().length > 0 && !isPending;

  return (
    <DialogShell label={t('construction.sites.editSite')}>
      <h3 className="text-sm font-semibold text-gray-900">{t('construction.sites.editSite')}</h3>
      <p className="mt-1 font-mono text-xs text-gray-500">{site.site_code}</p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({ siteName: siteName.trim(), projectId: projectId || null, projectRef: projectRef.trim() });
        }}
      >
        <Field label={t('construction.sites.siteName')} required>
          <input aria-label={t('construction.sites.siteName')} value={siteName} onChange={(event) => setSiteName(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <Field label={t('construction.sites.projectLink')} hint={t('construction.sites.projectLinkPlaceholder')}>
          <select
            aria-label={t('construction.sites.projectLink')}
            value={projectId}
            onChange={(event) => {
              const next = event.target.value;
              setProjectId(next);
              const project = projects.find((entry) => entry.id === next);
              if (project) setProjectRef(project.name);
            }}
            className={FIELD_CLASS}
          >
            <option value="">{t('construction.sites.noProject')}</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('construction.sites.projectRef')} required>
          <input aria-label={t('construction.sites.projectRef')} value={projectRef} onChange={(event) => setProjectRef(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <InfoNote>
          <p>{t('construction.sites.reRegisterNote')}</p>
        </InfoNote>
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!canSubmit} className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {isPending ? '…' : t('common.save')}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

/**
 * Confirmation dialog for deactivation (with an optional reason) and
 * reactivation (no guards, no reason). The RPC stays the single source of
 * truth for what blocks a deactivation.
 */
function SiteStatusDialog({
  site,
  isPending,
  onClose,
  onSubmit,
}: {
  site: ConstructionProcurementSite;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (reason?: string) => void;
}) {
  const { t } = useTranslation();
  const deactivating = site.is_active;
  const [reason, setReason] = useState('');

  return (
    <DialogShell label={deactivating ? t('construction.sites.deactivateSite') : t('construction.sites.reactivateSite')}>
      <h3 className="text-sm font-semibold text-gray-900">
        {deactivating ? t('construction.sites.deactivateConfirm') : t('construction.sites.reactivateConfirm')}
      </h3>
      <p className="mt-1 text-xs text-gray-700">
        {site.site_name} <span className="font-mono text-gray-500">({site.site_code})</span>
      </p>
      <p className="mt-2 text-xs text-gray-600">
        {deactivating ? t('construction.sites.deactivateConfirmDesc') : t('construction.sites.reactivateConfirmDesc')}
      </p>
      {deactivating ? (
        <div className="mt-3">
          <Field label={t('construction.sites.deactivateReason')}>
            <textarea
              aria-label={t('construction.sites.deactivateReason')}
              placeholder={t('construction.sites.deactivateReasonPlaceholder')}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              className={FIELD_CLASS}
            />
          </Field>
        </div>
      ) : null}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50">
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => onSubmit(deactivating ? reason.trim() || undefined : undefined)}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {deactivating ? t('construction.sites.deactivateSite') : t('construction.sites.reactivateSite')}
        </button>
      </div>
    </DialogShell>
  );
}
