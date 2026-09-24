import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InventoryRepository } from '../InventoryRepository';
import type { Database } from '../../types/database';

/**
 * Regression cover for: inventory tracked after income & expense
 * transactions already existed, so quantity_on_hand disagreed with what
 * the sales/purchase records themselves imply.
 *
 * backfillFromSalesAndPurchases() delegates to the
 * backfill_and_recalculate_inventory RPC, which:
 *   - inserts a stock_movements row for every tracked-product invoice/expense
 *     line that doesn't already have one,
 *   - records implied opening stock where missing sales exceed what is on
 *     hand, so no balance can go negative,
 *   - leaves inventory_balances to the canonical balance trigger (deltas),
 *     never rewriting them from the ledger.
 *
 * The RPC was costed correctly by 20260730000005 (sales at weighted-average
 * inbound cost, never the selling price; can_write_business_data() required)
 * and rewritten to a movements-only design by 20260926000001 after the old
 * balance rewrite tripped chk_inventory_balances_on_hand_nonneg on
 * production. Both migrations are asserted below since there is no live
 * database in this test environment; behaviour against a real Postgres is
 * covered by tests/database/backfill_reconcile_inventory.test.js.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260730000005_fix_inventory_backfill_costing_and_authz.sql',
);
const REWRITE_MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260926000001_fix_backfill_and_recalculate_inventory.sql',
);

function repoWithRpc(impl: () => { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockImplementation(async () => impl());
  const client = { rpc } as unknown as SupabaseClient<Database>;
  return { repo: new InventoryRepository(client), rpc };
}

describe('backfillFromSalesAndPurchases', () => {
  it('calls the RPC with the business id and returns the counts', async () => {
    const { repo, rpc } = repoWithRpc(() => ({
      data: [
        {
          out_business_id: 'biz-1',
          sales_backfilled: 3,
          purchases_backfilled: 2,
          adjustments_inserted: 1,
          balances_updated: 5,
        },
      ],
      error: null,
    }));

    await expect(repo.backfillFromSalesAndPurchases('biz-1')).resolves.toEqual({
      salesBackfilled: 3,
      purchasesBackfilled: 2,
      adjustmentsInserted: 1,
      balancesUpdated: 5,
    });

    expect(rpc).toHaveBeenCalledWith('backfill_and_recalculate_inventory', {
      p_business_id: 'biz-1',
    });
  });

  it('returns zeroes when nothing was missing', async () => {
    const { repo } = repoWithRpc(() => ({ data: [], error: null }));

    await expect(repo.backfillFromSalesAndPurchases('biz-1')).resolves.toEqual({
      salesBackfilled: 0,
      purchasesBackfilled: 0,
      adjustmentsInserted: 0,
      balancesUpdated: 0,
    });
  });

  it('defaults adjustmentsInserted to zero against the pre-fix RPC shape', async () => {
    const { repo } = repoWithRpc(() => ({
      data: [
        {
          out_business_id: 'biz-1',
          sales_backfilled: 1,
          purchases_backfilled: 1,
          balances_updated: 2,
        },
      ],
      error: null,
    }));

    await expect(repo.backfillFromSalesAndPurchases('biz-1')).resolves.toEqual({
      salesBackfilled: 1,
      purchasesBackfilled: 1,
      adjustmentsInserted: 0,
      balancesUpdated: 2,
    });
  });

  it('surfaces a permission denial as UnauthorizedError', async () => {
    const { repo } = repoWithRpc(() => ({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    }));

    await expect(repo.backfillFromSalesAndPurchases('biz-1')).rejects.toMatchObject({
      name: 'UnauthorizedError',
    });
  });
});

describe('backfill_and_recalculate_inventory migration fix', () => {
  const sql = readFileSync(MIGRATION, 'utf8');

  it('requires a business id and permission for non-service-role callers', () => {
    expect(sql).toMatch(/auth\.role\(\)\s+IS\s+DISTINCT\s+FROM\s+'service_role'/i);
    expect(sql).toContain('public.can_write_business_data(p_business_id)');
  });

  it('backfills purchases before sales so sale cost lookups see prior receipts', () => {
    const purchaseIdx = sql.indexOf('missing_purchases AS');
    const salesIdx = sql.indexOf('missing_sales AS');
    expect(purchaseIdx).toBeGreaterThan(-1);
    expect(salesIdx).toBeGreaterThan(-1);
    expect(purchaseIdx).toBeLessThan(salesIdx);
  });

  it('never costs a backfilled sale at the invoice selling price', () => {
    // The historical bug: unit_cost := il.unit_price for sale movements.
    expect(sql).not.toMatch(/unit_cost\s*\)\s*[\s\S]{0,400}il\.unit_price\s+AS\s+unit_cost/i);
    expect(sql).toMatch(/sm2\.quantity\s*\*\s*sm2\.unit_cost/);
  });

  it('falls back to the product purchase price, then zero, when no purchase history exists', () => {
    expect(sql).toMatch(/COALESCE\(\s*\(\s*SELECT SUM\(sm2\.quantity \* sm2\.unit_cost\)/);
    expect(sql).toMatch(/p\.purchase_price,\s*\n\s*0\s*\)\s*AS unit_cost/);
  });

  it('computes average_cost as a quantity-weighted average of inbound movements only', () => {
    expect(sql).toMatch(
      /SUM\(CASE WHEN sm\.quantity > 0 THEN sm\.quantity \* sm\.unit_cost ELSE 0 END\)/,
    );
    expect(sql).not.toMatch(/AVG\(ABS\(sm\.unit_cost\)\)/);
  });

  it('only backfills tracked-inventory products', () => {
    expect(sql).toMatch(/JOIN public\.products p ON p\.id = el\.product_id[\s\S]{0,200}p\.track_inventory/);
    expect(sql).toMatch(/JOIN public\.products p ON p\.id = il\.product_id[\s\S]{0,200}p\.track_inventory/);
  });

  it('is not executable by anon and remains callable by authenticated', () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.backfill_and_recalculate_inventory/i);
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.backfill_and_recalculate_inventory\(UUID\) TO authenticated/i,
    );
  });
});

describe('backfill_and_recalculate_inventory movements-only rewrite (20260926000001)', () => {
  const sql = readFileSync(REWRITE_MIGRATION, 'utf8');

  it('replaces the old function instead of layering on top of it', () => {
    expect(sql).toMatch(/drop function if exists public\.backfill_and_recalculate_inventory\(uuid\)/i);
    expect(sql).toMatch(/create function public\.backfill_and_recalculate_inventory/i);
  });

  it('never writes inventory_balances directly (balances are the trigger\'s job)', () => {
    // No INSERT INTO / UPDATE of inventory_balances anywhere in the body. A
    // join (LEFT JOIN public.inventory_balances) to READ the shortfall is
    // fine and expected.
    expect(sql).not.toMatch(/insert into public\.inventory_balances/i);
    expect(sql).not.toMatch(/update public\.inventory_balances/i);
  });

  it('records implied opening stock before backfilling the sales that need it', () => {
    const openingIdx = sql.indexOf("'opening_balance'::public.stock_movement_type");
    const salesInsertIdx = sql.indexOf('-- 4. Backfill missing stock movements for past sales');
    expect(openingIdx).toBeGreaterThan(-1);
    expect(salesInsertIdx).toBeGreaterThan(-1);
    expect(openingIdx).toBeLessThan(salesInsertIdx);
    // Shortfall = missing sales minus what is on hand, floored at zero.
    expect(sql).toMatch(/greatest\(d\.missing_units - coalesce\(ib\.quantity_on_hand, 0\), 0\)/);
  });

  it('still costs backfilled sales at weighted-average inbound cost, never the selling price', () => {
    expect(sql).toMatch(/sm2\.quantity\s*\*\s*sm2\.unit_cost/);
    expect(sql).not.toMatch(/il\.unit_price\s+as\s+unit_cost/i);
  });

  it('compares source_id in a way that works whether the column is text or uuid', () => {
    // Production carries source_id as UUID, repository replays as TEXT
    // (same drift 20260911000002 documented). text = uuid never plans.
    expect(sql).toMatch(/sm\.source_id::text = e\.id::text/);
    expect(sql).toMatch(/sm\.source_id::text = i\.id::text/);
    expect(sql).not.toMatch(/sm\.source_id = [ei]\.id\b/);
  });

  it('serialises concurrent runs per business', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(v_biz_record\.id::text, 0\)\)/);
  });

  it('keeps the authorization gate and grants from 20260730000005', () => {
    expect(sql).toMatch(/auth\.role\(\)\s+is\s+distinct\s+from\s+'service_role'/i);
    expect(sql).toContain('public.can_write_business_data(p_business_id)');
    expect(sql).toMatch(/revoke all on function public\.backfill_and_recalculate_inventory/i);
    expect(sql).toMatch(
      /grant execute on function public\.backfill_and_recalculate_inventory\(uuid\) to authenticated/i,
    );
  });

  it('reports the new adjustments_inserted output column', () => {
    expect(sql).toMatch(/adjustments_inserted int/i);
    expect(sql).toMatch(/v_adjustments_count/);
  });
});
