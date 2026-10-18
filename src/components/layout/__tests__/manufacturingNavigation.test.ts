import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  MANUFACTURING_LABEL_OVERRIDES,
  NAV_SECTIONS,
  isItemLocked,
  navItemForPath,
  resolveNavLabelKey,
  visibleSectionsFor,
} from '@/components/layout/navConfig';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import { isPathAllowedForRole } from '@/hooks/usePermissions';
import type { BusinessOrganisationProfile, OrganisationCapability } from '@/lib/capabilities/profile';
import type { PlanTier } from '@/lib/billing/plans';

const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../../i18n/locales/en.json', import.meta.url)), 'utf8')) as {
  navigation: { sections: Record<string, string>; items: Record<string, string> };
  manufacturing: Record<string, Record<string, string>>;
};

const manufacturingBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['MANUFACTURING'],
};

const retailBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['RETAIL'],
};

const constructionBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['CONSTRUCTION'],
};

const fullAccess = { subscription: true, partner: true, role: true };

/**
 * The predicate `useOrganisationCapabilityVisibility` hands to the navigation,
 * derived from a real profile through the same resolver the app uses.
 */
const orgCapabilitiesFor = (profile: BusinessOrganisationProfile) =>
  (capability: OrganisationCapability) =>
    resolveBusinessCapability(capability, profile, fullAccess);

function navFor(profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') {
  return visibleSectionsFor(() => true, role, orgCapabilitiesFor(profile), planTier)
    .flatMap((section) => section.items);
}

const manufacturingItem = (profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') =>
  navFor(profile, planTier, role).find((item) => item.path === '/manufacturing');

describe('manufacturing workspace navigation', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('sits in the Supply Chain section, directly after Construction', () => {
    const section = NAV_SECTIONS.find((candidate) =>
      candidate.items.some((item) => item.path === '/manufacturing'));
    expect(section?.labelKey).toBe('navigation.sections.inventory');
    expect(en.navigation.sections.inventory).toBe('Supply Chain');
    expect(en.navigation.items.manufacturingWorkspace).toBe('Manufacturing');

    const paths = section?.items.map((item) => item.path) ?? [];
    expect(paths.indexOf('/manufacturing')).toBe(paths.indexOf('/construction') + 1);
  });

  it('is an Enterprise child gated by the business type, not a role-free link', () => {
    expect(navItemForPath('/manufacturing')).toMatchObject({
      labelKey: 'navigation.items.manufacturingWorkspace',
      path: '/manufacturing',
      minPlan: 'enterprise',
      requiresOrgCapability: 'manufacturing',
    });
    expect(navItemForPath('/manufacturing')?.allowAllAuthenticatedRoles).toBeUndefined();
    expect(navItemForPath('/manufacturing')?.partnerFeature).toBeUndefined();
    expect(navItemForPath('/manufacturing')?.requiresCapability).toBeUndefined();
  });

  // ── Pass 1: visibility ────────────────────────────────────────────────────
  it('is completely ABSENT for a retail business on Enterprise — no lock, no placeholder', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const item = manufacturingItem(retailBusiness, 'enterprise');
    expect(item).toBeUndefined();
    expect(navFor(retailBusiness, 'enterprise').map((entry) => entry.path)).not.toContain('/manufacturing');
    // The rest of the Supply Chain section is unaffected.
    expect(navFor(retailBusiness, 'enterprise').map((entry) => entry.path)).toContain('/products');
  });

  it('is absent for a construction business on Enterprise — the verticals do not inherit from each other', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(manufacturingItem(constructionBusiness, 'enterprise')).toBeUndefined();
    // And a manufacturer does not inherit construction either.
    expect(navFor(manufacturingBusiness, 'enterprise').map((entry) => entry.path)).not.toContain('/construction');
  });

  it('stays absent for a retail business even with the organisation layer off', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
    expect(manufacturingItem(retailBusiness, 'enterprise')).toBeUndefined();
    expect(manufacturingItem(retailBusiness, 'free')).toBeUndefined();
  });

  // ── Pass 2: plan tier ─────────────────────────────────────────────────────
  it('is present and LOCKED for a manufacturing business on Free — the only upsell path', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const item = manufacturingItem(manufacturingBusiness, 'free');
    expect(item).toBeDefined();
    expect(item?.locked).toBe(true);
    expect(isItemLocked(item!, 'free')).toBe(true);
    // It stays in the output: a plan gate marks, it never removes.
    expect(navFor(manufacturingBusiness, 'free').map((entry) => entry.path)).toContain('/manufacturing');
  });

  it('is locked on Starter, Growth and Pro, and unlocked only on Enterprise', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    for (const tier of ['free', 'starter', 'growth', 'pro'] as PlanTier[]) {
      expect(manufacturingItem(manufacturingBusiness, tier)?.locked).toBe(true);
    }
    expect(manufacturingItem(manufacturingBusiness, 'enterprise')?.locked).toBe(false);
    expect(isItemLocked(manufacturingItem(manufacturingBusiness, 'enterprise')!, 'enterprise')).toBe(false);
  });

  it('keeps the type gate ahead of the plan gate: a retail business on Free still gets nothing', () => {
    expect(manufacturingItem(retailBusiness, 'free')).toBeUndefined();
  });

  // ── Role ──────────────────────────────────────────────────────────────────
  it('is manager-and-above: a manager sees it, a stock clerk does not', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(isPathAllowedForRole('manager', '/manufacturing')).toBe(true);
    expect(isPathAllowedForRole('owner', '/manufacturing')).toBe(true);
    expect(isPathAllowedForRole('admin', '/manufacturing')).toBe(true);
    expect(isPathAllowedForRole('stock_clerk', '/manufacturing')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/manufacturing')).toBe(false);

    expect(manufacturingItem(manufacturingBusiness, 'enterprise', 'manager')).toBeDefined();
    expect(manufacturingItem(manufacturingBusiness, 'enterprise', 'stock_clerk')).toBeUndefined();
    expect(manufacturingItem(manufacturingBusiness, 'enterprise', 'cashier')).toBeUndefined();
  });
});

describe('manufacturing label vocabulary', () => {
  afterEach(() => vi.unstubAllEnvs());

  /** The resolved label key and the string en.json publishes for it. */
  function supplyChainLabels(profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') {
    const section = visibleSectionsFor(() => true, role, orgCapabilitiesFor(profile), planTier)
      .find((candidate) => candidate.labelKey === 'navigation.sections.inventory');
    return (section?.items ?? [])
      .filter((item) => ['/products', '/warehouse', '/transfers'].includes(item.path))
      .map((item) => ({ labelKey: item.labelKey, label: en.navigation.items[item.labelKey.split('.').pop()!] }));
  }

  it('labels the Supply Chain children Materials / Site Stores / Material Transfers for a manufacturer', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(supplyChainLabels(manufacturingBusiness, 'enterprise')).toEqual([
      { labelKey: 'navigation.items.materials', label: 'Materials' },
      { labelKey: 'navigation.items.siteStores', label: 'Site Stores' },
      { labelKey: 'navigation.items.materialTransfers', label: 'Material Transfers' },
    ]);
  });

  it('shares one override table with construction, so the two cannot drift', () => {
    expect(MANUFACTURING_LABEL_OVERRIDES).toEqual({
      'navigation.items.products': 'navigation.items.materials',
      'navigation.items.warehouse': 'navigation.items.siteStores',
      'navigation.items.transfers': 'navigation.items.materialTransfers',
    });
    expect(MANUFACTURING_LABEL_OVERRIDES['navigation.items.products'])
      .toBe(MANUFACTURING_LABEL_OVERRIDES['navigation.items.products']);
  });

  it('overrides the vocabulary only — routes, icons and gates are untouched', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    const items = navFor(manufacturingBusiness, 'enterprise')
      .filter((item) => ['/products', '/warehouse', '/transfers'].includes(item.path));

    expect(items.map((item) => item.path)).toEqual(['/products', '/warehouse', '/transfers']);
    for (const item of items) {
      expect(item.requiresOrgCapability).toBe(navItemForPath(item.path)?.requiresOrgCapability);
      expect(item.requiresCapability).toBe(navItemForPath(item.path)?.requiresCapability);
      expect(item.partnerFeature).toBe(navItemForPath(item.path)?.partnerFeature);
      expect(item.icon).toBe(navItemForPath(item.path)?.icon);
    }
  });

  it('leaves a retail business on the default vocabulary (no regression)', () => {
    vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
    expect(supplyChainLabels(retailBusiness, 'enterprise')).toEqual([
      { labelKey: 'navigation.items.products', label: 'Products' },
      { labelKey: 'navigation.items.warehouse', label: 'Warehouse' },
      { labelKey: 'navigation.items.transfers', label: 'Transfers' },
    ]);
  });

  it('keeps NAV_SECTIONS static so every other surface still reads the default keys', () => {
    expect(navItemForPath('/products')?.labelKey).toBe('navigation.items.products');
    expect(navItemForPath('/warehouse')?.labelKey).toBe('navigation.items.warehouse');
    expect(navItemForPath('/transfers')?.labelKey).toBe('navigation.items.transfers');
    // Non-vertical keys pass through untouched.
    expect(resolveNavLabelKey('navigation.items.income', true)).toBe('navigation.items.income');
    expect(resolveNavLabelKey('navigation.items.products', false)).toBe('navigation.items.products');
  });
});

describe('manufacturing i18n keys', () => {
  it('publishes the manufacturing namespace in en.json', () => {
    expect(en.manufacturing.title).toBe('Manufacturing');
    expect(en.manufacturing.comingSoon).toBe('Manufacturing features coming soon');
    expect(en.manufacturing.productType).toEqual({
      raw_material: 'Raw Material',
      wip: 'Work in Progress',
      finished_good: 'Finished Good',
      trading_good: 'Trading Good',
    });
    expect(en.manufacturing.locationType).toEqual({
      warehouse: 'Warehouse',
      raw_materials_store: 'Raw Materials Store',
      production_floor: 'Production Floor',
      finished_goods_store: 'Finished Goods Store',
    });
    expect(en.navigation.sections.manufacturing).toBe('Manufacturing');
  });

  it('adds no translations to the other locales, which fall back to English', () => {
    // Deliberate: fr/ny/pt/sw are intentionally left to fall back.
    for (const locale of ['fr', 'ny', 'pt', 'sw']) {
      const file = fileURLToPath(new URL(`../../../i18n/locales/${locale}.json`, import.meta.url));
      const contents = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      expect(contents.manufacturing, `${locale}.json must not carry a manufacturing namespace`).toBeUndefined();
    }
  });
});
