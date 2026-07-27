# Ledgr-react — Error Analysis

Date: 2026-07-27 · Branch: `arena/019fa41c-ledgr-react` (from `main` @ `d2168ef`)

Commands run: `npm install`, `npx tsc -b`, `npm run lint`, `npm run build`, `gh run list/view`.

| Check | Result |
|---|---|
| `tsc -b` (typecheck) | ✅ passes, 0 errors |
| `vite build` | ✅ passes (1 perf warning) |
| `eslint .` | ❌ **24 errors, 2 warnings** |
| GitHub Actions "NodeJS with Webpack" | ❌ **fails on every push/PR** (all 3 node versions) |
| GitHub Actions "Deploy Supabase" | ✅ passes |

There are also **silent runtime errors** (queries against columns/tables that don't exist) that neither the compiler nor the linter can see. Those are the most serious findings.

---

## 1. CI is red — the webpack workflow is bogus (highest priority, easiest fix)

`.github/workflows/webpack.yml` runs:

```yaml
- name: Build
  run: |
    npm install
    npx webpack
```

This project is **Vite + TypeScript**. There is no `webpack` dependency, no `webpack.config.js`, and no webpack entry point. `npx webpack` tries to fetch `webpack@5.x` on the fly and then fails with no config. That's why *every* run since the workflow was added is red (runs `30261408532`, `30259211276`, `30252762345`, `30250757381`, …). The failures are 100 % workflow-authoring noise — they say nothing about the code.

Two secondary problems in the same file:
- Matrix includes **Node 18.x**, but `vite@8` declares `engines: ^20.19.0 || >=22.12.0`. Node 18 could never build this app. The 18.x leg is what cancels the 20.x/22.x legs (`The strategy configuration was canceled because "build._18_x" failed`).
- The workflow never runs `tsc`, `eslint`, or `vite build`, so the checks that *would* catch real regressions aren't in CI at all.

**Fix:** replace the workflow body with `npm ci && npm run lint && npm run build`, drop Node 18, and rename it (it isn't webpack). Optionally add `npm ci` caching via `actions/setup-node`'s `cache: npm`.

---

## 2. ESLint: 24 errors, all `@typescript-eslint/no-explicit-any`

`npm run lint` exits 1. The repo has a well-established convention of documenting each legitimate `any` with an inline `eslint-disable-next-line … -- reason` comment (see `BaseRepository.ts`, `BankReconciliation.tsx`). These 24 sites simply skipped that step. Breakdown:

| File | Errors | Root cause |
|---|---|---|
| `src/lib/aiFinancial.ts` | 7 | Queries untyped/nonexistent relations + `rawData?: any` |
| `src/components/dashboard/JournalEntryDetailModal.tsx` | 7 | Reaches into `(repos as any).account.client` to hit `departments` |
| `src/dal/repositories/PartnerRepository.ts` | 5 | White-label tables absent from generated `Database` type |
| `src/dal/repositories/PartnerBillingRepository.ts` | 2 | same |
| `src/dal/repositories/PartnerClientRepository.ts` | 1 | same |
| `src/dal/repositories/BusinessRepository.ts` | 1 | `partner_clients` join through untyped client |
| `src/components/reports/CashFlowStatement.tsx` | 1 | `(row: any)` although `v_cash_flow` **is** typed |

Not all of these are equal:

- **`CashFlowStatement.tsx:52`** — pure noise. `v_cash_flow` exists in `database.generated.ts` and the same file already uses `Row<'v_cash_flow'>` at line 95. Just delete the `: any`; inference works.
- **Partner repositories (8 errors)** — the `any` is *deliberate* and correct in spirit (the white-label tables really aren't in the generated types), but it's undocumented. Real fix: regenerate types (see §4) so `partners`, `partner_clients`, `partner_admins`, `partner_feature_flags`, `partner_invoices`, `v_partner_client_usage` are typed, then delete the untyped `db` shims. Interim fix: add the documented `eslint-disable-next-line` used elsewhere in the DAL.
- **`JournalEntryDetailModal.tsx` (7 errors)** — this one is an actual code smell, not just a lint nit. See §3.
- **`aiFinancial.ts` (7 errors)** — masks the runtime bug in §4.

### Two `react-hooks/exhaustive-deps` warnings

`src/hooks/useInactivityTimeout.ts:63` and `:104` — `getInactivityMs` is a plain function recreated each render, so it can't go in a dep array as-is. The code compensates by listing `inactivityTimeoutMinutes` directly at line 63 (correct behaviour, wrong lint shape). Wrap `getInactivityMs` in `useCallback([inactivityTimeoutMinutes])` and list it; the warnings disappear and the effect at :104 stops silently reading a stale timeout after a settings change.

---

## 3. `JournalEntryDetailModal.tsx` bypasses the DAL

Lines 58, 123, 141 do:

```ts
await (repos as any).account.client.from('departments')…
```

Three problems stacked:

1. `client` is `protected` on `BaseRepository` — the `as any` exists purely to **defeat an access modifier**. `BaseRepository` already exposes a public `get db()` accessor for exactly this (used correctly in `NewJournalEntryModal.tsx`, `ExpensesPage.tsx`, etc.).
2. A `DepartmentRepository` already exists and `repos.department.findActive(businessId)` is a **byte-for-byte match** for the hand-rolled query in the modal's `queryFn`. Line 51 right above it correctly does `repos.branch.findActive(...)`. So the whole block is a duplicate of existing DAL code.
3. Because it goes through `any`, `departments` is `any[]`, forcing four more `as any[]` casts downstream (lines 263, 265, 296) and losing all column typing.

**Fix:** `queryFn: () => repos.department.findActive(data!.entry.business_id)` and delete every `any` in the file except the two writes, which should move to `repos.journal.db` / a repository method.

---

## 4. Silent runtime failures — queries against columns and tables that don't exist

This is the part `tsc` cannot catch, because the code casts the table name (`.from('journal_entries' as any)`) which disables Supabase's column checking. I cross-checked every `.from(...).select(...)` in `src/` against `database.generated.ts`:

### 4a. `journal_entries.total_debits` / `total_credits` do not exist

`src/lib/aiFinancial.ts` lines 122, 213 select `total_debits` / `total_credits` from `journal_entries`. The generated `journal_entries.Row` has no such columns (they're on the **`v_trial_balance` view**, keyed by account, not entry). Debit/credit totals for an entry live in `journal_lines.amount_base` + `is_debit` — which is exactly how `JournalRepository.ts:86-92` computes them.

Consequences, all silent:

- `detectAdvancedAnomalies()` — PostgREST returns error 42703 ("column does not exist"); `data` is `null`, `entryList` is `null`, and the guard `if (!entryList …) return anomalies` returns `[]`. **Anomaly detection has never fired.**
- `generateCashFlowForecast()` — same error, but there's **no try/catch and no error check**; `movements` is `null`, so `dailyNet` is `0/90 = 0` and the 60-day forecast is a **flat line at current cash**, with `negativeAlert` permanently `false`. It renders as a confident, plausible-looking, entirely fabricated forecast. This is the most dangerous bug in the repo: a wrong number shown as if correct.
- `buildRichBusinessContext()` — the `journal_entries` result is destructured into a hole (`const [invoices, expenses, , accounts]`), so that query is dead weight; also `cashBalance` uses `accounts.opening_balance` (an opening figure, not a live balance), so the AI context reports a stale cash position.

### 4b. `v_profit_loss_summary` does not exist anywhere

`aiFinancial.ts:264` queries it. It appears in **no migration** and in **no generated type** — grep finds exactly one hit in the entire repo, the call site itself. `.single()` on a missing relation throws, the surrounding `catch { return []; }` swallows it, and `getTaxPlanningSuggestions()` always returns `[]`.

Note this only surfaces within 60 days of 31 December (line 260 early-returns otherwise), so it will look "fine" for most of the year and then quietly do nothing in Q4 — the one time the feature matters.

### 4c. Tables missing from the generated types

Present in migrations, absent from `database.generated.ts`: `api_keys`, `webhooks`, `webhook_deliveries`, `partners`, `partner_admins`, `partner_clients`, `partner_feature_flags`, `partner_invoices`, `v_partner_client_usage`.

These work at runtime (the migrations create them) but every consumer has to launder them through an untyped client — the direct cause of the 8 partner-repo lint errors and a standing risk of another 4a-style column typo. **`database.generated.ts` is stale relative to `supabase/migrations/`** and needs regenerating.

### 4d. `v_partner_client_usage` may leak across partners

`20260727000004_white_label_partners_hardening.sql:260` creates the view **without `security_invoker = true`** (compare `20260726000000_v_cash_flow_view.sql:28`, which sets it correctly). Postgres views default to `security_definer` semantics, so the view runs with its **owner's** privileges and the underlying RLS on `partner_clients` / `businesses` is *not* applied — despite the view's own comment asserting "Underlying tables keep their own RLS, so a partner admin only ever sees their own clients."

The only remaining guard is `.eq('partner_id', partnerId)` in `PartnerRepository.getClientUsage()` — a client-supplied filter. Any authenticated user can call the view with a different `partner_id`. **Treat as a tenant-isolation bug**, not a style issue. Fix: `create or replace view public.v_partner_client_usage with (security_invoker = true) as …`.

---

## 5. Build warning — 504 kB main chunk

`dist/assets/index-*.js` is 503.94 kB (145 kB gzip) in a single chunk. Not an error, but for a PWA targeting Malawian mobile networks it's worth route-level `React.lazy` splitting — `recharts`, the reports pages, and `AiInsightsPage` are the obvious candidates and are not needed on first paint.

---

## Recommended order of work

1. **`v_partner_client_usage` `security_invoker`** — data-isolation bug, one-line migration.
2. **`journal_entries.total_debits/total_credits`** — rewrite the two `aiFinancial.ts` queries to aggregate `journal_lines(amount_base, is_debit)`; add real error handling to `generateCashFlowForecast` so it fails visibly instead of returning a flat fake forecast.
3. **`v_profit_loss_summary`** — either add the view in a migration or compute P&L via `FinancialStatementRepository`; stop swallowing the error.
4. **Fix the CI workflow** — `npm ci && npm run lint && npm run build`, drop Node 18. Without this, nothing above is enforced.
5. **Regenerate `database.generated.ts`** from current migrations; delete the untyped `db` shims in the four partner repos.
6. **`JournalEntryDetailModal`** — use `repos.department.findActive` and `repos.*.db`; drop all 7 `any`s.
7. **`CashFlowStatement.tsx:52`** `any` and the two `useInactivityTimeout` dep warnings — trivial cleanups to get `eslint` to exit 0.

Note that items 2–3 will *change displayed numbers* (anomalies and forecasts that currently render as empty/flat will start producing real output), so they want a review pass on the AI Insights page after the fix.

---

# Resolution log (2026-07-27)

All items above were addressed on `arena/019fa41c-ledgr-react`, except item 5,
which was attempted and deliberately reverted — see below.

| # | Item | Status |
|---|---|---|
| 1 | `v_partner_client_usage` tenant isolation | Fixed — migration `20260727000008` |
| 2 | `journal_entries.total_debits/credits` | Fixed — aggregate from `journal_lines` |
| 3 | `v_profit_loss_summary` missing | Fixed — uses `FinancialStatementRepository` |
| 4 | CI workflow | Fixed — `webpack.yml` replaced with `ci.yml` |
| 5 | 504 kB bundle | **Attempted, reverted** — made it worse |
| 6 | `JournalEntryDetailModal` DAL bypass | Fixed |
| 7 | Remaining lint errors/warnings | Fixed — `eslint` exits 0 |

Verification: `npx tsc -b` clean, `npm run lint` exits 0 (was 24 errors +
2 warnings), `npm run build` succeeds.

### On item 1 — why the view keeps owner rights

The obvious fix (`security_invoker = true`, matching `v_cash_flow`) would close
the leak but silently zero every count. The roll-up reads `journal_entries`,
`invoices` and `business_users` for client businesses, and a partner admin
deliberately has no row-level read access to those tables — under invoker
rights the subselects return 0 rather than erroring. The migration therefore
keeps owner rights and enforces the tenant check inside the view body via
`is_partner_admin(auth.uid(), pc.partner_id)`, which also covers platform
admins. That predicate is load-bearing; the view comment says so.

### On items 2 and 3 — these change displayed numbers

Both features previously rendered as empty or flat because their queries
errored and the errors were swallowed. They now return real data:

- Anomaly detection had **never** fired. It will now surface large
  transactions, same-day duplicates and income gaps.
- The cash-flow forecast previously drew a **flat line at current cash** with
  the negative-balance alert permanently off. It now projects a real run-rate
  and can legitimately trigger the red alert on `/ai`.
- Tax planning suggestions returned `[]`; they now compute from year-to-date
  profit before tax.

Three related corrections went in alongside:

- **Cash position** came from summing `accounts.opening_balance`, a
  period-opening figure that ignores all subsequent movement. Now computed
  from the ledger via `FinancialStatementRepository.getCashPosition()`.
- **Forecast denominator** was hardcoded to 90 days regardless of how much
  history existed, diluting the run-rate for newer businesses. Now uses the
  actual observed window.
- **Confidence band** was `balance * 0.82 / 1.18`, which inverts once the
  balance goes negative — exactly when the forecast matters. Now anchored to
  the magnitude of projected movement and widened with the horizon.

`generateCashFlowForecast` now propagates errors instead of returning a
fabricated forecast, so `AiInsightsPage` uses `Promise.allSettled` and shows an
explicit "forecast unavailable" notice rather than blanking the other panels.

### On item 5 — route splitting made the bundle worse, so it was reverted

Route-level `React.lazy` splitting was implemented for ~30 heavy routes and
then backed out after measurement:

| | Total JS | Chunks | Initial critical path |
|---|---|---|---|
| Baseline | **504 kB** | 1 | 504 kB |
| Route-split | 1,995 kB | 62 | 1,082 kB |
| Split + explicit vendor/shared groups | 2,017 kB | 44 | ~1,293 kB |

Vite 8 uses rolldown, which inlines a copy of a shared module into every chunk
importing it unless the module clears an internal size threshold. This
project's shared helpers (formatters, DAL repositories, i18n) are individually
small, so they were duplicated into 13-30 chunks each. `business_id` appeared
in 27 chunks, the `en-MW` formatter in 18. Explicit `codeSplitting.groups` for
vendor and shared app code reduced the chunk count but not the duplication, and
the initial critical path stayed ~2.5x worse than the single bundle.

`codeSplitting` already defaults to `true` on rolldown 1.0.3, so the fix the
build warning suggests is a no-op here. Splitting this app is worth revisiting,
but it needs either a rolldown version that hoists small shared modules or
manual chunk boundaries drawn around the shared layer — not a mechanical
`React.lazy` pass, which measurably regresses the metric it aims to improve.
The 504 kB single bundle is left in place and the warning stands.

### Follow-up not done here

`src/dal/types/database.generated.ts` is still stale — it is missing 10
relations that exist in `supabase/migrations/`. Regenerating it needs database
access (`supabase gen types typescript --project-id <ref>`), which this
environment does not have. As a stopgap, `database.supplement.ts` hand-declares
those tables/views with their real columns and foreign keys, and `database.ts`
merges them into `Database`. That is what let the four partner repositories,
`ApiKeyService` and `WebhookService` drop their untyped `from: (t: string) =>
any` shims and become type-checked. Once the types are regenerated, delete the
supplement and its merge — the intersection will surface any drift.

Typing those tables immediately paid off: it exposed that `v_cash_flow.period`
is nullable, so the XBRL export in `CashFlowStatement.tsx` had been emitting
`null` fact dates. Rows without a period are now skipped.
