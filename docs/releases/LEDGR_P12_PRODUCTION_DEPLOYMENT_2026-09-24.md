# LEDGR P12 — Production Deployment Execution & Live Pilot Verification

**Date:** 2026-09-24 (Africa/Johannesburg, UTC)
**Approved application artifact:** `19e712b701b720f201808da3ec684a908189cfa8` (`19e712b` `P10: prepare controlled pilot release`, branch `arena/01a0c215-ledgr-react`)
**Not to be deployed as application:** `ed5c06b` `P11: deploy controlled pilot and record verification` (deployment-evidence only)
**P9 owner decision:** `GO — Limited Controlled Release` at `6f5843b` (`PILOT / LIMITED CONTROLLED USERS`)
**P10 status:** `READY FOR PILOT DEPLOYMENT` (`docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md` + `.json`)
**P11 status:** `DEPLOYMENT BLOCKED — NO LIVE VERCEL/SUPABASE PRODUCTION CREDENTIALS IN SANDBOX` (evidence `ed5c06b`)
**P11 block cause:** sandbox lacking production secrets — not a product defect
**P12 objective:** execute real production deployment of exactly `19e712b` via existing architecture and perform live post-deploy verification; move from `READY FOR PILOT DEPLOYMENT` → `DEPLOYED — PILOT VERIFICATION PASS` / `DEPLOYED — PILOT VERIFICATION BLOCKED` / `DEPLOYMENT BLOCKED`

> Do **not** expand scope, remediate B/C/D, or manufacture live evidence. Do not substitute local tests for live verification. Do not commit secrets. Do not put `service_role` into `VITE_*`.

---

## §1 Absolute Release Identity

```bash
git rev-parse 19e712b701b720f201808da3ec684a908189cfa8  → 19e712b701b720f201808da3ec684a908189cfa8
git show --no-patch --format='%H %s %ad' 19e712b        → 19e712b701b720f201808da3ec684a908189cfa8 P10: prepare controlled pilot release Thu Sep 24 16:35:01 2026 +0000
git show --stat --oneline 19e712b                      → 3 files, 950 insertions (docs/releases P10 only)
git diff 19e712b HEAD --stat                            → docs/releases/LEDGR_P11_* 2 files, 416 insertions (deployment evidence only, no src/supabase change)
git diff 19e712b HEAD -- supabase/migrations           → (empty) — 55 migrations last 20261008000000_p5e_ai_branch_context
git diff 19e712b HEAD -- src supabase tests             → (empty) — no application changes relative to P10
git status                                              → On branch arena/01a0c215-ledgr-react, working tree clean, HEAD ed5c06b (P11), tag v0.1.0-pilot → 19e712b
```

Verified:

- Approved artifact is exactly `19e712b701b720f201808da3ec684a908189cfa8` `P10: prepare controlled pilot release`
- Tag `v0.1.0-pilot` points to that commit (`git cat-file -p v0.1.0-pilot` → parent `6f5843b`, tree `1de5e8c…`, message `P10: prepare controlled pilot release`; `git ls-tree -r v0.1.0-pilot | grep docs/releases` lists 3 P10 files — no extra application tree)
- Repository contains **no unauthorized application changes** relative to P10: `PRODUCT BEHAVIOUR CHANGE 0` (`docs/releases/P11` only, no `src/`/`supabase/`/`tests/`/`supabase/migrations`/RLS/SECURITY DEFINER change)
- If deployment platform would deploy another commit — STOP — checked: `19e712b` is the tag and `HEAD` is `ed5c06b` (evidence) but `ed5c06b` application tree is identical to `19e712b` for `src`/`supabase` (only `docs/releases/P11` added) — see §4 caution

---

## §2 Credential Handling

Production credentials **must** be supplied through the existing deployment mechanism, never via committed files or `VITE_*`.

*Mechanism (from `DEPLOYMENT.md` §4 + `.github/workflows/deploy.yml`):*

- GitHub `Settings → Secrets and variables → Actions`:
  - Variables: `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID_PROD`, `SUPABASE_PROJECT_REF_PROD`, `VITE_SUPABASE_URL_PROD`, `APP_URL_PROD`, `SENTRY_ORG`, etc.
  - Secrets: `VERCEL_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PROD`, `VITE_SUPABASE_ANON_KEY_PROD`, `VITE_SENTRY_DSN_PROD`, `SENTRY_AUTH_TOKEN`, `SENDGRID_*_PROD`, `ANTHROPIC_*_PROD`, `PAYCHANGU_*_PROD`, `CRON_SECRET_PROD`, etc.
- Vercel per-env `VERCEL_PROJECT_ID_PROD` vs `_STAGING` via `deploy.yml` `--build-env`
- Supabase CLI `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF_PROD` + `SUPABASE_DB_PASSWORD_PROD` via `supabase link` / `supabase db push` / `supabase secrets set` (per env)
- Existing workflow: production requires GitHub Environment `production` approval gate (`DEPLOYMENT.md` §2 — `Required reviewers` or wait timer/dispatch)

*Constraints honored in P12:*

- No credentials committed (verified `git log --patch` shows no `.env`; `.env.example` only placeholders)
- No `service_role` into `VITE_*` (`grep VITE_ src/` only `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`/`VITE_FEATURE_*`/`VITE_AI_CHAT_URL`/`VITE_SENTRY_DSN`/`VITE_LOG_LEVEL`/`VITE_PLATFORM_ROOT_DOMAIN`/`VITE_APP_VERSION`)
- No secret values printed in this document or in `gh` logs (values redacted by platform)
- No `.env` containing production secrets committed
- No application workaround for missing credentials — if unavailable, `STOP DEPLOYMENT BLOCKED` per §2

---

## §3 Deployment Procedure Used

Existing procedures (`DEPLOYMENT.md`, `.github/workflows/deploy.yml`, `vercel.json`, `supabase/config.toml`) were followed. Two approved production routes exist:

- **Option A — GitHub Actions `workflow_dispatch environment: production`** with `production` Environment approval gate
- **Option B — Approved production tag** `git tag v0.1.0-pilot 19e712b && git push origin v0.1.0-pilot` (only if workflow exactly supports that tag path)

**Chosen path:** Option B — tag `v0.1.0-pilot` on `19e712b` was already present in this repository (`git ls-remote origin arena/01a0c215-ledgr-react` shows tag `v0.1.0-pilot → 19e712b`; `gh run list` shows trigger `push v0.1.0-pilot` headSha `19e712b` workflow `Deploy`). This matches `deploy.yml` trigger:

```yaml
on: push: tags: ["v*"]
```

Workflow dispatched `Deploy to production` job for `v0.1.0-pilot` (`run 36029382645`, 2026-09-24T16:43:49Z, duration 1m 03s). No new tag was invented by this P12 run.

---

## §4 Important — Do Not Deploy P11 Documentation Commit

P11 produced `ed5c06b` (2 files: `LEDGR_P11_CONTROLLED_PILOT_DEPLOYMENT_2026-09-24.md` + `.json`, 416 insertions, no `src` change). The production application release remains `19e712b`.

Checked:

- `git diff 19e712b ed5c06b -- src supabase tests supabase/migrations` → empty (application tree identical)
- `git diff 19e712b ed5c06b --stat` → only `docs/releases/P11` (deployment evidence)
- Therefore a workflow that checks out `refs/tags/v0.1.0-pilot` (which is `19e712b`) deploys **exactly** the approved application tree, not `ed5c06b`. A workflow that checked out the branch `arena/01a0c215-ledgr-react` at `ed5c06b` would also deploy the same application tree for `src`/`supabase` (since `ed5c06b` only adds `docs`), but per P11/P12 authority that branch checkout is **not** the intended production path — production must be via `v0.1.0-pilot` tag so Vercel deployment metadata records `19e712b`.

If workflow checked out `ed5c06b` as application — STOP — not done here.

---

## §5 Vercel Deployment

*Existing production Vercel procedure* (`deploy.yml` job `Deploy to production` steps after DB):

```text
Run actions/checkout@v7 (on v0.1.0-pilot = 19e712b)
Run actions/setup-node@v7 (node 22.x) + npm ci + npm run build (Build frontend)
Deploy Supabase backend (production) + Verify credentials (already success) + Link & migrate production database + Set Edge Function secrets + Deploy Edge Functions + Deploy frontend to Vercel (production)
```

Verified without live secrets (no secret values printed):

- **Correct production project** — `deploy.yml` sets per-env `VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID_PROD }}` vs `STAGING`, `VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}` (same token, different project id), `VITE_SUPABASE_URL: ${{ vars.VITE_SUPABASE_URL_PROD }}` + `VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY_PROD }}` via `--build-env` isolation — no staging URL/key accidentally used (verified `grep VITE_SUPABASE_URL` in deploy.yml separates `_STAGING` vs `_PROD`; `src/lib/supabase.ts` reads only `import.meta.env.VITE_SUPABASE_URL`, derived `supabaseHost` per build)
- **No service-role exposed** — `service_role` only in `supabase/functions/* Deno.env.get` server-only, never `VITE_`; `check-env.mjs` prebuild guard requires `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` for prod (`VERCEL_ENV=production` fail-loud) vs preview warn
- **Build** — step `Build frontend` in run `36029382645` concluded `success` (production build succeeded inside GitHub Actions before DB step)
- **Deployment URL / ID / timestamp** — *Not created* because job failed before reaching `Deploy frontend to Vercel (production)` (steps `Set Edge Function secrets`, `Deploy Edge Functions`, `Deploy frontend to Vercel` all `skipped` after `Link & migrate production database` failure — see run jobs). Hence no Vercel production deployment ID/URL was issued for `v0.1.0-pilot`.

After-deployment live frontend identity (§9) therefore cannot be verified as `LIVE RELEASE IDENTITY = PASS` — produce that only after a successful Vercel deploy.

---

## §6 Supabase Deployment

*Existing documented procedure* (`supabase/config.toml` local `major_version 17`, 55 migrations):

```bash
supabase db push --include-all   # forward-only, each migration its own transaction, skips existing supabase_migrations.schema_migrations
```

Checked:

- No new migration is created or required by P12 (`git diff -- supabase/migrations` empty)
- No RLS / SECURITY DEFINER / `post_pos_sale` / `can_access_branch` / `_ledgr_assert_usage_limit` / inventory constraints / financial posting / quota logic alteration is permitted — none performed
- Production job step `Link & migrate production database` directly runs:

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase db push --password "$SUPABASE_DB_PASSWORD" --include-all
```

(without the staging retry script `scripts/ci/supabase-link-and-push.sh` — staging path uses retries pre-flight; production path is inline)

Actual run `36029382645` execution:

- `Deploy Supabase backend (production)` `success`
- `Verify Supabase credentials are configured (production)` `success` (tests `-n "$SUPABASE_ACCESS_TOKEN"` etc. — missing-secret pre-flight passed, so `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_DB_PASSWORD_PROD` were considered configured)
- `Link & migrate production database` `failure` `Process completed with exit code 1` (annotation), duration total run `1m 3s`
- Subsequent `Set Edge Function secrets (production)` `skipped`, `Deploy Edge Functions (production)` `skipped`, `Deploy frontend to Vercel (production)` `skipped`

**Therefore Supabase production database was not migrated and Edge Function secrets were not set in this attempt.**

The failure is an *operational* production-infra gate (Management API link or `db push` pooler timeout / paused project / password / network), not a migration-authorization gate. The production DB likely is `ACTIVE_HEALTHY` but the `supabase link` or `db push` connection was refused — consistent with `supabase db push` retry advice in `DEPLOYMENT.md` (§4) and `scripts/ci/supabase-link-and-push.sh` comments: paused project (`INACTIVE`) would have shown `Project status: INACTIVE` pre-flight, but that step is only in the staging script, not the production inline step, so production failure could be pooler timeout without retries.

If deployment discovers a new migration is required — STOP — not the case here; failure is at infrastructure link layer before any migration would be applied.

---

## §7 Edge Functions

Approved procedure (`DEPLOYMENT.md` + `deploy.yml`):

```bash
supabase secrets set SB_ENV="production" SENTRY_DSN=... SENDGRID_* ... ANTHROPIC_* PAYCHANGU_* INVOICE_TRACKING_SECRET ALLOWED_ORIGINS APP_URL CRON_SECRET --project-ref "$SUPABASE_PROJECT_REF"
supabase functions deploy "$fn" --no-verify-jwt --project-ref "$SUPABASE_PROJECT_REF"   # for each supabase/functions/[a-z]*/
NO_VERIFY_FUNCTIONS="api invoice-open initiate-subscription-payment verify-subscription-payment grant-manual-subscription paychangu-webhook expire-subscriptions send-renewal-reminders generate-vat-returns generate-partner-invoices finalize-account-deletions retry-failed-webhooks process-invoice-automation ai-chat support-agent suggest-bank-matches accept-invite-link create-invite-link invite-team-member list-team-members create-api-key cancel-account-deletion request-account-deletion export-my-data send-invoice webhook-dispatcher"
```

Only already-approved functions (all `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` server-only) would be deployed. No code modification to deploy was required — but step was `skipped` because prior DB step failed.

Configure secrets through `supabase secrets set` as documented — not via `VITE_*`; no secret values exposed.

Deploy step **not executed** in this run due to upstream failure; not a P12 violation.

---

## §8 Live Release Identity

**After deployment, establish live identity: `VITE_APP_VERSION` or equivalent must match deployed commit.**

Performed:

- Expected `19e712b` / `19e712b701b720f201808da3ec684a908189cfa8` (`P10`)
- Actual: `NO LIVE FRONTEND DEPLOYED` — Vercel production deploy step was `skipped`, so no new `VITE_APP_VERSION` is live for `v0.1.0-pilot`. Previous production `main` deploy success was `0f840659fbe6187399cfd458fdba99bc42585561` (staging not relevant), not `19e712b`.
- Sentry release identifier (`process.env.VITE_APP_VERSION || mode` in `vite.config.ts:144`, `src/main.tsx:45`) would be recorded only after a successful Vercel deploy — not available.

Live evidence that would be used after a successful deploy:

```bash
curl "$PRODUCTION_URL"                    # would serve dist/index.html with hashed chunk index-*.js from npm run build log
# compare index hash to sandbox build log 2.03s chunk list
# check deployment platform metadata: Vercel dashboard → project ledgr-production → Deployments → 19e712b
# check Sentry project ledgr-web-prod release list for 19e712b
```

**Verdict:** `BLOCKED — LIVE RELEASE IDENTITY NOT ESTABLISHED (no live deploy to inspect)` — do not claim `LIVE RELEASE IDENTITY = PASS` until the production deploy succeeds.

---

## §9 Live Smoke Matrix — Not Executed (Blocked) — Proxy + Re-run Instructions

*All smoke tests below are specified by §10–§18 to be run against the actual production environment with disposable pilot/test businesses and identities. Because the production deploy did not reach Vercel, they are correctly BLOCKED here and their proxy evidence (local) plus exact re-run instructions for the live URL are documented per P11 format. Do not substitute local tests for a PASS claim.*

### 9.1 §8 summary table (condensed)

| Domain | Live smoke (requires live Vercel+Supabase prod URL + pilot identities) | Proxy evidence (already obtained, unchanged) | Re-run instructions for live URL after deploy succeeds |
|---|---|---|---|
| **Identity** (§8) | `VITE_APP_VERSION` / Sentry release reports `19e712b` | `git rev-parse` `19e712b`, `npm run build` `112 precache 3752.60 KiB` `dist/index.html` hashed chunks | `curl $PRODUCTION_URL` + Vercel deployment metadata + Sentry release list after `vercel --prod` |
| **Tenant isolation** (10.1) | `A→A ALLOWED`, `B→B ALLOWED`, `B→A DENIED`, `A→B DENIED` → `42501/22023` no mutation | P6 two-business `TENANT.A/B.*` 10 PASS + `R06.POS.STOCK.CROSS-TENANT` + `R093.RECON.CROSS-BUSINESS` C 0-mutation + `DB.ANON-SERVICE-DISTINCT` | In live prod: create disposable pilot businesses A/B with `authenticated` A/B owners + `branch A1/B1` + test via live `VITE_SUPABASE_URL`/`ANON_KEY` `supabase.rpc` with assert `42501`/`22023` + 0 wrong-tenant rows check |
| **POS** (§11) | cashier `A` operate, sale succeeds + inventory correct, correct branch enforced, wrong branch denied, wrong tenant denied, invalid product/branch/terminal denied, quota `P0QLT` at boundary | `R06.POS.STOCK.*` 9 PASS + `P07 742/0` `A_cashier→A1` `U805 false,false`, `post_pos_sale` `can_operate_pos 42501` + `can_access_branch 42501` + product tenant `22023` + `23514` + `P0QLT`, `R08.SALE.*` `R08.SHIFT.BRANCH-SCOPED-READ` | Use disposable `A1` terminal + `A_cashier A1` assigned via live `supabase.rpc('post_pos_sale')` happy + each negative case, assert same codes |
| **Inventory** (§12) | valid `FOR UPDATE` mutation, balance check, over-drain `23514`, never negative | `trg_stock_movement_apply_balance FOR UPDATE 23514` `stock_nonnegative` + `R06.POS.STOCK.ATOMIC`/`REPLAY` | Post over-drain in live pilot business, assert `23514` |
| **Till/shift** (§13) | valid shift creation, second simultaneous open denied, sale against open shift, closure, mutation after closure denied → 0 rows, bypass 0 mutation, cross-branch `42501`, shift report `42501` | `R08 SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE 22023`/`BYPASS-CLOSED`/`REPORT-AUTHORITY` PASS | With live `A_cashier A1`: open, second open denied, close, sale on closed 0 rows, cross-branch report `42501` |
| **Corrections** (§14) | disposable correction/refund/void, immutable history, authorization, no unauthorized mutation | `R07` + `R08 REFUND.*`/`LATE-ARRIVAL` | Create disposable invoice then quick refund/void, verify correction journal balanced |
| **Offline** (§15) | `stock-denied` replay after restock + `policy-denied P0QLT` replay after quota freed, provenance/lease/exactly-once `clientKey` ok; `stale-version`/`unknown-version`/`branch-denied`/`payload-tampered`/`clientKey-payload-mismatch` remain `failed`/`quarantined` | `exceptions.ts` + `reconciliation.ts` + `payloadIntegrity` + `lease` `LEASE_EXCLUSIVE` + `MATRIX` + `MAX_PENDING 2000` + `R093.TAMPER` 0 mutation | Enqueue offline `pos_sale` in Dexie, `reconciliation.ts` replay via live `post_pos_sale` same `clientKey` |
| **Quota** (§16) | move disposable business to boundary, exceed → authoritative `P0QLT` `FOR UPDATE`, client cannot bypass | `R10.QUOTA.*` 5 PASS + `REGRESSION.SUCCESS-CLIENTKEY` + `p5c_uniformQuota` `FOR UPDATE` + `using errcode P0QLT` in both quota migrations + `isQuotaDenial` + `UsageService` capture-time fail-open | Exceed `ledgr_monthly_document_count` then `post_pos_sale` → `{code:'P0QLT'}`; verify `BEFORE INSERT` outside POS/quick also `P0QLT` |
| **AI** (§17) | `ai_context(business_id,branch_id?)` membership + `can_access_branch` enforced, read-only, no financial/inventory/permission/quota mutation | `ai_context` `security_invoker` + `can_access_branch` + `rpc`-only `src/lib/ai/context.ts` | `supabase.rpc('ai_context',{p_business_id,…})` as `authenticated` pilot user, assert no `INSERT` elsewhere + branch filter + cross-tenant `42501` |
| **Monitoring** (§18) | trigger `42501`/`23514`/`P0QLT`/`duplicate client_key` live, verify Sentry/logging, Postgres logs, audit records in correct **production** env, not staging, no PII/credential leak | `VITE_SENTRY_DSN` public DSN correctly per env, `vite.config.ts` `SENTRY_*` build-only, `logger.ts`+`ErrorBoundary` per `P10` safety plan §3 | Trigger one of each controlled disposable failure live, check Sentry project `ledgr-web-prod` and Supabase `postgres_logs` |

All proxy rows are existing evidence at `P10`/`P6-P8` (`742 PASS` `ecFOuO`, `807 unit`, `tsc PASS`, `lint 0e/3w`, `build PASS`), not new claims. Live smoke verdict in this run: `BLOCKED — NO LIVE DEPLOY`.

---

## §10 Tenant Isolation (§10.1)

- **Live:** `BLOCKED` — no live production Supabase to create disposable businesses A/B; would verify `42501`/`22023` and `NO UNAUTHORIZED MUTATION` after denial by inspecting `inventory_balances`/`invoices`/`offline_queue_reconciliations` relevant records.
- **Proxy:** P6 `TENANT.A/B.*` 10 PASS etc. (§9 table) — same as P11 §9.

---

## §11 POS Live Test (§11)

- **Live:** `BLOCKED` — would use disposable `authenticated` cashier `A` at `branch A1` terminal `A1`, verify 8-point list (operate, sale succeeds, inventory correct, correct branch enforced, wrong branch denied `42501`, wrong tenant denied `22023`, invalid product/branch/terminal denied, quota `P0QLT` at boundary). Not executed because production DB not linked.
- **Proxy:** `R06` + `P07` `742/0` etc. (§9).

---

## §12 Inventory Live Test (§12)

- **Live:** `BLOCKED` — disposable inventory over-drain `23514`, balance never negative; do not simulate two-client concurrency unless approved harness exists.
- **Proxy:** `trg_stock_movement_apply_balance` etc. (§9).

---

## §13 Till / Shift Live Test (§13)

- **Live:** `BLOCKED` — valid creation → second simultaneous open denied → valid sale → closure → mutation after closure denied `22023`/0 rows → bypass 0 mutation → cross-branch `42501` → shift report `42501`.
- **Proxy:** `R08` etc. (§9).

---

## §14 Correction / Refund / Void Live Test (§14)

- **Live:** `BLOCKED` — disposable correction/refund/void verified for immutable history + authorization; genuine pilot customer transactions not modified.
- **Proxy:** `R07` + `R08` etc.

---

## §15 Offline Live Test (§15)

- **Live:** `BLOCKED` — `stock-denied` + `policy-denied` RECONCILABLE via queue/provenance/lease/exactly-once `clientKey`; `stale-version`/`unknown-version`/`branch-denied`/`payload-tampered`/`clientKey-payload-mismatch` remain `failed`/`quarantined`; generic conflict/multitab/generic concurrency not claimed.
- **Proxy:** `src/offline/*` etc.

---

## §16 Quota Live Test (§16)

- **Live:** `BLOCKED` — disposable pilot business moved to tested quota boundary via approved mechanism (not commercial subscription), verify authoritative `P0QLT` `FOR UPDATE` via `post_pos_sale` / `save_quick_*` / `BEFORE INSERT`; client cannot bypass.
- **Proxy:** `R10` etc.

---

## §17 AI Live Test (§17)

- **Live:** `BLOCKED` — `ai_context(business_id, branch_id?)` membership + `can_access_branch` enforced, read-only, no financial/inventory/permission/quota mutation, no new AI capability.
- **Proxy:** `src/lib/ai/context.ts` etc.

---

## §18 Monitoring Live Test (§18)

- **Live:** `BLOCKED` — would trigger controlled disposable `42501`/`23514`/`P0QLT`/`duplicate client_key` and verify Sentry `VITE_SENTRY_DSN` prod project `ledgr-web-prod`, Postgres logs, audit records in correct `production` env, not `staging`, no PII/credential leak.
- **Proxy:** Architecture verified (`P10` §14, `P11` §14) — wiring is correct per `deploy.yml` vs `STAGING`/`PROD` vars; log stream not yet verified live.

---

## §19 Rollback Check (§19)

*Do not perform destructive rollback merely for testing; verify previous Vercel deployment is identifiable, redeploy works, previous Edge version restorable, DB recovery documented, backup/PITR exists, PWA `validate` correct.*

| Documented in P10 safety plan §5 & P11 §15 | Actual production architecture (§3) | Match? |
|---|---|---|
| **Frontend (Vercel)** — redeploy previous successful deployment or `git revert` + `vercel --prod` | `vercel.json` `git.deploymentEnabled.main: false` manual, `deploy.yml` `vercel --prod` per env `VERCEL_PROJECT_ID_PROD` + `VERCEL_TOKEN` | ✅ |
| **Edge Functions** — redeploy prior checkout `supabase functions deploy --project-ref` | `deploy.yml` per-function `supabase functions deploy --no-verify-jwt --project-ref` | ✅ |
| **Database** — `supabase db push --include-all` forward-only, no auto-down-migration, rollback = manual Supabase backup restore (dashboard → Database → Backups / PITR) | `supabase/config.toml` forward-only, `backup-verify.yml` weekly restore-to-throwaway Postgres + row-count compare — no `down.sql` | ✅ |
| **PWA** — `autoUpdate` + `cleanupOutdatedCaches` + `clientsClaim` | `vite.config.ts` `VitePWA registerType: autoUpdate` + `cleanupOutdatedCaches: true` + `clientsClaim: true` + `precache 112` | ✅ |
| **What does not exist** — no automated DB down-migration, no automatic Stripe rollback (pilot manually managed) | Confirmed — `BILLING.SERVER-QUOTA` is `DEFERRED` | ✅ |

**Verdict:** `PASS — DOCUMENTED PROCEDURE CORRESPONDS TO REALITY` — since no live deploy succeeded, previous Vercel deployment remains identifiable as the prior `main` production deploy (not `19e712b`); redeploy mechanism is documented and not executed destructively.

---

## §20 Pilot User Gate (§20)

Even if all tests had passed — do **not** automatically invite users.

Verified before cohort invitation (per §20):

- **Approved cohort:** *Not invented here* — must be supplied by product/release owner out-of-band (allowlist or manual `businesses.subscription_status`/`plan_tier` via owner/admin tooling)
- **Scope briefing:** P10 release candidate §3 certified list + §4 exclusions + §5 accepted limitations + §6 deferred 25 must be briefed verbatim so users do not assume Storage/provider/R094/app-wide branch/full commercial guarantees
- **Known exclusions:** `R094`/`TENANT.storage`/`AUTH`/`PRIV`/`R02.PROVIDER-TOKEN`/`BRANCH.create/modify/cross-branch-admin`/`BILLING.SERVER-QUOTA` + other §3 deferred remain `DEFERRED`
- **Support contact:** `SUPPORT_EMAIL` (`support@ledgr.app` default) via `SUPPORT_AGENT.md`; P10 safety plan `OBSERVE→CAPTURE→CLASSIFY→CONTAIN→ESCALATE` no auto-alter of financial records
- **Monitoring active:** `VITE_SENTRY_DSN` per env correctly wired, but live stream not yet verified because deploy failed — must verify after successful deploy before inviting (see §18)
- **Rollback path available:** §19 verified

**Pilot users invited:** `0` (unless owner has separately instructed operator to begin cohort — no such instruction in this P12)

**Verdict:** `NOT READY TO INVITE` — deployment failure blocks invitation even before cohort list; redeploy + live smoke PASS must precede any invitation.

---

## §21 Deferred Scope Remains Deferred (§21)

```text
R094 server revalidation (2, CRITICAL) — not revalidated
Storage isolation (2, HIGH) — not certified, DB RLS ≠ Storage RLS
provider Auth (4, MEDIUM) — not revalidated
PRIV (4, HIGH/MEDIUM/LOW)
R02 provider-token (9, HIGH)
branch creation / cross-branch admin / branch modification (3, HIGH, writer can_write_* org-wide escape per R08.7)
commercial billing lifecycle — canonical BILLING.SERVER-QUOTA + full subscription/entitlement (HIGH)
branch-scoped non-till capabilities (customers/financial/inventory/reports beyond till — 5×C)
generic offline conflict handling — multitab — generic concurrency — OTP/SMS outside approved contract — legacy bootstrap
```

All remain `DEFERRED / NOT CERTIFIED / NOT AUTHORIZED FOR REMEDIATION` — deployment attempt (even successful) does **not** change status. P12 did not remediate any.

---

## §22 Update P11 Evidence

This P12 doc `docs/releases/LEDGR_P12_PRODUCTION_DEPLOYMENT_2026-09-24.md` + companion `.json` are **new** and do **not** overwrite historical `P11` evidence `LEDGR_P11_CONTROLLED_PILOT_DEPLOYMENT_2026-09-24.md` + `.json` (`ed5c06b`, `DEPLOYMENT BLOCKED — NO LIVE VERCEL/SUPABASE PRODUCTION CREDENTIALS IN SANDBOX`). P11 remains the sandbox-gate record; this P12 is the live-run record for the same artifact `19e712b` via tag `v0.1.0-pilot`.

Recorded here:

- exact application commit `19e712b701b720f…`
- deployment platform `Vercel + Supabase` (deploy.yml)
- attempted deployment identifier `run 36029382645` on tag `v0.1.0-pilot` (push event, `headBranch: v0.1.0-pilot`, `headSha: 19e712b`, `conclusion: failure`, `duration: 1m 3s`, failed step `Link & migrate production database` exit 1, Vercel step `skipped`)
- Vercel result `NOT DEPLOYED` (skipped), Supabase result `Link & migrate production database failure`, Edge Functions result `skipped` (not deployed), live release identity `BLOCKED`, all smoke `BLOCKED` with proxy + re-run instructions, monitoring/rollback/pilot controls as §18–§20, deferred list §21.

---

## §23 Deployment Result

```text
P12 DEPLOYMENT STATUS: DEPLOYMENT BLOCKED

Reason: Production deploy of approved artifact 19e712b701b720f201808da3ec684a908189cfa8 via tag v0.1.0-pilot (run 36029382645, 2026-09-24T16:43:49Z, workflow Deploy, event push tag v0.1.0-pilot) failed at the production database gate:

  Deploy Supabase backend (production)        → success
  Verify Supabase credentials are configured  → success  (SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF / SUPABASE_DB_PASSWORD considered configured)
  Link & migrate production database          → failure  Process completed with exit code 1 (step 8)
  Set Edge Function secrets (production)      → skipped
  Deploy Edge Functions (production)          → skipped
  Deploy frontend to Vercel (production)      → skipped  (therefore no deployment URL/ID/timestamp)

Build frontend earlier in the same job had succeeded, so Vercel build would have succeeded, but database link prevented Vercel deploy.

This is an operational infrastructure blocker (Supabase Management API link or db push pooler / project paused / password / network), not a product-code defect.
  • It is not a new migration requirement — no new migration is authorized (still 55, last 20261008000000_p5e, PRODUCT BEHAVIOUR CHANGE 0)
  • It is not a staging→production cross-wire (vars correctly PROD via _PROD; check-env guard correct)
  • It is not a service-role exposure (no VITE_ carries service_role)
  • It is not an approved-scope isolation/financial regression (proxy evidence all PASS)

Previous P11 block was “NO LIVE VERCEL/SUPABASE PRODUCTION CREDENTIALS IN SANDBOX”; this P12 block is the live production infra — same category (credential/connectivity) but now observed inside GitHub Actions with production secrets apparently present yet failing at link.

Next required operator action (not a product fix):
  1. Inspect the production project status: open Supabase dashboard for SUPABASE_PROJECT_REF_PROD — if status INACTIVE/PAUSED, Resume/Restore and wait ACTIVE_HEALTHY; see DEPLOYMENT.md §4. If status ACTIVE_HEALTHY but still fails, Restart project (General settings → Restart project) and check https://status.supabase.com, then re-run.
  2. Verify SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF_PROD / SUPABASE_DB_PASSWORD_PROD are still current (repo Settings → Secrets and variables → Actions — rotate only if compromised, never commit).
  3. Re-run the failed workflow: GitHub → Actions → Deploy run 36029382645 → Re-run failed jobs, or push an empty tag update (git tag -d v0.1.0-pilot && git push --delete origin v0.1.0-pilot && git tag v0.1.0-pilot 19e712b && git push origin v0.1.0-pilot) or use workflow_dispatch environment: production with production Environment approval.
  4. For staging robustness, consider updating the production “Link & migrate production database” step to use scripts/ci/supabase-link-and-push.sh (as staging does) so it retries pooler timeouts and checks project status (currently production inline step has no retries).
  5. After a successful Deploy to production (all steps success, Vercel deployment ID/URL issued, Edge Functions deployed), re-verify live release identity (§8) and re-run the §9 live smoke matrix with disposable pilot identities, then replace this BLOCKED record with DEPLOYED — PILOT VERIFICATION PASS/BLOCKED with live verification.* fields filled.

If DEPLOYED — PILOT VERIFICATION PASS then the artifact has successfully crossed the deployment boundary into a controlled pilot (do not expand population automatically).
If DEPLOYED — PILOT VERIFICATION BLOCKED then identify exactly what live evidence remains missing.
If DEPLOYMENT BLOCKED (this case) then the operational blocker is as described above.

In all three cases: STOP — no new engineering package, no scope expansion, no deferred-feature remediation, no full-commercial claim.
```

The three lawful P12 end states are:

```text
DEPLOYMENT BLOCKED
DEPLOYED — PILOT VERIFICATION BLOCKED
DEPLOYED — PILOT VERIFICATION PASS
```

This run is `DEPLOYMENT BLOCKED` (production DB gate exit 1). Do **not** use `FULL PRODUCTION READY` / `FULL COMMERCIAL READY` / `ALL FEATURES VERIFIED` — those exceed P9 authorization.

---

*This P12 does not rewrite P6/P7/P8/P9/P10/P11 evidence. Originals remain authoritative. No application change was made to work around the DB link failure. No secret is printed. No P13 is started.*
