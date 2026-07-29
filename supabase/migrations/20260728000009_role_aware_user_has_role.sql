-- ============================================================================
-- Make user_has_role() role-aware, and protect payroll while doing it
--
-- THE PROBLEM
-- -----------
-- Nearly every policy in the database calls
--     user_has_role(business_id, p_min_role)
-- whose body is a linear rank ladder listing ONLY the six original roles:
--
--     WHEN 'viewer'          THEN role IN (owner, admin, accountant,
--                                          payroll_manager, auditor, viewer)
--     WHEN 'auditor'         THEN role IN (owner, admin, accountant,
--                                          payroll_manager, auditor)
--     WHEN 'payroll_manager' THEN role IN (owner, admin, accountant,
--                                          payroll_manager)
--     WHEN 'accountant'      THEN role IN (owner, admin, accountant)
--     WHEN 'admin'           THEN role IN (owner, admin)
--     WHEN 'owner'           THEN role = 'owner'
--
-- The 13 roles added in 20260723000001 and 20260728000000 appear in no branch,
-- so every tier — including 'viewer' — returns false for them. That is why a
-- supervisor could not insert a contact, and could not even READ branches to
-- populate a dropdown. The CASE also has no ELSE, so an unrecognised tier
-- yields NULL and denies. It fails closed, which is why this surfaced as
-- "permission denied" rather than as a data leak.
--
-- 20260728000008 fixed contacts/branches/departments/inventory_locations by
-- taking them off this function. That left every other table still broken.
-- Rather than rewrite ~100 policies, redefine the function they all call.
--
-- WHY NOT JUST ADD THE 13 ROLES TO THE LADDER
-- -------------------------------------------
-- Because the ladder is ordered and the real model is not. Ranking a role at
-- the 'accountant' tier necessarily also clears the LOWER 'payroll_manager'
-- tier, so slotting warehouse_worker in at 'accountant' would hand it payroll
-- access. supervisor writes ledger data but not payroll; payroll_manager
-- writes payroll but not ledger data. Neither outranks the other. A single
-- ordered ladder cannot express that, so each tier is remapped onto an
-- explicit capability instead:
--
--     'viewer'          -> is_business_member()        any active member
--     'auditor'         -> can_read_audit()            oversight roles
--     'payroll_manager' -> can_view_payroll()          payroll roles only
--     'accountant'      -> can_write_business_data()   the canWrite set
--     'admin'           -> can_admin_business_data()   owner/admin
--     'owner'           -> owner only
--
-- The capability helpers come from 20260728000008 and mirror
-- src/hooks/usePermissions.ts, which rlsRoleParity.test.ts pins.
--
-- PAYROLL IS HANDLED SEPARATELY AND FIRST
-- ---------------------------------------
-- employees, employee_allowances, employee_deductions, payroll_runs and
-- payroll_employee_lines gate SELECT at the 'viewer' tier. Remapping 'viewer'
-- to is_business_member() would expose every salary, allowance and deduction
-- to all 19 roles — including warehouse_worker and sales_clerk. In
-- usePermissions.ts canViewPayroll is true for exactly four roles
-- (owner, admin, accountant, payroll_manager), so those five tables are given
-- their own explicit policies BEFORE the function is redefined. They never
-- observe the widened 'viewer' tier.
--
-- Note on write access: canWritePayroll in usePermissions.ts is true for
-- owner/admin/accountant/payroll_manager. The permissions matrix rendered in
-- TeamManagementPage.tsx also lists supervisor, which contradicts the hook
-- that actually runs. The hook is authoritative here; the matrix is a display
-- bug worth fixing separately. Supervisor is NOT granted payroll write.
--
-- SCOPE OF THE WIDENING
-- ---------------------
-- After this migration the 'accountant' write tier accepts every canWrite
-- role, so e.g. sales_clerk can in principle write journal_entries or budgets
-- at the database level. That is the intended consequence of the requested
-- model — confinement comes from page access (isPathAllowedForRole) rather
-- than from RLS. If a table should stay finance-only regardless of the page a
-- user can reach, give it an explicit policy like the payroll ones below
-- instead of relying on the shared tier.
--
-- Idempotent. Touches no data.
-- ============================================================================


-- ── 1. Payroll capability helpers ────────────────────────────────────────────

create or replace function public.can_view_payroll(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- Mirrors canViewPayroll in src/hooks/usePermissions.ts.
        'owner', 'admin', 'accountant', 'payroll_manager'
      )
  );
$$;

comment on function public.can_view_payroll(uuid) is
  'True for roles allowed to see salary data. Mirrors canViewPayroll in src/hooks/usePermissions.ts. Payroll tables must use this, never the generic member/viewer tier.';


create or replace function public.can_write_payroll(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- Mirrors canWritePayroll in src/hooks/usePermissions.ts.
        -- (TeamManagementPage.tsx's matrix also lists supervisor; the hook
        -- does not, and the hook is what runs. Following the hook.)
        'owner', 'admin', 'accountant', 'payroll_manager'
      )
  );
$$;

comment on function public.can_write_payroll(uuid) is
  'True for roles allowed to create/edit payroll. Mirrors canWritePayroll in src/hooks/usePermissions.ts.';


create or replace function public.can_read_audit(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- The pre-existing 'auditor' tier, preserved exactly, plus
        -- board_member as an oversight role. Deliberately NOT widened to
        -- every member: the audit log records who did what.
        'owner', 'admin', 'accountant', 'payroll_manager', 'auditor',
        'board_member'
      )
  );
$$;

comment on function public.can_read_audit(uuid) is
  'Oversight roles allowed to read the audit log. Preserves the original auditor tier and adds board_member. Not open to every member.';


revoke all on function public.can_view_payroll(uuid)  from public;
revoke all on function public.can_write_payroll(uuid) from public;
revoke all on function public.can_read_audit(uuid)    from public;

grant execute on function public.can_view_payroll(uuid)  to authenticated, service_role;
grant execute on function public.can_write_payroll(uuid) to authenticated, service_role;
grant execute on function public.can_read_audit(uuid)    to authenticated, service_role;


-- ── 2. Pin payroll tables to explicit policies, BEFORE the remap ─────────────
-- Order matters. These five tables must stop depending on the 'viewer' tier
-- before that tier is widened in section 3.

do $$
declare
  t text;
  p record;
  has_business_id boolean;
begin
  foreach t in array array[
    'employees',
    'employee_allowances',
    'employee_deductions',
    'payroll_runs',
    'payroll_employee_lines'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Table public.% not found, skipping.', t;
      continue;
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'business_id'
    ) into has_business_id;

    if not has_business_id then
      -- A child table without business_id cannot be scoped directly; leaving
      -- its existing policies alone is safer than guessing the join.
      raise notice 'Table public.% has no business_id, leaving its policies untouched.', t;
      continue;
    end if;

    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);

    execute format($f$
      create policy %I on public.%I
        for select using (public.can_view_payroll(business_id))
    $f$, t || '_payroll_read', t);

    execute format($f$
      create policy %I on public.%I
        for insert with check (public.can_write_payroll(business_id))
    $f$, t || '_payroll_insert', t);

    execute format($f$
      create policy %I on public.%I
        for update using (public.can_write_payroll(business_id))
                  with check (public.can_write_payroll(business_id))
    $f$, t || '_payroll_update', t);

    execute format($f$
      create policy %I on public.%I
        for delete using (public.can_admin_business_data(business_id))
    $f$, t || '_payroll_delete', t);

    execute format('revoke all on public.%I from anon', t);
  end loop;
end
$$;


-- ── 3. Redefine the ladder in terms of capabilities ──────────────────────────
-- Signature and return type are unchanged, so all ~100 existing policies keep
-- working untouched; only the meaning of each tier is corrected. Roles are
-- compared as text so this is safe alongside ALTER TYPE ... ADD VALUE.

create or replace function public.user_has_role(
  p_business_id uuid,
  p_min_role    user_role
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case p_min_role::text
    -- Read tier. Every active member, so master data and transactional lists
    -- populate for all roles. Payroll tables no longer use this tier.
    when 'viewer'          then public.is_business_member(p_business_id)

    -- Oversight read (audit_log).
    when 'auditor'         then public.can_read_audit(p_business_id)

    -- Payroll tier, kept narrow.
    when 'payroll_manager' then public.can_view_payroll(p_business_id)

    -- General write tier: the canWrite set from usePermissions.ts.
    when 'accountant'      then public.can_write_business_data(p_business_id)

    -- Administrative / destructive.
    when 'admin'           then public.can_admin_business_data(p_business_id)
    when 'owner'           then exists (
                                  select 1
                                  from public.business_users bu
                                  where bu.business_id = p_business_id
                                    and bu.user_id = auth.uid()
                                    and bu.is_active = true
                                    and bu.role::text = 'owner'
                                )

    -- Unknown tier denies, matching the original NULL-returning behaviour but
    -- explicitly.
    else false
  end;
$$;

comment on function public.user_has_role(uuid, user_role) is
  'Compatibility shim. Was a linear rank ladder hardcoding the six original roles, which denied every role added in 20260723000001/20260728000000 at every tier. Each tier now delegates to a capability helper that mirrors src/hooks/usePermissions.ts: viewer->is_business_member, auditor->can_read_audit, payroll_manager->can_view_payroll, accountant->can_write_business_data, admin/owner->admin checks. Payroll tables use can_view_payroll/can_write_payroll directly and do not rely on this.';
