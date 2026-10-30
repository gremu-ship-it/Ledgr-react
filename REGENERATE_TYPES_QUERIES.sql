-- Live schema/type discovery helpers for Supabase SQL Editor.
-- Target inspected read-only: hsuhuvuxfuufrlejsatw (Ledgr). No SQL here changes schema or data.
-- Save each result set with headers. These queries are an inspection aid, not a substitute
-- for `supabase gen types typescript`, because the generated type also encodes relationships,
-- views, enum aliases, functions, and nullable Insert/Update properties.

-- Recommended workflow:
-- A) Prefer official CLI generation after confirming the target project and CLI version:
--      supabase gen types typescript --project-id hsuhuvuxfuufrlejsatw --schema public > /tmp/database.generated.ts
--    Compare that output with src/dal/types/database.generated.ts and review the diff before
--    replacing any tracked file. This task does not modify TypeScript.
-- B) If CLI access is unavailable, save the query outputs below and use them to reconcile table
--    Row/Insert/Update types, views, enums, function Args/Returns, and FK Relationships manually.
--    Do not infer Postgres nullability or relationship metadata from column names alone.
-- C) A supported Supabase Management API types-generation endpoint may be used by an authorized
--    automation, if enabled for the project. Use the official current API documentation and keep
--    credentials outside SQL, source files, and chat; compare the result with CLI output.
-- The repository snapshot currently has 135 public table types while the inspected live schema
-- has 148 public base tables and 23 views. The 13 live tables missing generated types are listed
-- in NAMING_AUDIT.md; the app directly queries three of those. The app also calls RPCs missing
-- from the generated Functions typing even though those functions exist in the live catalog.

-- 1. Public base tables and views: exact columns, SQL types, nullability, defaults, ordinal order.
SELECT t.table_type,
       t.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.column_default
  FROM information_schema.tables t
  JOIN information_schema.columns c
    ON c.table_schema = t.table_schema
   AND c.table_name = t.table_name
 WHERE t.table_schema = 'public'
   AND t.table_type IN ('BASE TABLE', 'VIEW')
 ORDER BY t.table_type, t.table_name, c.ordinal_position;

-- 2. Public function/procedure signatures and execution characteristics.
-- pg_get_function_arguments preserves defaults/modes; identity arguments help distinguish overloads.
SELECT p.proname,
       p.prokind,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_function_arguments(p.oid) AS args_with_defaults,
       pg_get_function_result(p.oid) AS returns,
       p.prosecdef AS security_definer,
       p.provolatile AS volatility,
       p.proacl AS acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.prokind IN ('f', 'p')
 ORDER BY p.proname, identity_args;

-- 3. Enum types and ordered labels.
SELECT n.nspname AS schema_name,
       t.typname,
       e.enumlabel,
       e.enumsortorder
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE n.nspname = 'public'
 ORDER BY t.typname, e.enumsortorder;

-- 4. Foreign-key relationships needed for generated `Relationships` entries.
SELECT tc.table_name AS source_table,
       kcu.column_name AS source_column,
       ccu.table_schema AS target_schema,
       ccu.table_name AS target_table,
       ccu.column_name AS target_column,
       tc.constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_schema = tc.constraint_schema
   AND kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema = tc.table_schema
   AND kcu.table_name = tc.table_name
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_schema = tc.constraint_schema
   AND ccu.constraint_name = tc.constraint_name
 WHERE tc.constraint_type = 'FOREIGN KEY'
   AND tc.table_schema = 'public'
 ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position;
