-- Phase B: construction schedule of values (BOQ).
ALTER TABLE public.construction_projects ADD COLUMN boq_locked_at timestamptz;
COMMENT ON COLUMN public.construction_projects.boq_locked_at IS 'Set when first valuation is created; BOQ becomes read-only after this point.';

-- The Phase A namespace migration creates this restricted view only on schemas
-- where `public.projects` was free. Refresh its expanded column list after the
-- BOQ lock column is added, without ever changing an unrelated legacy object.
DO $refresh_projects_compatibility_view$
DECLARE v_projects_oid oid := to_regclass('public.projects');
BEGIN
 IF v_projects_oid IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_class
       WHERE oid = v_projects_oid
         AND relkind = 'v'
         AND reloptions @> ARRAY['security_invoker=true']
    )
    AND obj_description(v_projects_oid, 'pg_class') = 'Ledgr construction projects compatibility view' THEN
  EXECUTE 'CREATE OR REPLACE VIEW public.projects WITH (security_invoker = true) AS SELECT * FROM public.construction_projects';
 END IF;
END
$refresh_projects_compatibility_view$;

CREATE TABLE public.project_boq_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
 line_number text NOT NULL,
 description text NOT NULL DEFAULT '',
 quantity decimal(18,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0 AND quantity <> 'NaN'::numeric),
 unit text NOT NULL DEFAULT '',
 rate decimal(18,4) NOT NULL DEFAULT 0 CHECK (rate >= 0 AND rate <> 'NaN'::numeric),
 total_value decimal(18,2) NOT NULL DEFAULT 0,
 sort_order int NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_boq_lines_order ON public.project_boq_lines(project_id,sort_order);
ALTER TABLE public.project_boq_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_boq_lines_member_grants ON public.project_boq_lines FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.construction_projects p WHERE p.id=project_id AND public.is_business_member(p.business_id)
   AND cardinality(public.construction_procurement_capabilities_for(p.business_id))>0))
 WITH CHECK (EXISTS (SELECT 1 FROM public.construction_projects p WHERE p.id=project_id AND public.is_business_member(p.business_id)
   AND cardinality(public.construction_procurement_capabilities_for(p.business_id))>0));
REVOKE ALL ON public.project_boq_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.project_boq_lines TO authenticated;

CREATE FUNCTION public.create_boq_line(p_project_id uuid,p_line_number text,p_description text,p_quantity numeric,p_unit text,p_rate numeric,p_sort_order int)
RETURNS public.project_boq_lines LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.construction_projects; v_line public.project_boq_lines;
BEGIN
 SELECT * INTO v_project FROM public.construction_projects WHERE id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE='P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_project.business_id,'procurement.master.manage');
 IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be edited' USING ERRCODE='55000'; END IF;
 IF p_quantity IS NULL OR p_quantity='NaN'::numeric OR p_quantity<0 OR p_rate IS NULL OR p_rate='NaN'::numeric OR p_rate<0 THEN RAISE EXCEPTION 'Quantity and rate must be non-negative.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.project_boq_lines(project_id,line_number,description,quantity,unit,rate,total_value,sort_order)
 VALUES(p_project_id,coalesce(p_line_number,''),coalesce(p_description,''),p_quantity,coalesce(p_unit,''),p_rate,round(p_quantity*p_rate,2),coalesce(p_sort_order,0)) RETURNING * INTO v_line;
 RETURN v_line;
END $$;

CREATE FUNCTION public.update_boq_line(p_line_id uuid,p_line_number text,p_description text,p_quantity numeric,p_unit text,p_rate numeric,p_sort_order int)
RETURNS public.project_boq_lines LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.construction_projects; v_line public.project_boq_lines;
BEGIN
 SELECT p.* INTO v_project FROM public.construction_projects p JOIN public.project_boq_lines l ON l.project_id=p.id WHERE l.id=p_line_id FOR UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOQ line not found.' USING ERRCODE='P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_project.business_id,'procurement.master.manage');
 IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be edited' USING ERRCODE='55000'; END IF;
 IF p_quantity IS NULL OR p_quantity='NaN'::numeric OR p_quantity<0 OR p_rate IS NULL OR p_rate='NaN'::numeric OR p_rate<0 THEN RAISE EXCEPTION 'Quantity and rate must be non-negative.' USING ERRCODE='22023'; END IF;
 UPDATE public.project_boq_lines SET line_number=coalesce(p_line_number,''),description=coalesce(p_description,''),quantity=p_quantity,unit=coalesce(p_unit,''),rate=p_rate,total_value=round(p_quantity*p_rate,2),sort_order=coalesce(p_sort_order,0),updated_at=now() WHERE id=p_line_id RETURNING * INTO v_line;
 RETURN v_line;
END $$;

CREATE FUNCTION public.delete_boq_line(p_line_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.construction_projects; v_project_id uuid;
BEGIN
 SELECT project_id INTO v_project_id FROM public.project_boq_lines WHERE id=p_line_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOQ line not found.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_project FROM public.construction_projects WHERE id=v_project_id FOR UPDATE;
 PERFORM public._ledgr_construction_actor(v_project.business_id,'procurement.master.manage');
 IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be edited' USING ERRCODE='55000'; END IF;
 DELETE FROM public.project_boq_lines WHERE id=p_line_id;
END $$;

CREATE FUNCTION public.reorder_boq_lines(p_project_id uuid,p_line_ids uuid[]) RETURNS SETOF public.project_boq_lines LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.construction_projects; v_id uuid; v_order int:=0; v_count int;
BEGIN
 SELECT * INTO v_project FROM public.construction_projects WHERE id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE='P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_project.business_id,'procurement.master.manage');
 IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be edited' USING ERRCODE='55000'; END IF;
 IF cardinality(coalesce(p_line_ids,'{}')) <> (SELECT count(*) FROM public.project_boq_lines WHERE project_id=p_project_id)
  OR cardinality(coalesce(p_line_ids,'{}')) <> (SELECT count(DISTINCT x) FROM unnest(coalesce(p_line_ids,'{}')) x) THEN RAISE EXCEPTION 'Line IDs must include every project BOQ line exactly once.' USING ERRCODE='22023'; END IF;
 FOREACH v_id IN ARRAY coalesce(p_line_ids,'{}') LOOP
  UPDATE public.project_boq_lines SET sort_order=v_order,updated_at=now() WHERE id=v_id AND project_id=p_project_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'All line IDs must belong to the project and be unique.' USING ERRCODE='22023'; END IF;
  v_order:=v_order+1;
 END LOOP;
 RETURN QUERY SELECT * FROM public.project_boq_lines WHERE project_id=p_project_id ORDER BY sort_order;
END $$;

CREATE FUNCTION public.bulk_upsert_boq_lines(p_project_id uuid,p_lines jsonb) RETURNS SETOF public.project_boq_lines LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.construction_projects; v jsonb; v_id uuid; v_qty numeric; v_rate numeric;
BEGIN
 SELECT * INTO v_project FROM public.construction_projects WHERE id=p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE='P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_project.business_id,'procurement.master.manage');
 IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be edited' USING ERRCODE='55000'; END IF;
 IF jsonb_typeof(p_lines)<>'array' THEN RAISE EXCEPTION 'BOQ lines must be an array.' USING ERRCODE='22023'; END IF;
 FOR v IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
  v_id:=nullif(v->>'id','')::uuid;
  IF coalesce((v->>'_deleted')::boolean,false) THEN
   IF v_id IS NOT NULL THEN
    DELETE FROM public.project_boq_lines WHERE id=v_id AND project_id=p_project_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOQ line does not belong to this project.' USING ERRCODE='22023'; END IF;
   END IF;
   CONTINUE;
  END IF;
  v_qty:=coalesce((v->>'quantity')::numeric,0); v_rate:=coalesce((v->>'rate')::numeric,0);
  IF v_qty='NaN'::numeric OR v_qty<0 OR v_rate='NaN'::numeric OR v_rate<0 THEN RAISE EXCEPTION 'Quantity and rate must be non-negative.' USING ERRCODE='22023'; END IF;
  IF v_id IS NULL THEN
   INSERT INTO public.project_boq_lines(project_id,line_number,description,quantity,unit,rate,total_value,sort_order)
   VALUES(p_project_id,coalesce(v->>'line_number',''),coalesce(v->>'description',''),v_qty,coalesce(v->>'unit',''),v_rate,round(v_qty*v_rate,2),coalesce((v->>'sort_order')::int,0));
  ELSE
   UPDATE public.project_boq_lines SET line_number=coalesce(v->>'line_number',''),description=coalesce(v->>'description',''),quantity=v_qty,unit=coalesce(v->>'unit',''),rate=v_rate,total_value=round(v_qty*v_rate,2),sort_order=coalesce((v->>'sort_order')::int,0),updated_at=now() WHERE id=v_id AND project_id=p_project_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'BOQ line does not belong to this project.' USING ERRCODE='22023'; END IF;
  END IF;
 END LOOP;
 RETURN QUERY SELECT * FROM public.project_boq_lines WHERE project_id=p_project_id ORDER BY sort_order,line_number;
END $$;

CREATE FUNCTION public.get_boq_summary(p_project_id uuid) RETURNS TABLE(total_boq_value numeric,contract_sum numeric,variance numeric,line_count bigint,is_locked boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_business uuid;
BEGIN
 SELECT p.business_id INTO v_business FROM public.construction_projects p WHERE p.id=p_project_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE='P0002'; END IF;
 IF cardinality(public.construction_procurement_capabilities_for(v_business))=0 THEN RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT coalesce(sum(l.total_value),0)::numeric,p.contract_sum,(p.contract_sum-coalesce(sum(l.total_value),0))::numeric,count(l.id),p.boq_locked_at IS NOT NULL FROM public.construction_projects p LEFT JOIN public.project_boq_lines l ON l.project_id=p.id WHERE p.id=p_project_id GROUP BY p.id;
END $$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY[
 'create_boq_line(uuid,text,text,numeric,text,numeric,integer)',
 'update_boq_line(uuid,text,text,numeric,text,numeric,integer)',
 'delete_boq_line(uuid)','reorder_boq_lines(uuid,uuid[])','bulk_upsert_boq_lines(uuid,jsonb)','get_boq_summary(uuid)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC,anon',f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated',f);
 END LOOP;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.project_boq_lines'::regclass)
  OR NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='public.project_boq_lines'::regclass)
  OR has_table_privilege('authenticated','public.project_boq_lines','INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'BOQ RLS/command boundary missing'; END IF;
 FOREACH f IN ARRAY ARRAY['create_boq_line(uuid,text,text,numeric,text,numeric,integer)','update_boq_line(uuid,text,text,numeric,text,numeric,integer)','delete_boq_line(uuid)','reorder_boq_lines(uuid,uuid[])','bulk_upsert_boq_lines(uuid,jsonb)'] LOOP
  IF position('boq_locked_at' IN pg_get_functiondef(('public.'||f)::regprocedure))=0 THEN RAISE EXCEPTION 'BOQ lock enforcement missing in %',f; END IF;
 END LOOP;
END $$;
