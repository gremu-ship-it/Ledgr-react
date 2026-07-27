# Tax Compliance Module — Implementation Audit

**Date:** 2026-07-27
**Branch:** `arena/019fa4b4-ledgr-react`
**Verdict:** **Not fully implemented — roughly a schema + backend skeleton (~35%). The user-facing module described in the prompt does not exist.**

`npm run typecheck`, `lint` and `build` all pass. Nothing here is broken *compilation*; the gaps are missing features and logic defects.

---

## Scorecard

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | **Malawi VAT 16.5%** | ⚠️ Deviates | Rate is 17.5% everywhere, hardcoded in UI, not read from config |
| 1 | Output/input VAT auto-calc | ⚠️ Buggy | Works, but includes quotes/proformas/void invoices |
| 1 | VAT return (Form VAT 3) | ⚠️ Data only | A `tax_returns` row is created. No VAT 3 form, no export, no UI |
| 1 | VAT due 25th of following month | ✅ | Correct (one TZ caveat below) |
| 1 | PAYE progressive bands | ✅ | `paye_bands` table + band walker; UI fallback bands are stale |
| 1 | PAYE auto-calc from payroll | ✅ | Wired through `PayrollRepository.approve()` |
| 1 | PAYE return generation | ⚠️ Data only | Row only, no return document, no UI |
| 1 | PAYE due last day of month | ❌ Wrong | Off by one month; conflicts with dashboard (says 14th) |
| 1 | TPR 10% / 5% | ✅ | Dual-rate config, applied in payroll, TPR return generated |
| 2 | **Zambia ZRA (VAT 16%, PAYE bands)** | ❌ **Absent** | Zero code. No jurisdiction concept exists at all |
| 3 | Dashboard per tax type | ❌ | `TaxPage` has only "Tax Configurations" + "PAYE Bands" tabs |
| 3 | Days remaining, red if <7 days | ⚠️ | Exists on the *main* dashboard, off hardcoded dates, not `tax_returns` |
| 3 | Payment status | ❌ | Not surfaced anywhere |
| 3 | Email/SMS alerts 14/7/1/due | ⚠️ Scheduled, never sent | Rows written to `tax_alerts`; no sender, no cron, no SMS provider |
| 3 | Mark as paid | ⚠️ Backend only | `recordPayment()` is solid but never called from any UI |
| 3 | Link to bank transaction | ⚠️ | Links to an `accounts` GL row, not a `bank_statement_lines` transaction |
| 3 | Attach payment receipt | ❌ | `receipt_path` column exists; no storage bucket, no upload UI |
| 3 | Filing history | ⚠️ Backend only | `findHistoryByBusiness()` written, never called |
| 4 | Auto-post on payroll run | ⚠️ Blocked | Correct entry, but throws on a wrong account code (see B1) |
| 4 | Auto-post on VAT period close | ❌ | `postToJournal()` is dead code; the cron function never calls it |

---

## What actually exists

**Solid:**
- `supabase/migrations/20260708000000_tax_compliance_module.sql` — `tax_returns`, `tax_payments`, `tax_alerts`, 4 new enums, RLS matching the repo's `business_users` pattern, `tpr_pension` seed.
- `TaxReturnRepository.ts` (424 lines) — VAT/PAYE/TPR generation, idempotent via unique `(business_id, tax_code, period_label)`, alert scheduling, `markFiled`, `postToJournal`.
- `TaxPaymentRepository.ts` (162 lines) — payment recording with Dr Tax Payable / Cr Bank, over-payment guard, parent status roll-up.
- `PayrollRepository.approve()` — posts the payroll journal, then generates PAYE + TPR returns.
- `supabase/functions/generate-vat-returns/` — monthly VAT return generator.

**Dead code — written, registered in `src/lib/repositories.ts`, called by nothing:**
```
repos.taxReturn.findOpenByBusiness()      ← the "amount owed / due date" dashboard
repos.taxReturn.findHistoryByBusiness()   ← the "filing history" list
repos.taxReturn.findPaymentsForReturn()
repos.taxReturn.markFiled()
repos.taxReturn.postToJournal()           ← requirement 4, VAT half
repos.taxPayment.recordPayment()          ← the "mark as paid" flow
repos.taxPayment.findByTaxReturn()
repos.tax.getVatRate() / getWhtRate() / calculatePaye()
```
`grep -rn "repos.taxReturn\|repos.taxPayment" src --include='*.tsx'` returns **zero** matches. Requirement 3 is essentially an unconnected API surface.

---

## Blocking defects

### B1. Payroll approval always throws — wrong account code
`src/dal/repositories/PayrollRepository.ts:306`
```ts
const pensionExpenseAccountId = await this.findAccountByCode(run.business_id, '6130');
```
`seedChartOfAccounts.ts:264` seeds **`6112`** "Employer Pension Contributions". There is **no `6130`** in the template (`grep -c "code:'6130'"` → 0). The doc comment at line 169–171 of the same file says 6112 is the confirmed account and calls 6130 "an unused stray" — the code then uses 6130 anyway.

Any business with employer pension > 0 fails approval → **no PAYE or TPR return is ever generated**. This single line disables most of requirement 1 and all of requirement 4's payroll half.

### B2. TPR payable account is NULL and there is no way to set it
The migration (lines 168–186) deliberately seeds `tax_payable_account_id = NULL`. `PayrollRepository.approve()` hard-throws if it's null. `TaxPage`'s config modal exposes tax code, name, rates, description, MRA ref, dates, active — but **not** `tax_payable_account_id` / `tax_receivable_account_id`. There is no UI path to unblock this and no follow-up migration.

### B3. Migration likely fails on `supabase db push`
Line 19 adds `tpr_pension` to the `tax_code` enum; line 176 inserts a row *using* that value in the same file. Postgres permits `ALTER TYPE … ADD VALUE` inside a transaction (PG12+) but forbids **using** the new value in that same transaction. `supabase db push` wraps each migration file in one transaction → `unsafe use of new value of enum type tax_code`. The migration's own header comment acknowledges the restriction and then violates it.

`database.generated.ts` already contains `tpr_pension`, so this was probably applied out-of-band. A clean environment will fail. Also non-idempotent: `create type` / `create table` have no `if not exists`, so a re-run errors.

### B4. Due dates are one day early in Malawi
`lastDayOfMonth()` / `addDays()` (`TaxReturnRepository.ts:409–418`) parse with `new Date('2026-06-30')` (UTC midnight), read `.getMonth()` in **local** time, then re-serialise with `.toISOString()` (UTC). Verified:

```
TZ=UTC             lastDayOfMonth('2026-06-30') → 2026-06-30   TPR → 2026-07-15
TZ=Africa/Blantyre lastDayOfMonth('2026-06-30') → 2026-06-29   TPR → 2026-07-14
```
Every PAYE and TPR due date is a day early for the target market. (`addMonthsSetDay` for VAT happens to be safe.)

---

## Correctness defects

### C1. PAYE due date is off by a month, and contradicts the dashboard
`TaxReturnRepository.ts:163` → `dueDate = lastDayOfMonth(payrollRun.period_end)`. For a June payroll (`period_end = 2026-06-30`) the return is due **2026-06-30** — the same day the period closes, i.e. before payroll is even remitted. Should be the last day of the *following* month.

Three different answers live in the codebase:
- prompt: last day of month
- `TaxReturnRepository`: last day of the *period's own* month
- `useTaxData.ts:35` + `en.json:254` ("Due: 14th of current month"): the 14th

### C2. Input VAT silently reported as zero
`TaxReturnRepository.ts:121`
```ts
).catch(() => 0); // FLAGGED: expenses.expense_date column name not confirmed
```
`expenses.expense_date` **is** correct (confirmed in `database.generated.ts`). The bare catch swallows every error — RLS denials, network blips, anything — and books input VAT as 0, **overstating VAT payable to MRA**. Remove it.

### C3. VAT return includes non-revenue and voided documents
`sumLineTax()` filters only on `business_id` + date + `tax_code = 'vat_standard'`. It does not exclude:
- `invoice_type IN ('quote','proforma')` — not revenue events
- `deleted_at IS NOT NULL`
- `status = 'void'` / draft

`IncomeRepository` is careful about exactly this (`REVENUE_INVOICE_TYPES`, `.is('deleted_at', null)`); the tax path ignores it. Output VAT will be overstated on any business that issues quotes. The Edge Function repeats the same bug.

### C4. VAT credit positions are discarded
`TaxReturnRepository.ts:138` → `amount_due: Math.max(netPayable, 0)`. When input VAT exceeds output VAT — routine for exporters and capex months — the refund/carry-forward is thrown away and stored as 0. Form VAT 3 has a repayment box; this can't populate it. `output_tax`/`input_tax` are stored, so the data survives, but the headline figure is wrong.

### C5. VAT journal entry is not a valid VAT close
`postToJournal()`'s VAT branch (lines 293–297) posts `Dr VAT Receivable / Cr VAT Payable` at the **net** amount. A correct close is `Dr Output VAT (2121) / Cr Input VAT (1135) / Cr VAT Payable (net)`. The code's own comment warns this may double-count. The CoA already has 1135, 2121 and 2125 (VAT Clearing) seeded and ready.

### C6. Nothing ever marks a return overdue
`tax_return_status` includes `'overdue'`; `findOpenByBusiness()` queries it and `markFiled()` accepts it — but no job, trigger or client code ever performs the transition. Returns sit at `pending` forever.

### C7. `markFiled` can become unreachable
It requires status `pending|overdue`, but `recordPayment()` sets `paid`. Pay-then-file (common for VAT) permanently locks out filing-reference capture.

---

## Infrastructure gaps

- **The VAT cron never runs.** `generate-vat-returns` is absent from the deploy loop in `.github/workflows/deploy-supabase.yml` (which deploys only `suggest-bank-matches`, `send-invoice`, `invoice-open`, `process-invoice-automation`), and it has **no `schedule_*.sql` migration** — unlike `expire-subscriptions`, `send-renewal-reminders` and `generate-partner-invoices`, which each have one. The `cron.schedule` snippet exists only as a comment at the bottom of the function file.
- **No alert sender.** `tax_alerts` rows accumulate; nothing reads them. No Edge Function, no cron, no SendGrid call (the repo already uses SendGrid in `send-renewal-reminders` — the pattern to copy is right there). `channel` supports `'sms'` but there is no SMS provider anywhere in the repo. The migration comment says "consumed in Phase 4" — Phase 4 was never built.
- **No storage for receipts.** `tax_payments.receipt_path` exists; there is no bucket migration, no upload component, no `.storage.` call anywhere in the codebase.
- **`set_updated_at()` collision.** This migration creates `public.set_updated_at()` (line 125); `20260726000002_subscription_payments.sql:70` creates it again. Bodies are identical so no runtime harm, but two migrations own the same object.
- **No tests.** No test runner, no `test` script, zero test files. Tax arithmetic, band walking and due-date logic are all unverified.
- **No role enforcement.** `TaxPaymentRepository`'s header defers role checks to the caller — and there is no caller.

---

## On the 16.5% vs 17.5% discrepancy

Your prompt specifies **16.5%**; the code uses **17.5%** throughout. The code matches current reality — Malawi raised VAT from 16.5% to 17.5% effective 1 January 2026 under the VAT (Amendment) Act 2025. So don't "fix" this to 16.5%.

The real problem is *where* the rate lives. `tax_configurations` is the intended source of truth and `TaxRepository.getVatRate()` exists to read it — but it's never called. Instead the rate is hardcoded in at least five places:

```
src/pages/ExpensesPage.tsx:262            const VAT_RATE = 0.175;
src/pages/IncomePage.tsx:214              const VAT_RATE = 0.175;
src/components/mobile/QuickExpenseMobile.tsx:108,149,229
src/pages/InvoicesPage.tsx:564            "VAT (17.5%)"
src/pages/TaxPage.tsx:15                  "VAT Standard (17.5%)"
src/pages/SettingsPage.tsx:500 / CreateBusinessPage.tsx:201,320
```
The next rate change means another multi-file hunt, and it makes Zambia (16%) impossible without a rewrite.

Similarly, `calculatePAYE()`'s fallback bands (`PayrollPage.tsx:29–34`: 0 / 25% / 35% at K1.2m / K2.4m annual) are stale — the January 2026 changes moved the zero threshold to K170,000/month and introduced 30/35/40% marginal rates.

---

## Requirement 2 is a design problem, not a coding gap

Zambia isn't merely unimplemented — the schema actively precludes it:

- `tax_code` enum is a flat Malawi list (`vat_standard`, `paye`, `wht_10/15/20`, `cit`, `fbt`, `tpr_pension`). No room for a ZRA VAT that coexists with MRA VAT.
- `tax_configurations.mra_reference` is Malawi-named; there is no `jurisdiction` / `country` column on `tax_configurations`, `tax_returns` or `paye_bands`.
- Due-date rules (25th, last day, +15 days) are hardcoded in TypeScript methods, not data.
- `'MWK'` is hardcoded in every journal line in both tax repositories, even though the app has full IAS 21 multi-currency support (`20260727000000_multi_currency_ias21.sql`) and `ZMW` is already a listed currency.

Adding ZRA means adding a jurisdiction dimension and moving due-date rules into data — schema work, not just a new tab.

---

## Suggested order of work

**Unblock (nothing works without these)**
1. `PayrollRepository.ts:306` — `'6130'` → `'6112'`
2. Expose `tax_payable_account_id` / `tax_receivable_account_id` in `TaxPage`'s config modal; add a migration linking `tpr_pension` → account 2132
3. Split the enum addition into its own migration file, ahead of the seed insert
4. Fix the date helpers to be timezone-safe (string arithmetic or UTC-only accessors)

**Correctness**
5. Fix PAYE due date to the following month; reconcile the three conflicting rules and centralise them
6. Delete the `.catch(() => 0)` on input VAT
7. Filter `sumLineTax` by `invoice_type`, `deleted_at`, `status` — in both the repository and the Edge Function
8. Store negative net VAT as a credit rather than clamping to 0
9. Rewrite the VAT journal entry as Dr Output / Cr Input / Cr Net Payable using 2121 / 1135 / 2125

**Build the missing module (requirement 3 — the bulk of the work)**
10. `TaxPage` "Obligations" tab on `findOpenByBusiness()`: amount, due date, days remaining (red <7), status, mark-paid action
11. "Filing history" tab on `findHistoryByBusiness()`
12. Payment modal wired to `recordPayment()`, with a Supabase Storage bucket + receipt upload
13. VAT 3 / PAYE return document rendering + CSV/PDF export (reuse `src/lib/reportExports.ts`)
14. `send-tax-alerts` Edge Function + `schedule_send_tax_alerts.sql`, modelled on `send-renewal-reminders`; add both it and `generate-vat-returns` to the CI deploy loop
15. Daily job to flip `pending` → `overdue`

**Then Zambia (requirement 2)**
16. Add a jurisdiction dimension; move rates and due-date rules into data; drop hardcoded `'MWK'` and `VAT_RATE` constants

---

*Read-only audit — no source files were modified.*
