-- ============================================================================
-- Ledgr AI — data source layer  (the file referenced elsewhere as
-- "0004_ai_data_views.sql"; renamed to the repository's
-- <timestamp>_<name>.sql convention so `supabase db push` orders it after the
-- Phase 8B/10 migrations it depends on).
-- ============================================================================
--
-- PURPOSE
--   One stable, company-scoped read layer for the in-app assistants
--   ("Ledgr AI" + Support Assistant). The assistant code only ever reads the
--   v_ai_* views and the ai_context(uuid) function, so the SQL can be tuned
--   without touching TypeScript.
--
-- EVERY FIGURE RECONCILES WITH AN EXISTING SCREEN
--   revenue           IncomeRepository.getTotals / useMonthlyIncome
--                     invoices, invoice_type IN ('invoice','credit_note',
--                     'debit_note'), status NOT IN ('void','draft'),
--                     amount = coalesce(functional_amount, total_amount)  [MWK]
--   receivables       IncomeRepository.findOutstanding / useOutstandingInvoices
--                     coalesce(amount_due * exchange_rate,
--                              amount_base - amount_paid * exchange_rate)
--   expenses          useMonthlyExpenses — expenses, status NOT IN
--                     ('void','draft'), coalesce(functional_amount,total_amount)
--   cash              FinancialStatementRepository.getCashPosition —
--                     accounts.opening_balance + posted/reversed journal_lines
--                     (amount_base) on cash equivalents, where a cash
--                     equivalent is is_bank_account OR code IN
--                     ('1110','1115','1125','1126')
--   cash in / out     per-journal-entry NET movement on cash equivalents, the
--                     same construction v_cash_flow uses. Internal transfers
--                     between two cash accounts net to zero and therefore
--                     never inflate gross inflow/outflow.
--
-- SECURITY
--   • Views are security_invoker: RLS on the underlying tables applies, so a
--     view can never leak another tenant's rows.
--   • ai_context(uuid) is SECURITY DEFINER *with an explicit membership
--     guard*: an end user (auth.uid() IS NOT NULL) may only ever ask for a
--     business they are an active member of (public.is_business_member).
--     Service-role callers (Edge Functions, auth.uid() IS NULL) derive the
--     business id server-side from business_users before calling it.
--   • No client-supplied business id is ever trusted without that check.
--
-- IDEMPOTENT. Read-only: no DML, no accounting logic changed.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. Building blocks
-- ────────────────────────────────────────────────────────────────────────────

-- Cash and cash equivalents, exactly as FinancialStatementRepository defines
-- them (is_bank_account OR petty cash / mobile money codes).
drop view if exists public.v_ai_cash_accounts cascade;
create view public.v_ai_cash_accounts with (security_invoker = true) as
select
  a.id,
  a.business_id,
  a.code,
  a.name,
  coalesce(a.opening_balance, 0)::numeric as opening_balance
from public.accounts a
where a.deleted_at is null
  and (a.is_bank_account or a.code in ('1110', '1115', '1125', '1126'));

comment on view public.v_ai_cash_accounts is
  'Cash and cash-equivalent accounts (is_bank_account OR code 1110/1115/1125/1126). Mirrors FinancialStatementRepository.isCashEquivalent.';


-- Net cash movement per posted journal entry. Positive = money in.
drop view if exists public.v_ai_cash_movements cascade;
create view public.v_ai_cash_movements with (security_invoker = true) as
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
group by je.business_id, je.id, je.entry_date;

comment on view public.v_ai_cash_movements is
  'Per-journal-entry net movement on cash equivalents (MWK, amount_base). Same construction as v_cash_flow: transfers between two cash accounts net to zero.';


-- Revenue documents on the dashboard''s own rules.
drop view if exists public.v_ai_revenue_invoices cascade;
create view public.v_ai_revenue_invoices with (security_invoker = true) as
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
  and i.status not in ('void', 'draft');

comment on view public.v_ai_revenue_invoices is
  'Revenue-recognising invoices in MWK. Filters and amount derivation copied from IncomeRepository.getTotals / findOutstanding so AI totals equal dashboard totals.';


-- Expense documents on the dashboard''s own rules.
drop view if exists public.v_ai_expense_docs cascade;
create view public.v_ai_expense_docs with (security_invoker = true) as
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
  and e.status not in ('void', 'draft');

comment on view public.v_ai_expense_docs is
  'Recognised expenses in MWK (status NOT IN void/draft), matching useMonthlyExpenses.';


-- ────────────────────────────────────────────────────────────────────────────
-- 1. v_ai_kpis — month-to-date headline numbers
-- ────────────────────────────────────────────────────────────────────────────
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
where b.deleted_at is null;

comment on view public.v_ai_kpis is
  'Month-to-date KPIs per business: revenue, expenses, net profit, margin, cash balance, receivables/overdue, payables, average days to pay, expense ratio. All amounts MWK and reconciled with the dashboard queries.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. v_ai_monthly_trend — last 12 complete-or-current months
-- ────────────────────────────────────────────────────────────────────────────
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
  'Rolling 12-month trend per business: revenue, expenses, profit, cash in/out and closing (cumulative) cash. cumulative_cash equals the cash position at each month end and rolls into v_ai_kpis.cash_balance.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. v_ai_overdue_invoices
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_ai_overdue_invoices cascade;
create view public.v_ai_overdue_invoices with (security_invoker = true) as
select
  r.business_id,
  r.invoice_id,
  r.invoice_number,
  r.contact_id,
  coalesce(c.name, 'Unknown customer')     as customer,
  round(r.amount_outstanding, 2)           as amount_outstanding,
  r.issue_date,
  r.due_date,
  (current_date - r.due_date)              as days_overdue
from public.v_ai_revenue_invoices r
left join public.contacts c on c.id = r.contact_id
where r.amount_outstanding > 0
  and r.due_date is not null
  and r.due_date < current_date;

comment on view public.v_ai_overdue_invoices is
  'Open sales invoices past their due date, with customer, outstanding amount (MWK) and days overdue.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. v_ai_top_expenses — expense categories per month
--    Category = the expense line''s GL account name; expenses posted without
--    lines fall back to their expense_type.
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_ai_top_expenses cascade;
create view public.v_ai_top_expenses with (security_invoker = true) as
select
  e.business_id,
  date_trunc('month', e.expense_date)::date                 as month,
  coalesce(a.name, initcap(coalesce(e.expense_type, 'uncategorised'))) as category,
  coalesce(a.code, '')                                      as account_code,
  round(sum(
    case
      when el.id is null then e.amount_base
      else coalesce(el.line_total, 0) * e.exchange_rate
    end
  ), 2)                                                     as amount,
  count(distinct e.expense_id)                              as document_count
from public.v_ai_expense_docs e
left join public.expense_lines el
  on el.expense_id = e.expense_id
 and el.business_id = e.business_id
left join public.accounts a
  on a.id = el.account_id
 and a.business_id = e.business_id
group by 1, 2, 3, 4;

comment on view public.v_ai_top_expenses is
  'Expense spend per GL category per month (MWK). Lines without an account fall back to the expense_type label.';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. v_ai_top_customers + v_ai_customer_concentration (rolling 12 months)
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_ai_top_customers cascade;
create view public.v_ai_top_customers with (security_invoker = true) as
with rev as (
  select
    r.business_id,
    r.contact_id,
    sum(r.amount_base)              as revenue,
    count(*)                        as invoice_count,
    max(r.issue_date)               as last_invoice_date,
    sum(r.amount_outstanding)       as outstanding
  from public.v_ai_revenue_invoices r
  where r.issue_date >= (date_trunc('month', current_date) - interval '11 months')::date
  group by 1, 2
)
select
  rev.business_id,
  rev.contact_id,
  coalesce(c.name, 'Unknown customer')                       as customer,
  round(rev.revenue, 2)                                      as revenue,
  rev.invoice_count,
  rev.last_invoice_date,
  round(rev.outstanding, 2)                                  as outstanding,
  round(
    100 * rev.revenue
      / nullif(sum(rev.revenue) over (partition by rev.business_id), 0),
    2
  )                                                          as share_pct
from rev
left join public.contacts c on c.id = rev.contact_id;

comment on view public.v_ai_top_customers is
  'Revenue per customer over the rolling 12 months, with each customer''s share of total revenue.';


drop view if exists public.v_ai_customer_concentration cascade;
create view public.v_ai_customer_concentration with (security_invoker = true) as
select distinct on (t.business_id)
  t.business_id,
  round(sum(t.revenue) over (partition by t.business_id), 2) as total_revenue,
  t.customer                                                 as top_customer,
  t.contact_id                                               as top_contact_id,
  round(t.revenue, 2)                                        as top_customer_revenue,
  t.share_pct                                                as concentration_pct,
  count(*) over (partition by t.business_id)                 as customer_count
from public.v_ai_top_customers t
order by t.business_id, t.revenue desc nulls last;

comment on view public.v_ai_customer_concentration is
  'Single-customer concentration risk: largest customer and its share of rolling 12-month revenue.';


-- ────────────────────────────────────────────────────────────────────────────
-- 6. v_ai_upcoming_receivables / v_ai_upcoming_payables
--    Templates the forecast uses for collection curves and committed outflows.
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_ai_upcoming_receivables cascade;
create view public.v_ai_upcoming_receivables with (security_invoker = true) as
select
  r.business_id,
  r.invoice_id,
  r.invoice_number,
  coalesce(c.name, 'Unknown customer')              as customer,
  round(r.amount_outstanding, 2)                    as amount_outstanding,
  r.due_date,
  greatest(r.due_date - current_date, 0)            as days_until_due,
  case
    when r.due_date - current_date <= 30 then '0-30'
    when r.due_date - current_date <= 60 then '30-60'
    else '60+'
  end                                               as bucket
from public.v_ai_revenue_invoices r
left join public.contacts c on c.id = r.contact_id
where r.amount_outstanding > 0
  and r.due_date is not null
  and r.due_date >= current_date;

comment on view public.v_ai_upcoming_receivables is
  'Open invoices not yet due, bucketed 0-30 / 30-60 / 60+ days for the cash-flow collection curves.';


drop view if exists public.v_ai_upcoming_payables cascade;
create view public.v_ai_upcoming_payables with (security_invoker = true) as
-- Unpaid supplier bills
select
  e.business_id,
  'bill'::text                                         as source,
  coalesce(e.expense_number, 'Bill')                   as label,
  coalesce(c.name, 'Supplier')                         as counterparty,
  round(e.amount_outstanding, 2)                       as amount,
  coalesce(e.due_date, e.expense_date)                 as due_date
from public.v_ai_expense_docs e
left join public.contacts c on c.id = e.contact_id
where e.amount_outstanding > 0
union all
-- Approved payroll runs not yet paid (net pay is the cash commitment)
select
  p.business_id,
  'payroll'::text                                      as source,
  'Payroll ' || coalesce(p.payroll_period, p.run_number) as label,
  'Employees'::text                                    as counterparty,
  round(coalesce(p.total_net, 0), 2)                   as amount,
  p.pay_date                                           as due_date
from public.payroll_runs p
where p.status = 'approved'
  and coalesce(p.total_net, 0) > 0
union all
-- Filed / pending tax returns still owing (MRA)
select
  tr.business_id,
  'tax'::text                                          as source,
  upper(replace(tr.tax_code::text, '_', ' ')) || ' ' || tr.period_label as label,
  'MRA'::text                                          as counterparty,
  round(greatest(coalesce(tr.amount_due, 0) - coalesce(tr.amount_paid, 0), 0), 2) as amount,
  tr.due_date
from public.tax_returns tr
where tr.status in ('pending', 'filed', 'overdue')
  and greatest(coalesce(tr.amount_due, 0) - coalesce(tr.amount_paid, 0), 0) > 0;

comment on view public.v_ai_upcoming_payables is
  'Committed cash outflows: unpaid bills, approved-but-unpaid payroll runs (net pay) and unpaid MRA returns, each with a due date.';


-- ────────────────────────────────────────────────────────────────────────────
-- 7. v_ai_anomalies — large / duplicate / round / negative-cash signals
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_ai_anomalies cascade;
create view public.v_ai_anomalies with (security_invoker = true) as
with
  entry_totals as (
    select
      je.business_id,
      je.id                as entry_id,
      je.entry_date,
      je.description,
      sum(case when jl.is_debit then jl.amount_base else 0 end)::numeric as total_debits
    from public.journal_entries je
    join public.journal_lines jl
      on jl.journal_entry_id = je.id
     and jl.business_id = je.business_id
    where je.status = 'posted'
      and je.entry_date >= current_date - interval '90 days'
    group by je.business_id, je.id, je.entry_date, je.description
  ),
  entry_stats as (
    select
      business_id,
      avg(total_debits)    as avg_debits,
      stddev_pop(total_debits) as sd_debits,
      count(*)             as sample_size
    from entry_totals
    group by business_id
  ),
  -- (a) unusually large transactions: > 90-day average + 2 standard deviations
  large_tx as (
    select
      t.business_id,
      'large_transaction'::text as type,
      'high'::text              as severity,
      t.entry_date              as occurred_on,
      round(t.total_debits, 2)  as amount,
      coalesce(nullif(t.description, ''), 'Journal entry') as reference,
      'Unusually large transaction: MK '
        || to_char(round(t.total_debits), 'FM999,999,999,999')
        || ' on ' || to_char(t.entry_date, 'DD Mon YYYY')
        || ' (' || coalesce(nullif(t.description, ''), 'journal entry') || ')'
        || ' — more than 2 standard deviations above the 90-day average of MK '
        || to_char(round(s.avg_debits), 'FM999,999,999,999') || '.' as description
    from entry_totals t
    join entry_stats s on s.business_id = t.business_id
    where s.sample_size >= 5
      and coalesce(s.sd_debits, 0) > 0
      and t.total_debits > s.avg_debits + 2 * s.sd_debits
  ),
  -- (b) possible duplicates: same supplier + same amount within +/- 1 day
  dup_expenses as (
    select distinct
      e1.business_id,
      'duplicate_expense'::text as type,
      'medium'::text            as severity,
      e1.expense_date           as occurred_on,
      round(e1.amount_base, 2)  as amount,
      coalesce(e1.expense_number, 'Expense') as reference,
      'Possible duplicate expense: MK '
        || to_char(round(e1.amount_base), 'FM999,999,999,999')
        || ' recorded twice for ' || coalesce(c.name, 'the same supplier')
        || ' within one day (' || to_char(e1.expense_date, 'DD Mon YYYY') || ').' as description
    from public.v_ai_expense_docs e1
    join public.v_ai_expense_docs e2
      on e2.business_id = e1.business_id
     and e2.expense_id <> e1.expense_id
     and e2.amount_base = e1.amount_base
     and abs(e2.expense_date - e1.expense_date) <= 1
     and coalesce(e2.contact_id::text, '~') = coalesce(e1.contact_id::text, '~')
    left join public.contacts c on c.id = e1.contact_id
    where e1.expense_date >= current_date - interval '90 days'
      and e1.amount_base > 0
  ),
  dup_invoices as (
    select distinct
      i1.business_id,
      'duplicate_invoice'::text as type,
      'medium'::text            as severity,
      i1.issue_date             as occurred_on,
      round(i1.amount_base, 2)  as amount,
      coalesce(i1.invoice_number, 'Invoice') as reference,
      'Possible duplicate invoice: MK '
        || to_char(round(i1.amount_base), 'FM999,999,999,999')
        || ' issued twice to ' || coalesce(c.name, 'the same customer')
        || ' within one day (' || to_char(i1.issue_date, 'DD Mon YYYY') || ').' as description
    from public.v_ai_revenue_invoices i1
    join public.v_ai_revenue_invoices i2
      on i2.business_id = i1.business_id
     and i2.invoice_id <> i1.invoice_id
     and i2.amount_base = i1.amount_base
     and abs(i2.issue_date - i1.issue_date) <= 1
     and i2.contact_id = i1.contact_id
    left join public.contacts c on c.id = i1.contact_id
    where i1.issue_date >= current_date - interval '90 days'
      and i1.amount_base > 0
  ),
  -- (c) large round amounts: >= MK 500,000 and an exact multiple of 100,000
  round_amounts as (
    select
      e.business_id,
      'large_round_amount'::text as type,
      'low'::text                as severity,
      e.expense_date             as occurred_on,
      round(e.amount_base, 2)    as amount,
      coalesce(e.expense_number, 'Expense') as reference,
      'Large round amount: MK '
        || to_char(round(e.amount_base), 'FM999,999,999,999')
        || ' on ' || to_char(e.expense_date, 'DD Mon YYYY')
        || ' — round figures are worth checking against the supporting document.' as description
    from public.v_ai_expense_docs e
    where e.expense_date >= current_date - interval '90 days'
      and e.amount_base >= 500000
      and mod(e.amount_base::numeric, 100000) = 0
  ),
  -- (d) negative cash / bank balances right now
  negative_cash as (
    select
      ca.business_id,
      'negative_cash_balance'::text as type,
      'high'::text                  as severity,
      current_date                  as occurred_on,
      round(bal.balance, 2)         as amount,
      ca.name                       as reference,
      ca.name || ' is overdrawn at MK '
        || to_char(round(bal.balance), 'FM999,999,999,999')
        || ' — confirm the balance or record the missing receipts.' as description
    from public.v_ai_cash_accounts ca
    join lateral (
      select ca.opening_balance + coalesce((
        select sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)
        from public.journal_lines jl
        join public.journal_entries je
          on je.id = jl.journal_entry_id
         and je.business_id = jl.business_id
        where jl.account_id = ca.id
          and jl.business_id = ca.business_id
          and je.status in ('posted', 'reversed')
          and je.entry_date <= current_date
      ), 0) as balance
    ) bal on true
    where bal.balance < 0
  )
select * from large_tx
union all select * from dup_expenses
union all select * from dup_invoices
union all select * from round_amounts
union all select * from negative_cash;

comment on view public.v_ai_anomalies is
  'Deterministic anomaly signals per business: large transactions (>90-day mean + 2 sigma), same-amount duplicates within one day, large round amounts, and overdrawn cash accounts. Each row carries a severity and a human-readable description.';


-- ────────────────────────────────────────────────────────────────────────────
-- 8. ai_context(uuid) — one JSONB document for the assistant
-- ────────────────────────────────────────────────────────────────────────────
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
    'company', (
      select jsonb_build_object(
        'id', b.id,
        'name', b.name,
        'currency', b.base_currency,
        'vat_registered', b.vat_registered,
        'financial_year_start', b.financial_year_start
      )
      from public.businesses b
      where b.id = p_business_id
    ),
    'kpis', (
      select to_jsonb(k) - 'business_id'
      from public.v_ai_kpis k
      where k.business_id = p_business_id
    ),
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
  'Single JSONB document powering the Ledgr AI assistant: company, KPIs, 12-month trend, overdue invoices, top expenses, top customers, concentration, anomalies, upcoming receivables/payables. SECURITY DEFINER with an is_business_member() guard — an end user can only ever read their own business.';


-- ────────────────────────────────────────────────────────────────────────────
-- 9. Grants (config.toml does not auto-expose new entities)
-- ────────────────────────────────────────────────────────────────────────────
grant select on
  public.v_ai_cash_accounts,
  public.v_ai_cash_movements,
  public.v_ai_revenue_invoices,
  public.v_ai_expense_docs,
  public.v_ai_kpis,
  public.v_ai_monthly_trend,
  public.v_ai_overdue_invoices,
  public.v_ai_top_expenses,
  public.v_ai_top_customers,
  public.v_ai_customer_concentration,
  public.v_ai_upcoming_receivables,
  public.v_ai_upcoming_payables,
  public.v_ai_anomalies
to authenticated, service_role;

grant execute on function public.ai_context(uuid) to authenticated, service_role;
