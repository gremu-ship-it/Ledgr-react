import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  NAV_SECTIONS,
  isItemLocked,
  navItemForPath,
  visibleSectionsFor,
} from '@/components/layout/navConfig';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import { isPathAllowedForRole } from '@/hooks/usePermissions';
import type { BusinessOrganisationProfile, OrganisationCapability } from '@/lib/capabilities/profile';
import type { PlanTier } from '@/lib/billing/plans';

const en = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../i18n/locales/en.json', import.meta.url)), 'utf8'),
) as {
  navigation: { sections: Record<string, string>; items: Record<string, string> };
  manufacturing: { bom: Record<string, unknown> };
};

const manufacturingBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['MANUFACTURING'],
};

const retailBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['RETAIL'],
};

const fullAccess = { subscription: true, partner: true, role: true };

const orgCapabilitiesFor = (profile: BusinessOrganisationProfile) => (capability: OrganisationCapability) =>
  resolveBusinessCapability(capability, profile, fullAccess);

function navFor(profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') {
  return visibleSectionsFor(() => true, role, orgCapabilitiesFor(profile), planTier, profile.operating_models).flatMap(
    (section) => section.items,
  );
}

const bomItem = (profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') =>
  navFor(profile, planTier, role).find((item) => item.path === '/manufacturing/bom');

describe('manufacturing BOM navigation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('adds Bill of Materials item under Manufacturing section', () => {
    const section = NAV_SECTIONS.find((s) => s.labelKey === 'navigation.sections.manufacturing');
    expect(section).toBeDefined();
    expect(section?.minPlan).toBe('enterprise');
    expect(section?.items.every((item) => item.minPlan === 'enterprise')).toBe(true);
    expect(section?.items.map((i) => i.path)).toContain('/manufacturing/bom');
    const bomNav = navItemForPath('/manufacturing/bom');
    expect(bomNav).toMatchObject({
      path: '/manufacturing/bom',
      requiresOrgCapability: 'manufacturing',
      minPlan: 'enterprise',
    });
    expect(bomNav?.labelKey).toBe('navigation.items.manufacturingBom');
    expect(en.navigation.items.manufacturingBom).toBe('BOM');
    expect(en.manufacturing.bom.title).toBe('Bill of Materials');
  });

  it('puts the active Dashboard first in Manufacturing and keeps BOM and Production', () => {
    const section = NAV_SECTIONS.find((s) => s.labelKey === 'navigation.sections.manufacturing');
    expect(section?.items.map((i) => i.path)).toEqual([
      '/manufacturing', '/manufacturing/bom', '/manufacturing/mrp', '/manufacturing/production',
      '/manufacturing/runs', '/manufacturing/routings', '/manufacturing/work-centres',
    ]);
    expect(navItemForPath('/manufacturing')?.labelKey).toBe('manufacturing.bom.dashboard');
    expect(en.manufacturing.bom.dashboard).toBe('Dashboard');
    expect(en.manufacturing.bom.production).toBe('Production');
  });

  it('is completely ABSENT for a retail business — no BOM, no production', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(bomItem(retailBusiness, 'enterprise')).toBeUndefined();
    expect(navFor(retailBusiness, 'enterprise').map((i) => i.path)).not.toContain('/manufacturing/bom');
    expect(navFor(retailBusiness, 'enterprise').map((i) => i.path)).not.toContain('/manufacturing/production');
  });

  it('is present and LOCKED for a manufacturing business on Free — plan gate', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const item = bomItem(manufacturingBusiness, 'free');
    expect(item).toBeDefined();
    expect(item?.locked).toBe(true);
    expect(isItemLocked(item!, 'free')).toBe(true);
  });

  it('is locked on Starter/Growth/Pro and unlocked only on Enterprise', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    for (const tier of ['free', 'starter', 'growth', 'pro'] as PlanTier[]) {
      expect(bomItem(manufacturingBusiness, tier)?.locked).toBe(true);
    }
    expect(bomItem(manufacturingBusiness, 'enterprise')?.locked).toBe(false);
  });

  it('is manager-and-above: manager sees it, stock_clerk does not', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(isPathAllowedForRole('manager', '/manufacturing/bom')).toBe(true);
    expect(isPathAllowedForRole('owner', '/manufacturing/bom')).toBe(true);
    expect(isPathAllowedForRole('stock_clerk', '/manufacturing/bom')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/manufacturing/bom')).toBe(false);
    // Owner allows all
    expect(isPathAllowedForRole('admin', '/manufacturing/bom')).toBe(true);
  });

  it('publishes all required i18n keys via en.json', () => {
    const bom = en.manufacturing.bom as Record<string, unknown>;
    expect(bom.title).toBe('Bill of Materials');
    expect(bom.create).toBe('Create BOM');
    expect(bom.edit).toBe('Edit BOM');
    expect(bom.outputProduct).toBe('Output Product');
    expect(bom.version).toBe('Version');
    expect((bom.status as Record<string, string>).draft).toBe('Draft');
    expect((bom.status as Record<string, string>).active).toBe('Active');
    expect((bom.status as Record<string, string>).archived).toBe('Archived');
    expect(bom.locked).toBe('Locked');
    expect(bom.lockedMessage).toBe(
      'This BOM is locked because it has been used in a work order. Create a new version to make changes.',
    );
    expect(bom.addComponent).toBe('Add Component');
    expect(bom.emptyState).toBe(
      'No bills of materials yet. Create your first BOM to define how your products are assembled.',
    );
    expect(bom.circularRef).toBe('A product cannot be a component of itself.');
    expect(bom.production).toBe('Production');
    expect(bom.dashboard).toBe('Dashboard');
    expect(bom.comingSoon).toBe('Coming soon');
  });
});
