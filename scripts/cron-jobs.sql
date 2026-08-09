-- ─────────────────────────────────────────────────────────────────────────
-- Ensure the three pg_cron jobs point at the real Edge Function URLs.
-- ─────────────────────────────────────────────────────────────────────────
-- Deployed by .github/workflows/deploy.yml AFTER `supabase db push`, and run
-- on every deploy (not just the first). The schedule migrations
-- (20260726...0003 / 0005, 20260727...0006) ship with literal <PROJECT_REF>
-- and <CRON_SECRET> placeholders that db push applies verbatim, so on an
-- environment where those migrations were pushed before this fix the jobs
-- exist but point at a non-resolving URL and never fire. Re-running this
-- script fixes them and keeps them correct going forward.
--
-- cron.schedule() is idempotent by job name — the third arg replaces the
-- schedule for an existing job, so running this every deploy is safe.
--
-- The workflow substitutes <PROJECT_REF> and <CRON_SECRET> before execution:
--   sed -e "s|<PROJECT_REF>|...|g" -e "s|<CRON_SECRET>|...|g" \
--       scripts/cron-jobs.sql > /tmp/cron-jobs.sql
--   supabase db query --linked --file /tmp/cron-jobs.sql

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'expire-subscriptions-daily',
  '0 1 * * *', -- 01:00 UTC every day
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/expire-subscriptions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

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
