-- ============================================================================
-- Diagnostic: reconcile stock levels against sales & purchase records
--
-- CONTEXT
-- -------
-- Inventory tracking (stock_movements / inventory_balances) was switched on
-- after income (invoices) and expense (purchase) transactions already
-- existed. Those historical transactions never wrote a stock_movements row,
-- so quantity_on_hand in the warehouse can disagree with what the sales and
-- purchase records imply it should be.
--
-- `backfill_and_recalculate_inventory()` (see migration
-- 20260728000002, fixed by 20260730000005) closes this gap by inserting the
-- missing movements and recomputing balances. This script is the read-only
-- "how big is the problem" check to run BEFORE calling it, and the
-- "did it work" check to run AFTER.
--
-- HOW TO RUN
-- ----------
-- Paste a section into the Supabase SQL Editor and run it. No parameters —
-- every query covers all businesses and labels rows with the business name.
-- To narrow to one business, uncomment the "AND business_id = " line and
-- paste a literal UUID.
-- ============================================================================


-- ── 1. THE HEADLINE NUMBER: sales/purchases with no matching stock movement ──
-- One row per business. `missing_sale_lines` / `missing_purchase_lines` count
-- invoice/expense lines against tracked products that never produced a
-- stock_movements row. `unaccounted_units_out` / `_in` size the gap in units,
-- and the value columns size it in money at the line's own price — the same
-- inputs backfill_and_recalculate_inventory() will use to insert the missing
-- movements.

WITH missing_sales AS (
  SELECT
    i.business_id,
    COUNT(*)                                   AS missing_lines,
    COALESCE(SUM(il.quantity), 0)               AS missing_units,
    COALESCE(SUM(il.quantity * il.unit_price), 0) AS missing_value_at_sale_price
  FROM public.invoices i
  JOIN public.invoice_lines il ON il.invoice_id = i.id
  JOIN public.products p       ON p.id = il.product_id
  WHERE i.deleted_at IS NULL
    AND p.track_inventory
    AND il.product_id IS NOT NULL
    AND il.quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.business_id = i.business_id
        AND sm.source_id = i.id
        AND sm.source_type = 'invoice'
        AND sm.product_id = il.product_id
    )
  GROUP BY i.business_id
),
missing_purchases AS (
  SELECT
    e.business_id,
    COUNT(*)                                   AS missing_lines,
    COALESCE(SUM(el.quantity), 0)               AS missing_units,
    COALESCE(SUM(el.quantity * el.unit_price), 0) AS missing_value_at_cost
  FROM public.expenses e
  JOIN public.expense_lines el ON el.expense_id = e.id
  JOIN public.products p       ON p.id = el.product_id
  WHERE e.deleted_at IS NULL
    AND p.track_inventory
    AND el.product_id IS NOT NULL
    AND el.quantity > 0
    AND NOT EXISTS (
      SELECT 1 FROM public.stock_movements sm
      WHERE sm.business_id = e.business_id
        AND sm.source_id = e.id
        AND sm.source_type = 'expense'
        AND sm.product_id = el.product_id
    )
  GROUP BY e.business_id
)
SELECT
  b.name                                        AS business_name,
  b.id                                           AS business_id,
  COALESCE(ms.missing_lines, 0)                  AS missing_sale_lines,
  COALESCE(ms.missing_units, 0)                  AS unaccounted_units_out,
  ROUND(COALESCE(ms.missing_value_at_sale_price, 0), 2) AS unaccounted_sales_value,
  COALESCE(mp.missing_lines, 0)                  AS missing_purchase_lines,
  COALESCE(mp.missing_units, 0)                  AS unaccounted_units_in,
  ROUND(COALESCE(mp.missing_value_at_cost, 0), 2) AS unaccounted_purchase_value,
  CASE
    WHEN COALESCE(ms.missing_lines, 0) = 0 AND COALESCE(mp.missing_lines, 0) = 0
      THEN 'OK — every tracked sale/purchase line has a stock movement'
    ELSE 'GAP — run backfill_and_recalculate_inventory(business_id) to catch up'
  END                                            AS diagnosis
FROM public.businesses b
LEFT JOIN missing_sales     ms ON ms.business_id = b.id
LEFT JOIN missing_purchases mp ON mp.business_id = b.id
WHERE b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY (COALESCE(ms.missing_units, 0) + COALESCE(mp.missing_units, 0)) DESC,
         business_name;


-- ── 2. Line-level detail: exactly which sales are missing a stock movement ───
-- Use this to spot-check before running the backfill, or to explain a
-- specific customer's invoice showing stock that never left the warehouse.

SELECT
  b.name          AS business_name,
  i.invoice_number,
  i.issue_date,
  p.name          AS product_name,
  p.sku,
  il.quantity     AS invoiced_quantity,
  il.unit_price,
  ROUND(il.quantity * il.unit_price, 2) AS line_value
FROM public.invoices i
JOIN public.invoice_lines il ON il.invoice_id = i.id
JOIN public.products p       ON p.id = il.product_id
JOIN public.businesses b     ON b.id = i.business_id
WHERE i.deleted_at IS NULL
  AND p.track_inventory
  AND il.product_id IS NOT NULL
  AND il.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.business_id = i.business_id
      AND sm.source_id = i.id
      AND sm.source_type = 'invoice'
      AND sm.product_id = il.product_id
  )
  AND b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY b.name, i.issue_date DESC;


-- ── 3. Line-level detail: purchases missing a stock movement ─────────────────

SELECT
  b.name          AS business_name,
  e.expense_number,
  e.expense_date,
  p.name          AS product_name,
  p.sku,
  el.quantity     AS purchased_quantity,
  el.unit_price   AS unit_cost,
  ROUND(el.quantity * el.unit_price, 2) AS line_value
FROM public.expenses e
JOIN public.expense_lines el ON el.expense_id = e.id
JOIN public.products p       ON p.id = el.product_id
JOIN public.businesses b     ON b.id = e.business_id
WHERE e.deleted_at IS NULL
  AND p.track_inventory
  AND el.product_id IS NOT NULL
  AND el.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.stock_movements sm
    WHERE sm.business_id = e.business_id
      AND sm.source_id = e.id
      AND sm.source_type = 'expense'
      AND sm.product_id = el.product_id
  )
  AND b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY b.name, e.expense_date DESC;


-- ── 4. Per-product reconstruction: what quantity_on_hand SHOULD be ───────────
-- Recomputes the stock position purely from invoices (sales, negative) and
-- expenses (purchases, positive) — i.e. what the sales/purchase records
-- imply — and compares it against the current inventory_balances figure.
-- A non-zero variance here confirms the discrepancy independent of whether
-- stock_movements rows exist at all.

WITH implied AS (
  SELECT business_id, product_id, SUM(qty) AS implied_qty
  FROM (
    SELECT i.business_id, il.product_id, -il.quantity AS qty
    FROM public.invoices i
    JOIN public.invoice_lines il ON il.invoice_id = i.id
    WHERE i.deleted_at IS NULL AND il.product_id IS NOT NULL
    UNION ALL
    SELECT e.business_id, el.product_id, el.quantity AS qty
    FROM public.expenses e
    JOIN public.expense_lines el ON el.expense_id = e.id
    WHERE e.deleted_at IS NULL AND el.product_id IS NOT NULL
  ) x
  GROUP BY business_id, product_id
),
actual AS (
  SELECT business_id, product_id, SUM(quantity_on_hand) AS actual_qty
  FROM public.inventory_balances
  GROUP BY business_id, product_id
)
SELECT
  b.name  AS business_name,
  p.name  AS product_name,
  p.sku,
  COALESCE(im.implied_qty, 0) AS implied_qty_from_sales_purchases,
  COALESCE(ac.actual_qty, 0)  AS actual_inventory_balance,
  COALESCE(im.implied_qty, 0) - COALESCE(ac.actual_qty, 0) AS variance_units
FROM public.products p
JOIN public.businesses b ON b.id = p.business_id
LEFT JOIN implied im ON im.business_id = p.business_id AND im.product_id = p.id
LEFT JOIN actual  ac ON ac.business_id = p.business_id AND ac.product_id = p.id
WHERE p.track_inventory
  AND p.deleted_at IS NULL
  AND b.deleted_at IS NULL
  AND COALESCE(im.implied_qty, 0) - COALESCE(ac.actual_qty, 0) <> 0
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY b.name, ABS(COALESCE(im.implied_qty, 0) - COALESCE(ac.actual_qty, 0)) DESC;


-- ── 5. Run the fix (after reviewing sections 1-4) ────────────────────────────
-- Requires migration 20260730000005 (permission + costing fix) to be applied.
-- Pass a specific business_id — the fixed function requires it and no longer
-- accepts NULL from the SQL editor's `authenticated` role (only service_role
-- may run the all-businesses form). Run once per business you want to catch
-- up:
--
--   select * from public.backfill_and_recalculate_inventory('paste-a-uuid-here');
--
-- Then re-run section 1 above — it should report 0 missing lines — and open
-- Warehouse -> Ledger reconciliation in the app to post the balance-sheet
-- catch-up entry for the resulting stock value.
