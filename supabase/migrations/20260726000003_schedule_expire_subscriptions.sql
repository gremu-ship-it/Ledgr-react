-- ─────────────────────────────────────────────────────────────────────────
-- Schedule the expire-subscriptions Edge Function via pg_cron.
-- ─────────────────────────────────────────────────────────────────────────
-- Runs once daily at 01:00 UTC, downgrading any business whose
-- plan_expires_at has passed back to the Free tier (see
-- supabase/functions/expire-subscriptions).
--
-- Requires the `pg_cron` and `pg_net` extensions, both available on
-- Supabase-hosted projects by default (pg_net lets a cron job make an
-- HTTP call to an Edge Function).
--
-- IMPORTANT — this migration references two placeholders that must be
-- replaced with real values before/after applying it in the Supabase SQL
-- editor (migrations can't read `vault`/env vars at apply time the way
-- Edge Functions can):
--   <PROJECT_REF>   your Supabase project ref (e.g. abcdefghijklmno)
--   <CRON_SECRET>   the same value set via `supabase secrets set CRON_SECRET=...`
--                    for the expire-subscriptions function
--
-- If you'd rather not bake the secret into the database, use Supabase's
-- Vault (`select vault.create_secret(...)`) and reference it here instead
-- of the literal — this inline version matches the simpler pattern already
-- implied by finalize-account-deletions' CRON_SECRET usage in this repo.

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
