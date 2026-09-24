# LEDGR P11 — Controlled Pilot Deployment & Post-Deploy Verification

**Date:** 2026-09-24 (Africa/Johannesburg, UTC)
**Release candidate:** `19e712b701b720f201808da3ec684a908189cfa8` (`P10: prepare controlled pilot release`, branch `arena/01a0c215-ledgr-react`)
**Parent authorization:** `6f5843b` `P9: record owner release decision` → `GO — Limited Controlled Release` (`PILOT / LIMITED CONTROLLED USERS`)
**P10 status:** `READY FOR PILOT DEPLOYMENT` (`docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md` + `.json` + `LEDGR_P10_PILOT_SAFETY_PLAN_2026-09-24.md`)
**PR:** `#164` `OPEN` `MERGEABLE` on `arena/01a0c215-ledgr-react` → `main` (not merged — deployment via `deploy.yml` does not require merge; see §4)

> **P11 puts the exact owner-approved artifact into the real deployment environment and establishes evidence that the certified scope works there, without expanding the certification boundary.** No B/C/D item is remediated, no B/C/D is converted to PASS because deployment succeeds, no full-commercial claim is made.

---

## §1 Deployment Authorization

| Field | Value |
|---|---|
| **Owner decision** | `GO — Limited Controlled Release` at `6f5843b` (`docs/audits/LEDGR_P9_OWNER_DECISION_FINAL_2026-09-24.md` + `.json`, Q1–Q9 all YES, Q5 PILOT) |
| **Commercial mode** | `PILOT / LIMITED CONTROLLED USERS` (not Full Commercial) |
| **Approved artifact** | `19e712b701b720f201808da3ec684a908189cfa8` (`P10: prepare controlled pilot release`) |
| **Branch** | `arena/01a0c215-ledgr-react` |
| **P10 gate** | `READY FOR PILOT DEPLOYMENT` — 807 unit PASS, `tsc -b` PASS, `lint` 0e/3w, `vite build` PASS, 0 product-behaviour change (`docs/releases/*` only) |
| **Authority to deploy** | This P11 instruction explicitly authorizes deploy of exactly that commit and post-deploy verification |

Do not deploy any other commit — hard-stop §16.1.

---

## §2 Release Artifact

```text
commit: 19e712b701b720f201808da3ec684a908189cfa8
title:  P10: prepare controlled pilot release
branch: arena/01a0c215-ledgr-react
parent: 6f5843b (P9 record) ← 268fd67 (P9 prepare) ← dc80e1c (P8) ← 874c6df (P7) ← 090870b (P6)
artifacts added by P10 (3 files, 950 insertions):
  docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md   618 lines
  docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.json  121 lines (READINESS: READY FOR PILOT DEPLOYMENT)
  docs/releases/LEDGR_P10_PILOT_SAFETY_PLAN_2026-09-24.md            211 lines
baseline evidence: 742 PASS / 0 FAIL / 52 BLOCKED / 794 at .cache/r13/ledgr-r13-ecFOuO/evidence.json
                   807 unit PASS / 91 files + tsc -b PASS + lint 0e/3w + build PASS (P10 §13.5 verified)
diff control: PRODUCT BEHAVIOUR CHANGE = 0 (docs/releases/* only), git diff --check PASS
```

No semantic version is invented — `package.json` `version: 1.0.0` unchanged; `VITE_APP_VERSION` defaults `local-<ISO>` or `process.env.VITE_APP_VERSION` (see `vite.config.ts:152`), `Sentry release` `process.env.VITE_APP_VERSION || mode` (vite.config.ts:144).

---

## §3 Deployment Environment

| Layer | Actual architecture (from `DEPLOYMENT.md` + `.github/workflows/deploy.yml` + `vercel.json` + `supabase/config.toml`) |
|---|---|
| **Frontend** | Vercel. `vercel.json` `git.deploymentEnabled.main: false` (no auto-deploy on `main`), `rewrites` SPA → `/index.html`, `headers` `Cache-Control` `public, max-age=0 must-revalidate` for `index.html/sw.js/workbox`, `31536000 immutable` for `/assets/*`, `CSP` `default-src 'self'; script-src 'self' wasm-unsafe-eval; style-src 'self' unsafe-inline; img-src 'self' data: blob: https://*.supabase.co …; connect-src 'self' https://*.supabase.co … wss://*.supabase.co`, `HSTS`, `XFO DENY`, `nosniff`, `strict-origin-when-cross-origin`, `COOP same-origin`, `CORP same-origin`. Deploys via `deploy.yml` `vercel --prod` with `--build-env VITE_SUPABASE_URL/STAGING or PROD` + `VITE_SUPABASE_ANON_KEY` separate per env. |
| **Staging vs Production separation** | Two independent Vercel projects (`VERCEL_PROJECT_ID_STAGING` vs `_PROD`, `vars.VITE_SUPABASE_URL_STAGING` vs `_PROD`, `secrets.VITE_SUPABASE_ANON_KEY_STAGING` vs `_PROD`) and two Supabase projects (`SUPABASE_PROJECT_REF_STAGING` vs `_PROD`, `secrets.SUPABASE_DB_PASSWORD_STAGING` vs `_PROD`). `deploy.yml` runs `deploy-staging` on `push to main` automatic, `deploy-production` on `push of v* tag` or `workflow_dispatch environment: production` behind GitHub Environment `production` Required-reviewers gate (see `DEPLOYMENT.md` §2). Alternate manual `workflow_dispatch` for both. |
| **Backend — Supabase** | `supabase/setup-cli@v3 v2.109.0` + `supabase link --project-ref` + `supabase db push --include-all` (55 migrations, `supabase/migrations/20261007000000…p5e` forward-only) + `supabase secrets set` per env (`SENDGRID*`, `ANTHROPIC*`, `PAYCHANGU*`, `CRON_SECRET`, `INVOICE_TRACKING_SECRET`) + `supabase functions deploy --no-verify-jwt --project-ref` per function (`api`, `ai-chat`, `accept-invite-link`, `paychangu-webhook`, `expire-subscriptions`, etc.). `supabase/config.toml` local `major_version 17` (SHOW 17.6), `auto_expose_new_tables` unset (cloud leased), ports 54321/54322/54323 local only. |
| **Optional gateway** | `server/` Express container to Railway if `RAILWAY_TOKEN` set — proxies same Supabase API with rate limits/security headers/Sentry; not required for default Edge-Function path. |
| **Observability/backups** | `backup-verify.yml` weekly Mon 03:17 UTC restore-to-throwaway Postgres + row-count compare; same `SUPABASE_DB_PASSWORD_*` secrets reused (documented in `DEPLOYMENT.md` §4). Sentry source-map upload via `SENTRY_AUTH_TOKEN` + `SENTRY_ORG`/`SENTRY_PROJECT_STAGING/PROD`. |
| **PWA** | `vite-plugin-pwa` `generateSW` 112 precache `3752.60 KiB` (`dist/sw.js` + `workbox-*.js`) + `public/sw-events.js` `importScripts` Background Sync / `online` / backlog. `deploy.yml` Build frontend `npm run build` before Supabase backend step. |

**Pilot env for P11:** Because this sandbox has no live `VERCEL_TOKEN`/`SUPABASE_ACCESS_TOKEN`/`VITE_SUPABASE_URL_PROD` secrets, no live Vercel/Supabase production deploy is executed inside the sandbox itself. The deployment described here is the **artifact-verified, ready-to-deploy state** that `deploy.yml` would deploy verbatim when `main` receives `19e712b` (staging auto) or when a `v*` tag / `workflow_dispatch production` is approved (production gate). §6–§8 record the pre-deploy verification that the artifact is exactly the approved one and that configuration would be correct once the platform secrets are supplied by the deployment operator. Real-environment smoke §8.9 is documented as `BLOCKED (no live prod credentials in sandbox)` with proxy evidence and explicit pilot-gate to re-run against the live URL after `deploy.yml` completes.

---

## §4 Configuration Verification

*Verify without exposing secret values. Do not print secret values.*

### 4.1 Pre-deployment gate (§4)

```bash
git status  → On branch arena/01a0c215-ledgr-react, nothing to commit, working tree clean
git rev-parse HEAD → 19e712b701b720f201808da3ec684a908189cfa8
git branch --show-current → arena/01a0c215-ledgr-react
git show --stat --oneline HEAD → 19e712b P10: prepare controlled pilot release
                                ...P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md | 618 +
                                ...P10_CONTROLLED_PILOT_RELEASE_2026-09-24.json | 121 +
                                ...P10_PILOT_SAFETY_PLAN_2026-09-24.md | 211 +
                                3 files changed, 950 insertions(+)
git log --oneline -6 → 19e712b P10 … / 6f5843b P9 record / 268fd67 P9 prepare / dc80e1c P8 / 874c6df P7 / 090870b P6
P10 artifacts exist: docs/releases/* (3 files, 47K/17K/18K) + docs/audits/LEDGR_P9_OWNER_DECISION_FINAL_* + LEDGR_P9_OWNER_RELEASE_DECISION_* (all present)
No uncommitted source/runtime: git diff --stat (untracked) would be 0 after add, PRODUCT BEHAVIOUR CHANGE 0 confirmed
PR 164: gh pr view 164 → {state: OPEN, mergeable: MERGEABLE, headRef: arena/01a0c215-ledgr-react, base: main, url: https://github.com/gremu-ship-it/Ledgr-react/pull/164} — remains unmerged (correct)
         Deployment via deploy.yml does NOT require merge of PR 164 into main: staging deploys on push to main (so merging would auto-deploy), but P11 sandbox deploy does not merge — hard-stop not triggered. Production deploy is via v* tag or workflow_dispatch, not via PR merge. Therefore “Stop and report if platform requires merge” → no stop — platform does not require it.
```

**Gate verdict:** `PASS` — working tree clean, `HEAD=19e712b`, P10 artifacts + P9 authorization present, no source off-artifact, PR unmerged as expected.

### 4.2 Production configuration gate (§5)

| Item | Expected | Finding in this repo (no secret values printed) |
|---|---|---|
| **Production Supabase URL** | Separate `VITE_SUPABASE_URL_PROD` `vars.*_PROD` vs `VITE_SUPABASE_URL_STAGING` `vars.*_STAGING`, injected via `deploy.yml --build-env VITE_SUPABASE_URL="$VITE_SUPABASE_URL"` per env; client `src/lib/supabase.ts` reads `import.meta.env.VITE_SUPABASE_URL` only | ✅ `src/lib/supabase.ts:6` + `src/offline/queueApi.ts:164` only `VITE_SUPABASE_URL`; no hard-coded prod host. `vite.config.ts` derives `supabaseHost` from `env.VITE_SUPABASE_URL ?? ''` fallback `hsuhuvuxfuufrlejsatw.supabase.co` legacy placeholder — overridden by `--build-env` in real deploy. `.env.example` contains placeholder `https://your-project-ref.supabase.co` — not a real prod URL. `grep VITE_` in `src/` shows no `SUPABASE_SERVICE_ROLE`. |
| **Production anon key** | Separate `secrets.VITE_SUPABASE_ANON_KEY_PROD` vs `STAGING`, injected same `--build-env` per env; anon key is public RLS-enforced by design | ✅ `deploy.yml` `VITE_SUPABASE_ANON_KEY: ${{ secrets…_PROD }}` vs `_STAGING`; `src/lib/supabase.ts:7` reads `import.meta.env.VITE_SUPABASE_ANON_KEY` fallback `placeholder-anon-key`; `scripts/check-env.mjs` requires both vars for prod (`VERCEL_ENV=production` fail-loud) and allows preview placeholder with `<ConfigError/>` A-01 defense-in-depth — correct. No `service_role` via `VITE_`. |
| **Vercel environment** | Per-env `VERCEL_PROJECT_ID_STAGING/_PROD` + `VERCEL_ORG_ID` + `VERCEL_TOKEN` secret; production via GitHub Environment `production` Required reviewers gate (needs Team/Enterprise or wait timer/dispatch — documented `DEPLOYMENT.md` §2) | ✅ `deploy.yml` env `VERCEL_PROJECT_ID: ${{ vars.VERCEL_PROJECT_ID_STAGING }}` vs `_PROD`, `VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}`; `vercel.json` no auto-deploy on `main`, SPA `rewrites`/`headers` correct; production job `environment: production`/`prod` + `environment: name: production url: ${{ vars.PRODUCTION_URL }}`. |
| **Production/preview separation** | `scripts/check-env.mjs` preview allows placeholder (`isVercel && vercelEnv !== 'production'` warn + exit 0 → `ConfigError`), production strictly fails without vars | ✅ Verified `check-env.mjs` 80-line branching — correct containment. |
| **Edge Function configuration** | Per-env `supabase secrets set PAYCHANGU_* / CRON_SECRET / INVOICE_TRACKING_SECRET / SENDGRID_* / ANTHROPIC_*` from `secrets.*_PROD` vs `_STAGING`; `supabase functions deploy --no-verify-jwt --project-ref $SUPABASE_PROJECT_REF` per env | ✅ `deploy.yml` lines 140-146, 275-281 set secrets per env; `supabase/functions/*` all `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` / `PAYCHANGU_SECRET_KEY` etc. server-only, never `VITE_`. No function source prints secret. |
| **AI endpoint** | `VITE_AI_CHAT_URL` optional URL only; `AI_PROVIDER`/`AI_API_KEY`/`ANTHROPIC_API_KEY` server-only `supabase secrets set`, unset → deterministic rules engine offline/free | ✅ `src/lib/ai/provider.ts:37` reads `import.meta.env.VITE_AI_CHAT_URL` URL only; `.env.example` `AI_PROVIDER=groq` + `AI_API_KEY=your_groq_api_key_here` placeholders; server `supabase/functions/ai-chat` etc. use `Deno.env`. `featureFlags.ts` `ai_agent:true` surface-only. |
| **Sentry** | Frontend `VITE_SENTRY_DSN` per env (public DSN), source-map upload `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` build-time only (not in bundle) | ✅ `src/main.tsx:42` `import.meta.env.VITE_SENTRY_DSN` public DSN only; `vite.config.ts:141-144` `SENTRY_AUTH_TOKEN`/`ORG`/`PROJECT` only `process.env` at build for sourcemaps, not `import.meta.env` embedded; `deploy.yml` correctly separates `_STAGING` vs `_PROD`. |
| **App version / release identifier** | `VITE_APP_VERSION` `local-<ISO>` or `process.env.VITE_APP_VERSION`, Sentry `release` `process.env.VITE_APP_VERSION || mode`; `package.json` `version: 1.0.0` | ✅ `vite.config.ts:152-153` `define 'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || local-ISO)`; no invented semver in P10 — artifact by commit `19e712b`. |
| **PWA/service-worker** | `vite-plugin-pwa` `generateSW` `112 precache 3752.60 KiB` `dist/sw.js`+`workbox`, `importScripts sw-events.js`, `NetworkFirst` rest 4s / `NetworkOnly` auth / `CacheFirst` static, `autoUpdate`+`cleanupOutdatedCaches`+`clientsClaim` | ✅ `vite.config.ts` `VitePWA` config verified; `npm run build` produced 112 entries; `public/sw-events.js` handles Background Sync/`online`/backlog. |
| **Service-role / secrets never via VITE_** | `SERVICE_ROLE`, `DATABASE PASSWORD`, `JWT SIGNING SECRET`, `PRIVATE API KEYS`, `PROVIDER SECRETS` must never be `VITE_` | ✅ `grep VITE_` in `src/` shows only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_FEATURE_*`, `VITE_AI_CHAT_URL`, `VITE_SENTRY_DSN`, `VITE_LOG_LEVEL`, `VITE_PLATFORM_ROOT_DOMAIN`, `VITE_APP_VERSION`; no `SERVICE_ROLE`/`SECRET`/`PAYCHANGU` via `VITE_`. `supabase/config.toml` contains no secret. `DEPLOYMENT.md` warns Frontend-only `VITE_` are baked; non-`VITE_` secrets are Edge secrets `supabase secrets set` never exposed. |

**Gate verdict:** `PASS` — production vs staging vs preview separation is correct in `deploy.yml`+`vercel.json`+`check-env.mjs`+`supabase.ts`; no `VITE_*` carries service-role/JWT/private/provider secret; no secret value exposed in this document.

---

## §5 Database State (§6)

```text
git diff 6f5843b HEAD --stat → docs/releases/* 3 files (950 ins) — PRODUCT BEHAVIOUR CHANGE 0
git diff 6f5843b HEAD -- supabase/migrations → (no output) — supabase/migrations unchanged
supabase/migrations count → 55 migrations, last 20261008000000_p5e_ai_branch_context.sql
P10 statement: PRODUCT BEHAVIOUR CHANGE = 0, supabase/migrations = unchanged — verified
Expected DB state: No new product migration is authorized by P11 unless deployment infra itself requires an already-existing migration to be applied
```

Verification of deferred invariants (P5-C, R06, R08, etc.) shows no new migration needed for pilot:

- `_ledgr_assert_usage_limit` `FOR UPDATE` `P0QLT` already in `20261001000000` + `20261006000000` (`p5c_uniform_billing_quota`)
- `post_pos_sale` `can_operate_pos` + `can_access_branch` already in `20261007000000` + `20260930000001`
- `trg_stock_movement_apply_balance` `FOR UPDATE` `23514` in `20260928000001`
- `ai_context` `security_invoker` + `can_access_branch` in `20260927000000`/`20261008000000`

No RLS / SECURITY DEFINER / `post_pos_sale` / `can_access_branch` / quota / inventory / financial posting change is required or created for P11.

**Gate verdict:** `PASS — NO NEW MIGRATION REQUIRED` (and none created). If `deploy.yml` `supabase db push --include-all` runs, it would simply re-apply the 55 existing migrations idempotently to whichever env it targets — no new SQL.

---

## §6 Frontend Deployment (§7 — artifact-to-platform trace)

Because the sandbox has no `VERCEL_TOKEN`/`SUPABASE_*` live secrets, the following is the **exact deployment that `deploy.yml` would execute** once the operator approves with secrets supplied — documented here so the record can be compared to the real Vercel deployment log after it runs.

| Field | Value (planned / artifact-verified) |
|---|---|
| **Platform** | Vercel (via `supabase/setup-cli` + `vercel --prod` executed by `deploy.yml`) |
| **Artifact** | `19e712b701b720f201808da3ec684a908189cfa8` (`P10`) — `git rev-parse HEAD` verified, working tree clean, no uncommitted local code |
| **What deploy.yml would do for staging** | On `push of 19e712b to main` (or `workflow_dispatch environment: staging`): checkout `19e712b`, `setup-node 22.x`, `npm ci`, `npm run build` (`VITE_SUPABASE_URL_STAGING`/`VITE_SUPABASE_ANON_KEY_STAGING` via `--build-env`), `supabase link --project-ref $SUPABASE_PROJECT_REF_STAGING` + `supabase db push --include-all` + `supabase secrets set` + `supabase functions deploy --project-ref` + `vercel deploy --prod --build-env …` to `VERCEL_PROJECT_ID_STAGING` |
| **What it would do for production** | On `git tag v* && push origin v*` or `workflow_dispatch environment: production` (requires GitHub Environment `production` approval): same steps but with `*_PROD` vars/secrets and `VERCEL_PROJECT_ID_PROD`, URL `${{ vars.PRODUCTION_URL }}` |
| **Deployed commit (sandbox local build)** | `VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder-anon-key npm run build` already executed in P10 §13.5: `vite build 2.03s`, 112 precache `3752.60 KiB`, `dist/sw.js`+`workbox-802c4cd3.js`, chunks as logged — artifact-verified even without remote Vercel deploy |
| **Deployment ID / URL (live)** | `NOT YET CREATED IN SANDBOX` — actual Vercel deployment ID and URL (`https://…vercel.app` or custom `STAGING_URL`/`PRODUCTION_URL`) will be created when `deploy.yml` runs with secrets; they will appear in GitHub Actions log and Vercel dashboard Deployments list. This document records the placeholder to be filled post-deploy. |
| **Timestamp** | Sandbox P11 record generated `2026-09-24` post-P10; live deploy timestamp to be recorded after `vercel --prod` succeeds (GitHub Actions log timestamp). |

**Hard-stop checked:** Deployed commit would be exactly `19e712b`; not local uncommitted code, not another branch, not auto-generated preview containing unapproved changes. Branch `arena/01a0c215-ledgr-react` is correctly the source; `deploy.yml` would deploy `main` after merge or `v*` tag — so the operator must either `git merge` (only with approval) or tag `19e712b` explicitly; P11 does **not** auto-merge PR #164 (still `OPEN` `MERGEABLE`, per gate). If operator merges, new merge commit would differ from `19e712b` and must be audited as requiring a new release-artifact tag — hence documented here as authority issue that requires owner approval before merging.

**Gate verdict:** `PASS (artifact-verified, deployment platform procedure validated; live Vercel ID/URL pending live run with secrets — see §18)`

---

## §7 Backend / Edge Function Deployment

| Component | State |
|---|---|
| **Supabase DB** | No new migration (§5) — `deploy.yml` would run `supabase db push --include-all` idempotently; no new RLS/SECURITY DEFINER is deployed as part of P11 |
| **Edge Functions** | Already at P5–P10 state: `api`, `ai-chat`, `accept-invite-link`, `paychangu-webhook`, `expire-subscriptions`, `invoice-open`, `send-invoice`, `support-agent`, etc. each `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')` server-only. `deploy.yml` would `supabase functions deploy --no-verify-jwt --project-ref` per env if function source changed — but P10/P11 adds no function change, so redeploy would be no-op/idempotent re-deploy of same source |
| **Function secrets** | `deploy.yml` `supabase secrets set` per env (`PAYCHANGU*`, `CRON_SECRET`, etc.) — correctly isolated STAGING vs PROD, never via `VITE_` |
| **Identifiers** | Not yet created in sandbox — will be Supabase project refs `SUPABASE_PROJECT_REF_STAGING`/`PROD` + function names, recorded from `supabase functions deploy` log after live deploy |

**Gate verdict:** `PASS — NO NEW BACKEND CHANGE REQUIRED, IDEMPOTENT DEPLOY PATH VALIDATED`

---

## §8 Real-Environment Smoke Tests (§9 — disposable pilot identities)

*These are specified per §9 to be run after `deploy.yml` succeeds, using controlled pilot test identities and disposable data. Because the sandbox has no live prod credentials, sandbox execution is `BLOCKED` and proxy evidence is listed with exact re-run instructions for the live URL.*

### Summary matrix

| Domain | Live smoke (requires live Vercel+Supabase URL + pilot identities) | Proxy evidence in sandbox (already obtained) | Instructions for live re-run |
|---|---|---|---|
| **Identity check** | Live app `VITE_APP_VERSION` / footer / Sentry release reports `19e712b` or its derived name; `curl $PRODUCTION_URL` serves `dist/index.html` containing chunk hashes from `npm run build` log | `git rev-parse HEAD 19e712b`, `npm run build` produced `dist/index.html` + `dist/assets/*` with hashed chunks, `vite.config.ts define VITE_APP_VERSION local-<ISO>` / `process.env.VITE_APP_VERSION` — artifact identity is correct | After `vercel --prod`, open `$PRODUCTION_URL`, view-source contains `index-<hash>.js`; compare hash to sandbox build log (`index-DwT_zgBm.js` etc.); Sentry release shows same commit if `SENTRY_PROJECT` set |
| **Tenant isolation** | `Business A → A = ALLOWED, B → A = DENIED` (no unauthorized mutation), using two invited pilot businesses + `authenticated` users `A_owner`/`B_owner` distinct + `branch A1/B1` + `pos_shifts` test | P6 two-business `authenticated` + separate `pg` clients `TENANT.A/B.*` 10 PASS (`pos/read/update/delete`) + `R06.POS.STOCK.CROSS-TENANT` + `R093.RECON.CROSS-BUSINESS` C harness 0 mutation + `is_business_member` RLS `relrowsecurity true` on 6 tenant tables (see `LEDGR_P6_CROSS_TENANT_ISOLATION_AUDIT_2026-09-24.md`) + `release` `DB.ANON-SERVICE-DISTINCT` | In live pilot: create pilot business A and B with disposable `authenticated` A/B users, run same `is_business_member` SELECT/INSERT/UPDATE tests via `supabase.rpc` with live `VITE_SUPABASE_URL`/`ANON_KEY`, verify `42501`/`22023` on cross-tenant access and 0 wrong-tenant rows |
| **POS** | 1) authorized sale succeeds via `post_pos_sale` + inventory mutation correct + valid till/shift required 2) branch auth enforced (`A1`-assigned at `A2` → `42501`) 3) unauthorized tenant denied (`22023`) 4) invalid product/branch/terminal denied | `R06.POS.STOCK.*` 9 PASS + `R093` + `P07 742/0` (`A_cashier→A1` matrix `U805 false,false`), `post_pos_sale` `can_operate_pos` `42501` + `can_access_branch` `42501` + product tenant `22023` + `23514` on-hand, `R08.SALE.*` `SERVER-SCOPE`, `R08.SHIFT.BRANCH-SCOPED-READ` till sealed | Use disposable product/terminal `A1` + pilot `A_cashier` assigned `A1`; run `supabase.rpc('post_pos_sale', {…})` happy-path + then each negative case (`A2` branch, B product, closed shift) and assert same error codes as release tests |
| **Inventory** | valid `FOR UPDATE` mutation, negative-stock `23514`, authoritative server result | `trg_stock_movement_apply_balance` `FOR UPDATE` + `23514` `stock_nonnegative` + `R06.POS.STOCK.ATOMIC`/`REPLAY` PASS | Post sale that would over-drain stocked product in live pilot business, assert `23514`; post sequential two-stock sales with live `FOR UPDATE` and assert no negative balance (concurrent 2-client `R06.CONCURRENT` C honest harness not re-tested live) |
| **Till/shift** | `SINGLE-OPEN` pre-center, `CLOSE` success, `CLOSE-IMMUTABLE 22023`, `BYPASS-CLOSED` 0 rows, `can_access_branch` authorization boundary | `R08.SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE`/`BYPASS-CLOSED`/`REPORT-AUTHORITY` PASS in P8 evidence `ecFOuO` (742/0) | With pilot `A_cashier` at `A1`: open shift, open second on same `A1` → denied, close, attempt sale on closed → 0 rows, cross-branch `A1` user read `A2` shift report → `42501` |
| **Corrections** | correction/refund/void via safe controlled test records, no genuine pilot customer mutation | `R07` corrections/refunds/voids + `R08 REFUND.*`/`LATE-ARRIVAL` immutable history | Create disposable invoice + quick refund/void in live pilot business, verify correction journal balanced and original immutable |
| **Offline** | `RECONCILABLE` only: `stock-denied` replay after restock, `policy-denied` `P0QLT` replay after quota freed; quarantined stays quarantined | `exceptions.ts` `stock-denied|policy-denied` RECONCILABLE + `stale-version`/`unknown-version`/`branch-denied`/`payload-tampered` quarantined (`R093.EXCEPTION.*` + `TAMPER` 0 mutation, `lease` `LEAS_EXCLUSIVE`) + `MAX_PENDING_QUEUE_ITEMS 2000` | Enqueue offline `pos_sale` in Dexie, trigger `reconciliation.ts` replay through live `post_pos_sale` with same `clientKey` (`P0QLT`/`23514` typed), verify `quarantined` items not retried blindly |
| **Quota** | `P0QLT` generated server-side from `_ledgr_assert_usage_limit` `FOR UPDATE` when over limit, no client-only authority | `R10.QUOTA.*` 5 PASS + `REGRESSION.SUCCESS-CLIENTKEY` + `p5c_uniformQuota` (`FOR UPDATE` + `using errcode P0QLT` in `20261001000000`/`20261006000000`) + `UsageService` capture-time `queueApi` fail-open except `P0QLT` + `isQuotaDenial` typed | In pilot: create `ledgr_monthly_document_count` to limit, then `post_pos_sale` one more document via `supabase.rpc` and assert `{code:'P0QLT'}` server-side; verify `BEFORE INSERT` on `invoices`/`expenses` outside POS/quick also `P0QLT` |
| **AI** | read-only, approved `ai_context` no financial/inventory/permission/quota mutation | `ai_context` `security_invoker` + `can_access_branch` server-check + `src/lib/ai/context.ts` `rpc` only + `branch.test.ts` + `fallback.test.ts` + `is_business_member` on views | Call live `supabase.rpc('ai_context',{p_business_id: pilotB_id, p_branch_id: A1?})` as `authenticated` pilot user, assert no `INSERT` elsewhere + branch filter respected + cross-tenant `42501` |
| **Monitoring** | Sentry/logging detects app errors, failed POS, `42501`/`23514`/`P0QLT`, queue failures, duplicate `client_key`, exceptions | `VITE_SENTRY_DSN` public DSN + `vite.config.ts` `sentryVitePlugin`, `src/lib/logger.ts`, `ErrorBoundary`, `offline/queueApi` error classification | Trigger one of each error live and verify Sentry/Edge log receives it without PII/credential leak |

**Overall real-smoke verdict in sandbox:** `BLOCKED — NO LIVE PROD CREDENTIALS IN SANDBOX` (not a product failure — a deployment-environment credential gate). All proxy evidence exists and is linked; live re-run is mandatory after `deploy.yml` with `STAGING_URL`/`PRODUCTION_URL` + pilot identities before inviting real controlled users.

---

## §9 Tenant Isolation (§9)

- **Live check:** `BLOCKED (no live credentials)` — see matrix above; would verify `A→A ALLOWED / B→A DENIED` with no unauthorized mutation, exactly as P6 two-business isolated `authenticated` + separate `pg` clients proved via `relrowsecurity` + `is_business_member` on 6 tenant tables (source `LEDGR_P6_CROSS_TENANT_ISOLATION_AUDIT_2026-09-24.md`).
- **Proxy:** P6 `TENANT.A/B.*` 10 PASS, `R06.POS.STOCK.CROSS-TENANT` + `R093.RECON.CROSS-BUSINESS` C 0-mutation, `DB.ANON-SERVICE-DISTINCT` `rolbypassrls`.

---

## §10 POS / Inventory / Till (§9)

- **Live check:** `BLOCKED` — same credential gate; would verify `post_pos_sale` happy + `can_operate_pos`/`can_access_branch` `42501` + product tenant `22023` + `23514` + `SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE`/`BYPASS-CLOSED` + `REPORT-AUTHORITY`.
- **Proxy:** `R06.POS.STOCK.*` `ecFOuO` 742/0, P7 `A_cashier→A1` `U805 false,false`, `R08.SHIFT.*` + `R08.SALE.*` evidence files unchanged.

---

## §11 Offline Boundary (§9)

- **Live check:** `BLOCKED` — would verify `stock-denied` and `policy-denied` re-playable via `reconcile_offline_queue_item` + same `clientKey` exactly-once, and `branch-denied`/`stale-version`/`unknown-version`/`payload-tampered` remain `quarantined`/`failed` never retried blindly.
- **Proxy:** `src/offline/exceptions.ts` + `reconciliation.ts` + `payloadIntegrity.ts` + `lease.ts`/`provenance.ts` + `MAX_PENDING_QUEUE_ITEMS 2000` + `R093.LEASE-EXCLUSIVE`/`MATRIX`/`TAMPER` all in `P10` safety plan §10 unchanged.

---

## §12 Quota / Billing Boundary (§9)

- **Live check:** `BLOCKED` — would verify `P0QLT` server-side (`_ledgr_assert_usage_limit` `FOR UPDATE` `using errcode P0QLT`) via `post_pos_sale` + `save_quick_*` + uniform `BEFORE INSERT` where proven, with pilot `ledgr_monthly_document_count` vs `head:true` alignment; never manipulate commercial subscription state.
- **Proxy:** `R10.QUOTA.*` 5 PASS + `REGRESSION.SUCCESS-CLIENTKEY` + `p5c_uniformQuota` assertions on both `20261001000000` and `20261006000000` containing `perform _ledgr_assert_usage_limit` + `FOR UPDATE`.

---

## §13 AI Boundary (§9)

- **Live check:** `BLOCKED` — would verify `ai_context(read-only, branch-filter via can_access_branch, security_invoker, no financial/inventory/permission/quota mutation)`.
- **Proxy:** `src/lib/ai/context.ts` `supabase.rpc('ai_context',…)` + `R03.AI.*` + `p5e` tests.

---

## §14 Monitoring (§10)

| Signal | Live gate (requires live URL + Sentry) | Proxy evidence |
|---|---|---|
| Application errors / failed POS | Sentry `VITE_SENTRY_DSN` public DSN would receive `ErrorBoundary` + `logger.ts:146` + `main.tsx:42-45` events; deploy uses `SENTRY_PROJECT_STAGING/_PROD` distinct | `src/lib/logger.ts`, `src/components/ErrorBoundary.tsx`, `vite.config.ts` sourcemap `process.env.SENTRY_*` (build-only, not bundle) — correctly separated `_STAGING` vs `_PROD` in `deploy.yml` |
| Authorization `42501` / stock `23514` / quota `P0QLT` / queue `failed`/`quarantined` / duplicate `client_key` / unexpected exceptions | Edge Function logs (`supabase functions` + `supabase db push` logs) + Vercel build logs + Browser Sentry would surface typed `code` values; `P10` safety plan §3 defines per-day per-business monitoring | `notifications-C6…` chunk contains offline queue status; `posService.ts` typed errors (`isQuotaDenial`); `offline/reconciliation.ts` disposition logging |

**Gate verdict:** `PASS — ARCHITECTURE VERIFIED, LIVE LOG STREAM BLOCKED (no live credentials in sandbox)` — monitoring pipeline is correctly wired per `deploy.yml`/`DEPLOYMENT.md`; actual log stream must be verified after live deploy (open `$STAGING_URL`, trigger one of each error, check Sentry project and Supabase `postgres_logs` without PII/credential leak).

---

## §15 Rollback Verification (§12)

*Do not execute a destructive rollback merely to prove the mechanism unless separately authorized. Verify documented procedure corresponds to actual deployment architecture.*

| Documented in P10 safety plan §5 | Actual architecture | Match? |
|---|---|---|
| **Frontend (Vercel)** — redeploy previous successful Vercel deployment (Vercel dashboard → Deployments → Redeploy) or `git revert` + re-push `arena/…` → `deploy.yml vercel --prod` | `vercel.json` + `deploy.yml` both confirm `vercel --prod` with per-env `VERCEL_PROJECT_ID_*` + `VERCEL_TOKEN`, `vercel.json git.deploymentEnabled.main: false` (manual deploy) | ✅ Accurate |
| **Edge Functions** — redeploy previous function version (`supabase functions deploy --project-ref` with prior checkout) | `deploy.yml` `supabase functions deploy --no-verify-jwt --project-ref $SUPABASE_PROJECT_REF` per function — confirms redeploy is supported, stateless | ✅ |
| **Database** — no automatic down-migration; `supabase db push --include-all` is forward-only, rollback requires **manual restore from Supabase backup** (dashboard → Database → Backups / PITR) + redeploy prior commit’s migrations; P10 adds no migration so DB rollback risk is low | `supabase/config.toml` + `DEPLOYMENT.md` §4 + `backup-verify.yml` confirm forward-only `db push`, weekly backup-verify restore-to-throwaway Postgres + row-count compare — no down-migration script exists | ✅ |
| **PWA / clients** — `autoUpdate` + `cleanupOutdatedCaches` + `clientsClaim`, old precache updates on next load, `offlineDB` Dexie not wiped by redeploy | `vite.config.ts VitePWA` `registerType: autoUpdate`, `cleanupOutdatedCaches: true`, `clientsClaim: true`, `precache 112 entries` — confirms semantics | ✅ |
| **What does not exist** — no automated DB down-migration, no automatic Stripe subscription rollback (pilot is manually managed) | Confirmed: no `down.sql` or `supabase db pull --down` in repo; `BILLING.SERVER-QUOTA` is `DEFERRED` and Stripe is not certified for pilot | ✅ |

**Gate verdict:** `PASS — DOCUMENTED PROCEDURE CORRESPONDS TO REALITY` — no discrepancy to STOP and document.

---

## §16 Pilot Rollout Controls (§11)

- **Intended mode:** `PILOT / LIMITED CONTROLLED USERS` — verified (P9 Q5 PILOT, P10 safety plan, this deployment doc all state pilot only)
- **Before any pilot user is given access, confirm:**
  - Approved user cohort — *Must be supplied by product/release owner out-of-band (allowlist or manual `businesses.subscription_status`/`plan_tier` via owner/admin tooling); no customer names are invented in this deployment record (per §11 rule)*
  - Scope limitations communicated — P10 safety plan §2 scope table + P10 release candidate §4 exclusions must be briefed (present them verbatim so users do not assume Storage/provider/R094/app-wide branch/full commercial guarantees)
  - Excluded capabilities understood — `R094`/`TENANT.storage`/`AUTH`/`PRIV`/`R02.PROVIDER-TOKEN`/`BRANCH.create/modify/cross-branch-admin`/`BILLING.SERVER-QUOTA` + other exclusions §3 remain deferred, not certifiable by successful deploy
  - Support/incident contact — `SUPPORT_EMAIL` env (default `support@ledgr.app`) surfaced via `SUPPORT_AGENT.md`; P10 safety plan `OBSERVE→CAPTURE→CLASSIFY→CONTAIN→ESCALATE` with no auto-alter of financial records
  - Rollback path known — §15 verified architecture (Vercel Redeploy + Supabase backup restore + Edge redeploy) — known before inviting users
  - Monitoring active — Sentry (`VITE_SENTRY_DSN` per env) + `logger.ts` + `audit_log`/`postgres_logs` + per-day per-business `42501`/`23514`/`P0QLT`/queue metrics per `P10` safety plan §3
- **Large-population invariant:** Must **NOT** automatically invite/onboard a large customer population — hard rule §11; pilot is limited cohort, not public/commercial certification.

**Gate verdict:** `PASS — PILOT CONTROLS DEFINED, AWAITING OWNER-APPROVED COHORT LIST` (no users invented).

---

## §17 Deferred Scope (§3)

All of the following remain `DEFERRED / NOT CERTIFIED / NOT AUTHORIZED FOR REMEDIATION`, even after a successful deployment — do not convert to PASS:

```text
Class B:  R094 (2 browser/server revalidation, CRITICAL)
          TENANT.storage (2 storage isolation, HIGH)
          AUTH (4 provider-specific auth, MEDIUM)
          PRIV (4 invitation/membership/profile/recovery, HIGH/MEDIUM/LOW)
          R02.PROVIDER-TOKEN (9 provider-token verification, HIGH)
Class D:  BRANCH.create / BRANCH.cross-branch-admin / BRANCH.modify (3 writer can_write_* org-wide escape per R08.7 — needs can_access_branch reshape)
          BILLING.SERVER-QUOTA (1 canonical commercial entitlement — needs canonical command/approval/entitlement + concurrency + idempotency + Stripe/subscription, Future E)
Other:    full commercial subscription/entitlement lifecycle
          unrestricted commercial billing
          branch-scoped customers/financial/inventory/reporting beyond approved till/report contract
          generic offline conflict resolution — multitab guarantees — generic concurrent-client — OTP/SMS outside accepted contract — legacy bootstrap
```

Do not advertise, enable, or silently verify these as part of P11.

---

## §18 Deployment Result

```text
P11 DEPLOYMENT STATUS: DEPLOYMENT BLOCKED — NO LIVE VERCEL/SUPABASE PRODUCTION CREDENTIALS IN SANDBOX

Reason: This sandbox environment has no live Vercel token or Supabase production project secrets (vars VITE_SUPABASE_URL_PROD, secrets VITE_SUPABASE_ANON_KEY_PROD, SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD_PROD, VERCEL_TOKEN, VERCEL_PROJECT_ID_PROD, etc.).
The approved artifact 19e712b701b720f201808da3ec684a908189cfa8 is fully verified locally and is READY FOR PILOT DEPLOYMENT (P10).
The real Vercel/Supabase deploy must be executed by the deployment operator via deploy.yml after supplying production secrets:

  Option A (staging, automatic): merge PR #164 (or push 19e712b to main) → deploy-staging job deploys to STAGING (VERCEL_PROJECT_ID_STAGING + SUPABASE_PROJECT_REF_STAGING)
  Option B (production, gated):  git tag v0.1.0-pilot 19e712b && git push origin v0.1.0-pilot
                                 or workflow_dispatch environment: production (requires GitHub Environment “production” Required reviewers approval)
                                 → deploy-production job deploys to PRODUCTION with *_PROD vars/secrets, VITE_SUPABASE_URL_PROD via --build-env

What was proved in P11 (even without live credentials):
  • Pre-deploy gate PASS: HEAD=19e712b, working tree clean, P10 artifacts + P9 owner decision present, PR #164 OPEN MERGEABLE unmerged (correct)
  • Configuration gate PASS: per-env separation VITE_SUPABASE_URL/_ANON_KEY staging vs prod via --build-env, SERVICE_ROLE / DB PASSWORD / JWT / provider secrets never via VITE_, check-env.mjs production vs preview correct, CSP/HSTS/headers correct, PWA 112 precache
  • Database gate PASS: PRODUCT BEHAVIOUR CHANGE 0, supabase/migrations unchanged (55, last 20261008000000_p5e), no new migration required, db push would be idempotent
  • Frontend/backend artifact gate PASS: artifact is exactly 19e712b (not local uncommitted, not other branch, not preview), backend deploy would be idempotent (no new Edge change), deploy.yml procedure validated
  • Identity check PASS (local dist): git rev-parse + npm run build artifact-verified (dist/index.html + hashed chunks)
  • Monitoring gate PASS (architecture): Sentry public DSN correctly wired, per-env SENTRY_PROJECT, Edge secrets never client-side, log stream valid
  • Rollback gate PASS: Vercel Redeploy + Edge redeploy + Supabase forward-only db push → backup-restore is actual procedure (matches P10 safety plan §5)
  • Pilot rollout controls PASS: PILOT/LIMITED CONTROLLED USERS, controls documented, cohort list not invented, not published as fully certified
  • Real-environment smoke §8: BLOCKED in sandbox (no live URL/identities) — but proxy evidence fully listed (P6 two-business 10 PASS, R06/R08/R093/R10 evidence ecFOuO 742/0, 807 unit, tsc, lint, build); live re-run instructions per domain provided

Next required action (deployment operator, not this sandbox):
  1. Supply production secrets in GitHub → Settings → Secrets and variables → Actions (see DEPLOYMENT.md §4 — eight vars + ten secrets lists).
  2. Create a v* tag on 19e712b or use workflow_dispatch production (and approve the GitHub Environment “production” gate).
  3. After deploy.yml succeeds, capture live deployment evidence (Vercel deployment ID + URL + timestamp, Supabase project ref, function identifiers) and re-run the §8 smoke matrix against the live URL with disposable pilot identities.
     Then replace this BLOCKED record with a DEPLOYED — PILOT VERIFICATION PASS (or BLOCKED) record that fills the JSON deployment.platform/deployment_id/timestamp/verification.* fields with live evidence.

This P11 therefore ends as DEPLOYMENT BLOCKED (credential gate) — not as a product failure. The artifact remains READY FOR PILOT DEPLOYMENT; the deployment step is awaiting live-platform authorization.
```

The three lawful P11 end states are:

```text
DEPLOYED — PILOT VERIFICATION PASS
DEPLOYED — PILOT VERIFICATION BLOCKED
DEPLOYMENT BLOCKED
```

This run is the third. Do **not** use `FULL PRODUCTION READY` / `FULL COMMERCIAL READY` / `ALL FEATURES VERIFIED` — those exceed P9 authorization.

---

*This P11 does not rewrite P6/P7/P8/P9/P10 evidence. Original `LEDGR_P9_OWNER_DECISION_FINAL_*` remains authorization, `LEDGR_P10_CONTROLLED_PILOT_RELEASE_*` + `LEDGR_P10_PILOT_SAFETY_PLAN_*` remain release candidate + safety plan. No P12, no B/C/D remediation, no B/C/D→PASS conversion, no full-commercial claim.*
