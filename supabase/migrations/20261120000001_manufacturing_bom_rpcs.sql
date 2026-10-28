-- Save and activate versioned multi-level BOMs using the existing
-- manufacturing_boms / manufacturing_bom_lines model.

-- Multi-level material cost per ONE output unit. Raw material lines contribute
-- their own unit cost; sub-assembly lines recursively expand their selected
-- BOM version and multiply by each parent quantity and scrap factor.
CREATE OR REPLACE FUNCTION public.manufacturing_bom_cost(p_bom_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_total numeric;
BEGIN
  SELECT b.business_id INTO v_business_id
  FROM public.manufacturing_boms b
  WHERE b.id = p_bom_id;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'BOM not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = v_business_id
      AND bu.user_id = auth.uid()
      AND bu.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Not authorized for this business' USING ERRCODE = '42501';
  END IF;

  WITH RECURSIVE bom_walk(bom_id, multiplier, path, depth) AS (
    SELECT b.id, 1::numeric, ARRAY[b.product_id]::uuid[], 0
    FROM public.manufacturing_boms b
    WHERE b.id = p_bom_id AND b.business_id = v_business_id
    UNION ALL
    SELECT child.id,
           walk.multiplier * line.quantity * (1 + line.scrap_pct / 100),
           walk.path || child.product_id,
           walk.depth + 1
    FROM bom_walk walk
    JOIN public.manufacturing_bom_lines line ON line.bom_id = walk.bom_id
    JOIN public.manufacturing_boms child
      ON child.id = line.component_bom_id
     AND child.business_id = v_business_id
    WHERE line.component_bom_id IS NOT NULL
      AND walk.depth < 32
      AND NOT child.product_id = ANY(walk.path)
  )
  SELECT COALESCE(SUM(
    walk.multiplier * line.quantity * (1 + line.scrap_pct / 100) * COALESCE(product.cost_price, 0)
  ), 0)
  INTO v_total
  FROM bom_walk walk
  JOIN public.manufacturing_bom_lines line ON line.bom_id = walk.bom_id
  JOIN public.products product
    ON product.id = line.component_product_id
   AND product.business_id = v_business_id
  WHERE line.component_product_id IS NOT NULL;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.manufacturing_bom_cost(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_bom_cost(uuid) TO authenticated;

-- Clone the selected version as a draft without archiving the active version.
-- The active revision remains available until the draft is explicitly activated.
CREATE OR REPLACE FUNCTION public.manufacturing_bom_new_version(p_bom_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.manufacturing_boms%ROWTYPE;
  v_new_bom_id uuid;
  v_next_version integer;
BEGIN
  SELECT * INTO v_old
  FROM public.manufacturing_boms
  WHERE id = p_bom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = v_old.business_id
      AND bu.user_id = auth.uid()
      AND bu.is_active IS TRUE
      AND bu.role IN ('owner', 'admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to create a BOM version' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_old.business_id::text, 0));
  PERFORM 1 FROM public.products p
  WHERE p.id = v_old.product_id AND p.business_id = v_old.business_id
  FOR UPDATE;

  SELECT * INTO v_old
  FROM public.manufacturing_boms
  WHERE id = p_bom_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old.bom_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Locked BOM versions cannot be copied' USING ERRCODE = '55000';
  END IF;
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
  FROM public.manufacturing_boms
  WHERE business_id = v_old.business_id AND product_id = v_old.product_id;

  INSERT INTO public.manufacturing_boms
    (business_id, product_id, version, status, notes, created_by)
  VALUES
    (v_old.business_id, v_old.product_id, v_next_version, 'draft', v_old.notes, auth.uid())
  RETURNING id INTO v_new_bom_id;

  INSERT INTO public.manufacturing_bom_lines
    (bom_id, component_product_id, component_bom_id, quantity, unit_of_measure, scrap_pct, notes)
  SELECT v_new_bom_id, component_product_id, component_bom_id, quantity,
         unit_of_measure, scrap_pct, notes
  FROM public.manufacturing_bom_lines
  WHERE bom_id = p_bom_id;

  RETURN v_new_bom_id;
END;
$$;

REVOKE ALL ON FUNCTION public.manufacturing_bom_new_version(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_bom_new_version(uuid) TO authenticated;

-- Save a BOM version atomically. A draft can be edited in place; saving from an
-- active/archived version creates the next draft version. p_components contains
-- per-one-output-unit quantities and exactly one of component_product_id or
-- component_bom_id for each line.
CREATE OR REPLACE FUNCTION public.save_bom_version(
  p_business_id uuid,
  p_bom_id uuid,
  p_product_id uuid,
  p_notes text,
  p_components jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.manufacturing_boms%ROWTYPE;
  v_bom_id uuid;
  v_next_version integer;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id
      AND bu.user_id = auth.uid()
      AND bu.is_active IS TRUE
      AND bu.role IN ('owner', 'admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to save a BOM for this business' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  IF p_components IS NULL OR jsonb_typeof(p_components) <> 'array' THEN
    RAISE EXCEPTION 'BOM components must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'BOM output product must belong to the same business' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS component(
      component_product_id uuid,
      component_bom_id uuid,
      quantity numeric,
      unit_of_measure text,
      scrap_pct numeric,
      notes text
    )
    WHERE component.quantity IS NULL OR component.quantity <= 0
       OR COALESCE(component.scrap_pct, 0) < 0
       OR COALESCE(component.scrap_pct, 0) >= 100
       OR NOT (
         (component.component_product_id IS NOT NULL AND component.component_bom_id IS NULL)
         OR (component.component_product_id IS NULL AND component.component_bom_id IS NOT NULL)
       )
  ) THEN
    RAISE EXCEPTION 'Each BOM component needs one product or sub-assembly and a positive quantity'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the output product to serialize version-number allocation.
  PERFORM 1 FROM public.products p
  WHERE p.id = p_product_id AND p.business_id = p_business_id
  FOR UPDATE;

  IF p_bom_id IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.manufacturing_boms b
    WHERE b.id = p_bom_id AND b.business_id = p_business_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'BOM was not found for this business' USING ERRCODE = 'P0002';
    END IF;
    IF v_existing.product_id <> p_product_id THEN
      RAISE EXCEPTION 'A BOM version cannot change its output product' USING ERRCODE = '23514';
    END IF;
    IF v_existing.bom_locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'Locked BOM versions cannot be changed' USING ERRCODE = '55000';
    END IF;
  END IF;

  IF p_bom_id IS NOT NULL AND v_existing.status = 'draft' THEN
    v_bom_id := v_existing.id;
    UPDATE public.manufacturing_boms
    SET notes = NULLIF(btrim(COALESCE(p_notes, '')), '')
    WHERE id = v_bom_id;
    DELETE FROM public.manufacturing_bom_lines WHERE bom_id = v_bom_id;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
    FROM public.manufacturing_boms
    WHERE business_id = p_business_id AND product_id = p_product_id;

    INSERT INTO public.manufacturing_boms
      (business_id, product_id, version, status, notes, created_by)
    VALUES
      (p_business_id, p_product_id, v_next_version, 'draft',
       NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid())
    RETURNING id INTO v_bom_id;
  END IF;

  INSERT INTO public.manufacturing_bom_lines
    (bom_id, component_product_id, component_bom_id, quantity, unit_of_measure, scrap_pct, notes)
  SELECT
    v_bom_id,
    component.component_product_id,
    component.component_bom_id,
    component.quantity,
    NULLIF(btrim(COALESCE(component.unit_of_measure, '')), ''),
    COALESCE(component.scrap_pct, 0),
    NULLIF(btrim(COALESCE(component.notes, '')), '')
  FROM jsonb_to_recordset(p_components) AS component(
    component_product_id uuid,
    component_bom_id uuid,
    quantity numeric,
    unit_of_measure text,
    scrap_pct numeric,
    notes text
  );

  RETURN v_bom_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_bom_version(uuid, uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_bom_version(uuid, uuid, uuid, text, jsonb) TO authenticated;

-- Activation is the only point at which the previous active version is
-- archived. Keep the upstream void RPC contract; repositories re-read by ID.
CREATE OR REPLACE FUNCTION public.manufacturing_bom_activate(p_bom_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bom public.manufacturing_boms%ROWTYPE;
  v_line_count integer;
BEGIN
  SELECT * INTO v_bom
  FROM public.manufacturing_boms
  WHERE id = p_bom_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM not found' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = v_bom.business_id
      AND bu.user_id = auth.uid()
      AND bu.is_active IS TRUE
      AND bu.role IN ('owner', 'admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'Not authorized to activate this BOM' USING ERRCODE = '42501';
  END IF;
  IF v_bom.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft BOMs can be activated' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_line_count
  FROM public.manufacturing_bom_lines
  WHERE bom_id = p_bom_id;
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'BOM must have at least one component line' USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_boms
  SET status = 'archived', updated_at = now()
  WHERE business_id = v_bom.business_id
    AND product_id = v_bom.product_id
    AND status = 'active'
    AND id <> p_bom_id;

  UPDATE public.manufacturing_boms
  SET status = 'active', updated_at = now()
  WHERE id = p_bom_id;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.manufacturing_bom_activate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_bom_activate(uuid) TO authenticated;

DO $verify$
DECLARE
  v_missing text := '';
BEGIN
  IF to_regprocedure('public.save_bom_version(uuid,uuid,uuid,text,jsonb)') IS NULL THEN
    v_missing := v_missing || 'save_bom_version missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_bom_activate(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_bom_activate missing; ';
  END IF;
  IF has_function_privilege('anon', 'public.save_bom_version(uuid,uuid,uuid,text,jsonb)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_bom_activate(uuid)', 'execute') THEN
    v_missing := v_missing || 'anon can execute a BOM write function; ';
  END IF;
  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Manufacturing BOM commands not applied correctly: %', v_missing
      USING ERRCODE = '42501';
  END IF;
END
$verify$;
