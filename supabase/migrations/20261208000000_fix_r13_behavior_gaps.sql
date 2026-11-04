-- R13 behavior gaps: retain the established guards while allowing only
-- explicitly evidenced construction receipt deltas, and preserve an audit
-- reference for legacy inventory-adjustment callers that omit one.
-- Reapplying this migration is safe: all three definitions are replacements.

create or replace function public.record_inventory_journal_movement(p_payload jsonb)
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_business uuid := nullif(p_payload->>'business_id', '')::uuid;
  v_kind text := p_payload->>'kind';
  v_key uuid := nullif(btrim(coalesce(p_payload->>'client_key', '')), '')::uuid;
  v_location uuid := nullif(p_payload->>'location_id', '')::uuid;
  v_date date := coalesce(nullif(p_payload->>'movement_date', '')::date, current_date);
  v_type text := coalesce(nullif(p_payload->>'movement_type', ''), 'purchase');
  v_reference text := nullif(p_payload->>'reference', '');
  v_notes text := nullif(p_payload->>'notes', '');
  v_lines jsonb := p_payload->'lines';
  v_source_type text;
  v_posting_key text;
  v_out boolean;
  v_line jsonb;
  v_product public.products%rowtype;
  v_qty numeric; v_cost numeric; v_amount numeric;
  v_inv_account uuid;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_debits jsonb := '{}'::jsonb;  -- inventory account -> amount
  v_total numeric := 0;
  v_counter uuid;
  v_jlines jsonb := '[]'::jsonb;
  v_acc record;
  v_entry uuid;
  v_currency text;
  v_existing_n int; v_existing_q numeric; v_in_q numeric;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if v_business is null or v_location is null or v_key is null
     or v_kind not in ('receipt', 'adjustment')
     or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Malformed inventory movement payload.' using errcode = '22023';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and not (
       public.can_write_business_data(v_business)
       and public.can_access_location(v_business, v_location)) then
    raise exception 'You lack permission to move stock at this location.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.inventory_locations where id = v_location and business_id = v_business) then
    raise exception 'Location does not belong to this business.' using errcode = '42501';
  end if;

  if v_kind = 'receipt' then
    v_type := 'purchase'; v_source_type := 'stock_receipt';
    v_posting_key := 'stock_receipt:' || v_key::text || ':grni';
  else
    if v_type not in ('adjustment_in', 'adjustment_out', 'purchase', 'opening_balance') then
      raise exception 'Unsupported adjustment movement type %.', v_type using errcode = '22023';
    end if;
    v_source_type := 'stock_adjustment';
    v_posting_key := 'stock_adjustment:' || v_key::text;
    -- The 20261130000000 movement-integrity guard requires adjustment
    -- provenance. A stable generated reference keeps legacy callers valid
    -- without bypassing that guard when they omit an optional reference.
    v_reference := coalesce(nullif(btrim(v_reference), ''), 'Stock adjustment ' || v_key::text);
  end if;
  v_out := v_type = 'adjustment_out';

  -- Idempotency: serialise on (business, source, key); a replay returns the
  -- committed result, a replay with a different payload is refused.
  perform pg_advisory_xact_lock(hashtextextended(v_business::text || '|' || v_source_type || '|' || v_key::text, 0));
  select count(*), coalesce(sum(abs(quantity)), 0) into v_existing_n, v_existing_q
    from public.stock_movements
   where business_id = v_business and source_type = v_source_type and source_id::text = v_key::text;
  if v_existing_n > 0 then
    select coalesce(sum(abs((l->>'quantity')::numeric)), 0) into v_in_q from jsonb_array_elements(v_lines) l;
    if v_existing_n <> jsonb_array_length(v_lines) or abs(v_existing_q - v_in_q) > 0.0001 then
      raise exception 'client_key % was already used for a different stock movement.', v_key using errcode = '22023';
    end if;
    select id into v_entry from public.journal_entries where business_id = v_business and posting_key = v_posting_key;
    select array_agg(id order by created_at, id) into v_ids from public.stock_movements
     where business_id = v_business and source_type = v_source_type and source_id::text = v_key::text;
    return jsonb_build_object('idempotent', true, 'movement_ids', to_jsonb(v_ids), 'journal_entry_id', v_entry);
  end if;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    v_qty := (v_line->>'quantity')::numeric;
    v_cost := coalesce((v_line->>'unit_cost')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_cost < 0 then
      raise exception 'Each line needs a positive quantity and a non-negative unit cost.' using errcode = '22023';
    end if;
    select * into v_product from public.products
     where id = nullif(v_line->>'product_id', '')::uuid and business_id = v_business;
    if not found then
      raise exception 'A line references a product that does not belong to this business.' using errcode = '42501';
    end if;

    insert into public.stock_movements (
      business_id, product_id, location_id, movement_type, movement_date,
      quantity, unit_cost, source_type, source_id, reference, notes, created_by
    ) values (
      v_business, v_product.id, v_location, v_type::public.stock_movement_type, v_date,
      case when v_out then -v_qty else v_qty end, v_cost, v_source_type, v_key,
      v_reference, v_notes, auth.uid()
    ) returning id into v_id;
    v_ids := v_ids || v_id;

    v_amount := round(v_qty * v_cost, 2);
    if coalesce(v_product.track_inventory, true) and v_amount >= 0.005 then
      select a.id into v_inv_account from public.accounts a
       where a.id = v_product.inventory_account_id and a.business_id = v_business and not a.is_group;
      if v_inv_account is null then
        v_inv_account := public._ledgr_account_by_code(v_business, '1141');
      end if;
      v_debits := jsonb_set(v_debits, array[v_inv_account::text],
        to_jsonb(coalesce((v_debits->>v_inv_account::text)::numeric, 0) + v_amount));
      v_total := v_total + v_amount;
    end if;
  end loop;

  if v_total >= 0.005 then
    v_counter := public._ledgr_account_by_code(v_business, case when v_kind = 'receipt' then '2114' else '5180' end);
    for v_acc in select key::uuid as account_id, value::numeric as amount from jsonb_each_text(v_debits) loop
      v_jlines := v_jlines || jsonb_build_array(jsonb_build_object(
        'account_id', v_acc.account_id, 'is_debit', not v_out,
        'description', coalesce(v_reference, initcap(replace(v_source_type, '_', ' '))) || ' — inventory',
        'amount', v_acc.amount, 'amount_base', v_acc.amount));
    end loop;
    v_jlines := v_jlines || jsonb_build_array(jsonb_build_object(
      'account_id', v_counter, 'is_debit', v_out,
      'description', coalesce(v_reference, initcap(replace(v_source_type, '_', ' '))) ||
        case when v_kind = 'receipt' then ' — goods received not invoiced' else ' — inventory adjustment' end,
      'amount', v_total, 'amount_base', v_total));
    select base_currency into v_currency from public.businesses where id = v_business;
    v_entry := public._ledgr_post_entry_keyed(
      v_business, v_posting_key, v_date,
      case when v_kind = 'receipt' then coalesce(v_notes, v_reference, 'Stock receipt')
           else coalesce(v_reference, 'Stock adjustment') end,  -- legacy client descriptions
      v_source_type, v_key::text, v_currency, 1, null, null, v_jlines);
  end if;

  return jsonb_build_object('idempotent', false, 'movement_ids', to_jsonb(v_ids), 'journal_entry_id', v_entry);
end;
$$;

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
    ) and not (
      new.source_type = 'construction_grn'
      and current_setting('ledgr.construction_command', true) = 'receipt_post'
    ) then
      return null;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.post_construction_receipt_movement(p_grn_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_grn      public.construction_goods_receipt_notes%rowtype;
  v_actor    uuid;
  v_policy   public.construction_receipt_posting_policies%rowtype;
  v_line     public.construction_goods_receipt_lines%rowtype;
  v_covered  numeric;
  v_weighted numeric;
  v_cost_sum numeric;
  v_moved    integer := 0;
  v_movement_id uuid;
  v_delta       numeric;
begin
  if p_grn_id is null then
    raise exception 'A goods receipt is required.' using errcode = '22023';
  end if;

  select * into v_grn from public.construction_goods_receipt_notes where id = p_grn_id for update;
  if not found then
    raise exception 'Goods receipt not found.' using errcode = '42501';
  end if;

  v_actor := public._ledgr_construction_actor(v_grn.business_id, 'procurement.receipt.post');
  if not public.can_access_branch(v_grn.business_id, v_grn.branch_id) then
    raise exception 'You do not have access to that branch.' using errcode = '42501';
  end if;
  if not public.can_access_location(v_grn.business_id, v_grn.location_id) then
    raise exception 'You do not have access to that inventory location.' using errcode = '42501';
  end if;

  -- What has already reached stock is tracked per receipt line, so a second call
  -- posts only the difference (normally nothing at all) and a quality release
  -- made AFTER a posting is still posted instead of being silently stranded. The
  -- GRN row is locked above, so a concurrent pair serialises and the loser sees
  -- an empty delta.

  select * into v_policy from public.construction_receipt_posting_policies where business_id = v_grn.business_id;
  if not found or not v_policy.movement_posting_enabled then
    raise exception 'receipt-posting-not-approved: receipt movement posting has no approved accounting policy for this business.'
      using errcode = '22023';
  end if;
  if v_policy.gl_posting_enabled then
    raise exception 'receipt-gl-posting-not-approved: GL posting from a goods receipt is not approved.' using errcode = '22023';
  end if;

  -- The period lock is absolute: a receipt dated inside a closed period is
  -- denied here, and this file never reopens a period.
  perform public._ledgr_assert_period_open(v_grn.business_id, v_grn.receipt_date, 'Goods receipt movement');

  -- Coverage is all-or-nothing for every line that still has an unposted accepted
  -- quantity: a partially costed line is never posted, so no quantity reaches
  -- stock at an unknown cost. The check runs for the WHOLE receipt before any
  -- movement is written, so a failure posts nothing at all.
  for v_line in
    select * from public.construction_goods_receipt_lines l
     where l.grn_id = v_grn.id order by l.line_number
  loop
    if v_line.accepted_base > v_line.quantity_posted_base then
      select coalesce(sum(c.quantity_base), 0) into v_covered
        from public.construction_receipt_cost_bases c where c.grn_line_id = v_line.id;
      if v_covered < v_line.accepted_base then
        raise exception 'receipt-cost-basis-incomplete: receipt line % has an accepted quantity of % but only % has an evidenced cost basis. Nothing was posted.',
          v_line.line_number, v_line.accepted_base, v_covered using errcode = '22023';
      end if;
    end if;
  end loop;

  for v_line in
    select * from public.construction_goods_receipt_lines l
     where l.grn_id = v_grn.id order by l.line_number
  loop
    v_delta := v_line.accepted_base - v_line.quantity_posted_base;
    if v_delta > 0 then
      select coalesce(sum(c.quantity_base * c.unit_cost_base), 0),
             nullif(sum(c.quantity_base), 0)
        into v_cost_sum, v_weighted
        from public.construction_receipt_cost_bases c where c.grn_line_id = v_line.id;
      if v_weighted is null or v_cost_sum <= 0 then
        raise exception 'receipt-cost-basis-incomplete: receipt line % has no evidenced cost.', v_line.line_number
          using errcode = '22023';
      end if;

      -- Only public.stock_movements is written. The shared R06 balance writer
      -- propagates the balance; this file never touches inventory_balances.
      perform set_config('ledgr.construction_command', 'receipt_post', true);
      insert into public.stock_movements
        (business_id, product_id, location_id, movement_type, movement_date, quantity,
         unit_cost, source_type, source_id, reference, created_by, notes)
      values (v_grn.business_id, v_line.product_id, v_grn.location_id, 'purchase', v_grn.receipt_date,
              v_delta, v_cost_sum / v_weighted, 'construction_grn', v_grn.id,
              v_grn.grn_number, v_actor,
              'Construction goods receipt ' || v_grn.grn_number || ' line ' || v_line.line_number)
      returning id into v_movement_id;
      perform set_config('ledgr.construction_command', '', true);

      perform set_config('ledgr.construction_command', 'receipt_post', true);
      update public.construction_goods_receipt_lines
         set quantity_posted_base = quantity_posted_base + v_delta
       where id = v_line.id;
      perform set_config('ledgr.construction_command', '', true);

      v_moved := v_moved + 1;
    end if;
  end loop;

  if v_moved = 0 then
    return jsonb_build_object('id', v_grn.id, 'movements', 0, 'idempotent', true,
                              'journal_effect', 'none');
  end if;
  return jsonb_build_object('id', v_grn.id, 'movements', v_moved, 'idempotent', false,
                            'journal_effect', 'none');
end;
$$;
