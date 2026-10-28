import { describe, expect, it } from 'vitest';
import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import {
  balanceSheetDateForPreset,
  computeBalanceSheet,
  hasActiveRetainedEarningsBalance,
  hasUnclosedProfitVariance,
  isValidAsOfDate,
  priorYearAsOfDate,
} from './balanceSheet';

function row(
  account_code: string,
  account_type: string,
  balance: number,
  account_name = `Account ${account_code}`,
  level = 0,
): TrialBalanceRow {
  return {
    account_id: `id-${account_code}`,
    account_code,
    account_name,
    account_type,
    parent_account_id: null,
    total_debit: Math.max(balance, 0),
    total_credit: Math.max(-balance, 0),
    balance,
    level,
  };
}

describe('computeBalanceSheet', () => {
  it('shows debit-balance assets as positive and credit-balance assets in parentheses', () => {
    const report = computeBalanceSheet([
      row('1110', 'asset', 125),
      row('1121', 'asset', -25, 'Overdrawn current account'),
    ], false);
    expect(report.assets.find((section) => section.key === 'currentAssets')?.accounts.map((account) => account.amount))
      .toEqual([125, -25]);
    expect(report.totalAssets).toBe(100);
  });

  it('flips credit-normal liability and equity balances, preserving debit contra balances', () => {
    const report = computeBalanceSheet([
      row('2110', 'liability', -30),
      row('2115', 'liability', 5, 'Supplier debit balance'),
      row('3110', 'equity', -40, "Owner's Capital"),
      row('3600', 'equity', 3, 'Owner Drawings'),
    ], false);
    expect(report.liabilities[0].accounts.map((account) => account.amount)).toEqual([30, -5]);
    expect(report.equity[0].accounts.map((account) => account.amount)).toEqual([40, -3]);
    expect(report.totalLiabilities).toBe(25);
    expect(report.totalEquity).toBe(37);
  });

  it('classifies sections by actual account type and the chart code prefixes', () => {
    const report = computeBalanceSheet([
      row('1110', 'asset', 100),
      row('1201', 'asset', 20, 'WIP Inventory'),
      row('2110', 'liability', -30),
      row('2210', 'liability', -10),
      row('3110', 'equity', -80, "Owner's Capital"),
      row('4110', 'income', -500),
      row('1115', 'income', -900, 'Wrongly typed revenue'),
      row('1000', 'unknown', 70, 'Legacy asset header'),
    ], false);
    expect(report.assets.map((section) => [section.key, section.total])).toEqual([
      ['currentAssets', 100],
      ['nonCurrentAssets', 90],
    ]);
    expect(report.liabilities.map((section) => [section.key, section.total])).toEqual([
      ['currentLiabilities', 30],
      ['nonCurrentLiabilities', 10],
    ]);
    expect(report.equity[0].total).toBe(80);
    expect(report.assets.flatMap((section) => section.accounts).map((account) => account.accountCode))
      .not.toContain('1115');
  });

  it('computes retained earnings from cumulative P&L when retained accounts have no posted balance', () => {
    const rows = [
      row('1110', 'asset', 100),
      row('2110', 'liability', -30),
      row('3110', 'equity', -60, "Owner's Capital"),
      row('3200', 'equity', 0, 'Retained Earnings'),
      row('4110', 'income', -20, 'Sales'),
      row('6100', 'expense', 10, 'Operating expenses'),
    ];
    expect(hasActiveRetainedEarningsBalance(rows)).toBe(false);
    const report = computeBalanceSheet(rows, false);
    expect(report.retainedEarnings).toBe(10);
    expect(report.totalEquity).toBe(70);
    expect(report.isBalanced).toBe(true);
  });

  it('uses an active explicit retained earnings account without double-counting P&L', () => {
    const report = computeBalanceSheet([
      row('1110', 'asset', 95),
      row('2110', 'liability', -30),
      row('3110', 'equity', -60, "Owner's Capital"),
      row('3120', 'equity', -5, 'Retained Earnings'),
      row('4110', 'income', -20, 'Sales'),
      row('6100', 'expense', 10, 'Operating expenses'),
    ], true);
    expect(report.retainedEarnings).toBe(5);
    expect(report.totalEquity).toBe(65);
    expect(report.isBalanced).toBe(true);
  });

  it('reports discrepancy and imbalance outside the rounding tolerance', () => {
    const report = computeBalanceSheet([
      row('1110', 'asset', 100),
      row('2110', 'liability', -30),
      row('3110', 'equity', -60, "Owner's Capital"),
    ], false);
    expect(report.discrepancy).toBe(10);
    expect(report.isBalanced).toBe(false);
  });

  it('returns zero totals and a balanced equation for empty input', () => {
    const report = computeBalanceSheet([], false);
    expect(report.totalAssets).toBe(0);
    expect(report.totalLiabilities).toBe(0);
    expect(report.totalEquity).toBe(0);
    expect(report.retainedEarnings).toBe(0);
    expect(report.discrepancy).toBe(0);
    expect(report.isBalanced).toBe(true);
  });

  it('preserves account hierarchy depth and sorts codes numerically', () => {
    const report = computeBalanceSheet([
      row('1142', 'asset', 5, 'Work In Progress', 2),
      row('1141', 'asset', 10, 'Raw Materials', 1),
    ], false);
    expect(report.assets[0].accounts.map(({ accountCode, level }) => [accountCode, level]))
      .toEqual([['1141', 1], ['1142', 2]]);
  });
});

describe('balanceSheetDateForPreset', () => {
  const now = new Date(2026, 9, 26, 12);

  it('returns month, quarter, and prior-year closing dates', () => {
    expect(balanceSheetDateForPreset('thisMonth', now)).toBe('2026-10-31');
    expect(balanceSheetDateForPreset('lastMonth', now)).toBe('2026-09-30');
    expect(balanceSheetDateForPreset('thisQuarter', now)).toBe('2026-12-31');
    expect(balanceSheetDateForPreset('lastYear', now)).toBe('2025-12-31');
  });
});

describe('priorYearAsOfDate', () => {
  it('returns the matching date in the prior year and clamps leap day to February 28', () => {
    expect(priorYearAsOfDate('2026-10-31')).toBe('2025-10-31');
    expect(priorYearAsOfDate('2024-02-29')).toBe('2023-02-28');
    expect(priorYearAsOfDate('invalid')).toBe('');
  });
});

describe('hasUnclosedProfitVariance', () => {
  it('flags a balance-sheet discrepancy matching active cumulative profit only', () => {
    expect(hasUnclosedProfitVariance(10, 10, true)).toBe(true);
    expect(hasUnclosedProfitVariance(-10, -10, true)).toBe(true);
    expect(hasUnclosedProfitVariance(10.5, 10, true)).toBe(false);
    expect(hasUnclosedProfitVariance(10, 10, false)).toBe(false);
    expect(hasUnclosedProfitVariance(0, 0, true)).toBe(false);
  });
});

describe('isValidAsOfDate', () => {
  it('rejects invalid or malformed calendar dates', () => {
    expect(isValidAsOfDate('2026-02-30')).toBe(false);
    expect(isValidAsOfDate('2026/02/28')).toBe(false);
    expect(isValidAsOfDate('2024-02-29')).toBe(true);
  });
});
