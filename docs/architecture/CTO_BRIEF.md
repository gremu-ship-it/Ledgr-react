# Ledgr — CTO operating brief

**Date:** 2026-08-22 · **Audience:** engineering lead / next CTO session
**Status:** living document. Prior audits stay in `SYSTEM_AUDIT.md` and `docs/audit/`. This file is the decision log and the 90-day plan.

---

## 1. What we are

Ledgr is a **multi-tenant, MWK-first accounting SaaS** for Malawian SMEs. The product computes figures that get filed with the MRA. That makes correctness, tenant isolation, and auditability more important than feature velocity.

| Layer | Choice | Why it stays |
|---|---|---|
| Client | React 19 + Vite SPA / PWA | Offline-first on flaky MW connectivity |
| State | TanStack Query + Zustand | Server state vs session/UI state are already split |
| Data | Supabase Postgres + Auth + RLS | One ACID store; RLS is the tenancy boundary |
| Compute | Supabase Edge Functions (Deno) | Secrets never leave the server |
| Optional edge | Express gateway on Railway | Rate-limit / partner façade only |
| Hosting | Vercel (web) + two Supabase projects | Staging ≠ production, no shared credentials |

We do **not** introduce Kubernetes, a message bus, or a second write store until a single Postgres plus Edge Functions is measurably the bottleneck.

---

## 2. Architecture principles (non-negotiable)

1. **RLS is the security boundary.** The browser holds the anon key. Any table without RLS is world-readable to a signed-in user. New tables ship with RLS in the same migration.
2. **The DAL is the only writer.** Pages must not grow new `supabase.from(...)` write paths. Repositories + journal services own money movement.
3. **Double-entry is an invariant, not a convention.** `createBalancedEntry` rejects unbalanced drafts. Tests pin the invariant.
4. **Secrets never get a `VITE_` prefix.** Cron, PayChangu, SendGrid, Anthropic live in Edge Function secrets.
5. **Idempotency on every money write.** `client_key` unique indexes + atomic RPCs (`reserve_next_document_number`, `increment_amount_paid`, `next_journal_entry_number`).
6. **Offline is eventually consistent; the server is not.** Dexie queue syncs with retries. The ledger is strongly consistent once posted.
7. **One formula, one module.** PAYE, VAT, depreciation, inventory valuation live in leaf modules with tests. Edge Functions that cannot import `src/` must copy the formula and name the source.

---

## 3. Current shape (honest)

```
Browser (PWA)
  ├─ routes / plan / role guards     (UX only — RLS + RPCs enforce)
  ├─ pages (too large; see §5)
  ├─ services/  journal, inventory, FX, assets
  ├─ dal/repositories/               (28 repos, BaseRepository)
  ├─ offline/ Dexie queue
  └─ supabase-js  ──►  PostgREST + Auth + Storage
                         │
                         ├─ Edge Functions (cron, payments, public API, AI)
                         └─ Postgres (RLS, SECURITY DEFINER RPCs, pg_cron)
```

**What is already good**
- Repository DAL, hashed API keys, HMAC webhooks, CORS allowlist, CSP/HSTS, circuit breakers, DB-backed document *and* journal numbers, weekly backup-restore verify, staging/prod split, Dependabot.

**What is still the risk**
- God pages (Settings 2k LOC, Assets 1.7k). They mix form, query, and posting.
- Pages still import `supabase` directly — DAL leaks.
- `updateIfUnchanged` exists and is unused. Concurrent invoice edits are last-write-wins.
- Feature flags are build-time only (`VITE_FEATURE_*`).
- SLOs are drafted (`docs/ops/SLOs.md`) but not wired to a pager.
- Public API GET is a single page of 1 000 rows (now labelled `truncated` in meta).
- Website marketing copy is still TODO-heavy.

---

## 4. Security posture (this session)

Closed in code, 2026-08-22:

| Item | Why it mattered |
|---|---|
| CSP now allows Sentry + Vercel Analytics | Observability was configured and then blocked by `connect-src` |
| Shared fail-closed, timing-safe cron auth | 7 functions compared secrets with `!==`; empty secret could fail open |
| `process-invoice-automation` accepts `CRON_SECRET` | Deploy only sets `CRON_SECRET`; the job required `INVOICE_CRON_SECRET` and was dead |
| Cron + public API + pixel + webhook on `--no-verify-jwt` | Gateway JWT rejected `ledgr_sk_*` keys, tracking pixels, and pg_cron |
| `verify_jwt` pinned in `config.toml` | Auth posture is no longer dashboard-only |
| Local password policy 8 + letters/digits; TOTP MFA on | Matches a financial product; **mirror on hosted Auth** |
| `npm audit --omit=dev --audit-level=high` in CI | Runtime advisories now fail the build |
| Dead-letter retry can invoke dispatcher via cron secret | Membership check made retries a no-op |

**Dashboard-only (cannot do from git)**
- Confirm hosted Auth: min password 8, `letters_digits`, TOTP enroll.
- Confirm `ALLOWED_ORIGINS` is set (CORS still falls back if unset).
- Confirm Sentry alert rules page a human (SLO burn).
- Confirm Vercel WAF + Supabase PITR.

---

## 5. Maintainability — the 90-day split plan

Do **not** rewrite. Extract from the largest pages, one surface at a time, behind existing tests.

| Sprint | Extract from | Into |
|---|---|---|
| 1 | `InvoicesPage` / `ExpensesPage` payment + posting | hooks + existing journal services (already mostly there) |
| 2 | `AssetsPage` capitalisation / disposal / reval UI | `components/assets/*` |
| 3 | `SettingsPage` tabs | `pages/settings/*` (Team already split) |
| 4 | `PayrollPage` remaining calc + approval | `lib/paye.ts` is done; rest is UI |

Stop adding logic to a page that is already > 600 LOC. New features land in `services/` or `components/<domain>/`.

---

## 6. Scalability — next real limits

We are not at “need to shard” scale. The next cliffs are:

1. **PostgREST 1 000-row cap** — reports already paginate via `fetchAllRows`. Any new aggregate must use it. Public API now reports `truncated`.
2. **`.in(uuid[])` URL length** — VAT rollups and product lookups now chunk at 200.
3. **COGS posting** — no longer loads the entire product catalogue per sale.
4. **Journal sequence is global** — `p_business_id` is accepted but unused. Split per tenant only if the 6-digit daily suffix is close to rolling.
5. **Edge Function wall-clock** — `generate-vat-returns` is a serial loop over every VAT-registered business. Fine until hundreds of tenants; then fan-out per business.
6. **React Query `staleTime` is 60s** — keep it. Do not refetch SOFP on window focus.

---

## 7. 90-day roadmap

**P0 — this month**
- Deploy this branch. Manually confirm: PayChangu webhook, invoice pixel, `/functions/v1/api` with an API key, one cron (`expire-subscriptions`) with `x-cron-secret`.
- Mirror password / MFA settings on hosted Auth.
- Wire Sentry alerts to the SLO burn policies in `docs/ops/SLOs.md`.

**P1 — next month**
- Use `updateIfUnchanged` on invoice and expense edit.
- Golden-file tests for SOFP / P&L / cash flow on a fixture business.
- Split `SettingsPage` tabs. Ban new `supabase.from` writes in pages (eslint override or review checklist).

**P2 — quarter**
- Cursor pagination on the public API (`page[after]`).
- Runtime feature flags (table + RLS) for risky rollouts.
- One k6 smoke against staging before any marketing push.

---

## 8. How to work in this repo

- Money math belongs in a leaf module with a vitest file. If you cannot test it without Supabase, it is in the wrong layer.
- Edge Functions that need a formula from `src/` **copy it** and comment the source. Do not invent a monorepo until the third copy appears.
- Migrations are forward-only and idempotent. Never edit an applied migration.
- Production deploys are `v*` tags behind the GitHub `Production` environment.

When in doubt: **protect the ledger, then the tenant boundary, then the deploy pipeline.** Everything else waits.
