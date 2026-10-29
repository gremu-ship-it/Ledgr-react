import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONSTRUCTION_LABEL_OVERRIDES,
  NAV_SECTIONS,
  isItemLocked,
  navItemForPath,
  resolveNavItemLabelKey,
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
  const models: Record<BusinessType, string[]> = {
    construction: ['CONSTRUCTION'], retail: ['RETAIL'], service: ['SERVICE_SALES'], ngo: ['GRANT_FUNDED'],
  };
  return visibleSectionsFor(() => true, role, orgCapabilities(businessType), planTier, models[businessType])
    .flatMap((section) => section.items);
}

const constructionItem = (businessType: BusinessType, planTier: PlanTier, role = 'owner') =>
  navFor(businessType, planTier, role).find((item) => item.path === '/construction');

describe('construction workspace navigation', () => {
  it('keeps Construction in its own section after Inventory', () => {
    const section = NAV_SECTIONS.find((candidate) =>
      candidate.items.some((item) => item.path === '/construction'));
    expect(section?.labelKey).toBe('navigation.sections.construction');
    expect(en.navigation.sections.construction).toBe('Construction');
    expect(en.navigation.items.constructionWorkspace).toBe('Workspace');
    expect(en.navigation.items.constructionSubcontractors).toBe('Subcontractors');
    expect(section?.items.map((item) => item.path)).toEqual([
      '/construction',
      '/construction/subcontractors',
      '/construction/certificates',
      '/construction/retention-register',
    ]);
    expect(section?.minPlan).toBe('enterprise');
    expect(section?.items.every((item) => item.minPlan === 'enterprise')).toBe(true);
    expect(section?.items.every((item) => item.requiresOrgCapability === 'construction')).toBe(true);

    const inventoryIndex = NAV_SECTIONS.findIndex((candidate) => candidate.labelKey === 'navigation.sections.inventory');
    const constructionIndex = NAV_SECTIONS.findIndex((candidate) => candidate.labelKey === 'navigation.sections.construction');
    expect(constructionIndex).toBe(inventoryIndex + 1);
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

  it('gates payment certificates and retention register to Enterprise PROJECT_BASED construction businesses', () => {
    const paths = (operatingModels: string[]) => visibleSectionsFor(
      () => true,
      'owner',
      orgCapabilities('construction'),
      'enterprise',
      operatingModels,
    ).flatMap((section) => section.items.map((item) => item.path));

    expect(paths(['CONSTRUCTION', 'PROJECT_BASED'])).toContain('/construction/certificates');
    expect(paths(['CONSTRUCTION', 'PROJECT_BASED'])).toContain('/construction/retention-register');
    expect(paths(['CONSTRUCTION'])).not.toContain('/construction/certificates');
    expect(paths(['CONSTRUCTION'])).not.toContain('/construction/retention-register');
    expect(navItemForPath('/construction/certificates')).toMatchObject({
      minPlan: 'enterprise', requiresOrgCapability: 'construction', requiredOperatingModels: ['PROJECT_BASED'],
    });
    expect(navItemForPath('/construction/retention-register')).toMatchObject({
      minPlan: 'enterprise', requiresOrgCapability: 'construction', requiredOperatingModels: ['PROJECT_BASED'],
    });
  });

  it('exposes Subcontractors only for Enterprise construction businesses', () => {
    const item = navItemForPath('/construction/subcontractors');
    expect(item).toMatchObject({
      labelKey: 'navigation.items.constructionSubcontractors',
      path: '/construction/subcontractors',
      minPlan: 'enterprise',
      requiresOrgCapability: 'construction',
    });
    expect(navFor('construction', 'enterprise').map((entry) => entry.path)).toContain('/construction/subcontractors');
    expect(navFor('construction', 'free').find((entry) => entry.path === '/construction/subcontractors')?.locked).toBe(true);
    expect(navFor('retail', 'enterprise').map((entry) => entry.path)).not.toContain('/construction/subcontractors');
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

  it('applies construction role access: supervisors can enter, sales clerks cannot', () => {
    expect(constructionItem('construction', 'enterprise', 'manager')).toBeDefined();
    expect(constructionItem('construction', 'enterprise', 'stock_clerk')).toBeDefined();
    expect(constructionItem('construction', 'enterprise', 'purchasing_officer')).toBeDefined();
    expect(constructionItem('construction', 'enterprise', 'sales_clerk')).toBeUndefined();
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

const projectBasedBusiness: BusinessOrganisationProfile = {
  organisation_type: 'FOR_PROFIT',
  operating_models: ['PROJECT_BASED'],
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
    profile.operating_models,
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

      const paths = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(constructionBusiness), 'enterprise', constructionBusiness.operating_models)
        .flatMap((section) => section.items.map((item) => item.path));
      expect(paths).not.toContain('/pos');
      // The rest of the construction surface is untouched by the POS gate.
      expect(paths).toContain('/construction');
      expect(paths).toContain('/products');
    });

    it('documents that POS is profile-gated even with the organisation layer off', () => {
      // POS has joined Construction in ALWAYS_PROFILE_GATED, so its
      // organisation decision is honoured on both switch states: with the
      // layer off a construction business still has no till, while the
      // non-gated Phase-1 capabilities keep their Phase-1 rollback
      // semantics. Only RETAIL (or a CONSTRUCTION + RETAIL union, below)
      // derives `pos: true`.
      vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', '');
      expect(resolveBusinessCapability('pos', constructionBusiness, fullAccess)).toBe(false);
      expect(resolveBusinessCapability('pos', retailBusiness, fullAccess)).toBe(true);
      // Construction itself never fails open, switch or no switch.
      expect(resolveBusinessCapability('construction', constructionBusiness, fullAccess)).toBe(true);
      expect(resolveBusinessCapability('construction', retailBusiness, fullAccess)).toBe(false);
    });

    it('is still present for a retail business on Starter and above (no regression)', () => {
      vi.stubEnv('VITE_FEATURE_CAPABILITY_ORG_LAYER', 'true');
      expect(resolveBusinessCapability('pos', retailBusiness, fullAccess)).toBe(true);

      for (const planTier of ['starter', 'growth', 'pro', 'enterprise'] as PlanTier[]) {
        const paths = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(retailBusiness), planTier, retailBusiness.operating_models)
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

      const paths = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(both), 'enterprise', both.operating_models)
        .flatMap((section) => section.items.map((item) => item.path));
      expect(paths).toContain('/pos');
      expect(paths).toContain('/construction');
    });
  });

  describe('PROJECT_BASED inventory labels', () => {
    it('uses Materials / Site Stores / Materials Transfer for PROJECT_BASED businesses', () => {
      expect(supplyChainFor(projectBasedBusiness, 'enterprise')).toEqual([
        { labelKey: 'navigation.items.materials', label: 'Materials' },
        { labelKey: 'navigation.items.siteStores', label: 'Site Stores' },
        { labelKey: 'navigation.items.materialTransfer', label: 'Materials Transfer' },
      ]);
    });

    it('retains Products / Warehouse / Transfers for every other model', () => {
      const manufacturingBusiness: BusinessOrganisationProfile = {
        organisation_type: 'FOR_PROFIT',
        operating_models: ['MANUFACTURING'],
      };
      for (const profile of [constructionBusiness, retailBusiness, manufacturingBusiness]) {
        expect(supplyChainFor(profile, 'enterprise')).toEqual([
          { labelKey: 'navigation.items.products', label: 'Products' },
          { labelKey: 'navigation.items.warehouse', label: 'Warehouse' },
          { labelKey: 'navigation.items.transfers', label: 'Transfers' },
        ]);
      }
    });

    it('uses construction labels for a multi-type business containing PROJECT_BASED', () => {
      const mixed: BusinessOrganisationProfile = {
        organisation_type: 'FOR_PROFIT',
        operating_models: ['RETAIL', 'PROJECT_BASED'],
      };
      expect(supplyChainFor(mixed, 'enterprise')).toEqual([
        { labelKey: 'navigation.items.materials', label: 'Materials' },
        { labelKey: 'navigation.items.siteStores', label: 'Site Stores' },
        { labelKey: 'navigation.items.materialTransfer', label: 'Materials Transfer' },
      ]);
    });

    it('overrides the vocabulary only — routes, icons and gates are untouched', () => {
      const constructionItems = visibleSectionsFor(
        () => true,
        'owner',
        orgCapabilitiesFor(projectBasedBusiness),
        'enterprise',
        projectBasedBusiness.operating_models,
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
        const items = visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(profile), 'enterprise', profile.operating_models)
          .flatMap((section) => section.items);
        expect(items.find((item) => item.path === '/income')?.labelKey).toBe('navigation.items.income');
        expect(items.find((item) => item.path === '/reports/profit-loss')?.labelKey).toBe('nav.reports.profitLoss');
        expect(items.find((item) => item.path === '/reports/balance-sheet')?.labelKey).toBe('nav.reports.balanceSheet');
        expect(items.find((item) => item.path === '/dashboard')?.labelKey).toBe('navigation.items.dashboard');
      }

      // The Construction child keeps its own label — and stays out of a retail
      // business's nav entirely, so there is nothing to override there.
      const itemsFor = (profile: BusinessOrganisationProfile) =>
        visibleSectionsFor(() => true, 'owner', orgCapabilitiesFor(profile), 'enterprise', profile.operating_models)
          .flatMap((section) => section.items);
      expect(itemsFor(constructionBusiness).find((item) => item.path === '/construction')?.labelKey)
        .toBe('navigation.items.constructionWorkspace');
      expect(itemsFor(retailBusiness).find((item) => item.path === '/construction')).toBeUndefined();
    });

    it('exposes one override table for the surfaces that keep their own item lists', () => {
      expect(CONSTRUCTION_LABEL_OVERRIDES).toEqual({
        'navigation.items.locations': 'navigation.items.sites',
      });
      const products = navItemForPath('/products')!;
      expect(resolveNavItemLabelKey(products, ['PROJECT_BASED'])).toBe('navigation.items.materials');
      expect(resolveNavItemLabelKey(products, ['RETAIL'])).toBe('navigation.items.products');
      // Other vertical resolvers retain only the separate Sites vocabulary.
      expect(resolveNavLabelKey('navigation.items.products', true, ['CONSTRUCTION']))
        .toBe('navigation.items.products');
      expect(resolveNavLabelKey('navigation.items.income', true)).toBe('navigation.items.income');
      expect(resolveNavLabelKey('navigation.items.locations', true)).toBe('navigation.items.sites');
    });

    it('carries the override into the mobile workspace list, which renders the same sections', () => {
      // MobileDashboard renders visibleSectionsFor output directly, so the
      // sidebar and the phone agree without a second code path.
      const sections = visibleSectionsFor(
        () => true,
        'stock_clerk',
        orgCapabilitiesFor(projectBasedBusiness),
        'enterprise',
        projectBasedBusiness.operating_models,
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
      expect(en.navigation.items.materialTransfer).toBe('Materials Transfer');
      // The defaults they replace are still there for every other vertical.
      expect(en.navigation.items.products).toBe('Products');
      expect(en.navigation.items.warehouse).toBe('Warehouse');
      expect(en.navigation.items.transfers).toBe('Transfers');
    });
  });
});
