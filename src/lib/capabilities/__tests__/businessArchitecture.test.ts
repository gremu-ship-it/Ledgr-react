import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { NAV_SECTIONS, visibleSectionsFor, navItemForPath } from '@/components/layout/navConfig';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import {
  deriveOrganisationCapabilityDefaults,
  organisationCapabilityDecision,
  type BusinessOrganisationProfile,
  type OrganisationCapability,
} from '../profile';

afterEach(() => vi.unstubAllEnvs());

const fullAccess = { subscription: true, partner: true, role: true };
const pinnedExisting: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: [],
  capability_overrides: {
    sales: true,
    pos: true,
    inventory: true,
    services: true,
  },
};

function visiblePaths(isOrgEnabled: (capability: OrganisationCapability) => boolean) {
  return visibleSectionsFor(() => true, 'owner', isOrgEnabled)
    .flatMap((section) => section.items.map((item) => item.path));
}

describe('frozen Phase 1 capability acceptance matrix', () => {
  it('A — preserves the existing retail surface and central POS navigation', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('pos', pinnedExisting, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('inventory', pinnedExisting, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('services', pinnedExisting, fullAccess)).toBe(true);
    const paths = visiblePaths(() => true);
    expect(paths).toContain('/pos');
    expect(paths).toContain('/products');
    expect(navItemForPath('/pos')?.requiresOrgCapability).toBe('pos');

    const app = readFileSync(fileURLToPath(new URL('../../../../src/App.tsx', import.meta.url)), 'utf8');
    const posRoute = app.match(/<Route path="\/pos" element=\{[\s\S]*?<\/CapabilityGate>\s*\} \/>/);
    expect(posRoute?.[0]).toContain('<CapabilityGate capability="pos">');
    expect(posRoute?.[0]).toContain('<PosPage />');
  });

  it('B — preserves a legacy non-POS business regardless of its prior usage signals', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    // No model/history inference is used for existing businesses: the migration
    // pins the current UI capabilities explicitly, including Strategy-A POS.
    expect(organisationCapabilityDecision('pos', pinnedExisting)).toBe(true);
    expect(resolveBusinessCapability('pos', pinnedExisting, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('inventory', pinnedExisting, fullAccess)).toBe(true);
  });

  it('H — keeps POS available for an existing tenant after the pin migration', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('pos', pinnedExisting, fullAccess)).toBe(true);
  });

  it('I — an organisation pin cannot bypass the existing role decision', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('pos', pinnedExisting, { ...fullAccess, role: false })).toBe(false);
    expect(resolveBusinessCapability('inventory', pinnedExisting, { ...fullAccess, role: false })).toBe(false);
  });

  it('J — leaves RLS policy definitions untouched by the organisation layer', () => {
    const migration = readFileSync(fileURLToPath(new URL(
      '../../../../supabase/migrations/20261019000001_business_profile_capabilities.sql',
      import.meta.url,
    )), 'utf8');
    expect(migration).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);
    expect(migration).not.toMatch(/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i);
    expect(migration).not.toMatch(/\b(?:journal_entries|journal_lines)\b/i);
  });

  it('K — organisation settings cannot exceed a subscription entitlement', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('inventory', pinnedExisting, {
      ...fullAccess,
      subscription: false,
    })).toBe(false);
  });

  it('L — organisation settings cannot exceed a partner feature flag', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(resolveBusinessCapability('inventory', pinnedExisting, {
      ...fullAccess,
      partner: false,
    })).toBe(false);
  });

  it('O — a missing POS decision fails closed now POS is profile-gated, while an explicit false still narrows', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    // POS is in ALWAYS_PROFILE_GATED alongside Construction, so it resolves
    // from the profile every time: no decision means no retail profile, and
    // no till. Existing businesses are protected by the legacy pin instead,
    // which resolves to an explicit `pos: true` decision (see A/B/H).
    expect(resolveBusinessCapability('pos', undefined, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('pos', {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['SERVICE_SALES'],
    }, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('pos', {
      ...pinnedExisting,
      capability_overrides: { ...pinnedExisting.capability_overrides, pos: false },
    }, fullAccess)).toBe(false);
  });

  it('captures the profile during onboarding and forwards the appended RPC values', () => {
    const onboarding = readFileSync(fileURLToPath(new URL(
      '../../../../src/pages/CreateBusinessPage.tsx',
      import.meta.url,
    )), 'utf8');
    expect(onboarding).toContain('Organisation profile');
    expect(onboarding).toContain('Operating models');
    expect(onboarding).toContain('p_organisation_type: form.organisation_type');
    expect(onboarding).toContain('p_operating_models: form.operating_models');
  });

  it('derives the service-only profile without forcing POS or inventory', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const profile = {
      organisation_type: 'NON_PROFIT',
      operating_models: ['SERVICE_SALES'] as const,
    };
    expect(deriveOrganisationCapabilityDefaults(profile)).toEqual({
      sales: true,
      pos: false,
      inventory: false,
      services: true,
      construction: false,
      manufacturing: false,
    });
    expect(resolveBusinessCapability('services', profile, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('inventory', profile, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('pos', profile, fullAccess)).toBe(false);
    expect(visiblePaths((capability) => capability !== 'inventory' && capability !== 'pos')).not.toContain('/products');
  });

  it('P — derives the construction union: materials, services and the workspace, but no POS', () => {
    // POS narrowing is an organisation-layer decision, so this test turns the
    // layer on. Construction itself is profile-gated with the switch either way.
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const construction: BusinessOrganisationProfile = {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['CONSTRUCTION'],
    };
    expect(deriveOrganisationCapabilityDefaults(construction)).toEqual({
      sales: true,
      pos: false,
      inventory: true,
      services: true,
      construction: true,
      manufacturing: false,
    });
    expect(resolveBusinessCapability('construction', construction, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('inventory', construction, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('pos', construction, fullAccess)).toBe(false);
    expect(organisationCapabilityDecision('construction', construction)).toBe(true);
  });

  it('Q — unions a construction business that also retails instead of letting one model win', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const both: BusinessOrganisationProfile = {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['CONSTRUCTION', 'RETAIL'],
    };
    expect(deriveOrganisationCapabilityDefaults(both)).toEqual({
      sales: true,
      pos: true,
      inventory: true,
      services: true,
      construction: true,
      manufacturing: false,
    });
    expect(resolveBusinessCapability('pos', both, fullAccess)).toBe(true);
    expect(resolveBusinessCapability('construction', both, fullAccess)).toBe(true);
  });

  it('R — leaves PROJECT_BASED inert and does not turn Construction into a project alias', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const projectBased: BusinessOrganisationProfile = {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['PROJECT_BASED'],
    };
    expect(deriveOrganisationCapabilityDefaults(projectBased)).toEqual({
      sales: true,
      pos: false,
      inventory: false,
      services: false,
      construction: false,
      manufacturing: false,
    });
    expect(resolveBusinessCapability('construction', projectBased, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('construction', { ...projectBased, operating_models: ['PROJECT_BASED', 'CONSTRUCTION'] }, fullAccess)).toBe(true);
  });

  it('S — hides Construction from a business whose profile does not select it, switch or no switch', () => {
    // An existing tenant pinned by 20261019000001 has no `construction` key, and
    // the new capability is deliberately profile-gated rather than pinned open.
    expect(organisationCapabilityDecision('construction', pinnedExisting)).toBe(false);
    expect(resolveBusinessCapability('construction', pinnedExisting, fullAccess)).toBe(false);
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    expect(resolveBusinessCapability('construction', pinnedExisting, fullAccess)).toBe(false);
    const paths = visiblePaths((capability) => capability !== 'construction');
    expect(paths).not.toContain('/construction');
    expect(paths).toContain('/products');
  });

  it('T — keeps Construction in a dedicated section immediately after Inventory', () => {
    const section = NAV_SECTIONS.find((candidate) => candidate.items.some((item) => item.path === '/construction'));
    expect(section?.labelKey).toBe('navigation.sections.construction');
    expect(section?.items.map((item) => item.path)).toEqual(['/construction', '/construction/subcontractors']);
    const inventoryIndex = NAV_SECTIONS.findIndex((candidate) => candidate.labelKey === 'navigation.sections.inventory');
    const constructionIndex = NAV_SECTIONS.findIndex((candidate) => candidate.labelKey === 'navigation.sections.construction');
    expect(constructionIndex).toBe(inventoryIndex + 1);

    const item = navItemForPath('/construction');
    expect(item).toMatchObject({
      minPlan: 'enterprise',
      requiresOrgCapability: 'construction',
    });
    expect(item?.allowAllAuthenticatedRoles).toBeUndefined();
    expect(item?.partnerFeature).toBeUndefined();

    const paths = visiblePaths((capability) => capability === 'construction');
    expect(paths).toContain('/construction');
    // The organisation predicate is what hides it; plan gating is isItemLocked.
    expect(visiblePaths((capability) => capability !== 'construction')).not.toContain('/construction');
  });

  it('U — keeps Construction visible for every role that may enter the workspace', () => {
    const ownerPaths = visibleSectionsFor(() => true, 'owner', (capability) => capability === 'construction')
      .flatMap((entry) => entry.items.map((item) => item.path));
    expect(ownerPaths).toContain('/construction');
    // The role filter now applies (no allowAllAuthenticatedRoles): a cashier's
    // path list does not include the workspace, so their sidebar does not either.
    const cashierPaths = visibleSectionsFor(() => true, 'cashier', (capability) => capability === 'construction')
      .flatMap((entry) => entry.items.map((item) => item.path));
    expect(cashierPaths).not.toContain('/construction');
  });

  it('retains the pre-architecture navigation when the build-time rollback switch is off, except profile-gated POS', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    const serviceProfile: BusinessOrganisationProfile = {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['SERVICE_SALES'],
    };
    // The switch is off, so the non-gated Phase-1 capabilities keep their
    // legacy result; POS and Construction stay profile-gated (a service
    // profile selects neither).
    const paths = visibleSectionsFor(() => true, 'owner', (capability) => resolveBusinessCapability(capability, serviceProfile, fullAccess))
      .flatMap((section) => section.items.map((item) => item.path));
    expect(resolveBusinessCapability('pos', serviceProfile, fullAccess)).toBe(false);
    expect(resolveBusinessCapability('inventory', serviceProfile, fullAccess)).toBe(true);
    expect(paths).not.toContain('/pos');
    expect(paths).toContain('/products');
  });

  it('gates POS to RETAIL businesses regardless of the kill-switch state', () => {
    // POS carries no plan requirement, so the subscription layer the hook
    // composes for it is `true` on every tier — a RETAIL business sees POS
    // on any plan, and no plan can grant it to a non-RETAIL business.
    const retail: BusinessOrganisationProfile = {
      organisation_type: 'FOR_PROFIT',
      operating_models: ['RETAIL'],
    };
    const nonRetail: BusinessOrganisationProfile[] = [
      { organisation_type: 'FOR_PROFIT', operating_models: ['CONSTRUCTION'] },
      { organisation_type: 'FOR_PROFIT', operating_models: ['SERVICE_SALES'] },
      { organisation_type: 'FOR_PROFIT', operating_models: [] },
    ];
    for (const organisationLayerEnabled of [true, false]) {
      const options = { organisationLayerEnabled };
      expect(resolveBusinessCapability('pos', retail, fullAccess, options)).toBe(true);
      for (const profile of nonRetail) {
        expect(resolveBusinessCapability('pos', profile, fullAccess, options)).toBe(false);
      }
      // The legacy pin is a profile decision, so it survives on both states.
      expect(resolveBusinessCapability('pos', pinnedExisting, fullAccess, options)).toBe(true);
    }
  });
});
