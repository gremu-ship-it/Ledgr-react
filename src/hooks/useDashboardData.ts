import { useQuery } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Returns the calendar-month range for the most recent month that has data.
 * We derive "today" from the DB records rather than the browser clock so that
 * dev/test environments with future-dated records still display correctly.
 * Falls back to browser date if no anchor is supplied.
 */
function getMonthRange(anchorDate?: string): { from: string; to: string } {
  const ref = anchorDate ? new Date(anchorDate) : new Date();
  const from = new Date(ref.getFullYear(), ref.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);
  return { from, to };
}

/**
 * Returns the last N calendar months relative to the given anchor date,
 * oldest first. Anchor defaults to browser date.
 */
function getLastNMonths(
  n: number,
  anchorDate?: string,
): { from: string; to: string; label: string }[] {
  const ref = anchorDate ? new Date(anchorDate) : new Date();
  const months = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1);
    const from = new Date(d.getFullYear(), d.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0)
      .toISOString()
      .slice(0, 10);
    const label = d.toLocaleString('default', { month: 'short', year: '2-digit' });
    months.push({ from, to, label });
  }
  return months;
}

/**
 * Fetch the most recent record date across invoices and expenses so we can
 * anchor all date ranges to actual data rather than the browser clock.
 * This prevents the dashboard showing zeros when dev/test data is future-dated.
 */
async function fetchLatestRecordDate(businessId: string): Promise<string | undefined> {
  const [latestInvoice, latestExpense] = await Promise.all([
    repos.income.findByDateRange(businessId, '2000-01-01', '2099-12-31').then((rows) =>
      rows.length ? rows[0].issue_date : undefined,
    ),
    repos.expense.findByDateRange(businessId, '2000-01-01', '2099-12-31').then((rows) =>
      rows.length ? rows[0].expense_date : undefined,
    ),
  ]);

  const dates = [latestInvoice, latestExpense].filter(Boolean) as string[];
  if (dates.length === 0) return undefined;
  return dates.sort().reverse()[0]; // most recent
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useMonthlyIncome(businessId?: string) {
  return useQuery({
    queryKey: ['income', 'monthly', businessId],
    queryFn: async () => {
      const anchor = await fetchLatestRecordDate(businessId!);
      const { from, to } = getMonthRange(anchor);
      return repos.income.getTotals(businessId!, from, to);
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

export function useMonthlyExpenses(businessId?: string) {
  return useQuery({
    queryKey: ['expenses', 'monthly', businessId],
    queryFn: async () => {
      const anchor = await fetchLatestRecordDate(businessId!);
      const { from, to } = getMonthRange(anchor);
      const rows = await repos.expense.findByDateRange(businessId!, from, to);
      return rows
        .filter((r) => r.status !== 'void')
        .reduce((sum, r) => sum + Number(r.total_amount), 0);
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

export function useOutstandingInvoices(businessId?: string) {
  return useQuery({
    queryKey: ['invoices', 'outstanding', businessId],
    queryFn: async () => {
      const rows = await repos.income.findOutstanding(businessId!);
      const total = rows.reduce(
        (sum, r) => sum + (r.amount_due !== null
          ? Number(r.amount_due)
          : Number(r.total_amount) - Number(r.amount_paid)),
        0,
      );
      return { total, count: rows.length };
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

export function useIncomeExpenseTrend(businessId?: string, months = 6) {
  return useQuery({
    queryKey: ['trend', businessId, months],
    queryFn: async () => {
      const anchor = await fetchLatestRecordDate(businessId!);
      const buckets = getLastNMonths(months, anchor);

      const results = await Promise.all(
        buckets.map(async ({ from, to, label }) => {
          const [incomeTotals, expenseRows] = await Promise.all([
            repos.income.getTotals(businessId!, from, to),
            repos.expense.findByDateRange(businessId!, from, to),
          ]);

          const expenses = expenseRows
            .filter((r) => r.status !== 'void')
            .reduce((sum, r) => sum + Number(r.total_amount), 0);

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
      const anchor = await fetchLatestRecordDate(businessId!);
      const ref = anchor ? new Date(anchor) : new Date();
      const to = ref.toISOString().slice(0, 10);
      const from = new Date(ref.getFullYear() - 1, ref.getMonth(), ref.getDate())
        .toISOString()
        .slice(0, 10);

      const [rows, periods] = await Promise.all([
        repos.journal.findByBusinessAndDateRange(businessId!, from, to),
        repos.period.findByBusiness(businessId!),
      ]);

      const lockedPeriodIds = new Set(
        periods.filter((p) => p.is_closed).map((p) => p.id),
      );

      return rows.slice(0, limit).map((entry) => ({
        ...entry,
        isLocked: entry.period_id ? lockedPeriodIds.has(entry.period_id) : false,
      }));
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}