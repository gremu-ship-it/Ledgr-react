/**
 * Business-profile vocabulary and organisation-only capability defaults.
 * These values describe product defaults; they are not permissions and must
 * never be used in RLS or posting logic.
 */
export const ORGANISATION_TYPES = [
  'FOR_PROFIT',
  'NON_PROFIT',
  'GOVERNMENT',
  'OTHER',
] as const;

export type OrganisationType = (typeof ORGANISATION_TYPES)[number];

export const OPERATING_MODELS = [
  'RETAIL',
  'WHOLESALE',
  'PRODUCT_SALES',
  'SERVICE_SALES',
  'PROJECT_BASED',
  'GRANT_FUNDED',
  'CONSTRUCTION',
] as const;

export type OperatingModel = (typeof OPERATING_MODELS)[number];

/**
 * Display labels for the operating-model multi-select, shared by registration
 * and Settings so the two editors can never drift apart.
 */
export const OPERATING_MODEL_LABELS: Readonly<Record<OperatingModel, string>> = {
  RETAIL: 'Retail',
  WHOLESALE: 'Wholesale / distribution',
  PRODUCT_SALES: 'Product sales',
  SERVICE_SALES: 'Service sales',
  PROJECT_BASED: 'Project-based work',
  GRANT_FUNDED: 'Grant-funded',
  CONSTRUCTION: 'Construction',
};

export const ORGANISATION_CAPABILITIES = [
  'sales',
  'pos',
  'inventory',
  'services',
  'construction',
] as const;

export type OrganisationCapability = (typeof ORGANISATION_CAPABILITIES)[number];
export type CapabilityOverrides = Partial<Record<OrganisationCapability, boolean>>;

export interface BusinessOrganisationProfile {
  organisation_type?: OrganisationType | string | null;
  operating_models?: readonly (OperatingModel | string)[] | null;
  capability_overrides?: CapabilityOverrides | Record<string, unknown> | null;
}

export type OrganisationCapabilityDefaults = Record<OrganisationCapability, boolean>;

/**
 * Capabilities each operating model unions in. A business selects several
 * models, so the defaults are the union of every selected model's row — never a
 * single "winning" model. This is why a Construction + Retail business gets both
 * the construction workspace and the retail till instead of one replacing the
 * other.
 *
 * `PROJECT_BASED` is reserved and deliberately maps to nothing: selecting it
 * changes no capability, matching its inert status in the product.
 */
const MODEL_CAPABILITIES: Readonly<Record<OperatingModel, readonly OrganisationCapability[]>> = {
  RETAIL: ['sales', 'pos', 'inventory'],
  WHOLESALE: ['sales', 'inventory'],
  PRODUCT_SALES: ['sales', 'inventory'],
  SERVICE_SALES: ['sales', 'services'],
  PROJECT_BASED: [],
  GRANT_FUNDED: [],
  // A construction business delivers project work with materials it holds in
  // stock, so the model unions in inventory and services while leaving POS off:
  // POS is a retail till, not a site workflow.
  CONSTRUCTION: ['sales', 'inventory', 'services', 'construction'],
};

/**
 * Derive the profile defaults for the first business-architecture phase.
 * Selecting a model is what turns on its matching optional workflow; the
 * organisation type affects the pure-grant sales default, while an explicit
 * commercial operating model remains available to non-profits and government.
 */
export function deriveOrganisationCapabilityDefaults(
  profile: Pick<BusinessOrganisationProfile, 'organisation_type' | 'operating_models'>,
): OrganisationCapabilityDefaults {
  const models = new Set(profile.operating_models ?? []);
  const isNonCommercial = profile.organisation_type === 'NON_PROFIT'
    || profile.organisation_type === 'GOVERNMENT';

  const enabled = new Set<OrganisationCapability>();
  for (const model of models) {
    for (const capability of MODEL_CAPABILITIES[model as OperatingModel] ?? []) {
      enabled.add(capability);
    }
  }

  // Sales stays on unless the profile is purely grant-funded: a non-commercial
  // organisation whose only models are grant funding, with no operating model
  // that implies trading. Construction counts as trading, so a construction
  // non-profit is not "pure grant".
  const pureGrantFunded = isNonCommercial
    && models.has('GRANT_FUNDED')
    && !models.has('RETAIL')
    && !models.has('WHOLESALE')
    && !models.has('PRODUCT_SALES')
    && !models.has('SERVICE_SALES')
    && !models.has('CONSTRUCTION');

  return {
    sales: enabled.has('sales') || !pureGrantFunded,
    pos: enabled.has('pos'),
    inventory: enabled.has('inventory'),
    services: enabled.has('services'),
    construction: enabled.has('construction'),
  };
}

/**
 * Resolve the organisation-layer value for one capability. `undefined` means
 * there is no usable profile decision; the four-layer resolver applies its
 * compatibility semantics (notably POS fail-open) to that case. Construction is
 * always profile-gated, so an undefined decision there closes the surface.
 */
export function organisationCapabilityDecision(
  capability: OrganisationCapability,
  profile?: BusinessOrganisationProfile | null,
): boolean | undefined {
  if (!profile) return undefined;

  const overrides = profile.capability_overrides;
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    const override = (overrides as Record<string, unknown>)[capability];
    if (typeof override === 'boolean') return override;
  }

  const hasProfile = profile.organisation_type != null
    || Array.isArray(profile.operating_models);
  if (!hasProfile) return undefined;

  return deriveOrganisationCapabilityDefaults(profile)[capability];
}
