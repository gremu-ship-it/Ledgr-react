-- Read-only construction migration evidence. Run on the affected project in
-- the SQL editor/psql, or via scripts/ci/remote-schema-forensics.sh. Each section
-- is one catalog SELECT; no application rows, DDL or migration-history writes.
-- The CI script sends the SAME queries with read_only=true to the Management API.
--
-- Compare against the COMPLETE 20261028000000_construction_projects.sql at the
-- deployed revision (and 20261028000001 if already applied on staging). A name
-- or matching columns alone do not prove ownership or complete equivalence.
-- Expected audit core: seven columns; UUID PK id DEFAULT gen_random_uuid();
-- project_id -> construction_projects(id) ON DELETE CASCADE; changed_by ->
-- auth.users(id) ON DELETE NO ACTION; both FKs validated/non-deferrable;
-- changed_at timestamptz NOT NULL DEFAULT now(). The file also creates indexes,
-- RLS/policies, SELECT-only browser grants, procurement FKs, triggers and RPCs.
-- Missing defaults, different FK targets/actions, extra policies/triggers,
-- attached dependencies and function return types all matter before rollout.
--
-- The @query markers and /* relations */ / /* versions */ arrays are consumed
-- by the CI runner. Defaults below are runnable unchanged in the SQL editor.
-- Some SQL editors display only the last result: run each @query section
-- separately. If you only see remote_head/recorded_versions, that is the final
-- summary, NOT the relation evidence. The standalone follow-up file
-- diagnose-project-status-log-dependencies.sql produces one result with full
-- coupled RPC definitions, dependencies, policies, triggers and incoming FKs.

-- @query relations
WITH requested(name) AS (
  SELECT unnest(/* relations */ ARRAY['projects', 'construction_projects', 'project_status_log', 'project_status_log_project', 'project_boq_lines', 'project_valuations', 'project_valuation_lines', 'project_retention_ledger'])
)
SELECT v.name,
       CASE WHEN c.oid IS NOT NULL THEN format('%I.%I', n.nspname, c.relname) END AS qualified_name,
       c.oid, c.relkind, c.relpersistence,
       pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
       c.reltuples AS estimated_rows, -- estimate only; -1 means not analyzed
       obj_description(c.oid, 'pg_class') AS comment,
       CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END AS view_definition,
       (SELECT json_agg(json_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid),
          'identity', a.attidentity, 'generated', a.attgenerated,
          'column_acl', a.attacl) ORDER BY a.attnum)
          FROM pg_attribute a
          LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
         WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
       (SELECT json_agg(json_build_object(
          'name', con.conname, 'kind', con.contype,
          'columns', ARRAY(SELECT a.attname FROM unnest(con.conkey) WITH ORDINALITY k(num, pos)
                           JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.num ORDER BY k.pos),
          'definition', pg_get_constraintdef(con.oid), 'validated', con.convalidated,
          'deferrable', con.condeferrable, 'initially_deferred', con.condeferred,
          'references', CASE WHEN target.oid IS NOT NULL THEN format('%I.%I', tn.nspname, target.relname) END,
          'referenced_columns', ARRAY(SELECT a.attname FROM unnest(con.confkey) WITH ORDINALITY k(num, pos)
                                      JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.num ORDER BY k.pos),
          'on_delete', con.confdeltype, 'on_update', con.confupdtype, 'match_type', con.confmatchtype)
          ORDER BY con.contype, con.conname)
          FROM pg_constraint con
          LEFT JOIN pg_class target ON target.oid = con.confrelid
          LEFT JOIN pg_namespace tn ON tn.oid = target.relnamespace
         WHERE con.conrelid = c.oid) AS constraints,
       (SELECT json_agg(json_build_object(
          'name', idx.relname, 'definition', pg_get_indexdef(ix.indexrelid),
          'valid', ix.indisvalid, 'ready', ix.indisready,
          'table', format('%I.%I', tn.nspname, t.relname)) ORDER BY idx.relname)
          FROM pg_index ix JOIN pg_class idx ON idx.oid = ix.indexrelid
          JOIN pg_class t ON t.oid = ix.indrelid JOIN pg_namespace tn ON tn.oid = t.relnamespace
         WHERE ix.indrelid = c.oid OR ix.indexrelid = c.oid) AS indexes,
       (SELECT json_agg(json_build_object(
          'name', pol.polname, 'command', pol.polcmd, 'permissive', pol.polpermissive,
          'roles', ARRAY(SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END FROM unnest(pol.polroles) r),
          'using', pg_get_expr(pol.polqual, pol.polrelid),
          'with_check', pg_get_expr(pol.polwithcheck, pol.polrelid)) ORDER BY pol.polname)
          FROM pg_policy pol WHERE pol.polrelid = c.oid) AS policies,
       (SELECT json_agg(json_build_object('name', t.tgname, 'enabled', t.tgenabled,
          'definition', pg_get_triggerdef(t.oid, true)) ORDER BY t.tgname)
          FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS triggers,
       (SELECT json_agg(json_build_object(
          'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee)::text END,
          'privilege', acl.privilege_type, 'grantable', acl.is_grantable))
          FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl) AS grants,
       (SELECT json_agg(json_build_object('type', dep.deptype,
          'object', pg_describe_object(dep.classid, dep.objid, dep.objsubid)))
          FROM pg_depend dep
         WHERE dep.refclassid = 'pg_class'::regclass AND dep.refobjid = c.oid) AS dependents,
       (SELECT json_agg(ext.extname) FROM pg_depend dep
          JOIN pg_extension ext ON ext.oid = dep.refobjid
         WHERE dep.classid = 'pg_class'::regclass AND dep.objid = c.oid
           AND dep.refclassid = 'pg_extension'::regclass AND dep.deptype = 'e') AS extensions,
       (SELECT json_agg(json_build_object(
          'table', format('%I.%I', sn.nspname, src.relname), 'definition', pg_get_constraintdef(fk.oid)))
          FROM pg_constraint fk JOIN pg_class src ON src.oid = fk.conrelid
          JOIN pg_namespace sn ON sn.oid = src.relnamespace
         WHERE fk.contype = 'f' AND fk.confrelid = c.oid) AS incoming_foreign_keys,
       (SELECT json_build_object('kind', typ.typtype, 'owner', pg_get_userbyid(typ.typowner), 'oid', typ.oid)
          FROM pg_type typ WHERE typ.oid = to_regtype(format('public.%I', v.name))) AS same_named_type
  FROM requested v
  LEFT JOIN pg_class c ON c.oid = to_regclass(format('public.%I', v.name))
  LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
 ORDER BY v.name;

-- @query functions
SELECT format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) AS signature,
       pg_get_userbyid(p.proowner) AS owner,
       pg_get_function_result(p.oid) AS returns,
       p.prosecdef AS security_definer, p.proconfig AS settings,
       p.proacl AS acl, md5(pg_get_functiondef(p.oid)) AS definition_md5,
       position('public.projects' IN pg_get_functiondef(p.oid)) > 0 AS mentions_legacy_projects
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prokind = 'f'
   AND (p.prorettype IN (SELECT to_regtype(format('public.%I', name))
                          FROM unnest(/* relations */ ARRAY['projects', 'construction_projects', 'project_status_log', 'project_status_log_project', 'project_boq_lines', 'project_valuations', 'project_valuation_lines', 'project_retention_ledger']) name)
        OR p.proname = ANY(ARRAY[
          '_ledgr_project_next_status','create_project','update_project','transition_project_status',
          'link_site_to_project','unlink_site_from_project','get_project_cost_summary',
          '_ledgr_project_procurement_tag','create_project_purchase_order','issue_project_materials',
          'return_project_materials','_ledgr_project_location_guard']))
 ORDER BY 1;

-- @query history
SELECT version, name
  FROM supabase_migrations.schema_migrations
 WHERE version = ANY(/* versions */ ARRAY[
   '20261028000000','20261028000001','20261029000000','20261030000000','20261031000000',
   '20261031000001','20261101000000','20261102000000','20261103000000'])
 ORDER BY version;

-- @query head
SELECT max(version) AS remote_head, count(*) AS recorded_versions
  FROM supabase_migrations.schema_migrations;
