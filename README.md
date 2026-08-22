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
- **Ledgr AI assistant** — deterministic forecasting and business advice over
  live company data, with an optional LLM backend (see
  [In-app AI assistants](#in-app-ai-assistants) below)
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

## In-app AI assistants

Ledgr ships **two assistants behind one drawer** (`src/components/ai/AssistantDrawer.tsx`):

| | Support Assistant (`mode="support"`) | Ledgr AI (`mode="ai"`) |
|---|---|---|
| Answers | How-to, troubleshooting, MRA compliance | Performance, forecasts, advice on live data |
| Source | `src/lib/ai/knowledge.ts` (local knowledge base) | `public.ai_context(business_id)` |
| Cost | Free, no network call | Free by default; optional LLM |
| Mounted | `SupportWidget` (all pages) | `AssistantWidget` (needs the `ai_insights` plan capability) |

**Both work with zero API keys.** With nothing configured, `getProvider()`
returns the deterministic rules engine in `src/lib/ai/provider.ts`; every
number it quotes is computed locally from the live payload. Setting
`VITE_AI_CHAT_URL` upgrades open-ended questions to an LLM served by the
`ai-chat` Edge Function — and if that call fails for any reason, the answer
silently falls back to the offline engine.

```
src/lib/ai/
├── types.ts       shared types (ChatMessage, DataContext, Forecast, Advice…)
├── knowledge.ts   KNOWLEDGE_BASE — keyed to Ledgr's real routes and menu labels
├── context.ts     buildAssistantContext(userId, companyId, mode)
├── forecast.ts    forecast(data, monthsAhead = 3)
├── advisor.ts     advise(ctx) → rating, headline, insights, 2–5 actions
├── format.ts      mk() — "MK 1,234,567", no decimals
└── provider.ts    getProvider(), rulesProvider(), buildSystemPrompt(), LLM adapters
```

### Data layer

`supabase/migrations/20260822000000_ai_data_views.sql` creates thirteen
`v_ai_*` views plus `public.ai_context(uuid)`, which returns the whole
assistant payload as one JSONB document. Every view is
`with (security_invoker = true)`, so RLS applies to the caller and a view can
never leak another tenant's rows; `ai_context` is `SECURITY DEFINER` but
raises `42501` unless `public.is_business_member(p_business_id)` passes (or the
caller is service-role, which derives the id from `business_users` first).

Apply it with the rest of the migrations:

```bash
supabase db push                       # or: supabase migration up
```

The figures are derived with the *same* filters the dashboards and reports
use, so the assistant reconciles with the rest of the app:

| Concept | Source | Rule |
|---|---|---|
| Revenue | `invoices` | `invoice_type IN ('invoice','credit_note','debit_note')`, `status NOT IN ('void','draft')`, `deleted_at IS NULL`, amount = `coalesce(functional_amount, total_amount)` |
| Receivables | `invoices` | `coalesce(amount_due * exchange_rate, amount_base − amount_paid * exchange_rate)`, floored at 0 |
| Expenses | `expenses`, `expense_lines` | `status NOT IN ('void','draft')`, amount = `coalesce(functional_amount, total_amount)`; category = the line's GL account name |
| Cash | `accounts`, `journal_lines` | `opening_balance` + posted/reversed `amount_base` on cash equivalents (`is_bank_account OR code IN ('1110','1115','1125','1126')`) — mirrors `FinancialStatementRepository.getCashPosition` |
| Cash in / out | `journal_entries` | **Net** movement per entry, so a transfer between two cash accounts nets to zero instead of inflating both sides |
| Payables | `expenses`, `payroll_runs`, `tax_returns` | Unpaid bills, `approved` payroll (net pay) and unpaid MRA returns, each with a due date |

### Forecast formulas

`forecast(data, monthsAhead = 3)` in `src/lib/ai/forecast.ts`. Projection
month 1 is the month *after* the current one, and every assumption below is
emitted in plain English on `Forecast.assumptions`.

**1. Baseline run rate** — weighted average of the last three *complete*
months of `cash_in` / `cash_out` (the current partial month is excluded so it
does not drag the average down):

```
baseline = 0.5 × mostRecent + 0.3 × prior + 0.2 × twoPrior
```

Weights are renormalised when fewer than three months exist, so two months of
history give `(0.5·m₁ + 0.3·m₂) / 0.8`.

**2. Collection curves** — invoices already on the books are added on top of
the run rate:

| Invoice state | Month 1 | Month 2 | Month 3+ |
|---|---|---|---|
| Overdue | 60% | 30% | — (10% treated as uncollectible in this horizon) |
| Due in 0–30 days | 85% | — | — |
| Due in 30–60 days | — | 50% | — |
| Due in 60+ days | excluded from a 3-month horizon | | |

**3. Committed outflows** — unpaid supplier bills, approved payroll and unpaid
MRA returns are added at **100%** in the month they fall due (anything already
overdue lands in month 1).

**4. Balance roll-forward** —

```
balance₀   = kpis.cash_balance
balanceₙ   = balanceₙ₋₁ + projected_inₙ − projected_outₙ
```

Any month whose closing balance is below zero is flagged (`negativeMonths()`)
and escalates the advisor's rating to `danger`.

**5. Revenue & expense lines** — a 3-month moving average, upgraded to
ordinary least-squares linear regression when there are **≥ 6 months** of
history and the fit explains the data (**R² > 0.6**). Projections are floored
at zero.

**Confidence** is set by how many months contain any activity: **high** ≥ 9,
**medium** 4–8, **low** otherwise. A brand-new company always returns `low`
with an explicit "limited history" assumption — never a confident-looking
straight line. Every arithmetic path is NaN-guarded.

### Advisor thresholds

`advise(ctx)` in `src/lib/ai/advisor.ts` (`THRESHOLDS`):

| Signal | `danger` | `watch` |
|---|---|---|
| Net profit margin | < 5% | 5–20% |
| Cash runway (cash ÷ avg monthly outflow) | < 1 month | < 3 months |
| Overdue ÷ receivables | > 30% | > 15% |
| Expenses ÷ revenue | > 95% | > 85% |
| Single-customer concentration | > 40% | — |
| Month-on-month expense rise | — | ≥ 25% |
| Month-on-month revenue fall | — | ≥ 15% |
| Projected cash below zero | any month | — |

The worst signal wins. Every action cites a real figure and a named entity
("Chase Lilongwe Foods — MK 2,500,000 on invoice INV-0042 is 82 days
overdue"), never generic advice.

### Optional LLM backend

The `ai-chat` Edge Function verifies the caller's JWT, re-derives the business
from `business_users`, rebuilds the DataContext from `ai_context()`, and
pre-computes the forecast and advice so **the model never does arithmetic** —
it may only restate numbers that appear in the JSON it is given.

```bash
# 1. Deploy the function (JWT verification stays ON)
supabase functions deploy ai-chat

# 2. Set the provider secrets (server-side only, never VITE_)
supabase secrets set AI_PROVIDER=groq AI_API_KEY=gsk_your_key_here

# 3. Point the browser at it
echo 'VITE_AI_CHAT_URL=https://<project-ref>.supabase.co/functions/v1/ai-chat' >> .env
```

| `AI_PROVIDER` | Default model (`AI_MODEL` overrides) | Notes |
|---|---|---|
| `groq` *(default)* | `llama-3.1-8b-instant` | Generous free tier — the recommended starting point |
| `gemini` | `gemini-1.5-flash` | Free tier available |
| `openrouter` | `meta-llama/llama-3.1-8b-instruct:free` | Free model, no card needed |
| `anthropic` | `claude-3-5-haiku-latest` | Falls back to the existing `ANTHROPIC_API_KEY` secret |

Leaving `VITE_AI_CHAT_URL` unset (or omitting `AI_API_KEY`) is a supported
configuration: the assistant keeps working entirely offline. **No AI provider
key is ever present in the client bundle** — the browser only knows a URL.

## Documentation

| Document | What it covers |
|---|---|
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
