# Phase 8B.4 — Storage Reconstruction

**Status:** ✅ COMPLETE — both buckets + policies reconstructed in a
migration; **8/8 storage tests passing** on a fresh replay (60 migrations).

## Migration

- `supabase/migrations/20260815000004_phase8b_storage.sql`

## Buckets

| Bucket | Visibility | Purpose | Evidence |
|---|---|---|---|
| `business-logos` | **public** | business logo uploads; client `getPublicUrl` | src/pages/SettingsPage.tsx |
| `user-exports` | **private** | GDPR/data-export zips; service-role upload + 1-hour signed URLs | supabase/functions/export-my-data/index.ts |

## Path conventions [VERIFIED]

- `business-logos`: `${business.id}/logo-${Date.now()}.${ext}` (upload with
  `upsert: true`) — **the first path segment is the business id**, which is
  what the policies key on.
- `user-exports`: `${userId}/${Date.now()}_ledgr_export.zip` — owner-scoped,
  accessed only through signed URLs.

## Policies (storage.objects)

| Policy | Command | Roles | Expression | Classification |
|---|---|---|---|---|
| `business_logos_read` | SELECT | authenticated | `bucket_id='business-logos' AND (storage.foldername(name))[1] ∈ caller's businesses` | [INFERRED shape, VERIFIED path basis] |
| `business_logos_insert` | INSERT (WITH CHECK) | authenticated | same scope | [INFERRED shape] |
| `business_logos_update` | UPDATE (USING + WITH CHECK) | authenticated | same scope | [INFERRED shape] |
| (none on `user-exports`) | — | — | deny-all for clients; service_role bypasses RLS | [VERIFIED] |

### Why the read policy is required (found during testing)

PostgreSQL's RLS applies to `INSERT ... RETURNING`: the returned row must
also pass a **SELECT** policy, otherwise the insert fails with "new row
violates row-level security policy". The supabase-js storage upload path uses
`INSERT ... RETURNING`, so `business_logos_read` is mandatory — this was
caught by the test suite (insert without the read policy failed; with it,
passes).

### Business isolation

The upload policies verify that the **first path folder** (the business id in
the app's convention) is one of the caller's active businesses. Cross-tenant
uploads are rejected (tested: A-owner cannot upload into B's folder, cannot
upload into `user-exports`, anon cannot upload).

## UNKNOWNs (documented, not fabricated)

- `file_size_limit` / `allowed_mime_types` on the legacy buckets — no
  evidence; left `NULL` (no limit). Set per environment if required.
- The legacy policies' exact shape — production was out of scope; the chosen
  shape follows the app's verified path convention.

## Test suite

`tests/database/storage_reconstruction.test.js` — 8/8 PASS:
bucket existence + visibility, policies present, own-folder upload allowed,
cross-tenant upload denied, wrong-bucket upload denied, anon upload denied,
service_role export upload allowed.

## Deployment note

Because the migration inserts into `storage.buckets`/`storage.objects` with
`on conflict do update`, it is safe on existing environments (legacy buckets
are updated, policies are recreated idempotently).
