# Tax Compliance Module — Deployment Guide

Everything needed to take the tax module from merged code to working in
production. Roughly 15 minutes.

Two new Edge Functions ship with this module:

| Function | Schedule | Purpose |
|---|---|---|
| `generate-vat-returns` | Monthly, 06:00 UTC on the 1st | Closes the prior month's VAT period and creates the return |
| `send-tax-alerts` | Daily, 07:00 UTC | Sends the 14 / 7 / 1 day and due-date reminders |

---

## Do NOT add these to the CI workflow

`.github/workflows/deploy-supabase.yml` has a `Deploy Edge Functions` loop,
and it would be the obvious place to add these. **Don't.**

That loop deploys with JWT verification left on:

```yaml
supabase functions deploy "$function" --project-ref "$SUPABASE_PROJECT_REF"
```

Both new functions are invoked by `pg_cron` via `net.http_post`, which sends
an `x-cron-secret` header and **no user JWT**. Deployed through that loop they
would return `401` on every scheduled run — silently, forever.

This is why none of your existing cron functions (`expire-subscriptions`,
`send-renewal-reminders`, `generate-partner-invoices`) are in the loop either.
They're deployed by hand with `--no-verify-jwt`, per `PAYCHANGU_SETUP.md`.
The two tax functions follow that same established convention.

---

## Step 1 — Set the secrets

`CRON_SECRET` and `APP_URL` are probably already set from the PayChangu
setup. Re-running `secrets set` is harmless and needs no redeploy.

```bash
# Required — shared secret that authenticates cron calls.
# Reuse your EXISTING value if you already have one.
supabase secrets set CRON_SECRET=$(openssl rand -hex 32)

# Required for alert emails — same SendGrid account send-invoice uses.
supabase secrets set SENDGRID_API_KEY=SG.xxxxxxxx
supabase secrets set SENDGRID_FROM_EMAIL=tax@yourdomain.com

# Required so alert emails can deep-link to the Tax page.
supabase secrets set APP_URL=https://your-deployed-app-url.com
```

Print the value you'll need in Step 4:

```bash
supabase secrets list                 # names only, not values
# If you generated a fresh CRON_SECRET above, capture it instead:
#   CRON_SECRET=$(openssl rand -hex 32); echo "$CRON_SECRET"
#   supabase secrets set CRON_SECRET="$CRON_SECRET"
```

### Optional — SMS alerts

SMS is off unless configured. Without these the alert rows stay `pending`
rather than being marked failed, so you can enable SMS later and nothing is
lost. Email is unaffected.

```bash
supabase secrets set AFRICASTALKING_API_KEY=your_key
supabase secrets set AFRICASTALKING_USERNAME=your_username
supabase secrets set AFRICASTALKING_SENDER_ID=Ledgr    # optional
```

Africa's Talking covers Airtel Malawi and TNM. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically — don't set them.

---

## Step 2 — Deploy the two functions

```bash
supabase functions deploy generate-vat-returns --no-verify-jwt
supabase functions deploy send-tax-alerts      --no-verify-jwt
```

`--no-verify-jwt` is required. Both functions authenticate themselves by
comparing the `x-cron-secret` header against `CRON_SECRET` and return `401`
otherwise, so they are not left open.

---

## Step 3 — Apply the migrations

Merging to `main` triggers `supabase db push` automatically. To do it by hand:

```bash
supabase db push
```

Five migrations apply, in this order:

```
20260727000009_tax_receipts_storage.sql            tax-receipts bucket + RLS
20260727000010_tax_mark_overdue.sql                overdue transition + daily cron
20260727000011_schedule_tax_jobs.sql               cron for both functions
20260727000012_tax_code_add_tpr_pension.sql        enum value
20260727000013_tax_config_seed_and_account_links.sql  seed + account backfill
```

> **Back up first.** `...013` writes to `tax_configurations` for every
> business. It is guarded and idempotent — it only inserts where a config is
> missing and only backfills account links that are still `NULL`, so it will
> not overwrite anything you set in the UI. But it is a data migration.

`...011` and `...010` need the `pg_cron` and `pg_net` extensions
(Dashboard → Database → Extensions). If they aren't enabled yet, enable them
before pushing or those two will fail.

---

## Step 4 — Fill in the cron placeholders

`20260727000011_schedule_tax_jobs.sql` and
`20260727000010_tax_mark_overdue.sql` follow the same convention as your
three existing schedule migrations: they contain `<PROJECT_REF>` and
`<CRON_SECRET>` placeholders that git must never hold real values for.

After pushing, run this in the SQL editor with the real values substituted:

```sql
-- Replace <PROJECT_REF> and <CRON_SECRET> before running.

select cron.unschedule('generate-vat-returns-monthly');
select cron.unschedule('send-tax-alerts-daily');

select cron.schedule(
  'generate-vat-returns-monthly',
  '0 6 1 * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-vat-returns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'send-tax-alerts-daily',
  '0 7 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-tax-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

`unschedule` first makes this re-runnable; ignore "could not find" on the
first run. Confirm:

```sql
select jobname, schedule, active from cron.job order by jobname;
```

Expected: `generate-vat-returns-monthly`, `mark-overdue-tax-returns-daily`,
`send-tax-alerts-daily`, plus your three existing jobs.

---

## Step 5 — Regenerate database types

The migrations change the schema, so the checked-in types drift:

```bash
supabase gen types typescript --project-id <PROJECT_REF> \
  > src/dal/types/database.generated.ts

npm run verify
```

Commit the result if it changes.

---

## Step 6 — Verify end to end

### Functions respond

```bash
# Should return 401 — proves the secret is actually enforced.
curl -i -X POST \
  https://<PROJECT_REF>.supabase.co/functions/v1/send-tax-alerts

# Should return 200 with {"date":...,"processed":N,"results":[...]}
curl -i -X POST \
  -H "x-cron-secret: <CRON_SECRET>" \
  https://<PROJECT_REF>.supabase.co/functions/v1/send-tax-alerts
```

`processed: 0` is correct if nothing is due today.

### Generate a VAT return

```bash
curl -X POST \
  -H "x-cron-secret: <CRON_SECRET>" \
  https://<PROJECT_REF>.supabase.co/functions/v1/generate-vat-returns
```

Returns `{"period":"YYYY-MM","results":[...]}`. Only touches businesses with
`vat_registered = true`; `skipped / already exists` on a second run is the
idempotency guard working.

### The one that matters — payroll approval

This was the headline blocker: approval threw because the pension payable
account was `NULL`, so PAYE and TPR returns were never created.

```sql
-- Every row should show a linked payable account.
select tax_code, name,
       tax_payable_account_id is not null    as payable_linked,
       tax_receivable_account_id is not null as receivable_linked
from tax_configurations
order by tax_code;
```

Then in the app: **Payroll → open a draft run → Approve**. It should succeed
and produce PAYE and TPR rows under **Tax → Obligations**.

If a business shows `payable_linked = false`, its chart of accounts wasn't
seeded when the migration ran. Fix either way:

- **Accounts → Repair CoA**, then re-run migration `...013`; or
- **Tax → Tax Configurations → edit** and pick the accounts manually
  (2132 Pension Payable, 2122 PAYE Payable, 2121 VAT Payable,
  1135 VAT Receivable).

### Receipts

**Tax → Obligations → Mark as paid** on a posted liability, attach a photo or
PDF, save. Reopen via **View return** and confirm the receipt link opens.
Confirms the `tax-receipts` bucket and its RLS are working.

---

## Rollback

```sql
select cron.unschedule('generate-vat-returns-monthly');
select cron.unschedule('send-tax-alerts-daily');
select cron.unschedule('mark-overdue-tax-returns-daily');
```

That stops all automation. The Tax page keeps working manually — VAT returns
can be generated from the Obligations tab, and nothing is deleted.

To also stop alert delivery without touching cron:

```sql
update tax_alerts set status = 'failed' where status = 'pending';
```

---

## Reference

**Statutory due dates** — in `src/lib/taxRules.ts`, as data. Adding a
jurisdiction is a data change.

| | Malawi (MRA) | Zambia (ZRA) |
|---|---|---|
| VAT rate | 17.5% (from 1 Jan 2026) | 16% |
| VAT return | 25th of following month | 18th |
| PAYE | 14 days after month end | 10th |
| Pension | TPR 10% / 5%, +14 days | NAPSA 5% / 5%, 10th |

Jurisdiction resolves from `businesses.country`, defaulting to Malawi.

**Not yet verified:** the Zambian PAYE bands and NAPSA rates come from
published figures, not a current ZRA circular, and the NAPSA statutory
monthly ceiling is not applied. Confirm before filing in Zambia.

**Ledger accounts used**

| Code | Account | Used for |
|---|---|---|
| 1135 | VAT Receivable (Input Tax) | Input VAT cleared at period close |
| 2121 | VAT Payable (Output Tax) | Output VAT + net payable |
| 2122 | PAYE Payable | PAYE liability |
| 2132 | Pension Payable | TPR employer + employee |
| 6112 | Employer Pension Contributions | Employer's share as expense |

Note 2131 is *Salaries & Wages Payable*, not PAYE — an easy mis-link.
