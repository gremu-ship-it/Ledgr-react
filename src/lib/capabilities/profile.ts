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
] as const;

export type OperatingModel = (typeof OPERATING_MODELS)[number];

export const ORGANISATION_CAPABILITIES = [
  'sales',
  'pos',
  'inventory',
  'services',
] as const;

export type OrganisationCapability = (typeof ORGANISATION_CAPABILITIES)[number];
export type CapabilityOverrides = Partial<Record<OrganisationCapability, boolean>>;

export interface BusinessOrganisationProfile {
  organisation_type?: OrganisationType | string | null;
  operating_models?: readonly (OperatingModel | string)[] | null;
  capability_overrides?: CapabilityOverrides | Record<string, unknown> | null;
}

export type OrganisationCapabilityDefaults = Record<OrganisationCapability, boolean>;

const INVENTORY_MODELS: ReadonlySet<string> = new Set([
  'RETAIL',
  'WHOLESALE',
  'PRODUCT_SALES',
]);

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
  const pureGrantFunded = isNonCommercial
    && models.has('GRANT_FUNDED')
    && !models.has('RETAIL')
    && !models.has('WHOLESALE')
    && !models.has('PRODUCT_SALES')
    && !models.has('SERVICE_SALES');

  return {
    sales: !pureGrantFunded,
    pos: models.has('RETAIL'),
    inventory: [...models].some((model) => INVENTORY_MODELS.has(model)),
    services: models.has('SERVICE_SALES'),
  };
}

/**
 * Resolve the organisation-layer value for one capability. `undefined` means
 * there is no usable profile decision; the four-layer resolver applies its
 * compatibility semantics (notably POS fail-open) to that case.
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
