-- LIVE-SHAPE TYPE FIX (2026-09-27) — types only, behaviour unchanged.
--
-- Evidence (owner, read-only queries on production hsuhuvuxfuufrlejsatw):
--   * stock_movements.source_id / created_by, journal_entries.source_id /
--     created_by, invoices.created_by, accounting_periods.closed_by are UUID on
--     production (text in the repository base schema);
--   * production's function bodies are the repository's (pg_get_functiondef).
-- On that shape these production functions raise 42883 (uuid = text) or 42804
-- (text into uuid) and therefore cannot complete:
--   void_pos_sale_command, refund_pos_sale_command (R07) — uncast comparisons,
--     '<invoice>:<key>' and auth.uid()::text written to uuid columns;
--   close_pos_shift_command, get_pos_shift_report (R08) — uncast comparison
--     (consistent with production: no shift has ever been closed);
--   save_quick_expense (20261007000000 regressed the 20260911000002 fix).
--
-- Each function below is its latest definition copied verbatim, with ONLY:
--   * comparisons   source_id = X::text   ->   source_id::text = X::text
--   * stock inserts write uuid values (invoice id, auth.uid(), created_by::uuid);
--     the R07 correction key moves from source_id to notes ('correction key K').
-- Every edit works on BOTH column shapes (uuid -> text is an assignment cast).
-- Nothing reads the old '<invoice>:<key>' form (idempotency is pos_corrections);
-- no unique index covers stock_movements.source_id. No data is changed.
-- Grants/ownership are preserved by CREATE OR REPLACE.

-- ── void_pos_sale_command ──
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
     where je.business_id = v_business and je.source_type = 'invoice' and je.source_id::text = v_invoice::text
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

-- ── refund_pos_sale_command ──
create or replace function public.refund_pos_sale_command(p_payload jsonb)
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
  v_reason text := coalesce(p_payload->>'reason', 'Customer return');
  v_approval_token uuid := nullif(p_payload->>'approval_token','')::uuid;
  v_lines jsonb := coalesce(p_payload->'lines', '[]'::jsonb);
  v_tender uuid := nullif(p_payload->>'tender_account_id','')::uuid;
  v_pre record; v_doc record; v_approval uuid;
  v_existing record;
  v_total numeric := 0; v_line jsonb;
  v_original numeric; v_refunded numeric; v_remaining numeric; v_rate numeric;
  v_sale_entry record; v_ratio numeric; v_rev uuid;
  v_debtors uuid; v_rev_amount numeric;
  v_move record; v_returned_cost numeric := 0; v_cogs_record record;
  v_journal uuid;
  v_location uuid;
begin
  if v_business is null or v_invoice is null then
    raise exception 'business_id and invoice_id are required.' using errcode = '22023';
  end if;
  if v_key is null or length(v_key) > 64 then
    raise exception 'command_key is required (<=64 chars).' using errcode = '22023';
  end if;

  -- Idempotent replay fence (same command key => same answer, no new effect).
  select * into v_existing from public.pos_corrections
   where business_id = v_business and command_key = v_key;
  if found then
    return jsonb_build_object('id', v_existing.id, 'command_type', v_existing.command_type,
      'document_id', v_existing.document_id, 'amount', v_existing.amount,
      'journal_entry_id', v_existing.journal_entry_id, 'idempotent', true);
  end if;

  select * into v_pre from public._ledgr_correction_preflight(v_business, v_invoice, 'refund_sale', v_approval_token);
  v_approval := v_pre.approval_id;

  if v_pre.doc_status = 'void' then
    raise exception 'Voided documents cannot be refunded.' using errcode = '22023';
  end if;
  if v_pre.doc_status <> 'paid' then
    raise exception 'Only a posted (paid) sale can be refunded; cancel unpaid documents instead.' using errcode = '22023';
  end if;

  -- Refund line validation: strictly positive, items optional description.
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'At least one refund line is required.' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    if coalesce((v_line->>'amount')::numeric, 0) <= 0 then
      raise exception 'Refund amounts must be positive.' using errcode = '22023';
    end if;
    if (v_line->>'quantity') is not null and (v_line->>'quantity')::numeric < 0 then
      raise exception 'Refund quantities must be non-negative.' using errcode = '22023';
    end if;
    v_total := v_total + (v_line->>'amount')::numeric;
  end loop;

  -- Cumulative invariant (server-side, under the document row lock taken by
  -- _ledgr_correction_preflight): previous refunds + this command <= original.
  v_original := abs(coalesce(v_pre.doc_original_amount, v_pre.doc_total_amount, 0));
  v_rate := coalesce(v_pre.doc_exchange_rate, 1);
  select coalesce(sum(amount),0) into v_refunded from public.pos_corrections
   where business_id = v_business and document_id = v_invoice and command_type = 'refund_sale';
  v_remaining := v_original - v_refunded;
  if v_total <= 0 then
    raise exception 'Refund total must be positive.' using errcode = '22023';
  end if;
  if v_total > v_remaining + 0.005 then
    raise exception 'Refund of % exceeds the remaining refundable amount % for this sale.',
        v_total, v_remaining using errcode = '22023';
  end if;

  -- Revenue/VAT reversal: mirror the original SALE entry, scaled by the refund
  -- ratio at ORIGINAL amounts/currency. Full refunds scale to exactly the
  -- original entry (ratio = 1).
  v_ratio := case when v_original > 0 then v_total / v_original else 0 end;
  for v_sale_entry in
    select je.id from public.journal_entries je
     where je.business_id = v_business and je.source_type = 'invoice'
       and je.source_id::text = v_invoice::text
       and je.posting_key = 'invoice:' || v_invoice::text || ':sale'
  loop
    perform public._ledgr_post_entry_keyed(
      v_business, 'refund:' || v_key || ':' || v_sale_entry.id::text, current_date,
      'Refund of ' || coalesce(v_pre.doc_invoice_number, v_invoice::text),
      'invoice', v_invoice::text, coalesce(v_pre.doc_currency,'MWK'), v_rate,
      v_pre.doc_branch_id, v_pre.doc_department_id,
      (select jsonb_agg(jsonb_build_object(
          'account_id', jl.account_id,
          'description', jl.description,
          'is_debit', not jl.is_debit,
          'amount', round(jl.amount * v_ratio, 2),
          'amount_base', round(jl.amount_base * v_ratio, 2),
          'tax_code', jl.tax_code,
          'tax_amount', round(-coalesce(jl.tax_amount,0) * v_ratio, 2)))
        from public.journal_lines jl where jl.journal_entry_id = v_sale_entry.id));
  end loop;

  -- Tender reversal: money leaves the (original / supplied) tender account.
  v_debtors := public._ledgr_account_by_code(v_business, '1131');
  if v_tender is null then
    select coalesce(ip.bank_account_id, public._ledgr_account_by_code(v_business,'1110'))
      into v_tender from public.invoice_payments ip
     where ip.business_id = v_business and ip.invoice_id = v_invoice
     order by ip.created_at, ip.id limit 1;
  end if;
  if v_tender is null then
    v_tender := public._ledgr_account_by_code(v_business,'1110');
  end if;
  v_rev_amount := round(v_total * v_rate, 2);
  v_journal := public._ledgr_post_entry_keyed(
    v_business, 'refund:' || v_key || ':settlement', current_date,
    'Tender refund for ' || coalesce(v_pre.doc_invoice_number, v_invoice::text),
    'invoice', v_invoice::text, coalesce(v_pre.doc_currency,'MWK'), v_rate,
    v_pre.doc_branch_id, v_pre.doc_department_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_debtors, 'description', 'Reopen receivable — refund ' || v_key,
        'is_debit', true, 'amount', v_total, 'amount_base', v_rev_amount),
      jsonb_build_object('account_id', v_tender, 'description', 'Cash out — refund ' || v_key,
        'is_debit', false, 'amount', v_total, 'amount_base', v_rev_amount)));

  -- Stock return at ORIGINAL unit cost for returned quantities; COGS mirrored
  -- for the returned cost (inventory restored, COGS credited).
  v_location := public._ledgr_stock_location(v_business, v_pre.doc_branch_id);
  if v_location is not null and coalesce(jsonb_array_length(v_lines),0) > 0 then
    for v_line in select * from jsonb_array_elements(v_lines) loop
      if (v_line->>'product_id') is null or coalesce((v_line->>'quantity')::numeric,0) <= 0 then
        continue;
      end if;
      select into v_move m.product_id, coalesce(m.unit_cost,0) unit_cost, m.quantity
        from public.stock_movements m
       where m.business_id = v_business and m.source_type = 'invoice'
         and m.source_id::text = v_invoice::text and m.product_id = (v_line->>'product_id')::uuid
       order by m.created_at desc limit 1;
      if found then
        insert into public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, source_type, source_id, reference, created_by, notes
        ) values (
          v_business, v_move.product_id, v_location, 'return_in', current_date,
          (v_line->>'quantity')::numeric, v_move.unit_cost, 'pos_refund',
          v_invoice, 'Refund ' || coalesce(v_pre.doc_invoice_number,v_invoice::text), auth.uid(), 'correction key ' || v_key);
        v_returned_cost := v_returned_cost + abs((v_line->>'quantity')::numeric * v_move.unit_cost);
      end if;
    end loop;
    if v_returned_cost > 0 then
      -- Mirror the original COGS entry line-for-line, scaled to the returned
      -- cost and balanced as a single entry (one-sided mirror entries would
      -- violate the posting balance rule).
      for v_cogs_record in
        select je.id as entry_id, coalesce(sum(jl.amount_base) filter (where jl.is_debit), 0) as total
          from public.journal_entries je
          left join public.journal_lines jl on jl.journal_entry_id = je.id
         where je.business_id = v_business and je.posting_key = 'invoice:' || v_invoice::text || ':cogs'
         group by je.id
      loop
        if coalesce(v_cogs_record.total, 0) > 0 then
          perform public._ledgr_post_entry_keyed(
            v_business, 'refund:' || v_key || ':cogs', current_date,
            'Returned cost for ' || coalesce(v_pre.doc_invoice_number, v_invoice::text),
            'invoice', v_invoice::text, coalesce(v_pre.doc_currency,'MWK'), v_rate,
            v_pre.doc_branch_id, v_pre.doc_department_id,
            (select jsonb_agg(jsonb_build_object(
                'account_id', jl.account_id,
                'description', 'COGS reversal — refund ' || v_key,
                'is_debit', not jl.is_debit,
                'amount', round(jl.amount * (v_returned_cost / v_cogs_record.total), 2),
                'amount_base', round(jl.amount_base * (v_returned_cost / v_cogs_record.total), 2)))
              from public.journal_lines jl where jl.journal_entry_id = v_cogs_record.entry_id));
        end if;
      end loop;
    end if;
  end if;

  insert into public.pos_corrections (business_id, command_key, command_type, document_id,
      amount, currency, lines, approval_id, reason, created_by)
  values (v_business, v_key, 'refund_sale', v_invoice, v_total,
      coalesce(v_pre.doc_currency,'MWK'), v_lines, v_approval, v_reason, auth.uid());

  return jsonb_build_object('document_id', v_invoice, 'amount', v_total,
      'remaining', greatest(v_remaining - v_total, 0), 'journal_entry_id', v_journal,
      'idempotent', false);
end;
$$;

-- ── close_pos_shift_command ──
create or replace function public.close_pos_shift_command(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift    record;
  v_shift_id uuid;
  v_business uuid;
  v_key      text := p_payload->>'command_key';
  v_actual   numeric;
  v_refund   numeric;
  v_cash_in  numeric;
  v_cash_out numeric;
  v_expected numeric;
  v_existing record;
  v_report   text;
  v_cash_account uuid;
  v_breakdown jsonb;
  v_cash_sales numeric;
  v_other_sales numeric;
  v_total_sales numeric;
  v_sales_count integer;
begin
  if auth.uid() is null then
    raise exception 'Anonymous callers cannot close a shift.' using errcode = '42501';
  end if;
  if (p_payload->>'shift_id') is null or v_key is null or v_key !~ '^[A-Za-z0-9:_-]{4,64}$' then
    raise exception 'close_pos_shift_command requires shift_id and a well-formed command_key.' using errcode = '22023';
  end if;
  v_shift_id := (p_payload->>'shift_id')::uuid;
  v_actual := coalesce((p_payload->>'closing_cash')::numeric, 0);

  -- Idempotent replay: same command key returns the same signed close.
  select * into v_existing from public.pos_shift_closes
   where business_id = (select business_id from public.pos_shifts where id = v_shift_id)
     and command_key = v_key;
  if found then
    return v_existing.payload || jsonb_build_object('idempotent', true);
  end if;

  -- Lock the shift row for the duration of the close (two concurrent closes
  -- serialize here; the loser sees 'closed' below instead of double-signing).
  select * into v_shift from public.pos_shifts where id = v_shift_id for update;
  if not found then
    raise exception 'Unknown shift.' using errcode = '22023';
  end if;
  v_business := v_shift.business_id;
  if not public.can_operate_pos(v_business)
     or not public.can_access_branch(v_business, v_shift.branch_id) then
    raise exception 'Caller may not operate POS in this business/branch.' using errcode = '42501';
  end if;
  -- Own-shift rule: the shift's cashier, or a manager-tier member of the business.
  if v_shift.cashier_id is distinct from auth.uid() and not exists (
       select 1 from public.business_users bu
        where bu.business_id = v_business and bu.user_id = auth.uid()
          and bu.is_active = true and bu.role::text in ('owner','admin','manager')) then
    raise exception 'Only the shift''s cashier or a business manager may close a shift.' using errcode = '42501';
  end if;
  if v_shift.terminal_id is null then
    raise exception 'Pre-R08 (terminal-less) shifts predate till context; the canonical command closes only terminal-bound shifts. Historical attribution/backfill is outside R08 (R15 owns history).' using errcode = '22023';
  end if;
  if v_shift.status <> 'open' then
    -- NOT idempotent: a re-close under a fresh key must never rewrite the
    -- signed close (R08/DEC-08).
    raise exception 'Shift is already closed; the signed close is immutable.' using errcode = '22023';
  end if;

  -- Authoritative derivations (tenders + corrections + movements only;
  -- client-maintained counters are NOT the source of the signed close).
  select coalesce(sum(p.amount) filter (where p.payment_method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.payment_method <> 'cash'), 0)
    into v_cash_sales, v_other_sales
    from public.invoice_payments p
    join public.invoices i on i.id = p.invoice_id
   where i.business_id = v_business
     and i.pos_shift_id = v_shift_id
     and i.status = 'paid'
     and i.deleted_at is null;

  select coalesce(jsonb_object_agg(q.payment_method, q.method_amount), '{}'::jsonb)
    into v_breakdown
    from (select p.payment_method, sum(p.amount) as method_amount
            from public.invoice_payments p
            join public.invoices i on i.id = p.invoice_id
           where i.business_id = v_business
             and i.pos_shift_id = v_shift_id
             and i.status = 'paid'
             and i.deleted_at is null
           group by p.payment_method) q;

  select count(id)::int into v_sales_count
    from public.invoices
   where business_id = v_business
     and pos_shift_id = v_shift_id
     and status = 'paid'
     and deleted_at is null;

  -- R08.6: refund drawer effect follows the R07 SETTLEMENT journal — the
  -- authoritative "money leaves this tender account" record — never a
  -- least-heuristic over original tenders. Cash effect = amount credited to
  -- the business's cash-on-hand account ('1110') across this shift's refund
  -- settlements; refunds posted onto a bank/card/mobile account leave the
  -- physical drawer untouched. No fallback heuristics: absent settlement
  -- lines mean no cash effect, per the ledger.
  v_cash_account := public._ledgr_account_by_code(v_business, '1110');
  select coalesce(sum(x.cash_out), 0) into v_refund
    from public.pos_corrections c
    join lateral (
      select sum(jl.amount) as cash_out
        from public.journal_entries je
        join public.journal_lines jl on jl.journal_entry_id = je.id and not jl.is_debit
       where je.business_id = v_business
         and je.posting_key = 'refund:' || c.command_key || ':settlement'
         and je.source_type = 'invoice'
         and je.source_id::text = c.document_id::text
         and jl.account_id = v_cash_account
    ) x on true
   where c.business_id = v_business
     and c.command_type = 'refund_sale'
     and c.document_id in (select id from public.invoices
                            where business_id = v_business and pos_shift_id = v_shift_id);

  select coalesce(sum(m.amount) filter (where m.movement_type in ('cash_in','safe_deposit')), 0),
         coalesce(sum(m.amount) filter (where m.movement_type in ('cash_out','petty_cash')), 0)
    into v_cash_in, v_cash_out
    from public.pos_cash_movements m
   where m.business_id = v_business and m.shift_id = v_shift_id;

  v_total_sales := v_cash_sales + v_other_sales;
  v_expected    := v_shift.opening_cash + v_cash_sales - v_refund + v_cash_in - v_cash_out;
  v_report      := 'Z-' || to_char(now(), 'YYYY') || '-' || nextval('public.pos_z_report_seq')::text;

  -- Single close-transition + immutable snapshot, one transaction.
  update public.pos_shifts
     set status = 'closed',
         closed_at = now(),
         cash_sales_amount = v_cash_sales,
         other_sales_amount = v_other_sales,
         total_sales_amount = v_total_sales,
         refunds_amount = coalesce(v_refund, 0),
         cash_in_amount = coalesce(v_cash_in, 0),
         cash_out_amount = coalesce(v_cash_out, 0),
         expected_cash = v_expected,
         actual_cash = v_actual,
         cash_variance = v_actual - v_expected,
         variance_reason = nullif(p_payload->>'variance_reason', ''),
         notes = coalesce(nullif(p_payload->>'notes',''), notes),
         updated_at = now()
   where id = v_shift_id and status = 'open';
  if not found then
    raise exception 'Shift is already closed; the signed close is immutable.' using errcode = '22023';
  end if;

  insert into public.pos_shift_closes (
    business_id, shift_id, command_key, report_number, closed_by,
    cashier_id, terminal_id, branch_id, opened_at, closed_at,
    opening_cash, cash_tenders, other_tenders, refund_total,
    cash_in_total, cash_out_total, sales_count, tender_breakdown,
    expected_cash, actual_cash, variance, variance_reason, notes, payload
  ) values (
    v_business, v_shift_id, v_key, v_report, auth.uid(),
    v_shift.cashier_id, v_shift.terminal_id, v_shift.branch_id, v_shift.opened_at, now(),
    v_shift.opening_cash, v_cash_sales, v_other_sales, coalesce(v_refund,0),
    coalesce(v_cash_in,0), coalesce(v_cash_out,0), coalesce(v_sales_count,0), v_breakdown,
    v_expected, v_actual, v_actual - v_expected, nullif(p_payload->>'variance_reason',''), nullif(p_payload->>'notes',''),
    jsonb_build_object('result','close','report_number', v_report, 'idempotent', false,
      'shift_id', v_shift_id, 'expected_cash', v_expected, 'actual_cash', v_actual,
      'variance', v_actual - v_expected, 'cash_tenders', v_cash_sales, 'other_tenders', v_other_sales,
      'refund_total', coalesce(v_refund,0), 'sales_count', coalesce(v_sales_count,0))
  );

  return jsonb_build_object('result','close','idempotent', false,
    'report_number', v_report, 'shift_id', v_shift_id,
    'expected_cash', v_expected, 'actual_cash', v_actual,
    'variance', v_actual - v_expected, 'cash_tenders', v_cash_sales,
    'other_tenders', v_other_sales, 'refund_total', coalesce(v_refund,0),
    'sales_count', coalesce(v_sales_count,0));
end;
$$;

-- ── get_pos_shift_report ──
create or replace function public.get_pos_shift_report(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_shift record;
  v_close record;
  v_cash_sales numeric;
  v_other_sales numeric;
  v_breakdown jsonb;
  v_cash_account uuid;
  v_refunds_gross numeric;
  v_sales_count integer;
  v_refund numeric;
  v_cash_in numeric;
  v_cash_out numeric;
  v_expected numeric;
begin
  if auth.uid() is null then
    raise exception 'Anonymous callers cannot read a shift report.' using errcode = '42501';
  end if;
  select * into v_shift from public.pos_shifts where id = p_shift_id;
  if not found then
    raise exception 'Unknown shift.' using errcode = '22023';
  end if;
  -- DEC-03 read surface: org-wide roles (owner/admin/manager/accountant/auditor)
  -- or an assignment matching the shift's branch. No write of any kind here.
  if not public.can_access_branch(v_shift.business_id, v_shift.branch_id) then
    raise exception 'Caller has no access to this shift''s branch.' using errcode = '42501';
  end if;

  -- Authoritative derivation, byte-equivalent in shape to close_pos_shift_command:
  -- tenders come from invoice_payments + invoice linkage, NEVER from
  -- caller-maintained pos_shifts counters or payload claims.
  select coalesce(sum(p.amount) filter (where p.payment_method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.payment_method <> 'cash'), 0)
    into v_cash_sales, v_other_sales
    from public.invoice_payments p
    join public.invoices i on i.id = p.invoice_id
   where i.business_id = v_shift.business_id
     and i.pos_shift_id = v_shift.id
     and i.status = 'paid'
     and i.deleted_at is null;

  select coalesce(jsonb_object_agg(q.payment_method, q.method_amount), '{}'::jsonb)
    into v_breakdown
    from (select p.payment_method, sum(p.amount) as method_amount
            from public.invoice_payments p
            join public.invoices i on i.id = p.invoice_id
           where i.business_id = v_shift.business_id
             and i.pos_shift_id = v_shift.id
             and i.status = 'paid'
             and i.deleted_at is null
           group by p.payment_method) q;

  select count(id)::int into v_sales_count
    from public.invoices
   where business_id = v_shift.business_id
     and pos_shift_id = v_shift.id
     and status = 'paid'
     and deleted_at is null;

  -- R08.6: refund drawer effect follows the R07 SETTLEMENT journal
  -- (authoritative money-out channel): cash effect = amount credited to the
  -- business's cash-on-hand account ('1110'); refunds settled onto
  -- bank/card/mobile accounts do not touch the physical drawer.
  v_cash_account := public._ledgr_account_by_code(v_shift.business_id, '1110');
  select coalesce(sum(x.cash_out), 0) into v_refund
    from public.pos_corrections c
    join lateral (
      select sum(jl.amount) as cash_out
        from public.journal_entries je
        join public.journal_lines jl on jl.journal_entry_id = je.id and not jl.is_debit
       where je.business_id = v_shift.business_id
         and je.posting_key = 'refund:' || c.command_key || ':settlement'
         and je.source_type = 'invoice'
         and je.source_id::text = c.document_id::text
         and jl.account_id = v_cash_account
    ) x on true
   where c.business_id = v_shift.business_id
     and c.command_type = 'refund_sale'
     and c.document_id in (select id from public.invoices
                            where business_id = v_shift.business_id and pos_shift_id = v_shift.id);

  -- All-channel refund total (any tender): informational, additive key.
  select coalesce(sum(amount), 0) into v_refunds_gross
    from public.pos_corrections c
   where c.business_id = v_shift.business_id
     and c.command_type = 'refund_sale'
     and c.document_id in (select id from public.invoices
                            where business_id = v_shift.business_id and pos_shift_id = v_shift.id);

  select coalesce(sum(m.amount) filter (where m.movement_type in ('cash_in','safe_deposit')), 0),
         coalesce(sum(m.amount) filter (where m.movement_type in ('cash_out','petty_cash')), 0)
    into v_cash_in, v_cash_out
    from public.pos_cash_movements m
   where m.business_id = v_shift.business_id and m.shift_id = v_shift.id;

  v_expected := v_shift.opening_cash + v_cash_sales - coalesce(v_refund,0)
              + coalesce(v_cash_in,0) - coalesce(v_cash_out,0);

  select * into v_close from public.pos_shift_closes
   where business_id = v_shift.business_id and shift_id = v_shift.id;

  return jsonb_build_object(
    'result', 'shift_report',
    'shift_id', v_shift.id,
    'business_id', v_shift.business_id,
    'branch_id', v_shift.branch_id,
    'terminal_id', v_shift.terminal_id,
    'cashier_id', v_shift.cashier_id,
    'cashier_name', public._ledgr_pos_actor_name(v_shift.cashier_id),
    'status', v_shift.status,
    'opened_at', v_shift.opened_at,
    'opening_cash', v_shift.opening_cash,
    'cash_tenders', v_cash_sales,
    'other_tenders', v_other_sales,
    'total_sales', v_cash_sales + v_other_sales,
    'sales_count', coalesce(v_sales_count, 0),
    'tender_breakdown', coalesce(v_breakdown, '{}'::jsonb),
    'refund_total', coalesce(v_refund, 0),
    'refunds_gross_total', coalesce(v_refunds_gross, 0),
    'refund_total_note', 'Drawer-cash effect of refunds settled onto the cash-on-hand (1110) account; refunds_gross_total covers every tender channel.',
    'cash_in_total', coalesce(v_cash_in, 0),
    'cash_out_total', coalesce(v_cash_out, 0),
    'expected_cash', v_expected,
    'derivation_source', 'invoice_payments+pos_corrections+pos_cash_movements',
    'client_counters', jsonb_build_object(
      'cash_sales_amount', v_shift.cash_sales_amount,
      'other_sales_amount', v_shift.other_sales_amount,
      'total_sales_amount', v_shift.total_sales_amount,
      'authoritative', false),
    'close', case when v_close.id is null then null::jsonb else jsonb_build_object(
      'report_number', v_close.report_number,
      'closed_at', v_close.closed_at,
      'closed_by', v_close.closed_by,
      'cashier_id', v_close.cashier_id,
      'terminal_id', v_close.terminal_id,
      'branch_id', v_close.branch_id,
      'expected_cash', v_close.expected_cash,
      'actual_cash', v_close.actual_cash,
      'variance', v_close.variance,
      'cash_tenders', v_close.cash_tenders,
      'other_tenders', v_close.other_tenders,
      'refund_total', v_close.refund_total,
      'sales_count', v_close.sales_count,
      'tender_breakdown', v_close.tender_breakdown,
      'payload_hash', md5(v_close.payload::text)) end);
end;
$$;

-- ── save_quick_expense ──
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
        values (v_business_id, v_product.id, v_location, 'purchase', current_date, (v_stock_line->>'quantity')::numeric, (v_stock_line->>'unit_cost')::numeric, 'expense', v_expense_id, v_number, nullif(v_expense->>'created_by', '')::uuid);
      end loop;
    end if;
  end if;

  return jsonb_build_object('id', v_expense_id, 'number', v_number, 'journal_entry_id', v_journal_id, 'idempotent', false);
end;
$$;
