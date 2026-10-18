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
# Failure evidence
# ----------------
# Match real ERROR severity lines, never IF NOT EXISTS NOTICEs. In particular,
# `NOTICE: relation "project_status_log" already exists, skipping` previously
# triggered a hardcoded 42P07 annotation and hid the actual failure. The reported
# production annotation can be reproduced this way; without the raw log it does
# not establish the server's SQLSTATE or the live object's identity.
# Known transient SQLSTATEs (connection/serialization/deadlock/lock timeout)
# retain retries. Other server errors fail fast with their actual message,
# statement context and optional read-only catalog inspection.
#
# Required env:
#   SUPABASE_ACCESS_TOKEN   Management API token (project-status pre-flight)
#   SUPABASE_PROJECT_REF    target project ref
#   SUPABASE_DB_PASSWORD    target database password
# Optional env:
#   SUPABASE_ENV_LABEL             human label for log messages (default: supabase)
#   SUPABASE_MIGRATION_AUTO_REPAIR set to 0/false to disable drift auto-repair
#   SUPABASE_MIGRATION_FORENSICS   set to 0/false to skip the read-only
#                                  inspection of a colliding live object
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
forensics="${SUPABASE_MIGRATION_FORENSICS:-1}"
case "${forensics}" in
  0|false|no|False|FALSE|No|NO) forensics=0 ;;
  *) forensics=1 ;;
esac
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# --- 0. Migration-integrity pre-flight --------------------------------------
# supabase_migrations.schema_migrations is keyed by the version prefix of the
# file name, so two files sharing a prefix can never both be recorded: the CLI
# applies the first, then fails inserting the second with
#   ERROR: duplicate key value violates unique constraint
#          "schema_migrations_pkey" (SQLSTATE 23505)
# That is deterministic — every retry reproduces it byte for byte — and the
# generic retry advice ("the database is likely unresponsive") sends the reader
# to the Supabase dashboard instead of the repository. Two version collisions
# sat in supabase/migrations/ exactly that way on 2026-09-24
# (20260926000001 and 20261003000000, each holding two files) and blocked the
# staging deploy. Catch it here, before any project is touched.
migrations_dir="${repo_root}/supabase/migrations"
duplicate_versions="$(
  for f in "${migrations_dir}"/*.sql; do basename "${f}" | cut -d_ -f1; done | sort | uniq -d
)"
if [[ -n "${duplicate_versions}" ]]; then
  echo "::error::supabase/migrations contains migration files sharing a version prefix — supabase_migrations.schema_migrations is keyed by version, so only one of each pair can ever be recorded:"
  while read -r version; do
    [[ -n "${version}" ]] || continue
    for f in "${migrations_dir}/${version}"_*.sql; do
      echo "::error::  $(basename "${f}")"
    done
  done <<< "${duplicate_versions}"
  echo "::error::Rename the newer file of each pair to a unique version, keeping its position in the replay order, then re-run. See DEPLOYMENT.md."
  exit 1
fi

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
echo "::notice::Supabase project ${SUPABASE_PROJECT_REF} (${label}) status: ${project_status:-unknown}"
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

# --- Failure evidence ---------------------------------------------------------
# Job logs live on Azure blob storage and often cannot be downloaded, so the
# annotations and the step summary are the only failure text a reader (or an
# agent working from `gh api …/annotations`) ever sees. Every failure path
# therefore prints what the server actually said — verbatim, password-scrubbed,
# `::`-escaped — rather than a paraphrase of it.
scrub_line() {
  local line="${1//$'\r'/}"
  line="${line//"${SUPABASE_DB_PASSWORD}"/***}"
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    line="${line//"${SUPABASE_ACCESS_TOKEN}"/***}"
  fi
  printf '%s' "${line//::/: :}"
}

# The last ERROR: line plus the context the CLI prints under it: the DETAIL, the
# offending statement and `At statement: N`. A keyword grep alone hides the
# statement text, which is the one line that says what the database refused.
push_failure_context() {
  local source="$1" limit="${2:-7}" start
  start="$(grep -nE '^[[:space:]]*ERROR: ' "${source}" | tail -n 1 | cut -d: -f1 || true)"
  if [[ -n "${start}" ]]; then
    sed -n "${start},$((start + limit))p" "${source}"
  else
    tail -n "$((limit + 3))" "${source}"
  fi
}

# The server's own lines, as annotations (GitHub caps them per step, and the
# password must never appear in one).
annotate_push_failure_context() {
  local source="$1" line
  while IFS= read -r line; do
    line="$(scrub_line "${line}")"
    [[ -z "${line}" ]] && continue
    echo "::error::${line:0:400}"
  done < <(push_failure_context "${source}")
}

# Full tail of the push output in the step summary. $3 (optional) is appended
# verbatim — the read-only inspection, when there was one.
summarize_push_failure() {
  local source="$1" heading="$2" extra="${3:-}"
  [[ -n "${GITHUB_STEP_SUMMARY:-}" ]] || return 0
  {
    echo "### supabase db push failed (${label})"
    echo
    echo "$(scrub_line "${heading}")"
    echo
    echo "Project status: ${project_status:-unknown}"
    echo
    echo '```'
    python3 -c '
import os, sys
text = open(sys.argv[1], encoding="utf-8", errors="replace").read()
for name in ("SUPABASE_DB_PASSWORD", "SUPABASE_ACCESS_TOKEN"):
    secret = os.environ.get(name)
    if secret:
        text = text.replace(secret, "***")
print("\n".join(text.splitlines()[-80:]))
' "${source}"
    echo '```'
    if [[ -n "${extra}" ]]; then
      echo
      echo "#### Read-only inspection of the live object"
      echo
      echo '```'
      printf '%s\n' "${extra}"
      echo '```'
    fi
  } >> "${GITHUB_STEP_SUMMARY}"
}

# heading + the server's own lines + the step summary, for the paths that have
# not already announced themselves.
report_push_failure() {
  local source="$1" heading="$2" extra="${3:-}"
  echo "::error::$(scrub_line "${heading}")"
  annotate_push_failure_context "${source}"
  summarize_push_failure "${source}" "${heading}" "${extra}"
}

# Optional read-only inspection. A diagnostic failure is captured as UNKNOWN,
# never substituted for the original push exit status. Keep a short overview in
# annotations and the full report in the summary. The API token is privileged;
# safety comes from catalog SELECTs/read_only=true, not from the token itself.
forensics_report=""
inspect_remote_object() {
  local object_name="$1" version="$2"
  forensics_report=""
  [[ "${forensics}" == "1" ]] || return 0
  [[ -f "${repo_root}/scripts/ci/remote-schema-forensics.sh" ]] || return 0
  local args=(--label "${label}")
  [[ -n "${object_name}" ]] && args+=(--relation "${object_name}")
  [[ -n "${version}" ]] && args+=(--version "${version}")
  forensics_report="$(bash "${repo_root}/scripts/ci/remote-schema-forensics.sh" "${args[@]}" 2>&1 || true)"
  [[ -n "${forensics_report}" ]] || return 0
  printf '%s\n' "${forensics_report}" | awk '/^(Read-only inspection:|Ownership|  public\.|  version |  UNKNOWN:)/ { if (n++ < 7) print }' | while IFS= read -r line; do
    line="$(scrub_line "${line}")"
    [[ -z "${line}" ]] && continue
    echo "::notice::${line:0:400}"
  done
}

# --- 3. Push migrations (retried) ---------------------------------------------
# The pooler occasionally drops the first connection from a fresh runner
# ("failed to receive message (timeout: context deadline exceeded)"). Retrying
# succeeds once the pooled connection warms up. Persistent failures leave their
# actual error/context in annotations and the step summary (no credential debug logs).
#
# Deterministic failures are not retried: when the remote history table knows
# migration versions this checkout does not, `db push` fails identically every
# time (see "Migration-history drift handling" in the header). Those get one
# history-table repair and an immediate re-push instead of burning the retry
# budget on a guaranteed-identical failure.
push_output="$(mktemp)"
trap 'rm -f "${push_output}"' EXIT
drift_repaired=0
attempt=1
max_attempts=3
while :; do
  set +e
  supabase db push --password "${SUPABASE_DB_PASSWORD}" --include-all 2>&1 \
    | sed -E $'s/\x1B\[[0-9;]*[mK]//g' | tee "${push_output}" \
    | while IFS= read -r line; do printf '%s\n' "$(scrub_line "${line}")"; done
  push_status=${PIPESTATUS[0]}
  set -e

  if ((push_status == 0)); then
    break
  fi

  server_error="$(grep -E '^[[:space:]]*ERROR: ' "${push_output}" | tail -n 1 || true)"
  sqlstate="$(printf '%s\n' "${server_error}" | sed -nE 's/.*\(SQLSTATE ([0-9A-Z]{5})\).*/\1/p')"

  # Duplicate-version check: history-table INSERT collided, which means two
  # local files share a version prefix (see the pre-flight above; it can be
  # bypassed by a checkout that changed after it ran). Deterministic — no retry.
  if [[ "${server_error}" == *'duplicate key value violates unique constraint "schema_migrations_pkey"'* ]]; then
    collided="$(grep -oE 'Key \(version\)=\([0-9]+\) already exists' "${push_output}" | grep -oE '[0-9]+' | head -n 1 || true)"
    echo "::error::supabase db push for ${label} could not record migration version ${collided:-<unknown>}: another file in supabase/migrations already owns that version (schema_migrations is keyed by it)."
    for f in "${migrations_dir}/${collided}"_*.sql; do
      [[ -e "${f}" ]] && echo "::error::  $(basename "${f}")"
    done
    echo "::error::Rename only the newer unapplied file to a unique version, keeping replay order. Not retrying."
    annotate_push_failure_context "${push_output}"
    summarize_push_failure "${push_output}" 'Duplicate migration version; migration history was not repaired.'
    exit 1
  fi

  # Namespace guard (SQLSTATE 55000, pre-fix 20261028000001): the old exact-
  # signature guard aborted with "public.projects is not the known Phase A
  # table" when staging's public.projects was a genuine but evolved Phase A
  # table or an unrelated legacy relation. Deterministic — the same schema
  # state produces the same error on every attempt, and retrying burned all
  # three attempts before reporting it. Current migrations adopt an evolved
  # Phase A table by core-definition identity and preserve an unrelated
  # relation instead of raising, so this branch only fires for a checkout
  # that still carries the old guard. Fail fast with the reconciliation path.
  if [[ "${server_error}" == *'Cannot namespace construction projects'* || "${server_error}" == *'public.projects is not the known Phase A table'* ]]; then
    echo "::error::supabase db push for ${label} hit the construction-projects namespace guard (SQLSTATE 55000): public.projects was not recognized as the Phase A table. This is deterministic; not retrying."
    echo "::error::Do not drop public.projects or mark 20261028000001 applied. Run the read-only queries in scripts/database/diagnose-projects-namespace.sql against ${label}, then deploy the current migrations (they adopt an evolved Phase A table and preserve an unrelated legacy relation). See docs/database/database-operations.md section 11."
    annotate_push_failure_context "${push_output}"
    summarize_push_failure "${push_output}" 'Construction namespace guard; no history repair performed.'
    exit 1
  fi

  # Only explicitly transient SQLSTATEs are retried. A NOTICE is never an
  # error, and an unknown CLI failure is not claimed to be a database collision.
  transient=0
  case "${sqlstate}" in
    08???|40001|40P01|55P03|57014|57P01|57P02|57P03|53300) transient=1 ;;
  esac
  if [[ -n "${sqlstate}" && "${transient}" == "0" ]]; then
    message="${server_error##*ERROR: }"
    message="${message%%(SQLSTATE*}"
    message="$(printf '%s' "${message}" | sed -E 's/[[:space:]]+$//')"
    applied_file="$(grep -oE 'Applying migration [^[:space:]]+\.sql' "${push_output}" | tail -n 1 | awk '{print $3}' || true)"
    applied_version="${applied_file%%_*}"
    statement_no="$(grep -oE 'At statement: [0-9]+' "${push_output}" | tail -n 1 | awk '{print $3}' || true)"

    # The object the message names, when it names one. `column "c" of relation
    # "r"` names both, so it is matched before the single-object form.
    object_kind="" object_name=""
    if printf '%s' "${message}" | grep -qE 'column "[^"]+" of relation "[^"]+"'; then
      object_kind="column"
      object_name="$(printf '%s' "${message}" | sed -E 's/.*column "([^"]+)" of relation "([^"]+)".*/\2.\1/')"
    else
      object_phrase="$(printf '%s' "${message}" | grep -oE '(materialized view|relation|index|view|sequence|schema|function|policy|constraint|trigger|type|column|role) "[^"]+"' | head -n 1 || true)"
      if [[ -n "${object_phrase}" ]]; then
        object_kind="${object_phrase%% *}"
        object_name="$(printf '%s' "${object_phrase}" | sed -E 's/^[a-z ]+"([^"]+)".*/\1/')"
      fi
    fi

    heading="supabase db push for ${label} stopped in ${applied_file:-<unknown migration>}${statement_no:+ at statement ${statement_no}}: ${message}. PostgreSQL reported SQLSTATE ${sqlstate}, not retrying this server error."
    echo "::error::$(scrub_line "${heading}")"
    annotate_push_failure_context "${push_output}"

    case "${sqlstate}" in
      42P07|42710|42701|42723|42P06)
        echo '::error::A same-named object exists, but its origin and schema equivalence are unconfirmed. Inspect the complete migration, live ownership/dependencies and remote history before any change. Do not drop, rename or mark the migration applied.'
        ;;
      42703|42704|42809|42883|42P01|42846|42804|42P13|55000)
        echo "::error::The migration and the live schema disagree about ${object_kind:-object} ${object_name:-<unknown>}: this project's shape is not the one the file was written against. Confirm what owns the name read-only (inspection below) before changing anything — do not drop, rename, or mark the version applied."
        ;;
    esac
    if [[ "${object_name}" == "projects" || "${object_name}" == "public.projects" ]]; then
      echo "::error::The construction feature now uses public.construction_projects. Do not drop public.projects or mark ${applied_file:-the migration} applied until you verify whether it is an unrelated legacy relation or a Phase A table and confirm the remote migration history. See docs/database/database-operations.md §11."
    fi
    if [[ "${object_name##*.}" == "project_status_log" ]]; then
      echo '::error::Inspect public.project_status_log read-only; matching names alone are insufficient. See scripts/database/diagnose-project-status-log.sql and docs/database/database-operations.md section 13.'
    fi

    # Inspect a relation only when the message named one; a bare
    # `column "x" does not exist` says which column but not whose, so the
    # inspection falls back to the contested construction relations.
    inspect_target=""
    case "${object_kind}" in
      relation|view|index|sequence|type) inspect_target="${object_name##*.}" ;;
      column) [[ "${object_name}" == *.* ]] && inspect_target="${object_name%%.*}" ;;
    esac
    inspect_remote_object "${inspect_target}" "${applied_version}"
    summarize_push_failure "${push_output}" "${heading}" "${forensics_report}"
    exit 1
  fi

  # Drift check: the CLI prints one "supabase migration repair --status
  # reverted <version>" hint line per remote-only version.
  drift_versions="$(grep -oE 'migration repair --status reverted [0-9]+' "${push_output}" \
    | awk '{print $NF}' | sort -u || true)"
  if [[ -z "${server_error}" && -n "${drift_versions}" ]] \
      && grep -q '^Remote migration versions not found in local migrations directory' "${push_output}"; then
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
    # A transient/unknown failure survived the retry budget. Preserve the
    # evidence without inventing a SQLSTATE or assuming a specific root cause.
    report_push_failure "${push_output}" \
      "supabase db push failed after ${max_attempts} attempts for ${label} (project status: ${project_status:-unknown}); transient or unclassified failure. Inspect the captured error context."
    exit 1
  fi
  echo "supabase db push failed (attempt ${attempt}/${max_attempts}) — retrying in $((attempt * 20))s ..."
  sleep $((attempt * 20))
  attempt=$((attempt + 1))
done

echo "Migrations pushed to ${label}."
