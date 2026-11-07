import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { InventoryRepository } from '../InventoryRepository';
import { PosRepository } from '../PosRepository';

describe('demo seeder DAL commands', () => {
  let client: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
  let inventory: InventoryRepository;
  let pos: PosRepository;

  beforeEach(() => {
    client = { from: vi.fn(), rpc: vi.fn() };
    inventory = new InventoryRepository(client as unknown as SupabaseClient<Database>);
    pos = new PosRepository(client as unknown as SupabaseClient<Database>);
  });

  it('rejects product writes outside the DEMO SKU namespace before querying', async () => {
    await expect(inventory.upsertDemoProduct({
      business_id: 'demo-business', sku: 'ORDINARY-SKU',
    } as never)).rejects.toThrow('DEMO- prefix');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('creates a DEMO product via the inventory repository when the SKU is absent', async () => {
    const product = { id: 'product-1', business_id: 'demo-business', sku: 'DEMO-INV-CEMENT' };
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: product, error: null }),
    };
    client.from.mockReturnValue(query);

    const result = await inventory.upsertDemoProduct({
      business_id: 'demo-business', sku: 'DEMO-INV-CEMENT', name: 'Cement',
    } as never);

    expect(client.from).toHaveBeenCalledWith('products');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ sku: 'DEMO-INV-CEMENT' }));
    expect(result.id).toBe('product-1');
  });

  it('rejects terminal registration outside the DEMO namespace before querying', async () => {
    await expect(pos.ensureDemoTerminal({
      business_id: 'demo-business', name: 'Main till', branch_id: 'branch-1',
    } as never)).rejects.toThrow('DEMO- prefix');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('registers the named demo terminal through the POS repository', async () => {
    const terminal = {
      id: 'terminal-1', business_id: 'demo-business', name: 'DEMO-TILL-01', branch_id: 'branch-1',
      preferred_location_id: 'location-1', is_active: true,
    };
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: terminal, error: null }),
    };
    client.from.mockReturnValue(query);

    const result = await pos.ensureDemoTerminal({
      business_id: 'demo-business', name: 'DEMO-TILL-01', branch_id: 'branch-1',
      preferred_location_id: 'location-1', is_active: true,
    } as never);

    expect(client.from).toHaveBeenCalledWith('pos_terminals');
    expect(query.insert).toHaveBeenCalledWith(expect.objectContaining({ name: 'DEMO-TILL-01', is_active: true }));
    expect(result.id).toBe('terminal-1');
  });
});
