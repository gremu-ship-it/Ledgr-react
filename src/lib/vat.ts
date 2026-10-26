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
 * EFFECTIVE-DATED CONFIGURATION (delivered 2026-10-16): the single constant is
 * still what a NEW document uses when the business has not configured its own
 * dated rate, and it is now the "supported default" in the schedule resolver
 * (src/lib/tax/taxConfiguration.ts). The business's own dated periods live in
 * public.tax_configurations and take precedence for the date of the document;
 * migration 20261022000000_effective_dated_tax_configurations.sql makes those
 * periods unambiguous (one period per tax code per date) and requires a
 * non-zero rate to cite its evidence.
 *
 * The constants below are the evidence a rate resolver is allowed to rely on.
 * They are NOT used to compute a tax amount for a stored document, and they are
 * never used to restate history: a document is valued from the tax amount it
 * actually records. See docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md
 * §5 item 7 for the delivered schedule.
 */
export const VAT_STANDARD_RATE = 0.175;

/** Display percentage (17.5) — derive labels from this, never hard-code. */
export const VAT_STANDARD_RATE_PERCENT = VAT_STANDARD_RATE * 100;

/**
 * The first date the 17.5% standard rate applies. 1 January 2026 is the
 * owner-resolved effective date (see the resolution note above); a resolver
 * must not answer for an earlier date from this constant — that is the
 * "unsupported" case, and a business that needs an earlier rate records its own
 * period with its own evidence.
 */
export const VAT_STANDARD_RATE_EFFECTIVE_FROM = '2026-01-01';

/**
 * The evidence reference carried by the supported 17.5% rate — the same text a
 * business stores in tax_configurations.mra_reference when it adopts it, so a
 * stored rate and the supported default cite the same source.
 */
export const VAT_STANDARD_RATE_EVIDENCE_REFERENCE =
  'VAT Act Cap 42:02 as amended (2025) — standard rate 17.5% from 2026-01-01';

/**
 * The standard rate this one replaced, for display only: it tells a reader what
 * changed. The start of the 16.5% period is NOT evidenced in this product (the
 * sources record the end of it — 31 December 2025 — not the beginning), so no
 * code may apply this figure to a document, and there is deliberately no
 * `_EFFECTIVE_FROM` companion for it.
 */
export const VAT_STANDARD_RATE_PREVIOUS_PERCENT = 16.5;
