-- Ledgr R10 (P-D2): typed quota-denial contract — dedicated SQLSTATE for the
-- ONE authoritative document-quota assertion. 2026-10-01.
--
-- Background authorized by the R09.3 readiness gate (LEDGR_R09_3_READINESS_2026-09-22):
-- quota denial was a generic P0001 with English message text, which is not a
-- deterministic machine-readable contract for the offline sync layer.
--
-- Contract (declared here, exactly once):
--   QUOTA DENIAL  =>  SQLSTATE 'P0QLT'
--   surfaced through PostgREST/Supabase as error.code === 'P0QLT', with the
--   human message unchanged for existing UX, plus DETAIL (plan_limit/used)
--   and a HINT marking it as a policy denial (never a transient failure).
--
-- Enforcement posture: the same function, same sites (post_pos_sale +
-- quick-save RPCs call this single assert), same ordering, same semantics —
-- only the error TYPE changes. Nothing here alters R06 stock, R08 shift/till,
-- usage counting, plan tiers, or any financial authority.

do $$
begin
  if to_regclass('public.journal_entries') is null
     or to_regclass('public.invoices') is null
     or to_regclass('public.expenses') is null
     or to_regclass('public.payroll_runs') is null then
    raise notice 'Core tables missing, skipping the R10 usage-limit function update.';
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
      -- One transaction = one document (invoice / expense / payroll run).
      select case coalesce(b.plan_tier, 'free')
               when 'free' then 50
               when 'starter' then 200
               when 'growth' then 500
               when 'pro' then 2000
               when 'enterprise' then null
               else 50                       -- normalizePlanTier: unknown -> free
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
        -- P-D2: dedicated SQLSTATE 'P0QLT'. The errcode IS the contract;
        -- the message stays human-readable and unchanged for existing UX.
        raise exception 'Monthly transaction limit reached (%). Please upgrade your plan.', v_limit
          using errcode = 'P0QLT',
                detail = format('quota_denial plan_limit=%s documents_used=%s period_start=%s', v_limit, v_usage, v_month_start),
                hint = 'Policy denial (monthly document quota) — not a transient failure. Do not retry without a plan change.';
      end if;
    end;
    $body$;
  $fn$;

  execute $cmt$comment on function public._ledgr_assert_usage_limit(uuid) is
    'R10/P-D2 authoritative monthly document-quota assertion. Declared ONCE here; every metering path (post_pos_sale, save_quick_expense, save_quick_sale) performs this function inside its posting transaction. Quota denial raises dedicated SQLSTATE P0QLT (+ policy DETAIL/HINT), distinguishable from transient/database failures and unrelated application P0001 raises. R09.3 consumes the typed signal; stock/shift policies unchanged.';$cmt$;
end
$$;
