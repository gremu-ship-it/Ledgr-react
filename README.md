# Ledgr — Business Accounting for Malawi

MWK-first accounting, invoicing, payroll, and inventory for Malawian SMEs —
built as an **offline-capable PWA** on React + Vite + Supabase.

Ledgr runs entirely in the browser (works on flaky connections via a service
worker and a Dexie-backed offline queue), syncs through **Supabase** (Postgres,
Auth, RLS), and deploys to **Vercel**. Payments run through **PayChangu**
(MWK subscriptions), errors go to **Sentry**, and an in-app **AI support
agent** answers product, triage, and compliance questions.

## Features

- **Accounting** — chart of accounts, double-entry journals, period
  management, accounts, capital, transfers, bank reconciliation
- **Invoicing** — invoices with open-tracking pixel, email delivery (SendGrid),
  payment status return handling
- **Payroll & tax** — PAYE bands, pension contributions, VAT, withholding tax,
  MRA tax filings
- **Inventory** — products, warehouses, branches, departments, fixed assets
  with depreciation
- **Reporting** — profit & loss, balance sheet, statement integrity checks,
  revenue breakdown, exportable reports
- **Offline-first** — PWA with service-worker precache, offline queue that
  syncs when connectivity returns
- **Multi-user & RBAC** — businesses, roles, invitation flow, partner/admin
  portals, audit log, MFA, inactivity timeout
- **Integrations** — public JSON:API (`/api/v1`) with hashed API keys, Zapier
  template, PayChangu billing, AI insights (Anthropic)
- **Support** — in-app AI support agent with human escalation (see
  [`SUPPORT_AGENT.md`](SUPPORT_AGENT.md))
- **i18n** — English / Chichewa (`src/i18n`)

## Tech stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | React 19, TypeScript, Vite 8, Tailwind CSS 4 |
| State     | TanStack Query, Zustand, React Hook Form + Zod |
| Data      | Supabase (Postgres + Auth + RLS), Dexie (offline) |
| API       | Supabase Edge Functions (Deno) in `supabase/functions/` |
| PWA       | vite-plugin-pwa (generateSW) |
| Observability | Sentry, Vercel Analytics & Speed Insights, Better Uptime |
| CI/CD     | GitHub Actions (typecheck, lint, vitest, build) → Vercel |

## Getting started

**Prerequisites:** Node.js ≥ 22.22 (react-router v8 requirement) and npm 10+.

```bash
# 1. Install dependencies
npm install

# 2. Configure the environment (Supabase project URL + anon key at minimum)
cp .env.example .env
#   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
#   VITE_SUPABASE_ANON_KEY=<anon key>

# 3. Run the dev server
npm run dev
```

The full env-var reference (PayChangu, SendGrid, Anthropic, CORS allowlist,
cron secrets…) lives in [`.env.example`](.env.example). **Never** put
non-`VITE_` secrets in the browser — Edge Function secrets are configured with
`supabase secrets set` (see [`DEPLOYMENT.md`](DEPLOYMENT.md)).

## Scripts

| Command                | What it does                                    |
|------------------------|-------------------------------------------------|
| `npm run dev`          | Vite dev server                                 |
| `npm run build`        | Type-check + production build                   |
| `npm run typecheck`    | `tsc -b`                                        |
| `npm run lint`         | ESLint                                          |
| `npm run test`         | Vitest unit tests (run once)                    |
| `npm run test:watch`   | Vitest watch mode                               |
| `npm run verify`       | typecheck + lint + test + build (what CI runs)  |
| `npm run preview`      | Serve the production build locally              |

## Repository layout

```
├── api/                  # Vercel serverless function (/api/health, uptime target)
├── server/               # Optional Express API gateway (Railway/Render), see DEPLOYMENT.md
├── src/
│   ├── components/       # UI components (layout, billing, dashboard, support…)
│   ├── pages/            # Route pages (accounts, invoices, payroll, inventory…)
│   ├── routes/           # Route guards (auth, plan, role)
│   ├── dal/              # Data-access layer (repositories, RLS parity)
│   ├── services/         # Domain logic (depreciation, inventory valuation…)
│   ├── lib/              # Utilities (formatters, paye, errorHandler…)
│   ├── offline/          # Offline queue, PWA install prompt
│   ├── store/            # Zustand stores
│   ├── hooks/            # Shared React hooks
│   └── i18n/             # Translations (en, Chichewa)
├── supabase/
│   ├── functions/        # Edge Functions (api, paychangu-webhook, ai-insights…)
│   └── migrations/       # SQL migrations (RLS, scheduling, indexes)
├── scripts/              # Ops helpers (backup verification, API keys, SQL audits)
└── .github/workflows/    # CI, deploy (staging/prod), backup verification
```

## Deployment

The web app deploys to **Vercel** (push to `main` → staging, `v*` tag →
production behind a manual approval gate). The API ships as **Supabase Edge
Functions**; an optional hardened Express gateway lives in `server/` for
Railway/Render. Full runbook — including one-time provider setup, secrets,
and the manual approval gate — is in [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Documentation

| Document | What it covers |
|---|---|
| [`docs/architecture/CTO_BRIEF.md`](docs/architecture/CTO_BRIEF.md) | Operating principles, remaining risks, 90-day plan |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Architecture, CI/CD, provider setup, monitoring |
| [`PAYCHANGU_SETUP.md`](PAYCHANGU_SETUP.md) | PayChangu subscription/webhook setup |
| [`SUPPORT_AGENT.md`](SUPPORT_AGENT.md) | In-app AI support agent |
| [`WHITE_LABEL_SETUP.md`](WHITE_LABEL_SETUP.md) | White-label / rebranding |
| [`BRANDING_SETUP.md`](BRANDING_SETUP.md) | Branding, theme, PWA manifest |
| [`SYSTEM_AUDIT.md`](SYSTEM_AUDIT.md) | Security audit findings & remediation log |
| [`A11Y_REPORT.md`](A11Y_REPORT.md) | Accessibility review & fixes |
| [`UI_UX_REVIEW.md`](UI_UX_REVIEW.md) | Desktop/mobile UX review & applied fixes |
| [`ERROR_ANALYSIS.md`](ERROR_ANALYSIS.md) | Error taxonomy & fixes |
| [`FINAL_CHANGELOG.md`](FINAL_CHANGELOG.md) | UX overhaul changelog |

## Security notes

- Strict CSP, HSTS, COOP/CORP and Permissions-Policy shipped via `vercel.json`
- PayChangu webhooks verified with HMAC-SHA256 (constant-time), failing closed
- API keys stored as SHA-256 hashes, generated with a CSPRNG
- Row Level Security enabled on all data tables; service-role access is
  Edge-Function-only
- CORS allowlist on authenticated Edge Functions (`ALLOWED_ORIGINS`)
- `npm audit` is kept at **0 vulnerabilities** (see `SYSTEM_AUDIT.md`)
