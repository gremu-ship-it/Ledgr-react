-- ============================================================================
-- Diagnostic (focused): Eagle Nova Horizon — Area 49 pure chicken manure
--
-- WHY THIS FILE EXISTS
--   The Warehouse page shows 320 bags of Pure Chicken Manure - 50kgs at
--   Area 49 while the movement ledger only accounts for 207 (drift +113).
--   Area 49 is the ONLY location with a large positive drift; every other
--   location is flat or slightly negative. This reads Area 49's complete
--   movement history so the +113 can be explained before anything is changed.
--
-- Every query returns ONE wide row (values are string_agg'd into a single
-- line) because the workflow surfaces results as check-run annotations and
-- GitHub caps those at ten per step.
--
-- Read-only. Safe to re-run.
-- ============================================================================


-- ── 1. Area 49 movement-by-movement history for Pure Chicken Manure ────────
-- Format per movement: date type q=<qty> c=<unit cost> src=<source>/<id>
-- ref=<reference> ck=<client key> @<created at>
select string_agg(
         to_char(sm.movement_date, 'YYYY-MM-DD')
           || ' ' || sm.movement_type
           || ' q='   || sm.quantity
           || ' c='   || round(sm.unit_cost, 2)
           || ' src=' || coalesce(sm.source_type, '-') || '/' || coalesce(left(sm.source_id::text, 8), '-')
           || ' ref=' || coalesce(sm.reference, '-')
           || ' ck='  || coalesce(left(sm.client_key::text, 8), '-')
           || ' @'    || to_char(sm.created_at, 'MM-DD HH24:MI:SS'),
         ' ; ' order by sm.created_at) as area_49_movements
from public.stock_movements sm
join public.products pr on pr.id = sm.product_id
join public.inventory_locations il on il.id = sm.location_id
where sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  and pr.name ilike '%pure%manure%'
  and il.name ilike '%area%49%';


-- ── 2. Area 49 totals by movement type ─────────────────────────────────────
select string_agg(
         sm.movement_type
           || ': n=' || count(*)
           || ' sum_q=' || sum(sm.quantity)
           || ' (' || to_char(min(sm.created_at), 'YYYY-MM-DD HH24:MI')
           || ' .. ' || to_char(max(sm.created_at), 'YYYY-MM-DD HH24:MI') || ')',
         ' ; ' order by sm.movement_type) as area_49_by_type
from public.stock_movements sm
join public.products pr on pr.id = sm.product_id
join public.inventory_locations il on il.id = sm.location_id
where sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  and pr.name ilike '%pure%manure%'
  and il.name ilike '%area%49%'
group by sm.movement_type;


-- ── 3. Running balance reconstruction for Area 49 ─────────────────────────
-- Walks the movements in order and shows what on-hand would be if every
-- movement were counted ONCE (ledger) or TWICE (dual-trigger bug). Compare
-- with the stored on_hand=320 to see which hypothesis fits.
with area49 as (
  select sm.created_at, sm.movement_type, sm.quantity, sm.movement_date
  from public.stock_movements sm
  join public.products pr on pr.id = sm.product_id
  join public.inventory_locations il on il.id = sm.location_id
  where sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
    and pr.name ilike '%pure%manure%'
    and il.name ilike '%area%49%'
)
select (select ib.quantity_on_hand from public.inventory_balances ib
          join public.products pr on pr.id = ib.product_id
          join public.inventory_locations il on il.id = ib.location_id
         where ib.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
           and pr.name ilike '%pure%manure%'
           and il.name ilike '%area%49%')          as stored_on_hand,
       (select sum(quantity) from area49)          as ledger_once,
       (select sum(quantity) * 2 from area49)      as ledger_twice,
       (select count(*) from area49)               as movement_count,
       (select sum(quantity) from area49 where quantity > 0) as total_in,
       (select sum(quantity) from area49 where quantity < 0) as total_out;


-- ── 4. Which movements, if counted twice, explain the +113 drift? ─────────
-- The dual-trigger bug added each affected movement's quantity an extra time.
-- So the drift equals the SUM of the quantities that were double-counted.
-- This lists every movement whose quantity is a plausible component, newest
-- first, with its created_at — the doubled set is normally a contiguous
-- block ending at the most recent movement.
select string_agg(
         to_char(sm.created_at, 'YYYY-MM-DD HH24:MI:SS')
           || ' ' || sm.movement_type
           || ' q=' || sm.quantity
           || ' running_drift_if_from_here=' ||
              (select sum(x.quantity) from public.stock_movements x
                join public.products xp on xp.id = x.product_id
                join public.inventory_locations xl on xl.id = x.location_id
               where x.business_id = sm.business_id
                 and xp.name ilike '%pure%manure%'
                 and xl.name ilike '%area%49%'
                 and x.created_at >= sm.created_at),
         ' ; ' order by sm.created_at desc) as drift_by_cutoff
from public.stock_movements sm
join public.products pr on pr.id = sm.product_id
join public.inventory_locations il on il.id = sm.location_id
where sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  and pr.name ilike '%pure%manure%'
  and il.name ilike '%area%49%';
