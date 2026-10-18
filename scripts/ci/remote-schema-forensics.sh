#!/usr/bin/env bash
# Read-only construction migration inspection, without a deploy or DB password.
# Uses the exact catalog queries in scripts/database/diagnose-project-status-log.sql
# with Management API read_only=true. A matching name/column list is NOT an
# ownership/equivalence verdict and never authorizes repair, rename or drop.
#
# Usage (credentials already supplied through the environment):
#   bash scripts/ci/remote-schema-forensics.sh --label production
# Optional --relation / --version are repeatable, validated identifiers/digits.
# A failed inspection exits nonzero and reports UNKNOWN; the deploy caller
# guards this status so diagnostics can never mask the original push failure.
set -uo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
label="${SUPABASE_ENV_LABEL:-supabase}"
relations=() versions=()
while (($#)); do
  case "$1" in
    --relation|--version|--label)
      if (($# < 2)); then echo "Inspection UNKNOWN: $1 requires a value."; exit 2; fi
      case "$1" in
        --relation) relations+=("${2#public.}") ;;
        --version) versions+=("$2") ;;
        --label) label="$2" ;;
      esac
      shift 2 ;;
    *) echo 'Inspection UNKNOWN: unsupported argument.'; exit 2 ;;
  esac
done
((${#relations[@]})) || relations=(projects construction_projects project_status_log project_status_log_project)
((${#versions[@]})) || versions=(20261028000000 20261028000001 20261029000000 20261030000000 20261031000000 20261031000001 20261101000000 20261102000000 20261103000000)
for relation in "${relations[@]}"; do
  if [[ ! "${relation}" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
    echo 'Inspection UNKNOWN: refusing a relation that is not a bare SQL identifier.'; exit 2
  fi
done
for version in "${versions[@]}"; do
  if [[ ! "${version}" =~ ^[0-9]{8,14}$ ]]; then
    echo 'Inspection UNKNOWN: refusing an invalid migration version.'; exit 2
  fi
done
if ((${#relations[@]} > 20 || ${#versions[@]} > 30)); then
  echo 'Inspection UNKNOWN: too many requested objects/versions.'; exit 2
fi
if [[ -z "${SUPABASE_PROJECT_REF:-}" || -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo 'Inspection UNKNOWN: SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.'
  echo 'Alternatively run scripts/database/diagnose-project-status-log.sql in the SQL editor (read-only).'
  exit 1
fi
if [[ ! "${SUPABASE_PROJECT_REF}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo 'Inspection UNKNOWN: invalid project reference.'; exit 2
fi
workdir="$(mktemp -d)" || exit 1
trap 'rm -rf "${workdir}"' EXIT
export FORENSICS_DIR="${workdir}" FORENSICS_ROOT="${root}" FORENSICS_LABEL="${label}"
export FORENSICS_RELATIONS="${relations[*]}" FORENSICS_VERSIONS="${versions[*]}"

# Build one request per catalog topic so a missing history schema, for example,
# cannot prevent inspecting the existing relation. Only validated values are
# interpolated. Queries are shared with the standalone SQL-editor runbook.
python3 <<'PY' || exit 1
import json, os, re
from pathlib import Path
sql = (Path(os.environ['FORENSICS_ROOT']) / 'scripts/database/diagnose-project-status-log.sql').read_text()
for marker, env in [('relations', 'FORENSICS_RELATIONS'), ('versions', 'FORENSICS_VERSIONS')]:
    values = ','.join("'" + value + "'" for value in os.environ[env].split())
    sql = re.sub(r'/\* ' + marker + r' \*/ ARRAY\[[^\]]*\]', 'ARRAY[' + values + ']', sql)
sections = re.split(r'^-- @query (\w+)\s*$', sql, flags=re.M)
for topic, query in zip(sections[1::2], sections[2::2]):
    if topic not in ('relations', 'functions', 'history', 'head'):
        raise ValueError('Unexpected inspection topic')
    query = query.strip()
    if not re.match(r'^(WITH|SELECT)\b', query):
        raise ValueError('Only catalog SELECTs may be sent')
    path = Path(os.environ['FORENSICS_DIR']) / (topic + '.request.json')
    path.write_text(json.dumps({'query': query, 'read_only': True}))
PY

for topic in relations functions history head; do
  payload="${workdir}/${topic}.json"
  if ! curl --silent --show-error --fail-with-body --max-time 30 \
      --output "${payload}" --request POST \
      --header "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      --header 'Content-Type: application/json' \
      --data-binary "@${workdir}/${topic}.request.json" \
      "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query"; then
    # Do not print error bodies; they may be HTML or contain credentials. Never
    # turn an HTTP/network failure into a successful empty catalog result.
    printf '%s' '{"inspection_error":"Management API request failed"}' > "${payload}"
  fi
done

python3 <<'PY'
import hashlib, json, os, sys
from pathlib import Path
root = Path(os.environ['FORENSICS_ROOT'])
workdir = Path(os.environ['FORENSICS_DIR'])
relations = os.environ['FORENSICS_RELATIONS'].split()
versions = os.environ['FORENSICS_VERSIONS'].split()
errors = []
output = [f"Read-only inspection: {os.environ['FORENSICS_LABEL']} / {os.environ['SUPABASE_PROJECT_REF']}",
          'Catalog SELECTs only; no relation or migration history was changed.',
          'Ownership and full schema equivalence still require review against the complete migration.', '']

for topic in ('relations', 'functions', 'history', 'head'):
    output.append(topic.upper())
    try:
        rows = json.loads((workdir / (topic + '.json')).read_text())
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise ValueError('Catalog response was not an array of rows')
        if topic == 'relations':
            if {row.get('name') for row in rows} != set(relations):
                raise ValueError('Incomplete relation catalog response')
            for row in rows:
                # A missing relation can still have a standalone type occupying
                # the namespace; print both rather than calling the name free.
                state = ('EXISTS' if row.get('qualified_name') else
                         'TYPE ONLY' if row.get('same_named_type') else 'ABSENT')
                output.append(f"  public.{row['name']}: {state}; owner={row.get('owner')}; relkind={row.get('relkind')}")
        elif topic == 'history':
            recorded = {row.get('version') for row in rows}
            for version in versions:
                output.append(f"  version {version}: {'RECORDED' if version in recorded else 'NOT RECORDED'}")
        elif topic == 'head' and (len(rows) != 1 or 'remote_head' not in rows[0]):
            raise ValueError('Incomplete history head response')
        output.append(json.dumps(rows, indent=2, ensure_ascii=False))
    except (ValueError, OSError) as error:
        errors.append(topic)
        output.append(f'  UNKNOWN: {topic} inspection failed ({error}).')
        # An unavailable history query proves neither applied nor pending.
    output.append('')

output.append('LOCAL MIGRATION SOURCES (review the entire file, not just CREATE TABLE)')
for version in versions:
    for path in sorted((root / 'supabase/migrations').glob(version + '_*.sql')):
        output.append(f'  {path.name} sha256={hashlib.sha256(path.read_bytes()).hexdigest()}')
output += ['', 'No automatic adoption, rename, drop, FK repair or migration-history repair is authorized by this report.',
           'Compare defaults, PK/FK targets and actions, indexes, RLS/policies, grants, triggers, dependents and RPC signatures.',
           'Recovery guidance: docs/database/database-operations.md section 13.']
if errors:
    output.append('Inspection incomplete: run scripts/database/diagnose-project-status-log.sql on the affected project.')
text = '\n'.join(output)
for env in ('SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD'):
    secret = os.environ.get(env)
    if secret:
        text = text.replace(secret, '***')
print(text)
sys.exit(1 if errors else 0)
PY
