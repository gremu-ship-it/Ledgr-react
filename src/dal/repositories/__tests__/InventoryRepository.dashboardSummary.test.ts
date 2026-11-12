import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../types/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InventoryRepository } from '../InventoryRepository';

function clientWithRows(rows: unknown[]) {
  const query = {
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    range: vi.fn(async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null })),
  };
  return {
    from: vi.fn(() => ({ select: vi.fn(() => query) })),
  } as unknown as SupabaseClient<Database>;
}

describe('InventoryRepository.getDashboardSummary', () => {
  it('summarises the complete tracked stock across locations and excludes inactive products', async () => {
    const client = clientWithRows([
      { id: 'a', quantity_on_hand: 10, quantity_reserved: 2, average_cost: 5, products: { reorder_level: 10, track_inventory: true, is_active: true, deleted_at: null } },
      { id: 'b', quantity_on_hand: 0, quantity_reserved: 0, average_cost: 9, products: { reorder_level: 2, track_inventory: true, is_active: true, deleted_at: null } },
      { id: 'c', quantity_on_hand: 50, quantity_reserved: 0, average_cost: 2, products: { reorder_level: 5, track_inventory: true, is_active: false, deleted_at: null } },
    ]);
    const repo = new InventoryRepository(client);

    await expect(repo.getDashboardSummary('business-1')).resolves.toEqual({
      stockValue: 50,
      lowStockCount: 2,
      stockoutCount: 1,
      trackedBalanceCount: 2,
    });
  });
});
