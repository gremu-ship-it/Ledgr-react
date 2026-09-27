# LEDGR RETAIL CUSTOMER PATH READINESS — FULL AUDIT REPORT

**Date:** 2026-09-27 · **Auditor:** Arena agent session on `arena/01a0e2ff-ledgr-react` · **Repo:** `gremu-ship-it/Ledgr-react`
**Baseline:** `main` @ `4d9aa636e6bf4429b98b7634fbba410bfd388cf9` (= deployed production commit) · **Migration chain:** 121 migrations, latest `20261016000000_retail_sale_path_fixes.sql` (this branch)

**Method.** Every claim below was verified against the repository itself (code read, migration replay, or executable test) — not from PR descriptions or memory. Financial behaviour was verified by replaying the **full migration chain on an embedded PostgreSQL 17** with **production-shaped schema** (`LEDGR_R13_LIVE_UUID_SHAPE=1`: uuid `stock_movements.source_id`/`created_by`) and driving the **real client payload builders** (`buildPosSaleQueuePayload` → `buildPosSaleRpcPayload` from `src/services/posService.ts` / `src/services/posSaleRpc.ts`). Production runtime state was verified from two independent sources: the GitHub Actions deploy run (via GH API) and the live production `/version.json`.

**Gates at time of writing (this branch):**

| Gate | Result |
|---|---|
| `npm run verify` (types + lint + unit + release) | **PASS** end-to-end |
| Unit tests | **920 / 920 PASS** |
| Release gate, repo shape (`npm run test:release`) | **822 PASS / 0 FAIL / 54 BLOCKED** (baseline preserved) |
| Release gate, production uuid shape (`LEDGR_R13_LIVE_UUID_SHAPE=1`) | **822 PASS / 0 FAIL / 54 BLOCKED** |
| `npm run test:release:types` | **PASS** |
| Retail scenario suite (`tests/retail/`, this audit) | **16 / 16 PASS** (incl. all 12 mandated scenarios) |

---

## 1. REPOSITORY CHECKPOINT RECOVERY

The local checkout was a single-commit shallow clone (Mac corruption aftermath). Recovery performed from GitHub (the source of truth):

- `git fetch --unshallow` → 612 commits, tags `v1.0.1`–`v1.0.5`. Local history now equals remote history; **VERIFIED**.
- **`main` = `4d9aa63`** and the session branch `arena/01a0e2ff-ledgr-react` was cut from it; nothing was reconstructed from memory. **VERIFIED**.
- Deploy history (GH API): production deploy run `36315752583` for commit `4d9aa63` — **all-success**, 2026-09-27 11:26:44–11:30:28Z, including the step **"Verify DB reached migration target (production)"**, i.e. the production database is at `20261015000000`. Staging run `36315436688` = PR #189. **VERIFIED** (GH API JSON; job-log downloads are unavailable from this sandbox — Azure blob — and were not retried).
- The earlier 2026-09-27 09:39–09:51 deploy failures (#185–#187: migration-list parsing + `/version.json` redirect) are already fixed in-tree (`c10a404`, `ebf87c4`, `0517ecd`) and included in the successful `4d9aa63` run. **VERIFIED** — do not re-fix.
- Checkpoint work confirmed present on `main` as merged code (read from the tree, not PR text): PR #156/#157/#160 checkpoint scope, R07 correction commands (`20260928000002`), R08 till context (`20261012000000`), P0/P5/P6/P9/P10/P12 remediations, incident containment + hardening migrations (2026-09-25/26), owner decisions (`20261013000000`), UUID/source-id fixes (`f2c03bd`, `1a0c580`, `26b289e`, `9f9676f`, `20261015000000`), posted-journal immutability (`posting_key` stamped in the INSERT). **VERIFIED IMPLEMENTED / VERIFIED MERGED** — per-capability deployment status is in §2 and §13.

No historical migration was edited by this audit; all changes are a new additive migration (`20261016000000`) plus tests.

---

## 2. POS CAPABILITY LEDGER

Only capabilities actually found in the repository are listed. "Production" means: the code is part of deployed commit `4d9aa63` AND the capability was exercised by real production data (session evidence, 2026-09-27).

| Capability | Code exists | Tests | Merged to main | In production deploy | Status | Evidence |
|---|---|---|---|---|---|---|
| Cash sale (till) | Yes — `post_pos_sale` (20261012000000) + `posSaleRpc.ts` RPC-first | Yes — R05/R06/R13 + retail S1 | Yes | Yes (319+90 invoices to 2026-09-23) | **PRODUCTION VERIFIED** (sale posts; see §16 P0-1 for the status defect found in it) | §3 trace; retail S1 |
| Multi-product sale | Yes | Yes — retail S2 (first DB-level test; gap closed) | Yes | Unknown (line composition not inspected) | **VERIFIED TESTED** | retail S2 |
| Split tender | Yes | Yes — retail S3 + R08.ZREPORT | Yes | No evidence | **VERIFIED TESTED** | retail S3 |
| Credit sale (customer account) | Yes — `is_credit_sale`, no tenders, receivable 1131 | Yes — retail S4 (first DB-level test; gap closed) | Yes | No evidence | **VERIFIED TESTED** | retail S4 |
| Line/order discount within cap | Yes — H-2 bounds + `_ledgr_pos_discount_cap` (fallbacks 25 manager / 10 cashier / 100 owner-admin) | Yes — retail S5/5b | Yes | No evidence | **VERIFIED TESTED** | retail S5 |
| Supervisor discount/price-override tokens (single-use, 15 min) | Yes — `request_pos_price_override`/`authorize_pos_price_override` (20261013000000) | Yes — retail S5b/S6 | Yes | No evidence | **VERIFIED TESTED** | retail S5b/S6 |
| Off-catalogue price rejection (D-PRICE) | Yes | Yes — retail S6 + probe (price 1200 vs catalogue 500 refused: "A supervisor must authorise a price override") | Yes | No evidence | **VERIFIED TESTED** | retail S6 |
| Insufficient-stock refusal (no partial writes) | Yes — 23514, atomic rollback | Yes — retail S7 | Yes | No evidence | **VERIFIED TESTED** | retail S7 |
| Idempotent replay / tamper rejection (offline reconnect) | Yes — business+client_key, P5-A sha256 payload hash, 22023 mismatch | Yes — retail S8/S12 + R13 | Yes | No evidence | **VERIFIED TESTED** | retail S8 |
| Refund (approval, cumulative cap, restock, COGS mirror) | Yes — `refund_pos_sale_command` (20261014000001) | Yes — retail S9 + POS.REFUND | Yes | No refund movements in production last 30 days | **VERIFIED TESTED** (COGS-mirror defect on VOID path found & fixed, §16 P0-5) | retail S9 |
| Void (approval, mirror reversal, restock) | Yes — `void_pos_sale_command` | Yes — retail S10 + POS.VOID | Yes | No evidence | **VERIFIED TESTED** (defect found & fixed, §16 P0-5) | retail S10 |
| Shift open/close, cash movements, Z-report | Yes — `open_pos_shift_command`, `record_pos_cash_movement_command`, `close_pos_shift_command`, `get_pos_shift_report` | Yes — retail S11 + R08 | Yes | **No shift was ever closed in production** | **IMPLEMENTED BUT NOT DEPLOYED-in-use** / defect found & fixed (§16 P0-1) | retail S11 |
| Offline queue (Dexie) + sync replay | Yes — `src/offline/` (db/queueApi/syncEngine 'pos_sale' case), frozen reconciliation contract | Unit tests + R09 discovery; browser-class e2e BLOCKED | Yes | No evidence | **PARTIALLY IMPLEMENTED** (queue + replay verified at DB level; no browser-runtime evidence) | §9 |
| Walk-in customer default | Yes — client name default + server `_ledgr_resolve_sale_contact` | Yes — retail S1 | Yes | Works only if the business already has a customer (defect found & fixed, §16 P1-4) | **VERIFIED TESTED** after fix | retail S1 |
| Barcode label printing | Yes — `PosBarcodeLabelGenerator.tsx` | Not found | Yes | No evidence | **IMPLEMENTED (UI), untested at DB level** | component read |
| Receipt modal / print | Yes — `PosReceiptModal.tsx` | Not found | Yes | No evidence | **IMPLEMENTED (UI), untested** | component read |
| Stock status banner | Yes — `PosStockStatusBanner.tsx` → `pos_stock_availability(uuid,uuid)` | Yes — retail S0 | Yes | No evidence | **VERIFIED TESTED** | retail S0 |
| Owner analytics | Yes — `PosOwnerAnalytics.tsx` | Not found | Yes | No evidence | **IMPLEMENTED (UI), untested** | component read |
| Usage limits on sales | Yes — `_ledgr_assert_usage_limit` (free 50 / starter 200 / growth 500 / pro 2000 / enterprise unlimited, monthly) | Yes — R10 | Yes | No evidence | **VERIFIED TESTED** | R10 gate |

Not found anywhere in the POS path (and therefore **not** claimed): customer-facing display, electronic receipt sending (SMS/email), loyalty, held/parked orders, partial payment at the till (server refuses tenders ≠ total for non-credit), gift cards, multi-currency at the till (currency comes from the business), receipt numbering per terminal (single `reserve_next_document_number`).

---

## 3. FULL RETAIL-SALE TRACE (cashier → receipt)

Files, functions, tables and guards, in execution order. All links read from source at `4d9aa63` + this branch's migration.

1. **Sign-in & role** — Supabase session; membership via `business_users`; `can_operate_pos(business)` (20260923000000) requires an active business role.
2. **POS screen** — `src/pages/PosPage.tsx` `handleCompleteSale` (:454). The Pay button (`PosCart.tsx` :483) is gated **only** on a non-empty cart — it is not shift-gated (see §16 P0-3). `shiftId: currentShift?.id` (:471) — **null when no shift is open**; branch from the selected branch.
3. **Cart & totals** — `calculateCartTotals` (`posService.ts` :48); items carry `unit_price`, `discount`, `cost`. `PosPaymentModal` enforces client-side: credit requires a selected customer and zero tenders; split tender Σ = payable ± 0.05; single cash tendered ≥ payable.
4. **Payload** — `buildPosSaleQueuePayload` (:396): invoice (client status **`'sent'`**, branch, contact or walk-in sentinel), lines, payments (`bank_account_id` **null** — the modal never sets it), `client_key` (uuid, offline-stable), `overrides.{discountToken,lineTokens}`, `is_credit_sale`. → `buildPosSaleRpcPayload` (`posSaleRpc.ts`).
5. **Transport** — online: `postPosSaleViaRpc` → PostgREST RPC `post_pos_sale(jsonb)`; one retry on 5xx (800 ms); PGRST202/demo-null falls back to the legacy client-DML path, real errors throw. Offline: Dexie queue (`src/offline/db.ts`), replayed by `syncEngine.ts` 'pos_sale' case (:378) through the same RPC.
6. **Server: `post_pos_sale`** (20261012000000, SECURITY DEFINER) —
   a. `can_operate_pos`; **R08 till context**: terminal exists/active/branch-matching, shift trust (single open shift per terminal AND per cashier, partial uniques), closed shift → **late adjustment** (drawer untouched, `pos_shift_late_adjustments` append-only);
   b. **idempotency**: `(business_id, client_key)`; **P5-A** sha256 payload-hash guard (22023 `clientKey-payload-mismatch` — replay must be byte-identical, which matches the Dexie contract: the queue replays the stored payload);
   c. **validation**: tenders settle total ±0.01 or credit = zero tenders; **R06** tenant checks on every product; **H-2** arithmetic/discount bounds/VAT (17.5% inclusive when `vat_registered`); **D-PRICE** cap: off-catalogue line price without a live token → 22023;
   d. plan **usage limit** (`_ledgr_assert_usage_limit`);
   e. `reserve_next_document_number` → `INV-000n`;
   f. `_ledgr_resolve_sale_contact` → contact id;
   g. **INSERT** `invoices` (+`client_key` backstop) → `invoice_lines` → `invoice_payments` (keys `deriveClientKey(clientKey, idx)`);
   h. `_ledgr_complete_pos_sale` → sale entry `invoice:<id>:sale` (DR 1131 Debtors / CR revenue 4112 / DR discount 4130 / CR 2121 VAT), stock movements grouped by product from the invoice's own lines (**D-BRANCH**: strict branch location; **no warehouse fallback**), COGS `invoice:<id>:cogs` (DR 5100 / CR 1141 or product overrides; zero-cost lines skipped); per-payment settlement `invoice:<id>:settlement:<payment_id>` (DR tender account / CR 1131);
   i. drawer totals updated on the open shift.
   **Atomicity:** one transaction — any raise (validation, stock 23514, journal balance) rolls back everything (verified: retail S7 wrote zero rows).
7. **Permissions/tenancy** — SECURITY DEFINER + explicit `business_id` checks; cross-business product → 22023 (retail cross-tenant test); `can_access_branch` (P5-D, 20261007000000): org-wide owner/admin/manager/accountant/auditor, assigned-scope roles require branch match, unlisted roles legacy org-wide.
8. **Receipt/audit** — `PosReceiptModal` renders from the returned invoice; audit trail = invoices/lines/payments + keyed journal entries + stock movements (uuid `source_id` = invoice id) + shift counters.

---

## 4. SERVER-SIDE POSTING VERIFICATION (atomicity, idempotency, isolation)

| Property | Verified how | Result |
|---|---|---|
| Atomicity | retail S7 (insufficient stock) counts invoices/lines/payments/movements before+after a failing sale | **0 rows written on failure** — single transaction |
| Idempotency | retail S8/S12: same client_key replay → `idempotent:true`, same invoice id, still exactly 1 payment / 1 stock movement / 3 journal entries; tampered payload → 22023 mismatch, no second posting | **VERIFIED** |
| Tenant isolation | retail cross-tenant test: foreign cashier + foreign business + this business's product → 22023 | **VERIFIED** |
| Branch isolation | cashier branch-scoped to A posting to branch B → 42501; manager (org-wide) posting to a branch **without a stock location** → P0001 `branch-location-missing` (owner decision: no fallback, not relaxed) | **VERIFIED** |
| No warehouse fallback | `_ledgr_pos_stock_location`/`_ledgr_complete_pos_sale` read + the branch-location denial above | **VERIFIED** (by decision, kept) |
| Journal balance | retail final test: every journal entry in the business sums to 0 across all scenarios incl. void/refund/close | **VERIFIED** |

---

## 5. MANDATORY UUID / SOURCE-ID INVESTIGATION

| Question | Answer |
|---|---|
| **Repository state** | `stock_movements.source_id` and `.created_by` are **uuid** in `20261014000001` / `20261015000000`; all POS writers (`_ledgr_complete_pos_sale`, `record_sale_stock_and_cogs`, void/refund restocks, cash movements) pass uuids. The pre-20261014000001 text-vs-uuid defect is fixed on `main`. |
| **Production state** | Production database verified at migration target **`20261015000000`** (deploy run `36315752583` step "Verify DB reached migration target (production)" + live `/version.json`). Therefore production schema = uuid shape. |
| **Migration containing the fix** | `20261014000001_live_uuid_shape_pos_commands.sql` (uuid `source_id`, `_ledgr_try_uuid` tolerant casts, `created_by=auth.uid()`), `20261015000000_posted_journal_posting_key_inline.sql` (posting_key in-INSERT). Commits `f2c03bd`, `1a0c580`, `26b289e`, `9f9676f`. |
| **Deployment evidence** | GH API: production run `36315752583` (commit `4d9aa63`) all-success 2026-09-27, including the migration-target verification; live `https://ledgr-react.vercel.app/version.json` returns `{"commit":"4d9aa63…","migrationTarget":"20261015000000","mode":"production"}`. |
| **Remaining mismatch** | **None between main and production.** This branch adds `20261016000000` (not yet deployed — §13). One untested hypothesis remains open and clearly labelled: production-era rows written between ~2026-09-23 and the uuid fix may hold `p_invoice_id::text` values if the old `_ledgr_complete_pos_sale` failed on the then-text column — current-migration replay commits sales with stock+COGS fine, so this concerns only historical production rows; **UNKNOWN**, would need a production data check (`select count(*) from stock_movements where source_type='invoice' and source_id is null`) before trusting historical COGS. |

---

## 6. POSTED-JOURNAL IMMUTABILITY

- `posting_key` is **written during the original INSERT** (`20261015000000` re-issues `_ledgr_post_entry_keyed` to stamp `posting_key` in the INSERT itself; `_ledgr_post_cogs` likewise) — verified by reading the function bodies and by the R13 gate record H02/H03 (`POSTED-ENTRY-IMMUTABLE` PASS).
- All POS journal writers are keyed: `invoice:<id>:sale|settlement:<pid>|cogs`, `void:<entry_id>`, `refund:<key>:…`. Voids/refunds post **new mirrored entries**; they never update or delete originals (retail S9/S10 assert originals still exist alongside mirrors).
- Direct PostgREST writes are closed: posted invoices cannot be edited/deleted (H-4, 42501, only draft→sent and payment-command status transitions allowed); journal entries/lines are grant-closed to app roles (grant-closure observed as 42501 in tests).
- Writers enumerated: `post_pos_sale` (via `_ledgr_complete_pos_sale`), `refund_pos_sale_command`, `void_pos_sale_command`, `record_invoice_payment`/`create_invoice_with_lines` (non-POS), `record_inventory_journal_movement`, `save_quick_sale`. No client-side journal writer exists for POS sales.

**VERIFIED** (code + R13 hardening records + retail suite).

---

## 7. R07 CORRECTIONS AUDIT (no redesign)

- Approval choreography: `request_pos_approval` → `authorize_pos_approval` (requester ≠ authoriser enforced 22023; authority re-checked at consume; cashier holds no authority → 42501) → single-use consumption in `_ledgr_correction_preflight`. Direct tier (owner/admin/manager) needs no token — mirrors the pre-existing client permission model.
- Refund: cumulative cap server-side under the document row lock (over-refund refused even for a manager — retail S9); restock at **original cost** (average cost re-averages back); revenue mirror scaled by ratio; tender reversal DR 1131 / CR tender; COGS mirror scaled to returned cost (retail S9 asserts 3 mirrored entries).
- Void: full mirror reversal (sale + settlement + **COGS after this audit's fix**), restock at original cost, invoice → `void`, originals preserved, re-void refused, void-after-refund refused (converge via refunds).
- Exactly-once: command_key idempotent replay returns the same answer with zero new entries (retail S9/S10 replays; POS.VOID).
- **Defect found by this audit and fixed (P0-5, §16):** the void's reversal selection filtered `source_type='invoice'` while the COGS entry is posted with `source_type='inventory_cogs'` — voiding a stock sale left DR 5100 / CR 1141 standing while stock was restored (GL ≠ subledger). Fixed in `20261016000000` by extending the selection with `posting_key = 'invoice:<id>:cogs'`; the two release-gate counters that encoded the old 2-entry behaviour were updated to count the COGS original (intent unchanged: every original reversed exactly once).

---

## 8. SHIFT & TILL LIFECYCLE

- Open (`open_pos_shift_command`, command_key-idempotent): single open shift **per terminal AND per cashier** (partial unique indexes); opening cash recorded; drawer counters on `pos_shifts`.
- Sales bind to the shift (R08): trust checks on cashier/terminal/branch; a sale after close becomes a **late adjustment** — appended to `pos_shift_late_adjustments`, the closed drawer snapshot untouched (retail S11).
- Cash movements (`record_pos_cash_movement_command`): `cash_in`/`petty_cash`/`cash_out`, command-key idempotent, reflected in `expected_cash`.
- Report (`get_pos_shift_report`): cash/other tenders, sales count, refund total, tender breakdown, expected cash = opening + cash sales − refunded cash + movements — **derived from invoices with `status='paid'`** (this is why the status defect, §16 P0-1, zeroed it).
- Close (`close_pos_shift_command`): own-or-manager, `FOR UPDATE`, computes variance vs counted cash, allocates `Z-YYYY-<seq>` from `pos_z_report_seq`, stores an **immutable signed snapshot**; re-close → 22023 immutable (retail S11). Counting/expected recomputation confirmed in retail S11: 2 movements + 5 shift sales + 1 refund → variance 0 at the correct counted figure, late sale → adjustment row.
- **Production reality: no shift has ever been closed in either production business** — the whole close/Z-report path, and therefore the P0-1 defect inside it, has never been exercised by real users.

---

## 9. OFFLINE POS

- Queue: Dexie (`src/offline/db.ts`) with `clientKey` unique idempotency; payload captured at receipt time; replay replays **the stored payload verbatim** (this matters: a re-built payload gets a new offline invoice number → hash mismatch — correct, and the retail S8 test replays the original object).
- Sync: `syncEngine.ts` 'pos_sale' case replays through the same `post_pos_sale` RPC — server-side validation (stock, price caps, tenant) applies at replay, not in the browser. Failed items remain queued with the error.
- **Frozen offline reconciliation contract** (R09 decision): untouched by this audit — no queue schema change, no provenance additions, no replay-authority change.
- Gaps (unchanged, R09-documented): queued items carry no originating-actor provenance; quota/stock drift between capture and replay is arbitrated server-side at replay time (sale may legitimately fail then); browser-runtime (service-worker) behaviour has no automated browser-class evidence (BLOCKED records exist in R13 for this reason).

---

## 10. INVENTORY

- Stock movements: `sale` (from the invoice's own lines, grouped by product, only `track_inventory` products), `return_in` (refund/void at original cost), `opening_balance`, plus non-POS types.
- Balances: `inventory_balances` (qty + moving average cost) maintained by the R06 balance trigger — verified by retail S1/S2/S9/S10 (100→99→96…, restock back, average cost returns to 900 at original-cost restock).
- Location policy: **branch stock only** (owner decision #185): sale posts from the branch's stock location; a branch without a location is refused (`branch-location-missing`, P0001) — **no warehouse fallback was created**; single-shop businesses without a branch sell from the default location.
- Availability for the till banner: `pos_stock_availability(business, branch)` — returns balances + `branch_location_missing` flag (retail S0).
- Insufficient stock → 23514, nothing written (retail S7).
- Production observation (2026-09-27 evidence): "Head Office" branch holds −2 units (historical negative balance), and Ledgr Technologies branches lack stock locations — pre-existing data conditions a retail demo business must avoid replicating (give each selling branch a stock location before trading).

---

## 11. PRICING

- Catalogue price is the server-side cap: a line priced above the catalogue price without authorisation → 22023 `price-override-required` (verified empirically).
- Discounts: server caps by role (owner/admin 100, manager 25, cashier 10 default; `pos_settings` overridable). Over-cap discount → 22023 requiring a token; **tokens** (`pos_price_overrides`): requested by cashier, authorised by a supervisor who **re-checks at consume**, single-use, 15-minute expiry, requester cannot self-authorise (22023); a manager cannot authorise above their own cap (42501).
- Price overrides: same token machinery for per-product price changes; owner/admin/manager may also post an overridden price directly (direct tier — retail S6).
- Client confirmation never replaces server authority: all caps/tokens enforced inside `post_pos_sale`.

---

## 12. THE 12 MANDATED SCENARIOS — TEST EVIDENCE

`tests/retail/retail-scenario.test.ts` (16 tests, all PASS against the fixed branch, production uuid shape, real client builders):

| # | Scenario | Key assertions (all DB-level) |
|---|---|---|
| S0 | Shift open + stock visibility | availability returns seeded 100 units; second open shift on same terminal/cashier → 22023 |
| S1 | Cash sale, 1 product ×1 | invoice `paid`, paid/due 500/0, shift bound, walk-in contact created (on a contact-less business), payment row, stock 100→99, sale DR 1131/CR 4112, settlement DR 1110/CR 1131, COGS 300, shift cash +500 |
| S1b | Sale **without** a shift | posts cleanly (was 55000 crash before FIX C), `pos_shift_id` null |
| S2 | Multi-product (3 products, qty 2/1/1) | per-line rows, per-product stock, COGS debits Σ 7300 |
| S3 | Split tender cash 700 + Airtel 500 | settlement debits **1110 and 1125** (mobile money no longer in cash) |
| S4 | Credit sale | status `sent`, 0 payments, amount_due 8500, receivable DR 1131, **no settlement entry**, named customer bound |
| S5 | Discount within cap / above cap | 10% ok; 30% refused 22023, nothing written |
| S5b | Over-cap discount via token | manager-above-own-cap refused 42501; owner authorises; token single-use (second use refused) |
| S6 | Price override | cashier off-catalogue price refused 22023; manager direct tier posts |
| S7 | Insufficient stock | 23514; zero invoices/lines/payments/movements written |
| S8/S12 | Replay + tamper | same client_key → idempotent:true, no duplicates; tampered total → 22023 hash mismatch |
| S9 | Refund | approval choreography (cashier can't authorise 42501), exactly 3 mirror entries (sale+settlement+COGS), restock +1, replay idempotent, over-refund refused even for manager |
| S10 | Void | approval, 3 mirror entries, restock all products, COGS mirror balances original (7300/7300), re-void refused |
| S11 | Shift close | movements idempotent; report: cash 3200 / other 500 / count 5 / refund 500 / expected 14200; close variance 0, `Z-YYYY-n`, late sale → adjustment row, re-close refused (immutable) |
| — | Cross-tenant + branch guard | foreign business/cashier refused 22023; branch without location refused (manager) `branch-location-missing` |
| — | Ledger integrity | every journal entry in the business balances to 0 |

---

## 13. PRODUCTION STATUS REPORT

| Item | Value | Source |
|---|---|---|
| Production application commit | `4d9aa636e6bf4429b98b7634fbba410bfd388cf9` (= `main`) | GH API + live `/version.json` |
| DB migration state (production) | `20261015000000` (121-migration chain at deploy time) | deploy run step "Verify DB reached migration target (production)" |
| Supabase project | `hsuhuvuxfuufrlejsatw` (production) / `bkxzgkurcqvccsdjmqzg` (staging) | earlier session evidence |
| Vercel | `ledgr-react` (production) / `ledgr-react-prod` (staging alias) | earlier session evidence |
| Latest verified deployment | 2026-09-27 11:26:44–11:30:28Z, all-success | GH API |
| Live version check | `ledgr-react.vercel.app/version.json` → commit `4d9aa63`, migrationTarget `20261015000000`, builtAt 2026-09-27T11:30:10.630Z, mode production | fetched 2026-09-27 |
| Current `main` | `4d9aa63` (no drift) | git |
| **Gap** | **This branch's fixes (`20261016000000`) are NOT deployed.** Production runs the code in which the five §16 defects live. Runtime behaviour of the FIXED code in production: **PRODUCTION RUNTIME VALIDATION BLOCKED** (no production credentials in this sandbox; deploy + re-verify required) | — |

> ### POST-REPORT UPDATE — 2026-09-27 (manual production application)
>
> Immediately after this report was issued, the owner applied the **entire contents of `supabase/migrations/20261016000000_retail_sale_path_fixes.sql`** to the **production** database (`hsuhuvuxfuufrlejsatw`) via the Supabase SQL editor. Consequences, stated exactly:
>
> - **All five fixes are now LIVE in the production runtime.** They are `SECURITY DEFINER` function replacements, so the currently deployed frontend (`4d9aa63`) benefits immediately — no frontend change is needed for the fixed behaviour (backend-first is the documented safe rollout direction).
> - **Status:** fixes **PRODUCTION APPLIED (manually)**; pipeline **deployment of the fixed code still NOT done** — `main` does not contain `20261016000000` until the branch merges, and `supabase_migrations.schema_migrations` has no row for it. This is safe and self-healing: the next pipeline deploy of the merged branch re-applies the (idempotent, `create or replace`-only) file and records the history row. Deploying today's `main` alone is also safe (nothing reverts function bodies).
> - **Still pending:** (1) merge + pipeline deploy so the repo and production match (reproducibility); (2) the §17 production smoke test; (3) the owner decision on historical rows below. Until (1)–(2): the §18.10 verdict is unchanged.
> - **Historical production rows are NOT corrected by the migration** (it only fixes future sales). Diagnostics and proposed one-off corrections are in §17 item 3.
> - **Staging** (`bkxzgkurcqvccsdjmqzg`) has **not** received the script.

Production data (session evidence, 2026-09-27): Eagle Nova Horizon 319 invoices (last 2026-09-23 10:06 UTC), Eagle Nurseries 90 (09-23 09:37); **no shift ever closed**; no void/refund movements in 30 days; no closed periods; "Head Office" −2 units. Because the deployed client posts invoice status `'sent'` and the deployed server stores it verbatim, every fully-paid till sale made on production is expected to sit at `status='sent'` — the §16 P0-1 report/close derivation therefore shows zero sales there too. That expectation is code-derived (verified); the production rows themselves were not re-queried in this session.

---

## 14. THREE READINESS GATES

| Gate | Status | Basis |
|---|---|---|
| **Code** | **PASS** (this branch) | All five P0/P1 retail-path defects fixed minimally (§16); unit 920/920; release gate 822/0/54 on **both** schema shapes; types clean; lint clean; retail suite 16/16; no historical migration edited; no safeguard removed (D-PRICE, D-BRANCH, H-2/H-4, P5-A, R06, frozen offline contract all still enforced and re-tested) |
| **Deployment** | **NOT MET** | Fixes exist only on `arena/01a0e2ff-ledgr-react`. Production still runs `4d9aa63` with the defects. Required: merge + deploy through the existing backend-first pipeline (migrations → verify migration target → frontend), then live `/version.json` + a smoke sale. Until then: **PRODUCTION RUNTIME VALIDATION BLOCKED** for the fixed code |
| **Customer workflow** | **CONDITIONALLY MET (code-level)** | The full retail journey (walk-in → cart → tender → receipt → Z-report; supervisor overrides; refunds/voids) is machine-verified end-to-end against the production-shaped schema with real client builders. NOT verified: real hardware (printer/scanner), real multi-user browser sessions, a real day of trading, historical production data correction. A controlled demo on a fresh business is supported; live trading should follow the §17 checklist |

---

## 15. P0 / P1 / P2 CLASSIFICATION

**P0 — blocks or corrupts the retail customer workflow (all fixed on this branch, §16):**
1. Fully-paid till sales stored as `sent` → Z-report shows zero sales, close reports false variance (probe-confirmed end-to-end).
2. Mobile-money/card tenders posted to 1110 Cash on Hand (online RPC path never resolved tender accounts).
3. Sale without an open shift crashes with raw 55000 (UI-reachable; Pay button not shift-gated).
4. (found via release-gate counters) Void of a stock sale left the COGS entry un-reversed — GL inventory/expense diverge from the stock subledger.

**P1 — first-use blockers (fixed):**

5. Brand-new business with zero customer contacts cannot make its first walk-in sale (P0001).

**P2 — known, NOT fixed (out of the minimal mandate; owner decisions required):**

- Default revenue account for till sales of goods is **4112 Service Revenue** (pre-existing, identical in the legacy client path and the RPC; chart-semantics choice, not a divergence — changing it is an accounting decision).
- Named-but-not-selected customer (typed name, no selection) bills the Walk-in Customer — unreachable from the UI for credit sales (modal requires selection), cosmetic for cash.
- R08.6/R08.7 documented as "not started" yet pass (documentation drift only).
- Historical production rows (pre-uuid-fix era) may hold null `source_id` on till-sale stock movements — **UNKNOWN**, needs a production query before trusting historical COGS (§5).
- "Head Office" −2 units and missing stock locations on Ledgr Technologies branches (production data hygiene; demo businesses must seed a location per selling branch).
- No browser-runtime (service worker / offline cut-over) automated evidence (R13 BLOCKED records; unchanged).

---

## 16. IMPLEMENTED P0/P1 FIXES (minimal, retail-path only)

One additive migration: `supabase/migrations/20261016000000_retail_sale_path_fixes.sql`. It re-issues three function bodies (byte-identical to their latest definitions except the stated change) and adds one private helper. No table, policy, trigger or historical migration is touched. Every fix carries its reproduction evidence in the migration header.

### P0-1 — Invoice status never becomes `paid` → Z-report/close blind

- **Problem:** a fully-paid till sale lands `status='sent'`; `get_pos_shift_report` / `close_pos_shift_command` derive drawer totals only from `status='paid'` invoices.
- **Evidence (reproduced end-to-end, probe):** cash 500 + split cash 700/airtel 500 posted on one shift → report returned `{cash_tenders:0, other_tenders:0, sales_count:0, expected_cash: opening only, tender_breakdown:{}}`; close with counted 2200 → expected 1000 / variance +1200 / count 0 on a balanced drawer.
- **Root cause:** `post_pos_sale` inserted the client's status verbatim; the client has sent `'sent'` since the RPC path shipped; nothing ever transitioned it (H-4 blocks direct edits past draft/sent).
- **Minimal fix (FIX A):** at insert, a non-credit sale whose tenders settle the total is `'paid'` — the same rule `record_invoice_payment` applies. Credit/unpaid sales keep the client's status.
- **Tests:** retail S1 (`paid`), S1b, S4 (credit stays `sent`), S11 (report now counts all 5 shift sales, variance 0). Release gate re-run: 822/0/54 both shapes (fixtures already assumed `paid`, which is why the gate never caught it).
- **Production impact:** fixes every future sale. **Existing production rows stay `sent`** — they need a one-off data correction (update `status` where `amount_paid >= total_amount` and `status='sent'` and not credit) **before the first shift close** on a business with historical till sales; for the two production businesses this is decision-required (owner), since their books balance and no shift was ever closed.

### P0-2 — Every non-cash tender posted to Cash on Hand

- **Problem:** online RPC sales debited 1110 for **all** tenders without an explicit `bank_account_id`.
- **Evidence:** probe split sale — Airtel 500 settlement debited 1110; `PosPaymentModal`/`PosPage`/`posSaleRpc.ts` contain no `bank_account_id` (grep-verified), so the online path always sends null; the legacy resolver (`resolveTenderAccountId`, posService.ts:556) is only used by the legacy DML fallback.
- **Root cause:** `post_pos_sale` defaulted every null-account tender to `_ledgr_account_by_code('1110')`; the RPC path never re-implemented the client's account resolution.
- **Minimal fix (FIX B):** new private helper `_ledgr_pos_tender_account(business, method, explicit)` mirrors the legacy rule server-side: explicit account wins; cash → 1110; airtel_money → 1125; tnm_mpamba → 1126; other tenders → first bank account; each falls back to 1110 with the account absent (matches the legacy "post rather than fail" contract). The resolved account is stored on the payment row, so the settlement entry follows automatically.
- **Tests:** retail S3 (settlement debits 1110 **and** 1125).
- **Production impact:** future sales correct. Past misclassified tenders (if any mobile-money sales were taken online since the RPC path shipped) would need a decision-required correction; production evidence shows no void/refund activity and unknown tender mix — flag to owner with the historical-row query.

### P0-3 — Sale without an open shift crashes (55000)

- **Problem:** `post_pos_sale` with `shift_id` null and `terminal_id` null raised `55000 record "v_shift_row" is not assigned yet`.
- **Evidence:** reproduced (probe A/B) and UI-reachability verified: the Pay button is only gated on a non-empty cart; `PosPage:471` sends `shiftId: currentShift?.id` → null when no shift is open.
- **Root cause:** `v_branch_resolved := coalesce(v_branch_resolved, v_shift_row.branch_id)` read a record that both `SELECT INTO` branches had skipped.
- **Minimal fix (FIX C):** read `v_shift_row` only when a shift was resolved. A no-shift sale now posts with branch from the invoice (single-shop default-location flow preserved).
- **Tests:** retail S1b (posts cleanly, `pos_shift_id` null).
- **Production impact:** removes a raw-database-error dead end for the most common first-day mistake (cashier skips shift opening).

### P0-4 — (see P0-5 grouping) / P1-4 — First walk-in sale of a brand-new business fails

- **Problem:** fresh business + walk-in → `P0001 This sale has no customer and the business has no customer contact to bill it to.`
- **Evidence:** reproduced on a business created by `create_business_with_owner` (seeds no contacts); `'Walk-in Customer'` exists only client-side (posService.ts:366, ContactRepository comment documents it as "seeded" — it isn't).
- **Root cause:** `_ledgr_resolve_sale_contact`'s walk-in branch requires an existing customer and raises otherwise.
- **Minimal fix (FIX D):** when the business has no customer to bill to, create the default `'Walk-in Customer'` contact and bill the sale to it (the contact the client already expects).
- **Tests:** retail S1 (the scenario business deliberately seeds **no** contacts; the first sale creates and bills Walk-in Customer).
- **Production impact:** unblocks day-one onboarding; no effect on businesses that already have customers (existing lookup order unchanged).

### P0-5 — Void of a stock sale left COGS standing

- **Problem:** `void_pos_sale_command` mirrored only entries with `source_type='invoice'`; the COGS entry is posted with `source_type='inventory_cogs'` → voiding reversed revenue and tender but left DR 5100 / CR 1141 while stock was restored.
- **Evidence:** retail S10 first run: 2 reversal entries instead of 3; COGS mirror absent (documented R07 contract says "full mirror-reversal of ALL posted journal entries (sale + settlement + COGS)" — the implementation missed the COGS original's source_type).
- **Root cause:** reversal selection filter mismatch with the COGS posting's source_type.
- **Minimal fix (FIX E):** extend the selection with `or posting_key = 'invoice:<id>:cogs'` (keyed, so replay/idempotency behaviour unchanged). Two release-gate counters (POS.VOID, FINANCE.REVERSAL) updated to count the COGS original among originals — their intent (every original reversed exactly once) is now stronger, not weaker.
- **Tests:** retail S10 (3 mirrors; COGS mirror balances the original 7300/7300); release gate POS.VOID + FINANCE.REVERSAL PASS.
- **Production impact:** future voids correct. Production has no void movements in 30 days → no historical corruption from this path on current evidence.

**Not done (deliberately):** no client-side shift gating added (server fix is authoritative and keeps the no-shift flow working); no data-migration of historical production rows (owner decision, §17); no revenue-account change (P2); nothing outside the retail customer path.

---

## 17. WHAT MUST BE COMPLETED BEFORE REAL RETAIL USE

1. **Merge & deploy this branch** through the existing pipeline (migrations run first; the pipeline's migration-target check must report `20261016000000`), then verify live `/version.json` shows the new commit. *(Deployment gate.)*
2. **Smoke-test in production** after deploy: one cash sale, one mobile-money sale (check the settlement account in the journal), close the shift, verify the Z-report counts both sales and variance 0. *(Turns PRODUCTION RUNTIME VALIDATION BLOCKED into verified.)*
3. **Decide on historical-row correction** (owner): production till sales sitting at `sent` despite full payment, and any pre-fix mobile-money tenders booked to 1110. Proposed one-off SQL is in §16 P0-1/P0-2; must run inside the ledgr_repair evidence-gated process per house rules (additive, never automatic). **UPDATE 2026-09-27:** the migration is now applied to production (see §13 addendum) — the diagnostics below can be run there immediately:
   ```sql
   -- (a) Fully-paid invoices still labelled 'sent' (the P0-1 residue):
   select count(*) as mislabelled, min(issue_date) as oldest, max(issue_date) as newest
     from public.invoices
    where status = 'sent' and amount_paid >= total_amount - 0.005 and amount_due <= 0.005;

   -- (b) Non-cash tenders whose settlement was booked to 1110 Cash on Hand (P0-2 residue;
   --     pre-fix code stamped the resolved 1110 id onto invoice_payments.bank_account_id):
   select ip.payment_method, count(*) as n, sum(ip.amount) as total
     from public.invoice_payments ip join public.accounts a on a.id = ip.bank_account_id
    where ip.payment_method in ('airtel_money','tnm_mpamba','card','bank_transfer','cheque')
      and a.code = '1110'
    group by 1;

   -- (c) Proposed one-off status correction for (a) — OWNER DECISION, review counts first;
   --     safe here because the SQL editor runs as postgres (H-4 exempts it) and no periods
   --     are closed. Correcting (b) would require reversing JOURNAL entries (posted entries
   --     are immutable) — accountant's call if the amount is material.
   -- update public.invoices set status = 'paid'
   --  where status = 'sent' and amount_paid >= total_amount - 0.005 and amount_due <= 0.005;
   ```
   **Demo-day warning:** no shift has ever been closed in either production business, so the **first** shift close will include every historical sale bound to that shift and report the full unreconciled drawer variance. That is the system telling the truth, not a bug — close any stale open shift **before** the meeting and start fresh.
4. **Demo-business setup checklist** (config, not code): seed products with cost + sale price, a stock location **on every selling branch**, opening stock, a till terminal per branch, and (post-fix optional, pre-deploy mandatory) a 'Walk-in Customer' contact; open a shift before trading until the fix is deployed.
5. **Day-one operational rules for the demo:** don't sell from a branch without a stock location (by design it's refused); supervisor credentials available for price overrides/voids/refunds (cashier caps 10% discount, no price override, no void/refund without approval); expect offline sales to replay server-side (stock may have moved — the replay may legitimately refuse).

---

## 18. FINAL REPORT

### 18.1 Executive summary
The POS retail customer path is implemented, server-authoritative, and — after the five fixes on this branch — behaves correctly end-to-end for the twelve mandated scenarios, verified against a full production-shaped migration replay with the real client payload builders. Production is currently deployed at `main` (`4d9aa63`, migration `20261015000000`) but **does not contain these fixes** and demonstrably contains the defects they remove (Z-report blindness, cash-account misclassification for mobile money, no-shift crash, first-walk-in failure, void COGS gap).

### 18.2 What POS can safely do today (on this branch, code-verified)
Cash/multi-product/split-tender/credit sales with correct double-entry (revenue, VAT, settlement, COGS), stock decrements, discounts within caps, supervisor-token overrides, insufficient-stock refusal, idempotent offline replay, approval-gated refunds and voids with full mirror reversal and restock, shift open/report/close with Z-report and variance, cross-tenant and branch isolation.

### 18.3 What is implemented but not deployed
Everything in §18.2 plus this audit's five fixes — production last deployed 2026-09-27 11:30 UTC at `4d9aa63`.

### 18.4 What was broken (found by this audit, now fixed)
P0-1 status/Z-report, P0-2 tender accounts, P0-3 no-shift crash, P0-5 void COGS, P1-4 first walk-in. Each: problem, reproduction, root cause, minimal fix, tests, production impact in §16.

### 18.5 What is unfinished (P2, decision-required, not blocking a controlled demo)
Historical production-row corrections; 4112-as-default-revenue chart semantics; browser-runtime offline evidence; production data hygiene items (§15).

### 18.6 Verification method
Full migration replay (embedded PostgreSQL 17, both schema shapes), real client builders, DB-level assertions on every financial table, the 822-record release gate, 920 unit tests, live production `/version.json` + GH deploy API. Absence of evidence was never treated as a pass.

### 18.7 Production status
Deployed: `4d9aa63` @ migration `20261015000000` (verified two ways). Fixed code: **not deployed — PRODUCTION RUNTIME VALIDATION BLOCKED** for the fixes until the §17 deploy + smoke test.

### 18.8 Readiness gates
Code **PASS** · Deployment **NOT MET** (fixes undeployed) · Customer workflow **code-verified; live trading conditional on §17**.

### 18.9 Test evidence
Unit 920/920 · release gate 822/0/54 (repo shape) and 822/0/54 (production uuid shape) · types/lint clean · retail scenario suite 16/16 (§12).

### 18.10 Verdict

RETAIL READY FOR CONTROLLED DEMO — PRODUCTION DEPLOYMENT NOT VERIFIED
