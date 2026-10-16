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

## 5. Owner decisions — approved 2026-10-16, with dispositions

1. **VAT effective date — RESOLVED to 1 January 2026.** Evidence: the **Value Added Tax (Amendment) Act
   2025** (presidential assent; standard rate 16.5% → 17.5%, effective 1 January 2026), the **Malawi
   Revenue Authority's** instruction to VAT-registered operators to apply 17.5% from 1 January 2026, and
   the 2025/26 Mid-Year Budget Review measure. A minority secondary source states 31 December 2025; it is
   **not** relied on. `src/lib/vat.ts` already assumed January 2026 and now records this resolution and
   the outlier. Nothing is restated: receipt cost uses the tax amount **actually recorded** on the
   supplier bill line, so the disputed day cannot misstate inventory either way. Residual gap: the rate
   is a single constant, so a future statutory change still needs the dated-rate schedule below.
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
7. **New item surfaced while implementing the above — single-constant VAT rate.** The rate is a constant,
   not a dated schedule; a statutory change mid-period requires a rate-by-date table (the repo's
   `tax_configurations` is per business and holds `mra_reference` + `effective_from`, so that is the
   natural home, but it needs a rate-by-date design from the tax owner). Until then the receipt-cost path
   is unaffected because it never recomputes tax.
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

Unit layer (`npx vitest run`): 1021/1022 pass. The single failure,
`src/lib/billing/__tests__/plans.test.ts` (nav-plan locking), is pre-existing and unrelated — it touches
`src/components/layout/navConfig.ts` and `src/lib/billing/plans.ts`, neither of which this work changes.
