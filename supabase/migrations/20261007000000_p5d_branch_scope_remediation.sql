-- ============================================================================
-- 20261007000000_p5d_branch_scope_remediation.sql
-- P5-D — DEC-03 Branch Scope Remediation / R08.7 Enforcement
--
-- Implements signed DEC-03 contract (business_users.branch_id durable,
-- NULL = org-wide for USER assignment only, org-wide roles
-- owner|admin|manager|accountant|auditor span all branches, assigned-scope
-- cashier|stock_clerk|branch_manager|sales_clerk|sales_manager|
-- purchasing_officer|warehouse_worker|customer_service_rep restricted to
-- assigned branch, server must resolve/validate, caller branch never trusted,
-- can_access_branch is authoritative predicate).
--
-- Changes:
--  1) Redefine can_access_branch to enforce DEC-03 correctly:
--     - org-wide roles bypass branch check (any branch, including NULL)
--     - assigned-scope roles: branch_id IS NOT NULL AND = p_branch_id (fail closed on NULL)
--     - other roles: legacy (NULL = org-wide, else must match) preserved
--  2) Add can_access_location helper for location-derived branch checks
--  3) Harden save_quick_* RPCs to validate branch via can_access_branch
--  4) Enforce branch RLS on core tables with branch_id:
--     invoices, expenses, journal_entries, journal_lines,
--     inventory_locations, departments, branches, accounts,
--     employees, fixed_assets, budget_lines
--     and location-derived tables: stock_movements, inventory_balances,
--     stock_transfers (via can_access_location)
--  5) Preserve till-family branch enforcement (already via can_access_branch)
--
-- Idempotent. No data migration. Security definer predicates pinned.
-- ============================================================================

-- ── 1. can_access_branch — DEC-03 authoritative predicate ───────────────────
create or replace function public.can_access_branch(p_business_id uuid, p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and (
        -- DEC-03 org-wide: span all branches, including NULL
        bu.role::text in ('owner','admin','manager','accountant','auditor')
        -- DEC-03 assigned-scope: must be bound to the requested branch, fail closed on NULL
        or (
          bu.role::text in (
            'cashier','stock_clerk','branch_manager','sales_clerk','sales_manager',
            'purchasing_officer','warehouse_worker','customer_service_rep'
          )
          and bu.branch_id is not null
          and bu.branch_id = p_branch_id
        )
        -- Unlisted roles (payroll_manager, supervisor, data_entry, inventory_manager,
        -- tax_compliance_officer, treasury_manager, asset_manager, board_member, viewer, etc.)
        -- preserve legacy: NULL assignment = org-wide, else must match requested branch.
        -- This avoids inventing new confinement for roles DEC-03 does not name.
        or (
          bu.role::text not in (
            'owner','admin','manager','accountant','auditor',
            'cashier','stock_clerk','branch_manager','sales_clerk','sales_manager',
            'purchasing_officer','warehouse_worker','customer_service_rep'
          )
          and (bu.branch_id is null or bu.branch_id = p_branch_id)
        )
      )
  );
$$;

comment on function public.can_access_branch(uuid, uuid) is
  'DEC-03 matrix: org-wide roles (owner,admin,manager,accountant,auditor) span all branches; assigned-scope (cashier, stock_clerk, branch_manager, sales_clerk, sales_manager, purchasing_officer, warehouse_worker, customer_service_rep) restricted to business_users.branch_id (NULL assignment = fail closed, not org-wide); other roles preserve legacy NULL=org-wide. Server-side only; call sites must pass trusted branch ids (e.g. from terminal/location), never raw caller values for authorization. P5-D 20261007.';

revoke all on function public.can_access_branch(uuid, uuid) from public;
grant execute on function public.can_access_branch(uuid, uuid) to authenticated, service_role;

-- ── 2. can_access_location — location-derived branch check ──────────────────
create or replace function public.can_access_location(p_business_id uuid, p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when p_location_id is null then false
      else public.can_access_branch(
        p_business_id,
        (select branch_id from public.inventory_locations where id = p_location_id)
      )
    end;
$$;

comment on function public.can_access_location(uuid, uuid) is
  'Location-derived branch predicate: resolves inventory_locations.branch_id and delegates to can_access_branch. For stock_movements/inventory_balances/stock_transfers. P5-D.';

revoke all on function public.can_access_location(uuid, uuid) from public;
grant execute on function public.can_access_location(uuid, uuid) to authenticated, service_role;

-- ── 3. Harden quick-save RPCs — branch validation ──────────────────────────
-- We redefine the two RPCs to add branch checks before any write, keeping
-- all other semantics identical. This is safe to run even if the original
-- RPCs were already hardened in a prior P5-D attempt (create or replace).

-- save_quick_expense: validate branch via can_access_branch before insert
create or replace function public.save_quick_expense(p_payload jsonb)
returns jsonb
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
  v_branch_id uuid := (v_expense->>'branch_id')::uuid;
begin
  if v_business_id is null or not public.can_write_expense_data(v_business_id) then
    raise exception 'You do not have permission to record expenses for this business.'
      using errcode = '42501';
  end if;

  -- P5-D: branch scope (DEC-03). Caller branch is never trusted; server validates.
  -- For assigned-scope users, NULL branch fails closed (can_access_branch false for NULL).
  if v_branch_id is not null and not public.can_access_branch(v_business_id, v_branch_id) then
    raise exception 'You do not have access to the requested branch.'
      using errcode = '42501';
  end if;
  -- Fail closed for assigned-scope with no branch on a branch-scoped document
  if v_branch_id is null then
    -- If caller is assigned-scope and has a non-null assignment, they must target that branch
    -- We detect assigned-scope by checking they are NOT org-wide and NOT legacy org-wide (NULL assignment)
    -- If can_access_branch is false for NULL, that's an assigned user with NULL-branch row attempt -> deny
    -- But we allow org-wide or legacy NULL-assignment users to create NULL-branch rows.
    -- So we only deny if the user would be denied for NULL branch but would pass for their assigned branch.
    -- Simplest: if user is assigned-scope (has non-null branch) and tries NULL, deny.
    if exists (
      select 1 from public.business_users bu
       where bu.business_id = v_business_id
         and bu.user_id = auth.uid()
         and bu.is_active = true
         and bu.role::text in ('cashier','stock_clerk','branch_manager','sales_clerk','sales_manager','purchasing_officer','warehouse_worker','customer_service_rep')
         and bu.branch_id is not null
    ) then
      raise exception 'You do not have access to the requested branch.'
        using errcode = '42501', detail = 'assigned-scope requires branch';
    end if;
  end if;

  if v_client_key is not null then
    select * into v_existing from public.expenses where business_id = v_business_id and client_key = v_client_key limit 1;
    if found then return jsonb_build_object('id', v_existing.id, 'number', v_existing.expense_number, 'journal_entry_id', v_existing.journal_entry_id, 'idempotent', true); end if;
  end if;

  if v_expense is null or jsonb_typeof(v_expense) <> 'object' or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 or v_allocations is null or jsonb_typeof(v_allocations) <> 'array' or jsonb_array_length(v_allocations) = 0 then
    raise exception 'Malformed quick-expense payload.' using errcode = 'P0001';
  end if;

  v_total := (v_expense->>'total_amount')::numeric; v_currency := coalesce(v_expense->>'original_currency', v_expense->>'currency'); v_rate := (v_expense->>'exchange_rate')::numeric; v_functional := coalesce((v_expense->>'functional_amount')::numeric, v_total * v_rate);
  if v_total is null or v_total <= 0 or v_rate is null or v_rate <= 0 then raise exception 'Enter a valid amount.' using errcode = 'P0001'; end if;
  if coalesce((v_expense->>'discount_amount')::numeric, 0) > 0.005 then raise exception 'Quick-save RPC handles undiscounted expenses only.' using errcode = 'P0001', detail = 'discount'; end if;
  for v_alloc in select * from jsonb_array_elements(v_allocations) loop v_alloc_sum := v_alloc_sum + (v_alloc->>'amount')::numeric; end loop;
  if abs(v_alloc_sum + v_vat - v_total) > 0.01 then raise exception 'Expense allocations (% + VAT % = %) do not match the total amount (%).', round(v_alloc_sum::numeric, 2), round(v_vat::numeric, 2), round((v_alloc_sum + v_vat)::numeric, 2), round(v_total::numeric, 2) using errcode = 'P0001'; end if;

  perform public._ledgr_assert_usage_limit(v_business_id);
  v_number := public.reserve_next_document_number(v_business_id, 'expense');

  insert into public.expenses (business_id, expense_number, expense_type, status, expense_date, currency, exchange_rate, original_currency, original_amount, functional_currency, functional_amount, rate_date, rate_is_stale, subtotal, vat_amount, wht_amount, total_amount, amount_paid, reference, notes, branch_id, department_id, client_key)
  values (v_business_id, v_number, coalesce(v_expense->>'expense_type', 'receipt'), coalesce(v_expense->>'status', 'paid'), (v_expense->>'expense_date')::date, coalesce(v_expense->>'currency', v_currency), v_rate, v_currency, (v_expense->>'original_amount')::numeric, v_expense->>'functional_currency', v_functional, (v_expense->>'rate_date')::date, coalesce((v_expense->>'rate_is_stale')::boolean, false), (v_expense->>'subtotal')::numeric, v_vat, coalesce((v_expense->>'wht_amount')::numeric, 0), v_total, coalesce((v_expense->>'amount_paid')::numeric, v_total), v_expense->>'reference', coalesce(v_expense->>'notes', v_expense->>'description'), v_branch_id, (v_expense->>'department_id')::uuid, v_client_key) returning id into v_expense_id;

  insert into public.expense_lines (business_id, expense_id, line_number, description, quantity, unit_price, tax_code, tax_rate, tax_amount, line_total, product_id, account_id)
  select v_business_id, v_expense_id, (l->>'line_number')::numeric, l->>'description', (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce(l->>'tax_code', 'none')::public.tax_code, (l->>'tax_rate')::numeric, (l->>'tax_amount')::numeric, (l->>'line_total')::numeric, (l->>'product_id')::uuid, public._ledgr_assert_account((l->>'account_id')::uuid, v_business_id, 'expense line') from jsonb_array_elements(v_lines) as l;

  for v_alloc in select * from jsonb_array_elements(v_allocations) loop v_jlines := v_jlines || jsonb_build_array(jsonb_build_object('account_id', v_alloc->>'account_id', 'description', coalesce(v_alloc->>'description', 'Expense ' || v_number), 'is_debit', true, 'amount', (v_alloc->>'amount')::numeric, 'amount_base', (v_alloc->>'amount')::numeric * v_rate)); end loop;
  if v_vat > 0 then v_vat_account := public._ledgr_account_by_code(v_business_id, '1135'); v_jlines := v_jlines || jsonb_build_array(jsonb_build_object('account_id', v_vat_account, 'description', 'VAT input — Expense ' || v_number, 'is_debit', true, 'amount', v_vat, 'amount_base', v_vat * v_rate, 'tax_code', 'vat_standard', 'tax_amount', v_vat * v_rate)); end if;
  v_credit_account := public._ledgr_account_by_code(v_business_id, case when v_expense->>'expense_type' = 'bill' then '2111' else '1110' end);
  v_jlines := v_jlines || jsonb_build_array(jsonb_build_object('account_id', v_credit_account, 'description', 'Cash paid — Expense ' || v_number, 'is_debit', false, 'amount', v_total, 'amount_base', v_functional));
  v_journal_id := public._ledgr_post_entry(v_business_id, public.next_journal_entry_number(v_business_id), (v_expense->>'expense_date')::date, 'Expense ' || v_number, 'expense', v_expense_id::text, v_currency, v_rate, v_branch_id, (v_expense->>'department_id')::uuid, v_jlines);
  update public.expenses set journal_entry_id = v_journal_id where id = v_expense_id;

  if jsonb_typeof(v_stock) = 'array' and jsonb_array_length(v_stock) > 0 then
    v_location := public._ledgr_stock_location(v_business_id, v_branch_id);
    if v_location is not null then
      -- P5-D: location must be in accessible branch
      if not public.can_access_location(v_business_id, v_location) then
        raise exception 'You do not have access to the requested branch.'
          using errcode = '42501', detail = 'stock location branch';
      end if;
      for v_stock_line in select * from jsonb_array_elements(v_stock) loop
        if coalesce((v_stock_line->>'quantity')::numeric, 0) <= 0 then continue; end if;
        select * into v_product from public.products where id = (v_stock_line->>'product_id')::uuid and business_id = v_business_id and track_inventory = true; continue when not found;
        insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference, created_by)
        values (v_business_id, v_product.id, v_location, 'purchase', current_date, (v_stock_line->>'quantity')::numeric, (v_stock_line->>'unit_cost')::numeric, 'expense', v_expense_id::text, v_number, v_expense->>'created_by');
      end loop;
    end if;
  end if;

  return jsonb_build_object('id', v_expense_id, 'number', v_number, 'journal_entry_id', v_journal_id, 'idempotent', false);
end;
$$;

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
      begin v_cogs_entry := public._ledgr_post_cogs(v_business_id, v_invoice_id, v_number, (v_invoice->>'issue_date')::date, v_branch_id, (v_invoice->>'department_id')::uuid, v_cost_lines); exception when others then raise warning 'COGS posting failed for invoice %: %', v_number, sqlerrm; v_cogs_entry := null; end;
    end if;
  end if;

  return jsonb_build_object('id', v_invoice_id, 'number', v_number, 'journal_entry_id', v_sale_entry, 'receipt_entry_id', v_receipt_entry, 'cogs_entry_id', v_cogs_entry, 'idempotent', false);
end;
$$;

revoke all on function public.save_quick_expense(jsonb) from public, anon;
revoke all on function public.save_quick_sale(jsonb) from public, anon;
grant execute on function public.save_quick_expense(jsonb) to authenticated;
grant execute on function public.save_quick_sale(jsonb) to authenticated;

-- ── 4. Branch RLS — core tables with branch_id ─────────────────────────────
-- Helper: recreate policies with branch predicate. We keep the existing
-- can_write_* / is_business_member checks and ADD can_access_branch.

-- Invoices: member_read + writer_insert/update + admin_delete + platform
-- (from 20260815000003 + 20260922000000). We drop and recreate with branch.
do $$
declare t text; p record;
begin
  -- Invoices
  for p in select policyname from pg_policies where schemaname='public' and tablename='invoices' loop execute format('drop policy if exists %I on public.invoices', p.policyname); end loop;
  execute 'create policy invoices_member_read on public.invoices for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy invoices_writer_insert on public.invoices for insert with check (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy invoices_writer_update on public.invoices for update using (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy invoices_admin_delete on public.invoices for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy invoices_platform_admin_read on public.invoices for select using (public.is_platform_admin(auth.uid()))';

  -- Expenses: same but can_write_expense_data
  for p in select policyname from pg_policies where schemaname='public' and tablename='expenses' loop execute format('drop policy if exists %I on public.expenses', p.policyname); end loop;
  execute 'create policy expenses_member_read on public.expenses for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy expenses_writer_insert on public.expenses for insert with check (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy expenses_writer_update on public.expenses for update using (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy expenses_admin_delete on public.expenses for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy expenses_platform_admin_read on public.expenses for select using (public.is_platform_admin(auth.uid()))';

  -- Journal entries (branch_id) — reuse can_write_business_data tier (finance)
  for p in select policyname from pg_policies where schemaname='public' and tablename='journal_entries' loop execute format('drop policy if exists %I on public.journal_entries', p.policyname); end loop;
  execute 'create policy journal_entries_member_read on public.journal_entries for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy journal_entries_writer_insert on public.journal_entries for insert with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy journal_entries_writer_update on public.journal_entries for update using (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy journal_entries_admin_delete on public.journal_entries for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy journal_entries_platform_admin_read on public.journal_entries for select using (public.is_platform_admin(auth.uid()))';

  -- Journal lines (branch_id via journal_entries? has own branch_id nullable)
  for p in select policyname from pg_policies where schemaname='public' and tablename='journal_lines' loop execute format('drop policy if exists %I on public.journal_lines', p.policyname); end loop;
  -- journal_lines branch_id may be null; enforce if present, else allow (since lines inherit entry branch)
  execute 'create policy journal_lines_member_read on public.journal_lines for select using (public.is_business_member(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id)))';
  execute 'create policy journal_lines_writer_insert on public.journal_lines for insert with check (public.can_write_business_data(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id)))';
  execute 'create policy journal_lines_writer_update on public.journal_lines for update using (public.can_write_business_data(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id))) with check (public.can_write_business_data(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id)))';
  execute 'create policy journal_lines_admin_delete on public.journal_lines for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy journal_lines_platform_admin_read on public.journal_lines for select using (public.is_platform_admin(auth.uid()))';

  -- Invoice lines / payments — branch via parent invoice
  for p in select policyname from pg_policies where schemaname='public' and tablename='invoice_lines' loop execute format('drop policy if exists %I on public.invoice_lines', p.policyname); end loop;
  execute 'create policy invoice_lines_member_read on public.invoice_lines for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id)))';
  execute 'create policy invoice_lines_writer_insert on public.invoice_lines for insert with check (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id)))';
  execute 'create policy invoice_lines_writer_update on public.invoice_lines for update using (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id))) with check (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id)))';
  execute 'create policy invoice_lines_admin_delete on public.invoice_lines for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy invoice_lines_platform_admin_read on public.invoice_lines for select using (public.is_platform_admin(auth.uid()))';

  for p in select policyname from pg_policies where schemaname='public' and tablename='invoice_payments' loop execute format('drop policy if exists %I on public.invoice_payments', p.policyname); end loop;
  execute 'create policy invoice_payments_member_read on public.invoice_payments for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id)))';
  execute 'create policy invoice_payments_writer_insert on public.invoice_payments for insert with check (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id)))';
  execute 'create policy invoice_payments_writer_update on public.invoice_payments for update using (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id))) with check (public.can_write_sales_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id)))';
  execute 'create policy invoice_payments_admin_delete on public.invoice_payments for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy invoice_payments_platform_admin_read on public.invoice_payments for select using (public.is_platform_admin(auth.uid()))';

  for p in select policyname from pg_policies where schemaname='public' and tablename='expense_lines' loop execute format('drop policy if exists %I on public.expense_lines', p.policyname); end loop;
  execute 'create policy expense_lines_member_read on public.expense_lines for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id)))';
  execute 'create policy expense_lines_writer_insert on public.expense_lines for insert with check (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id)))';
  execute 'create policy expense_lines_writer_update on public.expense_lines for update using (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id))) with check (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id)))';
  execute 'create policy expense_lines_admin_delete on public.expense_lines for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy expense_lines_platform_admin_read on public.expense_lines for select using (public.is_platform_admin(auth.uid()))';

  for p in select policyname from pg_policies where schemaname='public' and tablename='expense_payments' loop execute format('drop policy if exists %I on public.expense_payments', p.policyname); end loop;
  execute 'create policy expense_payments_member_read on public.expense_payments for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id)))';
  execute 'create policy expense_payments_writer_insert on public.expense_payments for insert with check (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id)))';
  execute 'create policy expense_payments_writer_update on public.expense_payments for update using (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id))) with check (public.can_write_expense_data(business_id) and public.can_access_branch(business_id, (select branch_id from public.expenses where id = expense_id)))';
  execute 'create policy expense_payments_admin_delete on public.expense_payments for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy expense_payments_platform_admin_read on public.expense_payments for select using (public.is_platform_admin(auth.uid()))';

  -- Inventory locations (branch_id)
  for p in select policyname from pg_policies where schemaname='public' and tablename='inventory_locations' loop execute format('drop policy if exists %I on public.inventory_locations', p.policyname); end loop;
  execute 'create policy inventory_locations_member_read on public.inventory_locations for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy inventory_locations_writer_insert on public.inventory_locations for insert with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy inventory_locations_writer_update on public.inventory_locations for update using (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy inventory_locations_admin_delete on public.inventory_locations for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy inventory_locations_platform_admin_read on public.inventory_locations for select using (public.is_platform_admin(auth.uid()))';

  -- Departments (branch_id nullable)
  for p in select policyname from pg_policies where schemaname='public' and tablename='departments' loop execute format('drop policy if exists %I on public.departments', p.policyname); end loop;
  execute 'create policy departments_member_read on public.departments for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy departments_writer_insert on public.departments for insert with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy departments_writer_update on public.departments for update using (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy departments_admin_delete on public.departments for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy departments_platform_admin_read on public.departments for select using (public.is_platform_admin(auth.uid()))';

  -- Branches (id is the branch) — branch-scoped via id
  for p in select policyname from pg_policies where schemaname='public' and tablename='branches' loop execute format('drop policy if exists %I on public.branches', p.policyname); end loop;
  execute 'create policy branches_member_read on public.branches for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, id))';
  execute 'create policy branches_writer_insert on public.branches for insert with check (public.can_admin_business_data(business_id))';
  execute 'create policy branches_writer_update on public.branches for update using (public.can_admin_business_data(business_id)) with check (public.can_admin_business_data(business_id))';
  execute 'create policy branches_admin_delete on public.branches for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy branches_platform_admin_read on public.branches for select using (public.is_platform_admin(auth.uid()))';

  -- Employees (branch_id)
  for p in select policyname from pg_policies where schemaname='public' and tablename='employees' loop execute format('drop policy if exists %I on public.employees', p.policyname); end loop;
  execute 'create policy employees_member_read on public.employees for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy employees_writer_insert on public.employees for insert with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy employees_writer_update on public.employees for update using (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy employees_admin_delete on public.employees for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy employees_platform_admin_read on public.employees for select using (public.is_platform_admin(auth.uid()))';

  -- Fixed assets (branch_id)
  for p in select policyname from pg_policies where schemaname='public' and tablename='fixed_assets' loop execute format('drop policy if exists %I on public.fixed_assets', p.policyname); end loop;
  execute 'create policy fixed_assets_member_read on public.fixed_assets for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy fixed_assets_writer_insert on public.fixed_assets for insert with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy fixed_assets_writer_update on public.fixed_assets for update using (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy fixed_assets_admin_delete on public.fixed_assets for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy fixed_assets_platform_admin_read on public.fixed_assets for select using (public.is_platform_admin(auth.uid()))';

  -- Accounts (branch_id nullable)
  for p in select policyname from pg_policies where schemaname='public' and tablename='accounts' loop execute format('drop policy if exists %I on public.accounts', p.policyname); end loop;
  execute 'create policy accounts_member_read on public.accounts for select using (public.is_business_member(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id)))';
  execute 'create policy accounts_writer_insert on public.accounts for insert with check (public.can_write_business_data(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id)))';
  execute 'create policy accounts_writer_update on public.accounts for update using (public.can_write_business_data(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id))) with check (public.can_write_business_data(business_id) and (branch_id is null or public.can_access_branch(business_id, branch_id)))';
  execute 'create policy accounts_admin_delete on public.accounts for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy accounts_platform_admin_read on public.accounts for select using (public.is_platform_admin(auth.uid()))';

  -- Budget lines (branch_id) — budgets themselves are business-wide, lines are branched
  for p in select policyname from pg_policies where schemaname='public' and tablename='budget_lines' loop execute format('drop policy if exists %I on public.budget_lines', p.policyname); end loop;
  execute 'create policy budget_lines_member_read on public.budget_lines for select using (public.is_business_member(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy budget_lines_writer_insert on public.budget_lines for insert with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy budget_lines_writer_update on public.budget_lines for update using (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id)) with check (public.can_write_business_data(business_id) and public.can_access_branch(business_id, branch_id))';
  execute 'create policy budget_lines_admin_delete on public.budget_lines for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy budget_lines_platform_admin_read on public.budget_lines for select using (public.is_platform_admin(auth.uid()))';

end $$;

-- ── 5. Location-derived tables — branch via inventory_locations ─────────────
do $$
declare p record;
begin
  -- stock_movements: business_id + location_id -> branch
  for p in select policyname from pg_policies where schemaname='public' and tablename='stock_movements' loop execute format('drop policy if exists %I on public.stock_movements', p.policyname); end loop;
  execute 'create policy stock_movements_member_read on public.stock_movements for select using (public.is_business_member(business_id) and public.can_access_location(business_id, location_id))';
  execute 'create policy stock_movements_writer_insert on public.stock_movements for insert with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, location_id))';
  execute 'create policy stock_movements_writer_update on public.stock_movements for update using (public.can_write_business_data(business_id) and public.can_access_location(business_id, location_id)) with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, location_id))';
  execute 'create policy stock_movements_admin_delete on public.stock_movements for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy stock_movements_platform_admin_read on public.stock_movements for select using (public.is_platform_admin(auth.uid()))';

  -- inventory_balances
  for p in select policyname from pg_policies where schemaname='public' and tablename='inventory_balances' loop execute format('drop policy if exists %I on public.inventory_balances', p.policyname); end loop;
  execute 'create policy inventory_balances_member_read on public.inventory_balances for select using (public.is_business_member(business_id) and public.can_access_location(business_id, location_id))';
  execute 'create policy inventory_balances_writer_insert on public.inventory_balances for insert with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, location_id))';
  execute 'create policy inventory_balances_writer_update on public.inventory_balances for update using (public.can_write_business_data(business_id) and public.can_access_location(business_id, location_id)) with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, location_id))';
  execute 'create policy inventory_balances_admin_delete on public.inventory_balances for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy inventory_balances_platform_admin_read on public.inventory_balances for select using (public.is_platform_admin(auth.uid()))';

  -- stock_transfers: two locations, both must be accessible
  for p in select policyname from pg_policies where schemaname='public' and tablename='stock_transfers' loop execute format('drop policy if exists %I on public.stock_transfers', p.policyname); end loop;
  execute 'create policy stock_transfers_member_read on public.stock_transfers for select using (public.is_business_member(business_id) and public.can_access_location(business_id, from_location_id) and public.can_access_location(business_id, to_location_id))';
  execute 'create policy stock_transfers_writer_insert on public.stock_transfers for insert with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, from_location_id) and public.can_access_location(business_id, to_location_id))';
  execute 'create policy stock_transfers_writer_update on public.stock_transfers for update using (public.can_write_business_data(business_id) and public.can_access_location(business_id, from_location_id) and public.can_access_location(business_id, to_location_id)) with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, from_location_id) and public.can_access_location(business_id, to_location_id))';
  execute 'create policy stock_transfers_admin_delete on public.stock_transfers for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy stock_transfers_platform_admin_read on public.stock_transfers for select using (public.is_platform_admin(auth.uid()))';

  -- stock_transfer_lines — inherit via parent transfer's locations
  for p in select policyname from pg_policies where schemaname='public' and tablename='stock_transfer_lines' loop execute format('drop policy if exists %I on public.stock_transfer_lines', p.policyname); end loop;
  execute 'create policy stock_transfer_lines_member_read on public.stock_transfer_lines for select using (public.is_business_member(business_id) and public.can_access_location(business_id, (select from_location_id from public.stock_transfers where id = transfer_id)) and public.can_access_location(business_id, (select to_location_id from public.stock_transfers where id = transfer_id)))';
  execute 'create policy stock_transfer_lines_writer_insert on public.stock_transfer_lines for insert with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, (select from_location_id from public.stock_transfers where id = transfer_id)) and public.can_access_location(business_id, (select to_location_id from public.stock_transfers where id = transfer_id)))';
  execute 'create policy stock_transfer_lines_writer_update on public.stock_transfer_lines for update using (public.can_write_business_data(business_id) and public.can_access_location(business_id, (select from_location_id from public.stock_transfers where id = transfer_id)) and public.can_access_location(business_id, (select to_location_id from public.stock_transfers where id = transfer_id))) with check (public.can_write_business_data(business_id) and public.can_access_location(business_id, (select from_location_id from public.stock_transfers where id = transfer_id)) and public.can_access_location(business_id, (select to_location_id from public.stock_transfers where id = transfer_id)))';
  execute 'create policy stock_transfer_lines_admin_delete on public.stock_transfer_lines for delete using (public.can_admin_business_data(business_id))';
  execute 'create policy stock_transfer_lines_platform_admin_read on public.stock_transfer_lines for select using (public.is_platform_admin(auth.uid()))';
end $$;

-- ── 6. POS family already branch-scoped — ensure it stays pinned to new predicate
-- (pos_shifts, pos_cash_movements, pos_shift_closes, pos_terminals already use
-- can_access_branch; no policy rewrite needed, but we re-affirm grants)
revoke all on table public.pos_shifts from anon; grant all on table public.pos_shifts to authenticated, service_role;
revoke all on table public.pos_cash_movements from anon; grant all on table public.pos_cash_movements to authenticated, service_role;

-- ── 7. Revoke anon on hardened tables (defense in depth) ───────────────────
do $$
declare t text;
begin
  foreach t in array array['invoices','expenses','journal_entries','journal_lines','inventory_locations','departments','branches','employees','fixed_assets','accounts','budget_lines','stock_movements','inventory_balances','stock_transfers','stock_transfer_lines'] loop
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ── 8. Sanity: ensure every hardened table has at least one policy ─────────
do $$
declare missing text; _t text;
begin
  missing := null;
  foreach _t in array array['invoices','expenses','journal_entries','journal_lines','inventory_locations','departments','branches','employees','fixed_assets','accounts','budget_lines','stock_movements','inventory_balances','stock_transfers'] loop
    if not exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=_t) then
      missing := coalesce(missing || ', ', '') || _t;
    end if;
  end loop;
  if missing is not null then raise exception 'P5-D RLS incomplete — no policies on: %', missing; end if;
end $$;
