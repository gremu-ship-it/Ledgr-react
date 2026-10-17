import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAV_SECTIONS, isItemLocked, navItemForPath, visibleSectionsFor } from '@/components/layout/navConfig';
import type { OrganisationCapability } from '@/lib/capabilities/profile';
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
