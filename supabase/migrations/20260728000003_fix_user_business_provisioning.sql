-- ============================================================================
-- Migration: Fix user -> business provisioning so manually-added users can log in
--
-- Background
-- ----------
-- Users added directly through the Supabase dashboard (Authentication > Users)
-- get an `auth.users` row and nothing else. The app, however, needs TWO more
-- things before the user can get past the login screen:
--
--   1. `public.user_profiles`  — read by BusinessRepository.findUserProfile()
--   2. `public.business_users` — read by BusinessRepository.findMembershipsWithRole()
--                                with is_active = true, joined to a business
--                                that is itself is_active = true AND
--                                deleted_at IS NULL
--
-- If (2) returns zero rows the client store ends up with `businesses: []`, and
-- ProtectedRoute bounces the user to /create-business forever. To the user this
-- is indistinguishable from "I can't log in".
--
-- This migration:
--   a) Closes a privilege-escalation hole in assign_user_to_eagle_businesses().
--   b) Adds a safe, generic, idempotent grant_user_business_access() helper.
--   c) Adds diagnose_user_login() so you can see exactly why a given user is
--      being locked out, without guessing.
-- ============================================================================


-- ── (a) Harden the previous migration's function ────────────────────────────
-- 20260728000001 granted EXECUTE on a SECURITY DEFINER function to
-- `authenticated`. That let ANY logged-in user reassign ANY other user's
-- business memberships by email. Service role only from here on.
REVOKE EXECUTE ON FUNCTION public.assign_user_to_eagle_businesses(TEXT, TEXT)
  FROM authenticated;


-- ── (b) Generic, non-destructive access grant ───────────────────────────────
-- Unlike assign_user_to_eagle_businesses(), this NEVER deactivates a user's
-- other memberships. It only ever adds/reactivates the one you name, so it
-- cannot accidentally strip someone down to zero businesses.
CREATE OR REPLACE FUNCTION public.grant_user_business_access(
  p_user_email_or_id TEXT,
  p_business_id      UUID,
  p_role             TEXT DEFAULT 'viewer'
)
RETURNS TABLE (
  out_user_id     UUID,
  out_business_id UUID,
  out_role        TEXT,
  out_action      TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   UUID;
  v_role_enum user_role;
  v_existing  RECORD;
  v_action    TEXT;
BEGIN
  -- Validate the role against the live enum.
  BEGIN
    v_role_enum := p_role::user_role;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION
      'Invalid role "%". Valid roles: %',
      p_role,
      (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
         FROM pg_enum e
         JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'user_role');
  END;

  -- Resolve the user by UUID or email.
  IF p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_user_id FROM auth.users WHERE id = p_user_email_or_id::UUID;
  ELSE
    SELECT id INTO v_user_id FROM auth.users
     WHERE LOWER(email) = LOWER(TRIM(p_user_email_or_id));
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User "%" was not found in auth.users.', p_user_email_or_id;
  END IF;

  -- The business must exist and be live, otherwise the app's !inner join
  -- silently drops the membership and the user still sees nothing.
  IF NOT EXISTS (
    SELECT 1 FROM public.businesses
     WHERE id = p_business_id AND is_active = true AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION
      'Business % does not exist, is inactive, or is soft-deleted. '
      'The app filters these out, so the membership would be invisible.',
      p_business_id;
  END IF;

  -- Ensure a user_profiles row exists. findUserProfile() uses maybeSingle()
  -- so a missing row is not fatal, but the profile drives display name and
  -- preferred_language, and several RLS helpers read from this table.
  INSERT INTO public.user_profiles (id)
  VALUES (v_user_id)
  ON CONFLICT (id) DO NOTHING;

  SELECT id, is_active, role INTO v_existing
    FROM public.business_users
   WHERE business_id = p_business_id AND user_id = v_user_id;

  IF v_existing.id IS NULL THEN
    v_action := 'created';
  ELSIF v_existing.is_active THEN
    v_action := 'updated';
  ELSE
    v_action := 'reactivated';
  END IF;

  INSERT INTO public.business_users (
    business_id, user_id, role, is_active, accepted_at, created_at, updated_at
  )
  VALUES (
    p_business_id, v_user_id, v_role_enum, true, now(), now(), now()
  )
  -- NB: the conflicting row is referenced by the bare table name here.
  -- Schema-qualifying it ("public.business_users.accepted_at") is rejected by
  -- Postgres with "invalid reference to FROM-clause entry".
  ON CONFLICT (business_id, user_id) DO UPDATE
    SET role        = EXCLUDED.role,
        is_active   = true,
        accepted_at = COALESCE(business_users.accepted_at, now()),
        updated_at  = now();

  RETURN QUERY SELECT v_user_id, p_business_id, p_role, v_action;
END;
$$;

COMMENT ON FUNCTION public.grant_user_business_access IS
  'Idempotently gives a user an active membership of one business with a role. '
  'Never deactivates other memberships. Service role only — run from the '
  'Supabase SQL editor. Example: '
  'select * from grant_user_business_access(''peacemalamula@gmail.com'', ''<business-uuid>'', ''supervisor'');';

REVOKE ALL ON FUNCTION public.grant_user_business_access(TEXT, UUID, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.grant_user_business_access(TEXT, UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.grant_user_business_access(TEXT, UUID, TEXT) TO service_role;


-- ── (c) Diagnostics: why can't this user get in? ────────────────────────────
-- Mirrors exactly what BusinessRepository.findMembershipsWithRole() does, so
-- what you see here is what the app sees.
CREATE OR REPLACE FUNCTION public.diagnose_user_login(
  p_user_email_or_id TEXT
)
RETURNS TABLE (
  check_name TEXT,
  status     TEXT,
  detail     TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id       UUID;
  v_email         TEXT;
  v_confirmed_at  TIMESTAMPTZ;
  v_banned_until  TIMESTAMPTZ;
  v_visible_count INT;
  v_total_count   INT;
BEGIN
  IF p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id, email, email_confirmed_at, banned_until
      INTO v_user_id, v_email, v_confirmed_at, v_banned_until
      FROM auth.users WHERE id = p_user_email_or_id::UUID;
  ELSE
    SELECT id, email, email_confirmed_at, banned_until
      INTO v_user_id, v_email, v_confirmed_at, v_banned_until
      FROM auth.users WHERE LOWER(email) = LOWER(TRIM(p_user_email_or_id));
  END IF;

  IF v_user_id IS NULL THEN
    RETURN QUERY SELECT
      'auth.users'::TEXT, 'FAIL'::TEXT,
      format('No user matches "%s".', p_user_email_or_id);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    'auth.users'::TEXT, 'OK'::TEXT,
    format('Found %s (%s).', v_email, v_user_id);

  -- Supabase rejects signInWithPassword with "Email not confirmed" when a
  -- dashboard-created user was never marked confirmed.
  RETURN QUERY SELECT
    'email_confirmed'::TEXT,
    CASE WHEN v_confirmed_at IS NOT NULL THEN 'OK' ELSE 'FAIL' END,
    CASE WHEN v_confirmed_at IS NOT NULL
         THEN format('Confirmed at %s.', v_confirmed_at)
         ELSE 'NOT confirmed — login fails with "Email not confirmed". '
              'Tick "Auto Confirm User" in the dashboard, or run: '
              'update auth.users set email_confirmed_at = now() where id = ''' || v_user_id || ''';'
    END;

  RETURN QUERY SELECT
    'not_banned'::TEXT,
    CASE WHEN v_banned_until IS NULL OR v_banned_until < now() THEN 'OK' ELSE 'FAIL' END,
    COALESCE('Banned until ' || v_banned_until, 'Not banned.');

  RETURN QUERY SELECT
    'user_profiles'::TEXT,
    CASE WHEN EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user_id)
         THEN 'OK' ELSE 'WARN' END,
    CASE WHEN EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_user_id)
         THEN 'Profile row present.'
         ELSE 'No user_profiles row. Not fatal, but name/language/admin flags '
              'will be empty. grant_user_business_access() creates one.'
    END;

  SELECT count(*) INTO v_total_count
    FROM public.business_users WHERE user_id = v_user_id;

  -- This predicate is the exact one the app uses.
  SELECT count(*) INTO v_visible_count
    FROM public.business_users bu
    JOIN public.businesses b ON b.id = bu.business_id
   WHERE bu.user_id = v_user_id
     AND bu.is_active = true
     AND b.is_active = true
     AND b.deleted_at IS NULL;

  RETURN QUERY SELECT
    'visible_memberships'::TEXT,
    CASE WHEN v_visible_count > 0 THEN 'OK' ELSE 'FAIL' END,
    format(
      '%s of %s membership row(s) are visible to the app. %s',
      v_visible_count, v_total_count,
      CASE WHEN v_visible_count = 0
           THEN 'User signs in but is redirected to /create-business. '
                'Fix with grant_user_business_access().'
           ELSE '' END
    );

  RETURN QUERY
    SELECT
      'membership'::TEXT,
      CASE WHEN bu.is_active AND b.is_active AND b.deleted_at IS NULL
           THEN 'OK' ELSE 'HIDDEN' END,
      format(
        'business=%s (%s) role=%s bu.is_active=%s b.is_active=%s b.deleted_at=%s',
        b.name, b.id, bu.role, bu.is_active, b.is_active,
        COALESCE(b.deleted_at::TEXT, 'null')
      )
    FROM public.business_users bu
    JOIN public.businesses b ON b.id = bu.business_id
   WHERE bu.user_id = v_user_id;
END;
$$;

COMMENT ON FUNCTION public.diagnose_user_login IS
  'Reports every reason a given user might be unable to reach the dashboard. '
  'Run as service role: select * from diagnose_user_login(''user@example.com'');';

REVOKE ALL ON FUNCTION public.diagnose_user_login(TEXT) FROM public;
REVOKE ALL ON FUNCTION public.diagnose_user_login(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_user_login(TEXT) TO service_role;
