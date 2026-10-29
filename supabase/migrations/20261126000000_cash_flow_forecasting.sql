-- 5B-3c: cash flow forecasting.
-- Forecasts are computed on demand; only named scenario assumptions persist.
-- No invoices, expenses, payroll runs, certificates, or purchase orders are written.

CREATE TABLE IF NOT EXISTS public.cash_forecast_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  receivable_delay_days integer NOT NULL DEFAULT 0
    CHECK (receivable_delay_days BETWEEN 0 AND 365),
  payable_delay_days integer NOT NULL DEFAULT 0
    CHECK (payable_delay_days BETWEEN 0 AND 365),
  payroll_growth_percent numeric(7,2) NOT NULL DEFAULT 0
    CHECK (payroll_growth_percent BETWEEN -100 AND 300),
  include_construction boolean NOT NULL DEFAULT true,
  horizon_months integer NOT NULL DEFAULT 12
    CHECK (horizon_months BETWEEN 1 AND 12),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, name)
);

CREATE INDEX IF NOT EXISTS cash_forecast_scenarios_business_idx
  ON public.cash_forecast_scenarios (business_id, updated_at DESC);

ALTER TABLE public.cash_forecast_scenarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_forecast_scenarios_member_select
  ON public.cash_forecast_scenarios;
CREATE POLICY cash_forecast_scenarios_member_select
  ON public.cash_forecast_scenarios FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS cash_forecast_scenarios_member_insert
  ON public.cash_forecast_scenarios;
CREATE POLICY cash_forecast_scenarios_member_insert
  ON public.cash_forecast_scenarios FOR INSERT TO authenticated
  WITH CHECK (
    public.is_business_member(business_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS cash_forecast_scenarios_member_update
  ON public.cash_forecast_scenarios;
CREATE POLICY cash_forecast_scenarios_member_update
  ON public.cash_forecast_scenarios FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));

DROP POLICY IF EXISTS cash_forecast_scenarios_member_delete
  ON public.cash_forecast_scenarios;
CREATE POLICY cash_forecast_scenarios_member_delete
  ON public.cash_forecast_scenarios FOR DELETE TO authenticated
  USING (public.is_business_member(business_id));

REVOKE ALL ON public.cash_forecast_scenarios FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cash_forecast_scenarios TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_cash_forecast(
  p_business_id uuid,
  p_horizon_months integer DEFAULT 12,
  p_receivable_delay_days integer DEFAULT 0,
  p_payable_delay_days integer DEFAULT 0,
  p_payroll_growth_percent numeric DEFAULT 0,
  p_include_construction boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base_currency text;
  v_include_construction boolean := false;
  v_as_of_date date := current_date;
  v_first_month date := date_trunc('month', current_date)::date;
  v_opening_balance numeric := 0;
  v_average_monthly_payroll numeric := 0;
  v_months jsonb := '[]'::jsonb;
  v_source_counts jsonb := '{}'::jsonb;
  v_shortfall_months integer := 0;
  v_unpriced_po_count integer := 0;
  v_foreign_po_count integer := 0;
  v_foreign_cash_account_count integer := 0;
  v_unlinked_certificate_count integer := 0;
  v_estimated_retention_count integer := 0;
BEGIN
  IF p_business_id IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'Access denied to business.' USING ERRCODE = '42501';
  END IF;
  IF p_horizon_months IS NULL OR p_horizon_months < 1 OR p_horizon_months > 12
     OR p_receivable_delay_days IS NULL OR p_receivable_delay_days < 0 OR p_receivable_delay_days > 365
     OR p_payable_delay_days IS NULL OR p_payable_delay_days < 0 OR p_payable_delay_days > 365
     OR p_payroll_growth_percent IS NULL
     OR p_payroll_growth_percent < -100 OR p_payroll_growth_percent > 300
     OR p_include_construction IS NULL THEN
    RAISE EXCEPTION 'Invalid forecast assumptions.' USING ERRCODE = '22023';
  END IF;

  SELECT b.base_currency INTO v_base_currency
    FROM public.businesses b
   WHERE b.id = p_business_id;
  IF v_base_currency IS NULL THEN
    RAISE EXCEPTION 'Business base currency is unavailable.' USING ERRCODE = '22023';
  END IF;

  -- Same cash-equivalent account definition used by FinancialStatementRepository:
  -- active bank accounts plus the standard petty-cash/mobile-money accounts.
  -- Journal movement is already translated to business base currency in amount_base.
  SELECT COALESCE(SUM(
    CASE WHEN a.currency = v_base_currency THEN a.opening_balance ELSE 0 END
      + COALESCE(movements.signed_base_movement, 0)
  ), 0)
    INTO v_opening_balance
    FROM public.accounts a
    LEFT JOIN LATERAL (
      SELECT SUM(
        CASE
          WHEN a.normal_balance = 'debit' AND jl.is_debit THEN jl.amount_base
          WHEN a.normal_balance = 'debit' AND NOT jl.is_debit THEN -jl.amount_base
          WHEN a.normal_balance <> 'debit' AND jl.is_debit THEN -jl.amount_base
          ELSE jl.amount_base
        END
      ) AS signed_base_movement
        FROM public.journal_lines jl
        JOIN public.journal_entries je
          ON je.id = jl.journal_entry_id
         AND je.business_id = jl.business_id
       WHERE jl.business_id = p_business_id
         AND jl.account_id = a.id
         AND je.status IN ('posted'::public.journal_status, 'reversed'::public.journal_status)
         AND je.entry_date <= v_as_of_date
         AND public.can_access_branch(p_business_id, je.branch_id)
         AND (jl.branch_id IS NULL OR public.can_access_branch(p_business_id, jl.branch_id))
    ) movements ON true
   WHERE a.business_id = p_business_id
     AND a.is_active
     AND a.deleted_at IS NULL
     AND (a.is_bank_account OR a.code IN ('1110', '1115', '1125', '1126'))
     AND public.can_access_branch(p_business_id, a.branch_id);

  SELECT count(*) INTO v_foreign_cash_account_count
    FROM public.accounts a
   WHERE a.business_id = p_business_id
     AND a.is_active
     AND a.deleted_at IS NULL
     AND a.currency <> v_base_currency
     AND (a.is_bank_account OR a.code IN ('1110', '1115', '1125', '1126'))
     AND public.can_access_branch(p_business_id, a.branch_id);

  -- Average paid payroll across the last three completed calendar months;
  -- each month, including a zero month, is included in the average.
  SELECT COALESCE(AVG(month_total), 0)
    INTO v_average_monthly_payroll
    FROM (
      SELECT month_start,
        COALESCE((
          SELECT SUM(pr.total_net)
            FROM public.payroll_runs pr
           WHERE pr.business_id = p_business_id
             AND pr.status = 'paid'::public.payroll_status
             AND date_trunc('month', pr.pay_date)::date = history_month.month_start
        ), 0) AS month_total
        FROM generate_series(
          (v_first_month - interval '3 months')::date,
          (v_first_month - interval '1 month')::date,
          interval '1 month'
        ) AS history_month(month_start)
    ) payroll_history;

  v_include_construction := p_include_construction
    AND COALESCE(cardinality(public.construction_procurement_capabilities_for(p_business_id)), 0) > 0;

  IF v_include_construction THEN
    SELECT count(*) FILTER (WHERE l.expected_unit_price IS NULL),
           count(*) FILTER (WHERE o.currency <> v_base_currency)
      INTO v_unpriced_po_count, v_foreign_po_count
      FROM public.construction_purchase_orders o
      JOIN public.construction_purchase_order_lines l
        ON l.po_id = o.id AND l.business_id = p_business_id
     WHERE o.business_id = p_business_id
       AND o.project_id IS NOT NULL
       AND o.status = 'authorized'
       AND (l.expected_unit_price IS NULL OR o.currency <> v_base_currency);

    SELECT count(*) INTO v_unlinked_certificate_count
      FROM public.payment_certificates c
      JOIN public.project_valuations v
        ON v.id = c.valuation_id AND v.project_id = c.project_id
     WHERE c.business_id = p_business_id
       AND c.status IN ('issued', 'partially_paid')
       AND v.invoice_id IS NULL;

    SELECT count(*) INTO v_estimated_retention_count
      FROM (
        SELECT p.id
          FROM public.construction_projects p
          JOIN public.project_retention_ledger r ON r.project_id = p.id
         WHERE p.business_id = p_business_id
           AND p.status = 'closed'
         GROUP BY p.id
        HAVING GREATEST(
          COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'withheld'), 0)
          - COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'released'), 0), 0
        ) > 0
      ) eligible_retention;
  END IF;

  WITH calendar AS (
    SELECT generate_series(
      v_first_month,
      (v_first_month + ((p_horizon_months - 1) || ' months')::interval)::date,
      interval '1 month'
    )::date AS month_start
  ),
  invoice_flows AS (
    SELECT
      date_trunc('month', GREATEST(
        COALESCE(i.due_date, i.issue_date + COALESCE(c.credit_terms_days, 0)::integer)
          + p_receivable_delay_days,
        v_as_of_date
      ))::date AS month_start,
      'receivables'::text AS source,
      CASE
        WHEN i.functional_amount IS NOT NULL AND i.functional_currency = v_base_currency
          THEN GREATEST(i.functional_amount - COALESCE(payments.paid_base, 0), 0)
        ELSE GREATEST(i.total_amount - i.amount_paid, 0)::numeric * COALESCE(i.exchange_rate, 1)
      END AS amount,
      'inflow'::text AS direction
      FROM public.invoices i
      LEFT JOIN public.contacts c
        ON c.id = i.contact_id AND c.business_id = p_business_id
      LEFT JOIN LATERAL (
        SELECT SUM(CASE
          WHEN ip.functional_amount IS NOT NULL AND ip.functional_currency = v_base_currency
            THEN ip.functional_amount
          ELSE ip.amount * COALESCE(ip.exchange_rate, 1)
        END) AS paid_base
          FROM public.invoice_payments ip
         WHERE ip.business_id = p_business_id
           AND ip.invoice_id = i.id
      ) payments ON true
     WHERE i.business_id = p_business_id
       AND i.deleted_at IS NULL
       AND i.invoice_type = 'invoice'
       AND i.status IN ('sent', 'partially_paid', 'overdue')
       AND i.total_amount > i.amount_paid
       AND public.can_access_branch(p_business_id, i.branch_id)
  ),
  expense_flows AS (
    SELECT
      date_trunc('month', GREATEST(
        COALESCE(e.due_date, e.expense_date) + p_payable_delay_days,
        v_as_of_date
      ))::date AS month_start,
      'payables'::text AS source,
      CASE
        WHEN e.functional_amount IS NOT NULL AND e.functional_currency = v_base_currency
          THEN GREATEST(e.functional_amount - COALESCE(payments.paid_base, 0), 0)
        ELSE GREATEST(e.total_amount - e.amount_paid, 0)::numeric * COALESCE(e.exchange_rate, 1)
      END AS amount,
      'outflow'::text AS direction
      FROM public.expenses e
      LEFT JOIN LATERAL (
        SELECT SUM(CASE
          WHEN ep.functional_amount IS NOT NULL AND ep.functional_currency = v_base_currency
            THEN ep.functional_amount
          ELSE ep.amount * COALESCE(ep.exchange_rate, 1)
        END) AS paid_base
          FROM public.expense_payments ep
         WHERE ep.business_id = p_business_id
           AND ep.expense_id = e.id
      ) payments ON true
     WHERE e.business_id = p_business_id
       AND e.deleted_at IS NULL
       AND e.status NOT IN ('draft', 'void', 'rejected', 'cancelled', 'paid')
       AND e.total_amount > e.amount_paid
       AND public.can_access_branch(p_business_id, e.branch_id)
  ),
  payroll_months AS (
    SELECT cal.month_start,
      COALESCE((
        SELECT SUM(pr.total_net)
          FROM public.payroll_runs pr
         WHERE pr.business_id = p_business_id
           AND pr.status = 'approved'::public.payroll_status
           AND date_trunc('month', pr.pay_date)::date = cal.month_start
      ), 0) AS approved_total,
      GREATEST(
        v_average_monthly_payroll
          * power(1 + p_payroll_growth_percent / 100.0,
                  ((cal.month_start - v_first_month)::numeric / 365.25)),
        0
      ) AS projected_total
      FROM calendar cal
  ),
  payroll_flows AS (
    SELECT month_start,
      'payroll'::text AS source,
      GREATEST(approved_total, projected_total) AS amount,
      'outflow'::text AS direction
      FROM payroll_months
     WHERE GREATEST(approved_total, projected_total) > 0
  ),
  certificate_flows AS (
    SELECT date_trunc('month', GREATEST(
        COALESCE(c.payment_due_date, c.certificate_date) + p_receivable_delay_days,
        v_as_of_date
      ))::date AS month_start,
      'certificates'::text AS source,
      GREATEST(c.net_amount - c.paid_amount, 0)::numeric AS amount,
      'inflow'::text AS direction
      FROM public.payment_certificates c
      JOIN public.project_valuations v
        ON v.id = c.valuation_id AND v.project_id = c.project_id
      JOIN public.construction_projects p
        ON p.id = c.project_id AND p.business_id = p_business_id
     WHERE v_include_construction
       AND c.business_id = p_business_id
       AND c.status IN ('issued', 'partially_paid')
       AND c.net_amount > c.paid_amount
       AND v.invoice_id IS NULL
  ),
  retention_flows AS (
    SELECT date_trunc('month', GREATEST(
        COALESCE(p.end_date, v_as_of_date) + p_receivable_delay_days,
        v_as_of_date
      ))::date AS month_start,
      'retention'::text AS source,
      GREATEST(
        COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'withheld'), 0)
        - COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'released'), 0), 0
      )::numeric AS amount,
      'inflow'::text AS direction
      FROM public.construction_projects p
      JOIN public.project_retention_ledger r ON r.project_id = p.id
     WHERE v_include_construction
       AND p.business_id = p_business_id
       AND p.status = 'closed'
     GROUP BY p.id, p.end_date
    HAVING GREATEST(
        COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'withheld'), 0)
        - COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'released'), 0), 0
      ) > 0
  ),
  po_received AS (
    SELECT rl.po_line_id, SUM(rl.quantity_received) AS quantity_received
      FROM public.construction_goods_receipt_lines rl
     WHERE rl.business_id = p_business_id
     GROUP BY rl.po_line_id
  ),
  po_flows AS (
    SELECT date_trunc('month', GREATEST(
        COALESCE(o.authorized_at::date, o.created_at::date) + p_payable_delay_days,
        v_as_of_date
      ))::date AS month_start,
      'purchase_orders'::text AS source,
      GREATEST(l.quantity_ordered - COALESCE(pr.quantity_received, 0), 0)
        * l.expected_unit_price AS amount,
      'outflow'::text AS direction
      FROM public.construction_purchase_orders o
      JOIN public.construction_purchase_order_lines l
        ON l.po_id = o.id AND l.business_id = p_business_id
      LEFT JOIN po_received pr ON pr.po_line_id = l.id
     WHERE v_include_construction
       AND o.business_id = p_business_id
       AND o.project_id IS NOT NULL
       AND o.status = 'authorized'
       AND o.currency = v_base_currency
       AND l.expected_unit_price IS NOT NULL
       AND l.quantity_ordered > COALESCE(pr.quantity_received, 0)
       AND public.can_access_branch(p_business_id, o.branch_id)
  ),
  raw_flows AS (
    SELECT * FROM invoice_flows
    UNION ALL SELECT * FROM expense_flows
    UNION ALL SELECT * FROM payroll_flows
    UNION ALL SELECT * FROM certificate_flows
    UNION ALL SELECT * FROM retention_flows
    UNION ALL SELECT * FROM po_flows
  ),
  month_totals AS (
    SELECT cal.month_start,
      COALESCE(SUM(f.amount) FILTER (WHERE f.direction = 'inflow'), 0)::numeric AS inflows,
      COALESCE(SUM(f.amount) FILTER (WHERE f.direction = 'outflow'), 0)::numeric AS outflows,
      COALESCE(SUM(f.amount) FILTER (WHERE f.source = 'receivables'), 0)::numeric AS receivables,
      COALESCE(SUM(f.amount) FILTER (WHERE f.source = 'payables'), 0)::numeric AS payables,
      COALESCE(SUM(f.amount) FILTER (WHERE f.source = 'payroll'), 0)::numeric AS payroll,
      COALESCE(SUM(f.amount) FILTER (WHERE f.source IN ('certificates', 'retention')), 0)::numeric AS construction_inflows,
      COALESCE(SUM(f.amount) FILTER (WHERE f.source = 'purchase_orders'), 0)::numeric AS purchase_orders
      FROM calendar cal
      LEFT JOIN raw_flows f ON f.month_start = cal.month_start
     GROUP BY cal.month_start
  ),
  rolled AS (
    SELECT month_start, inflows, outflows, inflows - outflows AS net,
      (v_opening_balance + COALESCE(SUM(inflows - outflows) OVER (
        ORDER BY month_start ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ), 0))::numeric AS opening,
      (v_opening_balance + SUM(inflows - outflows) OVER (
        ORDER BY month_start ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ))::numeric AS closing,
      receivables, payables, payroll, construction_inflows, purchase_orders
      FROM month_totals
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'month', month_start,
      'opening', opening,
      'inflows', inflows,
      'outflows', outflows,
      'net', net,
      'closing', closing,
      'receivables', receivables,
      'payables', payables,
      'payroll', payroll,
      'construction_inflows', construction_inflows,
      'purchase_orders', purchase_orders
    ) ORDER BY month_start), '[]'::jsonb),
    count(*) FILTER (WHERE closing < 0)
    INTO v_months, v_shortfall_months
    FROM rolled;

  WITH po_received AS (
    SELECT rl.po_line_id, SUM(rl.quantity_received) AS quantity_received
      FROM public.construction_goods_receipt_lines rl
     WHERE rl.business_id = p_business_id
     GROUP BY rl.po_line_id
  ), counts AS (
    SELECT f.source, count(*) AS row_count
      FROM (
        SELECT 'receivables'::text AS source FROM public.invoices i
         WHERE i.business_id = p_business_id AND i.deleted_at IS NULL
           AND i.invoice_type = 'invoice' AND i.status IN ('sent', 'partially_paid', 'overdue')
           AND i.total_amount > i.amount_paid
           AND public.can_access_branch(p_business_id, i.branch_id)
        UNION ALL
        SELECT 'payables' FROM public.expenses e
         WHERE e.business_id = p_business_id AND e.deleted_at IS NULL
           AND e.status NOT IN ('draft', 'void', 'rejected', 'cancelled', 'paid')
           AND e.total_amount > e.amount_paid
           AND public.can_access_branch(p_business_id, e.branch_id)
        UNION ALL
        SELECT 'payroll' FROM public.payroll_runs pr
         WHERE pr.business_id = p_business_id
           AND pr.status IN ('paid'::public.payroll_status, 'approved'::public.payroll_status)
           AND pr.pay_date >= v_first_month - interval '3 months'
        UNION ALL
        SELECT 'certificates' FROM public.payment_certificates c
         JOIN public.project_valuations v ON v.id = c.valuation_id AND v.project_id = c.project_id
         JOIN public.construction_projects p ON p.id = c.project_id AND p.business_id = p_business_id
         WHERE v_include_construction AND c.business_id = p_business_id
           AND c.status IN ('issued', 'partially_paid') AND c.net_amount > c.paid_amount
           AND v.invoice_id IS NULL
        UNION ALL
        SELECT 'retention' FROM public.construction_projects p
         JOIN public.project_retention_ledger r ON r.project_id = p.id
         WHERE v_include_construction AND p.business_id = p_business_id AND p.status = 'closed'
         GROUP BY p.id
        HAVING GREATEST(
          COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'withheld'), 0)
          - COALESCE(SUM(r.amount) FILTER (WHERE r.type = 'released'), 0), 0
        ) > 0
        UNION ALL
        SELECT 'purchase_orders' FROM public.construction_purchase_orders o
         JOIN public.construction_purchase_order_lines l ON l.po_id = o.id AND l.business_id = p_business_id
         LEFT JOIN po_received pr ON pr.po_line_id = l.id
         WHERE v_include_construction AND o.business_id = p_business_id
           AND o.project_id IS NOT NULL AND o.status = 'authorized'
           AND o.currency = v_base_currency AND l.expected_unit_price IS NOT NULL
           AND l.quantity_ordered > COALESCE(pr.quantity_received, 0)
           AND public.can_access_branch(p_business_id, o.branch_id)
      ) f
     GROUP BY f.source
  )
  SELECT COALESCE(jsonb_object_agg(source, row_count), '{}'::jsonb)
    INTO v_source_counts FROM counts;

  RETURN jsonb_build_object(
    'as_of_date', v_as_of_date,
    'base_currency', v_base_currency,
    'horizon_months', p_horizon_months,
    'opening_balance', v_opening_balance,
    'months', v_months,
    'source_counts', v_source_counts,
    'shortfall_months', v_shortfall_months,
    'average_monthly_payroll', v_average_monthly_payroll,
    'foreign_cash_account_count', v_foreign_cash_account_count,
    'construction_available', COALESCE(cardinality(public.construction_procurement_capabilities_for(p_business_id)), 0) > 0,
    'unpriced_purchase_order_lines', CASE WHEN v_include_construction THEN v_unpriced_po_count ELSE 0 END,
    'foreign_currency_purchase_order_lines', CASE WHEN v_include_construction THEN v_foreign_po_count ELSE 0 END,
    'unlinked_certificate_count', CASE WHEN v_include_construction THEN v_unlinked_certificate_count ELSE 0 END,
    'estimated_retention_projects', CASE WHEN v_include_construction THEN v_estimated_retention_count ELSE 0 END
  );
END;
$$;

COMMENT ON TABLE public.cash_forecast_scenarios IS
  'Named, lightweight assumption sets for computed cash forecasts; contains no transactional records.';
COMMENT ON FUNCTION public.generate_cash_forecast(uuid, integer, integer, integer, numeric, boolean) IS
  'Computes a rolling cash forecast without writing financial transactions. Opening balances for non-base-currency cash accounts are excluded; posted journal movements use amount_base. Unlinked construction certificates and held retention have no currency field and are treated as base currency; closed-project retention is estimated at end date (or today). Construction POs are included only when priced and denominated in the business base currency.';

REVOKE ALL ON FUNCTION public.generate_cash_forecast(uuid, integer, integer, integer, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_cash_forecast(uuid, integer, integer, integer, numeric, boolean) TO authenticated;
