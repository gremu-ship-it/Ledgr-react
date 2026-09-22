# R13 — Reproducible Release Test Harness

**R13 STATUS: Requires Review**
Date: 2026-09-21 (Africa/Johannesburg)
Repository: `gremu-ship-it/Ledgr-react`
Branch: `arena/01a0c215-ledgr-react`
Product source baseline: `2e0ede303634d753710357077823eeafb9ecfb7d` (uncommitted harness changes described below).

**Decision summary:** A repeatable, local-only evidence harness exists and intentionally returns nonzero: **106 PASS / 7 FAIL / 41 BLOCKED / 0 NOT APPLICABLE**, 154 evidence records. Two simultaneous runs after a clean dependency installation, and a subsequent full `verify` run, produced identical complete outcome arrays. This is **not R13 completion, production verification, or release approval**. Twelve legacy suites remain unported; core platform/ACL/branch/offline evidence remains incomplete. CI checks are configured but not remotely run; the independently triggered deployment workflow is unchanged and has no newly enforced dependency on this check. No product defect was fixed.

## 1. Objective and authorized scope

R00 was reviewed and accepted. Implement **R13 only**: preserve a pre-remediation baseline and enable the same tests to run after separately authorized remediation. Use existing tools/scenarios, deterministic synthetic fixtures, actual database roles where possible, and explicit layer/status labels. Do not repair R01–R12/R14–R15 defects, alter customer records, weaken permissions, deploy, or start production verification.

The accepted register identifies portability of existing database suites, clean replay, actual-role security/posting, collision isolation, negative gates, and effective privilege assumptions. This implementation advances those goals but does **not** meet all of them. Selected scenarios were reused rather than all twelve standalone scripts ported. Replay is PostgreSQL with explicitly substituted platform extensions, not a full Supabase deployment. Effective deployed ACLs are unknown. Branch assignment, real Auth and successful offline readback remain blocked. The new fixture paths implement the harness authorized in the current request; no proposed application schema was introduced.

## 2. Existing infrastructure inspected before changes

Inspection and an initial infrastructure report preceded creation of this harness. The initial root regression baseline was **76 files / 656 passing tests**.

- Root React/TypeScript application, existing Vitest **5.0.1**, `vitest.config.ts` including only `src/**/*.test.ts(x)`, existing fake-indexeddb, jsdom, TypeScript and ESLint. Root discovery/configuration was left unchanged.
- Twelve `tests/database/*.test.js` standalone scripts: useful RLS, storage, view, RPC, POS, quick-save, posting, workflow-accounting, repair/integrity and PAYE cases, but undeclared database tooling, CommonJS/ESM mismatches and differing fixed/shared bootstrap/replay assumptions. Some install broad privileges. Their old bootstraps were **not executed** or silently treated as passing.
- Existing 85 ordered SQL migrations, Edge handlers and `supabase/config.toml`; actual source functions retained unchanged.
- Existing offline queue/Dexie database, `syncEngine`, `posService` and their unit tests; existing billing capability/catalogue logic and accounting/POS regression scenarios.
- Existing CI, separate deployment workflow and optional load tooling. No existing isolated Auth/Storage/Deno/browser-worker stack or verified staging target was established. No load test or remote workflow was invoked.
- Four preexisting untracked audit documents were user work and left untouched; section 5 identifies them separately.

## 3. Infrastructure and scenarios reused

Same Vitest framework, fake-indexeddb/jsdom, TypeScript compiler and lint configuration; no second test framework. The original 656 unit tests still execute separately and pass. Scenario/oracle reuse includes `rls_security`, `pos_sale_rpc`, `quick_save_rpc_source_uuid`, `workflow_accounting`, `posting_integrity_migrations`, `view_reconstruction` and `storage_reconstruction` concepts, with an owned disposable database and actual caller-role probes instead of the old privileged/fixed-path setup.

The harness invokes unchanged `post_pos_sale`, `save_quick_sale`, `save_quick_expense`, `ai_context` and `apply_subscription_payment` implementations; real product migrations supply RLS/functions/triggers. The offline adapter uses the unchanged queue/POS/sync code. The Edge adapter transpiles and invokes unchanged handler sources in a local Node VM with deliberately mocked Auth, database clients, provider and platform. These adapters are not Deno, PostgREST, Supabase Auth or a browser substitute.

## 4. New infrastructure created

- Owned embedded PostgreSQL **17.10** with SCRAM, generated per-run password, loopback-only listener, dynamically allocated port, private temporary directory and ownership nonce. Each database/offline suite gets its own database. No URL or existing database is accepted.
- Synthetic Auth/Storage schemas and roles, real pgcrypto/pg_trgm, inert cron metadata and an explicitly disabled network function. No blanket `public` table/default grants were added.
- Four release Vitest suites: database/financial/security; Edge handler contracts; IndexedDB/offline; harness safety. Outcomes are registered BLOCKED before execution, preventing setup omissions from becoming passes. Missing suite artifacts also block the gate.
- Controlled error sanitization and machine-readable JSON: status, expectation, actual observation, environment/layer, source, remediation owner, customer-data risk and production-verification requirement. Migration/harness SHA-256 manifests, source commit, Node and tool versions accompany each run.
- Reusable typed sale, non-POS income, expense, return/void-intent and entitlement fixtures. Return/void inputs match existing client APIs; no server approval/authorization schema was invented and those workflows remain blocked.
- Strict local runner and gate: FAIL exits **1**; BLOCKED-only, missing/empty/unknown-status/NA-only evidence exits **2**; only an all-allowed nonempty PASS set can exit **0**. Framework skips used to represent blockers are never aggregate PASS.
- `test:release`, separate harness typecheck, expanded local `verify`, and an isolated CI evidence job. Only sanitized aggregate JSON is uploaded (7-day retention), including failing runs. No `continue-on-error` or expected-failure masking.

## 5. Exact files created and modified

### Created by R13 (17 files)

| File | Purpose |
|---|---|
| `tests/release/bootstrap.sql` | Disposable synthetic platform schemas/roles/extensions only |
| `tests/release/database.mjs` | Owned PG lifecycle, migration replay, actual-role and rollback helpers |
| `tests/release/database.test.ts` | Replay/RLS/roles/AI/POS/accounting/subscription probes |
| `tests/release/edge-catalog.ts` | 26 explicit handler classifications |
| `tests/release/edge-loader.mjs` | Unchanged handler VM adapter with no external network fallback |
| `tests/release/edge.test.ts` | Handler credential, scope, privilege and authority cases |
| `tests/release/evidence.ts` | Pre-registered sanitized outcome records |
| `tests/release/fixtures.ts` | Synthetic identities, organizations, financial/POS/entitlement/correction inputs |
| `tests/release/gate.mjs` | Strict status exit rules and expected-suite manifest |
| `tests/release/offline.test.ts` | Fake IndexedDB + real queue/sync + actual-role PG transport |
| `tests/release/run.mjs` | Local-only runner, evidence aggregation, manifests and legacy blockers |
| `tests/release/safety.mjs` | Environment refusal and positively owned cleanup |
| `tests/release/safety.test.ts` | Nine gate/discovery/redaction/cleanup/isolation guards |
| `tests/release/setup.ts` | Synthetic frontend configuration and denied global fetch |
| `tests/release/tsconfig.json` | Harness-only typecheck extending existing compiler settings |
| `tests/release/vitest.config.ts` | Isolated release discovery using existing Vitest |
| `docs/audits/LEDGR_R13_REPRODUCIBLE_RELEASE_TEST_HARNESS_2026-09-21.md` | This required report and durable result inventory |

### Modified by R13 (4 files)

| File | Exact change class |
|---|---|
| `.github/workflows/ci.yml` | Append isolated `release-evidence` job; no deployment environment or secrets |
| `.gitignore` | Ignore `.cache/` test evidence |
| `package.json` | Add two exact dev dependencies, two release scripts and strict release steps in `verify` |
| `package-lock.json` | Lock test dependencies; 340 inserted lines, zero deletions; 24 new package records |

Added dev-only packages: `embedded-postgres@17.10.0-beta.17`, `pg@8.23.0`. This declares the tooling already assumed by legacy standalone tests. **Every original non-root lock package record is byte-equivalent as parsed JSON; no existing dependency version was upgraded.** Existing unrelated lock metadata was preserved. No runtime dependency was added. Platform native binaries and generated build/evidence artifacts are not versioned.

**Application source changes: none. Product SQL migration/schema/policy/function changes: none.** Also unchanged: root `vitest.config.ts`, existing source tests, all twelve old database scripts, `server/`, `supabase/config.toml`, `.github/workflows/deploy.yml`, customer configuration and the four preexisting audit documents below. These documents are not R13-created files despite remaining untracked:

- `docs/audits/LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md`
- `docs/audits/LEDGR_PRODUCTION_READINESS_PLAN_2026-09-21.md`
- `docs/audits/LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md`
- `docs/audits/LEDGR_R00_DEPLOYMENT_EXPOSURE_BASELINE_2026-09-21.md`

The first three match the SHA-256 values recorded before this work. The R00 document was not written by R13; its final hash is recorded below without claiming an unavailable earlier hash comparison.

## 6. Database changes and replay profile

**No production/staging or repository product-schema change.** Local fixture DDL creates synthetic `auth`, `storage`, `cron`, `net` and database roles inside an owned, empty disposable database. Product `public` schema comes from replaying **all 85 current source migrations in filename order**. Source-file equality is checked dynamically; no hardcoded migration count permits silently skipping a new migration.

Only installation statements for **pg_cron** and **pg_net** are substituted in memory. Cron job definitions are recorded but never scheduled. `net.http_post` raises instead of performing network I/O. Original migration files are not edited. Auth UID/role values are supplied as transaction-local claims and SQL runs under actual `anon`, `authenticated` or `service_role`; null UID is explicitly distinguished between anon and service. This proves PostgreSQL role/RLS behavior under the named profile, **not full clean Supabase replay or live grants**.

Setup/observer access is privileged and separate from the application mutation under test. Tests may reset role only to observe stored totals/results after an actual-role command. Normal probes rollback; offline `commitAsRole` commits only into its synthetic owned database so replay can be tested. Service activation is a separately labeled service-only test, never an application-user shortcut.

The minimal Storage API table privileges in the synthetic platform are explicit. No public-table grant-all defaults, security-definer replacements, fake successful hydration or RLS bypass were introduced to get a green result. Missing effective profile/membership/invoice/line grants and Storage policy prerequisites remain BLOCKED.

## 7. Environment requirements and target verification

Executed environment: local Linux x64, non-root user, Node **22.22.3**, npm locked install, Vitest **5.0.1**, `pg` **8.23.0**, embedded PostgreSQL package **17.10.0-beta.17** / server **17.10**. PostgreSQL native symlink hydration is necessary after installing with scripts disabled. Other operating systems/architectures have not been validated; do not infer portability from the package's optional binaries.

No Docker, external PostgreSQL, hosted Supabase, real Auth service, provider API, production data or credentials is required. Dependency installation uses the package registry, not an application deployment target. There was no established staging environment; a name such as “staging” is not proof of safety and is refused by this runner.

Before creating a database the runner rejects non-local `LEDGR_TEST_ENV`, any arguments and ambient `DATABASE_URL`, PG connection variables or R13 remote URLs. It passes a minimal child environment, not ambient application credentials. The database helper takes no remote target and verifies its actual data directory. Only `.env.example` was present at repository root during final validation. VM handlers use synthetic values; outbound fetch is denied or replaced by a controlled provider adapter.

Both explicit production-labelled and external-URL refusal checks returned **2 before any connection or fixture creation**. A root user is rejected instead of creating a host user. Do not try to make this harness connect to a customer database.

## 8. Synthetic identities, organizations and fixtures

- Two organizations **A/B**, 14 synthetic identities: each has `owner`, `admin`, `accountant`, `viewer`, `cashier`, `stock_clerk`, `branch_manager`. Emails use `example.invalid`; user IDs and durable client keys use deterministic test UUID namespaces. Organization/document IDs generated by PostgreSQL are unique within each disposable run, not customer IDs.
- Branches **A1/A2/B1/B2**, organization-private customer, tracked product, branch-linked stock location, Storage logo metadata and one open cashier shift per organization. There is no invented user-branch assignment table; restricted-branch enforcement remains blocked.
- Fixed financial date **2026-09-21**, MWK, opening stock **100 units at 900**, one-unit sale **1,500**, expected ending stock **99**, expected COGS **900**, gross profit **600**. Opening till cash is **50,000**; transaction-only ledger net cash is distinct from till opening cash.
- Cash operating expense **200** plus sale yields expected ledger net profit **400** and transaction cash **1,300**. Actual-role sale + expense ledger test meets those totals. Non-POS quick income has no shift/till inputs and posts a balanced invoice and stock movement. This does not prove every non-POS workflow or UI report.
- Typed full-return/void inputs reference the original sale; intended refund **1,500**, stock restoration **1 unit**, original cost restoration **900**, net sale after full reversal **0**. They are reusable inputs/oracles, **not successful refund/void/reversal evidence**. Existing client approval-name fields are explicitly not treated as authorization.
- Catalogue fixtures: free, starter, growth, pro, enterprise, expired. Catalogue limits **50/200/500/2,000/unlimited** and free/pro AI flags are asserted as client catalogue evidence only. Each organization also has one pending synthetic subscription payment; actual service-only activation and replay preserve legitimate growth entitlement. Authenticated self-activation is separately denied. Full server quotas, grace/cancellation/change/reset behavior are not thereby verified.
- Offline cases create multiple sales and pending/failed/synced/stale-claim/conflicting-timestamp states. Queue contents, IDs, timestamps, payload/branch information and client keys are compared across close/reopen and failure. The “synced” state fixture is not a claim that integration successfully synced it. Successful replay and duplicate-retry integration remain blocked by actual-role invoice/line readback grants.

## 9. Categories and enforcement-layer coverage

| Requested category | Evidence delivered | Explicit boundary |
|---|---|---|
| Authentication | Missing/invalid handler credentials, authenticated own-organization AI request; distinct real SQL anon/authenticated/service roles | Real valid/invalid login, session expiry and logout revocation BLOCKED: no isolated Auth service |
| Bidirectional tenant isolation | A→B/B→A contact read/write/delete, POS command and AI database/handler scope probes with own-org positive controls | Not an exhaustive table/record matrix; Storage own-object prerequisite BLOCKED |
| Roles/front-end bypass | Seven role fixtures, contact writer matrix, actual direct RPC calls, handler viewer denials | Cashier write and AI restrictions fail their baseline assertions; detailed approved role matrix still needed |
| Branches | A1/A2 and B1/B2 fixture data; eight explicit read/create/modify/report/inventory/customer/finance/broad-role blockers | No durable approved assignment contract; UI filters never counted as enforcement |
| Privileged actions | Handler credential probes, recovery foreign-identity probe, subscription role deny/service allow | Real identity proof/invite lifecycle, effective profile/membership grants and branch-management authority incomplete |
| AI | Normal owner request through mocked provider; both forged-tenant directions denied; actual `ai_context` role probes | Anonymous and cashier calls fail deny expectations; branch/field permissions BLOCKED; no live model/provider |
| Critical Edge functions | 26 classifications, 52 missing/invalid credential invocations, targeted authority tests | Actual unchanged handler logic, mocked platform; not Deno/JWT gateway/provider evidence |
| Finance | Actual income, expense, invoice/payment, balanced journals, COGS and ledger net profit/cash; expected formula/correction fixtures | Inventory decrement fails; reversal, complete report/UI/branch integration not verified |
| POS | Sale, payment, idempotency, customer, branch/shift-linked fixtures and cross-tenant command denial | Stock result fails; refund/void/approval/whole shift lifecycle incomplete |
| Subscription | Catalogue/state fixtures, privilege denial, actual service activation/replay | Client catalogue != server entitlement/quota; quota/reset/grace and provider lifecycle incomplete |
| Offline | Real queue/sync code, fake IndexedDB persistence/failure preservation and real-role DB transport | Successful readback/reopen replay/retry BLOCKED; actor/conflict/multitab/browser contracts unavailable |
| DB/RLS/replay | 85 migrations, real SQL role switching, deny/allow and balanced posting checks | Synthetic Auth/Storage and disabled platform extensions; missing effective grants never bypassed |

### Critical handler catalogue

Public/auth/role/org/server/webhook classifications are test contracts, not proof that all checks are effective. A disabled gateway JWT check alone is **not** treated as a vulnerability. Each restricted handler receives valid-shaped input with missing/invalid credentials; exact expected denial is asserted. The public invoice pixel is expected to remain inert and return 200 for an invalid identifier. Details below:

| Handler | Classification | Owning package |
|---|---|---|
| `accept-invite-link` | authenticated | R02 |
| `ai-chat` | organisation-restricted | R11 |
| `api` | webhook/service-to-service | R12 |
| `cancel-account-deletion` | authenticated | R14 |
| `create-api-key` | role-restricted | R12 |
| `create-invite-link` | role-restricted | R02 |
| `expire-subscriptions` | server-only | R10 |
| `export-my-data` | authenticated | R14 |
| `finalize-account-deletions` | server-only | R14 |
| `generate-partner-invoices` | server-only | R14 |
| `generate-vat-returns` | server-only | R14 |
| `grant-manual-subscription` | role-restricted | R10 |
| `initiate-subscription-payment` | role-restricted | R10 |
| `invite-team-member` | role-restricted | R02 |
| `invoice-open` | public/anonymous by design | R14 |
| `list-team-members` | organisation-restricted | R04 |
| `paychangu-webhook` | webhook/service-to-service | R10 |
| `process-invoice-automation` | server-only | R14 |
| `request-account-deletion` | authenticated | R14 |
| `retry-failed-webhooks` | server-only | R12 |
| `send-invoice` | organisation-restricted | R04 |
| `send-renewal-reminders` | server-only | R14 |
| `suggest-bank-matches` | authenticated | R11 |
| `support-agent` | authenticated | R11 |
| `verify-subscription-payment` | organisation-restricted | R10 |
| `webhook-dispatcher` | organisation-restricted | R12 |

## 10. Reproducible commands and CI integration

Run only in a reviewed **local, disposable development/CI checkout**, as a non-root user. No `supabase db reset`, deployment command, real credential or remote database URL is used.

```sh
npm ci --ignore-scripts --no-audit --no-fund
# Linux x64 environment exercised here and used by the configured Ubuntu job:
npm rebuild @embedded-postgres/linux-x64
npm run test:release:types
npm run test:release
```

The explicit rebuild hydrates inspected native package symlinks; it does not install an external database service. First install attempts without hydration exposed a missing `libpq.so.5`; this was a tooling prerequisite, not an application finding. No existing dependencies were upgraded to resolve it.

Regression/static validation commands:

```sh
npm run typecheck
npm run lint
for f in tests/release/*.mjs; do node --check "$f"; done
npm test
npm run test:release:types
npm run test:release
git diff --check
```

For full local verification/build without ambient application credentials (the exact synthetic frontend values are not secrets):

```sh
env -i PATH="$PATH" HOME="$HOME" NO_COLOR=1   VITE_SUPABASE_URL=https://r13.invalid   VITE_SUPABASE_ANON_KEY=r13-synthetic-public-key npm run verify

# verify stops at the known red release gate; validate build separately:
env -i PATH="$PATH" HOME="$HOME" NO_COLOR=1   VITE_SUPABASE_URL=https://r13.invalid   VITE_SUPABASE_ANON_KEY=r13-synthetic-public-key npm run build
```

Expected current `test:release` and `verify` exit: **1**, not a successful release. A blocked-only baseline would exit 2. Refusal checks, without connecting anywhere:

```sh
LEDGR_TEST_ENV=production npm run test:release
R13_DATABASE_URL=https://synthetic.invalid npm run test:release
```

Each normal run prints its unique sanitized `.cache/r13/ledgr-r13-*/evidence.json` path. Raw application/framework output is suppressed by the release runner, not uploaded. Local diagnostic logs/build artifacts are ignored. CI's separate Ubuntu/Node 22 `release-evidence` job performs locked install, native hydration, harness typecheck and the strict test gate, and always attempts sanitized artifact upload. It has no deployment environment or secrets and no failure suppression. **CI has not been dispatched in this work. Branch protection/required-check configuration is unverified.** The separate `Deploy` workflow is push/tag/manual-triggered and unchanged; adding this CI job alone does not establish a deployment interlock. This remains an R13 acceptance gap (and relates to R00/R12 release controls), not a production verification claim.

## 11. Execution results and failures

### Final validation

| Validation | Actual result |
|---|---|
| Fresh locked install with scripts disabled | PASS; 655 packages installed; existing package records unchanged |
| Inspected Linux PG symlink hydration | PASS |
| Root TypeScript check | PASS, including final `verify` |
| Harness TypeScript check | PASS, including final `verify` |
| ESLint | PASS exit 0; 0 errors, 1 preexisting unused-disable warning in `artifacts/database/fresh-database.generated.approx.ts` |
| Five new `.mjs` syntax checks | PASS |
| Root Vitest regression | PASS: 76 files / 656 tests, rerun in final `verify` after clean installation |
| Release run 1 | 106 PASS / 7 FAIL / 41 BLOCKED / 0 N/A; exit 1 |
| Concurrent release run 2 | Same counts, **all 154 complete outcome objects identical**, distinct directories; exit 1 |
| Full `npm run verify` | Correctly exits 1 at release gate after typecheck/lint/root tests/release typecheck; same 154 outcome objects; **124.55 seconds** wall time |
| Separate production-mode build with synthetic frontend configuration | PASS; no deployment; existing large-chunk/PWA build notices |
| `git diff --check` | PASS |
| Production-label / external URL refusal | Both exit 2 before fixture creation/connection |
| Ownership cleanup | No remaining matching disposable PG processes or `/tmp/ledgr-r13-*` databases after normal runs |
| Workflow validation | Changed job manually reviewed; YAML parser attempts unavailable (`js-yaml`/PyYAML not installed); no new parser dependency installed and no hosted CI run claimed |

Existing install deprecation notices and Vite native-config/large-chunk warnings were not “fixed” by unrelated upgrades or refactors. `verify` does not reach build after the red gate; build was independently run and is not claimed as a stage reached by `verify`. CPU/peak memory were not profiled. Runner limits include a 240-second child timeout and 8-MiB framework-output buffer; they are guards, not a load/performance benchmark.

Final independent evidence files:

- `.cache/r13/ledgr-r13-c7vMfF/evidence.json`
- `.cache/r13/ledgr-r13-PseVED/evidence.json`
- `.cache/r13/ledgr-r13-idAM1T/evidence.json` (full verify)

These local ignored artifacts can be removed and are not relied upon as the sole durable result record: every current result ID/expectation is preserved in this report, with full failure/block metadata below. CI is configured to retain only sanitized JSON for seven days. 142 registered release cases plus twelve explicitly unexecuted legacy-suite records produce the 154 aggregate records; 29 registered cases are BLOCKED, not successful skips.

### Seven failing local checks — not seven established deployed exploits

| ID | Local finding | Owning package | Customer risk if present in deployed behavior |
|---|---|---|---|
| `AI.ANON` | Real SQL anon can call `ai_context` without the required denial | R03 | Unauthorized AI-context access; complete returned-record exposure not quantified |
| `AI.ROLE` | Real SQL cashier can call `ai_context` without the baseline role denial | R11 (related R03) | Frontend AI-role restriction can be bypassed at this RPC layer |
| `ROLE.cashier.write` | Real SQL cashier contact creation succeeds against the least-privilege deny oracle | R04 | Potential unauthorized master-data mutation; the detailed cashier/customer-creation contract needs explicit review before calling this a confirmed vulnerability |
| `POS.STOCK` | Stock remains **100**, expected **99**, after the one-unit sale | R06 | Stock/valuation divergence; no customer reconciliation or historical change attempted |
| `EDGE.RECOVERY.foreign-identity` | A-owner recovery/invitation request targeting synthetic B phone identity invokes Auth Admin password update **once**, expected **zero** | R02 | Potential cross-identity credential takeover; mocked Auth Admin only, no real reset |
| `EDGE.RETRY.no-secret` | Empty header with both cron secrets absent returns **200**, expected **401** | R12/R14 | Unauthorized background action under that configuration; no real cron/webhook traffic |
| `EDGE.WEBHOOK.viewer` | Synthetic viewer submits authoritative `invoice.paid` event and gets **200**, expected **403** | R12 | Forged authoritative outbound event; mocked database/platform, no real webhook sent |

The cashier deny oracle and other role expectations are explicit reviewable security assertions, not a substitute for the detailed approved role/branch contract. No assertion was relaxed to make a defect pass. Earlier setup mistakes (required contact fields, missing synthetic handler APP_URL, a handler's correct 401 vs a wrongly expected 400, Vite asset rewriting, non-authorized actor in a finance fixture) were corrected in the **harness only** and are not counted as product defects. Successful offline sync was initially investigated, but its missing readback adapter/effective grants are now explicitly BLOCKED rather than misreported as a product failure or a privileged/fake success.

### Full failed-record metadata

All records have `environment=local`, `customerDataTouched=false`; the exact source and enforcement-layer strings below come from final evidence. “Production verification required” means **later and separately authorized**, not permission to execute it now.

#### `AI.ANON` — FAIL

- **Expected:** Null-UID anon cannot obtain business AI context
- **Actual:** Forbidden operation completed without permission denial.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260823000003_repair_ai_view_tenant_scope.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R03
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `AI.ROLE` — FAIL

- **Expected:** Cashier cannot retrieve unrestricted business financial context
- **Actual:** Forbidden operation completed without permission denial.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260823000003_repair_ai_view_tenant_scope.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R11
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `EDGE.RECOVERY.foreign-identity` — FAIL

- **Expected:** An Org A owner cannot reset a global Org B phone identity without recovery authority
- **Actual:** Observed 1; expected 0.
- **Environment/layer:** local — unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway
- **File/function/policy reference:** `supabase/functions/invite-team-member/index.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R02
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `EDGE.RETRY.no-secret` — FAIL

- **Expected:** Absent job configuration must reject even explicitly empty secret header
- **Actual:** Observed 200; expected 401.
- **Environment/layer:** local — unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway
- **File/function/policy reference:** `supabase/functions/retry-failed-webhooks/index.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R12/R14
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `EDGE.WEBHOOK.viewer` — FAIL

- **Expected:** Viewer cannot emit authoritative arbitrary financial event payload
- **Actual:** Observed 200; expected 403.
- **Environment/layer:** local — unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway
- **File/function/policy reference:** `supabase/functions/webhook-dispatcher/index.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R12
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `POS.STOCK` — FAIL

- **Expected:** Sale reduces actual balance 100 → 99 (not merely movement insertion)
- **Actual:** Observed 100; expected 99.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260923000000_post_pos_sale_rpc.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R06
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `ROLE.cashier.write` — FAIL

- **Expected:** cashier: permitted/denied contact creation at database boundary
- **Actual:** Forbidden operation completed without permission denial.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

### All passing record IDs and assertions

PASS means only the stated assertion in its recorded local layer. Common actual observation: “Expected assertion observed in the labeled local layer.” This inventory does not promote static/catalogue/mock tests to deployed enforcement evidence.

| ID | Expected assertion observed | Layer | Owner |
|---|---|---|---|
| `BILLING.ACTIVATION` | Authenticated user cannot call service-only subscription activation | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `BILLING.CAPABILITIES` | Local catalogue limits 50/200/500/2000/unlimited; AI insights not free but pro enabled | client catalogue only, NOT server entitlement | R10 |
| `BILLING.FIXTURE.enterprise` | Synthetic enterprise state can be represented without client privilege grants | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `BILLING.FIXTURE.expired` | Synthetic expired state can be represented without client privilege grants | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `BILLING.FIXTURE.free` | Synthetic free state can be represented without client privilege grants | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `BILLING.FIXTURE.growth` | Synthetic growth state can be represented without client privilege grants | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `BILLING.FIXTURE.pro` | Synthetic pro state can be represented without client privilege grants | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `BILLING.FIXTURE.starter` | Synthetic starter state can be represented without client privilege grants | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `BILLING.SERVICE-ACTIVATION` | Service-only activation resolves synthetic payment once and preserves legitimate growth entitlement on replay | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R10 |
| `DB.ANON-SERVICE-DISTINCT` | Null UID does not conflate anon and service_role identities | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R13 |
| `DB.FIXTURE` | Two organisations, fourteen role identities, four branches, stock and shifts seed | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R13 |
| `DB.NONOWNER-ROLE` | RLS probes use non-superuser/non-bypass application roles | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R13 |
| `DB.REPLAY` | All source migrations replay with ONLY declared pg_cron/pg_net installation substitutions | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R13 |
| `EDGE.accept-invite-link.invalid` | authenticated: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R02 |
| `EDGE.accept-invite-link.missing` | authenticated: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R02 |
| `EDGE.ai-chat.invalid` | organisation-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.ai-chat.missing` | organisation-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.AI.A-to-B` | A valid caller cannot select a foreign business even with forged frontend context | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.AI.B-to-A` | A valid caller cannot select a foreign business even with forged frontend context | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.AI.owner-normal` | Valid owner request builds own business context and returns provider response through isolated provider adapter | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.api.invalid` | webhook/service-to-service: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `EDGE.api.missing` | webhook/service-to-service: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `EDGE.cancel-account-deletion.invalid` | authenticated: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.cancel-account-deletion.missing` | authenticated: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.CATALOG` | All 26 source handlers classified | edge-handler-mocked-platform | R13 |
| `EDGE.create-api-key.invalid` | role-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `EDGE.create-api-key.missing` | role-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `EDGE.create-invite-link.invalid` | role-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R02 |
| `EDGE.create-invite-link.missing` | role-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R02 |
| `EDGE.expire-subscriptions.invalid` | server-only: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.expire-subscriptions.missing` | server-only: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.export-my-data.invalid` | authenticated: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.export-my-data.missing` | authenticated: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.finalize-account-deletions.invalid` | server-only: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.finalize-account-deletions.missing` | server-only: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.generate-partner-invoices.invalid` | server-only: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.generate-partner-invoices.missing` | server-only: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.generate-vat-returns.invalid` | server-only: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.generate-vat-returns.missing` | server-only: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.grant-manual-subscription.invalid` | role-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.grant-manual-subscription.missing` | role-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.initiate-subscription-payment.invalid` | role-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.initiate-subscription-payment.missing` | role-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.invite-team-member.invalid` | role-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R02 |
| `EDGE.invite-team-member.missing` | role-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R02 |
| `EDGE.invoice-open.invalid` | public/anonymous by design: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.invoice-open.missing` | public/anonymous by design: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.list-team-members.invalid` | organisation-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R04 |
| `EDGE.list-team-members.missing` | organisation-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R04 |
| `EDGE.MANUAL-GRANT.viewer` | Authenticated non-platform-admin is denied manual subscription grant | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R01 |
| `EDGE.paychangu-webhook.invalid` | webhook/service-to-service: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.paychangu-webhook.missing` | webhook/service-to-service: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.process-invoice-automation.invalid` | server-only: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.process-invoice-automation.missing` | server-only: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.request-account-deletion.invalid` | authenticated: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.request-account-deletion.missing` | authenticated: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.retry-failed-webhooks.invalid` | server-only: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `EDGE.retry-failed-webhooks.missing` | server-only: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `EDGE.send-invoice.invalid` | organisation-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R04 |
| `EDGE.send-invoice.missing` | organisation-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R04 |
| `EDGE.send-renewal-reminders.invalid` | server-only: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.send-renewal-reminders.missing` | server-only: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R14 |
| `EDGE.suggest-bank-matches.invalid` | authenticated: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.suggest-bank-matches.missing` | authenticated: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.support-agent.invalid` | authenticated: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.support-agent.missing` | authenticated: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R11 |
| `EDGE.verify-subscription-payment.invalid` | organisation-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.verify-subscription-payment.missing` | organisation-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R10 |
| `EDGE.webhook-dispatcher.invalid` | organisation-restricted: reject invalid credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `EDGE.webhook-dispatcher.missing` | organisation-restricted: reject missing credential before privileged business data/effects; public pixel stays inert | unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway | R12 |
| `FINANCE.NONPOS-INCOME` | Quick income posts a balanced document and stock movement without POS shift/till inputs | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R05/R06 |
| `FINANCE.ORACLE` | Deterministic fixture: 1500 sale − 900 COGS − 200 expense = 400 profit; cash 1300 | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R05 |
| `FINANCE.POSTING-TOTALS` | Sale 1500, COGS 900 and expense 200 yield ledger profit 400 and cash 1300 | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R05/R06 |
| `HARNESS.CLEANUP` | Only a generated direct child with matching owner marker can be removed | local harness self-test | R13 |
| `HARNESS.DISCOVERY` | Every release suite has an expected evidence artifact | local harness self-test | R13 |
| `HARNESS.GATE` | A FAIL/blocked/missing/unknown/not-applicable-only result never gives green exit | local harness self-test | R13 |
| `HARNESS.LOCAL` | Empty configuration is local only | local harness self-test | R13 |
| `HARNESS.REDACTION` | Unexpected error payloads are omitted; only SQLSTATE/numeric observations retained | local harness self-test | R13 |
| `HARNESS.REFUSE.production` | No remote target is accepted even if named test/staging | local harness self-test | R13 |
| `HARNESS.REFUSE.staging` | No remote target is accepted even if named test/staging | local harness self-test | R13 |
| `HARNESS.REFUSE.test` | No remote target is accepted even if named test/staging | local harness self-test | R13 |
| `HARNESS.REFUSE.URL` | External database URL/host and extra command arguments refused | local harness self-test | R13 |
| `OFFLINE.CROSS-TENANT-PRESERVE` | A session cannot sync B sale; B pending/failed payload is retained | fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway | R09 |
| `OFFLINE.FAIL-PRESERVE` | Denied sync preserves sole local record, payload, branch, timestamps and client key | fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway | R09 |
| `OFFLINE.PRESERVE` | Pending synthetic sale survives close/reopen with exact identifiers/timestamps/branch/payload | fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway | R09 |
| `OFFLINE.STALE-CLAIM` | Stale syncing item returns to pending without losing metadata | fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway | R09 |
| `OFFLINE.STATES` | Reusable pending/failed/synced/conflicting timestamp fixtures preserve payloads | fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway | R09 |
| `POS.DENY.stock_clerk` | stock_clerk cannot invoke sale directly | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R06 |
| `POS.DENY.viewer` | viewer cannot invoke sale directly | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R06 |
| `POS.SALE` | Cashier sale posts invoice/payment/balanced ledger and stable replay key | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R05/R06 |
| `ROLE.accountant.write` | accountant: permitted/denied contact creation at database boundary | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `ROLE.admin.write` | admin: permitted/denied contact creation at database boundary | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `ROLE.branch_manager.write` | branch_manager: permitted/denied contact creation at database boundary | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `ROLE.owner.write` | owner: permitted/denied contact creation at database boundary | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `ROLE.stock_clerk.write` | stock_clerk: permitted/denied contact creation at database boundary | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `ROLE.viewer.write` | viewer: permitted/denied contact creation at database boundary | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `TENANT.A.ai` | Own AI context available; foreign business RPC denied | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R03 |
| `TENANT.A.delete` | Org A can read own contact but cannot delete Org B contact | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `TENANT.A.pos` | Foreign business sale RPC denied | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R06 |
| `TENANT.A.read` | Org A can read own contact but cannot read Org B contact | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `TENANT.A.update` | Org A can read own contact but cannot update Org B contact | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `TENANT.B.ai` | Own AI context available; foreign business RPC denied | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R03 |
| `TENANT.B.delete` | Org B can read own contact but cannot delete Org A contact | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `TENANT.B.pos` | Foreign business sale RPC denied | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R06 |
| `TENANT.B.read` | Org B can read own contact but cannot read Org A contact | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |
| `TENANT.B.update` | Org B can read own contact but cannot update Org A contact | real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL | R04 |

## 12. Blocked tests and exact prerequisites (41)

These are **not failures of customer production data and not PASS**. Twelve are R13 portability debt; the remainder depend on effective platform grants, unavailable isolated services or unapproved application contracts. An environmental denial without a successful own-scope/benign positive control is not reported as successful security containment.

Customer impact of missing evidence: Auth/privilege/tenant/branch/AI gaps leave access boundaries unverified; finance/POS gaps leave correction/stock integrity unverified; billing gaps leave quota/entitlement enforcement unverified; offline gaps leave successful exactly-once synchronization and originating-actor/conflict/browser behavior unverified. The legacy-suite gaps reduce release assurance without themselves touching records. Each exact record is below.

#### `AI.BRANCH` — BLOCKED

- **Expected:** Durable branch assignment and field-permission contract require design approval.
- **Actual:** Durable branch assignment and field-permission contract require design approval.
- **Environment/layer:** local — unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway
- **File/function/policy reference:** `supabase/functions/ai-chat/index.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R11
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `AUTH.expired-session` — BLOCKED

- **Expected:** Real Auth service validates login/expiry/session revocation with synthetic identities
- **Actual:** No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence.
- **Environment/layer:** local — Supabase Auth platform (unavailable)
- **File/function/policy reference:** `src/lib/supabase.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R01/R02
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `AUTH.invalid-login` — BLOCKED

- **Expected:** Real Auth service validates login/expiry/session revocation with synthetic identities
- **Actual:** No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence.
- **Environment/layer:** local — Supabase Auth platform (unavailable)
- **File/function/policy reference:** `src/lib/supabase.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R01/R02
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `AUTH.logout-revocation` — BLOCKED

- **Expected:** Real Auth service validates login/expiry/session revocation with synthetic identities
- **Actual:** No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence.
- **Environment/layer:** local — Supabase Auth platform (unavailable)
- **File/function/policy reference:** `src/lib/supabase.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R01/R02
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `AUTH.valid-login` — BLOCKED

- **Expected:** Real Auth service validates login/expiry/session revocation with synthetic identities
- **Actual:** No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence.
- **Environment/layer:** local — Supabase Auth platform (unavailable)
- **File/function/policy reference:** `src/lib/supabase.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R01/R02
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BILLING.SERVER-QUOTA` — BLOCKED

- **Expected:** Concurrent expired/quota requests denied server-side
- **Actual:** Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R10
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.create` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 create; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.cross-branch-admin` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 cross-branch-admin; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.customers` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 customers; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.financial` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 financial; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.inventory` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 inventory; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.modify` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 modify; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.read` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 read; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `BRANCH.reports` — BLOCKED

- **Expected:** Assigned A1-only user cannot access A2 reports; explicit all-branch role retains legitimate access
- **Actual:** A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04/R08
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `FINANCE.REVERSAL` — BLOCKED

- **Expected:** Approved immutable correction/reversal preserves history
- **Actual:** Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R05/R07
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `LEGACY.paye_reference.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/paye_reference.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.phase10_2_subtype_repair.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/phase10_2_subtype_repair.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.phase10_integrity.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/phase10_integrity.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.phase10_remediation.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/phase10_remediation.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.pos_sale_rpc.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/pos_sale_rpc.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.posting_integrity_migrations.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/posting_integrity_migrations.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.quick_save_rpc_source_uuid.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/quick_save_rpc_source_uuid.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.rls_security.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/rls_security.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.rpc_reconstruction.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/rpc_reconstruction.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.storage_reconstruction.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/storage_reconstruction.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.view_reconstruction.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/view_reconstruction.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `LEGACY.workflow_accounting.test.js` — BLOCKED

- **Expected:** Original standalone suite executes portably without broad grants or shared cleanup
- **Actual:** Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.
- **Environment/layer:** local — not executed
- **File/function/policy reference:** `tests/database/workflow_accounting.test.js`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R13
- **Customer data touched:** no. **Customer data could be affected if deployed:** no direct data operation; missing harness assurance.
- **Production verification required:** no for this local tooling requirement.

#### `OFFLINE.ACTOR-BINDING` — BLOCKED

- **Expected:** Queue has businessId but no durable originating-user/device contract; cannot assert current-user queue isolation by inventing fields.
- **Actual:** Queue has businessId but no durable originating-user/device contract; cannot assert current-user queue isolation by inventing fields.
- **Environment/layer:** local — fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway
- **File/function/policy reference:** `src/offline/syncEngine.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R09
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `OFFLINE.BROWSER` — BLOCKED

- **Expected:** No browser/service-worker runner; fake IndexedDB close/reopen is not browser process shutdown/cache proof.
- **Actual:** No browser/service-worker runner; fake IndexedDB close/reopen is not browser process shutdown/cache proof.
- **Environment/layer:** local — fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway
- **File/function/policy reference:** `src/offline/syncEngine.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R09
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `OFFLINE.CONFLICT` — BLOCKED

- **Expected:** Timestamp fixtures exist; no approved conflict-resolution contract or generic queue update operation.
- **Actual:** Timestamp fixtures exist; no approved conflict-resolution contract or generic queue update operation.
- **Environment/layer:** local — fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway
- **File/function/policy reference:** `src/offline/syncEngine.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R09
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `OFFLINE.MULTITAB` — BLOCKED

- **Expected:** Cross-tab concurrency/lease evidence needs approved client-identity contract and browser workers.
- **Actual:** Cross-tab concurrency/lease evidence needs approved client-identity contract and browser workers.
- **Environment/layer:** local — fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway
- **File/function/policy reference:** `src/offline/syncEngine.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R09
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `OFFLINE.REOPEN` — BLOCKED

- **Expected:** Multiple pending sales survive close/reopen with IDs, timestamps, branch and keys; synchronize exactly once
- **Actual:** Post-sale caller readback lacks effective invoice/line SELECT grants in migration-only profile. No fake success or privileged read substituted.
- **Environment/layer:** local — fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway
- **File/function/policy reference:** `src/offline/syncEngine.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R09
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `OFFLINE.RETRY` — BLOCKED

- **Expected:** Failed synthetic sale retries with same key and exactly one server invoice
- **Actual:** Post-sale caller readback lacks effective invoice/line SELECT grants in migration-only profile. No fake success or privileged read substituted.
- **Environment/layer:** local — fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway
- **File/function/policy reference:** `src/offline/syncEngine.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R09
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `POS.REFUND` — BLOCKED

- **Expected:** Authorized refund has correct original-cost and tender reversal
- **Actual:** Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R07
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `POS.VOID` — BLOCKED

- **Expected:** Authorized void has exactly-once reversal effects
- **Actual:** Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R07
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `PRIV.INVITATION` — BLOCKED

- **Expected:** Real identity evidence, invitation lifecycle and profile-phone fallback need isolated Auth and DB integration.
- **Actual:** Real identity evidence, invitation lifecycle and profile-phone fallback need isolated Auth and DB integration.
- **Environment/layer:** local — unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway
- **File/function/policy reference:** `supabase/functions/accept-invite-link/index.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R02
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `PRIV.MEMBERSHIP` — BLOCKED

- **Expected:** Viewer cannot promote own membership to owner
- **Actual:** Effective membership UPDATE grant not represented by migration-only ACL; no grant-all test bootstrap.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R01
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `PRIV.PROFILE` — BLOCKED

- **Expected:** Ordinary viewer cannot update own is_platform_admin
- **Actual:** Migration-only ACL lacks benign profile UPDATE; deployed column grants required. No synthetic grant added.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R01
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `PRIV.RECOVERY` — BLOCKED

- **Expected:** Global recovery authority and verified phone proof require isolated Auth Admin + approved recovery contract.
- **Actual:** Global recovery authority and verified phone proof require isolated Auth Admin + approved recovery contract.
- **Environment/layer:** local — unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway
- **File/function/policy reference:** `supabase/functions/invite-team-member/index.ts`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R02
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `TENANT.A.storage` — BLOCKED

- **Expected:** Own logo visible, foreign logo hidden by storage object RLS
- **Actual:** Own-logo positive control denied: storage policy depends on effective business_users SELECT grant absent from migration-only profile. No blanket grant added.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

#### `TENANT.B.storage` — BLOCKED

- **Expected:** Own logo visible, foreign logo hidden by storage object RLS
- **Actual:** Own-logo positive control denied: storage policy depends on effective business_users SELECT grant absent from migration-only profile. No blanket grant added.
- **Environment/layer:** local — real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL
- **File/function/policy reference:** `supabase/migrations/20260815000003_phase8b_rls_policies.sql`; inspect the named test ID for exact operation/policy assertions.
- **Owning remediation:** R04
- **Customer data touched:** no. **Customer data could be affected if deployed:** yes.
- **Production verification required:** yes, separately authorized only.

## 13. Limitations and register discrepancies

1. **Not complete R13:** twelve original standalone suites remain unported. Selected core cases and all current migrations are exercised, but PAYE/repair/reconstruction/history cases in those scripts are not equivalent to a fully portable legacy suite.
2. **Migration-only privilege profile:** no verified deployed table/column/default ACL snapshot. R01 profile/membership, Storage policy prerequisites and offline invoice/line readback cannot be judged from absent grants. Do not add broad grants simply to execute them.
3. **Platform substitution:** no actual Supabase Auth, Storage API, PostgREST/JWT gateway, Deno runtime, cron scheduler, network extension, provider or browser process/service worker. Node handler execution and SQL RLS execution are distinct layers and not end-to-end deployment proof.
4. **Branch/role/AI field contracts:** fixtures exist but detailed durable branch assignment/permissions are not invented. Eight branch cases plus AI branch scope remain explicit blockers. Existing role-function behavior is not a fully approved least-privilege matrix.
5. **Offline:** close/reopen persistence and failed-sync preservation pass. Successful multi-sale sync/retry is BLOCKED by caller readback privileges. Originating actor/device, approved conflict resolution and multi-tab/browser lifecycle remain unverified. Existing IndexedDB records were never migrated or deleted; the cleared/deleted test database exists only in fake-indexeddb memory.
6. **Accounting/POS:** deterministic income/expense and ledger totals pass; stock decrement fails. Report UI, complete branch reports, historical reconciliation, canonical reversal/refund/void authorization and full shift lifecycle remain incomplete. Reusable correction input/oracle fixtures are not posted corrections.
7. **Billing:** catalogue/state/service activation evidence is limited; authoritative server quotas, complete expiry/grace/change/cancellation/failed-payment/provider/replay lifecycle and reset scenarios remain incomplete. Paid customer access was not changed.
8. **Deployment gating:** source CI is configured red on FAIL/BLOCKED; separate Deploy workflow remains independent. Hosted action execution, branch protection and refusal of deployment on failed required checks have not been established. Do not infer deployment safety from this PR/working tree.
9. **Native portability/resources:** Linux x64/non-root exercised. Other systems and peak resource usage unverified. Rare ephemeral-port allocation races could produce a setup blocker, not permission to attach to an existing server; actual data-directory identity is checked. Forced termination/power loss is outside normal cleanup proof.
10. **Outcome sanitization:** arbitrary error messages/stacks/payloads are deliberately discarded. A generic safe assertion message can require local source inspection; it is not proof of a particular deployed exploit. The aggregate includes source/harness hashes to identify exactly what was tested.

## 14. Security controls and security impact

No auth/RLS policy, production grant, application validation, AI behavior, subscription behavior, offline production database or financial command was weakened or changed. No real service-role credential was used. Privileged fixture setup/observation is not counted as caller authorization; actual SQL role and claims are set for mutations, and service-only positives are labeled separately. No application-user probe is silently retried as administrator.

Local cleanup requires exact owned parent, `ledgr-r13-` child prefix and matching nonce; refusal tests cover unrelated paths/ownership. Passwords are random, never included in evidence; data directory and marker permissions are restrictive, DB logs/raw child output are suppressed, and aggregate JSON is mode 0600. Evidence sanitization tests exercise secret-bearing error redaction. No real secret values were found in the newly authored harness/diff; this is not a repository-wide credential audit or proof that deployed secrets are safe.

The harness performs no real provider payment, password reset, email, webhook delivery, account deletion or scheduled job. Synthetic handler environment values/headers are not credentials. The intentional insecure examples are unchanged product paths under test, not newly introduced bypasses. New CI/test failures are deliberate visibility into unresolved behavior and evidence, not authorization to ship by removing tests.

## 15. Customer-data protection

**Customer data accessed: none. Customer records changed/deleted: none. Customer IndexedDB accessed/migrated/deleted: none.** All organization, identity, contact, invoice, ledger, stock, subscription, file metadata and queued data are synthetic and confined to owned PostgreSQL/fake IndexedDB instances.

Accepted financial records were not deleted, re-dated, re-valued or silently “repaired.” No reconciliation or correction strategy was implemented. Failed queue tests preserve the sole pending/failed local record and original identifiers/payload; clearing fake IndexedDB between independent tests is not deletion from a customer's browser. Real historical values, sync queues, stock and paid entitlements remain untouched. Potential customer risks in section 11 are hypotheses/findings for owning-package review, not quantified live impact.

## 16. Production-access and evidence limitations

No production/staging login, query, Auth Admin operation, deployment, migration, secret/configuration change, GitHub environment/branch-protection modification or remote verification was performed. No remote target was substituted when local platform prerequisites were absent. The environment label on every record is local and every aggregate states `productionVerified=false`.

Effective deployed ACLs, live function exposure, historical balances, real data impact, actual JWT/session behavior, deployed scheduler secrets and branch protection remain unknown under this authorization. Any later verification needs its own explicit authorization and target confirmation. Repository source/migration evidence, local actual-role SQL, mocked-platform handler execution, fake IndexedDB and deployed/customer verification must remain separate.

## 17. Defect and prerequisite mapping to remediation packages

| Package | Evidence/required follow-up; no fix implemented here |
|---|---|
| R01 | Effective profile/membership privilege escalation probes blocked by missing matching grants; isolated Auth-session prerequisites |
| R02 | Foreign-identity recovery local failure; verified identity proof, invitation/recovery lifecycle and real Auth integration blocked |
| R03 | Anonymous `ai_context` denial failure; related RPC role/tenant boundary review |
| R04 | Cashier contact-write deny-oracle failure; tenant Storage prerequisites and detailed role/branch authority contract |
| R05 | Deterministic balanced income/expense/ledger cases pass; authoritative reversal/report coverage still incomplete |
| R06 | POS inventory balance 100 vs expected 99; non-POS stock movement and POS payment/idempotency controls retained |
| R07 | Refund/void/correction oracles exist; canonical authorization/reversal workflow blocked |
| R08 | Branch assignment/enforcement contract and eight branch cases blocked |
| R09 | Failure/persistence preservation passes; successful readback/replay, originating actor, conflicts and multitab/browser proof blocked |
| R10 | Service activation/replay and client catalogue tested; full server quota/expiry/paid-access/provider lifecycle not verified |
| R11 | Cashier direct AI context failure; branch/field scope contract blocked; normal/forged-org handler cases layer-limited |
| R12 | Viewer-authoritative webhook and missing-secret job failures; deployed caller/service/webhook/deployment-control verification outstanding |
| R13 | Twelve legacy suites unported; full platform/privilege parity and deploy-required-check interlock not complete; local harness now reproducible |
| R14 | Related retry-job secret/configuration boundary and other classified lifecycle/server handlers; no R14 work authorized |
| R15 | No implementation or production verification authorized/performed |

Specific assertions and exact source references are retained in sections 11–12. A blocked prerequisite is not automatically a product defect; the owning package must establish its approved contract/environment before deciding a fix. The seven failing checks must remain visible when remediation is later authorized.

## 18. Rollback, removal and evidence integrity

This work has no customer-data rollback or product DB down-migration. If harness/tooling is unacceptable, pause release and review the gate; do not drop failing security checks merely to ship. A last independently verified manual gate requires explicit sign-off, not an automatic fallback.

To remove R13 deliberately: remove only the 16 newly authored `tests/release/` files and this new report if authorized; reverse only the R13 hunks in the four modified tracked files; preserve all four preexisting audit documents and all unrelated user work. Restore dependency state with the resulting reviewed lockfile. Do not reset the whole repository or overwrite preexisting untracked files. No root config, application code or production schema rollback is needed.

Normal test teardown stops each owned PG process and removes only its nonce-verified directory. Local sanitized `.cache/r13/` evidence can be removed after retaining needed reports. If a process is forcibly killed, first identify its exact command/data directory and `.r13-owner` marker before any cleanup. **Never wildcard-delete temporary databases or invoke cleanup against an unknown environment.** This work's final normal-run check found no orphan matching databases/processes.

### Durable integrity references

- `LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md` SHA-256: `8ff05e30ed66a580b8766234818b8ffb573bfa5aa818e72eb6a9ade3655c69e6`
- `LEDGR_PRODUCTION_READINESS_PLAN_2026-09-21.md` SHA-256: `2216425f9970c6c3f9b59c19d0c8ee8c07a630e9dfbfd0a426475f99a053d27d`
- `LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md` SHA-256: `2080d48b236e88d401a3af84a97b009464dfb759c4a8a56104eafc0976d2a65e`
- `LEDGR_R00_DEPLOYMENT_EXPOSURE_BASELINE_2026-09-21.md` SHA-256: `25d80955030a24bd1ecc226a670dd64aa5c625052bafe46cc6e9dba0f150955b`

Canonical full 154-outcome array SHA-256 (`JSON`, sorted object keys, compact separators): `7f60fb832aa61edd7242fa4838b8a75dab9d4e2bba68b044f5679382864e1685`. All three final evidence arrays match.

Canonical 85-source migration manifest SHA-256 (same encoding): `c28305a3197c626c3550de0630641902be3e289da4e73e86745b9a9b701b6466`. This identifies source files, not a claim of unmodified platform-extension execution.

Final tested harness source manifest (the report itself is not a harness input):

| File under `tests/release/` | SHA-256 |
|---|---|
| `bootstrap.sql` | `295d9b65b1c2be5afe2745d10ff449da3b88cf94f169775413d8c7a5fb943711` |
| `database.mjs` | `df9dfa09b98092c30c35c6453f25dbffa29dd134bc1086e63d3bf40d8bdb5aad` |
| `database.test.ts` | `bc7a23b857648cef9ae602f97b931f167a85ee3c418235f78d26210ef0549063` |
| `edge-catalog.ts` | `af9fc065f4c4df6e337dc9becb6faf39094697bb398fa4a83c9e0d6f5963f56c` |
| `edge-loader.mjs` | `535f7a4e4f14c77b0ca5aca07ed821a8473ce90e51768da58462e148f02bba53` |
| `edge.test.ts` | `13fb7187eb59f748147e87ac75c5227edbccf927517cedcc0346df464fdb7914` |
| `evidence.ts` | `eb136306c0a7eb99a68140c5decd44e8d1b129ee0961eb055ed48439b6ff080f` |
| `fixtures.ts` | `4857411f6be4fd4a7549058bb55dee75ca74fa1b21b19c93c9dca7968b167608` |
| `gate.mjs` | `9c7465a94b388885f42d01f602c4d01b4cdbab03d021db0d4f14d779cea003e8` |
| `offline.test.ts` | `57860877bdba3ef7487a826c7e2e411ee220eebdc3e12761e1e6b0472819a700` |
| `run.mjs` | `192a46858c19beea56fbe96af431e039f8453e375d4e7fcc0b9ea2c4c0f1d348` |
| `safety.mjs` | `69b5dd33fc3d8a455e257652761de0dc48ce4af669cc84cdc10aaf8d363f18f4` |
| `safety.test.ts` | `c38b8d1f1185fa3891b88de616bade4486d4279bc45b1a5144938737822bc0fb` |
| `setup.ts` | `8269f84a33fc6e3e1924afcae223920d31cf796aa13d67eba6a3975b4c58fa60` |
| `tsconfig.json` | `d25041e12386aaf931f9edc6b442171684c6b0348cc63fa7dbac2038fb431b98` |
| `vitest.config.ts` | `df439baaf1800260555be2b1d69934208c43d78b5a432ab48211d494b4d5df20` |

## 19. Exact next package and stop point

**STOP after R13.** No R01–R12/R14–R15 implementation and no production verification has begun. Current R13 is **Requires Review**, not Complete: unresolved portability/core evidence and deployment-gate acceptance gaps are explicit above.

The approved sequence remains **R00 → R13 → R01**. The next implementation package is **R01 only after explicit R13 review/acceptance and separate authorization**. If review instead requires completing R13's remaining harness gaps first, remain in R13 and do not silently advance. No vulnerability repair, customer correction, deployment or remote validation is authorized by this report.
