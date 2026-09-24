-- ============================================================================
-- 20260924000001_fix_stock_movement_balance_trigger.sql  (SUPERSEDED — no-op)
--
-- The canonical stock_movements -> inventory_balances trigger now lives in
--   20260925000001_stock_movement_balance_delta_trigger.sql
-- Read that file for the design and the full history.
--
-- Why this file still exists, and why it does nothing
-- ────────────────────────────────────────────────────
-- This version originally installed a trigger that RECALCULATED each balance
-- from sum(stock_movements.quantity). It failed on production twice:
--
--   1. SQLSTATE 428C9 — it wrote quantity_available, which production stores
--      as a STORED GENERATED column.
--   2. SQLSTATE 23514 — chk_inventory_balances_on_hand_nonneg. The repair pass
--      recomputed a live product to -1829 on hand: opening stock and older
--      history were never written as stock_movements, so the ledger is not a
--      complete account of stock and "balance = sum(ledger)" is not a safe
--      invariant there. A recalculating trigger would have blocked the next
--      sale of any such product.
--
-- Production therefore never recorded this version. Staging DID record it
-- (its column is plain, its ledger complete), with the original recalculating
-- body. The version number must stay so staging's migration history remains
-- resolvable, but the body must not run anywhere again — 20260925000001
-- replaces the function and trigger on every environment, including staging,
-- and drops the recalculation helper this file used to create.
-- ============================================================================

do $$
begin
  raise notice '20260924000001 is superseded by 20260925000001_stock_movement_balance_delta_trigger.sql; nothing to do';
end $$;
