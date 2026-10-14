#!/usr/bin/env bash
# ============================================================================
# Prove that the LIVE frontend is this commit and expects this migration
# target (IC 2026-09-25 P9). Run by deploy.yml right after `vercel deploy
# --prod`, for staging and production.
#
# Why it polls
# ------------
# Vercel moves the production alias to a new deployment asynchronously, so
# for a short while after `vercel deploy --prod` returns, the alias can still
# serve the PREVIOUS deployment. A single immediate read then reports the
# previous release even though the new one goes live moments later. That
# happened on staging on 2026-10-09: run 37897960711 read
# "commit=016acab… expected 34d5fa4…" and the next run found 34d5fa4 live.
# Later, `vercel promote` answered "already the current production
# deployment", so promotion itself was fine. The check now re-reads until the
# expected commit is served, and fails only if it still isn't after
# VERSION_CHECK_ATTEMPTS reads, VERSION_CHECK_INTERVAL_SECONDS apart
# (default 30 x 10 s, about five minutes).
#
# Which URL
# ---------
# FRONTEND_CANONICAL_URL (vars.STAGING_URL / vars.PRODUCTION_URL, the URL
# users actually visit) when configured. Otherwise FRONTEND_URL, the alias
# the deploy step captured from the Vercel CLI output.
#
# Outcomes. Same as the inline step this replaces, apart from the polling:
#   expected commit + target served        -> exit 0
#   no URL at all                          -> warning, exit 0
#   first read is not JSON (e.g. a Vercel  -> warning, exit 0 (see #188)
#     deployment-protection page)
#   an older release is still served on    -> error, exit 1
#     the last read
#
# Env:
#   GITHUB_SHA, MIGRATION_TARGET      required: what must be live
#   FRONTEND_CANONICAL_URL            optional: preferred URL
#   FRONTEND_URL                      optional: fallback URL
#   GITHUB_RUN_ID                     optional: cache-buster
#   VERSION_CHECK_ATTEMPTS            optional, default 30
#   VERSION_CHECK_INTERVAL_SECONDS    optional, default 10
# ============================================================================
set -euo pipefail

: "${GITHUB_SHA:?GITHUB_SHA is not set}"
: "${MIGRATION_TARGET:?MIGRATION_TARGET is not set}"
attempts="${VERSION_CHECK_ATTEMPTS:-30}"
interval_s="${VERSION_CHECK_INTERVAL_SECONDS:-10}"
[[ "${attempts}" =~ ^[1-9][0-9]*$ ]] || attempts=30
[[ "${interval_s}" =~ ^[0-9]+$ ]] || interval_s=10

url="${FRONTEND_CANONICAL_URL:-}"
url_source="canonical environment URL"
if [[ -z "${url}" ]]; then
  url="${FRONTEND_URL:-}"
  url_source="deployment alias from the Vercel CLI output"
fi
url="${url%/}"
if [[ -z "${url}" ]]; then
  echo "::warning::No deployment URL captured; version check skipped."
  exit 0
fi

# version.json body on stdin -> commit on line 1, migrationTarget on line 2.
# Exits 1 unless the body is a JSON object.
parse_version='
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  let j;
  try { j = JSON.parse(d); } catch { process.exit(1); }
  if (!j || typeof j !== "object" || Array.isArray(j)) process.exit(1);
  const s = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  console.log(s(j.commit));
  console.log(s(j.migrationTarget));
});
'

read_live_version() {
  local attempt="$1" body
  body="$(curl -fsS --max-time 20 --retry 2 --retry-delay 2 --retry-all-errors \
    -H 'Cache-Control: no-cache' \
    "${url}/version.json?release_check=${GITHUB_RUN_ID:-local}-${attempt}" 2>/dev/null || true)"
  [[ -n "${body}" ]] || return 1
  printf '%s' "${body}" | node -e "${parse_version}"
}

echo "Checking ${url}/version.json (${url_source}) for commit=${GITHUB_SHA} migrationTarget=${MIGRATION_TARGET} ..."
seen_json=0
live_commit=""
live_target=""
for ((attempt = 1; attempt <= attempts; attempt++)); do
  if version="$(read_live_version "${attempt}")"; then
    seen_json=1
    { read -r live_commit || true; read -r live_target || true; } <<< "${version}"
    if [[ "${live_commit}" == "${GITHUB_SHA}" && "${live_target}" == "${MIGRATION_TARGET}" ]]; then
      echo "Frontend ${live_commit} live at ${url}; expects migration ${live_target} (verified on DB)."
      exit 0
    fi
    echo "Read ${attempt}/${attempts}: ${url} still serves commit=${live_commit:-?} migrationTarget=${live_target:-?}; waiting for the new deployment to go live ..."
  elif ((seen_json == 0)); then
    echo "::warning::${url}/version.json not readable (deployment protection?). Check manually."
    exit 0
  else
    echo "Read ${attempt}/${attempts}: ${url}/version.json not readable this time; retrying ..."
  fi
  if ((attempt < attempts)); then
    sleep "${interval_s}"
  fi
done

echo "::error::Deployed frontend reports commit=${live_commit:-?} migrationTarget=${live_target:-?}; expected ${GITHUB_SHA} / ${MIGRATION_TARGET}. ${url} still did not serve this release after ${attempts} reads ${interval_s}s apart."
exit 1
