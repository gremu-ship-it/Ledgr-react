-- ============================================================================
-- Phase 10 remediation — A-02 (part 2): backfill discount accounts.
--
-- FINDING (audit, 2026-08-16)
--   journalService silently falls back to NET revenue posting when account
--   4130 (Sales Discounts) is missing, and silently drops the purchase
--   discount line when 5175 AND 4260 are both missing. The catch is broad
--   (masks real errors) and the disclosure change is unlogged.
--
-- FIX (part 1 is the code change in journalService: narrow catch + warn)
--   This migration backfills the discount account chain for legacy
--   businesses created before the chart-of-accounts seed included them:
--     4000 Income (group)            -> 4100 Sales Revenue (group) -> 4130 Sales Discounts
--     4000 Income (group)            -> 4200 Other Income (group)  -> 4260 Discount Received
--     5000 Cost of Sales (group)     -> 5175 Purchase Discounts
--   Attributes mirror src/services/seedChartOfAccounts.ts exactly, so a
--   backfilled business is indistinguishable from a newly-seeded one.
--   Businesses that already have the accounts are untouched.
--
-- IDEMPOTENT: inserts only rows that do not exist; parent links are set only
-- where missing.
-- ============================================================================

-- 1) Insert the missing account rows for every business.
insert into public.accounts
  (business_id, code, name, description, account_type, account_subtype,
   normal_balance, is_group, is_system, is_bank_account, tax_code, currency,
   opening_balance, is_active)
select b.id, s.code, s.name, s.description, s.account_type, s.account_subtype,
       s.normal_balance, s.is_group, s.is_system, false, 'none', 'MWK', 0, true
  from public.businesses b
 cross join (values
   ('4000', 'Income',                 null::text, 'income'::account_type, 'revenue'::account_subtype,      'credit', true::boolean,  true::boolean),
   ('4100', 'Sales Revenue',          null::text, 'income'::account_type, 'revenue'::account_subtype,      'credit', true::boolean,  false::boolean),
   ('4130', 'Sales Discounts',        null::text, 'income'::account_type, 'revenue'::account_subtype,      'debit',  false::boolean, false::boolean),
   ('4200', 'Other Income',           null::text, 'income'::account_type, 'other_income'::account_subtype, 'credit', true::boolean,  false::boolean),
   ('4260', 'Discount Received',      'Trade and settlement discounts received from suppliers', 'income'::account_type, 'other_income'::account_subtype, 'credit', false::boolean, false::boolean),
   ('5000', 'Cost of Sales',          null::text, 'expense'::account_type, 'cost_of_sales'::account_subtype, 'debit', true::boolean,  true::boolean),
   ('5175', 'Purchase Discounts',     'Trade and settlement discounts received on purchases — contra cost of sales', 'expense'::account_type, 'cost_of_sales'::account_subtype, 'credit', false::boolean, false::boolean)
 ) as s(code, name, description, account_type, account_subtype, normal_balance, is_group, is_system)
 where not exists (
   select 1 from public.accounts a
    where a.business_id = b.id and a.code = s.code
 );

-- 2) Wire parent_id for the backfilled rows (inserted rows have parent_id
--    NULL). Only rows with a NULL parent are touched — pre-existing rows
--    that already carry a parent are never re-linked.
update public.accounts a
   set parent_id = p.id
  from public.accounts p
 where a.business_id = p.business_id
   and a.parent_id is null
   and a.code in ('4100', '4130', '4200', '4260', '5175')
   and p.code = case a.code
                  when '4100' then '4000'
                  when '4130' then '4100'
                  when '4200' then '4000'
                  when '4260' then '4200'
                  when '5175' then '5000'
                end;
