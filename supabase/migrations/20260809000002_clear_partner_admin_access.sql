-- ─────────────────────────────────────────────────────────────────────────
-- Revoke all partner-admin (bank/MFI staff) access for a partner
-- ─────────────────────────────────────────────────────────────────────────
-- "End staff access" for a partner: removes every partner_admins membership,
-- which is what actually gates the partner admin portal (admin.ledgr.com).
--
-- This is deliberately separate from partners.is_active. Deactivating a
-- partner only suspends the branded domain, new-client linking and monthly
-- billing; it does NOT revoke portal access, because the RLS helpers and
-- getForAdminUser() do not check is_active. If you want a partnership to
-- stop, you must clear the staff memberships too.
--
-- Platform admin only (checked inside the function against auth.uid()). Same
-- safe SECURITY DEFINER pattern as 20260809000001 — pinned search_path,
-- no client access to auth.users.

create or replace function public.clear_partner_admins(p_partner_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer;
begin
  if not public.is_platform_admin(auth.uid()) then
    raise exception 'Only Ledgr (platform admin) can revoke a partner''s staff access.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.partners where id = p_partner_id) then
    raise exception 'Partner not found.';
  end if;

  delete from public.partner_admins
   where partner_id = p_partner_id;
  get diagnostics v_removed = row_count;

  return v_removed;
end;
$$;

revoke all on function public.clear_partner_admins(uuid) from public;
grant execute on function public.clear_partner_admins(uuid) to authenticated, service_role;

comment on function public.clear_partner_admins is
  'Removes every bank/MFI staff membership for a partner, revoking their access to the partner admin portal. Platform admin only. Returns the number of memberships removed.';
