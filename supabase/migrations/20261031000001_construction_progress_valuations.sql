-- Phase C: progress valuations, retention and invoices created in the existing
-- Income/invoicing subsystem. All writes are RPC-only; browser writes remain
-- revoked and the existing project/BOQ lifecycle stays authoritative.

-- Pending replay safety: existing feature objects must match the migration
-- contract before IF NOT EXISTS/OR REPLACE is allowed to reuse them. This is
-- catalog-only validation; mismatches raise 55000 without repairing any object.
DO $confirm_existing_construction_valuations$
DECLARE
 v_spec jsonb;
 v_table oid;
 v_actual jsonb;
 v_index jsonb;
 v_index_oid oid;
 v_lifecycle boolean := false;
BEGIN
 FOR v_spec IN SELECT value FROM jsonb_array_elements($replay_contracts$
[
  {"name": "project_valuations",
   "columns": [
     {"name": "id", "type": "uuid", "not_null": true, "default": "gen_random_uuid()"},
     {"name": "project_id", "type": "uuid", "not_null": true, "default": null},
     {"name": "valuation_number", "type": "integer", "not_null": true, "default": null},
     {"name": "valuation_date", "type": "date", "not_null": true, "default": "CURRENT_DATE"},
     {"name": "period_start", "type": "date", "not_null": false, "default": null},
     {"name": "period_end", "type": "date", "not_null": false, "default": null},
     {"name": "gross_amount", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "retention_amount", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "net_amount", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "previous_cumulative", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "status", "type": "text", "not_null": true, "default": "'draft'::text"},
     {"name": "invoice_id", "type": "uuid", "not_null": false, "default": null},
     {"name": "notes", "type": "text", "not_null": false, "default": null},
     {"name": "created_by", "type": "uuid", "not_null": true, "default": null},
     {"name": "created_at", "type": "timestamp with time zone", "not_null": true, "default": "now()"},
     {"name": "updated_at", "type": "timestamp with time zone", "not_null": true, "default": "now()"}
   ],
   "constraints": [
     {"kind": "c", "columns": ["period_start", "period_end"], "expression": "((period_start IS NULL) OR (period_end IS NULL) OR (period_start <= period_end))", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "c", "columns": ["status"], "expression": "(status = ANY (ARRAY['draft'::text, 'submitted'::text, 'invoiced'::text]))", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "c", "columns": ["valuation_number"], "expression": "(valuation_number > 0)", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["created_by"], "expression": null, "target": "auth.users", "target_columns": ["id"], "on_delete": "a", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["invoice_id"], "expression": null, "target": "public.invoices", "target_columns": ["id"], "on_delete": "n", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["project_id"], "expression": null, "target": "public.construction_projects", "target_columns": ["id"], "on_delete": "c", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "p", "columns": ["id"], "expression": null, "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "u", "columns": ["project_id", "valuation_number"], "expression": null, "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false}
   ],
   "indexes": [
     {"name": "project_valuations_pkey", "unique": true, "method": "btree", "columns": ["id"], "predicate": null, "options": [0], "key_count": 1, "column_count": 1},
     {"name": "project_valuations_project_id_valuation_number_key", "unique": true, "method": "btree", "columns": ["project_id", "valuation_number"], "predicate": null, "options": [0, 0], "key_count": 2, "column_count": 2},
     {"name": "project_valuations_project_status_idx", "unique": false, "method": "btree", "columns": ["project_id", "status"], "predicate": null, "options": [0, 0], "key_count": 2, "column_count": 2}
   ],
   "policies": [
     {"command": "*", "permissive": true, "roles": ["authenticated"], "using": "(EXISTS ( SELECT 1\n   FROM construction_projects p\n  WHERE ((p.id = project_valuations.project_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))", "with_check": "(EXISTS ( SELECT 1\n   FROM construction_projects p\n  WHERE ((p.id = project_valuations.project_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))"}
   ]},
  {"name": "project_valuation_lines",
   "columns": [
     {"name": "id", "type": "uuid", "not_null": true, "default": "gen_random_uuid()"},
     {"name": "valuation_id", "type": "uuid", "not_null": true, "default": null},
     {"name": "boq_line_id", "type": "uuid", "not_null": true, "default": null},
     {"name": "cumulative_pct", "type": "numeric(5,2)", "not_null": true, "default": null},
     {"name": "cumulative_value", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "previous_cumulative_value", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "period_value", "type": "numeric(18,2)", "not_null": true, "default": "0"},
     {"name": "notes", "type": "text", "not_null": false, "default": null}
   ],
   "constraints": [
     {"kind": "c", "columns": ["cumulative_pct"], "expression": "((cumulative_pct >= (0)::numeric) AND (cumulative_pct <= (100)::numeric))", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["boq_line_id"], "expression": null, "target": "public.project_boq_lines", "target_columns": ["id"], "on_delete": "c", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["valuation_id"], "expression": null, "target": "public.project_valuations", "target_columns": ["id"], "on_delete": "c", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "p", "columns": ["id"], "expression": null, "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "u", "columns": ["valuation_id", "boq_line_id"], "expression": null, "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false}
   ],
   "indexes": [
     {"name": "project_valuation_lines_boq_line_idx", "unique": false, "method": "btree", "columns": ["boq_line_id"], "predicate": null, "options": [0], "key_count": 1, "column_count": 1},
     {"name": "project_valuation_lines_pkey", "unique": true, "method": "btree", "columns": ["id"], "predicate": null, "options": [0], "key_count": 1, "column_count": 1},
     {"name": "project_valuation_lines_valuation_id_boq_line_id_key", "unique": true, "method": "btree", "columns": ["valuation_id", "boq_line_id"], "predicate": null, "options": [0, 0], "key_count": 2, "column_count": 2},
     {"name": "project_valuation_lines_valuation_idx", "unique": false, "method": "btree", "columns": ["valuation_id"], "predicate": null, "options": [0], "key_count": 1, "column_count": 1}
   ],
   "policies": [
     {"command": "*", "permissive": true, "roles": ["authenticated"], "using": "(EXISTS ( SELECT 1\n   FROM (project_valuations v\n     JOIN construction_projects p ON ((p.id = v.project_id)))\n  WHERE ((v.id = project_valuation_lines.valuation_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))", "with_check": "(EXISTS ( SELECT 1\n   FROM (project_valuations v\n     JOIN construction_projects p ON ((p.id = v.project_id)))\n  WHERE ((v.id = project_valuation_lines.valuation_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))"}
   ]},
  {"name": "project_retention_ledger",
   "columns": [
     {"name": "id", "type": "uuid", "not_null": true, "default": "gen_random_uuid()"},
     {"name": "project_id", "type": "uuid", "not_null": true, "default": null},
     {"name": "valuation_id", "type": "uuid", "not_null": false, "default": null},
     {"name": "type", "type": "text", "not_null": true, "default": null},
     {"name": "amount", "type": "numeric(18,2)", "not_null": true, "default": null},
     {"name": "description", "type": "text", "not_null": false, "default": null},
     {"name": "invoice_id", "type": "uuid", "not_null": false, "default": null},
     {"name": "created_by", "type": "uuid", "not_null": true, "default": null},
     {"name": "created_at", "type": "timestamp with time zone", "not_null": true, "default": "now()"}
   ],
   "constraints": [
     {"kind": "c", "columns": ["amount"], "expression": "((amount > (0)::numeric) AND (amount < 'Infinity'::numeric) AND (amount <> 'NaN'::numeric))", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "c", "columns": ["type"], "expression": "(type = ANY (ARRAY['withheld'::text, 'released'::text]))", "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["created_by"], "expression": null, "target": "auth.users", "target_columns": ["id"], "on_delete": "a", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["invoice_id"], "expression": null, "target": "public.invoices", "target_columns": ["id"], "on_delete": "n", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["project_id"], "expression": null, "target": "public.construction_projects", "target_columns": ["id"], "on_delete": "c", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "f", "columns": ["valuation_id"], "expression": null, "target": "public.project_valuations", "target_columns": ["id"], "on_delete": "n", "on_update": "a", "match": "s", "validated": true, "deferrable": false, "initially_deferred": false},
     {"kind": "p", "columns": ["id"], "expression": null, "target": null, "target_columns": null, "on_delete": null, "on_update": null, "match": null, "validated": true, "deferrable": false, "initially_deferred": false}
   ],
   "indexes": [
     {"name": "project_retention_ledger_one_valuation_entry_idx", "unique": true, "method": "btree", "columns": ["valuation_id"], "predicate": "(valuation_id IS NOT NULL)", "options": [0], "key_count": 1, "column_count": 1},
     {"name": "project_retention_ledger_pkey", "unique": true, "method": "btree", "columns": ["id"], "predicate": null, "options": [0], "key_count": 1, "column_count": 1},
     {"name": "project_retention_ledger_project_idx", "unique": false, "method": "btree", "columns": ["project_id"], "predicate": null, "options": [0], "key_count": 1, "column_count": 1},
     {"name": "project_retention_ledger_valuation_idx", "unique": false, "method": "btree", "columns": ["valuation_id"], "predicate": "(valuation_id IS NOT NULL)", "options": [0], "key_count": 1, "column_count": 1}
   ],
   "policies": [
     {"command": "*", "permissive": true, "roles": ["authenticated"], "using": "(EXISTS ( SELECT 1\n   FROM construction_projects p\n  WHERE ((p.id = project_retention_ledger.project_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))", "with_check": "(EXISTS ( SELECT 1\n   FROM construction_projects p\n  WHERE ((p.id = project_retention_ledger.project_id) AND is_business_member(p.business_id) AND (cardinality(construction_procurement_capabilities_for(p.business_id)) > 0))))"}
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
$confirm_existing_construction_valuations$;

CREATE TABLE IF NOT EXISTS public.project_valuations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  valuation_number integer NOT NULL,
  valuation_date date NOT NULL DEFAULT CURRENT_DATE,
  period_start date,
  period_end date,
  gross_amount numeric(18,2) NOT NULL DEFAULT 0,
  retention_amount numeric(18,2) NOT NULL DEFAULT 0,
  net_amount numeric(18,2) NOT NULL DEFAULT 0,
  previous_cumulative numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'invoiced')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, valuation_number),
  CHECK (valuation_number > 0),
  CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
);
COMMENT ON COLUMN public.project_valuations.invoice_id IS
  'Reference to the invoice created by public.create_invoice_with_lines for this valuation.';
CREATE INDEX IF NOT EXISTS project_valuations_project_status_idx
  ON public.project_valuations(project_id, status);
-- The UNIQUE(project_id, valuation_number) constraint supplies the ordered
-- project/number index used for sequential history and number assignment.

CREATE TABLE IF NOT EXISTS public.project_valuation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  valuation_id uuid NOT NULL REFERENCES public.project_valuations(id) ON DELETE CASCADE,
  boq_line_id uuid NOT NULL REFERENCES public.project_boq_lines(id) ON DELETE CASCADE,
  cumulative_pct numeric(5,2) NOT NULL
    CHECK (cumulative_pct >= 0 AND cumulative_pct <= 100),
  cumulative_value numeric(18,2) NOT NULL DEFAULT 0,
  previous_cumulative_value numeric(18,2) NOT NULL DEFAULT 0,
  period_value numeric(18,2) NOT NULL DEFAULT 0,
  notes text,
  UNIQUE (valuation_id, boq_line_id)
);
CREATE INDEX IF NOT EXISTS project_valuation_lines_valuation_idx
  ON public.project_valuation_lines(valuation_id);
CREATE INDEX IF NOT EXISTS project_valuation_lines_boq_line_idx
  ON public.project_valuation_lines(boq_line_id);

CREATE TABLE IF NOT EXISTS public.project_retention_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  valuation_id uuid REFERENCES public.project_valuations(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('withheld', 'released')),
  amount numeric(18,2) NOT NULL CHECK (
    amount > 0 AND amount < 'Infinity'::numeric AND amount <> 'NaN'::numeric
  ),
  description text,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.project_retention_ledger.invoice_id IS
  'Existing Income invoice associated with this retention entry; valuation entries also link through valuation_id.';
CREATE INDEX IF NOT EXISTS project_retention_ledger_project_idx
  ON public.project_retention_ledger(project_id);
CREATE INDEX IF NOT EXISTS project_retention_ledger_valuation_idx
  ON public.project_retention_ledger(valuation_id)
  WHERE valuation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS project_retention_ledger_one_valuation_entry_idx
  ON public.project_retention_ledger(valuation_id)
  WHERE valuation_id IS NOT NULL;

ALTER TABLE public.project_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_valuation_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_retention_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_valuations_member_grants ON public.project_valuations;
CREATE POLICY project_valuations_member_grants
  ON public.project_valuations FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.construction_projects p
       WHERE p.id = project_id
         AND public.is_business_member(p.business_id)
         AND cardinality(public.construction_procurement_capabilities_for(p.business_id)) > 0
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.construction_projects p
       WHERE p.id = project_id
         AND public.is_business_member(p.business_id)
         AND cardinality(public.construction_procurement_capabilities_for(p.business_id)) > 0
    )
  );
DROP POLICY IF EXISTS project_valuation_lines_member_grants ON public.project_valuation_lines;
CREATE POLICY project_valuation_lines_member_grants
  ON public.project_valuation_lines FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.project_valuations v
        JOIN public.construction_projects p ON p.id = v.project_id
       WHERE v.id = valuation_id
         AND public.is_business_member(p.business_id)
         AND cardinality(public.construction_procurement_capabilities_for(p.business_id)) > 0
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.project_valuations v
        JOIN public.construction_projects p ON p.id = v.project_id
       WHERE v.id = valuation_id
         AND public.is_business_member(p.business_id)
         AND cardinality(public.construction_procurement_capabilities_for(p.business_id)) > 0
    )
  );
DROP POLICY IF EXISTS project_retention_ledger_member_grants ON public.project_retention_ledger;
CREATE POLICY project_retention_ledger_member_grants
  ON public.project_retention_ledger FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.construction_projects p
       WHERE p.id = project_id
         AND public.is_business_member(p.business_id)
         AND cardinality(public.construction_procurement_capabilities_for(p.business_id)) > 0
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.construction_projects p
       WHERE p.id = project_id
         AND public.is_business_member(p.business_id)
         AND cardinality(public.construction_procurement_capabilities_for(p.business_id)) > 0
    )
  );

REVOKE ALL ON public.project_valuations, public.project_valuation_lines,
  public.project_retention_ledger FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.project_valuations, public.project_valuation_lines,
  public.project_retention_ledger TO authenticated;

-- One account per construction business. The extra command deliberately leaves
-- provision_construction_defaults untouched. Code 1138 is the first available
-- receivable code in the shipped chart; an existing chart collision is handled
-- by choosing the next free code in the 1138–1199 range.
CREATE OR REPLACE FUNCTION public.provision_construction_coa_accounts(
  p_business_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_models text[];
  v_currency text;
  v_code text;
  v_parent_id uuid;
  v_account_id uuid;
  v_existing_type text;
  v_existing_group boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;

  SELECT b.operating_models, b.base_currency
    INTO v_models, v_currency
    FROM public.businesses b
   WHERE b.id = p_business_id AND b.deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = 'P0002';
  END IF;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator can provision construction accounts.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT ('CONSTRUCTION' = ANY (COALESCE(v_models, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'This business is not configured for construction work.'
      USING ERRCODE = '22023';
  END IF;

  -- Account codes have no database uniqueness constraint. Serialize account
  -- writers while checking/inserting so a concurrent manual COA edit cannot
  -- take the same first-free construction code between those steps.
  LOCK TABLE public.accounts IN SHARE ROW EXCLUSIVE MODE;

  SELECT a.id, a.account_type::text, a.is_group
    INTO v_account_id, v_existing_type, v_existing_group
    FROM public.accounts a
   WHERE a.business_id = p_business_id
     AND lower(btrim(a.name)) = lower('Retention Receivable')
     AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_account_id IS NOT NULL THEN
    IF v_existing_type <> 'asset' OR v_existing_group THEN
      RAISE EXCEPTION 'Retention Receivable must be a posting asset account.' USING ERRCODE = '23514';
    END IF;
    UPDATE public.accounts
       SET account_subtype = 'contra_ar', normal_balance = 'debit', is_active = true,
           updated_at = now()
     WHERE id = v_account_id;
    RETURN v_account_id;
  END IF;

  SELECT codes.code::text INTO v_code
    FROM generate_series(1138, 1199) AS codes(code)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.accounts a
      WHERE a.business_id = p_business_id
        AND btrim(a.code) = codes.code::text
        AND a.deleted_at IS NULL
   )
   ORDER BY codes.code
   LIMIT 1;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'No available account code in the construction receivables range.'
      USING ERRCODE = '22023';
  END IF;

  SELECT a.id INTO v_parent_id
    FROM public.accounts a
   WHERE a.business_id = p_business_id
     AND a.code = '1130'
     AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_parent_id IS NULL THEN
    SELECT a.id INTO v_parent_id
      FROM public.accounts a
     WHERE a.business_id = p_business_id
       AND a.code = '1100'
       AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
  END IF;

  INSERT INTO public.accounts (
    business_id, code, name, description, account_type, account_subtype,
    normal_balance, is_group, is_system, is_bank_account, currency,
    opening_balance, is_active, parent_id
  ) VALUES (
    p_business_id, v_code, 'Retention Receivable',
    'Construction retention withheld by clients; current asset classified separately from trade debtors.',
    'asset', 'contra_ar', 'debit', false, true, false,
    COALESCE(v_currency, 'MWK'), 0, true, v_parent_id
  )
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$;
COMMENT ON FUNCTION public.provision_construction_coa_accounts(uuid) IS
  'Idempotently provisions the construction Retention Receivable account without changing provision_construction_defaults.';
REVOKE ALL ON FUNCTION public.provision_construction_coa_accounts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_construction_coa_accounts(uuid) TO authenticated;

-- Backfill construction businesses that were provisioned before Phase C. This
-- is a migration-owned insert, not a change to the registration bootstrap.
DO $$
DECLARE
  v_business record;
  v_code text;
  v_parent_id uuid;
  v_existing_id uuid;
  v_existing_type text;
  v_existing_group boolean;
BEGIN
  -- Runtime COA edits do not carry a unique constraint on account codes, so
  -- keep the one-time backfill's first-free lookup and insert race-free too.
  LOCK TABLE public.accounts IN SHARE ROW EXCLUSIVE MODE;

  FOR v_business IN
    SELECT b.id, b.base_currency
      FROM public.businesses b
     WHERE b.deleted_at IS NULL
       AND 'CONSTRUCTION' = ANY (COALESCE(b.operating_models, ARRAY[]::text[]))
  LOOP
    SELECT a.id, a.account_type::text, a.is_group
      INTO v_existing_id, v_existing_type, v_existing_group
      FROM public.accounts a
     WHERE a.business_id = v_business.id
       AND lower(btrim(a.name)) = lower('Retention Receivable')
       AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      IF v_existing_type <> 'asset' OR v_existing_group THEN
        RAISE EXCEPTION 'Retention Receivable must be a posting asset account for construction business %.', v_business.id;
      END IF;
      UPDATE public.accounts
         SET account_subtype = 'contra_ar', normal_balance = 'debit', is_active = true,
             updated_at = now()
       WHERE id = v_existing_id;
      CONTINUE;
    END IF;

    SELECT codes.code::text INTO v_code
      FROM generate_series(1138, 1199) AS codes(code)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.accounts a
        WHERE a.business_id = v_business.id
          AND btrim(a.code) = codes.code::text
          AND a.deleted_at IS NULL
     )
     ORDER BY codes.code
     LIMIT 1;
    IF v_code IS NULL THEN
      RAISE EXCEPTION 'No available retention receivable account code for construction business %.', v_business.id;
    END IF;

    SELECT a.id INTO v_parent_id
      FROM public.accounts a
     WHERE a.business_id = v_business.id
       AND a.code = '1130'
       AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
    IF v_parent_id IS NULL THEN
      SELECT a.id INTO v_parent_id
        FROM public.accounts a
       WHERE a.business_id = v_business.id
         AND a.code = '1100'
         AND a.deleted_at IS NULL
       ORDER BY a.created_at, a.id
       LIMIT 1;
    END IF;

    INSERT INTO public.accounts (
      business_id, code, name, description, account_type, account_subtype,
      normal_balance, is_group, is_system, is_bank_account, currency,
      opening_balance, is_active, parent_id
    ) VALUES (
      v_business.id, v_code, 'Retention Receivable',
      'Construction retention withheld by clients; current asset classified separately from trade debtors.',
      'asset', 'contra_ar', 'debit', false, true, false,
      COALESCE(v_business.base_currency, 'MWK'), 0, true, v_parent_id
    );
  END LOOP;
END;
$$;

-- All RPC grant decisions resolve from the caller-bound construction capability
-- function; the browser never supplies an actor or claims it has a grant.
CREATE OR REPLACE FUNCTION public._ledgr_project_valuation_actor(
  p_business_id uuid,
  p_required_capabilities text[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_capabilities text[];
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;

  v_capabilities := public.construction_procurement_capabilities_for(p_business_id);
  IF cardinality(v_capabilities) = 0 THEN
    RAISE EXCEPTION 'Construction procurement access required.' USING ERRCODE = '42501';
  END IF;
  IF cardinality(COALESCE(p_required_capabilities, ARRAY[]::text[])) > 0
     AND NOT (v_capabilities && p_required_capabilities) THEN
    RAISE EXCEPTION 'Not authorized for this construction valuation action.' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;
REVOKE ALL ON FUNCTION public._ledgr_project_valuation_actor(uuid, text[]) FROM PUBLIC, anon, authenticated;

-- Shared server-side calculation for both create and draft update. The request
-- must contain each BOQ line exactly once; all money is rounded to cents before
-- storage so browser previews and the ledger use the same values.
CREATE OR REPLACE FUNCTION public._ledgr_rebuild_project_valuation_lines(
  p_project_id uuid,
  p_valuation_id uuid,
  p_valuation_number integer,
  p_lines jsonb,
  p_notes text
)
RETURNS TABLE(gross_amount numeric, previous_cumulative numeric)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_boq_count bigint;
  v_item jsonb;
  v_line_id uuid;
  v_seen_ids uuid[] := ARRAY[]::uuid[];
  v_pct_raw numeric;
  v_pct numeric;
  v_boq_value numeric;
  v_cumulative_value numeric;
  v_previous_value numeric;
  v_period_value numeric;
  v_gross numeric := 0;
  v_previous_total numeric := 0;
  v_has_negative boolean := false;
BEGIN
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Valuation lines must be a JSON array.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_boq_count
    FROM public.project_boq_lines l
   WHERE l.project_id = p_project_id;
  IF v_boq_count = 0 THEN
    RAISE EXCEPTION 'Add at least one BOQ line before creating a valuation.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines)::bigint <> v_boq_count THEN
    RAISE EXCEPTION 'A valuation must include every BOQ line exactly once.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.project_valuation_lines vl
   WHERE vl.valuation_id = p_valuation_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Each valuation line must be an object.' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_line_id := nullif(v_item->>'boq_line_id', '')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Each valuation line requires a valid BOQ line id.' USING ERRCODE = '22023';
    END;
    IF v_line_id IS NULL OR v_line_id = ANY (v_seen_ids) THEN
      RAISE EXCEPTION 'Each BOQ line must appear exactly once in a valuation.' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_pct_raw := (v_item->>'cumulative_pct')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Cumulative percentage must be a number between 0 and 100.' USING ERRCODE = '22023';
    END;
    IF v_pct_raw IS NULL OR v_pct_raw = 'NaN'::numeric
       OR v_pct_raw < 0 OR v_pct_raw > 100 THEN
      RAISE EXCEPTION 'Cumulative percentage must be between 0 and 100.' USING ERRCODE = '22023';
    END IF;
    v_pct := round(v_pct_raw, 2);

    SELECT l.total_value INTO v_boq_value
      FROM public.project_boq_lines l
     WHERE l.id = v_line_id
       AND l.project_id = p_project_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A BOQ line does not belong to this project.' USING ERRCODE = '22023';
    END IF;

    SELECT vl.cumulative_value
      INTO v_previous_value
      FROM public.project_valuation_lines vl
      JOIN public.project_valuations v ON v.id = vl.valuation_id
     WHERE v.project_id = p_project_id
       AND v.valuation_number < p_valuation_number
       AND vl.boq_line_id = v_line_id
     ORDER BY v.valuation_number DESC
     LIMIT 1;
    v_previous_value := COALESCE(v_previous_value, 0);

    v_cumulative_value := round(v_boq_value * v_pct / 100, 2);
    v_period_value := round(v_cumulative_value - v_previous_value, 2);
    IF v_period_value < 0 THEN
      v_has_negative := true;
    END IF;

    INSERT INTO public.project_valuation_lines (
      valuation_id, boq_line_id, cumulative_pct, cumulative_value,
      previous_cumulative_value, period_value, notes
    ) VALUES (
      p_valuation_id, v_line_id, v_pct, v_cumulative_value,
      v_previous_value, v_period_value, nullif(btrim(v_item->>'notes'), '')
    );

    v_seen_ids := array_append(v_seen_ids, v_line_id);
    v_gross := v_gross + v_period_value;
    v_previous_total := v_previous_total + v_previous_value;
  END LOOP;

  IF cardinality(v_seen_ids)::bigint <> v_boq_count THEN
    RAISE EXCEPTION 'A valuation must include every BOQ line exactly once.' USING ERRCODE = '22023';
  END IF;
  IF v_has_negative AND nullif(btrim(p_notes), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required when a valuation contains a negative period value.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY SELECT round(v_gross, 2), round(v_previous_total, 2);
END;
$$;
REVOKE ALL ON FUNCTION public._ledgr_rebuild_project_valuation_lines(uuid, uuid, integer, jsonb, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._ledgr_project_valuation_payload(p_valuation_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'valuation', to_jsonb(v),
    'lines', COALESCE((
      SELECT jsonb_agg(to_jsonb(vl) ORDER BY b.sort_order, b.line_number, vl.boq_line_id)
        FROM public.project_valuation_lines vl
        JOIN public.project_boq_lines b ON b.id = vl.boq_line_id
       WHERE vl.valuation_id = v.id
    ), '[]'::jsonb),
    'invoice', CASE WHEN i.id IS NULL THEN NULL ELSE
      jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number, 'status', i.status)
    END,
    'retention_entries', COALESCE((
      SELECT jsonb_agg(to_jsonb(r) ORDER BY r.created_at, r.id)
        FROM public.project_retention_ledger r
       WHERE r.valuation_id = v.id
    ), '[]'::jsonb)
  )
    FROM public.project_valuations v
    LEFT JOIN public.invoices i ON i.id = v.invoice_id
   WHERE v.id = p_valuation_id;
$$;
REVOKE ALL ON FUNCTION public._ledgr_project_valuation_payload(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_valuation(
  p_project_id uuid,
  p_valuation_date date,
  p_period_start date,
  p_period_end date,
  p_lines jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.construction_projects%ROWTYPE;
  v_actor uuid;
  v_number integer;
  v_totals record;
  v_retention_amount numeric(18,2);
  v_available_retention numeric(18,2);
  v_retention_type text;
  v_retention_description text;
  v_valuation public.project_valuations%ROWTYPE;
BEGIN
  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = p_project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id,
    ARRAY['procurement.po.manage', 'procurement.master.manage']::text[]
  );
  IF v_project.status <> 'active' THEN
    RAISE EXCEPTION 'Only active projects can have valuations.' USING ERRCODE = '22023';
  END IF;
  IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL
     AND p_period_start > p_period_end THEN
    RAISE EXCEPTION 'Valuation period end must be on or after its start.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_boq_lines l WHERE l.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Add at least one BOQ line before creating a valuation.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.project_valuations v
     WHERE v.project_id = p_project_id AND v.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Submit the existing draft valuation before creating another.' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(max(v.valuation_number), 0) + 1
    INTO v_number
    FROM public.project_valuations v
   WHERE v.project_id = p_project_id;

  INSERT INTO public.project_valuations (
    project_id, valuation_number, valuation_date, period_start, period_end,
    status, notes, created_by
  ) VALUES (
    p_project_id, v_number, COALESCE(p_valuation_date, CURRENT_DATE),
    p_period_start, p_period_end, 'draft', nullif(btrim(p_notes), ''), v_actor
  ) RETURNING * INTO v_valuation;

  SELECT * INTO v_totals
    FROM public._ledgr_rebuild_project_valuation_lines(
      p_project_id, v_valuation.id, v_number, p_lines, p_notes
    );

  v_retention_amount := round(v_totals.gross_amount * v_project.retention_pct / 100, 2);
  IF v_retention_amount < 0 THEN
    SELECT COALESCE(sum(CASE WHEN r.type = 'withheld' THEN r.amount ELSE -r.amount END), 0)
      INTO v_available_retention
      FROM public.project_retention_ledger r
     WHERE r.project_id = p_project_id;
    -- A downward valuation correction can reverse retention that was already
    -- withheld, but cannot release more than the project currently holds.
    v_retention_amount := -least(abs(v_retention_amount), greatest(v_available_retention, 0));
  END IF;

  UPDATE public.project_valuations
     SET gross_amount = v_totals.gross_amount,
         retention_amount = v_retention_amount,
         net_amount = round(v_totals.gross_amount - v_retention_amount, 2),
         previous_cumulative = v_totals.previous_cumulative,
         updated_at = now()
   WHERE id = v_valuation.id
   RETURNING * INTO v_valuation;

  IF v_retention_amount <> 0 THEN
    v_retention_type := CASE WHEN v_retention_amount > 0 THEN 'withheld' ELSE 'released' END;
    v_retention_description := CASE WHEN v_retention_amount > 0
      THEN format('Retention withheld at %s%% for valuation V-%s',
        to_char(v_project.retention_pct, 'FM990.00'), lpad(v_number::text, 3, '0'))
      ELSE format('Retention adjusted for downward correction on valuation V-%s',
        lpad(v_number::text, 3, '0'))
    END;
    INSERT INTO public.project_retention_ledger (
      project_id, valuation_id, type, amount, description, created_by
    ) VALUES (
      p_project_id, v_valuation.id, v_retention_type, abs(v_retention_amount),
      v_retention_description, v_actor
    );
  END IF;

  IF v_number = 1 THEN
    UPDATE public.construction_projects
       SET boq_locked_at = COALESCE(boq_locked_at, now()), updated_at = now()
     WHERE id = p_project_id;
  END IF;

  RETURN public._ledgr_project_valuation_payload(v_valuation.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_valuation(
  p_valuation_id uuid,
  p_valuation_date date,
  p_period_start date,
  p_period_end date,
  p_lines jsonb,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_project public.construction_projects%ROWTYPE;
  v_valuation public.project_valuations%ROWTYPE;
  v_actor uuid;
  v_totals record;
  v_retention_ledger_id uuid;
  v_retention_amount numeric(18,2);
  v_available_retention numeric(18,2);
  v_retention_type text;
  v_retention_description text;
BEGIN
  SELECT v.project_id INTO v_project_id
    FROM public.project_valuations v
   WHERE v.id = p_valuation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valuation not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = v_project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_valuation
    FROM public.project_valuations v
   WHERE v.id = p_valuation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valuation not found.' USING ERRCODE = 'P0002';
  END IF;

  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id,
    ARRAY['procurement.po.manage', 'procurement.master.manage']::text[]
  );
  IF v_valuation.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft valuations can be edited.' USING ERRCODE = '55000';
  END IF;
  IF v_project.status <> 'active' THEN
    RAISE EXCEPTION 'Only active projects can have valuations.' USING ERRCODE = '22023';
  END IF;
  IF p_period_start IS NOT NULL AND p_period_end IS NOT NULL
     AND p_period_start > p_period_end THEN
    RAISE EXCEPTION 'Valuation period end must be on or after its start.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_boq_lines l WHERE l.project_id = v_project.id
  ) THEN
    RAISE EXCEPTION 'Add at least one BOQ line before creating a valuation.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_totals
    FROM public._ledgr_rebuild_project_valuation_lines(
      v_project.id, v_valuation.id, v_valuation.valuation_number, p_lines, p_notes
    );
  v_retention_amount := round(v_totals.gross_amount * v_project.retention_pct / 100, 2);
  IF v_retention_amount < 0 THEN
    SELECT COALESCE(sum(CASE WHEN r.type = 'withheld' THEN r.amount ELSE -r.amount END), 0)
      INTO v_available_retention
      FROM public.project_retention_ledger r
     WHERE r.project_id = v_project.id
       AND r.valuation_id IS DISTINCT FROM v_valuation.id;
    v_retention_amount := -least(abs(v_retention_amount), greatest(v_available_retention, 0));
  END IF;

  UPDATE public.project_valuations
     SET valuation_date = COALESCE(p_valuation_date, CURRENT_DATE),
         period_start = p_period_start,
         period_end = p_period_end,
         gross_amount = v_totals.gross_amount,
         retention_amount = v_retention_amount,
         net_amount = round(v_totals.gross_amount - v_retention_amount, 2),
         previous_cumulative = v_totals.previous_cumulative,
         notes = nullif(btrim(p_notes), ''),
         updated_at = now()
   WHERE id = v_valuation.id
   RETURNING * INTO v_valuation;

  SELECT r.id INTO v_retention_ledger_id
    FROM public.project_retention_ledger r
   WHERE r.valuation_id = v_valuation.id
   FOR UPDATE;
  IF v_retention_amount <> 0 THEN
    v_retention_type := CASE WHEN v_retention_amount > 0 THEN 'withheld' ELSE 'released' END;
    v_retention_description := CASE WHEN v_retention_amount > 0
      THEN format('Retention withheld at %s%% for valuation V-%s',
        to_char(v_project.retention_pct, 'FM990.00'), lpad(v_valuation.valuation_number::text, 3, '0'))
      ELSE format('Retention adjusted for downward correction on valuation V-%s',
        lpad(v_valuation.valuation_number::text, 3, '0'))
    END;
    IF v_retention_ledger_id IS NULL THEN
      INSERT INTO public.project_retention_ledger (
        project_id, valuation_id, type, amount, description, created_by
      ) VALUES (
        v_project.id, v_valuation.id, v_retention_type, abs(v_retention_amount),
        v_retention_description, v_actor
      );
    ELSE
      UPDATE public.project_retention_ledger
         SET type = v_retention_type,
             amount = abs(v_retention_amount),
             description = v_retention_description
       WHERE id = v_retention_ledger_id;
    END IF;
  ELSIF v_retention_ledger_id IS NOT NULL THEN
    DELETE FROM public.project_retention_ledger WHERE id = v_retention_ledger_id;
  END IF;

  RETURN public._ledgr_project_valuation_payload(v_valuation.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_valuation(p_valuation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valuation public.project_valuations%ROWTYPE;
  v_business_id uuid;
  v_actor uuid;
BEGIN
  SELECT * INTO v_valuation
    FROM public.project_valuations v
   WHERE v.id = p_valuation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valuation not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT p.business_id INTO v_business_id
    FROM public.construction_projects p
   WHERE p.id = v_valuation.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_project_valuation_actor(
    v_business_id, ARRAY['procurement.master.manage']::text[]
  );
  IF v_valuation.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft valuations can be submitted.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.project_valuations
     SET status = 'submitted', updated_at = now()
   WHERE id = v_valuation.id;
  RETURN public._ledgr_project_valuation_payload(v_valuation.id);
END;
$$;

-- Resolve an existing customer contact by name, or create one using the same
-- contacts table the Income invoice builder requires. The project stores a
-- client display name, whereas invoices require a contact_id.
CREATE OR REPLACE FUNCTION public._ledgr_construction_billing_contact(
  p_business_id uuid,
  p_client_name text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id uuid;
BEGIN
  SELECT c.id INTO v_contact_id
    FROM public.contacts c
   WHERE c.business_id = p_business_id
     AND lower(btrim(c.name)) = lower(btrim(p_client_name))
     AND c.contact_type IN ('customer', 'both')
     AND c.is_active
     AND c.deleted_at IS NULL
   ORDER BY c.created_at, c.id
   LIMIT 1;
  IF v_contact_id IS NOT NULL THEN
    RETURN v_contact_id;
  END IF;

  INSERT INTO public.contacts (
    business_id, name, contact_type, is_active, wht_exempt, notes
  ) VALUES (
    p_business_id, btrim(p_client_name), 'customer', true, false,
    'Created automatically from construction project billing.'
  ) RETURNING id INTO v_contact_id;
  RETURN v_contact_id;
END;
$$;
REVOKE ALL ON FUNCTION public._ledgr_construction_billing_contact(uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_invoice_from_valuation(p_valuation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valuation public.project_valuations%ROWTYPE;
  v_project public.construction_projects%ROWTYPE;
  v_actor uuid;
  v_contact_id uuid;
  v_currency text;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_retention_account_id uuid;
  v_credit_note_for uuid;
  v_invoice_type text;
  v_invoice_header jsonb;
  v_invoice_lines jsonb;
  v_invoice_result jsonb;
  v_invoice_id uuid;
  v_invoice_number text;
BEGIN
  SELECT * INTO v_valuation
    FROM public.project_valuations v
   WHERE v.id = p_valuation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valuation not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = v_valuation.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id, ARRAY['procurement.master.manage']::text[]
  );

  -- An idempotent replay returns the committed invoice instead of creating a
  -- second invoice after a browser timeout.
  IF v_valuation.status = 'invoiced' AND v_valuation.invoice_id IS NOT NULL THEN
    RETURN public._ledgr_project_valuation_payload(v_valuation.id);
  END IF;
  IF v_valuation.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted valuations can generate an invoice.' USING ERRCODE = '55000';
  END IF;

  v_contact_id := public._ledgr_construction_billing_contact(
    v_project.business_id, v_project.client_name
  );
  SELECT b.base_currency INTO v_currency
    FROM public.businesses b
   WHERE b.id = v_project.business_id;
  v_currency := COALESCE(v_currency, 'MWK');

  SELECT a.id INTO v_ar_account_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND a.code = '1131'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Trade Debtors account 1131 is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;
  SELECT a.id INTO v_revenue_account_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND a.code = '4114'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_revenue_account_id IS NULL THEN
    SELECT a.id INTO v_revenue_account_id
      FROM public.accounts a
     WHERE a.business_id = v_project.business_id
       AND a.code = '4112'
       AND a.is_active AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
  END IF;
  IF v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Contract Revenue account is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;

  SELECT a.id INTO v_retention_account_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND lower(btrim(a.name)) = lower('Retention Receivable')
     AND a.account_subtype = 'contra_ar'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_retention_account_id IS NULL THEN
    RAISE EXCEPTION 'Retention Receivable is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'line_number', q.line_number,
      'description', q.description || format(' (Valuation V-%s, %s%% complete)',
        lpad(v_valuation.valuation_number::text, 3, '0'),
        trim(to_char(q.cumulative_pct, 'FM990.00'))),
      'quantity', 1,
      'unit_price', abs(q.period_value),
      'discount_percent', 0,
      'discount_amount', 0,
      'line_subtotal', q.period_value,
      'tax_code', 'none',
      'tax_rate', 0,
      'tax_amount', 0,
      'line_total', q.period_value,
      'product_id', NULL,
      'account_id', v_revenue_account_id
    ) ORDER BY q.line_number), '[]'::jsonb)
    INTO v_invoice_lines
    FROM (
      SELECT row_number() OVER (ORDER BY b.sort_order, b.line_number, b.id)::integer AS line_number,
             b.description,
             vl.cumulative_pct,
             vl.period_value
        FROM public.project_valuation_lines vl
        JOIN public.project_boq_lines b ON b.id = vl.boq_line_id
       WHERE vl.valuation_id = v_valuation.id
         AND vl.period_value <> 0
    ) q;

  -- Invoice line quantity and unit_price stay non-negative per the existing
  -- Income schema. Signed period values are carried by line_subtotal/line_total.
  -- Retention is a separate signed deduction using the provisioned Retention
  -- Receivable account. A net-negative valuation becomes an existing-system
  -- credit_note: its signed per-account line values are inverted, so their net
  -- is positive while the existing revenue header totals remain negative.
  IF v_valuation.retention_amount <> 0 THEN
    v_invoice_lines := v_invoice_lines || jsonb_build_array(jsonb_build_object(
      'line_number', jsonb_array_length(v_invoice_lines) + 1,
      'description', CASE WHEN v_valuation.retention_amount > 0
        THEN format('Retention withheld (%s%%)', to_char(v_project.retention_pct, 'FM990.00'))
        ELSE 'Retention adjustment for downward valuation correction'
      END,
      'quantity', 1,
      'unit_price', abs(v_valuation.retention_amount),
      'discount_percent', 0,
      'discount_amount', 0,
      'line_subtotal', -v_valuation.retention_amount,
      'tax_code', 'none',
      'tax_rate', 0,
      'tax_amount', 0,
      'line_total', -v_valuation.retention_amount,
      'product_id', NULL,
      'account_id', v_retention_account_id
    ));
  END IF;

  IF v_valuation.net_amount < 0 THEN
    v_invoice_type := 'credit_note';
    SELECT prior.invoice_id INTO v_credit_note_for
      FROM public.project_valuations prior
     WHERE prior.project_id = v_project.id
       AND prior.valuation_number < v_valuation.valuation_number
       AND prior.invoice_id IS NOT NULL
     ORDER BY prior.valuation_number DESC
     LIMIT 1;
    -- Keep the per-account construction breakdown (including Retention
    -- Receivable) and invert its signed amounts into the existing credit-note
    -- convention: positive line values are debits, negative values are credits.
    SELECT COALESCE(jsonb_agg(
        jsonb_set(
          jsonb_set(value, '{line_subtotal}', to_jsonb(-((value->>'line_subtotal')::numeric))),
          '{line_total}', to_jsonb(-((value->>'line_total')::numeric))
        ) ORDER BY (value->>'line_number')::integer
      ), '[]'::jsonb)
      INTO v_invoice_lines
      FROM jsonb_array_elements(v_invoice_lines) AS item(value);
  ELSE
    v_invoice_type := 'invoice';
    v_credit_note_for := NULL;
  END IF;

  IF jsonb_array_length(v_invoice_lines) = 0 THEN
    RAISE EXCEPTION 'A zero-value valuation cannot generate an invoice.' USING ERRCODE = '22023';
  END IF;

  v_invoice_header := jsonb_build_object(
    'business_id', v_project.business_id,
    'invoice_type', v_invoice_type,
    'credit_note_for', v_credit_note_for,
    'status', 'draft',
    'contact_id', v_contact_id,
    'issue_date', v_valuation.valuation_date,
    'due_date', NULL,
    'currency', v_currency,
    'exchange_rate', 1,
    'original_currency', v_currency,
    'original_amount', v_valuation.net_amount,
    'functional_currency', v_currency,
    'functional_amount', v_valuation.net_amount,
    'rate_date', v_valuation.valuation_date,
    'rate_is_stale', false,
    'subtotal', v_valuation.net_amount,
    'discount_amount', 0,
    'discount_percent', 0,
    'taxable_amount', v_valuation.net_amount,
    'vat_amount', 0,
    'wht_amount', 0,
    'total_amount', v_valuation.net_amount,
    'amount_due', v_valuation.net_amount,
    'amount_paid', 0,
    'ar_account_id', v_ar_account_id,
    'revenue_account_id', v_revenue_account_id,
    'notes', concat('Construction project ', v_project.name, ' — valuation V-', lpad(v_valuation.valuation_number::text, 3, '0'),
      CASE WHEN nullif(btrim(v_valuation.notes), '') IS NULL THEN '' ELSE E'\n' || btrim(v_valuation.notes) END),
    'project_code', v_project.id::text,
    'template', 'professional',
    'created_by', v_actor::text
  );

  -- This invokes the existing atomic Income invoice command. It handles the
  -- invoice number, header, lines, RLS boundary, and client-key replay.
  v_invoice_result := public.create_invoice_with_lines(
    v_invoice_header, v_invoice_lines, v_valuation.id
  );
  v_invoice_id := (v_invoice_result->'invoice'->>'id')::uuid;
  v_invoice_number := v_invoice_result->'invoice'->>'invoice_number';
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'The existing invoice command returned no invoice.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.project_valuations
     SET invoice_id = v_invoice_id, status = 'invoiced', updated_at = now()
   WHERE id = v_valuation.id;
  UPDATE public.project_retention_ledger
     SET invoice_id = v_invoice_id
   WHERE valuation_id = v_valuation.id;
  RETURN public._ledgr_project_valuation_payload(v_valuation.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_retention(
  p_project_id uuid,
  p_amount numeric,
  p_description text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.construction_projects%ROWTYPE;
  v_actor uuid;
  v_total_withheld numeric(18,2);
  v_total_released numeric(18,2);
  v_balance numeric(18,2);
  v_release_amount numeric(18,2);
  v_contact_id uuid;
  v_currency text;
  v_trade_debtors_id uuid;
  v_retention_account_id uuid;
  v_ledger_entry public.project_retention_ledger%ROWTYPE;
  v_invoice_header jsonb;
  v_invoice_lines jsonb;
  v_invoice_result jsonb;
  v_invoice_id uuid;
  v_invoice_number text;
BEGIN
  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = p_project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id, ARRAY['procurement.exception.authorize']::text[]
  );
  IF v_project.status NOT IN ('practical_completion', 'defect_liability', 'closed') THEN
    RAISE EXCEPTION 'Retention can only be released at practical completion or later.' USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric) OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Retention release amount must be greater than zero.' USING ERRCODE = '22023';
  END IF;
  v_release_amount := round(p_amount, 2);
  IF v_release_amount <= 0 THEN
    RAISE EXCEPTION 'Retention release amount must be at least one cent.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_description), '') IS NULL THEN
    RAISE EXCEPTION 'A description is required for a retention release.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(sum(r.amount) FILTER (WHERE r.type = 'withheld'), 0),
         COALESCE(sum(r.amount) FILTER (WHERE r.type = 'released'), 0)
    INTO v_total_withheld, v_total_released
    FROM public.project_retention_ledger r
   WHERE r.project_id = p_project_id;
  v_balance := v_total_withheld - v_total_released;
  IF v_balance < v_release_amount THEN
    RAISE EXCEPTION 'Retention release exceeds the balance held.' USING ERRCODE = '22023';
  END IF;

  SELECT a.id INTO v_trade_debtors_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND a.code = '1131'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_trade_debtors_id IS NULL THEN
    RAISE EXCEPTION 'Trade Debtors account 1131 is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;
  SELECT a.id INTO v_retention_account_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND lower(btrim(a.name)) = lower('Retention Receivable')
     AND a.account_subtype = 'contra_ar'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_retention_account_id IS NULL THEN
    RAISE EXCEPTION 'Retention Receivable is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.project_retention_ledger (
    project_id, valuation_id, type, amount, description, created_by
  ) VALUES (
    p_project_id, NULL, 'released', v_release_amount, btrim(p_description), v_actor
  ) RETURNING * INTO v_ledger_entry;

  v_contact_id := public._ledgr_construction_billing_contact(
    v_project.business_id, v_project.client_name
  );
  SELECT b.base_currency INTO v_currency
    FROM public.businesses b
   WHERE b.id = v_project.business_id;
  v_currency := COALESCE(v_currency, 'MWK');

  v_invoice_lines := jsonb_build_array(jsonb_build_object(
    'line_number', 1,
    'description', 'Retention release — ' || btrim(p_description),
    'quantity', 1,
    'unit_price', v_release_amount,
    'discount_percent', 0,
    'discount_amount', 0,
    'line_subtotal', v_release_amount,
    'tax_code', 'none',
    'tax_rate', 0,
    'tax_amount', 0,
    'line_total', v_release_amount,
    'product_id', NULL,
    'account_id', v_retention_account_id
  ));
  v_invoice_header := jsonb_build_object(
    'business_id', v_project.business_id,
    'invoice_type', 'invoice',
    'status', 'draft',
    'contact_id', v_contact_id,
    'issue_date', CURRENT_DATE,
    'due_date', NULL,
    'currency', v_currency,
    'exchange_rate', 1,
    'original_currency', v_currency,
    'original_amount', v_release_amount,
    'functional_currency', v_currency,
    'functional_amount', v_release_amount,
    'rate_date', CURRENT_DATE,
    'rate_is_stale', false,
    'subtotal', v_release_amount,
    'discount_amount', 0,
    'discount_percent', 0,
    'taxable_amount', v_release_amount,
    'vat_amount', 0,
    'wht_amount', 0,
    'total_amount', v_release_amount,
    'amount_due', v_release_amount,
    'amount_paid', 0,
    'ar_account_id', v_trade_debtors_id,
    -- The existing Income posting command credits this account when the
    -- release invoice is issued, reclassifying the held amount to trade AR.
    'revenue_account_id', v_retention_account_id,
    'notes', concat('Construction project ', v_project.name, ' — retention release: ', btrim(p_description)),
    'project_code', v_project.id::text,
    'template', 'professional',
    'created_by', v_actor::text
  );

  v_invoice_result := public.create_invoice_with_lines(
    v_invoice_header, v_invoice_lines, v_ledger_entry.id
  );
  v_invoice_id := (v_invoice_result->'invoice'->>'id')::uuid;
  v_invoice_number := v_invoice_result->'invoice'->>'invoice_number';
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'The existing invoice command returned no retention invoice.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.project_retention_ledger
     SET invoice_id = v_invoice_id
   WHERE id = v_ledger_entry.id
   RETURNING * INTO v_ledger_entry;

  RETURN jsonb_build_object(
    'retention_entry', to_jsonb(v_ledger_entry),
    'invoice', jsonb_build_object(
      'id', v_invoice_id,
      'invoice_number', v_invoice_number,
      'status', v_invoice_result->'invoice'->>'status'
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_valuation_history(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
BEGIN
  SELECT p.business_id INTO v_business_id
    FROM public.construction_projects p
   WHERE p.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._ledgr_project_valuation_actor(v_business_id, NULL);

  RETURN jsonb_build_object(
    'valuations', COALESCE((
      SELECT jsonb_agg(public._ledgr_project_valuation_payload(v.id) ORDER BY v.valuation_number)
        FROM public.project_valuations v
       WHERE v.project_id = p_project_id
    ), '[]'::jsonb),
    'retention_entries', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(r) || jsonb_build_object(
          'invoice', CASE WHEN i.id IS NULL THEN NULL ELSE
            jsonb_build_object('id', i.id, 'invoice_number', i.invoice_number, 'status', i.status)
          END
        ) ORDER BY r.created_at, r.id
      )
        FROM public.project_retention_ledger r
        LEFT JOIN public.invoices i ON i.id = r.invoice_id
       WHERE r.project_id = p_project_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_retention_summary(p_project_id uuid)
RETURNS TABLE(
  total_withheld numeric,
  total_released numeric,
  balance_held numeric,
  retention_pct numeric,
  can_release boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project public.construction_projects%ROWTYPE;
  v_withheld numeric(18,2);
  v_released numeric(18,2);
  v_balance numeric(18,2);
BEGIN
  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = p_project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._ledgr_project_valuation_actor(v_project.business_id, NULL);

  SELECT COALESCE(sum(r.amount) FILTER (WHERE r.type = 'withheld'), 0),
         COALESCE(sum(r.amount) FILTER (WHERE r.type = 'released'), 0)
    INTO v_withheld, v_released
    FROM public.project_retention_ledger r
   WHERE r.project_id = p_project_id;
  v_balance := v_withheld - v_released;

  RETURN QUERY SELECT
    v_withheld::numeric,
    v_released::numeric,
    v_balance::numeric,
    v_project.retention_pct::numeric,
    (v_project.status IN ('practical_completion', 'defect_liability', 'closed') AND v_balance > 0);
END;
$$;

DO $$
DECLARE
  v_table text;
  v_function text;
  v_definition text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'public.project_valuations',
    'public.project_valuation_lines',
    'public.project_retention_ledger'
  ] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_table::regclass)
       OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = v_table::regclass)
       OR has_table_privilege('authenticated', v_table, 'INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'Valuation RLS/command boundary missing for %.', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.project_valuations'::regclass
       AND c.conname = 'project_valuations_invoice_id_fkey'
       AND c.confrelid = 'public.invoices'::regclass
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.project_retention_ledger'::regclass
       AND c.conname = 'project_retention_ledger_invoice_id_fkey'
       AND c.confrelid = 'public.invoices'::regclass
  ) THEN
    RAISE EXCEPTION 'Valuation or retention invoice reference is not linked to the existing invoices table.';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.provision_construction_coa_accounts(uuid)',
    'public.create_valuation(uuid,date,date,date,jsonb,text)',
    'public.update_valuation(uuid,date,date,date,jsonb,text)',
    'public.submit_valuation(uuid)',
    'public.generate_invoice_from_valuation(uuid)',
    'public.release_retention(uuid,numeric,text)',
    'public.get_valuation_history(uuid)',
    'public.get_retention_summary(uuid)'
  ] LOOP
    IF to_regprocedure(v_function) IS NULL THEN
      RAISE EXCEPTION 'Required construction billing RPC % is missing.', v_function;
    END IF;
  END LOOP;

  v_definition := lower(pg_get_functiondef('public.provision_construction_coa_accounts(uuid)'::regprocedure));
  IF position('generate_series(1138, 1199)' IN v_definition) = 0
     OR position('for update' IN v_definition) = 0
     OR position('contra_ar' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Retention Receivable provisioning must select a locked, first-free code in the 1138–1199 range.';
  END IF;

  v_definition := lower(pg_get_functiondef('public._ledgr_rebuild_project_valuation_lines(uuid,uuid,integer,jsonb,text)'::regprocedure));
  IF position('round(v_boq_value * v_pct / 100, 2)' IN v_definition) = 0
     OR position('v_period_value := round(v_cumulative_value - v_previous_value, 2)' IN v_definition) = 0
     OR position('negative period value' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Cumulative/period valuation math or negative-value reason check is missing.';
  END IF;

  v_definition := lower(pg_get_functiondef('public.create_valuation(uuid,date,date,date,jsonb,text)'::regprocedure));
  IF position('boq_locked_at' IN v_definition) = 0
     OR position('v_number = 1' IN v_definition) = 0
     OR position('submit the existing draft valuation before creating another' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'The first valuation BOQ lock or one-draft sequencing guard is missing.';
  END IF;
  v_definition := lower(pg_get_functiondef('public.update_valuation(uuid,date,date,date,jsonb,text)'::regprocedure));
  IF position('only draft valuations can be edited' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Draft-only valuation update enforcement is missing.';
  END IF;
  v_definition := lower(pg_get_functiondef('public.generate_invoice_from_valuation(uuid)'::regprocedure));
  IF position('create_invoice_with_lines' IN v_definition) = 0
     OR position('credit_note' IN v_definition) = 0
     OR position('v_retention_account_id' IN v_definition) = 0
     OR position('only submitted valuations can generate an invoice' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Valuation invoicing does not use the existing atomic invoice command.';
  END IF;
  v_definition := lower(pg_get_functiondef('public.release_retention(uuid,numeric,text)'::regprocedure));
  IF position('practical_completion' IN v_definition) = 0
     OR position('defect_liability' IN v_definition) = 0
     OR position('closed' IN v_definition) = 0
     OR position('v_balance < v_release_amount' IN v_definition) = 0
     OR position('create_invoice_with_lines' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Retention status, balance or existing-invoice checks are missing.';
  END IF;

  -- Deterministic smoke math: BOQ 500 at 75% = 375; prior 200 gives 175;
  -- 10% retention = 17.50 and net = 157.50. A 40% correction is -175.
  IF round(500::numeric * 75 / 100, 2) <> 375
     OR round(round(500::numeric * 75 / 100, 2) - 200, 2) <> 175
     OR round(175::numeric * 10 / 100, 2) <> 17.50
     OR round(175 - round(175::numeric * 10 / 100, 2), 2) <> 157.50
     OR round(round(500::numeric * 40 / 100, 2) - 375, 2) <> -175 THEN
    RAISE EXCEPTION 'Construction valuation arithmetic self-check failed.';
  END IF;
END;
$$;

DO $$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'create_valuation(uuid,date,date,date,jsonb,text)',
    'update_valuation(uuid,date,date,date,jsonb,text)',
    'submit_valuation(uuid)',
    'generate_invoice_from_valuation(uuid)',
    'release_retention(uuid,numeric,text)',
    'get_valuation_history(uuid)',
    'get_retention_summary(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', v_function);
  END LOOP;
END;
$$;
