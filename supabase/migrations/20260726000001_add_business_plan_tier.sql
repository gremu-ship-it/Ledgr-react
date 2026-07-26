-- ─────────────────────────────────────────────────────────────────────────
-- Monetization: persist subscription plan tier on businesses
-- ─────────────────────────────────────────────────────────────────────────
-- Plan tier was previously hardcoded to 'free' everywhere in application
-- code (see TODOs in useUsage.ts / journalService.ts). This migration adds
-- real persistence so usage limits and feature gating are enforced per
-- business, and businesses can be moved to a paid tier.
--
-- NOTE: There is no payment gateway wired up yet. Until one is integrated,
-- plan_tier is updated manually — either directly in the database, or via
-- the self-serve "Upgrade" button in Settings > Billing (owner-only), which
-- should only be used once payment has actually been arranged/confirmed
-- with the customer out-of-band.

alter table public.businesses
  add column if not exists plan_tier text not null default 'free';

alter table public.businesses
  add column if not exists plan_updated_at timestamptz;

alter table public.businesses
  drop constraint if exists businesses_plan_tier_check;

alter table public.businesses
  add constraint businesses_plan_tier_check
  check (plan_tier in ('free', 'growth', 'pro', 'enterprise'));

comment on column public.businesses.plan_tier is
  'Subscription plan tier controlling monthly transaction limits and feature access (free/growth/pro/enterprise). No automated payment gateway yet — set manually once payment is confirmed.';

comment on column public.businesses.plan_updated_at is
  'Timestamp of the last manual plan_tier change, for auditing self-serve upgrades made before a real billing system is in place.';

-- ─────────────────────────────────────────────────────────────────────────
-- Rollout safeguard: the Free tier's transaction limit is being reduced
-- from 100/month to 50/month in this same release. Any business that has
-- already posted more than 50 journal entries in the current calendar
-- month would otherwise be hard-blocked from creating new transactions
-- the moment this ships. Grandfather those businesses onto a tier that
-- actually covers their existing usage so nobody is locked out
-- unexpectedly; billing/ops should follow up to confirm/invoice them.
with usage as (
  select business_id, count(*) as tx_count
  from public.journal_entries
  where entry_date >= date_trunc('month', current_date)
  group by business_id
)
update public.businesses b
set plan_tier = case
    when u.tx_count > 500 then 'pro'
    else 'growth'
  end,
  plan_updated_at = now()
from usage u
where u.business_id = b.id
  and b.plan_tier = 'free'
  and u.tx_count > 50;
