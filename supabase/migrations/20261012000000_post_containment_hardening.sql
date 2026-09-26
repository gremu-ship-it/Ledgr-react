-- POST-CONTAINMENT HARDENING 2026-09-26 (owner: A. Gremu). Code hardening only.
-- NO data change: this migration creates/replaces functions and triggers only.
-- It updates/deletes no rows, touches no balances, movements or journals.
--
--  H-2  _ledgr_assert_pos_sale_amounts + post_pos_sale (p5a body verbatim,
--       one injected call after step 3b). The server recomputes the POS
--       arithmetic contract (line totals, discounts, total, VAT, subtotal)
--       and rejects browser values that disagree (22023). Catalogue-price
--       authority and discount-cap enforcement are NOT enforced here:
--       DECISION REQUIRED — SERVER POS PRICING POLICY (see report §11).
--  H-3  record_inventory_journal_movement: stock receipt / stock adjustment
--       movements + their journal in ONE transaction. Balances are still
--       written only by the R06 stock_movements trigger.
--  H-4  Direct-API write guard on invoices / invoice_lines (applies only to
--       the `authenticated`/`anon` roles; SECURITY DEFINER commands run as
--       owner and are unaffected).

-- ═══════════════════════════ H-2 ═══════════════════════════
create or replace function public._ledgr_assert_pos_sale_amounts(
  p_business_id uuid, p_invoice jsonb, p_lines jsonb
) returns void
language plpgsql stable security definer set search_path = public
as $$
declare
  c_tol constant numeric := 0.01;
  v_l jsonb; v_n int := 0;
  v_q numeric; v_p numeric; v_d numeric; v_lt numeric;
  v_gross numeric := 0; v_line_disc numeric := 0; v_sum_lt numeric := 0;
  v_total numeric := (p_invoice->>'total_amount')::numeric;
  v_disc numeric := coalesce((p_invoice->>'discount_amount')::numeric, 0);
  v_vat numeric := coalesce((p_invoice->>'vat_amount')::numeric, 0);
  v_sub numeric;
  v_reg boolean; v_rate numeric; v_expected_vat numeric;
begin
  v_sub := coalesce((p_invoice->>'subtotal')::numeric, v_total - v_vat);
  for v_l in select value from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_q := (v_l->>'quantity')::numeric;
    v_p := (v_l->>'unit_price')::numeric;
    v_d := coalesce((v_l->>'discount_amount')::numeric, 0);
    v_lt := (v_l->>'line_total')::numeric;
    if v_q is null or v_q <= 0 or v_p is null or v_p < 0 or v_lt is null then
      raise exception 'POS sale line %: quantity must be positive, unit price non-negative and a line total present (H-2).', v_n
        using errcode = '22023';
    end if;
    if v_d < 0 or v_d > v_q * v_p + c_tol then
      raise exception 'POS sale line %: discount % is outside 0..% (H-2).', v_n, v_d, round(v_q * v_p, 2)
        using errcode = '22023';
    end if;
    if abs(v_q * v_p - v_d - v_lt) > c_tol then
      raise exception 'POS sale line %: line total % does not equal quantity × price − discount (%) (H-2).', v_n, v_lt, round(v_q * v_p - v_d, 2)
        using errcode = '22023';
    end if;
    v_gross := v_gross + v_q * v_p;
    v_line_disc := v_line_disc + v_d;
    v_sum_lt := v_sum_lt + v_lt;
  end loop;

  if v_disc < v_line_disc - c_tol or v_disc > v_gross + c_tol then
    raise exception 'POS sale discount % is inconsistent with its lines (line discounts %, gross %) (H-2).', v_disc, round(v_line_disc, 2), round(v_gross, 2)
      using errcode = '22023';
  end if;
  if v_total > v_sum_lt + c_tol or abs(v_gross - v_disc - v_total) > c_tol then
    raise exception 'POS sale total % does not equal gross % − discount % (H-2).', v_total, round(v_gross, 2), v_disc
      using errcode = '22023';
  end if;

  select vat_registered into v_reg from public.businesses where id = p_business_id;
  v_rate := case when coalesce(v_reg, false) then 17.5 else 0 end;  -- src/lib/vat.ts VAT_STANDARD_RATE
  v_expected_vat := round(v_total - v_total / (1 + v_rate / 100), 2);
  if abs(v_vat - v_expected_vat) > c_tol then
    raise exception 'POS sale VAT % does not match the business VAT status (expected %) (H-2).', v_vat, v_expected_vat
      using errcode = '22023';
  end if;
  if abs(v_sub + v_vat - v_total) > c_tol then
    raise exception 'POS sale subtotal % + VAT % does not equal total % (H-2).', v_sub, v_vat, v_total
      using errcode = '22023';
  end if;
end;
$$;
revoke all on function public._ledgr_assert_pos_sale_amounts(uuid, jsonb, jsonb) from public, anon, authenticated;

-- post_pos_sale: body copied verbatim from 20261005000000_p5a (the latest
-- definition); the ONLY change is the `perform _ledgr_assert_pos_sale_amounts`
-- call marked "H-2" after step 3b. Idempotent replays (which return before
-- step 3) are unaffected.
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
  v_branch_resolved := coalesce(v_branch_resolved, v_shift_row.branch_id);

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

comment on function public.post_pos_sale(jsonb) is
  'Atomic POS sale posting: authorize, de-duplicate by client_key, reserve the number, resolve the customer, write invoice + lines + tenders, post the sale/settlement/COGS entries, release stock and add to the open shift''s drawer totals — one round trip, one transaction, or nothing at all. P5-A adds authoritative clientKey-payload-mismatch guard: same clientKey with different payload (hash or material fields) raises 22023 payload-tampered/clientKey-payload-mismatch and creates no second posting (replay-safe). H-2 (2026-09-26): line/discount/total/VAT/subtotal arithmetic is re-verified server-side (_ledgr_assert_pos_sale_amounts, 22023 on mismatch); catalogue price authority and discount caps remain client-side pending DECISION REQUIRED — SERVER POS PRICING POLICY. See docs/database/pos-sale-posting-rpc.md.';

revoke all on function public.post_pos_sale(jsonb) from public, anon;
grant execute on function public.post_pos_sale(jsonb) to authenticated;

-- ═══════════════════════════ H-3 ═══════════════════════════
-- record_inventory_journal_movement(p_payload jsonb)
--   { business_id, kind: 'receipt'|'adjustment', client_key (uuid, required),
--     location_id, movement_date?, movement_type? (adjustment only:
--     adjustment_in|adjustment_out|purchase|opening_balance), reference?, notes?,
--     lines: [{ product_id, quantity > 0, unit_cost >= 0 }] }
-- Journal rules are the legacy client rules (inventoryJournalService.ts):
--   receipt:    DR inventory (product account, else 1141) / CR 2114 GRNI,
--               posting_key 'stock_receipt:<key>:grni'
--   adjustment: in-types DR inventory / CR 5180; adjustment_out reversed,
--               posting_key 'stock_adjustment:<key>'
--   untracked products and zero-value lines carry no journal (as before).
-- Movements and journal commit or roll back together. Balances are written
-- only by the existing R06 stock_movements trigger (no second writer).
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
  end if;
  v_out := v_type = 'adjustment_out';

  -- Idempotency: serialise on (business, source, key); a replay returns the
  -- committed result, a replay with a different payload is refused.
  perform pg_advisory_xact_lock(hashtextextended(v_business::text || '|' || v_source_type || '|' || v_key::text, 0));
  select count(*), coalesce(sum(abs(quantity)), 0) into v_existing_n, v_existing_q
    from public.stock_movements
   where business_id = v_business and source_type = v_source_type and source_id = v_key::text;
  if v_existing_n > 0 then
    select coalesce(sum(abs((l->>'quantity')::numeric)), 0) into v_in_q from jsonb_array_elements(v_lines) l;
    if v_existing_n <> jsonb_array_length(v_lines) or abs(v_existing_q - v_in_q) > 0.0001 then
      raise exception 'client_key % was already used for a different stock movement.', v_key using errcode = '22023';
    end if;
    select id into v_entry from public.journal_entries where business_id = v_business and posting_key = v_posting_key;
    select array_agg(id order by created_at, id) into v_ids from public.stock_movements
     where business_id = v_business and source_type = v_source_type and source_id = v_key::text;
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
      case when v_out then -v_qty else v_qty end, v_cost, v_source_type, v_key::text,
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
comment on function public.record_inventory_journal_movement(jsonb) is
  'H-3 (2026-09-26): atomic stock receipt/adjustment — movements (balance via the R06 trigger) and the keyed GRNI/adjustment journal in one transaction; idempotent by client_key; 42501 unauthorised/cross-tenant, 22023 malformed or key reuse.';
revoke all on function public.record_inventory_journal_movement(jsonb) from public, anon;
grant execute on function public.record_inventory_journal_movement(jsonb) to authenticated, service_role;

-- ═══════════════════════════ H-4 ═══════════════════════════
-- Direct PostgREST writes (role authenticated/anon) can no longer alter a
-- posted invoice. Rules derive only from existing commands, not new policy:
--   * status → paid/partially_paid/overdue: record_invoice_payment (IC P6)
--   * status → void/credit_note: R07 void/refund commands
--   * amounts/lines of a posted (non-draft) invoice: no direct path exists in
--     the application; the only legitimate direct update is linking
--     journal_entry_id once (journalService.ts) — still allowed.
--   * rows created in the same transaction (create_invoice_with_lines is
--     SECURITY INVOKER) are exempt, so atomic creation keeps working.
-- Draft invoices stay editable (draft → sent allowed). Financial-period and
-- approval checks are NOT added: no such mechanism exists (report §11).
create or replace function public._ledgr_guard_invoice_direct_write()
returns trigger language plpgsql set search_path = public
as $$
declare
  c_free constant text[] := array['journal_entry_id', 'updated_at', 'amount_due', 'pos_shift_id', 'exchange_rate_used'];  -- derived/generated or separately guarded (R08)
  v_changed text;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if old.status::text <> 'draft' then
      raise exception 'Invoice % is %; a posted invoice cannot be deleted directly — use the void/credit-note command (H-4).', old.invoice_number, old.status
        using errcode = '42501';
    end if;
    return old;
  end if;
  if old.created_at = now() then
    return new;  -- created in this transaction (atomic create path)
  end if;
  if old.status::text = 'draft' then
    if new.status::text not in ('draft', 'sent') then
      raise exception 'Status % must be set through its server command, not a direct edit (H-4).', new.status using errcode = '42501';
    end if;
    return new;
  end if;
  select coalesce(string_agg(n.key, ', ' order by n.key), '') into v_changed
    from jsonb_each(to_jsonb(new) - c_free) n
   where n.value is distinct from (to_jsonb(old) - c_free) -> n.key;
  if v_changed <> '' or (old.journal_entry_id is not null and new.journal_entry_id is distinct from old.journal_entry_id) then
    raise exception 'Invoice % is %; posted invoices cannot be edited directly — use the payment, void or credit-note command (H-4).', old.invoice_number, old.status
      using errcode = '42501', detail = 'changed: ' || coalesce(nullif(v_changed, ''), 'journal_entry_id');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_invoices_zz_direct_write_guard on public.invoices;
create trigger trg_invoices_zz_direct_write_guard
  before update or delete on public.invoices
  for each row execute function public._ledgr_guard_invoice_direct_write();

create or replace function public._ledgr_guard_invoice_line_direct_write()
returns trigger language plpgsql set search_path = public
as $$
declare
  v_parent record;
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  -- Parent read under the caller's own RLS: an invisible parent (other
  -- tenant / other branch) or a business mismatch is refused. Before H-4 a
  -- B owner could attach a line tagged business B to an A invoice because the
  -- line policy evaluated can_access_branch(B, NULL) (H05 finding).
  select status::text as status, created_at, business_id into v_parent from public.invoices where id = v_invoice;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'An invoice line cannot be moved to another invoice (H-4).' using errcode = '42501';
  end if;
  if v_parent.business_id is null or v_parent.business_id <> coalesce(new.business_id, old.business_id) then
    raise exception 'Invoice line does not belong to an invoice you can write in this business (H-4/H-5).' using errcode = '42501';
  end if;
  if v_parent.status = 'draft' or v_parent.created_at = now() then
    return coalesce(new, old);  -- drafts editable; same-transaction atomic create
  end if;
  raise exception 'Lines of a % invoice cannot be changed directly — use the void/credit-note command (H-4).', v_parent.status
    using errcode = '42501';
end;
$$;
drop trigger if exists trg_invoice_lines_zz_direct_write_guard on public.invoice_lines;
create trigger trg_invoice_lines_zz_direct_write_guard
  before insert or update or delete on public.invoice_lines
  for each row execute function public._ledgr_guard_invoice_line_direct_write();
