/**
 * Malawi VAT — single source of truth for the standard rate.
 *
 * Phase 10 A-05: the rate 0.175 was hard-coded in four places
 * (IncomePage, ExpensesPage ×2, QuickExpenseMobile). Centralising it here
 * means a rate change (statutory instrument) is a one-line edit plus a
 * rebuild, and the UI labels derived from it can never drift from the
 * calculation.
 *
 * RATE VERIFICATION (2026-08-16): Malawi's standard VAT rate is 17.5%,
 * effective January 2026 (increased from 16.5% in the 2025/26 budget).
 * The product rate therefore matches the current statutory rate — no value
 * change made in Phase 10, only centralisation.
 */
export const VAT_STANDARD_RATE = 0.175;

/** Display percentage (17.5) — derive labels from this, never hard-code. */
export const VAT_STANDARD_RATE_PERCENT = VAT_STANDARD_RATE * 100;

/** Calendar-month label used as tax_returns.period_label. */
export function vatPeriodLabel(periodStart: string): string {
  return periodStart.slice(0, 7);
}

/**
 * Net VAT payable, never negative (a credit period is stored as amount_due = 0
 * plus the input/output tax columns). Rounded to the nearest tambala.
 */
export function computeVatNetDue(outputTax: number, inputTax: number): number {
  return Math.max(Math.round((Number(outputTax) - Number(inputTax)) * 100) / 100, 0);
}

/**
 * MRA VAT 3 due date: 25th of the month following `periodEnd`.
 * Matches TaxReturnRepository / generate-vat-returns — keep both on this helper.
 */
export function vatDueDateForPeriodEnd(periodEnd: string): string {
  const d = new Date(periodEnd);
  d.setMonth(d.getMonth() + 1, 25);
  return d.toISOString().slice(0, 10);
}

/** Prior calendar month in the local timezone (cron runs in Africa/Blantyre). */
export function previousCalendarMonth(now = new Date()): { periodStart: string; periodEnd: string } {
  const periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    periodStart: periodStart.toISOString().slice(0, 10),
    periodEnd: periodEnd.toISOString().slice(0, 10),
  };
}
