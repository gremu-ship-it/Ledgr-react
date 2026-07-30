# Ledgr — Production Deployment & Monitoring

This document describes the complete production-grade deployment and monitoring
pipeline for Ledgr, and the manual one-time setup required in each provider.

## 1. Architecture

| Concern            | Implementation                                                        |
|--------------------|-----------------------------------------------------------------------|
| Frontend           | React + Vite + TypeScript, built and served by **Vercel**             |
| Backend (API)      | **Supabase Edge Functions** (Deno) in `supabase/functions/api`        |
| Database           | **Supabase Postgres** — two fully separate projects (staging/prod)   |
| Auth               | Supabase Auth (shared within each environment's project)             |
| API gateway (opt.) | Optional containerised **Express** service (`server/`) on Railway/Render |
| Error monitoring   | **Sentry** (frontend + backend, anonymised)                           |
| Uptime             | **Better Uptime** pinging `/api/health` (SMS if down > 2 min)         |
| Performance        | **Vercel Web Analytics + Speed Insights** (Core Web Vitals)           |
| Backups            | Weekly automated restore-and-verify of the Supabase dump              |

> **Note on the backend:** the repository's API is implemented as a Supabase
> Edge Function (`supabase/functions/api/index.ts`), not a standalone Express
> service. The Express service in `server/` is provided as a hardened,
> containerised **API gateway** that enforces the same cross-cutting concerns
> (rate limits, security headers, Sentry) and proxies to the Supabase API. It
> is optional — deploy it only if you want a Railway/Render-managed edge in
> front of Supabase. Both paths satisfy the requirements; the Edge Function is
> what deploys by default.

## 2. CI/CD (`.github/workflows/`)

| Workflow            | Trigger                                   | What it does |
|---------------------|-------------------------------------------|--------------|
| `ci.yml`            | PR to `main`, push to `main`              | TypeScript typecheck, ESLint, unit tests (`vitest`), production build |
| `deploy.yml`        | push to `main`                            | **Deploy to STAGING** (Vercel + Supabase staging project) |
| `deploy.yml`        | push of a `v*` tag (`refs/tags/v*`)       | **Deploy to PRODUCTION** behind a manual approval gate |
| `deploy.yml`        | `workflow_dispatch` (choose env)          | Manual re-deploy of staging or production |
| `backup-verify.yml` | weekly cron (Mon 03:17 UTC) + dispatch    | Restore the latest backup to a throwaway Postgres and compare row counts |

### Manual approval gate (production)
`deploy.yml`'s `deploy-production` job uses a GitHub **Environment** named
`production`. Add a protection rule to that environment
(*Settings → Environments → production → Required reviewers*) so the job pauses
for human approval before deploying. (Required reviewers on environments need
GitHub Team/Enterprise; on free plans, the environment wait timer or a
`workflow_dispatch` confirmation achieves the same gate.)

### Tag-based production releases
```bash
git tag v1.2.3
git push origin v1.2.3      # triggers deploy-production (awaits approval)
```

## 3. Environments & separation

Two independent environments, **never sharing data or credentials**:

- **Staging** — Vercel project `ledgr-staging`, Supabase project `ledgr-staging`
- **Production** — Vercel project `ledgr-production`, Supabase project `ledgr-production`

All environment-specific values are injected at deploy time (see §4). The
staging and production Supabase projects must each run the **same** migrations
from `supabase/migrations/`; `deploy.yml` runs `supabase db push` against each.

## 4. GitHub repository configuration

### Repository Variables (`Settings → Secrets and variables → Actions → Variables`)
| Variable | Example | Used by |
|----------|---------|---------|
| `VERCEL_ORG_ID` | `team_xxx` | both deploys |
| `VERCEL_PROJECT_ID_STAGING` | `prj_xxx` | staging |
| `VERCEL_PROJECT_ID_PROD` | `prj_yyy` | production |
| `SUPABASE_PROJECT_REF_STAGING` | `abcdef` | staging |
| `SUPABASE_PROJECT_REF_PROD` | `ghijkl` | production |
| `VITE_SUPABASE_URL_STAGING` | `https://abc.supabase.co` | staging build |
| `VITE_SUPABASE_URL_PROD` | `https://ghi.supabase.co` | prod build |
| `APP_URL_STAGING` / `APP_URL_PROD` | `https://staging.ledgr.app` | Edge Function secrets |
| `SENTRY_ORG` | `ledgr` | both |
| `SENTRY_PROJECT_STAGING` / `SENTRY_PROJECT_PROD` | `ledgr-web-staging` / `ledgr-web-prod` | Sentry upload |
| `STAGING_URL` / `PRODUCTION_URL` | `https://staging.ledgr.app` | environment URLs |
| `RAILWAY_PROJECT_ID_STAGING` / `_PROD` | `proj_xxx` | optional gateway |

### Repository Secrets (`Settings → Secrets and variables → Actions → Secrets`)
| Secret | Used by |
|--------|---------|
| `VERCEL_TOKEN` | Vercel CLI auth (both) |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI (both) |
| `SUPABASE_DB_PASSWORD_STAGING` / `_PROD` | DB migrations (both) |
| `VITE_SUPABASE_ANON_KEY_STAGING` / `_PROD` | build |
| `VITE_SENTRY_DSN_STAGING` / `_PROD` | frontend Sentry init |
| `SENTRY_AUTH_TOKEN` | Sentry source-map upload (CI) |
| `SENTRY_DSN_BACKEND_STAGING` / `_PROD` | backend (Edge Function) Sentry |
| `SENDGRID_API_KEY_STAGING` / `_PROD` | Edge Function secrets |
| `SENDGRID_FROM_EMAIL_STAGING` / `_PROD` | Edge Function secrets |
| `ANTHROPIC_API_KEY_STAGING` / `_PROD` | Edge Function secrets |
| `PAYCHANGU_SECRET_KEY_STAGING` / `_PROD` | Edge Function secrets |
| `PAYCHANGU_WEBHOOK_SECRET_STAGING` / `_PROD` | Edge Function secrets |
| `CRON_SECRET_STAGING` / `_PROD` | Edge Function secrets |
| `SUPABASE_DB_URL_STAGING` / `SUPABASE_DB_URL_PRODUCTION` | backup-verify (`postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres`) |
| `RAILWAY_TOKEN` | optional gateway deploy (Railway) |

> Frontend-only vars prefixed `VITE_` are baked into the client bundle at build
> time. Non-`VITE_` secrets (e.g. `SENDGRID_API_KEY`) are Edge Function secrets
> set with `supabase secrets set` and are **never** exposed to the browser.

## 5. Vercel setup

1. Create two projects (`ledgr-staging`, `ledgr-production`) and link them to
   this repository.
2. Set `VERCEL_ORG_ID` and the two `VERCEL_PROJECT_ID_*` in GitHub variables.
3. Generate a Vercel **Access Token** → store as `VERCEL_TOKEN` secret.
4. (Optional but recommended) Configure the project's own environment variables
   for staging/prod as a fallback; `deploy.yml` also injects them via
   `--build-env`.
5. Add custom domains (e.g. `staging.ledgr.app`, `app.ledgr.app`).

The `api/health.ts` serverless function is deployed automatically (Vercel picks
up the `api/` directory). The SPA rewrite in `vercel.json` explicitly excludes
`/api/*` so the function is reachable.

### Core Web Vitals (Vercel Analytics)
- Web Analytics + Speed Insights are wired in `src/main.tsx` via
  `@vercel/analytics` and `@vercel/speed-insights`.
- Enable **Analytics** and **Speed Insights** in each Vercel project's dashboard
  (or they auto-collect once the packages are present).

## 6. Supabase setup (two projects)

For **each** environment:

1. Create a new Supabase project (distinct Org/region is fine).
2. Note the Project Ref → `SUPABASE_PROJECT_REF_*` and the DB password →
   `SUPABASE_DB_PASSWORD_*`.
3. Run migrations: `deploy.yml` does `supabase db push` on every deploy. To seed
   locally first: `supabase link --project-ref <ref> --password <pw>` then
   `supabase db push`.
4. Set Edge Function secrets (done automatically by `deploy.yml`):
   ```bash
   supabase secrets set SENTRY_DSN=... SENDGRID_API_KEY=... PAYCHANGU_SECRET_KEY=... \
     APP_URL=... CRON_SECRET=... --project-ref <ref>
   ```
5. Deploy functions (automatic in `deploy.yml`): `supabase functions deploy api --project-ref <ref>`.

The public API rate-limit table is `public.api_usage` (`supabase/migrations/20250724_api_usage.sql`).
The Edge Function fixes a prior bug (it now uses the correct `api_key` text
column) and enforces **100 req/min per API key** and **10 req/min per client IP**
unauthenticated.

## 7. Sentry (anonymised)

- **Frontend** (`@sentry/react` in `src/main.tsx`): initialised only when
  `VITE_SENTRY_DSN` is set; `sendDefaultPii: false` and a `beforeSend` scrubber
  strip cookies/extra. A non-PII user id (Supabase auth uuid) is attached on
  login via `Sentry.setUser`.
- **Backend** (`@sentry/deno` in `supabase/functions/api/index.ts`): initialised
  when `SENTRY_DSN` is set; `sendDefaultPii: false`; user context is the
  non-PII API-key uuid.
- **Optional gateway** (`@sentry/node` in `server/src/index.ts`): same policy.
- Source maps are uploaded by the Sentry Vite plugin during the Vercel build
  (guarded by `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT_*`).

Create two Sentry projects (staging/prod) per app and paste the DSNs into the
secrets above.

## 8. Better Uptime (uptime + SMS)

1. Create a monitor in Better Uptime pointing at
   `https://<your-domain>/api/health` (the Vercel serverless function).
2. Set check frequency to **every 1 minute**.
3. Configure the **SMS** integration and an alert policy that pages you when the
   monitor is **down for more than 2 minutes** (Better Uptime's default
   "alert after 2 failed checks" ≈ 2 minutes at 1-min frequency).
4. (Optional) Also monitor the Supabase function health directly:
   `https://<ref>.supabase.co/functions/v1/api/api/health`.

The `/api/health` endpoint is intentionally excluded from rate limiting so
uptime pings always succeed.

## 9. Backup verification (`backup-verify.yml`)

Every Monday 03:17 UTC (or manually) the workflow:

1. Spins up a **throwaway** `postgres:16` container (GitHub service container).
2. `pg_dump`s the selected environment's `public` schema.
3. Restores it into the throwaway DB.
4. Compares row counts for a core table list (`TABLES`) between source and
   restored.
5. Fails the run on any mismatch, so bad backups are caught before they matter.

Required: set `SUPABASE_DB_URL_STAGING` / `SUPABASE_DB_URL_PRODUCTION` (direct
Postgres connection strings) and allow the GitHub Actions runner's IP (or use
Supabase's allowed-list / SSH tunnel) to reach the DB.

## 10. Rate limiting & security headers

| Control | Where |
|--------|-------|
| 100 req/min authenticated | `supabase/functions/api/index.ts` (`api_usage` per API key) |
| 10 req/min unauthenticated | same file, per client IP (`x-forwarded-for`) |
| CSP / HSTS / X-Frame-Options / X-Content-Type-Options / Referrer-Policy / Permissions-Policy | `vercel.json` (all non-`/api` responses) **and** the API function's `response()` helper (all API responses) **and** `server/src/index.ts` (helmet) if the gateway is used |
| `/api/health` | `api/health.ts` (Vercel) + `/health` in the Edge Function |

## 11. Local development

```bash
# Frontend
cp .env.example .env          # fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
npm install
npm run dev

# Tests / lint / typecheck
npm test
npm run lint
npm run typecheck

# Optional Express gateway (needs a Supabase API base URL)
cd server
cp .env.example .env
npm install
npm run dev                   # http://localhost:3000/api/health
# Production gateway deployments must set REDIS_URL. It is the shared,
# atomic rate-limit store; the gateway intentionally refuses to start in
# APP_ENV=production without it.
```

## 12. Files added/changed by this setup

- `.github/workflows/ci.yml` — typecheck/lint/test/build on PR + main
- `.github/workflows/deploy.yml` — staging (main), prod (tag, manual gate)
- `.github/workflows/backup-verify.yml` — weekly backup restore & verify
- `scripts/verify-backup.sh` — restore + row-count comparison
- `vercel.json` — SPA security headers (excludes `/api`)
- `api/health.ts` — uptime endpoint
- `vite.config.ts` — Sentry source-map upload (guarded)
- `src/main.tsx` — Sentry + Vercel Analytics/Speed Insights
- `supabase/functions/api/index.ts` — `/health`, security headers, 10/100 rate limits, Sentry
- `src/lib/__tests__/formatters.test.ts`, `vitest.config.ts` — unit tests
- `server/` + `Dockerfile` + `railway.json` + `render.yaml` + `docker-compose.yml` — optional Express gateway
