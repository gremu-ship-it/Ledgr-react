import { useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useUsage } from '@/hooks/useUsage';
import { usePartner } from '@/partner/PartnerContext';
import { hasCapability, type PlanCapability } from '@/lib/billing/plans';
import { isPathAllowedForRole } from '@/hooks/usePermissions';
import { resolveCapability, type CapabilityResolveOptions, type CapabilityLayers } from '@/lib/capabilities/resolve';
import {
  organisationCapabilityDecision,
  type BusinessOrganisationProfile,
  type OrganisationCapability,
} from '@/lib/capabilities/profile';

const PLAN_REQUIREMENT: Partial<Record<OrganisationCapability, PlanCapability>> = {
  inventory: 'inventory',
  // Construction is an Enterprise module: the workspace, the procurement
  // commands and their audit trail are sold together (see PLANS.enterprise).
  construction: 'construction',
  // Manufacturing is sold on the same terms as Construction: the workspace and
  // its bills of materials are one Enterprise module. The per-operation code
  // `manufacturing.bom.manage` is what the server authorises against; this
  // entry is the plan tier that gates reaching the surface at all.
  manufacturing: 'manufacturing',
};

const PARTNER_REQUIREMENT: Partial<Record<OrganisationCapability, 'inventory'>> = {
  inventory: 'inventory',
  // Construction has no partner-feature requirement (absent = unrestricted).
  // Manufacturing likewise: no partner feature gates BOM management, so the
  // partner inventory flag that gates the Supply Chain children does not gate
  // the manufacturing workspace.
};

const ROLE_PATH: Record<OrganisationCapability, string> = {
  sales: '/income',
  pos: '/pos',
  inventory: '/products',
  services: '/income',
  construction: '/construction',
  // The manufacturing role authority is the workspace route itself; `manager`
  // and above are admitted to it through `isPathAllowedForRole`.
  manufacturing: '/manufacturing',
};

type NonOrganisationLayers = Omit<CapabilityLayers, 'organisation'>;

/** Pure four-layer composition, available to unit tests and non-React callers. */
export function resolveBusinessCapability(
  capability: OrganisationCapability,
  profile: BusinessOrganisationProfile | null | undefined,
  layers: NonOrganisationLayers,
  options?: CapabilityResolveOptions,
): boolean {
  return resolveCapability(capability, {
    ...layers,
    organisation: organisationCapabilityDecision(capability, profile),
  }, options);
}

/**
 * Full effective capability for a business module. Existing plan, partner and
 * role controls remain independent AND factors; the organisation profile can
 * only narrow them. The route itself remains the role authority in RoleRoute.
 */
export function useCapability(
  capability: OrganisationCapability,
  rolePath = ROLE_PATH[capability],
): boolean {
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const profile = currentBusiness?.business as BusinessOrganisationProfile | undefined;
  const role = currentBusiness?.role ?? null;
  const { planTier } = useUsage();
  const { isFeatureEnabled } = usePartner();

  const requirement = PLAN_REQUIREMENT[capability];
  const partnerRequirement = PARTNER_REQUIREMENT[capability];
  const subscription = requirement ? hasCapability(planTier, requirement) : true;
  const partner = partnerRequirement ? isFeatureEnabled(partnerRequirement) : true;
  const roleAllowed = isPathAllowedForRole(role, rolePath);

  return resolveBusinessCapability(capability, profile, {
    subscription,
    partner,
    role: roleAllowed,
  });
}

/**
 * UI surfaces that already compose subscription/partner/role separately
 * (navigation and the existing soft plan gates) use this organisation-only
 * predicate. With the kill switch off it returns true and reproduces current
 * visibility; with it on it resolves the pin/default map from the selected
 * business row.
 */
export function useOrganisationCapabilityVisibility(): (
  capability: OrganisationCapability,
) => boolean {
  const profile = useAppStore((state) => state.currentBusiness?.business) as
    | BusinessOrganisationProfile
    | undefined;

  return useCallback((capability: OrganisationCapability) => resolveCapability(
    capability,
    {
      subscription: true,
      partner: true,
      organisation: organisationCapabilityDecision(capability, profile),
      role: true,
    },
  ), [profile]);
}
