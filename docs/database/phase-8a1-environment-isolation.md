# Ledgr — Phase 8A.1 — Environment Isolation Failure Report

**Status:** 🚫 **ISOLATION FAILURE — capture NOT performed**
**Date:** 2026-08-13

## Summary

The Phase 8A.1 staging capture was **blocked by the isolation guard, by design**.
The capture tooling (`scripts/database/capture-staging-schema.sh` and the
Management API variant `capture-staging-schema-via-api.sh`) verifies that the
staging and production Supabase project refs are distinct before connecting.
The verification **failed**: the two refs are **identical**, meaning staging and
production currently resolve to the **same database**.

**No connection was made to any hosted database. Nothing was read, written,
altered, or reset.** The guard did its job.

## Evidence

### GitHub repository variables (Settings → Secrets and variables → Actions)

| Variable | Value |
|---|---|
| `SUPABASE_PROJECT_REF` | `hsuhuvuxfuufrlejsatw` |
| `SUPABASE_PROJECT_REF_STAGING` | `hsuhuvuxfuufrlejsatw` |
| `SUPABASE_PROJECT_REF_PROD` | `hsuhuvuxfuufrlejsatw` |
| `VITE_SUPABASE_URL_STAGING` | `https://hsuhuvuxfuufrlejsatw.supabase.co` |

All three project-ref variables are the **same 20-character ref**.
`VITE_SUPABASE_URL_STAGING` points at the same project.

### Repo code confirmation

- `.github/workflows/deploy.yml` — the **staging** job uses
  `vars.SUPABASE_PROJECT_REF_STAGING` and the **production** job uses
  `vars.SUPABASE_PROJECT_REF_PROD` (both `hsuhuvuxfuufrlejsatw`), so both jobs
  currently run `supabase link` / `supabase db push` / `supabase functions
  deploy` against the **same project**.
- `src/pages/ApiDocumentationPage.tsx` — hardcodes
  `https://hsuhuvuxfuufrlejsatw.supabase.co`.

### Capture workflow runs

| Run | Result | Reason |
|---|---|---|
| 31703302390 | ❌ failed | `SUPABASE_DB_URL_STAGING` secret was not set (old workflow) |
| 31707040840 | ❌ failed | `STAGING_SUPABASE_PROJECT_REF == PRODUCTION_SUPABASE_PROJECT_REF` — isolation guard refused to connect |

## Impact

1. **Phase 8A.1 cannot certify a staging baseline.** There is currently no
   environment that can be identified as "staging" distinct from production.
2. **Staging and production share one database today.** Every `push to main`
   (staging deploy) and every `v*` tag release (production deploy) has been
   applying migrations and deploying functions to the same project. This means:
   - A migration merged for staging is **immediately applied to production**.
   - Edge-function secrets set for one environment affect the other.
   - `SUPABASE_DB_PASSWORD_STAGING` and `SUPABASE_DB_PASSWORD_PROD` — if they
     differ — point at the same database with different passwords (one may be
     stale).
3. **Production isolation is unverified.** Until a separate production project
   exists, the phase's "production must remain untouched" guarantee cannot be
   demonstrated, and the `v*` deploy path has been exercising production without
   a separate environment.

## Remediation (recommended order)

> These are GitHub/Supabase configuration actions — they require **repo admin**
> and a **Supabase account owner**. I cannot perform them from the sandbox.

1. **Create a separate staging Supabase project** (recommended) — or, if the
   current single project is intended to be *production*, create the missing
   staging project:
   - New project, e.g. `ledgr-staging`, with a distinct ref (e.g.
     `abc123...`). Keep it on the same Supabase organization so
     `SUPABASE_ACCESS_TOKEN` works for both.
   - Do **not** point the new project at the old one's database; create it
     fresh. (A `pg_dump`/restore from the current project into the new staging
     project is a later, deliberate data-copy step — not part of this phase.)
2. **Update the GitHub variables:**
   - `SUPABASE_PROJECT_REF_STAGING` = new staging ref
   - `SUPABASE_PROJECT_REF_PROD` = current ref `hsuhuvuxfuufrlejsatw` (keep as
     production) — or the opposite if the current project is staging
   - `VITE_SUPABASE_URL_STAGING` = `https://<new-staging-ref>.supabase.co`
   - Add `SUPABASE_DB_URL_STAGING` secret (optional; the API-based capture does
     not need it) and verify `SUPABASE_DB_PASSWORD_STAGING` matches the new
     project.
   - Verify `SUPABASE_PROJECT_REF` (the third, legacy variable) is no longer
     referenced by workflows; remove it if unused.
3. **Re-run the capture workflow** on `main`:
   - Actions → **Capture staging schema (read-only)** → Run workflow.
   - The isolation guard now passes (refs distinct), and the read-only capture
     produces `artifacts/database/capture/` for Phase 8A.1 reconciliation.
4. **Reconcile the baseline** (I take over here): RPC bodies, view bodies, RLS
   policies, `SHOW server_version` → `config.toml`, storage limits, then the
   fresh-database replay and comparison, and finally regenerate types.

## Phase status

- **Phase 8A.1 final status: RED — baseline cannot currently be reconstructed
  safely** (unchanged), now for a concrete, documented reason: **no distinct
  staging environment exists**.
- **Phase 8B (RLS penetration testing) must not begin** until the staging
  project exists, the capture succeeds, and the fresh database matches staging.
- **Seed creation** remains blocked on the same items.

## Files

- Capture tooling (ready to run): `scripts/database/capture-staging-schema.sh`,
  `scripts/database/capture-staging-schema-via-api.sh`,
  `scripts/database/capture-staging-schema.sql`
- Inventory (evidence-based, awaiting live capture):
  `artifacts/database/staging-schema-inventory.json` and
  `docs/database/staging-schema-inventory.md`
- This report: `docs/database/phase-8a1-environment-isolation.md`
