#!/usr/bin/env bash
# ============================================================================
# Link the Supabase CLI to the target project and push migrations, with
# retries around the network-dependent steps.
#
# Used by .github/workflows/deploy.yml (staging + production). Both steps it
# wraps are idempotent, so retrying is safe:
#   * `supabase link` only resolves credentials/endpoints via the Management API.
#   * `supabase db push` applies each migration in its own transaction and
#     skips versions already recorded in supabase_migrations.schema_migrations.
#
# Required env:
#   SUPABASE_ACCESS_TOKEN   Management API token (project-status pre-flight)
#   SUPABASE_PROJECT_REF    target project ref
#   SUPABASE_DB_PASSWORD    target database password
# Optional env:
#   SUPABASE_ENV_LABEL      human label for log messages (default: supabase)
# ============================================================================
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is not set}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is not set}"
label="${SUPABASE_ENV_LABEL:-supabase}"

# --- 1. Project-status pre-flight -------------------------------------------
# A paused (INACTIVE) project still answers the Management API, so `link`
# succeeds — but the database refuses connections, which surfaces as a pooler
# connection timeout in `db push`. An unresponsive project (e.g. during a
# Supabase incident) behaves the same way. Fail fast with an actionable
# message instead of burning minutes on retries that cannot succeed.
echo "Checking status of Supabase project ${SUPABASE_PROJECT_REF} (${label}) ..."
status_payload="$(curl -sS --max-time 30 \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}" || true)"
project_status="$(printf '%s' "${status_payload}" | grep -o '"status":"[^"]*"' | head -n 1 | cut -d'"' -f4 || true)"
echo "Project status: ${project_status:-unknown}"
if [[ "${project_status}" == "INACTIVE" ]]; then
  echo "::error::Supabase project ${SUPABASE_PROJECT_REF} (${label}) is PAUSED. Resume it in the Supabase dashboard (open the project, click Restore/Resume, wait a few minutes) and re-run this workflow. Pausing does not reset the DB password. See DEPLOYMENT.md."
  exit 1
fi

# --- 2. Link (retried) -------------------------------------------------------
# `link` resolves the project's pooler endpoint via the Management API; fresh
# runners occasionally hit a transient DNS/API blip here.
attempt=1
until supabase link --project-ref "${SUPABASE_PROJECT_REF}" --password "${SUPABASE_DB_PASSWORD}"; do
  if ((attempt >= 3)); then
    echo "::error::supabase link failed after 3 attempts for ${label}."
    exit 1
  fi
  echo "supabase link failed (attempt ${attempt}/3) — retrying in $((attempt * 15))s ..."
  sleep $((attempt * 15))
  attempt=$((attempt + 1))
done

# --- 3. Push migrations (retried) ---------------------------------------------
# The pooler occasionally drops the first connection from a fresh runner
# ("failed to receive message (timeout: context deadline exceeded)"). Retrying
# succeeds once the pooled connection warms up. The final attempt runs with
# --debug so persistent failures leave full diagnostics in the log.
attempt=1
until supabase db push --password "${SUPABASE_DB_PASSWORD}" --include-all; do
  if ((attempt >= 3)); then
    echo "Final attempt with --debug for diagnostics ..."
    supabase db push --password "${SUPABASE_DB_PASSWORD}" --include-all --debug || true
    echo "::error::supabase db push failed after 3 attempts for ${label}. If the project status above is ACTIVE_HEALTHY, the database is likely unresponsive: restart the project in the Supabase dashboard (General settings -> Restart project), check https://status.supabase.com for incidents, then re-run. See DEPLOYMENT.md."
    exit 1
  fi
  echo "supabase db push failed (attempt ${attempt}/3) — retrying in $((attempt * 20))s ..."
  sleep $((attempt * 20))
  attempt=$((attempt + 1))
done

echo "Migrations pushed to ${label}."
