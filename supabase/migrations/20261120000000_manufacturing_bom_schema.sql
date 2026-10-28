-- Extend the versioned Manufacturing BOM schema introduced in
-- 20261104000000_manufacturing_bom.sql with version-specific sub-assemblies.
-- BOM line quantities always mean the quantity required for exactly ONE unit
-- of the parent BOM output.

ALTER TABLE public.manufacturing_bom_lines
  ADD COLUMN IF NOT EXISTS component_bom_id uuid
    REFERENCES public.manufacturing_boms(id) ON DELETE RESTRICT;

ALTER TABLE public.manufacturing_bom_lines
  ALTER COLUMN component_product_id DROP NOT NULL;

ALTER TABLE public.manufacturing_bom_lines
  DROP CONSTRAINT IF EXISTS manufacturing_bom_lines_exactly_one_component;

ALTER TABLE public.manufacturing_bom_lines
  ADD CONSTRAINT manufacturing_bom_lines_exactly_one_component CHECK (
    (component_product_id IS NOT NULL AND component_bom_id IS NULL)
    OR (component_product_id IS NULL AND component_bom_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_manufacturing_bom_lines_subassembly
  ON public.manufacturing_bom_lines(component_bom_id)
  WHERE component_bom_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_manufacturing_bom_lines_unique_subassembly
  ON public.manufacturing_bom_lines(bom_id, component_bom_id)
  WHERE component_bom_id IS NOT NULL;

COMMENT ON COLUMN public.manufacturing_bom_lines.component_bom_id IS
  'Specific BOM version used as a sub-assembly; quantities are per one parent output unit.';

CREATE OR REPLACE FUNCTION public.validate_manufacturing_bom_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_business_id uuid;
  v_parent_product_id uuid;
  v_parent_status text;
  v_old_parent_status text;
  v_child_business_id uuid;
  v_child_product_id uuid;
  v_cycle_found boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT b.status INTO v_parent_status
    FROM public.manufacturing_boms b
    WHERE b.id = OLD.bom_id;
    IF v_parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Components can only be changed on draft BOM versions'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  SELECT b.business_id, b.product_id, b.status
    INTO v_parent_business_id, v_parent_product_id, v_parent_status
  FROM public.manufacturing_boms b
  WHERE b.id = NEW.bom_id;
  IF v_parent_business_id IS NULL THEN
    RAISE EXCEPTION 'BOM line must reference a valid BOM version'
      USING ERRCODE = '23503';
  END IF;
  IF v_parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Components can only be changed on draft BOM versions'
      USING ERRCODE = '55000';
  END IF;

  -- Serialize graph edits per business so concurrent writes cannot each pass
  -- a cycle check against an incomplete view of the other transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_parent_business_id::text, 0));

  IF TG_OP = 'UPDATE' AND OLD.bom_id IS DISTINCT FROM NEW.bom_id THEN
    SELECT b.status INTO v_old_parent_status
    FROM public.manufacturing_boms b
    WHERE b.id = OLD.bom_id;
    IF v_old_parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Components can only be changed on draft BOM versions'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.component_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.component_product_id
      AND p.business_id = v_parent_business_id
  ) THEN
    RAISE EXCEPTION 'BOM component product must belong to the same business'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.component_product_id = v_parent_product_id THEN
    RAISE EXCEPTION 'BOM cycle detected: a product cannot contain itself'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.component_bom_id IS NOT NULL THEN
    SELECT b.business_id, b.product_id
      INTO v_child_business_id, v_child_product_id
    FROM public.manufacturing_boms b
    WHERE b.id = NEW.component_bom_id;

    IF v_child_business_id IS NULL OR v_child_business_id <> v_parent_business_id THEN
      RAISE EXCEPTION 'Sub-assembly BOM must belong to the same business'
        USING ERRCODE = '23514';
    END IF;

    -- Compare output products (not version IDs), so an earlier version of the
    -- same product cannot be used to bypass self-reference protection.
    IF v_child_product_id = v_parent_product_id THEN
      RAISE EXCEPTION 'BOM cycle detected: a product cannot contain itself'
        USING ERRCODE = '23514';
    END IF;

    WITH RECURSIVE reachable(product_id, bom_id, path) AS (
      SELECT child.product_id, child.id, ARRAY[child.product_id]::uuid[]
      FROM public.manufacturing_boms child
      WHERE child.id = NEW.component_bom_id
        AND child.business_id = v_parent_business_id
      UNION ALL
      SELECT next_bom.product_id, next_bom.id, reachable.path || next_bom.product_id
      FROM reachable
      JOIN public.manufacturing_bom_lines line
        ON line.bom_id = reachable.bom_id
       AND line.component_bom_id IS NOT NULL
      JOIN public.manufacturing_boms next_bom
        ON next_bom.id = line.component_bom_id
       AND next_bom.business_id = v_parent_business_id
      WHERE NOT next_bom.product_id = ANY(reachable.path)
    )
    SELECT EXISTS (
      SELECT 1 FROM reachable WHERE product_id = v_parent_product_id
    ) INTO v_cycle_found;

    IF v_cycle_found THEN
      RAISE EXCEPTION 'BOM cycle detected: sub-assembly would create a circular reference'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manufacturing_bom_lines_validate ON public.manufacturing_bom_lines;
CREATE TRIGGER trg_manufacturing_bom_lines_validate
  BEFORE INSERT OR UPDATE OR DELETE ON public.manufacturing_bom_lines
  FOR EACH ROW EXECUTE FUNCTION public.validate_manufacturing_bom_line();

REVOKE ALL ON FUNCTION public.validate_manufacturing_bom_line() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_manufacturing_bom_line() TO authenticated;

-- The upstream BOM policies query business_members directly, but that view is
-- intentionally not granted to authenticated. Use definer-only membership
-- predicates instead of exposing the membership view/table to browser roles.
CREATE OR REPLACE FUNCTION public._manufacturing_bom_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_business_member(p_business_id);
$$;

CREATE OR REPLACE FUNCTION public._manufacturing_bom_writer(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.is_active IS TRUE
      AND bu.role::text IN ('owner', 'admin', 'manager')
  );
$$;

REVOKE ALL ON FUNCTION public._manufacturing_bom_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._manufacturing_bom_writer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._manufacturing_bom_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._manufacturing_bom_writer(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS manufacturing_boms_member_read ON public.manufacturing_boms;
CREATE POLICY manufacturing_boms_member_read
  ON public.manufacturing_boms FOR SELECT TO authenticated
  USING (public._manufacturing_bom_member(business_id));

DROP POLICY IF EXISTS manufacturing_boms_member_write ON public.manufacturing_boms;
CREATE POLICY manufacturing_boms_member_write
  ON public.manufacturing_boms FOR ALL TO authenticated
  USING (public._manufacturing_bom_writer(business_id))
  WITH CHECK (public._manufacturing_bom_writer(business_id));

DROP POLICY IF EXISTS manufacturing_bom_lines_member_read ON public.manufacturing_bom_lines;
CREATE POLICY manufacturing_bom_lines_member_read
  ON public.manufacturing_bom_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.manufacturing_boms b
    WHERE b.id = bom_id AND public._manufacturing_bom_member(b.business_id)
  ));

DROP POLICY IF EXISTS manufacturing_bom_lines_member_write ON public.manufacturing_bom_lines;
CREATE POLICY manufacturing_bom_lines_member_write
  ON public.manufacturing_bom_lines FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.manufacturing_boms b
    WHERE b.id = bom_id AND public._manufacturing_bom_writer(b.business_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.manufacturing_boms b
    WHERE b.id = bom_id AND public._manufacturing_bom_writer(b.business_id)
  ));

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'manufacturing_bom_lines'
      AND column_name = 'component_bom_id'
  ) THEN
    RAISE EXCEPTION 'Manufacturing BOM sub-assembly column is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.manufacturing_bom_lines'::regclass
      AND conname = 'manufacturing_bom_lines_exactly_one_component'
  ) THEN
    RAISE EXCEPTION 'Manufacturing BOM component reference constraint is missing';
  END IF;
END
$verify$;
