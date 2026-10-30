# Construction procurement & inventory — decision matrix (2026-10-16)

**Status:** Additive schema + commands implemented and evidenced in the **local isolated layer only**.
Nothing is deployed, staged or committed by this review. **ADR `INV-CM-001` remains proposed, not
accepted.** The construction material receipt/transfer preparation slices remain local-only UI.

## 1. What exists now

| Artefact | What it is |
| --- | --- |
| `supabase/migrations/20261020500000_stock_movement_type_construction_issue.sql` | One-statement additive migration adding the `issue_out` stock movement type (its own file because PostgreSQL cannot use an enum label in the transaction that added it) |
| `supabase/migrations/20261021000000_construction_procurement_traceability.sql` | Additive migration (§0–12): capability vocabulary, site registry, explicit product UOM conversions, purchase orders, delivery-note evidence, goods-receipt notes with holds, receipt inspection + quality release, supplier-invoice-reference registry, receipt↔bill-line allocation, receipt posting policy + cost bases, material issues/project cost, open-item report, appended-only tables, RLS/privileges, self-verifying invariants |
| `tests/release/construction-procurement.test.ts` | 17 evidence rows (`CP.*`) proving the flow, the denials, cost derivation (IAS 2), currency/rate handling (IAS 21), quality release, consumption, idempotency, true two-connection concurrency, rollback, and the absence of unintended stock/journal effects |
| `tests/release/gate.mjs` | `construction-procurement.test.ts → construction-procurement.json` mapping (PASS-only suites gate green) |
| `src/pages/ExpensesPage.tsx` | Supplier bill form now captures the supplier's **own** invoice reference (`expenses.reference`) and offers an explicit, default-off “Construction procurement bill” switch that suppresses the legacy per-line stock hook (`addStockForBranchPurchase`) |
| `src/lib/vat.ts` | Standard VAT constant (0.175) now records the **owner-resolved effective date (1 January 2026)**, its evidence and the minority 31 December 2025 outlier, and repeats that no historical document is restated. No rate or date behaviour changed |

**Evidence layer:** real PostgreSQL 17 (embedded), full synthetic migration replay including the new
migration, synthetic authenticated identities bound through `request.jwt.claim.*`, every probe rolled
back. This is **not** official Supabase Auth/PostgREST, **not** a deployed-policy check, and **not**
production verification. No production or shared database or permission was touched. Every evidence row
carries `productionVerificationRequired: true`.

## 2. Per-operation permission matrix

Authority is never inferred from a role name. Every operation needs (a) active membership of the exact
business, (b) an explicit capability grant, and (c) the scope checks below. `constructor` = owner/admin
of that business; grants are appended-only with `revoked_at`; self-grant is refused; every grant/revoke
needs a written reason.

| Operation (command) | Capability required | Additional server-side scope gate | Retry key | Ledger effect |
| --- | --- | --- | --- | --- |
| `register_construction_procurement_site` | `procurement.master.manage` | branch **and** location must belong to the business; `site_code` unique per business; `project_ref` is an explicit text reference (never the restricted PFS resource) | n/a (idempotent upsert on business+site_code) | none |
| `register_construction_product_uom_conversion` | `procurement.master.manage` | product must belong to the business; conversion target must be the product's declared base unit; **no chaining**; factor > 0; evidence reference required | n/a | none |
| `create_construction_purchase_order` | `procurement.po.manage` | site→branch mapping resolved server-side; `can_access_branch`; supplier must be an active supplier contact of the business; every product must belong to the business; quantities converted with the registered factor only | `client_key` unique per business | none |
| `authorize_construction_purchase_order` | `procurement.po.authorize` | `can_access_branch`; **four eyes**: authorizer ≠ creator; only `draft` may be authorized | row lock | none |
| `cancel_construction_purchase_order` | `procurement.po.manage` | written reason; refused once any goods receipt exists | row lock | none |
| `record_construction_delivery_note` | `procurement.delivery_note.record` | authorized PO of the same business; evidence reference required; supplier-derived scope | `client_key` | **none** (`stock_effect`/`journal_effect` = `none`) |
| `record_construction_delivery_note_exception` | `procurement.exception.authorize` | as above **plus** `exception_of` naming the recorded note with the same supplier and normalized reference, written reason + evidence | `client_key` | **none** |
| `record_construction_goods_receipt` | `procurement.grn.record` | branch/site/location/project derived from the authorized PO (caller cannot supply them); `can_access_branch`; over-receipt needs `procurement.exception.authorize` + reason + evidence; every rejected/quarantined/disputed quantity needs `procurement.receipt.inspect` **and** an evidenced hold | `client_key` | **none** (`posting: not-approved`) |
| `release_construction_receipt_hold` | `procurement.exception.authorize` | written reason; hold must be open | row lock | none |
| `register_construction_supplier_invoice_reference` | `procurement.bill.match` | bill must be a business supplier bill with a supplier contact and a printed reference; duplicate `(business, supplier, normalized reference)` refused | idempotent per bill | none |
| `register_construction_supplier_invoice_reference_exception` | `procurement.exception.authorize` | must name the active conflicting registration with the same business/supplier/normalized reference; written reason + evidence; a bill cannot be its own exception | idempotent per bill | none |
| `match_construction_bill_line_to_receipt` | `procurement.bill.match` | exact product equality; bill supplier = PO supplier; bill currency = PO currency; registered supplier reference; explicit UOM conversions; caps on the remaining bill-line and receipt-line quantity; one bill unit per bill line; a quantity difference needs `procurement.exception.authorize` + reason + evidence | `client_key` | **none** |
| `approve_construction_receipt_posting_policy` | `procurement.policy.approve` | written reason + evidence; `gl_posting_enabled` is structurally forced `false` | row lock | none |
| `record_construction_receipt_cost_basis` | `procurement.receipt.post` | approved+enabled policy required; only from an already-matched allocation; bill unit must equal the product base unit; discounts, tax codes and exchange-rate differences are refused; coverage must be reached before posting; base-currency only | `client_key` | none |
| `post_construction_receipt_movement` | `procurement.receipt.post` | approved+enabled policy, full cost-basis coverage, **open accounting period** | GRN row lock + existence check (idempotent) | **one** `stock_movements` row via the single shared writer; **no journal entry** |

Read access: `SELECT` on the new tables is granted to `authenticated` behind one
`is_business_member(business_id)` policy per table; `anon` gets nothing; no `INSERT`/`UPDATE`/`DELETE`
privilege is granted to `authenticated` on any new table, and twelve tables carry an appended-only
trigger (the purchase-order table deliberately carries two definitions, the second allowing only the
`po_transition` marker) that also refuses direct writes from a privileged writer unless the calling
command sets its own transaction-local marker (`site_upsert`, `uom_upsert`, `po_transition`,
`grant_revoke`, `policy_approve`, `hold_release`).
Document numbering takes a per-business transaction advisory lock **before** the `client_key` replay
check, and the replay key is re-checked after the parent rows are locked, so a retry of the same key
returns the committed document instead of colliding on a unique index.

## 3. Inventory & valuation boundary

* One perpetual weighted-average-cost pool per **business × product × location**, written by exactly one
  trigger on `stock_movements` (verified: exactly one stock-balance writer in the schema).
* A receipt movement is written **only** by `post_construction_receipt_movement`, as
  `movement_type='purchase'`, `source_type='construction_grn'`, dated at the receipt date, for the
  **accepted** base quantity only. Rejected, quarantined and disputed quantities never enter stock.
* Cost basis is the matched supplier bill line's `unit_price` in the product base unit. Discounts, tax
  codes, FX/exchange-rate differences and unit conversion are **refused rather than assumed** (no
  discount, tax or FX allocation rule is approved).
* Posting is disabled by default: with no policy row (or a disabled one) both the cost basis and the
  movement are refused `22023 receipt-posting-not-approved`, and the §12 invariants assert that no
  policy row and no `source_type='construction_grn'` movement and no construction journal entry exist
  at migration time.
* Closed periods stay closed: the movement writer asserts `_ledgr_assert_period_open`; nothing in this
  work reopens a period.
* Duplicate posting through the legacy path is impossible twice over: the UI switch suppresses the
  client-side purchase hook for a declared construction bill, and the matcher refuses to match a bill
  that already moved stock (`bill-already-inventoried`).

## 4. Cost, tax and currency policy — **approved and implemented (2026-10-16)**

The owner approved the base-currency/FX policy, the quarantine/return/consumption rules, the numbering
policy, the inspection record model, the cutover approach and the VAT effective date, **conditional on
alignment with accounting standards and FX/tax guidelines**. Each element below is implemented only where
that alignment is provable from the standard text, and is explicitly refused where it is not.

| Element | Treatment | Authority |
| --- | --- | --- |
| Receipt cost basis | The matched supplier bill line's purchase price | IAS 2 §10–11 (cost of purchase) |
| Trade discount | **Deducted** from cost; the stated amount must equal the stated percentage (one source of truth) | IAS 2 §11 ("trade discounts, rebates and other similar items are deducted in determining the costs of purchase") |
| Input VAT | **Excluded** when the business is VAT registered (recoverable), **included** when it is not; the amount used is the tax actually recorded on the supplier line, never a recomputed rate | IAS 2 §11 ("other taxes **other than those subsequently recoverable** by the entity from the taxing authorities") |
| Other tax codes (PAYE, WHT, CIT, FBT, TPR) | **Refused** — not a purchase tax | IAS 2 §11 scope |
| FX on a foreign-currency bill | Valued at the rate recorded for the **transaction date**, then **frozen** into the pool; a stale rate, a rate date other than the bill date, a functional amount that disagrees with original × rate, or a non-unit rate on a functional-currency bill are all refused | IAS 21 §21 (spot rate at the transaction date), §23(b) (historical-cost non-monetary items keep the transaction-date rate) |
| Later rate movement | **Never restated** in inventory; exchange differences stay in profit or loss | IAS 21 §28 |
| Consumption / project material cost | Accepted material issued to a site leaves stock at the pool weighted-average carrying amount (`issue_out`, negative quantity, pool cost); project material cost is derived per `project_ref` | IAS 2 §6(c) (materials to be consumed are inventories), §34 (carrying amount recognised as an expense when consumed) |
| Quality release (quarantined/disputed → accepted) | Allowed **only** with a PASSED inspection of that receipt line, the inspection capability, the exception authority, a written reason and evidence; a release after posting is posted as a delta | Quality evidence, not valuation: quarantined/disputed material was never in stock |
| Rejected → accepted | **Refused**: rejected material never entered inventory and is the supplier's | IAS 2 §11 (never part of cost) |
| Accepted → back out of stock (damage after acceptance) | **Refused**: that is a write-down requiring net realisable value | IAS 2 §28 and §34 |
| Accepted goods returned to the supplier | **Refused in this increment.** Derecognising inventory without the supplier credit note would understate the payable; no supplier-credit-note document exists in the repo. What is implemented instead: rejected material never enters stock, and the aged open-item report lists every outstanding supplier claim for period close | IAS 2 §34 (derecognition at the carrying amount) + cut-off completeness |
| Numbering | Per business, monotonic, never reused after a cancellation; a rolled-back creation leaves no gap | Internal control over document completeness |

Still **not** implemented, and still refused: any GL posting from a receipt or an issue
(`gl_posting_enabled` is constrained `false`; both writers return `journal_effect: 'none'`), and any
chart-of-accounts mapping (the tax module `20260708000000_tax_compliance_module.sql` leaves tax
payable/receivable accounts `NULL`).

| # | GL vector | Shape | Blocked on |
| --- | --- | --- | --- |
| A | Receipt → inventory / GRNI accrual | Dr Inventory (WAC pool) accepted value; Cr Goods-received-not-invoiced | Approved CoA codes for inventory and GRNI; owner sign-off that receipt cost = matched bill line |
| B | Receipt → no GL, accrual only at the bill | Inventory value recognised when the supplier bill posts (existing expense journal), receipt only moves quantity/value into the pool | Owner decision that the pool may be fed without a GL counterpart; period-cut analysis |
| C | Receipt → direct AP | Dr Inventory; Cr Accounts payable at receipt, bill matching only clears quantities | Requires the bill to stop posting its own expense journal; AP control impact |
| D | Issue → project/contract cost | Dr Project material cost (by `project_ref`); Cr Inventory at pool cost | Approved project-cost account mapping and a project cost ledger; the quantity/value derecognition itself is already implemented |

**VAT note (superseded by the schedule).** The input-VAT treatment above does not depend on a rate: it uses
the tax **actually recorded** on the supplier line. The dated evidence for a *rate* now lives in
`public.tax_configurations` (per business, `effective_from`/`effective_to`/`mra_reference`), constrained by
`20261022000000_effective_dated_tax_configurations.sql` and resolved by `src/lib/tax/taxConfiguration.ts` —
see §5 item 7. Nothing in the cost path reads it, and nothing here restates a posted document.

## 5. Owner decisions — approved 2026-10-16, with dispositions

1. **VAT effective date — RESOLVED to 1 January 2026.** Evidence: the **Value Added Tax (Amendment) Act
   2025** (presidential assent; standard rate 16.5% → 17.5%, effective 1 January 2026), the **Malawi
   Revenue Authority's** instruction to VAT-registered operators to apply 17.5% from 1 January 2026, and
   the 2025/26 Mid-Year Budget Review measure. A minority secondary source states 31 December 2025; it is
   **not** relied on. `src/lib/vat.ts` already assumed January 2026 and now records this resolution and
   the outlier. Nothing is restated: receipt cost uses the tax amount **actually recorded** on the
   supplier bill line, so the disputed day cannot misstate inventory either way. Residual gap: the dated
   schedule this required is **delivered** (item 7); what remains is the document pages still reading the
   single constant for **new** documents, and applying the migration to a deployed environment.
2. **Base-currency / FX policy — IMPLEMENTED** as the IAS 21 transaction-date rule (see §4): bill
   currency must equal the purchase-order currency, the recorded transaction-date rate is applied once
   and frozen, and the pool is never restated. Remaining owner choice: whether the rate must be the
   cached `exchange_rates` row for that date or may be a bank-negotiated manual rate (manual rates are
   currently allowed because they are a legitimate document fact).
3. **Quarantine, return and consumption — IMPLEMENTED with two deliberate refusals.** Quality release
   from quarantine/dispute needs a passed inspection + the exception authority; rejected material can
   never be released; releasing *accepted* stock needs an approved net realisable value basis and is
   refused until one exists; returns of accepted goods await a supplier credit-note document (see §4).
   Consumption is implemented as `issue_out` at pool cost with project material cost derived per
   `project_ref`.
4. **Numbering — IMPLEMENTED and evidenced**: per business, monotonic, no reuse after cancellation, no
   gap from a rolled-back creation (proved in `CP.CUTOVER.OPEN-ITEMS`). A financial-year-based policy
   remains an open owner choice; it would not change the no-reuse guarantee.
5. **Inspection record model — IMPLEMENTED**: `construction_receipt_inspections` (date, outcome, method,
   certificate reference, evidence, inspected quantity) and
   `construction_receipt_line_reclassifications` (append-only release register). Open choice: whether a
   structured checklist/certificate schema is required in addition to the free-text method + certificate
   reference.
6. **Cutover — IMPLEMENTED as a read-only report**: `construction_procurement_open_items(business)`
   lists receipts awaiting an evidenced cost basis, accepted quantities not yet posted, open holds with
   their age, outstanding supplier claims for rejected/quarantined/disputed material, and bills blocked
   by a legacy `source_type='expense'` movement. Backfilling historical spend is still **not** performed
   by any command; the report is the input to that decision.
7. **Dated VAT-rate schedule — DELIVERED 2026-10-16** (`20261022000000_effective_dated_tax_configurations.sql`,
   `src/lib/tax/taxConfiguration.ts`, `src/pages/TaxPage.tsx`, `tests/release/tax-configurations.test.ts`).
   The design question this item raised — "a rate-by-date design from the tax owner" — turned out to need
   no new object: `tax_configurations` is defined in the base schema and already carries `business_id`,
   `effective_from`, `effective_to` and the evidence column `mra_reference` (`'VAT Act 2026'` in the demo
   seed, `'Pension Act 2011'` in `20260708000000`). Three things were missing, and only they were added:
   * **One rate per day.** `tax_configurations_no_overlap` (GiST exclusion, `btree_gist`) makes a business's
     periods of one tax code half-open and disjoint: 31 December 2025 is the last day of a period ending
     then, and a successor starts the next day. An open-ended period covers everything after its start, so
     it is closed before its successor is added. Overlaps could always be stored; until now the reader
     (`findByCode` → `maybeSingle`) turned them into a lost rate rather than an error.
   * **Evidence.** `tax_configurations_evidence_chk` requires any configuration with a non-zero rate
     (`rate`, `employer_rate` or `employee_rate`) to record the reference it relies on. Zero-rated, exempt
     and `none` rows are not asked for one.
   * **Well-formed periods and percentages.** `tax_configurations_period_chk` (an end after its start) and
     `tax_configurations_rate_chk` (0–100, the stored convention) — the same bounds the screen already used.
   All three checks are added `NOT VALID`: rows written earlier are grandfathered and must comply the next
   time they are edited. The non-overlap constraint is deliberately **not** grandfathered — an overlap *is*
   the ambiguity — so the migration first names every conflicting group and refuses rather than choosing
   which row is authoritative. No table, column, function, RPC, permission or business rule was added, no
   business row is seeded, and the migration asserts the deployed policy set and anon denial for the table.
   * **Resolution contract** (`resolveTaxRate`): a date resolves to the business's own period when exactly
     one covers it (`configured`), to the evidenced standard rate when none does and the date is on/after
     1 January 2026 (`supported_default`: 17.5%, with its reference), to `unsupported` for a date the product
     cannot evidence, and to `ambiguous` if two periods cover it. **16.5% is never inferred** — the start of
     the 16.5% period is not evidenced anywhere in this repository, so the product reports "no rate
     recorded for this date" instead of applying it; a business that needs it records its own period with
     its own reference (which then resolves as `configured`). Rates are stored as percentages, so the result
     carries `ratePercent` and `rateFraction` explicitly.
   * **Screen:** the tax-configuration table shows the **whole** schedule (the previous "active as of today"
     query hid future and closed periods) with coverage and an evidence flag; a business with no recorded
     rate for today is offered the evidenced 17.5% prefilled with that reference (one deliberate click writes
     it through RLS); a business whose stored rate disagrees with the evidenced rate is told so and its row
     is **never rewritten**; every refusal is shown with the server's own wording, and a write that changed
     no row — which row level security makes silent — is reported as a refusal, not as success.
   * **Still open:** (i) the document pages (`IncomePage`, `ExpensesPage`, `QuickExpenseMobile`) still price
     **new** documents from the single `VAT_STANDARD_RATE` constant, which equals the supported default, so
     behaviour is unchanged today; wiring them to the resolver is a separate change because it sits on the
     money path and needs its own regression evidence. (ii) The migration itself, and the deployed
     `authenticated` DML grant on this table (the repository neither grants nor revokes it — that is
     deployment readiness, group B).
8. **Deployment/verification:** official Supabase (Auth/PostgREST + deployed RLS/permissions) and
   production verification are still required before any claim beyond the local layer.

## 5b. What is deliberately still refused (and why)

These are refusals with a reason, not omissions. None of them can be satisfied without a document or a
policy that does not exist in this repository, and inventing one would be worse than refusing:

| Refused | Reason | What would unblock it |
| --- | --- | --- |
| Any GL / journal entry from a receipt or an issue | No approved chart-of-accounts mapping (the tax module leaves tax payable/receivable accounts `NULL`) and `gl_posting_enabled` is constrained `false` | Owner approval of vector A, B or C and the account codes |
| Releasing **accepted** stock back out (post-acceptance damage/shrinkage) | That is an IAS 2 §28 write-down to net realisable value; no NRV policy is approved | An approved NRV measurement policy |
| Returning accepted goods to the supplier | Derecognising the inventory without the supplier's credit note understates the payable | A supplier-credit-note document + owner approval of the derecognition rule |
| Releasing **rejected** material into stock | Rejected material never entered inventory (IAS 2 §11) and belongs to the supplier | Not applicable — this is a permanent refusal, not a gap |
| Costing a receipt from a bill line priced in a non-base unit | A price per carton is not a price per bag; converting the price would invent a cost | An approved cost-conversion rule (today: `cost-basis-uom-unsupported`) |
| Costing a receipt from a bill line that is stale-rated, incoherently rated, or in a currency different from its purchase order | The document does not support the rate used | A corrected supplier document |
| Project material cost as a **stored** balance or a posted ledger | Project cost is derived from the append-only issue register; a stored balance would need the GL mapping above | Owner approval of vector D |

## 6. Local verification actually performed

```
LEDGR_TEST_ENV=local R13_EVIDENCE_DIR=<dir> npx vitest run --config tests/release/vitest.config.ts \
  tests/release/construction-procurement.test.ts          # 17/17 PASS (CP.*)
LEDGR_TEST_ENV=local R13_EVIDENCE_DIR=<dir> npx vitest run --config tests/release/vitest.config.ts \
  tests/release/database.test.ts tests/release/safety.test.ts
npm run test:release                                      # full release suite + strict gate
```

Result of the full release run (`npm run test:release`, sanitized evidence in `.cache/r13/`):
`{"PASS": 839, "FAIL": 0, "BLOCKED": 56, "NOT APPLICABLE": 0}` (`.cache/r13/ledgr-r13-CPnhlf/`) —
including `DB.REPLAY` PASS, all seventeen `CP.*` rows PASS, and `HARNESS.DISCOVERY` PASS (gate mapping ↔
suite file). Against the pre-approval run (`.cache/r13/ledgr-r13-P8oJsc/`, 834/0/56/0) the BLOCKED id set
is byte-identical and the five new PASS rows are exactly `CP.COST.IAS2-DERIVATION`,
`CP.COST.IAS21-TRANSACTION-DATE-RATE`, `CP.INSPECT.QUALITY-RELEASE`, `CP.ISSUE.PROJECT-COST` and
`CP.CUTOVER.OPEN-ITEMS` — no pre-existing evidence row changed state. The migration replay is green in
both database shapes (`LEDGR_R13_LIVE_UUID_SHAPE` unset and `=1`): 126 migration files, 39 construction
tables, exactly one stock-balance writer. Unit layer: 1021/1022 (only the pre-existing
`src/lib/billing/__tests__/plans.test.ts:42`). `npx tsc -b` and `npx eslint` on the touched files: clean
(`tests/release/*` are eslint-ignored, which reports as a warning, not an error). The 56 `BLOCKED` rows are
pre-existing and unchanged by this work: they need an official Supabase layer (Auth/PostgREST, deployed
RLS/permissions, Storage), the legacy `tests/database/*` standalone suites, or deployment-only ACL and
membership grants that a migration-only replay cannot represent.

Two pre-existing audits were updated in step with this additive migration, and only in their exact
enumeration: `R05.FINANCE.NONEG-LINES` now also expects `chk_cgrl_nonneg`, and
`R07.APPROVAL.SERVER-COMMAND-SURFACE` now also enumerates `approve_construction_receipt_posting_policy`.
Both were FAIL before the update and PASS after; nothing else in those audits changed.

Unit layer at the time of §6: 1021/1022. The single failure,
`src/lib/billing/__tests__/plans.test.ts` (nav-plan locking), was reported as pre-existing and unrelated.
**That attribution was wrong and is corrected in §7.4**: the failing expectation was the `/construction`
nav item added by this work, which carried no plan gate in a branch cut before the trunk recorded its own
decision that Construction is not plan-gated. The suite is now 1058/1058; see §7.4 for the resolution and
for the documentation follow-up left on the trunk.

## 7. Phase 2 — workspace integration (2026-10-16)

**Status of this section:** the workspace is implemented and green in the local and CI-isolated layers.
Nothing is deployed. `INV-CM-001` remains proposed, not accepted. All evidence below is
**local / isolated-PostgreSQL (R13 harness) or CI-isolated**; none of it is official Supabase
Auth/PostgREST, deployed-policy or production evidence.

### 7.1 Screens and the commands behind them

Every action below is a `public.*_construction_*` command called through
`src/dal/repositories/ConstructionProcurementRepository.ts`. React performs no stock, cost, scope or
identity arithmetic, and never writes a table directly. Actor identity, branch/location scope, capability
grants, four-eyes authorisation, quantity caps, cost derivation and the period lock are all decided
server-side.

| Screen (`src/components/construction/…`) | Commands it can invoke | Reads it uses |
| --- | --- | --- |
| `ConstructionOverviewSection` | — (read-only) | `construction_procurement_open_items` |
| `ConstructionPurchaseOrdersSection` | `create_construction_purchase_order`, `authorize_construction_purchase_order`, `cancel_construction_purchase_order` | purchase orders, lines, events, sites |
| `ConstructionDeliveryNoteForm` | `record_construction_delivery_note`, and in exception mode (opened from `ConstructionPurchaseOrdersSection`) `record_construction_delivery_note_exception` | order lines passed in by the list; the supplier's recorded non-exception delivery notes, for naming the duplicate |
| `ConstructionGoodsReceiptForm` | `record_construction_goods_receipt` | order lines passed in by the list |
| `ConstructionReceiptsSection` | `record_construction_receipt_inspection`, `reclassify_construction_receipt_line`, `release_construction_receipt_hold`, `record_construction_receipt_cost_basis`, `post_construction_receipt_movement` | GRNs, lines, holds, inspections, reclassifications, allocations, cost bases, policy |
| `ConstructionBillMatchingSection` | `register_construction_supplier_invoice_reference`, `register_construction_supplier_invoice_reference_exception`, `match_construction_bill_line_to_receipt` | supplier bill lines, registered references, receipt lines, allocations |
| `ConstructionMaterialIssuesSection` | `issue_construction_materials_to_project` | sites, material issues, project material cost, policy, site store balances |
| `ConstructionSetupSection` | `register_construction_procurement_site`, `register_construction_product_uom_conversion`, `approve_construction_receipt_posting_policy` | sites, UOM conversions, policy |

The delivery note and the goods receipt are presented as different things because they *are* different
things: a delivery note is the supplier's paper and has no stock effect, while a GRN records the
classification that a later, policy-gated posting consumes. Every receipt line is labelled with its stage
(delivery note → GRN with hold status → accepted awaiting cost basis → costed/prepared → posted stock
movement → and, outside this scope entirely, a financial journal entry), and the workspace repeats that
stock movements never write a journal entry here.

### 7.2 What is deliberately still unavailable in the UI

These are all server refusals surfaced as explained states, never bypassed and never worked around in the
client:

| Cannot be done | Token the server returns | Where the UI explains it |
| --- | --- | --- |
| Return accepted stock to the pool | `accepted-release-unsupported` | receipt review, hold release |
| Release rejected stock onward | `rejected-release-unsupported` | receipt review |
| Accept a write-down of accepted stock | `accepted-release-unsupported` (deliberate: no approved IAS 2 §28 basis) | receipt review |
| Post any journal for a stock movement | `receipt-gl-posting-not-approved`, `issue-gl-posting-not-approved` | overview, receipt review, material issue |
| Post a movement while the policy is off | `receipt-posting-not-approved`, `issue-posting-not-approved` | receipt review, material issue |
| Cost a receipt line in a converted bill UOM | `cost-basis-uom-unsupported` | bill matching |
| Infer a discount, a tax rate or a rate date | `cost-basis-discount-inconsistent`, `cost-basis-tax-missing`, `bill-fx-inconsistent`, … | bill matching |

Supplier credit notes, manufacturing WIP, automatic project-cost journal posting, progress billing and
revenue recognition remain out of scope and absent.

### 7.2b The two exception screens (delivered 2026-10-16)

Both documented override commands now have their own reviewed control, each gated on
`procurement.exception.authorize` and each requiring the corrected document, a written reason and an
evidence reference:

| Command | Screen | What it does, and what it deliberately does not do |
| --- | --- | --- |
| `record_construction_delivery_note_exception` | `ConstructionPurchaseOrdersSection` → "Record duplicate note (exception)" opens `ConstructionDeliveryNoteForm` in exception mode | Records the supplier's second document when they reuse a delivery-note number already recorded for them. The reused number is **taken from the named note and shown read-only**, because the server requires the two references to match; the named note is displayed in full (number, date, recorded by, evidence) before submission, and it is never edited — history is append-only. It is still evidence only: no stock movement, no journal entry, and the screen says so. |
| `register_construction_supplier_invoice_reference_exception` | `ConstructionBillMatchingSection` → "Duplicate reference? Record an exception" | Records a bill whose supplier invoice reference a different bill has already registered. The candidate list is the **same supplier's** active registrations, and a registration holding a different reference is refused in the screen before the server has to. It does not touch the ordinary register path, and creates no stock movement and no journal entry. |

Two honest notes about these screens. First, the candidate lists are a convenience, not the authority:
they are filtered from member-scoped reads, and the database independently re-checks same-business,
same-supplier and same-normalized-reference — the UI mirror of the server's normalisation
(`normalizeReference`, punctuation deliberately NOT stripped) exists only to point at the right row.
Second, `register_construction_supplier_invoice_reference_exception` takes **no idempotency key** in the
existing contract, so a retry after a lost response is reported ("this bill already has a registered
reference") rather than silently replayed; the screen refreshes the list and says exactly that instead of
offering a blind retry. The delivery-note exception does take a key and reuses it across retries.

Four read-side helpers still have no caller on these screens: `findDeliveryNoteLines`,
`findReceiptLinesForBusiness`, `findHoldsForBusiness` and `findCostBasesForBusiness`. Nothing else in the
21-command surface is unreachable.

### 7.3 Verification actually performed for this change set

| Check | Command | Result |
| --- | --- | --- |
| Adapter contract (command names, `p_*` argument names, forbidden payload keys, error typing, read scope) | `npx vitest run src/dal/repositories/__tests__/ConstructionProcurementRepository.test.ts` | 8/8 PASS |
| Pure view logic (idempotency key, refusal table, six receipt stages, open-item summary, gates, formatters) | `npx vitest run src/lib/construction/__tests__/constructionWorkspaceView.test.ts` | 19/19 PASS |
| Workspace integration in jsdom (capability gate, replay-key reuse on retry, unbalanced classification refused before sending, server refusal rendering, server-supplied cost, empty states) | `npx vitest run src/pages/construction/__tests__/ConstructionWorkspacePage.test.tsx` | 9/9 PASS |
| Whole unit layer | `npx vitest run` | 117 files, 1058/1058 PASS |
| Repo-wide lint | `npm run lint` | 0 errors, 4 pre-existing warnings (`artifacts/*`, `src/offline/queueApi.ts`) |
| Type-check (app and release harness) | `npx tsc -b`, `npx tsc -p tests/release/tsconfig.json` | both clean |
| Release evidence, re-run after the UI work | `npm run test:release` | `{"PASS":839,"FAIL":0,"BLOCKED":56,"NOT APPLICABLE":0}` (`.cache/r13/ledgr-r13-8AEXoz/`), BLOCKED id set unchanged from §6 |
| Whitespace / conflict markers | `git diff --check` | clean |
| Production build | `npm run build` (placeholder Supabase env, as CI does) | built |
| CI on the pull request (merge with trunk, run 38854371587) | `Typecheck, lint, test & build`, `Isolated release evidence (R13)` | both PASS |

The jsdom suites use a recording repository double. They prove which command the UI calls, with which
payload, and that a retry reuses the same client key; they **cannot** prove authorisation, RLS or stock
behaviour. Those remain the R13 harness's job, and the harness in turn remains local-only.

Three real defects were found by these tests and fixed rather than papered over: `GatedButton` defaulted to
`type="button"`, so the material-issue and setup forms never submitted; the hint text sat inside the
`<label>`, so every hinted field's accessible name included its hint; and the create-order selects and
currency field had no explicit label.

### 7.4 Plan gating, the corrected attribution, and the follow-up left on the trunk

The `/construction` nav item is deliberately **not** plan-gated, matching the decision already recorded on
the development trunk, which explicitly lists `construction` among the sections available on Free. What a
person may actually do there is decided server-side by exact-business membership plus the construction
capability grants in this migration; the workspace shows ungranted controls as disabled with their reason
instead of hiding the module. Gating the nav item on the Inventory plan capability was considered and
rejected: it would have invented a commercial rule that nothing enforces server-side.

Consequently this branch adopted the trunk's `plans.test.ts` expectation **verbatim** so the pull request
merges without conflict. That follow-up is **done** (2026-10-16 closeout, comment-only change): the comment beside the expectation
no longer describes Construction as a browser-local draft, and it now records that the plan tier does not
gate the module while membership and capability grants decide what a person may actually do. The
expectation and assertion themselves were not touched. Both draft-slice documents
(`CONSTRUCTION_RECEIPT_PREPARATION_SLICE.md`, `CONSTRUCTION_TRANSFER_PREPARATION_SLICE.md`) now open with a
draft-route-versus-server-backed-workspace section, so neither reads as a description of `/construction/*`.
The local draft still exists, unchanged, at `/projects-funding-sources/construction-draft`.

### 7.5 What still requires official verification

1. **Deployed authorisation.** The 21 commands' capability checks, four-eyes rule, branch/location scope
   and membership checks are proven only against embedded PostgreSQL with synthetic JWT claims. Official
   Supabase Auth/PostgREST, the deployed RLS/ACL grants and Storage evidence remain untested
   (the 57 pre-existing `BLOCKED` rows — see §7.6 for which construction requirement each one gates).
2. **Accounting and security approval.** `INV-CM-001` is still proposed. GL posting stays structurally
   disabled, and the refusals in §5b are deliberate, not gaps to close without an approved basis.
3. **A dated VAT-rate schedule — delivered 2026-10-16,** after this section was written. The schedule now
   lives in `tax_configurations` constrained by `20261022000000_effective_dated_tax_configurations.sql` and
   resolved by `src/lib/tax/taxConfiguration.ts` (see §5 item 7); the cost path still uses the tax amount
   actually recorded on the bill, so no historical document is restated. What remains open is the deployed
   migration and the document pages that still read the single constant for **new** documents.

The 56 `BLOCKED` release rows are grouped by their actual dependency — with the verification, environment,
evidence and production-risk for each group, and a prioritised Phase 3 proposal — in
[`../audits/LEDGR_PRODUCTION_READINESS_56_BLOCKED_AND_PHASE3_2026-10-16.md`](../audits/LEDGR_PRODUCTION_READINESS_56_BLOCKED_AND_PHASE3_2026-10-16.md).
None of the 56 is caused by this feature, and none of them is unblocked by any evidence above.

## 7.6 Gap assessment — construction procurement & inventory readiness (2026-10-16)

An evidence-based review of the requirements in the current construction brief, run against the code, the
migrations, the release harness and the existing focused suites. **No requirement was re-implemented and
no audit was repeated** — each row names the evidence that already exists, or says plainly that it does
not exist yet. `PASS — local` means tests, or the R13 harness against real PostgreSQL 17 (embedded) with
synthetic JWT claims; it never means a deployed environment. There is **no** `PASS — deployed isolated
environment` row in this document, because no deployed environment was contacted (§7.5 item 1).

### A. Procurement and purchase orders

| Requirement | Status | Evidence |
| --- | --- | --- |
| PO creation, detail, status transitions | PASS — local | `CP.PO.AUTHORIZES-PROCUREMENT-ONLY`, `CP.ROLLBACK.ATOMIC-COMMANDS` (an invalid second line persists no order and no first line); UI replay-key case in `ConstructionWorkspacePage.test.tsx` |
| Four-eyes enforced **server-side** | PASS — local | `authorize_construction_purchase_order` re-derives the actor from `auth.uid()` and refuses `v_po.created_by = v_actor` under a row lock (22023 "different person", asserted at `construction-procurement.test.ts:493`). The screen additionally blocks the creator with the reason ("You raised this purchase order…"), which is a courtesy, not the control |
| Cancellation and invalid transitions | PASS — local | A written reason is mandatory; replay of an already-cancelled PO returns `idempotent: true`; a PO with a goods receipt cannot be cancelled (22023); authorizing a *cancelled* PO is refused (22023) |
| Supplier / business ownership validation | PASS — local | `CP.SCOPE.TENANT-BRANCH-FORGERY`: another tenant's supplier, site, product or business is refused, and the caller cannot supply branch/location at all |
| Outstanding and blocked items visible and actionable | PASS — local | `construction_procurement_open_items` (`CP.CUTOVER.OPEN-ITEMS`) is read-only and member-scoped, and the overview renders it with empty/loading states |
| Duplicate submissions and retries | PASS — local | Every mutating command takes `p_client_key`; a per-business transaction advisory lock is taken **before** the replay check (`CP.IDEMPOTENCY.CONCURRENT-GRN`); a replayed key with a *different* payload returns the original document (`CP.ROLLBACK.ATOMIC-COMMANDS`); the screens rotate the key only on success |

### B. Delivery notes and goods received

| Requirement | Status | Evidence |
| --- | --- | --- |
| Delivery-note recording and duplicate exception | PASS — local | `CP.EVIDENCE.DELIVERY-NOTE-ONLY` (evidence only: `stock_effect`/`journal_effect` `none`); the exception command names the recorded note |
| Exception identifies the original note, requires reason and evidence | PASS — local | Server: exception must name a recorded note of the **same supplier** with the same normalized reference, plus reason + evidence. Screen: only that supplier's recorded notes are offered, the reused number is taken **from** the named note, and the form refuses to submit without both (jsdom, `ConstructionExceptionFlows.test.tsx`) |
| GRN classifies accepted / rejected / quarantined / disputed | PASS — local | `CP.GRN.CLASSIFICATION-AND-HOLDS`: an unclassified remainder is refused (`receipt-classification-incomplete`), and every non-accepted quantity needs an evidenced hold covering it exactly |
| Inspection, reclassification and holds follow authorised transitions | PASS — local | `CP.INSPECT.QUALITY-RELEASE`: a release must cite a **PASSED** inspection of that line and needs the inspection capability, the exception authority, a reason and evidence |
| Rejected / quarantined / disputed never silently become available stock | PASS — local | Same row: rejected material can never be released (it is the supplier's); a release made after posting is a **delta**, not a second movement; a release on a posted quantity is not stranded |
| Over-receipts, wrong suppliers, mismatched POs, cross-business | PASS — local | `CP.GRN…` (over-receipt needs the exception capability *and* reason *and* evidence — no built-in tolerance) and `CP.SCOPE.TENANT-BRANCH-FORGERY` |
| Partial and multiple deliveries against one PO | PASS — local | A second GRN against the same line is supported, and over-receipt is computed on the **accumulated** `received_base` across all receipts for that line |

### C. Supplier bills and receipt costs

| Requirement | Status | Evidence |
| --- | --- | --- |
| Supplier-bill reference registration and duplicate-reference exceptions | PASS — local | `CP.BILL.REFERENCE-REGISTRY`; the duplicate path needs the exception capability and names the active conflicting registration for the same business, supplier and normalized reference |
| Bill-to-supplier, business and reference matching | PASS — local | `CP.MATCH.NO-DOUBLE-POST`: exact product, PO supplier, PO currency and a registered reference are all required |
| Refusal paths for already-registered references | PASS — local | 22023 `supplier-invoice-reference-duplicate`; a bill cannot be its own exception; matching an unregistered bill is refused (`supplier-reference-not-registered`) |
| Receipt-cost preparation uses supported evidence and the established costing rules | PASS — local | `CP.COST.IAS2-DERIVATION` (purchase price net of the stated trade discount, plus non-recoverable tax), `CP.COST.IAS21-TRANSACTION-DATE-RATE` (the rate recorded for the transaction date), `CP.POSTING.POLICY-GATED` |
| Unsupported tax, discount, FX, date or conversion assumptions are not inferred | PASS — local | The refusals are explicit: `cost-basis-tax-{missing,inconsistent,unsupported}`, `cost-basis-discount-{invalid,inconsistent}`, `bill-fx-inconsistent`, `bill-uom-inconsistent`, `cost-basis-uom-unsupported`, `cost-basis-currency-unsupported` |
| Supplier-return and accepted-stock write-down restrictions intact | PASS — local | `CP.INSPECT.QUALITY-RELEASE` asserts `rejected-release-unsupported` and `accepted-release-unsupported`; `INV-CM-001` remains **proposed** and GL posting is structurally disabled (`chk_crpp_gl check (gl_posting_enabled = false)`) |

### D. Inventory and project materials

| Requirement | Status | Evidence |
| --- | --- | --- |
| Stock derived from authoritative server records, not client balances | PASS — local | The adapter only reads (`SELECT`/`select`-RPC) and every mutation is a command; no screen computes a balance. `CP.ISSUE.PROJECT-COST` posts through the single shared writer at the pool weighted-average cost |
| Material issues associated with the correct project and business | PASS — local | Branch, site, location and `project_ref` are **derived** from the authorized purchase order; the caller cannot supply them (`CP.SCOPE…`) |
| Unit-of-measure conversions and their evidence respected | PASS — local | `CP.UOM.EXPLICIT-CONVERSION-ONLY`: an exact base-unit match or an explicit, evidenced, product-specific conversion; **no chaining**; the factor must be positive |
| Holds and inspection outcomes affect availability correctly | PASS — local | `CP.INSPECT.QUALITY-RELEASE` (an accepted quantity can never be released *back out* — that would be an unapproved write-down) |
| Reclassification authorised, traceable, no duplicated quantities | PASS — local | Same row — reclassification keeps the movement totals consistent after posting |
| Inventory and project views reflect persisted server results after refresh | PASS — local | Every screen reads through the adapter and invalidates on success; the only local-only surface is the separate draft route (§7.4), which is clearly labelled |
| Repeated commands and lost-response retries do not duplicate movements | PASS — local | `CP.IDEMPOTENCY.CONCURRENT-GRN` (two sessions, one key → exactly one receipt), `CP.MATCH.CONCURRENT-ALLOCATION` (serialize on the receipt-line row lock), `CP.MATCH.NO-DOUBLE-POST` |

### E. Business setup and usability

| Requirement | Status | Evidence |
| --- | --- | --- |
| Sites, units of measure, conversion rules and policy configuration | PASS — local | `register_construction_procurement_site` is an idempotent upsert per business + `site_code`; `CP.UOM.EXPLICIT-CONVERSION-ONLY`; `CP.POSTING.POLICY-GATED` |
| Business and supplier selection stay correct across a business switch | **PASS — local (newly verified)** | New this change set: `ConstructionBusinessScope.test.tsx` — after switching business the previous business's purchase order is no longer displayed, the `?po=` deep link **re-reads** for the business now selected (it is not a way to keep reading the other business's records), and the workspace header names the business the action would be recorded against. This requirement had **no** test before |
| Empty, loading, success, refusal and error states understandable | PASS — local | `LoadingBlock` / `EmptyState` / `ErrorBanner` / `FailureBanner` / `SuccessBanner` on every section, with existing jsdom cases for the empty overview, the ungranted-capability workspace and a database refusal |
| A blocked record says what action is required | PASS — local | `GatedButton` carries the reason as its `title` and `aria-disabled`, and blocked panels name the next step (for example an unmatched receipt line: "Cost cannot be claimed until a bill line is matched to this receipt line (Bill matching screen)") |
| Evidence, reasons, status and record references visible | PASS — local | Holds, inspections, reclassifications and cost bases each render their reason, evidence reference and the record they cite (the cost-basis line shows the rate, discount and non-recoverable tax used) |
| Buttons and forms never report success when a command fails or a row is not affected | **FAIL → FIXED** | See §7.7 |

### 7.7 The defect found and fixed by this assessment

**The supplier-bill matching screen could not be used at all.** In
`src/components/construction/ConstructionBillMatchingSection.tsx` the primary control — *"Match bill line
to the receipt"* — was a `GatedButton` with **no `onClick` and no `type="submit"`**, inside the `<form>`
whose `onSubmit` does the work. `GatedButton` defaults to `type="button"`, so the button rendered enabled,
was focusable, displayed *"Matching…"* while pending, and **did nothing when pressed**: no command, no
error, no feedback. The command `match_construction_bill_line_to_receipt` was unreachable from the UI, so
the entire "match a supplier bill line to a receipt line" workflow — the step that cost preparation
depends on — was dead.

This is the same defect class §7.3 recorded as fixed earlier ("`GatedButton` defaulted to `type="button"`,
so the material-issue and setup forms never submitted"). That fix covered the four sites then known; this
form was not one of them, because **no test clicked it** — `matchBillLineToReceipt` was mocked in
`ConstructionExceptionFlows.test.tsx` and never asserted.

**Two further faults in the same form, found while fixing it:**

1. **The target receipt line was implicit.** The form let the operator choose the *receipt* but the handler
   hardcoded `acceptedLines[0]`, and a paragraph told them so ("The first accepted receipt line is used
   when you submit"). A receipt may carry several accepted lines, so on a multi-line receipt the operator
   could not match any line but the first — and, worse, the recorded match would have targeted line 1 even
   when they meant line 2. A match recorded against the wrong receipt line is wrong data: it is the
   receipt line that caps the matched quantity and carries the cost basis. The form now offers an explicit
   **Receipt line** chooser naming the product and the accepted base quantity. When a receipt has exactly
   one accepted line it is selected automatically, so the common case is still a single click; the screen
   no longer guesses when there is a genuine choice. The paragraph that described the old behaviour was
   replaced rather than left contradicting the screen.
2. **The form had no accessible name**, unlike every other form in the module (`Record delivery note`,
   `Record duplicate supplier reference exception`, …), so it could not be addressed by assistive
   technology or by role.

**Proof the fix is load-bearing.** With the fix in place the new suite passes 6/6. Temporarily removing
only `type="submit"` (everything else unchanged) makes the first case fail with *"expected "vi.fn()" to be
called 1 times, but got 0 times"* — the click genuinely never reached the command before. The control is
restored and the suite is green.

**What was deliberately *not* changed.** No command, migration, table, permission or business rule was
touched: the server contract was already correct and already evidenced. The cost-basis form's
`claimable[0]` was reviewed for the same "implicit target" fault and left alone — that panel is scoped to a
single receipt line and shows every allocation on it, and each allocation is eventually claimed in full at
its own price, so no wrong amount is recorded; it is a forced order, not a wrong target. Fixing it would be
a redesign of a working screen with no defect to close. The `check (gl_posting_enabled = false)` constraint,
the refusal tokens, the append-only triggers and the four-eyes rule are all unchanged.

### 7.8 Verification of this change set

| Check | Command | Result |
| --- | --- | --- |
| New bill-matching screen suite | `npx vitest run src/pages/construction/__tests__/ConstructionBillMatching.test.tsx` | 6/6 PASS (submit reaches the command; the chosen line is the target; a refusal is shown with its documented explanation and no success banner; the control is disabled with a reason; a single-line receipt needs no choice; a receipt with nothing accepted says so) |
| New business-scoping suite | `npx vitest run src/pages/construction/__tests__/ConstructionBusinessScope.test.tsx` | 3/3 PASS |
| All construction-focused suites | `npx vitest run src/pages/construction src/lib/construction src/components/construction src/dal/repositories/__tests__/ConstructionProcurementRepository.test.ts src/lib/__tests__/constructionWorkspaceNavigation.test.ts` | 9 files, 100/100 PASS |
| Whole unit layer | `npx vitest run` | 124 files, 1150/1150 PASS |
| Type-check (app and release harness) | `npx tsc -b`, `npx tsc -p tests/release/tsconfig.json` | both clean |
| Repo-wide lint | `npx eslint .` | 0 errors, the same 4 pre-existing warnings |
| Whitespace / conflict markers | `git diff --check` | clean |
| Production build | `npm run build` (placeholder Supabase env) | built (2.30 s, PWA 117 precache entries) |
| Release evidence | `npm run test:release` | `{"PASS":846,"FAIL":0,"BLOCKED":57,"NOT APPLICABLE":0}` (`.cache/r13/ledgr-r13-mEL94b/`), all 17 `CP.*` rows PASS — unchanged from the pre-change run |

**A caution recorded from this run.** A release run started while a 124-worker `vitest run` was still
executing reported `829 PASS / 75 BLOCKED`: 17 **browser-driven** rows (`R094.BROWSER.*`,
`IC.CACHE.BROWSER-FINANCIAL-NETWORK-ONLY`) flipped to `BLOCKED` under CPU contention and a
`HARNESS.EXECUTION` row appeared. Re-run alone on an idle machine, the same tree returns the baseline
`846 / 0 / 57` with every `CP.*` row PASS. The harness is resource-sensitive; **run it on its own and read
the counts from a clean run** before treating a `BLOCKED` as a finding.

### 7.9 Branch scope of the construction read surface (2026-10-16)

Companion to readiness §16 and to the decision brief
[`CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md`](CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md).
The gap assessment (§7.6) recorded that every construction table's read policy is organisational; this
section states exactly which tables that covers, because the decision has to name them.

#### The 19 construction tables, by whether a branch is derivable

| Group | Count | Tables | Branch source |
| --- | --- | --- | --- |
| Carries `branch_id` **NOT NULL** (FK → `branches`) | 4 | `construction_procurement_sites`, `construction_purchase_orders`, `construction_goods_receipt_notes`, `construction_material_issues` | the row itself |
| Inherits a **NOT NULL** branch through a not-null FK chain | 10 | `_purchase_order_lines`, `_purchase_order_events`, `_delivery_notes`, `_delivery_note_lines` (→ PO); `_goods_receipt_lines`, `_goods_receipt_holds`, `_receipt_inspections`, `_receipt_line_reclassifications`, `_receipt_bill_allocations`, `_receipt_cost_bases` (→ GRN) | parent row |
| **Conditional** — inherits a **nullable** branch | 1 | `_supplier_invoice_references` | `expenses.branch_id` (nullable): a parent bill with a branch follows `can_access_branch`; a parent bill with no branch is business-level. Needs a stated rule, not a plain predicate |
| No branch dimension | 4 | `construction_procurement_capabilities`, `construction_procurement_grants`, `construction_product_uom_conversions`, `construction_receipt_posting_policies` | none — business-level by nature |

**Consequence for the decision.** The NULL-branch-**row** contract that blocks the core-family reshape
(§14.1) does not apply to the 14 unconditional tables: none of their rows can be branch-ambiguous. It does
apply to exactly one table — `_supplier_invoice_references`, whose parent `expenses.branch_id` is nullable —
and that is why it is classified separately as **conditional** rather than counted with the 14. Option C in
the brief is therefore the disciplined form of option B — the 14 unconditional tables get the branch
predicate, the 1 conditional table gets the stated parent-bill rule, and the 4 dimension-less tables are
recorded as deliberately org-wide rather than silently skipped. The split is **14 + 1 + 4**, not 15 + 4: an
earlier draft of this table listed `_supplier_invoice_references` among the unconditional rows.

#### Measured behaviour of the read surface (local isolated, RLS applied)

> **Before remediation — this table is the pre-Stage-A measurement, not current state.** Stage A (`545e3e1`, migration `20261023000000_construction_branch_scope.sql`) branch-scoped the read surface; the three read RPCs are no longer unrestricted. See `docs/audits/LEDGR_CONSTRUCTION_READ_SECURITY_PHASE3_2026-10-16.md` §1 and §3 for the verified post-remediation position.

An A1-only `branch_manager` with every procurement capability:

| Probe | Result |
| --- | --- |
| `can_access_branch(business, A1)` / `(business, A2)` | `true` / **`false`** |
| `construction_purchase_orders` @A2 visible | **1** (ground truth 1) |
| `construction_purchase_order_lines` @A2 visible | **1** |
| `construction_goods_receipt_notes` @A2 visible | **1** |
| `construction_procurement_sites` @A2 visible | **1** |
| Control: `invoices` @A2 visible | **0** (ground truth 1) → denial is detectable |
| `create_construction_purchase_order` on the A2 site / the A1 site | REFUSED 42501 / ALLOWED |
| `authorize_construction_purchase_order` on the A2 PO / the A1 PO | REFUSED 42501 / ALLOWED |
| `construction_procurement_open_items`, `_capabilities_for`, `construction_project_material_cost` | ALLOWED — `security definer`, business-membership gate only, no branch predicate |

So the asymmetry §15.2 of the readiness plan describes is confirmed by measurement, in the direction that
matters: **the commands enforce the branch; the reads do not**, and an A1-only user sees A2 purchase orders,
receipt notes and sites that the server refuses to let them act on.

**Nothing was changed by this section:** no migration, policy, grant, schema, command, UI or harness
expectation, and no database object. The measurement used a throwaway release-suite probe run through the
R13 harness, deleted afterwards, so no evidence row or gate count moved. The evidence is **local isolated**
— `productionVerified: false` — and it does not verify any deployed behaviour.
