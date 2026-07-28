-- ============================================================================
-- Grant peacemalamula@gmail.com supervisor access to the two Eagle businesses.
--
-- HOW TO RUN
--   Supabase Dashboard > SQL Editor > New query > paste this file > Run.
--   (The SQL editor runs as service role, which is what these functions need.)
--
-- PREREQUISITE
--   Migrations 20260728000003 and 20260728000004 must be applied first, since
--   they define diagnose_user_login() and set_user_business_access(). Apply via
--   `supabase db push`, or paste those two migrations into the SQL editor and
--   run them once.
--
-- This script is idempotent — safe to run more than once.
-- ============================================================================


-- ── 1. BEFORE: why is he locked out? ────────────────────────────────────────
-- Look at the 'visible_memberships' row. If it says 0 of N are visible, that
-- is the login failure: he authenticates fine, then has no business to enter.
select * from diagnose_user_login('peacemalamula@gmail.com');


-- ── 2. Grant supervisor on both Eagle businesses ────────────────────────────
-- Additive: this does NOT touch any other membership he may have.
-- If you want him restricted to ONLY these two, add  p_revoke_others => true
-- (that variant still refuses to leave him with zero businesses).
select * from set_user_business_access(
  'peacemalamula@gmail.com',
  array[
    'b15238b7-2b36-4761-bc73-cf7e87a925bb',  -- Eagle Nurseries
    '93851ac2-73ac-4241-b462-ec8d9d663f8b'   -- Eagle Nova Horizon Holdings Ltd. Co.
  ]::uuid[],
  'supervisor'
);


-- ── 3. Make sure his email is confirmed ─────────────────────────────────────
-- Dashboard-created users are only auto-confirmed if "Auto Confirm User" was
-- ticked. Without this, signInWithPassword returns "Email not confirmed" and
-- the app shows "Your email address is not yet verified" — a real login block,
-- separate from the membership problem above. No-op if already confirmed.
update auth.users
   set email_confirmed_at = coalesce(email_confirmed_at, now())
 where lower(email) = 'peacemalamula@gmail.com';


-- ── 4. AFTER: confirm the fix ───────────────────────────────────────────────
-- Expect: email_confirmed = OK, and visible_memberships = 2 of 2, listing
-- Eagle Nurseries and Eagle Nova, both role=supervisor, both status OK.
select * from diagnose_user_login('peacemalamula@gmail.com');


-- ============================================================================
-- WHAT HE SHOULD SEE AFTER THIS
--   - Signs in and lands on /dashboard (supervisor's home path).
--   - A business switcher in the header with both Eagle businesses; the first
--     one is auto-selected.
--   - Supervisor can read, create and edit records and export, but cannot
--     delete, manage users, or manage billing. /payroll and /reports are
--     hidden and redirect to /dashboard. That is by design in
--     src/hooks/usePermissions.ts — if he needs reports, use a role such as
--     'admin' or 'board_member' instead, or adjust the supervisor rules.
--
-- NOTE ON THE OTHER MIGRATION
--   20260728000001's assign_user_to_eagle_businesses() is now DROPPED by
--   migration 20260728000004. It hardcoded
--   0cba121a-9245-4d64-b708-a3b8fa7f618e as a "blocked business" when that
--   UUID is actually this user's auth ID, and it deactivated every membership
--   outside the two Eagle businesses. set_user_business_access() used above is
--   its safe replacement: additive by default, and it will not leave anyone
--   with zero businesses.
-- ============================================================================
