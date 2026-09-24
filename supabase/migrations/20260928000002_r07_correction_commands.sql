-- ============================================================================
-- R07 — Canonical approval + correction commands (false-approval containment).
--
-- DECISION AFFECTS: R07. Decisions A (Option 1 containment), B (server-bound
-- approval architecture), §5 (canonical refund command), §6 (cumulative
-- refund invariant server-side), §7 (canonical void behaviour), §9 (self
-- approval: default denied, decision-flagged), §10 (replay protection).
--
-- INVESTIGATION TRUTH THIS MIGRATION CONTROLS (verified in the R07 report):
--   * The browser PIN modal was the only "approval" mechanism and represented
--     no server authority; approvals were never transmitted, verified, or
--     recorded. This migration installs the ENTIRE server-side approval /
--     correction surface from scratch (catalog scan before authoring proved
--     no void/refund/reversal/approval command or state existed).
--
-- CONTRACT
--   * Approvals: server-minted tokens (pos_approvals), single-organisation,
--     single-document, single-action, single-use, expiring, replay-resistant.
--     Approver identity = authenticated session (auth.uid()); authority =
--     owner/admin/manager tier of the same business at authorize-time AND at
--     consume-time. No PIN credential system is created — the existing
--     authentication model supplies identity assurance (§3 decision).
--   * Corrections: refund_pos_sale_command / void_pos_sale_command are
--     SECURITY DEFINER, idempotent per (business_id, command_key), atomic,
--     zero-mutation-on-reject, approval-gated for roles outside the direct
--     tier (owner/admin/manager — mirrors the existing client permission
--     model; no role policy invented).
--   * Void = full financial reversal of the posted sale (mirror every posted
--     journal entry for the invoice, restock via signed return movements at
--     original cost); it never deletes or overwrites history. Unposted
--     documents naturally reverse only what exists.
--   * Refund = settlement/revenue reversal scaled to the refund amount at the
--     ORIGINAL amounts/currency/tender-account, stock returned at ORIGINAL
--     unit cost, cumulative refunds strictly bounded by the invoice total
--     (server-side, checked under the document's row lock).
--   * Rejected operations raise before any write; the enclosing transaction
--     rolls back => ZERO financial mutation.
-- ============================================================================

-- ── 1. Tables ───────────────────────────────────────────────────────────────

-- Server-minted approval tokens. Direct client DML is closed: the RPCs below
-- are the only write path; RLS enabled with no policies as belt-and-braces.
create table if not exists public.pos_approvals (
    id           uuid primary key default gen_random_uuid(),
    token        uuid not null unique default gen_random_uuid(),
    business_id  uuid not null references public.businesses(id),
    action       text not null check (action in ('void_sale','refund_sale')),
    document_id  uuid not null references public.invoices(id),
    amount       numeric,
    requested_by uuid not null,
    authorized_by uuid,
    authorized_at timestamptz,
    expires_at   timestamptz not null,
    consumed_at  timestamptz,
    consumed_by  uuid,
    created_at   timestamptz not null default now()
);
comment on table public.pos_approvals is
  'R07 server-bound approval tokens: one org, one document, one action, one live use. Minted by request_pos_approval, authorized by authorize_pos_approval (owner/admin/manager, server-verified session identity), consumed exactly once by a correction command. Approver may never be the requester (separation-of-duties default; the self-approval policy is parked as a register decision).';
-- At most one LIVE authorized approval per (business, action, document).
create unique index if not exists pos_approvals_live_uidx
    on public.pos_approvals (business_id, action, document_id)
    where authorized_at is not null and consumed_at is null;
create index if not exists pos_approvals_business_idx on public.pos_approvals (business_id, document_id);

-- Canonical record of every executed correction command. The unique
-- command_key is the idempotency anchor: a replayed command returns this row
-- (idempotent:true) before any new effect is created.
create table if not exists public.pos_corrections (
    id            uuid primary key default gen_random_uuid(),
    business_id   uuid not null references public.businesses(id),
    command_key   text not null,
    command_type  text not null check (command_type in ('void_sale','refund_sale')),
    document_id   uuid not null references public.invoices(id),
    amount        numeric not null default 0,
    currency      text not null,
    lines         jsonb not null default '[]'::jsonb,
    approval_id   uuid references public.pos_approvals(id),
    journal_entry_id uuid,
    reason        text,
    created_by    uuid not null,
    created_at    timestamptz not null default now(),
    unique (business_id, command_key)
);
comment on table public.pos_corrections is
  'R07 canonical correction record (void/refund commands). unique(business_id, command_key) is the replay fence; cumulative refunds are derived from rows of command_type refund_sale under the document row lock.';
create index if not exists pos_corrections_document_idx on public.pos_corrections (document_id, command_type);

alter table public.pos_approvals enable row level security;
alter table public.pos_corrections enable row level security;
revoke all on public.pos_approvals from public, anon, authenticated;
revoke all on public.pos_corrections from public, anon, authenticated;

-- ── 2. Approval commands ────────────────────────────────────────────────────

create or replace function public.request_pos_approval(
  p_business_id uuid,
  p_action text,
  p_document_id uuid,
  p_amount numeric default null,
  p_reason text default null,
  p_ttl_minutes integer default 15
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_doc record;
  v_row record;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.can_write_business_data(p_business_id) then
    raise exception 'You do not have permission to request approvals for this business.'
        using errcode = '42501';
  end if;
  if p_action not in ('void_sale','refund_sale') then
    raise exception 'Unknown approval action: %. Allowed: void_sale, refund_sale.', p_action
        using errcode = '22023';
  end if;
  select * into v_doc from public.invoices where id = p_document_id and business_id = p_business_id;
  if not found then
    raise exception 'Approval documents must belong to the caller organisation.' using errcode = '22023';
  end if;
  insert into public.pos_approvals (business_id, action, document_id, amount, requested_by, expires_at)
  values (p_business_id, p_action, p_document_id, p_amount, v_user, now() + (greatest(1, least(p_ttl_minutes, 240)) || ' minutes')::interval)
  returning id, token, action, document_id, amount, expires_at, created_at into v_row;
  return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'action', v_row.action,
    'document_id', v_row.document_id, 'amount', v_row.amount, 'expires_at', v_row.expires_at,
    'created_at', v_row.created_at, 'status', 'requested');
end;
$$;

create or replace function public.authorize_pos_approval(p_token uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row record;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_row from public.pos_approvals where token = p_token;
  if not found then
    raise exception 'Unknown approval token.' using errcode = '22023';
  end if;
  -- Approver authority re-derived at authorization time from the live session.
  if not exists (select 1 from public.business_users
                  where business_id = v_row.business_id and user_id = v_user
                    and is_active = true and role::text in ('owner','admin','manager')) then
    raise exception 'Only an owner, admin or manager of this business may authorize corrections.'
        using errcode = '42501';
  end if;
  if v_row.requested_by = v_user then
    -- Separation-of-duties default: the requester may not authorize their own
    -- approval. A deliberately parked register decision (R07 §9) — flip only
    -- with an approved policy change, never by editing this check casually.
    raise exception 'The requester cannot authorize their own approval.' using errcode = '22023';
  end if;
  if v_row.authorized_at is not null then
    raise exception 'This approval has already been authorized.' using errcode = '22023';
  end if;
  if v_row.consumed_at is not null then
    raise exception 'This approval has already been consumed.' using errcode = '22023';
  end if;
  if v_row.expires_at <= now() then
    raise exception 'This approval has expired.' using errcode = '22023';
  end if;
  update public.pos_approvals
     set authorized_by = v_user, authorized_at = now()
   where id = v_row.id and authorized_at is null;
  if not found then
    raise exception 'This approval has already been authorized.' using errcode = '22023';
  end if;
  select id, token, action, document_id, amount, authorized_by, authorized_at, expires_at
    into v_row from public.pos_approvals where token = p_token;
  return jsonb_build_object('id', v_row.id, 'token', v_row.token, 'action', v_row.action,
    'document_id', v_row.document_id, 'amount', v_row.amount, 'authorized_by', v_row.authorized_by,
    'authorized_at', v_row.authorized_at, 'expires_at', v_row.expires_at, 'status', 'authorized');
end;
$$;

-- Internal: validate + consume a live approval for a correction command.
-- Returns the approval id. Consumption is atomic single-use; the enclosing
-- command's transaction rolls the mark back if the command is later rejected.
create or replace function public._ledgr_consume_pos_approval(
  p_token uuid,
  p_business_id uuid,
  p_action text,
  p_document_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  select * into v_row from public.pos_approvals where token = p_token for update;
  if not found then
    raise exception 'Unknown approval token.' using errcode = '22023';
  end if;
  if v_row.business_id <> p_business_id then
    raise exception 'This approval belongs to another organisation.' using errcode = '42501';
  end if;
  if v_row.action <> p_action then
    raise exception 'This approval is for a different action (%).', v_row.action using errcode = '22023';
  end if;
  if v_row.document_id <> p_document_id then
    raise exception 'This approval is bound to a different document.' using errcode = '22023';
  end if;
  if v_row.authorized_at is null then
    raise exception 'This approval has not been authorized.' using errcode = '22023';
  end if;
  -- Approver authority is RE-VALIDATED at consume-time: a manager whose role
  -- was revoked between authorization and use can no longer approve.
  if not exists (select 1 from public.business_users
                  where business_id = v_row.business_id and user_id = v_row.authorized_by
                    and is_active = true and role::text in ('owner','admin','manager')) then
    raise exception 'The recorded approver no longer holds correction authority.' using errcode = '42501';
  end if;
  if v_row.consumed_at is not null then
    raise exception 'This approval has already been consumed.' using errcode = '22023';
  end if;
  if v_row.expires_at <= now() then
    raise exception 'This approval has expired.' using errcode = '22023';
  end if;
  update public.pos_approvals
     set consumed_at = now(), consumed_by = auth.uid()
   where id = v_row.id and consumed_at is null;
  if not found then
    raise exception 'This approval has already been consumed.' using errcode = '22023';
  end if;
  return v_row.id;
end;
$$;

-- Shared correction pre-flight: caller identity, membership tier, direct tier,
-- document ownership, and approval requirement resolution.
create or replace function public._ledgr_correction_preflight(
  p_business_id uuid,
  p_document_id uuid,
  p_action text,
  p_approval_token uuid
) returns table (
  doc_status text, doc_currency text, doc_original_amount numeric, doc_total_amount numeric,
  doc_exchange_rate numeric, doc_branch_id uuid, doc_department_id uuid, doc_invoice_number text,
  approval_id uuid
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text;
  v_doc record;
  v_approval uuid;
begin
  if v_user is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.can_write_business_data(p_business_id) then
    raise exception 'You do not have permission to correct documents for this business.'
        using errcode = '42501';
  end if;
  select r.role::text into v_role from public.business_users r
    where r.business_id = p_business_id and r.user_id = v_user and r.is_active = true;
  select * into v_doc from public.invoices
    where id = p_document_id and business_id = p_business_id for update;
  if not found then
    raise exception 'Document not found in this organisation.' using errcode = '22023';
  end if;
  -- Direct tier mirrors the existing client permission model exactly
  -- (usePosPermissions.canVoid/canRefund: owner|admin|manager). Everyone else
  -- in the write tier needs a live approval token.
  if v_role is null or v_role not in ('owner','admin','manager') then
    if p_approval_token is null then
      raise exception 'This action requires a manager approval token.' using errcode = '22023';
    end if;
    v_approval := public._ledgr_consume_pos_approval(p_approval_token, p_business_id, p_action, p_document_id);
  end if;
  doc_status := v_doc.status; doc_currency := v_doc.currency;
  doc_original_amount := v_doc.original_amount; doc_total_amount := v_doc.total_amount;
  doc_exchange_rate := v_doc.exchange_rate; doc_branch_id := v_doc.branch_id;
  doc_department_id := v_doc.department_id; doc_invoice_number := v_doc.invoice_number;
  approval_id := v_approval;
  return next;
end;
$$;

-- ── 3. Canonical VOID command ───────────────────────────────────────────────

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
     where je.business_id = v_business and je.source_type = 'invoice' and je.source_id = v_invoice::text
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
       where business_id = v_business and source_type = 'invoice' and source_id = v_invoice::text
    loop
      insert into public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, created_by
      ) values (
        v_business, v_move.product_id, v_location, 'return_in',
        current_date, v_move.qty, v_move.unit_cost,
        'pos_void', v_invoice::text || ':' || v_key,
        'Void ' || coalesce(v_pre.doc_invoice_number, v_invoice::text), auth.uid()::text
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

-- ── 4. Canonical REFUND command ─────────────────────────────────────────────

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
       and je.source_id = v_invoice::text
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
         and m.source_id = v_invoice::text and m.product_id = (v_line->>'product_id')::uuid
       order by m.created_at desc limit 1;
      if found then
        insert into public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, source_type, source_id, reference, created_by
        ) values (
          v_business, v_move.product_id, v_location, 'return_in', current_date,
          (v_line->>'quantity')::numeric, v_move.unit_cost, 'pos_refund',
          v_invoice::text || ':' || v_key, 'Refund ' || coalesce(v_pre.doc_invoice_number,v_invoice::text), auth.uid()::text);
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

-- Grants: invokable by authenticated users (functions self-authorize role
-- tier + carry membership + approval guards internally), never direct DML.
revoke all on function public.request_pos_approval(uuid,text,uuid,numeric,text,integer) from public, anon;
revoke all on function public.authorize_pos_approval(uuid) from public, anon;
revoke all on function public._ledgr_consume_pos_approval(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public._ledgr_correction_preflight(uuid,uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.void_pos_sale_command(jsonb) from public, anon;
revoke all on function public.refund_pos_sale_command(jsonb) from public, anon;
grant execute on function public.request_pos_approval(uuid,text,uuid,numeric,text,integer) to authenticated;
grant execute on function public.authorize_pos_approval(uuid) to authenticated;
grant execute on function public.void_pos_sale_command(jsonb) to authenticated;
grant execute on function public.refund_pos_sale_command(jsonb) to authenticated;

comment on function public.request_pos_approval is
  'R07 server-mints an approval token for one org/document/action. Caller: signed-in active member of the write tier. Authorization itself happens only via authorize_pos_approval.';
comment on function public.authorize_pos_approval is
  'R07 server-verified authorization: approver = authenticated owner/admin/manager of the same business; requester self-approval denied (register decision §9 parked); token expiry checked; approve-once enforced.';
comment on function public.void_pos_sale_command is
  'R07 canonical void: full financial reversal (mirror all posted journal entries with posting keys void:<entry_id>), restock at original cost, status machine enforced, idempotent per command_key, zero mutation on reject. Approval token required outside owner/admin/manager.';
comment on function public.refund_pos_sale_command is
  'R07 canonical refund: cumulative refunds bounded by original total under the document row lock, tender/revenue reversal scaled at ORIGINAL amounts and original tender account, stock returned at original unit cost with COGS mirrored, idempotent per command_key, zero mutation on reject.';
