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

  it('includes a fixed asset linked to a custom GL account despite its subtype', async () => {
    const customAccount = {
      ...ACCOUNTS[3],
      id: 'a-custom-ppe',
      code: 'PPE-01',
      name: 'Custom Equipment Account',
      account_subtype: 'other_asset',
    };
    const client = {
      from: (table: string) => {
        if (table === 'accounts') return tableStub([customAccount]);
        if (table === 'fixed_assets') return tableStub([{ asset_account_id: 'a-custom-ppe' }]);
        return tableStub([{ account_id: 'a-custom-ppe', is_debit: true, amount_base: 75_000 }]);
      },
    } as unknown as SupabaseClient<Database>;

    const sofp = await new FinancialStatementRepository(client).getSOFP('biz-1', '2026-06-30');

    expect(sofp.nonCurrentAssets.subtotal).toBe(75_000);
    expect(sofp.totalAssets).toBe(75_000);
  });

  it('includes a custom GL account inherited from the asset category', async () => {
    const customAccount = {
      ...ACCOUNTS[3],
      id: 'a-category-ppe',
      code: 'CUSTOM-PPE',
      name: 'Category Equipment Account',
      account_subtype: 'other_asset',
    };
    const fixedAsset = {
      id: 'asset-category-linked',
      asset_number: 'FA-CAT-1',
      name: 'Category-linked equipment',
      category_id: 'category-1',
      asset_account_id: null,
      accumulated_dep_account_id: null,
      acquisition_date: '2026-01-01',
      acquisition_cost: 80_000,
      accumulated_depreciation: 0,
      net_book_value: 80_000,
      status: 'active',
      disposal_date: null,
    };
    const client = {
      from: (table: string) => {
        if (table === 'accounts') return tableStub([customAccount]);
        if (table === 'journal_lines') {
          return tableStub([{ account_id: 'a-category-ppe', is_debit: true, amount_base: 80_000 }]);
        }
        if (table === 'fixed_assets') return tableStub([fixedAsset]);
        if (table === 'asset_categories') {
          return tableStub([{
            id: 'category-1',
            asset_account_id: 'a-category-ppe',
            accumulated_dep_account_id: null,
          }]);
        }
        if (table === 'journal_entries') {
          return tableStub([{
            source_id: 'asset-category-linked',
            status: 'posted',
            entry_date: '2026-01-01',
          }]);
        }
        return tableStub([]);
      },
    } as unknown as SupabaseClient<Database>;

    const sofp = await new FinancialStatementRepository(client).getSOFP('biz-1', '2026-06-30');

    expect(sofp.nonCurrentAssets.lines).toEqual([
      expect.objectContaining({ code: 'CUSTOM-PPE', amount: 80_000 }),
    ]);
    expect(sofp.nonCurrentAssets.subtotal).toBe(80_000);
  });

  // ── Phase 10.2: "restore fixed assets to Non-Current Assets" ─────────────
  // The 1500-1599 range is the documented Non-Current Assets range. Legacy
  // data or manual edits can leave a 15xx asset account with a NULL,
  // 'current_asset' or junk subtype; the statement must still present it
  // under Non-Current Assets — and never in two sections at once.

  it('routes a 15xx asset account with subtype "current_asset" to Non-Current Assets only', async () => {
    const mislabelled = {
      ...ACCOUNTS[3], // Buildings fixture — code 1512, fixed_asset
      id: 'a-buildings-mislabeled',
      account_subtype: 'current_asset',
    };
    const client = {
      from: (table: string) => {
        if (table === 'accounts') return tableStub([mislabelled]);
        if (table === 'journal_lines') {
          return tableStub([{ account_id: 'a-buildings-mislabeled', is_debit: true, amount_base: 100_000 }]);
        }
        return tableStub([]);
      },
    } as unknown as SupabaseClient<Database>;

    const sofp = await new FinancialStatementRepository(client).getSOFP('biz-1', '2026-06-30');

    const ncaLine = sofp.nonCurrentAssets.lines.find((l) => l.code === '1512');
    expect(ncaLine?.amount).toBe(100_000);
    expect(sofp.nonCurrentAssets.subtotal).toBe(100_000);
    // Must not appear in Current Assets (no double counting).
    expect(sofp.currentAssets.lines.find((l) => l.code === '1512')).toBeUndefined();
    expect(sofp.currentAssets.subtotal).toBe(0);
    expect(sofp.totalAssets).toBe(100_000);
  });

  it('routes a 15xx asset account with a junk non-asset subtype to Non-Current Assets', async () => {
    const junk = {
      ...ACCOUNTS[3],
      id: 'a-buildings-junk',
      account_subtype: 'revenue', // clearly wrong — would drop the account from every section
    };
    const client = {
      from: (table: string) => {
        if (table === 'accounts') return tableStub([junk]);
        if (table === 'journal_lines') {
          return tableStub([{ account_id: 'a-buildings-junk', is_debit: true, amount_base: 50_000 }]);
        }
        return tableStub([]);
      },
    } as unknown as SupabaseClient<Database>;

    const sofp = await new FinancialStatementRepository(client).getSOFP('biz-1', '2026-06-30');

    expect(sofp.nonCurrentAssets.lines.find((l) => l.code === '1512')?.amount).toBe(50_000);
    expect(sofp.nonCurrentAssets.subtotal).toBe(50_000);
    expect(sofp.totalAssets).toBe(50_000);
  });

  it('leaves a deliberately current-asset account (non-15xx code) in Current Assets', async () => {
    const current = {
      ...ACCOUNTS[1], // Cash on Hand — code 1110, current_asset
      id: 'a-cash-current',
      account_subtype: 'current_asset',
    };
    const client = {
      from: (table: string) => {
        if (table === 'accounts') return tableStub([current]);
        if (table === 'journal_lines') {
          return tableStub([{ account_id: 'a-cash-current', is_debit: true, amount_base: 9_000 }]);
        }
        return tableStub([]);
      },
    } as unknown as SupabaseClient<Database>;

    const sofp = await new FinancialStatementRepository(client).getSOFP('biz-1', '2026-06-30');

    expect(sofp.currentAssets.lines.find((l) => l.code === '1110')?.amount).toBe(9_000);
    expect(sofp.nonCurrentAssets.lines.find((l) => l.code === '1110')).toBeUndefined();
    expect(sofp.totalAssets).toBe(9_000);
  });

  it('shows the register NBV when a failed capitalisation left only a draft journal', async () => {
    const account = { ...ACCOUNTS[3], opening_balance: 0 };
    const fixedAsset = {
      id: 'asset-with-draft',
      asset_number: 'FA-DRAFT-1',
      name: 'Equipment awaiting posting',
      category_id: 'category-1',
      asset_account_id: 'a-buildings',
      accumulated_dep_account_id: null,
      acquisition_date: '2026-01-01',
      acquisition_cost: 60_000,
      accumulated_depreciation: 5_000,
      net_book_value: 55_000,
      status: 'active',
      disposal_date: null,
    };
    const client = {
      from: (table: string) => {
        if (table === 'accounts') return tableStub([account]);
        if (table === 'fixed_assets') return tableStub([fixedAsset]);
        if (table === 'asset_categories') return tableStub([]);
        if (table === 'journal_entries') {
          return tableStub([{
            source_id: 'asset-with-draft',
            status: 'draft',
            entry_date: '2026-01-01',
          }]);
        }
        return tableStub([]);
      },
    } as unknown as SupabaseClient<Database>;

    const sofp = await new FinancialStatementRepository(client).getSOFP('biz-1', '2026-06-30');

    expect(sofp.nonCurrentAssets.lines).toEqual([
      expect.objectContaining({
        code: 'FA-DRAFT-1',
        name: 'Equipment awaiting posting (register — pending capitalisation)',
        amount: 55_000,
      }),
    ]);
    expect(sofp.nonCurrentAssets.subtotal).toBe(55_000);
  });
});

  it('does not truncate balances beyond PostgREST 1000-row limit (Phase 10.2d)', async () => {
    // Simulates a business with > 1000 journal lines: the first page returns
    // 1000 rows, and the pagination loop must fetch the rest. Without the
    // fix, a fixed-asset line beyond the first page would be dropped and
    // Non-Current Assets would read zero.
    const account = { ...ACCOUNTS[3], id: 'a-buildings-paged', opening_balance: 0 };
    const fixedLine = { account_id: 'a-buildings-paged', is_debit: true, amount_base: 60_000 };
    const filler = Array.from({ length: 1000 }, () => ({
      account_id: 'a-cash',
      is_debit: true,
      amount_base: 1,
    }));
    // Second page holds the fixed-asset line.
    const pageTwo = [fixedLine];
    let call = 0;
    let ordered = false;
    const client = {
      from: (table: string) => {
        if (table === 'accounts') return tableStub([account]);
        if (table === 'journal_lines') {
          const proxy: unknown = new Proxy({}, {
            get(_t, prop) {
              // ORDER BY must be applied to the base query BEFORE the first
              // fetch — otherwise page 1 (unordered) and pages 2+ (ordered)
              // do not partition the data and rows are silently skipped.
              if (prop === 'order') {
                return () => { ordered = true; return proxy; };
              }
              if (prop === 'range') {
                return () => proxy;
              }
              if (prop === 'then') {
                return (onFulfilled: (v: { data: unknown[]; error: null }) => unknown) => {
                  if (call === 0 && !ordered) throw new Error('base query not ordered before first fetch');
                  // First call = initial query (1000 rows). Subsequent calls
                  // (pagination) return the next page; return short page to stop.
                  const data = call++ === 0 ? filler : pageTwo;
                  return onFulfilled({ data, error: null });
                };
              }
              return () => proxy;
            },
          });
          return proxy;
        }
        return tableStub([]);
      },
    } as unknown as SupabaseClient<Database>;

    const sofp = await new FinancialStatementRepository(client).getSOFP('biz-1', '2026-06-30');

    expect(sofp.nonCurrentAssets.lines.find((l) => l.code === '1512')?.amount).toBe(60_000);
    expect(sofp.nonCurrentAssets.subtotal).toBe(60_000);
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
