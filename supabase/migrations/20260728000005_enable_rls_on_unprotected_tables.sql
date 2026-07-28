-- ─────────────────────────────────────────────────────────────────────────
-- Enable Row Level Security on the four tables that shipped without it
-- ─────────────────────────────────────────────────────────────────────────
-- A schema-wide audit of `create table` vs `enable row level security` found
-- 19 of 23 tables protected and four unprotected. Because PostgREST exposes
-- every table in the `public` schema, and the anon key is by design shipped in
-- the browser bundle, "no RLS" means "readable by anyone who loads the app".
--
--   * invoice_delivery_events — has business_id. Any authenticated user could
--     read every tenant's invoice send/open audit trail (who was invoiced,
--     when they opened it). Cross-tenant leak.
--   * recurring_invoices      — has business_id. Same leak, but also writable:
--     a user could point another tenant's recurring schedule at a new template
--     invoice, or deactivate their billing automation outright.
--   * api_usage               — rate-limit counters. A client holding the anon
--     key could zero its own row and bypass the 100 req/min throttle in
--     functions/api/index.ts entirely.
--   * currencies              — global ISO 4217 reference data. Low impact, but
--     it should be explicitly read-only rather than open by default.
--
-- Policies below follow the convention established in
-- 20260708000000_tax_compliance_module.sql and 20260723000000_capital_financing.sql:
-- `<table>_business_access`, scoped through business_users with is_active.
--
-- `for all using (...)` with no separate `with check` is deliberate and matches
-- the sibling migrations: Postgres reuses the USING expression as the WITH
-- CHECK expression for ALL, so reads and writes are constrained identically and
-- a user cannot insert a row belonging to another tenant.

-- ── invoice_delivery_events ──────────────────────────────────────────────
-- Note: send-invoice and invoice-open both write here. invoice-open runs with
-- the service role (RLS bypassed, unaffected). send-invoice runs with the anon
-- key plus the caller's JWT, so it needs the insert path this policy grants —
-- a select-only policy would silently break invoice delivery logging.
alter table public.invoice_delivery_events enable row level security;

create policy invoice_delivery_events_business_access on public.invoice_delivery_events
  for all using (
    business_id in (
      select business_id from public.business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- ── recurring_invoices ───────────────────────────────────────────────────
-- Users manage their own recurring schedules from the app;
-- process-invoice-automation sweeps them with the service role.
alter table public.recurring_invoices enable row level security;

create policy recurring_invoices_business_access on public.recurring_invoices
  for all using (
    business_id in (
      select business_id from public.business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- ── api_usage ────────────────────────────────────────────────────────────
-- Written exclusively by functions/api/index.ts under the service role, which
-- bypasses RLS. No policy is created on purpose: with RLS enabled and zero
-- policies, `authenticated` and `anon` get no access at all, which is exactly
-- the intent. Do not add a policy here without re-reading checkRateLimit().
alter table public.api_usage enable row level security;

-- ── currencies ───────────────────────────────────────────────────────────
-- Global reference data, not tenant-scoped. CurrencySelector and
-- exchangeRateService only ever read it; seeding is done by migration under
-- the service role. Read-only to signed-in users, no write path.
alter table public.currencies enable row level security;

create policy currencies_read on public.currencies
  for select to authenticated using (true);

comment on policy currencies_read on public.currencies is
  'ISO 4217 master data is global reference, readable by any signed-in user. '
  'Writes are migration/service-role only — there is deliberately no insert, '
  'update or delete policy.';
