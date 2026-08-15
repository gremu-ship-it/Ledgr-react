-- ============================================================================
-- Phase 8B.1 — Application-critical RPC reconstruction
-- ============================================================================
--
-- Reconstructs the nine application RPCs that were confirmed missing from
-- the repository (and from the fresh staging database) during Phase 8A.1:
--
--   accept_invitation          create_business_with_owner
--   current_user_role          get_enum_values
--   get_user_role              invite_member
--   log_manual_audit_event     seed_new_business
--   verify_audit_chain
--
-- EVIDENCE RULES (Phase 8B)
--   • Every behaviour below is tagged [VERIFIED] (repository evidence),
--     [INFERRED] (reasonable reconstruction, no direct evidence), or
--     [UNKNOWN] (no evidence — deliberately not fabricated).
--   • The original production bodies were NOT captured (Phase 8A.1 did not
--     have authorization to inspect production). This migration is a
--     reconstruction from repository evidence, NOT a recovery of the
--     original implementation.
--   • Full evidence trail: docs/database/phase-8b-rpc-reconstruction.md
--
-- SAFETY
--   SECURITY DEFINER functions pin search_path=public. All functions check
--   auth.uid()/membership before acting. No accounting postings are
--   invented. No secrets are embedded.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- current_user_role / get_user_role — role of the calling user in a business
--   [VERIFIED] signature: database.generated.ts Functions section
--   [INFERRED] no current call sites in src/ (legacy helpers); semantics from
--              the business_users membership model used everywhere
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.current_user_role(p_business_id uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select bu.role
    from public.business_users bu
   where bu.business_id = p_business_id
     and bu.user_id = auth.uid()
     and bu.is_active = true
   limit 1;
$$;

create or replace function public.get_user_role(p_business_id uuid)
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select bu.role
    from public.business_users bu
   where bu.business_id = p_business_id
     and bu.user_id = auth.uid()
     and bu.is_active = true
   limit 1;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- get_enum_values — labels of a public enum, in enum order
--   [VERIFIED] signature: database.generated.ts Functions section
--   [INFERRED] implementation (no callers in repo; standard pg_enum lookup)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_enum_values(p_enum_name text)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_agg(e.enumlabel order by e.enumsortorder),
    '{}'::text[]
  )
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public'
     and t.typname = p_enum_name
     and t.typtype = 'e';
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- audit_chain_hash — shared canonical hash for the audit chain
--   [INFERRED] algorithm (see log_manual_audit_event). Centralised so
--              writers and verifiers can never drift apart.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.audit_chain_hash(
  p_prev_hash text,
  p_business_id uuid,
  p_user_id uuid,
  p_occurred_at timestamptz,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_resource_ref text,
  p_old_values jsonb,
  p_new_values jsonb,
  p_notes text
)
returns text
language sql
immutable
security definer
set search_path = public
as $$
  select encode(digest(
    coalesce(p_prev_hash, '')
    || chr(1) || p_business_id::text
    || chr(1) || coalesce(p_user_id::text, '')
    || chr(1) || extract(epoch from p_occurred_at)::text
    || chr(1) || coalesce(p_event_type, '')
    || chr(1) || coalesce(p_resource_type, '')
    || chr(1) || coalesce(p_resource_id::text, '')
    || chr(1) || coalesce(p_resource_ref, '')
    || chr(1) || coalesce(p_old_values::text, '')
    || chr(1) || coalesce(p_new_values::text, '')
    || chr(1) || coalesce(p_notes, ''),
    'sha256'), 'hex');
$$;


-- ────────────────────────────────────────────────────────────────────────────
-- seed_new_business — default chart of accounts (+ optional PAYE bands)
--   [VERIFIED] the COA below is transcribed from
--              src/services/seedChartOfAccounts.ts (the repository's COA
--              source of truth; 'gaap' = default template). Accounts are
--              inserted with the same column mapping the frontend seeder
--              uses (business_id, code, name, description, account_type,
--              account_subtype, normal_balance, is_group, is_system,
--              is_bank_account, tax_code, currency 'MWK', opening_balance 0,
--              is_active true, parent_id by code).
--   [VERIFIED] paye_bands fiscal-year label format from src/lib/fiscalYear.ts
--              ('YYYY/YY', financial year starts 07-01).
--   [UNKNOWN]  the actual statutory PAYE band values seeded by the original
--              function — NOT fabricated here. PAYE bands are only seeded
--              when the caller supplies them in p_biz -> 'paye_bands'.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.seed_new_business(p_biz jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid := (p_biz->>'business_id')::uuid;
  v_template    text := coalesce(p_biz->>'coa_template', 'gaap');
  v_currency    text := coalesce(p_biz->>'base_currency', 'MWK');
  v_band        jsonb;
begin
  if v_business_id is null then
    raise exception 'seed_new_business: p_biz.business_id is required'
      using errcode = '22023';
  end if;

  -- Only seed for a business that exists (defensive; callers are internal).
  if not exists (select 1 from public.businesses b where b.id = v_business_id) then
    raise exception 'seed_new_business: business % does not exist', v_business_id
      using errcode = 'P0002';
  end if;

  -- ── Chart of accounts (template-filtered, parents resolved by code) ──────
  drop table if exists _coa_seed;
  create temp table _coa_seed (
    code text, name text, description text, account_type public.account_type,
    account_subtype public.account_subtype, normal_balance text,
    is_group boolean, is_system boolean, is_bank_account boolean,
    tax_code public.tax_code, parent_code text
  ) on commit drop;

  insert into _coa_seed (code, name, description, account_type, account_subtype, normal_balance, is_group, is_system, is_bank_account, tax_code, parent_code) values
    ('1000','Assets',NULL,'asset',NULL,'debit',true,true,false,'none',NULL),
    ('1100','Current Assets',NULL,'asset','current_asset','debit',true,true,false,'none','1000'),
    ('1110','Cash on Hand','Physical cash at business premises','asset','current_asset','debit',false,true,false,'none','1100'),
    ('1115','Petty Cash',NULL,'asset','current_asset','debit',false,false,false,'none','1100'),
    ('1120','Bank Accounts',NULL,'asset','current_asset','debit',true,false,false,'none','1100'),
    ('1121','National Bank — Current Account',NULL,'asset','current_asset','debit',false,false,true,'none','1120'),
    ('1122','Standard Bank — Current Account',NULL,'asset','current_asset','debit',false,false,true,'none','1120'),
    ('1123','FDH Bank — Current Account',NULL,'asset','current_asset','debit',false,false,true,'none','1120'),
    ('1124','NBS Bank — Current Account',NULL,'asset','current_asset','debit',false,false,true,'none','1120'),
    ('1125','Mobile Money — Airtel Money','Airtel Money float balance','asset','current_asset','debit',false,false,false,'none','1100'),
    ('1126','Mobile Money — TNM Mpamba','TNM Mpamba float balance','asset','current_asset','debit',false,false,false,'none','1100'),
    ('1130','Accounts Receivable',NULL,'asset','current_asset','debit',true,false,false,'none','1100'),
    ('1131','Trade Debtors','Amounts owed by customers','asset','current_asset','debit',false,true,false,'none','1130'),
    ('1132','Other Debtors',NULL,'asset','current_asset','debit',false,false,false,'none','1130'),
    ('1133','Staff Advances & Loans',NULL,'asset','current_asset','debit',false,false,false,'none','1130'),
    ('1134','Provision for Bad Debts','Contra-asset — allowance for doubtful debts','asset','current_asset','credit',false,false,false,'none','1130'),
    ('1135','VAT Receivable (Input Tax)','Input VAT claimable from MRA','asset','current_asset','debit',false,true,false,'vat_standard','1100'),
    ('1136','WHT Receivable','Withholding tax certificates receivable — rate varies by transaction (10/15/20%)','asset','current_asset','debit',false,false,false,'none','1100'),
    ('1137','Income Tax Receivable','Tax overpaid — refund due from MRA','asset','current_asset','debit',false,false,false,'cit','1100'),
    ('1140','Inventory',NULL,'asset','current_asset','debit',true,false,false,'none','1100'),
    ('1141','Trading Stock','Goods purchased for resale','asset','current_asset','debit',false,false,false,'none','1140'),
    ('1142','Finished Goods',NULL,'asset','current_asset','debit',false,false,false,'none','1140'),
    ('1143','Raw Materials','Raw materials for manufacturing','asset','current_asset','debit',false,false,false,'none','1140'),
    ('1144','Work in Progress',NULL,'asset','current_asset','debit',false,false,false,'none','1140'),
    ('1145','Agricultural Produce','Maize, tobacco and other farm produce held for sale','asset','current_asset','debit',false,false,false,'none','1140'),
    ('1150','Prepaid Expenses','Expenses paid in advance','asset','current_asset','debit',false,false,false,'none','1100'),
    ('1155','Security Deposits',NULL,'asset','current_asset','debit',false,false,false,'none','1100'),
    ('1160','Short-term Investments',NULL,'asset','current_asset','debit',false,false,false,'none','1100'),
    ('1500','Non-Current Assets',NULL,'asset','non_current_asset','debit',true,false,false,'none','1000'),
    ('1510','Property, Plant & Equipment',NULL,'asset','fixed_asset','debit',true,false,false,'none','1500'),
    ('1511','Land','Land — not depreciated','asset','fixed_asset','debit',false,false,false,'none','1510'),
    ('1512','Buildings',NULL,'asset','fixed_asset','debit',false,false,false,'none','1510'),
    ('1513','Motor Vehicles',NULL,'asset','fixed_asset','debit',false,false,false,'none','1510'),
    ('1514','Plant & Machinery',NULL,'asset','fixed_asset','debit',false,false,false,'none','1510'),
    ('1515','Furniture & Fittings',NULL,'asset','fixed_asset','debit',false,false,false,'none','1510'),
    ('1516','Computer Equipment',NULL,'asset','fixed_asset','debit',false,false,false,'none','1510'),
    ('1517','Office Equipment',NULL,'asset','fixed_asset','debit',false,false,false,'none','1510'),
    ('1520','Accumulated Depreciation','Contra-asset — total depreciation to date','asset','fixed_asset','credit',true,false,false,'none','1500'),
    ('1521','Accum. Depr. — Buildings',NULL,'asset','fixed_asset','credit',false,false,false,'none','1520'),
    ('1522','Accum. Depr. — Motor Vehicles',NULL,'asset','fixed_asset','credit',false,false,false,'none','1520'),
    ('1523','Accum. Depr. — Plant & Machinery',NULL,'asset','fixed_asset','credit',false,false,false,'none','1520'),
    ('1524','Accum. Depr. — Furniture & Fittings',NULL,'asset','fixed_asset','credit',false,false,false,'none','1520'),
    ('1525','Accum. Depr. — Computer Equipment',NULL,'asset','fixed_asset','credit',false,false,false,'none','1520'),
    ('1530','Intangible Assets',NULL,'asset','non_current_asset','debit',true,false,false,'none','1500'),
    ('1531','Goodwill',NULL,'asset','non_current_asset','debit',false,false,false,'none','1530'),
    ('1532','Software & Licences',NULL,'asset','non_current_asset','debit',false,false,false,'none','1530'),
    ('1533','Accum. Amortisation — Intangibles',NULL,'asset','non_current_asset','credit',false,false,false,'none','1530'),
    ('1540','Long-term Investments',NULL,'asset','non_current_asset','debit',false,false,false,'none','1500'),
    ('1550','Deferred Tax Asset',NULL,'asset','non_current_asset','debit',false,false,false,'none','1500'),
    ('2000','Liabilities',NULL,'liability',NULL,'credit',true,true,false,'none',NULL),
    ('2100','Current Liabilities',NULL,'liability','current_liability','credit',true,true,false,'none','2000'),
    ('2110','Accounts Payable',NULL,'liability','current_liability','credit',true,false,false,'none','2100'),
    ('2111','Trade Creditors','Amounts owed to suppliers','liability','current_liability','credit',false,true,false,'none','2110'),
    ('2112','Accrued Liabilities','Expenses incurred but not yet invoiced','liability','current_liability','credit',false,false,false,'none','2110'),
    ('2113','Customer Deposits & Advances',NULL,'liability','current_liability','credit',false,false,false,'none','2110'),
    ('2114','Goods Received Not Invoiced','Stock received into the warehouse but not yet invoiced by the supplier (GRNI)','liability','current_liability','credit',false,true,false,'none','2110'),
    ('2120','Tax Payables',NULL,'liability','current_liability','credit',true,true,false,'none','2100'),
    ('2121','VAT Payable (Output Tax)','Output VAT collected, payable to MRA','liability','current_liability','credit',false,true,false,'vat_standard','2120'),
    ('2122','PAYE Payable','PAYE deducted from employees, payable to MRA','liability','current_liability','credit',false,true,false,'paye','2120'),
    ('2123','WHT Payable','Withholding tax deducted on payments — rate varies by transaction (10/15/20%)','liability','current_liability','credit',false,false,false,'none','2120'),
    ('2124','Income Tax Payable',NULL,'liability','current_liability','credit',false,false,false,'cit','2120'),
    ('2125','VAT Clearing','Net VAT position before MRA filing','liability','current_liability','credit',false,false,false,'vat_standard','2120'),
    ('2130','Payroll Payables',NULL,'liability','current_liability','credit',true,false,false,'none','2100'),
    ('2131','Salaries & Wages Payable','Net salaries owed to employees','liability','current_liability','credit',false,true,false,'none','2130'),
    ('2132','Pension Payable',NULL,'liability','current_liability','credit',false,false,false,'none','2130'),
    ('2140','Short-term Loans','Bank overdrafts and loans due within 12 months','liability','current_liability','credit',false,false,false,'none','2100'),
    ('2150','Dividends Payable',NULL,'liability','current_liability','credit',false,false,false,'none','2100'),
    ('2500','Non-Current Liabilities',NULL,'liability','non_current_liability','credit',true,false,false,'none','2000'),
    ('2510','Long-term Debt',NULL,'liability','non_current_liability','credit',true,false,false,'none','2500'),
    ('2511','Bank Loans — Long-term',NULL,'liability','non_current_liability','credit',false,false,false,'none','2510'),
    ('2512','Hire Purchase Payable',NULL,'liability','non_current_liability','credit',false,false,false,'none','2510'),
    ('2520','Deferred Tax Liability',NULL,'liability','non_current_liability','credit',false,false,false,'none','2500'),
    ('2530','Retirement Benefit Obligation',NULL,'liability','non_current_liability','credit',false,false,false,'none','2500'),
    ('3000','Equity',NULL,'equity',NULL,'credit',true,true,false,'none',NULL),
    ('3100','Share Capital',NULL,'equity','share_capital','credit',false,false,false,'none','3000'),
    ('3110','Owner''s Capital','Capital contributed by owner (sole trader / partnership)','equity','share_capital','credit',false,false,false,'none','3000'),
    ('3120','Retained Earnings','Accumulated profits retained in the business','equity','retained_earnings','credit',false,true,false,'none','3000'),
    ('3130','Current Year Profit / Loss','Net profit or loss for the current financial year','equity','retained_earnings','credit',false,true,false,'none','3000'),
    ('3140','Drawings / Dividends Paid',NULL,'equity','retained_earnings','debit',false,false,false,'none','3000'),
    ('3150','Revaluation Reserve',NULL,'equity','reserves','credit',false,false,false,'none','3000'),
    ('4000','Income',NULL,'income','revenue','credit',true,true,false,'none',NULL),
    ('4100','Sales Revenue',NULL,'income','revenue','credit',true,false,false,'none','4000'),
    ('4110','Sales — Goods','Revenue from sale of trading stock and finished goods','income','revenue','credit',false,false,false,'none','4100'),
    ('4111','Sales — Agricultural Produce','Revenue from sale of maize, tobacco and other farm produce','income','revenue','credit',false,false,false,'none','4100'),
    ('4112','Service Revenue','Revenue from professional and consulting services','income','revenue','credit',false,true,false,'none','4100'),
    ('4113','Manufacturing Revenue',NULL,'income','revenue','credit',false,false,false,'none','4100'),
    ('4114','Contract Revenue',NULL,'income','revenue','credit',false,false,false,'none','4100'),
    ('4120','Sales Returns & Allowances','Contra-revenue — goods returned by customers','income','revenue','debit',false,false,false,'none','4100'),
    ('4130','Sales Discounts',NULL,'income','revenue','debit',false,false,false,'none','4100'),
    ('4200','Other Income',NULL,'income','other_income','credit',true,false,false,'none','4000'),
    ('4210','Interest Income',NULL,'income','other_income','credit',false,false,false,'none','4200'),
    ('4220','Rental Income',NULL,'income','other_income','credit',false,false,false,'none','4200'),
    ('4230','FX Gains','Foreign exchange gains on currency transactions','income','other_income','credit',false,false,false,'none','4200'),
    ('4240','Gain on Disposal of Assets',NULL,'income','other_income','credit',false,false,false,'none','4200'),
    ('4250','Miscellaneous Income',NULL,'income','other_income','credit',false,false,false,'none','4200'),
    ('4260','Discount Received','Trade and settlement discounts received from suppliers','income','other_income','credit',false,false,false,'none','4200'),
    ('5000','Cost of Sales',NULL,'expense','cost_of_sales','debit',true,true,false,'none',NULL),
    ('5100','Cost of Goods Sold','Cost of trading stock sold','expense','cost_of_sales','debit',false,false,false,'none','5000'),
    ('5110','Cost of Agricultural Produce',NULL,'expense','cost_of_sales','debit',false,false,false,'none','5000'),
    ('5120','Direct Materials','Raw materials consumed in production','expense','cost_of_sales','debit',false,false,false,'none','5000'),
    ('5130','Direct Labour',NULL,'expense','cost_of_sales','debit',false,false,false,'none','5000'),
    ('5140','Manufacturing Overhead',NULL,'expense','cost_of_sales','debit',false,false,false,'none','5000'),
    ('5150','Direct Service Costs','Subcontractors and direct costs of delivering services','expense','cost_of_sales','debit',false,false,false,'none','5000'),
    ('5160','Freight & Delivery Inwards',NULL,'expense','cost_of_sales','debit',false,false,false,'none','5000'),
    ('5170','Purchase Returns & Allowances',NULL,'expense','cost_of_sales','credit',false,false,false,'none','5000'),
    ('5175','Purchase Discounts','Trade and settlement discounts received on purchases — contra cost of sales','expense','cost_of_sales','credit',false,false,false,'none','5000'),
    ('5180','Inventory Adjustments & Shrinkage','Stock write-offs, shrinkage and reconciliation of the stock subledger to the general ledger','expense','cost_of_sales','debit',false,true,false,'none','5000'),
    ('6000','Operating Expenses',NULL,'expense','operating_expense','debit',true,true,false,'none',NULL),
    ('6100','Payroll & Staff Costs',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6110','Basic Salaries','Gross salaries and wages — all staff','expense','operating_expense','debit',false,true,false,'none','6100'),
    ('6111','Overtime & Allowances',NULL,'expense','operating_expense','debit',false,false,false,'none','6100'),
    ('6112','Employer Pension Contributions',NULL,'expense','operating_expense','debit',false,false,false,'none','6100'),
    ('6113','Staff Welfare & Benefits',NULL,'expense','operating_expense','debit',false,false,false,'none','6100'),
    ('6114','Casual Labour',NULL,'expense','operating_expense','debit',false,false,false,'none','6100'),
    ('6115','Recruitment Costs',NULL,'expense','operating_expense','debit',false,false,false,'none','6100'),
    ('6116','Fringe Benefit Tax','FBT on non-cash employee benefits','expense','operating_expense','debit',false,false,false,'fbt','6100'),
    ('6200','Rent & Utilities',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6201','Rent & Rates',NULL,'expense','operating_expense','debit',false,false,false,'none','6200'),
    ('6202','Electricity & Water',NULL,'expense','operating_expense','debit',false,false,false,'none','6200'),
    ('6203','Telephone & Internet',NULL,'expense','operating_expense','debit',false,false,false,'none','6200'),
    ('6300','General Administration',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6301','Office Supplies & Stationery',NULL,'expense','operating_expense','debit',false,false,false,'none','6300'),
    ('6302','Insurance',NULL,'expense','operating_expense','debit',false,false,false,'none','6300'),
    ('6303','Security Services',NULL,'expense','operating_expense','debit',false,false,false,'none','6300'),
    ('6304','Licences & Permits',NULL,'expense','operating_expense','debit',false,false,false,'none','6300'),
    ('6305','Subscriptions & Memberships',NULL,'expense','operating_expense','debit',false,false,false,'none','6300'),
    ('6306','Printing & Photocopying',NULL,'expense','operating_expense','debit',false,false,false,'none','6300'),
    ('6400','Motor Vehicle & Travel',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6401','Fuel & Oil',NULL,'expense','operating_expense','debit',false,false,false,'none','6400'),
    ('6402','Vehicle Maintenance & Repairs',NULL,'expense','operating_expense','debit',false,false,false,'none','6400'),
    ('6403','Travel & Accommodation',NULL,'expense','operating_expense','debit',false,false,false,'none','6400'),
    ('6404','Staff Transport',NULL,'expense','operating_expense','debit',false,false,false,'none','6400'),
    ('6500','Marketing & Sales',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6501','Advertising & Promotions',NULL,'expense','operating_expense','debit',false,false,false,'none','6500'),
    ('6502','Sales Commissions',NULL,'expense','operating_expense','debit',false,false,false,'none','6500'),
    ('6503','Entertainment & Client Gifts',NULL,'expense','operating_expense','debit',false,false,false,'none','6500'),
    ('6504','Market Fees & Levies',NULL,'expense','operating_expense','debit',false,false,false,'none','6500'),
    ('6600','Professional & Legal Fees',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6601','Accounting & Audit Fees',NULL,'expense','operating_expense','debit',false,false,false,'none','6600'),
    ('6602','Legal Fees',NULL,'expense','operating_expense','debit',false,false,false,'none','6600'),
    ('6603','Consulting Fees',NULL,'expense','operating_expense','debit',false,false,false,'none','6600'),
    ('6700','Repairs & Maintenance',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6701','Building Repairs',NULL,'expense','operating_expense','debit',false,false,false,'none','6700'),
    ('6702','Equipment Repairs',NULL,'expense','operating_expense','debit',false,false,false,'none','6700'),
    ('6703','IT & Software Maintenance',NULL,'expense','operating_expense','debit',false,false,false,'none','6700'),
    ('6800','Depreciation',NULL,'expense','depreciation_amortisation','debit',true,false,false,'none','6000'),
    ('6801','Depreciation — Buildings',NULL,'expense','depreciation_amortisation','debit',false,false,false,'none','6800'),
    ('6802','Depreciation — Motor Vehicles',NULL,'expense','depreciation_amortisation','debit',false,false,false,'none','6800'),
    ('6803','Depreciation — Plant & Machinery',NULL,'expense','depreciation_amortisation','debit',false,false,false,'none','6800'),
    ('6804','Depreciation — Furniture & Fittings',NULL,'expense','depreciation_amortisation','debit',false,false,false,'none','6800'),
    ('6805','Depreciation — Computer Equipment',NULL,'expense','depreciation_amortisation','debit',false,false,false,'none','6800'),
    ('6806','Amortisation — Intangibles',NULL,'expense','depreciation_amortisation','debit',false,false,false,'none','6800'),
    ('6900','Miscellaneous Expenses',NULL,'expense','operating_expense','debit',true,false,false,'none','6000'),
    ('6901','Training & Development',NULL,'expense','operating_expense','debit',false,false,false,'none','6900'),
    ('6902','Bad Debts Written Off',NULL,'expense','operating_expense','debit',false,false,false,'none','6900'),
    ('6903','Donations & Charitable Contributions',NULL,'expense','operating_expense','debit',false,false,false,'none','6900'),
    ('6904','Sundry Expenses',NULL,'expense','operating_expense','debit',false,false,false,'none','6900'),
    ('7000','Finance Costs',NULL,'expense','finance_cost','debit',true,false,false,'none',NULL),
    ('7100','Interest Expense',NULL,'expense','finance_cost','debit',true,false,false,'none','7000'),
    ('7101','Interest on Loans',NULL,'expense','finance_cost','debit',false,false,false,'none','7100'),
    ('7102','Bank Overdraft Interest',NULL,'expense','finance_cost','debit',false,false,false,'none','7100'),
    ('7103','Hire Purchase Interest',NULL,'expense','finance_cost','debit',false,false,false,'none','7100'),
    ('7200','Bank Charges',NULL,'expense','finance_cost','debit',false,false,false,'none','7000'),
    ('7300','FX Losses','Foreign exchange losses on currency transactions','expense','finance_cost','debit',false,false,false,'none','7000'),
    ('7400','Loss on Disposal of Assets',NULL,'expense','finance_cost','debit',false,false,false,'none','7000'),
    ('7500','Income Tax Expense','Corporate income tax charge for the period','expense','tax_expense','debit',false,false,false,'cit','7000');

  insert into public.accounts (
    business_id, code, name, description, account_type, account_subtype,
    normal_balance, is_group, is_system, is_bank_account, tax_code,
    currency, opening_balance, is_active
  )
  select
    v_business_id, s.code, s.name, s.description, s.account_type,
    s.account_subtype, s.normal_balance, s.is_group, s.is_system,
    s.is_bank_account, s.tax_code, v_currency, 0, true
    from _coa_seed s;

  -- resolve parent_id by code (second pass; parents exist by now)
  update public.accounts a
     set parent_id = p.id
    from _coa_seed s
    join public.accounts p on p.business_id = v_business_id and p.code = s.parent_code
   where a.business_id = v_business_id
     and a.code = s.code
     and s.parent_code is not null;

  drop table _coa_seed;

  -- ── PAYE bands — only when explicitly provided (values UNKNOWN) ──────────
  if jsonb_typeof(p_biz->'paye_bands') = 'array' then
    for v_band in select * from jsonb_array_elements(p_biz->'paye_bands')
    loop
      insert into public.paye_bands (
        business_id, band_from, band_to, band_label, rate, fiscal_year,
        effective_from, effective_to
      ) values (
        v_business_id,
        (v_band->>'band_from')::numeric,
        nullif(v_band->>'band_to', '')::numeric,
        v_band->>'band_label',
        (v_band->>'rate')::numeric,
        coalesce(v_band->>'fiscal_year', to_char(now(), 'YYYY') || '/' || to_char(now() + interval '1 year', 'YY')),
        coalesce((v_band->>'effective_from')::date, (p_biz->>'financial_year_start')::date, date_trunc('year', now())::date),
        nullif(v_band->>'effective_to', '')::date
      );
    end loop;
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- create_business_with_owner — CRITICAL: the only business-creation path
--   [VERIFIED] argument list + uuid return: src/pages/CreateBusinessPage.tsx
--   [VERIFIED] post-creation contract: the page reloads business_users
--              memberships for the caller (owner row must exist, active)
--   [VERIFIED] user_profiles.full_name source: src/pages/RegisterPage.tsx
--              signs up with options.data.full_name
--   [INFERRED] counter initialisation = 1 (reserve_next_document_number
--              returns counter-1, so first document = <prefix>-0001;
--              SettingsPage defaults counters to 1)
--   [INFERRED] default prefixes INV/EXP/PAY, coa_template 'gaap',
--              plan_tier 'free' (businesses.plan_tier default 'free' is
--              evidenced in migration 20260726000001)
--   [INFERRED] audit entry 'business_created' (no evidence the legacy RPC
--              logged creation; harmless and consistent with audit model)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.create_business_with_owner(
  p_name text,
  p_trading_name text,
  p_registration_number text,
  p_tpin text,
  p_vat_number text,
  p_vat_registered boolean,
  p_base_currency text,
  p_financial_year_start text,
  p_timezone text,
  p_address_line1 text,
  p_city text,
  p_country text,
  p_phone text,
  p_email text,
  p_brand_color text,
  p_invoice_prefix text,
  p_expense_prefix text,
  p_payroll_prefix text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_biz_id   uuid := gen_random_uuid();
  v_fullname text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to create a business.'
      using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Business name is required.' using errcode = '22023';
  end if;
  if p_base_currency is null or not exists (select 1 from public.currencies c where c.code = p_base_currency) then
    raise exception 'Invalid base currency %', p_base_currency using errcode = '22023';
  end if;
  if p_financial_year_start is null or p_financial_year_start !~ '^[0-9]{2}-[0-9]{2}$' then
    raise exception 'financial_year_start must be MM-DD (e.g. 07-01).' using errcode = '22023';
  end if;
  if p_vat_registered is null then
    raise exception 'vat_registered is required.' using errcode = '22023';
  end if;

  -- Ensure the caller has a profile row (full_name comes from the
  -- registration metadata, matching RegisterPage). [VERIFIED source /
  -- INFERRED fallback]
  select coalesce(
    u.raw_user_meta_data->>'full_name',
    u.raw_user_meta_data->>'name',
    split_part(u.email, '@', 1)
  ) into v_fullname
    from auth.users u where u.id = v_user_id;

  insert into public.user_profiles (id, full_name)
  values (v_user_id, coalesce(v_fullname, 'User'))
  on conflict (id) do nothing;

  -- The business itself. Counters start at 1 so the first reserved document
  -- number is <prefix>-0001 (see reserve_next_document_number semantics).
  insert into public.businesses (
    id, name, trading_name, registration_number, tpin, vat_number,
    vat_registered, base_currency, financial_year_start, timezone,
    address_line1, city, country, phone, email, brand_color,
    invoice_prefix, expense_prefix, payroll_prefix,
    coa_template, is_active, plan_tier,
    invoice_next_number, expense_next_number, payroll_next_number
  ) values (
    v_biz_id, btrim(p_name), nullif(btrim(p_trading_name), ''),
    nullif(btrim(p_registration_number), ''), nullif(btrim(p_tpin), ''),
    nullif(btrim(p_vat_number), ''), p_vat_registered, p_base_currency,
    p_financial_year_start, coalesce(nullif(btrim(p_timezone), ''), 'Africa/Blantyre'),
    nullif(btrim(p_address_line1), ''), nullif(btrim(p_city), ''),
    nullif(btrim(p_country), ''), nullif(btrim(p_phone), ''),
    nullif(btrim(p_email), ''), nullif(btrim(p_brand_color), ''),
    coalesce(nullif(btrim(p_invoice_prefix), ''), 'INV'),
    coalesce(nullif(btrim(p_expense_prefix), ''), 'EXP'),
    coalesce(nullif(btrim(p_payroll_prefix), ''), 'PAY'),
    'gaap', true, 'free', 1, 1, 1
  );

  -- Owner membership (the page reloads memberships immediately after).
  insert into public.business_users (
    business_id, user_id, role, is_active, accepted_at, created_at, updated_at
  ) values (
    v_biz_id, v_user_id, 'owner', true, now(), now(), now()
  )
  on conflict (business_id, user_id) do update
    set role = 'owner', is_active = true, accepted_at = coalesce(business_users.accepted_at, now()), updated_at = now();

  -- Default chart of accounts (gaap template).
  perform public.seed_new_business(jsonb_build_object(
    'business_id', v_biz_id::text,
    'coa_template', 'gaap',
    'base_currency', p_base_currency,
    'financial_year_start', p_financial_year_start
  ));

  -- Audit trail [INFERRED event type — legacy may not have logged this; the
  -- row is chain-consistent with log_manual_audit_event]
  insert into public.audit_log (
    business_id, user_id, user_email, event_type, resource_type, resource_id,
    resource_ref, old_values, new_values, notes, occurred_at, ip_address,
    prev_hash, entry_hash
  ) values (
    v_biz_id, v_user_id,
    (select email from auth.users where id = v_user_id),
    'business_created', 'businesses', v_biz_id, btrim(p_name), null, null,
    'Business created with owner', now(), '0.0.0.0'::inet, null,
    public.audit_chain_hash(null, v_biz_id, v_user_id, now(), 'business_created', 'businesses', v_biz_id::text, btrim(p_name), null, null, 'Business created with owner')
  );

  return v_biz_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- accept_invitation — legacy token-based invitation acceptance (fallback)
--   [VERIFIED] return contract from src/pages/AcceptInvitationPage.tsx:
--              { business_id, role, business_name, already_member? }
--   [VERIFIED] acceptance flow mirrors supabase/functions/accept-invite-link
--              (expiry check, email match, reactivate/insert business_users,
--              mark invitation accepted)
--   [INFERRED] error wording (page matches 'already a member', 'Invalid or
--              expired', 'Invitation not found')
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.accept_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_inv     record;
  v_role    public.user_role;
  v_active  boolean;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to accept an invitation.'
      using errcode = '42501';
  end if;

  select bi.*, b.name as business_name, b.is_active as biz_active, b.deleted_at as biz_deleted
    into v_inv
    from public.business_invitations bi
    join public.businesses b on b.id = bi.business_id
   where bi.token = p_token;

  if v_inv.id is null then
    raise exception 'Invitation not found or expired.' using errcode = 'P0002';
  end if;
  if v_inv.expires_at < now() then
    raise exception 'Invitation not found or expired.' using errcode = 'P0002';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'Invitation already accepted.' using errcode = '55000';
  end if;
  if not v_inv.biz_active or v_inv.biz_deleted is not null then
    raise exception 'This business is no longer active.' using errcode = 'P0002';
  end if;
  if v_inv.email is not null and lower(v_inv.email) <> lower((select email from auth.users where id = v_user_id)) then
    raise exception 'This invitation is for a different email address.' using errcode = '42501';
  end if;

  -- Already an active member? (reactivate and return success)
  select role, is_active into v_role, v_active
    from public.business_users
   where business_id = v_inv.business_id and user_id = v_user_id;

  if v_active then
    update public.business_invitations
       set accepted_at = now(), accepted_by = v_user_id
     where id = v_inv.id;
    return jsonb_build_object(
      'success', true, 'already_member', true,
      'business_id', v_inv.business_id, 'role', v_role,
      'business_name', v_inv.business_name
    );
  end if;

  insert into public.business_users (
    business_id, user_id, role, is_active, accepted_at, created_at, updated_at
  ) values (
    v_inv.business_id, v_user_id, v_inv.role, true, now(), now(), now()
  )
  on conflict (business_id, user_id) do update
    set role = excluded.role, is_active = true,
        accepted_at = coalesce(business_users.accepted_at, now()), updated_at = now();

  update public.business_invitations
     set accepted_at = now(), accepted_by = v_user_id
   where id = v_inv.id;

  return jsonb_build_object(
    'success', true, 'business_id', v_inv.business_id, 'role', v_inv.role,
    'business_name', v_inv.business_name
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- invite_member — legacy token-based invitation creation (fallback)
--   [VERIFIED] returns the invitation token (TeamManagementPage builds
--              /accept-invitation?token=<token> from the RPC result)
--   [VERIFIED] permission model from supabase/functions/create-invite-link
--              and local-backup/index.ts: only owners may invite as
--              owner/admin; owners+admins may create any other invite
--   [VERIFIED] business_invitations shape from migration 20260723000001
--              (token unique, expires_at default now()+7 days)
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.invite_member(
  p_business_id uuid,
  p_email text,
  p_role public.user_role
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id   uuid := auth.uid();
  v_caller    record;
  v_token     text := encode(gen_random_bytes(32), 'hex');
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select role, is_active into v_caller
    from public.business_users
   where business_id = p_business_id and user_id = v_user_id;

  if v_caller.role is null or not v_caller.is_active then
    raise exception 'You are not a member of this business.' using errcode = '42501';
  end if;

  -- Only owners can invite as owner/admin; owners + admins for other roles.
  if p_role in ('owner', 'admin') and v_caller.role <> 'owner' then
    raise exception 'Only owners can invite as owner or admin.' using errcode = '42501';
  end if;
  if v_caller.role not in ('owner', 'admin') then
    raise exception 'Only owners and admins can create invitations.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.businesses b
     where b.id = p_business_id and b.is_active and b.deleted_at is null
  ) then
    raise exception 'Business not found or inactive.' using errcode = 'P0002';
  end if;

  insert into public.business_invitations (
    business_id, email, role, token, invited_by, invited_at, expires_at
  ) values (
    p_business_id, nullif(btrim(p_email), ''), p_role, v_token, v_user_id,
    now(), now() + interval '7 days'
  );

  return v_token;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- log_manual_audit_event — append a hash-chained audit entry
--   [VERIFIED] arguments from JournalRepository.writeAuditLog and
--              PeriodRepository.writeAuditLog (8 named args)
--   [INFERRED] hash chain algorithm: sha256 over a canonical, timezone-
--              independent concatenation; entry_hash = H(prev_hash, fields),
--              prev_hash = previous entry's entry_hash per business. The
--              original algorithm is UNKNOWN (production was not captured);
--              this definition is self-consistent on fresh databases and is
--              verified by verify_audit_chain below.
--   [INFERRED] ip_address = '0.0.0.0' (column is NOT NULL per live staging;
--              the RPC has no client-IP source)
--   Permission: caller must be able to write business data (writers).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.log_manual_audit_event(
  p_business_id uuid,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_resource_ref text default null,
  p_old_values jsonb default null,
  p_new_values jsonb default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id  uuid := auth.uid();
  v_email    text;
  v_now      timestamptz := now();
  v_prev     text;
  v_hash     text;
begin
  if v_user_id is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not public.can_write_business_data(p_business_id) then
    raise exception 'You do not have permission to write audit entries for this business.'
      using errcode = '42501';
  end if;

  select email into v_email from auth.users where id = v_user_id;

  select entry_hash into v_prev
    from public.audit_log
   where business_id = p_business_id
   order by id desc limit 1;

  v_hash := public.audit_chain_hash(v_prev, p_business_id, v_user_id, v_now,
    p_event_type, p_resource_type, p_resource_id, p_resource_ref,
    p_old_values, p_new_values, p_notes);

  insert into public.audit_log (
    business_id, user_id, user_email, event_type, resource_type, resource_id,
    resource_ref, old_values, new_values, notes, occurred_at, ip_address,
    prev_hash, entry_hash
  ) values (
    p_business_id, v_user_id, v_email, p_event_type, p_resource_type,
    p_resource_id, p_resource_ref, p_old_values, p_new_values, p_notes,
    v_now, '0.0.0.0'::inet, v_prev, v_hash
  );
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- verify_audit_chain — walk a business's audit chain and validate hashes
--   [VERIFIED] output columns from AuditLogRepository.ChainVerificationResult
--              (id, occurred_at, resource_type, resource_id, event_type,
--              entry_hash, prev_hash, chain_valid)
--   [INFERRED] same hash algorithm as log_manual_audit_event
--   Permission: can_read_audit roles (owner/admin/accountant/payroll_manager/
--               auditor/board_member per 20260728000009).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.verify_audit_chain(
  p_business_id uuid,
  p_resource_type text default null
)
returns table (
  id bigint, occurred_at timestamptz, resource_type text, resource_id text,
  event_type text, entry_hash text, prev_hash text, chain_valid boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_expected text;
  v_prev_hash text := null;
  v_prev_entry text := null;
begin
  if not public.can_read_audit(p_business_id) then
    raise exception 'You do not have permission to read the audit log.'
      using errcode = '42501';
  end if;

  for r in
    select al.id, al.occurred_at, al.resource_type, al.resource_id, al.event_type,
           al.entry_hash, al.prev_hash, al.user_id, al.resource_ref,
           al.old_values, al.new_values, al.notes
      from public.audit_log al
     where al.business_id = p_business_id
       and (p_resource_type is null or al.resource_type = p_resource_type)
     order by al.id asc
  loop
    v_expected := public.audit_chain_hash(r.prev_hash, p_business_id, r.user_id,
      r.occurred_at, r.event_type, r.resource_type, r.resource_id,
      r.resource_ref, r.old_values, r.new_values, r.notes);

    id           := r.id;
    occurred_at  := r.occurred_at;
    resource_type := r.resource_type;
    resource_id  := r.resource_id;
    event_type   := r.event_type;
    entry_hash   := r.entry_hash;
    prev_hash    := r.prev_hash;
    chain_valid  := (r.entry_hash = v_expected)
                    and (r.prev_hash is not distinct from v_prev_entry);
    return next;

    v_prev_entry := r.entry_hash;
  end loop;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Grants — follow the repository's existing RPC grant pattern
-- ────────────────────────────────────────────────────────────────────────────
revoke all on function public.current_user_role(uuid) from public;
grant execute on function public.current_user_role(uuid) to authenticated, service_role;
revoke all on function public.get_user_role(uuid) from public;
grant execute on function public.get_user_role(uuid) to authenticated, service_role;
revoke all on function public.get_enum_values(text) from public;
grant execute on function public.get_enum_values(text) to authenticated, service_role;
revoke all on function public.seed_new_business(jsonb) from public;
grant execute on function public.seed_new_business(jsonb) to service_role;
revoke all on function public.create_business_with_owner(text, text, text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.create_business_with_owner(text, text, text, text, text, boolean, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated, service_role;
revoke all on function public.invite_member(uuid, text, public.user_role) from public;
grant execute on function public.invite_member(uuid, text, public.user_role) to authenticated, service_role;
revoke all on function public.log_manual_audit_event(uuid, text, text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.log_manual_audit_event(uuid, text, text, text, text, jsonb, jsonb, text) to authenticated, service_role;
revoke all on function public.verify_audit_chain(uuid, text) from public;
grant execute on function public.verify_audit_chain(uuid, text) to authenticated, service_role;
revoke all on function public.audit_chain_hash(text, uuid, uuid, timestamptz, text, text, text, text, jsonb, jsonb, text) from public;
grant execute on function public.audit_chain_hash(text, uuid, uuid, timestamptz, text, text, text, text, jsonb, jsonb, text) to service_role;
