-- ============================================================================
-- Diagnostic: businesses with id "<uuid>" was not found.
--
-- HOW TO RUN
-- ----------
-- Paste a section into the Supabase SQL Editor. Replace the two literals in
-- section 0 if you are chasing a different business/user.
--
-- WHY THE MESSAGE LIES
-- --------------------
-- BusinessRepository.findById() uses .maybeSingle():
--     if (error) throw toRepositoryError(...)
--     if (!data) throw new NotFoundError('businesses', id)
-- Under RLS a row the caller may not read is NOT an error — it is zero rows.
-- So "not found" covers three different situations:
--     (a) the row genuinely does not exist
--     (b) the row exists but deleted_at is set   (findById filters it)
--     (c) the row exists and is live, but no SELECT policy admits the caller
-- Membership has already been confirmed active for this case, so (c) is the
-- remaining candidate: the businesses SELECT policy itself.
-- ============================================================================


-- ── 0. Parameters ────────────────────────────────────────────────────────────
-- (Inlined as literals below; edit both if reusing this script.)
--   business: d38e4ce8-324b-4d27-b42d-74c25c5288a7
--   user:     655ad01b-ea0c-45fb-8387-c30f5b0ab12d  (supervisor)


-- ── 1. Does the row exist, and is it live? ───────────────────────────────────
-- deleted_at NOT NULL, or is_active = false, explains the failure on its own:
-- findById() filters deleted_at, and findMembershipsWithRole() additionally
-- requires businesses.is_active = true.

select
  id,
  name,
  is_active,
  deleted_at,
  case
    when deleted_at is not null then 'SOFT-DELETED - findById filters this out'
    when is_active = false      then 'INACTIVE - excluded from the business switcher'
    else 'live - look at the policies in section 2'
  end as verdict
from public.businesses
where id = 'd38e4ce8-324b-4d27-b42d-74c25c5288a7';


-- ── 2. THE ANSWER: what SELECT policies guard businesses? ────────────────────
-- Policies are OR'd, so the caller needs only one to pass. Read the qual of
-- each and check whether a plain member (not owner/admin, not platform admin,
-- not partner admin) can satisfy any of them.

select
  policyname,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'businesses'
order by cmd, policyname;


-- ── 3. Is RLS even on, and is there a member-scoped SELECT policy? ───────────

select
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'businesses') as total_policies,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'businesses'
      and p.cmd in ('SELECT', 'ALL')) as select_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'businesses';


-- ── 4. Simulate the supervisor's read ────────────────────────────────────────
-- Runs the exact query findById() issues, as that user, with RLS enforced.
-- Zero rows here reproduces the bug and confirms it is a policy problem.
-- The transaction is rolled back; nothing is written.

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"655ad01b-ea0c-45fb-8387-c30f5b0ab12d","role":"authenticated"}';

  select
    id,
    name,
    'VISIBLE to the supervisor' as result
  from public.businesses
  where id = 'd38e4ce8-324b-4d27-b42d-74c25c5288a7'
    and deleted_at is null;

  -- Which tier does the caller clear? After 20260728000009 these should be
  -- true / true / false for a supervisor. Before it, all three are false.
  select
    public.is_business_member     ('d38e4ce8-324b-4d27-b42d-74c25c5288a7') as is_member,
    public.can_write_business_data('d38e4ce8-324b-4d27-b42d-74c25c5288a7') as can_write,
    public.can_admin_business_data('d38e4ce8-324b-4d27-b42d-74c25c5288a7') as can_admin;
rollback;


-- ── 5. Has 20260728000008 / 000009 actually been applied? ────────────────────
-- If these functions are absent, the migrations have not been pushed and the
-- old six-role ladder is still in force — which by itself denies a supervisor
-- every tier, including 'viewer'.

select
  p.proname as function_name,
  'present' as status
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'is_business_member',
    'can_write_business_data',
    'can_admin_business_data',
    'can_view_payroll',
    'can_write_payroll',
    'can_read_audit'
  )
order by p.proname;

select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 6;


-- ── 6. Compare against the owner ─────────────────────────────────────────────
-- If the owner sees the row and the supervisor does not, the policy is
-- role-gated rather than the row being absent.

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"487334df-a057-45c3-b088-85e6c0a6aeb3","role":"authenticated"}';

  select id, name, 'VISIBLE to the owner' as result
  from public.businesses
  where id = 'd38e4ce8-324b-4d27-b42d-74c25c5288a7'
    and deleted_at is null;
rollback;
