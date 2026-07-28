-- ============================================================================
-- Diagnostic: why is Inventory missing from Current Assets on the SOFP?
--
-- HOW TO RUN
-- ----------
-- Paste any single section below into the Supabase SQL Editor and run it.
-- There are NO parameters to substitute — every query covers all of your
-- businesses and labels each row with the business name.
--
-- (An earlier version of this file used `:business_id`. That is a psql/driver
-- bind placeholder, not SQL. The Supabase SQL Editor sends statements straight
-- to Postgres, which rejects the ":" — hence `42601: syntax error at or near ":"`.
-- To narrow any query to one business, uncomment the AND line and paste a
-- literal UUID in single quotes.)
--
-- BACKGROUND
-- ----------
-- The SOFP builds "Current Assets" from GL account balances filtered by:
--     account_subtype = 'current_asset'
--   AND is_group = false
--   AND deleted_at IS NULL
--   AND ABS(balance) > 0.01     <-- zero-balance accounts are HIDDEN, not shown as 0
-- (see src/dal/repositories/FinancialStatementRepository.ts)
--
-- So an inventory line disappears if EITHER the account is misclassified,
-- OR its GL balance is zero. Section 1 tells you which.
-- ============================================================================


-- ── 1. THE ANSWER: stock on hand vs what the balance sheet shows ─────────────
-- One row per business. This is the whole diagnosis in a single query.
--
--   stock_on_hand_value      what the warehouse says you're holding
--   inventory_ledger_balance what the SOFP reads from the 114x GL accounts
--   diagnosis                what to do about it

WITH subledger AS (
  SELECT ib.business_id,
         COALESCE(SUM(ib.quantity_on_hand * ib.average_cost), 0) AS stock_value
  FROM public.inventory_balances ib
  GROUP BY ib.business_id
),
ledger AS (
  SELECT a.business_id,
         COALESCE(SUM(
           CASE WHEN jl.is_debit THEN jl.amount_base ELSE -jl.amount_base END
         ), 0) AS gl_balance,
         COUNT(jl.id) AS journal_lines
  FROM public.accounts a
  LEFT JOIN public.journal_lines jl
         ON jl.account_id = a.id
  LEFT JOIN public.journal_entries je
         ON je.id = jl.journal_entry_id
        AND je.status IN ('posted', 'reversed')
  WHERE a.code LIKE '114%'
    AND a.is_group = false
    AND a.deleted_at IS NULL
  GROUP BY a.business_id
)
SELECT b.name                                   AS business_name,
       ROUND(COALESCE(s.stock_value, 0), 2)     AS stock_on_hand_value,
       ROUND(COALESCE(l.gl_balance, 0), 2)      AS inventory_ledger_balance,
       ROUND(COALESCE(s.stock_value, 0)
             - COALESCE(l.gl_balance, 0), 2)    AS variance,
       COALESCE(l.journal_lines, 0)             AS journal_lines_on_114x,
       CASE
         WHEN COALESCE(s.stock_value, 0) = 0 AND COALESCE(l.gl_balance, 0) = 0
           THEN 'No stock recorded — nothing to show'
         WHEN COALESCE(l.journal_lines, 0) = 0 AND COALESCE(s.stock_value, 0) <> 0
           THEN 'CONFIRMED: stock exists but nothing was ever posted to the ledger'
         WHEN ABS(COALESCE(s.stock_value, 0) - COALESCE(l.gl_balance, 0)) < 0.01
           THEN 'Reconciled — inventory should appear correctly'
         WHEN COALESCE(s.stock_value, 0) > COALESCE(l.gl_balance, 0)
           THEN 'Understated — post the catch-up from Warehouse reconciliation'
         ELSE 'Overstated — ledger holds more than the warehouse counts'
       END                                      AS diagnosis
FROM public.businesses b
LEFT JOIN subledger s ON s.business_id = b.id
LEFT JOIN ledger    l ON l.business_id = b.id
WHERE b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY variance DESC NULLS LAST, business_name;


-- ── 2. Are the inventory accounts classified correctly? ──────────────────────
-- Expect account_subtype = 'current_asset' and is_group = false for 1141-1145.
-- 1140 is a header row and is correctly excluded from the statement.
-- A NULL subtype is a real bug: the account is dropped from EVERY SOFP
-- section, including Total Assets, which silently unbalances the statement.

SELECT b.name          AS business_name,
       a.code,
       a.name          AS account_name,
       a.account_type,
       a.account_subtype,
       a.is_group,
       a.normal_balance,
       a.opening_balance,
       CASE
         WHEN a.deleted_at IS NOT NULL             THEN 'EXCLUDED — soft deleted'
         WHEN a.is_group                           THEN 'EXCLUDED — group/header account'
         WHEN a.account_subtype IS NULL            THEN 'BUG — NULL subtype, dropped from every SOFP section'
         WHEN a.account_subtype <> 'current_asset' THEN 'MISCLASSIFIED — shows under ' || a.account_subtype
         WHEN NOT a.is_active                      THEN 'INACTIVE — still reported, but not selectable for new postings'
         ELSE 'OK — eligible for Current Assets'
       END             AS sofp_status
FROM public.accounts a
JOIN public.businesses b ON b.id = a.business_id
WHERE (a.code LIKE '114%' OR a.name ILIKE '%inventor%' OR a.name ILIKE '%stock%')
  AND b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY b.name, a.code;


-- ── 3. Journal activity per inventory account ────────────────────────────────
-- The usual answer before the fix: journal_lines = 0 on every 114x account,
-- because stock was tracked only in stock_movements and purchases were
-- expensed straight to cost of sales.

SELECT b.name AS business_name,
       a.code,
       a.name AS account_name,
       COUNT(jl.id) AS journal_lines,
       ROUND(COALESCE(SUM(
         CASE WHEN jl.is_debit THEN jl.amount_base ELSE -jl.amount_base END
       ), 0), 2) AS gl_balance
FROM public.accounts a
JOIN public.businesses b ON b.id = a.business_id
LEFT JOIN public.journal_lines jl
       ON jl.account_id = a.id
LEFT JOIN public.journal_entries je
       ON je.id = jl.journal_entry_id
      AND je.status IN ('posted', 'reversed')
WHERE a.code LIKE '114%'
  AND a.deleted_at IS NULL
  AND b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
GROUP BY b.name, a.code, a.name
ORDER BY b.name, a.code;


-- ── 4. What the warehouse subledger is holding ───────────────────────────────
-- Non-zero here while section 3 shows zero confirms the divergence, and the
-- value tells you how big the missing asset is.

SELECT b.name AS business_name,
       p.name AS product_name,
       p.sku,
       il.name AS location_name,
       ib.quantity_on_hand,
       ROUND(ib.average_cost, 2) AS average_cost,
       ROUND(ib.quantity_on_hand * ib.average_cost, 2) AS stock_value,
       CASE
         WHEN ib.average_cost = 0 AND ib.quantity_on_hand <> 0
           THEN 'Zero cost — received without a cost, so no value can be capitalised'
         WHEN ib.quantity_on_hand < 0
           THEN 'Negative stock — sold more than was received'
         ELSE 'OK'
       END AS note
FROM public.inventory_balances ib
JOIN public.businesses b ON b.id = ib.business_id
JOIN public.products p ON p.id = ib.product_id
LEFT JOIN public.inventory_locations il ON il.id = ib.location_id
WHERE ib.quantity_on_hand <> 0
  AND b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY stock_value DESC;


-- ── 5. Are products linked to GL accounts? ───────────────────────────────────
-- Before the fix these were always NULL: the columns existed but ProductsPage
-- had no account pickers. NULL is fine — the code falls back to 1141/5100.
-- This only matters if you want a product posting somewhere non-default.

SELECT b.name AS business_name,
       COUNT(*)                        AS tracked_products,
       COUNT(p.inventory_account_id)   AS with_inventory_account,
       COUNT(p.cogs_account_id)        AS with_cogs_account
FROM public.products p
JOIN public.businesses b ON b.id = p.business_id
WHERE p.is_active
  AND p.track_inventory
  AND p.deleted_at IS NULL
  AND b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
GROUP BY b.name
ORDER BY b.name;


-- ── 6. Do the supporting accounts exist yet? ─────────────────────────────────
-- 2114 (GRNI) and 5180 (Inventory Adjustments) are added by migration
-- 20260728000005. Any 'MISSING' row means that migration has not been applied
-- to that business — the reconciliation button will fail until it is.

SELECT b.name AS business_name,
       x.code AS required_code,
       x.label,
       CASE WHEN a.id IS NULL THEN 'MISSING — run migration 20260728000005'
            ELSE 'present' END AS status
FROM public.businesses b
CROSS JOIN (
  VALUES ('1141', 'Trading Stock (inventory asset)'),
         ('5100', 'Cost of Goods Sold'),
         ('2114', 'Goods Received Not Invoiced'),
         ('5180', 'Inventory Adjustments & Shrinkage')
) AS x(code, label)
LEFT JOIN public.accounts a
       ON a.business_id = b.id
      AND a.code = x.code
      AND a.deleted_at IS NULL
WHERE b.deleted_at IS NULL
  -- AND b.id = 'paste-a-uuid-here'
ORDER BY b.name, x.code;
