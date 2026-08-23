-- ============================================================================
-- Repair: re-apply the AI tenant scoping after the views were reverted
--
-- WHY THIS EXISTS
--   A verification run showed all six tenant predicates reporting "absent" and
--   three views leaking again:
--
--     v_ai_cash_accounts    3 foreign rows
--     v_ai_kpis             1 foreign row
--     v_ai_monthly_trend   12 foreign rows
--
--   v_ai_kpis and v_ai_monthly_trend had PASSED the same check on the previous
--   run, so the database moved backwards. The cause is structural, not a failed
--   migration: 20260822000000_ai_data_views.sql defines all thirteen views with
--   `drop view ... cascade; create view ...` and NO tenant predicate. Re-running
--   that one file - by hand, or as part of a reset - silently reinstates the
--   unscoped definitions and discards the fixes from 20260823000001 and
--   20260823000002, which are separate later files.
--
--   So the security of the AI layer depended on nobody ever re-running the file
--   that creates it. That is a bad design, and this migration is only half the
--   remedy: 20260822000000 has also been corrected in place so its canonical
--   definitions carry the predicate. Re-running it is now safe, and a fresh
--   `supabase db push` produces a scoped schema without needing these repairs.
--
-- WHAT IT DOES
--   Restores the correct end state for all six views plus ai_context(), in one
--   idempotent script that does not care what is currently deployed. It merges
--   20260823000001 (kpis/monthly_trend scope + kpis JSON-null fix) and
--   20260823000002 (the four leaf views). Applying it when those already hold
--   is a no-op in effect.
--
--   The predicate everywhere is:
--
--       and (auth.uid() is null or public.is_business_member(<alias>.business_id))
--
--   The `auth.uid() is null` arm keeps the service-role path working: the Edge
--   Function calls ai_context() with no JWT, SECURITY DEFINER swaps the ROLE and
--   not the JWT, so auth.uid() is NULL there. ai_context() derives business_id
--   from business_users for the verified JWT and enforces membership in its own
--   guard.
--
--   Ends with an assertion block that fails loudly if any view is still
--   unscoped, so a partial apply cannot look like success.
-- ============================================================================


-- ── 1. Leaf views: the four that read base tables directly ──────────────────
-- CREATE OR REPLACE keeps dependents and grants intact (column lists unchanged).
create or replace view public.v_ai_cash_accounts with (security_invoker = true) as
select
  a.id,
  a.business_id,
  a.code,
  a.name,
  coalesce(a.opening_balance, 0)::numeric as opening_balance
from public.accounts a
where a.deleted_at is null
  and (a.is_bank_account or a.code in ('1110', '1115', '1125', '1126'))
  and (auth.uid() is null or public.is_business_member(a.business_id));

create or replace view public.v_ai_revenue_invoices with (security_invoker = true) as
select
  i.business_id,
  i.id                                                     as invoice_id,
  i.invoice_number,
  i.contact_id,
  i.issue_date,
  i.due_date,
  i.status::text                                           as status,
  coalesce(i.functional_amount, i.total_amount)::numeric   as amount_base,
  greatest(
    coalesce(
      i.amount_due * coalesce(i.exchange_rate, 1),
      coalesce(i.functional_amount, i.total_amount) - (i.amount_paid * coalesce(i.exchange_rate, 1))
    ),
    0
  )::numeric                                               as amount_outstanding
from public.invoices i
where i.deleted_at is null
  and i.invoice_type in ('invoice', 'credit_note', 'debit_note')
  and i.status not in ('void', 'draft')
  and (auth.uid() is null or public.is_business_member(i.business_id));

create or replace view public.v_ai_expense_docs with (security_invoker = true) as
select
  e.business_id,
  e.id                                                     as expense_id,
  e.expense_number,
  e.contact_id,
  e.expense_date,
  e.due_date,
  e.status,
  e.expense_type,
  coalesce(e.exchange_rate, 1)::numeric                    as exchange_rate,
  coalesce(e.functional_amount, e.total_amount)::numeric   as amount_base,
  greatest(
    coalesce(e.functional_amount, e.total_amount) - (e.amount_paid * coalesce(e.exchange_rate, 1)),
    0
  )::numeric                                               as amount_outstanding
from public.expenses e
where e.deleted_at is null
  and e.status not in ('void', 'draft')
  and (auth.uid() is null or public.is_business_member(e.business_id));

create or replace view public.v_ai_cash_movements with (security_invoker = true) as
select
  je.business_id,
  je.id                                         as entry_id,
  je.entry_date,
  date_trunc('month', je.entry_date)::date      as month,
  sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)::numeric as net_cash
from public.journal_entries je
join public.journal_lines jl
  on jl.journal_entry_id = je.id
 and jl.business_id = je.business_id
join public.v_ai_cash_accounts ca
  on ca.id = jl.account_id
 and ca.business_id = je.business_id
where je.status in ('posted', 'reversed')
  and (auth.uid() is null or public.is_business_member(je.business_id))
group by je.business_id, je.id, je.entry_date;


-- ── 2. v_ai_kpis and v_ai_monthly_trend ─────────────────────────────────────
-- DROP ... CASCADE here because the column list may differ from whatever is
-- currently deployed. Grants are re-issued in section 4.
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


-- ── 3. ai_context(): tenant guard + kpis must never be JSON null ────────────
-- An uncoalesced scalar subquery emits JSON null, which asRecord() in
-- src/lib/ai/context.ts reads as "no data at all" and degrades silently.
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


-- ── 4. Grants (DROP ... CASCADE above also dropped them) ────────────────────
grant select on public.v_ai_cash_accounts    to authenticated, service_role;
grant select on public.v_ai_revenue_invoices to authenticated, service_role;
grant select on public.v_ai_expense_docs     to authenticated, service_role;
grant select on public.v_ai_cash_movements   to authenticated, service_role;
grant select on public.v_ai_kpis             to authenticated, service_role;
grant select on public.v_ai_monthly_trend    to authenticated, service_role;
grant execute on function public.ai_context(uuid) to authenticated, service_role;


-- ── 5. Assert the end state ─────────────────────────────────────────────────
do $$
declare
  v_views text[] := array['v_ai_cash_accounts', 'v_ai_revenue_invoices',
                          'v_ai_expense_docs', 'v_ai_cash_movements',
                          'v_ai_kpis', 'v_ai_monthly_trend'];
  v_name    text;
  v_def     text;
  v_missing text[] := array[]::text[];
  v_cnt     bigint;
  v_total   bigint := 0;
begin
  -- 5a. every view must carry the service-role-aware membership predicate
  foreach v_name in array v_views loop
    v_def := pg_get_viewdef(format('public.%I', v_name)::regclass, true);
    if v_def not like '%is_business_member%' or v_def not like '%auth.uid() IS NULL%' then
      v_missing := v_missing || v_name;
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'Tenant predicate missing after repair on: %', array_to_string(v_missing, ', ');
  end if;
  raise notice 'OK  all 6 views carry the service-role-aware tenant predicate.';

  -- 5b. the service-role path must still return data (the 20260823000000 trap)
  if auth.uid() is null then
    foreach v_name in array v_views loop
      execute format('select count(*) from public.%I', v_name) into v_cnt;
      v_total := v_total + v_cnt;
    end loop;

    if v_total = 0 and exists (select 1 from public.accounts limit 1) then
      raise exception
        'Views are empty for a service-role caller: the Edge Function would '
        'return no data. Check the "auth.uid() is null or ..." arm.';
    end if;
    raise notice 'OK  service-role path sees % rows across the 6 views.', v_total;
  else
    raise notice 'SKIP  service-role assertion (auth.uid() is %).', auth.uid();
  end if;
end
$$;
