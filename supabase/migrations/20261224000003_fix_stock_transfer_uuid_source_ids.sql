-- Fix dispatch_stock_transfer_atomically for both repository TEXT and
-- production UUID stock_movements.source_id/created_by column shapes.
-- The original code compared uuid source_id to p_transfer_id::text and wrote
-- TEXT actors into UUID created_by columns on production.

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
  v_source_id_is_uuid boolean;
  v_created_by_is_uuid boolean;
  v_uuid_columns boolean;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'inventory-transfer-auth-required' using errcode = '42501';
  end if;

  -- Production has UUID source_id/created_by while clean repository replays
  -- retain TEXT columns. Detect the known paired shape so each INSERT uses
  -- values of the target column type without unsafe implicit casts.
  select (
    select a.atttypid = 'uuid'::regtype
      from pg_attribute a
     where a.attrelid = 'public.stock_movements'::regclass
       and a.attname = 'source_id' and a.attnum > 0 and not a.attisdropped
  ), (
    select a.atttypid = 'uuid'::regtype
      from pg_attribute a
     where a.attrelid = 'public.stock_movements'::regclass
       and a.attname = 'created_by' and a.attnum > 0 and not a.attisdropped
  ) into v_source_id_is_uuid, v_created_by_is_uuid;
  if v_source_id_is_uuid is null or v_created_by_is_uuid is null
     or v_source_id_is_uuid <> v_created_by_is_uuid then
    raise exception 'stock-transfer-unsupported-stock-movement-schema' using errcode = '55000';
  end if;
  v_uuid_columns := v_source_id_is_uuid;

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
     and source_id::text = p_transfer_id::text;
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
    if v_uuid_columns then
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by,
        transfer_id
      ) values (
        v_transfer.business_id, v_product_group.product_id, v_transfer.from_location_id,
        'transfer_out', current_date, -v_product_group.quantity, v_product_group.unit_cost,
        'stock_transfer', p_transfer_id, v_transfer.transfer_number, nullif(v_actor, '')::uuid,
        p_transfer_id
      );
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by,
        transfer_id
      ) values (
        v_transfer.business_id, v_product_group.product_id, v_transfer.to_location_id,
        'transfer_in', current_date, v_product_group.quantity, v_product_group.unit_cost,
        'stock_transfer', p_transfer_id, v_transfer.transfer_number, nullif(v_actor, '')::uuid,
        p_transfer_id
      );
    else
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
    end if;
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
