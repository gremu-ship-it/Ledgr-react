-- ===========================================================================
-- Eagle Nova manure: put the drifted balances back on the movement ledger.
--
-- Does not touch triggers. The single balance writer is
-- trg_stock_movement_apply_balance, enforced by
-- 20261009000000_r06_single_stock_balance_writer.sql. A blank inbound cost
-- already leaves average_cost unchanged in that writer.
--
-- Business 93851ac2-73ac-4241-b462-ec8d9d663f8b (Eagle Nova Horizon Holdings),
-- products whose name matches manure, and only these drifts from the
-- 2026-09-24 snapshot:
--   * on-hand below the ledger (Airwing pure was 21 against a ledger of 103;
--     they counted ~98, added 120, and the screen showed 141 = 21 + 120)
--   * Area 49 where on-hand is above the ledger (320 against 207, 113 above —
--     not the same as 160 added twice). Other positive drift is left alone,
--     including Main Warehouse mixed, which can be opening stock.
--
-- average_cost is recomputed from inbound movements with quantity > 0 and
-- unit_cost > 0. A location with no such movement keeps its stored average.
-- quantity_available is not written. On production it is a generated column.
-- No-op for every other tenant, and a no-op on a second run (difference = 0).
-- Uses the live ledger at deploy time, not the snapshot quantities.
-- ===========================================================================

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
