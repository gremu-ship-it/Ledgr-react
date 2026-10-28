-- Save creates a new immutable version (draft); component quantities are per one output unit.
CREATE OR REPLACE FUNCTION public.save_bom_version(
  p_business_id uuid,
  p_bom_id uuid,
  p_code text,
  p_name text,
  p_product_id uuid,
  p_version_label text,
  p_components jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bom_id uuid;
  v_version_id uuid;
  v_version_number integer;
  v_product_unit text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized for this business' USING ERRCODE = '42501';
  END IF;

  IF p_code IS NULL OR length(btrim(p_code)) = 0 THEN
    RAISE EXCEPTION 'BOM code is required' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'BOM name is required' USING ERRCODE = '22023';
  END IF;
  IF p_components IS NULL OR jsonb_typeof(p_components) <> 'array' THEN
    RAISE EXCEPTION 'BOM components must be a JSON array' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(btrim(p.unit_of_measure), ''), 'ea') INTO v_product_unit
  FROM public.products p
  WHERE p.id = p_product_id AND p.business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM output product must belong to the same business' USING ERRCODE = '23514';
  END IF;

  IF p_bom_id IS NULL THEN
    INSERT INTO public.boms (business_id, product_id, code, name, unit_of_measure, created_by)
    VALUES (p_business_id, p_product_id, btrim(p_code), btrim(p_name), v_product_unit, auth.uid())
    RETURNING id INTO v_bom_id;
  ELSE
    SELECT b.id INTO v_bom_id
    FROM public.boms b
    WHERE b.id = p_bom_id AND b.business_id = p_business_id
    FOR UPDATE;
    IF v_bom_id IS NULL THEN
      RAISE EXCEPTION 'BOM was not found for this business' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.boms
    SET product_id = p_product_id, code = btrim(p_code), name = btrim(p_name), unit_of_measure = v_product_unit
    WHERE id = v_bom_id AND business_id = p_business_id;
  END IF;

  -- Serialize version-number allocation on the parent header.
  PERFORM 1 FROM public.boms b WHERE b.id = v_bom_id AND b.business_id = p_business_id FOR UPDATE;
  SELECT COALESCE(MAX(v.version_number), 0) + 1 INTO v_version_number
  FROM public.bom_versions v WHERE v.bom_id = v_bom_id;

  INSERT INTO public.bom_versions (
    business_id, bom_id, version_number, version_label, status, created_by
  ) VALUES (
    p_business_id, v_bom_id, v_version_number, nullif(btrim(COALESCE(p_version_label, '')), ''), 'draft', auth.uid()
  ) RETURNING id INTO v_version_id;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_components) AS c(
      component_product_id uuid,
      component_bom_version_id uuid,
      quantity numeric,
      unit_of_measure text,
      scrap_percentage numeric,
      sort_order integer,
      notes text
    )
    WHERE c.quantity IS NULL OR c.quantity <= 0
       OR c.scrap_percentage < 0 OR c.scrap_percentage >= 100
       OR ((c.component_product_id IS NULL) = (c.component_bom_version_id IS NULL))
  ) THEN
    RAISE EXCEPTION 'Each BOM component needs one product or sub-assembly and a positive quantity' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.bom_components (
    business_id, bom_version_id, component_product_id, component_bom_version_id,
    quantity, unit_of_measure, scrap_percentage, sort_order, notes
  )
  SELECT
    p_business_id, v_version_id, c.component_product_id, c.component_bom_version_id,
    c.quantity, COALESCE(NULLIF(c.unit_of_measure, ''), 'ea'), COALESCE(c.scrap_percentage, 0),
    COALESCE(c.sort_order, (entry.ordinality - 1)::integer), c.notes
  FROM jsonb_array_elements(p_components) WITH ORDINALITY AS entry(value, ordinality)
  CROSS JOIN LATERAL jsonb_to_record(entry.value) AS c(
    component_product_id uuid,
    component_bom_version_id uuid,
    quantity numeric,
    unit_of_measure text,
    scrap_percentage numeric,
    sort_order integer,
    notes text
  );

  RETURN v_version_id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_bom_version(uuid, uuid, text, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_bom_version(uuid, uuid, text, text, uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.activate_bom_version(
  p_business_id uuid,
  p_bom_version_id uuid
)
RETURNS public.bom_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version public.bom_versions%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized for this business' USING ERRCODE = '42501';
  END IF;

  SELECT v.* INTO v_version
  FROM public.bom_versions v
  WHERE v.id = p_bom_version_id AND v.business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM version was not found for this business' USING ERRCODE = 'P0002';
  END IF;
  IF v_version.status = 'active' THEN
    RETURN v_version;
  END IF;
  IF v_version.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft BOM version can be activated' USING ERRCODE = '22023';
  END IF;

  -- Archive the former active revision before activating this one to preserve
  -- the partial unique index and a continuous effective-date history.
  UPDATE public.bom_versions
  SET status = 'archived', effective_to = COALESCE(effective_to, current_date)
  WHERE bom_id = v_version.bom_id AND business_id = p_business_id
    AND status = 'active' AND id <> p_bom_version_id;

  UPDATE public.bom_versions
  SET status = 'active', effective_from = COALESCE(effective_from, current_date), effective_to = NULL
  WHERE id = p_bom_version_id AND business_id = p_business_id
  RETURNING * INTO v_version;

  RETURN v_version;
END;
$$;

REVOKE ALL ON FUNCTION public.activate_bom_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_bom_version(uuid, uuid) TO authenticated;
