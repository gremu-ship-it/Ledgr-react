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
