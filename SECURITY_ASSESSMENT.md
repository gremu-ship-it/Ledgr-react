# Security Vulnerability Assessment — Ledgr

**Date:** 2026-09-09
**Scope:** Frontend (React/Vite), API gateway (`server/`), Supabase Edge Functions, CI/deploy config, dependency tree, git history.

---

## Executive summary

The codebase is in **good security shape overall** — clearly hardened by prior remediation work. No critical issues, no leaked secrets, no injection vulnerabilities that are exploitable in the app's threat model. The two **high-severity dependency vulnerabilities were fixed during this assessment** (see §1). Remaining items are low-risk hygiene improvements.

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| High | 2 (dependencies) | ✅ **Fixed** |
| Moderate | 3 (dependencies) | ✅ `qs` fixed; 2 remaining are dev-only vitest (needs major bump) |
| Low | 2 (code hygiene: CSV formula injection, `rel` attributes) | ✅ **Fixed** |

---

## 1. Dependency vulnerabilities (npm audit)

### Fixed in this session (`npm audit fix`, all 323 tests still pass)

| Package | Severity | Issue |
|---|---|---|
| `fast-uri` 3.0.0–3.1.5 | **High** | 4 advisories: SSRF via malformed IPv6 normalization / repeated percent-decoding, host confusion (GHSA-5jgf-p345-68v8, GHSA-f65p-4m7j-42xc, GHSA-fph4-wmhf-6fwf, GHSA-jqff-g426-hqxp). Was the **only production-dependency vuln**. → patched to ≥3.1.6 |
| `browserslist` ≤4.28.6 | **High** (dev) | Unbounded memory growth / prototype write via untrusted stats (GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g) → patched |
| `baseline-browser-mapping` <2.11.0 | Moderate (dev) | DoS on invalid input (GHSA-w5vr-8v7q-w6rv) → patched |

### Remaining (dev/test only — not shipped to production)

| Package | Severity | Issue | Notes |
|---|---|---|---|
| `vitest` / `@vitest/mocker` 2.1.0–4.1.10 | Moderate | Path traversal / arbitrary file read via redirect mock (GHSA-82fw-gwwq-j7x9) | Only exploitable when running the Vitest **browser-mode dev server** locally. Fix requires vitest 5 (breaking). Recommend upgrading when convenient. |
| ~~`server/`: `qs`~~ | Moderate | Prototype pollution range in express transitive dep | ✅ **Fixed** — pinned to ≥6.16.0 via `overrides` in `server/package.json`; server tests pass. Redeploy the gateway to pick it up. |

---

## 2. Secrets & credential exposure — ✅ Clean

- **No hardcoded secrets** anywhere in the tree (scanned for API keys, JWTs, `sk_live`/`whsec_` patterns, high-entropy assignments).
- **Git history clean** — only `.env.example` placeholder values ever committed.
- `.gitignore` correctly excludes `.env`, `.env.local`, `.env.production`.
- Client bundle only receives `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (public by design; security enforced by RLS).

## 3. Backend / Edge Functions — ✅ Strong

- **payment webhook (`paychangu-webhook`)**: HMAC-SHA256 signature verification with constant-time comparison, **plus** server-to-server re-verification of the transaction before trusting it, plus idempotent application. This is textbook-correct.
- **Cron endpoints** (`expire-subscriptions`, `generate-vat-returns`, `process-invoice-automation`, `retry-failed-webhooks`): all require `x-cron-secret` and **fail closed** when the secret env var is unset.
- **API keys**: stored as SHA-256 hashes (`key_hash`), never plaintext; per-key rate-limit buckets.
- **Webhook dispatcher SSRF guard**: blocks localhost, private IP ranges (incl. `::ffff:` mapped), and resolves DNS to check all addresses before fetching customer-supplied webhook URLs. 
- **CORS**: centralized origin allowlist (`ALLOWED_ORIGINS`) instead of `*`; reflects only allowlisted origins with `Vary: Origin`.
- **Email sending (`send-invoice`)**: HTML body passes through a tag/attribute sanitizer (strips scripts, event handlers, `javascript:`/`data:` URIs) before dispatch.
- **RLS**: enabled on all captured tables (per `artifacts/database/capture/rls.txt`), 141 policies in place.
- **`server/` gateway**: helmet, CORS allowlist, tiered rate limiting (10/min anon, 100/min authed), 1 MB body limit, non-root Docker user (`USER node`), multi-stage build.

## 4. Frontend — ✅ Strong, 2 low-risk notes

- **No** `dangerouslySetInnerHTML`, `eval`, or `new Function` usage.
- The one `innerHTML` assignment (`AuditLogPage.tsx` print export) escapes **all** interpolated values via `esc()` — not exploitable.
- Deployment headers (`vercel.json`) are excellent: strict CSP (no `unsafe-eval`, `frame-ancestors 'none'`), HSTS with preload, `nosniff`, COOP, CORP, Permissions-Policy.
- `window.open` popups explicitly null out `opener` — reverse-tabnabbing handled.

### Low-risk findings — ✅ both fixed

**L-1: CSV formula injection in exports — FIXED.** Added a shared, tested helper `src/lib/csv.ts` (`isFormulaLike` / `escapeCsvCell` / `buildCsv` / `downloadCsvFile`) that prefixes formula-trigger cells (`=`, `+`, `@`, tab, CR, and non-numeric `-` payloads) with `'` per OWASP guidance, while leaving legitimate negative amounts (`-500`, `-1,234.56`) untouched. Wired into all three export sites: `CapitalPage.tsx` (loans / share capital), `AuditLogPage.tsx` (audit-log CSV), and `dataImportService.ts` (import templates). Covered by 8 new unit tests in `src/lib/__tests__/csv.test.ts`.

**L-2: `target="_blank"` links — FIXED.** All 8 external links now carry explicit `rel="noopener noreferrer"` (4 already had it; `SettingsPage.tsx`, `ZapierIntegrationPage.tsx`, `PartnerOverviewPage.tsx`, `TeamManagementPage.tsx` upgraded from bare `rel="noreferrer"`).

## 5. What was tested

1. `npm audit` on root and `server/` lockfiles (prod + dev trees)
2. Secret scanning: working tree + full git history (JWT patterns, key-name/value pairs, high-entropy strings)
3. Injection surface: `innerHTML` / `dangerouslySetInnerHTML` / `eval` / `document.write`, template-literal HTML builders, CSV builders
4. Auth review of all 26 Supabase Edge Functions (JWT checks, cron secrets, service-role usage, webhook signatures)
5. CORS configuration (edge shared helper + express gateway)
6. SSRF surface (customer-supplied webhook URLs)
7. Security headers / CSP (`vercel.json`)
8. Storage of sensitive data in `localStorage` (only UI prefs / language / partner branding cache — no tokens beyond Supabase's own session handling)
9. Open-redirect patterns (none found; webhook GET redirect builds from validated `APP_URL` env, not user input)
10. Dockerfile hardening review

## 6. Changes made in this session

1. `package-lock.json`: `npm audit fix` — resolved both **high** advisories (`fast-uri`, `browserslist`) and one moderate (`baseline-browser-mapping`).
2. `server/package.json` + `server/package-lock.json`: pinned `qs` to ≥6.16.0 via `overrides`, clearing the moderate prototype-pollution advisory. Server tests pass (5/5). **Redeploy the gateway** (Railway/Render) to pick this up.
3. **New:** `src/lib/csv.ts` — shared CSV builder with formula-injection guard + `src/lib/__tests__/csv.test.ts` (8 tests).
4. `src/pages/CapitalPage.tsx`, `src/pages/AuditLogPage.tsx`, `src/services/dataImportService.ts` — CSV exports now route through the guarded builder.
5. 4 components upgraded to explicit `rel="noopener noreferrer"` on `target="_blank"` links.

**Verification:** `tsc -b` clean, ESLint clean (2 pre-existing unrelated warnings), full test suite **40 files / 331 tests passing**.

Remaining open item: dev-only `vitest` moderate advisory (root + server) — requires a major-version upgrade to vitest 5; recommended as separate maintenance work.
