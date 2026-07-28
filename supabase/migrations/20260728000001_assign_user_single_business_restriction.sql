-- ============================================================================
-- ⚠️  SUPERSEDED — DO NOT USE / DO NOT COPY THIS PATTERN
--
-- The function created below, assign_user_to_eagle_businesses(), is DROPPED by
-- migration 20260728000004_replace_eagle_assign_with_safe_access.sql. Use
-- public.set_user_business_access() instead.
--
-- This file is retained only because it has already been applied to live
-- environments; migrations are append-only, so it is fixed forward rather than
-- rewritten. Reasons it was retired:
--   1. Step 3 deactivated EVERY membership outside the two hardcoded Eagle
--      businesses, which could strip a user to zero businesses and lock them
--      out of the app entirely.
--   2. SECURITY DEFINER + arbitrary email + GRANT to `authenticated` let any
--      logged-in user rewrite any other user's access.
--   3. The "blocked business" constant 0cba121a-9245-4d64-b708-a3b8fa7f618e is
--      actually a USER id, so step 2 never matched anything.
--   4. No pinned search_path on a SECURITY DEFINER function.
-- ============================================================================

-- ============================================================================
-- Migration: Assign User to Eagle Nurseries and Eagle Nova Horizon Holdings Ltd. Co.
-- Restrictions:
--   - Assigned businesses:
--       1) Eagle Nurseries: 'b15238b7-2b36-4761-bc73-cf7e87a925bb'
--       2) Eagle Nova Horizon Holdings Ltd. Co.: '93851ac2-73ac-4241-b462-ec8d9d663f8b'
--   - Blocked business:
--       '0cba121a-9245-4d64-b708-a3b8fa7f618e'
-- ============================================================================

-- Function to assign a user to Eagle Nurseries and Eagle Nova Horizon Holdings Ltd. Co.,
-- while revoking access to 0cba121a-9245-4d64-b708-a3b8fa7f618e and all other businesses.
-- p_role is TEXT (e.g. 'supervisor', 'admin', 'viewer') to avoid PostgreSQL enum signature mismatch errors.
CREATE OR REPLACE FUNCTION assign_user_to_eagle_businesses(
  p_user_email_or_id TEXT,
  p_role TEXT DEFAULT 'viewer'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id            UUID;
  v_role_enum          user_role;
  v_eagle_nurseries_id CONSTANT UUID := 'b15238b7-2b36-4761-bc73-cf7e87a925bb'::UUID;
  v_eagle_nova_id      CONSTANT UUID := '93851ac2-73ac-4241-b462-ec8d9d663f8b'::UUID;
  v_blocked_biz_id     CONSTANT UUID := '0cba121a-9245-4d64-b708-a3b8fa7f618e'::UUID;
BEGIN
  -- Cast p_role TEXT to user_role ENUM safely
  BEGIN
    v_role_enum := p_role::user_role;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid role "%". Supported roles: owner, admin, supervisor, accountant, viewer, etc.', p_role;
  END;

  -- 1. Resolve user ID from auth.users (supports UUID string or email)
  IF p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_user_id FROM auth.users WHERE id = p_user_email_or_id::UUID;
  ELSE
    SELECT id INTO v_user_id FROM auth.users WHERE LOWER(email) = LOWER(TRIM(p_user_email_or_id));
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User "%" was not found in auth.users.', p_user_email_or_id;
  END IF;

  -- 2. Explicitly revoke/deactivate access to business 0cba121a-9245-4d64-b708-a3b8fa7f618e
  UPDATE public.business_users
  SET is_active = false, updated_at = now()
  WHERE user_id = v_user_id AND business_id = v_blocked_biz_id;

  -- 3. Deactivate any other business memberships outside the two designated Eagle businesses
  UPDATE public.business_users
  SET is_active = false, updated_at = now()
  WHERE user_id = v_user_id 
    AND business_id NOT IN (v_eagle_nurseries_id, v_eagle_nova_id);

  -- 4. Assign user to Eagle Nurseries (b15238b7-2b36-4761-bc73-cf7e87a925bb)
  INSERT INTO public.business_users (
    business_id, user_id, role, is_active, accepted_at, created_at, updated_at
  )
  VALUES (
    v_eagle_nurseries_id, v_user_id, v_role_enum, true, now(), now(), now()
  )
  ON CONFLICT (business_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    updated_at = now();

  -- 5. Assign user to Eagle Nova Horizon Holdings Ltd. Co. (93851ac2-73ac-4241-b462-ec8d9d663f8b)
  INSERT INTO public.business_users (
    business_id, user_id, role, is_active, accepted_at, created_at, updated_at
  )
  VALUES (
    v_eagle_nova_id, v_user_id, v_role_enum, true, now(), now(), now()
  )
  ON CONFLICT (business_id, user_id)
  DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    updated_at = now();

  RAISE NOTICE 'Successfully assigned user % (id %) to Eagle Nurseries and Eagle Nova Horizon Holdings Ltd. Co. with role %, and blocked business 0cba121a-9245-4d64-b708-a3b8fa7f618e.',
    p_user_email_or_id, v_user_id, p_role;
END;
$$;

GRANT EXECUTE ON FUNCTION assign_user_to_eagle_businesses(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION assign_user_to_eagle_businesses(TEXT, TEXT) TO authenticated;
