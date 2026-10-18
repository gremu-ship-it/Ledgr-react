-- ============================================================================
-- Phase A: project dimension. Existing procurement commands, guards and grants
-- remain authoritative. No stock, accounting, BOQ or billing logic is added.
--
-- CONVERGENT RE-APPLY (2026-10-18)
-- --------------------------------
-- The production deploy of this file (Deploy #224, run 39118959766) died on its
-- FIRST statement:
--     ERROR: relation "projects" already exists (SQLSTATE 42P07)
-- Production's supabase_migrations.schema_migrations does not record version
-- 20261028000000 (the push listed this file as pending), yet public.projects
-- exists there: the Phase A objects reached that database OUTSIDE
-- `supabase db push`. A hand application — the Supabase SQL editor or psql —
-- commits every statement it manages to run and records no migration version,
-- so the objects are live while the history row is absent. Retrying cannot help;
-- all three attempts in that log reproduced the same collision byte for byte.
--
-- Every DDL statement below is therefore guarded, and the file CONVERGES on a
-- database that already carries its objects instead of assuming an empty one:
--   * CREATE TABLE / INDEX  -> IF NOT EXISTS
--   * CREATE POLICY         -> DROP POLICY IF EXISTS + CREATE POLICY
--   * CREATE FUNCTION       -> CREATE OR REPLACE FUNCTION
--   * CREATE TRIGGER        -> DROP TRIGGER IF EXISTS + CREATE TRIGGER
--   * ADD COLUMN            -> ADD COLUMN IF NOT EXISTS
--   * NOT NULL / DEFAULT / CHECK contracts are re-asserted additively below.
-- Nothing is dropped, no row is rewritten and no grant is widened, so applying
-- this file to a clean replay, to staging (where the version IS recorded, so
-- `db push` skips the file), or twice in a row is a no-op.
--
-- The guard under this comment refuses a pre-existing public.projects that is
-- NOT this migration's table (a legacy table from another application, say)
-- rather than letting IF NOT EXISTS silently adopt a foreign shape that the
-- RPCs, the FKs and the RLS policy would then trip over at runtime. See
-- DEPLOYMENT.md -> `relation "..." already exists (SQLSTATE 42P07)`.
-- ============================================================================

-- Conflict guard: if the tables already exist, they must already be THESE
-- tables. Missing or differently typed columns mean somebody else's object is
-- in the way, and that is an owner decision, not something a deploy may paper
-- over. Read-only: it inspects pg_attribute and raises, changing nothing.
DO $construction_projects_conflict_guard$
DECLARE
  v_spec      record;
  v_actual    text;
  v_conflict  text;
  v_conflicts text := NULL;
  v_live      text;
  v_rows      bigint;
BEGIN
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('projects',          'id',            'uuid'),
      ('projects',          'business_id',   'uuid'),
      ('projects',          'name',          'text'),
      ('projects',          'client_name',   'text'),
      ('projects',          'contract_sum',  'numeric(18,2)'),
      ('projects',          'retention_pct', 'numeric(5,2)'),
      ('projects',          'budget',        'numeric(18,2)'),
      ('projects',          'status',        'text'),
      ('projects',          'start_date',    'date'),
      ('projects',          'end_date',      'date'),
      ('projects',          'created_by',    'uuid'),
      ('projects',          'created_at',    'timestamp with time zone'),
      ('projects',          'updated_at',    'timestamp with time zone'),
      ('project_status_log','id',            'uuid'),
      ('project_status_log','project_id',    'uuid'),
      ('project_status_log','from_status',   'text'),
      ('project_status_log','to_status',     'text'),
      ('project_status_log','changed_by',    'uuid'),
      ('project_status_log','reason',        'text'),
      ('project_status_log','changed_at',    'timestamp with time zone')
    ) AS s(table_name, column_name, expected_type)
  LOOP
    -- A table that does not exist yet is built by the statements below.
    IF to_regclass('public.' || v_spec.table_name) IS NULL THEN CONTINUE; END IF;
    SELECT format_type(a.atttypid, a.atttypmod) INTO v_actual
      FROM pg_attribute a
     WHERE a.attrelid = ('public.' || v_spec.table_name)::regclass
       AND a.attname  = v_spec.column_name
       AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_actual IS NULL THEN
      v_conflict := format('public.%s.%s is MISSING', v_spec.table_name, v_spec.column_name);
    ELSIF v_actual <> v_spec.expected_type THEN
      v_conflict := format('public.%s.%s is %s, this migration declares %s',
                           v_spec.table_name, v_spec.column_name, v_actual, v_spec.expected_type);
    ELSE
      CONTINUE;
    END IF;
    v_conflicts := CASE WHEN v_conflicts IS NULL THEN v_conflict ELSE v_conflicts || ' | ' || v_conflict END;
  END LOOP;

  IF v_conflicts IS NULL THEN RETURN; END IF;

  -- Evidence for whoever has to decide: what IS there, and how much of it.
  IF to_regclass('public.projects') IS NOT NULL THEN
    SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum)
      INTO v_live
      FROM pg_attribute a
     WHERE a.attrelid = 'public.projects'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    EXECUTE 'SELECT count(*) FROM public.projects' INTO v_rows;
  END IF;

  RAISE EXCEPTION
    'public.projects is already taken by a DIFFERENT table, so this migration refuses to adopt it: %. Live public.projects columns: %. Rows: %. Nothing was changed. This is an owner decision, not a deploy retry: inspect the table, then either move it aside (ALTER TABLE public.projects RENAME TO legacy_projects_pre_construction; and repeat for its indexes/policies if they collide) or reconcile it to the declared shape, and re-run the deploy. See DEPLOYMENT.md -> relation "..." already exists (SQLSTATE 42P07).',
    v_conflicts, coalesce(v_live, '<none>'), coalesce(v_rows, 0)
    USING ERRCODE = '42P07';
END $construction_projects_conflict_guard$;

CREATE TABLE IF NOT EXISTS public.projects (
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
CREATE INDEX IF NOT EXISTS projects_business_status ON public.projects(business_id,status);
CREATE INDEX IF NOT EXISTS projects_business ON public.projects(business_id);
CREATE TABLE IF NOT EXISTS public.project_status_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 from_status text NOT NULL, to_status text NOT NULL,
 changed_by uuid NOT NULL REFERENCES auth.users(id), reason text,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_status_log_project ON public.project_status_log(project_id,changed_at);

-- Additive convergence for a database whose public.projects arrived by hand
-- (SQL editor / psql) instead of from this file: re-assert the declared DEFAULT
-- and NOT NULL contracts that create_project / transition_project_status rely
-- on. Each statement is a no-op on the shape declared above. SET NOT NULL
-- validates the rows already there rather than bypassing them, so a table that
-- cannot satisfy the contract fails here with the offending column named,
-- instead of failing later inside an RPC at 02:00 on a deploy nobody watches.
ALTER TABLE public.projects ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.projects ALTER COLUMN business_id SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN client_name SET DEFAULT '';
ALTER TABLE public.projects ALTER COLUMN client_name SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN contract_sum SET DEFAULT 0;
ALTER TABLE public.projects ALTER COLUMN contract_sum SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN retention_pct SET DEFAULT 0;
ALTER TABLE public.projects ALTER COLUMN retention_pct SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN budget SET DEFAULT 0;
ALTER TABLE public.projects ALTER COLUMN budget SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN status SET DEFAULT 'tender';
ALTER TABLE public.projects ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE public.projects ALTER COLUMN created_at SET NOT NULL;
ALTER TABLE public.projects ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.projects ALTER COLUMN updated_at SET NOT NULL;
ALTER TABLE public.project_status_log ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE public.project_status_log ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE public.project_status_log ALTER COLUMN from_status SET NOT NULL;
ALTER TABLE public.project_status_log ALTER COLUMN to_status SET NOT NULL;
ALTER TABLE public.project_status_log ALTER COLUMN changed_by SET NOT NULL;
ALTER TABLE public.project_status_log ALTER COLUMN changed_at SET DEFAULT now();
ALTER TABLE public.project_status_log ALTER COLUMN changed_at SET NOT NULL;

-- The declared CHECK contracts, matched on the column each one constrains
-- (PostgreSQL rewrites `status IN (...)` to `status = ANY (ARRAY[...])`, so
-- predicate text is not a stable probe). Added only when absent; a duplicate
-- under the declared name is tolerated because it means the contract is there.
DO $construction_projects_checks$
DECLARE
  v_spec record;
BEGIN
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('projects_name_check',          'length(btrim(name)) > 0',                                                                            '%btrim(name)%'),
      ('projects_contract_sum_check',  'contract_sum >= 0 AND contract_sum <> ''NaN''::numeric',                                              '%contract_sum%'),
      ('projects_retention_pct_check', 'retention_pct BETWEEN 0 AND 100',                                                                    '%retention_pct%'),
      ('projects_budget_check',        'budget >= 0 AND budget <> ''NaN''::numeric',                                                          '%budget%'),
      ('projects_status_check',        'status IN (''tender'',''active'',''practical_completion'',''defect_liability'',''closed'')',           '%status%'),
      ('projects_date_order_check',    'start_date IS NULL OR end_date IS NULL OR start_date <= end_date',                                    '%start_date%')
    ) AS s(constraint_name, predicate, probe)
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.projects'::regclass AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) LIKE v_spec.probe
    ) THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('ALTER TABLE public.projects ADD CONSTRAINT %I CHECK (%s)',
                     v_spec.constraint_name, v_spec.predicate);
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN
      NULL; -- the contract exists under the declared name already
    END;
  END LOOP;
END $construction_projects_checks$;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_status_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS projects_member_grants ON public.projects;
CREATE POLICY projects_member_grants ON public.projects FOR ALL TO authenticated
 USING (public.is_business_member(business_id) AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
 WITH CHECK (public.is_business_member(business_id) AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS project_log_member_grants ON public.project_status_log;
CREATE POLICY project_log_member_grants ON public.project_status_log FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id))
 WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id));
-- Like procurement, reads use RLS; writes are commands only. In particular,
-- clients cannot bypass the lifecycle or forge its append-only audit trail.
REVOKE ALL ON public.projects, public.project_status_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.projects, public.project_status_log TO authenticated;

ALTER TABLE public.construction_purchase_orders ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.construction_material_issues ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.construction_material_returns ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_locations ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS construction_po_project ON public.construction_purchase_orders(project_id);
CREATE INDEX IF NOT EXISTS construction_issue_project ON public.construction_material_issues(project_id);
CREATE INDEX IF NOT EXISTS construction_return_project ON public.construction_material_returns(project_id);
CREATE INDEX IF NOT EXISTS inventory_location_project ON public.inventory_locations(project_id);

CREATE OR REPLACE FUNCTION public._ledgr_project_next_status(p_status text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT CASE p_status WHEN 'tender' THEN 'active' WHEN 'active' THEN 'practical_completion'
 WHEN 'practical_completion' THEN 'defect_liability' WHEN 'defect_liability' THEN 'closed' END
$$;

CREATE OR REPLACE FUNCTION public.create_project(p_business_id uuid, p_name text, p_client_name text,
 p_contract_sum numeric, p_retention_pct numeric, p_budget numeric, p_start_date date, p_end_date date)
 RETURNS public.projects LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid; v_row public.projects;
BEGIN
 v_actor := public._ledgr_construction_actor(p_business_id,'procurement.master.manage');
 IF p_name IS NULL OR btrim(p_name) = '' OR p_client_name IS NULL OR btrim(p_client_name) = '' THEN
  RAISE EXCEPTION 'Project name and client name are required.' USING ERRCODE = '22023'; END IF;
 IF p_contract_sum IS NULL OR p_contract_sum = 'NaN'::numeric OR p_contract_sum < 0 OR p_budget IS NULL OR p_budget = 'NaN'::numeric OR p_budget < 0 OR p_retention_pct IS NULL OR p_retention_pct NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Contract sum and budget must be non-negative; retention must be between 0 and 100.' USING ERRCODE = '22023'; END IF;
 IF p_start_date > p_end_date THEN RAISE EXCEPTION 'End date must be on or after start date.' USING ERRCODE = '22023'; END IF;
 INSERT INTO public.projects(business_id,name,client_name,contract_sum,retention_pct,budget,start_date,end_date,created_by)
 VALUES(p_business_id,btrim(p_name),btrim(p_client_name),p_contract_sum,p_retention_pct,p_budget,p_start_date,p_end_date,v_actor) RETURNING * INTO v_row;
 RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.update_project(p_project_id uuid, p_name text, p_client_name text,
 p_contract_sum numeric, p_retention_pct numeric, p_budget numeric, p_start_date date, p_end_date date)
 RETURNS public.projects LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.projects;
BEGIN
 SELECT * INTO v_row FROM public.projects WHERE id = p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_row.business_id,'procurement.master.manage');
 IF p_name IS NULL OR btrim(p_name) = '' OR p_client_name IS NULL OR btrim(p_client_name) = '' THEN
  RAISE EXCEPTION 'Project name and client name are required.' USING ERRCODE = '22023'; END IF;
 IF p_contract_sum IS NULL OR p_contract_sum = 'NaN'::numeric OR p_contract_sum < 0 OR p_budget IS NULL OR p_budget = 'NaN'::numeric OR p_budget < 0 OR p_retention_pct IS NULL OR p_retention_pct NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Contract sum and budget must be non-negative; retention must be between 0 and 100.' USING ERRCODE = '22023'; END IF;
 IF p_start_date > p_end_date THEN RAISE EXCEPTION 'End date must be on or after start date.' USING ERRCODE = '22023'; END IF;
 UPDATE public.projects SET name=btrim(p_name),client_name=btrim(p_client_name),contract_sum=p_contract_sum,
 retention_pct=p_retention_pct,budget=p_budget,start_date=p_start_date,end_date=p_end_date,updated_at=now()
 WHERE id=p_project_id RETURNING * INTO v_row;
 RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.transition_project_status(p_project_id uuid,p_new_status text,p_reason text DEFAULT NULL)
 RETURNS public.projects LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.projects; v_actor uuid;
BEGIN
 SELECT * INTO v_row FROM public.projects WHERE id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002'; END IF;
 v_actor := public._ledgr_construction_actor(v_row.business_id,'procurement.master.manage');
 IF p_new_status IS NULL OR public._ledgr_project_next_status(v_row.status) IS DISTINCT FROM p_new_status THEN
  RAISE EXCEPTION 'Invalid status transition from % to %',v_row.status,p_new_status USING ERRCODE = '22023'; END IF;
 INSERT INTO public.project_status_log(project_id,from_status,to_status,changed_by,reason)
 VALUES(p_project_id,v_row.status,p_new_status,v_actor,nullif(btrim(p_reason),''));
 UPDATE public.projects SET status=p_new_status,updated_at=now() WHERE id=p_project_id RETURNING * INTO v_row;
 RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION public.link_site_to_project(p_location_id uuid,p_project_id uuid)
 RETURNS public.inventory_locations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_location public.inventory_locations; v_project public.projects;
BEGIN
 SELECT * INTO v_location FROM public.inventory_locations WHERE id=p_location_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inventory location not found.' USING ERRCODE = 'P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_location.business_id,'procurement.master.manage');
 IF NOT public.can_access_branch(v_location.business_id,v_location.branch_id) THEN
  RAISE EXCEPTION 'You do not have access to that branch.' USING ERRCODE = '42501'; END IF;
 SELECT * INTO v_project FROM public.projects WHERE id=p_project_id;
 IF NOT FOUND OR v_project.business_id <> v_location.business_id THEN
  RAISE EXCEPTION 'Location and project must belong to the same business.' USING ERRCODE = '22023'; END IF;
 IF v_location.project_id IS NOT NULL AND v_location.project_id <> p_project_id THEN
  RAISE EXCEPTION 'Unlink the location from its current project first.' USING ERRCODE = '22023'; END IF;
 UPDATE public.inventory_locations SET project_id=p_project_id WHERE id=p_location_id RETURNING * INTO v_location;
 RETURN v_location;
END $$;
CREATE OR REPLACE FUNCTION public.unlink_site_from_project(p_location_id uuid)
 RETURNS public.inventory_locations LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_location public.inventory_locations;
BEGIN
 SELECT * INTO v_location FROM public.inventory_locations WHERE id=p_location_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Inventory location not found.' USING ERRCODE = 'P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_location.business_id,'procurement.master.manage');
 IF NOT public.can_access_branch(v_location.business_id,v_location.branch_id) THEN
  RAISE EXCEPTION 'You do not have access to that branch.' USING ERRCODE = '42501'; END IF;
 UPDATE public.inventory_locations SET project_id=NULL WHERE id=p_location_id RETURNING * INTO v_location;
 RETURN v_location;
END $$;

-- Invoker rights deliberately retain existing branch-level procurement RLS.
-- POs have no stored total: derive it from their ordered quantities/prices.
-- Missing optional prices contribute zero. Values are in each record's currency;
-- Phase A does not invent FX conversion or another stored cost balance.
CREATE OR REPLACE FUNCTION public.get_project_cost_summary(p_project_id uuid)
 RETURNS TABLE(total_po_value numeric,total_issued_value numeric,total_returned_value numeric,net_cost numeric)
 LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public AS $$
DECLARE v_business uuid;
BEGIN
 SELECT business_id INTO v_business FROM public.projects WHERE id=p_project_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found or not accessible.' USING ERRCODE = '42501'; END IF;
 IF cardinality(public.construction_procurement_capabilities_for(v_business)) = 0 THEN
  RAISE EXCEPTION 'A procurement capability is required.' USING ERRCODE = '42501'; END IF;
 RETURN QUERY WITH po AS (
 SELECT coalesce(sum(l.quantity_ordered * coalesce(l.expected_unit_price,0)),0) AS amount
 FROM public.construction_purchase_orders o JOIN public.construction_purchase_order_lines l ON l.po_id=o.id WHERE o.project_id=p_project_id
 ), issued AS (SELECT coalesce(sum(i.total_cost_base),0) AS amount FROM public.construction_material_issues i WHERE i.project_id=p_project_id),
 returned AS (SELECT coalesce(sum(r.total_cost_base),0) AS amount FROM public.construction_material_returns r WHERE r.project_id=p_project_id)
 SELECT po.amount,issued.amount,returned.amount,po.amount-returned.amount FROM po,issued,returned;
END $$;

-- A dimension-only insert trigger. New wrappers set transaction-local context,
-- then invoke the ORIGINAL commands. Existing append-only/write-token guards
-- still execute, and no UPDATE to a posted issue/return is necessary or allowed.
CREATE OR REPLACE FUNCTION public._ledgr_project_procurement_tag() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_project uuid := nullif(current_setting('ledgr.project_id',true),'')::uuid; v_source uuid;
BEGIN
 IF TG_TABLE_NAME = 'construction_material_returns' THEN
  SELECT project_id INTO v_source FROM public.construction_material_issues WHERE id=NEW.source_issue_id;
  v_project := coalesce(v_project,v_source);
 END IF;
 IF v_project IS NULL THEN RETURN NEW; END IF;
 PERFORM public._ledgr_construction_actor(NEW.business_id, CASE TG_TABLE_NAME
 WHEN 'construction_purchase_orders' THEN 'procurement.po.manage'
 WHEN 'construction_material_issues' THEN 'procurement.material.issue' ELSE 'procurement.material.return' END);
 IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=v_project AND business_id=NEW.business_id) THEN
  RAISE EXCEPTION 'Project and procurement record must belong to the same business.' USING ERRCODE = '22023'; END IF;
 IF TG_TABLE_NAME = 'construction_material_returns' THEN
  SELECT project_id INTO v_source FROM public.construction_material_issues WHERE id=NEW.source_issue_id;
  IF v_source IS DISTINCT FROM v_project THEN
   RAISE EXCEPTION 'Return project must match the source issue project.' USING ERRCODE = '22023'; END IF;
 END IF;
 NEW.project_id := v_project;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS project_po_tag ON public.construction_purchase_orders;
CREATE TRIGGER project_po_tag BEFORE INSERT ON public.construction_purchase_orders FOR EACH ROW EXECUTE FUNCTION public._ledgr_project_procurement_tag();
DROP TRIGGER IF EXISTS project_issue_tag ON public.construction_material_issues;
CREATE TRIGGER project_issue_tag BEFORE INSERT ON public.construction_material_issues FOR EACH ROW EXECUTE FUNCTION public._ledgr_project_procurement_tag();
DROP TRIGGER IF EXISTS project_return_tag ON public.construction_material_returns;
CREATE TRIGGER project_return_tag BEFORE INSERT ON public.construction_material_returns FOR EACH ROW EXECUTE FUNCTION public._ledgr_project_procurement_tag();

CREATE OR REPLACE FUNCTION public.create_project_purchase_order(p_payload jsonb,p_client_key uuid,p_project_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_business uuid; v_tag uuid; v_previous text := current_setting('ledgr.project_id',true);
BEGIN
 SELECT business_id INTO v_business FROM public.projects WHERE id=p_project_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_business,'procurement.po.manage');
 IF (p_payload->>'business_id')::uuid IS DISTINCT FROM v_business THEN
  RAISE EXCEPTION 'Project and procurement record must belong to the same business.' USING ERRCODE = '22023'; END IF;
 PERFORM set_config('ledgr.project_id',p_project_id::text,true);
 v_result := public.create_construction_purchase_order(p_payload,p_client_key);
 PERFORM set_config('ledgr.project_id',coalesce(v_previous,''),true);
 SELECT project_id INTO v_tag FROM public.construction_purchase_orders WHERE id=(v_result->>'id')::uuid;
 IF v_tag IS DISTINCT FROM p_project_id THEN
  RAISE EXCEPTION 'Replay key belongs to a different project.' USING ERRCODE = '22023'; END IF;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.issue_project_materials(p_payload jsonb,p_client_key uuid,p_project_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_business uuid; v_tag uuid; v_previous text := current_setting('ledgr.project_id',true);
BEGIN
 SELECT business_id INTO v_business FROM public.projects WHERE id=p_project_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_business,'procurement.material.issue');
 IF (p_payload->>'business_id')::uuid IS DISTINCT FROM v_business THEN
  RAISE EXCEPTION 'Project and procurement record must belong to the same business.' USING ERRCODE = '22023'; END IF;
 PERFORM set_config('ledgr.project_id',p_project_id::text,true);
 v_result := public.issue_construction_materials_to_project(p_payload,p_client_key);
 PERFORM set_config('ledgr.project_id',coalesce(v_previous,''),true);
 SELECT project_id INTO v_tag FROM public.construction_material_issues WHERE id=(v_result->>'id')::uuid;
 IF v_tag IS DISTINCT FROM p_project_id THEN
  RAISE EXCEPTION 'Replay key belongs to a different project.' USING ERRCODE = '22023'; END IF;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.return_project_materials(p_payload jsonb,p_client_key uuid,p_project_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb; v_business uuid; v_tag uuid; v_previous text := current_setting('ledgr.project_id',true);
BEGIN
 SELECT business_id INTO v_business FROM public.projects WHERE id=p_project_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_business,'procurement.material.return');
 IF (p_payload->>'business_id')::uuid IS DISTINCT FROM v_business THEN
  RAISE EXCEPTION 'Project and procurement record must belong to the same business.' USING ERRCODE = '22023'; END IF;
 PERFORM set_config('ledgr.project_id',p_project_id::text,true);
 v_result := public.return_construction_materials_to_store(p_payload,p_client_key);
 PERFORM set_config('ledgr.project_id',coalesce(v_previous,''),true);
 SELECT project_id INTO v_tag FROM public.construction_material_returns WHERE id=(v_result->>'id')::uuid;
 IF v_tag IS DISTINCT FROM p_project_id THEN
  RAISE EXCEPTION 'Replay key belongs to a different project.' USING ERRCODE = '22023'; END IF;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public._ledgr_project_next_status(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._ledgr_project_procurement_tag() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_project(uuid,text,text,numeric,numeric,numeric,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project(uuid,text,text,numeric,numeric,numeric,date,date) TO authenticated;
REVOKE ALL ON FUNCTION public.update_project(uuid,text,text,numeric,numeric,numeric,date,date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_project(uuid,text,text,numeric,numeric,numeric,date,date) TO authenticated;
REVOKE ALL ON FUNCTION public.transition_project_status(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_project_status(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.link_site_to_project(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_site_to_project(uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.unlink_site_from_project(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_site_from_project(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_project_cost_summary(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_project_cost_summary(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_project_purchase_order(jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project_purchase_order(jsonb,uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.issue_project_materials(jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.issue_project_materials(jsonb,uuid,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.return_project_materials(jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.return_project_materials(jsonb,uuid,uuid) TO authenticated;


-- Same-business integrity also covers existing inventory-location write paths.
CREATE OR REPLACE FUNCTION public._ledgr_project_location_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND NEW.project_id IS NOT DISTINCT FROM OLD.project_id AND NEW.business_id = OLD.business_id THEN RETURN NEW; END IF;
 IF NEW.project_id IS NOT NULL OR (TG_OP = 'UPDATE' AND OLD.project_id IS NOT NULL) THEN
  PERFORM public._ledgr_construction_actor(NEW.business_id,'procurement.master.manage');
  IF NOT public.can_access_branch(NEW.business_id,NEW.branch_id) THEN
   RAISE EXCEPTION 'You do not have access to that branch.' USING ERRCODE = '42501'; END IF;
 END IF;
 IF NEW.project_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=NEW.project_id AND business_id=NEW.business_id) THEN
   RAISE EXCEPTION 'Location and project must belong to the same business.' USING ERRCODE = '22023'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._ledgr_project_location_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS project_location_guard ON public.inventory_locations;
CREATE TRIGGER project_location_guard BEFORE INSERT OR UPDATE OF project_id,business_id ON public.inventory_locations
 FOR EACH ROW EXECUTE FUNCTION public._ledgr_project_location_guard();

DO $verify$
DECLARE t text; a text; b text; expected text;
BEGIN
 FOREACH t IN ARRAY ARRAY['projects','project_status_log'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity)
   OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=('public.'||t)::regclass) THEN
   RAISE EXCEPTION 'Project RLS missing on %',t; END IF;
  IF has_table_privilege('authenticated','public.'||t,'INSERT,UPDATE,DELETE') THEN
   RAISE EXCEPTION 'Project command boundary weakened on %',t; END IF;
 END LOOP;
 -- Exhaustively verify the shared state-machine definition.
 FOREACH a IN ARRAY ARRAY['tender','active','practical_completion','defect_liability','closed'] LOOP
  expected := CASE a WHEN 'tender' THEN 'active' WHEN 'active' THEN 'practical_completion'
   WHEN 'practical_completion' THEN 'defect_liability' WHEN 'defect_liability' THEN 'closed' END;
  FOREACH b IN ARRAY ARRAY['tender','active','practical_completion','defect_liability','closed'] LOOP
   IF (public._ledgr_project_next_status(a) IS NOT DISTINCT FROM b) <> (expected IS NOT DISTINCT FROM b) THEN
    RAISE EXCEPTION 'Project transition matrix weakened'; END IF;
  END LOOP;
 END LOOP;
 -- Anonymous caller must never pass the existing actor's grant check.
 BEGIN
  PERFORM public._ledgr_construction_actor(gen_random_uuid(),'procurement.master.manage');
  RAISE EXCEPTION 'Project grant check weakened';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 IF position('_ledgr_construction_actor' IN pg_get_functiondef('public.transition_project_status(uuid,text,text)'::regprocedure))=0
  OR position('_ledgr_project_next_status' IN pg_get_functiondef('public.transition_project_status(uuid,text,text)'::regprocedure))=0
  OR position('construction_procurement_capabilities_for' IN (SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polname='projects_member_grants'))=0 THEN
  RAISE EXCEPTION 'Project authorization or state machine weakened'; END IF;
END $verify$;

-- Convergence proof. Whether this file BUILT these objects or ADOPTED them from
-- a hand application that never recorded version 20261028000000, the declared
-- shape must be complete when the file ends. Anything missing is reported in one
-- message naming every gap, so a half-applied database fails here instead of
-- surfacing later as an RPC error nobody can attribute to this migration.
DO $converged$
DECLARE
  v_object  text;
  v_missing text := NULL;
  v_checks  integer;
BEGIN
  FOREACH v_object IN ARRAY ARRAY[
      'projects_business_status','projects_business','project_status_log_project',
      'construction_po_project','construction_issue_project','construction_return_project',
      'inventory_location_project'] LOOP
    IF to_regclass('public.'||v_object) IS NULL THEN
      v_missing := coalesce(v_missing||'; ','')||'index '||v_object;
    END IF;
  END LOOP;

  FOREACH v_object IN ARRAY ARRAY[
      'project_po_tag','project_issue_tag','project_return_tag','project_location_guard'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger tr WHERE tr.tgname = v_object AND NOT tr.tgisinternal) THEN
      v_missing := coalesce(v_missing||'; ','')||'trigger '||v_object;
    END IF;
  END LOOP;

  FOREACH v_object IN ARRAY ARRAY[
      'public._ledgr_project_next_status(text)',
      'public.create_project(uuid,text,text,numeric,numeric,numeric,date,date)',
      'public.update_project(uuid,text,text,numeric,numeric,numeric,date,date)',
      'public.transition_project_status(uuid,text,text)',
      'public.link_site_to_project(uuid,uuid)',
      'public.unlink_site_from_project(uuid)',
      'public.get_project_cost_summary(uuid)',
      'public._ledgr_project_procurement_tag()',
      'public.create_project_purchase_order(jsonb,uuid,uuid)',
      'public.issue_project_materials(jsonb,uuid,uuid)',
      'public.return_project_materials(jsonb,uuid,uuid)',
      'public._ledgr_project_location_guard()'] LOOP
    IF to_regprocedure(v_object) IS NULL THEN
      v_missing := coalesce(v_missing||'; ','')||'function '||v_object;
    END IF;
  END LOOP;

  -- Primary key, the audit FK and the four additive procurement dimensions.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid='public.projects'::regclass AND c.contype='p') THEN
    v_missing := coalesce(v_missing||'; ','')||'primary key on public.projects';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint c
                  WHERE c.conrelid='public.project_status_log'::regclass AND c.contype='f'
                    AND c.confrelid='public.projects'::regclass) THEN
    v_missing := coalesce(v_missing||'; ','')||'project_status_log.project_id reference to public.projects';
  END IF;
  FOREACH v_object IN ARRAY ARRAY[
      'construction_purchase_orders','construction_material_issues',
      'construction_material_returns','inventory_locations'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute a
                    WHERE a.attrelid=('public.'||v_object)::regclass AND a.attname='project_id'
                      AND a.attnum>0 AND NOT a.attisdropped)
       OR NOT EXISTS (SELECT 1 FROM pg_constraint c
                       WHERE c.conrelid=('public.'||v_object)::regclass AND c.contype='f'
                         AND c.confrelid='public.projects'::regclass) THEN
      v_missing := coalesce(v_missing||'; ','')||v_object||'.project_id reference to public.projects';
    END IF;
  END LOOP;

  -- The six declared CHECK contracts on public.projects.
  SELECT count(*) INTO v_checks
    FROM pg_constraint c
   WHERE c.conrelid='public.projects'::regclass AND c.contype='c';
  IF v_checks < 6 THEN
    v_missing := coalesce(v_missing||'; ','')||format('%s of 6 CHECK constraints on public.projects', 6 - v_checks);
  END IF;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Phase A project dimension is incomplete after convergence — missing: %. Re-run the deploy once the gap is understood; nothing in this migration drops or rewrites data.', v_missing
      USING ERRCODE = 'P0001';
  END IF;
END $converged$;
