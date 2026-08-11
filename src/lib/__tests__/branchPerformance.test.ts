import { describe, expect, it } from 'vitest';
import {
  buildBranchPerformance,
  type AccountRef,
  type BranchRef,
  type JournalLineForBranchReport,
} from '@/lib/branchPerformance';

const branch: BranchRef = {
  id: 'branch-1',
  name: 'Blantyre',
  code: 'BT',
  location: 'Blantyre',
  is_active: true,
};

function account(
  id: string,
  code: string,
  name: string,
  subtype: NonNullable<AccountRef['account_subtype']>,
  normalBalance: AccountRef['normal_balance'],
): AccountRef {
  return {
    id,
    code,
    name,
    account_subtype: subtype,
    normal_balance: normalBalance,
  };
}

function journalLine(
  amount: number,
  isDebit: boolean,
  lineAccount: AccountRef,
): JournalLineForBranchReport {
  return {
    branch_id: branch.id,
    is_debit: isDebit,
    amount_base: amount,
    accounts: lineAccount,
    journal_entries: {
      branch_id: branch.id,
      entry_date: '2026-08-11',
      status: 'posted',
    },
  };
}

describe('buildBranchPerformance', () => {
  it('nets sales and purchase discounts against their P&L sections', () => {
    const sales = account('sales', '4112', 'Service Revenue', 'revenue', 'credit');
    const salesDiscounts = account('sales-discounts', '4130', 'Sales Discounts', 'revenue', 'debit');
    const costOfSales = account('cost', '5100', 'Cost of Goods Sold', 'cost_of_sales', 'debit');
    const purchaseDiscounts = account('purchase-discounts', '5175', 'Purchase Discounts', 'cost_of_sales', 'credit');

    const [row] = buildBranchPerformance(
      [branch],
      [
        journalLine(1_000, false, sales),
        journalLine(100, true, salesDiscounts),
        journalLine(400, true, costOfSales),
        journalLine(50, false, purchaseDiscounts),
      ],
    );

    expect(row.revenue).toBe(900);
    expect(row.costOfSales).toBe(350);
    expect(row.grossProfit).toBe(550);
    expect(row.netProfit).toBe(550);
    expect(row.accountBreakdown).toEqual([
      expect.objectContaining({ code: '4112', amount: 1_000 }),
      expect.objectContaining({ code: '4130', amount: -100 }),
      expect.objectContaining({ code: '5100', amount: 400 }),
      expect.objectContaining({ code: '5175', amount: -50 }),
    ]);
  });
});
