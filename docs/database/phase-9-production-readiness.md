# Phase 9.11 — Production Readiness Checklist

Statuses: **PASS** (evidence complete) · **PARTIAL** (evidence strong at one
layer, another layer pending) · **BLOCKED** (cannot be executed in the
current environment — the sandbox has no browser and no Supabase network
access; the browser journeys are specified in
`phase-9-browser-test-script.md` and must be run against hosted staging) ·
**NOT APPLICABLE** · **FAIL**. No item is marked PASS without evidence.

| # | Area | Status | Evidence / blocker |
|---|---|---|---|
| 1 | **Environment isolation** | **PASS** | Staging project `bkxzgkurcqvccsdjmqzg` is distinct from production `hsuhuvuxfuufrlejsatw` (verified live in Phase 8A.1 capture run; isolation guard passed; deploy pipeline green on the dedicated staging project). |
| 2 | **Database reproducibility** | **PASS** | 8A.1: live staging == fresh replay 1:1 (65/65 tables, 16/16 enums, 195/195 FKs, 11/11 triggers, 3/3 cron). 8B: 61/61 migrations replay clean; 93/93 assertions. |
| 3 | **Reference data** | **PASS** | PAYE bands [VERIFIED] + **approved** + migration created and **applied to staging** (green deploy 2026-08-16). VAT 17.5% and pension 10/5 confirmed already implemented. |
| 4 | **Authentication** | **PARTIAL** | Supabase auth configured (signUp/session flows in code; RegisterPage tested at DB layer). Browser registration (Journey A) pending. |
| 5 | **Business onboarding** | **PARTIAL** | `create_business_with_owner` + COA + owner membership verified end-to-end at DB layer (8B.1, 8B.5). Browser onboarding (Journey A) pending. |
| 6 | **Roles/permissions** | **PASS** (DB) / **BLOCKED** (UI) | Role model + RLS tiering verified (8B.3: 41/41 incl. role denials). UI role gating (Journey B) pending browser run. |
| 7 | **Tenant isolation** | **PASS** (DB) / **BLOCKED** (UI) | No cross-tenant read/insert/update/delete at DB layer (8B.3 matrix). UI/API manipulation tests (9.5) pending browser run. |
| 8 | **Sales** | **PARTIAL** | Invoice/payment/journal/COGS verified at DB layer (8B.5–6, incl. debits=credits). Discount UI/PDF/customer-balance reconciliation (regression #1) pending browser run. |
| 9 | **Purchases** | **PARTIAL** | Stock receipt + journal verified at DB layer. UI pending. |
| 10 | **Inventory** | **PARTIAL** | Quantity identity + reorder alerts verified at DB layer. UI pending. |
| 11 | **Expenses** | **PARTIAL** | Expense + payment + balanced journal verified at DB layer. UI pending. |
| 12 | **Payroll** | **PARTIAL** | PAYE reference data approved + applied to staging; DB-layer PAYE cases verified (99,000 / 570,500 / 4,170,500). Browser payroll run (Journey H) pending. |
| 13 | **Bank reconciliation** | **PARTIAL** | Statement/lines/lock-guard verified at DB layer. UI matching flow pending. |
| 14 | **Financial reporting** | **PARTIAL** | Trial balance equation + 4 views verified at DB layer (8B.2, 8B.6). Report UI + PDF cross-reconciliation (Journey I) pending. |
| 15 | **PDFs** | **PARTIAL** | Async builder + error propagation verified in code (H-08 fix present; `documentGenerator.ts` reviewed). Browser generate/download/open incl. Chrome+Safari (regression #2) pending. |
| 16 | **Storage** | **PARTIAL** | Buckets + business-scoped policies verified at DB layer (8B.4: 8/8). Browser logo upload / export download (Journey J) pending. |
| 17 | **AI Insights** | **BLOCKED** | Requires hosted staging browser + edge function + provider key. DB scoping inputs verified via code review (business context from business-scoped queries). |
| 18 | **API** | **PARTIAL** | Rate-limit + journal RPCs verified at DB layer (8B.5). Live endpoint auth/signing test (Journey L) pending. |
| 19 | **Webhooks** | **PARTIAL** | DB objects + signature infra in migrations (20260727000001/20260730000002). Live delivery/retry test pending. |
| 20 | **Offline functionality** | **NOT APPLICABLE / BLOCKED** | Offline layer exists (`src/offline/*`, Dexie). Browser network-off tests (Journey M) pending; per-workflow support must be recorded, not assumed. |
| 21 | **Audit trail** | **PASS** | Chain append + verification + **tamper detection** + immutability (no client write) + role-gated read verified (8B.1, 8B.3). Legacy hash compatibility: documented limitation (9.10). |
| 22 | **Monitoring** | **PARTIAL** | Sentry wired (deploy.yml DSNs per env), edge function logs available; live error-stream check + no-sensitive-data-in-logs check pending. |
| 23 | **Backup/recovery** | **PARTIAL** | `backup-verify.yml` restores the latest dump into a throwaway DB; staging restores not recently executed — schedule a verification run. |
| 24 | **Known defects** | **PARTIAL** | Discount (regression #1) and PDF download (regression #2) fixes are present in code; **browser verification on hosted staging is mandatory before Phase 9 can complete** (9.7). |
| 25 | **Risk assessment** | **PASS** | Full register in `phase-9-final-report.md` §Remaining risks. |

## Summary

- **PASS:** 3 (isolation, reproducibility, audit trail) + risk assessment.
- **PARTIAL:** 11 (all DB-layer-verified; browser layer pending).
- **BLOCKED:** 3 (payroll reference data, AI Insights, offline until browser
  run; UI-level security).
- **NOT APPLICABLE:** 0 standalone (offline is N/A/BLOCKED until tested).
- **FAIL:** none discovered to date.

**Gate:** the PARTIAL/BLOCKED items above are exactly the Phase 9 browser
journeys in `phase-9-browser-test-script.md` + the PAYE reference-data
approval (9.2). None can be silently converted to PASS.
