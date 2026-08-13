-- ============================================================================
-- Ledgr — Phase 8A.1 — READ-ONLY STAGING SCHEMA CAPTURE QUERIES
-- ============================================================================
-- This file is the exact read-only query set issued by
-- scripts/database/capture-staging-schema.sh (each section maps to one
-- captured artifact). It contains ONLY SELECT / SHOW / pg_get_*def
-- statements. There is no DDL, no DML, and nothing here writes to the
-- database. Keep in sync with the shell script.
--
-- Run interactively (never against production):
--   psql "$STAGING_SUPABASE_DB_URL" -f scripts/database/capture-staging-schema.sql
-- ============================================================================

\set QUIET on
\pset footer off

-- ── server version ─────────────────────────────────────────────────────────
show server_version;

-- ── schemas (non-system) ───────────────────────────────────────────────────
select nspname
from pg_namespace
where nspname not like 'pg_%' and nspname <> 'information_schema'
order by 1;

-- ── extensions ─────────────────────────────────────────────────────────────
select e.extname, e.extversion, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
order by 1;

-- ── enums (labels in enum order) ───────────────────────────────────────────
select t.typname, string_agg(e.enumlabel, E'\n  ' order by e.enumsortorder)
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname order by 1;

-- ── domains ────────────────────────────────────────────────────────────────
select d.typname, pg_get_userbyid(d.typowner), format_type(d.typbasetype, d.typtypmod), d.typnotnull, d.typdefault
from pg_type d
join pg_namespace n on n.oid = d.typnamespace
where d.typtype = 'd' and n.nspname = 'public'
order by 1;

-- ── tables + columns + types + defaults + nullability + identity/generated ─
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

-- ── generated columns (expression) ─────────────────────────────────────────
select c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
where c.relkind in ('r','p') and n.nspname = 'public' and a.attgenerated <> ''
order by 1, 2;

-- ── identity columns ───────────────────────────────────────────────────────
select c.relname, a.attname, a.attidentity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where c.relkind in ('r','p') and n.nspname = 'public' and a.attidentity <> ''
order by 1, 2;

-- ── primary keys ───────────────────────────────────────────────────────────
select tc.table_name, kcu.column_name, kcu.ordinal_position
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
order by tc.table_name, kcu.ordinal_position;

-- ── foreign keys (full constraint definitions) ─────────────────────────────
select pg_get_constraintdef(oid), conrelid::regclass::text, confrelid::regclass::text
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by conname;

-- ── unique constraints ─────────────────────────────────────────────────────
select pg_get_constraintdef(oid), conrelid::regclass::text
from pg_constraint
where contype = 'u' and connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

-- ── check constraints (full definitions) ───────────────────────────────────
select pg_get_constraintdef(oid), conrelid::regclass::text
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

-- ── indexes (full definitions) ─────────────────────────────────────────────
select i.relname, pg_get_indexdef(ix.indexrelid)
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
order by i.relname;

-- ── sequences ──────────────────────────────────────────────────────────────
select s.relname, format_type(t.typbasetype, t.typtypmod)
from pg_class s
join pg_namespace n on n.oid = s.relnamespace
join pg_type t on t.oid = s.reltype
where s.relkind = 'S' and n.nspname = 'public'
order by 1;

-- ── views (pg_get_viewdef) ─────────────────────────────────────────────────
select c.relname, pg_get_viewdef(c.oid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public'
order by 1;

-- ── materialized views (pg_get_viewdef) ────────────────────────────────────
select c.relname, pg_get_viewdef(c.oid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'm' and n.nspname = 'public'
order by 1;

-- ── functions/procedures (full definitions; redacted after capture) ────────
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       p.provolatile::text, p.prosecdef::text, pg_get_userbyid(p.proowner),
       p.proconfig, pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;

-- ── triggers (pg_get_triggerdef) ───────────────────────────────────────────
select t.tgname, c.relname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
order by c.relname, t.tgname;

-- ── RLS status (enabled / forced) ──────────────────────────────────────────
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and n.nspname = 'public'
order by 1;

-- ── RLS policies (USING / WITH CHECK verbatim) ─────────────────────────────
select schemaname, tablename, policyname, cmd, roles::text,
       pg_get_expr(qual, 0), pg_get_expr(with_check, 0)
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ── grants (ACLs) ──────────────────────────────────────────────────────────
select n.nspname, c.relname,
       coalesce(nullif(relacl::text, ''), '(default)')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','storage')
order by 1, 2;

-- ── roles relevant to application access ───────────────────────────────────
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication
from pg_roles
where rolname in ('anon','authenticated','service_role','authenticator','postgres','supabase_admin','dashboard_user')
   or rolname like 'supabase_%'
order by 1;

-- ── storage buckets (no owner/identity columns) ────────────────────────────
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;

-- ── storage policies ───────────────────────────────────────────────────────
select p.policyname, p.tablename, p.cmd, p.roles::text,
       pg_get_expr(p.qual, 0), pg_get_expr(p.with_check, 0)
from pg_policies p
where p.schemaname = 'storage'
order by p.tablename, p.policyname;

-- ── scheduled jobs (only if cron schema accessible) ────────────────────────
select jobid, schedule, command, active
from cron.job
order by jobid;
