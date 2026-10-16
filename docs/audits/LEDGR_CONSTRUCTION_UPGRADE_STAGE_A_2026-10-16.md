# Ledgr Construction Upgrade — Stage A report (branch-read security)

**Date:** 2026-10-16 · **Branch:** `arena/2faa03b4-ledgr-react` · **Baseline:** `8866d97` (`7dac103` ← `70089f8`)
**Authorisation:** "Ledgr Construction Upgrade — Implementation Approval"; Stage A only. Stage B is gated on
Stage A passing its local validation, which this report establishes.
**Evidence class:** **local isolated only** — embedded PostgreSQL replayed through the R13 harness
(`tests/release/database.mjs`, `LEDGR_TEST_ENV=local`, `assertLocalOnly`) with synthetic JWT claims in
`request.jwt.claims`. No production or shared/staging database was contacted, no migration was applied to any
deployed environment, no deployment or push was performed, and `productionVerified` remains **false**. Every
"denied" result below comes from `db.asRole('authenticated', <uid>, …)` — a real RLS probe — not from a
superuser read, a missing grant or a broken connection.

---

## 1. Baseline verification (rule 1)

| Check | Result |
| --- | --- |
| Branch | `arena/2faa03b4-ledgr-react` — correct session branch |
| HEAD | `8866d97` (`8866d97edea5c310aff6fee5956821a6fadfc4a6`) — matches the expected baseline |
| Ancestry | `8866d97` ← `7dac103` ← `70089f8` |
| Working tree | clean apart from the untracked Phase-1 report (no unexpected modifications, no staged work) |
| Remote | local `HEAD` == `origin/arena/2faa03b4-ledgr-react`; nothing to pull or push |

No material difference from the expected baseline was found, so implementation proceeded.

## 2. Table classification corrected everywhere (rule 2)

The Phase-1 measurement showed the decision brief's split was wrong: it counted
`construction_supplier_invoice_references` among the tables with a guaranteed branch. The FK to
`expenses.id` is `not null`, but the parent's `expenses.branch_id` is **nullable**, so that table cannot take
a bare branch predicate. The corrected classification is:

**14 unconditional + 1 conditional + 4 branchless = 19 construction tables.**

| Class | Count | Tables |
| --- | --- | --- |
| `branch_id not null` on the row | 4 | `_procurement_sites`, `_purchase_orders`, `_goods_receipt_notes`, `_material_issues` |
| Branch inherited through a **not-null** FK chain | 10 | `_purchase_order_lines`, `_purchase_order_events`, `_delivery_notes`, `_delivery_note_lines` (→ PO); `_goods_receipt_lines`, `_goods_receipt_holds`, `_receipt_inspections`, `_receipt_line_reclassifications`, `_receipt_bill_allocations`, `_receipt_cost_bases` (→ GRN) |
| **Conditional** — parent branch is nullable | 1 | `_supplier_invoice_references` (→ `expenses.branch_id`) |
| No branch dimension | 4 | `_procurement_capabilities` (global static catalogue), `_procurement_grants`, `_product_uom_conversions`, `_receipt_posting_policies` |

Documents corrected (documentation-only edits, no other content changed):

- `docs/architecture/CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md` — §2, §3 (split, options A/B/C,
  the "useful consequence" paragraph, recommendation D-1 text) and acceptance row 8.
- `docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md` — §7.9 classification table and
  its consequence paragraph.
- `docs/audits/LEDGR_PRODUCTION_READINESS_56_BLOCKED_AND_PHASE3_2026-10-16.md` — §16.2/§16.3.
- The Phase-1 report already recorded the corrected 4/10/5 census and the required reframing; it needed no edit.

## 3. Migration (rule 3)

`supabase/migrations/20261023000000_construction_branch_scope.sql` — 500 lines, forward-only, idempotent
(drops only the policies it owns, `create or replace` for functions, so ACLs are preserved), with a
self-verification `DO` block that fails the migration if any expected policy is missing or unqualified.

**Filename deviation, reported as required.** The approved filename was
`20261022000000_construction_branch_scope.sql`. That timestamp is already taken by
`20261022000000_effective_dated_tax_configurations.sql`, and the release runner sorts migrations by filename
(`tests/release/database.mjs:56`), so reusing it would have produced an ambiguous, out-of-order replay. The
migration was therefore created as **`20261023000000_construction_branch_scope.sql`** (the next free slot;
`20261023*` was unused) and nothing else was renamed or reordered.

Replay verification after the migration (`LEDGR_TEST_ENV=local`, `.cache/probe-schema-verify.mjs`):

- 19 construction tables found; **one SELECT policy each**; `authenticated` grants `[SELECT]` on all 19; `anon` grants **0**.
- Branch-predicated policies: **14** unconditional tables carry `is_business_member(business_id) and can_access_branch(business_id, <branch>)`
  (the inherited tables reach the branch through a correlated `exists (select 1 from <parent> …)` on the FK column).
- `_supplier_invoice_references` is deliberately **not** branch-predicated in the catalogue sense: its policy
  calls the `security definer` helper described in §5, so a textual "contains `can_access_branch`" check reads
  "no" while the branch rule is enforced inside the helper.
- The 4 branchless tables keep their intended intent (`capabilities` stays readable with `using (true)`).
- `create or replace` preserved the public read-RPC signatures (verified in §6).

**Baseline replay also re-confirmed:** all 23 construction commands are `security definer`, so their internal
reads bypass these policies and command behaviour cannot change from a read-policy change.

## 4. What the policies now do (rules 4, 6, 7)

| Surface | Before | After |
| --- | --- | --- |
| 4 direct tables (`_sites`, `_purchase_orders`, `_goods_receipt_notes`, `_material_issues`) | `is_business_member(business_id)` | `is_business_member(business_id) and can_access_branch(business_id, branch_id)` |
| 10 inherited tables | `is_business_member(business_id)` | business membership **and** the parent's branch through the FK (one-hop: PO children, GRN lines; two-hop: holds, inspections, reclassifications, bill allocations, cost bases via `grn_lines`→GRN; delivery-note lines via `delivery_notes`→PO) |
| `_supplier_invoice_references` | `is_business_member(business_id)` | `is_business_member(business_id) and construction_supplier_reference_visible(business_id, expense_id)` |
| `_procurement_capabilities` | `using (true)` | unchanged (`using (true)`) — static global catalogue, no `business_id` column |
| `_procurement_grants` | any business member could read every grant row | own rows (`user_id = auth.uid()`) **or** `can_admin_business_data(business_id)`; the capability-administration workflow is preserved, and the UI only ever goes through the `capabilities_for` RPC |
| `_product_uom_conversions`, `_receipt_posting_policies` | business member | business member (re-asserted, no branch predicate — they are business master data/policy) |
| 3 read RPCs (`capabilities_for`, `project_material_cost`, `open_items`) | membership only → whole business | `capabilities_for` unchanged (catalogue); `project_material_cost` and `open_items` filter every branch-bearing subquery through `can_access_branch`, and `open_items.blocked_bills` applies the conditional rule (`e.branch_id is null or can_access_branch(...)`) |

Signatures were preserved: the two aggregating RPCs filter internally on the row's own branch, so an
all-branch role (owner/admin/manager/accountant/auditor per DEC-03) still aggregates the whole business while
an assigned-scope role sees only branches it can reach. **Cross-branch aggregation therefore requires
explicit all-branch authority, and the caller cannot request it by parameter.**

## 5. Defect found and fixed during implementation (worth keeping on record)

The first version of the supplier-reference policy embedded `exists (select 1 from public.expenses …)`
inline. A policy expression is evaluated with the **invoking** role's privileges, and `authenticated` has no
`SELECT` grant on `expenses`, so every read of the table failed with a blanket `42501` — a denial caused by
a missing grant rather than by the branch rule, i.e. exactly the false-positive class the acceptance method
forbids. Fixed by adding `public.construction_supplier_reference_visible(p_business_id uuid, p_expense_id uuid)`
— `security definer`, `stable`, `set search_path = public` (the same pattern as `can_access_location`),
`revoke`d from `public, anon`, `grant`ed to `authenticated, service_role` — which returns **false** when the
parent expense is absent or belongs to another business, **true** for a NULL-branch parent inside the same
business, and otherwise `can_access_branch`. The migration's own self-verification accepts either predicate
form, so the replay is reproducible.

## 6. Tests (rule 9) and validation results

New suite `tests/release/construction-branch-scope.test.ts` — **12 rows, all PASS**:

| Row | What it proves |
| --- | --- |
| `CPB.DIRECT.BRANCH-READ` | the 4 direct tables: own branch > 0, other branch of the same business = 0, ground truth > 0 |
| `CPB.INHERITED.BRANCH-READ` | all 10 inherited tables, same three assertions each (positive control first, so a policy that hid the caller's own records would fail loudly) |
| `CPB.SIR.NULL-BRANCH-PARENT` | NULL-branch parent bill stays readable inside the business |
| `CPB.SIR.BRANCH-ALLOWED-AND-DENIED` | allowed branch = 1, denied branch = 0, ground truth = 1, and still 0 after the privileged read |
| `CPB.SIR.CROSS-BUSINESS` | another business's parent reference invisible; a privileged direct insert is `42501` |
| `CPB.RPC.PROJECT-MATERIAL-COST`, `CPB.RPC.OPEN-ITEMS` | branch-scoped RPC output vs all-branch output |
| `CPB.RPC.CAPABILITIES-FOR` | the catalogue RPC still returns the static capability list |
| `CPB.GRANTS.VISIBILITY` | a member sees only their own grant rows; owner/admin sees the business's |
| `CPB.CATALOGUE.STATIC` | the capability catalogue remains readable as intended |
| `CPB.BUSINESS.SWITCH-AND-ISOLATION` | switching business does not leak the other business's rows |
| `CPB.WRITE.COMMAND-ONLY` | no direct write path: `42501` on insert/update/delete |

Every denial is paired with a positive control on the same connection, and `truth()` restores the
**caller's** identity (an earlier "ground truth then restore" helper restored a fixed uid and silently
converted later probes into another user's reads — that produced two false failures and is fixed).

**One pre-existing test had to change, and this is not a weakening.**
`CP.SCOPE.TENANT-BRANCH-FORGERY` (`tests/release/construction-procurement.test.ts`) previously obtained an
A2 purchase-order line **as the branch-scoped clerk** in order to then prove the clerk's receipt was refused.
That read is precisely the escape path Stage A closes, so it now returns 0 rows. The line id is fetched as
the organisation-wide owner, a new assertion records that the clerk can no longer select the line at all
(`= 0`), and the original denial assertion (`42501`, `/access to that branch|access to that inventory location/`)
is unchanged. No other release suite depended on cross-branch construction reads.

| Validation | Result |
| --- | --- |
| Focused: `construction-branch-scope` | **12 passed / 0 failed** |
| Focused: `construction-procurement` | **17 passed / 0 failed** (was 1 failed before the test fix above) |
| Release suite (`npm run test:release`) | **PASS 858 · FAIL 0 · BLOCKED 57 · NOT APPLICABLE 0** (was 846/0/57/0; +12 new rows, no other change) |
| Full unit/integration (`npm test`) | **124 files passed · 1150 tests passed** |
| `npx tsc -b` | exit 0 |
| `npm run test:release:types` | exit 0 |
| `npm run lint` | **0 errors**, 4 pre-existing warnings (`src/offline/queueApi.ts` unused disable directives) |
| `npm run build` | OK — PWA precache 117 entries |
| `git diff --check` | clean |

`tests/release/gate.mjs` gained one key (`'construction-branch-scope.test.ts': 'construction-branch-scope.json'`)
so a missing artifact is reported as `HARNESS.MISSING.*`; **every existing key is retained**.

## 7. Deliberately unchanged (rule 8)

Command-side authorisation, the capability model, four-eyes PO approval, the append-only guards and
`client_key` idempotency: untouched, and structurally insulated because every construction command is
`security definer`. Table grants are unchanged (`authenticated` keeps `SELECT`; `anon` keeps nothing).
No table, column, trigger, index or data was added or altered. No VAT, tax-configuration or invoice code
was touched. Nothing was applied to a deployed database.

## 8. Residual risks and limitations

1. **Local-only evidence.** All results are from embedded PostgreSQL with synthetic JWT claims. Deployed
   (Supabase/PostgREST) behaviour is *not* verified; `productionVerified: false` stands.
2. **The eight `BRANCH.*` rows and the 12 Group-B rows remain BLOCKED.** They require deployed verification
   with real Auth tokens and are not evidence this migration can produce locally.
3. **Adoption is not proven** — a migration in the repo is not a migration applied to any environment.
4. **Inherited policies cost a correlated subquery per row** on the parent FK. Every FK column used is
   already indexed (`idx_cpol_po`, `idx_cgrl_grn`, `idx_cgrh_line`, `idx_cdnl_note`, `idx_cdn_po`,
   `idx_cpoe_po`, `idx_crba_grn_line`, `idx_crcb_grn_line`, `idx_crin_line`, `idx_crlr_line`), so the cost is
   a lookup per row; no query plan evidence has been captured for a large data volume.
5. **CONCURRENCY of the SIR helper:** `construction_supplier_reference_visible` is `stable` and reads
   `expenses` as definer; it is evaluated per row, and its cost on large reference tables has not been
   measured.
6. **`_procurement_grants` visibility is now own-rows-or-admin.** No `src/` code reads that table directly
   (the UI uses `capabilities_for`), and the release tests read it as owner, so nothing in the application
   depends on the wider visibility — but this is a behaviour change for a non-admin member querying the
   table directly through PostgREST, and it should be reviewed as such.
7. **Stage B has not started.** Per the approval it begins only now that Stage A passes.

## 9. Commit and deployment status

Committed locally as **`<filled by commit>`** on `arena/2faa03b4-ledgr-react` — migration, new suite, the
`CP.SCOPE.TENANT-BRANCH-FORGERY` adaptation, the `gate.mjs` key, the three corrected documents, the Phase-1
report and this report. **Not pushed** (Task 5 requires separate authorisation to push), **not deployed**, no
database object created anywhere outside the local replay.
