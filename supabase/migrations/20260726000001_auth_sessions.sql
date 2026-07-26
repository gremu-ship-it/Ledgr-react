-- Application session registry. Supabase does not expose a supported per-device
-- session listing API, so this records the metadata needed by Settings.
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auth_session_id uuid,
  device_name text not null default 'Unknown device',
  browser text not null default 'Unknown browser',
  operating_system text not null default 'Unknown OS',
  ip_address inet,
  location text,
  user_agent text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists user_sessions_user_idx on public.user_sessions(user_id, last_seen_at desc);
create unique index if not exists user_sessions_auth_session_idx on public.user_sessions(auth_session_id) where auth_session_id is not null;
alter table public.user_sessions enable row level security;
create policy "users can read own sessions" on public.user_sessions for select using (auth.uid() = user_id);
-- Writes are intentionally restricted to Edge Functions using the service role.
