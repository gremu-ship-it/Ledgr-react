# Ledgr — Remediation & Verification Report

**Date:** 2026-08-13
**Branch:** `arena/019ffa8d-ledgr-react`
**Scope:** Fix the findings confirmed in the independent post-remediation verification, with tests and evidence.
**Baseline:** `6c5fc50` (merge of PR #90).

---

## 1. What was changed

| # | Finding addressed | Change |
|---|---|---|
| 1 | **P0** F1 — 4 tables without RLS | Migration `20260813000000_enable_rls_on_unprotected_tables.sql` (tenant-scoped policies; `api_usage` service-role only; `currencies` read-only). Deleted dead `supabase/functions/api/middleware.ts`. |
| 2 | **P1** C-02 — payment reversal regression | Migration `20260813000001` (RPC accepts negative back-out, non-negative guard, ownership check). `JournalRepository.reverse()` now surfaces RPC errors and recomputes status via a shared pure helper; expense reversal returns `approved`. |
| 3 | **P1** C-03 — void/credit-note payment control | Migration `20260813000002` (DB triggers block payments on cancelled documents). Repository-level guard with clear error. Fixed UI to use the real status enum. |
| 4 | **P1** H-06 — VAT barrier label | Tax-code dropdown now shows the business's *effective* rate (`VAT 0%` when not VAT-registered); computation was already correct. |
| 5 | **P1** Offline idempotency | Migration `20260813000003` (`client_key` + unique index on 6 tables). `enqueue()` generates a stable `client_key`; all six sync paths (invoices, expenses, invoice/expense payments, payroll runs, stock movements) return the existing record on retry instead of duplicating. |

---

## 2. Verification results (per prior finding)

| ID | Finding | Fix | Test | Result | Evidence | Remaining Risk |
|---|---|---|---|---|---|---|
| F1 | 4 tables ship without RLS (cross-tenant leak) | Enable RLS + tenant policies | Static migration test (`rlsIsolation.test.ts`, 5 tests) | **PARTIAL** | Migration present; all four tables covered; `api_usage` has no client policy; `middleware.ts` deleted. | **Runtime NOT VERIFIED** — no live Supabase DB to probe cross-tenant SELECT/INSERT/UPDATE/DELETE. Must be confirmed against staging before any release. |
| F5 | Dead buggy `api/middleware.ts` | Delete it | Test asserts file absent | **PASS** | File deleted; no imports remain (verified via grep). | None. |
| C-02 | Payment reversal: negative amount rejected + error swallowed | RPC accepts back-out; error propagated | `paymentStatus.test.ts` (8) + `paymentReversal.test.ts` (7) | **PASS** (code) / **NOT VERIFIED** (runtime) | RPC migration removes the `<= 0` rejection, adds non-negative + ownership guard; `reverse()` throws on RPC error and uses `paymentStatusFromAmounts`. | `reverse()` is still non-transactional (reversal entry posts before back-out; a mid-way failure leaves a recoverable but partial state). Payment row is deleted rather than marked reversed (audit-trail gap). |
| C-03 | Void/credit-note payments allowed (UI-only, wrong enum) | DB triggers + repo guard + UI enum fix | `paymentGuard.test.ts` (4 tests) | **PASS** (code) / **NOT VERIFIED** (runtime) | Triggers on `invoice_payments`/`expense_payments`; repo throws `ValidationError` before insert; UI now uses `paid/void/credit_note`. | Triggers reference out-of-band tables (guarded by `to_regclass`); must be verified on the live schema. |
| C-04 | Ledger/stock failures swallowed | (pre-existing re-throw) + reversal RPC error now thrown | `paymentReversal.test.ts` asserts `if (rpcError) throw` | **PASS** | Insert failures re-thrown; reversal RPC error no longer discarded. | `voidSourceRecord` failures remain log-only (deliberate, documented). |
| H-06 | Non-VAT business can charge VAT | Effective-rate label; computation already 0% | Manual code review; typecheck/lint | **PASS** | `effectiveVatRate = isVatRegistered ? 0.175 : 0` in IncomePage/ExpensesPage; dropdown label now reflects the effective rate. | No runtime UI test. |
| Offline idempotency (new) | Duplicate records on retried sync | `client_key` + unique index + repo dedup (all six sync paths) | `idempotency.test.ts` (3 tests) + typecheck/lint | **PARTIAL** | Invoices, expenses, invoice/expense payments, payroll runs, and stock movements all dedupe on retry via `client_key`; `enqueue()` issues a key. | Runtime sync not exercised end-to-end against a live DB (no environment). |
| F2 / F3 / F6 / F7 / F8 / F9 / F10 | Dependency vulns; VAT cron auth; CORS; project ref; orphans; README; depreciation | (verified in prior pass) | `npm audit` = 0; code review | **PASS** | Already fixed on this branch; re-confirmed this pass. | None new. |
| C-07 / C-08 / C-11 / C-12 / H-02 / H-03 / H-05 / H-08 / H-09 / H-16 | Tax aggregation/dates; dashboard↔P&L; MFA; recon lock; track_inventory; transfer costs; payroll accrual; async PDF; API POST block; team mgmt | (verified in prior pass) | Code review + existing tests | **PASS** (code presence) | Re-confirmed present in this pass. | End-to-end accounting/PDF/tax/payroll flows remain **NOT VERIFIED** (no live environment). |
| Inventory quantity | Quantities silently forced to 1 | N/A — not a bug in main flows | Code review | **PASS** | Main invoice/expense flows use `Number(line.quantity)`; quantity is not coerced to 1. | Mobile quick-add (`QuickIncomeMobile`/`QuickExpenseMobile`) is a single-unit quick entry by design (no quantity input) — product limitation, not a data-integrity bug. |

---

## 3. Quality gates (executed)

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run lint` | ✅ 0 problems |
| `npm run test` | ✅ **229 passed / 29 files** (was 202 / 24) |
| `npm run build` | ✅ success |
| `npm audit` | ✅ 0 vulnerabilities |

New tests added: `rlsIsolation` (5), `paymentStatus` (8), `paymentReversal` (7), `paymentGuard` (4), `idempotency` (3) = **27 new tests**.

---

## 4. Final release decision

### CRITICAL
- **None remaining in code.** The two critical findings from the verification (F1 RLS leak; C-02 reversal regression) are now fixed in the working branch with migrations and regression tests. **However**, the RLS fix has **not been exercised against a live database** — until it is, treat the cross-tenant isolation claim as unproven at runtime.

### HIGH
- **Runtime verification of RLS** is outstanding: the F1 fix is correct-as-written but the original caveat ("policies may have been applied out-of-band; verify against live DB") still applies.
- **`JournalRepository.reverse()` is non-transactional** — a mid-way failure between the reversal entry and the payment back-out leaves a partial state.

### MEDIUM
- Core accounting schema (`invoices`, `journal_entries`, `accounts`, etc.) is still **not in `supabase/migrations/`** (`schema.sql` empty); RLS/constraints on the most important tables cannot be audited from source.
- `supabase/config.toml` (pinning `verify_jwt` per function) still absent.
- `ALLOWED_ORIGINS` must be set in Supabase secrets (CORS falls back to project origin otherwise).

### NOT VERIFIED
- Cross-tenant SELECT/INSERT/UPDATE/DELETE and direct URL/API probes against a live database (no Supabase project available).
- End-to-end invoice lifecycle, discounts→reports reconciliation, PDF generate/download/open, offline multi-device sync, tax return generation, payroll run, and report cross-reconciliation — none can be executed here.
- The DB triggers (payment guard) and unique indexes (idempotency) against the live schema.
- `paychangu-webhook` / API idempotency/retry behaviour at runtime.

### REGRESSION RISKS
- `recordPayment`/`createWithLines` signatures gained an optional `clientKey` — all existing callers verified compatible (no break).
- `reverse()` now returns expenses to `approved` (was setting invalid `sent`/`partially_paid`); this is a correctness fix but changes observable status values.
- The auto-void behaviour in `reverse()` (voids the whole source record when its recognition entry is reversed) remains a deliberate but aggressive semantic — needs product sign-off.
- The UI `canPay` guard narrowed to real enum values — non-breaking.

### EXTERNAL VALIDATION REQUIRED
- RLS/tenant isolation against a live Supabase project (security review).
- VAT/PAYE/TPR calculations and due dates against **Malawi Revenue Authority** rules (legal, not software).
- IAS 21 FX revaluation and the five financial statements — chartered-accountant review (no golden-file tests).
- Penetration test / DAST.

### CUSTOMER ACCEPTANCE TESTS
1. Two-tenant, two-user, two-branch isolation probe (direct API + URL manipulation).
2. Invoice: pay in full → reverse payment → verify balance, AR ageing, and reports agree.
3. Discount scenarios reconciled across UI / DB / PDF / reports / AI insights.
4. Offline: transaction → restart → reconnect → sync; duplicate and interrupted sync; two devices.
5. PDFs after edit, after payment, after discount; confirm actionable error on failure; desktop + mobile.
6. Payroll run → approval → liability → payment → payslip → report.

### RELEASE RECOMMENDATION

**YELLOW — Limited beta / customer use only.**

The previously confirmed critical code defects are now fixed with migrations and regression tests, and the pipeline is fully green. But the single most important fix (cross-tenant RLS) has **not been executed against a live database**, and two offline idempotency paths remain incomplete. GREEN requires runtime evidence that the security, accounting, inventory, payment and data-integrity workflows actually behave as intended — that evidence cannot be produced in this environment, so GREEN is not awarded. The path to GREEN is: deploy the three new migrations to staging, run the customer-acceptance matrix above (especially the two-tenant isolation probe), and confirm `increment_amount_paid` / payment guard / `client_key` dedup behave correctly against real data.
