-- OWNER DECISION 2026-09-26 — INVOICE EDIT POLICY (H04), recommended controls:
--
-- A. PERIOD LOCK (existing accounting_periods, now enforced)
--    * owner / admin / accountant close an ended period (no draft journals in
--      it); only the OWNER reopens, with a written reason. Every close/reopen is
--      logged (accounting_period_events); is_closed can no longer be flipped by
--      a direct table update.
--    * Nothing dated on or before the lock date can be inserted, changed or
--      deleted: journal entries + lines, invoices + lines, invoice payments,
--      expenses, expense payments, stock movements. This applies to EVERY
--      writer (API, RPCs, service role): corrections go into the open period
--      (credit note, reversing journal, stock adjustment) — IAS 8 / audit trail.
--    * Allowed on a closed-period invoice: settlement fields only (amount_paid,
--      status among sent/partially_paid/paid/overdue) so a payment received
--      TODAY on an old invoice still works. Allowed on a closed-period journal
--      entry: being marked reversed by a reversal dated in the open period.
--
-- B. INVOICE APPROVAL (segregation of duties)
--    * An invoice leaving 'draft' (or inserted as non-draft) needs approval by a
--      DIFFERENT person (owner, admin or accountant) when
--        - the person who created it holds a role in the policy list
--          (default: sales_clerk, data_entry, cashier), or
--        - its total ≥ the business threshold (default: none), unless the
--          creator is the owner.
--    * Till sales (post_pos_sale: pos_shift_id / payload_hash set) are exempt —
--      they are governed by the till controls (D-PRICE, R07, R08).
--    * Approvals are rows in invoice_approvals (append-only, written only by
--      approve_invoice; documents carry no approval columns — R07 rule).
--      Editing an approved draft (amounts, customer, date, lines) REVOKES it.
--
-- No data is changed. NOTE: periods ALREADY marked closed in accounting_periods
-- become enforced from this migration on (that was their stated meaning).

-- ── A. period lock (on the EXISTING accounting_periods table) ─────────────────
-- accounting_periods / is_closed already exist and are toggled from
-- Settings → Period management, but nothing in the migration chain enforced
-- them (the triggers named in PeriodRepository comments are not in this repo;
-- their production existence is NOT assumed). This makes a closed period real.
create table if not exists public.accounting_period_events (
  id              bigserial primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  period_id       uuid not null references public.accounting_periods(id) on delete cascade,
  action          text not null check (action in ('close', 'reopen')),
  reason          text not null,
  actor           uuid,
  created_at      timestamptz not null default now()
);
alter table public.accounting_period_events enable row level security;
drop policy if exists period_events_member_read on public.accounting_period_events;
create policy period_events_member_read on public.accounting_period_events for select to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = accounting_period_events.business_id
                   and bu.user_id = auth.uid() and bu.is_active));
revoke all on public.accounting_period_events from anon, authenticated;
grant select on public.accounting_period_events to authenticated;

create or replace function public._ledgr_member_role(p_business uuid, p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select role::text from public.business_users
   where business_id = p_business and user_id = p_user and is_active limit 1;
$$;
revoke all on function public._ledgr_member_role(uuid, uuid) from public, anon, authenticated;

create or replace function public._ledgr_closed_period(p_business uuid, p_date date)
returns public.accounting_periods language sql stable security definer set search_path = public as $$
  select * from public.accounting_periods
   where business_id = p_business and is_closed and p_date between period_start and period_end
   order by period_start limit 1;
$$;
revoke all on function public._ledgr_closed_period(uuid, date) from public, anon, authenticated;

create or replace function public._ledgr_period_is_open(p_business uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select (public._ledgr_closed_period(p_business, p_date)).id is null;
$$;
revoke all on function public._ledgr_period_is_open(uuid, date) from public, anon, authenticated;

create or replace function public._ledgr_assert_period_open(p_business uuid, p_date date, p_what text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_p public.accounting_periods;
begin
  if p_business is null or p_date is null then return; end if;
  v_p := public._ledgr_closed_period(p_business, p_date);
  if v_p.id is not null then
    raise exception 'period-closed: % dated % falls in the closed period "%" (% to %). Record the correction in an open period (credit note, reversing journal or stock adjustment).',
      p_what, p_date, v_p.name, v_p.period_start, v_p.period_end using errcode = '22023';
  end if;
end;
$$;
revoke all on function public._ledgr_assert_period_open(uuid, date, text) from public, anon, authenticated;

create or replace function public.close_accounting_period(p_period_id uuid, p_reason text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_p public.accounting_periods%rowtype;
  v_draft_journals int; v_draft_invoices int;
begin
  if v_user is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into v_p from public.accounting_periods where id = p_period_id for update;
  if not found then raise exception 'Period not found.' using errcode = '42501'; end if;
  if coalesce(public._ledgr_member_role(v_p.business_id, v_user), '') not in ('owner', 'admin', 'accountant') then
    raise exception 'Only the owner, an admin or the accountant can close a period.' using errcode = '42501';
  end if;
  if v_p.is_closed then raise exception 'This period is already closed.' using errcode = '22023'; end if;
  if v_p.period_end >= current_date then
    raise exception 'A period can only be closed after it has ended (ends %).', v_p.period_end using errcode = '22023';
  end if;
  select count(*) into v_draft_journals from public.journal_entries
   where business_id = v_p.business_id and status::text = 'draft' and entry_date between v_p.period_start and v_p.period_end;
  if v_draft_journals > 0 then
    raise exception 'Post or delete the % draft journal entr(y/ies) dated in this period before closing it.', v_draft_journals using errcode = '22023';
  end if;
  select count(*) into v_draft_invoices from public.invoices
   where business_id = v_p.business_id and status::text = 'draft' and issue_date between v_p.period_start and v_p.period_end;
  perform set_config('ledgr.period_command', p_period_id::text, true);
  update public.accounting_periods set is_closed = true, closed_at = now(), closed_by = v_user::text, updated_at = now()
   where id = p_period_id;
  perform set_config('ledgr.period_command', '', true);
  insert into public.accounting_period_events (business_id, period_id, action, reason, actor)
  values (v_p.business_id, p_period_id, 'close', coalesce(nullif(btrim(p_reason), ''), 'Period close'), v_user);
  return jsonb_build_object('period_id', p_period_id, 'is_closed', true, 'draft_invoices_in_period', v_draft_invoices);
end;
$$;

create or replace function public.reopen_accounting_period(p_period_id uuid, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_p public.accounting_periods%rowtype;
begin
  if v_user is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into v_p from public.accounting_periods where id = p_period_id for update;
  if not found then raise exception 'Period not found.' using errcode = '42501'; end if;
  if coalesce(public._ledgr_member_role(v_p.business_id, v_user), '') <> 'owner' then
    raise exception 'Only the owner can reopen a closed period.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Reopening a closed period needs a written reason (at least 10 characters).' using errcode = '22023';
  end if;
  if not v_p.is_closed then raise exception 'This period is not closed.' using errcode = '22023'; end if;
  perform set_config('ledgr.period_command', p_period_id::text, true);
  update public.accounting_periods set is_closed = false, closed_at = null, closed_by = null, updated_at = now()
   where id = p_period_id;
  perform set_config('ledgr.period_command', '', true);
  insert into public.accounting_period_events (business_id, period_id, action, reason, actor)
  values (v_p.business_id, p_period_id, 'reopen', btrim(p_reason), v_user);
  return jsonb_build_object('period_id', p_period_id, 'is_closed', false);
end;
$$;
revoke all on function public.close_accounting_period(uuid, text) from public, anon;
revoke all on function public.reopen_accounting_period(uuid, text) from public, anon;
grant execute on function public.close_accounting_period(uuid, text) to authenticated;
grant execute on function public.reopen_accounting_period(uuid, text) to authenticated;

-- accounting_periods itself: is_closed changes only through the commands; a
-- closed period's dates cannot be edited and it cannot be deleted.
create or replace function public._ledgr_guard_accounting_period()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cmd boolean := current_setting('ledgr.period_command', true) = coalesce(new.id, old.id)::text;
begin
  if tg_op = 'DELETE' then
    if old.is_closed then raise exception 'period-closed: a closed period cannot be deleted; reopen it first.' using errcode = '22023'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.is_closed and not v_cmd then new.is_closed := false; new.closed_at := null; new.closed_by := null; end if;
    return new;
  end if;
  if new.is_closed is distinct from old.is_closed and not v_cmd then
    raise exception 'Use close_accounting_period / reopen_accounting_period to change a period''s status (logged, role-checked).' using errcode = '42501';
  end if;
  if old.is_closed and not v_cmd and (new.period_start, new.period_end, new.business_id) is distinct from (old.period_start, old.period_end, old.business_id) then
    raise exception 'period-closed: the dates of a closed period cannot be changed.' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public._ledgr_guard_accounting_period() from public, anon, authenticated;
drop trigger if exists trg_aa_guard_accounting_period on public.accounting_periods;
create trigger trg_aa_guard_accounting_period before insert or update or delete on public.accounting_periods
  for each row execute function public._ledgr_guard_accounting_period();

-- Generic dated-row guard: TG_ARGV[0] = date column, TG_ARGV[1] = label.
create or replace function public._ledgr_period_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_col text := tg_argv[0];
  v_old jsonb; v_new jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old := to_jsonb(old);
    perform public._ledgr_assert_period_open((v_old->>'business_id')::uuid, (v_old->>v_col)::date, tg_argv[1]);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_new := to_jsonb(new);
    perform public._ledgr_assert_period_open((v_new->>'business_id')::uuid, (v_new->>v_col)::date, tg_argv[1]);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Invoices: settlement-only updates stay possible on a closed-period invoice.
create or replace function public._ledgr_period_guard_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_settle constant text[] := array['amount_paid', 'amount_due', 'status', 'updated_at', 'exchange_rate_used'];  -- + generated columns (NULL in BEFORE triggers)
begin
  if tg_op = 'UPDATE' then
    if not public._ledgr_period_is_open(old.business_id, old.issue_date)
       and (to_jsonb(new) - c_settle - 'journal_entry_id') = (to_jsonb(old) - c_settle - 'journal_entry_id')
       and (new.journal_entry_id is not distinct from old.journal_entry_id or old.journal_entry_id is null)
       and new.status::text in ('sent', 'partially_paid', 'paid', 'overdue')
       and old.status::text in ('sent', 'partially_paid', 'paid', 'overdue') then
      return new;  -- payment received in the open period on an old invoice
    end if;
    perform public._ledgr_assert_period_open(old.business_id, old.issue_date, 'Invoice');
    perform public._ledgr_assert_period_open(new.business_id, new.issue_date, 'Invoice');
    return new;
  elsif tg_op = 'DELETE' then
    perform public._ledgr_assert_period_open(old.business_id, old.issue_date, 'Invoice');
    return old;
  end if;
  perform public._ledgr_assert_period_open(new.business_id, new.issue_date, 'Invoice');
  return new;
end;
$$;

create or replace function public._ledgr_period_guard_journal_entry()
returns trigger language plpgsql security definer set search_path = public as $$
declare c_rev constant text[] := array['status', 'reversed_by', 'reversed_at', 'reversal_reason', 'updated_at'];
begin
  if tg_op = 'UPDATE' and new.status::text = 'reversed'
     and (to_jsonb(new) - c_rev) = (to_jsonb(old) - c_rev) then
    return new;  -- marked reversed by a reversal entry dated in the open period
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform public._ledgr_assert_period_open(old.business_id, old.entry_date, 'Journal entry');
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform public._ledgr_assert_period_open(new.business_id, new.entry_date, 'Journal entry');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public._ledgr_period_guard_child()
returns trigger language plpgsql security definer set search_path = public as $$
-- TG_ARGV: 0 parent table, 1 fk column, 2 parent date column, 3 label
declare v_row jsonb; v_b uuid; v_d date;
begin
  foreach v_row in array case tg_op when 'INSERT' then array[to_jsonb(new)] when 'DELETE' then array[to_jsonb(old)]
                                     else array[to_jsonb(old), to_jsonb(new)] end loop
    execute format('select business_id, %I::date from public.%I where id = $1', tg_argv[2], tg_argv[0])
      into v_b, v_d using (v_row->>tg_argv[1])::uuid;
    perform public._ledgr_assert_period_open(v_b, v_d, tg_argv[3]);
  end loop;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public._ledgr_period_guard(), public._ledgr_period_guard_invoice(),
  public._ledgr_period_guard_journal_entry(), public._ledgr_period_guard_child() from public, anon, authenticated;

drop trigger if exists trg_aa_period_lock on public.invoices;
create trigger trg_aa_period_lock before insert or update or delete on public.invoices
  for each row execute function public._ledgr_period_guard_invoice();
drop trigger if exists trg_aa_period_lock on public.invoice_lines;
create trigger trg_aa_period_lock before insert or update or delete on public.invoice_lines
  for each row execute function public._ledgr_period_guard_child('invoices', 'invoice_id', 'issue_date', 'Invoice line');
drop trigger if exists trg_aa_period_lock on public.journal_entries;
create trigger trg_aa_period_lock before insert or update or delete on public.journal_entries
  for each row execute function public._ledgr_period_guard_journal_entry();
drop trigger if exists trg_aa_period_lock on public.journal_lines;
create trigger trg_aa_period_lock before insert or update or delete on public.journal_lines
  for each row execute function public._ledgr_period_guard_child('journal_entries', 'journal_entry_id', 'entry_date', 'Journal line');
drop trigger if exists trg_aa_period_lock on public.invoice_payments;
create trigger trg_aa_period_lock before insert or update or delete on public.invoice_payments
  for each row execute function public._ledgr_period_guard('payment_date', 'Invoice payment');
drop trigger if exists trg_aa_period_lock on public.expenses;
create trigger trg_aa_period_lock before insert or update or delete on public.expenses
  for each row execute function public._ledgr_period_guard('expense_date', 'Expense');
drop trigger if exists trg_aa_period_lock on public.expense_payments;
create trigger trg_aa_period_lock before insert or update or delete on public.expense_payments
  for each row execute function public._ledgr_period_guard('payment_date', 'Expense payment');
drop trigger if exists trg_aa_period_lock on public.stock_movements;
create trigger trg_aa_period_lock before insert or update or delete on public.stock_movements
  for each row execute function public._ledgr_period_guard('movement_date', 'Stock movement');

-- ── B. invoice approval ─────────────────────────────────────────────────────
alter table public.invoices add column if not exists submitted_by uuid;

-- Approval state lives OUTSIDE the financial document (R07 design rule:
-- documents carry no approval columns). Append-only: an approval is never
-- deleted; editing an approved draft REVOKES it (revoked_at + reason).
create table if not exists public.invoice_approvals (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  approved_by    uuid not null,
  approved_at    timestamptz not null default now(),
  note           text,
  revoked_at     timestamptz,
  revoked_reason text
);
create unique index if not exists uq_invoice_approvals_live on public.invoice_approvals(invoice_id) where revoked_at is null;
alter table public.invoice_approvals enable row level security;
drop policy if exists invoice_approvals_member_read on public.invoice_approvals;
create policy invoice_approvals_member_read on public.invoice_approvals for select to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = invoice_approvals.business_id
                   and bu.user_id = auth.uid() and bu.is_active));
revoke all on public.invoice_approvals from anon, authenticated;
grant select on public.invoice_approvals to authenticated;

create table if not exists public.invoice_approval_policies (
  business_id  uuid primary key references public.businesses(id) on delete cascade,
  enabled      boolean not null default true,
  threshold    numeric check (threshold is null or threshold > 0),
  roles        text[] not null default array['sales_clerk', 'data_entry', 'cashier'],
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
alter table public.invoice_approval_policies enable row level security;
drop policy if exists invoice_approval_policies_member_read on public.invoice_approval_policies;
create policy invoice_approval_policies_member_read on public.invoice_approval_policies for select to authenticated
  using (exists (select 1 from public.business_users bu where bu.business_id = invoice_approval_policies.business_id
                   and bu.user_id = auth.uid() and bu.is_active));
revoke all on public.invoice_approval_policies from anon, authenticated;
grant select on public.invoice_approval_policies to authenticated;

create or replace function public.set_invoice_approval_policy(p_business_id uuid, p_enabled boolean, p_threshold numeric, p_roles text[] default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_row public.invoice_approval_policies%rowtype;
begin
  if coalesce(public._ledgr_member_role(p_business_id, v_user), '') not in ('owner', 'admin') then
    raise exception 'Only the owner or an admin can change the invoice approval policy.' using errcode = '42501';
  end if;
  insert into public.invoice_approval_policies (business_id, enabled, threshold, roles, updated_by)
  values (p_business_id, coalesce(p_enabled, true), p_threshold,
          coalesce(p_roles, array['sales_clerk', 'data_entry', 'cashier']), v_user)
  on conflict (business_id) do update set enabled = excluded.enabled, threshold = excluded.threshold,
    roles = excluded.roles, updated_by = v_user, updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.set_invoice_approval_policy(uuid, boolean, numeric, text[]) from public, anon;
grant execute on function public.set_invoice_approval_policy(uuid, boolean, numeric, text[]) to authenticated;

create or replace function public._ledgr_invoice_needs_approval(p_business uuid, p_submitter uuid, p_total numeric)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_pol public.invoice_approval_policies%rowtype; v_role text;
begin
  select * into v_pol from public.invoice_approval_policies where business_id = p_business;
  if not found then
    v_pol.enabled := true; v_pol.threshold := null; v_pol.roles := array['sales_clerk', 'data_entry', 'cashier'];
  end if;
  if not v_pol.enabled or p_submitter is null then return false; end if;
  v_role := public._ledgr_member_role(p_business, p_submitter);
  if v_role = any(v_pol.roles) then return true; end if;
  return v_pol.threshold is not null and coalesce(p_total, 0) >= v_pol.threshold and coalesce(v_role, '') <> 'owner';
end;
$$;
revoke all on function public._ledgr_invoice_needs_approval(uuid, uuid, numeric) from public, anon, authenticated;

create or replace function public._ledgr_revoke_invoice_approval(p_invoice uuid, p_reason text)
returns void language sql volatile security definer set search_path = public as $$
  update public.invoice_approvals set revoked_at = now(), revoked_reason = p_reason
   where invoice_id = p_invoice and revoked_at is null;
$$;
revoke all on function public._ledgr_revoke_invoice_approval(uuid, text) from public, anon, authenticated;

create or replace function public._ledgr_invoice_approval_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c_material constant text[] := array['total_amount', 'subtotal', 'discount_amount', 'vat_amount', 'contact_id', 'issue_date', 'currency'];
  k text;
begin
  if tg_op = 'INSERT' then
    new.submitted_by := coalesce(auth.uid(), new.submitted_by);
  else
    new.submitted_by := old.submitted_by;  -- immutable
    if old.status::text = 'draft' then
      foreach k in array c_material loop
        if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
          perform public._ledgr_revoke_invoice_approval(new.id, 'Draft edited after approval (' || k || ')');
          exit;
        end if;
      end loop;
    end if;
  end if;

  if new.status::text <> 'draft' and (tg_op = 'INSERT' or old.status::text = 'draft')
     and new.pos_shift_id is null and new.payload_hash is null
     and not exists (select 1 from public.invoice_approvals a where a.invoice_id = new.id and a.revoked_at is null)
     and public._ledgr_invoice_needs_approval(new.business_id, new.submitted_by, new.total_amount) then
    raise exception 'invoice-approval-required: this invoice must be approved by the owner, an admin or the accountant (not its creator) before it is issued. Save it as a draft and request approval.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public._ledgr_invoice_approval_guard() from public, anon, authenticated;
drop trigger if exists trg_ab_invoice_approval on public.invoices;
create trigger trg_ab_invoice_approval before insert or update on public.invoices
  for each row execute function public._ledgr_invoice_approval_guard();

-- Editing lines of an approved draft revokes the approval.
create or replace function public._ledgr_invoice_line_revokes_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  if exists (select 1 from public.invoices where id = v_id and status::text = 'draft') then
    perform public._ledgr_revoke_invoice_approval(v_id, 'Draft lines edited after approval');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public._ledgr_invoice_line_revokes_approval() from public, anon, authenticated;
drop trigger if exists trg_zz_invoice_line_revokes_approval on public.invoice_lines;
create trigger trg_zz_invoice_line_revokes_approval after insert or update or delete on public.invoice_lines
  for each row execute function public._ledgr_invoice_line_revokes_approval();

create or replace function public.approve_invoice(p_invoice_id uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_inv public.invoices%rowtype; v_id uuid;
begin
  if v_user is null then raise exception 'You must be signed in.' using errcode = '42501'; end if;
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found.' using errcode = '42501'; end if;
  if coalesce(public._ledgr_member_role(v_inv.business_id, v_user), '') not in ('owner', 'admin', 'accountant') then
    raise exception 'Only the owner, an admin or the accountant can approve invoices.' using errcode = '42501';
  end if;
  if v_inv.submitted_by = v_user then
    raise exception 'The person who created an invoice cannot approve it.' using errcode = '22023';
  end if;
  if v_inv.status::text <> 'draft' then
    raise exception 'Only draft invoices can be approved.' using errcode = '22023';
  end if;
  perform public._ledgr_revoke_invoice_approval(p_invoice_id, 'Superseded by a new approval');
  insert into public.invoice_approvals (business_id, invoice_id, approved_by, note)
  values (v_inv.business_id, p_invoice_id, v_user, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return jsonb_build_object('approval_id', v_id, 'invoice_id', p_invoice_id, 'approved_by', v_user);
end;
$$;
revoke all on function public.approve_invoice(uuid, text) from public, anon;
grant execute on function public.approve_invoice(uuid, text) to authenticated;

comment on table public.accounting_period_events is 'Close/reopen log for accounting_periods (owner decision 2026-09-26). Status changes only via close_/reopen_accounting_period.';
comment on table public.invoice_approval_policies is 'Invoice four-eyes policy (owner decision 2026-09-26). No row = enabled for sales_clerk/data_entry/cashier, no amount threshold.';
