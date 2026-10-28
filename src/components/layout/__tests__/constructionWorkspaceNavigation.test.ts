import { describe, it, expect } from 'vitest';
import {
  isItemLocked,
  navItemForPath,
  resolveNavItemLabelKey,
  visibleSectionsFor,
} from '@/components/layout/navConfig';

describe('construction workspace navigation', () => {
  it('requires Enterprise and respects role filtering', () => {
    const salesClerkPaths = visibleSectionsFor(() => true, 'sales_clerk')
      .flatMap((section) => section.items)
      .map((item) => item.path);
    const ownerPaths = visibleSectionsFor(() => true, 'owner')
      .flatMap((section) => section.items)
      .map((item) => item.path);
    const constructionItem = navItemForPath('/construction');

    expect(salesClerkPaths).not.toContain('/construction');
    expect(ownerPaths).toContain('/construction');
    expect(constructionItem).toMatchObject({
      labelKey: 'navigation.items.constructionWorkspace',
      minPlan: 'enterprise',
    });
    expect(constructionItem?.allowAllAuthenticatedRoles).toBeUndefined();
    expect(isItemLocked(constructionItem!, 'pro')).toBe(true);
    expect(isItemLocked(constructionItem!, 'enterprise')).toBe(false);
  });

  it('uses construction inventory labels for PROJECT_BASED businesses only', () => {
    const products = navItemForPath('/products')!;
    const warehouse = navItemForPath('/warehouse')!;
    const transfers = navItemForPath('/transfers')!;

    expect(resolveNavItemLabelKey(products, ['PROJECT_BASED'])).toBe('navigation.items.materials');
    expect(resolveNavItemLabelKey(warehouse, ['PROJECT_BASED'])).toBe('navigation.items.siteStores');
    expect(resolveNavItemLabelKey(transfers, ['PROJECT_BASED'])).toBe('navigation.items.materialsTransfer');

    expect(resolveNavItemLabelKey(products, ['RETAIL'])).toBe('navigation.items.products');
    expect(resolveNavItemLabelKey(warehouse, ['RETAIL'])).toBe('navigation.items.warehouse');
    expect(resolveNavItemLabelKey(transfers, ['RETAIL'])).toBe('navigation.items.transfers');
    expect(resolveNavItemLabelKey(products, ['RETAIL', 'PROJECT_BASED'])).toBe('navigation.items.materials');
  });
});
