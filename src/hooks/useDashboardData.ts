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

/**
 * FIX: journal_entries.period_id is not currently populated by any
 * entry-creation path (confirmed via DB query: 0 of 21 existing entries
 * have period_id set). Lock detection must therefore check entry_date
 * against locked periods' date ranges directly — matching the DB trigger
 * fn_check_period_not_locked's own logic — rather than relying on the
 * period_id FK, which cannot be trusted for existing or future entries.
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

/**
 * Sum of input VAT (vat_amount) on expenses for the current month, anchored
 * the same way as useMonthlyExpenses. Used alongside useMonthlyIncome's
 * output vatAmount to compute net VAT payable/accrued:
 *   net VAT = output VAT (sales) - input VAT (purchases)
 *
 * Added as a separate hook rather than changing useMonthlyExpenses' return
 * shape, since that hook is already consumed elsewhere (e.g. MobileDashboard)
 * expecting a plain number.
 */
export function useMonthlyExpenseVat(businessId?: string) {
  return useQuery({
    queryKey: ['expenses', 'monthly_vat', businessId],
    queryFn: async () => {
      const anchor = await fetchLatestRecordDate(businessId!);
      const { from, to } = getMonthRange(anchor);
      const rows = await repos.expense.findByDateRange(businessId!, from, to);
      return rows
        .filter((r) => r.status !== 'void')
        .reduce((sum, r) => sum + Number(r.vat_amount), 0);
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