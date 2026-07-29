-- ─────────────────────────────────────────────────────────────────────────
-- Fix tenant isolation on v_inventory_ledger_variance
-- ─────────────────────────────────────────────────────────────────────────
-- 20260728000005 created this view without `security_invoker = true`. A view
-- defaults to running with its OWNER's privileges, so RLS on businesses,
-- inventory_balances, accounts and journal_lines is NOT applied to the rows it
-- reads. Combined with `grant select ... to authenticated`, that means any
-- logged-in user of any tenant could read every business's name, stock-on-hand
-- valuation and inventory GL balance — including white-label partners' clients.
--
-- Unlike v_partner_client_usage (see 20260727000008, which had to KEEP owner
-- rights and enforce the tenant check inside the view body), invoker rights are
-- the correct fix here. That view rolls up journal_entries / invoices for
-- businesses the caller deliberately has no row-level read access to, so
-- flipping it would have silently zeroed its counts. This view only reads
-- tables an ordinary member already reads directly for their own business
-- (FinancialStatementRepository queries journal_lines and accounts through the
-- supabase client), so under invoker rights the numbers are unchanged for the
-- caller's own businesses and simply disappear for everyone else's.
--
-- Dropped and recreated rather than CREATE OR REPLACE'd so the reloption is
-- applied unambiguously. Nothing in the application selects from this view yet
-- (it is a diagnostic used from the SQL editor and from Warehouse -> Ledger
-- reconciliation), so there are no dependent objects to cascade.
--
-- No data is read, written or migrated by this file.

drop view if exists public.v_inventory_ledger_variance;

create view public.v_inventory_ledger_variance
  with (security_invoker = true) as
with subledger as (
  select
    ib.business_id,
    coalesce(sum(ib.quantity_on_hand * ib.average_cost), 0) as subledger_value
  from public.inventory_balances ib
  group by ib.business_id
),
ledger as (
  select
    a.business_id,
    coalesce(sum(
      case when jl.is_debit then jl.amount_base else -jl.amount_base end
    ), 0) as ledger_balance
  from public.accounts a
  left join public.journal_lines jl
         on jl.account_id = a.id
  left join public.journal_entries je
         on je.id = jl.journal_entry_id
        and je.status in ('posted', 'reversed')
  where a.code like '114%'
    and a.is_group = false
    and a.deleted_at is null
  group by a.business_id
)
select
  b.id                                        as business_id,
  b.name                                      as business_name,
  coalesce(s.subledger_value, 0)              as stock_on_hand_value,
  coalesce(l.ledger_balance, 0)               as inventory_ledger_balance,
  coalesce(s.subledger_value, 0)
    - coalesce(l.ledger_balance, 0)           as variance,
  case
    when abs(coalesce(s.subledger_value, 0) - coalesce(l.ledger_balance, 0)) < 0.01
      then 'reconciled'
    when coalesce(s.subledger_value, 0) > coalesce(l.ledger_balance, 0)
      then 'missing from balance sheet'
    else 'overstated on balance sheet'
  end                                         as status
from public.businesses b
left join subledger s on s.business_id = b.id
left join ledger    l on l.business_id = b.id
where b.deleted_at is null;

comment on view public.v_inventory_ledger_variance is
  'Stock subledger value vs the inventory GL balance per business. A non-zero variance means Inventory on the Statement of Financial Position disagrees with the warehouse. Post the correction from Warehouse -> Ledger reconciliation. Defined with security_invoker so RLS on businesses / inventory_balances / accounts / journal_lines is honoured — a caller only ever sees businesses they are an active member of. Run it as the service role (SQL editor) to audit every tenant.';

revoke all on public.v_inventory_ledger_variance from anon;
grant select on public.v_inventory_ledger_variance to authenticated;
