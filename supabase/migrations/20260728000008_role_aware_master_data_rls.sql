-- ============================================================================
-- Role-aware RLS for master data: contacts, branches, departments,
-- inventory_locations
--
-- THE BUG
-- -------
--   "contacts: new row violates row-level security policy for table contacts"
--   when a supervisor adds a customer.
--
-- The policies on these four tables were created directly on the database,
-- before this migrations folder existed, so they are not reproducible from the
-- repo. They gate writes on a hardcoded role list that predates every role
-- added since:
--     20260723000001 -> data_entry, supervisor, inventory_manager, sales_clerk
--     20260728000000 -> purchasing_officer, warehouse_worker, sales_manager,
--                       customer_service_rep, tax_compliance_officer,
--                       treasury_manager, asset_manager, board_member,
--                       branch_manager
-- Both migrations only ran `ALTER TYPE user_role ADD VALUE`. The enum and the
-- client-side matrix in src/hooks/usePermissions.ts learned about the new
-- roles; the database's write policies never did. usePermissions reports
-- `canWrite: true` for supervisor, so the UI renders the Add Customer button
-- and the insert is then rejected by Postgres.
--
-- This is not specific to supervisor or to contacts. Every role added after
-- the original policies was written hits the same wall on every table with a
-- hand-written role list. scripts/audit-role-rls.sql reports the full set.
--
-- THE FIX
-- -------
-- Stop hardcoding role lists per table. Define the permission tiers ONCE as
-- SQL functions that mirror usePermissions.ts, and express every policy in
-- terms of them. Adding a role in future is then a one-line change here
-- instead of an unknown number of invisible policy edits.
--
--   is_business_member(b)      -> any active member. Read tier.
--   can_write_business_data(b) -> active member whose role has canWrite.
--   can_admin_business_data(b) -> owner / admin. Hard-delete tier.
--
-- Roles are compared as text, not as user_role literals, so this migration is
-- safe to run in the same session as an `ALTER TYPE ... ADD VALUE` (Postgres
-- refuses to use a newly added enum label in the same transaction) and does
-- not break if a label is later renamed.
--
-- READ ACCESS
-- -----------
-- Granted to every active member. This started as "only the roles that need
-- them", but working through it role by role, the set is all of them: every
-- writer role records transactions that reference a customer, a branch or a
-- department; auditor / viewer / board_member need master data to make sense
-- of the statements they are allowed to read; payroll_manager needs
-- departments for cost centres. Narrowing read here would re-create exactly
-- the failure being fixed, one dropdown at a time. Confinement comes from
-- page-level access (isPathAllowedForRole), not from hiding the lists.
--
-- WRITE ACCESS
-- ------------
-- Every role with canWrite, including supervisor, for all four tables.
-- Branches and departments are writable by the same tier as contacts.
--
-- Excluded from writes (canWrite: false in usePermissions.ts):
--   payroll_manager (payroll only), auditor, viewer, board_member.
--
-- Soft delete (UPDATE of deleted_at) follows the write tier, so the app's
-- existing soft-delete path works for writers. Hard DELETE stays owner/admin.
--
-- Idempotent. Touches no data.
-- ============================================================================


-- ── 1. Permission tier helpers ───────────────────────────────────────────────
-- SECURITY DEFINER so a policy on table X can consult business_users without
-- the caller needing their own read policy on business_users, and to avoid
-- recursive policy evaluation. search_path pinned per Supabase linter 0011.

create or replace function public.is_business_member(p_business_id uuid)
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
  );
$$;

comment on function public.is_business_member(uuid) is
  'True when the caller is an active member of the business, whatever their role. Read tier for business-scoped master data.';


create or replace function public.can_write_business_data(p_business_id uuid)
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
        -- Mirrors canWrite in src/hooks/usePermissions.ts. Keep in sync.
        'owner',
        'admin',
        'accountant',
        'supervisor',
        'data_entry',
        'inventory_manager',
        'sales_clerk',
        'purchasing_officer',
        'warehouse_worker',
        'sales_manager',
        'customer_service_rep',
        'tax_compliance_officer',
        'treasury_manager',
        'asset_manager',
        'branch_manager'
        -- Deliberately absent: payroll_manager (payroll only), auditor,
        -- viewer, board_member.
      )
  );
$$;

comment on function public.can_write_business_data(uuid) is
  'True when the caller is an active member holding a role that may create/edit business data. Mirrors canWrite in src/hooks/usePermissions.ts — update both together when adding a role.';


create or replace function public.can_admin_business_data(p_business_id uuid)
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
      and bu.role::text in ('owner', 'admin')
  );
$$;

comment on function public.can_admin_business_data(uuid) is
  'True for owner/admin only. Mirrors canDelete in src/hooks/usePermissions.ts. Gate for hard DELETE and other destructive operations.';


revoke all on function public.is_business_member(uuid)      from public;
revoke all on function public.can_write_business_data(uuid) from public;
revoke all on function public.can_admin_business_data(uuid) from public;

grant execute on function public.is_business_member(uuid)      to authenticated, service_role;
grant execute on function public.can_write_business_data(uuid) to authenticated, service_role;
grant execute on function public.can_admin_business_data(uuid) to authenticated, service_role;


-- ── 2. Replace the stale policies ────────────────────────────────────────────
-- The existing policy names are not known from the repo (they were created
-- outside migrations and differ between environments), so drop whatever is
-- present on each table and rebuild a known, uniform set. Platform-admin read
-- is re-granted below so support tooling keeps working.

do $$
declare
  t text;
  p record;
begin
  foreach t in array array['contacts', 'branches', 'departments', 'inventory_locations']
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Table public.% not found, skipping.', t;
      continue;
    end if;

    for p in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy if exists %I on public.%I', p.policyname, t);
    end loop;

    execute format('alter table public.%I enable row level security', t);

    -- Read: any active member.
    execute format($f$
      create policy %I on public.%I
        for select using (public.is_business_member(business_id))
    $f$, t || '_member_read', t);

    -- Insert: any role with canWrite.
    execute format($f$
      create policy %I on public.%I
        for insert with check (public.can_write_business_data(business_id))
    $f$, t || '_writer_insert', t);

    -- Update: any role with canWrite. Covers the app's soft delete, which
    -- sets deleted_at via UPDATE. The WITH CHECK clause stops a row being
    -- moved to a business the caller cannot write to.
    execute format($f$
      create policy %I on public.%I
        for update using (public.can_write_business_data(business_id))
                  with check (public.can_write_business_data(business_id))
    $f$, t || '_writer_update', t);

    -- Hard delete: owner/admin only.
    execute format($f$
      create policy %I on public.%I
        for delete using (public.can_admin_business_data(business_id))
    $f$, t || '_admin_delete', t);

    -- Platform staff keep read access for support.
    execute format($f$
      create policy %I on public.%I
        for select using (public.is_platform_admin(auth.uid()))
    $f$, t || '_platform_admin_read', t);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;


comment on table public.contacts is
  'Customers and suppliers. RLS: read = any active member; insert/update = roles with canWrite (see can_write_business_data, mirrors usePermissions.ts); hard delete = owner/admin. Soft delete goes through UPDATE deleted_at and is available to writers.';
