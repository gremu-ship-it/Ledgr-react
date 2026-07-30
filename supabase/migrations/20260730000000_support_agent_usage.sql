-- Support Agent rate-limiting table
-- ------------------------------------------------------------------
-- Tracks per-user, per-minute usage of the support-agent edge function
-- so a single account cannot abuse the (paid) AI provider. The function
-- tolerates this table being absent, but it should always be present in
-- production. Service-role only; no anon access is granted.

create table if not exists public.support_agent_usage (
  user_id       uuid        not null,
  window_start  timestamptz not null,
  count         integer     not null default 1,
  primary key (user_id, window_start)
);

-- Periodic cleanup of stale windows (older than 1 hour) keeps the table small.
create index if not exists support_agent_usage_window_idx
  on public.support_agent_usage (window_start);

alter table public.support_agent_usage enable row level security;

-- No RLS policies: this table is only ever touched by the edge function using
-- the service-role key, which bypasses RLS. Anon/authenticated clients cannot
-- read or write it.
