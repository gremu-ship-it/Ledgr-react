-- ============================================================================
-- 20261016000000_inventory_backfill_status_safety.sql
-- DATA-INTEGRITY HARDENING — do not consume non-posted documents as stock
-- ============================================================================
-- The prior backfill function (20260926000001) selected every non-deleted
-- invoice/expense. That allowed draft, void and credit-note documents to
-- create stock movements and opening-balance stock. This forward migration
-- preserves the reconciliation algorithm but limits source documents to
-- accounting-relevant states:
--   invoices: posted invoice/debit_note and status not draft/void/credit_note
--   expenses: status not draft/void
--
-- No existing rows are changed by this migration. Historical effects must be
-- identified from a snapshot and corrected through approved accounting entries.
-- ============================================================================

create function public.backfill_and_recalculate_inventory(
  p_business_id uuid default null
)
returns table (
  out_business_id uuid,
  sales_backfilled int,
  purchases_backfilled int,
  adjustments_inserted int,
  balances_updated int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_biz_record record;
  v_default_loc_id uuid;
  v_sales_count int := 0;
  v_purchases_count int := 0;
  v_adjustments_count int := 0;
  v_balances_count int := 0;
  v_keys text[] := array[]::text[];
  v_new_keys text[];
begin
  -- Authorization (unchanged from 20260730000005): only the service role may
  -- reconcile "every business" (NULL); anyone else must name a business they
  -- can write to.
  if auth.role() is distinct from 'service_role' then
    if p_business_id is null then
      raise exception 'business_id is required.'
        using errcode = '22004'; -- null_value_not_allowed
    end if;

    if not public.can_write_business_data(p_business_id) then
      raise exception 'You do not have permission to reconcile inventory for this business.'
        using errcode = '42501'; -- insufficient_privilege
    end if;
  end if;

  for v_biz_record in
    select id from public.businesses
    where (p_business_id is null or id = p_business_id)
      and is_active = true
      and deleted_at is null
  loop
    -- Serialise concurrent runs for this business. Held to transaction end;
    -- acquired in businesses.id order in the NULL form, so two all-business
    -- runs cannot deadlock.
    perform pg_advisory_xact_lock(hashtextextended(v_biz_record.id::text, 0));

    v_sales_count := 0;
    v_purchases_count := 0;
    v_adjustments_count := 0;
    v_balances_count := 0;
    v_keys := array[]::text[];

    -- 1. Ensure at least one warehouse location exists for this business.
    select id into v_default_loc_id
    from public.inventory_locations
    where business_id = v_biz_record.id and is_active = true
    order by is_default desc, created_at asc
    limit 1;

    if v_default_loc_id is null then
      insert into public.inventory_locations (
        business_id, name, is_default, is_active, created_at, updated_at
      )
      values (
        v_biz_record.id, 'Main Warehouse', true, true, now(), now()
      )
      returning id into v_default_loc_id;
    end if;

    -- 2. Backfill missing stock movements for past purchases (expenses)
    --    FIRST, so the sales below can price themselves off the purchase
    --    history that predates them, and so the balances the shortfall step
    --    reads already include the purchased units. The canonical
    --    stock_movements trigger applies each row to inventory_balances as a
    --    delta — this function never writes balances itself.
    with missing_purchases as (
      select
        e.business_id,
        el.product_id,
        coalesce(
          (select loc.id from public.inventory_locations loc where loc.branch_id = e.branch_id and loc.is_active = true limit 1),
          v_default_loc_id
        ) as location_id,
        'purchase'::public.stock_movement_type as movement_type,
        e.expense_date as movement_date,
        el.quantity as quantity, -- positive for purchases
        el.unit_price as unit_cost,
        'expense' as source_type,
        e.id as source_id,
        e.expense_number as reference,
        e.created_by
      from public.expenses e
      join public.expense_lines el on el.expense_id = e.id
      join public.products p on p.id = el.product_id
      where e.business_id = v_biz_record.id
        and e.deleted_at is null
        and e.status not in ('draft', 'void')
        and p.track_inventory
        and el.product_id is not null
        and el.quantity > 0
        -- Skip if a stock movement for this expense & product already exists
        and not exists (
          select 1 from public.stock_movements sm
          where sm.business_id = e.business_id
            and sm.source_id::text = e.id::text
            and sm.source_type = 'expense'
            and sm.product_id = el.product_id
        )
    ),
    inserted as (
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      select
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      from missing_purchases
      returning product_id, location_id
    )
    select count(*),
           coalesce(array_agg(distinct product_id::text || ':' || location_id::text), array[]::text[])
      into v_purchases_count, v_new_keys
      from inserted;

    v_keys := v_keys || v_new_keys;

    -- 3. Implied opening stock. A missing sale can only be applied as a
    --    negative delta if the balance can absorb it; where the sales predate
    --    any recorded receipt, the units must have existed without ever being
    --    written down. Record exactly that gap as an opening_balance movement
    --    (never a direct balance write) so the ledger stays complete against
    --    the invoices AND chk_inventory_balances_on_hand_nonneg can never
    --    trip. on_hand read here already includes the purchases inserted in
    --    step 2, because the balance trigger fired for each of them.
    with missing_sales as (
      select
        i.business_id,
        il.product_id,
        coalesce(
          (select loc.id from public.inventory_locations loc where loc.branch_id = i.branch_id and loc.is_active = true limit 1),
          v_default_loc_id
        ) as location_id,
        il.quantity as units,
        i.issue_date
      from public.invoices i
      join public.invoice_lines il on il.invoice_id = i.id
      join public.products p on p.id = il.product_id
      where i.business_id = v_biz_record.id
        and i.deleted_at is null
        and i.status not in ('draft', 'void', 'credit_note')
        and i.invoice_type in ('invoice', 'debit_note')
        and p.track_inventory
        and il.product_id is not null
        and il.quantity > 0
        and not exists (
          select 1 from public.stock_movements sm
          where sm.business_id = i.business_id
            and sm.source_id::text = i.id::text
            and sm.source_type = 'invoice'
            and sm.product_id = il.product_id
        )
    ),
    demand as (
      select business_id, product_id, location_id,
             sum(units) as missing_units,
             min(issue_date) as earliest_date
      from missing_sales
      group by business_id, product_id, location_id
    ),
    shortfall as (
      select d.*,
             greatest(d.missing_units - coalesce(ib.quantity_on_hand, 0), 0) as shortfall_units
      from demand d
      left join public.inventory_balances ib
        on ib.business_id = d.business_id
       and ib.product_id = d.product_id
       and ib.location_id = d.location_id
    ),
    to_insert as (
      select
        s.business_id,
        s.product_id,
        s.location_id,
        s.shortfall_units as quantity,
        s.earliest_date as movement_date,
        -- Same costing ladder the sales below use, evaluated at the earliest
        -- missing sale: weighted-average inbound cost up to that date,
        -- falling back to the product's purchase_price, then 0. The sale
        -- backfill consumes these units at the same cost, so the pair is
        -- valuation-neutral.
        coalesce(
          (
            select sum(sm2.quantity * sm2.unit_cost) / nullif(sum(sm2.quantity), 0)
            from public.stock_movements sm2
            where sm2.business_id = s.business_id
              and sm2.product_id = s.product_id
              and sm2.location_id = s.location_id
              and sm2.quantity > 0
              and sm2.movement_date <= s.earliest_date
          ),
          (select p2.purchase_price from public.products p2 where p2.id = s.product_id),
          0
        ) as unit_cost
      from shortfall s
      where s.shortfall_units > 0
    ),
    inserted as (
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, reference, notes, created_at
      )
      select
        business_id, product_id, location_id,
        'opening_balance'::public.stock_movement_type,
        movement_date, quantity, unit_cost,
        'inventory_backfill',
        'STOCK-RECONCILE',
        'Stock sold before inventory tracking existed, recorded by "Reconcile stock levels" so the sale movements balance.',
        now()
      from to_insert
      returning product_id, location_id
    )
    select count(*),
           coalesce(array_agg(distinct product_id::text || ':' || location_id::text), array[]::text[])
      into v_adjustments_count, v_new_keys
      from inserted;

    v_keys := v_keys || v_new_keys;

    -- 4. Backfill missing stock movements for past sales (invoices). Costed
    --    at the weighted-average inbound cost as at the sale date (never the
    --    selling price — bug-1 fix from 20260730000005). By now every key's
    --    balance can absorb its sales: on_hand + purchases + shortfall ≥ sales.
    with missing_sales as (
      select
        i.business_id,
        il.product_id,
        coalesce(
          (select loc.id from public.inventory_locations loc where loc.branch_id = i.branch_id and loc.is_active = true limit 1),
          v_default_loc_id
        ) as location_id,
        'sale'::public.stock_movement_type as movement_type,
        i.issue_date as movement_date,
        -il.quantity as quantity, -- negative for sales
        coalesce(
          (
            select sum(sm2.quantity * sm2.unit_cost) / nullif(sum(sm2.quantity), 0)
            from public.stock_movements sm2
            where sm2.business_id = i.business_id
              and sm2.product_id = il.product_id
              and sm2.quantity > 0
              and sm2.movement_date <= i.issue_date
          ),
          p.purchase_price,
          0
        ) as unit_cost,
        'invoice' as source_type,
        i.id as source_id,
        i.invoice_number as reference,
        i.created_by
      from public.invoices i
      join public.invoice_lines il on il.invoice_id = i.id
      join public.products p on p.id = il.product_id
      where i.business_id = v_biz_record.id
        and i.deleted_at is null
        and i.status not in ('draft', 'void', 'credit_note')
        and i.invoice_type in ('invoice', 'debit_note')
        and p.track_inventory
        and il.product_id is not null
        and il.quantity > 0
        -- Skip if a stock movement for this invoice & product already exists
        and not exists (
          select 1 from public.stock_movements sm
          where sm.business_id = i.business_id
            and sm.source_id::text = i.id::text
            and sm.source_type = 'invoice'
            and sm.product_id = il.product_id
        )
    ),
    inserted as (
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      select
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      from missing_sales
      returning product_id, location_id
    )
    select count(*),
           coalesce(array_agg(distinct product_id::text || ':' || location_id::text), array[]::text[])
      into v_sales_count, v_new_keys
      from inserted;

    v_keys := v_keys || v_new_keys;

    -- 5. Balances updated = distinct (product, location) keys whose balance
    --    the canonical trigger touched while applying this run's movements.
    select count(distinct k) into v_balances_count
    from unnest(v_keys) as k;

    return query select
      v_biz_record.id,
      v_sales_count,
      v_purchases_count,
      v_adjustments_count,
      v_balances_count;
  end loop;
end;
$$;


comment on function public.backfill_and_recalculate_inventory(uuid) is
  'Reconciles stock movements against posted invoices/debit notes and non-draft/non-void expenses only. Draft, void and credit-note documents never consume stock or create opening-balance movements. Never writes inventory_balances directly; movement inserts flow through the canonical delta trigger.';

revoke all on function public.backfill_and_recalculate_inventory(uuid) from public;
grant execute on function public.backfill_and_recalculate_inventory(uuid) to service_role;
grant execute on function public.backfill_and_recalculate_inventory(uuid) to authenticated;
