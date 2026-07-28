# Ledgr — Comprehensive System Audit

**Date:** 2026-07-28
**Commit audited:** `e5be875` (branch `arena/019fa927-ledgr-react`)
**Scope:** Frontend (React 19 / Vite 8), data-access layer, Supabase schema + RLS, 23 Edge Functions, CI/CD, dependencies, security posture.

---

## 1. Executive summary

Ledgr is a mature, well-structured multi-tenant accounting SaaS (~50,000 LOC of TS/TSX across 209 source files). **The build pipeline is entirely green** — typecheck, lint, unit tests and production build all pass cleanly. The codebase shows genuine engineering discipline: a repository-pattern DAL, RLS-first data model, hardened HTTP security headers, HMAC-verified payment webhooks, hashed API keys, and unusually good explanatory comments in migrations and config.

The material risks are concentrated in three places: **four database tables shipped without Row Level Security**, **a critical/high dependency vulnerability backlog**, and **a near-total absence of automated test coverage** for a system that computes financial statements and tax returns.

### Verification results

| Check | Command | Result |
|---|---|---|
| Type check | `tsc -b` | ✅ Pass (0 errors) |
| Lint | `eslint .` | ✅ Pass (0 warnings) |
| Unit tests | `vitest run` | ✅ 16 tests / 2 files pass |
| Production build | `vite build` | ✅ Pass — 1.29s, 2.4 MB `dist` |
| Dependency audit | `npm audit` | ❌ 27 vulns (1 critical, 24 high, 2 moderate) |

### Risk register

| # | Finding | Severity | Effort |
|---|---|---|---|
| F1 | 4 tables have no Row Level Security enabled | **Critical** | Low |
| F2 | 1 critical + 24 high dependency vulnerabilities | **High** | Medium |
| F3 | `generate-vat-returns` Edge Function has no auth guard | **High** | Low |
| F4 | Test coverage ≈ 1% on a financial-calculation system | **High** | High |
| F5 | Dead, buggy `api/middleware.ts` rate limiter | Medium | Low |
| F6 | `Access-Control-Allow-Origin: *` on 15 authenticated functions | Medium | Low |
| F7 | Hardcoded Supabase project ref in `vite.config.ts` / docs page | Low | Low |
| F8 | Duplicate orphaned components (auth pages, ErrorBoundary) | Low | Low |
| F9 | README is still the unmodified Vite template | Low | Low |

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

## 5. Recommended sequence

**Immediate (this week)**
1. F1 — RLS migration for the four tables. Highest severity, lowest effort.
2. F3 — Add the cron-secret guard to `generate-vat-returns`; add `supabase/config.toml` with explicit `verify_jwt`.
3. F5 — Delete `supabase/functions/api/middleware.ts`.

**Short term (this sprint)**
4. F2 — Bump `react-router-dom` first, then `@vercel/node` 3→5 and the Sentry packages; re-audit.
5. F8 — Delete the four orphaned components.
6. F6 — Replace wildcard CORS with an `APP_URL` allowlist.

**Medium term**
7. F4 — Start with a debits==credits invariant test and golden-file tests for the five financial statements, then the tax and FX services. Extend the vitest glob to cover `supabase/functions`.
8. F7 — Derive the Supabase hostname from env.
9. F9 — Rewrite the README.

---

## 6. Method & limitations

Audit performed against a clean `npm ci` install: full toolchain execution (`tsc -b`, `eslint`, `vitest run`, `vite build`), `npm audit` and `npm-check-updates`, plus static review of all 23 Edge Functions, 24 migrations, CI/CD workflows, and deployment config. RLS coverage was computed by parsing `create table` against `enable row level security` across all migrations plus `schema.sql`.

**Not covered:** no live Supabase project was available, so RLS policies were reviewed as written rather than probed at runtime — the F1 findings should be confirmed against the live database, and it is possible some policies were applied out-of-band via the dashboard. No DAST, penetration testing, load testing, or accessibility re-audit was performed (see the existing `A11Y_REPORT.md` / `A11Y_FIX_PLAN.md`).
