# LEDGR — R09.2 QUEUE PROVENANCE, ACTOR BINDING, CROSS-TAB LEASE & LEGACY QUARANTINE IMPLEMENTATION REPORT

**Release gate:** R09.2 — Queue Integrity (R09 Offline High-Durability programme)
**Mandate:** R09.2 Implementation Authorization (2026-09-22)
**Working tree:** branch `arena/01a0c215-ledgr-react` (PR #164), on top of R09.1 (`f39de03`)
**Author:** Agent (Arena Agent Mode) · **Date:** 2026-09-22

*Note: the mandate text cites commit `4363e77` as "the R09.1 implementation point"; R09.1 actually landed as `f39de03` (4363e77 is the R08 cycle). This report treats `f39de03` as the verified baseline to preserve; all preservation checks were computed against it.*

---

## 1. Objective

Establish four controls over the browser offline queue — the store that is
**evidence and workflow state**, with the server remaining the ultimate
authority:

1. Offline queue **provenance** at capture (Dexie v2, additive/lossless).
2. **Original-actor binding at replay** (Case A replay / Case B DENY+quarantine /
   Case C quarantine).
3. **Cross-tab exclusive replay lease** (browser-visible coordination).
4. **Legacy POS queue quarantine** (accepted evidence, never auto-attributed).

Client-supplied provenance is **evidence only**. It cannot grant membership,
role, branch, terminal, shift, posting, R07, or R08 authority; `auth.uid()` and
all server checks remain authoritative.

## 2. Scope Implemented

- Dexie `ledgr-offline` **v1 → v2** schema upgrade: additive perspective fields
  (`payloadVersion`, `originUserId`, `originDeviceId`, `capturedAt`,
  `branchId`, `shiftId`, `terminalId`), quarantine metadata
  (`status: 'quarantined'`, `quarantineReason`, `quarantinedAt`,
  `quarantineDetails`), and lease metadata (`lease`). Indexes unchanged;
  upgrade writes ONLY defensive `null` defaults (never fabricates provenance)
  and is idempotent/re-runnable (IDB upgrade transaction is atomic).
- New modules: `provenance.ts` (capture/verify/sweep), `lease.ts`
  (claim/renew/verify/release + deterministic reclaim), `deviceIdentity.ts`
  (install id + per-tab session id; lease claimant = `install/tab`, **never a
  user id alone**).
- `enqueue` captures provenance from the hydrated app session (+ context where
  payload carries it); with no authenticated user it records `null`, never
  invents one.
- `syncQueue` pre-flight `sweepUnverifiableItems` before ANY network replay;
  fail-closed actor gate; per-item lease claim before `syncing`; lease-loss
  guard mid-write; release on success **and** terminal failure.
- Legacy queue: `migrateLegacyPosQueue`/stub-repair now routes into durable
  **quarantine** (reason `legacy`) with payloads preserved verbatim. No
  auto-replay, no auto-attribution, no transfer authority (none was authorized).
- Drawer visibility (§11): "Security hold" chip + reason + capture/origin
  summary + "requires assisted recovery" header count. No payload contents.
- `useSyncQueue` passes `currentUserId` explicitly from the app session.

Explicitly out of scope (as mandated): DEC-09 server-path closure, typed quota
contract (R10 → R09.3), R08 closed-shift behavior, any manager-transfer or new
financial approval workflow, browser-automation execution (R09.4).

## 3. Files Changed

| File | Change |
|---|---|
| `src/offline/db.ts` | v2 upgrade + `QueueItem`/status/quarantine/lease types. |
| `src/offline/provenance.ts` | **NEW.** Capture, `hasTrustworthyProvenance`, `replayViolation`, `sweepUnverifiableItems`, `quarantineItem`. |
| `src/offline/lease.ts` | **NEW.** Serialized IDB-transaction claim, renewal, verification, release; `LEASE_TTL_MS` (existing `STALE_SYNC_CLAIM_MS` untouched). |
| `src/offline/deviceIdentity.ts` | **NEW.** Install id, tab session id, `getLeaseClaimantId`. |
| `src/offline/queueApi.ts` | enqueue provenance/context capture. All selection/count helpers already exclude `quarantined`. |
| `src/offline/syncEngine.ts` | Sweep + gate + lease integration (main & deferred loops); `SyncProgress.skipped`. |
| `src/offline/legacyPosQueue.ts` | Quarantine routing (`enqueueQuarantinedLegacy`, stub repair → quarantine). |
| `src/components/layout/OfflineQueueDrawer.tsx` | Security-hold rendering + count. |
| `src/hooks/useSyncQueue.ts` | Explicit `currentUserId`. |
| `src/offline/__tests__/*` | 3 NEW unit files (provenance/lease/migration, 21 tests); legacy test expectations updated to the mandated quarantine behavior. |
| `src/offline/__tests__/posSaleSync.test.ts` | Scaffolding only: test identity seeded (replay pre-condition). |
| `tests/release/offline.test.ts` | Additive: 14 `R09.QUEUE.*` records + session wiring + rpc call counter. **No existing record altered, renamed or weakened.** |
| `docs/audits/LEDGR_R09_2_QUEUE_INTEGRITY_2026-09-22.md` | This report. |

## 4. Provenance & Actor Binding — Mechanics

`queued → provenance check → actor check → lease → existing replay → server authority → state`.

- **Case A (same actor):** `replayViolation` null → normal path
  (`commitPosSaleDocuments → post_pos_sale`, existing idempotency).
- **Case B (different actor):** `sweepUnverifiableItems` writes durable
  `quarantined/actor-mismatch` BEFORE any RPC; payload, provenance, keys,
  timestamps preserved; never retried; never attributed to the current user.
- **Case C (missing/unverifiable):** same path with `missing-provenance`
  (v1 rows, forged/stripped rows). v1 rows are not deleted — they sit
  quarantined awaiting assisted recovery.
- **Self-unknown** (signed-out pass): replays nothing, mutates no
  provenance-bearing item (fail closed; evidence unharmed by transients).
- **Forged provenance** is self-defeating: editing `originUserId` only widens
  the mismatch set; the client gate quarantines it and the server still
  derives the actor from the session token (proven by the server's denial for
  a non-member session — R09.QUEUE.ACTOR-BINDING.FORGED).

## 5. Cross-Tab Lease — Mechanics

Read-check-write inside a single readwrite IDB transaction on the `queue`
store (serialized by the engine), plus a post-claim token read-back
verification. Expiry is the ONLY reclaim condition, at-or-after `expiresAt`;
concurrent reclaim attempts run through the same serialized claim so exactly
one wins. A user id is never a lease identity; claimants are install/tab
tokens. Renewal/verification only accepted for the exact lease token. Terminal
or successful states always end with `lease: null`; quarantine also clears
leases (§7/§18). The pre-existing stale-`syncing`-claim recovery remains
byte-for-byte intact.

## 6. Legacy Queue (§5)

- `ledgr_pos_offline_queue` entries and old-build stubs are **accepted
  financial evidence**: they (and their repair products) now enter
  `quarantined/legacy` with all metadata preserved, no provenance fabricated.
- They are never replayed, never silently attributed, never discarded.
- R09.1 cache-confidentiality preservation remains intact and now has an
  explicit combined test (`R09.QUEUE.LEGACY.WIPE-NONDELETION`).
- Assisted recovery: **not implemented** (visibility only, as authorized; no
  transfer/approval workflow).

## 7. Limitations / Residuals

1. **Two new records are honestly BLOCKED**, not manufactured into PASS:
   `R09.QUEUE.ACTOR-BINDING.SAME-USER` and `R09.QUEUE.REGRESSION.REPLAY-CONTRACT`
   require real-DB replay + `authenticated` invoice readback — the exact
   environmental limit that already BLOCKs `OFFLINE.REOPEN`/`OFFLINE.RETRY` in
   the migration-only profile. Assertions are complete behind the gate.
2. **Existing BLOCKED records untouched**, incl. `OFFLINE.ACTOR-BINDING` and
   `OFFLINE.MULTITAB` (even though R09.2 resolves their stated preconditions) —
   per mandate §13, unblocking is a separate evidence decision; R09.4 owns
   browser-context proof of the lease in real Chromium.
3. **Lease races are proven on deterministic fake-indexeddb serialization**;
   real-browser concurrent contention is deferred to R09.4. Sub-millisecond
   IDB anomalies (as in R09.1 §5) remain disclosed-impossible-in-practice
   residual, not hidden.
4. **Legacy server branch-less path**: unchanged residual (DEC-09 window +
   separately authorized additive check; not implemented here).
5. Quarantine **revival/transition workflow** (D-1 re-entry semantics) is
   deliberately not built in this slice (no new authority paths).

## 8. Validation Summary

| Check | Result |
|---|---|
| App TypeScript | **PASS (0 errors)** |
| Release types lane | **PASS** |
| ESLint | **PASS (0 errors; 1 pre-existing generated-artifact warning)** |
| Unit (`npm run test`) | **704/704** (683 R09.1 state + 21 new/changed: 22 new − 1 counter adjusted) |
| Build | **PASS** |
| Release harness ×2 (`npm run test:release`) | **670 PASS / 2 FAIL / 53 BLOCKED / 0 NOT APPLICABLE — 725 records, byte-identical runs** |

Baseline arithmetic: 711 + 14 additive `R09.QUEUE.*` = **725**; 658 + 12
(certainly-PASS queue records) = **670**; 51 + 2 (profile-honest BLOCKED,
same category as RETRY/REOPEN) = **53**; FAIL unchanged at exactly the two
gate assignments (`EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer`).

## 9. Tests Executed (mandate §12 mapping)

- **Provenance 1–5 + capture-null:** `R09.QUEUE.PROVENANCE.*`, unit
  `provenance.test.ts`.
- **Migration 6:** unit `migration.test.ts` (real v1-schema build→upgrade).
- **Actor 7:** `R09.QUEUE.ACTOR-BINDING.SAME-USER` (BLOCKED by profile;
  synthetic-commit positive proof in `MULTITAB.SUCCESS-RELEASES`; unit 7).
- **Actor 8–12 + unknown-actor:** `R09.QUEUE.ACTOR-BINDING.{MISMATCH,FORGED,MISSING}`,
  `R09.QUEUE.QUARANTINE.DENY-RETRY-DURABLE` (durability across reload), all
  PASS; unit mirrors.
- **Cross-tab 13–18:** `R09.QUEUE.MULTITAB.LEASE-EXCLUSIVE` (13/14),
  `EXPIRED-RECLAIM` (15/16 + boundary), `SUCCESS-RELEASES` (17),
  `FAILURE-RELEASES` (18), all PASS.
- **Legacy 19–23:** `R09.QUEUE.LEGACY.QUARANTINED` (19/20/21/23),
  `R09.QUEUE.LEGACY.WIPE-NONDELETION` (22), PASS.
- **Regression 24–28:** `R09.QUEUE.REGRESSION.REPLAY-CONTRACT` (clientKey
  exactly-once behind BLOCKED); R08/R07/R06/R05 suites themselves unchanged
  and green; no server authorization path widened (proven by FORGED).

## 10. Preservation Audit (mandate §14)

Computed against R09.1 implementation point `f39de03`:

- R08 migration files, DAL repositories, Edge functions, `post_pos_sale`
  surface, R07/R06/R05 contracts: **byte-identical (0 files differ)**.
- R09.1 cache wipe (`cacheWipe.ts`, `sw-events.js`, hooks): unchanged;
  `ledgr-offline` and `ledgr_pos_offline_queue` never in wipe targets (test-proven).
- No quota contract, no stock behavior, no actor-binding server RPC, no new
  decisions. Synthetic data only throughout.

## 11. Final Gate

**R09.2 QUEUE INTEGRITY IMPLEMENTED — VERIFIED IN CURRENT HARNESS;**
**BLOCKED evidence stays BLOCKED (+2 new honest BLOCKED by shared profile limit);**
**R09.4 owns browser-context proof; SIGNED_AUTHORS REQUIRED for R09.3.**

(STOP conditions honored: no R08/server-auth/SW-redesign changes; no queue
deletion of legacy/unverifiable rows; no production data; no manager-transfer
or approval workflow; ambiguity surfaced instead of silently resolved.)
