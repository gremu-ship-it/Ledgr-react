-- Forward-only namespace repair for construction projects.
--
-- Staging may already have applied the original Phase A migration, which used
-- public.projects. The reported production error suggests that name may also
-- belong to an unrelated legacy relation; verify the remote schema before
-- rollout. The feature now uses public.construction_projects. Rename
-- the old table only when its columns and named constraints prove that it is
-- the Phase A construction table; never rename/drop an unrelated legacy object.
-- PostgreSQL keeps dependencies (FKs, policies and indexes) attached to the
-- table OID across a table rename. PL/pgSQL source bodies are text, however, so
-- the project's known RPCs are rewritten below after the rename.

DO $rename_phase_a_projects$
DECLARE
 v_projects_oid oid := to_regclass('public.projects');
 v_is_construction_projects boolean := false;
BEGIN
 IF to_regclass('public.construction_projects') IS NULL AND v_projects_oid IS NOT NULL THEN
  SELECT c.relkind IN ('r','p')
     AND (
       SELECT count(*) FROM pg_attribute
        WHERE attrelid = c.oid AND attnum > 0 AND NOT attisdropped
     ) = 13
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
        WHERE conrelid = c.oid AND contype = 'p' AND conname = 'projects_pkey'
     )
     AND EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = c.oid AND contype = 'f'
          AND conname = 'projects_business_id_fkey'
          AND confrelid = 'public.businesses'::regclass
     )
     AND EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = c.oid AND contype = 'f'
          AND conname = 'projects_created_by_fkey'
          AND confrelid = 'auth.users'::regclass
     )
     AND (
       SELECT count(*) FROM pg_constraint
        WHERE conrelid = c.oid AND contype = 'c'
          AND conname = ANY (ARRAY[
            'projects_name_check', 'projects_contract_sum_check',
            'projects_retention_pct_check', 'projects_budget_check',
            'projects_status_check', 'projects_check'
          ])
      ) = 6
     AND (SELECT count(*) FROM pg_constraint WHERE conrelid = c.oid) = 9
    INTO v_is_construction_projects
    FROM pg_class c
   WHERE c.oid = v_projects_oid;

  IF v_is_construction_projects THEN
   ALTER TABLE public.projects RENAME TO construction_projects;
  ELSIF to_regclass('public.construction_projects') IS NULL THEN
   RAISE EXCEPTION
     'Cannot namespace construction projects: public.projects is not the known Phase A table. Preserve it and reconcile the migration state before retrying.'
     USING ERRCODE = '55000';
  END IF;
 END IF;

 IF to_regclass('public.construction_projects') IS NULL THEN
  RAISE EXCEPTION 'public.construction_projects is missing after the Phase A migration.'
    USING ERRCODE = '42P01';
 END IF;
END
$rename_phase_a_projects$;

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
