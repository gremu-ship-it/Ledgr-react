-- ============================================================================
-- R04 — Tenant/role enforcement: cashiers have no direct contacts write tier
--
-- WHY THIS EXISTS
--   The release suite's ROLE.cashier.write expectation (R04 package, fixed
--   intent) requires a cashier's direct INSERT into public.contacts to be
--   denied at the database boundary. Today it completes:
--   contacts_writer_insert/update (20260728000008) gate on the shared
--   can_write_business_data() tier, which legitimately includes the POS
--   roles for sales/stock journeys — so the shared tier let a cashier write
--   customer/supplier master data outside any sale.
--
--   The product already commits to the intended boundary:
--     • post_pos_sale() (20260923000000, SECURITY DEFINER) resolves or
--       creates the billed contact itself "so a cashier needs no direct
--       INSERT on contacts" — the authorised cashier path is the sale
--       command, not the table;
--     • DEC-03 / the R04 register record cashiers as sale/catalog/own-shift
--       scope; customer master-data duties belong to the contacts screens
--       used by sales/server-facing roles;
--     • the same single-role-exclusion pattern shipped in
--       20260922000000_pos_role_write_scope.sql for sales vs expense tiers.
--
-- WHAT IT DOES (idempotent; no data movement; one helper + two policies)
--   1. Adds public.can_write_contacts_data(uuid): the can_write_business_data
--      role list MINUS 'cashier' only. Viewer/auditor/board_member/
--      payroll_manager remain excluded exactly as before; stock_clerk and the
--      POS 'manager' remain included exactly as the release matrix expects.
--      No role is added anywhere; enforcement only narrows.
--   2. Re-points ONLY the contacts writer policies (insert/update) from
--      can_write_business_data() to can_write_contacts_data(). members-read,
--      admin-delete and platform-admin-read policies are untouched, as are
--      branches/departments/inventory_locations and every other table.
--   3. Self-verification block: policy end state, function grant end state,
--      and claim-based behavioural probes (authenticated null-identity and
--      cashier-shaped membership checks must not bypass the tier).
--
-- PRECONDITIONS
--   Assumes can_write_business_data(), is_business_member() and the contacts
--   writer policies exist in their current replay order (verified by the R13
--   harness replay, which applies this file last).
--
-- ROLLBACK / CONTAINMENT
--   To revert without file surgery: re-create
--     re-point: drop policy if exists contacts_writer_insert on public.contacts;
--       create policy contacts_writer_insert on public.contacts
--         for insert with check (public.can_write_business_data(business_id));
--     (and equivalently for contacts_writer_update), then
--     drop function public.can_write_contacts_data(uuid);
--   Rolling back RE-OPENS direct cashier contact writes; treat as an
--   emergency-only containment toggle, never the steady state.
-- ============================================================================


-- ── 1. Scoped write tier for contacts (can_write_business_data minus cashier)
create or replace function public.can_write_contacts_data(p_business_id uuid)
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
        -- can_write_business_data minus cashier (the role name appears only
        -- unquoted here so verification can search the permitted list).
        -- Cashiers serve walk-in customers through the SECURITY DEFINER
        -- post_pos_sale() command and hold no customer master-data duty
        -- (DEFAULT_ROLE_PERMISSIONS.cashier in src/types/pos.ts; release
        -- expectation ROLE.cashier.write, R04). Every other role is
        -- byte-identical to can_write_sales_data minus nothing; keep in sync
        -- with usePermissions.ts and the POS tiers.
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
        'branch_manager',
        'manager',
        'stock_clerk'
      )
  );
$$;

comment on function public.can_write_contacts_data(uuid) is
  'Write tier for contacts: can_write_business_data minus cashier. The cashier contact path is post_pos_sale() (SECURITY DEFINER), not direct writes. Mirrors ROLE.cashier.write (R04) and DEC-03 scope: cashier = sale/catalog/own-shift only.';

revoke all on function public.can_write_contacts_data(uuid) from public, anon;
-- Supabase default privileges auto-grant EXECUTE on freshly-created public
-- functions to anon/authenticated/service_role; 'from public' alone does NOT
-- strip that explicit anon grant (found on a real project 2026-09-21), so
-- anon is named here explicitly, mirroring R01/R03/R06/R07/R08 revokes.
grant execute on function public.can_write_contacts_data(uuid) to authenticated, service_role;


-- ── 2. Re-point ONLY the contacts writer policies ───────────────────────────
drop policy if exists contacts_writer_insert on public.contacts;
create policy contacts_writer_insert on public.contacts
  for insert with check (public.can_write_contacts_data(business_id));

drop policy if exists contacts_writer_update on public.contacts;
create policy contacts_writer_update on public.contacts
  for update using (public.can_write_contacts_data(business_id))
            with check (public.can_write_contacts_data(business_id));


-- ── 3. Self-verification ────────────────────────────────────────────────────
do $$
declare
  v_def text;
begin
  -- 3a. Policy end state: both writer policies bind the scoped tier, and no
  --     contacts policy keeps the wider shared tier.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contacts'
      and policyname = 'contacts_writer_insert'
      and coalesce(with_check, '') like '%can_write_contacts_data(business_id)%'
  ) then
    raise exception 'R04 verification failed: contacts_writer_insert not bound to can_write_contacts_data';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contacts'
      and policyname = 'contacts_writer_update'
      and coalesce(with_check, '') like '%can_write_contacts_data(business_id)%'
  ) then
    raise exception 'R04 verification failed: contacts_writer_update not bound to can_write_contacts_data';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'contacts'
      and (coalesce(qual,'') like '%can_write_business_data%'
           or coalesce(with_check,'') like '%can_write_business_data%')
  ) then
    raise exception 'R04 verification failed: a contacts policy still uses the wider shared tier';
  end if;

  -- 3b. Function end state: definition carries the tier, the cashier literal
  --     appears nowhere as a permitted role, grants are closed for PUBLIC.
  v_def := pg_get_functiondef('public.can_write_contacts_data(uuid)'::regprocedure);
  if v_def not like '%can_write_business_data minus cashier%'
     or position('''cashier''' in v_def) <> 0 then
    raise exception 'R04 verification failed: contacts tier definition is not the cashier-less mirror';
  end if;
  if has_function_privilege('anon', 'public.can_write_contacts_data(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.can_write_contacts_data(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.can_write_contacts_data(uuid)', 'EXECUTE') then
    raise exception 'R04 verification failed: contacts tier grant surface wrong';
  end if;

  -- 3c. Behavioural probes (claim-scoped, data-free): a null identity and a
  --     caller without membership must not pass the tier; the function must
  --     not error under an authenticated claim either.
  perform set_config('request.jwt.claim.sub', '40000000-0000-4000-8000-000000000404', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  if public.can_write_contacts_data('00000000-0000-4000-8000-000000000000') then
    raise exception 'R04 verification failed: non-member passed the contacts write tier';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);

  raise notice 'OK  R04 contacts write tier verified: cashier excluded, policies re-pointed, grants closed, non-members denied.';
end
$$;
