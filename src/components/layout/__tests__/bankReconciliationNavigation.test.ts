import { describe, expect, it } from 'vitest';
import { NAV_SECTIONS, navItemForPath, planMeetsMin } from '@/components/layout/navConfig';
import { isPathAllowedForRole } from '@/hooks/usePermissions';

describe('bank reconciliation routes and navigation', () => {
  it('includes Cash Deposits alongside standalone bank reconciliation entry points', () => {
    const section = NAV_SECTIONS.find((candidate) => candidate.labelKey === 'navigation.sections.banking');
    expect(section?.items.map((item) => item.path)).toEqual([
      '/cash-deposits',
      '/bank-reconciliation/accounts',
      '/bank-reconciliation/statements',
      '/bank-reconciliation/reconcile',
      '/cash-forecast',
    ]);
  });

  it('exposes Cash Deposits to Starter+ while keeping bank reconciliation on Growth+', () => {
    expect(navItemForPath('/cash-deposits')).toMatchObject({ path: '/cash-deposits', minPlan: 'starter', requiresCapability: 'core_accounting' });
    expect(planMeetsMin('starter', 'starter')).toBe(true);
    for (const path of [
      '/bank-reconciliation/accounts',
      '/bank-reconciliation/statements',
      '/bank-reconciliation/reconcile',
    ]) {
      const item = navItemForPath(path);
      expect(item).toMatchObject({ path, minPlan: 'growth', requiresCapability: 'bank_reconciliation' });
    }
    expect(planMeetsMin('starter', 'growth')).toBe(false);
    expect(planMeetsMin('growth', 'growth')).toBe(true);
    expect(planMeetsMin('pro', 'growth')).toBe(true);
  });

  it('allows treasury managers and denies payroll managers on cash-deposit and bank pages', () => {
    const paths = [
      '/cash-deposits',
      '/cash-deposits/new',
      '/bank-reconciliation/accounts',
      '/bank-reconciliation/statements',
      '/bank-reconciliation/reconcile',
      '/bank-reconciliation/statements/statement-1',
      '/bank-reconciliation/reconcile/statement-1',
    ];
    for (const path of paths) {
      expect(isPathAllowedForRole('treasury_manager', path)).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', path)).toBe(false);
    }
  });
});
