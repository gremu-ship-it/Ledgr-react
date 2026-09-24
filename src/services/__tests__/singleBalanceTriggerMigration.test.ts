/**
 * Contract for 20261010000000_eagle_nova_manure_balance_repair.sql.
 *
 * The single balance writer lives in 20261009000000_r06_single_stock_balance_writer.sql.
 * This file must not install or drop a trigger — that version prefix is already
 * taken, and dropping trg_stock_movement_apply_balance would undo the writer
 * the deploy just made canonical.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  path.resolve(
    process.cwd(),
    'supabase/migrations/20261010000000_eagle_nova_manure_balance_repair.sql',
  ),
  'utf8',
);

describe('20261010000000 Eagle Nova manure balance repair', () => {
  it('repairs only Eagle Nova manure, and only the drifts the 24 Sep snapshot explained', () => {
    expect(sql).toContain("'93851ac2-73ac-4241-b462-ec8d9d663f8b'");
    expect(sql).toContain("pr.name ilike '%manure%'");
    expect(sql).toContain('d.difference < 0');
    expect(sql).toContain("il.name ilike '%area%49%' and d.difference > 0");
    expect(sql).toContain('d.ledger_quantity >= coalesce(ib.quantity_reserved, 0)');
    expect(sql).toContain('and coalesce(sm.unit_cost, 0) > 0');
  });

  it('does not write quantity_available or touch the balance trigger', () => {
    expect(sql).not.toMatch(/quantity_available\s*=/);
    expect(sql).not.toMatch(/drop\s+trigger/i);
    expect(sql).not.toMatch(/create\s+trigger/i);
  });
});
