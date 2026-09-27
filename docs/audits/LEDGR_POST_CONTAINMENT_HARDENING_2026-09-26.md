# Ledgr — Post-Containment Hardening Package (2026-09-26)

Owner authorisation: Alexander Gremu, "POST-CONTAINMENT HARDENING PACKAGE", 2026-09-26. Code hardening only.
Environment: local, disposable databases (embedded PostgreSQL 17, full migration replay, synthetic fixtures). **Nothing was deployed and no production system was written to.**

## 1. Starting commit
`cd25da2`, branch `arena/01a0d9f5-ledgr-react`. Its parent is containment `ddb348a`. Production still runs `f671656`.

## 2. Ending commit
- Code, migration and tests: **`033178f`**.
- This report is committed directly on top of it; that commit is the package's ending commit and is given in the PR / session hand-off.
- Nothing is deployed.

## 3. Files changed (cd25da2 → ending commit)
| File | Change |
|---|---|
| `supabase/migrations/20261012000000_post_containment_hardening.sql` | **new**: H-2, H-3, H-4 |
| `src/dal/repositories/InventoryRepository.ts` | `recordInventoryJournalMovement` (one RPC) + types |
| `src/pages/WarehousePage.tsx` | stock receipt uses the atomic command (no client movement write + swallowed GRNI post) |
| `src/pages/ProductsPage.tsx` | manual stock movement uses the atomic command (no client movement write + swallowed adjustment post) |
| `src/services/inventoryJournalService.ts` | `postWarehouseReceipt` / `postStockMovementAdjustment` marked `@deprecated` (no app callers left) |
| `src/dal/repositories/__tests__/inventoryJournalAtomic.test.ts` | **new**: 5 unit/source-contract tests |
| `tests/release/ic-containment.test.ts` | 15 new H0x records. `IC.POS.CONSTRAINTS-INTACT` payload made arithmetically consistent (see §6, H-2) |
| `tests/release/r07-corrections.test.ts` | `R07.VOID.NO-STATUS-GUARD` superseded in place (see §8) |
| `docs/audits/LEDGR_POST_CONTAINMENT_HARDENING_2026-09-26.md` | this report |

The R00–R12 / P2a reports and the containment report were **not modified**.

## 4. Migrations added
- `20261012000000_post_containment_hardening.sql`. Its top level contains only `create or replace function`, `create`/`drop trigger`, `revoke`/`grant` and `comment`. **No INSERT, UPDATE or DELETE statements** (mechanically checked). No balances, movements, journals, invoices or payments are touched.
- No historical migration was edited.
- H-1, H-5 and H-6 needed no new migration: the fixes (filters, grant, index) shipped in `20261011000005` (cd25da2). This package adds the evidence the owner asked for.

## 5. Defects addressed
| Area | Defect | Status |
|---|---|---|
| H-1 | Backfill wrote sale movements for draft/void/credit-note invoices (fixed in cd25da2) | **Proven**: regressions for non-sales AND legitimate statuses |
| H-2 | `post_pos_sale` trusted browser totals, discounts and VAT (only total > 0 and tenders = total were checked) | **Arithmetic enforced server-side**; price/discount-cap policy **DECISION REQUIRED** |
| H-3 | Receipts/adjustments: movement committed, then journal posted separately with errors swallowed → stock without GL | **Fixed**: one server transaction |
| H-4 | Any sales writer could PATCH a posted invoice (amounts, status → paid/void, lines) directly via REST | **Fixed** at the DB boundary; period/approval policy **DECISION REQUIRED** |
| H-4/H-5 (found by H05 test) | A B owner could insert an `invoice_lines` row tagged business B onto A's invoice (RLS evaluated `can_access_branch(B, NULL)`; no line↔invoice business check) | **Fixed** by the line guard |
| H-5 | Invoice INSERT grant (declared in cd25da2) | **Proven** least-privilege + RLS boundary |
| H-6 | Stock-movement source index (added in cd25da2) | **Justified with EXPLAIN evidence** |
| H-7 | Four Vercel projects, unclear canonical | **Inventoried** (read-only), recommendation below |

## 6. Before / after behaviour

**H-1 backfill.**
- Before cd25da2: every un-moved invoice was backfilled, whatever its status.
- Now: only `sent`, `paid`, `partially_paid` and `overdue` get a sale movement, at `_ledgr_stock_location`. `draft`, `void`, `credit_note` and `invoice_type='credit_note'` get none. Credit-note stock stays with the explicit R07 `return_in` movements (void/refund commands). A paid expense still backfills; a void expense doesn't.
- `backfill_and_recalculate_inventory` remains service-role only. It was never run against production, and the tests run it only inside rolled-back transactions.

**H-2 POS amounts.**
- Before: `post_pos_sale` was a self-described "executor" (client computed VAT/discount).
- Now, after the R06 product-tenant check (step 3b) and before the usage limit and number reservation, `_ledgr_assert_pos_sale_amounts` recomputes the client's own contract (`posService.calculateCartTotals`, tolerance 0.01). A mismatch returns `22023` and writes nothing. It checks:
  - per line: qty > 0, price ≥ 0, 0 ≤ discount ≤ qty × price, and `line_total = qty × price − discount`;
  - header: `line discounts ≤ discount_amount ≤ gross`, and `total = gross − discount_amount` (≤ Σ line totals);
  - `vat_amount = round2(total − total/1.175)` when `businesses.vat_registered`, else 0 (VAT-inclusive, `VAT_STANDARD_RATE`);
  - `subtotal + vat = total`.
- Idempotent replays return before validation (unchanged). R06/R07/R08/R10 paths are unchanged; the body is the p5a definition verbatim plus one call.
- The IC oversell fixture previously sent qty 101 with `line_total` 1500. It now sends a consistent 101 × 1500, so it still exercises the 23514 oversell check. Its evidence record is byte-identical.
- **Not enforced (policy):** unit price = current `products.sale_price`, and `pos_settings` discount caps. See §11.
- Known edge: a VAT-registration change while a till is offline makes queued sales computed at the old status fail with `22023` rather than posting wrong VAT.

**H-3 inventory journal.**
- Before:
  - WarehousePage: `recordMovements` → re-read → `postWarehouseReceipt` (errors swallowed, returns null).
  - ProductsPage: `recordMovement` → `postStockMovementAdjustment` (no posting key, errors swallowed).
- After: `record_inventory_journal_movement(p_payload)` (SECURITY DEFINER):
  - **Authorisation:** mirrors the `stock_movements` insert RLS (`can_write_business_data` + `can_access_location`); location and products must belong to the business, else `42501`.
  - **Idempotency:** an advisory lock on (business, source, client_key); a replay returns the committed ids; key reuse with a different payload returns `22023`.
  - **Writes:** inserts the movements (balances still written only by the R06 trigger; no second writer), then posts the keyed journal via `_ledgr_post_entry_keyed`, with the legacy rules and keys:
    - receipt: DR inventory (product account, else 1141) / CR 2114, `stock_receipt:<key>:grni`;
    - adjustment in: DR inventory / CR 5180; `adjustment_out` is reversed; key `stock_adjustment:<key>`;
    - untracked or zero-value lines: no journal, as before.
  - **Failure:** any failure rolls everything back. There is no client-side compensation.
- The duplicate-receipt repair tool is untouched.

**H-4 invoice edit authority.** New BEFORE triggers act only when `current_user` is `authenticated` or `anon`, i.e. direct PostgREST calls. SECURITY DEFINER commands (payments, R07 void/refund, POS, stock/COGS) run as owner and are unaffected.
- **Posted (non-draft) invoice:** nothing may change except linking `journal_entry_id` once (the legitimate `journalService` update) and derived columns (`updated_at`, `amount_due`, generated `exchange_rate_used`; `pos_shift_id` stays under its existing R08 guard). Direct delete is refused. The error names the changed columns.
- **Draft invoice:** editable; `draft → sent` allowed. Direct `→ paid/partially_paid/overdue/void/credit_note` is refused; those go through `record_invoice_payment` / R07 commands.
- **Lines:** insert/update/delete only on draft invoices, or on an invoice created in the same transaction (`create_invoice_with_lines` is SECURITY INVOKER). The parent must be visible to the caller and in the same business. Lines can't be moved between invoices.
- **Role:** unchanged (`can_write_sales_data`, RLS).
- **Financial period / approval:** no mechanism exists to enforce against. See §11.

**H-5.**
- `authenticated` holds INSERT on `invoices`/`invoice_lines`; `anon` holds none; RLS is enabled on both.
- Proven: writer create succeeds; viewer, cross-tenant and anon are denied; cross-tenant lines are denied.

**H-6.**
- Query: the per-document probe `business_id = $1 AND source_type = $2 AND source_id = $3` (`record_sale_stock_and_cogs` idempotency and backfill).
- Existing indexes did not cover `source_id`.
- On 20,000 synthetic movements (rolled back):
  - **without** `idx_stock_movements_business_source`: `Seq Scan`, estimated cost **816**;
  - **with** it: `Index Only Scan` on that index, cost **6.18**.
- The smallest useful index was kept: 3 columns, no INCLUDE.
- Post-deploy plan: re-run the same `EXPLAIN` on production read-only after the next approved deploy and confirm index usage via `pg_stat_user_indexes`.

## 7. Tests
- **Unit (vitest):** 100 files, **903/903 pass** (898 before + 5 new).
- **Typecheck:** app, node and release tsconfigs are clean.
- **ESLint:** 0 errors, 3 pre-existing warnings (unused disable directives).
- **Build:** passes with placeholder `VITE_SUPABASE_*`; without them `check-env` aborts as designed.
- **Browser:** the R09.4 real-Chromium suites (`r094-browser`, `r094-sw-update`) run inside the release gate and PASS.
- **New release records (15).** `ic-containment` runs them with synthetic identities, and every probe rolls back.

| ID | Result |
|---|---|
| H01.BACKFILL.NON-SALES-NO-MOVEMENT | PASS |
| H01.BACKFILL.VALID-STATUSES-BACKFILL | PASS |
| H02.POS.LEGIT-SALES-POST (plain, discounted, VAT-registered, replay) | PASS |
| H02.POS.TAMPERED-AMOUNTS-REJECTED (10 tamper cases → 22023, nothing written) | PASS |
| H02.POS.PRICING-POLICY | **BLOCKED — DECISION REQUIRED** |
| H03.INVJ.SUCCESS (receipt, adjustment out, adjustment in) | PASS |
| H03.INVJ.JOURNAL-FAILURE-ROLLS-BACK | PASS |
| H03.INVJ.STOCK-FAILURE-ROLLS-BACK (23514, R06 constraint intact) | PASS |
| H03.INVJ.RETRY-IDEMPOTENT (replay, key-reuse 22023, retry after fix) | PASS |
| H03.INVJ.ISOLATION (viewer, other owner, anon, B product, B location → 42501) | PASS |
| H04.INVOICE.POSTED-DIRECT-EDIT-DENIED | PASS |
| H04.INVOICE.LEGIT-WORKFLOWS-PRESERVED | PASS |
| H04.INVOICE.PERIOD-AND-APPROVAL-POLICY | **BLOCKED — DECISION REQUIRED** |
| H05.GRANT.AUTHORIZATION | PASS |
| H06.INDEX.EXPLAIN-EVIDENCE | PASS |

H-4 tests emulate the Supabase platform-default UPDATE/DELETE table grants inside the rolled-back probe. The bare migration replay lacks them, so without the emulation a denial could come from a missing privilege rather than the guard. Each denial also asserts the `(H-4)` guard message.

## 8. Gate counts
| Run | PASS | FAIL | BLOCKED | Total |
|---|---|---|---|---|
| cd25da2 baseline (regenerated in a temporary worktree this session) | 780 | 0 | 54 | 834 |
| This package, run A | 793 | 0 | 56 | 849 |
| This package, run B | 793 | 0 | 56 | 849 |

- 793 = 780 + 13 new PASS; 56 = 54 + the 2 DECISION REQUIRED records.
- Exit code 2 (BLOCKED records present) is the same as the baseline.

Per-ID comparison against the regenerated cd25da2 evidence:
- **0 records removed**; 15 added (all H0x).
- **833 of 834 baseline records byte-identical.**
- The single directly caused change is **`R07.VOID.NO-STATUS-GUARD`: status PASS → PASS; `expected` and `source` text changed.**
  - This record characterised the defect H-4 removes ("invoices has no status-transition guard trigger").
  - Following the suite's own precedent (absence proof superseded by a presence record under the same identity), it now asserts that exactly one invoices trigger references void: the H-4 guard.
  - The original expectation is kept verbatim in a code comment.
  - Before the supersession it FAILED as expected (run log retained locally).

## 9. Determinism
- Runs A and B were executed back to back on the same tree: per-ID `status` + `actual` are **identical (0 differences across 849 records)**.
- One earlier run (before run A) had the R09.4 service-worker browser suite not execute: 8 records BLOCKED "Test did not execute", plus `HARNESS.EXECUTION`. This is a tooling flake in the real-Chromium, two-build suite (it passed in the runs before and after, with no code change in between). It is disclosed rather than hidden; no assertion failed.

## 10. Vercel findings (H-7): read-only, nothing changed
**Sources:**
- GitHub deployment records per environment;
- deploy job logs for the 2026-09-25 runs (staging job 108161680637, production job 108203243533);
- public HTTP GETs.

**Limits:**
- There is no Vercel token in this sandbox, so Vercel project settings, domain lists and env-var values could not be read.
- GitHub Actions variables returned 403 to this token.
- Anything below that isn't sourced is marked unverified.

| Vercel project | Fed by | Supabase target | Latest production deploy | Public alias / status |
|---|---|---|---|---|
| **ledgr-react** (`prj_hMyLCYtJzeTD1bpOl8D9sEdszAYn`) | `deploy.yml` **Production** job (`vercel deploy --prod`, CLI) | **hsuhuvuxfuufrlejsatw (prod)** | f671656, 2026-09-25 18:45 (`ledgr-react-mg4n2qbgp`), aliased **https://ledgr-react.vercel.app** | Serves the Ledgr sign-in page: **customer-facing** |
| **ledgr-react-prod** (`prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9`) | `deploy.yml` **staging** job (CLI `--prod`) | **bkxzgkurcqvccsdjmqzg (staging)** | f671656, 2026-09-25 16:45, aliased https://ledgr-react-prod.vercel.app | **Naming is inverted**: the "-prod" project is staging |
| **ledgr-react-hp5u** | Vercel **Git integration** (vercel[bot]); production deploys on main pushes | unverified (env vars unreadable) | f671656, 2026-09-25 16:41 (Git), previews up to cd25da2 | `/` redirects to `/en/`: a different app shape from the SPA (whose root goes to `/login`); purpose unverified |
| ledgr-react-staging | Git integration, dormant | unverified | 646fb1c, 2026-08-16 (**failed**) | Dormant since 08-16 |

Other observations:
- All three active projects also build Git-integration **preview** deployments of every branch push (latest: cd25da2 on each), so every push is built three times.
- The GitHub "Production – ledgr-react" record stops at 2026-08-19 because production is now deployed by CLI.
- `vercel.json` sets `git.deploymentEnabled.main=false`, yet hp5u still records Git production deployments of main commits. Its Git/production-branch configuration differs and needs a dashboard check.
- Both CI deploys log a non-blocking `api/health.ts: Cannot find name 'process'` TypeScript error during the Vercel build (a missing `@types/node` for the function); the build completes.

**Recommendation (not actioned):**
- Make **ledgr-react** the canonical production project: it's what CI promotes after migrations, it targets the prod Supabase, and it serves the customer alias.
- Then (owner/platform decision):
  1. rename or relabel `ledgr-react-prod` to reflect that it is staging;
  2. establish what hp5u serves and which Supabase it targets. If it points at prod, its Git-triggered deploys bypass the CI migration-first ordering and deploy-skew guard. Disable its production Git deployments or retire it;
  3. archive the dormant `ledgr-react-staging`;
  4. turn off preview builds on non-canonical projects.
- No project was deleted, renamed, reconfigured or redeployed, and no domain, DNS or env change was made.

## 11. Open decisions
1. **DECISION REQUIRED — SERVER POS PRICING POLICY**:
   - (a) must a POS unit price equal the current `products.sale_price`, and how should offline sales priced from a stale cache after a price change be treated?
   - (b) must the server enforce `pos_settings` role discount caps, and what server-verifiable artefact proves an over-cap manager approval? Today it's a local confirmation only.
2. **DECISION REQUIRED — INVOICE EDIT POLICY**:
   - (a) which financial periods are closed, and should edits or backdated invoices there be refused?
   - (b) do invoices require approval before posting, and who approves?
   - No mechanism exists for either; none was invented.
3. Warehouse-vs-branch stock policy (a branch without a location sells from the default location). Still open.
4. Historical data repair (GL vs subledger drift from `20261010000000`, legacy partial COGS). **Not authorised**; nothing repaired.
5. Vercel consolidation (§10). Investigation only.
6. Evidence-preservation runbook `IC_2026-09-25_P0`. **Still pending**; not executed.

## 12. Customer data
**No customer data was read, modified, repaired or deleted:**
- No production database, Supabase project, Vercel project or deploy workflow was written to or triggered.
- All database work ran on disposable local PostgreSQL instances with synthetic fixtures, inside rolled-back transactions.
- Production access in this package was limited to read-only GitHub deployment metadata/job logs and public HTTP GETs of the Vercel aliases.
