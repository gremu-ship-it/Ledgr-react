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
supabase functions deploy initiate-subscription-payment
supabase functions deploy paychangu-webhook --no-verify-jwt
supabase functions deploy verify-subscription-payment
supabase functions deploy expire-subscriptions --no-verify-jwt
```

`paychangu-webhook` and `expire-subscriptions` must be deployed with
`--no-verify-jwt` since PayChangu and your cron scheduler can't send a
Supabase user JWT — both are protected by their own mechanism instead
(HMAC signature verification, and `CRON_SECRET` respectively).

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

**Important:** `supabase/migrations/20260726000003_schedule_expire_subscriptions.sql`
contains two placeholders (`<PROJECT_REF>` and `<CRON_SECRET>`) that must be
replaced with real values before/when this migration runs, since SQL
migrations can't read Supabase secrets the way Edge Functions do. Edit the
file (or run the equivalent `select cron.schedule(...)` manually in the SQL
editor) with your actual project ref and the same `CRON_SECRET` value you
set in step 2.

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
