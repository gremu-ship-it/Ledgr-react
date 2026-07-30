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
 *   - recalculates inventory_balances from the full movement history.
 *
 * The RPC itself was fixed by 20260730000005 to cost backfilled sales at
 * weighted-average inbound cost (never at the invoice's selling price) and
 * to require can_write_business_data() for any non-service-role caller —
 * both asserted against the migration SQL below since there is no live
 * database in this test environment.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');
const MIGRATION = resolve(
  REPO_ROOT,
  'supabase/migrations/20260730000005_fix_inventory_backfill_costing_and_authz.sql',
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
          balances_updated: 5,
        },
      ],
      error: null,
    }));

    await expect(repo.backfillFromSalesAndPurchases('biz-1')).resolves.toEqual({
      salesBackfilled: 3,
      purchasesBackfilled: 2,
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
      balancesUpdated: 0,
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
