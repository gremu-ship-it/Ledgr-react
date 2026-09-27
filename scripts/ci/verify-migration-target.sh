#!/usr/bin/env bash
# IC 2026-09-25 P9 — prove the linked database reached the migration target
# this commit expects BEFORE the frontend is deployed. Read-only: runs
# `supabase migration list` (history table query), never repairs or pushes.
#
# Inputs (env): MIGRATION_TARGET (14-digit version; default = repo head),
#               SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, SUPABASE_ACCESS_TOKEN.
# Output: appends MIGRATION_REMOTE_HEAD=<version> to $GITHUB_ENV when set.
# Exit 1 (release stops before the frontend) when the target is not applied.
set -euo pipefail
target="${MIGRATION_TARGET:-$(node scripts/ci/migration-target.mjs)}"
[[ "$target" =~ ^[0-9]{14}$ ]] || { echo "::error::Invalid migration target '${target}'"; exit 1; }

out=""
for attempt in 1 2 3; do
  if out="$(supabase migration list --password "${SUPABASE_DB_PASSWORD:-}" 2>&1)"; then break; fi
  echo "migration list attempt ${attempt} failed; retrying" >&2
  sleep $((attempt * 5))
  out=""
done
[[ -n "$out" ]] || { echo "::error::Could not read the remote migration history; refusing to deploy the frontend."; exit 1; }

# Rows look like: "   <local> | <remote> | <time>". Remote column = field 2.
remote_versions="$(printf '%s\n' "$out" | awk -F'|' 'NF>=2 { gsub(/ /,"",$2); if ($2 ~ /^[0-9]{14}$/) print $2 }' | sort)"
remote_head="$(printf '%s\n' "$remote_versions" | tail -n 1)"
[[ -n "${GITHUB_ENV:-}" ]] && echo "MIGRATION_REMOTE_HEAD=${remote_head:-none}" >> "$GITHUB_ENV"

if ! printf '%s\n' "$remote_versions" | grep -qx "$target"; then
  echo "::error::DB migration target ${target} is NOT applied on the remote (remote head: ${remote_head:-none}). Frontend deploy blocked to avoid a version-skew window."
  exit 1
fi
if [[ "$remote_head" > "$target" ]]; then
  echo "::warning::Remote migration head ${remote_head} is AHEAD of this commit's target ${target} (a newer backend is live). Check before deploying an older frontend."
fi
echo "Migration target ${target} confirmed on remote (remote head ${remote_head})."
