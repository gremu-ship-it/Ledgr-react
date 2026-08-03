/**
 * Realised FX gain/loss arithmetic (IAS 21) for settlement postings.
 *
 * Pure calculation with no database or Supabase imports so it stays unit-testable
 * without env vars at import time — same convention as `depreciation.ts`.
 *
 * Used by `journalService.ts` when a payment settles a foreign-currency
 * invoice or expense at a rate different from the rate the receivable/payable
 * was booked at.
 */

/**
 * Realised FX gain/loss for a settlement, per IAS 21.
 *
 * @param settledOriginalAmount - the portion of the original-currency
 *   amount being settled by this payment (usually payment.original_amount).
 * @param bookedRate - the exchange_rate the receivable/payable was
 *   originally recorded at (invoice.exchange_rate or expense.exchange_rate).
 * @param settlementRate - the exchange_rate in effect at settlement
 *   (from ExchangeRateService.getRate at the payment date).
 * @param direction - 'receivable' (invoice/AR) or 'payable' (expense/AP).
 *   The sign of gain/loss is opposite between the two: a stronger foreign
 *   currency at settlement is a GAIN on a receivable but a LOSS on a
 *   payable (you owe more functional currency to clear the same debt).
 *
 * @returns positive = gain (credit 4230), negative = loss (debit 7300),
 *   zero = no FX movement (rates matched, or same-currency transaction).
 */
export function calculateRealisedFx(
  settledOriginalAmount: number,
  bookedRate: number,
  settlementRate: number,
  direction: 'receivable' | 'payable',
): number {
  const bookedFunctional = settledOriginalAmount * bookedRate;
  const settledFunctional = settledOriginalAmount * settlementRate;
  const delta = settledFunctional - bookedFunctional;
  return direction === 'receivable' ? delta : -delta;
}
