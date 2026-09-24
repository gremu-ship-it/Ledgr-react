-- ===========================================================================
-- One stock-balance writer, and a weighted-average that ignores a blank cost.
--
-- What went wrong after POS
-- ─────────────────────────
-- 20260925000001 installed the canonical delta trigger
-- (trg_stock_movements_apply_inventory_balance). 20260928000001 (R06) was
-- written against a harness that had NO trigger yet, and it installs a
-- second one (trg_stock_movement_apply_balance) without dropping the first.
-- If both are present, a receipt is added twice and the cost is blended
-- twice. The 2026-09-24 production snapshot had only the canonical writer
-- live — this file still drops the R06 name so a later deploy of R06 cannot
-- put the second writer back.
--
-- The canonical writer also treated a unit cost of 0 as a real cost. A
-- receipt with the cost left blank pulled the average down. That is one way
-- mixed manure (warehouse average 6,482.10 on that snapshot) ends up costing
-- more than pure (about 4,000–5,000). It is not a sale-price check: the
-- customer prices were not re-read with this migration.
--
-- This migration
-- ──────────────
--  1. Drops the R06 duplicate trigger if it is present. Fresh replays apply
--     R06 before this file, so both shapes end with exactly one writer.
--  2. Teaches the surviving writer to leave average_cost alone when the
--     inbound unit cost is null or zero. Quantity still moves.
--  3. Asserts exactly one balance trigger remains.
--  4. Repairs Eagle Nova Horizon's manure balances, which are the live
--     evidence of the bug (captured 2026-09-24):
--       * Airwing pure was 21 on hand against a once-counted ledger of 103.
--         They counted ~98, added 120, and the screen showed 141 — that is
--         21 + 120, the add landing on the wrong base. Where the balance is
--         BELOW the ledger, the ledger is the higher once-counted figure
--         (opening stock not in the ledger would make the balance higher,
--         not lower), so on_hand is set to the ledger.
--       * Area 49 pure was 320 on hand against a ledger of 207. Adding 160
--         had been applied twice. That location is set back to the ledger.
--         Other positive differences are left alone: Main Warehouse mixed
--         is 220 above its ledger, and that can be opening stock that was
--         never a movement. A blind rewrite cannot tell them apart.
--       * average_cost is recomputed once from costed inbound movements
--         (quantity > 0 and unit_cost > 0). A location with no such movement
--         keeps the average it already has.
--
-- quantity_available is not written. On production it is a generated column.
-- ===========================================================================

-- ── 1. Drop the second writer before it can fire on the repair below ────────
drop trigger if exists trg_stock_movement_apply_balance on public.stock_movements;

-- ── 2. Blank / zero inbound cost must not dilute the average ────────────────
create or replace function public._ledgr_apply_stock_movement_delta(
  p_business_id uuid,
  p_product_id uuid,
  p_location_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_moved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity_available_is_generated boolean := false;
begin
  if p_quantity is null or p_quantity = 0 then
    return;
  end if;

  select exists (
    select 1
    from pg_attribute
    where attrelid = 'public.inventory_balances'::regclass
      and attname = 'quantity_available'
      and attgenerated = 's'
  )
  into v_quantity_available_is_generated;

  update public.inventory_balances ib
     set quantity_on_hand = ib.quantity_on_hand + p_quantity,
         -- Moving weighted average on costed inbound only. A null or zero
         -- unit cost adds quantity and leaves the average untouched — unknown
         -- cost is never substituted into valuation. Outbound movements and
         -- reversals also leave the average untouched. A negative or zero
         -- prior balance contributes no weight.
         average_cost = case
           when p_quantity > 0
            and coalesce(p_unit_cost, 0) > 0
            and greatest(ib.quantity_on_hand, 0) + p_quantity > 0
           then (greatest(ib.quantity_on_hand, 0) * ib.average_cost + p_quantity * p_unit_cost)
                / (greatest(ib.quantity_on_hand, 0) + p_quantity)
           else ib.average_cost
         end,
         last_movement_at = greatest(ib.last_movement_at, p_moved_at),
         updated_at = now()
   where ib.business_id = p_business_id
     and ib.product_id = p_product_id
     and ib.location_id = p_location_id;

  if not found then
    insert into public.inventory_balances (
      business_id,
      product_id,
      location_id,
      quantity_on_hand,
      quantity_reserved,
      average_cost,
      last_movement_at,
      updated_at
    ) values (
      p_business_id,
      p_product_id,
      p_location_id,
      p_quantity,
      0,
      coalesce(p_unit_cost, 0),
      p_moved_at,
      now()
    )
    on conflict (business_id, product_id, location_id)
    do update set
      quantity_on_hand = public.inventory_balances.quantity_on_hand + excluded.quantity_on_hand,
      average_cost = case
        when excluded.quantity_on_hand > 0
         and coalesce(p_unit_cost, 0) > 0
         and greatest(public.inventory_balances.quantity_on_hand, 0) + excluded.quantity_on_hand > 0
        then (
               greatest(public.inventory_balances.quantity_on_hand, 0) * public.inventory_balances.average_cost
               + excluded.quantity_on_hand * p_unit_cost
             ) / (greatest(public.inventory_balances.quantity_on_hand, 0) + excluded.quantity_on_hand)
        else public.inventory_balances.average_cost
      end,
      last_movement_at = greatest(public.inventory_balances.last_movement_at, excluded.last_movement_at),
      updated_at = now();
  end if;

  if not v_quantity_available_is_generated then
    update public.inventory_balances ib
       set quantity_available = ib.quantity_on_hand - coalesce(ib.quantity_reserved, 0)
     where ib.business_id = p_business_id
       and ib.product_id = p_product_id
       and ib.location_id = p_location_id;
  end if;
end;
$$;

comment on function public._ledgr_apply_stock_movement_delta(uuid, uuid, uuid, numeric, numeric, timestamptz) is
  'Adds one movement quantity to the matching inventory_balances row. Weighted-average cost updates only on inbound quantity with a positive unit cost; a blank or zero cost never substitutes zero into valuation.';

-- ── 3. Exactly one balance writer, or the deploy fails loudly ───────────────
do $$
declare
  v_count integer;
  v_names text;
begin
  select count(*), string_agg(t.tgname, ', ' order by t.tgname)
    into v_count, v_names
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid = 'public.stock_movements'::regclass
    and not t.tgisinternal
    and (
      t.tgname ilike '%balance%'
      or p.proname ilike '%balance%'
      or p.prosrc ~* '(insert\s+into|update)\s+(public\.)?inventory_balances\M'
    );

  if v_count <> 1 then
    raise exception
      'expected exactly one inventory-balance trigger on public.stock_movements, found % (%)',
      v_count, coalesce(v_names, 'none');
  end if;
  raise notice 'inventory balance trigger on public.stock_movements: %', v_names;
end $$;

-- ── 4. Eagle Nova manure: put the live balances back on the once-counted ledger
-- Business 93851ac2-73ac-4241-b462-ec8d9d663f8b (Eagle Nova Horizon Holdings).
-- No-op for every other tenant, and a no-op on a second run (difference = 0).
do $$
declare
  v_business uuid := '93851ac2-73ac-4241-b462-ec8d9d663f8b';
  v_qty integer := 0;
  v_cost integer := 0;
  r record;
begin
  if to_regclass('public.v_inventory_balance_ledger_drift') is null then
    raise notice 'eagle nova stock repair skipped: drift view is not installed';
    return;
  end if;

  -- Quantity. Negative drift: the balance lost units the ledger still has
  -- (Airwing 21 vs 103). Area 49 positive drift: the reported double-add
  -- (320 vs 207). Never write a negative on-hand, and never drop below what
  -- is already reserved.
  for r in
    select pr.name as product_name,
           il.name as location_name,
           ib.quantity_on_hand as old_qty,
           d.ledger_quantity as new_qty
    from public.v_inventory_balance_ledger_drift d
    join public.inventory_balances ib
      on ib.business_id = d.business_id
     and ib.product_id = d.product_id
     and ib.location_id = d.location_id
    join public.products pr on pr.id = d.product_id
    join public.inventory_locations il on il.id = d.location_id
    where d.business_id = v_business
      and pr.name ilike '%manure%'
      and coalesce(d.movement_count, 0) > 0
      and d.ledger_quantity >= coalesce(ib.quantity_reserved, 0)
      and (
        d.difference < 0
        or (il.name ilike '%area%49%' and d.difference > 0)
      )
  loop
    raise notice 'eagle nova qty % @ %: % -> %',
      r.product_name, r.location_name, r.old_qty, r.new_qty;
  end loop;

  update public.inventory_balances ib
     set quantity_on_hand = d.ledger_quantity,
         updated_at = now()
    from public.v_inventory_balance_ledger_drift d
    join public.products pr on pr.id = d.product_id
    join public.inventory_locations il on il.id = d.location_id
   where ib.business_id = d.business_id
     and ib.product_id = d.product_id
     and ib.location_id = d.location_id
     and d.business_id = v_business
     and pr.name ilike '%manure%'
     and coalesce(d.movement_count, 0) > 0
     and d.ledger_quantity >= coalesce(ib.quantity_reserved, 0)
     and (
       d.difference < 0
       or (il.name ilike '%area%49%' and d.difference > 0)
     );
  get diagnostics v_qty = row_count;

  -- Average cost, counted once from costed inbound movements only.
  for r in
    select pr.name as product_name,
           il.name as location_name,
           ib.average_cost as old_avg,
           calc.avg_cost as new_avg
    from public.inventory_balances ib
    join public.products pr on pr.id = ib.product_id
    join public.inventory_locations il on il.id = ib.location_id
    join (
      select sm.product_id,
             sm.location_id,
             sum(sm.quantity * sm.unit_cost) / nullif(sum(sm.quantity), 0) as avg_cost
      from public.stock_movements sm
      where sm.business_id = v_business
        and sm.quantity > 0
        and coalesce(sm.unit_cost, 0) > 0
      group by sm.product_id, sm.location_id
    ) calc
      on calc.product_id = ib.product_id
     and calc.location_id = ib.location_id
    where ib.business_id = v_business
      and pr.name ilike '%manure%'
      and calc.avg_cost is not null
      and abs(ib.average_cost - calc.avg_cost) > 0.01
  loop
    raise notice 'eagle nova cost % @ %: % -> %',
      r.product_name, r.location_name, r.old_avg, r.new_avg;
  end loop;

  update public.inventory_balances ib
     set average_cost = calc.avg_cost,
         updated_at = now()
    from public.products pr,
         (
           select sm.product_id,
                  sm.location_id,
                  sum(sm.quantity * sm.unit_cost) / nullif(sum(sm.quantity), 0) as avg_cost
           from public.stock_movements sm
           where sm.business_id = v_business
             and sm.quantity > 0
             and coalesce(sm.unit_cost, 0) > 0
           group by sm.product_id, sm.location_id
         ) calc
   where ib.business_id = v_business
     and pr.id = ib.product_id
     and pr.name ilike '%manure%'
     and calc.product_id = ib.product_id
     and calc.location_id = ib.location_id
     and calc.avg_cost is not null
     and abs(ib.average_cost - calc.avg_cost) > 0.01;
  get diagnostics v_cost = row_count;

  raise notice 'eagle nova manure repair: % quantity row(s), % average-cost row(s)', v_qty, v_cost;
end $$;
