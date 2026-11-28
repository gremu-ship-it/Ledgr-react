import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildNavigation,
  isNavigationItemActive,
  isNavigationPathActive,
  navigationPaths,
  resolveNavigationTarget,
  usesClinicalNavigation,
  type NavItem,
  type NavSection,
} from '../navigation';
import { getDefaultLandingPath } from '../../utils/workspaceRouting';

const en = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../i18n/locales/en.json', import.meta.url)),
    'utf8',
  ),
) as Record<string, unknown>;

const appSource = readFileSync(
  fileURLToPath(new URL('../../App.tsx', import.meta.url)),
  'utf8',
);

function lookup(key: string): unknown {
  return key.split('.').reduce<unknown>((value, part) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[part];
  }, en);
}

function declaredRoutePatterns(): RegExp[] {
  return [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map(([, route]) => {
    const normalized = route.replace(/\*/g, '.*').replace(/:[^/]+/g, '[^/]+');
    return new RegExp(`^${normalized}/?$`);
  });
}

function allPaths(nav: readonly NavSection[]): string[] {
  return navigationPaths(nav);
}

function allItems(nav: readonly NavSection[]): NavItem[] {
  return nav.flatMap((section) =>
    section.items.flatMap((item) => [item, ...(item.children ?? []).map((child) => ({
      key: child.key,
      labelKey: child.labelKey,
      defaultLabel: child.defaultLabel,
      path: child.path,
      icon: child.icon ?? item.icon,
    }))]),
  );
}

function itemByKey(nav: readonly NavSection[], key: string): NavItem | undefined {
  return allItems(nav).find((item) => item.key === key);
}

describe('Healthcare navigation & workspace architecture', () => {
  it('builds clinical 5-section navigation for enterprise healthcare businesses', () => {
    const nav = buildNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE'],
    });

    expect(nav.map((section) => section.key)).toEqual([
      'clinical_operations',
      'billing_claims',
      'clinic_financials',
      'compliance_accounting',
      'intelligence_support',
    ]);

    const clinicalItems = nav
      .find((section) => section.key === 'clinical_operations')
      ?.items.map((item) => item.path);
    expect(clinicalItems).toContain('/healthcare/pharmacy');
    expect(clinicalItems).toContain('/healthcare/lab');

    const paths = allPaths(nav);
    expect(paths).not.toContain('/inventory');
    expect(paths).not.toContain('/income');
    expect(paths).not.toContain('/invoices');
    expect(paths).toContain('/taxation');
    expect(paths).toContain('/banking');
    expect(paths).toContain('/assets');
    expect(paths).toContain('/expenses');
    expect(paths).toContain('/audit-logs');
    expect(paths).toContain('/settings/organization');
  });

  it('keeps contextual clinical labels in the five groups', () => {
    const items = buildNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE'],
    }).flatMap((section) => section.items)
      .filter((item) => Boolean(item.path));

    const byPath = new Map(items.map((item) => [item.path!, item]));
    expect(byPath.get('/assets')).toMatchObject({
      labelKey: 'nav.medicalEquipment',
      defaultLabel: 'Medical Equipment & Assets',
    });
    expect(byPath.get('/expenses')).toMatchObject({
      labelKey: 'nav.clinicExpenses',
      defaultLabel: 'Clinic Expenses',
    });
    expect(byPath.get('/audit-logs')).toMatchObject({
      labelKey: 'nav.complianceAudit',
      defaultLabel: 'Compliance Audit Log',
    });
    expect(byPath.get('/settings/organization')).toMatchObject({
      labelKey: 'nav.clinicalDepartments',
      defaultLabel: 'Clinical Departments',
    });
  });

  it('includes generic inventory for a healthcare + retail hybrid but never income', () => {
    const nav = buildNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE', 'RETAIL'],
    });
    const paths = allPaths(nav);

    expect(paths).toContain('/healthcare/pharmacy');
    expect(paths).toContain('/inventory');
    expect(paths).not.toContain('/income');
    expect(paths).not.toContain('/invoices');
  });

  it('keeps the standard ERP fallback outside enterprise healthcare', () => {
    const standard = buildNavigation({
      subscriptionPlan: 'pro',
      operatingModels: ['PRODUCT_SALES'],
    });
    expect(standard.map((section) => section.key)).toEqual([
      'core',
      'operations',
      'finance',
      'management',
    ]);
    const paths = allPaths(standard);
    expect(paths).toEqual(expect.arrayContaining([
      '/dashboard',
      '/income',
      '/invoices',
      '/inventory',
      '/banking',
      '/taxation',
      '/accounting',
      '/audit-logs',
    ]));
    expect(usesClinicalNavigation({
      subscriptionPlan: 'pro',
      operatingModels: ['HEALTHCARE'],
    })).toBe(false);
  });

  it('does not select the clinical shell when construction or manufacturing is active', () => {
    expect(usesClinicalNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE', 'CONSTRUCTION'],
    })).toBe(false);
    expect(usesClinicalNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE', 'MANUFACTURING'],
    })).toBe(false);
  });

  it('restores operational depth as nested accordion children', () => {
    const nav = buildNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE'],
    });
    const byKey = (key: string) => itemByKey(nav, key);

    expect(byKey('patient_billing_pos')).toMatchObject({
      labelKey: 'nav.patientBilling',
      children: [
        { key: 'patient_invoices', path: '/healthcare/billing' },
        { key: 'pos_terminal', path: '/pos' },
        { key: 'cash_drawer_shifts', path: '/pos?tab=shifts' },
      ],
    });
    expect(byKey('staff_payroll')).toMatchObject({
      labelKey: 'nav.staffPayroll',
      children: [
        { key: 'payroll_employees', path: '/payroll' },
        { key: 'payroll_payruns', path: '/payroll?tab=payruns' },
        { key: 'payroll_leave', path: '/payroll?tab=leave' },
      ],
    });
    expect(byKey('banking_pos_clearing')?.children?.map((child) => child.path)).toEqual([
      '/banking', '/banking?tab=statements', '/banking?tab=reconcile',
      '/banking?tab=deposits', '/banking?tab=currencies',
    ]);
    expect(byKey('general_ledger')?.children?.map((child) => child.path)).toEqual([
      '/accounting', '/accounting?tab=journals', '/accounting?tab=periods',
    ]);
    expect(byKey('taxation_statutory')?.children?.map((child) => child.path)).toEqual([
      '/taxation', '/taxation?tab=vat', '/taxation?tab=wht',
    ]);
    expect(byKey('financial_reports')?.children?.map((child) => child.path)).toEqual([
      '/reports?tab=trial-balance',
      '/reports?tab=pnl',
      '/reports?tab=balance-sheet',
      '/reports?tab=cash-flow',
      '/reports?tab=revenue',
      '/reports?tab=equity',
      '/reports?tab=branches',
    ]);

    // Accordion parents toggle state; they must not act as dead links.
    for (const parent of ['patient_billing_pos', 'staff_payroll', 'banking_pos_clearing', 'general_ledger', 'taxation_statutory', 'financial_reports']) {
      expect(byKey(parent)?.path).toBeUndefined();
      expect(byKey(parent)?.children?.length).toBeGreaterThan(0);
    }

    const subKeys = allItems(nav).filter((item) => item.labelKey.startsWith('nav.sub.')).map((item) => item.key);
    expect(new Set(subKeys).size).toBe(24);
    expect(subKeys).toEqual(expect.arrayContaining([
      'patient_invoices', 'pos_terminal', 'cash_drawer_shifts',
      'payroll_employees', 'payroll_payruns', 'payroll_leave',
      'banking_accounts', 'banking_statements', 'banking_reconciliation',
      'banking_deposits', 'banking_exchange_rates',
      'gl_accounts', 'gl_journals', 'gl_periods',
      'tax_overview', 'tax_vat', 'tax_wht',
      'rep_trial_balance', 'rep_pnl', 'rep_balance_sheet', 'rep_cash_flow',
      'rep_revenue', 'rep_equity', 'rep_branches',
    ]));
  });

  it('exposes all 7 financial reports in the reports dropdown', () => {
    const nav = buildNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE'],
    });

    const reportsSection = nav.find((section) => section.key === 'compliance_accounting');
    const reportsItem = reportsSection?.items.find((item) => item.key === 'financial_reports');

    expect(reportsItem?.children).toHaveLength(7);
    const paths = reportsItem?.children?.map((child) => child.path);

    expect(paths).toContain('/reports?tab=trial-balance');
    expect(paths).toContain('/reports?tab=pnl');
    expect(paths).toContain('/reports?tab=balance-sheet');
    expect(paths).toContain('/reports?tab=cash-flow');
    expect(paths).toContain('/reports?tab=revenue');
    expect(paths).toContain('/reports?tab=equity');
    expect(paths).toContain('/reports?tab=branches');

    expect(reportsItem?.children?.map((child) => child.labelKey)).toEqual([
      'nav.sub.trialBalance',
      'nav.sub.profitAndLoss',
      'nav.sub.balanceSheet',
      'nav.sub.cashFlow',
      'nav.sub.revenueBreakdown',
      'nav.sub.changesInEquity',
      'nav.sub.departmentPerformance',
    ]);
  });

  it('gives the standard ERP fallback the same operational sub-menus', () => {
    const nav = buildNavigation({
      subscriptionPlan: 'pro',
      operatingModels: ['PRODUCT_SALES'],
    });
    expect(itemByKey(nav, 'payroll')?.children).toHaveLength(3);
    expect(itemByKey(nav, 'banking')?.children).toHaveLength(5);
    expect(itemByKey(nav, 'accounting')?.children).toHaveLength(3);
    expect(itemByKey(nav, 'taxation')?.children).toHaveLength(3);
    expect(itemByKey(nav, 'reports')?.children).toHaveLength(7);
    expect(itemByKey(nav, 'patient_billing_pos')).toBeUndefined();
  });

  it('matches child destinations by canonical path and by exact query', () => {
    expect(isNavigationPathActive('/payroll?tab=leave', '/payroll', '?tab=leave')).toBe(true);
    expect(isNavigationPathActive('/payroll?tab=leave', '/payroll/leave', '')).toBe(true);
    expect(isNavigationPathActive('/payroll?tab=leave', '/payroll/pay-runs', '')).toBe(false);
    expect(isNavigationPathActive('/banking?tab=reconcile', '/bank-reconciliation/reconcile', '')).toBe(true);
    expect(isNavigationPathActive('/reports?tab=revenue', '/reports/revenue-breakdown', '')).toBe(true);
    expect(isNavigationPathActive('/reports?tab=pnl', '/reports', '?tab=pnl')).toBe(true);
    expect(isNavigationPathActive('/reports?tab=pnl', '/reports/profit-loss', '')).toBe(true);
    expect(isNavigationPathActive('/reports?tab=balance-sheet', '/reports/balance-sheet', '')).toBe(true);
    expect(isNavigationPathActive('/reports?tab=cash-flow', '/reports/cash-flow', '')).toBe(true);
    expect(isNavigationPathActive('/reports?tab=trial-balance', '/reports', '')).toBe(true);
    expect(isNavigationPathActive('/pos?tab=shifts', '/pos/shifts', '')).toBe(true);
    expect(isNavigationPathActive('/healthcare/billing', '/healthcare/billing', '?tab=anything')).toBe(false);
    expect(resolveNavigationTarget('/payroll?tab=payruns')).toBe('/payroll/pay-runs');
  });

  it('marks a parent active when a nested child is the current route', () => {
    const nav = buildNavigation({
      subscriptionPlan: 'enterprise',
      operatingModels: ['HEALTHCARE'],
    });
    expect(isNavigationItemActive(itemByKey(nav, 'staff_payroll')!, '/payroll/leave')).toBe(true);
    expect(isNavigationItemActive(itemByKey(nav, 'banking_pos_clearing')!, '/cash-deposits')).toBe(true);
    expect(isNavigationItemActive(itemByKey(nav, 'financial_reports')!, '/reports/trial-balance')).toBe(true);
    expect(isNavigationItemActive(itemByKey(nav, 'taxation_statutory')!, '/tax')).toBe(true);
    expect(isNavigationItemActive(itemByKey(nav, 'staff_payroll')!, '/healthcare')).toBe(false);
  });

  it('sources every navigation group and item label from en.json', () => {
    const nav = [
      ...buildNavigation({ subscriptionPlan: 'enterprise', operatingModels: ['HEALTHCARE'] }),
      ...buildNavigation({ subscriptionPlan: 'pro', operatingModels: ['PRODUCT_SALES'] }),
    ];
    for (const section of nav) {
      expect(typeof lookup(section.titleKey), section.titleKey).toBe('string');
      for (const item of allItems([section])) {
        expect(typeof lookup(item.labelKey), item.labelKey).toBe('string');
      }
    }
  });

  it('points every generated clinical and standard path at a declared route', () => {
    const routes = declaredRoutePatterns();
    const paths = [
      ...allPaths(buildNavigation({ subscriptionPlan: 'enterprise', operatingModels: ['HEALTHCARE', 'RETAIL'] })),
      ...allPaths(buildNavigation({ subscriptionPlan: 'pro', operatingModels: ['PRODUCT_SALES'] })),
    ];

    const unresolved = paths.filter((itemPath) => {
      const pathname = itemPath.split('?')[0];
      return !routes.some((route) => route.test(pathname));
    });
    expect(unresolved).toEqual([]);
  });
});

describe('Default healthcare landing', () => {
  it('resolves /healthcare as default landing for a pure healthcare business', () => {
    expect(getDefaultLandingPath({
      subscription_plan: 'enterprise',
      operating_models: ['HEALTHCARE'],
    })).toBe('/healthcare');
  });

  it('accepts the persisted plan_tier column and case-insensitive models', () => {
    expect(getDefaultLandingPath({
      plan_tier: 'enterprise',
      operating_models: ['healthcare'],
    })).toBe('/healthcare');
  });

  it('resolves /dashboard for standard businesses', () => {
    expect(getDefaultLandingPath({
      subscription_plan: 'pro',
      operating_models: ['PRODUCT_SALES'],
    })).toBe('/dashboard');
  });

  it('does not override a construction or manufacturing home', () => {
    expect(getDefaultLandingPath({
      subscription_plan: 'enterprise',
      operating_models: ['HEALTHCARE', 'CONSTRUCTION'],
    })).toBe('/dashboard');
    expect(getDefaultLandingPath({
      subscription_plan: 'enterprise',
      operating_models: ['HEALTHCARE', 'MANUFACTURING'],
    })).toBe('/dashboard');
  });
});
