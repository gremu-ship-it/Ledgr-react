-- ============================================================================
-- 20261011000002_ic_atomic_payment_commands.sql
-- INCIDENT CONTAINMENT 2026-09-25 — P6: atomic, idempotent payment commands
-- ============================================================================
-- Finding (crawl 2026-09-25, CONFIRMED HIGH): InvoiceRepository.recordPayment
-- and ExpenseRepository.recordPayment were three/four independent requests
-- (insert payment → increment_amount_paid → status update → settlement
-- journal). A failure after the insert left a payment that never moved
-- amount_paid; a retry with the same client key then returned early, so the
-- gap became permanent. There was no server-side overpayment guard.
--
-- New commands (one transaction each, all-or-nothing):
--   public.record_invoice_payment(p_payment jsonb, p_client_key uuid)
--   public.record_expense_payment(p_payment jsonb, p_client_key uuid)
--
--   1. require an authenticated caller (auth.uid());
--   2. lock the parent document (SELECT … FOR UPDATE) — serialises concurrent
--      payments on one document, so the overpayment guard cannot be raced;
--   3. authorise with the INTERSECTION of every check the old multi-request
--      flow needed to fully succeed — never broader:
--        invoice: can_write_sales_data ∧ can_access_branch(invoice.branch_id)
--                 (invoice_payments insert + invoices update RLS)
--                 ∧ can_write_business_data (increment_amount_paid)
--        expense: can_write_expense_data ∧ can_access_branch(expense.branch_id)
--                 ∧ can_write_business_data
--      The payload's business_id must equal the document's business;
--   4. replay: an existing payment under (business_id, client_key) is returned
--      unchanged with idempotent=true (no insert, no increment, no journal).
--      A key reused for a different document is rejected (22023);
--   5. validate: amount > 0; document not void (/credit_note); amount may not
--      exceed the outstanding balance by more than 0.01;
--   6. insert the payment (only known client-settable columns; business_id,
--      document id, client_key and created_by are server-set);
--   7. amount_paid += amount; invoice status follows the SAME rule as
--      src/lib/paymentStatus.ts paymentStatusFromAmounts (void/credit_note
--      never change). Expense status is untouched (parity with the old path);
--   8. post the settlement journal under the SAME posting key the client used
--      (invoice:<id>:settlement:<payment> / expense:<id>:payment:<payment>)
--      via _ledgr_post_entry_keyed, so a later client settlement call for the
--      same payment resumes this entry instead of double-posting;
--   9. link journal ids; return {payment, invoice|expense, journal_entry_id,
--      idempotent}.
--   A unique_violation on the client key (concurrent first attempts) rolls
--   the loser back and returns the winner's committed payment.
--
-- Settlement journal (mirror of journalService.createInvoiceSettlementEntry /
-- createExpenseSettlementEntry): cash = payment.bank_account_id else 1110;
-- invoice DR cash @ functional_amount / CR 1131 @ original × invoice rate;
-- expense DR 2111 @ original × expense rate / CR cash @ functional_amount;
-- realised FX = the functional difference (receivable gain → CR 4230, loss →
-- DR 7300; payable mirrored), omitted below 0.005. Account tenancy is enforced
-- by _ledgr_post_entry → _ledgr_assert_account.
--
-- NOT touched: existing payments, amount_paid values, statuses or journals
-- (historical repair not authorised); RLS policies; increment_amount_paid.
-- No data is read or written by this migration.
-- ============================================================================

-- ── 1. Invoice payments ──────────────────────────────────────────────────────
create or replace function public.record_invoice_payment(p_payment jsonb, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'amount','bank_account_id','currency','exchange_rate','exchange_rate_used',
    'functional_amount','functional_currency','notes','original_amount',
    'original_currency','payment_date','payment_method','rate_date',
    'rate_is_stale','reference'];
  v_invoice_id uuid;
  v_inv public.invoices%rowtype;
  v_pay public.invoice_payments%rowtype;
  v_amount numeric;
  v_cols text;
  v_vals text;
  v_next public.invoices.status%type;
  v_paid numeric;
  v_currency text;
  v_original numeric;
  v_rate numeric;
  v_booked numeric;
  v_cash_base numeric;
  v_clear_base numeric;
  v_fx numeric;
  v_cash uuid;
  v_debtors uuid;
  v_lines jsonb;
  v_entry uuid;
  v_idempotent boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to record a payment.' using errcode = '42501';
  end if;
  if p_payment is null or jsonb_typeof(p_payment) <> 'object' then
    raise exception 'Malformed payment payload.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required so a retried payment cannot be recorded twice.' using errcode = '22023';
  end if;
  begin
    v_invoice_id := (p_payment->>'invoice_id')::uuid;
  exception when others then
    raise exception 'Malformed invoice id.' using errcode = '22023';
  end;

  -- 2. Lock the invoice (serialises concurrent payments on it).
  select * into v_inv from public.invoices where id = v_invoice_id and deleted_at is null for update;
  if not found then
    raise exception 'Invoice not found or you lack permission to record a payment on it.' using errcode = '42501';
  end if;

  -- 3. Authorisation — intersection of the old flow's RLS + RPC checks.
  if (p_payment ? 'business_id') and (p_payment->>'business_id') is distinct from v_inv.business_id::text then
    raise exception 'Invoice not found or you lack permission to record a payment on it.' using errcode = '42501';
  end if;
  if not (public.can_write_sales_data(v_inv.business_id)
          and public.can_access_branch(v_inv.business_id, v_inv.branch_id)
          and public.can_write_business_data(v_inv.business_id)) then
    raise exception 'Invoice not found or you lack permission to record a payment on it.' using errcode = '42501';
  end if;

  -- 4. Replay: return the committed payment unchanged.
  select * into v_pay from public.invoice_payments
   where business_id = v_inv.business_id and client_key = p_client_key;
  if found then
    if v_pay.invoice_id <> v_inv.id then
      raise exception 'clientKey payload mismatch: this client key was already used for a different invoice.' using errcode = '22023';
    end if;
    v_idempotent := true;
  else
    -- 5. Validate.
    begin
      v_amount := (p_payment->>'amount')::numeric;
    exception when others then
      v_amount := null;
    end;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Enter a valid payment amount.' using errcode = '23514';
    end if;
    if v_inv.status::text in ('void', 'credit_note') then
      raise exception 'Cannot record a payment against a % invoice.', v_inv.status using errcode = '23514';
    end if;
    if v_amount > (coalesce(v_inv.total_amount, 0) - coalesce(v_inv.amount_paid, 0)) + 0.01 then
      raise exception 'Payment of % exceeds the outstanding balance of % on invoice %.',
        round(v_amount, 2), round(coalesce(v_inv.total_amount, 0) - coalesce(v_inv.amount_paid, 0), 2), v_inv.invoice_number
        using errcode = '23514';
    end if;

    -- 6. Insert — only known client-settable columns; the rest server-set.
    select coalesce(string_agg(format('%I', k), ',' order by k), ''),
           coalesce(string_agg(format('r.%I', k), ',' order by k), '')
      into v_cols, v_vals
      from jsonb_object_keys(p_payment) k
     where k = any (v_allowed);
    begin
      execute format(
        'insert into public.invoice_payments (business_id, invoice_id, client_key, created_by%s) '
        'select $1, $2, $3, $4%s from jsonb_populate_record(null::public.invoice_payments, $5) r returning *',
        case when v_cols = '' then '' else ',' || v_cols end,
        case when v_vals = '' then '' else ',' || v_vals end)
      into v_pay
      using v_inv.business_id, v_inv.id, p_client_key, auth.uid(), p_payment;
    exception when unique_violation then
      -- Concurrent first attempt with the same key committed first.
      select * into v_pay from public.invoice_payments
       where business_id = v_inv.business_id and client_key = p_client_key;
      if not found then raise; end if;
      if v_pay.invoice_id <> v_inv.id then
        raise exception 'clientKey payload mismatch: this client key was already used for a different invoice.' using errcode = '22023';
      end if;
      v_idempotent := true;
    end;
  end if;

  if not v_idempotent then
    -- 7. amount_paid + status (paymentStatusFromAmounts).
    v_paid := coalesce(v_inv.amount_paid, 0) + v_pay.amount;
    v_next := case
      when v_paid <= 0 then 'sent'
      when v_paid >= coalesce(v_inv.total_amount, 0) then 'paid'
      else 'partially_paid' end;
    update public.invoices
       set amount_paid = v_paid,
           status = case when status::text in ('void', 'credit_note') then status else v_next end
     where id = v_inv.id
     returning * into v_inv;

    -- 8. Settlement journal (same posting key as the client path).
    v_currency   := coalesce(v_pay.original_currency, v_pay.currency);
    v_original   := coalesce(v_pay.original_amount, v_pay.amount);
    v_rate       := coalesce(nullif(v_pay.exchange_rate, 0), 1);
    v_booked     := coalesce(nullif(v_inv.exchange_rate, 0), v_rate);
    v_cash_base  := coalesce(v_pay.functional_amount, v_pay.amount);
    v_clear_base := v_original * v_booked;
    v_fx         := v_cash_base - v_clear_base;   -- receivable: + gain, − loss
    v_cash       := coalesce(v_pay.bank_account_id, public._ledgr_account_by_code(v_inv.business_id, '1110'));
    v_debtors    := public._ledgr_account_by_code(v_inv.business_id, '1131');

    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_cash, 'is_debit', true,
        'description', 'Cash received — Invoice ' || v_inv.invoice_number,
        'amount', v_original, 'amount_base', v_cash_base),
      jsonb_build_object('account_id', v_debtors, 'is_debit', false,
        'description', 'Settle debtor — Invoice ' || v_inv.invoice_number,
        'amount', v_original, 'amount_base', v_clear_base));
    if abs(v_fx) >= 0.005 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', public._ledgr_account_by_code(v_inv.business_id, case when v_fx > 0 then '4230' else '7300' end),
        'is_debit', v_fx < 0,
        'description', 'Invoice ' || v_inv.invoice_number || ' — realised FX ' || case when v_fx > 0 then 'gain' else 'loss' end,
        'amount', abs(v_fx) / v_rate, 'amount_base', abs(v_fx)));
    end if;

    v_entry := public._ledgr_post_entry_keyed(
      v_inv.business_id,
      'invoice:' || v_inv.id::text || ':settlement:' || v_pay.id::text,
      coalesce(v_pay.payment_date, current_date),
      'Receipt for Invoice ' || v_inv.invoice_number,
      'invoice', v_inv.id::text, v_currency, v_rate,
      v_inv.branch_id, v_inv.department_id, v_lines);

    -- 9. Links.
    update public.invoice_payments set journal_entry_id = v_entry where id = v_pay.id returning * into v_pay;
    if v_inv.journal_entry_id is null then
      update public.invoices set journal_entry_id = v_entry where id = v_inv.id returning * into v_inv;
    end if;
  else
    select id into v_entry from public.journal_entries
     where business_id = v_inv.business_id
       and posting_key = 'invoice:' || v_inv.id::text || ':settlement:' || v_pay.id::text;
  end if;

  return jsonb_build_object(
    'payment', to_jsonb(v_pay),
    'invoice', to_jsonb(v_inv),
    'journal_entry_id', v_entry,
    'idempotent', v_idempotent);
end;
$$;

comment on function public.record_invoice_payment(jsonb, uuid) is
  'IC 2026-09-25 P6: atomic idempotent invoice payment — authorise (RLS-equivalent intersection), lock invoice, replay by client_key, validate (amount>0, not void/credit_note, no overpayment >0.01), insert, amount_paid+status, keyed settlement journal, link. All-or-nothing.';
revoke all on function public.record_invoice_payment(jsonb, uuid) from public, anon;
grant execute on function public.record_invoice_payment(jsonb, uuid) to authenticated;

-- ── 2. Expense payments ──────────────────────────────────────────────────────
create or replace function public.record_expense_payment(p_payment jsonb, p_client_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_allowed constant text[] := array[
    'amount','bank_account_id','currency','exchange_rate','exchange_rate_used',
    'functional_amount','functional_currency','notes','original_amount',
    'original_currency','payment_date','payment_method','rate_date',
    'rate_is_stale','reference'];
  v_expense_id uuid;
  v_exp public.expenses%rowtype;
  v_pay public.expense_payments%rowtype;
  v_amount numeric;
  v_cols text;
  v_vals text;
  v_currency text;
  v_original numeric;
  v_rate numeric;
  v_booked numeric;
  v_cash_base numeric;
  v_clear_base numeric;
  v_fx numeric;
  v_cash uuid;
  v_creditors uuid;
  v_lines jsonb;
  v_entry uuid;
  v_idempotent boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Authentication required to record a payment.' using errcode = '42501';
  end if;
  if p_payment is null or jsonb_typeof(p_payment) <> 'object' then
    raise exception 'Malformed payment payload.' using errcode = '22023';
  end if;
  if p_client_key is null then
    raise exception 'A client key is required so a retried payment cannot be recorded twice.' using errcode = '22023';
  end if;
  begin
    v_expense_id := (p_payment->>'expense_id')::uuid;
  exception when others then
    raise exception 'Malformed expense id.' using errcode = '22023';
  end;

  select * into v_exp from public.expenses where id = v_expense_id and deleted_at is null for update;
  if not found then
    raise exception 'Expense not found or you lack permission to record a payment on it.' using errcode = '42501';
  end if;
  if (p_payment ? 'business_id') and (p_payment->>'business_id') is distinct from v_exp.business_id::text then
    raise exception 'Expense not found or you lack permission to record a payment on it.' using errcode = '42501';
  end if;
  if not (public.can_write_expense_data(v_exp.business_id)
          and public.can_access_branch(v_exp.business_id, v_exp.branch_id)
          and public.can_write_business_data(v_exp.business_id)) then
    raise exception 'Expense not found or you lack permission to record a payment on it.' using errcode = '42501';
  end if;

  select * into v_pay from public.expense_payments
   where business_id = v_exp.business_id and client_key = p_client_key;
  if found then
    if v_pay.expense_id <> v_exp.id then
      raise exception 'clientKey payload mismatch: this client key was already used for a different expense.' using errcode = '22023';
    end if;
    v_idempotent := true;
  else
    begin
      v_amount := (p_payment->>'amount')::numeric;
    exception when others then
      v_amount := null;
    end;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Enter a valid payment amount.' using errcode = '23514';
    end if;
    if v_exp.status::text = 'void' then
      raise exception 'Cannot record a payment against a void expense.' using errcode = '23514';
    end if;
    if v_amount > (coalesce(v_exp.total_amount, 0) - coalesce(v_exp.amount_paid, 0)) + 0.01 then
      raise exception 'Payment of % exceeds the outstanding balance of % on expense %.',
        round(v_amount, 2), round(coalesce(v_exp.total_amount, 0) - coalesce(v_exp.amount_paid, 0), 2), v_exp.expense_number
        using errcode = '23514';
    end if;

    select coalesce(string_agg(format('%I', k), ',' order by k), ''),
           coalesce(string_agg(format('r.%I', k), ',' order by k), '')
      into v_cols, v_vals
      from jsonb_object_keys(p_payment) k
     where k = any (v_allowed);
    begin
      execute format(
        'insert into public.expense_payments (business_id, expense_id, client_key, created_by%s) '
        'select $1, $2, $3, $4%s from jsonb_populate_record(null::public.expense_payments, $5) r returning *',
        case when v_cols = '' then '' else ',' || v_cols end,
        case when v_vals = '' then '' else ',' || v_vals end)
      into v_pay
      using v_exp.business_id, v_exp.id, p_client_key, auth.uid(), p_payment;
    exception when unique_violation then
      select * into v_pay from public.expense_payments
       where business_id = v_exp.business_id and client_key = p_client_key;
      if not found then raise; end if;
      if v_pay.expense_id <> v_exp.id then
        raise exception 'clientKey payload mismatch: this client key was already used for a different expense.' using errcode = '22023';
      end if;
      v_idempotent := true;
    end;
  end if;

  if not v_idempotent then
    update public.expenses
       set amount_paid = coalesce(amount_paid, 0) + v_pay.amount
     where id = v_exp.id
     returning * into v_exp;

    v_currency   := coalesce(v_pay.original_currency, v_pay.currency);
    v_original   := coalesce(v_pay.original_amount, v_pay.amount);
    v_rate       := coalesce(nullif(v_pay.exchange_rate, 0), 1);
    v_booked     := coalesce(nullif(v_exp.exchange_rate, 0), v_rate);
    v_cash_base  := coalesce(v_pay.functional_amount, v_pay.amount);
    v_clear_base := v_original * v_booked;
    v_fx         := v_cash_base - v_clear_base;   -- payable: + loss, − gain
    v_cash       := coalesce(v_pay.bank_account_id, public._ledgr_account_by_code(v_exp.business_id, '1110'));
    v_creditors  := public._ledgr_account_by_code(v_exp.business_id, '2111');

    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_creditors, 'is_debit', true,
        'description', 'Settle creditor — Expense ' || v_exp.expense_number,
        'amount', v_original, 'amount_base', v_clear_base),
      jsonb_build_object('account_id', v_cash, 'is_debit', false,
        'description', 'Cash paid — Expense ' || v_exp.expense_number,
        'amount', v_original, 'amount_base', v_cash_base));
    if abs(v_fx) >= 0.005 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', public._ledgr_account_by_code(v_exp.business_id, case when v_fx > 0 then '7300' else '4230' end),
        'is_debit', v_fx > 0,
        'description', 'Expense ' || v_exp.expense_number || ' — realised FX ' || case when v_fx > 0 then 'loss' else 'gain' end,
        'amount', abs(v_fx) / v_rate, 'amount_base', abs(v_fx)));
    end if;

    v_entry := public._ledgr_post_entry_keyed(
      v_exp.business_id,
      'expense:' || v_exp.id::text || ':payment:' || v_pay.id::text,
      coalesce(v_pay.payment_date, current_date),
      'Payment for Expense ' || v_exp.expense_number,
      'expense', v_exp.id::text, v_currency, v_rate,
      v_exp.branch_id, v_exp.department_id, v_lines);

    update public.expense_payments set journal_entry_id = v_entry where id = v_pay.id returning * into v_pay;
  else
    select id into v_entry from public.journal_entries
     where business_id = v_exp.business_id
       and posting_key = 'expense:' || v_exp.id::text || ':payment:' || v_pay.id::text;
  end if;

  return jsonb_build_object(
    'payment', to_jsonb(v_pay),
    'expense', to_jsonb(v_exp),
    'journal_entry_id', v_entry,
    'idempotent', v_idempotent);
end;
$$;

comment on function public.record_expense_payment(jsonb, uuid) is
  'IC 2026-09-25 P6: atomic idempotent expense payment — authorise (RLS-equivalent intersection), lock expense, replay by client_key, validate (amount>0, not void, no overpayment >0.01), insert, amount_paid, keyed settlement journal, link. All-or-nothing.';
revoke all on function public.record_expense_payment(jsonb, uuid) from public, anon;
grant execute on function public.record_expense_payment(jsonb, uuid) to authenticated;
