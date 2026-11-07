-- Phase 8B SEC-02 / SEC-03: enforce manufacturing plan entitlement and
-- replace partner-peer access to full business rows with an explicit projection.
-- This migration is replay-safe; it replaces the current RPC definitions while
-- preserving their public signatures and existing ACLs.

CREATE OR REPLACE FUNCTION public._mfg_assert_enterprise_plan(p_business_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_tier text;
BEGIN
  SELECT public.effective_plan_tier(b.plan_tier, b.plan_expires_at)
    INTO v_plan_tier
    FROM public.businesses b
   WHERE b.id = p_business_id;

  IF NOT FOUND OR lower(COALESCE(v_plan_tier, 'free')) <> 'enterprise' THEN
    RAISE EXCEPTION 'Manufacturing requires an active Enterprise plan.'
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._mfg_assert_enterprise_plan(uuid) FROM PUBLIC, anon, authenticated;

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
  PERFORM public._mfg_assert_enterprise_plan(p_business_id);
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
  PERFORM public._mfg_assert_enterprise_plan(v_bom.business_id);
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
  PERFORM public._mfg_assert_enterprise_plan(v_old.business_id);
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

CREATE OR REPLACE FUNCTION public.manufacturing_wo_create(
  p_business_id      uuid,
  p_product_id       uuid,
  p_planned_qty      numeric,
  p_planned_start    date,
  p_planned_end      date,
  p_from_location_id uuid,
  p_to_location_id   uuid,
  p_notes            text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_bom_id uuid;
  v_number text;
  v_wo_id uuid;
  v_from uuid;
  v_to uuid;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM public._mfg_assert_enterprise_plan(p_business_id);
  v_actor := public._mfg_wo_writer(p_business_id, 'create a work order');
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'An output product is required.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_planned_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'The planned quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  SELECT b.id INTO v_bom_id
    FROM public.manufacturing_boms b
   WHERE b.business_id = p_business_id
     AND b.product_id = p_product_id
     AND b.status = 'active'
   ORDER BY b.version DESC, b.created_at DESC
   LIMIT 1;
  IF v_bom_id IS NULL THEN
    RAISE EXCEPTION
      'manufacturing-no-active-bom: this product has no active bill of materials. Activate a BOM before creating a work order.'
      USING ERRCODE = '22023';
  END IF;

  v_from := COALESCE(p_from_location_id,
                     public._mfg_wo_location(p_business_id, 'raw_materials_store'));
  v_to   := COALESCE(p_to_location_id,
                     public._mfg_wo_location(p_business_id, 'finished_goods_store'));

  v_number := public._mfg_wo_next_number(p_business_id);

  INSERT INTO public.manufacturing_work_orders
    (business_id, work_order_number, product_id, bom_id, planned_quantity, status,
     planned_start_date, planned_end_date, from_location_id, to_location_id,
     notes, created_by)
  VALUES
    (p_business_id, v_number, p_product_id, v_bom_id, p_planned_qty, 'draft',
     p_planned_start, p_planned_end, v_from, v_to,
     NULLIF(btrim(COALESCE(p_notes, '')), ''), v_actor)
  RETURNING id INTO v_wo_id;

  RETURN v_wo_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.manufacturing_wo_release(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
BEGIN
  IF p_work_order_id IS NULL THEN
    RAISE EXCEPTION 'A work order is required.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_wo
  FROM public.manufacturing_work_orders
  WHERE id = p_work_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._mfg_assert_enterprise_plan(v_wo.business_id);
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'release a work order');

  IF v_wo.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft work order can be released; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  -- Lock the selected root revision. Its BOM graph is already immutable by
  -- status, while this timestamp records the work-order reference as before.
  UPDATE public.manufacturing_boms
  SET bom_locked_at = now(), updated_at = now()
  WHERE id = v_wo.bom_id AND bom_locked_at IS NULL;

  -- Each edge quantity and scrap factor is per one unit of its parent output.
  -- Multiply along nested edges, then aggregate duplicate raw materials before
  -- freezing the list (the work-order schema is intentionally single-level).
  WITH RECURSIVE bom_walk(bom_id, multiplier, product_path, depth) AS (
    SELECT root.id, 1::numeric, ARRAY[root.product_id]::uuid[], 0
    FROM public.manufacturing_boms root
    WHERE root.id = v_wo.bom_id AND root.business_id = v_wo.business_id
    UNION ALL
    SELECT child.id,
           walk.multiplier * line.quantity * (1 + line.scrap_pct / 100),
           walk.product_path || child.product_id,
           walk.depth + 1
    FROM bom_walk walk
    JOIN public.manufacturing_bom_lines line ON line.bom_id = walk.bom_id
    JOIN public.manufacturing_boms child
      ON child.id = line.component_bom_id
     AND child.business_id = v_wo.business_id
    WHERE line.component_bom_id IS NOT NULL
      AND walk.depth < 32
      AND NOT child.product_id = ANY(walk.product_path)
  ), material_requirements AS (
    SELECT line.component_product_id,
           walk.multiplier * line.quantity * (1 + line.scrap_pct / 100) AS quantity,
           line.unit_of_measure,
           line.scrap_pct,
           line.notes
    FROM bom_walk walk
    JOIN public.manufacturing_bom_lines line ON line.bom_id = walk.bom_id
    WHERE line.component_product_id IS NOT NULL
  )
  INSERT INTO public.manufacturing_work_order_lines
    (work_order_id, component_product_id, planned_quantity, unit_of_measure, scrap_pct, notes)
  SELECT p_work_order_id,
         material.component_product_id,
         round(SUM(material.quantity) * v_wo.planned_quantity, 6),
         COALESCE(product.unit_of_measure, MIN(material.unit_of_measure)),
         MAX(material.scrap_pct),
         NULLIF(string_agg(DISTINCT NULLIF(material.notes, ''), '; ')
           FILTER (WHERE NULLIF(material.notes, '') IS NOT NULL), '')
  FROM material_requirements material
  JOIN public.products product
    ON product.id = material.component_product_id
   AND product.business_id = v_wo.business_id
  GROUP BY material.component_product_id, product.unit_of_measure
  ON CONFLICT (work_order_id, component_product_id) DO UPDATE
    SET planned_quantity = EXCLUDED.planned_quantity,
        unit_of_measure = EXCLUDED.unit_of_measure,
        scrap_pct = EXCLUDED.scrap_pct,
        notes = EXCLUDED.notes,
        updated_at = now();

  IF NOT EXISTS (
    SELECT 1 FROM public.manufacturing_work_order_lines
    WHERE work_order_id = p_work_order_id
  ) THEN
    RAISE EXCEPTION 'The selected BOM contains no raw material components.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_work_orders
  SET status = 'released', updated_at = now()
  WHERE id = p_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.manufacturing_wo_start(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._mfg_assert_enterprise_plan(v_wo.business_id);
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'start production');

  IF v_wo.status = 'in_progress' THEN
    RETURN; -- no-op: already started
  END IF;
  IF v_wo.status <> 'released' THEN
    RAISE EXCEPTION 'Only a released work order can start production; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_work_orders
     SET status = 'in_progress',
         actual_start_date = COALESCE(actual_start_date, now()),
         updated_at = now()
   WHERE id = p_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.manufacturing_wo_complete(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
  v_date date := current_date;
  v_runs integer;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._mfg_assert_enterprise_plan(v_wo.business_id);
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'complete a work order');

  IF v_wo.status NOT IN ('released', 'in_progress') THEN
    RAISE EXCEPTION 'Only a released or in-progress work order can be completed; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_runs
    FROM public.manufacturing_production_runs
   WHERE work_order_id = p_work_order_id;

  IF v_runs = 0 THEN
    -- Backflush-only: one implicit batch for the full planned quantity.
    PERFORM public._ledgr_assert_period_open(v_wo.business_id, v_date, 'Work order completion');
    PERFORM public._mfg_wo_backflush(
      p_work_order_id, NULL, v_wo.planned_quantity, 'implicit batch', v_date, v_actor);
    UPDATE public.manufacturing_work_orders
       SET completed_quantity = planned_quantity,
           actual_start_date = COALESCE(actual_start_date, now()),
           updated_at = now()
     WHERE id = p_work_order_id;
    SELECT * INTO v_wo FROM public.manufacturing_work_orders WHERE id = p_work_order_id;
  END IF;

  IF COALESCE(v_wo.completed_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'A work order with no completed output cannot be completed.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_work_orders
     SET status = 'completed',
         actual_end_date = COALESCE(actual_end_date, now()),
         updated_at = now()
   WHERE id = p_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.manufacturing_wo_close(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._mfg_assert_enterprise_plan(v_wo.business_id);
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'close a work order');

  IF v_wo.status = 'closed' THEN
    RETURN; -- already final
  END IF;
  IF v_wo.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed work order can be closed; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_work_orders
     SET status = 'closed', updated_at = now()
   WHERE id = p_work_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_production_run(
  p_business_id uuid,
  p_run_id uuid,
  p_quantity_produced numeric,
  p_quantity_scrapped numeric,
  p_scrap_reason text,
  p_output_location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run public.manufacturing_production_runs%ROWTYPE;
  v_wo public.manufacturing_work_orders%ROWTYPE;
  v_actor uuid;
  v_location_id uuid;
  v_from uuid;
  v_line record;
  v_consume numeric;
  v_unit numeric;
  v_total_cost numeric := 0;
  v_line_cost numeric;
  v_branch uuid;
  v_wip uuid;
  v_rm uuid;
  v_fg uuid;
  v_wo_updated public.manufacturing_work_orders%ROWTYPE;
  v_run_updated public.manufacturing_production_runs%ROWTYPE;
BEGIN
  PERFORM public._mfg_assert_enterprise_plan(p_business_id);
  IF COALESCE(p_quantity_produced, 0) <= 0 OR COALESCE(p_quantity_scrapped, 0) < 0 THEN
    RAISE EXCEPTION 'Produced quantity must be positive and scrapped quantity cannot be negative.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_quantity_scrapped, 0) > 0 AND NULLIF(btrim(COALESCE(p_scrap_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A scrap reason is required when production is scrapped.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.manufacturing_production_runs
    WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
    WHERE id = v_run.work_order_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found for this business.' USING ERRCODE = 'P0002'; END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'complete a production run');
  IF v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only an in-progress production run can be completed.' USING ERRCODE = '22023';
  END IF;
  IF v_wo.status NOT IN ('released', 'in_progress') THEN
    RAISE EXCEPTION 'The parent work order is not open for production.' USING ERRCODE = '22023';
  END IF;
  IF v_wo.completed_quantity + p_quantity_produced + p_quantity_scrapped > v_wo.planned_quantity * 1.10 THEN
    RAISE EXCEPTION 'Production output exceeds the allowed overproduction tolerance.' USING ERRCODE = '22023';
  END IF;
  v_location_id := COALESCE(p_output_location_id, v_run.output_location_id, v_wo.to_location_id);
  IF v_location_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_locations l
    WHERE l.id = v_location_id AND l.business_id = p_business_id AND l.is_active) THEN
    RAISE EXCEPTION 'An active output location belonging to this business is required.' USING ERRCODE = '23514';
  END IF;
  PERFORM public._ledgr_assert_period_open(v_wo.business_id, current_date, 'Production run');
  v_from := COALESCE(v_wo.from_location_id, public._mfg_wo_location(v_wo.business_id, 'raw_materials_store'));
  IF v_from IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_locations l WHERE l.id = v_from AND l.business_id = p_business_id AND l.is_active) THEN
    RAISE EXCEPTION 'An active raw-material location belonging to this business is required.' USING ERRCODE = '23514';
  END IF;
  SELECT l.branch_id INTO v_branch FROM public.inventory_locations l WHERE l.id = v_from;
  v_wip := public._mfg_wo_wip_account(v_wo.business_id);
  v_rm := public._mfg_wo_stock_account(v_wo.business_id, '1143', '1141', 'Raw Materials');
  v_fg := public._mfg_wo_stock_account(v_wo.business_id, '1142', '1141', 'Finished Goods');

  UPDATE public.manufacturing_production_runs
    SET output_quantity = p_quantity_produced, scrap_quantity = p_quantity_scrapped,
        status = 'completed', completed_at = now(), output_location_id = v_location_id,
        notes = concat_ws(E'\n', NULLIF(notes, ''), NULLIF(btrim(COALESCE(p_scrap_reason, '')), ''))
    WHERE id = p_run_id;

  FOR v_line IN
    SELECT run_line.*, p.purchase_price, p.name AS product_name
    FROM public.manufacturing_production_run_lines run_line
    JOIN public.products p ON p.id = run_line.component_product_id AND p.business_id = p_business_id
    WHERE run_line.production_run_id = p_run_id AND run_line.business_id = p_business_id
    ORDER BY run_line.component_product_id
  LOOP
    v_consume := round((v_line.quantity_expected / v_wo.planned_quantity) * (p_quantity_produced + p_quantity_scrapped), 6);
    IF v_consume <= 0 THEN CONTINUE; END IF;
    v_unit := COALESCE(v_line.purchase_price, 0);
    v_line_cost := round(v_consume * v_unit, 2);
    v_total_cost := v_total_cost + v_line_cost;
    UPDATE public.manufacturing_production_run_lines
      SET quantity_consumed = v_consume WHERE id = v_line.id;
    UPDATE public.manufacturing_work_order_lines
      SET actual_quantity_consumed = actual_quantity_consumed + v_consume, updated_at = now()
      WHERE work_order_id = v_wo.id AND component_product_id = v_line.component_product_id;
    INSERT INTO public.manufacturing_material_transactions
      (work_order_id, run_id, component_product_id, quantity, transaction_type,
       from_location_id, recorded_by, notes)
    VALUES (v_wo.id, p_run_id, v_line.component_product_id, v_consume, 'consume',
      v_from, v_actor, 'Production run ' || v_run.run_number || ' — ' || v_line.product_name);
    PERFORM public._mfg_wo_movement(
      v_wo.business_id, v_line.component_product_id, v_from,
      'manufacturing_issue', current_date, -v_consume, v_unit, p_run_id,
      v_wo.work_order_number || '/RUN-' || v_run.run_number,
      'Production run ' || v_run.run_number || ' — component consumption', v_actor, 'production_run');
  END LOOP;

  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id, 'mfg_run:' || p_run_id::text || ':consume', current_date,
    'Production run ' || v_run.run_number || ' — materials consumed', p_run_id::text,
    v_branch, v_wip, v_rm, v_total_cost, 'WIP — materials issued', 'Raw materials consumed');
  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id, 'mfg_run:' || p_run_id::text || ':receipt', current_date,
    'Production run ' || v_run.run_number || ' — finished goods received', p_run_id::text,
    v_branch, v_fg, v_wip, v_total_cost, 'Finished goods received', 'WIP cleared to finished goods');
  PERFORM public._mfg_wo_movement(
    v_wo.business_id, v_wo.product_id, v_location_id, 'manufacturing_receipt', current_date,
    p_quantity_produced, CASE WHEN p_quantity_produced > 0 THEN round(v_total_cost / p_quantity_produced, 6) ELSE 0 END,
    p_run_id, v_wo.work_order_number || '/RUN-' || v_run.run_number,
    'Production run ' || v_run.run_number || ' — finished goods output', v_actor, 'production_run');

  UPDATE public.manufacturing_work_orders
    SET completed_quantity = completed_quantity + p_quantity_produced,
        scrapped_quantity = scrapped_quantity + p_quantity_scrapped,
        status = CASE WHEN completed_quantity + p_quantity_produced >= planned_quantity THEN 'completed' ELSE status END,
        actual_end_date = CASE WHEN completed_quantity + p_quantity_produced >= planned_quantity THEN now() ELSE actual_end_date END,
        updated_at = now()
    WHERE id = v_wo.id;
  SELECT * INTO v_run_updated FROM public.manufacturing_production_runs WHERE id = p_run_id;
  SELECT * INTO v_wo_updated FROM public.manufacturing_work_orders WHERE id = v_wo.id;
  RETURN jsonb_build_object('run', to_jsonb(v_run_updated), 'work_order', to_jsonb(v_wo_updated));
END
$function$;

CREATE OR REPLACE FUNCTION public.run_mrp(
  p_business_id uuid,
  p_horizon_start date,
  p_horizon_end date,
  p_demand_inputs jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_actor uuid;
  v_run_id uuid;
  v_run_number integer;
  v_need_date date;
  v_group record;
  v_bom_id uuid;
  v_net numeric(20, 6);
  v_available numeric(20, 6);
  v_on_hand numeric(20, 6);
  v_active_supply numeric(20, 6);
  v_depth integer;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;
  PERFORM public._mfg_assert_enterprise_plan(p_business_id);
  v_actor := public._mfg_wo_writer(p_business_id, 'run MRP');
  IF p_horizon_start IS NULL OR p_horizon_end IS NULL OR p_horizon_end < p_horizon_start THEN
    RAISE EXCEPTION 'A valid MRP planning horizon is required.' USING ERRCODE = '22023';
  END IF;
  IF p_horizon_end - p_horizon_start > 365 THEN
    RAISE EXCEPTION 'The MRP planning horizon cannot exceed 366 days.' USING ERRCODE = '22023';
  END IF;
  IF p_demand_inputs IS NULL OR jsonb_typeof(p_demand_inputs) <> 'array' THEN
    RAISE EXCEPTION 'Demand inputs must be an array.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_demand_inputs) > 500 THEN
    RAISE EXCEPTION 'An MRP run can contain at most 500 demand lines.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_demand_inputs) AS d(product_id uuid, quantity numeric, required_date date)
    LEFT JOIN public.products p ON p.id = d.product_id AND p.business_id = p_business_id
    WHERE d.product_id IS NULL OR d.quantity IS NULL OR d.quantity <= 0
       OR d.required_date IS NULL OR d.required_date < p_horizon_start OR d.required_date > p_horizon_end
       OR p.id IS NULL OR p.is_active IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Each demand line must reference an active business product, have a positive quantity and fall inside the planning horizon.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('manufacturing_mrp:' || p_business_id::text, 0));
  SELECT COALESCE(MAX(run_number), 0) + 1 INTO v_run_number
  FROM public.manufacturing_mrp_runs WHERE business_id = p_business_id;
  INSERT INTO public.manufacturing_mrp_runs
    (business_id, run_number, horizon_start, horizon_end, demand_inputs, created_by)
  VALUES
    (p_business_id, v_run_number, p_horizon_start, p_horizon_end, p_demand_inputs, v_actor)
  RETURNING id INTO v_run_id;

  DROP TABLE IF EXISTS pg_temp.mrp_worklist;
  DROP TABLE IF EXISTS pg_temp.mrp_supply;
  DROP TABLE IF EXISTS pg_temp.mrp_balances;
  CREATE TEMP TABLE mrp_worklist (
    product_id uuid NOT NULL,
    required_date date NOT NULL,
    quantity numeric(20, 6) NOT NULL,
    depth integer NOT NULL DEFAULT 0,
    processed boolean NOT NULL DEFAULT false
  ) ON COMMIT DROP;
  CREATE TEMP TABLE mrp_supply (
    product_id uuid NOT NULL,
    supply_date date NOT NULL,
    quantity numeric(20, 6) NOT NULL
  ) ON COMMIT DROP;
  CREATE INDEX ON mrp_supply(product_id, supply_date);
  CREATE TEMP TABLE mrp_balances (
    product_id uuid PRIMARY KEY,
    available_quantity numeric(20, 6) NOT NULL,
    last_date date NOT NULL
  ) ON COMMIT DROP;

  -- Independent demand is supplied by the planner because no generic sales-order
  -- demand source exists in this schema. Existing released/in-progress orders
  -- contribute their unconsumed component requirements as additional demand.
  INSERT INTO pg_temp.mrp_worklist(product_id, required_date, quantity)
  SELECT d.product_id, d.required_date, d.quantity
  FROM jsonb_to_recordset(p_demand_inputs) AS d(product_id uuid, quantity numeric, required_date date);

  INSERT INTO pg_temp.mrp_worklist(product_id, required_date, quantity)
  SELECT wol.component_product_id,
         GREATEST(p_horizon_start, COALESCE(wo.planned_start_date, p_horizon_start)),
         round(GREATEST(0, wol.planned_quantity - wol.actual_quantity_consumed), 6)
  FROM public.manufacturing_work_orders wo
  JOIN public.manufacturing_work_order_lines wol ON wol.work_order_id = wo.id
  WHERE wo.business_id = p_business_id
    AND wo.status IN ('released', 'in_progress')
    AND GREATEST(p_horizon_start, COALESCE(wo.planned_start_date, p_horizon_start)) <= p_horizon_end
    AND wol.planned_quantity > wol.actual_quantity_consumed;

  -- Active production is future supply for the output product, dated to its
  -- planned completion (or the horizon start when no completion date is set).
  INSERT INTO pg_temp.mrp_supply(product_id, supply_date, quantity)
  SELECT wo.product_id,
         GREATEST(p_horizon_start, COALESCE(wo.planned_end_date, p_horizon_start)),
         round(GREATEST(0, wo.planned_quantity - wo.completed_quantity), 6)
  FROM public.manufacturing_work_orders wo
  WHERE wo.business_id = p_business_id
    AND wo.status IN ('released', 'in_progress')
    AND GREATEST(p_horizon_start, COALESCE(wo.planned_end_date, p_horizon_start)) <= p_horizon_end
    AND wo.planned_quantity > wo.completed_quantity;

  -- MRP dates are requirement dates. There is no generic approved-PO or item
  -- lead-time source yet, so child BOM requirements use their parent's date.
  FOR v_need_date IN
    SELECT DISTINCT required_date FROM pg_temp.mrp_worklist ORDER BY required_date
  LOOP
    LOOP
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM pg_temp.mrp_worklist
        WHERE required_date = v_need_date AND processed IS FALSE
      );

      FOR v_group IN
        SELECT product_id, SUM(quantity) AS gross_quantity, MAX(depth) AS depth
        FROM pg_temp.mrp_worklist
        WHERE required_date = v_need_date AND processed IS FALSE
        GROUP BY product_id
        ORDER BY product_id
      LOOP
        UPDATE pg_temp.mrp_worklist SET processed = true
        WHERE product_id = v_group.product_id
          AND required_date = v_need_date
          AND processed IS FALSE;

        IF v_group.depth > 20 THEN
          RAISE EXCEPTION 'BOM nesting exceeds the supported MRP depth of 20.' USING ERRCODE = '22023';
        END IF;

        SELECT COALESCE(SUM(GREATEST(0, b.quantity_on_hand - b.quantity_reserved)), 0)
          INTO v_on_hand
        FROM public.inventory_balances b
        WHERE b.business_id = p_business_id AND b.product_id = v_group.product_id;

        INSERT INTO pg_temp.mrp_balances(product_id, available_quantity, last_date)
        VALUES (v_group.product_id, v_on_hand, p_horizon_start - 1)
        ON CONFLICT (product_id) DO NOTHING;

        SELECT balance.available_quantity
               + COALESCE((
                   SELECT SUM(s.quantity)
                   FROM pg_temp.mrp_supply s
                   WHERE s.product_id = v_group.product_id
                     AND s.supply_date > balance.last_date
                     AND s.supply_date <= v_need_date
                 ), 0)
          INTO v_available
        FROM pg_temp.mrp_balances balance
        WHERE balance.product_id = v_group.product_id
        FOR UPDATE;

        SELECT COALESCE(SUM(s.quantity), 0) INTO v_active_supply
        FROM pg_temp.mrp_supply s
        JOIN pg_temp.mrp_balances balance ON balance.product_id = s.product_id
        WHERE s.product_id = v_group.product_id
          AND s.supply_date > balance.last_date
          AND s.supply_date <= v_need_date;

        v_net := round(GREATEST(0, v_group.gross_quantity - GREATEST(0, v_available)), 6);
        UPDATE pg_temp.mrp_balances
        SET available_quantity = v_available - v_group.gross_quantity,
            last_date = v_need_date
        WHERE product_id = v_group.product_id;

        IF v_net > 0 THEN
          SELECT b.id INTO v_bom_id
          FROM public.manufacturing_boms b
          WHERE b.business_id = p_business_id
            AND b.product_id = v_group.product_id
            AND b.status = 'active'
          ORDER BY b.version DESC
          LIMIT 1;

          INSERT INTO public.manufacturing_mrp_recommendations (
            business_id, run_id, product_id, recommendation_type, required_date,
            gross_requirement, on_hand_quantity, active_production_quantity,
            approved_supply_quantity, net_requirement, bom_id
          ) VALUES (
            p_business_id, v_run_id, v_group.product_id,
            CASE WHEN v_bom_id IS NULL THEN 'buy' ELSE 'make' END,
            v_need_date, v_group.gross_quantity, v_on_hand, v_active_supply,
            0, v_net, v_bom_id
          )
          ON CONFLICT (run_id, product_id, required_date) DO UPDATE SET
            gross_requirement = public.manufacturing_mrp_recommendations.gross_requirement + EXCLUDED.gross_requirement,
            on_hand_quantity = GREATEST(public.manufacturing_mrp_recommendations.on_hand_quantity, EXCLUDED.on_hand_quantity),
            active_production_quantity = GREATEST(public.manufacturing_mrp_recommendations.active_production_quantity, EXCLUDED.active_production_quantity),
            net_requirement = public.manufacturing_mrp_recommendations.net_requirement + EXCLUDED.net_requirement;

          IF v_bom_id IS NOT NULL THEN
            INSERT INTO pg_temp.mrp_worklist(product_id, required_date, quantity, depth)
            SELECT COALESCE(child_bom.product_id, line.component_product_id),
                   v_need_date,
                   round(v_net * line.quantity * (1 + line.scrap_pct / 100), 6),
                   v_group.depth + 1
            FROM public.manufacturing_bom_lines line
            LEFT JOIN public.manufacturing_boms child_bom ON child_bom.id = line.component_bom_id
            WHERE line.bom_id = v_bom_id
              AND (line.component_bom_id IS NOT NULL OR line.component_product_id IS NOT NULL);
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  UPDATE public.manufacturing_mrp_runs r
  SET recommendation_count = counts.total,
      make_count = counts.make_count,
      buy_count = counts.buy_count
  FROM (
    SELECT COUNT(*)::integer AS total,
           COUNT(*) FILTER (WHERE recommendation_type = 'make')::integer AS make_count,
           COUNT(*) FILTER (WHERE recommendation_type = 'buy')::integer AS buy_count
    FROM public.manufacturing_mrp_recommendations
    WHERE run_id = v_run_id
  ) counts
  WHERE r.id = v_run_id;

  RETURN v_run_id;
END;
$function$;
-- Direct API callers must not use partner relationships to read full business
-- rows. Direct active members and platform admins retain their existing policies;
-- partner administrators continue to use the separately scoped usage view.
DROP POLICY IF EXISTS businesses_partner_peer_read ON public.businesses;
DROP POLICY IF EXISTS businesses_partner_admin_read ON public.businesses;

-- The SECURITY DEFINER source performs only the existing peer authorization
-- check, and returns an explicit, non-sensitive allowlist. The invoker view
-- keeps normal table access subject to businesses RLS while allowing peer rows
-- through this narrow projection only.
CREATE OR REPLACE FUNCTION public._partner_peer_business_projection()
RETURNS TABLE (
  id uuid,
  name text,
  trading_name text,
  logo_url text,
  brand_color text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.trading_name, b.logo_url, b.brand_color
    FROM public.businesses b
   WHERE public.can_read_partner_peer_business(b.id);
$$;

REVOKE ALL ON FUNCTION public._partner_peer_business_projection() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._partner_peer_business_projection() TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_partner_peer_businesses
WITH (security_invoker = true)
AS
  SELECT b.id, b.name, b.trading_name, b.logo_url, b.brand_color
    FROM public.businesses b
  UNION
  SELECT peer.id, peer.name, peer.trading_name, peer.logo_url, peer.brand_color
    FROM public._partner_peer_business_projection() peer;

REVOKE ALL ON TABLE public.v_partner_peer_businesses FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_partner_peer_businesses TO authenticated, service_role;

COMMENT ON VIEW public.v_partner_peer_businesses IS
  'Allowlisted business identity/brand projection for partner peers; excludes tax, legal, address, and contact fields.';
