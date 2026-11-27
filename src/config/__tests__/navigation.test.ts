import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildNavigation, usesClinicalNavigation } from '../navigation';
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

function allPaths(nav: ReturnType<typeof buildNavigation>): string[] {
  return nav.flatMap((section) => section.items.map((item) => item.path));
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
    }).flatMap((section) => section.items);

    const byPath = new Map(items.map((item) => [item.path, item]));
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

  it('sources every navigation group and item label from en.json', () => {
    const nav = [
      ...buildNavigation({ subscriptionPlan: 'enterprise', operatingModels: ['HEALTHCARE'] }),
      ...buildNavigation({ subscriptionPlan: 'pro', operatingModels: ['PRODUCT_SALES'] }),
    ];
    for (const section of nav) {
      expect(typeof lookup(section.titleKey), section.titleKey).toBe('string');
      for (const item of section.items) {
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
