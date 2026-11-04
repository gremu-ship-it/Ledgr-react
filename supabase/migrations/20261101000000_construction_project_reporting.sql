-- Phase D: read-only construction project reporting and portfolio dashboard RPCs.
-- No tables, columns, policies or mutations are added or modified.

CREATE OR REPLACE FUNCTION public.get_project_pnl(p_project_id uuid)
RETURNS TABLE(
  project_name text,
  client_name text,
  status text,
  contract_sum numeric,
  budget numeric,
  retention_pct numeric,
  boq_total numeric,
  total_po_value numeric,
  total_issued_value numeric,
  total_returned_value numeric,
  total_costs numeric,
  total_billed numeric,
  total_retention_withheld numeric,
  total_retention_released numeric,
  retention_balance numeric,
  total_paid numeric,
  cost_variance numeric,
  billing_pct numeric,
  completion_pct numeric,
  profit_margin numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.construction_projects%ROWTYPE;
  v_boq_total numeric := 0;
  v_po_total numeric := 0;
  v_issued_total numeric := 0;
  v_returned_total numeric := 0;
  v_total_costs numeric := 0;
  v_total_billed numeric := 0;
  v_ret_withheld numeric := 0;
  v_ret_released numeric := 0;
  v_ret_balance numeric := 0;
  v_total_paid numeric := 0;
  v_cost_variance numeric := 0;
  v_billing_pct numeric := 0;
  v_completion_pct numeric := 0;
  v_profit_margin numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'A project is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;

  IF cardinality(public.construction_procurement_capabilities_for(v_project.business_id)) = 0 THEN
    RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(l.total_value), 0)
    INTO v_boq_total
    FROM public.project_boq_lines l
   WHERE l.project_id = p_project_id;

  SELECT COALESCE(SUM(l.quantity_ordered * COALESCE(l.expected_unit_price, 0)), 0)
    INTO v_po_total
    FROM public.construction_purchase_orders o
    JOIN public.construction_purchase_order_lines l ON l.po_id = o.id
   WHERE o.project_id = p_project_id;

  SELECT COALESCE(SUM(i.total_cost_base), 0)
    INTO v_issued_total
    FROM public.construction_material_issues i
   WHERE i.project_id = p_project_id;

  SELECT COALESCE(SUM(r.total_cost_base), 0)
    INTO v_returned_total
    FROM public.construction_material_returns r
   WHERE r.project_id = p_project_id;

  v_total_costs := round(v_po_total - v_returned_total + v_issued_total, 2);

  SELECT COALESCE(SUM(v.net_amount), 0)
    INTO v_total_billed
    FROM public.project_valuations v
   WHERE v.project_id = p_project_id
     AND v.status = 'invoiced';

  SELECT COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'withheld'), 0),
         COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'released'), 0)
    INTO v_ret_withheld, v_ret_released
    FROM public.project_retention_ledger r
    LEFT JOIN public.project_valuations rv ON rv.id = r.valuation_id
   WHERE r.project_id = p_project_id
     AND (r.valuation_id IS NULL OR rv.status IN ('submitted', 'invoiced'));

  v_ret_balance := round(v_ret_withheld - v_ret_released, 2);

  SELECT COALESCE(SUM(ip.amount), 0)
    INTO v_total_paid
    FROM public.invoice_payments ip
    JOIN public.invoices i ON i.id = ip.invoice_id
   WHERE i.business_id = v_project.business_id
     AND i.deleted_at IS NULL
     AND i.status <> 'void'
     AND EXISTS (
       SELECT 1
         FROM public.project_valuations v
        WHERE v.project_id = p_project_id
          AND v.status = 'invoiced'
          AND v.invoice_id = i.id
     );

  v_cost_variance := round(v_project.budget - v_total_costs, 2);

  IF v_project.contract_sum > 0 THEN
    v_billing_pct := round((v_total_billed / v_project.contract_sum) * 100, 2);
  ELSE
    v_billing_pct := 0;
  END IF;

  SELECT COALESCE((
    SELECT CASE
      WHEN COALESCE(SUM(b.total_value), 0) > 0 THEN
        round(SUM(b.total_value * COALESCE(vl.cumulative_pct, 0)) / SUM(b.total_value), 2)
      ELSE
        COALESCE(round(AVG(vl.cumulative_pct), 2), 0)
    END
      FROM (
        SELECT v.id
          FROM public.project_valuations v
         WHERE v.project_id = p_project_id
           AND v.status = 'invoiced'
         ORDER BY v.valuation_number DESC
         LIMIT 1
      ) latest_val
      LEFT JOIN public.project_boq_lines b ON b.project_id = p_project_id
      LEFT JOIN public.project_valuation_lines vl
        ON vl.valuation_id = latest_val.id AND vl.boq_line_id = b.id
     GROUP BY latest_val.id
  ), 0)
    INTO v_completion_pct;

  IF v_total_billed > 0 THEN
    v_profit_margin := round(((v_total_billed - v_total_costs) / v_total_billed) * 100, 2);
  ELSE
    v_profit_margin := 0;
  END IF;

  RETURN QUERY SELECT
    v_project.name,
    v_project.client_name,
    v_project.status,
    v_project.contract_sum::numeric,
    v_project.budget::numeric,
    v_project.retention_pct::numeric,
    round(v_boq_total, 2)::numeric,
    round(v_po_total, 2)::numeric,
    round(v_issued_total, 2)::numeric,
    round(v_returned_total, 2)::numeric,
    v_total_costs::numeric,
    round(v_total_billed, 2)::numeric,
    round(v_ret_withheld, 2)::numeric,
    round(v_ret_released, 2)::numeric,
    v_ret_balance::numeric,
    round(v_total_paid, 2)::numeric,
    v_cost_variance::numeric,
    v_billing_pct::numeric,
    v_completion_pct::numeric,
    v_profit_margin::numeric;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portfolio_summary(p_business_id uuid)
RETURNS TABLE(
  total_projects bigint,
  active_projects bigint,
  total_contract_value numeric,
  total_billed numeric,
  total_paid numeric,
  total_costs numeric,
  total_retention_held numeric,
  outstanding_receivables numeric,
  avg_completion_pct numeric,
  projects_over_budget bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(public.construction_procurement_capabilities_for(p_business_id)) = 0 THEN
    RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH project_rows AS (
    SELECT
      p.id,
      p.status,
      p.contract_sum,
      p.budget,
      COALESCE((
        SELECT SUM(l.quantity_ordered * COALESCE(l.expected_unit_price, 0))
          FROM public.construction_purchase_orders o
          JOIN public.construction_purchase_order_lines l ON l.po_id = o.id
         WHERE o.project_id = p.id
      ), 0)
      + COALESCE((
        SELECT SUM(i.total_cost_base)
          FROM public.construction_material_issues i
         WHERE i.project_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(r.total_cost_base)
          FROM public.construction_material_returns r
         WHERE r.project_id = p.id
      ), 0) AS net_cost,
      COALESCE((
        SELECT SUM(CASE WHEN r.type = 'withheld' THEN r.amount ELSE -r.amount END)
          FROM public.project_retention_ledger r
          LEFT JOIN public.project_valuations rv ON rv.id = r.valuation_id
         WHERE r.project_id = p.id
           AND (r.valuation_id IS NULL OR rv.status IN ('submitted', 'invoiced'))
      ), 0) AS retention_balance,
      COALESCE((
        SELECT CASE
          WHEN COALESCE(SUM(b.total_value), 0) > 0 THEN
            round(SUM(b.total_value * COALESCE(vl.cumulative_pct, 0)) / SUM(b.total_value), 2)
          ELSE
            COALESCE(round(AVG(vl.cumulative_pct), 2), 0)
        END
          FROM (
            SELECT v.id
              FROM public.project_valuations v
             WHERE v.project_id = p.id
               AND v.status = 'invoiced'
             ORDER BY v.valuation_number DESC
             LIMIT 1
          ) latest_val
          LEFT JOIN public.project_boq_lines b ON b.project_id = p.id
          LEFT JOIN public.project_valuation_lines vl
            ON vl.valuation_id = latest_val.id AND vl.boq_line_id = b.id
         GROUP BY latest_val.id
      ), 0) AS completion_pct
    FROM public.construction_projects p
    WHERE p.business_id = p_business_id
  ),
  billed AS (
    SELECT COALESCE(SUM(v.net_amount), 0) AS amount
      FROM public.project_valuations v
      JOIN public.construction_projects p ON p.id = v.project_id
     WHERE p.business_id = p_business_id
       AND v.status = 'invoiced'
  ),
  paid AS (
    SELECT COALESCE(SUM(ip.amount), 0) AS amount
      FROM public.invoice_payments ip
      JOIN public.invoices i ON i.id = ip.invoice_id
     WHERE i.business_id = p_business_id
       AND i.deleted_at IS NULL
       AND i.status <> 'void'
       AND EXISTS (
         SELECT 1
           FROM public.project_valuations v
           JOIN public.construction_projects p ON p.id = v.project_id
          WHERE p.business_id = p_business_id
            AND v.status = 'invoiced'
            AND v.invoice_id = i.id
       )
  )
  SELECT
    COUNT(pr.id)::bigint AS total_projects,
    COUNT(pr.id) FILTER (WHERE pr.status = 'active')::bigint AS active_projects,
    round(COALESCE(SUM(pr.contract_sum), 0), 2)::numeric AS total_contract_value,
    round((SELECT amount FROM billed), 2)::numeric AS total_billed,
    round((SELECT amount FROM paid), 2)::numeric AS total_paid,
    round(COALESCE(SUM(pr.net_cost), 0), 2)::numeric AS total_costs,
    round(COALESCE(SUM(pr.retention_balance), 0), 2)::numeric AS total_retention_held,
    round((SELECT amount FROM billed) - (SELECT amount FROM paid), 2)::numeric AS outstanding_receivables,
    round(COALESCE(AVG(pr.completion_pct) FILTER (WHERE pr.status = 'active'), 0), 2)::numeric AS avg_completion_pct,
    COUNT(pr.id) FILTER (WHERE pr.net_cost > pr.budget)::bigint AS projects_over_budget
  FROM project_rows pr;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_project_valuation_trend(p_project_id uuid)
RETURNS TABLE(
  valuation_number integer,
  valuation_date date,
  gross_amount numeric,
  retention_amount numeric,
  net_amount numeric,
  cumulative_billed numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'A project is required.' USING ERRCODE = '22023';
  END IF;

  SELECT p.business_id INTO v_business_id
    FROM public.construction_projects p
   WHERE p.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;

  IF cardinality(public.construction_procurement_capabilities_for(v_business_id)) = 0 THEN
    RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    v.valuation_number,
    v.valuation_date,
    round(v.gross_amount, 2)::numeric,
    round(v.retention_amount, 2)::numeric,
    round(v.net_amount, 2)::numeric,
    round(SUM(v.net_amount) OVER (
      ORDER BY v.valuation_number ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ), 2)::numeric AS cumulative_billed
  FROM public.project_valuations v
  WHERE v.project_id = p_project_id
    AND v.status = 'invoiced'
  ORDER BY v.valuation_number ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_valuation_trend(p_project_id uuid)
RETURNS TABLE(
  valuation_number integer,
  valuation_date date,
  gross_amount numeric,
  retention_amount numeric,
  net_amount numeric,
  cumulative_billed numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.get_project_valuation_trend(p_project_id);
$$;

CREATE OR REPLACE FUNCTION public.get_retention_aging(p_business_id uuid)
RETURNS TABLE(
  project_id uuid,
  project_name text,
  client_name text,
  project_status text,
  retention_balance numeric,
  oldest_retention_date timestamptz,
  days_held integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(public.construction_procurement_capabilities_for(p_business_id)) = 0 THEN
    RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH retention_by_project AS (
    SELECT
      p.id AS project_id,
      p.name AS project_name,
      p.client_name,
      p.status AS project_status,
      round(
        COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'withheld'), 0)
        - COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'released'), 0),
        2
      )::numeric AS retention_balance,
      MIN(r.created_at) FILTER (WHERE r.type = 'withheld') AS oldest_retention_date
    FROM public.construction_projects p
    JOIN public.project_retention_ledger r ON r.project_id = p.id
    LEFT JOIN public.project_valuations rv ON rv.id = r.valuation_id
    WHERE p.business_id = p_business_id
      AND (r.valuation_id IS NULL OR rv.status IN ('submitted', 'invoiced'))
    GROUP BY p.id, p.name, p.client_name, p.status
  )
  SELECT
    rp.project_id,
    rp.project_name,
    rp.client_name,
    rp.project_status,
    rp.retention_balance,
    rp.oldest_retention_date,
    GREATEST(0, (CURRENT_DATE - rp.oldest_retention_date::date)::integer) AS days_held
  FROM retention_by_project rp
  WHERE rp.retention_balance > 0
  ORDER BY days_held DESC, rp.oldest_retention_date ASC, rp.project_name ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  p_business_id uuid,
  p_months integer
)
RETURNS TABLE(
  active_projects bigint,
  total_contract_value numeric,
  total_billed_this_period numeric,
  total_paid_this_period numeric,
  total_costs_this_period numeric,
  total_retention_held numeric,
  outstanding_receivables numeric,
  projects_over_budget bigint,
  avg_completion_pct numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since date;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(public.construction_procurement_capabilities_for(p_business_id)) = 0 THEN
    RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE = '42501';
  END IF;

  IF p_months IS NOT NULL AND p_months > 0 THEN
    v_since := (CURRENT_DATE - make_interval(months => p_months))::date;
  ELSE
    v_since := NULL;
  END IF;

  RETURN QUERY
  WITH project_rows AS (
    SELECT
      p.id,
      p.status,
      p.contract_sum,
      p.budget,
      COALESCE((
        SELECT SUM(l.quantity_ordered * COALESCE(l.expected_unit_price, 0))
          FROM public.construction_purchase_orders o
          JOIN public.construction_purchase_order_lines l ON l.po_id = o.id
         WHERE o.project_id = p.id
      ), 0)
      + COALESCE((
        SELECT SUM(i.total_cost_base)
          FROM public.construction_material_issues i
         WHERE i.project_id = p.id
      ), 0)
      - COALESCE((
        SELECT SUM(r.total_cost_base)
          FROM public.construction_material_returns r
         WHERE r.project_id = p.id
      ), 0) AS net_cost_all,
      COALESCE((
        SELECT SUM(CASE WHEN r.type = 'withheld' THEN r.amount ELSE -r.amount END)
          FROM public.project_retention_ledger r
          LEFT JOIN public.project_valuations rv ON rv.id = r.valuation_id
         WHERE r.project_id = p.id
           AND (r.valuation_id IS NULL OR rv.status IN ('submitted', 'invoiced'))
      ), 0) AS retention_balance,
      COALESCE((
        SELECT CASE
          WHEN COALESCE(SUM(b.total_value), 0) > 0 THEN
            round(SUM(b.total_value * COALESCE(vl.cumulative_pct, 0)) / SUM(b.total_value), 2)
          ELSE
            COALESCE(round(AVG(vl.cumulative_pct), 2), 0)
        END
          FROM (
            SELECT v.id
              FROM public.project_valuations v
             WHERE v.project_id = p.id
               AND v.status = 'invoiced'
             ORDER BY v.valuation_number DESC
             LIMIT 1
          ) latest_val
          LEFT JOIN public.project_boq_lines b ON b.project_id = p.id
          LEFT JOIN public.project_valuation_lines vl
            ON vl.valuation_id = latest_val.id AND vl.boq_line_id = b.id
         GROUP BY latest_val.id
      ), 0) AS completion_pct
    FROM public.construction_projects p
    WHERE p.business_id = p_business_id
  ),
  billed_all AS (
    SELECT COALESCE(SUM(v.net_amount), 0) AS amount
      FROM public.project_valuations v
      JOIN public.construction_projects p ON p.id = v.project_id
     WHERE p.business_id = p_business_id
       AND v.status = 'invoiced'
  ),
  billed_period AS (
    SELECT COALESCE(SUM(v.net_amount), 0) AS amount
      FROM public.project_valuations v
      JOIN public.construction_projects p ON p.id = v.project_id
     WHERE p.business_id = p_business_id
       AND v.status = 'invoiced'
       AND (v_since IS NULL OR v.valuation_date >= v_since)
  ),
  paid_all AS (
    SELECT COALESCE(SUM(ip.amount), 0) AS amount
      FROM public.invoice_payments ip
      JOIN public.invoices i ON i.id = ip.invoice_id
     WHERE i.business_id = p_business_id
       AND i.deleted_at IS NULL
       AND i.status <> 'void'
       AND EXISTS (
         SELECT 1
           FROM public.project_valuations v
           JOIN public.construction_projects p ON p.id = v.project_id
          WHERE p.business_id = p_business_id
            AND v.status = 'invoiced'
            AND v.invoice_id = i.id
       )
  ),
  paid_period AS (
    SELECT COALESCE(SUM(ip.amount), 0) AS amount
      FROM public.invoice_payments ip
      JOIN public.invoices i ON i.id = ip.invoice_id
     WHERE i.business_id = p_business_id
       AND i.deleted_at IS NULL
       AND i.status <> 'void'
       AND (v_since IS NULL OR ip.payment_date >= v_since)
       AND EXISTS (
         SELECT 1
           FROM public.project_valuations v
           JOIN public.construction_projects p ON p.id = v.project_id
          WHERE p.business_id = p_business_id
            AND v.status = 'invoiced'
            AND v.invoice_id = i.id
       )
  ),
  costs_period AS (
    SELECT
      COALESCE((
        SELECT SUM(l.quantity_ordered * COALESCE(l.expected_unit_price, 0))
          FROM public.construction_purchase_orders o
          JOIN public.construction_purchase_order_lines l ON l.po_id = o.id
          JOIN public.construction_projects p ON p.id = o.project_id
         WHERE p.business_id = p_business_id
           AND (v_since IS NULL OR o.created_at::date >= v_since)
      ), 0)
      + COALESCE((
        SELECT SUM(i.total_cost_base)
          FROM public.construction_material_issues i
          JOIN public.construction_projects p ON p.id = i.project_id
         WHERE p.business_id = p_business_id
           AND (v_since IS NULL OR i.issue_date >= v_since)
      ), 0)
      - COALESCE((
        SELECT SUM(r.total_cost_base)
          FROM public.construction_material_returns r
          JOIN public.construction_projects p ON p.id = r.project_id
         WHERE p.business_id = p_business_id
           AND (v_since IS NULL OR r.return_date >= v_since)
      ), 0) AS amount
  )
  SELECT
    COUNT(pr.id) FILTER (WHERE pr.status = 'active')::bigint AS active_projects,
    round(COALESCE(SUM(pr.contract_sum), 0), 2)::numeric AS total_contract_value,
    round((SELECT amount FROM billed_period), 2)::numeric AS total_billed_this_period,
    round((SELECT amount FROM paid_period), 2)::numeric AS total_paid_this_period,
    round((SELECT amount FROM costs_period), 2)::numeric AS total_costs_this_period,
    round(COALESCE(SUM(pr.retention_balance), 0), 2)::numeric AS total_retention_held,
    round((SELECT amount FROM billed_all) - (SELECT amount FROM paid_all), 2)::numeric AS outstanding_receivables,
    COUNT(pr.id) FILTER (WHERE pr.net_cost_all > pr.budget)::bigint AS projects_over_budget,
    round(COALESCE(AVG(pr.completion_pct) FILTER (WHERE pr.status = 'active'), 0), 2)::numeric AS avg_completion_pct
  FROM project_rows pr;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(p_business_id uuid)
RETURNS TABLE(
  active_projects bigint,
  total_contract_value numeric,
  total_billed_this_period numeric,
  total_paid_this_period numeric,
  total_costs_this_period numeric,
  total_retention_held numeric,
  outstanding_receivables numeric,
  projects_over_budget bigint,
  avg_completion_pct numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.get_dashboard_metrics(p_business_id, 12);
$$;

CREATE OR REPLACE FUNCTION public.get_cost_breakdown_by_project(p_business_id uuid)
RETURNS TABLE(
  project_id uuid,
  project_name text,
  total_po_value numeric,
  total_issued_value numeric,
  total_returned_value numeric,
  net_cost numeric,
  budget numeric,
  variance numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;
  IF cardinality(public.construction_procurement_capabilities_for(p_business_id)) = 0 THEN
    RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH costs AS (
    SELECT
      p.id AS project_id,
      p.name AS project_name,
      round(COALESCE((
        SELECT SUM(l.quantity_ordered * COALESCE(l.expected_unit_price, 0))
          FROM public.construction_purchase_orders o
          JOIN public.construction_purchase_order_lines l ON l.po_id = o.id
         WHERE o.project_id = p.id
      ), 0), 2)::numeric AS total_po_value,
      round(COALESCE((
        SELECT SUM(i.total_cost_base)
          FROM public.construction_material_issues i
         WHERE i.project_id = p.id
      ), 0), 2)::numeric AS total_issued_value,
      round(COALESCE((
        SELECT SUM(r.total_cost_base)
          FROM public.construction_material_returns r
         WHERE r.project_id = p.id
      ), 0), 2)::numeric AS total_returned_value,
      round(p.budget, 2)::numeric AS budget
    FROM public.construction_projects p
    WHERE p.business_id = p_business_id
  )
  SELECT
    c.project_id,
    c.project_name,
    c.total_po_value,
    c.total_issued_value,
    c.total_returned_value,
    round(c.total_po_value - c.total_returned_value + c.total_issued_value, 2)::numeric AS net_cost,
    c.budget,
    round(c.budget - (c.total_po_value - c.total_returned_value + c.total_issued_value), 2)::numeric AS variance
  FROM costs c
  WHERE (c.total_po_value - c.total_returned_value + c.total_issued_value) > 0
  ORDER BY net_cost DESC, c.project_name ASC;
END;
$$;

DO $$
DECLARE
  v_fn text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'get_project_pnl(uuid)',
    'get_portfolio_summary(uuid)',
    'get_project_valuation_trend(uuid)',
    'get_valuation_trend(uuid)',
    'get_retention_aging(uuid)',
    'get_dashboard_metrics(uuid,integer)',
    'get_dashboard_metrics(uuid)',
    'get_cost_breakdown_by_project(uuid)'
  ] LOOP
    IF to_regprocedure('public.' || v_fn) IS NULL THEN
      RAISE EXCEPTION 'Required construction reporting RPC % is missing.', v_fn;
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', v_fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', v_fn);
    IF (SELECT provolatile FROM pg_proc WHERE oid = ('public.' || v_fn)::regprocedure) <> 's' THEN
      RAISE EXCEPTION 'Construction reporting RPC % must be STABLE (read-only).', v_fn;
    END IF;
  END LOOP;

  FOREACH v_fn IN ARRAY ARRAY[
    'get_project_pnl(uuid)',
    'get_portfolio_summary(uuid)',
    'get_project_valuation_trend(uuid)',
    'get_retention_aging(uuid)',
    'get_dashboard_metrics(uuid,integer)',
    'get_cost_breakdown_by_project(uuid)'
  ] LOOP
    v_def := lower(pg_get_functiondef(('public.' || v_fn)::regprocedure));
    IF position('construction_procurement_capabilities_for' IN v_def) = 0 THEN
      RAISE EXCEPTION 'Grant verification missing in %.', v_fn;
    END IF;
  END LOOP;
END;
$$;
