import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONSTRUCTION_LABEL_OVERRIDES,
  NAV_SECTIONS,
  isItemLocked,
  navItemForPath,
  resolveNavLabelKey,
  visibleSectionsFor,
} from '@/components/layout/navConfig';
import { resolveBusinessCapability } from '@/hooks/useCapability';
import type { BusinessOrganisationProfile, OrganisationCapability } from '@/lib/capabilities/profile';
import type { PlanTier } from '@/lib/billing/plans';

const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../../i18n/locales/en.json', import.meta.url)), 'utf8')) as {
  navigation: { sections: Record<string, string>; items: Record<string, string> };
};

type BusinessType = 'construction' | 'retail' | 'service' | 'ngo';

/**
 * What `useOrganisationCapabilityVisibility` returns for each profile in the
 * acceptance matrix. Only a Construction business holds the construction
 * capability; every other type has the Phase-1 capabilities available.
 */
const orgCapabilities = (businessType: BusinessType) =>
  (capability: OrganisationCapability) =>
    capability !== 'construction' || businessType === 'construction';

/** Visible nav items for one business, with the same call shape the app uses. */
function navFor(businessType: BusinessType, planTier: PlanTier, role = 'owner') {
  return visibleSectionsFor(() => true, role, orgCapabilities(businessType), planTier)
    .flatMap((section) => section.items);
}

const constructionItem = (businessType: BusinessType, planTier: PlanTier, role = 'owner') =>
  navFor(businessType, planTier, role).find((item) => item.path === '/construction');

describe('construction workspace navigation', () => {
  it('sits under the renamed Supply Chain section, directly after Transfers', () => {
    const section = NAV_SECTIONS.find((candidate) =>
      candidate.items.some((item) => item.path === '/construction'));
    expect(section?.labelKey).toBe('navigation.sections.inventory');
    expect(en.navigation.sections.inventory).toBe('Supply Chain');
    expect(en.navigation.items.constructionWorkspace).toBe('Construction');

    const paths = section?.items.map((item) => item.path) ?? [];
    expect(paths.indexOf('/construction')).toBe(paths.indexOf('/transfers') + 1);
    // The standalone Construction section is gone.
    expect(NAV_SECTIONS.some((candidate) => candidate.labelKey === 'navigation.sections.construction')).toBe(false);
  });

  it('is an Enterprise child gated by the business type, not a role-free link', () => {
    expect(navItemForPath('/construction')).toMatchObject({
      labelKey: 'navigation.items.constructionWorkspace',
      path: '/construction',
      minPlan: 'enterprise',
      requiresOrgCapability: 'construction',
    });
    expect(navItemForPath('/construction')?.allowAllAuthenticatedRoles).toBeUndefined();
    expect(navItemForPath('/construction')?.partnerFeature).toBeUndefined();
    expect(navItemForPath('/construction')?.requiresCapability).toBeUndefined();
  });

  it('is completely absent for a retail business on Enterprise — no lock, no placeholder', () => {
    const item = constructionItem('retail', 'enterprise');
    expect(item).toBeUndefined();
    expect(navFor('retail', 'enterprise').map((entry) => entry.path)).not.toContain('/construction');
    // The rest of the Supply Chain section is unaffected.
    expect(navFor('retail', 'enterprise').map((entry) => entry.path)).toContain('/products');
  });

  it('is absent for service and non-profit businesses on Enterprise as well', () => {
    expect(constructionItem('service', 'enterprise')).toBeUndefined();
    expect(constructionItem('ngo', 'enterprise')).toBeUndefined();
  });

  it('is present and locked for a construction business on Free/Trial (the only upsell path)', () => {
    const item = constructionItem('construction', 'free');
    expect(item).toBeDefined();
    expect(item?.locked).toBe(true);
    expect(isItemLocked(item!, 'free')).toBe(true);
    // It stays in the output: a plan gate marks, it never removes.
    expect(navFor('construction', 'free').map((entry) => entry.path)).toContain('/construction');
  });

  it('is present and unlocked for a construction business on Enterprise', () => {
    const item = constructionItem('construction', 'enterprise');
    expect(item).toBeDefined();
    expect(item?.locked).toBe(false);
    expect(isItemLocked(item!, 'enterprise')).toBe(false);
  });

  it('keeps the type gate ahead of the plan gate: a retail business on Free still gets nothing', () => {
    expect(constructionItem('retail', 'free')).toBeUndefined();
    expect(navFor('retail', 'free').map((entry) => entry.path)).not.toContain('/construction');
  });

  it('drops the whole Supply Chain section when the type gate empties it', () => {
    // Section-level filtering runs on the pass-1 output: no heading survives an
    // empty list. Every Supply Chain child is type-gated, so a profile without
    // those capabilities loses the section entirely.
    const sections = visibleSectionsFor(() => true, 'owner', () => false, 'enterprise');
    expect(sections.some((section) => section.labelKey === 'navigation.sections.inventory')).toBe(false);
  });

  it('removes the previous sales_clerk visibility', () => {
    // The item used to be role-free. The role filter now applies, so a sales
    // clerk does not see a construction business's workspace.
    expect(constructionItem('construction', 'enterprise', 'sales_clerk')).toBeUndefined();
    expect(constructionItem('construction', 'enterprise', 'stock_clerk')).toBeUndefined();
    expect(navItemForPath('/construction')?.allowAllAuthenticatedRoles).not.toBe(true);
  });
});

// ── Construction vertical cleanup: POS verification and label overrides ──────

/** The two profiles this cleanup is about, exactly as registration stores them. */
const constructionBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['CONSTRUCTION'],
};

const retailBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['RETAIL'],
};

const fullAccess = { subscription: true, partner: true, role: true };

/**
 * The predicate `useOrganisationCapabilityVisibility` hands to the navigation,
 * derived from a real profile through the same resolver the app uses — so these
 * tests cover the profile → capability → nav chain rather than a hand-written
 * stub.
 */
const orgCapabilitiesFor = (profile: BusinessOrganisationProfile) =>
  (capability: OrganisationCapability) =>
    resolveBusinessCapability(capability, profile, fullAccess);

/**
 * The visible Supply Chain children for one real profile, as the rendered pair
 * a test can assert on: the resolved label key and the string `en.json`
 * publishes for it. The Construction child is excluded because its own label is
 * covered separately.
 */
function supplyChainFor(profile: BusinessOrganisationProfile, planTier: PlanTier, role = 'owner') {
  const section = visibleSectionsFor(
    () => true,
    role,
    orgCapabilitiesFor(profile),
    planTier,
  ).find((candidate) => candidate.labelKey === 'navigation.sections.inventory');

  return (section?.items ?? [])
    .filter((item) => item.path !== '/construction')
    .map((item) => ({ labelKey: item.labelKey, label: en.navigation.items[item.labelKey.split('.').pop()!] }));
}

describe('construction vertical navigation cleanup', () => {
  afterEach(() => vi.unstubAllEnvs());

  describe('POS is a retail till, not a site workflow', () => {
    it('is absent for a construction business on Enterprise', () => {
      // POS narrowing is an organisation-layer decision, so the layer is on.
      vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
      expect(resolveBusinessCapability('pos', constructionBusiness, fullAccess)).toBe(false);
      expect(navItemForPath('/pos')?.requiresOrgCapability).toBe('pos');

      const paths = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(constructionBusiness), 'enterprise')
        .flatMap((section) => section.items.map((item) => item.path));
      expect(paths).not.toContain('/pos');
      // The rest of the construction surface is untouched by the POS gate.
      expect(paths).toContain('/construction');
      expect(paths).toContain('/products');
    });

    it('documents that POS narrowing needs the organisation layer on, exactly like every other Phase-1 capability', () => {
      // The kill-switch bypass is construction-only (ALWAYS_PROFILE_GATED), so
      // with the layer off POS keeps its frozen pre-architecture fail-open for
      // every profile — a construction business included. That is the intended
      // Phase-1 rollback semantics, not a construction regression: the vertical
      // hides POS as soon as the layer the whole capability system runs on is
      // enabled, which is what the acceptance matrix above asserts.
      vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
      expect(resolveBusinessCapability('pos', constructionBusiness, fullAccess)).toBe(true);
      // Construction itself never fails open, switch or no switch.
      expect(resolveBusinessCapability('construction', constructionBusiness, fullAccess)).toBe(true);
      expect(resolveBusinessCapability('construction', retailBusiness, fullAccess)).toBe(false);
    });

    it('is still present for a retail business on Starter and above (no regression)', () => {
      vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
      expect(resolveBusinessCapability('pos', retailBusiness, fullAccess)).toBe(true);

      for (const planTier of ['starter', 'growth', 'pro', 'enterprise'] as PlanTier[]) {
        const paths = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(retailBusiness), planTier)
          .flatMap((section) => section.items.map((item) => item.path));
        expect(paths).toContain('/pos');
      }
    });

    it('keeps POS for a construction business that also retails, instead of letting one model win', () => {
      vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
      const both: BusinessOrganisationProfile = {
        organisation_type: 'FOR_PROFIT',
        operating_models: ['CONSTRUCTION', 'RETAIL'],
      };
      expect(resolveBusinessCapability('pos', both, fullAccess)).toBe(true);

      const paths = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(both), 'enterprise')
        .flatMap((section) => section.items.map((item) => item.path));
      expect(paths).toContain('/pos');
      expect(paths).toContain('/construction');
    });
  });

  describe('construction label overrides', () => {
    it('labels the Supply Chain children Materials / Site Stores / Material Transfers for a construction business', () => {
      expect(supplyChainFor(constructionBusiness, 'enterprise')).toEqual([
        { labelKey: 'navigation.items.materials', label: 'Materials' },
        { labelKey: 'navigation.items.siteStores', label: 'Site Stores' },
        { labelKey: 'navigation.items.materialTransfers', label: 'Material Transfers' },
      ]);
    });

    it('labels them Products / Warehouse / Transfers for a retail business (no regression)', () => {
      expect(supplyChainFor(retailBusiness, 'enterprise')).toEqual([
        { labelKey: 'navigation.items.products', label: 'Products' },
        { labelKey: 'navigation.items.warehouse', label: 'Warehouse' },
        { labelKey: 'navigation.items.transfers', label: 'Transfers' },
      ]);
    });

    it('overrides the vocabulary only — routes, icons and gates are untouched', () => {
      const constructionItems = visibleSectionsFor(
        () => true,
        'owner',
        orgCapabilitiesFor(constructionBusiness),
        'enterprise',
      )
        .flatMap((section) => section.items)
        .filter((item) => ['/products', '/warehouse', '/transfers'].includes(item.path));

      expect(constructionItems.map((item) => item.path)).toEqual(['/products', '/warehouse', '/transfers']);
      for (const item of constructionItems) {
        // Same gate as the default item: only the label key moved.
        expect(item.requiresOrgCapability).toBe(navItemForPath(item.path)?.requiresOrgCapability);
        expect(item.requiresCapability).toBe(navItemForPath(item.path)?.requiresCapability);
        expect(item.partnerFeature).toBe(navItemForPath(item.path)?.partnerFeature);
        expect(item.icon).toBe(navItemForPath(item.path)?.icon);
      }
    });

    it('keeps NAV_SECTIONS static so every other surface still reads the default keys', () => {
      expect(navItemForPath('/products')?.labelKey).toBe('navigation.items.products');
      expect(navItemForPath('/warehouse')?.labelKey).toBe('navigation.items.warehouse');
      expect(navItemForPath('/transfers')?.labelKey).toBe('navigation.items.transfers');
    });

    it('leaves every other nav label alone, for construction and retail alike', () => {
      for (const profile of [constructionBusiness, retailBusiness]) {
        const items = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(profile), 'enterprise')
          .flatMap((section) => section.items);
        expect(items.find((item) => item.path === '/income')?.labelKey).toBe('navigation.items.income');
        expect(items.find((item) => item.path === '/reports')?.labelKey).toBe('navigation.items.reports');
        expect(items.find((item) => item.path === '/dashboard')?.labelKey).toBe('navigation.items.dashboard');
      }

      // The Construction child keeps its own label — and stays out of a retail
      // business's nav entirely, so there is nothing to override there.
      const itemsFor = (profile: BusinessOrganisationProfile) =>
        visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(profile), 'enterprise')
          .flatMap((section) => section.items);
      expect(itemsFor(constructionBusiness).find((item) => item.path === '/construction')?.labelKey)
        .toBe('navigation.items.constructionWorkspace');
      expect(itemsFor(retailBusiness).find((item) => item.path === '/construction')).toBeUndefined();
    });

    it('exposes one override table for the surfaces that keep their own item lists', () => {
      expect(CONSTRUCTION_LABEL_OVERRIDES).toEqual({
        'navigation.items.products': 'navigation.items.materials',
        'navigation.items.warehouse': 'navigation.items.siteStores',
        'navigation.items.transfers': 'navigation.items.materialTransfers',
      });
      // Non-construction resolves to itself; unknown keys pass through.
      expect(resolveNavLabelKey('navigation.items.products', false)).toBe('navigation.items.products');
      expect(resolveNavLabelKey('navigation.items.income', true)).toBe('navigation.items.income');
      // The resolver is idempotent, so a surface may apply it to an already
      // resolved key without double-mapping.
      expect(resolveNavLabelKey(resolveNavLabelKey('navigation.items.products', true), true))
        .toBe('navigation.items.materials');
    });

    it('carries the override into the mobile workspace list, which renders the same sections', () => {
      // MobileDashboard renders visibleSectionsFor output directly, so the
      // sidebar and the phone agree without a second code path.
      const sections = visibleSectionsFor(
        () => true,
        'stock_clerk',
        orgCapabilitiesFor(constructionBusiness),
        'enterprise',
      ).filter((section) => section.labelKey !== 'navigation.sections.overview');

      const labels = sections
        .flatMap((section) => section.items)
        .filter((item) => item.path === '/warehouse')
        .map((item) => item.labelKey);
      expect(labels).toEqual(['navigation.items.siteStores']);
    });

    it('publishes the three construction labels in en.json', () => {
      expect(en.navigation.items.materials).toBe('Materials');
      expect(en.navigation.items.siteStores).toBe('Site Stores');
      expect(en.navigation.items.materialTransfers).toBe('Material Transfers');
      // The defaults they replace are still there for every other vertical.
      expect(en.navigation.items.products).toBe('Products');
      expect(en.navigation.items.warehouse).toBe('Warehouse');
      expect(en.navigation.items.transfers).toBe('Transfers');
    });
  });
});
