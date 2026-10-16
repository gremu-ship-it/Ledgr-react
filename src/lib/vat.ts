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
 *
 * EFFECTIVE-DATE RESOLUTION (owner approved 2026-10-16): the 30 vs 31 December
 * 2025 conflict is resolved to 1 JANUARY 2026 — the date this constant already
 * assumed. Evidence: the Value Added Tax (Amendment) Act 2025 (presidential
 * assent; rate raised 16.5% → 17.5%, effective 1 January 2026), the Malawi
 * Revenue Authority's instruction to VAT-registered operators to apply the new
 * rate from that date, and the 2025/26 Mid-Year Budget Review measure. One
 * secondary source states 31 December 2025; it is a minority position and is
 * NOT relied on. No historical document is restated: receipts value the tax
 * amount actually recorded on the supplier bill (see the construction cost-basis
 * command), so this constant is only ever used for NEW documents.
 *
 * OPEN DECISION (not a code change): the rate is a single constant, so a future
 * statutory change still requires the dated-rate schedule described in
 * docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md.
 */
export const VAT_STANDARD_RATE = 0.175;

/** Display percentage (17.5) — derive labels from this, never hard-code. */
export const VAT_STANDARD_RATE_PERCENT = VAT_STANDARD_RATE * 100;
