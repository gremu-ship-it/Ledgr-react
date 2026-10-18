-- Phase B: construction schedule of values (BOQ).
-- IF NOT EXISTS: a staging table adopted by the namespace repair may already
-- carry this column (applied out of order against the old public.projects
-- name); re-adding it would fail with SQLSTATE 42701 and block the chain.
-- Pending replay safety: existing feature objects must match the migration
-- contract before IF NOT EXISTS/OR REPLACE is allowed to reuse them. This is
-- catalog-only validation; mismatches raise 55000 without repairing any object.
DO $confirm_existing_construction_boq$
DECLARE
 v_spec jsonb;
 v_table oid;
 v_actual jsonb;
 v_index jsonb;
 v_index_oid oid;
 v_lifecycle boolean := false;
BEGIN
 IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.construction_projects'::regclass
      AND a.attname = 'boq_locked_at' AND a.attnum > 0 AND NOT a.attisdropped
      AND (format_type(a.atttypid,a.atttypmod) <> 'timestamp with time zone' OR a.attnotnull
           OR a.atthasdef OR a.attidentity <> '' OR a.attgenerated <> '')) THEN
  RAISE EXCEPTION 'Construction replay schema mismatch: boq_locked_at.' USING ERRCODE = '55000';
 END IF;
 FOR v_spec IN SELECT value FROM jsonb_array_elements($replay_contracts$
[
  {"name": "project_boq_lines",
   "columns": [
     {"name": "id", "type": "uuid", "not_null": true, "default": "gen_random_uuid()"},
     {"name": "project_id", "type": "uuid", "not_null": true, "default": null},
     {"name": "line_number", "type": "text", "not_null": true, "default": null},
     {"name": "description", "type": "text", "not_null": true, "default": "''::text"},
     {"name": "quantity", "type": "numeric(18,4)", "not_null": true, "default": "0"},
     {"name": "unit", "type": "text", "not_null": true, "default": "''::text"},
     {"name": "rate", "type": "numeric(18,4)", "not_null": true, "default": "0"},
     {"name": "total_value", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "sort_order", "type": "integer", "not_null": true, "default": "0"},
     {"name": "created_at", "type": "timestamp with time zone", "not_null": true, "default": "now()"},
     {"name": "updated_at", "type": "timestamp with time zone", "not_null": true, "default": "now()"}
   ],
   "constraints": [
     {"kind": "c", "columns": ["quantity"], "expression": "((quantity >= (0)::numeric) AND (quantity <> 'NaN'::numeric))", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "c", "columns": ["rate"], "expression": "((rate >= (0)::numeric) AND (rate <> 'NaN'::numeric))", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["project_id"], "expression": null, "target": "public.construction_projects", "target_columns": ["id"], "on_delete": "c", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "p", "columns": ["id"], "expression": null, "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false}
   ],
   "indexes": [
     {"name": "project_boq_lines_order", "unique": false, "method": "btree", "columns": ["project_id", "sort_order"], "predicate": null, "options": [0, 0], "key_count": 2, "column_count": 2},
     {"name": "project_boq_lines_pkey", "unique": true, "method": "btree", "columns": ["id"], "predicate": null, "options": [0], "key_count": 1, "column_count": 1}
   ],
   "policies": [
     {"command": "*", "permissive": true, "roles": ["authenticated"], "using": "(EXISTS ( SELECT 1\n   FROM construction_projects p\n  WHERE ((p.id = project_boq_lines.project_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))", "with_check": "(EXISTS ( SELECT 1\n   FROM construction_projects p\n  WHERE ((p.id = project_boq_lines.project_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))"}
   ]}
]
$replay_contracts$::jsonb) LOOP
  v_table := to_regclass(format('public.%I',v_spec->>'name'));
  IF v_table IS NULL THEN
   IF to_regtype(format('public.%I',v_spec->>'name')) IS NOT NULL THEN
    RAISE EXCEPTION 'Construction replay type collision: %',v_spec->>'name' USING ERRCODE = '55000';
   END IF;
   IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_spec->'indexes') e
              WHERE to_regclass(format('public.%I',e->>'name')) IS NOT NULL) THEN
    RAISE EXCEPTION 'Construction replay reserved index name is occupied for missing table %',v_spec->>'name'
     USING ERRCODE = '55000', HINT = 'Inspect the owning relation; do not drop or rename an unverified index.';
   END IF;
   CONTINUE;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_table AND c.relkind IN ('r','p')
       AND c.relowner = (SELECT relowner FROM pg_class WHERE oid = 'public.construction_projects'::regclass)) THEN
   EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE',v_spec->>'name');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_table
       AND c.relkind IN ('r','p') AND c.relpersistence = 'p' AND c.relrowsecurity AND NOT c.relforcerowsecurity
       AND c.relowner = (SELECT relowner FROM pg_class WHERE oid = 'public.construction_projects'::regclass))
     OR NOT (NOT EXISTS (
     SELECT 1 FROM jsonb_to_recordset(v_spec->'columns')
       AS e(name text, type text, not_null boolean, "default" text)
     LEFT JOIN pg_attribute a ON a.attrelid = v_table
       AND a.attname = CASE WHEN v_lifecycle AND e.name = 'status' THEN 'lifecycle_state' ELSE e.name END
       AND a.attnum > 0 AND NOT a.attisdropped
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attname IS NULL OR format_type(a.atttypid,a.atttypmod) <> e.type
       OR a.attnotnull IS DISTINCT FROM e.not_null OR a.attidentity <> '' OR a.attgenerated <> ''
       OR a.attcollation <> (SELECT typcollation FROM pg_type WHERE oid = a.atttypid)
       OR (CASE WHEN e."default" IN ('gen_random_uuid()', 'now()')
            THEN regexp_replace(pg_get_expr(d.adbin,d.adrelid), '^(pg_catalog|public|extensions)\.', '')
            ELSE pg_get_expr(d.adbin,d.adrelid) END) IS DISTINCT FROM e."default"
   ) AND NOT EXISTS (
     SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_table AND a.attnum > 0 AND NOT a.attisdropped
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_spec->'columns') e
          WHERE a.attname = CASE WHEN v_lifecycle AND e->>'name' = 'status' THEN 'lifecycle_state' ELSE e->>'name' END)
       AND a.attnotnull AND NOT a.atthasdef AND a.attidentity = '' AND a.attgenerated = ''
   )) THEN
   RAISE EXCEPTION 'Construction replay schema mismatch: % owner/kind/columns/defaults.',v_spec->>'name'
    USING ERRCODE = '55000', HINT = 'Existing object left unchanged. Inspect the full schema; do not drop, re-point or mark the migration applied.';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
       'kind', k.contype,
       'columns', ARRAY(SELECT CASE WHEN v_lifecycle AND a.attname = 'lifecycle_state' THEN 'status' ELSE a.attname::text END
          FROM unnest(k.conkey) WITH ORDINALITY x(n,pos)
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.n ORDER BY x.pos),
       'expression', CASE WHEN k.contype = 'c' THEN
          CASE WHEN v_lifecycle THEN regexp_replace(pg_get_expr(k.conbin,k.conrelid), '\mlifecycle_state\M', 'status', 'g')
               ELSE pg_get_expr(k.conbin,k.conrelid) END END,
       'target', CASE WHEN k.contype = 'f' THEN format('%I.%I',n.nspname,c.relname) END,
       'target_columns', CASE WHEN k.contype = 'f' THEN ARRAY(SELECT a.attname
          FROM unnest(k.confkey) WITH ORDINALITY x(n,pos)
          JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = x.n ORDER BY x.pos) END,
       'on_delete', CASE WHEN k.contype = 'f' THEN k.confdeltype END,
       'on_update', CASE WHEN k.contype = 'f' THEN k.confupdtype END,
       'match', CASE WHEN k.contype = 'f' THEN k.confmatchtype END,
       'validated', k.convalidated, 'deferrable', k.condeferrable,
       'initially_deferred', k.condeferred)), '[]'::jsonb)
     FROM pg_constraint k
     LEFT JOIN pg_class c ON c.oid = k.confrelid
     LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE k.conrelid = v_table AND k.contype IN ('p','u','f','c') INTO v_actual;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_spec->'constraints') e WHERE NOT v_actual @> jsonb_build_array(e))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_actual) a WHERE NOT (v_spec->'constraints') @> jsonb_build_array(a))
     OR NOT (NOT EXISTS (
     SELECT 1 FROM pg_policy p WHERE p.polrelid = v_table AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_spec->'policies') e
       WHERE p.polcmd::text = e->>'command' AND p.polpermissive = (e->>'permissive')::boolean
         AND to_jsonb(ARRAY(SELECT CASE WHEN r = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(r)::text END FROM unnest(p.polroles) r)) = e->'roles'
         AND replace(replace(pg_get_expr(p.polqual,p.polrelid), 'public.', ''), 'FROM projects ', 'FROM construction_projects ')
               IS NOT DISTINCT FROM replace(e->>'using', 'public.', '')
         AND replace(replace(pg_get_expr(p.polwithcheck,p.polrelid), 'public.', ''), 'FROM projects ', 'FROM construction_projects ')
               IS NOT DISTINCT FROM replace(e->>'with_check', 'public.', '')
     )
   )) OR NOT (NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_table
      AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL)
   AND NOT EXISTS (
     SELECT 1 FROM pg_class c, LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
     WHERE c.oid = v_table AND (
       acl.grantee NOT IN (c.relowner, to_regrole('service_role')::oid, to_regrole('authenticated')::oid)
       OR (acl.grantee = to_regrole('authenticated')::oid AND acl.privilege_type <> 'SELECT')
     )
   ))
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = v_table AND NOT tgisinternal) THEN
   RAISE EXCEPTION 'Construction replay schema mismatch: % constraints/policies/grants/triggers.',v_spec->>'name'
    USING ERRCODE = '55000', HINT = 'Existing object left unchanged. Confirm ownership and equivalence before replay.';
  END IF;
  FOR v_index IN SELECT value FROM jsonb_array_elements(v_spec->'indexes') LOOP
   v_index_oid := to_regclass(format('public.%I',v_index->>'name'));
   IF v_index_oid IS NULL THEN CONTINUE; END IF;
   IF NOT EXISTS (
    SELECT 1 FROM pg_index ix JOIN pg_class idx ON idx.oid = ix.indexrelid JOIN pg_am am ON am.oid = idx.relam
    WHERE ix.indexrelid = v_index_oid AND ix.indrelid = v_table AND ix.indisvalid AND ix.indisready
      AND ix.indisunique = (v_index->>'unique')::boolean AND am.amname = v_index->>'method'
      AND ix.indexprs IS NULL AND ix.indnkeyatts = (v_index->>'key_count')::integer
      AND ix.indnatts = (v_index->>'column_count')::integer
      AND to_jsonb(ARRAY(SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY x(n,pos)
          JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = x.n ORDER BY x.pos)) = v_index->'columns'
      AND to_jsonb(ix.indoption::smallint[]) = v_index->'options'
      AND pg_get_expr(ix.indpred,ix.indrelid) IS NOT DISTINCT FROM v_index->>'predicate'
   ) THEN
    RAISE EXCEPTION 'Construction replay index collision: %',v_index->>'name'
     USING ERRCODE = '55000', HINT = 'Do not drop or rename the existing index; inspect its owning table and definition.';
   END IF;
  END LOOP;
  -- A differently named unique index can change valid write behavior too.
  -- Accept the declared uniqueness semantics, not arbitrary extra uniqueness.
  FOR v_index_oid IN SELECT indexrelid FROM pg_index WHERE indrelid = v_table AND indisunique LOOP
   SELECT jsonb_build_object(
     'unique',ix.indisunique,'method',am.amname,
     'columns',ARRAY(SELECT a.attname FROM unnest(ix.indkey) WITH ORDINALITY x(n,pos)
       JOIN pg_attribute a ON a.attrelid=ix.indrelid AND a.attnum=x.n ORDER BY x.pos),
     'predicate',pg_get_expr(ix.indpred,ix.indrelid),'options',ix.indoption::smallint[],
     'key_count',ix.indnkeyatts,'column_count',ix.indnatts)
    INTO v_actual FROM pg_index ix JOIN pg_class idx ON idx.oid=ix.indexrelid JOIN pg_am am ON am.oid=idx.relam
    WHERE ix.indexrelid=v_index_oid AND ix.indisvalid AND ix.indisready AND ix.indexprs IS NULL;
   IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_spec->'indexes') e WHERE e - 'name' = v_actual) THEN
    RAISE EXCEPTION 'Construction replay has unreviewed unique-index semantics on %',v_spec->>'name'
     USING ERRCODE = '55000', HINT = 'Inspect the additional uniqueness rule before approving reuse; no index is dropped.';
   END IF;
  END LOOP;
 END LOOP;
END
$confirm_existing_construction_boq$;

ALTER TABLE public.construction_projects ADD COLUMN IF NOT EXISTS boq_locked_at timestamptz;
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

CREATE TABLE IF NOT EXISTS public.project_boq_lines (
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
CREATE INDEX IF NOT EXISTS project_boq_lines_order ON public.project_boq_lines(project_id,sort_order);
ALTER TABLE public.project_boq_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_boq_lines_member_grants ON public.project_boq_lines;
CREATE POLICY project_boq_lines_member_grants ON public.project_boq_lines FOR ALL TO authenticated
 USING (EXISTS (SELECT 1 FROM public.construction_projects p WHERE p.id=project_id AND public.is_business_member(p.business_id)
   AND cardinality(public.construction_procurement_capabilities_for(p.business_id))>0))
 WITH CHECK (EXISTS (SELECT 1 FROM public.construction_projects p WHERE p.id=project_id AND public.is_business_member(p.business_id)
   AND cardinality(public.construction_procurement_capabilities_for(p.business_id))>0));
REVOKE ALL ON public.project_boq_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.project_boq_lines TO authenticated;

CREATE OR REPLACE FUNCTION public.create_boq_line(p_project_id uuid,p_line_number text,p_description text,p_quantity numeric,p_unit text,p_rate numeric,p_sort_order int)
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

CREATE OR REPLACE FUNCTION public.update_boq_line(p_line_id uuid,p_line_number text,p_description text,p_quantity numeric,p_unit text,p_rate numeric,p_sort_order int)
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

CREATE OR REPLACE FUNCTION public.delete_boq_line(p_line_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project public.construction_projects; v_project_id uuid;
BEGIN
 SELECT project_id INTO v_project_id FROM public.project_boq_lines WHERE id=p_line_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOQ line not found.' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_project FROM public.construction_projects WHERE id=v_project_id FOR UPDATE;
 PERFORM public._ledgr_construction_actor(v_project.business_id,'procurement.master.manage');
 IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be edited' USING ERRCODE='55000'; END IF;
 DELETE FROM public.project_boq_lines WHERE id=p_line_id;
END $$;

CREATE OR REPLACE FUNCTION public.reorder_boq_lines(p_project_id uuid,p_line_ids uuid[]) RETURNS SETOF public.project_boq_lines LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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

CREATE OR REPLACE FUNCTION public.bulk_upsert_boq_lines(p_project_id uuid,p_lines jsonb) RETURNS SETOF public.project_boq_lines LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
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

CREATE OR REPLACE FUNCTION public.get_boq_summary(p_project_id uuid) RETURNS TABLE(total_boq_value numeric,contract_sum numeric,variance numeric,line_count bigint,is_locked boolean)
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
