-- ============================================================================
-- 20261011000004_ic_pos_stock_availability.sql
-- INCIDENT CONTAINMENT 2026-09-25 — P4: one server-authoritative POS stock
-- location contract for DISPLAY (deduction is unchanged)
-- ============================================================================
-- Finding (crawl 2026-09-25, CONFIRMED MEDIUM): the POS catalog chose its
-- display location client-side from an RLS-filtered list of locations and
-- read inventory_balances under RLS, while the sale deducts from
-- _ledgr_stock_location(business, invoice.branch_id) server-side. The two can
-- disagree (e.g. an assigned-branch cashier cannot see the default warehouse
-- the server actually deducts from), and a failed balance read was swallowed
-- as "no rows" — every tracked product showed 0 / "Out".
--
-- New read: public.pos_stock_availability(p_business_id uuid, p_branch_id uuid)
--   * resolves the location with the SAME function the sale deduction uses
--     (_ledgr_stock_location — unchanged; R06/R08 authority untouched);
--   * returns that location's identity, whether it is the branch's own
--     location or a fallback (default/first location), and on-hand
--     quantities for that ONE location only. No costs, no other locations;
--   * gated exactly like selling there: authenticated caller,
--     can_operate_pos(business), the branch (if given) must belong to the
--     business, and can_access_branch(business, p_branch_id) — DEC-03
--     (a NULL branch is allowed only for org-wide / legacy roles).
--   Read-only (STABLE). Does NOT change which location a sale deducts from,
--   does NOT relax chk_inventory_balances_on_hand_nonneg, and does NOT allow
--   overselling: R06 still rejects insufficient stock at write time.
--
-- OWNER DECISION REQUIRED (not made here): whether a branch without its own
-- location should sell from the default warehouse (today's server behaviour,
-- now surfaced to the cashier as `is_fallback`) or be blocked.
--
-- No data is read or written by this migration.
-- ============================================================================

create or replace function public.pos_stock_availability(p_business_id uuid, p_branch_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_location public.inventory_locations%rowtype;
  v_location_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;
  if p_business_id is null or not public.can_operate_pos(p_business_id) then
    raise exception 'You do not have permission to use the till for this business.' using errcode = '42501';
  end if;
  if p_branch_id is not null
     and not exists (select 1 from public.branches where id = p_branch_id and business_id = p_business_id) then
    raise exception 'You do not have access to the requested branch.' using errcode = '42501';
  end if;
  if not public.can_access_branch(p_business_id, p_branch_id) then
    raise exception 'You do not have access to the requested branch.' using errcode = '42501';
  end if;

  v_location_id := public._ledgr_stock_location(p_business_id, p_branch_id);
  if v_location_id is null then
    return jsonb_build_object(
      'business_id', p_business_id, 'branch_id', p_branch_id,
      'location', null, 'is_fallback', false, 'balances', '[]'::jsonb);
  end if;

  select * into v_location from public.inventory_locations where id = v_location_id;

  return jsonb_build_object(
    'business_id', p_business_id,
    'branch_id', p_branch_id,
    'location', jsonb_build_object('id', v_location.id, 'name', v_location.name, 'branch_id', v_location.branch_id),
    'is_fallback', p_branch_id is null or v_location.branch_id is distinct from p_branch_id,
    'balances', coalesce((
      select jsonb_agg(jsonb_build_object('product_id', ib.product_id, 'quantity_on_hand', ib.quantity_on_hand))
        from public.inventory_balances ib
       where ib.business_id = p_business_id and ib.location_id = v_location_id), '[]'::jsonb));
end;
$$;

comment on function public.pos_stock_availability(uuid, uuid) is
  'IC 2026-09-25 P4: POS display stock for exactly the location a sale on this branch deducts from (_ledgr_stock_location). Quantities only. Gated by can_operate_pos + branch-in-business + can_access_branch (DEC-03). Read-only.';
revoke all on function public.pos_stock_availability(uuid, uuid) from public, anon;
grant execute on function public.pos_stock_availability(uuid, uuid) to authenticated;
