-- Canonical stock movement -> inventory balance maintenance.
--
-- Customer report (2026-09-24): a normal Warehouse "Receive Stock" submit for
-- 10 units left 20 units on hand. That points to the balance row being updated
-- twice for a single stock_movements insert (for example, duplicate additive
-- triggers on stock_movements), not to a browser retry.
--
-- Make the trigger idempotent by recalculating the affected balance from the
-- stock_movements ledger instead of incrementing it. Even if this trigger is
-- accidentally installed twice in the future, both executions SET the same
-- derived quantity rather than adding the movement again.

create or replace function public._ledgr_recalculate_inventory_balance(
  p_business_id uuid,
  p_product_id uuid,
  p_location_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantity_on_hand numeric := 0;
  v_average_cost numeric := 0;
  v_last_movement_at timestamptz := null;
  v_has_movements boolean := false;
begin
  select
    coalesce(sum(sm.quantity), 0),
    coalesce(
      sum(case when sm.quantity > 0 then sm.quantity * sm.unit_cost else 0 end)
        / nullif(sum(case when sm.quantity > 0 then sm.quantity else 0 end), 0),
      0
    ),
    max(sm.created_at),
    count(*) > 0
  into v_quantity_on_hand, v_average_cost, v_last_movement_at, v_has_movements
  from public.stock_movements sm
  where sm.business_id = p_business_id
    and sm.product_id = p_product_id
    and sm.location_id = p_location_id;

  if v_has_movements then
    insert into public.inventory_balances (
      business_id,
      product_id,
      location_id,
      quantity_on_hand,
      quantity_reserved,
      quantity_available,
      average_cost,
      last_movement_at,
      updated_at
    ) values (
      p_business_id,
      p_product_id,
      p_location_id,
      v_quantity_on_hand,
      0,
      v_quantity_on_hand,
      v_average_cost,
      v_last_movement_at,
      now()
    )
    on conflict (business_id, product_id, location_id)
    do update set
      quantity_on_hand = excluded.quantity_on_hand,
      quantity_available = excluded.quantity_on_hand - coalesce(public.inventory_balances.quantity_reserved, 0),
      average_cost = case
        when excluded.average_cost > 0 then excluded.average_cost
        else public.inventory_balances.average_cost
      end,
      last_movement_at = excluded.last_movement_at,
      updated_at = now();
  else
    update public.inventory_balances ib
       set quantity_on_hand = 0,
           quantity_available = 0 - coalesce(ib.quantity_reserved, 0),
           last_movement_at = null,
           updated_at = now()
     where ib.business_id = p_business_id
       and ib.product_id = p_product_id
       and ib.location_id = p_location_id;
  end if;
end;
$$;

create or replace function public.update_inventory_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public._ledgr_recalculate_inventory_balance(
      old.business_id,
      old.product_id,
      old.location_id
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    -- On UPDATE, recalculate NEW as well. If the row did not move to another
    -- product/location, this harmlessly SETs the same derived values again.
    perform public._ledgr_recalculate_inventory_balance(
      new.business_id,
      new.product_id,
      new.location_id
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Remove any previous user triggers attached to stock_movements. The live
-- schema historically carried the balance trigger out-of-band from migrations;
-- dropping all non-internal triggers here prevents an old additive trigger from
-- firing alongside the canonical recalculating trigger.
do $$
declare
  trigger_record record;
begin
  for trigger_record in
    select t.tgname
    from pg_trigger t
    where t.tgrelid = 'public.stock_movements'::regclass
      and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on public.stock_movements', trigger_record.tgname);
  end loop;
end $$;

create trigger trg_stock_movements_recalculate_inventory_balance
after insert or update or delete on public.stock_movements
for each row execute function public.update_inventory_balance();

-- Repair existing balances that were already overstated by duplicate additive
-- trigger execution. This is safe for genuine duplicate movement rows: their
-- summed movement history remains the source of truth and can still be cleaned
-- up by the app-level duplicate receipt repair when appropriate.
do $$
declare
  balance_key record;
begin
  for balance_key in
    select distinct sm.business_id, sm.product_id, sm.location_id
    from public.stock_movements sm
  loop
    perform public._ledgr_recalculate_inventory_balance(
      balance_key.business_id,
      balance_key.product_id,
      balance_key.location_id
    );
  end loop;
end $$;

comment on function public._ledgr_recalculate_inventory_balance(uuid, uuid, uuid) is
  'Recomputes one inventory balance from stock_movements. Used by the stock movement trigger so one inserted movement can only ever contribute its quantity once, even if a previous additive trigger existed.';

comment on function public.update_inventory_balance() is
  'AFTER trigger for stock_movements. Recalculates affected inventory_balances from movement history instead of incrementing, preventing normal submits from being double-counted by duplicate/additive trigger installs.';

-- These SECURITY DEFINER functions are implementation details for the trigger,
-- not tenant-callable APIs.
revoke execute on function public._ledgr_recalculate_inventory_balance(uuid, uuid, uuid) from public;
revoke execute on function public.update_inventory_balance() from public;
