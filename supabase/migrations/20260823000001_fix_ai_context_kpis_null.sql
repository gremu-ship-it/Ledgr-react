-- ============================================================================
-- FIX: ai_context() returned "kpis": null for service-role callers.
--
-- FOUND BY
--   scripts/verify-ai-views.sql § 7 — the shape check reported every key
--   'present', but `kpis` came back with json_type = null while every sibling
--   was an array or object. The verdict column said PASS because it only
--   tested key PRESENCE (`? e.key`), not that the value was populated. Two
--   bugs, one symptom.
--
-- THE BUG (a regression from 20260823000000)
--   That migration added `public.is_business_member(b.id)` to v_ai_kpis and
--   v_ai_monthly_trend to close a real cross-tenant leak. is_business_member()
--   resolves membership via auth.uid():
--
--       where bu.user_id = auth.uid() and bu.is_active
--
--   ai_context() is SECURITY DEFINER, but SECURITY DEFINER changes the
--   effective *user* for privilege checks — it does NOT synthesise a JWT.
--   auth.uid() reads request.jwt.claims, which is a SESSION setting: under a
--   service-role connection (the `ai-chat` Edge Function, a cron job, the SQL
--   Editor) there is no JWT, so auth.uid() is NULL, is_business_member()
--   returns false, and the new predicate filters out EVERY row.
--
--   The note I wrote in 20260823000000 ("the function owner is the one
--   evaluating these predicates") was simply wrong: DEFINER swaps the role,
--   not the JWT.
--
--   Result: for any service-role caller, v_ai_kpis and v_ai_monthly_trend are
--   empty. ai_context() wraps monthlyTrend in coalesce(..., '[]') so that one
--   degraded silently to an empty array, but `kpis` had no coalesce, so the
--   scalar subquery yielded SQL NULL → "kpis": null.
--
--   Impact: src/lib/ai/context.ts does `asRecord(root.kpis)` → null → every
--   downstream branch takes its "no data" path. The assistant would tell an
--   Edge-Function user "I could not find any posted activity yet" for a fully
--   populated company. The forecast would start from a zero cash balance.
--   Direct browser (authenticated) callers were unaffected — they have a JWT.
--
-- THE FIX
--   Keep the tenant predicate, but make it satisfiable by BOTH caller shapes:
--
--       and (auth.uid() is null or public.is_business_member(b.id))
--
--   This mirrors the guard already inside ai_context() itself:
--
--       if auth.uid() is not null and not is_business_member(...) then raise
--
--   • End user (auth.uid() present)  → membership is enforced, exactly as
--     20260823000000 intended. The cross-tenant leak stays closed.
--   • Service role (auth.uid() NULL) → the view returns all businesses, and
--     the CALLER is responsible for scoping. ai_context() already is: it takes
--     p_business_id and every subquery filters `where business_id = p_business_id`.
--     supabase/functions/ai-chat/index.ts derives that id from business_users
--     for the verified JWT before calling, and never trusts the client's hint.
--
--   Belt and braces, `kpis` also gets a coalesce to '{}'::jsonb so a missing
--   row can never again present as JSON null to the client.
--
-- Idempotent. Read-only: no DML, no accounting logic changed.
-- ============================================================================


-- ── 1. v_ai_kpis — tenant predicate, service-role aware ─────────────────────
-- Body identical to 20260823000000 except the marked line.

drop view if exists public.v_ai_kpis cascade;
create view public.v_ai_kpis with (security_invoker = true) as
with
  bounds as (
    select
      date_trunc('month', current_date)::date                              as period_start,
      (date_trunc('month', current_date) + interval '1 month - 1 day')::date as period_end
  ),
  rev as (
    select r.business_id, sum(r.amount_base) as revenue
    from public.v_ai_revenue_invoices r, bounds b
    where r.issue_date between b.period_start and current_date
    group by r.business_id
  ),
  exp as (
    select e.business_id, sum(e.amount_base) as expenses
    from public.v_ai_expense_docs e, bounds b
    where e.expense_date between b.period_start and current_date
    group by e.business_id
  ),
  ar as (
    select
      r.business_id,
      sum(r.amount_outstanding)                                                          as receivables_total,
      sum(case when r.due_date is not null and r.due_date < current_date
               then r.amount_outstanding else 0 end)                                     as overdue_total,
      count(*) filter (where r.amount_outstanding > 0)                                    as open_invoice_count
    from public.v_ai_revenue_invoices r
    where r.amount_outstanding > 0
    group by r.business_id
  ),
  ap as (
    select e.business_id, sum(e.amount_outstanding) as payables_total
    from public.v_ai_expense_docs e
    where e.amount_outstanding > 0
    group by e.business_id
  ),
  cash_opening as (
    select business_id, sum(opening_balance) as opening_balance
    from public.v_ai_cash_accounts
    group by business_id
  ),
  cash_movement as (
    select business_id, sum(net_cash) as movement
    from public.v_ai_cash_movements
    where entry_date <= current_date
    group by business_id
  ),
  paid as (
    select
      ip.business_id,
      avg((ip.payment_date - i.issue_date))::numeric as avg_days_to_pay
    from public.invoice_payments ip
    join public.invoices i
      on i.id = ip.invoice_id
     and i.business_id = ip.business_id
    where ip.payment_date >= current_date - interval '180 days'
      and i.deleted_at is null
      and ip.payment_date >= i.issue_date
    group by ip.business_id
  )
select
  b.id                                                        as business_id,
  bo.period_start,
  bo.period_end,
  round(coalesce(rev.revenue, 0), 2)                          as revenue_mtd,
  round(coalesce(exp.expenses, 0), 2)                         as expenses_mtd,
  round(coalesce(rev.revenue, 0) - coalesce(exp.expenses, 0), 2) as net_profit_mtd,
  case when coalesce(rev.revenue, 0) > 0
       then round(((coalesce(rev.revenue, 0) - coalesce(exp.expenses, 0)) / rev.revenue) * 100, 2)
       else null end                                          as profit_margin_pct,
  round(coalesce(co.opening_balance, 0) + coalesce(cm.movement, 0), 2) as cash_balance,
  round(coalesce(ar.receivables_total, 0), 2)                 as receivables_total,
  round(coalesce(ar.overdue_total, 0), 2)                     as overdue_total,
  coalesce(ar.open_invoice_count, 0)                          as open_invoice_count,
  round(coalesce(ap.payables_total, 0), 2)                    as payables_total,
  case when paid.avg_days_to_pay is null then null
       else round(paid.avg_days_to_pay, 1) end                as avg_days_to_pay,
  case when coalesce(rev.revenue, 0) > 0
       then round((coalesce(exp.expenses, 0) / rev.revenue) * 100, 2)
       else null end                                          as expense_ratio_pct
from public.businesses b
cross join bounds bo
left join rev on rev.business_id = b.id
left join exp on exp.business_id = b.id
left join ar  on ar.business_id  = b.id
left join ap  on ap.business_id  = b.id
left join cash_opening co on co.business_id = b.id
left join cash_movement cm on cm.business_id = b.id
left join paid on paid.business_id = b.id
where b.deleted_at is null
  -- << TENANT FIX, service-role aware. See header.
  and (auth.uid() is null or public.is_business_member(b.id));

comment on view public.v_ai_kpis is
  'Month-to-date KPIs per business: revenue, expenses, net profit, margin, cash balance, receivables/overdue, payables, average days to pay, expense ratio. All amounts MWK and reconciled with the dashboard queries. Membership-scoped for JWT callers; unscoped for service-role callers, which must filter by business_id themselves (ai_context does).';


-- ── 2. v_ai_monthly_trend — same treatment ──────────────────────────────────

drop view if exists public.v_ai_monthly_trend cascade;
create view public.v_ai_monthly_trend with (security_invoker = true) as
with
  window_start as (
    select (date_trunc('month', current_date) - interval '11 months')::date as first_month
  ),
  months as (
    select b.id as business_id, gs::date as month
    from public.businesses b
    cross join window_start ws
    cross join lateral generate_series(
      ws.first_month,
      date_trunc('month', current_date)::date,
      interval '1 month'
    ) gs
    where b.deleted_at is null
      -- << TENANT FIX, service-role aware. See header.
      and (auth.uid() is null or public.is_business_member(b.id))
  ),
  rev as (
    select r.business_id, date_trunc('month', r.issue_date)::date as month, sum(r.amount_base) as revenue
    from public.v_ai_revenue_invoices r, window_start ws
    where r.issue_date >= ws.first_month
    group by 1, 2
  ),
  exp as (
    select e.business_id, date_trunc('month', e.expense_date)::date as month, sum(e.amount_base) as expenses
    from public.v_ai_expense_docs e, window_start ws
    where e.expense_date >= ws.first_month
    group by 1, 2
  ),
  cash as (
    select
      m.business_id,
      m.month,
      sum(case when m.net_cash > 0 then  m.net_cash else 0 end) as cash_in,
      sum(case when m.net_cash < 0 then -m.net_cash else 0 end) as cash_out
    from public.v_ai_cash_movements m, window_start ws
    where m.entry_date >= ws.first_month
    group by 1, 2
  ),
  opening as (
    select business_id, sum(opening_balance) as opening_balance
    from public.v_ai_cash_accounts
    group by business_id
  ),
  brought_forward as (
    select m.business_id, sum(m.net_cash) as movement
    from public.v_ai_cash_movements m, window_start ws
    where m.entry_date < ws.first_month
    group by 1
  )
select
  mo.business_id,
  to_char(mo.month, 'YYYY-MM')                                as month,
  mo.month                                                    as month_start,
  round(coalesce(rev.revenue, 0), 2)                          as revenue,
  round(coalesce(exp.expenses, 0), 2)                         as expenses,
  round(coalesce(rev.revenue, 0) - coalesce(exp.expenses, 0), 2) as profit,
  round(coalesce(cash.cash_in, 0), 2)                         as cash_in,
  round(coalesce(cash.cash_out, 0), 2)                        as cash_out,
  round(coalesce(cash.cash_in, 0) - coalesce(cash.cash_out, 0), 2) as net_cash,
  round(
    coalesce(op.opening_balance, 0) + coalesce(bf.movement, 0)
    + sum(coalesce(cash.cash_in, 0) - coalesce(cash.cash_out, 0))
        over (partition by mo.business_id order by mo.month
              rows between unbounded preceding and current row),
    2
  )                                                           as cumulative_cash
from months mo
left join rev  on rev.business_id  = mo.business_id and rev.month  = mo.month
left join exp  on exp.business_id  = mo.business_id and exp.month  = mo.month
left join cash on cash.business_id = mo.business_id and cash.month = mo.month
left join opening op on op.business_id = mo.business_id
left join brought_forward bf on bf.business_id = mo.business_id;

comment on view public.v_ai_monthly_trend is
  'Rolling 12-month trend per business: revenue, expenses, profit, cash in/out and closing (cumulative) cash. Membership-scoped for JWT callers; unscoped for service-role callers, which must filter by business_id themselves.';


-- ── 3. Re-grant (DROP ... CASCADE removed the old grants) ───────────────────
grant select on public.v_ai_kpis, public.v_ai_monthly_trend
to authenticated, service_role;


-- ── 4. ai_context(): never emit JSON null for kpis / company ────────────────
-- Only the two scalar subqueries change; every aggregate already had coalesce.
-- Recreated in full because CREATE OR REPLACE FUNCTION cannot patch a body.

create or replace function public.ai_context(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if p_business_id is null then
    raise exception 'ai_context: business id is required';
  end if;

  -- Tenant guard. End users (auth.uid() present) may only read a business
  -- they are an active member of. Service-role callers have no auth.uid();
  -- they must derive the business id from business_users before calling.
  if auth.uid() is not null and not public.is_business_member(p_business_id) then
    raise exception 'ai_context: not authorised for this business'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'company', coalesce((
      select jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'currency', b.base_currency,
        'vat_registered', b.vat_registered,
        'financial_year_start', b.financial_year_start
      )
      from public.businesses b
      where b.id = p_business_id
    ), 'null'::jsonb),
    -- coalesce to an EMPTY OBJECT, not null: src/lib/ai/context.ts does
    -- asRecord(root.kpis) and treats null as "no data at all".
    'kpis', coalesce((
      select to_jsonb(k) - 'business_id'
      from public.v_ai_kpis k
      where k.business_id = p_business_id
    ), '{}'::jsonb),
    'monthlyTrend', coalesce((
      select jsonb_agg(to_jsonb(t) - 'business_id' order by t.month_start)
      from public.v_ai_monthly_trend t
      where t.business_id = p_business_id
    ), '[]'::jsonb),
    'overdueInvoices', coalesce((
      select jsonb_agg(to_jsonb(o) - 'business_id' order by o.days_overdue desc)
      from (
        select * from public.v_ai_overdue_invoices
        where business_id = p_business_id
        order by days_overdue desc
        limit 25
      ) o
    ), '[]'::jsonb),
    'topExpenses', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', x.category,
        'account_code', x.account_code,
        'amount', x.amount,
        'document_count', x.document_count,
        'period_days', 90
      ) order by x.amount desc)
      from (
        select
          category,
          account_code,
          round(sum(amount), 2)          as amount,
          sum(document_count)            as document_count
        from public.v_ai_top_expenses
        where business_id = p_business_id
          and month >= (date_trunc('month', current_date) - interval '2 months')::date
        group by category, account_code
        order by sum(amount) desc
        limit 10
      ) x
    ), '[]'::jsonb),
    'topCustomers', coalesce((
      select jsonb_agg(to_jsonb(c) - 'business_id' - 'contact_id' order by c.revenue desc)
      from (
        select * from public.v_ai_top_customers
        where business_id = p_business_id
        order by revenue desc
        limit 10
      ) c
    ), '[]'::jsonb),
    'concentration', (
      select to_jsonb(cc) - 'business_id' - 'top_contact_id'
      from public.v_ai_customer_concentration cc
      where cc.business_id = p_business_id
    ),
    'anomalies', coalesce((
      select jsonb_agg(to_jsonb(a) - 'business_id' order by
        case a.severity when 'high' then 0 when 'medium' then 1 else 2 end,
        a.occurred_on desc)
      from (
        select * from public.v_ai_anomalies
        where business_id = p_business_id
        order by
          case severity when 'high' then 0 when 'medium' then 1 else 2 end,
          occurred_on desc
        limit 20
      ) a
    ), '[]'::jsonb),
    'upcomingReceivables', coalesce((
      select jsonb_agg(to_jsonb(r) - 'business_id' order by r.due_date)
      from (
        select * from public.v_ai_upcoming_receivables
        where business_id = p_business_id
        order by due_date
        limit 200
      ) r
    ), '[]'::jsonb),
    'upcomingPayables', coalesce((
      select jsonb_agg(to_jsonb(p) - 'business_id' order by p.due_date)
      from (
        select * from public.v_ai_upcoming_payables
        where business_id = p_business_id
        order by due_date
        limit 200
      ) p
    ), '[]'::jsonb)
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

comment on function public.ai_context(uuid) is
  'Single JSONB document powering the Ledgr AI assistant: company, KPIs, 12-month trend, overdue invoices, top expenses, top customers, concentration, anomalies, upcoming receivables/payables. SECURITY DEFINER with an is_business_member() guard for JWT callers; service-role callers must derive p_business_id themselves. kpis is never JSON null — an absent row yields {}.';

grant execute on function public.ai_context(uuid) to authenticated, service_role;


-- ── 5. Guard: both caller shapes must work ──────────────────────────────────
-- Asserts the regression cannot come back: service-role reads must be
-- non-empty, and kpis must never be JSON null.

do $$
declare
  v_biz   uuid;
  v_rows  bigint;
  v_json  jsonb;
begin
  -- This block runs as the migration role (service-role equivalent, no JWT).
  if auth.uid() is not null then
    raise notice 'SKIP  guard expects a service-role session (auth.uid() is not null)';
    return;
  end if;

  select b.id into v_biz
  from public.businesses b
  where b.deleted_at is null
  order by b.created_at
  limit 1;

  if v_biz is null then
    raise notice 'SKIP  no businesses to verify against';
    return;
  end if;

  select count(*) into v_rows from public.v_ai_kpis where business_id = v_biz;
  if v_rows <> 1 then
    raise exception
      'v_ai_kpis returned % row(s) for a service-role caller (expected 1). The tenant predicate is filtering out service-role reads again.',
      v_rows;
  end if;

  v_json := public.ai_context(v_biz);
  if jsonb_typeof(v_json -> 'kpis') = 'null' or (v_json -> 'kpis') is null then
    raise exception 'ai_context().kpis is JSON null for a service-role caller';
  end if;

  raise notice 'OK - service-role callers see v_ai_kpis (% row) and kpis is %',
    v_rows, jsonb_typeof(v_json -> 'kpis');
end $$;
