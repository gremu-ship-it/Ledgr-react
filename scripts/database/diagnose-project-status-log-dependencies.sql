-- Standalone SQL-editor follow-up: ONE read-only statement / ONE result row.
-- Open a new empty query tab and run this file alone. It intentionally has no
-- trailing history summary that could hide the dependency result in the editor.
-- Catalog definitions only; no application rows, DDL or history writes.
-- Functions are filtered before pg_get_functiondef to exclude aggregates.
-- Review function definitions for embedded secrets before sharing externally.
-- A matching report is evidence to review, NOT authorization to rename objects.

WITH targets AS (
  SELECT c.oid, c.reltype,
         format('%I.%I', n.nspname, c.relname) AS qualified_name,
         c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity,
         pg_get_userbyid(c.relowner) AS owner, c.relacl AS grants,
         (SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'acl', a.attacl)
                          ORDER BY a.attnum)
          FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS column_acls
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid IN (to_regclass('public.projects'),
                  to_regclass('public.construction_projects'),
                  to_regclass('public.project_status_log'),
                  to_regclass('public.project_boq_lines'),
                  to_regclass('public.project_valuations'),
                  to_regclass('public.project_valuation_lines'),
                  to_regclass('public.project_retention_ledger'))
), functions AS MATERIALIZED (
  SELECT p.oid, p.proname,
         format('%I.%I(%s)', n.nspname, p.proname,
                pg_get_function_identity_arguments(p.oid)) AS signature,
         pg_get_userbyid(p.proowner) AS owner,
         pg_get_function_result(p.oid) AS returns, p.prorettype AS return_type_oid,
         p.prosecdef AS security_definer, p.proconfig AS settings,
         p.proacl AS grants, pg_get_functiondef(p.oid) AS definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f'
)
SELECT 'LEDGR_DEPENDENCY_CHECK_V1' AS diagnostic,
  jsonb_build_object(
    'objects', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.qualified_name), '[]'::jsonb) FROM targets t),
    'functions', (SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.signature), '[]'::jsonb)
      FROM functions f
      WHERE f.definition ~* '\m(projects|construction_projects|project_status_log|lifecycle_state)\M'
         OR f.proname IN ('_ledgr_project_next_status', 'create_project',
              'update_project', 'transition_project_status')),
    'dependencies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'target', pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid),
      'object', pg_describe_object(d.classid, d.objid, d.objsubid),
      'kind', d.deptype)), '[]'::jsonb)
      FROM pg_depend d
      WHERE (d.refclassid = 'pg_class'::regclass AND d.refobjid IN (SELECT oid FROM targets))
         OR (d.refclassid = 'pg_type'::regclass AND d.refobjid IN (SELECT reltype FROM targets))),
    'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', (SELECT qualified_name FROM targets WHERE oid = p.polrelid), 'name', p.polname,
      'command', p.polcmd, 'permissive', p.polpermissive,
      'roles', ARRAY(SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END FROM unnest(p.polroles) r),
      'using', pg_get_expr(p.polqual, p.polrelid),
      'with_check', pg_get_expr(p.polwithcheck, p.polrelid))), '[]'::jsonb)
      FROM pg_policy p WHERE p.polrelid IN (SELECT oid FROM targets)),
    'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', (SELECT qualified_name FROM targets WHERE oid = t.tgrelid), 'enabled', t.tgenabled,
      'definition', pg_get_triggerdef(t.oid, true))), '[]'::jsonb)
      FROM pg_trigger t WHERE t.tgrelid IN (SELECT oid FROM targets) AND NOT t.tgisinternal),
    'incoming_foreign_keys', (SELECT coalesce(jsonb_agg(jsonb_build_object(
      'table', (SELECT format('%I.%I', n.nspname, c.relname) FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = k.conrelid),
      'target', (SELECT qualified_name FROM targets WHERE oid = k.confrelid), 'name', k.conname,
      'definition', pg_get_constraintdef(k.oid), 'validated', k.convalidated)), '[]'::jsonb)
      FROM pg_constraint k WHERE k.contype = 'f' AND k.confrelid IN (SELECT oid FROM targets))
  ) AS evidence;
