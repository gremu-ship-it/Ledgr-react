import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../../types/database';
import { BomRepository } from '../BomRepository';

interface Store {
  manufacturing_boms: Row<'manufacturing_boms'>[];
  manufacturing_bom_lines: Row<'manufacturing_bom_lines'>[];
  products: Row<'products'>[];
}

function makeClient(store: Store, rpcData: unknown = null, rpcError: unknown = null) {
  const rpc = vi.fn(async () => ({ data: rpcData, error: rpcError }));
  const from = vi.fn((table: keyof Store) => {
    const filters: Array<(row: Record<string, unknown>) => boolean> = [];
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.in = (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return builder;
    };
    builder.order = () => builder;
    const rows = () => (store[table] as unknown as Record<string, unknown>[]).filter((row) => filters.every((filter) => filter(row)));
    builder.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    builder.single = async () => ({ data: rows()[0] ?? null, error: null });
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return builder;
  });
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, rpc };
}

const bomRow = (id: string, productId: string, version: number): Row<'manufacturing_boms'> => ({
  id, business_id: 'business-1', product_id: productId, version, status: 'active',
  bom_locked_at: null, notes: null, created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const componentRow = (
  id: string,
  bomId: string,
  productId: string | null,
  subassemblyId: string | null,
  quantity: number,
): Row<'manufacturing_bom_lines'> => ({
  id, bom_id: bomId, component_product_id: productId, component_bom_id: subassemblyId,
  quantity, unit_of_measure: 'ea', scrap_pct: 0, notes: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const productRow = (id: string, name: string): Row<'products'> => ({
  id, business_id: 'business-1', name, sku: null, unit_of_measure: 'ea',
  product_type: 'product', purchase_price: 10, cost_price: 10,
} as Row<'products'>);
const emptyStore = (): Store => ({ manufacturing_boms: [], manufacturing_bom_lines: [], products: [] });

describe('BomRepository', () => {
  it('saves component quantities for one output unit through the version RPC', async () => {
    const { client, rpc } = makeClient(emptyStore(), 'bom-version-2');
    const repository = new BomRepository(client);
    const components = [{
      component_product_id: 'material-1', component_bom_id: null, quantity: 2.5,
      unit_of_measure: 'kg', scrap_pct: 3, notes: null,
    }];
    await expect(repository.saveVersion({
      businessId: 'business-1', bomId: null, productId: 'finished-1', notes: null, components,
    })).resolves.toBe('bom-version-2');
    expect(rpc).toHaveBeenCalledWith('save_bom_version', {
      p_business_id: 'business-1', p_bom_id: null, p_product_id: 'finished-1',
      p_notes: null, p_components: components,
    });
  });

  it('propagates the database cycle rejection', async () => {
    const cycleError = { message: 'BOM cycle detected: sub-assembly would create a circular reference', code: '23514' };
    const { client } = makeClient(emptyStore(), null, cycleError);
    const repository = new BomRepository(client);
    await expect(repository.saveVersion({
      businessId: 'business-1', bomId: 'bom-a', productId: 'product-a', notes: null,
      components: [{ component_product_id: null, component_bom_id: 'bom-b', quantity: 1, unit_of_measure: 'ea', scrap_pct: 0, notes: null }],
    })).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('BOM cycle detected') });
  });

  it('activates and creates versions through the manufacturing commands', async () => {
    const active = bomRow('bom-2', 'product-1', 2);
    const store = emptyStore();
    store.manufacturing_boms.push(active);
    const { client, rpc } = makeClient(store, active.id);
    const repository = new BomRepository(client);
    await expect(repository.activateVersion(active.id)).resolves.toEqual(active);
    await expect(repository.newVersion(active.id)).resolves.toBe(active.id);
    expect(rpc).toHaveBeenNthCalledWith(1, 'manufacturing_bom_activate', { p_bom_id: active.id });
    expect(rpc).toHaveBeenNthCalledWith(2, 'manufacturing_bom_new_version', { p_bom_id: active.id });
  });

  it('loads recursively nested sub-assemblies and their raw materials', async () => {
    const store: Store = {
      manufacturing_boms: [bomRow('bom-root', 'finished-1', 1), bomRow('bom-sub', 'wip-1', 3)],
      manufacturing_bom_lines: [
        componentRow('line-root', 'bom-root', null, 'bom-sub', 2),
        componentRow('line-sub', 'bom-sub', 'material-1', null, 4),
      ],
      products: [productRow('finished-1', 'Finished pack'), productRow('wip-1', 'Inner assembly'), productRow('material-1', 'Steel sheet')],
    };
    const repository = new BomRepository(makeClient(store).client);
    const tree = await repository.getVersionTree('business-1', 'bom-root');
    expect(tree.product?.name).toBe('Finished pack');
    expect(tree.components[0].subassembly?.product?.name).toBe('Inner assembly');
    expect(tree.components[0].subassembly?.components[0]).toMatchObject({
      quantity: 4, product: { id: 'material-1', name: 'Steel sheet' },
    });
  });
});
