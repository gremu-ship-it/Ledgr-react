-- System-wide type-casting and reversal-integrity hardening.
-- Migration 20261221000000 is occupied by payroll biweekly-frequency work and
-- 20261222000000 by the employee-audit resource-id fix; this follow-up uses the
-- next available version rather than rewriting migration history.
--
-- Polymorphic source IDs are compared as text on both sides, and UUIDs written
-- to known TEXT source columns are explicitly cast. Stock-transfer writes keep
-- their paired UUID/TEXT handling for live and clean-replay schemas.


-- Keep the active inventory backfill safe for UUID and TEXT source_id schemas.
-- PostgreSQL cannot replace an existing TABLE-returning function when its OUT
-- row type differs on the target database, so drop/recreate this signature as
-- the earlier backfill repair migrations do. Grants and comment are restored
-- below as part of this migration.
DROP FUNCTION IF EXISTS public.backfill_and_recalculate_inventory(UUID);

CREATE FUNCTION public.backfill_and_recalculate_inventory(
  p_business_id UUID DEFAULT NULL
)
RETURNS TABLE (
  out_business_id UUID,
  sales_backfilled INT,
  purchases_backfilled INT,
  balances_updated INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales_count INT := 0;
  v_purchases_count INT := 0;
  v_balances_count INT := 0;
  v_biz_record RECORD;
  v_default_loc_id UUID;
BEGIN
  -- BUG 3 FIX: only the service role may reconcile "every business" (NULL).
  -- Any other caller must name a business it can write to.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_business_id IS NULL THEN
      RAISE EXCEPTION 'business_id is required.'
        USING ERRCODE = '22004'; -- null_value_not_allowed
    END IF;

    IF NOT public.can_write_business_data(p_business_id) THEN
      RAISE EXCEPTION 'You do not have permission to reconcile inventory for this business.'
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
  END IF;

  FOR v_biz_record IN
    SELECT id FROM public.businesses
    WHERE (p_business_id IS NULL OR id = p_business_id)
      AND is_active = true
      AND deleted_at IS NULL
  LOOP
    -- 1. Ensure at least one default warehouse location exists for this business
    SELECT id INTO v_default_loc_id
    FROM public.inventory_locations
    WHERE business_id = v_biz_record.id AND is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;

    IF v_default_loc_id IS NULL THEN
      INSERT INTO public.inventory_locations (
        business_id, name, is_default, is_active, created_at, updated_at
      )
      VALUES (
        v_biz_record.id, 'Main Warehouse', true, true, now(), now()
      )
      RETURNING id INTO v_default_loc_id;
    END IF;

    -- 2. Backfill missing stock movements for past purchases (expenses) FIRST,
    -- so the sales backfill below can price each sale off the purchase
    -- history that predates it.
    WITH missing_purchases AS (
      SELECT
        e.business_id,
        el.product_id,
        COALESCE(
          (SELECT loc.id FROM public.inventory_locations loc WHERE loc.branch_id = e.branch_id AND loc.is_active = true LIMIT 1),
          v_default_loc_id
        ) AS location_id,
        'purchase'::public.stock_movement_type AS movement_type,
        e.expense_date AS movement_date,
        el.quantity AS quantity, -- positive for purchases
        el.unit_price AS unit_cost,
        'expense' AS source_type,
        e.id AS source_id,
        e.expense_number AS reference,
        e.created_by
      FROM public.expenses e
      JOIN public.expense_lines el ON el.expense_id = e.id
      JOIN public.products p ON p.id = el.product_id
      WHERE e.business_id = v_biz_record.id
        AND e.deleted_at IS NULL
        AND p.track_inventory
        AND el.product_id IS NOT NULL
        AND el.quantity > 0
        -- Skip if a stock movement for this expense & product already exists
        AND NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.business_id = e.business_id
            AND sm.source_id::text = e.id::text
            AND sm.source_type = 'expense'
            AND sm.product_id = el.product_id
        )
    ),
    inserted_purchases AS (
      INSERT INTO public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      SELECT
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      FROM missing_purchases
      RETURNING id
    )
    SELECT COUNT(*) INTO v_purchases_count FROM inserted_purchases;

    -- 3. Backfill missing stock movements for past sales (invoices).
    --
    -- BUG 1 FIX: cost each backfilled sale at the weighted-average cost of
    -- that product's inbound movements up to (and including) the sale date
    -- — never at il.unit_price, which is what the customer was charged and
    -- has nothing to do with what the stock cost the business. Falls back
    -- to the product's current purchase_price only when no purchase history
    -- exists for that product at all (e.g. opening stock was never
    -- recorded), and to 0 as a last resort — matching buildCogsPostings'
    -- existing "skip zero-cost lines rather than invent a number" rule.
    WITH missing_sales AS (
      SELECT
        i.business_id,
        il.product_id,
        COALESCE(
          (SELECT loc.id FROM public.inventory_locations loc WHERE loc.branch_id = i.branch_id AND loc.is_active = true LIMIT 1),
          v_default_loc_id
        ) AS location_id,
        'sale'::public.stock_movement_type AS movement_type,
        i.issue_date AS movement_date,
        -il.quantity AS quantity, -- negative for sales
        COALESCE(
          (
            SELECT SUM(sm2.quantity * sm2.unit_cost) / NULLIF(SUM(sm2.quantity), 0)
            FROM public.stock_movements sm2
            WHERE sm2.business_id = i.business_id
              AND sm2.product_id = il.product_id
              AND sm2.quantity > 0
              AND sm2.movement_date <= i.issue_date
          ),
          p.purchase_price,
          0
        ) AS unit_cost,
        'invoice' AS source_type,
        i.id AS source_id,
        i.invoice_number AS reference,
        i.created_by
      FROM public.invoices i
      JOIN public.invoice_lines il ON il.invoice_id = i.id
      JOIN public.products p ON p.id = il.product_id
      WHERE i.business_id = v_biz_record.id
        AND i.deleted_at IS NULL
        AND p.track_inventory
        AND il.product_id IS NOT NULL
        AND il.quantity > 0
        -- Skip if a stock movement for this invoice & product already exists
        AND NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.business_id = i.business_id
            AND sm.source_id::text = i.id::text
            AND sm.source_type = 'invoice'
            AND sm.product_id = il.product_id
        )
    ),
    inserted_sales AS (
      INSERT INTO public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      SELECT
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      FROM missing_sales
      RETURNING id
    )
    SELECT COUNT(*) INTO v_sales_count FROM inserted_sales;

    -- 4. Recalculate inventory_balances from stock_movements.
    --
    -- BUG 2 FIX: weighted-average cost over INBOUND movements only
    -- (Σ inbound qty × inbound cost ÷ Σ inbound qty), matching how
    -- average_cost is defined everywhere else in the app (see
    -- inventoryValuation.ts). The previous AVG(ABS(unit_cost)) blended sale
    -- prices and purchase costs together with no quantity weighting.
    WITH calc_balances AS (
      SELECT
        sm.business_id,
        sm.product_id,
        sm.location_id,
        COALESCE(SUM(sm.quantity), 0) AS calc_quantity_on_hand,
        COALESCE(
          SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity * sm.unit_cost ELSE 0 END)
            / NULLIF(SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END), 0),
          0
        ) AS calc_avg_cost,
        MAX(sm.created_at) AS last_movement
      FROM public.stock_movements sm
      WHERE sm.business_id = v_biz_record.id
      GROUP BY sm.business_id, sm.product_id, sm.location_id
    ),
    upserted_balances AS (
      INSERT INTO public.inventory_balances (
        business_id, product_id, location_id, quantity_on_hand, quantity_reserved,
        average_cost, last_movement_at, updated_at
      )
      SELECT
        cb.business_id, cb.product_id, cb.location_id, cb.calc_quantity_on_hand, 0,
        cb.calc_avg_cost, cb.last_movement, now()
      FROM calc_balances cb
      ON CONFLICT (business_id, product_id, location_id)
      DO UPDATE SET
        quantity_on_hand = EXCLUDED.quantity_on_hand,
        average_cost = CASE WHEN EXCLUDED.average_cost > 0 THEN EXCLUDED.average_cost ELSE inventory_balances.average_cost END,
        last_movement_at = EXCLUDED.last_movement_at,
        updated_at = now()
      RETURNING id
    )
    SELECT COUNT(*) INTO v_balances_count FROM upserted_balances;

    RETURN QUERY SELECT v_biz_record.id, v_sales_count, v_purchases_count, v_balances_count;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.backfill_and_recalculate_inventory(UUID) IS
  'Reconciles stock_movements/inventory_balances against invoices and expenses recorded before (or without) a matching stock movement. Backfills purchases first, then sales — sales are costed at the weighted-average inbound cost as at the sale date, never at the invoice selling price. Requires a specific business_id and can_write_business_data() for any caller other than service_role; only service_role may pass NULL to reconcile every business at once. Called from Warehouse -> Ledger reconciliation -> "Reconcile stock levels".';

REVOKE ALL ON FUNCTION public.backfill_and_recalculate_inventory(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_and_recalculate_inventory(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_and_recalculate_inventory(UUID) TO authenticated;

create or replace function public.dispatch_stock_transfer_atomically(
  p_transfer_id uuid,
  p_dispatched_by text,
  p_lines jsonb
)
returns public.stock_transfers
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line jsonb;
  v_transfer_line public.stock_transfer_lines%rowtype;
  v_line_id uuid;
  v_quantity numeric;
  v_actor text;
  v_line_count integer;
  v_distinct_line_count integer;
  v_positive_count integer := 0;
  v_existing_count integer;
  v_product_group record;
  v_source_id_is_uuid boolean;
  v_created_by_is_uuid boolean;
  v_uuid_columns boolean;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'inventory-transfer-auth-required' using errcode = '42501';
  end if;

  -- Production has UUID source_id/created_by while clean repository replays
  -- retain TEXT columns. Detect the known paired shape so each INSERT uses
  -- values of the target column type without unsafe implicit casts.
  select (
    select a.atttypid = 'uuid'::regtype
      from pg_attribute a
     where a.attrelid = 'public.stock_movements'::regclass
       and a.attname = 'source_id' and a.attnum > 0 and not a.attisdropped
  ), (
    select a.atttypid = 'uuid'::regtype
      from pg_attribute a
     where a.attrelid = 'public.stock_movements'::regclass
       and a.attname = 'created_by' and a.attnum > 0 and not a.attisdropped
  ) into v_source_id_is_uuid, v_created_by_is_uuid;
  if v_source_id_is_uuid is null or v_created_by_is_uuid is null
     or v_source_id_is_uuid <> v_created_by_is_uuid then
    raise exception 'stock-transfer-unsupported-stock-movement-schema' using errcode = '55000';
  end if;
  v_uuid_columns := v_source_id_is_uuid;

  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id
   for update;
  if not found then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not (
    public.can_write_business_data(v_transfer.business_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.from_location_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.to_location_id)
  ) then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if v_transfer.status::text in ('dispatched', 'received') then
    return v_transfer;
  end if;
  if v_transfer.status::text <> 'approved' then
    raise exception 'stock-transfer-not-approved' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'stock-transfer-lines-required' using errcode = '22023';
  end if;

  select count(*), count(distinct nullif(line->>'line_id', '')::uuid)
    into v_line_count, v_distinct_line_count
    from jsonb_array_elements(p_lines) line;
  if v_line_count <> v_distinct_line_count then
    raise exception 'stock-transfer-duplicate-line' using errcode = '22023';
  end if;
  if v_line_count <> (
    select count(*) from public.stock_transfer_lines where transfer_id = p_transfer_id
  ) then
    raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
  end if;

  select count(*) into v_existing_count
    from public.stock_movements
   where business_id = v_transfer.business_id
     and source_type = 'stock_transfer'
     and source_id::text = p_transfer_id::text;
  if v_existing_count > 0 then
    -- Preserve existing history. A partially recorded legacy transfer needs
    -- deliberate reconciliation rather than being silently rewritten.
    raise exception 'stock-transfer-movements-already-exist' using errcode = '22023';
  end if;

  v_actor := coalesce(nullif(btrim(p_dispatched_by), ''), auth.uid()::text);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_quantity := nullif(v_line->>'quantity_dispatched', '')::numeric;
    if v_line_id is null or v_quantity is null or v_quantity < 0 then
      raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
    end if;

    select * into v_transfer_line
      from public.stock_transfer_lines
     where id = v_line_id and transfer_id = p_transfer_id
     for update;
    if not found then
      raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
    end if;
    if v_quantity > v_transfer_line.quantity_requested then
      raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
    end if;

    update public.stock_transfer_lines
       set quantity_dispatched = v_quantity
     where id = v_line_id;
    if v_quantity > 0 then
      v_positive_count := v_positive_count + 1;
    end if;
  end loop;

  if v_positive_count = 0 then
    raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
  end if;

  -- Collapse repeated product rows within the transfer into one movement per
  -- product and location. Weighted unit cost preserves the value of all lines.
  for v_product_group in
    select product_id,
           sum(quantity_dispatched) as quantity,
           sum(quantity_dispatched * unit_cost) / nullif(sum(quantity_dispatched), 0) as unit_cost
      from public.stock_transfer_lines
     where transfer_id = p_transfer_id and coalesce(quantity_dispatched, 0) > 0
     group by product_id
  loop
    if v_uuid_columns then
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by,
        transfer_id
      ) values (
        v_transfer.business_id, v_product_group.product_id, v_transfer.from_location_id,
        'transfer_out', current_date, -v_product_group.quantity, v_product_group.unit_cost,
        'stock_transfer', p_transfer_id, v_transfer.transfer_number, nullif(v_actor, '')::uuid,
        p_transfer_id
      );
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by,
        transfer_id
      ) values (
        v_transfer.business_id, v_product_group.product_id, v_transfer.to_location_id,
        'transfer_in', current_date, v_product_group.quantity, v_product_group.unit_cost,
        'stock_transfer', p_transfer_id, v_transfer.transfer_number, nullif(v_actor, '')::uuid,
        p_transfer_id
      );
    else
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by,
        transfer_id
      ) values (
        v_transfer.business_id, v_product_group.product_id, v_transfer.from_location_id,
        'transfer_out', current_date, -v_product_group.quantity, v_product_group.unit_cost,
        'stock_transfer', p_transfer_id::text, v_transfer.transfer_number, v_actor,
        p_transfer_id
      );
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by,
        transfer_id
      ) values (
        v_transfer.business_id, v_product_group.product_id, v_transfer.to_location_id,
        'transfer_in', current_date, v_product_group.quantity, v_product_group.unit_cost,
        'stock_transfer', p_transfer_id::text, v_transfer.transfer_number, v_actor,
        p_transfer_id
      );
    end if;
  end loop;

  update public.stock_transfers
     set status = 'dispatched',
         dispatched_at = now(),
         updated_at = now()
   where id = p_transfer_id
   returning * into v_transfer;
  return v_transfer;
end;
$$;

revoke all on function public.dispatch_stock_transfer_atomically(uuid, text, jsonb) from public, anon;
grant execute on function public.dispatch_stock_transfer_atomically(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.confirm_stock_transfer_receipt_atomically(
  p_transfer_id uuid,
  p_received_by text,
  p_lines jsonb
)
returns public.stock_transfers
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line jsonb;
  v_transfer_line public.stock_transfer_lines%rowtype;
  v_line_id uuid;
  v_quantity numeric;
  v_actor text;
  v_line_count integer;
  v_distinct_line_count integer;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'inventory-transfer-auth-required' using errcode = '42501';
  end if;
  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id
   for update;
  if not found then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not (
    public.can_write_business_data(v_transfer.business_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.from_location_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.to_location_id)
  ) then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if v_transfer.status::text = 'received' then
    return v_transfer;
  end if;
  if v_transfer.status::text <> 'dispatched' then
    raise exception 'stock-transfer-not-dispatched' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'stock-transfer-lines-required' using errcode = '22023';
  end if;

  select count(*), count(distinct nullif(line->>'line_id', '')::uuid)
    into v_line_count, v_distinct_line_count
    from jsonb_array_elements(p_lines) line;
  if v_line_count <> v_distinct_line_count or v_line_count <> (
    select count(*) from public.stock_transfer_lines where transfer_id = p_transfer_id
  ) then
    raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
  end if;

  v_actor := coalesce(nullif(btrim(p_received_by), ''), auth.uid()::text);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_quantity := nullif(v_line->>'quantity_received', '')::numeric;
    if v_line_id is null or v_quantity is null or v_quantity < 0 then
      raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
    end if;
    select * into v_transfer_line
      from public.stock_transfer_lines
     where id = v_line_id and transfer_id = p_transfer_id
     for update;
    if not found then
      raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
    end if;
    if v_quantity <> coalesce(v_transfer_line.quantity_dispatched, 0) then
      raise exception 'inventory-transfer-quantity-mismatch' using errcode = '22023';
    end if;
    update public.stock_transfer_lines
       set quantity_received = v_quantity
     where id = v_line_id;
  end loop;

  update public.stock_transfers
     set status = 'received',
         received_at = now(),
         received_by = nullif(v_actor, '')::uuid,
         updated_at = now()
   where id = p_transfer_id
   returning * into v_transfer;
  return v_transfer;
end;
$$;

revoke all on function public.confirm_stock_transfer_receipt_atomically(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_stock_transfer_receipt_atomically(uuid, text, jsonb) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.reverse_pay_run(p_pay_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.pay_runs%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_original_je public.journal_entries%ROWTYPE;
  v_reversal_je_id uuid;
  v_reversal_number text;
  v_line record;
  v_line_no integer := 0;
  v_total_debits numeric := 0;
  v_total_credits numeric := 0;
BEGIN
  SELECT * INTO v_run
  FROM public.pay_runs
  WHERE id = p_pay_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay run % was not found.', p_pay_run_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_write_business_data(v_run.business_id) THEN
    RAISE EXCEPTION 'You do not have permission to reverse payroll for this business.' USING ERRCODE = '42501';
  END IF;
  IF v_run.status::text = 'reversed' OR v_run.reversal_journal_entry_id IS NOT NULL THEN
    RAISE EXCEPTION 'This pay run has already been reversed.' USING ERRCODE = '55000';
  END IF;
  IF v_run.status::text <> 'posted' THEN
    RAISE EXCEPTION 'Only posted pay runs can be reversed.' USING ERRCODE = '55000';
  END IF;
  IF v_run.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Pay run has no linked journal entry to reverse.' USING ERRCODE = '23502';
  END IF;

  SELECT * INTO v_original_je
  FROM public.journal_entries
  WHERE id = v_run.journal_entry_id
    AND business_id = v_run.business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original journal entry % not found.', v_run.journal_entry_id USING ERRCODE = 'P0002';
  END IF;
  IF v_original_je.status::text = 'reversed' OR v_original_je.reversed_by IS NOT NULL THEN
    RAISE EXCEPTION 'The linked payroll journal entry has already been reversed.' USING ERRCODE = '55000';
  END IF;
  IF v_original_je.status::text <> 'posted' OR v_original_je.reversal_of IS NOT NULL THEN
    RAISE EXCEPTION 'The linked payroll journal entry is not available for reversal.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_business FROM public.businesses WHERE id = v_run.business_id;
  v_reversal_number := public.next_journal_entry_number(v_run.business_id);
  INSERT INTO public.journal_entries (
    business_id, branch_id, department_id, entry_number, entry_date, description,
    reference, source_type, source_id, currency, exchange_rate, status, created_by, reversal_of
  ) VALUES (
    v_run.business_id, v_original_je.branch_id, v_original_je.department_id,
    v_reversal_number, CURRENT_DATE,
    'REVERSAL: ' || v_original_je.description,
    v_original_je.entry_number, 'payroll', p_pay_run_id::text,
    v_business.base_currency, 1, 'draft', auth.uid(), v_original_je.id
  ) RETURNING id INTO v_reversal_je_id;

  -- Reverse each journal line by swapping its debit/credit side while
  -- preserving its original and functional-currency amounts and dimensions.
  FOR v_line IN
    SELECT *
    FROM public.journal_lines
    WHERE journal_entry_id = v_original_je.id
      AND business_id = v_run.business_id
    ORDER BY line_number
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      business_id, journal_entry_id, line_number, account_id, branch_id, department_id,
      description, is_debit, amount, amount_base, original_amount, original_currency,
      currency, exchange_rate, rate_date, tax_code, tax_amount, reconciled,
      reconciled_at, rate_is_stale
    ) VALUES (
      v_run.business_id, v_reversal_je_id, v_line_no, v_line.account_id,
      v_line.branch_id, v_line.department_id, 'REVERSAL: ' || COALESCE(v_line.description, ''),
      NOT v_line.is_debit, v_line.amount, v_line.amount_base,
      v_line.original_amount, v_line.original_currency, v_line.currency,
      v_line.exchange_rate, v_line.rate_date, v_line.tax_code, v_line.tax_amount,
      false, NULL, v_line.rate_is_stale
    );
    IF NOT v_line.is_debit THEN
      v_total_debits := v_total_debits + v_line.amount_base;
    ELSE
      v_total_credits := v_total_credits + v_line.amount_base;
    END IF;
  END LOOP;

  IF v_line_no = 0 OR ABS(v_total_debits - v_total_credits) > 0.005 THEN
    RAISE EXCEPTION 'Reversal journal does not balance.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.journal_entries
  SET status = 'posted', posted_at = now(), posted_by = auth.uid()
  WHERE id = v_reversal_je_id AND status = 'draft';

  UPDATE public.journal_entries
  SET status = 'reversed', reversed_by = v_reversal_je_id
  WHERE id = v_original_je.id AND business_id = v_run.business_id
    AND status = 'posted' AND reversed_by IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The linked payroll journal entry has already been reversed.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.pay_runs
  SET status = 'reversed', reversal_journal_entry_id = v_reversal_je_id, updated_at = now()
  WHERE id = v_run.id AND business_id = v_run.business_id;

  RETURN jsonb_build_object(
    'payRunId', v_run.id,
    'reversalJournalEntryId', v_reversal_je_id,
    'status', 'reversed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_pay_run(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reverse_pay_run(uuid) TO authenticated, service_role;

create or replace function public.void_cash_deposit(p_deposit_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.cash_deposits%rowtype;
  v_original public.journal_entries%rowtype;
  v_actor uuid;
  v_reversal_id uuid;
  v_business_id uuid;
begin
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'Authentication is required to void a cash deposit.' using errcode = '42501';
  end if;
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required to void a posted cash deposit.' using errcode = '22023';
  end if;

  select d.* into v_deposit
  from public.cash_deposits d
  where d.id = p_deposit_id
  for update;
  if not found then raise exception 'Cash deposit not found.' using errcode = 'P0002'; end if;
  v_business_id := v_deposit.business_id;
  if not public.is_business_member(v_business_id) then
    raise exception 'Not authorised for this business.' using errcode = '42501';
  end if;
  if v_deposit.status = 'voided' then
    raise exception 'This cash deposit has already been voided.' using errcode = '55000';
  end if;
  if v_deposit.status <> 'posted' or v_deposit.journal_entry_id is null then
    raise exception 'Only posted cash deposits can be voided.' using errcode = '22023';
  end if;

  select je.* into v_original
  from public.journal_entries je
  where je.id = v_deposit.journal_entry_id and je.business_id = v_business_id
  for update;
  if not found or v_original.status::text = 'reversed' or v_original.reversed_by is not null
     or v_original.reversal_of is not null then
    raise exception 'The cash deposit journal entry is not available for reversal.' using errcode = '22023';
  end if;

  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id,
    currency, exchange_rate, status, created_by, posted_by, posted_at, reversal_of
  ) values (
    v_business_id, public.next_journal_entry_number(v_business_id), current_date,
    'Reversal of ' || v_original.entry_number || ': ' || v_original.description,
    'reversal', v_original.source_id, v_original.currency, v_original.exchange_rate,
    'posted', v_actor, v_actor, now(), v_original.id
  ) returning id into v_reversal_id;

  insert into public.journal_lines (
    business_id, journal_entry_id, line_number, account_id, description,
    is_debit, amount, amount_base, currency, exchange_rate, rate_is_stale,
    reconciled, tax_amount
  )
  select jl.business_id, v_reversal_id, jl.line_number, jl.account_id,
    'Reversal of: ' || coalesce(jl.description, v_original.description),
    not jl.is_debit, jl.amount, jl.amount_base, jl.currency, jl.exchange_rate,
    jl.rate_is_stale, false, jl.tax_amount
  from public.journal_lines jl
  where jl.journal_entry_id = v_original.id and jl.business_id = v_business_id
  order by jl.line_number;

  if not exists (select 1 from public.journal_lines where journal_entry_id = v_reversal_id) then
    raise exception 'The cash deposit journal entry has no lines to reverse.' using errcode = '22023';
  end if;
  update public.journal_entries set status = 'reversed', reversed_by = v_reversal_id
  where id = v_original.id and business_id = v_business_id;
  update public.cash_deposits
  set status = 'voided', voided_at = now(), void_reason = trim(p_reason), updated_at = now()
  where id = p_deposit_id and business_id = v_business_id;
  return v_reversal_id;
end;
$$;

revoke all on function public.void_cash_deposit(uuid, text) from public, anon;
grant execute on function public.void_cash_deposit(uuid, text) to authenticated, service_role;

-- Bind transfer-line authorization to its actual UUID parent and same business.
-- The explicit outer aliases prevent name-resolution ambiguity in policy subqueries.
drop policy if exists stock_transfer_lines_member_read on public.stock_transfer_lines;
create policy stock_transfer_lines_member_read on public.stock_transfer_lines
for select using (
  public.is_business_member(stock_transfer_lines.business_id)
  and exists (
    select 1
    from public.stock_transfers t
    where t.id = stock_transfer_lines.transfer_id
      and t.business_id = stock_transfer_lines.business_id
      and public.can_access_location(t.business_id, t.from_location_id)
      and public.can_access_location(t.business_id, t.to_location_id)
  )
);

drop policy if exists stock_transfer_lines_writer_insert on public.stock_transfer_lines;
create policy stock_transfer_lines_writer_insert on public.stock_transfer_lines
for insert with check (
  public.can_write_business_data(stock_transfer_lines.business_id)
  and exists (
    select 1
    from public.stock_transfers t
    where t.id = stock_transfer_lines.transfer_id
      and t.business_id = stock_transfer_lines.business_id
      and public.can_access_location(t.business_id, t.from_location_id)
      and public.can_access_location(t.business_id, t.to_location_id)
  )
);

drop policy if exists stock_transfer_lines_writer_update on public.stock_transfer_lines;
create policy stock_transfer_lines_writer_update on public.stock_transfer_lines
for update using (
  public.can_write_business_data(stock_transfer_lines.business_id)
  and exists (
    select 1
    from public.stock_transfers t
    where t.id = stock_transfer_lines.transfer_id
      and t.business_id = stock_transfer_lines.business_id
      and public.can_access_location(t.business_id, t.from_location_id)
      and public.can_access_location(t.business_id, t.to_location_id)
  )
) with check (
  public.can_write_business_data(stock_transfer_lines.business_id)
  and exists (
    select 1
    from public.stock_transfers t
    where t.id = stock_transfer_lines.transfer_id
      and t.business_id = stock_transfer_lines.business_id
      and public.can_access_location(t.business_id, t.from_location_id)
      and public.can_access_location(t.business_id, t.to_location_id)
  )
);
