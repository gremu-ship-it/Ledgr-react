# Ledgr — Database Operations (Phase 8A.1)

Operational runbook for the Ledgr Supabase databases (staging and production),
updated with the Phase 8A.1 baseline findings. Covers how the database is
migrated, verified, backed up, and how environment-specific configuration
(cron secrets, storage) is reproduced.

## 1. Environments

| Environment | Supabase project | DB URL pattern | Used by |
|---|---|---|---|
| Staging | `ledgr-staging` (ref in GitHub var `SUPABASE_PROJECT_REF_STAGING`) | `postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres` | deploy.yml on push to `main` |
| Production | `ledgr-production` (ref in GitHub var `SUPABASE_PROJECT_REF_PROD`) | same pattern | deploy.yml on `v*` tags (manual approval) |

**Isolation rule (Phase 8A.1):** staging and production are separate projects.
Every database interaction during Phase 8A/8B must target staging only; the
capture script refuses to run unless `LEDGR_ENV=staging` and the refs are
distinct.

## 2. Migration workflow

Migrations live in `supabase/migrations/` and are applied by CI:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase db push --password "$SUPABASE_DB_PASSWORD"
```

Local full replay (disposable database):

```bash
supabase db reset        # requires Docker + config.toml (see below)
```

Phase 8A.1 added the missing **base migration**
(`20250101000000_base_schema.sql`) that must sort before all incremental
migrations. Replay order is therefore:

```
20250101000000_base_schema.sql
20250724_api_usage.sql
20260708000000_tax_compliance_module.sql
… (all incremental migrations in filename order)
```

### Rules

- Never edit an applied migration. Add a new one.
- `supabase db reset` must succeed with **zero manual object creation**; if it
  fails, fix the migration source, not the database.
- After any schema change, regenerate types:
  `npx supabase gen types typescript --project-id <ref> > src/dal/types/database.generated.ts`

## 3. Replaying migrations without Docker

The sandbox that produced the Phase 8A.1 baseline had no Docker, so a
disposable PostgreSQL 18.4 was run via `embedded-postgres` (npm) with stubs for
Supabase-managed objects. Procedure (recorded for reproducibility):

1. `npm i embedded-postgres` (platform binaries via `@embedded-postgres/linux-x64`).
2. Bootstrap: roles (`anon`, `authenticated`, `service_role`), `auth.users`
   (+ `auth.uid()`/`auth.role()`), `storage.buckets`/`storage.objects`, stub
   `pg_cron` and `pg_net` extensions, `pgcrypto` + `pg_trgm` extensions,
   Supabase default grants (`GRANT ALL ON ALL TABLES IN SCHEMA public TO anon,
   authenticated, service_role`).
3. Apply `supabase/migrations/*.sql` in filename order with `ON_ERROR_STOP`.
4. Dump catalogs and compare (see `docs/database/fresh-database-comparison.md`).

The harness is not committed to the repository (sandbox-only); the capture
tooling that IS committed is `scripts/database/capture-staging-schema.sh`.

## 4. Read-only capture (Phase 8A.1)

```bash
LEDGR_ENV=staging \
STAGING_SUPABASE_PROJECT_REF=<ref> \
PRODUCTION_SUPABASE_PROJECT_REF=<ref> \
STAGING_SUPABASE_DB_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
./scripts/database/capture-staging-schema.sh
```

- Issues only `SELECT`/`SHOW`/`pg_get_*def` statements (see
  `scripts/database/capture-staging-schema.sql` for the exact query set).
- Redacts JWTs, keys, tokens and passwords from captured artifacts.
- Writes raw evidence to `artifacts/database/capture/`; the authoritative
  inventory (`artifacts/database/staging-schema-inventory.json`) must then be
  rebuilt from that evidence and certified against this phase's evidence-based
  version.

**No-password variant (recommended):**
`scripts/database/capture-staging-schema-via-api.sh` performs the same capture
over the Supabase Management API
(`POST https://api.supabase.com/v1/projects/{ref}/database/query`) using
`SUPABASE_ACCESS_TOKEN` — the same token the deploy workflow already uses — so
**no database password is required**. Same isolation guards, same artifacts
(JSON + rendered `.txt` per query), same redaction, and it reports partial
failures instead of fabricating output. The GitHub Actions workflow
`.github/workflows/capture-staging-schema.yml` uses this variant.

## 5. Backup & restore

CI workflow `.github/workflows/backup-verify.yml` restores the latest Supabase
dump into a throwaway Postgres and runs verification. Manual:

```bash
pg_dump "postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres" -Fc -f ledgr-$(date +%F).dump
pg_restore --clean --if-exists -d fresh_db ledgr-$(date +%F).dump
```

## 6. Cron jobs and secrets (environment configuration)

Three `pg_cron` jobs are declared in migrations with placeholders:

| Job | Schedule | Migration | Target edge function |
|---|---|---|---|
| `expire-subscriptions-daily` | `0 1 * * *` | 20260726000003 | `expire-subscriptions` |
| `send-renewal-reminders-daily` | `0 8 * * *` | 20260726000005 | `send-renewal-reminders` |
| `generate-partner-invoices-monthly` | monthly | 20260727000006 | `generate-partner-invoices` |

The migrations contain `<PROJECT_REF>` and `<CRON_SECRET>` placeholders.
Deployment substitutes them per environment:

1. Set the edge-function secret: `supabase secrets set CRON_SECRET=<random> SB_ENV=staging`
2. Apply the migration with the project ref substituted (the CI `deploy.yml`
   flow does this via `supabase db push`; the cron job commands reference
   `https://<PROJECT_REF>.supabase.co/functions/v1/...`).

**No real secrets are embedded in migrations.** Recreating a fresh environment
requires: run migrations → set function secrets → ensure `cron.job` rows point
at the environment's function URLs (verify with the capture script's
`cron_jobs.txt`).

## 7. Storage buckets (environment configuration)

| Bucket | Visibility | Purpose | Evidence |
|---|---|---|---|
| `business-logos` | public (client `getPublicUrl`) | business logo uploads | src/pages/SettingsPage.tsx |
| `user-exports` | private (service-role upload, signed URLs) | GDPR/data export zips | supabase/functions/export-my-data/index.ts |

Buckets are dashboard-created and are **not** declared in migrations; recreate
them per environment (public for `business-logos`, private for `user-exports`)
and verify storage policies against staging before Phase 8B.

## 8. Validation commands

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

`npm run db:validate` / `npm run db:validate:strict` are referenced by the Phase
8A.1 brief but are **not defined** in `package.json` — they should be added in a
later phase or invoked as: `supabase db lint` (needs Docker) and
`supabase db diff --local` (needs Docker). Without Docker, the comparison
procedure in `docs/database/fresh-database-comparison.md` (catalog dump vs
inventory) is the substitute.

## 9. Known operational gaps (from Phase 8A.1)

1. PostgreSQL server version of staging is unverified (`SHOW server_version`
   pending live capture); local replay used 18.4. Supabase defaults should be
   confirmed (`supabase/config.toml` `[db] major_version`).
2. Nine base RPC bodies and four view bodies exist only in the live database —
   they must be captured with `pg_get_functiondef` and promoted into migrations
   before the baseline is certified.
3. RLS policies on 23 base tables are not evidenced in the repository — capture
   `pg_policies` from staging and reconcile before Phase 8B.
4. Storage bucket size limits / MIME restrictions and storage policies are
   unverified.
