-- ============================================================================
-- Migration: Fix backfill_and_recalculate_inventory() costing + authorization
--
-- CONTEXT
-- -------
-- 20260728000002 added backfill_and_recalculate_inventory() to reconcile
-- stock levels against sales & purchase records for businesses that started
-- recording income/expense transactions before inventory tracking existed.
-- It has two bugs that make it unsafe to expose from the app as-is:
--
-- BUG 1 — SALES BACKFILLED AT SELLING PRICE, NOT COST
-- -----------------------------------------------------------------------
-- The missing-sales INSERT set stock_movements.unit_cost := il.unit_price
-- (the invoice's selling price). unit_cost is what
-- inventoryValuation.computeStockValue() and computeCogsTotal() multiply by
-- quantity to value stock and cost of sales. Pricing a backfilled sale at
-- its sale price rather than its cost overstates COGS and understates
-- ending inventory value by the entire gross margin on every backfilled
-- sale — the reconciliation this function exists to perform would itself
-- introduce a new discrepancy.
--
-- Fixed by reordering the backfill (purchases before sales, so a sale's
-- cost lookup can see the purchase movements already inserted this run)
-- and costing each backfilled sale at the weighted-average cost of that
-- product's inbound movements as at the sale date, falling back to the
-- product's current purchase_price only when no purchase history exists
-- at all.
--
-- BUG 2 — SAME BUG IN THE BALANCE RECALCULATION
-- -----------------------------------------------------------------------
-- Step 4 computed average_cost as AVG(ABS(unit_cost)) across every
-- movement, sales included. That is an unweighted average of cost AND
-- price together — neither a valid weighted-average cost nor consistent
-- with how the rest of the app defines average_cost (see
-- inventoryValuation.ts: "weighted-average cost"). Fixed to the standard
-- perpetual-inventory formula: Σ(inbound qty × inbound cost) / Σ(inbound
-- qty), using only movements that bring stock IN.
--
-- BUG 3 — NO AUTHORIZATION CHECK
-- -----------------------------------------------------------------------
-- The function is SECURITY DEFINER and was granted to `authenticated` with
-- p_business_id defaulting to NULL, meaning any logged-in user of any
-- tenant could call it with no argument and rewrite stock_movements /
-- inventory_balances for every business on the platform — a far bigger
-- blast radius than the RLS these tables otherwise enforce. Fixed by
-- requiring a specific business_id and can_write_business_data() for any
-- caller that is not the service role; the NULL "every business" form
-- remains available to service_role for operational use (e.g. a one-off
-- platform-wide catch-up run from the SQL editor).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.backfill_and_recalculate_inventory(
  p_business_id UUID DEFAULT NULL
)
RETURNS TABLE (
  out_business_id UUID,
  sales_backfilled INT,
  purchases_backfilled INT,
  balances_updated INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sales_count INT := 0;
  v_purchases_count INT := 0;
  v_balances_count INT := 0;
  v_biz_record RECORD;
  v_default_loc_id UUID;
BEGIN
  -- BUG 3 FIX: only the service role may reconcile "every business" (NULL).
  -- Any other caller must name a business it can write to.
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF p_business_id IS NULL THEN
      RAISE EXCEPTION 'business_id is required.'
        USING ERRCODE = '22004'; -- null_value_not_allowed
    END IF;

    IF NOT public.can_write_business_data(p_business_id) THEN
      RAISE EXCEPTION 'You do not have permission to reconcile inventory for this business.'
        USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;
  END IF;

  FOR v_biz_record IN
    SELECT id FROM public.businesses
    WHERE (p_business_id IS NULL OR id = p_business_id)
      AND is_active = true
      AND deleted_at IS NULL
  LOOP
    -- 1. Ensure at least one default warehouse location exists for this business
    SELECT id INTO v_default_loc_id
    FROM public.inventory_locations
    WHERE business_id = v_biz_record.id AND is_active = true
    ORDER BY is_default DESC, created_at ASC
    LIMIT 1;

    IF v_default_loc_id IS NULL THEN
      INSERT INTO public.inventory_locations (
        business_id, name, is_default, is_active, created_at, updated_at
      )
      VALUES (
        v_biz_record.id, 'Main Warehouse', true, true, now(), now()
      )
      RETURNING id INTO v_default_loc_id;
    END IF;

    -- 2. Backfill missing stock movements for past purchases (expenses) FIRST,
    -- so the sales backfill below can price each sale off the purchase
    -- history that predates it.
    WITH missing_purchases AS (
      SELECT
        e.business_id,
        el.product_id,
        COALESCE(
          (SELECT loc.id FROM public.inventory_locations loc WHERE loc.branch_id = e.branch_id AND loc.is_active = true LIMIT 1),
          v_default_loc_id
        ) AS location_id,
        'purchase'::public.stock_movement_type AS movement_type,
        e.expense_date AS movement_date,
        el.quantity AS quantity, -- positive for purchases
        el.unit_price AS unit_cost,
        'expense' AS source_type,
        e.id AS source_id,
        e.expense_number AS reference,
        e.created_by
      FROM public.expenses e
      JOIN public.expense_lines el ON el.expense_id = e.id
      JOIN public.products p ON p.id = el.product_id
      WHERE e.business_id = v_biz_record.id
        AND e.deleted_at IS NULL
        AND p.track_inventory
        AND el.product_id IS NOT NULL
        AND el.quantity > 0
        -- Skip if a stock movement for this expense & product already exists
        AND NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.business_id = e.business_id
            AND sm.source_id = e.id
            AND sm.source_type = 'expense'
            AND sm.product_id = el.product_id
        )
    ),
    inserted_purchases AS (
      INSERT INTO public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      SELECT
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      FROM missing_purchases
      RETURNING id
    )
    SELECT COUNT(*) INTO v_purchases_count FROM inserted_purchases;

    -- 3. Backfill missing stock movements for past sales (invoices).
    --
    -- BUG 1 FIX: cost each backfilled sale at the weighted-average cost of
    -- that product's inbound movements up to (and including) the sale date
    -- — never at il.unit_price, which is what the customer was charged and
    -- has nothing to do with what the stock cost the business. Falls back
    -- to the product's current purchase_price only when no purchase history
    -- exists for that product at all (e.g. opening stock was never
    -- recorded), and to 0 as a last resort — matching buildCogsPostings'
    -- existing "skip zero-cost lines rather than invent a number" rule.
    WITH missing_sales AS (
      SELECT
        i.business_id,
        il.product_id,
        COALESCE(
          (SELECT loc.id FROM public.inventory_locations loc WHERE loc.branch_id = i.branch_id AND loc.is_active = true LIMIT 1),
          v_default_loc_id
        ) AS location_id,
        'sale'::public.stock_movement_type AS movement_type,
        i.issue_date AS movement_date,
        -il.quantity AS quantity, -- negative for sales
        COALESCE(
          (
            SELECT SUM(sm2.quantity * sm2.unit_cost) / NULLIF(SUM(sm2.quantity), 0)
            FROM public.stock_movements sm2
            WHERE sm2.business_id = i.business_id
              AND sm2.product_id = il.product_id
              AND sm2.quantity > 0
              AND sm2.movement_date <= i.issue_date
          ),
          p.purchase_price,
          0
        ) AS unit_cost,
        'invoice' AS source_type,
        i.id AS source_id,
        i.invoice_number AS reference,
        i.created_by
      FROM public.invoices i
      JOIN public.invoice_lines il ON il.invoice_id = i.id
      JOIN public.products p ON p.id = il.product_id
      WHERE i.business_id = v_biz_record.id
        AND i.deleted_at IS NULL
        AND p.track_inventory
        AND il.product_id IS NOT NULL
        AND il.quantity > 0
        -- Skip if a stock movement for this invoice & product already exists
        AND NOT EXISTS (
          SELECT 1 FROM public.stock_movements sm
          WHERE sm.business_id = i.business_id
            AND sm.source_id = i.id
            AND sm.source_type = 'invoice'
            AND sm.product_id = il.product_id
        )
    ),
    inserted_sales AS (
      INSERT INTO public.stock_movements (
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, created_at
      )
      SELECT
        business_id, product_id, location_id, movement_type,
        movement_date, quantity, unit_cost, source_type, source_id, reference, created_by, now()
      FROM missing_sales
      RETURNING id
    )
    SELECT COUNT(*) INTO v_sales_count FROM inserted_sales;

    -- 4. Recalculate inventory_balances from stock_movements.
    --
    -- BUG 2 FIX: weighted-average cost over INBOUND movements only
    -- (Σ inbound qty × inbound cost ÷ Σ inbound qty), matching how
    -- average_cost is defined everywhere else in the app (see
    -- inventoryValuation.ts). The previous AVG(ABS(unit_cost)) blended sale
    -- prices and purchase costs together with no quantity weighting.
    WITH calc_balances AS (
      SELECT
        sm.business_id,
        sm.product_id,
        sm.location_id,
        COALESCE(SUM(sm.quantity), 0) AS calc_quantity_on_hand,
        COALESCE(
          SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity * sm.unit_cost ELSE 0 END)
            / NULLIF(SUM(CASE WHEN sm.quantity > 0 THEN sm.quantity ELSE 0 END), 0),
          0
        ) AS calc_avg_cost,
        MAX(sm.created_at) AS last_movement
      FROM public.stock_movements sm
      WHERE sm.business_id = v_biz_record.id
      GROUP BY sm.business_id, sm.product_id, sm.location_id
    ),
    upserted_balances AS (
      INSERT INTO public.inventory_balances (
        business_id, product_id, location_id, quantity_on_hand, quantity_reserved,
        average_cost, last_movement_at, updated_at
      )
      SELECT
        cb.business_id, cb.product_id, cb.location_id, cb.calc_quantity_on_hand, 0,
        cb.calc_avg_cost, cb.last_movement, now()
      FROM calc_balances cb
      ON CONFLICT (business_id, product_id, location_id)
      DO UPDATE SET
        quantity_on_hand = EXCLUDED.quantity_on_hand,
        average_cost = CASE WHEN EXCLUDED.average_cost > 0 THEN EXCLUDED.average_cost ELSE inventory_balances.average_cost END,
        last_movement_at = EXCLUDED.last_movement_at,
        updated_at = now()
      RETURNING id
    )
    SELECT COUNT(*) INTO v_balances_count FROM upserted_balances;

    RETURN QUERY SELECT v_biz_record.id, v_sales_count, v_purchases_count, v_balances_count;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.backfill_and_recalculate_inventory(UUID) IS
  'Reconciles stock_movements/inventory_balances against invoices and expenses recorded before (or without) a matching stock movement. Backfills purchases first, then sales — sales are costed at the weighted-average inbound cost as at the sale date, never at the invoice selling price. Requires a specific business_id and can_write_business_data() for any caller other than service_role; only service_role may pass NULL to reconcile every business at once. Called from Warehouse -> Ledger reconciliation -> "Reconcile stock levels".';

REVOKE ALL ON FUNCTION public.backfill_and_recalculate_inventory(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.backfill_and_recalculate_inventory(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.backfill_and_recalculate_inventory(UUID) TO authenticated;
