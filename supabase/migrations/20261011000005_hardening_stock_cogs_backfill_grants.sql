-- ============================================================================
-- 20261011000005_hardening_stock_cogs_backfill_grants.sql
--
-- HARDENING package (owner instruction 2026-09-26 "proceed and fix the app"),
-- following Incident Containment 2026-09-25. Forward-only. NO data is read
-- back into or written to any existing row by this migration; it only
-- (re)defines functions, adds one index and declares two grants.
--
-- 1. record_sale_stock_and_cogs(invoice_id, lines)  — NEW
--    Non-POS sale paths (Income page, mobile quick income, offline sync
--    engine, POS legacy fallback) released stock and posted COGS from the
--    CLIENT in separate round trips, and postCogsForSale() swallowed any
--    COGS failure (returned null): stock left the shelf with no cost of
--    sales — the same defect P5 fixed for post_pos_sale. This command does
--    both in ONE transaction: authorise (sales writer + branch access),
--    lock the invoice, refuse draft/void/credit-note, idempotent (an invoice
--    that already moved stock is not moved again), movements at the same
--    location contract sales use (_ledgr_stock_location), weighted-average
--    cost read BEFORE the movement, COGS via _ledgr_post_cogs with posting
--    key invoice:<id>:cogs. Any failure raises; nothing partial persists.
--    Legacy invoices that already have movements but no COGS entry are
--    REPORTED (cogs_missing=true) and NOT repaired (repair not authorised).
--
-- 2. backfill_and_recalculate_inventory — logic fixed, STILL NOT EXECUTABLE
--    by anon/authenticated (20261011000000 grants restated below).
--    * invoices: only status not in (draft, void, credit_note) and
--      invoice_type <> credit_note (REPRODUCED defect: all were deducted);
--    * expenses: status not in (draft, void, rejected, cancelled);
--    * location: _ledgr_stock_location(business, branch) — the same contract
--      live sales and receipts use (was an unordered LIMIT 1).
--    Running it remains an owner-authorised repair decision.
--
-- 3. Index stock_movements(business_id, source_type, source_id) — every
--    "has this document moved stock?" check (post_pos_sale, the new command,
--    backfill, POS replay guard) was a sequential scan per business.
--
-- 4. Declare INSERT on invoices / invoice_lines to authenticated. Production
--    already has these through Supabase platform default privileges (the
--    client has always inserted invoices directly; create_invoice_with_lines
--    is SECURITY INVOKER). Declaring them makes the migration chain the
--    source of truth. Row-level security (invoices_writer_insert etc.) is
--    unchanged and remains the authority.
-- ============================================================================

-- ── 1. Atomic stock + COGS for an existing sale ────────────────────────────
create or replace function public.record_sale_stock_and_cogs(
  p_invoice_id uuid,
  p_lines jsonb          -- [{product_id, quantity}]
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
  v_location uuid;
  v_line record;
  v_product public.products%rowtype;
  v_unit_cost numeric;
  v_cost_lines jsonb := '[]'::jsonb;
  v_cogs_entry uuid;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_invoice_id is null then
    raise exception 'Invoice id is required.' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'Malformed stock lines payload.' using errcode = '22023';
  end if;

  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found or you lack permission to release its stock.' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not (
       public.can_write_sales_data(v_inv.business_id)
       and public.can_access_branch(v_inv.business_id, v_inv.branch_id)) then
    raise exception 'Invoice not found or you lack permission to release its stock.' using errcode = '42501';
  end if;
  if v_inv.status::text in ('draft', 'void', 'credit_note') or coalesce(v_inv.invoice_type, '') = 'credit_note' then
    raise exception 'Stock is not released for a % invoice.', v_inv.status using errcode = '23514';
  end if;

  -- Idempotency: the invoice row lock serialises concurrent attempts.
  if exists (select 1 from public.stock_movements
              where business_id = v_inv.business_id and source_type = 'invoice'
                and source_id::text = v_inv.id::text) then
    select id into v_cogs_entry from public.journal_entries
     where business_id = v_inv.business_id and posting_key = 'invoice:' || v_inv.id::text || ':cogs';
    return jsonb_build_object('idempotent', true, 'cogs_entry_id', v_cogs_entry,
      'cogs_missing', v_cogs_entry is null, 'cost_lines', '[]'::jsonb);
  end if;

  v_location := public._ledgr_stock_location(v_inv.business_id, v_inv.branch_id);
  if v_location is null then
    return jsonb_build_object('idempotent', false, 'no_location', true, 'cogs_entry_id', null, 'cost_lines', '[]'::jsonb);
  end if;

  for v_line in
    select (l->>'product_id')::uuid as product_id, sum((l->>'quantity')::numeric) as quantity
      from jsonb_array_elements(p_lines) l
     where nullif(l->>'product_id', '') is not null
     group by 1
  loop
    if coalesce(v_line.quantity, 0) <= 0 then continue; end if;
    select * into v_product from public.products
     where id = v_line.product_id and business_id = v_inv.business_id;
    if not found then
      raise exception 'Product % does not belong to this business.', v_line.product_id using errcode = '42501';
    end if;
    if not coalesce(v_product.track_inventory, false) then continue; end if;

    -- Average cost BEFORE the movement (the balance trigger re-averages on insert).
    select coalesce(average_cost, 0) into v_unit_cost from public.inventory_balances
     where business_id = v_inv.business_id and product_id = v_product.id and location_id = v_location;
    v_unit_cost := coalesce(v_unit_cost, 0);

    insert into public.stock_movements (
      business_id, product_id, location_id, movement_type, movement_date,
      quantity, unit_cost, source_type, source_id, reference, created_by
    ) values (
      v_inv.business_id, v_product.id, v_location, 'sale',
      coalesce(v_inv.issue_date, current_date), -v_line.quantity, v_unit_cost,
      'invoice', v_inv.id::text, v_inv.invoice_number, v_inv.created_by
    );
    v_cost_lines := v_cost_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id, 'quantity', v_line.quantity, 'unit_cost', v_unit_cost));
  end loop;

  if jsonb_array_length(v_cost_lines) > 0 then
    begin
      v_cogs_entry := public._ledgr_post_cogs(
        v_inv.business_id, v_inv.id, v_inv.invoice_number,
        coalesce(v_inv.issue_date, current_date),
        v_inv.branch_id, v_inv.department_id, v_cost_lines);
      if v_cogs_entry is not null then
        update public.journal_entries set posting_key = 'invoice:' || v_inv.id::text || ':cogs'
         where id = v_cogs_entry;
      end if;
    exception when others then
      raise exception 'COGS posting failed for invoice %: %. Stock was not released; fix the cause and retry.',
        v_inv.invoice_number, sqlerrm using errcode = 'P0001';
    end;
  end if;

  return jsonb_build_object('idempotent', false, 'cogs_entry_id', v_cogs_entry,
    'cogs_missing', false, 'cost_lines', v_cost_lines);
end;
$$;

comment on function public.record_sale_stock_and_cogs(uuid, jsonb) is
  'HARDENING 2026-09-26: atomic, idempotent stock release + COGS for an existing sale (non-POS paths). Authorised as sales writer with branch access; refuses draft/void/credit-note; one transaction; failures raise.';
revoke all on function public.record_sale_stock_and_cogs(uuid, jsonb) from public, anon;
grant execute on function public.record_sale_stock_and_cogs(uuid, jsonb) to authenticated, service_role;

-- ── 2. Backfill logic fix (still contained) ────────────────────────────────
create or replace function public.backfill_and_recalculate_inventory(
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
        coalesce(public._ledgr_stock_location(e.business_id, e.branch_id), v_default_loc_id) as location_id,
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
        -- HARDENING 2026-09-26: only documents that really moved goods.
        and coalesce(e.status, '') not in ('draft', 'void', 'rejected', 'cancelled')
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
        coalesce(public._ledgr_stock_location(i.business_id, i.branch_id), v_default_loc_id) as location_id,
        il.quantity as units,
        i.issue_date
      from public.invoices i
      join public.invoice_lines il on il.invoice_id = i.id
      join public.products p on p.id = il.product_id
      where i.business_id = v_biz_record.id
        and i.deleted_at is null
        -- HARDENING 2026-09-26: drafts, voids and credit notes never released stock.
        and i.status::text not in ('draft', 'void', 'credit_note')
        and coalesce(i.invoice_type, '') <> 'credit_note'
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
        coalesce(public._ledgr_stock_location(i.business_id, i.branch_id), v_default_loc_id) as location_id,
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
        -- HARDENING 2026-09-26: drafts, voids and credit notes never released stock.
        and i.status::text not in ('draft', 'void', 'credit_note')
        and coalesce(i.invoice_type, '') <> 'credit_note'
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
  'CONTAINED (20261011000000) and logic-hardened (20261011000005): status/type filters (no draft/void/credit-note invoices; no draft/void/rejected/cancelled expenses) and the _ledgr_stock_location contract. EXECUTE remains service_role-only. Running it is an owner-authorised repair decision.';
revoke all on function public.backfill_and_recalculate_inventory(uuid) from public;
revoke all on function public.backfill_and_recalculate_inventory(uuid) from anon;
revoke all on function public.backfill_and_recalculate_inventory(uuid) from authenticated;
grant execute on function public.backfill_and_recalculate_inventory(uuid) to service_role;

-- ── 3. Source lookup index ─────────────────────────────────────────────────
create index if not exists idx_stock_movements_business_source
  on public.stock_movements (business_id, source_type, source_id);

-- ── 4. Declare the invoice insert privileges production already relies on ─
grant insert on public.invoices to authenticated;
grant insert on public.invoice_lines to authenticated;
