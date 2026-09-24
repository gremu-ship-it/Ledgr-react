/**
 * Contract for 20261009000000_single_balance_trigger_and_wac.sql.
 *
 * CI does not boot Postgres for vitest. This reads the migration the deploy
 * will apply and fails if the one-writer / blank-cost / Eagle Nova repair
 * clauses are edited out. The embedded-Postgres harness in
 * tests/database/stock_movement_balance_trigger.test.js executes the same file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  path.resolve(
    process.cwd(),
    'supabase/migrations/20261009000000_single_balance_trigger_and_wac.sql',
  ),
  'utf8',
);

describe('20261009000000 single balance trigger and weighted average', () => {
  it('drops the R06 duplicate before it can fire on the repair', () => {
    const dropAt = sql.indexOf(
      'drop trigger if exists trg_stock_movement_apply_balance on public.stock_movements;',
    );
    const repairAt = sql.indexOf('Eagle Nova manure');
    expect(dropAt).toBeGreaterThan(-1);
    expect(repairAt).toBeGreaterThan(dropAt);
  });

  it('does not let a null or zero inbound cost change an existing average', () => {
    expect(sql).toContain('coalesce(p_unit_cost, 0) > 0');
    expect(sql).toMatch(/else ib\.average_cost/);
  });

  it('fails the deploy unless exactly one balance trigger remains', () => {
    expect(sql).toContain('if v_count <> 1 then');
    expect(sql).toContain(
      'expected exactly one inventory-balance trigger on public.stock_movements',
    );
  });

  it('repairs only Eagle Nova manure, and only the drifts the 24 Sep snapshot explained', () => {
    expect(sql).toContain("'93851ac2-73ac-4241-b462-ec8d9d663f8b'");
    expect(sql).toContain("pr.name ilike '%manure%'");
    expect(sql).toContain('d.difference < 0');
    expect(sql).toContain("il.name ilike '%area%49%' and d.difference > 0");
    expect(sql).toContain('d.ledger_quantity >= coalesce(ib.quantity_reserved, 0)');
    // A location with no costed inbound keeps the average it already has.
    expect(sql).toContain('and coalesce(sm.unit_cost, 0) > 0');
  });

  it('does not write quantity_available (production stores it as a generated column)', () => {
    const repair = sql.slice(sql.indexOf('-- ── 4. Eagle Nova manure'));
    expect(repair).not.toMatch(/quantity_available\s*=/);
    expect(repair).not.toContain('quantity_available');
  });
});
