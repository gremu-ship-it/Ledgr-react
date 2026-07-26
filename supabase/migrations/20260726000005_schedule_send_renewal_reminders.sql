-- ─────────────────────────────────────────────────────────────────────────
-- Schedule the send-renewal-reminders Edge Function via pg_cron.
-- ─────────────────────────────────────────────────────────────────────────
-- Runs once daily at 08:00 UTC (a reasonable time to land in an owner's
-- inbox across Malawi's timezone), emailing owners whose plan_expires_at
-- is exactly 7, 3, or 1 day(s) away (see supabase/functions/send-renewal-reminders).
--
-- Same placeholder requirements as
-- 20260726000003_schedule_expire_subscriptions.sql — replace before/after
-- applying:
--   <PROJECT_REF>   your Supabase project ref
--   <CRON_SECRET>   the same value set via `supabase secrets set CRON_SECRET=...`

select cron.schedule(
  'send-renewal-reminders-daily',
  '0 8 * * *', -- 08:00 UTC every day
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-renewal-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
