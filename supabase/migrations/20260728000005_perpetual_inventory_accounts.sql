-- ============================================================================
-- Migration: Perpetual inventory — supporting GL accounts
--
-- Context
-- -------
-- Stock was tracked only in `stock_movements` / `inventory_balances`. No code
-- path posted a journal line to an inventory account, so accounts 1141-1145
-- always had a nil GL balance. The Statement of Financial Position hides
-- accounts whose balance rounds to zero, so Inventory never appeared under
-- Current Assets even when the warehouse held stock.
--
-- The application now posts perpetual inventory:
--     purchase of tracked stock   DR 1141 Inventory  CR Cash / Creditors
--     sale of tracked stock       DR 5100 COGS       CR 1141 Inventory
--     warehouse receipt           DR 1141 Inventory  CR 2114 GRNI
--     adjustment / reconciliation DR/CR 5180 Inventory Adjustments
--
-- This migration adds the two new accounts (2114, 5180) to every existing
-- business. New businesses get them from seedChartOfAccounts.ts.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ── 1. Goods Received Not Invoiced (2114) ────────────────────────────────────
-- The credit side of a warehouse receipt. Stock is on the shelf and owed for,
-- but the supplier has not invoiced yet, so the credit cannot go to cash or
-- to a specific creditor.

INSERT INTO public.accounts (
  business_id, code, name, description,
  account_type, account_subtype, normal_balance,
  is_group, is_system, is_bank_account,
  tax_code, currency, opening_balance, is_active,
  parent_id
)
SELECT
  b.id,
  '2114',
  'Goods Received Not Invoiced',
  'Stock received into the warehouse but not yet invoiced by the supplier (GRNI)',
  'liability',
  'current_liability',
  'credit',
  false, true, false,
  'none', 'MWK', 0, true,
  (SELECT p.id FROM public.accounts p
    WHERE p.business_id = b.id AND p.code = '2110' AND p.deleted_at IS NULL
    LIMIT 1)
FROM public.businesses b
WHERE b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.business_id = b.id AND a.code = '2114'
  );


-- ── 2. Inventory Adjustments & Shrinkage (5180) ──────────────────────────────
-- Contra account for stock write-offs, shrinkage, manual movements and the
-- subledger/GL reconciliation. Sits under cost_of_sales so gross profit
-- corrects by the adjustment amount.

INSERT INTO public.accounts (
  business_id, code, name, description,
  account_type, account_subtype, normal_balance,
  is_group, is_system, is_bank_account,
  tax_code, currency, opening_balance, is_active,
  parent_id
)
SELECT
  b.id,
  '5180',
  'Inventory Adjustments & Shrinkage',
  'Stock write-offs, shrinkage and reconciliation of the stock subledger to the general ledger',
  'expense',
  'cost_of_sales',
  'debit',
  false, true, false,
  'none', 'MWK', 0, true,
  (SELECT p.id FROM public.accounts p
    WHERE p.business_id = b.id AND p.code = '5000' AND p.deleted_at IS NULL
    LIMIT 1)
FROM public.businesses b
WHERE b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
    WHERE a.business_id = b.id AND a.code = '5180'
  );


-- ── 3. Repair inventory accounts with a NULL subtype ─────────────────────────
-- An account_subtype of NULL drops an account from EVERY section of the
-- Statement of Financial Position — including Total Assets — which also
-- silently unbalances the statement. Any 114x posting account must be a
-- current asset. Only NULL values are touched; a deliberate reclassification
-- by the user is left alone.

UPDATE public.accounts
SET account_subtype = 'current_asset',
    updated_at = now()
WHERE code LIKE '114%'
  AND account_type = 'asset'
  AND is_group = false
  AND account_subtype IS NULL
  AND deleted_at IS NULL;


-- ── 4. Report: which businesses hold stock that is missing from the ledger ───
-- Read-only helper. No journal entries are posted automatically: the value of
-- the catch-up entry depends on the current average cost, and posting into a
-- closed period without the user's knowledge would rewrite published
-- financial statements. Users post it from Warehouse → Ledger reconciliation.

CREATE OR REPLACE VIEW public.v_inventory_ledger_variance AS
WITH subledger AS (
  SELECT
    ib.business_id,
    COALESCE(SUM(ib.quantity_on_hand * ib.average_cost), 0) AS subledger_value
  FROM public.inventory_balances ib
  GROUP BY ib.business_id
),
ledger AS (
  SELECT
    a.business_id,
    COALESCE(SUM(
      CASE WHEN jl.is_debit THEN jl.amount_base ELSE -jl.amount_base END
    ), 0) AS ledger_balance
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
SELECT
  b.id                                        AS business_id,
  b.name                                      AS business_name,
  COALESCE(s.subledger_value, 0)              AS stock_on_hand_value,
  COALESCE(l.ledger_balance, 0)               AS inventory_ledger_balance,
  COALESCE(s.subledger_value, 0)
    - COALESCE(l.ledger_balance, 0)           AS variance,
  CASE
    WHEN ABS(COALESCE(s.subledger_value, 0) - COALESCE(l.ledger_balance, 0)) < 0.01
      THEN 'reconciled'
    WHEN COALESCE(s.subledger_value, 0) > COALESCE(l.ledger_balance, 0)
      THEN 'missing from balance sheet'
    ELSE 'overstated on balance sheet'
  END                                         AS status
FROM public.businesses b
LEFT JOIN subledger s ON s.business_id = b.id
LEFT JOIN ledger    l ON l.business_id = b.id
WHERE b.deleted_at IS NULL;

COMMENT ON VIEW public.v_inventory_ledger_variance IS
  'Stock subledger value vs the inventory GL balance per business. A non-zero variance means Inventory on the Statement of Financial Position disagrees with the warehouse. Post the correction from Warehouse -> Ledger reconciliation.';

GRANT SELECT ON public.v_inventory_ledger_variance TO authenticated;
