-- ============================================================================
-- Ledgr — Phase 8A.1 — READ-ONLY STAGING SCHEMA CAPTURE QUERIES
-- ============================================================================
-- This file is the exact read-only query set issued by the capture tooling.
-- Each query is preceded by a `-- @artifact <name>` marker; the artifact name
-- is the output file name under artifacts/database/capture/ (without extension).
--
-- Consumers:
--   1. scripts/database/capture-staging-schema.sh            (psql transport)
--   2. scripts/database/capture-staging-schema-via-api.sh    (Management API)
--
-- The file contains ONLY SELECT / SHOW / pg_get_*def statements. There is no
-- DDL, no DML, and nothing here writes to the database.
--
-- Run interactively (never against production):
--   psql "$STAGING_SUPABASE_DB_URL" -f scripts/database/capture-staging-schema.sql
-- ============================================================================

-- @artifact server_version
show server_version;

-- @artifact schemas
select nspname
from pg_namespace
where nspname not like 'pg_%' and nspname <> 'information_schema'
order by 1;

-- @artifact extensions
select e.extname, e.extversion, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
order by 1;

-- @artifact enums
select t.typname, string_agg(e.enumlabel, E'\n  ' order by e.enumsortorder)
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname order by 1;

-- @artifact domains
select d.typname, pg_get_userbyid(d.typowner), format_type(d.typbasetype, d.typtypmod), d.typnotnull, d.typdefault
from pg_type d
join pg_namespace n on n.oid = d.typnamespace
where d.typtype = 'd' and n.nspname = 'public'
order by 1;

-- @artifact tables
select c.relname,
       a.attname,
       format_type(a.atttypid, a.atttypmod),
       a.attnotnull,
       pg_get_expr(ad.adbin, ad.adrelid) as default_expr,
       a.attidentity,
       a.attgenerated
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
where c.relkind in ('r','p') and n.nspname = 'public'
order by c.relname, a.attnum;

-- @artifact generated_columns
select c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
where c.relkind in ('r','p') and n.nspname = 'public' and a.attgenerated <> ''
order by 1, 2;

-- @artifact identity_columns
select c.relname, a.attname, a.attidentity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where c.relkind in ('r','p') and n.nspname = 'public' and a.attidentity <> ''
order by 1, 2;

-- @artifact primary_keys
select tc.table_name, kcu.column_name, kcu.ordinal_position
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
order by tc.table_name, kcu.ordinal_position;

-- @artifact foreign_keys
select pg_get_constraintdef(oid), conrelid::regclass::text, confrelid::regclass::text
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by conname;

-- @artifact unique_constraints
select pg_get_constraintdef(oid), conrelid::regclass::text
from pg_constraint
where contype = 'u' and connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

-- @artifact check_constraints
select pg_get_constraintdef(oid), conrelid::regclass::text
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

-- @artifact indexes
select i.relname, pg_get_indexdef(ix.indexrelid)
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
order by i.relname;

-- @artifact sequences
select s.relname, format_type(t.typbasetype, t.typtypmod)
from pg_class s
join pg_namespace n on n.oid = s.relnamespace
join pg_type t on t.oid = s.reltype
where s.relkind = 'S' and n.nspname = 'public'
order by 1;

-- @artifact views
select c.relname, pg_get_viewdef(c.oid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public'
order by 1;

-- @artifact matviews
select c.relname, pg_get_viewdef(c.oid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'm' and n.nspname = 'public'
order by 1;

-- @artifact functions
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       p.provolatile::text, p.prosecdef::text, pg_get_userbyid(p.proowner),
       p.proconfig, pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- @artifact triggers
select t.tgname, c.relname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
order by c.relname, t.tgname;

-- @artifact rls
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and n.nspname = 'public'
order by 1;

-- @artifact policies
-- NOTE: pg_policies.qual / with_check are already text (PG >= 14); using
-- pg_get_expr() here fails with "function pg_get_expr(text, integer) does
-- not exist". Select the expression text directly.
select schemaname, tablename, policyname, cmd, roles::text,
       qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- @artifact grants
select n.nspname, c.relname,
       coalesce(nullif(relacl::text, ''), '(default)')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','storage')
order by 1, 2;

-- @artifact roles
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication
from pg_roles
where rolname in ('anon','authenticated','service_role','authenticator','postgres','supabase_admin','dashboard_user')
   or rolname like 'supabase_%'
order by 1;

-- @artifact storage_buckets
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

-- @artifact storage_policies
select p.policyname, p.tablename, p.cmd, p.roles::text,
       p.qual, p.with_check
from pg_policies p
where p.schemaname = 'storage'
order by p.tablename, p.policyname;

-- @artifact cron_jobs
select jobid, schedule, command, active
from cron.job
order by jobid;
