# Production-readiness audit — 2026-11-06

## Scope and evidence

This is a source-code, test-suite, build, dependency-audit, and live Supabase catalog/ACL review. The live database metadata queries were read-only and inspected only schema/policy/grant metadata (no business records). They were run against the active Ledgr project. This review does **not** claim that every workflow has been browser-tested or that every existing hard-coded string has been migrated.

## Changes in this hardening PR

- Added English entries for the 268 literal `t('…')` keys that were missing from `src/i18n/locales/en.json` (263 payroll keys plus five keys in construction, manufacturing, AI, common, and reports). Added a source-tree test that scans all literal translation calls in `src/pages/` and `src/components/`.
- Added `formatMissingTranslationKey()` and i18next's missing-key handler so an unexpected miss renders readable words (for example, `payroll.leaveBalance` → `Leave Balance`) rather than a raw dotted identifier.
- Made legacy `/payroll` redirect to `/payroll/employees`; retained `/chat` → `/ai`. Added a navigation route-contract test that checks every desktop navigation path against the route declarations.
- Removed the duplicate `/settings` links from desktop and mobile navigation. Settings remains in the account menu; Profile now opens the Profile tab. Exchange Rates remains available under Banking and the mobile More menu.
- Added a database migration to revoke `TRUNCATE` from `PUBLIC`, `anon`, and `authenticated` on all current public tables and future public tables created by the two observed owners. It also removes all direct client grants from the no-policy RPC/service-only tables. The migration keeps service-role grants intact and safely skips legacy table names absent on a fresh replay.
- Updated the existing Banking navigation contract for the Exchange Rates placement and added a grant-migration contract test.
- Updated the lockfile with non-breaking vulnerability fixes only; no npm packages were added.

## Verified findings

### Navigation, routes, and plan gates

- Static route-contract test: all desktop sidebar paths resolve to declared route patterns.
- `/payroll` redirects to `/payroll/employees`; `/chat` redirects to `/ai`.
- Desktop and mobile have no direct `/settings` navigation item; Settings is exposed in the header/account menu. The Profile action now targets `?tab=profile`.
- Construction and Manufacturing routes/navigation use Enterprise gates; retail POS is operating-model/capability gated. Plan-gate and vertical-navigation coverage is present in the suite. This PR did not redesign those gates.

### Accounting and reports

- Journal posting only transitions from draft. Posted journal corrections use a new reversal journal with flipped sides and `reversal_of`/`reversed_by` links; the original is marked reversed rather than edited in place.
- Financial statement period queries exclude both the reversed original and its reversal mirror when calculating performance; point-in-time balances retain both sides. Budget vs Actual queries restrict to posted non-reversal entries.
- Existing repository/migration tests cover reversal handling, posted-record workflows, report behavior, and budget actuals. These were included in the full Vitest run.
- Print/export affordances exist for financial reports and Budget vs Actual; payroll pay runs render a dedicated printable payslip view. This was source inspection, not an exhaustive browser/print-dialog test across every page.

### RLS and tenant policies — live metadata snapshot

- The active public schema had **175 base tables**; **175/175 had RLS enabled**, **0 had RLS disabled**, and **0 had FORCE RLS**.
- Of 147 base tables with a `business_id` column, 138 had one or more policies whose SQL expressions contained business/tenant authorization evidence (`business_id`, membership/write helpers, or `auth.uid()`). Nine business-id tables had no direct policies and are intended for RPC-only/service-only handling. This is a lexical metadata classification, not a proof that every predicate is semantically correct.
- **14 tables had RLS enabled but no policies**: `ai_insights_usage`, `api_usage`, `audit_20260927_sent_to_paid`, `business_terms_acceptances`, `partner_staff`, `phone_accounts`, `pos_approvals`, `pos_corrections`, `pos_held_orders`, `profiles`, `subscription_reminders_sent`, `subscriptions`, `support_agent_usage`, and `usage_counters`. No-policy tables deny ordinary row access, but that alone does not remove table privileges.
- The live ACL probe found direct `TRUNCATE` privileges on **69 public tables for `anon` and 128 for `authenticated`**. Default ACLs for both `postgres` and `supabase_admin` also granted `TRUNCATE` to client roles for future public tables. Since PostgreSQL RLS does not govern `TRUNCATE`, this is a defense-in-depth privilege defect. The migration in this PR addresses current and future table ACLs and strips all direct client privileges from the 14 no-policy tables. **The migration has not been applied to the live project**; those ACL counts remain the pre-migration baseline until the PR is deployed. Treat applying and re-running the catalog verification as a release gate.
- Partner admin entry is gated in the client and its data reads are scoped by partner-admin policies/helpers. The app has a read-only partner client roster/overview, not a “switch into client business” or impersonation mode; therefore no persistent acting-client banner/context was found to verify. If impersonation is introduced, it needs a server-authorized context and persistent banner before release.

### Audit trail

- The database migration set contains a SHA-256 audit-chain function and a chain-verification RPC; the audit repository exposes verification. Production POS void/refund paths use server-side correction RPCs, while the direct local path is demo-only. This source review does not prove full event coverage for every workflow or validate every live chain.

## Incomplete / release-gate items

1. **Hard-coded UI copy remains.** A preliminary JSX text-node scan found about **1,416 candidate inline-English text lines across 113 page/component files** (the scan also includes some non-copy/code-like candidates). The literal `t()` key coverage is now green, but replacing all remaining hard-coded English across accounting, inventory, POS, reports, construction, manufacturing, payroll, and settings is not complete and was not safe to claim as finished in this PR.
2. **Live ACL fix is pending deployment.** Until the new migration is applied and the RLS/grant verification query reports zero client `TRUNCATE` grants, the live ACL exposure described above remains.
3. **Phase 6G-specific AI gating remains unverified.** The codebase has a general `/ai` surface gated by the existing `ai_insights` capability (Pro), but no separate Phase 6G summary/forecast feature was identifiable in the current tree. This PR does not change the Pro entitlement. If the Phase 6G scope refers to the existing AI summary/forecast experience, it still needs a distinct Enterprise-only gate with the non-Enterprise upgrade preview.
4. **No impersonation feature exists.** Partner portal is read-only; client-context banner requirements are not applicable to current product behavior.
5. **Build-size warning remains.** Production Vite build succeeds, but reports a vendor chunk above 800 kB. This was not re-chunked in this hardening pass.
6. **Dependency audit:** production dependency audit reports zero high-severity vulnerabilities after non-breaking lockfile updates. The complete dev-inclusive audit still reports low/moderate advisories that would require breaking dependency changes to clear; no `--force` upgrade was made.
7. Existing Vite native-config warnings and some React/chart test warnings remain non-fatal. The build was run with placeholder Supabase URL/key because no production build secrets are present in this workspace.
8. The migration has a static contract test but was not replayed against local PostgreSQL: neither the Supabase CLI nor `psql` is installed in this workspace. Review/replay it in a disposable database before applying it to production.

## Verification results

- `npm run typecheck` — passed.
- Full Vitest suite — **251/251 test files passed; 1,991/1,991 tests passed**. Test-run warnings about placeholder Supabase variables and expected mocked error cases were non-failing.
- `npm run lint` — passed, 0 errors and 4 existing warnings (unused eslint-disable directives in two generated artifacts and `src/offline/queueApi.ts`).
- `npm run build` — passed; Vite transformed 3,570 modules. It emitted the existing native-config warnings and a chunk-size warning for the 913.89 kB vendor chunk.
- `npm audit` — 17 development-inclusive findings remain (2 low, 15 moderate); clearing them via the suggested fix would require breaking upgrades, so `--force` was not used.
- `npm audit --omit=dev --audit-level=high` — passed, 0 vulnerabilities.
- `git diff --check` — passed.
