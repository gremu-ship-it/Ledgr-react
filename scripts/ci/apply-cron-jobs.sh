#!/usr/bin/env bash
# ============================================================================
# Point the HTTP-dispatched pg_cron jobs at the real Edge Function URLs, and
# prove afterwards that no scheduled job is still holding a placeholder.
#
# Why this exists
# ---------------
# The schedule migrations (20260726000003 / 20260726000005 / 20260727000006)
# are applied verbatim by `supabase db push`, placeholders and all, so every
# environment ended up with cron jobs posting to
# 'https://<PROJECT_REF>.supabase.co/functions/v1/...'. pg_net swallows the
# DNS failure, so the jobs looked healthy in cron.job while doing nothing:
# subscriptions were never expired and renewal reminders were never sent
# (verified against artifacts/database/capture/cron_jobs.json, 2026-09-29).
# scripts/cron-jobs.sql was written to repair that but was never wired into
# any workflow. This script is that missing wiring.
#
# SQL is executed through the Supabase Management API query endpoint rather
# than psql: the runner already holds SUPABASE_ACCESS_TOKEN, and it avoids
# depending on direct/pooler database connectivity from GitHub runners.
#
# Required env:
#   SUPABASE_ACCESS_TOKEN   Management API token
#   SUPABASE_PROJECT_REF    target project ref
#   CRON_SECRET             shared secret the cron-invoked functions check
# Optional env:
#   SUPABASE_ENV_LABEL      human label for log messages (default: supabase)
# ============================================================================
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is not set}"
label="${SUPABASE_ENV_LABEL:-supabase}"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "::error::CRON_SECRET is not configured for ${label}. The cron-invoked Edge Functions (renewal reminders, partner invoices) reject every unauthenticated call, so scheduling them without it would recreate the silent-no-op failure this step exists to prevent."
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
sql_file="$(mktemp)"
trap 'rm -f "${sql_file}"' EXIT

sed -e "s|<PROJECT_REF>|${SUPABASE_PROJECT_REF}|g" \
    -e "s|<CRON_SECRET>|${CRON_SECRET}|g" \
    "${repo_root}/scripts/cron-jobs.sql" > "${sql_file}"

if grep -q '<PROJECT_REF>\|<CRON_SECRET>' "${sql_file}"; then
  echo "::error::Placeholder substitution failed for ${label}; refusing to schedule cron jobs."
  exit 1
fi

# Management API SQL endpoint. Body is {"query": "<sql>"} — build it with
# python so quoting/newlines in the SQL survive intact.
run_sql() {
  local file="$1"
  local payload
  payload="$(python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "${file}")"
  curl -sS --max-time 60 -w '\n%{http_code}' \
    -X POST "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${payload}"
}

attempt=1
while :; do
  response="$(run_sql "${sql_file}" || true)"
  status="$(printf '%s' "${response}" | tail -n 1)"
  body="$(printf '%s' "${response}" | sed '$d')"
  if [[ "${status}" == 2* ]]; then
    echo "pg_cron jobs rescheduled for ${label}."
    break
  fi
  if ((attempt >= 3)); then
    echo "::error::Failed to apply scripts/cron-jobs.sql to ${label} (HTTP ${status:-none}). Scheduled jobs may still point at placeholder URLs."
    printf '%s\n' "${body}" | tail -n 5 | while IFS= read -r line; do
      line="${line//${CRON_SECRET}/***}"
      line="${line//::/: :}"
      [[ -z "${line}" ]] && continue
      echo "::error::${line:0:400}"
    done
    exit 1
  fi
  echo "cron-jobs apply failed (attempt ${attempt}/3, HTTP ${status:-none}) — retrying in $((attempt * 10))s ..."
  sleep $((attempt * 10))
  attempt=$((attempt + 1))
done

# --- Verify: no scheduled job may still contain a placeholder ---------------
# This is the check whose absence let the breakage live in production for
# months. It is read-only and cheap.
verify_file="$(mktemp)"
trap 'rm -f "${sql_file}" "${verify_file}"' EXIT
cat > "${verify_file}" <<'SQL'
select jobname, schedule, active
  from cron.job
 where command like '%<PROJECT_REF>%'
    or command like '%<CRON_SECRET>%';
SQL

verify_response="$(run_sql "${verify_file}" || true)"
verify_status="$(printf '%s' "${verify_response}" | tail -n 1)"
verify_body="$(printf '%s' "${verify_response}" | sed '$d')"

if [[ "${verify_status}" != 2* ]]; then
  echo "::warning::Could not verify cron job commands on ${label} (HTTP ${verify_status:-none}); the apply step itself succeeded."
  exit 0
fi

# Empty result set = no placeholders left.
if printf '%s' "${verify_body}" | grep -q 'jobname'; then
  echo "::error::Cron jobs on ${label} still contain unsubstituted placeholders — they will never fire:"
  printf '%s\n' "${verify_body}" | head -n 5 | while IFS= read -r line; do
    echo "::error::  ${line:0:400}"
  done
  exit 1
fi

echo "Verified: no pg_cron job on ${label} contains an unsubstituted placeholder."
