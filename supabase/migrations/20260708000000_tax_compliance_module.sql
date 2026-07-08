-- ============================================================================
-- Migration: Tax Compliance Module (Phase 1 — schema)
-- Adds: tpr_pension tax code, dual-rate columns on tax_configurations,
--       tax_returns / tax_payments / tax_alerts tables, RLS policies, seed.
--
-- ASSUMPTION FLAGGED: RLS policies below follow the business_users
-- membership pattern inferred from the schema (business_users.user_id /
-- is_active). This was NOT verified against your actual policies on
-- invoices/expenses (that query was never run). Diff this against
-- `select * from pg_policies where tablename in ('invoices','expenses')`
-- before applying, and adjust role/command scoping if your existing
-- policies are more granular (e.g. per-role INSERT vs SELECT).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extend tax_code enum. Must commit before the new value can be used
--    in the same session (Postgres restriction on enum additions).
-- ----------------------------------------------------------------------------
alter type tax_code add value if not exists 'tpr_pension';

-- ----------------------------------------------------------------------------
-- 2. Dual-rate columns for TPR pension (10% employer / 5% employee).
--    tax_configurations.rate remains unused (0) for this tax_code; these
--    two columns are nullable and only populated for tpr_pension rows.
-- ----------------------------------------------------------------------------
alter table tax_configurations
  add column if not exists employer_rate numeric,
  add column if not exists employee_rate numeric;

-- ----------------------------------------------------------------------------
-- 3. New enums
-- ----------------------------------------------------------------------------
create type tax_return_status as enum ('pending', 'filed', 'paid', 'overdue', 'void');
create type tax_alert_type as enum ('14_day', '7_day', '1_day', 'due_date');
create type tax_alert_channel as enum ('email', 'sms');
create type tax_alert_status as enum ('pending', 'sent', 'failed');

-- ----------------------------------------------------------------------------
-- 4. tax_returns — one row per filing period per tax type
-- ----------------------------------------------------------------------------
create table tax_returns (
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

create index idx_tax_returns_business on tax_returns(business_id);
create index idx_tax_returns_status on tax_returns(business_id, status);
create index idx_tax_returns_due_date on tax_returns(due_date) where status in ('pending', 'filed');

-- ----------------------------------------------------------------------------
-- 5. tax_payments — mirrors invoice_payments / expense_payments
-- ----------------------------------------------------------------------------
create table tax_payments (
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

create index idx_tax_payments_return on tax_payments(tax_return_id);
create index idx_tax_payments_business on tax_payments(business_id);

-- ----------------------------------------------------------------------------
-- 6. tax_alerts — schedule table (populated in Phase 1, consumed in Phase 4)
-- ----------------------------------------------------------------------------
create table tax_alerts (
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

create index idx_tax_alerts_scheduled on tax_alerts(scheduled_for) where status = 'pending';

-- ----------------------------------------------------------------------------
-- 7. Trigger: keep updated_at current on tax_returns (matches likely pattern
--    used elsewhere for updated_at columns — verify against an existing
--    trigger, e.g. `select * from pg_trigger where tgname like '%updated_at%'`)
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_tax_returns_updated_at
  before update on tax_returns
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- 8. RLS — FLAGGED ASSUMPTION, see header note
-- ----------------------------------------------------------------------------
alter table tax_returns enable row level security;
alter table tax_payments enable row level security;
alter table tax_alerts enable row level security;

create policy tax_returns_business_access on tax_returns
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

create policy tax_payments_business_access on tax_payments
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

create policy tax_alerts_business_access on tax_alerts
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

-- ----------------------------------------------------------------------------
-- 9. Seed: TPR pension config for every existing business.
--    tax_payable_account_id / tax_receivable_account_id left NULL —
--    these are nullable per the existing schema, and account codes for
--    "Pension Payable" were never confirmed against your seeded CoA.
--    Link them via the tax settings UI after migration, or update this
--    insert with the correct account_code lookup before running.
-- ----------------------------------------------------------------------------
insert into tax_configurations (
  business_id, tax_code, name, rate, employer_rate, employee_rate,
  description, mra_reference, effective_from
)
select
  id, 'tpr_pension', 'TPR Pension', 0, 10, 5,
  'Pension Act mandatory contribution — 10% employer, 5% employee',
  'Pension Act 2011', '2011-01-01'
from businesses
where not exists (
  select 1 from tax_configurations tc
  where tc.business_id = businesses.id and tc.tax_code = 'tpr_pension'
);

-- ----------------------------------------------------------------------------
-- AFTER RUNNING THIS MIGRATION:
--   1. Regenerate types: supabase gen types typescript --local > src/dal/types/database.generated.ts
--   2. Link TPR's tax_payable_account_id to your Pension Payable account
--      per business (via UI, once built, or a manual update).
--   3. Verify RLS policies above against your existing pattern (see header).
-- ----------------------------------------------------------------------------