# R09.4 — Real-Browser Runtime Evidence for R09.1–R09.3 Offline/Cache/Tenant-Boundary Contracts

**Date:** 2026-09-23 (Africa/Johannesburg)
**Status:** Work product of the ACTIVE R09.4 owner-authorized mandate (evidence + reconciliation work in a REAL browser; harness only, no product changes)
**Suite:** `tests/release/r094-browser.test.ts` (17 records, all ids `R094.BROWSER.*`, additive only)
**Gate integration:** registered in `tests/release/gate.mjs`; full R13 gate re-run end-to-end after integration; R13 gate semantics (`evidenceExit`) unchanged
**Baseline at authorization:** R13 gate 709 PASS / 0 FAIL / 54 BLOCKED / 763 records
**Gate after this package:** 725 PASS / 0 FAIL / 55 BLOCKED / 780 records = baseline 763 + exactly 17 additive records (16 PASS + 1 additive BLOCKED, explicit filing; zero FAIL, zero reclassification of any pre-existing record)

---

## SECTION 1 — EXECUTIVE DECISION SUMMARY

All 17 mandated R09.4 records were produced in a **genuine headless Chromium browser process** (real IndexedDB, real CacheStorage, real BroadcastChannel, the real built production service worker), with **zero simulation** of any browser capability and **zero changes to product logic, branches, migrations, Edge functions, pricing, GAP-6, DEC-03/DEC-09, TTL/CONFLICT policy, queue policy, rollout flags, or CI gate semantics**.

- **16 records PASS**, including the previously uncovered runtime areas: real service-worker lifecycle and workbox runtime-cache flush, provenance-survives-a-real-browser-process-restart, signed-out/user-switch cache boundary preservation with the offline queue intact, REAL cross-tab lease exclusivity with exactly one replay RPC, typed exception stamping for P0QLT and 23514 with no blind retry, the manager reconcile client path with byte-exact payload preservation and idempotent lost-ack, the real OfflineQueueDrawer exception UI and its manager affordance gate, real offline→online transition behavior, and a **measurement-only** record of stale payloadVersion behavior (feeding DEC-09, deciding nothing).
- **1 record is BLOCKED** with an exact environmental limitation and is explicitly filed: `R094.BROWSER.SERVER-REVALIDATION` — server-authoritative reconciliation revalidation from a browser session requires a real disposable Supabase backend reachable over the wire, which this sandbox cannot provision (no Docker; the DB-suite embedded Postgres is process-local; network egress is restricted). The DB-side RPC authority remains covered by the sealed `R093.RECON.*` records against a real database; this package's BLOCKED is scoped strictly to *browser-driven real-server revalidation*. The 54 baseline BLOCKED record ids are unchanged.

No FAIL records. No remediation package was required (Section 17 defines an optional, explicitly out-of-scope future enhancement only). The recommended next implementation package and its exact exclusions are out of scope for this mandate; the previous P1 (R09.4) is discharged here.

## SECTION 2 — MANDATE COVERAGE TABLE

| Mandate item | Fulfilled by | Result |
|---|---|---|
| §2 real-tooling capability check; BLOCKED if no real browser | Section 4 | PASS — genuine Chromium launches; zero simulation |
| §3 verify baseline 709/0/54/763 | Section 3 | PASS — 763→780 (+17 additive only) |
| §5 real application page load | §5 below | PASS — real built PWA served and booted |
| §6 service-worker lifecycle (real, no SW simulation) | §6 | PASS (register→install→activate→claim→control→reload→precache; runtime API cache warm + production flush). *SW **update-install** path: not exercised (documented, §6.3).* |
| §7 offline queue persistence incl. real process restart | §7 | PASS |
| §8 cache wipe evidence (queue PRESERVED; tenant caches flushed) | §8 | PASS |
| §9 user-switch evidence | §9 | PASS |
| §10 cross-tab AND/OR browser-restart evidence (no duplicate replay; fail-closed lease loss) | §10 | PASS (both: cross-tab exclusivity AND process restart; lease loss fail-closed) |
| §11 provenance evidence in the browser | §11 | PASS |
| §12 exception + manager reconciliation evidence; honest server-node split | §12 | PASS (client path, exceptions, drawer) + **BLOCKED** (server-node: `R094.BROWSER.SERVER-REVALIDATION`) |
| §13 stale payloadVersion measurement (record only, feed DEC-09) | §13 | PASS (measurement: stale/newer versions still replay today) |
| §14 real offline→online transition evidence | §14 | PASS |
| §15 sealed-pair protection (R06.CONCURRENT/R09.QUEUE/AUTH/BRANCH untouched) | §15 | PASS — verified additive-only by record-id diff |
| §16 determinism mandate | §16 | PASS — two consecutive suite runs byte-identical |
| §17 additive-only records | §17 | PASS — 763→780 reconciliation |
| §17 R13 gate semantics untouched | §17 | PASS — `gate.mjs`/`evidenceExit` semantics unchanged (only suite registration appended) |
| §19 a defect found → separate package, never reuse names | §17 | No product defects observed |
| §20 this report | this file | — |
| §21 exactly one classification | Section 18 | COMPLETED WITH DOCUMENTED BLOCKED EVIDENCE |
| §22/§23 STOP conditions; no subsequent package | §17, §18 | Honored — work stops at this filing |

## SECTION 3 — BASELINE VERIFICATION

Verified before reporting by re-running the **full** R13 gate after suite integration (`node tests/release/run.mjs`, sanitized environment) and partitioning the aggregated `evidence.json` by record id:

- Records **not** prefixed `R094.BROWSER.`: **763 total = 709 PASS / 0 FAIL / 54 BLOCKED** — exactly the authorized baseline at R09.3 Part B (statuses and ids unchanged; confirmed by id-level diff).
- Records prefixed `R094.BROWSER.`: **17 total = 16 PASS / 0 FAIL / 1 BLOCKED**.
- Aggregated: **780 = 725 / 0 / 55** ✓.
- Closed-pair protection: `R06.CONCURRENT.LOOPBACK-COMMIT`, `R06.CONCURRENT.EDGE-CONFLICT`, `R06.CONCURRENT.WEBHOOK-CONTRACT`, `OFFLINE.CROSS-TAB.LEASE-EXCLUSIVE`, `OFFLINE.CROSS-TAB.LEASE-PERSIST`, `R09.AUTH.GUARDS-ACTIVE-A`, `R09.BRANCH.GUARDED-MUTATIONS-CONNECTED` retain their baseline ids/statuses; no record was renamed or reclassified.

## SECTION 4 — TOOLING LAYER VERIFICATION (§2)

Real-browser capability exists in this sandbox and was proven, not assumed:

- **Driver:** `playwright-core@1.49.1` (devDependency) driving **`@sparticuz/chromium@138.0.2`** — a genuine Chromium 138.0.7204.0 binary distributed via npm (`npmjs` is the only reachable registry; Debian/Playwright/puppeteer/chrome-for-testing CDN egress is TLS-reset in this sandbox).
- **System libraries:** the sandbox image lacks `libnspr4`, `libnss3`, `libnssutil3`; they are taken **verbatim from @sparticuz/chromium's own `al2023` companion pack** (real NSPR/NSS builds; extracted once per run via Node `zlib.brotliDecompressSync` + `tar`) and provided through `LD_LIBRARY_PATH`. Nothing is stubbed — a fake crypto/network layer would invalidate every browser claim.
- **Driver argument correctness:** sparticuz's default `--single-process --no-zygote` args are **removed** (a second page would otherwise kill the whole browser process).
- **Probe matrix (executed before suite implementation):** service worker registration→active, real IndexedDB write/read, two distinct browser contexts, a second page in one context, `setOffline(true/false)` — all verified working.
- **Zero-simulation declaration:** the suite never uses jsdom, fake-indexeddb, an emulated storage layer, a faked service worker lifecycle, or a mocked cache API. Where the mandate's wording would otherwise imply a simulation (SW "activation", IndexedDB), the real browser primitive is used.

## SECTION 5 — REAL APPLICATION PAGE LOAD

- The real Vite production build (`npm run build` with `VITE_SUPABASE_URL=https://r094.invalid`, matching the compiled workbox runtime host) is served by the harness stub with SPA fallback and SW-correct headers (`service-worker-allowed: /`, `no-cache` on `sw.js`).
- The app **boots** in the real browser: shell HTML served through the controlled load and on reload; `#root` present; the production runtime registers its production `sw.js`. (The app proceeds to the login shell because the harness origin has no authenticated session; no product behavior was altered for the gate.)

## SECTION 6 — SERVICE WORKER LIFECYCLE EVIDENCE

Records: **`R094.BROWSER.SW-LIFECYCLE` (PASS)**, **`R094.BROWSER.SW-API-CACHE-FLUSH` (PASS)**.

### 6.1 Registration→activation→control (SW-LIFECYCLE)

In a real context with `serviceWorkers: 'allow'`: the page loads the PWA → the production SW registers → install completes (its workbox precache is written: **`workbox-precache-v2-http://127.0.0.1:<port>/` with 14 entries**) → activation with `skipWaiting()` + `clientsClaim()` (both verified present in the shipped `sw.js` source) → after `page.reload`, the document is **observed-activated and controlled, polled for stability across three consecutive samples** (trace `activated/ctrl` steady; the sampling poll excludes transient registration windows — an earlier point-sample read a real transient `active=null` mid-transition). The app shell is served on the controlled second load.

### 6.2 Runtime API cache + production flush (SW-API-CACHE-FLUSH)

Key unsimulated chain: the harness page is loaded **before** the app SW activates (it becomes a claimed client via `clientsClaim()` — the production load path), then a controlled page issues a real `fetch('https://r094.invalid/rest/v1/products?…')`. The fetch is intercepted by the **real service worker's production workbox NetworkFirst route** (`^https://r094\.invalid/rest/v1/`, cacheName `ledgr-api-cache`) and reaches the network — measured **stub-side as `swTlsReads=1`** (see §15 for the PAC/TLS plumbing), `fetchStatus=200` — and lands in CacheStorage: **`ledgr-api-cache` entriesAfterFetch ≥ 1**. The **production** `wipeIdentityTransitionCaches('signed-out')` then flushes the SW's caches over the real postMessage flush request/reply (`R09_CACHE_FLUSH`): **beforeWipe=1 → afterWipe=0**.

Seam honesty: runtime-cache *warmth* is measured on the cache object itself; no cache API is mocked. The first measurement attempt over-read a `waitUntil` cache-put timing (respond-with precedes cache write) — the record polls the real cache until the entry is observable instead of assuming a synchronous boundary; the mechanics are real SW semantics, not a simulation.

### 6.3 Not-exercised disclosure (no fake record)

The **update-install** behavior of the service worker (a *second, differently-versioned* `sw.js` arriving mid-session and the version-flow cable's update/hijack handling) was **not exercised**: evidence would require building and serving two distinct real PWA versions plus the origin-reload update machinery; simulating a version bump in a previously-frozen origin would be exactly the "fake service worker lifecycle" the mandate forbids. It is listed as an optional future-scope enhancement in Section 17 — not silently skipped, not claimed, and not a PASS/BLOCKED record.

## SECTION 7 — OFFLINE QUEUE PERSISTENCE ACROSS A REAL BROWSER-PROCESS RESTART

Record: **`R094.BROWSER.PERSIST-RESTART` (PASS)**.

A sale is enqueued with the production `enqueue` (provenance fields injected by the app store seam: `originUserId=USER_A`, real `originDeviceId` from production device identity, real captured `payloadVersion`/`payloadHash`/`clientKey`, branch/terminal/shift ids); the legacy POS `localStorage` key and the persisted React-Query blob are warmed. The **entire browser process is terminated** (persistent-context close), then the **same on-disk profile** is relaunched — a real restart, not a page close. After restart: **all provenance fields are byte-equal (`fieldsEqual=true`)**; `verifyPayloadIntegrity` **re-hashes the on-disk payload and verifies true**; the legacy queue key is intact with its exact sentinel value; the persisted cache blob still contains its marker. This directly evidences the IDB persistence behavior the R09.1/2/3 contracts assert (and is the process-restart half of §10).

## SECTION 8 — CACHE WIPE EVIDENCE (SIGNED-OUT)

Record: **`R094.BROWSER.WIPE-LOGOUT-BOUNDARY` (PASS)**.

Seeded in a real context: 1 pending queue row, a warmed persisted RQ blob (marker `wipe-a`), a warmed `ledgr-api-cache` entry, a product session-cache **family** key (`ledgr_draft_r094`), the preserved legacy POS localStorage key, and the real install/device id. The production `wipeIdentityTransitionCaches('signed-out')` was executed and `verifyBusinessCacheEmptiness()` interrogated. Observed: **queue rows 1→1 preserved (item intact with client key)**; **install/device id unchanged**; **session family key removed**; **legacy key byte-exact preserved**; **persisted RQ blob cleared of the business marker**; **API cache 0 entries**. The wipe never touches the offline queue or device identity — the R09.1 contract in the real browser.

## SECTION 9 — USER-SWITCH CACHE EVIDENCE

Record: **`R094.BROWSER.WIPE-USER-SWITCH` (PASS)**.

User A's business data is persisted (marker `switch-a-marker`), the production switch-trigger wipe runs, then user B's data (`switch-b-marker`, `r094-biz-b`) is persisted with the production persister (single-blob `rq-state` schema — enumeration is content-based, matching production reality). Observed: **aMarkers remaining = 0** (nothing of business A: no marker, no A query keys); **B entries present and exclusively B**; **business A's pending queue row still exists, status `pending`, businessId `r094-biz-a`** — the documented queue-preservation contract (queue belongs to the device boundary, not the app identity), never fabricated as an "A→B handover".

## SECTION 10 — CROSS-TAB EXCLUSIVITY AND FAIL-CLOSED LEASE LOSS

Records: **`R094.BROWSER.LEASE-CROSSTAB-EXCLUSIVE` (PASS)**, **`R094.BROWSER.LEASE-EXPIRY-RECLAIM` (PASS)**.

### 10.1 Cross-tab exclusivity with a real replay in flight

Two live pages in **one real context** (shared IndexedDB, real BroadcastChannel, distinct production lease claimants from real tab identity) race the production sync engine on ONE pending sale while the server (stub seam) delays its response 900 ms. Observed stub-side: **exactly ONE `post_pos_sale` replay RPC for the client key**; the losing tab's engine failed closed on the lease (item not replayed twice); the item finished `synced` with `resolvedServerId` set. No duplicate replay.

### 10.2 Lease loss is fail-closed; takeover only after real TTL

With a 900 ms TTL claim by a "dying tab" claimant: a second claimant while held is refused `held-by-other`; after real elapsed time the lease is `expired=true`; the new claimant then **acquires**; token-strict `verifyLeaseOwnership` returns `false` for the old token and `true` for the new one; release clears the lease. Fail-closed lease loss is verified with the production lease module, a real clock, and a real IDB transaction — the same locking the engine and reconciliation use.

## SECTION 11 — PROVENANCE EVIDENCE IN THE BROWSER

Record: **`R094.BROWSER.PROVENANCE-REPLAY-GATE` (PASS)**.

Against one enqueued item: **same actor → no replay violation** (`null`); **another actor → `actor-mismatch`**; **provenance-stripped clone → `missing-provenance`**; an **after-capture payload edit** (following the shipped eligibility gate: first a live typed exception is present) makes `verifyPayloadIntegrity` return **false**, the production reconciliation **returns a rejected result (`payload-tampered`) without network**, and the row becomes **quarantined / `payload-tampered`**; the origin actor (`USER_A`) is preserved throughout — never reattributed. (Eligibility order in the shipped code is intentional: `not-an-exception` is refused before the integrity check for non-exception rows.)

## SECTION 12 — EXCEPTION AND MANAGER RECONCILIATION EVIDENCE

Records: **`R094.BROWSER.EXCEPTION-P0QLT` (PASS)**, **`R094.BROWSER.EXCEPTION-23514-TYPED` (PASS)**, **`R094.BROWSER.RECONCILE-CLIENTPATH` (PASS)**, **`R094.BROWSER.SERVER-REVALIDATION` (BLOCKED — explicit filing)**.

- **P0QLT:** a production-shaped plan-quota refusal through the **real engine** stamps `failed` + `exceptionClass: policy-denied` with durable details ("will not sync automatically…"); a subsequent sync pass issues **0 RPCs for that client key** — no blind retry, per the sealed R09.3 contract now evidenced end-to-end in a browser.
- **23514 typing by constraint identity:** the on-hand non-negativity constraint (`chk_inventory_balances_on_hand_nonneg`) stamps `stock-denied`; a **different** 23514 constraint (`chk_invoices_total_positive`) stamps **no** typed exception (`exceptionClass: null`, still `failed`). Never ambiguously both — fingerprinting is by identity, not substring.
- **Reconcile client path:** with the production `reconcileQueueItem`: `p_request` carries the **original `client_key` + required reason**; the stored payload stays **byte-identical** (`canonicalPayloadJson` equality before/after); on `{ok:true, document_id}` the row becomes `synced` with `resolvedServerId`, `reconcileAttempts=1`, and the **historical exception evidence retained** (`lastErrorCode: P0QLT` — the frozen audit identity); a repeated reconcile of the same client key accepts **idempotently** (`idempotent:true`) with **no duplicate** (`reconcileAttempts=2`, still one document id; every decline path restores the exception — asserted through the first refusal in this record chain).
- **Server node (BLOCKED, filed):** `R094.BROWSER.SERVER-REVALIDATION` — *"Server-resident reconciliation revalidation from a browser session requires a REAL backend (Postgres + Edge functions + auth) driven over the wire. This sandbox has no disposable Supabase harness for browser traffic (no Docker; DB-suite embedded-Postgres is process-local, not network-addressable; the stub only models the HTTP shape). Client-path and UI evidence is recorded in R094.BROWSER.RECONCILE-CLIENTPATH / DRAWER-RECONCILE-GATING / EXCEPTION-*; the DB-side RPC authority remains covered by the sealed R093.RECON.* records against a real disposable database. This BLOCKED is scoped strictly to browser-driven real-server revalidation."* This is the mandate's permitted environmental-incapability path (exact limitation, explicit filing, nothing skipped elsewhere).

## SECTION 13 — STALE payloadVersion MEASUREMENT (RECORD ONLY; FEEDS DEC-09)

Record: **`R094.BROWSER.STALE-VERSION-MEASURE` (PASS — measurement, decides nothing)**.

Measured against the **current** production engine in the real browser: an item stamped `payloadVersion: 0` (stale/older) and an item stamped `payloadVersion: 9999` (unknown-future) **both pass the provenance gate and replay** (`synced`), while a legacy row with **no provenance** quarantines `missing-provenance`. **Conclusion (measurement, not policy): `payloadVersion` is today recorded for capture/migration reading, not enforced as a replay gate.** This is the exact behavioral measurement DEC-09 needs; no version-gating behavior was invented, and the record does not close or alter any DEC-03/DEC-09 semantics.

## SECTION 14 — OFFLINE → ONLINE TRANSITION EVIDENCE

Record: **`R094.BROWSER.OFFLINE-ONLINE` (PASS)**.

With the context **genuinely offline** (`setOffline(true)`, `navigator.onLine === false`): the production enqueue completes, status `pending`, complete provenance (`originUserId=USER_A`, device/branch/terminal/shift ids, `payloadVersion`, `payloadHash`, `clientKey`). After the genuine transition (`setOffline(false)`), one production sync pass lands **exactly ONE** replay RPC; the row becomes `synced` with `resolvedServerId` from the server; a second pass adds **zero** RPCs (no duplicate replay); the provenance fields **and** the canonical payload JSON are **byte-equal across the transition**, and integrity re-verifies true. This is the deferred-replay behavior the mandate required to be demonstrated with real offline/online conditions (Playwright `setOffline` is a real navigation-blocked network state for the page, not a simulated wrapper).

## SECTION 15 — SYNTHETIC DATA AND SEAMS DECLARATION

- **Synthetic data:** all fixtures are synthetic identifiers (`r094-biz-*`, `r094-user-*`, `R094-*` receipts); no customer data was touched (`customerDataTouched: false` on every record); no production verification follows from synthetic records (recorded per outcome).
- **Seam 1 — in-origin synthetic Supabase wire:** the harness bundles the real supabase-js client pointed at a localhost PostgREST-shaped stub; rpc outcomes are **scenario-registered per client key** (success, P0QLT, 23514 shapes) — the server is labeled synthetic; assertions are about client behavior, never server truth. The stub additionally models committed-invoice shadows so the production *read-back* (`findByIdWithLines`) sees exactly what the RPC committed — minimal data seam, no business logic.
- **Seam 2 — scenario-controlled hydrated actor/business:** `originUserId` and business scoping arrive via the app-store seam exactly as a hydrated session would supply them; no server-side identity was fabricated (R09.2's DB-side actor checks remain DB-suite evidence).
- **Seam 3 — scenario-driven rpc responses:** per-key registered PostgREST bodies/statuses.
- **Seam 4 — environmental substitution:** (a) the compiled-in host `r094.invalid` terminates TLS **locally** through a real CONNECT tunnel (proxy bypasses loopback; proxy denies every other host) with a **synthetic self-signed certificate** — Chromium's network stack, TCP and TLS handshakes are real; (b) `libnspr4/libnss3/libnssutil3` come from sparticuz's own al2023 pack. Playwright context-route interception is **not** used for SW-originated traffic (it cannot intercept service-worker fetches; that limitation was diagnosed and routed around with real networking, not with a swindle).
- **Auth boundary:** no real auth session exists for the harness origin (records note the synthetic actor seam); `/auth/v1/user` returns 401 on the stub and the app shows its real unauthenticated shell — no auth records were manufactured.

## SECTION 16 — DETERMINISM

- Two consecutive focused suite executions produced **byte-identical `r094-browser.json`** (id sets, statuses, expectations — compared with `diff`: identical), each 16 PASS / 0 FAIL / 1 BLOCKED (59–63 s per run).
- The suite is strictly serial (release `fileParallelism: false`), seeds all fixtures with deterministic values (only client keys/uuids vary, and no assertion depends on them), polls real conditions instead of sleeping fixed gates wherever a state transition is observed (SW activation polling, cache-entry polling, item-status polling), and never depends on wall-clock beyond the production lease TTL.
- A full-gate run is wholly reproducible from a clean sandbox: devDependencies pinned in `package.json`/lockfile (`playwright-core@1.49.1`, `@sparticuz/chromium@138.0.2`, `esbuild@0.28.2`); cache artifacts (`.cache/r14` TLS certs, extracted libs, built pages, `dist/`) are git-ignored and regenerated.

## SECTION 17 — REMEDIATION PACKAGE (IF FAILURES FOUND)

**None required.** Zero FAIL records exist; no product defects were observed through the real-drawer, real-engine and real-SW paths (Section 11–13 render paths agree with the sealed DB-layer classifications).

Optional future-scope enhancements (explicitly **not** part of this package and **not** auto-authorized; listed for the owner's next scoping decision only):

1. **SW update-install variant:** a second, differently-versioned real PWA build served to an existing origin to evidence update/hijack behavior across a version bump (see Section 6.3 for why it was not simulated).
2. **Browser-driven server revalidation:** a disposable real Supabase backend (Postgres + Edge functions + auth) reachable over the wire to discharge `R094.BROWSER.SERVER-REVALIDATION`; blocked in this sandbox by environment, not by product doubt (DB-side authority already covered by sealed `R093.RECON.*`).

Exclusions that would apply to any such package (carried from this mandate): no product-logic changes, no R09.x touch-up, no DEC-03/DEC-09/TTL/CONFLICT decisions, no GAP-6, no branch work, no CI changes, additive records only.

## SECTION 18 — FINAL CLASSIFICATION

**COMPLETED WITH DOCUMENTED BLOCKED EVIDENCE.**

The mandate's browser-runtime evidence collection is complete: 16 of 17 records PASS in a real browser with zero simulation; one record (`R094.BROWSER.SERVER-REVALIDATION`) is BLOCKED for an exactly stated environmental incapability, explicitly filed here, and the 763-record baseline is intact with no FAILs anywhere (the +16 PASS of this package is purely additive: 709→725 at the aggregate level only because the 16 new records are passes). The single BLOCKED concerns a capability the DB/Fixtures layer already covers under sealed R09.3 evidence; it does not indicate a product regression. This classification is based on the evidence above, not on the desire to keep the programme moving. The work stops at this filing: no fix package, no reclassification, and no further implementation is performed under this mandate.
