-- ============================================================================
-- Phase 9.2 — Malawi PAYE reference data (APPROVED 2026-08-15)
-- ============================================================================
--
-- APPROVAL
--   Values approved by the Ledgr stakeholder on 2026-08-15. Source:
--   Malawi Revenue Authority statement (Commissioner General Tambulasi),
--   2025/26 Mid-Year Budget measures, effective 30 December 2025 — as
--   published by MCCCI (2026-01-05) and corroborated by four independent
--   payroll platforms. Governance record:
--   docs/database/phase-9-reference-data.md.
--
-- STATUTORY BANDS (MONTHLY, as gazetted):
--   0            – 170,000     0%
--   170,000.01   – 1,570,000  30%
--   1,570,000.01 – 10,000,000 35%
--   10,000,000.01+             40%
--
-- LEDGR MODEL (ANNUAL bands — do not "fix")
--   Ledgr's payroll model (src/lib/paye.ts + PayrollPage) stores ANNUAL
--   bands: calculatePAYE(annualGross, bands) applies bands to gross*12 and
--   returns monthly tax. paye_bands.band_from/band_to are therefore ANNUAL
--   amounts. The rows below are the exact annual equivalents of the
--   gazetted monthly bands (monthly value x 12):
--     0            – 2,040,000      0%
--     2,040,000.01 – 18,840,000    30%
--     18,840,000.01 – 120,000,000  35%
--     120,000,000.01+               40%
--   Verified: 500,000/mo -> 99,000 PAYE; 2,000,000/mo -> 570,500;
--   12,000,000/mo -> 4,170,500 (see docs + tests/database/paye_reference.test.js).
--
-- SAFETY
--   • Deterministic, idempotent, no customer data.
--   • Inserts bands ONLY for (business, fiscal_year) pairs that have none —
--     customised bands are never overwritten or deleted.
--   • Effective date 2025-12-30 (statutory); fiscal_year 2026/27 (current
--     Ledgr fiscal year per src/lib/fiscalYear.ts).
-- ============================================================================

insert into public.paye_bands
  (business_id, band_from, band_to, band_label, rate, fiscal_year,
   effective_from, effective_to)
select
  b.id,
  v.band_from,
  v.band_to,
  v.band_label,
  v.rate,
  '2026/27',
  '2025-12-30'::date,
  null
from public.businesses b
cross join (values
  (0::numeric,            2040000::numeric,    '0%',  0::numeric),
  (2040000::numeric,      18840000::numeric,   '30%', 30::numeric),
  (18840000::numeric,     120000000::numeric,  '35%', 35::numeric),
  (120000000::numeric,     null,               '40%', 40::numeric)
) as v(band_from, band_to, band_label, rate)
where b.deleted_at is null
  and not exists (
    select 1
    from public.paye_bands p
    where p.business_id = b.id
      and p.fiscal_year = '2026/27'
  );

-- Sanity guard: no business may end up with MORE than the 4 statutory bands
-- for the year (i.e. the migration never duplicates). Businesses with 1-3
-- custom bands are intentionally preserved (partial custom configurations).
do $$
declare
  v_bad integer;
begin
  select count(*) into v_bad
  from public.businesses b
  where b.deleted_at is null
    and (
      select count(*)
      from public.paye_bands p
      where p.business_id = b.id and p.fiscal_year = '2026/27'
    ) > 4;
  if v_bad > 0 then
    raise exception 'PAYE reference-data migration produced more than 4 bands for % business(es)', v_bad;
  end if;
end
$$;
