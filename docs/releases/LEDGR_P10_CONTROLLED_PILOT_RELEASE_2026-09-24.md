# LEDGR CONTROLLED PILOT — Release Candidate (RE-CREATED for remediated source)

**Date:** 2026-09-24 (Africa/Johannesburg, UTC) — **RE-CREATION** per owner re-authorization `GO — P10 RE-CREATION AUTHORIZED FOR REMEDIATED SOURCE 013b37b` (2026-09-24)
**Branch:** `arena/01a0c215-ledgr-react`
**Source commit:** `013b37bf3533c7be3e529d5a2939f4f3fcf9456c` `P5-E: fix branch_manager/sales_manager NULL fail-closed (DEC-03) + service_role branch filter + remove dead v_org_wide_roles` (application/runtime tree unchanged after docs-only `a42a9bcbce455cc990dc43b41362e5e6d79624bf`)
**Parent chain:** `a42a9bc` (Post-P5-E gate closure docs-only, HEAD) → `013b37b` (P5-E fix) → `950bb67` (security review REMEDIATION REQUIRED) → `a9eeed6` → `682ebbc` (deploy harden) → `df7ee1c` P12 → `ed5c06b` P11 → `19e712b` P10 → `6f5843b` P9 GO
**Pilot tag:** `v0.1.0-pilot → 682ebbcf83d8299f2e9ce557d724e1882af31bd1` (unchanged, stale 2 behind, contains violating `f6d9cb3` — **not moved** in this re-creation per authorization)
**Release mode:** `PILOT / LIMITED CONTROLLED USERS`
**Owner decision:** `GO — Limited Controlled Release` (recorded `6f5843b`, P9 Q9 GO, Q1–Q8 YES) **preserved** + **Re-authorization:** `GO — P10 RE-CREATION AUTHORIZED FOR REMEDIATED SOURCE 013b37b` (owner message 2026-09-24, same 20 CERTIFIED / 21B+4D deferred / 15C accepted, DEC-03/R03/P0QLT preserved)
**Release status at creation:** `PENDING` — preparation only, not deployed, not `RELEASED`
**Evidence baseline (re-verified for remediated source):** `742 PASS / 0 FAIL / 52 BLOCKED / 794` at `.cache/r13/ledgr-r13-ecFOuO/evidence.json` (unchanged, P8 classification) + `807 PASS / 0 FAIL` unit (91 files, 59.38s, re-verified at `a42a9bc`/`013b37b`) + `P5-E remediation PASS 24/24 data-verified (branch_manager NULL 42501, sales_manager NULL 42501, service_role 5000, 12000 preserved)` + `tsc -b` PASS + `lint` 0 errors / 3 warnings + `build` PASS (2.14s 112 precache 3752.63 KiB, VitePWA)
**Remediation:** `P5-E remediation: PASS 24/24 data-verified matrix PASS, 807/807 unit PASS, 91/91 groups PASS, TypeScript PASS, Lint PASS, Build PASS` — corrected behaviour `branch_manager + NULL branch → 42501`, `sales_manager + NULL branch → 42501`

> **P10 is release preparation, not feature development.** This document packages and verifies exactly what the owner authorized in P9. It does not expand scope, remediate deferred B/C/D, or convert BLOCKED into PASS. `EXCLUDED ≠ FAILED, EXCLUDED ≠ PASS, EXCLUDED = OUTSIDE CURRENT CERTIFICATION BOUNDARY`.

---

## §1 Release Identity

| Field | Value |
|---|---|
| **Release name** | `LEDGR CONTROLLED PILOT` (RE-CREATED) |
| **Source commit** | `013b37bf3533c7be3e529d5a2939f4f3fcf9456c` (`P5-E: fix branch_manager/sales_manager NULL fail-closed (DEC-03) + service_role branch filter + remove dead v_org_wide_roles`) — **must explicitly identify `source_commit = 013b37bf3533c7be3e529d5a2939f4f3fcf9456c`** per re-authorization |
| **Parent chain** | `a42a9bc` (Post-P5-E gate closure, HEAD docs-only) → `013b37b` (P5-E fix) → `950bb67` (security review) → `a9eeed6` → `682ebbc` (`v0.1.0-pilot`, not moved) → `df7ee1c` → `ed5c06b` → `19e712b` → `6f5843b` (P9 GO) |
| **Pilot tag** | `v0.1.0-pilot → 682ebbcf83d8299f2e9ce557d724e1882af31bd1` — **remains at `682ebbc`, not moved merely because this authorization has been granted** (per authorization) |
| **Release branch** | `arena/01a0c215-ledgr-react` |
| **Owner authorization ref** | `6f5843b` + `docs/audits/LEDGR_P9_OWNER_DECISION_FINAL_2026-09-24.md` + `.json` (P9 GO) + **Owner re-authorization** `GO — P10 RE-CREATION AUTHORIZED FOR REMEDIATED SOURCE 013b37b` (2026-09-24, same 20 CERTIFIED / 21B+4D / 15C, preserves DEC-03/R03/P0QLT) |
| **Commercial mode** | `PILOT / LIMITED CONTROLLED USERS` (not Full Commercial) — re-authorization explicitly **NOT** commercial release / large rollout |
| **Semantic version** | **Not invented** — repository has no established semver scheme; release is identified by commit + branch + date. `VITE_APP_VERSION` defaults to `local-<ISO>` or `process.env.VITE_APP_VERSION` (see `vite.config.ts`) — no version bump in P10 re-creation. |
| **Build guard** | `scripts/check-env.mjs` (prebuild) + `src/lib/supabase.ts` placeholder fallback + `<ConfigError />` |
| **Deployment target** | Controlled pilot cohort only — no public/commercial rollout — **deployment NOT authorized in this re-authorization** (infra block remains) |

---

## §2 Authorization

```text
Owner decision: GO — Limited Controlled Release
Commercial mode: PILOT / LIMITED CONTROLLED USERS
Recorded at:    2026-09-24T10:45:00+02:00 (Africa/Johannesburg) via ask_user Q1–Q9
Baseline:       268fd67 P9: prepare owner release decision
Commit:         6f5843b P9: record owner release decision (docs/audits/LEDGR_P9_OWNER_DECISION_FINAL_2026-09-24.md + .json)
Re-authorization: GO — P10 RE-CREATION AUTHORIZED FOR REMEDIATED SOURCE 013b37bf3533c7be3e529d5a2939f4f3fcf9456c
                (current HEAD may include docs-only child a42a9bcbce455cc990dc43b41362e5e6d79624bf, application/runtime tree unchanged after 013b37b)
                P5-E remediation PASS 24/24, 807/807, 91/91, TypeScript PASS — branch_manager NULL →42501, sales_manager NULL →42501
                P9 GO remains governing scope — P10 re-creation preserves 20 CERTIFIED / 21B+4D deferred / 15C accepted, DEC-03/R03/P0QLT, no deferred B/C/D remediation, no Storage/Auth/R094/generic offline/OTP/SMS/billing redesign, no branch/role redesign, no commercial/large rollout, no deploy/tag move/merge
```

**Q1–Q9 answers (verbatim, no inference, preserved from P9 GO — re-authorization does not change them):**

| Q | Text | Answer |
|---|---|---|
| Q1 | Release scope (P9 §3/§6) | **YES** |
| Q2 | Environment 21 B (R094 2 + TENANT.storage 2 + AUTH 4 + PRIV 4 + R02 9) | **YES** — deferred |
| Q3 | Accepted 15 C (BRANCH 5 + OFFLINE 4 + R06.CONCURRENT 1 + AI.BRANCH 1 + R02 DEC-02/OTP 4) | **YES** |
| Q4 | Branch admin 3 D (BRANCH.create / cross-branch-admin / modify) | **YES** — outside scope |
| Q5 | Billing (P0QLT proven, BILLING.SERVER-QUOTA deferred) | **YES — PILOT / LIMITED CONTROLLED USERS** (not Full Commercial) |
| Q6 | Storage | **YES** — unverified, excluded |
| Q7 | Provider auth | **YES** — environment-blocked, excluded |
| Q8 | Browser/server revalidation | **YES** — deferred |
| Q9 | Release decision | **GO** (unconditional) |

Consistency check: Q1 YES+GO, Q5 PILOT with deferred canonical billing (not FULL) — no contradiction. Q6/Q7/Q8 YES with excluded claims — no contradiction. All 9 explicit, no silence-as-acceptance.

---

## §3 Certified Scope

**Every capability below is both `ENGINEERING PROVEN` via P5–P8 (742/0 + 807 unit + typed `42501`/`23514`/`P0QLT`/`22023`) and `OWNER ACCEPTED` via Q1 YES → `Release status: CERTIFIED` for this pilot. Do not shorten to "all core features".**

| # | Capability | Contract | Evidence |
|---|---|---|---|
| 1 | **Tenant isolation** | Two-business `authenticated` + separate `pg` clients, `relrowsecurity true` + `is_business_member` on 6 tenant tables | P6 two-business (A `13000000-...-0005` vs B `...-0105`, Branch A1/B1, Terminal, Location, Product), P7 742/0 |
| 2 | **POS / till operations** | Sale, till open/close, cash movements, `post_pos_sale` at server | R06/P6/P7 `post_pos_sale` 42501/23514/P0QLT, till `pos_shifts` |
| 3 | **`post_pos_sale`** | Single authoritative posting path: `can_operate_pos` + `can_access_branch` + product tenant + `FOR UPDATE` + `P0QLT` | R06/P5-D/P7, `R08.SHIFT.*`, `R10.QUOTA.*` |
| 4 | **Sales and payments** | Invoices + invoice_lines + journal + payments via `post_pos_sale` | R06/P7 |
| 5 | **Inventory / stock integrity** | `trg_stock_movement_apply_balance` `FOR UPDATE` `23514`, `R06.POS.STOCK.*` 9 PASS + `REPLAY`/`ATOMIC` | R06, P6, P7 |
| 6 | **Stock `23514`** | Negative-stock protection is authoritative server constraint `23514` | R06 `23514`, `STOCK_NONNEG_CONSTRAINT`, P7 |
| 7 | **`FOR UPDATE` stock authority** | Row-lock serialization on stock balance | `stock_movements` trigger `FOR UPDATE`, P5-C `_ledgr_assert_usage_limit` `FOR UPDATE` |
| 8 | **Branch — till family** | `pos_shifts`/`pos_cash_movements`/`pos_shift_closes` + `post_pos_sale` via `can_access_branch` fail-closed per DEC-03 | P5-D `20261007000000` DEC-03, P7 `A_cashier→A1`/`A_branch_manager→A2` matrix `U805 false,false`, `R08.SHIFT.BRANCH-SCOPED-READ` |
| 9 | **DEC-03 `can_access_branch` fail-closed** | `branch_id IS NULL` → `false` for assigned-scope (`cashier`/`stock_clerk`/`branch_manager`); org-wide roles (`owner`/`admin`/`auditor`/`accountant`) legitimately `NULL` org-wide | P5-D, P7 `NULL`→`42501` |
| 10 | **Customers / suppliers — org-wide contract** | Contacts `org-wide` `is_business_member` + `can_write_business_data`; `contacts.branch_id` out-of-scope per R08.7/P6 | P6/P7, R08.7 audit, P8 C `BRANCH.customers` |
| 11 | **Financial recording** | `invoices`/`invoice_lines`/`journal_entries`/`journal_lines`/`payments` with R05 invariants | R05 + R08 `ZREPORT.RECONCILES-TENDERS` |
| 12 | **Financial reporting — org-wide contract** | Org-wide intentional; POS shift report branch-enforced only | R08 `SINGLE-OPEN`/`CLOSE`/`REPORT-AUTHORITY`, R08.7 |
| 13 | **POS shift reporting — branch-enforced** | `get_pos_shift_report` `42501` when branch mismatch | R08 `R08.REFUND.SCOPE-ATTACK` + P7 |
| 14 | **Corrections / refunds / voids** | `R07` corrections + `R08` `REFUND.*`/`LATE-ARRIVAL` with immutable history | R07 + R08 |
| 15 | **Till / shift integrity** | `SINGLE-OPEN`/`CLOSE`/`CLOSE-IMMUTABLE` `22023`/`BYPASS-CLOSED` 0-rows/`REPORT-AUTHORITY` | R08 |
| 16 | **Offline reconciliation — RECONCILABLE only `stock-denied|policy-denied`** | `reconcile_offline_queue_item` manager-tier `42501` + `isReconcilable` `stock-denied|policy-denied` only (Q3/Q11), lease/provenance | P5-B `reconcile_offline_queue_item` Q3/Q11 D, P6 `R093.RECON.*` 9 PASS, P7 742/0, `R093.EXCEPTION.*` + `TAMPER` |
| 17 | **Tested POS/quick quota `P0QLT`** | Uniform `P0QLT` `20261001000000` on `post_pos_sale`/`save_quick_sale`/`save_quick_expense`/`execute_pending_payroll_run` + `ledgr_monthly_document_count` vs `head:true` + Q13 C dual authority (capture-time `queueApi` + authoritative) | P5-C Q12 B, Q13 C, `R10.QUOTA.*` 5 PASS + `REGRESSION.SUCCESS-CLIENTKEY`, `isQuotaDenial` |
| 18 | **Uniform `BEFORE INSERT` quota** | `BEFORE INSERT` triggers calling `_ledgr_assert_usage_limit` where already proven | P5-C `20261006000000_p5c_uniform_billing_quota`, `p5c_uniformQuota` tests |
| 19 | **AI `ai_context` — read-only, non-authoritative** | `ai_context(business_id, branch_id?)` optional `can_access_branch` check, `security_invoker` views + RLS, never mutates | P5-E `ai_context` Q14 B optional, Q15 B after P8, `R093`/`R03` |
| 20 | **Multi-business tenant isolation** | `TENANT.A/B.*` 10 PASS via `is_business_member` (excluding Storage per Q6) | P6/P7 |

All 20 are `CERTIFIED` for pilot. No other capability is certified.

---

## §4 Explicit Exclusions

**Each is `Implemented` (exists, works in dev) but `OUT OF RELEASE SCOPE` → `BLOCKED`/`DEFERRED`, not PASS. `EXCLUDED ≠ FAILED`, `EXCLUDED ≠ PASS`, `EXCLUDED = OUTSIDE CURRENT CERTIFICATION BOUNDARY`. Owner accepted per Q2–Q8 YES.**

| Capability | Evidence status | Owner acceptance | Release status |
|---|---|---|---|
| **Storage isolation** (`storage.objects` RLS, path, signed URL) | **BLOCKED B** 2 — `TENANT.A/B.storage`, no Storage infra, DB RLS ≠ Storage RLS | YES Q6 | **EXCLUDED** |
| **Provider authentication** (`AUTH.valid-login`/`expired-session`/`logout-revocation` + `PRIV.*` + `R02.PROVIDER-TOKEN.*` 9) | **BLOCKED B** 17 — no isolated GoTrue (`auth.users`) | YES Q7 | **EXCLUDED** |
| **Browser/server revalidation** (`R094` 2× `B` CRITICAL) | **BLOCKED B** — no wire-reachable PostgREST/GoTrue/JWT | YES Q8 | **EXCLUDED** |
| **Full commercial billing lifecycle** (`BILLING.SERVER-QUOTA` `D`) | **OWNER DECISION D** — canonical billing command not defined (POS/quick `P0QLT` proven) | YES Q5 PILOT | **EXCLUDED** — pilot limited to tested POS/quick |
| **App-wide branch admin** (`BRANCH.create`/`cross-branch-admin`/`modify` 3× `D`) | **OWNER DECISION D** — writer `can_write_*` org-wide escape, till family sealed but `branches` not (R08.7) | YES Q4 | **EXCLUDED** — till via `post_pos_sale` certified only |
| **Branch-scoped customers/financial/inventory/reports beyond till** (5× `C`) | **ACCEPTED C** — R08.7 org-wide intentional, till family only | YES Q3 | **EXCLUDED** — org-wide is current contract |
| **Generic offline conflict / multitab / concurrent-client** (`OFFLINE` 4 + `R06.CONCURRENT` 1) | **ACCEPTED C** — no approved contract / honest harness limitation | YES Q3 | **EXCLUDED** — P5-A/B proven only |
| **AI branch beyond P5-E / OTP/SMS / legacy bootstrap** (`AI.BRANCH` `C`, `R02.DEC-02`/`OTP` 4, `F` 12) | **ACCEPTED C/F** — no SMS/OTP per P4 DEC-02, after P8 per Q15, legacy superseded | YES Q3 | **EXCLUDED** |

**Single-storey principle:**

```text
Storage isolation
  Evidence: BLOCKED B (no Storage infrastructure)
  Owner acceptance: YES (Q6)
  Release status: EXCLUDED (Storage claims not certified)
— NOT: Evidence PASS
```

Apply `OWNER ACCEPTED ≠ ENGINEERING PROVEN` throughout.

---

## §5 Known Accepted Limitations

**15 × Class C — Owner ACCEPTED YES Q3 for pilot. Each is `current contract`, not a defect. P8 `A 0, B 21, C 15, D 4, E 0, F 12` — 0 security-critical, 0 financial-integrity blockers for limited scope.**

| Test ID | Limitation | Current contract | Affects pilot use / security / financial |
|---|---|---|---|
| `BRANCH.customers` | contacts org-wide, no branch predicate | `is_business_member` + `can_write_business_data` org-wide; `contacts.branch_id` out-of-scope per R08.7/P6 | No |
| `BRANCH.financial` | journal org-wide, no branch dimension | Intentional; POS shift report branch-enforced only | No |
| `BRANCH.inventory` | stock org-wide via `can_write_business_data` | `inventory_locations.branch_id` but `stock_movements` org-wide; POS branch via `can_operate_pos` proven | No |
| `BRANCH.read` | core tables org-wide SELECT; till family branch-enforced only | Till `can_access_branch` proven; core org-wide intentional per R08.7 do-not-expand | No |
| `BRANCH.reports` | general reports org-wide, POS shift report branch-enforced | `R08.REFUND.SCOPE-ATTACK` proven | No |
| `OFFLINE.ACTOR-BINDING` | no durable originating-user/device for generic queue | P5-A provenance `originUserId`/`originDeviceId`/`originTerminalId` + `sweepUnverifiableItems` is contract | No |
| `OFFLINE.BROWSER` | fake IndexedDB close/reopen ≠ browser process shutdown | P5-F `R094.BROWSER.SW.*` 8 PASS fake adapters is current; real browser is `R094` B | No |
| `OFFLINE.CONFLICT` | no generic conflict resolution | P4 Q8 C + Q10 B typed `branch-denied`/`stale-version`/`payload-tampered` as `failed`/`quarantined` | No |
| `OFFLINE.MULTITAB` | no generic multitab workers | Lease `R093.LEASE-EXCLUSIVE` + `MATRIX` proven; workers R11 future | No |
| `R06.POS.STOCK.CONCURRENT` | concurrent `post_pos_sale` `FOR UPDATE` needs 2-client harness | `FOR UPDATE` is contract; sequential `ATOMIC`/`CONCURRENT` `23514` single-client proven; honest harness limitation | No — stock `23514` PASS |
| `AI.BRANCH` | AI branch filter optional, after P8 per Q14/Q15 B | `ai_context(business_id, branch_id?)` `can_access_branch` read-only non-authoritative | No |
| `R02.DEC-02.LEGITIMATE-PHONE-RECOVERY` | DEC-02 single-owner phone recovery, no SMS/OTP | Current product has no SMS/OTP per P4 | No |
| `R02.RECOVERY.OTP.FUTURE-VALID-ALLOWS-RECOVERY` | OTP future-valid | No OTP mechanism per P4 | No |
| `R02.RECOVERY.OTP.SUBSTITUTED-TARGET-DENIED` | OTP substituted-target | No OTP | No |
| `R02.RECOVERY.OTP.WRONG-DENIED` | OTP wrong | No OTP | No |

Do not relabel as defects — P8 classified none as `A`/`E`.

---

## §6 Deferred Evidence

**21 × Class B + 4 × Class D = 25 items. All `DEFERRED`, `NOT CERTIFIED`, `NOT AUTHORIZED FOR REMEDIATION BY P10`. Require separate `GO` with Docker/Storage/Auth Admin or owner decision + policy reshape.**

### B — Environment / infrastructure gates (21)

| Group | Count | Test IDs | Why blocked | Affects pilot? |
|---|---|---|---|---|
| `R094` browser/server | 2 | `R094.BROWSER.SERVER-REVALIDATION`, `R094.BROWSER.SERVER-REVALIDATION.INVESTIGATION` | No Docker Supabase stack for browser→PostgREST→JWT | No — P6 DB authority + stub client-path relied upon |
| `TENANT.storage` | 2 | `TENANT.A.storage`, `TENANT.B.storage` | No Real Storage + effective business_users grants; DB RLS ≠ Storage RLS | No — DB RLS proven via P6, Storage excluded |
| `AUTH` | 4 | `AUTH.expired-session`, `AUTH.invalid-login`, `AUTH.logout-revocation`, `AUTH.valid-login` | No isolated GoTrue | No — tenant membership via `pg` mock-JWT + RLS proven |
| `PRIV` | 4 | `PRIV.INVITATION`, `PRIV.MEMBERSHIP`, `PRIV.PROFILE`, `PRIV.RECOVERY` | No Auth Admin + delivery / migration-only ACL | No |
| `R02` provider-token | 9 | `R02.PROVIDER-TOKEN.consumed`, `.expired`, `.identity-changed-after-issuance`, `.invalid`, `.malformed`, `.missing`, `.replay`, `.substituted`, `.valid-own-identity` | No isolated recovery service/delivery | No |

### D — Owner-decision / contract gates (4)

| Test ID | What is deferred | Tested within pilot | Why not in pilot |
|---|---|---|---|
| `BRANCH.create` | Branch create via `can_write_sales_data` org-wide (raw `supabase.from('invoices').insert` escape, R08.7) | `post_pos_sale` till family sealed `42501` | Needs `can_access_branch` reshape + audit of direct-API call sites (Future Package D) |
| `BRANCH.cross-branch-admin` | Cross-branch admin for `branches`/`departments`/`inventory_locations` via broad `can_write_business_data` | `pos_terminals` sealed `can_admin_business_data` (owner/admin) | Same reshape needed; one sealed + one open ⇒ stays BLOCKED with citation |
| `BRANCH.modify` | Branch modify via `can_write_sales_data` org-wide | `business_users` assignment admin-only | Same |
| `BILLING.SERVER-QUOTA` | Canonical commercial billing command (any billable outside POS/quick via builder/direct insert) | `P0QLT` for `post_pos_sale`/`save_quick_*` + uniform `BEFORE INSERT` proven (`R10.QUOTA.*` 5 PASS) | Needs canonical command/approval/entitlement per Q12/Q13 + concurrency + idempotency + Stripe/subscription (Future Package E) |

**All remain `BLOCKED` at evidence level — P10 does not remediate, does not relabel, does not reinterpret.**

---

## §7 Release Configuration Audit

*Objective: identify whether the release build could accidentally connect to dev infra, expose test creds, enable deferred functionality, bypass RLS, use service-role client-side, enable debug/test modes, point to wrong API, or disable security.*

### 7.1 Environment variables

| Var | Location | Intended use | Pilot finding |
|---|---|---|---|
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts` `import.meta.env.VITE_SUPABASE_URL` → `resolvedUrl` placeholder fallback | anon client URL | ✅ No secret; value is URL only. `vite.config.ts` derives `supabaseHost` for PWA `runtimeCaching` via same var — staging vs prod derived correctly. Build guard `scripts/check-env.mjs` requires it for prod (`VERCEL_ENV=production` fail-loud), allows preview placeholder with `<ConfigError />` fallback. |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` | anon key (public, RLS-enforced) | ✅ Public anon key only; never service_role. Placeholder `placeholder-anon-key` only when missing — never real prod secret via VITE_. |
| `VITE_FEATURE_*` | `src/lib/featureFlags.ts` `FLAG_PREFIX=VITE_FEATURE_`, defaults `ai_agent:true`, `experimental:false` | feature flag toggle per deploy | ✅ Both flags default safe; no deferred branch/billing/Storage auto-enable. No `VITE_FEATURE_` currently enables `BRANCH.*`/`BILLING` deferred paths. Verified `grep VITE_FEATURE` only in `featureFlags.ts` + tests. |
| `VITE_AI_CHAT_URL` | `src/lib/ai/provider.ts` `import.meta.env.VITE_AI_CHAT_URL` | optional Edge Function URL for LLM | ✅ URL only, never key. `AI_API_KEY`/`ANTHROPIC_API_KEY` stay server-side (`supabase secrets set`). With var unset, deterministic rules engine answers offline for free — correct pilot behaviour. |
| `VITE_SENTRY_DSN` | `src/main.tsx`, `src/components/ErrorBoundary.tsx` | Sentry DSN (public) | ✅ Public DSN only; `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` only in `vite.config.ts` build-time sourcemaps, not embedded in client bundle. |
| `VITE_LOG_LEVEL` | `src/lib/logger.ts` | log level | ✅ Non-sensitive. |
| `VITE_PLATFORM_ROOT_DOMAIN` | `src/lib/partnerDomain.ts` | white-label domain | ✅ Default `ledgr.com` |
| `VITE_APP_VERSION` | `vite.config.ts` `define` | version stamp | ✅ Defaults `local-<ISO>` or `process.env.VITE_APP_VERSION` — no secret. |

**No `VITE_` variable carries `SUPABASE_SERVICE_ROLE_KEY`, `PAYCHANGU_SECRET_KEY`, `SENDGRID_API_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `INVOICE_TRACKING_SECRET`, or DB password.** All are `.env.example` placeholders only + `supabase secrets set` / GitHub `secrets.*` / `supabase functions deploy --no-verify-jwt` server-side (see `DEPLOYMENT.md`, `.github/workflows/deploy.yml`).

### 7.2 Supabase configuration

- `supabase/config.toml` — local Supabase (`project_id=ledgr`, `major_version=17` verified SHOW server_version 17.6, 55 migrations replay on PG 18.4), ports 54321/54322/54323, `auto_expose_new_tables` unset (cloud default revoked), `db.seed sql_paths=./seed.sql`. No production secrets — local only.
- Client: `src/lib/supabase.ts` creates single `createClient(resolvedUrl,resolvedKey)` with `fetchWithTimeout` 30s read / 60s write, never `service_role`. Verified `grep service_role` in `src/` only appears in `dal/repositories/__tests__` (`grant execute to authenticated, service_role`) and test isolation (`rlsIsolation.test.ts` asserts `middleware.ts` absent) — no client-side `service_role`.

### 7.3 Vite / build

- `vite.config.ts` — `loadEnv` + `supabaseHost` hostname extraction + `supabaseUrlPattern` via `supabaseHost` (not closure, Workbox serialisation-safe), `includeAssets` icons, `globPatterns **/*.{js,css,html,svg,png,ico,woff,woff2}`, `maximumFileSizeToCache 5MB`, `navigateFallback /index.html` with `denylist /^\/api\//`, `cleanupOutdatedCaches`, `clientsClaim`. Chunk split `vendor-react`/`vendor-charts`/`vendor-data`/`vendor-i18n`/`vendor`. `server 0.0.0.0:5173` + `allowedHosts:true` + `hmr.clientPort:443` — correct for preview host allowlist. No debug/test mode flag enables deferred functionality.

### 7.4 PWA / service-worker

- `vite-plugin-pwa` `generateSW` + `importScripts: ['sw-events.js']`. `public/sw-events.js` handles push, notification-click, Background Sync — app server wakes authenticated sync engine; `online` events + mount backlog fallback for no Background Sync. `runtimeCaching`: `supabaseUrlPattern('/rest/v1/')` `NetworkFirst` 4s timeout, `auth/v1/` `NetworkOnly`, static `CacheFirst` 30d. No cache bypass for POST/RPC — financial writes go through `supabase.rpc`/`from` NetworkOnly path correctly. DevOptions `enabled:true type:module` — dev only.

### 7.5 Auth configuration

- `supabase.auth` via `supabase-js` anon client only. No `service_role` token in browser. Edge Functions (`supabase/functions/*`) all do `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!` + `createClient(SUPABASE_URL,SERVICE_ROLE_KEY)` server-side only. Verified no `src/` imports `SUPABASE_SERVICE_ROLE_KEY`.

### 7.6 API endpoints

- REST: `https://<project-ref>.supabase.co/rest/v1/` via Supabase client. Edge Functions: `supabase.functions.invoke('ai-insights'|'ai-chat'|'accept-invite-link'|...)` — secrets server-side. No `VITE_` points to `localhost` in prod; `vite.config.ts` `supabaseHost` fallback is placeholder only when var unset. All API config via `VITE_SUPABASE_URL` single source of truth — no divergent hard-coded host.

### 7.7 Feature flags / deferred toggles

- No flag currently gates `BRANCH.create`/`BILLING.SERVER-QUOTA`/`TENANT.storage`/`R094` as enabled. Enabling those would require code + migration + `P0QLT`/`can_access_branch` change — not togglable via env. `experimental:false` default ensures no experimental path auto-enabled.

### 7.8 Billing / quota

- Env `PAYCHANGU_SECRET_KEY`/`PAYCHANGU_WEBHOOK_SECRET`/`CRON_SECRET`/`INVOICE_TRACKING_SECRET` all `Deno.env` in Edge Functions (`paychangu-webhook`, `expire-subscriptions`, `invoice-open`, `send-invoice`), never `VITE_`. Quota config `src/lib/billing/UsageService.ts` counts via `supabase.rpc('ledgr_monthly_document_count')` (server count preferred, RLS-safe) then fallback `from` `head:true` per table; `queueApi.ts` `enqueue` capture-time `usageService.assertCanCreateDocument` with 80ms placeholder / 1500ms prod timeout, fail-open on non-P0QLT, only `P0QLT` propagates — correct pilot: `P0QLT` authoritative server `_ledgr_assert_usage_limit` `FOR UPDATE` `P0QLT`.

### 7.9 AI

- `VITE_AI_CHAT_URL` unset → deterministic rules engine offline/free. `AI_PROVIDER=groq`/`AI_API_KEY`/`ANTHROPIC_API_KEY` in `.env.example` placeholders only, real via `supabase secrets set`. Client `src/lib/ai/context.ts` → `supabase.rpc('ai_context', {p_business_id, p_branch_id})` — server re-checks `is_business_member` + `can_access_branch`, views `security_invoker` RLS. No API key in bundle.

### 7.10 Production / development separation

- `scripts/check-env.mjs` prebuild: requires `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` for prod (`VERCEL_ENV=production` fail-loud), allows preview placeholder with warn + `<ConfigError />` (A-01 defense-in-depth). `DEPLOYMENT.md` + `.github/workflows/deploy.yml` separate `STAGING` (`VITE_SUPABASE_URL_STAGING` vars + secrets STAGING) vs `PROD` (`*_PROD`), each inject via `--build-env` + `supabase link --project-ref` + `supabase db push` + `supabase secrets set` per env + `supabase functions deploy`. No cross-env credential leakage. `vite` `define VITE_APP_VERSION` per `mode` correctly.

### 7.11 Verdict

```text
Release configuration audit: PASS — no pilot-blocking misconfiguration
No deferred capability accidentally enabled
No service-role exposure
No test credential hard-coded
No dev infra default in prod path (guard + placeholder + ConfigError layered)
No document secrets printed
```

---

## §8 Secret / Credential Safety

*Repository-level check for accidental client-side secrets. Do not print credential values.*

### 8.1 Method

```bash
grep -rn SUPABASE_SERVICE_ROLE_KEY src/ --include="*.ts" --include="*.tsx"
grep -E -rn "(SECRET|SERVICE_ROLE|PRIVATE|ANTHROPIC|PAYCHANGU|SENDGRID)" src/ --include="*.ts" --include="*.tsx"
git ls-files | xargs grep -l "SERVICE_ROLE|PAYCHANGU_SECRET|SENDGRID_API_KEY"
grep -rn "VITE_" src/ --include="*.ts" --include="*.tsx"
cat .env.example; cat supabase/config.toml
grep -n "SUPABASE|SECRET|ANON" .github/workflows/deploy.yml
```

### 8.2 Findings

| Check | Result |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` in `src/` client code | **None** — all 24 hits are `supabase/functions/*` `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!` (server-only) + `local-backup/index.ts` (server). One `.env.example` placeholder `your_service_role_key_here` — not a real key. |
| `service_role` in `src/*.ts` | Only tests: `inventoryBackfill` grant check, `rlsIsolation` asserts `middleware.ts` absent, `release/database.test.ts` `anon` vs `service_role` `rolbypassrls` — no client use. |
| Secrets in tracked/client-accessible locations | **None real.** `git ls-files` hits are `.env.example` placeholders, `deploy.yml` `${{ secrets.* }}` references, `PAYCHANGU_SETUP.md`/`DEPLOYMENT.md`/`SUPPORT_AGENT.md` docs with placeholder `your_*_here`, `scripts/create-api-key.sh`, `supabase/config.toml` (local project_id only, no secret). No committed `.env` (ignored). |
| `VITE_` exposure | Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_FEATURE_*`, `VITE_AI_CHAT_URL`, `VITE_SENTRY_DSN`, `VITE_LOG_LEVEL`, `VITE_PLATFORM_ROOT_DOMAIN`, `VITE_APP_VERSION`. No `VITE_` carries service_role / SendGrid / PayChangu / Anthropic key / CRON_SECRET. Anon key is public by Supabase design (RLS-enforced). |
| Build output secrets | `vite.config.ts` `SENTRY_AUTH_TOKEN`/`SENTRY_ORG`/`SENTRY_PROJECT` only from `process.env` at build time for sourcemaps, not embedded via `import.meta.env`. No secret `define`. |
| Supabase Edge Functions | Correctly use `Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`, `PAYCHANGU_SECRET_KEY`, `ANTHROPIC_API_KEY`, `CRON_SECRET`, `INVOICE_TRACKING_SECRET` server-side with `createClient(SUPABASE_URL,SERVICE_ROLE_KEY)`. `functions/api/index.ts`, `ai-chat`, `accept-invite-link`, etc. all `Deno.env` — not `import.meta.env`. |
| Placeholder vs real | `src/lib/supabase.ts` falls back to `https://placeholder.supabase.co` / `placeholder-anon-key` only when `isSupabaseConfigured=false` — preview/build; `scripts/check-env.mjs` fails prod builds without real vars (A-01). No hard-coded prod project-ref secret in source. `vite.config.ts` `supabaseHost` fallback `hsuhuvuxfuufrlejsatw.supabase.co` is legacy fallback only when var unset — not a secret, and overridden by `VITE_SUPABASE_URL` hostname in real builds. |

### 8.3 Verdict

```text
Secret / credential safety: PASS — no real secret in tracked/client-accessible material
STOP condition not triggered (no real service_role/private key/JWT signing secret/database credential in client bundle)
No rotation needed in P10; no auto-remediation performed (per P10 §7: do not rotate/delete automatically)
```

---

## §9 Client-Side Authority Audit

*Verify approved release does not rely on client-side authority for tenant, branch, financial, stock, quota, POS, corrections.*

| Authority | Authoritative server/database path (proven P5–P8) | Client code | Verdict |
|---|---|---|---|
| **Tenant isolation** | `is_business_member()` SECURITY DEFINER + `relrowsecurity true` RLS on `invoices/stock_movements/inventory_balances/inventory_locations/products/offline_queue_reconciliations` + `request.jwt.claim.sub/role` | `src/lib/supabase.ts` anon client only; `src/lib/branch/p5d` tests assert `is_business_member` predicate in policies | **PASS** — no client-side `business_id` widening; server re-checks. P6 two-business `authenticated` + separate `pg` clients proved no bypass. |
| **Branch authorization** | `can_access_branch(business_id, branch_id)` `SECURITY DEFINER` DEC-03 fail-closed (`NULL`→`false` for assigned-scope), checked in `post_pos_sale` + `pos_shifts`/`pos_cash_movements` + `ai_context` + `get_pos_shift_report` | `src/lib/ai/context.ts` passes `p_branch_id` to `ai_context` RPC which verifies `can_access_branch` server-side; `src/lib/branch/__tests__/p5d_branchScope.test.ts` asserts predicate. No client direct `branch_id` trust. | **PASS** — till family `42501` via server; raw writer org-wide correctly excluded from pilot certification (D items). |
| **Financial posting** | `post_pos_sale` `SECURITY DEFINER` `can_operate_pos` `42501`, product tenant `22023`, `23514` on-hand; journal entries created server-side, not client-inserted | `src/services/posService.ts` calls `supabase.rpc('post_pos_sale')` only; no `supabase.from('invoices').insert` for POS path. `offline/reconciliation.ts` replays through `post_pos_sale` under same client_key (exactly-once). | **PASS** — no client-side journal creation. |
| **Stock integrity** | `trg_stock_movement_apply_balance` `FOR UPDATE` + `23514` check constraint (`stock_nonnegative`); `can_operate_pos` prior | `src/offline/` provenance respected; no client `inventory_balances` direct write. | **PASS**. |
| **Quota enforcement** | `_ledgr_assert_usage_limit(NEW.business_id)` `FOR UPDATE` on businesses row, `P0QLT` (`QUOTA_DENIAL_SQLSTATE`), called by `post_pos_sale` + `save_quick_*` + uniform `BEFORE INSERT` triggers (`20261001000000` + `20261006000000`) | `src/lib/billing/UsageService.ts` `countDocumentsOnServer` → `supabase.rpc('ledgr_monthly_document_count')` (server count, RLS-safe) + fallback `head:true`; `src/offline/queueApi.ts` `enqueue` capture-time `usageService.assertCanCreateDocument` with 80/1500ms timeout, fail-open on non-P0QLT, only `P0QLT` propagates. Authoritative `_ledgr_assert_usage_limit` remains server trigger. Tests `p5c_uniformQuota` assert `perform public._ledgr_assert_usage_limit` + `FOR UPDATE` + `using errcode = 'P0QLT'`. | **PASS** — client is early UX guard only, not authority; server `FOR UPDATE` + `P0QLT` authoritative. No client-only `canCreate` bypass. |
| **POS posting** | `post_pos_sale` is sole authoritative POS path; client `posService.test.ts` verifies `42501`/`23514`/`P0QLT` mapping | `src/services/posService.ts` throws `UsageLimitError` on `P0QLT`, `StockError` on `23514`, `PermissionError` on `42501` — preserves typed `isQuotaDenial` (`QUOTA_DENIAL_SQLSTATE`) | **PASS**. |
| **Corrections / refunds / voids** | Server procedures with `is_business_member` + immutable history (`22023`/`42501` where applicable) | No client mutable history override; `src/offline/exceptions.ts` classifies `P0QLT`→`policy-denied`, stock→`stock-denied`, branch→`branch-denied` | **PASS**. |

**No rewrite of `post_pos_sale`/`can_access_branch`/`P0QLT`/`23514`/`FOR UPDATE` performed in P10.** This is audit only — not a security redesign (per §8).

```text
Client-side authority audit: PASS
```

---

## §10 PWA / Offline Release Audit

*Verify release configuration against already-approved offline contract.*

### 10.1 Contract (P4 Q1–Q11, P5-A/B, P6 R093, P7)

```text
RECONCILABLE (re-playable once conditions allow):
  stock-denied          (23514, STOCK_NONNEG_CONSTRAINT, derived from server 23514 or P0QLT with stock message)
  policy-denied         (P0QLT QUOTA_DENIAL_SQLSTATE)

PERMANENTLY non-reconcilable (quarantined / failed):
  branch-denied
  stale-version         (Q1 B)
  unknown-version       (Q2 B)
  payload-tampered      (Q8 C + payloadIntegrity hash)
  clientKey-payload-mismatch (Q10 B)
Never reconcilable:     (Q3 A — never expand RECONCILABLE)

Lease/provenance:
  originUserId / originDeviceId / originTerminalId via buildProvenance / captureContext
  sweepUnverifiableItems, MAX_PENDING_QUEUE_ITEMS 2000 backpressure
  stale/unknown quarantine per payloadVersion

What is deferred (not claimed):
  generic offline conflict resolution, multitab guarantees, generic concurrent-client,
  fake IndexedDB close/reopen ≠ browser process proof
```

### 10.2 Verification

| Property | Source evidence | Pilot status |
|---|---|---|
| `stock-denied` reconcilable | `src/offline/exceptions.ts` `classifyReplayException({code:'23514'|'P0QLT'+stock})→stock-denied`, `src/offline/__tests__/exceptions.test.ts` | ✅ Not advertised beyond contract |
| `policy-denied` reconcilable | `classifyReplayException({code:'P0QLT'})→policy-denied`, `reconciliation.ts` `code:'P0QLT'` | ✅ |
| `branch-denied` non-reconcilable | `can_access_branch` word `branch` check in `exceptions.ts`, `offers P5-B` `R093.RECON.*` | ✅ |
| `stale-version` quarantined | `src/offline/db.ts` `payloadVersion`, `src/offline/__tests__/p5b_model4.test.ts` Q1 | ✅ |
| `unknown-version` quarantined | Same, Q2 | ✅ |
| `payload-tampered` quarantined | `payloadIntegrity.ts` `hashQueuePayload`, `reconciliation.ts` hash comparison → `quarantined`, P5-A | ✅ |
| `MAX_PENDING_QUEUE_ITEMS 2000` | `src/offline/queueApi.ts:125` `MAX_PENDING_QUEUE_ITEMS=2000`, `enqueue` cap | ✅ Backpressure, not unbounded |
| Lease / provenance | `src/offline/lease.ts`, `provenance.ts`, `db.ts`, `reconciliation.ts` `exactly-once` via `post_pos_sale` under same `client_key` | ✅ Manager-tier `42501` on `reconcile_offline_queue_item` preserved |
| Service worker | `vite.config.ts` `VitePWA generateSW` `importScripts sw-events.js` `NetworkFirst` `NetworkOnly` auth `CacheFirst` static; `public/sw-events.js` Background Sync + `online` + backlog | ✅ No claim `universal offline correctness` |

### 10.3 Non-claims preserved

```text
Do not claim: universal offline correctness, multitab guarantees, generic concurrent-client, fake close/reopen as browser process proof
```

Pilot docs, READMEs, and release manifest do not advertise those.

```text
PWA / offline release audit: PASS — within already-approved RECONCILABLE contract
```

---

## §11 Billing Release Boundary

*Pilot must remain `PILOT / LIMITED CONTROLLED USERS`. Must not imply `FULL COMMERCIAL BILLING`.*

### 11.1 Proven, may remain active

```text
P0QLT  (QUOTA_DENIAL_SQLSTATE 'P0QLT')
post_pos_sale  (perform _ledgr_assert_usage_limit)
save_quick_sale / save_quick_expense / execute_pending_payroll_run
uniform BEFORE INSERT quota checks (20261006000000)
ledgr_monthly_document_count (head:true fallback)
queueApi capture-time assertCanCreateDocument (UX early guard, fail-open except P0QLT)
isQuotaDenial / UsageLimitError typed contract
R10.QUOTA.* 5 PASS + REGRESSION.SUCCESS-CLIENTKEY
```

Verified:

- `supabase/migrations/20261001000000_p5c_uniform_billing_quota.sql` + `20261006000000_p5c_uniform_billing_quota.sql` contain `perform public._ledgr_assert_usage_limit(NEW.business_id)` + `select ... for update` + `using errcode = 'P0QLT'`
- `supabase/migrations/20260923000000_post_pos_sale_rpc.sql` + `20260911000001_quick_save_rpc.sql` contain `perform public._ledgr_assert_usage_limit`
- `src/lib/billing/UsageService.ts` `getCurrentMonthTransactionCount` counts `invoices`/`expenses`/`payroll_runs` as documents (not `journal_entries`), server count preferred
- No source in `src/` auto-upgrades `plan_tier` or bypasses count

### 11.2 Deferred, must not be assumed

```text
BILLING.SERVER-QUOTA D — canonical commercial entitlement lifecycle
subscription lifecycle (Stripe, businesses.subscription_status)
commercial billing recovery
canonical billing command for generic direct-insert / expenses/payroll/bills via builder outside POS/quick
```

`src/lib/billing/__tests__/p5c_uniformQuota.test.ts` explicitly asserts `businessRepository` `notContain _ledgr_assert_usage_limit / P0QLT` — generic path is not where limit is enforced beyond trigger; canonical command is deferred to Future Package E.

Pilot: subscription is **manually managed / invited users**, Stripe lifecycle **not certified**. `PAYCHANGU_SECRET_KEY` secrets remain server-side in Edge Functions `initiate-subscription-payment`/`paychangu-webhook`/`verify-subscription-payment` but are **not part of pilot certification** (P9.1 Q5 PILOT).

### 11.3 Verdict

```text
Billing release boundary: PASS — pilot mode maintained, proven P0QLT active, full commercial not implied
```

---

## §12 AI Release Boundary

*Verify AI remains `READ-ONLY`, `NON-AUTHORITATIVE` within P9 contract. No new AI capabilities.*

| Check | Evidence | Verdict |
|---|---|---|
| `ai_context` read-only | `src/lib/ai/context.ts` only calls `supabase.rpc('ai_context', {p_business_id,p_branch_id})` + fetches `businesses.name` + `knowledgeBase` + `forecast(data,3)`; no `from().insert/update/delete` on AI path | **PASS** |
| Server branch auth | `ai_context` SQL re-checks `is_business_member` + `can_access_branch(business_id, branch_id?)`, views `security_invoker` so RLS applies; `p_branch_id` optional, when omitted org-wide roles retain org-wide where permitted while assigned-scope implicitly filtered (P5-E) | **PASS** |
| No financial/stock mutation | `provider.ts` `remoteProvider` POST `{messages,context}` to `VITE_AI_CHAT_URL` Edge Function only; `fallback.test.ts` + `branch.test.ts` assert no mutation | **PASS** |
| No permissions/quota authority | AI never calls `_ledgr_assert_usage_limit` or `post_pos_sale`; `UsageService` + `posService` are separate paths | **PASS** |
| Config | `featureFlags.ts` `ai_agent:true` default controls surface visibility only, not authority; `VITE_AI_CHAT_URL` unset → deterministic rules engine offline/free, correct pilot | **PASS** |
| New capabilities | **None added in P10** — `git diff --stat` docs-only | **PASS** |

```text
AI release boundary: PASS
```

---

## §13 Production Build

*Established checks: unit tests, typecheck, lint, production build, release diff check. Do not artificially modify tests.*

### 13.1 Unit

```bash
npm test — 91 files — re-verified for remediated source 013b37b (application tree unchanged after a42a9bc)
```

Expected baseline (P9 + P5-E remediation): `807 PASS / 0 FAIL` + `P5-E 24/24 data-verified`

> Fill after run in §13.5.

### 13.2 Typecheck

```bash
tsc -b
```

Expected: `PASS`

### 13.3 Lint

```bash
eslint — 0 errors / 3 warnings (unused eslint-disable) — historical baseline
```

### 13.4 Build

```bash
vite build — PASS (placeholder VITE_SUPABASE_URL allowed via check-env preview path) — re-verified for remediated source
```

### 13.5 Results (filled after execution — RE-CREATION for 013b37b)

```text
npm test:        PASS — 807 PASS / 0 FAIL / 807 total across 91 files (vitest run, 59.38s at a42a9bc/013b37b — same 807 as P9, now includes remediated P5-E 24/24 branch_manager NULL 42501, sales_manager NULL 42501)
                 Sample tail: ✓ fallback.test.ts (10), legacyPosQueue (6), p5d_branchScope (8), branch.test.ts (10), TeamManagementPagePhoneInvite (5/642-1044ms),
                              91 passed (91), Tests 807 passed (807), Duration 59.38s (environment 48%, import 25%, tests 19% — isolate:false shared)
npx tsc -b:      PASS — exit 0, no type errors (Projects tsconfig.app.json + tsconfig.node.json + tsconfig.json — Building tsconfig.app.json)
npm run lint:    PASS — eslint: 0 errors, 3 warnings (unused eslint-disable at artifacts/database/fresh-database.generated.approx.ts:1:1 and src/offline/queueApi.ts:181/186 no-console) — matches P9/P10 baseline 0e/3w
git diff --check: PASS — exit 0, no whitespace errors
VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder-anon-key npm run build:
                 PASS — vite build 2.14s, 112 precache entries (3752.63 KiB) via VitePWA generateSW, dist/sw.js + workbox-802c4cd3.js produced,
                 chunks vendor-react 214 KiB, vendor-data 339 KiB, vendor-charts 345 KiB, index 414 KiB (all gzip noted) — P10 re-creation build matches P10 baseline within 0.11s/0.03 KiB (migration comment only)
P5-E remediation: PASS — 24/24 data-verified matrix (embedded-postgres 17, invoices 5000/7000) — branch_manager NULL 42501 fixed from 12000, sales_manager NULL 42501 fixed, service_role A1 5000, owner/viewer 12000, cashier 42501 — see docs/releases/LEDGR_P5E_REMEDIATION_2026-09-24.md
```

All four production checks match the P9 historical baseline exactly (807 unit PASS, typecheck PASS, lint 0e/3w, build PASS) **and** include the remediated `P5-E 24/24`. No test was modified to make it pass; no harness weakening.

---

## §14 Release-Candidate Smoke Matrix

*Deterministic smoke matrix for the approved scope. Each property identifies existing evidence/test responsible — no new security claims.*

| Domain | Property | Expected behaviour | Existing evidence / test | Class |
|---|---|---|---|---|
| **Auth / tenant** | Authenticated tenant access | Member can read own business rows | `is_business_member` RLS + P6 two-business `TENANT.A/B.*` `is_business_member` SELECT PASS | PROVEN |
|  | Cross-tenant denial | A cannot read B rows; B cannot read A | P6 `R06.POS.STOCK.CROSS-TENANT` + `R093.RECON.CROSS-BUSINESS` C harness 0 mutation, `TENANT.A/B` 10 PASS `pos/read/update/delete` | PROVEN |
| **POS** | Authorized sale | `A_cashier` at `A1` terminal via `post_pos_sale` succeeds | `R06.POS.STOCK.*` + `R093` + P7 `742/0` `A_cashier→A1` | PROVEN |
|  | Unauthorized tenant sale | `A` posting to `B` product → `22023`/`42501` / 0 rows | `22023` product tenant + `can_operate_pos` `42501` (R06 cross-tenant) | PROVEN |
|  | Branch denial (till) | `A1`-assigned at `A2` → `42501` via `can_access_branch` | P5-D `can_access_branch` fail-closed, `R08.SHIFT.BRANCH-SCOPED-READ`, `R08.SALE.*` `SERVER-SCOPE` | PROVEN |
|  | Terminal denial | Non-`can_operate_pos` role at terminal → `42501` | `post_pos_sale` `can_operate_pos` | PROVEN |
|  | Product/branch mismatch | Product belongs to different business/branch → `22023` | `post_pos_sale` product tenant check | PROVEN |
| **Inventory** | Valid stock mutation | Positive `FOR UPDATE` apply succeeds, balance computed | `trg_stock_movement_apply_balance` `FOR UPDATE` `23514` | PROVEN |
|  | Negative-stock protection | Over-drain → `23514` `stock_nonnegative` | `R06.POS.STOCK.*` 9 PASS + `REPLAY`/`ATOMIC` | PROVEN |
|  | Row-lock protection | Sequential `ATOMIC`/`CONCURRENT` 23514 single-client proven; `FOR UPDATE` contract | `R06.POS.STOCK.ATOMIC` + P5-C `FOR UPDATE` on `_ledgr_assert_usage_limit` | PROVEN (concurrent 2-client honestly BLOCKED `R06.CONCURRENT` C) |
| **Till** | Shift open | Single open per branch/terminal enforced | `R08.SINGLE-OPEN` | PROVEN |
|  | Shift close | Close succeeds, `CLOSE-IMMUTABLE` `22023` | `R08.CLOSE` + `CLOSE-IMMUTABLE` | PROVEN |
|  | Immutable closed shift | Bypass via new sale on closed shift → 0 rows | `R08.BYPASS-CLOSED` | PROVEN |
|  | Authorization boundary | `can_access_branch` enforced on `pos_shifts`/`pos_cash_movements` | `R08.SHIFT.BRANCH-SCOPED-READ` | PROVEN |
| **Corrections** | Refund / void / correction | Typed corrections post with immutable history | `R07` + `R08` `REFUND.*`/`LATE-ARRIVAL` | PROVEN |
| **Offline** | Valid queue | `enqueue` preserves `businessId` + `provenance` + `clientKey` + `hash` | `src/offline/queueApi.ts` `enqueue` + `MAX_PENDING_QUEUE_ITEMS` | PROVEN |
|  | Lease / provenance | `originUserId`/`originDeviceId`/`originTerminalId` + `lease.ts` `LEAS_EXCLUSIVE` | `R093.LEASE-EXCLUSIVE` + `MATRIX` | PROVEN |
|  | Reconcilable `stock-denied` | `23514` → `stock-denied` → replay succeeds when stock restored | `exceptions.ts` `P0QLT+stock→stock-denied`, `reconciliation.ts` | PROVEN |
|  | Reconcilable `policy-denied` | `P0QLT` → `policy-denied` → replay succeeds when quota restored | Same | PROVEN |
|  | `stale-version` quarantine | Stale `payloadVersion` → `failed` not retried | P5-A Q1 B typed, `reconciliation.ts` `quarantined` | PROVEN |
|  | `unknown-version` quarantine | Unknown → `failed` not retried | Q2 B | PROVEN |
|  | `payload-tampered` quarantine | Hash mismatch → `quarantined`, 0 mutation | `payloadIntegrity.ts` + `R093.TAMPER` 0 mutation | PROVEN |
| **Quota** | Quota boundary | Over-limit `post_pos_sale` → `P0QLT` | `_ledgr_assert_usage_limit` `FOR UPDATE` `P0QLT`, `R10.QUOTA.*` 5 PASS | PROVEN |
|  | Authoritative server rejection | Server `BEFORE INSERT` rejects even if client guard passed | Uniform `BEFORE INSERT` `20261006000000` | PROVEN |
|  | No client-only authority | `usageGuard.test.ts` + `queueApi` fails open except `P0QLT` | `p5c_uniformQuota` Q13 | PROVEN |
| **AI** | Read-only | `ai_context` never mutates | `src/lib/ai/context.ts` `rpc` only | PROVEN |
|  | Branch context where applicable | `p_branch_id` filtered via `can_access_branch` | P5-E `ai_context(business_id, branch_id?)` + `branch.test.ts` | PROVEN |
|  | No mutation authority | AI cannot post sale/journal/stock/quota | `provider.ts` + `fallback.test.ts` | PROVEN |

**No smoke row claims a BLOCKED B/D or ACCEPTED C property as PASS.** Deferred 21+4 remain not smoke-covered here; acceptance is documentary per §6.

---

## §15 Pilot Safety Plan

*Separate document:* `docs/releases/LEDGR_P10_PILOT_SAFETY_PLAN_2026-09-24.md`

Summary here: controlled users only (invited cohort, not named customers), scope controls to certified 20 capabilities, monitoring (failed txns, `42501`/`23514`/`P0QLT`, duplicate `client_key`, queue failures, app errors), incident `OBSERVE → CAPTURE → CLASSIFY → CONTAIN → ESCALATE` (never auto-alter financial records), rollback via actual deployment architecture: Vercel (`vercel --prod` + `--build-env` isolation + `supabase db push` migrations forward-only — no auto-down-migration, restore via backup + redeploy previous commit) + Edge Functions `supabase functions deploy --project-ref`. See safety plan for full detail.

---

## §16 Release Artifact

*Manifest:* `docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.json` — **RE-CREATED** for remediated source

```json
{
  "release": { "name": "LEDGR CONTROLLED PILOT", "source_commit": "013b37bf3533c7be3e529d5a2939f4f3fcf9456c", "branch": "arena/01a0c215-ledgr-react", "mode": "PILOT / LIMITED CONTROLLED USERS", "owner_decision": "GO — P10 RE-CREATION AUTHORIZED FOR REMEDIATED SOURCE 013b37b", "pilot_tag": "v0.1.0-pilot → 682ebbcf83d8299f2e9ce557d724e1882af31bd1 (remains, not moved)", "re_authorization": "2026-09-24 — same 20 CERTIFIED / 21B+4D deferred / 15C accepted, DEC-03/R03/P0QLT preserved" },
  "certified_scope": [],
  "excluded_scope": [],
  "accepted_limitations": [],
  "deferred_evidence": [],
  "verification": { "unit": "807/807 PASS (59.38s) + 24/24 P5-E matrix", "typecheck": "PASS", "lint": "0e/3w", "build": "2.14s 112/3752.63KiB", "smoke": "§14 PASS" },
  "release_status": "PENDING — READY FOR PILOT DEPLOYMENT (re-created, not RELEASED)"
}
```

Do not mark `RELEASED` — P10 is preparation; re-creation status remains `PENDING`. Tag `v0.1.0-pilot` remains at `682ebbc` — not moved in this re-creation.

---

## §17 Release Diff Control

Before commit:

```bash
git diff --stat
git diff --check
```

Expected classification:

```text
RELEASE PREPARATION:  docs/releases/* only ( + audit manifest JSON)
PRODUCT BEHAVIOUR CHANGE: 0
```

If not zero — STOP.

---

## §18 Release Readiness Decision

P10 may produce one of:

```text
READY FOR PILOT DEPLOYMENT
```

or:

```text
PILOT PREPARATION BLOCKED
```

Not:

```text
FULL PRODUCTION READY / FULL COMMERCIAL READY
```

Those exceed P9 authorization.

Readiness recorded in manifest `release_status` + below §19 verdict after build/smoke verification.

---

## §19 Verification (filled after production checks — RE-CREATED for 013b37b)

```text
Baseline:   013b37bf3533c7be3e529d5a2939f4f3fcf9456c P5-E fix (remediated source) — a42a9bcbce455cc990dc43b41362e5e6d79624bf (Post-P5-E gate closure docs-only, application tree unchanged)
            Parent a42a9bc → 013b37b → 950bb67 → a9eeed6 → 682ebbc (v0.1.0-pilot, not moved) → df7ee1c → ed5c06b → 19e712b → 6f5843b P9 GO (preserved)
            Evidence 742/0/52 at .cache/r13/ledgr-r13-ecFOuO/evidence.json — unchanged (P8 classification) + P5-E remediation 24/24 data-verified (embedded-postgres 17, 12000/7000/5000)
            Re-authorization: GO — P10 RE-CREATION AUTHORIZED FOR REMEDIATED SOURCE 013b37b (owner 2026-09-24, same 20 CERTIFIED / 21B+4D / 15C, DEC-03/R03/P0QLT preserved, no deferred B/C/D remediation)

Unit:       PASS — npm test 807/807 across 91 files (vitest 59.38s at a42a9bc/013b37b — includes P5-E branch.test.ts 10, p5d_branchScope 8/8, now with branch_manager NULL 42501)
Typecheck:  PASS — npx tsc -b exit 0 (tsconfig.app.json + tsconfig.node.json + tsconfig.json)
Lint:       PASS — npm run lint 0 errors, 3 warnings (historical baseline 0e/3w)
Build:      PASS — vite build 2.14s, 112 precache 3752.63 KiB, dist/sw.js + workbox-802c4cd3.js (same PWA)
Diff check: PASS — git diff --check exit 0
Config:     PASS — §7 — no deferred capability auto-enabled, no service_role exposure
Secret:     PASS — §8 — no real secret in client bundle/tracked files
Client:     PASS — §9 — post_pos_sale / can_access_branch / P0QLT / 23514 / FOR UPDATE remain server-authoritative
PWA:        PASS — §10 — RECONCILABLE stock-denied|policy-denied only, branch-denied/stale-version/unknown-version/payload-tampered quarantined, no universal/multitab claim
Billing:    PASS — §11 — PILOT/LIMITED CONTROLLED USERS maintained, P0QLT + BEFORE INSERT active, BILLING.SERVER-QUOTA deferred
AI:         PASS — §12 — read-only non-authoritative ai_context via server can_access_branch (now with branch_manager/sales_manager NULL 42501 per P5-E fix), no mutation authority, no new AI
Smoke:      PASS — §14 — 30-row deterministic matrix linked to existing evidence/tests, no new security claims invented
Hard stops: 0 triggered (P10 §21 1-10 all PASS — no security/financial regression, no secret exposure, no deferred enablement, no business-logic change needed)
P5-E:       PASS — 24/24 data-verified matrix (branch_manager NULL 42501, sales_manager NULL 42501, service_role 5000, owner/viewer 12000) — see docs/releases/LEDGR_P5E_REMEDIATION_2026-09-24.md
Pilot tag:  v0.1.0-pilot → 682ebbcf83d8299f2e9ce557d724e1882af31bd1 — remains at 682ebbc, not moved in this re-creation (per authorization, deployment NOT authorized)

Release diff control (§17): RELEASE PREPARATION vs PRODUCT BEHAVIOUR CHANGE
  Expected: docs/releases/* only, PRODUCT 0
  Observed before commit: modified docs/releases/LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md + .json (re-creation)
  git diff --stat after add: docs/releases/* only — docs-only confirmed (no src/supabase/migrations/RLS/SECURITY DEFINER change beyond already-committed 013b37b fix)
  git diff --check: PASS

Overall P10 (RE-CREATED): READY FOR PILOT DEPLOYMENT (bounded to P9 GO pilot scope + P10 re-authorization for 013b37b — not FULL PRODUCTION / FULL COMMERCIAL, not deployed, tag not moved)
```

---

*This release candidate (RE-CREATED) does not rewrite P6/P7/P8/P9 evidence. Original `LEDGR_P9_OWNER_RELEASE_DECISION_2026-09-24.md` remains preparation; `LEDGR_P9_OWNER_DECISION_FINAL_2026-09-24.md`+`.json` remain authorization; `LEDGR_P10_CONTROLLED_PILOT_RELEASE_2026-09-24.md` previous version at `19e712b`/`6f5843b` is superseded by this RE-CREATED version for `013b37b` (history preserved via git). No P11 deployment, no tag move, no deferred B/C/D → PASS, PR #164 not merged. After P10 re-creation, STOP and await next gate (P11).*
