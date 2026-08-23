-- ============================================================================
-- Post-migration verification for the Ledgr AI data layer
-- (20260822000000_ai_data_views.sql)
--
-- HOW TO RUN
-- ----------
-- Paste this whole file into the Supabase SQL Editor and run it. It is
-- READ-ONLY: no DML, no DDL, no side effects. Every section prints a `verdict`
-- column — you are looking for 'PASS' everywhere.
--
-- Sections 1-4 need no parameters. Section 5 (reconciliation) and section 6
-- (tenant isolation) need a business id; set it once here:
--
--     \set business_id '00000000-0000-0000-0000-000000000000'
--
-- The SQL Editor does not support \set, so instead edit the single line marked
-- << SET ME >> in section 5. If you leave it as-is, section 5 picks the
-- business with the most invoices, which is usually what you want.
-- ============================================================================


-- ── 1. Did everything get created? ──────────────────────────────────────────
-- 13 views + 1 function. Anything missing here means the migration did not
-- run to completion.

with expected(name, kind) as (
  values
    ('v_ai_cash_accounts', 'view'), ('v_ai_cash_movements', 'view'),
    ('v_ai_revenue_invoices', 'view'), ('v_ai_expense_docs', 'view'),
    ('v_ai_kpis', 'view'), ('v_ai_monthly_trend', 'view'),
    ('v_ai_overdue_invoices', 'view'), ('v_ai_top_expenses', 'view'),
    ('v_ai_top_customers', 'view'), ('v_ai_customer_concentration', 'view'),
    ('v_ai_upcoming_receivables', 'view'), ('v_ai_upcoming_payables', 'view'),
    ('v_ai_anomalies', 'view'), ('ai_context', 'function')
)
select
  e.name,
  e.kind,
  case
    when e.kind = 'view'
      then case when exists (
        select 1 from pg_views where schemaname = 'public' and viewname = e.name
      ) then 'PASS' else 'FAIL - missing' end
    else case when exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = e.name
    ) then 'PASS' else 'FAIL - missing' end
  end as verdict
from expected e
order by e.kind desc, e.name;


-- ── 2. SECURITY: is every view security_invoker? ────────────────────────────
-- This is the control that stops cross-tenant leakage. A view WITHOUT
-- security_invoker runs as its owner and bypasses RLS entirely — that exact
-- mistake caused a real leak in this codebase (see 20260727000008).
-- Every row must say PASS.

select
  c.relname as view_name,
  coalesce(
    (select option_value
     from pg_options_to_table(c.reloptions)
     where option_name = 'security_invoker'),
    'not set'
  ) as security_invoker,
  case
    when (select option_value
          from pg_options_to_table(c.reloptions)
          where option_name = 'security_invoker') in ('true', 'on')
    then 'PASS'
    else 'FAIL - THIS VIEW BYPASSES RLS'
  end as verdict
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname like 'v\_ai\_%'
order by verdict, c.relname;


-- ── 3. SECURITY: ai_context() hardening ─────────────────────────────────────
-- Must be SECURITY DEFINER (so it can read across the views consistently),
-- must pin search_path (or a caller could shadow `public`), and its body must
-- contain the is_business_member() guard.

select
  p.proname,
  case when p.prosecdef then 'definer' else 'invoker' end as security,
  coalesce(array_to_string(p.proconfig, ', '), 'NONE') as settings,
  case when pg_get_functiondef(p.oid) like '%is_business_member%'
       then 'present' else 'MISSING' end as membership_guard,
  case
    when not p.prosecdef then 'FAIL - not security definer'
    when coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
      then 'FAIL - search_path not pinned'
    when pg_get_functiondef(p.oid) not like '%is_business_member%'
      then 'FAIL - NO TENANT GUARD'
    else 'PASS'
  end as verdict
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ai_context';


-- ── 4. Do the views actually execute? ───────────────────────────────────────
-- A view can be created successfully and still fail at runtime (bad cast,
-- ambiguous column, missing operator). This forces a real scan of each one.
-- Runs as your SQL Editor role, so counts here are ACROSS ALL TENANTS —
-- that is expected; section 6 checks per-user isolation.

do $$
declare
  v    text;
  cnt  bigint;
  bad  int := 0;
begin
  foreach v in array array[
    'v_ai_cash_accounts', 'v_ai_cash_movements', 'v_ai_revenue_invoices',
    'v_ai_expense_docs', 'v_ai_kpis', 'v_ai_monthly_trend',
    'v_ai_overdue_invoices', 'v_ai_top_expenses', 'v_ai_top_customers',
    'v_ai_customer_concentration', 'v_ai_upcoming_receivables',
    'v_ai_upcoming_payables', 'v_ai_anomalies'
  ] loop
    begin
      execute format('select count(*) from public.%I', v) into cnt;
      raise notice 'PASS  %-30s % rows', v, cnt;
    exception when others then
      bad := bad + 1;
      raise notice 'FAIL  %-30s %', v, sqlerrm;
    end;
  end loop;

  if bad = 0 then
    raise notice '--- All 13 views executed cleanly ---';
  else
    raise notice '--- % view(s) FAILED, see above ---', bad;
  end if;
end $$;


-- ── 5. RECONCILIATION: do AI numbers equal the dashboard numbers? ───────────
-- This is the acceptance criterion that matters most. Each row recomputes a
-- figure straight from the base tables using the SAME rules the repositories
-- use, and compares it with what the view reports. Any drift means the
-- assistant would quote a number the user cannot find anywhere else.
--
-- Tolerance is 0.01 to absorb numeric rounding.

with target as (
  -- << SET ME >> replace the subquery with a literal id to pin a business:
  --   select '00000000-0000-0000-0000-000000000000'::uuid as business_id
  select i.business_id
  from public.invoices i
  where i.deleted_at is null
  group by i.business_id
  order by count(*) desc
  limit 1
),
bounds as (
  select
    date_trunc('month', current_date)::date as period_start,
    current_date                            as period_end
),

-- Independent recomputation from the BASE TABLES (not the views)
expected_revenue as (
  select coalesce(sum(coalesce(i.functional_amount, i.total_amount)), 0) as val
  from public.invoices i, target t, bounds b
  where i.business_id = t.business_id
    and i.deleted_at is null
    and i.invoice_type in ('invoice', 'credit_note', 'debit_note')
    and i.status not in ('void', 'draft')
    and i.issue_date between b.period_start and b.period_end
),
expected_expenses as (
  select coalesce(sum(coalesce(e.functional_amount, e.total_amount)), 0) as val
  from public.expenses e, target t, bounds b
  where e.business_id = t.business_id
    and e.deleted_at is null
    and e.status not in ('void', 'draft')
    and e.expense_date between b.period_start and b.period_end
),
expected_cash as (
  -- opening balances + posted/reversed movement on cash equivalents,
  -- mirroring FinancialStatementRepository.getCashPosition
  select
    coalesce((
      select sum(coalesce(a.opening_balance, 0))
      from public.accounts a, target t
      where a.business_id = t.business_id
        and a.deleted_at is null
        and (a.is_bank_account or a.code in ('1110','1115','1125','1126'))
    ), 0)
    + coalesce((
      select sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)
      from public.journal_lines jl
      join public.journal_entries je
        on je.id = jl.journal_entry_id and je.business_id = jl.business_id
      join public.accounts a
        on a.id = jl.account_id and a.business_id = jl.business_id
      , target t
      where jl.business_id = t.business_id
        and je.status in ('posted', 'reversed')
        and je.entry_date <= current_date
        and a.deleted_at is null
        and (a.is_bank_account or a.code in ('1110','1115','1125','1126'))
    ), 0) as val
),
expected_receivables as (
  select coalesce(sum(greatest(coalesce(
    i.amount_due * coalesce(i.exchange_rate, 1),
    coalesce(i.functional_amount, i.total_amount) - (i.amount_paid * coalesce(i.exchange_rate, 1))
  ), 0)), 0) as val
  from public.invoices i, target t
  where i.business_id = t.business_id
    and i.deleted_at is null
    and i.invoice_type in ('invoice', 'credit_note', 'debit_note')
    and i.status not in ('void', 'draft')
),
actual as (
  select k.* from public.v_ai_kpis k, target t where k.business_id = t.business_id
),
checks(metric, expected, actual) as (
  select 'revenue_mtd',       (select val from expected_revenue),     (select revenue_mtd       from actual)
  union all
  select 'expenses_mtd',      (select val from expected_expenses),    (select expenses_mtd      from actual)
  union all
  select 'cash_balance',      (select val from expected_cash),        (select cash_balance      from actual)
  union all
  select 'receivables_total', (select val from expected_receivables), (select receivables_total from actual)
)
select
  (select business_id from target) as business_id,
  metric,
  round(coalesce(expected, 0), 2) as expected_from_base_tables,
  round(coalesce(actual, 0), 2)   as actual_from_v_ai_kpis,
  round(coalesce(actual, 0) - coalesce(expected, 0), 2) as difference,
  case
    when abs(coalesce(actual, 0) - coalesce(expected, 0)) <= 0.01 then 'PASS'
    else 'FAIL - investigate before trusting the assistant'
  end as verdict
from checks;


-- ── 5b. Internal consistency of the trend + KPI views ───────────────────────
-- The last month of v_ai_monthly_trend.cumulative_cash must equal
-- v_ai_kpis.cash_balance. If these disagree, the forecast starts from a
-- different balance than the one shown on the dashboard.

with target as (
  select i.business_id
  from public.invoices i
  where i.deleted_at is null
  group by i.business_id
  order by count(*) desc
  limit 1
),
last_month as (
  select t.cumulative_cash
  from public.v_ai_monthly_trend t, target tg
  where t.business_id = tg.business_id
  order by t.month_start desc
  limit 1
)
select
  round((select cumulative_cash from last_month), 2) as trend_closing_cash,
  round((select k.cash_balance from public.v_ai_kpis k, target tg
         where k.business_id = tg.business_id), 2)   as kpi_cash_balance,
  case
    when abs(
      coalesce((select cumulative_cash from last_month), 0)
      - coalesce((select k.cash_balance from public.v_ai_kpis k, target tg
                  where k.business_id = tg.business_id), 0)
    ) <= 0.01 then 'PASS'
    else 'FAIL - trend and KPI cash disagree'
  end as verdict;


-- ── 5c. No NaN / Infinity anywhere in the KPI surface ───────────────────────
-- The assistant must never render "MK NaN". Numeric columns cannot literally
-- hold NaN in Postgres unless a division produced it, but a null where the
-- client expects a number is the same class of bug — this lists any business
-- whose KPI row has unexpected nulls.

select
  business_id,
  case
    when revenue_mtd is null or expenses_mtd is null or cash_balance is null
      or receivables_total is null or overdue_total is null
      or payables_total is null or open_invoice_count is null
    then 'FAIL - unexpected null in a non-nullable KPI'
    else 'PASS'
  end as verdict,
  revenue_mtd, expenses_mtd, cash_balance, receivables_total,
  overdue_total, payables_total, open_invoice_count,
  -- these three are intentionally nullable (undefined when revenue = 0)
  profit_margin_pct, expense_ratio_pct, avg_days_to_pay
from public.v_ai_kpis
order by verdict, business_id
limit 50;


-- ── 6. TENANT ISOLATION (the security acceptance criterion) ─────────────────
-- Proves that a signed-in user cannot read another business through the new
-- surface. It impersonates the `authenticated` role with a fake JWT claim for
-- a real user, then tries to read a business they do NOT belong to.
--
-- Everything runs inside a transaction that is ROLLED BACK, so it changes
-- nothing. If `ai_context` returns data for the foreign business, the test
-- raises — that is the outcome you must never see.

do $$
declare
  v_user_id     uuid;
  v_own_biz     uuid;
  v_foreign_biz uuid;
  v_rows        bigint;
  v_json        jsonb;
begin
  -- a user who is an active member of exactly one business
  select bu.user_id, bu.business_id
  into v_user_id, v_own_biz
  from public.business_users bu
  where bu.is_active
  limit 1;

  if v_user_id is null then
    raise notice 'SKIP  no active business_users rows to test with';
    return;
  end if;

  -- a business that user is NOT a member of
  select b.id into v_foreign_biz
  from public.businesses b
  where b.deleted_at is null
    and not exists (
      select 1 from public.business_users bu
      where bu.business_id = b.id and bu.user_id = v_user_id and bu.is_active
    )
  limit 1;

  if v_foreign_biz is null then
    raise notice 'SKIP  only one business exists — cannot test cross-tenant access';
    return;
  end if;

  raise notice 'Testing as user % (member of %), probing foreign business %',
    v_user_id, v_own_biz, v_foreign_biz;

  -- Impersonate the end user
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);

  -- 6a. The views must return ZERO foreign rows
  execute 'select count(*) from public.v_ai_kpis where business_id = $1'
    into v_rows using v_foreign_biz;
  if v_rows = 0 then
    raise notice 'PASS  v_ai_kpis leaks no foreign rows';
  else
    raise exception 'FAIL  v_ai_kpis returned % row(s) for a foreign business', v_rows;
  end if;

  execute 'select count(*) from public.v_ai_revenue_invoices where business_id = $1'
    into v_rows using v_foreign_biz;
  if v_rows = 0 then
    raise notice 'PASS  v_ai_revenue_invoices leaks no foreign rows';
  else
    raise exception 'FAIL  v_ai_revenue_invoices returned % foreign row(s)', v_rows;
  end if;

  -- 6b. ai_context() must REFUSE outright
  begin
    select public.ai_context(v_foreign_biz) into v_json;
    raise exception 'FAIL  ai_context() returned data for a foreign business!';
  exception
    when insufficient_privilege then
      raise notice 'PASS  ai_context() refused the foreign business (42501)';
    when others then
      if sqlstate = 'P0001' and sqlerrm like '%not authorised%' then
        raise notice 'PASS  ai_context() refused the foreign business';
      else
        raise;
      end if;
  end;

  -- 6c. ...and must SUCCEED for the user's own business
  select public.ai_context(v_own_biz) into v_json;
  if v_json ? 'kpis' and v_json ? 'monthlyTrend' then
    raise notice 'PASS  ai_context() returned a well-formed payload for the own business';
    raise notice '      keys: %', (select string_agg(k, ', ' order by k)
                                   from jsonb_object_keys(v_json) k);
  else
    raise exception 'FAIL  ai_context() payload is malformed: %', left(v_json::text, 200);
  end if;

  perform set_config('role', 'postgres', true);
  raise notice '--- Tenant isolation checks complete ---';
end $$;


-- ── 7. Shape check: does ai_context() match what the client expects? ────────
-- src/lib/ai/context.ts narrows exactly these keys. A missing key degrades the
-- assistant silently (it just stops mentioning that data), so check them here.

with payload as (
  select public.ai_context((
    select i.business_id from public.invoices i
    where i.deleted_at is null
    group by i.business_id order by count(*) desc limit 1
  )) as j
),
expected(key) as (
  values ('generated_at'), ('company'), ('kpis'), ('monthlyTrend'),
         ('overdueInvoices'), ('topExpenses'), ('topCustomers'),
         ('concentration'), ('anomalies'), ('upcomingReceivables'),
         ('upcomingPayables')
)
select
  e.key,
  case when (select j from payload) ? e.key then 'present' else 'MISSING' end as status,
  jsonb_typeof((select j from payload) -> e.key) as json_type,
  case when (select j from payload) ? e.key then 'PASS' else 'FAIL' end as verdict
from expected e
order by verdict, e.key;
