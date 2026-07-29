/**
 * Presentation-side logic for financial-statement sections.
 *
 * Ledger balances are stored/computed on each account's *natural* side
 * (debit-normal accounts are positive when they hold a debit balance,
 * credit-normal accounts positive on a credit balance). That convention is
 * correct for liabilities/income presented on the credit side — but it breaks
 * down for CONTRA accounts, whose natural side is opposite to the section
 * they belong to:
 *
 *   Accumulated Depreciation (credit-normal) belongs in an asset (debit-side)
 *   section and must be NETTED against asset cost. Presented at natural side
 *   it was being ADDED: Non-Current Assets grew every time depreciation was
 *   posted, overstating Total Assets by 2× accumulated depreciation.
 *
 *   Drawings / Dividends (debit-normal) belongs in an equity (credit-side)
 *   section and must REDUCE equity, not increase it.
 *
 * `toStatementSide` performs that single flip. Kept pure and dependency-free
 * so it can be unit-tested without a database (same pattern as
 * inventoryValuation.ts).
 */

export type NormalBalance = 'debit' | 'credit';

/**
 * Narrows the loose DB string type for `accounts.normal_balance` (the DB
 * enum restricts values to 'debit' | 'credit') to the compile-time union.
 * Unknown/absent values fall back to 'debit', the natural side of asset and
 * expense accounts.
 */
export function asNormalBalance(value: string | null | undefined): NormalBalance {
  return value === 'credit' ? 'credit' : 'debit';
}

/**
 * Re-expresses a natural-side balance on the section's presentation side.
 * Accounts whose normal balance matches the section keep their sign; contra
 * accounts (normal balance opposite to the section) are negated so they net
 * against the section total.
 */
export function toStatementSide(
  naturalBalance: number,
  accountNormalBalance: NormalBalance,
  sectionNormalBalance: NormalBalance,
): number {
  if (accountNormalBalance === sectionNormalBalance) return naturalBalance;
  // Normalize -0: "-0 kwacha" would render oddly and breaks exact-equality
  // checks downstream.
  const flipped = -naturalBalance;
  return flipped === 0 ? 0 : flipped;
}
