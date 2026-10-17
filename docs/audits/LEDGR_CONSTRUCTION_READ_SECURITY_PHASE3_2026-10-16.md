# Construction read security — Phase 3 assessment and remediation plan

**Date:** 2026-10-16 · **Branch:** `arena/2faa03b4-ledgr-react` · **HEAD:** `92f64fa` · **Status:** assessment
complete. **No code, migration or schema change was made, and none is proposed for immediate execution
without the approval gates in §7.**

**Baseline reviewed:** `CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md` (the supplied "decision matrix"),
specifically its §7.9 "Measured behaviour of the read surface" table and the §15–16 readiness text it
references.

**Headline result.** The branch-scope gap the matrix reports **is closed at this HEAD**, and the matrix row
that reports it (`construction_procurement_open_items`, `_capabilities_for`, `construction_project_material_cost`
| "ALLOWED — `security definer`, business-membership gate only, no branch predicate") is a **pre-remediation
measurement**, not current state. Two of those three functions now filter by branch; the third returns only
the caller's own grants. This assessment verifies that from the replayed catalog and by running the committed
suites, and it records the two residual findings that remain (§6). It also states what is still unproven:
**nothing here verifies official Supabase or deployed behaviour** (§8).

**Evidence class.** Local isolated only — embedded PostgreSQL replayed through the R13 harness
(`LEDGR_TEST_ENV=local`, `assertLocalOnly`), synthetic JWT claims, every probe rolled back. No production or
shared/staging database was contacted; no migration was applied anywhere; no commit, push, merge or deploy was
performed.

---

## 1. Repository state (step 1)

| Check | Result |
| --- | --- |
| Branch | `arena/2faa03b4-ledgr-react` |
| HEAD | `92f64fa` (`92f64fa3bdcd31b5a598a773128cd70527aee3fd`) — the pushed Stage B tip |
| Upstream | `origin/arena/2faa03b4-ledgr-react` at the same commit (0 ahead / 0 behind) |
| Working tree | one modified file — the Stage C design document `CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md`, uncommitted local work, **preserved untouched** |
| Stage A / Stage B present | yes — `545e3e1` (branch-scope migration + suite + docs), `b077e37` (report finalisation), `92f64fa` (Stage B) |
| Decision-matrix changes present | yes — the matrix was last written by `545e3e1`, i.e. the version in this tree already carries the Stage A classification correction (14 unconditional + 1 conditional + 4 branchless) |
| `git reset` / `checkout` / `clean` used | **no** — nothing was discarded or rewritten |
| PR #210 | untouched and unmerged (not queried for state in this stage; no operation attempted) |

**Is the supplied matrix accurate about HEAD? Partly.** Its *table classification* is current (it was corrected
in Stage A). Its *measured read-surface table* is not: it is the pre-Stage-A "before" measurement
(`docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md:546-558`), and nothing in it says so.
Read as current state it states the opposite of what the database now enforces. §7 proposes the one-line
documentary correction that prevents that misreading; the substantive fix already shipped in Stage A.

---

## 2. Read-exposure inventory (step 2)

Verified from the **replayed** catalog — `pg_class`, `pg_policies`, `aclexplode(...)`, `pg_proc.prosecdef`,
`pg_proc.proconfig`, `pg_get_functiondef`, `pg_depend`/`pg_rewrite` — not from migration text.

### 2.1 The 19 construction tables

Every table has **RLS enabled**, **exactly one SELECT policy**, and **`authenticated = SELECT` only** (`anon`
holds **no** grant on any of the 19; no INSERT/UPDATE/DELETE grant exists on any of them, so direct DML is
refused regardless of policy).

| # | Table | Exposure path | Branch derivation | Policy predicate (verified `qual`) | Sensitive content reachable |
| --- | --- | --- | --- | --- | --- |
| 1 | `construction_procurement_sites` | direct table read; RPC-free | direct `branch_id` NOT NULL | `is_business_member(business_id) AND can_access_branch(business_id, branch_id)` | site code/name, `project_ref`, location mapping |
| 2 | `construction_purchase_orders` | direct read | direct `branch_id` NOT NULL | same | PO numbers, supplier link, totals, project ref |
| 3 | `construction_goods_receipt_notes` | direct read | direct `branch_id` NOT NULL | same | GRN evidence, receipt dates, quantities |
| 4 | `construction_material_issues` | direct read + `construction_project_material_cost` | direct `branch_id` NOT NULL | same | issued quantities, unit/total cost, currency, `issued_to`, evidence ref |
| 5 | `construction_purchase_order_lines` | direct read | inherit → PO | `… AND EXISTS (SELECT 1 FROM construction_purchase_orders p WHERE p.id = …po_id AND p.business_id = … AND can_access_branch(p.business_id, p.branch_id))` | line prices, quantities, UOM, products |
| 6 | `construction_purchase_order_events` | direct read | inherit → PO | as row 5 | approval/authorship trail |
| 7 | `construction_delivery_notes` | direct read | inherit → PO | as row 5 | delivery evidence, quantities |
| 8 | `construction_delivery_note_lines` | direct read | inherit → PO **via** `delivery_notes` | `EXISTS (… construction_delivery_notes d JOIN construction_purchase_orders p …)` + `can_access_branch(p…)` | delivered quantities/details |
| 9 | `construction_goods_receipt_lines` | direct read | inherit → GRN | `EXISTS (SELECT 1 FROM construction_goods_receipt_notes g WHERE g.id = …grn_id AND g.business_id = … AND can_access_branch(g.business_id, g.branch_id))` | accepted/rejected/quarantined quantities, cost basis link |
| 10 | `construction_goods_receipt_holds` | direct read + `open_items.open_holds` | inherit → GRN line → GRN | `EXISTS (… goods_receipt_lines l JOIN goods_receipt_notes g …)` + `can_access_branch(g…)` | hold reason, evidence reference, quantities |
| 11 | `construction_receipt_inspections` | direct read | inherit → GRN line → GRN | as row 10 | inspection method, certificate reference, outcome |
| 12 | `construction_receipt_line_reclassifications` | direct read | inherit → GRN line → GRN | as row 10 | release reasons and evidence |
| 13 | `construction_receipt_bill_allocations` | direct read | inherit → GRN line → GRN | as row 10 | bill↔receipt matching, allocated quantities |
| 14 | `construction_receipt_cost_bases` | direct read + `open_items.awaiting_cost_basis` | inherit → GRN line → GRN | as row 10 | **unit costs, discounts, tax, FX rate** |
| 15 | `construction_supplier_invoice_references` | direct read | **conditional** → `expenses.branch_id` (NULLABLE) | `is_business_member(business_id) AND construction_supplier_reference_visible(business_id, expense_id)` | supplier invoice references, supplier identity |
| 16 | `construction_procurement_capabilities` | direct read | **none — global catalogue** | `true` | 11 codes + descriptions; **no `business_id` column at all** (verified: columns are `code`, `description`; 11 rows) |
| 17 | `construction_procurement_grants` | direct read (RPC `capabilities_for` is the UI path) | **none — business-level** | `is_business_member(business_id) AND (user_id = auth.uid() OR can_admin_business_data(business_id))` | who holds which capability (now own-rows-or-admin) |
| 18 | `construction_product_uom_conversions` | direct read | **none — business master data** | `is_business_member(business_id)` | product conversion factors |
| 19 | `construction_receipt_posting_policies` | direct read + `open_items` flags | **none — business policy** | `is_business_member(business_id)` | whether receipt posting is enabled, who approved it |

**Rows 1–14 are the 14 unconditional branch-bearing tables**; row 15 is the one conditional table; rows
16–19 are the four business-level tables. This matches the corrected classification exactly.

**Why the four business-level objects are deliberately *not* narrowed** (the instruction not to narrow
business-wide reference/control data indiscriminately):

- **Row 16 — the capability catalogue** is *not tenant data*: it has no `business_id`, holds the fixed set of
  11 procurement capabilities, and is identical for every tenant. Restricting it would break the
  capability-administration screen (which must explain what each capability means) while protecting nothing.
- **Row 17 — the grant register** is business-staffing control data, not operations data. It *was* narrowed in
  Stage A from "any member sees every grant row" to **own rows or `can_admin_business_data`**, because who
  can act is administration information. The capability-administration workflow still works: the UI reads
  capabilities through `construction_procurement_capabilities_for` (the caller's own set), and the admin
  screen's grant/revoke goes through `grant_construction_procurement_capability` /
  `revoke_construction_procurement_capability`, which authorise server-side.
- **Row 18 — UOM conversions** are business master data (a product's carton→bag factor is the same in every
  branch); branch-scoping them would make procurement unusable without hiding anything.
- **Row 19 — the posting policy** is a per-business switch with an approval trail; it has no branch dimension,
  and `open_items` reports its flags to members deliberately (a member needs to know whether receipt posting
  is enabled at all).

### 2.2 Alternate read paths — searched and cleared

| Candidate alternate path | Verification | Result |
| --- | --- | --- |
| Views / materialised views over construction tables | `pg_depend` + `pg_rewrite` scan (would matter because a view created without `security_invoker` runs as its owner and bypasses underlying RLS) | **none exist** |
| Other tables referencing construction rows (denormalised copies) | reverse-FK scan: non-construction tables with an FK **into** a construction table | **none** |
| Internal helper functions callable by a client | `aclexplode` on all 22 `_ledgr_construction_*` functions | **no EXECUTE grant** to `anon` or `authenticated` on any of them |
| SECURITY DEFINER functions reading construction data without a pinned `search_path` (search-path hijack) | `pg_proc.proconfig` check | **none** — all carry `search_path=public` |
| The stock ledger itself as a side channel | `aclexplode` on `stock_movements`, `inventory_balances`, `expenses`, `expense_lines` | **no grant to `anon`/`authenticated`** (only `invoices` has INSERT/SELECT, unrelated to construction) |
| FK parents as a bypass route | RLS status of every parent referenced by a construction FK (`branches`, `businesses`, `contacts`, `products`, `inventory_locations`, `expenses`, `expense_lines`, `stock_movements`, `currencies`, plus construction parents) | **RLS enabled on all** |
| `anon` | whole-schema grant check on the 19 tables and 3 RPCs | **zero** grants |

### 2.3 Consumers (which UI/repository path uses each surface)

Verified in Stage A/Phase 1 and unchanged: the construction workspace reads through
`src/dal/repositories/ConstructionProcurementRepository.ts` (sites, POs, GRNs, issues, holds, inspections…),
`ConstructionOverviewSection` renders `construction_procurement_open_items`, the material-issues and
receipts sections read their registers directly, and capability checks go through the
`construction_procurement_capabilities_for` RPC (`ConstructionProcurementRepository.ts:635`). Because these
are ordinary PostgREST table reads and RPC calls, they are subject to exactly the policies and grants above —
there is no client-side bypass, and no `src/` code reads `construction_procurement_grants` directly.

---

## 3. Assessment of the three reported RPCs (step 3)

All three are `SECURITY DEFINER`, `STABLE`, `SET search_path TO 'public'`, argument list `(p_business_id uuid)`,
granted to `authenticated` and `service_role` (and the owner). Signatures are unchanged from the original
release — the Stage A migration re-created two of them with `create or replace`.

### 3.1 `construction_project_material_cost(uuid)` — **branch-filtered; correct as a business-wide *shape* with branch-scoped *content***

Persisted body (verified): membership gate (`42501` for a non-member), then

```
select i.project_ref, count(*), sum(i.quantity_base), sum(i.total_cost_base), min(i.currency),
       min(i.issue_date), max(i.issue_date)
  from public.construction_material_issues i
 where i.business_id = p_business_id
   and public.can_access_branch(i.business_id, i.branch_id)
 group by i.project_ref
```

- **Should it return business-wide data?** No — and it does not. The **aggregates are computed after the
  branch predicate**, so `material_cost`/`quantity_base` for a project can only include issues from branches
  the caller can reach.
- **Counts/totals leakage:** none from this function. An A1-only caller cannot see the existence of an
  A2-only project at all, because a project ref that has only A2 issues produces no group.
- **Signature:** preserved; the branch filter is internal, so an all-branch role (owner/admin/manager/
  accountant/auditor per DEC-03) still aggregates the whole business without passing a parameter. Nothing
  needs to change.
- **Dynamic confirmation:** `CPB.RPC.PROJECT-MATERIAL-COST` — A1-only sees `CPB-PROJECT-A1` and **not**
  `CPB-PROJECT-A2`; the owner sees both; a foreign-business owner gets `42501`.

### 3.2 `construction_procurement_open_items(uuid)` — **branch-filtered; one residual count finding**

Persisted body (verified): membership gate, then a JSON object with these fields:

| Field | Branch handling (verified) | Verdict |
| --- | --- | --- |
| `movement_posting_enabled`, `gl_posting_enabled` | read from `construction_receipt_posting_policies` for the business; `gl_posting_enabled` hard-coded `false` | business-level control flag — intended, no branch data |
| `grants_in_force` | `select count(*) … where g.business_id = p_business_id and g.revoked_at is null` | **residual finding R1 (§6)** — business-wide count, not branch-restricted |
| `awaiting_cost_basis` | `… and can_access_branch(g.business_id, g.branch_id)` on the GRN | filtered ✓ |
| `awaiting_posting` | same branch predicate | filtered ✓ |
| `open_holds` | branch predicate through GRN lines → GRNs | filtered ✓ |
| `outstanding_supplier_claims` | branch predicate through GRN lines; includes supplier name | filtered ✓ |
| `blocked_bills` | `e.branch_id is null or can_access_branch(e.business_id, e.branch_id)` | filtered ✓ per the approved NULL-branch rule — **see finding R2** |

- **Should it return business-wide data?** No; it reports operational open items, and every open item it
  reports is now branch-filtered.
- **Counts/totals leakage:** the *arrays* are branch-filtered, so their lengths differ correctly between an
  A1-only user and the owner (`CPB.RPC.OPEN-ITEMS` asserts 1 hold / 1 claim versus 2 / 2), i.e. the count
  itself cannot be used to infer restricted-branch activity. The one business-wide number is `grants_in_force`
  (R1), which is staffing data with no branch dimension.
- **Error differences:** the failure mode is uniform — a non-member of the business gets `42501` regardless of
  which branches exist, so the error reveals nothing about branch existence or data volume.
- **How branch filtering was applied without breaking workflows:** the filter is internal and uses the row's
  own derived branch, so the screen keeps working for an all-branch role while a branch-scoped user's
  overview simply narrows. No parameter was added, so no caller changed.

### 3.3 `construction_procurement_capabilities_for(uuid)` — **caller-scoped; correct as a business-wide control surface**

Persisted body (verified): requires `auth.uid()` (`42501` if anonymous), requires business membership
(`42501` otherwise), then returns `array_agg(g.capability … where g.business_id = p_business_id and g.user_id
= v_user and g.revoked_at is null)`.

- **What it returns:** the **caller's own** live capabilities — an array of capability codes. It does *not*
  return the catalogue, another member's grants, or any operational or branch data.
- **Should it be branch-filtered?** It has nothing to filter: capability grants are business-level by design
  (there is no branch column on `construction_procurement_grants`), and a capability must apply across the
  branches the holder is assigned to. Branch authority is enforced separately by `can_access_branch` inside
  the commands.
- **Leakage:** none of branch data. Dynamic proof that it is caller-scoped rather than business-scoped: a
  member with no grants receives `[]` while a fully-granted member receives all 11 codes
  (`CPB.RPC.CAPABILITIES-FOR`), and a foreign-business owner receives `42501`.
- **"Do not assume a capability function is safe because of its name":** checked rather than assumed — the
  function's *table* input (`construction_procurement_grants`) is now own-rows-or-admin, and the function
  itself cannot be used to enumerate other users' holdings.

### 3.4 The SIR helper — an intended, narrow oracle

`construction_supplier_reference_visible(business_id, expense_id)` is `SECURITY DEFINER` and **is** granted to
`authenticated` (necessarily — a row-level policy is evaluated with the invoking role's privileges, so the
predicate needs an invokable helper). Assessed as a disclosure oracle: it returns `true` only when the expense
belongs to that business **and** either the parent bill has no branch (business-level) **or** the caller can
access its branch. Probing an arbitrary id therefore distinguishes "readable by me" from "not readable by me";
it does **not** distinguish "exists but restricted" from "does not exist", and it returns `false` (not an error)
for a business the caller is not a member of — so it leaks no existence, no counterparty and no amount. Verdict:
acceptable; documented rather than changed.

---

## 4. Remediation status: already implemented, no new migration needed

The instruction to "use the existing branch-scope migration and test suite as the starting point" is satisfied
by the current state: the remediation **is** `supabase/migrations/20261023000000_construction_branch_scope.sql`
(commit `545e3e1`), which:

- replaced the four direct-table and ten inherited-table SELECT policies with
  `is_business_member(business_id) AND can_access_branch(...)`;
- established the **conditional** rule for `construction_supplier_invoice_references` through the new
  `SECURITY DEFINER` helper (same-business parent required, NULL-branch parent business-level, branched parent
  follows `can_access_branch`);
- narrowed `construction_procurement_grants` to own-rows-or-`can_admin_business_data` and left the capability
  catalogue readable by design;
- re-created the two aggregating RPCs with internal branch filters **and preserved their signatures**;
- added a self-verification block so the migration fails if the expected predicates are missing.

**A new branch-scope migration would be a duplicate and is explicitly not proposed.** The only remediation
items left are the two residual findings below and the documentary correction.

---

## 5. Required tests (already present) and what they prove

Run at this HEAD (local isolated, `R13_EVIDENCE_DIR` owned, every probe rolled back):

| Suite | Rows | Result | What it establishes for this assessment |
| --- | --- | --- | --- |
| `tests/release/construction-branch-scope.test.ts` | 12 `CPB.*` | **12 passed / 0 failed** | Per-table branch reads with positive controls and ground truth; inherited-table boundaries; NULL-branch parent allowed, branched parent denied, cross-business denied; the three RPCs' scoping (including the A1-only vs owner **count** comparison in `CPB.RPC.OPEN-ITEMS`); grant visibility; catalogue readability; business switching; command-only writes |
| `tests/release/construction-procurement.test.ts` | 17 `CP.*` | **17 passed / 0 failed** | The remediation did not break the legitimate workflows: policy gate, site scope, UOM conversion, open period, stock availability, cost basis, four-eyes PO authorisation, idempotency and concurrency, and the accounting refusals (`accepted-release-unsupported`, `rejected-release-unsupported`, GL disabled) |

Coverage against the roles the task names, as mapped to the existing rows (no new test file is required to
close this assessment; the gaps listed are the ones deployment must cover):

| Role scenario | Covered locally? | Where |
| --- | --- | --- |
| A1-only branch manager (positive in own branch, denied A2) | yes | `CPB.DIRECT.BRANCH-READ`, `CPB.INHERITED.BRANCH-READ`, `CPB.SIR.*` |
| Owner / all-branch (business-wide aggregate, both projects/claims visible) | yes | `CPB.RPC.PROJECT-MATERIAL-COST`, `CPB.RPC.OPEN-ITEMS` |
| Member with no capabilities (empty capability set) | yes | `CPB.RPC.CAPABILITIES-FOR` |
| Unrelated business (owner of business B) | yes | `CPB.SIR.CROSS-BUSINESS`, both RPC rows |
| `anon` | yes | `CPB.*` write/read denials; whole-schema grant check |
| A2-only mirror of the A1 probes | **partially** — the A1 probes prove the boundary in one direction; a symmetric A2-only identity is not present | gap for deployed verification |
| Multi-branch user (assigned to A1 **and** A2 simultaneously) | **no** | gap — recommend adding one identity locally or in the deployed run |
| Negative: restricted data via alternate paths (views, helpers, ledger) | yes, structurally | §2.2 catalog checks |

---

## 6. Residual findings (the only open items)

### R1 — `open_items.grants_in_force` is a business-wide count (low severity; decision needed)

`construction_procurement_open_items` reports the number of live capability grants for the whole business to
**any** member, while the underlying table policy is now own-rows-or-admin. It discloses staffing magnitude
(how many capability assignments exist) — **not** branch data, since grants carry no branch, and not *who*
holds them. Options, for the product owner to choose (no change is authorised now):

1. **Keep and document** it as an intentional business-level rollup of control data — defensible, since
   capability administration is a business-level function and the count protects nothing on its own.
2. **Scope it** to the caller's own grants unless `can_admin_business_data(business_id)`, matching the table
   policy. This is a one-line body change inside the already-existing function (no signature change, no new
   migration beyond a small forward migration, no policy change).

Recommendation: option 2 for consistency with the Stage A tightening, **if** the owner wants the grant surface
strictly self-visible; otherwise option 1 with the intent written down. Either way the finding should not be
left undocumented.

### R2 — NULL-branch supplier bills are business-wide by design (informational; accepted consequence)

`blocked_bills` (and the SIR policy) follow the approved conditional rule: a supplier bill whose
`expenses.branch_id` is **NULL** is treated as business-level and is readable by any member of that business,
including the `expense_number` and supplier `reference` surfaced by `blocked_bills`. This is the approved
Option C behaviour, not a defect — but it is the one place where a *financial* document becomes business-wide
on the read surface. Recommendation: require a branch when recording construction supplier bills (an
operational instruction, not a code change), and keep the rule documented so a future reader does not mistake
it for an oversight.

### R3 (documentary) — the matrix's measured-behaviour table reads as current state

`docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md:546-558` presents the pre-Stage-A
measurement (including "ALLOWED — … no branch predicate" for the three RPCs) without a "before remediation"
marker. Corrected in this stage with a pointer to §1 and §3 here, so the baseline cannot drive duplicate
remediation work.

---

## 7. Remediation plan, approval gates and deployed verification

| # | Item | Type | Gate |
| --- | --- | --- | --- |
| G-1 | Accept this assessment: the read surface is branch-scoped at `92f64fa`; **no new migration** | decision | Owner/security owner |
| G-2 | R1 — choose "keep and document" or "scope the count to own grants unless admin" | product/security decision | Owner; implementation only if option 2 is chosen |
| G-3 | R2 — adopt the operating rule that construction supplier bills carry a branch; record the NULL-branch consequence | operating decision | Owner/accountant |
| G-4 | Add a **multi-branch** identity (assigned to A1 **and** A2) and an A2-only mirror of the A1 probes to the local suite | test work | Engineering owner (small; no schema impact) |
| G-5 | **Deployed verification in an isolated Supabase environment** (never production): re-run the branch boundary for the 14+1 tables and the three RPCs with **real** Supabase Auth users and PostgREST, following the mandatory method in the decision brief §5.4 (connectivity canary + positive control + service-role ground truth + exact SQLSTATE, so a denied operation is distinguishable from a broken run) | verification | Separate approval; environment + identities required |
| G-6 | Update the eight `BRANCH.*` release rows from BLOCKED to PASS **only** after G-5 produces the evidence | evidence | Security owner |

**What G-5 must prove that local evidence cannot:** that official Supabase's PostgREST layer, its JWT claim
handling and its role/grant defaults reproduce these predicates; that `authenticated` really holds `SELECT` and
`anon` holds nothing on a live project; that the `SECURITY DEFINER` helpers resolve identically under the
hosted `search_path`; and that no platform-level grant or view re-exposes the surface.

---

## 8. Explicitly unverified

- **Official Supabase (hosted PostgREST/Auth) behaviour:** unverified. All statements above were produced in
  embedded PostgreSQL with synthetic JWT claims. `productionVerified: false` stands, and hosted role/grant
  defaults are a known divergence risk (`authenticated` has no grants on the stock ledger in the replayed
  schema; the hosted defaults must be checked, not assumed).
- **Production:** never contacted; no production or shared/staging database was read or modified.
- **Deployed policy state:** unknown — a migration in the repository is not a migration applied to any
  environment. Every deployed claim in this document is a *design intent* until G-5 runs.
- **A2-only and multi-branch identities:** not exercised locally (§5 table).
- **`service_role` and platform-admin paths:** `service_role` retains EXECUTE on the RPCs by design (operator
  path); its behaviour was not part of this assessment beyond grant enumeration.
- **The accounting constraints the matrix records:** untouched and re-verified as intact — `gl_posting_enabled`
  is still forced `false` by `CHECK`, `INV-CM-001` is still proposed, accepted-stock write-downs and supplier
  returns are still refused, and no stock valuation, cost-basis, tax, VAT or payroll behaviour was read or
  modified for anything other than the read-surface checks above.

---

## 9. Files changed by this stage

| File | Change |
| --- | --- |
| `docs/audits/LEDGR_CONSTRUCTION_READ_SECURITY_PHASE3_2026-10-16.md` | **new** — this assessment |
| `docs/architecture/CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md` | appended §9 recording the verified post-remediation state, the residual findings and the gates |
| `docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md` | one-line "before remediation — see Phase 3 §1/§3" marker on the measured-behaviour table (R3) |

**No application code, migration, policy, grant, schema object, test file or configuration was changed.** No
commit, push, merge, Vercel/Supabase deployment. The uncommitted Stage C design document was left untouched.
Probe scripts were written to the gitignored `.cache/` directory and removed after use; raw probe output is
local-and-ephemeral by design.
