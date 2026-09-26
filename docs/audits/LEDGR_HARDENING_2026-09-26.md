# LEDGR — Hardening package (2026-09-26)

| | |
|---|---|
| Instruction | Owner, 2026-09-26: "proceed and fix the app" (after the Incident Containment package, PR #185) |
| Branch | `arena/01a0d9f5-ledgr-react` (builds on the containment commit `ddb348a`) |
| Scope | Code-level fixes only. **No customer data read, changed or repaired.** Same stop rules as containment. |
| Production | Not deployed; no access → `PRODUCTION RUNTIME VALIDATION BLOCKED` |

## 1. What was fixed

| # | Defect | Fix | Evidence |
|---|---|---|---|
| H1 | **Non-POS sales (Income page, mobile quick income, offline sync engine, POS legacy fallback) released stock from the client, then posted COGS in a second call that *swallowed* failures** (`postCogsForSale` returned `null`). Stock could leave the shelf with no cost of sales: the same defect class P5 fixed for the POS. This was the "`inventoryJournalService` non-atomic" residual. | New server command `record_sale_stock_and_cogs(invoice_id, lines)`. In one transaction it authorises (sales writer + branch access), locks the invoice, refuses draft/void/credit-note, is idempotent per invoice, uses the same location rule as POS sales (`_ledgr_stock_location`), reads the average cost before the movement, and posts the keyed COGS entry (`invoice:<id>:cogs`). **Any failure raises and nothing partial persists.** `deductStockAndPostCogs` now makes that single call and throws on failure; `postCogsForSale` no longer swallows. | HARD.STOCK.ATOMIC-SUCCESS-AND-REPLAY, HARD.STOCK.COGS-FAILURE-ROLLS-BACK, HARD.STOCK.REFUSES-NON-SALES, HARD.STOCK.ISOLATION; unit `stockCogsAtomic.test.ts` (4) |
| H2 | Legacy invoices whose stock moved but whose COGS never posted | Detected and **reported** (`cogs_missing: true`, logged as an error). **Not repaired**: historical repair is not authorised. | HARD.STOCK.LEGACY-PARTIAL-REPORTED-NOT-REPAIRED |
| H3 | Income page treated a failed revenue journal as "non-critical" (logged a warning, showed "Invoice created successfully"); mobile quick income swallowed both journal and stock failures | Both now show the user an error saying the invoice was saved but its posting failed, and to contact support before retrying. No silent success. | tsc/lint; unit suite |
| H4 | `backfill_and_recalculate_inventory` had no status filter (REPRODUCED: draft/void/credit-note deducted) and picked its location with an unordered `LIMIT 1` | Logic fixed: invoices limited to status ∉ {draft, void, credit_note} and type ≠ credit_note; expenses limited to status ∉ {draft, void, rejected, cancelled}; location = `_ledgr_stock_location`. **Still not executable by anon/authenticated** (grants restated); running it remains an owner-authorised repair decision. | HARD.BACKFILL.STATUS-AND-LOCATION (run as service_role inside a rolled-back transaction) |
| H5 | No index for "has this document moved stock?" lookups (sequential scans on every sale/replay check) | `idx_stock_movements_business_source (business_id, source_type, source_id)` | HARD.INDEX-AND-GRANTS |
| H6 | INSERT on `invoices`/`invoice_lines` for `authenticated` came from undeclared Supabase platform defaults | Declared in the migration. RLS is unchanged and remains the authority. The release harness **no longer emulates** the grant; the migration chain alone provides it. | HARD.INDEX-AND-GRANTS, IC.INV.* (now pass without emulation) |

Migration: `supabase/migrations/20261011000005_hardening_stock_cogs_backfill_grants.sql`. It is forward-only, contains no DML against existing rows, and doesn't edit any historical migration.

Files changed:
- `src/services/inventoryJournalService.ts`
- `src/dal/repositories/InventoryRepository.ts` (`recordSaleStockAndCogs`)
- `src/pages/IncomePage.tsx`
- `src/components/mobile/QuickIncomeMobile.tsx`
- `src/lib/demo/client.ts` (demo mirror)
- `src/services/__tests__/stockCogsAtomic.test.ts` (new)
- `tests/release/ic-containment.test.ts` (+7 `HARD.*` records; emulation removed)

## 2. Verification (sandbox, synthetic data)

- Unit: **898 / 898 PASS** (894 + 4 new).
- Release gate: **780 PASS / 0 FAIL / 54 BLOCKED**, i.e. the containment run's 773 plus 7 new `HARD.*` records, all PASS. The 742 PASS / 54 BLOCKED distribution of the original baseline records is unchanged. (The per-id baseline file from `/tmp` was lost when the sandbox was restored; the counts match exactly, and all 31 `IC.*` records still pass.)
- `tsc` (app, node, release) clean. ESLint shows 0 errors (3 pre-existing warnings).

## 3. Deliberately NOT changed (needs a decision or a separate package)

| Item | Why not now |
|---|---|
| `post_pos_sale` trusts client prices | Enforcing catalogue prices server-side would block legitimate till price overrides and discounts. Whether cashiers may override prices, and within what limits, is an **OWNER DECISION**. Once decided, it's a small server check. |
| `invoices_writer_update` RLS lets writers UPDATE invoices directly (R07 bypass) | The app legitimately updates invoices directly (journal links in `journalService`, `posService`). Closing it needs a column-level guard designed against the R07 approval contract; a blunt RLS change would break working flows. Proposed as its own package. |
| Multiple Vercel projects | Platform configuration, not code. The owner or operator must pick the one project that serves production. |
| Warehouse-vs-branch POS selling | **OWNER DECISION** (unchanged from containment). |
| Any historical data repair | **NOT AUTHORIZED.** |

## 4. Deploy note

Ship with the containment package (PR #185), frontend and DB together. The new frontend calls `record_sale_stock_and_cogs`; an old frontend keeps working against the new DB (it never calls it). Run the P0 evidence runbook before deploying.

## Status

| Area | Status |
|---|---|
| Non-POS stock + COGS atomicity | **COMPLETE** |
| Silent posting failures (Income / mobile) | **COMPLETE** |
| Backfill logic | **COMPLETE** (still contained; running it = repair decision) |
| stock_movements index | **COMPLETE** |
| Invoice insert grants declared | **COMPLETE** |
| POS price authority | **DECISION REQUIRED** |
| R07 invoice-update bypass | **NEXT PACKAGE** (design needed) |
| Vercel consolidation | **BLOCKED** (platform access) |
| Production validation | **BLOCKED** |
| Historical data repair | **NOT AUTHORIZED** |
