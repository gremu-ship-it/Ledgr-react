import { describe, expect, it } from 'vitest';
import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import { computePnl, computeVariance } from './pnl';
import { previousPeriod } from './periods';

function row(
  account_code: string,
  account_type: string,
  balance: number,
  name = `Account ${account_code}`,
): TrialBalanceRow {
  return {
    account_id: `id-${account_code}`,
    account_code,
    account_name: name,
    account_type,
    parent_account_id: null,
    total_debit: Math.max(balance, 0),
    total_credit: Math.max(-balance, 0),
    balance,
    level: 0,
  };
}

describe('computePnl', () => {
  it('flips credit-normal revenue balances to positive amounts and preserves debit contra-revenue', () => {
    const report = computePnl([
      row('4114', 'income', -1250, 'Contract Revenue'),
      row('4120', 'income', 50, 'Sales Returns'),
    ]);
    const revenue = report.sections.find((section) => section.key === 'revenue')!;
    expect(revenue.accounts.map((account) => account.amount)).toEqual([1250, -50]);
    expect(revenue.total).toBe(1200);
  });

  it('shows debit expense and COGS balances as positive, while credit adjustments reduce those totals', () => {
    const report = computePnl([
      row('5100', 'expense', 300),
      row('5180', 'expense', -75),
      row('6100', 'expense', 125),
    ]);
    expect(report.sections.find((section) => section.key === 'cogs')?.total).toBe(225);
    expect(report.sections.find((section) => section.key === 'operatingExpenses')?.total).toBe(125);
  });

  it('computes gross profit, operating income, and net income from actual account types and prefixes', () => {
    const report = computePnl([
      row('4114', 'income', -1000),
      row('5100', 'expense', 300),
      row('5180', 'expense', -50),
      row('6100', 'expense', 100),
      row('4210', 'income', -25),
      row('7192', 'expense', 10),
    ]);
    expect(report.sections.find((section) => section.key === 'revenue')?.total).toBe(1000);
    expect(report.sections.find((section) => section.key === 'cogs')?.total).toBe(250);
    expect(report.sections.find((section) => section.key === 'operatingExpenses')?.total).toBe(100);
    expect(report.sections.find((section) => section.key === 'otherIncome')?.total).toBe(25);
    expect(report.sections.find((section) => section.key === 'otherExpenses')?.total).toBe(10);
    expect(report.computedLines.map((line) => line.amount)).toEqual([750, 650, 665]);
    expect(report.netIncome).toBe(665);
  });

  it('uses account-code fallback for legacy rows with unknown account types', () => {
    const report = computePnl([
      row('4000', 'unknown', -40),
      row('5000', 'unknown', 20),
      row('6000', 'unknown', 8),
      row('7000', 'unknown', -7),
      row('8000', 'unknown', 3),
      row('1000', 'asset', 500),
      row('4110', 'asset', 700),
    ]);
    expect(report.sections.map((section) => section.total)).toEqual([40, 20, 8, 7, 3]);
    const includedCodes = report.sections.flatMap((section) => section.accounts).map((account) => account.accountCode);
    expect(includedCodes).not.toContain('1000');
    expect(includedCodes).not.toContain('4110');
  });

  it('returns a zero-valued statement for empty input', () => {
    const report = computePnl([]);
    expect(report.sections).toHaveLength(5);
    expect(report.sections.every((section) => section.total === 0 && section.accounts.length === 0)).toBe(true);
    expect(report.netIncome).toBe(0);
    expect(report.computedLines.map((line) => line.amount)).toEqual([0, 0, 0]);
  });
});

describe('computeVariance', () => {
  it('computes positive and negative absolute and relative variance', () => {
    expect(computeVariance(125, 100)).toEqual({ absolute: 25, percentage: 25 });
    expect(computeVariance(75, 100)).toEqual({ absolute: -25, percentage: -25 });
    expect(computeVariance(75, -100)).toEqual({ absolute: 175, percentage: 175 });
  });

  it('returns null percentage when prior is zero and zero variance when periods match', () => {
    expect(computeVariance(30, 0)).toEqual({ absolute: 30, percentage: null });
    expect(computeVariance(100, 100)).toEqual({ absolute: 0, percentage: 0 });
  });
});

describe('previousPeriod', () => {
  it('returns the prior calendar quarter and an equal-length prior custom range', () => {
    expect(previousPeriod({ from: '2026-07-01', to: '2026-09-30' }, 'thisQuarter'))
      .toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(previousPeriod({ from: '2024-03-01', to: '2024-03-31' }, 'custom'))
      .toEqual({ from: '2024-01-30', to: '2024-02-29' });
  });

  it('compares month, last-month, and year presets to matching calendar periods', () => {
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-26' }, 'thisMonth'))
      .toEqual({ from: '2026-09-01', to: '2026-09-26' });
    expect(previousPeriod({ from: '2026-10-01', to: '2026-10-31' }, 'lastMonth'))
      .toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(previousPeriod({ from: '2026-01-01', to: '2026-10-26' }, 'yearToDate'))
      .toEqual({ from: '2025-01-01', to: '2025-10-26' });
  });

  it('fails closed on malformed or reversed ranges', () => {
    expect(previousPeriod({ from: '2026-02-30', to: '2026-03-01' })).toEqual({ from: '', to: '' });
    expect(previousPeriod({ from: '2026-03-02', to: '2026-03-01' })).toEqual({ from: '', to: '' });
  });
});
