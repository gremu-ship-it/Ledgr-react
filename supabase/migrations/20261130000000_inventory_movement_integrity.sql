-- Prevent future duplicate stock movements, enforce stock movement integrity,
-- and create paired transfer movements atomically. Existing movement rows and
-- inventory balances are deliberately left untouched.

-- A transfer id is an explicit, queryable link between the outbound and
-- inbound movement rows. Existing movements remain NULL here by design.
alter table public.stock_movements
  add column if not exists transfer_id uuid references public.stock_transfers(id);

create index if not exists stock_movements_transfer_id_idx
  on public.stock_movements (business_id, transfer_id, movement_type)
  where transfer_id is not null;

-- Serialize writes that represent the same source/product/location tuple.
-- Returning NULL from this BEFORE INSERT trigger skips a retry without editing
-- the already-recorded movement or firing the balance trigger a second time.
create or replace function public._ledgr_guard_stock_movement_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identity text;
begin
  if new.movement_type::text in ('adjustment_in', 'adjustment_out')
     and nullif(btrim(coalesce(new.reference, '')), '') is null
     and nullif(btrim(coalesce(new.notes, '')), '') is null then
    raise exception 'inventory-adjustment-reason-required' using errcode = '22023';
  end if;

  if new.movement_type::text in ('sale', 'purchase')
     and new.source_type is not null and new.source_id is not null then
    v_identity := concat_ws('|', new.business_id::text, new.source_type,
      new.source_id, new.product_id::text, new.location_id::text);
    perform pg_advisory_xact_lock(hashtextextended(v_identity, 0));

    if exists (
      select 1
        from public.stock_movements sm
       where sm.business_id = new.business_id
         and sm.source_type = new.source_type
         and sm.source_id = new.source_id
         and sm.product_id = new.product_id
         and sm.location_id = new.location_id
    ) then
      return null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public._ledgr_guard_stock_movement_insert() from public, anon, authenticated;

drop trigger if exists trg_stock_movement_integrity_guard on public.stock_movements;
create trigger trg_stock_movement_integrity_guard
before insert on public.stock_movements
for each row execute function public._ledgr_guard_stock_movement_insert();

comment on function public._ledgr_guard_stock_movement_insert() is
  'Blocks future duplicate source/product/location movements under an advisory transaction lock and requires a reference or notes for adjustment movements. Does not change historical rows.';

-- Dispatch is the inventory-commit point: the paired source and destination
-- movements and the transfer status/line quantities commit or roll back as one
-- transaction. Receipt confirmation only records confirmation metadata; it
-- never creates a second stock movement.
create or replace function public.dispatch_stock_transfer_atomically(
  p_transfer_id uuid,
  p_dispatched_by text,
  p_lines jsonb
)
returns public.stock_transfers
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line jsonb;
  v_transfer_line public.stock_transfer_lines%rowtype;
  v_line_id uuid;
  v_quantity numeric;
  v_actor text;
  v_line_count integer;
  v_distinct_line_count integer;
  v_positive_count integer := 0;
  v_existing_count integer;
  v_product_group record;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'inventory-transfer-auth-required' using errcode = '42501';
  end if;

  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id
   for update;
  if not found then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not (
    public.can_write_business_data(v_transfer.business_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.from_location_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.to_location_id)
  ) then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if v_transfer.status::text in ('dispatched', 'received') then
    return v_transfer;
  end if;
  if v_transfer.status::text <> 'approved' then
    raise exception 'stock-transfer-not-approved' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'stock-transfer-lines-required' using errcode = '22023';
  end if;

  select count(*), count(distinct nullif(line->>'line_id', '')::uuid)
    into v_line_count, v_distinct_line_count
    from jsonb_array_elements(p_lines) line;
  if v_line_count <> v_distinct_line_count then
    raise exception 'stock-transfer-duplicate-line' using errcode = '22023';
  end if;
  if v_line_count <> (
    select count(*) from public.stock_transfer_lines where transfer_id = p_transfer_id
  ) then
    raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
  end if;

  select count(*) into v_existing_count
    from public.stock_movements
   where business_id = v_transfer.business_id
     and source_type = 'stock_transfer'
     and source_id = p_transfer_id::text;
  if v_existing_count > 0 then
    -- Preserve existing history. A partially recorded legacy transfer needs
    -- deliberate reconciliation rather than being silently rewritten.
    raise exception 'stock-transfer-movements-already-exist' using errcode = '22023';
  end if;

  v_actor := coalesce(nullif(btrim(p_dispatched_by), ''), auth.uid()::text);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_quantity := nullif(v_line->>'quantity_dispatched', '')::numeric;
    if v_line_id is null or v_quantity is null or v_quantity < 0 then
      raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
    end if;

    select * into v_transfer_line
      from public.stock_transfer_lines
     where id = v_line_id and transfer_id = p_transfer_id
     for update;
    if not found then
      raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
    end if;
    if v_quantity > v_transfer_line.quantity_requested then
      raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
    end if;

    update public.stock_transfer_lines
       set quantity_dispatched = v_quantity
     where id = v_line_id;
    if v_quantity > 0 then
      v_positive_count := v_positive_count + 1;
    end if;
  end loop;

  if v_positive_count = 0 then
    raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
  end if;

  -- Collapse repeated product rows within the transfer into one movement per
  -- product and location. Weighted unit cost preserves the value of all lines.
  for v_product_group in
    select product_id,
           sum(quantity_dispatched) as quantity,
           sum(quantity_dispatched * unit_cost) / nullif(sum(quantity_dispatched), 0) as unit_cost
      from public.stock_transfer_lines
     where transfer_id = p_transfer_id and coalesce(quantity_dispatched, 0) > 0
     group by product_id
  loop
    insert into public.stock_movements (
      business_id, product_id, location_id, movement_type, movement_date,
      quantity, unit_cost, source_type, source_id, reference, created_by,
      transfer_id
    ) values (
      v_transfer.business_id, v_product_group.product_id, v_transfer.from_location_id,
      'transfer_out', current_date, -v_product_group.quantity, v_product_group.unit_cost,
      'stock_transfer', p_transfer_id::text, v_transfer.transfer_number, v_actor,
      p_transfer_id
    );
    insert into public.stock_movements (
      business_id, product_id, location_id, movement_type, movement_date,
      quantity, unit_cost, source_type, source_id, reference, created_by,
      transfer_id
    ) values (
      v_transfer.business_id, v_product_group.product_id, v_transfer.to_location_id,
      'transfer_in', current_date, v_product_group.quantity, v_product_group.unit_cost,
      'stock_transfer', p_transfer_id::text, v_transfer.transfer_number, v_actor,
      p_transfer_id
    );
  end loop;

  update public.stock_transfers
     set status = 'dispatched',
         dispatched_at = now(),
         updated_at = now()
   where id = p_transfer_id
   returning * into v_transfer;
  return v_transfer;
end;
$$;

revoke all on function public.dispatch_stock_transfer_atomically(uuid, text, jsonb) from public, anon;
grant execute on function public.dispatch_stock_transfer_atomically(uuid, text, jsonb) to authenticated, service_role;

create or replace function public.confirm_stock_transfer_receipt_atomically(
  p_transfer_id uuid,
  p_received_by text,
  p_lines jsonb
)
returns public.stock_transfers
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_transfer public.stock_transfers%rowtype;
  v_line jsonb;
  v_transfer_line public.stock_transfer_lines%rowtype;
  v_line_id uuid;
  v_quantity numeric;
  v_actor text;
  v_line_count integer;
  v_distinct_line_count integer;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'inventory-transfer-auth-required' using errcode = '42501';
  end if;
  select * into v_transfer
    from public.stock_transfers
   where id = p_transfer_id
   for update;
  if not found then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not (
    public.can_write_business_data(v_transfer.business_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.from_location_id)
    and public.can_access_location(v_transfer.business_id, v_transfer.to_location_id)
  ) then
    raise exception 'inventory-transfer-not-found' using errcode = '42501';
  end if;
  if v_transfer.status::text = 'received' then
    return v_transfer;
  end if;
  if v_transfer.status::text <> 'dispatched' then
    raise exception 'stock-transfer-not-dispatched' using errcode = '22023';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'stock-transfer-lines-required' using errcode = '22023';
  end if;

  select count(*), count(distinct nullif(line->>'line_id', '')::uuid)
    into v_line_count, v_distinct_line_count
    from jsonb_array_elements(p_lines) line;
  if v_line_count <> v_distinct_line_count or v_line_count <> (
    select count(*) from public.stock_transfer_lines where transfer_id = p_transfer_id
  ) then
    raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
  end if;

  v_actor := coalesce(nullif(btrim(p_received_by), ''), auth.uid()::text);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_line_id := nullif(v_line->>'line_id', '')::uuid;
    v_quantity := nullif(v_line->>'quantity_received', '')::numeric;
    if v_line_id is null or v_quantity is null or v_quantity < 0 then
      raise exception 'stock-transfer-invalid-quantity' using errcode = '22023';
    end if;
    select * into v_transfer_line
      from public.stock_transfer_lines
     where id = v_line_id and transfer_id = p_transfer_id
     for update;
    if not found then
      raise exception 'stock-transfer-lines-mismatch' using errcode = '22023';
    end if;
    if v_quantity <> coalesce(v_transfer_line.quantity_dispatched, 0) then
      raise exception 'inventory-transfer-quantity-mismatch' using errcode = '22023';
    end if;
    update public.stock_transfer_lines
       set quantity_received = v_quantity
     where id = v_line_id;
  end loop;

  update public.stock_transfers
     set status = 'received',
         received_at = now(),
         received_by = nullif(v_actor, '')::uuid,
         updated_at = now()
   where id = p_transfer_id
   returning * into v_transfer;
  return v_transfer;
end;
$$;

revoke all on function public.confirm_stock_transfer_receipt_atomically(uuid, text, jsonb) from public, anon;
grant execute on function public.confirm_stock_transfer_receipt_atomically(uuid, text, jsonb) to authenticated, service_role;

comment on function public.dispatch_stock_transfer_atomically(uuid, text, jsonb) is
  'Atomically records equal transfer_out/transfer_in movements with transfer_id links, guards negative source balances via the canonical balance constraint, and marks the transfer dispatched. Idempotent at the transfer status lock.';
comment on function public.confirm_stock_transfer_receipt_atomically(uuid, text, jsonb) is
  'Atomically confirms receipt quantities already recorded as a paired transfer at dispatch; rejects mismatched quantities and does not add movements.';
