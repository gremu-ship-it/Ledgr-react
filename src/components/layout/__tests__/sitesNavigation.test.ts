import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONSTRUCTION_LABEL_OVERRIDES,
  MANUFACTURING_LABEL_OVERRIDES,
  NAV_SECTIONS,
  RETAIL_FAMILY_MODELS,
  navItemForPath,
  sitesVocabularyReplacesBranches,
  visibleSectionsFor,
} from '@/components/layout/navConfig';
import type { OrganisationCapability } from '@/lib/capabilities/profile';
import type { PlanTier } from '@/lib/billing/plans';

const en = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../i18n/locales/en.json', import.meta.url)), 'utf8'),
) as {
  navigation: { items: Record<string, string> };
  settings: { locations: Record<string, string> };
};

/**
 * Capability predicate in the shape `useOrganisationCapabilityVisibility`
 * hands to the nav layer, built from explicit capability sets that mirror
 * `deriveOrganisationCapabilityDefaults` for the model combinations under
 * test (union of MODEL_CAPABILITIES entries).
 */
const orgCaps = (caps: readonly OrganisationCapability[]) =>
  (capability: OrganisationCapability) => caps.includes(capability);

const CONSTRUCTION_CAPS: readonly OrganisationCapability[] = ['sales', 'inventory', 'services', 'construction'];
const MANUFACTURING_CAPS: readonly OrganisationCapability[] = ['sales', 'inventory', 'manufacturing'];
const RETAIL_CONSTRUCTION_CAPS: readonly OrganisationCapability[] = ['sales', 'pos', 'inventory', 'services', 'construction'];
const RETAIL_CAPS: readonly OrganisationCapability[] = ['sales', 'pos', 'inventory'];

function orgItems(
  caps: readonly OrganisationCapability[],
  models: readonly string[] | null,
  planTier: PlanTier = 'enterprise',
  role = 'owner',
) {
  return visibleSectionsFor(() => true, role, orgCaps(caps), planTier, models)
    .flatMap((section) => section.items);
}

describe('sites navigation (Organisation → Locations/Sites)', () => {
  it('lists /locations under Organisation directly after /branches, Growth-gated', () => {
    const section = NAV_SECTIONS.find((candidate) => candidate.labelKey === 'navigation.sections.organisation');
    const paths = section?.items.map((item) => item.path) ?? [];
    expect(paths).toContain('/locations');
    expect(paths.indexOf('/locations')).toBe(paths.indexOf('/branches') + 1);
    expect(navItemForPath('/locations')).toMatchObject({
      labelKey: 'navigation.items.locations',
      path: '/locations',
      minPlan: 'growth',
    });
    // The Branches item is the one flagged for removal in sites vocabulary.
    expect(navItemForPath('/branches')).toMatchObject({ hiddenWhenSitesReplaceBranches: true });
  });

  it('reads Sites through the shared construction/manufacturing override table', () => {
    expect(CONSTRUCTION_LABEL_OVERRIDES['navigation.items.locations']).toBe('navigation.items.sites');
    // One shared table — manufacturing does not keep its own copy.
    expect(MANUFACTURING_LABEL_OVERRIDES).toBe(CONSTRUCTION_LABEL_OVERRIDES);
    expect(en.navigation.items.locations).toBe('Locations');
    expect(en.navigation.items.sites).toBe('Sites');
  });

  it('removes Branches entirely for a pure construction business', () => {
    const items = orgItems(CONSTRUCTION_CAPS, ['CONSTRUCTION']);
    expect(items.some((item) => item.path === '/branches')).toBe(false);
    expect(items.find((item) => item.path === '/locations')?.labelKey).toBe('navigation.items.sites');
  });

  it('removes Branches entirely for a pure manufacturing business', () => {
    const items = orgItems(MANUFACTURING_CAPS, ['MANUFACTURING']);
    expect(items.some((item) => item.path === '/branches')).toBe(false);
    expect(items.find((item) => item.path === '/locations')?.labelKey).toBe('navigation.items.sites');
  });

  it('keeps Branches when a retail-family model runs alongside a sites vertical', () => {
    const mixed: ReadonlyArray<[readonly OrganisationCapability[], readonly string[]]> = [
      [RETAIL_CONSTRUCTION_CAPS, ['RETAIL', 'CONSTRUCTION']],
      [MANUFACTURING_CAPS, ['WHOLESALE', 'MANUFACTURING']],
      [CONSTRUCTION_CAPS, ['PRODUCT_SALES', 'CONSTRUCTION']],
    ];
    for (const [caps, models] of mixed) {
      const items = orgItems(caps, models);
      expect(items.some((item) => item.path === '/branches'), models.join('+')).toBe(true);
      expect(items.find((item) => item.path === '/locations')?.labelKey, models.join('+'))
        .toBe('navigation.items.sites');
    }
  });

  it('keeps Branches and the plain Locations label for a pure retail business', () => {
    const items = orgItems(RETAIL_CAPS, ['RETAIL']);
    expect(items.some((item) => item.path === '/branches')).toBe(true);
    expect(items.find((item) => item.path === '/locations')?.labelKey).toBe('navigation.items.locations');
  });

  it('hides /locations from payroll_manager exactly like /branches', () => {
    const items = orgItems(RETAIL_CAPS, ['RETAIL'], 'enterprise', 'payroll_manager');
    expect(items.some((item) => item.path === '/branches')).toBe(false);
    expect(items.some((item) => item.path === '/locations')).toBe(false);
  });

  it('locks (never removes) the Locations item below Growth', () => {
    const items = orgItems(RETAIL_CAPS, ['RETAIL'], 'starter');
    expect(items.find((item) => item.path === '/locations')).toMatchObject({ locked: true });
  });

  describe('sitesVocabularyReplacesBranches', () => {
    it('is true for a sites vertical even when operating models are absent', () => {
      expect(sitesVocabularyReplacesBranches(orgCaps(CONSTRUCTION_CAPS), ['CONSTRUCTION'])).toBe(true);
      expect(sitesVocabularyReplacesBranches(orgCaps(MANUFACTURING_CAPS), ['MANUFACTURING'])).toBe(true);
      // Profile not loaded yet / legacy business with no models recorded:
      // the capability alone drives the vocabulary.
      expect(sitesVocabularyReplacesBranches(orgCaps(CONSTRUCTION_CAPS), null)).toBe(true);
      expect(sitesVocabularyReplacesBranches(orgCaps(MANUFACTURING_CAPS), undefined)).toBe(true);
    });

    it('is false when a retail-family model is present', () => {
      expect(sitesVocabularyReplacesBranches(orgCaps(RETAIL_CONSTRUCTION_CAPS), ['RETAIL', 'CONSTRUCTION'])).toBe(false);
      expect(sitesVocabularyReplacesBranches(orgCaps(MANUFACTURING_CAPS), ['WHOLESALE', 'MANUFACTURING'])).toBe(false);
      expect(sitesVocabularyReplacesBranches(orgCaps(CONSTRUCTION_CAPS), ['PRODUCT_SALES', 'CONSTRUCTION'])).toBe(false);
    });

    it('is false without a sites vertical, and SERVICE_SALES is not retail-family', () => {
      expect(sitesVocabularyReplacesBranches(orgCaps(RETAIL_CAPS), ['RETAIL'])).toBe(false);
      expect(RETAIL_FAMILY_MODELS.has('SERVICE_SALES')).toBe(false);
      expect(RETAIL_FAMILY_MODELS.has('CONSTRUCTION')).toBe(false);
      // Services + manufacturing is still a pure sites business.
      expect(sitesVocabularyReplacesBranches(
        orgCaps([...MANUFACTURING_CAPS, 'services']),
        ['SERVICE_SALES', 'MANUFACTURING'],
      )).toBe(true);
    });
  });

  it('carries the Sites page copy in en.json and drops the dead settings tab key', () => {
    expect(en.settings.locations.title).toBe('Inventory Locations');
    expect(en.settings.locations.sitesTitle).toBe('Sites');
    expect(en.settings.locations.sitesDescription).toBeTruthy();
    expect('tabTitle' in en.settings.locations).toBe(false);
  });
});
