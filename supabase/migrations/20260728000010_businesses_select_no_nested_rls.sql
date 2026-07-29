-- ============================================================================
-- businesses: read via a SECURITY DEFINER membership check, not a nested
--             subquery; drop the duplicate SELECT policy; let admins update.
--
-- THE BUG
-- -------
--   businesses with id "d38e4ce8-..." was not found.
-- for a supervisor whose membership row was present, active and correct, on a
-- business that was live (is_active = true, deleted_at null).
--
-- The businesses SELECT policy is a plain membership test:
--
--   EXISTS (SELECT 1 FROM business_users
--            WHERE business_id = businesses.id
--              AND user_id = auth.uid()
--              AND is_active = true)
--
-- Nothing about it excludes a supervisor. The failure came one level down: a
-- subquery inside an RLS policy is itself subject to RLS on the table it
-- reads. That subquery reads business_users, whose own SELECT policy is
--
--   bu_select: user_has_role(business_id, 'viewer')
--
-- and before 20260728000009 the 'viewer' tier listed only the six original
-- roles. For a supervisor it returned false, so business_users exposed no
-- rows, so EXISTS(...) was false, so the businesses row was invisible.
-- BusinessRepository.findById() uses .maybeSingle(), which reports invisible
-- rows as null rather than as an error, and the null became "was not found".
--
-- Two RLS layers had to be read together to see it, which is exactly the
-- failure mode worth designing out.
--
-- 20260728000009 already fixes the underlying cause: the 'viewer' tier now
-- resolves to is_business_member(), which is SECURITY DEFINER and therefore
-- reads business_users without RLS. This migration removes the dependency
-- altogether so the businesses policy cannot be broken again by an unrelated
-- change to business_users.
--
-- WHAT CHANGES
-- ------------
-- 1. Both member SELECT policies are replaced by one that calls
--    is_business_member(id) directly. Same rule, evaluated in a SECURITY
--    DEFINER context, so no nested RLS and no dependence on the tier ladder.
--
--    There were two byte-identical member SELECT policies —
--    "Members can read their businesses" and businesses_select. Policies are
--    OR'd, so the duplicate was harmless but doubled the subquery work on
--    every read of the table.
--
-- 2. businesses_update required role = 'owner' exactly, so an admin could not
--    save business settings even though usePermissions.ts grants admin
--    canWrite and the Settings UI offers the form. That is the same
--    UI-says-yes / database-says-no split as the original bug, so it is
--    corrected here to can_admin_business_data() (owner + admin). Ownership
--    transfer and deletion stay owner-only.
--
-- Partner and platform admin read policies are recreated unchanged.
--
-- Idempotent. Touches no data.
-- ============================================================================


-- ── 1. Member read, without the nested subquery ──────────────────────────────

drop policy if exists "Members can read their businesses" on public.businesses;
drop policy if exists businesses_select                   on public.businesses;

create policy businesses_member_read on public.businesses
  for select using (public.is_business_member(id));

comment on policy businesses_member_read on public.businesses is
  'Active members can read their own business. Uses is_business_member() (SECURITY DEFINER) rather than an inline EXISTS over business_users: an inline subquery is subject to RLS on business_users, which made this policy fail for any role the business_users policy did not admit. Replaces the duplicate pair "Members can read their businesses" / businesses_select.';


-- ── 2. Owner + admin may update the business record ──────────────────────────
-- Was owner-only, which blocked admins from saving Settings.

drop policy if exists businesses_update on public.businesses;

create policy businesses_update on public.businesses
  for update using      (public.can_admin_business_data(id))
              with check (public.can_admin_business_data(id));

comment on policy businesses_update on public.businesses is
  'Owner and admin may edit the business record, matching canWrite/canManageUsers for those roles in src/hooks/usePermissions.ts. Previously owner-only, which silently blocked admins from saving Settings. Deletion remains owner-only via businesses_delete.';


-- ── 3. Recreate the remaining read paths unchanged ───────────────────────────
-- Listed explicitly so the full SELECT surface of this table is visible in one
-- place in version control, rather than spread across four migrations.

drop policy if exists businesses_platform_admin_read on public.businesses;
create policy businesses_platform_admin_read on public.businesses
  for select using (public.is_platform_admin(auth.uid()));

drop policy if exists businesses_partner_admin_read on public.businesses;
create policy businesses_partner_admin_read on public.businesses
  for select using (public.is_partner_business_admin(id));

drop policy if exists businesses_partner_peer_read on public.businesses;
create policy businesses_partner_peer_read on public.businesses
  for select using (public.can_read_partner_peer_business(id));


-- ── 4. Sanity check ──────────────────────────────────────────────────────────
-- Fails loudly at migration time if the SELECT surface is not what is intended,
-- rather than leaving a tenant-visibility change to be discovered later.

do $$
declare
  n_select integer;
begin
  select count(*) into n_select
  from pg_policies
  where schemaname = 'public'
    and tablename  = 'businesses'
    and cmd = 'SELECT';

  if n_select <> 4 then
    raise exception
      'Expected 4 SELECT policies on public.businesses (member, platform admin, partner admin, partner peer), found %.',
      n_select;
  end if;
end
$$;
