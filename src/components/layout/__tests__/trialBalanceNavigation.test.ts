import { describe, expect, it } from 'vitest';
import { isItemLocked, navItemForPath } from '../navConfig';
import { isPathAllowedForRole } from '@/hooks/usePermissions';

describe('Trial Balance navigation', () => {
  it('is visible across verticals and gated to Growth+', () => {
    const item = navItemForPath('/reports/trial-balance');
    expect(item).toBeDefined();
    expect(item?.labelKey).toBe('nav.reports.trialBalance');
    expect(item?.minPlan).toBe('growth');
    expect(item?.requiresOrgCapability).toBeUndefined();
    expect(item?.partnerFeature).toBeUndefined();
    expect(isItemLocked(item!, 'starter')).toBe(true);
    expect(isItemLocked(item!, 'growth')).toBe(false);
    expect(isItemLocked(item!, 'enterprise')).toBe(false);
  });

  it('preserves report role restrictions on the new deep route', () => {
    expect(isPathAllowedForRole('owner', '/reports/trial-balance')).toBe(true);
    expect(isPathAllowedForRole('manager', '/reports/trial-balance')).toBe(true);
    expect(isPathAllowedForRole('payroll_manager', '/reports/trial-balance')).toBe(false);
    expect(isPathAllowedForRole('supervisor', '/reports/trial-balance')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/reports/trial-balance')).toBe(false);
  });
});
