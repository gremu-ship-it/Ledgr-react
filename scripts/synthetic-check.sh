#!/usr/bin/env bash
# Ledgr — synthetic uptime check (Phase 10.4).
#
# Checks (1) the frontend login page renders (non-blank, catches the A-01
# blank-page class of incident) and (2) the gateway health endpoint. Run
# from CI (cron) or a scheduler; exits non-zero on failure so it can page.
#
#   ./scripts/synthetic-check.sh https://ledgr-react.vercel.app
#
set -euo pipefail

BASE_URL="${1:-https://ledgr-react.vercel.app}"
EXPECT_MARKER="${2:-Ledgr}"

fail() { echo "SYNTHETIC CHECK FAIL: $1" >&2; exit 1; }

echo "== Checking $BASE_URL =="

# 1) Frontend renders (non-blank, contains a known marker or at least a root).
HTML="$(curl -fsS --max-time 20 -A 'ledgr-synthetic-check' "$BASE_URL/" || fail "frontend unreachable (HTTP error)")"
if [ -z "$HTML" ]; then fail "frontend returned empty body"; fi
# The SPA shell may be tiny; ensure it contains the root mount + a script
# bundle reference (blank-page incidents shipped an empty shell).
if ! echo "$HTML" | grep -q 'id="root"'; then fail "frontend shell missing #root (possible blank-page regression)"; fi
if ! echo "$HTML" | grep -qE 'src="[^"]+\.js"'; then fail "frontend shell missing JS bundle references"; fi
echo "OK frontend renders (shell + bundle refs present)"

# 2) Gateway health (if the gateway is deployed at /api/health).
if curl -fsS --max-time 10 "$BASE_URL/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
  echo "OK gateway /api/health"
else
  echo "WARN gateway /api/health not reachable at $BASE_URL (may not be deployed on this host — not fatal)"
fi

echo "SYNTHETIC CHECK PASS"
