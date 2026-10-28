import { describe, expect, it } from 'vitest';
import { isItemLocked, navItemForPath } from '../navConfig';
import { isPathAllowedForRole } from '@/hooks/usePermissions';

describe('Reports navigation', () => {
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

  it('adds Profit & Loss beside Trial Balance and gates the item to Growth+', () => {
    const item = navItemForPath('/reports/profit-loss');
    expect(item).toBeDefined();
    expect(item?.labelKey).toBe('nav.reports.profitLoss');
    expect(item?.minPlan).toBe('growth');
    expect(item?.requiresOrgCapability).toBeUndefined();
    expect(item?.partnerFeature).toBeUndefined();
    expect(isItemLocked(item!, 'starter')).toBe(true);
    expect(isItemLocked(item!, 'growth')).toBe(false);
  });

  it('adds Balance Sheet beside other reports and gates it to Growth+', () => {
    const item = navItemForPath('/reports/balance-sheet');
    expect(item).toBeDefined();
    expect(item?.labelKey).toBe('nav.reports.balanceSheet');
    expect(item?.minPlan).toBe('growth');
    expect(item?.requiresOrgCapability).toBeUndefined();
    expect(item?.partnerFeature).toBeUndefined();
    expect(isItemLocked(item!, 'starter')).toBe(true);
    expect(isItemLocked(item!, 'growth')).toBe(false);
  });

  it('adds Cash Flow beside other reports and gates it to Growth+', () => {
    const item = navItemForPath('/reports/cash-flow');
    expect(item).toBeDefined();
    expect(item?.labelKey).toBe('nav.reports.cashFlow');
    expect(item?.minPlan).toBe('growth');
    expect(item?.requiresOrgCapability).toBeUndefined();
    expect(item?.partnerFeature).toBeUndefined();
    expect(isItemLocked(item!, 'starter')).toBe(true);
    expect(isItemLocked(item!, 'growth')).toBe(false);
  });

  it.each([
    ['/reports/changes-in-equity', 'navigation.items.changesInEquity'],
    ['/reports/revenue-breakdown', 'navigation.items.revenueBreakdown'],
    ['/reports/branch-performance', 'navigation.items.branchPerformance'],
  ])('adds %s as a standalone Growth+ report', (path, labelKey) => {
    const item = navItemForPath(path);
    expect(item).toBeDefined();
    expect(item?.labelKey).toBe(labelKey);
    expect(item?.path).toBe(path);
    expect(item?.minPlan).toBe('growth');
    expect(isItemLocked(item!, 'starter')).toBe(true);
    expect(isItemLocked(item!, 'growth')).toBe(false);
    expect(isItemLocked(item!, 'enterprise')).toBe(false);
  });

  it('keeps the new standalone reports within the existing report role scope', () => {
    for (const path of ['/reports/changes-in-equity', '/reports/revenue-breakdown', '/reports/branch-performance']) {
      expect(isPathAllowedForRole('owner', path)).toBe(true);
      expect(isPathAllowedForRole('manager', path)).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', path)).toBe(false);
      expect(isPathAllowedForRole('supervisor', path)).toBe(false);
      expect(isPathAllowedForRole('cashier', path)).toBe(false);
    }
  });

  it('preserves report role restrictions on the new deep route', () => {
    expect(isPathAllowedForRole('owner', '/reports/trial-balance')).toBe(true);
    expect(isPathAllowedForRole('manager', '/reports/trial-balance')).toBe(true);
    expect(isPathAllowedForRole('payroll_manager', '/reports/trial-balance')).toBe(false);
    expect(isPathAllowedForRole('supervisor', '/reports/trial-balance')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/reports/trial-balance')).toBe(false);
    expect(isPathAllowedForRole('owner', '/reports/profit-loss')).toBe(true);
    expect(isPathAllowedForRole('manager', '/reports/profit-loss')).toBe(true);
    expect(isPathAllowedForRole('payroll_manager', '/reports/profit-loss')).toBe(false);
    expect(isPathAllowedForRole('supervisor', '/reports/profit-loss')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/reports/profit-loss')).toBe(false);
    expect(isPathAllowedForRole('owner', '/reports/balance-sheet')).toBe(true);
    expect(isPathAllowedForRole('manager', '/reports/balance-sheet')).toBe(true);
    expect(isPathAllowedForRole('payroll_manager', '/reports/balance-sheet')).toBe(false);
    expect(isPathAllowedForRole('supervisor', '/reports/balance-sheet')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/reports/balance-sheet')).toBe(false);
    expect(isPathAllowedForRole('owner', '/reports/cash-flow')).toBe(true);
    expect(isPathAllowedForRole('manager', '/reports/cash-flow')).toBe(true);
    expect(isPathAllowedForRole('payroll_manager', '/reports/cash-flow')).toBe(false);
    expect(isPathAllowedForRole('supervisor', '/reports/cash-flow')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/reports/cash-flow')).toBe(false);
  });
});
