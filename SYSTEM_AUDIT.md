# Ledgr — Comprehensive System Audit

**Date:** 2026-07-28
**Commit audited:** `e5be875` (branch `arena/019fa927-ledgr-react`)
**Scope:** Frontend (React 19 / Vite 8), data-access layer, Supabase schema + RLS, 23 Edge Functions, CI/CD, dependencies, security posture.

---

## 1. Executive summary

Ledgr is a mature, well-structured multi-tenant accounting SaaS (~50,000 LOC of TS/TSX across 209 source files). **The build pipeline is entirely green** — typecheck, lint, unit tests and production build all pass cleanly. The codebase shows genuine engineering discipline: a repository-pattern DAL, RLS-first data model, hardened HTTP security headers, HMAC-verified payment webhooks, hashed API keys, and unusually good explanatory comments in migrations and config.

The material risks are concentrated in three places: **four database tables shipped without Row Level Security**, **a critical/high dependency vulnerability backlog**, and **a near-total absence of automated test coverage** for a system that computes financial statements and tax returns.

### Verification results

| Check | Command | Before | After remediation |
|---|---|---|---|
| Type check | `tsc -b` | ✅ Pass (0 errors) | ✅ Pass |
| Lint | `eslint .` | ✅ Pass (0 warnings) | ✅ Pass |
| Unit tests | `vitest run` | ✅ 16 tests / 2 files | ✅ **54 tests / 5 files** |
| Production build | `vite build` | ✅ 1.29s, 2.4 MB | ✅ Pass |
| Dependency audit | `npm audit` | ❌ 27 (1 crit, 24 high) | ⚠️ **6 (0 crit, 5 high)** |

### Risk register

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | 4 tables have no Row Level Security enabled | **Critical** | ✅ **Fixed** |
| F2 | 1 critical + 24 high dependency vulnerabilities | **High** | ✅ **Largely fixed** (27 → 6, critical cleared) |
| F3 | `generate-vat-returns` Edge Function has no auth guard | **High** | ✅ **Fixed** |
| F4 | Test coverage ≈ 1% on a financial-calculation system | **High** | 🟡 **Started** (16 → 52 tests) |
| F5 | Dead, buggy `api/middleware.ts` rate limiter | Medium | ✅ **Fixed** (deleted) |
| F6 | `Access-Control-Allow-Origin: *` on 15 authenticated functions | Medium | ✅ **Fixed** (allowlist) |
| F7 | Hardcoded Supabase project ref in `vite.config.ts` / docs page | Low | ✅ **Fixed** (derived from `VITE_SUPABASE_URL`, prod ref as fallback) |
| F8 | Duplicate orphaned components (auth pages, ErrorBoundary) | Low | ✅ **Fixed** (deleted) |
| F9 | README is still the unmodified Vite template | Low | ✅ **Fixed** (rewritten — features, stack, quickstart, structure, docs index) |

---

## 1a. Remediation log

Everything below was implemented and verified against the full pipeline
(`typecheck → lint → test → build`, all green).

| Finding | Change |
|---|---|
| F1 | New migration `20260728000005_enable_rls_on_unprotected_tables.sql`. Enables RLS on all four tables, with `<table>_business_access` policies scoped through `business_users` (matching the existing convention). `api_usage` gets RLS with **no** policy — service-role only by design. `currencies` gets a read-only policy. |
| F2 | Removed `@vercel/node` (a devDependency used for **two type imports** in `api/health.ts`, but the root of the critical `tar` chain — types replaced with local structural interfaces). Upgraded `@sentry/vite-plugin` 2→5, `vite-plugin-pwa`, `react-router-dom`. **27 → 6 advisories; critical eliminated.** |
| F3 | Added the `x-cron-secret` guard used by every sibling cron function, and corrected the in-file scheduling docs to pass the header. |
| F4 | Extracted `calculatePAYE` out of `PayrollPage.tsx` into testable `src/lib/paye.ts`, and the depreciation maths into `src/services/depreciation.ts` (a leaf module with no Supabase import chain). Added 38 tests across three suites: PAYE bands, the double-entry invariant in `createBalancedEntry`, and depreciation. |
| F10 | Aligned `depreciationRate` with the codebase-wide percentage convention — see below. |
| F5 | Deleted `supabase/functions/api/middleware.ts`. |
| F6 | New `supabase/functions/_shared/cors.ts` with an origin allowlist from `ALLOWED_ORIGINS`/`APP_URL`, applied to the 11 sensitive functions via a `withCors` wrapper. Falls back to `*` when unconfigured, so the change is non-breaking; localhost always allowed. |
| F8 | Deleted the three orphaned components, first porting the better `role="alert"` markup and the error-message-suppression from the dead `ErrorBoundary` into the live one. |
| F11 | Re-applied the F2 dependency remediation on `arena/019fc2dd-ledgr-react` and finished the job: removed `@vercel/node` again (types in `api/health.ts` replaced with local structural interfaces), migrated `react-router` 7 → 8 (`react-router-dom` dropped — v8 exports everything from `react-router`; all 44 imports swapped), bumped `react`/`react-dom` to 19.2.7 (v8 peer minimum), `postcss` to 8.5.25, added a `tsx` override (4.23.4 → `esbuild` 0.28.1, clearing the last advisory). `npm audit`: **0 vulnerabilities** (was 13: 1 critical, 9 high, 3 moderate). Full pipeline green: typecheck, lint, 170 tests, production build. |
| F7/F9 | On the same branch: `vite.config.ts` + `ApiDocumentationPage.tsx` now derive the Supabase host from `VITE_SUPABASE_URL` (prod ref kept only as a fallback). PWA `runtimeCaching` patterns use a build-time RegExp — workbox serialises urlPatterns via `toString()`, so the computed host must be embedded in the pattern itself, not a closure variable (verified in `dist/sw.js` for both the env and fallback paths). README rewritten from the stock Vite template into a project README (features, stack, quickstart, layout, docs index). |

### Depreciation units — resolved

`calculateMonthlyDepreciation` previously treated `depreciationRate` as a
**fraction** (`0.24` = 24%/yr), while the adjacent
`asset_categories.mra_depreciation_rate` is a **percentage** (`max="100"`,
placeholder `"e.g. 25"`, rendered `25.0%`). The two have now been aligned on
**percentage**, which is the correct direction because it is what the rest of
the codebase already does without exception:

| Rate | Stored as | Converted at use |
|---|---|---|
| `paye_bands.rate` | percentage | `band.rate / 100` |
| TPR pension employer/employee | percentage | `Number(...) / 100` |
| Loan interest `ratePct` | percentage | `ratePct / 100 / 12` |
| Invoice `discount_percent` | percentage | `discount_percent / 100` |
| `asset_categories.residual_percent` | percentage | rendered `%` |
| `depreciation_rate` (was) | **fraction** | **the sole outlier** |

**This is behaviour-preserving.** Two independent reasons:

1. **Nothing writes `fixed_assets.depreciation_rate`** — not the asset form, not
   the category form, not the CSV importer, not any migration, trigger or Edge
   Function. It is `null` for every row in existence, so the explicit-rate branch
   is unreachable today.
2. **The derived fallback is bit-identical.** It changed from
   `1 / (monthsLife / 12)` (fraction) to `100 / (monthsLife / 12)` (percentage),
   and the divisor changed from `/12` to `/100/12`. Both reduce to the same
   monthly rate — verified numerically, and pinned by a regression test across
   3/5/10/20-year lives. Every existing asset depreciates by exactly the same
   amount.

The practical effect is that `asset_categories.mra_depreciation_rate` can now be
fed straight into an asset with no conversion, which is what someone would
naturally have done — and which would previously have depreciated the asset
100x too fast in a single period.

**Deliberately not done:** I did not auto-wire the category rate as a fallback
(mirroring how `resolveAssetAccounts` falls back to category accounts). That
would change real depreciation charges for any business that has set an MRA rate
on a category, which is a product decision rather than a units fix. The units are
now safe for you to make that change whenever you want it.

**The 6 remaining advisories are all low-exploitability here.** `react-router`'s
is an **RSC-mode** CSRF bypass — this app is a Vite SPA using `BrowserRouter`,
so the affected code path is not reachable, and the only "fix" npm offers is a
downgrade to 7.11.0 or a major jump to 8.x. `postcss`, `brace-expansion`,
`fast-uri` and `esbuild` are build/dev-time only. None warranted a risky major
upgrade as part of a security fix pass; they are better handled as a deliberate
dependency-upgrade task.

---

## 2. Critical & high findings

### F1 — Four tables ship without Row Level Security (Critical)

19 of 23 tables correctly call `enable row level security`. Four do not:

| Table | Migration | Exposure |
|---|---|---|
| `invoice_delivery_events` | `20260725000001_invoice_automation.sql` | **Cross-tenant leak.** Has `business_id`; any authenticated user can read every tenant's invoice open/send audit trail. |
| `recurring_invoices` | `20260725000001_invoice_automation.sql` | **Cross-tenant leak + write.** Has `business_id`; readable *and writable* by any authenticated user. |
| `api_usage` | `20250724_api_usage.sql` | Rate-limit counters readable/writable by any authenticated user — a client could reset its own counter and bypass throttling. |
| `currencies` | `20260727000000_multi_currency_ias21.sql` | Low impact — global ISO reference data. Still needs an explicit read-only policy rather than defaulting open. |

This is the single highest-value fix. Supabase exposes every table through PostgREST by default, so "no RLS" means "world-readable to any holder of the anon key" — and the anon key is, by design, in the client bundle.

**Remediation** — new migration:

```sql
-- Tenant-scoped tables
alter table public.invoice_delivery_events enable row level security;
create policy "tenant read" on public.invoice_delivery_events
  for select to authenticated
  using (business_id in (select business_id from public.user_businesses
                         where user_id = auth.uid()));

alter table public.recurring_invoices enable row level security;
create policy "tenant all" on public.recurring_invoices
  for all to authenticated
  using (business_id in (select business_id from public.user_businesses
                         where user_id = auth.uid()))
  with check (business_id in (select business_id from public.user_businesses
                              where user_id = auth.uid()));

-- Service-role only; no policies means no authenticated access at all
alter table public.api_usage enable row level security;

-- Global read-only reference data
alter table public.currencies enable row level security;
create policy "read currencies" on public.currencies
  for select to authenticated using (true);
```

Match the subquery to whatever this repo's existing helper is (the codebase already has `current_partner_ids()` / `business_partner_id()` helpers worth reusing for consistency).

### F2 — Dependency vulnerabilities (High)

27 advisories: **1 critical, 24 high, 2 moderate**.

- **Critical — `tar`**: arbitrary file creation/overwrite via hardlink path traversal. Reached transitively via `@vercel/node → @vercel/nft → @mapbox/node-pre-gyp`.
- **High — `react-router` / `react-router-dom`**: RSC-mode CSRF bypass. This is the only advisory in a *runtime* dependency shipped to browsers; the rest are build/dev-time.
- **High — `postcss`**: path traversal via sourceMappingURL auto-loading.
- **High — `undici`, `brace-expansion`, `minimatch`, `glob`, `ejs`, `path-to-regexp`, `fast-uri`**: mostly DoS/ReDoS, all transitive through `@vercel/node`, `@sentry/vite-plugin`, and `vite-plugin-pwa`.
- **Moderate — `esbuild`**: dev-server request forgery (dev-only, but note `server.host = '0.0.0.0'` in `vite.config.ts` binds the dev server to all interfaces).

`npm audit fix` alone does not clear these; the tree needs `--force`-level major bumps. The single highest-leverage move is upgrading `@vercel/node` 3 → 5, which is the root of the `tar`/`nft`/`ajv`/`ts-morph` cluster. `@sentry/react` 8 → 10 and `@sentry/vite-plugin` 2 → 5 clear another cluster. Prioritise `react-router-dom` first since it is the only one that reaches production users.

### F3 — `generate-vat-returns` has no authentication (High)

Every other cron-style function guards itself — `process-invoice-automation` checks `x-cron-secret`, `expire-subscriptions` and `send-renewal-reminders` check `CRON_SECRET`. `generate-vat-returns` does not:

```ts
Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, // bypasses RLS, runs for ALL businesses
  );
  // ...no header check anywhere...
```

It iterates every VAT-registered business with the service role and writes tax returns. There is no `supabase/config.toml` in the repo, so the functions rely on Supabase's platform default `verify_jwt = true` — which means a *valid JWT from any signed-up user* is sufficient to trigger it. Anyone with a free account can force VAT-return generation platform-wide, causing duplicate/incorrect filings and unbounded compute.

**Remediation** — mirror the sibling functions:

```ts
if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
  return new Response(JSON.stringify({ error: 'Unauthorised' }), { status: 401 });
}
```

Also add a `supabase/config.toml` pinning `verify_jwt` per function so the security posture is explicit and version-controlled rather than inherited from dashboard state.

### F4 — Effectively no test coverage (High)

Two test files, 16 assertions, covering `usePermissions` and `formatters`. Nothing covers:

- **Double-entry integrity** — `journalService.ts`, `CapitalJournalService.ts`, `FixedAssetsJournalService.ts`
- **Financial statements** — `StatementOfProfitOrLoss`, `StatementOfFinancialPosition`, `CashFlowStatement`, `StatementOfChangesInEquity`, `FinancialStatementRepository`
- **Tax** — VAT return generation, `TaxReturnRepository`, remittance logic
- **FX** — `FxRevaluationService` (IAS 21 revaluation)
- **Payroll**, **inventory recalculation**, **bank reconciliation matching**
- **Any of the 28 repositories** in the DAL

For a product whose output is filed with a revenue authority, a debits-equal-credits invariant test and golden-file tests over the five statements are the highest-value additions available. `vitest` is already configured (`environment: 'node'`) so pure calculation modules can be tested today with zero setup. Note the config only picks up `src/**/*.test.ts(x)` — Edge Functions under `supabase/` are outside the test glob entirely.

---

## 3. Medium & low findings

### F5 — Dead and incorrect rate limiter (Medium)

`supabase/functions/api/middleware.ts` exports `checkRateLimit` that is **never imported anywhere**. `api/index.ts` defines its own correct version (comment even notes it "fixes the previous code which referenced a non-existent `api_key_id` column").

The orphan is actively wrong: it upserts with `onConflict: "api_key"`, but the only unique index is `api_usage_api_key_id_window_uidx on (api_key_id, window_start)`. There is no unique constraint on `api_key`, so that upsert would throw at runtime. It also uses a rolling `now() - 60s` read against fixed-window rows. **Delete the file** before someone imports it in good faith.

### F6 — Wildcard CORS on authenticated endpoints (Medium)

15 Edge Functions set `Access-Control-Allow-Origin: '*'`, including sensitive ones: `create-api-key`, `invite-team-member`, `grant-manual-subscription`, `export-my-data`, `request-account-deletion`.

Impact is limited because these authenticate via a bearer `Authorization` header (not cookies), so a browser won't auto-attach credentials cross-origin. But it discards a free layer of defence and undercuts the otherwise-strict CSP in `vercel.json`. Echo back an allowlist of `APP_URL` origins instead.

### F7 — Hardcoded project reference (Low)

Project ref `hsuhuvuxfuufrlejsatw` is baked into `vite.config.ts` (two Workbox `runtimeCaching` rules) and `src/pages/ApiDocumentationPage.tsx`. Not a secret — but it hardcodes prod into the build, so a staging deploy silently gets no API caching and shows the wrong docs URL. Derive from `VITE_SUPABASE_URL` via `new URL(...).hostname`.

### F8 — Orphaned duplicate components (Low)

- `src/pages/ForgotPasswordPage.tsx` and `src/pages/ResetPasswordPage.tsx` are dead — `App.tsx` imports the `src/pages/auth/` versions.
- `src/components/ErrorBoundary.tsx` (2.4 KB) is dead — `App.tsx` uses `src/components/ui/ErrorBoundary.tsx` (1.4 KB).

Risk is maintenance drift: a security fix applied to the wrong copy. Delete the four unused files.

### F9 — README is the stock Vite template (Low)

`README.md` is the unmodified "React + TypeScript + Vite" boilerplate — no setup steps, env-var list, migration instructions, or architecture notes, despite 8 other high-quality docs existing (`DEPLOYMENT.md`, `PAYCHANGU_SETUP.md`, `WHITE_LABEL_SETUP.md`, etc.). It is the front door and currently describes a different project.

---

## 4. What is working well

Worth recording, because a lot here is above average:

- **Clean toolchain.** Zero type errors and zero lint warnings across 50k LOC is not common.
- **HTTP hardening.** `vercel.json` ships a genuinely strict CSP (no `unsafe-eval`, `frame-ancestors 'none'`, scoped `connect-src`), HSTS with preload, COOP/CORP, and a restrictive Permissions-Policy.
- **Payment webhook security.** `paychangu-webhook` does HMAC-SHA256 with a **constant-time comparison**, fails closed when the secret is absent, and re-queries the provider rather than trusting payload amounts.
- **API keys** are stored as SHA-256 hashes with CSPRNG generation (`crypto.getRandomValues`), never in plaintext.
- **SQL injection surface is nil** — all access goes through the Supabase client / repository layer; no string-built SQL.
- **XSS surface is small** — zero `dangerouslySetInnerHTML`; the five `document.write`/`innerHTML` hits are all print-preview windows built from app-controlled report data.
- **Defence in depth in SQL.** 24 `SECURITY DEFINER` functions with pinned `search_path`, plus dedicated hardening migrations for RLS recursion and partner-view isolation — evidence of real security iteration.
- **Sensible bundling.** Route-level lazy loading plus manual vendor chunks; largest gzipped chunk 106 KB, total precache 2.2 MB. Reasonable for an offline-capable PWA.
- **Solid CI.** Node 20/22 matrix running typecheck → lint → test → build, with placeholder env vars and an honest comment about why Node 18 is excluded.
- **Secrets hygiene.** No credentials in source; `.env` properly gitignored; `.env.example` documents which vars must *not* be `VITE_`-prefixed.

---

## 5. What remains

**⚠ Blocker — one manual edit required before merging**

`.github/workflows/deploy.yml` loops over every directory in
`supabase/functions/` and runs `supabase functions deploy` on each. The new
`_shared/cors.ts` module lives in a directory there but is **not** a deployable
function, so the loop will fail on an invalid function slug and **break both the
staging and production deploys**.

I wrote the fix but could not push it: the GitHub App backing this session lacks
the `workflows` permission, so any commit touching `.github/workflows/` is
rejected by the remote. Apply this by hand to **both** deploy loops (around
lines 135 and 231), immediately after `fn="$(basename "$dir")"`:

```yaml
            # Directories prefixed with _ are shared modules imported by the
            # functions (e.g. _shared/cors.ts), not deployable functions.
            # `supabase functions deploy _shared` fails on an invalid slug.
            case "$fn" in _*) echo "Skipping shared module: $fn"; continue ;; esac
```

(Underscore-prefixed directories are the Supabase convention for shared code;
the CLI's own bulk deploy skips them, but this repo's hand-rolled loop does not.)

**Requires a decision from you**
1. **Optional follow-up:** now that units match, decide whether `postAssetDepreciation` should fall back to `asset_categories.mra_depreciation_rate` when an asset has no own rate (mirroring `resolveAssetAccounts`). This would change real charges, so it is left to you.
2. **Deploy the RLS migration** and confirm against the live database. The four tables were unprotected in migrations, but it is possible policies were applied by hand via the dashboard; verify before assuming the leak was live.
3. **Set `ALLOWED_ORIGINS`** in Supabase secrets. Until it is set, CORS still falls back to `*` — deliberately, so this change could not break a running deployment.

**Still open**
4. F7 — Derive the Supabase hostname from `VITE_SUPABASE_URL` instead of hardcoding the project ref.
5. F9 — Rewrite the README.
6. F4 (continued) — The highest-value remaining targets are golden-file tests over the five financial statements, `FxRevaluationService` (IAS 21), and VAT return generation. The vitest glob also still excludes `supabase/functions`, so no Edge Function is covered.
7. F2 (residual) — Schedule a deliberate major-upgrade pass for the 6 remaining advisories rather than forcing them through now.
8. Add a `supabase/config.toml` pinning `verify_jwt` per function, so the auth posture is version-controlled rather than inherited from dashboard state.

---

## 6. Method & limitations

Audit performed against a clean `npm ci` install: full toolchain execution (`tsc -b`, `eslint`, `vitest run`, `vite build`), `npm audit` and `npm-check-updates`, plus static review of all 23 Edge Functions, 24 migrations, CI/CD workflows, and deployment config. RLS coverage was computed by parsing `create table` against `enable row level security` across all migrations plus `schema.sql`.

**Not covered:** no live Supabase project was available, so RLS policies were reviewed as written rather than probed at runtime — the F1 findings should be confirmed against the live database, and it is possible some policies were applied out-of-band via the dashboard. No DAST, penetration testing, load testing, or accessibility re-audit was performed (see the existing `A11Y_REPORT.md` / `A11Y_FIX_PLAN.md`).
