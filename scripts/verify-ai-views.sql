-- ============================================================================
-- Post-migration verification for the Ledgr AI data layer
--   20260822000000_ai_data_views.sql
--   20260823000000_fix_ai_kpis_tenant_scope.sql
--   20260823000001_fix_ai_context_kpis_null.sql
--
-- HOW TO RUN
-- ----------
-- Select the WHOLE file and run it in the Supabase SQL Editor. It prints ONE
-- result grid containing every check.
--
-- Read the `verdict` column: you want PASS everywhere. Anything starting FAIL
-- is a real problem; INFO rows are context, SKIP rows could not be evaluated
-- on this dataset.
--
-- WHY IT IS SHAPED LIKE THIS
--   The editor renders one grid per run — the LAST statement's. An earlier
--   version of this file had nine separate statements plus two DO blocks that
--   reported via RAISE NOTICE (which goes to the Messages pane, not the grid),
--   so only the final section was ever visible. Everything now writes into a
--   session-local temp table and the file ends with a single SELECT.
--
-- SAFETY
--   Read-only with respect to your data: no INSERT/UPDATE/DELETE, no schema
--   changes. The only object created is a TEMP table that Postgres drops when
--   the session ends. Section 6 impersonates a real user via a session-local
--   request.jwt.claims and always resets it, including on error.
-- ============================================================================

drop table if exists _ai_verify;
create temp table _ai_verify (
  seq        serial,
  section    text,
  check_name text,
  detail     text,
  verdict    text
);

do $$
declare
  -- shared
  v_name      text;
  v_cnt       bigint;
  v_biz       uuid;
  v_json      jsonb;
  v_txt       text;

  -- reconciliation
  r_expected  numeric;
  r_actual    numeric;

  -- isolation
  v_user_id     uuid;
  v_own_biz     uuid;
  v_foreign_biz uuid;
  v_leaks       int := 0;

  c_views constant text[] := array[
    'v_ai_cash_accounts', 'v_ai_cash_movements', 'v_ai_revenue_invoices',
    'v_ai_expense_docs', 'v_ai_kpis', 'v_ai_monthly_trend',
    'v_ai_overdue_invoices', 'v_ai_top_expenses', 'v_ai_top_customers',
    'v_ai_customer_concentration', 'v_ai_upcoming_receivables',
    'v_ai_upcoming_payables', 'v_ai_anomalies'
  ];
begin

-- ── 1. Objects exist ────────────────────────────────────────────────────────
foreach v_name in array c_views loop
  insert into _ai_verify(section, check_name, detail, verdict)
  select '1. exists', v_name,
         case when found_it then 'view present' else 'NOT FOUND' end,
         case when found_it then 'PASS' else 'FAIL - migration did not complete' end
  from (select exists (
          select 1 from pg_views where schemaname = 'public' and viewname = v_name
        ) as found_it) s;
end loop;

insert into _ai_verify(section, check_name, detail, verdict)
select '1. exists', 'ai_context(uuid)',
       case when e then 'function present' else 'NOT FOUND' end,
       case when e then 'PASS' else 'FAIL - migration did not complete' end
from (select exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'ai_context') as e) s;


-- ── 2. Every view is security_invoker ───────────────────────────────────────
-- The control that stops cross-tenant leakage. A view without it runs as its
-- owner and bypasses RLS entirely (that mistake caused a real leak here — see
-- migration 20260727000008).
insert into _ai_verify(section, check_name, detail, verdict)
select
  '2. security_invoker',
  c.relname,
  coalesce((select option_value from pg_options_to_table(c.reloptions)
            where option_name = 'security_invoker'), 'NOT SET'),
  case when (select option_value from pg_options_to_table(c.reloptions)
             where option_name = 'security_invoker') in ('true','on')
       then 'PASS' else 'FAIL - THIS VIEW BYPASSES RLS' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v' and c.relname like 'v\_ai\_%';


-- ── 3. ai_context() hardening ───────────────────────────────────────────────
insert into _ai_verify(section, check_name, detail, verdict)
select
  '3. ai_context hardening',
  'definer + search_path + guard',
  format('security=%s, settings=%s, guard=%s',
         case when p.prosecdef then 'definer' else 'invoker' end,
         coalesce(array_to_string(p.proconfig, ','), 'NONE'),
         case when pg_get_functiondef(p.oid) like '%is_business_member%'
              then 'present' else 'MISSING' end),
  case
    when not p.prosecdef then 'FAIL - not security definer'
    when coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
      then 'FAIL - search_path not pinned'
    when pg_get_functiondef(p.oid) not like '%is_business_member%'
      then 'FAIL - NO TENANT GUARD'
    else 'PASS'
  end
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'ai_context';

-- The tenant predicate added by 20260823000000 must still be in both views,
-- and must be the service-role-aware form from 20260823000001.
foreach v_name in array array['v_ai_kpis','v_ai_monthly_trend'] loop
  begin
    v_txt := pg_get_viewdef(format('public.%I', v_name)::regclass, true);
    insert into _ai_verify(section, check_name, detail, verdict)
    values (
      '3. ai_context hardening',
      v_name || ' tenant predicate',
      case
        when v_txt like '%is_business_member%' and v_txt like '%auth.uid() IS NULL%'
          then 'membership-scoped, service-role aware'
        when v_txt like '%is_business_member%'
          then 'membership-scoped but NOT service-role aware'
        else 'absent'
      end,
      case
        when v_txt like '%is_business_member%' and v_txt like '%auth.uid() IS NULL%' then 'PASS'
        when v_txt like '%is_business_member%'
          then 'FAIL - apply 20260823000001 (service-role reads return nothing)'
        else 'FAIL - apply 20260823000000 (cross-tenant leak)'
      end
    );
  exception when others then
    insert into _ai_verify(section, check_name, detail, verdict)
    values ('3. ai_context hardening', v_name, sqlerrm, 'FAIL - could not read viewdef');
  end;
end loop;


-- ── 4. Every view actually executes ─────────────────────────────────────────
-- A view can be created successfully and still fail at runtime (bad cast,
-- ambiguous column). Counts are across all tenants for this role — expected;
-- section 6 covers per-user isolation.
foreach v_name in array c_views loop
  begin
    execute format('select count(*) from public.%I', v_name) into v_cnt;
    insert into _ai_verify(section, check_name, detail, verdict)
    values ('4. executes', v_name, v_cnt || ' rows', 'PASS');
  exception when others then
    insert into _ai_verify(section, check_name, detail, verdict)
    values ('4. executes', v_name, sqlerrm, 'FAIL - view errors at runtime');
  end;
end loop;


-- ── 5. RECONCILIATION — do AI numbers equal the source-of-truth numbers? ────
-- The acceptance criterion that matters most. Each figure is recomputed from
-- the BASE TABLES using the same rules the repositories use, then compared
-- with what v_ai_kpis reports. Drift here means the assistant would quote a
-- number the user cannot find on any other screen.
--
-- << SET ME >> to pin a business; otherwise the busiest one is used.
select i.business_id into v_biz
from public.invoices i
where i.deleted_at is null
group by i.business_id
order by count(*) desc
limit 1;

if v_biz is null then
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('5. reconciliation', 'business selection', 'no invoices in any business', 'SKIP');
else
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('5. reconciliation', 'business under test', v_biz::text, 'INFO');

  -- revenue MTD
  select coalesce(sum(coalesce(i.functional_amount, i.total_amount)),0) into r_expected
  from public.invoices i
  where i.business_id = v_biz and i.deleted_at is null
    and i.invoice_type in ('invoice','credit_note','debit_note')
    and i.status not in ('void','draft')
    and i.issue_date between date_trunc('month', current_date)::date and current_date;
  select revenue_mtd into r_actual from public.v_ai_kpis where business_id = v_biz;
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('5. reconciliation', 'revenue_mtd',
          format('base=%s  view=%s  diff=%s',
                 round(r_expected,2), round(coalesce(r_actual,0),2),
                 round(coalesce(r_actual,0)-r_expected,2)),
          case when abs(coalesce(r_actual,0)-r_expected) <= 0.01
               then 'PASS' else 'FAIL - does not match the base tables' end);

  -- expenses MTD
  select coalesce(sum(coalesce(e.functional_amount, e.total_amount)),0) into r_expected
  from public.expenses e
  where e.business_id = v_biz and e.deleted_at is null
    and e.status not in ('void','draft')
    and e.expense_date between date_trunc('month', current_date)::date and current_date;
  select expenses_mtd into r_actual from public.v_ai_kpis where business_id = v_biz;
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('5. reconciliation', 'expenses_mtd',
          format('base=%s  view=%s  diff=%s',
                 round(r_expected,2), round(coalesce(r_actual,0),2),
                 round(coalesce(r_actual,0)-r_expected,2)),
          case when abs(coalesce(r_actual,0)-r_expected) <= 0.01
               then 'PASS' else 'FAIL - does not match the base tables' end);

  -- cash balance (mirrors FinancialStatementRepository.getCashPosition)
  select
    coalesce((select sum(coalesce(a.opening_balance,0))
              from public.accounts a
              where a.business_id = v_biz and a.deleted_at is null
                and (a.is_bank_account or a.code in ('1110','1115','1125','1126'))),0)
  + coalesce((select sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)
              from public.journal_lines jl
              join public.journal_entries je
                on je.id = jl.journal_entry_id and je.business_id = jl.business_id
              join public.accounts a
                on a.id = jl.account_id and a.business_id = jl.business_id
              where jl.business_id = v_biz
                and je.status in ('posted','reversed')
                and je.entry_date <= current_date
                and a.deleted_at is null
                and (a.is_bank_account or a.code in ('1110','1115','1125','1126'))),0)
  into r_expected;
  select cash_balance into r_actual from public.v_ai_kpis where business_id = v_biz;
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('5. reconciliation', 'cash_balance',
          format('base=%s  view=%s  diff=%s',
                 round(r_expected,2), round(coalesce(r_actual,0),2),
                 round(coalesce(r_actual,0)-r_expected,2)),
          case when abs(coalesce(r_actual,0)-r_expected) <= 0.01
               then 'PASS' else 'FAIL - does not match getCashPosition' end);

  -- receivables
  select coalesce(sum(greatest(coalesce(
           i.amount_due * coalesce(i.exchange_rate,1),
           coalesce(i.functional_amount, i.total_amount) - (i.amount_paid * coalesce(i.exchange_rate,1))
         ),0)),0) into r_expected
  from public.invoices i
  where i.business_id = v_biz and i.deleted_at is null
    and i.invoice_type in ('invoice','credit_note','debit_note')
    and i.status not in ('void','draft');
  select receivables_total into r_actual from public.v_ai_kpis where business_id = v_biz;
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('5. reconciliation', 'receivables_total',
          format('base=%s  view=%s  diff=%s',
                 round(r_expected,2), round(coalesce(r_actual,0),2),
                 round(coalesce(r_actual,0)-r_expected,2)),
          case when abs(coalesce(r_actual,0)-r_expected) <= 0.01
               then 'PASS' else 'FAIL - does not match the base tables' end);

  -- trend closing cash must equal KPI cash (the forecast's starting balance)
  select cumulative_cash into r_expected
  from public.v_ai_monthly_trend where business_id = v_biz
  order by month_start desc limit 1;
  select cash_balance into r_actual from public.v_ai_kpis where business_id = v_biz;
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('5. reconciliation', 'trend closing cash = kpi cash',
          format('trend=%s  kpi=%s  diff=%s',
                 round(coalesce(r_expected,0),2), round(coalesce(r_actual,0),2),
                 round(coalesce(r_actual,0)-coalesce(r_expected,0),2)),
          case when abs(coalesce(r_actual,0)-coalesce(r_expected,0)) <= 0.01
               then 'PASS' else 'FAIL - forecast would start from the wrong balance' end);

  -- no unexpected nulls (the client would render these as "MK NaN")
  insert into _ai_verify(section, check_name, detail, verdict)
  select '5. reconciliation', 'no nulls in non-nullable KPIs',
         'nullable-by-design: profit_margin_pct, expense_ratio_pct, avg_days_to_pay',
         case when k.revenue_mtd is null or k.expenses_mtd is null
                or k.cash_balance is null or k.receivables_total is null
                or k.overdue_total is null or k.payables_total is null
                or k.open_invoice_count is null
              then 'FAIL - unexpected null' else 'PASS' end
  from public.v_ai_kpis k where k.business_id = v_biz;
end if;


-- ── 6. TENANT ISOLATION ─────────────────────────────────────────────────────
-- Impersonates a real end user and proves they cannot read another business
-- through the new surface. Always resets the impersonation, including on error
-- (a leaked request.jwt.claims made section 7 fail on an earlier run).
select bu.user_id, bu.business_id into v_user_id, v_own_biz
from public.business_users bu where bu.is_active limit 1;

select b.id into v_foreign_biz
from public.businesses b
where b.deleted_at is null
  and not exists (select 1 from public.business_users bu
                  where bu.business_id = b.id and bu.user_id = v_user_id and bu.is_active)
limit 1;

if v_user_id is null then
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('6. tenant isolation', 'setup', 'no active business_users rows', 'SKIP');
elsif v_foreign_biz is null then
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('6. tenant isolation', 'setup',
          'only one business exists — cross-tenant access cannot be tested', 'SKIP');
else
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('6. tenant isolation', 'setup',
          format('as user %s, own=%s, probing foreign=%s', v_user_id, v_own_biz, v_foreign_biz),
          'INFO');

  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);

    -- 6a. no view may return a foreign row
    foreach v_name in array c_views loop
      begin
        execute format('select count(*) from public.%I where business_id = $1', v_name)
          into v_cnt using v_foreign_biz;
        if v_cnt > 0 then v_leaks := v_leaks + 1; end if;
        insert into _ai_verify(section, check_name, detail, verdict)
        values ('6. tenant isolation', v_name,
                v_cnt || ' foreign rows',
                case when v_cnt = 0 then 'PASS' else 'FAIL - LEAKS ACROSS TENANTS' end);
      exception when others then
        insert into _ai_verify(section, check_name, detail, verdict)
        values ('6. tenant isolation', v_name, sqlerrm, 'FAIL - errored while probing');
      end;
    end loop;

    -- 6b. ai_context() must refuse the foreign business
    begin
      v_json := public.ai_context(v_foreign_biz);
      insert into _ai_verify(section, check_name, detail, verdict)
      values ('6. tenant isolation', 'ai_context(foreign)',
              'returned ' || left(v_json::text, 60), 'FAIL - RETURNED DATA');
    exception when others then
      insert into _ai_verify(section, check_name, detail, verdict)
      values ('6. tenant isolation', 'ai_context(foreign)',
              format('refused: %s (%s)', sqlerrm, sqlstate),
              case when sqlstate = '42501' or sqlerrm like '%not authorised%'
                   then 'PASS' else 'FAIL - wrong error' end);
    end;

    -- 6c. ...and must succeed for the user's own business
    begin
      v_json := public.ai_context(v_own_biz);
      insert into _ai_verify(section, check_name, detail, verdict)
      values ('6. tenant isolation', 'ai_context(own)',
              format('kpis=%s, trend=%s',
                     jsonb_typeof(v_json->'kpis'), jsonb_typeof(v_json->'monthlyTrend')),
              case when jsonb_typeof(v_json->'kpis') = 'object'
                    and jsonb_typeof(v_json->'monthlyTrend') = 'array'
                   then 'PASS' else 'FAIL - payload malformed for own business' end);
    exception when others then
      insert into _ai_verify(section, check_name, detail, verdict)
      values ('6. tenant isolation', 'ai_context(own)', sqlerrm,
              'FAIL - refused the user''s OWN business');
    end;

    -- 6d. own business must remain visible (guards over-tightening)
    execute 'select count(*) from public.v_ai_kpis where business_id = $1'
      into v_cnt using v_own_biz;
    insert into _ai_verify(section, check_name, detail, verdict)
    values ('6. tenant isolation', 'own business visible',
            v_cnt || ' row(s), expected 1',
            case when v_cnt = 1 then 'PASS'
                 else 'FAIL - legitimate user cannot see their own data' end);

    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '{}', true);
  exception when others then
    -- never leave the session impersonating
    perform set_config('role', 'postgres', true);
    perform set_config('request.jwt.claims', '{}', true);
    insert into _ai_verify(section, check_name, detail, verdict)
    values ('6. tenant isolation', 'aborted', sqlerrm, 'FAIL');
  end;
end if;


-- ── 7. ai_context() payload shape ───────────────────────────────────────────
-- src/lib/ai/context.ts narrows exactly these keys. Asserts the TYPE, not just
-- presence: `kpis` was once present-but-JSON-null and a presence-only test
-- reported PASS (fixed in 20260823000001).
if v_biz is not null then
  begin
    v_json := public.ai_context(v_biz);
    insert into _ai_verify(section, check_name, detail, verdict)
    select '7. payload shape', k.key,
           coalesce(jsonb_typeof(v_json -> k.key), 'ABSENT'),
           case
             when not (v_json ? k.key) then 'FAIL - key missing'
             when jsonb_typeof(v_json -> k.key) = 'null' then 'FAIL - present but JSON null'
             when k.want = 'array'  and jsonb_typeof(v_json -> k.key) <> 'array'
               then 'FAIL - expected array'
             when k.want = 'object' and jsonb_typeof(v_json -> k.key) <> 'object'
               then 'FAIL - expected object'
             else 'PASS'
           end
    from (values
      ('generated_at','string'), ('company','object'), ('kpis','object'),
      ('monthlyTrend','array'), ('overdueInvoices','array'), ('topExpenses','array'),
      ('topCustomers','array'), ('concentration','any'), ('anomalies','array'),
      ('upcomingReceivables','array'), ('upcomingPayables','array')
    ) as k(key, want);
  exception when others then
    insert into _ai_verify(section, check_name, detail, verdict)
    values ('7. payload shape', 'ai_context()', sqlerrm, 'FAIL - call failed');
  end;
end if;


-- ── 8. Service-role path ────────────────────────────────────────────────────
-- The regression fixed in 20260823000001 was invisible to a browser session
-- (which carries a JWT) and broke only service-role callers — i.e. the
-- `ai-chat` Edge Function. This editor session has no JWT, so it exercises
-- exactly that path.
insert into _ai_verify(section, check_name, detail, verdict)
select '8. service-role path', 'auth.uid()',
       coalesce(auth.uid()::text, 'NULL (service-role, as expected here)'),
       'INFO';

if auth.uid() is null then
  select count(*) into v_cnt from public.v_ai_kpis;
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('8. service-role path', 'v_ai_kpis visible without a JWT',
          v_cnt || ' rows',
          case when v_cnt > 0 then 'PASS'
               else 'FAIL - tenant predicate filters out service-role reads (apply 20260823000001)' end);

  select count(*) into v_cnt from public.v_ai_monthly_trend;
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('8. service-role path', 'v_ai_monthly_trend visible without a JWT',
          v_cnt || ' rows',
          case when v_cnt > 0 then 'PASS'
               else 'FAIL - tenant predicate filters out service-role reads' end);
else
  insert into _ai_verify(section, check_name, detail, verdict)
  values ('8. service-role path', 'skipped',
          'session carries a JWT, so the service-role path is not exercised', 'SKIP');
end if;

end $$;


-- ── THE ONE GRID ────────────────────────────────────────────────────────────
-- Failures first, then everything else in section order.
select
  section,
  check_name,
  detail,
  verdict
from _ai_verify
order by
  case when verdict like 'FAIL%' then 0 else 1 end,
  section,
  seq;
