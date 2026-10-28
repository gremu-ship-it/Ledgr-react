# Ledgr Construction Upgrade — Phase 1 baseline review

**Date:** 2026-10-16 **Task:** upgrade phases 1–3 (branch security, summary invoicing, internal material traceability)
**Status:** inspection only. **Nothing was implemented, migrated, deployed, committed or pushed.** The working tree
is unchanged apart from this report and two throwaway read-only probe scripts under `.cache/`.

---

## 1. Repository baseline, and the discrepancies found

| Expected | Actual | Verdict |
| --- | --- | --- |
| Branch `arena/2faa03b4-ledgr-react` | `arena/2faa03b4-ledgr-react` | **match** |
| Reference HEAD `7dac103` | **`8866d97`** | **one commit ahead — see below** |
| Working tree clean | clean; local == `origin/arena/2faa03b4-ledgr-react` | match |
| No work discarded | `7dac103` is a verified ancestor of `8866d97` | match |

`8866d97` is a **docs-only** commit from the previous turn: *"docs(construction): measure the branch-scope gap
and prepare Group B verification"* — 3 files, +381/−3 (`docs/architecture/CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md`,
readiness §16, matrix §7.9). No migration, schema, policy, grant, UI or harness file changed. It **was pushed**
in that turn, before this instruction, so `origin` is at `8866d97`; nothing has been pushed since and nothing
will be without authorisation.

Recent history: `8866d97` ← `7dac103` ← `70089f8` ← `247fe77` ← `861bcc8` ← `b7b3a41`. Only two local branches
exist (`arena/2faa03b4-ledgr-react`, `main`); there is no `arena/4a57bbfe-ledgr-react`.

**Discrepancy 2 (material, and mine to correct).** The decision brief's table classification is **wrong**, and
the schema says so. It claimed **11** tables inherit a guaranteed branch and **4** have no branch dimension
(15/4). The replayed schema shows **10 and 5 — i.e. 14 unconditional, 1 conditional** (§3). The brief and
matrix §7.9 must be corrected before Phase 2 is implemented, or the migration will inherit the error.

## 2. Outstanding construction branch-read findings

Verified against the replayed schema and by probe; all local isolated evidence, **no deployed database contacted**.

- **18 of 19 construction tables** carry exactly one SELECT policy — `is_business_member(business_id)`, no branch
  predicate. `authenticated` holds **SELECT only** on them (no INSERT/UPDATE/DELETE), so writes are command-only.
  `anon` holds **no** grants on any construction table. All 23 public commands are granted to `authenticated`,
  none to `anon`; 40 construction functions are `SECURITY DEFINER`.
- **Measured behaviour:** a user assigned only to branch A1 (role `branch_manager`, `business_users.branch_id = A1`)
  reads **1** A2 purchase order, its line, the A2 goods-receipt note and the A2 site, while
  `can_access_branch(business, A2)` returns **false** and every A2 command is refused `42501 You do not have
  access to that branch.` The `invoices` control returns 0 A2 rows against a ground-truthed 1, so the method
  distinguishes a real denial from a missing grant.
- **The three read RPCs** (`construction_procurement_open_items`, `construction_project_material_cost`,
  `construction_procurement_capabilities_for`) are `SECURITY DEFINER`, gated only by `is_business_member`, and
  return **all** branches of the business.
- **`construction_procurement_capabilities` is not a tenant leak** — it is a global static catalogue (`code`,
  `description`, 11 seeded rows) with no `business_id` column. The brief flagged this as an open question (D-3);
  the schema answers it. The remaining recorded rationale is a one-line note, not a fix.
- `construction_procurement_grants` **is** tenant data and is readable by every active member of the business
  (`is_business_member`), i.e. any member can see who holds `procurement.po.authorize`. Tenant-scoped, coarse —
  a decision point, not a defect.

## 3. The 19 construction tables — brief vs actual schema

Verified from `information_schema`/`pg_constraint` on the replayed database, not from migration text.

| Class | Brief claimed | **Schema says** | Tables |
| --- | --- | --- | --- |
| Carries `branch_id NOT NULL` (FK → branches) | 4 | **4** ✓ | `construction_procurement_sites`, `construction_purchase_orders`, `construction_goods_receipt_notes`, `construction_material_issues` |
| Branch reachable through **NOT NULL** FK chain | 11 | **10** ✗ | `_purchase_order_lines`, `_purchase_order_events`, `_delivery_notes`, `_delivery_note_lines` (→ PO); `_goods_receipt_lines`, `_goods_receipt_holds`, `_receipt_inspections`, `_receipt_line_reclassifications`, `_receipt_bill_allocations`, `_receipt_cost_bases` (→ GRN) |
| Branch **not guaranteed** | 4 | **5** ✗ | the 10 above excluded; `_supplier_invoice_references` (**parent `expenses.branch_id` is NULLABLE**), `_procurement_capabilities`, `_procurement_grants`, `_product_uom_conversions`, `_receipt_posting_policies` |
| **Total** | 19 | **19** ✓ | — |

**Root cause of the error:** `construction_supplier_invoice_references.expense_id → expenses.id` **is** NOT NULL, but
`expenses.branch_id` is **nullable** — verified directly (`is_nullable = YES`). The chain therefore breaks at the
parent, and the brief's "11" silently assumed a non-null parent. This is also why P5-D wrote
`journal_lines` as `branch_id is null or can_access_branch(...)` rather than a bare predicate.

**Why this matters for Phase 2:** 14 tables can take the bare branch predicate; `_supplier_invoice_references`
needs an explicit NULL-row rule; the other 4 keep tenant-scoped member reads. The "15 branch-derivable" framing
should become **"14 unconditional + 1 conditional + 4 branchless"**.

**Existing precedent and cost:** `invoice_lines_member_read` already uses exactly the inherited pattern
(`can_access_branch(business_id, (select branch_id from public.invoices where id = invoice_id))`), and every FK
column the inherited policies would read is **already indexed** (`idx_cpol_po`, `idx_cgrl_grn`, `idx_cgrh_line`,
`idx_cdnl_note`, `idx_cdn_po`, `idx_cpoe_po`, `idx_crba_grn_line`, `idx_crcb_grn_line`, `idx_crin_line`,
`idx_crlr_line`). So the change is mechanical and cheap.

## 4. How invoices, projects, material issues and stock movements relate today

```
construction_procurement_sites.project_ref (text, NOT NULL)   ← the only "project" that exists
        │  copied onto
        ├── construction_purchase_orders.project_ref
        ├── construction_goods_receipt_notes.project_ref
        └── construction_material_issues.project_ref
                        │  stock_movement_id → stock_movements.id  (movement_type = 'issue_out', negative qty,
                        │  unit_cost = pool average_cost, branch/location = the site's)
                        └── journal_effect: none   ← no GL entry for consumption

invoices.project_code (text, nullable)  ← only written by the IncomePage NGO template; no FK, no link
                                           to project_ref, no shared identifier
invoices ──(createInvoiceReceivableEntry)──► AR / revenue journal
         └─(deductStockAndPostCogs, ONLY for lines with product_id)──► stock_movements + COGS
```

Facts that matter:

- **There is no `projects` table and no work-package entity.** A "project" is free text (`project_ref`) held
  consistently on the 4 tables above, and aggregated for cost by `construction_project_material_cost`.
- **Project cost exists; project revenue does not.** Material consumption is visible as stock value and as
  `construction_material_issues` rows, but with `journal_effect: none`. Nothing ties an invoice to a project.
- **Invoice creation does not touch stock unless a line carries `product_id`.** `InvoiceBuilderTab` builds
  `stock_lines`/`deductStockAndPostCogs` input from `lines.filter(l => l.product_id)` only. A summary line with
  no product produces **no** stock movement and **no** COGS.
- **`invoice_lines.product_id` is nullable and `description` is NOT NULL**, so "Construction of office building",
  qty 1 × agreed price, no product, is already a fully supported invoice line.
- **The customer-facing renderer is description-driven** — `documentGenerator.generateInvoiceDocument` prints
  `l.description`, `quantity`, `unit_price`, `line_total`; `InvoicesPage` renders `line.description`. Nothing in
  the invoice, PDF or export path references any construction table (grep: zero hits), so **no leak path exists
  today**; the requirement is a guard to test, not a defect to fix.
- **Billing defaults differ between the two invoice surfaces:** `InvoiceBuilderTab` defaults `tax_code` to
  `vat_standard` (VAT computed from `effectiveVatRate`); `QuickEntryTab` hardcodes `tax_code: 'none'`,
  `tax_rate: 0`. Reported, **not changed** — VAT is out of scope.

## 5. What already exists vs what genuinely needs implementation

**Already exists (no work needed):**

| Capability | Where |
| --- | --- |
| Summary invoice line: free-text description + agreed price, optional product, no stock effect | `invoice_lines.product_id` nullable; `IncomePage.tsx` `InvoiceBuilderTab`; `deductStockAndPostCogs` filter |
| Customer-facing rendering driven by the line description | `src/lib/documents/documentGenerator.ts:669/756`; `src/pages/InvoicesPage.tsx:782` |
| Internal material traceability: issue → `issue_out` movement + `construction_material_issues` row with `stock_movement_id`, `project_ref`, mandatory `evidence_reference` | `20261021000000_…:3790–3815`, `issue_construction_materials_to_project` |
| Per-project material cost | `construction_project_material_cost(business_id)` |
| Procurement chain PO → DN → GRN → holds/inspection → bill match → cost basis → receipt posting | 23 commands, 12 append-only guards, capability model, four-eyes, idempotency (`client_key`), all covered by 17 `CP.*` release rows |

**Genuinely needs implementation or a decision:**

1. **Phase 2 security** — nothing exists. 18 tables need branch-scoped read policies; 3 read RPCs need a branch
   rule; stale wording needs correcting. Items §2/§3 above are the exact scope.
2. **No project↔invoice link.** `invoices.project_code` is an unrelated free-text field. Project revenue cannot
   be reported today without a decision on the identifier (**P3-1**).
3. **No material-return, wastage or damage record** in the construction surface. The enum has `return_in`,
   `return_out`, `write_off`, `adjustment_in/out`, and `issue_out`; but no construction command records a return
   to store, wastage or damage against a project. `MaterialTransferPreparationSection` is a **browser-local draft
   with no server write** (its own labels say "not posted"). This is the largest real gap behind phase 3 (**P3-3**).
4. **No GL entry for material consumption** (`journal_effect: none`), so project cost is a stock-value figure only.
   GL posting is deliberately disabled (`chk_crpp_gl`) and must stay disabled (**P3-4**).
5. **No tests** for the summary-invoice path or the construction↔invoice boundary: there is no
   `IncomePage.test.tsx` / `InvoicesPage.test.tsx` at all (0 files). 124 `src` test files and 24 release suites
   exist; `src/lib/__tests__/documentGenerator.test.ts` covers rendering only.

## 6. Proposed implementation plan

### Phase 2 — branch-scope the construction read surface (one migration)

**New file:** `supabase/migrations/20261022000000_construction_branch_scope.sql` — idempotent, additive, no data
migration, no grant change, no command change.

| Group | Tables | New SELECT policy predicate |
| --- | --- | --- |
| Direct (4) | `_procurement_sites`, `_purchase_orders`, `_goods_receipt_notes`, `_material_issues` | `is_business_member(business_id) and can_access_branch(business_id, branch_id)` |
| Inherited (10) | `_purchase_order_lines`, `_purchase_order_events`, `_delivery_notes`, `_delivery_note_lines` → PO; `_goods_receipt_lines`, `_goods_receipt_holds`, `_receipt_inspections`, `_receipt_line_reclassifications`, `_receipt_bill_allocations`, `_receipt_cost_bases` → GRN | `is_business_member(business_id) and can_access_branch(business_id, (select branch_id from public.<parent> where id = <fk>))` |
| Conditional (1) | `_supplier_invoice_references` | `is_business_member(business_id) and (public.<expense branch> is null or can_access_branch(business_id, <expense branch>))` — **P2-D1** |
| Branchless (4) | `_procurement_capabilities` (static catalogue → keep `using (true)`, record rationale), `_procurement_grants`, `_product_uom_conversions`, `_receipt_posting_policies` (keep `is_business_member`) — **P2-D2** | unchanged |

**Why this is low-risk:** all commands are `SECURITY DEFINER`, so their internal reads bypass RLS — tightening
read policies **cannot** change command behaviour. The change bites only the client PostgREST read path
(`ConstructionProcurementRepository`). The pattern, the predicate and the indexes all already exist.

**Also in phase 2:** add a branch rule to the three read RPCs (**P2-D3**); correct the brief's 11/4 → 10/1/4 and
matrix §7.9, and the stale `BRANCH.*` reason strings, in the same commit.

**Tests:** extend `tests/release/construction-procurement.test.ts` with read-boundary rows per group and rerun the
17 existing `CP.*` rows; add focused repository/UI tests asserting an A1-only view shows no A2 documents.
Update the `BRANCH.*` expectations only as the approved decision requires.

**Risks:** (a) cross-branch construction *reporting* becomes impossible for assigned-scope roles — accepted UX
change, needs product sign-off; (b) a wrong predicate on an inherited table could hide rows from everyone
(fail-closed), caught only by the positive-control probes; (c) `can_access_location` returns false for a NULL
location, so any inherited policy routed through it must be probed with a NULL-location fixture.

### Phase 3 — summary invoicing and internal traceability

Reuse, don't rebuild: the invoice, inventory and construction workflows already support this shape.

| Step | Files | Notes |
| --- | --- | --- |
| Project identifier for billing (**P3-1**) | `invoices.project_code` (existing) + `IncomePage.tsx` | Option (a): populate `project_code` from the chosen site's `project_ref` — no migration, reporting by exact text match. Option (b): nullable `invoices.construction_site_id` FK — needs a migration and a cross-branch validation rule (an A2 invoice must not bill an A1 site). Recommend (a) now, (b) as a follow-up. |
| "Bill this project" entry point | `IncomePage.tsx` (`InvoiceBuilderTab`), optionally `ConstructionOverviewSection.tsx` | Creates a **single summary line** (description, qty, price) and **never pre-fills material lines**. |
| No silent inventory deduction (**P3-2**) | `IncomePage.tsx` + new test | Already true when `product_id` is empty; add a focused test that asserts **no** `stock_movements` row and **no** COGS for a summary-only invoice. |
| No internal leakage (**P3-2**) | `documentGenerator.ts`, `InvoicesPage.tsx` + new test | Assert the rendered invoice contains the summary text and **no** material name, quantity or `construction_*` reference. |
| Material returns / wastage / damage (**P3-3**) | new migration + `ConstructionMaterialIssuesSection.tsx` | **Not implemented today.** Requires an approved command design (capability, mandatory reason/evidence, `return_in`/`write_off` movement, `journal_effect: none`) mirroring `issue_construction_materials_to_project`. Do not invent this without approval. |
| Project revenue vs cost (**P3-4**) | reporting only | No GL change. GL posting stays disabled. |

**Testing:** new `src/pages/construction/__tests__/ConstructionProjectBilling.test.tsx` (jsdom, `vi.hoisted` mock of
`@/lib/repositories`, `afterEach(cleanup)`, `useAppStore.setState({ currentBusiness })`) plus release-suite rows
asserting the stock and journal effects of a summary invoice. Full validation: `npx tsc -b`, `npm run lint`,
`git diff --check`, `npm run build`, `npm run test:release`.

### Decisions required before implementation

| # | Decision | Owner |
| --- | --- | --- |
| **P2-D1** | NULL-branch rule for `_supplier_invoice_references` (fail-closed vs `is null or` passthrough) | security owner |
| **P2-D2** | Keep `is_business_member` on the 3 tenant-scoped branchless tables, keep `using (true)` on the static catalogue, and whether `_procurement_grants` should be owner/admin-only | security owner + product |
| **P2-D3** | Branch rule for the 3 read RPCs (signature change vs internal filter) | product owner |
| **P2-D4** | Accept that assigned-scope roles lose cross-branch construction reporting | product owner |
| **P3-1** | How project revenue is identified (existing `project_code` vs a new site FK) | product owner |
| **P3-2** | Whether a project-billing line must be blocked from carrying a `product_id` | product owner |
| **P3-3** | Whether returns / wastage / damage are implemented now, and with which movement types and evidence rules | product owner + accounting owner |

## 7. Safety, validation and what remains unverified

- **No production or shared/staging database was contacted.** Every fact above comes from the ephemeral embedded
  PostgreSQL 17.10 the R13 harness creates and destroys (local, `assertLocalOnly`, non-root, temp dir, reads
  rolled back). Two throwaway read-only probe scripts were used (`.cache/probe-schema-verify.mjs`,
  `.cache/probe-branch-scope.mjs`).
- **VAT untouched.** No tax code, rate, schedule or configuration was inspected for change or altered.
- **Nothing committed, pushed, merged or deployed** in this phase.
- **Deployed behaviour remains unverified.** No isolated Supabase project exists; the deployed ACL profile,
  the PostgREST paths and real GoTrue tokens are all still unproven. Group B remains BLOCKED (57 rows), the
  release suite still exits 2 while BLOCKED > 0, and every result here is **local isolated** with
  `productionVerified: false`.
