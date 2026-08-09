-- ─────────────────────────────────────────────────────────────────────────
-- Partner admin (bank/MFI staff) management — RPCs
-- ─────────────────────────────────────────────────────────────────────────
-- partner_admins has no management UI, and the client cannot read auth.users,
-- so bank/MFI staff could only be added by running raw SQL as the service role.
-- These SECURITY DEFINER functions close that gap from the partner admin portal.
--
-- Authorization is checked *inside* the function against the caller's JWT
-- (auth.uid()), never trusted to RLS alone:
--   • add_partner_admin / remove_partner_admin  → platform admin (Ledgr staff) only
--   • list_partner_admins                       → platform admin OR that partner's admin
--
-- Even though `authenticated` may invoke them, a non-platform admin gets a
-- hard error before any row is touched. Pinned search_path and fully-qualified
-- names follow the safe pattern in 20260728000004 (no privilege escalation via
-- a hostile schema, no client access to auth.users).

-- ── list ─────────────────────────────────────────────────────────────────
create or replace function public.list_partner_admins(p_partner_id uuid)
returns table (
  out_user_id uuid,
  out_email   text,
  out_name    text,
  out_role    text,
  out_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_partner_admin(auth.uid(), p_partner_id) then
    raise exception 'Not authorized to view admins for this partner.'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      pa.user_id,
      au.email::text,
      coalesce(nullif(up.full_name, ''), au.email)::text,
      pa.role::text,
      pa.created_at
    from public.partner_admins pa
    join auth.users au on au.id = pa.user_id
    left join public.user_profiles up on up.id = pa.user_id
   where pa.partner_id = p_partner_id
   order by au.email asc;
end;
$$;

-- ── add ──────────────────────────────────────────────────────────────────
create or replace function public.add_partner_admin(
  p_partner_id uuid,
  p_user_email_or_id text,
  p_role text default 'admin'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can add partner admins.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_role is null or p_role not in ('admin', 'viewer') then
    raise exception 'Partner admin role must be "admin" or "viewer".';
  end if;

  if not exists (select 1 from public.partners where id = p_partner_id) then
    raise exception 'Partner not found.';
  end if;

  if p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_user_id from auth.users where id = p_user_email_or_id::uuid;
  else
    select id into v_user_id from auth.users
     where lower(email) = lower(trim(p_user_email_or_id));
  end if;

  if v_user_id is null then
    raise exception 'No registered Ledgr user found for "%". Ask them to create an account first.', p_user_email_or_id;
  end if;

  insert into public.partner_admins (partner_id, user_id, role)
  values (p_partner_id, v_user_id, p_role)
  on conflict (partner_id, user_id)
  do update set role = excluded.role; -- keep original created_at
end;
$$;

-- ── remove ───────────────────────────────────────────────────────────────
create or replace function public.remove_partner_admin(
  p_partner_id uuid,
  p_user_email_or_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can remove partner admins.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_user_email_or_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into v_user_id from auth.users where id = p_user_email_or_id::uuid;
  else
    select id into v_user_id from auth.users
     where lower(email) = lower(trim(p_user_email_or_id));
  end if;

  if v_user_id is null then
    raise exception 'User "%" was not found.', p_user_email_or_id;
  end if;

  delete from public.partner_admins
   where partner_id = p_partner_id and user_id = v_user_id;
end;
$$;

-- ── grants ───────────────────────────────────────────────────────────────
revoke all on function public.list_partner_admins(uuid) from public;
revoke all on function public.add_partner_admin(uuid, text, text) from public;
revoke all on function public.remove_partner_admin(uuid, text) from public;

grant execute on function public.list_partner_admins(uuid) to authenticated, service_role;
grant execute on function public.add_partner_admin(uuid, text, text) to authenticated, service_role;
grant execute on function public.remove_partner_admin(uuid, text) to authenticated, service_role;

comment on function public.list_partner_admins is
  'Lists the bank/MFI staff who administer a partner tenant. SECURITY DEFINER so it can join auth.users for names/emails; callers must be a platform admin or that partner''s admin (checked via auth.uid()).';
comment on function public.add_partner_admin is
  'Adds (or updates the role of) a partner admin by email or user id. Platform admin only. Resolves the user against auth.users so callers never read that table directly.';
comment on function public.remove_partner_admin is
  'Removes a partner admin by email or user id. Platform admin only.';
