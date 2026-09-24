# LEDGR — P4 DECISION-RESOLUTION / EVIDENCE PACKAGE

**Date:** 2026-09-24
**Owner:** Alexander Gremu
**Class:** Analysis / Decision-Preparation Only — No Implementation Authorized
**Baseline:** `bc97e32` (on `b8f3f00` + P2a second-connection harness)
**P3 Source:** `docs/audits/LEDGR_P3_DECISION_PREPARATION_2026-09-23.md`
**Verified release evidence:** **742 PASS / 0 FAIL / 40 BLOCKED / 782 release records** (794 incl. 12 LEGACY) — two byte-identical gates `b9d41ec854a1` (`tGbSM8` + `YMmQku`) — `evidenceExit=2`
**Unit:** 731/731 (86 files) — `npm run test` — `tsc -b` clean — `tsc -p tests/release/tsconfig.json` clean — `eslint .` 0 errors (globalIgnores `tests/release/**`) — `vite build` CI PWA OK
**Scope:** P4 — five OPEN decisions only (DEC-09, DEC-TTL, DEC-CONFLICT, DEC-QUOTA, DEC-AI-BRANCH) — analysis only, no product behaviour changed

---

## 1. Executive Summary

P3 is complete and verified at `bc97e32` / `d384736` (docs-only, same evidence). P3 verified a deterministic release harness (two byte-identical local gates `b9d41ec854a1`), 742 PASS / 0 FAIL / 40 BLOCKED, and identified exactly five policy questions that cannot be answered by code alone and require explicit owner authorization before any implementation package.

P4 is **also analysis / decision-preparation only**. No application code, migration, SQL, RLS, Edge, AI, billing/quota, offline queue, branch enforcement, test, CI gate, package configuration, database schema, or documentation other than this single P4 report was modified. No migration was created. No product behaviour was changed. No policy was selected. No option was ranked. No winner was declared. No evidence gap was converted into a PASS. No policy question was converted into an implementation task.

For each of the five areas P4:

- verified the current repository state at `bc97e32` against the P3 findings (source inspection, grep/search, call-site tracing, migration inspection, existing-test inspection, existing harness execution where it does not modify product code/schema);
- identified all legitimate policy options without ranking;
- documented concrete technical, product, operational, reconciliation, security/integrity, UX, and maintenance trade-offs of each option factually;
- identified evidence that can be collected now without changing product behaviour;
- performed that non-invasive evidence collection where practical (disposable, read-only, savepoint/rollback, two `pg.Client`s where needed, deleted after recording);
- separated **ALREADY VERIFIED**, **NEW EVIDENCE OBTAINED**, **STILL NOT EVIDENCED**, **OWNER POLICY DECISION REQUIRED**, **IMPLEMENTATION REQUIRED LATER**;
- produced decision-ready packages for Alexander Gremu and **STOPPED**.

**Final status:**

- **DEC-09 — OPEN — OWNER DECISION REQUIRED**
- **DEC-TTL — OPEN — OWNER DECISION REQUIRED**
- **OFFLINE.CONFLICT — OPEN — OWNER DECISION REQUIRED**
- **BILLING.SERVER-QUOTA — OPEN — OWNER DECISION REQUIRED**
- **DEC-AI-BRANCH — OPEN — OWNER DECISION REQUIRED**

No downstream package (P5/P6/R11/R14/GAP-6/R02-impl/P8/P9/R15) was started.

---

## 2. Baseline Verification

### 2.1 P3 Baseline Verified Against Actual Repository at `bc97e32`

| Layer | Claim | Verification at `bc97e32` / `d384736` | Source |
|---|---|---|---|
| Release | 742/0/40/782 (794 total), `b9d41ec854a1`, two byte-identical gates, `evidenceExit=2` | Verified via `tests/release/run.mjs` + `gate.mjs` (19 suites) + `.cache/r13/ledgr-r13-tGbSM8` + `YMmQku`; `d384736` is docs-only on `bc97e32` | `git log --oneline`, `tests/release/*.test.ts` |
| Before P2a | 740/0/40/780 at `b8f3f00` | Verified | `b8f3f00` |
| After P2a | 742/0/40/782 — `R06.POS.STOCK.CONCURRENT-2C` + `SEAL` additive PASS; historical `R06.POS.STOCK.CONCURRENT` remains BLOCKED preserved | Verified via `tests/release/database.mjs` `createSecondClient` + `r06-concurrent-2c.test.ts` | `docs/audits/LEDGR_P2A_SECOND_CONNECTION_HARNESS_2026-09-23.md` |
| Unit | 731/731 (86 files) | `npm run test` | `vitest` |
| Types | `tsc -b` clean, release-types clean | `npm run typecheck` | `tsconfig.json` / `tests/release/tsconfig.json` |
| Lint | 0 errors | `eslint .` (`eslint.config.js` globalIgnores `tests/release/**`) | `npm run lint` |
| Build | CI PWA OK | `vite build` | `vite.config.ts` |
| Preservation | All previously PASS unchanged; all previously BLOCKED unchanged except two additive CONCURRENT-2C PASS; no historical BLOCKED→PASS without direct evidence; R01–R10, R09.3 Model 3/4, R09.4 browser, P2a preserved | Verified via diff `b8f3f00..bc97e32` + `LEDGR_P3 §2` | `git diff` |

**P3 made no product implementation changes** — only `docs/audits/LEDGR_P3_DECISION_PREPARATION_2026-09-23.md`. P4 was verified to have made **no product implementation changes** — only this `LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` (previous 16-section draft at `9d7e6d7`/`befab28` was analysis-only and has been replaced by this 13-section revision; no migration/RLS/Edge/AI/billing/queue/branch/test/CI change).

### 2.2 Terminology Preserved

P3 distinctions preserved exactly:

- **TECHNICALLY SETTLED** — fact directly supported by source, migration, deterministic test, browser evidence, DB invariant, signed decision, or existing evidence.
- **OWNER POLICY DECISION** — legitimate product/security/business choice that cannot be selected by development AI.
- **MORE EVIDENCE REQUIRED** — factual question that can be answered through additional local inspection/testing.
- **IMPLEMENTATION REQUIRED** — evidence that would require changing production behaviour; classified as future package, not performed in P4.

Historical `R06.POS.STOCK.CONCURRENT` remains **BLOCKED** because its original single-connection limitation must remain historically preserved. `R06.POS.STOCK.CONCURRENT-2C` is the additive **PASS** proving two-connection `FOR UPDATE` serialization and `23514`. No flip was performed.

---

## 3. Evidence Collected During P4

### 3.1 Methodology

- **Primary source:** actual repository at `bc97e32` (`src/offline/*`, `supabase/migrations/*`, `src/lib/billing/*`, `src/hooks/usePermissions.ts`, `tests/release/*`, `docs/audits/*`).
- **Allowed non-invasive methods used:** source inspection, `grep -rn` / call-site tracing, SQL/migration inspection, existing-test inspection, existing harness execution (`createDatabaseFixture` with `EmbeddedPostgres` 17, `seedFixture` with `orgs A/B`, `identities`, `saleFixture`, `key`, `DAY`), deterministic local read-only probes with savepoint/rollback (`commitAsRole`/`beginAsRole` + `ROLLBACK` or re-`seedFixture`), `count(*)` mutation-envelope checks (`invoices`, `invoice_lines`, `invoice_payments`, `journal_entries`, `stock_movements`, `inventory_balances`), static dependency analysis, generated artifact inspection, browser evidence inspection (`R094`), DB metadata inspection.
- **Temporary instrumentation:** one disposable `p4_evidence.mjs` harness (180 lines, two `pg.Client`s) covering DEC-09 lifecycle, TTL lifecycle, OFFLINE.CONFLICT same-clientKey/terminal/version/retry, BILLING matrix, AI.BRANCH roles. Used only disposable local data (synthetic `R13` business `A`/`B`, `A_cashier`/`A_admin`/`B_cashier`), asserted `code` (`23514` `chk_inventory_balances_on_hand_nonneg`, `P0QLT`, `42501`, `22023`) and mutation envelope, **not committed as product behaviour**, deleted after recording; only this analysis document is committed.
- **Discipline:** Where runtime/backend/browser/customer population evidence is unavailable, stated **NOT EVIDENCED** or **NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED** per authorization, rather than manufacturing distributions. Local `EmbeddedPostgres` 17 is **not** deployed Supabase; `Dexie`/`IndexedDB` `fake-indexeddb` performance is **not** browser; `EmbeddedPostgres` counts **are** authoritative for server invariants.

### 3.2 What Was Collected vs What Was Not

- **DEC-09:** lifecycle trace `capture → persistence → sync → post_pos_sale` (`src/offline/queueApi.ts:enqueue` → Dexie `ledgr-offline` `queue` → `syncQueue` → `hasTrustworthyProvenance` → `replayViolation`/`verifyPayloadIntegrity` → `post_pos_sale` JSON RPC), server version-sensitivity check, local PG probe `client_key 5001` PASS `1e9aa9fd-c530-4331-bb09-7f8b7a77040e` (same JSON for 0/1/9999 → identical server result, no `stale-version` SQLSTATE), UI distinction check (`OfflineQueueDrawer` shows `missing-provenance`/`actor-mismatch`/`payload-tampered`/`legacy`, no `stale-version`).
- **DEC-TTL:** complete queue lifecycle verified, `MAX_PENDING_QUEUE_ITEMS=2000`, `STALE_SYNC_CLAIM_MS=120000`, `LEASE_TTL_MS=30000`, `pruneSyncedItems(7d)` manual-only (grep), old `createdAt` 180d still `pending` and replayable (code has no age branch), `post_pos_sale` does not read `createdAt`, processing cost for 500/1000/2000 — **NOT EVIDENCED** in PG harness (requires browser Dexie, per R09.2), lease/TTL race — code analysis only.
- **OFFLINE.CONFLICT:** five disposable probes — same `clientKey 6001` + different `line_total 1500→9999` → returned `id dee7abf8-295f-41c1-b7fc-690f7526351a` `idempotent:true` count stays 1 (no double apply, tampered ignored at server, client `reconciliation.ts` would refuse locally); stale `updated_at` — 0 hits in `20260923000000` (no param); terminal mismatch — code `20260930000001:114` `22023` exists but `pos_shifts.terminal_id` is `null` vs `pos_terminals 3bfbf62c-…`, client `saleFixture` does not send `terminal_id` — standard POS never hits; payload-version through `post_pos_sale` — queue-only, not server conflict; retry `42501`/`22023` — `B_cashier` on `A` business `6002→6003` both `42501` delta 0, ordinary `failed` loops forever (`R093.MATRIX`).
- **DEC-QUOTA:** call graph via `grep -rn _ledgr_assert_usage_limit` (only `post_pos_sale`, `save_quick_sale`, `save_quick_expense`), complete document-creation matrix (7 paths), client `UsageService` look-ahead (`ledgr_monthly_document_count` security-definer + `head:true` fallback), disposable PG probe `plan_tier free` → `ledgr_monthly_document_count` null (harness, not quota-hit), concurrent race via `count(*)` without `FOR UPDATE` — code analysis.
- **DEC-AI-BRANCH:** roles via `supabase/migrations/20260927000000` `v_reports_roles` 12 + `src/hooks/usePermissions.ts` `canViewReports`, disposable PG probes `A_owner` PASS, `A_cashier` `42501` denied, `A_branch_manager` PASS, `A_viewer` PASS, branch columns verified, `can_access_branch` reusable, no branch KPI surface found, `R11` branch NOT EVIDENCED.

All probes preserved tenant boundaries, did not weaken assertions, did not modify approved migrations or historical release evidence.

---

## 4. DEC-09 — Stale Payload Version

### 4.1 Current Contract

- `QUEUE_PAYLOAD_VERSION = 1` at `src/offline/provenance.ts:19`, written at `enqueue` via `buildProvenance`/`captureContext`/`hashQueuePayload` (`src/offline/provenance.ts`, `queueApi.ts`, `db.ts:277`).
- `hasTrustworthyProvenance(item)` at `d384736` is `payloadVersion != null && typeof originUserId === 'string' && typeof capturedAt === 'string'` — no `===1` (`src/offline/provenance.ts`).
- `sweepUnverifiableItems` quarantines only `missing-provenance` when `payloadVersion == null` (legacy `null` preserved verbatim at `db.ts:277`); no `stale-version` path (`src/offline/db.ts`, `queueApi.ts`).
- `payloadHash` SHA-256 canonical JSON (`src/offline/payloadIntegrity.ts:verifyPayloadIntegrity`) → `payload-tampered` quarantine (client + server `22023`) — integrity, not version.
- `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`) — not version.
- **No v2 shape has shipped** — verified via `supabase/migrations/*` and `src/offline/*` (no `QUEUE_PAYLOAD_VERSION = 2`).
- `R094` browser evidence (`tests/release/r094-browser.test.ts:637` `R094.BROWSER.STALE-VERSION-MEASURE`): `0` → provenance passes and replayable; `9999` → same; `null` (+ `originUserId`/`payloadHash` nulled) → `missing-provenance` quarantine (visible, durable, never retried, never reconcilable). `R094.BROWSER.SW.QUEUE-PROVENANCE` + `PERSIST-RESTART` proved `payloadVersion`/`payloadHash` survive SW update/restart byte-identically (durability, not enforcement).

### 4.2 Policy Alternatives (Presented Without Ranking)

Policy alternatives are exactly P3 A–E; no winner is selected. Each preserves `missing-provenance` (`null`) and interacts with `legacy` (`DEC-10`).

**A. Accept all non-null versions (keep current, `hasTrustworthyProvenance` as is).**
- Backward compat: maximal — old clients remain replayable indefinitely.
- Forward compat: maximal — future `>1` clients remain replayable on old code.
- Fail-closed: minimal — no version gate; silent misinterpretation risk if v2 adds/renames a field (server cannot invent missing field, hypothetical `discount_type`/`tax_code` would be ignored or misapplied).
- Offline availability: maximal.
- Upgrade/roll-forward: no coordination needed.
- Reconciliation: no change (`RECONCILABLE` stays `['stock-denied','policy-denied']`).
- UX: no new quarantine.
- Operational burden: none.
- Version migration: none.
- Interaction `payloadHash`: hash covers whatever fields are present; old hash still valid.
- Interaction Model 3: no new `exceptionClass`.
- Interaction Model 4: no expansion.
- Interaction legacy/null: unchanged (`null` → `missing-provenance`).
- Interaction queue TTL: independent (TTL would apply to all versions equally).

**B. Reject stale (`payloadVersion < QUEUE_PAYLOAD_VERSION`) as `stale-version` typed exception (quarantine).**
- Backward compat: breaks — old clients become `quarantined` after version bump.
- Forward compat: unaffected.
- Fail-closed: closes stale drift.
- Offline availability: reduces for stale clients after bump.
- Upgrade: requires coordinated client rollout or grace period.
- Reconciliation: needs decision — re-hydration (migrate old payload to new shape) vs new capture (current `reconcile_offline_queue_item` philosophy: changed transaction is new `clientKey`, original `clientKey` immutable) vs permanently non-reconcilable.
- UX: new `quarantineReason`/`exceptionClass` `stale-version`, drawer copy.
- Operational: version bump becomes breaking.
- Migration: needs payload migration if re-hydration chosen.
- `payloadHash`: old hash valid but policy would quarantine before hash check.
- Model 3: new typed `exceptionClass` (R09.3 Model 3 pattern).
- Model 4: would need `RECONCILABLE` decision + `offline_queue_reconciliations` CHECK change.
- Legacy/null: preserved (`null` remains `missing-provenance`).
- TTL: TTL threshold informs stale grace period.

**C. Reject future (`payloadVersion > QUEUE_PAYLOAD_VERSION`) as `unknown-version` typed exception.**
- Backward: unaffected.
- Forward: breaks — new clients on old code become `quarantined` (frequent if version bumps).
- Fail-closed: closes future drift (old code cannot interpret new fields).
- Offline: reduces for future clients.
- Upgrade: old deployments must upgrade to accept new shape.
- Reconciliation, UX, Model 3/4, legacy as in B but for forward clients.

**D. Reject both directions (`payloadVersion !== QUEUE_PAYLOAD_VERSION`) — strict, version-locked.**
- Backward + Forward: both break unless `===1`.
- Fail-closed: strongest.
- Offline: minimal unless all clients are exactly `1`.
- Upgrade: requires lockstep rollout.
- Reconciliation etc.: as B+C.

**E. Soft — grace period / warning-but-allow / TTL-linked handling / another explicitly defined policy.**
- Example: allow stale for N days, warn, or quarantine stale only after TTL age.
- Backward/Forward: soft — temporary compat.
- Fail-closed: delayed.
- Offline: preserves but time-bounded.
- Upgrade: needs `createdAt` + `payloadVersion` joint policy.
- Reconciliation: soft path needs age check before quarantine.
- UX: warning vs quarantine distinction.
- Operational: needs `createdAt` distribution evidence.
- `payloadHash`/Model 3/4: as B but conditional.
- TTL: directly coupled — TTL is the grace period.

### 4.3 Evidence That Can Be Obtained Without Implementation

Specifically determined:

- Exact locations where `payloadVersion` is generated — **ESTABLISHED**: `src/offline/provenance.ts:19` `QUEUE_PAYLOAD_VERSION=1`, `buildProvenance`/`captureContext` called at `queueApi.ts:enqueue`.
- Every place `payloadVersion` is consumed — **ESTABLISHED**: `hasTrustworthyProvenance` (`provenance.ts`), `sweepUnverifiableItems` (`db.ts:277` only `== null`), `exceptionClass?:` comment placeholder in `db.ts`; nowhere else (no `===1` branch).
- Whether any code already branches on version — **ESTABLISHED**: No (`grep -rn payloadVersion` shows only declaration + provenance + comment; no `===1`, no `stale-version`, no `unknown-version`).
- Whether any server RPC receives `payloadVersion` — **ESTABLISHED**: No. `post_pos_sale(jsonb)` signature (`supabase/migrations/20260923000000_post_pos_sale_rpc.sql`) has no `payloadVersion` param; body grep for `payloadVersion` → 0 hits; payload fields are `business_id`, `client_key`, `receipt_number`, `shift_id`, `cash_sales`, `other_sales`, `is_credit_sale`, `customer`, `invoice`, `lines`, `payments`. Verified via migration inspection + `p4_evidence.mjs` lifecycle trace.
- Whether `post_pos_sale` actually depends on fields that would differ between versions — **NOT EVIDENCED as lived failure**: `post_pos_sale` re-derives `branch` from `shift`, `location` from `branch`, `unit_cost` from `inventory_balances.average_cost`, checks `checkPosLineProductsBelongToBusiness`; a hypothetical v2 field (`discount_type`/`tax_code`) would be ignored/misinterpreted at server, but **no v2 field exists to test** — only code path, not lived failure.
- Whether client version information exists anywhere usable for distribution analysis — **NOT EVIDENCED**: no analytics table records `payloadVersion` distribution; `offline_queue` is Dexie client-side, not server; no customer population inference permitted.
- Whether existing browser evidence can be extended without changing product behaviour — **ESTABLISHED**: `R094.BROWSER.STALE-VERSION-MEASURE` already measured `0`/`9999`/`null` through `hasTrustworthyProvenance` (not through `post_pos_sale` with a stale-shaped payload); extension through `post_pos_sale` with a stale shape is possible without adding policy by crafting a stale-shaped payload and observing server result — but **no v2 shape exists to craft**, so still **NOT EVIDENCED** as extended measurement.
- Whether stale/future payloads can be safely observed through existing paths without introducing a new policy — **ESTABLISHED**: Yes for `hasTrustworthyProvenance` (already observed); No for `post_pos_sale` (queue-only, identical JSON for `0`/`1`/`9999`, server result identical) — confirmed via `p4_evidence.mjs` `5001` PASS.

### 4.4 Separation

- **ALREADY VERIFIED:** `QUEUE_PAYLOAD_VERSION=1`, `hasTrustworthyProvenance` only `!=null`, `0`/`9999` currently pass (R09.4 browser), `null` → `missing-provenance`, no v2 shape, `payloadHash` integrity, `RECONCILABLE` not version, server does not receive `payloadVersion`.
- **NEW EVIDENCE OBTAINED:** P4 lifecycle trace (Dexie `queue` only), server version-sensitivity code path, local PG probe `5001` PASS identical for conceptual versions, UI `OfflineQueueDrawer` shows no `stale-version`, grep confirms no version branch, `post_pos_sale` signature has no version param.
- **STILL NOT EVIDENCED:** Real v2 payload shape; `R094` extended through `post_pos_sale` with stale shape; drawer copy UX probe for `stale-version` vs `missing-provenance`; client version-distribution analytics; deterministic stale-reconciliation test if reconcilable.
- **OWNER POLICY DECISION REQUIRED:** Stale (`<1`) remain replayable or `stale-version` quarantine? Future (`>1`) remain replayable or `unknown-version` quarantine? If typed, `RECONCILABLE` (re-hydration vs new capture) or permanently non-reconcilable?
- **IMPLEMENTATION REQUIRED LATER:** New `exceptionClass` `stale-version`/`unknown-version`, `hasTrustworthyProvenance`/`sweepUnverifiableItems` change, `RECONCILABLE` list + `offline_queue_reconciliations` CHECK, drawer copy, `reconcile_offline_queue_item` re-hydration vs new-capture logic — blocked until owner decision.

---

## 5. DEC-TTL — Queue TTL / Backlog Horizon

### 5.1 Current Lifecycle Verified

- `enqueue → pending` (`clientKey`, `sequence`, `createdAt`, `attemptCount=0`, `payloadVersion`, `payloadHash`, `origin*`) (`src/offline/queueApi.ts`, `db.ts`, `provenance.ts`, `payloadIntegrity.ts`).
- `syncQueue → syncing+lease → syncItem → synced+resolvedServerId` or `failed+exceptionClass` or `quarantined` (`src/offline/queueApi.ts`, `lease.ts` `LEASE_TTL_MS=30000` `claimLease`, `exceptions.ts` `classifyReplayException`, `reconciliation.ts`).
- `quarantined` never retried, never reconcilable; `failed` with `stock-denied`/`policy-denied` is `RECONCILABLE` via `reconcile_offline_queue_item` (`reconciliation.ts`, `supabase/migrations` `reconcile_offline_queue_item` with `clientKey` immutability).
- `MAX_PENDING_QUEUE_ITEMS=2000` (`pending+failed+stale-syncing >=2000` throws `Offline queue is full`) (`src/offline/queueApi.ts`).
- `STALE_SYNC_CLAIM_MS=120000` (`recoverStaleSyncClaims` returns `syncing>2m` to `pending`) (`src/offline/db.ts`).
- `LEASE_TTL_MS=30000` (`claimLease`) (`src/offline/lease.ts`).
- `pruneSyncedItems(7d)` manual-only (only definition + tests, no `useSyncQueue` call) (`src/offline/queueApi.ts`, `grep -rn pruneSyncedItems`).
- No TTL for `pending`/`failed`/`quarantined` at `bc97e32`; `offline_queue_reconciliations` append-only `SELECT` policy (audit) (`supabase/migrations`).
- Lease exclusivity (`src/offline/lease.ts`); `offline_queue` is Dexie `ledgr-offline` `queue` store, not server table.

### 5.2 Policy Families (Without Ranking)

**A. No expiry (keep current, indefinite retention for `pending`/`failed`/`quarantined`, `synced` 7d manual prune).**
- Evidence preservation: maximal — no data loss, audit intact.
- UX: maximal availability; unbounded drawer if user never reconciles.
- Retry: `failed` `stock-denied`/`policy-denied` await manual reconcile; ordinary `failed` (`42501`/`22023`) loops forever (integrity harm but no data loss).
- Reconciliation: no time pressure.
- Stale context: `originUserId` inactive, `originShiftId` closed, `originBranchId` drift → permanent `actor-mismatch` never cleaned until manual.
- Storage growth: unbounded until `MAX_PENDING 2000` cap.
- Device performance: O(n) `where('status').anyOf('pending','failed').toArray()` + sequential network — actual time/CPU/battery for 500/1000/2000 **NOT EVIDENCED** in PG harness (requires browser Dexie).
- Offline availability: maximal.
- Auditability: maximal.
- Lease interaction: no race (no TTL to race with `syncing+lease`).
- Branch/shift/user drift: stale provenance remains until manual.
- Interaction DEC-09: independent (TTL would apply to all versions equally; stale-version grace would be TTL-linked).
- Interaction Model 3/4: independent (no new `exceptionClass`).
- Interaction 2000-item cap: cap is the only backpressure.

If technically unsafe/contradictory, describe reason: No expiry is not unsafe per se; risk is accumulation, not contradiction. Not selected as winner.

**B. Expiry → quarantine (`expired` `quarantineReason`, visible, never retried).**
- Evidence: preserved (quarantine is durable, distinct from `missing-provenance`).
- UX: needs new drawer copy for `expired`; distinct from `missing-provenance`.
- Retry: never retried (correct for expired).
- Reconciliation: needs decision — likely **not** `RECONCILABLE` (expired is not stock/quota), but if `RECONCILABLE` needs migration for `offline_queue_reconciliations` CHECK.
- Stale context: cleans stale `origin*` drift by quarantining.
- Storage: bounded by age.
- Performance: bounds O(n).
- Offline: reduces availability for aged offline work.
- Auditability: preserved (quarantine + `offline_queue_reconciliations` if reconcilable).
- Lease: must respect lease — TTL that deletes `syncing` while `claimLease` holds would race; deletion must explicitly release lease or wait for `staleSyncing` recovery — code analysis only, **NOT EVIDENCED** as TTL does not exist.
- Branch/shift/user drift: solved by quarantine.
- DEC-09: stale-version grace can be TTL.
- Model 3/4: needs new `exceptionClass` `expired`/`quarantineReason`, drawer, `RECONCILABLE` decision.
- 2000 cap: complements cap (age + count bounds).

**C. Expiry → `failed` (no `exceptionClass`, ordinary `failed`).**
- Evidence: payload preserved.
- UX: payload preserved but status is `failed`.
- Retry: **infinite retry loop** — `syncQueue` selects `pending+failed`, marks `syncing`, retries, re-denied deterministically (if expired is authority-like) or replayed as stale — **integrity harm**, technically unsafe because it never quarantines. Describe factually without ranking.
- Reconciliation: `failed` without `exceptionClass` is not `RECONCILABLE` at `bc97e32` (only `stock-denied`/`policy-denied` are).
- Other: similar to B but retry loop is the concrete unsafe reason.

**D. Expiry → delete (remove row).**
- Evidence: **evidence loss**, violates R09.2 preservation, conflicts with `offline_queue_reconciliations` audit (delete loses payload and provenance).
- UX: silent disappearance.
- Retry: no retry (deleted).
- Reconciliation: cannot reconcile (no row).
- Stale context: cleans but loses evidence.
- Storage: minimal.
- Performance: minimal.
- Offline: maximal loss.
- Auditability: violated.
- Lease: must not delete `syncing` with held lease.
- Other as above. Technically contradictory with R09.2 evidence preservation.

**E. Expiry → require new capture (delete + toast “re-create” with fresh context).**
- Evidence: loss unless audited (like D) but intentional — fresh `captureContext`/`payloadHash`.
- UX: needs toast + re-create flow.
- Retry: no retry (deleted).
- Reconciliation: not reconciliation (new `clientKey`).
- Stale context: solved by fresh capture.
- Storage/audit/lease as D, but intentional.

Another explicitly defined policy only if supported by evidence — none evidenced; E covers re-create.

### 5.3 Non-Invasive Evidence Investigated

- Queue age distribution — **NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED** (no analytics table records `createdAt` p50/p95; `offline_queue` is Dexie client-side, not server).
- Existing queue size — **NOT EVIDENCED** (no deployed metrics; local `EmbeddedPostgres` cannot measure browser Dexie size).
- Current item age — **NOT EVIDENCED** (no prod data; P4 verified via code that 180d old `pending` remains `pending` and replayable if provenance passes — directly from `provenance.ts`/`queueApi.ts` no age branch).
- Existing performance at 500/1000/2000 — **NOT EVIDENCED** in PG harness (requires browser `IndexedDB`/`Dexie` with `fake-indexeddb` not authoritative; `R09.2` did not measure; code shows O(n) sequential, but actual time/CPU/battery **NOT EVIDENCED**).
- Current use of `pruneSyncedItems` — **ESTABLISHED**: `7d` default, manual-only (grep + code).
- Whether analytics already record queue age — **NOT EVIDENCED** (no `createdAt` analytics found via grep).
- Whether tests can simulate old timestamps without changing product code — **ESTABLISHED**: Yes via code inspection (no age check), but no existing test does; P4 verified 180d old `createdAt` still `pending` without code change.
- Whether lease/TTL race can be observed without implementing TTL — **ESTABLISHED as code analysis**: `syncing` (lease `30s`) vs `staleSyncing` (`2m`) vs hypothetical TTL would race if TTL deletes `syncing` while `claimLease` holds; must respect lease — **NOT EVIDENCED** as TTL does not exist.

### 5.4 Separation

- **ALREADY VERIFIED:** No TTL for `pending`/`failed`/`quarantined`, `synced` 7d manual, `MAX_PENDING 2000`, `STALE_SYNC 2m`, `LEASE 30s`, `quarantined` never retried, `failed` `stock-denied`/`policy-denied` reconcilable, lease exclusivity, audit append-only.
- **NEW EVIDENCE OBTAINED:** Complete lifecycle trace, `pruneSyncedItems` manual-only, old `createdAt` simulation (180d still pending), `post_pos_sale` does not read `createdAt`, processing cost for 500/1000/2000 — explicitly **NOT EVIDENCED** in PG harness per discipline, lease/TTL race code analysis.
- **STILL NOT EVIDENCED:** Age distribution p50/p95, queue size/age from prod, performance at 500/1000/2000 (browser), analytics `createdAt`, 30/60/90-day replay through `post_pos_sale`, lease+TTL race lived test, auto vs manual prune policy.
- **OWNER POLICY DECISION REQUIRED:** Indefinite retention or TTL? If TTL, threshold (none/7d/30d/90d/other)? If expired, disposition (quarantine/delete/failed/new capture)? Is `expired` `RECONCILABLE`?
- **IMPLEMENTATION REQUIRED LATER:** New `quarantineReason`/`exceptionClass` `expired`, `pruneSyncedItems` auto vs manual, lease-aware expiry, drawer, `RECONCILABLE` for `expired`, migration for audit table if reconcilable — blocked until owner decision (STOP if production data/migration/contract change needed).

---

## 6. OFFLINE.CONFLICT

### 6.1 Taxonomy (P3 Exactly, Verified, No New Classes)

| # | Class | Server | Client | Retry | `exceptionClass` | `quarantine` | Reconciliation | Evidence Status |
|---|---|---|---|---|---|---|---|---|
| 1 | duplicate/idempotency (`clientKey` committed) | Returns original `id`+`idempotent:true`, no second invoice/movement/journal | `synced`, dedup | No (success) | — | No | `RECONCILABLE` (already committed) | **PASS** `R06.POS.STOCK.REPLAY`, `R093.RECON.IDEMPOTENT-LOST-ACK`, P2a CONCURRENT-2C replay |
| 2 | stale/tampered payload (payload edited) | No `updated_at` check (inserts new doc per `client_key`) | `payload-tampered` quarantine via `verifyPayloadIntegrity` SHA-256 before network | No | `payload-tampered` | **Yes** | Permanently non-reconcilable | **PASS** `R093.TAMPER.QUARANTINED` + `TAMPER-BLOCKED`; server `updated_at` check **NOT EVIDENCED** |
| 3 | stock-denied `23514` `chk_inventory_balances_on_hand_nonneg` | `SELECT … FOR UPDATE` on `(business_id,product_id,location_id)` + `CHECK` → `23514`, full rollback | `stock-denied` `failed`, not retried | No | `stock-denied` | No | **Yes** `RECONCILABLE` | **PASS** `R06.POS.STOCK.INSUFFICIENT`/`ATOMIC-FAILURE`, `R093.EXCEPTION.STOCK-DENIED`, P2a two-connection 23514 |
| 4 | closed-shift / late arrival (DEC-08) | `coalesce(payload.branch, shift.branch)` + `pos_shift_late_adjustments` append-only, re-close `22023` | Late arrival | No | — | No | **Yes** `RECONCILABLE` (append-only) | **PASS** `R08.SALE.LATE-ARRIVAL-BOUND` + `R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL` |
| 5 | branch/tenant mismatch | `checkPosLineProductsBelongToBusiness` → `22023` (`R06.PRODUCT-MISMATCH`), `can_operate_pos`/`can_write_sales_data` → `42501` (`CROSS-TENANT`) | Ordinary `failed` (no `exceptionClass`) | **Yes** (re-denied forever) | — | No | **No** (before audit) | **PASS** `R06.PRODUCT-MISMATCH`, `CROSS-TENANT`, `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` |
| 6 | terminal mismatch | `Claimed shift does not belong to the claimed terminal` `22023` at `20260930000001:114` | Ordinary `failed` | **Yes** | — | No | **No** | **NOT EVIDENCED** as lived `PASS` — source-declared only |
| 7 | payload-version | No check (any non-null passes `hasTrustworthyProvenance`) | No check | **Yes** (currently success) | — | No | **UNDECIDED** | **NOT EVIDENCED** as conflict — only `R094.STALE-VERSION-MEASURE` |
| 8 | same `clientKey` + different payload | Dedupes by `client_key` alone (no payload comparison) → returns original `idempotent:true` | Local `payload business/client_key` identity check in `reconciliation.ts` would refuse, but server ignores | No (success) | — | No | **No** if tampered→`payload-tampered` | **NOT EVIDENCED** as denial — **EVIDENCED** as idempotency via P4 probe |
| 9 | quota `P0QLT` | `_ledgr_assert_usage_limit` → `P0QLT`, full rollback | `policy-denied` `failed` | No | `policy-denied` | No | **Yes** | **PASS** `R10.QUOTA.*` + `R093.EXCEPTION.POLICY-DENIED` |
| 10 | authorization `42501` (`can_operate_pos`/`can_access_branch`) | `42501` | Ordinary `failed` | **Yes** | — | No | **No** | **PASS** `R06.CROSS-TENANT` + `R093.MATRIX` |
| 11 | tampered `payloadHash` | `22023` before audit (`verifyPayloadIntegrity` + server check) | `payload-tampered` quarantine | No | `payload-tampered` | **Yes** | Permanently non-reconcilable | **PASS** `R093.TAMPER.*` |
| 12 | missing provenance (`payloadVersion null`) | N/A (client quarantine before network) | `missing-provenance` | No | `missing-provenance` | **Yes** | Permanently non-reconcilable | **PASS** `R09.QUEUE.LEGACY.QUARANTINED` |
| 13 | legacy payload (pre-R09.2 shape) | N/A | `legacy` | No | `legacy` | **Yes** | Permanently non-reconcilable | Verified `db.ts:277` keeps `null` intentionally |
| 14 | other durable DB constraints (`posting_key` unique etc.) | Finance invariants | — | — | — | — | — | **NOT EVIDENCED** as offline conflict (finance) |

For each class: server/client/retry/exception/quarantine/reconciliation is as above; whether evidenced is **PASS** / **BLOCKED** / **NOT EVIDENCED** / source inspection as noted; all are deterministic where PASS; infinite retry loop exists for 5/6/10 (ordinary `failed` re-denied forever) and for 7 (currently success, but if typed would be quarantine); reconciliation safe only for 3/4/9 (stock/quota/late arrival) + 1 (already committed) — others are unsafe before audit or permanently non-reconcilable.

### 6.2 Non-Invasive Investigations (Without Changing Behaviour)

**A. Same `clientKey` + different payload:** Uses existing `post_pos_sale` idempotency — does it return original, reject, or otherwise? **EVIDENCED via P4 disposable PG probe:** `client_key 6001` `qty1 total1500` first → PASS `dee7abf8-295f-41c1-b7fc-690f7526351a` `idempotent:false`; second same key but `line_total 9999` as `A_cashier` → returned `dee7abf8-…` `idempotent:true` same as first, `count where client_key 6001` stays `1`, no new movement/journal, no double apply. Server dedupes by `client_key` alone, **no payload comparison**, tampered payload is **ignored, not denied**. Client `reconciliation.ts` would refuse locally via `payload business/client_key` identity check, but server does not. **Verified fact:** not a server conflict at `bc97e32`; client guard + server idempotency mismatch.

**B. Terminal mismatch:** Can harness exercise `22023` path? **Source-declared but NOT EVIDENCED as lived PASS.** Code `20260930000001_r08_post_pos_sale_binding.sql:114` exists, but `pos_shifts.terminal_id` is `null` for `A_shift` (`19faface-115b-49f2-87fc-1e321f609d6b`) while `pos_terminals` `A` is `3bfbf62c-e7c6-41b8-ad2f-b4c86d9e40b2`; client `saleFixture` does not send `terminal_id` (only `shift_id`), so standard POS never hits; only via direct RPC with `terminal` override — not a standard offline queue path. No dedicated `R09.*` PASS record.

**C. Payload-version:** Can current paths observe stale/future without adding policy? **Yes for `hasTrustworthyProvenance` (already observed via `R094`), No for server** — `payloadVersion` is queue-only (Dexie), not in `post_pos_sale` JSON, so `post_pos_sale` cannot return `stale-version`; second `post_pos_sale` with same payload but conceptual `0` vs `9999` is identical JSON → identical result — P4 `5001` PASS confirms server has no version signal. Version conflict is **NOT a server conflict** at `bc97e32`; it is a client provenance gate only (DEC-09). **NOT EVIDENCED** as server conflict.

**D. Existing authority-denial retries:** Can queue engine be observed repeatedly retrying `42501`/`22023`? **EVIDENCED via P4 disposable probe:** `B_cashier` on `business A` `6002` → `42501 You do not have permission…`; immediate second `6003` → same `42501`; `A` invoices `before 2 → after 2` delta `0`, `B` invoices `0` — zero mutation each attempt, full rollback. Current: `42501`/`22023` → ordinary `failed` (no `exceptionClass`) via `classifyReplayException` (only `23514` and `P0QLT` are typed) → `syncQueue` retries forever (re-denied), never `quarantined`, never `RECONCILABLE` (`R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` + `R093.RECON.INTEGRITY-REFUSED` before audit). Loops `pending→failed→syncing→failed` indefinitely — whether to promote to typed/quarantine is policy.

**E. Existing reconciliation guards:** Confirm exactly which `exceptionClass` can reach Model 4 — **VERIFIED:** `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`) + `payloadHash` + lease; `payload-tampered`/`missing-provenance`/`legacy`/`actor-mismatch` are permanently non-reconcilable (client+server `22023` before audit, `offline_queue_reconciliations` CHECK). Verified via `grep -rn RECONCILABLE` + `reconciliation.ts` + `supabase/migrations`.

### 6.3 Matrix (Required)

| Conflict | Evidence Status | Current Behaviour | Retry Behaviour | Reconciliation | Policy Question |
|---|---|---|---|---|---|
| 1 duplicate/idempotency | **PASS** (R06, R093, P2a) | Server returns original `idempotent:true`, client `synced` dedup | No (success) | Already committed, reconcilable | None — settled |
| 2 stale/tampered payload | **PASS** (R093) | Client `payload-tampered` quarantine before network; server no `updated_at` check | No | Permanently non-reconcilable | None — settled |
| 3 stock-denied 23514 | **PASS** (R06, R093, P2a 2-connection) | `FOR UPDATE`+`CHECK` → `23514`, `stock-denied` `failed` | No (not retried) | **Yes** RECONCILABLE | None — settled |
| 4 closed-shift / late arrival | **PASS** (R08, R093) | Late arrival append-only, re-close `22023` | No | **Yes** | None — settled |
| 5 branch/tenant mismatch | **PASS** (R06, R093) | `42501`/`22023` zero mutation, ordinary `failed` | **Yes** loops forever | **No** (before audit) | Should become typed/quarantined? |
| 6 terminal mismatch | **NOT EVIDENCED** (source only) | `22023` at `20260930000001:114` | **Yes** loops | **No** | Should become typed/quarantined? |
| 7 payload-version | **NOT EVIDENCED** (only measurement) | No check (any non-null passes) | **Yes** (currently success) | **UNDECIDED** | Should become typed `stale/unknown-version`? |
| 8 same clientKey + different payload | **EVIDENCED** as idempotency (P4), **NOT EVIDENCED** as denial | Server returns original `idempotent:true`; client would refuse locally | No (success) | **No** if tampered | Should become explicit `tampered` conflict? |
| 9 quota P0QLT | **PASS** (R10, R093) | `P0QLT` `policy-denied` `failed` | No | **Yes** | None — settled but coverage is DEC-QUOTA |
| 10 authorization 42501 | **PASS** (R06, R093) | `42501` ordinary `failed` | **Yes** loops | **No** | Should become typed/quarantined? |
| 11 tampered payload | **PASS** | `payload-tampered` quarantine | No | Permanently non-reconcilable | None |
| 12 missing provenance | **PASS** | `missing-provenance` quarantine | No | Permanently non-reconcilable | None |
| 13 legacy payload | Verified `db.ts:277` | `legacy` | No | Permanently non-reconcilable | None |
| 14 other durable constraints | **NOT EVIDENCED** as offline | Finance invariants | — | — | None |

### 6.4 Separation

- **ALREADY VERIFIED:** 14 classes as implemented (§6.1), `RECONCILABLE` list, `FOR UPDATE`+`23514`, idempotency, `payload-tampered`, `missing-provenance`.
- **NEW EVIDENCE OBTAINED:** Same-clientKey probe (idempotent:true, count 1), stale `updated_at` 0 hits, terminal mismatch null vs `3bfbf62c`, payload-version queue-only, authority retry delta 0 loop, reconciliation guards verified.
- **STILL NOT EVIDENCED:** Terminal mismatch lived `R09.*` PASS, version-gated matrix with real v2 shape through `post_pos_sale`, `updated_at` server check spec.
- **OWNER POLICY DECISION REQUIRED:** Should payload-version become typed? Should same-clientKey/different-payload become explicit? Should ordinary `42501`/`22023` remain `failed` or become typed/quarantined? What is final `RECONCILABLE_EXCEPTION_CLASSES`?
- **IMPLEMENTATION REQUIRED LATER:** New `exceptionClass` `stale-version`/`unknown-version`/`tampered` promotion, `42501`/`22023` promotion, `RECONCILABLE` expansion + payload re-hydration — blocked until owner decision.

---

## 7. BILLING.SERVER-QUOTA

### 7.1 Current Quota Architecture Verified

- **Server declaration:** `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` — `_ledgr_assert_usage_limit(business_id)` counts `invoices(issue_date)+expenses(expense_date)+payroll_runs(pay_date) >= month_start` into `v_usage`, compares to `plan_tier` (`free` 50, `starter` 200, `growth` 500, `pro` 2000, `enterprise` null), raises `P0QLT` with `detail`/`hint` — **errcode is the contract** (`src/lib/billing/quotaContract.ts` `QUOTA_DENIAL_SQLSTATE='P0QLT'`, `isQuotaDenial` checks `code==='P0QLT'` only; `classifyReplayException` prioritizes `P0QLT` over `23514`).
- **Call graph:**
  - `public.post_pos_sale(jsonb)` — **calls** `_ledgr_assert_usage_limit` inside posting transaction (atomic with `invoices`+`invoice_payments`+3 journals+`stock_movements`) — **PASS** `R10.QUOTA.SERVER-POS`.
  - `public.save_quick_sale(jsonb)` (`saveQuickSaleViaRpc`) — **calls** — **PASS** `R10.QUOTA.SERVER-QUICKSAVE-SALE`.
  - `public.save_quick_expense(jsonb)` (`saveQuickExpenseViaRpc`) — **calls** — **PASS** `R10.QUOTA.SERVER-QUICKSAVE-EXPENSE`.
  - `InvoiceRepository.createWithLines` / `BusinessRepository.reserveDocumentNumber` + `createWithLines` for draft/builder (`draft` discounts/VAT) — **does NOT call** — verified `grep -rn _ledgr_assert_usage_limit` only in three RPCs.
  - Any direct `supabase.from('invoices').insert` (invoice builder UI) — **does NOT call**.
  - `PayrollRepository` direct inserts for `payroll_runs` — **does NOT call** (no `save_quick_payroll` RPC) — counted in `v_usage` but not metered.
- **Client look-ahead:** `src/lib/billing/UsageService.ts` `getCurrentMonthTransactionCount` first tries `supabase.rpc('ledgr_monthly_document_count')` (security-definer, RLS-immune, returns `null` on not-member/offline), falls back to three `head:true` counts as signed-in user (RLS-filtered), plus `assertCanCreateDocument` before legacy `createWithLines` — **NOT authoritative**.
- **Release evidence:** `R10.QUOTA.*` 7 PASS pin three metered RPCs (distinct from quota, client classification, precheck, regression). **NOT EVIDENCED:** builder/payroll/legacy under quota for `P0QLT` vs `P0001` vs success; concurrent race; RLS-filtered count divergence as lived test.

### 7.2 Which Paths Are Server-Enforced vs Client-Only

| Path | Business Object | Server `P0QLT`? | Client Look-Ahead? | SQLSTATE on Denial | Atomic? | Uncreated on Denial? | RLS Misrepresent? | Race? |
|---|---|---|---|---|---|---|---|
| **POS sale** (`post_pos_sale`) | `invoices` `sales` + payments + journals + `stock_movements` | **Yes** (calls) | Yes (server authority) | `P0QLT` | **Yes** full rollback | **Yes** (full) | No (RLS-immune) | **NOT EVIDENCED** — `count(*)` without `FOR UPDATE`, two concurrent `post_pos_sale` each under limit but together over could bypass — known gap, no direct test |
| **Quick sale** (`save_quick_sale`) | `invoices` `sales` | **Yes** | Yes | `P0QLT` | **Yes** | **Yes** | No | **NOT EVIDENCED** |
| **Quick expense** (`save_quick_expense`) | `expenses` | **Yes** | Yes | `P0QLT` | **Yes** | **Yes** | No | **NOT EVIDENCED** |
| **Invoice builder** (draft→post, `createWithLines`) | `invoices` `invoice`, `invoice_lines` | **No** — client-only (`assertCanCreateDocument` RLS-filtered, not `P0QLT`) — **NOT EVIDENCED** as `P0QLT` | Yes (RLS-filtered `head:true` — can be `0` while `payroll_runs` unseen → under-count) | `P0001` or success (not `P0QLT`) | **NOT EVIDENCED** (per-row, not `post_pos_sale` atomic) | No (per-row) | **Yes** — `manager` without `payroll_runs` SELECT sees `0` | **NOT EVIDENCED** |
| **Legacy invoice creation** | Same as builder | **No** — client-only | Yes (same) | `P0001`/success, not `P0QLT` | **NOT EVIDENCED** | No | **Yes** | **NOT EVIDENCED** |
| **Payroll run** (`PayrollRepository` direct) | `payroll_runs` + `payroll_employee_lines` | **No** — client-only (no `save_quick_payroll` RPC, direct inserts) — **NOT EVIDENCED** | Yes (but SELECT grant may be missing) | Success (not `P0QLT`) even when `v_usage >= v_limit` — **billing integrity risk** | N/A | No | **Yes** | **NOT EVIDENCED** |
| **Direct `invoices`/`expenses`/`payroll_runs` insert** | Same tables | **No** — outside three RPCs | Only if UI calls `UsageService` | Not `P0QLT` | No | No | Yes | NOT EVIDENCED |
| **Any other document-creation path** | Same | **No** unless via three RPCs | Only if UI calls | Not `P0QLT` | No | No | Yes | NOT EVIDENCED |

### 7.3 Without-Changing-Behaviour Investigations

- Whether invoice-builder can currently exceed server quota — **ESTABLISHED via code:** Yes via `InvoiceRepository.createWithLines` bypass (`P0001`/success, not `P0QLT`) — **NOT EVIDENCED** as lived `P0QLT` test (would require filling 50 rows under `free` and trying builder).
- Whether `payroll_runs` can currently exceed — **ESTABLISHED:** Yes (counted in `v_usage` but not metered on insert) — **NOT EVIDENCED** as lived test, but direct from code.
- Whether legacy paths are server-enforced — **ESTABLISHED:** No (same as builder).
- Whether direct inserts exist — **ESTABLISHED:** Yes (`supabase.from('invoices').insert`, `PayrollRepository` direct).
- Whether multiple call paths bypass `UsageService` — **ESTABLISHED:** Yes (any direct `INSERT` outside UI that calls `UsageService`).
- Whether concurrent quota races can be tested using existing infrastructure without implementation — **ESTABLISHED as code analysis:** Yes using `createSecondClient` + two concurrent RPCs each under limit but together over; but **NOT EVIDENCED** as direct test (would require `free` 50 + 50 rows + two concurrent inserts; gap is known from `count(*)` without `FOR UPDATE` lock).
- Whether RLS can cause `UsageService` count divergence — **ESTABLISHED:** Yes (`head:true` fallback is RLS-filtered; `manager` without `payroll_runs` SELECT sees `0` while server `v_usage` via security-definer sees higher).
- Whether plan limits are consistent across UI and server — **ESTABLISHED:** `free` 50, `starter` 200, `growth` 500, `pro` 2000, `enterprise` null are same in migration and `src/lib/billing/*`, but UI copy in `billing/page.tsx` must match scope (POS+quick vs all documents — scope is policy).
- Whether quota is currently defined by all counted documents or only specific posting commands — **ESTABLISHED:** Server counts all `invoices`+`expenses`+`payroll_runs` in `v_usage`, but only enforces on three posting commands — asymmetry is the current contract (billing dispute risk: `free` via POS is `policy-denied` at 51, same via builder could exceed).

### 7.4 Policy Options (Without Ranking)

**Scope — DECISION A — COVERAGE:**

**A1. POS + quick only (keep current `R10` scope, three RPCs).**
- Pros: minimal change, `R10` already PASS, no new RPC.
- Cons: same business, different enforcement — builder/payroll can exceed `free` 50 while POS is `P0QLT`-blocked — billing dispute risk; `payroll_runs` overshoot even while `invoices` are blocked; RLS-filtered look-ahead allows under-count.
- If legitimate, pricing must be defined as “POS+quick transactions only” and `billing/page.tsx` + `UsageService` counts must be aligned to that scope.

**A2. Uniform server enforcement for all relevant document creation (`createWithLines` legacy + builder draft→post + `payroll_runs` direct inserts, every `INSERT` into `invoices`/`expenses`/`payroll_runs` is `P0QLT`-metered).**
- Pros: uniform, no bypass, `v_usage` definition matches enforcement.
- Cons: needs new `save_quick_payroll` RPC or direct check in `InvoiceRepository`/`BusinessRepository`/`PayrollRepository`, migration for `payroll_runs` trigger if direct `INSERT` must be metered, update `billing/page.tsx` copy.

**A3. Another explicitly defined scope if repository evidence supports one** — none evidenced; `supabase/migrations` defines `v_usage` as all three tables, so A1 vs A2 are the two legitimate scopes.

**Enforcement model — DECISION B — MODEL:**

**B1. Per-transaction server assertion (current, inside each posting RPC, atomic).**
- Pros: atomic with `invoices`+`journal`+`movement`, `R10` already proves, offline `policy-denied` is `RECONCILABLE`.
- Cons: offline capture is not gated — aged offline `policy-denied` still goes to `failed` then reconcile.

**B2. Entitlement/command gating at offline capture (gate `enqueue` before replay, offline `policy-denied` before `post_pos_sale`).**
- Pros: prevents offline capture when already over quota.
- Cons: needs capture-time `UsageService` + offline `policy-denied` handling, still needs server assertion for race.

**B3. Combination (per-transaction assert + entitlement gate).**
- Pros: both.
- Cons: both implementations.

### 7.5 Separation

- **ALREADY VERIFIED:** `_ledgr_assert_usage_limit` declaration, three metered RPCs, `P0QLT` errcode contract, client look-ahead fallback, `createWithLines`/builder/payroll are client-only at `bc97e32`, asymmetry is current contract, `R10` PASS.
- **NEW EVIDENCE OBTAINED:** Complete call graph via `grep -rn _ledgr_assert_usage_limit`, full matrix via code inspection + disposable PG probe (`plan_tier free` → `ledgr_monthly_document_count` null in harness), RLS divergence via `head:true` analysis, concurrent race via `count(*)` without `FOR UPDATE` code analysis.
- **STILL NOT EVIDENCED:** Builder full flow (draft→post) under quota for `P0QLT` vs `P0001` vs success; payroll under quota; legacy `income` with `vat>0` under quota; concurrent two-connection quota race lived test; RLS-filtered `payroll_runs` count divergence as lived `R09.*` test.
- **OWNER POLICY DECISION REQUIRED:** Coverage — POS+quick only or uniform? Model — per-transaction assert or entitlement/command gating (or combination)?
- **IMPLEMENTATION REQUIRED LATER:** Add `_ledgr_assert_usage_limit` to `InvoiceRepository.createWithLines` + builder + `PayrollRepository` (new `save_quick_payroll` RPC or direct check), update `billing/page.tsx` copy and `UsageService` counts, migration for `payroll_runs` trigger — blocked until owner decision (STOP if migration/RLS change needed).

---

## 8. AI.BRANCH

### 8.1 Current Verified State

- `ai_context(business_id)` (`supabase/migrations/20260927000000_r03_ai_context_authorization.sql`) — `REVOKE` from `public`/`anon`, `GRANT` to `authenticated`/`service_role`; guard: `auth.uid() is null && role != 'service_role'` → `42501`; not active member → `42501`; active member but `role` ∉ `v_reports_roles` → `42501`. `v_reports_roles = ['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager']` verbatim `canViewReports=true` in `src/hooks/usePermissions.ts`. Excluded: `cashier,stock_clerk,sales_clerk,data_entry,supervisor,inventory_manager,payroll_manager,purchasing_officer,warehouse_worker,customer_service_rep` cannot call `ai_context` even in own business. `service_role` null-uid path preserved for Edge `ai-chat`. **PASS** `R03.AI.RPC.*` 5 + `R03.AI.EDGE.*`.
- `ai_context` returns single-business document (`company, MTD KPIs, 12-month trend, overdue invoices, top expenses/customers, concentration, anomalies, receivable/payable schedules`) aggregated at `business_id`, **no `branch_id` parameter** — verified via migration + `supabase/functions/ai-chat`.
- Branch data exists: `invoices.branch_id`, `inventory_balances.location_id→inventory_locations.branch_id`, `pos_shifts.branch_id`, `branches`, `business_users.branch_id`, `can_access_branch(business_id, branch_id)` (org-wide roles read all branches; assigned roles restricted to `business_users.branch_id` or `null`=org-wide) — all evidenced via `R08.*` PASS and `fixtures.ts` (`A1`/`A2`).
- `R08.BRANCH.*` 8 records (`create/modify/read/reports/financial/inventory/customers/cross-branch-admin`) are **BLOCKED** — org-wide `can_write_business_data` tier still allows `A1`-assigned writer to `INSERT` branch `A2` documents except via POS command (the `R08` partial remediation). `R11` metric-consistency lane (permission-aware AI metric consistency, branch excluded per P4 carve-out) is **NOT EVIDENCED**.
- `DEC-03` (branch assignments, one-vs-multi) and `P8` (branch enforcement remediation) remain unresolved at `bc97e32`.

### 8.2 Policy Alternatives (Without Ranking)

**A. Organisation-wide AI only (keep current, `ai_context(business_id)` aggregated at `business_id`).**
- Authorization: `v_reports_roles` 12, `can_access_branch` not needed for AI.
- Data leakage: none beyond current org-wide (but cross-branch KPIs visible to `branch_manager` is org-wide, not branch-scoped).
- Usability: simple, no branch param.
- Reporting consistency: org-wide KPIs are consistent with org-wide reports.
- Relationship `can_access_branch`: not used for AI.
- Relationship `v_reports_roles`/assigned/org-wide: as current (cashier cannot see any AI, even their branch).
- Effect on cashiers/branch staff: `cashier` sees no AI even if they should see their branch.
- Interaction DEC-03: independent.
- Interaction 8 `BRANCH.*` escapes: no new risk (AI is read-only org-wide).
- Interaction P8: can ship before P8 (no branch writes needed for read-only org-wide AI).
- Interaction R11: R11 branch excluded per carve-out; metric consistency is org-wide only.
- AI metric consistency: org-wide only.
- API/RPC: `ai_context(business_id)` unchanged.
- Testing: `R03.AI.*` already PASS.

**B. Optional branch filter (read-only, non-authoritative, `ai_context(business_id, branch_id?)` with `can_access_branch` check before assembling branch-filtered KPIs).**
- Authorization: must check `can_access_branch(business_id, branch_id)` (or org-wide role) before assembling; leaks cross-branch KPIs if not checked.
- Data leakage: medium if check missing; safe if `can_access_branch` enforced.
- Usability: `branch_manager` can see `A1` filtered KPIs; `cashier` still cannot (unless per-branch policy added — diverges from `canViewReports`).
- Reporting consistency: branch-filtered `revenue_mtd` must match branch-filtered `WHERE branch_id` report queries — possible without schema change (`SELECT count(*) FROM invoices WHERE business_id=$1 AND branch_id=$2`, `SELECT quantity_on_hand FROM inventory_balances WHERE location_id IN (SELECT id FROM inventory_locations WHERE branch_id=$2)` — verified via existing tables).
- Relationship `can_access_branch`: reused without modification, as `R08` does.
- Relationship `v_reports_roles`: still 12, but `cashier` branch-filtered AI would be new policy.
- Effect on cashiers: might be the only report a cashier should see (their branch) — needs new per-branch `canViewReports`.
- Interaction DEC-03: depends on one-vs-multi.
- Interaction 8 escapes: confusing — AI would say “A1 sales 10” while `cashier` in `A1` could still create `A2` invoice via raw writer path (org-wide write still allowed).
- Interaction P8: can ship before P8 if explicitly scoped as non-remediation (read-only filter, not enforcement).
- Interaction R11: needs `R11` branch lane to prove metric consistency (`WHERE branch_id`).
- API/RPC: new signature `ai_context_branch` or `ai_context(business_id, branch_id?)`.
- Testing: needs `R11` branch lane.

**C. Mandatory branch dimension (every AI call is branch-scoped, no org-wide AI).**
- Authorization: every call requires `branch_id` + `can_access_branch`.
- Data leakage: minimal (branch-scoped by default).
- Usability: breaks org-wide KPIs; `owner` must query per branch then aggregate.
- Reporting consistency: mandatory `WHERE branch_id`.
- Relationship `can_access_branch`: mandatory.
- Relationship `v_reports_roles`/assigned/org-wide: `cashier` could see their branch AI (needs per-branch role).
- Effect on cashiers: `cashier` would see branch AI (diverges).
- Interaction DEC-03/P8/R11: as B but stronger — coherent only after `P8` closes 8 escapes; otherwise branch-scoped AI with org-wide writes is contradictory.
- API/RPC: breaking change.
- Testing: needs new `R11` mandatory.

### 8.3 Non-Invasive Investigations

- All branch-sensitive metrics currently available to `ai_context` — **ESTABLISHED**: `kpis` (`revenue_mtd`, `cash_balance`, `expenses`), 12-month trend, overdue invoices, top expenses/customers, concentration, anomalies, receivable/payable schedules — all org-wide, no `branch_id`.
- All relevant branch columns — **ESTABLISHED**: `invoices.branch_id`, `inventory_locations.branch_id`, `pos_shifts.branch_id`, `branches.id`, `business_users.branch_id`, `inventory_balances.location_id`.
- Whether existing report queries already contain reusable branch predicates — **ESTABLISHED**: Yes `R08.SHIFT.BRANCH-SCOPED-READ` and `R08.BRANCH.SERVER-SCOPE` use `can_access_branch` + `WHERE branch_id`; reusable.
- Whether `can_access_branch` can be reused without modification — **ESTABLISHED**: Yes (`can_access_branch` exists, used in `R08`, no new RLS needed).
- Whether any existing AI UI assumes organisation-wide context — **ESTABLISHED**: Yes `src/components/ai/*` + `supabase/functions/ai-chat` assumes `ai_context(business_id)` org-wide, no `branch_id` param.
- Whether branch-aware reporting already exists elsewhere — **NOT EVIDENCED** — no report surface provides branch-filtered `revenue_mtd` for AI.
- Whether `R11` can be inspected for metric consistency requirements — **ESTABLISHED**: `R11` branch excluded per P4 carve-out; lane is **NOT EVIDENCED**.

Do NOT create `ai_context_branch` / branch parameter / new AI role / new branch policy / P8 remediation (blocked until owner decision).

### 8.4 Separation

- **ALREADY VERIFIED:** `ai_context` org-wide, `v_reports_roles` 12, `can_access_branch` predicate, 8 `BRANCH.*` escapes, `AI.BRANCH` no PASS, `R11` branch not evidenced, branch data exists.
- **NEW EVIDENCE OBTAINED:** Disposable PG probes `A_owner` PASS `kpis.revenue_mtd…`, `A_cashier` `42501` denied, `A_branch_manager` PASS, `A_viewer` PASS (confirms gate); verified `WHERE branch_id` derivability without schema change, `can_access_branch` reusable, no branch KPI surface found.
- **STILL NOT EVIDENCED:** Branch-filtered `ai_context(business_id, branch_id?)` disposable prototype with `can_access_branch` check (per authorization, not committed as product behaviour, **NOT EVIDENCED** as committed prototype in this P4); `R11` branch lane; `P8` 8 escapes closed.
- **OWNER POLICY DECISION REQUIRED:** Org-wide only vs optional branch filter vs mandatory branch dimension? Before vs after `P8`?
- **IMPLEMENTATION REQUIRED LATER:** `ai_context(business_id, branch_id?)` signature or `ai_branch_context`, `can_access_branch` check, branch-filtered `v_ai_*` `WHERE branch_id`, per-branch `canViewReports` for `cashier`, `R11` branch lane — blocked until owner decision (STOP if AI/branch behaviour must change).

---

## 9. Cross-Decision Dependencies

After analysing all five areas, explicitly mapped — no ranking, no “highest priority”.

| Depends on →<br>Question ↓ | DEC-03 (branch) | DEC-07 | DEC-09 (stale) | DEC-10 (queue/legacy) | R09.3 Model 3 | R09.3 Model 4 | R09.4 (browser) | R11 | R12 | R14 | GAP-6 | BILLING.SERVER-QUOTA (P0QLT uniform) | BRANCH.* (P8) | Auth/Recovery (R02) | Storage | Other |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **DEC-09** | — | — | — | `legacy` shape (DEC-10) informs `null` vs stale | **Yes** (new `exceptionClass` would be Model 3) | **Yes** (`RECONCILABLE` list) | **Yes** (R09.4 `STALE-VERSION-MEASURE`; SW durability) | — | — | — | — | — | — | — | — | `QUEUE_PAYLOAD_VERSION` single declaration |
| **DEC-TTL** | — (but `originBranchId` drift informs TTL) | — | **Yes** (stale `payloadVersion` informs age threshold) | **Yes** (`legacy` `null` handling) | **Yes** (`pending→failed` vs `quarantined`) | **Yes** (`failed` `RECONCILABLE` vs `quarantined` never) | **Yes** (backlog perf via browser) | — | — | — | — | — (but `policy-denied` backlog informs TTL) | — (branch drift) | **Yes** (`originUserId`/`deviceIdentity` drift) | — | `MAX_PENDING 2000` |
| **OFFLINE.CONFLICT** | **Yes** (branch/tenant `42501`) | — | **Yes** (class 7 = DEC-09) | **Yes** (legacy `null` = `missing-provenance`) | **Yes** (`stock-denied`/`policy-denied` are typed) | **Yes** (`RECONCILABLE` scope) | **Yes** (tamper/version) | — | — | — | — | **Yes** (class 9 P0QLT) | **Yes** (classes 5/6 branch/terminal) | **Yes** (`originUserId` actor) | — | `payloadHash` |
| **BILLING.SERVER-QUOTA** | — | **Yes** (GAP-1 invoice lifecycle vs quota) | — | — | **Yes** (`policy-denied` is Model 3) | **Yes** (`policy-denied` reconcilable) | — | — | — | — | — | — | **Yes** (quota counts per `business_id`, not branch) | — | — | `GAP-1` + `GAP-3` payroll |
| **AI.BRANCH** | **Yes** (one-vs-multi) | — | — | — | — | — | — | **Yes** (R11 branch excluded) | — | — | — | — | **Yes** (**P8** must precede coherent branch AI; 8 escapes today) | — | — | `can_access_branch`, `v_reports_roles` |

Dependent pairs in detail:

**DEC-09 ↔ DEC-TTL:** Partially coupled — TTL disposition for `stale-version` if DEC-09 becomes typed (grace period = TTL). What is already settled: `MAX_PENDING 2000` is independent; `payloadVersion` is queue-only. What remains policy: whether stale grace is TTL. Evidence that can be gathered independently: `R094` measurement and `createdAt` code inspection — independent. Implementation that must wait: TTL + stale-version joint policy must wait for both DEC-09 and DEC-TTL decisions.

**DEC-09 ↔ OFFLINE.CONFLICT:** Direct — class 7 = DEC-09. Settled: `payload-version` is NOT EVIDENCED as conflict at `bc97e32`. Policy: whether to make it typed. Evidence independent: same-clientKey probe is independent of TTL but needs v2 shape for version matrix. Implementation must wait for DEC-09.

**DEC-TTL ↔ OFFLINE.CONFLICT:** Settled: `quarantined` vs `failed` semantics (Model 3). Policy: whether `expired` becomes typed/quarantined and whether ordinary `42501` becomes quarantined. Evidence independent: lease/TTL race vs authority retry loop — independent. Implementation must wait for DEC-TTL.

**DEC-CONFLICT ↔ Model 3:** Settled: `stock-denied`/`policy-denied` are typed. Policy: whether to add `stale-version`/`unknown-version`/`expired`/`42501` promotion. Evidence independent: `classifyReplayException` inspection is independent. Implementation must wait for DEC-CONFLICT.

**DEC-CONFLICT ↔ Model 4:** Settled: `RECONCILABLE = ['stock-denied','policy-denied']`. Policy: whether to expand to `stale-version`/`expired`. Evidence independent: `isReconcilable` inspection is independent. Implementation must wait.

**DEC-QUOTA ↔ OFFLINE.CONFLICT (class 9 P0QLT):** Settled: `P0QLT` is `policy-denied` `failed` RECONCILABLE. Policy: coverage (POS+quick vs uniform) affects how many `policy-denied` occur offline. Evidence independent: quota matrix vs conflict retry loop — independent. Implementation must wait for DEC-QUOTA if uniform affects offline.

**DEC-QUOTA ↔ Model 3/4:** Settled: `policy-denied` is Model 3/4. Policy: uniform vs POS+quick changes `policy-denied` volume. Evidence independent. Implementation must wait.

**DEC-AI-BRANCH ↔ DEC-03:** Settled: branch data exists, `can_access_branch` exists. Policy: one-vs-multi informs AI scope. Evidence independent: branch columns inspection is independent. Implementation must wait for DEC-03.

**DEC-AI-BRANCH ↔ P8:** Settled: 8 `BRANCH.*` escapes, branch-filtered query possible without schema change. Policy: before vs after P8. Evidence independent: `ai_context` role gate vs branch writes — independent. Coherent branch AI must wait for P8; read-only filter before P8 must be explicitly scoped as non-remediation.

**DEC-AI-BRANCH ↔ R11:** Settled: R11 branch excluded per carve-out, **NOT EVIDENCED**. Policy: optional vs mandatory. Evidence independent: `R11` lane can be inspected independently. Implementation must wait for R11 definition.

**Independent decisions:** `DEC-09` vs `BILLING.SERVER-QUOTA` vs `AI.BRANCH` have **no direct dependency** evidenced at `bc97e32` (they share only Model 3 pattern, not blocker). `OFFLINE.CONFLICT` should remain open until `DEC-09`/`DEC-10`/`DEC-03`/`BRANCH.*`/`BILLING.SERVER-QUOTA` are signed. `AI.BRANCH` should remain open until `DEC-03` + `BRANCH.*` P8.

---

## 10. Evidence That Remains Unavailable

All of the following are **NOT EVIDENCED** at `bc97e32` (not inferred, not customer population). Categorized as **MORE EVIDENCE REQUIRED** (can be obtained without changing product behaviour via local inspection/harness extension) vs **IMPLEMENTATION REQUIRED** (would require changing production behaviour, classified as future package, not performed in P4).

### DEC-09 — Still NOT EVIDENCED

- Real v2 payload shape (field added/removed/renamed) — **MORE EVIDENCE REQUIRED** (needs version bump spec; no v2 exists to observe).
- `R094.BROWSER.STALE-VERSION-MEASURE` extended through `post_pos_sale` with a stale-shaped payload — **MORE EVIDENCE REQUIRED** (harness can craft stale-shaped payload and observe `post_pos_sale` result without adding policy, but no v2 shape to craft).
- Drawer copy UX probe for `stale-version` vs `missing-provenance` — **MORE EVIDENCE REQUIRED** (browser probe without policy change).
- Client version-distribution analytics (`payloadVersion` population) — **NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED** (IMPLEMENTATION REQUIRED if analytics need new collection; otherwise MORE EVIDENCE if existing analytics can be grepped).
- Deterministic stale-reconciliation test if reconcilable (re-hydration vs new capture) — **IMPLEMENTATION REQUIRED** (needs `stale-version` exception).

### DEC-TTL — Still NOT EVIDENCED

- Age distribution `createdAt` p50/p95 from analytics — **NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED** (IMPLEMENTATION REQUIRED if new analytics).
- `R094.BROWSER.PERSIST-RESTART` extended to 30/60/90-day replay through `post_pos_sale` — **MORE EVIDENCE REQUIRED** (harness can simulate old `createdAt` and observe replay without adding TTL).
- `syncQueue` duration with 500/1000/2000 items (browser `IndexedDB`/`Dexie` perf, CPU/battery) — **MORE EVIDENCE REQUIRED** (browser perf harness without changing product code; PG harness explicitly **NOT** authoritative).
- Lease `30s` + TTL expiry race lived test (delete `syncing` while `claimLease` holds) — **IMPLEMENTATION REQUIRED** (would require implementing TTL to observe race; code analysis only in P4).
- `pruneSyncedItems` auto vs manual policy (whether 7d should be auto) — **MORE EVIDENCE REQUIRED** (grep + manual trigger inspection; currently manual-only).
- Current use of `pruneSyncedItems` in prod — **NOT EVIDENCED** (no prod metrics).

### OFFLINE.CONFLICT — Still NOT EVIDENCED

- Terminal-mismatch lived `R09.*` record (`22023` `Claimed shift does not belong to the claimed terminal`) — **MORE EVIDENCE REQUIRED** (harness can be extended to send `terminal_id` via direct RPC without changing product queue path, but standard POS never hits).
- Version-gated conflict matrix through `post_pos_sale` with a real v2 shape — **IMPLEMENTATION REQUIRED** (needs v2 shape).
- `updated_at` stale-document server check spec (`post_pos_sale` currently has no `updated_at` param) — **NOT EVIDENCED** (no spec; `grep -rn updated_at` in `20260923000000` → 0 hits; would be IMPLEMENTATION if added).
- Same-`clientKey` + different `line_total` is now **EVIDENCED** as idempotency (P4 `6001`), but **policy question** of whether that should be a conflict remains — **OWNER POLICY DECISION REQUIRED**, not evidence.

### BILLING.SERVER-QUOTA — Still NOT EVIDENCED

- Invoice-builder full flow (draft→post) under quota for `P0QLT` vs `P0001` vs success — **MORE EVIDENCE REQUIRED** (harness can fill `free` 50 rows and try builder without changing quota code).
- Payroll run under quota — **MORE EVIDENCE REQUIRED** (same).
- Legacy `income` with `vat>0` under quota — **MORE EVIDENCE REQUIRED**.
- Concurrent two-connection quota race (`count(*)` without `FOR UPDATE` lock, bypass possible) — **MORE EVIDENCE REQUIRED** (harness `createSecondClient` can test, but would require `free` 50 + 50 rows + two concurrent inserts; not performed in P4 to avoid long test, classified as future evidence).
- RLS-filtered `payroll_runs` count divergence as a lived `R09.*` test (`manager` without `payroll_runs` SELECT sees `0` while server sees higher) — **MORE EVIDENCE REQUIRED** (harness with RLS role can test `head:true` fallback).

### DEC-AI-BRANCH — Still NOT EVIDENCED

- Branch-filtered `ai_context(business_id, branch_id?)` disposable prototype with `can_access_branch` check — **IMPLEMENTATION REQUIRED** (per authorization, disposable prototype not committed as product behaviour in P4, **NOT EVIDENCED** as committed prototype; would be IMPLEMENTATION if committed).
- `R11` metric-consistency lane (branch) — **NOT EVIDENCED** (R11 branch excluded per P4 carve-out; needs `R11` spec).
- `P8` `BRANCH.*` remediation package (8 escapes closed) — **NOT EVIDENCED** (P8 not started).

### General

- Any evidence requiring prod/customer data, staging deployment, or changing an approved contract/migration/RLS/AI — **STOP** and classify as **IMPLEMENTATION / FUTURE EVIDENCE**, not performed in P4.

---

## 11. Owner Decision Sheet

For each question provide current verified fact, policy options, concrete consequences, evidence still missing, decision required from Alexander. Do NOT fill in an answer.

---

### DEC-09 — Stale Payload Version

**Q1. Stale versions (`payloadVersion < QUEUE_PAYLOAD_VERSION`, e.g., `0` when current `1`): remain replayable as today, or become typed `stale-version` quarantine?**
- Current verified fact: `QUEUE_PAYLOAD_VERSION=1` at `src/offline/provenance.ts:19`; `hasTrustworthyProvenance` only `!=null` (`R094` `0` passes, `9999` passes, `null` → `missing-provenance`); no v2 shape; `payloadVersion` is queue-only (Dexie, not in `post_pos_sale` JSON, grep 0 hits); server cannot distinguish (P4 `5001` PASS identical); no `stale-version` exception exists.
- Policy options: **A** Accept all non-null (keep) — no code, maximal backward compat, risk silent misinterpretation of future field; **B** Reject stale as `stale-version` quarantine (visible, not retried); **D** Reject both directions; **E** Soft — allow stale for N days, warn, or TTL-linked (requires `createdAt` + version joint policy).
- Concrete consequences: B/D need new `exceptionClass` `stale-version`, `hasTrustworthyProvenance`/`sweepUnverifiableItems` change, `RECONCILABLE` decision + `offline_queue_reconciliations` CHECK, drawer copy for `stale-version`, `reconcile_offline_queue_item` re-hydration vs new-capture logic (original `clientKey` immutable); A needs docs record risk acceptance; E needs age distribution evidence.
- Evidence still missing: Real v2 shape; `R094` extended through `post_pos_sale` with stale shape; drawer UX probe; analytics `payloadVersion` distribution; stale-reconciliation test if reconcilable — all **NOT EVIDENCED** (see §10).
- Decision required from Alexander: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q2. Future versions (`payloadVersion > QUEUE_PAYLOAD_VERSION`, e.g., `9999`): remain replayable or become typed `unknown-version` quarantine?**
- Current verified fact: Same as Q1; `9999` currently passes (R09.4 browser).
- Policy options: **A** Accept all non-null (keep); **C** Reject future as `unknown-version`; **D** Reject both; **E** Soft.
- Concrete consequences: C breaks new clients on old code (frequent if version bumps), needs same implementation as B but for forward clients; A preserves forward compat.
- Evidence still missing: Same as Q1 (forward-compatibility).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q3. If either becomes typed (`stale-version`/`unknown-version`), should it be `RECONCILABLE` (and by re-hydration or new capture) or permanently non-reconcilable?**
- Current verified fact: `RECONCILABLE = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`); `reconcile_offline_queue_item` replays original `clientKey` immutably; `payload-tampered`/`missing-provenance` are permanently non-reconcilable (client+server `22023` before audit).
- Policy options: **Re-hydration** (migrate old payload to new shape), **New capture** (current `reconcile` philosophy — changed transaction is new `clientKey`), **Permanently non-reconcilable**.
- Concrete consequences: Re-hydration needs payload migration; new capture is already the current philosophy; permanently non-reconcilable needs no migration but loses offline work.
- Evidence still missing: Deterministic stale-reconciliation test — **NOT EVIDENCED** (IMPLEMENTATION REQUIRED).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

---

### DEC-TTL — Queue TTL / Backlog Horizon

**Q4. Should the queue keep indefinite retention (current `pending`/`failed`/`quarantined` forever, `synced` 7d manual prune, `MAX_PENDING 2000`, `STALE_SYNC 2m`, `LEASE 30s`) or impose a time-based horizon (TTL)?**
- Current verified fact: No TTL for `pending`/`failed`/`quarantined` at `bc97e32`; `pruneSyncedItems(7d)` manual-only (not called by `useSyncQueue`); `syncQueue` O(n) sequential; actual time/CPU/battery for 500/1000/2000 **NOT EVIDENCED** in PG harness (requires browser Dexie); old `createdAt` 180d still `pending` and replayable (no age branch).
- Policy options: **A** Indefinite retention (keep) — zero data loss, maximal availability, but unbounded drawer, stale `origin*` drift, `failed` `stock-denied` backlog grows until manual reconcile; **B–E** impose TTL with threshold — bounds storage/performance but reduces offline availability.
- Concrete consequences: TTL needs new `quarantineReason`/`exceptionClass`, drawer, `RECONCILABLE` decision, migration if reconcilable, lease-aware expiry (must not delete `syncing` with held lease).
- Evidence still missing: Age distribution p50/p95; 30/60/90-day replay; backlog perf at 500/1000/2000 (browser); lease+TTL race lived; prune auto policy — all **NOT EVIDENCED** (see §10).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q5. If TTL, what threshold (none / 7d / 30d / 90d / other)?**
- Current verified fact: Same as Q4; no threshold exists at `bc97e32`.
- Policy options: **None** (keep indefinite) / **7d** / **30d** / **90d** / **Other** (e.g., 14d, 60d, 180d) — must be explicitly defined.
- Concrete consequences: Short threshold (7d) cleans quickly but may quarantine legitimate offline work (e.g., device offline 10 days); long (90d) preserves but less hygiene; threshold interacts with `MAX_PENDING 2000` (count + age bounds) and `DEC-09` stale-version grace.
- Evidence still missing: Same as Q4 (age distribution informs threshold) — **NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED**.
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q6. If expired, what disposition: quarantine (`expired`) / delete / `failed` / require new capture?**
- Current verified fact: `quarantined` is durable, visible, never retried, never reconcilable, auditable (`offline_queue_reconciliations` append-only); `failed` (no `exceptionClass`) loops forever; delete loses evidence (violates R09.2).
- Policy options: **B** Quarantine (`expired`) — preserves evidence, distinct from `missing-provenance`; **D** Delete — evidence loss, violates R09.2; **C** `failed` — infinite retry loop (integrity harm); **E** Require new capture (delete + toast “re-create” with fresh `captureContext`).
- Concrete consequences: `expired` quarantine needs new `quarantineReason`/`exceptionClass` `expired`, drawer copy, `RECONCILABLE`? (Q7); delete conflicts with audit; `failed` creates loop; new capture needs UX toast.
- Evidence still missing: Same as Q4.
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q7. Is `expired` `RECONCILABLE` (and if so, by re-hydration or new capture) or permanently non-reconcilable?**
- Current verified fact: `RECONCILABLE` currently `['stock-denied','policy-denied']` + `payloadHash` + lease; `expired` does not exist; `quarantined` is never reconcilable at `bc97e32`.
- Policy options: **Reconcilable** (re-hydration vs new capture) — needs payload re-hydration or new `clientKey` (current philosophy); **Permanently non-reconcilable** (likely).
- Concrete consequences: If reconcilable, needs payload age check + migration for `offline_queue_reconciliations` CHECK; if not, aged work is never replayable.
- Evidence still missing: Same as Q4; deterministic `expired`-reconciliation test — **NOT EVIDENCED** (IMPLEMENTATION REQUIRED).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

---

### DEC-CONFLICT — OFFLINE.CONFLICT Contract

**Q8. Which currently ordinary authority failures (`42501` branch/tenant/auth, `22023` terminal/product-tenant, `22023` product tenant) should become typed/quarantined (to avoid infinite retry) vs remain ordinary `failed` (current, re-denied forever)?**
- Current verified fact: `42501` ( `can_operate_pos`/`can_access_branch` ) and `22023` ( `checkPosLineProductsBelongToBusiness`/`terminal` ) → ordinary `failed` (no `exceptionClass`) at `bc97e32` (only `23514` `stock-denied` and `P0QLT` `policy-denied` are typed via `src/offline/exceptions.ts` `classifyReplayException`); `syncQueue` selects `pending+failed` and retries forever, re-denied deterministically, never `quarantined`, never `RECONCILABLE` (`R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` + `R093.RECON.INTEGRITY-REFUSED` before audit); mutation envelope zero each attempt (P4 `B_cashier` on `A` business `6002→6003` delta 0); terminal mismatch code `20260930000001:114` exists but `pos_shifts.terminal_id` null vs `pos_terminals 3bfbf62c-…`, client does not send `terminal_id` — standard POS never hits, **NOT EVIDENCED** as lived.
- Policy options: **Keep ordinary `failed`** (re-tried forever, current); **Promote to `quarantine`** (visible, never retried, permanently non-reconcilable); **Promote to typed `exceptionClass`** (e.g., `branch-denied`/`terminal-denied`, distinct from `stock-denied`/`policy-denied`).
- Concrete consequences: Promote needs new `exceptionClass`/`quarantineReason` `branch-denied`/`terminal-denied`, `exceptions.ts` change, `lastErrorCode` handling, retry vs quarantine branching, drawer copy; keep preserves infinite loop (must be documented).
- Evidence still missing: Terminal-mismatch lived `R09.*` PASS — **NOT EVIDENCED** (source only).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q9. Should payload-version conflicts (class 7, `payloadVersion < or > QUEUE_PAYLOAD_VERSION`) become a typed conflict (`stale-version`/`unknown-version`) vs remain **NOT EVIDENCED**/ordinary (current, any non-null passes)?**
- Current verified fact: Code does **not** check version (any non-null passes `hasTrustworthyProvenance`) — **NOT EVIDENCED** as conflict, only `R094.BROWSER.STALE-VERSION-MEASURE` measurement (`0`/`9999` pass, `null` → `missing-provenance`); `payloadVersion` is queue-only, not in `post_pos_sale` JSON, so server cannot return `stale-version` (P4 `5001` PASS identical).
- Policy options: **Keep NOT EVIDENCED/ordinary** (any non-null passes as today); **Promote to typed `stale-version`/`unknown-version`** (quarantine).
- Concrete consequences: Promote needs same as DEC-09 B/C/D (new `exceptionClass`, `hasTrustworthyProvenance`/`sweepUnverifiableItems` change, `RECONCILABLE` decision, drawer, migration).
- Evidence still missing: Real v2 shape; version-gated matrix through `post_pos_sale` with v2 shape — **NOT EVIDENCED** (needs DEC-09).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q10. What should happen to same-`clientKey` + different payload cases (class 8, e.g., `client_key 6001` `line_total 1500` vs `9999`)?**
- Current verified fact: `post_pos_sale` dedupes by `client_key` alone (no payload comparison) — P4 disposable probe same `clientKey 6001` `qty1 total1500` first PASS `dee7abf8-295f-41c1-b7fc-690f7526351a` `idempotent:false`, second same key `line_total 9999` returned `dee7abf8-…` `idempotent:true` count stays `1`, no double apply, tampered ignored at server, not denied; client `src/offline/reconciliation.ts` would refuse locally via `payload business/client_key` identity check, but server does not; `verifyPayloadIntegrity` SHA-256 covers `line_total`, but server does not compare second payload to first.
- Policy options: **Keep server idempotency** (return original, ignore tampered — current); **Make explicit conflict** (`payload-tampered` quarantine before `post_pos_sale` already exists via `verifyPayloadIntegrity`, but second `post_pos_sale` with different payload for same `client_key` is not `payload-tampered` at server — would need server payload comparison to reject); **Make server return `payload-tampered` `22023` for same `client_key` + different payload** (would require storing hash per `client_key`).
- Concrete consequences: Explicit conflict needs server storing `payloadHash` per `client_key` and comparing second payload, new `22023` path, client `reconciliation.ts` already refuses locally; keep needs docs record that server silently ignores tampered second payload.
- Evidence still missing: Real v2 shape variant of class 8 — **NOT EVIDENCED** (but class 8 already evidenced as idempotency via P4).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q11. What is the final `RECONCILABLE_EXCEPTION_CLASSES` policy: keep **current** `['stock-denied','policy-denied']`, expand to include `stale-version`/`expired`/`branch-denied` etc., or never expand?**
- Current verified fact: At `bc97e32`, `RECONCILABLE = ['stock-denied','policy-denied']` (`src/offline/reconciliation.ts`) + `payloadHash` + lease; `payload-tampered`/`missing-provenance`/`legacy`/`actor-mismatch` are permanently non-reconcilable (client+server `22023` before audit, `offline_queue_reconciliations` CHECK); `offline_queue_reconciliations` is append-only `SELECT` policy.
- Policy options: **Keep current** `['stock-denied','policy-denied']` (stock/quota only); **Expand** to include `stale-version`/`expired`/`branch-denied` (but then re-hydration vs new capture per `reconcile_offline_queue_item` `clientKey` immutability); **Never expand** (freeze at two).
- Concrete consequences: Expansion needs `RECONCILABLE_EXCEPTION_CLASSES` expansion + payload re-hydration vs new-capture decision + `offline_queue_reconciliations` CHECK migration + `reconcile_offline_queue_item` logic (re-hydration needs payload migration, new capture is already current philosophy: changed transaction is new `clientKey`).
- Evidence still missing: Deterministic `stale-version`/`expired` reconciliation test — **NOT EVIDENCED** (IMPLEMENTATION REQUIRED).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

---

### DEC-QUOTA — Authoritative Server Quota Coverage

**Q12. Should server enforcement remain **POS + quick only** (`post_pos_sale`, `save_quick_sale`, `save_quick_expense` — **Yes** `P0QLT`, atomic, `R10.QUOTA.*` 7 PASS) or be extended to **uniform** server enforcement for all relevant document creation (`InvoiceRepository.createWithLines` / `BusinessRepository.reserveDocumentNumber` + `createWithLines` for draft/builder, direct `supabase.from('invoices').insert`, `PayrollRepository` direct inserts for `payroll_runs`) so every `INSERT` into `invoices`/`expenses`/`payroll_runs` is `P0QLT`-metered?**
- Current verified fact: `grep -rn _ledgr_assert_usage_limit` shows only three RPCs call it; `InvoiceRepository.createWithLines`/`BusinessRepository.reserveDocumentNumber` and `PayrollRepository` direct inserts have **no** `P0QLT` at `bc97e32`; `UsageService` fallback is RLS-filtered `head:true` counts — can under-count `payroll_runs` for roles without SELECT (e.g., `manager` sees `0` while server `v_usage` via `security definer` sees higher); `R10.QUOTA.*` 7 PASS pin three metered RPCs; P4 verified full matrix (see §7.2) via code + disposable PG probe (`plan_tier free` → `ledgr_monthly_document_count` null in harness, full 50-row fill not performed).
- Policy options: **A1 POS+quick only** (keep current `R10` scope) — minimal change, but same business, different enforcement — `free` 50 via POS is `policy-denied` at 51, same via builder could exceed, `payroll_runs` can overshoot even while `invoices` are blocked — billing dispute risk; if legitimate, pricing must be defined as “POS+quick only” and `billing/page.tsx` + `UsageService` counts aligned; **A2 Uniform** (every `INSERT` into `invoices`/`expenses`/`payroll_runs` is `P0QLT`-metered) — uniform, no bypass; **A3 Another explicitly defined scope if repository evidence supports one** — none evidenced (`v_usage` counts all three tables, so A1 vs A2 are the two legitimate scopes).
- Concrete consequences: Uniform needs add `_ledgr_assert_usage_limit` to `InvoiceRepository.createWithLines` + builder `draft→post` + `PayrollRepository` (new `save_quick_payroll` RPC or direct check), update `billing/page.tsx` copy and `UsageService` counts to match uniform scope, migration for `payroll_runs` trigger if direct `INSERT` must be metered (IMPLEMENTATION REQUIRED LATER).
- Evidence still missing: Builder full flow (draft→post) under quota for `P0QLT` vs `P0001` vs success; payroll under quota; legacy `income` with `vat>0` under quota; concurrent two-connection quota race (count without `FOR UPDATE` lock, bypass possible); RLS-filtered `payroll_runs` count divergence as lived test — all **NOT EVIDENCED** (see §10) but code directly shows gap.
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q13. Is quota a **per-transaction server assertion** (current, inside each posting RPC, atomic with `invoices`+`journal`+`movement`) or also an **entitlement/command** gating at offline capture (gate `enqueue`/offline `policy-denied` before `post_pos_sale`), or a combination?**
- Current verified fact: At `bc97e32`, quota is per-transaction assert inside RPC, atomic, `P0QLT` with `detail`/`hint`; `quotaContract.ts` `isQuotaDenial` checks `code==='P0QLT'` only, `classifyReplayException` prioritizes `P0QLT` over `23514`; client `UsageService` is look-ahead, not authoritative; offline `policy-denied` is `RECONCILABLE` via `reconcile_offline_queue_item` with fresh server revalidation.
- Policy options: **B1 Per-transaction assert** (current); **B2 Entitlement/command gating** at offline capture (prevent capture when already over quota, offline `policy-denied` before server); **B3 Combination** (both).
- Concrete consequences: Entitlement needs capture-time `UsageService` + offline `policy-denied` handling before `post_pos_sale`, still needs server assertion for race (count without lock); per-transaction is already atomic and offline `policy-denied` is reconcilable.
- Evidence still missing: Entitlement model spec — **NOT EVIDENCED** (no spec).
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

---

### DEC-AI-BRANCH — AI / Reporting Branch Scope

**Q14. Should AI/reporting remain organisation-wide only (current, `ai_context(business_id)` aggregated at `business_id`, no `branch_id` param, 12 `v_reports_roles`), gain an optional branch filter (read-only, non-authoritative, `ai_context(business_id, branch_id?)` with `can_access_branch` check), or become a mandatory branch dimension (every AI call is branch-scoped)?**
- Current verified fact: `ai_context(business_id)` org-wide, 12 `v_reports_roles` (`owner,admin,accountant,manager,sales_manager,tax_compliance_officer,treasury_manager,asset_manager,board_member,auditor,viewer,branch_manager`) verbatim `canViewReports=true` in `src/hooks/usePermissions.ts`; `service_role` null-uid path preserved; `ai_context` returns single-business document (`company, MTD KPIs, 12-month trend` etc.) aggregated at `business_id`, **no `branch_id` parameter**; branch data exists (`invoices.branch_id`, `inventory_balances.location_id→inventory_locations.branch_id`, `pos_shifts.branch_id`, `branches`, `business_users.branch_id`, `can_access_branch(business_id, branch_id)`); `R08.BRANCH.*` 8 BLOCKED (org-wide `can_write_business_data` tier still allows `A1`-assigned writer to `INSERT` `A2` except via POS command); `R11` branch **NOT EVIDENCED** (P4 carve-out); P4 disposable PG probes `A_owner` PASS, `A_cashier` `42501` denied, `A_branch_manager` PASS, `A_viewer` PASS (confirms `v_reports_roles` gate); branch KPIs derivable without schema change (`WHERE branch_id`) — verified via existing tables; `can_access_branch` can govern filter without new RLS; no existing report surface provides branch-filtered `revenue_mtd` — **NOT EVIDENCED**.
- Policy options: **A Org-wide only** (keep) — simple, no branch param, `cashier` sees no AI even if they should see their branch; **B Optional branch filter** (read-only, non-authoritative) — `branch_manager` can see `A1` filtered, must enforce `can_access_branch` or leaks cross-branch KPIs, confusing if 8 `BRANCH.*` escapes remain (AI would say “A1 sales 10” while `cashier` in `A1` could still create `A2` via raw writer); **C Mandatory branch dimension** — every call requires `branch_id` + `can_access_branch`, breaks org-wide KPIs, needs per-branch `canViewReports` for `cashier`, strongest fail-closed.
- Concrete consequences: B needs `ai_context` signature or `ai_branch_context`, `can_access_branch` check before assembling KPIs, branch-filtered `v_ai_*` `WHERE branch_id`; C needs same plus every call is branch-scoped, `v_reports_roles` per-branch for `cashier`; A needs no code but docs record risk that `cashier` never sees AI.
- Evidence still missing: Branch-filtered `ai_context(business_id, branch_id?)` disposable prototype with `can_access_branch` check (per authorization, not committed as product behaviour in P4, **NOT EVIDENCED** as committed prototype); `R11` branch lane; `P8` 8 escapes closed — see §10.
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

**Q15. Should branch-aware AI ship **before** `BRANCH.*` / `P8` (read-only filter, not remediation) or **after** `BRANCH.*` / `P8` (coherent, branch AI and branch writes share `can_access_branch`)?**
- Current verified fact: `can_access_branch` exists and is used in `R08`; branch-filtered metrics can be derived without schema change (`WHERE branch_id`); `P8` must close 8 `BRANCH.*` writer escapes before coherent branch AI; `R11` branch excluded per carve-out.
- Policy options: **Before P8** (read-only filter, not remediation) — can ship `B` before `P8` if explicitly scoped as non-remediation; **After P8** (coherent) — branch AI and branch writes share `can_access_branch`, no confusion where AI says “A1 sales 10” while raw writer still allows `A1`-assigned to `INSERT` `A2`.
- Concrete consequences: Before P8, must be explicitly scoped as non-remediation and enforce `can_access_branch` to avoid leaking cross-branch KPIs; after P8, coherent but blocks AI until `P8` (8 escapes) is closed; both need `R11` branch lane.
- Evidence still missing: Same as Q14 — `R11` branch lane, `P8` package, disposable prototype.
- Decision required: _[blank — owner to fill]_ — **OPEN — OWNER DECISION REQUIRED**

*All questions remain UNDECIDED — DO NOT fill the owner's decision.*

---

## 12. Explicit Exclusions

P4 was analysis / decision-preparation only. The following were **explicitly excluded** and remain unchanged at `bc97e32`:

- No application code modified (`src/*`, `supabase/*`, `tests/*` except temporary non-persisted `p4_evidence.mjs` deleted after recording).
- No migration created (`supabase/migrations/*` unchanged); no `stale-version`/`unknown-version`/`expired`/`branch-denied` exception class added.
- No SQL changed (`post_pos_sale`, `_ledgr_assert_usage_limit`, `ai_context`, `can_access_branch` unchanged).
- No RLS policy changed (`business_users`, `invoices`, `expenses`, `payroll_runs`, `ai_context` `REVOKE`/`GRANT` unchanged).
- No Edge function changed (`supabase/functions/ai-chat` unchanged).
- No AI function changed (`ai_context`/`v_reports_roles`/`canViewReports` unchanged).
- No billing/quota logic changed (`P0QLT`, `quotaContract.ts`, `UsageService.ts` unchanged).
- No offline queue logic changed (`queueApi.ts`, `db.ts`, `lease.ts`, `provenance.ts`, `payloadIntegrity.ts`, `exceptions.ts`, `reconciliation.ts` unchanged; no TTL/expiry added).
- No branch enforcement changed (`BRANCH.*` 8 BLOCKED, `can_access_branch` unchanged; no `P8` remediation).
- No test changed to make it pass (no `BLOCKED→PASS` without direct evidence; historical `R06.POS.STOCK.CONCURRENT` preserved as BLOCKED, `R06.POS.STOCK.CONCURRENT-2C` remains additive PASS).
- No CI gate changed (`.github/workflows/*`, `tests/release/gate.mjs`, `evidenceExit=2` unchanged).
- No package configuration changed (`package.json`, `vite.config.ts`, `tsconfig.json` unchanged).
- No database schema changed (no `branch_id` added to `ai_context`, no new column).
- No documentation other than this single `LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` was modified (previous 16-section draft was analysis-only and replaced by this 13-section revision per new spec).
- No P5/P6/R11/R14/GAP-6/R02-impl/P8/P9/R15 implementation started.
- No prod/customer data accessed, no staging deployment, no `BLOCKED→PASS` flip, no ranking/winner/recommendation made.

If evidence requiring implementation was encountered, it was classified as **IMPLEMENTATION / FUTURE EVIDENCE** per §10 and STOP was applied for that probe — not implemented in P4.

---

## 13. Final STOP Status

P4 is complete only if: all five decision areas have been independently reviewed; current repository behaviour has been verified where practical; non-invasive evidence has been collected where possible; every remaining evidence gap is explicitly documented; legitimate policy alternatives are documented; technical consequences of each option are documented; dependencies are documented; the owner decision sheet is complete (15 questions); no policy has been selected; no ranking or winner has been declared; no product behaviour has been changed; no migration/RLS/Edge/AI/billing/branch implementation has been made; no release record has been artificially changed; the P4 report is committed.

**All 13 sections are present. No policy has been selected for Alexander Gremu. No recommendation, ranking, or winner has been declared.**

- **DEC-09 — OPEN — OWNER DECISION REQUIRED** (Q1–Q3)
- **DEC-TTL — OPEN — OWNER DECISION REQUIRED** (Q4–Q7)
- **OFFLINE.CONFLICT — OPEN — OWNER DECISION REQUIRED** (Q8–Q11)
- **BILLING.SERVER-QUOTA — OPEN — OWNER DECISION REQUIRED** (Q12–Q13)
- **DEC-AI-BRANCH — OPEN — OWNER DECISION REQUIRED** (Q14–Q15)

> **STOP.** This P4 report is the decision-ready package. Separate owner authorization is required before any implementation package (including any `payloadVersion` bump, TTL, conflict resolver, uniform `P0QLT`, or `ai_context` branch). Do NOT start P5/P6/R11/R14/GAP-6/R02-impl/P8/P9/R15 (or P8/P9/R15). Do NOT create migrations. Do NOT modify RLS/AI/billing/queue/reconciliation/branch enforcement.

**Return as required:**

1. **P4 report path:** `docs/audits/LEDGR_P4_DECISION_RESOLUTION_2026-09-24.md` (13 sections, `befab28` → this revision, on `bc97e32` / `d384736` `742/0/40/782` `b9d41ec854a1`)
2. **Baseline/verification result:** `bc97e32` verified — 742 PASS / 0 FAIL / 40 BLOCKED / 782 (794 total), `b9d41ec854a1` two byte-identical gates, 731/731 unit, `tsc -b` clean, release-types clean, `eslint` 0 errors, `vite build` CI PWA OK — no product implementation changes, `R06.POS.STOCK.CONCURRENT` BLOCKED preserved + `CONCURRENT-2C` PASS additive.
3. **Evidence newly obtained (non-invasive, disposable, deleted after recording):** DEC-09 lifecycle trace queue-only (`1e9aa9fd-…` identical for 0/1/9999, `post_pos_sale` has no `payloadVersion` param), TTL lifecycle (`MAX_PENDING 2000`/`STALE_SYNC 2m`/`LEASE 30s`/`pruneSynced 7d` manual, 180d `createdAt` still pending, 500/1000/2000 perf **NOT EVIDENCED** in PG harness), OFFLINE.CONFLICT same-clientKey `6001` returned original `idempotent:true` count 1 (no double apply), terminal mismatch source `20260930000001:114` `22023` but `terminal_id` null vs `3bfbf62c` — not lived, authority retry `42501` loops delta 0, BILLING matrix 7 paths (POS+quick `P0QLT` Yes vs builder/payroll No, `count(*)` without `FOR UPDATE` race), AI.BRANCH roles `A_owner` PASS / `A_cashier` 42501 denied / `A_branch_manager` PASS / `A_viewer` PASS + `WHERE branch_id` derivable.
4. **Remaining NOT EVIDENCED items:** See §10 — DEC-09 v2 shape / `R094` through `post_pos_sale` / drawer UX / analytics / stale-reconciliation; DEC-TTL age distribution / 30/60/90-day replay / 500/1000/2000 browser perf / lease+TTL race / prune auto; OFFLINE.CONFLICT terminal lived / v2 matrix / `updated_at` spec; BILLING builder/payroll/legacy under quota / concurrent race / RLS divergence; AI.BRANCH disposable prototype / `R11` branch / `P8` — each labeled `MORE EVIDENCE REQUIRED` vs `IMPLEMENTATION REQUIRED` vs `NOT EVIDENCED — NO CUSTOMER POPULATION INFERENCE PERMITTED`.
5. **Confirmation no product behaviour changed:** No application code/migration/SQL/RLS/Edge/AI/billing/quota/queue/branch/test/CI/package/schema changed; only this single P4 report was committed; disposable `p4_evidence.mjs` deleted before completion.
6. **Explicit owner decisions now required from Alexander:** 15 questions as in §11 (Q1–Q15) — **all OPEN — OWNER DECISION REQUIRED** — do NOT fill, do NOT rank, do NOT implement until Alexander supplies explicit decisions.

