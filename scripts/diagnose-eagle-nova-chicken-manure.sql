-- ============================================================================
-- Diagnostic: Eagle Nova Horizon — chicken manure stock (160 recorded → 320)
--
-- Every query here returns FEW, WIDE rows (values are string_agg'd into one
-- line) because the workflow surfaces results as check-run annotations and
-- GitHub caps those at ten per step. One row = one annotation.
--
-- Read-only. Safe to run as often as needed.
--
-- HOW TO RUN
--   Supabase Dashboard → SQL Editor → paste → Run, or via
--   .github/workflows/repair-eagle-nova-double-count.yml (push to main).
-- ============================================================================


-- ── 1. Business + every manure product it sells (1 row) ────────────────────
select b.name as business,
       b.id as business_id,
       (select string_agg(p.name || '  [' || left(p.id::text, 8) || ']', ' ; ' order by p.name)
          from public.products p
         where p.business_id = b.id
           and p.deleted_at is null
           and p.name ilike '%manure%') as manure_products
from public.businesses b
where b.id = '93851ac2-73ac-4241-b462-ec8d9d663f8b';


-- ── 2. Balance vs movement ledger, per product (one row per product) ───────
-- on_hand  = what the Warehouse page shows
-- ledger   = SUM(stock_movements.quantity) — the true recorded movement history
-- diff     = on_hand - ledger  (>0 = balance higher than history explains)
-- movs     = number of movement rows
-- last_mv  = most recent movement
select pr.name as product,
       string_agg(
         coalesce(il.name, '(no location)')
           || ' on_hand='       || ib.quantity_on_hand
           || ' avg_cost='      || round(ib.average_cost, 2)
           || ' ledger='        || coalesce(d.ledger_quantity::text, 'n/a')
           || ' diff='          || coalesce(d.difference::text, 'n/a')
           || ' movs='          || coalesce(d.movement_count::text, '0')
           || ' last_mv='       || coalesce(to_char(d.last_ledger_movement_at, 'YYYY-MM-DD HH24:MI'), 'none'),
         ' ; ' order by il.name) as locations
from public.inventory_balances ib
join public.products pr on pr.id = ib.product_id
left join public.inventory_locations il on il.id = ib.location_id
left join public.v_inventory_balance_ledger_drift d
       on d.business_id = ib.business_id
      and d.product_id   = ib.product_id
      and d.location_id  = ib.location_id
where ib.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  and pr.deleted_at is null
  and pr.name ilike '%manure%'
group by pr.name
order by pr.name;


-- ── 3. Full movement ledger for PURE chicken manure, per location ──────────
-- Each row is one location; every movement is listed newest-friendly oldest→
-- newest as: date type q=<qty> c=<unit cost> src=<source_type>/<source id>
-- ref=<reference> ck=<client key> by=<creator> @<created at>.
-- A duplicated receipt shows up as two identical-looking lines (same date,
-- qty, cost) that landed seconds or minutes apart.
select coalesce(il.name, '(no location)') as location,
       count(*) as movements,
       sum(sm.quantity) as ledger_total,
       string_agg(
         to_char(sm.movement_date, 'YYYY-MM-DD')
           || ' ' || sm.movement_type
           || ' q='   || sm.quantity
           || ' c='   || sm.unit_cost
           || ' src=' || coalesce(sm.source_type, '-') || '/' || coalesce(left(sm.source_id::text, 8), '-')
           || ' ref=' || coalesce(sm.reference, '-')
           || ' ck='  || coalesce(left(sm.client_key::text, 8), '-')
           || ' by='  || coalesce(left(sm.created_by, 8), '-')
           || ' @'    || to_char(sm.created_at, 'MM-DD HH24:MI'),
         ' ; ' order by sm.created_at) as movement_list
from public.stock_movements sm
join public.products pr on pr.id = sm.product_id
left join public.inventory_locations il on il.id = sm.location_id
where sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  and pr.name ilike '%pure%manure%'
group by il.name
order by il.name;


-- ── 4. Every trigger on stock_movements (1 row) ────────────────────────────
-- Post-20260925000001 there must be exactly ONE balance-maintaining trigger
-- (trg_stock_movements_apply_inventory_balance). Two additive ones are the
-- 2026-09 double-count bug. trg_stock_immutable is a guard and is expected.
select string_agg(t.tgname || ' -> ' || p.proname, ' ; ' order by t.tgname) as triggers_on_stock_movements
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.stock_movements'::regclass
  and not t.tgisinternal;


-- ── 5. Exact-duplicate movement groups (repeated identical receipts) ───────
-- Any row here = the same movement recorded MORE THAN ONCE in the ledger
-- itself (a double-submitted Receive Stock), which is a different fault from
-- the dual-trigger over-count. Empty = the ledger holds each movement once.
select pr.name as product,
       coalesce(il.name, '(no location)') as location,
       to_char(sm.movement_date, 'YYYY-MM-DD') as movement_date,
       sm.movement_type,
       sm.quantity,
       sm.unit_cost,
       count(*) as copies,
       string_agg(left(sm.id::text, 8) || '@' || to_char(sm.created_at, 'MM-DD HH24:MI:SS'), ' ; ' order by sm.created_at) as movement_ids
from public.stock_movements sm
join public.products pr on pr.id = sm.product_id
left join public.inventory_locations il on il.id = sm.location_id
where sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  and pr.name ilike '%manure%'
group by pr.name, il.name, sm.movement_date, sm.movement_type, sm.quantity, sm.unit_cost,
         sm.source_type, sm.source_id, sm.reference
having count(*) > 1
order by copies desc, pr.name;


-- ── 6. Any movement of exactly 160 bags (the quantity in the report) ───────
select pr.name as product,
       coalesce(il.name, '(no location)') as location,
       to_char(sm.movement_date, 'YYYY-MM-DD') as movement_date,
       sm.movement_type,
       sm.quantity,
       sm.unit_cost,
       coalesce(sm.source_type, '-') as source_type,
       coalesce(sm.reference, '-') as reference,
       coalesce(left(sm.client_key::text, 8), '-') as client_key,
       left(sm.id::text, 8) as movement_id,
       to_char(sm.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at
from public.stock_movements sm
join public.products pr on pr.id = sm.product_id
left join public.inventory_locations il on il.id = sm.location_id
where sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  and pr.name ilike '%manure%'
  and abs(sm.quantity) = 160
order by sm.created_at;
