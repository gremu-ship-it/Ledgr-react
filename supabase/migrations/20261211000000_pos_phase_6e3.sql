-- POS Phase 6E-3: persisted held carts, shift-close expiration, plan-gated
-- multi-tender checkout, and Growth-only discount-threshold configuration.
begin;

create table if not exists public.pos_held_orders (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  shift_id uuid not null references public.pos_shifts(id) on delete cascade,
  cashier_id uuid not null,
  cashier_name text,
  customer_id uuid,
  customer_snapshot jsonb,
  reference_note text not null check (char_length(reference_note) between 1 and 120),
  cart_items jsonb not null check (jsonb_typeof(cart_items) = 'array' and jsonb_array_length(cart_items) > 0),
  subtotal numeric(14,2) not null check (subtotal >= 0),
  discount_amount numeric(14,2) not null check (discount_amount >= 0),
  total_amount numeric(14,2) not null check (total_amount >= 0),
  order_discount jsonb,
  cart_notes text,
  status text not null default 'held' check (status in ('held', 'resumed', 'expired')),
  resumed_at timestamptz,
  resumed_by uuid,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pos_held_orders_total_check check (round((subtotal - discount_amount) * 100) = round(total_amount * 100))
);

create index if not exists pos_held_orders_shift_status_created_idx
  on public.pos_held_orders (shift_id, status, created_at desc);
create index if not exists pos_held_orders_business_created_idx
  on public.pos_held_orders (business_id, created_at desc);

alter table public.pos_held_orders enable row level security;
revoke all on public.pos_held_orders from anon, authenticated;
drop policy if exists pos_held_orders_select_member on public.pos_held_orders;

comment on table public.pos_held_orders is
  'Retail-only POS carts suspended on an open shift. All mutation and history access goes through authorization-checking RPCs; active rows expire when their shift closes.';

-- Match the UI defaults for newly-created settings and make any non-default
-- initial threshold value subject to the same Growth gate as later edits.
alter table public.pos_settings alter column cashier_max_discount_percent set default 10;
alter table public.pos_settings alter column manager_max_discount_percent set default 25;

-- Threshold changes need an authoritative subscription check because the
-- existing pos_settings writer policy intentionally grants broader POS setup.
create or replace function public._ledgr_guard_pos_discount_threshold_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_thresholds_changed boolean;
begin
  if not exists (
    select 1 from public.businesses b
     where b.id = new.business_id and 'RETAIL' = any(coalesce(b.operating_models, '{}'::text[]))
  ) then
    raise exception 'POS settings are available only for retail businesses.' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    v_thresholds_changed := new.cashier_max_discount_percent is distinct from 10
      or new.manager_max_discount_percent is distinct from 25;
  else
    v_thresholds_changed := new.cashier_max_discount_percent is distinct from old.cashier_max_discount_percent
      or new.manager_max_discount_percent is distinct from old.manager_max_discount_percent;
  end if;
  if v_thresholds_changed then
    select public.effective_plan_tier(b.plan_tier, b.plan_expires_at)
      into v_tier
      from public.businesses b
     where b.id = new.business_id
       and 'RETAIL' = any(coalesce(b.operating_models, '{}'::text[]));
    if not found then
      raise exception 'POS discount settings require a retail business.' using errcode = '42501';
    end if;
    if (coalesce(auth.role(), '') <> 'service_role' and (auth.uid() is null or not public._ledgr_is_pos_supervisor(new.business_id, auth.uid()))) then
      raise exception 'Only an authorized POS supervisor can change discount thresholds.' using errcode = '42501';
    end if;
    if new.cashier_max_discount_percent < 0 or new.cashier_max_discount_percent > 100
       or new.manager_max_discount_percent < 0 or new.manager_max_discount_percent > 100 then
      raise exception 'POS discount thresholds must be between zero and one hundred percent.' using errcode = '22023';
    end if;
    if public.plan_tier_rank(coalesce(v_tier, 'free')) < public.plan_tier_rank('growth') then
      raise exception 'Configurable manager discount thresholds require the Growth plan.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists pos_discount_threshold_plan_guard on public.pos_settings;
create trigger pos_discount_threshold_plan_guard
  before insert or update of cashier_max_discount_percent, manager_max_discount_percent
  on public.pos_settings
  for each row execute function public._ledgr_guard_pos_discount_threshold_plan();

-- Closing a shift automatically expires any cart that was never resumed.
create or replace function public._ledgr_expire_shift_held_orders()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'open' and new.status = 'closed' then
    update public.pos_held_orders
       set status = 'expired', expired_at = coalesce(new.closed_at, now()), updated_at = now()
     where shift_id = new.id and status = 'held';
  end if;
  return new;
end;
$$;

drop trigger if exists pos_shift_expire_held_orders on public.pos_shifts;
create trigger pos_shift_expire_held_orders
  after update of status on public.pos_shifts
  for each row execute function public._ledgr_expire_shift_held_orders();

create or replace function public.hold_pos_order_command(
  p_business_id uuid,
  p_shift_id uuid,
  p_payload jsonb
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_shift public.pos_shifts%rowtype;
  v_tier text;
  v_command_key uuid;
  v_reference text := btrim(coalesce(p_payload->>'reference_note', ''));
  v_subtotal numeric := round(coalesce((p_payload->>'subtotal')::numeric, 0), 2);
  v_discount numeric := round(coalesce((p_payload->>'discount_amount')::numeric, 0), 2);
  v_total numeric := round(coalesce((p_payload->>'total_amount')::numeric, 0), 2);
  v_customer uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_existing public.pos_held_orders%rowtype;
  v_row public.pos_held_orders%rowtype;
begin
  if v_user is null or not public.can_operate_pos(p_business_id) then
    raise exception 'POS access is required.' using errcode = '42501';
  end if;
  select public.effective_plan_tier(b.plan_tier, b.plan_expires_at)
    into v_tier from public.businesses b
   where b.id = p_business_id and 'RETAIL' = any(coalesce(b.operating_models, '{}'::text[]));
  if not found then raise exception 'This command is available only for retail businesses.' using errcode = '42501'; end if;
  v_command_key := nullif(p_payload->>'command_key', '')::uuid;
  if v_command_key is null then raise exception 'A command key is required.' using errcode = '22023'; end if;
  select * into v_existing from public.pos_held_orders where idempotency_key = v_command_key;
  if found then
    if v_existing.business_id <> p_business_id or v_existing.shift_id <> p_shift_id or v_existing.cashier_id <> v_user then
      raise exception 'The held-order command key has already been used.' using errcode = '42501';
    end if;
    return to_jsonb(v_existing);
  end if;
  select * into v_shift from public.pos_shifts s
   where s.id = p_shift_id and s.business_id = p_business_id for update;
  if not found or v_shift.status <> 'open'
     or (v_shift.branch_id is not null and not public.can_access_branch(p_business_id, v_shift.branch_id))
     or (v_shift.cashier_id is distinct from v_user and not public._ledgr_is_pos_supervisor(p_business_id, v_user)) then
    raise exception 'Only the cashier or an authorized POS supervisor can hold an order on this open shift.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload->'cart_items') is distinct from 'array' then
    raise exception 'Held order cart lines are invalid.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_payload->'cart_items') = 0
     or round((v_subtotal - v_discount) * 100) <> round(v_total * 100)
     or v_discount > v_subtotal then
    raise exception 'Held order totals or cart lines are invalid.' using errcode = '22023';
  end if;
  if char_length(v_reference) < 1 or char_length(v_reference) > 120 then
    raise exception 'Add a reference note of no more than 120 characters.' using errcode = '22023';
  end if;
  if v_customer is not null and not exists (
    select 1 from public.contacts c where c.id = v_customer and c.business_id = p_business_id
  ) then raise exception 'The selected customer does not belong to this business.' using errcode = '22023'; end if;
  insert into public.pos_held_orders (
    idempotency_key, business_id, branch_id, shift_id, cashier_id, cashier_name, customer_id, customer_snapshot,
    reference_note, cart_items, subtotal, discount_amount, total_amount,
    order_discount, cart_notes
  ) values (
    v_command_key, p_business_id, v_shift.branch_id, p_shift_id, v_user, v_shift.cashier_name, v_customer,
    nullif(p_payload->'customer_snapshot', 'null'::jsonb), v_reference, p_payload->'cart_items', v_subtotal, v_discount, v_total,
    nullif(p_payload->'order_discount', 'null'::jsonb), nullif(p_payload->>'cart_notes', '')
  ) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.list_pos_held_orders(
  p_shift_id uuid,
  p_include_history boolean default false
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_shift public.pos_shifts%rowtype;
  v_tier text;
  v_result jsonb;
begin
  select s.* into v_shift from public.pos_shifts s where s.id = p_shift_id;
  if not found or v_user is null or not public.can_operate_pos(v_shift.business_id)
     or (v_shift.branch_id is not null and not public.can_access_branch(v_shift.business_id, v_shift.branch_id))
     or (v_shift.cashier_id is distinct from v_user and not public._ledgr_is_pos_supervisor(v_shift.business_id, v_user)) then
    raise exception 'This held-order list is not available to this POS user.' using errcode = '42501';
  end if;
  select public.effective_plan_tier(b.plan_tier, b.plan_expires_at)
    into v_tier from public.businesses b
   where b.id = v_shift.business_id and 'RETAIL' = any(coalesce(b.operating_models, '{}'::text[]));
  if not found then
    raise exception 'This held-order list is available only for retail businesses.' using errcode = '42501';
  end if;
  if p_include_history and public.plan_tier_rank(coalesce(v_tier, 'free')) < public.plan_tier_rank('growth') then
    raise exception 'Held-order history requires the Growth plan.' using errcode = '42501';
  end if;
  update public.pos_held_orders set status = 'expired', expired_at = coalesce(v_shift.closed_at, now()), updated_at = now()
   where shift_id = p_shift_id and status = 'held' and v_shift.status = 'closed';
  select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc), '[]'::jsonb)
    into v_result from public.pos_held_orders h
   where h.shift_id = p_shift_id and (p_include_history or h.status = 'held');
  return v_result;
end;
$$;

create or replace function public.resume_pos_held_order_command(
  p_held_order_id uuid,
  p_shift_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.pos_held_orders%rowtype;
  v_shift public.pos_shifts%rowtype;
begin
  select * into v_row from public.pos_held_orders h where h.id = p_held_order_id for update;
  if not found then raise exception 'Held order was not found.' using errcode = 'P0002'; end if;
  select * into v_shift from public.pos_shifts s where s.id = p_shift_id and s.business_id = v_row.business_id;
  if v_user is null or not public.can_operate_pos(v_row.business_id)
     or v_row.shift_id <> p_shift_id or v_shift.id is null or v_shift.status <> 'open'
     or (v_shift.branch_id is not null and not public.can_access_branch(v_row.business_id, v_shift.branch_id))
     or (v_shift.cashier_id is distinct from v_user and not public._ledgr_is_pos_supervisor(v_row.business_id, v_user)) then
    raise exception 'Only the cashier or an authorized POS supervisor can resume this order on its open shift.' using errcode = '42501';
  end if;
  if v_row.status <> 'held' then
    if v_row.status = 'resumed' and v_row.resumed_by = v_user then
      return to_jsonb(v_row);
    end if;
    raise exception 'This held order has already been resumed or expired.' using errcode = '55000';
  end if;
  update public.pos_held_orders set status = 'resumed', resumed_at = now(), resumed_by = v_user, updated_at = now()
   where id = v_row.id returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

-- The pre-existing override token table is also restricted to retail at the
-- write boundary, so its legacy request/authorize RPCs cannot be reused by a
-- non-retail business.
create or replace function public._ledgr_guard_retail_pos_price_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.businesses b
     where b.id = new.business_id and 'RETAIL' = any(coalesce(b.operating_models, '{}'::text[]))
  ) then
    raise exception 'POS price overrides are available only for retail businesses.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists pos_price_override_retail_guard on public.pos_price_overrides;
create trigger pos_price_override_retail_guard
  before insert or update on public.pos_price_overrides
  for each row execute function public._ledgr_guard_retail_pos_price_override();

-- Managers authorize outstanding requests from their own authenticated POS
-- session. The requester can never use this list to self-approve a token.
create or replace function public.list_pos_price_override_requests(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
begin
  if v_user is null or not public.can_operate_pos(p_business_id)
     or not public._ledgr_is_pos_supervisor(p_business_id, v_user)
     or not exists (
       select 1 from public.businesses b
        where b.id = p_business_id and 'RETAIL' = any(coalesce(b.operating_models, '{}'::text[]))
     ) then
    raise exception 'Only an authorized POS supervisor for this retail business can review override requests.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'token', o.token, 'kind', o.kind, 'product_id', o.product_id,
    'product_name', p.name, 'unit_price', o.unit_price,
    'max_discount_percent', o.max_discount_percent, 'reason', o.reason,
    'requested_by', o.requested_by, 'created_at', o.created_at, 'expires_at', o.expires_at
  ) order by o.created_at), '[]'::jsonb)
    into v_result
    from public.pos_price_overrides o
    left join public.products p on p.id = o.product_id and p.business_id = o.business_id
   where o.business_id = p_business_id and o.requested_by <> v_user
     and o.authorized_at is null and o.consumed_at is null and o.expires_at > now();
  return v_result;
end;
$$;

-- The canonical sale transaction remains the only accounting/write path. This
-- narrow wrapper enforces retail plan gates and exact tender settlement before
-- delegating to it, and the authenticated role can no longer call the ungated
-- function directly.
create or replace function public.post_pos_sale_plan_gated(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_business_id uuid := nullif(p_payload->>'business_id', '')::uuid;
  v_tier text;
  v_payments jsonb := coalesce(p_payload->'payments', '[]'::jsonb);
  v_is_credit boolean := coalesce((p_payload->>'is_credit_sale')::boolean, false);
  v_due numeric;
  v_assigned numeric := 0;
begin
  if auth.uid() is null or v_business_id is null or not public.can_operate_pos(v_business_id) then
    raise exception 'POS access is required.' using errcode = '42501';
  end if;
  select public.effective_plan_tier(b.plan_tier, b.plan_expires_at)
    into v_tier from public.businesses b
   where b.id = v_business_id and 'RETAIL' = any(coalesce(b.operating_models, '{}'::text[]));
  if not found then raise exception 'This sale command is available only for retail businesses.' using errcode = '42501'; end if;
  if jsonb_typeof(v_payments) is distinct from 'array' then raise exception 'Tender rows are invalid.' using errcode = '22023'; end if;
  if public.plan_tier_rank(coalesce(v_tier, 'free')) < public.plan_tier_rank('growth') then
    if public.plan_tier_rank(coalesce(v_tier, 'free')) < public.plan_tier_rank('starter')
       and jsonb_array_length(v_payments) > 1 then
      raise exception 'The Free plan supports one tender per sale; Starter unlocks split payments.' using errcode = '42501';
    elsif jsonb_array_length(v_payments) > 2 then
      raise exception 'The Starter plan supports a maximum of two tenders per sale.' using errcode = '42501';
    end if;
  end if;
  if not v_is_credit then
    if jsonb_array_length(v_payments) = 0 or exists (
      select 1 from jsonb_array_elements(v_payments) p
       where p->>'amount' is null or round((p->>'amount')::numeric, 2) <= 0
    ) then
      raise exception 'Each sale tender must have a positive amount.' using errcode = '22023';
    end if;
    v_due := round(coalesce((p_payload->'invoice'->>'total_amount')::numeric, 0), 2);
    select coalesce(sum(round((p->>'amount')::numeric, 2)), 0)
      into v_assigned from jsonb_array_elements(v_payments) p;
    if round(v_assigned * 100) <> round(v_due * 100) then
      raise exception 'Tender amounts must equal the sale total exactly.' using errcode = '22023';
    end if;
  end if;
  return public.post_pos_sale(p_payload);
end;
$$;

revoke all on function public._ledgr_guard_pos_discount_threshold_plan() from public, anon, authenticated;
revoke all on function public._ledgr_expire_shift_held_orders() from public, anon, authenticated;
revoke all on function public._ledgr_guard_retail_pos_price_override() from public, anon, authenticated;
revoke all on function public.hold_pos_order_command(uuid, uuid, jsonb) from public, anon;
revoke all on function public.list_pos_held_orders(uuid, boolean) from public, anon;
revoke all on function public.resume_pos_held_order_command(uuid, uuid) from public, anon;
revoke all on function public.list_pos_price_override_requests(uuid) from public, anon;
revoke all on function public.post_pos_sale_plan_gated(jsonb) from public, anon;
grant execute on function public.hold_pos_order_command(uuid, uuid, jsonb) to authenticated;
grant execute on function public.list_pos_held_orders(uuid, boolean) to authenticated;
grant execute on function public.resume_pos_held_order_command(uuid, uuid) to authenticated;
grant execute on function public.list_pos_price_override_requests(uuid) to authenticated;
grant execute on function public.post_pos_sale_plan_gated(jsonb) to authenticated;
revoke all on function public.post_pos_sale(jsonb) from public, anon, authenticated;

commit;
