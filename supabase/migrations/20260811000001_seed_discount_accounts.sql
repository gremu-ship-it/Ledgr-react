-- Seed new discount accounts (4260 Discount Received, 5175 Purchase Discounts)
-- for all existing businesses so journalService can post purchase discounts.
-- Idempotent: only inserts where code not already present.

insert into public.accounts (
  business_id, code, name, description, account_type, account_subtype,
  normal_balance, is_group, is_system, is_bank_account, parent_id,
  tax_code, currency, opening_balance, is_active
)
select
  b.id,
  '4260',
  'Discount Received',
  'Trade and settlement discounts received from suppliers',
  'income',
  'other_income',
  'credit',
  false,
  false,
  false,
  p.id,
  'none',
  'MWK',
  0,
  true
from public.businesses b
join public.accounts p on p.business_id = b.id and p.code = '4200'
where not exists (
  select 1 from public.accounts a where a.business_id = b.id and a.code = '4260'
);

insert into public.accounts (
  business_id, code, name, description, account_type, account_subtype,
  normal_balance, is_group, is_system, is_bank_account, parent_id,
  tax_code, currency, opening_balance, is_active
)
select
  b.id,
  '5175',
  'Purchase Discounts',
  'Trade and settlement discounts received on purchases — contra cost of sales',
  'expense',
  'cost_of_sales',
  'credit',
  false,
  false,
  false,
  p.id,
  'none',
  'MWK',
  0,
  true
from public.businesses b
join public.accounts p on p.business_id = b.id and p.code = '5000'
where not exists (
  select 1 from public.accounts a where a.business_id = b.id and a.code = '5175'
);
