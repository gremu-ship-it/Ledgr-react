# LEDGR R09 — DECISION CONSISTENCY CHECK

**Date:** 2026-09-22 · **Phase:** CONSISTENCY CHECK ONLY — no implementation, no record changes, no decision approvals implied · **Inputs:** `LEDGR_R09_PRE_IMPLEMENTATION_DISCOVERY_2026-09-22.md`, `R09_DECISION_BUNDLE_2026-09-22.md`, proposed decisions D-1…D-6 · **Baseline preserved:** 652 PASS / 2 FAIL / 51 BLOCKED (705 records, deterministic ×2); R08 CLOSED.

Method: every claim below was re-verified against the current repository in this phase (file:line cited). Where a proposed decision presumes a mechanism that does not exist, that is reported as a prerequisite or conflict — never silently assumed away. Statuses are exactly: **CONSISTENT** / **CONSISTENT WITH PREREQUISITE** / **CONFLICT — REQUIRES NEW DECISION**.

---

## 1. DECISION-BY-DECISION CONSISTENCY RESULT

### D-1 — Queue provenance + DENY/QUARANTINE + legacy QUARANTINE + lossless v2 — **CONSISTENT**

Verified facts supporting the decision:

- `QueueItem` (`src/offline/db.ts`) is an additive-friendly shape; all mandated provenance additions (`origin_user_id`, `origin_device_id`, payload version, contexts) are new optional columns in a Dexie v2 — no server schema change needed for provenance itself.
- The authority model is safe by construction: enqueuing/provenance lives client-side while authority stays server-side. A forged `origin_user_id` can affect ONLY which items a device quarantines for itself — it can never widen what the server accepts, because the server authorizes on `auth.uid()` regardless (`20260930000001_r08_post_pos_sale_binding.sql:124` denies steering onto any shift not owned by the caller with 42501). This is precisely the critical rule the decision states, and the repository already embodies the required separation.
- DENY+QUARANTINE needs NO R08 change: the sync engine simply refuses to send a mismatch; the server's own-shift 42501 is the permanent backstop, not the mechanism.
- Legacy `ledgr_pos_offline_queue` (`legacyPosQueue.ts:LegacyPosQueueEntry`) contains no identity field, so quarantine-on-sight is the only honest treatment; the migration-change site (`legacyPosQueue.migrateLegacyPosQueue`, wired in `useSyncQueue`) is fully client-side.
- Dexie is at `version(1)` — v2 with resumable/idempotent migration is a standard capability; nothing in the repo contradicts lossless additive migration.

No contract conflict found. *Validation requirement met: R05–R08 command contracts remain byte-stable; the pos replay path unchanged (`commitPosSaleDocuments` → `post_pos_sale` signature untouched).*

### D-2 — Quota VISIBLE EXCEPTION + QUARANTINE — **CONSISTENT WITH PREREQUISITE**

- Server metering exists and is authoritative (`_ledgr_assert_usage_limit`, `20260911000001_quick_save_rpc.sql:123`, plan table in `20260919000000_add_starter_plan.sql:35-53`), asserting inside the posting transaction.
- **Gap found:** quota denial is today identifiable only by SQLSTATE `P0001` + human message text (`'Monthly transaction limit reached (%). Please upgrade your plan.'`) — a stable, dedicated machine-readable error contract (e.g., a dedicated errcode or structured PostgREST error shape) is NOT formalized, and the client's `UsageService` path stores `err.message` strings. D-2's own wording anticipated exactly this ("report that as a prerequisite/blocker rather than inventing a workaround").
- **Prerequisite P-D2 (additive, not redesign):** declare one typed denial contract for server quota refusal (same code shape reused everywhere metering asserts), owned in R10 sequencing, consumed by R09.3 for the exception-vs-transient classification. Text-level amendment to D-2 required (§9).

### D-3 — Stock policy (final check before selection) — **CONSISTENT WITH PREREQUISITE**

R06 ground truth verified: `chk_inventory_balances_on_hand_nonneg` (base 20260817000001, ratified at `20260928000001_r06_stock_balance_authority.sql:34-39`) — a movement that would take on_hand negative **raises 23514 inside the posting command's transaction**; concurrent final-unit sales serialize on a locked balance row.

Model-by-model technical verdict (selection still NOT made):

| Model | Can it exist without weakening R06? | What R09.3 consumes |
|---|---|---|
| 1 Restricted offline selling | YES | Client gates capture using cached as-of stock snapshot (evidence, not authority); replay-time R06 checks remain the backstop. No R06 change. |
| 2 Controlled oversell (replay posts; negative balance tolerated in a bounded exception state) | **NO as written** — collides head-on with `chk_inventory_balances_on_hand_nonneg`/23514. Would require amending an R06 invariant = new DEC + explicit R06 trigger authority. | — (see conflict FR-1 §2) |
| 3 Reject/quarantine | YES — the server ALREADY rejects (23514 today); R09.3 converts the denial into the visible quarantine state and prevents endless invisible retries. | Denial classification + exception UI; zero R06 change. |
| 4 Reconciliation workflow | YES if and only if reconciliation uses EXISTING R06 adjustment mechanisms (manager-tier stock corrections/adjustment movements) — never a bypass of the posting commands. | Exception state + link to authorized adjustment flows; zero R06 change. |

**Consequence for the decision text (mandate: flag, do not choose silently):** the viable option set is {1, 3, 4} (and composites of 1+3/4). Model 2 enters the session only if re-cut as "reject-with-visible-exception + operator reconciliation" (=model 4 with 3's surface) or carried as an explicit new DEC authorizing an R06 semantics change. D-3's final selection is flagged **still open** — no model declared chosen.

### D-4 — Shift interaction, DENY + late adjustments + quarantine — **CONSISTENT WITH PREREQUISITE**

- Origin-shift closed: claimed-shift replay hits exactly DEC-08's path (`v_late := true`, `pos_shift_late_adjustments` insert at `…000001:344`) with **zero** R08 modification — verified.
- Mismatch substitution: server's own-shift 42501 (`…000001:124`) is the hard backstop; D-1's client gate prevents exercising it needlessly.
- **Residual identified (mandate's principle 4 nuance):** the legacy/branch-less SERVER path (terminal-less, shift-less payloads) remains open for old unsynced PWAs by design (R08.3 chose compatibility; the planned "migration-required" rejection was never shipped — no such raise exists in the binding). D-1/D-4 quarantine governs only NEW stratum behavior; closing the server path for ANY client requires the DEC-09 version window PLUS an additive server change that D-4 currently forbids. This is stated as accepted residual risk until that version window arrives — text amendment needed (§9, FR-2).
- No R08 contract requires change for the adopted principles 1–5. Validation passed.

### D-5 — Cache WIPE (with queue-evidence preservation) — **CONSISTENT**

- Storage primitives are cleanly separable: persister DB = `ledgr-rq-cache` (queryPersister), queue DB = `ledgr-offline` (separate `LedgrOfflineDB` Dexie, distinct schema+name), Workbox HTTP cache = Cache Storage `ledgr-api-cache` (vocabulary in `vite.config.ts:107`), legacy POS = `localStorage['ledgr_pos_offline_queue']`. Wipe can enumerate exact targets without touching the queue DB.
- Existing precedent: `SIGNED_OUT` already clears persisted query cache + `ledgr_*` sessionStorage (`main.tsx:84-94`) — extending the same channel to Cache Storage and honoring the queue exemption amplifies an implemented pattern, no new primitive across threats.
- Clarifying clause required (FR-3): the legacy POS localStorage key is "accepted financial evidence" by nature, NOT ordinary cache — it must be EXEMPT from wipe and handed to the D-1 quarantine flow. (If a future deploy ever needed localStorage-only wipe tools, filename enumeration is explicit today.)
- No unproven premise remains except the execution-facts D-6 exists to verify (SW repopulation races, exact wipe completion synchronization) — by design, not by silence.

### D-6 — Playwright-class browser evidence — **CONSISTENT**

- Repository CI: `ubuntu-latest` runners with headless-capable stack (`.github/workflows/ci.yml`) — Chromium headless under Playwright is a standard fit; embedded-postgres release tests already run in a similar sandbox (`npm rebuild @embedded-postgres/linux-x64`).
- Cost/risk disciplines to ship with the decision text (FR-4): separate CI lane (fail-safe, does not gate unit/release), browser binary cache, flake retry budget, synthetic-only data.
- No browser execution is claimed anywhere today; all affected records stay BLOCKED until the lane exists: `OFFLINE.BROWSER`, `OFFLINE.MULTITAB`, plus the browser-probe faces of T13/T14.

---

## 2. CONFLICTS DISCOVERED

**FR-1 (material):** Decision bundle's D-3 **model 2 (controlled oversell)** is impossible without modifying an R06 server-side invariant (`chk_inventory_balances_on_hand_nonneg`, 23514). Not a decision-killer — model must either be reframed (reconciliation + exception surface = model 4/3 composite) or explicitly submitted as a NEW DEC authorizing an R06 semantics change. Flagged; no model chosen.

**FR-2 (residual, stated so it cannot be forgotten):** D-4's principle 4 (legacy/branch-less never silently posts) is enforceable only for the NEW sync-engine stratum in this R09; the server legacy branch-less path remains open by compatibility for old clients until the DEC-09 version window + a separately authorized additive check land. This is an open door ON PURPOSE at R08 close — the decision text must contain the acknowledged-residual line.

No other conflicts found across D-1…D-6.

## 3. MISSING PREREQUISITES

| ID | Prerequisite | Blocks | Owner/vehicle |
|---|---|---|---|
| P-D2 | Typed quota-denial contract (dedicated errcode or structured error shape, declared once, asserted from metering paths) | R09.3 quota slice | R10 sequencing (additive), consumed by R09.3 |
| P-D1-Q | Quarantine-state representation (visible exception statuses + OfflineQueueDrawer rendering) | R09.2 | R09.2 scope (client-side, new statuses in Dexie v2) |
| P-D6-CI | Playwright lane wiring + browser cache + flake budget in CI | R09.4 | R09.4 scope |
| P-D3-FINAL | Final D-3 model selection from the REDUCED option set {1, 3, 4} (+ composite rules) | R09.3 stock slice | Sign-off owner |

None are implementation blockers for R09.1.

## 4. R08 COMPATIBILITY RESULT — PASS WITHOUT MODIFICATION

- Closed-shift replay: uses DEC-08 verbatim (`…000001:344`) — no change.
- Own-shift authority: the backstop (`…000001:124`) already denies substitution — no change.
- Branch predicate & report surfaces: untouched by every D-1…D-6 mechanism (all client-stratum + one R10 additive contract).
- Every R08 release record's inputs are the same post-D-1…D-6 by construction; preservation protocol unchanged (652/2/51 diff discipline), and future R09 records are additions only.

## 5. R06 COMPATIBILITY RESULT — PRESERVED WITH ONE NARROWED DECISION

R06's invariants (non-negative balance 23514; exactly-once via (business, source_type, source_id)) are untouched by models 1/3/4 and by every other decision. The ONLY friction is D-3 model 2 (FR-1), resolved by narrowing the option set — R06 remains byte-stable.

## 6. R10 DEPENDENCY RESULT — COMPATIBLE WITH ONE ADDITIVE CONTRACT

Metering remains server-authoritative and untouched. The single need is P-D2 (typed denial contract so the queue can distinguish entitled-denial from transient failure) — explicit, additive, owned by R10 sequencing per D-2's own instruction. No metering redesign.

## 7. CACHE/QUEUE SEPARATION RESULT — CLEAN

Wipe enumeration (persister DB/Cache Storage/localStorage `ledgr_*` ex-`/ledgr_pos_offline_queue`/sessionStorage) is disjoint from the preserved queue DB; the FR-3 clause closes the one ambiguous localStorage key. Accepted financial evidence deletion-by-wipe risk: **closed.**

## 8. BROWSER EVIDENCE FEASIBILITY RESULT — FEASIBLE

CI supports headless Chromium; lane/cost disciplines defined (P-D6-CI). No claim anywhere depends on unexecuted browser behavior today.

## 9. EXACT CHANGES REQUIRED TO THE PROPOSED DECISIONS (text amendments only — no decision reversal)

1. **D-3:** narrow the nominal option set to {1, 3, 4} (+ composite rules), with FR-1's note that original-model-2 outcomes are reachable via 3+4 only, unless a NEW DEC explicitly authorizes amending `chk_inventory_balances_on_hand_nonneg`.
2. **D-2:** append P-D2 as a named prerequisite: "typed quota-denial contract (dedicated errcode/structured shape), R10-owned, additive".
3. **D-4:** append FR-2 residual-risk line: legacy/branch-less server path remains open for old clients pending the DEC-09 version window + separately authorized additive server check.
4. **D-5:** append FR-3 clause: `ledgr_pos_offline_queue` localStorage data is accepted financial evidence (exempt from wipe; routed to D-1 quarantine); wipe enumeration is explicit-per-key, never wildcard.
5. **D-6:** append P-D6-CI lane/cost discipline (independent CI job, cache, flake budget, synthetic-only).

None alter the substance of any selection already made.

## 10. FINAL IMPLEMENTATION PREREQUISITES (per stage, before separate authorization)

| Stage | Status result here | Gate for authorization |
|---|---|---|
| R09.1 Cache confidentiality | D-5 CONSISTENT (+ FR-3 text fix) | D-5 signed with clause FR-3. No other gate. |
| R09.2 Queue provenance/binding/lease/quarantine | D-1 CONSISTENT; D-4 CONSISTENT (with FR-2 text fix) | D-1 + D-4 signed with their amendments; P-D1-Q in scope. |
| R09.3 Reconciliation | D-2 CONSISTENT WITH PREREQUISITE; D-3 WITH PREREQUISITE | P-D2 contract + P-D3-FINAL selection (from narrowed set) signed; D-4 rider confirmed. |
| R09.4 Browser evidence | D-6 CONSISTENT | D-6 signed with P-D6-CI lane discipline; lane lands first. |

---

## FINAL GATE

**R09 READY FOR STAGED AUTHORIZATION**

…subject to the §9 text amendments and the per-stage gates above. R08 remains CLOSED; baseline 652/2/51 untouched; no release record changed during this phase. No implementation is authorized by this report.
