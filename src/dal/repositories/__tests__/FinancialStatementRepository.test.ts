/**
 * Regression tests for the SOFP contra-account fix.
 *
 * buildSection used to present every account at its natural-side balance.
 * Contra accounts therefore INFLATED their section instead of netting it:
 *
 *   - Accumulated Depreciation (credit-normal) was ADDED to Non-Current
 *     Assets, so every posted depreciation charge grew Total Assets by 2x the
 *     charge, and isBalanced misfired with a false warning;
 *   - Drawings / Dividends (debit-normal) was ADDED to equity;
 *   - Provision for Bad Debts (credit-normal) was ADDED to Current Assets.
 *
 * The Supabase client is stubbed with thenable query-chain proxies so the
 * repository can be exercised without a database; filters are not simulated,
 * so fixtures contain a single business's final state.
 */

import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { FinancialStatementRepository } from '../FinancialStatementRepository';

function tableStub(data: unknown[]) {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) =>
            onFulfilled({ data, error: null });
        }
        return () => proxy;
      },
    },
  );
  return proxy;
}

const ACCOUNTS: Array<Record<string, unknown>> = [
  { id: 'a-current-assets', code: '1100', name: 'Current Assets', account_type: 'asset', account_subtype: 'current_asset', normal_balance: 'debit', is_group: true, is_system: true, is_bank_account: false, opening_balance: 1_500 },
  { id: 'a-cash', code: '1110', name: 'Cash on Hand', account_type: 'asset', account_subtype: 'current_asset', normal_balance: 'debit', is_group: false, is_system: true, is_bank_account: false, opening_balance: 0 },
  { id: 'a-provision', code: '1134', name: 'Provision for Bad Debts', account_type: 'asset', account_subtype: 'current_asset', normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-buildings', code: '1512', name: 'Buildings', account_type: 'asset', account_subtype: 'fixed_asset', normal_balance: 'debit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-accdep', code: '1521', name: 'Accum. Depr. — Buildings', account_type: 'asset', account_subtype: 'fixed_asset', normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-creditors', code: '2111', name: 'Trade Creditors', account_type: 'liability', account_subtype: 'current_liability', normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-sharecap', code: '3110', name: 'Share Capital', account_type: 'equity', account_subtype: 'share_capital', normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-drawings', code: '3140', name: 'Drawings / Dividends Paid', account_type: 'equity', account_subtype: 'retained_earnings', normal_balance: 'debit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-revenue', code: '4112', name: 'Service Revenue', account_type: 'income', account_subtype: 'revenue', normal_balance: 'credit', is_group: false, is_system: true, is_bank_account: false, opening_balance: 0 },
  { id: 'a-sales-discounts', code: '4130', name: 'Sales Discounts', account_type: 'income', account_subtype: 'revenue', normal_balance: 'debit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-cost-of-sales', code: '5100', name: 'Cost of Goods Sold', account_type: 'expense', account_subtype: 'cost_of_sales', normal_balance: 'debit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-purchase-discounts', code: '5175', name: 'Purchase Discounts', account_type: 'expense', account_subtype: 'cost_of_sales', normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
];

const JOURNAL_LINES: Array<Record<string, unknown>> = [
  { account_id: 'a-cash', is_debit: true, amount_base: 30_000 },
  { account_id: 'a-provision', is_debit: false, amount_base: 2_000 },
  { account_id: 'a-buildings', is_debit: true, amount_base: 100_000 },
  { account_id: 'a-accdep', is_debit: false, amount_base: 10_000 }, // one year of depreciation
  { account_id: 'a-creditors', is_debit: false, amount_base: 20_000 },
  { account_id: 'a-sharecap', is_debit: false, amount_base: 40_000 },
  { account_id: 'a-drawings', is_debit: true, amount_base: 5_000 },
  { account_id: 'a-revenue', is_debit: false, amount_base: 1_000 },
  { account_id: 'a-sales-discounts', is_debit: true, amount_base: 100 },
  { account_id: 'a-cost-of-sales', is_debit: true, amount_base: 400 },
  { account_id: 'a-purchase-discounts', is_debit: false, amount_base: 50 },
];

function makeRepo(): FinancialStatementRepository {
  const client = {
    from: (table: string) =>
      table === 'accounts' ? tableStub(ACCOUNTS) : tableStub(JOURNAL_LINES),
  } as unknown as SupabaseClient<Database>;
  return new FinancialStatementRepository(client);
}

describe('getSOFP — contra-account presentation', () => {
  it('nets Accumulated Depreciation against Non-Current Assets', async () => {
    const sofp = await makeRepo().getSOFP('biz-1', '2026-06-30');
    // Buildings 100,000 less Accumulated Depreciation 10,000 = NBV 90,000.
    // Before the fix this subtotal was 110,000 — Total Assets grew with
    // every depreciation posting.
    expect(sofp.nonCurrentAssets.subtotal).toBe(90_000);
    const accDep = sofp.nonCurrentAssets.lines.find((l) => l.code === '1521');
    expect(accDep?.amount).toBe(-10_000);
  });

  it('nets the Provision for Bad Debts against Current Assets', async () => {
    const sofp = await makeRepo().getSOFP('biz-1', '2026-06-30');
    expect(sofp.currentAssets.subtotal).toBe(30_000 - 2_000 + 1_500);
    expect(sofp.currentAssets.lines.find((line) => line.code === '1100')?.amount).toBe(1_500);
  });

  it('presents Drawings / Dividends as a reduction of equity', async () => {
    const sofp = await makeRepo().getSOFP('biz-1', '2026-06-30');
    expect(sofp.equity.subtotal).toBe(40_000 - 5_000);
    const drawings = sofp.equity.lines.find((l) => l.code === '3140');
    expect(drawings?.amount).toBe(-5_000);
  });

  it('flips the comparative column identically', async () => {
    const sofp = await makeRepo().getSOFP('biz-1', '2026-06-30', '2025-06-30');
    expect(sofp.nonCurrentAssets.comparativeSubtotal).toBe(90_000);
    expect(sofp.equity.comparativeSubtotal).toBe(35_000);
  });

  it('reports correct totals', async () => {
    const sofp = await makeRepo().getSOFP('biz-1', '2026-06-30');
    expect(sofp.totalAssets).toBe(119_500);
    expect(sofp.totalLiabilities).toBe(20_000);
    expect(sofp.netAssets).toBe(99_500);
    expect(sofp.totalEquity).toBe(35_000);
  });
});

describe('getProfitOrLoss — discount presentation', () => {
  it('shows allowed and received discounts as reductions of their sections', async () => {
    const profitOrLoss = await makeRepo().getProfitOrLoss(
      'biz-1',
      '2026-01-01',
      '2026-12-31',
    );

    expect(profitOrLoss.revenue.lines).toEqual([
      expect.objectContaining({ code: '4112', amount: 1_000 }),
      expect.objectContaining({ code: '4130', amount: -100 }),
    ]);
    expect(profitOrLoss.totalRevenue).toBe(900);
    expect(profitOrLoss.costOfSales.lines).toEqual([
      expect.objectContaining({ code: '5100', amount: 400 }),
      expect.objectContaining({ code: '5175', amount: -50 }),
    ]);
    expect(profitOrLoss.totalCostOfSales).toBe(350);
    expect(profitOrLoss.grossProfit).toBe(550);
  });
});
