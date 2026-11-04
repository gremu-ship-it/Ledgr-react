import { describe, expect, it } from 'vitest';
import { isItemLocked, navItemForPath, visibleSectionsFor } from '@/components/layout/navConfig';

describe('payroll leave navigation', () => {
  it('places Leave between Pay Runs and Tax Configuration in the Growth+ Payroll section', () => {
    const payrollSection = visibleSectionsFor(() => true, 'owner', () => true)
      .find((section) => section.labelKey === 'payroll.title');
    expect(payrollSection?.items.map((item) => item.path)).toEqual([
      '/payroll/employees', '/payroll/pay-runs', '/payroll/leave', '/payroll/tax-config',
    ]);
    expect(navItemForPath('/payroll/leave')).toMatchObject({
      labelKey: 'payroll.leave',
      minPlan: 'growth',
      requiresCapability: 'accounting_organisation',
      partnerFeature: 'payroll',
    });
    const leaveItem = navItemForPath('/payroll/leave');
    expect(leaveItem && isItemLocked(leaveItem, 'starter')).toBe(true);
    expect(leaveItem && isItemLocked(leaveItem, 'growth')).toBe(false);
  });
});
