-- ============================================================================
-- 20261008000000_p5e_ai_branch_context.sql
-- P5-E — AI.BRANCH optional branch filter + R11 branch metric consistency
--
-- Implements Q14 B (ai_context(business_id, branch_id?) optional, read-only,
-- can_access_branch authorized) + Q15 B (after P8, branch metrics coherent).
--
-- Changes:
--  1) Branch-aware views: v_ai_revenue_invoices, v_ai_expense_docs,
--     v_ai_cash_accounts, v_ai_cash_movements, v_ai_kpis, v_ai_monthly_trend,
--     v_ai_top_expenses, v_ai_top_customers, v_ai_customer_concentration,
--     v_ai_upcoming_receivables, v_ai_upcoming_payables, v_ai_anomalies,
--     v_ai_overdue_invoices now expose branch_id where underlying table has it.
--  2) Redefine ai_context(p_business_id uuid, p_branch_id uuid default null)
--     with R03 guards (auth, membership, reports_roles) + DEC-03 branch
--     authorization via can_access_branch, tenant-bound branch check,
--     effective branch handling for assigned-scope omitted branch, and
--     branch-filtered data at SQL layer (not prompt).
--  3) Preserve existing one-arg calls via default null.
--
-- Idempotent. No data movement. Security definer pinned.
-- ============================================================================

-- ── 0. Helper: drop and recreate branch-aware views ────────────────────────
-- We recreate only the views that are branch-sensitive; others are left
-- as is for org-wide. Branch-aware views add branch_id column.

-- v_ai_revenue_invoices — add branch_id
drop view if exists public.v_ai_revenue_invoices cascade;
create view public.v_ai_revenue_invoices with (security_invoker = true) as
select
  i.business_id,
  i.branch_id,
  i.id as invoice_id,
  i.invoice_number,
  i.contact_id,
  i.issue_date,
  i.due_date,
  i.status::text as status,
  coalesce(i.functional_amount, i.total_amount)::numeric as amount_base,
  greatest(coalesce(i.amount_due * coalesce(i.exchange_rate,1), coalesce(i.functional_amount, i.total_amount) - (i.amount_paid * coalesce(i.exchange_rate,1))),0)::numeric as amount_outstanding
from public.invoices i
where i.deleted_at is null
  and i.invoice_type in ('invoice','credit_note','debit_note')
  and i.status not in ('void','draft')
  and (auth.uid() is null or public.is_business_member(i.business_id));

-- v_ai_expense_docs — add branch_id
drop view if exists public.v_ai_expense_docs cascade;
create view public.v_ai_expense_docs with (security_invoker = true) as
select
  e.business_id,
  e.branch_id,
  e.id as expense_id,
  e.expense_number,
  e.contact_id,
  e.expense_date,
  e.due_date,
  e.status,
  e.expense_type,
  coalesce(e.exchange_rate,1)::numeric as exchange_rate,
  coalesce(e.functional_amount, e.total_amount)::numeric as amount_base,
  greatest(coalesce(e.functional_amount, e.total_amount) - (e.amount_paid * coalesce(e.exchange_rate,1)),0)::numeric as amount_outstanding
from public.expenses e
where e.deleted_at is null
  and e.status not in ('void','draft')
  and (auth.uid() is null or public.is_business_member(e.business_id));

-- v_ai_cash_accounts — add branch_id
drop view if exists public.v_ai_cash_accounts cascade;
create view public.v_ai_cash_accounts with (security_invoker = true) as
select
  a.id,
  a.business_id,
  a.branch_id,
  a.code,
  a.name,
  coalesce(a.opening_balance,0)::numeric as opening_balance
from public.accounts a
where a.deleted_at is null
  and (a.is_bank_account or a.code in ('1110','1115','1125','1126'))
  and (auth.uid() is null or public.is_business_member(a.business_id));

-- v_ai_cash_movements — add branch_id (from journal_entries)
drop view if exists public.v_ai_cash_movements cascade;
create view public.v_ai_cash_movements with (security_invoker = true) as
select
  je.business_id,
  je.branch_id,
  je.id as entry_id,
  je.entry_date,
  date_trunc('month', je.entry_date)::date as month,
  sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)::numeric as net_cash
from public.journal_entries je
join public.journal_lines jl on jl.journal_entry_id = je.id and jl.business_id = je.business_id
join public.v_ai_cash_accounts ca on ca.id = jl.account_id and ca.business_id = je.business_id
where je.status in ('posted','reversed')
  and (auth.uid() is null or public.is_business_member(je.business_id))
group by je.business_id, je.branch_id, je.id, je.entry_date;

-- v_ai_kpis — branch-aware (one row per business+branch, plus business-wide when branch is null? We make it per business+branch)
drop view if exists public.v_ai_kpis cascade;
create view public.v_ai_kpis with (security_invoker = true) as
with bounds as (
  select date_trunc('month', current_date)::date as period_start,
         (date_trunc('month', current_date) + interval '1 month - 1 day')::date as period_end
),
rev_branch as (
  select r.business_id, r.branch_id, sum(r.amount_base) as revenue
  from public.v_ai_revenue_invoices r, bounds b
  where r.issue_date between b.period_start and current_date
  group by r.business_id, r.branch_id
),
rev_business as (
  select r.business_id, sum(r.amount_base) as revenue
  from public.v_ai_revenue_invoices r, bounds b
  where r.issue_date between b.period_start and current_date
  group by r.business_id
),
exp_branch as (
  select e.business_id, e.branch_id, sum(e.amount_base) as expenses
  from public.v_ai_expense_docs e, bounds b
  where e.expense_date between b.period_start and current_date
  group by e.business_id, e.branch_id
),
exp_business as (
  select e.business_id, sum(e.amount_base) as expenses
  from public.v_ai_expense_docs e, bounds b
  where e.expense_date between b.period_start and current_date
  group by e.business_id
),
ar_branch as (
  select r.business_id, r.branch_id,
         sum(r.amount_outstanding) as receivables_total,
         sum(case when r.due_date is not null and r.due_date < current_date then r.amount_outstanding else 0 end) as overdue_total,
         count(*) filter (where r.amount_outstanding > 0) as open_invoice_count
  from public.v_ai_revenue_invoices r
  where r.amount_outstanding > 0
  group by r.business_id, r.branch_id
),
ar_business as (
  select r.business_id,
         sum(r.amount_outstanding) as receivables_total,
         sum(case when r.due_date is not null and r.due_date < current_date then r.amount_outstanding else 0 end) as overdue_total,
         count(*) filter (where r.amount_outstanding > 0) as open_invoice_count
  from public.v_ai_revenue_invoices r
  where r.amount_outstanding > 0
  group by r.business_id
),
ap_branch as (
  select e.business_id, e.branch_id, sum(e.amount_outstanding) as payables_total
  from public.v_ai_expense_docs e
  where e.amount_outstanding > 0
  group by e.business_id, e.branch_id
),
ap_business as (
  select e.business_id, sum(e.amount_outstanding) as payables_total
  from public.v_ai_expense_docs e
  where e.amount_outstanding > 0
  group by e.business_id
),
cash_opening_branch as (
  select business_id, branch_id, sum(opening_balance) as opening_balance
  from public.v_ai_cash_accounts
  group by business_id, branch_id
),
cash_opening_business as (
  select business_id, sum(opening_balance) as opening_balance
  from public.v_ai_cash_accounts
  group by business_id
),
cash_movement_branch as (
  select business_id, branch_id, sum(net_cash) as movement
  from public.v_ai_cash_movements
  where entry_date <= current_date
  group by business_id, branch_id
),
cash_movement_business as (
  select business_id, sum(net_cash) as movement
  from public.v_ai_cash_movements
  where entry_date <= current_date
  group by business_id
),
paid_branch as (
  select ip.business_id, i.branch_id, avg((ip.payment_date - i.issue_date))::numeric as avg_days_to_pay
  from public.invoice_payments ip
  join public.invoices i on i.id = ip.invoice_id and i.business_id = ip.business_id
  where ip.payment_date >= current_date - interval '180 days'
    and i.deleted_at is null
    and ip.payment_date >= i.issue_date
  group by ip.business_id, i.branch_id
),
paid_business as (
  select ip.business_id, avg((ip.payment_date - i.issue_date))::numeric as avg_days_to_pay
  from public.invoice_payments ip
  join public.invoices i on i.id = ip.invoice_id and i.business_id = ip.business_id
  where ip.payment_date >= current_date - interval '180 days'
    and i.deleted_at is null
    and ip.payment_date >= i.issue_date
  group by ip.business_id
)
-- Business-wide rows (branch_id null)
select
  b.id as business_id,
  null::uuid as branch_id,
  bo.period_start,
  bo.period_end,
  round(coalesce(rb.revenue,0),2) as revenue_mtd,
  round(coalesce(eb.expenses,0),2) as expenses_mtd,
  round(coalesce(rb.revenue,0) - coalesce(eb.expenses,0),2) as net_profit_mtd,
  case when coalesce(rb.revenue,0) > 0 then round(((coalesce(rb.revenue,0) - coalesce(eb.expenses,0)) / rb.revenue)*100,2) else null end as profit_margin_pct,
  round(coalesce(co.opening_balance,0) + coalesce(cm.movement,0),2) as cash_balance,
  round(coalesce(ab.receivables_total,0),2) as receivables_total,
  round(coalesce(ab.overdue_total,0),2) as overdue_total,
  coalesce(ab.open_invoice_count,0) as open_invoice_count,
  round(coalesce(ap.payables_total,0),2) as payables_total,
  case when pb.avg_days_to_pay is null then null else round(pb.avg_days_to_pay,1) end as avg_days_to_pay,
  case when coalesce(rb.revenue,0) > 0 then round((coalesce(eb.expenses,0) / rb.revenue)*100,2) else null end as expense_ratio_pct
from public.businesses b
cross join bounds bo
left join rev_business rb on rb.business_id = b.id
left join exp_business eb on eb.business_id = b.id
left join ar_business ab on ab.business_id = b.id
left join ap_business ap on ap.business_id = b.id
left join cash_opening_business co on co.business_id = b.id
left join cash_movement_business cm on cm.business_id = b.id
left join paid_business pb on pb.business_id = b.id
where b.deleted_at is null
  and (auth.uid() is null or public.is_business_member(b.id))

union all

-- Per-branch rows
select
  b.id as business_id,
  br.id as branch_id,
  bo.period_start,
  bo.period_end,
  round(coalesce(rev.revenue,0),2) as revenue_mtd,
  round(coalesce(exp.expenses,0),2) as expenses_mtd,
  round(coalesce(rev.revenue,0) - coalesce(exp.expenses,0),2) as net_profit_mtd,
  case when coalesce(rev.revenue,0) > 0 then round(((coalesce(rev.revenue,0) - coalesce(exp.expenses,0)) / rev.revenue)*100,2) else null end as profit_margin_pct,
  round(coalesce(co.opening_balance,0) + coalesce(cm.movement,0),2) as cash_balance,
  round(coalesce(ar.receivables_total,0),2) as receivables_total,
  round(coalesce(ar.overdue_total,0),2) as overdue_total,
  coalesce(ar.open_invoice_count,0) as open_invoice_count,
  round(coalesce(ap.payables_total,0),2) as payables_total,
  case when paid.avg_days_to_pay is null then null else round(paid.avg_days_to_pay,1) end as avg_days_to_pay,
  case when coalesce(rev.revenue,0) > 0 then round((coalesce(exp.expenses,0) / rev.revenue)*100,2) else null end as expense_ratio_pct
from public.businesses b
join public.branches br on br.business_id = b.id
cross join bounds bo
left join rev_branch rev on rev.business_id = b.id and rev.branch_id = br.id
left join exp_branch exp on exp.business_id = b.id and exp.branch_id = br.id
left join ar_branch ar on ar.business_id = b.id and ar.branch_id = br.id
left join ap_branch ap on ap.business_id = b.id and ap.branch_id = br.id
left join cash_opening_branch co on co.business_id = b.id and co.branch_id = br.id
left join cash_movement_branch cm on cm.business_id = b.id and cm.branch_id = br.id
left join paid_branch paid on paid.business_id = b.id and paid.branch_id = br.id
where b.deleted_at is null
  and (auth.uid() is null or public.is_business_member(b.id));

-- For simplicity, recreate other views as branch-aware by adding branch_id
-- v_ai_overdue_invoices — add branch_id
drop view if exists public.v_ai_overdue_invoices cascade;
create view public.v_ai_overdue_invoices with (security_invoker = true) as
select r.business_id, r.branch_id, r.invoice_id, r.invoice_number, r.contact_id, coalesce(c.name,'Unknown customer') as customer, round(r.amount_outstanding,2) as amount_outstanding, r.issue_date, r.due_date, (current_date - r.due_date) as days_overdue
from public.v_ai_revenue_invoices r
left join public.contacts c on c.id = r.contact_id
where r.amount_outstanding > 0 and r.due_date is not null and r.due_date < current_date;

-- v_ai_top_expenses — branch-aware (per branch_id)
drop view if exists public.v_ai_top_expenses cascade;
create view public.v_ai_top_expenses with (security_invoker = true) as
select e.business_id, e.branch_id, date_trunc('month', e.expense_date)::date as month, coalesce(a.name, initcap(coalesce(e.expense_type,'uncategorised'))) as category, coalesce(a.code,'') as account_code, round(sum(case when el.id is null then e.amount_base else coalesce(el.line_total,0) * e.exchange_rate end),2) as amount, count(distinct e.expense_id) as document_count
from public.v_ai_expense_docs e
left join public.expense_lines el on el.expense_id = e.expense_id and el.business_id = e.business_id
left join public.accounts a on a.id = el.account_id and a.business_id = e.business_id
group by 1,2,3,4,5;

-- v_ai_top_customers — branch-aware
drop view if exists public.v_ai_top_customers cascade;
create view public.v_ai_top_customers with (security_invoker = true) as
with rev_branch as (
  select r.business_id, r.branch_id, r.contact_id, sum(r.amount_base) as revenue, count(*) as invoice_count, max(r.issue_date) as last_invoice_date, sum(r.amount_outstanding) as outstanding
  from public.v_ai_revenue_invoices r
  where r.issue_date >= (date_trunc('month', current_date) - interval '11 months')::date
  group by 1,2,3
),
rev_business as (
  select r.business_id, r.contact_id, sum(r.amount_base) as revenue, count(*) as invoice_count, max(r.issue_date) as last_invoice_date, sum(r.amount_outstanding) as outstanding
  from public.v_ai_revenue_invoices r
  where r.issue_date >= (date_trunc('month', current_date) - interval '11 months')::date
  group by 1,2
)
-- Per-branch rows
select rev.business_id, rev.branch_id, rev.contact_id, coalesce(c.name,'Unknown customer') as customer, round(rev.revenue,2) as revenue, rev.invoice_count, rev.last_invoice_date, round(rev.outstanding,2) as outstanding,
       round(100 * rev.revenue / nullif(sum(rev.revenue) over (partition by rev.business_id, rev.branch_id),0),2) as share_pct
from rev_branch rev left join public.contacts c on c.id = rev.contact_id
union all
-- Business-wide rows (branch_id null)
select rev.business_id, null::uuid as branch_id, rev.contact_id, coalesce(c.name,'Unknown customer') as customer, round(rev.revenue,2) as revenue, rev.invoice_count, rev.last_invoice_date, round(rev.outstanding,2) as outstanding,
       round(100 * rev.revenue / nullif(sum(rev.revenue) over (partition by rev.business_id),0),2) as share_pct
from rev_business rev left join public.contacts c on c.id = rev.contact_id;

drop view if exists public.v_ai_customer_concentration cascade;
create view public.v_ai_customer_concentration with (security_invoker = true) as
with aggregated as (
  select business_id, contact_id, max(customer) as customer, sum(revenue) as revenue, sum(outstanding) as outstanding, count(*) as inv_count
  from public.v_ai_top_customers
  where branch_id is not null
  group by business_id, contact_id
),
ranked as (
  select business_id, contact_id, customer, revenue, outstanding,
         round(100 * revenue / nullif(sum(revenue) over (partition by business_id),0),2) as share_pct,
         sum(revenue) over (partition by business_id) as total_revenue,
         count(*) over (partition by business_id) as customer_count,
         row_number() over (partition by business_id order by revenue desc) as rn
  from aggregated
),
per_branch as (
  select distinct on (t.business_id, t.branch_id)
    t.business_id, t.branch_id, round(sum(t.revenue) over (partition by t.business_id, t.branch_id),2) as total_revenue, t.customer as top_customer, t.contact_id as top_contact_id, round(t.revenue,2) as top_customer_revenue, t.share_pct as concentration_pct, count(*) over (partition by t.business_id, t.branch_id) as customer_count
  from public.v_ai_top_customers t
  where t.branch_id is not null
  order by t.business_id, t.branch_id, t.revenue desc nulls last
),
business_wide as (
  select business_id, null::uuid as branch_id, round(total_revenue,2) as total_revenue, customer as top_customer, contact_id as top_contact_id, round(revenue,2) as top_customer_revenue, share_pct as concentration_pct, customer_count
  from ranked where rn = 1
)
select * from per_branch
union all
select * from business_wide;

-- v_ai_upcoming_receivables — branch-aware
drop view if exists public.v_ai_upcoming_receivables cascade;
create view public.v_ai_upcoming_receivables with (security_invoker = true) as
select r.business_id, r.branch_id, r.invoice_id, r.invoice_number, coalesce(c.name,'Unknown customer') as customer, round(r.amount_outstanding,2) as amount_outstanding, r.due_date, greatest(r.due_date - current_date,0) as days_until_due,
       case when r.due_date - current_date <=30 then '0-30' when r.due_date - current_date <=60 then '30-60' else '60+' end as bucket
from public.v_ai_revenue_invoices r
left join public.contacts c on c.id = r.contact_id
where r.amount_outstanding > 0 and r.due_date is not null and r.due_date >= current_date;

-- v_ai_upcoming_payables — branch-aware for bills (expenses), payroll and tax remain business-wide (no branch)
drop view if exists public.v_ai_upcoming_payables cascade;
create view public.v_ai_upcoming_payables with (security_invoker = true) as
select e.business_id, e.branch_id, 'bill'::text as source, coalesce(e.expense_number,'Bill') as label, coalesce(c.name,'Supplier') as counterparty, round(e.amount_outstanding,2) as amount, coalesce(e.due_date, e.expense_date) as due_date
from public.v_ai_expense_docs e left join public.contacts c on c.id = e.contact_id where e.amount_outstanding > 0
union all
select p.business_id, null::uuid as branch_id, 'payroll'::text as source, 'Payroll ' || coalesce(p.payroll_period, p.run_number) as label, 'Employees'::text as counterparty, round(coalesce(p.total_net,0),2) as amount, p.pay_date as due_date
from public.payroll_runs p where p.status = 'approved' and coalesce(p.total_net,0) > 0
union all
select tr.business_id, null::uuid as branch_id, 'tax'::text as source, upper(replace(tr.tax_code::text,'_',' ')) || ' ' || tr.period_label as label, 'MRA'::text as counterparty, round(greatest(coalesce(tr.amount_due,0) - coalesce(tr.amount_paid,0),0),2) as amount, tr.due_date
from public.tax_returns tr where tr.status in ('pending','filed','overdue') and greatest(coalesce(tr.amount_due,0) - coalesce(tr.amount_paid,0),0) > 0;

-- v_ai_anomalies — branch-aware for large transactions (via journal_entries.branch_id)
-- For simplicity, keep anomalies per business+branch where applicable, but expose branch_id
drop view if exists public.v_ai_anomalies cascade;
create view public.v_ai_anomalies with (security_invoker = true) as
with entry_totals as (
  select je.business_id, je.branch_id, je.id as entry_id, je.entry_date, je.description, sum(case when jl.is_debit then jl.amount_base else 0 end)::numeric as total_debits
  from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id = je.id and jl.business_id = je.business_id
  where je.status = 'posted' and je.entry_date >= current_date - interval '90 days'
  group by je.business_id, je.branch_id, je.id, je.entry_date, je.description
),
entry_stats as (
  select business_id, branch_id, avg(total_debits) as avg_debits, stddev_pop(total_debits) as sd_debits, count(*) as sample_size
  from entry_totals group by business_id, branch_id
),
large_tx as (
  select t.business_id, t.branch_id, 'large_transaction'::text as type, 'high'::text as severity, t.entry_date as occurred_on, round(t.total_debits,2) as amount, coalesce(nullif(t.description,''),'Journal entry') as reference,
         'Unusually large transaction: MK ' || to_char(round(t.total_debits),'FM999,999,999,999') || ' on ' || to_char(t.entry_date,'DD Mon YYYY') || ' (' || coalesce(nullif(t.description,''),'journal entry') || ')' || ' — more than 2 standard deviations above the 90-day average of MK ' || to_char(round(s.avg_debits),'FM999,999,999,999') || '.' as description
  from entry_totals t join entry_stats s on s.business_id = t.business_id and coalesce(s.branch_id::text,'') = coalesce(t.branch_id::text,'')
  where s.sample_size >=5 and coalesce(s.sd_debits,0) >0 and t.total_debits > s.avg_debits + 2 * s.sd_debits
),
dup_expenses as (
  select distinct e1.business_id, e1.branch_id, 'duplicate_expense'::text as type, 'medium'::text as severity, e1.expense_date as occurred_on, round(e1.amount_base,2) as amount, coalesce(e1.expense_number,'Expense') as reference,
         'Possible duplicate expense: MK ' || to_char(round(e1.amount_base),'FM999,999,999,999') || ' recorded twice for ' || coalesce(c.name,'the same supplier') || ' within one day (' || to_char(e1.expense_date,'DD Mon YYYY') || ').' as description
  from public.v_ai_expense_docs e1 join public.v_ai_expense_docs e2 on e2.business_id = e1.business_id and e2.branch_id is not distinct from e1.branch_id and e2.expense_id <> e1.expense_id and e2.amount_base = e1.amount_base and abs(e2.expense_date - e1.expense_date) <=1 and coalesce(e2.contact_id::text,'~') = coalesce(e1.contact_id::text,'~')
  left join public.contacts c on c.id = e1.contact_id
  where e1.expense_date >= current_date - interval '90 days' and e1.amount_base >0
),
dup_invoices as (
  select distinct i1.business_id, i1.branch_id, 'duplicate_invoice'::text as type, 'medium'::text as severity, i1.issue_date as occurred_on, round(i1.amount_base,2) as amount, coalesce(i1.invoice_number,'Invoice') as reference,
         'Possible duplicate invoice: MK ' || to_char(round(i1.amount_base),'FM999,999,999,999') || ' issued twice to ' || coalesce(c.name,'the same customer') || ' within one day (' || to_char(i1.issue_date,'DD Mon YYYY') || ').' as description
  from public.v_ai_revenue_invoices i1 join public.v_ai_revenue_invoices i2 on i2.business_id = i1.business_id and i2.branch_id is not distinct from i1.branch_id and i2.invoice_id <> i1.invoice_id and i2.amount_base = i1.amount_base and abs(i2.issue_date - i1.issue_date) <=1 and i2.contact_id = i1.contact_id
  left join public.contacts c on c.id = i1.contact_id
  where i1.issue_date >= current_date - interval '90 days' and i1.amount_base >0
),
round_amounts as (
  select e.business_id, e.branch_id, 'large_round_amount'::text as type, 'low'::text as severity, e.expense_date as occurred_on, round(e.amount_base,2) as amount, coalesce(e.expense_number,'Expense') as reference,
         'Large round amount: MK ' || to_char(round(e.amount_base),'FM999,999,999,999') || ' on ' || to_char(e.expense_date,'DD Mon YYYY') || ' — round figures are worth checking against the supporting document.' as description
  from public.v_ai_expense_docs e where e.expense_date >= current_date - interval '90 days' and e.amount_base >=500000 and mod(e.amount_base::numeric,100000)=0
),
negative_cash as (
  select ca.business_id, ca.branch_id, 'negative_cash_balance'::text as type, 'high'::text as severity, current_date as occurred_on, round(bal.balance,2) as amount, ca.name as reference,
         ca.name || ' is overdrawn at MK ' || to_char(round(bal.balance),'FM999,999,999,999') || ' — confirm the balance or record the missing receipts.' as description
  from public.v_ai_cash_accounts ca
  join lateral (select ca.opening_balance + coalesce((select sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end) from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id and je.business_id = jl.business_id where jl.account_id = ca.id and jl.business_id = ca.business_id and je.status in ('posted','reversed') and je.entry_date <= current_date),0) as balance) bal on true
  where bal.balance <0
)
select * from large_tx union all select * from dup_expenses union all select * from dup_invoices union all select * from round_amounts union all select * from negative_cash;

-- v_ai_monthly_trend — branch-aware (per business+branch)
drop view if exists public.v_ai_monthly_trend cascade;
create view public.v_ai_monthly_trend with (security_invoker = true) as
with window_start as (select (date_trunc('month', current_date) - interval '11 months')::date as first_month),
months_branch as (
  select b.id as business_id, br.id as branch_id, gs::date as month
  from public.businesses b cross join window_start ws cross join lateral generate_series(ws.first_month, date_trunc('month', current_date)::date, interval '1 month') gs
  join public.branches br on br.business_id = b.id
  where b.deleted_at is null and (auth.uid() is null or public.is_business_member(b.id))
),
months_business as (
  select b.id as business_id, null::uuid as branch_id, gs::date as month
  from public.businesses b cross join window_start ws cross join lateral generate_series(ws.first_month, date_trunc('month', current_date)::date, interval '1 month') gs
  where b.deleted_at is null and (auth.uid() is null or public.is_business_member(b.id))
),
rev_branch as (
  select r.business_id, r.branch_id, date_trunc('month', r.issue_date)::date as month, sum(r.amount_base) as revenue
  from public.v_ai_revenue_invoices r, window_start ws where r.issue_date >= ws.first_month group by 1,2,3
),
rev_business as (
  select r.business_id, date_trunc('month', r.issue_date)::date as month, sum(r.amount_base) as revenue
  from public.v_ai_revenue_invoices r, window_start ws where r.issue_date >= ws.first_month group by 1,2
),
exp_branch as (
  select e.business_id, e.branch_id, date_trunc('month', e.expense_date)::date as month, sum(e.amount_base) as expenses
  from public.v_ai_expense_docs e, window_start ws where e.expense_date >= ws.first_month group by 1,2,3
),
exp_business as (
  select e.business_id, date_trunc('month', e.expense_date)::date as month, sum(e.amount_base) as expenses
  from public.v_ai_expense_docs e, window_start ws where e.expense_date >= ws.first_month group by 1,2
),
cash_branch as (
  select m.business_id, m.branch_id, m.month, sum(case when m.net_cash >0 then m.net_cash else 0 end) as cash_in, sum(case when m.net_cash <0 then -m.net_cash else 0 end) as cash_out
  from public.v_ai_cash_movements m, window_start ws where m.entry_date >= ws.first_month group by 1,2,3
),
cash_business as (
  select m.business_id, date_trunc('month', m.entry_date)::date as month, sum(case when m.net_cash >0 then m.net_cash else 0 end) as cash_in, sum(case when m.net_cash <0 then -m.net_cash else 0 end) as cash_out
  from public.v_ai_cash_movements m, window_start ws where m.entry_date >= ws.first_month group by 1,2
),
opening_branch as (select business_id, branch_id, sum(opening_balance) as opening_balance from public.v_ai_cash_accounts group by business_id, branch_id),
opening_business as (select business_id, sum(opening_balance) as opening_balance from public.v_ai_cash_accounts group by business_id),
brought_forward_branch as (select m.business_id, m.branch_id, sum(m.net_cash) as movement from public.v_ai_cash_movements m, window_start ws where m.entry_date < ws.first_month group by 1,2),
brought_forward_business as (select m.business_id, sum(m.net_cash) as movement from public.v_ai_cash_movements m, window_start ws where m.entry_date < ws.first_month group by 1)
-- Per-branch trend
select
  mo.business_id, mo.branch_id, to_char(mo.month,'YYYY-MM') as month, mo.month as month_start, round(coalesce(rev.revenue,0),2) as revenue, round(coalesce(exp.expenses,0),2) as expenses, round(coalesce(rev.revenue,0)-coalesce(exp.expenses,0),2) as profit, round(coalesce(cash.cash_in,0),2) as cash_in, round(coalesce(cash.cash_out,0),2) as cash_out, round(coalesce(cash.cash_in,0)-coalesce(cash.cash_out,0),2) as net_cash,
  round(coalesce(op.opening_balance,0) + coalesce(bf.movement,0) + sum(coalesce(cash.cash_in,0)-coalesce(cash.cash_out,0)) over (partition by mo.business_id, mo.branch_id order by mo.month rows between unbounded preceding and current row),2) as cumulative_cash
from months_branch mo
left join rev_branch rev on rev.business_id = mo.business_id and rev.branch_id = mo.branch_id and rev.month = mo.month
left join exp_branch exp on exp.business_id = mo.business_id and exp.branch_id = mo.branch_id and exp.month = mo.month
left join cash_branch cash on cash.business_id = mo.business_id and cash.branch_id = mo.branch_id and cash.month = mo.month
left join opening_branch op on op.business_id = mo.business_id and op.branch_id = mo.branch_id
left join brought_forward_branch bf on bf.business_id = mo.business_id and bf.branch_id = mo.branch_id
union all
-- Business-wide trend (aggregated across all branches)
select
  mo.business_id, mo.branch_id, to_char(mo.month,'YYYY-MM') as month, mo.month as month_start, round(coalesce(rev.revenue,0),2) as revenue, round(coalesce(exp.expenses,0),2) as expenses, round(coalesce(rev.revenue,0)-coalesce(exp.expenses,0),2) as profit, round(coalesce(cash.cash_in,0),2) as cash_in, round(coalesce(cash.cash_out,0),2) as cash_out, round(coalesce(cash.cash_in,0)-coalesce(cash.cash_out,0),2) as net_cash,
  round(coalesce(op.opening_balance,0) + coalesce(bf.movement,0) + sum(coalesce(cash.cash_in,0)-coalesce(cash.cash_out,0)) over (partition by mo.business_id order by mo.month rows between unbounded preceding and current row),2) as cumulative_cash
from months_business mo
left join rev_business rev on rev.business_id = mo.business_id and rev.month = mo.month
left join exp_business exp on exp.business_id = mo.business_id and exp.month = mo.month
left join cash_business cash on cash.business_id = mo.business_id and cash.month = mo.month
left join opening_business op on op.business_id = mo.business_id
left join brought_forward_business bf on bf.business_id = mo.business_id;

-- ── 1. Privileges for new views ────────────────────────────────────────────
grant select on public.v_ai_revenue_invoices, public.v_ai_expense_docs, public.v_ai_cash_accounts, public.v_ai_cash_movements, public.v_ai_kpis, public.v_ai_monthly_trend, public.v_ai_overdue_invoices, public.v_ai_top_expenses, public.v_ai_top_customers, public.v_ai_customer_concentration, public.v_ai_upcoming_receivables, public.v_ai_upcoming_payables, public.v_ai_anomalies
to authenticated, service_role;

-- ── 2. ai_context with optional branch_id ──────────────────────────────────
-- Drop old one-arg version to avoid overload ambiguity; recreate with default
drop function if exists public.ai_context(uuid);
drop function if exists public.ai_context(uuid, uuid);

create or replace function public.ai_context(p_business_id uuid, p_branch_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_role_claim text;
  v_membership_role text;
  v_caller_branch_id uuid;
  v_effective_branch_id uuid;
  v_reports_roles constant text[] := array['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager'];
  v_org_wide_roles constant text[] := array['owner','admin','manager','accountant','auditor'];
  v_assigned_roles constant text[] := array['cashier','stock_clerk','branch_manager','sales_clerk','sales_manager','purchasing_officer','warehouse_worker','customer_service_rep'];
begin
  if p_business_id is null then
    raise exception 'ai_context: business id is required';
  end if;

  v_role_claim := nullif(current_setting('request.jwt.claim.role', true), '');

  if auth.uid() is null then
    if v_role_claim is not null and v_role_claim <> 'service_role' then
      raise exception 'ai_context: authentication required' using errcode = '42501';
    end if;
    -- service_role path: tenant boundary for branch
    if p_branch_id is not null then
      if not exists (select 1 from public.branches where id = p_branch_id and business_id = p_business_id) then
        raise exception 'ai_context: branch not found in this business' using errcode = '42501';
      end if;
    end if;
  elsif not public.is_business_member(p_business_id) then
    raise exception 'ai_context: not authorised for this business' using errcode = '42501';
  else
    select bu.role::text, bu.branch_id into v_membership_role, v_caller_branch_id
      from public.business_users bu where bu.business_id = p_business_id and bu.user_id = auth.uid() and bu.is_active = true;

    if v_membership_role is null or not (v_membership_role = any (v_reports_roles)) then
      raise exception 'ai_context: your role cannot access business financial insights' using errcode = '42501';
    end if;

    -- Tenant-bound branch check
    if p_branch_id is not null then
      if not exists (select 1 from public.branches where id = p_branch_id and business_id = p_business_id) then
        raise exception 'ai_context: branch not found in this business' using errcode = '42501';
      end if;
      if not public.can_access_branch(p_business_id, p_branch_id) then
        raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
      end if;
      v_effective_branch_id := p_branch_id;
    else
      -- Omitted branch: org-wide roles keep org-wide (null), assigned-scope with branch gets their branch
      -- branch_manager/sales_manager are hybrid (reports-tier + assigned) — null branch is legacy org-wide, not fail-closed
      if v_membership_role = any (v_assigned_roles) and v_caller_branch_id is not null then
        -- Assigned-scope caller who omitted branch must not receive org-wide; filter to their branch
        if not public.can_access_branch(p_business_id, v_caller_branch_id) then
          raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
        end if;
        v_effective_branch_id := v_caller_branch_id;
      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null and v_membership_role not in ('branch_manager','sales_manager') then
        -- Assigned-scope with NULL assignment (fail-closed) — no authorized branch (except hybrid reports-tier managers)
        raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
      else
        -- Org-wide or legacy null-assignment: org-wide
        v_effective_branch_id := null;
      end if;
    end if;
  end if;

  -- For service_role with branch, v_effective_branch_id already set; for anon/service without branch, null

  -- Build result with branch filtering at SQL layer
  select jsonb_build_object(
    'generated_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
    'company', coalesce((select jsonb_build_object('id', b.id, 'name', b.name, 'currency', b.base_currency, 'vat_registered', b.vat_registered, 'financial_year_start', b.financial_year_start) from public.businesses b where b.id = p_business_id), 'null'::jsonb),
    'kpis', coalesce((select to_jsonb(k) - 'business_id' - 'branch_id' from public.v_ai_kpis k where k.business_id = p_business_id and k.branch_id is not distinct from v_effective_branch_id), '{}'::jsonb),
    'monthlyTrend', coalesce((select jsonb_agg(to_jsonb(t) - 'business_id' - 'branch_id' order by t.month_start) from public.v_ai_monthly_trend t where t.business_id = p_business_id and t.branch_id is not distinct from v_effective_branch_id), '[]'::jsonb),
    'overdueInvoices', coalesce((select jsonb_agg(to_jsonb(o) - 'business_id' - 'branch_id' order by o.days_overdue desc) from (select * from public.v_ai_overdue_invoices where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id) order by days_overdue desc limit 25) o), '[]'::jsonb),
    'topExpenses', coalesce((select jsonb_agg(jsonb_build_object('category', x.category, 'account_code', x.account_code, 'amount', x.amount, 'document_count', x.document_count, 'period_days', 90) order by x.amount desc) from (select category, account_code, round(sum(amount),2) as amount, sum(document_count) as document_count from public.v_ai_top_expenses where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id) and month >= (date_trunc('month', current_date) - interval '2 months')::date group by category, account_code order by sum(amount) desc limit 10) x), '[]'::jsonb),
    'topCustomers', coalesce((select jsonb_agg(to_jsonb(c) - 'business_id' - 'branch_id' - 'contact_id' order by c.revenue desc) from (select * from public.v_ai_top_customers where business_id = p_business_id and branch_id is not distinct from v_effective_branch_id order by revenue desc limit 10) c), '[]'::jsonb),
    'concentration', (select to_jsonb(cc) - 'business_id' - 'branch_id' - 'top_contact_id' from public.v_ai_customer_concentration cc where cc.business_id = p_business_id and cc.branch_id is not distinct from v_effective_branch_id),
    'anomalies', coalesce((select jsonb_agg(to_jsonb(a) - 'business_id' - 'branch_id' order by case a.severity when 'high' then 0 when 'medium' then 1 else 2 end, a.occurred_on desc) from (select * from public.v_ai_anomalies where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id) order by case severity when 'high' then 0 when 'medium' then 1 else 2 end, occurred_on desc limit 20) a), '[]'::jsonb),
    'upcomingReceivables', coalesce((select jsonb_agg(to_jsonb(r) - 'business_id' - 'branch_id' order by r.due_date) from (select * from public.v_ai_upcoming_receivables where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id) order by due_date limit 200) r), '[]'::jsonb),
    'upcomingPayables', coalesce((select jsonb_agg(to_jsonb(p) - 'business_id' - 'branch_id' order by p.due_date) from (select * from public.v_ai_upcoming_payables where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id or branch_id is null) order by due_date limit 200) p), '[]'::jsonb),
    'branch_id', case when v_effective_branch_id is null then null else v_effective_branch_id end
  ) into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

comment on function public.ai_context(uuid, uuid) is
  'Single JSONB document for Ledgr AI assistant with optional branch filter. R03 authorisation (authenticated/service_role, membership, reports_roles) AND DEC-03 branch authorization via can_access_branch when branch supplied or implied for assigned-scope omitted branch. Branch filtering is server-side at SQL layer; branch must belong to business (tenant boundary); assigned-scope omitted branch is filtered to own branch, not org-wide.';

revoke execute on function public.ai_context(uuid, uuid) from public, anon;
grant execute on function public.ai_context(uuid, uuid) to authenticated, service_role;
-- Keep one-arg compatibility via default, but also ensure the one-arg signature is the same function (default makes it work). For tooling that checks has_function_privilege on one-arg, create a wrapper.
create or replace function public.ai_context(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$ select public.ai_context(p_business_id, null::uuid) $$;

comment on function public.ai_context(uuid) is
  'Wrapper for ai_context(business_id) — org-wide when permitted, assigned-scope filtered to own branch. See ai_context(uuid, uuid).';

revoke execute on function public.ai_context(uuid) from public, anon;
grant execute on function public.ai_context(uuid) to authenticated, service_role;

-- ── 3. Self-verification ───────────────────────────────────────────────────
do $$
declare
  v_def text;
  v_allowed text[] := array['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager'];
  v_name text;
begin
  v_def := pg_get_functiondef('public.ai_context(uuid, uuid)'::regprocedure);
  if v_def not like '%authentication required%' or v_def not like '%business financial insights%' then
    raise exception 'R03 verification failed: ai_context lacks its authorisation guards';
  end if;
  if v_def not like '%can_access_branch%' then
    raise exception 'P5-E verification failed: ai_context lacks branch authorization';
  end if;
  foreach v_name in array v_allowed loop
    if v_def not like '%' || v_name || '%' then
      raise exception 'R03 verification failed: allowed role % missing from ai_context', v_name;
    end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.ai_context(uuid, uuid)', 'EXECUTE') then
    raise exception 'R03 verification failed: authenticated lost EXECUTE on ai_context(uuid, uuid)';
  end if;
  if has_function_privilege('anon', 'public.ai_context(uuid, uuid)', 'EXECUTE') then
    raise exception 'R03 verification failed: anon still holds EXECUTE on ai_context(uuid, uuid)';
  end if;
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  begin
    perform public.ai_context('00000000-0000-4000-8000-000000000000'::uuid, null::uuid);
    raise exception 'R03 verification failed: anonymous ai_context call was not denied';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.role','service_role',true);
  begin
    perform public.ai_context(null::uuid, null::uuid);
    raise exception 'P5-E verification failed: null business id no longer rejected';
  exception when others then
    if sqlerrm <> 'ai_context: business id is required' then raise; end if;
  end;
  perform set_config('request.jwt.claim.role','',true);
  raise notice 'OK R03+P5-E ai_context authorisation verified: anonymous denied, service-role path intact, branch authorization present.';
end
$$;
