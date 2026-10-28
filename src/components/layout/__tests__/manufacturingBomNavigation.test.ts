import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS } from '@/components/layout/navConfig';

const manufacturingItems = NAV_SECTIONS.flatMap((section) =>
  section.items
    .filter((item) => item.path === '/manufacturing' || item.path.startsWith('/manufacturing/'))
    .map((item) => ({ item, section })),
);

describe('manufacturing navigation gate readiness', () => {
  it('does not expose a Manufacturing nav surface before its Enterprise-gated routes exist', () => {
    // No Manufacturing section/items exist on this branch. When introduced,
    // the nav section and every child item must declare minPlan: 'enterprise'.
    expect(manufacturingItems).toHaveLength(0);
    expect(manufacturingItems.every(({ item, section }) =>
      item.minPlan === 'enterprise' && section.minPlan === 'enterprise'
    )).toBe(true);
  });
});
