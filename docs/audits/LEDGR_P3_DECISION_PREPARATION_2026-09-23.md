# LEDGR — P3 DECISION-PREPARATION DOCUMENT

**Date:** 2026-09-23
**Baseline:** `b8f3f00` (dirty working tree at `2e0ede3` + all R00–R12/R09.3/P-D4/R09.4/R10/R13 work)
**Release evidence at baseline:** **740 PASS / 0 FAIL / 40 BLOCKED / 780 records**, two byte-identical gate runs (local)
**Class:** Analysis only — no product code, migration, RLS, policy, or implementation selected
**Scope:** Authorized P3 only — DEC-09 (stale payload-version), Queue TTL / Backlog Horizon, OFFLINE.CONFLICT, BILLING.SERVER-QUOTA, AI.BRANCH

---

## 1. Current Baseline and Evidence References

| Artifact | Location | State at `b8f3f00` |
|---|---|---|
| R09.2 provenance/lease/quarantine | `src/offline/provenance.ts`, `lease.ts`, `queueApi.ts`, `db.ts` + `tests/release/offline.test.ts` `R09.QUEUE.*` | `QUEUE_PAYLOAD_VERSION = 1`, `originUserId/originDeviceId/capturedAt/payloadVersion/payloadHash` captured at enqueue via `buildProvenance`/`captureContext`/`hashQueuePayload`; `hasTrustworthyProvenance` requires `payloadVersion != null && originUserId string && capturedAt string`; `replayViolation` quarantines `missing-provenance` / `actor-mismatch`; `exceptionClass` present → skip actor-mismatch quarantine for Model 4 recovery |
| R09.3 Model 3 + 4 | `src/offline/exceptions.ts`, `reconciliation.ts`, `supabase/migrations/20261002000000_r093_offline_reconciliation.sql` + `tests/release/r093-reconciliation.test.ts` `R093.*` (19 records) | `23514` with `chk_inventory_balances_on_hand_nonneg` → `stock-denied`, `P0QLT` → `policy-denied` (R10), all other codes → ordinary `failed`; `reconcile_offline_queue_item` replays original payload under original `clientKey` through `post_pos_sale` with fresh server validation |
| Queue persistence / TTL | `src/offline/db.ts`, `queueApi.ts` (`MAX_PENDING_QUEUE_ITEMS=2000`, `STALE_SYNC_CLAIM_MS=120000`, `pruneSyncedItems(7d)`) + `src/hooks/useSyncQueue.ts` | No TTL for pending/failed/quarantined; `pending+failed+stale-syncing` counted; `MAX_PENDING` hard cap at enqueue; `recoverStaleSyncClaims` returns `syncing`>2m to `pending`; `pruneSyncedItems` default 7d, never auto-invoked except manual |
| Browser evidence R09.4 | `tests/browser/*`, `tests/release/r094-*.test.ts` | Real Chromium, real PWA build, real SW lifecycle; `R094.BROWSER.STALE-VERSION-MEASURE` measured `payloadVersion 0` and `9999` still pass provenance gate and replay (no policy), legacy `payloadVersion null` → `missing-provenance` quarantine |
| Quota contract R10 | `src/lib/billing/quotaContract.ts`, `UsageService.ts`, `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` | `_ledgr_assert_usage_limit(business_id)` counts `invoices(issue_date)+expenses(expense_date)+payroll_runs(pay_date)` month-start→today, compares to `plan_tier` (free 50, starter 200, growth 500, pro 2000, enterprise null), raises `P0QLT` with detail/hint; called inside `post_pos_sale`, `save_quick_sale`, `save_quick_expense` posting transactions; client `UsageService` does look-ahead via `ledgr_monthly_document_count` + table counts fallback, maps `P0QLT` → `policy-denied` |
| AI boundary | `supabase/migrations/20260927000000_r03_ai_context_authorization.sql`, `src/hooks/usePermissions.ts` `canViewReports` | `ai_context(business_id)` revoked from `public`/`anon`, requires `auth.uid()` + active membership + role in `v_reports_roles` (`owner,admin,accountant,manager,sales_manager,tax_compliance_officer,treasury_manager,asset_manager,board_member,auditor,viewer,branch_manager`); `service_role` null-uid path preserved for Edge; R03 report complete, `AI.BRANCH` remains decision-gated |
| Release harness R13 | `tests/release/database.mjs`, `gate.mjs`, `fixtures.ts`, `bootstrap.sql` | Single-connection `createDatabaseFixture` (one `pg.Client` per suite, `asRole` wraps `BEGIN; set_config; SET LOCAL ROLE; query; ROLLBACK/COMMIT`); `evidenceExit` 0=PASS,1=FAIL,2=BLOCKED; 18 suites registered; `R06.POS.STOCK.CONCURRENT` blocked on single-connection limitation |

**Evidence already available:** 740 PASS records pin all above contracts deterministically (two byte-identical runs). 40 BLOCKED remain, including `OFFLINE.CONFLICT` (no record), `BILLING.SERVER-QUOTA` (command/entitlement contract), `AI.BRANCH`, and the single-connection `R06.POS.STOCK.CONCURRENT`.

**Evidence still missing for decisions:** See each decision §3–§7.

---

## 2. Decision Register

| ID | Title | Status | Required Before | Owner Field |
|---|---|---|---|---|
| DEC-09 | Stale `payloadVersion` policy | **UNDECIDED** | Implementation (payloadVersion>1 ships) / Release (if stale data risk) | §3, left UNDECIDED |
| DEC-TTL | Queue TTL / Backlog Horizon | **UNDECIDED** | Implementation (before any expiry code) / Release (if backlog risk) | §4, left UNDECIDED |
| DEC-CONFLICT | `OFFLINE.CONFLICT` contract | **UNDECIDED** | Implementation (before conflict resolver ships) / Release (if conflict UX needed) | §5, left UNDECIDED |
| DEC-QUOTA | `BILLING.SERVER-QUOTA` authoritative coverage | **UNDECIDED** | Implementation (before wiring invoice-builder/payroll) / Release (if asymmetric quota is release-blocking) | §6, left UNDECIDED |
| DEC-AI-BRANCH | AI/reporting branch scope | **UNDECIDED** | Implementation (before branch-aware AI) / Release (if AI branch is release-blocking) | §7, left UNDECIDED |

No winner, score, ranking, or priority selected.

---

## 3. DEC-09 — Stale Payload-Version Policy

### 3.1 Current Contract

* `src/offline/provenance.ts:19` — `QUEUE_PAYLOAD_VERSION = 1` (single integer, written at enqueue via `buildProvenance`).
* `hasTrustworthyProvenance` — **only checks `payloadVersion != null`**, not `=== 1`. Any non-null version (0, 1, 9999) is treated as trustworthy if `originUserId` + `capturedAt` present.
* `sweepUnverifiableItems` — only `missing-provenance` when `payloadVersion == null` (v1 rows, legacy `payloadVersion: null`). No stale check.
* `reconciliation.ts` — `isReconcilable` checks `RECONCILABLE_EXCEPTION_CLASSES` + `payloadHash` + lease, not version.
* `db.ts:277` migration — v1 rows keep `payloadVersion null` intentionally, never fabricated.

**Result:** At `b8f3f00`, stale, current, and unknown-future versions are **indistinguishable** at the replay gate. The codebase contains no `stale-version` exceptionClass (referenced only as placeholder in `db.ts` comment for `exceptionClass?: 'stock-denied'|'policy-denied'|...`).

### 3.2 What Browser Evidence Actually Demonstrated

`tests/release/r094-browser.test.ts:637` `R094.BROWSER.STALE-VERSION-MEASURE` — **MEASUREMENT ONLY, feeds DEC-09, no policy decided**:

* Created three queue items under Version A, then mutated:
  * `payloadVersion = 0` (stale) → still **passes** `hasTrustworthyProvenance`, still replayable
  * `payloadVersion = 9999` (unknown-future) → still passes, still replayable
  * `originUserId/originBranchId/.../payloadVersion/payloadHash = null` (legacy no-provenance) → quarantines `missing-provenance` (visible, durable, never retried, never reconcilable)
* Proved: current engine has **no version gate**; provenance completeness is the only gate.

`R094.BROWSER.SW.QUEUE-PROVENANCE` and `PERSIST-RESTART` further proved byte-identical preservation of `payloadVersion/payloadHash` across SW update and real browser restart — the fields are durable, just not enforced.

### 3.3 Stale-Version Cases Observed / Measured

* **Case 0 — Stale (older than current):** `payloadVersion = 0` when current is `1`. Simulated by editing a v1 row to 0. Measured: still replayable.
* **Case 1 — Current:** `payloadVersion = 1`. Normal path, 740 PASS.
* **Case 2 — Unknown-future:** `payloadVersion = 9999`. Simulated future schema that current code does not understand. Measured: still replayable (no forward-compatibility guard).
* **Case 3 — Missing (null):** `payloadVersion = null` (pre-v2 or legacy). Measured: quarantined, never reconcilable via `missing-provenance`.
* **Not observed:** real migration-induced stale (no v2 has shipped), so no natural stale traffic exists yet.

### 3.4 Consequences of Accepting vs. Rejecting Stale Payloads

| Option | Behavior | Pros | Cons / Risks |
|---|---|---|---|
| **A. Accept all non-null versions (current behavior, keep)** | `0` and `9999` replay like `1` | Zero code, maximal forward/backward compatibility; no surprise denials for users on old app versions | Future schema changes could be silently misinterpreted; a stale payload could post with wrong financial meaning and still pass every server check (server re-derives stock/branch but not, e.g., a new required field) |
| **B. Reject stale (old) as typed exception** | `payloadVersion < QUEUE_PAYLOAD_VERSION` → quarantine `stale-version` (integrity-like: visible, never retried, not reconcilable unless policy says otherwise) | Protects against old clients posting obsolete shapes; forces update before sync | User on old version loses offline queue until update; needs UX for `stale-version` drawer + guidance; needs decision whether `stale-version` is reconcilable (see §3.5) |
| **C. Reject unknown-future as typed exception** | `payloadVersion > QUEUE_PAYLOAD_VERSION` → quarantine `unknown-version` | Prevents current code from handling data it doesn't understand; fail-closed | Same UX cost as B, but for rolled-forward clients (e.g., beta); frequent if version bumps often |
| **D. Typed exception for both directions (B+C)** | Any `payloadVersion != QUEUE_PAYLOAD_VERSION` → typed exception | Strictest, fully version-locked | Most disruptive; requires version-negotiation UX |

All options preserve `missing-provenance` (null) as quarantine — that contract is already final.

### 3.5 Interaction with R09.3 Model 3 + Model 4

* **Model 3 (typed exceptions):** Today only `stock-denied` (`23514` on `chk_inventory_balances_on_hand_nonneg`) and `policy-denied` (`P0QLT`) are typed. Adding `stale-version` / `unknown-version` would be a third/fourth typed class, with the same semantics: `failed` + `exceptionClass` + visible drawer + **not blind-retried**, optionally reconcilable.
* **Model 4 (reconciliation):** `reconciliation.ts` filters `RECONCILABLE_EXCEPTION_CLASSES = ['stock-denied','policy-denied']`. If stale is made an exception, the owner must decide:
  * Should `stale-version` be reconcilable at all? (Risk: reconciling a stale payload replays *old shape* under fresh server validation — server still re-derives branch/stock but cannot invent missing fields.)
  * If reconcilable, must the reconciliation **re-hydrate** the payload to current version or **require new capture**? Current `reconcile_offline_queue_item` replays *original* payload under *original* `clientKey` — a changed transaction is a new capture by design (see P-D3 decision). So stale reconciliation would either be impossible (quarantine forever) or require a migration of the payload.
* **Integrity:** Stale is not tampering (`payloadHash` still verifies), so it would not be `payload-tampered` (also non-reconcilable). It needs its own class.

### 3.6 Whether Stale Should Remain Replayable, Become Typed Exception, or Require Another Policy

**Options remain UNDECIDED.** The document does not select.

* Remaining replayable: minimal change, but needs risk acceptance for future schema drift.
* Typed exception: needs new `exceptionClass`, `exceptionDetails`, drawer copy, `RECONCILABLE` list decision, and migration for `offline_queue_reconciliations` CHECKs.
* Another policy: could be *soft* — e.g., allow stale but surface warning, or auto-quarantine only after TTL, or allow stale for `N` days.

### 3.7 What Must Happen to Newer/Unknown Versions

Same UNDECIDED. Unknown-future is the forward-compatibility dual of stale. The current measurement shows it would be accepted. A policy must explicitly address it; silent acceptance is itself a policy choice.

### 3.8 Minimum Evidence Required Before Implementation

* Real v2 payload shape (field added/removed/renamed) to evaluate actual drift risk.
* `R094.BROWSER.STALE-VERSION-MEASURE` extended to post a stale payload through `post_pos_sale` and observe server handling (today it only checks `hasTrustworthyProvenance`, not server replay).
* UX probe: drawer copy for `stale-version` vs. `missing-provenance` distinction.
* Performance/compatibility: how many clients realistically stay on old version (analytics).
* Decision on reconciliability (see §3.5) with a deterministic test for stale-reconciliation.

**Owner decision field — DEC-09:** ☐ Accept stale  ☐ Reject stale  ☐ Reject unknown-future  ☐ Both  ☐ Other — **UNDECIDED**

---

## 4. Queue TTL / Backlog Horizon

### 4.1 Current Queue Persistence Behavior

* **Storage:** `src/offline/db.ts` Dexie `ledgr-offline` IndexedDB, table `queue` with indexes `status,businessId,clientKey`. No server-side queue; purely local.
* **Lifecycle:**
  * `enqueue` → `pending` with `clientKey = crypto.randomUUID()`, `sequence = last+1`, `createdAt = now`, `attemptCount=0`
  * `syncQueue` → selects `pending,failed` (plus `stale syncing` via `recoverStaleSyncClaims`), marks `syncing` + lease, attempts `syncItem`, on success `synced` + `resolvedServerId`, on failure `failed` + `exceptionClass?`, on quarantine `quarantined` (never retried)
  * `quarantined` → held forever, visible in drawer, never auto-deleted
  * `synced` → kept for 7d by `pruneSyncedItems(olderThanMs=7d)` (manual, not auto on every sync; `useSyncQueue` does not call it automatically)
* **Caps:** `MAX_PENDING_QUEUE_ITEMS = 2_000` — enqueue throws `Offline queue is full` if `pending+failed+stale-syncing >=2000`. No time-based expiry.
* **Stale claim:** `STALE_SYNC_CLAIM_MS = 120_000` (2m) — `syncing` items older than 2m are returned to `pending` via `recoverStaleSyncClaims` (tab crashed).
* **Backpressure:** `getPendingCount` counts `pending+failed+staleSyncing`; UI badge shows it; no automatic eviction.

### 4.2 Age / Backlog Risks

* **Unbounded time:** A `pending` sale from 6 months ago remains `pending` forever, still replayable with old `payloadVersion`, old `branch/shift` context, old `stock` expectations that are now invalid (R06 will deny 23514, but the user sees a stale drawer entry for months).
* **Size:** 2000 items × ~5KB payload + hash ≈ 10 MB IndexedDB; plus Dexie overhead; plus `syncQueue` iterating all `pending/failed` each pass (`where('status').anyOf('pending','failed').toArray()` then sequential `syncItem`). Backlog of 1000+ will be slow and battery-heavy.
* **Provenance drift:** `originUserId` may no longer be active, `originShiftId` closed, `originBranchId` renamed — provenance still gates replay, so old items may become permanently `actor-mismatch` quarantined but never cleaned up.
* **Reconciliation backlog:** `failed` with `stock-denied/policy-denied` stays `failed` forever unless a manager reconciles; with no TTL, the manager's drawer grows unbounded.

### 4.3 Interaction with Provenance, Leases, Reconciliation

* **Provenance:** `sweepUnverifiableItems` quarantines `missing-provenance`/`actor-mismatch` regardless of age; `TTL` would be an additional, orthogonal gate. If TTL quarantines, it must not overwrite provenance's `quarantineReason` without evidence.
* **Leases:** `lease.ts` `LEASE_TTL_MS = 30_000` (30s) per-item, plus `claimLease` DB transaction. A TTL that deletes a `syncing` item while leased would race with lease expiry; deletion must respect lease or explicitly release it.
* **Reconciliation:** `reconciliation.ts` `isReconcilable` requires `status==='failed' && exceptionClass in ['stock-denied','policy-denied']`. A TTL that moves `pending`→`failed` or `quarantined` changes reconcilability. If TTL deletes, the server `offline_queue_reconciliations` audit row must not be deleted (it is append-only, `SELECT` policy only).

### 4.4 Consequences of Expiry

| Expiry Design | Effect | Evidence Preserved? | User Impact |
|---|---|---|---|
| No expiry (current) | Queue grows forever until manual delete or `MAX_PENDING` hit | Yes, forever | Drawer clutter; old failures never cleared; no data loss but no hygiene |
| Expiry → quarantine (`expired` reason) | Time exceeded → `quarantined` + `quarantinedAt`, visible, never retried | Yes, visible | Similar to provenance quarantine; needs drawer copy distinct from `missing-provenance` |
| Expiry → fail | Time exceeded → `failed` (no exceptionClass) | Payload preserved, but would be retried forever | Bad: creates infinite retry loop |
| Expiry → delete | Time exceeded → `offlineDB.queue.delete` | **No** — financial evidence lost | Risky: user cannot see what was dropped; conflicts with R09.2 preservation |
| Expiry → require new capture | Delete + toast “re-create transaction” | No, but intentional | Needs UX that guides re-capture with fresh context |

All but "no expiry" require a new `quarantineReason` or `exceptionClass` and drawer handling.

### 4.5 Whether Expiry Should Quarantine, Fail, Reconcile, or Require New Capture

**UNDECIDED.** The decision must choose among the rows above, plus the threshold.

### 4.6 Evidence Needed to Select TTL

* Age distribution of real queues (analytics: p50/p95 `createdAt` lag for `pending`).
* `R094.BROWSER.PERSIST-RESTART` extended to measure 30/60/90-day-old items' replay through `post_pos_sale` (do they still 42501/23514 correctly?).
* Backlog performance: `syncQueue` duration with 500/1000/2000 items (local measurement).
* Lease interaction test: `syncing` item with lease + TTL expiry race.
* Pruning: `pruneSyncedItems` manual vs. automatic invocation policy.

**Owner decision field — DEC-TTL:** TTL ☐ none  ☐ 7d  ☐ 30d  ☐ 90d  ☐ other ___ ; Disposition ☐ quarantine  ☐ delete  ☐ fail  ☐ new capture — **UNDECIDED**

---

## 5. OFFLINE.CONFLICT

### 5.1 Conflict Classes Found in Existing Evidence

| # | Class | Current Server Behavior | Current Client Behavior | R09.3 Covers? | Safe for Model 4 Reconciliation? | Must Remain Non-Reconcilable? | Evidence Still Required |
|---|---|---|---|---|---|---|---|
| 1 | **Duplicate / idempotency** (`clientKey` already committed) | `post_pos_sale` returns original `id` + `idempotent:true`, no second invoice/movement/journal (see `R06.POS.STOCK.REPLAY`, `R093.RECON.IDEMPOTENT-LOST-ACK`) | `syncEngine` treats `idempotent:true` as success (`synced`), `reconciliation.ts` handles idempotent replay via `post_pos_sale` key (see `IDEMPOTENT-LOST-ACK`) | Yes, pinned | Yes — reconciliation is idempotent by design (original key) | No | None (deterministic, two-connection proven) |
| 2 | **Stale document state** (e.g., invoice edited after offline capture) | No server stale check for invoices; `post_pos_sale` creates new document, not patching existing | `payloadHash` detects local edit → `payload-tampered` quarantine before network (see `R093.TAMPER.*`) | Partial — tamper, not server stale | No — `payload-tampered` is integrity, never reconcilable (client+server `22023`) | Yes | Server stale check not implemented; needs spec |
| 3 | **Stock conflict** (collective exceed `on_hand`, `23514`) | `trg_stock_movement_apply_balance` `SELECT ... FOR UPDATE` on `inventory_balances` + `CHECK chk_inventory_balances_on_hand_nonneg` → `23514` denial, full-row rollback (incl. invoice/payment/journal) | `classifyReplayException` `23514` on that constraint → `stock-denied`, `failed`, not retried, visible; `reconcile` replays original via `post_pos_sale` with fresh stock check | Yes | Yes — `stock-denied` is the Model 4 exemplar (`R093.RECON.STOCK-RESOLVED`, `CLOSED-SHIFT-LATE-ARRIVAL`) | No | True concurrency: see P2a `R06.POS.STOCK.CONCURRENT-TRUE` (new) |
| 4 | **Shift/till conflict** (shift closed, wrong till, `DEC-08`) | `post_pos_sale` branch `v_branch_resolved = coalesce(payload.branch, shift.branch)` (D-4, `20260930000001`), closed-shift late arrival → append-only `pos_shift_late_adjustments`, re-close denied `22023` (see `R08.SALE.LATE-ARRIVAL-BOUND`) | `R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL` pins Model 4 late arrival | Yes | Yes | No | None |
| 5 | **Tenant/branch conflict** (payload `branch_id` not in `can_access_branch`, or foreign `product_id`, `42501`/`22023`) | `post_pos_sale` steering: terminal branch vs. shift branch vs. payload branch; foreign product → `22023` via `20261003000000_r06_pos_product_tenant_validation.sql` `checkPosLineProductsBelongToBusiness`; non-member → `42501` (`can_write_sales_data` / `can_operate_pos`) | `R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN` → ordinary `failed`, no exceptionClass, zero mutation | Yes (authority, not typed exception) | No — authority classes are never typed exceptions, never reconcilable as exceptions (see `R093.RECON.INTEGRITY-REFUSED` `42501`/`22023`) | Yes (integrity) | None |
| 6 | **Payload-version conflict** | No check (see §3) — any non-null version passes | No client check — any non-null passes | No | UNDECIDED (depends on DEC-09) | UNDECIDED | P2a not needed; needs DEC-09 decision |
| 7 | **Already-posted document/key** (clientKey exists, but payload differs) | `post_pos_sale` checks `payloadHash`? No — it checks `client_key` existence and returns `idempotent` without payload comparison; tampered payload with same key would be treated as replay (current behavior allows duplicate key with different payload to return original, not new) | `reconciliation.ts` payload identity check (`payload business/client_key` must match request) would refuse mismatched payload locally | Partial — reconciliation guards, normal replay does not | No — tampered is `payload-tampered` quarantine | Yes (tamper) | Need test: same `clientKey` + different `line_total` → what should server do? |
| 8 | **Quota conflict** (`P0QLT`) | `_ledgr_assert_usage_limit` inside `post_pos_sale` / `save_quick_*` → `P0QLT` denial, full rollback | `classifyReplayException` `P0QLT` → `policy-denied`, not retried, `reconcile` re-validates quota (see `R093.RECON.POLICY-REVALIDATION`) | Yes | Yes — `policy-denied` is reconcilable (fresh quota check) | No | Asymmetric coverage: see §6 |

### 5.2 For Each Class — Summary

* Server is authoritative for 1,3,4,5,8; client is authoritative (quarantine) for 2 (tamper) and 5 (provenance); 6 and 7 are **currently not server-checked** (gaps).
* R09.3 covers 1,3,4,5,8 as either typed exception or ordinary authority denial; it explicitly does **not** cover 2 (tamper is separate integrity) and **not** 6/7.
* Model 4 reconciliation is **safe** for 1,3,4,8 (stock, late arrival, quota, duplicate) — they are replay-accepted via original key with fresh validation. It is **unsafe / prohibited** for 2,5 (tamper, branch/tenant authority, `payload-tampered`/`legacy`/`actor-mismatch`/`missing-provenance` — both client `replayViolation` and server `22023` before audit).
* 6 and 7 need policy decisions before reconciliation can be declared safe.

### 5.3 Evidence Still Required (OFFLINE.CONFLICT)

* Same-`clientKey` + different payload server test (class 7) — is idempotent return correct when payload is tampered?
* Version-gated conflict matrix (class 6) — see §3.8.
* Stale-document server check — does `post_pos_sale` need `updated_at` comparison?

**Owner decision field — DEC-CONFLICT:** Contract ☐ typed exceptions only for stock/quota  ☐ add version/tamper/stale  ☐ other — **UNDECIDED** ; Reconciliation scope ☐ current (stock/quota only)  ☐ expand to version  ☐ never expand — **UNDECIDED**

---

## 6. BILLING.SERVER-QUOTA

### 6.1 Current P0QLT Contract

* Server declaration: `supabase/migrations/20261001000000_r10_typed_quota_contract.sql` — `_ledgr_assert_usage_limit(business_id)` counts month-start documents, raises `P0QLT` with unchanged human message + `DETAIL`/`HINT`.
* Client contract: `src/lib/billing/quotaContract.ts` — `QUOTA_DENIAL_SQLSTATE = 'P0QLT'`, `isQuotaDenial` checks `code === 'P0QLT'` only, never message text; `QUOTA_DENIAL` takes precedence over stock in `classifyReplayException`.

### 6.2 Currently Server-Metered Operations

* `post_pos_sale($1::jsonb)` (POS sales, 3 journals)
* `save_quick_sale($1::jsonb)` (quick income, via `saveQuickSaleViaRpc`)
* `save_quick_expense($1::jsonb)` (quick expense, via `saveQuickExpenseViaRpc`)

All three call `_ledgr_assert_usage_limit` **inside the posting transaction**, so the denial is atomic with the document (see `snapshot` hash checks in `R06.POS.*.ATOMIC-FAILURE`).

### 6.3 Operations Still Using Client Look-Ahead

* `UsageService.getCurrentMonthTransactionCount` — first tries `supabase.rpc('ledgr_monthly_document_count')` (server count, RLS-immune), fallback to three `head:true` counts on `invoices`/`expenses`/`payroll_runs` as the signed-in user.
* `assertCanCreateDocument` — called in `syncEngine` *before* `repos.invoice.createWithLines` for the legacy income/invoice path, but the legacy path still has server assert inside the RPC, so a look-ahead miss still reaches `P0QLT`.
* **Gaps (no server assert observed):**
  * `repos.invoice.createWithLines` / `createWithLines` legacy income path when `save_quick_sale` not used? Actually it does `await usageService.assertCanCreateDocument` then `createWithLines` — the latter does **not** call `_ledgr_assert_usage_limit` directly; the quota check is only the client look-ahead, not a server transaction assert. So a concurrent race or stale look-ahead could allow an over-limit legacy invoice.
  * `BusinessRepository.reserveDocumentNumber` + `repos.invoice.createWithLines` for non-quick invoices/expenses not via `save_quick_*` — same gap.
  * Any direct `supabase.from('invoices').insert` outside the queue (e.g., invoice builder UI) — client look-ahead only if the UI calls `UsageService`, otherwise no check.
  * `payroll_runs` creation — counted but no RPC wrapper with assert seen in `PayrollRepository`.

### 6.4 Invoice-Builder / Payroll Gaps

* **Invoice builder:** `grep -rn "save_quick" src` covers quick flows; the full `InvoiceRepository.createWithLines` for draft/builder invoices (status `draft`, with discounts/VAT) does not go through `save_quick_sale` and thus not through `P0QLT`. The release suite `R10.QUOTA.*` only covers `post_pos_sale` + `save_quick_*`.
* **Payroll:** `payroll_runs` table is counted in `v_usage` but no `save_quick_payroll` RPC with `_ledgr_assert_usage_limit` was found in the codebase at `b8f3f00`. Payroll runs are likely via `PayrollRepository` direct inserts.

### 6.5 Risks of Asymmetric Quota Enforcement

* **User on free tier (50) via POS (metered) is correctly denied `policy-denied` after 50, while the same user via invoice builder could exceed 50 via unmetered path — same business, different enforcement.**
* **Offline replay vs. online:** `post_pos_sale` is metered, so offline POS is correct, but offline `invoice`/`expense` queue items of type `income`/`expense` that fall back to legacy `createWithLines` (when `vat>0` etc.) are look-ahead only.
* **Tenant isolation:** `ledgr_monthly_document_count` is `security definer` but the fallback table counts are RLS-filtered; a role without `payroll_runs` read could see quota as not exceeded and be allowed, then be server-denied later (inconsistent UX).

### 6.6 Interaction with Offline Replay / Reconciliation

* **Replay:** `policy-denied` items are not retried; they sit `failed` until a manager reconciles via `reconcile_offline_queue_item` → `post_pos_sale` with fresh quota check (`R093.RECON.POLICY-REVALIDATION` proves `P0QLT` on reconcile when limit still applies).
* **Asymmetry means:** a `policy-denied` from POS is correct, but a `failed` from invoice builder due to look-ahead miss might be incorrectly retried as ordinary `failed` (no `P0QLT`), not as `policy-denied`.
* **Quota limit change:** If plan upgrades from `free→pro`, a `policy-denied` item remains `failed` until manual reconcile — no auto-retry on plan change.

### 6.7 Release-Readiness Implications

With asymmetric enforcement, **release is not quota-consistent**: a customer could be billed or blocked differently per entry surface. The `R10.QUOTA.*` 7 PASS records prove the *declared* contract but not coverage. The original gate's `BILLING.SERVER-QUOTA` and `FIN-A` remain honest `BLOCKED`.

### 6.8 Evidence Still Missing

* Call-site grep + runtime test: `invoice-builder` full flow (create draft → post) under quota pressure, expect `P0QLT` but observe `P0001` or success.
* Payroll run under quota, expect `P0QLT`.
* Legacy `income` with `vat>0` under quota, expect `P0QLT`.
* Concurrent two-connection quota race (quota ≈ stock concurrency, also `FOR UPDATE`? but quota counts, not locked row).

**Owner decision field — DEC-QUOTA:** Coverage ☐ only `post_pos_sale` + `save_quick_*` (current)  ☐ also `createWithLines` legacy + invoice builder + payroll (uniform)  ☐ other — **UNDECIDED** ; Command contract ☐ quota is per-transaction assert only  ☐ also entitlement/command `approve` — **UNDECIDED**

---

## 7. AI.BRANCH

### 7.1 Current R03 AI Authorization Boundary

* `supabase/migrations/20260927000000_r03_ai_context_authorization.sql` — `ai_context(business_id)`:
  * Revoked `EXECUTE` from `public`/`anon`, granted to `authenticated`/`service_role`
  * Guard: `auth.uid() is null && role != 'service_role'` → `42501`; not active member → `42501`; active member but role ∉ `v_reports_roles` → `42501`
  * `v_reports_roles = ['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager']` — verbatim `canViewReports=true` in `src/hooks/usePermissions.ts`
  * Roles excluded: `cashier,stock_clerk,sales_clerk,data_entry,supervisor,inventory_manager,payroll_manager,purchasing_officer,warehouse_worker,customer_service_rep` cannot call `ai_context` even in own business.

### 7.2 Current DEC-03 Branch Policy

* Till family: `R08.*` proves `can_access_branch(business_id, branch_id)` predicate: org-wide roles (`owner,admin,accountant,manager,auditor,viewer,board_member,treasury_manager,asset_manager,tax_compliance_officer`) read all branches; assigned roles (`cashier,branch_manager,sales_clerk,...`) restricted to `business_users.branch_id` (or `null` = org-wide). `R08.SHIFT.*` probes enforce branch-scoped shift/report visibility.
* Non-till `BRANCH.*` (8 records `create/modify/read/reports/financial/inventory/customers/cross-branch-admin`) remain `BLOCKED` — org-wide `can_write_business_data` tier still allows `A1`-assigned writer to insert branch `A2` documents except via POS command (the `R08` exception). No per-surface branch remediation shipped.

### 7.3 What AI Data Is Currently Organization-Wide vs. Branch-Dimensional

* `ai_context` returns a **single business** document: `company, MTD KPIs, 12-month trend, overdue invoices, top expenses, top customers, concentration, anomalies, receivable/payable schedules` — all aggregated at `business_id`, not filtered by `branch_id`. No branch parameter exists on the RPC.
* Branch dimensional data exists in the warehouse (`invoices.branch_id`, `inventory_balances.location_id→branch`, `pos_shifts.branch_id`) but is **not** projected into `ai_context`.
* `AI.BRANCH` would require `ai_context(business_id, branch_id?)` or separate `ai_context_branch`.

### 7.4 What Branch-Aware AI Would Require

* **Contract:** `ai_context` signature change (new `branch_id` param) or new function `ai_branch_context`; branch predicate check (`can_access_branch`) before assembling branch-filtered KPIs.
* **Data:** branch-filtered views for `v_ai_revenue_invoices`, etc., already branch-scoped via `business_id` but not `branch_id`; need branch `WHERE`.
* **Auth:** same `v_reports_roles` but now per-branch: `cashier` in `A1` viewing `A1` AI? Currently `cashier` cannot view reports at all, but a branch-aware AI might be the *only* report a cashier should see (their branch). That diverges from `canViewReports` and needs a new policy.

### 7.5 Whether AI Branch Scope Can Safely Be Implemented Under Existing Architecture

* **Technically yes** — `can_access_branch` already exists and is used by `R08`/`R03`; adding a branch param and filtering is mechanical.
* **Policy risk:** The broader `BRANCH.*` remediation is not done (8 escapes). Shipping `AI.BRANCH` before `BRANCH.*` remediation would give branch-scoped AI while branch-scoped *writes* are still org-wide — confusing: AI would say "A1 sales 10" but a cashier in `A1` could still create an invoice for `A2`.
* **Dependency:** Safer after `BRANCH.*` remediation (P8) so AI branch scope and write branch scope are coherent.

### 7.6 Dependencies on Broader `BRANCH.*` Remediation

* `BRANCH.*` P8 requires `DEC-03` completion (one-vs-multi assignments, carve-outs). `AI.BRANCH` depends on `DEC-03` as well.
* If `AI.BRANCH` ships before `BRANCH.*`, it should be explicitly scoped as **read-only, non-authoritative branch filter**, not as branch remediation.

### 7.7 Evidence Still Missing

* Branch-filtered `ai_context` prototype + `R11` metric-consistency lane (permission-aware AI metric consistency, branch excluded per gate's P4 carve-out).
* `R08.BRANCH.*` remediation package (P8) completion.

**Owner decision field — DEC-AI-BRANCH:** Branch scope ☐ org-wide only (current)  ☐ optional branch filter (read-only)  ☐ mandatory branch dimension  — **UNDECIDED** ; Timing ☐ after `BRANCH.*` (P8)  ☐ before  — **UNDECIDED**

---

## 8. Security / Data-Integrity Implications (Cross-Cutting)

| Decision | Confidentiality | Integrity | Availability |
|---|---|---|---|
| DEC-09 stale vs unknown-future | Accepting future leaks no data, but may misinterpret fields | Accepting stale risks wrong financial posting (old shape) | Rejecting both maximizes correctness but hurts offline availability for old clients |
| Queue TTL | Deleting loses financial evidence (violates R09.2 preservation) | Quarantine preserves evidence; fail-loop hurts integrity (infinite retry) | No TTL maximizes availability but risks unbounded growth |
| OFFLINE.CONFLICT 7 (same key, different payload) | No leak | Idempotent return of original with tampered payload hides tampering | Blocking tampered preserves integrity |
| BILLING.SERVER-QUOTA asymmetry | Quota count via `payroll_runs` may be RLS-filtered → leak of usage (under-count) | Unmetered invoice builder can exceed limit → financial integrity / billing dispute | Metered POS correctly denies, but unmetered path allows overage → inconsistent availability |
| AI.BRANCH | Branch filter must enforce `can_access_branch` or leaks cross-branch KPIs to assigned user | Org-wide AI with branch writes still org-wide → AI misleads | Cashier cannot see any AI currently — availability gap if AI is branch-scoped |

---

## 9. Dependencies

```
R09.2 (provenance) ─┐
R09.3 (typed except)├─► DEC-09 (needs versioned payload shape)
R09.4 (SW/browser) ─┘

R09.2 ─┬─► Queue TTL (needs provenance+lease+reconcile interaction)
       └─► OFFLINE.CONFLICT (7 is tamper/version)

R10 (P0QLT) ──► BILLING.SERVER-QUOTA (needs uniform assert)

R03 (ai_context) + DEC-03 (branch) ──► AI.BRANCH
BRANCH.* (P8) ──► AI.BRANCH (coherence)

All ──► R15 Final Readiness
```

---

## 10. Timing — Required Before Implementation / Release / Deferrable

| Decision | Before Implementation | Before Release | Deferrable | Rationale |
|---|---|---|---|---|
| DEC-09 | Yes (before v2 ships) | If stale traffic exists | Yes until v2 | No natural stale exists; version gate code is trivial but policy is not. |
| DEC-TTL | Yes (before any expiry code) | If backlog risk is release-blocking (2000 cap may suffice for now) | Yes, current 2000 cap mitigates | Expiry is new behavior; needs threshold + disposition. |
| OFFLINE.CONFLICT | Yes (before resolver ships) | If conflict UX is release-blocking | Partial — classes 1,3,4 are already resolved; 6/7 can defer | Only 6/7 are gaps. |
| BILLING.SERVER-QUOTA | Yes (before wiring) | **Yes if uniform quota is release-blocking** — asymmetric is billing inconsistency | No if POS-only quota is accepted as release scope | Depends on pricing promise. |
| AI.BRANCH | Yes (before branch-aware AI) | If AI branch is promised at launch | Yes, org-wide AI is already shippable | Recommended after P8. |

---

## 11. Explicit Owner-Decision Fields — Left UNDECIDED

* DEC-09: ☐ Accept stale  ☐ Reject stale  ☐ Reject unknown-future  ☐ Both  ☐ Other ___  — **UNDECIDED**
* DEC-TTL: TTL ☐ none  ☐ 7d  ☐ 30d  ☐ 90d  ☐ other ___ ; Disposition ☐ quarantine  ☐ delete  ☐ fail  ☐ new capture — **UNDECIDED**
* DEC-CONFLICT: Contract ☐ typed only stock/quota  ☐ add version/tamper/stale  ☐ other ___ ; Reconciliation scope ☐ current  ☐ expand  ☐ never — **UNDECIDED**
* DEC-QUOTA: Coverage ☐ POS+quick only (current)  ☐ also legacy + builder + payroll (uniform)  ☐ other ___ ; Command ☐ per-transaction only  ☐ entitlement — **UNDECIDED**
* DEC-AI-BRANCH: Scope ☐ org-wide only (current)  ☐ optional branch filter  ☐ mandatory  ; Timing ☐ after P8  ☐ before — **UNDECIDED**

*No recommendation, score, ranking, or selected policy is provided. All fields await owner authorization.*

---

## 12. Audit Trail

* Baseline `b8f3f00` file hashes and 740/0/40/780 evidence preserved; this document is additive.
* Sources: `src/offline/*`, `tests/release/r094-browser.test.ts:637`, `supabase/migrations/20261001000000_r10_typed_quota_contract.sql:1`, `20260927000000_r03_ai_context_authorization.sql:1`, `tests/release/r06-stock.test.ts:256`, `docs/audits/LEDGR_POST_R093_READINESS_GATE_2026-09-23.md:§12`, `R09_DECISION_BUNDLE_2026-09-22.md`.
* No product code changed; no migration added; no RLS changed; no policy decided.

**P3 — COMPLETE**

> STOP: No product remediation, schema redesign, or P4–P10 implementation performed. Awaiting owner decisions on the five UNDECIDED fields above before any implementation package.

