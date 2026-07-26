-- ─────────────────────────────────────────────────────────────────────────
-- Monetization: real payment integration (PayChangu)
-- ─────────────────────────────────────────────────────────────────────────
-- Adds:
--   - businesses.plan_expires_at — when the current paid term runs out.
--     There is no tokenized recurring billing yet, so renewal is a manual
--     re-checkout before/at this date; expire-subscriptions (pg_cron)
--     downgrades to Free once it passes.
--   - subscription_payments — one row per checkout attempt, updated by the
--     paychangu-webhook / verify-subscription-payment edge functions once
--     the gateway confirms the final status. This is the audit trail for
--     everything paid through the app.
--   - A trigger that blocks plan_tier being *raised* by anything other than
--     the service role (i.e. our edge functions, after a verified
--     payment). Regular authenticated requests (including the owner's own
--     browser/devtools) may still lower plan_tier (self-serve downgrade,
--     as decided), but cannot grant themselves a paid tier without going
--     through checkout. This closes the gap where the manual "upgrade"
--     button added before payments existed could otherwise be replayed
--     directly against the businesses table.

alter table public.businesses
  add column if not exists plan_expires_at timestamptz;

comment on column public.businesses.plan_expires_at is
  'End of the current paid term for plan_tier. NULL for Free or lifetime/comped plans. Past this date, expire-subscriptions downgrades the business to Free. No auto-recurring charge yet — renewal requires the owner to check out again.';

-- ── subscription_payments ───────────────────────────────────────────────
create table if not exists public.subscription_payments (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses(id) on delete cascade,
  tx_ref            text not null unique,                 -- our reference, sent to PayChangu as tx_ref
  gateway           text not null default 'paychangu',
  gateway_reference text,                                  -- PayChangu's own `reference` once known
  target_plan_tier  text not null check (target_plan_tier in ('growth', 'pro', 'enterprise')),
  billing_cycle     text not null check (billing_cycle in ('monthly', 'annual')),
  amount            numeric not null,
  currency          text not null default 'MWK',
  status            text not null default 'pending' check (status in ('pending', 'success', 'failed', 'cancelled')),
  checkout_url      text,
  plan_expires_at   timestamptz,                           -- what plan_expires_at will be set to on success
  initiated_by      uuid,                                  -- auth.users.id of whoever started checkout
  raw_response      jsonb,                                 -- last gateway payload we saw (webhook or verify call), for support/debugging
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_subscription_payments_business on public.subscription_payments(business_id, created_at desc);
create index if not exists idx_subscription_payments_status on public.subscription_payments(status) where status = 'pending';

comment on table public.subscription_payments is
  'One row per PayChangu checkout attempt for a plan upgrade. Written by initiate-subscription-payment, resolved to success/failed by paychangu-webhook or verify-subscription-payment (both idempotent via apply_subscription_payment()).';

alter table public.subscription_payments enable row level security;

-- Members of the business can view payment history (read-only from the
-- client). All writes happen via edge functions using the service role
-- key, which bypasses RLS entirely — no insert/update/delete policy is
-- defined here for the authenticated role, so direct client writes are
-- denied by default.
drop policy if exists subscription_payments_read on public.subscription_payments;
create policy subscription_payments_read on public.subscription_payments
  for select using (
    business_id in (
      select business_id from public.business_users
      where user_id = auth.uid() and is_active = true
    )
  );

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_subscription_payments_updated_at on public.subscription_payments;
create trigger trg_subscription_payments_updated_at
  before update on public.subscription_payments
  for each row execute function public.set_updated_at();

-- ── apply_subscription_payment ──────────────────────────────────────────
-- Idempotent: safe to call multiple times for the same tx_ref (e.g. once
-- from the webhook and once from the client's post-redirect verification
-- call) — a payment already marked 'success' or 'failed' is left alone.
create or replace function public.apply_subscription_payment(
  p_tx_ref text,
  p_status text,               -- 'success' | 'failed' | 'cancelled'
  p_gateway_reference text,
  p_raw_response jsonb
)
returns public.subscription_payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.subscription_payments;
begin
  if p_status not in ('success', 'failed', 'cancelled') then
    raise exception 'Invalid subscription payment status: %', p_status;
  end if;

  select * into v_payment
  from public.subscription_payments
  where tx_ref = p_tx_ref
  for update;

  if not found then
    raise exception 'Unknown subscription payment tx_ref: %', p_tx_ref;
  end if;

  -- Already resolved — don't reprocess (e.g. webhook arrives after the
  -- user's own post-redirect verification already settled it).
  if v_payment.status <> 'pending' then
    return v_payment;
  end if;

  update public.subscription_payments
  set status = p_status,
      gateway_reference = coalesce(p_gateway_reference, gateway_reference),
      raw_response = coalesce(p_raw_response, raw_response)
  where tx_ref = p_tx_ref
  returning * into v_payment;

  if p_status = 'success' then
    update public.businesses
    set plan_tier = v_payment.target_plan_tier,
        plan_expires_at = v_payment.plan_expires_at,
        plan_updated_at = now()
    where id = v_payment.business_id;
  end if;

  return v_payment;
end;
$$;

comment on function public.apply_subscription_payment is
  'Resolves a pending subscription_payments row to success/failed and, on success, atomically activates the paid plan on businesses. Runs as SECURITY DEFINER so it can update businesses even though authenticated users otherwise cannot raise their own plan_tier (see enforce_plan_tier_change trigger) — only called by the paychangu-webhook / verify-subscription-payment edge functions using the service role key.';

-- Only the service role (edge functions) or the SECURITY DEFINER function
-- above may execute this — revoke from anon/authenticated so it can't be
-- called directly from the browser to fabricate a "successful" payment.
revoke all on function public.apply_subscription_payment(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_subscription_payment(text, text, text, jsonb) to service_role;

-- ── Guard against self-serve plan_tier escalation ───────────────────────
create or replace function public.plan_tier_rank(tier text)
returns int
language sql
immutable
as $$
  select case tier
    when 'free' then 0
    when 'growth' then 1
    when 'pro' then 2
    when 'enterprise' then 3
    else -1
  end;
$$;

create or replace function public.enforce_plan_tier_change()
returns trigger
language plpgsql
as $$
begin
  if new.plan_tier is distinct from old.plan_tier then
    -- Edge functions (webhook / verify / cron) use the service role key
    -- and are the only path allowed to *raise* plan_tier, since that only
    -- happens after a gateway-confirmed payment. Any other caller
    -- (the owner's own browser, including direct REST/devtools calls)
    -- may still lower it — e.g. the self-serve "Downgrade" button.
    if auth.role() <> 'service_role' and public.plan_tier_rank(new.plan_tier) > public.plan_tier_rank(old.plan_tier) then
      raise exception 'Upgrading plan_tier requires a confirmed payment — use the Billing tab to check out.'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_plan_tier_change on public.businesses;
create trigger trg_enforce_plan_tier_change
  before update on public.businesses
  for each row execute function public.enforce_plan_tier_change();
