-- ============================================================================
-- Repair: legacy public-API tables on a pre-existing database
--         (api_keys, webhooks, webhook_deliveries)
-- ============================================================================
-- WHY THIS EXISTS
-- ---------------
-- Production (`hsuhuvuxfuufrlejsatw`) is the LEGACY Ledgr project — it already
-- contained these three tables (and their leaner column sets) when
-- 20260727000001_public_api_webhooks.sql was deployed. That migration creates
-- them with `create table if not exists`, so against production it was a no-op
-- for the tables themselves and the columns/defaults it declares never
-- arrived. Staging (`bkxzgkurcqvccsdjmqzg`) was built from the migrations and
-- has the intended shape.
--
-- The gap surfaced on 2026-10-07 when types were regenerated from production:
-- `npm run typecheck` reported five errors, all traced to these three tables
-- (`webhooks.secret` required on insert, `webhooks.last_triggered_at` and
-- `webhook_deliveries.attempt` "does not exist", `api_keys.created_at`
-- nullable). It is not a typing problem — production is missing columns the
-- runtime code writes:
--
--   * `webhooks.secret` has no DEFAULT in production, so the browser's
--     `registerWebhook()` insert (which deliberately omits the secret so the
--     signing key is never client-known) fails with 23502 instead of the
--     database generating one.
--   * `webhook_deliveries.attempt` is missing, so webhook-dispatcher's delivery
--     log insert fails: the settings page shows no history, and
--     retry-failed-webhooks (`.gte('attempt', 3)`) has nothing to re-deliver.
--   * `webhooks.last_triggered_at` is missing, so the dispatcher's "last
--     delivery" timestamp update fails and the column stays absent from the
--     UI.
--   * `api_keys.created_at` is nullable with no default, so API keys can exist
--     with no creation timestamp.
--
-- WHAT THIS DOES
-- --------------
-- Converges these three tables to the shape the migrations declare, additively
-- and idempotently: no column is dropped, no data is deleted, and existing rows
-- are back-filled before any NOT NULL is applied. Applying it to staging or to
-- a fresh replay is a no-op (verified by
-- tests/database/public_api_table_convergence.test.js, which replays the whole
-- migration set against a legacy-shaped database and asserts the result is
-- column-for-column identical to a clean replay).
--
-- Deployment: applied like any other migration (`supabase db push`, i.e. the
-- tag deploy for production). To confirm convergence afterwards, run
-- scripts/diagnose-public-api-table-drift.sql — it flags each column that is
-- still missing on a database.
--
-- 2026-10-08 revision: the secret back-fill / default originally called
-- `gen_random_bytes` unqualified. A `supabase db push` session does not have
-- `extensions` on its search_path, so the first production push aborted with
-- `function gen_random_bytes(integer) does not exist` (SQLSTATE 42883) and the
-- whole file rolled back (one multi-statement batch = one implicit
-- transaction). The schema is now resolved from pg_extension at apply time.
-- Re-applying is safe: every statement is guarded and the migration is a no-op
-- on a database that already has the declared shape.
-- ============================================================================

create extension if not exists pgcrypto;

-- ── api_keys ────────────────────────────────────────────────────────────────
-- Intended: `created_at timestamptz not null default now()` (20260727000001).
alter table public.api_keys
  add column if not exists created_at timestamptz default now();

alter table public.api_keys
  add column if not exists created_by uuid references auth.users(id);

-- Back-fill before the NOT NULL below: rows created while the column was
-- nullable have no timestamp to recover, so they are stamped with the repair
-- time rather than left NULL.
update public.api_keys set created_at = now() where created_at is null;

alter table public.api_keys
  alter column created_at set default now();

alter table public.api_keys
  alter column created_at set not null;

-- ── webhooks ────────────────────────────────────────────────────────────────
-- Intended: secret text not null default encode(gen_random_bytes(32), 'hex'),
--           created_by uuid, last_triggered_at timestamptz,
--           updated_at timestamptz not null default now() (20260727000001).
alter table public.webhooks
  add column if not exists last_triggered_at timestamptz;

alter table public.webhooks
  add column if not exists created_by uuid references auth.users(id);

alter table public.webhooks
  add column if not exists updated_at timestamptz not null default now();

-- Signing secrets are a server-side concern: the HMAC that authenticates a
-- delivery is only meaningful if the recipient's copy came from the database
-- and never from the browser. Back-fill any secret-less row with a fresh one
-- before the default + NOT NULL are (re-)asserted.
--
-- gen_random_bytes lives in whichever schema pgcrypto was installed into —
-- `extensions` on hosted Supabase projects, `public` where the extension was
-- created without an explicit schema. A `supabase db push` session does NOT
-- have `extensions` on its search_path (the Supabase SQL editor does), so an
-- unqualified call fails there with 42883 — which is how the first production
-- push of this migration aborted on 2026-10-08. The schema is therefore
-- resolved at apply time and the statements are built with execute/format.
do $$
declare
  v_pgcrypto_schema text;
begin
  select n.nspname into v_pgcrypto_schema
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if v_pgcrypto_schema is null then
    raise exception 'pgcrypto is not installed, so webhook signing secrets cannot be generated. Run `create extension pgcrypto;` and re-apply this migration.'
      using errcode = '42883';
  end if;

  execute format(
    'update public.webhooks set secret = encode(%I.gen_random_bytes(32), ''hex'') where secret is null',
    v_pgcrypto_schema);

  execute format(
    'alter table public.webhooks alter column secret set default encode(%I.gen_random_bytes(32), ''hex'')',
    v_pgcrypto_schema);
end;
$$;

alter table public.webhooks
  alter column secret set not null;

-- ── webhook_deliveries ──────────────────────────────────────────────────────
-- Intended: `attempt integer not null default 1` (20260727000001).
alter table public.webhook_deliveries
  add column if not exists attempt integer not null default 1;

-- Rows written before the column existed cannot be attributed to an attempt;
-- 1 is the value the dispatcher would have recorded for the first one.
update public.webhook_deliveries set attempt = 1 where attempt is null;

alter table public.webhook_deliveries
  alter column attempt set default 1;

alter table public.webhook_deliveries
  alter column attempt set not null;
