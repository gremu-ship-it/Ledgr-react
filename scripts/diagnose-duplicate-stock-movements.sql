-- ============================================================================
-- Diagnostic: duplicate stock movement records
--
-- CONTEXT
-- -------
-- `stock_movements` rows can be duplicated by several historical paths:
--   * legacy Receive Stock submitted twice before client_key idempotency
--     existed (20260813000003) — the shape the in-app "Repair duplicate
--     Receive Stock entries" panel fixes,
--   * offline sync replays that predate the (business_id, client_key)
--     unique index,
--   * any writer that posts per source document (invoice/expense/POS sale)
--     more than once for the same document.
-- Current code paths are keyed and cannot create new duplicates; this
-- script is the read-only "what exactly is duplicated, and where did it
-- come from" check. Paste a section into the Supabase SQL Editor and run
-- it. No parameters — every query covers all businesses and labels rows
-- with the business name. To narrow to one business, uncomment the
-- "-- AND business_id =" line and paste a literal UUID.
-- ============================================================================


-- ── 1. THE HEADLINE NUMBER: how many duplicate groups/rows per business ─────
-- A "duplicate group" is two or more movements that are indistinguishable
-- except for id/created_at: same product, location, date, type, quantity,
-- unit cost and source. `suspect_extra_rows` is how many rows beyond the
-- first each group carries — that is the count a repair must neutralise.

WITH dupes AS (
  SELECT
    sm.business_id,
    sm.product_id,
    sm.location_id,
    sm.movement_date,
    sm.movement_type,
    sm.quantity,
    sm.unit_cost,
    sm.source_type,
    sm.source_id,
    COUNT(*) AS copies
  FROM public.stock_movements sm
  WHERE TRUE
    -- AND sm.business_id = 'paste-a-uuid-here'
  GROUP BY
    sm.business_id, sm.product_id, sm.location_id, sm.movement_date,
    sm.movement_type, sm.quantity, sm.unit_cost, sm.source_type, sm.source_id
  HAVING COUNT(*) > 1
)
SELECT
  b.name                                   AS business_name,
  COUNT(*)                                 AS duplicate_groups,
  SUM(d.copies - 1)                        AS suspect_extra_rows,
  ROUND(SUM((d.copies - 1) * d.quantity * d.unit_cost), 2) AS suspect_value_at_cost
FROM dupes d
JOIN public.businesses b ON b.id = d.business_id
WHERE b.deleted_at IS NULL
GROUP BY b.name
ORDER BY suspect_extra_rows DESC;


-- ── 2. Exact duplicates, row-level detail ───────────────────────────────────
-- Every row that belongs to an exact-match group, oldest first. In each
-- group the FIRST row is the keeper; everything after it is a suspect.
-- Read `source_type`/`source_id` to see where the duplicates came from:
-- NULL source + NULL client_key = legacy unkeyed writer (Receive Stock
-- retries); 'invoice'/'expense' = document posted twice; 'stock_receipt'
-- with a client_key should be impossible (section 4 proves it).

WITH ranked AS (
  SELECT
    sm.*,
    ROW_NUMBER() OVER (
      PARTITION BY sm.business_id, sm.product_id, sm.location_id,
                   sm.movement_date, sm.movement_type, sm.quantity,
                   sm.unit_cost, sm.source_type, sm.source_id, sm.reference
      ORDER BY sm.created_at
    ) AS copy_number,
    COUNT(*) OVER (
      PARTITION BY sm.business_id, sm.product_id, sm.location_id,
                   sm.movement_date, sm.movement_type, sm.quantity,
                   sm.unit_cost, sm.source_type, sm.source_id, sm.reference
    ) AS copies
  FROM public.stock_movements sm
  WHERE TRUE
    -- AND sm.business_id = 'paste-a-uuid-here'
)
SELECT
  b.name             AS business_name,
  r.copy_number,     -- 1 = keeper, 2+ = duplicate
  r.id               AS movement_id,
  p.name             AS product_name,
  r.movement_type,
  r.movement_date,
  r.quantity,
  r.unit_cost,
  r.source_type,
  r.source_id,
  r.reference,
  r.client_key,
  r.created_by,
  r.created_at
FROM ranked r
JOIN public.businesses b ON b.id = r.business_id
JOIN public.products   p ON p.id = r.product_id
WHERE r.copies > 1
ORDER BY b.name, r.product_id, r.movement_date, r.copy_number;


-- ── 3. What the in-app repair flags ─────────────────────────────────────────
-- Mirrors findDuplicateWarehouseReceiptCandidates() (two rules; both only
-- consider `purchase` movements):
--   Rule 1 — same receipt identity: rows sharing a non-null source_id plus
--            identical product/location/date/quantity/cost are one receipt
--            posted twice, however far apart they landed.
--   Rule 2 — identical unkeyed receipts: matching product/location/date/
--            quantity/cost/notes/creator/reference within 2 minutes, where
--            not both rows carry distinct client_keys.
-- Warehouse -> "Repair duplicate Receive Stock entries" corrects exactly
-- these. Exact-timestamp ties (multi-line inserts) are never flagged.

-- 3a. Rule 1 — same receipt posted twice.
WITH identity_groups AS (
  SELECT
    sm.business_id,
    sm.source_id,
    sm.product_id,
    sm.location_id,
    sm.movement_date,
    sm.quantity,
    sm.unit_cost,
    COUNT(*) AS copies,
    MIN(sm.created_at) AS first_created_at,
    MAX(sm.created_at) AS last_created_at
  FROM public.stock_movements sm
  WHERE sm.movement_type = 'purchase'
    AND sm.source_id IS NOT NULL
    -- AND sm.business_id = 'paste-a-uuid-here'
  GROUP BY
    sm.business_id, sm.source_id, sm.product_id, sm.location_id,
    sm.movement_date, sm.quantity, sm.unit_cost
  HAVING COUNT(*) > 1 AND MIN(sm.created_at) < MAX(sm.created_at)
)
SELECT
  b.name AS business_name,
  g.source_id AS receipt_key,
  p.name AS product_name,
  g.copies,
  g.quantity,
  g.unit_cost,
  g.first_created_at,
  g.last_created_at
FROM identity_groups g
JOIN public.businesses b ON b.id = g.business_id
JOIN public.products   p ON p.id = g.product_id
ORDER BY b.name, g.last_created_at;

-- 3b. Rule 2 — identical legacy (unkeyed) receipts within two minutes.
WITH legacy AS (
  SELECT
    sm.*,
    LAG(sm.created_at) OVER (
      PARTITION BY sm.business_id, sm.product_id, sm.location_id,
                   sm.movement_date, sm.quantity, sm.unit_cost,
                   COALESCE(sm.notes, ''), COALESCE(sm.created_by, ''),
                   COALESCE(sm.reference, '')
      ORDER BY sm.created_at
    ) AS prev_created_at,
    LAG(sm.client_key) OVER (
      PARTITION BY sm.business_id, sm.product_id, sm.location_id,
                   sm.movement_date, sm.quantity, sm.unit_cost,
                   COALESCE(sm.notes, ''), COALESCE(sm.created_by, ''),
                   COALESCE(sm.reference, '')
      ORDER BY sm.created_at
    ) AS prev_client_key
  FROM public.stock_movements sm
  WHERE sm.movement_type = 'purchase'
    AND sm.source_id IS NULL
    -- AND sm.business_id = 'paste-a-uuid-here'
)
SELECT
  b.name       AS business_name,
  l.id         AS duplicate_movement_id,
  p.name       AS product_name,
  l.quantity,
  l.unit_cost,
  l.created_by,
  l.created_at,
  l.prev_created_at AS original_created_at
FROM legacy l
JOIN public.businesses b ON b.id = l.business_id
JOIN public.products   p ON p.id = l.product_id
WHERE l.prev_created_at IS NOT NULL
  AND l.created_at > l.prev_created_at
  AND l.created_at <= l.prev_created_at + interval '2 minutes'
  -- Two distinct client_keys = two separate keyed receipts, not a duplicate.
  AND NOT (l.client_key IS NOT NULL AND l.prev_client_key IS NOT NULL
           AND l.client_key <> l.prev_client_key)
ORDER BY b.name, l.created_at;


-- ── 4. Integrity checks that should always return ZERO rows ─────────────────
-- 4a. The same client_key stored twice defeats the idempotency index —
--     treat any row here as data corruption, not an ordinary duplicate.
SELECT
  b.name AS business_name, sm.business_id, sm.client_key, COUNT(*) AS copies
FROM public.stock_movements sm
JOIN public.businesses b ON b.id = sm.business_id
WHERE sm.client_key IS NOT NULL
GROUP BY b.name, sm.business_id, sm.client_key
HAVING COUNT(*) > 1;

-- 4b. A source document (invoice/expense/POS sale) that produced MORE THAN
--     ONE movement for the same product means a document-level writer fired
--     twice. (The backfill RPC and COGS release both assume at most one.)
SELECT
  b.name AS business_name,
  sm.source_type,
  sm.source_id,
  sm.product_id,
  p.name AS product_name,
  COUNT(*) AS movements_for_same_source_product,
  SUM(sm.quantity) AS net_quantity
FROM public.stock_movements sm
JOIN public.businesses b ON b.id = sm.business_id
JOIN public.products   p ON p.id = sm.product_id
WHERE sm.source_type IS NOT NULL
  AND sm.source_id IS NOT NULL
  -- AND sm.business_id = 'paste-a-uuid-here'
GROUP BY b.name, sm.source_type, sm.source_id, sm.product_id, p.name
HAVING COUNT(*) > 1
ORDER BY movements_for_same_source_product DESC;


-- ── 5. Impact: how far do the suspect rows move stock and its GL value ─────
-- Totals the extra (non-first) copies per business at their own unit cost,
-- split by direction. Positive-quantity duplicates overstate stock and the
-- balance sheet; negative-quantity duplicates understate them. Compare with
-- Warehouse -> "Inventory does not agree with the ledger" before choosing a
-- repair, and re-run section 1 after repairing to confirm it closed.

WITH ranked AS (
  SELECT
    sm.*,
    ROW_NUMBER() OVER (
      PARTITION BY sm.business_id, sm.product_id, sm.location_id,
                   sm.movement_date, sm.movement_type, sm.quantity,
                   sm.unit_cost, sm.source_type, sm.source_id, sm.reference
      ORDER BY sm.created_at
    ) AS copy_number
  FROM public.stock_movements sm
  WHERE TRUE
    -- AND sm.business_id = 'paste-a-uuid-here'
)
SELECT
  b.name                                        AS business_name,
  SUM(CASE WHEN r.quantity > 0 THEN r.quantity ELSE 0 END)  AS extra_inbound_units,
  SUM(CASE WHEN r.quantity < 0 THEN -r.quantity ELSE 0 END) AS extra_outbound_units,
  ROUND(SUM(CASE WHEN r.quantity > 0 THEN r.quantity * r.unit_cost ELSE 0 END), 2)
                                                AS overstated_stock_value,
  ROUND(SUM(CASE WHEN r.quantity < 0 THEN -r.quantity * r.unit_cost ELSE 0 END), 2)
                                                AS understated_stock_value
FROM ranked r
JOIN public.businesses b ON b.id = r.business_id
WHERE r.copy_number > 1
GROUP BY b.name
ORDER BY overstated_stock_value DESC;
