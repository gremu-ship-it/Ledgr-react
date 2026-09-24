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
# Migration-history drift handling
# --------------------------------
# If the remote history table records migration versions that have no file in
# the checked-out supabase/migrations/ directory, `db push` refuses to run
# ("Remote migration versions not found in local migrations directory"). That
# means the database is ahead of the commit being deployed: somebody pushed to
# the project from another checkout — typically a feature-branch migration
# applied before its PR merged (this is how
# 20260925000001_stock_movement_balance_delta_trigger.sql reached production
# during the 2026-09 stock-count incident: the hotfix was pushed to the
# project directly, and PR #167 merged the same file into main afterwards).
# Retrying cannot fix that, so the script:
#   1. detects the drift signature in the push output,
#   2. runs the CLI's own suggested repair — marking exactly those
#      remote-only versions `reverted` — and pushes again once.
# The repair rewrites the history TABLE only: no applied schema object is
# dropped or changed, and versions that DO have a local file at this commit
# are unaffected (they still count as applied). When the corresponding file
# lands in the repo later, its push applies and records it as usual.
# Opt out with SUPABASE_MIGRATION_AUTO_REPAIR=0 — the script then fails
# immediately with the manual repair commands instead of running them.
#
# Required env:
#   SUPABASE_ACCESS_TOKEN   Management API token (project-status pre-flight)
#   SUPABASE_PROJECT_REF    target project ref
#   SUPABASE_DB_PASSWORD    target database password
# Optional env:
#   SUPABASE_ENV_LABEL             human label for log messages (default: supabase)
#   SUPABASE_MIGRATION_AUTO_REPAIR set to 0/false to disable drift auto-repair
# ============================================================================
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN is not set}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is not set}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is not set}"
label="${SUPABASE_ENV_LABEL:-supabase}"
auto_repair="${SUPABASE_MIGRATION_AUTO_REPAIR:-1}"
case "${auto_repair}" in
  0|false|no|False|FALSE|No|NO) auto_repair=0 ;;
  *) auto_repair=1 ;;
esac

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
#
# Deterministic failures are not retried: when the remote history table knows
# migration versions this checkout does not, `db push` fails identically every
# time (see "Migration-history drift handling" in the header). Those get one
# history-table repair and an immediate re-push instead of burning the retry
# budget on a guaranteed-identical failure.
push_output="$(mktemp)"
drift_repaired=0
attempt=1
max_attempts=3
while :; do
  set +e
  supabase db push --password "${SUPABASE_DB_PASSWORD}" --include-all 2>&1 | tee "${push_output}"
  push_status=${PIPESTATUS[0]}
  set -e

  if ((push_status == 0)); then
    break
  fi

  # Drift check: the CLI prints one "supabase migration repair --status
  # reverted <version>" hint line per remote-only version.
  drift_versions="$(grep -oE 'migration repair --status reverted [0-9]+' "${push_output}" \
    | awk '{print $NF}' | sort -u || true)"
  if [[ -n "${drift_versions}" ]]; then
    read -r -a drift_list <<< "${drift_versions//$'\n'/ }"
    if ((drift_repaired)); then
      echo "::error::supabase db push for ${label} still reports migration-history drift after a repair — refusing to repair twice. Inspect supabase_migrations.schema_migrations ('supabase migration list') and resolve manually. See DEPLOYMENT.md."
      exit 1
    fi
    drift_repaired=1
    if ((auto_repair == 0)); then
      echo "::error::Remote migration history for ${label} contains versions missing from supabase/migrations/ in this checkout: ${drift_list[*]}"
      echo "::error::Auto-repair is disabled (SUPABASE_MIGRATION_AUTO_REPAIR=0). Repair manually, then re-run:"
      echo "::error::  supabase migration repair --status reverted ${drift_list[*]}"
      echo "::error::  supabase db pull   # only if the remote should become the source of truth"
      exit 1
    fi
    echo "::warning::Remote migration history for ${label} records versions this checkout does not have (applied from another checkout before their files landed here). Repairing the history table only — no schema objects are touched:"
    for v in "${drift_list[@]}"; do
      echo "::warning::  migration repair --status reverted ${v}"
    done
    supabase migration repair --password "${SUPABASE_DB_PASSWORD}" --status reverted "${drift_list[@]}"
    echo "Migration history repaired for ${label} — retrying push ..."
    continue
  fi

  if ((attempt >= max_attempts)); then
    echo "Final attempt with --debug for diagnostics ..."
    supabase db push --password "${SUPABASE_DB_PASSWORD}" --include-all --debug || true
    echo "::error::supabase db push failed after ${max_attempts} attempts for ${label}. If the project status above is ACTIVE_HEALTHY, the database is likely unresponsive: restart the project in the Supabase dashboard (General settings -> Restart project), check https://status.supabase.com for incidents, then re-run. See DEPLOYMENT.md."
    exit 1
  fi
  echo "supabase db push failed (attempt ${attempt}/${max_attempts}) — retrying in $((attempt * 20))s ..."
  sleep $((attempt * 20))
  attempt=$((attempt + 1))
done

echo "Migrations pushed to ${label}."
