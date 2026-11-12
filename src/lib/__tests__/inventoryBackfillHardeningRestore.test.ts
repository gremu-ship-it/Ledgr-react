import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261224000005_restore_inventory_backfill_hardening.sql'),
  'utf8',
).toLowerCase();

describe('inventory backfill hardening forward repair', () => {
  it('drops and recreates the prior function with its established five-column result shape', () => {
    expect(sql.indexOf('drop function if exists public.backfill_and_recalculate_inventory(uuid)'))
      .toBeGreaterThanOrEqual(0);
    expect(sql.indexOf('drop function if exists public.backfill_and_recalculate_inventory(uuid)'))
      .toBeLessThan(sql.indexOf('create function public.backfill_and_recalculate_inventory'));
    expect(sql).toMatch(/returns table\s*\([\s\S]*?out_business_id uuid[\s\S]*?sales_backfilled int[\s\S]*?purchases_backfilled int[\s\S]*?adjustments_inserted int[\s\S]*?balances_updated int/);
  });

  it('retains source-ID cross-type safety, status filters, safe opening stock, and service-only grants', () => {
    expect(sql).toContain('sm.source_id::text = e.id::text');
    expect(sql).toContain('sm.source_id::text = i.id::text');
    expect(sql).toContain("i.status::text not in ('draft', 'void', 'credit_note')");
    expect(sql).toContain("coalesce(i.invoice_type, '') <> 'credit_note'");
    expect(sql).toContain("coalesce(e.status, '') not in ('draft', 'void', 'rejected', 'cancelled')");
    expect(sql).toContain("'opening_balance'::public.stock_movement_type");
    expect(sql).toContain('public._ledgr_stock_location');
    expect(sql).toContain('revoke all on function public.backfill_and_recalculate_inventory(uuid) from authenticated');
    expect(sql).toContain('grant execute on function public.backfill_and_recalculate_inventory(uuid) to service_role');
    expect(sql).toContain('idx_stock_movements_business_source');
    expect(sql).toContain('grant insert on public.invoices to authenticated');
    expect(sql).toContain('grant insert on public.invoice_lines to authenticated');
    expect(sql).not.toMatch(/grant execute on function public\.backfill_and_recalculate_inventory\(uuid\) to authenticated/);
  });
});
