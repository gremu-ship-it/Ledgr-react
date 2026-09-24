-- R06 — Single authoritative stock-movement → balance propagation.
--
-- Register anchor (R06): "Version one authoritative stock-movement→balance
-- mechanism and test concurrent sales/receipts. Do not install a second
-- updater alongside an unknown live trigger."
--
-- Pre-migration inventory (verified mechanically before authoring):
--   * NO trigger exists on public.stock_movements or public.inventory_balances.
--   * The only writers of public.inventory_balances in the entire migration
--     chain are the offline/backfill reconciliation RPCs
--     (20260728000002_recalculate_historical_inventory_stock.sql and its fix
--     20260730000005_fix_inventory_backfill_costing_and_authz.sql), which
--     REBUILD balances from stock_movements in batch — they are reconcilers,
--     not an online propagation mechanism.
--   * Online posting commands (post_pos_sale / _ledgr_complete_pos_sale,
--     quick_save_rpc) INSERT stock_movements rows only; balances never moved
--     on the hot path (evidence POS.STOCK: sale inserted a movement while
--     quantity_on_hand stayed at the seeded value).
--
-- This migration therefore installs THE first and only online propagation
-- mechanism — it does not install a second updater alongside an existing one.
--
-- Semantics (deliberately minimal, movement-sign driven):
--   * Movement quantities are signed by convention everywhere in the chain:
--     inbound (purchase/receipt) positive, outbound (sale) negative. The
--     balance simply applies NEW.quantity.
--   * Inbound movements with a positive unit_cost update the weighted-average
--     cost. Inbound with null/zero cost propagates quantity only and leaves
--     average_cost unchanged — zero/unknown cost is never silently substituted
--     into valuation (register R06 unknown-cost rule; a valuation-policy
--     decision for missing cost is finance-owned, not invented here).
--   * Outbound constraint: the existing chk_inventory_balances_on_hand_nonneg
--     check (20260817000001) is the approved oversell policy — a movement that
--     would take on_hand negative raises 23514 inside the posting command's
--     transaction. Concurrent sales of the final unit serialize on the locked
--     balance row; the later commit fails with the same denial.
--   * Exactly-once: balance effects happen exactly once per inserted movement
--     row; the posting commands already gate movement insertion per
--     (business_id, source_type, source_id), so command replay does not
--     re-apply (verified by R06.POS.REPLAY-EXACTLY-ONCE).
--
-- Backfill interplay: the reconciliation RPCs insert missing movement rows and
-- then rebuild the balance rows wholesale from movements; each inserted
-- movement propagates through this trigger first and the subsequent rebuild
-- converges to the same canonical values — no double count.

-- One authoritative balance row per logical key is already enforced by the
-- base schema's `unique (business_id, product_id, location_id)` constraint on
-- public.inventory_balances (20250101000000, line ~2191 — sanctioned
-- "migrations use ON CONFLICT on these columns"). That constraint is the
-- row-level serialization point this trigger locks; no new index needed.

create or replace function public._ledgr_apply_stock_movement_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
    v_balance record;
    v_new_on_hand numeric;
    v_new_avg numeric;
begin
    -- Ensure the authoritative balance row exists, then lock it for this
    -- posting's propagation. Concurrent postings serialize on this row.
    insert into public.inventory_balances
        (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, average_cost, last_movement_at)
    values
        (NEW.business_id, NEW.product_id, NEW.location_id, 0, 0, 0, now())
    on conflict (business_id, product_id, location_id) do nothing;

    select *
      into v_balance
      from public.inventory_balances
     where business_id = NEW.business_id
       and product_id = NEW.product_id
       and location_id = NEW.location_id
     for update;

    if not found then
        raise exception 'Stock balance row unavailable for business %, product %, location %',
            NEW.business_id, NEW.product_id, NEW.location_id
          using errcode = 'check_violation';
    end if;

    v_new_on_hand := coalesce(v_balance.quantity_on_hand, 0) + coalesce(NEW.quantity, 0);

    -- Weighted-average cost on costed inbound only; everything else keeps the
    -- incumbent average (outbound never re-prices; zero-cost inbound does not
    -- silently substitute zero valuation).
    if coalesce(NEW.quantity, 0) > 0
       and coalesce(NEW.unit_cost, 0) > 0
       and v_new_on_hand > 0 then
        v_new_avg := (coalesce(v_balance.quantity_on_hand, 0) * coalesce(v_balance.average_cost, 0)
                      + coalesce(NEW.quantity, 0) * coalesce(NEW.unit_cost, 0))
                     / v_new_on_hand;
    else
        v_new_avg := coalesce(v_balance.average_cost, 0);
    end if;

    update public.inventory_balances
       set quantity_on_hand = v_new_on_hand,
           average_cost = v_new_avg,
           last_movement_at = now()
     where id = v_balance.id;

    return NEW;
end;
$func$;

drop trigger if exists trg_stock_movement_apply_balance on public.stock_movements;

create trigger trg_stock_movement_apply_balance
    after insert on public.stock_movements
    for each row execute function public._ledgr_apply_stock_movement_balance();

comment on function public._ledgr_apply_stock_movement_balance() is
    'R06 single authoritative online stock-movement → balance propagation: applies the signed movement quantity to the one balance row per (business, product, location); weighted-average cost updates on costed inbound only (never silent zero-cost substitution); oversell denial delegated to chk_inventory_balances_on_hand_nonneg (23514). Movement insertion remains gated per (business_id, source_type, source_id) by the posting commands, so balance effects apply exactly once per posted document.';
