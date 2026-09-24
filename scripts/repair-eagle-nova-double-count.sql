-- ============================================================================
-- Repair: Eagle Nova Horizon — pure chicken manure showing 320 instead of 160
--
-- TICKET
-- ------
-- Customer report (2026-09-24): Eagle Nova Horizon Holdings recorded 160 bags
-- of pure chicken manure; Warehouse shows 320 on hand.
--
-- ROOT CAUSE (confirmed by the 2026-09 stock-count incident)
-- ----------------------------------------------------------
-- Production carried TWO additive balance triggers on stock_movements
-- (trg_update_inventory_balance + trg_stock_movement_apply_balance). Every
-- movement was applied to inventory_balances twice: a 10-unit receipt landed
-- as 20 — a 160-unit receipt lands as 320. The movement ledger itself holds
-- ONE row of 160; only the balance row is wrong.
--
-- The dual triggers were removed by
--   supabase/migrations/20260925000001_stock_movement_balance_delta_trigger.sql
-- (PR #167), which deliberately does NOT rewrite existing balances — a
-- blanket repair cannot tell an over-count from imported opening stock.
-- PR #167's post-merge step 3 is this script: correct confirmed pure
-- double-counts, one product at a time.
--
-- WHAT THIS SCRIPT DOES
-- ---------------------
--   1. DIAGNOSE (read-only): locate the product, dump its movements, balance
--      and ledger drift; detect which failure mode applies.
--   2. REPAIR — only the balance row, and only when the pure double-count
--      signature holds:
--          quantity_on_hand = 320
--          ledger_quantity  = 160
--          difference       = 160  (= ledger_quantity ⇒ balance = 2 × ledger)
--      It does NOT post an adjustment movement (that would book a phantom
--      stock loss and leave the offset in v_inventory_balance_ledger_drift
--      forever) and does NOT touch stock_movements (the receipt was entered
--      once, correctly).
--   3. VERIFY: post-repair balance must equal 160 and leave the drift view.
--
-- Alternate failure mode — if section 1 shows TWO identical purchase rows
-- (ledger already sums to 320): that is a duplicate Receive Stock submit,
-- not a dual-trigger over-count. Do NOT run section 2. Use Warehouse →
-- "Repair duplicate Receive Stock entries" instead (it posts a compensating
-- movement + GRNI reversal). Section 1 labels which case you are in.
--
-- HOW TO RUN
-- ----------
--   Supabase Dashboard → SQL Editor → New query → paste this file → Run.
--   (SQL Editor runs as the postgres/service role, which the balance update
--   needs under RLS.)
--
--   Or via CI: .github/workflows/repair-eagle-nova-double-count.yml
--   (workflow_dispatch, Management API, dry-run by default).
--
-- IDEMPOTENT — safe to re-run. Section 2 is a no-op once the balance is
-- already 160 (the signature no longer matches).
--
-- PRODUCTION SHAPE NOTE
-- ---------------------
-- inventory_balances.quantity_available is a STORED GENERATED column on
-- production (quantity_on_hand - quantity_reserved). Writing it is SQLSTATE
-- 428C9. The repair below only writes quantity_on_hand / updated_at, and
-- syncs quantity_available explicitly ONLY where the column is plain
-- (staging / repository-built environments).
-- ============================================================================

-- ── 1. DIAGNOSE (read-only) ────────────────────────────────────────────────

-- 1a. Pin the business (Eagle Nova Horizon Holdings Ltd. Co.).
SELECT b.id AS business_id,
       b.name AS business_name,
       b.deleted_at
FROM public.businesses b
WHERE b.id = '93851ac2-73ac-4241-b462-ec8d9d663f8b';

-- 1b. Locate the product(s). Expect exactly one match on production.
SELECT p.id AS product_id,
       p.name,
       p.sku,
       p.unit_of_measure,
       p.track_inventory,
       p.is_active,
       p.deleted_at
FROM public.products p
WHERE p.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  AND p.deleted_at IS NULL
  AND (
        p.name ILIKE '%chicken%manure%'
     OR p.name ILIKE '%pure%chicken%'
     OR p.name ILIKE '%manure%'
      )
ORDER BY p.name;

-- 1c. Balance vs ledger for every location of those products.
--     failure_mode:
--       pure_double_count   → balance = 2 × ledger, difference = ledger
--                             (dual-trigger signature — THIS is the ticket)
--       duplicate_ledger_rows → ledger itself is inflated (two 160 rows)
--       pre_ledger_opening  → positive difference, old last_ledger_movement_at
--                             (imported opening stock — LEAVE ALONE)
--       other_drift         → does not match the ticket; do not repair here
WITH target_products AS (
  SELECT p.id
  FROM public.products p
  WHERE p.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
    AND p.deleted_at IS NULL
    AND (
          p.name ILIKE '%chicken%manure%'
       OR p.name ILIKE '%pure%chicken%'
       OR p.name ILIKE '%manure%'
        )
)
SELECT b.name AS business_name,
       pr.name AS product_name,
       il.name AS location_name,
       ib.quantity_on_hand,
       ib.quantity_reserved,
       ib.quantity_available,
       ib.average_cost,
       d.ledger_quantity,
       d.difference,
       d.movement_count,
       d.last_ledger_movement_at,
       CASE
         WHEN d.ledger_quantity > 0
              AND ib.quantity_on_hand = 2 * d.ledger_quantity
              AND d.difference = d.ledger_quantity
           THEN 'pure_double_count  ← repair with section 2'
         WHEN d.ledger_quantity > 0
              AND ib.quantity_on_hand = d.ledger_quantity
              AND d.difference = 0
           THEN 'already_correct'
         WHEN d.difference > 0
              AND d.last_ledger_movement_at < now() - interval '90 days'
           THEN 'pre_ledger_opening — LEAVE ALONE'
         WHEN EXISTS (
                SELECT 1 FROM public.stock_movements sm
                WHERE sm.business_id = ib.business_id
                  AND sm.product_id = ib.product_id
                  AND sm.location_id = ib.location_id
                  AND sm.quantity = 160
                GROUP BY sm.product_id, sm.location_id, sm.movement_date,
                         sm.quantity, sm.unit_cost, sm.source_type, sm.source_id
                HAVING COUNT(*) > 1
              )
           THEN 'duplicate_ledger_rows — use Warehouse repair panel, NOT section 2'
         ELSE 'other_drift — investigate, do not blind-repair'
       END AS failure_mode
FROM public.inventory_balances ib
JOIN public.businesses b  ON b.id = ib.business_id
JOIN public.products pr   ON pr.id = ib.product_id
LEFT JOIN public.inventory_locations il ON il.id = ib.location_id
LEFT JOIN public.v_inventory_balance_ledger_drift d
       ON d.business_id = ib.business_id
      AND d.product_id   = ib.product_id
      AND d.location_id  = ib.location_id
WHERE ib.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  AND ib.product_id IN (SELECT id FROM target_products)
ORDER BY pr.name, il.name;

-- 1d. Full movement ledger for those products (should show ONE +160 receipt,
--     not two). Anything other than a single +160 net purchase pattern needs
--     the alternate path (Warehouse duplicate-receipt repair).
SELECT pr.name AS product_name,
       il.name AS location_name,
       sm.id AS movement_id,
       sm.movement_type,
       sm.movement_date,
       sm.quantity,
       sm.unit_cost,
       sm.source_type,
       sm.source_id,
       sm.reference,
       sm.client_key,
       sm.notes,
       sm.created_by,
       sm.created_at
FROM public.stock_movements sm
JOIN public.products pr ON pr.id = sm.product_id
LEFT JOIN public.inventory_locations il ON il.id = sm.location_id
WHERE sm.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  AND sm.product_id IN (
        SELECT p.id FROM public.products p
        WHERE p.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
          AND p.deleted_at IS NULL
          AND (
                p.name ILIKE '%chicken%manure%'
             OR p.name ILIKE '%pure%chicken%'
             OR p.name ILIKE '%manure%'
              )
      )
ORDER BY sm.created_at;

-- 1e. Exactly one balance-maintaining trigger must remain (post-20260925000001).
SELECT t.tgname AS trigger_name,
       p.proname AS function_name
FROM pg_trigger t
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.tgrelid = 'public.stock_movements'::regclass
  AND NOT t.tgisinternal
  AND (
        t.tgname ILIKE '%balance%'
     OR p.proname ILIKE '%balance%'
     OR p.prosrc ~* '(insert\s+into|update)\s+(public\.)?inventory_balances\M'
      )
ORDER BY t.tgname;
-- Expect: exactly one row → trg_stock_movements_apply_inventory_balance
-- Two or more → the dual-trigger bug is BACK; stop and re-run migration
-- 20260925000001 before repairing any balance.


-- ── 2. REPAIR (only when section 1 reports pure_double_count) ──────────────
-- Corrects inventory_balances.quantity_on_hand 320 → ledger_quantity (160)
-- for Eagle Nova's chicken-manure product(s) that match the pure
-- double-count signature. Scoped to this business + product-name pattern +
-- exact signature, so it cannot clobber unrelated keys or pre-ledger opening
-- stock. Does not write stock_movements, journals, or quantity_available on
-- the generated-column shape.

DO $$
DECLARE
  v_business_id constant uuid := '93851ac2-73ac-4241-b462-ec8d9d663f8b';
  v_available_is_generated boolean;
  v_repaired integer := 0;
  v_skipped  integer := 0;
  r record;
BEGIN
  -- Production stores quantity_available as STORED GENERATED; writing it is
  -- SQLSTATE 428C9. Mirror the canonical trigger: only sync where plain.
  select exists (
    select 1
    from pg_attribute
    where attrelid = 'public.inventory_balances'::regclass
      and attname = 'quantity_available'
      and attgenerated = 's'
  ) into v_available_is_generated;

  for r in
    select ib.id,
           ib.quantity_on_hand,
           ib.quantity_reserved,
           ib.quantity_available,
           d.ledger_quantity,
           d.difference,
           pr.name as product_name,
           il.name as location_name
    from public.inventory_balances ib
    join public.products pr on pr.id = ib.product_id
    left join public.inventory_locations il on il.id = ib.location_id
    join public.v_inventory_balance_ledger_drift d
      on d.business_id = ib.business_id
     and d.product_id   = ib.product_id
     and d.location_id  = ib.location_id
    where ib.business_id = v_business_id
      and pr.deleted_at is null
      and (
            pr.name ILIKE '%chicken%manure%'
         or pr.name ILIKE '%pure%chicken%'
         or pr.name ILIKE '%manure%'
          )
      -- Pure double-count signature (the ticket: 160 recorded, 320 shown):
      and d.ledger_quantity > 0
      and d.difference = d.ledger_quantity
      and ib.quantity_on_hand = 2 * d.ledger_quantity
      and ib.quantity_on_hand = 320
      and d.ledger_quantity   = 160
  loop
    update public.inventory_balances ib
       set quantity_on_hand = r.ledger_quantity,
           updated_at = now()
     where ib.id = r.id
       -- Optimistic guard: still the over-counted value we diagnosed.
       and ib.quantity_on_hand = r.quantity_on_hand;

    if not found then
      v_skipped := v_skipped + 1;
      raise notice 'SKIP % @ % — balance changed since diagnosis (was %)',
        r.product_name, coalesce(r.location_name, '(default)'), r.quantity_on_hand;
      continue;
    end if;

    -- Plain quantity_available only (generated columns recompute themselves).
    if not v_available_is_generated then
      update public.inventory_balances ib
         set quantity_available = r.ledger_quantity - coalesce(r.quantity_reserved, 0)
       where ib.id = r.id;
    end if;

    v_repaired := v_repaired + 1;
    raise notice 'REPAIRED % @ %: quantity_on_hand % -> % (ledger_quantity)',
      r.product_name, coalesce(r.location_name, '(default)'),
      r.quantity_on_hand, r.ledger_quantity;
  end loop;

  if v_repaired = 0 and v_skipped = 0 then
    raise notice 'REPAIR no-op: no pure_double_count key matched (already correct, or section 1 reported a different failure mode).';
  else
    raise notice 'REPAIR complete: % corrected, % skipped.', v_repaired, v_skipped;
  end if;
end $$;


-- ── 3. VERIFY ──────────────────────────────────────────────────────────────
-- Expect: quantity_on_hand = 160, and NO row returned from the drift view
-- for this product (difference cleared).

SELECT pr.name AS product_name,
       il.name AS location_name,
       ib.quantity_on_hand,
       ib.quantity_available,
       ib.quantity_reserved,
       ib.average_cost,
       ib.updated_at
FROM public.inventory_balances ib
JOIN public.products pr ON pr.id = ib.product_id
LEFT JOIN public.inventory_locations il ON il.id = ib.location_id
WHERE ib.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  AND pr.deleted_at IS NULL
  AND (
        pr.name ILIKE '%chicken%manure%'
     OR pr.name ILIKE '%pure%chicken%'
     OR pr.name ILIKE '%manure%'
      )
ORDER BY pr.name, il.name;

SELECT pr.name AS product_name,
       d.quantity_on_hand,
       d.ledger_quantity,
       d.difference,
       d.movement_count
FROM public.v_inventory_balance_ledger_drift d
JOIN public.products pr ON pr.id = d.product_id
WHERE d.business_id = '93851ac2-73ac-4241-b462-ec8d9d663f8b'
  AND pr.deleted_at IS NULL
  AND (
        pr.name ILIKE '%chicken%manure%'
     OR pr.name ILIKE '%pure%chicken%'
     OR pr.name ILIKE '%manure%'
      );
-- Empty result set = balance agrees with the ledger again.

-- ============================================================================
-- CUSTOMER-FACING SUMMARY
--   Before: Warehouse showed 320 bags (each movement counted twice).
--   After:  Warehouse shows 160 bags, matching the receipt the customer
--           entered. No journal/GRNI adjustment — the GL was always based
--           on the single correct receipt; only the on-hand balance row was
--           over-counted.
-- ============================================================================
