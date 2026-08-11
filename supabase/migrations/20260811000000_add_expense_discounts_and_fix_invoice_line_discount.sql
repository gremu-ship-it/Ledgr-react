-- Adds purchase-discount (Discount Received) columns to expense tables
-- and ensures invoice_lines.discount_amount is present (idempotent).
-- Supports trade discounts on purchase bills / expenses.

-- Invoice lines: discount_amount already added by 20260725000001_invoice_automation.sql
-- but keep idempotent guard for type regeneration / fresh DBs.
alter table public.invoice_lines add column if not exists discount_amount numeric not null default 0;

-- Expense header (discount received) — invoice-style trade discount at bill level
alter table public.expenses add column if not exists discount_amount numeric not null default 0;
alter table public.expenses add column if not exists discount_percent numeric not null default 0;

-- Expense lines — per-line % (mirrors invoice_lines.discount_percent)
alter table public.expense_lines add column if not exists discount_percent numeric not null default 0;
alter table public.expense_lines add column if not exists discount_amount numeric not null default 0;

-- Ensure Chart of Accounts entries for Discount Received / Purchase Discounts
-- are seeded via seedChartOfAccounts.ts (4260, 5175). No DDL needed.
