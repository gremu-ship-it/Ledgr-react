# Construction branch scope — decision brief, and Group B verification plan

**Date:** 2026-10-16 **Branch:** `arena/2faa03b4-ledgr-react` **Head:** `7dac103`
**Status:** decision **AWAITING APPROVAL** — no policy, schema, grant or migration was changed by this brief.
**Evidence layer:** local isolated (embedded PostgreSQL 17.10, full migration replay). **No deployed
environment was contacted, and nothing here is deployed verification.**

This brief answers one question, presents the three documented options with their real costs, and prepares
the isolated deployed (Group B) verification that must follow the decision. It accompanies
[`LEDGR_PRODUCTION_READINESS_56_BLOCKED_AND_PHASE3_2026-10-16.md`](../audits/LEDGR_PRODUCTION_READINESS_56_BLOCKED_AND_PHASE3_2026-10-16.md) §14.1
and [`CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md`](CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md) §7.6–7.8.

---

## 1. The question, and the measured answer

> **May a user assigned only to Branch A1 read Branch A2's construction purchase orders within the same
> business?**

**Yes — today, in the replayed schema, they can.** Measured, not inferred:

| Probe (user = business A, role `branch_manager`, `business_users.branch_id` = A1) | Result |
| --- | --- |
| `is_business_member(businessA)` | `true` |
| `can_access_branch(businessA, A1)` | `true` |
| `can_access_branch(businessA, A2)` | **`false`** — the predicate decides correctly |
| `construction_purchase_orders` @A2 visible | **1 row** (privileged ground truth: 1 exists) |
| `construction_purchase_order_lines` @A2 visible | **1 row** |
| `construction_goods_receipt_notes` @A2 visible | **1 row** |
| `construction_procurement_sites` @A2 visible | **1 row** |
| **Control** — `invoices` @A2 visible | **0 rows** (privileged ground truth: 1 exists) → denial *is* detectable by this method |
| `expenses` / `journal_entries` / `stock_movements` | SQLSTATE 42501, no SELECT grant for `authenticated` — **not a policy verdict either way** |

and the identical user is refused at the **command** boundary:

| Command probe (same A1-only user, holding every procurement capability) | Result |
| --- | --- |
| `create_construction_purchase_order` on the A2 site | REFUSED 42501 — `You do not have access to that branch.` |
| `create_construction_purchase_order` on the A1 site | ALLOWED |
| `authorize_construction_purchase_order` on the A2 PO | REFUSED 42501 — `You do not have access to that branch.` |
| `authorize_construction_purchase_order` on the A1 PO | ALLOWED |
| `register_construction_procurement_site` against the A2 branch | REFUSED 42501 — `You do not have access to that branch.` |
| `grant_construction_procurement_capability` | REFUSED 42501 — owner/admin only |

Read RPCs are gated by business membership alone and therefore span all branches:
`construction_procurement_open_items`, `construction_procurement_capabilities_for` and
`construction_project_material_cost` are `security definer`, check `is_business_member(p_business_id)`, and
group by `business_id` with no branch predicate
(`20261021000000_construction_procurement_traceability.sql:3818, 3858, 244`).

**So the gap is precise and asymmetric: construction *commands* enforce the branch; construction *reads*
do not.** An A1-only user sees A2 purchase orders, receipt notes and sites that the server will refuse to
let them act on.

Raw output: `.cache/branch-scope-measurement.txt` (read census: `.cache/branch-scope-census.txt`).

## 2. Correction to the recorded premise (repo state differs from §14.1)

§14.1 and the eight `BRANCH.*` audit strings assert that core tables — *"invoices, contacts,
`journal_entries`, products, inventory …"* — keep org-wide `is_business_member` SELECT policies from
`20260728000008`. **That is out of date.** A later migration,
`20261007000000_p5d_branch_scope_remediation.sql` (2026-10-07), redefines `can_access_branch` and
re-creates the SELECT/INSERT/UPDATE policies **with a branch predicate** for 23 tables.

Census of the replayed schema (`pg_policies`, 119 SELECT policies on 89 tables):

| Family | Tables |
| --- | --- |
| **Branch-scoped** (23) | accounts, branches, budget_lines, departments, employees, expense_lines, expense_payments, expenses, fixed_assets, inventory_balances, inventory_locations, invoice_lines, invoice_payments, invoices, journal_entries, journal_lines, pos_cash_movements, pos_shift_closes, pos_shift_late_adjustments, pos_shifts, stock_movements, stock_transfer_lines, stock_transfers |
| **Org-wide member read** (37) — includes **all 18 construction tables** | 18 × `construction_*`, plus accounting_periods, asset_categories, bank_statement_lines, bank_statements, budgets, business_users, businesses, **contacts**, depreciation_schedules, invoice_delivery_events, offline_queue_reconciliations, paye_bands, pos_price_overrides, pos_settings, pos_terminals, product_categories, **products**, recurring_invoices, **tax_configurations** |

`construction_procurement_capabilities` (the 19th construction table) has SELECT `using (true)` for any
signed-in caller. `can_access_branch` is used by the till family, by the 23 tables above, and by the
construction **commands** — not by construction read policies.

Consequences of the correction:

- `BRANCH.read`, `BRANCH.modify`, `BRANCH.inventory`, `BRANCH.financial` and `BRANCH.cross-branch-admin`
  carry reason strings that the measured census no longer supports (e.g. `journal_entries` and
  `stock_movements` **are** branch-scoped now; `stock_movements` goes through `can_access_location`).
- The genuinely open question is therefore narrower and belongs to **construction**: 18 of the 37
  org-wide tables are the construction read surface (the 19th construction table, the static capability
  catalogue, is readable by `using (true)`), and `contacts` / `products` / `tax_configurations` remain
  org-wide reference data.
- Correcting those reason strings is part of acceptance criterion §14.1 (d) and must land **with** the
  decision, in one reviewed commit. It was deliberately **not** done by this brief.

## 3. Options A / B / C

Exact table list first, because it is what the decision has to name. Of the 19 construction tables:

- **4 carry a non-null `branch_id`** with an FK to `branches(id)`: `construction_procurement_sites`,
  `construction_purchase_orders`, `construction_goods_receipt_notes`, `construction_material_issues`.
- **10 inherit a non-null branch** through a **not-null** FK chain to one of those:
  `construction_purchase_order_lines`, `_purchase_order_events`, `_delivery_notes`, `_delivery_note_lines`
  (→ PO), `_goods_receipt_lines`, `_goods_receipt_holds`, `_receipt_inspections`,
  `_receipt_line_reclassifications`, `_receipt_bill_allocations`, `_receipt_cost_bases` (→ GRN).
- **1 is conditional, not unconditional:** `construction_supplier_invoice_references` inherits
  `expenses.branch_id`, which is **nullable**. It is the one construction table whose branch can be
  absent, so it needs a stated rule rather than a plain predicate: the referenced bill must belong to the
  same business; a bill with a branch follows `can_access_branch`; a bill with **no** branch is
  business-level and stays readable by any active member of that business.
- **4 have no branch dimension at all** and cannot be branch-scoped without inventing semantics:
  `construction_procurement_capabilities`, `construction_procurement_grants`,
  `construction_product_uom_conversions`, `construction_receipt_posting_policies`.

So the approved split is **14 unconditional + 1 conditional + 4 branchless = 19**, not 15 + 4: an earlier
draft of this brief counted `_supplier_invoice_references` among the unconditional tables, which would have
given it the plain predicate and silently hidden every reference whose parent bill has no branch.

**A useful consequence:** the NULL-branch-**row** contract that §14.1 cites as the obstacle to reshaping
(core rows may have `branch_id = null`; `can_access_location(null)` is `false` by design) **does not arise
for construction documents** — all 14 unconditionally branch-linked tables are reachable from a `not null`
branch key. That removes the main stated objection to option B *for this family*. The obstacle does still
arise, once, for the 15th branch-linked table: `construction_supplier_invoice_references` hangs off
`expenses.branch_id`, which is nullable, which is exactly why that table is classified **conditional** in §3
and carries a stated rule instead of a plain predicate.

### Option A — keep the current scope (status quo)

| | |
| --- | --- |
| **Changing** | Nothing. The 18 construction tables whose policy is `is_business_member(business_id)` keep it, including the 14 unconditionally branch-linked ones and the conditional supplier-reference table; the 4 dimension-less tables likewise. |
| **Security** | An A1-only member reads every branch's construction documents: POs, lines, delivery notes, GRNs, holds, inspections, reclassifications, bill allocations, cost bases, supplier invoice references, sites, material issues — including supplier names, quantities and prices. Measured, §1. Capability grants still gate every *command*. |
| **UX** | No cross-branch surprises; construction list/report screens keep working business-wide. The defect it leaves is that the UI offers actions the server refuses: an A1 user can open an A2 purchase order and every action button on it fails with `You do not have access to that branch.` |
| **Migration** | None. Zero regression surface. |
| **Tests** | The eight `BRANCH.*` rows stay BLOCKED. They must additionally be **re-scoped in writing** to state that construction reads are organisation-wide *by decision*, otherwise the rows assert something nobody claims. No new verification is possible for them. |
| **Verdict** | Cheapest and honest only if the answer to §1 is genuinely "yes, cross-branch construction visibility is intended". It cannot be verified, only waived. |

### Option B — extend branch scope to the core construction reads

| | |
| --- | --- |
| **Changing** | One RLS migration replacing the `<table>_member_read` policies with `is_business_member(business_id) and can_access_branch(business_id, <branch>)` on the 14 unconditionally branch-linked tables, using the existing `security definer` predicates — plus the stated parent-bill rule for the conditional supplier-reference table. `can_access_location` was considered where a row's location is the natural key and rejected: the branch is the FK that commands already enforce. |
| **Security** | Read surface matches command surface: an A1-only user sees A1 construction documents only; owner/admin/manager/accountant/auditor (DEC-03 org-wide roles) keep the full view. Closes the measured escape path. No NULL-row contract needed for construction (above). Must be reviewed as a security change; direct-DML probes must be re-run because the append-only triggers key on `ledgr.construction_command` and do not by themselves constrain reads. |
| **UX** | An A1-only user's construction screens become branch-local. Cross-branch construction reporting/aggregation requires an explicitly all-branch role, or a deliberate aggregate surface. This is the item the product owner must accept. |
| **Migration** | One migration, mechanical: the P5-D reshape is the working precedent (`20261007000000`, 23 tables). Residual risk is the read RPCs (`_open_items`, `_project_material_cost`, `_capabilities_for`) which would still span branches unless separately decided. |
| **Tests** | Re-run the 17 `CP.*` rows and add read-boundary rows for the 14 unconditional tables plus the conditional one (NULL parent, allowed branch, denied branch, cross-business); update the eight `BRANCH.*` expectations in the same commit (§14.1 (d)); re-run the invoices-style control to prove denial is detectable. Highest test cost of the three, but the only option that makes `BRANCH.*` provable rather than waived. |
| **Verdict** | Most faithful to the row text; largest blast radius, because it changes what every construction screen shows. |

### Option C — hybrid, decided table by table

| | |
| --- | --- |
| **Changing** | B's scope on the 14 unconditionally branch-linked tables, the stated parent-bill rule on the 1 conditional table, and the 4 dimension-less tables **explicitly recorded as deliberately org-wide** in the decision text. Add the branch predicate to the two aggregating read RPCs, decided at the same time. |
| **Security** | Same as B for documents. The 4 exclusions are forced by the schema, not chosen: a capability grant, a UOM conversion and a posting policy are properties of the business, and hiding them per-branch would break master-data administration without protecting anything (the RPCs already require business membership and owner/admin for grants). |
| **UX** | Same as B for documents; master-data and setup screens stay business-wide, which is what makes them usable. |
| **Migration** | B's migration, plus a documented exclusion list. |
| **Tests** | B's tests, plus an explicit assertion that the 4 excluded tables remain readable business-wide (so a future reader cannot mistake the exclusion for an oversight). |
| **Verdict** | B's intent with the ambiguity removed. The "table by table" discipline is what §14.1 (b) demands anyway. |

**Recommendation: option C** — branch-scope the 14 unconditionally branch-linked construction tables, give
the conditional supplier-reference table its stated parent-bill rule, record the 4 dimension-less tables as
deliberately org-wide, and decide the read RPCs in the same decision.
Reasons: (i) the command surface already refuses A2, so the current read scope is the inconsistency, not
the baseline; (ii) `can_access_branch` is already the authoritative predicate and the `not null` branch
keys remove the obstacle §14.1 cites for the core family; (iii) it is the only option under which the eight
`BRANCH.*` rows become provable instead of waived; (iv) the P5-D reshape is a working precedent for the
mechanics. This is a **recommendation only** — no policy was changed.

## 4. The decision this needs (nothing here is authorised)

| # | Decision | Owner (role) |
| --- | --- | --- |
| **D-1** | Choose A, B or C. If C/B: approve the migration that replaces the 18 construction `_member_read` policies with branch-scoped equivalents, and record the exact 14 + 1 + 4 table split as shown in §3. If A: approve the written statement that cross-branch construction reads are intended, and re-scope the eight `BRANCH.*` rows accordingly. | **Product owner** decides; **security owner** confirms the RLS consequence; **engineering owner** implements and updates the row expectations in the same commit |
| **D-2** | Whether the three read RPCs (`construction_procurement_open_items`, `construction_project_material_cost`, `construction_procurement_capabilities_for`) gain a branch filter, and which role may see cross-branch construction aggregation. | **Product owner** + **security owner** |
| **D-3** | Whether `construction_procurement_capabilities` staying readable by *any* signed-in caller (`using (true)`) is intended in the deployed profile. | **Security owner** |
| **D-4** | Approval to correct the stale `BRANCH.*` reason strings to the measured 23/37 census (§2). Documentation-only, but it belongs in the same commit as D-1 per §14.1 (d). | **Engineering owner** |

**Disposition:** no D-1…D-4 answer exists in this repository, so per the standing instruction the work
**stops here**: no security policy or database behaviour was modified, and the eight `BRANCH.*` rows remain
not verified.

## 5. Isolated deployed (Group B) verification — setup checklist

Everything below is *preparation*. None of it has been executed; no deployed project exists yet.

### 5.1 Environment prerequisites (approval gates, in order)

1. **Written approval** to create one **disposable** Supabase project. Not production, not a shared/staging
   project holding any customer data, and not the project the product uses.
2. **Recorded owner** for that project (the security owner) and an explicit statement of what may be applied
   to it: the migration chain, nothing else. No manual grant edits — a manual edit would destroy the point
   of capturing the deployed default-privilege profile.
3. **Credentials/roles required** (supplied through the environment, never committed and never pasted into
   chat or a document): a project owner/maintainer CLI role for `supabase link`/`migration list`, a
   read-only catalog role (or the owner-supplied ACL snapshot) for the ACL capture, and a service-role key
   used **only** server-side by the harness runner. Production keys are out of scope.
4. **Migration state to prove:** `supabase migration list --linked` captured before and after;
   the applied set must equal `supabase/migrations/*.sql` in order, with the two documented platform
   substitutions visible (`pg_cron`/`pg_net` extension installs) rather than silent.
5. **Default-privilege capture** (`ALTER DEFAULT PRIVILEGES`, `pg_class.relacl` defaults, any
   platform-created grants) — this is exactly what the local `databaseProfile: "migration-only public
   grants"` profile lacks, and it is why the deployed profile is not derivable from the repository.

### 5.2 Test identities (real Supabase Auth users — not synthetic claims)

| Identity | Purpose |
| --- | --- |
| business A owner | org-wide positive control; grantor for capabilities |
| business A `branch_manager` assigned to **A1** | the subject of every branch probe |
| business A `branch_manager`/`cashier` assigned to **A2** | symmetry check |
| business A viewer (no procurement capability) | capability denial |
| business A auditor | read-only org-wide role (DEC-03) |
| business B owner | cross-tenant boundary |
| `anon` (no token) | unauthenticated denial |

Capability grants must be issued **through the deployed RPC** by the owner/admin identity, so the deployed
grant path is exercised rather than seeded with SQL.

### 5.3 Evidence outputs to produce

1. A JSON evidence file mirroring the harness schema, with `environment: "isolated"`,
   `productionVerified: false`, and `databaseProfile` set to the **captured** profile string.
2. The **ACL snapshot**: `pg_policies` (per table), `has_table_privilege('authenticated', …, 'SELECT|INSERT|UPDATE|DELETE')`
   and `has_function_privilege('authenticated', oid, 'EXECUTE')` for the 23 commands, plus storage-object
   policy definitions.
3. An **ACL diff** against the migration-only profile, with every difference listed and explained.
4. Per-row probe outcomes, each carrying the raw SQLSTATE and message for a denial.
5. A **connectivity canary** record for the run (see §5.4).

### 5.4 Telling a denied operation apart from a broken run — mandatory method

Every "denied" result must be accompanied by all four of:

- **a)** a **connectivity canary** on the same client and the same PostgREST path that must **succeed**
  (`select 1 as canary`, plus one entitled read as the probe identity);
- **b)** a **positive control**: the same identity, same table/RPC, same connection, reading a row it *is*
  entitled to — must succeed;
- **c)** the **ground-truth** row existence from the service role (so a zero means "denied", not "absent");
- **d)** the denial's exact SQLSTATE/message (`42501` policy/privilege vs a connection or setup error).

A probe whose canary or positive control fails is reported **BLOCKED (environment)** and never PASS.
No `BLOCKED` row may be flipped to PASS on embedded-PostgreSQL or synthetic-JWT evidence, and no deployed
ACL value may be assumed from the repository.

### 5.5 Intended sequence

create disposable project → apply the migration chain → capture `migration list` → capture the ACL snapshot
→ create the Auth users, memberships and branch assignments → grant capabilities through the deployed RPC →
capture default privileges → run the probe set (§6) → produce the ACL diff and evidence JSON → tear the
project down, or record why it is retained.

## 6. Construction-specific acceptance evidence for Group B

| # | Required evidence | Source of the expectation |
| --- | --- | --- |
| 1 | The 23 commands' EXECUTE grants for `authenticated`, and `anon` absent, captured from the deployed catalog | §15.3 (i) |
| 2 | The 19 construction tables' DML grants captured, consistent with the append-only design | §15.3 (i) |
| 3 | `CP.CAPABILITY.EXPLICIT-GRANTS` re-run **through PostgREST with real Supabase Auth tokens** | §15.3 (ii) |
| 4 | `CP.SCOPE.TENANT-BRANCH-FORGERY` re-run the same way | §15.3 (ii) |
| 5 | **Capability denial** deployed: no grant / wrong grant / role name alone / `anon` → 42501 | §15.1, §6 row 1 |
| 6 | **Four-eyes**: a PO's creator cannot authorise their own PO by any path | §15.1 |
| 7 | **Branch boundary on commands**: create-PO against a foreign-branch site; authorise an A2 PO from A1 | §1 |
| 8 | **Branch boundary on reads** — table by table, per the approved D-1 option: for each of the 14 unconditional tables and, on the separate rule, the 1 conditional table, the A1-only user's visible-row count against a ground-truthed A2 row; the 4 branchless tables asserted to stay readable | new, decision-dependent |
| 9 | **Business boundary**: cross-tenant identifiers refused on commands and invisible on reads | §15.1 |
| 10 | **Replay safety**: same `client_key` → same document, no duplicate; two concurrent connections | §15.1 |
| 11 | `construction_procurement_capabilities` readable by any signed-in caller — recorded as intended or not (D-3) | §3, D-3 |
| 12 | The three read RPCs' deployed branch behaviour, per D-2 | §1, D-2 |

Until every row above is captured against the disposable project, **all construction rows remain local
isolated evidence** and the `BRANCH.*` rows remain BLOCKED.

## 7. Remaining blockers, with owners

| Blocker | Owner (role) | Blocks |
| --- | --- | --- |
| D-1 branch-scope option (A/B/C) not chosen | Product owner (decides), security owner (RLS consequence), engineering owner (implements) | 8 × `BRANCH.*`; construction read expectations |
| D-2 branch filter for the three read RPCs, and cross-branch aggregation access | Product owner + security owner | §6 rows 8, 12 |
| D-3 `construction_procurement_capabilities using (true)` | Security owner | §6 row 11 |
| D-4 stale `BRANCH.*` reason strings vs the measured 23/37 census | Engineering owner | §6 rows 8–9; claim accuracy of the audit strings |
| E-1 disposable-project approval and credentials | Environment/security owner | all of Group B |
| E-2 deployed ACL capture mechanism (read-only catalog role vs owner-supplied snapshot) | Environment owner | §5.3 items 2–3 |
| F-1 Harness support for an `isolated` evidence environment, the canary requirement and the Group B row set | Engineering owner | producing §5.3 evidence without hand-run SQL |
| F-2 57 BLOCKED rows including the 12 Group B rows (`HARNESS`-level: release suite exits 2 while BLOCKED > 0) | Engineering + environment owners | deployment gate |

## 8. What this brief changed

**Files:** documentation only — this file, plus a cross-reference appended to readiness §16 and matrix
§7.9. **No** migration, **no** policy, **no** grant, **no** schema, **no** command, **no** UI and **no**
harness expectation was changed.

**Database objects:** none. The only database touched was the ephemeral embedded PostgreSQL the R13 harness
itself creates and destroys (local, `assertLocalOnly`, non-root, temp directory). No deployed, shared or
production database was contacted, and no migration was applied anywhere.

**Temporary probe:** the measurement in §1 was taken by a throwaway release-suite file
(`tests/release/zz-branch-scope-probe.test.ts`), run through the R13 harness as `authenticated` so RLS
genuinely applied, with every probe rolled back. It was **deleted after the measurement** so that no
release row, gate count or BLOCKED/PASS expectation changed. Its raw output is preserved at
`.cache/branch-scope-measurement.txt`; the census at `.cache/branch-scope-census.txt`.
(The first probe attempt ran as the superuser role and therefore bypassed RLS, reporting every A2 row as
visible in *all* families; it was discarded, and the corrected run adds the `invoices` control that proves
the method can detect a real denial.)

---

## 9. Phase 3 assessment — verified post-remediation state (2026-10-16)

Stage A (`545e3e1`) implemented option C. This section records the independent Phase 3 re-verification of the
read surface at HEAD `92f64fa`, so that the "before" measurement in §1 and in matrix §7.9 cannot be mistaken
for current behaviour. Full method, per-object inventory and evidence are in
`docs/audits/LEDGR_CONSTRUCTION_READ_SECURITY_PHASE3_2026-10-16.md`.

**Verified from the replayed catalog, not from migration text:**

- **19/19 construction tables**: RLS enabled, exactly one SELECT policy each, `authenticated = SELECT` only,
  `anon` = no grant anywhere, and no INSERT/UPDATE/DELETE grant on any of them.
- **14 branch-predicated** (4 direct `branch_id` + 10 inherited through a NOT NULL FK chain) — every predicate
  carries `can_access_branch`; the two-hop tables reach the branch through GRN lines → GRNs.
- **1 conditional** (`construction_supplier_invoice_references`) through
  `construction_supplier_reference_visible(business_id, expense_id)`.
- **4 business-level** by design: the global capability catalogue (`code`, `description`; no `business_id`),
  the grant register (now own-rows-or-`can_admin_business_data`), UOM conversions and the posting policy.
- **The three read RPCs** (all `SECURITY DEFINER`, `STABLE`, `search_path=public`, signature preserved,
  `authenticated` + `service_role`): `construction_project_material_cost` applies membership +
  `can_access_branch` **before** its aggregates; `construction_procurement_open_items` branch-filters all five
  branch-bearing subqueries and applies the NULL-branch rule to `blocked_bills`; and
  `construction_procurement_capabilities_for` returns **only the caller's own** live grants (a member with no
  grants receives an empty array). The three functions therefore answer the §1 question — "may a user assigned
  only to branch A1 read branch A2's construction purchase orders?" — with **no**.
- **No alternate read path**: no view or materialised view references a construction table; no non-construction
  table holds an FK into one; every `_ledgr_construction_*` helper is ungranted to `anon`/`authenticated`;
  every SECURITY DEFINER function touching construction data pins `search_path`; every FK parent has RLS
  enabled; the ledgers (`stock_movements`, `inventory_balances`) and `expenses`/`expense_lines` carry no grant
  for `authenticated`.
- **Suites re-run at this HEAD**: `construction-branch-scope` **12/12** and `construction-procurement`
  **17/17**.

**Residual findings (both non-branch, both for the owner):** (R1) `open_items.grants_in_force` reports a
business-wide count of live capability grants to any member, while the table policy is self-or-admin — keep and
document it as a business-level control rollup, or scope it to the caller's own grants unless
`can_admin_business_data`; (R2) a supplier bill with a NULL `expenses.branch_id` is business-readable by the
approved conditional rule, so construction supplier bills should carry a branch as an operating practice.

**Gates:** (G-1) accept this assessment and record that the remediation is already implemented — **no new
migration**, since a second branch-scope migration would duplicate `20261023000000_*`; (G-2/G-3) the two
residual decisions; (G-4) add a multi-branch and an A2-only identity to the local suite; (G-5) deployed
verification in an **isolated** Supabase environment following §5.4's mandatory method (never production);
(G-6) move the eight `BRANCH.*` rows off BLOCKED only once G-5 has produced its evidence.

**Nothing was changed by this section** other than documentation: no migration, policy, grant, schema object,
command, RPC, test expectation or configuration. No database object was created or altered outside the
ephemeral replay, and no deployed, shared or production database was contacted. `productionVerified` remains
**false**.
