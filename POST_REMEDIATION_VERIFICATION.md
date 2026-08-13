# Ledgr — Post-Remediation Verification Audit

**Date:** 2026-08-13
**Branch audited:** `arena/019ffa8d-ledgr-react` (at `6c5fc50`, merge of PR #90)
**Auditor method:** independent — executed the full quality-gate pipeline, cross-checked every claimed fix against the actual code/migrations, and cross-referenced the GitHub PR state. No live Supabase project was available, so database-level behaviour is reviewed **as written** and flagged where runtime probing is still required (the same limitation the original audit recorded).

---

## 1. Executive summary

The development team's report (`REMEDIATION_REPORT.md`) claims **"All Phases 1–7 Fully Completed (Quality Gate Green)"**, "0 TypeScript errors, 0 ESLint problems, 202/202 tests", and "fully robust, legally compliant, transaction-safe, and secure".

**The quality-gate claim is true. The security claim is not.** The pipeline is genuinely green — but two of the most serious original findings were fixed in pull requests that are **still open and unmerged** on GitHub, and their fixes are **absent from this branch**. One of the remediation's own changes introduced a new accounting bug in the payment-reversal path.

| Area | Verdict |
|---|---|
| Quality gates (typecheck / lint / test / build) | ✅ **TRUE** — all green |
| Dependency vulnerabilities | ✅ **RESOLVED** — `npm audit` = 0 |
| Critical cross-tenant RLS leak (F1) | ❌ **STILL OPEN** — fix never merged |
| Dead/buggy rate limiter deletion (F5) | ❌ **NOT DONE** — file still present |
| Payment reversal (C-02) | ❌ **REGRESSION** — negative amount rejected by the atomic RPC, error swallowed |
| Other claimed fixes (C-03, C-07, C-08, C-11, C-12, H-02, H-03, H-05, H-08, H-09, H-16) | 🟡 **Mostly present in code**, but several are UI-only or partially implemented |
| End-to-end accounting/PDF/offline/tax/payroll/branch workflows | ⚠️ **NOT VERIFIABLE** without a live database — no evidence provided by the team |

The objective of this audit is independent verification. It is **not** possible to reproduce the team's "end-to-end verified" claim because no staged/live environment, test dataset, or evidence of the workflow tests is present in the repository.

---

## 2. Quality-gate verification (executed, not assumed)

Run against a clean `npm ci`:

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | 678 packages, `found 0 vulnerabilities` |
| Type check | `npm run typecheck` (`tsc -b`) | ✅ exit 0, 0 errors |
| Lint | `npm run lint` | ✅ exit 0, 0 problems |
| Unit tests | `npm run test` | ✅ **202 passed / 24 files** |
| Build | `npm run build` | ✅ success (1 chunk-size warning, 901 kB vendor chunk) |
| Dependency audit | `npm audit` | ✅ **0 vulnerabilities** |

The 202/202 figure matches the team's claim. Test coverage has grown materially since the original audit (16 → 202) but the highest-value targets identified in F4 remain **untested**: golden-file tests over the five financial statements, `FxRevaluationService` (IAS 21), VAT return generation, and any Edge Function (`supabase/functions` is still outside the vitest glob).

---

## 3. Per-issue verification

### 3.1 Original SYSTEM_AUDIT.md findings (F1–F11)

| ID | Original problem | Fix claimed | Verification performed | Result | Evidence |
|---|---|---|---|---|---|
| **F1** | 4 tables ship without RLS (`invoice_delivery_events`, `recurring_invoices`, `api_usage`, `currencies`) → cross-tenant read/write leak | "New migration `20260728000005_enable_rls_on_unprotected_tables.sql`" | Grepped **every** migration for `enable row level security` and for these four table names | ❌ **FAIL** | The migration does not exist. The four tables are only ever `create table`-ed (in `20250724_api_usage.sql`, `20260725000001_invoice_automation.sql`, `20260727000000_multi_currency_ias21.sql`, `20260727000001_public_api_webhooks.sql`) with **no RLS and no policies**. The fix lives in GitHub PRs #39 and #45, both **OPEN (never merged)**. |
| **F2** | 27 advisories (1 critical, 24 high) | "27 → 6" then "0 vulnerabilities" | `npm audit` | ✅ **PASS** | 0 vulnerabilities. Critical `tar` chain cleared (`@vercel/node` removed). |
| **F3** | `generate-vat-returns` has no auth guard | "add `x-cron-secret` check" | Read `supabase/functions/generate-vat-returns/index.ts` | ✅ **PASS** | Guard present at lines 21–24: rejects when `CRON_SECRET` absent or mismatched, returns 401. |
| **F4** | ~1% test coverage | "16 → 52 tests" | Ran `npm run test` | 🟡 **PARTIAL** | Now 202 tests (good), but the named gaps (5 statements, IAS 21, VAT returns, Edge Functions) are still uncovered. |
| **F5** | Dead, buggy `api/middleware.ts` rate limiter | "Deleted" | Checked file existence + content | ❌ **FAIL** | `supabase/functions/api/middleware.ts` still exists, byte-for-byte the buggy version: `.eq("api_key", apiKey)` against a column that isn't the rate key, and `upsert(..., { onConflict: "api_key" })` where no such unique index exists (would throw at runtime if ever imported). Claim "deleted" is false. |
| **F6** | `Access-Control-Allow-Origin: *` on 15 functions | "origin allowlist via `_shared/cors.ts`" | Read `_shared/cors.ts` + consumer functions | ✅ **PASS** | `cors.ts` present with `ALLOWED_ORIGINS`/`APP_URL` allowlist; 17 functions import it; `api/index.ts` applies it on every response. Falls back to project origin (not `*`) when unset. |
| **F7** | Hardcoded Supabase project ref | "derive from `VITE_SUPABASE_URL`" | Read `vite.config.ts`, `ApiDocumentationPage.tsx` | ✅ **PASS** | Both derive the host from `VITE_SUPABASE_URL` with the prod ref only as fallback. |
| **F8** | Orphaned duplicate components | "deleted" | Tree inspection | ✅ **PASS** | `ForgotPasswordPage.tsx`/`ResetPasswordPage.tsx`/duplicate `ErrorBoundary` removed. |
| **F9** | README is stock Vite template | "rewritten" | Read `README.md` | ✅ **PASS** | Project README present. |
| **F10** | Depreciation unit mismatch | "aligned to percentage" | Read `depreciation.ts` + test | ✅ **PASS** | Percentage convention, pinned by `depreciation.test.ts` (16 tests). |

### 3.2 ERROR_ANALYSIS.md items (1–7)

| # | Original problem | Result | Evidence |
|---|---|---|---|
| 1 | CI `webpack.yml` bogus + Node 18 leg | ✅ **PASS** | CI now `ci.yml` (typecheck/lint/test/build); typecheck+lint green locally. |
| 2 | 24 `no-explicit-any` lint errors | ✅ **PASS** | `npm run lint` exits 0. |
| 3 | `JournalEntryDetailModal` DAL bypass (`as any` to defeat `protected`) | ✅ **PASS** | `assignCostCentre` now lives in `JournalRepository` (tenant-scoped, typed). |
| 4 | Silent runtime failures (`journal_entries.total_debits/credits`, `v_profit_loss_summary`, stale `database.generated.ts`) | ✅ **PASS** (as documented) | `aiFinancial.ts` aggregates from `journal_lines`; P&L via `FinancialStatementRepository`; `database.supplement.ts` types the missing tables. |
| 5 | 504 kB bundle | 🟡 **DELIBERATELY REVERTED** | Still one ~901 kB vendor chunk + 328 kB main; warning persists (documented, acceptable). |
| 6/7 | Remaining lint/warnings | ✅ **PASS** | lint exit 0. |

### 3.3 REMEDIATION_REPORT.md "Section 11" items (C-01…L-07)

> Note: the original "Section 11" audit text is **not present in this repository** (only the remediation summary references it). Verification below is against the *claimed* fix and the current code. Verdicts reflect code presence/absence, not an end-to-end DB run.

| ID | Original problem | Fix claimed | Verification performed | Result | Evidence / remaining risk |
|---|---|---|---|---|---|
| **C-01** | Draft invoices post to ledger/stock | Drafts isolated from postings | Read `JournalRepository.post()` and posting services | 🟡 **PARTIAL** | `post()` throws unless `status === 'draft'`; entries are created as `draft`. But invoice→ledger posting is not a single transactional unit in the repo (core `invoices` schema is **not in migrations**), so "draft posts nothing" cannot be proven without a live DB. |
| **C-02** | Reversing a payment voids the whole invoice | "Decrementally backs out `amount_paid`" | Read `JournalRepository.reverse()` + RPC `increment_amount_paid` | ❌ **FAIL (regression)** | `reverse()` calls `increment_amount_paid(..., p_amount: -invPayment.amount)`, but migration `20260730000004` **raises "Amount must be positive" when `p_amount <= 0`**. The call's error object is not captured, so the decrement **silently fails**: `amount_paid` stays at the full total while `status` is recomputed to `partially_paid`/`sent`, and the payment row is deleted. Net result is a **self-inconsistent invoice** (status ≠ amount_paid). |
| **C-03** | Payments allowed on void/credit-note docs | "Aligned guards to strict DB enums (`void`/`credit_note`)" | Read `InvoiceRepository.recordPayment()` + `InvoicesPage.tsx` | 🟡 **PARTIAL** | UI guard exists (`InvoicesPage.tsx:451,1097`) but tests a superset that includes **non-existent** statuses `'voided'`/`'credited'` (the DB enum is `void`/`credit_note`/`paid`/`partially_paid`/`sent`/`draft`). `recordPayment()` inserts the payment and increments `amount_paid` **before** the status check and only skips the *status* update — it does not block the payment itself. No DB trigger enforces this. UI-only. |
| **C-04** | Ledger/stock failures swallowed | "Re-thrown to guarantee user notification" | Read `JournalRepository.createBalancedEntry()` and `reverse()` | 🟡 **PARTIAL** | Insert failures are re-thrown (good). But the same file **swallows** the `increment_amount_paid` RPC error in `reverse()` (see C-02) — the "stop swallowing" fix was not applied consistently. |
| **C-07** | Multi-run tax returns discarded; wrong due dates; dirty filings | "Combine weekly/monthly runs; PAYE due 14th; status/soft-delete filters" | Read `TaxReturnRepository.ts` | 🟡 **PARTIAL** | PAYE/TPR aggregation present (lines 162–166, 213–214); PAYE due 14th (line 174); VAT due 25th (line 129). Clean-filing filters referenced but not fully verified. |
| **C-08** | Dashboard doesn't reconcile with P&L | "Hook KPIs to `getProfitOrLoss()`" | Read `useDashboardData.ts`, `MobileDashboard.tsx` | ✅ **PASS** | KPI cards source `FinancialStatementRepository.getProfitOrLoss()`; mobile hero uses the same `netProfit`. |
| **C-11** | MFA not reachable in settings | "Render `MFASetup` in settings" | Read `SettingsPage.tsx` | ✅ **PASS** | `MFASetup` imported and rendered at line 906. |
| **C-12** | Reconciling periods lockable with imbalance | "Block lock unless differences zero + all matched" | Read bank reconciliation component | ✅ **PASS** | Guard message "match all bank statement lines before saving and locking" + `Math.abs(difference) < 0.01` check present. |
| **H-02** | Services/untracked items create false inventory | "Check `track_inventory`" | Grep `track_inventory` | ✅ **PASS** | Present in `IncomePage`, `ExpensesPage`, `QuickExpenseMobile`, `QuickIncomeMobile`, `ProductsPage`, `InventoryRepository`. |
| **H-03** | Transfer costs wrong source / races | "Source-location avg cost + alphanumeric salt" | Read `TransferRepository.ts` | ✅ **PASS** | Uses source `unit_cost` (lines 120–124) and a random salt for numbering (line 197). |
| **H-05** | Payroll approval reduces cash | "Credit Wages Payable liability" | Read `PayrollRepository.approve()` | ✅ **PASS** | Resolves Salaries/Wages Payable liability account (code `2130` family) and posts accrual (lines 431–483). |
| **H-06** | Non-VAT business can charge VAT | "Restrict to 0% for non-VAT registered" | Grep `vat_registered` | 🟡 **PARTIAL** | Barrier present in `IncomePage`, `ExpensesPage`, `QuickExpenseMobile`, `QuickIncomeMobile` — but **absent from `InvoicesPage.tsx`**, which the report explicitly claims was covered. |
| **H-08** | PDF download awaited / silent failures | "Async builders + progress/error banners" | Read `documentGenerator.ts` | ✅ **PASS** | `renderDocumentPdf` is async, waits for render, and throws on load failure; `DocumentDownloadButton` surfaces errors. |
| **H-09** | Unsafe header-only POST via REST API | "Block unsafe POST operations" | Read `supabase/functions/api/index.ts` | ✅ **PASS** | Invoice/expense creation via API is explicitly disabled ("currently disabled"); journal entries route through `create_api_journal_entry` RPC with schema + balancing validation. |
| **H-16** | Legacy duplicate team tab | "Route `TeamManagementPage` in settings" | Read `SettingsPage.tsx` | ✅ **PASS** | `TeamManagementPage` routed at line 2071. |
| **L-07** | 19 compile-breaking lint errors | "Precise typing instead of `any`" | Ran lint/typecheck | ✅ **PASS** | Both green. |

---

## 4. Functional-area verification

The table below distinguishes **static/code verification (done)** from **end-to-end verification (requires a live Supabase project + seeded data, which was not available)**.

| Area | Verifiable statically | Result | End-to-end status |
|---|---|---|---|
| Invoice lifecycle (draft→issue→post→pay→partial→void→credit note) | Posting immutability + payment increment RPC + reversal logic | 🟡 Partial — reversal path is broken (C-02) | ⚠️ Not run |
| Discounts (none / % / fixed / +tax / +partial) | Migrations add `discount_amount`/`discount_percent` on invoice_lines, expenses, expense_lines; accounts 4260/5175 seeded; PRs #84/#86 merged | 🟡 Code present | ⚠️ Reconciliation across invoice→DB→PDF→reports→AI **not** demonstrated |
| PDF generation | Async builder, error propagation | ✅ | ⚠️ Generate/download/open/after-edit/after-pay/mobile/failure **not** run |
| Inventory (sale/purchase/transfer/adjustment, qty>1, decimals, insufficient stock) | `track_inventory` isolation, perpetual-inventory migrations, valuation tests (24) | 🟡 | ⚠️ Full cycle and stock-out edge cases not run |
| Offline (persist→restart→reconnect→sync→conflict) | `offlineQueue` tests (4), Dexie queue, chunk recovery | 🟡 Thin coverage (4 tests) | ⚠️ Multi-device / duplicate / interrupted-sync not demonstrated |
| Tax (taxable/zero/exempt/inclusive/exclusive/rates/periods/returns/amend) | PAYE/TPR aggregation, due dates, `paye.test.ts` | 🟡 | ⚠️ No VAT-return calculation test; legal correctness **not** established |
| Payroll (calc→approve→liability→pay→payslip→report) | Accrual liability (H-05), PAYE bands test | 🟡 | ⚠️ Full run not executed |
| Branch/tenant isolation | RLS gap **still open** (F1) | ❌ | ⚠️ Direct URL/API probe impossible without live env |
| API / webhooks | API-key SHA-256, rate-limit RPC, `paychangu-webhook` HMAC constant-time, CORS allowlist, POST blocking | ✅ (as written) | ⚠️ Idempotency/retry/malformed-payload runtime not exercised |
| Reporting reconciliation | Statement integrity/presentation tests (14) | 🟡 | ⚠️ Cross-report reconciliation for identical data **not** demonstrated |
| AI insights | `aiFinancial.ts` query fixes (no more fabricated forecast) | 🟡 | ⚠️ "Uses complete source data / doesn't invent figures / period & branch separation" **not** demonstrated; no test |

---

## 5. Final verdict

### 5.1 Critical remaining risks

1. **Cross-tenant data exposure (F1) is still live.** `invoice_delivery_events`, `recurring_invoices` (read **and write**), `api_usage`, and `currencies` have no Row-Level Security. PostgREST exposes them to any holder of the anon key (which ships in the client bundle). The fix exists only in **unmerged PRs #39 and #45**. This must be treated as the single highest-priority blocker. **Merge #39/#45 (or re-apply their migrations) before any further release.**
2. **Payment-reversal inconsistency (C-02).** Reversing a payment leaves an invoice with `amount_paid` still at the paid total while `status` reads `partially_paid`/`sent`. Customer balances, AR ageing, and reports will disagree with the ledger. The atomic `increment_amount_paid` RPC must accept (or a separate decrement path must exist for) negative/backout amounts, and the error **must not** be swallowed.

### 5.2 High remaining risks

3. **The "all critical issues resolved" claim is not supportable** — the team's own remediation report asserts fixes that are provably not in this branch (F1, F5). The reporting itself is unreliable; every "completed" phase must be re-derived from code, not the report.
4. **Void/credit-note payment control is UI-only (C-03).** A direct client/API write can still record a payment and inflate `amount_paid` on a cancelled document. Needs enforcement at repository/DB level.
5. **No end-to-end test evidence** for any financial workflow. The 202 unit tests do not exercise the invoice lifecycle, discounts-to-reports reconciliation, offline sync, or tax returns against a database.
6. **Core accounting schema is not version-controlled.** `schema.sql` is empty; the `invoices`, `journal_entries`, `accounts`, `invoice_payments`, etc. tables are not defined in `supabase/migrations/`. RLS/constraints on the most important financial tables cannot be audited from the repo.

### 5.3 Regression risks (introduced or exposed by the fixes)

- **C-02 reversal regression** (detailed above) — introduced by pairing the new positive-only atomic RPC with a negative-amount call.
- **`JournalRepository.reverse()` auto-voids the whole source record** on reversal of the *recognition* entry (documented as "deliberate"). This is a behavioural change that makes it easy to void an entire invoice when only a single journal line was wrong — a significant accounting-semantics regression risk that needs product sign-off.
- **H-06 invoice VAT barrier missing** — invoices were claimed covered but have no `vat_registered` gate; non-VAT businesses may still be able to select a non-zero rate on invoices.
- **C-03 uses statuses that don't exist** (`voided`, `credited`), suggesting guard logic was written against an assumed, not actual, enum — a drift risk.

### 5.4 Compliance items requiring external validation

- VAT return calculation correctness and filing deadlines — **requires Malawi Revenue Authority (MRA) rule confirmation**; code tests do not establish legal compliance.
- PAYE bands and TPR pension rates — MRA-sourced figures need external re-validation.
- Tax-inclusive vs exclusive pricing, exempt/zero-rated treatment — must be validated against MRA schedules.
- IAS 21 (FX revaluation) and the five financial statements — should be reviewed by a chartered accountant; no golden-file tests exist.

### 5.5 Security items requiring independent testing

- RLS effectiveness against the live database for **all** tables (the original F1 caveat — "policies may have been applied out-of-band via the dashboard" — is still unresolved).
- Cross-tenant API/webhook probes (direct PostgREST and Edge Function calls, not just UI).
- Webhook HMAC, API-key hashing, and rate-limit bypass attempts against the deployed functions.
- CORS configuration with `ALLOWED_ORIGINS` actually set (falls back to project origin otherwise).
- Penetration test / DAST — none has been performed per the original audit, and none is evidenced here.

### 5.6 Customer acceptance tests still required

1. End-to-end invoice: draft → issue → post → full pay → **reverse payment** → verify balance, AR ageing, and reports all agree.
2. Discount scenarios (none/%/fixed/+tax/+partial) reconciled across invoice display, DB, PDF, customer balance, revenue, tax, branch report, organisation report, and AI insights.
3. Every downloadable PDF: generate, download, open, compare to source; re-test after edit and after payment; verify an **actionable error** (not silence) on failure; desktop + mobile.
4. Inventory full cycle with qty > 1, decimals, and insufficient-stock rejection.
5. Offline: transaction → restart → reconnect → sync; duplicate submission, failed/interrupted sync, two-device and conflicting transactions; confirm no transaction silently disappears or is marked synced before all effects commit.
6. Branch/tenant isolation: log in as a user from another organisation and attempt direct URL/API access to transactions, customers, suppliers, inventory, payroll, reports, files.
7. Reporting reconciliation: identical data across transaction list → ledger → trial balance → P&L → balance sheet → inventory → branch → organisation.
8. AI insights: confirm figures match source reports, periods and branches are distinguished, assumptions and uncertainty are surfaced, and no accounting record is modified.

### 5.7 Recommended production-release checklist

1. **Merge PR #39 and PR #45** (RLS on the 4 unprotected tables + VAT-return cron guard consolidation + `audit_rls_gaps()`), then run `supabase db push` and verify against the live database. **Blocking.**
2. Delete `supabase/functions/api/middleware.ts` (F5) — still present.
3. Fix the C-02 reversal path: allow backout decrements in `increment_amount_paid` (or add a dedicated decrement RPC) and **propagate** RPC errors.
4. Enforce void/credit-note payment blocking at the repository or DB (trigger) level, using the real enum values only.
5. Add the `vat_registered` 0%-rate gate to the invoice builder (H-06 claim not met).
6. Add `supabase/config.toml` pinning `verify_jwt` per function (still absent).
7. Version-control the core accounting schema (populate `schema.sql` / base migration) so RLS and constraints are auditable.
8. Add golden-file tests for the five financial statements, `FxRevaluationService`, VAT return generation, and Edge Functions.
9. Set `ALLOWED_ORIGINS` in Supabase secrets (CORS currently falls back to project origin).
10. Run the full customer-acceptance test matrix (§5.6) in a staging environment before any production tag; obtain MRA/accountant sign-off for tax and statement correctness.

---

## 6. Method & limitations

Verification was performed against a clean `npm ci` on `arena/019ffa8d-ledgr-react`: full toolchain execution (`tsc -b`, `eslint`, `vitest run`, `vite build`), `npm audit`, static review of the DAL repositories, journal/inventory/payroll/tax services, `api` Edge Functions, and all migrations, cross-referenced with GitHub PR state (`gh`).

**Not covered:** no live Supabase project was available, so RLS policies, triggers, and any database-level behaviour were reviewed **as written**, not probed at runtime; no DAST/penetration test, load test, or accessibility re-audit was performed. The original "Section 11" audit document is not in the repository, so C/H/L items were verified against the remediation report's own descriptions.

This report does **not** characterise Ledgr as "fully compliant", "legally compliant", "enterprise-ready", or "production-ready": the evidence does not support those claims while the critical RLS fix remains unmerged and no end-to-end financial workflow test has been demonstrated.
