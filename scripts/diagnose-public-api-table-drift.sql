-- ============================================================================
-- Diagnostic: public-API table drift (api_keys, webhooks, webhook_deliveries)
--
-- CONTEXT
-- -------
-- Production is the legacy Ledgr project: it already had these three tables
-- when 20260727000001_public_api_webhooks.sql was deployed, so that migration's
-- `create table if not exists` was a no-op there and the columns/defaults it
-- declares never arrived. `supabase gen types typescript` against production
-- then reports `webhooks.secret` as required on insert and
-- `webhooks.last_triggered_at` / `webhook_deliveries.attempt` as non-existent,
-- which is what breaks `npm run typecheck`.
--
-- 20261018000000_repair_legacy_public_api_tables.sql converges every
-- environment back to the declared shape. This script is the read-only check:
-- run it BEFORE applying the repair (every drifted column is listed) and AFTER
-- (every row must read OK).
--
-- Read-only — no DDL, no DML. Paste a section into the Supabase SQL Editor.
-- ============================================================================


-- ── 1. Per-column verdict — the headline check ──────────────────────────────
-- Every column the migrations declare for these tables, compared with what the
-- database actually has. `verdict` is OK, DRIFT (present but wrong nullability
-- or missing default) or MISSING COLUMN.
with expected(table_name, column_name, data_type, is_nullable, has_default) as (
  values
    ('api_keys',            'created_at',        'timestamp with time zone', 'NO',  true),
    ('api_keys',            'created_by',        'uuid',                     'YES', false),
    ('webhooks',            'last_triggered_at', 'timestamp with time zone', 'YES', false),
    ('webhooks',            'created_by',        'uuid',                     'YES', false),
    ('webhooks',            'updated_at',        'timestamp with time zone', 'NO',  true),
    ('webhooks',            'secret',            'text',                     'NO',  true),
    ('webhook_deliveries',  'attempt',           'integer',                  'NO',  true)
)
select
  e.table_name,
  e.column_name,
  e.data_type                        as expected_type,
  e.is_nullable                      as expected_nullable,
  e.has_default                      as expected_default,
  a.data_type                        as actual_type,
  a.is_nullable                      as actual_nullable,
  (a.column_default is not null)     as actual_default,
  a.column_default,
  case
    when a.column_name is null then 'MISSING COLUMN'
    when a.data_type <> e.data_type
      or a.is_nullable <> e.is_nullable
      or (a.column_default is not null) <> e.has_default then 'DRIFT'
    else 'OK'
  end                                as verdict
from expected e
left join information_schema.columns a
  on a.table_schema = 'public'
 and a.table_name = e.table_name
 and a.column_name = e.column_name
order by e.table_name, e.column_name;


-- ── 2. Full column inventory of the three tables ────────────────────────────
-- Legacy tables can also carry columns the migrations never declared. Compare
-- this list with supabase/migrations/20260727000001_public_api_webhooks.sql
-- (plus the two hardening migrations) before assuming a shape is complete.
select
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('api_keys', 'webhooks', 'webhook_deliveries')
order by c.table_name, c.ordinal_position;


-- ── 3. Row-level security + grants (read access is RLS-gated by design) ─────
-- 20260730000002_harden_webhook_secrets.sql restricts api_keys/webhooks reads
-- to owner/admin. RLS is enabled by the creating migration, which is a no-op on
-- a legacy database — this section confirms the policies and table ACLs are
-- actually in place.
select
  c.relname                                                as table_name,
  c.relrowsecurity                                         as rls_enabled,
  c.relforcerowsecurity                                    as rls_forced,
  count(p.policyname)                                      as policy_count,
  coalesce(string_agg(distinct p.policyname, ', '), '(none)') as policies,
  coalesce(array_to_string(c.relacl, ' | '), '(default)')  as grants
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p
  on p.schemaname = 'public' and p.tablename = c.relname
where n.nspname = 'public'
  and c.relname in ('api_keys', 'webhooks', 'webhook_deliveries')
group by c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl
order by c.relname;


-- ── 4. One-line summary ─────────────────────────────────────────────────────
with expected(table_name, column_name, data_type, is_nullable, has_default) as (
  values
    ('api_keys',            'created_at',        'timestamp with time zone', 'NO',  true),
    ('api_keys',            'created_by',        'uuid',                     'YES', false),
    ('webhooks',            'last_triggered_at', 'timestamp with time zone', 'YES', false),
    ('webhooks',            'created_by',        'uuid',                     'YES', false),
    ('webhooks',            'updated_at',        'timestamp with time zone', 'NO',  true),
    ('webhooks',            'secret',            'text',                     'NO',  true),
    ('webhook_deliveries',  'attempt',           'integer',                  'NO',  true)
),
verdicts as (
  select
    e.table_name,
    e.column_name,
    case
      when a.column_name is null then 'MISSING COLUMN'
      when a.data_type <> e.data_type
        or a.is_nullable <> e.is_nullable
        or (a.column_default is not null) <> e.has_default then 'DRIFT'
      else 'OK'
    end as verdict
  from expected e
  left join information_schema.columns a
    on a.table_schema = 'public'
   and a.table_name = e.table_name
   and a.column_name = e.column_name
)
select
  case
    when count(*) filter (where verdict <> 'OK') = 0
      then 'PASS — the three public-API tables match the migration-declared shape'
    else 'DRIFT — ' || count(*) filter (where verdict <> 'OK') ||
         ' column(s) still need 20261018000000_repair_legacy_public_api_tables.sql: ' ||
         string_agg(column_name, ', ') filter (where verdict <> 'OK')
  end as summary
from verdicts;
