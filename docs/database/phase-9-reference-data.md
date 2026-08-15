# Phase 9.2 — Reference Data Governance: Malawi PAYE

**Status:** ✅ **APPROVED 2026-08-15** by the Ledgr stakeholder, and the
reference-data migration is created (`20260816000000_phase9_paye_reference_data.sql`)
with all Phase 9.2 governance requirements (deterministic, idempotent, no
customer data, effective dates documented, preserves customised business
configurations).

## 1. Applicable statutory tax period

- **Current period:** 2026/27 fiscal year (1 July 2026 – 30 June 2027).
- The governing PAYE structure is the one introduced by the **2025/26
  Mid-Year Budget Review** (announced November 2025), effective **30 December
  2025**, per the Malawi Revenue Authority (MRA) statement signed by
  Commissioner General Felix Tambulasi.
- As of **2026-08-15**, no source indicates a further PAYE change for the
  2026/27 year. **Re-verify against MRA before each new tax year.**

## 2. Authoritative sources

| # | Source | Type | Date | Agrees |
|---|---|---|---|---|
| 1 | MCCCI (Malawi Confederation of Chambers of Commerce and Industry), "Mid-Year Budget Tax Measures Come into Effect", quoting the MRA statement | Malawian business chamber, MRA statement | 2026-01-05 | ✅ |
| 2 | myworkpay.com, "Malawi: 2026 Statutory Changes" | payroll platform | 2026-01-13 | ✅ |
| 3 | afrotools.com, "Malawi PAYE Calculator 2026" | payroll calculator | 2026-03-28 | ✅ |
| 4 | smartlinkerp.com, "PAYE MRA Calculator Malawi 2026" | payroll platform | 2026 (current) | ✅ |
| 5 | headoffice.app, "What You Need to Know About Malawi Payroll Tax" | payroll platform | 2026-03-01 | ✅ |
| — | globallawexperts.com, "Commercial Lawyers Malawi 2026" | legal blog | 2026-05-07 | ❌ **outlier** (claims a 3-band structure with a K970,000 boundary; contradicted by all five sources above and by the MRA statement) |

**Verdict:** the 4-band structure below is **[VERIFIED]** — five independent
sources including the Malawian chamber of commerce quoting the MRA statement
agree. The single outlier is rejected because it contradicts the MRA-statement
citation and all other sources.

## 3. Verified PAYE bands (monthly, MWK) — effective 30 Dec 2025

| band_from | band_to | rate | Notes |
|---|---|---|---|
| 0 | 170,000 | 0% | tax-free threshold (raised from K150,000) |
| 170,000.01 | 1,570,000 | 30% | 25% bracket removed |
| 1,570,000.01 | 10,000,000 | 35% | |
| 10,000,000.01 | NULL (open) | 40% | top rate reintroduced |

- **Classification:** [VERIFIED] — statutory values from the cited sources.
- **Effective date:** 2025-12-30 (applies to salary paid from 30 Dec 2025).
- **Ledgr fiscal-year label** (per `src/lib/fiscalYear.ts`): the current
  fiscal year is `2026/27` (starts July). PAYE bands are stored per
  `fiscal_year` in `paye_bands`.

## 4. Related statutory parameters

| Parameter | Value | Source | Classification |
|---|---|---|---|
| VAT (standard rate) | **17.5%** (raised from 16.5%) | MCCCI article (same MRA statement) | [VERIFIED] — and **already implemented** in the app: `effectiveVatRate = 0.175` in IncomePage/ExpensesPage/QuickExpenseMobile |
| Employee pension (min) | 5% of pensionable emoluments | Pension Act (via payroll sources) | [VERIFIED] — Ledgr already seeds `tpr_pension` with employer 10% / employee 5% (`20260708000000`, PayrollRepository auto-create) |
| Employer pension (min) | 10% of pensionable emoluments | Pension Act | [VERIFIED] — same |
| TEVETA levy | 1% (employer) | headoffice.app | [VERIFIED as a real levy] — **NOT modelled in Ledgr's payroll schema** (no TEVETA column) → documented limitation, not inserted |
| Bank transfer levy | 0.05% (sender) | MCCCI article | [VERIFIED as a real levy] — **NOT modelled** → documented limitation |

## 5. Model fit (can `paye_bands` represent the statutory bands?)

| Requirement | paye_bands column | Fit |
|---|---|---|
| Lower bound | `band_from numeric NOT NULL` | ✅ |
| Upper bound (open top) | `band_to numeric NULL` | ✅ (open-ended top band — TaxRepository handles `band_to = null`) |
| Rate | `rate numeric NOT NULL` | ✅ |
| Period | `fiscal_year text`, `effective_from date`, `effective_to date` | ✅ |
| Per-business customisation | `business_id` | ✅ (each business may override — migration must NOT overwrite customised rows) |
| Band label (optional) | `band_label text` | ✅ |

**Verdict: the existing data model can represent the verified bands.**

## 6. Default tax configurations for a new business

Evidence from the repository (`PayrollRepository.ts`):
- `tpr_pension` config is **auto-created** on first payroll approval when
  missing (10% employer / 5% employee, effective_from '2011-01-01',
  `tax_payable_account_id` auto-resolved to account 2132 "Pension Payable"
  or a `%pension%` match). [VERIFIED]
- `paye` config is looked up (not auto-created); payroll requires
  `tax_configurations.tax_payable_account_id` for PAYE and TPR before
  approving. [VERIFIED]
- **Gap:** no `paye_bands` rows exist on a fresh business → PAYE computes 0
  until bands are added. This is what the approved reference-data migration
  fixes.

## 7. Approved reference-data migration — `20260816000000_phase9_paye_reference_data.sql`

**IMPORTANT — Ledgr stores ANNUAL bands.** Ledgr's payroll model
(`src/lib/paye.ts` + `PayrollPage`) applies bands to `gross × 12` and returns
monthly tax, so `paye_bands.band_from/band_to` are **annual** amounts. The
migration therefore stores the **annual equivalents** of the gazetted monthly
bands (monthly × 12):

| band_from (annual) | band_to (annual) | rate | monthly equivalent |
|---|---|---|---|
| 0 | 2,040,000 | 0% | ≤ 170,000 |
| 2,040,000 | 18,840,000 | 30% | 170,001–1,570,000 |
| 18,840,000 | 120,000,000 | 35% | 1,570,001–10,000,000 |
| 120,000,000 | NULL | 40% | > 10,000,000 |

Properties (all required by Phase 9.2):
- deterministic, idempotent (re-apply adds nothing — tested);
- no customer data;
- effective_from `2025-12-30` (statutory date), fiscal_year `2026/27`;
- inserts ONLY for (business, fiscal_year) pairs with **no** existing bands —
  customised configurations are never overwritten or deleted (tested with a
  custom-band business);
- sanity guard: no business may end with more than 4 bands for the year.

The app's fallback constant `FALLBACK_PAYE_BANDS` (`src/lib/paye.ts`) was
updated to the same approved structure so **new businesses** without DB bands
compute the correct PAYE too (previously it held the obsolete pre-2026 rates —
a latent defect, now fixed and pinned by tests).

## 8. Payroll calculation test results (approved) — 10/10 PASS

`tests/database/paye_reference.test.js` (62-migration replay):
- 4 approved bands seeded for a default business (0/30/35/40, effective
  2025-12-30) ✅
- custom business bands preserved (not overwritten) ✅
- idempotent re-apply ✅ · top band open-ended ✅ · sanity guard ✅

| Case | Gross/month | Expected PAYE | Actual | Result |
|---|---|---|---|---|
| Below threshold | 125,000 | 0 | 0 | ✅ |
| At threshold | 170,000 | 0 | 0 | ✅ |
| 500,000 | 500,000 | 99,000 | 99,000 | ✅ |
| 2,000,000 | 2,000,000 | 570,500 | 570,500 | ✅ |
| 12,000,000 | 12,000,000 | 4,170,500 | 4,170,500 | ✅ |

Unit tests (`src/lib/__tests__/paye.test.ts`, 12 cases) pin the same
arithmetic incl. marginal-band boundaries and monotonicity.

**Model note (documented, not changed):** the app computes PAYE on gross
salary (pension is deducted after PAYE in net pay). The MRA framework permits
employee pension as a pre-PAYE deduction; Ledgr's existing model does not do
that. This is a business-logic decision for Ledgr ownership, NOT a reference-
data defect — flagged for the release review.

## 9. Classification summary

| Item | Classification |
|---|---|
| PAYE bands (0/170k, 30%→1.57m, 35%→10m, 40%+) | [VERIFIED] — 5 sources incl. MCCCI quoting MRA; **APPROVED 2026-08-15; migration created** |
| VAT 17.5% | [VERIFIED] — and already in the app |
| Pension 5%/10% | [VERIFIED] — already in the app (`tpr_pension`) |
| TEVETA 1%, bank levy 0.05% | [VERIFIED as real levies] — NOT modelled; documented limitation |
| Any statutory value in the DB before approval | **NOT INSERTED** |
