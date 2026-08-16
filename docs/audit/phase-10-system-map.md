# Phase 10 — System Map

**Auditor note:** independent reconnaissance of the Ledgr codebase at commit
`fc3d272` (main, 2026-08-16). Purpose: locate every component and the seams
where integrity, isolation, or accounting correctness could fail.

## 1. Frontend architecture

- **Stack:** React 19 + Vite 8 + TypeScript ~6, Tailwind 4, Zustand (client
  state), TanStack Query (server state), react-router 8, i18next (en/ny/sw/
  fr/pt), Dexie (offline), jsPDF + html2canvas (PDF), Sentry, Vercel
  Analytics/SpeedInsights, Supabase JS 2.
- **Entry:** `src/main.tsx` → `App.tsx` → routes. `src/lib/supabase.ts`
  initialises the client at module scope **with a `throw` if
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are missing** (the Phase 10
  P0 blank-page root cause when a build was compiled without the key).
- **Routing/guards:** `src/routes/` — `ProtectedRoute`, `PlanGuard`,
  `PartnerAdminRoute`, `NoBusinessAccess`; role gating via
  `src/hooks/usePermissions.ts` (UI-level only — DB RLS is the enforcement).

## 2. Data access layer (DAL)

- `src/dal/repositories/*.ts` — typed repositories over Supabase
  (`Row<'table'>`, `InsertDto`, `UpdateDto` from the regenerated
  `database.generated.ts`; `database.supplement.ts` deleted in Phase 9.1).
- `src/dal/errors/RepositoryError.ts` — error mapping.
- **129 `as any` / `as never` usages remain** across repositories/services
  (counted 2026-08-16) — many predate type regeneration and now mask real
  type errors; several are deliberate legacy-RPC casts.

## 3. Services (business logic)

- `src/services/journalService.ts` — **invoice/expense journal posting**
  (the accounting core). Includes a **silent discount-account fallback**
  (posts net revenue if account 4130 is missing; broad catch).
- `src/services/seedChartOfAccounts.ts` — COA source of truth (166 gaap
  accounts); `src/services/inventoryJournalService.ts` (COGS),
  `inventoryValuation.ts`, `depreciation.ts`, `fixedAssetsJournalService.ts`,
  `dataImportService.ts`, `api/ApiKeyService.ts`, `webhook/WebhookService.ts`.
- `src/lib/paye.ts` — PAYE (approved Phase 9.2 bands, annual-model),
  `fiscalYear.ts`, `formatters.ts`, `documents/documentGenerator.ts` (PDF),
  `aiFinancial.ts` / `aiInsightsAgent.ts` (AI context — read-only),
  `chunkRecovery.ts`, `errorCapture.ts` / `logger.ts`.

## 4. Pages / journeys

- Auth: Login, Register, ForgotPassword, AcceptInvitation, CreateBusiness.
- Core: Dashboard, Income (invoices), Expenses, Products, Warehouse,
  Inventory, Transfers, BankReconciliation, Journals, Periods, Accounts,
  Assets, Payroll, Tax, Reports, Contacts, Settings, Team, Audit, Capital
  (loans/shares), Admin (billing, directory), PartnerAdmin, Support.

## 5. Database (Supabase/Postgres)

- **Migrations:** 62 files (base 20250101 + incremental). Base migration
  made **idempotent** (Phase 10-adjacent fix): enums guarded by
  `to_regtype`, tables `IF NOT EXISTS`, FKs drop+add. 8B reconstructions use
  **drop-first** for legacy functions/views.
- **Schema:** 65 tables, 16 enums, 195 FKs, 11 triggers, 7 views, 71+
  functions (live-verified 8A.1; staging == fresh replay).
- **RLS:** 102 policies on 35+ tables (8B.3); 6 tables service-role-only;
  audit_log immutable (can_read_audit only). 30 tables previously
  policy-less now covered.
- **Auth:** Supabase GoTrue (anon key + JWT in browser; service-role never
  in `VITE_*` — verified `.env.example` only exposes URL + anon key).

## 6. Edge Functions (23)

accept-invite-link, ai-insights, api (public API), cancel-account-deletion,
create-api-key, create-invite-link, expire-subscriptions, export-my-data,
finalize-account-deletions, generate-partner-invoices, generate-vat-returns,
grant-manual-subscription, initiate-subscription-payment, invite-team-member,
invoice-open, list-team-members, paychangu-webhook, process-invoice-
automation, request-account-deletion, send-invoice, send-renewal-reminders,
suggest-bank-matches, support-agent, verify-subscription-payment,
webhook-dispatcher.

## 7. Scheduled jobs (pg_cron)

- `expire-subscriptions-daily` (01:00 UTC) — 20260726000003
- `send-renewal-reminders-daily` (08:00 UTC) — 20260726000005
- `generate-partner-invoices-monthly` — 20260727000006
- All use `<PROJECT_REF>`/`<CRON_SECRET>` placeholders (env substitution at
  deploy; no secrets in migrations).

## 8. Integrations

- **PayChangu** (subscription payments), **SendGrid** (invoice email),
  **Anthropic** (AI Insights / Support Agent), **Sentry** (frontend +
  edge), **Vercel** (frontend), **Railway** (optional Express gateway,
  currently skipped), **PayChangu webhook**.

## 9. Environment / deployment

- GitHub Actions `deploy.yml`: staging on push-to-main; production on
  `v*` tag or dispatch + **approval gate**; environment protection rules
  restrict production deploys.
- **Phase 10 incident evidence:** production blank page caused by
  `VITE_SUPABASE_ANON_KEY_PROD` secret missing → module-scope throw. Fixed
  by adding the secret + redeploy; **no automated check exists** to fail the
  build when a required `VITE_*` var is empty.
- Staging frontend deploy currently failing (Vercel staging project —
  separate finding).

## 10. Notable code-quality seams (counted 2026-08-16)

| Item | Count | Risk |
|---|---|---|
| `as any` / `as never` | 129 | masks type errors (mostly legacy casts) |
| Hard-coded VAT `0.175` | 4 sites | duplicated; rate-change risk |
| Broad `catch {}` (silent) | 7+ | swallows failures (incl. journalService discount fallback) |
| `TODO/FIXME` | 1 | trivial |
| `eslint-disable` | 27 | mostly generated-artifact headers |

## 11. Offline

- `src/offline/` (Dexie queue, syncEngine, queueApi) — present; per-workflow
  offline support not end-to-end verified (browser journey M).

## 12. AI

- `aiFinancial.ts` builds business context from business-scoped queries;
  `aiInsightsAgent.ts` calls Anthropic with that context. Read-only — no
  accounting writes. Tenant scoping relies on the same RLS-scoped queries.

## 13. Observability / backup

- Sentry (frontend + edge DSNs per env), logger with PII stripping,
  `backup-verify.yml` (restores latest dump to throwaway DB) — **no recent
  successful restore evidence** in this audit window.
