-- ============================================================================
-- Migration: Tax Compliance Module — schema
-- Adds: dual-rate columns on tax_configurations, tax_returns / tax_payments /
--       tax_alerts tables, RLS policies, seed.
--
-- The 'tpr_pension' tax_code enum value is added by the preceding migration
-- 20260707000000_tax_code_add_tpr_pension.sql — it MUST be committed in a
-- separate transaction before the seed at the bottom of this file can use it.
--
-- RLS policies below follow the business_users membership pattern used by
-- the rest of the schema (see 20260723000000_capital_financing.sql, which
-- uses the identical `business_id in (select business_id from business_users
-- where user_id = auth.uid() and is_active = true)` shape).
--
-- Idempotent throughout so it can be re-run safely.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 2. Dual-rate columns for TPR pension (10% employer / 5% employee).
--    tax_configurations.rate remains unused (0) for this tax_code; these
--    two columns are nullable and only populated for tpr_pension rows.
-- ----------------------------------------------------------------------------
alter table tax_configurations
  add column if not exists employer_rate numeric,
  add column if not exists employee_rate numeric;

-- ----------------------------------------------------------------------------
-- 3. New enums (guarded so the migration is re-runnable)
-- ----------------------------------------------------------------------------
do $$ begin
  create type tax_return_status as enum ('pending', 'filed', 'paid', 'overdue', 'void');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tax_alert_type as enum ('14_day', '7_day', '1_day', 'due_date');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tax_alert_channel as enum ('email', 'sms');
exception when duplicate_object then null; end $$;

do $$ begin
  create type tax_alert_status as enum ('pending', 'sent', 'failed');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 4. tax_returns — one row per filing period per tax type
-- ----------------------------------------------------------------------------
create table if not exists tax_returns (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id),
  tax_code           tax_code not null,
  period_label       text not null,          -- e.g. '2026-06' (VAT/PAYE) or payroll run_number (TPR)
  period_start       date not null,
  period_end         date not null,
  due_date           date not null,

  -- VAT-specific
  output_tax         numeric not null default 0,
  input_tax          numeric not null default 0,

  -- PAYE / TPR-specific (gross liability before any offset)
  gross_amount       numeric not null default 0,

  -- always populated regardless of tax type
  amount_due         numeric not null default 0,
  amount_paid        numeric not null default 0,

  status             tax_return_status not null default 'pending',
  journal_entry_id   uuid references journal_entries(id),
  filed_ref          text,                    -- MRA acknowledgement / reference number
  filed_at           timestamptz,

  source_type        text,                    -- 'payroll_run' | 'vat_period' | 'manual'
  source_id          uuid,                    -- e.g. payroll_runs.id

  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (business_id, tax_code, period_label)
);

create index if not exists idx_tax_returns_business on tax_returns(business_id);
create index if not exists idx_tax_returns_status on tax_returns(business_id, status);
create index if not exists idx_tax_returns_due_date on tax_returns(due_date) where status in ('pending', 'filed');

-- ----------------------------------------------------------------------------
-- 5. tax_payments — mirrors invoice_payments / expense_payments
-- ----------------------------------------------------------------------------
create table if not exists tax_payments (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id),
  tax_return_id      uuid not null references tax_returns(id),
  payment_date       date not null default current_date,
  amount             numeric not null,
  payment_method     payment_method not null default 'bank_transfer',
  bank_account_id    uuid references accounts(id),
  reference          text,
  receipt_path       text,                    -- Supabase Storage path
  journal_entry_id   uuid references journal_entries(id),
  notes              text,
  created_by         uuid,
  created_at         timestamptz not null default now()
);

create index if not exists idx_tax_payments_return on tax_payments(tax_return_id);
create index if not exists idx_tax_payments_business on tax_payments(business_id);

-- ----------------------------------------------------------------------------
-- 6. tax_alerts — schedule table (populated in Phase 1, consumed in Phase 4)
-- ----------------------------------------------------------------------------
create table if not exists tax_alerts (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id),
  tax_return_id      uuid not null references tax_returns(id),
  alert_type         tax_alert_type not null,
  scheduled_for      date not null,
  sent_at            timestamptz,
  channel            tax_alert_channel not null default 'email',
  status             tax_alert_status not null default 'pending',
  created_at         timestamptz not null default now(),
  unique (tax_return_id, alert_type, channel)
);

create index if not exists idx_tax_alerts_scheduled on tax_alerts(scheduled_for) where status = 'pending';

-- ----------------------------------------------------------------------------
-- 7. Trigger: keep updated_at current on tax_returns.
--    public.set_updated_at() is shared with 20260726000002_subscription_
--    payments.sql (identical body); `create or replace` + schema-qualified
--    name keeps the two migrations compatible in either apply order.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_tax_returns_updated_at on public.tax_returns;
create trigger trg_tax_returns_updated_at
  before update on public.tax_returns
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. RLS — same business_users membership pattern as loans /
--    loan_repayments / share_transactions in the capital financing migration.
-- ----------------------------------------------------------------------------
alter table tax_returns enable row level security;
alter table tax_payments enable row level security;
alter table tax_alerts enable row level security;

drop policy if exists tax_returns_business_access on tax_returns;
create policy tax_returns_business_access on tax_returns
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

drop policy if exists tax_payments_business_access on tax_payments;
create policy tax_payments_business_access on tax_payments
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

drop policy if exists tax_alerts_business_access on tax_alerts;
create policy tax_alerts_business_access on tax_alerts
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- ----------------------------------------------------------------------------
-- NOTE: seeding of tax_configurations rows (and the 'tpr_pension' enum value
-- they depend on) lives in the later migrations
--   20260727000012_tax_code_add_tpr_pension.sql
--   20260727000013_tax_config_seed_and_account_links.sql
-- This file was already applied in production, so edits here never re-run
-- there; anything that must reach an existing database has to be a NEW
-- forward migration. Keeping this file schema-only makes that boundary clear.
-- ----------------------------------------------------------------------------
