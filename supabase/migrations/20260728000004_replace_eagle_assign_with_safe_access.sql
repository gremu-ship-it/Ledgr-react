-- ============================================================================
-- Migration: Retire assign_user_to_eagle_businesses(), replace with a safe,
--            general-purpose set_user_business_access().
--
-- WHY THE OLD FUNCTION WAS DANGEROUS
-- ----------------------------------
-- 20260728000001 shipped assign_user_to_eagle_businesses() with four defects:
--
--   1. DATA LOSS BY DEFAULT. Step 3 ran an unconditional
--        UPDATE business_users SET is_active = false
--         WHERE user_id = <user> AND business_id NOT IN (<2 Eagle ids>)
--      Every membership outside the two hardcoded businesses was silently
--      deactivated. Run it against the wrong person and they are stripped to
--      zero visible businesses — which presents as "I can't log in", because
--      findMembershipsWithRole() returns nothing and the user never reaches a
--      dashboard.
--
--   2. PRIVILEGE ESCALATION. It was SECURITY DEFINER, took an arbitrary email,
--      and was granted to `authenticated`. Any logged-in user could rewrite any
--      other user's business access. (20260728000003 revoked the grant; this
--      migration removes the function outright.)
--
--   3. A BOGUS "BLOCKED BUSINESS". The constant
--      0cba121a-9245-4d64-b708-a3b8fa7f618e was documented and coded as a
--      business to revoke, but it is actually a USER id from auth.users. It
--      never matched a business_users.business_id, so step 2 was always a
--      no-op. The stated intent was never enforced.
--
--   4. NO SEARCH_PATH. A SECURITY DEFINER function without a pinned
--      search_path can be hijacked via a malicious schema earlier in the
--      caller's path.
--
-- Also fixed here: the old ON CONFLICT overwrote accepted_at handling and
-- hardcoded two tenant UUIDs into schema migrations, which does not belong in
-- version-controlled DDL.
-- ============================================================================


-- ── 1. Remove the unsafe function ───────────────────────────────────────────
-- Nothing in the application calls it (verified across src/, supabase/functions/
-- and server/). It was an operator tool only, so dropping it breaks no code.
DROP FUNCTION IF EXISTS public.assign_user_to_eagle_businesses(TEXT, TEXT);


-- ── 2. Safe, general-purpose replacement ────────────────────────────────────
-- Differences that matter:
--   * No hardcoded tenant UUIDs — you pass the business list in.
--   * p_revoke_others defaults to FALSE, so the destructive behaviour is
--     opt-in rather than the silent default.
--   * Even when opted in, it refuses to leave the user with zero visible
--     businesses, so it can never produce the "cannot log in" state.
--   * Validates every target business is live before changing anything.
--   * Pinned search_path, service_role only.
--   * Returns a per-business report instead of VOID.
CREATE OR REPLACE FUNCTION public.set_user_business_access(
  p_user_email_or_id TEXT,
  p_business_ids     UUID[],
  p_role             TEXT DEFAULT 'viewer',
  p_revoke_others    BOOLEAN DEFAULT false
)
RETURNS TABLE (
  out_business_id   UUID,
  out_business_name TEXT,
  out_role          TEXT,
  out_action        TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_role_enum   user_role;
  v_biz_id      UUID;
  v_invalid     UUID[];
  v_revoked     INT := 0;
BEGIN
  IF p_business_ids IS NULL OR array_length(p_business_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'p_business_ids must contain at least one business id.';
  END IF;

  -- Validate the role against the live enum, and list the real options on
  -- failure rather than the stale hardcoded list the old function printed.
  BEGIN
    v_role_enum := p_role::user_role;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid role "%". Valid roles: %',
      p_role,
      (SELECT string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder)
         FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
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

  -- Reject the whole call if ANY target business is missing/inactive/deleted.
  -- The app filters those out, so a membership pointing at one would be
  -- invisible and would look like the grant silently failed.
  SELECT array_agg(t.id) INTO v_invalid
    FROM unnest(p_business_ids) AS t(id)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.businesses b
      WHERE b.id = t.id AND b.is_active = true AND b.deleted_at IS NULL
   );

  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION
      'These business ids do not exist, are inactive, or are soft-deleted: %. '
      'No changes were made.', v_invalid;
  END IF;

  -- Grant/reactivate each target business first, so the revoke step below can
  -- never transiently leave the user with nothing.
  FOREACH v_biz_id IN ARRAY p_business_ids LOOP
    RETURN QUERY
    WITH prior AS (
      SELECT bu.id, bu.is_active
        FROM public.business_users bu
       WHERE bu.business_id = v_biz_id AND bu.user_id = v_user_id
    ),
    upsert AS (
      INSERT INTO public.business_users (
        business_id, user_id, role, is_active, accepted_at, created_at, updated_at
      )
      VALUES (v_biz_id, v_user_id, v_role_enum, true, now(), now(), now())
      ON CONFLICT (business_id, user_id) DO UPDATE
        SET role        = EXCLUDED.role,
            is_active   = true,
            -- Preserve the original acceptance timestamp; the old function
            -- left it untouched on conflict, so rows reactivated after an
            -- invite could keep a NULL accepted_at.
            accepted_at = COALESCE(business_users.accepted_at, now()),
            updated_at  = now()
      RETURNING business_id
    )
    SELECT
      v_biz_id,
      b.name::TEXT,
      p_role::TEXT,
      (CASE
         WHEN NOT EXISTS (SELECT 1 FROM prior)          THEN 'created'
         WHEN (SELECT p.is_active FROM prior p)         THEN 'updated'
         ELSE 'reactivated'
       END)::TEXT
    FROM upsert u
    JOIN public.businesses b ON b.id = u.business_id;
  END LOOP;

  -- Opt-in exclusivity. Only reachable once the grants above have succeeded.
  IF p_revoke_others THEN
    UPDATE public.business_users
       SET is_active = false, updated_at = now()
     WHERE user_id = v_user_id
       AND NOT (business_id = ANY (p_business_ids))
       AND is_active = true;
    GET DIAGNOSTICS v_revoked = ROW_COUNT;

    -- Belt and braces: verify the user still has somewhere to land. If not,
    -- abort the whole transaction rather than lock them out.
    IF NOT EXISTS (
      SELECT 1
        FROM public.business_users bu
        JOIN public.businesses b ON b.id = bu.business_id
       WHERE bu.user_id = v_user_id
         AND bu.is_active = true
         AND b.is_active = true
         AND b.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION
        'Aborted: revoking other memberships would leave user % with no '
        'visible business, locking them out of the app.', p_user_email_or_id;
    END IF;

    RAISE NOTICE 'Deactivated % other membership(s) for %.',
      v_revoked, p_user_email_or_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.set_user_business_access IS
  'Grants a user an active membership of one or more businesses with a single '
  'role. Additive by default; pass p_revoke_others => true for exclusive '
  'access, which still refuses to leave the user with zero businesses. '
  'Service role only. Example: '
  'select * from set_user_business_access(''user@example.com'', '
  'array[''b15238b7-2b36-4761-bc73-cf7e87a925bb'']::uuid[], ''supervisor'');';

REVOKE ALL ON FUNCTION public.set_user_business_access(TEXT, UUID[], TEXT, BOOLEAN) FROM public;
REVOKE ALL ON FUNCTION public.set_user_business_access(TEXT, UUID[], TEXT, BOOLEAN) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_business_access(TEXT, UUID[], TEXT, BOOLEAN) TO service_role;
