# LEDGR — Incident Containment & Integrity Remediation (2026-09-25)

| | |
|---|---|
| Authorised by | Alexander Gremu (owner), 2026-09-25 |
| Branch | `arena/01a0d9f5-ledgr-react` |
| Code baseline | `f671656` (= `origin/main` at start). Crawl report commit `17c4794`. |
| Evidence chain | **New chain, starts here.** No R00–R12, P2a or crawl evidence or report was modified. |
| Production access | **None.** → `PRODUCTION RUNTIME VALIDATION BLOCKED` |
| Customer data repair | **NOT AUTHORISED / not performed** |

---

## 1. Baseline

- Code: `f671656` (production frontend, DB and edge were all deployed at this commit on 2026-09-25 18:41 UTC, per the crawl).
- Previously verified P2a gate: 742 PASS / 0 FAIL / 40 BLOCKED / 782.
- Release gate re-run on `f671656` in this sandbox **before any change**: **742 PASS / 0 FAIL / 54 BLOCKED** (the gate has grown since P2a; the 54 BLOCKED are environment-scoped: storage, a real PostgREST/GoTrue for browser revalidation, and similar). Sanitised evidence: `/tmp/keep/before.json` (sandbox-local, not committed).
- Unit suite at baseline: 837 PASS.
- Source of the findings: `docs/audits/LEDGR_EMERGENCY_INTEGRITY_PERFORMANCE_CRAWL_2026-09-25.md`.

## 2. Findings addressed (from the crawl)

| # | Finding | Crawl status | Package |
|---|---|---|---|
| F1 | Repair workflow ran production data SQL automatically on push to `main` | CONFIRMED CRITICAL | P1 |
| F2 | `backfill_and_recalculate_inventory` callable by authenticated users; no status filter (draft/void/credit-note deducted) | REPRODUCED HIGH | P2 |
| F3 | `ai-chat` read `ai_context` with **service_role** and honoured a client-supplied branch id → branch scope bypass | CONFIRMED HIGH | P3 |
| F4 | POS display read balances from a different location than the sale deducts from; a balance-read failure rendered as "Out"/0 | CONFIRMED MEDIUM | P4 |
| F5 | COGS posting failure swallowed; the sale returned success with no COGS | CONFIRMED HIGH | P5 |
| F6 | `recordPayment` was a non-atomic client sequence (insert, then RPC increment, then status, then journal); retries could duplicate | CONFIRMED HIGH | P6 |
| F7 | `createWithLines` inserted the header, then the lines, separately → orphan headers on failure | CONFIRMED MEDIUM | P7 |
| F8 | PWA service worker served any REST GET NetworkFirst with a 4 s timeout and a 24 h cache → stale financial data shown as current | CONFIRMED MEDIUM | P8 |
| F9 | 2026-09-24 19:12/19:17: DB and edge deployed but the Vercel deploy failed → ~23.5 h mixed-version window (stale frontend vs the R08 revoke → shift open/close 42501) | CONFIRMED | P9 |

No evidence of compromise was found. None is asserted.

## 3. Containment actions

**P0 evidence preservation.** There is no production access, so I wrote an exact operator runbook: `docs/runbooks/IC_2026-09-25_P0_EVIDENCE_PRESERVATION.md`. It is read-only, uses secrets from environment variables only, takes a repeatable-read snapshot, and seals the bundle with sha256 and gpg. It covers every table the owner listed (inventory_balances, stock_movements, journal_entries/lines, invoices/lines/payments, expenses/lines/payments), `schema_migrations`, function definitions with md5, triggers and their enabled state, RLS policies and flags, table and function grants, constraints, Supabase Postgres and audit logs, GitHub repair and deploy runs with annotations, logs and artifacts, Vercel deployments for all three projects, and incident triage slices. **It has NOT been executed. It must be run before deploying this package.**

**P1 repair workflow gated.** `.github/workflows/repair-eagle-nova-double-count.yml`:
- the `push: main` trigger is removed;
- `workflow_dispatch` only;
- the job runs only if all of the following hold: the event is a dispatch, `ref == main`, the actor is the repository owner, `vars.LEDGR_REPAIR_WORKFLOW_ENABLED == 'true'` (unset means disabled), and the confirmation phrase has been typed;
- `dry_run` defaults to true;
- the free-form `ref` input is removed.

The scripts, past runs and migrations are preserved. It cannot run from a PR, a test or a merge.

**P2 backfill blocked server-side.** Migration `20261011000000` revokes EXECUTE on `backfill_and_recalculate_inventory(uuid)` from `PUBLIC`, `anon` and `authenticated`. EXECUTE is kept for `service_role`, so the operator path still exists. The function body is unchanged. `WarehousePage` also shows a suspension notice and disables the sync button (`STOCK_SYNC_SUSPENDED`), but the grant is the actual control.

**P3 AI branch path is now server-authoritative.** `ai-chat` builds the data context with a client bound to the **caller's JWT** (anon key plus the caller's `Authorization` header), never service_role. `ai_context`'s authenticated path is therefore the single authority for:
- membership and reports-role;
- the requested branch belonging to the business and passing `can_access_branch`;
- the DEC-03 fallback when the branch is omitted (assigned-scope roles are confined to their branch, a NULL assignment fails closed, org-wide roles keep org-wide scope).

A 42501 or 22023 becomes HTTP 403 with no data and no provider call. If `SUPABASE_ANON_KEY` is missing, the handler fails closed with a 500. The existing handler checks for membership and role are kept, so access is not broadened. The RPC was not changed.

**P4 POS: one location contract.** New read-only RPC `pos_stock_availability(business, branch)` (migration `20261011000004`):
- it returns quantities (no cost data) for exactly the location that `post_pos_sale` deducts from (`_ledgr_stock_location`), plus an `is_fallback` flag;
- it is gated by `can_operate_pos`, a branch-in-business check and `can_access_branch`.

POS changes:
- `PosPage` uses it;
- a failed read is shown as an error state (`PosStockStatusBanner`) with stock "unknown", **never 0 or "Out"**;
- the catalog does not block on unknown stock; the server remains the authority at sale time.

`chk_inventory_balances_on_hand_nonneg`, R06 and R08 are untouched. **Warehouse-vs-branch selling policy: OWNER DECISION REQUIRED.** Today a branch without its own location sells from the business default location. That is now *displayed honestly* via `is_fallback`, but the policy itself was not chosen or changed.

**P5 COGS failure is atomic.** Migration `20261011000001` redefines `_ledgr_complete_pos_sale` and `save_quick_sale` so that a COGS posting exception re-raises (P0001 "COGS posting failed … The sale was not recorded") instead of being swallowed. The entire sale rolls back: invoice, movements, payment and journals. No historical COGS repair.

**P6 atomic, idempotent payments.** Migration `20261011000002` adds `record_invoice_payment(jsonb, client_key)` and `record_expense_payment(jsonb, client_key)`. Each is a SECURITY DEFINER function that does all of the following in one transaction, with an RLS-equivalent authorisation intersection:
- authorise (42501);
- lock the document row;
- replay by `client_key`, returning the committed payment with `idempotent: true` (key reuse on another document gives 22023);
- validate: amount > 0, not void/credit_note, no overpayment beyond 0.01 (23514);
- insert the allow-listed columns;
- update `amount_paid` and status;
- post the keyed settlement journal (same posting key and FX treatment as the client path);
- link the journal.

A unique-violation race resolves to a replay. `InvoiceRepository`, `ExpenseRepository`, `InvoicesPage`, `syncEngine` and the demo client now call these RPCs; the multi-step client sequence is gone.

**P7 atomic invoice creation.** Migration `20261011000003` adds `create_invoice_with_lines(header, lines, client_key)`. It is **SECURITY INVOKER**, so RLS is unchanged and remains the authority. It inserts the header, reserves the number in the same transaction, inserts all the lines, and handles `client_key` replay. Any failure rolls back everything, including the document number. `InvoiceRepository.createWithLines` uses it. No orphan cleanup was performed.

**P8 no stale financial reads from the SW.** `src/lib/swApiCachePolicy.ts` defines the financial REST resources: all `rpc/`, all `v_` views, ledger, invoices, expenses, payments, inventory, bank, tax, payroll and POS money. `vite.config.ts` registers a **NetworkOnly** workbox rule for them *before* the generic `/rest/v1/` rule, so the SW never stores or serves them and a network failure surfaces as an error. Non-financial reference data keeps NetworkFirst. The R09.1 logout wipe, the offline queue and the SW itself are unchanged.

**P9 deploy safeguards.** `.github/workflows/deploy.yml`, for staging and production:
- records `MIGRATION_TARGET` (the newest migration in the commit; `scripts/ci/migration-target.mjs`);
- pre-flights the frontend deploy credentials **before** migrating, so a missing Vercel token or project fails before the DB moves;
- verifies the remote DB reached the target (`scripts/ci/verify-migration-target.sh`);
- surfaces the Vercel error;
- verifies the deployed `/version.json` commit and migration target;
- always writes and uploads a release manifest (`scripts/ci/release-manifest.mjs`), which raises a loud **MIXED-VERSION** failure when the backend moved but the frontend did not.

The build emits `/version.json` (`commit`, `migrationTarget`, `builtAt`), and `vercel.json` gives it no-cache headers. No rollback of DB migrations was invented.

**P10 contracts preserved.** R05–R12 are covered by the unchanged release gate (§8): zero status changes across all 796 pre-existing records.

## 4. Files and functions changed

**Workflows and CI:**
- `.github/workflows/repair-eagle-nova-double-count.yml` (P1);
- `.github/workflows/deploy.yml` (P9);
- `scripts/ci/migration-target.mjs` (+ `.d.mts`), `scripts/ci/release-manifest.mjs`, `scripts/ci/verify-migration-target.sh` (new);
- `vercel.json`, `vite.config.ts`, `.gitignore` (`artifacts/release/`).

**Edge:** `supabase/functions/ai-chat/index.ts`, covering `buildDataContext`, the user-JWT client and the 403 mapping.

**DB:** 5 new migrations (§5). New functions:
- `record_invoice_payment`
- `record_expense_payment`
- `create_invoice_with_lines`
- `pos_stock_availability`

Redefined functions:
- `_ledgr_complete_pos_sale`
- `save_quick_sale`

Grant change: `backfill_and_recalculate_inventory`.

**Frontend:**
- `src/dal/repositories/InvoiceRepository.ts`, `ExpenseRepository.ts`
- `src/pages/InvoicesPage.tsx`, `PosPage.tsx`, `WarehousePage.tsx`
- `src/offline/syncEngine.ts`
- `src/components/pos/PosProductCatalog.tsx`, `PosStockStatusBanner.tsx` (new)
- `src/types/pos.ts`
- `src/lib/swApiCachePolicy.ts` (new)
- `src/lib/demo/client.ts` (demo mirrors of the new RPCs)

**Tests:**
- `src/dal/repositories/__tests__/idempotency.test.ts` and `paymentGuard.test.ts` (rewritten to the RPC contract);
- new: `src/components/pos/__tests__/PosStockUnknown.test.tsx`, `src/lib/__tests__/swApiCachePolicy.test.ts`, `src/lib/__tests__/incidentContainmentContracts.test.ts`;
- `tests/release/ic-containment.test.ts` (new suite);
- `tests/release/r094-browser.test.ts` (1 additive record);
- `tests/release/gate.mjs` (suite registered);
- `tests/release/edge-loader.mjs` (optional per-key `createClient` factory; the default behaviour is unchanged).

**Docs:** this report and `docs/runbooks/IC_2026-09-25_P0_EVIDENCE_PRESERVATION.md`.

## 5. Migrations

| Version | Purpose | Data touched |
|---|---|---|
| `20261011000000_ic_contain_backfill_execute` | revoke EXECUTE on backfill from PUBLIC/anon/authenticated; keep service_role | none |
| `20261011000001_ic_cogs_failure_atomic` | COGS failure re-raises (POS + quick sale) | none |
| `20261011000002_ic_atomic_payment_commands` | atomic idempotent invoice and expense payment RPCs | none |
| `20261011000003_ic_atomic_invoice_create` | atomic header+lines+number (SECURITY INVOKER) | none |
| `20261011000004_ic_pos_stock_availability` | read-only POS availability for the deduction location | none |

All are forward-only, idempotent (`create or replace` / `revoke` / `grant`) and contain no DML. No historical migration was edited. `20261010000000` (the Eagle Nova data repair) is untouched and **must not be re-run**.

## 6. Safety rationale

- **No weakening:** no RLS policy was dropped or loosened, and no stock constraint was altered. The new SECURITY DEFINER payment functions re-implement the *intersection* of the existing write checks (`can_write_*`, `can_access_branch`, business match). IC.PAY.TENANT-AND-ROLE-ISOLATION proves that B-owner, viewer, an out-of-branch branch_manager and anon are all denied. The invoice function is SECURITY INVOKER, so RLS still decides.
- **Least-invasive P2:** a grant revoke rather than a function change or deletion. It is reversible by the owner with one statement.
- **P3** removes privilege (service_role → caller JWT) and adds no access paths. The handler's pre-checks are kept.
- **P4** adds a read-only RPC with no cost exposure. The deduction path (R06/R08) is unchanged, and overselling is still rejected with 23514 (IC.POS.CONSTRAINTS-INTACT).
- **P8** narrows SW caching. It does not disable the SW or alter the wipe or queue.
- **P9** changes only pipeline ordering and verification; no automatic DB rollback.
- **Out-of-scope items not touched:** balances, movements, opening_balance rows, journals, invoices, payments, WAC/COGS history, DEC-03/DEC-07.

## 7. Tests

**Unit (vitest):** **894 / 894 PASS** (98 files), up from 837. The new and rewritten tests:
- idempotency and paymentGuard: 11 tests, RPC contract; `from()` throws to prove no client-side multi-step writes; replay; 23514 → ValidationError; null result is an error;
- PosStockUnknown (jsdom): stock-unknown ≠ out-of-stock, and products are not disabled on a read error;
- swApiCachePolicy: financial vs reference classification;
- incidentContainmentContracts: P1 workflow gate, P2 revoke and WarehousePage, P3 user-JWT client, P5 no-warning path, P9 step ordering.

**Release suite `ic-containment` (real PostgreSQL 17, full migration replay, synthetic fixtures), 30 records, all PASS:**

| Area | Records |
|---|---|
| Backfill | IC.BACKFILL.AUTHENTICATED-DENIED, IC.BACKFILL.ANON-AND-PUBLIC-DENIED |
| AI branch (DB) | IC.AI.OWN-BRANCH-ALLOWED, IC.AI.OTHER-BRANCH-DENIED, IC.AI.OMITTED-BRANCH-DEC03, IC.AI.ORGWIDE-ROLE-KEEPS-SCOPE, IC.AI.CROSS-BUSINESS-DENIED, IC.AI.ANON-DENIED, IC.AI.FORGED-BRANCH-DENIED |
| AI branch (Edge) | IC.AI.EDGE.CALLER-JWT-AUTHORITY, IC.AI.EDGE.FORGED-BRANCH-403 |
| POS location | IC.POS.DISPLAY-EQUALS-DEDUCTION, IC.POS.FALLBACK-FLAGGED, IC.POS.AVAILABILITY-SCOPED, IC.POS.CONSTRAINTS-INTACT |
| COGS failure | IC.COGS.POS-FAILURE-ROLLS-BACK, IC.COGS.QUICK-SALE-FAILURE-ROLLS-BACK |
| Atomic payment | IC.PAY.ATOMIC-SUCCESS, IC.PAY.REPLAY-RETURNS-COMMITTED, IC.PAY.VALIDATION-REJECTS, IC.PAY.JOURNAL-FAILURE-ATOMIC, IC.PAY.TENANT-AND-ROLE-ISOLATION, IC.PAY.CONCURRENT-SAME-KEY, IC.PAY.CONCURRENT-OVERPAY-SERIALISED, IC.PAY.EXPENSE-ATOMIC-IDEMPOTENT |
| Invoice atomicity | IC.INV.ATOMIC-SUCCESS-AND-REPLAY, IC.INV.LINE-FAILURE-NO-ORPHAN, IC.INV.RLS-PRESERVED, IC.INV.CONCURRENT-SAME-KEY |
| Deploy skew | IC.DEPLOY.SKEW-GUARD (replays the 09-24 pattern → `mixedVersion=true`, `MIXED-VERSION` verdict; the good path → `RELEASED`) |

**Stale API (real Chromium + production SW build), 1 record, PASS:** IC.CACHE.BROWSER-FINANCIAL-NETWORK-ONLY. Invoices, invoice_payments, expenses, journal_entries and inventory_balances each reach the network on **every** request (2/2), with **zero** entries in the workbox API cache, while `products` is still cached (control).

**Typecheck / lint:** `tsc -p tsconfig.app.json`, `tsconfig.node.json` and `tests/release/tsconfig.json` are all clean. ESLint shows 0 errors (the 3 warnings pre-exist at baseline).

**Harness note (declared):** the migration chain never grants table-level INSERT on `invoices`/`invoice_lines` to `authenticated`. Production relies on Supabase platform default privileges, as the pre-existing direct-insert client path already did. Because `create_invoice_with_lines` is SECURITY INVOKER, the `ic-containment` suite emulates that platform default (INSERT only, those two tables only) in its disposable database. RLS remains the authority and is asserted by IC.INV.RLS-PRESERVED. This is recorded as a gap in §12.

## 8. Regression

Full `npm run test:release` after the changes: **773 PASS / 0 FAIL / 54 BLOCKED** (baseline 742 / 0 / 54).
- Compared by record id against the baseline: **0 status changes, 0 missing records**; +31 new records (30 `IC.*` in `ic-containment` + 1 `IC.CACHE.*` in `r094-browser`), all PASS.
- The 54 BLOCKED ids are identical to the baseline (environment-scoped, unchanged).
- The gate exits with code 2 because BLOCKED records are present, same as at baseline.

R05/R06/R07/R08/R09/R10/R12 contracts: preserved (all their records keep their baseline status).

## 9. Production deploy state

`PRODUCTION RUNTIME VALIDATION BLOCKED` (no production credentials, by design).
- Nothing in this package has been deployed. Production runs `f671656`, as of the crawl.
- Local PostgreSQL results do **not** prove production behaviour. Before relying on them in production, the operator must:
  1. run the P0 runbook and seal the evidence;
  2. confirm on production that `schema/functions.csv` matches the repository's functions (out-of-band DDL is SUSPECTED);
  3. deploy via `deploy.yml`, then read the release manifest artifact and `/version.json`;
  4. spot-check: `select has_function_privilege('authenticated','public.backfill_and_recalculate_inventory(uuid)','execute')` must return false;
  5. set **no** value for `LEDGR_REPAIR_WORKFLOW_ENABLED` (leave it unset).
- The deploy must ship the **frontend and DB together**. The new frontend calls `record_invoice_payment`, `create_invoice_with_lines` and `pos_stock_availability`, and the P9 pre-flight exists precisely to stop a repeat of 09-24.

## 10. Remaining integrity risk

- **Historical damage is unrepaired, and its scope is unknown.** This covers:
  - double-counted balances beyond Eagle Nova;
  - the direct `inventory_balances` UPDATE by `20261010000000` (GL ≠ subledger);
  - backfill deductions of draft/void/credit-note documents;
  - sales posted without COGS;
  - possible duplicate or partial payments and orphan invoice headers.

  The P0 slices (§1a of the runbook) are designed to size this.
- `inventoryJournalService.ts` (~line 542) is still a non-atomic multi-step client write.
- `post_pos_sale` trusts client-supplied prices and totals. `products` is still SW-cached as reference data, so displayed prices can be up to 24 h stale.
- `invoices_writer_update` RLS still permits direct UPDATEs that bypass R07 (known residual, not a regression).
- No index on `stock_movements(business_id, source_type, source_id)` (performance).

## 11. Remaining security risk

- SUSPECTED out-of-band production DDL is not verified (needs P0 §2).
- Multiple Vercel projects (`ledgr-react`, `-prod`, `-hp5u`) → config drift. Which project serves the production domain must be confirmed.
- The table INSERT privileges on invoices/invoice_lines are undeclared platform defaults (§7 note). The owner should decide whether to declare them in a migration.
- The repair workflow still exists and still holds the production token via its environment. It is gated, not deleted (per instruction). The owner should consider scoping the Production environment's required reviewers.
- `service_role` can still execute the backfill. That is intended for operators, but it must not be run until the status-filter defect is fixed.

## 12. Gaps

- **P0 not executed** (no access). The evidence exists only as a runbook.
- No production verification of any P1–P9 change (§9).
- The browser SW test runs against the local stub backend, not a real PostgREST/GoTrue (the existing R094 BLOCKED limitation).
- The Edge tests use the local Node VM with mocked Auth, not the Deno gateway.
- The invoice-insert privilege is emulated in the harness (§7).
- The backfill function body still lacks a status filter. It is blocked, not fixed, because fixing it touches the repair semantics.
- POS warehouse-vs-branch selling policy is undecided (owner).

## 13. Unaddressed repair (NOT AUTHORISED)

None of the following was done:
- recalculating balances;
- rewriting or deleting movements or opening_balance rows;
- reversing or recreating journals;
- altering invoices or payments;
- repairing WAC/COGS;
- running the backfill, `20261010000000` or the repair workflow;
- orphan cleanup;
- deleting workflow runs or repair SQL.

Each needs a separate owner-authorised package, based on the sealed P0 evidence.

## 14. Next packages (proposed; not started)

1. **Evidence execution:** the operator runs P0 and seals it, then does the functions md5 diff vs the repository (out-of-band DDL verdict).
2. **Deploy of this package** through the hardened pipeline, then production spot-checks (§9).
3. **Damage scoping:** read-only per-business drift report (subledger vs GL vs movements) from the P0 export.
4. **Owner decision:** warehouse-vs-branch POS selling policy.
5. **Repair design** (only once authorised): a per-business, reviewed, reversible adjusting-entry approach, never a direct balance UPDATE.
6. **Hardening:**
   - fix the backfill status filter (then reconsider the grant);
   - server-side price authority in `post_pos_sale`;
   - make `inventoryJournalService` atomic;
   - close the `invoices_writer_update` R07 bypass;
   - declare the invoice INSERT grants;
   - add the `stock_movements` source index;
   - consolidate the Vercel projects.

---

## Final status

| Area | Status | Note |
|---|---|---|
| Evidence (P0) | **BLOCKED** | Runbook complete; execution needs production access |
| Repair workflow (P1) | **COMPLETE** | Auto-run removed; owner-only gated dispatch |
| Backfill (P2) | **COMPLETE** | EXECUTE revoked from authenticated/anon/PUBLIC (release-verified) |
| AI branch (P3) | **COMPLETE** | Caller-JWT authority; 7 DB + 2 Edge records |
| POS (P4) | **COMPLETE / DECISION REQUIRED** | Single location contract + honest error state; warehouse-vs-branch policy = owner decision |
| COGS (P5) | **COMPLETE** | Failure rolls back the whole sale |
| Payment (P6) | **COMPLETE** | Atomic, idempotent, concurrency-safe |
| Invoice (P7) | **COMPLETE** | Atomic header+lines+number; RLS preserved |
| Cache (P8) | **COMPLETE** | Financial REST NetworkOnly (real-browser verified) |
| Deploy (P9) | **COMPLETE** | Pre-flight, target verification, version.json, mixed-version manifest |
| Production runtime validation | **BLOCKED** | `PRODUCTION RUNTIME VALIDATION BLOCKED` |
| Historical data repair | **NOT AUTHORIZED** | — |

All code-level containment is complete and locally verified. Production still runs `f671656` until an operator executes P0 and deploys. **STOP: package ends here.**
