# Phase 10 Post-Audit Remediation Addendum

**Date:** 2026-08-25
**Baseline audited:** `59f8766e9b2496687f8629d17c5eb7349e028c71`
**Scope:** Repository-only remediation following the final verification audit. Nothing in this addendum has been deployed to staging or production.

## Remediation implemented

### Database authorization

- Added `20260825000000_phase10_close_ai_context_anon.sql`.
- `ai_context(uuid)` now permits identity-free execution only for `auth.role() = 'service_role'`.
- Every other caller must have non-null `auth.uid()` and active business membership.
- Explicitly revokes `PUBLIC` and `anon` execute, then grants only `authenticated` and `service_role`.
- Migration assertions fail if anon execute returns.
- Database harness now tests anon denial, authenticated cross-tenant denial, and same-tenant success.

### Logout and session persistence

- Inactivity-modal “Sign out now” now runs the secure inactivity logout path.
- Added a Supabase storage adapter that writes session-only credentials exclusively to `sessionStorage`.
- Session-only credentials no longer enter localStorage and cannot survive a closed tab/browser session.
- Purge-before-sign-out preserves the storage-mode marker only until Supabase removes its token, then clears the marker in `finally`.

### Query and business-context isolation

- Query Client now clears for all business/role transitions, including business-to-null and null-to-business.
- Central invalidation now uses a predicate for tenant-first detail families (`journal-entry`, `accounting-period`, `invoice`, `contact`, `payroll-run`, and `stock-transfer`).
- Real Query Client tests verify affected detail entries become invalidated while unrelated webhook/payroll entries remain untouched.

### Offline queue and repository integrity

- `enqueue()` now verifies the supplied user/business is still the active client context.
- Every operation’s embedded payload business is checked against the queue envelope before persistence and again before sync.
- Dependency rows must exist and match the same exact owner/business.
- Context is rechecked after the IndexedDB status update and immediately before network submission.
- Pending-count backpressure, manual deletion, and seven-day pruning are now owner/business scoped.
- Invoice and expense payments reject a payment business that differs from the parent document business.

### Edge response handling

- Added `_shared/response.ts` for no-store JSON and redirect responses.
- All 26 Edge Functions now have an effective no-store response path.
- The eight functions identified by the audit now use the shared response helper.
- `process-invoice-automation` now uses deployment-standard `CRON_SECRET` with a legacy fallback, validates POST, scopes recurring template/update queries by business, checks database errors, and returns minimized no-store errors.

### Gateway

- Fixed the standard `npm start` command.
- Added target-resolution logic that preserves the configured Edge Function base path and query string while pinning scheme/authority to `TARGET_URL`.
- Removed hop-by-hop/host headers before proxying.
- Replaced sequential anonymous/authenticated limiters with one dynamic policy: 10/min anonymous and 100/min authenticated.
- Uses hashed credential keys and IPv6-safe IP normalization.
- Uses Redis when configured and fails production startup when `REDIS_URL` is absent.
- Added proxy target tests and repeatable local gateway verification.

### Repeatable security verification

- Converted the database security harness to ESM.
- Added declared `embedded-postgres` and `pg` development dependencies.
- Added `npm run test:db-security`.
- CI workflow integration remains a repository-administration follow-up: the Arena GitHub App can push source changes but lacks permission to update `.github/workflows/ci.yml`.

## Verification results

- Root typecheck: passed.
- Root lint: passed with 0 errors and 2 pre-existing warnings.
- Root Vitest: **46 files / 348 tests passed**.
- Database security replay: **73 migrations / 44 checks passed**.
- Gateway: typecheck and build passed; **2 files / 9 tests passed**.
- Gateway runtime check: standard `npm start` passed; target base path and query were preserved; 12 authenticated requests remained allowed; anonymous requests returned 429 at the 10/min policy.
- Production frontend build: passed.
- Generated worker: staging REST/auth remain `NetworkOnly`, legacy API cache is not active, static v2 caching is present, browser `no-store` and session storage adapter are bundled.
- `git diff --check`: passed.

## Intentionally not changed

- No inventory trigger was created. Current staging trigger/function metadata and exactly-once stock behavior must be captured first.
- No migration or Edge Function was deployed.
- Canonical staging was not promoted and therefore may still serve the unsafe pre-remediation worker.
- No authenticated two-user/two-business, PWA, restart, offline, or multi-tab browser scenario was performed.
- Existing module-level request globals in older browser-facing Edge response wrappers remain a defense-depth follow-up; all affected wrappers still inherit no-store from the shared CORS headers.

## Completion status

**RED — FAILED** remains the release status until the migration and application are deployed to canonical staging and the required authenticated browser/PWA/offline/multi-tab matrix passes.

**"CODE-LEVEL VERIFIED — LIVE STAGING VERIFICATION OUTSTANDING"**
