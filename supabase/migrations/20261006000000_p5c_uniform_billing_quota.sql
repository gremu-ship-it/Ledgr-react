-- ============================================================================
-- P5-C (Q12 B + Q13 C) — Uniform authoritative P0QLT + dual authority.
--
-- Q12 B: every relevant billable document creation must be subject to the
-- authoritative monthly usage entitlement: invoices, expenses, payroll_runs.
-- Previously only the three single-round-trip RPCs (post_pos_sale,
-- save_quick_sale, save_quick_expense) called _ledgr_assert_usage_limit;
-- direct repository inserts (InvoiceRepository.createWithLines,
-- ExpenseRepository.createWithLines, PayrollRepository.createWithLines,
-- invoice builder, legacy paths) bypassed it.
--
-- Q13 C: capture-time/entitlement check (UsageService at enqueue) + authoritative
-- server-side P0QLT. The capture-time check is UX early guard; the trigger
-- below is the authority that cannot be bypassed.
--
-- This migration makes the authority UNIFORM and RACE-SAFE:
--
--   1. _ledgr_assert_usage_limit is redefined to serialize per-tenant:
--      it SELECTs the businesses row FOR UPDATE before counting. Two
--      concurrent transactions for the same business now block on that row
--      lock, then re-count after the first commits — so only one can consume
--      the final entitlement. Advisory-lock alternative was considered but
--      row-level lock is minimal and matches the existing stock invariant
--      pattern (FOR UPDATE on inventory_balances).
--
--      The function still counts documents (invoices + expenses + payroll_runs)
--      dated this month, tenant-scoped, via security-definer count, same
--      month boundary (date_trunc('month', current_date)), same limit table,
--      same P0QLT raise with DETAIL/HINT.
--
--   2. Three BEFORE INSERT triggers on invoices, expenses, payroll_runs call
--      the assert for EVERY insert, no matter the path (RPC, repository,
--      builder, legacy, direct). The RPCs keep their explicit perform as
--      well (redundant but harmless — double-assert still sees the same usage
--      before the insert, both under the same FOR UPDATE lock).
--
--      The trigger functions handle idempotent client_key: if NEW.client_key
--      already exists for this business, the assert is skipped — the existing
--      document is already counted, and the unique index will make the insert
--      a no-op (or the repository already short-circuited). Without this,
--      a replay at limit would be incorrectly denied as quota when it is not
--      a new billable document.
--
--   3. No TTL, no branch, no AI, no RLS, no stock/period/journal change.
--      All prior guards (R06 stock 23514, R08 branch/terminal/shift,
--      R10 P0QLT contract) are preserved verbatim.
--
-- ADDITIVE + IDEMPOTENT: create-or-replace functions, drop-if-exists triggers.
-- No data changes, no existing row affected, no policy narrowed beyond quota.
-- ============================================================================

-- ── 1. Locked authoritative assert ──────────────────────────────────────────
do $$
begin
  if to_regclass('public.journal_entries') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.expenses') is null
     or to_regclass('public.payroll_runs') is null then
    raise notice 'Core tables missing, skipping P5-C usage-limit function update.';
    return;
  end if;

  execute $fn$
    create or replace function public._ledgr_assert_usage_limit(
      p_business_id uuid
    ) returns void
    language plpgsql
    volatile
    security definer
    set search_path = public
    as $body$
    declare
      v_limit integer;
      v_usage bigint := 0;
      v_month_start date := date_trunc('month', current_date)::date;
    begin
      -- Serialize per-tenant: every billable insert locks the business row
      -- before counting. Two concurrent transactions for the same tenant
      -- now correctly see each other's committed insert (one succeeds with
      -- P0QLT for the loser). This is the smallest correct lock — one row,
      -- same pattern as the R06 stock invariant (FOR UPDATE on balance).
      perform 1 from public.businesses where id = p_business_id for update;

      select case coalesce(b.plan_tier, 'free')
               when 'free' then 50
               when 'starter' then 200
               when 'growth' then 500
               when 'pro' then 2000
               when 'enterprise' then null
               else 50
             end
        into v_limit
        from public.businesses b
       where b.id = p_business_id;

      if v_limit is null then
        return;                              -- unlimited
      end if;

      select
          (select count(*) from public.invoices
            where business_id = p_business_id and issue_date   >= v_month_start)
        + (select count(*) from public.expenses
            where business_id = p_business_id and expense_date >= v_month_start)
        + (select count(*) from public.payroll_runs
            where business_id = p_business_id and pay_date     >= v_month_start)
        into v_usage;

      if v_usage >= v_limit then
        raise exception 'Monthly transaction limit reached (%). Please upgrade your plan.', v_limit
          using errcode = 'P0QLT',
                detail = format('quota_denial plan_limit=%s documents_used=%s period_start=%s', v_limit, v_usage, v_month_start),
                hint = 'Policy denial (monthly document quota) — not a transient failure. Do not retry without a plan change.';
      end if;
    end;
    $body$;
  $fn$;

  execute $cmt$comment on function public._ledgr_assert_usage_limit(uuid) is
    'P5-C authoritative monthly document-quota assertion (uniform + race-safe). Every invoices/expenses/payroll_runs INSERT is now serialized per-tenant via FOR UPDATE on businesses before counting (P13 two-connection race proof). Quota denial raises dedicated SQLSTATE P0QLT (+ policy DETAIL/HINT). Called by post_pos_sale/save_quick_* and by the three BEFORE INSERT triggers (uniform authority). Idempotent client_key bypasses the limit (already counted).'$cmt$;
end
$$;

-- ── 2. Uniform BEFORE INSERT triggers ───────────────────────────────────────

-- Invoices
create or replace function public._ledgr_before_insert_invoices_quota()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  -- Idempotent replay: the document already exists under this client_key
  -- and is already counted in _ledgr_assert_usage_limit's count. Do not
  -- re-assert quota for a replay — it is not a new billable document.
  if NEW.client_key is not null then
    select exists(
      select 1 from public.invoices
       where business_id = NEW.business_id and client_key = NEW.client_key
    ) into v_exists;
    if v_exists then
      return NEW;
    end if;
  end if;
  perform public._ledgr_assert_usage_limit(NEW.business_id);
  return NEW;
end;
$$;

drop trigger if exists trg_invoices_quota on public.invoices;
create trigger trg_invoices_quota
  before insert on public.invoices
  for each row execute function public._ledgr_before_insert_invoices_quota();

-- Expenses
create or replace function public._ledgr_before_insert_expenses_quota()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if NEW.client_key is not null then
    select exists(
      select 1 from public.expenses
       where business_id = NEW.business_id and client_key = NEW.client_key
    ) into v_exists;
    if v_exists then
      return NEW;
    end if;
  end if;
  perform public._ledgr_assert_usage_limit(NEW.business_id);
  return NEW;
end;
$$;

drop trigger if exists trg_expenses_quota on public.expenses;
create trigger trg_expenses_quota
  before insert on public.expenses
  for each row execute function public._ledgr_before_insert_expenses_quota();

-- Payroll runs
create or replace function public._ledgr_before_insert_payroll_runs_quota()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if NEW.client_key is not null then
    select exists(
      select 1 from public.payroll_runs
       where business_id = NEW.business_id and client_key = NEW.client_key
    ) into v_exists;
    if v_exists then
      return NEW;
    end if;
  end if;
  perform public._ledgr_assert_usage_limit(NEW.business_id);
  return NEW;
end;
$$;

drop trigger if exists trg_payroll_runs_quota on public.payroll_runs;
create trigger trg_payroll_runs_quota
  before insert on public.payroll_runs
  for each row execute function public._ledgr_before_insert_payroll_runs_quota();

-- ── 3. Comments ─────────────────────────────────────────────────────────────
comment on function public._ledgr_before_insert_invoices_quota() is
  'P5-C uniform quota trigger — invoices. Calls the locked _ledgr_assert_usage_limit; idempotent client_key bypasses (already counted).';
comment on function public._ledgr_before_insert_expenses_quota() is
  'P5-C uniform quota trigger — expenses. Calls the locked _ledgr_assert_usage_limit; idempotent client_key bypasses.';
comment on function public._ledgr_before_insert_payroll_runs_quota() is
  'P5-C uniform quota trigger — payroll_runs. Calls the locked _ledgr_assert_usage_limit; idempotent client_key bypasses.';
