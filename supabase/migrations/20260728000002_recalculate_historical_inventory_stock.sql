-- ============================================================================
-- Migration: Recalculate & Backfill Historical Stock Movements and Inventory Balances
-- 
-- Description:
-- Backfills missing stock movements for past sales (invoices) and purchases (expenses)
-- that were recorded prior to branchless stock deduction updates.
-- Recomputes inventory_balances for all products and warehouse locations.
-- ============================================================================

CREATE OR REPLACE FUNCTION backfill_and_recalculate_inventory(
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
AS $$
DECLARE
  v_sales_count INT := 0;
  v_purchases_count INT := 0;
  v_balances_count INT := 0;
  v_biz_record RECORD;
  v_default_loc_id UUID;
BEGIN
  -- Loop through target business (or all businesses if p_business_id is NULL)
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
      -- Create default warehouse location if none exists
      INSERT INTO public.inventory_locations (
        business_id, name, is_default, is_active, created_at, updated_at
      )
      VALUES (
        v_biz_record.id, 'Main Warehouse', true, true, now(), now()
      )
      RETURNING id INTO v_default_loc_id;
    END IF;

    -- 2. Backfill missing stock movements for past sales (invoices)
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
        il.unit_price AS unit_cost,
        'invoice' AS source_type,
        i.id AS source_id,
        i.invoice_number AS reference,
        i.created_by
      FROM public.invoices i
      JOIN public.invoice_lines il ON il.invoice_id = i.id
      WHERE i.business_id = v_biz_record.id
        AND i.deleted_at IS NULL
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

    -- 3. Backfill missing stock movements for past purchases (expenses)
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
      WHERE e.business_id = v_biz_record.id
        AND e.deleted_at IS NULL
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

    -- 4. Recalculate inventory_balances table from stock_movements
    -- COALESCE average_cost to 0 so products with sales only don't violate NOT-NULL constraint
    WITH calc_balances AS (
      SELECT 
        sm.business_id,
        sm.product_id,
        sm.location_id,
        COALESCE(SUM(sm.quantity), 0) AS calc_quantity_on_hand,
        COALESCE(AVG(ABS(sm.unit_cost)), 0) AS calc_avg_cost,
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

GRANT EXECUTE ON FUNCTION backfill_and_recalculate_inventory(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION backfill_and_recalculate_inventory(UUID) TO authenticated;
