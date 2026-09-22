# LEDGR — R09.1 CACHE CONFIDENTIALITY IMPLEMENTATION REPORT

**Release gate:** D-5 (Cache/Wipe Decision) — R09.1 slice of the R09 Offline High-Durability programme
**Mandate:** R09.1 Implementation Authorization (2026-09-22)
**Working tree:** branch `arena/01a0c215-ledgr-react` (continues PR #164 line)
**Author:** Agent (Arena Agent Mode) · **Date:** 2026-09-22

---

## 1. Objective

Close the cache-confidentiality gap found by T13 (`R09.BROWSER-CACHE-EXPOSURE`,
BLOCKED on tooling): **no cross-user cached business data may be retrievable by
another user on the same browser after a cache-clearing identity event**
(explicit logout; same-tab user switch). On identity transition, business-data
**caches** are erased and the emptiness is *verified*, while accepted offline
financial evidence — which is **not cache** — is preserved untouched.

## 2. Scope Implemented

In scope (single coherent WIPE implementation, keyed to logout + identity transition):

- Persisted React Query cache (IndexedDB `ledgr-rq-cache`, table `cache`) — already
  wiped at SIGNED_OUT; now also wiped on user switch and from a single owner module.
- Workbox HTTP cache for REST business data (`ledgr-api-cache`, prefix `/rest/v1/`) —
  **newly wiped** (the T13 hole).
- sessionStorage business caches — enumerated exact keys + named draft/recovery
  families only (no wildcard).
- localStorage business caches — audit confirmed **none exist** besides the preserved
  legacy evidence key (§4.2/§4.4); enumerated as an intentionally empty list.
- In-memory React Query cache on logout (defense-in-depth; previously only purged on
  user switch).
- Service-worker coordination: cooperative flush via `sw-events.js` message listener
  (smallest coordination mechanism; **no service-worker architecture redesign**).

Explicitly out of scope (deferred to distinct R09.2–R09.4 work): queue design/ownership
and cross-tab sync races (R09.2), typed quota-denial contract and stock-model mechanics
(R10/R09.3), browser-automation execution (R09.4).

## 3. Files Changed

### 3.1 Surface enumeration (audit basis, 2026-09-22, exact grep verification)

| # | Surface | Kind | Decision |
|---|---|---|---|
| 1 | IndexedDB `ledgr-rq-cache` / table `cache` | Business cache | **Wipe + verify** |
| 2 | Cache Storage `ledgr-api-cache` (Workbox, `/rest/v1/` GET SWR) | Business cache | **Wipe + verify** (was never wiped → T13 hole) |
| 3 | sessionStorage `ledgr_tax_reminder_shown` | View-state cache | Wipe |
| 4 | sessionStorage `ledgr_draft_*` (form drafts, `keyOf(businessId,…)`) | Business-data cache | Wipe (named family) |
| 5 | sessionStorage `ledgr_chunk_recovery_*` | Recovery temp cache | Wipe (named family) |
| 6 | localStorage `ledgr_pos_offline_queue` | **Accepted financial evidence** | **PRESERVE, never wipe** |
| 7 | IndexedDB `ledgr-offline` (queue) | **Accepted financial evidence** | **PRESERVE, never touch** |
| 8 | localStorage prefs/consent (`onboardingSkipped`, `ledgr-mobile-dashboard-preferences`, `ledgr_cookie_consent`, language, demo keys, `ledgr-partner-override`, `ledgr_ios_prompt_shown`) | Preferences / non-business | Leave untouched |

### 3.2 Implementation

| File | Change |
|---|---|
| `src/lib/cacheWipe.ts` | **NEW.** `wipeIdentityTransitionCaches(trigger)`: explicit-target cache erasure with delete→**verify-empty** loop (never success-by-timeout); structure report; preserved lists exported as constants; `verifyBusinessCacheEmptiness()` read-back probe (shared by the wipe and by tests); SW cooperative flush with bounded wait stated as advisory only. |
| `public/sw-events.js` | **EDIT (additive).** `message` listener for `R09_CACHE_FLUSH` → `caches.delete('ledgr-api-cache')` → `MessageChannel` reply `R09_CACHE_FLUSHED`. 22 lines, smallest coordination mechanism; no architecture change. The page still owns deletion + verification, so a missing/slow worker cannot turn a wipe into a skip. |
| `src/main.tsx` | **EDIT.** SIGNED_OUT handler now calls `wipeIdentityTransitionCaches('signed-out')` (replaces inline persister clear + ad-hoc `ledgr_*` session sweep — the session enumeration moved into the module as explicit keys/families). |
| `src/hooks/useAuthListener.ts` | **EDIT.** The `userChanged` branch **awaits** `wipeIdentityTransitionCaches('user-switch')` before the new user's businesses/profile hydrate — so no query of the incoming user is ever served from the outgoing user's persisted RAM/disk caches. This closed the second path (same-tab implicit switch) that the logout handler never saw. |
| `src/lib/cacheWipeTestAdapters.ts` | **NEW (test-only).** In-memory `CacheStorage` stub + repopulation-race scheduling (jsdom lacks the Cache API). Marked "test adapters only". |
| `src/lib/__tests__/cacheWipe.test.ts` | **NEW.** 11 unit tests (§7.1). |
| `tests/release/offline.test.ts` | **EDIT (additive only).** 6 release-harness records `R09.CACHE.*` (§7.2). No pre-existing record edited, renamed, or weakened. |
| `docs/audits/R09_DECISION_BUNDLE_2026-09-22.md` | **EDIT (text amendment, per mandate §2).** D-2/P-D2 note, D-3 narrowed option set, D-4 residual, D-5 evidence-not-cache clause, D-6 CI-lane discipline — same shapes already adopted in the consistency check document. No decision choice changed. |
| `docs/audits/LEDGR_R09_1_CACHE_CONFIDENTIALITY_2026-09-22.md` | **NEW.** This report. |

### 3.3 Behavior

- **Logout (SIGNED_OUT):** all surfaces in §3.1 rows 1–5 are erased; emptiness of
  rows 1–2 is *verified by read-back*; rows 6–7 remain byte-identical (checked by test).
- **User switch (same tab):** identical wipe, executed and awaited *before* the new
  identity's data hydrates (`useAuthListener`), in addition to the pre-existing
  in-memory store/query purges.
- **Idempotent** (repeated wipes safe), **absent-cache safe** (fresh browser = pass),
  **storage-disabled safe** (private browsing: each surface attempted individually and
  reported; verification honest about what could not be observed).
- **SW race handling:** cooperative flush shrinks the window; the deterministic
  guarantee comes from the page-side delete→verify-empty re-enforcement loop.

## 4. Preserved Evidence — Explicit Note

### 4.1 Offline queue database (`ledgr-offline`)

The trusted offline durable queue. **Accepted financial evidence, not cache.**
Never enumerated, never opened for clearing, never wildcard-deleted by this slice.
Ownership/design/payload normalization here is **R09.2's domain** and is untouched.

### 4.2 Legacy POS queue (`ledgr_pos_offline_queue`, localStorage)

Legacy (branch-less) accepted financial evidence. **Never deleted, never
wildcarded.** Its FINALLY-settled lifecycle (quarantine/apply/reject per D-1 + D-3)
belongs to **R09.2**; R09.1 only guarantees it survives identity transitions.

### 4.3 Test of preservation

`R09.CACHE.EVIDENCE-PRESERVED` and `R09.CACHE.NO-WILDCARD` (and the unit mirrors)
seed both surfaces, wipe, and assert **byte-identical** survival — including a
negative assertion that the reported removed-key set can never contain the preserved key.

### 4.4 Verification method (no arbitrary timeout == no fake success)

Every layer reports *observed* state: RQ entry count read back from IndexedDB; API
cache presence re-polled after each delete (up to 5 evidence-based attempts);
storage keys re-read. The SW flush bound (`swFlushMaxWaitMs`, default 2000)
bounds *coordination patience*, never *success* — a timeout there only records
`swFlushAcknowledged: false`; the wipe still completes through the deterministic
page-side loop.

## 5. Limitations / Residual Risk (per mandate §3.3)

1. **Sub-RTT in-flight writes.** A response that *completes and is put into Cache
   Storage in the same microtask-window between the verified-empty observation and
   process teardown* could, in principle, re-create a cache entry after
   verification. The re-enforcement loop, the awaiting wipe-before-hydration on user
   switch, and the SW-side delete shrink this to near zero; it is stated honestly as
   "***near-complete*** guarantee" for sub-millisecond leak vectors. Full in-browser
   proof is **R09.4** (browser lane, deferred as authorized).
2. **No real-browser execution in this slice.** jsdom + fake-indexeddb + the in-memory
   CacheStorage stub model the browser storage contracts, but they are not Chromium.
   `R09.BROWSER-CACHE-EXPOSURE` therefore remains **BLOCKED** (tooling), exactly as
   authorized. No claim of browser proof is made here.
3. **SW flush advisory only.** An un-updated (old) `sw-events.js` worker cannot answer
   the flush message; the page-side delete→verify loop still delivers the guarantee.
4. Hook paths (`main.tsx` SIGNED_OUT, `useAuthListener` user switch) are composition-
   layer wiring verified by module tests and type/build gates; end-to-end event-level
   assertion is part of the future R09.4 browser runs.

## 6. Validation Summary

| Check | Result |
|---|---|
| App TypeScript (`npm run typecheck`) | **PASS (0 errors)** |
| Release types lane (`npm run test:release:types`) | **PASS** (rebuilds embedded postgres schema) |
| ESLint (`npm run lint`) | **PASS** (0 errors; 1 pre-existing warning in generated artifact) |
| Unit (`npm run test`) | **683/683** (672 baseline + 11 new) |
| Build (`npm run build`) | **PASS**; `dist/sw-events.js` verified to embed `R09_CACHE_FLUSH` handler |
| Release harness ×2 (`npm run test:release`) | **658 PASS / 2 FAIL / 51 BLOCKED / 0 NOT APPLICABLE — 711 records; two runs byte-identical** |

Baseline preservation, exactly as gated: 652 + 6 additive = **658** PASS;
2 gate FAILs unchanged (`EDGE.RETRY.no-secret`, `EDGE.WEBHOOK.viewer`);
51 BLOCKED unchanged (R09.4-dependent browser/tooling records intact);
`OFFLINE.BROWSER-CACHE-EXPOSURE`/`R09.BROWSER-CACHE-EXPOSURE` records untouched.

## 7. Tests Executed (mandate §7)

### 7.1 Unit — `src/lib/__tests__/cacheWipe.test.ts` (11 tests, all PASS)

1. RQ persister removed after logout — verified count read-back.
2. Workbox `ledgr-api-cache` removed — verified absent.
3 + 9. Cross-user read-back: prior user's RQ/API/draft/reminder surfaces all
   unreadable after a `user-switch` wipe.
4. Repeated wipe idempotent; second run removes nothing and still verifies.
5. Absent-cache platform (fresh browser) wipes safely.
6. `ledgr_pos_offline_queue` survives byte-identical.
7. `ledgr-offline` queue row survives intact.
8. Non-target `ledgr_*` keys (preferences/consent) untouched; preserved key never in the
   removed set; explicitly-enumerated draft key removed.
10. Repopulation race: two scheduled late puts after delete → attempts ≥ 3 → still
    verified empty.
• SW coordination ×2: acknowledged when a worker replies; absent worker is normal
  (`null`) and never blocks/fails the wipe.

### 7.2 Release harness — `tests/release/offline.test.ts` (6 additive records, all PASS)

`R09.CACHE.WIPE-VERIFIED-EMPTY`, `R09.CACHE.EVIDENCE-PRESERVED`,
`R09.CACHE.REPEAT-AND-EMPTY-SAFE`, `R09.CACHE.USER-SWITCH-ISOLATION`,
`R09.CACHE.REPOPULATION-REENFORCED`, `R09.CACHE.NO-WILDCARD`
— same synthetic-only data, deterministic, `npm run test:release` unchanged in
interface/routing, ×2 identical runs, evidence sanitized into owned `.cache` dir.

## 8. Risks / Residual Items

| # | Risk | Disposition |
|---|---|---|
| FR-1 | Controlled-oversell option collides with R06 nonnegative invariant (23514) | **Reduced scope:** D-3 narrowed to {restricted, reject/quarantine, reconciliation}; oversell forbidden unless a future explicit decision amends the server invariant (bundle amended). |
| FR-2 | Legacy branch-less **server** path still open for old clients | Recorded residual (bundle D-4); the version window + additive check are **not R09.1** — DEC-09 slice. R09.1 does not touch posting semantics. |
| P-D2 | Quota denial is P0001 message-text, not a typed error contract | **R10-owned**, consumed by R09.3 conflict handling; declared in the bundle; not implemented here. |
| FR-CLIP | SW/Archive/RQ hybrids, including RQUID key-dimension ambiguity (key-quirk `true-quirk r8`) | R09.1's `clearPersistedCache()` scoped-by-businessId semantics unchanged; **not** introduced anywhere. |
| Lane | Browser lane (Playwright-like) not installed | D-6 discipline recorded: independent lane, cache binaries, flake budget, synthetic-only, **not part of type/lint/build/unit/release harness — not gating here**. |

## 9. Final Confirmation

**Acceptance criterion — "No cross-user cached business data retrievable by another
user on the same browser after a cache-clearing identity event."** For all surfaces
**addressed in this slice**, demonstrated as far as the authorized harness environment
(jsdom + fake-indexeddb + CacheStorage stub) supports: yes, verified empty after
logout **and** same-tab user switch, with queue exclusions preserved. Remaining
browser-leak vectors (sub-millisecond in-flight writes, real-browser storage
implementations) are disclosed in §5 and deferred to the separately authorized
R09.4 browser execution lane.

**R08 reference state unchanged.** R08 suite counts, FAIL gate assignments,
additions, and report bytes untouched (only additive `R09.CACHE.*` records added to
the shared offline suite; pre-existing records byte-identical).

## 10. Final Gate

**R09.1 WIPE MODEL IMPLEMENTED — VERIFIED IN CURRENT HARNESS;**
**BROWSER VERIFICATION STILL PENDING (R09.4, SEPARATELY AUTHORIZED);**
**SIGNED_AUTHORS REQUIRED FOR R09.2 onward.**

(STOP condition honored: no R09.2/D-1/D-3 server or queue-semantics changes made;
no quota/stock/actor-binding/batching changes; no production data touched; R08
baseline intact; no new decisions invented — ambiguity surfaced, prerequisites
recorded.)

## 11. Authorization and Sign-off

Waiting for review of this report + the amended decision bundle. The remaining
slices proceed **only** on their own authorizations:
R09.2 (offline queue lifecycle + D-1/ownership), then R09.3 (conflict/typed
contracts after P-D2), then R09.4 (browser lane per D-6 discipline).
