# R01 — Security Boundary and Membership-Role Remediation

**R01 STATUS: Complete — authorized R01 implementation and local verification complete; not deployment or overall release approval.**

Date: **2026-09-21**, Africa/Johannesburg. Repository: `gremu-ship-it/Ledgr-react`. Branch: `arena/01a0c215-ledgr-react`. Baseline HEAD: `2e0ede303634d753710357077823eeafb9ecfb7d`. Changes remain in the working tree. Nothing was deployed, pushed or tested against production/staging; no customer data was accessed or changed.

This controlled-continuation revision supersedes the previous **Requires Review** conclusion and its issuance-time-only acceptance assumption. The user explicitly authorized current issuer authority at acceptance and fail-closed unverifiable invitations. The three previously unresolved R01 items—an inactive-owner acceptance transition, required-name provisioning failure, and unverifiable legacy invitations—now have passing executable local regressions.

## 1. Decision, scope and authoritative sources

**Current result:** all **436 R01 records PASS**. Complete release harness: **542 PASS / 7 FAIL / 41 BLOCKED**, 590 records. Original accepted R13: **106 PASS / 7 FAIL / 41 BLOCKED**, 154 records, with every original outcome object preserved exactly. The root suite passes **76 files / 658 tests**. The strict release gate remains red; no failure or blocker was waived.

R01 remains limited to privileged profile fields, direct membership transitions, invitation issuance/role assignment, acceptance/current issuer authority, owner-target protection and legitimate trusted provisioning. Current authority is a deliberate newly authorized acceptance requirement, not a retroactive claim about the previous partial implementation. No new ownership-transfer/last-owner rule, role hierarchy, organizational model, provenance/history subsystem or recovery architecture was introduced.

Authoritative repository documents reviewed: `LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md` (R01 and shared R02 consumers), `LEDGR_PRODUCTION_READINESS_PLAN_2026-09-21.md`, `LEDGR_R00_DEPLOYMENT_EXPOSURE_BASELINE_2026-09-21.md` and `LEDGR_R13_REPRODUCIBLE_RELEASE_TEST_HARNESS_2026-09-21.md`, all under `docs/audits/`. Their contents remain unchanged. Historical ACL captures and local conditional fixtures are not current deployed ACL evidence.

R02 recovery/password reset/phone identity matching, token lifecycle, AI, POS/finance/stock, subscriptions/quotas, offline synchronization, webhooks and scheduled-job remediation are untouched. R02 requires separate review and explicit authorization before work starts.

## 2. Existing role contract and current issuer authorization

An **active owner in the exact business** may assign all 22 existing enum roles. An **active admin in that business** may assign every role except owner/admin. Other roles cannot administer membership or invitations. An admin may demote/remove a different admin, but may not modify an owner target, including an inactive owner. Direct self-role/status/removal and membership/invitation identity relocation remain prohibited. Existing `staff` compatibility mapping is unchanged; it is not a new enum role.

| Assigned role | Owner issuance | Admin issuance | Viewer issuance | Acceptance after owner→admin |
|---|---|---|---|---|
| `owner` | ALLOW | DENY | DENY | DENY |
| `admin` | ALLOW | DENY | DENY | DENY |
| `accountant` | ALLOW | ALLOW | DENY | ALLOW |
| `payroll_manager` | ALLOW | ALLOW | DENY | ALLOW |
| `supervisor` | ALLOW | ALLOW | DENY | ALLOW |
| `data_entry` | ALLOW | ALLOW | DENY | ALLOW |
| `inventory_manager` | ALLOW | ALLOW | DENY | ALLOW |
| `sales_clerk` | ALLOW | ALLOW | DENY | ALLOW |
| `auditor` | ALLOW | ALLOW | DENY | ALLOW |
| `viewer` | ALLOW | ALLOW | DENY | ALLOW |
| `purchasing_officer` | ALLOW | ALLOW | DENY | ALLOW |
| `warehouse_worker` | ALLOW | ALLOW | DENY | ALLOW |
| `sales_manager` | ALLOW | ALLOW | DENY | ALLOW |
| `customer_service_rep` | ALLOW | ALLOW | DENY | ALLOW |
| `tax_compliance_officer` | ALLOW | ALLOW | DENY | ALLOW |
| `treasury_manager` | ALLOW | ALLOW | DENY | ALLOW |
| `asset_manager` | ALLOW | ALLOW | DENY | ALLOW |
| `board_member` | ALLOW | ALLOW | DENY | ALLOW |
| `branch_manager` | ALLOW | ALLOW | DENY | ALLOW |
| `manager` | ALLOW | ALLOW | DENY | ALLOW |
| `cashier` | ALLOW | ALLOW | DENY | ALLOW |
| `stock_clerk` | ALLOW | ALLOW | DENY | ALLOW |

The R01 enum-inventory assertion prevents silently omitting roles. Owner/admin/viewer issuance and direct assignment are exercised for all 22 roles, through real SQL and the actual create-invite-link handler with boundary adapters.

### Atomic acceptance boundary

Both consumers now use **`public.accept_invitation_membership(uuid,uuid,jsonb)`**, a restricted `SECURITY DEFINER` function. Direct execution is denied to PUBLIC/anon/authenticated and granted only to the service SQL role. The authenticated legacy wrapper can call it after its existing identity check. A client-supplied recipient ID cannot reach the private mutation directly through authenticated SQL.

Within one transaction the helper:

1. Requires an existing Auth recipient; locks and reloads the stored invitation, checks expiry and acceptance state, and verifies the exact active/non-deleted business, holding a business row lock.
2. Compares the stored invitation to the caller's database-derived snapshot: ID, business, role, issuer, email, phone, expiry and token. Timestamp fields are compared as their SQL types, not raw JSON spelling. Changed snapshots are rejected rather than reusing a stale identity check.
3. Requires guard-managed acceptance eligibility, never inferring historical authorization from `invited_by` or a current owner role alone.
4. Requires the issuer to exist in `auth.users`, not be soft-deleted or currently banned, and have an **active membership in this same business**. The role must currently permit the invited role. Auth fields are read through `to_jsonb` so the existing lightweight local Auth fixture remains compatible; dedicated synthetic attributes exercise the ban/delete checks. This is database logic evidence, not live GoTrue verification.
5. Holds shared locks on the issuer's Auth row and membership through commit, preventing an interleaved deletion, ban, inactivation or demotion from slipping between authorization and the role write. A two-connection PostgreSQL probe demonstrates competing demotion is blocked with lock-timeout SQLSTATE `55P03` until the acceptance transaction ends; both probe transactions roll back.
6. Locks an existing recipient membership, protects an inactive owner from an admin's ordinary-role grant, ensures the required profile name, and performs the membership write and invitation acceptance mark atomically. The conflict-write predicate repeats inactive/owner-target protection to reject a concurrently inserted active or protected membership instead of overwriting it.

No longer authorized means DENY: inactive membership, demotion to viewer, missing Auth issuer, issuer only in a different business, null issuer, current ban/soft deletion, or missing eligibility. Owner→admin is **not automatically disqualifying**: ordinary roles still succeed, while owner/admin assignments fail. No new stricter hierarchy was invented.

### Existing identity and lifecycle contracts retained

- `accept_invitation(text)` retains its existing authentication, token, email-recipient, expiry and business checks, then delegates the mutation. An already-active member keeps their actual role; the wrapper acknowledges/consumes the invitation as before and still ensures a profile.
- `accept-invite-link` retains its existing token and email/phone matching logic, including phone precedence and its existing identity sources. It passes the **database invitation object and authenticated caller ID**, not request body role/business/user fields, to the private RPC. The legacy fallback calls the now-protected wrapper.
- Edge no longer writes membership or the acceptance mark separately. Failed database authority checks return a non-success response before profile/member writes. The existing authorized profile/phone-fill behavior occurs after authorization; an already-active member still receives 409 without invitation consumption on this Edge path.
- Recipient matching was not redesigned. A named B-business user accepting a legitimate A invitation is allowed; this is not B administering A. Existing SQL/Edge identity differences, phone recovery and hosted JWT/session behavior remain outside this package.

## 3. Exact inactive-owner regression

Dedicated record: **`R01.INVITATION.ACCEPTANCE.INACTIVE_OWNER`**. This is separate from the earlier `R01.ACCEPT.INACTIVE-OWNER` check.

| Step | Controlled synthetic state |
|---|---|
| Initial recipient | A owner, `is_active=true` |
| Issuer | Authorized active A admin |
| Issuance | Admin issues an ordinary `viewer` invitation to the owner while that owner is still active |
| Later change | Trusted fixture setup makes the owner inactive, retaining role `owner` |
| Attempt | Recipient invokes the existing SQL acceptance wrapper |
| Required result | SQLSTATE `42501`; recipient remains `owner` / inactive; invitation remains unaccepted |
| Before continuation | **FAIL**: no denial, resulting membership `viewer` / active |
| After continuation | **PASS**: `42501`, resulting membership `owner` / inactive, `accepted_at` remains NULL |

The evidence records initial state, issuer role, invitation role, owner status at acceptance, actual resulting membership and denial code. The test observes membership inside the transaction before fixture rollback; it does not infer mutation atomicity merely from final fixture cleanup. Savepoint handling permits inspection after the expected SQL exception. The rule is existing owner-target protection, not a new owner-only rule for peer-admin changes.

## 4. Legacy invitation safety and the minimal eligibility field

Current issuer checks alone cannot distinguish an honestly issued historical invitation from a forged row naming a real current owner. A stored issuer identifier is **not proof of issuance authority**. No timestamp inference, role-history guess or historical certification backfill is used.

The narrow necessary addition is **`business_invitations.role_assignment_authorized boolean NOT NULL DEFAULT false`**. It is an acceptance-eligibility bit, not a historical attestation, history table, provenance ledger or identity redesign:

- All preexisting rows start unverified/false, even if their issuer still looks valid. Outstanding unverifiable invitations are rejected. Already accepted membership/history is not undone or rewritten.
- The existing invoker invitation guard stamps authorized new writes and genuine authorized role/issuer reassignments. For authenticated writers, existing manager/role/actor-attribution checks must succeed first. A caller cannot promote a legacy marker by a metadata-only update, even if that caller is an owner.
- Existing service/definer issuance remains supported. Trusted new/reassigned writes can receive eligibility only when the referenced issuer has the active same-business role authority. Acceptance still independently rechecks the issuer and Auth state under locks.
- Ordinary trusted updates preserve eligibility and cannot turn false into true merely by providing the flag; trusted operators may revoke it. No-op role/issuer updates do not certify a legacy row. A genuine newly authorized reassignment is a new authorization, not evidence about the old issuance.
- Direct authenticated invitation identity relocation and admin retargeting of elevated grants remain denied. Business roles, tokens, recipients, expiry and historical acceptance fields are not rewritten by migration.

`R01.ACCEPT.LEGACY-PROVENANCE` now executes a controlled synthetic legacy row that references a **real current owner** and expects denial. The entire 22-role current-authority matrix also includes an unverifiable case. These are fail-closed regressions, **not claims of observed production exploitation**. The populated-state migration probe separately proves that adding the column leaves an existing valid-looking row false.

**Customer-visible consequence requiring rollout review:** outstanding legacy links must be reissued through authorized issuance; accepting them is intentionally no longer supported. There is no automatic historical backfill and no unsafe 'set every marker true' migration. No invitations were changed in any customer environment.

## 5. Provisioning investigation and compatibility correction

`grant_user_business_access(text,uuid,text)` was already service-only. Its prior body attempted `INSERT INTO user_profiles(id) ... ON CONFLICT(id) DO NOTHING`. The base schema requires `full_name NOT NULL` with **no default**; migration inspection and the disposable catalog confirm that constraint remains in force. The reconstructed local Auth schema has **no non-internal auth.users trigger** creating profiles. This does not establish hosted Auth trigger configuration.

The id-only insert was an existing assumption exposed by R01's legitimate-path test, not a constraint or regression introduced by R01. PostgreSQL checks NOT NULL before conflict handling, so an existing profile does not make an invalid proposed row safe: both new-user and existing-profile tests reproduced **23502** before this correction. Existing phase8b owner/acceptance provisioning and Edge acceptance already use Auth display metadata/email to supply names, establishing the legitimate source contract.

The smallest body change supplies `full_name` from nonblank Auth metadata `full_name`, then `name`, then the email local-part, with the existing benign display fallback `Team member`. Existing profiles are preserved by `ON CONFLICT(id) DO NOTHING`. Only display-name data is copied; metadata such as `is_platform_admin=true` confers no authority. No constraint is relaxed, no validation removed, no creation step bypassed and no table or authenticated execution grant added. All other provisioning validation, membership logic and return signature remain intact.

New probes cover metadata name, email fallback and an existing profile. Each provisions a synthetic new Auth user, calls the service helper twice, asserts exactly the intended active `accountant` membership in A, a non-null correct name, preservation of existing name/language, and no platform flag derived from metadata. The resulting authenticated user can read the intended A contact but not B's. Existing denial/allow tests for trusted provisioning, create-business ownership and safe cross-business operator access remain passing. Fallback `name`/phone-only display behavior is implemented consistently but is not represented as live-provider evidence.

## 6. Product files, preserved work and affected paths

Cumulative R01 files (9):

| File | Purpose |
|---|---|
| `supabase/migrations/20260926000000_r01_privileged_write_boundaries.sql` | Earlier three invoker profile/membership/invitation write guards; unchanged in continuation |
| `supabase/migrations/20260926000001_r01_acceptance_current_authority.sql` | New eligibility column, updated invitation guard, atomic private acceptance, updated wrapper and required-name provisioning |
| `supabase/functions/invite-team-member/index.ts` | Earlier inactive-owner target check; unchanged in continuation; preceding recovery remains R02 |
| `supabase/functions/accept-invite-link/index.ts` | Delegates role mutation to atomic RPC after existing identity checks |
| `src/pages/settings/TeamManagementPage.tsx` | Earlier non-owner role-choice restriction, with allowed peer-admin demotion retained |
| `src/pages/settings/__tests__/TeamManagementPageRoles.test.tsx` | Earlier two UI regressions; five tests in this file pass |
| `tests/release/r01-security.test.ts` | 436 dedicated R01 evidence records |
| `tests/release/gate.mjs` | Earlier R01 suite artifact registration; strict failure/blocker behavior retained |
| This report | Updated scope, evidence, migration/rollback and status |

Continuation changed only the new migration, acceptance handler, R01 suite and this report. Hash comparison against the pre-continuation manifest confirms no changes to existing migrations, original R13 fixture/bootstrap/suites/runner/gate, package files, other audited handlers or other audit documents. The earlier R01 migration and invite-team-member protections remain installed in the controlled before run.

Preexisting `.github/workflows/ci.yml`, `.gitignore`, `package.json`, `package-lock.json`, R13 harness and audit work are preserved, not claimed as this continuation's work. No new dependencies or configuration changes were needed. Generated builds and logs remain in ignored `dist`/`.cache` locations.

### Cumulative direct-write protections and alternate routes

- Own benign profile name/avatar/language/currency/update-time changes remain allowed; privileged platform/phone/lifecycle/identity fields are guarded. Future UPDATE fields default protected. Actual SQL role is checked; a caller-supplied JWT role string is not service authority.
- Membership INSERT/UPDATE/DELETE/upsert checks actor, exact business, existing target, assigned role, self-transition and identity relocation. Trusted effective service/table-owner paths retain their existing bounded capabilities.
- `invite_member`, `create-invite-link`, direct invitation writes, legacy acceptance, Edge acceptance and direct `invite-team-member` transitions are covered. `create_business_with_owner`, `grant_user_business_access` and `set_user_business_access` remain legitimate trusted provisioning paths with their execution/caller boundaries. The old Eagle assignment function remains absent.
- Client Team/AcceptInvitation/CreateBusiness paths call these existing server paths. UI restrictions are defense in depth, never the sole enforcement.
- No claim is made about unknown deployed custom SQL or unrestricted operators holding service credentials. Each privileged consumer still requires its own authorization; R02 recovery is explicitly not repaired by these role guards.

## 7. Test design, coverage and evidence layers

**436 R01 records = 202 prior R01 IDs + 234 continuation records.** Two previous assertions were intentionally updated before the controlled comparison: legacy provenance changed from BLOCKED to executable fail-closed denial, and the Edge positive acceptance assertion now requires the atomic RPC rather than a direct membership insert. The other prior R01 assertions remain. These changes are not retroactively represented as identical to the old partial suite.

The 234 additions comprise **220 current-authority cases (22 roles × 10 states)** plus 14 focused checks: the exact inactive-owner chronology; three provisioning cases; private-RPC authenticated denial; three Edge denial propagations; immutable eligibility; valid/changed service snapshots; two-connection issuer locking; catalog/default/ACL state; and already-member/profile compatibility. Positive cases verify the actual resulting membership role/activity and acceptance mark, not only the RPC response. The ten matrix states are authorized, inactive, demoted to viewer, owner→admin, wrong business, missing Auth issuer, null issuer, banned, soft-deleted and unverifiable. The wrong-business fixture changes the issuer's actual membership organization after issuance; it does not rely on rewriting the invitation and incidentally clearing eligibility.

Evidence layers remain explicit:

1. **Real owned PostgreSQL17:** original migration replay plus actual SQL roles/RLS/constraints/triggers/functions, synthetic Auth/Storage and excluded platform-only pg_cron/pg_net installation. Final replay includes 87 source migrations. R01 alone conditionally grants SELECT/INSERT/UPDATE/DELETE on `user_profiles`, `business_users`, `business_invitations` to authenticated/service_role to exercise the boundary rather than merely fail on missing table grants. These are test-only prerequisites, not deployment grants. Synthetic Auth ban/delete attributes are added only in the R01 fixture, not the original bootstrap.
2. **Actual Edge handler source with local adapters:** real handler control flow, mocked Auth/PostgREST/provider boundaries, outbound effects disabled. This does not prove hosted gateway/JWT/Deno/provider configuration.
3. **Root UI/domain regressions:** 658 tests, including the two earlier role-picker additions. Compilation is not security evidence.
4. **Disposable populated migration and containment probe:** prior-state replay, real catalog/row snapshots, apply/reapply, legacy rejection, legitimate acceptance, both-entrypoint containment and restoration checks. No remote database target is accepted by the harness.

All synthetic write probes roll back; the lock probe also rolls back its second connection even when run against the unfixed implementation. Target ownership/nonce checks govern database cleanup. No customer, financial, stock, ledger or IndexedDB records are changed.

## 8. Before/after comparison and every changed result

The **authoritative controlled pair** is:

- Before: `.cache/r13/ledgr-r13-k6bDIL/evidence.json` — prior R01 installed, continuation migration absent and acceptance handler restored to its verified pre-continuation bytes.
- After: `.cache/r13/ledgr-r13-LeOZM6/evidence.json` — continuation installed.
- Independent final `npm run verify` release result: `.cache/r13/ledgr-r13-XkwN9G/evidence.json` — every outcome object equals the after result.

Both paired runs use an **identical full harness SHA manifest**. Temporary staging/restoration affected only the agent-owned continuation migration and acceptance handler, with restoration in `finally`; original work was not reset. Assertions, original fixtures, gate and all original R13 suite sources are identical across the pair.

| Evidence set | Before PASS / FAIL / BLOCKED | After PASS / FAIL / BLOCKED |
|---|---|---|
| Original accepted R13 (154) | 106 / 7 / 41 | 106 / 7 / 41 |
| Prior R01 IDs, using continuation assertions (202) | 198 / 4 / 0 | 202 / 0 / 0 |
| Added continuation cases (234) | 43 / 191 / 0 | 234 / 0 / 0 |
| R01 total (436) | 241 / 195 / 0 | 436 / 0 / 0 |
| Combined release (590) | **347 / 202 / 41** | **542 / 7 / 41** |

Exactly **195 FAIL→PASS** outcome objects change; the other **395 records are unchanged**. These are checks, not 195 distinct vulnerabilities. All 154 original R13 outcome objects—not just their counts—are exactly unchanged before, after and in the final repeat.

- **178 matrix changes:** each of inactive, demoted, wrong-business, missing, null-issuer, banned, soft-deleted and unverifiable now denies for all 22 roles (176); owner→admin now denies owner/admin (2). All 22 still-authorized and 20 owner→admin ordinary-role positive controls remain PASS.
- The other **17 changes** are explained individually below. Missing-new-function/catalog checks are new-boundary availability/ACL evidence, not preexisting exposed endpoints.

| Record | Why the controlled result changes |
|---|---|
| `R01.ACCEPT.INACTIVE-OWNER` | Existing failed inactive-owner target transition now denied |
| `R01.INVITATION.ACCEPTANCE.INACTIVE_OWNER` | Exact requested active→inactive chronology now preserves owner/inactive state |
| `R01.ACCEPT.LEGACY-PROVENANCE` | Executable valid-looking legacy row now rejected, not assumed authorized |
| `R01.RPC.SERVICE-ALLOW.grant_user_business_access` | Prior 23502 corrected by supplying required profile name |
| `R01.PROVISION.metadata-name` | Auth display-name provisioning succeeds without copying platform metadata |
| `R01.PROVISION.email-fallback` | Missing metadata uses email local-part; membership and tenant boundary work |
| `R01.PROVISION.existing-profile` | Valid proposed profile row avoids pre-conflict 23502; existing name/language preserved |
| `R01.ACCEPT.EDGE.valid` | New protocol assertion: atomic RPC used; no direct membership insert |
| `R01.ACCEPT.EDGE-CURRENT.42501` | Edge propagates database authority rejection as 403 without writes |
| `R01.ACCEPT.EDGE-CURRENT.P0002` | Edge propagates missing/expired state rejection as 404 without writes |
| `R01.ACCEPT.EDGE-CURRENT.55000` | Edge propagates consumed invitation state rejection as 400 without writes |
| `R01.CURRENT.CATALOG` | New fail-closed column/default and service-only helper ACL exist |
| `R01.CURRENT.ELIGIBILITY-IMMUTABLE` | New marker cannot be self-certified; before implementation the field did not exist |
| `R01.CURRENT.SERVICE-RPC-DENY` | New private helper exists and denies authenticated execution; absent before (42883, not an authorization denial) |
| `R01.CURRENT.SERVICE-SNAPSHOT.changed` | New private helper rejects a changed recipient snapshot; helper absent before |
| `R01.CURRENT.SERVICE-SNAPSHOT.valid` | New private helper accepts a precise valid database snapshot; helper absent before |
| `R01.CURRENT.ISSUER-LOCK` | Competing demotion cannot complete inside the open acceptance transaction |

### Earlier artifacts and fixture correction

The previous partial delivery (`LGEAMO`/`bAHG5I`, final verify `VcqLwl`) had 356 records: 305/9/42, including 202 R01 records at 199/2/1. Its earlier same-assertion comparison (`DLXm82`→`LGEAMO`) improved 51 checks. That historical result is retained, not relabeled as complete or added arithmetically to this pair.

The initial continuation pre-fix run `NiMcL1` had 518 records, 346/131/41; the first implementation run `9tAAep` had 470/7/41. Further deliberate coverage expansion produced interim `wMeZ1h` (567 records, 518/8/41). Its additional service-snapshot failure was a **fixture precision error**: node-postgres converted timestamp microseconds into JavaScript Date milliseconds before serializing. The valid fixture now obtains `to_jsonb(business_invitations)` directly from PostgreSQL, matching PostgREST's database JSON representation. The SQL snapshot check was not weakened. The lock fixture was also made rollback-safe on both outcomes, and wrong-business setup was made independent of marker changes. All such fixture corrections precede the final paired run. Counts from different harness inventories are not causal comparisons.

Appendix A lists all 436 R01 records and the final pair's results. Appendix B lists every remaining non-pass original record.

## 9. Required regressions, typecheck, lint, build and syntax

| Command / check | Final result and qualification |
|---|---|
| `npm run typecheck` | PASS (`tsc -b`, executed in final verify) |
| `npm run lint` | Exit 0; one existing unused eslint-disable warning in `artifacts/database/fresh-database.generated.approx.ts`; no errors |
| `npm run test` | PASS: 76 files / 658 tests |
| `npm run test:release:types` | PASS |
| `npm run test:release` | Strict exit 1, correctly retaining 542 PASS / 7 FAIL / 41 BLOCKED; all 436 R01 records PASS |
| `npm run verify` | Exit 1 at that unchanged strict release gate; does not reach its final build command |
| `npm run build` without required local config | Environment guard correctly refused missing configuration (exit 1); no bypass used |
| Build with documented public placeholders | PASS: `VITE_SUPABASE_URL=https://placeholder.supabase.co VITE_SUPABASE_ANON_KEY=placeholder-anon-key npm run build`; not a live configured application |
| Node syntax | PASS: `node --check` on all five release `.mjs` files |
| Edge TypeScript syntax | PASS: 29 files transpiled with TypeScript diagnostics, zero syntax errors; not hosted Deno type/provider validation |
| SQL syntax/semantics | PASS through full PostgreSQL migration replay, populated apply/reapply and actual-role tests |
| Whitespace/diff | PASS: tracked `git diff --check`; separate no-index checks on added migration/test/report files |

Build retains existing Vite native-config/dynamic-import/chunk-size warnings. No unrelated build/lint cleanup was made. Final logs: `.cache/r01-current/final-verify.log`, `final-build.log` (the expected configuration refusal), `final-build-placeholder.log`, `final-syntax.log`, `paired-before.log`, `paired-after-final.log`, `migration-probe.log`, and `final-comparison.json`. Ignored logs are local artifacts; the reproducible harness and result inventories in this report are the durable review record.

## 10. Security and customer-data impact

R01 now enforces authorized issuance and current-authority acceptance, rather than letting a past role or unverified stored issuer retain effective privilege. Direct authenticated writes, private RPC execution, elevated role issuance and owner-target transitions have server/database enforcement. Valid owner/admin assignment, ordinary roles after an authorized owner→admin change, legitimate recipient cross-tenant joining, trusted service provisioning and benign profile edits remain supported.

No remote/customer data was read or edited. No historical membership, accepted invitation, financial transaction, amount, date, balance, stock, ledger, subscription or quota backfill occurred. No unsynchronized IndexedDB record was deleted. Display-name fallback does not grant platform authority. The migration changes future acceptance eligibility of old pending links; it does not undo existing memberships.

Remaining deployment/customer considerations: reissue legacy links; expect rejection after issuer authority loss; role/identity snapshot changes require retry/reissue rather than stale acceptance; row locks can serialize competing account/member/organization updates; unauthorized or stale attempts may now surface 403 rather than a successful write. These are intended fail-closed effects, not permission to alter customer rows manually.

## 11. Migration dependencies, affected objects and rollout prerequisites

Two append-only transactional R01 migrations follow the existing `20260925000000` file. Their September 26 prefix is repository migration ordering, **not today's date**. Earlier migrations are untouched.

The first migration creates the three invoker guards and their BEFORE triggers on profiles, memberships and invitations; it adds no table grants or RLS replacement. The continuation adds one invitation column and changes these functions:

| Object | Change / execution boundary |
|---|---|
| `r01_guard_invitation_write()` | Existing invoker trigger function replaced to manage eligibility; trigger remains attached; no authenticated/public direct EXECUTE |
| `accept_invitation_membership(uuid,uuid,jsonb)` | New private definer mutation; PUBLIC/anon/authenticated revoked, service_role execute only |
| `accept_invitation(text)` | Existing definer wrapper retains authenticated/service execution; PUBLIC/anon explicitly revoked |
| `grant_user_business_access(text,uuid,text)` | Required-name insert corrected; PUBLIC/anon/authenticated revoked, service execution retained |

**No RLS policy is replaced/disabled and no table DML grant is added.** No role enum, full_name constraint, historical business row or identity matching contract is changed. The helper depends on the existing invitation columns, membership uniqueness and roles, business active/deletion fields, and Auth identity/display metadata. Existing SQL/Edge callers and service capability boundaries were inspected before changing them.

Owned local verification (`migration-verification.json`): replayed **86 prior migrations**, inserted a synthetic historical invitation, captured row/policy/table-ACL/name-constraint snapshots, then applied the continuation. Existing profile/member/invitation fields matched exactly; the only new old-row field was false eligibility. Policies, table grants and full_name NOT NULL/no-default were unchanged. Reapplication did not certify the row. Legacy denial, authorized new acceptance, two-entrypoint containment and authorized restoration passed. Full release regression was rerun afterward, with unchanged original R13 results.

**Rollout is not authorized or performed.** A separately authorized operator must confirm target/project and hosted schema/ACL/function ownership before applying anything. Coordinate database and Edge release with acceptance traffic paused: an **old Edge version still directly uses service membership writes and does not become safe merely because the new SQL migration is applied**. Install/verify the database boundary and updated handler together before unpausing; otherwise the new handler also correctly fails closed if its RPC is absent. Review the legacy-link customer impact and reissue path. Preserve the initial R01 guards and all existing unrelated data. Hosted JWT/disabled-gateway behavior and live provider settings still require separately authorized verification; CORS is not authorization.

## 12. Safe rollback / containment and verification

Rollback means **containment**, not reinstalling an unsafe acceptance implementation. The tested database containment is:

```sql
begin;
revoke all on function public.accept_invitation(text)
  from public, anon, authenticated, service_role;
revoke all on function public.accept_invitation_membership(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
commit;
```

This intentionally pauses acceptance. Keep the updated fail-closed Edge handler; it receives permission denial and must not fall back to a former direct service write. Disable the endpoint operationally if necessary under a separately reviewed rollout plan. Leave the eligibility field, guard triggers, profile constraint and safe provisioning correction installed. **Do not drop guards, set legacy markers true, restore the old acceptance body/Edge handler, broaden table grants or rewrite customer memberships as a rollback.** Trusted database owners remain operators; this is not a claim that revoking app-role EXECUTE prevents owner SQL access.

The disposable rollback probe denied both authenticated wrapper execution and service helper execution with `42501`, verified unchanged row/policy/table-ACL snapshots, reapplied the continuation, then confirmed legitimate acceptance was restored while legacy acceptance remained denied. All probes used synthetic data and rollback transactions. The subsequent full release run and final repeat passed R01 and retained all original results. This is a demonstrated containment/reapply procedure, not a reverse migration deleting the eligibility field and reopening unsafe acceptance.

## 13. Remaining FAIL/BLOCKED, deferred ownership and limits

**No R01 FAIL or BLOCKED records remain** in the authorized local scope. The overall release remains **not approved** because the original seven failures and 41 blockers remain exact matches to accepted R13:

| Original failure | Deferred package / unchanged meaning |
|---|---|
| `AI.ANON` | R03: anonymous AI boundary |
| `AI.ROLE` | R11/R03: AI role authority |
| `ROLE.cashier.write` | R04: non-R01 write matrix |
| `POS.STOCK` | R06: POS/stock behavior |
| `EDGE.RECOVERY.foreign-identity` | **R02**: foreign-identity recovery; deliberately not repaired by a later role guard |
| `EDGE.RETRY.no-secret` | R12/R14: retry/job secret boundary |
| `EDGE.WEBHOOK.viewer` | R12: webhook boundary |

The 41 blockers retain their original IDs, sources, statuses and explanations (Appendix B): missing migration-profile privileges/relationships, synthetic Auth/Storage/platform limits, offline/live-service gaps and unported standalone suites. Their exact attribution remains in the original outcome records, not reassigned to R01 to hide them. Some hosted verification necessarily remains unavailable; no local pass is promoted into a production claim.

R02/R03/R04/R06/R11/R12/R14 remain deferred as explicitly requested. Other unrelated code, fixtures, finance/history and operational configuration are preserved. No remote-capable deployment/database/provider command was run and no live secrets were requested or placed in public configuration. The earlier conditional privilege escalation diagnostic and synthetic legacy cases are not established production exploits.

## 14. Final disposition and required next action

**R01 STATUS: Complete**, for the explicitly authorized R01 implementation and local evidence scope. This follows closure of direct assignment, issuance, current-authority acceptance, inactive-owner protection, fail-closed legacy handling and legitimate provisioning—not merely an increased PASS count.

**STOP. Await explicit user review.** Do not begin R02 or another package, deploy, backfill legacy invitations, access production or treat the red overall release gate as approved. The review should focus on the one-field fail-closed legacy impact, coordinated SQL/Edge rollout and contained rollback. Any staging/production verification requires separate explicit authorization and target identification.

## Appendix A — Complete R01 result inventory

Before/after columns refer only to the final identical-harness controlled pair. `Existing` means one of the prior 202 IDs (with the two assertion changes disclosed in §7); `New` means one of 234 continuation additions. All expected statements and sources are in `tests/release/r01-security.test.ts`; real SQL and mocked Edge layers must not be conflated.

| Record | Inventory | Before | After | Expected assertion |
|---|---|---|---|---|
| `R01.ACCEPT.EDGE-CURRENT.42501` | New | FAIL | PASS | Edge rejects failed database authority/state checks without client-side membership or profile writes |
| `R01.ACCEPT.EDGE-CURRENT.55000` | New | FAIL | PASS | Edge rejects failed database authority/state checks without client-side membership or profile writes |
| `R01.ACCEPT.EDGE-CURRENT.P0002` | New | FAIL | PASS | Edge rejects failed database authority/state checks without client-side membership or profile writes |
| `R01.ACCEPT.EDGE.expired` | Existing | PASS | PASS | Acceptance retains identity/expiry rules and obtains role/organization only from stored invitation |
| `R01.ACCEPT.EDGE.invalid` | Existing | PASS | PASS | Acceptance retains identity/expiry rules and obtains role/organization only from stored invitation |
| `R01.ACCEPT.EDGE.valid` | Existing | FAIL | PASS | Acceptance retains identity/expiry rules and obtains role/organization only from stored invitation |
| `R01.ACCEPT.EDGE.wrong-identity` | Existing | PASS | PASS | Acceptance retains identity/expiry rules and obtains role/organization only from stored invitation |
| `R01.ACCEPT.INACTIVE-OWNER` | Existing | FAIL | PASS | An admin-issued ordinary-role invitation cannot demote an existing inactive owner through acceptance |
| `R01.ACCEPT.LEGACY-PROVENANCE` | Existing | FAIL | PASS | Unverifiable historical invitation fails closed even when its stored issuer names a current owner |
| `R01.ACCEPT.RPC.expired` | Existing | PASS | PASS | Existing expired invitation is rejected without membership changes |
| `R01.ACCEPT.RPC.invalid` | Existing | PASS | PASS | Existing invalid invitation is rejected without membership changes |
| `R01.ACCEPT.RPC.wrong-identity` | Existing | PASS | PASS | Existing wrong-identity invitation is rejected without membership changes |
| `R01.CONTRACT.ENUM` | Existing | PASS | PASS | Every database membership role is included in the assignment contract matrix |
| `R01.CONTRACT.admin.accountant` | Existing | PASS | PASS | admin assigning accountant: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.admin` | Existing | PASS | PASS | admin assigning admin: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.admin.asset_manager` | Existing | PASS | PASS | admin assigning asset_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.auditor` | Existing | PASS | PASS | admin assigning auditor: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.board_member` | Existing | PASS | PASS | admin assigning board_member: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.branch_manager` | Existing | PASS | PASS | admin assigning branch_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.cashier` | Existing | PASS | PASS | admin assigning cashier: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.customer_service_rep` | Existing | PASS | PASS | admin assigning customer_service_rep: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.data_entry` | Existing | PASS | PASS | admin assigning data_entry: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.inventory_manager` | Existing | PASS | PASS | admin assigning inventory_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.manager` | Existing | PASS | PASS | admin assigning manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.owner` | Existing | PASS | PASS | admin assigning owner: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.admin.payroll_manager` | Existing | PASS | PASS | admin assigning payroll_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.purchasing_officer` | Existing | PASS | PASS | admin assigning purchasing_officer: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.sales_clerk` | Existing | PASS | PASS | admin assigning sales_clerk: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.sales_manager` | Existing | PASS | PASS | admin assigning sales_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.stock_clerk` | Existing | PASS | PASS | admin assigning stock_clerk: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.supervisor` | Existing | PASS | PASS | admin assigning supervisor: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.tax_compliance_officer` | Existing | PASS | PASS | admin assigning tax_compliance_officer: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.treasury_manager` | Existing | PASS | PASS | admin assigning treasury_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.viewer` | Existing | PASS | PASS | admin assigning viewer: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.admin.warehouse_worker` | Existing | PASS | PASS | admin assigning warehouse_worker: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.accountant` | Existing | PASS | PASS | owner assigning accountant: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.admin` | Existing | PASS | PASS | owner assigning admin: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.asset_manager` | Existing | PASS | PASS | owner assigning asset_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.auditor` | Existing | PASS | PASS | owner assigning auditor: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.board_member` | Existing | PASS | PASS | owner assigning board_member: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.branch_manager` | Existing | PASS | PASS | owner assigning branch_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.cashier` | Existing | PASS | PASS | owner assigning cashier: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.customer_service_rep` | Existing | PASS | PASS | owner assigning customer_service_rep: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.data_entry` | Existing | PASS | PASS | owner assigning data_entry: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.inventory_manager` | Existing | PASS | PASS | owner assigning inventory_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.manager` | Existing | PASS | PASS | owner assigning manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.owner` | Existing | PASS | PASS | owner assigning owner: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.payroll_manager` | Existing | PASS | PASS | owner assigning payroll_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.purchasing_officer` | Existing | PASS | PASS | owner assigning purchasing_officer: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.sales_clerk` | Existing | PASS | PASS | owner assigning sales_clerk: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.sales_manager` | Existing | PASS | PASS | owner assigning sales_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.stock_clerk` | Existing | PASS | PASS | owner assigning stock_clerk: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.supervisor` | Existing | PASS | PASS | owner assigning supervisor: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.tax_compliance_officer` | Existing | PASS | PASS | owner assigning tax_compliance_officer: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.treasury_manager` | Existing | PASS | PASS | owner assigning treasury_manager: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.viewer` | Existing | PASS | PASS | owner assigning viewer: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.owner.warehouse_worker` | Existing | PASS | PASS | owner assigning warehouse_worker: direct membership and invitation creation/acceptance ALLOWED |
| `R01.CONTRACT.viewer.accountant` | Existing | PASS | PASS | viewer assigning accountant: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.admin` | Existing | PASS | PASS | viewer assigning admin: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.asset_manager` | Existing | PASS | PASS | viewer assigning asset_manager: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.auditor` | Existing | PASS | PASS | viewer assigning auditor: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.board_member` | Existing | PASS | PASS | viewer assigning board_member: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.branch_manager` | Existing | PASS | PASS | viewer assigning branch_manager: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.cashier` | Existing | PASS | PASS | viewer assigning cashier: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.customer_service_rep` | Existing | PASS | PASS | viewer assigning customer_service_rep: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.data_entry` | Existing | PASS | PASS | viewer assigning data_entry: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.inventory_manager` | Existing | PASS | PASS | viewer assigning inventory_manager: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.manager` | Existing | PASS | PASS | viewer assigning manager: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.owner` | Existing | PASS | PASS | viewer assigning owner: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.payroll_manager` | Existing | PASS | PASS | viewer assigning payroll_manager: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.purchasing_officer` | Existing | PASS | PASS | viewer assigning purchasing_officer: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.sales_clerk` | Existing | PASS | PASS | viewer assigning sales_clerk: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.sales_manager` | Existing | PASS | PASS | viewer assigning sales_manager: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.stock_clerk` | Existing | PASS | PASS | viewer assigning stock_clerk: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.supervisor` | Existing | PASS | PASS | viewer assigning supervisor: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.tax_compliance_officer` | Existing | PASS | PASS | viewer assigning tax_compliance_officer: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.treasury_manager` | Existing | PASS | PASS | viewer assigning treasury_manager: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.viewer` | Existing | PASS | PASS | viewer assigning viewer: direct membership and invitation creation/acceptance DENIED |
| `R01.CONTRACT.viewer.warehouse_worker` | Existing | PASS | PASS | viewer assigning warehouse_worker: direct membership and invitation creation/acceptance DENIED |
| `R01.CREATE.EDGE.admin.accountant` | Existing | PASS | PASS | admin may create accountant invitation through the existing handler |
| `R01.CREATE.EDGE.admin.admin` | Existing | PASS | PASS | admin may not create admin invitation through the existing handler |
| `R01.CREATE.EDGE.admin.asset_manager` | Existing | PASS | PASS | admin may create asset_manager invitation through the existing handler |
| `R01.CREATE.EDGE.admin.auditor` | Existing | PASS | PASS | admin may create auditor invitation through the existing handler |
| `R01.CREATE.EDGE.admin.board_member` | Existing | PASS | PASS | admin may create board_member invitation through the existing handler |
| `R01.CREATE.EDGE.admin.branch_manager` | Existing | PASS | PASS | admin may create branch_manager invitation through the existing handler |
| `R01.CREATE.EDGE.admin.cashier` | Existing | PASS | PASS | admin may create cashier invitation through the existing handler |
| `R01.CREATE.EDGE.admin.customer_service_rep` | Existing | PASS | PASS | admin may create customer_service_rep invitation through the existing handler |
| `R01.CREATE.EDGE.admin.data_entry` | Existing | PASS | PASS | admin may create data_entry invitation through the existing handler |
| `R01.CREATE.EDGE.admin.inventory_manager` | Existing | PASS | PASS | admin may create inventory_manager invitation through the existing handler |
| `R01.CREATE.EDGE.admin.manager` | Existing | PASS | PASS | admin may create manager invitation through the existing handler |
| `R01.CREATE.EDGE.admin.owner` | Existing | PASS | PASS | admin may not create owner invitation through the existing handler |
| `R01.CREATE.EDGE.admin.payroll_manager` | Existing | PASS | PASS | admin may create payroll_manager invitation through the existing handler |
| `R01.CREATE.EDGE.admin.purchasing_officer` | Existing | PASS | PASS | admin may create purchasing_officer invitation through the existing handler |
| `R01.CREATE.EDGE.admin.sales_clerk` | Existing | PASS | PASS | admin may create sales_clerk invitation through the existing handler |
| `R01.CREATE.EDGE.admin.sales_manager` | Existing | PASS | PASS | admin may create sales_manager invitation through the existing handler |
| `R01.CREATE.EDGE.admin.stock_clerk` | Existing | PASS | PASS | admin may create stock_clerk invitation through the existing handler |
| `R01.CREATE.EDGE.admin.supervisor` | Existing | PASS | PASS | admin may create supervisor invitation through the existing handler |
| `R01.CREATE.EDGE.admin.tax_compliance_officer` | Existing | PASS | PASS | admin may create tax_compliance_officer invitation through the existing handler |
| `R01.CREATE.EDGE.admin.treasury_manager` | Existing | PASS | PASS | admin may create treasury_manager invitation through the existing handler |
| `R01.CREATE.EDGE.admin.viewer` | Existing | PASS | PASS | admin may create viewer invitation through the existing handler |
| `R01.CREATE.EDGE.admin.warehouse_worker` | Existing | PASS | PASS | admin may create warehouse_worker invitation through the existing handler |
| `R01.CREATE.EDGE.owner.accountant` | Existing | PASS | PASS | owner may create accountant invitation through the existing handler |
| `R01.CREATE.EDGE.owner.admin` | Existing | PASS | PASS | owner may create admin invitation through the existing handler |
| `R01.CREATE.EDGE.owner.asset_manager` | Existing | PASS | PASS | owner may create asset_manager invitation through the existing handler |
| `R01.CREATE.EDGE.owner.auditor` | Existing | PASS | PASS | owner may create auditor invitation through the existing handler |
| `R01.CREATE.EDGE.owner.board_member` | Existing | PASS | PASS | owner may create board_member invitation through the existing handler |
| `R01.CREATE.EDGE.owner.branch_manager` | Existing | PASS | PASS | owner may create branch_manager invitation through the existing handler |
| `R01.CREATE.EDGE.owner.cashier` | Existing | PASS | PASS | owner may create cashier invitation through the existing handler |
| `R01.CREATE.EDGE.owner.customer_service_rep` | Existing | PASS | PASS | owner may create customer_service_rep invitation through the existing handler |
| `R01.CREATE.EDGE.owner.data_entry` | Existing | PASS | PASS | owner may create data_entry invitation through the existing handler |
| `R01.CREATE.EDGE.owner.inventory_manager` | Existing | PASS | PASS | owner may create inventory_manager invitation through the existing handler |
| `R01.CREATE.EDGE.owner.manager` | Existing | PASS | PASS | owner may create manager invitation through the existing handler |
| `R01.CREATE.EDGE.owner.owner` | Existing | PASS | PASS | owner may create owner invitation through the existing handler |
| `R01.CREATE.EDGE.owner.payroll_manager` | Existing | PASS | PASS | owner may create payroll_manager invitation through the existing handler |
| `R01.CREATE.EDGE.owner.purchasing_officer` | Existing | PASS | PASS | owner may create purchasing_officer invitation through the existing handler |
| `R01.CREATE.EDGE.owner.sales_clerk` | Existing | PASS | PASS | owner may create sales_clerk invitation through the existing handler |
| `R01.CREATE.EDGE.owner.sales_manager` | Existing | PASS | PASS | owner may create sales_manager invitation through the existing handler |
| `R01.CREATE.EDGE.owner.stock_clerk` | Existing | PASS | PASS | owner may create stock_clerk invitation through the existing handler |
| `R01.CREATE.EDGE.owner.supervisor` | Existing | PASS | PASS | owner may create supervisor invitation through the existing handler |
| `R01.CREATE.EDGE.owner.tax_compliance_officer` | Existing | PASS | PASS | owner may create tax_compliance_officer invitation through the existing handler |
| `R01.CREATE.EDGE.owner.treasury_manager` | Existing | PASS | PASS | owner may create treasury_manager invitation through the existing handler |
| `R01.CREATE.EDGE.owner.viewer` | Existing | PASS | PASS | owner may create viewer invitation through the existing handler |
| `R01.CREATE.EDGE.owner.warehouse_worker` | Existing | PASS | PASS | owner may create warehouse_worker invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.accountant` | Existing | PASS | PASS | viewer may not create accountant invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.admin` | Existing | PASS | PASS | viewer may not create admin invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.asset_manager` | Existing | PASS | PASS | viewer may not create asset_manager invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.auditor` | Existing | PASS | PASS | viewer may not create auditor invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.board_member` | Existing | PASS | PASS | viewer may not create board_member invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.branch_manager` | Existing | PASS | PASS | viewer may not create branch_manager invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.cashier` | Existing | PASS | PASS | viewer may not create cashier invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.customer_service_rep` | Existing | PASS | PASS | viewer may not create customer_service_rep invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.data_entry` | Existing | PASS | PASS | viewer may not create data_entry invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.inventory_manager` | Existing | PASS | PASS | viewer may not create inventory_manager invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.manager` | Existing | PASS | PASS | viewer may not create manager invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.owner` | Existing | PASS | PASS | viewer may not create owner invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.payroll_manager` | Existing | PASS | PASS | viewer may not create payroll_manager invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.purchasing_officer` | Existing | PASS | PASS | viewer may not create purchasing_officer invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.sales_clerk` | Existing | PASS | PASS | viewer may not create sales_clerk invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.sales_manager` | Existing | PASS | PASS | viewer may not create sales_manager invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.stock_clerk` | Existing | PASS | PASS | viewer may not create stock_clerk invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.supervisor` | Existing | PASS | PASS | viewer may not create supervisor invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.tax_compliance_officer` | Existing | PASS | PASS | viewer may not create tax_compliance_officer invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.treasury_manager` | Existing | PASS | PASS | viewer may not create treasury_manager invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.viewer` | Existing | PASS | PASS | viewer may not create viewer invitation through the existing handler |
| `R01.CREATE.EDGE.viewer.warehouse_worker` | Existing | PASS | PASS | viewer may not create warehouse_worker invitation through the existing handler |
| `R01.CURRENT.ALREADY-MEMBER` | New | PASS | PASS | Legacy acceptance acknowledges existing access without changing role, still ensuring required profile fields |
| `R01.CURRENT.CATALOG` | New | FAIL | PASS | Acceptance eligibility defaults fail closed, and only service SQL role has direct execution of the atomic membership RPC |
| `R01.CURRENT.ELIGIBILITY-IMMUTABLE` | New | FAIL | PASS | Even an owner cannot self-certify a legacy marker with a metadata-only direct update |
| `R01.CURRENT.ISSUER-LOCK` | New | FAIL | PASS | Issuer demotion cannot interleave between successful SQL acceptance and transaction commit |
| `R01.CURRENT.SERVICE-RPC-DENY` | New | FAIL | PASS | Authenticated users cannot invoke the service-only acceptance mutation with forged recipient identifiers |
| `R01.CURRENT.SERVICE-SNAPSHOT.changed` | New | FAIL | PASS | Service-only role mutation requires the identity/role/org snapshot already checked by the handler |
| `R01.CURRENT.SERVICE-SNAPSHOT.valid` | New | FAIL | PASS | Service-only role mutation requires the identity/role/org snapshot already checked by the handler |
| `R01.CURRENT.accountant.authorized` | New | PASS | PASS | Acceptance of accountant with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.accountant.banned` | New | FAIL | PASS | Acceptance of accountant with banned issuer is DENIED under current role authority |
| `R01.CURRENT.accountant.deleted` | New | FAIL | PASS | Acceptance of accountant with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.accountant.demoted` | New | FAIL | PASS | Acceptance of accountant with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.accountant.inactive` | New | FAIL | PASS | Acceptance of accountant with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.accountant.missing` | New | FAIL | PASS | Acceptance of accountant with missing issuer is DENIED under current role authority |
| `R01.CURRENT.accountant.null-issuer` | New | FAIL | PASS | Acceptance of accountant with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.accountant.owner-to-admin` | New | PASS | PASS | Acceptance of accountant with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.accountant.unverifiable` | New | FAIL | PASS | Acceptance of accountant with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.accountant.wrong-org` | New | FAIL | PASS | Acceptance of accountant with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.admin.authorized` | New | PASS | PASS | Acceptance of admin with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.admin.banned` | New | FAIL | PASS | Acceptance of admin with banned issuer is DENIED under current role authority |
| `R01.CURRENT.admin.deleted` | New | FAIL | PASS | Acceptance of admin with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.admin.demoted` | New | FAIL | PASS | Acceptance of admin with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.admin.inactive` | New | FAIL | PASS | Acceptance of admin with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.admin.missing` | New | FAIL | PASS | Acceptance of admin with missing issuer is DENIED under current role authority |
| `R01.CURRENT.admin.null-issuer` | New | FAIL | PASS | Acceptance of admin with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.admin.owner-to-admin` | New | FAIL | PASS | Acceptance of admin with owner-to-admin issuer is DENIED under current role authority |
| `R01.CURRENT.admin.unverifiable` | New | FAIL | PASS | Acceptance of admin with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.admin.wrong-org` | New | FAIL | PASS | Acceptance of admin with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.authorized` | New | PASS | PASS | Acceptance of asset_manager with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.asset_manager.banned` | New | FAIL | PASS | Acceptance of asset_manager with banned issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.deleted` | New | FAIL | PASS | Acceptance of asset_manager with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.demoted` | New | FAIL | PASS | Acceptance of asset_manager with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.inactive` | New | FAIL | PASS | Acceptance of asset_manager with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.missing` | New | FAIL | PASS | Acceptance of asset_manager with missing issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.null-issuer` | New | FAIL | PASS | Acceptance of asset_manager with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.owner-to-admin` | New | PASS | PASS | Acceptance of asset_manager with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.asset_manager.unverifiable` | New | FAIL | PASS | Acceptance of asset_manager with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.asset_manager.wrong-org` | New | FAIL | PASS | Acceptance of asset_manager with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.authorized` | New | PASS | PASS | Acceptance of auditor with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.auditor.banned` | New | FAIL | PASS | Acceptance of auditor with banned issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.deleted` | New | FAIL | PASS | Acceptance of auditor with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.demoted` | New | FAIL | PASS | Acceptance of auditor with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.inactive` | New | FAIL | PASS | Acceptance of auditor with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.missing` | New | FAIL | PASS | Acceptance of auditor with missing issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.null-issuer` | New | FAIL | PASS | Acceptance of auditor with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.owner-to-admin` | New | PASS | PASS | Acceptance of auditor with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.auditor.unverifiable` | New | FAIL | PASS | Acceptance of auditor with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.auditor.wrong-org` | New | FAIL | PASS | Acceptance of auditor with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.authorized` | New | PASS | PASS | Acceptance of board_member with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.board_member.banned` | New | FAIL | PASS | Acceptance of board_member with banned issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.deleted` | New | FAIL | PASS | Acceptance of board_member with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.demoted` | New | FAIL | PASS | Acceptance of board_member with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.inactive` | New | FAIL | PASS | Acceptance of board_member with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.missing` | New | FAIL | PASS | Acceptance of board_member with missing issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.null-issuer` | New | FAIL | PASS | Acceptance of board_member with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.owner-to-admin` | New | PASS | PASS | Acceptance of board_member with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.board_member.unverifiable` | New | FAIL | PASS | Acceptance of board_member with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.board_member.wrong-org` | New | FAIL | PASS | Acceptance of board_member with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.authorized` | New | PASS | PASS | Acceptance of branch_manager with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.branch_manager.banned` | New | FAIL | PASS | Acceptance of branch_manager with banned issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.deleted` | New | FAIL | PASS | Acceptance of branch_manager with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.demoted` | New | FAIL | PASS | Acceptance of branch_manager with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.inactive` | New | FAIL | PASS | Acceptance of branch_manager with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.missing` | New | FAIL | PASS | Acceptance of branch_manager with missing issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.null-issuer` | New | FAIL | PASS | Acceptance of branch_manager with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.owner-to-admin` | New | PASS | PASS | Acceptance of branch_manager with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.branch_manager.unverifiable` | New | FAIL | PASS | Acceptance of branch_manager with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.branch_manager.wrong-org` | New | FAIL | PASS | Acceptance of branch_manager with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.authorized` | New | PASS | PASS | Acceptance of cashier with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.cashier.banned` | New | FAIL | PASS | Acceptance of cashier with banned issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.deleted` | New | FAIL | PASS | Acceptance of cashier with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.demoted` | New | FAIL | PASS | Acceptance of cashier with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.inactive` | New | FAIL | PASS | Acceptance of cashier with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.missing` | New | FAIL | PASS | Acceptance of cashier with missing issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.null-issuer` | New | FAIL | PASS | Acceptance of cashier with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.owner-to-admin` | New | PASS | PASS | Acceptance of cashier with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.cashier.unverifiable` | New | FAIL | PASS | Acceptance of cashier with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.cashier.wrong-org` | New | FAIL | PASS | Acceptance of cashier with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.authorized` | New | PASS | PASS | Acceptance of customer_service_rep with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.customer_service_rep.banned` | New | FAIL | PASS | Acceptance of customer_service_rep with banned issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.deleted` | New | FAIL | PASS | Acceptance of customer_service_rep with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.demoted` | New | FAIL | PASS | Acceptance of customer_service_rep with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.inactive` | New | FAIL | PASS | Acceptance of customer_service_rep with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.missing` | New | FAIL | PASS | Acceptance of customer_service_rep with missing issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.null-issuer` | New | FAIL | PASS | Acceptance of customer_service_rep with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.owner-to-admin` | New | PASS | PASS | Acceptance of customer_service_rep with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.customer_service_rep.unverifiable` | New | FAIL | PASS | Acceptance of customer_service_rep with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.customer_service_rep.wrong-org` | New | FAIL | PASS | Acceptance of customer_service_rep with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.authorized` | New | PASS | PASS | Acceptance of data_entry with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.data_entry.banned` | New | FAIL | PASS | Acceptance of data_entry with banned issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.deleted` | New | FAIL | PASS | Acceptance of data_entry with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.demoted` | New | FAIL | PASS | Acceptance of data_entry with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.inactive` | New | FAIL | PASS | Acceptance of data_entry with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.missing` | New | FAIL | PASS | Acceptance of data_entry with missing issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.null-issuer` | New | FAIL | PASS | Acceptance of data_entry with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.owner-to-admin` | New | PASS | PASS | Acceptance of data_entry with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.data_entry.unverifiable` | New | FAIL | PASS | Acceptance of data_entry with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.data_entry.wrong-org` | New | FAIL | PASS | Acceptance of data_entry with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.authorized` | New | PASS | PASS | Acceptance of inventory_manager with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.inventory_manager.banned` | New | FAIL | PASS | Acceptance of inventory_manager with banned issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.deleted` | New | FAIL | PASS | Acceptance of inventory_manager with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.demoted` | New | FAIL | PASS | Acceptance of inventory_manager with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.inactive` | New | FAIL | PASS | Acceptance of inventory_manager with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.missing` | New | FAIL | PASS | Acceptance of inventory_manager with missing issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.null-issuer` | New | FAIL | PASS | Acceptance of inventory_manager with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.owner-to-admin` | New | PASS | PASS | Acceptance of inventory_manager with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.inventory_manager.unverifiable` | New | FAIL | PASS | Acceptance of inventory_manager with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.inventory_manager.wrong-org` | New | FAIL | PASS | Acceptance of inventory_manager with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.manager.authorized` | New | PASS | PASS | Acceptance of manager with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.manager.banned` | New | FAIL | PASS | Acceptance of manager with banned issuer is DENIED under current role authority |
| `R01.CURRENT.manager.deleted` | New | FAIL | PASS | Acceptance of manager with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.manager.demoted` | New | FAIL | PASS | Acceptance of manager with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.manager.inactive` | New | FAIL | PASS | Acceptance of manager with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.manager.missing` | New | FAIL | PASS | Acceptance of manager with missing issuer is DENIED under current role authority |
| `R01.CURRENT.manager.null-issuer` | New | FAIL | PASS | Acceptance of manager with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.manager.owner-to-admin` | New | PASS | PASS | Acceptance of manager with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.manager.unverifiable` | New | FAIL | PASS | Acceptance of manager with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.manager.wrong-org` | New | FAIL | PASS | Acceptance of manager with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.owner.authorized` | New | PASS | PASS | Acceptance of owner with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.owner.banned` | New | FAIL | PASS | Acceptance of owner with banned issuer is DENIED under current role authority |
| `R01.CURRENT.owner.deleted` | New | FAIL | PASS | Acceptance of owner with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.owner.demoted` | New | FAIL | PASS | Acceptance of owner with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.owner.inactive` | New | FAIL | PASS | Acceptance of owner with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.owner.missing` | New | FAIL | PASS | Acceptance of owner with missing issuer is DENIED under current role authority |
| `R01.CURRENT.owner.null-issuer` | New | FAIL | PASS | Acceptance of owner with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.owner.owner-to-admin` | New | FAIL | PASS | Acceptance of owner with owner-to-admin issuer is DENIED under current role authority |
| `R01.CURRENT.owner.unverifiable` | New | FAIL | PASS | Acceptance of owner with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.owner.wrong-org` | New | FAIL | PASS | Acceptance of owner with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.authorized` | New | PASS | PASS | Acceptance of payroll_manager with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.payroll_manager.banned` | New | FAIL | PASS | Acceptance of payroll_manager with banned issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.deleted` | New | FAIL | PASS | Acceptance of payroll_manager with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.demoted` | New | FAIL | PASS | Acceptance of payroll_manager with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.inactive` | New | FAIL | PASS | Acceptance of payroll_manager with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.missing` | New | FAIL | PASS | Acceptance of payroll_manager with missing issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.null-issuer` | New | FAIL | PASS | Acceptance of payroll_manager with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.owner-to-admin` | New | PASS | PASS | Acceptance of payroll_manager with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.payroll_manager.unverifiable` | New | FAIL | PASS | Acceptance of payroll_manager with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.payroll_manager.wrong-org` | New | FAIL | PASS | Acceptance of payroll_manager with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.authorized` | New | PASS | PASS | Acceptance of purchasing_officer with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.purchasing_officer.banned` | New | FAIL | PASS | Acceptance of purchasing_officer with banned issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.deleted` | New | FAIL | PASS | Acceptance of purchasing_officer with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.demoted` | New | FAIL | PASS | Acceptance of purchasing_officer with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.inactive` | New | FAIL | PASS | Acceptance of purchasing_officer with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.missing` | New | FAIL | PASS | Acceptance of purchasing_officer with missing issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.null-issuer` | New | FAIL | PASS | Acceptance of purchasing_officer with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.owner-to-admin` | New | PASS | PASS | Acceptance of purchasing_officer with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.purchasing_officer.unverifiable` | New | FAIL | PASS | Acceptance of purchasing_officer with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.purchasing_officer.wrong-org` | New | FAIL | PASS | Acceptance of purchasing_officer with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.authorized` | New | PASS | PASS | Acceptance of sales_clerk with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.sales_clerk.banned` | New | FAIL | PASS | Acceptance of sales_clerk with banned issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.deleted` | New | FAIL | PASS | Acceptance of sales_clerk with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.demoted` | New | FAIL | PASS | Acceptance of sales_clerk with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.inactive` | New | FAIL | PASS | Acceptance of sales_clerk with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.missing` | New | FAIL | PASS | Acceptance of sales_clerk with missing issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.null-issuer` | New | FAIL | PASS | Acceptance of sales_clerk with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.owner-to-admin` | New | PASS | PASS | Acceptance of sales_clerk with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.sales_clerk.unverifiable` | New | FAIL | PASS | Acceptance of sales_clerk with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.sales_clerk.wrong-org` | New | FAIL | PASS | Acceptance of sales_clerk with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.authorized` | New | PASS | PASS | Acceptance of sales_manager with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.sales_manager.banned` | New | FAIL | PASS | Acceptance of sales_manager with banned issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.deleted` | New | FAIL | PASS | Acceptance of sales_manager with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.demoted` | New | FAIL | PASS | Acceptance of sales_manager with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.inactive` | New | FAIL | PASS | Acceptance of sales_manager with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.missing` | New | FAIL | PASS | Acceptance of sales_manager with missing issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.null-issuer` | New | FAIL | PASS | Acceptance of sales_manager with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.owner-to-admin` | New | PASS | PASS | Acceptance of sales_manager with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.sales_manager.unverifiable` | New | FAIL | PASS | Acceptance of sales_manager with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.sales_manager.wrong-org` | New | FAIL | PASS | Acceptance of sales_manager with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.authorized` | New | PASS | PASS | Acceptance of stock_clerk with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.stock_clerk.banned` | New | FAIL | PASS | Acceptance of stock_clerk with banned issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.deleted` | New | FAIL | PASS | Acceptance of stock_clerk with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.demoted` | New | FAIL | PASS | Acceptance of stock_clerk with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.inactive` | New | FAIL | PASS | Acceptance of stock_clerk with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.missing` | New | FAIL | PASS | Acceptance of stock_clerk with missing issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.null-issuer` | New | FAIL | PASS | Acceptance of stock_clerk with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.owner-to-admin` | New | PASS | PASS | Acceptance of stock_clerk with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.stock_clerk.unverifiable` | New | FAIL | PASS | Acceptance of stock_clerk with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.stock_clerk.wrong-org` | New | FAIL | PASS | Acceptance of stock_clerk with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.authorized` | New | PASS | PASS | Acceptance of supervisor with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.supervisor.banned` | New | FAIL | PASS | Acceptance of supervisor with banned issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.deleted` | New | FAIL | PASS | Acceptance of supervisor with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.demoted` | New | FAIL | PASS | Acceptance of supervisor with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.inactive` | New | FAIL | PASS | Acceptance of supervisor with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.missing` | New | FAIL | PASS | Acceptance of supervisor with missing issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.null-issuer` | New | FAIL | PASS | Acceptance of supervisor with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.owner-to-admin` | New | PASS | PASS | Acceptance of supervisor with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.supervisor.unverifiable` | New | FAIL | PASS | Acceptance of supervisor with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.supervisor.wrong-org` | New | FAIL | PASS | Acceptance of supervisor with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.authorized` | New | PASS | PASS | Acceptance of tax_compliance_officer with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.tax_compliance_officer.banned` | New | FAIL | PASS | Acceptance of tax_compliance_officer with banned issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.deleted` | New | FAIL | PASS | Acceptance of tax_compliance_officer with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.demoted` | New | FAIL | PASS | Acceptance of tax_compliance_officer with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.inactive` | New | FAIL | PASS | Acceptance of tax_compliance_officer with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.missing` | New | FAIL | PASS | Acceptance of tax_compliance_officer with missing issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.null-issuer` | New | FAIL | PASS | Acceptance of tax_compliance_officer with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.owner-to-admin` | New | PASS | PASS | Acceptance of tax_compliance_officer with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.tax_compliance_officer.unverifiable` | New | FAIL | PASS | Acceptance of tax_compliance_officer with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.tax_compliance_officer.wrong-org` | New | FAIL | PASS | Acceptance of tax_compliance_officer with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.authorized` | New | PASS | PASS | Acceptance of treasury_manager with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.treasury_manager.banned` | New | FAIL | PASS | Acceptance of treasury_manager with banned issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.deleted` | New | FAIL | PASS | Acceptance of treasury_manager with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.demoted` | New | FAIL | PASS | Acceptance of treasury_manager with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.inactive` | New | FAIL | PASS | Acceptance of treasury_manager with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.missing` | New | FAIL | PASS | Acceptance of treasury_manager with missing issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.null-issuer` | New | FAIL | PASS | Acceptance of treasury_manager with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.owner-to-admin` | New | PASS | PASS | Acceptance of treasury_manager with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.treasury_manager.unverifiable` | New | FAIL | PASS | Acceptance of treasury_manager with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.treasury_manager.wrong-org` | New | FAIL | PASS | Acceptance of treasury_manager with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.authorized` | New | PASS | PASS | Acceptance of viewer with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.viewer.banned` | New | FAIL | PASS | Acceptance of viewer with banned issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.deleted` | New | FAIL | PASS | Acceptance of viewer with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.demoted` | New | FAIL | PASS | Acceptance of viewer with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.inactive` | New | FAIL | PASS | Acceptance of viewer with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.missing` | New | FAIL | PASS | Acceptance of viewer with missing issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.null-issuer` | New | FAIL | PASS | Acceptance of viewer with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.owner-to-admin` | New | PASS | PASS | Acceptance of viewer with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.viewer.unverifiable` | New | FAIL | PASS | Acceptance of viewer with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.viewer.wrong-org` | New | FAIL | PASS | Acceptance of viewer with wrong-org issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.authorized` | New | PASS | PASS | Acceptance of warehouse_worker with authorized issuer is ALLOWED under current role authority |
| `R01.CURRENT.warehouse_worker.banned` | New | FAIL | PASS | Acceptance of warehouse_worker with banned issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.deleted` | New | FAIL | PASS | Acceptance of warehouse_worker with deleted issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.demoted` | New | FAIL | PASS | Acceptance of warehouse_worker with demoted issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.inactive` | New | FAIL | PASS | Acceptance of warehouse_worker with inactive issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.missing` | New | FAIL | PASS | Acceptance of warehouse_worker with missing issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.null-issuer` | New | FAIL | PASS | Acceptance of warehouse_worker with null-issuer issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.owner-to-admin` | New | PASS | PASS | Acceptance of warehouse_worker with owner-to-admin issuer is ALLOWED under current role authority |
| `R01.CURRENT.warehouse_worker.unverifiable` | New | FAIL | PASS | Acceptance of warehouse_worker with unverifiable issuer is DENIED under current role authority |
| `R01.CURRENT.warehouse_worker.wrong-org` | New | FAIL | PASS | Acceptance of warehouse_worker with wrong-org issuer is DENIED under current role authority |
| `R01.INVITATION.ACCEPTANCE.INACTIVE_OWNER` | New | FAIL | PASS | Admin issues ordinary invitation while owner active; owner becomes inactive; acceptance denied and owner membership unchanged |
| `R01.INVITE.ALLOW.A_admin.viewer` | Existing | PASS | PASS | A_admin can directly issue authorized viewer invitation |
| `R01.INVITE.ALLOW.A_owner.admin` | Existing | PASS | PASS | A_owner can directly issue authorized admin invitation |
| `R01.INVITE.ALLOW.A_owner.owner` | Existing | PASS | PASS | A_owner can directly issue authorized owner invitation |
| `R01.INVITE.CROSS.A` | Existing | PASS | PASS | A owner cannot create an invitation belonging to B |
| `R01.INVITE.CROSS.B` | Existing | PASS | PASS | B owner cannot create an invitation belonging to A |
| `R01.INVITE.DENY.A_admin.admin` | Existing | PASS | PASS | A_admin cannot directly issue admin invitation |
| `R01.INVITE.DENY.A_admin.owner` | Existing | PASS | PASS | A_admin cannot directly issue owner invitation |
| `R01.INVITE.DENY.A_viewer.owner` | Existing | PASS | PASS | A_viewer cannot directly issue owner invitation |
| `R01.INVITE.DENY.A_viewer.viewer` | Existing | PASS | PASS | A_viewer cannot directly issue viewer invitation |
| `R01.INVITE.FORGED-ISSUER` | Existing | PASS | PASS | Admin cannot claim that an owner issued its invitation |
| `R01.INVITE.IMMUTABLE.business_id` | Existing | PASS | PASS | Direct UPDATE cannot replace invitation business_id |
| `R01.INVITE.IMMUTABLE.invited_by` | Existing | PASS | PASS | Direct UPDATE cannot replace invitation invited_by |
| `R01.INVITE.REVOKE` | Existing | PASS | PASS | Admin can revoke ordinary invitation; only owner may revoke privileged invitation |
| `R01.MEMBER.ADMIN-ASSIGN.admin` | Existing | PASS | PASS | Admin cannot assign admin by UPDATE |
| `R01.MEMBER.ADMIN-ASSIGN.owner` | Existing | PASS | PASS | Admin cannot assign owner by UPDATE |
| `R01.MEMBER.ADMIN-DELETE.admin` | Existing | PASS | PASS | Admin cannot delete existing admin |
| `R01.MEMBER.ADMIN-DELETE.owner` | Existing | PASS | PASS | Admin cannot delete existing owner |
| `R01.MEMBER.ADMIN-DEMOTE-PEER` | Existing | PASS | PASS | Admin retains existing permission to demote another admin, not self or owner |
| `R01.MEMBER.ADMIN-INSERT.admin` | Existing | PASS | PASS | Admin cannot insert admin membership for another identity |
| `R01.MEMBER.ADMIN-INSERT.owner` | Existing | PASS | PASS | Admin cannot insert owner membership for another identity |
| `R01.MEMBER.ADMIN-REMOVE-ORDINARY` | Existing | PASS | PASS | Admin retains ordinary member soft removal, token clearing and hard removal |
| `R01.MEMBER.ADMIN-SELF` | Existing | PASS | PASS | Admin cannot promote own membership to owner |
| `R01.MEMBER.ADMIN-TARGET.admin` | Existing | PASS | PASS | Admin cannot demote existing admin |
| `R01.MEMBER.ADMIN-TARGET.owner` | Existing | PASS | PASS | Admin cannot demote existing owner |
| `R01.MEMBER.ADMIN-UPSERT` | Existing | PASS | PASS | Admin cannot bypass privileged assignment by ON CONFLICT |
| `R01.MEMBER.ALLOW.A_admin.accountant` | Existing | PASS | PASS | Authorized A_admin can assign accountant in own business |
| `R01.MEMBER.ALLOW.A_owner.admin` | Existing | PASS | PASS | Authorized A_owner can assign admin in own business |
| `R01.MEMBER.ALLOW.A_owner.owner` | Existing | PASS | PASS | Authorized A_owner can assign owner in own business |
| `R01.MEMBER.EDGE-REACTIVATE.admin` | Existing | PASS | PASS | Direct service-backed member invitation cannot bypass owner-target protection |
| `R01.MEMBER.EDGE-REACTIVATE.owner` | Existing | PASS | PASS | Direct service-backed member invitation cannot bypass owner-target protection |
| `R01.MEMBER.IDENTITY` | Existing | PASS | PASS | Even a manager of both businesses cannot relocate a membership row |
| `R01.MIGRATION.STATE` | Existing | PASS | PASS | Three invoker guards installed, RLS retained, trigger helpers not publicly callable |
| `R01.PLATFORM.DIRECTORY` | Existing | PASS | PASS | Ordinary caller denied; trusted platform operator retains cross-business directory |
| `R01.PLATFORM.MANUAL-GRANT` | Existing | PASS | PASS | Authorized platform operator retains manual-grant handler path |
| `R01.PROFILE.BENIGN` | Existing | PASS | PASS | Own name, avatar, language, currency and update timestamp remain editable |
| `R01.PROFILE.CLAIM-NOT-ROLE` | Existing | PASS | PASS | A service_role claim string cannot turn authenticated SQL execution into trusted service execution |
| `R01.PROFILE.MIXED-ATOMIC` | Existing | PASS | PASS | Combining a legitimate name edit and privileged flag change is wholly denied |
| `R01.PROFILE.PLATFORM-BENIGN` | Existing | PASS | PASS | Flagged platform operator can edit name with unchanged privileged fields |
| `R01.PROFILE.PLATFORM-NO-DELEGATION` | Existing | PASS | PASS | Platform UI flag does not grant arbitrary profile mutation authority |
| `R01.PROFILE.PROTECTED.created_at` | Existing | PASS | PASS | Own created_at cannot be self-asserted; denied statement preserves all rows |
| `R01.PROFILE.PROTECTED.deletion_finalized_at` | Existing | PASS | PASS | Own deletion_finalized_at cannot be self-asserted; denied statement preserves all rows |
| `R01.PROFILE.PROTECTED.deletion_requested_at` | Existing | PASS | PASS | Own deletion_requested_at cannot be self-asserted; denied statement preserves all rows |
| `R01.PROFILE.PROTECTED.is_platform_admin` | Existing | PASS | PASS | Own is_platform_admin cannot be self-asserted; denied statement preserves all rows |
| `R01.PROFILE.PROTECTED.phone` | Existing | PASS | PASS | Own phone cannot be self-asserted; denied statement preserves all rows |
| `R01.PROFILE.SERVICE-LIFECYCLE` | Existing | PASS | PASS | Real service SQL role retains privileged profile write, request/cancel/finalize capability |
| `R01.PROFILE.UPSERT` | Existing | PASS | PASS | Whole-row upsert cannot set own privileged flag through INSERT/ON CONFLICT |
| `R01.PROVISION.email-fallback` | New | FAIL | PASS | Service provisioning supplies required profile name, preserves existing fields, creates intended business membership and remains idempotent |
| `R01.PROVISION.existing-profile` | New | FAIL | PASS | Service provisioning supplies required profile name, preserves existing fields, creates intended business membership and remains idempotent |
| `R01.PROVISION.metadata-name` | New | FAIL | PASS | Service provisioning supplies required profile name, preserves existing fields, creates intended business membership and remains idempotent |
| `R01.RPC.CREATE-BUSINESS` | Existing | PASS | PASS | Authenticated provisioning still creates caller-owned business without granting arbitrary old-business ownership |
| `R01.RPC.INVITE-PRIVILEGED-DENY` | Existing | PASS | PASS | Existing invite_member RPC denies admin owner-role invitation |
| `R01.RPC.SERVICE-ALLOW.grant_user_business_access` | Existing | FAIL | PASS | grant_user_business_access remains available for intentional service provisioning across businesses |
| `R01.RPC.SERVICE-ALLOW.set_user_business_access` | Existing | PASS | PASS | set_user_business_access remains available for intentional service provisioning across businesses |
| `R01.RPC.SERVICE-ONLY.grant_user_business_access` | Existing | PASS | PASS | grant_user_business_access cannot be called by authenticated user with foreign target identifiers |
| `R01.RPC.SERVICE-ONLY.set_user_business_access` | Existing | PASS | PASS | set_user_business_access cannot be called by authenticated user with foreign target identifiers |
| `R01.TENANT.A.PRIVILEGED` | Existing | PASS | PASS | A manager cannot insert an owner membership into B |
| `R01.TENANT.A.delete` | Existing | PASS | PASS | Legitimate own profile access; A cannot delete B profile or membership |
| `R01.TENANT.A.read` | Existing | PASS | PASS | Legitimate own profile access; A cannot read B profile or membership |
| `R01.TENANT.A.update` | Existing | PASS | PASS | Legitimate own profile access; A cannot update B profile or membership |
| `R01.TENANT.B.PRIVILEGED` | Existing | PASS | PASS | B manager cannot insert an owner membership into A |
| `R01.TENANT.B.delete` | Existing | PASS | PASS | Legitimate own profile access; B cannot delete A profile or membership |
| `R01.TENANT.B.read` | Existing | PASS | PASS | Legitimate own profile access; B cannot read A profile or membership |
| `R01.TENANT.B.update` | Existing | PASS | PASS | Legitimate own profile access; B cannot update A profile or membership |

## Appendix B — All unchanged original non-pass records

All 154 original outcome objects compare equal, including the following seven FAIL and 41 BLOCKED entries. These records are not converted to PASS by R01's conditional grants or adapters.

| Original ID | Status | Original register attribution | Unchanged observation |
|---|---|---|---|
| `AI.ANON` | FAIL | R03 | Forbidden operation completed without permission denial. |
| `AI.BRANCH` | BLOCKED | R11 | Durable branch assignment and field-permission contract require design approval. |
| `AI.ROLE` | FAIL | R11 | Forbidden operation completed without permission denial. |
| `AUTH.expired-session` | BLOCKED | R01/R02 | No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence. |
| `AUTH.invalid-login` | BLOCKED | R01/R02 | No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence. |
| `AUTH.logout-revocation` | BLOCKED | R01/R02 | No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence. |
| `AUTH.valid-login` | BLOCKED | R01/R02 | No isolated Supabase Auth service configured. Mock getUser checks above are not login, JWT expiry, or logout-revocation evidence. |
| `BILLING.SERVER-QUOTA` | BLOCKED | R10 | Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented. |
| `BRANCH.create` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `BRANCH.cross-branch-admin` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `BRANCH.customers` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `BRANCH.financial` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `BRANCH.inventory` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `BRANCH.modify` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `BRANCH.read` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `BRANCH.reports` | BLOCKED | R04/R08 | A1/A2 fixtures exist, but no approved durable user-branch assignment contract. Refusing to invent assignment schema or count UI filters as enforcement. |
| `EDGE.RECOVERY.foreign-identity` | FAIL | R02 | Observed 1; expected 0. |
| `EDGE.RETRY.no-secret` | FAIL | R12/R14 | Observed 200; expected 401. |
| `EDGE.WEBHOOK.viewer` | FAIL | R12 | Observed 200; expected 403. |
| `FINANCE.REVERSAL` | BLOCKED | R05/R07 | Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented. |
| `LEGACY.paye_reference.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.phase10_2_subtype_repair.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.phase10_integrity.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.phase10_remediation.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.pos_sale_rpc.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.posting_integrity_migrations.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.quick_save_rpc_source_uuid.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.rls_security.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.rpc_reconstruction.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.storage_reconstruction.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.view_reconstruction.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `LEGACY.workflow_accounting.test.js` | BLOCKED | R13 | Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites. |
| `OFFLINE.ACTOR-BINDING` | BLOCKED | R09 | Queue has businessId but no durable originating-user/device contract; cannot assert current-user queue isolation by inventing fields. |
| `OFFLINE.BROWSER` | BLOCKED | R09 | No browser/service-worker runner; fake IndexedDB close/reopen is not browser process shutdown/cache proof. |
| `OFFLINE.CONFLICT` | BLOCKED | R09 | Timestamp fixtures exist; no approved conflict-resolution contract or generic queue update operation. |
| `OFFLINE.MULTITAB` | BLOCKED | R09 | Cross-tab concurrency/lease evidence needs approved client-identity contract and browser workers. |
| `OFFLINE.REOPEN` | BLOCKED | R09 | Post-sale caller readback lacks effective invoice/line SELECT grants in migration-only profile. No fake success or privileged read substituted. |
| `OFFLINE.RETRY` | BLOCKED | R09 | Post-sale caller readback lacks effective invoice/line SELECT grants in migration-only profile. No fake success or privileged read substituted. |
| `POS.REFUND` | BLOCKED | R07 | Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented. |
| `POS.STOCK` | FAIL | R06 | Observed 100; expected 99. |
| `POS.VOID` | BLOCKED | R07 | Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented. |
| `PRIV.INVITATION` | BLOCKED | R02 | Real identity evidence, invitation lifecycle and profile-phone fallback need isolated Auth and DB integration. |
| `PRIV.MEMBERSHIP` | BLOCKED | R01 | Effective membership UPDATE grant not represented by migration-only ACL; no grant-all test bootstrap. |
| `PRIV.PROFILE` | BLOCKED | R01 | Migration-only ACL lacks benign profile UPDATE; deployed column grants required. No synthetic grant added. |
| `PRIV.RECOVERY` | BLOCKED | R02 | Global recovery authority and verified phone proof require isolated Auth Admin + approved recovery contract. |
| `ROLE.cashier.write` | FAIL | R04 | Forbidden operation completed without permission denial. |
| `TENANT.A.storage` | BLOCKED | R04 | Own-logo positive control denied: storage policy depends on effective business_users SELECT grant absent from migration-only profile. No blanket grant added. |
| `TENANT.B.storage` | BLOCKED | R04 | Own-logo positive control denied: storage policy depends on effective business_users SELECT grant absent from migration-only profile. No blanket grant added. |

## Appendix C — Integrity and artifact fingerprints

- Original outcome map canonical SHA-256 (sorted JSON, compact separators): `80d8521e5322591d1bbabf4da807ab2dd91a81c5ddf578bbf24cf2c2f4c12d18`; matches original subset of both paired runs and final verify.
- Full final outcome map canonical SHA-256: `214bed2b264ae68224fda001df9b3bed6b743e5a222384ccc3e1c83b43238a6f`; equals independent final verify.
- Paired full harness manifest canonical SHA-256: `b675102fb2113b474a31c566fe7249130dfea1734dd29fa5ae059994fe59758e`; before/after/final verify identical.

| Evidence / changed product file | SHA-256 |
|---|---|
| `.cache/r13/ledgr-r13-k6bDIL/evidence.json` | `fb80cd6942900e47343dfc3c5fdbd64e9d2e4f1db11ed91cb80ef7ed63b4cf70` |
| `.cache/r13/ledgr-r13-LeOZM6/evidence.json` | `78d7238449b4233fe66680e175725a46a58e84c14d0193ff2b946e3e8a36ca9d` |
| `.cache/r13/ledgr-r13-XkwN9G/evidence.json` | `78d7238449b4233fe66680e175725a46a58e84c14d0193ff2b946e3e8a36ca9d` |
| `supabase/migrations/20260926000001_r01_acceptance_current_authority.sql` | `ec9eeb1fb757af30a82527724ab4720800287e20c291ebdb42c8c45a0ae80613` |
| `supabase/functions/accept-invite-link/index.ts` | `ec70394ce9bea11c7c65e194a401656943acb41a5f7c9adb1b793785d0d85028` |
| `tests/release/r01-security.test.ts` | `62f40e1d26dbfdb46b5d519db79d620411900f1a07844c8faef7abd1341e81c3` |
| `.cache/r01-current/migration-verification.json` | `78ae255d63e819cd0394a2ff316b89af12185a35b7ecb5fcde3cc488dec733eb` |

The record list, results, comparison method and migration findings are included here because generated `.cache` evidence follows the existing ignored-artifact convention. Rerun `npm run test:release` locally to regenerate fresh evidence; it intentionally remains exit 1 until the unrelated release failures/blockers are resolved through separately authorized packages.
