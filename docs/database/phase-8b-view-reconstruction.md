# Phase 8B.2 — View Reconstruction

**Status:** ✅ COMPLETE — 4/4 views reconstructed from repository evidence,
8/8 functional tests passing on a fresh replay (PostgreSQL 18.4, 58
migrations), including the mandatory `SUM(debits) = SUM(credits)` trial
balance verification.

> **Honesty statement:** the original view bodies were NOT captured
> (production was out of scope). Column contracts are **[VERIFIED]** from
> `database.generated.ts` (live-derived); calculation semantics are
> **[VERIFIED]** from the repository consumers; any behaviour without direct
> evidence is **[INFERRED]** and marked. Reconstructions, not recoveries.

## Migration

- `supabase/migrations/20260815000002_phase8b_reconstruct_views.sql`

## 1. `v_trial_balance`

**Columns [VERIFIED]:** `business_id, code, name, account_type,
account_subtype, normal_balance, total_debits, total_credits, balance`

**Semantics [VERIFIED from FinancialStatementRepository.computeBalances]:**
- `journal_lines.amount_base` ONLY (MWK functional currency — multi-currency
  entries would otherwise misstate balances)
- `journal_entries.status IN ('posted','reversed')`
- `accounts.deleted_at IS NULL`; all accounts included (zero-activity
  accounts appear with 0s — verified)
- `total_debits` = Σ amount_base where `is_debit`; `total_credits` = Σ
  amount_base where NOT `is_debit`
- `balance` = signed sum, **positive on the account's natural side**
  (debit-normal accounts positive for debit balances; credit-normal positive
  for credit balances) — matches the repo's `normal_balance === 'debit' ?
  signedAmount : -signedAmount`

**Mandatory verification — PASS:**
```
SUM(total_debits) = SUM(total_credits)   → 1500 = 1500 on test data
```
For every business and reporting period, the view is derived from balanced
journal entries, so the equation holds by construction; the test asserts it
explicitly. (Unbalanced entries cannot exist: JournalRepository.validateBalanced
rejects |debits − credits| > 0.005 before posting.)

## 2. `v_ar_ageing`

**Columns [VERIFIED]:** `business_id, contact_id, contact_name, invoice_id,
invoice_number, issue_date, due_date, currency, total_amount, amount_paid,
amount_due, days_overdue, ageing_bucket`

**Semantics [VERIFIED from IncomeRepository.findOutstanding + comments]:**
- Filter: `invoice_type='invoice'`, `status IN ('sent','partially_paid',
  'overdue')`, `deleted_at IS NULL` — exactly the "open receivables" set;
  paid/draft/void/credit-note invoices excluded (verified: only the open
  invoice appears)
- `amount_due = coalesce(amount_due, coalesce(functional_amount,
  total_amount) - amount_paid)` — the repo's safe derivation (amount_due is
  nullable)
- `contact_name` via LEFT JOIN contacts

**Ageing buckets [INFERRED]:** `current / 1-30 / 31-60 / 61-90 / 90+` by
`days_overdue = current_date − due_date` (0 when not overdue). No bucket-label
evidence exists in the repository; the generated column is
`ageing_bucket: string | null` only.

## 3. `v_asset_register`

**Columns [VERIFIED]:** `business_id, asset_number, name, acquisition_cost,
acquisition_date, depreciable_amount, residual_value,
accumulated_depreciation, depreciation_method, last_depreciation_date,
net_book_value, status, category, branch, department`

**Semantics [VERIFIED]:**
- `net_book_value = coalesce(fa.net_book_value, acquisition_cost −
  accumulated_depreciation)` — the AssetsPage fallback formula
- `last_depreciation_date` = the value maintained by
  AssetRepository.postDepreciation (set to `depreciation_schedules.period_end`)
- `category`/`branch`/`department` names via LEFT JOINs
- All non-deleted assets included (status carries state; `is_active=false`
  is set for disposed/fully-depreciated assets, which must still appear)

## 4. `v_reorder_alerts`

**Columns [VERIFIED]:** `business_id, product_id, product_name, sku,
location_name, quantity_on_hand, quantity_reserved, quantity_available,
average_cost, reorder_level, reorder_quantity, estimated_reorder_cost`

**Semantics:**
- Alert condition [VERIFIED from WarehousePage]:
  `reorder_level IS NOT NULL AND quantity_available <= reorder_level`
  (fallback `coalesce(quantity_available, quantity_on_hand)` for NULL
  available — nullable column)
- Only tracked (`track_inventory=true`), active, non-deleted products
  [INFERRED — the "alerts" concept only applies to tracked inventory]
- `estimated_reorder_cost = reorder_quantity × average_cost` [INFERRED —
  column name implies it; no direct evidence]

## 5. RLS behaviour

All four views are **plain `security_invoker` views** — RLS on the underlying
tables (accounts, journal_lines, journal_entries, invoices, contacts,
fixed_assets, inventory_balances, products, inventory_locations) applies to
view access. This is the correct behaviour for Phase 8B.3: when policies are
added to the 30 currently policy-less tables, the views automatically enforce
tenant isolation. (The legacy views may have been `security_definer`; that
would have been a tenant-isolation weakness — not reproduced.)

## 6. Test evidence

`tests/database/view_reconstruction.test.js` — 8 assertions, all PASS:
- trial balance: debit account +1500 natural; credit account +1500 natural
- **trial balance equation: debits = credits** ✅
- zero-activity account appears with zeros
- AR ageing: only the open invoice (paid/draft excluded), amount_due 600,
  bucket 31-60 (45d), contact name resolved
- reorder alerts: only the low product (above-level product excluded),
  location name, estimated reorder cost 2500
- asset register: NBV 15000 (20000 − 5000), category/branch/department names

## 7. Remaining UNKNOWNs

| Item | Risk | Recommended action |
|---|---|---|
| Original ageing bucket labels | Cosmetic (report grouping) | None — labels are internal to the view |
| `estimated_reorder_cost` formula | Cosmetic (alert guidance) | None |
| Original views may have been `security_definer` | Security | Deliberately NOT reproduced (RLS bypass would violate Phase 8B) |
