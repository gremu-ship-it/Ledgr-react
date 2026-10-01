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

The captured live database inventory confirms the job is still broken in the deployed project
(`artifacts/database/capture/cron_jobs.json`, captured 2026-09-29):

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
- **Manual grants (platform-admin, cash/bank/mobile money).** The migration-defined CHECK on
  `subscription_payments.billing_cycle` is `('monthly','annual')`, but
  `grant-manual-subscription` inserts `'custom'`. The captured database had already been
  hand-patched to allow `'custom'` (`CHECK (billing_cycle = ANY (ARRAY['monthly','annual','custom']))`),
  so grants work *there* — but any environment rebuilt from migrations rejects every manual
  grant. The same capture also shows `businesses.plan_tier` and
  `subscription_payments.target_plan_tier` still limited to `growth/pro/enterprise`, i.e.
  migration `20260919000000` (Starter) had not been applied: Starter grants and Starter
  checkouts fail there with a raw constraint violation.

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
