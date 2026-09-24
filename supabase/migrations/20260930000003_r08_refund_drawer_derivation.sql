-- R08.6 — R07 drawer reconciliation seam (derivation refinement; R07 untouched)
--
-- Establishes the trace proven by this package:
--   R07 refund_pos_sale_command books (a) scaled revenue/VAT reversal
--   journal(s), (b) a SETTLEMENT journal crediting the money-out tender
--   account (caller-supplied tender_account_id, else the invoice's first
--   payment account, else cash-on-hand '1110'), (c) return_in stock
--   movements + COGS mirrors, (d) exactly one pos_corrections row
--   (unique(business_id, command_key) replay fence). It writes NO
--   invoice_payments rows and NO pos_shifts rows — so the ledger +
--   corrections are the only authoritative refund records, and the drawer
--   reporting must follow them (no second drawer mutation).
--
-- This migration refines the refund drawer-effect derivation in the two
-- R08 read surfaces (close_pos_shift_command and get_pos_shift_report) from
-- the R08.2 least(c.amount, cash_portion) heuristic to the SETTLEMENT
-- JOURNAL truth: refund cash effect = amount credited to the business's
-- cash-on-hand account ('1110'). Refunds settled onto bank/card/mobile
-- accounts (caller-designated tender_account_id or a payment-bound account)
-- no longer reduce the physical drawer; for the POS default path (payments
-- recorded against 1110 when no tender account was configured) the journal
-- books cash-out of 1110 and the drawer correctly reduces. Report surface
-- gains additive informational keys refunds_gross_total + refund_total_note.
--
-- Originals of both bodies live in 20260930000000/20260930000002 and remain
-- byte-untouched; replay order makes this definition authoritative.
-- pos_corrections content, R07 command bodies, R05/R06 machinery: untouched.

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
         and je.source_id = c.document_id::text
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
         and je.source_id = c.document_id::text
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
-- close_pos_shift_command: no privilege changes (execute granted in R08.2).
-- get_pos_shift_report: no privilege changes (execute granted in R08.4).
comment on function public.get_pos_shift_report(uuid) is
  'R08.4 tender-derived shift reporting + R08.6 drawer reconciliation seam: refund drawer effect derived from the R07 settlement journal credited to the cash-on-hand (1110) account (authoritative money-out channel) — refunds settled onto other tender accounts do not reduce the physical drawer. Refund channel classification: cash effect from the settlement journal credit; gross total across all channels reported additively. No R07 body modified; derivation/read-side only.';
