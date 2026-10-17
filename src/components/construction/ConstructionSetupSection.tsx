import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Ruler, ShieldCheck } from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  CONSTRUCTION_CAPABILITY_LABELS,
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
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const dataQuery = useQuery({
    queryKey: ['construction', 'setup', businessId],
    queryFn: async () => {
      const [sites, conversions, branches, locations, products, policy] = await Promise.all([
        repos.construction.findSites(businessId),
        repos.construction.findUomConversions(businessId),
        repos.branch.findByBusiness(businessId),
        repos.branch.findLocations(businessId),
        repos.inventory.findAllProducts(businessId),
        repos.construction.findPostingPolicy(businessId),
      ]);
      return { sites, conversions, branches, locations, products, policy };
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

  const { sites, conversions, branches, locations, products, policy } = dataQuery.data!;
  const productsById = new Map(products.map((product) => [product.id, product]));
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]));
  const locationsById = new Map(locations.map((location) => [location.id, location]));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['construction'] });
  };

  return (
    <div className="space-y-6">
      {notice ? <SuccessBanner message={notice} /> : null}

      <SiteForm
        businessId={businessId}
        capabilities={capabilities}
        branches={branches}
        locations={locations}
        products={products}
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
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.id} className="border-t border-gray-100">
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
    </div>
  );
}

function SiteForm({
  businessId,
  capabilities,
  branches,
  locations,
  products,
  onDone,
}: {
  businessId: string;
  capabilities: string[];
  branches: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; branch_id: string | null }>;
  products: Array<{ id: string; name: string }>;
  onDone: (message: string) => void;
}) {
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [siteCode, setSiteCode] = useState('');
  const [siteName, setSiteName] = useState('');
  const [projectRef, setProjectRef] = useState('');

  const gate = gateForCapability(
    capabilities,
    CONSTRUCTION_CAPABILITIES.masterManage,
    CONSTRUCTION_CAPABILITY_LABELS[CONSTRUCTION_CAPABILITIES.masterManage],
  );

  const mutation = useMutation({
    mutationFn: () =>
      repos.construction.registerSite({
        businessId,
        branchId,
        locationId,
        siteCode: siteCode.trim(),
        siteName: siteName.trim(),
        projectRef: projectRef.trim(),
      }),
    onSuccess: () => {
      setSiteCode('');
      setSiteName('');
      setProjectRef('');
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
