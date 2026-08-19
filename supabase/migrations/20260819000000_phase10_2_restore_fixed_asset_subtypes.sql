-- ============================================================================
-- Phase 10.2 — restore fixed assets to Non-Current Assets (subtype repair).
--
-- CONTEXT
--   The SOFP (Statement of Financial Position) routes accounts to sections
--   by account_subtype. The 1500-1599 code range is the DOCUMENTED
--   Non-Current Assets range (see src/services/seedChartOfAccounts.ts header:
--   "1500s Non-Current Assets"). Legacy rows and manual edits can leave a
--   15xx ASSET account with account_subtype NULL or with a non-asset value,
--   which drops the account from every SOFP section (or misroutes it) — the
--   "fixed assets missing from Non-Current Assets" symptom that survived
--   PR #107 for accounts whose subtype is not NULL.
--
-- FIX
--   Repair the DATA at the source so every surface (SOFP, COA page, branch
--   performance report) classifies 15xx asset accounts correctly:
--     * 151x / 152x codes  -> 'fixed_asset'          (PP&E + accum. dep.)
--     * other 15xx codes   -> 'non_current_asset'    (1500 group, intangibles,
--                                                     long-term investments)
--   Only rows that are clearly BROKEN are touched:
--     * account_subtype IS NULL                       (invisible in SOFP), or
--     * account_subtype is NOT one of the three asset subtypes
--       ('current_asset' | 'non_current_asset' | 'fixed_asset'), i.e. junk
--       values such as 'revenue' / 'current_liability' (also invisible in
--       SOFP).
--   A 'current_asset' subtype on a 15xx account is left ALONE: it is a
--   deliberate-looking choice, and the report-level override (Phase 10.2,
--   FinancialStatementRepository.getSOFP) already presents every 15xx asset
--   account under Non-Current Assets regardless, so the statement is correct
--   either way. Every repaired row is logged via RAISE NOTICE so the deploy
--   log documents exactly what changed.
--
-- IDEMPOTENT. Touches no journal entries, no balances — only the subtype
-- classification of clearly-broken 15xx asset account rows.
-- ============================================================================

do $$
declare
  r record;
  new_subtype account_subtype;
  n integer := 0;
begin
  for r in
    select a.id, a.business_id, a.code, a.name, a.account_subtype
      from public.accounts a
     where a.account_type = 'asset'
       and a.code like '15%'
       and a.deleted_at is null
       and (
             a.account_subtype is null
          or a.account_subtype not in ('current_asset', 'non_current_asset', 'fixed_asset')
           )
     order by a.code
  loop
    new_subtype := case
      when r.code like '151%' or r.code like '152%' then 'fixed_asset'::account_subtype
      else 'non_current_asset'::account_subtype
    end;

    update public.accounts
       set account_subtype = new_subtype,
           updated_at = now()
     where id = r.id;

    raise notice 'phase10.2: account % (%) business %: subtype % -> %',
      r.code, r.name, r.business_id, coalesce(r.account_subtype::text, 'NULL'), new_subtype;
    n := n + 1;
  end loop;

  raise notice 'phase10.2: repaired % clearly-broken 15xx asset account(s)', n;
end
$$;

-- Verification queries:
--   select code, name, account_subtype from public.accounts
--    where account_type='asset' and code like '15%' and deleted_at is null
--    order by code;
-- After this migration every such row has account_subtype in
-- ('fixed_asset','non_current_asset') — except rows that were already
-- 'current_asset', which are deliberately left as-is.
