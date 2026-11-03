-- ============================================================================
-- Read-only diagnosis for the construction-projects namespace failure
-- (SQLSTATE 55000: "public.projects is not the known Phase A table").
--
-- Run against the AFFECTED project only (staging first; never guess at
-- production) in the Supabase SQL editor or with psql. Every statement is a
-- SELECT: nothing here renames, drops, repairs or marks anything applied.
--
-- How to read the results (docs/database/database-operations.md section 11):
--   * construction_projects exists as a table -> the namespace repair has
--     already run; check the migration history instead of the schema.
--   * projects is a table whose columns/constraints match the Phase A core
--     (13 core columns, PK on id, FKs business_id -> businesses and
--     created_by -> auth.users, status lifecycle check) -> it IS the Phase A
--     table, possibly evolved (extra column/constraint, renamed
--     constraints). Current migrations adopt it by definition and rename it.
--   * projects is anything else -> unrelated legacy relation. Current
--     migrations preserve it untouched and create
--     public.construction_projects alongside it (a WARNING is logged).
--   * schema_migrations lists 20261028000000 but neither table shape exists
--     -> the version was recorded without its schema (e.g. a manual
--     `migration repair --status applied`). Reconcile the history manually;
--     do not mark further versions applied to work around it.
-- ============================================================================

-- 1. What owns each name right now? (relkind: r = table, p = partitioned
--    table, v = view, m = materialized view; null = name is free)
SELECT 'public.projects' AS relation,
       (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.projects')) AS relkind
UNION ALL
SELECT 'public.construction_projects',
       (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.construction_projects'))
UNION ALL
SELECT 'public.project_status_log',
       (SELECT relkind FROM pg_class WHERE oid = to_regclass('public.project_status_log'));

-- 2. Columns of both candidate tables (compare with the Phase A core:
--    id, business_id, name, client_name, contract_sum, retention_pct,
--    budget, status, start_date, end_date, created_by, created_at,
--    updated_at; extra columns such as boq_locked_at are evolution, not
--    a different table).
SELECT table_name, ordinal_position, column_name, data_type,
       udt_name, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('projects', 'construction_projects')
 ORDER BY table_name, ordinal_position;

-- 3. Constraint definitions on both candidate tables (definitions, not
--    names, are the Phase A identity: PK on id, the two FKs above, and a
--    status check over tender/active/practical_completion/
--    defect_liability/closed).
SELECT conrelid::regclass AS table_name, conname, contype,
       pg_get_constraintdef(oid) AS definition
  FROM pg_constraint
 WHERE conrelid IN (to_regclass('public.projects'),
                    to_regclass('public.construction_projects'))
 ORDER BY table_name, contype, conname;

-- 4. Row counts: does the preserved/adopted table hold data that must be
--    reconciled by hand after the push? (Run only the line whose table
--    exists, per query 1.)
-- SELECT count(*) FROM public.projects;
-- SELECT count(*) FROM public.construction_projects;

-- 5. Migration history around the construction chain.
SELECT version, name
  FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261028000000', '20261028000001', '20261030000000',
                   '20261031000001', '20261101000000')
 ORDER BY version;
