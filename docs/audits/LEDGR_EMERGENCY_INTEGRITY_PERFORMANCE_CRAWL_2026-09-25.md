# LEDGR — Emergency Read-Only Integrity & Performance Crawl

| Field | Value |
|---|---|
| Date | 2026-09-25 (UTC) |
| Authorised by | Alexander Gremu (owner) |
| Mode | **Read-only investigation.** No source, schema, RLS, function, data, config or credential changes. The only file this task adds is this report. |
| Repository HEAD examined | `f671656` (`main`, "ci(deploy): surface staging Vercel failure details on check runs (#184)") |
| Working branch | `arena/01a0d9f5-ledgr-react` (branched from `f671656`, working tree clean before this report) |
| Last audited baseline | P2a `bc97e32` (2026-09-23 21:13 UTC): 742 PASS / 0 FAIL / 40 BLOCKED / 782 |
| Evidence sources | git history (full clone, unshallowed from origin), GitHub Actions run/job/annotation metadata, GitHub deployments/tags/activity API, static reading of migrations/Edge Functions/frontend, local unit suite, **one synthetic embedded-Postgres reproduction** (throwaway DB in `/tmp`, no customer data) |
| Not available to this task | Production/staging database (no read connection), Supabase logs, Vercel logs, Sentry, browser telemetry, the production URL (TLS connection from the sandbox was reset), GitHub Actions log bodies (Azure blob storage could not be reached; only annotations could be read) |

---

## 1. Executive incident summary

**No evidence of compromise was found.** There are no unknown authors, no force-pushes to `main`, no secrets in source or history, no install hooks, no unknown third-party scripts and no hidden endpoints. The only actors on `main` are the owner account, the Arena coding-agent bot and `github-actions[bot]`.

The symptoms you reported are explained by **confirmed application, deployment and data-integrity defects**. Most of them were introduced or exposed in a ~36-hour window (2026-09-24 → 2026-09-25):

1. **The audited R00–R12/P2a chain was never what production ran until 2026-09-24 19:12 UTC.** It had been developed on a separate branch. It reached production in one step, *merged on top of* a separate line of production inventory hot-fixes (#165–#169). For the whole chain, the production database and Edge Functions were migrated at 19:12 and 19:17 UTC on 2026-09-24. **The production frontend did not follow.** The Vercel step failed both times with `api-deployments-free-per-day` ("Resource is limited - try again in 24 hours"). For about **23.5 hours** (until 2026-09-25 18:41 UTC), users therefore ran the **pre-remediation frontend `916783d` against the post-remediation database**. One consequence: that frontend opened and closed POS shifts with direct `INSERT`/`UPDATE` on `pos_shifts`, and R08 had revoked exactly those writes. → **confirmed source of transaction errors in that window.**
2. **Production inventory balances were double-counted for an unknown period before 2026-09-24 ~06:58 UTC.** Two additive balance triggers ran at once, and the repository's own records say they were installed **out-of-band**, outside the migration pipeline. The fix stopped the double-counting but **deliberately did not repair balances**, except for one tenant's manure products. Every other tenant that posted stock movements during that period may still have overstated `inventory_balances`. None of those movements have matching GL entries. → **confirmed cause of "figures don't add up" for stock/valuation.** The scope still has to be measured on the database.
3. **The Warehouse "Reconcile stock levels" RPC (`backfill_and_recalculate_inventory`) deducts stock for draft, void and credit-note invoices.** It can also invent `opening_balance` stock to cover them. **Reproduced deterministically:** starting at 10 on hand, one draft (4), one void (3) and one credit note (2) left **1**. It posts no journals. This version went live in production on 2026-09-24 09:32 UTC. → **confirmed financial-integrity defect.**
4. **Since the 2026-09-25 18:41 frontend deploy, the POS reads stock per shop location and blocks items with ≤ 0 on hand** (#177). Before that, it showed a hard-coded 100. Where stock was received into the default warehouse and never transferred to a shop, those items now show "Out" and cannot be sold. If the balance read fails, the error is swallowed and **every tracked item shows "Out"**. When a sale does go through, the server rejects any line that would take the shop location below zero (SQLSTATE `23514`). → **confirmed source of "transaction recording failing" since the latest deploy.**
5. **Authorisation regression (P5-E, post-P2a, live since 2026-09-24 19:12).** The `ai-chat` Edge Function calls `ai_context` with the **service-role** client and forwards a **caller-supplied `branchId`**. On the service-role path, `ai_context` checks only that the branch belongs to the business. It skips `can_access_branch` and never applies the DEC-03 "assigned scope" filter. A branch-restricted `branch_manager` or `sales_manager` can get other branches' figures, or org-wide figures, through the AI assistant. This stays inside one tenant (not cross-tenant), but it is an audited security boundary that has regressed.

Further confirmed defects are listed in §15: silent COGS skip, non-atomic payment recording, orphan invoice headers, a CI workflow that auto-runs data-mutating SQL on production, a tenant-specific data-repair migration, and stale API reads served by the Service Worker.

> **INCIDENT CONTAINMENT REQUIRED** (§18 trigger: *unexpected production database modification* + *unexplained customer-data alteration*).
> Production carried balance triggers that were never created by any recorded migration (`trg_update_inventory_balance`, and a trigger named `trg_stock_movement_apply_balance` — the name of the R06 writer — **before R06 had been deployed through CI**), and customer balances were altered by them. Separately, production customer data was rewritten by CI (repair workflow runs on 2026-09-24 10:37/10:40/10:46 UTC and migration `20261010000000`). No evidence points to a malicious actor. The likeliest explanation is manual/harness SQL run against production. But the provenance is **unverified**, and the affected balances must be treated as evidence: **do not "repair" them before a snapshot is taken.**

---

## 2. Current code / deployment baseline

| Item | Observed |
|---|---|
| Local HEAD / branch | `f671656` on `arena/01a0d9f5-ledgr-react` (= `origin/main`) |
| Working tree before report | clean; no untracked files |
| Production frontend | GitHub deployment `Production` @ `f671656`, 2026-09-25 18:41 UTC (run 36174971354, all steps green). Also a Vercel-Git deployment "Production – ledgr-react-hp5u" @ `f671656` at 16:41 UTC. **At least three Vercel projects exist (`ledgr-react`, `ledgr-react-prod`, `ledgr-react-hp5u`)**, and it is not established which domain customers use (D, §17). |
| Production DB migrations | Applied by `supabase db push --include-all` at 19:12 and 19:17 on 2026-09-24 and again at 18:41 on 2026-09-25 (all "Link & migrate production database: success"). Highest version in the repo: `20261010000000_eagle_nova_manure_balance_repair.sql`. The exact `schema_migrations` contents could not be read (evidence gap G-1). |
| Production Edge Functions | Deployed at the same three runs. Since P2a, only `ai-chat` changed. |
| Production Supabase project | `hsuhuvuxfuufrlejsatw`, `ACTIVE_HEALTHY` (annotation) |
| Tags | `v1.0.4`→`fa2ebfa`, `v1.0.5`→`b82a60f` (both pushed 2026-09-24; production DB was migrated, frontend failed) |
| package.json / lock | unchanged since P2a. Scripts: `prebuild` = `scripts/check-env.mjs` only. No `preinstall`/`postinstall`. |
| Local verification | `npx vitest run`: **95 files, 837 tests PASS** (unit only, no DB). CI "Isolated release evidence (R13)" green on `f671656`. |

### Production deploy history (production job only)

| Run | Time (UTC) | Commit | Migrate | Frontend | Effective state after run |
|---|---|---|---|---|---|
| 35504473106 | 09-20 10:13 | `2e0ede3` | ✅ | ✅ | pre-remediation, pre-hotfix |
| 35953930702 / 35958773400 / 35962048072 | 09-24 04:02–05:54 | `41cb126`/`3738ae8` | ❌ (428C9, then 23514 −1829) | skipped | unchanged |
| 35967177038 | 09-24 06:58 | `914c249` | ✅ (delta trigger 20260925000001) | ✅ | **double-count stops here** |
| 35981866553 | 09-24 09:32 | `916783d` | ✅ (20260926000001 backfill) | ✅ | **defective backfill live** |
| 36029382645 / 36030232211 | 09-24 16:43 / 16:51 | `19e712b`/`682ebbc` | ❌ | skipped | unchanged |
| **36046611959** | **09-24 19:12** | **`fa2ebfa`** | ✅ (whole R-chain + P5 + 20261009 + 20261010) | ❌ Vercel quota | **DB = new, frontend = `916783d`** |
| **36047092221** | **09-24 19:17** | **`b82a60f`** | ✅ | ❌ Vercel quota | same mixed state |
| 36174971354 | 09-25 18:41 | `f671656` | ✅ | ✅ | converged |

---

## 3. Git / change timeline

53 commits landed on `main` after P2a (`bc97e32`). Outside `docs/` and `artifacts/`, 64 files changed (+8743/−306). The ones that matter:

| When (UTC) | Commit / PR | Component | Note |
|---|---|---|---|
| 09-22 04:15 | `4363e77` | R00–R08 chain (separate branch) | introduces `trg_stock_movement_apply_balance` / `_ledgr_apply_stock_movement_balance` |
| 09-23 21:13 | `bc97e32` | **P2a baseline** | audited on the R-branch, which lacked main's 0924/0925/0926 inventory migrations |
| 09-24 03:55 | `41cb126` (#165) | warehouse receipt de-dup | customer report "received 10, shows 20" |
| 09-24 04:42–05:59 | `3738ae8` (#166), `d1dda0c` (#167) | `20260924000001` → no-op; `20260925000001` delta trigger | production had **two additive, out-of-band triggers** |
| 09-24 07:34 | `916783d` (#169) | `20260926000001` backfill rewrite | **defect F-03** |
| 09-24 10:29–11:06 | #170–#174 | Eagle Nova repair workflow + SQL + diagnostics | **auto-runs SQL on production on push** |
| 09-24 07:28–17:07 | `297337b`, `013b37b` | P5-E AI branch context | **defect F-05** |
| 09-24 17:43 | `1c7aa07` (#164) | **merge of the whole R-chain/P5 into main** | first time the audited code meets main |
| 09-24 18:42 | `3e281e9` (#177) | POS branch selection, real stock, Eagle Nova | **F-04** |
| 09-24 18:51 | `1f9221b` (#178) | R06 migration edited in place + `20261009000000` single writer | release harness: 724 PASS / 18 FAIL (double writer) → 742/0 after fix |
| 09-24 19:06 | `9d91008` (#180) | `20261010000000` tenant data repair migration | **mutates production customer rows** |
| 09-24 19:09–19:16 | #179, #181, #183 | CI diagnostics | |
| 09-25 16:38 | `f671656` (#184) | CI diagnostics | current HEAD |

Two migration files were **renamed** after being recorded on some environment (`…26000002_r01_acceptance_current_authority.sql`, `…1003000001_r06_pos_product_tenant_validation.sql`). One applied migration was **edited in place** (`20260928000001`). The deploy script also **auto-runs `supabase migration repair --status reverted`** for any "drift" version it detects (`scripts/ci/supabase-link-and-push.sh` L152-174). Together, these make the production migration history non-reproducible from the repo alone (see G-1).

---

## 4. Security / compromise assessment

| Check | Result |
|---|---|
| Unknown authors / committers on `main` | None. Owner, Arena bot, github-actions, dependabot (dependabot not on main since baseline). |
| Force-push / history rewrite | GitHub activity API: force-pushes only on `dependabot/*` and one `arena/*` branch (2026-08-25). **None on `main`.** |
| Collaborators | 1 (`gremu-ship-it`, admin). Deploy keys and webhooks not readable with this token (403). |
| Secrets in source (HEAD) | None. Matches were placeholders or `Deno.env.get(...)`. |
| Secrets in history | No JWT-shaped token in any commit of any ref. |
| Client-side service-role key | None (`service_role` does not appear in `src/`; no `VITE_*SERVICE*`). |
| Install hooks / suspicious deps | None; dependency set unchanged since P2a. |
| Third-party scripts | `index.html` loads only `/src/main.tsx`. External hosts in `src/` are expected (Supabase, frankfurter FX, Vercel analytics, fonts, wa.me). The LLM adapters in `src/lib/ai/provider.ts` are documented reference code, not wired to the browser. |
| Hidden admin/debug routes | None new since baseline. |
| **Out-of-band production DDL** | **Yes (documented in repo, not by this crawl):** `docs/database/database-operations.md` §9.6 and the headers of `20260925000001` quote the production deploy log listing `trg_stock_immutable`, `trg_update_inventory_balance` and `trg_stock_movement_apply_balance` on `stock_movements`. No recorded migration created them on production. → **E (provenance unconfirmed), containment item.** |
| **CI as a production data-writer** | `.github/workflows/repair-eagle-nova-double-count.yml` runs arbitrary SQL from the repo against **production** through the Supabase Management API on every push to `main` that touches the listed paths (`DRY_RUN=0` on push). It ran successfully three times (2026-09-24 10:37, 10:40, 10:46) and failed once (11:10). This is not a compromise, but it is a **privileged path that makes production mutation depend on a merge**. |

**Conclusion:** the evidence **does not support** the suspicion of external compromise. It **does** show uncontrolled, legitimate-actor changes to production schema and data outside the audited pipeline.

---

## 5. Transaction failure findings

Path maps (UI → client → RPC → DB → tables → triggers):

- **POS sale:** `PosPage.handleCompleteSale` → `posService.completeSale` → `posSaleRpc.postPosSaleViaRpc` (1 transient retry, same `client_key`) → `post_pos_sale(p_payload)` (SECURITY DEFINER; final body in `20261005000000_p5a…`, R08 binding) → `invoices`/`invoice_lines`/`invoice_payments` → `_ledgr_complete_pos_sale` → journal `invoice:<id>:sale` + `stock_movements` (`source_type='invoice'`) → trigger `trg_stock_movement_apply_balance` → `inventory_balances` (CHECK `chk_inventory_balances_on_hand_nonneg`) → `_ledgr_post_cogs` (exceptions swallowed).
- **Void / refund:** `void_pos_sale_command` / `refund_pos_sale_command` (R07) → mirror movements `pos_void`/`pos_refund` → trigger → balances; journals mirrored.
- **Warehouse receive:** `WarehousePage` → `InventoryRepository.recordMovements` (keyed with `deriveClientKey`, upsert-ignore) → **direct `INSERT` on `stock_movements`** (RLS `stock_movements_writer_insert`) → trigger; GRNI journal posted client-side (`inventoryJournalService`).
- **Reconcile stock levels:** `WarehousePage` → `backfill_and_recalculate_inventory(p_business_id)` → inserts movements → trigger.
- **Invoice (non-POS):** `InvoiceRepository.createWithLines` → header `INSERT`, then lines `INSERT`, with a compensating header `DELETE` on failure.
- **Payment:** `InvoiceRepository.recordPayment` / `ExpenseRepository.recordPayment` → `INSERT invoice_payments` → `rpc increment_amount_paid` → client status `UPDATE` (three separate requests).
- **Shift open/close:** current = `open_pos_shift_command` / `close_pos_shift_command` RPCs; frontend `916783d` = direct `pos_shifts` `INSERT`/`UPDATE`.

| ID | Failure | Where it fails | Class |
|---|---|---|---|
| T-1 | Shift open/close denied during the mixed window (09-24 19:12 → 09-25 18:41) | `916783d` `PosRepository` L252-330 direct writes vs `20260930000000_r08_till_context.sql` L195 `revoke insert, update, delete on public.pos_shifts from authenticated` → `42501` | Authorization (deployment skew) |
| T-2 | POS items shown "Out", cannot be added/scanned | `PosPage.tsx` stock now per shop location; `PosProductCatalog.tsx` `sellable()`; `loadBalances().catch(() => [])` swallows read errors, so every item shows 0 | Frontend validation (since 09-25 18:41) |
| T-3 | Sale rejected `23514 chk_inventory_balances_on_hand_nonneg` | `_ledgr_complete_pos_sale` inserts `-qty` at `_ledgr_stock_location(branch)`. If the shop location has no or low balance, the R06 writer (insert 0, then update to negative) fails and **the whole sale rolls back**. #177 now sends a branch where it used to send `null`. | DB constraint (legitimate, but exposed by location change and by balance drift F-02/F-03) |
| T-4 | "Reconcile stock levels" failed (`23514`, on_hand −3) before 09:32 on 09-24 | old step-4 rewrite | DB constraint (fixed, but replaced by F-03) |
| T-5 | Invoice save reported as failed while the header persists | `createWithLines` compensating `DELETE` is blocked by RLS `invoices_admin_delete` for non-admin writers (0 rows, no error) | Partial workflow |
| T-6 | Payment "failed" after it was saved | `recordPayment`: if `increment_amount_paid` fails or times out after the payment `INSERT`, the error surfaces. A keyed retry then finds the payment and **returns early without incrementing**. | Partial workflow / reliability |

---

## 6. Financial-integrity findings

| ID | Finding | Evidence | Effect |
|---|---|---|---|
| F-02 | Inventory balances double-counted in production before 09-24 06:58 (unknown start) and **not repaired** except Eagle Nova manure | `20260925000001` header ("10 received, 20 on hand"; "Does NOT rewrite existing balances"); `database-operations.md` §9.6; view `v_inventory_balance_ledger_drift` created for this purpose | Overstated on-hand. WAC was computed on doubled quantities. POS may sell stock that does not exist, while shops that were never double-counted fail with T-3. Balances were changed with **no GL entries** → stock sub-ledger ≠ Inventory GL account. |
| F-03 | `backfill_and_recalculate_inventory` treats every non-deleted invoice as a sale | `20260926000001` L220-266: no `status` / `invoice_type` filter (enum includes `draft`, `void`, `credit_note`). Also inserts `opening_balance` movements to "cover" those phantom sales. Same for expenses (no status filter). | **Reproduced** (§12): 10 → 1. Posts no journals. |
| F-06 | COGS journal failure is silently swallowed | `20260923000000_post_pos_sale_rpc.sql` L528-542 `exception when others then raise warning … v_cogs_entry := null` | Stock leaves; no COGS/Inventory credit; P&L overstated. Nothing re-attempts it: a replay sees `v_moved = true` and skips the COGS block. |
| F-07 | Tenant-specific production data rewritten by migration and by CI | `20261010000000_eagle_nova_manure_balance_repair.sql` sets `quantity_on_hand := ledger_quantity` and `average_cost :=` lifetime inbound average for business `93851ac2-…`. Workflow `repair-eagle-nova-double-count.yml` ran with `DRY_RUN=0`. | Balance and WAC overwritten with **no stock movement and no journal**. This contradicts the principle stated in `20260925000001` ("never by rewriting the balance blindly"). Lifetime average ≠ moving average. |
| F-08 | Invoice `amount_paid` can diverge from `sum(invoice_payments)` | T-6. No overpayment guard in `increment_amount_paid`. | Receivables/aging wrong; the invoice can stay "sent" while fully paid. |
| F-09 | Orphan invoice headers without lines | T-5 | A header with totals but no lines; the number is consumed. A keyed retry returns the orphan as success. |
| F-10 | `post_pos_sale` trusts client-computed `subtotal`, `discount_amount`, `vat_amount`, `total_amount`, `functional_amount` and line `unit_price`. It verifies only tenders = total. | `20260930000001` L150-185 / `…p5a…` | The journal is built from these values (§7). If `total ≠ subtotal + VAT`, the entry is either unbalanced (rejected, if a balance check exists; see G-6) or wrong. `line_total` is not reconciled to `subtotal` on the server. |

Checks that were **not** possible without DB access: duplicate invoices/payments, unbalanced journals, orphan journals, broken numbering, cross-tenant references, wrong branch/user/shift attribution. SQL for each is given in §17. Design-level: journal `posting_key` is unique (`20260921000000`), and POS/stock movements are gated per `(business, 'invoice', id)`.

---

## 7. Client vs server calculation discrepancies

| Calculation | Client | Server | Persisted | Discrepancy |
|---|---|---|---|---|
| POS totals / VAT / discount | `posService` computes | accepted as given (only tender sum is checked, ±0.01) | invoice columns + journal lines from invoice columns | **No server recomputation.** A client rounding error or bug is persisted and journalled. |
| POS stock cost shown | `weightedAverageCost(rows)` of the shop location, else `purchase_price` | COGS uses `inventory_balances.average_cost` at `_ledgr_stock_location` (may be the default warehouse if the branch has no location) | movement `unit_cost` | Different location or fallback → UI margin ≠ booked COGS. If COGS fails → booked COGS = 0 (F-06). |
| POS on-hand shown | `locations.find(l => l.branch_id === branchId)` (first match, no ordering) | `_ledgr_stock_location` (ordered/`is_active`) | `inventory_balances` | Can target different rows when a branch has more than one location. |
| WAC | n/a | R06 writer: moving average on costed inbound only | `average_cost` | Eagle Nova repair uses a *lifetime* inbound average (F-07). Backfill costs sales at the inbound average **up to the sale date**, while the balance keeps a moving average → valuation drift. |
| Payment status | `paymentStatusFromAmounts(total, amount_paid)` then client `UPDATE` | `increment_amount_paid` | `amount_paid`, `status` | Three non-atomic steps (F-08). |
| Warehouse duplicate repair | heuristic grouping in `findDuplicateWarehouseReceiptCandidates` (2-minute window) | n/a | compensating negative movements + draft GRNI reversal | Heuristic, so false positives are possible; the journal is posted as `status: 'draft'` and may not hit reports. |

---

## 8. RLS / authentication / authorization findings

| ID | Finding | Status |
|---|---|---|
| **S-1** | **`ai-chat` → `ai_context` via service role with caller-supplied `branchId`.** `supabase/functions/ai-chat/index.ts` L55 (`admin` = service-role client), L165-166 (`admin.rpc('ai_context', { p_business_id, p_branch_id: branchId })`), L543-554 (branch taken from `context.branchId` / `selectedBranchId` / `data.company.branch_id`). `20261008000000_p5e_ai_branch_context.sql` L502-513: when `auth.uid() is null` and the role is `service_role`, only a same-business check applies. **No `can_access_branch`, and no assigned-scope fallback when the branch is omitted (org-wide).** The Edge Function comment L543-546 says the RPC "enforces can_access_branch()". Under service role that is false. P5-E review record 18/20 accepted "service_role trusted" without noticing that the only service-role caller forwards user input. | **Confirmed regression (post-P2a, live since 09-24 19:12). HIGH.** Intra-tenant, cross-branch. `branch_manager` and `sales_manager` are in `AI_FINANCIAL_CONTEXT_ROLES`. |
| S-2 | Writers can directly `INSERT`/`UPDATE` `stock_movements` and admins can `DELETE` them (P5-D policies L446-451). Caller-controlled `quantity` and `unit_cost` then drive `inventory_balances.quantity_on_hand` / `average_cost` through the trigger. | Pre-existing (phase 8B). P5-D narrowed it to location. **Observation**; `unit_cost`/`average_cost` are caller-controlled on this path. |
| S-3 | Sales writers (incl. `sales_clerk`, `warehouse_worker`, `data_entry`) can directly `UPDATE` `invoices` (status → `void`, totals, `amount_paid`). The only triggers on `invoices` are quota, amount_due sync, touch, shift link. This bypasses R07 approvals and mirror journals. | Pre-existing architectural residual (client-authoritative writes). **Observation**; not a regression. |
| S-4 | `v_ai_*` views are not branch-filtered for direct reads (acknowledged in the P5-E review §6.5). | Known residual. |
| S-5 | R01 (membership), R02 (recovery), R03 (AI tenant), R04 (contacts), R06 (POS product tenant), R07 (commands), R08 (till binding), R10 (P0QLT) migrations were **not modified after P2a**, except R06 `20260928000001`, whose changed part is the trigger reconciliation block only. | Intact by static comparison. |
| S-6 | Other Edge Functions: `grant-manual-subscription` checks platform admin; `process-invoice-automation` checks `x-cron-secret`. Only `ai-chat` changed after P2a. | No new finding. |

---

## 9. Offline / cache / PWA findings

| ID | Finding | Evidence | Class |
|---|---|---|---|
| O-1 | Service Worker caches **all Supabase REST GETs** `NetworkFirst` with a **4 s network timeout** and a **24 h** max age | `vite.config.ts` L101-115 | When the API is slow (> 4 s), the app silently shows **up to 24 h-old** balances, invoices and report figures. That is a direct "numbers don't add up" mechanism with no indicator. C / MEDIUM. |
| O-2 | New SW waits for user action (`onNeedRefresh` banner; `registerType: 'autoUpdate'` but no forced reload). `clientsClaim: true`. | `registerServiceWorker.ts` | Open tabs keep old JS after a deploy → contributes to version skew (same class as T-1). Observation. |
| O-3 | Offline replay safety | Keyed idempotency exists for invoice, expense, payments, payroll, stock movement, POS (`client_key` unique indexes, `20260813000003`). `isOfflineError` treats timeouts and aborts as "maybe committed → queue". | Sound for keyed paths. **Not sound for T-6** (the key suppresses the missing increment). |
| O-4 | POS fallback to the client-side sale path when `post_pos_sale` is "missing" (`PGRST202`) or returns no `id` | `posSaleRpc.ts`; `posService.ts` L620-660 | A PostgREST schema-cache miss right after a migration would route sales through the non-authoritative client path (bypassing R06/R08 server checks). Observation (not observed). |
| O-5 | `23514` / `P0QLT` / branch-denied classification | `exceptions.ts` L59-90 narrow on the constraint name / "branch" text | As designed. Stock-denied items are reconcilable after a restock. |

---

## 10. Performance findings

| ID | Finding | Evidence | Effect |
|---|---|---|---|
| P-1 | No index on `stock_movements(business_id, source_type, source_id[, product_id])`. Only `(product_id)` and `(business_id, movement_date)`. | `20260911000000_hot_path_indexes.sql` L60-63 | Every POS sale (`v_moved` check), every R07 void/refund, the backfill `NOT EXISTS` (also wrapped in `::text` casts) and `v_inventory_balance_ledger_drift` scan a business's whole movement history. Latency grows with history. Needs `EXPLAIN` on production (G-4). |
| P-2 | Backfill RPC: correlated sub-queries per line, `pg_advisory_xact_lock` per business, one transaction | `20260926000001` | A long run can exceed the 60 s client write timeout (`src/lib/supabase.ts` L50-51). The client reports failure while the server commits later; a second click waits on the lock and then finds nothing to do. This yields "failed but stock changed". |
| P-3 | R06 writer takes `FOR UPDATE` on the balance row per movement | `20260928000001` | Correct serialisation; concurrent sales of one product at one location queue. Not a defect. |
| P-4 | Client timeouts 30 s read / 60 s write; POS RPC retried once on transient errors with the same key | `supabase.ts`, `posSaleRpc.ts` | Safe for POS (keyed). T-6 and T-5 are the unsafe multi-request paths. |
| P-5 | Frontend | Bundle ~3.75 MiB precache (P10 record); POS `loadData` issues 6 parallel reads including **all** `inventory_balances` of the business | Grows with tenant size. Observation. |

---

## 11. Error-chain analysis

| Error | HTTP / code | SQLSTATE | Function / path | Mutation? | Client report correct? | Class |
|---|---|---|---|---|---|---|
| `permission denied for table pos_shifts` | 403 (PostgREST) | 42501 | frontend `916783d` → `pos_shifts` | No | Yes (error) | Authorization / deployment skew |
| `new row … violates check constraint "chk_inventory_balances_on_hand_nonneg"` | 400 | 23514 | `post_pos_sale` → `_ledgr_complete_pos_sale` → R06 trigger | No (rolled back) | Yes. Offline: classified `stock-denied`, reconcilable. | DB constraint |
| `Payload branch conflicts with the authorised terminal branch (R08)` | 400 | 22023 | `post_pos_sale` | No | Yes. Offline: quarantined. | RPC validation (possible once #177 sends a branch that differs from the terminal) |
| `Tenders (x) do not settle the sale total (y)` | 400 | P0001 | `post_pos_sale` | No | Yes | RPC validation |
| `Request timed out after 60s` | – | – | any write | **Unknown** (may have committed) | Ambiguous; queued if keyed | Timeout |
| `increment_amount_paid` error after payment insert | 4xx/5xx | varies | `recordPayment` | **Yes** (payment row) | **No**: reported as failure; the retry masks it | Partial workflow |
| `invoice_lines` insert error | 4xx | varies | `createWithLines` | **Yes** (orphan header) for non-admins | **No** | Partial workflow |
| `COGS posting failed for invoice …` | none (WARNING only in Postgres log) | – | `_ledgr_complete_pos_sale` | Sale committed without COGS | **No**: UI shows success | Suppressed error |
| `Resource is limited - try again in 24 hours (api-deployments-free-per-day)` | CI | – | Vercel deploy | Frontend not updated; DB was | CI red, users unaware | Configuration |

---

## 12. Reproduction matrix

| Defect | Minimal reproduction | Deterministic | Scope | Status |
|---|---|---|---|---|
| **F-03 backfill** | Embedded Postgres, **full migration chain replayed (108 files, production shape)**. Product: receipt +10 through the trigger. Invoices: `draft` qty 4, `void` qty 3, `credit_note` qty 2. `select backfill_and_recalculate_inventory(biz)` as owner. | Yes | any tenant with draft/void/credit-note invoices lacking movements; any role allowed to call the RPC | **Reproduced**: `sales_backfilled = 3`, on-hand **10 → 1**, three `sale` movements referencing DRAFT-1, VOID-1, CN-1. Only trigger present after the full chain: `trg_stock_movement_apply_balance` (confirms the single-writer fix works on a fresh DB). |
| T-1 shift writes | Frontend `916783d` against the R08 schema | Yes | all POS users, 09-24 19:12 → 09-25 18:41 | Confirmed by code + deploy records (no runtime log) |
| T-2 POS "Out" | Tenant with stock only at the default warehouse, a branch selected/assigned with its own location | Yes | branch-assigned tills | Confirmed by code |
| T-3 23514 at shop | as T-2, forcing a sale | Yes | same | Confirmed by code (R06 semantics) |
| S-1 AI branch | POST `ai-chat` as `branch_manager` of A1 with `context.branchId = A2`, or with no branch | Yes | tenants with branches + assigned-scope roles | Confirmed by code; **not executed** (needs deployed functions; not run against production by design) |
| F-06 COGS skip | Make `_ledgr_post_cogs` raise (e.g. missing inventory/COGS account) | Yes | businesses with incomplete CoA | Confirmed by code |
| T-5 / F-09 | Non-admin writer; force the `invoice_lines` insert to fail | Yes | non-admin roles | Confirmed by code + RLS policy |
| T-6 / F-08 | Drop the network after the payment `INSERT` | Timing-dependent | all | Confirmed by code |
| O-1 stale reads | Throttle the API to > 4 s | Timing-dependent | all PWA users | Confirmed by config |

The reproduction harness was a throwaway copy of `tests/database/backfill_reconcile_inventory.test.js`, pointed at the full chain with the fixture shown above. It ran in `/tmp` and nothing from it was committed.

---

## 13. Change-correlation matrix

| Defect | Introducing commit | Before baseline? | After R09.3 / R09.4 / P2a? | Recent change touched path? |
|---|---|---|---|---|
| T-1 deployment skew | deploy of `fa2ebfa` / `b82a60f` + Vercel quota | – | after P2a | yes (#179–#184 CI) |
| F-02 double count | out-of-band production triggers (unknown date) | yes (pre-dates 09-24) | stopped 09-24 06:58 | yes (#165–#167, #178) |
| F-03 backfill | `916783d` (#169). The filter was already missing in `20260728000002`/`20260730000005`, but step 4's rewrite masked it by recomputing from the ledger. | partially | after P2a (new opening-balance behaviour) | yes |
| T-2/T-3 POS location | `3e281e9` (#177) | no | after P2a | yes |
| S-1 AI branch | `297337b` / `013b37b` (P5-E) | no | after P2a | yes |
| F-06 COGS swallow | `20260923000000` (pre-R-chain POS RPC) | yes | – | no |
| F-07 tenant repair | #170–#174, `9d91008` (#180) | no | after P2a | yes |
| F-08 / F-09 | `ed9ff98` / `0ed7c84` (June–July) | yes | – | no |
| O-1 SW API cache | pre-baseline (R09.1 addressed confidentiality, not freshness) | yes | – | no |
| P-1 index | pre-baseline | yes | – | no |

Timeline: `out-of-band triggers → stock_movements → 10 in = 20 on hand → customer report 09-24` · `916783d → backfill RPC → draft/void/CN deducted → reproduced` · `fa2ebfa deploy (DB ok / Vercel quota) → pos_shifts 42501 → annotation "api-deployments-free-per-day"` · `3e281e9 → POS stock per shop → "Out"/23514 → code` · `P5-E → ai-chat service-role branch → code`.

---

## 14. Severity classification

| ID | Severity | Class | Basis |
|---|---|---|---|
| F-02 double-count, unrepaired, out-of-band origin | **CRITICAL** | A (integrity) + E (provenance) | Direct evidence (production deploy log quoted in-repo) of altered customer inventory balances across tenants; scope unmeasured; no GL counterpart |
| F-03 backfill phantom sales | **HIGH** | B | Reproduced; any user click corrupts stock and fabricates opening stock |
| S-1 AI cross-branch disclosure | **HIGH** | A (boundary violation, by code) | Audited DEC-03 boundary bypassed on the supported path; no evidence of exploitation available |
| T-1 mixed-version window | **HIGH** | D | 23.5 h of POS shift failures; ended at 09-25 18:41 |
| T-2/T-3 POS blocked at shop locations | **HIGH** | B | Current production behaviour blocks legitimate sales where stock sits in the warehouse |
| F-07 CI/migration data rewrite | **HIGH** | D/B | Unreviewable production mutation path; WAC overwritten without journals |
| F-06 COGS swallowed | **HIGH** | B | Silent P&L/inventory GL divergence |
| F-08 payment non-atomic | **MEDIUM** | C | Recoverable; timing-dependent |
| F-09 orphan invoice header | **MEDIUM** | B | Limited to non-admin failure paths |
| F-10 server trusts client totals | **MEDIUM** | B (design) | No incorrect record observed |
| O-1 stale API cache | **MEDIUM** | C | Displayed figures can be stale up to 24 h |
| Multiple Vercel projects / free-tier quota | **MEDIUM** | D | Root cause of T-1 |
| P-1 missing index, P-2 long backfill | **LOW** | C | Needs `EXPLAIN` evidence |
| S-2, S-3, S-4, O-2, O-4, P-5 | **OBSERVATION** | – | Pre-existing or unobserved |

---

## 15. Confirmed defects (summary)

1. **F-02**: production inventory balances double-counted (out-of-band triggers), not repaired, no GL.
2. **F-03**: `backfill_and_recalculate_inventory` counts draft/void/credit-note invoices (and all expenses) as stock movements; fabricates `opening_balance`. *Reproduced.*
3. **S-1**: `ai-chat` service-role call lets a caller-chosen branch or org-wide scope bypass `can_access_branch` / DEC-03.
4. **T-1**: DB/Edge migrated while the frontend stayed on `916783d` for ~23.5 h (Vercel daily deploy quota) → `pos_shifts` 42501.
5. **T-2/T-3**: POS blocks or rejects sales at shop locations without stock; a balance-read error makes every item "Out".
6. **F-06**: COGS posting errors swallowed in `_ledgr_complete_pos_sale`; never retried.
7. **F-07**: tenant-specific production data rewrites via migration `20261010000000` and a push-triggered production SQL workflow.
8. **F-08**: invoice/expense payment recording is three non-atomic requests; a keyed retry masks the missing increment.
9. **F-09**: failed invoice-line insert leaves an orphan header for non-admin users (compensating delete blocked by RLS).
10. **O-1**: Service Worker serves up to 24 h-old REST responses after a 4 s network timeout.

## 16. Suspected but unconfirmed

- **E-1** Who created the out-of-band triggers on production, and when (manual `psql`, R13 harness pointed at production, dashboard SQL)?
- **E-2** Whether `migration repair --status reverted` ran on production during the 19:12/19:17/18:41 deploys, and which versions it reverted.
- **E-3** Whether PostgREST schema-cache misses caused POS client-side fallback sales (O-4) right after the migrations.
- **E-4** Whether journals are DB-enforced balanced (only `20260730000003` references balancing; `_ledgr_post_entry_keyed` body not verified to assert it).
- **E-5** Whether any `ai-chat` requests actually used a foreign `branchId` (needs Edge Function logs).
- **E-6** Whether duplicate receipts remain from before #165 and whether the heuristic repair created false reversals.
- **E-7** Which Vercel project/domain customers use, and whether any still serves an older build.

## 17. Evidence gaps and read-only queries to close them

No DB connection was available. Run these **read-only** against a production snapshot or read replica:

- G-1 migration state: `select version, name from supabase_migrations.schema_migrations order by version;`
- G-2 triggers: `select tgname, p.proname, pg_get_triggerdef(t.oid) from pg_trigger t join pg_proc p on p.oid=t.tgfoid where tgrelid='public.stock_movements'::regclass and not tgisinternal;` (expect exactly `trg_stock_movement_apply_balance` + `trg_stock_immutable`)
- G-3 drift scope: `select business_id, count(*), sum(difference) from public.v_inventory_balance_ledger_drift group by 1 order by 3 desc;` (run as `service_role`; the view is `security_invoker`)
- F-03 exposure: `select sm.business_id, i.status, i.invoice_type, count(*), sum(sm.quantity) from stock_movements sm join invoices i on i.id::text=sm.source_id::text where sm.source_type='invoice' and (i.status in ('draft','void','credit_note') or i.invoice_type='credit_note') and sm.created_at >= '2026-09-24 09:32+00' group by 1,2,3;` plus `select * from stock_movements where movement_type='opening_balance' and created_at >= '2026-09-24 09:32+00';`
- F-06: `select i.id from invoices i where i.pos_shift_id is not null and exists(select 1 from stock_movements m where m.source_type='invoice' and m.source_id=i.id::text) and not exists(select 1 from journal_entries j where j.posting_key='invoice:'||i.id||':cogs');`
- F-08: `select i.id, i.amount_paid, sum(p.amount) from invoices i join invoice_payments p on p.invoice_id=i.id group by 1,2 having abs(i.amount_paid-sum(p.amount))>0.005;`
- F-09: `select id from invoices i where not exists(select 1 from invoice_lines l where l.invoice_id=i.id) and total_amount>0;`
- Journals: `select journal_entry_id, sum(case when is_debit then amount_base else -amount_base end) d from journal_lines group by 1 having abs(sum(case when is_debit then amount_base else -amount_base end))>0.005;` (adjust to the real column names)
- T-1 impact: `select count(*) from pos_shifts where opened_at between '2026-09-24 19:12+00' and '2026-09-25 18:41+00';` and Supabase API logs for 42501 on `/rest/v1/pos_shifts`
- S-1: Edge Function logs for `ai-chat` requests carrying `branchId`
- P-1: `explain (analyze, buffers)` of the `v_moved` query for the largest tenant
- Supabase audit/pgaudit or `pg_stat_statements` for DDL on `stock_movements` triggers (E-1)

## 18. Recommended containment (NOT implemented)

1. **Snapshot first:** take a PITR marker or logical dump of `inventory_balances`, `stock_movements`, `journal_entries`/`journal_lines`, `invoices`, `invoice_payments`, and `supabase_migrations.schema_migrations`. Preserve GitHub Actions run 36046611959/36047092221/36174971354 artifacts and the repair-workflow runs.
2. **Freeze the "Reconcile stock levels" button** (F-03) and the duplicate-receipt repair action until reviewed. *PROPOSED REMEDIATION — NOT AUTHORIZED.*
3. **Disable the push trigger** on `repair-eagle-nova-double-count.yml`, and review who holds `SUPABASE_ACCESS_TOKEN`. *NOT AUTHORIZED.*
4. **Restrict the AI assistant** for assigned-scope roles until S-1 is fixed. *NOT AUTHORIZED.*
5. **Pause further production deploys** until the Vercel quota/project question (E-7) is settled, so DB and frontend can't diverge again. *NOT AUTHORIZED.*
6. Communicate to affected tenants that stock figures from before 2026-09-24 07:00 UTC may be overstated.

## 19. Recommended remediation packages (NOT implemented)

- **RP-1 Inventory truth:** measure drift (G-3), then correct it by **explicit adjustment movements with journals**, per tenant, owner-approved. Never by rewriting balances. Retire tenant-specific migrations.
- **RP-2 Backfill RPC:** restrict to `status not in ('draft','void')` and `invoice_type <> 'credit_note'` (credit notes as `return_in`), expenses by status; post journals or mark as ledger-only; reverse any F-03 movements already created.
- **RP-3 AI boundary:** call `ai_context` with the **user's JWT** (not service role), or pass the verified user id and enforce `can_access_branch` plus the DEC-03 fallback on the service path. Add a release test for the Edge-level path.
- **RP-4 POS location:** make the displayed stock and the server deduction use one shared location resolver. Surface balance-read failures instead of showing 0. Decide the policy for stock kept only in the warehouse (transfer workflow vs. warehouse fallback).
- **RP-5 Atomic financial commands:** move payment recording (insert + increment + status + journal) and invoice header+lines into single RPCs; stop swallowing COGS errors (record them in a durable exceptions table at minimum, and alert).
- **RP-6 Server-side totals:** recompute subtotal/VAT/discount/total from lines in `post_pos_sale`; reject on mismatch.
- **RP-7 Deploy safety:** frontend-first or gated deploys (do not migrate the DB unless the frontend build/deploy can succeed); one Vercel project per environment; paid tier or disable preview deploys; remove automatic `migration repair`; never edit applied migrations.
- **RP-8 Cache freshness:** exclude financial REST reads from the SW cache or mark stale data in the UI; raise the network timeout.
- **RP-9 Indexes:** `stock_movements(business_id, source_type, source_id, product_id)` after an `EXPLAIN` review.

## 20. Implicated files / functions / objects

- `supabase/migrations/20260926000001_fix_backfill_and_recalculate_inventory.sql`: `public.backfill_and_recalculate_inventory(uuid)`
- `supabase/migrations/20260925000001_stock_movement_balance_delta_trigger.sql`: `update_inventory_balance()`, `_ledgr_apply_stock_movement_delta(...)`, `v_inventory_balance_ledger_drift`
- `supabase/migrations/20260928000001_r06_stock_balance_authority.sql` (edited after apply): `_ledgr_apply_stock_movement_balance()`, `trg_stock_movement_apply_balance`
- `supabase/migrations/20261009000000_r06_single_stock_balance_writer.sql`
- `supabase/migrations/20261010000000_eagle_nova_manure_balance_repair.sql`
- `supabase/migrations/20260923000000_post_pos_sale_rpc.sql`: `_ledgr_complete_pos_sale` (L470-545), `_ledgr_post_entry_keyed`
- `supabase/migrations/20260930000001_r08_post_pos_sale_binding.sql`, `20261005000000_p5a_typed_offline_exceptions.sql`: `post_pos_sale(jsonb)`
- `supabase/migrations/20260930000000_r08_till_context.sql` L195 (pos_shifts revoke)
- `supabase/migrations/20261008000000_p5e_ai_branch_context.sql` L480-540: `ai_context(uuid, uuid)`
- `supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql` L446-451 (stock_movements policies), L325-326 (invoices policies)
- `supabase/migrations/20260813000001_fix_increment_amount_paid_backout.sql`: `increment_amount_paid`
- `supabase/migrations/20260911000000_hot_path_indexes.sql`
- `supabase/functions/ai-chat/index.ts` L55, L165-166, L543-559
- `src/pages/PosPage.tsx` (branch/stock load), `src/components/pos/PosProductCatalog.tsx` (`sellable`)
- `src/services/posSaleRpc.ts`, `src/services/posService.ts` (client-side fallback)
- `src/dal/repositories/InvoiceRepository.ts` (`createWithLines`, `recordPayment`), `ExpenseRepository.ts` (`recordPayment`)
- `src/dal/repositories/InventoryRepository.ts`, `src/services/inventoryJournalService.ts`
- `vite.config.ts` (workbox `runtimeCaching`), `src/offline/registerServiceWorker.ts`, `src/lib/supabase.ts` (timeouts)
- `.github/workflows/deploy.yml`, `.github/workflows/repair-eagle-nova-double-count.yml`, `scripts/ci/supabase-link-and-push.sh`, `scripts/database/run-support-sql-via-api.sh`, `scripts/repair-eagle-nova-double-count.sql`
- Production-only (out-of-band): `trg_stock_immutable`, the former `trg_update_inventory_balance`

## 21. Do the audited security boundaries remain intact?

**Mostly, with one confirmed regression.** R01–R04, R06 product-tenant validation, R07 commands, R08 till binding and R10 quota are unchanged since P2a and still present in the chain. Cross-tenant isolation shows no new weakness. **The P5-E AI branch boundary (DEC-03) is broken on the supported `ai-chat` path (S-1).** Separately, the audited evidence (P2a) was produced on a migration chain that differed from what production received (it lacked main's `20260924/25/26` inventory migrations). The post-merge release gate (742/0/54) re-established parity only after `1f9221b`. It does not exercise F-03, S-1 at the Edge layer, T-1, or T-2.

## 22. Does the evidence support the suspicion of compromise?

**No.** Every change is attributable to known actors through normal PRs and CI runs. There are no secrets, no unknown code, no suspicious network targets, and no history rewrite on `main`. What the evidence **does** support is **uncontrolled change**: out-of-band production DDL, CI-driven production data rewrites, an edited applied migration, automatic migration-history repair, and a deploy pipeline that let the database and frontend diverge for 23.5 hours. Together with the confirmed defects above, these fully account for the reported transaction errors and non-reconciling figures without assuming an attacker. The origin of the out-of-band triggers (E-1) is the one item that should be positively verified from Supabase audit logs before closing the compromise question.

---

*STOP: crawl complete. No remediation has been performed. The next action requires owner review.*
