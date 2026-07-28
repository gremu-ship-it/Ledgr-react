/**
 * Tests for the pure valuation/posting helpers behind perpetual inventory.
 *
 * These functions decide how much value moves between the balance sheet and
 * the income statement, so they are tested directly. They live in
 * inventoryValuation.ts precisely so they carry no Supabase dependency and
 * can be exercised without a database or environment variables.
 */

import { describe, it, expect } from 'vitest';
import {
  computeStockValue,
  computeCogsTotal,
  computeInventoryVariance,
  buildCogsPostings,
  roundMoney,
  TOLERANCE,
  type SaleCostLine,
} from '../inventoryValuation';

describe('computeStockValue', () => {
  it('values stock at quantity × weighted-average cost', () => {
    expect(computeStockValue([
      { quantity_on_hand: 10, average_cost: 250 },
      { quantity_on_hand: 4, average_cost: 1_000 },
    ])).toBe(6_500);
  });

  it('accepts numeric strings, as Postgres numerics arrive over the wire', () => {
    expect(computeStockValue([
      { quantity_on_hand: '10', average_cost: '250.50' },
    ])).toBe(2_505);
  });

  it('returns zero for no stock', () => {
    expect(computeStockValue([])).toBe(0);
  });

  it('keeps negative on-hand quantities visible instead of clamping them', () => {
    // Overselling is a real data problem. Clamping to zero here would hide
    // it from the reconciliation and understate the reported variance.
    expect(computeStockValue([
      { quantity_on_hand: -3, average_cost: 100 },
      { quantity_on_hand: 10, average_cost: 100 },
    ])).toBe(700);
  });
});

describe('computeCogsTotal', () => {
  it('totals quantity × unit cost across lines', () => {
    const lines: SaleCostLine[] = [
      { productId: 'a', quantity: 2, unitCost: 150 },
      { productId: 'b', quantity: 3, unitCost: 400 },
    ];
    expect(computeCogsTotal(lines)).toBe(1_500);
  });

  it('treats a negative quantity as an absolute number of units', () => {
    // Sale movements are stored with a negative quantity; the cost of the
    // goods that left is still a positive expense.
    expect(computeCogsTotal([{ productId: 'a', quantity: -5, unitCost: 20 }])).toBe(100);
  });
});

describe('roundMoney', () => {
  it('rounds to two decimal places', () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });

  it('clears binary floating point dust that would break the balance check', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
  });
});

describe('computeInventoryVariance', () => {
  it('reports the ledger understating stock as a positive variance', () => {
    const result = computeInventoryVariance(50_000, 30_000);
    expect(result.variance).toBe(20_000);
    expect(result.isReconciled).toBe(false);
  });

  it('reports the ledger overstating stock as a negative variance', () => {
    const result = computeInventoryVariance(30_000, 50_000);
    expect(result.variance).toBe(-20_000);
    expect(result.isReconciled).toBe(false);
  });

  it('treats an exact match as reconciled', () => {
    expect(computeInventoryVariance(12_345.67, 12_345.67).isReconciled).toBe(true);
  });

  it('tolerates sub-cent rounding noise', () => {
    const result = computeInventoryVariance(1_000, 1_000 + TOLERANCE / 2);
    expect(result.isReconciled).toBe(true);
  });

  it('flags a difference at exactly the tolerance boundary', () => {
    // TOLERANCE is 0.01 and the check is strict (<), so one full cent of
    // drift is a real difference and must not be silently absorbed.
    expect(computeInventoryVariance(1_000, 1_000.01).isReconciled).toBe(false);
  });

  it('reports the full value as the variance when nothing was ever posted', () => {
    // This is the exact bug being fixed: stock on hand, nil in the ledger.
    const result = computeInventoryVariance(875_000, 0);
    expect(result.variance).toBe(875_000);
    expect(result.isReconciled).toBe(false);
  });
});

describe('buildCogsPostings', () => {
  const accounts = new Map([
    ['prod-1', { inventoryAccountId: 'inv-1141', cogsAccountId: 'cogs-5100' }],
    ['prod-2', { inventoryAccountId: 'inv-1141', cogsAccountId: 'cogs-5100' }],
  ]);

  it('debits cost of sales and credits inventory by the same total', () => {
    const { debitsByAccount, creditsByAccount, total } = buildCogsPostings(
      [{ productId: 'prod-1', quantity: 4, unitCost: 250 }],
      accounts,
    );
    expect(debitsByAccount.get('cogs-5100')).toBe(1_000);
    expect(creditsByAccount.get('inv-1141')).toBe(1_000);
    expect(total).toBe(1_000);
  });

  it('always produces a balanced entry', () => {
    const { debitsByAccount, creditsByAccount } = buildCogsPostings(
      [
        { productId: 'prod-1', quantity: 3, unitCost: 133.33 },
        { productId: 'prod-2', quantity: 7, unitCost: 66.67 },
      ],
      accounts,
    );
    const debits = [...debitsByAccount.values()].reduce((s, v) => s + v, 0);
    const credits = [...creditsByAccount.values()].reduce((s, v) => s + v, 0);
    expect(Math.abs(debits - credits)).toBeLessThan(0.005);
  });

  it('aggregates several products sharing one account into a single line', () => {
    const { debitsByAccount, creditsByAccount } = buildCogsPostings(
      [
        { productId: 'prod-1', quantity: 2, unitCost: 100 },
        { productId: 'prod-2', quantity: 1, unitCost: 300 },
      ],
      accounts,
    );
    expect(debitsByAccount.size).toBe(1);
    expect(debitsByAccount.get('cogs-5100')).toBe(500);
    expect(creditsByAccount.get('inv-1141')).toBe(500);
  });

  it('keeps distinct product accounts on separate lines and still balances', () => {
    const mixed = new Map([
      ['prod-1', { inventoryAccountId: 'inv-1141', cogsAccountId: 'cogs-5100' }],
      ['prod-2', { inventoryAccountId: 'inv-1145', cogsAccountId: 'cogs-5110' }],
    ]);
    const { debitsByAccount, creditsByAccount, total } = buildCogsPostings(
      [
        { productId: 'prod-1', quantity: 1, unitCost: 400 },
        { productId: 'prod-2', quantity: 2, unitCost: 50 },
      ],
      mixed,
    );
    expect(debitsByAccount.get('cogs-5100')).toBe(400);
    expect(debitsByAccount.get('cogs-5110')).toBe(100);
    expect(creditsByAccount.get('inv-1141')).toBe(400);
    expect(creditsByAccount.get('inv-1145')).toBe(100);
    expect(total).toBe(500);
  });

  it('skips zero-cost lines and reports them', () => {
    // Stock sold before it was ever received has an average cost of zero.
    // Posting a zero-value line would add noise without moving a balance,
    // but the caller still needs to know cost was not recognised.
    const { total, skippedProductIds, debitsByAccount } = buildCogsPostings(
      [{ productId: 'prod-1', quantity: 5, unitCost: 0 }],
      accounts,
    );
    expect(total).toBe(0);
    expect(debitsByAccount.size).toBe(0);
    expect(skippedProductIds).toEqual(['prod-1']);
  });

  it('skips products with no account mapping', () => {
    // Non-tracked products are excluded from the mapping upstream: they were
    // expensed when bought, so posting COGS again would double count.
    const { total, skippedProductIds } = buildCogsPostings(
      [{ productId: 'untracked', quantity: 2, unitCost: 500 }],
      accounts,
    );
    expect(total).toBe(0);
    expect(skippedProductIds).toEqual(['untracked']);
  });

  it('handles a sale recorded with a negative quantity', () => {
    const { debitsByAccount, total } = buildCogsPostings(
      [{ productId: 'prod-1', quantity: -3, unitCost: 200 }],
      accounts,
    );
    expect(debitsByAccount.get('cogs-5100')).toBe(600);
    expect(total).toBe(600);
  });

  it('returns nothing for an empty sale', () => {
    const { total, debitsByAccount, creditsByAccount } = buildCogsPostings([], accounts);
    expect(total).toBe(0);
    expect(debitsByAccount.size).toBe(0);
    expect(creditsByAccount.size).toBe(0);
  });
});

describe('gross profit integrity (perpetual vs the old expense-on-purchase model)', () => {
  it('recognises cost only for goods actually sold', () => {
    // Buy 100 @ 50 = 5,000. Sell 30 @ 50 = 1,500 cost.
    // Old behaviour expensed the whole 5,000 on purchase, understating
    // profit by 3,500 in the buying period and overstating it later.
    // Perpetual recognises 1,500 now and carries 3,500 on the balance sheet.
    const purchaseValue = 100 * 50;
    const { total: cogs } = buildCogsPostings(
      [{ productId: 'prod-1', quantity: 30, unitCost: 50 }],
      new Map([['prod-1', { inventoryAccountId: 'inv', cogsAccountId: 'cogs' }]]),
    );

    expect(cogs).toBe(1_500);

    const closingStock = purchaseValue - cogs;
    expect(closingStock).toBe(3_500);

    // Closing stock must equal what the subledger says is still on hand,
    // which is what makes the balance sheet reconcile.
    expect(computeStockValue([{ quantity_on_hand: 70, average_cost: 50 }])).toBe(closingStock);
  });

  it('leaves no variance once purchase and sale are both posted', () => {
    const purchaseValue = 100 * 50;
    const { total: cogs } = buildCogsPostings(
      [{ productId: 'prod-1', quantity: 30, unitCost: 50 }],
      new Map([['prod-1', { inventoryAccountId: 'inv', cogsAccountId: 'cogs' }]]),
    );
    const ledgerInventory = purchaseValue - cogs;
    const subledgerValue = computeStockValue([{ quantity_on_hand: 70, average_cost: 50 }]);

    expect(computeInventoryVariance(subledgerValue, ledgerInventory).isReconciled).toBe(true);
  });
});
