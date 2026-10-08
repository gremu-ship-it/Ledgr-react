# LEDGR — Evidence-First Architecture Validation

**Date:** 2026-09-27
**Branch:** `arena/01a0e2d8-ledgr-react`
**Purpose:** Validate, against the *current repository only*, the claims in
`docs/audits/LEDGR_MULTI_ORGANISATION_ARCHITECTURE_AUDIT_2026-09-27.md` before any
implementation. **No code, migrations, tables, or flows were changed by this task.**

**Source of truth:** the repository in this branch — schema in `supabase/migrations/*.sql`
(120 files, latest `20261015000000`), the generated types
`src/dal/types/database.generated.ts` (reflects the live schema), and `src/**`. The earlier
audit is treated as a **proposal**, not proof.

**Classification legend:** VERIFIED · PARTIALLY VERIFIED · NOT VERIFIED · CONTRADICTED ·
PROPOSED (discussed, not implemented).

---

## 1. Executive finding (≤10 sentences)

Ledgr is a single, strongly multi-tenant application in which every financial module —
invoices, POS, expenses, payroll, fixed assets, capital, tax — converges on **one**
double-entry ledger (`journal_entries` + `journal_lines`) posted through shared SQL
primitives (`_ledgr_post_entry`, `_ledgr_post_cogs`), so there is exactly one accounting
engine (VERIFIED). The `businesses` table has **no** `organisation_type`, `business_models`,
`industry`, or `enabled_capabilities` columns, and none of those identifiers, nor any
`useCapability`/`CapabilityGate`/capability-resolver, exist anywhere in the codebase — the
previous audit's organisation-profile/capability model is **PROPOSED, not implemented**
(VERIFIED absent). Feature availability today is decided by three real, separate mechanisms:
subscription `PlanCapability` (8 keys, no `pos` key), white-label `PartnerFeatureKey`, and a
19-role permission system mirrored between `usePermissions.ts` and RLS
(`is_business_member`/`can_write_business_data`/`user_has_role`) (VERIFIED). The
product/service split is real and the posting logic is safe: **every** stock-movement and
COGS path filters on `products.track_inventory = true`, so service lines on a mixed invoice
create no inventory or COGS while still recognising revenue (VERIFIED by tracing the RPC
bodies, not just the TypeScript type). POS is **not** gated by plan or capability, but it
**is** gated by role both client-side (`isPathAllowedForRole`) and server-side
(`can_operate_pos` guards `post_pos_sale`) — so the earlier "ungated" framing needs the
correction "un-*capability*-gated, but role-protected". The previous audit's absolute claim
that "no project/grant/donor domain exists at all" is **CONTRADICTED in part**: there is a
cosmetic `invoices.template = 'ngo'|'government'` option and a persisted free-text
`invoices.project_code` column, but there is **no** NGO *accounting* domain (no
projects/funds/grants/donors tables, and no project/fund dimension on the ledger). The ledger
*is* dimensional by `branch_id` and `department_id` (and `departments.cost_centre`), but has
**no** `project_id`/`fund_id`, so fund/project accounting is genuinely absent (VERIFIED).
There are **no** hard-coded `business.type`/`isRetail`/`isWholesale`/`hasPOS` branches in the
code, so there is no scattered business-type logic to untangle (VERIFIED). Net: the core
engine, tenancy, RBAC, and product/service posting are sound and should not be rewritten; the
real gaps are organisation classification, an org-level capability layer, and an NGO
accounting foundation.

---

## 2. Verified current architecture

| Area | Status | Evidence | Implication |
|---|---|---|---|
| Multi-tenancy by `business_id` | VERIFIED | Every domain table has `business_id` + FK + RLS; base schema `20250101000000` + `enable row level security` per table | New org types are rows, not deployments. |
| Single double-entry ledger | VERIFIED | `journal_entries`/`journal_lines`; posting via `_ledgr_post_entry` / `_ledgr_post_entry_keyed`; `source_type`/`source_id` link modules | One financial engine exists; do not fork it. |
| Modules post to that ledger | VERIFIED | `ExpenseRepository`, `PayrollRepository`, `FixedAssetsJournalService`, `CapitalJournalService`, `InvoiceRepository`, POS RPCs, `TaxPaymentRepository` all reference journal posting | Convergence is real (Income = invoices; Bank recon matches existing entries). |
| COGS/stock only for tracked products | VERIFIED | `_ledgr_post_cogs` (`20261015000000` l.271-273), `save_quick_sale` (`20261011000001` l.378), `record_sale_stock_and_cogs` (`20261011000005` l.114) all `track_inventory = true … continue when not found` | Services never create inventory/COGS. |
| Product vs service | VERIFIED | `products.product_type ('product'\|'service')`, `products.track_inventory`; `ProductsPage.tsx` sets `track_inventory=false` for services | Split is implemented at data + UI. |
| Mixed product+service invoice | VERIFIED | `invoice_lines.product_id` nullable + `account_id`; posting filters by `track_inventory` | A single invoice can hold both, posted correctly. |
| Ledger dimensions | VERIFIED | `journal_entries.branch_id`, `.department_id`; `expenses.branch_id/department_id`; `departments.cost_centre`; `budget_lines.branch_id/department_id/account_id` | Branch + cost-centre analysis possible; project/fund not. |
| Subscription capability gating | VERIFIED | `src/lib/billing/plans.ts` `PlanCapability` = 8 keys; `PlanGate.tsx`; `navConfig.ts` `requiresCapability`/`minPlan` | Real gate; **no `pos` capability key**. |
| Partner feature gating | VERIFIED | `src/types/partners.ts` `PartnerFeatureKey`; `PartnerProvider.isFeatureEnabled`; `PartnerPlanGate` | Composes plan ∧ partner at route level. |
| Role permissions (client) | VERIFIED | `usePermissions.ts` (19 roles), `isPathAllowedForRole`, `RoleRoute` in `App.tsx` | Per-user access is role-based. |
| Role permissions (server/RLS) | VERIFIED | `is_business_member`/`can_write_business_data` (`20260728000008`), `user_has_role` (`20260728000009`), `rlsRoleParity.test.ts` pins parity | RBAC enforced server-side, not just UI. |
| POS role guard (server) | VERIFIED | `can_operate_pos()` (`20260923000000`) guards `post_pos_sale` | POS writes are role-protected server-side. |
| Dynamic navigation | VERIFIED | `navConfig.ts` `visibleSectionsFor()` filters by partnerFeature + role; per-item plan/capability locks | Nav is already config-driven, not hard-coded per type. |
| Onboarding creation path | VERIFIED | `RegisterPage` → `/create-business` (`CreateBusinessPage.tsx`, 4 steps) → RPC `create_business_with_owner` → `seed_new_business` | One clear insertion point for org profile. |
| COA seeding | VERIFIED | `create_business_with_owner` hardcodes `coa_template='gaap'` (`20260815000000` l.500,515); `seedChartOfAccounts.ts` has `gaap`+`ifrs` only | Every new org gets a for-profit GAAP chart; no NGO chart. |
| No business-type branching | VERIFIED | grep for `business.type\|isRetail\|isWholesale\|hasPOS\|businessType\|organisation_type` in `src` → none (only unrelated `hasPosPermission`) | No scattered type logic to refactor. |
| NGO/gov invoice template | PARTIALLY VERIFIED | `invoices.template` CHECK `('professional','minimal','ngo','government')`; `InvoiceTemplates.tsx`; `invoices.project_code text` persisted (`20260725000001`) | Cosmetic NGO/gov invoicing + free-text project code exist; not accounting. |

---

## 3. Previous audit claims — classified

| # | Previous audit claim | Classification | Evidence / correction |
|---|---|---|---|
| C1 | "One shared double-entry ledger; every module posts into the same journals." | **VERIFIED** | `_ledgr_post_entry`, `journal_entries`/`journal_lines`; module writers listed in §2. |
| C2 | "No `organisation_type`/`business_models`/`industry`/`enabled_capabilities` columns exist." | **VERIFIED** | Absent in `database.generated.ts` `businesses` block and all migrations. |
| C3 | "There is already a central capability-driven nav/gating system (plan + partner + role)." | **VERIFIED** | `plans.ts`, `PartnerPlanGate`, `navConfig.visibleSectionsFor`, `usePermissions`. |
| C4 | "product_type product/service already exists; services set track_inventory=false." | **VERIFIED** | `products` schema; `ProductsPage.tsx` l.153. |
| C5 | "Mixed product+service invoices are already possible / post correctly." | **VERIFIED** (upgraded from type-only to posting-traced) | `_ledgr_post_cogs`/`save_quick_sale`/`record_sale_stock_and_cogs` all skip non-`track_inventory` lines; revenue still posts. |
| C6 | "POS is always present, ungated by capability; `/pos` route has no gate; no `pos` capability." | **VERIFIED with correction** | True that there is no plan/capability/feature gate. **But** POS is role-gated client-side (`isPathAllowedForRole`) and server-side (`can_operate_pos` guards `post_pos_sale`). "Ungated" ⇒ should read "un-capability-gated, role-protected". |
| C7 | "No project/grant/donor/fund domain exists at all." | **CONTRADICTED (partial)** | A cosmetic `invoices.template='ngo'/'government'` and a persisted free-text `invoices.project_code` exist, plus a `donor_reference` *template field key* (not a DB column). No projects/funds/grants/donors **tables**, and no ledger project/fund dimension. Accurate statement: *NGO accounting domain is absent; NGO invoice branding + a free-text project code exist.* |
| C8 | "Ledger already dimensional (branch, department/cost-centre); budgets by dimension." | **VERIFIED** | `journal_entries.branch_id/department_id`, `departments.cost_centre`, `budget_lines` dims. |
| C9 | "coa_template hardcoded to gaap by create_business_with_owner." | **VERIFIED** | `20260815000000` l.500/515. Note: `seed_new_business` *can* accept a template (l.165), but the creation RPC passes `'gaap'`. |
| C10 | "RBAC centralised in `user_has_role()`/capability helpers mirrored to `usePermissions.ts`." | **VERIFIED** | `20260728000008/09`, `rlsRoleParity.test.ts`. |
| C11 | Proposed `organisation_profiles`/columns, `CapabilityGate`, `useCapability`, resolver, `requiresOrgCapability`, `projects`/`funding_sources` tables, `project_id`/`funding_source_id` ledger dims, NGO COA template. | **PROPOSED** | None present in repo (grep returned nothing outside the audit doc). Must not be described as existing. |
| C12 | "Dashboard uses for-profit profit/loss framing." | **VERIFIED** | `DashboardPage.tsx` `dashboard.profitable`/`dashboard.loss` labels. |
| C13 | "Multi-branch is first-class." | **VERIFIED** | `branches` table + `branch_id` throughout; POS/journal/budget carry `branch_id`. |
| C14 | "No hard-coded business-type checks scattered in the frontend." | **VERIFIED** | grep found none. |

---

## 4. Architecture gaps (repository-evidenced only)

1. **No organisation classification.** `businesses` cannot express for-profit vs
   non-profit/NGO/government, nor operating model. (VERIFIED absent.)
2. **No organisation-level capability layer.** Gating is plan ∧ partner ∧ role only; an org
   cannot turn modules on/off independently of its subscription tier. (VERIFIED absent.)
3. **POS has no feature/capability gate.** Only role controls it; a service firm or NGO on any
   plan still sees `/pos` in nav and can reach the route (role permitting). (VERIFIED.)
4. **No NGO accounting domain.** No projects/funds/grants/donors tables; no `project_id`/
   `fund_id` dimension on `journal_entries`/`expenses`; only a free-text `invoices.project_code`
   (income side) and cosmetic templates. Fund/restricted-fund/grant-utilisation/donor
   reporting cannot be produced from the ledger. (VERIFIED.)
5. **Only for-profit COA templates**, always seeded as `gaap`. No fund/NPO chart. (VERIFIED.)
6. **Terminology is for-profit** in dashboard/nav/i18n (Income, Profit/Loss). (VERIFIED —
   but see §5: mostly a UI/reporting concern, not accounting.)

No other gaps are asserted; anything not listed here was either verified present or is out of
scope for this initiative.

---

## 5. Recommended target architecture

Repository evidence shows the lower half of the diagram already exists and is sound; only the
top (profile → capability) is missing. Corrected diagram:

```
                 CURRENT LEDGR (one app, one DB, per-tenant rows)   [VERIFIED]
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        │  NEW (PROPOSED)                                         │  EXISTING [VERIFIED]
   ORGANISATION PROFILE                                     ACCESS CONTROL
   organisation_type · operating_model[] · industry        business_users.role (19)
        │                                                    usePermissions ⇄ RLS helpers
   EFFECTIVE CAPABILITY = plan ∧ partner ∧ org-config ∧ role
   (plan ∧ partner ∧ role EXIST; org-config layer is NEW)
        │
   EXISTING MODULES  (sales/invoices · POS · inventory · expenses · payroll · assets · tax)
        │  [all VERIFIED, role/plan/partner-gated]
   EXISTING FINANCIAL ENGINE  journal_entries / journal_lines via _ledgr_post_entry  [VERIFIED]
        │
   REPORTING  (FinancialStatementRepository, v_cash_flow) — dimensional by branch/department
              [VERIFIED]; project/fund dimensions would be NEW
```

The diagram from the prior audit is directionally correct; the only substantive correction is
that **POS, projects and grants shown as peer modules are not equal today** — POS exists (role
-gated), projects/grants do **not** exist as accounting modules.

---

## 6. Data-model recommendation (minimum justified)

Only changes justified by verified gaps. Nothing here is implemented in this task.

| Change | Why needed | Existing equivalent? | Migration impact | Risk |
|---|---|---|---|---|
| `businesses.organisation_type text` (nullable, default backfilled) | Gap 1; drives COA template, terminology, capability defaults | None (coa_template is accounting layout, not org type) | Additive column + backfill `'FOR_PROFIT'` | Low |
| `businesses.operating_model text[]` (or single text) | Gap 1; derive default modules | None | Additive | Low. **Open Q:** array vs single (§13). |
| `businesses.industry text` (nullable) | Advisory defaults/AI only | None | Additive | Low; risk of being unused config → keep optional. |
| Org capability configuration | Gap 2/3 | Partner `feature_flags` jsonb is the closest precedent | Additive (column or table) | Med — **derived vs stored** must be decided (§7, §13). |
| `projects` table | Gap 4 foundation | Free-text `invoices.project_code` only (income, not ledger) | New table + RLS (copy `branches` pattern) | Med (RLS must be correct). |
| `funding_sources` table (donor/grant) | Gap 4 foundation | `contacts` can hold donors but no grant/funding entity | New table + RLS | Med. |
| Nullable `project_id` / `funding_source_id` on `journal_entries`/`expenses` | Gap 4 — make ledger fund-dimensional | `branch_id`/`department_id` are the exact precedent | Additive nullable cols | Med — must stay **memo dimensions** (never alter debit=credit). |
| NGO/fund COA template in `seedChartOfAccounts.ts` | Gap 5 | `gaap`/`ifrs` only | Code + seed; apply only at creation | Med. |

**Do NOT** widen `industry` into behaviour-bearing logic, and **do NOT** add advances/
liquidations/activity tables now (no repository or product evidence requires them yet — see §8).

---

## 7. Capability model (relationship of the four concepts)

Keep the four concepts **separate** (they already are today for three of them):

```
SUBSCRIPTION (plan_tier → PlanCapability)   — "may the tenant pay for it?"     [EXISTS]
      ∧
ORGANISATION CONFIG (enabled_capabilities)  — "does this org choose to use it?" [NEW]
      ∧
PARTNER FEATURE FLAGS (feature_flags)       — "does the white-label allow it?"  [EXISTS]
      ∧
USER PERMISSION (role → usePermissions/RLS) — "may THIS user act?"             [EXISTS]
= EFFECTIVE CAPABILITY
```

Recommended shape for the new layer, based on the existing precedent
(`PartnerProvider.isFeatureEnabled` reads a jsonb `feature_flags`): a small
`profile-defaults → derived → admin-overrides → effective` resolution, where **defaults are
derived** from `operating_model`/`organisation_type` at onboarding and **stored** as an
override map so an admin can toggle one module without changing the model. This mirrors how
partner flags already work and avoids re-deriving on every render. **Hard rule (VERIFIED
concern):** capability config must **never** appear in RLS — RLS stays role-based; capability
is a UX/optional-module concern. A test should assert RLS ignores capability config.

Decision (derived vs stored vs hybrid) is left open in §13 — the evidence supports the hybrid
but the product owner should confirm whether per-capability audit history is required (which
would favour a normalized table over jsonb).

---

## 8. NGO architecture

| Bucket | Items | Evidence |
|---|---|---|
| **Already supported** | For-profit ledger reusable for I&E; branch + department + `departments.cost_centre` dimensions; budgets by account/branch/department; NGO/Government **invoice templates**; free-text `invoices.project_code`; donors representable as `contacts`. | VERIFIED (§2). |
| **Foundation required (minimum)** | `projects` + `funding_sources` tables (RLS copied from `branches`); nullable `project_id`/`funding_source_id` memo dimensions on `journal_entries`+`expenses`; NGO/fund COA template; org type = NON_PROFIT/NGO to switch terminology + template + chart. | Gaps 4–5, VERIFIED absent. |
| **Later functionality** | Restricted vs unrestricted fund tracking, grant utilisation, donor report packs, project budgets (`budget_lines.project_id`), advances & liquidations, activity-level budgets. | Build only when required; foundation above makes them additive. |
| **Not justified yet** | Implementing-partner / funding-agreement / activity-hierarchy tables, multi-tranche grant currency logic. | No repository or stated product evidence; do not create speculatively. |

**Explicitly:** the existence of a generic `project_code` string does **not** constitute
project accounting, and existing `budgets` do **not** constitute grant accounting — both were
verified as free-text / for-profit-budget respectively.

---

## 9. Retail / wholesale / service architecture

- **Retail:** achievable with existing systems — POS (`post_pos_sale` + `_ledgr_complete_pos_sale`),
  inventory (`stock_movements`, `inventory_balances`), COGS, revenue posting all exist and are
  role-protected. **Only change needed:** promote POS to a capability (`pos`) and gate its nav
  item + route (Gap 3). No engine change. (VERIFIED.)
- **Wholesale:** achievable with existing systems — `contacts.credit_limit`/
  `credit_terms_days`/`currency`, `invoices` + `invoice_payments` (partial/credit),
  AR/ageing from existing data, inventory movement, journal postings. **No structural change**;
  differs from retail only in default capabilities and which reports are foregrounded.
  (VERIFIED primitives; ageing/credit *reports* themselves NOT separately verified — see §13.)
- **Service:** achievable with existing systems — service items (`product_type='service'`,
  `track_inventory=false`) post revenue with no COGS/stock (VERIFIED by tracing RPCs). **Only
  change needed:** a `services` capability + hide inventory nav for service-only orgs.

Genuine code/schema change is therefore small: a `pos` capability + org capability layer +
terminology; the sales/inventory engine itself needs **no** change for retail/wholesale/service.

---

## 10. Backward compatibility

Based on verified current behaviour:

- Existing businesses have `coa_template='gaap'`, `plan_tier`, and role memberships; nothing in
  the code branches on an org type (none exists), so **adding nullable profile columns changes
  no existing behaviour** until code reads them.
- If org capability defaults are backfilled to reproduce *current* effective capability
  (everything the tenant can already reach via plan ∧ partner ∧ role), existing nav, gating,
  routes, reports and postings remain identical. (This is the safe path; it is a design
  requirement, not yet implemented.)
- New NGO tables/columns are empty/nullable for existing tenants → no reads change, historical
  journals untouched.
- POS gating change is the **one** behaviour risk: introducing a `pos` capability must default
  **ON** for tenants that already use POS (detectable via `pos_shifts`/`post_pos_sale` history
  or simply defaulting all existing orgs' `pos=true`), or existing shops lose POS. (VERIFIED
  risk; mitigation is a backfill default.)

`create_business_with_owner` must keep its current signature/behaviour or gain **optional**
params only, so existing callers/tests are unaffected (its body is the single definition —
VERIFIED).

---

## 11. Security and financial-integrity risks (verified / clearly foreseeable)

**Security**
1. **New tables without RLS** (projects/funding_sources) — this exact class was a past Critical
   (`SYSTEM_AUDIT.md` F1). Must copy the `is_business_member`/`can_write_business_data` pattern
   (`20260728000008`). (Foreseeable, High.)
2. **Capability config leaking into RLS** — would turn a UX toggle into a data-access change.
   Keep capability out of RLS entirely. (Foreseeable, High.)
3. **New columns/tables leaking via `api` Edge Function / exports / AI context** — AI context
   authz was recently hardened (`20260927000000_r03_ai_context_authorization.sql`); new fields
   must be tenant-scoped there too. (Foreseeable, Med.)

**Financial integrity**
4. **Service lines creating COGS/stock** — currently prevented by `track_inventory` filters in
   every path (VERIFIED safe); any new sales path must preserve that filter. (Med if refactored.)
5. **Project/fund dimensions altering double-entry** — must be memo-only (nullable, never
   change which accounts are debited/credited or the balance). (Foreseeable, High.)
6. **POS capability backfill wrong** — see §10; could remove POS from live shops. (Foreseeable, Med.)
7. **Wrong COA template on existing orgs** — never re-seed an existing chart; apply NGO template
   only at creation. (Foreseeable, Med.)

No currently-existing security or integrity defect was discovered by this validation; all risks
above are prospective consequences of the proposed change.

---

## 12. Implementation sequence (proposal only — no code)

1. **Profile columns + backfill** (`organisation_type`, `operating_model`, `industry`) —
   additive, defaults reproduce today.
2. **Org capability layer** — resolver `plan ∧ partner ∧ org ∧ role`; backfill defaults =
   current effective capability; add `pos` capability with existing POS tenants defaulted ON.
3. **Gate POS + wire capability into `navConfig`** (single function) and route wrappers.
4. **Onboarding** — capture org type + operating model; pass optional params to
   `create_business_with_owner`; choose COA template.
5. **Product/service + retail/wholesale presets** — capability defaults only (engine unchanged).
6. **NGO foundation** — `projects`, `funding_sources`, nullable ledger dimensions, NGO COA
   template, RLS copied from `branches`.
7. **Terminology + reporting dimensions** — org-type labels; project/fund report filters.
8. **Migration + regression** — Tests A–F from the prior audit, plus capability-∧ and
   RLS-ignores-capability tests.

Sequence is a recommendation; each step is independently shippable and additive.

---

## 13. UNKNOWN / NEEDS VERIFICATION

- **Wholesale/service reports** (customer balances, AR ageing, revenue-by-service,
  invoice ageing) — primitives verified, but whether these *report views/screens* already
  exist was **NOT VERIFIED** (ReportsPage/`FinancialStatementRepository` internals not
  exhaustively read). Needs confirmation before claiming "reports already work".
- **`donor_reference`** appears only as a template *field key* in `InvoiceTemplates.tsx`; whether
  it is captured/persisted anywhere is **NOT VERIFIED** (no schema column found → likely not
  persisted). Confirm before relying on it.
- **Org capability storage decision** (derived vs stored vs hybrid; jsonb vs normalized table;
  need for per-capability audit history) — **needs product-owner decision**, not derivable from
  code alone.
- **`operating_model` single vs array** — can one live tenant legitimately be multiple models
  simultaneously in a way that changes behaviour? Not answerable from the repo; **needs product
  decision**.
- **POS-usage detection for backfill** — whether to default `pos=true` for all existing orgs or
  only those with `pos_shifts`/sale history; the safest signal was not fully validated.
- **Which subscription tier** the new `pos`/`projects`/`grants` capabilities belong to — a
  pricing/product decision, not in the code.
- **Number of RLS-protected tables** — `enable row level security` appears 79× vs 103 type
  entries (includes views/re-enables); an exact per-table RLS coverage audit for *new* tables
  should be run at implementation time rather than inferred here.
- **Edge Functions beyond `api`/AI** (`export-my-data`, reporting paths) — not line-by-line
  verified for how they would treat new columns; verify during implementation.

---

**No code, schema, migrations, tables, onboarding, or capability logic were modified by this
validation task.** This document records verified facts only; every proposal is labelled and
must be approved before implementation.
