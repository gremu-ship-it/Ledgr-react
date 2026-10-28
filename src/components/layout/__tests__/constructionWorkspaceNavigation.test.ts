import { describe, expect, it } from 'vitest';
import { isItemLocked, navItemForPath, visibleSectionsFor } from '@/components/layout/navConfig';

describe('construction workspace navigation', () => {
  it('keeps the workspace available to authenticated roles but Enterprise-locks its navigation link', () => {
    const visiblePaths = visibleSectionsFor(() => true, 'sales_clerk')
      .flatMap((section) => section.items)
      .map((item) => item.path);
    const construction = navItemForPath('/construction')!;

    expect(visiblePaths).toContain('/construction');
    expect(visiblePaths).not.toContain('/dashboard');
    expect(construction).toMatchObject({
      labelKey: 'navigation.items.constructionWorkspace',
      allowAllAuthenticatedRoles: true,
      minPlan: 'enterprise',
    });
    expect(isItemLocked(construction, 'pro')).toBe(true);
    expect(isItemLocked(construction, 'enterprise')).toBe(false);
  });
});
