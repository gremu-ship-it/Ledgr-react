#!/usr/bin/env bash
# ============================================================================
# Point the HTTP-dispatched pg_cron jobs at the real Edge Function URLs, and
# prove afterwards that no ACTIVE scheduled job is still holding a placeholder
# (inactive, parked ones are reported as warnings — see the verify section).
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

# --- Verify: no ACTIVE job may still contain a placeholder ------------------
# This is the check whose absence let the breakage live in production for
# months: an active job posting to 'https://<PROJECT_REF>.supabase.co/...'
# looks healthy in cron.job while doing nothing. It is read-only and cheap.
#
# Only ACTIVE placeholder jobs fail the deploy. An inactive one cannot fire,
# so it is not silently broken, just visibly parked. Migration 20261017000000
# §3 deliberately deactivates every placeholder job so that "active" means
# "working". The jobs cron-jobs.sql owns are re-created above with real values
# and come back active. A job it does NOT own stays parked: today that is
# 'retry-failed-webhooks-daily' (20260820000000), whose redispatch cannot yet
# authenticate to webhook-dispatcher. Parked jobs are reported as a warning
# on every deploy instead.
#
# Failing on parked jobs too stopped the deploy AFTER the database had
# migrated and skipped the frontend, leaving staging mixed-version
# (2026-10-09, 2026-10-14).
verify_file="$(mktemp)"
trap 'rm -f "${sql_file}" "${verify_file}"' EXIT
cat > "${verify_file}" <<'SQL'
select jobname, schedule, active
  from cron.job
 where command like '%<PROJECT_REF>%'
    or command like '%<CRON_SECRET>%'
 order by jobname;
SQL

verify_response="$(run_sql "${verify_file}" || true)"
verify_status="$(printf '%s' "${verify_response}" | tail -n 1)"
verify_body="$(printf '%s' "${verify_response}" | sed '$d')"

if [[ "${verify_status}" != 2* ]]; then
  echo "::warning::Could not verify cron job commands on ${label} (HTTP ${verify_status:-none}); the apply step itself succeeded."
  exit 0
fi

# The endpoint returns the result set as a JSON array of row objects. Print
# one "<state>\t<jobname>\t<schedule>" line per row, where state is "parked"
# only for an explicit active = false. Anything else counts as active: a
# missing or unexpected value must never let a live placeholder job through.
# Exit 3 if the body is not the expected shape.
classify_rows='
import json, sys
try:
    rows = json.load(sys.stdin)
except ValueError:
    sys.exit(3)
if not isinstance(rows, list) or not all(isinstance(r, dict) and "jobname" in r for r in rows):
    sys.exit(3)
for r in rows:
    parked = r.get("active") in (False, "f", "false")
    fields = ("parked" if parked else "active", r.get("jobname"), r.get("schedule"))
    # Never emit an empty field: tab is IFS whitespace, so the reader below
    # would collapse it and shift the columns.
    print("\t".join(" ".join(str(f).split()) or "-" for f in fields))
'

if ! classified="$(printf '%s' "${verify_body}" | python3 -c "${classify_rows}")"; then
  # Unexpected response shape: fall back to the original, conservative rule
  # (any listed job fails the deploy), since active and parked can't be told apart.
  if printf '%s' "${verify_body}" | grep -q 'jobname'; then
    echo "::error::Cron jobs on ${label} still contain unsubstituted placeholders (could not tell active from parked jobs in the response):"
    printf '%s\n' "${verify_body}" | head -n 5 | while IFS= read -r line; do
      echo "::error::  ${line:0:400}"
    done
    exit 1
  fi
  echo "::warning::Could not parse the cron job verification result for ${label}; the apply step itself succeeded."
  exit 0
fi

active_jobs=0
while IFS=$'\t' read -r state jobname schedule; do
  [[ -z "${state}" ]] && continue
  jobname="${jobname//::/: :}"
  schedule="${schedule//::/: :}"
  if [[ "${state}" == "parked" ]]; then
    echo "::warning::pg_cron job '${jobname:0:200}' (${schedule:0:100}) on ${label} still holds a deploy-time placeholder but is INACTIVE, so it never runs. scripts/cron-jobs.sql does not manage it. Add it there with real values once it should run."
  else
    if ((active_jobs == 0)); then
      echo "::error::Active cron jobs on ${label} still contain unsubstituted placeholders — they will never fire:"
    fi
    echo "::error::  ${jobname:0:200} (${schedule:0:100})"
    active_jobs=$((active_jobs + 1))
  fi
done <<< "${classified}"

if ((active_jobs > 0)); then
  exit 1
fi

echo "Verified: no active pg_cron job on ${label} contains an unsubstituted placeholder."
