-- POS return command. The tables and locked-down RLS surface are created in
-- 20261210000000_pos_return_tables.sql; this independent migration installs
-- the server command that delegates financial effects to the canonical R07 RPC.

create or replace function public.process_pos_return_command(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid := nullif(p_payload->>'business_id', '')::uuid;
  v_invoice_id uuid := nullif(p_payload->>'invoice_id', '')::uuid;
  v_shift_id uuid := nullif(p_payload->>'shift_id', '')::uuid;
  v_key text := p_payload->>'command_key';
  v_method text := coalesce(p_payload->>'refund_method', 'cash');
  v_reason text := coalesce(nullif(btrim(p_payload->>'reason'), ''), 'Customer return');
  v_approval uuid := nullif(p_payload->>'approval_token', '')::uuid;
  v_plan text;
  v_models text[];
  v_invoice record;
  v_shift record;
  v_original_shift record;
  v_existing_return record;
  v_line jsonb;
  v_invoice_line record;
  v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_refund_lines jsonb := '[]'::jsonb;
  v_refund_line jsonb;
  v_amount numeric;
  v_raw_amount numeric;
  v_raw_total numeric := 0;
  v_prior_refund numeric := 0;
  v_available_refund numeric := 0;
  v_total numeric := 0;
  v_line_total numeric := 0;
  v_amount_scale numeric := 1;
  v_prior_qty numeric;
  v_qty numeric;
  v_line_reason text;
  v_product_id uuid;
  v_restock boolean;
  v_tender uuid;
  v_cash_account uuid;
  v_cash_out numeric := 0;
  v_result jsonb;
  v_return_id uuid;
  v_correction_id uuid;
  v_return_number text;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to process a POS return.' using errcode = '42501';
  end if;
  if v_business is null or v_invoice_id is null or v_shift_id is null
     or v_key is null or length(v_key) < 4 or length(v_key) > 64 then
    raise exception 'business_id, invoice_id, shift_id and a valid command_key are required.' using errcode = '22023';
  end if;
  if not public.can_operate_pos(v_business) then
    raise exception 'Caller may not operate POS in this business.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_business::text || ':' || v_key, 0));

  -- Tenant-scoped replay check; a committed command must replay its printable
  -- voucher even after the originating shift has subsequently been closed.
  select * into v_existing_return from public.pos_returns r
   where r.business_id = v_business and r.command_key = v_key;
  if found then
    select * into v_original_shift from public.pos_shifts
     where id = v_existing_return.shift_id and business_id = v_business;
    if not found or not public.can_access_branch(v_business, v_original_shift.branch_id) then
      raise exception 'Caller has no access to the return voucher branch.' using errcode = '42501';
    end if;
    if v_original_shift.cashier_id is distinct from auth.uid() and not exists (
      select 1 from public.business_users bu
       where bu.business_id = v_business and bu.user_id = auth.uid()
         and bu.is_active = true and bu.role::text in ('owner','admin','manager')
    ) then
      raise exception 'Only the shift cashier or a business manager may access this return voucher.' using errcode = '42501';
    end if;
    return jsonb_build_object('return_id', v_existing_return.id, 'return_number', v_existing_return.return_number,
      'amount', v_existing_return.amount, 'refund_method', v_existing_return.refund_method, 'idempotent', true,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'invoice_line_id', rl.invoice_line_id, 'quantity', rl.quantity, 'amount', rl.refund_amount,
        'reason', rl.reason, 'restock', rl.restock) order by rl.created_at), '[]'::jsonb)
        from public.pos_return_lines rl where rl.return_id = v_existing_return.id));
  end if;

  select * into v_shift from public.pos_shifts
   where id = v_shift_id and business_id = v_business for update;
  if not found or v_shift.status <> 'open' then
    raise exception 'Returns require an open shift in this business.' using errcode = '22023';
  end if;
  if not public.can_access_branch(v_business, v_shift.branch_id) then
    raise exception 'Caller has no access to this register branch.' using errcode = '42501';
  end if;
  if v_shift.cashier_id is distinct from auth.uid() and not exists (
    select 1 from public.business_users bu
     where bu.business_id = v_business and bu.user_id = auth.uid()
       and bu.is_active = true and bu.role::text in ('owner','admin','manager')
  ) then
    raise exception 'Only the shift cashier or a business manager may process a return on this shift.' using errcode = '42501';
  end if;
  -- Serialize same-key retries behind the active shift row lock as well.
  select * into v_existing_return from public.pos_returns r
   where r.business_id = v_business and r.command_key = v_key;
  if found then
    if v_existing_return.shift_id <> v_shift_id then
      select * into v_original_shift from public.pos_shifts
       where id = v_existing_return.shift_id and business_id = v_business;
      if not found or not public.can_access_branch(v_business, v_original_shift.branch_id) then
        raise exception 'Caller has no access to the return voucher branch.' using errcode = '42501';
      end if;
      if v_original_shift.cashier_id is distinct from auth.uid() and not exists (
        select 1 from public.business_users bu
         where bu.business_id = v_business and bu.user_id = auth.uid()
           and bu.is_active = true and bu.role::text in ('owner','admin','manager')
      ) then
        raise exception 'Only the shift cashier or a business manager may access this return voucher.' using errcode = '42501';
      end if;
    end if;
    return jsonb_build_object('return_id', v_existing_return.id, 'return_number', v_existing_return.return_number,
      'amount', v_existing_return.amount, 'refund_method', v_existing_return.refund_method, 'idempotent', true,
      'lines', (select coalesce(jsonb_agg(jsonb_build_object(
        'invoice_line_id', rl.invoice_line_id, 'quantity', rl.quantity, 'amount', rl.refund_amount,
        'reason', rl.reason, 'restock', rl.restock) order by rl.created_at), '[]'::jsonb)
        from public.pos_return_lines rl where rl.return_id = v_existing_return.id));
  end if;
  select * into v_shift from public.pos_shifts
   where id = v_shift_id and business_id = v_business;

  select public.effective_plan_tier(b.plan_tier, b.plan_expires_at), b.operating_models
    into v_plan, v_models
    from public.businesses b where b.id = v_business;
  if not coalesce('RETAIL' = any(v_models), false) then
    raise exception 'POS returns are available only to retail businesses.' using errcode = '42501';
  end if;
  if public.plan_tier_rank(v_plan) < public.plan_tier_rank('starter') then
    raise exception 'POS returns require the Starter plan or higher.' using errcode = '42501';
  end if;
  if v_method not in ('cash', 'original', 'credit') then
    raise exception 'Choose cash, original payment, or store credit.' using errcode = '22023';
  end if;
  if v_method = 'credit' and public.plan_tier_rank(v_plan) < public.plan_tier_rank('growth') then
    raise exception 'Store credit requires the Growth plan or higher.' using errcode = '42501';
  end if;

  select * into v_invoice from public.invoices i
   where i.id = v_invoice_id and i.business_id = v_business and i.deleted_at is null
   for update;
  if not found or v_invoice.status::text <> 'paid'
     or coalesce(v_invoice.invoice_type, 'invoice') <> 'invoice'
     or v_invoice.pos_shift_id is null then
    raise exception 'Choose a completed POS sale to return.' using errcode = '22023';
  end if;
  if v_invoice.branch_id is distinct from v_shift.branch_id then
    raise exception 'Process the return at the branch where the sale was posted.' using errcode = '22023';
  end if;
  if v_plan = 'starter' and v_invoice.pos_shift_id <> v_shift_id then
    raise exception 'Starter returns are limited to sales from the active shift.' using errcode = '42501';
  end if;
  if v_invoice.pos_shift_id <> v_shift_id then
    if public.plan_tier_rank(v_plan) < public.plan_tier_rank('growth') then
      raise exception 'Historical receipt returns require the Growth plan or higher.' using errcode = '42501';
    end if;
    select * into v_original_shift from public.pos_shifts
     where id = v_invoice.pos_shift_id and business_id = v_business;
    if not found or v_original_shift.status <> 'closed' then
      raise exception 'Cross-shift returns are available only for completed, closed shifts.' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Select at least one item quantity to return.' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_lines) as requested(line)
     group by requested.line->>'invoice_line_id' having count(*) > 1
  ) then
    raise exception 'A sale line may only appear once in a return.' using errcode = '22023';
  end if;
  select coalesce(sum(il.line_total), 0) into v_line_total
    from public.invoice_lines il
   where il.business_id = v_business and il.invoice_id = v_invoice_id;
  if v_line_total <= 0 or v_invoice.total_amount <= 0 then
    raise exception 'The selected sale has no refundable line value.' using errcode = '22023';
  end if;
  -- Allocate invoice-level/order discounts proportionally across the receipt
  -- lines so a full return never exceeds the original posted amount.
  v_amount_scale := v_invoice.total_amount / v_line_total;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_qty := coalesce(nullif(v_line->>'quantity', '')::numeric, 0);
    v_restock := coalesce((v_line->>'restock')::boolean, true);
    v_line_reason := nullif(btrim(v_line->>'reason'), '');
    if v_line_reason is null then
      raise exception 'Add a reason for every returned item.' using errcode = '22023';
    end if;
    if v_qty <= 0 then
      raise exception 'Return quantities must be positive.' using errcode = '22023';
    end if;
    select il.id, il.product_id, il.description, il.quantity, il.unit_price, il.line_total
      into v_invoice_line from public.invoice_lines il
     where il.id = nullif(v_line->>'invoice_line_id', '')::uuid
       and il.invoice_id = v_invoice_id and il.business_id = v_business;
    if not found or v_invoice_line.quantity <= 0 then
      raise exception 'A selected item does not belong to this sale.' using errcode = '22023';
    end if;
    v_product_id := v_invoice_line.product_id;

    select coalesce(sum(prl.quantity), 0) into v_prior_qty
      from public.pos_return_lines prl
      join public.pos_returns pr on pr.id = prl.return_id
     where pr.business_id = v_business and pr.invoice_id = v_invoice_id
       and prl.invoice_line_id = v_invoice_line.id;
    -- Count pre-feature R07 returns that have no line-level audit row yet.
    select v_prior_qty + coalesce(sum((x.line->>'quantity')::numeric), 0) into v_prior_qty
      from public.pos_corrections c
      cross join lateral jsonb_array_elements(c.lines) as x(line)
     where c.business_id = v_business and c.document_id = v_invoice_id
       and c.command_type = 'refund_sale'
       and not exists (select 1 from public.pos_returns pr
                        where pr.business_id = c.business_id and pr.command_key = c.command_key)
       and nullif(x.line->>'product_id', '')::uuid is not distinct from v_product_id;
    if v_prior_qty + v_qty > v_invoice_line.quantity + 0.000001 then
      raise exception 'The selected return quantity exceeds the quantity remaining for %.',
        coalesce(v_invoice_line.description, 'this item') using errcode = '22023';
    end if;

    v_raw_amount := (v_invoice_line.line_total / v_invoice_line.quantity) * v_qty * v_amount_scale;
    if v_raw_amount <= 0 then
      raise exception 'The selected item has no refundable value.' using errcode = '22023';
    end if;
    v_raw_total := v_raw_total + v_raw_amount;
    v_count := v_count + 1;
    v_refund_lines := v_refund_lines || jsonb_build_array(jsonb_build_object(
      'product_id', case when v_restock then v_product_id else null end,
      'quantity', case when v_restock and v_product_id is not null then v_qty else 0 end,
      'amount', v_raw_amount,
      'raw_amount', v_raw_amount,
      'invoice_line_id', v_invoice_line.id,
      'returned_quantity', v_qty,
      'restock', v_restock,
      'reason', v_line_reason
    ));
  end loop;

  if v_count = 0 or v_raw_total <= 0 then
    raise exception 'The return must include a refundable item.' using errcode = '22023';
  end if;

  -- Use a largest-remainder allocation in cents. Rounding each receipt line
  -- independently can make a full multi-line return miss the invoice total by
  -- several cents; allocating the rounded command total keeps the voucher,
  -- correction and line audit exactly balanced. Never exceed the paid amount
  -- remaining after earlier legacy or new refund commands.
  select coalesce(sum(c.amount), 0) into v_prior_refund
    from public.pos_corrections c
   where c.business_id = v_business and c.document_id = v_invoice_id
     and c.command_type = 'refund_sale';
  v_available_refund := greatest(v_invoice.total_amount - v_prior_refund, 0);
  if round(v_raw_total, 2) > v_available_refund + 0.005 then
    raise exception 'The selected line refund exceeds the remaining refundable sale amount.' using errcode = '22023';
  end if;
  v_total := least(round(v_raw_total, 2), v_available_refund);
  if v_total <= 0 then
    raise exception 'No refundable amount remains for this sale.' using errcode = '22023';
  end if;
  with raw_lines as (
    select e.line, e.ordinality,
           ((e.line->>'raw_amount')::numeric * v_total / v_raw_total) as scaled_amount
      from jsonb_array_elements(v_refund_lines) with ordinality as e(line, ordinality)
  ), floored as (
    select line, ordinality,
           floor(scaled_amount * 100) / 100 as base_amount,
           scaled_amount * 100 - floor(scaled_amount * 100) as fraction
      from raw_lines
  ), ranked as (
    select line, ordinality, base_amount, fraction,
           row_number() over (order by fraction desc, ordinality) as allocation_rank,
           round((v_total - sum(base_amount) over ()) * 100)::integer as extra_cents
      from floored
  )
  select coalesce(jsonb_agg(
           (jsonb_set(line, '{amount}', to_jsonb(base_amount +
             case when allocation_rank <= extra_cents then 0.01::numeric else 0::numeric end)) - 'raw_amount')
           order by ordinality), '[]'::jsonb)
    into v_refund_lines
    from ranked;
  if exists (select 1 from jsonb_array_elements(v_refund_lines) as e(line)
              where (e.line->>'amount')::numeric <= 0) then
    raise exception 'Each selected return line must have a refundable value of at least one cent.' using errcode = '22023';
  end if;

  if v_method = 'cash' then
    v_tender := public._ledgr_account_by_code(v_business, '1110');
  elsif v_method = 'credit' then
    v_tender := public._ledgr_account_by_code(v_business, '2113');
    if v_tender is null then
      raise exception 'Customer Deposits & Advances (account 2113) is not configured for store credit.' using errcode = '22023';
    end if;
  end if;

  v_result := public.refund_pos_sale_command(jsonb_build_object(
    'business_id', v_business,
    'invoice_id', v_invoice_id,
    'command_key', v_key,
    'reason', v_reason,
    'approval_token', v_approval,
    'tender_account_id', v_tender,
    'lines', v_refund_lines
  ));
  select c.id into v_correction_id from public.pos_corrections c
   where c.business_id = v_business and c.command_key = v_key;
  v_return_number := 'RET-' || to_char(current_date, 'YYYYMMDD') || '-' ||
                     lpad(nextval('public.pos_return_number_seq')::text, 6, '0');
  insert into public.pos_returns (
    business_id, shift_id, invoice_id, correction_id, command_key, return_number,
    refund_method, amount, currency, reason, created_by
  ) values (
    v_business, v_shift_id, v_invoice_id, v_correction_id, v_key, v_return_number,
    v_method, v_total, v_invoice.currency, v_reason, auth.uid()
  ) returning id into v_return_id;

  for v_refund_line in select * from jsonb_array_elements(v_refund_lines) loop
    select il.id, il.product_id, il.description
      into v_invoice_line from public.invoice_lines il
     where il.id = (v_refund_line->>'invoice_line_id')::uuid and il.invoice_id = v_invoice_id;
    v_qty := (v_refund_line->>'returned_quantity')::numeric;
    v_amount := (v_refund_line->>'amount')::numeric;
    insert into public.pos_return_lines (
      business_id, return_id, invoice_line_id, product_id, product_name,
      quantity, refund_amount, reason, restock
    ) values (
      v_business, v_return_id, v_invoice_line.id, v_invoice_line.product_id,
      coalesce(v_invoice_line.description, 'Product'), v_qty, v_amount,
      v_refund_line->>'reason', (v_refund_line->>'restock')::boolean
    );
  end loop;

  -- R08 closes the active drawer from the settlement journal plus movements.
  -- A cross-shift return must be attributed to this active drawer, not the
  -- already-closed sale shift. Derive its cash effect from the exact settlement
  -- journal account (so original-payment refunds to banks/credit are not cash).
  if v_invoice.pos_shift_id <> v_shift_id then
    v_cash_account := public._ledgr_account_by_code(v_business, '1110');
    select coalesce(sum(jl.amount), 0) into v_cash_out
      from public.journal_lines jl
     where jl.journal_entry_id = nullif(v_result->>'journal_entry_id', '')::uuid
       and jl.account_id = v_cash_account and not jl.is_debit;
    if v_cash_out > 0 then
      insert into public.pos_cash_movements (
        business_id, branch_id, shift_id, user_id, user_name,
        movement_type, amount, reason, command_key
      ) values (
        v_business, v_shift.branch_id, v_shift_id, auth.uid(),
        public._ledgr_pos_actor_name(auth.uid()), 'cash_out', v_cash_out,
        'Customer return ' || v_return_number, 'return:' || md5(v_key)
      );
    end if;
  end if;

  return jsonb_build_object(
    'return_id', v_return_id,
    'return_number', v_return_number,
    'amount', v_total,
    'refund_method', v_method,
    'correction_id', v_correction_id,
    'journal_entry_id', v_result->'journal_entry_id',
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
      'invoice_line_id', rl.invoice_line_id, 'quantity', rl.quantity, 'amount', rl.refund_amount,
      'reason', rl.reason, 'restock', rl.restock) order by rl.created_at), '[]'::jsonb)
      from public.pos_return_lines rl where rl.return_id = v_return_id),
    'idempotent', false
  );
end;
$$;

revoke all on function public.process_pos_return_command(jsonb) from public, anon;
grant execute on function public.process_pos_return_command(jsonb) to authenticated;
comment on function public.process_pos_return_command(jsonb) is
  'POS return orchestration. Retail-only and plan-gated; validates shift and unreturned line quantities; records per-line reason/restock audit; delegates all journal, stock, COGS and approval effects to the canonical R07 refund_pos_sale_command in the same transaction.';
