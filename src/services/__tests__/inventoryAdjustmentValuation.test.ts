import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the write-off valuation rule in the inventory movement command.
 *
 * THE BUG (Eagle Nova Horizon, Nov 2026)
 * `record_inventory_journal_movement` used the caller's `unit_cost` verbatim for
 * the journal, while the stock subledger only reduces quantity. So the figure
 * typed into the manual adjustment form decided how much value left account
 * 1141, regardless of what the stock was worth.
 *
 * Production evidence — every manual write-off was priced at a round guess:
 *
 *   2026-11-22  -1,100 @ 5,000.00  → 5,500,000   (subledger avg 3,636.36)
 *   2026-11-23  -1,565 @ 5,000.00  → 7,825,000   (subledger avg 4,404.92)
 *   2026-11-14     -90 @ 5,000.00  →   450,000   (subledger avg 4,290.86)
 *
 * Each invented a 1141-vs-subledger variance, which the reconciliation panel
 * then "corrected" with another 5180 entry — pushing the same loss through cost
 * of sales twice. It also inflated the location average cost (the balance
 * formula divides remaining value by a smaller quantity), which is how COGS on
 * later sales drifted above the real purchase cost.
 *
 * The fix values an outflow at the location's current average cost, so 1141 and
 * the subledger always give up the same amount.
 */

const MIGRATION = '20261227000000_inventory_adjustment_uses_stock_cost.sql';
const sql = readFileSync(join(process.cwd(), 'supabase/migrations', MIGRATION), 'utf8');

describe('inventory adjustment valuation', () => {
  it('replaces the movement command', () => {
    expect(sql).toMatch(/create or replace function public\.record_inventory_journal_movement/i);
  });

  it('values an outflow at the location average cost, not the caller figure', () => {
    // The lookup against the subledger balance…
    expect(sql).toMatch(/select b\.average_cost into v_avg_cost/i);
    expect(sql).toMatch(/from public\.inventory_balances b/i);
    expect(sql).toMatch(/and b\.product_id = v_product\.id/i);
    expect(sql).toMatch(/and b\.location_id = v_location/i);
    // …and its use for the GL amount.
    expect(sql).toMatch(/v_gl_cost := case when v_avg_cost is null or v_avg_cost <= 0 then v_cost else v_avg_cost end/i);
    expect(sql).toMatch(/v_amount := round\(v_qty \* v_gl_cost, 2\)/i);
  });

  it('keeps the caller cost for inflows, which is what sets a new average', () => {
    expect(sql).toMatch(/else\s+v_gl_cost := v_cost;\s+end if;/i);
  });

  it('treats every outflow movement type as an outflow', () => {
    // Only adjustment_out was handled before; the others debited inventory
    // while the trigger removed the stock.
    expect(sql).toMatch(
      /v_out := v_type in \('adjustment_out', 'transfer_out', 'return_out', 'write_off'\)/i,
    );
  });

  it('still stores a cost on the movement row (the historical record)', () => {
    expect(sql).toMatch(/quantity, unit_cost, source_type, source_id/i);
    expect(sql).toMatch(/case when v_out then -v_qty else v_qty end, v_gl_cost/i);
  });

  it('never writes the stock off for nothing when an average exists', () => {
    // A zero-cost write-off of stock that carries value would strand that value
    // in 1141 for ever, so the caller figure is the fallback.
    expect(sql).not.toMatch(/v_gl_cost := 0;/i);
  });
});
