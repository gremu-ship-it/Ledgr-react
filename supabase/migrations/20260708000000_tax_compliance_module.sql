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
-- 9. Seed: TPR pension config for every existing business.
--    tax_payable_account_id is resolved to account code '2132'
--    (Pension Payable) from the seeded chart of accounts. Businesses whose
--    CoA has not been seeded yet get NULL and can be linked later from
--    Tax > Tax Configurations, which now exposes the account pickers.
--    PayrollRepository.approve() throws a clear error if it is still NULL.
-- ----------------------------------------------------------------------------
insert into tax_configurations (
  business_id, tax_code, name, rate, employer_rate, employee_rate,
  description, mra_reference, effective_from, tax_payable_account_id
)
select
  b.id, 'tpr_pension', 'TPR Pension', 0, 10, 5,
  'Pension Act mandatory contribution — 10% employer, 5% employee',
  'Pension Act 2011', '2011-01-01',
  (select a.id from accounts a
    where a.business_id = b.id and a.code = '2132' limit 1)
from businesses b
where not exists (
  select 1 from tax_configurations tc
  where tc.business_id = b.id and tc.tax_code = 'tpr_pension'
);

-- Backfill: link any pre-existing tpr_pension rows that were seeded with a
-- NULL payable account by the original version of this migration.
update tax_configurations tc
set tax_payable_account_id = (
  select a.id from accounts a
  where a.business_id = tc.business_id and a.code = '2132' limit 1
)
where tc.tax_code = 'tpr_pension'
  and tc.tax_payable_account_id is null;

-- ----------------------------------------------------------------------------
-- 10. Seed: PAYE config, so payroll can resolve a PAYE payable account
--     without falling back to per-employee overrides. Account 2122
--     (PAYE Payable) per the seeded chart of accounts.
-- ----------------------------------------------------------------------------
insert into tax_configurations (
  business_id, tax_code, name, rate, description, mra_reference,
  effective_from, tax_payable_account_id
)
select
  b.id, 'paye', 'PAYE', 0,
  'Pay As You Earn — progressive bands per MRA, see paye_bands',
  'Taxation Act', '2011-01-01',
  (select a.id from accounts a
    where a.business_id = b.id and a.code = '2122' limit 1)
from businesses b
where not exists (
  select 1 from tax_configurations tc
  where tc.business_id = b.id and tc.tax_code = 'paye'
);

-- ----------------------------------------------------------------------------
-- 11. Seed: VAT standard config, linking both the output (2121) and input
--     (1135) VAT accounts so the VAT period-close journal can post
--     Dr Output VAT / Cr Input VAT / Cr VAT Payable.
-- ----------------------------------------------------------------------------
insert into tax_configurations (
  business_id, tax_code, name, rate, description, mra_reference,
  effective_from, tax_payable_account_id, tax_receivable_account_id
)
select
  b.id, 'vat_standard', 'VAT Standard', 17.5,
  'Standard-rated VAT per MRA. 17.5% from 1 Jan 2026 (was 16.5%).',
  'VAT Act', '2026-01-01',
  (select a.id from accounts a
    where a.business_id = b.id and a.code = '2121' limit 1),
  (select a.id from accounts a
    where a.business_id = b.id and a.code = '1135' limit 1)
from businesses b
where not exists (
  select 1 from tax_configurations tc
  where tc.business_id = b.id and tc.tax_code = 'vat_standard'
);

-- ----------------------------------------------------------------------------
-- AFTER RUNNING THIS MIGRATION:
--   1. Regenerate types: supabase gen types typescript --local > src/dal/types/database.generated.ts
--   2. Businesses created before their CoA was seeded may still have NULL
--      account links — set them from Tax > Tax Configurations.
-- ----------------------------------------------------------------------------