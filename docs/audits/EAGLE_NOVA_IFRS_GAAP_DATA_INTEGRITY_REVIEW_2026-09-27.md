# Eagle Nova Horizon Holdings Ltd — data-integrity and IFRS/GAAP review

**Review date:** 2026-09-27 UTC  
**Scope:** repository-attached diagnostics, incident/audit reports, repair SQL, schema/migration evidence and the recorded Eagle Nova production observations.  
**Conclusion type:** preliminary control review; **not an audit opinion, assurance engagement, or certification of IFRS or US GAAP compliance**.

## Executive conclusion

The available evidence identifies material issues that must be addressed before Eagle Nova's ledger, inventory valuation, or financial statements are treated as reliable:

- **Inventory balances and valuation are not currently proven reliable.** A dual-trigger defect double-counted balances for an unknown period. The stock ledger and balance sub-ledger diverged, and the divergence was not automatically posted to the general ledger.
- **The specific chicken-manure incident is consistent with one recorded receipt of 160 bags and a balance of 320**, but this conclusion is conditional on the production diagnostic returning the documented `pure_double_count` signature rather than duplicate ledger rows or opening-stock drift. The repair SQL is appropriately scoped in principle, but a production repair migration also rewrote Eagle Nova balances/average cost without a stock movement or journal, creating an audit-trail gap.
- **Revenue, receivables, COGS and payment completeness are not fully reliable by design/history.** The evidence records swallowed COGS failures, non-atomic payment recording, orphan invoice headers, client-authoritative POS totals and a backfill that treated draft/void/credit-note invoices as sales.
- **The statement-of-financial-position fixed-asset issue was corrected**, but the historical failure was a silent 1,000-row API truncation. Eagle Nova's reported non-current assets were later verified at **23,850,000** from 1,641 journal lines, including 14,500,000 motor vehicles, 850,000 computer equipment and 8,500,000 land. This should still be tied to the underlying journal and fixed-asset register.
- **IFRS/US GAAP compliance cannot be confirmed from the attached material alone.** The system has accounting templates and controls that are directionally compatible with both frameworks, but data completeness, posting accuracy, period close, disclosures, impairment, tax and supporting schedules remain unverified.

**Overall rating: RED — do not rely on the affected periods for external reporting without reconciliation and management review.**

## Evidence-linked findings

| ID | Area | Finding | Assessment | Priority |
|---|---|---|---|---|
| EN-01 | Inventory quantity | Two additive stock-balance triggers were present in production. The documented symptom was 160 recorded versus 320 on hand. | Confirmed design/incident finding; exact affected period and all affected SKUs are not yet established. | P0 |
| EN-02 | Inventory valuation | The Eagle Nova repair migration set `quantity_on_hand` to ledger quantity and recalculated `average_cost` using a lifetime inbound average, without a compensating movement or journal. | Quantity may be corrected, but provenance and WAC/COGS continuity are weakened. Lifetime average may not equal the required moving-average carrying amount. | P0 |
| EN-03 | Inventory-to-GL | Balance corrections and the dual-trigger overstatement had no corresponding GL entries. | Inventory sub-ledger, inventory control account and COGS may not reconcile. | P0 |
| EN-04 | Inventory reconciliation | `backfill_and_recalculate_inventory` did not filter invoice status/type and could post sales for draft, void and credit-note documents; reproduction reduced stock from 10 to 1. | Can materially understate inventory and distort COGS; no journals are posted by the RPC. | P0 |
| EN-05 | COGS | A prior POS path swallowed COGS posting exceptions and allowed sale completion. | Revenue/sale may exist without corresponding COGS and inventory credit; gross profit is overstated. | P0 |
| EN-06 | Revenue/totals | POS totals and line prices were client-computed and accepted by the server with limited validation. | Cut-off, occurrence, accuracy and VAT/revenue calculations require substantive testing. | P1 |
| EN-07 | Receivables/payments | Payment insertion and amount/status/journal updates were non-atomic; a retry could leave payment rows without the corresponding invoice balance update. | `amount_paid`, payment totals, aging and status may disagree. | P1 |
| EN-08 | Completeness | Failed invoice-line insertion could leave orphan headers and consume invoice numbers. | Invoice population and sequence completeness need a direct database test. | P1 |
| EN-09 | Fixed assets | Eagle Nova's SOFP previously showed zero non-current assets because the API silently truncated 1,641 journal lines at 1,000. | Current pagination fix is positive, but report output must be reconciled to journals and the fixed-asset register. | P1 |
| EN-10 | Evidence/provenance | Production was modified by CI/manual repair activity, and the exact production migration history/snapshot was not available to the review. | Chain of custody and change provenance are incomplete. | P0 |
| EN-11 | Access/control | AI branch context could expose another branch's figures to restricted roles; direct invoice and stock writes also remain architectural residuals. | Confidentiality and segregation-of-duties issue; not itself an IFRS measurement issue, but affects control reliance. | P1 |
| EN-12 | Reporting reads | Historical service-worker caching could show up to 24-hour-old financial data; this was later addressed for financial resources. | Prior user-facing reports may not represent the database at the time of review. | P1 |

## IFRS and US GAAP assessment

### 1. Inventory — IAS 2 / ASC 330

**Requirement direction:** inventory should be recorded from supported quantities and costs, measured consistently, and written down when carrying amount exceeds recoverable/realizable value. IFRS IAS 2 generally uses the lower of cost and net realisable value; US GAAP ASC 330 generally uses lower of cost and net realizable value for qualifying inventory measured by FIFO/average cost, with LIFO permitted in US GAAP but not IFRS.

**Assessment:** the application’s moving-average/WAC approach can be an acceptable cost formula where consistently applied, but the evidence does not establish that Eagle Nova’s quantities and WAC are correct after the trigger incident and repair. The following are open:

1. Reconcile every Eagle Nova `inventory_balances` row to the complete `stock_movements` ledger by product and location.
2. Reconcile inventory sub-ledger value to the inventory GL account and COGS for every affected period.
3. Reconstruct WAC chronologically from each inbound movement; compare it with stored `average_cost` and the repair migration output.
4. Test NRV/obsolescence and slow-moving inventory at each reporting date.
5. Confirm that drafts, voids, credit notes, returns and transfers are excluded or reversed according to their accounting status.

**Status:** **Not demonstrated compliant** with IAS 2 / ASC 330 for affected periods.

### 2. Revenue — IFRS 15 / ASC 606

**Requirement direction:** revenue is recognised when control/performance obligations and the transaction price criteria are met; variable consideration, returns, credits, VAT/sales taxes and cut-off must be handled appropriately.

**Assessment:** the records show a POS workflow that accepted client-computed totals and had status/payment/line-integrity failure modes. Draft, void and credit-note treatment was also unsafe in inventory backfill. Therefore occurrence, accuracy, cut-off, completeness and presentation of revenue cannot be inferred from invoice headers alone.

**Status:** **Control design insufficient for reliance without transaction-level testing.**

### 3. Cost of sales and gross profit — IAS 2 / ASC 330, with IFRS 15 / ASC 606 linkage

A completed sale without a successfully posted COGS/Inventory entry causes gross margin and inventory to be misstated. The documented swallowed COGS exception is a direct financial-reporting risk. The newer fail-closed remediation is directionally correct, but it does not repair historical transactions.

**Required:** identify every Eagle Nova sale in the affected window, compare invoice lines to stock issues, test the existence of a matching COGS and inventory journal, and post approved correcting entries with an audit trail where exceptions are confirmed.

### 4. Property, plant and equipment — IAS 16 / ASC 360

The reported fixed-asset totals are a positive remediation result, but compliance requires more than a non-zero report: existence, rights, capitalization policy, componentization where material, depreciation, useful lives, residual values, impairment and disposals must be supported. The attached evidence does not include the fixed-asset register, invoices, titles or depreciation schedule.

**Status:** **Reported balance restored; accounting-policy compliance not verified.**

### 5. Financial statements, estimates and disclosures — IAS 1 / IAS 8 / IAS 7 and US GAAP presentation/disclosure guidance

The evidence does not establish a controlled period-close process, full correction of prior-period errors, inventory write-downs, related parties, commitments/contingencies, cash-flow classification, subsequent events, deferred/current tax, foreign exchange or going-concern assessment. These are required to conclude on financial statements and are outside what application-level evidence can prove.

## Data-integrity tests required before sign-off

Run read-only tests against a preserved production snapshot, not directly against live data:

1. **Population:** all Eagle Nova businesses/products/locations, invoices, invoice lines, payments, expenses, stock movements, inventory balances, journal entries and journal lines.
2. **Uniqueness/idempotency:** duplicate `client_key`, duplicate source references, duplicate payments, duplicate stock receipts, duplicate journal posting keys.
3. **Cross-table equality:** invoice totals versus line extensions, payment sum versus `amount_paid`, amount due versus total less paid, journal debits versus credits.
4. **Inventory roll-forward:** opening quantity + receipts + transfers + adjustments − issues/returns = closing quantity by SKU/location/date.
5. **Inventory-to-GL:** quantity × approved cost and inventory journal balances by reporting period.
6. **COGS completeness:** every posted stock issue/sale has one approved COGS entry and every COGS entry has a supported sale/issue.
7. **Document status:** no draft, void or credit-note document contributes to sales or stock consumption unless the accounting policy explicitly requires a controlled reversal.
8. **Cut-off:** transactions around month/year end, including offline replay and late payments.
9. **Fixed assets:** agree the 23,850,000 reported non-current asset balance to journal lines, register, additions, depreciation and impairment.
10. **Audit trail:** capture `schema_migrations`, trigger/function definitions, repair-run logs, database audit logs and a hash of the snapshot before any correction.

## Corrective action plan

### Immediate — before reporting

- Freeze further repair SQL and preserve a read-only, repeatable-read production snapshot.
- Confirm the live database column shape and migration history; the attached evidence identifies a production/repository UUID-versus-text divergence that caused some POS, refund, shift-close and quick-save paths to fail.
- Produce an exception report for all Eagle Nova inventory drift, not only manure.
- Block period close and external reporting for affected periods until inventory, COGS and receivables are reconciled.

### Short term

- Rebuild Eagle Nova inventory balances and WAC from the movement ledger under an approved accounting policy; use documented adjusting journals where a balance rewrite has already occurred.
- Repair historical COGS/payment/invoice exceptions through controlled, reviewed commands. Do not silently mutate balances.
- Add server-side recomputation and validation of POS line totals, tax, discounts and invoice totals.
- Make all accounting commands atomic and idempotent, and fail closed on missing COGS/journal creation.
- Add period locks, approval controls and an immutable correction/audit trail.

### Reporting sign-off

Management should obtain an accountant/auditor decision on: applicable statutory framework (IFRS as adopted locally versus US GAAP), functional/presentation currency, inventory cost formula, VAT treatment, revenue policy, capitalization thresholds, depreciation/impairment policy, materiality and whether prior-period restatement or error correction is required.

## Limitations

This review used repository evidence and recorded production observations; it did not connect to or independently query the live database, inspect source documents, confirm bank balances, verify tax returns, or test every Eagle Nova transaction. The business is named both **“Eagle Nova Horizon Holdings Ltd”** in the request and **“Eagle Nova Horizon Holdings Ltd. Co.”** in repository evidence; the legal entity name and business UUID must be confirmed before any report or correction is issued. No conclusion above should be read as an audit opinion or a statement that the entity is compliant with IFRS or US GAAP.

## Remediation applied in this review

A forward-only migration, `20261016000000_inventory_backfill_status_safety.sql`, has been added. It replaces the unsafe inventory reconciliation function so that:

- draft and void expenses cannot create purchase movements;
- draft, void and credit-note invoices cannot create sale or opening-balance movements;
- only invoice/debit-note document types are eligible for sales backfill;
- existing data is not silently rewritten by the migration; and
- all new movements continue to flow through the canonical balance trigger rather than direct balance updates.

The repository already contains additional containment migrations for atomic COGS failure handling, atomic/idempotent payments, atomic invoice creation, server-side POS arithmetic validation, financial-read cache bypass, period locking and UUID-shape corrections. Those migrations address future transactions; they do **not** repair Eagle Nova’s historical balances, COGS, payments or journals.

### Still requiring controlled production/accounting action

The remaining data corrections cannot safely be performed from source code alone. They require an approved production snapshot and management/accounting sign-off before execution:

1. quantify all Eagle Nova inventory drift by product/location/date;
2. reconstruct WAC and COGS from the movement ledger;
3. reconcile inventory to the GL and identify missing COGS entries;
4. reconcile invoice totals, payments and receivables;
5. agree any correcting journal entries or prior-period error treatment; and
6. verify the fixed-asset register and the 23,850,000 non-current-asset balance.
