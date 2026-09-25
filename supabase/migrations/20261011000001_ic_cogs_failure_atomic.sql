-- ============================================================================
-- 20261011000001_ic_cogs_failure_atomic.sql
-- INCIDENT CONTAINMENT 2026-09-25 — P5: COGS failure must not return success
-- ============================================================================
-- Finding: _ledgr_complete_pos_sale (20260923000000, still the latest body)
-- and save_quick_sale (latest body 20261007000000) wrapped _ledgr_post_cogs in
-- `exception when others then raise warning ...`, so a sale could commit and
-- report success with stock released but NO cost-of-sales journal (GL vs
-- sub-ledger divergence, invisible to the cashier).
--
-- Change: both functions are redefined VERBATIM from their latest
-- definitions except for that one handler, which now RE-RAISES. Neither
-- function has an outer handler around this call and both run inside the
-- caller's single RPC transaction, so the whole sale rolls back atomically.
--
-- Unchanged behaviour (verified):
--   * _ledgr_post_cogs returns NULL (no error) for zero-cost / empty lines, so
--     only genuine failures (e.g. missing 1141/5100 account) now block a sale.
--   * Replays of already-committed sales never re-enter the COGS block (it is
--     guarded by "has this invoice already moved stock?"), so historical sales
--     that committed without COGS keep replaying idempotently. They are NOT
--     repaired here (historical repair not authorised).
--   * Grants/owners are unchanged (CREATE OR REPLACE keeps ACLs); re-asserted.
--
-- No data is read or written by this migration.
-- ============================================================================

-- ── 1. _ledgr_complete_pos_sale (POS: post_pos_sale) ─────────────────────
create or replace function public._ledgr_complete_pos_sale(
  p_business_id uuid,
  p_invoice_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_inv record;
  v_rate numeric;
  v_currency text;
  v_total numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_vat numeric;
  v_debtors uuid;
  v_revenue uuid;
  v_discount_acc uuid;
  v_vat_payable uuid;
  v_lines jsonb;
  v_sale_entry uuid;
  v_cogs_entry uuid;
  v_payment record;
  v_tender uuid;
  v_cash numeric;
  v_cost_lines jsonb := '[]'::jsonb;
  v_location uuid;
  v_line record;
  v_product record;
  v_balance record;
  v_unit_cost numeric;
  v_moved boolean;
begin
  select * into v_inv
    from public.invoices
   where id = p_invoice_id and business_id = p_business_id
   limit 1;
  if not found then
    raise exception 'Sale % was not found for this business.', p_invoice_id using errcode = 'P0001';
  end if;

  v_rate     := coalesce(v_inv.exchange_rate, 1);
  v_currency := coalesce(v_inv.original_currency, v_inv.currency);
  v_total    := coalesce(v_inv.total_amount, 0);
  v_subtotal := coalesce(v_inv.subtotal, 0);
  v_discount := coalesce(v_inv.discount_amount, 0);
  v_vat      := coalesce(v_inv.vat_amount, 0);

  -- 1. The sale entry: DR Debtors / CR Revenue (gross when discounted) /
  --    DR Discount allowed / CR VAT payable.
  select id into v_sale_entry
    from public.journal_entries
   where business_id = p_business_id
     and posting_key = 'invoice:' || p_invoice_id::text || ':sale'
   limit 1;

  if v_sale_entry is null then
    v_debtors := public._ledgr_account_by_code(p_business_id, '1131');

    v_revenue := null;
    if v_inv.revenue_account_id is not null then
      begin
        v_revenue := public._ledgr_assert_account(v_inv.revenue_account_id, p_business_id, 'revenue');
      exception when others then
        v_revenue := null;
      end;
    end if;
    if v_revenue is null then
      v_revenue := public._ledgr_account_by_code(p_business_id, '4112');
    end if;

    v_lines := jsonb_build_array(jsonb_build_object(
      'account_id', v_debtors,
      'description', 'Invoice ' || v_inv.invoice_number || ' — receivable',
      'is_debit', true,
      'amount', v_total,
      'amount_base', coalesce(v_inv.functional_amount, v_total * v_rate)
    ));

    if v_discount > 0.005 then
      begin
        v_discount_acc := public._ledgr_account_by_code(p_business_id, '4130');
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_id', v_revenue,
          'description', 'Invoice ' || v_inv.invoice_number || ' — revenue (gross)',
          'is_debit', false,
          'amount', v_subtotal + v_discount,
          'amount_base', (v_subtotal + v_discount) * v_rate
        ));
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_id', v_discount_acc,
          'description', 'Invoice ' || v_inv.invoice_number || ' — discount allowed',
          'is_debit', true,
          'amount', v_discount,
          'amount_base', v_discount * v_rate
        ));
      exception when others then
        -- 4130 genuinely missing: post net revenue, exactly as
        -- createInvoiceReceivableEntry does (and log nothing — the TS path
        -- warns, this keeps the books rather than the narration).
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_id', v_revenue,
          'description', 'Invoice ' || v_inv.invoice_number || ' — revenue',
          'is_debit', false,
          'amount', v_subtotal,
          'amount_base', v_subtotal * v_rate
        ));
      end;
    else
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_revenue,
        'description', 'Invoice ' || v_inv.invoice_number || ' — revenue',
        'is_debit', false,
        'amount', v_subtotal,
        'amount_base', v_subtotal * v_rate
      ));
    end if;

    if v_vat > 0 then
      v_vat_payable := public._ledgr_account_by_code(p_business_id, '2121');
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_vat_payable,
        'description', 'Invoice ' || v_inv.invoice_number || ' — VAT',
        'is_debit', false,
        'amount', v_vat,
        'amount_base', v_vat * v_rate,
        'tax_code', 'vat_standard',
        'tax_amount', v_vat * v_rate
      ));
    end if;

    v_sale_entry := public._ledgr_post_entry_keyed(
      p_business_id,
      'invoice:' || p_invoice_id::text || ':sale',
      coalesce(v_inv.issue_date, current_date),
      'Invoice ' || v_inv.invoice_number,
      'invoice',
      p_invoice_id::text,
      v_currency, v_rate,
      v_inv.branch_id, v_inv.department_id,
      v_lines
    );

    update public.invoices set journal_entry_id = v_sale_entry where id = p_invoice_id;
  end if;

  -- 2. One settlement entry per tender, debiting the account the money landed
  --    in. Keyed by the stored payment id so a replay cannot double-post.
  v_debtors := coalesce(v_debtors, public._ledgr_account_by_code(p_business_id, '1131'));

  for v_payment in
    select * from public.invoice_payments
     where business_id = p_business_id and invoice_id = p_invoice_id
     order by created_at, id
  loop
    v_tender := v_payment.bank_account_id;
    if v_tender is null then
      v_tender := public._ledgr_account_by_code(p_business_id, '1110');
    end if;

    v_cash := coalesce(v_payment.functional_amount, v_payment.original_amount, v_payment.amount, 0);

    perform public._ledgr_post_entry_keyed(
      p_business_id,
      'invoice:' || p_invoice_id::text || ':settlement:' || v_payment.id::text,
      coalesce(v_payment.payment_date, v_inv.issue_date, current_date),
      'Receipt for Invoice ' || v_inv.invoice_number,
      'invoice',
      p_invoice_id::text,
      v_currency, v_rate,
      v_inv.branch_id, v_inv.department_id,
      jsonb_build_array(
        jsonb_build_object(
          'account_id', v_tender,
          'description', 'Cash received — Invoice ' || v_inv.invoice_number,
          'is_debit', true,
          'amount', coalesce(v_payment.original_amount, v_payment.amount),
          'amount_base', v_cash
        ),
        jsonb_build_object(
          'account_id', v_debtors,
          'description', 'Settle debtor — Invoice ' || v_inv.invoice_number,
          'is_debit', false,
          'amount', coalesce(v_payment.original_amount, v_payment.amount),
          'amount_base', v_cash
        )
      )
    );
  end loop;

  -- 3. Stock release + COGS, derived from the invoice's own lines so the
  --    replay releases exactly what was sold. Guarded by "has this invoice
  --    already moved stock?" — movements carry no client key.
  select exists (
    select 1 from public.stock_movements
     where business_id = p_business_id and source_type = 'invoice' and source_id = p_invoice_id::text
  ) into v_moved;

  if not v_moved then
    v_location := public._ledgr_stock_location(p_business_id, v_inv.branch_id);

    if v_location is not null then
      for v_line in
        select il.product_id, sum(il.quantity) as quantity
          from public.invoice_lines il
         where il.business_id = p_business_id
           and il.invoice_id = p_invoice_id
           and il.product_id is not null
         group by il.product_id
      loop
        if coalesce(v_line.quantity, 0) <= 0 then
          continue;
        end if;

        select * into v_product
          from public.products
         where id = v_line.product_id
           and business_id = p_business_id
           and track_inventory = true;
        if not found then
          continue;
        end if;

        select * into v_balance
          from public.inventory_balances
         where business_id = p_business_id
           and product_id = v_product.id
           and location_id = v_location
         limit 1;
        v_unit_cost := coalesce(v_balance.average_cost, 0);

        insert into public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, source_type, source_id, reference, created_by
        ) values (
          p_business_id, v_product.id, v_location, 'sale',
          coalesce(v_inv.issue_date, current_date),
          -v_line.quantity, v_unit_cost,
          'invoice', p_invoice_id::text, v_inv.invoice_number, v_inv.created_by
        );

        v_cost_lines := v_cost_lines || jsonb_build_array(jsonb_build_object(
          'product_id', v_product.id,
          'quantity', v_line.quantity,
          'unit_cost', v_unit_cost
        ));
      end loop;
    end if;

    if jsonb_array_length(v_cost_lines) > 0 then
      begin
        v_cogs_entry := public._ledgr_post_cogs(
          p_business_id, p_invoice_id, v_inv.invoice_number,
          coalesce(v_inv.issue_date, current_date),
          v_inv.branch_id, v_inv.department_id, v_cost_lines
        );
        update public.journal_entries
           set posting_key = 'invoice:' || p_invoice_id::text || ':cogs'
         where id = v_cogs_entry;
      exception when others then
        -- INCIDENT CONTAINMENT 2026-09-25 (P5): a COGS failure is NO LONGER
        -- swallowed. Re-raise so post_pos_sale's single transaction rolls back
        -- entirely (invoice, lines, payments, sale/settlement journals, stock
        -- movements). The sale never reports success without its COGS entry.
        raise exception 'COGS posting failed for sale %: %. The sale was not recorded; fix the cause and retry.',
          v_inv.invoice_number, sqlerrm using errcode = 'P0001';
      end;
    end if;
  end if;

  return jsonb_build_object(
    'journal_entry_id', v_sale_entry,
    'cogs_entry_id', v_cogs_entry
  );
end;
$$;

revoke all on function public._ledgr_complete_pos_sale(uuid,uuid) from public;

-- ── 2. save_quick_sale (quick income) ────────────────────────────────────────
create or replace function public.save_quick_sale(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (p_payload->>'business_id')::uuid;
  v_client_key uuid := (p_payload->>'client_key')::uuid;
  v_invoice jsonb := p_payload->'invoice';
  v_lines jsonb := p_payload->'lines';
  v_subtotal numeric := coalesce((p_payload->>'subtotal')::numeric, 0);
  v_vat numeric := coalesce((p_payload->>'vat_amount')::numeric, 0);
  v_stock jsonb := coalesce(p_payload->'stock_lines', '[]'::jsonb);
  v_number text; v_invoice_id uuid; v_sale_entry uuid; v_receipt_entry uuid; v_cogs_entry uuid;
  v_currency text; v_rate numeric; v_total numeric; v_functional numeric;
  v_debtors uuid; v_revenue uuid; v_vat_payable uuid; v_cash uuid; v_location uuid;
  v_cost_lines jsonb := '[]'::jsonb; v_stock_line jsonb; v_product record; v_balance record; v_unit_cost numeric;
  v_existing record;
  v_branch_id uuid := (v_invoice->>'branch_id')::uuid;
begin
  if v_business_id is null or not public.can_write_sales_data(v_business_id) then raise exception 'You do not have permission to record income for this business.' using errcode = '42501'; end if;

  -- P5-D: branch scope
  if v_branch_id is not null and not public.can_access_branch(v_business_id, v_branch_id) then raise exception 'You do not have access to the requested branch.' using errcode = '42501'; end if;
  if v_branch_id is null and exists (
      select 1 from public.business_users bu where bu.business_id = v_business_id and bu.user_id = auth.uid() and bu.is_active = true and bu.role::text in ('cashier','stock_clerk','branch_manager','sales_clerk','sales_manager','purchasing_officer','warehouse_worker','customer_service_rep') and bu.branch_id is not null)
  then raise exception 'You do not have access to the requested branch.' using errcode = '42501', detail = 'assigned-scope requires branch'; end if;

  if v_client_key is not null then select * into v_existing from public.invoices where business_id = v_business_id and client_key = v_client_key limit 1; if found then return jsonb_build_object('id', v_existing.id, 'number', v_existing.invoice_number, 'journal_entry_id', v_existing.journal_entry_id, 'idempotent', true); end if; end if;
  if v_invoice is null or jsonb_typeof(v_invoice) <> 'object' or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then raise exception 'Malformed quick-sale payload.' using errcode = 'P0001'; end if;
  if coalesce((v_invoice->>'discount_amount')::numeric, 0) > 0.005 or v_vat > 0 or coalesce((v_invoice->>'wht_amount')::numeric, 0) > 0.005 then raise exception 'Quick-sale RPC handles plain paid invoices only.' using errcode = 'P0001', detail = 'discount_or_vat'; end if;
  v_total := (v_invoice->>'total_amount')::numeric; v_currency := coalesce(v_invoice->>'original_currency', v_invoice->>'currency'); v_rate := (v_invoice->>'exchange_rate')::numeric; v_functional := coalesce((v_invoice->>'functional_amount')::numeric, v_total * v_rate);
  if v_total is null or v_total <= 0 or v_rate is null or v_rate <= 0 then raise exception 'Enter a valid amount.' using errcode = 'P0001'; end if;
  if v_subtotal is null or abs(v_subtotal + v_vat - v_total) > 0.005 then raise exception 'Sale subtotal (%) does not match the total amount (%).', round(coalesce(v_subtotal, 0)::numeric, 2), round(v_total::numeric, 2) using errcode = 'P0001'; end if;
  if (v_invoice->>'contact_id')::uuid is null then raise exception 'A customer contact is required.' using errcode = 'P0001'; end if;

  perform public._ledgr_assert_usage_limit(v_business_id);
  v_number := public.reserve_next_document_number(v_business_id, 'invoice');

  insert into public.invoices (business_id, invoice_number, invoice_type, status, contact_id, issue_date, due_date, currency, exchange_rate, original_currency, original_amount, functional_currency, functional_amount, rate_date, rate_is_stale, subtotal, discount_amount, discount_percent, taxable_amount, vat_amount, wht_amount, total_amount, amount_paid, ar_account_id, notes, branch_id, department_id, client_key)
  values (v_business_id, v_number, coalesce(v_invoice->>'invoice_type', 'invoice'), 'paid', (v_invoice->>'contact_id')::uuid, (v_invoice->>'issue_date')::date, coalesce((v_invoice->>'due_date')::date, (v_invoice->>'issue_date')::date), coalesce(v_invoice->>'currency', v_currency), v_rate, v_currency, (v_invoice->>'original_amount')::numeric, v_invoice->>'functional_currency', v_functional, (v_invoice->>'rate_date')::date, coalesce((v_invoice->>'rate_is_stale')::boolean, false), v_subtotal, 0, 0, v_subtotal, v_vat, 0, v_total, v_total, (v_invoice->>'ar_account_id')::uuid, coalesce(v_invoice->>'notes', v_invoice->>'description'), v_branch_id, (v_invoice->>'department_id')::uuid, v_client_key) returning id into v_invoice_id;

  insert into public.invoice_lines (business_id, invoice_id, line_number, description, quantity, unit_price, discount_percent, tax_code, tax_rate, tax_amount, line_total, product_id, account_id)
  select v_business_id, v_invoice_id, (l->>'line_number')::numeric, l->>'description', (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce((l->>'discount_percent')::numeric, 0), coalesce(l->>'tax_code', 'none')::public.tax_code, (l->>'tax_rate')::numeric, (l->>'tax_amount')::numeric, (l->>'line_total')::numeric, (l->>'product_id')::uuid, (l->>'account_id')::uuid from jsonb_array_elements(v_lines) as l;

  v_debtors := public._ledgr_account_by_code(v_business_id, '1131'); v_cash := public._ledgr_account_by_code(v_business_id, '1110');
  if v_invoice->>'revenue_account_id' is not null then begin v_revenue := public._ledgr_assert_account((v_invoice->>'revenue_account_id')::uuid, v_business_id, 'revenue'); exception when others then v_revenue := null; end; end if;
  if v_revenue is null then v_revenue := public._ledgr_account_by_code(v_business_id, '4112'); end if;

  declare v_lines_sale jsonb := '[]'::jsonb; begin
    v_lines_sale := jsonb_build_array(jsonb_build_object('account_id', v_debtors, 'description', 'Invoice ' || v_number || ' — receivable', 'is_debit', true, 'amount', v_total, 'amount_base', v_functional));
    v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object('account_id', v_revenue, 'description', 'Invoice ' || v_number, 'is_debit', false, 'amount', v_subtotal, 'amount_base', v_subtotal * v_rate));
    if v_vat > 0 then v_vat_payable := public._ledgr_account_by_code(v_business_id, '2121'); v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object('account_id', v_vat_payable, 'description', 'Invoice ' || v_number || ' — VAT', 'is_debit', false, 'amount', v_vat, 'amount_base', v_vat * v_rate, 'tax_code', 'vat_standard', 'tax_amount', v_vat * v_rate)); end if;
    v_sale_entry := public._ledgr_post_entry(v_business_id, public.next_journal_entry_number(v_business_id), (v_invoice->>'issue_date')::date, 'Invoice ' || v_number, 'invoice', v_invoice_id::text, v_currency, v_rate, v_branch_id, (v_invoice->>'department_id')::uuid, v_lines_sale);
  end;

  v_receipt_entry := public._ledgr_post_entry(v_business_id, public.next_journal_entry_number(v_business_id), (v_invoice->>'issue_date')::date, 'Receipt for Invoice ' || v_number, 'invoice', v_invoice_id::text, v_currency, v_rate, v_branch_id, (v_invoice->>'department_id')::uuid, jsonb_build_array(jsonb_build_object('account_id', v_cash, 'description', 'Cash received — Invoice ' || v_number, 'is_debit', true, 'amount', v_total, 'amount_base', v_functional), jsonb_build_object('account_id', v_debtors, 'description', 'Settle debtor — Invoice ' || v_number, 'is_debit', false, 'amount', v_total, 'amount_base', v_functional)));
  update public.invoices set journal_entry_id = v_sale_entry where id = v_invoice_id;

  if jsonb_typeof(v_stock) = 'array' and jsonb_array_length(v_stock) > 0 then
    v_location := public._ledgr_stock_location(v_business_id, v_branch_id);
    if v_location is not null then
      if not public.can_access_location(v_business_id, v_location) then raise exception 'You do not have access to the requested branch.' using errcode = '42501', detail = 'stock location branch'; end if;
      for v_stock_line in select * from jsonb_array_elements(v_stock) loop
        if coalesce((v_stock_line->>'quantity')::numeric, 0) <= 0 then continue; end if;
        select * into v_product from public.products where id = (v_stock_line->>'product_id')::uuid and business_id = v_business_id and track_inventory = true; continue when not found;
        select * into v_balance from public.inventory_balances where business_id = v_business_id and product_id = v_product.id and location_id = v_location limit 1; v_unit_cost := coalesce(v_balance.average_cost, 0);
        insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference, created_by)
        values (v_business_id, v_product.id, v_location, 'sale', (v_invoice->>'issue_date')::date, -(v_stock_line->>'quantity')::numeric, v_unit_cost, 'invoice', v_invoice_id::text, v_number, v_invoice->>'created_by');
        v_cost_lines := v_cost_lines || jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'quantity', (v_stock_line->>'quantity')::numeric, 'unit_cost', v_unit_cost));
      end loop;
      begin v_cogs_entry := public._ledgr_post_cogs(v_business_id, v_invoice_id, v_number, (v_invoice->>'issue_date')::date, v_branch_id, (v_invoice->>'department_id')::uuid, v_cost_lines); exception when others then /* IC 2026-09-25 P5: never swallow COGS failure — roll back the whole save */ raise exception 'COGS posting failed for sale %: %. The sale was not recorded; fix the cause and retry.', v_number, sqlerrm using errcode = 'P0001'; end;
    end if;
  end if;

  return jsonb_build_object('id', v_invoice_id, 'number', v_number, 'journal_entry_id', v_sale_entry, 'receipt_entry_id', v_receipt_entry, 'cogs_entry_id', v_cogs_entry, 'idempotent', false);
end;
$$;

revoke all on function public.save_quick_sale(jsonb) from public, anon;
grant execute on function public.save_quick_sale(jsonb) to authenticated;
