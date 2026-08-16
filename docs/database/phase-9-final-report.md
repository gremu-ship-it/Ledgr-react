# Phase 9 Final Report — Production Readiness & Controlled Validation

**Date:** 2026-08-15
**Branch/PR:** `arena/phase-9-certification`
**Final recommendation:** 🟡 **YELLOW — NOT YET READY; SPECIFIC REMEDIATIONS
REQUIRED** (none are code defects — all are executable validation steps +
one approval).

---

## 1. Executive summary

Phase 9 verified everything verifiable from the repository + database
evidence, and produced an **executable hosted-staging browser test script**
for the remainder. Key results:

- **Reference data:** the applicable Malawi PAYE bands were researched from
  authoritative sources (MCCCI quoting the MRA statement, effective
  30 Dec 2025), classified **[VERIFIED]**, **approved by the stakeholder on
  2026-08-15**, and delivered as `20260816000000_phase9_paye_reference_data.sql`
  (10/10 reference tests pass). **A model finding was resolved before
  creation:** Ledgr stores ANNUAL bands, so the migration seeds annual
  equivalents of the gazetted monthly bands; the app's stale fallback bands
  were updated to the same approved structure (previously a latent defect).
  Related statutory values already implemented correctly: **VAT 17.5%** and
  **pension 5%/10%**.
- **Exact type regeneration:** analysis complete; the regeneration command
  is specified but **must run on a networked machine** (sandbox has no
  Supabase network access). All 10 supplement entries will become obsolete
  and are scheduled for deletion.
- **Browser journeys (A–M):** cannot be executed from this sandbox (no
  browser, no hosted-staging network). The full script with expected results
  is delivered; **it must be run against hosted staging before release**.
- **Defects discovered:** none new at the database layer. Two previously
  reported customer-facing issues (discount display, PDF download) have
  code-level fixes present; both require the mandatory browser regression
  run.

## 2. Phase 8 carry-forward issues

| # | Carry-forward | Status in Phase 9 |
|---|---|---|
| 1 | Malawi PAYE reference data | Researched, [VERIFIED] values identified; migration pending approval (9.2) |
| 2 | Legacy audit hash compatibility | Documented limitation (9.10); fresh chains verified |
| 3 | Ageing/reorder inferred semantics | Cosmetic; documented in 8B.2 |
| 4 | Legacy storage restrictions (size/MIME) | No evidence; buckets functional without limits |
| 5 | Hosted-staging browser/UI validation | **The Phase 9 deliverable** — script provided, execution required |

## 3. Reference data verification — ✅ APPROVED + migration created

- **PAYE bands [VERIFIED]** (effective 30 Dec 2025, current for 2026/27):
  0% ≤ 170,000 · 30% 170,000.01–1,570,000 · 35% 1,570,000.01–10,000,000 ·
  40% > 10,000,000. Five sources agree incl. MCCCI/MRA statement; one
  outlier rejected. **Approved by stakeholder 2026-08-15.**
- **Migration** `20260816000000_phase9_paye_reference_data.sql` created —
  annual equivalents per Ledgr's model; idempotent; preserves custom bands;
  sanity guard. **10/10 reference tests pass** (seeding, preservation,
  idempotency, 5 statutory PAYE cases incl. 99,000 / 570,500 / 4,170,500).
  **Applied to staging on the 2026-08-16 green deploy.**
- **App fallback bands updated** (`FALLBACK_PAYE_BANDS` in `paye.ts`) to the
  approved structure + 12 unit tests — fixes a latent defect (obsolete
  pre-2026 rates for businesses without DB bands).
- **VAT 17.5%** — [VERIFIED] and confirmed implemented in code.
- **Pension 5%/10%** — [VERIFIED] and implemented (`tpr_pension` seed).
- **Model note (documented, not changed):** PAYE is computed on gross;
  pension is NOT deducted pre-PAYE (the MRA framework permits it). Flagged
  for the release review.
- **Not modelled (documented limitations, NOT inserted):** TEVETA 1% levy,
  0.05% bank-transfer levy.
- Full governance: `phase-9-reference-data.md`.

## 4. Hosted staging verification — PARTIAL

- Isolation guard: **PASS** (staging ref `bkxzgkurcqvccsdjmqzg` ≠ production
  `hsuhuvuxfuufrlejsatw`; verified in live capture runs).
- Deploy pipeline on the dedicated staging project: **PASS** (all 61
  migrations applied).
- Live checklist (anon key, service-role key, auth config, storage, edge
  functions, cron, webhook secrets, provider sandbox creds, Sentry, allowed
  origins, APP_URL, no production pointers): the wiring is present in
  `deploy.yml` (SB_ENV=staging, ALLOWED_ORIGINS_STAGING, APP_URL_STAGING,
  CRON_SECRET_STAGING, per-env Sentry DSNs); **live confirmation of each
  value must be recorded by the operator** during the browser run (steps in
  `phase-9-browser-test-script.md`).

## 5. Browser workflow results — BLOCKED (script delivered)

All journeys A–M are specified with step-by-step expected results in
`docs/database/phase-9-browser-test-script.md`. Execution requires the
staging frontend in a real browser (Chrome + Safari). **Nothing in this
section is marked PASS without that run.**

## 6. Security results

- Database layer: **PASS** — 41/41 RLS assertions; no cross-tenant
  read/insert/update/delete; anonymous denied; audit immutable; role
  tiering per the repo's own model; storage business-scoped.
- UI/API layer (manipulated URLs, payloads, ids): **BLOCKED** pending the
  browser/API manipulation tests (9.5) in the test script.

## 7. Accounting reconciliation — PASS (database layer)

- Every transaction type balances (debits = credits); trial balance
  4400 = 4400; tolerance ≤ 0.005 matching the app's validator. Details:
  `phase-8b-workflow-accounting.md`.

## 8. PDF results — PARTIAL

- Code evidence: async builder with error propagation (H-08 fix),
  `DocumentDownloadButton` surfaces errors. Browser generate/download/open
  incl. Chrome + Safari and the **download regression** is a mandatory
  pending item (Journey D).

## 9. Storage results — PARTIAL

- Database layer PASS (8/8). Browser logo upload/replace/delete + export
  signed download + cross-tenant path tests pending (Journey J).

## 10. AI results — BLOCKED

Requires hosted staging + provider key. Code review: context comes from
business-scoped queries; no write path to accounting data. Browser
verification pending (Journey K).

## 11. API/webhook results — PARTIAL

Rate-limit + journal RPCs verified at DB layer (incl. balance enforcement).
Live signing/delivery/signature/duplicate tests pending (Journey L).

## 12. Offline results — NOT APPLICABLE / BLOCKED

Offline layer exists (`src/offline/*`); per-workflow support must be
established by the browser network-off tests (Journey M) and recorded
explicitly.

## 13. Performance/stability results — BLOCKED

Console errors, failed requests, infinite loading, race conditions, timeout
behaviour must be observed during the browser run (9.8 checklist is embedded
in the test script). No destructive load testing against production.

## 14. Regression results — PARTIAL (code-level PASS, browser pending)

Historical defects surfaced from repository docs
(`POST_REMEDIATION_VERIFICATION.md`, `REMEDIATION_REPORT.md`):

| Known issue | Code-level status | Browser regression (mandatory) |
|---|---|---|
| Discount not appearing correctly on invoice (#1) | Fixes present (PRs #84/#86: `discount_amount`/`discount_percent` on invoice_lines/expenses; accounts 4260/5175) | Journey C step 4 — all five layers must agree (UI/DB/PDF/journal/customer balance) |
| PDF downloads failing (#2 / H-08) | Async builder + error banners present | Journey D — Chrome + Safari, incl. actionable error on failure |
| RLS on unprotected tables | Fixed + pinned by test (8A/8B) | Covered by 8B.3 suite |
| increment_amount_paid backout (C-02) | Fixed (20260813000001 + 8B tests) | Covered |
| Payments on cancelled documents (C-03) | Fixed (20260813000002) | Covered |
| "Business not found" on quick expense | Fixed (reserve_next_document_number) | Covered by 8B.1 tests |

## 15. Defect register

| ID | Severity | Description | Status |
|---|---|---|---|
| P9-001 | P3 | TEVETA 1% employer levy not modelled in payroll schema | Documented limitation; enhancement request |
| P9-002 | P3 | 0.05% bank-transfer levy not modelled | Documented limitation; enhancement request |
| P9-003 | P4 | `database.generated.ts` still reflects pre-8B state | Fix in progress (9.1 — regeneration required) |
| P9-004 | P3 (fixed) | `FALLBACK_PAYE_BANDS` in `paye.ts` held the obsolete pre-2026 structure (businesses without DB bands would under/over-withhold) | **Fixed 2026-08-15** — updated to the approved structure; 12 unit tests pin it |
| P9-005 | P3 (documented) | Ledgr computes PAYE on gross (pension not pre-PAYE-deducted) | Documented model note; release-review item (not a reference-data defect) |
| P9-006 | P1 (fixed) | 8B.1 migration failed on staging: unqualified pgcrypto `digest()`/`gen_random_bytes()` (extensions schema) | **Fixed (PR #98)** — schema-qualified; staging deploy green 2026-08-16 |
| (none) | P0/P1 | No P0/P1 defects discovered to date | — |

## 16. Remaining UNKNOWNs

| ID | Item | Blocker |
|---|---|---|
| U-01 | Browser journeys A–M results (incl. discount + PDF regressions) | Requires hosted-staging browser run |
| U-02 | PAYE reference-data migration approval | Requires human approval of researched values |
| U-03 | Legacy audit hash compatibility | Requires separately authorized 1–3-row production capture (9.10) |
| U-04 | Live monitoring/backup evidence (Sentry stream, backup-verify run) | Requires operator execution |

## 17. Production readiness checklist

See `docs/database/phase-9-production-readiness.md` — 25 items:
**3 PASS, 11 PARTIAL, 3 BLOCKED, 0 FAIL** (+ audit/risk items).

## 18. 9.10 — Legacy audit hash (limitation, no production access taken)

The reconstructed chain (`audit_chain_hash`) is self-consistent and verified
on fresh databases. Whether it matches the legacy database's historical
entries is **unknown** and **production was not touched**. If separately
authorized, capture exactly 1–3 rows (read-only) to compare:

```sql
-- AUTHORIZED USE ONLY — production, read-only, minimal sample
select id, business_id, occurred_at, event_type, resource_type, resource_id,
       prev_hash, entry_hash
from public.audit_log
order by id
limit 3;
```

If the algorithm differs, add a verification shim rather than rewriting
history. Fresh chains remain verified regardless.

## 19. Final recommendation

## 🟡 YELLOW — NOT YET READY; SPECIFIC REMEDIATIONS REQUIRED

**Required before GREEN (in order):**
1. ✅ **PAYE reference data approved + migration created and tested**
   (`20260816000000_phase9_paye_reference_data.sql`, 10/10 tests) **and
   applied to staging** — the 2026-08-16 deploy (after the pgcrypto-schema
   fix, PR #98) is fully green: all 62 migrations applied via
   `Link & migrate staging database`, edge functions deployed, frontend on
   Vercel. Remaining: run Journey H (payroll) in the browser.
2. **Run the hosted-staging browser test script** (`phase-9-browser-test-
   script.md`, journeys A–M) with fake data; record results; resolve any
   P0/P1 findings. The discount and PDF regressions are mandatory items.
3. **Regenerate exact types from staging** (command in
   `phase-9-type-regeneration.md`), delete the obsolete supplement, and run
   typecheck/lint/test/build.
4. **Verify observability + backups on staging** (Sentry stream, one
   `backup-verify.yml` run) and record no sensitive data in logs.
5. **Rotate the staging DB password** (it appeared in earlier chat) and
   confirm production isolation once more.

**Why not RED:** no P0/P1 defect exists; DB-layer security, accounting
integrity, auditability and reproducibility are all verified; the blockers
are executable validation steps and one approval, not known failures.

**Why not GREEN:** the certification rules require hosted-staging browser
validation, approved reference data, exact type regeneration and the two
customer-reported regressions to pass — none of which can be honestly marked
PASS from this environment.
