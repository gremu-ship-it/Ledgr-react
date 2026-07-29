/**
 * Tests for toStatementSide — the contra-account presentation fix.
 *
 * Ledger balances arrive on each account's natural side. Statement sections
 * present on ONE side, so contra accounts (normal balance opposite to the
 * section — Accumulated Depreciation against assets, Drawings against equity,
 * Sales/Purchase Returns against revenue/cost of sales) must be negated.
 * Before this was done, the SOFP added accumulated depreciation to PPE and
 * grew Total Assets every time depreciation was posted.
 */

import { describe, it, expect } from 'vitest';
import { toStatementSide } from '../statementPresentation';

describe('toStatementSide', () => {
  it('keeps ordinary accounts on their own side', () => {
    // Buildings (debit-normal) in an asset section; Trade Creditors
    // (credit-normal) in a liability section.
    expect(toStatementSide(100_000, 'debit', 'debit')).toBe(100_000);
    expect(toStatementSide(20_000, 'credit', 'credit')).toBe(20_000);
  });

  it('negates contra-asset accounts so they net against assets', () => {
    // Accumulated Depreciation holds a +10,000 natural (credit) balance; in
    // the debit-side asset section it must appear as (10,000).
    expect(toStatementSide(10_000, 'credit', 'debit')).toBe(-10_000);
  });

  it('negates contra-equity accounts so drawings reduce equity', () => {
    expect(toStatementSide(5_000, 'debit', 'credit')).toBe(-5_000);
  });

  it('negates contra-revenue and contra-cost accounts for the P&L', () => {
    // Sales Returns (debit-normal) against Revenue; Purchase Returns
    // (credit-normal) against Cost of Sales.
    expect(toStatementSide(3_000, 'debit', 'credit')).toBe(-3_000);
    expect(toStatementSide(1_500, 'credit', 'debit')).toBe(-1_500);
  });

  it('handles zero and negative natural balances without sign surprises', () => {
    expect(toStatementSide(0, 'credit', 'debit')).toBe(0);
    // A normally-debit account with a credit (negative natural) balance keeps
    // showing negative on its own side (e.g. an overdrawn bank account).
    expect(toStatementSide(-2_000, 'debit', 'debit')).toBe(-2_000);
  });
});
