-- Phase A: project dimension. Existing procurement commands, guards and grants
-- remain authoritative. No stock, accounting, BOQ or billing logic is added.
CREATE TABLE public.projects (
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
CREATE INDEX projects_business_status ON public.projects(business_id,status);
CREATE INDEX projects_business ON public.projects(business_id);
CREATE TABLE public.project_status_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 from_status text NOT NULL, to_status text NOT NULL,
 changed_by uuid NOT NULL REFERENCES auth.users(id), reason text,
 changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_status_log_project ON public.project_status_log(project_id,changed_at);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_status_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_member_grants ON public.projects FOR ALL TO authenticated
 USING (public.is_business_member(business_id) AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
 WITH CHECK (public.is_business_member(business_id) AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
CREATE POLICY project_log_member_grants ON public.project_status_log FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id))
 WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id));
-- Like procurement, reads use RLS; writes are commands only. In particular,
-- clients cannot bypass the lifecycle or forge its append-only audit trail.
REVOKE ALL ON public.projects, public.project_status_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.projects, public.project_status_log TO authenticated;

ALTER TABLE public.construction_purchase_orders ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.construction_material_issues ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.construction_material_returns ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE public.inventory_locations ADD COLUMN project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;
CREATE INDEX construction_po_project ON public.construction_purchase_orders(project_id);
CREATE INDEX construction_issue_project ON public.construction_material_issues(project_id);
CREATE INDEX construction_return_project ON public.construction_material_returns(project_id);
CREATE INDEX inventory_location_project ON public.inventory_locations(project_id);

CREATE FUNCTION public._ledgr_project_next_status(p_status text) RETURNS text
 LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT CASE p_status WHEN 'tender' THEN 'active' WHEN 'active' THEN 'practical_completion'
 WHEN 'practical_completion' THEN 'defect_liability' WHEN 'defect_liability' THEN 'closed' END
$$;

CREATE FUNCTION public.create_project(p_business_id uuid, p_name text, p_client_name text,
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

CREATE FUNCTION public.update_project(p_project_id uuid, p_name text, p_client_name text,
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

CREATE FUNCTION public.transition_project_status(p_project_id uuid,p_new_status text,p_reason text DEFAULT NULL)
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

CREATE FUNCTION public.link_site_to_project(p_location_id uuid,p_project_id uuid)
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
CREATE FUNCTION public.unlink_site_from_project(p_location_id uuid)
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
CREATE FUNCTION public.get_project_cost_summary(p_project_id uuid)
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
CREATE FUNCTION public._ledgr_project_procurement_tag() RETURNS trigger
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
CREATE TRIGGER project_po_tag BEFORE INSERT ON public.construction_purchase_orders FOR EACH ROW EXECUTE FUNCTION public._ledgr_project_procurement_tag();
CREATE TRIGGER project_issue_tag BEFORE INSERT ON public.construction_material_issues FOR EACH ROW EXECUTE FUNCTION public._ledgr_project_procurement_tag();
CREATE TRIGGER project_return_tag BEFORE INSERT ON public.construction_material_returns FOR EACH ROW EXECUTE FUNCTION public._ledgr_project_procurement_tag();

CREATE FUNCTION public.create_project_purchase_order(p_payload jsonb,p_client_key uuid,p_project_id uuid)
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

CREATE FUNCTION public.issue_project_materials(p_payload jsonb,p_client_key uuid,p_project_id uuid)
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

CREATE FUNCTION public.return_project_materials(p_payload jsonb,p_client_key uuid,p_project_id uuid)
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
CREATE FUNCTION public._ledgr_project_location_guard() RETURNS trigger
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
