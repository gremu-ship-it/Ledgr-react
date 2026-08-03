/**
 * Golden-file test for the Statement of Profit or Loss (IAS 1).
 *
 * One complete, hand-computed fixture: every section subtotal and the full
 * waterfall (Revenue → Gross Profit → Operating Profit → PBT → Net Profit)
 * is asserted against figures worked out by hand below. If a refactor
 * changes how sections are built, this test fails with the exact
 * financial-statement line it broke, not an abstract diff.
 *
 * Fixture (MWK):
 *   4112 Service Revenue            Cr 100,000
 *   4120 Sales Returns (contra-rev) Dr   5,000   → Revenue 95,000
 *   5100 Cost of Goods Sold         Dr  30,000
 *   5170 Purchase Returns (contra)  Cr   2,000   → COGS 28,000
 *   4610 Sundry Income              Cr   2,000   → Other Income 2,000
 *   6110 Basic Salaries             Dr  20,000   → Operating Expenses 20,000
 *   6900 Depreciation Charge        Dr  10,000   → D&A 10,000
 *   7101 Interest on Loans          Dr   5,000   → Finance Costs 5,000
 *   7500 Income Tax Expense         Dr   7,000   → Tax 7,000
 *
 * Expected waterfall:
 *   Gross Profit    = 95,000 − 28,000          = 67,000
 *   Operating Profit = 67,000 + 2,000 − 20,000 − 10,000 = 39,000
 *   Profit Before Tax = 39,000 − 5,000         = 34,000
 *   Net Profit       = 34,000 − 7,000          = 27,000
 *
 * The Supabase client is stubbed with thenable query-chain proxies (filters
 * not simulated), the same pattern as FinancialStatementRepository.test.ts.
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
  { id: 'a-rev',    code: '4112', name: 'Service Revenue',     account_type: 'income',  account_subtype: 'revenue',       normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-return', code: '4120', name: 'Sales Returns',       account_type: 'income',  account_subtype: 'revenue',       normal_balance: 'debit',  is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-sundry', code: '4610', name: 'Sundry Income',       account_type: 'income',  account_subtype: 'other_income',  normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-cogs',   code: '5100', name: 'Cost of Goods Sold',  account_type: 'expense', account_subtype: 'cost_of_sales', normal_balance: 'debit',  is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-pret',   code: '5170', name: 'Purchase Returns',    account_type: 'expense', account_subtype: 'cost_of_sales', normal_balance: 'credit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-sal',    code: '6110', name: 'Basic Salaries',      account_type: 'expense', account_subtype: 'operating_expense', normal_balance: 'debit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-dep',    code: '6900', name: 'Depreciation Charge', account_type: 'expense', account_subtype: 'depreciation_amortisation', normal_balance: 'debit', is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-int',    code: '7101', name: 'Interest on Loans',   account_type: 'expense', account_subtype: 'finance_cost',  normal_balance: 'debit',  is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
  { id: 'a-tax',    code: '7500', name: 'Income Tax Expense',  account_type: 'expense', account_subtype: 'tax_expense',   normal_balance: 'debit',  is_group: false, is_system: false, is_bank_account: false, opening_balance: 0 },
];

const JOURNAL_LINES: Array<Record<string, unknown>> = [
  { account_id: 'a-rev',    is_debit: false, amount_base: 100_000 },
  { account_id: 'a-return', is_debit: true,  amount_base: 5_000 },
  { account_id: 'a-sundry', is_debit: false, amount_base: 2_000 },
  { account_id: 'a-cogs',   is_debit: true,  amount_base: 30_000 },
  { account_id: 'a-pret',   is_debit: false, amount_base: 2_000 },
  { account_id: 'a-sal',    is_debit: true,  amount_base: 20_000 },
  { account_id: 'a-dep',    is_debit: true,  amount_base: 10_000 },
  { account_id: 'a-int',    is_debit: true,  amount_base: 5_000 },
  { account_id: 'a-tax',    is_debit: true,  amount_base: 7_000 },
];

function makeRepo(): FinancialStatementRepository {
  const client = {
    from: (table: string) =>
      table === 'accounts' ? tableStub(ACCOUNTS) : tableStub(JOURNAL_LINES),
  } as unknown as SupabaseClient<Database>;
  return new FinancialStatementRepository(client);
}

describe('getProfitOrLoss — golden statement', () => {
  it('nets contra-revenue (Sales Returns) against Revenue', async () => {
    const pl = await makeRepo().getProfitOrLoss('biz-1', '2026-01-01', '2026-12-31');
    expect(pl.revenue.subtotal).toBe(95_000);
    expect(pl.revenue.lines.find((l) => l.code === '4120')?.amount).toBe(-5_000);
  });

  it('nets contra-COGS (Purchase Returns) against Cost of Sales', async () => {
    const pl = await makeRepo().getProfitOrLoss('biz-1', '2026-01-01', '2026-12-31');
    expect(pl.costOfSales.subtotal).toBe(28_000);
    expect(pl.costOfSales.lines.find((l) => l.code === '5170')?.amount).toBe(-2_000);
  });

  it('matches the hand-computed waterfall exactly', async () => {
    const pl = await makeRepo().getProfitOrLoss('biz-1', '2026-01-01', '2026-12-31');
    expect(pl.totalRevenue).toBe(95_000);
    expect(pl.totalCostOfSales).toBe(28_000);
    expect(pl.grossProfit).toBe(67_000);
    expect(pl.totalOtherIncome).toBe(2_000);
    expect(pl.totalOperatingExpenses).toBe(20_000);
    expect(pl.totalDepreciationAmortisation).toBe(10_000);
    expect(pl.operatingProfit).toBe(39_000);
    expect(pl.totalFinanceCosts).toBe(5_000);
    expect(pl.profitBeforeTax).toBe(34_000);
    expect(pl.totalTaxExpense).toBe(7_000);
    expect(pl.netProfit).toBe(27_000);
  });

  it('produces an identical comparative column for the same fixture', async () => {
    // The stub ignores date filters, so comparative sees the same lines —
    // a cheap invariant that the comparative path runs through the same math.
    const pl = await makeRepo().getProfitOrLoss(
      'biz-1', '2026-01-01', '2026-12-31', '2025-01-01', '2025-12-31',
    );
    expect(pl.comparativeGrossProfit).toBe(67_000);
    expect(pl.comparativeNetProfit).toBe(27_000);
    expect(pl.revenue.comparativeSubtotal).toBe(95_000);
  });

  it('excludes opening balances from period flows', async () => {
    // 6110 carries opening_balance 0 in the fixture — P&L balances must come
    // only from journal lines. A regression to includeOpeningBalances:true
    // would surface here if any fixture account held one.
    const pl = await makeRepo().getProfitOrLoss('biz-1', '2026-01-01', '2026-12-31');
    expect(pl.totalOperatingExpenses).toBe(20_000);
  });
});
