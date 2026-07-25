-- Rate limiting table
create table if not exists public.api_usage (
  id uuid primary key default gen_random_uuid(),
  api_key text not null,
  count integer default 0,
  window_start timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists idx_api_usage_key_window on public.api_usage(api_key, window_start);