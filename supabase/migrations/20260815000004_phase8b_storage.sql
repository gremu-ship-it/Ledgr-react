-- ============================================================================
-- Phase 8B.4 — Storage reconstruction
-- ============================================================================
-- Recreates the two application storage buckets that were dashboard-created
-- on the legacy environment and absent from fresh deployments:
--
--   business-logos   public  (client uploads, public URLs)
--   user-exports     private (service-role uploads, signed URLs)
--
-- EVIDENCE [VERIFIED]
--   • business-logos path convention:  src/pages/SettingsPage.tsx
--       fileName = `${business.id}/logo-${Date.now()}.${ext}` (upload with
--       upsert:true, then getPublicUrl)  → path prefix = business id
--   • user-exports path convention:      supabase/functions/export-my-data/
--       path = `${userId}/${Date.now()}_ledgr_export.zip` (service-role admin
--       upload, 1-hour signed URL)      → no client access at all
--   • bucket names:                      both call sites
--
-- POLICY DESIGN
--   business-logos:
--     INSERT/UPDATE to authenticated, scoped to the caller's own businesses
--     via the path prefix (storage.foldername(name))[1] — [INFERRED] policy
--     shape (legacy unknown); grounded in the verified path convention.
--     Public bucket: objects are served through public URLs regardless of
--     RLS; the INSERT/UPDATE policies gate who may upload.
--   user-exports:
--     NO anon/authenticated policies — deny-all; edge functions use the
--     service role (bypasses RLS) and signed URLs are self-authorizing.
--
-- UNKNOWN (documented, not fabricated)
--   • file_size_limit / allowed_mime_types on the legacy buckets — no
--     evidence; left NULL (no limit). Set per environment if desired.
-- ============================================================================

-- ── business-logos: public bucket ──────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', true, null, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = coalesce(storage.buckets.file_size_limit, excluded.file_size_limit),
      allowed_mime_types = coalesce(storage.buckets.allowed_mime_types, excluded.allowed_mime_types);

-- Uploads are scoped to the caller's own businesses via the path prefix
-- (the app writes `${business.id}/logo-...`).
drop policy if exists business_logos_insert on storage.objects;
create policy business_logos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select business_id::text
      from public.business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- SELECT: clients need visibility of their own uploaded rows — supabase-js
-- uploads execute INSERT ... RETURNING, which also requires the row to pass
-- a SELECT policy (PostgreSQL RLS rule). Same business-scope.
drop policy if exists business_logos_read on storage.objects;
create policy business_logos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select business_id::text
      from public.business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- Upserts (SettingsPage uses upsert:true) — same scope.
drop policy if exists business_logos_update on storage.objects;
create policy business_logos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select business_id::text
      from public.business_users
      where user_id = auth.uid() and is_active = true
    )
  )
  with check (
    bucket_id = 'business-logos'
    and (storage.foldername(name))[1] in (
      select business_id::text
      from public.business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- ── user-exports: private bucket ───────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-exports', 'user-exports', false, null, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = coalesce(storage.buckets.file_size_limit, excluded.file_size_limit),
      allowed_mime_types = coalesce(storage.buckets.allowed_mime_types, excluded.allowed_mime_types);

-- Deliberately NO client policies on user-exports: export-my-data uploads
-- with the service role (RLS bypass) and hands out 1-hour signed URLs.
-- RLS stays enabled and deny-all for anon/authenticated.
