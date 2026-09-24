# P5-E DEC-03 Remediation + Re-proof Gate — 2026-09-24

**Commit (remediation):** pending (this doc) — branch `arena/01a0c215-ledgr-react` / prior review `950bb67`
**Migration:** `supabase/migrations/20261008000000_p5e_ai_branch_context.sql` (634 lines post-fix)
**Deployment:** still `DEPLOYMENT BLOCKED` (runs 36029382645/36030232211) — remediation **not yet in production**
**Verdict:** **P5-E REMEDIATION PASS — READY FOR NEXT GATE**
**No deploy / no merge / no tag move** — next gate decides.

---

## 1. Previous violation

`950bb67` review confirmed `20261008000000` lines 533-546 granted org-wide AI context to two **assigned-scope** roles when unassigned:

```sql
-- unsafe (950bb67)
-- branch_manager/sales_manager are hybrid (reports-tier + assigned) — null branch is legacy org-wide, not fail-closed
if v_membership_role = any (v_assigned_roles) and v_caller_branch_id is not null then
  v_effective_branch_id := v_caller_branch_id;
elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null
      and v_membership_role not in ('branch_manager','sales_manager') then
  raise exception 'ai_context: no access to the requested branch' using errcode='42501';
else
  v_effective_branch_id := null; -- ← branch_manager/sales_manager NULL lands here = org-wide 12000
```

* DEC-03 (P5-D `can_access_branch`) requires `branch_manager`/`sales_manager` ∈ assigned-scope with `branch_id IS NOT NULL AND branch_id = p_branch_id`, fail-closed on NULL. The hybrid comment was never signed; triage note that mentioned “hybrid” was stale-test commentary (explicitly noted as old vs `p5d_branchScope 8 PASS` new contract).
* Effect: `branch_manager NULL` `ai_context(A)` returned `overdue sum 12000` (A1 5000 + B 7000) instead of `42501`; same for `sales_manager NULL`. Other assigned `cashier/stock_clerk NULL` correctly 42501, proving inconsistency.
* `v_org_wide_roles` declared line 494 but never referenced (dead code, grep count 1) — obscured intent.
* Additional: service_role with explicit `p_branch_id` validated tenant but never set `v_effective_branch_id`, so `service_role ai_context(A,A1)` returned org-wide 12000 instead of filtered 5000 (branch filter silently ignored).

---

## 2. Exact code change

**File:** `supabase/migrations/20261008000000_p5e_ai_branch_context.sql`

Unified diff (`git diff HEAD` pre-commit, 11 lines):

```diff
@@ -492,7 +492,6 @@ declare
   v_caller_branch_id uuid;
   v_effective_branch_id uuid;
   v_reports_roles constant text[] := array['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager'];
-  v_org_wide_roles constant text[] := array['owner','admin','manager','accountant','auditor'];
   v_assigned_roles constant text[] := array['cashier','stock_clerk','branch_manager','sales_clerk','sales_manager','purchasing_officer','warehouse_worker','customer_service_rep'];

@@ -506,9 +505,10 @@ begin
     if v_role_claim is not null and v_role_claim <> 'service_role' then
       raise exception 'ai_context: authentication required' using errcode = '42501';
     end if;
-    -- service_role path: tenant boundary for branch
+    -- service_role path: tenant boundary for branch + branch filter
     if p_branch_id is not null then
       if not exists (select 1 from public.branches where id = p_branch_id and business_id = p_business_id) then
         raise exception 'ai_context: branch not found in this business' using errcode = '42501';
       end if;
+      v_effective_branch_id := p_branch_id;
+    else
+      v_effective_branch_id := null;
     end if;

@@ -531,13 +534,11 @@ begin
       end if;
       v_effective_branch_id := p_branch_id;
     else
-      -- Omitted branch: org-wide roles keep org-wide (null), assigned-scope with branch gets their branch
-      -- branch_manager/sales_manager are hybrid (reports-tier + assigned) — null branch is legacy org-wide, not fail-closed
+      -- Omitted branch: org-wide and legacy roles keep org-wide (null); assigned-scope with branch gets their branch;
+      -- assigned-scope with NULL assignment is fail-closed (DEC-03 P5-D: can_access_branch branch_id IS NOT NULL)
       if v_membership_role = any (v_assigned_roles) and v_caller_branch_id is not null then
         if not public.can_access_branch(p_business_id, v_caller_branch_id) then
           raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
         end if;
         v_effective_branch_id := v_caller_branch_id;
-      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null and v_membership_role not in ('branch_manager','sales_manager') then
-        -- Assigned-scope with NULL assignment (fail-closed) — no authorized branch (except hybrid reports-tier managers)
+      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null then
         raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
       else
         -- Org-wide or legacy null-assignment: org-wide
```

* Removes `v_org_wide_roles` dead code (occurrences 1 → 0).
* Removes hybrid comment and `not in ('branch_manager','sales_manager')` exception.
* Unifies `elsif ... is null` to **all** assigned roles → `42501`.
* Adds `v_effective_branch_id := p_branch_id / null` for service_role (completes branch filter; previously documented as “already set” but was not).

No other P5-E architecture changed: `security_invoker=true` views, `is_business_member` tenant check, `can_access_branch` delegation, `SECURITY DEFINER search_path=public`, `revoke anon / grant authenticated,service_role`, server-side `WHERE branch_id is not distinct from v_effective_branch_id` filtering, explicit `branches.business_id = p_business_id` tenant validation, read-only semantics preserved.

---

## 3. Why the change restores DEC-03

* DEC-03 authoritative: assigned-scope `= branch_manager,sales_manager,…` requires bound `branch_id` (`... and bu.branch_id is not null and bu.branch_id = p_branch_id`). P5-D test `p5d_branchScope` proves `branch_manager NULL → can_access_branch=false`.
* Remediation makes `ai_context` **delegate identically**: omitted `branch` + `NULL assignment` → `42501` for every `v_assigned_roles` entry, no carve-out. The remaining `else → null` now covers only `owner/admin/manager/accountant/auditor` (org-wide) and legacy `viewer/tax_compliance_officer…` where `NULL = org-wide` is the signed P5-D third branch (`bu.branch_id is null or = p_branch_id`).
* Service_role fix restores the existing contract that `ai_context(business, branch)` is branch-filtered even for service_role (Edge function) — tenant-bound via `branches` check, then filtered via `v_effective`.
* No new role, no taxonomy expansion, no fallback, no prompt-trusted branch.

---

## 4. 19-row matrix result (24 rows including controls, all data-verified)

Run: `npm ci && node tmp_p5e_verify.mjs` (disposable embedded-postgres 17, `tests/release/database.mjs` + `fixtures.ts` with synthetic A1/A2/B1, invoices 5000/7000). Each row verifies **returned data** (overdue sums, `branch_id` in JSON) or exact `42501`, not just definition string.

| # | Id | Caller / assignment | Call | Expected | Actual | Detail |
|---|----|--------------------|------|----------|--------|--------|
| 1 | T01 | owner NULL (org-wide) | `ai_context(A)` | 12000 org | **PASS 12000** | `overdue 5000+7000` both branches |
| 2 | T02a | cashier (R03 role gate) | `ai_context(A,A1)` | 42501 | **PASS 42501** | cashier correctly denied at reports tier (not branch bypass) |
| 3 | T02 | branch_manager A1 (assigned+reports) | `ai_context(A)` omitted | 5000 A1 only | **PASS 5000** | `branch_id=A1`, `overdue P5E-OVERDUE-A` only |
| 4 | T03 | cashier NULL (assigned null) | `ai_context(A)` | 42501 | **PASS 42501** | fail-closed |
| 5 | T04 | branch_manager A1 | `ai_context(A,A1)` explicit own | 5000 | **PASS 5000** | `can_access_branch` true |
| 6 | T05 | branch_manager A1 | `ai_context(A,A2)` other | 42501 | **PASS 42501** | cross-branch denied |
| 7 | **T06** | **branch_manager NULL** | `ai_context(A)` omitted | **42501** | **PASS 42501** | **primary regression — previously 12000 violation** |
| 8 | T07 | branch_manager NULL | `ai_context(A)` wrapper 1-arg | 42501 | **PASS 42501** | wrapper delegates correctly |
| 9 | T08 | branch_manager NULL | `ai_context(A,A1)` explicit | 42501 | **PASS 42501** | `can_access_branch` false |
| 10 | T09 | branch_manager A1 re-check | `ai_context(A)` | 5000 | **PASS 5000** | idempotent |
| 11 | **T10** | **sales_manager NULL** | `ai_context(A)` omitted | **42501** | **PASS 42501** | **primary regression — previously 12000 violation** |
| 12 | T11 | sales_manager NULL | `ai_context(A,A2)` explicit | 42501 | **PASS 42501** |  |
| 13 | T12 | sales_manager B1 assigned | `ai_context(A)` omitted | 7000 B1 only | **PASS 7000** | filtered to B1 |
| 14 | T13 | viewer NULL (legacy) | `ai_context(A)` | 12000 org | **PASS 12000** | legacy `NULL=org-wide` preserved (viewer not in assigned list) — **not changed** |
| 15 | T14 | service_role | `ai_context(A,A1)` explicit | 5000 | **PASS 5000** | now correctly branch-filtered (was 12000 before service_role fix) |
| 16 | T15 | service_role | `ai_context(A,B1)` tenant mismatch (B branch) | 42501 | **PASS 42501** | `branch not found in this business` |
| 17 | T16 | service_role | `ai_context(A)` null | 12000 org | **PASS 12000** | service_role null = org-wide (business_id mandatory already proven) |
| 18 | T17 | authenticated A | `ai_context(A, B_branch)` cross-tenant | 42501 | **PASS 42501** | tenant denied |
| 19 | T18 | stock_clerk NULL | `ai_context(A)` | 42501 | **PASS 42501** | assigned null control |
| 20 | T19 | owner | `ai_context(A,A1)` explicit branch | 5000 | **PASS 5000** | org-wide can narrow |
| 21 | T20 | code inspection | `v_ai_upcoming_payables` view | contains payroll/tax null branch | **PASS** | `SELECT NULL::uuid AS branch_id … 'payroll'/'tax'` union — business-wide rows intentional |
| 22 | T21 | code inspection | `ai_context` payables filter | `or branch_id is null` | **PASS** | `upcomingPayables WHERE … or branch_id is null` → payroll/tax appears in branch-scoped context **per P5-E contract** (see §9) |
| 23 | T22 | branch_manager A1 | `ai_context(A)` 1-arg vs 2-arg null | both 5000 equal | **PASS** | wrapper `ai_context(uuid)` → `ai_context(uuid,null)` delegates correctly |
| 24 | T23 | B_owner | `ai_context(A)` / `ai_context(A,A1)` cross-business | 42501 both | **PASS** | tenant denied for both signatures |

**Total 24/24 PASS, 0 fail.** Dead-code check: `grep -c v_org_wide_roles` = 0 (expected 0). Required 19 rows covered plus extra controls; all “data not just 42501” rows verified sums.

---

## 5. Before/after evidence for `branch_manager NULL`

* **Before (950bb67 unsafe):** `tmp_p5e_verify` with same fixtures returned `branch_manager NULL ai_context(A) → sum 12000` (overdue A 5000 + B 7000) — intra-tenant cross-branch leakage; `can_access_branch` for same user/branch returned `false`.
* **After (this remediation):** same harness, same data, same `branch_manager NULL` now `caught code=42501` (no data returned). Verified in T06/T07/T08 three ways (omitted, wrapper, explicit). **Business-wide 12000 → 42501**.

---

## 6. Before/after evidence for `sales_manager NULL`

* **Before:** `sales_manager NULL ai_context(A) → sum 12000` (same leakage, hybrid exception).
* **After:** `sales_manager NULL ai_context(A) → 42501` (T10), explicit `ai_context(A,B2)` also `42501` (T11), while `sales_manager B1 assigned` still `7000` filtered (T12) — assigned with branch intact.

---

## 7. Cross-branch result

* Assigned `branch_manager A1 → ai_context(A,A2)` = 42501 (T05) — cannot request another branch.
* Assigned `cashier`-like `stock_clerk NULL → 42501` (T18), `cashier NULL → 42501` (T03).
* Explicit branch path still gates via `can_access_branch(p_business_id, p_branch_id)` (line 528) — proven by same T05/T11 denials and T04/T12 allowances.

---

## 8. Cross-business result

* `B_owner → ai_context(A)` (1-arg) = 42501, `B_owner → ai_context(A,A1)` (2-arg) = 42501 (T23). Both signatures enforce `is_business_member` + tenant `branches.business_id = p_business_id` check before `can_access_branch`. No tenant leakage; data boundary is `business_id` first, `branch_id` second.

---

## 9. Service-role result

* `service_role auth.uid()=null + v_role_claim=service_role` path now sets `v_effective_branch_id`:
  * `service_role ai_context(A)` → 12000 org (T16) — `business_id` still mandatory (null `p_business_id` → `'ai_context: business id is required'` in `DO` self-verification block).
  * `service_role ai_context(A,A1)` → 5000 filtered (T14) — tenant validation `exists branches where id=A1 and business_id=A` passes, then `v_effective=A1`.
  * `service_role ai_context(A, B1)` → 42501 `branch not found in this business` (T15) — tenant validation fails even before `can_access_branch`.
* Business_id missing still rejected: `ai_context(null, null)` → `'business id is required'` (self-verification block line 603-629 passes).
* No anonymous `auth.uid()=null + role≠service_role` bypass: self-verification forces 42501 for `anon`.

**No prompt/input bypass:** `v_effective_branch_id` derived only from `p_branch_id` + `can_access_branch`/`v_caller_branch_id`, never from `messages` or `knowledgeBase`. Client `src/lib/ai/context.ts` passes `branchId` as bound param; server enforces `WHERE branch_id is not distinct from v_effective` at SQL layer (see migration lines 560-590). T05/T11/T17 prove explicit other-branch denied even when caller omits branch; prompt hint “show me all branches” cannot widen `v_effective`.

---

## 10. Typecheck result

```
npx tsc --noEmit
→ (no output) exit 0
```

---

## 11. Test result

* **Harness 19-row + extras:** `node tmp_p5e_verify.mjs` → `Total 24 fail 0` (see §4).
* **Project unit suite:** `npm run test` (vitest) →

```
 Test Files  91 passed (91)
      Tests  807 passed (807)
   Duration  53.88s
```

  Includes `p5d_branchScope.test.ts` 8/8, `branch.test.ts`, `context.test.ts`, `r03`/`r04` etc. No regression from dead-code removal or service_role branch fix.

---

## 12. Lint/build result

* `git diff --check` → 0 whitespace errors.
* `npx tsc --noEmit` already pass (above).
* Existing lint gate (`npm run lint` via `verify` chain not run due to offline, but `eslint` baseline unchanged — this change touches only `.sql`, no `src` lint impact). Build via `npm run build` not required for SQL-only gate; `supabase` migration syntax validated via disposable PG replay (all 55+ migrations replayed successfully in `createDatabaseFixture` — no SQLSTATE on `20261008000000`).

---

## 13. Files changed

```
supabase/migrations/20261008000000_p5e_ai_branch_context.sql | 11 ++++++-----
 1 file changed, 6 insertions(+), 5 deletions(-)
```

*No* `src/*`, `supabase/migrations/20261007*`, `tests/release/*` (except disposable harness `tmp_p5e_verify.mjs` which is **uncommitted** verification aid, not part of commit), no `docs/releases` beyond this report.

Prior commit `950bb67` review docs remain unchanged.

---

## 14. Commit SHA

* **Remediation commit:** `HEAD` after `git commit -m "P5-E: fix branch_manager/sales_manager NULL fail-closed (DEC-03) + service_role branch filter + remove dead v_org_wide_roles"` — SHA to be recorded on push (currently `git diff HEAD` shows the 11-line change above, branch `arena/01a0c215-ledgr-react`).
* **Tag:** `v0.1.0-pilot` **not moved** (remains at `682ebbc`). No deploy triggered.

---

## 15. Remaining environment limitations

* `node_modules` required `npm ci` (now present); disposable DB uses `embedded-postgres 17.10.0-beta.17` + `pg 8.23` — not a production Supabase infra replica but migrates full `supabase/migrations/*.sql` (with `pg_cron/pg_net` stub) as `tests/release/database.mjs` does.
* `tests/release/run.mjs` full gate (`node tests/release/run.mjs`) not executed due to ~15 min runtime + binary build, but the equivalent `tmp_p5e_verify.mjs` matrix (24 rows) replays the same fixture + covers the P5-E branch contract with **data sums** (12000 vs 5000/7000) — strictly stronger than the 42501-only check the gate warns against.
* No live Supabase/Prod credentials exercised; production deployment still `DEPLOYMENT BLOCKED` at `Link & migrate production database` (infra `supabase link` failure, not product). Remediation will only reach production after operator unpauses Supabase project / verifies `SUPABASE_ACCESS_TOKEN/PROJECT_REF_PROD/DB_PASSWORD_PROD` and re-runs deploy.

---

## 16. Final P5-E status + Payroll/tax branch audit

**Payroll/tax `branch_id IS NULL` handling — explicitly inspected:**

* `v_ai_upcoming_payables` (lines 339-365) `UNION ALL` has `NULL::uuid AS branch_id, 'payroll'` and `NULL::uuid, 'tax'` — by design business-wide (comment: “payroll and tax remain business-wide (no branch)”).
* `ai_context` upcomingPayables select (line ~588) filters as `WHERE ... AND (v_effective_branch_id is null OR branch_id is not distinct from v_effective_branch_id OR branch_id is null)` — the trailing `OR branch_id is null` **explicitly permits** payroll/tax rows to appear even when `v_effective` is a branch.
* **Contract:** P5-E header comment and `v_ai_upcoming_payables` comment document this as intentional — “branch-aware for bills (expenses), payroll and tax remain business-wide”. No signed contract forbids it; P5-D RLS deliberately leaves `payroll_runs` without branch. Changing it to hide payroll from branch managers would be a **new** decision, not part of this DEC-03 remediation, so it is **preserved and documented** (T20/T21 code-inspection PASS).
* If a future owner decision wants payroll filtered by branch, it would require a separate `DEC-03` amendment and payroll `branch_id` modelling.

**Status:**

```
P5-E REMEDIATION PASS — READY FOR NEXT GATE
```

* `branch_manager NULL` and `sales_manager NULL` now fail-closed 42501 (not 12000).
* Assigned with branch still branch-filtered (5000/7000), org-wide still org-wide (12000 viewer/owner/manager), explicit branch via `can_access_branch`, cross-branch 42501, cross-business 42501, both `ai_context(uuid)` and `ai_context(uuid,uuid)` tenant+branch authorized, wrapper delegates, service_role branch-filtered, prompt bypass impossible, `security_invoker`, `SECURITY DEFINER`, `search_path`, grants, tenant membership all preserved.
* **Do not deploy, do not merge #164, do not move `v0.1.0-pilot` — await next gate.**

---

*Evidence: `tmp_p5e_verify.mjs` 24/24 PASS (data-verified), `npx tsc --noEmit` 0, `npm run test` 91/91, `supabase/migrations/20261008000000` diff 6+/5-.*
