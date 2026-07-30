-- AI Insights rate-limiting table
-- ------------------------------------------------------------------
-- Tracks per-user, per-minute usage of the ai-insights edge function
-- so a single account cannot abuse the (paid) AI provider. The function
-- tolerates this table being absent, but it should always be present in
-- production. Service-role only; no anon access is granted.
--
-- Mirrors 20260730000000_support_agent_usage.sql.

create table if not exists public.ai_insights_usage (
  user_id       uuid        not null,
  window_start  timestamptz not null,
  count         integer     not null default 1,
  primary key (user_id, window_start)
);

-- Periodic cleanup of stale windows (older than 1 hour) keeps the table small.
create index if not exists ai_insights_usage_window_idx
  on public.ai_insights_usage (window_start);

alter table public.ai_insights_usage enable row level security;

-- No RLS policies: this table is only ever touched by the edge function using
-- the service-role key, which bypasses RLS. Anon/authenticated clients cannot
-- read or write it.
