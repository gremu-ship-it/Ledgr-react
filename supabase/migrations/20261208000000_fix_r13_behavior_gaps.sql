-- R13 behavior-gap corrections (additive, no data rewrite).
--
-- This migration fixes three concrete contract mismatches:
--   * approved construction receipt releases can post later accepted deltas even
--     though the general inventory duplicate guard suppresses same-source rows;
--   * stock adjustment rows with a stable source id receive a traceable default
--     reference when a caller omits free-text reference/notes; and
--   * dashboard reporting periods are month-bucket based, so the complete first
--     month in the requested rolling-month window is included.

-- Private one-use transaction context authorizes only receipt movements emitted
-- by post_construction_receipt_movement. It is not exposed to API roles.
create schema if not exists ledgr_private;
revoke all on schema ledgr_private from public, anon, authenticated, service_role;

create table if not exists ledgr_private.construction_receipt_posting_context (
  transaction_id bigint not null,
  business_id uuid not null,
  grn_id uuid not null,
  product_id uuid not null,
  location_id uuid not null,
  primary key (transaction_id, business_id, grn_id, product_id, location_id)
);
revoke all on table ledgr_private.construction_receipt_posting_context
  from public, anon, authenticated, service_role;

-- Preserve the duplicate-source guard for ordinary sales/purchases. A receipt
-- posting command consumes one private marker per movement, allowing an
-- evidenced release to append only its unposted delta. Direct construction_grn
-- inserts without that marker are refused.
create or replace function public._ledgr_guard_stock_movement_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity text;
  v_context_rows integer := 0;
begin
  if new.movement_type::text in ('adjustment_in', 'adjustment_out')
     and nullif(btrim(coalesce(new.reference, '')), '') is null
     and nullif(btrim(coalesce(new.notes, '')), '') is null then
    if new.source_id is null then
      raise exception 'inventory-adjustment-reason-required' using errcode = '22023';
    end if;
    new.reference := format('Stock adjustment %s, source %s', new.movement_type::text, new.source_id::text);
  end if;

  if new.source_type = 'construction_grn' then
    if new.source_id is null then
      raise exception 'construction-receipt-posting-command-required' using errcode = '42501';
    end if;
    delete from ledgr_private.construction_receipt_posting_context c
     where c.transaction_id = txid_current()
       and c.business_id = new.business_id
       and c.grn_id::text = new.source_id::text
       and c.product_id = new.product_id
       and c.location_id = new.location_id;
    get diagnostics v_context_rows = row_count;
    if v_context_rows = 0 then
      raise exception 'construction-receipt-posting-command-required' using errcode = '42501';
    end if;
    v_identity := concat_ws('|', new.business_id::text, new.source_type,
      new.source_id::text, new.product_id::text, new.location_id::text);
    perform pg_advisory_xact_lock(hashtextextended(v_identity, 0));
    return new;
  end if;

  if new.movement_type::text in ('sale', 'purchase')
     and new.source_type is not null and new.source_id is not null then
    v_identity := concat_ws('|', new.business_id::text, new.source_type,
      new.source_id::text, new.product_id::text, new.location_id::text);
    perform pg_advisory_xact_lock(hashtextextended(v_identity, 0));

    if exists (
      select 1
        from public.stock_movements sm
       where sm.business_id = new.business_id
         and sm.source_type = new.source_type
         and sm.source_id::text = new.source_id::text
         and sm.product_id = new.product_id
         and sm.location_id = new.location_id
    ) then
      return null;
    end if;
  end if;

  return new;
end;
$$;
revoke all on function public._ledgr_guard_stock_movement_insert() from public, anon, authenticated;
comment on function public._ledgr_guard_stock_movement_insert() is
  'R13: preserves duplicate-source prevention, allows only one-use internally authorized construction receipt delta movements, and records a traceable source reference for reasonless adjustment rows.';

-- Repost only unposted accepted receipt deltas under a transaction lock.
create or replace function public.post_construction_receipt_movement(p_grn_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_grn      public.construction_goods_receipt_notes%rowtype;
  v_actor    uuid;
  v_policy   public.construction_receipt_posting_policies%rowtype;
  v_line     public.construction_goods_receipt_lines%rowtype;
  v_covered  numeric;
  v_weighted numeric;
  v_cost_sum numeric;
  v_moved    integer := 0;
  v_movement_id uuid;
  v_delta       numeric;
begin
  if p_grn_id is null then
    raise exception 'A goods receipt is required.' using errcode = '22023';
  end if;

  select * into v_grn from public.construction_goods_receipt_notes where id = p_grn_id for update;
  if not found then
    raise exception 'Goods receipt not found.' using errcode = '42501';
  end if;

  v_actor := public._ledgr_construction_actor(v_grn.business_id, 'procurement.receipt.post');
  if not public.can_access_branch(v_grn.business_id, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;
  if not public.can_access_location(v_grn.business_id, v_grn.location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  -- What has already reached stock is tracked per receipt line, so a second call
  -- posts only the difference (normally nothing at all) and a quality release
  -- made AFTER a posting is still posted instead of being silently stranded. The
  -- GRN row is locked above, so a concurrent pair serialises and the loser sees
  -- an empty delta.

  select * into v_policy from public.construction_receipt_posting_policies where business_id = v_grn.business_id;
  if not found or not v_policy.movement_posting_enabled then
    raise exception 'receipt-posting-not-approved: receipt movement posting has no approved accounting policy for this business.'
      using errcode = '22023';
  end if;
  if v_policy.gl_posting_enabled then
    raise exception 'receipt-gl-posting-not-approved: GL posting from a goods receipt is not approved.' using errcode = '22023';
  end if;

  -- The period lock is absolute: a receipt dated inside a closed period is
  -- denied here, and this file never reopens a period.
  perform public._ledgr_assert_period_open(v_grn.business_id, v_grn.receipt_date, 'Goods receipt movement');

  -- Coverage is all-or-nothing for every line that still has an unposted accepted
  -- quantity: a partially costed line is never posted, so no quantity reaches
  -- stock at an unknown cost. The check runs for the WHOLE receipt before any
  -- movement is written, so a failure posts nothing at all.
  for v_line in
    select * from public.construction_goods_receipt_lines l
     where l.grn_id = v_grn.id order by l.line_number
  loop
    if v_line.accepted_base > v_line.quantity_posted_base then
      select coalesce(sum(c.quantity_base), 0) into v_covered
        from public.construction_receipt_cost_bases c where c.grn_line_id = v_line.id;
      if v_covered < v_line.accepted_base then
        raise exception 'receipt-cost-basis-incomplete: receipt line % has an accepted quantity of % but only % has an evidenced cost basis. Nothing was posted.',
          v_line.line_number, v_line.accepted_base, v_covered using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_line in
    select * from public.construction_goods_receipt_lines l
     where l.grn_id = v_grn.id order by l.line_number
  loop
    v_delta := v_line.accepted_base - v_line.quantity_posted_base;
    if v_delta > 0 then
      select coalesce(sum(c.quantity_base * c.unit_cost_base), 0),
             nullif(sum(c.quantity_base), 0)
        into v_cost_sum, v_weighted
        from public.construction_receipt_cost_bases c where c.grn_line_id = v_line.id;
      if v_weighted is null or v_cost_sum <= 0 then
        raise exception 'receipt-cost-basis-incomplete: receipt line % has no evidenced cost.', v_line.line_number
          using errcode = '22023';
      end if;

      -- A private one-use marker lets the inventory guard distinguish this
      -- serialized command's legitimate delta from a direct source spoof.
      insert into ledgr_private.construction_receipt_posting_context
        (transaction_id, business_id, grn_id, product_id, location_id)
      values (txid_current(), v_grn.business_id, v_grn.id, v_line.product_id, v_grn.location_id);

      -- Only public.stock_movements is written. The shared R06 balance writer
      -- propagates the balance; this file never touches inventory_balances.
      insert into public.stock_movements
        (business_id, product_id, location_id, movement_type, movement_date, quantity,
         unit_cost, source_type, source_id, reference, created_by, notes)
      values (v_grn.business_id, v_line.product_id, v_grn.location_id, 'purchase', v_grn.receipt_date,
              v_delta, v_cost_sum / v_weighted, 'construction_grn', v_grn.id,
              v_grn.grn_number, v_actor,
              'Construction goods receipt ' || v_grn.grn_number || ' line ' || v_line.line_number)
      returning id into v_movement_id;
      if v_movement_id is null then
        raise exception 'The authorized construction receipt movement was not inserted.' using errcode = 'P0001';
      end if;

      perform set_config('ledgr.construction_command', 'receipt_post', true);
      update public.construction_goods_receipt_lines
         set quantity_posted_base = quantity_posted_base + v_delta
       where id = v_line.id;
      perform set_config('ledgr.construction_command', '', true);

      v_moved := v_moved + 1;
    end if;
  end loop;

  if v_moved = 0 then
    return jsonb_build_object('id', v_grn.id, 'movements', 0, 'idempotent', true,
                              'journal_effect', 'none');
  end if;
  return jsonb_build_object('id', v_grn.id, 'movements', v_moved, 'idempotent', false,
                            'journal_effect', 'none');
end;
$$;
revoke all on function public.post_construction_receipt_movement(uuid) from public, anon;
grant execute on function public.post_construction_receipt_movement(uuid) to authenticated, service_role;

-- Rolling dashboard filters include the complete first calendar month.
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
    v_since := date_trunc('month', CURRENT_DATE - make_interval(months => p_months))::date;
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
revoke all on function public.get_dashboard_metrics(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_dashboard_metrics(uuid, integer) to authenticated;
comment on function public.get_dashboard_metrics(uuid, integer) is
  'Construction dashboard metrics over the requested rolling calendar-month window; includes the full first month in that window.';
