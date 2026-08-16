# Phase 10 — Final Integrity Report

**Auditor:** independent (Phase 10 rules)
**Date:** 2026-08-16
**Commit audited:** `fc3d272` (main)
**Environments:** disposable PostgreSQL replay (62 migrations) · hosted
staging (verified via prior captures) · production (read-only observations;
**no modifications**)

> **Method:** every conclusion is supported by evidence gathered this phase
> (DB suite runs, code inspection, config inspection, deployment history).
> Items requiring a browser/hosted-staging interaction are classified
> **BLOCKED**, not PASS.
>
> **Update (2026-08-16, Phase 10.1 remediation — PR #105):** findings A-01
> (build-time env guard), A-02 (narrow catch + backfill), A-03 (amount_due
> trigger), A-04 (CHECK constraints) and A-05 (VAT constant) are FIXED with
> regression evidence in `docs/audit/phase-10-remediation-report.md`. A-06
> (staging Vercel deploy) is diagnosed and requires a Vercel dashboard
> action; A-07…A-12 unchanged. Certification remains 🟡 YELLOW — see the
> remediation report §9.

---

## 1. Executive summary

Ledgr's **database layer is in strong shape**: 62/62 migrations replay on a
fresh DB; the RLS suite demonstrates no cross-tenant access; accounting
journals balance (including a discounted invoice); document-number
reservation is atomic under concurrency; the approved PAYE bands compute
correctly; storage is business-scoped.

**However, the audit found real defects — including one P0 incident that
already occurred in production (blank login page), and several P1/P2
integrity gaps that would affect real customers:**

1. **P0 (incident, remediated, root cause not yet guarded):** production was
   deployed with a missing `VITE_SUPABASE_ANON_KEY_PROD` secret → the app's
   module-scope throw produced a **blank page** for all users. Fixed by
   adding the secret + redeploy. **No build-time guard prevents recurrence.**
2. **P1:** `journalService` silently falls back to net revenue posting when
   the discount account (4130) is missing — a broad `catch` changes the
   accounting disclosure **without warning** and masks real errors.
3. **P2 × 3:** `invoices.amount_due` is never set (stays NULL — direct
   consumers get NULL/0); **no DB CHECK** prevents negative invoice
   quantities or negative inventory stock (app-level validation only).
4. **P2:** hard-coded VAT `0.175` in four places (duplicated, rate-change
   risk).
5. **P2 (ops):** staging frontend deploy to Vercel is currently failing.
6. **BLOCKED:** browser-only journeys (discount UI/PDF reconciliation, PDF
   download, AI, offline, UI tenant manipulation) — cannot be executed in
   this sandbox; they remain the open items for full certification.

**Certification: 🔴 RED → 🟡 (see §30).** Not GREEN: P1 remains open and
browser verification is incomplete. Not RED at the DB layer (no cross-tenant
access, journals balance), but the P1 silent-fallback and the unguarded env
failure keep it below GREEN.

---

## 2. Scope

- Repository reconnaissance (system map: `phase-10-system-map.md`).
- Database integrity + replay + RLS + accounting + concurrency + hostile
  inputs (executed on disposable PostgreSQL, 62 migrations).
- Environment/deployment safety (GitHub Actions, secrets, Vercel, incident
  history).
- Code-quality and security seams (static).
- Browser journeys: **BLOCKED** (no browser; hosted staging requires an
  operator).

## 3. Environment tested

| Environment | Used for | Status |
|---|---|---|
| Disposable PostgreSQL 18.4 (62-migration replay) | DB suites, RLS, accounting, concurrency | ✅ executed |
| Hosted staging (`bkxzgkurcqvccsdjmqzg`) | prior captures (8A.1/8B); schema evidence | ✅ referenced |
| Production (`hsuhuvuxfuufrlejsatw`) | read-only observations (deploys, incident) | 🔒 not modified |

## 4. System map

See `docs/audit/phase-10-system-map.md`.

## 5. Database integrity

**VERIFIED PASS:**
- 62/62 migrations replay cleanly on a fresh DB (all 6 DB suites pass:
  20+7+41+8+16+10 = 102 assertions).
- Base migration is idempotent (re-apply on existing schema = no-op);
  8B reconstructions drop-first legacy functions/views (proven with
  simulated legacy objects).
- Live staging == fresh replay (8A.1): 65 tables, 16 enums, 195 FKs,
  11 triggers, 3 cron, extensions, version 17.6.

**VERIFIED FAIL / PARTIAL:**
- **`invoices.amount_due` is never populated** (nullable, no default, no
  write path found). AR view coalesces correctly, but any direct consumer
  (export, custom report, future integration) sums `amount_due` → NULL/0.
  Evidence: Phase 10 test (customer-balance query returned 0 while AR view
  returned 47587.50); `grep` confirms no app write to `amount_due`.

## 6. RLS / tenant isolation

**VERIFIED PASS (database layer):** 41/41 RLS assertions — ORG-A/ORG-B
matrix across SELECT/INSERT/UPDATE/DELETE on contacts, products, journal
lines, team lists, profiles, employees, audit log; anonymous denied; audit
immutable; role tiering matches the repo's own helpers; storage
business-scoped. **No cross-tenant access at the DB layer.**

**BLOCKED:** UI/API manipulation paths (altered business_id in URLs/payloads
through the frontend) — requires hosted staging browser + direct API tests
(§9.5 of the Phase 9 script).

## 7. Accounting integrity

**VERIFIED PASS (executed):**
- Every posted journal in the audit suite balances (|ΣD − ΣC| ≤ 0.005) —
  invoice, payment, expense, COGS, payroll, tax, API journal.
- Trial balance equation holds (Σtotal_debits = Σtotal_credits).
- **Discount journal (10% on 45,000 → VAT 17.5%):** DR debtors 47,587.50 =
  CR revenue-gross 45,000 + DR discount-allowed 4,500 + CR VAT 7,087.50 —
  **balanced**, and the trial balance shows the contra-revenue split
  (4110 CR 45,000 / 4130 DR 4,500). AR outstanding 47,587.50.

**VERIFIED FAIL / PARTIAL:**
- **P1 — silent discount fallback (`journalService.ts:243`):** if account
  4130 is missing, the `catch` rewrites the revenue line to **net** and
  drops the discount contra — the journal still balances but the P&L
  disclosure changes silently and any non-`getAccountByCode` error (DB
  failure, RLS) is swallowed and treated as "account missing". Evidence:
  code inspection (broad `catch {}` with rewrite).
- **P2 — no DB CHECK** on `invoice_lines.quantity >= 0` or
  `inventory_balances.quantity_on_hand >= 0`: hostile/API inserts of
  negative values succeed at the DB layer (Phase 10 test evidence). App UI
  validates, but RLS-scoped direct clients (or a future bug) can corrupt
  quantities.

## 8. Discount reconciliation

**Database layer: VERIFIED PASS** (journal balanced; trial balance shows
gross revenue + contra discount; AR outstanding correct; invoice + line
records carry `discount_amount`/`discount_percent`).

**UI + PDF layers: BLOCKED** — requires hosted-staging browser. The
repository's own `POST_REMEDIATION_VERIFICATION.md` records that
"reconciliation across invoice display → DB → PDF → reports → AI **not**
demonstrated". **This remains the single most important open item** (a real
customer reported the discount issue).

## 9. PDF integrity

**BLOCKED** (browser). Code-level: async builder with error propagation
exists (H-08 fix). Must be verified on hosted staging in Chrome + Safari,
including the download regression and value-vs-DB reconciliation.

## 10. Business workflow testing

**Database layer: VERIFIED PASS** (16/16 workflow assertions: register →
business → branch → member → customer → supplier → product → purchase →
sale → invoice → payment → expense → bank recon → payroll → reports →
audit → API). **Browser journeys: BLOCKED.**

## 11. Authentication

- Code: standard Supabase auth (persistSession, autoRefresh, detectSessionInUrl).
- **P0 incident evidence:** production blank page — root cause
  `src/lib/supabase.ts` module-scope throw when `VITE_SUPABASE_ANON_KEY`
  missing; production secret `VITE_SUPABASE_ANON_KEY_PROD` was absent.
- **PARTIAL:** expired-session/refresh/password-reset flows need browser
  verification (BLOCKED here).

## 12. Authorization

**VERIFIED PASS (DB):** role tiers enforced by RLS helpers
(`can_write_business_data` etc.) and verified. Frontend `usePermissions`
mirrors the helpers. **BLOCKED:** frontend-restriction-vs-API test on hosted
staging.

## 13–16. API / Edge Functions / Webhooks / Cron

- **API journal RPC:** balance-enforced, service-role-only — VERIFIED.
- **Webhooks:** HMAC signature code present; DB objects + secrets in
  migrations. Live delivery/retry/duplicate tests: **BLOCKED**.
- **Cron:** 3 jobs defined with placeholders, no secrets in migrations —
  VERIFIED (config); live run/idempotency: **BLOCKED** (won't trigger
  production jobs).

## 17. Storage

**VERIFIED PASS (DB):** 8/8 assertions — buckets public/private, business-
scoped upload (incl. the INSERT…RETURNING SELECT-policy requirement),
cross-tenant upload denied, anon denied, service-role export path.
**BLOCKED:** browser upload/download UX.

## 18–19. Payroll & Tax

**VERIFIED PASS (executed):** approved PAYE bands seeded (effective
2025-12-30, fiscal 2026/27); statutory cases 99,000 / 570,500 / 4,170,500
computed correctly; custom bands preserved; idempotent. VAT 17.5% confirmed
in code (but see P2 duplication finding).

## 20. Audit trail

**VERIFIED PASS (executed):** chain append + verify + **tamper detection**
(altering a row flags it invalid); immutability (no client INSERT/UPDATE/
DELETE on audit_log); role-gated read. Legacy-hash compatibility: UNKNOWN
(9.10 limitation).

## 21. AI integrity

**BLOCKED** (browser + provider key). Code review: context is built from
RLS-scoped queries; no write path to accounting data. Tenant-isolation of AI
output must be verified on hosted staging.

## 22. Error handling & recovery

**PARTIAL.** Good: error mapping, chunk recovery, Sentry, actionable PDF
errors. **P1/P2:** silent `catch {}` in journalService (see §7); no
build-time guard for missing required env (see §11); several other silent
catches (7+ counted).

## 23. Performance / UX sanity

**PARTIAL (static).** No obvious N+1 in the audited hot paths; reports use
views. Dashboard/report sizes not measured (BLOCKED for browser). No
pagination on some list queries observed (e.g. business_users team list) —
P3 note, not blocking.

## 24. Observability

**PARTIAL.** Sentry wired (frontend + edge, per-env DSNs), logger strips PII.
No alerts configured for critical failures (e.g. blank-page class of error)
— P3/P2 recommendation.

## 25. Backup & recovery

**BLOCKED / PARTIAL.** `backup-verify.yml` exists (restore-to-throwaway +
verify). **No successful restore evidence within the audit window.** RPO/RTO
not documented. Managed PITR status not verified.

## 26. Code quality

- `as any`/`as never`: 129 (legacy; masks type errors) — P3 cleanup.
- Hard-coded VAT 0.175 ×4 — P2.
- `catch {}` silent ×7+ — P2 (incl. the P1 journalService case).
- TODO/FIXME: 1. eslint-disable: 27 (artifacts). No `VITE_` service-role
  exposure (verified).

## 27. Regression testing

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ PASS |
| `npm run lint` | ✅ PASS (0 errors) |
| `npm run test` | ✅ PASS (230) |
| `npm run build` | ✅ PASS |
| `npm run db:validate*` | ⚠️ scripts do not exist (documented Phase 8 gap) |
| Browser tests | BLOCKED (none configured) |

## 28. Findings register

| ID | Sev | Title | Component | Evidence | Impact | Recommended fix |
|---|---|---|---|---|---|---|
| A-01 | **P0** | Missing prod env secret → blank page | deploy config / supabase.ts | Production incident 2026-08-16 (bundle threw "Missing Supabase environment variables") | Login unusable; total outage | Add build-time guard (fail CI if required `VITE_*` empty); secret audit checklist; canary check post-deploy |
| A-02 | **P1** | Silent discount-account fallback | journalService.ts:243 | Code: broad catch rewrites revenue line to net | P&L disclosure silently wrong if 4130 missing; masks DB errors | Narrow the catch (only not-found), log + surface, never silently change posting; backfill 4130 in seed |
| A-03 | **P2** | `invoices.amount_due` never set | invoices write paths | DB test: NULL → 0 in direct sum; AR view coalesces | Direct consumers/export get wrong balances | Maintain `amount_due` on insert/update (or document as computed-only and remove column) |
| A-04 | **P2** | No DB CHECK negative quantity/stock | invoice_lines, inventory_balances | DB test: negative accepted | Corrupt quantities via hostile client/API | Add CHECK (quantity >= 0; quantity_on_hand >= 0) migration |
| A-05 | **P2** | VAT hard-coded 0.175 ×4 | Income/Expenses/QuickExpense | grep | Rate change requires 4 edits; drift risk | Central constant from tax_configurations |
| A-06 | **P2** | Staging frontend deploy failing | Vercel staging project | Deploy history (16:17/15:54 failures at "Deploy frontend to Vercel (staging)") | Staging UI stale | Fix staging Vercel project link/name; rename `-prod`-named project |
| A-07 | **P3** | 129 `as any`/`as never` | repositories/services | grep | Masks type errors | Clean up post type-regeneration |
| A-08 | **P3** | No alert on catastrophic frontend errors | monitoring | none | Outage detection delayed | Sentry alert rule |
| A-09 | **BLOCKED** | Discount UI/PDF 5-layer reconciliation | browser | cannot execute | Customer-reported regression unverified | Hosted-staging journey C/D |
| A-10 | **BLOCKED** | PDF download regression (Chrome/Safari) | browser | cannot execute | Customer-reported | Hosted-staging journey D |
| A-11 | **BLOCKED** | UI tenant manipulation (URL/API) | browser | cannot execute | Isolation at UI unverified | Hosted-staging 9.5 |
| A-12 | **BLOCKED** | AI/offline/backup-restore evidence | browser/ops | cannot execute | unverified | Operator runs |

## 29. Remediation plan (ordered)

**P0:**
1. Add a **build-time env guard** (fail `npm run build` if
   `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` missing) + a post-deploy
   canary check (fetch login page, assert non-blank). (A-01)

**P1:**
2. Fix journalService discount fallback: only fall back on
   account-not-found; log loudly; never silently rewrite; add regression
   test for both paths. (A-02)

**P2:**
3. Add DB CHECK constraints (negative quantity/stock) — migration + tests.
   (A-04)
4. Decide & implement `amount_due` maintenance (or deprecate). (A-03)
5. Centralise VAT rate; keep 17.5 default. (A-05)
6. Fix staging Vercel deploy; rename staging project to `ledgr-react-staging`.
   (A-06)

**P3:** `as any` cleanup; Sentry alert. (A-07/08)

**BLOCKED (operator):** run hosted-staging browser journeys A–M (discount +
PDF mandatory), backup-restore run, AI/offline verification.

## 30. Final certification

## 🟡 YELLOW — CONDITIONALLY READY; SPECIFIC ITEMS MUST BE CLOSED

**Rationale:**
- **Not GREEN:** A-02 (P1 silent accounting fallback) is open; A-01 root
  cause is fixed but **unguarded** (recurrence possible); the customer-
  reported discount/PDF regressions are unverified (BLOCKED); browser
  journeys incomplete.
- **Not RED:** the database layer is verified — no cross-tenant access
  (41/41), journals balance (incl. discounted invoice), migrations replay,
  concurrency-safe numbering, approved PAYE correct, storage scoped. The P0
  incident is remediated (production deploy green).

**To reach GREEN:**
1. Close A-01 (build-time guard + canary) and A-02 (fallback fix + test).
2. Close A-03/A-04/A-05 (DB CHECKs, amount_due, VAT constant).
3. Operator: run the hosted-staging browser journeys (discount 5-layer +
   PDF download regressions mandatory), UI tenant matrix, AI, offline, and
   one backup-restore verification.

**Do not release to production until A-01 and A-02 are closed and the
browser regressions pass.**
