#!/usr/bin/env bash
# ============================================================================
# Read-only forensics for a `supabase db push` object collision.
#
# WHY THIS EXISTS
# ---------------
# On 2026-10-18 the production deploy (Deploy #224, run 39118959766) burned all
# three of its push attempts on one deterministic error:
#
#   ERROR: relation "projects" already exists (SQLSTATE 42P07)
#
# The log could not answer the only question that matters: WHAT is the object
# that is already there? `supabase db push` reports the collision and nothing
# about the live database, and job logs live on Azure blob storage that this
# network often cannot download — so the reader is left guessing between
#   (a) this migration's own objects, applied by hand outside `db push`
#       (the SQL editor / psql commits every statement it runs and records no
#       version in supabase_migrations.schema_migrations), and
#   (b) somebody else's object that happens to own the name — a legacy table,
#       which a deploy must never silently adopt, rename or drop.
# The two need opposite responses: (a) converges on a re-apply, (b) is an owner
# decision. This script prints the evidence that tells them apart.
#
# It uses the Management API SQL endpoint (the same read-only path
# scripts/database/run-support-sql-via-api.sh and schema-drift.yml use), so it
# needs no database password and never writes: two SELECTs against pg_catalog
# and supabase_migrations.schema_migrations.
#
# USAGE
#   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \
#     bash scripts/ci/migration-conflict-forensics.sh \
#       <object-kind> <object-name> <migration-file> <migration-version>
#
# Best effort by contract: it always exits 0, so it can never replace or mask
# the failure the caller is reporting. Output goes to stdout, to a small number
# of GitHub annotations, and to $GITHUB_STEP_SUMMARY when set.
# ============================================================================
set -uo pipefail

kind="${1:-relation}"
name="${2:-}"
migration_file="${3:-}"
version="${4:-}"

ref="${SUPABASE_PROJECT_REF:-}"
token="${SUPABASE_ACCESS_TOKEN:-}"

if [[ -z "${ref}" || -z "${token}" ]]; then
  echo "Collision forensics skipped: SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN is not set."
  exit 0
fi
# The name is interpolated into SQL, so it is restricted to a bare identifier.
# Anything else (quoted, schema-qualified or exotic) is reported, not queried.
if [[ ! "${name}" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
  echo "Collision forensics skipped: '${name}' is not a bare SQL identifier; query the database directly."
  exit 0
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "Collision forensics skipped: python3 is not available."
  exit 0
fi

API="https://api.supabase.com/v1/projects/${ref}/database/query"
work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT

# --- 1. What is the object that is already there? ---------------------------
shape_sql="WITH target AS (SELECT to_regclass('public.${name}') AS oid)
SELECT (SELECT oid::text FROM target) AS qualified_name,
       (SELECT c.relkind FROM pg_class c WHERE c.oid = (SELECT oid FROM target)) AS relkind,
       (SELECT count(*) FROM pg_attribute a
         WHERE a.attrelid = (SELECT oid FROM target) AND a.attnum > 0 AND NOT a.attisdropped) AS column_count,
       (SELECT string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                          || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END, ', ' ORDER BY a.attnum)
          FROM pg_attribute a
         WHERE a.attrelid = (SELECT oid FROM target) AND a.attnum > 0 AND NOT a.attisdropped) AS columns,
       (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = (SELECT oid FROM target)) AS rls_enabled,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = (SELECT oid FROM target)) AS policy_count,
       (SELECT count(*) FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM target)) AS constraint_count,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid = (SELECT oid FROM target)) AS index_count,
       (SELECT count(*) FROM pg_trigger t
         WHERE t.tgrelid = (SELECT oid FROM target) AND NOT t.tgisinternal) AS trigger_count,
       (SELECT c.reltuples::bigint FROM pg_class c WHERE c.oid = (SELECT oid FROM target)) AS approx_rows,
       (SELECT count(*) FROM supabase_migrations.schema_migrations
         WHERE version = '${version}') AS version_recorded,
       (SELECT max(m.version) FROM supabase_migrations.schema_migrations m) AS remote_head;"

# --- 2. Which recorded versions sit around the failing one? -----------------
history_sql="SELECT version, coalesce(name, '') AS name
FROM supabase_migrations.schema_migrations
ORDER BY version DESC
LIMIT 12;"

query() {
  # $1 = SQL, $2 = output file. Transport failures leave an empty file.
  local sql="$1" out="$2" payload
  : > "${out}"
  payload="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "${sql}")" || return 0
  curl -sS --max-time 45 -X POST "${API}" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "${payload}" -o "${out}" >/dev/null 2>&1 || true
}

query "${shape_sql}" "${work}/shape.json"
query "${history_sql}" "${work}/history.json"

report="$(
  COLLISION_KIND="${kind}" COLLISION_NAME="${name}" COLLISION_FILE="${migration_file}" \
  COLLISION_VERSION="${version}" COLLISION_REF="${ref}" \
  COLLISION_SHAPE="${work}/shape.json" COLLISION_HISTORY="${work}/history.json" \
  python3 - <<'PY'
import json, os

kind = os.environ["COLLISION_KIND"]
name = os.environ["COLLISION_NAME"]
migration_file = os.environ["COLLISION_FILE"]
version = os.environ["COLLISION_VERSION"]
ref = os.environ["COLLISION_REF"]


def load(path):
    try:
        raw = open(path, encoding="utf-8", errors="replace").read().strip()
    except OSError:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except Exception:
        return {"__error__": raw[:300]}
    if isinstance(data, dict):
        # The API answers {"message": ...} / {"error": ...} when it refuses.
        return {"__error__": str(data.get("message") or data.get("error") or data)[:300]}
    return data if isinstance(data, list) else {"__error__": str(data)[:300]}


shape = load(os.environ["COLLISION_SHAPE"])
history = load(os.environ["COLLISION_HISTORY"])

def literal(value):
    """Postgres-flavoured literals: the report reads like a psql answer."""
    if isinstance(value, bool):
        return "true" if value else "false"
    return value


RELKINDS = {
    "r": "table", "i": "index", "S": "sequence", "t": "TOAST table",
    "v": "view", "m": "materialised view", "c": "composite type",
    "p": "partitioned table", "I": "partitioned index",
}

lines = [
    f'Live database forensics for the collision on {kind} "{name}" (project {ref})',
    f"Migration file: {migration_file or '<unknown>'}   Version: {version or '<unknown>'}",
    "",
]

row = {}
if isinstance(shape, dict):
    lines.append(f"Management API refused the read-only shape query: {shape['__error__']}")
elif isinstance(shape, list) and shape and isinstance(shape[0], dict):
    row = shape[0]
else:
    lines.append("No shape row returned; the Management API query could not be answered.")

if row:
    recorded_raw = str(row.get("version_recorded") or "0")
    recorded = recorded_raw.isdigit() and int(recorded_raw) > 0
    lines.append(f"Object: {row.get('qualified_name') or f'public.{name}'} "
                 f"({RELKINDS.get(row.get('relkind'), row.get('relkind'))})")
    lines.append(f"Columns ({row.get('column_count')}): {row.get('columns') or '<none>'}")
    lines.append(
        f"RLS enabled: {literal(row.get('rls_enabled'))}   policies: {row.get('policy_count')}   "
        f"constraints: {row.get('constraint_count')}   indexes: {row.get('index_count')}   "
        f"triggers: {row.get('trigger_count')}"
    )
    lines.append(f"Approximate rows (planner estimate): {row.get('approx_rows')}")
    lines.append(f"Version {version or '<unknown>'} recorded in supabase_migrations.schema_migrations: {literal(recorded)}")
    lines.append(f"Remote migration head: {row.get('remote_head')}")
    lines.append("")
    if row.get("qualified_name") is None:
        lines.append(
            f"VERDICT: public.{name} does NOT exist now. Either the collision came from a "
            "different object of the same name (an index, policy or constraint — read the "
            "error text again) or the database changed since the push. Re-run the deploy."
        )
    elif recorded:
        lines.append(
            "VERDICT: the version IS recorded, so this is not a missing-history case. The push "
            "was pointed at a project that already has these objects, or its history and its "
            "schema disagree. Stop and inspect before re-running."
        )
    else:
        lines.append(
            "VERDICT: the object is live but its migration version is NOT recorded — these "
            "objects reached the database outside `supabase db push` (a hand application "
            "commits what it runs and records no version). Compare the column list above with "
            "the CREATE TABLE in the migration file:"
        )
        lines.append(
            "  * they match   -> it is this migration's own shape: make the file converge "
            "(IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE / ADD COLUMN IF NOT "
            "EXISTS) and re-run, or — after checking the shapes by eye — record the version "
            f"with `supabase migration repair --status applied {version or '<version>'}`."
        )
        lines.append(
            f"  * they differ  -> a foreign object owns the name. Do not let a deploy adopt or "
            f"drop it: inspect it, then move it aside (ALTER TABLE public.{name} RENAME TO "
            f"legacy_{name}_pre_construction;) or reconcile it, and re-run."
        )

if isinstance(history, list) and history:
    lines += ["", "Most recent recorded versions on this project:"]
    for entry in history[:12]:
        if isinstance(entry, dict):
            lines.append(f"  {entry.get('version')}  {entry.get('name') or ''}".rstrip())
elif isinstance(history, dict):
    lines.append(f"History query refused: {history['__error__']}")

print("\n".join(lines))
PY
)"

if [[ -z "${report}" ]]; then
  echo "Collision forensics produced no report (Management API unreachable or refused)."
  exit 0
fi

printf '%s\n' "${report}"

# Job logs often cannot be downloaded, so the load-bearing lines also go out as
# annotations. GitHub caps annotations per step: keep this under eight.
echo "::warning::public.${name} is live on ${ref} while version ${version:-<unknown>} is not recorded in supabase_migrations.schema_migrations."
while IFS= read -r line; do
  case "${line}" in
    VERDICT:*|"Object:"*|Columns*|"Version ${version:-<unknown>} recorded"*)
      echo "::warning::${line:0:400}"
      ;;
  esac
done <<< "${report}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo "### Migration collision forensics (${ref})"
    echo
    echo '```'
    printf '%s\n' "${report}"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY}"
fi

exit 0
