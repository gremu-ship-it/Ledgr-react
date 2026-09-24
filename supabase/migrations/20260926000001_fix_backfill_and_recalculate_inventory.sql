-- ============================================================================
-- 20260926000001_fix_backfill_and_recalculate_inventory.sql
--
-- Fix the Warehouse "Reconcile stock levels against sales & purchases" tool.
--
-- Incident (2026-09-24)
-- ─────────────────────
-- Clicking "Reconcile stock levels" failed for a live business with:
--
--   Validation failed for stock_movements: Failing row contains
--   (9a28d7c0-…, d38e4ce8-…, b92dae4d-…, c5030b89-…,
--    -3.0000, 0.0000, -3.0000, 0.0000,
--    2026-07-29 12:06:09.322721+00, 2026-09-24 07:08:59.341148+00)
--
-- The failing row is an inventory_balances row (on_hand -3, reserved 0,
-- available -3). It was proposed by step 4 of
-- backfill_and_recalculate_inventory() (20260730000005), which REWRITES every
-- balance as sum(stock_movements.quantity):
--
--   ERROR: new row for relation "inventory_balances" violates check
--   constraint "chk_inventory_balances_on_hand_nonneg" (SQLSTATE 23514)
--
-- The whole RPC aborted and rolled back, so the tool inserted nothing and can
-- never succeed for this business while step 4 exists.
--
-- Why the rewrite is wrong (and was already known to be wrong)
-- ─────────────────────────────────────────────────────────────
-- docs/database/database-operations.md §9.6 and migration
-- 20260925000001_stock_movement_balance_delta_trigger.sql established, after
-- the -1829 deploy failure of 20260924000001, that stock_movements is NOT a
-- complete account of on-hand stock: opening stock and older history were
-- never written as movements, so sum(ledger) can net negative for a live
-- product. "balance := sum(ledger)" is therefore not a safe invariant, and
-- balances are maintained exclusively as DELTAS by the canonical trigger
-- trg_stock_movements_apply_inventory_balance. This RPC was the last writer
-- still violating that rule — the button in the UI just handed customers a
-- way to trigger it.
--
-- What this migration changes
-- ────────────────────────────
-- backfill_and_recalculate_inventory() is replaced with a version that never
-- writes inventory_balances directly:
--
--  1. Missing purchase movements are inserted (as before, purchases first).
--  2. NEW — implied opening stock: for each (product, location) whose missing
--     sale quantity exceeds what is on hand after step 1, the difference is
--     inserted as an explicit `opening_balance` movement BEFORE the sales.
--     Those units were physically bought and sold before tracking existed;
--     recording them keeps the movement ledger complete against the invoices
--     while guaranteeing no balance can go negative. They are costed with the
--     same weighted-average-inbound lookup the sales use, so they are
--     valuation-neutral.
--  3. Missing sale movements are inserted (same costing as 20260730000005:
--     weighted-average inbound cost as at the sale date, falling back to the
--     product's purchase_price, then 0 — never the selling price).
--  4. Every inserted row flows through the canonical delta trigger, which
--     updates inventory_balances (and the moving average cost) exactly once
--     per movement. The old step-4 rewrite is gone entirely.
--
-- Guarantees under the non-negative check
-- ────────────────────────────────────────
-- For every key: final balance = on_hand + purchases + shortfall − sales ≥ 0,
-- and during the sale inserts the balance only decreases toward that final
-- value, so no intermediate state can violate
-- chk_inventory_balances_on_hand_nonneg either.
--
-- Also:
--  * One pg_advisory_xact_lock per business serialises concurrent runs (two
--    clicks of the button could otherwise both see the same missing lines and
--    insert them twice).
--  * Return shape gains `adjustments_inserted`; the function is therefore
--    dropped and re-created (CREATE OR REPLACE cannot change output columns).
--    Callers read columns by name — the app's cast is updated in the same
--    commit; an older client simply ignores the extra column.
--  * Authorization is unchanged from 20260730000005: non-service callers must
--    name a business they can write; only service_role may pass NULL for the
--    all-businesses form.
--  * source_id comparisons cast both sides to text. The live database carries
--    stock_movements.source_id as UUID while the repository schema (fresh
--    replays, staging) has TEXT — the same drift 20260911000002 fixed for the
--    quick-save RPCs. uuid::text = uuid::text works on both shapes, and the
--    uuid expressions written INTO source_id assign cleanly to either column
--    type. The old body compared text = uuid, which only planned on the live
--    shape and failed outright on repository-built databases.
-- ============================================================================

drop function if exists public.backfill_and_recalculate_inventory(uuid);

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
  'Reconciles stock_movements against invoices and expenses: backfills purchases first, then records any implied opening stock, then backfills sales costed at weighted-average inbound cost as at the sale date. Never writes inventory_balances — every inserted movement flows through the canonical delta trigger (20260925000001), so balances can never go negative or be rewritten from an incomplete ledger. Requires a specific business_id and can_write_business_data() for any caller other than service_role; only service_role may pass NULL to reconcile every business at once. Called from Warehouse -> "Reconcile stock levels".';

revoke all on function public.backfill_and_recalculate_inventory(uuid) from public;
grant execute on function public.backfill_and_recalculate_inventory(uuid) to service_role;
grant execute on function public.backfill_and_recalculate_inventory(uuid) to authenticated;
