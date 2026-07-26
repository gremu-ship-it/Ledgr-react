-- ─────────────────────────────────────────────────────────────────────────
-- Platform admin access + manual (cash/bank transfer) plan grants
-- ─────────────────────────────────────────────────────────────────────────
-- Lets a trusted operator (you) upgrade a business's plan by hand when
-- someone pays outside PayChangu (cash, bank transfer) before/without the
-- gateway integration being used. This reuses the exact same
-- subscription_payments audit trail and apply_subscription_payment()
-- activation path as real PayChangu payments — the only difference is who
-- initiates it and how the payment is recorded (gateway = 'manual').

-- ── is_platform_admin flag ──────────────────────────────────────────────
alter table public.user_profiles
  add column if not exists is_platform_admin boolean not null default false;

comment on column public.user_profiles.is_platform_admin is
  'Grants access to internal admin tools (e.g. Settings > Admin > Billing) that can view/manage any business, such as manually granting a plan for an offline (cash/bank transfer) payment. Not settable by users themselves — flip via SQL as the service role: update public.user_profiles set is_platform_admin = true where id = (select id from auth.users where email = ''you@example.com'');';

create or replace function public.is_platform_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_platform_admin from public.user_profiles where id = uid), false);
$$;

comment on function public.is_platform_admin is
  'SECURITY DEFINER so it can check any user''s flag regardless of the caller''s own row-level access to user_profiles — used inside RLS policies below.';

revoke all on function public.is_platform_admin(uuid) from public;
grant execute on function public.is_platform_admin(uuid) to authenticated, service_role;

-- ── Let platform admins read (not write) any business / payment ────────
-- Additive to whatever business-membership-scoped SELECT policy already
-- exists on these tables — RLS policies are OR'd together, so this only
-- ever grants extra read access, never removes the existing one.
drop policy if exists businesses_platform_admin_read on public.businesses;
create policy businesses_platform_admin_read on public.businesses
  for select using (public.is_platform_admin(auth.uid()));

drop policy if exists subscription_payments_platform_admin_read on public.subscription_payments;
create policy subscription_payments_platform_admin_read on public.subscription_payments
  for select using (public.is_platform_admin(auth.uid()));

-- ── Allow 'manual' as a billing_cycle option for admin-set custom terms ─
alter table public.subscription_payments
  drop constraint if exists subscription_payments_billing_cycle_check;
alter table public.subscription_payments
  add constraint subscription_payments_billing_cycle_check
  check (billing_cycle in ('monthly', 'annual', 'custom'));

-- ── Reminder de-duplication ──────────────────────────────────────────────
-- Tracks which (business, threshold, expiry) email reminders have already
-- been sent so the daily send-renewal-reminders cron doesn't re-send the
-- same reminder if it runs more than once, and so renewing early (which
-- changes plan_expires_at) naturally resets reminders for the new period.
create table if not exists public.subscription_reminders_sent (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  plan_expires_at  timestamptz not null,
  days_before      int not null check (days_before in (7, 3, 1)),
  sent_at          timestamptz not null default now(),
  unique (business_id, plan_expires_at, days_before)
);

comment on table public.subscription_reminders_sent is
  'De-dupe log for send-renewal-reminders (Edge Function, daily cron). One row per (business, plan period, day-threshold) email actually sent.';

alter table public.subscription_reminders_sent enable row level security;
-- No client-facing policy is defined — this table is only ever read/written
-- by the send-renewal-reminders Edge Function using the service role key,
-- which bypasses RLS entirely.
