import { describe, expect, it, vi } from 'vitest';
import type { InsertDto, Row } from '@/dal/types/database';
import { InventoryRepository } from '@/dal/repositories/InventoryRepository';
import { ValidationError } from '@/dal/errors/RepositoryError';

const movement = {
  id: 'movement-1',
  business_id: 'business-1',
  product_id: 'product-1',
  location_id: 'location-1',
  movement_date: '2026-11-01',
  movement_type: 'sale',
  quantity: -2,
  unit_cost: 10,
  source_type: 'invoice',
  source_id: 'invoice-1',
  reference: 'INV-1',
} as Row<'stock_movements'>;

const balance = {
  id: 'balance-1',
  business_id: 'business-1',
  product_id: 'product-1',
  location_id: 'location-1',
  quantity_on_hand: 8,
} as Row<'inventory_balances'>;

describe('InventoryRepository movement integrity', () => {
  it('does not insert a second sale movement for the same invoice/product/location identity', async () => {
    const movementQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [movement], error: null }),
      insert: vi.fn(),
    };
    const balanceQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: balance, error: null }),
    };
    const client = {
      from: vi.fn((table: string) => table === 'stock_movements' ? movementQuery : balanceQuery),
    };
    const repository = new InventoryRepository(client as never);
    const saleMovement = {
      business_id: 'business-1',
      product_id: 'product-1',
      location_id: 'location-1',
      movement_date: '2026-11-01',
      movement_type: 'sale',
      quantity: -2,
      unit_cost: 10,
      source_type: 'invoice',
      source_id: 'invoice-1',
    } as InsertDto<'stock_movements'>;

    const result = await repository.recordMovement(saleMovement);

    expect(client.from).toHaveBeenCalledWith('stock_movements');
    expect(movementQuery.insert).not.toHaveBeenCalled();
    expect(result.movement.id).toBe(movement.id);
    expect(result.balance.quantity_on_hand).toBe(balance.quantity_on_hand);
  });

  it('rejects an adjustment without notes or a reference before calling the server', async () => {
    const rpc = vi.fn();
    const repository = new InventoryRepository({ rpc } as never);

    const error = await repository.recordInventoryJournalMovement({
      businessId: 'business-1',
      kind: 'adjustment',
      clientKey: '00000000-0000-4000-8000-000000000001',
      locationId: 'location-1',
      movementDate: '2026-11-01',
      lines: [{ productId: 'product-1', quantity: 2, unitCost: 10 }],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toBe('inventory-adjustment-reason-required');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts an adjustment explanation in notes even without a reference', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { idempotent: false, movement_ids: ['movement-2'], journal_entry_id: null },
      error: null,
    });
    const repository = new InventoryRepository({ rpc } as never);

    await repository.recordInventoryJournalMovement({
      businessId: 'business-1',
      kind: 'adjustment',
      clientKey: '00000000-0000-4000-8000-000000000002',
      locationId: 'location-1',
      movementDate: '2026-11-01',
      notes: 'Stock count variance',
      lines: [{ productId: 'product-1', quantity: 2, unitCost: 10 }],
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0][0]).toBe('record_inventory_journal_movement');
  });
});
