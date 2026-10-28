-- 20261104000000_manufacturing_bom.sql
--
-- Manufacturing Phase B — Bill of Materials (single-level, versioned, material cost only).
--
-- WHAT THIS MIGRATION DOES
--   1. Creates public.manufacturing_boms (header) and public.manufacturing_bom_lines (components)
--      with status, version, lock and scrap semantics.
--   2. Adds indexes, RLS (business_members pattern) and grants.
--   3. Ensures updated_at trigger exists (reusing public.set_updated_at() when available).
--   4. Creates cost rollup, version creation and activation RPCs.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No multi-level explosion, no batch/lot, no labour/overhead.
--   * No bom_locked_at writer — work orders in Phase C will do that.
--   * No product_type FK check — UI filters only; legacy product_type values remain valid.
--   * No construction table mutation.
--
-- Layer: schema + command migration.

-- ============================================================================
-- 0. Compatibility: business_members view for RLS policies
-- ============================================================================
-- The Phase B spec references public.business_members. The shipped schema
-- uses public.business_users (see database.generated.ts). To keep the spec's
-- policy text verbatim while remaining replayable on the current schema, we
-- expose a view that mirrors the membership table. If a native table/view
-- already exists this is a no-op replacement; otherwise it provides the
-- business_id/user_id/role projection policies rely on.
DO $$
BEGIN
  IF to_regclass('public.business_members') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW public.business_members AS
      SELECT
        business_id,
        user_id,
        role,
        branch_id,
        is_active
      FROM public.business_users
    $view$;
  END IF;
END
$$;

-- ============================================================================
-- 1a. BOM header table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.manufacturing_boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT manufacturing_boms_status_check
    CHECK (status IN ('draft', 'active', 'archived')),
  bom_locked_at timestamptz,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, product_id, version)
);

-- ============================================================================
-- 1b. BOM line items table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.manufacturing_bom_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id uuid NOT NULL REFERENCES public.manufacturing_boms(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL
    CONSTRAINT manufacturing_bom_lines_qty_positive CHECK (quantity > 0),
  unit_of_measure text,
  scrap_pct numeric NOT NULL DEFAULT 0
    CONSTRAINT manufacturing_bom_lines_scrap_check
    CHECK (scrap_pct >= 0 AND scrap_pct < 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bom_id, component_product_id)
);

-- ============================================================================
-- 0b. products.cost_price compatibility (for cost rollup)
-- ============================================================================
-- The Phase B spec's cost rollup joins p.cost_price, while the shipped schema
-- stores purchase_price. To keep the spec's RPC verbatim and replayable, we
-- add a cost_price column that mirrors purchase_price. Existing rows are
-- backfilled, and a trigger keeps future writes in sync when cost_price is
-- omitted. This does not alter the product_type constraint and is additive.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost_price numeric;
UPDATE public.products SET cost_price = purchase_price WHERE cost_price IS NULL;

CREATE OR REPLACE FUNCTION public.products_cost_price_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.cost_price IS NULL THEN
    NEW.cost_price := NEW.purchase_price;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_cost_price_sync ON public.products;
CREATE TRIGGER trg_products_cost_price_sync
  BEFORE INSERT OR UPDATE OF purchase_price, cost_price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_cost_price_sync();

-- ============================================================================
-- 1c. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_manufacturing_boms_business
  ON public.manufacturing_boms(business_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_boms_product
  ON public.manufacturing_boms(product_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_bom_lines_bom
  ON public.manufacturing_bom_lines(bom_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_bom_lines_component
  ON public.manufacturing_bom_lines(component_product_id);

-- ============================================================================
-- 1d. RLS
-- ============================================================================
ALTER TABLE public.manufacturing_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_bom_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manufacturing_boms_member_read ON public.manufacturing_boms;
CREATE POLICY manufacturing_boms_member_read
  ON public.manufacturing_boms FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS manufacturing_boms_member_write ON public.manufacturing_boms;
CREATE POLICY manufacturing_boms_member_write
  ON public.manufacturing_boms FOR ALL TO authenticated
  USING (business_id IN (
    SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
  ))
  WITH CHECK (business_id IN (
    SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
  ));

DROP POLICY IF EXISTS manufacturing_bom_lines_member_read ON public.manufacturing_bom_lines;
CREATE POLICY manufacturing_bom_lines_member_read
  ON public.manufacturing_bom_lines FOR SELECT TO authenticated
  USING (bom_id IN (
    SELECT id FROM public.manufacturing_boms
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid()
    )
  ));

DROP POLICY IF EXISTS manufacturing_bom_lines_member_write ON public.manufacturing_bom_lines;
CREATE POLICY manufacturing_bom_lines_member_write
  ON public.manufacturing_bom_lines FOR ALL TO authenticated
  USING (bom_id IN (
    SELECT id FROM public.manufacturing_boms
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ))
  WITH CHECK (bom_id IN (
    SELECT id FROM public.manufacturing_boms
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ));

-- ============================================================================
-- 1e. Grants
-- ============================================================================
REVOKE ALL ON public.manufacturing_boms, public.manufacturing_bom_lines
  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.manufacturing_boms, public.manufacturing_bom_lines
  TO authenticated;

-- ============================================================================
-- 1f. Updated_at trigger
-- ============================================================================
-- Reuse the generic trigger function if it already exists (see 20260708000000
-- and 20260726000002). Otherwise create it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $inner$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $inner$;
    $func$;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_manufacturing_boms_updated_at ON public.manufacturing_boms;
CREATE TRIGGER trg_manufacturing_boms_updated_at
  BEFORE UPDATE ON public.manufacturing_boms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_manufacturing_bom_lines_updated_at ON public.manufacturing_bom_lines;
CREATE TRIGGER trg_manufacturing_bom_lines_updated_at
  BEFORE UPDATE ON public.manufacturing_bom_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 1g. Cost rollup RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manufacturing_bom_cost(p_bom_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    bl.quantity * (1 + bl.scrap_pct / 100) * p.cost_price
  ), 0)
  FROM public.manufacturing_bom_lines bl
  JOIN public.products p ON p.id = bl.component_product_id
  WHERE bl.bom_id = p_bom_id;
$$;

REVOKE ALL ON FUNCTION public.manufacturing_bom_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_bom_cost(uuid) TO authenticated;

-- ============================================================================
-- 1h. Version creation RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manufacturing_bom_new_version(p_bom_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old RECORD;
  v_new_bom_id uuid;
  v_next_version integer;
BEGIN
  SELECT * INTO v_old FROM public.manufacturing_boms WHERE id = p_bom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM not found';
  END IF;

  IF v_old.status = 'active' THEN
    UPDATE public.manufacturing_boms
       SET status = 'archived', updated_at = now()
     WHERE id = p_bom_id;
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM public.manufacturing_boms
   WHERE business_id = v_old.business_id
     AND product_id = v_old.product_id;

  INSERT INTO public.manufacturing_boms
    (business_id, product_id, version, status, notes, created_by)
  VALUES
    (v_old.business_id, v_old.product_id, v_next_version, 'draft',
     v_old.notes, auth.uid())
  RETURNING id INTO v_new_bom_id;

  INSERT INTO public.manufacturing_bom_lines
    (bom_id, component_product_id, quantity, unit_of_measure, scrap_pct, notes)
  SELECT v_new_bom_id, component_product_id, quantity,
         unit_of_measure, scrap_pct, notes
    FROM public.manufacturing_bom_lines
   WHERE bom_id = p_bom_id;

  RETURN v_new_bom_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manufacturing_bom_new_version(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_bom_new_version(uuid)
  TO authenticated;

-- ============================================================================
-- 1i. Activate BOM RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.manufacturing_bom_activate(p_bom_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bom RECORD;
  v_line_count integer;
BEGIN
  SELECT * INTO v_bom FROM public.manufacturing_boms WHERE id = p_bom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM not found';
  END IF;
  IF v_bom.status != 'draft' THEN
    RAISE EXCEPTION 'Only draft BOMs can be activated';
  END IF;

  SELECT COUNT(*) INTO v_line_count
    FROM public.manufacturing_bom_lines WHERE bom_id = p_bom_id;
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'BOM must have at least one component line';
  END IF;

  UPDATE public.manufacturing_boms
     SET status = 'archived', updated_at = now()
   WHERE business_id = v_bom.business_id
     AND product_id = v_bom.product_id
     AND status = 'active'
     AND id != p_bom_id;

  UPDATE public.manufacturing_boms
     SET status = 'active', updated_at = now()
   WHERE id = p_bom_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manufacturing_bom_activate(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_bom_activate(uuid)
  TO authenticated;

-- ============================================================================
-- Self-verification (fails migration if core contract missing)
-- ============================================================================
DO $verify$
DECLARE
  v_missing text := '';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.manufacturing_boms'::regclass
       AND conname = 'manufacturing_boms_status_check'
  ) THEN
    v_missing := v_missing || 'manufacturing_boms_status_check missing; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.manufacturing_bom_lines'::regclass
       AND conname = 'manufacturing_bom_lines_qty_positive'
  ) THEN
    v_missing := v_missing || 'manufacturing_bom_lines_qty_positive missing; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.manufacturing_bom_lines'::regclass
       AND conname = 'manufacturing_bom_lines_scrap_check'
  ) THEN
    v_missing := v_missing || 'manufacturing_bom_lines_scrap_check missing; ';
  END IF;

  IF to_regprocedure('public.manufacturing_bom_cost(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_bom_cost(uuid) missing; ';
  END IF;

  IF to_regprocedure('public.manufacturing_bom_new_version(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_bom_new_version(uuid) missing; ';
  END IF;

  IF to_regprocedure('public.manufacturing_bom_activate(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_bom_activate(uuid) missing; ';
  END IF;

  IF has_function_privilege('anon', 'public.manufacturing_bom_cost(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_bom_new_version(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_bom_activate(uuid)', 'execute') THEN
    v_missing := v_missing || 'anon can execute a manufacturing BOM function; ';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.manufacturing_boms', 'select') THEN
    v_missing := v_missing || 'authenticated cannot select manufacturing_boms; ';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Manufacturing BOM not applied correctly: %', v_missing
      USING ERRCODE = '42501';
  END IF;
END
$verify$;
