import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NAV_SECTIONS, isItemLocked, navItemForPath, visibleSectionsFor } from '@/components/layout/navConfig';
import type { OrganisationCapability } from '@/lib/capabilities/profile';

const en = JSON.parse(readFileSync(fileURLToPath(new URL('../../../i18n/locales/en.json', import.meta.url)), 'utf8')) as {
  navigation: { sections: Record<string, string>; items: Record<string, string> };
};

/** Sidebar paths for one role, with the organisation predicate wired like the app. */
function pathsFor(role: string, constructionEnabled: boolean) {
  return visibleSectionsFor(
    () => true,
    role,
    (capability: OrganisationCapability) => (capability === 'construction' ? constructionEnabled : true),
  ).flatMap((section) => section.items.map((item) => item.path));
}

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

  it('is an Enterprise child gated by the organisation profile, not a role-free link', () => {
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

  it('is visible to an Enterprise construction business', () => {
    expect(pathsFor('owner', true)).toContain('/construction');
    expect(pathsFor('admin', true)).toContain('/construction');
  });

  it('is absent for an Enterprise business that does not do construction', () => {
    expect(pathsFor('owner', false)).not.toContain('/construction');
    // ...while the rest of the Supply Chain section is unaffected.
    expect(pathsFor('owner', false)).toContain('/products');
  });

  it('is never available below Enterprise, whatever the profile says', () => {
    const item = navItemForPath('/construction')!;
    for (const tier of ['free', 'starter', 'growth', 'pro'] as const) {
      expect(isItemLocked(item, tier), tier).toBe(true);
    }
    expect(isItemLocked(item, 'enterprise')).toBe(false);
  });

  it('removes the previous sales_clerk-on-Free visibility', () => {
    // The item used to be role-free and plan-free. Neither is true any more, so a
    // sales clerk does not see it even on a construction profile.
    expect(pathsFor('sales_clerk', true)).not.toContain('/construction');
    expect(pathsFor('stock_clerk', true)).not.toContain('/construction');
    expect(navItemForPath('/construction')?.allowAllAuthenticatedRoles).not.toBe(true);
  });
});
