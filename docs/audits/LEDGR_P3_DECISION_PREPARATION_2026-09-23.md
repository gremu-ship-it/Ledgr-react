# LEDGR — P3 DECISION-PREPARATION DOCUMENT

**Date:** 2026-09-23
**Owner:** Alexander Gremu
**Class:** Analysis / Decision-Preparation Only — No Implementation Authorized
**Baseline:** `bc97e32` (on `b8f3f00` + P2a second-connection harness)
**Verified release evidence:** **742 PASS / 0 FAIL / 40 BLOCKED / 782 release records** (794 incl. 12 LEGACY) — two byte-identical gates `b9d41ec854a1`
**Scope:** P3 only — five analysis areas. No migration, RLS, Edge, AI, billing, or branch code changed.

---

## 1. Executive State Summary

At `bc97e32` the release harness is **deterministic** (two byte-identical local runs) and **zero FAIL**. The product is at **R00→R12 + R09.3(P-D3-FINAL)/P-D4 + R09.4 browser + P2a** — all STOP-gated packages individually authorized.

**What is settled:** R01 privileged-write boundaries, R02 token shape (not provider), R03 `ai_context` authorization, R04 tenant/role enforcement (except 8 `BRANCH.*` escapes), R05 financial invariants, R06 stock authority (`trg_stock_movement_apply_balance` + `chk_inventory_balances_on_hand_nonneg` 23514, product-tenant 22023, two-connection concurrency proven via `R06.POS.STOCK.CONCURRENT-2C`), R07 approvals/corrections, R08 till/shift reporting, R09.1 cache wipe, R09.2 queue provenance/lease/quarantine, R09.3 Model 3 (23514→`stock-denied`, P0QLT→`policy-denied`) + Model 4 (`reconcile_offline_queue_item` with fresh server revalidation, original `clientKey` immutable), R10 `P0QLT` contract, R12 webhook fail-closed, R13 harness determinism, R09.4 browser SW/queue provenance. Unit **731/731**, `tsc -b` clean, release-types clean, ESLint 0 errors, CI build OK.

**What remains BLOCKED (40 release):** 8 `BRANCH.*`, 1 `BILLING.SERVER-QUOTA`, 4 `OFFLINE.*`, 2 `R094.BROWSER.SERVER-REVALIDATION`, 2 `TENANT.*.storage`, 13 `R02` provider/OTP, 4 `AUTH`, 3 `PRIV`, 1 `AI.BRANCH`, 1 `R06.POS.STOCK.CONCURRENT` (historical, preserved), 1 `R02.DEC-02`. Each cites an exact limitation (decision-gated, harness-scope, or environment). No manufactured PASS.

**P2a preservation:** Historical `R06.POS.STOCK.CONCURRENT` remains **BLOCKED** with its original single-connection limitation citation. `R06.POS.STOCK.CONCURRENT-2C` is the additive **PASS** proving `FOR UPDATE` serialization + `23514` via two independent `pg.Client`s (`A_cashier` + `A_admin`, collective oversell `2>1`, loser `23514`, no negative, no partial, idempotent). No product migration/RLS/`post_pos_sale` change was made.

**P3 result:** Five policy questions are **OPEN** and require **OWNER DECISION REQUIRED** before any implementation package. This document converts them into precise decision packages with evidence discipline, without selecting a policy.

**STOP:** No P4–P10, R11, R14, GAP-6, R02-impl, P8, P9, or R15 work was started.

---

## 2. Current Verified Baseline

| Layer | Evidence | Commit / Artifact |
|---|---|---|
| Release gate | `742/0/40/782` (794 total), `b9d41ec854a1`, `evidenceExit=2` (BLOCKED present, zero FAIL) — two local runs `.cache/r13/ledgr-r13-tGbSM8` + `YMmQku` | `bc97e32` on `b8f3f00` |
| Before P2a | `740/0/40/780` (752? 740+40) at `b8f3f00` | `b8f3f00` |
| Unit | `731/731` (86 files) | `npm run test` |
| Types | `tsc -b` clean, `tsc -p tests/release/tsconfig.json` clean | `npm run typecheck` |
| Lint | `eslint .` 0 errors (1 pre-existing generated-file warning) | `npm run lint` |
| Build | `vite build` CI-mode PWA OK | `npm run build` |
| Harness | `tests/release/database.mjs` now exposes `createSecondClient` (two independent `pg.Client`s) + `beginAsRole`/`commitTx`; `gate.mjs` 19 suites (18 + `r06-concurrent-2c`) | `tests/release/` |
| Stock | `R06.POS.STOCK.*` 9 PASS + 1 preserved BLOCKED + 2 new PASS (`CONCURRENT-2C` + `SEAL`) | `tests/release/r06-stock.test.ts`, `r06-concurrent-2c.test.ts` |

**Preserved:** All previously PASS records unchanged. All previously BLOCKED records unchanged except the two additive `CONCURRENT-2C` PASS. No historical record flipped `BLOCKED→PASS` without direct evidence.

---

## 3. Evidence Sources Consulted

- **Source code (actual files at `bc97e32`):** `src/offline/provenance.ts` (`QUEUE_PAYLOAD_VERSION=1`, `hasTrustworthyProvenance`, `replayViolation`, `sweepUnverifiableItems`), `queueApi.ts` (`MAX_PENDING_QUEUE_ITEMS=2000`, `STALE_SYNC_CLAIM_MS=120000`, `pruneSyncedItems`), `db.ts` (`QueueItem` schema `payloadVersion`/`payloadHash`/`origin*`/`exceptionClass`/`lease`), `lease.ts` (`LEASE_TTL_MS=30000`), `payloadIntegrity.ts` (`verifyPayloadIntegrity` SHA-256), `exceptions.ts` (`classifyReplayException` 23514→`stock-denied`, P0QLT→`policy-denied`), `reconciliation.ts` (`RECONCILABLE_EXCEPTION_CLASSES`, `isReconcilable`, `reconcile_offline_queue_item`), `src/lib/billing/quotaContract.ts` + `UsageService.ts`, `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` (`_ledgr_assert_usage_limit` P0QLT), `20260928000001_r06_stock_balance_authority.sql` (`trg_stock_movement_apply_balance` `FOR UPDATE` + 23514), `20260927000000_r03_ai_context_authorization.sql` (`ai_context`), `20260923000000_post_pos_sale_rpc.sql` + `20260930000001_r08_post_pos_sale_binding.sql` + `20261003000000_r06_pos_product_tenant_validation.sql`, `src/hooks/usePermissions.ts` (`canViewReports`).
- **Tests (actual runs):** `tests/release/database.mjs` (single→dual connection), `gate.mjs`, `fixtures.ts`/`bootstrap.sql`, `offline.test.ts` (`R09.QUEUE.*`), `r06-stock.test.ts` (`R06.POS.STOCK.CONCURRENT` BLOCKED citation verbatim), `r06-concurrent-2c.test.ts` (2 PASS), `r093-reconciliation.test.ts` (19 `R093.*`), `r094-browser.test.ts:637` `R094.BROWSER.STALE-VERSION-MEASURE` (0 and 9999 still pass, null quarantines), `r094-sw-update`, `r094-revalidation-investigation`, `edge.test.ts`, `r01–r08` suites.
- **Audits (actual docs at `bc97e32`):** `docs/audits/LEDGR_POST_R093_READINESS_GATE_2026-09-23.md` (§12 AUTHORIZED ONLY/NOT AUTHORIZED, §10 no TTL, §9 DEC-09 OPEN, §14 safety), `LEDGR_R09.3_DECISION_PACKAGE_2026-09-23.md`, `LEDGR_R09_3_READINESS_2026-09-22.md`, `LEDGR_R09.4_BROWSER_RUNTIME_EVIDENCE_2026-09-23.md`, `LEDGR_P2A_SECOND_CONNECTION_HARNESS_2026-09-23.md`, `LEDGR_R10_TYPED_QUOTA_CONTRACT_2026-09-22.md`, plus R00–R08 remediations.
- **Runtime:** Local `EmbeddedPostgres` 17, `pg` 8.x, `vitest` 5.0.1, Chromium PWA build (R09.4). **NOT EVIDENCED:** deployed Supabase (Auth/Storage) production/staging, deployed `pg_cron`/`pg_net`, real SMS/OTP provider, real browser field data beyond local harness.

---

## 4. Decision Register

| ID | Title | Status | Class | Required Before |
|---|---|---|---|---|
| **DEC-09** | Stale `payloadVersion` policy | **OPEN — OWNER DECISION REQUIRED** | Policy choice among legitimate alternatives | Implementation (before any `payloadVersion>1` ships) / Release if stale traffic exists |
| **DEC-TTL** | Queue TTL / Backlog Horizon | **OPEN — OWNER DECISION REQUIRED** | Policy choice (threshold + disposition) | Implementation (before any expiry code) / Release if backlog risk is release-blocking |
| **DEC-CONFLICT** | `OFFLINE.CONFLICT` contract | **OPEN — OWNER DECISION REQUIRED** | Policy choice (typed vs ordinary, reconcilability) | Implementation (before conflict resolver) / Release if conflict UX is release-blocking |
| **DEC-QUOTA** | `BILLING.SERVER-QUOTA` authoritative coverage | **OPEN — OWNER DECISION REQUIRED** | Policy choice (uniform vs POS+quick only) | Implementation (before wiring invoice-builder/payroll) / Release if asymmetric quota is release-blocking |
| **DEC-AI-BRANCH** | AI/reporting branch scope | **OPEN — OWNER DECISION REQUIRED** | Policy choice (org-wide vs branch-aware) + timing | Implementation (before branch-aware AI) / Release if AI branch is promised |

No winner, score, ranking, or priority is selected. All rows remain **OPEN**.

---

## 5. DEC-09 — Stale Payload Version

### 5.1 Observed Fact

- `src/offline/provenance.ts:19` — `QUEUE_PAYLOAD_VERSION = 1` written at `enqueue` via `buildProvenance`/`captureContext`/`hashQueuePayload`.
- `hasTrustworthyProvenance(item)` at `bc97e32` returns `true` iff `payloadVersion != null && typeof originUserId === 'string' && typeof capturedAt === 'string'` — **no `===1` check**. Observed: `payloadVersion 0` and `9999` both pass; `null` fails.
- `sweepUnverifiableItems` quarantines only `missing-provenance` when `payloadVersion == null` (legacy v1 rows); no `stale-version` path exists.
- `reconciliation.ts:isReconcilable` checks `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` + `payloadHash` + lease — **not version**.
- `tests/release/r094-browser.test.ts:637` `R094.BROWSER.STALE-VERSION-MEASURE` **directly measured, real Chromium, real PWA, no policy decided:** mutated persisted queue items to `payloadVersion 0` → still passes provenance gate and is replayable; `9999` → same; `null` (with `originUserId`/`payloadHash` nulled) → quarantines `missing-provenance` (visible, durable, never retried, never reconcilable). `R094.BROWSER.SW.QUEUE-PROVENANCE` + `PERSIST-RESTART` proved `payloadVersion`/`payloadHash` survive SW update and restart byte-identically (durability, not enforcement).
- No v2 payload shape has shipped; **NOT EVIDENCED:** natural stale traffic, real version drift, server handling of stale payload via `post_pos_sale`.

### 5.2 Existing Contract

- **Already settled by existing contract:** `payloadVersion` is captured and integrity-protected (`payloadHash` SHA-256 canonical JSON, `verifyPayloadIntegrity` → `payload-tampered` quarantine, client+server `22023`). `missing-provenance` is the only version-related quarantine and is **permanently non-reconcilable**. `QUEUE_PAYLOAD_VERSION` is declared exactly once. No `stale-version` or `unknown-version` `exceptionClass` exists (only comment placeholder in `db.ts`).
- **Existing invariant:** At `bc97e32`, stale, current, and unknown-future non-null versions are **indistinguishable** at both `hasTrustworthyProvenance` and `sweepUnverifiableItems`; the engine will attempt `syncItem` for any non-null version.

### 5.3 Unresolved Decision

**OPEN — OWNER DECISION REQUIRED.** The owner must choose among legitimate policies **without implementation in this package:**

- **A. Accept all non-null versions (keep current behavior).** Pros: maximal backward/forward compatibility, no surprise denials for old clients. Cons: future schema drift could be silently misinterpreted (server re-derives stock/branch but cannot invent a new required field) — risk accepted explicitly.
- **B. Reject stale (`payloadVersion < QUEUE_PAYLOAD_VERSION`) as typed exception** (`stale-version` quarantine, visible, not retried, reconcilable? TBD). Pros: protects against obsolete shapes, forces update. Cons: old client queue blocked until update; needs drawer copy distinct from `missing-provenance`; needs `RECONCILABLE` decision.
- **C. Reject unknown-future (`payloadVersion > QUEUE_PAYLOAD_VERSION`) as typed exception** (`unknown-version`). Pros: fail-closed for forward compatibility. Cons: beta/roll-forward clients blocked; frequent if version bumps.
- **D. Reject both directions (`!= QUEUE_PAYLOAD_VERSION`)** — strictest, fully version-locked.
- **E. Soft policy variants** — e.g., allow stale for N days, warn but allow, or quarantine stale only after TTL.

Each option preserves `missing-provenance` (null) as quarantine. **No option is selected; no recommendation is made.**

### 5.4 Three-Question Separation for DEC-09

- **Technically settled:** provenance capture, `payloadHash` integrity, `missing-provenance` quarantine, and measurement that `0`/`9999` currently pass. **ALREADY SETTLED BY EXISTING CONTRACT.**
- **Owner policy decision:** whether `0` (stale) and/or `9999` (unknown-future) should remain replayable, become typed exceptions (`stale-version`/`unknown-version`), or follow a soft threshold; and if typed, whether they are `RECONCILABLE`. **OPEN — OWNER DECISION REQUIRED.**
- **More evidence required:** real v2 shape, `R094.STALE-VERSION-MEASURE` extended through `post_pos_sale` to observe server handling of stale payload, drawer UX probe for `stale-version` vs `missing-provenance`, client-version distribution analytics, deterministic stale-reconciliation test (if reconcilable). **OPEN — MORE EVIDENCE REQUIRED** (but does not substitute for the policy choice).

---

## 6. Queue TTL / Backlog Horizon

### 6.1 Observed Fact

- **When created:** `src/offline/queueApi.ts:enqueue` at offline capture — `clientKey=crypto.randomUUID()`, `sequence=last+1`, `createdAt=now`, `payloadVersion=1`, `payloadHash`, `originUserId`/`originDeviceId`/`capturedAt`/`originBranchId`/`originShiftId` etc., `attemptCount=0`, `status='pending'`.
- **Provenance retention:** `Dexie` `ledgr-offline` IndexedDB `queue` (indexes `status,businessId,clientKey`); no server-side queue; `payloadVersion`/`payloadHash`/`origin*`/`exceptionClass`/`lease` persisted verbatim.
- **Lease:** `src/offline/lease.ts` `LEASE_TTL_MS=30000` per item, `claimLease` in Dexie transaction; `STALE_SYNC_CLAIM_MS=120000` (`queueApi.ts` `recoverStaleSyncClaims`) returns `syncing`>2m to `pending` (tab crash).
- **Retry:** `syncQueue` selects `pending`+`failed` (+ recovered `syncing`), marks `syncing`+lease, `syncItem`; on success `synced`+`resolvedServerId`; on `classifyReplayException` `stock-denied`/`policy-denied` → `failed`+`exceptionClass` (not retried); on `replayViolation`/`verifyPayloadIntegrity` failure → `quarantined` (never retried, never reconcilable).
- **Quarantine:** `quarantined` with `quarantineReason` (`missing-provenance`/`actor-mismatch`/`payload-tampered`/`legacy`) held forever, visible in `OfflineQueueDrawer`, never auto-deleted, never reconcilable.
- **Reconciliation:** `failed` with `stock-denied`/`policy-denied` + `payloadHash` + lease → `isReconcilable`; manager-only `reconcile_offline_queue_item` replays original payload under original `clientKey` with fresh server validation.
- **Very old items:** At `bc97e32`, **no time-based expiry** for `pending`/`failed`/`quarantined`. `MAX_PENDING_QUEUE_ITEMS=2000` hard cap at `enqueue` (`pending+failed+stale-syncing >=2000` throws). `pruneSyncedItems(olderThanMs=7*24*60*60*1000)` exists but is **manual-only** (not called by `useSyncQueue` on every sync). An item created 6 months ago remains `pending` forever, still replayable (if provenance passes) with stale `payloadVersion`/branch/shift context.
- **Device/actor:** `originUserId`/`originDeviceId`/`originBranchId`/`originShiftId` retained; `sweepUnverifiableItems` quarantines `actor-mismatch` if `originUserId != currentUserId` **except** when `exceptionClass` is set (Model 4 recovery skips actor-mismatch to allow another manager to reconcile). **NOT EVIDENCED:** real multi-device age distribution, real `quantity_on_hand` drift for old pending items.

### 6.2 Existing Contract

- **Already settled:** indefinite retention for `pending`/`failed`/`quarantined`; `synced` 7-day manual prune; 2-minute stale-claim recovery; 2000-item cap; lease exclusivity; quarantine is durable and auditable (`offline_queue_reconciliations` append-only `SELECT` policy). No `expired` `quarantineReason` or `exceptionClass` exists.
- **Invariant:** Evidence is retained (R09.2) — deletion would violate preservation.

### 6.3 Unresolved Decision

**OPEN — OWNER DECISION REQUIRED.** Owner must choose **threshold + disposition** among legitimate policies:

- **No expiry (keep current).** Pros: zero data loss, maximal availability. Cons: unbounded drawer growth, battery/CPU with 1000+ items (`where('status').anyOf('pending','failed').toArray()` + sequential `syncItem`), stale provenance (closed shift, inactive user) leading to permanent `actor-mismatch` that is never cleaned.
- **Expiry → quarantine (`expired`).** `createdAt` age > N → `quarantined`+`quarantinatedAt`, visible, never retried. Pros: preserves evidence, distinct from `missing-provenance`. Cons: needs new `quarantineReason`, drawer copy, and rule for whether `expired` is reconcilable (likely **not**).
- **Expiry → `failed` (no exceptionClass).** Pros: payload preserved. Cons: creates infinite retry loop — **integrity harm**, not recommended without typed exception.
- **Expiry → delete.** Pros: hygiene. Cons: **evidence loss**, violates R09.2 preservation, conflicts with `offline_queue_reconciliations` audit.
- **Expiry → require new capture** (delete + toast “re-create”). Pros: intentional, fresh context. Cons: evidence loss unless explicitly audited; needs UX.

Each non-`no-expiry` option must respect lease (do not delete `syncing` while leased) and must not overwrite provenance `quarantineReason` without evidence; deletion must not remove server `offline_queue_reconciliations` rows.

### 6.4 Three-Question Separation for TTL

- **Technically settled:** current lifecycle, caps, lease, quarantine, reconciliation, and that no TTL exists. **ALREADY SETTLED BY EXISTING CONTRACT.**
- **Owner policy decision:** whether to keep indefinite retention, and if not, the age threshold (7d/30d/90d/other) and disposition (quarantine/delete/fail/new-capture) and reconcilability of `expired`. **OPEN — OWNER DECISION REQUIRED.**
- **More evidence required:** age distribution (p50/p95 `createdAt` lag) from analytics (**NOT EVIDENCED**), `R094.BROWSER.PERSIST-RESTART` extended to 30/60/90-day replay through `post_pos_sale`, `syncQueue` duration with 500/1000/2000 items, lease+TTL race test, `pruneSyncedItems` auto vs manual policy. **OPEN — MORE EVIDENCE REQUIRED.**

---

## 7. OFFLINE.CONFLICT

### 7.1 Observed Fact — Conflict Types Actually Supported by Repository Evidence

The following are **directly evidenced** (code + deterministic test + migration). No taxonomy is invented to fill gaps.

| # | Class | Evidence |
|---|---|---|
| 1 | **Duplicate / idempotency** (`clientKey` already committed) | `post_pos_sale` returns `id`+`idempotent:true` (`R06.POS.STOCK.REPLAY`, `R093.RECON.IDEMPOTENT-LOST-ACK` PASS, P2a `CONCURRENT-2C` idempotent replay PASS) |
| 2 | **Stale document state** (payload edited after capture) | `payloadIntegrity.ts` `verifyPayloadIntegrity` SHA-256 → `payload-tampered` quarantine before network (`R093.TAMPER.QUARANTINED` PASS, `R093.RECON.TAMPER-BLOCKED` PASS) — server stale check for invoices **NOT EVIDENCED** (no `updated_at` comparison in `post_pos_sale`) |
| 3 | **Stock conflict** (`23514` `chk_inventory_balances_on_hand_nonneg`) | `trg_stock_movement_apply_balance` `SELECT … FOR UPDATE` on `(business_id,product_id,location_id)` + `CHECK` → `23514` (`R06.POS.STOCK.INSUFFICIENT`/`ATOMIC-FAILURE` PASS, `R093.EXCEPTION.STOCK-DENIED` PASS, P2a `CONCURRENT-2C` two-connection `23514` PASS) |
| 4 | **Closed-shift / till branch** (`DEC-08` late arrival vs closed) | `v_branch_resolved = coalesce(payload.branch, shift.branch)` + `pos_shift_late_adjustments` append-only, re-close denied `22023` (`R08.SALE.LATE-ARRIVAL-BOUND` PASS, `R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL` PASS) |
| 5 | **Branch/tenant mismatch** (`branch_id` not in `can_access_branch`, foreign `product_id`) | `checkPosLineProductsBelongToBusiness` → `22023` (`R06.POS.STOCK.PRODUCT-MISMATCH` PASS), `can_operate_pos`/`can_write_sales_data` → `42501` (`R06.POS.STOCK.CROSS-TENANT` PASS, `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` PASS) |
| 6 | **Terminal mismatch** (shift `terminal_id` ≠ claimed `terminal`) | `Claimed shift does not belong to the claimed terminal (R08)` `22023` — code in `20260930000001_r08_post_pos_sale_binding.sql:114` but **no dedicated PASS record**; path is **NOT EVIDENCED** as a lived test, only as source-declared policy |
| 7 | **Payload-version conflict** | Code **does not check** (see §5.1) — any non-null version passes; **NOT EVIDENCED** as a conflict class, only as `R094.BROWSER.STALE-VERSION-MEASURE` measurement |
| 8 | **Already-posted `clientKey` with differing payload** | `post_pos_sale` deduplicates by `client_key` alone (returns original, no payload comparison); `reconciliation.ts` checks `payload business/client_key` identity locally; same `clientKey` + different `line_total` server behavior **NOT EVIDENCED** (no test) |
| 9 | **Quota denial** (`P0QLT`) | `_ledgr_assert_usage_limit` inside `post_pos_sale`/`save_quick_*` → `P0QLT` (`R10.QUOTA.SERVER-POS`/`QUICKSAVE` PASS, `R093.EXCEPTION.POLICY-DENIED` PASS) |
| 10 | **Authorization denial** (`42501` `can_operate_pos`/`can_access_branch`) | `post_pos_sale` gate (`R06.POS.STOCK.CROSS-TENANT` `42501` PASS, `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` PASS) |
| 11 | **Tampered payload** (`payloadHash` mismatch) | `verifyPayloadIntegrity` → `payload-tampered` quarantine (`R093.TAMPER.*` PASS, `replayViolation` never retried) — client + server `22023` |
| 12 | **Missing provenance** (`payloadVersion null` or `originUserId` missing) | `hasTrustworthyProvenance` → `missing-provenance` quarantine (`R09.QUEUE.LEGACY.QUARANTINED` PASS) — legacy `payloadVersion: null` preserved verbatim |
| 13 | **Legacy payload** (pre-R09.2 shape) | `db.ts:277` migration keeps `payloadVersion null` intentionally; `sweepUnverifiableItems` treats as `missing-provenance` — **permanently non-reconcilable** |
| 14 | **Other durable** (e.g., `quantity_on_hand` CHECK, `posting_key` unique) | `FINANCE.POSTING-KEY-UNIQUE` etc. — **NOT EVIDENCED** as offline conflict paths, only as finance invariants |

### 7.2 Existing Contract — Per-Class Behavior

For each evidenced class, the current server/client/exception/reconciliation contract is:

| Class | Current Server Behavior | Current Client Behavior (syncEngine/provenance/lease) | Existing Classification | Ordinary Retry? | Model 3 (`failed`+`exceptionClass`)? | Model 4 Reconciliation Permitted? | Permanently Non-Reconcilable? |
|---|---|---|---|---|---|---|---|
| 1 Duplicate/idempotency | Return original `id`, `idempotent:true`, no second invoice/movement/journal; atomic | `idempotent:true` → `synced`; `offline_queue_reconciliations` dedup | `R093.RECON.IDEMPOTENT-LOST-ACK` | No (success) | No (success) | **Yes** (by design, original key) | No |
| 2 Stale document (tamper proxy) | No `updated_at` check (`post_pos_sale` inserts new doc) | `payloadHash` mismatch → `quarantined` `payload-tampered` before network; server `22023` on tampered | `R093.TAMPER.QUARANTINED` | No | No (quarantine) | **No** (integrity) | **Yes** (`payload-tampered` never reconcilable per `20261002000000` `22023` + client `replayViolation`) |
| 3 Stock 23514 | `FOR UPDATE` + `CHECK` → `23514`, full rollback (invoice/payment/journal/movement/balance/shift drawer) | `23514` on `chk_inventory_balances_on_hand_nonneg` → `failed` `stock-denied`, not retried, visible; `R093.RECON.STOCK-RESOLVED` replays original `clientKey` with fresh stock check | `R093.EXCEPTION.STOCK-DENIED` | No | **Yes** (`stock-denied`) | **Yes** (exemplar) | No |
| 4 Closed-shift | `coalesce(payload.branch, shift.branch)`; closed → `pos_shift_late_adjustments` append-only, re-close `22023` | `R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL` pins Model 4 late arrival | `R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL` | No | **No** (late arrival is not `failed`; it commits as late) | **Yes** (late arrival is the reconciliation path) | No |
| 5 Branch/tenant mismatch | `can_access_branch` / `checkPosLineProductsBelongToBusiness` → `42501`/`22023`, zero mutation on either tenant | `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` → `failed` ordinary (no `exceptionClass`), zero mutation | `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` / `R093.RECON.INTEGRITY-REFUSED` (`42501`/`22023` refused before audit) | **Yes** (ordinary `failed` is retried, but will re-deny `42501`/`22023` — effectively quarantined by auth, but technically retried) — see note | No (never `exceptionClass`) | **No** (authority) | **Yes** (`42501`/`22023` never `RECONCILABLE`, both client `replayViolation` `actor-mismatch` and server `22023` before audit) |
| 6 Terminal mismatch | `Claimed shift does not belong to the claimed terminal` `22023` | `failed` ordinary (no `exceptionClass` evidenced) | Source-declared, **NOT EVIDENCED** as `R09.*` record | **Yes** (ordinary) but will re-deny | No | **No** | **Yes** (integrity) |
| 7 Payload-version | **No check** (see §5) | **No check** | **NOT EVIDENCED** (measurement only) | **Yes** (currently `pending`→`syncing`→success) | **No** (no `stale-version` class) | **UNDECIDED** (depends on DEC-09) | **UNDECIDED** |
| 8 Already-posted key + differing payload | `post_pos_sale` returns original `idempotent:true` without payload comparison (**NOT EVIDENCED** as denial) | `reconciliation.ts` local `payload business/client_key` identity check would refuse mismatched payload | Partial (reconciliation guards, normal replay does not) | No (treated as success) | No | **No** (tamper is `payload-tampered` quarantine) | **Yes** (if tampered) |
| 9 Quota P0QLT | `_ledgr_assert_usage_limit` → `P0QLT`, full rollback | `P0QLT` → `failed` `policy-denied`, not retried; `R093.RECON.POLICY-REVALIDATION` re-validates quota on reconcile | `R093.EXCEPTION.POLICY-DENIED` | No | **Yes** (`policy-denied`) | **Yes** (fresh quota check) | No |
| 10 Auth 42501 | `can_operate_pos` / `can_access_branch` → `42501` | `failed` ordinary, no `exceptionClass`; `R093.MATRIX.*` | `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` | **Yes** (ordinary) | No | **No** | **Yes** |
| 11 Tampered payload | `verifyPayloadIntegrity` on both client and server `22023` → before audit | `quarantined` `payload-tampered`, never retried, never reconcilable | `R093.TAMPER.QUARANTINED` + `R093.RECON.TAMPER-BLOCKED` | No | No (quarantine) | **No** | **Yes** |
| 12 Missing provenance | N/A (client quarantine before network) | `quarantined` `missing-provenance` | `R09.QUEUE.LEGACY.QUARANTINED` | No | No (quarantine) | **No** | **Yes** |
| 13 Legacy | N/A | `quarantined` `legacy` (pre-R09.2 shape) | `db.ts` migration + `sweepUnverifiableItems` | No | No | **No** | **Yes** |

*Note for 5/6/10:* Ordinary `failed` is technically retried by `syncQueue`, but the server will re-deny `42501`/`22023` deterministically, so the item will stay `failed` forever without becoming `quarantined`. Whether this should become a typed exception or `quarantine` is itself an **unresolved policy question** (see §7.3). At `bc97e32`, the classification is exactly as above — no `lastErrorCode` or quarantine reason has been altered in this package.

### 7.3 Unresolved Decision

**OPEN — OWNER DECISION REQUIRED.**

- Whether `payload-version` (class 7) and `already-posted key + differing payload` (class 8) should become typed exceptions (`stale-version`/`unknown-version`/`tampered`) or remain ordinary/`quarantine` as today. This is the same decision as **DEC-09** but surfaced here as the conflict taxonomy.
- Whether ordinary `failed` authority denials (`42501` branch/tenant/auth, `22023` terminal/product-tenant) should be promoted to `quarantine` or to a typed `exceptionClass` to avoid infinite retry, or remain ordinary `failed` (current).
- Reconciliation scope: `RECONCILABLE_EXCEPTION_CLASSES` is `['stock-denied','policy-denied']`. Owner must decide whether it remains **current** (stock/quota only), expands to `payload-version` (if that becomes a typed exception — but then re-hydration vs new capture must be decided), or never expands. **No expansion is implemented in this package.**

### 7.4 Three-Question Separation for OFFLINE.CONFLICT

- **Technically settled:** The 14 classes above as implemented contracts, the server `FOR UPDATE`+`23514` stock invariant (now two-connection proven), branch/shift/terminal `42501`/`22023` gates, `P0QLT` quota denial, `payloadHash` integrity, `missing-provenance`/`tampered` permanent quarantine, and that `payload-version`/`already-posted differing payload` are **NOT EVIDENCED** as conflicts at `bc97e32`. **ALREADY SETTLED BY EXISTING CONTRACT.**
- **Owner policy decision:** Whether to add `stale-version`/`unknown-version` as typed exceptions, whether to promote ordinary `42501`/`22023` to quarantine/typed, and what `RECONCILABLE` contains. **OPEN — OWNER DECISION REQUIRED.**
- **More evidence required:** Same-`clientKey` + different `line_total` server test (**NOT EVIDENCED**), version-gated conflict matrix through `post_pos_sale` (**NOT EVIDENCED**), `updated_at` stale-document server check (**NOT EVIDENCED**), terminal-mismatch `R09.*` record (**NOT EVIDENCED**). **OPEN — MORE EVIDENCE REQUIRED.**

---

## 8. BILLING.SERVER-QUOTA

### 8.1 Observed Fact

- **Server declaration:** `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` — `public._ledgr_assert_usage_limit(business_id)` counts month-start documents `SELECT count(*) FROM invoices WHERE business_id AND issue_date>=month_start + expenses (expense_date) + payroll_runs (pay_date)` into `v_usage`, compares to `plan_tier` (`free` 50, `starter` 200, `growth` 500, `pro` 2000, `enterprise` null/unlimited, unknown→free), and on `v_usage >= v_limit` raises `raise exception … using errcode='P0QLT', detail=format('quota_denial plan_limit=%s documents_used=%s …'), hint='Policy denial … Do not retry …'`. The message text is unchanged for UX; the **errcode is the contract**.
- **Client contract:** `src/lib/billing/quotaContract.ts` `QUOTA_DENIAL_SQLSTATE='P0QLT'`, `isQuotaDenial` checks `code==='P0QLT'` only, never message; `classifyReplayException` prioritizes `P0QLT` over `23514`.
- **Operations observed calling `_ledgr_assert_usage_limit` inside the posting transaction (atomic with document):**
  - `public.post_pos_sale(jsonb)` (POS sales, 3 journals) — direct call.
  - `public.save_quick_sale(jsonb)` (`src/dal/repositories/JournalRepository.ts` `saveQuickSaleViaRpc`) — direct call.
  - `public.save_quick_expense(jsonb)` (`saveQuickExpenseViaRpc`) — direct call.
- **Client look-ahead:** `src/lib/billing/UsageService.ts` `getCurrentMonthTransactionCount` first tries `supabase.rpc('ledgr_monthly_document_count')` (server count, `security definer`, RLS-immune, returns `null` on not-member/offline), falls back to three `head:true` counts on `invoices`/`expenses`/`payroll_runs` as the signed-in user (RLS-filtered), and `assertCanCreateDocument` is called in `syncEngine` before the legacy `createWithLines` path.
- **Operations NOT observed calling `_ledgr_assert_usage_limit`:** `InvoiceRepository.createWithLines` / `BusinessRepository.reserveDocumentNumber` + `createWithLines` for draft/builder invoices (status `draft`, discounts/VAT), any direct `supabase.from('invoices').insert` outside queue (invoice builder UI), `PayrollRepository` direct inserts for `payroll_runs`. These paths rely solely on client look-ahead **if** the UI calls `UsageService`; otherwise no check.
- **Release evidence:** `tests/release/r06-*` `R10.QUOTA.*` 7 PASS records pin `post_pos_sale` + `save_quick_*` `P0QLT` (distinct from quota, client classification, precheck, regression `SUCCESS-CLIENTKEY`, server distinct). **NOT EVIDENCED:** invoice-builder full flow under quota (expect `P0QLT` but observe `P0001` or success), payroll run under quota, legacy `income` with `vat>0` under quota, concurrent two-connection quota race.
- **Offline replay:** `R093.EXCEPTION.POLICY-DENIED` (`P0QLT` → `policy-denied`) + `R093.RECON.POLICY-REVALIDATION` (fresh quota check on `reconcile_offline_queue_item` via `post_pos_sale`) — both PASS.

### 8.2 Existing Contract

- **Already settled:** `P0QLT` is the **sole authoritative** quota signal; `23514` remains `stock-denied`; client `UsageService` is a **look-ahead**, not authoritative; offline `policy-denied` is not retried and is `RECONCILABLE`.
- **Asymmetric enforcement is already settled as the current (unintended) contract:** `post_pos_sale`/`save_quick_*` are **server-enforced**; `createWithLines`/builder/payroll are **client-only** or **NOT EVIDENCED** as server-enforced. This is **not a manufactured gap** — it is directly observed via `grep -rn _ledgr_assert_usage_limit` and `grep -rn save_quick` vs. `InvoiceRepository.createWithLines`.

### 8.3 Unresolved Decision

**OPEN — OWNER DECISION REQUIRED.**

- **Coverage:** Should uniform server enforcement be extended to also cover `createWithLines` legacy + invoice-builder draft→post + `payroll_runs` direct inserts (so every `invoices`/`expenses`/`payroll_runs` insertion is `P0QLT`-metered), or should the contract remain **POS+quick only** as `R10` declares? The latter is a legitimate scoping decision if pricing is defined as “POS+quick transactions only” — but then `billing/page.tsx` copy and `UsageService` counts must match that scope.
- **Command contract:** Is quota a **per-transaction assert** (current, inside each posting RPC) or also an **entitlement/command** (`approve`/`grant` before capture) — the latter would gate offline capture, not just replay.
- **Security/business-integrity implications of the current asymmetric enforcement (already settled as fact, not as policy):** A `free` (50) customer via POS is correctly `policy-denied` at 51, while the same customer via invoice builder could exceed 50 via the unmetered path — same business, different enforcement, billing dispute risk. `payroll_runs` counted in `v_usage` but not metered on insert allows `payroll_runs` to overshoot even while `invoices` are blocked. RLS-filtered fallback counts allow a role without `payroll_runs` SELECT to see quota as not exceeded and be allowed locally, then be `P0QLT`-denied later (inconsistent UX).

### 8.4 Three-Question Separation for BILLING.SERVER-QUOTA

- **Technically settled:** `P0QLT` declaration, the three metered RPCs, the look-ahead fallback, and that `createWithLines`/builder/payroll are **client-only** at `bc97e32`. **ALREADY SETTLED BY EXISTING CONTRACT.**
- **Owner policy decision:** Whether to keep asymmetric (POS+quick only) or require uniform `P0QLT` on every document insertion (including builder/payroll/legacy), and whether quota is per-transaction vs entitlement. **OPEN — OWNER DECISION REQUIRED.**
- **More evidence required:** Runtime probe of builder/payroll/legacy under quota for `P0QLT` vs `P0001` vs success (**NOT EVIDENCED**), concurrent quota race (**NOT EVIDENCED**), RLS-filtered count divergence (**NOT EVIDENCED** as a lived test). **OPEN — MORE EVIDENCE REQUIRED** (but does not substitute for the coverage decision).

---

## 9. AI.BRANCH

### 9.1 Observed Fact

- **Current AI authorization (already settled, PASS):** `supabase/migrations/20260927000000_r03_ai_context_authorization.sql` — `ai_context(business_id)` is `REVOKE EXECUTE` from `public`/`anon`, `GRANT` to `authenticated`/`service_role`; guard: `auth.uid() is null && role != 'service_role'` → `42501`; not active member (`business_users.is_active`) → `42501`; active member but `role` ∉ `v_reports_roles` → `42501`. `v_reports_roles = ['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager']` verbatim `canViewReports=true` in `src/hooks/usePermissions.ts`. Excluded: `cashier,stock_clerk,sales_clerk,data_entry,supervisor,inventory_manager,payroll_manager,purchasing_officer,warehouse_worker,customer_service_rep` cannot call `ai_context` even in own business. `service_role` null-uid path preserved for Edge `ai-chat`. `R03.AI.RPC.*` 5 PASS + `R03.AI.EDGE.*` etc.
- **Current organization-level context:** `ai_context` returns a single-business document (`company, MTD KPIs, 12-month trend, overdue invoices, top expenses/customers, concentration, anomalies, receivable/payable schedules`) aggregated at `business_id`, **no `branch_id` parameter** on the RPC.
- **Branch information available to the server:** `invoices.branch_id`, `inventory_balances.location_id→inventory_locations.branch_id`, `pos_shifts.branch_id`, `pos_terminals.branch_id`, `branches` table, `business_users.branch_id`, `can_access_branch(business_id, branch_id)` predicate (org-wide roles `owner,admin,accountant,manager,auditor,viewer,board_member,treasury_manager,asset_manager,tax_compliance_officer` read all branches; assigned roles restricted to `business_users.branch_id` or `null`=org-wide) — all evidenced via `R08.*` PASS and `fixtures.ts`.
- **Branch-related evidence:** `R08.BRANCH.*` 8 records (`create/modify/read/reports/financial/inventory/customers/cross-branch-admin`) are **BLOCKED** — org-wide `can_write_business_data` tier still allows `A1`-assigned writer to `INSERT` branch `A2` documents except via POS command (the `R08` partial remediation). `R11` metric-consistency lane (permission-aware AI metric consistency, branch excluded per gate P4 carve-out) is **NOT EVIDENCED** (no `AI.BRANCH` record).
- **NOT EVIDENCED:** branch-filtered `ai_context(business_id, branch_id)` prototype, branch-scoped `v_ai_*` views, any `AI.BRANCH` PASS.

### 9.2 Existing Contract

- **Already settled:** `ai_context` is **organization-wide** and **role-gated** via `v_reports_roles`; branch dimensional data exists but is **not projected** into `ai_context`; `DEC-03` branch policy for `BRANCH.*` is **not settled** (still 8 escapes).

### 9.3 Unresolved Decision

**OPEN — OWNER DECISION REQUIRED.**

- **Branch scope:** Should AI remain **org-wide only** (current), gain an **optional branch filter (read-only, non-authoritative)** (`ai_context(business_id, branch_id?)` with `can_access_branch` check before assembling branch-filtered KPIs), or become **mandatory branch dimension** (every AI call is branch-scoped)?
- **Risks:** Branch-filtered AI with still org-wide writes (`BRANCH.*` escapes) is confusing — AI would say “A1 sales 10” while a `cashier` in `A1` could still create an invoice for `A2` via raw writer path. Branch filter must enforce `can_access_branch` or leaks cross-branch KPIs to assigned user. `cashier` currently cannot see any AI (`canViewReports=false`); branch-aware AI might be the only report a cashier should see (their branch) — diverges from `canViewReports` and needs a new `v_reports_roles` per-branch policy.
- **Dependencies before implementation:** `DEC-03` completion (one-vs-multi assignments, carve-outs) + `BRANCH.*` P8 (uniform `can_write_*` per surface) are prerequisites for coherent branch-aware AI. Safer **after P8** (read-only filter before P8 must be explicitly scoped as non-remediation).
- **Timing:** Owner must decide whether `AI.BRANCH` ships **after `BRANCH.*` P8** (coherent) or **before** (read-only filter, not remediation) — currently **NOT EVIDENCED** as a decision.

### 9.4 Three-Question Separation for AI.BRANCH

- **Technically settled:** `ai_context` org-wide, `v_reports_roles`, `can_access_branch`, and that `BRANCH.*` is 8 escapes and `AI.BRANCH` is no record. **ALREADY SETTLED BY EXISTING CONTRACT.**
- **Owner policy decision:** Whether AI remains org-wide, gains optional branch filter, or becomes mandatory; and timing after vs before P8. **OPEN — OWNER DECISION REQUIRED.**
- **More evidence required:** Branch-filtered `ai_context` prototype + `R11` metric-consistency lane (**NOT EVIDENCED**), `R08.BRANCH.*` remediation package (P8) completion. **OPEN — MORE EVIDENCE REQUIRED.**

---

## 10. Decision Dependency Matrix

Directly supported by code/migrations/audits — no invented dependencies.

| Depends on →<br>Question ↓ | DEC-03 (branch assignments) | DEC-07 (price/discount/tender) | DEC-09 (stale payload) | DEC-10 (queue/legacy) | R09.3 Model 3 (typed except) | R09.3 Model 4 (reconcile) | R09.4 (browser SW) | R11 (metric consistency) | R12 (webhook) | R14 (jobs/monitor) | GAP-6 (transfer/cost) | BILLING.SERVER-QUOTA (P0QLT uniform) | BRANCH.* (P8) | Auth/Recovery (R02) | Storage (R14) | Other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **DEC-09** | — | — | — | `legacy` shape (DEC-10) informs `null` vs stale | **Yes** (new `exceptionClass` would be Model 3) | **Yes** (`RECONCILABLE` list) | **Yes** (R09.4 measured `STALE-VERSION-MEASURE`; SW durability) | — | — | — | — | — | — | — | — | `QUEUE_PAYLOAD_VERSION` single declaration |
| **QUEUE TTL** | — (but `originBranchId` drift informs TTL) | — | **Yes** (stale `payloadVersion` informs age threshold) | **Yes** (`legacy` `null` handling) | **Yes** (`pending`→`failed` vs `quarantined` disposition) | **Yes** (`failed` `RECONCILABLE` vs `quarantined` never) | **Yes** (backlog perf measurement via browser) | — | — | — | — | — (but `policy-denied` backlog informs TTL) | — (branch drift) | **Yes** (`originUserId`/`deviceIdentity` drift) | — | `MAX_PENDING` 2000 cap |
| **OFFLINE.CONFLICT** | **Yes** (branch/tenant `42501` authority) | — (price write-through not a conflict class) | **Yes** (class 7 = DEC-09) | **Yes** (legacy `null` = `missing-provenance`) | **Yes** (`stock-denied`/`policy-denied` are typed) | **Yes** (`RECONCILABLE` scope) | **Yes** (tamper/version measurement) | — | — | — | — | **Yes** (class 9 P0QLT) | **Yes** (classes 5/6 branch/terminal) | **Yes** (`originUserId` actor binding) | — | `payloadHash` integrity |
| **BILLING.SERVER-QUOTA** | — | **Yes** (GAP-1 invoice lifecycle vs quota) | — | — | **Yes** (`policy-denied` is Model 3) | **Yes** (`policy-denied` reconcilable) | — | — | — | — | — | — | **Yes** (quota counts per `business_id`, not branch, but `branch_id` informs invoice scope) | — | — | `GAP-1` + `GAP-3` payroll |
| **AI.BRANCH** | **Yes** (one-vs-multi, carve-outs) | — | — | — | — | — | — | **Yes** (R11 metric consistency, branch excluded per P4 carve-out) | — | — | — | — | **Yes** (**P8** must precede coherent branch AI; 8 escapes today) | — | — | `can_access_branch`, `v_reports_roles` |

**Key:** `—` = no direct dependency evidenced at `bc97e32`.

---

## 11. Policy vs Evidence vs Implementation Distinction

Mandatory for each decision (per §8):

| Decision Area | (1) Already Technically Settled | (2) Requires OWNER POLICY DECISION | (3) Merely Requires MORE EVIDENCE |
|---|---|---|---|
| **DEC-09** | Provenance capture, `payloadHash` integrity, `missing-provenance` quarantine, measurement that `0`/`9999` currently pass (see §5.1). **ALREADY SETTLED BY EXISTING CONTRACT.** | Whether `0` and/or `9999` remain replayable vs become `stale-version`/`unknown-version` typed exceptions (and if typed, `RECONCILABLE`?). **OPEN — OWNER DECISION REQUIRED.** | Real v2 shape, `post_pos_sale` handling of stale, drawer UX, version distribution analytics, stale-reconciliation test. **OPEN — MORE EVIDENCE REQUIRED.** |
| **QUEUE TTL** | Indefinite retention for `pending`/`failed`/`quarantined`, `synced` 7d manual prune, 2m stale-claim, 2000 cap, lease exclusivity, quarantine durability (see §6.1). **ALREADY SETTLED.** | Threshold (none/7d/30d/90d/other) + disposition (quarantine/delete/fail/new-capture) + `RECONCILABLE` for `expired`. **OPEN — OWNER DECISION REQUIRED.** | Age distribution analytics, 30/60/90-day replay, backlog perf, lease+TTL race, `pruneSyncedItems` auto policy. **OPEN — MORE EVIDENCE REQUIRED.** |
| **OFFLINE.CONFLICT** | 14 classes as implemented (server `FOR UPDATE`+`23514`, branch/terminal `42501`/`22023`, `P0QLT`, `payloadHash`, `missing-provenance` etc.) and that `payload-version`/`already-posted differing payload` are **NOT EVIDENCED** as conflicts (see §7.1). **ALREADY SETTLED.** | Whether to add `stale-version`/`unknown-version` as typed, whether to promote ordinary `42501`/`22023` to quarantine/typed, and `RECONCILABLE` scope. **OPEN — OWNER DECISION REQUIRED.** | Same-`clientKey` differing payload server test, version-gated matrix, `updated_at` stale check, terminal-mismatch record. **OPEN — MORE EVIDENCE REQUIRED.** |
| **BILLING.SERVER-QUOTA** | `P0QLT` declaration, three metered RPCs, look-ahead fallback, and that `createWithLines`/builder/payroll are **client-only** at `bc97e32` (see §8.1). **ALREADY SETTLED.** | Keep asymmetric (POS+quick only) vs require uniform `P0QLT` on every document + per-transaction vs entitlement. **OPEN — OWNER DECISION REQUIRED.** | Builder/payroll/legacy under quota for `P0QLT`, concurrent quota race, RLS-filtered count divergence. **OPEN — MORE EVIDENCE REQUIRED.** |
| **AI.BRANCH** | `ai_context` org-wide, `v_reports_roles`, `can_access_branch`, 8 `BRANCH.*` escapes and `AI.BRANCH` no record (see §9.1). **ALREADY SETTLED.** | Remain org-wide vs optional branch filter vs mandatory branch + timing after vs before P8. **OPEN — OWNER DECISION REQUIRED.** | Branch-filtered `ai_context` prototype + R11, P8 remediation package. **OPEN — MORE EVIDENCE REQUIRED.** |

Do not classify an implementation gap as a policy question merely because implementation has not yet occurred — the table above does not.

---

## 12. Exact Unresolved Questions Requiring Alexander Gremu's Decision

The owner must explicitly authorize (no silent defaults, no ranking, no winner selected by development AI):

**DEC-09:**
1. Should `payloadVersion < QUEUE_PAYLOAD_VERSION` (stale, e.g., `0` when current `1`) remain replayable as today, or become a typed exception (`stale-version` quarantine)?
2. Should `payloadVersion > QUEUE_PAYLOAD_VERSION` (unknown-future, e.g., `9999`) remain replayable, or become a typed exception (`unknown-version`)?
3. If either becomes a typed exception, should it be `RECONCILABLE` (and if so, by re-hydration or new capture) or permanently non-reconcilable?

**QUEUE TTL:**
4. Should the queue keep **indefinite retention** (current) or impose a time-based horizon? If horizon, what threshold: none / 7d / 30d / 90d / other?
5. What disposition on expiry: quarantine (`expired`) / delete / `failed` (ordinary) / require new capture?
6. Should `expired` be `RECONCILABLE`?

**OFFLINE.CONFLICT:**
7. Should `payload-version` (class 7) and `already-posted key + differing payload` (class 8) be promoted to typed exceptions, or remain as **NOT EVIDENCED** / ordinary / `quarantine` as today?
8. Should ordinary `failed` authority denials (`42501` branch/tenant/auth, `22023` terminal/product-tenant) be promoted to `quarantine` or typed `exceptionClass` to avoid infinite retry, or remain ordinary `failed`?
9. What is `RECONCILABLE_EXCEPTION_CLASSES`: keep **current** `['stock-denied','policy-denied']`, expand to include `stale-version`, or never expand?

**BILLING.SERVER-QUOTA:**
10. Should server enforcement remain **POS+quick only** (`post_pos_sale`, `save_quick_sale`, `save_quick_expense`) as `R10` declares, or be extended to **uniform** (`createWithLines` legacy + invoice-builder draft→post + `payroll_runs` direct inserts) so every document insertion is `P0QLT`-metered?
11. Is quota a **per-transaction assert** (inside each posting RPC, current) or also an **entitlement/command** gating offline capture?

**AI.BRANCH:**
12. Should AI remain **org-wide only** (current), gain an **optional branch filter (read-only, non-authoritative)**, or become **mandatory branch dimension**?
13. Timing: Should `AI.BRANCH` ship **after `BRANCH.*` P8** (coherent) or **before** (read-only filter, not remediation)?

*All questions remain UNDECIDED and await explicit owner authorization.*

---

## 13. Evidence Required Before Each Subsequent Implementation Package

| Package (requires prior decision) | Evidence Required (runtime/environmental, **NOT EVIDENCED** at `bc97e32`) | Evidence Type |
|---|---|---|
| **DEC-09 impl (before any `payloadVersion` bump)** | Real v2 payload shape (field added/removed/renamed); `R094.BROWSER.STALE-VERSION-MEASURE` extended through `post_pos_sale` to observe server handling of stale payload; drawer copy UX probe for `stale-version` vs `missing-provenance`; client version distribution analytics; deterministic stale-reconciliation test if reconcilable | Browser harness + migration spec + analytics |
| **Queue TTL impl (before any expiry code)** | Age distribution `createdAt` p50/p95 from analytics; `R094.BROWSER.PERSIST-RESTART` extended to 30/60/90-day-old replay through `post_pos_sale`; `syncQueue` duration with 500/1000/2000 items; lease (`30s`) + TTL expiry race test; `pruneSyncedItems` auto vs manual policy | Browser harness + local perf + analytics |
| **OFFLINE.CONFLICT resolver impl (before resolver ships)** | Same-`clientKey` + different `line_total` server test (idempotent return vs `22023`?); version-gated conflict matrix through `post_pos_sale`; `updated_at` stale-document server check spec; terminal-mismatch `R09.*` record | Local PG harness (`R13`-style) |
| **BILLING.SERVER-QUOTA uniform wiring (before wiring)** | `invoice-builder` full flow (draft→post) under quota for `P0QLT` vs `P0001` vs success; `payroll_runs` direct insert under quota; legacy `income` with `vat>0` under quota; concurrent two-connection quota race; RLS-filtered `payroll_runs` count divergence | Local PG harness + call-site grep |
| **AI.BRANCH (before branch-aware AI)** | Branch-filtered `ai_context(business_id, branch_id?)` prototype with `can_access_branch` check; `R11` metric-consistency lane (branch) ; `P8` `BRANCH.*` remediation package (8 escapes closed) | Local PG harness + `ai_context` RPC spec |

Where evidence is unavailable at `bc97e32`, the status is **NOT EVIDENCED** (not inferred).

---

## 14. Explicit Exclusions

The following are **not** in P3 and were **not** changed in this package (per §11–§12 authorization, and P2a preservation):

- No `QUEUE_PAYLOAD_VERSION` bump or `stale-version`/`unknown-version` `exceptionClass` added; no `hasTrustworthyProvenance` or `sweepUnverifiableItems` change.
- No queue TTL / expiry / deletion / purge / archival; `pruneSyncedItems` remains manual-only; `MAX_PENDING` still 2000; no `expired` quarantine.
- No `lastErrorCode` alteration; no `quarantineReason` added; `payload-tampered`/`legacy`/`actor-mismatch`/`missing-provenance` unchanged.
- No `_ledgr_assert_usage_limit` added to `createWithLines`, invoice-builder, or `payroll_runs`; no billing/quota code changed; no `ledgr_monthly_document_count` change.
- No `ai_context` signature change; no `ai_context_branch` function; no `v_reports_roles` change; no branch predicate change; `DEC-03` not resolved.
- No `BRANCH.*` remediation (P8), no `R11` metric-consistency, no `R14` jobs/monitoring, no `GAP-6` transfer/cost-authority, no `R02` OTP implementation, no `P9` invoice lifecycle, no `R15` final readiness, no storage/auth/recovery changes, no CI gate semantics change (still `BLOCKED→exit 2`).

Repository remains **functionally unchanged** — P3 is documentation/analysis only.

---

## 15. Final Status

- **DEC-09 — OPEN**
- **QUEUE TTL — OPEN**
- **OFFLINE.CONFLICT — OPEN**
- **BILLING.SERVER-QUOTA — OPEN**
- **AI.BRANCH — OPEN**

*No closure is manufactured. Each area is `OPEN — OWNER DECISION REQUIRED` (policy) plus `OPEN — MORE EVIDENCE REQUIRED` (environmental) as detailed in §11, and remains so until Alexander Gremu explicitly authorizes a decision and the required evidence is produced.*

> **STOP.** P3 is complete only when this decision-preparation document is produced and the repository remains functionally unchanged. No product behavior, migration, RLS, Edge, AI, billing, or branch enforcement was modified. Separate authorization is required for any implementation package (P4–P10, R11, R14, GAP-6, R02-impl, P8/P9, R15).

