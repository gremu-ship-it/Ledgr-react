import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const sql = readFileSync('supabase/migrations/20261104000000_manufacturing_bom.sql', 'utf8');

/**
 * Static contract for Manufacturing Phase B — BOM.
 * These assertions guard the migration shape; behaviour is proved in release
 * suite with real PostgreSQL (and mirrored in component tests).
 */
describe('manufacturing BOM migration contract', () => {
  it('uses the next available timestamp after the foundation', () => {
    const files = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const versions = files.map((f) => f.split('_')[0]);
    const idxFoundation = versions.indexOf('20261103000000');
    const idxBom = versions.indexOf('20261104000000');
    expect(idxFoundation).toBeGreaterThan(-1);
    expect(idxBom).toBeGreaterThan(-1);
    expect(idxBom).toBe(idxFoundation + 1);
    expect(versions.filter((v) => v === '20261104000000')).toHaveLength(1);
  });

  describe('1a. BOM header table', () => {
    it('creates manufacturing_boms with required columns and constraints', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_boms');
      expect(sql).toContain('business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE');
      expect(sql).toContain('product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT');
      expect(sql).toContain('version integer NOT NULL DEFAULT 1');
      expect(sql).toContain("status text NOT NULL DEFAULT 'draft'");
      expect(sql).toContain('manufacturing_boms_status_check');
      expect(sql).toContain("CHECK (status IN ('draft', 'active', 'archived'))");
      expect(sql).toContain('bom_locked_at timestamptz');
      expect(sql).toContain('notes text');
      expect(sql).toContain('created_by uuid NOT NULL REFERENCES auth.users(id)');
      expect(sql).toContain('UNIQUE (business_id, product_id, version)');
    });

    it('does not enforce product_type at DB level', () => {
      // No FK check on product_type — UI filtering only
      const headerSection = sql.slice(
        sql.indexOf('CREATE TABLE IF NOT EXISTS public.manufacturing_boms'),
        sql.indexOf('CREATE TABLE IF NOT EXISTS public.manufacturing_bom_lines'),
      );
      expect(headerSection).not.toMatch(/product_type/);
    });
  });

  describe('1b. BOM line items table', () => {
    it('creates manufacturing_bom_lines with required columns and constraints', () => {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_bom_lines');
      expect(sql).toContain('bom_id uuid NOT NULL REFERENCES public.manufacturing_boms(id) ON DELETE CASCADE');
      expect(sql).toContain('component_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT');
      expect(sql).toContain('quantity numeric NOT NULL');
      expect(sql).toContain('manufacturing_bom_lines_qty_positive CHECK (quantity > 0)');
      expect(sql).toContain('unit_of_measure text');
      expect(sql).toContain('scrap_pct numeric NOT NULL DEFAULT 0');
      expect(sql).toContain('manufacturing_bom_lines_scrap_check');
      expect(sql).toContain('CHECK (scrap_pct >= 0 AND scrap_pct < 100)');
      expect(sql).toContain('UNIQUE (bom_id, component_product_id)');
    });
  });

  describe('1c. Indexes', () => {
    it('creates all four indexes', () => {
      expect(sql).toContain('idx_manufacturing_boms_business');
      expect(sql).toContain('ON public.manufacturing_boms(business_id)');
      expect(sql).toContain('idx_manufacturing_boms_product');
      expect(sql).toContain('ON public.manufacturing_boms(product_id)');
      expect(sql).toContain('idx_manufacturing_bom_lines_bom');
      expect(sql).toContain('ON public.manufacturing_bom_lines(bom_id)');
      expect(sql).toContain('idx_manufacturing_bom_lines_component');
      expect(sql).toContain('ON public.manufacturing_bom_lines(component_product_id)');
    });
  });

  describe('1d. RLS', () => {
    it('enables RLS on both tables', () => {
      expect(sql).toContain('ALTER TABLE public.manufacturing_boms ENABLE ROW LEVEL SECURITY');
      expect(sql).toContain('ALTER TABLE public.manufacturing_bom_lines ENABLE ROW LEVEL SECURITY');
    });

    it('creates member read/write policies using business_members pattern', () => {
      expect(sql).toContain('manufacturing_boms_member_read');
      expect(sql).toContain('manufacturing_boms_member_write');
      expect(sql).toContain('manufacturing_bom_lines_member_read');
      expect(sql).toContain('manufacturing_bom_lines_member_write');
      // Business-scoped via business_members table, not _ledgr_construction_actor
      expect(sql).toContain('business_id IN (');
      expect(sql).toContain('SELECT business_id FROM public.business_members');
      expect(sql).toContain('WHERE user_id = auth.uid()');
      expect(sql).toContain("role IN ('owner', 'admin', 'manager')");
      expect(sql).not.toContain('_ledgr_construction_actor');
    });

    it('bom_lines policies reference bom_id via manufacturing_boms', () => {
      expect(sql).toContain('bom_id IN (');
      expect(sql).toContain('SELECT id FROM public.manufacturing_boms');
    });
  });

  describe('1e. Grants', () => {
    it('revokes public/anon and grants authenticated', () => {
      expect(sql).toContain('REVOKE ALL ON public.manufacturing_boms, public.manufacturing_bom_lines');
      expect(sql).toContain('FROM PUBLIC, anon');
      expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE');
      expect(sql).toContain('ON public.manufacturing_boms, public.manufacturing_bom_lines');
      expect(sql).toContain('TO authenticated');
    });
  });

  describe('1f. Updated_at trigger', () => {
    it('reuses or creates set_updated_at and creates triggers', () => {
      expect(sql).toContain('set_updated_at');
      expect(sql).toContain('trg_manufacturing_boms_updated_at');
      expect(sql).toContain('trg_manufacturing_bom_lines_updated_at');
      expect(sql).toContain('BEFORE UPDATE ON public.manufacturing_boms');
      expect(sql).toContain('BEFORE UPDATE ON public.manufacturing_bom_lines');
    });
  });

  describe('1g. Cost rollup RPC', () => {
    it('creates manufacturing_bom_cost with scrap inflation', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_bom_cost(p_bom_id uuid)');
      expect(sql).toContain('RETURNS numeric');
      expect(sql).toContain('STABLE');
      expect(sql).toContain('SECURITY DEFINER');
      expect(sql).toContain('bl.quantity * (1 + bl.scrap_pct / 100) * p.cost_price');
      expect(sql).toContain('COALESCE(SUM(');
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.manufacturing_bom_cost(uuid) FROM PUBLIC, anon');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.manufacturing_bom_cost(uuid) TO authenticated');
    });
  });

  describe('1h. Version creation RPC', () => {
    it('creates manufacturing_bom_new_version with archive and copy semantics', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_bom_new_version(p_bom_id uuid)');
      expect(sql).toContain('RETURNS uuid');
      expect(sql).toContain("RAISE EXCEPTION 'BOM not found'");
      expect(sql).toContain("IF v_old.status = 'active' THEN");
      expect(sql).toContain("SET status = 'archived'");
      expect(sql).toContain('COALESCE(MAX(version), 0) + 1');
      expect(sql).toContain('INSERT INTO public.manufacturing_boms');
      expect(sql).toContain('(business_id, product_id, version, status, notes, created_by)');
      expect(sql).toContain('INSERT INTO public.manufacturing_bom_lines');
      expect(sql).toContain('RETURN v_new_bom_id');
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.manufacturing_bom_new_version(uuid)');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.manufacturing_bom_new_version(uuid)');
    });
  });

  describe('1i. Activate BOM RPC', () => {
    it('creates manufacturing_bom_activate with validation and archiving', () => {
      expect(sql).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_bom_activate(p_bom_id uuid)');
      expect(sql).toContain('RETURNS void');
      expect(sql).toContain("RAISE EXCEPTION 'Only draft BOMs can be activated'");
      expect(sql).toContain("RAISE EXCEPTION 'BOM must have at least one component line'");
      expect(sql).toContain("SELECT COUNT(*) INTO v_line_count");
      expect(sql).toContain("WHERE bom_id = p_bom_id");
      expect(sql).toContain("SET status = 'archived'");
      expect(sql).toContain("SET status = 'active'");
      expect(sql).toContain('REVOKE ALL ON FUNCTION public.manufacturing_bom_activate(uuid)');
      expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.manufacturing_bom_activate(uuid)');
    });
  });

  it('does not modify construction tables or product_type CHECK from Phase A', () => {
    expect(sql).not.toMatch(/alter\s+table\s+public\.construction/i);
    expect(sql).not.toMatch(/create\s+table.*public\.construction/i);
    // product_type constraint is from Phase A, not changed here
    expect(sql).not.toContain('products_product_type_check');
  });

  it('includes self-verification', () => {
    expect(sql).toContain('Manufacturing BOM not applied correctly');
    expect(sql).toContain('has_function_privilege');
  });
});
