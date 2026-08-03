-- Ledgr Marketing Agent — social connections (Phase 3: Facebook publishing)
-- ------------------------------------------------------------------
-- Stores OAuth'd social account credentials (Phase 3: Facebook Page access
-- tokens) so the marketing agent can publish on a business's behalf after the
-- user explicitly approves a draft. Access tokens are stored ENCRYPTED
-- (AES-GCM via the SOCIAL_TOKEN_ENC_KEY secret) — the browser never sees them.
--
--   social_connections   one row per (business, provider, page); business-member RLS
--   social_oauth_states  short-lived, single-use CSRF tokens for the OAuth flow;
--                        service-role only (edge function)

-- ── social_connections ─────────────────────────────────────────────
create table if not exists public.social_connections (
  id                     uuid primary key default gen_random_uuid(),
  business_id            uuid not null references public.businesses(id) on delete cascade,
  provider               text not null default 'facebook',
  account_id             text not null,            -- Facebook Page id
  account_name           text not null default '', -- Facebook Page name (non-sensitive)
  access_token_encrypted text not null,            -- base64(iv ‖ ciphertext)
  scopes                 text[] not null default '{}',
  connected_by           uuid references auth.users(id) on delete set null,
  connected_at           timestamptz not null default now(),
  revoked_at             timestamptz,
  created_at             timestamptz not null default now(),
  unique (business_id, provider, account_id)
);

create index if not exists social_connections_business_idx
  on public.social_connections (business_id, provider)
  where revoked_at is null;

alter table public.social_connections enable row level security;

-- Members of the owning business may read (note: access_token_encrypted is
-- included but the browser must never display or send it).
create policy "social_connections read for business members"
  on public.social_connections for select
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = social_connections.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- The OAuth callback (edge function, service role) performs the insert; members
-- may revoke (set revoked_at) and delete their own connections.
create policy "social_connections update for business members"
  on public.social_connections for update
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = social_connections.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  )
  with check (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = social_connections.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

create policy "social_connections delete for business members"
  on public.social_connections for delete
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = social_connections.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- ── social_oauth_states (CSRF + business binding for the OAuth callback) ──
create table if not exists public.social_oauth_states (
  state        text primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  provider     text not null default 'facebook',
  user_id      uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  used_at      timestamptz
);

create index if not exists social_oauth_states_created_idx
  on public.social_oauth_states (created_at);

alter table public.social_oauth_states enable row level security;
-- No RLS policies: only the edge function (service role) reads/writes states.
