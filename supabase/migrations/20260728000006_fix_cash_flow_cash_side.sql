-- Fix cash-flow view: calculate movement from cash-equivalent lines only.
-- Recreates the view so this also applies to databases where the original
-- migration has already been run.

-- Cash flow statement view, monthly aggregation.
-- Mirrors the structure the React component reads from `v_cash_flow`:
--   business_id, period (YYYY-MM), operating, investing, financing, net_change.
-- Reuses the IAS 7 indirect-method classification rules from
-- FinancialStatementRepository.getCashFlow so server-side queries and
-- client-side queries stay in sync.
--
-- Per-entry classification priority (one classification per journal entry):
--   1. source_type = 'fixed_asset_revaluation'   -> excluded (no cash impact)
--   2. source_type = 'fixed_asset_disposal'      -> investing
--   3. reversal entries -> inherit the original entry's source_type
--   4. counterpart account_subtype = 'fixed_asset'                  -> investing
--   5. counterpart account code in LOAN_ACCOUNT_CODES
--      (2140, 2145, 2510, 2511, 2512, 2515)                         -> financing
--   6. counterpart account code = '3140' (Drawings/Dividends)       -> financing
--   7. counterpart account_subtype = 'share_capital'                -> financing
--   8. else (any other touch on a cash-equivalent account)          -> operating
--
-- An entry is considered to "touch" a cash-equivalent account when at
-- least one of its lines posts to an account flagged as cash and cash
-- equivalents (is_bank_account OR code in 1110, 1115, 1125, 1126).
-- Internal transfers between two cash-equivalent accounts (e.g. Airtel
-- Money -> Bank) are inherently zero-net on total cash and are excluded
-- by construction: when every line is a cash equivalent, classification
-- falls into the 'operating' branch but the net movement is zero, so it
-- contributes nothing to any aggregate.
create or replace view public.v_cash_flow
  with (security_invoker = true) as
with
  -- Account metadata: classify every account once.
  account_meta as (
    select
      a.id,
      a.business_id,
      a.code,
      a.account_subtype,
      case
        when a.is_bank_account then true
        when a.code in ('1110', '1115', '1125', '1126') then true
        else false
      end as is_cash_equivalent
    from public.accounts a
    where a.deleted_at is null
  ),
  -- Posted + reversed journal entries with their period bucket.
  posted_entries as (
    select
      je.id as entry_id,
      je.business_id,
      je.source_type,
      je.reversal_of,
      to_char(je.entry_date, 'YYYY-MM') as period
    from public.journal_entries je
    where je.status in ('posted', 'reversed')
  ),
  -- Effective source_type for reversals (inherit from the original entry),
  -- so a fixed_asset_disposal reversed later still classifies as investing.
  effective_entries as (
    select
      pe.entry_id,
      pe.business_id,
      pe.period,
      case
        when pe.source_type = 'reversal' and pe.reversal_of is not null then
          coalesce(
            (select je_orig.source_type
             from public.journal_entries je_orig
             where je_orig.id = pe.reversal_of),
            'reversal'
          )
        else pe.source_type
      end as effective_source_type
    from posted_entries pe
  ),
  -- Per-entry lines joined with account metadata. Each row is one
  -- (entry, line) with cash-equivalent flag and the account's subtype/code.
  enriched_lines as (
    select
      ee.entry_id,
      ee.business_id,
      ee.period,
      ee.effective_source_type,
      jl.is_debit,
      jl.amount_base,
      am.code as account_code,
      am.account_subtype,
      am.is_cash_equivalent
    from effective_entries ee
    join public.journal_lines jl on jl.journal_entry_id = ee.entry_id
    join account_meta am on am.id = jl.account_id
  ),
  -- Cash-line net movement per entry. Only entries that touch at least
  -- one cash-equivalent account contribute (other entries are not
  -- cash-flow relevant).
  cash_per_entry as (
    select
      el.entry_id,
      el.business_id,
      el.period,
      -- Only the cash-equivalent side represents movement in cash. Summing all
      -- journal lines would always produce zero for a balanced double-entry
      -- (cash debit + expense credit), which was the reason this statement
      -- reported zero for every transaction.
      sum(case when el.is_cash_equivalent then
        case when el.is_debit then el.amount_base else -el.amount_base end
        else 0
      end)::numeric as net_cash
    from enriched_lines el
    group by el.entry_id, el.business_id, el.period
    having bool_or(el.is_cash_equivalent)
  ),
  -- One classification per entry, derived from the priority list above.
  classification_per_entry as (
    select
      cpe.entry_id,
      cpe.business_id,
      cpe.period,
      cpe.net_cash,
      case
        when bool_or(el.effective_source_type = 'fixed_asset_revaluation') then 'excluded'
        when bool_or(el.effective_source_type = 'fixed_asset_disposal') then 'investing'
        when bool_and(el.is_cash_equivalent) then 'operating'  -- internal transfer; net_cash already netted
        when bool_or(el.account_subtype = 'fixed_asset') then 'investing'
        when bool_or(el.account_code in ('2140', '2145', '2510', '2511', '2512', '2515')) then 'financing'
        when bool_or(el.account_code = '3140') then 'financing'
        when bool_or(el.account_subtype = 'share_capital') then 'financing'
        else 'operating'
      end as classification
    from cash_per_entry cpe
    join enriched_lines el on el.entry_id = cpe.entry_id
    group by cpe.entry_id, cpe.business_id, cpe.period, cpe.net_cash
  )
select
  cpe.business_id,
  cpe.period,
  coalesce(sum(case when cls.classification = 'operating'  then cpe.net_cash else 0 end), 0)::numeric as operating,
  coalesce(sum(case when cls.classification = 'investing'  then cpe.net_cash else 0 end), 0)::numeric as investing,
  coalesce(sum(case when cls.classification = 'financing'  then cpe.net_cash else 0 end), 0)::numeric as financing,
  coalesce(sum(case when cls.classification in ('operating','investing','financing') then cpe.net_cash else 0 end), 0)::numeric as net_change
from cash_per_entry cpe
join classification_per_entry cls using (entry_id)
group by cpe.business_id, cpe.period;

comment on view public.v_cash_flow is
  'Monthly cash-flow aggregation (IAS 7 indirect method). Columns: business_id, period (YYYY-MM), operating, investing, financing, net_change. Read via the supabase client; RLS on the underlying tables is honoured because the view is defined with security_invoker.';
