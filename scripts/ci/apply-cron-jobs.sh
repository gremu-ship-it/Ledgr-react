#!/usr/bin/env bash
# ============================================================================
# Point the HTTP-dispatched pg_cron jobs at the real Edge Function URLs, and
# prove afterwards that no scheduled job is still holding a placeholder and
# that every job scheduled by scripts/cron-jobs.sql is active.
#
# Why this exists
# ---------------
# The schedule migrations (20260726000003 / 20260726000005 / 20260727000006 /
# 20260820000000) are applied verbatim by `supabase db push`, placeholders and
# all, so every environment ended up with cron jobs posting to
# 'https://<PROJECT_REF>.supabase.co/functions/v1/...'. pg_net swallows the
# DNS failure, so the jobs looked healthy in cron.job while doing nothing:
# subscriptions were never expired and renewal reminders were never sent
# (verified against artifacts/database/capture/cron_jobs.json, 2026-09-29).
# scripts/cron-jobs.sql was written to repair that but was never wired into
# any workflow. This script is that missing wiring.
#
# Why "active" is verified too (2026-10-14)
# -----------------------------------------
# 20261017000000 deactivates every job still holding a placeholder, on the
# understanding that this script re-creates it active. But cron.schedule()
# never touches `active` on an existing job, so a rescheduled job kept the
# right URL and stayed inactive: it never fired, and the placeholder check
# alone still passed. scripts/cron-jobs.sql now re-enables its jobs
# explicitly, and the second check below fails the deploy if any of them is
# missing or inactive.
#
# A failure here no longer blocks the frontend deploy (deploy.yml gates the
# frontend on build/migrate/verify/edge only), but it still fails the run.
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
#   SUPABASE_ENV_LABEL           human label for log messages (default: supabase)
#   SUPABASE_MANAGEMENT_API_URL  Management API base URL (default
#                                https://api.supabase.com; only the test
#                                harness tests/database/cron_jobs_apply.test.js
#                                points it elsewhere)
# ============================================================================
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is not set}"
label="${SUPABASE_ENV_LABEL:-supabase}"
api_base="${SUPABASE_MANAGEMENT_API_URL:-https://api.supabase.com}"
api_base="${api_base%/}"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "::error::CRON_SECRET is not configured for ${label}. The cron-invoked Edge Functions (renewal reminders, partner invoices, webhook retry) reject every unauthenticated call, so scheduling them without it would recreate the silent-no-op failure this step exists to prevent."
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cron_sql="${repo_root}/scripts/cron-jobs.sql"
tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
sql_file="${tmp_dir}/cron-jobs.sql"

sed -e "s|<PROJECT_REF>|${SUPABASE_PROJECT_REF}|g" \
    -e "s|<CRON_SECRET>|${CRON_SECRET}|g" \
    "${cron_sql}" > "${sql_file}"

if grep -q '<PROJECT_REF>\|<CRON_SECRET>' "${sql_file}"; then
  echo "::error::Placeholder substitution failed for ${label}; refusing to schedule cron jobs."
  exit 1
fi

# The jobs this deploy owns: every cron.schedule('<name>', ...) call in
# scripts/cron-jobs.sql (full-line comments ignored). The active check below
# is derived from the file itself, so it cannot drift from what was applied.
managed_jobs="$(python3 - "${cron_sql}" <<'PY'
import re, sys
lines = open(sys.argv[1]).read().splitlines()
text = "\n".join(l for l in lines if not l.lstrip().startswith("--"))
print("\n".join(dict.fromkeys(re.findall(r"cron\.schedule\(\s*'([^']+)'", text))))
PY
)"
if [[ -z "${managed_jobs}" ]]; then
  echo "::error::Found no cron.schedule('<job name>', ...) call in scripts/cron-jobs.sql; refusing to report the ${label} cron jobs as verified."
  exit 1
fi

# Management API SQL endpoint. Body is {"query": "<sql>"} — build it with
# python so quoting/newlines in the SQL survive intact.
run_sql() {
  local file="$1"
  local payload
  payload="$(python3 -c 'import json,sys; print(json.dumps({"query": open(sys.argv[1]).read()}))' "${file}")"
  curl -sS --max-time 60 -w '\n%{http_code}' \
    -X POST "${api_base}/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
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

# --- Verification (read-only, cheap) -----------------------------------------
# Runs one query; sets verify_status / verify_body. Returns non-zero when the
# endpoint did not answer 2xx (the apply itself already succeeded by then, so
# an unanswerable check is reported as a warning, not a failure).
verify_status=""
verify_body=""
verify_query() {
  local response
  response="$(run_sql "$1" || true)"
  verify_status="$(printf '%s' "${response}" | tail -n 1)"
  verify_body="$(printf '%s' "${response}" | sed '$d')"
  [[ "${verify_status}" == 2* ]]
}

report_rows() {
  printf '%s\n' "${verify_body}" | head -n 5 | while IFS= read -r line; do
    line="${line//::/: :}"
    [[ -z "${line}" ]] && continue
    echo "::error::  ${line:0:400}"
  done
}

failed=0

# 1. No scheduled job may still contain a placeholder. This is the check whose
#    absence let the breakage live in production for months. It deliberately
#    includes INACTIVE jobs: a deactivated placeholder job is a job a migration
#    declares and scripts/cron-jobs.sql fails to schedule (2026-10-14:
#    retry-failed-webhooks-daily) — the fix is to add it there, not to look
#    away from it.
placeholder_file="${tmp_dir}/verify-placeholders.sql"
cat > "${placeholder_file}" <<'SQL'
select jobname, schedule, active, username
  from cron.job
 where command like '%<PROJECT_REF>%'
    or command like '%<CRON_SECRET>%';
SQL

if verify_query "${placeholder_file}"; then
  # Empty result set = no placeholders left.
  if printf '%s' "${verify_body}" | grep -q 'jobname'; then
    echo "::error::Cron jobs on ${label} still contain unsubstituted placeholders — they will never fire. Each job a migration schedules with a placeholder needs a matching cron.schedule() in scripts/cron-jobs.sql:"
    report_rows
    failed=1
  else
    echo "Verified: no pg_cron job on ${label} contains an unsubstituted placeholder."
  fi
else
  echo "::warning::Could not verify cron job commands on ${label} (HTTP ${verify_status:-none}); the apply step itself succeeded."
fi

# 2. Every job scheduled by scripts/cron-jobs.sql must exist for this role and
#    be active. An inactive job has the right URL and still never fires.
names_sql=""
managed_count=0
while IFS= read -r name; do
  [[ -z "${name}" ]] && continue
  names_sql+="${names_sql:+, }'${name//\'/\'\'}'"
  managed_count=$((managed_count + 1))
done <<< "${managed_jobs}"

active_file="${tmp_dir}/verify-active.sql"
cat > "${active_file}" <<SQL
select m.jobname, j.active, j.username
  from unnest(array[${names_sql}]::text[]) as m(jobname)
  left join cron.job j
    on j.jobname = m.jobname
   and j.username = current_user
 where j.jobid is null
    or j.active is not true;
SQL

if verify_query "${active_file}"; then
  if printf '%s' "${verify_body}" | grep -q 'jobname'; then
    echo "::error::Cron jobs scheduled by scripts/cron-jobs.sql are missing or INACTIVE on ${label} — they will never fire (cron.schedule() does not re-enable a deactivated job; cron-jobs.sql must do it with cron.alter_job):"
    report_rows
    failed=1
  else
    echo "Verified: all ${managed_count} job(s) scheduled by scripts/cron-jobs.sql are active on ${label}."
  fi
else
  echo "::warning::Could not verify that the ${label} cron jobs are active (HTTP ${verify_status:-none}); the apply step itself succeeded."
fi

exit "${failed}"
