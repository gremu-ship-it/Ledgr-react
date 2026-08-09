# PayChangu Payment Integration — Setup Guide

## Overview

Ledgr now supports real subscription payments through
[PayChangu](https://paychangu.com), a Malawian payment gateway supporting
mobile money (Airtel Money, TNM Mpamba), bank transfer, and card payments in
MWK. Business owners can upgrade from Settings → Billing and are redirected
to PayChangu's hosted checkout to pay; the plan only activates once PayChangu
confirms the payment.

**Downgrading (including moving to Free) stays instant and self-serve** — no
payment is involved, so it doesn't go through PayChangu.

## Architecture

```
Owner clicks "Upgrade" in Settings → Billing
        │
        ▼
CheckoutModal → initiate-subscription-payment (Edge Function)
        │  - Verifies caller is the business owner
        │  - Validates plan/cycle against the canonical price list
        │    (never trusts an amount from the browser)
        │  - Writes a `pending` row to subscription_payments
        │  - Calls PayChangu POST /payment → gets a checkout_url
        ▼
Browser redirects to PayChangu's hosted checkout page
        │
        ▼  (owner pays with mobile money / card)
        │
        ├──► PayChangu calls callback_url ──► paychangu-webhook (Edge Function)
        │        - Verifies the `Signature` HMAC header
        │        - Re-queries PayChangu's verify-payment endpoint (never
        │          trusts the webhook body's own status)
        │        - Calls apply_subscription_payment() (idempotent SQL fn)
        │          which activates the plan on `businesses` on success
        │
        └──► PayChangu redirects browser to return_url?payment=<tx_ref>
                 - usePaymentReturnStatus() picks this up
                 - Calls verify-subscription-payment (Edge Function),
                   which re-queries PayChangu and calls the same
                   apply_subscription_payment() function
                 - Shows a confirmation banner and refreshes usage/plan data
```

Both paths call the same idempotent `apply_subscription_payment()` Postgres
function, so whichever arrives first (webhook or the redirect) wins and the
other is a safe no-op.

### Why plan_tier can't be self-escalated

A database trigger (`enforce_plan_tier_change`) blocks any `UPDATE` on
`businesses.plan_tier` that *raises* the tier unless it's made using the
`service_role` key (i.e. from one of our Edge Functions, which only do so
after a confirmed payment). Regular authenticated requests — including the
owner's own browser devtools — can still *lower* `plan_tier` (self-serve
downgrade), but cannot grant themselves a paid tier directly.

## One-time setup

### 1. Get PayChangu API keys

1. Sign up / log in at https://dashboard.paychangu.com
2. Go to **Settings → API & Webhooks** to find your **Secret Key** and
   **Webhook Secret**. Use test-mode keys first (`sec-test-...`) — full
   test-mode flows work identically to live.

### 2. Set Supabase Edge Function secrets

```bash
supabase secrets set PAYCHANGU_SECRET_KEY=sec-test-xxxxxxxx
supabase secrets set PAYCHANGU_WEBHOOK_SECRET=your_webhook_secret
supabase secrets set APP_URL=https://your-deployed-app-url.com
supabase secrets set CRON_SECRET=$(openssl rand -hex 32)
```

`APP_URL` is used to build the `return_url` PayChangu redirects the owner
back to after paying. `CRON_SECRET` protects the `expire-subscriptions`
function (see below) from being invoked by anyone other than your scheduler.

### 3. Deploy the Edge Functions

```bash
supabase functions deploy initiate-subscription-payment --no-verify-jwt
supabase functions deploy verify-subscription-payment --no-verify-jwt
supabase functions deploy grant-manual-subscription --no-verify-jwt
supabase functions deploy paychangu-webhook --no-verify-jwt
supabase functions deploy expire-subscriptions --no-verify-jwt
```

These functions are deployed with `--no-verify-jwt` so CORS preflight and
server-to-server calls are never blocked by the Supabase gateway. The
client-facing functions (`initiate-subscription-payment`,
`verify-subscription-payment`, and `grant-manual-subscription`) still require
and verify the caller's Supabase JWT inside the function before doing any
work. `paychangu-webhook` and `expire-subscriptions` are protected by their
own mechanisms instead (HMAC signature verification, and `CRON_SECRET`
respectively).

### 4. Point PayChangu's webhook at your function

In the PayChangu dashboard under **Settings → API & Webhooks**, set the
webhook URL to:

```
https://<your-project-ref>.supabase.co/functions/v1/paychangu-webhook
```

Enable all payment-related event checkboxes.

### 5. Apply the database migrations

```bash
supabase db push
```

This creates `subscription_payments`, adds `plan_tier` / `plan_expires_at`
to `businesses`, and installs the escalation-guard trigger.

**Important:** the three cron-schedule migrations
(`20260726...0003`, `20260726...0005`, `20260727...0006`) ship with
`<PROJECT_REF>` and `<CRON_SECRET>` placeholders, because SQL migrations
can't read env/secrets at apply time. If the jobs were applied with the
literal placeholders, they point at a non-resolving URL and never fire —
see `scripts/cron-jobs.sql`, which re-creates all three jobs with the real
URLs and is idempotent (safe to run on every deploy).

To create/repair them, replace `<PROJECT_REF>` and `<CRON_SECRET>` with your
project ref and the same `CRON_SECRET` value set in step 2, then run:

```bash
sed -e "s|<PROJECT_REF>|<your-project-ref>|g" \
    -e "s|<CRON_SECRET>|<your-cron-secret>|g" \
    scripts/cron-jobs.sql > /tmp/cron-jobs.sql
supabase db query --linked --file /tmp/cron-jobs.sql
```

(Equivalently, paste the substituted SQL into the Supabase SQL editor.) A
matching `deploy.yml` change that fills the placeholders before `db push`
and runs this script on every deploy is provided separately — apply it via
a commit with `workflows` permission so CI does this automatically.

### 6. Go live

Once you're happy with test-mode payments end-to-end, swap
`PAYCHANGU_SECRET_KEY` / `PAYCHANGU_WEBHOOK_SECRET` for their live-mode
equivalents from the PayChangu dashboard and redeploy the affected
functions' secrets (`supabase secrets set ...` again — no redeploy needed,
secrets are read at request time).

## What still requires manual attention

- **No recurring/tokenized billing yet.** Each checkout is a one-time
  charge for one billing period (monthly or annual). `plan_expires_at` is
  set accordingly, and the daily `expire-subscriptions` cron job downgrades
  the business back to Free once it passes. Owners need to proactively
  re-checkout to renew — consider adding a reminder email/notification a
  few days before `plan_expires_at` as a follow-up.
- **Refunds/disputes** are not automated — handle via the PayChangu
  dashboard and manually adjust `businesses.plan_tier` /
  `subscription_payments.status` via the Supabase SQL editor if needed
  (using the service role, since the escalation guard only blocks
  raising the tier from a non-service-role connection — lowering it, or
  editing `subscription_payments`, is unaffected).
- **Pricing must be kept in sync in two places**: `src/lib/billing/plans.ts`
  (client display) and `supabase/functions/initiate-subscription-payment/index.ts`
  (server-side amount validation — this is the one that's actually
  charged). This mirrors the existing duplication pattern documented in
  `generate-vat-returns/index.ts` for the same Deno/Vite boundary reason.

## Renewal reminders

Since there's no recurring/tokenized billing, owners must manually renew
before `plan_expires_at` passes. Two reminder channels cover this:

- **Email** — `send-renewal-reminders` (Edge Function) runs daily via
  pg_cron and emails the business owner when `plan_expires_at` is exactly
  7, 3, or 1 day(s) away, using the same SendGrid setup as invoice
  emails (`SENDGRID_API_KEY` / `SENDGRID_FROM_EMAIL`). Sends are
  deduplicated in `subscription_reminders_sent` so re-running the cron
  (or a slightly-off trigger) never double-emails the same reminder.
- **In-app bell** — `useRenewalReminder()` (wired into `AppLayout`) checks
  the current business's `plan_expires_at` on load and pushes a
  notification-bell entry at the same 7/3/1-day thresholds, deduplicated
  per browser via `localStorage`. This only reaches someone actively using
  the app, which is why email is the channel of record.

Deploy + schedule it the same way as `expire-subscriptions`:

```bash
supabase functions deploy send-renewal-reminders --no-verify-jwt
```

Then apply `supabase/migrations/20260726000005_schedule_send_renewal_reminders.sql`,
filling in the same `<PROJECT_REF>` / `<CRON_SECRET>` placeholders as the
`expire-subscriptions` schedule.

## Manually granting a plan (cash / bank transfer payments)

Before PayChangu is fully wired up — or any time a customer simply pays you
directly (cash, bank transfer, mobile money sent straight to your own
account) — you can activate their plan by hand at **`/admin/billing`**,
without touching the database directly. This records the same audit trail
(`subscription_payments`, tagged `gateway: 'manual'`) and goes through the
same `apply_subscription_payment()` activation function real PayChangu
payments use, so it shows up identically in the business's payment history.

This page is intentionally not linked from anywhere in normal navigation
and is gated behind `user_profiles.is_platform_admin = true`, enforced both
client-side (hides the page) and server-side (the
`grant-manual-subscription` Edge Function re-checks the flag — a UI bypass
alone would never work).

### Give yourself admin access

Run this once, as the service role, in the Supabase SQL editor (replace the
email):

```sql
update public.user_profiles
set is_platform_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

Once you're a platform admin, an **Admin** section appears in the left
sidebar with two tools:

- **Businesses** (`/admin/businesses`) — a read-only directory of every
  registered business and its owner(s), with search. Backed by the
  `list_all_businesses()` SECURITY DEFINER RPC (migration
  `20260809000003_admin_business_directory.sql`), which resolves owners from
  `auth.users`/`business_users` that the client can't read cross-tenant.
  That same migration grants platform-admin to Gremu Consultancy
  (`655ad01b-ea0c-45fb-8387-c30f5b0ab12d`), so that account has access
  automatically.
- **Admin Billing** (`/admin/billing`) — manually grant/expire plans for
  offline payments (below).

Then deploy the function if you did not already deploy it in the payment setup step:

```bash
supabase functions deploy grant-manual-subscription --no-verify-jwt
```

Log in, visit `/admin/billing`, search for the business by name, choose the
plan/duration/amount/payment method, and submit. The business's plan
activates immediately — no payment gateway involved.
