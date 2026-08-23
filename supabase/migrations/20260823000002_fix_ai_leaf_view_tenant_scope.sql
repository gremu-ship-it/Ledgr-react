-- ============================================================================
-- Close a cross-tenant leak in the AI leaf views
--
-- FOUND BY
--   scripts/verify-ai-views.sql section 6, run against real data:
--     v_ai_cash_accounts | 3 foreign rows | FAIL - LEAKS ACROSS TENANTS
--   The other 12 views reported 0 foreign rows for the same user.
--
-- ROOT CAUSE
--   Same class of bug as 20260823000000/20260823000001 fixed for v_ai_kpis and
--   v_ai_monthly_trend, and the same one behind the original `businesses` leak.
--
--   `security_invoker = true` runs the view as the caller, so the caller's RLS
--   on the BASE table applies. But RLS policies are OR'ed, so a view inherits
--   the WIDEST SELECT policy on that table — not the membership-scoped one you
--   had in mind. public.accounts (20260731000000_fix_accounts_rls.sql) has
--   three SELECT policies:
--
--     accounts_member_read         using is_business_member(business_id)
--     accounts_platform_admin_read using is_platform_admin(auth.uid())
--     accounts_partner_admin_read  using is_partner_business_admin(business_id)
--
--   A platform admin or white-label partner admin therefore legitimately reads
--   every business's chart of accounts — correct for support tooling and the
--   admin directory, wrong for an AI context payload, which must never mix
--   tenants regardless of who is asking.
--
--   v_ai_cash_accounts was the only AI view reading a base table with no
--   scoping join: every other view either filters through another v_ai_* view
--   or joins a membership-scoped table, which is why exactly one view leaked.
--
-- FIX
--   State the tenant scope explicitly in the view, exactly as 20260823000001
--   did for v_ai_kpis/v_ai_monthly_trend:
--
--     and (auth.uid() is null or public.is_business_member(business_id))
--
--   The `auth.uid() is null` arm keeps the service-role path working: the Edge
--   Function calls ai_context() with the service-role key and no JWT, and
--   is_business_member() reads auth.uid(), which is NULL there. SECURITY
--   DEFINER swaps the ROLE, not the JWT. The service-role caller is responsible
--   for filtering by business_id — ai_context() derives it from business_users
--   for the verified JWT and its own guard enforces membership.
--
--   Applied to all four leaf views that read base tables directly, not just the
--   one that leaked. invoices/expenses/journal_lines happen to carry only
--   member-scoped SELECT policies in this database, so they did not leak today,
--   but nothing stops a later migration from adding an admin read policy to
--   them — the same way accounts got one. The AI layer should not depend on the
--   absence of a policy it does not control.
--
--   CREATE OR REPLACE (not DROP ... CASCADE): the column list and types are
--   unchanged, so this preserves both the dependent views and their grants.
-- ============================================================================

-- ── Cash and cash-equivalent accounts ───────────────────────────────────────
-- This is the view that leaked.
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

comment on view public.v_ai_cash_accounts is
  'Cash and cash-equivalent accounts (is_bank_account OR code 1110/1115/1125/1126). Mirrors FinancialStatementRepository.isCashEquivalent. Tenant scope is stated explicitly because public.accounts also grants platform-admin and partner-admin reads, which security_invoker would otherwise inherit.';


-- ── Revenue documents ───────────────────────────────────────────────────────
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

comment on view public.v_ai_revenue_invoices is
  'Revenue-recognising invoices in MWK. Filters and amount derivation copied from IncomeRepository.getTotals / findOutstanding so AI totals equal dashboard totals. Tenant scope stated explicitly — do not rely on the base table''s widest RLS policy.';


-- ── Expense documents ───────────────────────────────────────────────────────
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

comment on view public.v_ai_expense_docs is
  'Recognised expenses in MWK (status NOT IN void/draft), matching useMonthlyExpenses. Tenant scope stated explicitly — do not rely on the base table''s widest RLS policy.';


-- ── Net cash movement per posted journal entry ──────────────────────────────
-- Transitively scoped through v_ai_cash_accounts above, but stated here too so
-- the guarantee survives anyone rewriting that join.
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

comment on view public.v_ai_cash_movements is
  'Per-journal-entry net movement on cash equivalents (MWK, amount_base). Same construction as v_cash_flow: transfers between two cash accounts net to zero. Tenant scope stated explicitly.';


-- CREATE OR REPLACE preserves grants, but re-issue them so this migration is
-- correct even if a view was previously dropped and rebuilt by hand.
grant select on public.v_ai_cash_accounts    to authenticated, service_role;
grant select on public.v_ai_revenue_invoices to authenticated, service_role;
grant select on public.v_ai_expense_docs     to authenticated, service_role;
grant select on public.v_ai_cash_movements   to authenticated, service_role;


-- ── Assert the service-role path still sees data ────────────────────────────
-- The 20260823000000 mistake was scoping a view with a bare
-- is_business_member() call, which silently emptied it for the Edge Function.
-- Fail the migration loudly rather than ship that again.
do $$
declare
  v_uid   uuid := auth.uid();
  v_views text[] := array['v_ai_cash_accounts', 'v_ai_revenue_invoices',
                          'v_ai_expense_docs', 'v_ai_cash_movements'];
  v_name  text;
  v_cnt   bigint;
  v_total bigint := 0;
begin
  if v_uid is not null then
    raise notice 'Skipping service-role assertion: auth.uid() is % (not a service-role session).', v_uid;
    return;
  end if;

  foreach v_name in array v_views loop
    execute format('select count(*) from public.%I', v_name) into v_cnt;
    v_total := v_total + v_cnt;
    raise notice '  %: % rows visible without a JWT', v_name, v_cnt;
  end loop;

  -- Only meaningful if the database actually holds data.
  if v_total = 0 and exists (select 1 from public.accounts limit 1) then
    raise exception
      'Tenant predicate emptied the AI leaf views for a service-role caller. '
      'The Edge Function would silently return no data. Check the '
      '"auth.uid() is null or ..." arm.';
  end if;

  raise notice 'Service-role path OK: % total rows across the four leaf views.', v_total;
end
$$;
