# LEDGR — Multi-Organisation / Multi-Business-Type Architecture Audit

**Date:** 2026-09-27
**Branch audited:** `arena/01a0e2d8-ledgr-react` (from `main` @ `4d9aa63`)
**Scope:** Architecture, database schema, RLS/RPCs/Edge Functions, routing, navigation,
onboarding, POS, inventory, invoicing, expenses, contacts, AI, subscriptions, org settings.
**Status:** AUDIT + PROPOSAL ONLY. **No application code changed.** This document is the
first deliverable requested; implementation must not begin until the design below is approved.

> **Verdict up front.** Ledgr does **not** need to become several applications and does
> **not** need a rewritten accounting engine. It already has (a) a single double‑entry
> financial engine every module posts into, (b) a clean, central, capability‑driven
> navigation/gating system, and (c) a product/service dimension. The gap is that the
> *organisation's own nature* (for‑profit vs non‑profit, retail vs service vs project) is
> **never captured** and therefore cannot drive configuration. The recommended change is
> **additive**: introduce an organisation‑profile + capability layer that sits *beside* the
> existing subscription and partner gating, and add a small NGO/project dimension to the
> ledger. Everything else is reuse.

---

## Table of contents

1. Current architecture summary
2. Current organisation/business model
3. Current database structure relevant to this change
4. Assumptions that restrict Ledgr to particular business types
5. Proposed organisation profile model
6. Proposed capability / module model
7. Core vs optional feature matrix
8. Proposed NGO architecture
9. Proposed retail architecture
10. Proposed wholesale architecture
11. Proposed product/service architecture
12. Proposed onboarding flow
13. Proposed navigation model
14. Proposed reporting model
15. Permission / RLS impact
16. Subscription impact
17. Migration strategy
18. Backward compatibility assessment
19. Security risks
20. Financial integrity risks
21. Recommended target architecture
22. Implementation phases
23. Test / acceptance scenarios
24. Files / tables / components / functions that would change
25. Files / tables / components that should NOT change
26. Architectural decisions requiring human approval

---

## 1. Current architecture summary

| Layer | Implementation |
|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind 4, react-router 8 |
| State | TanStack Query, Zustand (`src/store/useAppStore`), React Hook Form + Zod |
| Data access | Repository-pattern DAL (`src/dal/repositories/*`), one class per aggregate |
| Backend | Supabase Postgres + Auth + **RLS-first**, 25 Edge Functions (Deno) in `supabase/functions/` |
| Offline | PWA + Dexie offline queue (`src/offline/`) with idempotent semantic operations |
| Billing | PayChangu (MWK), plan tiers on the `businesses` row |
| White-label | Partner (bank/MFI) tenants with per-partner feature toggles |

**Multi-tenancy.** Every domain table carries a `business_id uuid not null` FK to
`businesses(id)` and has RLS enabled. Tenancy is consistent and strong — this is the single
most important pre-existing property for this initiative, because it means new
organisation types are *rows*, not *deployments*.

**The financial engine is already unified.** `journal_entries` + `journal_lines` form one
double-entry ledger. POS sales, invoices, invoice payments, expenses, expense payments,
payroll runs, fixed-asset depreciation, capital/financing, inventory (perpetual COGS) and
FX revaluation **all post into the same journals** via RPCs
(`20260815000000_phase8b_reconstruct_rpcs.sql`, `src/services/journalService.ts`,
`inventoryJournalService.ts`, `posSaleRpc.ts`, `CapitalJournalService.ts`,
`FixedAssetsJournalService.ts`). Reports (`FinancialStatementRepository`, `IncomeRepository`,
`v_cash_flow` view) read from this ledger. **There is exactly one accounting model.** This
directly satisfies requirement §11 already — no separate accounting systems exist.

**Feature gating already exists and is central**, on three orthogonal axes:

1. **Subscription capability** — `src/lib/billing/plans.ts` defines `PlanCapability`
   (`inventory`, `core_accounting`, `accounting_organisation`, `bank_reconciliation`,
   `ai_insights`, `api_access`, `webhooks`, `custom_branding`), cumulative per `plan_tier`.
   Gated in the UI by `<PlanGate capability=…>` and in nav via `requiresCapability`/`minPlan`.
2. **Partner feature toggle** — `src/types/partners.ts` `PartnerFeatureKey`
   (`ai_advisor`, `payroll`, `inventory`, `multi_currency`, `bank_reconciliation`),
   resolved by `usePartner().isFeatureEnabled(key)` and `<PartnerPlanGate>`.
3. **Role permission** — `src/hooks/usePermissions.ts` (19 roles → capability booleans) plus
   `isPathAllowedForRole(role, path)`, mirrored server-side by `user_has_role()` and
   capability helpers in RLS (`20260728000008/09`).

Navigation is **already generated dynamically** from a declarative config
(`src/components/layout/navConfig.ts` → `visibleSectionsFor()`), filtered by partner feature
+ role, with per-item capability/plan locks. **This is the key architectural asset:** the
extension point for organisation-driven capabilities is a single, well-defined layer, not
"hundreds of components".

---

## 2. Current organisation/business model

**Creation.** `RegisterPage` → `signUp` → `/create-business` (`CreateBusinessPage.tsx`), a
4-step wizard: (1) legal identity, (2) contact/location, (3) financial settings, (4)
branding/numbering + terms. It calls the RPC `create_business_with_owner(...)` which inserts
the `businesses` row, the owner `business_users` row, seeds the chart of accounts, and writes
an audit event. Then it redirects to `/import`.

**Fields that identify a business** (`businesses` table): `name`, `trading_name`,
`registration_number`, `tpin`, `vat_number`, `vat_registered`, `base_currency`,
`financial_year_start`, `timezone`, address/contact, `brand_color`/`logo_url`, numbering
prefixes/counters, `coa_template`, `plan_tier`/`plan_expires_at`, `is_active`, `deleted_at`.

**`business_id` consistency:** ✅ Consistent everywhere (every table + RLS).

**Is there a business type / category field?** ❌ **No.** There is no
`organisation_type`, `business_model`, `industry`, `sector`, or `enabled_capabilities`
column anywhere on `businesses`. The closest existing signal is `coa_template`
(`'gaap' | 'ifrs'`), which is an *accounting layout*, not an organisation type, and is
**hardcoded to `'gaap'`** by `create_business_with_owner` (the wizard never lets the user
choose it). (Note: `idx_ledgr_contacts_business_type` is an index on
`contacts(business_id, contact_type)` — unrelated to organisation type.)

**Where org metadata lives:** the `businesses` row, editable via
`SettingsPage` tabs (`business`, `financial`, `appearance`, …) through `BusinessRepository`.
The Settings page already has a tab structure that a "Profile / Organisation type" tab slots
into cleanly.

---

## 3. Current database structure relevant to this change

67 application tables. Classification against this initiative:

### Universal / core (keep as core — every organisation type)
`businesses`, `business_users`, `user_profiles`, `profiles`, `currencies`, `exchange_rates`,
`accounts` (chart of accounts), `journal_entries`, `journal_lines`, `accounting_periods`,
`accounting_period_events`, `audit_log`, `budgets`, `budget_lines`, `contacts`, `branches`,
`departments`, `tax_configurations`, `business_terms_acceptances`, subscription tables
(`subscription_payments`, `subscription_reminders_sent`), API/webhook tables.

### Sales / receivables (optional module: SALES/INVOICING)
`invoices`, `invoice_lines`, `invoice_payments`, `invoice_approvals`,
`invoice_approval_policies`, `invoice_delivery_events`, `recurring_invoices`.

### POS / retail-specific (optional module: POS)
`pos_settings`, `pos_terminals`, `pos_shifts`, `pos_shift_closes`,
`pos_shift_late_adjustments`, `pos_cash_movements`, `pos_price_overrides`, `pos_approvals`,
`pos_corrections`.

### Products / inventory-specific (optional module: PRODUCTS / INVENTORY)
`products`, `product_categories`, `inventory_locations`, `inventory_balances`,
`stock_movements`, `stock_transfers`, `stock_transfer_lines`.

### Purchases / expenses (optional-but-near-universal: EXPENSES)
`expenses`, `expense_lines`, `expense_payments`. (Universal in practice — every org spends.)

### Payroll (optional module: PAYROLL)
`employees`, `employee_allowances`, `employee_deductions`, `payroll_runs`,
`payroll_employee_lines`, `paye_bands`.

### Fixed assets / capital (optional module)
`fixed_assets`, `asset_categories`, `depreciation_schedules` (capital/share tables handled by
services).

### Banking (optional module)
`bank_statements`, `bank_statement_lines`.

### NGO / grant / project-specific
**None exist.** No `projects`, `grants`, `funding_sources`, `donors`, `funds`,
`restricted_funds`, `advances`, `liquidations`, or `activities` tables. This is the only
genuinely missing data domain.

### Already-present dimensional substrate (important for NGO/branch/segment reporting)
- `journal_entries.branch_id` and `journal_entries.department_id` — the ledger is already
  **dimensional**.
- `departments.cost_centre` — cost-centre concept already exists.
- `budgets` / `budget_lines` already carry `account_id`, `branch_id`, `department_id` and
  monthly buckets `m01_amount … m12_amount` with `annual_total` → **budget-vs-actual by
  dimension already possible**.
- `branches` → multi-branch/outlet is already a first-class feature.
- `contacts.contact_type` (free text), `credit_limit`, `credit_terms_days`, `currency` →
  customers **and** suppliers **and** (potentially) donors already share one table.
- `products.product_type ('product'|'service')` + `products.track_inventory` → product vs
  service already modelled.
- `invoice_lines.product_id` **nullable** + `invoice_lines.account_id` → a line may be a
  product, a service, or a free-form GL-coded line → **mixed product+service invoices are
  already possible**.

> **Do not redesign the database.** The core ledger, dimensional columns, product/service
> split, and mixed-line invoicing are already correct. The only new tables justified by this
> audit are a **small NGO/project foundation** (§8) and **profile/capability columns on
> `businesses`** (§5–6).

---

## 4. Assumptions that restrict Ledgr to particular business types

Ranked by how much they block the multi-org goal.

| # | Assumption / restriction | Evidence | Impact |
|---|---|---|---|
| A1 | **Organisation nature is never captured.** Onboarding asks only legal/financial/branding; there is no "what type of organisation are you?" | `CreateBusinessPage.tsx` (4 steps), `create_business_with_owner` | Nothing downstream can adapt to org type. Root cause. |
| A2 | **COA template hardcoded to `gaap`.** For-profit trading chart is always seeded; no fund-accounting / NGO chart exists. | RPC line `'gaap'`; `seedChartOfAccounts.ts` has only `ifrs`/`gaap` | NGOs get a shop's chart of accounts. |
| A3 | **POS is always present, ungated by capability.** `/pos` sits in the "overview" nav section with no `requiresCapability`, and the `/pos` route has no `PlanGate`. Only role gating applies. | `navConfig.ts` overview section; `App.tsx` `/pos` route | A service firm / NGO sees POS as a primary nav item. There is no `pos` capability at all. |
| A4 | **No project/grant/donor/fund domain.** | schema (none found) | NGOs cannot represent donor→grant→project→budget→expenditure. |
| A5 | **For-profit terminology is fixed** ("Income", "profitable"/"loss" on dashboard, "Customers"/"Suppliers"). | `DashboardPage.tsx` profit/loss labels; i18n keys | NGO users see profit framing; no "Surplus/Deficit", "Donors", "Grantors". |
| A6 | **Capabilities are keyed only on subscription tier + partner**, not on the organisation's own configuration. | `plans.ts`, `navConfig.ts`, `PartnerPlanGate` | An org cannot turn modules on/off to match how it operates (only pay a tier). |
| A7 | Onboarding checklist assumes a sales/product path ("Add products", "Create first invoice", "Record first transaction"). | `OnboardingChecklist.tsx` | Guidance is product/sales-centric for all orgs. |

**Assumptions that turned out to be FALSE (good news — no work needed):**

- ❌ "Every org must sell products" — **not enforced.** Products/inventory are already behind
  the `inventory` capability + partner toggle; services already exist.
- ❌ "Every org has inventory" — **not enforced.** `track_inventory=false` for services;
  inventory nav gated by capability.
- ❌ "Every org uses one accounting system" — **false in the good direction**; there is one
  shared ledger, exactly as the target requires.
- ❌ "Sales/POS duplicate the ledger" — **false**; both post through the same journal RPCs.

---

## 5. Proposed organisation profile model

Adopt the multi-dimensional model from the brief (§2). One broad `business_type = "retail"`
field is explicitly **rejected** because it cannot express combinations (e.g. retail + product
+ service; NGO + project + grant).

Add to `businesses` (all **nullable / defaulted**, additive, non-destructive):

```
businesses
  ├── organisation_type   text   -- FOR_PROFIT | NON_PROFIT | NGO | GOVERNMENT | OTHER
  ├── business_models      text[] -- RETAIL, WHOLESALE, PRODUCT_SALES, SERVICE_SALES,
  │                                --  PRODUCT_AND_SERVICE, PROJECT_BASED, GRANT_FUNDED, MIXED
  ├── industry             text   -- GENERAL_TRADING, AGRICULTURE, CONSTRUCTION,
  │                                --  PROFESSIONAL_SERVICES, HEALTH, EDUCATION,
  │                                --  MANUFACTURING, HOSPITALITY, TRANSPORT, OTHER
  └── enabled_capabilities jsonb  -- resolved capability map (see §6)
```

Rationale:
- **Three independent dimensions** (type / models[] / industry) allow every combination in
  the brief. `business_models` is an **array** so "product + service" or "NGO + project +
  grant" are single rows.
- **`organisation_type`** drives *accounting posture* (for-profit → Profit & Loss / "profit";
  non-profit → Statement of Income & Expenditure / "surplus/deficit"; fund accounting).
- **`business_models`** drives *default capability derivation* at onboarding.
- **`industry`** is advisory (defaults, AI prompts, terminology hints); it must not gate
  security or accounting.
- **`enabled_capabilities`** is the *resolved, editable* capability set — the single source of
  truth the app reads (§6). Keeping it as an explicit column (rather than re-deriving from
  models each render) means an admin can toggle an individual capability without changing the
  business model, exactly as §7 requires.

**Why not a separate `organisation_profiles` table?** A 1:1 profile could be a separate table,
but these are low-cardinality attributes of the business itself, edited on the Settings
"Business" area, and read on nearly every capability check. Columns on `businesses` keep RLS
trivial (they inherit the row's existing policies), avoid an extra join on the hot path, and
are the smallest safe change. **Decision D1 (§26).**

DB change: **yes** (additive columns). RLS: **no new policy** (inherits `businesses`).
Existing customers: **safe** (defaults, §17). Breaks businesses: **no**.

---

## 6. Proposed capability / module model

Introduce an **organisation capability layer** that composes with — never replaces — the
existing subscription and partner layers.

**Effective capability = subscription allows AND partner allows AND organisation enables AND role permits.**

```
Effective(feature) =
      planHasCapability(plan_tier, feature)        // can they pay for it?   (plans.ts)
  AND partnerFeatureEnabled(feature)               // does the white-label allow it? (partners)
  AND orgCapabilityEnabled(feature)                // does THIS org use it?  (NEW: enabled_capabilities)
  AND roleAllows(feature)                          // may THIS user touch it? (usePermissions/RLS)
```

Proposed capability keys (superset spanning modules; some already exist as `PlanCapability`):

```
core_finance      (always true — income/expenditure, expenses, accounts, reports, budgets)
sales             invoicing / revenue capture
pos               point of sale                              (NEW capability, see A3)
inventory         products + stock                            (exists)
services          service items on invoices                   (NEW; product/service already in data)
suppliers         AP / purchasing
customers         AR / customer management
contacts          (exists via accounting_organisation)
projects          NGO/consulting project tracking             (NEW)
grants            grant / funding-source tracking             (NEW)
donor_reporting   donor/funder statements                     (NEW)
budgets           (exists in data; expose as capability)
banking           bank reconciliation                         (exists: bank_reconciliation)
payroll           (exists as partner feature)
ai_insights, api_access, webhooks, custom_branding            (exist)
```

**Implementation shape (single choke point, not scattered `if`s):**

- A `src/lib/capabilities/` module: `OrgCapability` type, `DEFAULT_CAPABILITIES_BY_MODEL`
  map, and `resolveCapabilities(models, type)` used only at onboarding/settings write time to
  seed `enabled_capabilities`.
- A `useCapability(key)` hook (reads `enabled_capabilities` from the current business in the
  Zustand store) and a `<CapabilityGate capability=…>` component **mirroring the existing
  `PlanGate`/`PartnerPlanGate`**.
- Extend `navConfig.ts` `NavItemConfig` with an optional `requiresOrgCapability` and teach
  `visibleSectionsFor()` to also filter on it — **one function changes**, all nav surfaces
  (desktop sidebar, `MobileDashboard`) inherit it.
- Compose in `PartnerPlanGate` so route-level gating stays a single wrapper.

Explicitly **avoid** `if (business.type === 'ngo')` in components — that pattern is banned by
§7 and is unnecessary because the resolver produces booleans.

DB change: **yes** (`enabled_capabilities` jsonb, §5). RLS: **no** (feature ≠ permission).
Customers: **safe** (defaults derived from current plan/partner so behaviour is unchanged).

---

## 7. Core vs optional feature matrix

Derived from what the code *actually* gates today plus the target org types. "core" = always
on; "cap" = behind an org capability toggle (default shown); "—" = off by default.

| Feature | For‑profit | NGO/Non‑profit | Retail | Wholesale | Product | Service |
|---|---|---|---|---|---|---|
| Income / Revenue capture | core | core (contributions) | core | core | core | core |
| Expenses | core | core | core | core | core | core |
| Chart of accounts / Journals | core | core | core | core | core | core |
| Financial reports | core | core | core | core | core | core |
| Contacts | core | core | core | core | core | core |
| Budgets | cap (on) | **cap (on)** | cap | cap | cap | cap (on) |
| Invoicing | cap (on) | cap (opt) | cap (on) | cap (on) | cap (on) | cap (on) |
| Customers (AR) | cap (on) | cap (opt) | cap (on) | cap (on) | cap (on) | cap (on) |
| Suppliers (AP) | cap (on) | cap (on) | cap (on) | cap (on) | cap (on) | cap (opt) |
| Inventory | cap (opt) | — | **cap (on)** | **cap (on)** | **cap (on)** | — |
| POS | cap (opt) | — | **cap (on)** | cap (opt) | cap (opt) | — |
| Services (as items) | cap (opt) | cap (opt) | cap (opt) | — | cap (opt) | **cap (on)** |
| Projects | cap (opt) | **cap (on)** | — | — | — | cap (on) |
| Grants / funding sources | — | **cap (on)** | — | — | — | cap (opt) |
| Donor reporting | — | **cap (on)** | — | — | — | — |
| Payroll | cap (opt) | cap (opt) | cap (opt) | cap (opt) | cap (opt) | cap (opt) |
| Bank reconciliation | cap (opt) | cap (opt) | cap (opt) | cap (opt) | cap (opt) | cap (opt) |

This is the **default derivation table**, not a hard rule — every cell is overridable per org
in Settings (that is the whole point of `enabled_capabilities`). Subscription tier still caps
what is *reachable* (e.g. `inventory` needs Starter+, per `plans.ts`).

---

## 8. Proposed NGO / non-profit architecture

Goal: represent Donor → Grant → Project → Budget → Activities → Expenses → Report **without a
second accounting system**. Reuse the existing dimensional ledger.

**Minimum viable additions now (small, additive, so later phases don't require a rewrite):**

1. **`projects`** table: `id, business_id, code, name, description, start_date, end_date,
   status, manager_user_id, parent_project_id, is_active, deleted_at`. (Mirror `branches`
   shape exactly for RLS reuse.)
2. **`funding_sources`** table (donors/grantors/grants): `id, business_id, name, type
   (DONOR|GRANT|INTERNAL|OTHER), reference, currency, total_committed, restriction
   (RESTRICTED|UNRESTRICTED), start_date, end_date, notes, is_active`. Grant "instances" can
   be the same table with `type='GRANT'` and a `parent funding_source` for a donor, keeping
   the domain small initially.
3. **Optional nullable dimension columns** on the transactional tables the ledger already
   dimensions: add `project_id uuid null` and `funding_source_id uuid null` to
   `journal_entries` (and pass-through on `expenses`, `invoices`). These mirror the existing
   `branch_id`/`department_id` pattern **exactly**, so reporting, RLS, and posting reuse
   proven code paths.
4. **Reuse for the rest:**
   - *Project budget / budget lines* → existing `budgets` + `budget_lines` (already have
     `account_id`, monthly buckets); add optional `project_id` to `budget_lines`.
   - *Cost centres* → existing `departments.cost_centre`.
   - *Fund/restricted balances, fund utilisation, project balance* → derived reports over
     `journal_lines` filtered by `project_id`/`funding_source_id` + `restriction`.
   - *Donors* → `contacts` with `contact_type='donor'` (no schema change).
   - *Terminology* → org-type-driven i18n (Income→"Contributions/Grants received",
     Profit→"Surplus/Deficit").
5. **NGO chart of accounts template** → add a third `seedChartOfAccounts` template
   (`npo`/`fund`) with income = grants/donations/other income and an equity section modelling
   restricted/unrestricted funds. Selected when `organisation_type ∈ {NON_PROFIT, NGO}`.

**Deferred (design now so it fits, build later):** advances & liquidations, activity-level
expenditure hierarchies, multi-currency grant tranches, automated donor report packs. None of
these require changing the core once the two dimension columns + two tables above exist.

DB change: **yes** (2 tables + nullable dimension columns + 1 COA template). RLS: **yes**
(new policies for `projects`/`funding_sources`, copied from `branches`). Customers: **safe**
(columns nullable, tables empty for existing orgs). Breaks businesses: **no**.

---

## 9. Proposed retail architecture

Retail is a **configuration mode of the existing sales/inventory engine**, not a new module.
The pipeline already exists end-to-end:

```
product → inventory_balances/stock_movements → POS sale (posSaleRpc)
        → journal_entries+journal_lines (revenue, COGS, tax) → invoice/receipt
        → inventory movement (perpetual COGS) → reports
```

Changes needed: **only** promote POS to a real capability (`pos`) and gate the `/pos` route +
nav item (A3), plus wire `pos` into the retail default capability set. **No engine changes.**
POS posting integrity is already covered by an extensive test suite
(`src/services/__tests__/pos*`).

DB change: **no** (POS tables exist). RLS: **no**. Customers: retail orgs unaffected (they
already have POS today). Breaks businesses: **no**.

## 10. Proposed wholesale architecture

Wholesale is **the same sales/inventory engine in credit mode**, not a separate system. All
primitives exist:

```
customer (contacts.credit_limit, credit_terms_days)
  → invoice (bulk lines) → invoice_payments (partial/credit) → outstanding balance (AR)
  → inventory movement → journal postings → customer-balance & ageing reports
```

Changes needed: **none structurally.** Add a `wholesale` business model that defaults
capabilities to `sales + inventory + customers + suppliers` (POS optional) and surface
credit-terms fields more prominently. Retail and wholesale therefore **share one engine**;
they differ only in default capabilities and which reports are foregrounded.

DB change: **no.** RLS: **no.** Breaks businesses: **no.**

## 11. Proposed product/service architecture

**Already implemented — keep `product_type`.** The audit confirms:
- `products.product_type ∈ {'product','service'}` and `products.track_inventory` exist.
- `ProductsPage.tsx` sets `track_inventory=false` for services (line ~153) — **services never
  create inventory records.**
- `invoice_lines.product_id` is **nullable** with an `account_id` fallback → a single invoice
  can mix products and services (and free GL lines) with correct accounting.

Recommendation: **do not re-architect.** Add only:
- A `services` capability so service-only orgs get service-first UI and hide inventory.
- Ensure POS-sale and invoice posting for `product_type='service'` skips COGS/stock (verify in
  `posSaleRpc`/`inventoryJournalService`; product path already conditions on
  `track_inventory`). This is a **verification task**, not a redesign.

The "ABC Solutions" mixed example (Laptop + Computer Repair + IT Support on one invoice) is
supported by the current data model today.

DB change: **no** (optionally rename `product_type`→`item_type` later; not required). RLS:
**no.** Breaks businesses: **no.**

---

## 12. Proposed onboarding flow

Keep the existing 4-step wizard; **prepend two lightweight questions** and derive
capabilities. Do not make it heavier than necessary.

```
Step 0 — Organisation type   (single choice, drives accounting posture + COA template)
    ○ For-profit business   ○ NGO / Non-profit   ○ Government / Public   ○ Other

Step 1 — How do you operate? (multi-select → business_models[])
    □ Retail   □ Wholesale   □ Sell physical products   □ Provide services
    □ Sell products & services   □ Project-based   □ Grant-funded

Step 2..5 — existing: legal → contact → financial → branding

Step 6 — Confirm modules (derived, editable)
    "Based on your setup, Ledgr will enable: Sales, Customers, Invoicing, Expenses,
     Reports, Inventory. Enable POS?  [Yes] [Not now]"
```

Wiring: pass `organisation_type`, `business_models[]`, derived `enabled_capabilities`, and the
chosen `coa_template` into `create_business_with_owner` (new **optional** params; RPC defaults
preserve today's behaviour so existing callers/tests don't break). The COA seed already
supports template selection (`seed_new_business` takes `coa_template`).

DB change: via §5 columns + RPC params. RLS: no. Customers: existing orgs never see this
(one-time at creation). Breaks businesses: no (params optional, defaults = current path).

---

## 13. Proposed navigation model

**Reuse the existing dynamic engine.** `NAV_SECTIONS` + `visibleSectionsFor()` already
produce role/partner/plan-filtered navigation. Add **one** filter dimension
(`requiresOrgCapability`) so items disappear when the org doesn't use them:

- `/pos` → `requiresOrgCapability: 'pos'` (and add a `pos` capability — fixes A3).
- Inventory section items → already `requiresCapability: 'inventory'`; also require org `inventory`.
- New NGO section (Projects, Grants, Donor reports) → `requiresOrgCapability: 'projects'/'grants'`.
- Terminology via i18n keys selected by `organisation_type` (Income vs Contributions, etc.).

Resulting surfaces (all from the same config, no forked apps):

```
Retail:   Dashboard · POS · Income · Expenses · Invoices · Products · Warehouse ·
          Contacts · Reports · Banking
Service:  Dashboard · Income · Invoices · Services · Expenses · Contacts · Projects · Reports
NGO:      Dashboard · Projects · Grants · Budgets · Expenses · Contacts(Donors) ·
          Suppliers · Banking · Reports
```

Files touched: `navConfig.ts` (one function + type), i18n resources. **No per-component
branching.**

---

## 14. Proposed reporting model

One engine, many dimensions/filters — no new report engines.

- **Universal (already computed from the ledger):** income & expenditure / P&L,
  balance sheet / financial position, cash flow (`v_cash_flow`), expense analysis,
  transaction history, budget vs actual (`budgets`/`budget_lines`).
- **Retail/wholesale/product:** sales by product, stock movement/valuation, gross margin,
  branch performance (via `journal_entries.branch_id` + `stock_movements`), customer balances
  & ageing (AR from `invoices`/`invoice_payments`).
- **Service:** revenue by service, customer revenue, invoice ageing (same AR data filtered by
  `product_type='service'`).
- **NGO:** project expenditure, grant utilisation, expenditure by donor/project, fund balance,
  budget vs actual — all **filters over `journal_lines`** on the new `project_id` /
  `funding_source_id` / `restriction` dimensions (§8) + existing `budget_lines`.

Change pattern: reports gain **dimension filters and org-type labels**, driven by
`organisation_type` and `enabled_capabilities`; the underlying queries stay on
`journal_entries`/`journal_lines`. For-profit shows "Profit & Loss / Net Profit"; non-profit
shows "Income & Expenditure / Surplus (Deficit)". DB change: **no** beyond §8 columns.

---

## 15. Permission / RLS impact

- **Keep feature enablement and permission strictly separate** (§12 of brief). Capabilities
  decide *what the org uses*; roles decide *what a user may do*. `enabled_capabilities` must
  **never** widen RLS.
- New tables (`projects`, `funding_sources`) need RLS policies **copied from `branches`/
  `departments`** (master-data pattern in `20260728000008_role_aware_master_data_rls.sql`),
  going through `user_has_role()` / capability helpers so all 19 roles behave consistently and
  `rlsRoleParity.test.ts` keeps `usePermissions.ts` and RLS in lockstep.
- New nullable dimension columns (`project_id`, `funding_source_id`) inherit existing table
  RLS — no policy changes to `journal_entries`/`expenses`/`invoices`.
- `create_business_with_owner` and `seed_new_business` are `security definer`; adding optional
  params must preserve the existing validation and search_path hardening.
- Edge Functions: `api` (public JSON:API), `ai-chat`/`support-agent`, export/deletion
  functions must treat new columns/tables as **tenant-scoped** and not leak them cross-tenant.
  The AI knowledge context (`src/lib/ai/knowledge.ts`) should learn org type so advice matches
  a non-profit vs a shop.
- **Do not** introduce capability checks in RLS. Server-side authorization stays role-based;
  capability gating is a UX/optional-module concern enforced in the app + optionally by
  not exposing routes.

Impact: **new policies only** (additive). No existing policy weakened. Approval: **D4 (§26)**.

## 16. Subscription impact

- **Do not** create per-org-type plans or per-type applications (brief §13). Keep the
  composition: `plan_tier` gates *reachable* capabilities & usage limits; `enabled_capabilities`
  gates *which reachable modules the org actually uses*; roles gate users.
- Some org capabilities map onto existing paid capabilities (`inventory`→Starter+,
  `bank_reconciliation`/`accounting_organisation`→Growth+). Decision needed on where the new
  `projects`/`grants`/`donor_reporting` capabilities sit in the tier ladder — recommend
  **available from Free/Starter** so NGOs aren't forced up-tier merely to be non-profit
  (**D3, §26**), with usage limits still applying via `transactionLimit`.
- No change to PayChangu flow, `subscription_payments`, or enforcement; `expire-subscriptions`
  and reminders are unaffected. Conflict check: `PlanGate` and the new `CapabilityGate` are
  independent wrappers, so no double-gating bug as long as capability defaults never exceed
  what the plan allows (the resolver ANDs them).

## 17. Migration strategy

All changes additive and reversible; **no destructive schema changes; historical financial
records untouched.**

1. **Schema migration** (new timestamped file in `supabase/migrations/`):
   `ALTER TABLE businesses ADD COLUMN organisation_type text, business_models text[],
   industry text, enabled_capabilities jsonb` — **all nullable**.
2. **Backfill existing businesses** in the same migration:
   - `organisation_type := 'FOR_PROFIT'` (safe default; every current tenant is a business).
   - `business_models := ` inferred from data presence: has POS shifts/products with
     `track_inventory` → include `RETAIL`/`PRODUCT_SALES`; has service products →
     `SERVICE_SALES`; else `MIXED`. If uncertain, default `['MIXED']`.
   - `enabled_capabilities := ` derived to **exactly reproduce today's behaviour** — enable
     everything the tenant can currently reach (based on current `plan_tier` capabilities +
     the always-on modules). This guarantees zero UX change for existing tenants.
   - `coa_template` left as-is (`gaap`) — never re-seed an existing chart.
3. **NGO tables + dimension columns** in a later migration (Phase 7), empty for existing
   tenants (nullable columns, no backfill needed).
4. **RPC updates** add optional params with defaults so existing callers/tests are unaffected.
5. **Type regen**: `src/dal/types/database.generated.ts` regenerated after each migration
   (project already has a documented regen process, `docs/database/phase-9-type-regeneration.md`).

Rollout order mirrors the phase plan (§22); each migration is independently deployable.

## 18. Backward compatibility assessment

| Concern | Outcome |
|---|---|
| Existing businesses | Keep working unchanged — defaults reproduce current capabilities. |
| Existing users / roles | Unaffected — no role or RLS semantics changed for existing tables. |
| Existing transactions / journals | **Never modified** — new dimension columns are nullable and default NULL. |
| Existing products / inventory / POS | Unaffected — POS becomes a capability but defaults ON for orgs that already use it. |
| Existing reports | Identical output; new filters are opt-in. |
| Existing subscriptions | Unchanged; new capabilities compose with tiers. |
| Onboarding for new orgs | Enhanced; old RPC signature preserved via optional params. |

**Test F (existing Ledgr business) passes by construction**: no field an existing tenant
relies on is removed or repurposed; capability defaults are derived to equal current state.

## 19. Security risks (ranked)

| Sev | Risk | Mitigation |
|---|---|---|
| **High** | Confusing *capability* (feature on/off) with *permission* (RLS), accidentally widening data access via `enabled_capabilities`. | Enforce the rule in §15: capabilities never appear in RLS; add a test asserting RLS ignores `enabled_capabilities`. |
| **High** | New `projects`/`funding_sources` tables shipped **without RLS** (this exact class of bug was F1 in `SYSTEM_AUDIT.md`). | Copy `branches` policies + `enable row level security` in the same migration; extend `rlsRoleParity.test.ts`. |
| Med | New nullable dimension columns leaking cross-tenant via the public `api` Edge Function or exports. | Tenant-scope all new fields; add API/export tests. |
| Med | `security definer` RPC changes dropping `search_path` hardening or validation. | Preserve existing guards; review diff against current RPC. |
| Med | AI functions receiving org-type context could leak or mis-scope. | Pass only current-business context, as today. |
| Low | Subscription bypass if capability defaults exceed plan entitlements. | Resolver ANDs plan∧partner∧org; add unit test. |

## 20. Financial integrity risks (ranked)

| Sev | Risk | Mitigation |
|---|---|---|
| **High** | Service items accidentally generating COGS/stock movements. | Verify POS/invoice posting branches on `track_inventory`/`product_type`; add regression test (Test D). |
| **High** | NGO fund/restriction misposting if `project_id`/`funding_source_id` become required or alter double-entry. | Keep them as **memo dimensions only** (nullable, never change debit=credit); reports filter, they don't post differently. |
| Med | Wrong COA template for org type breaking statement mapping. | Only apply NGO template at creation; never re-seed existing charts. |
| Med | Report label swap (Profit↔Surplus) misclassifying accounts. | Labels are presentation-only; account types unchanged. |
| Med | Migration backfill mis-inferring `business_models` and changing visible nav. | `business_models` does not gate finance; `enabled_capabilities` backfill = current state, so finance and nav are unchanged regardless of inferred models. |
| Low | Budget-by-project double counting. | `budget_lines.project_id` optional; project budgets are a filter, not a second budget system. |

## 21. Recommended target architecture

Adapted to the actual codebase (the ledger and gating layers already exist):

```
                              LEDGR (one app, one DB, per-tenant rows)
                                        │
            ┌───────────────────────────┼───────────────────────────┐
            │                           │                           │
     CORE FINANCE ENGINE        ORGANISATION PROFILE          ACCESS CONTROL
   journal_entries/_lines       businesses.organisation_type   business_users.role
   accounts (COA templates)     businesses.business_models[]    usePermissions ⇄ RLS
   periods · budgets · tax      businesses.industry             user_has_role() helpers
            │                   businesses.enabled_capabilities        │
            │                           │                           (unchanged)
            │              CAPABILITY RESOLVER  (plan ∧ partner ∧ org ∧ role)
            │                           │
   ┌────────┼─────────┬────────┬────────┬────────┬────────┬─────────┐
   │        │         │        │        │        │        │         │
 Sales   Expenses  Inventory  POS   Services  Projects  Grants   Payroll
(invoices)         (products) (pos)          (NEW)     (NEW)
   │        │         │        │        │        │        │         │
   └────────┴─────────┴────────┴────────┴────────┴────────┴─────────┘
                                        │
                         REPORTING ENGINE (one ledger, dimensional filters:
                          branch · department/cost-centre · project · fund)
```

Everything above the resolver is **new/config**; everything below already exists and is
reused. There is one core, one ledger, one security model, one reporting foundation.

## 22. Implementation phases

Recommended subset after inspection (not all phases from the brief are needed because the
engine, product/service split and dynamic nav already exist):

| Phase | Scope | Required? |
|---|---|---|
| **P1** | Profile columns on `businesses` + capability resolver lib + backfill migration. | **Yes** (foundation) |
| **P2** | `CapabilityGate` + `useCapability`; wire `navConfig` `requiresOrgCapability`; add `pos` capability (fix A3). | **Yes** |
| **P3** | Onboarding Step 0/1 + confirm-modules; RPC optional params; COA template choice. | **Yes** |
| **P4** | Org-type terminology (i18n) + dashboard profit/surplus labels. | Yes (UX correctness) |
| **P5** | Verify/enforce service vs product posting (no COGS for services) + tests. | **Yes** (integrity) |
| **P6** | Retail/wholesale default capability presets (config only). | Yes (small) |
| **P7** | NGO foundation: `projects`, `funding_sources`, nullable `project_id`/`funding_source_id` dimensions, NGO COA template, RLS. | **Yes** (the real new domain) |
| **P8** | Reporting dimension filters + NGO/service report views. | Yes |
| **P9** | Migration + full regression (Tests A–F). | **Yes** (mandatory) |
| **P10** | Production validation & staged rollout. | **Yes** |

Phases 5, 9, 10 in the brief map to less work here because product/service and the sales
engine already exist. **Do not begin any phase before design sign-off (§26).**

## 23. Test / acceptance scenarios

| Test | Setup | Must prove |
|---|---|---|
| **A — Retail shop** | FOR_PROFIT · RETAIL · products · POS on · inventory on | POS sale posts journals, stock decreases, receipt issued, reports + inventory accurate. |
| **B — Wholesale** | FOR_PROFIT · WHOLESALE · products · inventory on | Bulk credit invoice, customer balance/ageing, partial payments, inventory movement, reports. |
| **C — Service** | FOR_PROFIT · SERVICE_SALES · inventory off | Services sold, invoices/customers/revenue work, **no stock movements**, no inventory nav. |
| **D — Mixed** | FOR_PROFIT · PRODUCT_AND_SERVICE | One invoice with product+service: product line hits COGS/stock, service line does not; revenue & reports correct. |
| **E — NGO** | NON_PROFIT · PROJECT_BASED · GRANT_FUNDED | No POS/inventory forced; projects & funding sources representable; expenditure trackable by project/fund; financial reports available (Income & Expenditure / Surplus). |
| **F — Existing business** | any current tenant, no config change | Behaves **exactly** as before (nav, gating, reports, finance) — backfill reproduces current capabilities. |

Add unit tests: capability resolver (plan∧partner∧org∧role), RLS-ignores-capability,
service-no-COGS, migration backfill idempotency, `rlsRoleParity` extended to new tables.

## 24. Files / tables / components / functions that WOULD change

**Database (new migrations only — never edit historical migrations):**
- `businesses` +columns (`organisation_type`, `business_models`, `industry`,
  `enabled_capabilities`) + backfill.
- New tables `projects`, `funding_sources` (+ RLS) [P7].
- Nullable dimension columns on `journal_entries`, `expenses`, `invoices`, `budget_lines`
  (`project_id`, `funding_source_id`) [P7].
- RPCs `create_business_with_owner`, `seed_new_business` — optional params (COA template,
  profile). New reporting views for project/fund/service dimensions [P8].

**Frontend:**
- New: `src/lib/capabilities/*`, `useCapability` hook, `<CapabilityGate>`.
- Edit: `src/components/layout/navConfig.ts` (add `requiresOrgCapability`, add `pos`),
  `src/App.tsx` (`/pos` gate; NGO routes), `src/pages/CreateBusinessPage.tsx` (Steps 0/1/confirm),
  `src/pages/SettingsPage.tsx` (Organisation/Modules tab), `src/pages/DashboardPage.tsx`
  (profit/surplus label), `src/components/OnboardingChecklist.tsx` (capability-aware tasks),
  `src/services/seedChartOfAccounts.ts` (NGO template), `src/lib/ai/knowledge.ts` (org context),
  i18n resources (`src/i18n`), `src/dal/repositories/BusinessRepository.ts` (+ profile fields),
  `database.generated.ts` (regen).
- New pages/repos (P7/P8): `ProjectsPage`, `GrantsPage`, `ProjectRepository`,
  `FundingSourceRepository`, project/fund report components.

**Edge Functions:** `api`, `export-my-data`, `ai-chat`, `support-agent` — tenant-scope new
fields.

## 25. Files / tables / components that should NOT change

- **The double-entry engine:** `journal_entries`, `journal_lines`, `accounts`, and posting
  RPCs/services (`journalService`, `inventoryJournalService`, `posSaleRpc`,
  `CapitalJournalService`, `FixedAssetsJournalService`). Add dimensions, don't alter debits/credits.
- **Existing RLS policies** on core tables and the `user_has_role()` ladder — extend with new
  tables, don't rewrite.
- **`plans.ts` tier→capability semantics** and PayChangu billing/webhooks — compose, don't replace.
- **Historical migrations** — immutable; all schema changes go in new files.
- **`product_type`/`track_inventory` model** — already correct; no redesign.
- **Multi-tenant `business_id` pattern** — the invariant everything depends on.
- **Offline queue semantics** (`src/offline/`) — new fields flow through existing ops.

## 26. Architectural decisions requiring human approval

| ID | Decision | Recommendation |
|---|---|---|
| **D1** | Profile as **columns on `businesses`** vs a separate `organisation_profiles` table. | Columns on `businesses` (smallest safe change, trivial RLS, hot-path read). |
| **D2** | `enabled_capabilities` as **jsonb map** vs a normalized `business_capabilities` table. | jsonb (matches partner `feature_flags` precedent; simpler). Reconsider if per-capability audit history is required. |
| **D3** | Do the new `projects`/`grants`/`donor_reporting` capabilities require a paid tier, or are they available from Free/Starter? | Available from Free/Starter (don't force NGOs up-tier); keep usage limits. |
| **D4** | Confirm RLS for new tables copies the `branches`/master-data pattern and that capabilities never enter RLS. | Approve as stated in §15. |
| **D5** | NGO scope for phase 1: ship `projects` + `funding_sources` + dimensions now; defer advances/liquidations/activity hierarchies. | Approve the minimal set (§8). |
| **D6** | Terminology: introduce org-type i18n variants (Income↔Contributions, Profit↔Surplus). | Approve (presentation-only, no accounting change). |
| **D7** | Whether to rename `product_type`→`item_type` (cosmetic) — not required. | Skip for now (avoid churn/migration risk). |

---

## Appendix — Evidence index (key files inspected)

- Schema: `supabase/migrations/20250101000000_base_schema.sql` (67 tables), 120 migrations total.
- Org creation/RPC: `20260815000000_phase8b_reconstruct_rpcs.sql` (`create_business_with_owner`,
  `seed_new_business`), `src/pages/CreateBusinessPage.tsx`.
- Capability/plan: `src/lib/billing/plans.ts`, `src/components/billing/PlanGate.tsx`,
  `src/components/billing/PartnerPlanGate.tsx`.
- Partner features: `src/types/partners.ts`, `src/partner/PartnerProvider.tsx`.
- Navigation: `src/components/layout/navConfig.ts`, `src/App.tsx`.
- Permissions/RLS: `src/hooks/usePermissions.ts`, `20260728000008/09_role_aware_*`,
  `src/hooks/__tests__/rlsRoleParity.test.ts`.
- Product/service: `src/pages/ProductsPage.tsx`, `products`/`invoice_lines` schema.
- Ledger/reports: `journal_entries`/`journal_lines` schema,
  `src/dal/repositories/{FinancialStatementRepository,IncomeRepository}.ts`,
  `20260726000000_v_cash_flow_view.sql`.
- Dimensions: `departments.cost_centre`, `budgets`/`budget_lines`, `branches`.
- COA: `src/services/seedChartOfAccounts.ts`.

**End of audit. No code has been modified. Await design approval (§26) before implementation.**
