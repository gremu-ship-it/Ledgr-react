import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261103000000_manufacturing_foundation.sql',
  'utf8',
);
const CONSTRUCTION_SQL = readFileSync(
  'supabase/migrations/20261027000000_construction_operating_model_defaults.sql',
  'utf8',
);

/**
 * Static contract for the Manufacturing Phase A migration.
 *
 * These assertions guard the shape of the migration in the fast suite; the
 * behaviour they describe (constraints enforced, stores and grants created,
 * first-free WIP account code) is proved against a real PostgreSQL in
 * tests/release/manufacturing-provisioning.test.ts.
 */
describe('manufacturing foundation migration contract', () => {
  it('uses the next available timestamp after the latest migration', () => {
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
    const versions = files.map((f) => f.split('_')[0]);
    const latest = versions[versions.length - 1];
    // Later manufacturing phases extend the migration head. Phase D dashboard
    // reporting follows the Phase C work-order migrations.
    expect(['20261103000000', '20261104000000', '20261105000001', '20261105000002']).toContain(latest);
    expect(versions.filter((v) => v === '20261103000000')).toHaveLength(1);
    expect(versions.filter((v) => v === '20261104000000')).toHaveLength(1);
  });

  it('adds MANUFACTURING to the operating-model vocabulary without dropping CONSTRUCTION', () => {
    expect(sql).toContain("'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION', 'MANUFACTURING'");
    // Both the table CHECK and the two validating RPCs must accept the new value.
    const occurrences = sql.split("'MANUFACTURING'").length - 1;
    expect(occurrences).toBeGreaterThan(3);
    // Construction keeps working: this migration never narrows its vocabulary.
    expect(CONSTRUCTION_SQL).toContain("'CONSTRUCTION'");
  });

  // ── §4a products.product_type ──────────────────────────────────────────────
  describe('products.product_type', () => {
    it('alters the existing column in place — never ADD COLUMN', () => {
      expect(sql).not.toMatch(/add\s+column\s+(if\s+not\s+exists\s+)?product_type/i);
      expect(sql).toContain('ALTER TABLE public.products');
      expect(sql).toContain('ALTER COLUMN product_type SET DEFAULT');
    });

    it('guards for idempotency before adding the constraint', () => {
      expect(sql).toContain('DROP CONSTRAINT IF EXISTS products_product_type_check');
      expect(sql).toContain('ADD CONSTRAINT products_product_type_check');
    });

    it('constrains the column to the four canonical manufacturing values', () => {
      for (const value of ['raw_material', 'wip', 'finished_good', 'trading_good']) {
        expect(sql).toContain(`'${value}'`);
      }
    });

    it('keeps the legacy product/service vocabulary the shipped UI still writes', () => {
      // Additive by decision: constraining the column to the four manufacturing
      // values alone would reclassify every existing product and make
      // ProductsPage fail with 23514 on every save.
      for (const value of ['product', 'service', 'goods', 'inventory']) {
        expect(sql).toContain(`'${value}'`);
      }
    });

    it('backfills only genuinely unrecognised rows', () => {
      // The UPDATE is scoped to values outside the accepted set, so no product
      // that already holds a known vocabulary value is rewritten.
      const update = sql.slice(sql.indexOf('UPDATE public.products'));
      expect(update).toContain("SET product_type = 'trading_good'");
      expect(update).toContain('NOT IN');
      expect(update).toContain('product_type IS NULL');
    });
  });

  // ── §4b inventory_locations.location_type ──────────────────────────────────
  describe('inventory_locations.location_type', () => {
    it('ADDs the column — it does not exist yet', () => {
      expect(sql).toContain('ALTER TABLE public.inventory_locations');
      expect(sql).toContain('ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT');
    });

    it('constrains it to the four store types with warehouse as the default', () => {
      expect(sql).toContain("DEFAULT 'warehouse'");
      for (const value of ['warehouse', 'raw_materials_store', 'production_floor', 'finished_goods_store']) {
        expect(sql).toContain(`'${value}'`);
      }
      expect(sql).toContain('inventory_locations_location_type_check');
    });
  });

  // ── §4c WIP Inventory COA account ──────────────────────────────────────────
  describe('WIP Inventory account', () => {
    it('takes the first available code in 1200–1299, locked against concurrent writers', () => {
      expect(sql).toContain('generate_series(1200, 1299)');
      expect(sql).toContain('LOCK TABLE public.accounts IN SHARE ROW EXCLUSIVE MODE');
      expect(sql).toContain('FOR UPDATE');
      expect(sql).toContain('btrim(a.code) = codes.code::text');
    });

    it('is a system asset posted as a debit, parented to the Inventory group', () => {
      expect(sql).toContain("'WIP Inventory'");
      expect(sql).toContain("'asset', 'current_asset', 'debit', false, true, false");
      // 1140 Inventory group, with the 1100 Current Assets fallback.
      expect(sql).toContain("a.code = '1140'");
      expect(sql).toContain("a.code = '1100'");
    });

    it('is idempotent and backfills existing manufacturing businesses', () => {
      expect(sql).toContain('provision_manufacturing_coa_accounts');
      expect(sql).toContain("'MANUFACTURING' = ANY (COALESCE(b.operating_models, ARRAY[]::text[]))");
      expect(sql).toContain("lower(btrim(a.name)) = lower('WIP Inventory')");
    });
  });

  // ── §4d capability codes ───────────────────────────────────────────────────
  describe('manufacturing capability codes', () => {
    it('registers manufacturing.bom.manage in its own vocabulary', () => {
      expect(sql).toContain('create table if not exists public.manufacturing_capabilities');
      expect(sql).toContain("('manufacturing.bom.manage'");
      expect(sql).toContain('on conflict (code) do update');
    });

    it('grants through the established grants shape, not a new bespoke mechanism', () => {
      expect(sql).toContain('create table if not exists public.manufacturing_capability_grants');
      expect(sql).toContain('revoked_at');
      expect(sql).toContain('on public.manufacturing_capability_grants (business_id, user_id, capability)');
      expect(sql).toContain('where revoked_at is null');
    });

    it('does not create a second writer on a construction table', () => {
      expect(sql).not.toMatch(/alter\s+table\s+public\.construction_procurement_grants/i);
      expect(sql).not.toMatch(/create\s+table\s+(if\s+not\s+exists\s+)?public\.construction/i);
    });
  });

  // ── §5 provisioning ────────────────────────────────────────────────────────
  describe('provisioning', () => {
    it('creates the three typed stores', () => {
      expect(sql).toContain("('Raw Materials Store',   'raw_materials_store')");
      expect(sql).toContain("('Production Floor',      'production_floor')");
      expect(sql).toContain("('Finished Goods Store',  'finished_goods_store')");
    });

    it('grants manufacturing.bom.manage to the nominated owner', () => {
      expect(sql).toContain("'manufacturing.bom.manage'");
      expect(sql).toContain('provision_manufacturing_defaults');
    });

    it('fails closed: signed in, owner/admin, and MANUFACTURING selected', () => {
      expect(sql).toContain("IF NOT ('MANUFACTURING' = ANY (COALESCE(v_models, ARRAY[]::text[]))) THEN");
      expect(sql).toContain("v_role IS NULL OR v_role NOT IN ('owner', 'admin')");
      expect(sql).toContain("v_owner_role IS NULL OR v_owner_role NOT IN ('owner', 'admin')");
    });

    it('is idempotent and refuses execution by anon', () => {
      expect(sql).toContain('ON CONFLICT (business_id, user_id, capability) WHERE revoked_at IS NULL DO NOTHING');
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.provision_manufacturing_defaults(uuid, uuid) FROM PUBLIC, anon');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.provision_manufacturing_defaults(uuid, uuid) TO authenticated');
    });
  });

  it('verifies itself and leaves the construction vertical intact', () => {
    expect(sql).toContain('Manufacturing foundation not applied correctly');
    expect(sql).toContain("to_regprocedure('public.provision_construction_defaults(uuid,uuid)') IS NULL");
    expect(sql).toContain("to_regprocedure('public.grant_construction_procurement_capability(uuid,uuid,text,text)') IS NULL");
  });
});
