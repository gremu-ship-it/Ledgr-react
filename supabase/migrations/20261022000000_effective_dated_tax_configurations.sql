-- ============================================================================
-- Migration: effective-dated tax configurations (the VAT standard-rate schedule)
--
-- THE DEFECT THIS CLOSES
-- public.tax_configurations (base schema) carries effective_from / effective_to
-- but nothing keeps one business's periods of the same tax_code apart. Two rows
-- that both cover a date make the business's rate ambiguous, and every reader
-- goes through TaxRepository.findByCode → maybeSingle(): PostgREST turns an
-- ambiguous match into an error, so the caller loses its configured rate
-- instead of being told the stored schedule contradicts itself (TaxPage,
-- PayrollPage TPR rates, TaxReturnRepository.generateVatReturn).
--
-- The 16.5% → 17.5% change on 1 January 2026 is precisely the change that puts
-- two rows on one business, so the invariant has to exist before the schedule
-- is used:
--   * Value Added Tax Act Cap 42:02 (Act No. 7 of 2005), as amended in 2025 —
--     standard rate raised 16.5% → 17.5% effective 1 January 2026 (MRA
--     instruction to VAT-registered operators). Owner-resolved 2026-10-16;
--     recorded in docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md
--     §5 items 1 and 7.
--
-- WHAT THIS MIGRATION DOES — AND WHAT IT DELIBERATELY DOES NOT DO
--   * No table, no column, no function, no RPC, no permission and no new
--     business rule. It constrains data the table already holds, using the
--     column the product already uses for the evidence of a rate
--     (mra_reference: 'VAT Act 2026' in the demo dataset, 'Pension Act 2011'
--     in 20260708000000_tax_compliance_module.sql).
--   * It writes NO row and seeds NO rate. The 16.5% period is not created:
--     nothing in this repository dates its start, so the product must not
--     invent one. Rates are the business's own configuration; the resolver
--     refuses to answer outside the supported schedule instead of guessing
--     (src/lib/tax/taxConfiguration.ts).
--
-- LEGACY DATA — a data-quality gate, not only DDL
--   * tax_configurations_no_overlap is a real constraint (no NOT VALID): an
--     existing overlap IS the ambiguity this migration removes, so it is not
--     grandfathered. Step 2 below lists every conflicting group and refuses
--     the migration rather than choosing which row is authoritative. Resolve
--     the listed groups (close a period, or delete the duplicate row), then
--     re-run: nothing is written until the invariant can be stated.
--   * The three CHECK constraints are added NOT VALID, so rows created before
--     this migration are grandfathered while new and updated rows must comply.
--     After the owner has reviewed the legacy rows, validate them:
--       alter table public.tax_configurations validate constraint tax_configurations_period_chk;
--       alter table public.tax_configurations validate constraint tax_configurations_rate_chk;
--       alter table public.tax_configurations validate constraint tax_configurations_evidence_chk;
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Structural prerequisite: gist equality for uuid + tax_code.
--    Installed if absent; no existing extension is replaced.
-- ────────────────────────────────────────────────────────────────────────────
create extension if not exists btree_gist;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Refuse to guess. If the stored schedule already overlaps, name every
--    conflicting (business, tax_code) group and stop here — the migration is
--    transactional, so nothing above this point survives a failure.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_conflicts text;
begin
  select string_agg(line, E'\n  ')
  into v_conflicts
  from (
    select distinct format('%s  %s  (%s stored periods, %s to %s)',
             a.business_id::text, a.tax_code::text, g.n::text,
             g.first_from::text, coalesce(g.last_to::text, 'open-ended')) as line
    from public.tax_configurations a
    join public.tax_configurations b
      on b.business_id = a.business_id
     and b.tax_code = a.tax_code
     and b.id > a.id
     and daterange(b.effective_from, b.effective_to) && daterange(a.effective_from, a.effective_to)
    join lateral (
      select count(*)::int as n,
             min(x.effective_from) as first_from,
             max(x.effective_to) as last_to
      from public.tax_configurations x
      where x.business_id = a.business_id
        and x.tax_code = a.tax_code
    ) g on true
  ) s;

  if v_conflicts is not null then
    raise exception
      'tax_configurations holds overlapping periods, so no single rate can be resolved for those dates. Close the earlier period (set effective_to to the day before the successor starts) or delete the duplicate row, then re-run:%',
      E'\n  ' || v_conflicts
      using errcode = '23514';
  end if;
end
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. The invariant: one business cannot have two periods of the same tax_code
--    covering the same day. Half-open ranges [effective_from, effective_to), so
--    31 Dec 2025 → 2025-12-31 and 1 Jan 2026 → 2026-01-01 touch without
--    overlapping, while an open-ended row (effective_to is null) covers
--    everything from its start onwards — a successor must therefore close it
--    first. This mirrors src/lib/tax/taxConfiguration.ts, which resolves the
--    rate for a date from exactly these ranges.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.tax_configurations drop constraint if exists tax_configurations_no_overlap;
alter table public.tax_configurations
  add constraint tax_configurations_no_overlap
  exclude using gist (
    business_id with =,
    tax_code with =,
    daterange(effective_from, effective_to) with &&
  );

comment on constraint tax_configurations_no_overlap on public.tax_configurations is
  'A business may hold at most one period per tax_code covering any given date. Periods are half-open: [effective_from, effective_to). An open effective_to means "until superseded", so a successor period cannot be added until the open period is closed.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Row-level checks (NOT VALID: existing rows are grandfathered).
--    a) a period ends after it starts — a zero-length period can never apply;
--    b) rates are percentages in [0, 100] (the stored convention: 17.5, 10, 20,
--       and expense_lines.tax_rate / the UI both use percent, not fraction);
--    c) a row that charges a non-zero rate records the reference it relies on.
--       Zero-rated, exempt and 'none' rows are not asked for one.
--    NOT VALID still enforces every new and updated row: a legacy row with a
--    non-zero rate and no reference must gain one the next time it is edited.
-- ────────────────────────────────────────────────────────────────────────────
alter table public.tax_configurations drop constraint if exists tax_configurations_period_chk;
alter table public.tax_configurations
  add constraint tax_configurations_period_chk
  check (effective_to is null or effective_to > effective_from) not valid;

alter table public.tax_configurations drop constraint if exists tax_configurations_rate_chk;
alter table public.tax_configurations
  add constraint tax_configurations_rate_chk
  check (
    rate >= 0 and rate <= 100
    and (employer_rate is null or (employer_rate >= 0 and employer_rate <= 100))
    and (employee_rate is null or (employee_rate >= 0 and employee_rate <= 100))
  ) not valid;

alter table public.tax_configurations drop constraint if exists tax_configurations_evidence_chk;
alter table public.tax_configurations
  add constraint tax_configurations_evidence_chk
  check (
    greatest(rate, coalesce(employer_rate, 0), coalesce(employee_rate, 0)) = 0
    or nullif(btrim(coalesce(mra_reference, '')), '') is not null
  ) not valid;

comment on constraint tax_configurations_evidence_chk on public.tax_configurations is
  'Any tax configuration that charges a non-zero rate must record the reference it relies on in mra_reference (the statute, gazette notice or authority communication), so a rate can be traced to its evidence. Zero-rate rows are exempt.';

-- ────────────────────────────────────────────────────────────────────────────
-- 5. RLS verification for this table.
--    The policies come from 20260815000003_phase8b_rls_policies.sql; this block
--    fails the migration if the state for tax_configurations does not match it
--    (per-business read, writer insert/update, admin delete, platform admin
--    read; anon with nothing). No policy is created, replaced or granted here.
--
--    Deliberately NOT asserted: the DML privileges of `authenticated`. The
--    migration chain only revokes this table from anon; it never grants it to
--    authenticated, so the deployed privilege depends on the project's default
--    privileges and cannot be established from the repository. This migration
--    must not create a permission to make its own assertion pass — the deployed
--    ACL is a deployment-readiness check (see the production-readiness
--    document, group B), not a migration step.
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_missing text;
  v_anon    int;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.tax_configurations'::regclass) then
    raise exception 'Row level security is not enabled on public.tax_configurations.';
  end if;

  select string_agg(expected.name, ', ')
  into v_missing
  from (values
    ('tax_configurations_member_read'),
    ('tax_configurations_writer_insert'),
    ('tax_configurations_writer_update'),
    ('tax_configurations_admin_delete'),
    ('tax_configurations_platform_admin_read')
  ) as expected(name)
  where not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'tax_configurations'
      and p.policyname = expected.name
  );

  if v_missing is not null then
    raise exception 'Deployed RLS for public.tax_configurations is incomplete; missing policy: %', v_missing;
  end if;

  select count(*)::int into v_anon
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'tax_configurations'
    and grantee = 'anon';

  if v_anon <> 0 then
    raise exception 'anon holds % privileges on public.tax_configurations; business tax data must not be reachable unauthenticated.', v_anon;
  end if;
end
$$;
