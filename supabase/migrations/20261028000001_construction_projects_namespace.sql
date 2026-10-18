-- Forward-only namespace repair for construction projects.
--
-- Staging may already have applied the original Phase A migration, which used
-- public.projects. The reported production error suggests that name may also
-- belong to an unrelated legacy relation; verify the remote schema before
-- rollout. The feature now uses public.construction_projects. Rename
-- the old table only when its core columns and constraint definitions prove
-- that it is the Phase A construction table; never rename/drop an unrelated
-- legacy object. An unrelated relation is preserved and the feature table is
-- created alongside it (with a WARNING), instead of aborting the whole push:
-- the previous exact-signature guard raised SQLSTATE 55000 on genuine but
-- evolved Phase A tables and on legacy collisions alike, and because this
-- migration sits mid-chain, that one failure blocked every later migration.
-- PostgreSQL keeps dependencies (FKs, policies and indexes) attached to the
-- table OID across a table rename. PL/pgSQL source bodies are text, however, so
-- the project's known RPCs are rewritten below after the rename.

DO $rename_phase_a_projects$
DECLARE
 v_projects_oid oid := to_regclass('public.projects');
 v_is_construction_projects boolean := false;
BEGIN
 IF to_regclass('public.construction_projects') IS NULL AND v_projects_oid IS NOT NULL THEN
  -- Core Phase A identity, matched by definition rather than by object
    -- names or exact object counts. Constraint names and totals are not
    -- identity: a table created while it was called construction_projects
    -- keeps construction_projects_* constraint names after a rename, and a
    -- staging table may already carry later evolution (for example the
    -- boq_locked_at column, applied out of order) or an extra guard check.
    -- Requiring the exact 13 columns / 9 constraints / projects_* names
    -- therefore rejected genuine Phase A tables with SQLSTATE 55000 and
    -- blocked every later migration. Extra columns and constraints are
    -- allowed; the 13 core columns, the primary key on id, the two foreign
    -- keys and the lifecycle status vocabulary must all match by
    -- definition, which an unrelated legacy relation cannot satisfy.
    SELECT c.relkind IN ('r','p')
    AND NOT EXISTS (
      SELECT 1
        FROM (VALUES
          ('id', 'uuid', true),
          ('business_id', 'uuid', true),
          ('name', 'text', true),
          ('client_name', 'text', true),
          ('contract_sum', 'numeric(18,2)', true),
          ('retention_pct', 'numeric(5,2)', true),
          ('budget', 'numeric(18,2)', true),
          ('status', 'text', true),
          ('start_date', 'date', false),
          ('end_date', 'date', false),
          ('created_by', 'uuid', true),
          ('created_at', 'timestamp with time zone', true),
          ('updated_at', 'timestamp with time zone', true)
        ) AS expected(column_name, type_name, is_not_null)
        LEFT JOIN pg_attribute a
          ON a.attrelid = c.oid
         AND a.attname = expected.column_name
         AND a.attnum > 0
         AND NOT a.attisdropped
       WHERE a.attname IS NULL
          OR format_type(a.atttypid, a.atttypmod) <> expected.type_name
          OR a.attnotnull IS DISTINCT FROM expected.is_not_null
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = c.oid AND contype = 'p'
         AND conkey = ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = c.oid AND attname = 'id'
         )]
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint fk
       WHERE fk.conrelid = c.oid AND fk.contype = 'f'
         AND fk.conkey = ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = c.oid AND attname = 'business_id'
         )]
         AND fk.confrelid = 'public.businesses'::regclass
         AND fk.confkey = ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = 'public.businesses'::regclass AND attname = 'id'
         )]
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint fk
       WHERE fk.conrelid = c.oid AND fk.contype = 'f'
         AND fk.conkey = ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = c.oid AND attname = 'created_by'
         )]
         AND fk.confrelid = 'auth.users'::regclass
         AND fk.confkey = ARRAY[(
           SELECT attnum FROM pg_attribute
            WHERE attrelid = 'auth.users'::regclass AND attname = 'id'
         )]
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conrelid = c.oid AND contype = 'c'
         AND pg_get_constraintdef(oid) LIKE '%tender%'
         AND pg_get_constraintdef(oid) LIKE '%practical_completion%'
         AND pg_get_constraintdef(oid) LIKE '%defect_liability%'
    )
   INTO v_is_construction_projects
    FROM pg_class c
   WHERE c.oid = v_projects_oid;

  IF v_is_construction_projects THEN
   ALTER TABLE public.projects RENAME TO construction_projects;
  ELSE
   -- Not the Phase A table: an unrelated legacy relation owns the generic
   -- name (the state the original 55000 guard aborted on, which blocked
   -- every later migration behind this one). Preserve it untouched and let
   -- the CREATE TABLE IF NOT EXISTS statements below give the construction
   -- feature its own relation, exactly as the Phase A migration does when
   -- it meets the same collision. The old table is never renamed, dropped
   -- or modified, so this remains recoverable: if it did hold construction
   -- rows, reconcile them manually after the push (database-operations §11).
   RAISE WARNING
     'Preserving public.projects: it is not the Phase A construction table, so public.construction_projects is created alongside it. Reconcile any construction rows held in public.projects manually.';
  END IF;
 END IF;
END
$rename_phase_a_projects$;

-- Give the feature its physical tables whenever they are still missing:
-- after a rename this is a no-op (the tables exist under the new name);
-- after preserving an unrelated public.projects it creates the Phase A
-- tables fresh, so the policies, grants and later BOQ / valuation /
-- reporting migrations have the relations they expect. The definitions
-- are identical to the Phase A migration.
CREATE TABLE IF NOT EXISTS public.construction_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(btrim(name)) > 0),
 client_name text NOT NULL DEFAULT '',
 contract_sum decimal(18,2) NOT NULL DEFAULT 0 CHECK (contract_sum >= 0 AND contract_sum <> 'NaN'::numeric),
 retention_pct decimal(5,2) NOT NULL DEFAULT 0 CHECK (retention_pct BETWEEN 0 AND 100),
 budget decimal(18,2) NOT NULL DEFAULT 0 CHECK (budget >= 0 AND budget <> 'NaN'::numeric),
 status text NOT NULL DEFAULT 'tender' CHECK (status IN ('tender','active','practical_completion','defect_liability','closed')),
 start_date date, end_date date,
 created_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (start_date IS NULL OR end_date IS NULL OR start_date <= end_date)
);
-- IF NOT EXISTS is not a schema/ownership check. Refuse an incompatible audit
-- relation before attaching indexes, policies, grants or RPC writes to it.
-- Match definitions, not constraint names; missing/wrong FKs and defaults are
-- NOT repaired automatically. Review live ownership/dependencies separately
-- with scripts/database/diagnose-project-status-log.sql before rollout.
-- This source correction affects pending replays only (recorded versions are
-- skipped by db push). The same guard is in the namespace forward migration.
DO $confirm_project_status_log$
DECLARE
 v_log oid := to_regclass('public.project_status_log');
 v_shape text;
 v_matches boolean;
BEGIN
 IF v_log IS NULL THEN
  RETURN; -- the name is free: CREATE TABLE below declares it.
 END IF;

 SELECT c.relkind IN ('r','p') AND c.relpersistence = 'p'
   AND NOT EXISTS (
     SELECT 1
       FROM (VALUES
         ('id', 'uuid', true, 'gen_random_uuid()'),
         ('project_id', 'uuid', true, NULL),
         ('from_status', 'text', true, NULL),
         ('to_status', 'text', true, NULL),
         ('changed_by', 'uuid', true, NULL),
         ('reason', 'text', false, NULL),
         ('changed_at', 'timestamp with time zone', true, 'now()')
       ) AS expected(column_name, type_name, is_not_null, default_expr)
       LEFT JOIN pg_attribute a
         ON a.attrelid = c.oid AND a.attname = expected.column_name
        AND a.attnum > 0 AND NOT a.attisdropped
       LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attname IS NULL
         OR format_type(a.atttypid, a.atttypmod) <> expected.type_name
         OR a.attnotnull IS DISTINCT FROM expected.is_not_null
         OR a.attgenerated <> '' OR a.attidentity <> ''
         OR regexp_replace(pg_get_expr(d.adbin, d.adrelid),
              '(pg_catalog|public|extensions)\.', '', 'g')
              IS DISTINCT FROM expected.default_expr
   )
   AND EXISTS (
     SELECT 1 FROM pg_constraint pk
      WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND NOT pk.condeferrable
        AND pk.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = c.oid AND attname = 'id')]
   )
   AND NOT EXISTS (
     SELECT 1
       FROM (VALUES
         ('project_id', 'public.construction_projects'::regclass, 'c'),
         ('changed_by', 'auth.users'::regclass, 'a')
       ) AS expected(column_name, target, delete_action)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint fk
         WHERE fk.conrelid = c.oid AND fk.contype = 'f'
           AND fk.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                  WHERE attrelid = c.oid AND attname = expected.column_name)]
           AND fk.confrelid = expected.target
           AND fk.confkey = ARRAY[(SELECT attnum FROM pg_attribute
                                   WHERE attrelid = expected.target AND attname = 'id')]
           AND fk.confdeltype::text = expected.delete_action
           AND fk.confupdtype = 'a' AND fk.confmatchtype = 's'
           AND fk.convalidated AND NOT fk.condeferrable
      )
   )
   AND (SELECT count(*) FROM pg_constraint fk
         WHERE fk.conrelid = c.oid AND fk.contype = 'f'
           AND fk.conkey && ARRAY[(SELECT attnum FROM pg_attribute
                                   WHERE attrelid = c.oid AND attname = 'project_id'),
                                 (SELECT attnum FROM pg_attribute
                                   WHERE attrelid = c.oid AND attname = 'changed_by')]) = 2
   -- Extra required columns without defaults would break the audit INSERT.
   AND NOT EXISTS (
     SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        AND a.attname NOT IN ('id','project_id','from_status','to_status','changed_by','reason','changed_at')
        AND a.attnotnull AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = ''
   )
  INTO v_matches FROM pg_class c WHERE c.oid = v_log;

 IF v_matches IS DISTINCT FROM true THEN
  SELECT format('owner=%s; relkind=%s; columns=%s', pg_get_userbyid(c.relowner), c.relkind,
          (SELECT string_agg(format('%I %s%s', a.attname, format_type(a.atttypid, a.atttypmod),
                    CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END), ', ' ORDER BY a.attnum)
             FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped))
    INTO v_shape FROM pg_class c WHERE c.oid = v_log;
  RAISE EXCEPTION 'Construction audit schema mismatch: public.project_status_log does not match the Phase A columns, defaults, primary key and foreign keys.'
    USING ERRCODE = '55000', DETAIL = v_shape,
          HINT = 'Audit relation left untouched. Inspect ownership, constraints and dependencies with scripts/database/diagnose-project-status-log.sql (read-only). Do not drop, rename, re-point or mark the migration applied to bypass this check. See docs/database/database-operations.md section 13.';
 END IF;
END
$confirm_project_status_log$;
CREATE TABLE IF NOT EXISTS public.project_status_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
 from_status text NOT NULL, to_status text NOT NULL,
 changed_by uuid NOT NULL REFERENCES auth.users(id), reason text,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_status_log_project ON public.project_status_log(project_id,changed_at);

DO $verify_construction_projects$
BEGIN
 IF to_regclass('public.construction_projects') IS NULL THEN
  RAISE EXCEPTION 'public.construction_projects is missing after the Phase A migration.'
    USING ERRCODE = '42P01';
 END IF;
END
$verify_construction_projects$;

-- Keep the existing indexes (and avoid duplicate indexes on a renamed staging
-- table) while giving fresh installs relation-specific index names.
DO $rename_project_indexes$
DECLARE v_index record;
BEGIN
 FOR v_index IN
   SELECT names.old_name, names.new_name
     FROM (VALUES
       ('projects_business_status', 'construction_projects_business_status'),
       ('projects_business', 'construction_projects_business')
     ) AS names(old_name, new_name)
    WHERE EXISTS (
      SELECT 1
        FROM pg_class idx
        JOIN pg_index ix ON ix.indexrelid = idx.oid
       WHERE idx.oid = to_regclass('public.' || names.old_name)
         AND ix.indrelid = to_regclass('public.construction_projects')
    )
      AND to_regclass('public.' || names.new_name) IS NULL
 LOOP
   EXECUTE format('ALTER INDEX public.%I RENAME TO %I', v_index.old_name, v_index.new_name);
 END LOOP;
END
$rename_project_indexes$;
CREATE INDEX IF NOT EXISTS construction_projects_business_status ON public.construction_projects(business_id,status);
CREATE INDEX IF NOT EXISTS construction_projects_business ON public.construction_projects(business_id);

-- Rewrite only functions owned by the construction-project feature, including
-- BOQ/valuation/reporting RPCs that may already exist on staging. Their function
-- OIDs and grants are preserved by CREATE OR REPLACE; unrelated functions that
-- happen to mention public.projects are deliberately not touched.
DO $rewrite_project_rpc_bodies$
DECLARE
 v_function record;
 v_definition text;
 v_feature_function_names text[] := ARRAY[
   '_ledgr_project_next_status', 'create_project', 'update_project',
   'transition_project_status', 'link_site_to_project', 'unlink_site_from_project',
   'get_project_cost_summary', '_ledgr_project_procurement_tag',
   'create_project_purchase_order', 'issue_project_materials',
   'return_project_materials', '_ledgr_project_location_guard',
   'create_boq_line', 'update_boq_line', 'delete_boq_line', 'reorder_boq_lines',
   'bulk_upsert_boq_lines', 'get_boq_summary',
   '_ledgr_project_valuation_actor', '_ledgr_rebuild_project_valuation_lines',
   '_ledgr_project_valuation_payload', 'create_valuation', 'update_valuation',
   'submit_valuation', '_ledgr_construction_billing_contact',
   'generate_invoice_from_valuation', 'release_retention',
   'get_valuation_history', 'get_retention_summary', 'get_project_pnl',
   'get_portfolio_summary', 'get_project_valuation_trend', 'get_valuation_trend',
   'get_retention_aging', 'get_dashboard_metrics', 'get_cost_breakdown_by_project'
 ];
BEGIN
 FOR v_function IN
   SELECT p.oid, p.oid::regprocedure AS signature
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname = ANY (v_feature_function_names)
 LOOP
  v_definition := pg_get_functiondef(v_function.oid);
  IF position('public.projects' IN v_definition) > 0 THEN
   EXECUTE replace(v_definition, 'public.projects', 'public.construction_projects');
  END IF;
 END LOOP;

 FOR v_function IN
   SELECT p.oid, p.oid::regprocedure AS signature
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname = ANY (v_feature_function_names)
      AND position('public.projects' IN pg_get_functiondef(p.oid)) > 0
 LOOP
  RAISE EXCEPTION 'Construction project RPC % still references the legacy public.projects relation.', v_function.signature;
 END LOOP;
END
$rewrite_project_rpc_bodies$;

ALTER TABLE public.construction_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_member_grants ON public.construction_projects;
CREATE POLICY projects_member_grants ON public.construction_projects FOR ALL TO authenticated
 USING (public.is_business_member(business_id) AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
 WITH CHECK (public.is_business_member(business_id) AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS project_log_member_grants ON public.project_status_log;
CREATE POLICY project_log_member_grants ON public.project_status_log FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.construction_projects p WHERE p.id = project_id))
 WITH CHECK (EXISTS (SELECT 1 FROM public.construction_projects p WHERE p.id = project_id));
REVOKE ALL ON public.construction_projects, public.project_status_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.construction_projects, public.project_status_log TO authenticated;

-- On clean/staging schemas where the old name is free, keep a read-only,
-- security-invoker compatibility view for clients released before this
-- namespace repair. If production has a legacy public.projects relation, it is
-- left untouched and no view is created; new application code uses the new
-- physical table name everywhere.
DO $legacy_projects_compatibility_view$
BEGIN
 IF to_regclass('public.projects') IS NULL AND to_regtype('public.projects') IS NULL THEN
  EXECUTE 'CREATE VIEW public.projects WITH (security_invoker = true) AS SELECT * FROM public.construction_projects';
  EXECUTE 'REVOKE ALL ON public.projects FROM PUBLIC, anon, authenticated';
  EXECUTE 'GRANT SELECT ON public.projects TO authenticated';
  EXECUTE 'COMMENT ON VIEW public.projects IS ''Ledgr construction projects compatibility view''';
 END IF;
END
$legacy_projects_compatibility_view$;
