import { describe, expect, it } from 'vitest';
import { isItemLocked, navItemForPath, NAV_SECTIONS } from '../navConfig';
import { isPathAllowedForRole } from '@/hooks/usePermissions';

describe('Reports navigation', () => {
  it('keeps the seven historical statements and analytic reports in Reports', () => {
    const section = NAV_SECTIONS.find((candidate) => candidate.labelKey === 'navigation.sections.reports');
    expect(section?.items.map((item) => item.path)).toEqual([
      '/reports/trial-balance',
      '/reports/profit-loss',
      '/reports/balance-sheet',
      '/reports/cash-flow',
      '/reports/revenue-breakdown',
      '/reports/changes-in-equity',
      '/reports/branch-performance',
    ]);
  });

  it('places planning, depreciation, FX revaluation, and cash forecast in their workflow sections', () => {
    const sectionFor = (path: string) => NAV_SECTIONS.find((section) => section.items.some((item) => item.path === path));
    expect(sectionFor('/reports/budgets')?.labelKey).toBe('navigation.sections.planning');
    expect(sectionFor('/reports/depreciation')?.labelKey).toBe('navigation.sections.assetsCapital');
    expect(sectionFor('/reports/fx-revaluation')?.labelKey).toBe('navigation.sections.accounting');
    expect(sectionFor('/cash-forecast')?.labelKey).toBe('navigation.sections.banking');
    expect(sectionFor('/reports/depreciation')?.items.find((item) => item.path === '/reports/depreciation')?.path).toBe('/reports/depreciation');
  });

  it('keeps Settings out of the main navigation while preserving canonical Taxation access', () => {
    expect(NAV_SECTIONS.some((section) => section.labelKey === 'navigation.sections.settings')).toBe(false);
    expect(navItemForPath('/settings')).toBeUndefined();
    expect(navItemForPath('/tax')?.labelKey).toBe('navigation.items.taxConfiguration');
  });

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

  it('adds Cash Forecast as a cross-vertical Growth+ report', () => {
    const item = navItemForPath('/cash-forecast');
    expect(item).toBeDefined();
    expect(item?.labelKey).toBe('nav.reports.cashForecast');
    expect(item?.minPlan).toBe('growth');
    expect(item?.requiresOrgCapability).toBeUndefined();
    expect(item?.requiredOperatingModels).toBeUndefined();
    expect(isItemLocked(item!, 'starter')).toBe(true);
    expect(isItemLocked(item!, 'growth')).toBe(false);
    expect(isItemLocked(item!, 'enterprise')).toBe(false);
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
    expect(isPathAllowedForRole('owner', '/cash-forecast')).toBe(true);
    expect(isPathAllowedForRole('manager', '/cash-forecast')).toBe(true);
    expect(isPathAllowedForRole('payroll_manager', '/cash-forecast')).toBe(false);
    expect(isPathAllowedForRole('supervisor', '/cash-forecast')).toBe(false);
    expect(isPathAllowedForRole('cashier', '/cash-forecast')).toBe(false);
  });
});
