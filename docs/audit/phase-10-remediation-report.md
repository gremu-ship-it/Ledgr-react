# Phase 10.1 — Remediation Report (A-01 → A-06)

**Date:** 2026-08-16 (continued from Phase 10 audit, PR #104)
**Branch:** `arena/phase-10-remediation` (PR #105)
**Scope:** close the Phase 10 P0/P1/P2 code + database findings. Production was
**not modified** (phase rule: staging/disposable only; the fixes land in `main`
via PR and reach production only through the tagged/approved deploy path).

---

## 1. Findings disposition

| ID | Severity | Finding | Status | Evidence |
|----|----------|---------|--------|----------|
| A-01 | P0 (incident) | No build-time guard for missing `VITE_*` env → blank-page recurrence risk | **FIXED** (code); workflow-free | `scripts/check-env.mjs` + `package.json` `prebuild`; build fails exit 1 without vars, passes with vars (verified below) |
| A-02 | P1 | `journalService` silent net-revenue fallback on missing 4130; broad catch | **FIXED** | Narrow catch via `isMissingAccountError` + `log.warn` at 3 sites; backfill migration `20260817000002`; unit tests 4/4 |
| A-03 | P2 | `invoices.amount_due` never set (NULL) | **FIXED** (DB-layer, all paths) | Trigger `sync_invoice_amount_due` + backfill migration `20260817000000`; audit assertion now passes (customer balance 47587.50) |
| A-04 | P2 | No DB CHECK for negative quantity/stock | **FIXED** | Migration `20260817000001` — 10 CHECK constraints, NOT VALID + validated on clean DB, warns (does not abort) on legacy violations |
| A-05 | P2 | VAT `0.175` duplicated ×4 | **FIXED** | `src/lib/vat.ts` single source; 4 rate sites + 4 label sites updated; rate verified current (17.5% effective Jan 2026, MRA) |
| A-06 | P2 (ops) | Staging frontend Vercel deploy failing | **OPEN — user action required** | Diagnosis below; sandbox cannot reach Vercel |
| A-07 | P3 | `as any` / `as never` spread | **OPEN** (deferred, non-blocking) | — |
| A-08 | P3 | No alert on catastrophic frontend errors | **OPEN** (Sentry alert rules — user dashboard action) | — |
| A-09…A-12 | BLOCKED | Browser journeys, backup-restore, UI tenant matrix, AI/offline | **BLOCKED** unchanged | Need user's browser on hosted staging |

---

## 2. A-01 — build-time env guard (P0 recurrence prevention)

**Problem:** `src/lib/supabase.ts` throws at module scope when
`VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are absent → blank page for all
users (production incident 2026-08-16). A missing secret is only noticed
after deploy.

**Fix:**
- `scripts/check-env.mjs` — fails the build with an actionable message when
  either variable is missing/blank.
- `package.json` → `"prebuild": "node scripts/check-env.mjs"` — npm runs
  `prebuild` automatically before every `npm run build`, so BOTH the GitHub
  Actions build step and the Vercel-side build (`vercel deploy` triggers a
  second build) are guarded. `npm run dev` is unaffected.
- CI (`.github/workflows/ci.yml`) already passes placeholder values, so CI
  builds pass the guard; real deployments fail loudly instead of shipping a
  blank page.

**Verified:**
```
env -u VITE_SUPABASE_URL -u VITE_SUPABASE_ANON_KEY npm run build → exit 1 (guard message)
VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder-anon-key npm run build → exit 0
```

---

## 3. A-02 — journalService discount fallback (P1)

**Problem:** three sites in `journalService.ts` used a bare `catch {}` (or
`.catch(() => null)`) around discount-account lookups. Any error — including
network/RLS/DB failures — silently changed the accounting disclosure (gross
→ net revenue, or dropped discount line).

**Fix (code, `src/services/journalService.ts` + `src/lib/journalErrors.ts`):**
- New predicate `isMissingAccountError(err)` — the ONLY tolerated condition.
- `createInvoiceJournalEntry` + `createInvoiceReceivableEntry`: on a genuine
  missing-4130, `log.warn` (module logger) explains the net posting and
  names the fix; **any other error rethrows** — no silent disclosure change.
- `createExpenseJournalEntry` (5175 → 4260 → null): non-missing errors from
  the 4260 lookup now rethrow; if both accounts are missing a warning is
  logged (the entry then fails the balance guard loudly rather than
  mis-posting).

**Fix (DB, migration `20260817000002_phase10_backfill_discount_accounts.sql`):**
- Backfills the discount chain for legacy businesses missing it, with the
  exact `seedChartOfAccounts.ts` attributes: `4000→4100→4130`,
  `4000→4200→4260`, `5000→5175`. Only missing rows are inserted; existing
  accounts are untouched; `parent_id` links are set only where NULL.
  Idempotent.

**Verified:**
- `journalErrors.test.ts` 4/4 (missing-account message recognised; network/
  RLS/DB/TypeError/non-Error all false).
- DB: after deleting 4130/4260/5175, re-running the migration recreates all
  three under the correct parents with seed attributes; existing accounts
  keep their ids.

---

## 4. A-03 — invoices.amount_due (P2)

**Problem:** all app insert paths left `amount_due` NULL; direct consumers
(`select sum(amount_due)` — the audit's customer-balance query) got 0.

**Fix (migration `20260817000000_phase10_amount_due_trigger.sql`):**
- `BEFORE INSERT OR UPDATE OF total_amount, amount_paid` trigger
  `trg_invoices_sync_amount_due` sets `amount_due = total_amount - amount_paid`.
  Covers **every** write path: web, mobile, offline sync, partner billing,
  edge functions (`process-invoice-automation`), API, and the
  `increment_amount_paid` RPC (including payment back-out, which is a
  negative increment).
- Backfill `UPDATE` aligns every existing row (`amount_due = total - paid`).
- No app call-site changes needed; the insert-returned row is already
  correct because the trigger runs before the row is returned.

**Verified (DB):**
- INSERT without `amount_due` → 47587.50.
- `increment_amount_paid(+10000)` → 37587.50; back-out (−10000) → 47587.50.
- Re-running the migration repairs a forced-NULL row.
- Audit assertion (Phase 10 §C customer balance) flipped FAIL→PASS: 47587.50.

---

## 5. A-04 — non-negative quantity/stock CHECKs (P2)

**Fix (migration `20260817000001_phase10_nonneg_quantity_checks.sql`)** — 10
constraints:

| Table | Constraint |
|---|---|
| `invoice_lines` | `quantity >= 0`, `unit_price >= 0` |
| `expense_lines` | `quantity >= 0`, `unit_price >= 0` |
| `inventory_balances` | `quantity_on_hand >= 0`, `quantity_reserved >= 0` |
| `stock_transfer_lines` | `quantity_requested >= 0`, `quantity_dispatched >= 0`, `quantity_received >= 0` |
| `stock_movements` | `quantity <> 0` (NEGATIVE is legal — the app encodes direction as sign, e.g. issues/sales; only zero is rejected) |

**Legacy-data safety:** constraints are added `NOT VALID`, then validated. On
a clean DB validation passes immediately. If pre-React legacy rows violate,
the migration logs a WARNING and leaves that constraint `NOT VALID` (still
fully enforced for new writes) instead of aborting the deploy; verification
queries are included in the migration comments.

**Verified (DB):** negative invoice quantity, negative unit_price, negative
expense quantity, negative `quantity_on_hand`, negative `quantity_reserved`,
zero stock movement → all rejected with SQLSTATE 23514; negative stock
movement (−3) accepted (direction encoding). Audit assertions flipped
FAIL→PASS.

---

## 6. A-05 — VAT constant centralisation (P2)

- New `src/lib/vat.ts`: `VAT_STANDARD_RATE = 0.175`, `VAT_STANDARD_RATE_PERCENT = 17.5`.
- Replaced the 4 rate sites (`IncomePage`, `ExpensesPage` ×2,
  `QuickExpenseMobile`) and 4 display labels ("VAT 17.5%" option labels,
  "VAT (17.5%)" summary rows, "Amount includes VAT (17.5%)").
- **Rate verification (2026-08-16):** Malawi's standard VAT rate is 17.5%,
  effective January 2026 (2025/26 budget raised it from 16.5%). The product
  value is therefore correct; no value change was made — only centralisation,
  so the next statutory change is a one-line edit.
- `vat.test.ts` 2/2 locks the contract.

---

## 7. A-06 — staging Vercel deploy (OPEN — user action)

**Facts (from GitHub run history, jobs API):**
- Every `main` push since **13:58 UTC** fails at exactly the step
  "Deploy frontend to Vercel (staging)". All earlier steps (incl. local
  `npm run build`) pass.
- The 15:00 UTC `workflow_dispatch` PRODUCTION deploy succeeded end-to-end
  with the identical workflow mechanics — so the failure is specific to the
  staging project.
- `VERCEL_PROJECT_ID_STAGING` = `prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9` (the new
  Phase 8A.1 project). The last successful staging deploy (13:15 UTC) ran
  before this project was wired in. **Timing strongly implicates the new
  staging project itself.**

**Most likely causes (in order):**
1. The new project lives under a different Vercel account/team than
   `team_ABA9J00MCqgkKSmDAWvrnr5b` → the deploy token (team-scoped) can't see it.
2. Project settings (framework preset / build command / output directory)
   differ from the working project `prj_hMyLCYtJzeTD1bpOl8D9sEdszAYn`.
3. The project id string is wrong/typo'd.

**Required user steps (sandbox cannot reach Vercel):**
1. Vercel dashboard → confirm `prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9` exists and
   is under the SAME team as the token (`team_ABA9J00MCqgkKSmDAWvrnr5b`).
   If it was created while logged into a personal account, move it into the
   team (or create a fresh project from inside the team).
2. Compare Settings → General with the working project (Framework Preset:
   Vite; Build Command: `npm run build`; Output: `dist`).
3. Rename the project to `ledgr-react-staging` (its current URL
   `ledgr-react-prod.vercel.app` is confusing and conflicts semantically with
   production) and update `APP_URL_STAGING` / `ALLOWED_ORIGINS_STAGING` in
   GitHub repo variables to `https://ledgr-react-staging.vercel.app` (note:
   the current value has a trailing slash — remove it).
4. Read the failed step log in the GitHub UI (Actions → Deploy → run → the
   red "Deploy frontend to Vercel (staging)" step). The sandbox's log API
   returns EOF for these runs, so the exact error text is only visible in
   the UI. Paste it here if the above doesn't resolve it.
5. Re-run: `Actions → Deploy → Run workflow → environment: staging`.

---

## 8. Verification summary (all on disposable PostgreSQL, 65 migrations)

| Suite | Result |
|---|---|
| Replay (fresh DB) | 65/65 OK |
| `phase10_remediation` (new) | **16/16 PASS** |
| `phase10_integrity` (audit suite) | **11/11 PASS** (was 8/11; A-03/A-04 assertions flipped) |
| `rpc_reconstruction` | 20/20 PASS |
| `rls_security` | 41/41 PASS |
| `storage_reconstruction` | 8/8 PASS |
| `workflow_accounting` | 16/16 PASS |
| `paye_reference` | 10/10 PASS |
| `view_reconstruction` | 7/7 PASS (pre-existing documented partial unchanged) |
| Unit (vitest) | 236/236 PASS (incl. 6 new) |
| Typecheck / lint / build | PASS (build guard verified both ways) |

No test was downgraded: every previously-failing audit assertion either
passes now (A-03/A-04) or is marked BLOCKED (browser items).

---

## 9. Certification

**Phase 10 certification remains 🟡 YELLOW — conditionally ready.**

The P0 root cause (A-01) is now guarded, and all P1/P2 code/database findings
(A-02…A-05) are closed with regression evidence. Two items keep the
certification below GREEN:

1. **A-06 staging deploy is still failing** — the staging environment is not
   actually serving the current build, so the app has no hosted-staging
   surface for the mandatory browser regression journeys (A-09…A-12).
2. **Browser-only verification remains BLOCKED** — discount UI/PDF
   reconciliation (5-layer), PDF download on Chrome/Safari, UI tenant
   matrix, AI, and offline journeys cannot be executed from this sandbox.

Once A-06 is resolved by the user (Vercel team/project check) and the
browser journeys A–M from `phase-9-browser-test-script.md` pass on hosted
staging, the certification can be upgraded to GREEN.

---

## 11. Production deploy incident (2026-08-19) — amount_due is GENERATED in production

**Symptom:** the first production run of `20260817000000_phase10_amount_due_trigger.sql`
failed at its backfill statement:

```
ERROR: column "amount_due" can only be updated to DEFAULT (SQLSTATE 428C9)
Column "amount_due" is a generated column.
```

**Root cause — schema divergence between production and the reconstructed base:**
the ORIGINAL production schema defines `invoices.amount_due` as a **generated
column** (`GENERATED ALWAYS AS (total_amount - amount_paid) STORED`); the
reconstructed base schema (and therefore staging + fresh replays) has it as a
plain nullable numeric. The Phase 10.1 A-03 migration assumed the plain shape,
so its backfill `UPDATE` violated 428C9 on production. (The capture's
`generated_columns.json` only listed the `exchange_rate_used` generated
columns — `amount_due`'s generated status was lost in the reconstruction.)

**Fix (PR #112):** the migration is now **schema-aware and idempotent**:
- `amount_due` **GENERATED** (production): the column self-maintains — no
  trigger, no backfill. Any leftover `trg_invoices_sync_amount_due` from a
  partial apply of the old migration is **dropped** (a BEFORE trigger
  assigning to a generated column would fail EVERY invoice write with 428C9),
  and the helper function is removed.
- `amount_due` **PLAIN** (staging/fresh): trigger installed + backfill run,
  exactly as before.

**Verified (disposable PostgreSQL, 66-migration replay):** `phase10_remediation`
**20/20** (4 new A-03b tests cover the generated-column branch: leftover
trigger dropped, insert computes amount_due, payment updates recompute,
idempotent re-run); all other suites green (integrity 11, subtype repair 8,
rls 41, rpc 20, storage 8, workflow 16, paye 10).

**Action taken on production:** re-run the deploy (`v*` tag or
`workflow_dispatch` → production) — the failed migration was not recorded as
applied, so `db push --include-all` re-applies the fixed file, then proceeds
through `20260817000001` (CHECKs), `20260817000002` (discount-account
backfill) and `20260819000000` (15xx subtype repair). If invoice creation in
production was failing with 428C9 before the re-run, that was the leftover
trigger from the aborted run — the fixed migration removes it.
