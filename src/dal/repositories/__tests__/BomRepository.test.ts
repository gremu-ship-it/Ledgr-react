import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Row } from '../../types/database';
import { BomRepository } from '../BomRepository';

interface Store {
  boms: Row<'boms'>[];
  bom_versions: Row<'bom_versions'>[];
  bom_components: Row<'bom_components'>[];
  products: Row<'products'>[];
}

function makeClient(store: Store, rpcResult: unknown = null, rpcError: unknown = null) {
  const rpc = vi.fn(async () => ({ data: rpcResult, error: rpcError }));
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

const bomRow = (id: string, productId: string, code: string): Row<'boms'> => ({
  id, business_id: 'business-1', product_id: productId, code, name: `${code} assembly`,
  description: null, unit_of_measure: 'ea', is_active: true, created_by: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
});
const versionRow = (id: string, bomId: string, number: number): Row<'bom_versions'> => ({
  id, business_id: 'business-1', bom_id: bomId, version_number: number, version_label: null,
  status: 'active', effective_from: '2026-01-01', effective_to: null, notes: null,
  created_by: null, created_at: '2026-01-01T00:00:00Z',
});
const componentRow = (id: string, versionId: string, productId: string | null, subassemblyId: string | null, quantity: number): Row<'bom_components'> => ({
  id, business_id: 'business-1', bom_version_id: versionId,
  component_product_id: productId, component_bom_version_id: subassemblyId,
  quantity, unit_of_measure: 'ea', scrap_percentage: 0, sort_order: 0, notes: null,
  created_at: '2026-01-01T00:00:00Z',
});

describe('BomRepository', () => {
  it('saves a version through the typed RPC with per-unit component quantities', async () => {
    const { client, rpc } = makeClient({ boms: [], bom_versions: [], bom_components: [], products: [] }, 'version-1');
    const repository = new BomRepository(client);
    const id = await repository.saveVersion({
      businessId: 'business-1', bomId: null, code: 'FG-1', name: 'Finished good',
      productId: 'product-fg', versionLabel: '1', components: [{
        component_product_id: 'product-mat', component_bom_version_id: null, quantity: 2.5,
        unit_of_measure: 'kg', scrap_percentage: 0, sort_order: 0, notes: null,
      }],
    });
    expect(id).toBe('version-1');
    expect(rpc).toHaveBeenCalledWith('save_bom_version', expect.objectContaining({
      p_business_id: 'business-1', p_bom_id: null, p_code: 'FG-1',
      p_components: [{
        component_product_id: 'product-mat', component_bom_version_id: null, quantity: 2.5,
        unit_of_measure: 'kg', scrap_percentage: 0, sort_order: 0, notes: null,
      }],
    }));
  });

  it('propagates the database cycle rejection rather than swallowing it', async () => {
    const cycleError = { message: 'BOM cycle detected: version references itself', code: '23514' };
    const { client } = makeClient({ boms: [], bom_versions: [], bom_components: [], products: [] }, null, cycleError);
    const repository = new BomRepository(client);
    await expect(repository.saveVersion({
      businessId: 'business-1', bomId: 'bom-1', code: 'FG-1', name: 'Finished good',
      productId: 'product-fg', versionLabel: '2', components: [],
    })).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('BOM cycle detected') });
  });

  it('activates a version through the archive-on-activation RPC', async () => {
    const active = versionRow('version-2', 'bom-1', 2);
    const { client, rpc } = makeClient({ boms: [], bom_versions: [], bom_components: [], products: [] }, active);
    const repository = new BomRepository(client);
    await expect(repository.activateVersion('business-1', active.id)).resolves.toEqual(active);
    expect(rpc).toHaveBeenCalledWith('activate_bom_version', {
      p_business_id: 'business-1', p_bom_version_id: active.id,
    });
  });

  it('loads nested sub-assembly components for expandable trees', async () => {
    const store: Store = {
      boms: [bomRow('bom-root', 'product-fg', 'FG-1'), bomRow('bom-sub', 'product-sub', 'SUB-1')],
      bom_versions: [versionRow('version-root', 'bom-root', 1), versionRow('version-sub', 'bom-sub', 1)],
      bom_components: [
        componentRow('component-root', 'version-root', null, 'version-sub', 1),
        componentRow('component-sub', 'version-sub', 'product-leaf', null, 3),
      ],
      products: [{
        id: 'product-leaf', business_id: 'business-1', name: 'Steel sheet', sku: 'MAT-1', unit_of_measure: 'kg',
      } as Row<'products'>],
    };
    const repository = new BomRepository(makeClient(store).client);
    const tree = await repository.getVersionTree('business-1', 'version-root');
    expect(tree.bom.code).toBe('FG-1');
    expect(tree.components[0].subassembly?.bom.code).toBe('SUB-1');
    expect(tree.components[0].subassembly?.components[0]).toMatchObject({
      quantity: 3, product: { id: 'product-leaf', name: 'Steel sheet', sku: 'MAT-1' },
    });
  });
});
