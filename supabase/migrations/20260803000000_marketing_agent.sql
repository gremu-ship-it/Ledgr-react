-- Ledgr Marketing Agent — data model + rate limiting
-- ------------------------------------------------------------------
-- Backs the in-app Marketing Assistant (see MARKETING_AGENT.md).
--
--   marketing_posts       generated drafts / scheduled / published content
--                         (Phase 0 only ever writes 'draft' rows)
--   marketing_agent_usage per-user, per-minute rate limit for the
--                         marketing-agent edge function — mirrors
--                         20260730000000_support_agent_usage.sql
--
-- RLS for marketing_posts reuses the canonical business-membership check
-- (public.business_users) so members of a business can read & write their
-- own marketing content and nothing else. The usage table is service-role
-- only, like the other rate-limit tables.

-- ── Enum ────────────────────────────────────────────────────────────
do $$ begin
  create type public.marketing_post_status as enum (
    'draft', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'archived'
  );
exception when duplicate_object then null; end $$;

-- ── marketing_posts ─────────────────────────────────────────────────
create table if not exists public.marketing_posts (
  id            uuid        primary key default gen_random_uuid(),
  business_id   uuid        not null references public.businesses(id) on delete cascade,
  -- nullable: the client insert (saveDraft) doesn't pass it; RLS already
  -- guarantees only a business member can create the row.
  created_by    uuid        references auth.users(id) on delete set null,
  -- 'post' | 'message' | 'recommendation' | 'research'
  kind          text        not null default 'post',
  -- 'facebook' | 'instagram' | 'internal' | … (free text for future channels)
  channel       text        not null default 'facebook',
  status        public.marketing_post_status not null default 'draft',
  title         text,
  -- { text, hashtags[], cta, rationale, productRefs[], … }
  content_json  jsonb       not null default '{}'::jsonb,
  scheduled_for timestamptz,
  published_at  timestamptz,
  external_id   text,
  error         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists marketing_posts_business_idx
  on public.marketing_posts (business_id, created_at desc);
create index if not exists marketing_posts_status_idx
  on public.marketing_posts (status);

alter table public.marketing_posts enable row level security;

-- Members of the owning business may read.
create policy "marketing_posts read for business members"
  on public.marketing_posts for select
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_posts.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- Members of the owning business may insert. (created_by is set by the
-- application/trigger later; RLS membership is the real gate.)
create policy "marketing_posts insert for business members"
  on public.marketing_posts for insert
  to authenticated
  with check (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_posts.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- Members of the owning business may update.
create policy "marketing_posts update for business members"
  on public.marketing_posts for update
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_posts.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  )
  with check (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_posts.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- Members of the owning business may delete.
create policy "marketing_posts delete for business members"
  on public.marketing_posts for delete
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_posts.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- ── marketing_agent_usage (rate limit, mirrors support_agent_usage) ─
create table if not exists public.marketing_agent_usage (
  user_id       uuid        not null,
  window_start  timestamptz not null,
  count         integer     not null default 1,
  primary key (user_id, window_start)
);

create index if not exists marketing_agent_usage_window_idx
  on public.marketing_agent_usage (window_start);

alter table public.marketing_agent_usage enable row level security;
-- No RLS policies: only the edge function (service role) touches this table.
