// @vitest-environment jsdom
/**
 * The demo's first screen.
 *
 * `/demo/enter` drops a visitor straight onto `/dashboard`, so every query
 * DashboardPage fans out into has to resolve against the demo client. One
 * unsupported filter shows up as an error card; one silently ignored `.order()`
 * shows up as last month's numbers. Both would be the first thing a prospect
 * sees, and neither is reachable from the query-builder unit tests, which
 * exercise the client directly rather than through the repositories and hooks
 * the page actually uses.
 *
 * These render the real hooks — no stubs — in demo mode.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import {
  useMonthlyIncome,
  useMonthlyProfitLossReport,
  useMonthlyExpenses,
  useMonthlyExpenseVat,
  useOutstandingInvoices,
  useIncomeExpenseTrend,
  useRecentJournalEntries,
} from '@/hooks/useDashboardData';
import { enterDemoMode, exitDemoMode } from '@/lib/demo/session';
import { clearDemoData } from '@/lib/demo/store';
import { DEMO_BUSINESS_ID } from '@/lib/demo/constants';
import { repos } from '@/lib/repositories';

/** Retry off, cache off: each hook should be observed resolving on its own. */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/**
 * All seven queries DashboardPage issues, keyed by hook name so a failure
 * names the hook instead of reporting "false is not true".
 */
function useDashboardQueries() {
  return {
    useMonthlyIncome: useMonthlyIncome(DEMO_BUSINESS_ID),
    useMonthlyProfitLossReport: useMonthlyProfitLossReport(DEMO_BUSINESS_ID),
    useMonthlyExpenses: useMonthlyExpenses(DEMO_BUSINESS_ID),
    useMonthlyExpenseVat: useMonthlyExpenseVat(DEMO_BUSINESS_ID),
    useOutstandingInvoices: useOutstandingInvoices(DEMO_BUSINESS_ID),
    useIncomeExpenseTrend: useIncomeExpenseTrend(DEMO_BUSINESS_ID),
    useRecentJournalEntries: useRecentJournalEntries(DEMO_BUSINESS_ID),
  };
}

const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;

beforeAll(async () => {
  await enterDemoMode();
});

afterEach(cleanup);

afterAll(() => {
  exitDemoMode();
  clearDemoData();
  window.localStorage.clear();
});

describe('dashboard data in demo mode', () => {
  it('resolves every query the page issues', async () => {
    const { result } = renderHook(useDashboardQueries, { wrapper: createWrapper() });

    await waitFor(
      () => {
        expect(
          Object.values(result.current).every((q) => !q.isPending),
          'a dashboard query never settled',
        ).toBe(true);
      },
      { timeout: 20_000 },
    );

    const failures = Object.entries(result.current)
      .filter(([, q]) => q.isError)
      .map(([hook, q]) => `${hook}: ${q.error instanceof Error ? q.error.message : String(q.error)}`);
    expect(failures).toEqual([]);
  });

  it('anchors the reporting month to the newest record, not the oldest', async () => {
    const { result } = renderHook(useDashboardQueries, { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.useMonthlyProfitLossReport.isSuccess).toBe(true), {
      timeout: 20_000,
    });

    const pl = result.current.useMonthlyProfitLossReport.data;
    expect(pl, 'P&L report missing').toBeDefined();

    // fetchLatestRecordDate() reads rows[0] and trusts the repository's
    // DESC ordering. If the demo client dropped the .order(), the anchor would
    // resolve to the seeded books' first month (January) and every KPI on the
    // dashboard would quietly report a period from most of a year ago.
    const age = Date.now() - new Date(pl!.periodStart).getTime();
    expect(age, `periodStart ${pl!.periodStart} is too old — anchor resolved to the wrong end`).toBeLessThan(SIXTY_DAYS);
    expect(age).toBeGreaterThan(-SIXTY_DAYS);
  });

  it('reports the seeded trading figures, not zeros', async () => {
    const { result } = renderHook(useDashboardQueries, { wrapper: createWrapper() });
    await waitFor(
      () => expect(Object.values(result.current).every((q) => q.isSuccess)).toBe(true),
      { timeout: 20_000 },
    );
    const q = result.current;

    const income = q.useMonthlyIncome.data;
    expect(income, 'income totals missing').toBeDefined();
    expect(income?.totalAmount ?? NaN).toBeGreaterThan(0);
    expect(income?.vatAmount ?? NaN).toBeGreaterThan(0);

    const pl = q.useMonthlyProfitLossReport.data;
    expect(pl?.totalRevenue ?? NaN).toBeGreaterThan(0);
    expect(pl?.grossProfit ?? NaN).toBeGreaterThan(0);
    // The demo books trade profitably; a zero here means the expense or
    // revenue side of the ledger failed to load rather than that it broke even.
    expect(pl?.netProfit ?? NaN).toBeGreaterThan(0);

    expect(q.useMonthlyExpenses.data ?? NaN).toBeGreaterThan(0);
    expect(q.useMonthlyExpenseVat.data ?? NaN).toBeGreaterThan(0);

    const outstanding = q.useOutstandingInvoices.data;
    expect(outstanding, 'outstanding invoices missing').toBeDefined();
    expect(outstanding?.count ?? NaN).toBeGreaterThan(0);
    expect(outstanding?.total ?? NaN).toBeGreaterThan(0);
  });

  it('returns a six-month trend in chronological order', async () => {
    const { result } = renderHook(useDashboardQueries, { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.useIncomeExpenseTrend.isSuccess).toBe(true), {
      timeout: 20_000,
    });

    const trend = result.current.useIncomeExpenseTrend.data;
    expect(trend, 'trend missing').toBeDefined();
    expect(trend).toHaveLength(6);
    for (const bucket of trend ?? []) {
      expect(bucket.month).toBeTruthy();
      expect(Number.isFinite(bucket.income)).toBe(true);
      expect(Number.isFinite(bucket.expenses)).toBe(true);
    }
    // The chart reads left to right, so the buckets must not come back
    // reversed or unordered.
    expect(trend?.some((b) => b.income > 0), 'no month in the trend has income').toBe(true);
  });

  it('returns the newest journals first, with the period-lock flag computed', async () => {
    const { result } = renderHook(useDashboardQueries, { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.useRecentJournalEntries.isSuccess).toBe(true), {
      timeout: 20_000,
    });

    const entries = result.current.useRecentJournalEntries.data;
    expect(entries, 'journal entries missing').toBeDefined();
    expect(entries!.length).toBeGreaterThan(0);
    expect(entries!.length).toBeLessThanOrEqual(10);

    // findByBusinessAndDateRange orders entry_date DESC and the hook takes the
    // first ten, so "recent transactions" depends on the demo client honouring
    // .order(). An ignored order clause still returns ten valid-looking rows —
    // just the oldest ones in the range.
    const dates = entries!.map((e) => e.entry_date);
    expect(dates).toEqual([...dates].sort().reverse());

    // isLocked comes from joining accounting_periods and testing each entry's
    // date against the closed ranges; it must be a real boolean or the
    // RecentTransactions list renders every row as editable.
    for (const entry of entries!) {
      expect(typeof entry.isLocked).toBe('boolean');
    }

    // Not vacuously false: the seeded books do contain closed periods, and the
    // ten newest entries simply fall outside them (they are this month's).
    const periods = await repos.period.findByBusiness(DEMO_BUSINESS_ID);
    const closed = periods.filter((p) => p.is_closed);
    expect(closed.length, 'demo books should contain closed periods').toBeGreaterThan(0);
    for (const entry of entries!) {
      const inClosed = closed.some((p) => entry.entry_date >= p.period_start && entry.entry_date <= p.period_end);
      expect(inClosed, `entry ${entry.entry_date} is inside a closed period but isLocked=${entry.isLocked}`).toBe(entry.isLocked);
    }
  });
});
