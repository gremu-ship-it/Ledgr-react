/**
 * Tests for the Inventory overview aggregation (rollupByProduct / isLowStock).
 *
 * The Inventory page value column is qty × average cost per location summed
 * across locations, and the per-product "Avg Cost" is a quantity WEIGHTED
 * mean — a simple mean of per-location costs overstates value when a
 * low-cost warehouse holds most of the units. These tests lock that math.
 */
import { describe, it, expect } from 'vitest';
import type { BalanceWithProduct } from '@/dal/repositories/InventoryRepository';
import { isLowStock, rollupByProduct } from '@/lib/inventoryRollup';

function balance(overrides: Partial<BalanceWithProduct>): BalanceWithProduct {
  return {
    id: 'bal-1',
    businessid: 'biz-1',
    productid: 'prod-1',
    locationid: 'loc-1',
    quantity_on_hand: 0,
    quantity_reserved: 0,
    quantity_available: null,
    average_cost: 0,
    last_movement_at: null,
    updated_at: '2026-08-03T00:00:00Z',
    products: { name: 'Maize Flour 25kg', sku: 'MF-25', reorder_level: null },
    inventory_locations: { name: 'Main Warehouse' },
    ...overrides,
  };
}

describe('rollupByProduct', () => {
  it('sums quantities across locations for one product', () => {
    const [p] = rollupByProduct([
      balance({ locationid: 'a', quantity_on_hand: 10, quantity_reserved: 2, average_cost: 100 }),
      balance({ locationid: 'b', quantity_on_hand: 5, quantity_reserved: 1, average_cost: 120 }),
    ]);
    expect(p.onHand).toBe(15);
    expect(p.reserved).toBe(3);
    // available falls back to onHand - reserved when the view column is null
    expect(p.available).toBe(12);
  });

  it('totals stock value as Σ(qty × avg cost) per location', () => {
    const [p] = rollupByProduct([
      balance({ locationid: 'a', quantity_on_hand: 10, average_cost: 100 }),
      balance({ locationid: 'b', quantity_on_hand: 5, average_cost: 120 }),
    ]);
    expect(p.value).toBe(10 * 100 + 5 * 120);
  });

  it('computes a quantity-WEIGHTED average cost (not a simple mean)', () => {
    const [p] = rollupByProduct([
      balance({ locationid: 'a', quantity_on_hand: 90, average_cost: 100 }),
      balance({ locationid: 'b', quantity_on_hand: 10, average_cost: 200 }),
    ]);
    // weighted: (9000 + 2000) / 100 = 110; simple mean would be 150
    expect(p.weightedCost).toBe(110);
  });

  it('falls back to the location cost when nothing is on hand (avoids ÷0)', () => {
    const [p] = rollupByProduct([
      balance({ locationid: 'a', quantity_on_hand: 0, average_cost: 100 }),
    ]);
    expect(p.weightedCost).toBe(100);
    expect(p.value).toBe(0);
  });

  it('exposes each location slice sorted by name for the drill-down rows', () => {
    const [p] = rollupByProduct([
      balance({ locationid: 'b', inventory_locations: { name: 'Zomba' } }),
      balance({ locationid: 'a', inventory_locations: { name: 'Blantyre' } }),
    ]);
    expect(p.locations.map((l) => l.locationName)).toEqual(['Blantyre', 'Zomba']);
  });

  it('keeps products separate and sorts them by name', () => {
    const products = rollupByProduct([
      balance({ productid: 'p2', products: { name: 'Sugar', sku: null, reorder_level: null } }),
      balance({ productid: 'p1', products: { name: 'Beans', sku: null, reorder_level: null } }),
    ]);
    expect(products.map((p) => p.name)).toEqual(['Beans', 'Sugar']);
  });
});

describe('isLowStock', () => {
  it('flags products at or below the reorder level', () => {
    expect(isLowStock({ available: 5, reorderLevel: 5 })).toBe(true);
    expect(isLowStock({ available: 4, reorderLevel: 5 })).toBe(true);
  });

  it('does not flag products above the reorder level', () => {
    expect(isLowStock({ available: 6, reorderLevel: 5 })).toBe(false);
  });

  it('ignores products without a reorder level configured', () => {
    expect(isLowStock({ available: 0, reorderLevel: null })).toBe(false);
    expect(isLowStock({ available: 0, reorderLevel: 0 })).toBe(false);
  });
});
