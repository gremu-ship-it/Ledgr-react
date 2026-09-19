-- ============================================================================
-- PROTOTYPE — NOT A MIGRATION. NOT DEPLOYED. NOTHING CALLS THIS.
--
-- Verified prototype of the server-side POS posting path described in
-- docs/database/pos-sale-posting-rpc.md. It lives outside supabase/migrations
-- on purpose: it must not reach an environment until the client is switched
-- over to it (stage 2 of that document), because on its own it changes
-- nothing and an unexercised SECURITY DEFINER function in production is just
-- surface area.
--
-- To promote it: move to supabase/migrations/<timestamp>_post_pos_sale_rpc.sql,
-- switch commitPosSaleDocuments() to call it, ship that, and only then apply
-- the policy narrowing (stage 3).
--
-- Covers the SALE case only. Refund (credit note) and void (reversal) need
-- the same treatment — see section 2 of the design document.
-- ============================================================================

-- ── guards ──────────────────────────────────────────────────────────────────

-- Who may operate a till. Sales-side writer tier; stock_clerk is excluded
-- (no sales duty), viewer/auditor/payroll_manager/board_member too.
create or replace function public.can_operate_pos(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_users bu
    where bu.business_id = p_business_id and bu.user_id = auth.uid() and bu.is_active = true
      and bu.role::text in ('owner','admin','cashier','manager','sales_clerk','sales_manager','branch_manager','customer_service_rep')
  );
$$;

-- Who may write sales documents and the ledger DIRECTLY (table policies).
-- After the lockout this excludes cashier and stock_clerk: a cashier's writes
-- go through post_pos_sale() instead.
create or replace function public.can_write_ledger_directly(p_business_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_users bu
    where bu.business_id = p_business_id and bu.user_id = auth.uid() and bu.is_active = true
      and bu.role::text in ('owner','admin','accountant','supervisor','data_entry','inventory_manager',
                            'sales_clerk','purchasing_officer','warehouse_worker','sales_manager',
                            'customer_service_rep','tax_compliance_officer','treasury_manager',
                            'asset_manager','branch_manager','manager')
  );
$$;

revoke all on function public.can_operate_pos(uuid) from public;
revoke all on function public.can_write_ledger_directly(uuid) from public;
grant execute on function public.can_operate_pos(uuid) to authenticated, service_role;
grant execute on function public.can_write_ledger_directly(uuid) to authenticated, service_role;

-- ── keyed posting helper: resume-or-post by posting_key ─────────────────────

create or replace function public._ledgr_post_entry_keyed(
  p_business_id uuid, p_posting_key text, p_entry_date date, p_description text,
  p_source_type text, p_source_id text, p_currency text, p_exchange_rate numeric,
  p_branch_id uuid, p_department_id uuid, p_lines jsonb
) returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_id uuid; v_no text;
begin
  select id into v_id from public.journal_entries
   where business_id = p_business_id and posting_key = p_posting_key limit 1;
  if found then return v_id; end if;

  v_no := public.next_journal_entry_number(p_business_id);
  v_id := public._ledgr_post_entry(p_business_id, v_no, p_entry_date, p_description,
            p_source_type, p_source_id, p_currency, p_exchange_rate,
            p_branch_id, p_department_id, p_lines);
  update public.journal_entries set posting_key = p_posting_key where id = v_id;
  return v_id;
end; $$;

revoke all on function public._ledgr_post_entry_keyed(uuid,text,date,text,text,text,text,numeric,uuid,uuid,jsonb) from public;

-- ── the RPC ─────────────────────────────────────────────────────────────────

create or replace function public.post_pos_sale(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_business_id uuid := (p_payload->>'business_id')::uuid;
  v_client_key uuid := (p_payload->>'client_key')::uuid;
  v_invoice jsonb := p_payload->'invoice';
  v_lines jsonb := p_payload->'lines';
  v_payments jsonb := coalesce(p_payload->'payments', '[]'::jsonb);
  v_stock jsonb := coalesce(p_payload->'stock_lines', '[]'::jsonb);
  v_number text;
  v_invoice_id uuid;
  v_existing record;
  v_payment jsonb;
  v_payment_key uuid;
  v_tender uuid;
  v_paid numeric := 0;
  v_total numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_vat numeric;
  v_rate numeric;
  v_currency text;
  v_functional numeric;
  v_debtors uuid;
  v_revenue uuid;
  v_discount_acc uuid;
  v_vat_payable uuid;
  v_sale_entry uuid;
  v_cogs_entry uuid;
  v_lines_sale jsonb;
  v_location uuid;
  v_stock_line jsonb;
  v_product record;
  v_balance record;
  v_unit_cost numeric;
  v_cost_lines jsonb := '[]'::jsonb;
  v_shift uuid := (p_payload->>'shift_id')::uuid;
begin
  -- 1. Authorization. Mandatory: only this function's guard matters once the
  --    table policies stop allowing cashiers to write the ledger directly.
  if v_business_id is null or not public.can_operate_pos(v_business_id) then
    raise exception 'You do not have permission to record sales for this business.'
      using errcode = '42501';
  end if;

  -- 2. Idempotency: a retried sale (lost response, queue replay) returns the
  --    committed document instead of duplicating it.
  if v_client_key is not null then
    select * into v_existing from public.invoices
     where business_id = v_business_id and client_key = v_client_key limit 1;
    if found then
      return jsonb_build_object('id', v_existing.id, 'number', v_existing.invoice_number,
        'journal_entry_id', v_existing.journal_entry_id, 'idempotent', true);
    end if;
  end if;

  -- 3. Validate.
  if v_invoice is null or jsonb_typeof(v_invoice) <> 'object'
     or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Malformed POS sale payload.' using errcode = 'P0001';
  end if;

  v_total    := (v_invoice->>'total_amount')::numeric;
  v_subtotal := coalesce((v_invoice->>'subtotal')::numeric, 0);
  v_discount := coalesce((v_invoice->>'discount_amount')::numeric, 0);
  v_vat      := coalesce((v_invoice->>'vat_amount')::numeric, 0);
  v_rate     := (v_invoice->>'exchange_rate')::numeric;
  v_currency := coalesce(v_invoice->>'original_currency', v_invoice->>'currency');
  v_functional := coalesce((v_invoice->>'functional_amount')::numeric, v_total * v_rate);

  if v_total is null or v_total <= 0 or v_rate is null or v_rate <= 0 then
    raise exception 'Enter a valid sale total.' using errcode = 'P0001';
  end if;
  if (v_invoice->>'contact_id')::uuid is null then
    raise exception 'A customer contact is required.' using errcode = 'P0001';
  end if;

  -- Tenders must settle the document, unless it is a credit sale.
  if coalesce((p_payload->>'is_credit_sale')::boolean, false) = false then
    select coalesce(sum((p->>'amount')::numeric), 0) into v_paid from jsonb_array_elements(v_payments) p;
    if abs(v_paid - v_total) > 0.01 then
      raise exception 'Tenders (%) do not settle the sale total (%).',
        round(v_paid, 2), round(v_total, 2) using errcode = 'P0001';
    end if;
  end if;

  -- 4. Plan limit, then the document number.
  perform public._ledgr_assert_usage_limit(v_business_id);
  v_number := public.reserve_next_document_number(v_business_id, 'invoice');

  -- 5. Header + lines.
  insert into public.invoices (
    business_id, invoice_number, invoice_type, status, contact_id, issue_date, due_date,
    currency, exchange_rate, original_currency, original_amount, functional_currency,
    functional_amount, rate_date, rate_is_stale, subtotal, discount_amount, discount_percent,
    taxable_amount, vat_amount, wht_amount, total_amount, amount_paid, ar_account_id,
    revenue_account_id, notes, branch_id, department_id, created_by, client_key
  ) values (
    v_business_id, v_number, coalesce(v_invoice->>'invoice_type','invoice'),
    coalesce(v_invoice->>'status','paid')::public.invoice_status, (v_invoice->>'contact_id')::uuid,
    (v_invoice->>'issue_date')::date, coalesce((v_invoice->>'due_date')::date, (v_invoice->>'issue_date')::date),
    coalesce(v_invoice->>'currency', v_currency), v_rate, v_currency,
    (v_invoice->>'original_amount')::numeric, v_invoice->>'functional_currency', v_functional,
    (v_invoice->>'rate_date')::date, coalesce((v_invoice->>'rate_is_stale')::boolean, false),
    v_subtotal, v_discount, coalesce((v_invoice->>'discount_percent')::numeric, 0),
    coalesce((v_invoice->>'taxable_amount')::numeric, v_subtotal), v_vat,
    coalesce((v_invoice->>'wht_amount')::numeric, 0), v_total, v_paid,
    (v_invoice->>'ar_account_id')::uuid, (v_invoice->>'revenue_account_id')::uuid,
    coalesce(v_invoice->>'notes', v_invoice->>'description'),
    (v_invoice->>'branch_id')::uuid, (v_invoice->>'department_id')::uuid,
    v_invoice->>'created_by', v_client_key
  ) returning id into v_invoice_id;

  insert into public.invoice_lines (
    business_id, invoice_id, line_number, description, quantity, unit_price,
    discount_percent, discount_amount, tax_code, tax_rate, tax_amount, line_total,
    product_id, account_id
  )
  select v_business_id, v_invoice_id, (l->>'line_number')::numeric, l->>'description',
    (l->>'quantity')::numeric, (l->>'unit_price')::numeric,
    coalesce((l->>'discount_percent')::numeric, 0), coalesce((l->>'discount_amount')::numeric, 0),
    coalesce(l->>'tax_code','none')::public.tax_code, coalesce((l->>'tax_rate')::numeric, 0),
    coalesce((l->>'tax_amount')::numeric, 0), (l->>'line_total')::numeric,
    (l->>'product_id')::uuid, (l->>'account_id')::uuid
  from jsonb_array_elements(v_lines) l;

  -- 6. Tenders: the money rows, each keyed for retry safety.
  for v_payment in select * from jsonb_array_elements(v_payments) loop
    v_payment_key := coalesce((v_payment->>'client_key')::uuid, gen_random_uuid());
    v_tender := (v_payment->>'bank_account_id')::uuid;
    if v_tender is null then
      v_tender := public._ledgr_account_by_code(v_business_id, '1110');
    end if;

    insert into public.invoice_payments (
      business_id, invoice_id, amount, currency, exchange_rate, original_amount,
      original_currency, functional_amount, payment_date, payment_method,
      bank_account_id, reference, created_by, client_key
    ) values (
      v_business_id, v_invoice_id, (v_payment->>'amount')::numeric,
      coalesce(v_payment->>'currency', v_currency), coalesce((v_payment->>'exchange_rate')::numeric, v_rate),
      coalesce((v_payment->>'original_amount')::numeric, (v_payment->>'amount')::numeric),
      coalesce(v_payment->>'original_currency', v_currency),
      coalesce((v_payment->>'functional_amount')::numeric, (v_payment->>'amount')::numeric),
      coalesce((v_payment->>'payment_date')::date, (v_invoice->>'issue_date')::date),
      coalesce(v_payment->>'payment_method','cash')::public.payment_method, v_tender,
      v_payment->>'reference', coalesce(v_payment->>'created_by', v_invoice->>'created_by'),
      v_payment_key
    ) on conflict do nothing;
  end loop;

  update public.invoices set amount_paid = v_paid where id = v_invoice_id;

  -- 7. Ledger: the sale entry, then one settlement entry per tender.
  v_debtors := public._ledgr_account_by_code(v_business_id, '1131');
  v_revenue := null;
  if v_invoice->>'revenue_account_id' is not null then
    begin
      v_revenue := public._ledgr_assert_account((v_invoice->>'revenue_account_id')::uuid, v_business_id, 'revenue');
    exception when others then v_revenue := null;
    end;
  end if;
  if v_revenue is null then
    v_revenue := public._ledgr_account_by_code(v_business_id, '4112');
  end if;

  v_lines_sale := jsonb_build_array(jsonb_build_object(
    'account_id', v_debtors, 'description', 'Invoice ' || v_number || ' — receivable',
    'is_debit', true, 'amount', v_total, 'amount_base', v_functional));

  if v_discount > 0.005 then
    begin
      v_discount_acc := public._ledgr_account_by_code(v_business_id, '4130');
      v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object(
        'account_id', v_revenue, 'description', 'Invoice ' || v_number || ' — revenue (gross)',
        'is_debit', false, 'amount', v_subtotal + v_discount, 'amount_base', (v_subtotal + v_discount) * v_rate));
      v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object(
        'account_id', v_discount_acc, 'description', 'Invoice ' || v_number || ' — discount allowed',
        'is_debit', true, 'amount', v_discount, 'amount_base', v_discount * v_rate));
    exception when others then
      -- 4130 missing: post net revenue, as the TS path does.
      v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object(
        'account_id', v_revenue, 'description', 'Invoice ' || v_number || ' — revenue',
        'is_debit', false, 'amount', v_subtotal, 'amount_base', v_subtotal * v_rate));
    end;
  else
    v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object(
      'account_id', v_revenue, 'description', 'Invoice ' || v_number || ' — revenue',
      'is_debit', false, 'amount', v_subtotal, 'amount_base', v_subtotal * v_rate));
  end if;

  if v_vat > 0 then
    v_vat_payable := public._ledgr_account_by_code(v_business_id, '2121');
    v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object(
      'account_id', v_vat_payable, 'description', 'Invoice ' || v_number || ' — VAT',
      'is_debit', false, 'amount', v_vat, 'amount_base', v_vat * v_rate,
      'tax_code', 'vat_standard', 'tax_amount', v_vat * v_rate));
  end if;

  v_sale_entry := public._ledgr_post_entry_keyed(
    v_business_id, 'invoice:' || v_invoice_id || ':sale', (v_invoice->>'issue_date')::date,
    'Invoice ' || v_number, 'invoice', v_invoice_id::text, v_currency, v_rate,
    (v_invoice->>'branch_id')::uuid, (v_invoice->>'department_id')::uuid, v_lines_sale);

  update public.invoices set journal_entry_id = v_sale_entry where id = v_invoice_id;

  for v_payment in select * from jsonb_array_elements(v_payments) loop
    v_payment_key := coalesce((v_payment->>'client_key')::uuid, gen_random_uuid());
    v_tender := (v_payment->>'bank_account_id')::uuid;
    if v_tender is null then
      v_tender := public._ledgr_account_by_code(v_business_id, '1110');
    end if;

    perform public._ledgr_post_entry_keyed(
      v_business_id, 'invoice:' || v_invoice_id || ':settlement:' || v_payment_key,
      coalesce((v_payment->>'payment_date')::date, (v_invoice->>'issue_date')::date),
      'Receipt for Invoice ' || v_number, 'invoice', v_invoice_id::text, v_currency, v_rate,
      (v_invoice->>'branch_id')::uuid, (v_invoice->>'department_id')::uuid,
      jsonb_build_array(
        jsonb_build_object('account_id', v_tender, 'description', 'Cash received — Invoice ' || v_number,
          'is_debit', true, 'amount', (v_payment->>'amount')::numeric,
          'amount_base', coalesce((v_payment->>'functional_amount')::numeric, (v_payment->>'amount')::numeric)),
        jsonb_build_object('account_id', v_debtors, 'description', 'Settle debtor — Invoice ' || v_number,
          'is_debit', false, 'amount', (v_payment->>'amount')::numeric,
          'amount_base', coalesce((v_payment->>'functional_amount')::numeric, (v_payment->>'amount')::numeric))));
  end loop;

  -- 8. Stock release + COGS. Guarded by "does this invoice already have
  --    movements?", the same idempotency the TS path relies on.
  if jsonb_array_length(v_stock) > 0
     and not exists (select 1 from public.stock_movements
                     where business_id = v_business_id and source_type = 'invoice' and source_id = v_invoice_id::text) then
    v_location := public._ledgr_stock_location(v_business_id, (v_invoice->>'branch_id')::uuid);
    if v_location is not null then
      for v_stock_line in select * from jsonb_array_elements(v_stock) loop
        if coalesce((v_stock_line->>'quantity')::numeric, 0) <= 0 then continue; end if;
        select * into v_product from public.products
         where id = (v_stock_line->>'product_id')::uuid and business_id = v_business_id and track_inventory = true;
        if not found then continue; end if;

        select * into v_balance from public.inventory_balances
         where business_id = v_business_id and product_id = v_product.id and location_id = v_location limit 1;
        v_unit_cost := coalesce(v_balance.average_cost, 0);

        insert into public.stock_movements (business_id, product_id, location_id, movement_type,
          movement_date, quantity, unit_cost, source_type, source_id, reference, created_by)
        values (v_business_id, v_product.id, v_location, 'sale', (v_invoice->>'issue_date')::date,
          -(v_stock_line->>'quantity')::numeric, v_unit_cost, 'invoice', v_invoice_id::text,
          v_number, v_invoice->>'created_by');

        v_cost_lines := v_cost_lines || jsonb_build_array(jsonb_build_object(
          'product_id', v_product.id, 'quantity', (v_stock_line->>'quantity')::numeric, 'unit_cost', v_unit_cost));
      end loop;

      begin
        v_cogs_entry := public._ledgr_post_cogs(v_business_id, v_invoice_id, v_number,
          (v_invoice->>'issue_date')::date, (v_invoice->>'branch_id')::uuid,
          (v_invoice->>'department_id')::uuid, v_cost_lines);
        update public.journal_entries set posting_key = 'invoice:' || v_invoice_id || ':cogs'
         where id = v_cogs_entry;
      exception when others then
        raise warning 'COGS posting failed for invoice %: %', v_number, sqlerrm;
        v_cogs_entry := null;
      end;
    end if;
  end if;

  -- 9. Drawer totals, only while the shift is open (a closed shift has been
  --    counted and signed; see applyShiftTotals in posService).
  if v_shift is not null then
    update public.pos_shifts
       set cash_sales_amount = cash_sales_amount + coalesce((p_payload->>'cash_sales')::numeric, 0),
           other_sales_amount = other_sales_amount + coalesce((p_payload->>'other_sales')::numeric, 0),
           total_sales_amount = total_sales_amount + v_total,
           expected_cash = expected_cash + coalesce((p_payload->>'cash_sales')::numeric, 0),
           updated_at = now()
     where id = v_shift and business_id = v_business_id and status = 'open';
  end if;

  return jsonb_build_object('id', v_invoice_id, 'number', v_number,
    'journal_entry_id', v_sale_entry, 'idempotent', false);
end; $$;

revoke all on function public.post_pos_sale(jsonb) from public, anon;
grant execute on function public.post_pos_sale(jsonb) to authenticated;

comment on function public.post_pos_sale(jsonb) is
  'Atomic POS sale posting: authorize, de-duplicate by client_key, reserve number, write invoice + lines + tender rows, post the sale/settlement/COGS entries and release stock — one round trip, one transaction. Executor only: policy inputs (accounts, amounts, FX, tender mapping) are computed client-side. Exists so a cashier never needs INSERT on the ledger tables.';
