-- Security hardening for customer-configured outbound webhooks.
--
-- Webhook signing secrets are credentials: a recipient accepts a request as
-- Ledgr-originated when the HMAC validates. They must therefore never be
-- readable by ordinary business members. The delivery worker continues to use
-- the service role and is unaffected by these RLS changes.

-- API-key hashes and webhook HMAC secrets are owner/admin-only metadata.
drop policy if exists api_keys_business_read on public.api_keys;
create policy api_keys_business_read on public.api_keys
for select using (
  exists (
    select 1
    from public.business_users bu
    where bu.business_id = api_keys.business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in ('owner', 'admin')
  )
);

drop policy if exists webhooks_business_read on public.webhooks;
create policy webhooks_business_read on public.webhooks
for select using (
  exists (
    select 1
    from public.business_users bu
    where bu.business_id = webhooks.business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in ('owner', 'admin')
  )
);

-- A syntactic gate is not a complete SSRF defence (DNS and redirect checks
-- belong in the Edge Function), but it rejects common dangerous endpoint
-- forms before they reach the delivery worker: credentials in a URL,
-- localhost, IPv4 loopback/link-local/private ranges, and IPv6 loopback.
alter table public.webhooks
  drop constraint if exists webhooks_safe_https_url;
alter table public.webhooks
  add constraint webhooks_safe_https_url check (
    url ~* '^https://'
    and url !~* '^https://[^/]*@'
    and url !~* '^https://(localhost|localhost\\.|127\\.|0\\.|10\\.|192\\.168\\.|169\\.254\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.|\[::1\]|\[fc|\[fd|\[fe80:)'
  );

-- Existing webhook rows are retained for operational continuity. Review and
-- remove any endpoint that fails the new policy before relying on it as the
-- sole protection; the delivery functions enforce the same checks at runtime.
