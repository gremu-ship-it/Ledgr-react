-- Manufacturing Phase D — business-scoped, read-only reporting RPCs.
-- Every public RPC checks membership before it can read SECURITY DEFINER data.
-- A nonexistent business intentionally returns empty/zero results; a real
-- business belonging to another user raises insufficient_privilege.

CREATE OR REPLACE FUNCTION public._mfg_dashboard_authorized(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id) THEN
    RETURN false;
  END IF;

  -- Reuse the Phase C membership check so SECURITY DEFINER reporting follows
  -- the same business-membership boundary as manufacturing work-order RPCs.
  PERFORM public._mfg_wo_actor(p_business_id);

  -- Manufacturing has one operation grant for the complete module. Do not
  -- mint dashboard-specific capabilities; honour the existing Phase A grant.
  IF NOT EXISTS (
    SELECT 1
    FROM public.manufacturing_capability_grants g
    WHERE g.business_id = p_business_id
      AND g.user_id = auth.uid()
      AND g.capability = 'manufacturing.bom.manage'
      AND g.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The manufacturing.bom.manage capability is required.'
      USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public._mfg_dashboard_authorized(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.manufacturing_dashboard_metrics(
  p_business_id uuid,
  p_start_date date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authz AS MATERIALIZED (
    SELECT public._mfg_dashboard_authorized(p_business_id) AS allowed
  )
  SELECT jsonb_build_object(
    'active_work_orders', (
      SELECT COUNT(*)
      FROM public.manufacturing_work_orders wo, authz a
      WHERE a.allowed
        AND wo.business_id = p_business_id
        AND wo.status IN ('released', 'in_progress')
    ),
    'completed_this_period', (
      SELECT COUNT(*)
      FROM public.manufacturing_work_orders wo, authz a
      WHERE a.allowed
        AND wo.business_id = p_business_id
        AND wo.status IN ('completed', 'closed')
        AND wo.actual_end_date >= p_start_date::timestamptz
        AND wo.actual_end_date < (p_end_date + 1)::timestamptz
    ),
    'total_output_this_period', (
      SELECT COALESCE(SUM(wo.completed_quantity), 0)
      FROM public.manufacturing_work_orders wo, authz a
      WHERE a.allowed
        AND wo.business_id = p_business_id
        AND wo.status IN ('completed', 'closed')
        AND wo.actual_end_date >= p_start_date::timestamptz
        AND wo.actual_end_date < (p_end_date + 1)::timestamptz
    ),
    'total_scrap_this_period', (
      SELECT COALESCE(SUM(wo.scrapped_quantity), 0)
      FROM public.manufacturing_work_orders wo, authz a
      WHERE a.allowed
        AND wo.business_id = p_business_id
        AND wo.status IN ('completed', 'closed')
        AND wo.actual_end_date >= p_start_date::timestamptz
        AND wo.actual_end_date < (p_end_date + 1)::timestamptz
    ),
    'avg_yield_pct', (
      SELECT CASE
        WHEN COALESCE(SUM(wo.completed_quantity + wo.scrapped_quantity), 0) = 0 THEN 0
        ELSE ROUND(
          SUM(wo.completed_quantity)::numeric /
          SUM(wo.completed_quantity + wo.scrapped_quantity) * 100, 1
        )
      END
      FROM public.manufacturing_work_orders wo, authz a
      WHERE a.allowed
        AND wo.business_id = p_business_id
        AND wo.status IN ('completed', 'closed')
        AND wo.actual_end_date >= p_start_date::timestamptz
        AND wo.actual_end_date < (p_end_date + 1)::timestamptz
    ),
    'wip_value', (
      SELECT COALESCE(SUM(wol.actual_quantity_consumed * p.purchase_price), 0)
      FROM public.manufacturing_work_orders wo
      JOIN public.manufacturing_work_order_lines wol ON wol.work_order_id = wo.id
      JOIN public.products p ON p.id = wol.component_product_id
      CROSS JOIN authz a
      WHERE a.allowed
        AND wo.business_id = p_business_id
        AND wo.status IN ('released', 'in_progress')
    ),
    'total_material_cost_this_period', (
      SELECT COALESCE(SUM(mt.quantity * p.purchase_price), 0)
      FROM public.manufacturing_material_transactions mt
      JOIN public.manufacturing_work_orders wo ON wo.id = mt.work_order_id
      JOIN public.products p ON p.id = mt.component_product_id
      CROSS JOIN authz a
      WHERE a.allowed
        AND wo.business_id = p_business_id
        AND mt.transaction_type = 'consume'
        AND mt.recorded_at >= p_start_date::timestamptz
        AND mt.recorded_at < (p_end_date + 1)::timestamptz
    )
  );
$$;
REVOKE ALL ON FUNCTION public.manufacturing_dashboard_metrics(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_dashboard_metrics(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.manufacturing_throughput_trend(
  p_business_id uuid,
  p_start_date date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_end_date date DEFAULT CURRENT_DATE,
  p_granularity text DEFAULT 'day'
)
RETURNS TABLE (
  period_start date,
  output_quantity numeric,
  scrap_quantity numeric,
  work_order_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authz AS MATERIALIZED (
    SELECT public._mfg_dashboard_authorized(p_business_id) AS allowed
  )
  SELECT
    CASE p_granularity
      WHEN 'week' THEN date_trunc('week', wo.actual_end_date)::date
      WHEN 'month' THEN date_trunc('month', wo.actual_end_date)::date
      ELSE wo.actual_end_date::date
    END AS period_start,
    COALESCE(SUM(wo.completed_quantity), 0) AS output_quantity,
    COALESCE(SUM(wo.scrapped_quantity), 0) AS scrap_quantity,
    COUNT(*) AS work_order_count
  FROM public.manufacturing_work_orders wo
  CROSS JOIN authz a
  WHERE a.allowed
    AND wo.business_id = p_business_id
    AND wo.status IN ('completed', 'closed')
    AND wo.actual_end_date >= p_start_date::timestamptz
    AND wo.actual_end_date < (p_end_date + 1)::timestamptz
  GROUP BY 1
  ORDER BY 1;
$$;
REVOKE ALL ON FUNCTION public.manufacturing_throughput_trend(uuid, date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_throughput_trend(uuid, date, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.manufacturing_yield_by_product(
  p_business_id uuid,
  p_start_date date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  total_output numeric,
  total_scrap numeric,
  yield_pct numeric,
  work_order_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authz AS MATERIALIZED (
    SELECT public._mfg_dashboard_authorized(p_business_id) AS allowed
  )
  SELECT
    wo.product_id,
    p.name AS product_name,
    COALESCE(SUM(wo.completed_quantity), 0) AS total_output,
    COALESCE(SUM(wo.scrapped_quantity), 0) AS total_scrap,
    CASE
      WHEN COALESCE(SUM(wo.completed_quantity + wo.scrapped_quantity), 0) = 0 THEN 0
      ELSE ROUND(
        SUM(wo.completed_quantity)::numeric /
        SUM(wo.completed_quantity + wo.scrapped_quantity) * 100, 1
      )
    END AS yield_pct,
    COUNT(*) AS work_order_count
  FROM public.manufacturing_work_orders wo
  JOIN public.products p ON p.id = wo.product_id
  CROSS JOIN authz a
  WHERE a.allowed
    AND wo.business_id = p_business_id
    AND wo.status IN ('completed', 'closed')
    AND wo.actual_end_date >= p_start_date::timestamptz
    AND wo.actual_end_date < (p_end_date + 1)::timestamptz
  GROUP BY wo.product_id, p.name
  ORDER BY total_output DESC;
$$;
REVOKE ALL ON FUNCTION public.manufacturing_yield_by_product(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_yield_by_product(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.manufacturing_wip_aging(p_business_id uuid)
RETURNS TABLE (
  work_order_id uuid,
  work_order_number text,
  product_name text,
  status text,
  planned_quantity numeric,
  completed_quantity numeric,
  days_in_wip integer,
  wip_cost numeric,
  age_bucket text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authz AS MATERIALIZED (
    SELECT public._mfg_dashboard_authorized(p_business_id) AS allowed
  ),
  wip_costs AS (
    SELECT
      wo.id AS work_order_id,
      COALESCE(SUM(wol.actual_quantity_consumed * cp.purchase_price), 0) AS wip_cost
    FROM public.manufacturing_work_orders wo
    LEFT JOIN public.manufacturing_work_order_lines wol ON wol.work_order_id = wo.id
    LEFT JOIN public.products cp ON cp.id = wol.component_product_id
    CROSS JOIN authz a
    WHERE a.allowed
      AND wo.business_id = p_business_id
      AND wo.status IN ('released', 'in_progress')
    GROUP BY wo.id
  ),
  aged AS (
    SELECT
      wo.id AS work_order_id,
      wo.work_order_number,
      p.name AS product_name,
      wo.status,
      wo.planned_quantity,
      wo.completed_quantity,
      GREATEST(0, EXTRACT(DAY FROM now() - COALESCE(wo.actual_start_date, wo.created_at))::integer) AS days_in_wip,
      wc.wip_cost
    FROM public.manufacturing_work_orders wo
    JOIN public.products p ON p.id = wo.product_id
    JOIN wip_costs wc ON wc.work_order_id = wo.id
    WHERE wo.business_id = p_business_id
      AND wo.status IN ('released', 'in_progress')
  )
  SELECT
    aged.work_order_id,
    aged.work_order_number,
    aged.product_name,
    aged.status,
    aged.planned_quantity,
    aged.completed_quantity,
    aged.days_in_wip,
    aged.wip_cost,
    CASE
      WHEN aged.days_in_wip <= 7 THEN '0-7 days'
      WHEN aged.days_in_wip <= 14 THEN '8-14 days'
      WHEN aged.days_in_wip <= 30 THEN '15-30 days'
      ELSE '30+ days'
    END AS age_bucket
  FROM aged
  ORDER BY aged.days_in_wip DESC, aged.work_order_number;
$$;
REVOKE ALL ON FUNCTION public.manufacturing_wip_aging(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wip_aging(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.manufacturing_cost_variance(
  p_business_id uuid,
  p_start_date date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  work_order_id uuid,
  work_order_number text,
  product_name text,
  planned_cost numeric,
  actual_cost numeric,
  variance numeric,
  variance_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authz AS MATERIALIZED (
    SELECT public._mfg_dashboard_authorized(p_business_id) AS allowed
  ),
  completed AS (
    SELECT wo.*
    FROM public.manufacturing_work_orders wo
    CROSS JOIN authz a
    WHERE a.allowed
      AND wo.business_id = p_business_id
      AND wo.status IN ('completed', 'closed')
      AND wo.actual_end_date >= p_start_date::timestamptz
      AND wo.actual_end_date < (p_end_date + 1)::timestamptz
  ),
  planned AS (
    SELECT
      wo.id AS work_order_id,
      wo.work_order_number,
      p.name AS product_name,
      COALESCE(SUM(wol.planned_quantity * cp.purchase_price), 0) AS planned_cost
    FROM completed wo
    JOIN public.products p ON p.id = wo.product_id
    LEFT JOIN public.manufacturing_work_order_lines wol ON wol.work_order_id = wo.id
    LEFT JOIN public.products cp ON cp.id = wol.component_product_id
    GROUP BY wo.id, wo.work_order_number, p.name
  ),
  actual AS (
    SELECT
      wo.id AS work_order_id,
      COALESCE(SUM(mt.quantity * cp.purchase_price), 0) AS actual_cost
    FROM completed wo
    LEFT JOIN public.manufacturing_material_transactions mt
      ON mt.work_order_id = wo.id AND mt.transaction_type = 'consume'
    LEFT JOIN public.products cp ON cp.id = mt.component_product_id
    GROUP BY wo.id
  )
  SELECT
    pl.work_order_id,
    pl.work_order_number,
    pl.product_name,
    pl.planned_cost,
    COALESCE(ac.actual_cost, 0) AS actual_cost,
    COALESCE(ac.actual_cost, 0) - pl.planned_cost AS variance,
    CASE
      WHEN pl.planned_cost = 0 THEN 0
      ELSE ROUND((COALESCE(ac.actual_cost, 0) - pl.planned_cost) / pl.planned_cost * 100, 1)
    END AS variance_pct
  FROM planned pl
  LEFT JOIN actual ac ON ac.work_order_id = pl.work_order_id
  ORDER BY ABS(COALESCE(ac.actual_cost, 0) - pl.planned_cost) DESC, pl.work_order_number;
$$;
REVOKE ALL ON FUNCTION public.manufacturing_cost_variance(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_cost_variance(uuid, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.manufacturing_production_summary(
  p_business_id uuid,
  p_start_date date DEFAULT date_trunc('month', CURRENT_DATE)::date,
  p_end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  product_id uuid,
  product_name text,
  total_planned numeric,
  total_completed numeric,
  total_scrapped numeric,
  yield_pct numeric,
  total_material_cost numeric,
  cost_per_unit numeric,
  work_order_count bigint,
  production_run_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH authz AS MATERIALIZED (
    SELECT public._mfg_dashboard_authorized(p_business_id) AS allowed
  ),
  completed AS (
    SELECT wo.*
    FROM public.manufacturing_work_orders wo
    CROSS JOIN authz a
    WHERE a.allowed
      AND wo.business_id = p_business_id
      AND wo.status IN ('completed', 'closed')
      AND wo.actual_end_date >= p_start_date::timestamptz
      AND wo.actual_end_date < (p_end_date + 1)::timestamptz
  ),
  production AS (
    SELECT
      wo.product_id,
      p.name AS product_name,
      SUM(wo.planned_quantity) AS total_planned,
      SUM(wo.completed_quantity) AS total_completed,
      SUM(wo.scrapped_quantity) AS total_scrapped,
      CASE
        WHEN COALESCE(SUM(wo.completed_quantity + wo.scrapped_quantity), 0) = 0 THEN 0
        ELSE ROUND(
          SUM(wo.completed_quantity)::numeric /
          SUM(wo.completed_quantity + wo.scrapped_quantity) * 100, 1
        )
      END AS yield_pct,
      COUNT(*) AS work_order_count
    FROM completed wo
    JOIN public.products p ON p.id = wo.product_id
    GROUP BY wo.product_id, p.name
  ),
  material_costs AS (
    SELECT
      wo.product_id,
      SUM(mt.quantity * cp.purchase_price) AS total_material_cost
    FROM completed wo
    JOIN public.manufacturing_material_transactions mt
      ON mt.work_order_id = wo.id AND mt.transaction_type = 'consume'
    JOIN public.products cp ON cp.id = mt.component_product_id
    GROUP BY wo.product_id
  ),
  run_counts AS (
    SELECT wo.product_id, COUNT(pr.id) AS production_run_count
    FROM completed wo
    LEFT JOIN public.manufacturing_production_runs pr ON pr.work_order_id = wo.id
    GROUP BY wo.product_id
  )
  SELECT
    production.product_id,
    production.product_name,
    production.total_planned,
    production.total_completed,
    production.total_scrapped,
    production.yield_pct,
    COALESCE(material_costs.total_material_cost, 0) AS total_material_cost,
    CASE
      WHEN production.total_completed = 0 THEN 0
      ELSE ROUND(COALESCE(material_costs.total_material_cost, 0) / production.total_completed, 2)
    END AS cost_per_unit,
    production.work_order_count,
    COALESCE(run_counts.production_run_count, 0) AS production_run_count
  FROM production
  LEFT JOIN material_costs ON material_costs.product_id = production.product_id
  LEFT JOIN run_counts ON run_counts.product_id = production.product_id
  ORDER BY production.total_completed DESC, production.product_name;
$$;
REVOKE ALL ON FUNCTION public.manufacturing_production_summary(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_production_summary(uuid, date, date) TO authenticated;
