-- ============================================================================
-- 20260925000001_stock_movement_balance_delta_trigger.sql
--
-- Canonical stock_movements -> inventory_balances maintenance: ONE additive
-- (delta) trigger, installed idempotently, without dropping unrelated guards
-- and without rewriting balances the ledger cannot vouch for.
--
-- History
-- ───────
-- Customer report (2026-09-24): a normal Warehouse "Receive Stock" for 10
-- units left 20 on hand. The production deploy log of 20260924000001 showed
-- why — stock_movements carried THREE out-of-band triggers:
--
--   trg_stock_immutable                (a guard, not a balance writer)
--   trg_update_inventory_balance       (additive: balance += quantity)
--   trg_stock_movement_apply_balance   (additive: balance += quantity)
--
-- Two additive triggers on one insert = every movement counted twice.
--
-- 20260924000001 tried to fix that by recalculating each balance from the
-- movement ledger (balance := sum(quantity)). Production rejected it:
--
--   ERROR: new row for relation "inventory_balances" violates check
--   constraint "chk_inventory_balances_on_hand_nonneg" (SQLSTATE 23514)
--   Failing row contains (..., -1829.0000, 0.0000, -1829.0000, 2.7139, ...)
--
-- i.e. for real products the ledger nets to a NEGATIVE quantity. Opening stock
-- and older history were never recorded as stock_movements, so the ledger is
-- not a complete account of on-hand stock and "balance = sum(ledger)" is not a
-- safe invariant. Had the repair been skipped, the recalculating trigger would
-- have produced the same negative on the next sale of such a product and
-- blocked it. That design is therefore withdrawn (its helper is dropped below).
--
-- What this migration does instead
-- ────────────────────────────────
--  1. Defines the balance writer as a DELTA: balance += movement.quantity on
--     INSERT, -= on DELETE, net difference on UPDATE. This is exactly the
--     contract the application was written against (see
--     TransferRepository: "the trigger just adds this quantity to the
--     balance"), and it is correct regardless of how complete the ledger is.
--  2. Drops only triggers on stock_movements that maintain inventory_balances
--     (by name *balance*, or whose function body writes inventory_balances),
--     and keeps everything else — trg_stock_immutable stays. Each decision is
--     logged with RAISE NOTICE so the deploy output is auditable.
--  3. Installs exactly one canonical trigger and then ASSERTS there is exactly
--     one balance-maintaining trigger left, so an unexpected shape fails the
--     deploy loudly instead of silently double-counting again.
--  4. Does NOT rewrite existing balances. Where a balance is overstated by the
--     old double-count it is left as is, and v_inventory_balance_ledger_drift
--     lists every (product, location) whose balance disagrees with its ledger
--     so it can be corrected deliberately — by a stock adjustment in the app,
--     which flows through the very trigger installed here. Blanket "repairs"
--     cannot tell an over-count from legitimately imported opening stock, and
--     the production data above shows the difference is real money.
--
-- quantity_available: production carries it as a STORED GENERATED column
-- (quantity_on_hand - quantity_reserved); repository-built environments carry
-- it as a plain column. Writing a generated column is SQLSTATE 428C9, so the
-- writer never lists it and only syncs it explicitly where it is plain (see
-- docs/database/database-operations.md §9.5).
--
-- Staging note: staging recorded 20260924000001 with its original recalculating
-- body before that body was withdrawn. This migration replaces the function and
-- the trigger there too, so staging and production converge on the same shape.
-- ============================================================================

-- ── 1. Delta writer ─────────────────────────────────────────────────────────
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

  -- attgenerated is '' for a plain column and 's' for a STORED generated one.
  select exists (
    select 1
    from pg_attribute
    where attrelid = 'public.inventory_balances'::regclass
      and attname = 'quantity_available'
      and attgenerated = 's'
  )
  into v_quantity_available_is_generated;

  -- UPDATE first, INSERT only when the row is missing. This is deliberately
  -- NOT a single INSERT ... ON CONFLICT DO UPDATE: PostgreSQL evaluates CHECK
  -- constraints on the *proposed* row before it looks for the conflict, so a
  -- negative movement (every sale) would trip
  -- chk_inventory_balances_on_hand_nonneg even when the resulting balance is
  -- perfectly valid. The row-level lock taken by UPDATE serialises concurrent
  -- movements on the same key.
  --
  -- quantity_available is deliberately absent from both statements: it is
  -- derived, and writing it is an error where it is a generated column.
  update public.inventory_balances ib
     set quantity_on_hand = ib.quantity_on_hand + p_quantity,
         -- Moving weighted average on inbound quantity only. Outbound
         -- movements and reversals leave the average untouched; a negative or
         -- zero prior balance contributes no weight.
         average_cost = case
           when p_quantity > 0
            and p_unit_cost is not null
            and greatest(ib.quantity_on_hand, 0) + p_quantity > 0
           then (greatest(ib.quantity_on_hand, 0) * ib.average_cost + p_quantity * p_unit_cost)
                / (greatest(ib.quantity_on_hand, 0) + p_quantity)
           else ib.average_cost
         end,
         -- greatest() ignores NULLs, so a reversal (p_moved_at null) never
         -- moves it backwards.
         last_movement_at = greatest(ib.last_movement_at, p_moved_at),
         updated_at = now()
   where ib.business_id = p_business_id
     and ib.product_id = p_product_id
     and ib.location_id = p_location_id;

  if not found then
    -- First movement for this key. If two first movements race, the loser's
    -- ON CONFLICT adds its quantity to the winner's row. A negative first
    -- movement is rejected by the non-negative check, which is correct: there
    -- is nothing on hand to take it from.
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
         and p_unit_cost is not null
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

  -- Only needed where quantity_available is a plain column. A generated
  -- column has already been recomputed from the values written above.
  if not v_quantity_available_is_generated then
    update public.inventory_balances ib
       set quantity_available = ib.quantity_on_hand - coalesce(ib.quantity_reserved, 0)
     where ib.business_id = p_business_id
       and ib.product_id = p_product_id
       and ib.location_id = p_location_id;
  end if;
end;
$$;

-- ── 2. Trigger function (same name the application documents) ───────────────
create or replace function public.update_inventory_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Maintains public.inventory_balances by delta. One row in -> its quantity
  -- added exactly once; one row out -> subtracted exactly once.
  if tg_op = 'INSERT' then
    perform public._ledgr_apply_stock_movement_delta(
      new.business_id, new.product_id, new.location_id,
      new.quantity, new.unit_cost, coalesce(new.created_at, now())
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public._ledgr_apply_stock_movement_delta(
      old.business_id, old.product_id, old.location_id,
      -old.quantity, null, null
    );
    return old;
  end if;

  -- UPDATE: apply the NET change so an edit that does not touch the quantity
  -- (notes, reference) is a no-op and cannot trip the non-negative check on a
  -- balance that has since been drawn down.
  if new.business_id = old.business_id
     and new.product_id = old.product_id
     and new.location_id = old.location_id then
    if new.quantity <> old.quantity then
      perform public._ledgr_apply_stock_movement_delta(
        new.business_id, new.product_id, new.location_id,
        new.quantity - old.quantity, new.unit_cost, coalesce(new.created_at, now())
      );
    end if;
  else
    perform public._ledgr_apply_stock_movement_delta(
      old.business_id, old.product_id, old.location_id,
      -old.quantity, null, null
    );
    perform public._ledgr_apply_stock_movement_delta(
      new.business_id, new.product_id, new.location_id,
      new.quantity, new.unit_cost, coalesce(new.created_at, now())
    );
  end if;
  return new;
end;
$$;

-- ── 3. Remove every OTHER balance-maintaining trigger; keep unrelated guards ─
do $$
declare
  trigger_record record;
begin
  for trigger_record in
    select
      t.tgname,
      p.proname,
      (
        t.tgname ilike '%balance%'
        or p.proname ilike '%balance%'
        or p.prosrc ~* '(insert\s+into|update)\s+(public\.)?inventory_balances\M'
      ) as maintains_balances
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where t.tgrelid = 'public.stock_movements'::regclass
      and not t.tgisinternal
    order by t.tgname
  loop
    if trigger_record.maintains_balances then
      raise notice 'dropping balance trigger % (function %) on public.stock_movements',
        trigger_record.tgname, trigger_record.proname;
      execute format('drop trigger if exists %I on public.stock_movements', trigger_record.tgname);
    else
      raise notice 'keeping unrelated trigger % (function %) on public.stock_movements',
        trigger_record.tgname, trigger_record.proname;
    end if;
  end loop;
end $$;

create trigger trg_stock_movements_apply_inventory_balance
after insert or update or delete on public.stock_movements
for each row execute function public.update_inventory_balance();

-- ── 4. Assert the shape: exactly one balance-maintaining trigger remains ────
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

-- ── 5. Withdraw the ledger-recalculation helper from 20260924000001 ─────────
-- Nothing calls it any more; leaving it around invites a repeat of the
-- negative-balance failure.
drop function if exists public._ledgr_recalculate_inventory_balance(uuid, uuid, uuid);

-- ── 6. Visibility instead of a blind repair ─────────────────────────────────
-- Every (business, product, location) whose on-hand balance disagrees with the
-- sum of its movements. difference > 0 means the balance is higher than the
-- ledger explains (the double-count signature, OR imported opening stock);
-- difference < 0 means history predates the ledger. RLS on the underlying
-- tables is honoured (security_invoker), so a business only sees its own rows.
drop view if exists public.v_inventory_balance_ledger_drift;
create view public.v_inventory_balance_ledger_drift
  with (security_invoker = true) as
with ledger as (
  select
    sm.business_id,
    sm.product_id,
    sm.location_id,
    sum(sm.quantity)  as ledger_quantity,
    count(*)          as movement_count,
    max(sm.created_at) as last_ledger_movement_at
  from public.stock_movements sm
  group by sm.business_id, sm.product_id, sm.location_id
)
select
  business_id,
  product_id,
  location_id,
  ib.quantity_on_hand,
  coalesce(l.ledger_quantity, 0)                                   as ledger_quantity,
  coalesce(ib.quantity_on_hand, 0) - coalesce(l.ledger_quantity, 0) as difference,
  coalesce(l.movement_count, 0)                                    as movement_count,
  l.last_ledger_movement_at,
  ib.updated_at                                                    as balance_updated_at
from public.inventory_balances ib
full join ledger l using (business_id, product_id, location_id)
where coalesce(ib.quantity_on_hand, 0) <> coalesce(l.ledger_quantity, 0);

grant select on public.v_inventory_balance_ledger_drift to authenticated, service_role;

comment on view public.v_inventory_balance_ledger_drift is
  'inventory_balances rows whose quantity_on_hand differs from sum(stock_movements.quantity). Diagnostic for the 2026-09 double-count: a positive difference is either the legacy duplicate trigger or imported opening stock — correct it with a stock adjustment, never by rewriting the balance blindly.';

comment on function public._ledgr_apply_stock_movement_delta(uuid, uuid, uuid, numeric, numeric, timestamptz) is
  'Adds one movement quantity (positive or negative) to the matching inventory_balances row, creating it if absent. Writes only base columns: quantity_available is derived and is maintained by the database itself where it is a generated column.';

comment on function public.update_inventory_balance() is
  'AFTER trigger for stock_movements. Applies each movement to inventory_balances exactly once as a delta (INSERT +quantity, DELETE -quantity, UPDATE net change). Must be installed under exactly one trigger on stock_movements; 20260925000001 asserts that.';

-- These SECURITY DEFINER functions are implementation details for the trigger,
-- not tenant-callable APIs.
revoke execute on function public._ledgr_apply_stock_movement_delta(uuid, uuid, uuid, numeric, numeric, timestamptz) from public;
revoke execute on function public.update_inventory_balance() from public;
