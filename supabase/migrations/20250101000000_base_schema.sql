-- ============================================================================
-- Ledgr — BASE SCHEMA (Phase 8A.1 authoritative baseline reconstruction)
-- ============================================================================
--
-- PURPOSE
--   Reconstructs the foundational objects of the Ledgr staging database that
--   no existing migration creates. Together with the incremental migrations in
--   this directory, replay must reproduce the current staging schema.
--
--   BASE MIGRATION  +  EXISTING INCREMENTAL MIGRATIONS  =  CURRENT STAGING SCHEMA
--
-- EVIDENCE BASIS (no live capture was possible during this phase; every
-- definition below is sourced from repository evidence):
--   • src/dal/types/database.generated.ts — generated from the LIVE staging
--     database (PostgREST 14.5): tables, columns, nullability, enums, FK names.
--   • supabase/migrations/*.sql — exact column types, defaults, constraints
--     where migrations ALTER base tables; conventions for uuid PKs, timestamps.
--   • src/dal, src/lib, supabase/functions — runtime column usage and formats.
--
-- CONFIDENCE MARKERS
--   [EVIDENCED]  directly evidenced in repository (migration DDL / generated types)
--   [CONVENTION] strong convention evidenced across migration-created tables
--   [INFERRED]   no direct evidence; MUST be verified against live staging
--                before this baseline is certified
--
-- KNOWN GAPS — deliberately NOT fabricated here (bodies unavailable in the
-- repository; live capture required):
--   • 9 base RPC bodies: accept_invitation, create_business_with_owner,
--     current_user_role, get_enum_values, get_user_role, invite_member,
--     log_manual_audit_event, seed_new_business, verify_audit_chain
--     (signatures in database.generated.ts; bodies not in repo). show_limit and
--     show_trgm are NOT gaps: they are pg_trgm extension functions (verified on
--     PostgreSQL 18) and the extension is created below.
--   • 4 view bodies: v_ar_ageing, v_asset_register, v_reorder_alerts, v_trial_balance
--   • RLS policies on base tables NOT rebuilt by migrations (invoices, journal_*,
--     stock_*, products, budgets, bank_statements, expenses, tax_configurations,
--     audit_log, profiles, user_profiles, paye_bands, accounting_periods, currencies)
--   • Base-table indexes, updated_at triggers, storage buckets/policies,
--     exact enum label ORDER vs live, exact numeric precisions where [INFERRED].
--
-- SAFETY
--   Read-only reconstruction. No accounting logic is changed. Journal, invoice,
--   payment, inventory, payroll, tax and audit structures are preserved as
--   evidenced. No secrets are embedded.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- ENUMS (12 base enums — labels and order from database.generated.ts Constants,
-- which reflects the live staging enum order)
-- ────────────────────────────────────────────────────────────────────────────

-- account_subtype
do $$ begin
  if to_regtype('public.account_subtype') is null then
    create type account_subtype as enum (
      'current_asset',
      'non_current_asset',
      'fixed_asset',
      'current_liability',
      'non_current_liability',
      'share_capital',
      'retained_earnings',
      'reserves',
      'revenue',
      'other_income',
      'cost_of_sales',
      'operating_expense',
      'finance_cost',
      'tax_expense',
      'depreciation_amortisation'
    );
  end if;
end $$;

-- account_type
do $$ begin
  if to_regtype('public.account_type') is null then
    create type account_type as enum (
      'asset',
      'liability',
      'equity',
      'income',
      'expense'
    );
  end if;
end $$;

-- asset_status
do $$ begin
  if to_regtype('public.asset_status') is null then
    create type asset_status as enum (
      'active',
      'disposed',
      'fully_depreciated',
      'impaired',
      'under_construction'
    );
  end if;
end $$;

-- currency_code
do $$ begin
  if to_regtype('public.currency_code') is null then
    create type currency_code as enum (
      'MWK',
      'USD',
      'EUR',
      'GBP',
      'ZAR',
      'ZMW',
      'TZS',
      'KES',
      'UGX'
    );
  end if;
end $$;

-- depreciation_method
do $$ begin
  if to_regtype('public.depreciation_method') is null then
    create type depreciation_method as enum (
      'straight_line',
      'reducing_balance',
      'units_of_production',
      'sum_of_years_digits'
    );
  end if;
end $$;

-- invoice_status
do $$ begin
  if to_regtype('public.invoice_status') is null then
    create type invoice_status as enum (
      'draft',
      'sent',
      'partially_paid',
      'paid',
      'overdue',
      'void',
      'credit_note'
    );
  end if;
end $$;

-- journal_status
do $$ begin
  if to_regtype('public.journal_status') is null then
    create type journal_status as enum (
      'draft',
      'posted',
      'reversed'
    );
  end if;
end $$;

-- payment_method
do $$ begin
  if to_regtype('public.payment_method') is null then
    create type payment_method as enum (
      'cash',
      'bank_transfer',
      'cheque',
      'airtel_money',
      'tnm_mpamba',
      'card',
      'other'
    );
  end if;
end $$;

-- payroll_status
do $$ begin
  if to_regtype('public.payroll_status') is null then
    create type payroll_status as enum (
      'draft',
      'approved',
      'paid',
      'void'
    );
  end if;
end $$;

-- stock_movement_type
do $$ begin
  if to_regtype('public.stock_movement_type') is null then
    create type stock_movement_type as enum (
      'purchase',
      'sale',
      'adjustment_in',
      'adjustment_out',
      'transfer_in',
      'transfer_out',
      'return_in',
      'return_out',
      'opening_balance',
      'write_off'
    );
  end if;
end $$;

-- tax_code
do $$ begin
  if to_regtype('public.tax_code') is null then
    create type tax_code as enum (
      'vat_standard',
      'vat_zero',
      'vat_exempt',
      'paye',
      'wht_15',
      'wht_20',
      'wht_10',
      'cit',
      'fbt',
      'none',
      'tpr_pension'
    );
  end if;
end $$;

-- user_role
do $$ begin
  if to_regtype('public.user_role') is null then
    create type user_role as enum (
      'owner',
      'admin',
      'accountant',
      'payroll_manager',
      'supervisor',
      'data_entry',
      'inventory_manager',
      'sales_clerk',
      'auditor',
      'viewer',
      'purchasing_officer',
      'warehouse_worker',
      'sales_manager',
      'customer_service_rep',
      'tax_compliance_officer',
      'treasury_manager',
      'asset_manager',
      'board_member',
      'branch_manager'
    );
  end if;
end $$;

create extension if not exists pg_trgm;

-- ────────────────────────────────────────────────────────────────────────────
-- TABLE currencies  (base dependency: 13 base tables hold FKs to currencies.code)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.currencies (
  code text primary key check (code = upper(code) and char_length(code) = 3),
  name text not null,
  symbol text not null default '',
  decimal_places integer not null default 2,
  is_active boolean not null default true,
  is_primary boolean not null default false,
  is_frankfurter_supported boolean not null default false,
  created_at timestamptz not null default now()
);  -- [EVIDENCED] 20260727000000_multi_currency_ias21.sql

alter table public.currencies enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
-- TABLE audit_log  (18 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
    business_id uuid not null  -- [INFERRED] verify against live staging
,
    changed_fields text[]  -- [CONVENTION]
,
    entry_hash text  -- [CONVENTION]
,
    event_type text not null  -- [CONVENTION]
,
    id bigserial primary key  -- [EVIDENCED]
,
    ip_address inet not null  -- [EVIDENCED]
,
    new_values jsonb  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    occurred_at timestamptz not null  -- [CONVENTION]
,
    old_values jsonb  -- [CONVENTION]
,
    prev_hash text  -- [CONVENTION]
,
    resource_id text  -- [CONVENTION]
,
    resource_ref text  -- [CONVENTION]
,
    resource_type text not null  -- [CONVENTION]
,
    session_id text  -- [CONVENTION]
,
    user_agent text  -- [CONVENTION]
,
    user_email text  -- [CONVENTION]
,
    user_id uuid  -- [INFERRED] verify against live staging
);

alter table public.audit_log enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE businesses  (35 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.businesses (
    address_line1 text  -- [CONVENTION]
,
    address_line2 text  -- [CONVENTION]
,
    base_currency text not null  -- [CONVENTION]
,
    brand_color text  -- [CONVENTION]
,
    city text  -- [CONVENTION]
,
    coa_template text not null  -- [CONVENTION]
,
    country text  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    default_payment_method payment_method  -- [EVIDENCED] enum
,
    deleted_at timestamptz  -- [CONVENTION]
,
    email text  -- [CONVENTION]
,
    expense_next_number integer not null  -- [EVIDENCED]
,
    expense_prefix text  -- [CONVENTION]
,
    financial_year_start text not null  -- [EVIDENCED]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    invoice_next_number integer not null  -- [EVIDENCED]
,
    invoice_prefix text  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    logo_url text  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    payroll_next_number integer not null  -- [EVIDENCED]
,
    payroll_prefix text  -- [CONVENTION]
,
    phone text  -- [CONVENTION]
,
    plan_expires_at timestamptz  -- [CONVENTION]
,
    plan_tier text not null default 'free'  -- [EVIDENCED]
,
    plan_updated_at timestamptz  -- [CONVENTION]
,
    registration_number text  -- [CONVENTION]
,
    timezone text not null  -- [CONVENTION]
,
    tpin text  -- [CONVENTION]
,
    trading_name text  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    vat_number text  -- [CONVENTION]
,
    vat_period text  -- [CONVENTION]
,
    vat_registered boolean not null  -- [CONVENTION]
,
    website text  -- [CONVENTION]
,
    constraint businesses_plan_tier_check check (plan_tier in ('free', 'growth', 'pro', 'enterprise'))  -- [EVIDENCED] 20260726000001_add_business_plan_tier.sql
);

alter table public.businesses drop constraint if exists businesses_base_currency_fkey;
alter table public.businesses add constraint businesses_base_currency_fkey foreign key (base_currency) references public.currencies(code);

alter table public.businesses enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE paye_bands  (10 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.paye_bands (
    band_from numeric not null  -- [CONVENTION]
,
    band_label text  -- [CONVENTION]
,
    band_to numeric  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    effective_from date not null  -- [EVIDENCED]
,
    effective_to date  -- [EVIDENCED]
,
    fiscal_year text not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    rate numeric not null  -- [CONVENTION]
);

alter table public.paye_bands drop constraint if exists paye_bands_business_id_fkey;
alter table public.paye_bands add constraint paye_bands_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.paye_bands enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE product_categories  (5 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.product_categories (
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    parent_id uuid  -- [EVIDENCED] FK
);

alter table public.product_categories drop constraint if exists product_categories_business_id_fkey;
alter table public.product_categories add constraint product_categories_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.product_categories drop constraint if exists product_categories_parent_id_fkey;
alter table public.product_categories add constraint product_categories_parent_id_fkey foreign key (parent_id) references public.product_categories(id);

alter table public.product_categories enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE profiles  (2 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
    full_name text  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
);

alter table public.profiles enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE user_profiles  (11 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.user_profiles (
    avatar_url text  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    deletion_finalized_at timestamptz  -- [CONVENTION]
,
    deletion_requested_at timestamptz  -- [CONVENTION]
,
    full_name text not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_platform_admin boolean not null  -- [CONVENTION]
,
    phone text  -- [CONVENTION]
,
    preferred_language text default 'en'  -- [EVIDENCED]
,
    preferred_currency currency_code  -- [EVIDENCED] enum
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    constraint user_profiles_preferred_language_check check (preferred_language in ('en', 'ny', 'sw', 'fr', 'pt'))  -- [EVIDENCED] 20260724000000_add_user_language_preference.sql
);

alter table public.user_profiles enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE accounting_periods  (10 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.accounting_periods (
    business_id uuid not null  -- [EVIDENCED] FK
,
    closed_at timestamptz  -- [CONVENTION]
,
    closed_by text  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_closed boolean not null  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    period_end date not null  -- [EVIDENCED]
,
    period_start date not null  -- [EVIDENCED]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.accounting_periods drop constraint if exists accounting_periods_business_id_fkey;
alter table public.accounting_periods add constraint accounting_periods_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.accounting_periods enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE branches  (10 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.branches (
    business_id uuid not null  -- [EVIDENCED] FK
,
    code text  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    deleted_at timestamptz  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    location text  -- [CONVENTION]
,
    manager_id text  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.branches drop constraint if exists branches_business_id_fkey;
alter table public.branches add constraint branches_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.branches enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE budgets  (11 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.budgets (
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    fiscal_year text not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    period_end date not null  -- [EVIDENCED]
,
    period_start date not null  -- [EVIDENCED]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.budgets drop constraint if exists budgets_business_id_fkey;
alter table public.budgets add constraint budgets_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.budgets enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE business_users  (13 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.business_users (
    accepted_at timestamptz  -- [CONVENTION]
,
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    invitation_expires_at timestamptz  -- [CONVENTION]
,
    invitation_token text  -- [CONVENTION]
,
    invited_at timestamptz  -- [CONVENTION]
,
    invited_by uuid  -- [INFERRED] verify against live staging
,
    is_active boolean not null default true  -- [CONVENTION]
,
    role user_role not null  -- [EVIDENCED] enum
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    user_id uuid not null  -- [EVIDENCED]
,
    unique (business_id, user_id)  -- [EVIDENCED] migrations use ON CONFLICT on these columns (20260728000003/20260728000002)
);

alter table public.business_users drop constraint if exists business_users_branch_id_fkey;
alter table public.business_users add constraint business_users_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.business_users drop constraint if exists business_users_business_id_fkey;
alter table public.business_users add constraint business_users_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.business_users enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE departments  (11 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.departments (
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    code text  -- [CONVENTION]
,
    cost_centre text  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    deleted_at timestamptz  -- [CONVENTION]
,
    head_user_id text  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.departments drop constraint if exists departments_branch_id_fkey;
alter table public.departments add constraint departments_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.departments drop constraint if exists departments_business_id_fkey;
alter table public.departments add constraint departments_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.departments enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE inventory_locations  (8 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_locations (
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    code text  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    is_default boolean not null  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
);

alter table public.inventory_locations drop constraint if exists inventory_locations_branch_id_fkey;
alter table public.inventory_locations add constraint inventory_locations_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.inventory_locations drop constraint if exists inventory_locations_business_id_fkey;
alter table public.inventory_locations add constraint inventory_locations_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.inventory_locations enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE journal_entries  (20 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.journal_entries (
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    currency text not null  -- [CONVENTION]
,
    department_id uuid  -- [EVIDENCED] FK
,
    description text not null  -- [CONVENTION]
,
    entry_date date not null  -- [EVIDENCED]
,
    entry_number text not null  -- [CONVENTION]
,
    exchange_rate numeric(20,10) not null  -- [EVIDENCED]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    period_id uuid  -- [EVIDENCED] FK
,
    posted_at timestamptz  -- [CONVENTION]
,
    posted_by text  -- [CONVENTION]
,
    reference text  -- [CONVENTION]
,
    reversal_of uuid  -- [EVIDENCED] FK
,
    reversed_by uuid  -- [EVIDENCED] FK
,
    source_id text  -- [CONVENTION]
,
    source_type text  -- [CONVENTION]
,
    status journal_status not null  -- [EVIDENCED] enum
);

alter table public.journal_entries drop constraint if exists journal_entries_branch_id_fkey;
alter table public.journal_entries add constraint journal_entries_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.journal_entries drop constraint if exists journal_entries_business_id_fkey;
alter table public.journal_entries add constraint journal_entries_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.journal_entries drop constraint if exists journal_entries_currency_fkey;
alter table public.journal_entries add constraint journal_entries_currency_fkey foreign key (currency) references public.currencies(code);
alter table public.journal_entries drop constraint if exists journal_entries_department_id_fkey;
alter table public.journal_entries add constraint journal_entries_department_id_fkey foreign key (department_id) references public.departments(id);
alter table public.journal_entries drop constraint if exists journal_entries_period_id_fkey;
alter table public.journal_entries add constraint journal_entries_period_id_fkey foreign key (period_id) references public.accounting_periods(id);
alter table public.journal_entries drop constraint if exists journal_entries_reversal_of_fkey;
alter table public.journal_entries add constraint journal_entries_reversal_of_fkey foreign key (reversal_of) references public.journal_entries(id);
alter table public.journal_entries drop constraint if exists journal_entries_reversed_by_fkey;
alter table public.journal_entries add constraint journal_entries_reversed_by_fkey foreign key (reversed_by) references public.journal_entries(id);

alter table public.journal_entries enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE payroll_runs  (21 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.payroll_runs (
    approved_at timestamptz  -- [CONVENTION]
,
    approved_by text  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    journal_entry_id uuid  -- [EVIDENCED] FK
,
    notes text  -- [CONVENTION]
,
    pay_date date not null  -- [EVIDENCED]
,
    paye_filed_at timestamptz  -- [CONVENTION]
,
    paye_return_ref text  -- [CONVENTION]
,
    payroll_period text not null  -- [CONVENTION]
,
    period_end date not null  -- [EVIDENCED]
,
    period_start date not null  -- [EVIDENCED]
,
    run_number text not null  -- [CONVENTION]
,
    status payroll_status not null  -- [EVIDENCED] enum
,
    total_gross numeric not null  -- [CONVENTION]
,
    total_net numeric not null  -- [CONVENTION]
,
    total_other_deductions numeric not null  -- [CONVENTION]
,
    total_paye numeric not null  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.payroll_runs drop constraint if exists payroll_runs_business_id_fkey;
alter table public.payroll_runs add constraint payroll_runs_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.payroll_runs drop constraint if exists payroll_runs_journal_entry_id_fkey;
alter table public.payroll_runs add constraint payroll_runs_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id);

alter table public.payroll_runs enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE stock_transfers  (15 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_transfers (
    approved_at timestamptz  -- [CONVENTION]
,
    approved_by uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    dispatched_at timestamptz  -- [CONVENTION]
,
    from_location_id uuid not null  -- [EVIDENCED] FK
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    received_at timestamptz  -- [CONVENTION]
,
    received_by uuid  -- [EVIDENCED] FK
,
    requested_by uuid  -- [EVIDENCED] FK
,
    status text not null  -- [CONVENTION]
,
    to_location_id uuid not null  -- [EVIDENCED] FK
,
    transfer_number text not null  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.stock_transfers drop constraint if exists stock_transfers_approved_by_fkey;
alter table public.stock_transfers add constraint stock_transfers_approved_by_fkey foreign key (approved_by) references public.user_profiles(id);
alter table public.stock_transfers drop constraint if exists stock_transfers_business_id_fkey;
alter table public.stock_transfers add constraint stock_transfers_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.stock_transfers drop constraint if exists stock_transfers_from_location_id_fkey;
alter table public.stock_transfers add constraint stock_transfers_from_location_id_fkey foreign key (from_location_id) references public.inventory_locations(id);
alter table public.stock_transfers drop constraint if exists stock_transfers_received_by_fkey;
alter table public.stock_transfers add constraint stock_transfers_received_by_fkey foreign key (received_by) references public.user_profiles(id);
alter table public.stock_transfers drop constraint if exists stock_transfers_requested_by_fkey;
alter table public.stock_transfers add constraint stock_transfers_requested_by_fkey foreign key (requested_by) references public.user_profiles(id);
alter table public.stock_transfers drop constraint if exists stock_transfers_to_location_id_fkey;
alter table public.stock_transfers add constraint stock_transfers_to_location_id_fkey foreign key (to_location_id) references public.inventory_locations(id);

alter table public.stock_transfers enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE accounts  (28 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.accounts (
    account_subtype account_subtype  -- [EVIDENCED] enum
,
    account_type account_type not null  -- [EVIDENCED] enum
,
    bank_account_number text  -- [CONVENTION]
,
    bank_branch text  -- [CONVENTION]
,
    bank_name text  -- [CONVENTION]
,
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    code text not null  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    currency text not null  -- [CONVENTION]
,
    deleted_at timestamptz  -- [CONVENTION]
,
    department_id uuid  -- [EVIDENCED] FK
,
    description text  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    is_bank_account boolean not null  -- [CONVENTION]
,
    is_group boolean not null  -- [CONVENTION]
,
    is_system boolean not null  -- [CONVENTION]
,
    mobile_money_number text  -- [CONVENTION]
,
    mobile_money_type text  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    normal_balance text not null  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    opening_balance numeric not null  -- [CONVENTION]
,
    opening_balance_date text  -- [CONVENTION]
,
    parent_id uuid  -- [EVIDENCED] FK
,
    tax_code tax_code  -- [EVIDENCED] enum
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.accounts drop constraint if exists accounts_branch_id_fkey;
alter table public.accounts add constraint accounts_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.accounts drop constraint if exists accounts_business_id_fkey;
alter table public.accounts add constraint accounts_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.accounts drop constraint if exists accounts_currency_fkey;
alter table public.accounts add constraint accounts_currency_fkey foreign key (currency) references public.currencies(code);
alter table public.accounts drop constraint if exists accounts_department_id_fkey;
alter table public.accounts add constraint accounts_department_id_fkey foreign key (department_id) references public.departments(id);
alter table public.accounts drop constraint if exists accounts_parent_id_fkey;
alter table public.accounts add constraint accounts_parent_id_fkey foreign key (parent_id) references public.accounts(id);

alter table public.accounts enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE asset_categories  (13 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.asset_categories (
    accumulated_dep_account_id uuid  -- [EVIDENCED] FK
,
    asset_account_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    dep_expense_account_id uuid  -- [EVIDENCED] FK
,
    depreciation_method depreciation_method not null  -- [EVIDENCED] enum
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    is_depreciable boolean not null default true  -- [EVIDENCED]
,
    mra_depreciation_rate numeric  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    residual_percent numeric not null  -- [CONVENTION]
,
    useful_life_years numeric  -- [CONVENTION]
);

alter table public.asset_categories drop constraint if exists asset_categories_accumulated_dep_account_id_fkey;
alter table public.asset_categories add constraint asset_categories_accumulated_dep_account_id_fkey foreign key (accumulated_dep_account_id) references public.accounts(id);
alter table public.asset_categories drop constraint if exists asset_categories_asset_account_id_fkey;
alter table public.asset_categories add constraint asset_categories_asset_account_id_fkey foreign key (asset_account_id) references public.accounts(id);
alter table public.asset_categories drop constraint if exists asset_categories_business_id_fkey;
alter table public.asset_categories add constraint asset_categories_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.asset_categories drop constraint if exists asset_categories_dep_expense_account_id_fkey;
alter table public.asset_categories add constraint asset_categories_dep_expense_account_id_fkey foreign key (dep_expense_account_id) references public.accounts(id);

alter table public.asset_categories enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE bank_statements  (9 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.bank_statements (
    account_id uuid not null  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    closing_balance numeric not null  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    opening_balance numeric not null  -- [CONVENTION]
,
    source text  -- [CONVENTION]
,
    statement_date date not null  -- [EVIDENCED]
,
    uploaded_by text  -- [CONVENTION]
);

alter table public.bank_statements drop constraint if exists bank_statements_account_id_fkey;
alter table public.bank_statements add constraint bank_statements_account_id_fkey foreign key (account_id) references public.accounts(id);
alter table public.bank_statements drop constraint if exists bank_statements_business_id_fkey;
alter table public.bank_statements add constraint bank_statements_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.bank_statements enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE budget_lines  (21 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.budget_lines (
    account_id uuid not null  -- [EVIDENCED] FK
,
    annual_total numeric  -- [CONVENTION]
,
    branch_id uuid  -- [EVIDENCED] FK
,
    budget_id uuid not null  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    department_id uuid  -- [EVIDENCED] FK
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    m01_amount numeric not null  -- [CONVENTION]
,
    m02_amount numeric not null  -- [CONVENTION]
,
    m03_amount numeric not null  -- [CONVENTION]
,
    m04_amount numeric not null  -- [CONVENTION]
,
    m05_amount numeric not null  -- [CONVENTION]
,
    m06_amount numeric not null  -- [CONVENTION]
,
    m07_amount numeric not null  -- [CONVENTION]
,
    m08_amount numeric not null  -- [CONVENTION]
,
    m09_amount numeric not null  -- [CONVENTION]
,
    m10_amount numeric not null  -- [CONVENTION]
,
    m11_amount numeric not null  -- [CONVENTION]
,
    m12_amount numeric not null  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
);

alter table public.budget_lines drop constraint if exists budget_lines_account_id_fkey;
alter table public.budget_lines add constraint budget_lines_account_id_fkey foreign key (account_id) references public.accounts(id);
alter table public.budget_lines drop constraint if exists budget_lines_branch_id_fkey;
alter table public.budget_lines add constraint budget_lines_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.budget_lines drop constraint if exists budget_lines_budget_id_fkey;
alter table public.budget_lines add constraint budget_lines_budget_id_fkey foreign key (budget_id) references public.budgets(id);
alter table public.budget_lines drop constraint if exists budget_lines_business_id_fkey;
alter table public.budget_lines add constraint budget_lines_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.budget_lines drop constraint if exists budget_lines_department_id_fkey;
alter table public.budget_lines add constraint budget_lines_department_id_fkey foreign key (department_id) references public.departments(id);

alter table public.budget_lines enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE contacts  (27 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.contacts (
    address_line1 text  -- [CONVENTION]
,
    address_line2 text  -- [CONVENTION]
,
    ap_account_id uuid  -- [EVIDENCED] FK
,
    ar_account_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    city text  -- [CONVENTION]
,
    contact_type text not null  -- [CONVENTION]
,
    country text  -- [CONVENTION]
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    credit_limit numeric  -- [CONVENTION]
,
    credit_terms_days numeric  -- [CONVENTION]
,
    currency currency_code  -- [EVIDENCED] enum
,
    deleted_at timestamptz  -- [CONVENTION]
,
    email text  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    mobile_money_number text  -- [CONVENTION]
,
    mobile_money_type text  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    phone text  -- [CONVENTION]
,
    tpin text  -- [CONVENTION]
,
    trading_name text  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    vat_number text  -- [CONVENTION]
,
    wht_exempt boolean not null  -- [CONVENTION]
,
    wht_exemption_ref text  -- [CONVENTION]
);

alter table public.contacts drop constraint if exists contacts_ap_account_id_fkey;
alter table public.contacts add constraint contacts_ap_account_id_fkey foreign key (ap_account_id) references public.accounts(id);
alter table public.contacts drop constraint if exists contacts_ar_account_id_fkey;
alter table public.contacts add constraint contacts_ar_account_id_fkey foreign key (ar_account_id) references public.accounts(id);
alter table public.contacts drop constraint if exists contacts_business_id_fkey;
alter table public.contacts add constraint contacts_business_id_fkey foreign key (business_id) references public.businesses(id);

alter table public.contacts enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE employees  (37 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.employees (
    bank_account_number text  -- [CONVENTION]
,
    bank_branch text  -- [CONVENTION]
,
    bank_name text  -- [CONVENTION]
,
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    currency currency_code not null  -- [EVIDENCED] enum
,
    date_of_birth date  -- [EVIDENCED]
,
    deleted_at timestamptz  -- [CONVENTION]
,
    department_id uuid  -- [EVIDENCED] FK
,
    email text  -- [CONVENTION]
,
    employee_number text not null  -- [CONVENTION]
,
    employment_type text not null  -- [CONVENTION]
,
    end_date date  -- [EVIDENCED]
,
    first_name text not null  -- [CONVENTION]
,
    gender text  -- [CONVENTION]
,
    gross_salary numeric not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    job_title text  -- [CONVENTION]
,
    last_name text not null  -- [CONVENTION]
,
    mobile_money_number text  -- [CONVENTION]
,
    mobile_money_type text  -- [CONVENTION]
,
    national_id text  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    pay_frequency text not null  -- [CONVENTION]
,
    paye_code text  -- [CONVENTION]
,
    paye_liability_account_id uuid  -- [EVIDENCED] FK
,
    paye_tax_class text  -- [CONVENTION]
,
    payment_method payment_method not null  -- [EVIDENCED] enum
,
    phone text  -- [CONVENTION]
,
    probation_end_date text  -- [CONVENTION]
,
    salary_account_id uuid  -- [EVIDENCED] FK
,
    start_date date not null  -- [EVIDENCED]
,
    tax_exempt boolean not null  -- [CONVENTION]
,
    tpin text  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.employees drop constraint if exists employees_branch_id_fkey;
alter table public.employees add constraint employees_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.employees drop constraint if exists employees_business_id_fkey;
alter table public.employees add constraint employees_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.employees drop constraint if exists employees_department_id_fkey;
alter table public.employees add constraint employees_department_id_fkey foreign key (department_id) references public.departments(id);
alter table public.employees drop constraint if exists employees_paye_liability_account_id_fkey;
alter table public.employees add constraint employees_paye_liability_account_id_fkey foreign key (paye_liability_account_id) references public.accounts(id);
alter table public.employees drop constraint if exists employees_salary_account_id_fkey;
alter table public.employees add constraint employees_salary_account_id_fkey foreign key (salary_account_id) references public.accounts(id);

alter table public.employees enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE expenses  (38 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.expenses (
    amount_paid numeric not null  -- [CONVENTION]
,
    ap_account_id uuid  -- [EVIDENCED] FK
,
    approved_at timestamptz  -- [CONVENTION]
,
    approved_by text  -- [CONVENTION]
,
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    contact_id uuid  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    currency text not null  -- [CONVENTION]
,
    deleted_at timestamptz  -- [CONVENTION]
,
    department_id uuid  -- [EVIDENCED] FK
,
    due_date date  -- [EVIDENCED]
,
    exchange_rate numeric(20,10) not null  -- [EVIDENCED]
,
    expense_date date not null  -- [EVIDENCED]
,
    expense_number text not null  -- [CONVENTION]
,
    expense_type text not null  -- [CONVENTION]
,
    functional_amount numeric  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    journal_entry_id uuid  -- [EVIDENCED] FK
,
    notes text  -- [CONVENTION]
,
    original_amount numeric  -- [CONVENTION]
,
    original_currency text  -- [CONVENTION]
,
    rate_date date  -- [EVIDENCED]
,
    rate_is_stale boolean not null  -- [CONVENTION]
,
    receipt_filename text  -- [CONVENTION]
,
    receipt_mime_type text  -- [CONVENTION]
,
    receipt_size_bytes numeric  -- [CONVENTION]
,
    receipt_url text  -- [CONVENTION]
,
    reference text  -- [CONVENTION]
,
    status text not null  -- [CONVENTION]
,
    subtotal numeric not null  -- [CONVENTION]
,
    discount_amount numeric not null default 0  -- [EVIDENCED]
,
    discount_percent numeric not null default 0  -- [EVIDENCED]
,
    total_amount numeric not null  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    vat_amount numeric not null  -- [CONVENTION]
,
    wht_amount numeric not null  -- [CONVENTION]
);

alter table public.expenses drop constraint if exists expenses_ap_account_id_fkey;
alter table public.expenses add constraint expenses_ap_account_id_fkey foreign key (ap_account_id) references public.accounts(id);
alter table public.expenses drop constraint if exists expenses_branch_id_fkey;
alter table public.expenses add constraint expenses_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.expenses drop constraint if exists expenses_business_id_fkey;
alter table public.expenses add constraint expenses_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.expenses drop constraint if exists expenses_contact_id_fkey;
alter table public.expenses add constraint expenses_contact_id_fkey foreign key (contact_id) references public.contacts(id);
alter table public.expenses drop constraint if exists expenses_currency_fkey;
alter table public.expenses add constraint expenses_currency_fkey foreign key (currency) references public.currencies(code);
alter table public.expenses drop constraint if exists expenses_department_id_fkey;
alter table public.expenses add constraint expenses_department_id_fkey foreign key (department_id) references public.departments(id);
alter table public.expenses drop constraint if exists expenses_journal_entry_id_fkey;
alter table public.expenses add constraint expenses_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id);
alter table public.expenses drop constraint if exists expenses_original_currency_fkey;
alter table public.expenses add constraint expenses_original_currency_fkey foreign key (original_currency) references public.currencies(code);

alter table public.expenses enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE fixed_assets  (46 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.fixed_assets (
    accumulated_dep_account_id uuid  -- [EVIDENCED] FK
,
    accumulated_depreciation numeric not null  -- [CONVENTION]
,
    acquisition_cost numeric not null  -- [CONVENTION]
,
    acquisition_date date not null  -- [EVIDENCED]
,
    asset_account_id uuid  -- [EVIDENCED] FK
,
    asset_number text not null  -- [CONVENTION]
,
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    category_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    deleted_at timestamptz  -- [CONVENTION]
,
    dep_expense_account_id uuid  -- [EVIDENCED] FK
,
    department_id uuid  -- [EVIDENCED] FK
,
    depreciable_amount numeric  -- [CONVENTION]
,
    depreciation_method depreciation_method not null  -- [EVIDENCED] enum
,
    depreciation_rate numeric  -- [CONVENTION]
,
    depreciation_start_date text not null  -- [CONVENTION]
,
    description text  -- [CONVENTION]
,
    disposal_date date  -- [EVIDENCED]
,
    disposal_journal_id uuid  -- [EVIDENCED] FK
,
    disposal_proceeds numeric  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    image_url text  -- [CONVENTION]
,
    insurance_expiry_date text  -- [CONVENTION]
,
    insurance_policy_number text  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    is_depreciable boolean not null default true  -- [EVIDENCED]
,
    last_depreciation_date text  -- [CONVENTION]
,
    location text  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    net_book_value numeric  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    purchase_invoice_ref text  -- [CONVENTION]
,
    purchase_journal_id uuid  -- [EVIDENCED] FK
,
    residual_value numeric not null  -- [CONVENTION]
,
    revaluation_date text  -- [CONVENTION]
,
    revaluation_surplus_account uuid  -- [EVIDENCED] FK
,
    revalued_amount numeric  -- [CONVENTION]
,
    serial_number text  -- [CONVENTION]
,
    status asset_status not null  -- [EVIDENCED] enum
,
    supplier_id uuid  -- [EVIDENCED] FK
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    useful_life_months numeric  -- [CONVENTION]
,
    useful_life_years numeric  -- [CONVENTION]
,
    warranty_expiry_date text  -- [CONVENTION]
);

alter table public.fixed_assets drop constraint if exists fixed_assets_accumulated_dep_account_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_accumulated_dep_account_id_fkey foreign key (accumulated_dep_account_id) references public.accounts(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_asset_account_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_asset_account_id_fkey foreign key (asset_account_id) references public.accounts(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_branch_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_business_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_category_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_category_id_fkey foreign key (category_id) references public.asset_categories(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_dep_expense_account_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_dep_expense_account_id_fkey foreign key (dep_expense_account_id) references public.accounts(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_department_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_department_id_fkey foreign key (department_id) references public.departments(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_disposal_journal_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_disposal_journal_id_fkey foreign key (disposal_journal_id) references public.journal_entries(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_purchase_journal_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_purchase_journal_id_fkey foreign key (purchase_journal_id) references public.journal_entries(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_revaluation_surplus_account_fkey;
alter table public.fixed_assets add constraint fixed_assets_revaluation_surplus_account_fkey foreign key (revaluation_surplus_account) references public.accounts(id);
alter table public.fixed_assets drop constraint if exists fixed_assets_supplier_id_fkey;
alter table public.fixed_assets add constraint fixed_assets_supplier_id_fkey foreign key (supplier_id) references public.contacts(id);

alter table public.fixed_assets enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE invoices  (45 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
    amount_due numeric  -- [CONVENTION]
,
    amount_paid numeric not null  -- [CONVENTION]
,
    ar_account_id uuid  -- [EVIDENCED] FK
,
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    contact_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    credit_note_for uuid  -- [EVIDENCED] FK
,
    currency text not null  -- [CONVENTION]
,
    deleted_at timestamptz  -- [CONVENTION]
,
    department_id uuid  -- [EVIDENCED] FK
,
    discount_amount numeric not null  -- [CONVENTION]
,
    discount_percent numeric not null  -- [CONVENTION]
,
    due_date date  -- [EVIDENCED]
,
    exchange_rate numeric(20,10) not null  -- [EVIDENCED]
,
    functional_amount numeric  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    invoice_number text not null  -- [CONVENTION]
,
    invoice_type text not null  -- [CONVENTION]
,
    issue_date date not null  -- [EVIDENCED]
,
    journal_entry_id uuid  -- [EVIDENCED] FK
,
    notes text  -- [CONVENTION]
,
    original_amount numeric  -- [CONVENTION]
,
    original_currency text  -- [CONVENTION]
,
    po_number text  -- [CONVENTION]
,
    project_code text  -- [CONVENTION]
,
    lpo_number text  -- [CONVENTION]
,
    accent_colour text  -- [CONVENTION]
,
    payment_provider text  -- [CONVENTION]
,
    payment_reference text  -- [CONVENTION]
,
    template text not null default 'professional'  -- [EVIDENCED]
,
    rate_date date  -- [EVIDENCED]
,
    rate_is_stale boolean not null  -- [CONVENTION]
,
    revenue_account_id uuid  -- [EVIDENCED] FK
,
    sent_at timestamptz  -- [CONVENTION]
,
    status invoice_status not null  -- [EVIDENCED] enum
,
    subtotal numeric not null  -- [CONVENTION]
,
    taxable_amount numeric not null  -- [CONVENTION]
,
    terms text  -- [CONVENTION]
,
    total_amount numeric not null  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    vat_amount numeric not null  -- [CONVENTION]
,
    viewed_at timestamptz  -- [CONVENTION]
,
    wht_amount numeric not null  -- [CONVENTION]
,
    constraint invoices_template_check check (template in ('professional', 'minimal', 'ngo', 'government'))  -- [EVIDENCED] 20260725000001_invoice_automation.sql
);

alter table public.invoices drop constraint if exists invoices_ar_account_id_fkey;
alter table public.invoices add constraint invoices_ar_account_id_fkey foreign key (ar_account_id) references public.accounts(id);
alter table public.invoices drop constraint if exists invoices_branch_id_fkey;
alter table public.invoices add constraint invoices_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.invoices drop constraint if exists invoices_business_id_fkey;
alter table public.invoices add constraint invoices_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.invoices drop constraint if exists invoices_contact_id_fkey;
alter table public.invoices add constraint invoices_contact_id_fkey foreign key (contact_id) references public.contacts(id);
alter table public.invoices drop constraint if exists invoices_credit_note_for_fkey;
alter table public.invoices add constraint invoices_credit_note_for_fkey foreign key (credit_note_for) references public.invoices(id);
alter table public.invoices drop constraint if exists invoices_currency_fkey;
alter table public.invoices add constraint invoices_currency_fkey foreign key (currency) references public.currencies(code);
alter table public.invoices drop constraint if exists invoices_department_id_fkey;
alter table public.invoices add constraint invoices_department_id_fkey foreign key (department_id) references public.departments(id);
alter table public.invoices drop constraint if exists invoices_journal_entry_id_fkey;
alter table public.invoices add constraint invoices_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id);
alter table public.invoices drop constraint if exists invoices_original_currency_fkey;
alter table public.invoices add constraint invoices_original_currency_fkey foreign key (original_currency) references public.currencies(code);
alter table public.invoices drop constraint if exists invoices_revenue_account_id_fkey;
alter table public.invoices add constraint invoices_revenue_account_id_fkey foreign key (revenue_account_id) references public.accounts(id);

alter table public.invoices enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE journal_lines  (22 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.journal_lines (
    account_id uuid not null  -- [EVIDENCED] FK
,
    amount numeric not null  -- [CONVENTION]
,
    amount_base numeric not null  -- [CONVENTION]
,
    branch_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    currency text not null  -- [CONVENTION]
,
    department_id uuid  -- [EVIDENCED] FK
,
    description text  -- [CONVENTION]
,
    exchange_rate numeric(20,10) not null  -- [EVIDENCED]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_debit boolean not null  -- [CONVENTION]
,
    journal_entry_id uuid not null  -- [EVIDENCED] FK
,
    line_number numeric not null  -- [CONVENTION]
,
    original_amount numeric  -- [CONVENTION]
,
    original_currency text  -- [CONVENTION]
,
    rate_date date  -- [EVIDENCED]
,
    rate_is_stale boolean not null  -- [CONVENTION]
,
    reconciled boolean not null  -- [CONVENTION]
,
    reconciled_at timestamptz  -- [CONVENTION]
,
    tax_amount numeric not null  -- [CONVENTION]
,
    tax_code tax_code  -- [EVIDENCED] enum
);

alter table public.journal_lines drop constraint if exists journal_lines_account_id_fkey;
alter table public.journal_lines add constraint journal_lines_account_id_fkey foreign key (account_id) references public.accounts(id);
alter table public.journal_lines drop constraint if exists journal_lines_branch_id_fkey;
alter table public.journal_lines add constraint journal_lines_branch_id_fkey foreign key (branch_id) references public.branches(id);
alter table public.journal_lines drop constraint if exists journal_lines_business_id_fkey;
alter table public.journal_lines add constraint journal_lines_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.journal_lines drop constraint if exists journal_lines_currency_fkey;
alter table public.journal_lines add constraint journal_lines_currency_fkey foreign key (currency) references public.currencies(code);
alter table public.journal_lines drop constraint if exists journal_lines_department_id_fkey;
alter table public.journal_lines add constraint journal_lines_department_id_fkey foreign key (department_id) references public.departments(id);
alter table public.journal_lines drop constraint if exists journal_lines_journal_entry_id_fkey;
alter table public.journal_lines add constraint journal_lines_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id);
alter table public.journal_lines drop constraint if exists journal_lines_original_currency_fkey;
alter table public.journal_lines add constraint journal_lines_original_currency_fkey foreign key (original_currency) references public.currencies(code);

alter table public.journal_lines enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE payroll_employee_lines  (22 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.payroll_employee_lines (
    basic_salary numeric not null  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    employee_id uuid not null  -- [EVIDENCED] FK
,
    gross_pay numeric not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    net_pay numeric not null  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    other_deductions numeric not null  -- [CONVENTION]
,
    paid_at timestamptz  -- [CONVENTION]
,
    paye_bands_json jsonb  -- [CONVENTION]
,
    paye_deduction numeric not null  -- [CONVENTION]
,
    paye_taxable_income numeric not null  -- [CONVENTION]
,
    payment_method payment_method not null  -- [EVIDENCED] enum
,
    payment_ref text  -- [CONVENTION]
,
    payroll_run_id uuid not null  -- [EVIDENCED] FK
,
    payslip_generated boolean not null  -- [CONVENTION]
,
    payslip_url text  -- [CONVENTION]
,
    pension_employee numeric not null  -- [CONVENTION]
,
    pension_employer numeric not null  -- [CONVENTION]
,
    total_allowances numeric not null  -- [CONVENTION]
,
    total_deductions numeric not null  -- [CONVENTION]
);

alter table public.payroll_employee_lines drop constraint if exists payroll_employee_lines_business_id_fkey;
alter table public.payroll_employee_lines add constraint payroll_employee_lines_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.payroll_employee_lines drop constraint if exists payroll_employee_lines_employee_id_fkey;
alter table public.payroll_employee_lines add constraint payroll_employee_lines_employee_id_fkey foreign key (employee_id) references public.employees(id);
alter table public.payroll_employee_lines drop constraint if exists payroll_employee_lines_payroll_run_id_fkey;
alter table public.payroll_employee_lines add constraint payroll_employee_lines_payroll_run_id_fkey foreign key (payroll_run_id) references public.payroll_runs(id);

alter table public.payroll_employee_lines enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE products  (26 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.products (
    barcode text  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    category_id uuid  -- [EVIDENCED] FK
,
    cogs_account_id uuid  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    currency currency_code not null  -- [EVIDENCED] enum
,
    deleted_at timestamptz  -- [CONVENTION]
,
    description text  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    image_url text  -- [CONVENTION]
,
    inventory_account_id uuid  -- [EVIDENCED] FK
,
    is_active boolean not null default true  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    product_type text not null  -- [CONVENTION]
,
    purchase_account_id uuid  -- [EVIDENCED] FK
,
    purchase_price numeric not null  -- [CONVENTION]
,
    purchase_tax_code tax_code not null  -- [EVIDENCED] enum
,
    reorder_level numeric  -- [CONVENTION]
,
    reorder_quantity numeric  -- [CONVENTION]
,
    sale_price numeric not null  -- [CONVENTION]
,
    sales_account_id uuid  -- [EVIDENCED] FK
,
    sales_tax_code tax_code not null  -- [EVIDENCED] enum
,
    sku text  -- [CONVENTION]
,
    track_inventory boolean not null  -- [CONVENTION]
,
    unit_of_measure text  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.products drop constraint if exists products_business_id_fkey;
alter table public.products add constraint products_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.products drop constraint if exists products_category_id_fkey;
alter table public.products add constraint products_category_id_fkey foreign key (category_id) references public.product_categories(id);
alter table public.products drop constraint if exists products_cogs_account_id_fkey;
alter table public.products add constraint products_cogs_account_id_fkey foreign key (cogs_account_id) references public.accounts(id);
alter table public.products drop constraint if exists products_inventory_account_id_fkey;
alter table public.products add constraint products_inventory_account_id_fkey foreign key (inventory_account_id) references public.accounts(id);
alter table public.products drop constraint if exists products_purchase_account_id_fkey;
alter table public.products add constraint products_purchase_account_id_fkey foreign key (purchase_account_id) references public.accounts(id);
alter table public.products drop constraint if exists products_sales_account_id_fkey;
alter table public.products add constraint products_sales_account_id_fkey foreign key (sales_account_id) references public.accounts(id);

alter table public.products enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE stock_movements  (15 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_movements (
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    location_id uuid not null  -- [EVIDENCED] FK
,
    movement_date date not null  -- [EVIDENCED]
,
    movement_type stock_movement_type not null  -- [EVIDENCED] enum
,
    notes text  -- [CONVENTION]
,
    product_id uuid not null  -- [EVIDENCED] FK
,
    quantity numeric not null  -- [CONVENTION]
,
    reference text  -- [CONVENTION]
,
    source_id text  -- [CONVENTION]
,
    source_type text  -- [CONVENTION]
,
    total_cost numeric  -- [CONVENTION]
,
    unit_cost numeric not null  -- [CONVENTION]
);

alter table public.stock_movements drop constraint if exists stock_movements_business_id_fkey;
alter table public.stock_movements add constraint stock_movements_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.stock_movements drop constraint if exists stock_movements_location_id_fkey;
alter table public.stock_movements add constraint stock_movements_location_id_fkey foreign key (location_id) references public.inventory_locations(id);
alter table public.stock_movements drop constraint if exists stock_movements_product_id_fkey;
alter table public.stock_movements add constraint stock_movements_product_id_fkey foreign key (product_id) references public.products(id);

alter table public.stock_movements enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE stock_transfer_lines  (10 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.stock_transfer_lines (
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    notes text  -- [CONVENTION]
,
    product_id uuid not null  -- [EVIDENCED] FK
,
    quantity_dispatched numeric  -- [CONVENTION]
,
    quantity_received numeric  -- [CONVENTION]
,
    quantity_requested numeric not null  -- [CONVENTION]
,
    transfer_id uuid not null  -- [EVIDENCED] FK
,
    unit_cost numeric not null  -- [CONVENTION]
);

alter table public.stock_transfer_lines drop constraint if exists stock_transfer_lines_business_id_fkey;
alter table public.stock_transfer_lines add constraint stock_transfer_lines_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.stock_transfer_lines drop constraint if exists stock_transfer_lines_product_id_fkey;
alter table public.stock_transfer_lines add constraint stock_transfer_lines_product_id_fkey foreign key (product_id) references public.products(id);
alter table public.stock_transfer_lines drop constraint if exists stock_transfer_lines_transfer_id_fkey;
alter table public.stock_transfer_lines add constraint stock_transfer_lines_transfer_id_fkey foreign key (transfer_id) references public.stock_transfers(id);

alter table public.stock_transfer_lines enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE tax_configurations  (16 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.tax_configurations (
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    description text  -- [CONVENTION]
,
    effective_from date not null  -- [EVIDENCED]
,
    effective_to date  -- [EVIDENCED]
,
    employee_rate numeric  -- [EVIDENCED]
,
    employer_rate numeric  -- [EVIDENCED]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    mra_reference text  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
,
    rate numeric not null  -- [CONVENTION]
,
    tax_code tax_code not null  -- [EVIDENCED] enum
,
    tax_payable_account_id uuid  -- [EVIDENCED] FK
,
    tax_receivable_account_id uuid  -- [EVIDENCED] FK
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
);

alter table public.tax_configurations drop constraint if exists tax_configurations_business_id_fkey;
alter table public.tax_configurations add constraint tax_configurations_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.tax_configurations drop constraint if exists tax_configurations_tax_payable_account_id_fkey;
alter table public.tax_configurations add constraint tax_configurations_tax_payable_account_id_fkey foreign key (tax_payable_account_id) references public.accounts(id);
alter table public.tax_configurations drop constraint if exists tax_configurations_tax_receivable_account_id_fkey;
alter table public.tax_configurations add constraint tax_configurations_tax_receivable_account_id_fkey foreign key (tax_receivable_account_id) references public.accounts(id);

alter table public.tax_configurations enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE bank_statement_lines  (12 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.bank_statement_lines (
    balance numeric  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    credit_amount numeric not null  -- [CONVENTION]
,
    debit_amount numeric not null  -- [CONVENTION]
,
    description text not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_reconciled boolean not null  -- [CONVENTION]
,
    journal_line_id uuid  -- [EVIDENCED] FK
,
    reference text  -- [CONVENTION]
,
    statement_id uuid not null  -- [EVIDENCED] FK
,
    transaction_date date not null  -- [EVIDENCED]
);

alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_business_id_fkey;
alter table public.bank_statement_lines add constraint bank_statement_lines_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_journal_line_id_fkey;
alter table public.bank_statement_lines add constraint bank_statement_lines_journal_line_id_fkey foreign key (journal_line_id) references public.journal_lines(id);
alter table public.bank_statement_lines drop constraint if exists bank_statement_lines_statement_id_fkey;
alter table public.bank_statement_lines add constraint bank_statement_lines_statement_id_fkey foreign key (statement_id) references public.bank_statements(id);

alter table public.bank_statement_lines enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE depreciation_schedules  (13 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.depreciation_schedules (
    accumulated_to_date numeric not null  -- [CONVENTION]
,
    asset_id uuid not null  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    depreciation_charge numeric not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    journal_entry_id uuid  -- [EVIDENCED] FK
,
    net_book_value numeric not null  -- [CONVENTION]
,
    period_end date not null  -- [EVIDENCED]
,
    period_start date not null  -- [EVIDENCED]
,
    posted boolean not null  -- [CONVENTION]
,
    posted_at timestamptz  -- [CONVENTION]
,
    posted_by text  -- [CONVENTION]
);

alter table public.depreciation_schedules drop constraint if exists depreciation_schedules_asset_id_fkey;
alter table public.depreciation_schedules add constraint depreciation_schedules_asset_id_fkey foreign key (asset_id) references public.fixed_assets(id);
alter table public.depreciation_schedules drop constraint if exists depreciation_schedules_business_id_fkey;
alter table public.depreciation_schedules add constraint depreciation_schedules_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.depreciation_schedules drop constraint if exists depreciation_schedules_journal_entry_id_fkey;
alter table public.depreciation_schedules add constraint depreciation_schedules_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id);

alter table public.depreciation_schedules enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE employee_allowances  (10 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.employee_allowances (
    amount numeric not null  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    effective_from date not null  -- [EVIDENCED]
,
    effective_to date  -- [EVIDENCED]
,
    employee_id uuid not null  -- [EVIDENCED] FK
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    is_taxable boolean not null  -- [CONVENTION]
,
    name text not null  -- [CONVENTION]
);

alter table public.employee_allowances drop constraint if exists employee_allowances_business_id_fkey;
alter table public.employee_allowances add constraint employee_allowances_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.employee_allowances drop constraint if exists employee_allowances_employee_id_fkey;
alter table public.employee_allowances add constraint employee_allowances_employee_id_fkey foreign key (employee_id) references public.employees(id);

alter table public.employee_allowances enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE employee_deductions  (13 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.employee_deductions (
    amount numeric not null  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    deduction_type text not null  -- [CONVENTION]
,
    effective_from date not null  -- [EVIDENCED]
,
    effective_to date  -- [EVIDENCED]
,
    employee_id uuid not null  -- [EVIDENCED] FK
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    is_active boolean not null default true  -- [CONVENTION]
,
    liability_account_id uuid  -- [EVIDENCED] FK
,
    name text not null  -- [CONVENTION]
,
    percentage numeric not null  -- [CONVENTION]
,
    pre_tax boolean not null  -- [CONVENTION]
);

alter table public.employee_deductions drop constraint if exists employee_deductions_business_id_fkey;
alter table public.employee_deductions add constraint employee_deductions_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.employee_deductions drop constraint if exists employee_deductions_employee_id_fkey;
alter table public.employee_deductions add constraint employee_deductions_employee_id_fkey foreign key (employee_id) references public.employees(id);
alter table public.employee_deductions drop constraint if exists employee_deductions_liability_account_id_fkey;
alter table public.employee_deductions add constraint employee_deductions_liability_account_id_fkey foreign key (liability_account_id) references public.accounts(id);

alter table public.employee_deductions enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE expense_lines  (17 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.expense_lines (
    account_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    description text not null  -- [CONVENTION]
,
    discount_amount numeric not null default 0  -- [EVIDENCED]
,
    discount_percent numeric not null default 0  -- [EVIDENCED]
,
    expense_id uuid not null  -- [EVIDENCED] FK
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    line_number numeric not null  -- [CONVENTION]
,
    line_subtotal numeric  -- [CONVENTION]
,
    line_total numeric not null  -- [CONVENTION]
,
    product_id uuid  -- [EVIDENCED] FK
,
    quantity numeric not null  -- [CONVENTION]
,
    tax_amount numeric not null  -- [CONVENTION]
,
    tax_code tax_code not null  -- [EVIDENCED] enum
,
    tax_rate numeric not null  -- [CONVENTION]
,
    unit_price numeric not null  -- [CONVENTION]
);

alter table public.expense_lines drop constraint if exists expense_lines_account_id_fkey;
alter table public.expense_lines add constraint expense_lines_account_id_fkey foreign key (account_id) references public.accounts(id);
alter table public.expense_lines drop constraint if exists expense_lines_business_id_fkey;
alter table public.expense_lines add constraint expense_lines_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.expense_lines drop constraint if exists expense_lines_expense_id_fkey;
alter table public.expense_lines add constraint expense_lines_expense_id_fkey foreign key (expense_id) references public.expenses(id);
alter table public.expense_lines drop constraint if exists expense_lines_product_id_fkey;
alter table public.expense_lines add constraint expense_lines_product_id_fkey foreign key (product_id) references public.products(id);

alter table public.expense_lines enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE expense_payments  (19 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.expense_payments (
    amount numeric not null  -- [CONVENTION]
,
    bank_account_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    currency text not null  -- [CONVENTION]
,
    exchange_rate numeric(20,10) not null  -- [EVIDENCED]
,
    expense_id uuid not null  -- [EVIDENCED] FK
,
    functional_amount numeric  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    journal_entry_id uuid  -- [EVIDENCED] FK
,
    notes text  -- [CONVENTION]
,
    original_amount numeric  -- [CONVENTION]
,
    original_currency text  -- [CONVENTION]
,
    payment_date date not null  -- [EVIDENCED]
,
    payment_method payment_method not null  -- [EVIDENCED] enum
,
    rate_date date  -- [EVIDENCED]
,
    rate_is_stale boolean not null  -- [CONVENTION]
,
    reference text  -- [CONVENTION]
);

alter table public.expense_payments drop constraint if exists expense_payments_bank_account_id_fkey;
alter table public.expense_payments add constraint expense_payments_bank_account_id_fkey foreign key (bank_account_id) references public.accounts(id);
alter table public.expense_payments drop constraint if exists expense_payments_business_id_fkey;
alter table public.expense_payments add constraint expense_payments_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.expense_payments drop constraint if exists expense_payments_currency_fkey;
alter table public.expense_payments add constraint expense_payments_currency_fkey foreign key (currency) references public.currencies(code);
alter table public.expense_payments drop constraint if exists expense_payments_expense_id_fkey;
alter table public.expense_payments add constraint expense_payments_expense_id_fkey foreign key (expense_id) references public.expenses(id);
alter table public.expense_payments drop constraint if exists expense_payments_journal_entry_id_fkey;
alter table public.expense_payments add constraint expense_payments_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id);
alter table public.expense_payments drop constraint if exists expense_payments_original_currency_fkey;
alter table public.expense_payments add constraint expense_payments_original_currency_fkey foreign key (original_currency) references public.currencies(code);

alter table public.expense_payments enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE inventory_balances  (10 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.inventory_balances (
    average_cost numeric not null  -- [CONVENTION]
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    last_movement_at timestamptz  -- [CONVENTION]
,
    location_id uuid not null  -- [EVIDENCED] FK
,
    product_id uuid not null  -- [EVIDENCED] FK
,
    quantity_available numeric  -- [CONVENTION]
,
    quantity_on_hand numeric not null  -- [CONVENTION]
,
    quantity_reserved numeric not null  -- [CONVENTION]
,
    updated_at timestamptz not null default now()  -- [CONVENTION]
,
    unique (business_id, product_id, location_id)  -- [EVIDENCED] migrations use ON CONFLICT on these columns (20260728000003/20260728000002)
);

alter table public.inventory_balances drop constraint if exists inventory_balances_business_id_fkey;
alter table public.inventory_balances add constraint inventory_balances_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.inventory_balances drop constraint if exists inventory_balances_location_id_fkey;
alter table public.inventory_balances add constraint inventory_balances_location_id_fkey foreign key (location_id) references public.inventory_locations(id);
alter table public.inventory_balances drop constraint if exists inventory_balances_product_id_fkey;
alter table public.inventory_balances add constraint inventory_balances_product_id_fkey foreign key (product_id) references public.products(id);

alter table public.inventory_balances enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE invoice_lines  (17 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.invoice_lines (
    account_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    description text not null  -- [CONVENTION]
,
    discount_amount numeric not null default 0  -- [EVIDENCED]
,
    discount_percent numeric not null  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    invoice_id uuid not null  -- [EVIDENCED] FK
,
    line_number numeric not null  -- [CONVENTION]
,
    line_subtotal numeric  -- [CONVENTION]
,
    line_total numeric not null  -- [CONVENTION]
,
    product_id uuid  -- [EVIDENCED] FK
,
    quantity numeric not null  -- [CONVENTION]
,
    tax_amount numeric not null  -- [CONVENTION]
,
    tax_code tax_code not null  -- [EVIDENCED] enum
,
    tax_rate numeric not null  -- [CONVENTION]
,
    unit_price numeric not null  -- [CONVENTION]
);

alter table public.invoice_lines drop constraint if exists fk_invoice_line_product;
alter table public.invoice_lines add constraint fk_invoice_line_product foreign key (product_id) references public.products(id);
alter table public.invoice_lines drop constraint if exists invoice_lines_account_id_fkey;
alter table public.invoice_lines add constraint invoice_lines_account_id_fkey foreign key (account_id) references public.accounts(id);
alter table public.invoice_lines drop constraint if exists invoice_lines_business_id_fkey;
alter table public.invoice_lines add constraint invoice_lines_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.invoice_lines drop constraint if exists invoice_lines_invoice_id_fkey;
alter table public.invoice_lines add constraint invoice_lines_invoice_id_fkey foreign key (invoice_id) references public.invoices(id);

alter table public.invoice_lines enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE invoice_payments  (19 columns)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.invoice_payments (
    amount numeric not null  -- [CONVENTION]
,
    bank_account_id uuid  -- [EVIDENCED] FK
,
    business_id uuid not null  -- [EVIDENCED] FK
,
    created_at timestamptz not null default now()  -- [CONVENTION]
,
    created_by text  -- [CONVENTION]
,
    currency text not null  -- [CONVENTION]
,
    exchange_rate numeric(20,10) not null  -- [EVIDENCED]
,
    functional_amount numeric  -- [CONVENTION]
,
    id uuid primary key default gen_random_uuid()  -- [CONVENTION]
,
    invoice_id uuid not null  -- [EVIDENCED] FK
,
    journal_entry_id uuid  -- [EVIDENCED] FK
,
    notes text  -- [CONVENTION]
,
    original_amount numeric  -- [CONVENTION]
,
    original_currency text  -- [CONVENTION]
,
    payment_date date not null  -- [EVIDENCED]
,
    payment_method payment_method not null  -- [EVIDENCED] enum
,
    rate_date date  -- [EVIDENCED]
,
    rate_is_stale boolean not null  -- [CONVENTION]
,
    reference text  -- [CONVENTION]
);

alter table public.invoice_payments drop constraint if exists invoice_payments_bank_account_id_fkey;
alter table public.invoice_payments add constraint invoice_payments_bank_account_id_fkey foreign key (bank_account_id) references public.accounts(id);
alter table public.invoice_payments drop constraint if exists invoice_payments_business_id_fkey;
alter table public.invoice_payments add constraint invoice_payments_business_id_fkey foreign key (business_id) references public.businesses(id);
alter table public.invoice_payments drop constraint if exists invoice_payments_currency_fkey;
alter table public.invoice_payments add constraint invoice_payments_currency_fkey foreign key (currency) references public.currencies(code);
alter table public.invoice_payments drop constraint if exists invoice_payments_invoice_id_fkey;
alter table public.invoice_payments add constraint invoice_payments_invoice_id_fkey foreign key (invoice_id) references public.invoices(id);
alter table public.invoice_payments drop constraint if exists invoice_payments_journal_entry_id_fkey;
alter table public.invoice_payments add constraint invoice_payments_journal_entry_id_fkey foreign key (journal_entry_id) references public.journal_entries(id);
alter table public.invoice_payments drop constraint if exists invoice_payments_original_currency_fkey;
alter table public.invoice_payments add constraint invoice_payments_original_currency_fkey foreign key (original_currency) references public.currencies(code);

alter table public.invoice_payments enable row level security;


-- ────────────────────────────────────────────────────────────────────────────
-- RLS POLICIES
--   RLS is enabled above on every base table. Policies are NOT created here:
--   the incremental migrations own and rebuild the policy sets they know
--   (accounts 20260731000000, businesses 20260728000010, master data
--   20260728000008, payroll 20260728000009, fixed assets 20260811000002,
--   exchange_rates 20260727000000). Policies on the remaining base tables
--   exist on staging but are not evidenced in the repository — they are a
--   known gap (Phase 8B will test the baseline once captured live).
-- ────────────────────────────────────────────────────────────────────────────
