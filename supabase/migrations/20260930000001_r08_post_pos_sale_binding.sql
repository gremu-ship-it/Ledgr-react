-- R08.3 — Authoritative sale→shift association in post_pos_sale.
--
-- Replaces the function body (superset; the original 20260923000000 file is
-- untouched — this CREATE OR REPLACE supersedes it in replay order). Changes:
--   * terminal_id (optional) is the authoritative till context when present:
--     terminal ∈ business ∧ active ∧ DEC-03 branch scope hold; its branch is
--     stamped onto the invoice (caller branch that conflicts ⇒ 22023); the
--     caller's own open shift on that terminal is bound when no shift is
--     claimed; pos_shift_id is populated at insert (immutable afterwards via
--     the R08.2 trigger).
--   * Legacy (terminal-less) payloads keep their behaviour EXCEPT DEC-03 now
--     applies to branch-stamped payloads and claimed shifts must be
--     trusted-state consistent: unknown/foreign shift ⇒ 22023; terminal
--     conflict ⇒ 22023; another user's shift without manager tier ⇒ 42501;
--     inaccessible branch ⇒ 42501.
--   * A claimed CLOSED shift (offline/reconnect arrival) still posts — the
--     DEC-08 late-arrival adjustment is appended (never rewriting the close);
--     the legacy drawer-totals update keeps skipping closed shifts as before.
-- R06/R07 anchors preserved: stock/COGS/journal/tender/replay semantics and
-- the legacy drawer arithmetic are character-identical; the stock location
-- helper now receives the server-resolved branch value stamped on the invoice.

create or replace function public.post_pos_sale(p_payload jsonb)
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
  v_payments jsonb := coalesce(p_payload->'payments', '[]'::jsonb);
  v_is_credit boolean := coalesce((p_payload->>'is_credit_sale')::boolean, false);
  v_shift uuid := nullif(p_payload->>'shift_id','')::uuid;
  v_terminal uuid := nullif(p_payload->>'terminal_id','')::uuid;
  v_term record;
  v_shift_row record;
  v_branch_resolved uuid;
  v_late boolean := false;
  v_existing record;
  v_completion jsonb;
  v_contact uuid;
  v_number text;
  v_invoice_id uuid;

  v_total numeric;
  v_subtotal numeric;
  v_discount numeric;
  v_vat numeric;
  v_rate numeric;
  v_currency text;
  v_functional numeric;
  v_paid numeric := 0;

  v_payment jsonb;
  v_payment_key uuid;
  v_payment_id uuid;
  v_tender uuid;
begin
  -- 1. Authorization. SECURITY DEFINER, so this guard is mandatory, not
  --    decorative.
  if v_business_id is null or not public.can_operate_pos(v_business_id) then
    raise exception 'You do not have permission to record sales for this business.'
      using errcode = '42501';
  end if;

  -- 1b. R08 till-context authority (caller values may narrow a request, they
  --     may never broaden authority). When the request identifies a terminal,
  --     the terminal is authoritative for branch AND shift scope.
  v_branch_resolved := (v_invoice->>'branch_id')::uuid;
  if v_terminal is not null then
    select * into v_term from public.pos_terminals
     where id = v_terminal and business_id = v_business_id;
    if not found then
      raise exception 'Unknown or foreign terminal (R08).' using errcode = '22023';
    end if;
    if not v_term.is_active then
      raise exception 'Terminal is deactivated (R08).' using errcode = '22023';
    end if;
    if not public.can_access_branch(v_business_id, v_term.branch_id) then
      raise exception 'Caller has no access to the terminal''s branch (R08).' using errcode = '42501';
    end if;
    if v_branch_resolved is not null and v_branch_resolved <> v_term.branch_id then
      raise exception 'Payload branch conflicts with the authorised terminal branch (R08).' using errcode = '22023';
    end if;
    v_branch_resolved := v_term.branch_id;
    if v_shift is null and auth.uid() is not null then
      select * into v_shift_row from public.pos_shifts
       where business_id = v_business_id and terminal_id = v_terminal
         and cashier_id = auth.uid() and status = 'open'
       order by opened_at desc limit 1;
      if v_shift_row.id is not null then
        v_shift := v_shift_row.id;
      end if;
    end if;
  elsif v_branch_resolved is not null and not public.can_access_branch(v_business_id, v_branch_resolved) then
    raise exception 'Caller has no access to the requested branch (R08).' using errcode = '42501';
  end if;

  -- 1c. Any explicitly claimed shift must be trusted-state consistent: same
  --     business, in the caller's branch authority, owned by the caller (or a
  --     manager tier acting on record), and — if a terminal is bound — bound
  --     to that terminal. Closed-shift claims are preserved as DEC-08 late
  --     arrivals instead of silent drawer skips.
  if v_shift is not null then
    select * into v_shift_row from public.pos_shifts
     where id = v_shift and business_id = v_business_id;
    if v_shift_row.id is null then
      raise exception 'Unknown or foreign shift (R08).' using errcode = '22023';
    end if;
    if v_terminal is not null and v_shift_row.terminal_id is distinct from v_terminal then
      raise exception 'Claimed shift does not belong to the claimed terminal (R08).' using errcode = '22023';
    end if;
    if v_shift_row.branch_id is not null and not public.can_access_branch(v_business_id, v_shift_row.branch_id) then
      raise exception 'Caller has no access to the shift''s branch (R08).' using errcode = '42501';
    end if;
    if v_shift_row.cashier_id is distinct from auth.uid() and not exists (
         select 1 from public.business_users bu
          where bu.business_id = v_business_id and bu.user_id = auth.uid()
            and bu.is_active = true and bu.role::text in ('owner','admin','manager')) then
      raise exception 'Sales may only be steered onto the caller''s own shift (R08).' using errcode = '42501';
    end if;
    if v_shift_row.status = 'closed' then
      v_late := true;
    end if;
  end if;
  v_branch_resolved := coalesce(v_branch_resolved, v_shift_row.branch_id);

  -- 2. Idempotency. A replay returns the committed document AND completes it,
  --    because the commit it is retrying may have died between the invoice and
  --    its ledger/stock half (see the header).
  if v_client_key is not null then
    select * into v_existing
      from public.invoices
     where business_id = v_business_id and client_key = v_client_key
     limit 1;

    if found then
      v_completion := public._ledgr_complete_pos_sale(v_business_id, v_existing.id);
      return jsonb_build_object(
        'id', v_existing.id,
        'number', v_existing.invoice_number,
        'journal_entry_id', coalesce(v_existing.journal_entry_id, (v_completion->>'journal_entry_id')::uuid),
        'idempotent', true
      );
    end if;
  end if;

  -- 3. Validate. The RPC is an executor: the client already resolved accounts
  --    and computed VAT/discount/functional amounts.
  if v_invoice is null or jsonb_typeof(v_invoice) <> 'object'
     or v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'Malformed POS sale payload.' using errcode = 'P0001';
  end if;

  v_total    := (v_invoice->>'total_amount')::numeric;
  v_subtotal := coalesce((v_invoice->>'subtotal')::numeric, 0);
  v_discount := coalesce((v_invoice->>'discount_amount')::numeric, 0);
  v_vat      := coalesce((v_invoice->>'vat_amount')::numeric, 0);
  v_rate     := coalesce((v_invoice->>'exchange_rate')::numeric, 1);
  v_currency := coalesce(v_invoice->>'original_currency', v_invoice->>'currency');
  v_functional := coalesce((v_invoice->>'functional_amount')::numeric, v_total * v_rate);

  if v_total is null or v_total <= 0 then
    raise exception 'Enter a valid sale total.' using errcode = 'P0001';
  end if;
  if v_rate is null or v_rate <= 0 then
    raise exception 'Enter a valid exchange rate for this sale.' using errcode = 'P0001';
  end if;

  select coalesce(sum((p->>'amount')::numeric), 0)
    into v_paid
    from jsonb_array_elements(v_payments) p;

  if not v_is_credit and abs(v_paid - v_total) > 0.01 then
    raise exception 'Tenders (%) do not settle the sale total (%).',
      round(v_paid, 2), round(v_total, 2) using errcode = 'P0001';
  end if;
  if v_is_credit and jsonb_array_length(v_payments) > 0 then
    raise exception 'A credit sale cannot carry tender lines.' using errcode = 'P0001';
  end if;

  -- 4. Plan limit, then the document number (an offline placeholder becomes a
  --    real number here).
  perform public._ledgr_assert_usage_limit(v_business_id);
  v_number := public.reserve_next_document_number(v_business_id, 'invoice');

  -- 5. The customer, resolved or created in SQL so the till needs no direct
  --    write on contacts.
  v_contact := public._ledgr_resolve_sale_contact(
    v_business_id, v_invoice->>'contact_id', coalesce(p_payload->'customer', '{}'::jsonb)
  );

  -- 6. Document + lines. The unique (business_id, client_key) index is the
  --    backstop for a concurrent double-submit.
  begin
    insert into public.invoices (
      business_id, invoice_number, invoice_type, status, contact_id,
      issue_date, due_date, currency, exchange_rate,
      original_currency, original_amount, functional_currency, functional_amount,
      rate_date, rate_is_stale, subtotal, discount_amount, discount_percent,
      taxable_amount, vat_amount, wht_amount, total_amount, amount_paid,
      ar_account_id, revenue_account_id, notes,
      branch_id, department_id, created_by, client_key, pos_shift_id
    ) values (
      v_business_id,
      v_number,
      coalesce(v_invoice->>'invoice_type', 'invoice'),
      coalesce(v_invoice->>'status', 'paid')::public.invoice_status,
      v_contact,
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
      v_discount,
      coalesce((v_invoice->>'discount_percent')::numeric, 0),
      coalesce((v_invoice->>'taxable_amount')::numeric, v_subtotal),
      v_vat,
      coalesce((v_invoice->>'wht_amount')::numeric, 0),
      v_total,
      v_paid,
      (v_invoice->>'ar_account_id')::uuid,
      (v_invoice->>'revenue_account_id')::uuid,
      coalesce(v_invoice->>'notes', v_invoice->>'description'),
      v_branch_resolved,
      (v_invoice->>'department_id')::uuid,
      v_invoice->>'created_by',
      v_client_key,
      v_shift
    ) returning id into v_invoice_id;
  exception when unique_violation then
    -- Lost a race with a retry of the same sale: fall in behind it.
    select * into v_existing
      from public.invoices
     where business_id = v_business_id and client_key = v_client_key
     limit 1;
    if not found then
      raise;
    end if;
    v_completion := public._ledgr_complete_pos_sale(v_business_id, v_existing.id);
    return jsonb_build_object(
      'id', v_existing.id,
      'number', v_existing.invoice_number,
      'journal_entry_id', coalesce(v_existing.journal_entry_id, (v_completion->>'journal_entry_id')::uuid),
      'idempotent', true
    );
  end;

  insert into public.invoice_lines (
    business_id, invoice_id, line_number, description, quantity, unit_price,
    discount_percent, discount_amount, tax_code, tax_rate, tax_amount, line_total,
    product_id, account_id
  )
  select
    v_business_id, v_invoice_id,
    coalesce((l->>'line_number')::numeric, row_number() over ()),
    l->>'description',
    (l->>'quantity')::numeric,
    (l->>'unit_price')::numeric,
    coalesce((l->>'discount_percent')::numeric, 0),
    coalesce((l->>'discount_amount')::numeric, 0),
    coalesce(l->>'tax_code', 'none')::public.tax_code,
    coalesce((l->>'tax_rate')::numeric, 0),
    coalesce((l->>'tax_amount')::numeric, 0),
    (l->>'line_total')::numeric,
    (l->>'product_id')::uuid,
    (l->>'account_id')::uuid
  from jsonb_array_elements(v_lines) l;

  -- 7. Tenders. Each row carries the key the client minted for it
  --    (deriveClientKey(clientKey, index)); the unique index makes a retry a
  --    no-op, and the stored row id is what the settlement entry is keyed by.
  for v_payment in select * from jsonb_array_elements(v_payments) loop
    v_payment_key := coalesce((v_payment->>'client_key')::uuid, gen_random_uuid());
    v_tender := (v_payment->>'bank_account_id')::uuid;
    if v_tender is null then
      v_tender := public._ledgr_account_by_code(v_business_id, '1110');
    end if;

    insert into public.invoice_payments (
      business_id, invoice_id, amount, currency, exchange_rate,
      original_amount, original_currency, functional_amount,
      payment_date, payment_method, bank_account_id, reference, created_by, client_key
    ) values (
      v_business_id, v_invoice_id, (v_payment->>'amount')::numeric,
      coalesce(v_payment->>'currency', v_currency),
      coalesce((v_payment->>'exchange_rate')::numeric, v_rate),
      coalesce((v_payment->>'original_amount')::numeric, (v_payment->>'amount')::numeric),
      coalesce(v_payment->>'original_currency', v_currency),
      coalesce((v_payment->>'functional_amount')::numeric, (v_payment->>'amount')::numeric),
      coalesce((v_payment->>'payment_date')::date, (v_invoice->>'issue_date')::date),
      coalesce(v_payment->>'payment_method', 'cash')::public.payment_method,
      v_tender,
      v_payment->>'reference',
      coalesce(v_payment->>'created_by', v_invoice->>'created_by'),
      v_payment_key
    )
    on conflict (business_id, client_key) do nothing;
  end loop;

  -- 8. Ledger, stock and COGS — the same helper the replay path uses.
  v_completion := public._ledgr_complete_pos_sale(v_business_id, v_invoice_id);

  -- 9. Drawer totals, only while the shift is open: a closed shift has been
  --    counted, explained and signed, and rewriting it afterwards would make
  --    the Z-report disagree with the data behind it. The caller surfaces a
  --    warning when a sale lands after its shift closed (applyShiftTotals).
  --    Arithmetic copied from PosRepository.updateShiftTotals, including the
  --    absolute recomputation of expected_cash: the drawer expectation is
  --    opening float + cash sales + cash in − cash out − refunds, so it must be
  --    derived from the shift's own movement columns rather than incremented —
  --    incrementing would ignore a cash-in/cash-out or a refund recorded since.
  if v_shift is not null then
    update public.pos_shifts
       set cash_sales_amount  = cash_sales_amount  + coalesce((p_payload->>'cash_sales')::numeric, 0),
           other_sales_amount = other_sales_amount + coalesce((p_payload->>'other_sales')::numeric, 0),
           total_sales_amount =
             (cash_sales_amount + coalesce((p_payload->>'cash_sales')::numeric, 0))
             + (other_sales_amount + coalesce((p_payload->>'other_sales')::numeric, 0)),
           expected_cash =
             opening_cash
             + (cash_sales_amount + coalesce((p_payload->>'cash_sales')::numeric, 0))
             + cash_in_amount - cash_out_amount - refunds_amount,
           updated_at = now()
     where id = v_shift
       and business_id = v_business_id
       and status = 'open';
  end if;

  -- 9b. DEC-08 late arrival: the sale committed against a shift that is
  --     already closed. The historical close stays untouched; the arrival is
  --     recorded as an append-only adjustment (unique on command key).
  if v_late then
    insert into public.pos_shift_late_adjustments (
      business_id, shift_id, invoice_id, command_key, amount, reason, detected_at
    ) values (
      v_business_id, v_shift, v_invoice_id,
      v_client_key::text || ':late', coalesce(v_total, 0),
      'POS sale posted after the shift closed (offline/reconnect arrival; DEC-08).',
      now()
    ) on conflict (business_id, command_key) do nothing;
  end if;

  return jsonb_build_object(
    'id', v_invoice_id,
    'number', v_number,
    'journal_entry_id', (v_completion->>'journal_entry_id')::uuid,
    'cogs_entry_id', (v_completion->>'cogs_entry_id')::uuid,
    'idempotent', false
  );
end;
$$;

