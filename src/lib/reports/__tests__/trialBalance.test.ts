import { describe, expect, it } from 'vitest';
import type { TrialBalanceRow } from '@/dal/repositories/ReportRepository';
import {
  accountIdsWithChildren,
  buildAccountTree,
  defaultExpandedAccountIds,
  visibleAccountRows,
} from '../trialBalance';
import { periodForPreset } from '../periods';

const rows: TrialBalanceRow[] = [
  { account_id: 'assets', account_code: '1000', account_name: 'Assets', account_type: 'asset', parent_account_id: null, total_debit: 10, total_credit: 0, balance: 10, level: 0 },
  { account_id: 'current', account_code: '1100', account_name: 'Current assets', account_type: 'asset', parent_account_id: 'assets', total_debit: 20, total_credit: 0, balance: 20, level: 1 },
  { account_id: 'cash', account_code: '1110', account_name: 'Cash', account_type: 'asset', parent_account_id: 'current', total_debit: 100, total_credit: 0, balance: 100, level: 2 },
  { account_id: 'bank', account_code: '1120', account_name: 'Bank', account_type: 'asset', parent_account_id: 'current', total_debit: 0, total_credit: 30, balance: -30, level: 2 },
  { account_id: 'equity', account_code: '3000', account_name: 'Equity', account_type: 'equity', parent_account_id: null, total_debit: 0, total_credit: 50, balance: -50, level: 0 },
];

describe('trial balance account tree', () => {
  it('rolls parent totals from descendants and includes the parent own postings', () => {
    const [assets, equity] = buildAccountTree(rows);
    expect(assets.rollupDebit).toBe(130);
    expect(assets.rollupCredit).toBe(30);
    expect(assets.rollupBalance).toBe(100);
    expect(assets.children[0].rollupDebit).toBe(120);
    expect(equity.rollupCredit).toBe(50);
  });

  it('shows roots expanded by default and allows deeper expand/collapse', () => {
    const tree = buildAccountTree(rows);
    const expanded = defaultExpandedAccountIds(tree);
    expect([...expanded]).toEqual(['assets']);
    expect(visibleAccountRows(tree, expanded).map(({ node }) => node.account_id))
      .toEqual(['assets', 'current', 'equity']);
    expanded.add('current');
    expect(visibleAccountRows(tree, expanded).map(({ node }) => node.account_id))
      .toEqual(['assets', 'current', 'cash', 'bank', 'equity']);
    expect(accountIdsWithChildren(tree)).toEqual(['assets', 'current']);
  });

  it('treats an account with an unavailable parent as a root', () => {
    const orphan = { ...rows[1], account_id: 'orphan', parent_account_id: 'missing' };
    expect(buildAccountTree([orphan])).toHaveLength(1);
  });
});

describe('trial balance period presets', () => {
  const now = new Date(2026, 2, 15);

  it('calculates month, quarter, year-to-date, and last-year ranges using local calendar dates', () => {
    expect(periodForPreset('thisMonth', now)).toEqual({ from: '2026-03-01', to: '2026-03-15' });
    expect(periodForPreset('lastMonth', now)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodForPreset('thisQuarter', now)).toEqual({ from: '2026-01-01', to: '2026-03-15' });
    expect(periodForPreset('yearToDate', now)).toEqual({ from: '2026-01-01', to: '2026-03-15' });
    expect(periodForPreset('lastYear', now)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('handles leap February when computing the previous month', () => {
    expect(periodForPreset('lastMonth', new Date(2024, 2, 3)))
      .toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });
});
