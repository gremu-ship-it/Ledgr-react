# Ledgr — R03 AI Authorisation & Context-Boundary Remediation Report

**Date:** 2026-09-21 (Africa/Johannesburg)
**Package:** R03 — AI authorization / authorisation and data-context boundary
**Baseline branches of record:** R01 approved (byte-identical, 436 outcome objects); R02 approved (contained phone-recovery state); historical R13 immutable 106/7/41; post-R02 replay 565/6/54 (625)
**Outcome:** Both R03 baseline findings remediated and verified; combined release suite **583 PASS / 4 FAIL / 54 BLOCKED / 0 N/A (641 records)**, deterministic repeat identical; R01 and R02 evidence byte-identical to their approved baselines; historical R13 preserved. **Work stops here per instruction — no R04 activity begins without separate authorization.**

---

## 1. Authorization, scope and honoured boundaries

R03 was separately authorized on 2026-09-21 for **AI authorization and context-boundary remediation only**. The mandate required, before any code change, a full investigation of every AI Edge Function, AI RPC, DB function and view, client AI entry point, and service-role path; every org/branch/user/role context source; caller-supplied versus session identifiers; cross-org retrieval; server-side role enforcement; anonymous access; and cashier out-of-scope access. That investigation (§3) preceded all changes (§6).

Honoured prohibitions (unchanged by this package): no phone OTP/recovery changes, no invitation-acceptance changes, no POS/stock/refund/shift changes, no subscription changes, no offline-sync changes, no module additions, no AI architecture redesign, no production or staging or customer-data access. `INVITATION.PROFILE-NOT-PROOF` (a contained R02 finding, since reclassified PASS by approved expectation-evidence) was **not** treated as an R03 target. `PRIV.BRANCH`/`AI.BRANCH` branch-assignment semantics remain R11-design-pending and were **not** resolved opportunistically (§12).

## 2. Fixed baselines and contracts preserved

| Contract | State at R03 close | Evidence |
|---|---|---|
| Historical R13 baseline | **106/7/41 immutable** — no original test expectation was edited; original suites unchanged except declared test-data enrichment in §6.4 | §10 |
| Post-R02 replay baseline | Regenerated deterministically this session: **565/6/54 (625)** in `ledgr-r13-VdYkx9` | §9, §10 |
| R01 evidence | **436 outcome objects, byte-identical** vs regenerated baseline | §10 |
| R02 evidence | **35 records, byte-identical** (all 22 PASS / 0 FAIL / 13 BLOCKED behaviour preserved) | §10 |
| Original failing expectations | **Fixed intent — not weakened.** `AI.ANON` and `AI.ROLE` assertions untouched; the product now satisfies them | §8.2 |
| Denial-verification standard | Every new denial statement asserts the rejection **and** that zero protected context crossed the boundary (no result rows / zero `ai_context` invocations / zero external effects) | §8.1 |

## 3. Investigation inventory (conducted before any change)

### 3.1 Complete AI surface

| Component | Path / object | Finding role |
|---|---|---|
| Sole AI Edge Function | `supabase/functions/ai-chat/index.ts` (the `retry-failed-webhooks` name match was a false positive) | V3 fix site |
| Assembled-context RPC | `public.ai_context(uuid)` (SECURITY DEFINER) | V1/V2 fix site |
| AI projection views | `v_ai_cash_accounts`, `v_ai_revenue_invoices`, `v_ai_expense_docs`, `v_ai_cash_movements`, `v_ai_kpis`, `v_ai_monthly_trend`, `v_ai_overdue_invoices`, `v_ai_top_expenses`, `v_ai_top_customers`, `v_ai_customer_concentration`, `v_ai_anomalies`, `v_ai_upcoming_receivables`, `v_ai_upcoming_payables` (all `security_invoker`) | analysed, accepted as-is (§4.5) |
| AI migrations | `20260822000000_ai_data_views.sql`, `20260823000000`…`20260823000003` (four sequential tenant-scope repairs culminating in `repair_ai_view_tenant_scope.sql`) | history of the null-uid arm |
| Client AI entries | `src/lib/ai/{provider,context,forecast,advisor,types}.ts`, `src/components/ai/Assistant.tsx`, `src/pages/AiInsightsPage.tsx`, `src/lib/supportAgent.ts`, `src/lib/edgeFunctionErrors.ts` | browser RPC path + Edge path |
| Support assistant | separate `support-agent` Edge Function — product knowledge only, no `ai_context`, no business data | explicitly out of the data boundary |
| Rate-limit telemetry | `public.ai_insights_usage` | bookkeeping only, pre-tenant |

### 3.2 Context sources and trust analysis (pre-fix)

- **Browser → RPC:** `src/lib/ai/context.ts` calls `supabase.rpc('ai_context', {p_business_id})` directly; the **only** identifier is the caller-supplied business id, gated inside SQL by `auth.uid()`-keyed membership checks.
- **Browser → Edge:** `ai-chat` verifies the JWT with `auth.getUser()`, then derives the business **server-side** from `business_users`. The client `context` object (including any `companyId` hint, forged role/user fields, KB topics) is conversation framing only — validated by the existing `EDGE.AI.A-to-B`/`B-to-A`/`owner-normal` records.
- **Edge → RPC:** the Edge admin client (service-role JWT, no user uid) invokes `ai_context`; the migration history shows the SQL guard was deliberately written with a null-uid arm for this path.
- **Harness contract:** `db.asRole(role, uid)` sets `request.jwt.claim.sub` and `request.jwt.claim.role` transactionally with a real `SET LOCAL ROLE`, so Postgres role enforcement, `auth.uid()` and the verified role claim are all observable exactly as PostgREST presents them.
- **Fixture fixture:** two organisations × 7 roles (`owner, admin, accountant, viewer, cashier, stock_clerk, branch_manager`), 14 memberships, 4 branches; `DB.FIXTURE` count assertion (14/4) PASS in both baseline and final evidence → **existing fixture data unaltered**.

### 3.3 Existing role semantics established as the boundary source

`src/hooks/usePermissions.ts` defines the canonical matrix: `canViewReports` is true for **owner, admin, accountant, manager, sales_manager, tax_compliance_officer, treasury_manager, asset_manager, board_member, auditor, viewer, branch_manager** and false for **cashier, stock_clerk, sales_clerk, data_entry, supervisor, inventory_manager, payroll_manager, purchasing_officer, warehouse_worker, customer_service_rep**. Route gating (`isPathAllowedForRole`) confines cashiers to POS/sales paths and excludes reports/dashboard-style surfaces. This pre-existing distinction — never a new permission — is the boundary R03 enforces server-side. The server-side row-read tier for business data remains `is_business_member` (§4.5) and is not re-scoped here.

## 4. Reproduced vulnerabilities (pre-fix state)

### 4.1 V1 — Anonymous callers received the full financial context (`AI.ANON`, FAIL)

`public.ai_context(uuid)` was created with PostgreSQL's default `EXECUTE`-to-`PUBLIC` grant (the last-repair migration granted only `authenticated`/`service_role` but never revoked `PUBLIC`), and its identity guard was:

```sql
if auth.uid() is not null and not public.is_business_member(p_business_id) then
  raise exception ... errcode = '42501';
```

An anonymous API caller has `auth.uid() = NULL`, so the guard **evaluated as service-role-legitimate** — the null-uid arm written for the Edge Function indistinguishably covered anyone with no identity at all. `POST /rpc/ai_context { "p_business_id": "<any id>" }` returned company details, MTD revenue/expense/profit KPIs, a 12-month trend, overdue invoices, top expenses, top customers, customer concentration, anomalies and the receivable/payable schedules. Harness reproduction: as `anon` with empty claims the call **completed** (baseline `actual` verbatim: *"Forbidden operation completed without permission denial."*).

### 4.2 V2 — Cashiers (and every operational role) received financial-performance context (`AI.ROLE`, FAIL)

For authenticated members the only check was `is_business_member()`, despite the product's own role contract keeping cashiers and stock clerks away from reports, finance and the AI insights surfaces. Any member — including a cashier in their own organisation reaching past the hidden UI via browser console or direct request — received the same full document. Harness reproduction: as authenticated `A_cashier`, the call **completed** (same baseline `actual`).

The `ai-chat` Edge Function compounded this: it correctly verified the session and derived the tenant server-side, but **never examined the caller's membership role**, so a cashier posting a chat message received a model answer built from their business's full financial context — including the protective fallthrough that honoured an org hint only against their own memberships.

### 4.3 V3 — Classification-statement failures are defects of SQL layer + Edge layer jointly

Both failing expectations (`AI.ANON` owned by R03, `AI.ROLE` dual-labelled R11/R03) reproduce at the database layer; the handler demonstrates the same role-blindness at the Edge layer. One root cause each: (a) a null-identity arm with no API-role distinction plus a default PUBLIC grant; (b) no role gate anywhere on the path to financial-performance data.

### 4.4 Verified non-defects (kept, with evidence)

- **Cross-organisation guard** for authenticated callers was already correct: `is_business_member` denial preserved verbatim; `TENANT.A.ai`/`TENANT.B.ai` remain PASS; Edge org-hint forcing remains 403 with zero `ai_context` calls (`EDGE.AI.A-to-B`/`B-to-A` PASS, byte-identical).
- **Provider secrecy:** the LLM key lives only in Edge env; the harness blocks all outbound network (`effects.network === 0` asserted in every new Edge statement).
- **Support assistant** never touches business data (separate function) → role gating `ai-chat` cannot strand cashier support flows.
- **Client degradation:** `fetchAiData` catches RPC errors and returns `null`, so a role gate at the browser path degrades to knowledge-base answers instead of breaking — no client change required (verified by `R03.AI.RPC.*` behaviour plus unchanged UI tests).

### 4.5 Evaluated and accepted as consistent (not an R03 defect)

A reports-excluded member (e.g. cashier) can `SELECT` individual `v_ai_*` rows **for their own business** because the views are `security_invoker` with `(auth.uid() is null or is_business_member(...))` and granted to `authenticated`. Investigation established this is a faithful projection of the **pre-existing base-table read tier**: `invoices`/`expenses`/`journal_entries` SELECT policies are `is_business_member(...)` ("Read tier for business-scoped master data", 20260815/20260813 policy builders). The views therefore expose no rows the same caller cannot already read; anonymous access is closed by the grant surface (no `anon`/`PUBLIC` SELECT on any `v_ai_*` view, confirmed by the fixture bootstrap's grant discipline). The distinguishing surface is the **assembled financial-performance document** (`ai_context`) — exactly where the product's reports tier applies, and exactly what this package now gates. Broadening row-level read tiers is existing-product-design evaluation (R04 ownership), not an R03 change.

## 5. Enforced authorisation model (server-side, both boundaries)

1. **Anonymous is denied.** Any API-role claim (`anon`, `authenticated`) with no verified user id raises `42501` before data assembly.
2. **The null-uid service path is reserved** for `service_role` claims (the ai-chat Edge Function) and claim-less local SQL (migrations/maintenance) — and remains argument-scoped to exactly the requested business.
3. **Membership is necessary but not sufficient.** A verified user must hold an active membership in the requested business (cross-org unchanged) **and** a role in the existing reports tier — copied verbatim from `canViewReports` (§3.3) into `v_reports_roles` in SQL and `AI_FINANCIAL_CONTEXT_ROLES` in the handler.
4. **Caller-supplied identifiers are untrusted.** Body org hints, role fields, user fields, prompt wording and JSON-KB content can never widen the server-derived identity; the handler's role comes exclusively from its own `business_users` read.
5. **Fail-closed.** Unknown or missing roles are denied at both layers; change policy is documented in both code sites (edit `usePermissions.ts` first, then mirror in SQL + handler).
6. **No new permissions invented**; no existing allowed path altered (owner/admin/accountant/viewer/branch_manager prove identical context shape).

## 6. Changes (complete list — 5 files)

### 6.1 `supabase/migrations/20260927000000_r03_ai_context_authorization.sql` (new)
- `REVOKE EXECUTE … FROM public, anon`; `GRANT EXECUTE … TO authenticated, service_role` (idempotent).
- `CREATE OR REPLACE FUNCTION public.ai_context(uuid)` — the assembled document byte-preserved for authorised callers; three guard stages added per §5.
- Self-verification `DO` block: definition markers + complete allow-list; EXECUTE privilege end state; **behavioural** anonymous probe must raise `42501`; service-role/null-uid path must still reach the business-id check. Fails the migration loudly if any assertion fails.
- Idempotent re-application safe; zero data movement; preconditions + **rollback/containment** documented in the header (revert = re-apply 20260823000003 body + re-grant `anon`; explicitly marked emergency-only).

### 6.2 `supabase/functions/ai-chat/index.ts`
- `resolveBusiness` selects and returns the membership `role` (server-side row, never the body).
- New gate step 4b (before any `ai_context` call, forecast build, or provider call): `403 Your role cannot access business financial insights.` when the role is outside `AI_FINANCIAL_CONTEXT_ROLES`; fail-closed on unknown/missing roles.
- No other behavioural change: 401 auth order, rate-limit telemetry, cross-org 403 handling, message sanitisation, deterministic forecast/advice builders all unchanged.

### 6.3 `tests/release/gate.mjs`
- Suite registration only: `'r03-ai.test.ts': 'r03-ai.json'`.

### 6.4 `tests/release/edge.test.ts` — **declared data-enrichment, zero assertion change**
The loader's `business_users` mock rows now include the `role` column the handler legitimately selects (e.g. `role:'viewer'`, `role:'owner'`), exactly as earlier suites model served columns. Every original expectation, status boundary and effect assertion (`403`/`200`, `ai_context` call counts, `effects.network`) is unmodified; §10 proves the records remain byte-identical in outcome.

### 6.5 `tests/release/r03-ai.test.ts` (new suite, 16 statements)
House-standard evidence suite (`evidenceSuite('r03-ai')`, own embedded-PG fixture via `createDatabaseFixture` + `seedFixture`, deterministic loader mocks). Statements listed fully in §8.1.

## 7. Database / RLS change statement

One function redefined (`public.ai_context`), its EXECUTE ACL corrected. **No** table, view, policy, trigger, extension or data row touched; no schema change for cleanliness; no privilege broadening anywhere (revocations only). Requirements met: preconditions declared, idempotent migration, postcondition self-checks in-file, rollback documented, exercised against the full isolated R13 replay (87 migrations now 88), fixture data demonstrated unaltered (`DB.FIXTURE` PASS + §10 byte-identity across the shared fixture).

## 8. Test coverage

### 8.1 New `R03.*` statements (16/16 PASS)

| Record | Boundary | Mandated scenario covered |
|---|---|---|
| R03.AI.RPC.ANON-DENIED | DB RPC | anonymous invocation → 42501, zero rows, post-denial control intact |
| R03.AI.RPC.NULL-UID-AUTHENTICATED-DENIED | DB RPC | empty/malformed auth context (authenticated role, no uid) → 42501 |
| R03.AI.RPC.SERVICE-ROLE-PATH | DB RPC | service-role null-uid path allowed, strictly argument-scoped (no org-B bytes) |
| R03.AI.RPC.ROLE-GATE-MATRIX | DB RPC | all 7 seeded roles: viewer/branch manager/admin/owner/accountant allowed-in-scope; cashier/stock_clerk denied, zero rows on every denial |
| R03.AI.RPC.DEF-MIRRORS-ROLE-MODEL | DB definition | guard markers + complete reports tier present; no reports-excluded role leaked into the allow-list |
| R03.AI.RPC.EXECUTE-PRIVILEGES | DB ACL | anon/public EXECUTE revoked; authenticated/service_role retained |
| R03.AI.RPC.CROSS-ORG-DENIED | DB RPC | owner/cashier/B-owner forcing foreign business id → 42501; own scope preserved both ways |
| R03.AI.RPC.NULL-PARAM | DB RPC | empty business context rejected with explicit error, no data |
| R03.AI.EDGE.ANON-DENIED | Edge | direct invocation without session → 401 **before** any table/RPC/provider access (`client.calls` length 0) |
| R03.AI.EDGE.INVALID-SESSION-DENIED | Edge | bearer trials incl. service-role-shaped tokens → 401, zero access |
| R03.AI.EDGE.MALFORMED-BODY-DENIED | Edge | `not-json`, `{}`, `{"messages":[]}` → 400, zero context, zero network |
| R03.AI.EDGE.CASHIER-DENIED | Edge | cashier → 403 "financial insights", no `ai_context` call, no network, identity proven server-derived |
| R03.AI.EDGE.CASHIER-FORGED-CONTEXT-DENIED | Edge | forged role/user/foreign-org/payload claims → 403, payload bytes absent from response |
| R03.AI.EDGE.STOCK-CLERK-DENIED | Edge | second reports-excluded role denied identically |
| R03.AI.EDGE.ALLOWED-ROLE-SCOPE-LIMITED | Edge | owner **and** viewer → 200, exactly one `ai_context` call with `p_business_id` = own business only, provider called once |
| R03.AI.EDGE.CROSS-ORG-DENIED | Edge | owner and cashier hinting the foreign org → 403, zero `ai_context`, zero network |

Mandated matrix coverage: anonymous ✓, authenticated viewer ✓ (allowed, scope-limited), cashier ✓ (denied both layers), branch manager/admin/owner ✓ (allowed; accountant verified in-matrix), cross-organisation ✓ (both layers, both directions), caller-supplied org/branch/user/role substitution ✓ (org + role + user + payload; **branch substitution: N/A — `ai_context` has no branch parameter or branch-scoped output; branch assignment semantics remain the R11 design pending, see §12**), direct RPC invocation ✓, direct Edge invocation ✓, service-role path ✓ (allowed-service + denied-without-session), empty/malformed auth context ✓ (null-uid RPC, malformed JSON, invalid tokens). Cross-branch permissioning is documented as design-pending rather than invented.

### 8.2 Original failing expectations now satisfied (assertions untouched)

| Record | Owner | Before | After | Changed evidence fields |
|---|---|---|---|---|
| `AI.ANON` | R03 | FAIL — "Forbidden operation completed without permission denial." | **PASS** | `actual`, `status` only |
| `AI.ROLE` | R11/R03 | FAIL — same wording | **PASS** | `actual`, `status` only |

`expected`, `source`, `remediation`, `layer`, `environment` are identical; the product now satisfies the fixed intent.

### 8.3 Fixture-data integrity

`DB.FIXTURE` (14 memberships / 4 branches) and `DB.REPLAY` (exact ordered file list) PASS in both baseline and final runs; the only replay delta is the one appended R03 migration (§10).

## 9. Combined release-suite results

| Run | Purpose | PASS | FAIL | BLOCKED | N/A | Records |
|---|---|---|---|---|---|---|
| `ledgr-r13-VdYkx9` | Regenerated post-R02 baseline (R03 deltas reverted) | 565 | 6 | 54 | 0 | 625 |
| **`ledgr-r13-EIPGdg`** | **R03 final** | **583** | **4** | **54** | **0** | **641** |
| `ledgr-r13-uPYIuI` | Deterministic repeat of final | 583 | 4 | 54 | 0 | 641 |

Movement: +16 new `R03.*` records (all PASS) and +2 original flips (`AI.ANON`, `AI.ROLE`); **zero** regressions. The surviving 4 FAILs are pre-existing, separately-owned expectations (`EDGE.RETRY.no-secret` R12/R14; `EDGE.WEBHOOK.viewer` R12; `POS.STOCK` R06; `ROLE.cashier.write` R04) — none on the AI surface.

## 10. Integrity and preservation comparison (machine-checked, `.cache/r03/comparison.json`)

- **625 common records:** 623 byte-identical; the only differences are the two declared flips, whose changed fields are exactly `{actual, status}`.
- **Additions 16** (all `R03.*`), **removals 0**, evidence renames 0.
- **Repeat determinism:** repeat vs final — 0 non-identical records, 0 missing/extra across all 641.
- **R01 preservation:** all **436** R01 outcome objects byte-identical to baseline.
- **R02 preservation:** all **35** R02 records byte-identical (behaviour, expectation text and BLOCKED disclosures unchanged — 22/0/13 within-suite tallies preserved).
- **Historical R13:** the immutable 106/7/41 baseline is structurally preserved — original suite files unchanged except the §6.4 data-enrichment, BLOCKED records never simulated as PASS, and the historical failure set survives inside the regenerated baseline verbatim.
- **Migration delta:** exactly `20260927000000_r03_ai_context_authorization.sql` appended; ordering intact (`mset_n[:-1] == mset_b` machine-verified).
- Source fingerprints (sha256-16 in the manifest): migration `2e31756c8cad1239`; ai-chat `392f58693bae2fba`; r03-ai.test.ts `564f000c3ff956f3`; gate.mjs `bb555d313c7bd29e`; edge.test.ts `66958064a6d1e28d`.

## 11. Full regression stack (all green at R03 close)

| Check | Result |
|---|---|
| Root unit/integration suite | **658 passed / 658** |
| Release-suite types (`tsc -p tests/release/tsconfig.json`) | PASS |
| App types (`tsc -b`) | PASS |
| Combined release suite + repeat | 583/4/54, twice, byte-identical (0 diffs) |
| Lint | exit 0; one pre-existing warning in *untracked generated* `artifacts/database/fresh-database.generated.approx.ts` (predates R03, unchanged) |
| `node --check` release `.mjs` helpers | PASS |
| esbuild bundle of all **26** edge functions (incl. modified ai-chat) | PASS |
| Placeholder production build | PASS (3402 modules, `built in 1.83s`) — refuses real deploys without env by design |
| Whitespace / `git diff --check` | PASS |

## 12. Remaining findings and package ownership (not in R03 scope, not opportunistically fixed)

| Item | Status | Owner | Note |
|---|---|---|---|
| `AI.BRANCH` / `PRIV.BRANCH` — durable user-branch assignment + field-permission contract | **BLOCKED by design, intentionally unresolved** | R11 | AI context is business-scoped today (no branch parameter/output); inventing assignment schema is prohibited |
| Surviving 4 FAILs | FAIL (pre-existing, expectations untouched) | R12/R14, R12, R06, R04 | none on the AI surface |
| 54 BLOCKED records & historical 106/7/41 set | BLOCKED with explicit disclosure | per record (R02:15 phone-OTP/identity-token journeys **future scope**, R13:12, R04/R08:8, R09:6, R01/R02:4, R01:2, R04:2, R07:2, R05/R07:1, R10:1, R11:1) | never simulated |
| `v_ai_*` member-tier direct reads | Evaluated & accepted (§4.5) | existing design / R04 | projections of the is_business_member row read tier; no anonymous surface |
| Client `ai_context` error degradation | Verified non-defect | — | role denial degrades to knowledge-base answers by design |
| Member-tier breadth of base financial-table reads | Existing product design, unchanged | R01/R04 evaluation lineage | deliberately not re-scoped by R03 |

## 13. Prohibitions and operational status

No production, staging, or customer data was touched at any point; all evidence is from the disposable local R13 environment (embedded PostgreSQL 17, synthetic identities, network/mail blocked by the harness). No phone-OTP, invitation, POS, subscription, offline-sync or permission-model changes were made; R11 branch design was not resolved; the AI architecture was not redesigned (both boundaries hardened in place with mirrored existing semantics). The hosted `ai-chat` function and `ai_context` RPC gain these protections on the next ordinary deployment; this report asserts local-boundary behaviour only and does not claim production verification.

## 14. Stop declaration

R03 is complete: both baseline findings remediated with fixed-intent satisfaction of the original failing expectations, 16 new boundary statements green, regression and preservation integrity machine-verified, and this report delivered. **Work stops here. No R04 (or any further package) activity begins without separate review and authorization.**
