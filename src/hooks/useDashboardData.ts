import { useQuery, type QueryClient } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';

const financialStatementRepo = new FinancialStatementRepository(supabase);

export type DashboardDateAnchor = Date | string;

export interface DashboardPeriod {
  from: string;
  to: string;
  formattedPeriodLabel: string;
}

function dateFromAnchor(anchorDate?: DashboardDateAnchor): Date {
  if (!anchorDate) return new Date();
  if (anchorDate instanceof Date) return anchorDate;

  // Date-only strings represent local calendar dates, not UTC instants.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorDate);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const parsed = new Date(anchorDate);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

/**
 * Returns the calendar month containing the explicit anchor, or the current
 * local calendar month when no anchor is provided. The label is returned with
 * the dates so dashboard values can disclose the exact period they describe.
 */
export function getDashboardPeriod(
  anchorDate?: DashboardDateAnchor,
  locale = 'en-MW',
): DashboardPeriod {
  const ref = dateFromAnchor(anchorDate);
  const from = toLocalDateString(new Date(ref.getFullYear(), ref.getMonth(), 1));
  const to = toLocalDateString(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  const formattedPeriodLabel = new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
  }).format(ref);
  return { from, to, formattedPeriodLabel };
}

/**
 * Formats a Date's local calendar date as YYYY-MM-DD without routing through
 * UTC conversion. This avoids off-by-one day ranges in timezones ahead of UTC.
 */
function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns the last N calendar months relative to an anchor, oldest first. */
function getLastNMonths(
  n: number,
  anchorDate?: DashboardDateAnchor,
): { from: string; to: string; label: string }[] {
  const ref = dateFromAnchor(anchorDate);
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const from = toLocalDateString(new Date(d.getFullYear(), d.getMonth(), 1));
    const to = toLocalDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
    months.push({ from, to, label });
  }
  return months;
}

/** Consistent query-key definitions for dashboard data and pull-to-refresh. */
export const dashboardQueryKeys = {
  monthlyIncome: (businessId?: string, periodStart?: string) =>
    ['income', 'monthly', businessId, periodStart] as const,
  monthlyExpenses: (businessId?: string, periodStart?: string) =>
    ['expenses', 'monthly', businessId, periodStart] as const,
  monthlyProfitLoss: (businessId?: string, periodStart?: string) =>
    ['profit_loss', 'monthly_report', businessId, periodStart] as const,
  monthlyExpenseVat: (businessId?: string, periodStart?: string) =>
    ['expenses', 'monthly_vat', businessId, periodStart] as const,
  outstandingInvoices: (businessId?: string) =>
    ['invoices', 'outstanding', businessId] as const,
  incomeExpenseTrend: (businessId?: string, months = 6, periodStart?: string) =>
    ['trend', businessId, months, periodStart] as const,
  reorderAlerts: (businessId?: string) => ['reorder_alerts', businessId] as const,
};

/** Active data families rendered in the global dashboard, including mobile. */
export function getDashboardRefreshQueryKeys(
  businessId?: string,
  months = 6,
  anchorDate?: DashboardDateAnchor,
) {
  const period = getDashboardPeriod(anchorDate);
  return [
    dashboardQueryKeys.monthlyIncome(businessId, period.from),
    dashboardQueryKeys.monthlyExpenses(businessId, period.from),
    dashboardQueryKeys.monthlyProfitLoss(businessId, period.from),
    dashboardQueryKeys.monthlyExpenseVat(businessId, period.from),
    dashboardQueryKeys.outstandingInvoices(businessId),
    dashboardQueryKeys.incomeExpenseTrend(businessId, months, period.from),
    dashboardQueryKeys.reorderAlerts(businessId),
  ] as const;
}

/** Invalidate and actively refetch every query family shown on the dashboard. */
export async function refreshDashboardQueries(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
  businessId?: string,
  anchorDate?: DashboardDateAnchor,
): Promise<void> {
  if (!businessId) return;
  const queryKeys = getDashboardRefreshQueryKeys(businessId, 6, anchorDate);
  await Promise.all([
    ...queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey, refetchType: 'active' })),
    queryClient.invalidateQueries({ queryKey: ['dashboard'], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['journal', 'recent', businessId], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['pos', 'owner-analytics', businessId], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['vat', 'summary', businessId], refetchType: 'active' }),
    queryClient.invalidateQueries({ queryKey: ['paye', 'summary', businessId], refetchType: 'active' }),
  ]);
}

/** Draft and void expenses must not contribute to dashboard totals or trends. */
export function isDashboardExpenseIncluded(status: string | null | undefined): boolean {
  return status !== 'void' && status !== 'draft';
}

/**
 * FIX: journal_entries.period_id is not currently populated by any
 * entry-creation path. Lock detection therefore checks entry_date against
 * locked periods' date ranges directly, matching the database trigger logic.
 */
function isDateInLockedPeriod(
  entryDate: string,
  lockedRanges: { period_start: string; period_end: string }[],
): boolean {
  return lockedRanges.some(
    (r) => entryDate >= r.period_start && entryDate <= r.period_end,
  );
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useMonthlyIncome(businessId?: string, anchorDate?: DashboardDateAnchor) {
  const period = getDashboardPeriod(anchorDate);
  return useQuery({
    queryKey: dashboardQueryKeys.monthlyIncome(businessId, period.from),
    queryFn: () => repos.income.getTotals(businessId!, period.from, period.to),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

export function useMonthlyProfitLossReport(businessId?: string, anchorDate?: DashboardDateAnchor) {
  const period = getDashboardPeriod(anchorDate);
  return useQuery({
    queryKey: dashboardQueryKeys.monthlyProfitLoss(businessId, period.from),
    queryFn: () => financialStatementRepo.getProfitOrLoss(businessId!, period.from, period.to),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

export function useMonthlyExpenses(businessId?: string, anchorDate?: DashboardDateAnchor) {
  const period = getDashboardPeriod(anchorDate);
  return useQuery({
    queryKey: dashboardQueryKeys.monthlyExpenses(businessId, period.from),
    queryFn: async () => {
      const rows = await repos.expense.findByDateRange(businessId!, period.from, period.to);
      return rows
        .filter((r) => isDashboardExpenseIncluded(r.status))
        .reduce((sum, r) => sum + Number(r.functional_amount ?? r.total_amount), 0);
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

/**
 * Sum of input VAT on eligible expenses for the same explicit/current calendar
 * month used by the dashboard income and P&L figures.
 */
export function useMonthlyExpenseVat(businessId?: string, anchorDate?: DashboardDateAnchor) {
  const period = getDashboardPeriod(anchorDate);
  return useQuery({
    queryKey: dashboardQueryKeys.monthlyExpenseVat(businessId, period.from),
    queryFn: async () => {
      const rows = await repos.expense.findByDateRange(businessId!, period.from, period.to);
      return rows
        .filter((r) => isDashboardExpenseIncluded(r.status))
        .reduce((sum, r) => sum + Number(r.vat_amount) * Number(r.exchange_rate || 1), 0);
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

export function useOutstandingInvoices(businessId?: string) {
  return useQuery({
    queryKey: dashboardQueryKeys.outstandingInvoices(businessId),
    queryFn: async () => {
      const rows = await repos.income.findOutstanding(businessId!);
      const total = rows.reduce(
        (sum, r) => sum + (r.amount_due !== null
          ? Number(r.amount_due) * Number(r.exchange_rate || 1)
          : Number(r.functional_amount ?? r.total_amount) - (Number(r.amount_paid) * Number(r.exchange_rate || 1))),
        0,
      );
      return { total, count: rows.length };
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

export function useIncomeExpenseTrend(
  businessId?: string,
  months = 6,
  anchorDate?: DashboardDateAnchor,
) {
  const period = getDashboardPeriod(anchorDate);
  return useQuery({
    queryKey: dashboardQueryKeys.incomeExpenseTrend(businessId, months, period.from),
    queryFn: async () => {
      const buckets = getLastNMonths(months, anchorDate ?? period.from);
      const results = await Promise.all(
        buckets.map(async ({ from, to, label }) => {
          const [incomeTotals, expenseRows] = await Promise.all([
            repos.income.getTotals(businessId!, from, to),
            repos.expense.findByDateRange(businessId!, from, to),
          ]);

          const expenses = expenseRows
            .filter((r) => isDashboardExpenseIncluded(r.status))
            .reduce((sum, r) => sum + Number(r.functional_amount ?? r.total_amount), 0);

          return { month: label, income: incomeTotals.totalAmount, expenses };
        }),
      );

      return results;
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });
}

export function useRecentJournalEntries(businessId?: string, limit = 10) {
  return useQuery({
    queryKey: ['journal', 'recent', businessId, limit],
    queryFn: async () => {
      const ref = new Date();
      const to = toLocalDateString(ref);
      const from = toLocalDateString(new Date(ref.getFullYear() - 1, ref.getMonth(), ref.getDate()));

      const [rows, periods] = await Promise.all([
        repos.journal.findByBusinessAndDateRange(businessId!, from, to),
        repos.period.findByBusiness(businessId!),
      ]);

      const lockedRanges = periods
        .filter((p) => p.is_closed)
        .map((p) => ({ period_start: p.period_start, period_end: p.period_end }));

      return rows.slice(0, limit).map((entry) => ({
        ...entry,
        isLocked: isDateInLockedPeriod(entry.entry_date, lockedRanges),
      }));
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}
