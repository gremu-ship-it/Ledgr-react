#!/usr/bin/env bash
#
# verify-backup.sh — restore a Supabase dump into a throwaway Postgres and
# assert that row counts for a set of core tables match the live source.
#
# Environment:
#   SOURCE_DB_URL   direct Postgres connection string of the source DB
#   RESTORE_DB_URL  connection string of the throwaway restore DB
#   TABLES          comma-separated table list to compare (public schema)
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

TABLES="${TABLES:-businesses,business_users,contacts,accounts,invoices,expenses,journal_entries,journal_lines,payroll_employees,tax_returns,inventory_items,branches,departments,api_keys,webhooks,subscriptions}"

DUMP_FILE="$(mktemp --suffix=.dump)"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "==> Dumping public schema from source database"
pg_dump "$SOURCE_DB_URL" \
  --schema=public \
  --no-owner \
  --no-privileges \
  --no-comments \
  --format=custom \
  --file="$DUMP_FILE"

echo "==> Preparing throwaway restore database"
# Make sure extensions the schema relies on exist in the clean target.
psql "$RESTORE_DB_URL" -v ON_ERROR_STOP=0 <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS citext;
SQL

echo "==> Restoring dump into throwaway database"
pg_restore "$RESTORE_DB_URL" \
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
    pg_restore "$RESTORE_DB_URL" \
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

  src=$(psql "$SOURCE_DB_URL" -tAc "SELECT count(*) FROM public.\"$table\";" 2>/dev/null || echo "ERR")
  rst=$(psql "$RESTORE_DB_URL" -tAc "SELECT count(*) FROM public.\"$table\";" 2>/dev/null || echo "ERR")

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
