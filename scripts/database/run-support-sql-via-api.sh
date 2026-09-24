#!/usr/bin/env bash
# ============================================================================
# Run a support SQL file against a Supabase project via the Management API
# (POST /v1/projects/{ref}/database/query) — no database password required.
#
# Used by .github/workflows/repair-eagle-nova-double-count.yml.
# Reuses the same token the deploy and schema-capture workflows already use.
#
# USAGE
#   SUPABASE_ACCESS_TOKEN='sbp_...' \
#   SUPABASE_PROJECT_REF='hsuhuvuxfuufrlejsatw' \
#   SQL_FILE='scripts/repair-eagle-nova-double-count.sql' \
#   DRY_RUN=1 \
#   ./scripts/database/run-support-sql-via-api.sh
#
# DRY_RUN=1 (default) runs ONLY the read-only diagnostic statements and stops
# before any DO-block / UPDATE / INSERT / DELETE. DRY_RUN=0 runs the whole file.
#
# Statements are split on ';' at end of line (same convention as
# capture-staging-schema-via-api.sh) and exchanged with Python via NUL
# delimiters so multi-line SQL survives. Each statement is sent as its own
# Management API query. The access token is never logged or written to disk.
# ============================================================================
set -euo pipefail

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
REF="${SUPABASE_PROJECT_REF:-}"
SQL_FILE="${SQL_FILE:-}"
DRY_RUN="${DRY_RUN:-1}"
OUT_DIR="${OUT_DIR:-artifacts/support-sql}"

die() { printf 'FATAL: %s\n' "$*" >&2; exit 1; }
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%SZ)" "$*"; }

[[ -n "$TOKEN" ]] || die "SUPABASE_ACCESS_TOKEN is not set."
[[ -n "$REF" ]]   || die "SUPABASE_PROJECT_REF is not set."
[[ -n "$SQL_FILE" && -f "$SQL_FILE" ]] || die "SQL_FILE not found: ${SQL_FILE:-<unset>}"

case "$DRY_RUN" in
  1|true|TRUE|yes|YES) DRY_RUN=1 ;;
  0|false|FALSE|no|NO) DRY_RUN=0 ;;
  *) die "DRY_RUN must be 0 or 1 (got '$DRY_RUN')" ;;
esac

API_BASE="https://api.supabase.com/v1/projects/${REF}/database/query"
mkdir -p "$OUT_DIR"
: > "${OUT_DIR}/run.log"

log "Target project ${REF}; dry_run=${DRY_RUN}; file ${SQL_FILE}"

command -v curl >/dev/null || die "curl is required."
command -v python3 >/dev/null || die "python3 is required."

# ── Parse SQL into NUL-separated statements on fd 3 ────────────────────────
# Read-only start keywords allowed under DRY_RUN; anything else stops the list.
exec 3< <(python3 - "$SQL_FILE" "$DRY_RUN" <<'PYEOF'
import sys

path, dry_flag = sys.argv[1], sys.argv[2] == "1"
READ_ONLY = ("select", "with", "values", "show", "explain")

def body_of(stmt: str) -> str:
    return "\n".join(
        ln for ln in stmt.splitlines()
        if ln.strip() and not ln.strip().startswith("--")
    ).strip()

def emit(stmt: str) -> None:
    body = body_of(stmt)
    if not body:
        return
    first = body.lstrip().split()[0].lower()
    if dry_flag and first not in READ_ONLY:
        # Stop before the first mutating statement (the repair DO block).
        sys.exit(0)
    sys.stdout.buffer.write(stmt.encode() + b"\0")

# Dollar-quote aware splitter: inside $$ ... $$ (or $tag$ ... $tag$) a
# semicolon at end of line does NOT end the statement.
import re
dollar_tag = re.compile(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$")

raw = open(path).read()
# Drop full-line comments first (keep code lines).
lines = []
for line in raw.splitlines(keepends=True):
    if line.lstrip().startswith("--") or line.lstrip().startswith("\\"):
        continue
    lines.append(line)
text = "".join(lines)

buf: list[str] = []
i = 0
n = len(text)
open_tag = None  # current dollar-quote tag, None when outside
while i < n:
    if open_tag is None:
        m = dollar_tag.match(text, i)
        if m:
            open_tag = m.group(0)
            buf.append(open_tag)
            i = m.end()
            continue
        ch = text[i]
        buf.append(ch)
        i += 1
        # Statement ends on ';' that is followed by whitespace/newline/EOF
        # and is not inside a dollar quote (we are outside here).
        if ch == ";":
            # only split when ';' is at logical end — allow trailing spaces
            j = i
            while j < n and text[j] in " \t":
                j += 1
            if j >= n or text[j] == "\n":
                stmt = "".join(buf)
                buf = []
                emit(stmt)
                i = j
        continue
    # Inside a dollar quote — look for the matching close tag.
    if text.startswith(open_tag, i):
        buf.append(open_tag)
        i += len(open_tag)
        open_tag = None
        continue
    buf.append(text[i])
    i += 1

if "".join(buf).strip():
    emit("".join(buf))
PYEOF
)

# Drain fd 3 into an array of whole statements (NUL-separated).
STATEMENTS=()
while IFS= read -r -d '' stmt; do
  STATEMENTS+=("$stmt")
done <&3
exec 3<&-

if [[ ${#STATEMENTS[@]} -eq 0 ]]; then
  die "No statements parsed from ${SQL_FILE} (dry_run=${DRY_RUN})."
fi

log "Parsed ${#STATEMENTS[@]} statement(s) to run (dry_run=${DRY_RUN})."

FAILED=0
IDX=0
for stmt in "${STATEMENTS[@]}"; do
  IDX=$((IDX + 1))
  kind="$(python3 -c '
import sys
t = sys.argv[1]
body = "\n".join(l for l in t.splitlines() if l.strip() and not l.strip().startswith("--"))
parts = body.lstrip().split()
print(parts[0].upper() if parts else "EMPTY")
' "$stmt")"
  preview="$(printf '%s' "$stmt" | tr '\n' ' ' | head -c 120)"
  log "── statement ${IDX} (${kind}): ${preview}…"

  payload="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$stmt")"
  resp_file="${OUT_DIR}/stmt-${IDX}.json"

  if ! curl -sS --max-time 120 -X POST "$API_BASE" \
       -H "Authorization: Bearer ${TOKEN}" \
       -H "Content-Type: application/json" \
       -d "$payload" -o "$resp_file"; then
    log "FAIL statement ${IDX} (network error)"
    FAILED=1
    continue
  fi

  if python3 -c '
import json, sys
d = json.load(open(sys.argv[1]))
sys.exit(0 if isinstance(d, dict) and (d.get("message") or d.get("error")) else 1)
' "$resp_file" 2>/dev/null; then
    log "FAIL statement ${IDX}: $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(str(d.get("message") or d)[:300])' "$resp_file")"
    FAILED=1
    continue
  fi

  python3 - "$resp_file" "${OUT_DIR}/stmt-${IDX}.txt" <<'PYEOF'
import json, sys
data = json.load(open(sys.argv[1]))
rows = data.get("result") if isinstance(data, dict) and "result" in data else data
out = open(sys.argv[2], "w")
def cell(v):
    if v is None:
        return ""
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return str(v)
if isinstance(rows, list):
    for r in rows:
        if isinstance(r, dict):
            out.write("\t".join(cell(v) for v in r.values()) + "\n")
        elif isinstance(r, list):
            out.write("\t".join(cell(v) for v in r) + "\n")
        else:
            out.write(cell(r) + "\n")
else:
    out.write(str(rows) + "\n")
out.close()
PYEOF
  log "OK statement ${IDX} → ${OUT_DIR}/stmt-${IDX}.txt"
done

# Redact anything secret-shaped from outputs (same rules as the capture script)
find "$OUT_DIR" -type f \( -name '*.txt' -o -name '*.json' -o -name '*.log' \) -print0 \
  | while IFS= read -r -d '' f; do
      sed -i -E \
        -e 's/(eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*)/<REDACTED-JWT>/g' \
        -e 's/(sb_secret_[A-Za-z0-9]+)/<REDACTED>/g' \
        "$f" || true
    done

if [[ "$FAILED" -ne 0 ]]; then
  log "COMPLETED WITH FAILURES — see ${OUT_DIR}/"
  exit 1
fi
log "All statements succeeded → ${OUT_DIR}/"
