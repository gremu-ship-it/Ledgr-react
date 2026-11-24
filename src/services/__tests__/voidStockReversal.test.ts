import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression cover for the void-stock-unwind path.
 *
 * THE INCIDENT
 * EXP-0478 brought 1,100 bags into Head Office and posted DR Inventory /
 * CR Cash. It was then voided: the journal entry was reversed and the expense
 * row flipped to `void`, but the `purchase` stock movement was never unwound.
 * Inventory kept showing 1,100 bags that the ledger said had been given back,
 * and the warehouse reconciliation panel had to be used by hand to fix it.
 *
 * These tests pin the two properties that fix that:
 *   1. A void posts a mirror `adjustment_out` for every inbound movement, at the
 *      SAME location and unit cost (never the default branch location).
 *   2. It is idempotent — the client key is derived from the movement id, so a
 *      retried void cannot give the stock back twice.
 *
 * The GL side is deliberately NOT touched here: the reversal of the document's
 * own entry already moves the inventory account. Posting a second entry would
 * double count the correction.
 */

const findMovementsForSource = vi.fn();
const recordMovements = vi.fn();

vi.mock('@/lib/repositories', () => ({
  repos: {
    inventory: {
      findMovementsForSource: (...args: unknown[]) => findMovementsForSource(...args),
      recordMovements: (...args: unknown[]) => recordMovements(...args),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { reverseStockBroughtInByDocument } from '../voidStockReversal';
import { deriveClientKey } from '@/lib/clientKeys';

const BUSINESS = '93851ac2-0000-0000-0000-000000000000';
const EXPENSE = 'exp-0478';

function purchaseMovement(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mov-1',
    business_id: BUSINESS,
    product_id: 'prod-cement',
    location_id: 'loc-head-office',
    movement_type: 'purchase',
    movement_date: '2026-11-16',
    quantity: 1100,
    unit_cost: 3636.36,
    source_type: 'expense',
    source_id: EXPENSE,
    ...overrides,
  };
}

describe('reverseStockBroughtInByDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findMovementsForSource.mockResolvedValue([]);
    recordMovements.mockImplementation(async (rows: unknown[]) => rows);
  });

  it('posts a mirrored adjustment_out at the original location and unit cost', async () => {
    findMovementsForSource.mockResolvedValue([purchaseMovement()]);

    await reverseStockBroughtInByDocument({
      businessId: BUSINESS,
      sourceId: EXPENSE,
      reversalDate: '2026-11-24',
      reference: 'JNL-20261124-001341',
      reason: 'Duplicate receipt',
      createdBy: 'user-1',
    });

    expect(findMovementsForSource).toHaveBeenCalledWith(BUSINESS, 'expense', EXPENSE);
    expect(recordMovements).toHaveBeenCalledTimes(1);
    const rows = recordMovements.mock.calls[0][0] as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      business_id: BUSINESS,
      product_id: 'prod-cement',
      // Stock leaves the location it arrived at, not a default branch.
      location_id: 'loc-head-office',
      movement_type: 'adjustment_out',
      movement_date: '2026-11-24',
      quantity: -1100,
      unit_cost: 3636.36,
      source_type: 'expense',
      source_id: EXPENSE,
      reference: 'JNL-20261124-001341',
      created_by: 'user-1',
    });
    expect(String(rows[0].notes)).toContain('Duplicate receipt');
  });

  it('keys each reversal off its own movement so a retried void cannot double up', async () => {
    findMovementsForSource.mockResolvedValue([
      purchaseMovement({ id: 'mov-1' }),
      purchaseMovement({ id: 'mov-2', quantity: 50 }),
    ]);

    await reverseStockBroughtInByDocument({
      businessId: BUSINESS,
      sourceId: EXPENSE,
      reason: 'Duplicate receipt',
    });

    const rows = recordMovements.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows.map((r) => r.client_key)).toEqual([
      deriveClientKey('expense-void-stock-reversal:mov-1', 0),
      deriveClientKey('expense-void-stock-reversal:mov-2', 0),
    ]);
    // Same key on re-run means the upsert is a no-op, not a second movement.
    expect(rows[0].client_key).not.toBe(rows[1].client_key);
  });

  it('reports the quantity and value given back', async () => {
    findMovementsForSource.mockResolvedValue([purchaseMovement()]);

    const result = await reverseStockBroughtInByDocument({
      businessId: BUSINESS,
      sourceId: EXPENSE,
      reason: 'Duplicate receipt',
    });

    expect(result).toMatchObject({
      movementsReversed: 1,
      quantityReversed: 1100,
      // 1100 × 3,636.36 — the ORIGINAL unit cost, not today's 5,000 price.
      valueReversed: 3_999_996,
      recorded: true,
    });
  });

  it('ignores movements that did not bring stock IN', async () => {
    // A document that issued stock (negative quantity, or a non-purchase
    // movement) must not be "given back" — that would add stock.
    findMovementsForSource.mockResolvedValue([
      purchaseMovement({ movement_type: 'sale', quantity: -5 }),
      purchaseMovement({ movement_type: 'purchase', quantity: -5 }),
    ]);

    const result = await reverseStockBroughtInByDocument({
      businessId: BUSINESS,
      sourceId: EXPENSE,
      reason: 'Duplicate receipt',
    });

    expect(recordMovements).not.toHaveBeenCalled();
    expect(result.recorded).toBe(false);
    expect(result.movementsReversed).toBe(0);
  });

  it('is a no-op for a document with no stock movements', async () => {
    findMovementsForSource.mockResolvedValue([]);

    const result = await reverseStockBroughtInByDocument({
      businessId: BUSINESS,
      sourceId: 'plain-cash-expense',
      reason: 'Wrong amount',
    });

    expect(recordMovements).not.toHaveBeenCalled();
    expect(result).toEqual({
      movementsReversed: 0,
      quantityReversed: 0,
      valueReversed: 0,
      recorded: false,
    });
  });

  it('never throws — a stock failure must not block a committed reversal', async () => {
    findMovementsForSource.mockRejectedValue(new Error('network down'));

    await expect(
      reverseStockBroughtInByDocument({
        businessId: BUSINESS,
        sourceId: EXPENSE,
        reason: 'Duplicate receipt',
      }),
    ).resolves.toEqual({
      movementsReversed: 0,
      quantityReversed: 0,
      valueReversed: 0,
      recorded: false,
    });
  });
});
