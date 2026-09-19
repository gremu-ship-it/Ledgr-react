-- Starter: MK 50,000/month, 200 transactions, between Free and Growth.
-- Apply before deploying the new checkout and client plan catalogues.
begin;

alter table public.businesses drop constraint if exists businesses_plan_tier_check;
alter table public.businesses add constraint businesses_plan_tier_check
  check (plan_tier in ('free', 'starter', 'growth', 'pro', 'enterprise'));

alter table public.subscription_payments
  drop constraint if exists subscription_payments_target_plan_tier_check;
alter table public.subscription_payments
  add constraint subscription_payments_target_plan_tier_check
  check (target_plan_tier in ('starter', 'growth', 'pro', 'enterprise'));

comment on column public.businesses.plan_tier is
  'Subscription tier controlling transaction limits and feature access: free/starter/growth/pro/enterprise.';

-- Preserve payment-confirmed upgrade enforcement for the new intermediate tier.
create or replace function public.plan_tier_rank(tier text)
returns int
language sql
immutable
as $$
  select case tier
    when 'free' then 0
    when 'starter' then 1
    when 'growth' then 2
    when 'pro' then 3
    when 'enterprise' then 4
    else -1
  end;
$$;

-- Keep quick-save RPC enforcement in step with src/lib/billing/plans.ts.
create or replace function public._ledgr_assert_usage_limit(
  p_business_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_usage bigint;
begin
  select case coalesce(b.plan_tier, 'free')
           when 'free' then 50
           when 'starter' then 200
           when 'growth' then 500
           when 'pro' then 2000
           when 'enterprise' then null
           else 50                       -- normalizePlanTier: unknown -> free
         end
    into v_limit
    from public.businesses b
   where b.id = p_business_id;

  if v_limit is null then
    return;                              -- unlimited
  end if;

  select count(*) into v_usage
    from public.journal_entries
   where business_id = p_business_id
     and entry_date >= date_trunc('month', current_date)::date;

  if v_usage >= v_limit then
    raise exception 'Monthly transaction limit reached (%). Please upgrade your plan.', v_limit
      using errcode = 'P0001';
  end if;
end;
$$;

commit;
