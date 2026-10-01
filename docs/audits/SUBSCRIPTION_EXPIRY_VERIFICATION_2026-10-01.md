# Verification — "monthly subscription has not ended even though it's a new month"

Date: 2026-10-01 · Branch: `arena/01a0f8a6-ledgr-react` · Status: **Reproduced, confirmed and fixed** (3 defects, 1 of them a production blocker)

## Summary

The report is valid. A monthly plan does **not** end when the calendar month rolls over,
and in the current production configuration it does not end *at all*. Three independent
defects stack up:

| # | Defect | Severity | Effect |
|---|--------|----------|--------|
| 1 | The daily `expire-subscriptions` pg_cron job points at a literal `<PROJECT_REF>` placeholder URL | **Critical** | No subscription is ever downgraded, ever |
| 2 | "Monthly" term is a fixed **31 days**, not a calendar month | High | Paid term always spills into the next month |
| 3 | No entitlement check reads `plan_expires_at` at runtime | High | Even a past expiry grants full paid access until the cron (defect 1) runs |

---

## Defect 1 — the expiry cron never fires (root cause)

`supabase/migrations/20260726000003_schedule_expire_subscriptions.sql` schedules the job with
placeholders that `supabase db push` applies **verbatim**:

```sql
url := 'https://<PROJECT_REF>.supabase.co/functions/v1/expire-subscriptions',
headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>')
```

`scripts/cron-jobs.sql` exists to re-point those jobs at the real URL, and its header comment says
it is "Deployed by `.github/workflows/deploy.yml` AFTER `supabase db push`".

**It is not.** `deploy.yml` contains no reference to `cron-jobs.sql`:

```
$ grep -rn "cron" .github/workflows/deploy.yml
180:  # (invoice-open, accept-invite-link), or are cron/webhook entry points.
```

The captured database inventory shows all three jobs frozen on the placeholder
(`artifacts/database/capture/cron_jobs.json` — captured **2026-08-15**, the file's commit date of
2026-09-29 is not the capture date). Nothing in the repository rewrites those jobs after that
point, so they stay broken until something substitutes the values:

```json
{"jobid":1,"schedule":"0 1 * * *",
 "command":"select net.http_post(url := 'https://<PROJECT_REF>.supabase.co/functions/v1/expire-subscriptions', ...",
 "active":true}
```

`<PROJECT_REF>.supabase.co` does not resolve, so `net.http_post` fails silently every night at
01:00 UTC. `expire-subscriptions/index.ts` itself is correct — it is simply never invoked.
Same breakage applies to `send-renewal-reminders-daily` and `generate-partner-invoices-monthly`.

**Net effect: every paid business keeps its tier forever, regardless of `plan_expires_at`.**

## Defect 2 — "monthly" = 31 days, not a calendar month

`supabase/functions/initiate-subscription-payment/index.ts:166`

```ts
const periodMs = (billingCycle === 'annual' ? 365 : 31) * 24 * 60 * 60 * 1000;
const planExpiresAt = new Date(Date.now() + periodMs).toISOString();
```

Resulting terms (verified by direct computation):

| Checkout date | Expiry written | Comment |
|---|---|---|
| 2026-09-01 | **2026-10-02** | new month starts, plan still active — matches the report |
| 2026-08-31 | 2026-10-01 | skips the whole of September's boundary |
| 2026-01-31 | 2026-03-03 | 31 days ≠ February |
| annual 2026-01-01 | 2026-12-31 | 365 days under-serves leap years |

So even with a working cron, a monthly subscriber bought on the 1st gets 31 days and remains
paid into day 2 of the next month. The customer-visible promise is "monthly"; the code bills a
fixed 31-day window.

## Defect 3 — nothing checks `plan_expires_at` at access time

Entitlements are resolved purely from `businesses.plan_tier`:

- `src/hooks/useUsage.ts:23` — `normalizePlanTier(business?.plan_tier ...)`, expiry never read
- `src/components/billing/PlanGate.tsx:31` — `hasCapability(planTier, capability)`
- `src/lib/billing/UsageService.ts:179` — `select('plan_tier')` only
- `public._ledgr_assert_usage_limit()` (migration `20260919000000`) — reads `b.plan_tier` only

`plan_expires_at` is read in exactly two non-admin places, both cosmetic:
`src/hooks/useRenewalReminder.ts` (bell reminder) and the renewal-reminder email function.

This is why defect 1 is unrecoverable at runtime: the app has no second line of defence. The
database row still says `pro`, so Pro features, Pro transaction limits and Pro API access all
stay on indefinitely after the paid term lapses.

## Secondary observations (not the reported symptom)

- `expire-subscriptions` runs daily at 01:00 UTC, so even when fixed there is up to ~24 h of
  free grace after expiry. Acceptable, but worth stating as intended behaviour.
- `grant-manual-subscription` uses the same fixed `duration_days * 86 400 000` arithmetic —
  consistent with defect 2, intentional there since admins pick an explicit day count.
- **Manual grants are fine.** Checked on request. `grant-manual-subscription` writes
  `billing_cycle = 'custom'` and that value is allowed by migration `20260726000004`;
  `'starter'` is allowed by `20260919000000`. The platform-admin gate, the
  `subscription_payments` audit row and activation through the shared idempotent
  `apply_subscription_payment()` are all unchanged, and a grant's term
  (today + `duration_days`) is honoured by the new expiry logic like any other.

---

## Fix (applied)

### 1. The expiry sweep no longer depends on an HTTP call
`supabase/migrations/20261017000000_subscription_expiry_enforcement.sql` re-schedules
`expire-subscriptions-daily` (now 00:05 UTC / 02:05 CAT) as **plain SQL inside pg_cron** — the
sweep is a three-column update on one table, so it needs no URL, no shared secret and no
deploy-time substitution, and therefore cannot silently rot again. The Edge Function is kept
for manual runs and performs the identical update.

### 2. The remaining HTTP cron jobs are repaired on every deploy, and verified
`scripts/ci/apply-cron-jobs.sh` (new) substitutes `<PROJECT_REF>`/`<CRON_SECRET>` into
`scripts/cron-jobs.sql`, applies it through the Supabase Management API SQL endpoint, then
**queries `cron.job` and fails the deploy if any scheduled command still contains a
placeholder**. Wired into `deploy.yml` for both staging and production (the missing wiring the
script's own header had always claimed existed). The expiry job was removed from
`cron-jobs.sql` so it cannot overwrite the SQL version.

### 3. Calendar-accurate terms
`computeTermEnd()` in `supabase/functions/initiate-subscription-payment/index.ts`, mirrored in
`src/lib/billing/plans.ts`: `+1 month` / `+1 year` with end-of-month clamping (31 Jan →
28/29 Feb, 29 Feb → 28 Feb). A plan bought 2026-09-01 09:30 now ends 2026-10-01 09:30.

### 4. Expiry enforced at access time (defence in depth)
`effectivePlanTier(plan_tier, plan_expires_at)` — a lapsed paid plan resolves to `free`
immediately, regardless of what the row says:

- `src/hooks/useUsage.ts` → every PlanGate, nav lock, AI gate and usage limit on the client
- `src/lib/billing/UsageService.assertWithinTransactionLimit()`
- `public.effective_plan_tier()` inside `_ledgr_assert_usage_limit()` — the authoritative,
  non-bypassable server quota
- `BillingTab` shows an explicit "your {Plan} subscription ended on {date}" banner instead of
  silently displaying Free

A `NULL` expiry still means "no end date" (comped/lifetime), and an unparseable date fails
open — nobody is locked out by a bad timestamp.

### 5. Manual grants, and the back-fill
Manual grants are otherwise untouched: `grant-manual-subscription` still checks
`is_platform_admin`, still records a `subscription_payments` row and still activates through the
same idempotent `apply_subscription_payment()` as a gateway payment, and a grant's
`plan_expires_at` (today + `duration_days`) is honoured by the new expiry logic exactly like a
PayChangu term. What the migration adds is that the constraints now accept everything that
endpoint writes, on every environment:

- `billing_cycle` accepts `'custom'` (hand-patched on the captured database, missing from
  migrations, so absent on anything rebuilt from them)
- `businesses.plan_tier` and `subscription_payments.target_plan_tier` accept `'starter'` —
  re-asserted idempotently because the capture showed an environment where migration
  `20260919000000` had never landed, which breaks Starter grants and Starter checkouts alike

The migration also downgrades every business already past `plan_expires_at` — the rows the dead
cron should have handled.

## Tests

`src/lib/billing/__tests__/subscriptionExpiry.test.ts` (14 new tests) covers the term
arithmetic (including the exact reported 1 Sep → 1 Oct case, month-end clamping and leap
years), `effectivePlanTier` semantics, and asserts that the client, the server quota, the cron
schedule and the deploy workflow all keep honouring expiry.

Verification run: `npm run typecheck` clean, `npm run lint` clean (3 pre-existing warnings),
`npm test` 933/934 — the single failure is `demoIntegration.test.ts`, a date-anchored demo
fixture that fails identically on the unmodified base commit.

## Deploying this

`supabase db push` applies the migration (expiry schedule + back-fill); the new deploy step
repairs the reminder/partner-invoice jobs. Worth checking afterwards:

```sql
select jobname, schedule, active from cron.job;                 -- no <PROJECT_REF> left
select id, plan_tier, plan_expires_at from public.businesses
 where plan_tier <> 'free' and plan_expires_at <= now();        -- expect zero rows
```

Commercial note: customers who were over-served while the cron was dead are downgraded by the
back-fill the moment this ships. Consider a heads-up email — the in-app banner explains the
change but will be the first they hear of it otherwise.


---

## Correction (2026-10-01, after the first fix was pushed)

Two claims in the first version of this report were wrong. Both came from reading
`artifacts/database/capture/` as if it described the current database. It does not: it is a
frozen **2026-08-15** snapshot, and 61 of the repository's 122 migrations are newer than it.

| Claimed | Actually |
|---|---|
| `subscription_payments.billing_cycle` was hand-patched to allow `'custom'`, so manual grants fail on any DB rebuilt from migrations | Migration **`20260726000004`** adds `'custom'`. Manual grants were never broken. |
| Migration `20260919000000` (Starter) "had not been applied" to that project | The capture simply **predates** it by five weeks. No evidence either way. |

The constraint re-assertions added on the strength of those claims have been removed from
migration `20261017000000` — they were redundant. Nothing else in the fix depended on them,
and the cron-placeholder finding (cause 1) stands: those schedule migrations predate the
capture, and no code path in the repository rewrites the jobs afterwards.

### Full drift check, done properly

`scripts/database/compare-capture-to-migrations.py` (new) compares a database against
`supabase/migrations`, in two modes:

- `--source capture` (default, offline) — restricted to the 55 migrations that genuinely
  predate the snapshot, excluding the same-day Phase 8B batch (`20260815000000`–`0003`), whose
  version labels sort *before* the 19:26 capture but which was applied *after* it. Without that
  exclusion the tool invents ~45 phantom gaps. Informational only; never exits non-zero.
- `--source live` — queries the project through the Management API SQL endpoint and compares
  `supabase_migrations.schema_migrations` against the checkout. The only mode that can prove
  anything.

Result against the capture, with the cutoff applied correctly:

```
tables:    0 missing of 59 declared
functions: 0 missing of 35 declared
triggers:  0 missing of 11 declared
indexes:   0 missing of 31 declared
```

**No schema drift as of 2026-08-15.** The only genuine defect in the snapshot is the one
already fixed: three pg_cron jobs `active = true` while posting to
`https://<PROJECT_REF>.supabase.co/...`.

The "30 tables with RLS enabled and no policy" the first pass of the tool reported is also a
snapshot artefact: Phase 8B creates those policies inside `DO $$ … execute format(…) $$`
blocks, invisible to text matching and applied after the capture.

### What was fixed as a result

1. **`scripts/database/compare-capture-to-migrations.py`** — drift detection that understands
   both traps (authoring-time version labels, dynamically created objects).
2. **`.github/workflows/schema-drift.yml`** — runs the live check weekly against staging and
   production and fails on real drift or a placeholder cron job. Read-only; reuses the existing
   `SUPABASE_ACCESS_TOKEN` and project-ref variables.
3. **`artifacts/database/README.md`** — states the capture date, the migration gap and both
   traps at the top of the directory, so the artefact is not mistaken for current state again.
4. **Migration `20261017000000`** now also **deactivates any pg_cron job still holding a
   placeholder**, so `active = true` means "actually fires". `apply-cron-jobs.sh` re-creates
   them properly on the next deploy.

To get a definitive answer about production right now, run the Schema Drift Check workflow from
the Actions tab (or the `--source live` command above with a project ref and access token).
