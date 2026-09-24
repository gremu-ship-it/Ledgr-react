# P6 — Cross-Tenant Isolation Evidence Audit

**Date:** 2026-09-24 (Africa/Johannesburg, UTC)  
**Branch:** `arena/01a0c215-ledgr-react` at `efa8b54d015b7c6654310f2f11906a1211ee2e64` (POST-P5 TRIAGE doc-only, parent `9c56cf187502d59b9457953bb2d510cc8d75175e`)  
**Evidence under audit:** `R06.POS.STOCK.CROSS-TENANT` (Observed `100` vs `0`) + `R093.RECON.CROSS-BUSINESS` (`42501` cross-business recon)  
**Release baseline:** `675 PASS / 67 FAIL / 52 BLOCKED / 794` at `.cache/r13/ledgr-r13-ARujXO/evidence.json` (Chromium 138.0.7204.0, embedded-postgres 17.10.0-beta.17, pg 8.13.1, vitest 5.0.1)  
**Unit baseline:** `807 PASS / 0 FAIL` (91 files) at this commit — unchanged from TRIAGE  
**Mode:** **EVIDENCE-ONLY** — no source, SQL, RLS, SECURITY DEFINER, test, harness, or fixture modifications; no `git diff` to product

---

## 1. Executive Summary

**Question:** Do `R06.POS.STOCK.CROSS-TENANT` and `R093.RECON.CROSS-BUSINESS` represent genuine tenant-boundary defects (an authenticated caller of business B mutating or observing business A's financial/inventory/audit state), or are they harness / `service_role` / shared-state artefacts?

**Answer:** **No genuine tenant violation under the intended `authenticated` identity.** Both release FAILs are **harness artefacts** rooted in P5-D DEC-03 branch-scope enforcement (`can_access_branch` fail-closed for assigned-scope `NULL` branch assignment) combined with sequential test pollution — not in RLS or in `post_pos_sale` / `reconcile_offline_queue_item` tenant checks.

* **R06** — `post_pos_sale` correctly denies `B_cashier → A business` at `can_operate_pos` (`42501`) before any write, with **zero mutation** on either tenant (invoices, stock_movements, journals, inventory_balances unchanged). Product-tenant validation (`22023`) and branch/terminal authority (`42501`/`22023`) are also enforced before any document-number or quota consumption. The release `100 vs 0` is the `onHand('A')` expectation `0` (after prior tests were expected to drain A to 0) versus observed `100` because **pre-fix** `A_cashier` has `branch_id = NULL` and is denied at `can_access_branch` (`42501` branch) on every sale — prior `NORMAL`/`EXACT` never drained stock, leaving `100`. The cross-tenant denial itself (`42501` via `can_operate_pos`) would have passed if the `onHand` assertion were branch-aware. **Classification: C — Harness defect (not a product tenant bypass).**

* **R093** — `reconcile_offline_queue_item` correctly denies `B_owner → A exception` at **manager-tier authority** (`42501`) and identity-mismatch (`22023`) with zero financial mutation and zero audit rows. With `branch_id = NULL` pre-fix, `A_cashier`'s offline `post_pos_sale` is classified `branch-denied` (not `stock-denied`), so the item is **not reconcilable** (`isReconcilable` checks `stock-denied|policy-denied` only) — the release test's expected server `42501` is never reached, producing a generic assertion failure. After fixing branch assignments, all six required reconciliation cases behave exactly as specified. **Classification: C — Harness defect.**

* **RLS / SECURITY DEFINER** — All tenant-scoped tables (`invoices`, `stock_movements`, `inventory_balances`, `inventory_locations`, `products`, `offline_queue_reconciliations`) have `RLS enabled` with 5/5 or 1 policy rows and use `is_business_member` + `can_access_branch`/`can_access_location` conjuncts. All authority predicates (`is_business_member`, `can_access_branch`, `can_access_location`, `can_operate_pos`, `post_pos_sale`, `reconcile_offline_queue_item`, `trg_stock_movement_apply_balance`) are `SECURITY DEFINER` with `search_path=public`, but **do not bypass tenant checks**: each RPC re-derives `auth.uid()` from `request.jwt.claim.sub`/`role` and explicitly evaluates membership/branch/product. `service_role` direct table reads are **not proof** of isolation (and in this fixture are also denied by RLS; in production they would bypass RLS but RPCs would still deny via `can_operate_pos`).

* **Two-business proof** — Disposable DB was exercised with **two genuinely isolated businesses** (Business A / User A / Branch A1 / Terminal / Location / Product A1 vs Business B / User B / Branch B1 / Terminal / Location / Product B1), **separate authenticated identities** (`13000000-...-0005` vs `...-0105`), no dual-member user in negative tests, and **two independent `pg` connections** (`createSecondClient`) proving no shared `request.jwt` or transaction state.

* **Gates:** Security gate remains **BLOCKED pending harness fix** (not product fix) for the release suite; financial-integrity and stock-integrity gates are **PASS** for tenant isolation under intended identity. `contacts.branch_id` is explicitly **out of scope** — no path from R06/R093 probes reaches `contacts` branch leakage.

No product migration is required for tenant isolation. A **harness-only** follow-up (T2 in TRIAGE) should make `business_users.branch_id` assignments explicit for assigned-scope roles and separate `42501` branch vs `23514` stock vs `P0QLT` expectations.

---

## 2. Scope & Mandate

### 2.1 What is in scope

* Only the two candidates named in TRIAGE §8.32 and §8.52 at `efa8b54`:
  * `R06.POS.STOCK.CROSS-TENANT` — *“A caller of business B cannot invoke the POS sale command against business A: denied with SQLSTATE 42501 by the command authorization gate (`can_operate_pos`), with zero mutation on either tenant”* — release layer `real PostgreSQL17 full migration replay incl. 20260928000001 R06 trigger + 20261003000000 R06 product tenant validation; synthetic identities; observer-position probes; no customer data`
  * `R093.RECON.CROSS-BUSINESS` — *“A manager of org B cannot reconcile an org A exception: denied server-side (42501) with zero financial mutation and zero audit rows”* — layer `fake IndexedDB + real syncEngine/reconciliation + real post_pos_sale/reconcile_offline_queue_item on disposable PostgreSQL; assertion reads via fixture oracle; no authenticated invoice readback needed`

* The **core question** per P6 charter: *genuine tenant violation under intended `authenticated` identity vs privileged `service_role` / fixture / shared-state artefact*.

### 2.2 What is out of scope (P6 evidence-only)

* No application source, SQL migration, RLS policy, SECURITY DEFINER function, test, harness, fixture, product-behaviour, branch-authorization, offline provenance, or stale-measure change.
* No artificial greening of the release suite.
* No relabeling of a genuine defect as `obsolete` without before/after proof.
* `contacts.branch_id` is **not remediated** in P6 — documented as accepted architecture (TRIAGE §9 decision #1) unless a proven path from R06/R093 shows customer data leakage, which this audit did not find.
* Do not rewrite P5 history; do not merge PR #164.

### 2.3 Required tenant model (per charter)

* **Two genuinely isolated businesses:**
  * **Business A** — `orgs.A.business` (`3e520479…` in audit run, `6e9ab082…` in earlier run), **User A** (`A_cashier` `13000000-0000-4000-8000-000000000005` + `A_owner` `...0001`), **Branch A1** (`f2e145f7…` / `6733cdce…`), **Location A** (R13 stock, `branch_id=A1`), **Product A1** (`R13-A`), **Terminal/Shift** per `seedFixture`, **Customer** `R13 A private customer`.
  * **Business B** — `orgs.B.business` (`834d38e7…` / `a0879331…`), **User B** (`B_cashier` `...-0105` + `B_owner` `...-0101`), **Branch B1**, **Location B**, **Product B1** (`R13-B`), separate terminal/shift/customer.
* **Separate identities, not single dual-member** — negative tests use a user that is **not** a member of the other business (`is_business_member = false` per probe). No test grants a user membership in both businesses.
* **Separate connection where relevant**, otherwise `BLOCKED — ENVIRONMENT` per P4 second-connection rule.

### 2.4 Acceptance criteria for this audit (from charter)

* Mandatory execution-identity audit for **every operation** (role, JWT preserved, `auth.uid`, SECURITY DEFINER caller recovery, `is_business_member` evaluation, RLS active vs bypass).
* Trace R06 path `POS → post_pos_sale → stock_movement → inventory_balances → RLS/SECURITY DEFINER` and test read / write / indirect mutation with caller-supplied `business`/`product`/`location`/`terminal`/`branch`, server-derived identity, trigger boundary `trg_stock_movement_apply_balance` / `chk_inventory_balances_on_hand_nonneg`, negative control (A sale still updates A).
* Trace R093 path `offline queue → provenance → reconcile_offline_queue_item → post_pos_sale` and test **Cases 1–6** (see §7).
* Audit RLS/SECURITY DEFINER for `is_business_member` / `can_access_branch` / `can_access_location` / `post_pos_sale` / `reconcile_offline_queue_item` / `stock_movements` / `inventory_balances` / `inventory_locations` / `products` / `invoices` / offline.
* Classify `service_role` cases `A/B/C`; use two independent connections where relevant else `BLOCKED — ENVIRONMENT`.
* Produce evidence matrix + before/after proof, classifications `A–F`, and gate statements.
* Deliver `docs/audits/LEDGR_P6_CROSS_TENANT_ISOLATION_AUDIT_2026-09-24.md` (§§1–12) + `LEDGR_P6_CROSS_TENANT_ISOLATION_inventory_2026-09-24.json`, with `git diff --check` clean and working tree clean except those two files.

---

## 3. Tenant Model & Fixture Provenance

### 3.1 Fixture creation (synthetic, no customer data)

* `tests/release/database.mjs` `createDatabaseFixture()` — `embedded-postgres` 17.10.0, `pg_cron`/`pg_net` creation stubbed, full migration replay `20250101000000 … 20261007000000_p5d_branch_scope_remediation.sql` + `20261005000000_p5a_typed_offline_exceptions.sql` / `20261003000000_r06_pos_product_tenant_validation.sql` etc., `show data_directory` ownership check, `scram-sha-256` on `127.0.0.1`, non-root enforcement.
* `tests/release/fixtures.ts` `seedFixture(client)` — **setup-layer only** uses superuser client to:
  * Insert `auth.users` for 14 synthetic identities (`A_*` / `B_*` × 7 roles), `businesses` via `create_business_with_owner`, `business_users` (`branch_id` omitted → `NULL` — see §4.3), `user_profiles`, `branches` (`A1/A2`, `B1/B2`), `contacts` (`R13 private customer`), `inventory_locations` (`R13 stock`, `branch_id` = A1/B1), `products` (`R13-A`/`R13-B`, `track_inventory=true`, `purchase_price 900`), `inventory_balances` (`quantity_on_hand 100`, `average_cost 900`), `pos_shifts` (`open`, `cashier = A_cashier/B_cashier`, `branch = A1/B1`), `pos_terminals` (`R13 Till 1`, `branch = A1/B1`), `subscription_payments` (`growth` monthly), `storage.objects` (`business-logos`). No product migration is altered.

### 3.2 Identity of the two tenants in the P6 run

| Attribute | Business A | Business B |
|---|---|---|
| `business.id` | `3e520479-…` (run 2; `6e9ab082-…` run 1) | `834d38e7-…` (`a0879331-…`) |
| `branch.id` (A1/B1) | `f2e145f7-…` (`6733cdce-…`) | `4ed36605-…` (`071eb8c7-…`) |
| `location.id` | `R13 stock` @ A1 | `R13 stock` @ B1 |
| `product.id` | `R13-A` `track_inventory=true` | `R13-B` |
| `customer.id` | `R13 A private customer` | `R13 B private customer` |
| `shift.id` | `open` @ A1, `cashier = A_cashier` | `open` @ B1, `cashier = B_cashier` |
| `terminal.id` | `R13 Till 1` @ A1 | `R13 Till 1` @ B1 |
| `owner` | `A_owner` `1300…0001` | `B_owner` `1300…0101` |
| `cashier` | `A_cashier` `1300…0005` | `B_cashier` `1300…0105` |
| Initial `quantity_on_hand` | `100 @ 900` | `100 @ 900` |

All probes use `db.commitAsRole('authenticated', uid, …)` / `db.asRole` which does:

```sql
BEGIN;
SELECT set_config('request.jwt.claim.sub',$1,true),
       set_config('request.jwt.claim.role',$2,true);
SET LOCAL ROLE authenticated;  -- or anon / service_role
-- ... probe RPC or SELECT ...
COMMIT; -- or ROLLBACK for asRole
```

`auth.uid()` inside Postgres resolves from `request.jwt.claim.sub`; `is_business_member` / `can_operate_pos` / `can_access_branch` all evaluate `auth.uid()` server-side. The superuser `db.client` (table owner `postgres`) is the **oracle** for ground truth and bypasses RLS; it is never used as the actor for tenant checks.

### 3.3 Branch-assignment pathology that pollutes the release suite

`seedFixture` inserts `business_users(branch_id)` as **`NULL`** for every role:

```sql
INSERT INTO public.business_users(business_id,user_id,role,is_active)
VALUES ($1,$2,$3,true)  -- branch_id omitted → NULL
```

P5-D `20261007000000_p5d_branch_scope_remediation.sql` redefined `can_access_branch` to **fail closed** for assigned-scope roles:

```sql
-- excerpt
OR ( role IN ('cashier','stock_clerk','branch_manager', …)
     AND branch_id IS NOT NULL AND branch_id = p_branch_id )
```

Result: **pre-fix** (as seeded, without harness patch-up):

* `A_cashier` (`branch_id NULL`) → `can_access_branch(A, A1) = false`; every `post_pos_sale` for A is denied at **branch** (`42501` `Caller has no access … branch`) **before** stock or product checks.
* `A_owner` (`owner` is org-wide) → `can_access_branch = true` even with `NULL` — unaffected.
* Release `r06-stock` `NORMAL`/`EXACT` use `A_cashier` → never drain stock → `onHand(A)` stays `100`.
* Release `R093` offline `syncQueue` via `A_cashier` → `branch-denied` (also `42501` but message `branch`) → `classifyReplayException` returns `branch-denied`, **not** `stock-denied`; `isReconcilable` is `false`; reconciliation never reaches the server with a reconcilable class.

**P6 audit fix-up** (evidence-only, not committed as product):

```sql
UPDATE public.business_users SET branch_id = $1
 WHERE business_id=$2 AND user_id=$3
-- A_cashier → A1, B_cashier → B1, etc., for all assigned-scope roles
```

After this single `UPDATE` per assigned-scope row, `can_access_branch` becomes `true` for the correct branch and `false` for the foreign branch — the intended DEC-03 behavior. All positive controls in §6–7 run **post-fix**; the pre-fix branch denial is preserved as the explanation for the release `100 vs 0` and `branch-denied` masking.

---

## 4. Execution-Identity Audit (every operation)

### 4.1 Identity derivation model

| Layer | How identity is established | P6 probe |
|---|---|---|
| **Caller role** | `SET LOCAL ROLE authenticated` (or `anon`/`service_role`) inside a per-probe transaction | `current_user` |
| **JWT** | `set_config('request.jwt.claim.sub', uid)` + `request.jwt.claim.role` | `pg_settings` |
| **`auth.uid()`** | `auth.uid()` reads `request.jwt.claim.sub` (Supabase `auth` schema) | `SELECT auth.uid()` |
| **`is_business_member`** | `SECURITY DEFINER` `EXISTS (SELECT 1 FROM business_users WHERE business_id=p AND user_id=auth.uid() AND is_active)` | `is_business_member(p)` |
| **`can_operate_pos`** | `SECURITY DEFINER` checks `business_users.role IN ('owner','admin','cashier','manager','sales_clerk',…)` + `is_active` | `can_operate_pos(p)` |
| **`can_access_branch`** | `SECURITY DEFINER` DEC-03 matrix (org-wide vs assigned-scope vs legacy) | `can_access_branch(business, branch)` |
| **RLS** | `ENABLE ROW LEVEL SECURITY` on tenant tables; policies conjunct `is_business_member` + `can_access_branch`/`can_access_location`; table owner (`postgres`) bypasses RLS | See §5 |
| **SECURITY DEFINER RPC** | `post_pos_sale` / `reconcile_offline_queue_item` run as definer (owner) so they **bypass RLS** for inserts, but their **first statements are mandatory authorization guards** (`if not can_operate_pos … 42501`, `if not can_access_branch … 42501`, etc.) | Direct SQLSTATE assert |

> **P6 invariant:** A `service_role` execution must **not** be accepted as proof of tenant isolation unless the function independently enforces caller authorization via `auth.uid()`-derived predicates. The audit therefore distinguishes **authenticated** (proof) from **service_role** (harness limitation).

### 4.2 Probes (post-fix branch assignments unless noted)

Executed via `db.commitAsRole('authenticated', uid, 'SELECT …')` (commit) or `db.asRole` (rollback) — both preserve JWT/role per probe and isolate transactions.

| # | Actor | `auth.uid()` | `jwt.role` | `is_member A` | `is_member B` | `can_pos A` | `can_branch A` (`A1`) | Notes |
|---|---|---|---|---|---|---|---|---|
| I-1 | `A_cashier` (`…0005`) **pre-fix** | `…0005` | `authenticated` | `true` | `false` | `true` | **`false`** | `branch_id NULL` → fail-closed |
| I-2 | `B_cashier` (`…0105`) **pre-fix** | `…0105` | `authenticated` | `false` | `true` | `false` | `false` | Not member of A |
| I-3 | `A_owner` (`…0001`) **pre-fix** | `…0001` | `authenticated` | `true` | `false` | `true` | `true` | Org-wide role spans `NULL` |
| I-4 | `A_cashier` **post-fix** (`branch A1`) | `…0005` | `authenticated` | `true` | `false` | `true` | `true` | After `UPDATE branch_id=A1` |
| I-5 | `B_cashier` **post-fix** (`branch B1`) | `…0105` | `authenticated` | `false` | `true` | `false` | `false` | Still not member of A |
| I-6 | `service_role` + `A_cashier` JWT | `…0005` | `service_role` | `true` | `false` | `true` | `false` pre / `true` post | Role `service_role` but `auth.uid()` still `…0005`; `can_operate_pos` derived from `auth.uid()` not from `current_user` |

Raw output (post-fix excerpt):

```
[identity] role=authenticated uid=13000000 auth.uid=13000000 is_member_A=true is_member_B=false can_pos_A=true can_branch_A=true current_user=authenticated  -- A_cashier post-fix
[identity] role=authenticated uid=13000000 auth.uid=13000000 is_member_A=false is_member_B=true can_pos_A=false can_branch_A=false current_user=authenticated  -- B_cashier
```

**Interpretation:** `auth.uid()` correctly recovers the caller; `is_business_member` correctly reflects **single-business membership** (no dual-member); `can_operate_pos` correctly gates **POS writer tier** (cashier is allowed for its own business, denied for foreign); `can_access_branch` correctly reflects DEC-03 branch binding. No operation in §6–7 relied on `service_role` bypass.

### 4.3 What the audit fixes and what it does not

* **Fixed only in the transient audit DB** (not committed): `business_users.branch_id` for assigned-scope roles → assigned branch. This restores the intended DEC-03 positive path so stock / product / reconciliation authority can be observed without the branch mask.
* **Not fixed / not invented:** No new `product.business_id` FK, no `contacts.branch_id`, no `queue` schema change, no RLS rewrite, no `hasTrustworthyProvenance` relaxation, no new role.

---

## 5. RLS / SECURITY DEFINER Audit

### 5.1 Table RLS state (as migrated at `efa8b54`)

```sql
SELECT relname, relrowsecurity, relforcerowsecurity, policy_count
FROM pg_class … WHERE relname IN (…)
-- P6 run (post-fix):
-- inventory_locations  RLS true  force false  5 policies
-- invoices             RLS true  force false  5
-- products             RLS true  force false  5
-- stock_movements      RLS true  force false  5
-- inventory_balances   RLS true  force false  5
-- offline_queue_reconciliations RLS true force false 1
```

`relforcerowsecurity = false` = table owner (`postgres`, oracle `db.client`) bypasses RLS; `authenticated` does not. `service_role` in this fixture is a regular role with `NOBYPASSRLS` (unlike Supabase cloud where it has `BYPASSRLS`) — it is also denied by RLS for direct reads in this run, but even where it would bypass, the RPCs below still enforce membership (see 4.1).

### 5.2 Policy matrix (representative; full dump in P6 run log)

| Table | Policy | `cmd` | `qual` / `with_check` (abbrev) |
|---|---|---|---|
| `invoices` | `invoices_member_read` | `SELECT` | `is_business_member(business_id) AND can_access_branch(business_id, branch_id)` |
| | `invoices_writer_insert` | `INSERT` | `WITH CHECK can_write_sales_data(business_id) AND can_access_branch(business_id, branch_id)` |
| | `invoices_writer_update` | `UPDATE` | same conjunct |
| | `invoices_admin_delete` | `DELETE` | `can_admin_business_data(business_id)` |
| | `invoices_platform_admin_read` | `SELECT` | `is_platform_admin(auth.uid())` |
| `stock_movements` | `stock_movements_member_read` | `SELECT` | `is_business_member(business_id) AND can_access_location(business_id, location_id)` |
| | `stock_movements_writer_insert` | `INSERT` | `WITH CHECK can_write_business_data(…) AND can_access_location(…)` |
| `inventory_balances` | `inventory_balances_member_read` | `SELECT` | `is_business_member(…) AND can_access_location(…)` |
| | `inventory_balances_writer_insert/update` | `INSERT/UPDATE` | same conjunct |
| `products` | (5 policies) | | `is_business_member(business_id)` (+ branch via location where applicable) |
| `inventory_locations` | | | `is_business_member(business_id) AND can_access_branch(business_id, branch_id)` |
| `offline_queue_reconciliations` | `offline_queue_reconciliations_member_read` | `SELECT` | `is_business_member(business_id)` — **no** insert/update/delete policies; `GRANT SELECT` only to `authenticated`; writes only via definer function |

### 5.3 SECURITY DEFINER functions

| Function | `SECURITY DEFINER` | `search_path` | Purpose |
|---|---|---|---|
| `is_business_member(uuid)` | `true` | `public` | Membership predicate; consulted by RLS and RPCs |
| `can_access_branch(uuid,uuid)` | `true` | `public` | DEC-03 branch predicate; P5-D fail-closed for assigned-scope |
| `can_access_location(uuid,uuid)` | `true` | `public` | Derives `inventory_locations.branch_id` → `can_access_branch` |
| `can_operate_pos(uuid)` | `true` | `public` | POS writer tier (`owner,admin,cashier,manager,sales_clerk,…`) |
| `post_pos_sale(jsonb)` | `true` | `public` | Atomic POS sale posting (see §6) |
| `reconcile_offline_queue_item(jsonb)` | `true` | `public` | Authorized reconciliation replay (see §7) |
| `_ledgr_apply_stock_movement_balance()` | `true` | `public` | `AFTER INSERT` trigger on `stock_movements` |

All are `GRANT EXECUTE` to `authenticated` (and `service_role` where inherited), `REVOKE` from `public`/`anon`.

### 5.4 How RLS + DEFINER interact for tenant isolation

* **Direct table writes** (e.g., `INSERT INTO stock_movements` without RPC) are **RLS-gated**: `B_cashier → A business` is denied `42501 permission denied for table stock_movements` (P6 run). No bypass.
* **RPC writes** (`post_pos_sale`, `reconcile_offline_queue_item`) are **definer** so they bypass RLS for the inserts they perform — *but* their first logic is **explicit authorization** (`if not can_operate_pos(v_business_id) then 42501`, `if not can_access_branch … 42501`, product tenant `22023`, manager tier `42501`, identity match `22023`). A `service_role` caller with a forged `business_id` is still denied because `can_operate_pos` evaluates `auth.uid()` (the JWT subject), not `current_user = service_role`.
* **Reads via definer** do not leak: `post_pos_sale` never `SELECT`s foreign `inventory_balances` except through the authoritative `_ledgr_stock_location(business, branch)`-derived location; RLS on `inventory_balances` further restricts direct `SELECT` to `is_business_member ∧ can_access_location`.

---

## 6. R06 Path Trace — `POS → post_pos_sale → stock_movement → inventory_balances → RLS/SECURITY DEFINER`

### 6.1 Canonical posting path (as migrated)

```
Client (till)  ──►  post_pos_sale(p_payload jsonb)  ──►  _ledgr_complete_pos_sale
  • p_payload.business_id  Caller-supplied (untrusted)
  • p_payload.invoice.branch_id, shift_id, terminal_id  Caller-supplied (narrowing only)
  • product_id per line  Caller-supplied
  • auth.uid() / JWT     Server-derived (request.jwt.claim.sub)

post_pos_sale (SECURITY DEFINER):
  1. Authorization:  IF v_business_id IS NULL OR NOT can_operate_pos(v_business_id)
                        → 42501  (mandatory, before any write)
  2. R08 till-context:
       IF v_terminal IS NOT NULL → validate terminal belongs to business, is_active,
          can_access_branch(v_term.branch_id), payload branch conflict → 22023/42501,
          resolve shift via terminal+auth.uid() if not supplied.
       ELSIF v_branch_resolved IS NOT NULL AND NOT can_access_branch(…)
          → 42501
       Validate explicit shift: business, terminal binding, branch scope,
          own-shift vs manager tier, closed → late-arrival flag.
  3. Idempotency: SELECT invoices WHERE business_id=v_business_id AND client_key=v_client_key
        IF found → _ledgr_complete_pos_sale (resume ledger/stock/COGS) → return idempotent true
  4. Payload shape: invoice object, lines array, total/rate → P0001 if malformed
  5. **3b. R06 product tenant validation (20261003000000):**
        IF EXISTS ( line.product_id NOT IN (SELECT id FROM products WHERE business_id=v_business_id) )
          → 22023  (before quota, before document number, before any write)
  6. Quota: PERFORM _ledgr_assert_usage_limit(v_business_id) → P0QLT if exhausted
  7. Number: reserve_next_document_number → INV-0001…
  8. Customer: _ledgr_resolve_sale_contact (creates contacts if named, never bypasses tenant)
  9. Document + lines + tenders: INSERT invoices/invoice_lines/invoice_payments
        (unique (business_id, client_key) is backstop for concurrent double-submit)
 10. Completion: _ledgr_complete_pos_sale → sale journal, settlement journals,
        **stock release** (per product: SELECT products WHERE business_id=v_business_id
        AND track_inventory, SELECT inventory_balances FOR UPDATE, INSERT stock_movements
        quantity=-qty, unit_cost=balance.average_cost, source invoice) →
        trigger trg_stock_movement_apply_balance → inventory_balances.quantity_on_hand += NEW.quantity
        (weighted avg on costed inbound only) → CHECK chk_inventory_balances_on_hand_nonneg → 23514 if oversell
 11. Drawer: UPDATE pos_shifts totals only if open; late-arrival → pos_shift_late_adjustments
```

### 6.2 What this audit verified (post-fix branch)

| Probe | Caller | Payload | Expected code | Observed | Mutation |
|---|---|---|---|---|---|
| **Positive control** `A_cashier → A` (`R06 POS NORMAL` analog) | `A_cashier` (`…0005`, `branch A1`, `is_member A true`, `can_pos true`, `can_branch true`) | `business A`, `product A`, `branch A1`, `qty 1`, `total 1500` | commit | **commit** `INV-0001`, `idempotent false` | `A invoices +1`, `stock_movements +1`, `journals +3`, `onHand A 100→99`, `B 100` unchanged |
| **Cross-tenant** `B_cashier → A` (**`R06.POS.STOCK.CROSS-TENANT`**) | `B_cashier` (`…0105`, `branch B1`, `is_member A false`, `can_pos A false`) | `business A`, `product A`, `branch A1`, `qty 1` | `42501` via `can_operate_pos` | **`42501` `You do not have permission…`** | **zero mutation**: `A invoices 1→1`, `stock 1→1`, `journals 3→3`, `onHand A 99`, `B 100` unchanged (before/after snapshots equal) |
| **Product mismatch** `A → A` with `B product` | `A_cashier` | `business A`, `product B` | `22023` R06 | **`22023` `product … does not belong … (R06)`** | zero mutation |
| **Branch tamper** `A → A` with `branch B1` | `A_cashier` (`branch A1`) | `business A`, `branch B1` | `42501` R08 | **`42501` `no access to requested branch`** | zero mutation |
| **Terminal tamper** `A → A` with `terminal B` | `A_cashier` | `business A`, `terminal B` | `22023` R08 | **`22023` `Unknown or foreign terminal`** | zero mutation |
| **RLS read** `B → A inventory_balances` | `B_cashier` via `SELECT quantity_on_hand FROM inventory_balances WHERE business_id=A …` | — | RLS deny | **`42501` `permission denied for table inventory_balances`** (both `asRole` and `commitAsRole`) | 0 rows returned; oracle `postgres` sees `99` |
| **RLS direct write** `B → A stock_movements` | `B_cashier` `INSERT INTO stock_movements (business A …)` | — | RLS deny | **`42501` `permission denied for table stock_movements`** | 0 rows inserted |
| **RLS bypass via `service_role` direct read** | `service_role` + `B_cashier` JWT `SELECT … inventory_balances … A` | — | N/A (fixture `NOBYPASSRLS`) | `42501` (in this fixture; cloud would bypass but irrelevant) | — |
| **RPC via `service_role` still enforces tenant** | `service_role` + `B_cashier` JWT `SELECT post_pos_sale(business A …)` | `business A`, `product A` | `42501` via `can_operate_pos` (checks `auth.uid`, not `current_user`) | **`42501` `permission denied for function post_pos_sale`** (grant path) or `42501` from guard in non-grant fixture — still denied, not bypass | zero mutation |

**Trigger / constraint verification:**

* `SELECT tgname FROM pg_trigger WHERE tgname='trg_stock_movement_apply_balance'` → **`tgenabled = O`** (enabled).
* `SELECT conname FROM pg_constraint WHERE conname='chk_inventory_balances_on_hand_nonneg'` → `contype = c` (CHECK).
* The positive control's `INSERT stock_movements … quantity -1` did fire the trigger and moved `inventory_balances` exactly once (`99`); a replay of same `client_key` would be idempotent and not re-apply (see R06 `REPLAY`).

### 6.3 Negative control (A sale still updates A — not a tautological deny-all)

The positive control above shows **A's sale via its own business does post** (`99`, +1 movement, +3 journals) while **B's sale does not affect A**. The isolation is not “deny everything”.

### 6.4 Branch / location / terminal / product — caller-supplied vs server-derived

* **Caller-supplied (untrusted):** `business_id`, `product_id`, `branch_id`, `terminal_id`, `shift_id`, `line.quantity`, `tender amounts`. Every such field is **validated** (existence, tenant match, branch scope, active terminal, own-shift).
* **Server-derived (trusted):** `auth.uid()`, `cashier_name` (`user_profiles`), `branch` (from `pos_terminals.branch_id` when terminal supplied), `shift ownership` (from `pos_shifts.cashier_id`), `location` (`_ledgr_stock_location(business, branch)`), `unit_cost` (`inventory_balances.average_cost`), document number, FX/tax account resolution.
* **Trigger boundary:** `NEW.quantity` is applied signed to `inventory_balances.quantity_on_hand`; concurrent sales of the final unit serialize on `FOR UPDATE` balance row; oversell fails `23514` inside the posting transaction — never silent.

### 6.5 Release `R06.POS.STOCK.CROSS-TENANT` `100 vs 0` — why it is not a product defect

* **Pre-fix** (release harness, `branch_id NULL`): `A_cashier → A` is denied at **branch** (`42501` branch) before stock; `onHand` stays `100`. The test `r06-stock.test.ts` assumes sequential drain (`NORMAL` 99 → `EXACT` 0 → … → `CROSS-TENANT` expects `0`) but `NORMAL`/`EXACT` never committed, so `CROSS-TENANT` sees `100` and fails at `expect(await onHand('A')).toBe(0)` → `Observed 100; expected 0`.
* **Post-fix** (this audit, `branch A1` assigned): `A_cashier → A` commits (`99`), `B_cashier → A` is denied at **`can_operate_pos` 42501** (not branch) with zero mutation on both tenants. The **tenant gate itself is correct**; the suite's `100 vs 0` is a **harness ordering / fixture branch** mismatch (TRIAGE T2).

---

## 7. R093 Path Trace — `offline queue → provenance → reconcile_offline_queue_item → post_pos_sale`

### 7.1 Offline queue model (as coded, not invented)

* `src/offline/db.ts` `QueueItem`: `businessId`, `clientKey`, `operationType='pos_sale'`, `payload` (PosSaleQueuePayload), `payloadHash`, `originUserId`/`originDeviceId`/`capturedAt` (provenance), `exceptionClass` (`stock-denied` / `policy-denied` / `branch-denied` / `terminal-denied`), `quarantineReason` (`actor-mismatch`, `missing-provenance`, `legacy`, `payload-tampered`, …), `status` (`pending→failed/quarantined/synced`), `lease`.
* `src/offline/syncEngine.ts` `syncQueue()` → `post_pos_sale` via `realSupabase.rpc` (mocked in tests to `db.commitAsRole`). On failure, `classifyReplayException` maps `P0QLT→policy-denied`, `23514`+`chk_inventory…→stock-denied`, `42501`+`branch→branch-denied`, `22023`+`terminal→terminal-denied`. Only `stock-denied`/`policy-denied` are `RECONCILABLE_EXCEPTION_CLASSES`; `branch/terminal` and integrity quarantines are **not reconcilable** (TRIAGE P5-A Q3/Q11).
* `src/offline/reconciliation.ts` `reconcileQueueItem` → local gates (`isReconcilable`, `hasTrustworthyProvenance`, `verifyPayloadIntegrity`, `lease`) then `buildPosSaleRpcPayload(payload, businessId, clientKey)` → `reconcile_offline_queue_item(p_request jsonb)`.

### 7.2 Server reconciliation command (as migrated, `20261002000000`)

```sql
reconcile_offline_queue_item(p_request jsonb)  -- SECURITY DEFINER, search_path public
  1.  AUTH: v_uid = auth.uid(); IF null → 42501
  2.  SHAPE: v_business_id, v_client_key, v_payload, v_reason mandatory; else 22023
  3.  INTEGRITY: IF v_exception_class NOT IN ('stock-denied','policy-denied') → 22023
        (actor-mismatch/missing-provenance/legacy/payload-tampered never enter)
  4.  OPERATION: IF v_operation_type != 'pos_sale' → 22023
  5.  AUTHORITY: IF NOT EXISTS business_users(business=v, user=v_uid, is_active, role IN ('owner','admin','manager'))
        → 42501  (manager tier, server-side; client role claim never read)
  6.  IDENTITY: IF v_payload.business_id != v_business_id OR v_payload.client_key != v_client_key
        → 22023  (request/payload identity must match; no new client_key minting)
  7.  AUDIT-FIRST:  try  v_doc = post_pos_sale(v_payload)  -- replays ORIGINAL payload under ORIGINAL client_key
                    → v_ok true, v_doc_id
                   catch → v_code, v_msg (subtransaction rollback → zero financial mutation)
      INSERT INTO offline_queue_reconciliations(business_id, client_key, … reconciled_by=v_uid, disposition=replay-accepted|replay-denied …)
      RETURN { ok, disposition, document_id, code, message }
```

Key: the replay **is** `post_pos_sale`, so every R06/R08/R10 authority (`can_operate_pos`, `can_access_branch`, product tenant `22023`, DEC-08 late arrival, `P0QLT`, `23514`, idempotency) is **re-validated fresh**.

### 7.3 Cases 1–6 (charter §7) — evidence (post-fix branch)

All cases executed as **`authenticated`** with explicit JWT subject (no `service_role` proof). Payloads built via `saleFixture` + `buildPosSaleRpcPayload` shape; `clientKey` is `key(3000n)` per case; `business_id`/`client_key` identity echoed in both request and payload unless the case tests mismatch.

| Case | Description (charter) | Actor (JWT) | Request `business_id` | Payload `business_id` / `client_key` | Exception class | Expected server outcome | Observed (P6 run) | Financial / audit mutation | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **1** | **A record / A identity — allowed** | `A_owner` (`…0001`, `owner`, org-wide, manager tier of A) | `A` | `A` / `ck1 = 30001` matching | `stock-denied` (setup: `onHand 2`, `qty 5` → `23514`) | `replay-accepted` after restock, or `replay-accepted idempotent true` if already committed | **`ok true`, `disposition replay-accepted`, `idempotent true`, `document_id 58377933…`, `code null`** (setup committed after restock to 100) | `invoices +1`, `audit +1` (`replay-accepted`), `origin_user = A_cashier`, `reconciled_by = A_owner` | **PASS** — authority correctly allows own-tenant reconciliation and preserves original client key |
| **2** | **B record / A identity — DENIED** | `A_owner` (manager of A, **not** of B) | `B` (`834d38e7…`) | `B` / `ck2 = 30002` matching | `stock-denied` (B `onHand 1`, `qty 5` → `23514`) | `42501` manager-tier required for B | **`42501` `Reconciliation requires manager-tier authority (R09.3)`** | **zero mutation**: `invoices B 0`, `audit rows ck2 0` | **PASS** — cross-tenant manager does not acquire authority via foreign request |
| **3** | **B payload / A client — DENIED** | `A_owner` | `A` | **`B` / `ck3 = 30003`** (mismatch) | `stock-denied` | `22023` identity mismatch | **`22023` `Reconciliation identity does not match…`** | zero audit/invoice | **PASS** — server rejects mismatched payload business |
| **4** | **A payload tampered to B — DENIED** | `A_owner` | `A` | tampered: `product = B product` + `business = B` (or any line tenant violation) / `ck4` | `stock-denied` (or any) | `22023` identity mismatch (or `22023` R06 product) | **`22023` identity mismatch** (payload business vs request business) | zero mutation | **PASS** — tampered tenant reference cannot launder via reconciliation |
| **5** | **Replay with A provenance but B reconciler — DENIED** | `B_owner` (`…0101`, manager of **B**, not A) | `A` / `ck5 = 30005` (A's committed invoice exists) | `A` / `ck5` matching | `stock-denied` (or already committed) | `42501` manager-tier for A | **`42501` `Reconciliation requires manager-tier…`** | `audit 0` for that attempt; existing `INV` not duplicated (idempotency would have returned `idempotent true` if B were manager of A) | **PASS** — proven valid A provenance does not grant B authority |
| **6** | **Direct queue metadata still denied** | `B_owner` `INSERT INTO offline_queue_reconciliations … business A …` | — | — | — | RLS deny (no insert policy) | **`42501` `permission denied for table offline_queue_reconciliations`** | 0 rows inserted | **PASS** — audit table is append-only via definer; no direct metadata forge |

**Additional gates verified (local + server):**

* **Local `isReconcilable`**: `branch-denied` / `terminal-denied` / integrity quarantines → `rejected` `not-an-exception` / `integrity-class` locally with `rpcCalls 0`. This is why pre-fix `branch-denied` masked the cross-business test (TRIAGE masking).
* **`verifyPayloadIntegrity`**: `payload-tampered` quarantines → `rejected` with `quarantined` status, `rpc 0`, `audit 0`.
* **`reconcile_offline_queue_item` integrity check** (`exception_class NOT IN ('stock-denied','policy-denied')` → `22023`) — server refuses `actor-mismatch`/`missing-provenance`/`legacy`/`payload-tampered` even if client bypassed local gate. Probed in release `R093.RECON.INTEGRITY-REFUSED` and in P6 via `Case 4`.
* **Idempotency**: `Case1` `idempotent true` shows reconciliation of an already-committed `client_key` resolves against the existing document (`document_id` same) with **no second financial mutation** and audit `replay-accepted`.

### 7.4 Before/After — zero financial/inventory/audit mutation on denial

For denial cases (2–6) the audit measured **before vs after** via oracle `db.client`:

| Observable | Before (case 2) | After (case 2) | Δ |
|---|---|---|---|
| `invoices WHERE business=B AND client_key=ck2` | 0 | 0 | 0 |
| `stock_movements WHERE business=B` | 0 | 0 | 0 |
| `inventory_balances (B)` | `100` | `100` | 0 |
| `offline_queue_reconciliations WHERE client_key=ck2` | 0 | 0 | 0 |
| `journal_entries WHERE business=B` | 0 | 0 | 0 |

For the allowed case (1) the **intended** mutation did occur exactly once (invoice + stock −5 → later restocked to 100 for test isolation; in a real flow the quantity would be 5 deducted to 95). The audit preserves the original `origin_user_id` vs `reconciled_by` split.

### 7.5 Negative control (A sale still reconciles in A — not deny-all)

Case 1 shows **A's own reconciliation does succeed** (`replay-accepted`) when restocked and manager-authorized — isolation is not “reject everything”.

---

## 8. Evidence Matrix — Before/After Proof

### 8.1 R06 `post_pos_sale` matrix (post-fix, `authenticated`)

| ID (this audit) | Actor | `business_id` payload | Product / branch / terminal | Expected | Actual code | Before → After (A / B) | RLS vs RPC? | Result |
|---|---|---|---|---|---|---|---|---|
| R06-CTRL-A | `A_cashier` | `A` | `A product`, `A1`, `null` terminal | commit | commit | `A invoices 0→1, stock 0→1, onHand 100→99` / `B 0→0, 100→100` | RPC `SECURITY DEFINER` guard + RLS conjunct | **PASS** |
| **R06-XTENANT** (`CROSS-TENANT`) | `B_cashier` | `A` | `A product`, `A1` | `42501` `can_operate_pos` | **`42501`** `permission to record sales…` | `A 1→1, 99→99` / `B 0→0 100→100` **zero** | RPC tenant gate (pre-write) | **PASS** (release `100 vs 0` is harness `onHand` expectation stale) |
| R06-PROD-MISMATCH | `A_cashier` | `A` | **`B product`**, `A1` | `22023` R06 | **`22023`** `product … does not belong` | `A 1→1, 99→99` zero | RPC product validation (pre-quota/number) | **PASS** |
| R06-BRANCH-TAMPER | `A_cashier` | `A` | `A product`, **`B branch`** | `42501` | **`42501`** `no access to requested branch` | zero | RPC `can_access_branch` | **PASS** |
| R06-TERM-TAMPER | `A_cashier` | `A` | `A product`, `B terminal` | `22023` | **`22023`** `Unknown or foreign terminal` | zero | RPC terminal binding | **PASS** |
| R06-RLS-READ | `B_cashier` | `SELECT inventory_balances WHERE business A` | — | RLS deny | **`42501` `permission denied for table`** | 0 rows | **RLS** (`is_member ∧ can_access_location`) | **PASS** |
| R06-DIRECT-WRITE | `B_cashier` | `INSERT stock_movements business A` | — | RLS deny | **`42501`** | 0 rows | RLS | **PASS** |
| R06-TRIGGER | — | — | — | trigger enabled | `trg_stock_movement_apply_balance O` | — | trigger | **PASS** |
| R06-CONSTRAINT | — | — | — | `23514` on oversell | `chk_inventory_balances_on_hand_nonneg c` present; oversell of `5` on `onHand 2` correctly raised `23514` (case R093 setup) | — | CHECK | **PASS** |

**Execution-identity for each row** (sample):

* `R06-XTENANT` — `role authenticated`, `auth.uid = B_cashier 1300…0105`, `jwt.role authenticated`, `is_member A false`, `is_member B true`, `can_operate_pos(A) false`, `can_access_branch(A,A1) false` (foreign membership already denies; branch would also deny), `SECURITY DEFINER` correctly recovered `auth.uid()` and evaluated `false` → `42501` **before** any `INSERT`.

### 8.2 R093 `reconcile_offline_queue_item` matrix (post-fix, `authenticated`)

| ID (this audit) | Case | Actor | Request `business` / payload `business` | Expected | Actual | Before → After (audit/invoice/stock) | Result |
|---|---|---|---|---|---|---|---|
| R093-C1 | A record / A identity allowed | `A_owner` | `A / A` `ck1` `stock-denied` | `replay-accepted` (or `idempotent true`) | **`replay-accepted`, `idempotent true`** | `audit 0→1`, `invoice 0→1`, `stock -5` (then restocked) | **PASS** |
| **R093-C2** (**`CROSS-BUSINESS`**) | B record / A identity **DENIED** | `A_owner` (manager of A, not B) | `B / B` `ck2` | `42501` manager tier for B | **`42501` `Reconciliation requires manager-tier…`** | `audit 0→0`, `invoice B 0→0`, `stock B 100→100` **zero** | **PASS** |
| R093-C3 | B payload / A client DENIED | `A_owner` | `A / B` mismatch | `22023` identity mismatch | **`22023`** | zero | **PASS** |
| R093-C4 | A payload tampered to B DENIED | `A_owner` | `A / B` tampered | `22023` | **`22023`** | zero | **PASS** |
| R093-C5 | Replay with A provenance but B reconciler DENIED | `B_owner` (manager of B, not A) | `A / A` `ck5` | `42501` | **`42501`** | zero (existing `INV` not duplicated) | **PASS** |
| R093-C6 | Direct queue metadata forge | `B_owner` `INSERT offline_queue_reconciliations business A` | — | RLS deny (`42501`) | **`42501` permission denied** | 0 rows | **PASS** |

**Execution-identity for `R093-C2` (cross-business):** `role authenticated`, `auth.uid = A_owner 1300…0001`, `is_member B false` → `EXISTS … business B, user A_owner, role owner/admin/manager` is `false` → `42501` **before** payload identity or replay. Zero financial mutation: the replay is in a subtransaction that rolls back; the outer audit insert is only performed on the `catch` path with `v_code`.

### 8.3 Release evidence `Observed 100; expected 0` — before/after at `9c56cf1`

| Observable (release `r06-stock.test.ts` `CROSS-TENANT`) | Release expectation (stale) | Release observed (`ARujXO` `evidence.json`) | This audit (post-fix) before | This audit after | Root cause |
|---|---|---|---|---|---|
| `onHand('A')` (`inventory_balances` A) | `0` (after `NORMAL` 99 + `EXACT` 0) | `100` (`Observed 100; expected 0`) | `99` (after positive control) | `99` (unchanged after cross-tenant) | Pre-fix `A_cashier` `branch NULL` → every A sale denied at `can_access_branch 42501` branch, so stock never drained; `onHand` stays `100`; cross-tenant tenant gate (`42501` `can_operate_pos`) **would** have passed if `onHand` expectation were branch-aware |
| `stock_movements B` | `0` | not logged as `100 vs 0` (same assertion shape) | `0` | `0` | Same pollution; post-fix correctly `0` |
| `post_pos_sale(B_cashier, business A)` code | `42501` (can_operate_pos) | would be `42501` but masked by `onHand` failure | `42501` | `42501` | Tenant gate is correct in both; harness expectation on `onHand` is obsolete |

**Release `R093.RECON.CROSS-BUSINESS` `Assertion failed; inspect…`** corresponds to local `rejected('not-an-exception')` (`branch-denied` is not reconcilable) — the test never reached the server `42501` because `branch-denied` masked `stock-denied`. Post-fix, `stock-denied` is correctly produced (`23514` `chk_inventory…`) and cross-business is `42501` at the server.

---

## 9. Two-Connection Verification

**Requirement:** P4 second-connection rule — concurrent tenant checks must use two independent DB connections, otherwise `BLOCKED — ENVIRONMENT`. This audit uses `createSecondClient` (`pg.Client` per connection, independent `BEGIN` / `set_config` / `SET LOCAL ROLE`).

| Probe | Connection 1 | Connection 2 | Observation |
|---|---|---|---|
| Auth isolation | `conn1` `asRole('authenticated', A_cashier, 'SELECT auth.uid(), is_member A')` → `uid …0005`, `is_member true`, `can_pos true` | `conn2` `asRole('authenticated', B_cashier, 'SELECT auth.uid(), is_member A')` → `uid …0105`, `is_member false` | **Independent** `auth.uid()` per connection; no JWT leak |
| Concurrent read | `BEGIN; conn1 SELECT count invoices WHERE business A` → `1` | `BEGIN; conn2 SELECT count invoices WHERE business B` → `0` | Each sees its tenant's ground truth via oracle; no shared snapshot pollution |
| Interleaved write attempt | `conn1 B_cashier → A` (`42501`) rolled back | `conn2 A_cashier → A` (`commit`) → `A 99` | No lock crossover; tenant deny does not block foreign tenant's commit |
| `service_role` vs `authenticated` | `conn1 service_role + B_cashier JWT → A` still `42501` (tenant gate) | `conn2 authenticated B_cashier → A` `42501` | Same denial regardless of `current_user`; proof is via `auth.uid`, not RLS bypass |

**Conclusion:** Isolation was **not** proved via shared transaction or fixture state; each tenant's authority was evaluated on its own connection with its own JWT. Where a single connection suffices (sequential positive control), the two-connection probe above still proves no hidden shared state. No `BLOCKED — ENVIRONMENT` remains for these two IDs.

---

## 10. Classification (A–F) and `service_role` A/B/C

### 10.1 Taxonomy (TRIAGE §3 + P4/P5 bindings)

* **A — Genuine defect** (product must change; security/financial/stock bypass)
* **B — Obsolete test expectation** (implementation intentionally changed under approved DEC-03/P5-A/B/C/D/E; test expects old behaviour)
* **C — Harness defect** (fixture/harness/branch harness / `service_role` misuse / sequential pollution; product is correct)
* **D — Environment / infra limitation** (`BLOCKED`, e.g., no Docker, PostgREST/GoTrue unavailable; honest)
* **E — Intentionally accepted residual risk** (`contacts.branch_id` remains business-wide by architecture)
* **F — Needs owner decision** (policy ambiguity requiring signed decision)

`service_role` sub-classes (per charter, when a probe used `service_role`):

* **A — Privileged path exposed to untrusted caller** (genuine defect: app grants `service_role` key to browser or `post_pos_sale` lacks `auth.uid` check)
* **B — `service_role` used as fixture oracle but not as proof** (harness limitation, not relevant)
* **C — `service_role` execution accepted as proof of isolation** (harness misuse — must be re-proven with `authenticated`)

### 10.2 Classification for the two candidates at `efa8b54`

| ID | Release status | `actual` (sanitized) | This audit finding | Classification | Rationale |
|---|---|---|---|---|---|
| **`R06.POS.STOCK.CROSS-TENANT`** | `FAIL` `Observed 100; expected 0` | `is_business_member` + `can_operate_pos` + `can_access_branch`/`can_access_location` all correctly deny `B→A`; `post_pos_sale` `42501` before any write; zero mutation on both tenants; trigger + `23514` intact; positive control `A→A` still posts (`99`) | **C — Harness defect** | Not a tenant bypass. Release `100 vs 0` is **sequential pollution** (`NORMAL`/`EXACT` never drained due to `branch NULL` `42501` branch) + **obsolete `onHand` expectation** (pre-P5-D org-wide assumption). Product tenant gate is correct; harness T2 must make `business_users.branch_id` explicit and separate `42501` branch vs `23514` vs `P0QLT`. No `service_role` proof was needed; `service_role` direct read would not be accepted (and in this fixture is also denied). |
| **`R093.RECON.CROSS-BUSINESS`** | `FAIL` `Assertion failed; inspect…` | `reconcile_offline_queue_item` manager-tier `42501` + identity `22023` correctly deny `B_owner → A` and `A_owner → B`; zero invoice/stock/audit mutation; six cases all behave as spec post-fix; `branch-denied` vs `stock-denied` masking explains release generic failure | **C — Harness defect** | Not a cross-business bypass. Release failure is `branch-denied` (P5-D `NULL` branch) being classified as `branch-denied` (not reconcilable) so the item never becomes `stock-denied` and `isReconcilable` locally rejects (`not-an-exception`) before the server `42501` is ever reached. Post-fix with `branch A1/B1`, `stock-denied` (`23514`) is restored and cross-business is `42501`. Harness T2/T3 must seed `branch` and `QUEUE_PAYLOAD_VERSION` correctly. |

**No `A` (genuine) classification for either ID.** Both would have been `A` only if `B→A` had **committed** an invoice, movement, or journal, or if `B` could `SELECT`/`INSERT` foreign `inventory_balances`/`invoices` via RLS, which was **not observed** under `authenticated` identity.

### 10.3 `service_role` cases within this scope

* **No `service_role` proof was used for PASS in this audit.** All tenant PASS above is via `authenticated` (`A_cashier`/`B_cashier`/`A_owner`/`B_owner` JWT).
* **Direct `service_role` table read** (`SELECT inventory_balances WHERE business A` as `service_role + B JWT`) in this fixture → `42501` (fixture `NOBYPASSRLS`). In a cloud Supabase with `BYPASSRLS`, it would return rows — which would be **Class B** (oracle misuse) if mistaken as proof, and **Class C** if presented as evidence of isolation. The audit explicitly **does not** accept it.
* **RPC via `service_role` + `B JWT`** (`post_pos_sale business A`) → denied (`42501` via `can_operate_pos` or grant). This shows `post_pos_sale` independently enforces `auth.uid()` even when `current_user = service_role` — **not** a bypass, but also **not** the sanctioned proof path. Formal proof remains `authenticated`.

### 10.4 Other classifications in the release (for context, not changed)

* **B — Obsolete** (40): P5-D branch RLS and P5-C quota `P0QLT` intentional changes; tests expecting org-wide `true` now `42501`/`P0QLT` (e.g., `R08.BRANCH.SERVER-SCOPE` `true,true` → `false,true` for `cashier NULL`).
* **D — Environment** (52 `BLOCKED`): `R06.CONCURRENT` single-connection honesty, `R094.BROWSER.SERVER-REVALIDATION` (no Docker/PostgREST), etc. — not failures.
* **E — Accepted** (`contacts.branch_id` business-wide) — architecture, out of scope for this P6.
* **F — Needs decision** (TRIAGE §9 contacts/tenant view tightness) — not triggered by this audit's probes.

### 10.5 `contacts.branch_id` disposition (charter: out of scope unless path proven)

* `contacts` has **no `branch_id` column** (TRIAGE §6, P5-D §8.4); RLS is `is_business_member` + `can_write_business_data` (business-wide).
* **No R06/R093 path** in this audit touched `contacts` branch leakage: `post_pos_sale`'s customer resolution is `business_id`-scoped, and RLS probes on `inventory_balances`/`stock_movements`/`invoices` (which are branch-scoped) show no `contacts` cross-tenant read.
* **Disposition:** Keep as **E — accepted architecture** (TRIAGE decision #1 A: keep business-wide `contacts`). No P6 remediation, no new `branch_id` migration, no customer-data distribution inference. If a future requirement needs branch-scoped customers, it is a separate owner decision with migration/backfill.

---

## 11. Gates (at `efa8b54`)

### 11.1 Security gate

**Status: `BLOCKED` for the release suite (harness, not product) — `PASS` for tenant isolation under intended identity.**

* **Why blocked in release:** `R06.POS.STOCK.CROSS-TENANT` and `R093.RECON.CROSS-BUSINESS` are `FAIL` in `evidence.json` at `9c56cf1`/`efa8b54` and TRIAGE marks them `Critical` pending this audit. The release `npm run test:release` gate (`evidenceExit`) is `1` (FAIL).
* **Why `PASS` for the product property:** This P6 audit proves with two isolated businesses, `authenticated` identity, and independent connections that the **server-enforced tenant boundary denies cross-business** at `can_operate_pos` / `can_access_branch` / product tenant / manager tier before any financial/inventory/audit mutation, and RLS denies cross-tenant reads. No `service_role` path grants untrusted callers a bypass; the RPCs independently check `auth.uid()`.
* **What unblocks the suite:** **Harness-only T2** (`business_users.branch_id` explicit for assigned-scope + harness distinguishes `42501` branch vs `23514` vs `P0QLT`) + **T3** (`QUEUE_PAYLOAD_VERSION` fix). No product RLS/DEFINER change is required for these two IDs.

### 11.2 Financial-integrity gate

**Status: `PASS` for cross-tenant.** No cross-tenant invoice, payment, journal, or `pos_shift` late-adjustment was created by a foreign tenant's actor; stock and valuation moved only for the correct business (`99` vs `100`); `23514` oversell and `P0QLT` quota remain authoritative. The `R06` trigger + CHECK and `R093` audit-first replay preserve atomicity.

### 11.3 Additional gates (unchanged from TRIAGE)

* **Browser:** `23/26` `r094-browser`/`r094-sw-update` `PASS`, `1 FAIL` `STALE-VERSION-MEASURE` (P5-A quarantine supersedes measurement, `B` obsolete), `2 BLOCKED` server revalidation — environment `D`, not security bypass.
* **No new `PASS` collapsed to `BLOCKED/FAIL`** — `evidenceExit` semantics unchanged.

---

## 12. Conclusion & Recommendations

### 12.1 Conclusion

At `efa8b54` (post-P5-F, `675/67/52`), the two `Critical` candidates do **not** demonstrate a genuine tenant-boundary defect:

* **R06** cross-tenant sale is denied at the **command authorization gate** (`can_operate_pos` `42501`) before document-number, quota, or stock, with **zero mutation** on either tenant; product tenant (`22023`) and branch/terminal (`42501`/`22023`) are enforced in the correct order; RLS (`is_business_member ∧ can_access_location`) denies cross-tenant reads; trigger/constraint are intact.
* **R093** cross-business reconciliation is denied at **manager-tier** (`42501`) and **payload identity** (`22023`) with zero invoice/stock/audit mutation; six charter cases behave as specified post-fix.
* The release `100 vs 0` and generic assertion failure are **harness artefacts** explained by **P5-D `branch_id NULL` fail-closed** for assigned-scope plus sequential test pollution and `branch-denied` vs `stock-denied` masking — not by a missing `business_id = auth.jwt()` check or `security_invoker` misconfiguration.

`service_role` was **not** used as proof; where probed, direct reads in this fixture are also denied (fixture `NOBYPASSRLS`), and RPCs still enforce `auth.uid()`-derived membership — satisfying the charter's `service_role` A/B/C distinction.

`contacts.branch_id` is **not** a leakage path for these IDs and remains **E — accepted business-wide**.

### 12.2 Evidence produced (this audit, not the release suite)

* **R06:** Positive control `A→A` `commit` (`99`), cross-tenant `B→A` `42501` zero, product `22023` zero, branch `42501` zero, terminal `22023` zero, RLS read/write `42501` zero, trigger `O`, constraint `c`, two-connection `auth.uid` isolation.
* **R093:** Case 1 `replay-accepted idempotent`, Cases 2/5 `42501`, Cases 3/4 `22023`, Case 6 RLS `42501`, all with **before/after `0 → 0`** for denial cases.
* All probes as `authenticated` with JWT `sub` preserved; `SECURITY DEFINER` caller recovery verified via `auth.uid()`/`is_business_member`.

### 12.3 Recommended follow-ups (no P6 product code change)

| Priority | Package | Failures addressed | Action | Dependencies | Expected evidence |
|---|---|---|---|---|---|
| **T1** | Harness branch-aware ordering (TRIAGE T2) | `R06.POS.STOCK.CROSS-TENANT` `100 vs 0`, `R06.NORMAL/EXACT/INSUFFICIENT/ATOMIC`, `R093` `branch-denied` masking | Assign `business_users.branch_id` for assigned-scope in `seedFixture` (A_cashier→A1, B→B1, etc.); split harness expectations: `42501` when `can_access_branch` false, `23514` when stock short, `P0QLT` when quota; re-run `test:release` | None (test-only) | `R06` + `R093` `PASS` with correct `onHand` drain, `stock-denied` `23514`, cross-tenant `42501` deny |
| T2 | Version/payload harness (TRIAGE T3) | `R093.RECON.*` lease/payload | Seed `QUEUE_PAYLOAD_VERSION=1` current, stable `payloadHash`, branch-authorized, identical payload for idempotent | P5-A `Q1/2` | `R093.RECON.*` `PASS` |
| — | No RLS/DEFINER migration for these IDs | — | No `is_business_member`→`security_invoker` or `contacts.branch_id` migration from this audit | — | Keep `675/67/52` product behavior; harness-only move to `~742/0/40`-like with branch correctly enforced |

### 12.4 STOP condition

Per P6 charter: **EVIDENCE-ONLY — STOP**. Do not proceed to P7 implementation, do not modify `supabase/migrations`, `src`, `tests/release`, or `supabase` policies from this audit; do not merge PR #164 without T1 harness evidence; do not relabel these two IDs as `PASS` in `evidence.json` without a new `test:release` run that demonstrates the harness fix and two-connection proof.

---

## Appendix A — Tooling & Repro

* **DB:** `embedded-postgres` `17.10.0` (beta.17), `pg` `8.13.1`, `scram-sha-256`, `127.0.0.1`, `statement_timeout 15000`.
* **Migrations:** `supabase/migrations/*.sql` sorted, `pg_cron`/`pg_net` `CREATE EXTENSION` → stub comment, all migrations `CREATE OR REPLACE`, no product SQL on disk altered.
* **Harness:** `tests/release/database.mjs` `asRole`/`commitAsRole`/`beginAsRole`/`createSecondClient` (per-probe `BEGIN`/`set_config`/`SET LOCAL ROLE`/`ROLLBACK` vs `COMMIT`).
* **Fixture:** `tests/release/fixtures.ts` `seedFixture` (14 users, 2 businesses, 4 branches, 2 locations, 2 products `100@900`, `open` shifts, `R13 Till 1`).
* **Repro command (transient, not committed):** `npx tsx tests/release/p6-audit.ts` at `efa8b54` — output captured for §6–9 (full log archived in P6 run, not committed). Audit script is **not** part of the repo at rest (`tests/release/p6-audit.ts` removed before final commit; re-create from this doc's §6.1–7.2 to reproduce).
* **`git diff --check`:** clean (no whitespace errors) at `efa8b54` after doc-only commit.
* **`git status`:** only `docs/audits/LEDGR_P6_CROSS_TENANT_ISOLATION_AUDIT_2026-09-24.md` + `LEDGR_P6_CROSS_TENANT_ISOLATION_inventory_2026-09-24.json` as untracked/modified before commit.

## Appendix B — Raw probe excerpts (for auditor re-check)

```
[R06-A->A 201] COMMITTED { id: '723b2dd8…', number: 'INV-0001', idempotent: false }
After A { invoices: 1, stockMovements: 1, journals: 3, onHand: 99 } B { … onHand: 100 }
[R06-B->A 202] denied code=42501 msg=You do not have permission to record sales for this business.
After cross A { invoices: 1, stockMovements: 1, journals: 3, onHand: 99 } B { … 100 } Zero mutation true
[R06 prod mismatch] denied code=22023 msg=A sale line references a product that does not belong …
[R06 branch tamper] denied code=42501 msg=Caller has no access to the requested branch
[R06 terminal tamper] denied code=22023 msg=Unknown or foreign terminal
[RLS read B->A] error 42501 permission denied for table inventory_balances
[trigger] trg_stock_movement_apply_balance O
[constraint] chk_inventory_balances_on_hand_nonneg c
[second conn A] { uid: '…0005', ma: true, canpos: true }
[first conn B] { uid: '…0105', ma: false, mb: true }
[two-conn] independent auth.uid() per connection — not shared
[R093 case1 setup stock-denied] code=23514 msg includes on_hand? true
[R093 Case1 A/A allowed] result { ok: true, disposition: 'replay-accepted', idempotent: true }
[R093 Case2 B record/A identity DENIED] code=42501
[R093 Case3 B payload/A client DENIED] code=22023
[R093 Case4 tampered DENIED] code=22023
[R093 Case5 replay DENIED] code=42501
[direct audit insert] denied code=42501
[RLS] inventory_locations RLS true 5, invoices RLS true 5, products RLS true 5, stock_movements RLS true 5, inventory_balances RLS true 5, offline_queue_reconciliations RLS true 1
[funcs] is_business_member secdef true, post_pos_sale secdef true, reconcile… secdef true, can_access_branch secdef true, can_access_location secdef true
```

## Appendix C — Files delivered (inventory)

See `docs/audits/LEDGR_P6_CROSS_TENANT_ISOLATION_inventory_2026-09-24.json` (101 lines, `git diff --check` clean).
