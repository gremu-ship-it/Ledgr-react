-- ============================================================================
-- Subscription expiry enforcement (2026-10-01 verification follow-up)
--
-- Reported symptom: "monthly subscription has not ended even though this is a
-- new month." Verified root causes:
--
--   1. The nightly `expire-subscriptions` pg_cron job was scheduled with the
--      literal <PROJECT_REF>/<CRON_SECRET> placeholders, so it has never
--      fired — nothing ever downgraded a lapsed plan. (Fixed in CI: deploy.yml
--      now runs scripts/cron-jobs.sql with the real values after db push.)
--   2. A "monthly" term was a fixed 31 days, so a plan bought on the 1st ran
--      to the 2nd of the next month. (Fixed in
--      supabase/functions/initiate-subscription-payment.)
--   3. Nothing read `plan_expires_at` when deciding entitlements — the
--      authoritative quota assert looked at `plan_tier` alone, which is why
--      cause 1 handed out unlimited free extensions of paid plans.
--
-- This migration addresses (3) server-side, so the cron is row tidy-up rather
-- than the only thing enforcing expiry, and back-fills rows that lapsed while
-- the cron was dead.
--
-- ADDITIVE + IDEMPOTENT: create-or-replace functions, constraint re-created,
-- back-fill is a no-op on a healthy database.
-- ============================================================================

-- ── 1. effective_plan_tier ──────────────────────────────────────────────────
-- Single server-side definition of "what tier is this business actually
-- entitled to right now". Mirrors effectivePlanTier() in
-- src/lib/billing/plans.ts — keep both in sync.
--
-- STABLE (not IMMUTABLE): depends on now().
create or replace function public.effective_plan_tier(
  p_plan_tier       text,
  p_plan_expires_at timestamptz
) returns text
language sql
stable
as $$
  select case
    when coalesce(p_plan_tier, 'free') = 'free' then 'free'
    -- NULL expiry = no end date (comped / lifetime), never lapses.
    when p_plan_expires_at is not null and p_plan_expires_at <= now() then 'free'
    else coalesce(p_plan_tier, 'free')
  end;
$$;

comment on function public.effective_plan_tier(text, timestamptz) is
  'The plan tier a business is entitled to right now: businesses.plan_tier unless plan_expires_at has passed, in which case free. Use this (never plan_tier alone) wherever access or limits are decided — plan_tier keeps its paid value until the nightly expire-subscriptions job rewrites the row.';

-- ── 2. Authoritative quota assert honours expiry ────────────────────────────
-- Identical to the P5-C definition (20261006000000) except that the limit is
-- selected from the EFFECTIVE tier.
do $$
begin
  if to_regclass('public.invoices') is null
     or to_regclass('public.expenses') is null
     or to_regclass('public.payroll_runs') is null then
    raise notice 'Core tables missing, skipping usage-limit expiry update.';
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
      -- Serialize per-tenant (P5-C): lock the business row before counting so
      -- two concurrent billable inserts cannot both consume the last unit.
      perform 1 from public.businesses where id = p_business_id for update;

      select case public.effective_plan_tier(coalesce(b.plan_tier, 'free'), b.plan_expires_at)
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
    'P5-C authoritative monthly document-quota assertion (uniform + race-safe), now resolved through public.effective_plan_tier() so an expired paid plan is held to Free limits immediately rather than until the nightly expire-subscriptions job runs. Quota denial raises SQLSTATE P0QLT.'$cmt$;
end;
$$;

-- ── 3. Cron metadata access ──────────────────────────────────────────────────
-- Do not read or update cron.job here. Supabase's migration/database role is
-- deliberately not granted access to that pg_cron metadata table (even though
-- cron.schedule/cron.unschedule are exposed as security-definer functions), so
-- touching it makes `supabase db push` fail with SQLSTATE 42501. HTTP cron jobs
-- are repaired by scripts/ci/apply-cron-jobs.sh, which runs through the
-- Management API with the required privileges.

-- ── 4. Back-fill plans that lapsed while the cron was dead ──────────────────
-- Same write the expire-subscriptions function performs. Runs as the migration
-- role (not `authenticated`), and it is a downgrade, so
-- enforce_plan_tier_change() permits it either way.
do $$
declare
  v_count integer;
begin
  with lapsed as (
    update public.businesses
       set plan_tier = 'free',
           plan_expires_at = null,
           plan_updated_at = now()
     where plan_tier <> 'free'
       and plan_expires_at is not null
       and plan_expires_at <= now()
    returning id
  )
  select count(*) into v_count from lapsed;

  raise notice 'Subscription expiry back-fill: % business(es) downgraded to free.', v_count;
end;
$$;

-- ── 5. Run the nightly expiry sweep in SQL, not over HTTP ───────────────────
-- The old `expire-subscriptions-daily` job called the Edge Function through
-- pg_net using a URL baked into a migration, which is how it ended up frozen
-- at 'https://<PROJECT_REF>.supabase.co/...' and silently did nothing for
-- months (pg_net swallows the failure). The sweep itself is three columns on
-- one table — there is nothing in it that needs Deno, a network hop or a
-- shared secret, so it now runs in-database and cannot be broken by a missing
-- deploy-time substitution.
--
-- supabase/functions/expire-subscriptions is kept for manual/ad-hoc runs and
-- stays harmless if invoked: it performs exactly the same update.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron not installed here (local/shadow database) — skipping expiry schedule.';
    return;
  end if;

  -- The function is security-definer; unlike cron.job, it is callable by
  -- the migration role. It returns false when the named job is absent.
  perform cron.unschedule('expire-subscriptions-daily');

  perform cron.schedule(
    'expire-subscriptions-daily',
    '5 0 * * *',  -- 00:05 UTC daily (02:05 CAT) — soon after midnight so a
                  -- term that ends overnight is enforced the same morning.
    $cron$
    update public.businesses
       set plan_tier = 'free',
           plan_expires_at = null,
           plan_updated_at = now()
     where plan_tier <> 'free'
       and plan_expires_at is not null
       and plan_expires_at <= now();
    $cron$
  );
end;
$$;
