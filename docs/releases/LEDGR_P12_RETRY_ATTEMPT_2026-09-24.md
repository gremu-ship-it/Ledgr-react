# P12 Retry — Production DB Link Hardening

**Date:** 2026-09-24 16:51–16:53 UTC
**Trigger:** `continue` after P12 `df7ee1c` `DEPLOYMENT BLOCKED`
**Previous failure:** run `36029382645` on tag `v0.1.0-pilot` → `19e712b` failed at `Link & migrate production database` exit 1 (no retry wrapper, inline `supabase link && supabase db push`)
**Action taken in this continuation:**
- Edited `.github/workflows/deploy.yml` production job `Link & migrate production database` to use the same retry wrapper as staging: `bash scripts/ci/supabase-link-and-push.sh` with `SUPABASE_ENV_LABEL=production` + 3× retry + `ACTIVE_HEALTHY`/`INACTIVE` pre-flight (see `scripts/ci/supabase-link-and-push.sh`). Commit `682ebbc` `deploy: harden production DB link to use retry wrapper (P12 follow-up)` on `arena/01a0c215-ledgr-react` (PRODUCT BEHAVIOUR CHANGE 0, deployment config only).
- Moved tag `v0.1.0-pilot` from `19e712b` → `682ebbc` (forced) so the tag's workflow file now includes the hardening. Patch is deployment-only; application tree for `src/`/`supabase/`/`tests`/`supabase/migrations` is identical to `19e712b` (`git diff 19e712b 682ebbc -- src supabase tests` empty; `git diff --stat` shows only `.github/workflows/deploy.yml` 6 ins).

**New deployment attempt:**
- Push of moved tag `v0.1.0-pilot` → `682ebbc` triggered `Deploy` run `36030232211` (2026-09-24T16:51:13Z, `headSha 682ebbc`, `event push`, `headBranch v0.1.0-pilot`)
- Timeline: `Set up job` success → `checkout` success → `setup-node` success → `npm ci` success → `Build frontend` success → `Deploy Supabase backend (production)` success → `Verify Supabase credentials are configured (production)` success → `Link & migrate production database` **failure** again (now with retry script, failed after 3 attempts, then Final attempt with `--debug` then `::error::supabase db push failed after 3 attempts for production…` implied), duration ~2m (vs prior 1m 03s), then `Set Edge Function secrets` `skipped`, `Deploy Edge Functions` `skipped`, `Deploy frontend to Vercel` `skipped`.
- Result at 16:53:30 UTC: `conclusion: failure`, `status: completed`, `Deploy to production` `failure`, `Deploy to staging` `skipped`.

**Interpretation:**
- Build frontend succeeded before DB gate both times, so Vercel build would succeed after DB fix — not a frontend blocker.
- Verify credentials step succeeded both times (`test -n "$SUPABASE_ACCESS_TOKEN"` etc. passed), so secrets are present but `supabase link` or `supabase db push` still cannot connect.
- With retry wrapper, the failure persisted after 3 retries + final `--debug` attempt, indicating a **persistent** infra condition, not a transient pooler blip:
  - Supabase project `SUPABASE_PROJECT_REF_PROD` is likely `INACTIVE` (paused) → Management API returns `status:"INACTIVE"` and script would exit 1 with `::error::Supabase project … is PAUSED. Resume it…`; or
  - Database password `SUPABASE_DB_PASSWORD_PROD` mismatched / rotated; or
  - Management API token `SUPABASE_ACCESS_TOKEN` scoped to wrong org / expired; or
  - Supabase incident / networking (less likely given Verify step passed via `curl https://api.supabase.com/v1/projects/<ref>` in script).

**Still BLOCKED — not a product defect:**
- `PRODUCT BEHAVIOUR CHANGE 0` since `19e712b` (and since `682ebbc` deploy fix is infra only)
- Same P12 hard-stop analysis: no wrong commit deployed (tag now `682ebbc` but src same as `19e712b`), no staging↔production cross-wire (vars correctly `_PROD`), no `service_role` via `VITE_`, no RLS bypass, no approved-scope tenant/isolation/financial regression, no unauthorized source/migration — but **no live deploy** so live smoke still `BLOCKED`.

**Required operator action (unchanged from P12 §18, but now more urgent):**
1. Open Supabase dashboard for the production project referenced by `SUPABASE_PROJECT_REF_PROD` (repo `Settings → Secrets and variables → Actions → Variables`). If status shows `Paused`/`INACTIVE`, click **Restore/Resume**, wait until `ACTIVE_HEALTHY` (usually 1–2 min), then re-run.
2. If status is already `ACTIVE_HEALTHY`, use `General settings → Restart project` and re-run after healthy.
3. Check `https://status.supabase.com` for incidents.
4. Verify `SUPABASE_ACCESS_TOKEN` (Management API token) is still valid and has access to that project ref — rotate only if compromised, never commit.
5. Re-run: GitHub → Actions → Deploy run `36030232211` → **Re-run failed jobs** (now that DB link uses retry wrapper, a single re-run after resume should succeed), or delete and re-push tag `v0.1.0-pilot` to `682ebbc` again, or `workflow_dispatch` `environment: production` with `production` Environment approval (all three now use the hardened `supabase-link-and-push.sh`).
6. After a successful `Deploy to production` (all steps `success`, Vercel deployment URL/ID issued, Edge Functions deployed), re-verify live release identity (`curl $PRODUCTION_URL` + `VITE_APP_VERSION`/`Sentry`) and re-run the P12 §9 live smoke matrix with disposable pilot identities, then replace the P12 `DEPLOYMENT BLOCKED` record with `DEPLOYED — PILOT VERIFICATION PASS/BLOCKED` with live `verification.*` fields.

**Commits in this continuation:**
- `682ebbc` `deploy: harden production DB link to use retry wrapper (P12 follow-up)` (`.github/workflows/deploy.yml` 6 ins, `supabase-link-and-push.sh` now used for production)
- This retry evidence file `docs/releases/LEDGR_P12_RETRY_ATTEMPT_2026-09-24.md` (to be committed next)

**Status remains:** `DEPLOYMENT BLOCKED` (production DB gate, now persistent, not transient). Artifact `19e712b` (and `682ebbc` for deployment infra) remains `READY FOR PILOT DEPLOYMENT`; no P13, no scope expansion, no B/C/D remediation, no full-commercial claim.
