-- R01 controlled continuation: current authority at acceptance and safe provisioning.
-- One eligibility bit, not an audit/history/provenance system. Existing rows stay
-- unverified (false) and fail closed; no role, token, expiry or history backfill.
-- Application approval is rechecked under row locks, not inferred from issuer ID.
begin;
alter table public.business_invitations
  add column if not exists role_assignment_authorized boolean not null default false;
comment on column public.business_invitations.role_assignment_authorized is
  'Guard-managed acceptance eligibility. Legacy rows default false; authorized creation/reassignment is required. Never proof of historical issuer identity; current authority is always rechecked.';

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
    if tg_op = 'INSERT' or row(new.business_id,new.role,new.invited_by)
                           is distinct from row(old.business_id,old.role,old.invited_by) then
      -- A trusted path is not permission to label a missing/unauthorized issuer
      -- as authorized. Existing server writers already provide the verified caller.
      new.role_assignment_authorized := exists (
        select 1 from public.business_users bu
        where bu.business_id=new.business_id and bu.user_id=new.invited_by and bu.is_active
          and bu.role in ('owner','admin')
          and (new.role not in ('owner','admin') or bu.role='owner')
      );
    else
      -- Metadata edits cannot bless a legacy row. Trusted setup/operators may
      -- revoke eligibility, but enabling it requires fresh role authorization.
      new.role_assignment_authorized := old.role_assignment_authorized and new.role_assignment_authorized;
    end if;
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
  if tg_op = 'INSERT' then
    new.role_assignment_authorized := true;
  elsif new.role is distinct from old.role or new.invited_by is distinct from old.invited_by then
    new.role_assignment_authorized := true;
  elsif new.role_assignment_authorized is distinct from old.role_assignment_authorized then
    raise exception 'Invitation eligibility is managed by the authorization boundary.' using errcode='42501';
  end if;
  -- Recipient matching, token generation/expiry/acceptance state are unchanged.
  return new;
end;
$$;
revoke all on function public.r01_guard_invitation_write() from public,anon,authenticated;

-- One transaction owns the current-authority check AND membership mutation.
-- Called by the authenticated legacy wrapper after its identity checks, or by
-- the service-role Edge consumer after its existing email/phone checks.
create or replace function public.accept_invitation_membership(
  p_invitation_id uuid, p_recipient_id uuid, p_expected_invitation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  inv public.business_invitations;
  expected_inv public.business_invitations;
  issuer_role public.user_role;
  target_role public.user_role;
  target_active boolean;
  business_name text;
  changed integer;
begin
  if p_recipient_id is null or p_expected_invitation is null
     or not exists(select 1 from auth.users where id=p_recipient_id) then
    raise exception 'Invitation authorization cannot be established.' using errcode='42501';
  end if;
  select * into inv from public.business_invitations where id=p_invitation_id for update;
  if not found or inv.expires_at < now() then
    raise exception 'Invitation not found or expired.' using errcode='P0002';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Invitation already accepted.' using errcode='55000';
  end if;
  select name into business_name from public.businesses
    where id=inv.business_id and is_active and deleted_at is null for share;
  if not found then
    raise exception 'This business is no longer active.' using errcode='P0002';
  end if;

  -- Identity matching belongs to the existing caller contract. Reject a changed
  -- invitation snapshot so a concurrent edit cannot switch that checked identity,
  -- organization, issuer or role before the membership write.
  expected_inv := jsonb_populate_record(null::public.business_invitations,p_expected_invitation);
  if row(inv.id,inv.business_id,inv.role,inv.invited_by,inv.email,inv.phone,inv.expires_at,inv.token)
     is distinct from
     row(expected_inv.id,expected_inv.business_id,expected_inv.role,expected_inv.invited_by,
         expected_inv.email,expected_inv.phone,expected_inv.expires_at,expected_inv.token) then
    raise exception 'Invitation changed; authorization must be checked again.' using errcode='42501';
  end if;
  if not inv.role_assignment_authorized or inv.invited_by is null then
    raise exception 'Invitation authorization cannot be established. Request an authorized reissue.' using errcode='42501';
  end if;
  -- Lock both the actual Auth identity and the current membership. Revocation,
  -- deletion or demotion cannot interleave between this check and the commit.
  select bu.role into issuer_role
    from public.business_users bu join auth.users au on au.id=bu.user_id
   where bu.business_id=inv.business_id and bu.user_id=inv.invited_by and bu.is_active
     and (to_jsonb(au)->>'deleted_at') is null
     and coalesce((to_jsonb(au)->>'banned_until')::timestamptz,'-infinity'::timestamptz) <= now()
   for share of bu, au;
  if issuer_role is null or issuer_role not in ('owner','admin')
     or (inv.role in ('owner','admin') and issuer_role <> 'owner') then
    raise exception 'Issuer is no longer authorized to assign this role.' using errcode='42501';
  end if;

  select role,is_active into target_role,target_active from public.business_users
   where business_id=inv.business_id and user_id=p_recipient_id for update;
  if not coalesce(target_active,false) and target_role='owner' and issuer_role <> 'owner' then
    raise exception 'Only an owner can change an owner membership.' using errcode='42501';
  end if;

  insert into public.user_profiles(id,full_name)
  select u.id,coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
    nullif(btrim(u.raw_user_meta_data->>'name'),''),nullif(split_part(u.email,'@',1),''),'Team member')
  from auth.users u where u.id=p_recipient_id
  on conflict(id) do nothing;

  if target_active then
    -- Edge keeps its existing 409/no-consumption behavior; the legacy wrapper
    -- acknowledges an already-member invitation as it did before.
    return jsonb_build_object('success',true,'already_member',true,
      'business_id',inv.business_id,'role',target_role,'business_name',business_name);
  end if;

  insert into public.business_users(business_id,user_id,role,is_active,accepted_at,invited_by,invited_at,created_at,updated_at)
  values(inv.business_id,p_recipient_id,inv.role,true,now(),inv.invited_by,inv.invited_at,now(),now())
  on conflict(business_id,user_id) do update set role=excluded.role,is_active=true,
    accepted_at=coalesce(business_users.accepted_at,now()),invited_by=excluded.invited_by,
    invited_at=excluded.invited_at,updated_at=now()
  -- Repeat target protection at the conflict write for a concurrently inserted row.
  where not business_users.is_active and (business_users.role <> 'owner' or issuer_role='owner');
  get diagnostics changed = row_count;
  if changed <> 1 then
    raise exception 'Membership changed; authorization must be checked again.' using errcode='42501';
  end if;
  update public.business_invitations set accepted_at=now(),accepted_by=p_recipient_id where id=inv.id;
  return jsonb_build_object('success',true,'business_id',inv.business_id,'role',inv.role,'business_name',business_name);
end;
$$;
revoke all on function public.accept_invitation_membership(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.accept_invitation_membership(uuid,uuid,jsonb) to service_role;

create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_inv     record;
  result jsonb;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to accept an invitation.'
      using errcode = '42501';
  end if;

  select bi.*, b.name as business_name, b.is_active as biz_active, b.deleted_at as biz_deleted
    into v_inv
    from public.business_invitations bi
    join public.businesses b on b.id = bi.business_id
   where bi.token = p_token;

  if v_inv.id is null then
    raise exception 'Invitation not found or expired.' using errcode = 'P0002';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'Invitation not found or expired.' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invitation already accepted.' using errcode = '55000';
  end if;
  if not v_inv.biz_active or v_inv.biz_deleted is not null then
    raise exception 'This business is no longer active.' using errcode = 'P0002';
  end if;
  if v_inv.email is not null and lower(v_inv.email) <> lower((select email from auth.users where id = v_user_id)) then
    raise exception 'This invitation is for a different email address.' using errcode = '42501';
  end if;

  result := public.accept_invitation_membership(v_inv.id,v_user_id,to_jsonb(v_inv));
  if coalesce((result->>'already_member')::boolean,false) then
    update public.business_invitations set accepted_at=now(),accepted_by=v_user_id where id=v_inv.id;
  end if;
  return result;
end;
$$;
revoke all on function public.accept_invitation(text) from public,anon;
grant execute on function public.accept_invitation(text) to authenticated,service_role;

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
  -- The source schema requires full_name and supplies no default/trigger.
  -- Display metadata is not authority: copy no role/platform flags from it.
  INSERT INTO public.user_profiles (id, full_name)
  SELECT u.id, COALESCE(NULLIF(btrim(u.raw_user_meta_data->>'full_name'), ''),
    NULLIF(btrim(u.raw_user_meta_data->>'name'), ''),
    NULLIF(split_part(u.email, '@', 1), ''), 'Team member')
  FROM auth.users u WHERE u.id = v_user_id
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

revoke all on function public.grant_user_business_access(text,uuid,text) from public,anon,authenticated;
grant execute on function public.grant_user_business_access(text,uuid,text) to service_role;
commit;
