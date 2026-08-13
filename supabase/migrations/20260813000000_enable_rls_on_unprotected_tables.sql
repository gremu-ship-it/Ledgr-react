-- ============================================================================
-- Enable Row Level Security on the four tables that shipped without it.
--
-- BACKGROUND
--   The independent post-remediation verification (POST_REMEDIATION_VERIFICATION.md,
--   2026-08-13) confirmed that the remediation claimed in REMEDIATION_REPORT.md
--   (a migration named `20260728000005_enable_rls_on_unprotected_tables.sql`)
--   was never merged and does not exist on the working branch. PostgREST
--   exposes every table to any holder of the anon key (which ships in the
--   client bundle), so a table with RLS disabled is world-readable/writable to
--   any authenticated user:
--
--     invoice_delivery_events  -> cross-tenant read of every tenant's invoice
--                                  send/open/reminder audit trail.
--     recurring_invoices       -> cross-tenant read AND write of recurring
--                                  schedules (incl. auto_send).
--     api_usage                -> rate-limit buckets readable/writable by any
--                                  authenticated user (fill/clear another
--                                  key's bucket).
--     currencies               -> global ISO 4217 reference data (low impact,
--                                  but should be explicitly read-only).
--
-- POLICY MODEL
--   Follows the existing role-aware helpers from 20260728000008 /
--   20260728000009 rather than a hard-coded role list:
--     is_business_member()        -> read tier (any active member)
--     can_write_business_data()   -> write tier (mirrors usePermissions canWrite)
--     can_admin_business_data()   -> owner/admin (destructive)
--   SECURITY DEFINER helpers avoid recursive policy evaluation.
--
-- FAIL CLOSED
--   api_usage gets RLS with NO policy: only service_role (which bypasses RLS)
--   can read/write it. This matches how the real API gateway uses it via
--   consume_api_rate_limit(). A policy here would re-open the counter to
--   clients.
--
-- IDEMPOTENT
--   Guards with to_regclass(), drops any policy of the same name before
--   creating it, and never removes unrelated policies. Touches no data.
-- ============================================================================

do $$
declare
  tbl text;
  has_rls boolean;
begin
  -- ── invoice_delivery_events (business_id NOT NULL) ────────────────────────
  if to_regclass('public.invoice_delivery_events') is not null then
    alter table public.invoice_delivery_events enable row level security;

    drop policy if exists invoice_delivery_events_member_read on public.invoice_delivery_events;
    create policy invoice_delivery_events_member_read on public.invoice_delivery_events
      for select using (public.is_business_member(business_id));

    -- Insert allowed for writers (the app records "viewed" events client-side;
    -- the cron/edge functions write with service_role, which bypasses RLS).
    drop policy if exists invoice_delivery_events_writer_insert on public.invoice_delivery_events;
    create policy invoice_delivery_events_writer_insert on public.invoice_delivery_events
      for insert with check (public.can_write_business_data(business_id));

    -- Audit trail is append-only: no authenticated update/delete.
  end if;

  -- ── recurring_invoices (business_id NOT NULL) ─────────────────────────────
  if to_regclass('public.recurring_invoices') is not null then
    alter table public.recurring_invoices enable row level security;

    drop policy if exists recurring_invoices_member_read on public.recurring_invoices;
    create policy recurring_invoices_member_read on public.recurring_invoices
      for select using (public.is_business_member(business_id));

    drop policy if exists recurring_invoices_writer_insert on public.recurring_invoices;
    create policy recurring_invoices_writer_insert on public.recurring_invoices
      for insert with check (public.can_write_business_data(business_id));

    drop policy if exists recurring_invoices_writer_update on public.recurring_invoices;
    create policy recurring_invoices_writer_update on public.recurring_invoices
      for update using (public.can_write_business_data(business_id))
                  with check (public.can_write_business_data(business_id));

    drop policy if exists recurring_invoices_admin_delete on public.recurring_invoices;
    create policy recurring_invoices_admin_delete on public.recurring_invoices
      for delete using (public.can_admin_business_data(business_id));
  end if;

  -- ── api_usage (no business_id — service-role only) ────────────────────────
  -- Deliberately NO policies: authenticated users must not read or mutate rate
  -- limit counters. The API gateway's consume_api_rate_limit() RPC is granted
  -- to service_role only (20260730000003).
  if to_regclass('public.api_usage') is not null then
    alter table public.api_usage enable row level security;
  end if;

  -- ── currencies (global reference data — read-only) ────────────────────────
  if to_regclass('public.currencies') is not null then
    alter table public.currencies enable row level security;

    drop policy if exists currencies_read on public.currencies;
    create policy currencies_read on public.currencies
      for select to authenticated using (true);

    -- Reference data is never written by clients (seeded via migrations).
  end if;
end
$$;
