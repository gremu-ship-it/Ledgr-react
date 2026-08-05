-- ============================================================================
-- Fix accounts RLS - close tenant-isolation gaps and role-expansion denies
--
-- THE BUG
-- -------
-- AccountsPage inserts via supabase.from('accounts').insert(...) and
-- frequently surfaced as:
--   TypeError: Failed to fetch
-- for roles added in 20260723000001 / 20260728000000 (supervisor,
-- data_entry, inventory_manager, etc).
--
-- Root cause is the same as the contacts bug fixed in 20260728000008:
-- the original policies on accounts were created directly on the database
-- before this migrations folder existed. They either:
--   a) hard-coded a role list that predates the 13 new roles, or
--   b) called user_has_role(business_id, 'accountant') which before
--      20260728000009 listed only the six original roles.
--
-- Even after 20260728000009 rewrote user_has_role, any remaining
-- hand-written list stayed stale. The UI's usePermissions said
-- canWrite: true for supervisor, so the Add Account button rendered,
-- but Postgres rejected the INSERT with:
--   new row violates row-level security policy for table "accounts"
--
-- THE FIX
-- -------
-- Rebuild accounts RLS on the same capability helpers used for contacts,
-- branches, departments, inventory_locations:
--   is_business_member(b)      - any active member, read tier
--   can_write_business_data(b) - roles with canWrite in usePermissions.ts
--   can_admin_business_data(b) - owner/admin, hard-delete tier
-- All three are SECURITY DEFINER, so they read business_users without
-- invoking RLS on that table (the nested-RLS bug that hid businesses in
-- 20260728000010).
--
-- Policies:
--   accounts_member_read         - SELECT using is_business_member
--   accounts_writer_insert       - INSERT with check can_write_business_data
--   accounts_writer_update       - UPDATE using/with check can_write_business_data
--   accounts_admin_delete        - DELETE using can_admin_business_data
--   accounts_platform_admin_read - SELECT using is_platform_admin (support)
--   accounts_partner_admin_read  - SELECT using is_partner_business_admin
--
-- Idempotent. Touches no data.
-- ============================================================================

-- Ensure helpers exist (they were created in 20260728000008/09, but guard for
-- environments that skipped a migration).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_business_member') THEN
    RAISE EXCEPTION 'Required helper is_business_member() missing - run 20260728000008 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_write_business_data') THEN
    RAISE EXCEPTION 'Required helper can_write_business_data() missing - run 20260728000008 first';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'can_admin_business_data') THEN
    RAISE EXCEPTION 'Required helper can_admin_business_data() missing - run 20260728000008 first';
  END IF;
END
$$;

-- Drop whatever policies are currently present - names differ between envs
DO $$
DECLARE
  p RECORD;
BEGIN
  IF to_regclass('public.accounts') IS NULL THEN
    RAISE NOTICE 'Table public.accounts not found, skipping.';
    RETURN;
  END IF;

  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'accounts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.accounts', p.policyname);
  END LOOP;

  EXECUTE 'ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY';

  -- Read: any active member of the business
  EXECUTE $f$
    CREATE POLICY accounts_member_read ON public.accounts
      FOR SELECT USING (public.is_business_member(business_id))
  $f$;

  -- Insert: any role that can write business data (mirrors usePermissions canWrite)
  EXECUTE $f$
    CREATE POLICY accounts_writer_insert ON public.accounts
      FOR INSERT WITH CHECK (public.can_write_business_data(business_id))
  $f$;

  -- Update: same tier - covers soft-delete via deleted_at and normal edits
  EXECUTE $f$
    CREATE POLICY accounts_writer_update ON public.accounts
      FOR UPDATE USING (public.can_write_business_data(business_id))
                WITH CHECK (public.can_write_business_data(business_id))
  $f$;

  -- Hard delete: owner/admin only
  EXECUTE $f$
    CREATE POLICY accounts_admin_delete ON public.accounts
      FOR DELETE USING (public.can_admin_business_data(business_id))
  $f$;

  -- Platform admin keeps read for support tooling
  EXECUTE $f$
    CREATE POLICY accounts_platform_admin_read ON public.accounts
      FOR SELECT USING (public.is_platform_admin(auth.uid()))
  $f$;

  -- White-label partner admin read, if helper exists
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_partner_business_admin') THEN
    EXECUTE $f$
      CREATE POLICY accounts_partner_admin_read ON public.accounts
        FOR SELECT USING (public.is_partner_business_admin(business_id))
    $f$;
  END IF;

  -- Grants
  EXECUTE 'REVOKE ALL ON public.accounts FROM anon';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounts TO authenticated';

END
$$;
