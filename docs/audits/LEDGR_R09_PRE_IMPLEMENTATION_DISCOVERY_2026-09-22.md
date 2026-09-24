# LEDGR R09 — CACHE, QUEUE AND OFFLINE RECOVERY — DISCOVERY / PRE-IMPLEMENTATION REPORT

**Date:** 2026-09-22 · **Mode:** DISCOVERY ONLY (no implementation authorized or performed) · **Author:** Agent Mode (repository verification; every claim below is anchored to a file and, where stated, to executed release evidence)

**Preservation baseline (immutable, from R08 closeout):** release protocol ×2 → **652 PASS / 2 FAIL / 51 BLOCKED**, 705 records, 0 status diffs between repeats; unit 672/672; TS clean; lint 0 errors; build PASS. Remaining FAILs: `EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer` (R12-owned). R08 (.1–.7) is CLOSED and preserved exactly.

---

## 1. R09 objective

Per the readiness plan (line 151) and impact register §R09, R09 is **"Cache, queue and offline recovery" — High priority, confidentiality critical.**

The precise security/control problem, in three parts:

1. **Shared-device confidentiality of every local cache layer** (§12.3-6 of the architecture audit; test scenario T13). Cached financial HTTP responses and persisted query data can survive logout / user-switch / role-downgrade on a shared till device.
2. **Replay integrity of the offline operation queue** (T14). The queue is tenant-tagged but not originator-bound; replay is performed by *whoever is signed in at sync time*, under that person's session, with no cross-tab exclusivity and no durable crash boundary other than a 2-minute stale-claim heuristic.
3. **Visible, policy-controlled reconciliation of offline capture vs. stock / quota / closed-shift / payload-version boundaries** (T15, DEC-06/07/08/09). An offline-accepted sale that arrives after a stock/quote/shift boundary currently falls into "permanently failed" or "silently unadjusted" states.

**Trust boundary:** the browser is hostile/temporary; the server (RPC commands + RLS) is authoritative. Everything local (IndexedDB queue, React-Query persister, Workbox caches, legacy localStorage queue, form drafts) is *evidence to preserve*, never *authority to act on*.

**Relevant existing findings/records:**

| Finding / record | Where | R09 relevance |
|---|---|---|
| Audit §12.3 risks 4, 5, 6, 7, 8 | `LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md` | Core problem statements (cross-tab claim, actor-binding, shared-device cache, conflict policy, quota/shift stranding) |
| Impact register R09 §§1–9 | `LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md:612` | Pre-approved change narrative + risk register |
| Test scenarios T13, T14, T15 | readiness plan §8 | Acceptance semantics |
| Gate C-OFFLINE | readiness plan line 120 | R09 + inventory/quota/shift decisions gate offline marketing |
| `OFFLINE.*` records (11) | `tests/release/offline.test.ts` | Execution surface: **5 PASS, 6 BLOCKED** at R08 closure |
| DEC-06, DEC-07, DEC-09 (unsigned) | readiness plan decision register | Dependencies that gate most of R09's novel semantics |

## 2. Findings in scope

1. Workbox runtime caches (`ledgr-api-cache`, `/rest/v1/` NetworkFirst, 200 entries / 24h) retain financial GET responses across logout (`vite.config.ts:101-115`).
2. React-Query persister is tenant-partitioned but the partition includes *no user/role dimension* and is only partially cleared on `SIGNED_OUT` (`src/lib/queryPersister.ts`, `src/main.tsx:84-94` clears `ledgr_*` sessionStorage + persisted cache, not Workbox HTTP cache).
3. Offline queue (`src/offline/db.ts:QueueItem`) stores `businessId` but **no originating user/device principal**; `syncEngine.syncQueue` replays all pending/failed items under the *current* session (`src/offline/syncEngine.ts`).
4. No cross-tab exclusive claim: `useSyncQueue` uses an in-memory `inFlightRef` only; separate tabs can sync concurrently (unique `client_key` de-dupes documents but not all side effects, e.g. numbering reservations and non-keyed legacy journal paths).
5. Conflict metadata (`localUpdatedAt`) exists but is unused by the sync engine; there is no general conflict-resolution contract (only the narrow `updateIfUnchanged` primitive).
6. Legacy POS queue (`ledgr_pos_offline_queue` localStorage) migration at mount attributes entries to whoever next syncs => *ambiguous-ownership accepted*, contrary to the plan's "quarantine for assisted recovery" (§R09-4 of the register).
7. Offline-accepted sales stranded at quota (usage check at sync time via `usageService` in syncEngine, R10 dependency) / closed-shift (DEC-08 late-adjustment exists only for *shift-claiming* payloads; shift-less legacy payloads post branch-less with NO late-adjustment record) / stock (oversell undetected if DEC-07 unsigned).
8. Release-harness offline records: `OFFLINE.BROWSER`, `OFFLINE.ACTOR-BINDING`, `OFFLINE.CONFLICT`, `OFFLINE.MULTITAB` BLOCKED awaiting contracts/infra; `OFFLINE.REOPEN`, `OFFLINE.RETRY` BLOCKED by the migration-only grant profile (authenticated lacks direct invoice readback grants; R01 artifact — honest layer, not a product bug).

## 3. Findings explicitly OUT of scope (R08 separation preserved)

* The 8 `BRANCH.*` records remain **BLOCKED** — untouched by R09.
* The seven branch-isolation escapes + `BRANCH.reports` (R08.7 audit) and the `NULL branch_id` **row**-semantics DEC — separate scope. R09 does not absorb them. (Dependency note in §11: R09's actor-binding does NOT depend on them.)
* `EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer` — R12-owned FAILs; untouched.
* `R07.RECEIPT.DISPATCH` — BLOCKED; untouched.
* R10 quota-policy internals (DEC-05/06 patterns) — R09 consumes the *reconciliation* interface, does not redesign metering.
* Refund/void offline capture — R07 commands are not queueable today and stay so; any change there is a separate decision.
* Marketing UI claims about "every screen works offline" — §12.2 awareness only.

## 4. Dependency map to R00–R08

| Package | R09 may RELY on | R09 may CONSUME | Must remain UNTOUCHED |
|---|---|---|---|
| R00 | Env/seed discipline for repro | — | All R00 evidence |
| R01 | `authenticated` grant profile (the honest reason REOPEN/RETRY are BLOCKED) | Readback-grant findings | R01 migrations/records |
| R02/R03 | Decisions on identity provenance concepts | — | R02/R03 records |
| R04 | `is_business_member` RLS for cross-tenant queue rejection (proven by `OFFLINE.CROSS-TENANT-PRESERVE`) | Tier helpers for "who may replay" semantics | R04 policies |
| R05 | Journal balance/command invariants during replay; `posting_key` idempotency | Posting-key idempotency pattern for queue replay | R05 functions |
| R06 | Stock mechanics; non-negative-balance checks (DEC-07 target policy) | Stock-movement replay paths | R06 stock triggers |
| R07 | **R07 command byte-preservation**; `void/refund` NOT queueable (stays) | Receipt/dispatch exclusions | R06/R07 entire bodies |
| R08 | `post_pos_sale` replay-safe canonical path; DEC-08 `pos_shift_late_adjustments` (exists, line 344 of `20260930000001`); DEC-03 predicate; `pos_terminals` registry | Shift-claim + late-adjustment semantics for replayed sales | All R08 records/incidents/files; the legacy-path status quo is a DEC-09 decision point, not an R08 bug |

## 5. Exact affected surfaces (if implemented)

**Client (would change):**
`vite.config.ts` (Workbox runtimeCaching), `public/sw-events.js`, `src/main.tsx`, `src/hooks/useAuthListener.ts`, `src/lib/queryPersister.ts`, `src/lib/queryClient.ts`, `src/offline/{db,payloads,queueApi,syncEngine,legacyPosQueue,OfflineSyncProvider,registerServiceWorker,backgroundSync,offlineSyncContext}.ts(x)`, `src/hooks/{useSyncQueue,useOfflineQueue}.ts`, `src/components/layout/OfflineQueueDrawer.tsx`, `src/services/posService.ts` (queue payload build), `src/lib/billing/UsageService.ts` (reconciliation only).

**Local stores (would migrate):** Dexie `ledgr-offline.queue` (schema v2: versioned), `ledgr-rq-cache.cache`; Workbox `ledgr-api-cache`; legacy `ledgr_pos_offline_queue`; form/session drafts.

**Server (conditional, decision-gated):** possibly additive provenance columns on POS commands or a recovery-partition table — ONLY if the DEC bundle authorizes; no current implementation need is proven. No Edge-function changes identified (queue replays via existing RPCs).

**Tests (would touch):** `tests/release/offline.test.ts` (+new records), `src/offline/__tests__/*`, `src/services/__tests__/posSaleOfflineSync.test.ts`, `src/lib/__tests__/*`.

**Config/secrets:** none (PWA manifest metadata only). **Audit records:** `OFFLINE.*` (11), scenarios T13/T14/T15.

## 6. Existing controls — PROVEN vs ASSUMED

**Proven (server or executed harness evidence):**
- `client_key` unique de-dup + posting-key idempotency (`OFFLINE.REOPEN`/`RETRY` logic verified up to the readback-grant boundary; R05/R08 services replay-safe).
- Tenant isolation: `OFFLINE.CROSS-TENANT-PRESERVE` PASS — B's sale never syncs from A's session and is retained.
- Failure preservation: `OFFLINE.FAIL-PRESERVE`, `OFFLINE.STALE-CLAIM` (2-min claim recovery), `OFFLINE.STATES`, `OFFLINE.PRESERVE` PASS.
- Query persister: businessId-partitioned, 24h `maxAge`, `maxEntries` bound, no secrets persisted (code + unit coverage).
- Background sync wakes clients but never posts without an open client (`backgroundSync.ts`, §12.1).
- Logout clears persisted React-Query cache + `ledgr_*` sessionStorage (`main.tsx:84`).

**Assumed / NOT proven (do not trust):**
- Workbox HTTP cache is cleared or partitioned on logout/user-switch — NOT done; `ledgr-api-cache` survives `SIGNED_OUT`.
- Queue replay honors the *original* actor — impossible: no originator field exists; server sees only the current session.
- Cross-tab exclusivity — only an in-memory tab-local ref; no `navigator.locks`/BroadcastChannel lease.
- Conflict resolution — `localUpdatedAt` unused; no contract.
- Legacy localStorage entries quarantined — they are *migrated and attributed to the next syncer* instead.
- `OFFLINE.BROWSER` semantics (true browser close/SW kill mid-post) — no browser-runner infrastructure exists in the release harness.
- `Vary` behavior of Supabase REST responses w.r.t. authorization partitioning — untested.

## 7. Gaps and attack paths

1. **T13 cache leak** — user A signs out; user B signs in on the same till; B opens the app offline → previously cached `/rest/v1/` financial responses (invoices, statements) are served from `ledgr-api-cache` before any RLS check.
2. **T14a actor substitution** — cashier A's offline `pos_sale` (queued 16:55) syncs at 17:10 under cashier B's session → server binds the sale to B's open shift (`cashier_id = auth.uid()`), crediting B's drawer with A's sale. Nothing detects it; the correction trail requires R07.
3. **T14b cross-tab double pass** — two tabs sync the same pending item: `client_key` protects documents, but legacy numbering reservation and non-keyed side paths can burn/duplicate; claim state is racy.
4. **T15 boundary stranding** — quota exhausted / stock now negative / shift closed since capture: item flips to `failed` forever (or posts branch-less with no late-adjustment row) — invisible money + no reconciliation surface.
5. **Legacy attribution** — old localStorage POS entries are adopted by the next identity to open the app.
6. **Storage eviction** — browser storage is not a backup; no bounded-retention expectation UI exists (§12.3-10).

## 8. Required DEC / sign-off

**R09 cannot proceed as a whole under the existing register.** The plan itself gates C-OFFLINE on "inventory/quota/shift decisions". Required sign-offs:

1. **DEC-09 (queue payload versions + migration window) — MUST expand by one rider:** the *originating-actor contract* — (a) durable provenance fields on queued items (original uid/device/version) and (b) the server-side rule for replay under a different current actor (deny-and-quarantine vs. manager-transfer-with-evidence), plus the quarantine-vs-attach decision for legacy localStorage items.
2. **DEC-06 (offline quota/expiry)** — reconciliation path for quota-blocked offline-accepted sales (visible exception state, never silently retried forever).
3. **DEC-07 (offline stock policy)** — oversell/reconcile vs. restricted offline selling scope.
4. **NEW INFRA DECISION (small, can be bundled with DEC-09):** browser/SW evidence runner for the release harness (without which `OFFLINE.BROWSER`, true `T13` logout-privacy across layers, and tab-lease tests cannot be honestly executed). Options: Playwright-based ephemeral-browser suite vs. documented jsdom+fakes limitation with explicit residual-risk sign-off.

**Decision-free slice that CAN proceed independently:** none cleanly; even cache partitioning needs the small choice "wipe-all vs. partition by identity" (partitioning by supabase user id in cache naming is a behavior-preserving additive and probably safe, but choosing *its* retention rule for shared devices is product policy). Recommend bundling that choice as a one-line clause in the DEC-09 rider.

## 9. Proposed implementation boundary (NOT authorized yet)

**Staged, each stage STOP → authorize (same protocol as R08):**

| Stage | Scope | Files/migrations touched | Records expected to flip | Preconditions |
|---|---|---|---|---|
| R09.1 | Cache confidentiality: wipe/partition Workbox API cache + persister on logout/user-switch; retention language | `vite.config.ts`, `main.tsx`, `useAuthListener.ts`, `queryPersister.ts` | none (new records only, e.g. `OFFLINE.CACHE-PARTITION`, `OFFLINE.LOGOUT-PRIVACY`) | DEC-09 cache clause (one-liner) |
| R09.2 | Queue provenance + cross-tab lease + legacy quarantine; Dexie schema v2 (versioned, no data loss) | `src/offline/*`, `useSyncQueue.ts`, drawer UI | `OFFLINE.ACTOR-BINDING`, `OFFLINE.MULTITAB`, `OFFLINE.REOPEN`, `OFFLINE.RETRY` (if readback path solved honestly) | Full DEC-09 rider + infra choice |
| R09.3 | Reconciliation surfaces for quota/stock/closed-shift (visible exception states; DEC-08 reuse) | syncEngine + UI + (decision-gated, additive) provenance/recovery server state | new records `OFFLINE.CLOSED-SHIFT-REPLAY`, `OFFLINE.QUOTA-RECON`, `OFFLINE.CONFLICT` (if conflict contract defined) | DEC-06 + DEC-07 + DEC-08 reuse |
| R09.4 | Browser-runner evidence upgrade | harness infra (`tests/release/`) | `OFFLINE.BROWSER`, T13/T14 browser probes | Infra decision |

**Must remain unchanged:** every R08 record's status; all 8 `BRANCH.*`; all R05–R08 functions/policies unless an authorized stage explicitly names an additive change; the 2 R12 FAILs; baseline counting (only announced flips/additions).

## 10. Verification / test plan (pre-designed)

Per mandated structure — each new/changed control gets:

* **Positive controls:** queue item with valid provenance syncs under the SAME originator; sale lands on originator's shift; document count exactly once.
* **Unauthorized-role controls:** viewer/stock_clerk cannot replay or see queue beyond capability; summary counts only.
* **Cross-tenant controls:** preserved (extend `OFFLINE.CROSS-TENANT-PRESERVE` to cache layers — B must not see A's hydrated cache after partition).
* **Cross-branch controls:** where relevant — queue replay still flows through R08 branch authority verbatim (regression anchor, NOT a branch-matrix test).
* **Caller-substitution attacks:** forged originator uid in queue row; originator provenance mismatch vs. current session; replay after role downgrade (originator was cashier, now viewer).
* **Direct RPC/database access:** direct post_pos_sale replay with queued payload proves server-side de-dup independent of client state.
* **Replay/idempotency:** kill-tab-mid-sync simulation; stale-claim 2-min recovery; duplicate client_key only warns.
* **Zero-mutation assertions:** denied replay mutation envelope across the 10-table set used by R08.7 records.
* **R08 regression:** full r08 suite unchanged; r05/r06/r07 unchanged; unit baseline with announced additive tests only.

**Harness honesty rule (from R08.7):** anything the runner cannot execute stays BLOCKED with the exact reason — never faked.

## 11. R08 preservation protocol for any future R09 package

1. Baseline pinned: **652/2/51, 705 records, 0 diffs** (evidence dirs `r087-a/b` shapes retained in-repo as tests, not fixtures).
2. Permitted outcome diffs after each R09 stage: ONLY pre-announced new records and pre-announced `OFFLINE.*` flips. Any other PASS↔BLOCKED change = stop + investigate + revert.
3. Full protocol ×2 per stage (diff outcomes; gate stays not-green with exactly the 2 R12 FAILs).
4. Unit baseline 672 + pre-announced additions only; TS clean; lint 0 errors; build PASS.
5. R08 functions/migrations byte-checked (sha256 recorded) at every stage.
6. Deterministic repeat is the acceptance criterion, stated up-front in each stage's report.

## 12. Recommendation

**REQUIRES DECISION.** R09's objectives are precisely scoped and its dependency/skin map is fully traced, but the core semantics (actor-binding rider, legacy quarantine, quota/stock reconciliation, evidence-runner choice) require the DEC-06/DEC-07/DEC-09 sign-offs (+1 rider) identified in §8. No server-side implementation need is proven until then; the decision-free residual (cache wipe vs. partition on logout) is small but is still a product-adjacent choice that belongs in the same bundle.

**Do not authorize implementation yet.** Recommended next step: present this report for the DEC bundle; upon signature, R09.1–R09.4 can be authorized stage-by-stage under §11's preservation protocol.
