import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dashboardQueryKeys,
  getDashboardPeriod,
  getDashboardRefreshQueryKeys,
  isDashboardExpenseIncluded,
  refreshDashboardQueries,
} from '@/hooks/useDashboardData';

afterEach(() => {
  vi.useRealTimers();
});

describe('dashboard period and query helpers', () => {
  it('defaults to the current local calendar month and exposes a formatted label', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 6, 12));

    expect(getDashboardPeriod(undefined, 'en')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      formattedPeriodLabel: 'November 2026',
    });
  });

  it('uses an explicit date-only anchor as a local calendar date', () => {
    expect(getDashboardPeriod('2026-02-17', 'en')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      formattedPeriodLabel: 'February 2026',
    });
  });

  it('excludes draft and void expenses consistently while retaining other statuses', () => {
    expect(isDashboardExpenseIncluded('draft')).toBe(false);
    expect(isDashboardExpenseIncluded('void')).toBe(false);
    expect(isDashboardExpenseIncluded('paid')).toBe(true);
    expect(isDashboardExpenseIncluded('pending')).toBe(true);
    expect(isDashboardExpenseIncluded(undefined)).toBe(true);
  });

  it('builds the active dashboard refresh keys from the hook query-key definitions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 6, 12));
    const businessId = 'business-1';

    expect(getDashboardRefreshQueryKeys(businessId)).toEqual([
      dashboardQueryKeys.monthlyIncome(businessId, '2026-11-01'),
      dashboardQueryKeys.monthlyExpenses(businessId, '2026-11-01'),
      dashboardQueryKeys.monthlyProfitLoss(businessId, '2026-11-01'),
      dashboardQueryKeys.monthlyExpenseVat(businessId, '2026-11-01'),
      dashboardQueryKeys.outstandingInvoices(businessId),
      dashboardQueryKeys.incomeExpenseTrend(businessId, 6, '2026-11-01'),
      dashboardQueryKeys.reorderAlerts(businessId),
    ]);
  });

  it('invalidates and actively refetches every dashboard query on mobile refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 6, 12));
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);

    await refreshDashboardQueries({ invalidateQueries } as never, 'business-1');

    expect(invalidateQueries).toHaveBeenCalledTimes(12);
    for (const [filters] of invalidateQueries.mock.calls) {
      expect(filters).toMatchObject({ refetchType: 'active' });
    }
    expect(invalidateQueries.mock.calls.map(([filters]) => filters.queryKey)).toEqual([
      ...getDashboardRefreshQueryKeys('business-1'),
      ['dashboard'],
      ['journal', 'recent', 'business-1'],
      ['pos', 'owner-analytics', 'business-1'],
      ['vat', 'summary', 'business-1'],
      ['paye', 'summary', 'business-1'],
    ]);
  });
});
