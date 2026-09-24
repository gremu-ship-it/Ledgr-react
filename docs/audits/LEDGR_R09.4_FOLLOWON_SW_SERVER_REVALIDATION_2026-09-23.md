# LEDGR — R09.4 Follow-on: SW Update-Install Evidence (Phase A) and Server-Revalidation Investigation (Phase B)

**Date:** 2026-09-23 (Africa/Johannesburg)
**Branch:** `arena/01a0c215-ledgr-react`
**Commits:** `586d6c7` (Phase A evidence suite) + follow-on commit containing this report and the Phase-B investigation record
**Mandate:** R09.4 Follow-on Authorization (Phase A → file/close → Phase B → stop), sequential phases, independent classifications

---

## §1. Authorization & scope

Two sequential phases were authorized:

- **Phase A** — Produce real-browser evidence for the service-worker **update-install variant**: additive records `R094.BROWSER.SW.*` covering genuine install, update detection, activation, same-origin A→B transition, active-session behavior, cache transition, queue preservation, provenance, hijack/stale-worker inspection, identity/cache confidentiality during updates, and deterministic repeatability — using **two real builds** (Version A = the verified baseline verbatim; Version B = a distinct build, version observable, with no product-behavior change), **no force-activation by changing app code** (document the production lifecycle instead), **defects recorded, never fixed**, determinism proven by running the suite **twice with byte-identical output**, and an **independent classification**.
- **Phase B** — Investigate (not invent) whether `R094.BROWSER.SERVER-REVALIDATION` can be discharged via a **genuinely wire-reachable backend** (per mandate B3 candidates, including "embedded PostgreSQL + genuine HTTP API layer"). Mandate B4 disqualifiers apply: **"direct SQL invocation disguised as an HTTP request"** and fake/mock backends are forbidden. If impossible: keep BLOCKED, file an explicit **investigation/limitation record only**. Independent classification; stop after Phase B regardless.

Standing constraints from the R09.4 authority carried into this follow-on: evidence/harness-only; additive records only; no product-logic, migration, Edge-function, R06–R15, auth, branch, GAP-6, billing, AI.BRANCH, DEC-03/09, TTL/CONFLICT, or CI-gate-semantics changes; **no reclassification of existing BLOCKED records**; observed defects are recorded, never fixed; one classification per phase; stop after filing.

## §2. Baseline verification

Pre-Phase-A gate counts at push of `7042b4f`: **725 PASS / 0 FAIL / 55 BLOCKED / 780 total** — the verified R09.4 baseline. The follow-on work was executed on top of that exact tree. A sandbox incident mid-session (git object store reset to the base commit while remote retained the branch tip) was detected and corrected by fetching the remote branch tip and realigning index+HEAD **via soft/mixed resets only — the working tree was never touched**, and `git status` was then verified to show precisely the day's Phase-A delta (three files: the new suite, the two harness-line additions) and nothing else. No session evidence was lost or rewritten.

## §3. Evidence policy compliance

All Phase-A claims derive from a **real Chromium runtime** (playwright-core + @sparticuz/chromium, genuine browser build with genuine NSPR/NSS libraries), a **real service-worker lifecycle**, **real CacheStorage / IndexedDB / BroadcastChannel**, and **two real Vite production builds** served by the test stub on one origin. No jsdom, no fake-indexeddb, no mocked SW lifecycle, no service-worker fetch interception, no simulated time. The only synthetic elements are test data and the harness-controlled network origin (the same labelled seam pattern as the sealed R09.4 records). Assertions are **observation-anchored**: every verdict key is a browser-verified fact (digests, registration state machine states, controllerchange events, cache byte contents), not a test-area metric.

## §4. Version strategy (two real builds, mandated constraints)

- **Version A** — A **byte-verbatim copy** of the currently verified baseline `dist/` build (the R09.4 wire-reachable build: `VITE_SUPABASE_URL=https://r094.invalid`, `VITE_SUPABASE_ANON_KEY=r094-anon`). Provenance marker `.r094-env.json` written into the copy. No rebuild of product code was required to define Version A.
- **Version B** — The **identical build command** with exactly one input varied: the anon-key environment marker (`VITE_SUPABASE_ANON_KEY=r094-anon-key-v2`). Rollup content-hashing cascades coherently (supabase chunk → entry module → index.html → sw.js bytes + all precache revisions), producing a **genuinely distinct version with zero product-behavior change**. No product code was modified to manufacture the difference.
- **Verified distinction** (sha256, first 16 hex): sw.js A `d9fcdc6ece96ffe6` ≠ B `b37841cf6ffe53cf`; index.html A `12d788b34bb82243` ≠ B `66bd0047582856e0`; entry asset A `index-CJdZecJy.js` ≠ B `index-DCwD56T6.js`; precache manifest: 111 entries in **both** builds. Version observability was asserted before every run (`beforeAll` hard-fails if the cascade ever degenerates, so a silent no-op "update" can never pass as an update).

## §5. Harness modifications (additive, evidence-only)

Exactly two harness-level changes; **no product code touched**:

1. `tests/browser/stub-server.mjs` — the static-serving dist directory became mutable via a control action `setDistDir {dirAbs}`, so the **same origin** can serve Version A, then Version B, mid-test (a genuine same-origin version swap, as production would experience it). The existing R094 TLS pass-through recipe for the external-control host was unchanged.
2. `tests/release/gate.mjs` — two **additive** suite registrations (`r094-sw-update.json`, `r094-revalidation-investigation.json`). Gate semantics untouched (additivity verified by diff: two inserted lines only).
3. New files: `tests/release/r094-sw-update.test.ts` (eight records), `tests/release/r094-revalidation-investigation.test.ts` (one investigation record), this report.

## §6. `R094.BROWSER.SW.INSTALL-REGISTER` — PASS

Version A installs genuinely: production `registerSW({immediate:true})` creates exactly **one** registration scoped `/`; the shipped `sw.js` self-activates (top-level `skipWaiting`) and claims (top-level `clientsClaim`); the page is controlled; active `sw.js` digest and served document digest match the served Version-A files byte-for-byte; the precache populates to the 111-entry manifest; the app-emitted `app:sw-registered` event fired. *Anchor:* process-verified state machine (`activated`) + sha256 digests from inside the page context.

## §7. `R094.BROWSER.SW.UPDATE-DETECT-TRANSITION` — PASS

After the same origin begins serving Version B and a **normative `registration.update()` check** runs, Chromium detects the byte-different `sw.js`, **installs AND activates** Version B (production self-activation — timeline evidence from the real registration state machine: `installing` → `activated`), the open client is claimed by the new worker, and the **end-state document is unambiguously Version B**: html digest `66bd…` (matches B, differs from A), entry module `index-DCwD56T6.js`, SW-handled in-page `/` fetch returns the B bytes, and a precache slot forensic shows **correct B bytes stored under the B revision key** (revision labels verified against the `__WB_REVISION__` manifest; A bytes under the A key, B bytes under the B key during the transition window). Exactly one registration remains throughout.

## §8. `R094.BROWSER.SW.ACTIVE-SESSION` — PASS

While Version B is detected, installing, and self-activating, the **still-loaded Version-A document** and its loaded offline-queue module stack stay functional (root populated, controller present, queue reads/writes succeed; item counts and statuses verified before and after the claim). This record was built against the **measured production lifecycle** rather than any forced activation: the production bundle is `registerType: 'autoUpdate'` (see §14), so open documents are reloaded by the production runtime itself once the claimed worker controls them; the harness records that behavior as evidence. Post-transition document: Version B.

## §9. `R094.BROWSER.SW.CACHE-TRANSITION` — PASS

On version change, the workbox precache entry set **converges to the Version-B set**: obsolete Version-A-only hashed assets are removed by the production **activate-phase cleanup** (waited to genuine convergence — the worker may read `activated` while cleanup still runs inside the activate event's lifetime, so polling is required; this timing is a recorded production fact, not a harness guess). The identity-scoped runtime cache `ledgr-api-cache`, warmed via the real SW-cached fetch path, **survives the version transition with its entries intact** — cache wipe remains identity-triggered (R09.1), never version-triggered. Named caches before/after verified identical in membership.

## §10. `R094.BROWSER.SW.QUEUE-PROVENANCE` — PASS

A provenance-complete queue item enqueued as User A under Version A survives the **full** production Version-B transition (install + activation + claim + production reload) **byte-identically**: `originUserId`, `originBranchId`, `originDeviceId`, `originTerminalId`, `originShiftId`, `payloadVersion`, `payloadHash`, canonical payload JSON, `clientKey`, and `sequence` all re-read unchanged; payload integrity re-verifies under the Version-B-controlled runtime; exactly one queue row exists (no duplication); and a single subsequent production sync pass produces **exactly one** `post_pos_sale` RPC call for that `clientKey` (single replay authority preserved across the version change), completing to `synced`.

## §11. `R094.BROWSER.SW.IDENTITY-CONFIDENTIALITY` — PASS

Identity transition **around** the update (User A → A→B version change → identity wipe → User B), executed on the Version-B-controlled runtime: the R09.1 identity boundary holds across the version change — User B sees **zero** User-A markers in the React-Query persisted cache (`upd-a-marker` absent; `upd-b-marker` present exactly once), the identity-triggered wipe empties `ledgr-api-cache` (0 entries) even though that cache survived the version transition per §9, and the offline queue under User A remains **preserved** (1 pending item, integrity verified) — the queue is never treated as ordinary cache during an identity transition.

## §12. `R094.BROWSER.SW.HIJACK-STALE-INSPECT` — PASS

Whole-transition inspection: **never two registrations** at any sampled point; the active script digest settles on the known Version-B digest and **never returns to Version A**; the end-state document is never the obsolete Version-A shell (only B hashed asset names present; A entry name absent); obsolete Version-A-only precache entries are gone post-cleanup; **repeated `update()` checks after settle are idempotent no-ops** (no new installing worker, registration count stays 1, active state `activated` — no update loop); the identity-scoped runtime caches show no unexpected deletion. Any defect found here would have been recorded verbatim; none was found.

## §13. `R094.BROWSER.SW.DETERMINISM` — PASS (suite-level) and two-run byte-compare (mandate-level)

The in-suite record reruns a complete A→B cycle in a **fresh browser context** and requires the same digest convergence, single registration, controller presence, and queue-seeded-and-preserved properties captured canonically by the first transition record. Additionally, per the mandate, the **entire suite was executed twice independently** and the two `r094-sw-update.json` evidence files compared: **byte-identical** (verified by `diff`). (Two further full runs were executed during development; the byte-compare pair is the authoritative determinism proof.)

## §14. Phase-A production lifecycle facts recorded (documentation, not modification)

The mandate required the true production lifecycle to be documented rather than overridden. Measured facts now on record:

1. **Self-activation:** the shipped `sw.js` performs top-level `skipWaiting()` — a new version activates without any click path; `activateServiceWorkerUpdate()`/`updateServiceWorker(true)` is only a fallback for a stuck waiting state.
2. **Claim advance:** `clientsClaim()` advances an open client's controller **asynchronously after** activation; a `controllerchange` event on the page is the **only** trustworthy observable (worker `scriptURL` is identical across versions, so URL-based checks cannot detect the flip — this exact false-anchor was caught and replaced during evidence development). Observed activation→claim latency across runs: sub-second to low single-digit seconds (recorded as measurements, not asserted thresholds).
3. **Production-driven document renewal:** the bundle is built with vite-plugin-pwa `registerType: 'autoUpdate'` — the production registerSW runtime **reloads the open app document** once the claimed worker controls it. The harness observed this reload directly (execution-context destruction on the open page, timed and raced-real), and follows it rather than triggering activation itself.
4. **Precache cleanup timing:** workbox's activate-phase deletion of obsolete entries completes inside the activate event's extended lifetime, so the worker state may already read `activated` before the entry set converges — convergence must be observed, not assumed (manifest counts: 111/111; transient reads can show smaller/larger sets mid-flight).
5. **onNeedRefresh:** with self-activation, `app:update-available` is an observability hook only in the update-install path.

**Defects observed in product code during Phase A: none.** (The auto-reload, the claim lag, and the cleanup lag are production-faithful lifecycle behaviors and are recorded as such; no product change was made anywhere.)

## §15. Phase-A gate impact & additivity proof

- Gate before follow-on: **725/0/55/780**. After Phase A: **733/0/55/788** — exactly **+8 PASS** (the eight `R094.BROWSER.SW.*` records), zero removals, zero reclassifications.
- Additivity verified structurally: `git status`/`diff` shows only the three Phase-A files (`r094-sw-update.test.ts` added; `stub-server.mjs` +1 control action; `gate.mjs` +1 suite line); every prior suite file byte-untouched; the original R094 17-record evidence directory re-verified in the same gate run.

## §16. Phase-A classification

**COMPLETED — ALL MANDATED EVIDENCE FILED, ZERO DEFECTS OBSERVED.** Phase A produced genuine, twice-reproducible, byte-identical real-browser evidence for the complete update-install variant (install, detection, activation, same-origin transition, active-session, cache transition, queue+provenance preservation, identity/cache confidentiality during updates, hijack/stale inspection, deterministic repeat) using two real builds and the production lifecycle without any forced activation. Phase A is closed; it does not depend on Phase B.

## §17. Phase-B mandate, method, and exclusion discipline

Phase B asked one question: **can `R094.BROWSER.SERVER-REVALIDATION` be honestly discharged from this sandbox** via a genuinely wire-reachable backend, without any B4 disqualified shortcut? Method: live capability probing on 2026-09-23 (filesystem, process tree, package registries, network egress, tool availability), source inspection of the real DB fixture and the RPC migrations (`20260923000000_post_pos_sale_rpc.sql` et al.), and zero write of any HTTP layer. Exclusion discipline: no backend was mocked, no HTTP bridge was attempted, no inventing of PostgREST's auth/role/RLS semantics.

## §18. Phase-B findings (live probes)

1. **Refutation of one old limitation clause — the DB layer is real and TCP-addressable.** `tests/release/database.mjs` uses `embedded-postgres@17.10.0-beta.17`, which unpacks and runs a **real PostgreSQL binary** bound to `127.0.0.1:<random port>` with SCRAM auth, and replays **all migrations verbatim** (only pg_cron/pg_net *installation* substituted — declared). The earlier phrase "process-local, not network-addressable" was inaccurate; a genuine wire-reachable service exists at the **SQL** layer.
2. **The missing layer is the genuine HTTP REST contract.** The record requires PostgREST semantics (JWT claim enforcement, role switching, RLS interaction, schema cache, content profiles, supabase-js-compatible error surface) plus GoTrue-style browser auth sessions. The **official PostgREST static binary cannot be fetched**: `github.com` and `api.github.com` respond, but the release-asset CDN (`release-assets.githubusercontent.com`) refuses TLS (`curl`: 302 → `SSL_ERROR_SYSCALL`; `gh release download` fails identically at the same host). `apt` has no postgrest package. The npm `postgrest` wrapper (seveibar/postgrest-node 1.2.1) downloads from the same blocked CDN and pins ancient PostgREST — unusable and non-representative. Building PostgREST from Haskell source in-sandbox is not a genuine option.
3. **Docker path absent.** `docker`/`podman`/`buildah`/`supabase`-CLI stack all absent; the official Supabase local stack cannot run. GoTrue unavailable for the same transport/infrastructure reasons.
4. **The remaining candidate is disqualified.** A hand-written Node HTTP bridge executing the real migrations' RPCs over TCP would make the wire genuine but replaces PostgREST's security boundary with **harness-authored** auth/role/RLS/error semantics — precisely "direct SQL invocation disguised as an HTTP request" / fake backend under B4. **Not attempted.**
5. **Outcome:** no B3 candidate survives the facts; discharge is **not establishable** in this sandbox today.

## §19. Phase-B filing and discharge prerequisites

Filed: **`R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION`** (additive BLOCKED record; `r094-revalidation-investigation.test.ts`; registered additively in `gate.mjs`). The original `R094.BROWSER.SERVER-REVALIDATION` remains BLOCKED, **unreclassified** per the standing rule. Exact prerequisites for future discharge, recorded in the record: (a) a sandbox with Docker available for the official Supabase local stack, **or** (b) network access to the GitHub release-assets CDN (or an approved mirror with pinned sha256) permitting the official PostgREST static binary plus a GoTrue-equivalent auth issuer with real JWT validation; then the existing R09.4 proxy/TLS harness (already wire-real to the stub host) is reusable verbatim against the real host. No defects were observed in product code during Phase B.

## §20. Final counts and Phase-B classification

- Final gate totals: **733 PASS / 0 FAIL / 56 BLOCKED / 789 TOTAL** (baseline 725/0/55/780 → +8 Phase-A PASS, +1 Phase-B investigation BLOCKED; zero FAIL; zero reclassifications).
- Record inventory added by this follow-on: `R094.BROWSER.SW.INSTALL-REGISTER`, `.UPDATE-DETECT-TRANSITION`, `.ACTIVE-SESSION`, `.CACHE-TRANSITION`, `.QUEUE-PROVENANCE`, `.IDENTITY-CONFIDENTIALITY`, `.HIJACK-STALE-INSPECT`, `.DETERMINISM` (all PASS, two-run byte-identical), and `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION` (BLOCKED — environmental, prerequisites recorded).
- **Phase-B classification: INVESTIGATED — DISCHARGE NOT ESTABLISHABLE UNDER MANDATE CONSTRAINTS; LIMITATION FILED WITH EXACT PREREQUISITES.**
- **Stop conditions:** Phase A filed and closed (commit `586d6c7`, pushed); Phase B investigated and filed with this report; no subsequent package was started; no pending work remains. No next implementation package is authorized by this report — the Phase-B discharge prerequisites (§19) are the only stated opening, and they require an infrastructure change outside this sandbox.

---

## Post-filing addendum (2026-09-23) — determinism hardening, harness-only

During post-filing re-verification under **full-gate system load**, one transient failure class surfaced that the solo-run environment had masked: the production `autoUpdate` reload can land inside a narrow window after the claim advance — after the harness had (correctly) stopped watching for an execution-context destruction but before its fallback navigation check completed. The harness could then issue its own reload concurrently with the production reload; the first navigation aborts the in-flight digests fetches (Chromium surfaces aborted fetches as `TypeError: Failed to fetch`), and a polling snapshot could land mid-flight. The affected area was the harness's observation loop only — **no product behavior, no record verdict, and no gate semantics** were implicated.

Hardening applied (harness-only, additive; commit following this addendum):

1. **Document-generation detection:** the harness now watches `performance.timeOrigin` (changes on every navigation) in both the in-transition claim watch and the post-claim reload watch, instead of relying solely on catching an execution-context destruction in flight. The production reload is therefore detected deterministically whenever it occurs within the bounded windows.
2. **Abort-tolerant polling:** navigation-aborted digests (`Failed to fetch`) are treated as retryable transients inside the bounded state polls, exactly like context destructions; a genuinely persistent failure still surfaces at the deadline with full last-state detail.

Re-verification after hardening: the SW suite was executed **twice more, fully green, byte-identical** (`r094-sw-update.json` diff-clean), and the **full gate was re-run: 733 PASS / 0 FAIL / 56 BLOCKED / 789 TOTAL** — identical to §20. The investigation suite remains byte-identical (`R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION`, BLOCKED). No record was reclassified; no product code, migration, or Edge function was touched; the Phase-B conclusions are unaffected.

---

*Report produced 2026-09-23 under the R09.4 follow-on authorization. All product code, migrations, Edge functions, and every pre-existing release record are untouched; all additions are evidence, harness, investigation, and documentation only.*
