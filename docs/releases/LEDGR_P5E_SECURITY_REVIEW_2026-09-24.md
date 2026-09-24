# P5-E Security Review — ai_branch_context (20261008000000) vs DEC-03

**Date:** 2026-09-24 (Africa/Johannesburg)  
**Commit under review:** `a9eeed6` (HEAD) — branch `arena/01a0c215-ledgr-react`  
**Tag under review:** `v0.1.0-pilot` → `682ebbc` (hardened deploy wrapper; src identical to `19e712b` except `deploy.yml`)  
**Migration under review:** `supabase/migrations/20261008000000_p5e_ai_branch_context.sql` (636 lines)  
**Authoritative contract:** `supabase/migrations/20261007000000_p5d_branch_scope_remediation.sql` (`can_access_branch` DEC-03)  
**Deployment status:** `DEPLOYMENT BLOCKED` (runs `36029382645` + `36030232211` both `Link & migrate production database` failure — tenant infra gate, not product) — migration **not yet in production**  
**Review type:** EVIDENCE-ONLY — no `.sql` remediation applied in this commit (see §13 Mandatory Validations)  
**Verdict:** **REMEDIATION REQUIRED — UNAUTHORIZED CONTRACT CHANGE (DEC-03 VIOLATION)** — **NO DEPLOYMENT AUTHORIZED** until remediation re-proof passes. **Not** `OWNER DECISION REQUIRED` (DEC-03 is signed and P5-D is proven PASS).

---

## 1. Executive Summary

P5-E implements Q14 B (`ai_context(business_id, branch_id?)` optional, read-only, `can_access_branch` authorized) + Q15 B (after P8, branch metrics coherent via `WHERE branch_id`). It correctly:

* adds `branch_id` to 13 `v_ai_*` views (`with (security_invoker = true)`),
* preserves R03 guards (auth, `is_business_member`, `v_reports_roles`),
* enforces tenant-bound branch (`branches.business_id = p_business_id`) and explicit-branch `can_access_branch` check.

It **violates** DEC-03 in exactly one place: the **omitted-branch** path for two assigned-scope roles.

```sql
-- 20261008000000 lines 534, 541-546
-- branch_manager/sales_manager are hybrid (reports-tier + assigned) — null branch is legacy org-wide, not fail-closed
if v_membership_role = any (v_assigned_roles) and v_caller_branch_id is not null then
  v_effective_branch_id := v_caller_branch_id;
elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null
      and v_membership_role not in ('branch_manager','sales_manager') then
  raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
else
  v_effective_branch_id := null;  -- ← branch_manager/sales_manager with NULL assignment land HERE = org-wide
end if;
```

DEC-03 (P5-D) declares `branch_manager` and `sales_manager` **assigned-scope** (`can_access_branch` → `branch_id IS NOT NULL AND branch_id = p_branch_id`, fail-closed on `NULL`). P5-D tests (`p5d_branchScope 8 PASS`), P7 harness (`A_branch_manager→A2` `false,false`), P8 `till family sealed` all prove that contract. The comment *“hybrid — null branch is legacy org-wide”* is **not** in any signed `LEDGR_P4_OWNER_DECISION_RECORD`, `DEC-03` matrix, or `LEDGR_DECISION_ARCHITECTURE_GATE D-03` record. It invents a new sub-tier.

**Effect:** a `branch_manager` (or `sales_manager`) whose `business_users.branch_id IS NULL` (unassigned — must be fail-closed per DEC-03) calls `ai_context(business)` or `ai_context(business, NULL)` and receives `v_effective_branch_id := NULL` → **org-wide AI payload** (`kpis`, `monthlyTrend`, `overdueInvoices`, `topCustomers`, `anomalies`, etc.) containing **all branches' financial data** of that tenant. The same user calling `can_access_branch(business, anyBranch)` or RLS-protected `invoices/expenses` would be denied (`false` / `42501`), and an assigned `stock_clerk NULL` / `cashier NULL` **is** correctly denied by this same function. The inconsistency creates an **assurance bypass**: an unassigned manager obtains org-wide context that the write path and `can_access_branch` would forbid.

**Classification:** `UNAUTHORIZED CONTRACT CHANGE` / `DEC-03 VIOLATION` — not a missing feature, not a rendering bug. Any `docs/releases` claim that P5-E is `PASS` or `PROVEN` while this code is the one deployed would be a **release certification bypass**.

**Fix:** 2-line removal of the hybrid exception so the `elsif` matches **all** `v_assigned_roles` with `NULL` assignment → `42501`. No other behaviour need change. See §7 for exact unified diff.

**Deployment:** No production exposure yet (deploy gate blocked before `supabase db push`). **Do not move tag, do not deploy `20261008000000` until remediation + 19-row branch proof (both signatures, data-verified) passes locally and in CI.**

---

## 2. Scope and Method

* Read `20261008000000` (636 lines) and `20261007000000` (505 lines) verbatim.
* Grepped `v_org_wide_roles`, `v_assigned_roles`, `can_access_branch`, `security definer`, `search_path`, `security_invoker`, `branch_manager`, `hybrid`.
* Cross-checked DEC-03 sources:
  * `docs/audits/LEDGR_DECISION_ARCHITECTURE_GATE_2026-09-22.md` D-03 (branch matrix open until P5-D, now signed)
  * `docs/audits/LEDGR_P4_OWNER_DECISION_RECORD_2026-09-24_SIGNED.md` §1 Q14/Q15 (AI.BRANCH optional after P8, `can_access_branch` reuse)
  * `docs/audits/LEDGR_P7_HARNESS_NORMALISATION_REPROOF_2026-09-24.md` § “DEC-03 (P5-D): `branch_id IS NULL` for assigned-scope (cashier, branch_manager, stock_clerk) is fail-closed”
  * `docs/audits/LEDGR_P8_FINAL_BLOCKED_EVIDENCE_GATE_2026-09-24.md` Branch authorization PASS
  * `docs/audits/LEDGR_P7_HARNESS_NORMALISATION_REPROOF` + `LEDGR_P9_OWNER_*` accepted branch family
  * `supabase/migrations/20261007000000` header + `can_access_branch` definition
  * `tests/release/fixtures.ts` P7 T2 comment + `p5d_branchScope.test.ts` 8 assertions
* Reviewed `src/lib/ai/context.ts` (`fetchAiData`/`buildAssistantContext` → `supabase.rpc('ai_context', {p_business_id, p_branch_id})`) and `src/lib/ai/__tests__/branch.test.ts` (client contract, 42501 degrade, queryKey branch isolation).
* Static data-flow analysis of `v_effective_branch_id` through all `v_ai_*` query filters (see §6).
* Checked grants, `SECURITY DEFINER` pinning, `search_path`, wrapper `ai_context(uuid)`, self-verification block.
* Attempted live disposable-DB reproduction via `tests/release/database.mjs` fixture (static fallback documented in §8 when `node_modules` absent in this sandbox).
* Kept this commit EVIDENCE-ONLY: `git diff HEAD -- supabase tests src` post-review must be empty (see §13).

---

## 3. Authoritative Contract (DEC-03 / P5-D)

### 3.1 P5-D `can_access_branch` is the single source of truth

`20261007000000_p5d_branch_scope_remediation.sql` lines 31-63 (verbatim, truncated to predicate):

```sql
create or replace function public.can_access_branch(p_business_id uuid, p_branch_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and (
        bu.role::text in ('owner','admin','manager','accountant','auditor')
        or (
          bu.role::text in ('cashier','stock_clerk','branch_manager','sales_clerk','sales_manager',
                            'purchasing_officer','warehouse_worker','customer_service_rep')
          and bu.branch_id is not null
          and bu.branch_id = p_branch_id
        )
        or (
          bu.role::text not in ('owner','admin','manager','accountant','auditor',
                                'cashier','stock_clerk','branch_manager','sales_clerk','sales_manager',
                                'purchasing_officer','warehouse_worker','customer_service_rep')
          and (bu.branch_id is null or bu.branch_id = p_branch_id)
        )
      )
  );
$$;
```

Comment (line 65-66): *“DEC-03 matrix: org-wide roles … assigned-scope … restricted to business_users.branch_id (NULL assignment = fail closed, not org-wide); other roles preserve legacy NULL=org-wide.”*

**Consequences:**

* `branch_manager` ∈ assigned-scope → `NULL` assignment ⇒ `can_access_branch(business, X)` = `false` for **any** `X` (including `NULL`). Must `raise 42501` on every server path that requires branch access. This is proven: `p5d_branchScope` 8 PASS, `R08.SHIFT.BRANCH-SCOPED-READ` till family, `fixtures.ts` assigns `A_branch_manager→A2` `A_cashier→A1`.
* `sales_manager` likewise assigned-scope.
* `viewer`, `tax_compliance_officer`, etc. ∉ assigned ⇒ legacy `NULL = org-wide` preserved — **only** these may be org-wide from a `NULL` assignment.
* Org-wide `owner/admin/manager/accountant/auditor` span all branches regardless of assignment.

No signed record authorizes a “hybrid reports-tier + assigned” carve-out for `branch_manager`/`sales_manager`. The triage note that mentions “P5-D hybrid (branch_manager/sales_manager NULL org-wide…)” in `LEDGR_POST_P5_RELEASE_TRIAGE_2026-09-24.md:589` is **triage commentary** about a stale test’s expectation (`false vs true`), not a signed DEC-03 amendment; it explicitly says *“P5-D tests prove new contract (p5d_branchScope 8 PASS), old release test stale”* — i.e. hybrid expectation is the **old** (pre-DEC-03) semantics that P5-D purposefully closed.

### 3.2 Role taxonomy referenced by P5-E

P5-E declares:

```sql
v_reports_roles := array['owner','admin','accountant','manager','sales_manager',
                        'tax_compliance_officer','treasury_manager','asset_manager',
                        'board_member','auditor','viewer','branch_manager']; -- line 493
v_org_wide_roles := array['owner','admin','manager','accountant','auditor'];           -- 494 DEAD CODE
v_assigned_roles := array['cashier','stock_clerk','branch_manager','sales_clerk',
                          'sales_manager','purchasing_officer','warehouse_worker',
                          'customer_service_rep'];                                      -- 495 AUTHORITATIVE for P5-E branch
```

* `v_reports_roles` mirrors `src/hooks/usePermissions.ts` `canViewReports` + R03 `20260927000000` allow-list. Correctly includes both managers.
* `v_org_wide_roles` is **declared but never referenced** (grep count = 1, declaration only). Dead code — it names the same 5 org-wide roles as P5-D but is not used to decide `v_effective_branch_id`. The actual org-wide decision is the final `else` which also matches `viewer`/`branch_manager NULL`/legacy roles.
* `v_assigned_roles` matches P5-D assigned set exactly — correct.

---

## 4. Exact Violation — Code, Location, and Data Flow

### 4.1 Violating fragment (lines 533-546, full)

```sql
    else
      -- Omitted branch: org-wide roles keep org-wide (null), assigned-scope with branch gets their branch
      -- branch_manager/sales_manager are hybrid (reports-tier + assigned) — null branch is legacy org-wide, not fail-closed
      if v_membership_role = any (v_assigned_roles) and v_caller_branch_id is not null then
        -- Assigned-scope caller who omitted branch must not receive org-wide; filter to their branch
        if not public.can_access_branch(p_business_id, v_caller_branch_id) then
          raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
        end if;
        v_effective_branch_id := v_caller_branch_id;
      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null
            and v_membership_role not in ('branch_manager','sales_manager') then
        -- Assigned-scope with NULL assignment (fail-closed) — no authorized branch (except hybrid reports-tier managers)
        raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
      else
        -- Org-wide or legacy null-assignment: org-wide
        v_effective_branch_id := null;
      end if;
    end if;
```

### 4.2 Why it violates DEC-03

| caller | `v_caller_branch_id` | P5-D `can_access_branch(business, callerBranch)` | DEC-03 expected on `ai_context(business, NULL)` | P5-E actual |
|--------|----------------------|---------------------------------------------------|--------------------------------------------------|-------------|
| `cashier` | `NULL` | `false` (fail-closed) | `42501` | `42501` ✓ (caught by `elsif` — role not exempt) |
| `stock_clerk` | `NULL` | `false` | `42501` | `42501` ✓ |
| `branch_manager` | `NULL` | `false` | `42501` | **`NULL` (org-wide)** ✗ — `elsif` explicitly excludes, falls to `else` |
| `sales_manager` | `NULL` | `false` | `42501` | **`NULL` (org-wide)** ✗ same |
| `sales_manager` | `B1` | `true` only for `B1` | filtered to `B1` | filtered to `B1` ✓ |
| `viewer` | `NULL` | `true` (legacy `NULL = org-wide`) | `NULL` (org-wide) allowed | `NULL` ✓ |
| `owner` | `NULL` | `true` (org-wide) | `NULL` | `NULL` ✓ |

The `and v_membership_role not in ('branch_manager','sales_manager')` predicate **subtracts** exactly the two roles that DEC-03 places in assigned-scope, creating a privileged `else` path to `v_effective_branch_id := null`. For those two, an **unassigned** user is upgraded from *deny* to *org-wide read*.

### 4.3 Data flow from `v_effective_branch_id` to views

`v_effective_branch_id` is used in every branch-sensitive SELECT inside the final `jsonb_build_object` (lines ~560-590):

```sql
kpis:            ... where k.business_id = p_business_id and k.branch_id is not distinct from v_effective_branch_id
monthlyTrend:    ... where t.business_id = p_business_id and t.branch_id is not distinct from v_effective_branch_id
overdueInvoices: ... where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id)
topExpenses:     ... where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id)
topCustomers:    ... where business_id = p_business_id and branch_id is not distinct from v_effective_branch_id
concentration:   ... where cc.business_id = p_business_id and cc.branch_id is not distinct from v_effective_branch_id
anomalies:       ... where business_id = p_business_id and (v_effective_branch_id is null or branch_id is not distinct from v_effective_branch_id)
upcomingReceivables: ... same (v_effective is null ? all : branch)
upcomingPayables:    ... where (v_effective is null or branch_id is not distinct from v_effective or branch_id is null)
```

When `v_effective_branch_id IS NULL`, every view returns **business-wide aggregated** data (the `union all` business-wide partitions of `v_ai_kpis`/`v_ai_monthly_trend`/`v_ai_top_customers` etc. — the `NULL branch_id` rows). When non-null, they collapse to a single branch.

Therefore the hybrid bug **is not an error-code-only bypass** — it is a **data leakage**: branch A's overdue invoices (`invoice_type in ('invoice',…)` via `v_ai_revenue_invoices`) from branch B, branch B's cash balances (`v_ai_cash_movements`/`v_ai_cash_accounts`), branch B's expense concentration, etc., all become visible to an unassigned `branch_manager`/`sales_manager` who elsewhere is denied `SELECT` on `invoices where branch_id = B1` via RLS.

Explicit-branch calls (`p_branch_id NOT NULL`) are **not** affected: they unconditionally call `can_access_branch(p_business_id, p_branch_id)` line 528, which correctly denies `branch_manager NULL` for any `p_branch_id`. The bypass is **omitted-branch only** — the “default to org-wide” path.

### 4.4 Wrapper `ai_context(uuid)`

Line 588-593:

```sql
create or replace function public.ai_context(p_business_id uuid) returns jsonb
language sql stable security definer set search_path = public
as $$ select public.ai_context(p_business_id, null::uuid) $$;
```

Inherits the bug — same `v_effective_branch_id := null` path when called with one arg. Both signatures must be fixed (single fix in the 2-arg function suffices).

---

## 5. Security Contracts Violated

All references are to signed contracts on `a9eeed6` (`LEDGR_P4_OWNER_DECISION_RECORD` binding, P5-D implementation history protected).

1. **DEC-03 / P5-D `can_access_branch` authoritative** (§3.1): assigned-scope `NULL` = fail-closed, not org-wide. Branch_manager/sales_manager NULL → `42501`. P5-E grants `NULL` (= org-wide). *Matrix identical to R06/R093 till isolation rationale (P7 `U(805) false,false`).*
2. **Till / branch isolation principle (R08 family):** branch-scoped roles must not obtain cross-branch financial context via an alternate read path that the write/sale path denies. P5-E read path would be the alternate.
3. **R03 AI authorisation + data minimization:** `ai_context` comment promises *“branch must belong to business (tenant boundary); assigned-scope omitted branch is filtered to own branch, not org-wide”* and *“DEC-03 branch authorization via can_access_branch when branch supplied **or implied for assigned-scope omitted branch**.”* Implied branch for `NULL` assignment is `42501`, not org-wide — the implementation contradicts its own comment.
4. **Least privilege / complete mediation:** an authorization decision is made in one place (`can_access_branch`) but a second place (`ai_context` omitted-branch branch) re-derives it with a different rule. The correct pattern is to delegate to `can_access_branch`, not to re-list roles and then carve out exceptions.
5. **Defense against assurance bypass:** a `BLOCKED→PASS` relabel (or doc claim “AI.BRANCH proven” while hybrid remains) would make the release green artificially — prohibited by P6/P7 absolute rule *“do not change product/security behaviour to make harness green; if test conflicts with contract, fix test not product; do not weaken security boundary.”* This review enforces that rule by marking `REMEDIATION REQUIRED`, not by rewriting tests.

**Not violated:** tenant boundary for explicit branch (still enforced), R03 membership/reports gate, `anon`/`authenticated` `EXECUTE` privileges, `search_path` pinning, single-tenant branch membership (`branches.business_id` check).

---

## 6. Branch-Aware View Architecture

### 6.1 Views are correctly `security_invoker = true`

All 13 recreated views:

* `v_ai_revenue_invoices`, `v_ai_expense_docs`, `v_ai_cash_accounts`, `v_ai_cash_movements`, `v_ai_kpis`, `v_ai_monthly_trend`, `v_ai_overdue_invoices`, `v_ai_top_expenses`, `v_ai_top_customers`, `v_ai_customer_concentration`, `v_ai_upcoming_receivables`, `v_ai_upcoming_payables`, `v_ai_anomalies`

each carries `with (security_invoker = true)` and a predicate `and (auth.uid() is null or public.is_business_member(business_id))` (or `b.id` for kpis/trend). This ensures:

* A caller outside the tenant cannot enumerate the view directly (must be `is_business_member`).
* `ai_context` being `SECURITY DEFINER` does **not** expand to arbitrary auth bypass for view contents — `auth.uid()` inside the view still evaluates against the caller’s JWT `sub`, not the definer owner.

### 6.2 Branch filtering is SQL-layer, not prompt-layer ✓

* `src/lib/ai/context.ts` passes `branchId` as bound `p_branch_id`; `fetchAiData` and `buildAssistantContext` carry it through `['assistant-context', mode, businessId, userId, branchId]` queryKey (cross-branch cache isolation proven in `branch.test.ts`).
* Server **never** reads `branchId` from chat messages — `v_effective_branch_id` is derived only from `p_branch_id` + `can_access_branch` + `v_caller_branch_id`. Prompt-injection “show me all branches” cannot override `WHERE branch_id is not distinct from v_effective_branch_id`.

### 6.3 View RLS vs `ai_context` RLS interaction

* Core tables (`invoices`, `expenses`, `journal_entries`, `inventory_locations`, etc.) have P5-D RLS policies enforcing `can_access_branch(business_id, branch_id)` (or `can_access_location`). Those protect **direct** `supabase.from('invoices').select()` calls.
* `v_ai_*` views are **analytics projections**; they deliberately add `branch_id` so `ai_context` can `WHERE branch_id is not distinct from v_effective_branch_id` without needing per-row RLS. For org-wide callers they aggregate business-wide `NULL` partitions; for branch callers they restrict to one branch. This is sound **only** if `v_effective_branch_id` is correctly derived — hence the hybrid bug is a view-layer bypass without needing to defeat RLS.

### 6.4 No `REVOKE` regression

Grants: `grant select on public.v_ai_* to authenticated, service_role;` and `revoke execute on function public.ai_context(uuid[,uuid]) from public, anon; grant execute to authenticated, service_role;` — `anon` has no view select nor function execute. `has_function_privilege('anon', 'public.ai_context(uuid, uuid)', 'EXECUTE') = false` is asserted in the migration self-verification block (lines 603-618). Good.

### 6.5 Risk of direct view query bypass?

An authenticated assigned-scope user could in theory `select * from public.v_ai_kpis where business_id = X and branch_id = otherBranch`. That query runs as `security_invoker` — RLS is **not** on the view, but the view’s predicate `is_business_member(business_id)` would still pass (membership check is tenant-only). Branch filtering for direct view reads is **not** enforced by RLS; the view would return the other branch row if queried directly. However P5-D/P5-E’s threat model treats `ai_context` as the **only** supported AI read path, and the app never queries `v_ai_*` directly (client imports go through `supabase.rpc('ai_context')`). The Edge Function likewise calls only `ai_context`. The residual risk is low and identical before/after P5-E; hardening direct `v_ai_*` RLS would be a future P5-F, not this remediation. The hybrid bug makes the **supported** path leak, which is worse.

---

## 7. Proposed Remediation — Exact Unified Diff (No Rollback, No Behaviour Loss)

### 7.1 Goal

Make `ai_context(business, null)` consistent with `can_access_branch` for **all** `v_assigned_roles`, including `branch_manager`/`sales_manager`. No hybrid, no dead-code drift, no new role invented, no RLS change.

### 7.2 Minimal remediation (recommended — 2-line logical change + comment)

```diff
--- a/supabase/migrations/20261008000000_p5e_ai_branch_context.sql
+++ b/supabase/migrations/20261008000000_p5e_ai_branch_context.sql
@@ -492,7 +492,6 @@
   v_caller_branch_id uuid;
   v_effective_branch_id uuid;
   v_reports_roles constant text[] := array['owner','admin','accountant','manager','sales_manager','tax_compliance_officer','treasury_manager','asset_manager','board_member','auditor','viewer','branch_manager'];
-  v_org_wide_roles constant text[] := array['owner','admin','manager','accountant','auditor'];
   v_assigned_roles constant text[] := array['cashier','stock_clerk','branch_manager','sales_clerk','sales_manager','purchasing_officer','warehouse_worker','customer_service_rep'];
 begin
   if p_business_id is null then
@@ -531,16 +530,13 @@
       end if;
       v_effective_branch_id := p_branch_id;
     else
-      -- Omitted branch: org-wide roles keep org-wide (null), assigned-scope with branch gets their branch
-      -- branch_manager/sales_manager are hybrid (reports-tier + assigned) — null branch is legacy org-wide, not fail-closed
+      -- Omitted branch: org-wide and legacy roles keep org-wide (null); assigned-scope with branch gets their branch;
+      -- assigned-scope with NULL assignment is fail-closed (DEC-03 P5-D: can_access_branch branch_id IS NOT NULL)
       if v_membership_role = any (v_assigned_roles) and v_caller_branch_id is not null then
         -- Assigned-scope caller who omitted branch must not receive org-wide; filter to their branch
         if not public.can_access_branch(p_business_id, v_caller_branch_id) then
           raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
         end if;
         v_effective_branch_id := v_caller_branch_id;
-      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null and v_membership_role not in ('branch_manager','sales_manager') then
-        -- Assigned-scope with NULL assignment (fail-closed) — no authorized branch (except hybrid reports-tier managers)
-        raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
+      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null then
+        raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
       else
         -- Org-wide or legacy null-assignment: org-wide
         v_effective_branch_id := null;
```

*Removes* hybrid comment, *removes* dead `v_org_wide_roles` (declared never used), *unifies* the `elsif` to fail-closed for **every** assigned role with `NULL` assignment. `else` then covers exactly org-wide (`owner/admin/manager/accountant/auditor`) plus legacy (`viewer`, `tax_compliance_officer`, etc. with `NULL` — which P5-D preserves as `branch_id is null or = p_branch_id`, so `can_access_branch` would succeed for any branch, but `ai_context` omitted path legitimately gives them org-wide).

### 7.3 Alternative fully-explicit remediation (if reviewer prefers explicit org-wide list)

If retaining `v_org_wide_roles` for documentation:

```diff
       if v_membership_role = any (v_assigned_roles) and v_caller_branch_id is not null then
         v_effective_branch_id := v_caller_branch_id;
+      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null then
+        raise exception 'ai_context: no access to the requested branch' using errcode = '42501';
+      elsif v_membership_role = any (v_org_wide_roles) then
+        v_effective_branch_id := null;
       else
-      elsif v_membership_role = any (v_assigned_roles) and v_caller_branch_id is null and v_membership_role not in ('branch_manager','sales_manager') then
-        raise exception ...;
-      else
-        v_effective_branch_id := null;
-      end if;
+        -- legacy roles not in either list: NULL assignment = org-wide (P5-D), else must match — omitted gives org-wide
+        v_effective_branch_id := null;
+      end if;
```

Both forms are DEC-03 equivalent; the minimal form is preferred (fewer branches to test).

### 7.4 What is **not** changed

* No change to `v_reports_roles` (R03 mirror), no change to the 13 views, no change to tenant-bound `branches` check, no change to explicit-branch `can_access_branch` branch, no change to `SECURITY DEFINER`/`search_path`, no change to `save_quick_*` / RLS (P5-D).
* No forward-only “un-migration” — the fix is a `20261009xxxxxx_p5e_fix_branch_manager_null.sql` **or** an edit to `20261008000000` before it ships (since it has never been pushed to production, either is safe; the review recommends squashing the fix into the still-unpushed `20261008000000` so history stays clean).

### 7.5 Forward-only migration header (if remediation is a new file)

```sql
-- 20261009xxxxxx_p5e_fix_branch_manager_null_fail_closed.sql
-- P5-E FIX — remove hybrid org-wide for branch_manager/sales_manager NULL assignment
-- DEC-03 consistency: assigned-scope NULL = fail-closed (42501), never org-wide.
```

---

## 8. Reproduction & Proof — 19-Row Matrix (Both Signatures, Data-Verified)

The matrix below is the **required** passing set before `PASS` can be claimed. It covers both entry points `ai_context(uuid)` (1-arg wrapper) and `ai_context(uuid, uuid)` (2-arg), checks **actual financial data** in the returned JSON (not just `42501` vs success), and proves tenant + branch + 2-state (assigned-null vs assigned-bound) invariants.

Setup: business `A` with branches `A1`, `A2`; business `B` with branch `B1`; stock fixtures with 100 opening; invoices: `A1` overdue `5000` (`P5E-OVERDUE-A`), `A2` overdue `7000` (`P5E-OVERDUE-B`), `B1` overdue `9000`; customers `A private`, `B private`. Seed via `fixtures.ts` then:

```sql
update business_users set branch_id = :A1 where business_id=:A and role in ('cashier','stock_clerk', …); -- per fixtures.ts
-- plus explicit NULL-assigned subjects for violation probes (see rows 6,10,15)
```

| # | Id | Caller (A unless noted) | Assignment `business_users.branch_id` | Call | Expected (current broken) | Evidence to assert (data, not just code) |
|---|----|-------------------------|---------------------------------------|------|---------------------------|-------------------------------------------|
| 1 | `P5E.BRANCH.OWNER-OMITTED-ORG` | `owner` | `NULL` (org-wide) | `ai_context(A)` | `200` `branch_id:null` `overdue sum 12000` `kpis.revenue_mtd = 12000` | `r.company.id = A` ∧ `r.branch_id IS NULL` ∧ `r.overdueInvoices` contains both `P5E-*` ∧ `r.kpis` aggregated |
| 2 | `P5E.BRANCH.OWNER-EXPLICIT-A1` | `owner` | `NULL` | `ai_context(A, A1)` | `200` `branch_id=A1` `overdue 5000 only` | `r.branch_id = A1` ∧ `overdue length 1` ∧ `invoice_number = P5E-OVERDUE-A` ∧ cash trend = A1-only |
| 3 | `P5E.BRANCH.MANAGER-OMITTED-ORG` | `manager` | `NULL` (org-wide) | `ai_context(A)` | `200` org-wide `12000` | same as T01 but role = manager |
| 4 | `P5E.BRANCH.ACCOUNTANT-OMITTED-ORG` | `accountant` | `NULL` | `ai_context(A)` | `200` org-wide `12000` | `accountant` reports-tier allowed, org-wide |
| 5 | `P5E.BRANCH.AUDITOR-OMITTED-ORG` | `auditor` | `NULL` | `ai_context(A)` | `200` org-wide `12000` | `auditor` org-wide |
| 6 | `P5E.BRANCH.CASHIER-ASSIGNED-OMITTED-FILTERED` | `cashier` | `A1` | `ai_context(A)` | `200` `branch_id=A1` `5000` only | `r.branch_id = A1` ∧ `can_access_branch(A,A1)=true` ∧ `overdue 5000` |
| 7 | `P5E.BRANCH.CASHIER-NULL-OMITTED-DENIED` | `cashier` | `NULL` (synthetic) | `ai_context(A)` | `42501` | `code=42501` ∧ no rows returned |
| 8 | `P5E.BRANCH.CASHIER-ASSIGNED-EXPLICIT-OWN` | `cashier` | `A1` | `ai_context(A,A1)` | `200` `5000` | `branch_id = A1` ∧ data = T06 |
| 9 | `P5E.BRANCH.CASHIER-ASSIGNED-EXPLICIT-OTHER-DENIED` | `cashier` | `A1` | `ai_context(A,A2)` | `42501` | `code=42501` ∧ tenant no-leak |
| 10 | `P5E.BRANCH.BM-ASSIGNED-OMITTED-FILTERED` | `branch_manager` | `A1` | `ai_context(A)` | `200` `branch_id=A1` `5000` | assigned branch_manager correctly filtered |
| 11 | **`P5E.BRANCH.BM-NULL-OMITTED-DENIED`** | **`branch_manager`** | **`NULL`** | **`ai_context(A)`** | **`42501` (current: `200` org-wide `12000` ✗)** | **must be `42501`; assert `data IS NULL` and `kpis` not returned; current violates — sum `12000` proves org-wide leakage** |
| 12 | `P5E.BRANCH.BM-NULL-EXPLICIT-A1-DENIED` | `branch_manager` | `NULL` | `ai_context(A,A1)` | `42501` | already correct — explicit path denies |
| 13 | `P5E.BRANCH.BM-NULL-WRAPPER-DENIED` | `branch_manager` | `NULL` | `ai_context(A)` (1-arg) | `42501` | wrapper delegates to 2-arg with `NULL`, same as T11 |
| 14 | **`P5E.BRANCH.SM-NULL-OMITTED-DENIED`** | **`sales_manager`** | **`NULL`** | **`ai_context(A)`** | **`42501` (current: `200` org-wide `12000` ✗)** | **mirror of T11 for sales_manager** |
| 15 | `P5E.BRANCH.SM-ASSIGNED-OMITTED-FILTERED` | `sales_manager` | `A2` | `ai_context(A)` | `200` `branch_id=A2` `7000` | filtered to own branch, not org-wide |
| 16 | `P5E.BRANCH.VIEWER-NULL-OMITTED-ORG` | `viewer` | `NULL` (legacy) | `ai_context(A)` | `200` org-wide `12000` | legacy `NULL = org-wide` — viewer allowed org-wide (reports-tier, not assigned) |
| 17 | `P5E.BRANCH.VIEWER-ASSIGNED-N/A` | — | — | — | — | no assigned viewer in model; included to show legacy ≠ assigned |
| 18 | `P5E.BRANCH.SERVICE-ROLE-EXPLICIT-A1` | `service_role` `auth.uid()=null` | — | `ai_context(A,A1)` | `200` `5000` | tenant branch validated; no `can_access_branch` needed (service_role trusted) |
| 19 | `P5E.BRANCH.SERVICE-ROLE-TENANT-MISMATCH-DENIED` | `service_role` | — | `ai_context(A, B1)` | `42501` `branch not found in this business` | tenant boundary `branches.business_id = p_business_id` fails |
| 20 | `P5E.BRANCH.SERVICE-ROLE-NULL-ORG` | `service_role` | — | `ai_context(A)` | `200` org-wide `12000` | service_role null = org-wide (expected) |
| 21* | `P5E.BRANCH.ANON-DENIED` | `anon` | — | `ai_context(A)` | `42501` `authentication required` | self-verification block proves it |

*Row 21 is the R03 baseline that must still pass; prior suites cover it but it is included for completeness.*

**Critical rows are T11 and T14** — they distinguish *status* from *data leakage*. A naïve harness that only checks `code = 42501` on T11 would miss that the server **does return rows** — the proof must `select ... into` then compute `sum(amount_outstanding) = 12000` vs `0` / exception.

### 8.1 Static proof already available (no DB needed)

* `can_access_branch` definition: `branch_manager` ∈ assigned ∧ `branch_id is not null` ⇒ for `branch_manager NULL`, `can_access_branch(A, A1)=false`, `can_access_branch(A, NULL)=false` (third `or` branch excludes assigned roles).
* `ai_context` `elsif` excludes `branch_manager`/`sales_manager` from `42501` ⇒ their `v_effective = null` path executes. Final SELECT then has `where branch_id is not distinct from null` → all rows. So `P5E-OVERDUE-A` + `P5E-OVERDUE-B` both appear.
* Live disposable harness `tmp_p5e_verify.mjs` (written to `tmp_p5e_verify.mjs`, not committed) encodes exactly T01-T20 with `overdueInvoices` sums; it **could not run** in this sandbox because `node_modules` is absent (`ERR_MODULE_NOT_FOUND embedded-postgres`). The script is retained as a runnable artefact for the next environment (run `npm ci && node tmp_p5e_verify.mjs`). Static analysis is sufficient to declare `VIOLATION CONFIRMED` without awaiting infra restoration.

### 8.2 Service_role path

`if auth.uid() is null then if v_role_claim <> 'service_role' then 42501; if p_branch_id is not null then tenant check else allow`. For `p_branch_id = B1, p_business_id = A`, `select 1 from branches where id = B1 and business_id = A` returns 0 rows → `42501 'branch not found in this business'`. For `p_branch_id = null` → `v_effective = null` → org-wide, no `can_access_branch` needed. This matches the intended Edge Function trust model (Edge already verified tenant via `business_users`, service_role is post-auth). No tenant leakage; branch isolation for service_role is **intentionally** delegated to the tenant check plus caller-supplied `p_branch_id`, not to a per-user branch.

### 8.3 Cross-tenant matrix (beyond 19 rows)

`ai_context(A, B1)` or `ai_context(B, A1)` for any authenticated role (owner includes) must `42501`. This is already enforced by the same `exists (select 1 from branches where id = p_branch_id and business_id = p_business_id)` check **before** `can_access_branch`. Zero data crosses tenant. P5-E preserves this.

---

## 9. v_org_wide_roles — Dead Code Finding

* **Declared** line 494: `v_org_wide_roles constant text[] := array['owner','admin','manager','accountant','auditor'];`
* **Occurrences** `grep -c` = 1 (declaration only).
* **Used** nowhere in the `elsif`/`else` chain. The actual org-wide decision is the final `else` which also matches `viewer`, `tax_compliance_officer`, etc. and the hybrid managers.
* **Risk:** a future editor may assume `v_org_wide_roles` controls behaviour and add a role to it expecting fail-closed to change, but nothing would. The array should either be **used** (`elsif v_membership_role = any (v_org_wide_roles) then v_effective := null`) or removed. The minimal remediation removes it to eliminate confusion; the explicit alternative keeps it and uses it (see §7.3). Either way, dead code must not remain post-fix.

---

## 10. NULL Semantics — Three Distinct Concepts (Must Not Conflate)

| Symbol | Meaning | Where it appears | Correct handling |
|--------|---------|------------------|------------------|
| `p_branch_id IS NULL` (omitted param) | caller did **not** request a branch filter — “give me my default” | `ai_context(A, NULL)` 1-arg wrapper and 2-arg with `null` | org-wide roles → `NULL` (business-wide views); assigned roles with branch → own branch; assigned roles with `NULL` assignment → `42501` |
| `business_users.branch_id IS NULL` (assignment) | user has **no** branch binding (unassigned) | `v_caller_branch_id` fetched from `business_users` | org-wide roles: `NULL` is legitimate (spans all); assigned roles: `NULL` is **fail-closed** (P5-D) |
| `v_ai_kpis.branch_id IS NULL` (business-wide partition) | the **data** row representing the business aggregate, not a real branch | views `v_ai_kpis`/`v_ai_monthly_trend`/`v_ai_top_customers` `NULL` `union all` branch partitions | filtered when `v_effective_branch_id IS NULL` (org-wide view), hidden when filtered to a branch |

P5-E correctly uses `is not distinct from` to match `NULL`↔`NULL` for the `kpis` case. The bug conflates rows 2 vs 1: it treats `business_users.branch_id IS NULL` for `branch_manager` as row-1 “caller omitted but still org-wide” rather than row-2 fail-closed.

---

## 11. Other P5-E Findings (Non-blocking)

* **AuthZ text precision:** `raise exception 'ai_context: no access to the requested branch'` is used for both explicit-denied and implied-null-assignment denied. Indistinguishable for logging but both `42501` — acceptable.
* **Self-verification block (lines 598-635):** checks `can_access_branch` substring, allowed roles list, `authenticated` EXECUTE, `anon` denied, `null business_id` rejected. Does **not** check hybrid branch logic — a passing self-verification would not catch this bug, which is why the 19-row matrix is required.
* ** Grants:** `grant select on public.v_ai_* to authenticated, service_role;` — no `anon`. Correct.
* **`search_path = public`:** pinned on both `ai_context(uuid, uuid)` and wrapper — prevents `search_path` injection. Correct.
* **`SECURITY DEFINER`:** necessary to allow the function to read across branch RLS for org-wide aggregations while still mediating via `auth.uid()`+`is_business_member`. Acceptable because mediation is explicit.
* **`branch_id` exposure in JSON:** final `branch_id` field in JSONB echoes `v_effective_branch_id` — client can display “filtered to A1” vs org-wide. No data beyond the filtered aggregates leaks.
* **`payroll` / `tax` payables with `branch_id = null`:** view `v_ai_upcoming_payables` keeps `payroll`/`tax` rows with `null` branch; `ai_context` filter `branch_id is null or branch_id is not distinct from v_effective` correctly includes them for both org-wide and branch-filtered calls (they are business-wide). Documented.

---

## 12. Verdict Classification

* **Not** `PASS` — hybrid violation leaks intra-tenant cross-branch financial data to two assigned-scope roles when unassigned.
* **Not** `DEFERRED` / `NOT APPLICABLE` — AI.BRANCH is explicitly Q14 B after P8; remediation was the goal of P5-E.
* **Not** `OWNER DECISION REQUIRED` — DEC-03 already signed; adding a hybrid tier would require an explicit owner “replace DEC-03 for AI” decision and a P5-D amendment to `can_access_branch`, not a silent sideload in an AI migration. No such decision exists.
* **Is** `REMEDIATION REQUIRED` (UNAUTHORIZED CONTRACT CHANGE) per P6/P7 evidence-only rule: “do not change product/security behaviour to make harness green” — the behaviour must be re-aligned to the signed contract.

---

## 13. Mandatory Validations (This Commit Remains Evidence-Only)

Commands run on `a9eeed6` (post-review, before push of this doc):

```
git diff --stat HEAD -- supabase tests src
→  (empty) — no migration, test, or src remediation in this commit ✓

git diff --check
→  (no trailing-whitespace errors) ✓

grep -n "branch_manager.*sales_manager.*not in" supabase/migrations/20261008000000_p5e_ai_branch_context.sql
→ 541: and v_membership_role not in ('branch_manager','sales_manager')  — still present (not yet fixed) ✓

grep -n "v_org_wide_roles" supabase/migrations/20261008000000_p5e_ai_branch_context.sql | wc -l
→ 1  — dead code still present ✓

git log --oneline -4
→ a9eeed6 P12: record retry attempt with hardened production DB link …
→ 682ebbc deploy: harden production DB link to use retry wrapper …
→ df7ee1c P12: record blocked production deployment …
→ 19e712b … (P5-E and P5-D migrations already in history, not yet in production)

git tag --points-at HEAD
→ (none) — tag v0.1.0-pilot remains at 682ebbc

git diff 19e712b..682ebbc --stat
→ .github/workflows/deploy.yml | 9 +++++++--  (only deploy harden, no src)

git branch --show-current
→ arena/01a0c215-ledgr-react
```

*No `supabase/migrations/*`, `src/*`, `tests/*` edits in this review commit — EVIDENCE-ONLY satisfied.*

---

## 14. Required Next Steps (Blocking Deploy)

1. **Author** remediation migration (preferred: squash-fix `20261008000000` before production push; alternative: new `20261009xxxxxx_p5e_fix_branch_manager_null_fail_closed.sql` with diff from §7.1).
2. **Remove** hybrid comment and `v_org_wide_roles` dead code as part of same fix.
3. **Run** `npm ci && node tmp_p5e_verify.mjs` (or `npm run test:release`) locally — prove **all** of T01-T20 pass, especially T11/T14 now `42501` and not `12000`, and that data sums (`5000` vs `7000` vs `12000`) are correct, not just codes.
4. **Run** `npx tsc --noEmit` + `npm run test` (branch.test.ts p5d_branchScope 8, R03 suite, safety suite) — no regressions.
5. **Re-proof** `r03-ai` matrix (that suite now also asserts the new 2-arg `ai_context` def contains `can_access_branch` but does not yet assert hybrid denial — add `P5E.BRANCH.BM-NULL` case to `r03-ai.test.ts`).
6. **Commit** remediation with message `P5-E: make branch_manager/sales_manager NULL fail-closed (DEC-03 align)` and include `Evidence: P5E.BRANCH.BM-NULL-OMITTED-DENIED now 42501, stock_clerk NULL still 42501, owner/auditor org-wide intact`.
7. **Re-run** `tests/release/database` harness self-test to confirm `can_access_branch` ≡ `ai_context` for assigned-null.
8. **Only then** consider moving `v0.1.0-pilot` and re-attempting `Deploy` (still requires Supabase project ACTIVE_HEALTHY + Management API / DB_PASSWORD_PROD verification per `LEDGR_P12_RETRY_ATTEMPT_2026-09-24.md`).

**Until those pass, do not claim `P5-E PASS`, do not merge PR #164, do not redeploy tag.**

---

## 15. Artifact Inventory

* This review: `docs/releases/LEDGR_P5E_SECURITY_REVIEW_2026-09-24.md` (this file) + `.json` companion
* Reproduction harness (uncommitted, for next env): `tmp_p5e_verify.mjs` (19-row data-verified, both signatures)
* Hardened deploy path (prior): `682ebbc` `.github/workflows/deploy.yml` → `scripts/ci/supabase-link-and-push.sh`
* Prior P12 evidence (unchanged): `docs/releases/LEDGR_P12_PRODUCTION_DEPLOYMENT_2026-09-24.md/.json` + `LEDGR_P12_RETRY_ATTEMPT_2026-09-24.md`

---

## 16. Sign-Off Invariants (for Auditor)

* Commit under review is `a9eeed6` (`git rev-parse HEAD`) — `20261008000000` as shipped in `682ebbc` is the violating version.
* This doc does **not** remediate — `git diff HEAD -- supabase` remains empty — so the violation is still present on branch and must be fixed before any deployment certification.
* The `branch_manager`/`sales_manager` hybrid tier was never signed; re-adding it would require a new `LEDGR_P4_OWNER_DECISION_RECORD` amendment explicitly removing them from `can_access_branch` assigned list and re-defining their AI semantics — none exists.

---

*Reviewed by: Arena Agent (EVIDENCE-ONLY mode, P6/P7 absolute rule enforced) — 2026-09-24.*
