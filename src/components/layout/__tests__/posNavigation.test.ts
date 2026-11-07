import { describe, expect, it } from 'vitest';
import { isItemLocked, navItemForPath, visibleSectionsFor } from '../navConfig';

describe('POS navigation and plan tiers', () => {
  it('keeps every POS destination exclusive to retail operating models', () => {
    for (const path of ['/pos', '/pos/registers', '/pos/shifts']) {
      expect(navItemForPath(path)?.requiredOperatingModels).toEqual(['RETAIL']);
    }
    const nonRetailPaths = visibleSectionsFor(() => true, 'owner', () => true, 'enterprise', ['PROJECT_BASED'])
      .flatMap((section) => section.items.map((item) => item.path));
    expect(nonRetailPaths).not.toContain('/pos');
    expect(nonRetailPaths).not.toContain('/pos/registers');
    expect(nonRetailPaths).not.toContain('/pos/shifts');
  });

  it('offers one-register POS management on Starter and gates multi-register selection and shift history to Growth', () => {
    const pos = navItemForPath('/pos')!;
    const registers = navItemForPath('/pos/registers')!;
    const shifts = navItemForPath('/pos/shifts')!;
    expect(pos.minPlan).toBe('starter');
    expect(registers.minPlan).toBe('starter');
    expect(shifts.minPlan).toBe('growth');
    expect(isItemLocked(pos, 'starter')).toBe(false);
    expect(isItemLocked(registers, 'starter')).toBe(false);
    expect(isItemLocked(shifts, 'starter')).toBe(true);
    expect(isItemLocked(registers, 'growth')).toBe(false);
    expect(isItemLocked(shifts, 'growth')).toBe(false);
  });
});
