-- ============================================================================
-- Fix quick-save RPCs: source_id / created_by uuid-vs-text datatype mismatch
-- ============================================================================
--
-- PROBLEM (reported from production: Quick Expense Entry)
--
--   column "source_id" is of type uuid but expression is of type text
--   Nothing was saved — it is safe to try again.
--
--   The quick-save RPCs (20260911000001_quick_save_rpc.sql) were written
--   against the repository schema, where journal_entries.source_id and
--   stock_movements.source_id are TEXT. On the live database those columns
--   are UUID, and PostgreSQL does not implicitly cast a text-typed
--   expression to uuid on INSERT — so every save_quick_expense /
--   save_quick_sale call failed inside _ledgr_post_entry with 42804
--   (datatype_mismatch) and rolled back. The same latent failure existed
--   for the stock_movements.created_by write (NULL::text into uuid).
--
--   The legacy client path never hit this because PostgREST binds JSON
--   values as untyped parameters, letting the target column's type win.
--
-- FIX
--
--   Cast to uuid at every source_id / created_by write, mirroring the
--   established pattern in 20260730000003 (api_create_journal_entry):
--   nullif(x, '')::uuid. A uuid expression is accepted by BOTH column
--   shapes — uuid columns match directly, and uuid→text is a valid
--   assignment cast — so the functions now run identically on the
--   repository schema (fresh replays, staging) and the live database.
--
--   Affected writes:
--     _ledgr_post_entry   → journal_entries.source_id
--     save_quick_expense  → stock_movements.source_id / .created_by
--     save_quick_sale     → stock_movements.source_id / .created_by
--
--   Verified by tests/database/quick_save_rpc_source_uuid.test.js against
--   both schema shapes.
-- ============================================================================

create or replace function public._ledgr_post_entry(
  p_business_id uuid,
  p_entry_number text,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_id text,
  p_currency text,
  p_exchange_rate numeric,
  p_branch_id uuid,
  p_department_id uuid,
  p_lines jsonb     -- [{account_id, description, is_debit, amount, amount_base, tax_code, tax_amount}]
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_entry_id uuid;
  v_line jsonb;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_line_no integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry requires at least two lines.' using errcode = 'P0001';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if (v_line->>'is_debit')::boolean then
      v_debits := v_debits + (v_line->>'amount_base')::numeric;
    else
      v_credits := v_credits + (v_line->>'amount_base')::numeric;
    end if;
  end loop;

  if abs(v_debits - v_credits) > 0.005 then
    raise exception 'Journal entry does not balance in functional currency: debits % ≠ credits %.',
      round(v_debits::numeric, 2), round(v_credits::numeric, 2)
      using errcode = 'P0001';
  end if;

  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id,
    currency, exchange_rate, status, posted_at, posted_by, branch_id, department_id
  ) values (
    p_business_id, p_entry_number, p_entry_date, p_description, p_source_type,
    nullif(p_source_id, '')::uuid,
    p_currency, p_exchange_rate, 'posted', now(), null, p_branch_id, p_department_id
  ) returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_line_no := v_line_no + 1;
    insert into public.journal_lines (
      journal_entry_id, business_id, line_number, account_id, description,
      is_debit, amount, amount_base, currency, exchange_rate,
      tax_code, tax_amount, reconciled
    ) values (
      v_entry_id, p_business_id, v_line_no,
      public._ledgr_assert_account((v_line->>'account_id')::uuid, p_business_id, 'journal'),
      coalesce(v_line->>'description', p_description),
      (v_line->>'is_debit')::boolean,
      (v_line->>'amount')::numeric,
      (v_line->>'amount_base')::numeric,
      p_currency, p_exchange_rate,
      coalesce(v_line->>'tax_code', 'none')::public.tax_code,
      coalesce((v_line->>'tax_amount')::numeric, 0),
      false
    );
  end loop;

  return v_entry_id;
end;
$$;

create or replace function public.save_quick_expense(
  p_payload jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (p_payload->>'business_id')::uuid;
  v_client_key uuid := (p_payload->>'client_key')::uuid;
  v_expense jsonb := p_payload->'expense';
  v_lines jsonb := p_payload->'lines';
  v_allocations jsonb := p_payload->'allocations';
  v_vat numeric := coalesce((p_payload->>'vat_amount')::numeric, 0);
  v_stock jsonb := coalesce(p_payload->'stock_lines', '[]'::jsonb);

  v_number text;
  v_expense_id uuid;
  v_journal_id uuid;
  v_currency text;
  v_rate numeric;
  v_total numeric;
  v_functional numeric;
  v_alloc_sum numeric := 0;
  v_alloc jsonb;
  v_jlines jsonb := '[]'::jsonb;
  v_credit_account uuid;
  v_vat_account uuid;
  v_location uuid;
  v_stock_line jsonb;
  v_product record;
  v_existing record;
begin
  -- 1. Authorization (mandatory under SECURITY DEFINER).
  if v_business_id is null or not public.can_write_business_data(v_business_id) then
    raise exception 'You do not have permission to record expenses for this business.'
      using errcode = '42501';
  end if;

  -- 2. Idempotency: a retried save returns the committed document.
  if v_client_key is not null then
    select * into v_existing
      from public.expenses
     where business_id = v_business_id and client_key = v_client_key
     limit 1;
    if found then
      return jsonb_build_object(
        'id', v_existing.id,
        'number', v_existing.expense_number,
        'journal_entry_id', v_existing.journal_entry_id,
        'idempotent', true
      );
    end if;
  end if;

  -- 3. Validate before anything is written.
  if v_expense is null or jsonb_typeof(v_expense) <> 'object'
     or v_lines is null or jsonb_typeof(v_lines) <> 'array'
     or jsonb_array_length(v_lines) = 0
     or v_allocations is null or jsonb_typeof(v_allocations) <> 'array'
     or jsonb_array_length(v_allocations) = 0 then
    raise exception 'Malformed quick-expense payload.' using errcode = 'P0001';
  end if;

  v_total      := (v_expense->>'total_amount')::numeric;
  v_currency   := coalesce(v_expense->>'original_currency', v_expense->>'currency');
  v_rate       := (v_expense->>'exchange_rate')::numeric;
  v_functional := coalesce((v_expense->>'functional_amount')::numeric, v_total * v_rate);

  if v_total is null or v_total <= 0 or v_rate is null or v_rate <= 0 then
    raise exception 'Enter a valid amount.' using errcode = 'P0001';
  end if;
  -- Discounts are a builder-only feature (they post a 5175/4260 contra line
  -- this executor does not build). Reject so the client falls back to the
  -- legacy path and output stays identical whichever path runs.
  if coalesce((v_expense->>'discount_amount')::numeric, 0) > 0.005 then
    raise exception 'Quick-save RPC handles undiscounted expenses only.'
      using errcode = 'P0001', detail = 'discount';
  end if;

  -- Allocation totals must match net + VAT (same 0.01 rule as journalService).
  for v_alloc in select * from jsonb_array_elements(v_allocations) loop
    v_alloc_sum := v_alloc_sum + (v_alloc->>'amount')::numeric;
  end loop;
  if abs(v_alloc_sum + v_vat - v_total) > 0.01 then
    raise exception 'Expense allocations (% + VAT % = %) do not match the total amount (%).',
      round(v_alloc_sum::numeric, 2), round(v_vat::numeric, 2),
      round((v_alloc_sum + v_vat)::numeric, 2), round(v_total::numeric, 2)
      using errcode = 'P0001';
  end if;

  -- 4. Plan usage limit (same rule as checkUsageLimit in journalService).
  perform public._ledgr_assert_usage_limit(v_business_id);

  -- 5. Reserve the document number (atomic, permission-checked RPC).
  v_number := public.reserve_next_document_number(v_business_id, 'expense');

  -- 6. Insert header + lines.
  insert into public.expenses (
    business_id, expense_number, expense_type, status, expense_date,
    currency, exchange_rate, original_currency, original_amount,
    functional_currency, functional_amount, rate_date, rate_is_stale,
    subtotal, vat_amount, wht_amount, total_amount, amount_paid,
    reference, notes, branch_id, department_id, client_key
  ) values (
    v_business_id,
    v_number,
    coalesce(v_expense->>'expense_type', 'receipt'),
    coalesce(v_expense->>'status', 'paid'),
    (v_expense->>'expense_date')::date,
    coalesce(v_expense->>'currency', v_currency),
    v_rate,
    v_currency,
    (v_expense->>'original_amount')::numeric,
    v_expense->>'functional_currency',
    v_functional,
    (v_expense->>'rate_date')::date,
    coalesce((v_expense->>'rate_is_stale')::boolean, false),
    (v_expense->>'subtotal')::numeric,
    v_vat,
    coalesce((v_expense->>'wht_amount')::numeric, 0),
    v_total,
    coalesce((v_expense->>'amount_paid')::numeric, v_total),
    v_expense->>'reference',
    coalesce(v_expense->>'notes', v_expense->>'description'),
    (v_expense->>'branch_id')::uuid,
    (v_expense->>'department_id')::uuid,
    v_client_key
  ) returning id into v_expense_id;

  insert into public.expense_lines (
    business_id, expense_id, line_number, description, quantity, unit_price,
    tax_code, tax_rate, tax_amount, line_total, product_id, account_id
  )
  select
    v_business_id,
    v_expense_id,
    (l->>'line_number')::numeric,
    l->>'description',
    (l->>'quantity')::numeric,
    (l->>'unit_price')::numeric,
    coalesce(l->>'tax_code', 'none')::public.tax_code,
    (l->>'tax_rate')::numeric,
    (l->>'tax_amount')::numeric,
    (l->>'line_total')::numeric,
    (l->>'product_id')::uuid,
    public._ledgr_assert_account((l->>'account_id')::uuid, v_business_id, 'expense line')
  from jsonb_array_elements(v_lines) as l;

  -- 7. Journal entry (allocations debit; VAT debit when present; cash or
  --    creditors credit), posted immediately, then linked.
  for v_alloc in select * from jsonb_array_elements(v_allocations) loop
    v_jlines := v_jlines || jsonb_build_array(jsonb_build_object(
      'account_id', v_alloc->>'account_id',
      'description', coalesce(v_alloc->>'description', 'Expense ' || v_number),
      'is_debit', true,
      'amount', (v_alloc->>'amount')::numeric,
      'amount_base', (v_alloc->>'amount')::numeric * v_rate
    ));
  end loop;

  if v_vat > 0 then
    v_vat_account := public._ledgr_account_by_code(v_business_id, '1135');
    v_jlines := v_jlines || jsonb_build_array(jsonb_build_object(
      'account_id', v_vat_account,
      'description', 'VAT input — Expense ' || v_number,
      'is_debit', true,
      'amount', v_vat,
      'amount_base', v_vat * v_rate,
      'tax_code', 'vat_standard',
      'tax_amount', v_vat * v_rate
    ));
  end if;

  v_credit_account := public._ledgr_account_by_code(
    v_business_id,
    case when v_expense->>'expense_type' = 'bill' then '2111' else '1110' end
  );
  v_jlines := v_jlines || jsonb_build_array(jsonb_build_object(
    'account_id', v_credit_account,
    'description', 'Cash paid — Expense ' || v_number,
    'is_debit', false,
    'amount', v_total,
    'amount_base', v_functional
  ));

  v_journal_id := public._ledgr_post_entry(
    v_business_id,
    public.next_journal_entry_number(v_business_id),
    (v_expense->>'expense_date')::date,
    'Expense ' || v_number,
    'expense',
    v_expense_id::text,
    v_currency,
    v_rate,
    (v_expense->>'branch_id')::uuid,
    (v_expense->>'department_id')::uuid,
    v_jlines
  );

  update public.expenses
     set journal_entry_id = v_journal_id
   where id = v_expense_id;

  -- 8. Stock movements for tracked products (mirrors addStockForBranchPurchase:
  --    movements only — no balance writes here, no journal beyond the
  --    capitalised debit already posted above; failures in this section roll
  --    the whole save back, keeping subledger and ledger consistent).
  if jsonb_typeof(v_stock) = 'array' and jsonb_array_length(v_stock) > 0 then
    v_location := public._ledgr_stock_location(v_business_id, (v_expense->>'branch_id')::uuid);
    if v_location is not null then
      for v_stock_line in select * from jsonb_array_elements(v_stock) loop
        if coalesce((v_stock_line->>'quantity')::numeric, 0) <= 0 then
          continue;
        end if;
        select * into v_product
          from public.products
         where id = (v_stock_line->>'product_id')::uuid
           and business_id = v_business_id
           and track_inventory = true;
        continue when not found;

        insert into public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, source_type, source_id, reference, created_by
        ) values (
          v_business_id,
          v_product.id,
          v_location,
          'purchase',
          current_date,
          (v_stock_line->>'quantity')::numeric,
          (v_stock_line->>'unit_cost')::numeric,
          'expense',
          v_expense_id,
          v_number,
          nullif(v_expense->>'created_by', '')::uuid
        );
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_expense_id,
    'number', v_number,
    'journal_entry_id', v_journal_id,
    'idempotent', false
  );
end;
$$;

create or replace function public.save_quick_sale(
  p_payload jsonb
) returns jsonb
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

  v_number text;
  v_invoice_id uuid;
  v_sale_entry uuid;
  v_receipt_entry uuid;
  v_cogs_entry uuid;
  v_currency text;
  v_rate numeric;
  v_total numeric;
  v_functional numeric;
  v_debtors uuid;
  v_revenue uuid;
  v_vat_payable uuid;
  v_cash uuid;
  v_location uuid;
  v_cost_lines jsonb := '[]'::jsonb;
  v_stock_line jsonb;
  v_product record;
  v_balance record;
  v_unit_cost numeric;
  v_existing record;
begin
  -- 1. Authorization.
  if v_business_id is null or not public.can_write_business_data(v_business_id) then
    raise exception 'You do not have permission to record income for this business.'
      using errcode = '42501';
  end if;

  -- 2. Idempotency.
  if v_client_key is not null then
    select * into v_existing
      from public.invoices
     where business_id = v_business_id and client_key = v_client_key
     limit 1;
    if found then
      return jsonb_build_object(
        'id', v_existing.id,
        'number', v_existing.invoice_number,
        'journal_entry_id', v_existing.journal_entry_id,
        'idempotent', true
      );
    end if;
  end if;

  -- 3. Validate. Discounts/WHT/vat must route to the legacy invoice builder.
  if v_invoice is null or jsonb_typeof(v_invoice) <> 'object'
     or v_lines is null or jsonb_typeof(v_lines) <> 'array'
     or jsonb_array_length(v_lines) = 0 then
    raise exception 'Malformed quick-sale payload.' using errcode = 'P0001';
  end if;
  if coalesce((v_invoice->>'discount_amount')::numeric, 0) > 0.005
     or v_vat > 0
     or coalesce((v_invoice->>'wht_amount')::numeric, 0) > 0.005 then
    raise exception 'Quick-sale RPC handles plain paid invoices only.'
      using errcode = 'P0001', detail = 'discount_or_vat';
  end if;

  v_total      := (v_invoice->>'total_amount')::numeric;
  v_currency   := coalesce(v_invoice->>'original_currency', v_invoice->>'currency');
  v_rate       := (v_invoice->>'exchange_rate')::numeric;
  v_functional := coalesce((v_invoice->>'functional_amount')::numeric, v_total * v_rate);

  if v_total is null or v_total <= 0 or v_rate is null or v_rate <= 0 then
    raise exception 'Enter a valid amount.' using errcode = 'P0001';
  end if;
  -- The revenue credit must reconcile with the cash debit (no discounts or
  -- VAT reach this function, so subtotal + vat must equal the total).
  if v_subtotal is null or abs(v_subtotal + v_vat - v_total) > 0.005 then
    raise exception 'Sale subtotal (%) does not match the total amount (%).',
      round(coalesce(v_subtotal, 0)::numeric, 2), round(v_total::numeric, 2)
      using errcode = 'P0001';
  end if;
  if (v_invoice->>'contact_id')::uuid is null then
    raise exception 'A customer contact is required.' using errcode = 'P0001';
  end if;

  -- 4. Usage limit, then reserve the number.
  perform public._ledgr_assert_usage_limit(v_business_id);
  v_number := public.reserve_next_document_number(v_business_id, 'invoice');

  -- 5. Insert header + lines.
  insert into public.invoices (
    business_id, invoice_number, invoice_type, status, contact_id,
    issue_date, due_date, currency, exchange_rate,
    original_currency, original_amount, functional_currency, functional_amount,
    rate_date, rate_is_stale, subtotal, discount_amount, discount_percent,
    taxable_amount, vat_amount, wht_amount, total_amount, amount_paid,
    ar_account_id, notes, branch_id, department_id, client_key
  ) values (
    v_business_id,
    v_number,
    coalesce(v_invoice->>'invoice_type', 'invoice'),
    'paid',
    (v_invoice->>'contact_id')::uuid,
    (v_invoice->>'issue_date')::date,
    coalesce((v_invoice->>'due_date')::date, (v_invoice->>'issue_date')::date),
    coalesce(v_invoice->>'currency', v_currency),
    v_rate,
    v_currency,
    (v_invoice->>'original_amount')::numeric,
    v_invoice->>'functional_currency',
    v_functional,
    (v_invoice->>'rate_date')::date,
    coalesce((v_invoice->>'rate_is_stale')::boolean, false),
    v_subtotal,
    0, 0,
    v_subtotal,
    v_vat,
    0,
    v_total,
    v_total,
    (v_invoice->>'ar_account_id')::uuid,
    coalesce(v_invoice->>'notes', v_invoice->>'description'),
    (v_invoice->>'branch_id')::uuid,
    (v_invoice->>'department_id')::uuid,
    v_client_key
  ) returning id into v_invoice_id;

  insert into public.invoice_lines (
    business_id, invoice_id, line_number, description, quantity, unit_price,
    discount_percent, tax_code, tax_rate, tax_amount, line_total, product_id, account_id
  )
  select
    v_business_id,
    v_invoice_id,
    (l->>'line_number')::numeric,
    l->>'description',
    (l->>'quantity')::numeric,
    (l->>'unit_price')::numeric,
    coalesce((l->>'discount_percent')::numeric, 0),
    coalesce(l->>'tax_code', 'none')::public.tax_code,
    (l->>'tax_rate')::numeric,
    (l->>'tax_amount')::numeric,
    (l->>'line_total')::numeric,
    (l->>'product_id')::uuid,
    (l->>'account_id')::uuid
  from jsonb_array_elements(v_lines) as l;

  -- 6. GL accounts (same codes as createInvoiceJournalEntry).
  v_debtors     := public._ledgr_account_by_code(v_business_id, '1131');
  v_cash        := public._ledgr_account_by_code(v_business_id, '1110');
  if v_invoice->>'revenue_account_id' is not null then
    begin
      v_revenue := public._ledgr_assert_account(
        (v_invoice->>'revenue_account_id')::uuid, v_business_id, 'revenue');
    exception when others then v_revenue := null;
    end;
  end if;
  if v_revenue is null then
    v_revenue := public._ledgr_account_by_code(v_business_id, '4112');
  end if;

  -- 7. Sale entry: DR Debtors total / CR Revenue subtotal [CR VAT].
  declare
    v_lines_sale jsonb := '[]'::jsonb;
  begin
    v_lines_sale := jsonb_build_array(jsonb_build_object(
      'account_id', v_debtors,
      'description', 'Invoice ' || v_number || ' — receivable',
      'is_debit', true,
      'amount', v_total,
      'amount_base', v_functional
    ));
    v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object(
      'account_id', v_revenue,
      'description', 'Invoice ' || v_number,
      'is_debit', false,
      'amount', v_subtotal,
      'amount_base', v_subtotal * v_rate
    ));
    if v_vat > 0 then
      v_vat_payable := public._ledgr_account_by_code(v_business_id, '2121');
      v_lines_sale := v_lines_sale || jsonb_build_array(jsonb_build_object(
        'account_id', v_vat_payable,
        'description', 'Invoice ' || v_number || ' — VAT',
        'is_debit', false,
        'amount', v_vat,
        'amount_base', v_vat * v_rate,
        'tax_code', 'vat_standard',
        'tax_amount', v_vat * v_rate
      ));
    end if;

    v_sale_entry := public._ledgr_post_entry(
      v_business_id,
      public.next_journal_entry_number(v_business_id),
      (v_invoice->>'issue_date')::date,
      'Invoice ' || v_number,
      'invoice',
      v_invoice_id::text,
      v_currency, v_rate,
      (v_invoice->>'branch_id')::uuid, (v_invoice->>'department_id')::uuid,
      v_lines_sale
    );
  end;

  -- 8. Receipt entry: DR Cash / CR Debtors (auto-paid).
  v_receipt_entry := public._ledgr_post_entry(
    v_business_id,
    public.next_journal_entry_number(v_business_id),
    (v_invoice->>'issue_date')::date,
    'Receipt for Invoice ' || v_number,
    'invoice',
    v_invoice_id::text,
    v_currency, v_rate,
    (v_invoice->>'branch_id')::uuid, (v_invoice->>'department_id')::uuid,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', v_cash,
        'description', 'Cash received — Invoice ' || v_number,
        'is_debit', true, 'amount', v_total, 'amount_base', v_functional),
      jsonb_build_object(
        'account_id', v_debtors,
        'description', 'Settle debtor — Invoice ' || v_number,
        'is_debit', false, 'amount', v_total, 'amount_base', v_functional)
    )
  );

  update public.invoices
     set journal_entry_id = v_sale_entry
   where id = v_invoice_id;

  -- 9. Stock release + COGS (mirrors deductStockAndPostCogs: read average
  --    cost BEFORE the movement lands; movement dated at issue_date; no
  --    balance writes here — see the header note about the out-of-band
  --    balance trigger).
  if jsonb_typeof(v_stock) = 'array' and jsonb_array_length(v_stock) > 0 then
    v_location := public._ledgr_stock_location(v_business_id, (v_invoice->>'branch_id')::uuid);
    if v_location is not null then
      for v_stock_line in select * from jsonb_array_elements(v_stock) loop
        if coalesce((v_stock_line->>'quantity')::numeric, 0) <= 0 then
          continue;
        end if;
        select * into v_product
          from public.products
         where id = (v_stock_line->>'product_id')::uuid
           and business_id = v_business_id
           and track_inventory = true;
        continue when not found;

        select * into v_balance
          from public.inventory_balances
         where business_id = v_business_id
           and product_id = v_product.id
           and location_id = v_location
         limit 1;
        v_unit_cost := coalesce(v_balance.average_cost, 0);

        insert into public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, source_type, source_id, reference, created_by
        ) values (
          v_business_id, v_product.id, v_location, 'sale',
          (v_invoice->>'issue_date')::date,
          -(v_stock_line->>'quantity')::numeric,
          v_unit_cost,
          'invoice', v_invoice_id, v_number,
          nullif(v_invoice->>'created_by', '')::uuid
        );

        v_cost_lines := v_cost_lines || jsonb_build_array(jsonb_build_object(
          'product_id', v_product.id,
          'quantity', (v_stock_line->>'quantity')::numeric,
          'unit_cost', v_unit_cost
        ));
      end loop;

      -- Same tolerance as postCogsForSale: the sale must not be blocked by a
      -- stock-valuation/accounting problem; the reconciliation panel
      -- surfaces the resulting variance.
      begin
        v_cogs_entry := public._ledgr_post_cogs(
          v_business_id, v_invoice_id, v_number,
          (v_invoice->>'issue_date')::date,
          (v_invoice->>'branch_id')::uuid, (v_invoice->>'department_id')::uuid,
          v_cost_lines
        );
      exception when others then
        raise warning 'COGS posting failed for invoice %: %', v_number, sqlerrm;
        v_cogs_entry := null;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'id', v_invoice_id,
    'number', v_number,
    'journal_entry_id', v_sale_entry,
    'receipt_entry_id', v_receipt_entry,
    'cogs_entry_id', v_cogs_entry,
    'idempotent', false
  );
end;
$$;
-- ── permissions (restated for the recreated functions; identical to
--    20260911000001 — create or replace preserves ACLs, this keeps the
--    migration self-contained) ────────────────────────────────────────────
revoke all on function public.save_quick_expense(jsonb) from public, anon;
revoke all on function public.save_quick_sale(jsonb) from public, anon;
revoke all on function public._ledgr_post_entry(uuid, text, date, text, text, text, text, numeric, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_quick_expense(jsonb) to authenticated;
grant execute on function public.save_quick_sale(jsonb) to authenticated;

comment on function public.save_quick_expense(jsonb) is
  'Atomic quick-expense save: authorize, de-duplicate by client_key, validate, reserve number, insert expense+lines, post journal, link, record stock movements — one round trip. Executor only: policy inputs (rate, VAT, accounts, amounts) are computed client-side.';
comment on function public.save_quick_sale(jsonb) is
  'Atomic quick-income save: authorize, de-duplicate by client_key, validate, reserve number, insert invoice+lines, post revenue + cash-receipt entries, link, release stock and post COGS — one round trip. Plain paid invoices only (no discount/VAT/WHT).';
