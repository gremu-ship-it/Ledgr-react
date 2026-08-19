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
| A-06 | P2 (ops) | Staging frontend Vercel deploy failing | **CLOSED 2026-08-19** | Root cause: stale `VERCEL_TOKEN` secret. Token rotated → staging deploy fully green (frontend + DB migrations), run 32277346045 |
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

## 7. A-06 — staging Vercel deploy (CONFIRMED — project lives in the wrong account)

**Confirmed root cause (2026-08-19, from the failed step log):**

```
Error: Project not found ({"VERCEL_PROJECT_ID":"prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9","VERCEL_ORG_ID":"team_ABA9J00MCqgkKSmDAWvrnr5b"})
```

**The project id `prj_AFg…` is correct for the staging app** (confirmed by the
owner on 2026-08-19) — so this is an **account/org mismatch, not a wrong id**:
the CLI looks up `prj_AFg…` inside the org `team_ABA9J00…` (the `gremu` team,
whose slug appears in the working production project's URLs) and does not find
it there. That means the staging project **lives under a different Vercel
account** (most likely the owner's personal account, because the project was
created while logged in there, or a different team). The same token deploys
production fine (`prj_hMyL…` + `team_ABA9J00…` → `vercel.com/gremu/ledgr-react`),
so the token/team are not the problem — only the account the staging project
belongs to.

**How to confirm (30 seconds):** open the staging project in the Vercel
dashboard. The URL slug before the project name is the account that owns it:
`vercel.com/gremu/…` = the `gremu` team (works), `vercel.com/<your-username>/…`
= your personal account (this is the mismatch). Also note the repo's GitHub
integration shows a project named `ledgr-react-prod` in team `gremu` that
deploys previews — if that is the real staging project, its id is the one to
use (dashboard → Settings → General → Project ID).

**CLOSED 2026-08-19 — verified green end-to-end:** after the owner rotated
`VERCEL_TOKEN` in GitHub, the staging workflow run 32277346045 (commit
`4c1aa41`, main incl. #109 fixed-assets + #110 CORS) completed **success**
through every step: Build → Vercel deploy → **Link & migrate staging DB**
(Phase 10.1 + 10.2 migrations applied, incl. the 15xx subtype repair) →
edge-function secrets → edge functions. Staging is now live with the
current main at https://ledgr-react-prod.vercel.app.

**Root cause: stale `VERCEL_TOKEN` secret in GitHub.**
With a freshly created token the owner ran `vercel deploy --prod` from the
repo checkout and it **succeeded** (Inspect
`vercel.com/gremu/ledgr-react-prod/qXxArpY1…`, Production
`ledgr-react-prod-edg024aga-gremu.vercel.app`, **Aliased
`ledgr-react-prod.vercel.app`**, Ready in 43s). The same token earlier
resolved `GET /v9/projects/prj_AFg…?teamId=team_ABA9J00…` via the Vercel API,
and the GitHub `staging` environment has no secrets/variables that could
override the repository values. Every variable in the chain (id, org, repo
variables, environment overrides) was verified correct — leaving only the
**`VERCEL_TOKEN` secret** (created 3 weeks ago, before the staging project
existed) as the failure point: the CLI printed the (correct) id and org but
never the token, and a stale/rotated/personal-account token returns
"Project not found" for a team project exactly as observed.

**Fix (owner):** GitHub → Settings → Secrets and variables → Actions →
Secrets → `VERCEL_TOKEN` → Update with a working token (the one just proven,
or a fresh one), then re-run `Deploy → Run workflow → environment: staging`
(or push to main). Note the token pasted into chat should be rotated after
staging is confirmed green.

**Update 2026-08-19 (evidence chain complete — id and team are BOTH correct):**
the owner pasted the staging project's deployment card — project **in the
`gremu` team**, deployment `ledgr-react-staging-ip4ms2few-gremu.vercel.app`,
domain `ledgr-react-prod.vercel.app`, status **Ready** — and then the project
settings page: `vercel.com/gremu/ledgr-react-prod` → **Project ID
`prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9`**. So the id in the variable and the
project in the team MATCH the dashboard exactly, and the production deploy
works with the same `VERCEL_ORG_ID`/token. Yet the CLI still returns
"Project not found". The failure must therefore be in **what the workflow
actually receives**, not in Vercel. GitHub Actions precedence is the prime
suspect: for a job with `environment: staging`, **environment-level secrets
and variables override repository-level ones**, and **organization-level
variables override repository-level ones**. If the `staging` environment (or
an organization) carries its own `VERCEL_TOKEN`, `VERCEL_ORG_ID` or
`VERCEL_PROJECT_ID_STAGING` — e.g. a token created while logged into the
owner's personal account, or a stale id — the staging job silently uses
THAT value, producing exactly this error while repository values look
perfect.

**Checklist (owner, in order):**
1. GitHub → Settings → **Environments** → `staging` (and `Production`) →
   inspect **Environment secrets** (`VERCEL_TOKEN`) and **Environment
   variables** (`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_STAGING`, …). Any value
   there overrides the repository values for the staging job.
2. GitHub → Settings → **Organization** → Secrets and variables → check the
   same names at org level (org overrides repo).
3. Re-type the repository variable `VERCEL_PROJECT_ID_STAGING` from scratch
   (delete + re-add) — a trailing newline/space pasted from a code block
   breaks id matching.
4. Decisive local test with a FRESH token (Vercel → Account Settings →
   Tokens → create):
   ```bash
   npm i -g vercel
   vercel inspect prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9 --token <NEW> --scope team_ABA9J00MCqgkKSmDAWvrnr5b
   ```
   - resolves → the Actions-side values (env/org overrides, whitespace, or
     the token secret itself) are the problem;
   - "not found" without `--scope` but found with it → project lives in the
     personal account, not gremu (two same-named projects exist).

**Fix (pick one):**

1. **Move the staging project into the `gremu` team (keeps `prj_AFg…`):**
   Vercel dashboard → open the staging project → Settings → General →
   **Move Project** → choose the `gremu` team. The id stays `prj_AFg…`, the
   URL stays `ledgr-react-prod.vercel.app`, and the existing
   `VERCEL_PROJECT_ID_STAGING` variable starts working with no other change.
2. **Use the id of the project that already exists in `gremu`:**
   `vercel.com/gremu/ledgr-react-prod` → Settings → General → **Project ID**,
   then set **`VERCEL_PROJECT_ID_STAGING`** to that `prj_…` value
   (GitHub → Settings → Secrets and variables → Actions → Variables).
3. **Create a fresh staging project inside the `gremu` team** (also fixes the
   confusing `ledgr-react-prod` name): switch the dashboard to team `gremu` →
   New Project → import the repo → name it `ledgr-react-staging` → Framework
   **Vite**, Build **`npm run build`**, Output **`dist`** → use its new id in
   `VERCEL_PROJECT_ID_STAGING` and update `APP_URL_STAGING` /
   `ALLOWED_ORIGINS_STAGING` to `https://ledgr-react-staging.vercel.app`
   (drop the trailing slash).

Then re-run: Actions → Deploy → Run workflow → environment: `staging`
(or push to main).

**After staging deploys:** the "Link & migrate staging database" step will
apply the Phase 10 + 10.2 migrations to staging Supabase
(`bkxzgkurcqvccsdjmqzg`), including the 15xx fixed-asset subtype repair
(logged via `RAISE NOTICE` in the deploy output). Confirm
`SUPABASE_DB_PASSWORD_STAGING` matches the rotated staging DB password
before running, or that step will fail at `supabase link`.

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

## 10. Repository-variable audit (2026-08-19) — pre-deploy checklist

User supplied the full Repository-variables list. Findings:

| Variable | Value | Verdict |
|---|---|---|
| `VERCEL_ORG_ID` | `team_ABA9J00MCqgkKSmDAWvrnr5b` | ✅ correct (deploy token's team) |
| `VERCEL_PROJECT_ID_PROD` | `prj_hMyLCYtJzeTD1bpOl8D9sEdszAYn` | ✅ correct (production deploys work) |
| `VERCEL_PROJECT_ID_STAGING` | `prj_AFgEgjFL7NTWoyFLKlkGlHlOv0V9` | ⚠️ correct **id**, but "Project not found" in the org → the staging project lives in a **different Vercel account** (likely the owner's personal account). Move it into the `gremu` team (Settings → General → Move Project), or use the id of the project that already exists in `gremu`, or create a fresh one in the team. |
| `VITE_SUPABASE_URL_STAGING` | `https://bkxzgkurcqvccsdjmqzg.supabase.co` | ✅ correct (staging ref) |
| `VITE_SUPABASE_URL_PROD` | **MISSING** | ❌ **blocks the next production deploy**: deploy.yml reads `vars.VITE_SUPABASE_URL_PROD`; with the Phase 10.1 prebuild env guard in main (#108), an empty value fails "Build frontend" at `npm run build`. Add it: `https://hsuhuvuxfuufrlejsatw.supabase.co` (prod ref `hsuhuvuxfuufrlejsatw`). |
| `VITE_SUPABASE_ANON_KEY_PROD` | (secret, not in this list) | ⚠️ confirm it still exists — required for the same reason. |
| `ALLOWED_ORIGINS_STAGING` / `APP_URL_STAGING` | `https://ledgr-react-prod.vercel.app/` | ⚠️ trailing slash: browsers send `Origin` without one; the edge-function allowlist matched exactly, so **all staging edge-function calls failed CORS**. Fixed in code (PR #110 strips trailing slashes); still worth removing the slash from the values. |
| `ALLOWED_ORIGINS_PROD` / `APP_URL_PROD` | `https://ledgr-react.vercel.app` | ✅ clean |
| `SUPABASE_PROJECT_REF` (legacy) | `hsuhuvuxfuufrlejsatw` | ℹ️ unused by deploy.yml (which uses `_STAGING`/`_PROD`) — removable. |

**Suggested fix order:** (1) add `VITE_SUPABASE_URL_PROD`; (2) move/point the staging Vercel project into the `gremu` team; (3) clean the two staging trailing slashes; (4) re-run staging deploy (watch "Link & migrate staging database" — `SUPABASE_DB_PASSWORD_STAGING` must match the rotated staging DB password); (5) merge #109 + #110, then tag `v*`/dispatch production and approve the environment gate.

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

---

## 12. Fixed-assets saga — full resolution (2026-08-19)

**Symptom:** Eagle Nova Horizon Holdings (IFRS) showed **zero** Non-Current
Assets in production while GAAP businesses were fine; staging worked.

**Diagnosis chain (each step ruled out the previous theory):**
1. Subtypes wrong? → No — all 15xx/13xx accounts `fixed_asset`/`non_current_asset`.
2. Journal data missing? → No — SQL replica returned 23,850,000 across
   1331/1343/1511 (posted, correct business_id, within date).
3. Cache / PWA? → No — incognito still zero.
4. Deployed bundle? → No — production ran the #109 code.
5. **Root cause — PostgREST silent 1000-row truncation:** Eagle Nova has
   **1,641** journal lines; the app's balance query (no `.range()`) silently
   dropped everything past row 1000 — the 2023–2025 fixed-asset
   capitalisation lines — so Non-Current Assets read 0.00 while Current
   Assets (recent lines inside the window) still showed.
6. **Second bug in the first fix:** pagination fetched page 1 unordered and
   pages 2+ ordered by `id` (random UUIDs) → windows didn't partition the
   data → 1331/1343 skipped while 1511 (by luck in page 1) showed. Fixed by
   applying `ORDER BY id` to the base query before the first fetch.

**Fixes (all merged, production green):**
- #114: `computeBalances` paginates (SOFP).
- #116: consistent `ORDER BY id` across all pages (hotfix).
- #115: the same pagination pattern applied to the other 5 unbounded
  `journal_lines` reads (P&L, FX integrity, Branch Performance, period
  close, AI analysis, inventory ledger) via shared `src/lib/paginateQuery.ts`.

**Verified in production:** Eagle Nova's SOFP now shows **23,850,000**
Non-Current Assets (1331 Motor Vehicles 14.5M, 1343 Computer Equipment
0.85M, 1511 Land 8.5M). User confirmed "23m all assets showing".

**Regression risk closed:** any business with > 1000 journal lines was
silently under-reporting in those reports; all such reads now page correctly.
