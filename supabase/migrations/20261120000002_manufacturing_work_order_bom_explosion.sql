-- Integrate multi-level BOMs with the existing work-order release command.
-- Freeze an exploded raw-material requirement per ONE output unit, then scale
-- it by the planned work-order quantity. Work-order tables remain unchanged.

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

REVOKE ALL ON FUNCTION public.manufacturing_wo_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_release(uuid) TO authenticated;
