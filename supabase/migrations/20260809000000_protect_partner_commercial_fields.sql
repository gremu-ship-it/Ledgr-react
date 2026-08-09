-- ─────────────────────────────────────────────────────────────────────────
-- Protect partner commercial, billing & routing fields from partner-admin edits
-- ─────────────────────────────────────────────────────────────────────────
-- partners_partner_admin_update (20260727000004) lets a bank/MFI admin edit
-- their own partner row — that is how they brand their tenant. But the policy
-- grants UPDATE on *every* column, so a partner admin could (via a crafted API
-- call, bypassing the UI's disabled inputs) change:
--   • price_per_client / client_limit / billing_currency  → self-set their bill
--   • billing_email / billing_contact_name               → redirect invoices
--   • is_active                                           → deactivate the tenant
--   • slug / custom_domain                                → re-route (even hijack) a domain
--
-- Those are Ledgr's (platform) decisions, not the partner's. This trigger
-- rejects any non-platform-admin update that changes one of them. Branding and
-- onboarding copy stay editable by partner admins as intended.
-- `is distinct from` comparisons make an ordinary branding-only save
-- (baseline == current) a no-op, so partner admins can still save their theme
-- without tripping the guard.

create or replace function public.protect_partner_commercial_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin(auth.uid()) and (
        old.client_limit         is distinct from new.client_limit
    or  old.price_per_client     is distinct from new.price_per_client
    or  old.billing_currency     is distinct from new.billing_currency
    or  old.billing_email        is distinct from new.billing_email
    or  old.billing_contact_name is distinct from new.billing_contact_name
    or  old.is_active            is distinct from new.is_active
    or  old.slug                 is distinct from new.slug
    or  old.custom_domain        is distinct from new.custom_domain
  ) then
    raise exception 'Only Ledgr (platform admin) can change a partner''s commercial, billing or routing settings (client_limit, price_per_client, billing_currency, billing_email, billing_contact_name, is_active, slug, custom_domain).'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_partner_commercial_fields on public.partners;
create trigger trg_protect_partner_commercial_fields
  before update on public.partners
  for each row execute function public.protect_partner_commercial_fields();

comment on function public.protect_partner_commercial_fields is
  'Rejects partner-admin edits to partners rows that touch commercial, billing or routing columns; only platform admins may change those.';
