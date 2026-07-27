-- ─────────────────────────────────────────────────────────────────────────
-- Fix tenant isolation on v_partner_client_usage
-- ─────────────────────────────────────────────────────────────────────────
-- 20260727000004 created this view without `security_invoker = true`, so it
-- runs with its owner's privileges and RLS on partner_clients / businesses is
-- NOT applied — contradicting the view's own comment. The only thing scoping
-- results was the client-supplied `.eq('partner_id', …)` filter in
-- PartnerRepository.getClientUsage(), which any authenticated user can change
-- to another partner's id and read that partner's whole client roster.
--
-- Flipping the view to security_invoker would fix the leak but would also zero
-- out every count: the roll-up reads journal_entries / invoices / business_users
-- for client businesses, and a partner admin deliberately has NO row-level read
-- access to those tables (partner admins are read-only over businesses metadata
-- only, see businesses_partner_admin_read). Under invoker rights the subselects
-- would silently return 0 rather than error.
--
-- So keep owner rights — which is what makes the counts possible at all — and
-- enforce the tenant check inside the view instead. is_partner_admin() already
-- folds in is_platform_admin(), so platform staff keep full visibility.

create or replace view public.v_partner_client_usage as
  select
    pc.partner_id,
    b.id                as business_id,
    b.name              as business_name,
    b.plan_tier,
    b.is_active,
    pc.created_at       as onboarded_at,
    (select count(*) from public.journal_entries je where je.business_id = b.id) as journal_entry_count,
    (select count(*) from public.invoices i where i.business_id = b.id)          as invoice_count,
    (select count(*) from public.business_users bu where bu.business_id = b.id and bu.is_active) as user_count,
    (select max(je.created_at) from public.journal_entries je where je.business_id = b.id)       as last_activity_at
  from public.partner_clients pc
  join public.businesses b on b.id = pc.business_id
 where b.deleted_at is null
   -- Tenant guard. Without this the view is readable across partners because
   -- it does not run with invoker rights.
   and public.is_partner_admin(auth.uid(), pc.partner_id);

comment on view public.v_partner_client_usage is
  'Read-only per-client usage roll-up for the partner admin portal. Runs with owner rights (needed to count journal_entries/invoices, which partner admins cannot read directly), so the partner check is enforced by the is_partner_admin() predicate in the view body — NOT by RLS on the underlying tables. Do not remove that predicate.';

revoke all on public.v_partner_client_usage from anon;
grant select on public.v_partner_client_usage to authenticated;
