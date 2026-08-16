-- ============================================================================
-- Phase 8B.2 — View reconstruction
-- ============================================================================
-- Reconstructs the four application views confirmed missing from the
-- repository (and from fresh staging) in Phase 8A.1:
--
--   v_ar_ageing        v_asset_register
--   v_reorder_alerts   v_trial_balance
--
-- EVIDENCE RULES (Phase 8B)
--   • Column contracts are [VERIFIED] from src/dal/types/database.generated.ts
--     (generated from the live database).
--   • Calculation semantics are [VERIFIED] from the repository consumers:
--       - v_trial_balance: FinancialStatementRepository.computeBalances
--         (amount_base only; status IN ('posted','reversed'); accounts
--         deleted_at IS NULL; balance positive on the account's NATURAL side),
--         JournalRepository.validateBalanced (debits/credits), ReportsPage.
--       - v_ar_ageing: IncomeRepository.findOutstanding (invoice_type='invoice',
--         status IN ('sent','partially_paid','overdue'), deleted_at IS NULL),
--         amount_due derivation (functional_amount ?? total_amount - amount_paid).
--       - v_asset_register: AssetsPage (net_book_value = acquisition_cost -
--         accumulated_depreciation when null), AssetRepository
--         (last_depreciation_date = schedule.period_end).
--       - v_reorder_alerts: WarehousePage (alert = quantity_available <=
--         reorder_level), InventoryRepository.findReorderAlerts.
--   • Any behaviour without repository evidence is [INFERRED] and marked.
--   • These are reconstructions, NOT recoveries of the original bodies.
--
-- SAFETY
--   Plain (security_invoker) views — RLS on the underlying tables applies,
--   so tenant isolation is preserved. No secrets. No DML.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- v_trial_balance — detailed trial balance per account
--   [VERIFIED] semantics: FinancialStatementRepository.computeBalances:
--     • journal_lines.amount_base ONLY (MWK functional currency)
--     • journal_entries.status IN ('posted','reversed')
--     • accounts.deleted_at IS NULL
--     • balance sign: positive = natural balance side for the account
--       (debit-normal accounts show positive debit balances; credit-normal
--       show positive credit balances)
--   [VERIFIED] total_debits / total_credits: sum of amount_base by is_debit
--   [VERIFIED] account columns: accounts (code, name, account_type,
--              account_subtype, normal_balance)
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_trial_balance;
create or replace view public.v_trial_balance as
select
  a.business_id,
  a.code,
  a.name,
  a.account_type,
  a.account_subtype,
  a.normal_balance,
  coalesce(sum(case when jl.is_debit then jl.amount_base else 0 end), 0) as total_debits,
  coalesce(sum(case when jl.is_debit then 0 else jl.amount_base end), 0) as total_credits,
  -- signed per normal_balance convention: positive = natural side
  case when a.normal_balance = 'credit'
       then -coalesce(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end), 0)
       else  coalesce(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end), 0)
  end as balance
from public.accounts a
left join public.journal_lines jl
  on jl.account_id = a.id
 and jl.business_id = a.business_id
left join public.journal_entries je
  on je.id = jl.journal_entry_id
 and je.business_id = a.business_id
 and je.status in ('posted', 'reversed')
where a.deleted_at is null
group by a.id, a.business_id, a.code, a.name, a.account_type, a.account_subtype, a.normal_balance;

comment on view public.v_trial_balance is
  'Detailed trial balance per account: total_debits/total_credits from posted+reversed journal lines (amount_base, MWK functional currency); balance is positive on the account natural side. Reconstructed in Phase 8B.2 from FinancialStatementRepository.computeBalances semantics.';

-- ────────────────────────────────────────────────────────────────────────────
-- v_ar_ageing — accounts receivable ageing per open invoice
--   [VERIFIED] invoice filter: IncomeRepository.findOutstanding —
--              invoice_type='invoice', status IN ('sent','partially_paid',
--              'overdue'), deleted_at IS NULL
--   [VERIFIED] amount_due derivation: coalesce(amount_due,
--              (functional_amount ?? total_amount) - amount_paid)
--   [VERIFIED] contact_name from contacts; invoice display columns
--   [INFERRED] ageing buckets: current / 1-30 / 31-60 / 61-90 / 90+ and
--              days_overdue = current_date - due_date (0 when not overdue);
--              no bucket-label evidence exists in the repository
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_ar_ageing;
create or replace view public.v_ar_ageing as
select
  i.business_id,
  i.contact_id,
  c.name as contact_name,
  i.id as invoice_id,
  i.invoice_number,
  i.issue_date,
  i.due_date,
  i.currency,
  i.total_amount,
  i.amount_paid,
  coalesce(
    i.amount_due,
    coalesce(i.functional_amount, i.total_amount) - i.amount_paid
  ) as amount_due,
  case
    when i.due_date is null or i.due_date >= current_date then 0
    else (current_date - i.due_date)
  end as days_overdue,
  case
    when i.due_date is null or i.due_date >= current_date then 'current'
    when (current_date - i.due_date) <= 30 then '1-30'
    when (current_date - i.due_date) <= 60 then '31-60'
    when (current_date - i.due_date) <= 90 then '61-90'
    else '90+'
  end as ageing_bucket  -- [INFERRED] bucket labels
from public.invoices i
left join public.contacts c on c.id = i.contact_id
where i.deleted_at is null
  and i.invoice_type = 'invoice'
  and i.status in ('sent', 'partially_paid', 'overdue');

comment on view public.v_ar_ageing is
  'Accounts-receivable ageing per open sales invoice (invoice_type=invoice; sent/partially_paid/overdue). amount_due derived like IncomeRepository. Reconstructed in Phase 8B.2.';

-- ────────────────────────────────────────────────────────────────────────────
-- v_asset_register — fixed asset register with category/branch/department
--   [VERIFIED] net_book_value fallback: acquisition_cost -
--              accumulated_depreciation (AssetsPage)
--   [VERIFIED] last_depreciation_date = fixed_assets.last_depreciation_date
--              (set from depreciation_schedules.period_end by
--              AssetRepository.postDepreciation)
--   [VERIFIED] category/branch/department names via joins
--   [INFERRED] register includes all non-deleted assets (incl.
--              fully_depreciated/disposed? disposed assets keep deleted_at
--              null in the app; status column carries the state)
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_asset_register;
create or replace view public.v_asset_register as
select
  fa.business_id,
  fa.asset_number,
  fa.name,
  fa.acquisition_cost,
  fa.acquisition_date,
  fa.depreciable_amount,
  fa.residual_value,
  fa.accumulated_depreciation,
  fa.depreciation_method,
  fa.last_depreciation_date,
  coalesce(fa.net_book_value, fa.acquisition_cost - fa.accumulated_depreciation) as net_book_value,
  fa.status,
  cat.name as category,
  br.name as branch,
  dept.name as department
from public.fixed_assets fa
left join public.asset_categories cat on cat.id = fa.category_id
left join public.branches br on br.id = fa.branch_id
left join public.departments dept on dept.id = fa.department_id
where fa.deleted_at is null;

comment on view public.v_asset_register is
  'Fixed asset register: all non-deleted assets with category/branch/department names and computed net book value. Reconstructed in Phase 8B.2.';

-- ────────────────────────────────────────────────────────────────────────────
-- v_reorder_alerts — low-stock alerts per product/location
--   [VERIFIED] alert condition: WarehousePage isLow =
--              reorder_level != null AND quantity_available <= reorder_level
--   [VERIFIED] quantity columns from inventory_balances; product/location
--              display columns; reorder_level/reorder_quantity from products
--   [INFERRED] estimated_reorder_cost = reorder_quantity * average_cost
--              (column name implies it; no direct evidence)
--   [INFERRED] only tracked, active, non-deleted products
-- ────────────────────────────────────────────────────────────────────────────
drop view if exists public.v_reorder_alerts;
create or replace view public.v_reorder_alerts as
select
  ib.business_id,
  ib.product_id,
  p.name as product_name,
  p.sku,
  l.name as location_name,
  ib.quantity_on_hand,
  ib.quantity_reserved,
  ib.quantity_available,
  ib.average_cost,
  p.reorder_level,
  p.reorder_quantity,
  coalesce(p.reorder_quantity * ib.average_cost, 0) as estimated_reorder_cost  -- [INFERRED]
from public.inventory_balances ib
join public.products p
  on p.id = ib.product_id
 and p.business_id = ib.business_id
 and p.track_inventory = true
 and p.is_active = true
 and p.deleted_at is null
left join public.inventory_locations l
  on l.id = ib.location_id
 and l.business_id = ib.business_id
where p.reorder_level is not null
  and coalesce(ib.quantity_available, ib.quantity_on_hand) <= p.reorder_level;

comment on view public.v_reorder_alerts is
  'Low-stock alerts: inventory balances at or below the product reorder level, per location. Reconstructed in Phase 8B.2.';

-- ────────────────────────────────────────────────────────────────────────────
-- Grants (Supabase default: views are readable by anon/authenticated/
-- service_role through the public schema grant; RLS on underlying tables
-- still applies because the views are security_invoker).
-- ────────────────────────────────────────────────────────────────────────────
