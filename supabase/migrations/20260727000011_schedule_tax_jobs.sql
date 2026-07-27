-- ─────────────────────────────────────────────────────────────────────────
-- Schedule the tax compliance Edge Functions via pg_cron.
-- ─────────────────────────────────────────────────────────────────────────
-- Two jobs:
--   generate-vat-returns  monthly, 06:00 UTC on the 1st — builds the prior
--                         month's VAT return for every VAT-registered
--                         business and schedules its alerts.
--   send-tax-alerts       daily, 07:00 UTC — delivers any tax_alerts rows
--                         that have come due (14 / 7 / 1 days before, and
--                         on, each due date).
--
-- generate-vat-returns previously had NO schedule at all: the cron snippet
-- existed only as a comment at the bottom of the function file, so the
-- monthly VAT return was never actually generated in production.
--
-- Same placeholder requirements as the other schedule migrations — replace
-- before applying:
--   <PROJECT_REF>   your Supabase project ref
--   <CRON_SECRET>   the same value set via `supabase secrets set CRON_SECRET=...`

select cron.schedule(
  'generate-vat-returns-monthly',
  '0 6 1 * *', -- 06:00 UTC on the 1st of every month
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
  '0 7 * * *', -- 07:00 UTC every day
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
