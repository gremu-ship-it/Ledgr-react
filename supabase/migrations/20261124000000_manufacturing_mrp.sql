-- Phase 5B-3a: demand-driven, time-phased manufacturing MRP.
-- MRP runs only create suggestions. A make suggestion becomes a draft work
-- order only after an explicit call to convert_mrp_recommendation.

CREATE TABLE IF NOT EXISTS public.manufacturing_mrp_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  run_number integer NOT NULL,
  horizon_start date NOT NULL,
  horizon_end date NOT NULL,
  demand_inputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  recommendation_count integer NOT NULL DEFAULT 0,
  make_count integer NOT NULL DEFAULT 0,
  buy_count integer NOT NULL DEFAULT 0,
  CONSTRAINT manufacturing_mrp_runs_dates_check CHECK (horizon_end >= horizon_start),
  CONSTRAINT manufacturing_mrp_runs_inputs_array_check CHECK (jsonb_typeof(demand_inputs) = 'array'),
  CONSTRAINT manufacturing_mrp_runs_number_unique UNIQUE (business_id, run_number),
  CONSTRAINT manufacturing_mrp_runs_business_id_id_unique UNIQUE (business_id, id)
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_mrp_runs_business_created
  ON public.manufacturing_mrp_runs(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.manufacturing_mrp_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL,
  run_id uuid NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  recommendation_type text NOT NULL CHECK (recommendation_type IN ('make', 'buy')),
  required_date date NOT NULL,
  gross_requirement numeric(20, 6) NOT NULL CHECK (gross_requirement > 0),
  on_hand_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (on_hand_quantity >= 0),
  active_production_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (active_production_quantity >= 0),
  approved_supply_quantity numeric(20, 6) NOT NULL DEFAULT 0 CHECK (approved_supply_quantity >= 0),
  net_requirement numeric(20, 6) NOT NULL CHECK (net_requirement > 0),
  bom_id uuid REFERENCES public.manufacturing_boms(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'converted')),
  converted_work_order_id uuid REFERENCES public.manufacturing_work_orders(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES auth.users(id),
  CONSTRAINT manufacturing_mrp_recommendations_scope_fkey
    FOREIGN KEY (business_id, run_id)
    REFERENCES public.manufacturing_mrp_runs(business_id, id) ON DELETE CASCADE,
  CONSTRAINT manufacturing_mrp_recommendations_unique_bucket
    UNIQUE (run_id, product_id, required_date),
  CONSTRAINT manufacturing_mrp_recommendations_bom_type_check CHECK (
    (recommendation_type = 'make' AND bom_id IS NOT NULL)
    OR (recommendation_type = 'buy' AND bom_id IS NULL)
  ),
  CONSTRAINT manufacturing_mrp_recommendations_converted_check CHECK (
    (status = 'converted' AND converted_work_order_id IS NOT NULL)
    OR (status <> 'converted' AND converted_work_order_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_manufacturing_mrp_recommendations_run
  ON public.manufacturing_mrp_recommendations(run_id, required_date, product_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_mrp_recommendations_business_status
  ON public.manufacturing_mrp_recommendations(business_id, status, recommendation_type);

ALTER TABLE public.manufacturing_mrp_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_mrp_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manufacturing_mrp_runs_member_read ON public.manufacturing_mrp_runs;
CREATE POLICY manufacturing_mrp_runs_member_read
  ON public.manufacturing_mrp_runs FOR SELECT TO authenticated
  USING (public._manufacturing_bom_member(business_id));

DROP POLICY IF EXISTS manufacturing_mrp_recommendations_member_read ON public.manufacturing_mrp_recommendations;
CREATE POLICY manufacturing_mrp_recommendations_member_read
  ON public.manufacturing_mrp_recommendations FOR SELECT TO authenticated
  USING (public._manufacturing_bom_member(business_id));

DROP POLICY IF EXISTS manufacturing_mrp_recommendations_writer_update ON public.manufacturing_mrp_recommendations;
CREATE POLICY manufacturing_mrp_recommendations_writer_update
  ON public.manufacturing_mrp_recommendations FOR UPDATE TO authenticated
  USING (public._manufacturing_bom_writer(business_id))
  WITH CHECK (public._manufacturing_bom_writer(business_id));

REVOKE ALL ON public.manufacturing_mrp_runs FROM PUBLIC, anon;
REVOKE ALL ON public.manufacturing_mrp_recommendations FROM PUBLIC, anon;
GRANT SELECT ON public.manufacturing_mrp_runs, public.manufacturing_mrp_recommendations TO authenticated;
REVOKE UPDATE ON public.manufacturing_mrp_recommendations FROM authenticated;
GRANT UPDATE (status, dismissed_at, dismissed_by)
  ON public.manufacturing_mrp_recommendations TO authenticated;

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

CREATE OR REPLACE FUNCTION public.convert_mrp_recommendation(p_recommendation_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
  v_rec public.manufacturing_mrp_recommendations%ROWTYPE;
  v_run public.manufacturing_mrp_runs%ROWTYPE;
  v_work_order_id uuid;
BEGIN
  SELECT * INTO v_rec
  FROM public.manufacturing_mrp_recommendations
  WHERE id = p_recommendation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MRP recommendation not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_rec.business_id, 'convert an MRP recommendation');
  IF v_rec.recommendation_type <> 'make' OR v_rec.status <> 'open' THEN
    RAISE EXCEPTION 'Only open make recommendations can be converted.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM public.manufacturing_mrp_runs WHERE id = v_rec.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The MRP run for this recommendation was not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.manufacturing_boms b
    WHERE b.id = v_rec.bom_id AND b.business_id = v_rec.business_id
      AND b.product_id = v_rec.product_id AND b.status = 'active'
  ) THEN
    RAISE EXCEPTION 'The recommended product no longer has the active BOM version used by this run. Run MRP again before converting.'
      USING ERRCODE = '22023';
  END IF;

  v_work_order_id := public.create_work_order_from_bom(
    v_rec.business_id,
    v_rec.product_id,
    v_rec.bom_id,
    NULL,
    v_rec.net_requirement,
    NULL,
    v_rec.required_date,
    v_rec.required_date,
    'normal',
    NULL,
    NULL,
    NULL
  );

  UPDATE public.manufacturing_mrp_recommendations
  SET status = 'converted', converted_work_order_id = v_work_order_id
  WHERE id = v_rec.id AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The MRP recommendation was already processed.' USING ERRCODE = '40001';
  END IF;
  RETURN v_work_order_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.run_mrp(uuid, date, date, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.convert_mrp_recommendation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_mrp(uuid, date, date, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.convert_mrp_recommendation(uuid) TO authenticated;

COMMENT ON TABLE public.manufacturing_mrp_runs IS
  'Immutable input snapshot and summary for an MRP planning run; run_mrp creates suggestions only.';
COMMENT ON TABLE public.manufacturing_mrp_recommendations IS
  'Time-phased make/buy suggestions. Conversion to a draft work order is an explicit user action.';
COMMENT ON COLUMN public.manufacturing_mrp_recommendations.approved_supply_quantity IS
  'Reserved for generic approved purchase supply; no generic PO table exists in this schema, so current MRP runs record zero.';
