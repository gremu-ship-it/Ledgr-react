# R09 DECISION BUNDLE — Pre-Authorization Sign-off Package

**Date:** 2026-09-22 · **Phase:** DECISION PREPARATION ONLY — nothing herein implies approval · **Companion:** `LEDGR_R09_PRE_IMPLEMENTATION_DISCOVERY_2026-09-22.md` (discovery, returned REQUIRES DECISION)

**Immutable baseline:** release protocol 652 PASS / 2 FAIL / 51 BLOCKED (705 records, deterministic ×2); unit 672/672; TS clean; lint 0 errors; build PASS. R08 (.1–.7) CLOSED. The 2 FAILs (`EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer`) are R12-owned. No release record flips by virtue of this document existing.

Every decision below is presented as: **Repository evidence → Decision required → Options → Consequences → Implementation implications → Unproven**. Selection authority rests entirely with the sign-off owner.

---

## 1. EXECUTIVE DECISION SUMMARY

| # | Decision | Core question | Unblocks | Evidence state |
|---|---|---|---|---|
| 1 | DEC-09 + rider | What does a queued offline write provenance look like, and who may replay it when the current actor differs? | R09.2 (+R09.3 identity basis) | Queue has NO originator field today |
| 2 | DEC-06 | What lifecycle does an offline-accepted sale take when quota/usage boundaries moved? | R09.3 (quota slice) | Today: permanently `failed`, invisible |
| 3 | DEC-07 | What policy applies when stock moved between capture and replay? | R09.3 (stock slice) | Today: R06 checks only arbitrate at replay; no policy for the gap |
| 4 | DEC-08 interaction/rider | Which shift identity does a replayed pos_sale resolve to, when its context moved on? | R09.2 legacy slice + R09.3 | DEC-08 signed for online claims; offline gap identified, not a defect of DEC-08 |
| 5 | Cache confidentiality | Wipe vs. partition local caches on identity transition | R09.1 | Logout clears a SUBSET; Workbox HTTP cache survives |
| 6 | Browser/SW evidence | Playwright-class runner vs. documented jsdom limits | R09.4 | Harness has no browser runner; `OFFLINE.BROWSER` etc. honestly BLOCKED |

Order of signature is technically free; the stage map in §8 pins each stage to its minimum prerequisite set.

---

## 2. DEC-09 — OFFLINE QUEUE PROVENANCE AND REPLAY AUTHORITY

### 2.A Originating-actor provenance

**Repository evidence.** `src/offline/db.ts:QueueItem` carries: `localId, sequence, operationType, status, businessId, payload, dependsOnLocalId/dependentFkField/resolvedServerId, clientKey (unique idempotency), createdAt, lastAttemptAt, attemptCount, lastError, localUpdatedAt`. **No user, device, session, terminal, shift or payload-version field exists.** Dexie schema is `version(1)`. The server binds replayed POS sales exclusively to the *current* session (auth.uid() → own-shift resolution, `20260930000001_r08_post_pos_sale_binding.sql`). Supabase session persists in `localStorage` (`src/lib/supabase.ts`, persistSession + autoRefreshToken); the SW claims clients (`vite.config.ts:100`) and caches `/rest/v1/` GETs 200 entries / 24h.

**Decision required.** Which provenance attributes are DURABLY recorded when an item is enqueued (client-side IndexedDB), and precisely how the server uses them at replay time. Evidence of origin ≠ authorization: a stored UID is *evidence*, the server must verify the *caller* at replay time — R08's model.

Evaluate (expressly enumerated per mandate):

| Attribute | If recorded… | If absent… |
|---|---|---|
| originating user/account ID (`origin_user_id`) | Actor-substitution becomes detectable server-side or client-side pre-flight | T14a substitution stays invisible (today's hole) |
| originating device/session identity (`origin_device_id`) | Distinguishes same-user multi-device; enables device lease/quarantine | Cannot separate two tills of same cashier; lease must be tab-local only |
| queue client key | Exists, carry forward unchanged — NEVER regenerate | — |
| payload/schema version | DEC-09 version window enforceable; admit/reject/quarantine by version | Old items unreadable after schema v2 |
| capture timestamp | Exists (`createdAt`/client-reported) — keep as EVIDENCE ONLY (client clock untrusted per DEC-06 plan row) | — |
| business/tenant | Exists (`businessId`) | — |
| branch/terminal/shift context | Enables exact closed-shift/branch semantics at replay | Replay re-resolves context at sync time = drift (T15-ish) OR the legacy path (branch-less) |

**Boundaries the sign-off should state (without implementation detail):**
- Provenance is EVIDENCE; only server-side verification of the replay caller (existing R08 authority chain) is authorization. A forged `origin_user_id` stored locally must be harmless — the server either matches it to the caller or quarantines; it never trusts it.
- Storage vehicle: Dexie schema v2 (client-side, versioned). No server schema change is proven necessary for provenance itself.

### 2.B Replay under a different current actor

**Repository evidence.** Replay loop (`syncEngine.syncQueue`) processes all `pending`/`failed` items for whoever opens the app. `useSyncQueue` has an in-memory ref only. Audit §12.3-5: "same-tenant user changes can replay under the wrong current actor." Discovery verified: any queued `pos_sale` replays under the session present at sync time and binds to that session's own open shift.

**Option 1 — Deny and quarantine.**
- Original actor (`origin_user_id`) must equal authenticated replay actor, else item transitions to a visible quarantine/exception state.
- Recovery requires an explicitly authorized process (surface TBD by UI work; likely admin-transfer flow reusing Option 2's evidence format).

*Consequences — security:* stops actor substitution cold; maintains R08 owner-of-sale semantics exactly. *Operational:* cashier quits/leaves unsynced sales → every such item needs intervention; end-of-day deadlines matter; a stuck queue on a shared device requires network + admin workflow. *Audit:* maximal — every exception is visible and durable; adds quarantine-store design.

**Option 2 — Manager-authorized transfer.**
- A different actor may replay ONLY through a server-authorized transfer: original actor, current actor, authority, reason and timestamps audited (durable record — possibly `pos_shift_late_adjustments`-adjacent or a new exception table, decision item).
- Normal caller-controlled substitution remains impossible (server rejects mismatches; transfer requires explicit tier + record).

*Consequences — security:* retains a legitimate continuity path without weakening server authority; the risk surface is the transfer process itself (must be tamper-evident). *Operational:* smoother for real-till life (cashier off-shift → manager posts remaining queue with evidence). *Audit:* requires the durable transfer record; more objects, more tests.

**No winner selected. Efficiency-versus-incident-cost:** Option 1 punishes operational reality; Option 2 builds a new authority surface that must itself be secured. Both block silent substitution; they differ in where unsynced sales go when the originator is unavailable.

**Implementation implications (either way):** replay-time check against `auth.uid()` server-derivable through existing RPC identity; quarantine state is a new queue/exception state (client-visible via OfflineQueueDrawer); zero changes to R08 functions expected for Option 1-for-identity; Option 2 needs one new durable object (decision line item, not implementing).

### 2.C Legacy `ledgr_pos_offline_queue`

**Repository evidence** (`src/offline/legacyPosQueue.ts`): entries are `{ offlineNum?, receiptNumber?, payload, queuedAt? }` — **no user/uid/tenant field other than payload business_id**. Current migration (`migrateLegacyPosQueue` at `useSyncQueue` mount) converts entries into `pos_sale` queue items attributed to the *next identity to open the app*, and repairs/marks stubs — i.e., automatic attribution by accident of timing. The plan mandates "Quarantine legacy ambiguous ownership for assisted recovery rather than assigning it to whoever logs in next."

**Decision required.** One of:

| Policy | Meaning | Consequences |
|---|---|---|
| Automatic attribution to current user | Status quo | Violates both plan and T13/T14 spirit; silently commits receipts under an unverified identity — **must be rejected** |
| Quarantine on sight | Convert entries to quarantined queue state (no replay until an authorized review assigns/validates originator) | Preserves money evidence; operational overhead exists only while legacy entries survive; aligns with DEC-09-B Option 1 |
| Assisted recovery | Ticket-style workflow: entry surfaced to admin, originator asserted with evidence, then posted/voided with full trail | Best customer outcome; needs build-time for the flow; still demands a decision-time contract |
| Permanent rejection/expiry | Entries older than X or malformed are voided as never-posted | Breaches "never discard accepted financial evidence" (DEC-06 plan row; register §5 risk); — must not win |

**Non-negotiable clause (any option):** no implementation path may attribute a legacy receipt to the identity that merely happens to log in next.

### 2.D Queue schema/version migration (Dexie v2)

**Decision package — required semantics statements:**

1. Existing queue records **are migrated** in place (never recreated empty; register §5 explicit risk).
2. Records that CAN receive provenance honestly (e.g., Supabase current session matches business; legacy fields intact) may be back-provenanced IF origin identity is actually verifiable at migration time; others become quarantined-with-reason.
3. Migration must be **lossless w.r.t. financial content**: payloads, client keys, dependency links, timestamps and statuses preserved byte-for-byte; only additive fields are written.
4. Partially-migrated records: detectable via `payloadVersion` marker; an item mixing v1-incomplete state is treated as quarantined, re-attempted idempotently on next run (migration itself must be resumable/crash-safe — same class as audit §12.3-10 durability limits).
5. Old payload versions: admitted only if inside the DEC-09 compatibility window; otherwise quarantined-for-assisted-recovery — never dropped, never silently rewritten.
6. Migration code must tolerate IndexedDB unavailable/evicted (operational guidance: visible "pending N" counters + export path per §12.3-10).

---

## 3. DEC-06 — OFFLINE QUOTA RECONCILIATION

**Repository evidence.** `syncEngine` calls `usageService` at sync time (R10 dependency); a quota failure flips the item to `failed` and it retries on each pass thereafter — potentially forever, invisibly. Nothing distinguishes "transient network failure" from "server entitlement denial". Plan row: "Offline quota and expiry policy — Do not discard financial evidence already accepted offline. Use a bounded, authorized reconciliation path and meter it explicitly; never trust client timestamps as proof of entitlement."

**Decision required.** Define the state machine for an offline-accepted write that hits a quota boundary at replay:

| State | Semantics |
|---|---|
| `accepted_posted` | Normal path; quota consumed at commit (server metered) |
| `rejected_visible_exception` | Server denies quota; item lands in a VISIBLE exception state w/ exact reason + next-step guidance (not `failed`-rotated) |
| `quarantined_authorized_resolution` | Admin/owner-level action required (upgrade, override-with-evidence, or manual reconciliation) |
| `expired` | DEC to define whether expiry can EVER apply to accepted financial evidence (recommended: only with explicit owner acknowledgment, never automatic) |
| `manually_reconciled` | Manager/owner resolves with durable record (who/when/why), possibly re-routed to the "Plan B" allowed path per policy |

**Explicit mandates captured in the decision text:** no silent loss; no infinite invisible retries (retry budget + state transition); no unauthorized quota bypass (server metering is the only authority — `usageService` is advisory; client-side entitlement checks cannot approve); client timestamps are evidence, not proof.

**AMENDMENT (2026-09-22, adopted per consistency check FR/P-D2):** Prerequisite **P-D2** is recorded as part of this decision: a **typed quota-denial contract** — a dedicated error code or structured error shape, declared once, **owned by R10** and consumed by R09.3 — is required so the queue can distinguish entitlement denial from transient failure. The client message-text today (`P0001` + human message) is NOT the contract. Implementation of this contract is explicitly outside R09.1.

**Accounting/operational consequences.** Quota-blocked revenue must remain a *documented receivable state*, not a deleted queue row: the sale physically happened (cash in drawer!). Option nuance: if DEC-09 requires origin-shift binding, a quota-denied sale ALSO carries DEC-08 closed-shift implications — interaction table §8 reflects this. R10 dependency: metering contract (`usageService`/billing) must expose a typed denial the queue can distinguish from network failure — that contract change belongs to R10 sequencing, consumed by R09.3.

**Unproven today:** that usage-denial and network-denial are distinguishable at the sync boundary; the register's "recovery instructions" (R14) for stranded queues do not exist yet.

---

## 4. DEC-07 — OFFLINE STOCK POLICY

**Repository evidence.** R06 stock integrity is server-side (`stock_movements`, balance triggers; `post_pos_sale` deducts). There is NO offline reservation; two disconnected tills can sell the same last unit (audit §12.3-1). POS product availability in the active screen is placeholder-limited (§12.3-2 context). R06 must NOT be modified by R09.

**Decision required.** Policy for stock divergence between capture and replay:

| Model | Stock integrity | Customer transaction | Accounting | Operational | Audit | R06 interaction |
|---|---|---|---|---|---|---|
| **Restricted offline selling** (only catalog items with provably sufficient *cached* stock may be captured offline; sale blocked otherwise) | Strongest — most conflicts prevented at capture | Some sales refused offline; UX must say why | Clean: replay rarely conflicts | Requires a usable offline catalog + cached stock snapshot with as-of timestamp | Simplest evidence model | Consumes R06 read model offline; zero write-path changes |
| **Allow replay + controlled oversell** (replay posts; negative balance enters a visible exception state with mandatory reconciliation) | Balances may go briefly negative, bounded + recorded | Sale honored (money already taken) | COGS/GL unaffected; a held exception list drives physical reconciliation | Store-level stock count/return-flow required | Every oversell duracy + owner-visible | R06 mechanism unchanged; negative balance ALLOWED under DEC rather than blocked |
| **Reject/quarantine** (stock conflict at replay → item quarantined; NO post) | Server-side truth preserved | Customer ALREADY paid and left — worst experience unless refund flow defined | Refund requires R07 command (online) | Same queue-exception burden as DEC-06 path | Clear, complete | R06 unchanged; does not violate stock truth — most conservative server semantics |
| **Reconciliation workflow** (hybrid: replay posts with an auto-created exception requiring physical stock adjust within bounded window) | Bounded managed exceptions | Sale honored | Adjustment entries with reasons (manager-tier) | Highest operational discipline demanded | Rich post-fact trail | Consumes existing R06 adjustment mechanisms |

**Interaction constraint (mandatory clause):** whichever wins, R06 bodies stay byte-stable; the chosen policy classifies behavior AROUND R06, never softening its invariants. DEC-07 should also state whether the offline catalog includes an "as-of" stock timestamp surfaced in the offline UI (per §12.4).

**AMENDMENT (2026-09-22, adopted per consistency check FR-1):** the option set is NARROWED to **(1) Restricted offline selling, (2) Reject/quarantine [bundled 'Reject/quarantine'], (3) Reconciliation workflow**. The original "controlled oversell" model is **NOT authorized**: it collides with the R06 server-side invariant `chk_inventory_balances_on_hand_nonneg` (denial 23514 inside the posting transaction) and may only be revived by a future explicit decision changing that invariant. The final model is still not chosen here; the viable set is {restricted, reject/quarantine, reconciliation} including composites of 1+3.

**Recommended structure (no winner chosen):** the sign-off should pick ONE primary model + the exception handling of its edge cases; do not combine two primary models (ambiguity = incident).

---

## 5. DEC-08 / CLOSED-SHIFT INTERACTION (RIDER — reuse, not re-define)

**Repository evidence.** DEC-08 (signed, R08.1): original close preserved; post-close arrivals append `pos_shift_late_adjustments` rows; current view = snapshot + Σ adjustments. `post_pos_sale` binding executes this (closed-shift claim → `v_late := true` → adjustment insert at line 344). Legacy/branch-less payloads post as branch-less invoices (invisible to shift totals entirely) — NOT in DEC-08's model: neither shift-bound nor adjustment-recorded.

**Required behavior matrix (to be APPROVED as a rider or explicitly deferred):**

| Situation at replay | Signed-path behavior | Is it covered by existing DEC-08? |
|---|---|---|
| Originating shift still OPEN | Sale binds to origin shift via origin-actor's OWN-shift resolution (server, R08) — same as online | Yes — but needs DEC-09 origin date: is capture-time shift or replay-time shift authoritative? **This sub-choice belongs in the DEC-09 rider** |
| Originating shift CLOSED | Left as shift-claiming: closed ⇒ DEC-08 late adjustment appears | Yes |
| Originating shift cannot be identified (provenance absent/v1) | Falls back to replay-time own-shift or branch-less legacy | **GAP — new semantic required** |
| Valid terminal, no valid shift claim | R08 replay binds server-side then DEC-08 if closed | Yes |
| Legacy/branch-less payload | Posts branch-less; NO shift effect, NO adjustment — accepted invoices invisible to drawer reporting | **GAP — new semantic required: either continue accepting branch-less (existing behavior) or quarantine migration-required** |

**AMENDMENT (2026-09-22, adopted per consistency check FR-2 — recorded residual):** the legacy/branch-less **server** path remains open for old clients pending the DEC-09 payload/version window and a separately authorized additive server check. D-1/D-4 quarantine governs the new sync-engine stratum only; R09.1 does not touch that server path.

**Statement for the bundle:** DEC-08 itself is not reinterpreted. The two GAP cells require explicit either-or choices; recommend folding them into the DEC-09 legacy/attribution rider so one signature covers them coherently.

---

## 6. BROWSER / SERVICE-WORKER EVIDENCE DECISION

**Repository evidence.** Release harness runs vitest + node pages + explicit RLS against real PostgreSQL migrations; IndexedDB is mocked (`fake-indexeddb` family via `offlineDB` Dexie in jsdom); no Playwright/browser runner exists (`package.json` has no such dep — verified in discovery). `OFFLINE.BROWSER`, `OFFLINE.MULTITAB` honestly BLOCKED for exactly this reason; T13/T14 browser probes (true logout privacy, SW lifetime, kill-mid-sync) cannot be executed with current infra.

**Option A — Playwright-based ephemeral browser/release suite.**
- Real browser: quit/kill mid-sync, true service-worker lifecycle (`ledgr-api-cache` in Cache Storage), genuine multi-tab lease, storage eviction semantics, BroadcastChannel/navigator.locks.
- Consequences: heavyweight CI artifact + flake discipline; evidence becomes actually authoritative for the cache/lease classes of records — Requirement for calling T13 proven-in-truth.

**Option B — Stay jsdom + fakes with a signed residual-risk register.**
- `OFFLINE.BROWSER`, tab/SW lifetime claims stay BLOCKED forever, and the report carries an explicit "browser behavior assumed, never proven" clause; all R09 code must then be constrained so its *security* never hinges on SW/Cache-Storage specifics (defensive layering only).
- Consequences: zero infra risk today; permanent ceiling on assertion strength; privacy-class records remain unanswered.

**AMENDMENT (2026-09-22, adopted lane discipline when Option A is chosen):** the browser suite is an **independent CI lane** (does not gate unit/release), with browser-binary caching, an explicit flake/retry budget, and synthetic-only data. Browser execution is not part of R09.1 except where required solely to validate cache-wipe behavior; R09.4 remains separately authorized.

**Not selected.** Neither runner is installed nor any browser behavior is claimed as proven anywhere in this document.

---

## 7. CACHE CONFIDENTIALITY DECISION

**Repository evidence (verified in discovery):**
- React-Query persister (`queryPersister.ts`): businessId-partitioned, 24h maxAge, 200ish bound, cleared on `SIGNED_OUT` (`main.tsx:84` clearPersistedCache + `ledgr_*` sessionStorage sweep).
- Workbox `ledgr-api-cache`: URL-keyed, NO identity dimension, NOT cleared at logout — financial GETs survive (T13 attack path `vite.config.ts:101-115`).
- Workbox shell/precache: static assets — safe to keep.
- IndexedDB `ledgr-offline.queue`: NOT cleared at logout (by design — accepted financial evidence), tenant-tagged but not user-partitioned.
- localStorage: Supabase session (managed by supabase-js), legacy POS queue.
- Registration: `minimalUI`→`standalone` display, autoUpdate, `clientsClaim:true` (no explicit skipWaiting observed).

**Decision required.** Behavioral model after logout / user-switch / role-downgrade / business-switch:

### Wipe model
All sensitive cached business data is removed on identity/session transition; only accepted-queue records survive (quarantine-state vs. playable handled by DEC-09).
- Security: simplest strongest confidentiality; *offline-use-immediately-after-logout* becomes partially degraded (cold cache → no catalog/till availability until first connected load); must tolerate `caches.delete`/persister-delete failures WITHOUT losing queue evidence; SW lifetime: force cache eviction + programmatic cache-scope purge on the SIGNED_OUT path (standard SW capability).
- Shared-device consequence: next user starts cold — the desired trade for till devices.

### Partition model
Data retained, addressed by a verified identity partition (supabase user id + business + permission epoch).
- Storage growth; correctness burden (every layer keyed identically: HTTP cache naming + persister + Dexie + localStorage); "safe because keys contain businessId" is NOT sufficient — key must derive from authenticated identity, never caller-set values; previous-partition access must be ARITHMETICALLY impossible post-switch (incl. role-downgrade epoch bumps, else a downgraded user still reads their old privileged cache).

**Layers checklist the decision must cover individually:** Workbox HTTP cache · React-Query persisted cache · IndexedDB (queue + any caches) · localStorage · sessionStorage · SW lifetime (waiting/active claim semantics on version bump) · shared-device posture · offline-immediately-after-logout posture.

**AMENDMENT (2026-09-22, adopted per consistency check FR-3):** `ledgr_pos_offline_queue` (localStorage) is **accepted financial evidence, not ordinary cache**: it is EXEMPT from any cache wipe and routed to the D-1 quarantine flow instead. Cache enumeration must be explicit per-key/per-store — named families only when the family is itself the enumerated target (e.g. the `ledgr_draft_` form-draft family) — and must never use an unsafe wildcard that could reach the offline financial queue (`ledgr-offline` IndexedDB) or `ledgr_pos_offline_queue`.

**Unproven today:** HTTP-cache `Vary` behavior of the Supabase REST surface; whether in-flight SW fetches can repopulate a just-wiped cache before claim (needs Option-A-class evidence, §6).

---

## 8. DECISION INTERACTION MAP

Mandated table, verified against the repository. One expansion reported (not silently made): **DEC-08 also touches R09.2** (legacy/branch-less replay semantics §5 GAP cells — the mandate table lists DEC-08 → R09.3 only; reality shows the R09.2 legacy slice shares DEC-08's rider; flagged here per "report it rather than changing the table").

| Decision | Depends on | Affects (as mandated) | Affects (repository-verified addition) |
|---|---|---|---|
| DEC-09 (+rider: actor/legacy/version semantics) | queue provenance/replay semantics | R09.2 | R09.3 identity/quota basis; R09.1 queue-partition clause |
| DEC-06 | quota policy (R10 metering contract) | R09.3 | — (consistent) |
| DEC-07 | stock policy (R06 unchanged) | R09.3 | — (consistent) |
| DEC-08 (signed) | existing R08 shift semantics | R09.3 | **R09.2 legacy slice** (rider scope; do not reinterpret DEC-08) |
| Cache decision | shared-device confidentiality policy | R09.1 | — (consistent) |
| Browser evidence decision | release verification requirements | R09.4 | — (consistent) |

---

## 9. R09 STAGE → AUTHORIZATION PREREQUISITES

| Stage | Prerequisite decisions | Exact intended scope (no implementation performed) | Expected records | Tests | Explicit OUT-of-scope |
|---|---|---|---|---|---|
| **R09.1 — Cache confidentiality** | §7 cache decision (wipe vs partition incl. per-layer clauses with direct reset role (`SIGNED_OUT` resets) · artifact update: `useAuthListener.ts`, `main.tsx`, `queryPersister.ts`, `vite.config.ts` Workbox policy · drawer wording | `OFFLINE.CACHE-PARTITION` (new), `OFFLINE.LOGOUT-PRIVACY` (new) | storage-layer unit tests + (infra-decision-gated) browser probes §6; regression of REOPEN/PRESERVE | OfflineQueueDrawer visuals; Touch Points in §1/R12; **EXCLUDES** offline queue content semantics |
| **R09.2 — Queue provenance + actor binding + tab lease + legacy quarantine** | DEC-09 + rider §2 (provenance set, replay policy 1 or 2, legacy policy, v2 migration semantics) + cache decision queue clause | Dexie v2 migrations, syncEngine claim-origin gate, navigator.locks/BroadcastChannel lease, OfflineQueueDrawer quarantine visibility | `OFFLINE.ACTOR-BINDING` (unblock), `OFFLINE.MULTITAB` (unblock), `LEGACY.QUARANTINE`/`OFFLINE.LEGACY-*` (new), `OFFLINE.REOPEN/RETRY` (conditions noted in test file — readback-grant path only via R01 honesty, may stay partial) | replay calibration: cross-tab, identity mismatch, forged provenance, resumable v1→v2 | server migrations beyond additive provenance attrs; R05–R08 byte state |
| **R09.3 — Quota/stock/closed-shift reconciliation** | DEC-06 + DEC-07 (+ DEC-08 rider confirmation §5 GAP cells) | exception state machine, OfflineQueueDrawer visibility, R06/R10 consumption contracts, DEC-08 adjustment path reuse | `OFFLINE.QUOTA-RECON` (new), `OFFLINE.STOCK-RECON` (new), `OFFLINE.CLOSED-SHIFT-REPLAY` (new), `OFFLINE.CONFLICT` (unblock if conflict contract signed) | state-transition matrix tests; positive/negative + manager-tier paths; R05/R06/R07/R08 suites unchanged | modifying R06 bodies; redesigning R10 metering |
| **R09.4 — Evidence infrastructure** | §6 browser decision | Playwright-class ephemeral runner + CI wiring | `OFFLINE.BROWSER` (unblock), T13/T14 browser records | warm/cold cache, kill-mid-sync, two tabs, storage eviction, logout/user-switch privacy | claiming SW/cache behavior without the runner once B is chosen |

## 10. SECURITY CONSEQUENCES (aggregate)

- Decisions 1/2.B/2.C close the T14a actor-substitution hole; failing to decide = leaving it open knowingly.
- Decision 7 closes T13 (shared-device financial-cache persistence) — the confidentiality headline of R09.
- Decision 3 (DEC-06) prevents silent financial loss OR silent entitlement bypass depending on direction chosen — both are unacceptable outcomes by definition of the constraint.
- Decision 4 (DEC-07) determines whether offline selling promises bounded honesty vs. silent stock divergence.
- Decision 6 determines the CLASS of evidence R09 can claim for browser-dependent controls.
- Not deciding = the risk register (register §6: VERY HIGH) stands as the operational default.

## 11. OPERATIONAL / ACCOUNTING CONSEQUENCES (aggregate)

- Quarantine-heavy paths (options 1 in §2.B, quarantine in §2.C) raise admin workload exactly where unsynced-revenue risk lives; transfer paths (option 2) trade build complexity for continuity.
- Cash-in-drawer reality: any policy denying post-fact posting MUST define refund/correction surfaces (R07) or the books diverge from physical cash.
- v2 migration is a one-way door operationally: sign-off covers its crash-safety requirements (§2.D-4).
- Exception dashboards become product surfaces, not developer consoles: every "visible" state in DEC-06/07 outcomes must render in OfflineQueueDrawer-class UI or it is not visible.

## 12. EXPLICIT UNRESOLVED QUESTIONS

Carried into the sign-off session (answerable only by decision, not code):

1. §2.B: replay policy = Option 1 or Option 2 (+transfer-record object spec if Option 2).
2. §2.C: legacy policy = quarantine / assisted-recovery (+its SLA/duration).
3. §2.D-5: compatibility window bound + the version notation.
4. §5: capture-time vs. replay-time shift for origin-actor binding.
5. §5: legacy/branch-less payloads = grandfather-accept or migration-required-quarantine.
6. §7: wipe vs partition (per-layer confirmation incl. HTTP cache + role-downgrade epoch model if partition).
7. §3: does "accepted offline revenue" have a receivable-state representation requirement in the books, or exception-ledger only?
8. §4: oversell reconciliation operator path (who physically resolves, by when, with what record).
9. §6: Option A runner scope (which browsers, which CI lane) if chosen; exactly which records remain perpetually BLOCKED if Option B.
10. Whether R09 code may ADD a server-side exception/transfer table (additive migration decision gate — Option-2 contingent).

## 13. APPROVAL / SIGN-OFF STATEMENTS (proposed text — not yet signed)

> **D-1 (DEC-09 + rider).** Signed by: ______ Date: ______
> We select for 2.B: ☐ Option 1 (deny+quarantine) ☐ Option 2 (manager-authorized transfer). Provenance fields: as §2.A table, with origin-vs-authority clause. Legacy policy: ☐ quarantine ☐ assisted recovery. v2 migration semantics: §2.D items 1–6 as written. §5 GAP cells resolved by adding them to this rider as: ______________.
>
> **D-2 (DEC-06).** Signed by: ______ Date: ______
> Offline-vs-quota policy: state machine as §3 table with `rejected_visible_exception`/`quarantined_authorized_resolution` outcomes; no silent loss; server-metering authoritative; expiry (if any) only with explicit owner action: on/off as selected: ______________.
>
> **D-3 (DEC-07).** Signed by: ______ Date: ______
> Primary stock model: ☐ restricted ☐ allow-with-controlled-oversell ☐ reject/quarantine ☐ reconciliation-workflow; with R06-invariant clause and edge-case handling as §4 row selected: ______________.
>
> **D-4 (DEC-08 rider).** Signed by: ______ Date: ______
> §5 matrix approved; GAP-cell semantics as recorded under D-1; DEC-08 itself unmodified and R08 preserved.
>
> **D-5 (Cache confidentiality).** Signed by: ______ Date: ______
> ☐ Wipe ☐ Partition, per-layer clauses complete per §7 checklist incl. shared-device posture.
>
> **D-6 (Browser/SW evidence).** Signed by: ______ Date: ______
> ☐ Option A (Playwright-class runner) ☐ Option B (jsdom + signed residual-risk register).

---

## FINAL STATUS

**R09 IMPLEMENTATION: NOT AUTHORIZED**

Separately authorize, in any order after signature: **R09.1** (requires D-5) · **R09.2** (requires D-1 + D-5's queue clause) · **R09.3** (requires D-2 + D-3 + D-4) · **R09.4** (requires D-6). Until then: no migrations, no code, no record flips; R08 baseline 652/2/51 preserved exactly.
