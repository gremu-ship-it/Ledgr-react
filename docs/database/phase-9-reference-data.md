# Phase 9.2 — Reference Data Governance: Malawi PAYE

**Status:** RESEARCH COMPLETE — values identified and classified; **migration
PENDING APPROVAL** (per Phase 9.2: "Create a reviewed reference-data migration
only after the values are approved").

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

## 7. Draft reference-data migration — PENDING APPROVAL ⛔

> **Not yet created as a migration file.** Per Phase 9.2, this is the
> candidate that becomes `supabase/migrations/2026XXXX_phase9_paye_reference_data.sql`
> **only after approval** (a human with authority over Ledgr's reference data
> must confirm the values in §3).

Candidate design (deterministic, idempotent, no customer data, auditable,
never overwrites customised rows):

```sql
-- Phase 9.2 — Malawi PAYE reference data (approved 2025/26 mid-year rates)
-- Effective 30 Dec 2025; current for FY 2026/27.
-- Idempotent: inserts bands ONLY for businesses/years that have none.
-- Does NOT update or delete existing paye_bands rows (customised configs
-- are preserved). Values: see docs/database/phase-9-reference-data.md §3.
insert into public.paye_bands
  (business_id, band_from, band_to, band_label, rate, fiscal_year,
   effective_from, effective_to)
select b.id, v.band_from, v.band_to, v.band_label, v.rate, '2026/27',
       '2026-01-01'::date, null
from public.businesses b
cross join (values
  (0::numeric, 170000::numeric, '0%', 0::numeric),
  (170000.01, 1570000, '30%', 30),
  (1570000.01, 10000000, '35%', 35),
  (10000000.01, null, '40%', 40)
) as v(band_from, band_to, band_label, rate)
where b.deleted_at is null
  and not exists (
    select 1 from public.paye_bands p
    where p.business_id = b.id and p.fiscal_year = '2026/27'
  );
```

Post-approval steps: create the migration, replay all migrations on the
disposable database, then run the payroll calculation tests (§8) against the
approved bands.

## 8. Payroll calculation test plan (after approval)

| Case | Gross/month | Expected PAYE (per §3) |
|---|---|---|
| Below threshold | 150,000 | 0 |
| At threshold | 170,000 | 0 |
| 500,000 | 500,000 | (500,000−170,000)×30% = 99,000 |
| 2,000,000 | 2,000,000 | (1,570,000−170,000)×30% + (2,000,000−1,570,000)×35% = 420,000 + 150,500 = 570,500 |
| 12,000,000 | 12,000,000 | 420,000 + (10,000,000−1,570,000)×35% + (12,000,000−10,000,000)×40% = 420,000 + 2,950,500 + 800,000 = 4,170,500 |
| Open top band | verified | band_to NULL handled |

These exact cases are added to `tests/database/paye_reference.test.js` once
the migration is approved.

## 9. Classification summary

| Item | Classification |
|---|---|
| PAYE bands (0/170k, 30%→1.57m, 35%→10m, 40%+) | [VERIFIED] — 5 sources incl. MCCCI quoting MRA |
| VAT 17.5% | [VERIFIED] — and already in the app |
| Pension 5%/10% | [VERIFIED] — already in the app (`tpr_pension`) |
| TEVETA 1%, bank levy 0.05% | [VERIFIED as real levies] — NOT modelled; documented limitation |
| Any statutory value in the DB before approval | **NOT INSERTED** |
