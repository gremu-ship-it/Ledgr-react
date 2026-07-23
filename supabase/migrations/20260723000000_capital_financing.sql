-- ============================================================================
-- Migration: Capital & Financing (Loans + Share Capital)
-- Adds: loans / loan_repayments / share_transactions tables, RLS policies,
--       indexes. Recording these posts double-entry journals via the
--       CapitalJournalService (source_type: loan_drawdown / loan_repayment /
--       share_issue / share_buyback).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. loans — a borrowing facility owed by the business
-- ----------------------------------------------------------------------------
create table loans (
  id                          uuid primary key default gen_random_uuid(),
  business_id                uuid not null references businesses(id),
  lender_name                text not null,
  description                text,
  loan_account_id            uuid not null references accounts(id),        -- liability GL (loan payable)
  interest_expense_account_id uuid references accounts(id),               -- expense GL for interest
  principal_amount           numeric not null,
  interest_rate_pct          numeric,                                      -- annual %, nullable
  term_months                integer,
  start_date                 date not null,
  first_payment_date         date,
  status                     text not null default 'active',               -- active | paid_off | defaulted | cancelled
  drawdown_journal_id        uuid references journal_entries(id),
  created_by                 uuid,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index idx_loans_business on loans(business_id);
create index idx_loans_status on loans(business_id, status);

-- ----------------------------------------------------------------------------
-- 2. loan_repayments — each instalment against a loan
-- ----------------------------------------------------------------------------
create table loan_repayments (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id),
  loan_id          uuid not null references loans(id),
  repayment_date   date not null,
  amount           numeric not null,                                       -- total paid
  principal_portion numeric not null,                                      -- principal repaid
  interest_portion  numeric not null,                                      -- interest portion
  bank_account_id  uuid references accounts(id),                           -- cash/bank paid from
  journal_entry_id uuid references journal_entries(id),
  reference        text,
  notes            text,
  created_by       uuid,
  created_at       timestamptz not null default now()
);

create index idx_loan_repayments_loan on loan_repayments(loan_id);
create index idx_loan_repayments_business on loan_repayments(business_id);

-- ----------------------------------------------------------------------------
-- 3. share_transactions — share capital issued (in) / bought back (out)
-- ----------------------------------------------------------------------------
create table share_transactions (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references businesses(id),
  shareholder_name   text not null,
  transaction_type   text not null,                                        -- issue | buyback
  shares_count       numeric,                                              -- number of shares, nullable
  amount             numeric not null,
  share_account_id   uuid not null references accounts(id),                -- equity GL (share capital)
  bank_account_id    uuid references accounts(id),                         -- cash/bank received/paid
  journal_entry_id   uuid references journal_entries(id),
  reference          text,
  notes              text,
  created_by         uuid,
  created_at         timestamptz not null default now()
);

create index idx_share_transactions_business on share_transactions(business_id);
create index idx_share_transactions_type on share_transactions(business_id, transaction_type);

-- ----------------------------------------------------------------------------
-- 4. Row Level Security — business-scoped, mirroring existing policy pattern
-- ----------------------------------------------------------------------------
alter table loans enable row level security;
alter table loan_repayments enable row level security;
alter table share_transactions enable row level security;

create policy loans_business_access on loans
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

create policy loan_repayments_business_access on loan_repayments
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );

create policy share_transactions_business_access on share_transactions
  for all using (
    business_id in (
      select business_id from business_users
      where user_id = auth.uid() and is_active = true
    )
  );
