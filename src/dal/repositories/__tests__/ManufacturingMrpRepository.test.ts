import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { ManufacturingRepository } from '../ManufacturingRepository';

const run = {
  id: 'run-1', business_id: 'business-1', run_number: 3, horizon_start: '2026-11-01',
  horizon_end: '2026-11-30', demand_inputs: [], created_by: 'user-1',
  created_at: '2026-11-01T10:00:00Z', recommendation_count: 1, make_count: 1, buy_count: 0,
};
const recommendation = {
  id: 'recommendation-1', business_id: 'business-1', run_id: 'run-1', product_id: 'product-1',
  recommendation_type: 'make', required_date: '2026-11-10', gross_requirement: 5,
  on_hand_quantity: 1, active_production_quantity: 1, approved_supply_quantity: 0,
  net_requirement: 3, bom_id: 'bom-1', status: 'open', converted_work_order_id: null,
  created_at: '2026-11-01T10:00:00Z', dismissed_at: null, dismissed_by: null,
};
const product = { id: 'product-1', name: 'Assembly', sku: 'ASM-1', unit_of_measure: 'ea' };

function makeClient() {
  const rpc = vi.fn(async (name: string) => ({
    data: name === 'run_mrp' || name === 'convert_mrp_recommendation' ? 'returned-id' : null,
    error: null,
  }));
  const tableData: Record<string, unknown[]> = {
    manufacturing_mrp_runs: [run],
    manufacturing_mrp_recommendations: [recommendation],
    products: [product],
  };
  const from = vi.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.order = () => builder;
    builder.in = () => builder;
    builder.update = () => builder;
    builder.maybeSingle = async () => ({ data: { id: recommendation.id }, error: null });
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: tableData[table] ?? [], error: null }).then(resolve, reject);
    return builder;
  });
  const auth = { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })) };
  const client = { from, rpc, auth } as unknown as SupabaseClient<Database>;
  return { client, rpc, from };
}

describe('ManufacturingRepository MRP methods', () => {
  it('runs MRP with a dated demand snapshot and returns the run id', async () => {
    const { client, rpc } = makeClient();
    const repository = new ManufacturingRepository(client);
    const demand = [{ product_id: 'product-1', quantity: 5, required_date: '2026-11-10' }];
    await expect(repository.runMrp('business-1', '2026-11-01', '2026-11-30', demand)).resolves.toBe('returned-id');
    expect(rpc).toHaveBeenCalledWith('run_mrp', {
      p_business_id: 'business-1', p_horizon_start: '2026-11-01',
      p_horizon_end: '2026-11-30', p_demand_inputs: demand,
    });
  });

  it('loads run history and attaches business-scoped product details to recommendations', async () => {
    const { client } = makeClient();
    const repository = new ManufacturingRepository(client);
    await expect(repository.listMrpRuns('business-1')).resolves.toEqual([run]);
    await expect(repository.listMrpRecommendations('business-1', 'run-1')).resolves.toEqual([
      { ...recommendation, product },
    ]);
  });

  it('converts make suggestions only through the explicit conversion command and supports dismissal', async () => {
    const { client, rpc, from } = makeClient();
    const repository = new ManufacturingRepository(client);
    await expect(repository.convertMrpRecommendation('recommendation-1')).resolves.toBe('returned-id');
    expect(rpc).toHaveBeenCalledWith('convert_mrp_recommendation', { p_recommendation_id: 'recommendation-1' });
    await expect(repository.dismissMrpRecommendation('business-1', 'recommendation-1')).resolves.toBeUndefined();
    expect(from).toHaveBeenCalledWith('manufacturing_mrp_recommendations');
  });
});
