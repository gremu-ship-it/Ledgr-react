-- ============================================================================
-- Audit: which RLS policies were written before the current role list?
--
-- HOW TO RUN
-- ----------
-- Paste a section into the Supabase SQL Editor and run it. No parameters.
-- Run as the service role (the SQL Editor already is) so pg_policies is fully
-- visible.
--
-- WHY
-- ---
-- "new row violates row-level security policy for table X" for a role that the
-- UI says can write is almost always this: a policy hardcodes a role list that
-- predates the role. Roles were added to the enum by
--   20260723000001  data_entry, supervisor, inventory_manager, sales_clerk
--   20260728000000  purchasing_officer, warehouse_worker, sales_manager,
--                   customer_service_rep, tax_compliance_officer,
--                   treasury_manager, asset_manager, board_member,
--                   branch_manager
-- but neither migration revisited the policies that enumerate roles.
--
-- 20260728000008 fixed contacts / branches / departments / inventory_locations
-- by routing them through can_write_business_data(). Section 1 finds every
-- other table still carrying a hand-written list.
--
-- STATUS
-- ------
-- Sections 2, 3 and 4 below are now also available as a single query, so this
-- file does not have to be pasted in by hand to notice a regression:
--
--     select * from public.audit_rls_gaps() where severity <> 'ok';
--
-- An empty result means clean. Cases that are intentional (service-role-only
-- tables, v_partner_client_usage's deliberate owner rights) come back with
-- severity 'ok' rather than as findings. 20260729000000 added that function
-- and fixed what these three sections were reporting at the time:
--   • invoice_delivery_events, recurring_invoices — RLS was never enabled
--   • api_usage                                   — bare rate-limit table
--   • v_trial_balance, v_ar_ageing, v_asset_register, v_reorder_alerts
--                                                 — owner rights, RLS bypassed
--
-- Sections 1 and 1b have no function equivalent: judging whether a role list is
-- stale still needs a human reading it against usePermissions.ts.
-- ============================================================================


-- ── 1. THE ANSWER: policies naming specific roles ────────────────────────────
-- Any row here is a policy whose behaviour depends on a literal role list.
-- `missing_roles` shows which of the current roles that list leaves out —
-- users holding those roles will be denied, however the UI is configured.

with policy_src as (
  select
    p.tablename,
    p.policyname,
    p.cmd,
    coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '') as body
  from pg_policies p
  where p.schemaname = 'public'
),
all_roles as (
  select unnest(enum_range(null::user_role))::text as role
),
flagged as (
  select
    ps.tablename,
    ps.policyname,
    ps.cmd,
    ps.body,
    array(
      select ar.role
      from all_roles ar
      where ps.body like '%''' || ar.role || '''%'
    ) as roles_named
  from policy_src ps
  where ps.body like '%role%'
)
select
  tablename,
  policyname,
  cmd,
  roles_named,
  array(
    select ar.role from all_roles ar
    where not (ar.role = any(roles_named))
      and ar.role not in ('payroll_manager', 'auditor', 'viewer', 'board_member')
  ) as missing_write_roles,
  case
    when 'supervisor' = any(roles_named) then 'ok - knows supervisor'
    else 'STALE - predates the 2026-07-23 role expansion'
  end as verdict
from flagged
where cardinality(roles_named) > 0
order by
  case when 'supervisor' = any(roles_named) then 1 else 0 end,
  tablename, policyname;


-- ── 1b. BLAST RADIUS: every policy that calls user_has_role() ────────────────
-- user_has_role(business_id, p_min_role) is a LINEAR RANK check whose CASE
-- lists only the six original roles:
--     owner > admin > accountant > payroll_manager > auditor > viewer
-- The 13 roles added in 20260723000001 / 20260728000000 appear in no branch,
-- so every comparison is false and they are denied — including at 'viewer',
-- which is why a supervisor could not even read branches for a dropdown.
--
-- `tier` is the bar each policy sets. Read this before changing the function:
-- the tiers are ordered, so widening one silently widens every policy that
-- uses a lower one. In particular check whether any payroll/salary table
-- appears at the 'viewer' tier before broadening read access.

select
  p.tablename,
  p.policyname,
  p.cmd,
  substring(
    coalesce(p.qual, '') || coalesce(p.with_check, '')
    from 'user_has_role\([^,]*,\s*''([a-z_]+)'''
  ) as tier,
  case
    when p.tablename ~ 'payroll|salary|employee|payslip' then 'SENSITIVE - check before widening read'
    else ''
  end as flag
from pg_policies p
where p.schemaname = 'public'
  and (coalesce(p.qual, '') || coalesce(p.with_check, '')) like '%user_has_role%'
order by
  case when p.tablename ~ 'payroll|salary|employee|payslip' then 0 else 1 end,
  p.tablename,
  p.cmd;


-- ── 2. Tables with RLS on but NO policy at all ───────────────────────────────
-- These reject every write from every non-superuser, silently.

select
  c.relname as table_name,
  'RLS enabled, zero policies - all access denied' as issue
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  )
order by c.relname;


-- ── 3. Business-scoped tables with RLS switched OFF ──────────────────────────
-- A business_id column and no RLS means cross-tenant exposure.

select
  c.relname as table_name,
  'has business_id but RLS is DISABLED - cross-tenant read/write' as issue
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
  and exists (
    select 1 from information_schema.columns col
    where col.table_schema = 'public'
      and col.table_name = c.relname
      and col.column_name = 'business_id'
  )
order by c.relname;


-- ── 4. Views that bypass RLS (owner rights) ──────────────────────────────────
-- A view without security_invoker runs as its owner, so RLS on the tables it
-- reads does not apply. Fine only if the view body enforces the tenant check
-- itself — v_partner_client_usage does this deliberately (see 20260727000008).

select
  c.relname as view_name,
  coalesce(
    (select option_value
     from pg_options_to_table(c.reloptions)
     where option_name = 'security_invoker'),
    'not set'
  ) as security_invoker,
  case
    when c.relname = 'v_partner_client_usage'
      then 'intentional - guarded by is_partner_admin() in the view body'
    else 'REVIEW - owner rights, RLS not applied'
  end as note
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname like 'v_%'
  and coalesce(
        (select option_value
         from pg_options_to_table(c.reloptions)
         where option_name = 'security_invoker'),
        'false'
      ) <> 'true'
order by c.relname;


-- ── 5. Effective permissions for one user, per table ─────────────────────────
-- Paste a user's UUID and a business UUID to see exactly what the database
-- thinks they can do. Compare against the UI matrix when they disagree.
--
--   select id, email from auth.users where email = 'them@example.com';
--
-- select
--   public.is_business_member     ('BUSINESS-UUID-HERE') as can_read,
--   public.can_write_business_data('BUSINESS-UUID-HERE') as can_write,
--   public.can_admin_business_data('BUSINESS-UUID-HERE') as can_delete;
--
-- Note: those helpers read auth.uid(), so run them from the app session, not
-- the SQL editor. From the editor, check the membership row directly:

-- select bu.role, bu.is_active, b.name
-- from public.business_users bu
-- join public.businesses b on b.id = bu.business_id
-- where bu.user_id = 'USER-UUID-HERE';
