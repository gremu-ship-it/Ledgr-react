# Ledgr Construction Upgrade — Stage B report (summary invoicing and project linkage)

**Date:** 2026-10-16 · **Branch:** `arena/2faa03b4-ledgr-react` · **Baseline:** `8866d97`, after Stage A (`545e3e1`, `b077e37`)
**Authorisation:** "Ledgr Construction Upgrade — Implementation Approval", Stage B, which begins only after Stage A
passes its local validation (`LEDGR_CONSTRUCTION_UPGRADE_STAGE_A_2026-10-16.md`).
**Evidence class:** local isolated only. `productionVerified` stays **false**; nothing was deployed, pushed or
applied to any database.

---

## 1. What the repository already did, and what was actually missing

The brief's premise — "an invoice for construction work must be able to bill a summary line" — was already
structurally true, and that is the single most useful finding of this stage:

- `invoice_lines.product_id` is nullable and the builder already writes `product_id: null` for a line the user
  types by hand. So a line reading **"Construction of office building"** with a quantity and a selling price is
  a first-class invoice line today; nothing needed to be added to the schema, the repository or the server.
- Stock and cost of sales are deducted **only** for lines that carry a `product_id`
  (`IncomePage.tsx`, `deductStockAndPostCogs(... validLines.filter((l) => l.product_id) ...)`), and only when the
  created invoice is not a draft. A summary line therefore yields no stock movement and no COGS **by
  construction**, not by a special case.
- The material ledger is the construction issue command, which writes exactly one `stock_movements` row
  (`issue_out`, negative quantity, `source_type 'construction_issue'`) plus one `construction_material_issues`
  row with `journal_effect 'none'`. There is no path from invoice creation to that ledger, and none was added.

What was genuinely missing was the **project link**: `invoices.project_code` existed and the builder passed it
through, but the only way to set it was a free-text box that appears for the NGO template — no construction
site, no project reference, no validation and no business/branch check.

## 2. Files changed

| File | Change |
| --- | --- |
| `src/pages/IncomePage.tsx` | `InvoiceBuilderTab`: loads the business's construction sites (`repos.construction.findSites`), adds an optional **Construction project** selector that sets the invoice's project code from the selected site's `project_ref`, and validates the selection in the create mutation. No change to the stock/COGS/journal path, to the quick-entry path or to any server call. |
| `src/pages/__tests__/IncomePageInvoiceBuilder.test.tsx` | **New** — 6 tests (below). There was no test for this screen before. |
| `docs/architecture/CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md` | **New** — design only for the project-linked return, wastage and damage workflows. No command, movement type, table or permission is added. |

No migration, no new table, column, RPC, permission or business rule. The invoice header is still created
through the existing `create_invoice_with_lines` (`security invoker`, so the caller's RLS applies); that
function inserts whatever columns the payload names, so `project_code` needed no server change.

## 3. Behaviour implemented

**Selection.** The selector lists **active** construction sites of the current business as
`SITE-CODE · Site name (PROJECT-REF)`. The list comes from a row-level-security-filtered read, so a site in a
branch the signed-in user may not work in is never offered — after Stage A, that read is branch-scoped by
`can_access_branch`. Choosing a site sets the invoice's `project_code` to that site's `project_ref`; choosing
"None" clears it. The helper text says plainly that materials issued to the site are recorded in the
construction workspace and are **never** added to the invoice automatically.

**Validation at submit time** (all four refusals are asserted in the tests):

| Condition | Result |
| --- | --- |
| The selected id is not in the branch-scoped list the user was given (deleted, closed or never authorised) | refused: *"no longer available for this business"* |
| The site's `business_id` is not the invoice's business | refused: *"belongs to another business"* |
| The site is marked inactive | refused: *"closed"* |
| The invoice has a branch and it differs from the site's branch | refused: *"the invoice branch and the construction project's branch differ"* |

**The link is text, not a foreign key — recorded as a limitation.** `invoices.project_code` is a `text`
column. Nothing prevents a later rename of the site's project reference from leaving the invoice pointing at a
stale code, nothing prevents a duplicate code across sites, and no database constraint can be relied on for
project reporting. The application-level checks above are the entire guard rail, and they run on the client, so
they are a usability guard, not an authorisation boundary — authorisation remains row level security and the
construction commands. **Future option, not taken here:** a nullable `invoices.construction_site_id` foreign
key with the same branch-scope predicate; that is a schema change and needs its own approval.

## 4. Tests added (`src/pages/__tests__/IncomePageInvoiceBuilder.test.tsx`)

| Test | What it pins |
| --- | --- |
| links the selected site as the project reference without adding any material line | `createWithLines` receives `project_code = 'PRJ-OFFICE-1'` and **exactly one** line: the typed description, `product_id` null. No material was appended. |
| posts no stock and no cost of sales for a summary line | with a non-draft invoice, `deductStockAndPostCogs` is called with an **empty** product list — the stock path is reached with nothing to move. |
| still deducts stock for a product line | a product line keeps its existing behaviour: `product_id` and the product's sales account reach the invoice line, and the stock call receives `[{ productId, quantity: 2 }]`. |
| refuses a project that belongs to another business | the refusal message is shown and `createWithLines` is **never called**. |
| refuses a project whose branch differs from the invoice branch | same, on the branch rule. |
| stores only the summary line and the project reference, so no material detail can be echoed | the stored payload contains no `material_issue`, `issue_out`, `stock_movement`, `quantity_base` or construction-ledger token. |

The last test is the disclosure proof for the customer-facing surfaces: the invoice PDF echoes each **stored**
line's description, quantity, unit price and line total verbatim (`documentGenerator.ts`), and an export echoes
the stored rows — so what cannot be disclosed is what is not stored. This is deliberately a data-shape test
rather than a PDF-rendering test: `generateInvoiceDocument` renders through an iframe and jsPDF in a real
browser, which is the R094 browser suite's job, not this screen test's.

## 5. Design only: return, wastage and damage

`docs/architecture/CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md` sets out the three workflows with
permissions, movement types, reasons, evidence, audit records and stock reconciliation — and states explicitly
that **none of them may be implemented yet**, because two decisions are missing:

1. the new `stock_movements` enum tokens (a return, a wastage write-off and a damage write-off are three
   different stock events and must not share `issue_out`), and
2. the accounting treatment of wastage and damage — stock-only (consistent with today's disabled consumption
   posting) or a period write-down under IAS 2 §34.

**GL posting for construction material consumption stays disabled** (`chk_crpp_gl check (gl_posting_enabled = false)`)
and no journal entry was created by, or for, this stage.

## 6. Validation (exact results)

| Check | Result |
| --- | --- |
| Focused: `IncomePageInvoiceBuilder.test.tsx` | **6 passed / 0 failed** |
| Full unit/integration (`npm test`) | **125 files passed · 1156 tests passed** (was 124 / 1150 before this stage) |
| `npx tsc -b` | exit 0 |
| `npm run test:release:types` | exit 0 |
| `npm run lint` | **0 errors**, 4 pre-existing warnings |
| `npm run build` | OK — PWA precache 117 entries |
| Release suite (`npm run test:release`) | **PASS 858 · FAIL 0 · BLOCKED 57 · NOT APPLICABLE 0** |
| `git diff --check` | clean |

**One anomaly, reported rather than hidden.** In a single release run made immediately after the full unit
suite in the same shell, the result was `PASS 841 · FAIL 0 · BLOCKED 75`: the 17 real-Chromium rows of
`r094-browser.test.ts` / `IC.CACHE.BROWSER-*` did not execute and `HARNESS.EXECUTION` was raised, which is the
harness correctly reporting BLOCKED rather than PASS. Re-runs resolved it: the browser suite alone passed
**17 + 1 skipped** and a quiet full release run returned to **858/0/57/0**. The rows are browser-environment
evidence, and the likely cause is resource contention with the preceding test run; no code or migration change
accompanies the difference, and no PASS is claimed from the blocked run.

## 7. Commit and deployment status

Committed locally on `arena/2faa03b4-ledgr-react` as a focused Stage B commit (parent `b077e37`, the Stage A
report commit) — `IncomePage.tsx`, the new screen test and the two documents. **Not pushed** (Task 5 requires separate authorisation to push), **not deployed**, no
database contacted outside the local embedded replay, and `productionVerified` remains **false**.
