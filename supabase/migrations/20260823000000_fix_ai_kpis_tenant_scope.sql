-- ============================================================================
-- FIX: v_ai_kpis / v_ai_monthly_trend emitted a row for businesses the caller
--      is not a member of.
--
-- FOUND BY
--   scripts/verify-ai-views.sql § 6a:
--     FAIL  v_ai_kpis returned 1 row(s) for a foreign business
--
-- THE BUG
--   Both views drive off `public.businesses`:
--
--       from public.businesses b
--       left join rev on rev.business_id = b.id
--       ...
--       where b.deleted_at is null
--
--   security_invoker = true was set, so RLS *was* applied — but RLS was applied
--   to `businesses`, and `businesses` has FOUR SELECT policies which are OR'ed:
--
--       businesses_member_read         is_business_member(id)
--       businesses_platform_admin_read is_platform_admin(auth.uid())
--       businesses_partner_admin_read  is_partner_business_admin(id)
--       businesses_partner_peer_read   can_read_partner_peer_business(id)
--
--   A platform admin, a partner admin, or a partner *peer* therefore passes the
--   `businesses` policy for a business they are NOT a member of. The LEFT JOINs
--   to the financial CTEs then correctly return NULL (those tables are
--   membership-scoped), so the row surfaces as a business name with zeroed
--   figures — coalesce() turns every NULL into 0.
--
--   Impact: no financial data leaked (the amounts are all zeros), but the
--   EXISTENCE of the tenant, and its id, did. The assistant could also be
--   pointed at a zero row and would confidently report "no activity" for a
--   business the user should not see at all. Both are unacceptable, and it
--   breaks the "cross-company access impossible" acceptance criterion.
--
-- WHY THE OTHER 11 VIEWS WERE FINE
--   They all drive off the financial tables (invoices, expenses, journal_lines,
--   accounts), whose only read path is membership. `businesses` is the sole
--   table in this set with admin/partner read paths, and only these two views
--   touch it.
--
-- THE FIX
--   Add an explicit `public.is_business_member(b.id)` predicate to both views.
--   This is intentionally REDUNDANT with RLS: it narrows the four-policy OR
--   down to the single condition the assistant actually means — "a business
--   this user belongs to" — and it does not depend on the `businesses` policy
--   set staying as it is today.
--
--   is_business_member() is SECURITY DEFINER and STABLE, so it does not
--   re-enter RLS on business_users and is evaluated once per business row.
--
-- NOTE ON SERVICE-ROLE CALLERS
--   The `ai-chat` Edge Function reads these views through ai_context(), which
--   is SECURITY DEFINER. Under service_role auth.uid() is NULL, so
--   is_business_member() returns false and the views would be empty — which is
--   why ai_context() is DEFINER and derives the business id from business_users
--   BEFORE querying. That path is unaffected: the function owner is the one
--   evaluating these predicates, and it passes p_business_id explicitly.
--   Section 6c of the verification script covers exactly this.
--
-- Idempotent. Read-only: no DML, no accounting logic changed.
-- ============================================================================


-- ── 1. v_ai_kpis ─────────────────────────────────────────────────────────────
-- Recreated verbatim from 20260822000000 with one added predicate, marked
-- << TENANT FIX >> below.

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
    -- Average days from invoice issue to receipt over the last 180 days.
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
  and public.is_business_member(b.id);   -- << TENANT FIX

comment on view public.v_ai_kpis is
  'Month-to-date KPIs per business: revenue, expenses, net profit, margin, cash balance, receivables/overdue, payables, average days to pay, expense ratio. All amounts MWK and reconciled with the dashboard queries. Membership-scoped explicitly (is_business_member) because businesses has admin/partner SELECT policies that RLS alone would OR in — see 20260823000000.';


-- ── 2. v_ai_monthly_trend ────────────────────────────────────────────────────
-- Same defect, same fix: the months spine is generated from `businesses`.

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
      and public.is_business_member(b.id)   -- << TENANT FIX
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
  'Rolling 12-month trend per business: revenue, expenses, profit, cash in/out and closing (cumulative) cash. cumulative_cash equals the cash position at each month end and rolls into v_ai_kpis.cash_balance. Membership-scoped explicitly — see 20260823000000.';


-- ── 3. Re-grant (the DROP ... CASCADE above removed the old grants) ──────────
grant select on public.v_ai_kpis, public.v_ai_monthly_trend
to authenticated, service_role;


-- ── 4. Guard: fail the migration if the fix is not actually in place ────────
-- Cheap structural assertion so a future edit cannot silently drop the
-- predicate. Mirrors the sanity-check style of 20260728000010.

do $$
declare
  missing text[] := '{}';
  v       text;
begin
  foreach v in array array['v_ai_kpis', 'v_ai_monthly_trend'] loop
    if pg_get_viewdef(format('public.%I', v)::regclass, true)
       not like '%is_business_member%' then
      missing := missing || v;
    end if;
  end loop;

  if cardinality(missing) > 0 then
    raise exception
      'Tenant scope missing from: %. These views drive off public.businesses, whose SELECT policies OR in platform-admin and partner reads.',
      array_to_string(missing, ', ');
  end if;

  raise notice 'OK - both views are explicitly membership-scoped.';
end $$;
