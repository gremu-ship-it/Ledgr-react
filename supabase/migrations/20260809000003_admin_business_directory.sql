-- ─────────────────────────────────────────────────────────────────────────
-- Platform-admin businesses directory + operator grant
-- ─────────────────────────────────────────────────────────────────────────
-- Two related pieces:
--
-- 1. Grant platform-admin to Gremu Consultancy's account (operator request).
--    `user_profiles.is_platform_admin` is what PlatformAdminRoute /
--    is_platform_admin() check, so this makes /admin/* reachable for that
--    user. Full_name is only used if the profile row doesn't exist yet; an
--    existing profile keeps its own name (ON CONFLICT only sets the flag).
--
-- 2. list_all_businesses() — a SECURITY DEFINER function that returns every
--    business plus its owner(s). A platform admin CAN read businesses
--    (businesses_platform_admin_read, added in 20260726000004) but cannot
--    read business_users / auth.users cross-tenant, so a normal client
--    query cannot resolve owners. This function runs as the owner (bypassing
--    RLS), checks the caller is a platform admin via auth.uid() *inside* the
--    function, and joins owner memberships to emails/names.

-- ── 1. Grant platform admin to Gremu Consultancy (operator-specified user) ─
insert into public.user_profiles (id, full_name, is_platform_admin)
select '655ad01b-ea0c-45fb-8387-c30f5b0ab12d', 'Gremu Consultancy', true
 where exists (select 1 from auth.users where id = '655ad01b-ea0c-45fb-8387-c30f5b0ab12d')
on conflict (id)
do update set is_platform_admin = true;

comment on column public.user_profiles.is_platform_admin is
  'Grants access to internal admin tools (e.g. Settings > Admin > Billing, /admin/businesses). Not settable by users themselves — flip via SQL as the service role. This migration grants it for Gremu Consultancy (655ad01b-ea0c-45fb-8387-c30f5b0ab12d) per operator request.';

-- ── 2. Directory RPC ─────────────────────────────────────────────────────
create or replace function public.list_all_businesses()
returns table (
  out_business_id   uuid,
  out_business_name text,
  out_trading_name  text,
  out_email         text,
  out_phone         text,
  out_plan_tier     text,
  out_created_at    timestamptz,
  out_owner_emails  text,
  out_owner_names   text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can list all businesses.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      b.id,
      b.name::text,
      b.trading_name::text,
      b.email::text,
      b.phone::text,
      b.plan_tier::text,
      b.created_at,
      coalesce(string_agg(au.email, ', ' order by au.email), '')::text,
      coalesce(string_agg(coalesce(nullif(up.full_name, ''), au.email), ', ' order by au.email), '')::text
    from public.businesses b
    left join public.business_users bu
      on bu.business_id = b.id and bu.role = 'owner' and bu.is_active = true
    left join auth.users au on au.id = bu.user_id
    left join public.user_profiles up on up.id = bu.user_id
   where b.deleted_at is null
   group by b.id
   order by b.created_at desc;
end;
$$;

revoke all on function public.list_all_businesses() from public;
grant execute on function public.list_all_businesses() to authenticated, service_role;

comment on function public.list_all_businesses is
  'Returns every non-deleted business with its active owner emails/names, newest first. SECURITY DEFINER so it can join auth.users/user_profiles; callers must be a platform admin (checked via auth.uid()).';
