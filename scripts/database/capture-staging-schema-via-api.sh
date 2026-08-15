#!/usr/bin/env bash
# ============================================================================
# Ledgr — Phase 8A.1 — Read-only staging schema capture via the Supabase
# Management API (NO database password required)
# ============================================================================
# Same read-only capture as capture-staging-schema.sh, but transports the
# queries over the Supabase Management API
#     POST https://api.supabase.com/v1/projects/{ref}/database/query
# authenticated with the project access token (the same SUPABASE_ACCESS_TOKEN
# the deploy workflow already uses). The DB password is never needed.
#
# SAFETY RULES
# ------------
#   1. Refuses to run unless the environment passes isolation checks:
#        LEDGR_ENV=staging
#        STAGING_SUPABASE_PROJECT_REF is set and != PRODUCTION_SUPABASE_PROJECT_REF
#        SUPABASE_ACCESS_TOKEN is set
#   2. Every statement issued is read-only (SELECT / SHOW / pg_get_*def).
#      The SQL file contains no DDL, no DML, no writes of any kind.
#   3. Output is written to artifacts/database/capture/ and is redacted:
#      anything that looks like a secret is masked before artifacts are
#      written. The access token is never logged and never written to disk.
#   4. The script NEVER connects to production.
#
# USAGE
# -----
#   LEDGR_ENV=staging \
#   STAGING_SUPABASE_PROJECT_REF=<ref> \
#   PRODUCTION_SUPABASE_PROJECT_REF=<ref> \
#   SUPABASE_ACCESS_TOKEN='sbp_...' \
#   ./scripts/database/capture-staging-schema-via-api.sh
#
#   (Optional override for testing: SUPABASE_API_BASE)
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${REPO_ROOT}/artifacts/database/capture"
SQL_FILE="${REPO_ROOT}/scripts/database/capture-staging-schema.sql"

log()  { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "${OUT_DIR}/capture.log"; }
die()  { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

# ── Step 1: environment isolation verification ─────────────────────────────
if [[ "${LEDGR_ENV:-}" != "staging" ]]; then
  die "LEDGR_ENV must be exactly 'staging' (got '${LEDGR_ENV:-<unset>}'). Refusing to run."
fi

STAGING_REF="${STAGING_SUPABASE_PROJECT_REF:-}"
PROD_REF="${PRODUCTION_SUPABASE_PROJECT_REF:-}"
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"

[[ -n "$STAGING_REF" ]] || die "STAGING_SUPABASE_PROJECT_REF is not set. Refusing to run."
[[ -n "$PROD_REF" ]]    || die "PRODUCTION_SUPABASE_PROJECT_REF is not set. Refusing to run."
[[ -n "$TOKEN" ]]       || die "SUPABASE_ACCESS_TOKEN is not set. Refusing to run."

if [[ "$STAGING_REF" == "$PROD_REF" ]]; then
  die "ENVIRONMENT ISOLATION FAILURE: STAGING_SUPABASE_PROJECT_REF == PRODUCTION_SUPABASE_PROJECT_REF == '${STAGING_REF}'. Will not connect."
fi

API_BASE="${SUPABASE_API_BASE:-https://api.supabase.com/v1/projects/${STAGING_REF}/database/query}"
case "$API_BASE" in
  *"/projects/${STAGING_REF}/"*) : ;;
  *) die "ENVIRONMENT ISOLATION FAILURE: API base does not target project ${STAGING_REF}. Will not connect." ;;
esac

mkdir -p "$OUT_DIR"
: > "${OUT_DIR}/capture.log"

log "Environment OK: LEDGR_ENV=${LEDGR_ENV}, staging ref=${STAGING_REF} (distinct from production ref=${PROD_REF})"
log "Capturing read-only schema from project ${STAGING_REF} via Management API"

command -v curl >/dev/null || die "curl is required."
command -v python3 >/dev/null || die "python3 is required."

# ── Step 2: parse the read-only SQL file into (artifact, statement) pairs ──
# Statements end with ';' at end of line. Lines starting with '\' are psql
# meta-commands and are skipped. The preceding '-- @artifact <name>' marker
# names the output file.
STATEMENTS="$(python3 - "$SQL_FILE" <<'PYEOF'
import sys
name = None
buf = []
pairs = []
for line in open(sys.argv[1]):
    s = line.rstrip("\n")
    t = s.strip()
    if t.startswith("-- @artifact "):
        name = t.split(None, 2)[2]
    elif t.startswith("--") or t.startswith("\\") or not t:
        continue
    else:
        buf.append(s)
        if t.endswith(";"):
            pairs.append((name, "\n".join(buf)))
            buf = []
            name = None
if buf:
    raise SystemExit(f"unterminated statement: {buf[0][:80]}")
for n, q in pairs:
    if not n:
        raise SystemExit(f"statement missing @artifact marker: {q[:80]}")
    print(n + "\t" + q.replace("\n", " "))
PYEOF
)"

FAILED=0
RENDER="$(cat <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
rows = data.get("result") if isinstance(data, dict) and "result" in data else data
if isinstance(data, dict) and ("message" in data or "error" in data):
    print("ERROR:", data)
    sys.exit(1)
if not isinstance(rows, list):
    print(json.dumps(rows))
    sys.exit(0)
def cell(v):
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)
for r in rows:
    if isinstance(r, dict):
        print("\t".join(cell(v) for v in r.values()))
    elif isinstance(r, list):
        print("\t".join(cell(v) for v in r))
    else:
        print(cell(r))
PYEOF
)"

while IFS=$'\t' read -r name query; do
  [[ -n "$name" ]] || continue
  payload="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$query")"
  log "querying ${name} ..."
  if ! curl -sS --max-time 120 -X POST "$API_BASE" \
       -H "Authorization: Bearer ${TOKEN}" \
       -H "Content-Type: application/json" \
       -d "$payload" -o "${OUT_DIR}/${name}.json" 2>>"${OUT_DIR}/capture.log"; then
    log "FAIL ${name} (network/HTTP error)"
    FAILED=1
    continue
  fi
  if ! python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "${OUT_DIR}/${name}.json" 2>/dev/null; then
    log "FAIL ${name} (non-JSON response)"
    FAILED=1
    continue
  fi
  if grep -q '"message"' "${OUT_DIR}/${name}.json"; then
    log "FAIL ${name} (API error: $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("message") or d)' "${OUT_DIR}/${name}.json" | head -c 200))"
    FAILED=1
    continue
  fi
  python3 -c "$RENDER" "${OUT_DIR}/${name}.json" > "${OUT_DIR}/${name}.txt" || { log "FAIL ${name} (render)"; FAILED=1; }
done <<< "$STATEMENTS"

# ── Step 3: redaction pass ─────────────────────────────────────────────────
log "Redacting potential secrets from captured artifacts"
find "${OUT_DIR}" -type f \( -name '*.txt' -o -name '*.json' \) -print0 | while IFS= read -r -d '' f; do
  sed -i -E \
    -e 's/(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)/<REDACTED-JWT>/g' \
    -e 's/((secret|token|password|key|apikey|api_key)[A-Za-z_-]*[[:space:]]*=[[:space:]]*['"'"'"]?)[A-Za-z0-9_\-\.]{8,}/\1<REDACTED>/Ig' \
    -e "s/((secret|token|password|key)[A-Za-z_-]*[[:space:]]*:)[[:space:]]*['\"][^'\"]{8,}['\"]/\1 <REDACTED>/Ig" \
    -e 's/(sb_secret_[A-Za-z0-9]+)/<REDACTED>/g' \
    "$f" || true
done

if [[ "$FAILED" -ne 0 ]]; then
  log "Capture COMPLETED WITH FAILURES (see capture.log) — artifacts are partial."
  exit 1
fi

log "Capture complete → ${OUT_DIR}"
log "Next: rebuild the authoritative inventory from these files."
