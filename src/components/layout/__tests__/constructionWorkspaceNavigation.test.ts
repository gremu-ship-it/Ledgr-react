import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, isItemLocked, navItemForPath, visibleSectionsFor } from '@/components/layout/navConfig';
import { PLAN_TIER_ORDER } from '@/lib/billing/plans';

describe('construction workspace navigation', () => {
  it('requires Enterprise at both section and item level and does not bypass role filtering', () => {
    const section = NAV_SECTIONS.find((candidate) => candidate.labelKey === 'navigation.sections.construction');
    const item = navItemForPath('/construction');
    expect(section).toBeDefined();
    expect(section?.minPlan).toBe('enterprise');
    expect(section?.items).toHaveLength(1);
    expect(section?.items.every((candidate) => candidate.minPlan === 'enterprise')).toBe(true);
    expect(item).toMatchObject({
      labelKey: 'navigation.items.constructionWorkspace',
      path: '/construction',
      minPlan: 'enterprise',
    });
    expect(item?.allowAllAuthenticatedRoles).toBeUndefined();

    const ownerPaths = visibleSectionsFor(() => true, 'owner')
      .flatMap((candidate) => candidate.items.map((navItem) => navItem.path));
    const salesClerkPaths = visibleSectionsFor(() => true, 'sales_clerk')
      .flatMap((candidate) => candidate.items.map((navItem) => navItem.path));
    expect(ownerPaths).toContain('/construction');
    expect(salesClerkPaths).not.toContain('/construction');
  });

  it.each(PLAN_TIER_ORDER)('%s locks Construction below Enterprise and unlocks it at Enterprise', (tier) => {
    const section = NAV_SECTIONS.find((candidate) => candidate.labelKey === 'navigation.sections.construction')!;
    const item = navItemForPath('/construction')!;
    expect(isItemLocked(item, tier, section.minPlan)).toBe(tier !== 'enterprise');
  });
});
