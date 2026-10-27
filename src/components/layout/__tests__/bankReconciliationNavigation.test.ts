import { describe, expect, it } from 'vitest';
import { navItemForPath, planMeetsMin } from '@/components/layout/navConfig';
import { isPathAllowedForRole } from '@/hooks/usePermissions';

describe('bank reconciliation routes and navigation', () => {
  it('advertises the setup and statements pages behind the Growth capability', () => {
    for (const path of ['/bank-reconciliation/accounts', '/bank-reconciliation/statements']) {
      const item = navItemForPath(path);
      expect(item).toMatchObject({ path, minPlan: 'growth', requiresCapability: 'bank_reconciliation' });
    }
    expect(planMeetsMin('starter', 'growth')).toBe(false);
    expect(planMeetsMin('growth', 'growth')).toBe(true);
    expect(planMeetsMin('pro', 'growth')).toBe(true);
  });

  it('allows treasury managers and denies payroll managers on all new bank pages', () => {
    const paths = [
      '/bank-reconciliation/accounts',
      '/bank-reconciliation/statements',
      '/bank-reconciliation/statements/statement-1',
      '/bank-reconciliation/reconcile/statement-1',
    ];
    for (const path of paths) {
      expect(isPathAllowedForRole('treasury_manager', path)).toBe(true);
      expect(isPathAllowedForRole('payroll_manager', path)).toBe(false);
    }
  });
});
