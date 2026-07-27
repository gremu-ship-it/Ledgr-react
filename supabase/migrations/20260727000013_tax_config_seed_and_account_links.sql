-- ============================================================================
-- Migration: seed tax_configurations and link them to ledger accounts
--
-- This is the fix for the module's single worst blocker:
--
--   PayrollRepository.approve() hard-throws when the tpr_pension config has
--   no tax_payable_account_id. The original tax module migration deliberately
--   seeded that column NULL ("account codes were never confirmed"), and the
--   tax settings UI did not expose the field. There was therefore NO WAY,
--   from inside the app, to make payroll approval succeed — and because
--   approval is what generates the PAYE and TPR returns, most of the tax
--   module was unreachable.
--
-- The original migration is already applied in production, so editing it
-- would be a no-op there. This forward migration does the work instead.
--
-- Account codes resolved against seedChartOfAccounts.ts:
--   2132  Pension Payable            -> tpr_pension  payable
--   2122  PAYE Payable               -> paye         payable
--   2121  VAT Payable (Output Tax)   -> vat_standard payable
--   1135  VAT Receivable (Input Tax) -> vat_standard receivable
--
-- Note 2131 is "Salaries & Wages Payable", NOT PAYE — an easy mis-link.
--
-- Fully idempotent: inserts only where the config is missing, and backfills
-- account links only where they are still NULL, so it never overwrites a
-- deliberate choice made in the UI.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. TPR pension — 10% employer / 5% employee
-- ----------------------------------------------------------------------------
insert into tax_configurations (
  business_id, tax_code, name, rate, employer_rate, employee_rate,
  description, mra_reference, effective_from, tax_payable_account_id
)
select
  b.id, 'tpr_pension', 'TPR Pension', 0, 10, 5,
  'Pension Act mandatory contribution — 10% employer, 5% employee',
  'Pension Act', '2011-01-01',
  (select a.id from accounts a
    where a.business_id = b.id and a.code = '2132' limit 1)
from businesses b
where not exists (
  select 1 from tax_configurations tc
  where tc.business_id = b.id and tc.tax_code = 'tpr_pension'
);

-- ----------------------------------------------------------------------------
-- 2. PAYE
-- ----------------------------------------------------------------------------
insert into tax_configurations (
  business_id, tax_code, name, rate, description, mra_reference,
  effective_from, tax_payable_account_id
)
select
  b.id, 'paye', 'PAYE', 0,
  'Pay As You Earn — progressive bands, see paye_bands',
  'Taxation Act', '2011-01-01',
  (select a.id from accounts a
    where a.business_id = b.id and a.code = '2122' limit 1)
from businesses b
where not exists (
  select 1 from tax_configurations tc
  where tc.business_id = b.id and tc.tax_code = 'paye'
);

-- ----------------------------------------------------------------------------
-- 3. Standard VAT
--    17.5% from 1 January 2026 (VAT (Amendment) Act 2025 raised it from
--    16.5%). Only inserted where absent — an existing row keeps its rate.
-- ----------------------------------------------------------------------------
insert into tax_configurations (
  business_id, tax_code, name, rate, description, mra_reference,
  effective_from, tax_payable_account_id, tax_receivable_account_id
)
select
  b.id, 'vat_standard', 'VAT Standard', 17.5,
  'Standard-rated VAT. 17.5% from 1 Jan 2026 (previously 16.5%).',
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
-- 4. Backfill account links on configs that already existed with NULLs.
--    This is what actually unblocks payroll approval on the production
--    database, where the tpr_pension row was seeded NULL.
-- ----------------------------------------------------------------------------
update tax_configurations tc
set tax_payable_account_id = (
  select a.id from accounts a
  where a.business_id = tc.business_id and a.code = '2132' limit 1
)
where tc.tax_code = 'tpr_pension' and tc.tax_payable_account_id is null;

update tax_configurations tc
set tax_payable_account_id = (
  select a.id from accounts a
  where a.business_id = tc.business_id and a.code = '2122' limit 1
)
where tc.tax_code = 'paye' and tc.tax_payable_account_id is null;

update tax_configurations tc
set tax_payable_account_id = (
  select a.id from accounts a
  where a.business_id = tc.business_id and a.code = '2121' limit 1
)
where tc.tax_code = 'vat_standard' and tc.tax_payable_account_id is null;

update tax_configurations tc
set tax_receivable_account_id = (
  select a.id from accounts a
  where a.business_id = tc.business_id and a.code = '1135' limit 1
)
where tc.tax_code = 'vat_standard' and tc.tax_receivable_account_id is null;

-- ----------------------------------------------------------------------------
-- Businesses whose chart of accounts has not been seeded yet will still have
-- NULL links (the lookups return NULL). They can be set from
-- Tax > Tax Configurations, which now exposes both account pickers, or by
-- re-running this migration after seeding the CoA.
-- ----------------------------------------------------------------------------
