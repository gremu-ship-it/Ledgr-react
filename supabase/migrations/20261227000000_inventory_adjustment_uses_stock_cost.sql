-- Write-offs must be valued at the cost the stock actually carries.
--
-- THE PROBLEM (found via Eagle Nova Horizon, Nov 2026)
-- `record_inventory_journal_movement` takes `unit_cost` from the caller and uses
-- it verbatim for the GL entry:
--
--     DR 5180 Inventory Adjustments  (qty x unit_cost)
--     CR 1141 Trading Stock          (qty x unit_cost)
--
-- while the stock subledger reduces the location's balance by quantity only — a
-- weighted average does not need a price. So the price typed into the manual
-- adjustment form decided how much value left the inventory account, completely
-- independently of what the stock was actually worth.
--
-- In production every manual write-off was priced at a round guess rather than
-- the real average:
--
--   2026-11-22  -1,100 bags @ 5,000.00  -> 5,500,000   (subledger avg 3,636.36)
--   2026-11-23  -1,565 bags @ 5,000.00  -> 7,825,000   (subledger avg 4,404.92)
--   2026-11-14     -90 bags @ 5,000.00  ->   450,000   (subledger avg 4,290.86)
--   2026-11-23     -90 bags @ 3,500.00  ->   315,000   (subledger avg 4,274.06)
--
-- Each of those invented a variance between 1141 and the subledger, which the
-- inventory reconciliation panel then "fixed" with another entry to 5180 —
-- pushing the same loss through cost of sales a second time. Over-writing stock
-- also drives the location average cost up (the balance formula divides the
-- remaining value by a smaller quantity), which is why COGS on later sales
-- drifted to ~4,062/bag on goods that cost ~4,000.
--
-- THE FIX
-- For an outflow, the GL value is `quantity x the location's current average
-- cost`, read from `inventory_balances` at the moment of the write-off. That is
-- the exact value the subledger gives up, so 1141 and the subledger move
-- together and the reconciliation variance stays zero. The caller's `unit_cost`
-- is still stored on the movement row (it is the historical record of what was
-- recorded) but no longer decides the GL amount.
--
-- Inflows keep the caller's cost: adding stock does set the new average, so the
-- recorded cost is the right one.
--
-- `movement_type` now conveys direction. It previously only honoured
-- `adjustment_out`; `transfer_out`, `return_out` and `write_off` are also
-- outflows and were silently treated as inflows (debiting inventory while the
-- trigger removed it), so they are handled here too.
--
-- The advisory lock key is also now derived from the movement direction, so an
-- outflow and an inflow with the same client key cannot collide in a way that
-- the idempotency re-read would misreport as a replay.

create or replace function public.record_inventory_journal_movement(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  v_qty numeric; v_cost numeric; v_gl_cost numeric; v_amount numeric;
  v_avg_cost numeric;
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
    if v_type not in ('adjustment_in', 'adjustment_out', 'purchase', 'opening_balance',
                      'transfer_out', 'return_out', 'write_off') then
      raise exception 'Unsupported adjustment movement type %.', v_type using errcode = '22023';
    end if;
    v_source_type := 'stock_adjustment';
    v_posting_key := 'stock_adjustment:' || v_key::text;
  end if;
  v_out := v_type in ('adjustment_out', 'transfer_out', 'return_out', 'write_off');

  -- Idempotency: serialise on (business, source, key, direction); a replay
  -- returns the committed result, a replay with a different payload is refused.
  perform pg_advisory_xact_lock(hashtextextended(
    v_business::text || '|' || v_source_type || '|' || v_key::text || '|' || case when v_out then 'out' else 'in' end, 0));
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

    -- THE FIX: a write-off is valued at the cost the stock actually carries.
    -- The subledger only reduces quantity, so pricing the GL side off a typed
    -- figure invents a 1141-vs-subledger variance out of thin air.
    if v_out then
      select b.average_cost into v_avg_cost
        from public.inventory_balances b
       where b.business_id = v_business
         and b.product_id = v_product.id
         and b.location_id = v_location;
      -- No usable average (never received here, or genuine zero cost): fall
      -- back to the caller's figure rather than writing the stock off for
      -- nothing and leaving value stranded in 1141.
      v_gl_cost := case when v_avg_cost is null or v_avg_cost <= 0 then v_cost else v_avg_cost end;
    else
      v_gl_cost := v_cost;
    end if;

    insert into public.stock_movements (
      business_id, product_id, location_id, movement_type, movement_date,
      quantity, unit_cost, source_type, source_id, reference, notes, created_by
    ) values (
      v_business, v_product.id, v_location, v_type::public.stock_movement_type, v_date,
      case when v_out then -v_qty else v_qty end, v_gl_cost, v_source_type, v_key,
      v_reference, v_notes, auth.uid()
    ) returning id into v_id;
    v_ids := v_ids || v_id;

    v_amount := round(v_qty * v_gl_cost, 2);
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
$function$;

comment on function public.record_inventory_journal_movement(jsonb) is
  'Records a stock receipt or manual adjustment and its balanced journal entry atomically. '
  'Outflows (adjustment_out, transfer_out, return_out, write_off) are valued at the location''s '
  'current weighted-average cost rather than the caller-supplied figure, so account 1141 and the '
  'stock subledger always give up the same value.';
