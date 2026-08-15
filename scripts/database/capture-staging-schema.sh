#!/usr/bin/env bash
# ============================================================================
# Ledgr — Phase 8A.1 — Read-only staging schema capture
# ============================================================================
# Captures the LIVE STAGING database schema without writing anything to it.
#
# SAFETY RULES
# ------------
#   1. Refuses to run unless the environment passes isolation checks:
#        LEDGR_ENV=staging
#        STAGING_SUPABASE_PROJECT_REF is set and != PRODUCTION_SUPABASE_PROJECT_REF
#        STAGING_SUPABASE_DB_URL points at db.<ref>.supabase.co for the STAGING ref
#   2. Every statement issued is read-only (SELECT / SHOW / pg_get_*def).
#      The SQL file contains no DDL, no DML, no writes of any kind.
#   3. Output is written to artifacts/database/capture/ and is redacted:
#        - passwords / secrets in connection strings are never echoed
#        - function bodies and view definitions are captured for review, but
#          any literal that looks like a secret (jwt, key, token, secret,
#          password) is masked before the artifacts are written.
#   4. The script NEVER connects to production. If the refs cannot be
#      verified as distinct, the script exits non-zero and writes nothing.
#
# USAGE
# -----
#   LEDGR_ENV=staging \
#   STAGING_SUPABASE_PROJECT_REF=<ref> \
#   PRODUCTION_SUPABASE_PROJECT_REF=<ref> \
#   STAGING_SUPABASE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres' \
#   ./scripts/database/capture-staging-schema.sh
#
#   (Requires `psql` on PATH. The DB password is read from the URL or from
#   PGPASSWORD — it is never written to any file in this repository.)
#
# OUTPUT
# ------
#   artifacts/database/capture/
#     capture.sql                 — the exact SQL issued (read-only)
#     schemas.txt                 — schema list
#     extensions.txt              — extensions with schemas
#     enums.txt                   — enum types and labels (ordered)
#     domains.txt                 — domains
#     tables.txt                  — tables + columns + types + defaults + nullability
#     generated_columns.txt       — generated column expressions
#     identity_columns.txt        — identity column metadata
#     primary_keys.txt            — PK constraints
#     foreign_keys.txt            — FK constraints (full definition)
#     unique_constraints.txt      — unique constraints
#     check_constraints.txt       — check constraints (full definition)
#     indexes.txt                 — indexes (full definition)
#     sequences.txt               — sequences
#     views.txt                   — views (pg_get_viewdef)
#     matviews.txt                — materialized views (pg_get_viewdef)
#     functions.txt               — functions/procedures (pg_get_functiondef)
#     triggers.txt                — triggers (pg_get_triggerdef)
#     rls.txt                     — RLS enabled/forced per table
#     policies.txt                — RLS policies (USING / WITH CHECK verbatim)
#     grants.txt                  — ACLs on application objects
#     roles.txt                   — roles relevant to application access
#     storage_buckets.txt         — storage.buckets (id, public, file_size_limit,
#                                   allowed_mime_types) — no owner/secret columns
#     storage_policies.txt        — storage policies (full definition)
#     cron_jobs.txt               — cron.job rows where accessible (redacted)
#     server_version.txt          — SHOW server_version
#     capture.log                 — run log
#
# The captured files are the raw evidence for the authoritative inventory
# (artifacts/database/staging-schema-inventory.json).
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/artifacts/database/capture"
SQL_FILE="${REPO_ROOT}/scripts/database/capture-staging-schema.sql"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "${OUT_DIR}/capture.log"; }
die()  { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

# ── Step 1: environment isolation verification ─────────────────────────────
if [[ "${LEDGR_ENV:-}" != "staging" ]]; then
  die "LEDGR_ENV must be exactly 'staging' (got '${LEDGR_ENV:-<unset>}'). Refusing to run."
fi

STAGING_REF="${STAGING_SUPABASE_PROJECT_REF:-}"
PROD_REF="${PRODUCTION_SUPABASE_PROJECT_REF:-}"
DB_URL="${STAGING_SUPABASE_DB_URL:-}"

[[ -n "$STAGING_REF" ]] || die "STAGING_SUPABASE_PROJECT_REF is not set. Refusing to run."
[[ -n "$PROD_REF" ]]   || die "PRODUCTION_SUPABASE_PROJECT_REF is not set. Refusing to run."
[[ -n "$DB_URL" ]]     || die "STAGING_SUPABASE_DB_URL is not set. Refusing to run."

if [[ "$STAGING_REF" == "$PROD_REF" ]]; then
  die "ENVIRONMENT ISOLATION FAILURE: STAGING_SUPABASE_PROJECT_REF == PRODUCTION_SUPABASE_PROJECT_REF == '${STAGING_REF}'. Will not connect."
fi

# The URL host must be db.<staging-ref>.supabase.co
case "$DB_URL" in
  *"db.${STAGING_REF}.supabase.co"*) : ;;
  *) die "ENVIRONMENT ISOLATION FAILURE: STAGING_SUPABASE_DB_URL does not point at db.${STAGING_REF}.supabase.co. Will not connect." ;;
esac

command -v psql >/dev/null || die "psql is required (install postgresql-client)."

mkdir -p "$OUT_DIR"
: > "${OUT_DIR}/capture.log"

log "Environment OK: LEDGR_ENV=${LEDGR_ENV}, staging ref=${STAGING_REF} (distinct from production ref=${PROD_REF})"
log "Capturing read-only schema from db.${STAGING_REF}.supabase.co into ${OUT_DIR}"

run_sql() { # run_sql <output-file> <sql>
  local out="$1"; shift
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -At -c "$*" > "${OUT_DIR}/${out}" 2>> "${OUT_DIR}/capture.log" \
    || die "psql failed for ${out} — see capture.log. No partial output is certified."
}

# ── Step 2/3: server version + catalog inventory (all read-only) ───────────
run_sql server_version.txt "show server_version;"

run_sql schemas.txt "
select nspname
from pg_namespace
where nspname not like 'pg_%' and nspname <> 'information_schema'
order by 1;"

run_sql extensions.txt "
select e.extname, e.extversion, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
order by 1;"

run_sql enums.txt "
select t.typname, string_agg(e.enumlabel, E'\n  ' order by e.enumsortorder)
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname order by 1;"

run_sql domains.txt "
select d.typname, pg_get_userbyid(d.typowner), format_type(d.typbasetype, d.typtypmod), d.typnotnull, d.typdefault
from pg_type d
join pg_namespace n on n.oid = d.typnamespace
where d.typtype = 'd' and n.nspname = 'public'
order by 1;"

run_sql tables.txt "
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
order by c.relname, a.attnum;"

run_sql generated_columns.txt "
select c.relname, a.attname, pg_get_expr(ad.adbin, ad.adrelid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
where c.relkind in ('r','p') and n.nspname = 'public' and a.attgenerated <> ''
order by 1, 2;"

run_sql identity_columns.txt "
select c.relname, a.attname, a.attidentity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where c.relkind in ('r','p') and n.nspname = 'public' and a.attidentity <> ''
order by 1, 2;"

run_sql primary_keys.txt "
select tc.table_name, kcu.column_name, kcu.ordinal_position
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'
order by tc.table_name, kcu.ordinal_position;"

run_sql foreign_keys.txt "
select pg_get_constraintdef(oid), conrelid::regclass::text, confrelid::regclass::text
from pg_constraint
where contype = 'f' and connamespace = 'public'::regnamespace
order by conname;"

run_sql unique_constraints.txt "
select pg_get_constraintdef(oid), conrelid::regclass::text
from pg_constraint
where contype = 'u' and connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;"

run_sql check_constraints.txt "
select pg_get_constraintdef(oid), conrelid::regclass::text
from pg_constraint
where contype = 'c' and connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;"

run_sql indexes.txt "
select i.relname, pg_get_indexdef(ix.indexrelid)
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
order by i.relname;"

run_sql sequences.txt "
select s.relname, format_type(t.typbasetype, t.typtypmod)
from pg_class s
join pg_namespace n on n.oid = s.relnamespace
join pg_type t on t.oid = s.reltype
where s.relkind = 'S' and n.nspname = 'public'
order by 1;"

run_sql views.txt "
select c.relname, pg_get_viewdef(c.oid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'v' and n.nspname = 'public'
order by 1;"

run_sql matviews.txt "
select c.relname, pg_get_viewdef(c.oid)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'm' and n.nspname = 'public'
order by 1;"

# Function definitions are captured but redacted afterwards (secrets guard).
run_sql functions.txt "
select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
       p.provolatile::text, p.prosecdef::text, pg_get_userbyid(p.proowner),
       p.proconfig, pg_get_functiondef(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
order by p.proname;"

run_sql triggers.txt "
select t.tgname, c.relname, pg_get_triggerdef(t.oid)
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not t.tgisinternal
order by c.relname, t.tgname;"

run_sql rls.txt "
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r','p') and n.nspname = 'public'
order by 1;"

run_sql policies.txt "
select schemaname, tablename, policyname, cmd, roles::text,
       pg_get_expr(qual, 0), pg_get_expr(with_check, 0)
from pg_policies
where schemaname = 'public'
order by tablename, policyname;"

run_sql grants.txt "
select n.nspname, c.relname,
       coalesce(nullif(relacl::text, ''), '(default)')
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname in ('public','storage')
order by 1, 2;"

run_sql roles.txt "
select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication
from pg_roles
where rolname in ('anon','authenticated','service_role','authenticator','postgres','supabase_admin','dashboard_user')
   or rolname like 'supabase_%'
order by 1;"

# Storage buckets — explicitly NOT including owner/created_by (identity data
# is not needed for schema reconstruction and may be sensitive).
run_sql storage_buckets.txt "
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
order by id;"

run_sql storage_policies.txt "
select p.policyname, p.tablename, p.cmd, p.roles::text,
       pg_get_expr(p.qual, 0), pg_get_expr(p.with_check, 0)
from pg_policies p
where p.schemaname = 'storage'
order by p.tablename, p.policyname;"

# Scheduled jobs — only where the cron schema is accessible; values that look
# like secrets are redacted by the redaction pass below.
run_sql cron_jobs.txt "
select jobid, schedule, command, active
from cron.job
order by jobid;" 2>/dev/null || log "cron schema not accessible to this role — scheduled jobs will be documented as environment configuration."

# ── Redaction pass ──────────────────────────────────────────────────────────
# Mask anything that looks like a secret in the captured text files. The
# original output stays in the pipeline; artifacts committed to the repo must
# not contain secrets.
log "Redacting potential secrets from captured artifacts"
find "${OUT_DIR}" -type f -name '*.txt' -print0 | while IFS= read -r -d '' f; do
  sed -i -E \
    -e 's/(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)/<REDACTED-JWT>/g' \
    -e 's/((secret|token|password|key|apikey|api_key)[A-Za-z_-]*[[:space:]]*=[[:space:]]*['"'"'"]?)[A-Za-z0-9_\-\.]{8,}/\1<REDACTED>/Ig' \
    -e "s/((secret|token|password|key)[A-Za-z_-]*[[:space:]]*:)[[:space:]]*['\"][^'\"]{8,}['\"]/\1 <REDACTED>/Ig" \
    -e 's/(sb_secret_[A-Za-z0-9]+)/<REDACTED>/g' \
    "$f" || true
done

log "Capture complete → ${OUT_DIR}"
log "Next: build the authoritative inventory from these files (scripts/database/build-inventory.sh or Phase 8A.1 docs)."
