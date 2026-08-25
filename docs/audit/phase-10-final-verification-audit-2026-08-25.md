# Ledgr Phase 10 Final Security Verification Report

**Audit date:** 2026-08-25 (Africa/Blantyre)
**Repository:** `gremu-ship-it/Ledgr-react`
**Audited branch:** `arena/01a03992-ledgr-react`
**Audited commit:** `59f8766e9b2496687f8629d17c5eb7349e028c71` — `Harden cache and session tenant isolation`
**Final status:** **RED — FAILED**

> This report records the independent findings against commit `59f8766`. Repository-only fixes made afterward are documented in [Phase 10 Post-Audit Remediation Addendum](./phase-10-post-audit-remediation-2026-08-25.md); they have not been deployed or live-verified.

> **"CODE-LEVEL VERIFIED — LIVE STAGING VERIFICATION OUTSTANDING"**
>
> This means the code-level audit was completed; it does **not** mean every code-level control passed. Public staging artifacts and deployment metadata were inspected, but authenticated staging browser scenarios and current staging database metadata could not be verified without disposable credentials, a browser runner, and Supabase Management API access.

---

## 1. Executive Summary

Phase 10 cannot be approved.

Commit `59f8766` contains real remediation: central client purge infrastructure, business-scoped sensitive detail keys, exact notification ownership, queue envelope ownership, branding-only partner persistence, browser-side Supabase `no-store`, safe Workbox rules in current source, and obsolete-cache cleanup in the replacement worker.

The final audit nevertheless identified release blockers that compilation and unit tests did not detect:

1. **Critical anonymous tenant bypass:** the final migration replay makes `public.ai_context(uuid)` both `SECURITY DEFINER` and effectively executable by `anon`. Its membership guard runs only when `auth.uid()` is non-null, so anonymous requests skip the guard and may read tenant financial context for a supplied business UUID.
2. **Critical canonical staging cache regression:** canonical staging still serves the pre-remediation worker. Its `/rest/v1/` rule uses `NetworkFirst` and `ledgr-api-cache`, and its companion worker does not delete obsolete private caches.
3. **Inventory trigger contract unresolved:** neither the full local migration replay nor the latest captured staging inventory contains a stock-movement balance trigger, while `InventoryRepository.recordMovement()` assumes one exists.
4. **Gateway runtime is broken:** `npm start` imports nonexistent `dist/sentry.js`; direct execution also exposed proxy base-path, query-string, IPv6 rate-limit, and limiter-selection defects.
5. **Several isolation controls are only partial:** the inactivity modal’s “Sign out now” only navigates; business-to-null transitions do not clear Query Client; offline queue payload tenant IDs are not bound to the queue envelope; and centralized invalidation does not match the new tenant-first detail-key namespace.

No production system, credentials, or customer data were used. No destructive staging actions were performed.

---

## 2. Controls Verified

The following controls were verified against the actual source at `59f8766`.

| Control | Classification | Evidence and conclusion |
|---|---|---|
| Exact audited commit | IMPLEMENTED | `HEAD` was exactly `59f8766e9b2496687f8629d17c5eb7349e028c71`; the tree was initially clean. |
| Direct Supabase sign-out centralization | IMPLEMENTED | Repository search found `supabase.auth.signOut()` only in `src/lib/authSession.ts`. Located direct sign-out callsites import `secureSignOut()`. |
| Purge-before-sign-out | IMPLEMENTED | `secureSignOut()` awaits `purgeSensitiveClientState()` before the auth request. |
| Pre-mount isolation initialization | IMPLEMENTED | `src/main.tsx` initializes client isolation before React mounts. |
| Sensitive detail Query keys | IMPLEMENTED | Journal, accounting period, invoice lines/payments/contact, payroll run, transfer, and webhook deliveries include business ID. |
| Route-local remount on business change | IMPLEMENTED | `AppLayout` keys the route error-boundary subtree by active business ID. |
| Notification ownership | IMPLEMENTED | Persisted notifications contain exact `userId` and business scope; legacy unattributed records are discarded; Header displays only exact current scope. |
| Partner persistent-cache minimization | IMPLEMENTED | The v2 cache stores only host-scoped branding; host resolution uses a public-field projection rather than `select('*')`. |
| Offline queue envelope ownership | IMPLEMENTED | Dexie v2 adds `ownerUserId`; legacy unowned rows are deleted; queue display and sync require exact user/business. |
| Supabase browser HTTP-cache prevention in source | IMPLEMENTED | `src/lib/supabase.ts` sets `cache: 'no-store'` for Supabase fetches. |
| Safe current Workbox source | IMPLEMENTED | Current source uses `NetworkOnly` for Supabase REST/auth and same-origin-only image/font `CacheFirst`. |
| Replacement-worker legacy-cache deletion | IMPLEMENTED | `public/sw-events.js` deletes `ledgr-api-cache` and `ledgr-static-assets` on activation and explicit purge message. |
| No manual financial Cache Storage path | IMPLEMENTED | No application `cache.put`, `caches.open`, or sensitive financial `cache.match` path was found. Application Cache Storage access is deletion-only. |
| Safe static/offline support retained | IMPLEMENTED | Workbox precaching and same-origin static runtime caching remain enabled. |
| Generated object URL cleanup | IMPLEMENTED | Every located `URL.createObjectURL()` has immediate or bounded delayed revocation. |
| React Query retention bound | IMPLEMENTED | The shared Query Client uses five-minute garbage collection. |
| RLS not weakened by commit `59f8766` | IMPLEMENTED | The commit did not disable or relax RLS. This does not mean the overall database authorization surface is safe; see `ai_context`. |
| Gateway no-store headers in direct runtime | IMPLEMENTED | Directly executed health, error, and proxy responses carried `Cache-Control: no-store`. |

### Local generated-worker verification

A production worker generated from the audited source with the staging Supabase hostname was inspected and confirmed to contain:

- Staging REST `NetworkOnly`.
- Staging Auth `NetworkOnly`.
- No active `ledgr-api-cache` registration.
- `ledgr-static-assets-v2` with a same-origin predicate.
- `sw-events.js` import.
- Legacy-cache deletion in the generated companion script.

These source/generated controls are not yet active on canonical staging.

---

## 3. Controls Partially Verified

| Control | Classification | Limitation |
|---|---|---|
| Complete semantic logout coverage | PARTIALLY IMPLEMENTED | Direct Supabase calls are centralized, but the inactivity modal’s visible “Sign out now” action only navigates to `/login`. |
| Logout/session cleanup | PARTIALLY IMPLEMENTED | Central purge is broad, but live browser proof is absent and asynchronous durable cleanup failures are swallowed with `Promise.allSettled`. |
| Session-only login | PARTIALLY IMPLEMENTED | Supabase still persists tokens in localStorage. A sessionStorage marker triggers sign-out on a later app boot, but this is deferred cleanup rather than true session-scoped token storage. |
| Business-switch isolation | PARTIALLY IMPLEMENTED | Non-null business or role changes clear Query Client and remount routes; business-to-null does not clear because both IDs are required by the transition predicate. |
| Cross-tab purge | PARTIALLY IMPLEMENTED | BroadcastChannel and storage-event fallback are present and unit-tested, but not exercised in two real tabs. |
| Repository tenant validation | PARTIALLY IMPLEMENTED | Selected invoice/journal/payroll/transfer detail paths compare or filter expected business; generic by-ID updates and several internal methods rely only on RLS. |
| Webhook delivery isolation | PARTIALLY IMPLEMENTED | UI selection must belong to active business, but `WebhookService.getDeliveries()` filters only webhook ID; RLS remains authoritative. |
| Financial invalidation | PARTIALLY IMPLEMENTED | Expanded list/report aliases exist, but generic invalidation does not match keys beginning `['business', businessId, ...]`. |
| Offline queue fail-closed behavior | PARTIALLY IMPLEMENTED | Envelope identity is exact, but payload business/parent IDs and dependency ownership are not comprehensively validated. |
| Offline pruning/backpressure | PARTIALLY IMPLEMENTED | Seven-day pruning exists, but global prune and pending-count operations are not scoped to active owner/business. |
| Database RLS verification | PARTIALLY IMPLEMENTED | A local 41-case matrix passed, but it does not cover every RPC and current staging metadata was unavailable. |
| Edge Function no-store coverage | PARTIALLY IMPLEMENTED | 18 of 26 functions have effective no-store; eight privileged functions omit it. |
| PWA update cleanup | PARTIALLY IMPLEMENTED | Replacement-worker code is correct, but an existing installed staging PWA was not available to prove takeover and cache deletion. |
| Gateway control | PARTIALLY IMPLEMENTED | Typecheck, build, tests, Helmet, no-store, and basic limiting work under direct execution; the declared start command and proxy semantics are broken. |

### Query invalidation mismatch

`src/lib/queryInvalidation.ts` invalidates legacy first-element aliases such as `['journal_entry_detail']` and `['payroll_run']`. The hardened detail keys start with `['business', businessId, ...]`. React Query prefix matching therefore does not connect these invalidations to the new detail entries.

Some direct callsites explicitly invalidate the exact hardened key after payment, payroll approval, transfer, or journal changes. Generic transaction and offline-sync invalidation remains incomplete. Existing tests mock `invalidateQueries()` and inspect only the first string passed; they do not create real tenant-prefixed cached entries.

---

## 4. Controls Not Verified

The following required live controls were not verified and must not be treated as passing:

1. User A logout followed by User B login in the same browser.
2. Business A to Business B switch with QueryClient-state inspection.
3. Business-to-no-business membership revocation.
4. Direct URL and changed-ID tests for invoices, journals, payroll, transfers, and webhook deliveries.
5. Changed `business_id` request payload tests.
6. Same-record-ID Query-key collision tests in a real browser.
7. Session expiry, `SIGNED_OUT`, token refresh, failed sign-out, and post-logout browser refresh.
8. Full browser close/reopen and session-only login.
9. Two-tab logout and business-switch propagation.
10. Real IndexedDB enqueue, dependency, retry, idempotency, interruption, and pruning behavior.
11. User B isolation from User A’s durable offline queue.
12. PWA installation, worker update/takeover, browser restart, and Cache Storage inspection.
13. Current staging SQL functions, grants, RLS, triggers, and inventory behavior.
14. Deployed Edge Function headers and deployed gateway behavior.

### Why these were not run

- No disposable staging credentials were available.
- No Playwright, Puppeteer, browser binary, or existing authenticated browser session was available.
- No Supabase access token was configured; CLI project listing could not authenticate.
- The latest repository staging-schema capture is dated 2026-08-15 and is not proof of current deployment metadata.

No staging identities or records were created because a safe, authenticated test session could not be established.

---

## 5. Vulnerabilities Found

### V-01 — Anonymous `SECURITY DEFINER ai_context(uuid)` tenant bypass

The final migration replay produced an effective ACL that allows `anon` to execute `public.ai_context(uuid)`. The function body checks membership only when `auth.uid()` is non-null:

```sql
if auth.uid() is not null and not public.is_business_member(p_business_id) then
  raise exception ...;
end if;
```

Anonymous requests have a null UID, so they skip the check. Because the function runs with definer rights and reads tenant financial views, a known or discovered business UUID could select another tenant’s financial context.

### V-02 — Canonical staging caches authenticated Supabase REST responses

Canonical staging’s deployed `sw.js` still registers staging `/rest/v1/` with:

- `NetworkFirst`
- four-second network timeout
- cache name `ledgr-api-cache`
- up to 200 entries
- one-day retention

The deployed `sw-events.js` lacks legacy-cache cleanup, and the deployed Supabase client wrapper lacks `cache: 'no-store'`.

### V-03 — Inactivity “Sign out now” does not sign out

`AppLayout` wires the inactivity modal callback to `window.location.href = '/login'`. The user-visible button says “Sign out now,” but no auth termination or sensitive-state purge occurs through that callback.

### V-04 — Offline queue payload tenant mismatch

Queue rows bind `ownerUserId` and envelope `businessId`, but sync does not assert that nested financial payload business and parent IDs match that envelope. A user who belongs to both businesses could submit a tampered Business B payload from a Business A queue context; RLS would permit B membership even though A is the active UI tenant.

### V-05 — Gateway start and proxy defects

- `npm start` fails because `dist/sentry.js` does not exist.
- A configured target such as `/functions/v1/api` loses its base path.
- Query strings are rejected by the path regex.
- The custom IP fallback triggers an IPv6 bypass warning.
- Anonymous and authenticated rate limiters run sequentially, effectively limiting authenticated callers to 10/min despite 100/min headers.
- No Redis rate-limit store is instantiated.

### V-06 — Business-to-null cache state survives

The business subscription clears Query Client only when both previous and next business IDs are non-null. Membership revocation or loss of all business access can leave old entries resident until another purge path runs.

### V-07 — Hardened detail keys are missed by generic invalidation

The new tenant-first key namespace is not covered by legacy invalidation prefixes, allowing stale detail entries after some generic transaction/offline write paths.

### V-08 — Eight Edge Functions omit explicit no-store

Privileged cron, webhook, and billing responses bypass the shared headers and omit explicit no-store. Several responses include tenant/user IDs, partner names, invoice numbers, amounts, or database error details.

### V-09 — Callable helper grants expose unnecessary metadata/operations

Examples include:

- `business_partner_id(uuid)` returning association metadata without caller binding.
- `current_partner_ids(uuid)` accepting arbitrary user IDs.
- `next_journal_entry_number(uuid)` ignoring the business argument and allowing authenticated callers to consume a global sequence.

### V-10 — Database security harness is not directly runnable as committed

The tracked script uses CommonJS `require()` in a `.js` file under a package with `"type": "module"`, and its root dependencies are undeclared. The audit executed an unchanged copy through a disposable `.cjs` harness.

---

## 6. Severity

| Finding | Severity | Rationale |
|---|---|---|
| V-01 anonymous `ai_context` bypass | CRITICAL | Direct database authorization bypass across tenant financial context. |
| V-02 canonical staging financial REST caching | CRITICAL | Authenticated responses can survive in shared browser Cache Storage across session/user changes. |
| V-03 semantic logout bypass | HIGH | User-requested logout does not terminate auth or purge sensitive state. |
| V-04 offline payload tenant mismatch | HIGH | Same user with access to multiple businesses can cross the active UI tenant boundary. |
| V-05 gateway runtime/proxy defects | HIGH | Declared runtime fails; proxying and rate limiting do not operate as documented. |
| V-06 business-to-null cache retention | MEDIUM | Stale sensitive cache can remain after membership/business loss. |
| V-07 detail-key invalidation mismatch | MEDIUM | Stale tenant-prefixed details can survive writes until refetch/GC. |
| Inventory trigger contract unresolved | MEDIUM | Repository expects behavior absent from tracked/fresh and dated staging metadata; risks missing or duplicated stock updates. |
| V-08 Edge response headers | MEDIUM | Privileged responses may be retained by intermediaries unless explicitly prevented. |
| Session-only deferred persistence | MEDIUM | “Session-only” tokens remain in durable storage until a later application boot removes them. |
| V-09 callable helper grants | LOW | Primarily metadata disclosure, sequence consumption, and unnecessary attack surface. |
| V-10 test harness packaging | LOW | Reduces repeatability and CI coverage but is not itself a tenant disclosure. |
| UI-only preferences in localStorage | INFORMATIONAL | No financial records were found in these preference stores. |

---

## 7. Evidence

### Repository evidence

- Central sign-out: `src/lib/authSession.ts`.
- Central purge and cross-tab handling: `src/lib/clientDataIsolation.ts`.
- Pre-mount initialization: `src/main.tsx`.
- Auth transitions/session marker enforcement: `src/hooks/useAuthListener.ts` and `src/pages/LoginPage.tsx`.
- Semantic logout bypass: `src/components/layout/AppLayout.tsx` and `src/components/auth/InactivityWarningModal.tsx`.
- Query keys/invalidation: `src/lib/queryKeys.ts` and `src/lib/queryInvalidation.ts`.
- Route remount: `src/components/layout/AppLayout.tsx`.
- Repository detail checks: invoice, journal, payroll, and transfer repositories.
- Webhook selection check: `src/components/settings/WebhookSettings.tsx`.
- Notification scope: `src/lib/notificationScope.ts`, `src/store/useNotificationStore.ts`, and Header.
- Offline identity/sync: `src/offline/identity.ts`, `db.ts`, `queueApi.ts`, and `syncEngine.ts`.
- Partner persistence: `src/partner/PartnerProvider.tsx` and `PartnerRepository.ts`.
- Browser no-store: `src/lib/supabase.ts`.
- Workbox and cleanup: `vite.config.ts` and `public/sw-events.js`.
- Gateway: `server/src/index.ts` and `server/package.json`.
- Edge headers: `supabase/functions/_shared/cors.ts` and all 26 function entry points.

### Cache/persistence search results

Repository-wide search found:

- No application `cache.put`.
- No application `caches.open`.
- No active `StaleWhileRevalidate` API rule.
- Active current-source `CacheFirst` only for same-origin image/font destinations.
- Dexie only in the offline subsystem.
- Zustand persistence only for notifications and UI preferences.
- Partner localStorage limited to branding.
- Auth/session markers, UI preferences, install prompts, consent, and reminders in local/session storage.
- No React Query persistence adapter.
- Every located object URL revoked.

### Enforcement distinction

| Scenario | Client prevention | Repository validation | Authoritative database enforcement |
|---|---|---|---|
| Invoice/journal detail | Tenant-specific key and selected active record | Optional expected-business check; nested rows filter parent business | RLS |
| Payroll detail | Tenant-specific key | Header query includes business when supplied | Payroll RLS |
| Transfer detail | Tenant-specific key | Optional expected-business check; lines filter parent business | Transfer RLS |
| Webhook deliveries | Selected webhook must match active business | Service filters only webhook ID | Webhook/delivery RLS |
| Generic by-ID updates | Usually selected from active tenant list | ID-only in BaseRepository | RLS only |
| Offline payload | Queue envelope records active identity | Nested tenant/parent mismatch not comprehensively rejected | RLS checks membership/role, not active UI tenant |

A client-side refusal or cache key is not evidence of RLS. Conversely, RLS cannot determine which business a multi-business user currently displays.

### Deployment evidence

- Latest successful staging workflow located: GitHub Actions run `32664756439`, main SHA `5d43099ea26cda6b3451662600706e9fbad3fd93`, 2026-08-23.
- Commit `59f8766` has successful Vercel preview deployments dated 2026-08-25.
- The `ledgr-react-prod` preview is Vercel-protected and is not the canonical public staging alias.
- Public canonical staging artifacts match the pre-remediation `5d43099` Workbox behavior.
- No pull request currently exists from the audit branch.

### Database evidence

- Disposable PostgreSQL replay applied 72 migrations.
- Final replay contained 46 `SECURITY DEFINER` functions, all with pinned `search_path`.
- Seven had effective anon execute; `ai_context` was the critical data-returning case.
- Latest captured staging schema is from 2026-08-15, not current live metadata.
- Neither the capture nor final replay contained an inventory balance trigger.

---

## 8. Tests Performed

| Check | Result |
|---|---|
| Root `npm run typecheck` | Passed |
| Root `npm run lint` | Passed with 0 errors and 2 warnings |
| Root `npm run test` | 44 files, 336 tests passed |
| Production build | Passed; existing vendor chunk warning above 800 kB |
| Tenant-isolation unit tests | Passed |
| Client-data-isolation tests | Passed |
| Logout-callsite source tests | Passed, but did not detect navigation-only semantic logout |
| Service-worker isolation tests | Passed |
| Partner-cache isolation tests | Passed |
| Query-invalidation tests | Passed, but did not instantiate hardened detail keys |
| Offline/background-sync tests | Passed |
| Gateway typecheck | Passed |
| Gateway build | Passed |
| Gateway tests | 1 file, 5 logger tests passed |
| Gateway `npm start` | Failed: missing `dist/sentry.js` |
| Direct gateway HTTP checks | No-store present; exposed proxy/query/rate-limit defects |
| Full migration replay | 72 migrations replayed successfully |
| Database RLS harness | 41 passed, 0 failed |
| Security-definer/grant inventory | Completed against final replay |
| Trigger inventory | Completed against final replay and dated staging capture |
| Generated staging-host worker inspection | Passed for source at `59f8766` |
| `git diff --check` before report | Passed |

The 41-case database test covered core table RLS and selected RPC behavior for contacts, products, journals, payroll, audit log, profiles, memberships, and audit writes. It did not cover `ai_context`, every detail resource, or live staging.

Passing tests do not override the critical SQL, canonical staging, inventory, auth, offline, and gateway findings.

---

## 9. Staging Browser Results

### Public staging artifacts inspected

The canonical staging login application was reachable. Public deployment artifacts proved that canonical staging currently serves the older unsafe cache configuration:

- Supabase REST: `NetworkFirst` into `ledgr-api-cache`.
- Supabase Auth: `NetworkOnly`.
- Static images/fonts: broad `CacheFirst` under `ledgr-static-assets`, without current same-origin restriction.
- Companion worker: no activation cleanup for old private caches.
- Deployed Supabase fetch wrapper: timeout present, browser `cache: 'no-store'` absent.

### Authenticated browser scenarios

No authenticated browser scenario was executed. Therefore there is no claimed evidence for:

- User A to User B cache isolation.
- Business A to Business B switching.
- Multi-tab propagation.
- Session expiry/restart/session-only behavior.
- Real IndexedDB ownership and sync.
- Installed-PWA Cache Storage and worker-update behavior.

No screenshots, traces, or fabricated browser evidence are included.

**Staging browser result:** **RED — FAILED** because the publicly deployed service worker itself violates the required cache control, independently of the unavailable authenticated scenarios.

---

## 10. Inventory Trigger Findings

### Repository expectation

`InventoryRepository.recordMovement()` inserts a `stock_movements` row and then immediately reads the corresponding `inventory_balances` row. Its comments state that a database trigger updates balances automatically.

### Evidence inspected

1. All tracked migrations.
2. Final 72-migration local replay trigger inventory.
3. The repository’s latest staging capture from 2026-08-15.
4. Captured function definitions involving inventory and stock.

### Result

- No tracked migration creates a trigger on `stock_movements` or `inventory_balances`.
- Final local replay contains no such trigger.
- The 2026-08-15 staging capture contains no such trigger.
- The only inventory-specific write function found is `backfill_and_recalculate_inventory(uuid)`, a reconciliation RPC rather than a per-movement trigger.
- Current deployed staging metadata could not be queried, so an out-of-band trigger added after the dated capture cannot be ruled in or out.

### Classification

**NOT IMPLEMENTED in the tracked/fresh schema; current live state NOT VERIFIED.**

The trigger was not created, changed, or deployed during this audit.

### Required next investigation

Capture current staging metadata for:

- Every trigger on `stock_movements` and `inventory_balances`.
- Trigger function definitions and owners.
- Trigger timing/events and enablement state.
- Grants and `search_path`.
- All application/Edge/RPC stock writers.

Then use one disposable movement to compare expected quantity and average-cost deltas. Only after proving absence and ruling out application-side double updates should a migration be designed.

---

## 11. Edge Function Findings

There are 26 Edge Function entry points.

- 17 use the shared CORS/header helper, which adds `Cache-Control: no-store` and `Vary: Origin`.
- `invoice-open` uses its own stricter no-store/no-cache tracking-pixel headers.
- Eight omit effective no-store.

### Risk-ranked functions without effective no-store

| Risk | Function | Method/use | Access model | Response sensitivity |
|---|---|---|---|---|
| High | `expire-subscriptions` | Scheduled HTTP job | `x-cron-secret` | Per-business IDs and result/error details |
| High | `finalize-account-deletions` | Scheduled HTTP job | `x-cron-secret` | Per-user IDs and result/error details |
| High | `generate-partner-invoices` | Scheduled/manual POST-style job | `x-cron-secret` | Partner IDs/names, invoice numbers, amounts, periods, errors |
| High | `send-renewal-reminders` | Scheduled HTTP job | `x-cron-secret` | Business IDs, reminder thresholds, result details |
| Medium | `generate-vat-returns` | POST | `x-cron-secret` | Reduced period/count response, privileged tenant-wide operation |
| Medium | `paychangu-webhook` | POST; GET redirect handling | HMAC signature for POST | Payment-processing state and possible database error text |
| Medium | `process-invoice-automation` | Scheduled HTTP job | `x-cron-secret` using different env name | Count/error response, privileged tenant-wide operation |
| Medium | `retry-failed-webhooks` | Scheduled HTTP job | `x-cron-secret` | Redispatch count/error text |

### Authorization observations

The deployment workflow applies `--no-verify-jwt` to all functions, making each function’s own verification mandatory. Source inspection found the intended JWT, API key, membership/admin, cron-secret, HMAC, or tracking-token checks. Deployed parity was not verified.

### Additional defects

- `process-invoice-automation` reads `INVOICE_CRON_SECRET`, while deployment workflows set `CRON_SECRET` and not `INVOICE_CRON_SECRET`. It appears fail-closed but nonfunctional under the documented deployment.
- Several response wrappers retain a mutable module-level `_req` solely to build CORS headers. Concurrent requests can race and use another request’s origin. The response helper should receive the current `Request` explicitly.
- Error responses in some privileged jobs include raw database/service error messages.

**Classification:** PARTIALLY IMPLEMENTED.

---

## 12. Remaining Risks

1. Current staging database grants and function bodies may differ from both migrations and the dated capture.
2. Canonical staging users may already have unsafe `ledgr-api-cache` entries that persist until a replacement worker activates and cleanup succeeds.
3. The preview build for `59f8766` is protected, so public artifact inspection cannot establish that the preview was built with the correct staging environment.
4. Session-only tokens remain durable until next application boot.
5. Durable purge failures are not surfaced or retried.
6. A logout/business change during one already-started multi-request offline sync item can race with requests authorized under the old session/context.
7. Dependency parent rows are consumed by local ID without an explicit same-owner/same-business check.
8. Global queue count/pruning can affect another owner/business’s retained rows in the same browser.
9. Partner-admin React Query keys are partner-based rather than user-based and depend on reliable auth-transition purge.
10. Generic BaseRepository writes remain ID-only and depend entirely on correct RLS.
11. No real-browser evidence exists for Query observer cancellation, late async cache writes, multi-tab fallback, or worker-controlled browser restart.
12. No gateway integration tests cover start command, target resolution, query strings, headers, SSRF controls, or rate limits.
13. No current Edge Function deployment/header inventory was available.

---

## 13. Recommended Remediation

### Immediate critical actions

1. **Fix `ai_context` in a separate database migration:**
   - Revoke execute from `PUBLIC` and `anon`.
   - Grant only explicitly required roles.
   - Permit bypass only when `auth.role() = 'service_role'`.
   - Require a non-null authenticated identity and active business membership for every other caller.
   - Add anon, unauthenticated, cross-tenant, same-user/two-business, and service-role tests.
2. **Promote a corrected build to canonical staging:**
   - Confirm generated REST/auth `NetworkOnly` rules.
   - Confirm browser Supabase `cache: 'no-store'`.
   - Update an existing installed PWA and prove deletion of `ledgr-api-cache` and `ledgr-static-assets`.
   - Inspect Cache Storage before/after logout and browser restart.

### High-priority code actions

3. Route the inactivity modal’s “Sign out now” through `secureSignOut()`.
4. Clear Query Client when business context changes to or from null.
5. Validate every offline payload business/parent ID against the queue envelope before storage and immediately before submission.
6. Validate dependent-parent queue ownership and business.
7. Make generic invalidation target the `['business', businessId, ...]` detail namespace and test against a real Query Client.
8. Repair gateway startup, preserve target base path, safely support query strings, select one appropriate limiter, use IPv6-safe keys, and configure a shared production store.
9. Add gateway integration tests.

### Database/inventory actions

10. Capture current staging trigger/function metadata before designing inventory DDL.
11. Map all stock writers and prove whether balance changes are trigger-driven, RPC-driven, application-driven, absent, or duplicated.
12. Make the database security harness directly runnable in CI with declared dependencies.
13. Add RLS/RPC tests for invoices, journals, payroll, transfers, webhook deliveries, `ai_context`, and changed payload tenant IDs.
14. Review callable helper grants and bind supplied identity parameters to the current caller where possible.

### Edge actions

15. Use a request-explicit shared response helper for the eight missing functions.
16. Add `Cache-Control: no-store` to all privileged success and error responses.
17. Remove mutable module-level request globals.
18. Standardize the invoice automation cron-secret name.
19. Minimize externally returned identifiers and raw service/database errors.

### Mandatory live verification after remediation

Use two disposable staging users and businesses to test:

- Direct URLs and changed IDs/payloads.
- Invoice, journal, payroll, transfer, and webhook delivery isolation.
- User A logout to User B login in the same browser.
- Business switch and business-to-null membership change.
- Session expiry, refresh, browser restart, and session-only login.
- Two-tab logout and business switching.
- Offline enqueue, retry, dependency, identity ownership, interruption, and pruning.
- Fresh PWA installation, old-worker update, logout, and browser restart.
- Current database inventory behavior and exactly-once balance application.
- Deployed Edge and gateway response headers.

---

## 14. Phase 10 Completion Status

### Final status

**RED — FAILED**

Phase 10 is not complete. The audited source contains substantial remediation, but approval is blocked by:

- Critical anonymous database-function tenant bypass.
- Unsafe canonical staging REST caching.
- Unresolved inventory trigger behavior.
- Broken gateway runtime/proxy behavior.
- A semantic logout path that does not sign out.
- Partial offline payload, cache-transition, and invalidation controls.
- Missing authenticated live staging evidence.

The final status cannot become **GREEN — VERIFIED** until the critical/high findings are remediated and all required two-user, two-business, logout, business-switch, offline-queue, PWA-cache, browser-restart, and multi-tab scenarios have been successfully demonstrated in live staging.

**"CODE-LEVEL VERIFIED — LIVE STAGING VERIFICATION OUTSTANDING"**
