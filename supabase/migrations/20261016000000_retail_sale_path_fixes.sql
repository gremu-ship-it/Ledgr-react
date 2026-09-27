-- ============================================================================
-- 20261016000000_retail_sale_path_fixes.sql
--
-- RETAIL CUSTOMER PATH FIXES (audit 2026-09-27) — P0/P1 only, no redesign.
--
-- All four defects were reproduced end-to-end against a full migration replay
-- of this branch with the production-shaped schema (uuid source_id/created_by)
-- using the REAL client payload builders (buildPosSaleQueuePayload →
-- buildPosSaleRpcPayload). Evidence per fix:
--
-- FIX A (P0 — Z-report shows zero sales). The till client posts invoice
--   status 'sent' (src/services/posService.ts, since PR #157) and nothing
--   flips it: post_pos_sale inserts the client's status verbatim. But
--   get_pos_shift_report and close_pos_shift_command derive drawer totals
--   ONLY from invoices with status='paid' — so every real till sale was
--   invisible to the Z-report (observed: 2 sales posted, report showed
--   cash 0 / count 0 / variance = the whole drawer). Release-suite fixtures
--   always sent status 'paid', which is why the gate never saw this.
--   Fix: a non-credit sale whose tenders settle the total is inserted as
--   'paid' — the same rule record_invoice_payment applies (amount_paid ≥
--   total ⇒ paid). Credit/unpaid sales keep the client's status.
--
-- FIX B (P0 — mobile money posted to cash). post_pos_sale defaulted EVERY
--   tender without an explicit bank_account_id to 1110 Cash on Hand, and the
--   client sends none — so an Airtel Money tender's settlement debited cash
--   (observed). The legacy client path resolved 1125/1126/bank accounts
--   (resolveTenderAccountId); the RPC path never did. Fix: server-side
--   resolution mirroring the legacy rule (see _ledgr_pos_tender_account).
--
-- FIX C (P0 — sale without a shift crashes). With no shift_id and no
--   terminal_id, post_pos_sale raised 55000 "record v_shift_row is not
--   assigned yet" (observed) because v_branch_resolved := coalesce(...,
--   v_shift_row.branch_id) reads a record that was never selected. The till
--   UI does not gate checkout on an open shift, so a cashier who skips shift
--   opening gets a raw database error and the sale fails. Fix: only read the
--   shift row when a shift was resolved.
--
-- FIX D (P1 — first walk-in sale of a new business fails). A business with
--   zero customer contacts cannot serve a walk-in: _ledgr_resolve_sale_contact
--   raised 'This sale has no customer...'. The client documents a seeded
--   'Walk-in Customer' (ContactRepository.findDefaultSaleContact) but business
--   creation seeds none. Fix: create the default 'Walk-in Customer' contact
--   when the business has no customer to bill the sale to.
--
-- Everything else in the re-issued bodies is byte-identical to the latest
-- definitions (post_pos_sale = 20261012000000; _ledgr_resolve_sale_contact =
-- 20260923000000). R06/R07/R08/R10 behaviour, keys, idempotency and grants
-- are unchanged. No historical migration is edited.
-- ============================================================================

-- ── FIX B helper: tender account by payment method (legacy client rule) ────
create or replace function public._ledgr_pos_tender_account(
  p_business_id uuid,
  p_method text,
  p_explicit uuid default null
) returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- An explicit account wins, exactly as the previous code did (the settlement
  -- posting still validates it belongs to this business via _ledgr_assert_account).
  if p_explicit is not null then
    return p_explicit;
  end if;
  if coalesce(p_method, 'cash') = 'cash' then
    return public._ledgr_account_by_code(p_business_id, '1110');
  end if;
  if p_method in ('airtel_money', 'tnm_mpamba') then
    select id into v_id
      from public.accounts
     where business_id = p_business_id
       and code = (case p_method when 'airtel_money' then '1125' else '1126' end)
       and is_active = true
       and is_group = false
       and deleted_at is null
     limit 1;
    -- Legacy behaviour: no mobile-money account on file ⇒ post to cash on hand.
    return coalesce(v_id, public._ledgr_account_by_code(p_business_id, '1110'));
  end if;
  -- card / bank_transfer / cheque / other: the first bank account, else cash.
  select id into v_id
    from public.accounts
   where business_id = p_business_id
     and is_bank_account = true
     and is_active = true
     and is_group = false
     and deleted_at is null
   order by name
   limit 1;
  return coalesce(v_id, public._ledgr_account_by_code(p_business_id, '1110'));
end;
$$;

revoke all on function public._ledgr_pos_tender_account(uuid, text, uuid) from public, anon, authenticated;
comment on function public._ledgr_pos_tender_account(uuid, text, uuid) is
  'Tender account for a POS payment: explicit bank_account_id wins; cash → 1110; airtel_money → 1125; tnm_mpamba → 1126; other tenders → first bank account — falling back to 1110 when the account does not exist (legacy resolveTenderAccountId rule, now server-side).';

-- ── post_pos_sale: latest body (20261012000000) + FIX A/B/C ─────────────────
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
  v_incoming_hash text := public._ledgr_pos_payload_hash(p_payload);

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

  -- For mismatch field fallback when stored hash is null (pre-P5-A rows)
  v_stored_line_sum numeric;
  v_incoming_line_sum numeric;
  v_stored_line_count bigint;
  v_incoming_line_count bigint;
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
  -- RETAIL FIX C (2026-09-27): only read v_shift_row inside the shift branch.
  -- A sale without a shift (no shift_id, no terminal) previously crashed with
  -- 55000 "record v_shift_row is not assigned yet" because the record was
  -- never selected; the till UI does not force a shift before checkout.
  if v_shift is not null then
    v_branch_resolved := coalesce(v_branch_resolved, v_shift_row.branch_id);
  end if;

  -- 2. Idempotency. A replay returns the committed document AND completes it,
  --    because the commit it is retrying may have died between the invoice and
  --    its ledger/stock half (see the header).
  --    P5-A: if the same clientKey was already committed with a materially
  --    different payload, do NOT silently return it — raise mismatch so the
  --    offline queue quarantines (clientKey-payload-mismatch, 22023) and no
  --    second posting occurs (replay-safe).
  if v_client_key is not null then
    select * into v_existing
      from public.invoices
     where business_id = v_business_id and client_key = v_client_key
     limit 1;

    if found then
      -- P5-A mismatch guard: authoritative comparison. Hash when present,
      -- else material field fallback for pre-P5-A rows (NULL hash).
      if v_existing.payload_hash is not null then
        if v_existing.payload_hash is distinct from v_incoming_hash then
          raise exception 'clientKey payload mismatch: the same clientKey (%) was previously committed with a different payload (payload-tampered / clientKey-payload-mismatch). Original id=% total=% vs incoming total=% hash stored % vs incoming %. No second posting.',
            v_client_key, v_existing.id, v_existing.total_amount, (v_invoice->>'total_amount')::numeric, v_existing.payload_hash, v_incoming_hash
            using errcode = '22023';
        end if;
      else
        -- Fallback for pre-P5-A rows without stored hash: compare material fields.
        -- v_total is derived later from v_invoice; compute here for comparison
        -- by reading the same field we will validate below.
        -- Use total_amount first (the financial identity of the sale).
        if v_existing.total_amount is distinct from (v_invoice->>'total_amount')::numeric then
          raise exception 'clientKey payload mismatch: the same clientKey (%) was previously committed with a different total (%) vs incoming (%). payload-tampered / clientKey-payload-mismatch.',
            v_client_key, v_existing.total_amount, (v_invoice->>'total_amount')::numeric
            using errcode = '22023';
        end if;
        -- Also compare lines sum if totals happen to match but lines differ (e.g. discount change).
        -- Lightweight: sum line_total from stored invoice_lines vs incoming v_lines.
        select coalesce(sum(line_total),0) into v_stored_line_sum
          from public.invoice_lines
         where invoice_id = v_existing.id and business_id = v_business_id;
        select coalesce(sum((l->>'line_total')::numeric),0) into v_incoming_line_sum
          from jsonb_array_elements(v_lines) l;
        if v_stored_line_sum is distinct from v_incoming_line_sum then
          raise exception 'clientKey payload mismatch: the same clientKey (%) was previously committed with different lines sum (%) vs incoming (%). payload-tampered / clientKey-payload-mismatch.',
            v_client_key, v_stored_line_sum, v_incoming_line_sum
            using errcode = '22023';
        end if;
        -- Also compare line counts as an additional material signal.
        select count(*) into v_stored_line_count
          from public.invoice_lines
         where invoice_id = v_existing.id and business_id = v_business_id;
        v_incoming_line_count := jsonb_array_length(v_lines);
        if v_stored_line_count is distinct from v_incoming_line_count then
          raise exception 'clientKey payload mismatch: the same clientKey (%) was previously committed with different line count (%) vs incoming (%). payload-tampered / clientKey-payload-mismatch.',
            v_client_key, v_stored_line_count, v_incoming_line_count
            using errcode = '22023';
        end if;
      end if;

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

  -- 3b. R06 (register 2026-09-23, POS command surface): every caller-supplied
  --     product reference is tenant-validated at the command boundary.
  if exists (
    select 1
      from jsonb_array_elements(v_lines) l
     where nullif(l->>'product_id', '') is not null
       and not exists (
         select 1
           from public.products p
          where p.id = (l->>'product_id')::uuid
            and p.business_id = v_business_id
       )
  ) then
    raise exception 'A sale line references a product that does not belong to this business (R06).'
      using errcode = '22023';
  end if;

  -- H-2 (2026-09-26): server-side arithmetic authority over browser amounts.
  perform public._ledgr_assert_pos_sale_amounts(v_business_id, v_invoice, v_lines);

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
  --    backstop for a concurrent double-submit. P5-A stores payload_hash.
  begin
    insert into public.invoices (
      business_id, invoice_number, invoice_type, status, contact_id,
      issue_date, due_date, currency, exchange_rate,
      original_currency, original_amount, functional_currency, functional_amount,
      rate_date, rate_is_stale, subtotal, discount_amount, discount_percent,
      taxable_amount, vat_amount, wht_amount, total_amount, amount_paid,
      ar_account_id, revenue_account_id, notes,
      branch_id, department_id, created_by, client_key, pos_shift_id, payload_hash
    ) values (
      v_business_id,
      v_number,
      coalesce(v_invoice->>'invoice_type', 'invoice'),
      -- RETAIL FIX A (2026-09-27): a till sale whose tenders settle the total is
      -- 'paid' at insert. The client posts status 'sent' (buildPosSaleQueuePayload)
      -- and nothing flipped it afterwards, so get_pos_shift_report and
      -- close_pos_shift_command — which derive drawer totals from invoices with
      -- status='paid' — showed ZERO sales and a false variance for every real
      -- till sale. Credit sales and unpaid sales keep the client's status.
      case when not v_is_credit and abs(v_paid - v_total) <= 0.01
             then 'paid'::public.invoice_status
             else coalesce(v_invoice->>'status', 'paid')::public.invoice_status
      end,
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
      coalesce(auth.uid(), public._ledgr_try_uuid(v_invoice->>'created_by')),  -- actor, uuid on live DB (2026-09-27)
      v_client_key,
      v_shift,
      v_incoming_hash
    ) returning id into v_invoice_id;
  exception when unique_violation then
    -- Lost a race with a retry of the same sale: fall in behind it,
    -- but P5-A must still enforce mismatch guard before returning idempotent.
    select * into v_existing
      from public.invoices
     where business_id = v_business_id and client_key = v_client_key
     limit 1;
    if not found then
      raise;
    end if;
    -- Same mismatch guard as the idempotency-hit path above (duplicated for the race window).
    if v_existing.payload_hash is not null then
      if v_existing.payload_hash is distinct from v_incoming_hash then
        raise exception 'clientKey payload mismatch (race): the same clientKey (%) was previously committed with a different payload (payload-tampered / clientKey-payload-mismatch). Original id=% hash stored % vs incoming %. No second posting.',
          v_client_key, v_existing.id, v_existing.payload_hash, v_incoming_hash
          using errcode = '22023';
      end if;
    else
      if v_existing.total_amount is distinct from (v_invoice->>'total_amount')::numeric then
        raise exception 'clientKey payload mismatch (race): the same clientKey (%) was previously committed with a different total (%) vs incoming (%). payload-tampered / clientKey-payload-mismatch.',
          v_client_key, v_existing.total_amount, (v_invoice->>'total_amount')::numeric
          using errcode = '22023';
      end if;
      select coalesce(sum(line_total),0) into v_stored_line_sum
        from public.invoice_lines
       where invoice_id = v_existing.id and business_id = v_business_id;
      select coalesce(sum((l->>'line_total')::numeric),0) into v_incoming_line_sum
        from jsonb_array_elements(v_lines) l;
      if v_stored_line_sum is distinct from v_incoming_line_sum then
        raise exception 'clientKey payload mismatch (race): the same clientKey (%) was previously committed with different lines sum (%) vs incoming (%). payload-tampered / clientKey-payload-mismatch.',
          v_client_key, v_stored_line_sum, v_incoming_line_sum
          using errcode = '22023';
      end if;
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
    -- RETAIL FIX B (2026-09-27): resolve the tender account from the payment
    -- method, mirroring the legacy client rule (resolveTenderAccountId): mobile
    -- money lands on 1125/1126, card/transfer on the first bank account, cash
    -- (and any fallback) on 1110. The client sends no bank_account_id, so the
    -- previous default sent EVERY tender to cash on hand.
    v_tender := public._ledgr_pos_tender_account(
      v_business_id,
      coalesce(v_payment->>'payment_method', 'cash'),
      (v_payment->>'bank_account_id')::uuid);

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
      coalesce(auth.uid(), public._ledgr_try_uuid(coalesce(v_payment->>'created_by', v_invoice->>'created_by'))),
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


-- ── _ledgr_resolve_sale_contact: latest body (20260923000000) + FIX D ──────
create or replace function public._ledgr_resolve_sale_contact(
  p_business_id uuid,
  p_contact_id text,
  p_customer jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_customer->>'name', ''));
  v_is_walk_in boolean;
  v_new_id uuid;
begin
  -- A real server id for this business is used as-is.
  if p_contact_id is not null and p_contact_id ~ '^[0-9a-fA-F-]{36}$' then
    select id into v_id
      from public.contacts
     where id = p_contact_id::uuid
       and business_id = p_business_id
       and deleted_at is null
     limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  -- coalesce is load-bearing: with a null contact_id the third predicate would
  -- evaluate to NULL, and `IF NOT v_is_walk_in` is then also NULL (not false),
  -- so a named customer would silently fall through to the walk-in branch.
  v_is_walk_in := v_name = ''
    or v_name ~* '^walk[\s-]?in'
    or coalesce(p_contact_id, '') = 'offline_walk_in_customer';

  if not v_is_walk_in then
    -- A named customer: reuse an existing contact with the same name (keeps
    -- retries from piling up duplicates), else create it now.
    select id into v_id
      from public.contacts
     where business_id = p_business_id
       and contact_type = 'customer'
       and is_active = true
       and deleted_at is null
       and lower(btrim(name)) = lower(v_name)
     order by created_at
     limit 1;
    if v_id is not null then
      return v_id;
    end if;

    -- wht_exempt is NOT NULL with no default (see 20250101000000); the UI form
    -- passes false explicitly, and resolveSaleContact in posService omits it —
    -- which fails on a schema without the out-of-band default. Pass it.
    insert into public.contacts (
      business_id, name, contact_type, is_active, phone, email, wht_exempt
    ) values (
      p_business_id, v_name, 'customer', true,
      nullif(btrim(coalesce(p_customer->>'phone', '')), ''),
      nullif(btrim(coalesce(p_customer->>'email', '')), ''),
      false
    ) returning id into v_new_id;
    return v_new_id;
  end if;

  -- Walk-in: the named default customer if the business has one, else its
  -- first active customer — same order as ContactRepository.findDefaultSaleContact.
  select id into v_id
    from public.contacts
   where business_id = p_business_id
     and contact_type = 'customer'
     and is_active = true
     and deleted_at is null
     and name = 'Walk-in Customer'
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  select id into v_id
    from public.contacts
   where business_id = p_business_id
     and contact_type = 'customer'
     and is_active = true
     and deleted_at is null
   order by name
   limit 1;

  -- RETAIL FIX D (2026-09-27): a brand-new business has no customers at all, so
  -- the very first walk-in cash sale failed with 'This sale has no customer...'.
  -- Create the default 'Walk-in Customer' contact instead — the same contact the
  -- client's ContactRepository.findDefaultSaleContact documents as seeded.
  if v_id is null then
    insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt)
    values (p_business_id, 'Walk-in Customer', 'customer', true, false)
    returning id into v_new_id;
    return v_new_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.post_pos_sale(jsonb) from public, anon;
grant execute on function public.post_pos_sale(jsonb) to authenticated;


-- ── FIX E (P0): void_pos_sale_command must reverse the COGS entry too ──────
-- Body = 20261014000001 (latest) with ONLY the reversal selection extended:
-- the COGS entry (source_type 'inventory_cogs', posting_key
-- 'invoice:<id>:cogs') is now mirrored like sale/settlement, exactly as the
-- R07 contract documents ("full mirror-reversal of ALL posted journal entries
-- (sale + settlement + COGS)"). Reversal keys stay 'void:<entry_id>', so an
-- idempotent replay still finds them and never double-reverses.
create or replace function public.void_pos_sale_command(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_invoice uuid := coalesce((p_payload->>'invoice_id')::uuid, (p_payload->>'document_id')::uuid);
  v_key text := p_payload->>'command_key';
  v_reason text := coalesce(p_payload->>'reason', 'Transaction voided');
  v_approval_token uuid := nullif(p_payload->>'approval_token','')::uuid;
  v_pre record; v_approval uuid;
  v_existing record; v_entry record; v_reversal uuid;
  v_reversal_entries uuid[] := array[]::uuid[];
  v_move record;
  v_location uuid;
begin
  if v_business is null or v_invoice is null then
    raise exception 'business_id and invoice_id are required.' using errcode = '22023';
  end if;
  if v_key is null or length(v_key) > 64 then
    raise exception 'command_key is required (<=64 chars).' using errcode = '22023';
  end if;

  -- Idempotent replay fence.
  select * into v_existing from public.pos_corrections
   where business_id = v_business and command_key = v_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'command_type', v_existing.command_type,
      'document_id', v_existing.document_id, 'journal_entries', '[]'::jsonb, 'idempotent', true);
  end if;

  select * into v_pre from public._ledgr_correction_preflight(v_business, v_invoice, 'void_sale', v_approval_token);
  v_approval := v_pre.approval_id;

  -- Status machine: a void operates on a live document; corrected or
  -- refunded documents follow the refund path for remaining amounts.
  if v_pre.doc_status = 'void' then
    raise exception 'This document has already been voided.' using errcode = '22023';
  end if;
  if exists (select 1 from public.pos_corrections
              where business_id = v_business and document_id = v_invoice and command_type = 'refund_sale') then
    raise exception 'This document has refunds recorded; void it by refunding the remaining amount instead.'
        using errcode = '22023';
  end if;

  -- Financial reversal: mirror EVERY posted journal entry of the invoice with
  -- flipped debit/credit at identical amounts/currency. Posting keys are
  -- 'void:<entry_id>' so a re-run can never double-reverse a single entry.
  for v_entry in
    select je.id, je.entry_number, je.description, coalesce(je.exchange_rate,1) rate
      from public.journal_entries je
     where je.business_id = v_business
       and (
         (je.source_type = 'invoice' and je.source_id::text = v_invoice::text)
         -- RETAIL FIX E (2026-09-27): the COGS entry is posted with
         -- source_type 'inventory_cogs' (see _ledgr_post_cogs), so the original
         -- invoice-only filter never found it — voiding a stock sale reversed
         -- revenue and tender but left DR COGS / CR Inventory standing while
         -- the stock was restored, diverging the GL from the stock subledger.
         or je.posting_key = 'invoice:' || v_invoice::text || ':cogs'
       )
     order by je.created_at, je.id
  loop
    v_reversal := public._ledgr_post_entry_keyed(
      v_business,
      'void:' || v_entry.id::text,
      current_date,
      'Void of ' || v_entry.description,
      'invoice',
      v_invoice::text,
      coalesce(v_pre.doc_currency,'MWK'), coalesce(v_entry.rate,1),
      v_pre.doc_branch_id, v_pre.doc_department_id,
      (select jsonb_agg(jsonb_build_object(
          'account_id', jl.account_id,
          'description', replace(jl.description,'Void of ',''),
          'is_debit', not jl.is_debit,
          'amount', jl.amount,
          'amount_base', jl.amount_base,
          'tax_code', jl.tax_code,
          'tax_amount', -coalesce(jl.tax_amount,0)))
        from public.journal_lines jl where jl.journal_entry_id = v_entry.id)
    );
    v_reversal_entries := v_reversal_entries || v_reversal;
  end loop;

  -- Restock: mirror each stock movement with the opposite signed quantity at
  -- the ORIGINAL unit cost (R06 trigger propagates the balance exactly once).
  v_location := public._ledgr_stock_location(v_business, v_pre.doc_branch_id);
  if v_location is not null then
    for v_move in
      select product_id, -quantity qty, unit_cost
        from public.stock_movements
       where business_id = v_business and source_type = 'invoice' and source_id::text = v_invoice::text
    loop
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by, notes
      ) values (
        v_business, v_move.product_id, v_location, 'return_in',
        current_date, v_move.qty, v_move.unit_cost,
        'pos_void', v_invoice,
        'Void ' || coalesce(v_pre.doc_invoice_number, v_invoice::text), auth.uid(),
        'correction key ' || v_key
      );
    end loop;
  end if;

  update public.invoices
     set status = 'void',
         notes = coalesce(notes,'') || ' [VOIDED by correction command ' || v_key || ': ' || v_reason || ']'
   where id = v_invoice;

  insert into public.pos_corrections (business_id, command_key, command_type, document_id,
      amount, currency, lines, approval_id, reason, created_by)
  values (v_business, v_key, 'void_sale', v_invoice, abs(coalesce(v_pre.doc_original_amount, v_pre.doc_total_amount,0)),
      coalesce(v_pre.doc_currency,'MWK'), '[]'::jsonb, v_approval, v_reason, auth.uid());

  return jsonb_build_object('document_id', v_invoice, 'status', 'void',
      'journal_entries', to_jsonb(v_reversal_entries), 'idempotent', false);
end;
$$;
