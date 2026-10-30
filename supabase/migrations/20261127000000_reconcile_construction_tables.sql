-- Schema reconciliation based on origin/main 0e2d5a080db56888c08f4ab036a5e44e41c42d1e
-- Live read-only discovery: Supabase project Ledgr (hsuhuvuxfuufrlejsatw), 2026-10-30.
-- No application queries or generated types reference the eight project_* tables
-- below; all were observed empty. Do not drop them if any row appears before this
-- migration runs. construction_sites is deliberately preserved as a legacy table.

-- SECTION 1: Tables to create (genuinely missing)
-- None. Current app queries are served by the existing construction_* tables.

-- SECTION 2: Columns to add to existing tables
-- None. The live canonical tables already expose the columns used by origin/main.

-- SECTION 3: Views for compatibility
-- None. No current app query uses the parallel project_* table names.

-- SECTION 4: Remove only the confirmed unused, parallel tables if they are still
-- empty and have no foreign-key references from outside this exact candidate set.
-- Counts are rechecked at execution time; any data means every candidate is kept.
-- DROP TABLE uses IF EXISTS and RESTRICT (no CASCADE). A dependency failure rolls
-- the whole drop sub-block back and leaves the tables in place.

DO $reconcile_construction_tables$
DECLARE
  v_candidates text[] := ARRAY[
    'project_purchase_orders',
    'project_purchase_order_lines',
    'project_goods_receipts',
    'project_goods_receipt_lines',
    'project_material_issues',
    'project_material_issue_lines',
    'project_material_returns',
    'project_material_return_lines'
  ];
  v_name text;
  v_rel regclass;
  v_rows bigint;
  v_any_rows boolean := false;
  v_bad_rls boolean := false;
  v_external_fk boolean := false;
  v_unprotected text;
  v_relation regclass;
BEGIN
  -- SECTION 5: RLS and grants validation (no pre-existing schemas or policies
  -- are changed). All public construction/project/BOQ/payment/MRP/subcontract
  -- tables must continue to have RLS enabled.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_unprotected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind IN ('r', 'p')
     AND (
       left(c.relname, 12) = 'construction_'
       OR left(c.relname, 8) = 'project_'
       OR left(c.relname, 4) = 'boq_'
       OR left(c.relname, 8) = 'payment_'
       OR left(c.relname, 4) = 'mrp_'
       OR left(c.relname, 11) = 'subcontract'
     )
     AND NOT c.relrowsecurity;

  IF v_unprotected IS NOT NULL THEN
    RAISE EXCEPTION 'RLS is disabled on scoped table(s): %', v_unprotected;
  END IF;

  -- Canonical construction registers are read-only to authenticated clients;
  -- their writes are owned by narrowly scoped RPCs. The legacy construction_sites
  -- table is excluded here and intentionally left untouched (see reconciliation
  -- notes); it has a separate historical policy/grant shape.
  FOR v_relation IN
    SELECT c.oid::regclass
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND left(c.relname, 12) = 'construction_'
       AND c.relname <> 'construction_sites'
  LOOP
    IF NOT has_table_privilege('authenticated', v_relation, 'SELECT') THEN
      RAISE EXCEPTION 'Authenticated SELECT grant is missing on %', v_relation;
    END IF;
    IF has_table_privilege('anon', v_relation, 'SELECT')
       OR has_table_privilege('anon', v_relation, 'INSERT')
       OR has_table_privilege('anon', v_relation, 'UPDATE')
       OR has_table_privilege('anon', v_relation, 'DELETE')
       OR has_table_privilege('authenticated', v_relation, 'INSERT')
       OR has_table_privilege('authenticated', v_relation, 'UPDATE')
       OR has_table_privilege('authenticated', v_relation, 'DELETE') THEN
      RAISE EXCEPTION 'Unexpected direct anon/authenticated write or anon read grant on %', v_relation;
    END IF;
  END LOOP;

  -- Runtime safety check: count(*) on every candidate before any drop.
  FOREACH v_name IN ARRAY v_candidates LOOP
    v_rel := to_regclass(format('public.%I', v_name));
    IF v_rel IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %s', v_rel) INTO v_rows;
      RAISE NOTICE 'Reconciliation preflight: %.% row(s)', v_name, v_rows;
      IF v_rows > 0 THEN
        v_any_rows := true;
      END IF;

      SELECT NOT c.relrowsecurity
        INTO v_bad_rls
        FROM pg_class c
       WHERE c.oid = v_rel;
      IF coalesce(v_bad_rls, true) THEN
        RAISE NOTICE 'Skipping cleanup: % is missing RLS; review it manually.', v_name;
        RETURN;
      END IF;
    END IF;
  END LOOP;

  IF v_any_rows THEN
    RAISE NOTICE 'Skipping cleanup: at least one candidate contains data. No candidate table was dropped.';
    RETURN;
  END IF;

  -- Keep the cleanup independent of any unreviewed external FK consumer.
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid IN (
         SELECT to_regclass(format('public.%I', u.table_name))
           FROM unnest(v_candidates) AS u(table_name)
          WHERE to_regclass(format('public.%I', u.table_name)) IS NOT NULL
       )
       AND NOT EXISTS (
         SELECT 1
           FROM unnest(v_candidates) AS u(table_name)
          WHERE to_regclass(format('public.%I', u.table_name)) = c.conrelid
       )
  ) INTO v_external_fk;

  IF v_external_fk THEN
    RAISE NOTICE 'Skipping cleanup: an external foreign key references a candidate table.';
    RETURN;
  END IF;

  BEGIN
    DROP TABLE IF EXISTS
      public.project_goods_receipt_lines,
      public.project_material_issue_lines,
      public.project_material_return_lines,
      public.project_purchase_order_lines,
      public.project_goods_receipts,
      public.project_material_issues,
      public.project_material_returns,
      public.project_purchase_orders
    RESTRICT;
    RAISE NOTICE 'Dropped the eight empty, unused parallel project_* tables.';
  EXCEPTION
    WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'Skipping cleanup: a database dependency exists; no candidate table was dropped.';
  END;
END
$reconcile_construction_tables$;
