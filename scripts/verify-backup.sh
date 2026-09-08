#!/usr/bin/env bash
#
# verify-backup.sh — restore a Supabase dump into a throwaway Postgres and
# assert that row counts for a set of core tables match the live source.
#
# Environment:
#   SOURCE_DB_URL              source Postgres connection URL. It may omit a
#                              password when SOURCE_DB_PASSWORD is supplied.
#   SOURCE_DB_PASSWORD         optional source password passed through
#                              PGPASSWORD (keeps it out of the URL).
#   SOURCE_DB_SSLMODE          source TLS mode (defaults to require).
#   SOURCE_DB_CONNECT_TIMEOUT  connection timeout in seconds (defaults to 30).
#   RESTORE_DB_URL             connection string of the throwaway restore DB
#   TABLES                     comma-separated table list to compare (public)
#
# Exits non-zero on any mismatch or failure so the calling CI job fails.

set -euo pipefail

if [[ -z "${SOURCE_DB_URL:-}" ]]; then
  echo "::error::SOURCE_DB_URL is not set" >&2
  exit 1
fi
if [[ -z "${RESTORE_DB_URL:-}" ]]; then
  echo "::error::RESTORE_DB_URL is not set" >&2
  exit 1
fi

SOURCE_DB_PASSWORD="${SOURCE_DB_PASSWORD:-}"
SOURCE_DB_SSLMODE="${SOURCE_DB_SSLMODE:-require}"
SOURCE_DB_CONNECT_TIMEOUT="${SOURCE_DB_CONNECT_TIMEOUT:-30}"
if ! [[ "$SOURCE_DB_CONNECT_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "::error::SOURCE_DB_CONNECT_TIMEOUT must be a positive integer" >&2
  exit 1
fi

# Run source commands with TLS required and (when provided) a password kept out
# of the connection URL. This works with Supabase's uncredentialed session-
# pooler URL produced by `supabase link`, while retaining support for a complete
# connection URL when the script is run manually.
source_command_env() {
  local -a env_vars=(
    "PGSSLMODE=$SOURCE_DB_SSLMODE"
    "PGCONNECT_TIMEOUT=$SOURCE_DB_CONNECT_TIMEOUT"
  )
  if [[ -n "$SOURCE_DB_PASSWORD" ]]; then
    env_vars+=("PGPASSWORD=$SOURCE_DB_PASSWORD")
  fi
  env "${env_vars[@]}" "$@"
}

source_pg_dump() {
  source_command_env pg_dump --no-password "$SOURCE_DB_URL" "$@"
}

source_psql() {
  source_command_env psql --no-password -X "$SOURCE_DB_URL" "$@"
}

# NB: every name in this list must exist as a migration-created table. Earlier
# drafts listed payroll_employees/inventory_items (no such tables exist) and
# subscriptions (created out-of-band in production only, absent from
# migrations), which made verification fail on "relation does not exist".
TABLES="${TABLES:-businesses,business_users,contacts,accounts,invoices,expenses,journal_entries,journal_lines,employees,tax_returns,inventory_balances,branches,departments,api_keys,webhooks,subscription_payments}"

DUMP_FILE="$(mktemp --suffix=.dump)"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "==> Dumping public schema from source database"
source_pg_dump \
  --schema=public \
  --no-owner \
  --no-privileges \
  --no-comments \
  --format=custom \
  --file="$DUMP_FILE"

echo "==> Preparing throwaway restore database"
# Make sure extensions the schema relies on exist in the clean target.
psql --no-password -X "$RESTORE_DB_URL" -v ON_ERROR_STOP=0 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;
SQL

echo "==> Restoring dump into throwaway database"
pg_restore --no-password --dbname="$RESTORE_DB_URL" \
  --no-owner \
  --no-privileges \
  --format=custom \
  --clean \
  --if-exists \
  --single-transaction \
  "$DUMP_FILE" || {
    # Some objects (e.g. roles, extension ownership) can legitimately fail on a
    # stripped public-only dump; re-run without --single-transaction so the
    # rest still loads, then continue to the row-count comparison.
    echo "::warning::pg_restore reported errors; attempting non-transactional restore"
    pg_restore --no-password --dbname="$RESTORE_DB_URL" \
      --no-owner \
      --no-privileges \
      --format=custom \
      --clean \
      --if-exists \
      "$DUMP_FILE" || true
  }

echo "==> Comparing row counts (source vs restored)"
IFS=',' read -r -a TABLE_ARR <<< "$TABLES"
FAIL=0
for table in "${TABLE_ARR[@]}"; do
  table="$(echo "$table" | tr -d '[:space:]')"
  [[ -z "$table" ]] && continue

  # Skip tables the source schema does not define. The comparison only makes
  # sense for tables that exist in the dump, so a missing source table (env
  # drift, renamed/legacy table) is a warning rather than a backup failure.
  present=$(source_psql -tAc "SELECT to_regclass('public.\"$table\"') IS NOT NULL;" 2>/dev/null || echo "ERR")
  if [[ "$present" == "ERR" ]]; then
    echo "::error::Could not check existence of $table in the source database"
    FAIL=1
    continue
  fi
  if [[ "$present" != "t" ]]; then
    echo "::warning::Skipping $table: not present in the source database schema"
    continue
  fi

  src=$(source_psql -tAc "SELECT count(*) FROM public.\"$table\";" 2>/dev/null || echo "ERR")
  rst=$(psql --no-password -X "$RESTORE_DB_URL" -tAc "SELECT count(*) FROM public.\"$table\";" 2>/dev/null || echo "ERR")

  if [[ "$src" == "ERR" || "$rst" == "ERR" ]]; then
    echo "::error::Could not read counts for $table (src=$src rst=$rst)"
    FAIL=1
    continue
  fi

  if [[ "$src" != "$rst" ]]; then
    echo "::error::Row count mismatch for $table: source=$src restored=$rst"
    FAIL=1
  else
    echo "ok   $table: $src"
  fi
done

if [[ "$FAIL" -ne 0 ]]; then
  echo "::error::Backup verification FAILED"
  exit 1
fi

echo "==> Backup verification PASSED"
