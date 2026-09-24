-- R01: enforce existing profile and role-assignment rules on direct writes.
-- Append after the existing 20260925000000 migration; no grants, RLS replacement,
-- financial backfill, existing role correction or invitation invalidation.
-- SECURITY INVOKER is intentional: current_user identifies the actual SQL writer.
-- Existing SECURITY DEFINER provisioning and service-role operators are trusted
-- paths with their own caller authorization; a JWT role string is NOT a bypass.
begin;

create or replace function public.r01_guard_profile_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if current_user = 'service_role'
     or current_user = pg_get_userbyid((select relowner from pg_class where oid = tg_relid)) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if current_user <> 'authenticated' or auth.uid() is null or tg_op = 'DELETE' then
    raise exception 'Profile mutation is not authorized.' using errcode = '42501';
  end if;
  if new.id is distinct from auth.uid() then
    raise exception 'Profile mutation is not authorized.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    -- A future permissive INSERT policy must not become an escalation/upsert path.
    if new.is_platform_admin is distinct from false or new.phone is not null
       or new.deletion_requested_at is not null or new.deletion_finalized_at is not null then
      raise exception 'Protected profile fields require an authorized server path.' using errcode = '42501';
    end if;
  elsif (to_jsonb(new) - array['full_name','avatar_url','preferred_language','preferred_currency','updated_at'])
        is distinct from
        (to_jsonb(old) - array['full_name','avatar_url','preferred_language','preferred_currency','updated_at']) then
    -- An unchanged protected value in a whole-row UPDATE is harmless; changing it
    -- is not. Future columns default to protected rather than silently editable.
    raise exception 'Protected profile fields require an authorized server path.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.r01_guard_profile_write() from public, anon, authenticated;
drop trigger if exists r01_profile_write_guard on public.user_profiles;
create trigger r01_profile_write_guard before insert or update or delete on public.user_profiles
  for each row execute function public.r01_guard_profile_write();

create or replace function public.r01_guard_membership_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  actor_role public.user_role;
  target_business uuid;
begin
  if current_user = 'service_role'
     or current_user = pg_get_userbyid((select relowner from pg_class where oid = tg_relid)) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if current_user <> 'authenticated' or auth.uid() is null then
    raise exception 'Membership mutation is not authorized.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then target_business := new.business_id;
  else target_business := old.business_id; end if;
  actor_role := public.current_user_role(target_business);
  if actor_role is null or actor_role not in ('owner','admin') then
    raise exception 'Membership administration requires an active owner or admin.' using errcode = '42501';
  end if;

  if tg_op <> 'INSERT' then
    -- Existing team contract protects owners; it permits admins to demote OTHER
    -- admins. Do not silently impose a new owner-only rule for all admin edits.
    if old.role = 'owner' and actor_role <> 'owner' then
      raise exception 'Only an owner can change an owner membership.' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then
      if old.user_id = auth.uid() then
        raise exception 'Self-removal requires an authorized server path.' using errcode = '42501';
      end if;
      return old;
    end if;
    if row(new.id,new.business_id,new.user_id) is distinct from row(old.id,old.business_id,old.user_id) then
      raise exception 'Membership identity cannot be relocated.' using errcode = '42501';
    end if;
    if old.user_id = auth.uid() and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
      raise exception 'Self-directed membership transitions are not authorized.' using errcode = '42501';
    end if;
  end if;

  if new.role in ('owner','admin') and actor_role <> 'owner' then
    if tg_op = 'INSERT' then
      raise exception 'Only an owner can assign owner or admin.' using errcode = '42501';
    elsif new.role is distinct from old.role or (new.is_active and not old.is_active) then
      raise exception 'Only an owner can assign or reactivate owner or admin.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.r01_guard_membership_write() from public, anon, authenticated;
drop trigger if exists r01_membership_write_guard on public.business_users;
create trigger r01_membership_write_guard before insert or update or delete on public.business_users
  for each row execute function public.r01_guard_membership_write();

create or replace function public.r01_guard_invitation_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  actor_role public.user_role;
  target_business uuid;
begin
  if current_user = 'service_role'
     or current_user = pg_get_userbyid((select relowner from pg_class where oid = tg_relid)) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if current_user <> 'authenticated' or auth.uid() is null then
    raise exception 'Invitation mutation is not authorized.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then target_business := new.business_id;
  else target_business := old.business_id; end if;
  actor_role := public.current_user_role(target_business);
  if actor_role is null or actor_role not in ('owner','admin') then
    raise exception 'Invitations require an active owner or admin.' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' then
    if old.role in ('owner','admin') and actor_role <> 'owner' then
      -- A lower-privilege writer must not retarget or alter an elevated grant.
      raise exception 'Only an owner can change an elevated invitation.' using errcode = '42501';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    if row(new.id,new.business_id) is distinct from row(old.id,old.business_id) then
      raise exception 'Invitation identity cannot be relocated.' using errcode = '42501';
    end if;
  end if;
  if new.role in ('owner','admin') and actor_role <> 'owner' then
    raise exception 'Only an owner can assign owner or admin.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.invited_by is distinct from auth.uid() then
      raise exception 'Invitation issuer must be the authorizing actor.' using errcode = '42501';
    end if;
  elsif (new.role is distinct from old.role or new.invited_by is distinct from old.invited_by)
        and new.invited_by is distinct from auth.uid() then
    raise exception 'A changed role must identify its authorizing actor.' using errcode = '42501';
  end if;
  -- Recipient matching, token generation/expiry/acceptance state are unchanged.
  return new;
end;
$$;
revoke all on function public.r01_guard_invitation_write() from public, anon, authenticated;
drop trigger if exists r01_invitation_write_guard on public.business_invitations;
create trigger r01_invitation_write_guard before insert or update or delete on public.business_invitations
  for each row execute function public.r01_guard_invitation_write();

commit;
