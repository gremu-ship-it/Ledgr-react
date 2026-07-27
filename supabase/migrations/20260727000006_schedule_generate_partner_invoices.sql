-- ─────────────────────────────────────────────────────────────────────────
-- Schedule the generate-partner-invoices Edge Function via pg_cron.
-- ─────────────────────────────────────────────────────────────────────────
-- Runs at 02:00 UTC on the 1st of each month, raising one partner-level
-- invoice per active bank/MFI for the month that just closed
-- (see supabase/functions/generate-partner-invoices).
--
-- 02:00 keeps it clear of the 01:00 expire-subscriptions run so the two
-- jobs don't contend, and well before the 08:00 renewal reminders.
--
-- The job is safe to re-run: partner_invoices_period_key (added in
-- 20260727000005) makes a second attempt for the same period a no-op
-- rather than a double-charge.
--
-- Same placeholder requirements as
-- 20260726000003_schedule_expire_subscriptions.sql — replace before/after
-- applying:
--   <PROJECT_REF>   your Supabase project ref
--   <CRON_SECRET>   the same value set via `supabase secrets set CRON_SECRET=...`

select cron.schedule(
  'generate-partner-invoices-monthly',
  '0 2 1 * *', -- 02:00 UTC on the 1st of every month
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/generate-partner-invoices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
