-- ─────────────────────────────────────────────────────────────────────────
-- Ensure the HTTP-dispatched pg_cron jobs point at the real Edge Function URLs.
-- ─────────────────────────────────────────────────────────────────────────
-- Deployed by .github/workflows/deploy.yml AFTER `supabase db push`, and run
-- on every deploy (not just the first). The schedule migrations
-- (20260726...0003 / 0005, 20260727...0006, 20260820000000) ship with literal
-- <PROJECT_REF> and <CRON_SECRET> placeholders that db push applies verbatim,
-- so on an environment where those migrations were pushed before this fix the
-- jobs exist but point at a non-resolving URL and never fire. Re-running this
-- script fixes them and keeps them correct going forward.
--
-- cron.schedule() is idempotent by job name — the third arg replaces the
-- schedule for an existing job, so running this every deploy is safe. It does
-- NOT touch the job's `active` flag, though; see the last statement.
--
-- Applied by scripts/ci/apply-cron-jobs.sh (invoked from deploy.yml after
-- `supabase db push`), which substitutes <PROJECT_REF>/<CRON_SECRET> and runs
-- the result through the Supabase Management API SQL endpoint, then asserts
-- that no job command still contains a placeholder and that every job
-- scheduled here is active.
--
-- EVERY migration that schedules an HTTP job with a placeholder needs a
-- matching cron.schedule() here. 20261017000000 deactivates any job still
-- holding a placeholder, and apply-cron-jobs.sh fails the deploy while one is
-- left — so a job missing from this file fails every deploy until it is added.
-- That is exactly what happened with 'retry-failed-webhooks-daily'
-- (20260820000000), which was missing here until 2026-10-14 and failed every
-- staging deploy from 2026-10-09 on. tests/database/cron_jobs_apply.test.js
-- replays every migration and fails if any placeholder job survives this file.

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

-- Daily dead-letter retry of undelivered webhook deliveries (Phase 10.4,
-- migration 20260820000000; same schedule and command as declared there).
select cron.schedule(
  'retry-failed-webhooks-daily',
  '0 6 * * *', -- 06:00 UTC every day
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/retry-failed-webhooks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- ── Re-enable the jobs scheduled above ──────────────────────────────────────
-- Daily finalize account deletions (migration 20260820000000; same schedule and
-- command pattern as declared there). The function at
-- supabase/functions/finalize-account-deletions is protected by the CRON_SECRET
-- and runs on a schedule (see the pg_cron setup).
select cron.schedule(
  'finalize-account-deletions-daily',
  '0 3 * * *', -- 03:00 UTC every day
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/finalize-account-deletions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
  $$
);
-- cron.schedule() upserts on (jobname, username) and rewrites only schedule,
-- command and database — it never touches `active` (pg_cron
-- src/job_metadata.c, ScheduleCronJob; unchanged through 1.6.8). A job that
-- 20261017000000 §3 deactivated for carrying a placeholder therefore stays
-- INACTIVE after its command is fixed above and never fires, while the
-- placeholder check passes. That migration's contract is that this script
-- re-creates such jobs active, so re-enable them explicitly.
--
-- This file is the source of truth for these jobs' active flag as well as
-- their schedule and command: a job paused from the dashboard is re-enabled
-- by the next deploy. To pause one durably, change it here.
--
-- `username = current_user` targets exactly the rows the calls above
-- upserted, and is the only set cron.alter_job lets a non-superuser change.
-- Positional NULLs mean "leave unchanged" (same call style as
-- 20261017000000). Keep this list in step with the cron.schedule() calls
-- above — apply-cron-jobs.sh fails the deploy if a scheduled job is inactive.
select cron.alter_job(jobid, null, null, null, null, true)
  from cron.job
 where username = current_user
   and not active
   and jobname in (
     'send-renewal-reminders-daily',
     'generate-partner-invoices-monthly',
     'retry-failed-webhooks-daily',
     'finalize-account-deletions-daily'
   );
