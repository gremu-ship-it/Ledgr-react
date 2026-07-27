-- ============================================================================
-- Migration: storage bucket for tax payment receipts
--
-- tax_payments.receipt_path has existed since the tax compliance module was
-- added, but there was no bucket to store anything in and no policy to
-- govern access. This creates a private bucket and scopes it by the leading
-- path segment, which TaxPaymentRepository.uploadReceipt() sets to the
-- business_id: `{business_id}/{tax_return_id}/{timestamp}.{ext}`.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tax-receipts',
  'tax-receipts',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Members of the owning business may read their receipts.
drop policy if exists tax_receipts_select on storage.objects;
create policy tax_receipts_select on storage.objects
  for select using (
    bucket_id = 'tax-receipts'
    and (storage.foldername(name))[1] in (
      select business_id::text from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- Members may upload receipts into their own business's folder.
drop policy if exists tax_receipts_insert on storage.objects;
create policy tax_receipts_insert on storage.objects
  for insert with check (
    bucket_id = 'tax-receipts'
    and (storage.foldername(name))[1] in (
      select business_id::text from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- Members may replace/remove a receipt they attached in error.
drop policy if exists tax_receipts_update on storage.objects;
create policy tax_receipts_update on storage.objects
  for update using (
    bucket_id = 'tax-receipts'
    and (storage.foldername(name))[1] in (
      select business_id::text from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

drop policy if exists tax_receipts_delete on storage.objects;
create policy tax_receipts_delete on storage.objects
  for delete using (
    bucket_id = 'tax-receipts'
    and (storage.foldername(name))[1] in (
      select business_id::text from business_users
      where user_id = auth.uid() and is_active = true
    )
  );
