-- R08.2 — Trustworthy till context: terminals, authoritative shift/cash
-- commands, immutable signed closes, append-only late-arrival records.
--
-- Design sign-offs (docs/audits/LEDGR_R08_TILL_CONTEXT_SHIFT_REPORTING_IMPLEMENTATION_2026-09-21.md):
--   * DEC-08 "Named terminal per till": pos_terminals is the durable register
--     identity; a shift is bound to exactly one terminal + one cashier, both
--     server-resolved; one open shift per (business, terminal) and per
--     (business, cashier) enforced by partial unique indexes; late arrivals
--     become append-only pos_shift_late_adjustments rows; signed closes are
--     immutable pos_shift_closes snapshots with a persistent sequential number
--     (never Date.now()).
--   * DEC-03 "Single assignment + org-wide roles": access via
--     business_users.branch_id + can_access_branch(); org-wide roles
--     (owner/admin/manager/accountant/auditor) span all branches;
--     assigned-scope roles are restricted to their branch; NULL branch_id on
--     the assignment = explicit org-wide.
--   * Additive only: NO backfill of historical shifts/branches/terminals;
--     pre-R08 rows stay visible and visibly unlinked (terminal_id IS NULL).
--     The duplicate-open indexes deliberately exempt terminal-less legacy rows
--     (predicate `terminal_id is not null`) so creation can never fail on
--     pre-existing data — but every NEW open goes through the command and
--     carries a terminal.
--
-- Authority notes:
--   * pos_shifts / pos_cash_movements raw INSERT+UPDATE for app roles is REMOVED;
--     the only write paths are the canonical commands below (row reads stay
--     member-scoped plus branch scope). DELETE stays admin-tier.
--   * Caller-supplied identity is never trusted: cashier_id := auth.uid(),
--     cashier_name resolved server-side from user_profiles, branch derived from
--     the terminal, shift ownership resolved from stored rows.
--   * Commands are exactly-once: each takes a command_key used as an
--     idempotency key; replay of the same key returns the prior answer.
--   * R07/R06/R05: untouched by this migration. Close-time drawer arithmetic
--     is DERIVED from invoice_payments tenders + pos_corrections (R07) +
--     movement rows, never from the client-maintained counters.

-- ── 1. pos_terminals ────────────────────────────────────────────────────────
create table if not exists public.pos_terminals (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses(id) on delete cascade,
  name                  text not null check (char_length(name) between 1 and 64),
  branch_id             uuid not null references public.branches(id),
  preferred_location_id uuid references public.inventory_locations(id) on delete set null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  unique (business_id, name)
);
comment on table public.pos_terminals is
  'Durable till/register identity (R08 DEC-08 "named terminal per till"). Created/managed by admin tier; shift opens and POS sales bind to a terminal row so branch/location attribution is server-resolved, never caller-invented.';
alter  table public.pos_terminals enable row level security;
grant  select, insert, update on public.pos_terminals to authenticated;
revoke delete on public.pos_terminals from authenticated;

drop policy if exists pos_terminals_select on public.pos_terminals;
create policy pos_terminals_select on public.pos_terminals
  for select using (public.is_business_member(business_id));
drop policy if exists pos_terminals_write on public.pos_terminals;
create policy pos_terminals_write on public.pos_terminals
  for insert with check (public.can_admin_business_data(business_id));
drop policy if exists pos_terminals_update on public.pos_terminals;
create policy pos_terminals_update on public.pos_terminals
  for update using (public.can_admin_business_data(business_id));

-- ── 2. DEC-03 branch predicate ──────────────────────────────────────────────
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
         bu.role::text in ('owner','admin','manager','accountant','auditor')
         or bu.branch_id is null         -- explicit org-wide assignment choice
         or bu.branch_id = p_branch_id
       )
  );
$$;
comment on function public.can_access_branch(uuid, uuid) is
  'DEC-03 matrix: org-wide roles span branches; assigned-scope roles are restricted to business_users.branch_id; NULL assignment = explicit org-wide. Server-side only; call sites must pass trusted branch ids (e.g. from the terminal), never raw caller values for authorization.';
grant execute on function public.can_access_branch(uuid, uuid) to authenticated;

-- ── 3. Shift linkage & closes & late arrivals ───────────────────────────────
alter table public.pos_shifts add column if not exists terminal_id uuid references public.pos_terminals(id) on delete set null;
alter table public.pos_shifts add column if not exists open_command_key text;
alter table public.invoices  add column if not exists pos_shift_id  uuid references public.pos_shifts(id)  on delete set null;
alter table public.pos_cash_movements add column if not exists command_key text;

-- One open shift per till, and one open shift per cashier — only among
-- post-R08 (terminal-bound) opens; legacy terminal-less rows never collide.
create unique index if not exists pos_shifts_one_open_per_terminal
  on public.pos_shifts (business_id, terminal_id)
  where status = 'open' and terminal_id is not null;
create unique index if not exists pos_shifts_one_open_per_cashier
  on public.pos_shifts (business_id, cashier_id)
  where status = 'open' and terminal_id is not null;
create unique index if not exists pos_shifts_open_command_key_uq
  on public.pos_shifts (business_id, open_command_key)
  where open_command_key is not null;
create unique index if not exists pos_cash_movements_command_key_uq
  on public.pos_cash_movements (business_id, command_key)
  where command_key is not null;

create table if not exists public.pos_shift_closes (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  shift_id         uuid not null references public.pos_shifts(id),
  command_key      text not null,
  report_number    text not null,
  closed_by        uuid not null,
  cashier_id       uuid,
  terminal_id      uuid,
  branch_id        uuid,
  opened_at        timestamptz not null,
  closed_at        timestamptz not null,
  opening_cash     numeric not null,
  cash_tenders     numeric not null,
  other_tenders    numeric not null,
  refund_total     numeric not null,
  cash_in_total    numeric not null,
  cash_out_total   numeric not null,
  sales_count      integer not null,
  tender_breakdown jsonb not null default '{}'::jsonb,
  expected_cash    numeric not null,
  actual_cash      numeric not null,
  variance         numeric not null,
  variance_reason  text,
  notes            text,
  payload          jsonb not null,
  created_at       timestamptz not null default now(),
  unique (business_id, shift_id),
  unique (business_id, command_key)
);
create sequence if not exists public.pos_z_report_seq as bigint start 1;
comment on table public.pos_shift_closes is
  'Immutable signed close snapshot (R08): per-method tenders derived from authoritative invoice_payments, refunds from pos_corrections, drawer reconciliation, identities server-resolved, persistent sequential report_number (pos_z_report_seq). INSERT-only; re-close is denied by the canonical command and UPDATE/DELETE are not granted.';
alter table public.pos_shift_closes enable row level security;
grant select on public.pos_shift_closes to authenticated;
drop policy if exists pos_shift_closes_select on public.pos_shift_closes;
create policy pos_shift_closes_select on public.pos_shift_closes
  for select using (public.can_access_branch(business_id, branch_id));

create table if not exists public.pos_shift_late_adjustments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  shift_id       uuid not null references public.pos_shifts(id),
  invoice_id     uuid references public.invoices(id),
  command_key    text not null,
  amount         numeric not null,
  reason         text not null,
  detected_at    timestamptz not null,
  created_at     timestamptz not null default now(),
  unique (business_id, command_key)
);
comment on table public.pos_shift_late_adjustments is
  'DEC-08 late-arrival record: a sale posted after its shift closed keeps its own invoice but is recorded HERE as an append-only adjustment; the historical signed close is never rewritten. Reconciled state = close snapshot + Σ adjustments.';
alter table public.pos_shift_late_adjustments enable row level security;
grant select on public.pos_shift_late_adjustments to authenticated;
drop policy if exists pos_shift_late_adjust_select on public.pos_shift_late_adjustments;
create policy pos_shift_late_adjust_select on public.pos_shift_late_adjustments
  for select using (
    public.is_business_member(business_id)
    and public.can_access_branch(business_id, (select s.branch_id from public.pos_shifts s where s.id = shift_id))
  );

-- invoice.pos_shift_id is server-owned: set at posting by post_pos_sale,
-- never rewritten afterwards (R08.3 sets it; correction commands never touch).
create or replace function public._ledgr_guard_pos_shift_link()
returns trigger
language plpgsql
as $$
begin
  if new.pos_shift_id is distinct from old.pos_shift_id then
    raise exception 'pos_shift_id is immutable after posting (R08).' using errcode = '22023';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_pos_shift_link on public.invoices;
create trigger guard_pos_shift_link
  before update on public.invoices
  for each row execute function public._ledgr_guard_pos_shift_link();

-- ── 4. RLS reshape: close the raw bypass ────────────────────────────────────
-- Loud authority boundary, not a silent no-op: the original migration granted
-- GRANT ALL on both tables to authenticated; the canonical commands are
-- security definer and do not need app-role table privileges. Raw reads stay
-- available (member+branch-scoped), all raw WRITES to app roles are revoked.
revoke insert, update, delete on public.pos_shifts from authenticated;
revoke insert, update, delete on public.pos_cash_movements from authenticated;
grant select on public.pos_shifts to authenticated;
grant select on public.pos_cash_movements to authenticated;
drop policy if exists pos_shifts_insert on public.pos_shifts;
drop policy if exists pos_shifts_update on public.pos_shifts;
drop policy if exists pos_shifts_select on public.pos_shifts;
create policy pos_shifts_select on public.pos_shifts
  for select using (public.can_access_branch(business_id, branch_id));
drop policy if exists pos_cash_movements_insert on public.pos_cash_movements;
drop policy if exists pos_cash_movements_select on public.pos_cash_movements;
create policy pos_cash_movements_select on public.pos_cash_movements
  for select using (
    public.is_business_member(business_id)
    and public.can_access_branch(business_id, branch_id)
  );
comment on table public.pos_shifts is
  'POS shift lifecycle. App roles may READ member+branch-scoped rows only; opens/closes/total changes happen exclusively via open_pos_shift_command / close_pos_shift_command / record_pos_cash_movement_command (R08) so identity, authority, single-open invariants and atomicity are server-enforced. DELETE stays admin-tier.';
comment on table public.pos_cash_movements is
  'Drawer cash movements. Written only by record_pos_cash_movement_command (identity=auth.uid(), server name resolution, atomic with shift totals); DELETE stays admin-tier.';

-- ── 5. Canonical commands ───────────────────────────────────────────────────

-- Resolve the caller's display name from trusted state (never caller text).
create or replace function public._ledgr_pos_actor_name(p_uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(up.full_name), ''), 'POS user')
    from public.user_profiles up
   where up.id = p_uid
$$;

create or replace function public.open_pos_shift_command(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business uuid := (p_payload->>'business_id')::uuid;
  v_terminal uuid := (p_payload->>'terminal_id')::uuid;
  v_key      text := p_payload->>'command_key';
  v_opening  numeric := coalesce((p_payload->>'opening_cash')::numeric, 0);
  v_term     record;
  v_row      record;
  v_constraint text;
  v_uid      uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Anonymous callers cannot open a shift.' using errcode = '42501';
  end if;
  if v_business is null or v_terminal is null or v_key is null or v_key !~ '^[A-Za-z0-9:_-]{4,64}$' then
    raise exception 'open_pos_shift_command requires business_id, terminal_id and a well-formed command_key.' using errcode = '22023';
  end if;
  if not public.can_operate_pos(v_business) then
    raise exception 'Caller may not operate POS in this business.' using errcode = '42501';
  end if;

  -- Exactly-once replay: the same command key returns the prior answer.
  select * into v_row from public.pos_shifts
   where business_id = v_business and open_command_key = v_key and status = 'open';
  if found then
    return jsonb_build_object('result','open','idempotent',true,
      'shift_id', v_row.id, 'terminal_id', v_row.terminal_id, 'branch_id', v_row.branch_id,
      'cashier_id', v_row.cashier_id, 'cashier_name', v_row.cashier_name,
      'opened_at', v_row.opened_at, 'opening_cash', v_row.opening_cash);
  end if;

  -- Terminal belongs to the caller's business, is active, and in branch scope.
  select * into v_term from public.pos_terminals
   where id = v_terminal and business_id = v_business;
  if not found then
    raise exception 'Unknown or foreign terminal.' using errcode = '22023';
  end if;
  if not v_term.is_active then
    raise exception 'Terminal is deactivated.' using errcode = '22023';
  end if;
  if not public.can_access_branch(v_business, v_term.branch_id) then
    raise exception 'Caller has no access to the terminal''s branch.' using errcode = '42501';
  end if;

  -- Identity and branch are server-resolved.
  insert into public.pos_shifts (
    business_id, branch_id, terminal_id, cashier_id, cashier_name,
    opened_at, opening_cash, expected_cash, actual_cash, cash_variance,
    variance_reason, total_sales_amount, cash_sales_amount, other_sales_amount,
    refunds_amount, cash_in_amount, cash_out_amount, status, notes,
    open_command_key
  ) values (
    v_business, v_term.branch_id, v_term.id, v_uid, public._ledgr_pos_actor_name(v_uid),
    now(), v_opening, v_opening, null, null,
    null, 0, 0, 0,
    0, 0, 0, 'open', nullif(p_payload->>'notes',''),
    v_key
  )
  returning * into v_row;

  return jsonb_build_object('result','open','idempotent',false,
    'shift_id', v_row.id, 'terminal_id', v_row.terminal_id, 'branch_id', v_row.branch_id,
    'cashier_id', v_row.cashier_id, 'cashier_name', v_row.cashier_name,
    'opened_at', v_row.opened_at, 'opening_cash', v_row.opening_cash);

exception
  when unique_violation then
    get stacked diagnostics v_constraint := constraint_name;
    if v_constraint = 'pos_shifts_open_command_key_uq' then
      select * into v_row from public.pos_shifts
       where business_id = v_business and open_command_key = v_key;
      if found then
        return jsonb_build_object('result','open','idempotent',true,
          'shift_id', v_row.id, 'terminal_id', v_row.terminal_id, 'branch_id', v_row.branch_id,
          'cashier_id', v_row.cashier_id, 'cashier_name', v_row.cashier_name,
          'opened_at', v_row.opened_at, 'opening_cash', v_row.opening_cash);
      end if;
    end if;
    raise exception 'An open shift already exists for this cashier or this terminal (R08 single-open).' using errcode = '22023';
end;
$$;

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
    raise exception 'Pre-R08 (terminal-less) shifts cannot be closed by the canonical command; use the R08.4 management path.' using errcode = '22023';
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

  -- R07 seam WITHOUT touching R07: refunds against this shift's documents
  -- reduce the drawer by at most the cash portion of their original tenders.
  select coalesce(sum(least(c.amount, x.cash_portion)), 0) into v_refund
    from public.pos_corrections c
    join lateral (
      select coalesce(sum(ip2.amount) filter (where ip2.payment_method = 'cash'), 0) as cash_portion
        from public.invoice_payments ip2 where ip2.invoice_id = c.document_id
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

create or replace function public.record_pos_cash_movement_command(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift    record;
  v_business uuid;
  v_key      text := p_payload->>'command_key';
  v_type     text := p_payload->>'movement_type';
  v_amount   numeric := abs(coalesce((p_payload->>'amount')::numeric, 0));
  v_reason   text := p_payload->>'reason';
  v_row      record;
  v_uid      uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Anonymous callers cannot record cash movements.' using errcode = '42501';
  end if;
  if (p_payload->>'shift_id') is null or v_key is null or v_key !~ '^[A-Za-z0-9:_-]{4,64}$' then
    raise exception 'record_pos_cash_movement_command requires shift_id and a well-formed command_key.' using errcode = '22023';
  end if;
  if v_type not in ('cash_in','cash_out','petty_cash','safe_deposit') or v_amount <= 0 or nullif(coalesce(v_reason,''),'') is null then
    raise exception 'movement_type must be one of cash_in/cash_out/petty_cash/safe_deposit with a positive amount and a reason.' using errcode = '22023';
  end if;

  -- Lock target shift (serializes concurrent movement+totals transitions).
  select * into v_shift from public.pos_shifts where id = (p_payload->>'shift_id')::uuid for update;
  if not found then
    raise exception 'Unknown shift.' using errcode = '22023';
  end if;
  v_business := v_shift.business_id;
  if not public.can_operate_pos(v_business)
     or not public.can_access_branch(v_business, v_shift.branch_id) then
    raise exception 'Caller may not operate POS in this business/branch.' using errcode = '42501';
  end if;
  if v_shift.cashier_id is distinct from v_uid and not exists (
       select 1 from public.business_users bu
        where bu.business_id = v_business and bu.user_id = v_uid
          and bu.is_active = true and bu.role::text in ('owner','admin','manager')) then
    raise exception 'Only the shift''s cashier or a business manager may record drawer movements on it.' using errcode = '42501';
  end if;
  if v_shift.status <> 'open' then
    raise exception 'Cash movements require an open shift.' using errcode = '22023';
  end if;

  -- Idempotent replay.
  select * into v_row from public.pos_cash_movements
   where business_id = v_business and command_key = v_key;
  if found then
    return jsonb_build_object('result','movement','idempotent', true,
      'movement_id', v_row.id, 'shift_id', v_row.shift_id,
      'movement_type', v_row.movement_type, 'amount', v_row.amount);
  end if;

  -- Atomic pair: movement row + totals transition in this one transaction.
  insert into public.pos_cash_movements (
    business_id, branch_id, shift_id, user_id, user_name,
    movement_type, amount, reason, command_key, created_at
  ) values (
    v_business, v_shift.branch_id, v_shift.id, v_uid, public._ledgr_pos_actor_name(v_uid),
    v_type, v_amount, v_reason, v_key, now()
  ) returning * into v_row;

  update public.pos_shifts
     set cash_in_amount  = cash_in_amount  + case when v_type in ('cash_in','safe_deposit') then v_amount else 0 end,
         cash_out_amount = cash_out_amount + case when v_type in ('cash_out','petty_cash') then v_amount else 0 end,
         expected_cash   = opening_cash
                           + cash_sales_amount
                           - refunds_amount
                           + (cash_in_amount  + case when v_type in ('cash_in','safe_deposit') then v_amount else 0 end)
                           - (cash_out_amount + case when v_type in ('cash_out','petty_cash') then v_amount else 0 end),
         updated_at = now()
   where id = v_shift.id and status = 'open';

  return jsonb_build_object('result','movement','idempotent', false,
    'movement_id', v_row.id, 'shift_id', v_shift.id,
    'movement_type', v_type, 'amount', v_amount);
end;
$$;

comment on function public.open_pos_shift_command(jsonb) is
  'R08 canonical shift open: server resolves caller identity (auth.uid + user_profiles), terminal→branch attribution, DEC-03 branch scope, single-open invariants (per terminal & cashier), exactly-once on command_key. Rejection = zero mutation.';
comment on function public.close_pos_shift_command(jsonb) is
  'R08 canonical shift close: row-locked single transition to closed; immutable pos_shift_closes snapshot with per-method tenders derived from invoice_payments, R07 refunds derived from pos_corrections (bounded by the document cash share), drawer arithmetic, persistent sequential report_number, own-shift/manager authority, idempotent replay on command_key, re-close under any key denied with 22023.';
comment on function public.record_pos_cash_movement_command(jsonb) is
  'R08 canonical drawer movement: server identity/branch/authority, amount>0, atomic movement-row + totals transition on the locked shift, exactly-once on command_key.';

revoke all on function public.open_pos_shift_command(jsonb)               from public, anon;
revoke all on function public.close_pos_shift_command(jsonb)              from public, anon;
revoke all on function public.record_pos_cash_movement_command(jsonb)     from public, anon;
grant execute on function public.open_pos_shift_command(jsonb)            to authenticated;
grant execute on function public.close_pos_shift_command(jsonb)           to authenticated;
grant execute on function public.record_pos_cash_movement_command(jsonb)  to authenticated;
