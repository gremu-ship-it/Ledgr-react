-- ─────────────────────────────────────────────────────────────────────────
-- Ensure the HTTP-dispatched pg_cron jobs point at the real Edge Function URLs.
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
-- Applied by scripts/ci/apply-cron-jobs.sh (invoked from deploy.yml after
-- `supabase db push`), which substitutes <PROJECT_REF>/<CRON_SECRET> and runs
-- the result through the Supabase Management API SQL endpoint, then asserts
-- that no job command still contains a placeholder.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- NOTE: 'expire-subscriptions-daily' is deliberately NOT scheduled here any
-- more. Migration 20261017000000 runs the expiry sweep as plain SQL inside
-- pg_cron (no URL, no secret, nothing to substitute), because the HTTP
-- version of this job sat broken on an unsubstituted <PROJECT_REF> URL and
-- silently stopped expiring subscriptions. Do not re-add an HTTP variant
-- under the same job name — it would replace the working SQL one.

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
