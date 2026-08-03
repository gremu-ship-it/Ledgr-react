-- Ledgr Marketing Agent — per-business settings (Phase 1)
-- ------------------------------------------------------------------
-- Stores a business's marketing preferences that the Marketing Agent uses:
--   • brand_voice   — free-text tone/voice profile injected into the prompt
--                     (e.g. "warm and practical, Malawian English, no hype,
--                     always quote MWK prices"). Empty string = use defaults.
--   • post_language — preferred output language for generated posts
--                     (default 'en'; Chichewa 'ny' and others are supported
--                     by the app's i18n locales).
--
-- One row per business (PK business_id). RLS: members of the owning business
-- may read and upsert their own row, mirroring marketing_posts.

create table if not exists public.marketing_settings (
  business_id   uuid        primary key references public.businesses(id) on delete cascade,
  brand_voice   text        not null default '',
  post_language text        not null default 'en',
  updated_at    timestamptz not null default now(),
  updated_by    uuid        references auth.users(id)
);

alter table public.marketing_settings enable row level security;

-- Members of the owning business may read.
create policy "marketing_settings read for business members"
  on public.marketing_settings for select
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_settings.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- Members may insert their row.
create policy "marketing_settings insert for business members"
  on public.marketing_settings for insert
  to authenticated
  with check (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_settings.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );

-- Members may update their row.
create policy "marketing_settings update for business members"
  on public.marketing_settings for update
  to authenticated
  using (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_settings.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  )
  with check (
    exists (
      select 1 from public.business_users bu
      where bu.business_id = marketing_settings.business_id
        and bu.user_id = auth.uid()
        and bu.is_active
    )
  );
