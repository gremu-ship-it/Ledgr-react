-- Phase 1 — READ-ONLY discovery, adapted to the repository-head schema.
-- Run this against the live project FIRST; do not write until every row below
-- is understood. Set the target business below (or replace it with a psql var).
select set_config('ledgr.business_id', '487334df-a057-45c3-b088-85e6c0a6aeb3', false);

-- 1a. Business profile
select id, name, operating_models, capability_overrides, plan_tier, base_currency as currency
  from public.businesses
 where id = current_setting('ledgr.business_id')::uuid;

-- 1b. Members
select user_id, role, is_active, created_at
  from public.business_users
 where business_id = current_setting('ledgr.business_id')::uuid
 order by created_at;

-- 1c. Products
select id, name, product_type, purchase_price, sale_price as selling_price,
       unit_of_measure as unit, track_inventory, is_active
  from public.products
 where business_id = current_setting('ledgr.business_id')::uuid
   and deleted_at is null
 order by product_type, name;

-- 1d. Inventory locations
select id, name, location_type, is_default, branch_id
  from public.inventory_locations
 where business_id = current_setting('ledgr.business_id')::uuid
 order by location_type, name;

-- 1e. Construction projects
select id, name, client_name, status, contract_sum, retention_pct, budget,
       start_date, end_date
  from public.construction_projects
 where business_id = current_setting('ledgr.business_id')::uuid
 order by name;

-- 1f. Manufacturing BOMs
select b.id, b.product_id, p.name as product_name, b.version, b.status, b.bom_locked_at,
       public.manufacturing_bom_cost(b.id) as cost
  from public.manufacturing_boms b
  join public.products p on p.id = b.product_id
 where b.business_id = current_setting('ledgr.business_id')::uuid
 order by p.name, b.version;

-- 1g. Manufacturing work orders
select id, work_order_number, status, planned_quantity, completed_quantity, scrapped_quantity
  from public.manufacturing_work_orders
 where business_id = current_setting('ledgr.business_id')::uuid
 order by created_at;

-- 1h. Chart of accounts (key accounts)
select id, code, name, account_type as type, account_subtype as subtype, is_group
  from public.accounts
 where business_id = current_setting('ledgr.business_id')::uuid
   and (name ilike '%WIP%'
     or name ilike '%retention%'
     or name ilike '%raw material%'
     or name ilike '%finished good%'
     or name ilike '%trading%'
     or name ilike '%inventory%'
     or name ilike '%revenue%'
     or name ilike '%cost of%'
     or name ilike '%payable%'
     or name ilike '%receivable%'
     or name ilike '%debtor%'
     or name ilike '%creditor%'
     or name ilike '%cash%'
     or name ilike '%bank%')
 order by code;

-- 1i. Journal/posting tables
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and (table_name ilike '%journal%'
     or table_name ilike '%ledger%'
     or table_name ilike '%entry%'
     or table_name ilike '%posting%')
 order by table_name;

-- 1j. Stock-movement schema
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'stock_movements'
 order by ordinal_position;

-- 1j-extra. Valid stock-movement enum values
select unnest(enum_range(null::public.stock_movement_type))::text as movement_type;

-- 1k. Existing stock movements
select count(*) as total_movements,
       count(distinct movement_type) as distinct_types,
       min(movement_date) as earliest_movement,
       max(movement_date) as latest_movement
  from public.stock_movements
 where business_id = current_setting('ledgr.business_id')::uuid;

-- 1l. Existing inventory balances
select count(*) as total_balances,
       sum(case when quantity_on_hand < 0 then 1 else 0 end) as negative_balances
  from public.inventory_balances
 where business_id = current_setting('ledgr.business_id')::uuid;
