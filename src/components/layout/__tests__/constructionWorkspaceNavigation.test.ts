import { describe, expect, it } from 'vitest';
import { navItemForPath, visibleSectionsFor } from '@/components/layout/navConfig';

describe('construction workspace navigation', () => {
  it('shows the authenticated memory-only workspace without changing other role-filtered links', () => {
    const visiblePaths = visibleSectionsFor(() => true, 'sales_clerk')
      .flatMap((section) => section.items)
      .map((item) => item.path);

    expect(visiblePaths).toContain('/construction');
    expect(visiblePaths).not.toContain('/dashboard');
    expect(navItemForPath('/construction')).toMatchObject({
      labelKey: 'navigation.items.constructionWorkspace',
      allowAllAuthenticatedRoles: true,
    });
  });
});
