import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261106000000_extend_location_types.sql',
  'utf8',
);
const FOUNDATION_SQL = readFileSync(
  'supabase/migrations/20261103000000_manufacturing_foundation.sql',
  'utf8',
);

/**
 * Static contract for the P2-2 location-type extension.
 *
 * These assertions guard the shape of the migration in the fast suite, the
 * same division of labour the manufacturing contract tests use: the constraint
 * VALUES and the additive-only discipline are asserted here; the constraint
 * actually enforcing them is a database concern proved by replaying the chain
 * (tests/release/database.test.ts replays every migration in order).
 */
describe('extend_location_types migration contract', () => {
  it('is the migration head and uniquely versioned', () => {
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
    const versions = files.map((f) => f.split('_')[0]);
    // Later migrations extend the head; this list is the allow-list of known
    // heads, mirroring manufacturingFoundationMigration.test.ts.
    expect(versions[versions.length - 1]).toBe('20261106000000');
    expect(versions.filter((v) => v === '20261106000000')).toHaveLength(1);
    // It follows the manufacturing Phase D dashboard migration.
    expect(versions.indexOf('20261106000000')).toBe(versions.indexOf('20261105000002') + 1);
  });

  it('replaces the constraint idempotently (drop-if-exists then add)', () => {
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS inventory_locations_location_type_check');
    expect(sql).toContain('ADD CONSTRAINT inventory_locations_location_type_check');
  });

  it('keeps every existing value — the new CHECK is a strict superset', () => {
    // The four values the manufacturing foundation migration shipped must all
    // survive, so no stored row becomes invalid and the foundation replay
    // verifier (LIKE '%production_floor%') keeps passing.
    for (const value of [
      'warehouse',
      'raw_materials_store',
      'production_floor',
      'finished_goods_store',
    ]) {
      expect(sql).toContain(`'${value}'`);
      expect(FOUNDATION_SQL).toContain(`'${value}'`);
    }
  });

  it('adds exactly the three construction values', () => {
    for (const value of ['job_site', 'site_office', 'material_yard']) {
      expect(sql).toContain(`'${value}'`);
    }
    // No unrequested vocabulary sneaks in.
    const constraint = sql.slice(
      sql.indexOf('ADD CONSTRAINT inventory_locations_location_type_check'),
      sql.indexOf('COMMENT ON COLUMN'),
    );
    const values = [...constraint.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values.sort()).toEqual(
      [
        'warehouse',
        'raw_materials_store',
        'production_floor',
        'finished_goods_store',
        'job_site',
        'site_office',
        'material_yard',
      ].sort(),
    );
  });

  it('is additive-only: no column, function, policy, grant or provision change', () => {
    expect(sql).not.toMatch(/ADD\s+COLUMN/i);
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
    expect(sql).not.toMatch(/^\s*GRANT\s/im);
    expect(sql).not.toMatch(/^\s*REVOKE\s/im);
    // The provisioning functions are untouchable per the P2 constraints —
    // they may be named in comments, never in statements.
    expect(sql).not.toMatch(/(CREATE|ALTER|DROP)\s+[\s\S]*provision_/i);
  });

  it('documents the vertical vocabulary on the column comment', () => {
    expect(sql).toContain('COMMENT ON COLUMN public.inventory_locations.location_type');
    expect(sql).toMatch(/warehouse=universal/);
    expect(sql).toMatch(/job_site\/site_office\/material_yard=construction/);
  });
});
