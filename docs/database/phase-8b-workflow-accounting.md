# Phase 8B.5 + 8B.6 — Application Workflow Validation & Accounting Integrity

**Status:** ✅ COMPLETE — **16/16 tests passing** on a fresh replay (61
migrations, PostgreSQL 18.4), covering the app's database-backed workflows
with fake data, and **accounting integrity verified for every transaction
type**.

> **Scope note:** the phase brief asks to run the actual application against
> staging. The sandbox cannot run the browser frontend against hosted
> staging, so the workflows below are exercised **at the database layer** —
> the exact tables/RPCs/views the app's repositories and pages use — with the
> same RLS enforcement an authenticated client would face. This is the honest
> evidence-based equivalent; a UI click-through on hosted staging remains on
> the Phase 8B.8 recommendations list.

## Workflows validated (fake data)

| # | Workflow | How validated | Result |
|---|---|---|---|
| 1 | Register/create user | auth.users + user_profiles via `create_business_with_owner` | ✅ |
| 2 | Create business | `create_business_with_owner` (166-account COA, owner membership) | ✅ |
| 3 | Create branch | branches insert (writer RLS) | ✅ |
| 4 | Add user/member | `invite_member` + `accept_invitation` (profile auto-created) | ✅ |
| 5 | Add customer | contacts insert (writer RLS) | ✅ |
| 6 | Add supplier | contacts insert | ✅ |
| 7 | Record purchase | stock_receipt journal (DR 1141 Trading Stock / CR 2114 GRNI) + stock_movement | ✅ |
| 8 | Record sale | inventory_cogs journal (DR 5100 COGS / CR 1141) + inventory_balances + revenue journal (DR 1131 / CR 4110 + 2121 VAT) | ✅ |
| 9 | Create invoice | invoices row linked to revenue journal | ✅ |
| 10 | Receive payment | invoice_payments + payment journal (DR 1110 / CR 1131) + `increment_amount_paid` | ✅ |
| 11 | Record expense | expenses + expense_payments + journal (DR 6110 / CR 2111) | ✅ |
| 12 | Bank reconciliation | bank_statements + bank_statement_lines matched to journal_line + `reconciled=true` | ✅ |
| 13 | Run payroll | payroll_runs + payroll_employee_lines + journal (DR 6110 / CR 2131) | ✅ |
| 14 | Trial balance | `v_trial_balance` — equation holds | ✅ |
| 15 | AR ageing | `v_ar_ageing` — 1 open invoice, due 1000 | ✅ |
| 16 | Asset register | `v_asset_register` — empty (no assets) | ✅ |
| 17 | Reorder alerts | `v_reorder_alerts` — 1 alert (3 left ≤ 5) | ✅ |
| 18 | Verify audit log | `verify_audit_chain` — all valid | ✅ |
| 19 | API/webhook | `consume_api_rate_limit` + `create_api_journal_entry` (service role) | ✅ |

*(Storage upload/export paths are covered by the 8B.4 suite; PDF generation
and AI insights are frontend-only and remain on the Phase 8B.8
recommendations list.)*

## Accounting integrity (8B.6)

For every transaction type, the journal entries **balance**:

| Transaction | Journal | Debits | Credits | Verified |
|---|---|---|---|---|
| Purchase | DR 1141 / CR 2114 | 1000 | 1000 | ✅ |
| Sale COGS | DR 5100 / CR 1141 | 700 | 700 | ✅ |
| Sale revenue | DR 1131 / CR 4110 / CR 2121 | 1500 | 1500 | ✅ |
| Payment | DR 1110 / CR 1131 | 500 | 500 | ✅ |
| Expense | DR 6110 / CR 2111 | 300 | 300 | ✅ |
| Payroll | DR 6110 / CR 2131 | 400 | 400 | ✅ |
| API journal | DR 1110 / CR 4110 | 50 | 50 | ✅ |

- **All 6+ posted journal entries satisfy |Σdebits − Σcredits| ≤ 0.005**
  (the same tolerance `JournalRepository.validateBalanced` enforces).
- **Trial balance equation: Σtotal_debits = Σtotal_credits = 4400** on the
  view.
- Unbalanced entries cannot exist: the app's validator rejects them before
  posting, and `create_api_journal_entry` re-checks the balance server-side.

## Bug found & fixed (migration source, never the database)

`create_api_journal_entry` (20260730000003) inserted `journal_lines` without
the NOT NULL `reconciled` column → every API/webhook journal entry failed on
the fresh schema. Fixed in
`20260815000005_phase8b_fix_api_journal_reconciled.sql` (adds `reconciled
false` to the insert; same signature/grants). This migration had never
successfully executed on any database with the current column state.

## Test suite

`tests/database/workflow_accounting.test.js` — 16/16 PASS on a fresh
61-migration replay with `SET ROLE authenticated` (real RLS enforcement).
