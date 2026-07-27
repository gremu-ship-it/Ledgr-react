# Tax Compliance Module — Audit & Remediation

**Audited:** 2026-07-27 · **Remediated:** 2026-07-27
**Branch:** `arena/019fa4b4-ledgr-react`

Original verdict: **not fully implemented (~35%)** — a schema + backend skeleton with no user-facing module.
Current status: **blockers fixed, module built, `npm run verify` green.**

---

## Scorecard

| # | Requirement | Before | After |
|---|---|---|---|
| 1 | Malawi VAT rate | ⚠️ 17.5% hardcoded ×5 files | ✅ Read from `tax_configurations` via `useVatRate` |
| 1 | Output/input VAT auto-calc | ⚠️ Included quotes, proformas, void | ✅ Filtered to revenue documents |
| 1 | VAT return (Form VAT 3) | ⚠️ Data row only | ✅ Box 1/2/3 layout + CSV export |
| 1 | VAT due 25th | ✅ | ✅ |
| 1 | PAYE bands | ✅ | ✅ (fallback bands refreshed to Jan-2026 rates) |
| 1 | PAYE auto-calc | ✅ wired | ✅ **now actually reachable** (see B1) |
| 1 | PAYE return | ⚠️ Data row only | ✅ Full return view |
| 1 | PAYE due date | ❌ Off by a month, 3 conflicting rules | ✅ Single source of truth |
| 1 | TPR 10%/5% | ✅ | ✅ |
| 2 | **Zambia ZRA** | ❌ Absent | ✅ VAT 16%, ZRA PAYE bands, NAPSA |
| 3 | Per-tax dashboard | ❌ | ✅ Obligations tab |
| 3 | Days remaining, red <7d | ⚠️ Hardcoded dates | ✅ From real `tax_returns` |
| 3 | Payment status | ❌ | ✅ |
| 3 | Alerts 14/7/1/due | ⚠️ Scheduled, never sent | ✅ `send-tax-alerts` + cron |
| 3 | Mark as paid | ⚠️ Backend orphan | ✅ Wired to UI |
| 3 | Link bank transaction | ⚠️ GL account only | ✅ Optional `bank_statement_lines` link |
| 3 | Attach receipt | ❌ No bucket | ✅ `tax-receipts` bucket + upload |
| 3 | Filing history | ⚠️ Backend orphan | ✅ History tab + CSV |
| 4 | Auto-post on payroll | ⚠️ Threw on bad account | ✅ Fixed |
| 4 | Auto-post on VAT close | ❌ Dead code | ✅ Wired, correct double-entry |

---

## Blockers — all fixed and verified

### B1. Payroll approval always threw — wrong account code
`PayrollRepository.ts:306` looked up account **`6130`**; `seedChartOfAccounts.ts:264` seeds **`6112`**. `6130` does not exist in the template. The doc comment 130 lines above already said 6112 was correct and called 6130 "an unused stray" — the code used 6130 anyway.

Any business with employer pension > 0 failed approval, so **no PAYE or TPR return was ever generated**. One line disabled most of requirement 1 and all of requirement 4's payroll half.
→ Corrected to `6112` with an actionable error message.

### B2. TPR payable account NULL with no way to set it
The migration deliberately seeded `tax_payable_account_id = NULL`; `approve()` hard-throws on null; the config modal never exposed the field.
→ Migration now resolves **2132 Pension Payable** at seed time and backfills existing NULL rows. PAYE (**2122**) and VAT (**2121** / **1135**) configs are seeded too. Both account pickers added to the config modal.

**Verified against real Postgres:**
```
tax_code      name          rate   employer  employee  payable_linked  receivable_linked
paye          PAYE          0      null      null      true            false
tpr_pension   TPR Pension   0      10        5         true            false
vat_standard  VAT Standard  17.5   null      null      true            true
```

### B2a. The fix had to be a *forward* migration (caught pre-merge)

My first attempt fixed B2 by editing `20260708000000_tax_compliance_module.sql`.
That would have silently done nothing in production.

`database.generated.ts` is dumped from the live schema and already contains
`tax_returns`, `tax_payments`, `tax_alerts` and `tpr_pension` — so that
migration is **already applied**. Supabase tracks migrations by version:
editing an applied file never re-runs it, and a *new* file dated before the
latest applied version makes `supabase db push` fail outright.

So the original file is now schema-only, and the seeding/linking moved to two
new forward migrations dated after everything already applied:
`20260727000012` (enum) and `20260727000013` (seed + backfill).

**Verified against a simulated production database** (old migration
pre-applied, then only the new files pushed):

```
BEFORE   tpr_pension   payable_linked: false     <- payroll approval throws
AFTER    paye          payable_linked: true
         tpr_pension   payable_linked: true      <- unblocked
         vat_standard  payable + receivable: true
re-run row count (must stay 3): 3
```

Fresh-database path also passes, twice through, all three configs linked.

### B3. Migration failed on a clean `supabase db push`
Line 19 added `tpr_pension` to the enum; line 176 used it — same transaction. Postgres forbids this.

**Reproduced against real Postgres:**
```
ORIGINAL migration (enum ADD VALUE + seed in ONE transaction)
  FAILED as predicted:
    unsafe use of new value "tpr_pension" of enum type tax_code
```
→ Enum addition split into its own file (`20260727000012`), seeding into `20260727000013`. Whole module made idempotent (`if not exists`, guarded `create type`, `drop policy if exists`).

```
FIRST APPLY (clean database)     PASS  PASS
SECOND APPLY (idempotency)       PASS  PASS
```

### B4. Due dates a day early in Malawi
Helpers parsed ISO strings as UTC midnight, read `.getMonth()` in local time, then re-serialised via `.toISOString()`.

**Before:** `TZ=Africa/Blantyre lastDayOfMonth('2026-06-30')` → `2026-06-29`
**After** — identical across UTC, Africa/Blantyre, Pacific/Kiritimati, America/Los_Angeles:
```
2026-06-30 | lastDay: 2026-06-30 | VAT: 2026-07-25 | +14d: 2026-07-14
2026-12-31 | lastDay: 2026-12-31 | VAT: 2027-01-25 | +14d: 2027-01-14
clamp 31 Jan + 1 month, day 31 -> 2026-02-28
```

---

## Correctness fixes

- **C1 — PAYE due date.** Was `lastDayOfMonth(period_end)`: due the same day the period closed. Three answers existed (repository / dashboard "14th" / spec). Now one rule in `taxRules.ts`: 14 days after month end.
- **C2 — Swallowed input VAT.** `.catch(() => 0)` hedged against a column name that was already correct, silently booking input VAT as zero on any RLS or network error and **overstating VAT payable**. Removed.
- **C3 — Document filtering.** VAT returns now exclude quotes, proformas, void, draft and soft-deleted rows, matching `IncomeRepository`'s existing discipline. Fixed in both the repository and the Edge Function.
- **C4 — VAT credits.** Was `Math.max(net, 0)`, discarding refunds. Now stored as a negative `amount_due`; the VAT 3 view shows "repayable".
- **C5 — VAT journal entry.** Was posting the net twice over the same two accounts. Now `Dr Output VAT (2121) / Cr Input VAT (1135) / Cr-or-Dr net`, clearing both control accounts.
- **C6 — Overdue transition.** Nothing ever set `'overdue'`. Added `mark_overdue_tax_returns()` (daily cron + on dashboard load).
  **Verified:** 2 past-due returns flipped, the paid one untouched, the future one left pending.
- **C7 — `markFiled` lockout.** Paying before filing (routine for VAT) permanently blocked filing. Now allowed, without demoting `paid`.

---

## Infrastructure added

- `send-tax-alerts` Edge Function — delivers 14/7/1/due-date alerts. SendGrid email (matching `send-renewal-reminders`), Africa's Talking SMS for Airtel/TNM. Skips settled returns; leaves rows pending if a provider isn't configured.
- `20260727000011_schedule_tax_jobs.sql` — pg_cron for `generate-vat-returns` (monthly) and `send-tax-alerts` (daily). **The VAT generator previously had no schedule at all** — the cron snippet lived only in a code comment.
- `generate-vat-returns` — now secured with `x-cron-secret`, UTC-safe dates, jurisdiction-aware due dates, and the same document filtering as the repository.
- `20260727000009_tax_receipts_storage.sql` — private `tax-receipts` bucket, RLS scoped by business folder.

### Deployment

Both functions are deployed manually with `--no-verify-jwt`, matching the
convention your three existing cron functions already use. They are
deliberately **not** added to the CI deploy loop: that loop leaves JWT
verification on, and cron invokes these with an `x-cron-secret` header and no
user JWT, so they would 401 on every scheduled run.

Full instructions: **TAX_MODULE_SETUP.md**

---

## Notes on the spec

**16.5% vs 17.5%.** The prompt says 16.5%; the code says 17.5%. **The code is right** — Malawi raised VAT to 17.5% effective 1 January 2026 (VAT (Amendment) Act 2025). I did not change it down. What I fixed is that the rate was hardcoded in five files instead of read from `tax_configurations`.

The stale PAYE fallback bands (K1.2m/K2.4m at 0/25/35%) were also refreshed to the January 2026 structure: K170,000/month tax-free, then 30/35/40%.

**Zambia** required a jurisdiction dimension, not just a tab — `taxRules.ts` now holds rates, filing rules and due-date logic as data per jurisdiction, resolved from `businesses.country`.

**Verified:**
```
MW  VAT   Form VAT 3               -> 2026-07-25   (17.5%)
MW  PAYE  PAYE Monthly Return      -> 2026-07-14
MW  TPR   TPR Remittance Schedule  -> 2026-07-14
ZM  VAT   VAT Return               -> 2026-07-18   (16%)
ZM  PAYE  PAYE Return              -> 2026-07-10
ZM  NAPSA NAPSA Remittance         -> 2026-07-10
```

---

## Also fixed

`src/lib/a11y.ts` had a pre-existing lint error breaking `npm run verify` on every branch. The `announce()` politeness argument was accepted and then discarded, so callers passing `'assertive'` for errors never actually interrupted. Now applied to the live region.

---

## Verification

```
npm run typecheck   PASS
npm run lint        PASS  (was failing on a11y.ts before this branch)
npm run build       PASS
migrations          PASS on clean apply and re-apply (real Postgres via PGlite)
date helpers        identical across 4 timezones
```

## Remaining / deliberately not done

- **No automated test suite.** The repo has no test runner. Logic was verified by executing it against real Postgres and across timezones, but there are no committed regression tests. Adding Vitest is the highest-value next step — `taxDates`, `taxRules` and the VAT breakdown are all pure and trivial to cover.
- **Cron migrations contain `<PROJECT_REF>` / `<CRON_SECRET>` placeholders**, matching the existing convention in the three sibling schedule migrations. Substitute before applying.
- **SMS is opt-in.** `AFRICASTALKING_API_KEY` / `_USERNAME` must be set or SMS alerts stay pending. Email works with the existing `SENDGRID_API_KEY`.
- **Zambian PAYE bands and NAPSA ceiling** are seeded from published rates but were not confirmed against a current ZRA circular. Verify before relying on them for filing, and note the NAPSA statutory monthly ceiling is not yet applied.
- **`database.generated.ts` not regenerated** — no live Supabase project in this environment. It already contains the tax tables, so typecheck passes; regenerate after applying the new migrations.
