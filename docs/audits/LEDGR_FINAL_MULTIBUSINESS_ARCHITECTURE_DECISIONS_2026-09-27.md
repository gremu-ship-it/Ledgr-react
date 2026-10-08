# LEDGR — Final Multi-Business Architecture Decisions (Design Freeze)

**Date:** 2026-09-27
**Branch:** `arena/01a0e2d8-ledgr-react`
**Status:** DESIGN VALIDATION ONLY — **no code, SQL, migrations, DB, POS, accounting, RLS, nav
or onboarding changed by this task.** This is the final decision pass; implementation begins
only from the decisions frozen here.

**Source of truth:** the repository in this branch — `supabase/migrations/*.sql` (120 files,
latest `20261015000000`), `src/dal/types/database.generated.ts`, and `src/**`. Prior audit
docs are supporting only.

**Classification legend for §B:** VERIFIED (repo-proven) · RECOMMENDED (architect decision,
repo-consistent) · CONTRADICTED · REQUIRES PRODUCT DECISION.

> ⚠️ **Schema-source caveat (new finding).** `src/dal/types/database.generated.ts` is **stale
> relative to migrations**: it exposes only `pos_cash_movements`, `pos_settings`, `pos_shifts`,
> yet migrations create `pos_terminals`, `pos_approvals`, `pos_corrections`,
> `pos_price_overrides`, `pos_shift_closes`, `pos_shift_late_adjustments`. For POS and any new
> object, **treat migrations (not generated types) as the schema source of truth**, and
> regenerate types after each migration. The `businesses`-columns finding still holds: the new
> profile columns are absent from *both* the types and *all* migrations.

---

## A. VERIFIED CURRENT STATE (repository-proven only)

1. **One shared double-entry ledger.** `journal_entries` + `journal_lines`, written through
   `_ledgr_post_entry` / `_ledgr_post_entry_keyed`; modules link via `source_type`/`source_id`
   / `posting_key`. (VERIFIED.)
2. **All modules converge on it.** Invoices, POS, expenses, payroll, fixed assets, capital, tax
   post through the shared primitives. (VERIFIED.)
3. **Product/service posting is safe.** `_ledgr_post_cogs` (`20261015000000` l.271-273),
   `save_quick_sale` (`20261011000001` l.378), `record_sale_stock_and_cogs`
   (`20261011000005` l.114) all filter `track_inventory = true … continue when not found`;
   service lines create no stock/COGS, revenue still posts. Mixed invoices work
   (`invoice_lines.product_id` nullable + `account_id`). (VERIFIED.)
4. **POS is role-protected, not capability-gated.** `can_operate_pos()` (`20260923000000`)
   guards `post_pos_sale`; client `isPathAllowedForRole`. `/pos` nav item has no
   `requiresCapability`; `/pos` route has no gate; **`plans.ts` has no `pos` PlanCapability**.
   (VERIFIED.)
5. **Three access axes exist, one is missing.** Subscription `PlanCapability` (8 keys), partner
   `feature_flags` (`isFeatureEnabled`), role (`usePermissions` ⇄ RLS `is_business_member` /
   `can_write_business_data` / `user_has_role`). **No organisation-capability layer.** (VERIFIED.)
6. **Ledger is dimensional by branch + department only.** `journal_entries.branch_id`,
   `.department_id`; `expenses.branch_id/department_id`; `departments.cost_centre`;
   `budget_lines.branch_id/department_id/account_id`. **No `project_id`/`fund_id` anywhere.**
   (VERIFIED.)
7. **Organisation classification absent.** `businesses` has no `organisation_type`,
   `operating_model(s)`, `industry`, or capability columns; none of those identifiers,
   `useCapability`, `CapabilityGate`, or a resolver exist in `src`. (VERIFIED absent.)
8. **NGO reality:** cosmetic `invoices.template ∈ (professional,minimal,ngo,government)`
   (`20260725000001`) + persisted free-text `invoices.project_code`. `donor_reference` is only
   an `InvoiceTemplates.tsx` field key — **not a DB column** (NOT persisted, verified absent).
   No projects/funds/grants/donors tables; no NGO ledger dimension. (VERIFIED.)
9. **COA seeding:** `create_business_with_owner` (`20260815000000`, 18 positional params, **no
   defaults**) hardcodes `coa_template='gaap'`; `seedChartOfAccounts.ts` has only `gaap`+`ifrs`.
   `seed_new_business` *can* accept a template arg. (VERIFIED.)
10. **No business-type branching.** grep for `business.type`/`isRetail`/`isWholesale`/`hasPOS`
    in `src` → none (only unrelated `hasPosPermission`). (VERIFIED.)
11. **Wholesale primitives vs workflow.** VERIFIED primitives: `contacts.credit_limit`,
    `credit_terms_days`, `currency`; `invoices` + `invoice_payments` (partial); **`v_ar_ageing`
    view** + `ContactRepository.getArAgeing()` with `days_overdue`. **NOT a complete workflow:**
    `getArAgeing` is **not consumed by any `.tsx`**, and `ReportsPage` tabs are
    `trial|sofp|pl-ifrs|revenue|cashflow-ifrs|equity|branches|currency` — **no receivables /
    customer-balances / ageing screen.** (VERIFIED distinction.)
12. **Existing report UIs:** Trial Balance, Statement of Financial Position, P&L (IFRS),
    Revenue Breakdown ("Revenue by Product & Service"), Cash Flow (IFRS), Equity, **Branch
    Performance** (with gross profit / gross margin), Multi-currency. (VERIFIED.)

---

## B. DECISIONS

### DECISION A — Organisation type
- **STATUS:** REQUIRES PRODUCT DECISION (on the NGO/NON_PROFIT split) · RECOMMENDED (rest).
- **RECOMMENDATION:** Store `organisation_type` on `businesses` with values
  **`FOR_PROFIT`, `NON_PROFIT`, `GOVERNMENT`, `OTHER`**. **Fold NGO into `NON_PROFIT`** and
  represent "NGO-ness" through operating models (`PROJECT_BASED`/`GRANT_FUNDED`) rather than a
  separate top-level type. Include `GOVERNMENT` now (a `government` invoice template already
  exists) but treat its accounting posture as the same non-commercial (Income & Expenditure)
  posture as `NON_PROFIT` for phase 1. `organisation_type` **should** influence COA template,
  terminology, and default capabilities; it **must not** influence RLS or posting rules.
- **REASON:** `NON_PROFIT` and `NGO` have identical accounting posture (I&E / fund), so two
  separate types would create a distinction with no accounting meaning and invite duplicated
  logic. Five overlapping types are not justified by any repo evidence; four cover every
  verified need. The government invoice template is the only repo evidence for a distinct
  `GOVERNMENT`, and it is cosmetic. Owner must confirm whether "NGO" must appear as a
  first-class label (UI/marketing) even though it is accounting-equivalent to NON_PROFIT.

### DECISION B — Operating model
- **STATUS:** RECOMMENDED (array) · CONTRADICTED (necessity of `MIXED` and
  `PRODUCT_AND_SERVICE`).
- **RECOMMENDATION:** `operating_models text[]` (array). Minimum vocabulary:
  **`RETAIL`, `WHOLESALE`, `PRODUCT_SALES`, `SERVICE_SALES`, `PROJECT_BASED`, `GRANT_FUNDED`.**
  **Drop `MIXED` and `PRODUCT_AND_SERVICE`** — both are redundant once an array is allowed
  (`PRODUCT_SALES` + `SERVICE_SALES` = the old "product and service"; any multi-select = the old
  "mixed"). Keeping redundant composite values would create two ways to express the same state
  and inevitable divergent branching.
- **REASON:** Real, verified combinations exist (a retailer that also wholesales; a firm selling
  products and services; an NGO that is project-based and grant-funded). The product/service
  engine already handles mixed transactions (§A.3), so the array is the faithful model. A single
  enum cannot express these without an explosion of composite values.

### DECISION C — Capability architecture (four layers)
- **STATUS:** VERIFIED (three layers exist) · RECOMMENDED (adding the fourth).
- **RECOMMENDATION:** Effective access = **SUBSCRIPTION ∧ PARTNER ∧ ORGANISATION ∧ ROLE**. The
  organisation layer answers only *"does this business use this module?"* and is composed with
  AND; it can only **narrow**, never widen. **RLS and tenant isolation remain entirely
  independent of organisation capability** (hard rule, §H).
- **REASON:** The other three layers are verified and already compose (`PartnerPlanGate` ANDs
  plan ∧ partner; role via `RoleRoute`/RLS). Adding org config as another AND-factor is the
  minimal, consistent extension and cannot loosen security because AND only restricts.

### DECISION — Capability storage (Option A/B/C)
- **STATUS:** RECOMMENDED — **Option C (hybrid)**.
- **RECOMMENDATION:**
  - **DEFAULT** = derived in code from `organisation_type` + `operating_models` via a static map
    (`src/lib/capabilities/`), **not stored**. Purely a function of the profile.
  - **OVERRIDE** = a **sparse** `capability_overrides jsonb` on `businesses` holding only
    explicit admin on/off decisions (absent key = "no override").
  - **EFFECTIVE** = `plan ∧ partner ∧ (override[k] ?? default[k]) ∧ role`.
  - **Authoritative value:** EFFECTIVE, recomputed on read. Between DEFAULT and OVERRIDE, the
    **override is authoritative where present**, otherwise the derived default.
  - **Backward-compat pin (critical):** for **existing** businesses, the migration must set
    overrides (or an equivalent pinned map) equal to their **current effective capability set**
    (everything reachable today via plan ∧ partner ∧ role, including `pos=true`), so behaviour
    is byte-for-byte unchanged regardless of derived defaults. New businesses derive from
    profile with optional overrides.
- **REASON vs Ledgr:** mirrors the verified partner `feature_flags` jsonb precedent (simple,
  performant, no extra join on the hot capability-check path — same read cost as reading the
  `businesses` row already loaded into the Zustand store). Pure derivation (A) risks silently
  changing existing tenants if a default is narrower than today; pure stored (B) loses the
  ability to auto-configure from the profile and bloats onboarding. Hybrid gives auto-config
  for new tenants, explicit admin control, and a safe pin for existing tenants. Auditability:
  overrides are explicit rows → auditable via existing `audit_log`; if per-capability history
  is later required, promote overrides to a table (deferred, see §K).

### DECISION — Capability vocabulary (§6 classification)

| Capability | Classification | Notes |
|---|---|---|
| `core_finance` | EXISTING SYSTEM (always-on) | Income/expenses/accounts/journals/reports/budgets. Not gate-able. |
| `sales` (invoicing) | NEEDS ORG GATING (soft) | Exists; default on; may be hidden for pure-grant NGOs. |
| `pos` | NEEDS ORG GATING + **new key** | Exists & role-gated; add `pos` capability + nav/route gate. See §F. |
| `inventory` | NEEDS ORG GATING | Exists as PlanCapability + partner flag; **compose** org layer, don't replace. |
| `services` | NEEDS ORG GATING | `product_type='service'` exists; org flag only exposes/hides UI. No engine change. |
| `customers` | NEEDS ORG GATING (low) | `contacts` (contact_type). Optional split from suppliers. |
| `suppliers` | NEEDS ORG GATING (low) | Same table. |
| `contacts` | EXISTING SYSTEM | Currently under `accounting_organisation` plan cap. Reuse. |
| `projects` | **NEW MODULE** | NGO foundation (§D/§10). |
| `grants` (`funding_sources`) | **NEW MODULE** | NGO foundation. |
| `donor_reporting` | **NOT YET REQUIRED** | Deferred; depends on projects/grants + real reporting need. |
| `budgets` | EXISTING SYSTEM | `budgets`/`budget_lines`. Optionally expose as capability (low). |
| `banking` | EXISTING SYSTEM | `bank_reconciliation` PlanCapability + partner flag. Reuse. |
| `payroll` | EXISTING SYSTEM | Partner flag today. Reuse. |
| `ai_insights` / `api_access` / `webhooks` / `custom_branding` | EXISTING SYSTEM | PlanCapabilities. **Not** org-gated. |

---

## C. FINAL TARGET ARCHITECTURE

```
                 LEDGR (one app, one DB, per-tenant rows)                    [VERIFIED]
                                    │
        ┌───────────────────────────┴───────────────────────────┐
   ORGANISATION PROFILE (NEW cols on businesses)            ACCESS CONTROL      [VERIFIED]
   organisation_type · operating_models[] · industry?       role (19) → usePermissions ⇄ RLS
   capability_overrides (sparse jsonb)                       is_business_member / user_has_role
        │                                                          │  (UNCHANGED)
   EFFECTIVE CAPABILITY = SUBSCRIPTION ∧ PARTNER ∧ ORGANISATION ∧ ROLE
   (SUBSCRIPTION, PARTNER, ROLE exist [VERIFIED]; ORGANISATION is the only new AND-factor)
        │
   EXISTING MODULES  sales/invoices · POS(now capability-gated) · inventory · services ·
                     expenses · payroll · assets · tax · banking      [VERIFIED, reused]
        + NEW (NGO foundation): projects · funding_sources
        │
   ONE SHARED DOUBLE-ENTRY LEDGER  journal_entries / journal_lines via _ledgr_post_entry
        │  [VERIFIED — not rewritten; gains nullable memo dims project_id/funding_source_id]
   REPORTING  trial/SOFP/P&L/revenue/cashflow/equity/branch/currency  [VERIFIED]
              + org-type labels + branch/department/project/fund filters
```

---

## D. FINAL DATA MODEL (only what is justified)

**Phase-1 MUST (on `businesses`, all additive, nullable/defaulted):**
- `organisation_type text` — default backfill `'FOR_PROFIT'`.
- `operating_models text[]` — backfill inferred/`'{}'` (behaviour driven by capability pin, not
  models, so inference need not be perfect).
- `capability_overrides jsonb` — backfill = **current effective capability set** per existing
  business (pins behaviour, incl. `pos=true`).

**Phase-2 SHOULD (NGO foundation):**
- Table `projects` (mirror `branches`: `id, business_id, code, name, description, start_date,
  end_date, status, is_active, deleted_at, created_at, updated_at`) + RLS.
- Table `funding_sources` (`id, business_id, name, type, reference, currency,
  total_committed, restriction, start_date, end_date, notes, is_active`) + RLS.
- `journal_entries.project_id uuid null`, `journal_entries.funding_source_id uuid null`
  — **memo/analytical dimensions only** (header level, mirroring `branch_id`/`department_id`).
- `expenses.project_id uuid null`, `expenses.funding_source_id uuid null` — same.
- `businesses.industry text null` — non-behavioural (defaults/labels/AI/templates only).

**Explicitly NOT added now (no symmetry-driven fields):**
- `invoices.project_id` / `invoices.funding_source_id` — **DEFER** (income side already has
  free-text `project_code`; add structured dims only when a verified report requires them).
- `budget_lines.project_id` — **DEFER** (project budgets are later NGO functionality).
- No `donor_reference` column, no advances/liquidations/activity/agreement/implementing-partner
  tables (Rule 5).

**Hard invariant:** `project_id`/`funding_source_id` are memo dimensions; they must **never**
alter `is_debit`, amount, `account_id`, or double-entry balancing. Reports filter on them.
*Known limitation:* header-level dimensions (matching existing branch/department granularity)
cannot split a single entry across projects; acceptable for the foundation.

---

## E. FINAL CAPABILITY MODEL

```
SUBSCRIPTION   plan_tier → PlanCapability (plans.ts)        "may the tenant pay for it?"   [EXISTS]
PARTNER        feature_flags jsonb (isFeatureEnabled)       "does the white-label allow it?" [EXISTS]
ORGANISATION   capability_overrides[k] ?? derivedDefault[k] "does THIS business use it?"     [NEW]
ROLE           role → usePermissions ⇄ RLS helpers          "may THIS user act?"             [EXISTS]

EFFECTIVE(k) = planHas(plan_tier, k)
             ∧ partnerAllows(k)
             ∧ (capability_overrides[k] ?? derivedDefault(organisation_type, operating_models)[k])
             ∧ roleAllows(k)
```
- ORGANISATION can only **narrow** (AND). It never grants data access.
- Where a capability has no subscription/partner analogue (e.g. `projects`), those factors are
  treated as `true` and gating is org ∧ role only.
- Existing businesses: `capability_overrides` pinned so EFFECTIVE == today.

---

## F. MIGRATION / BACKFILL PLAN (POS is the critical case)

**POS usage-detection evidence inspected:** `pos_settings` carries **no** per-business "enabled"
flag (only discount/receipt/payment config) and is not a reliable usage signal. Reliable
signals are `pos_shifts` rows (a shift must be opened to sell), `audit_log.event_type='pos_sale'`,
and `pos_terminals` rows (table exists in migrations though absent from stale generated types).

- **Chosen strategy: Strategy A — enable `pos` for ALL existing businesses.**
- **Exact rule:** in the same migration that adds `capability_overrides`, set `pos=true` in the
  override map for **every** existing `businesses` row (as part of pinning the full current
  effective set). Do not attempt usage-based inclusion.
- **What happens to businesses with no POS history:** they keep `pos=true` — identical to today,
  where POS is reachable by any POS-role user regardless of prior use. (Strategy B is
  **rejected** precisely because it would remove POS from configured-but-not-yet-transacted
  retail tenants, violating Rule 4.)
- **What happens to existing POS businesses:** unchanged — POS stays available; role guards and
  `can_operate_pos` are untouched.
- **New businesses:** `pos` derived from `operating_models` (`RETAIL` ⇒ default on; pure
  `SERVICE_SALES`/NGO ⇒ default off), still overridable in onboarding.
- **Rollback:** the capability check must treat an **absent** `pos` key as `true` (fail-open for
  this pre-existing feature), so reverting the migration or dropping the column restores exactly
  today's behaviour. General rollback = drop the additive columns; no data loss (memo dims and
  profile columns are nullable/sparse).

**Business-creation RPC:** `create_business_with_owner` currently has 18 positional params and
no defaults. Extend by **appending optional params with SQL defaults**
(`p_organisation_type text default 'FOR_PROFIT'`, `p_operating_models text[] default '{}'`,
`p_coa_template text default 'gaap'`, …) so every existing caller/test remains valid; the wizard
passes the new named args. Never re-seed an existing chart (§K/§11).

---

## G. BACKWARD-COMPATIBILITY GUARANTEES (must remain unchanged)

For every **existing** business after migration, all of the following must be identical to
pre-migration behaviour:
1. Role permissions and `isPathAllowedForRole` outcomes.
2. Set of accessible modules / nav items.
3. **POS access** (pinned `pos=true`; fail-open on absent key).
4. Accounting: journal postings, COGS/track_inventory behaviour, balancing.
5. Reports (same tabs, same numbers).
6. Inventory behaviour and stock movements.
7. Subscription entitlements and enforcement.
8. Partner feature-flag behaviour.
9. Chart of accounts (never re-seeded/rewritten).
10. Offline queue semantics.

Any change to the above for an existing tenant requires an explicit administrator/product action
(e.g. an admin toggling a capability), never the migration itself.

---

## H. SECURITY REQUIREMENTS

1. **Capability ≠ permission.** Organisation capability must **never** appear in RLS or widen
   tenant/user access. Add a test asserting RLS ignores `capability_overrides`.
2. **New tables RLS.** `projects` and `funding_sources` must enable RLS and use the verified
   master-data pattern (`is_business_member` / `can_write_business_data`, `20260728000008`) —
   copied from `branches`, not hand-rolled.
3. **New columns/tables review paths (must all be checked at implementation):**
   - public `api` Edge Function (`supabase/functions/api`) — tenant-scope new fields.
   - `export-my-data` — include/scope new fields per tenant.
   - AI context (`ai-chat`, `20260927000000_r03_ai_context_authorization.sql`) — pass only
     current-business scope.
   - Repositories (`BusinessRepository`, new `ProjectRepository`/`FundingSourceRepository`).
   - Reports/views — new dimensions filtered within tenant.
   - Admin/partner directory operations.
4. **Type regen.** Because generated types are stale, regenerate
   `database.generated.ts` after each migration and diff for accidental exposure.
5. Security is **not** to be claimed complete until items 2–4 are individually verified.

---

## I. TEST PLAN (A–L + additions)

| Test | Scenario | Must prove |
|---|---|---|
| A | Existing retail | Behaves exactly as today (nav, POS, accounting, reports, inventory). |
| B | Existing non-POS business | Behaves exactly as today. |
| C | New retail (FOR_PROFIT·RETAIL·PRODUCT_SALES·POS·INVENTORY) | POS+inventory on; sale posts journals + stock + COGS. |
| D | New wholesale (FOR_PROFIT·WHOLESALE·PRODUCT_SALES·INVENTORY·CUSTOMERS·CREDIT) | Credit invoice, partial payment, AR balance, inventory movement, reports. |
| E | New service (FOR_PROFIT·SERVICE_SALES·SERVICES) | Services sell; **no** inventory forced; no stock/COGS. |
| F | Mixed (PRODUCT_SALES + SERVICE_SALES) | Product lines hit stock/COGS; service lines do not; revenue correct. |
| G | NGO (NON_PROFIT·PROJECT_BASED·GRANT_FUNDED) | No POS/inventory forced; projects + funding_sources representable; I&E reporting available. |
| H | Existing POS tenant | POS remains available after migration (pinned + fail-open). |
| I | Role restriction | Org capability does **not** bypass role permissions. |
| J | RLS | Org capability does **not** bypass tenant isolation. |
| K | Subscription | Org capability cannot exceed subscription entitlement (AND). |
| L | Partner | Org capability cannot exceed partner feature flags (AND). |
| **M (add)** | Memo-dimension integrity | Setting `project_id`/`funding_source_id` never changes debit/credit/account/balance. |
| **N (add)** | Type-regen / schema drift | Generated types regenerated; no new field leaks via api/export/AI. |
| **O (add)** | Capability fail-open for POS | Absent `pos` key ⇒ POS available (rollback safety). |

---

## J. IMPLEMENTATION PHASES (smallest safe sequence)

**MUST HAVE (phase 1 — organisation layer, zero behaviour change for existing tenants)**
1. Additive `businesses` columns: `organisation_type`, `operating_models`,
   `capability_overrides`; backfill pinning current effective capability (incl. `pos=true`).
2. Capability resolver `src/lib/capabilities/` (derived defaults) + `useCapability` +
   `<CapabilityGate>` mirroring `PlanGate`/`PartnerPlanGate`; **fail-open on absent key**.
3. Add `pos` capability; gate `/pos` nav item + route centrally via
   `navConfig.visibleSectionsFor` (`requiresOrgCapability`) — no scattered `if`.
4. Onboarding: capture `organisation_type` + `operating_models`; append optional defaulted
   params to `create_business_with_owner`; keep existing callers valid.
5. Expose `services` capability; service-only orgs hide inventory/POS (UI only).
6. Tests A, B, H, I, J, K, L, O.

**SHOULD HAVE (phase 2 — NGO foundation + polish)**
7. `projects` + `funding_sources` tables (+ RLS copied from `branches`).
8. Nullable memo dims `project_id`/`funding_source_id` on `journal_entries` + `expenses`.
9. `npo` COA template (creation-only; never re-seed existing) + `organisation_type`→template map.
10. `industry` column (optional, non-behavioural).
11. Wire an **AR ageing / customer-balances report screen** using the existing `v_ar_ageing`
    view + `getArAgeing` (closes the verified wholesale workflow gap — no schema change).
12. Org-type terminology (Income↔Contributions, Profit↔Surplus) via i18n.
13. Tests C, D, E, F, G, M, N.

**DEFERRED (not built now — Rule 5)**
- `donor_reporting`, `budget_lines.project_id`, structured `invoices` project/funding dims,
  restricted-fund automation, advances/liquidations, activity hierarchies, funding agreements,
  implementing partners, multi-tranche grant currency, donor-report automation, promoting
  `capability_overrides` to a normalized audited table.

---

## K. REMAINING UNKNOWNS (genuine, unresolved)

1. **NGO vs NON_PROFIT label** — accounting-equivalent; does the product require "NGO" as a
   first-class type/label? (Decision A.)
2. **GOVERNMENT accounting posture** — I&E/fund like NON_PROFIT, or its own chart? (Decision A.)
3. **Subscription placement** of `projects`/`grants` capabilities (pricing) — product/pricing.
4. **`operating_models` array** — final product sign-off that multi-select is desired (strongly
   recommended); confirms dropping `MIXED`/`PRODUCT_AND_SERVICE`.
5. **COA template name** `npo` vs `fund` — recommend `npo`; confirm.
6. **Pin mechanism for existing tenants** — store explicit `capability_overrides` (recommended)
   vs a separate pinned map; confirm before migration.
7. **Header vs line-level** project/fund dimension — recommend header (matches
   branch/department); confirm the granularity limitation is acceptable.
8. **Generated-types staleness / live schema** — confirm the live DB matches migrations
   (POS tables) and re-baseline `database.generated.ts` before implementation.
9. **`donor_reference` persistence** — currently not a column; confirm whether it should become
   one (deferred by default).

---

## L. FINAL IMPLEMENTATION CONTRACT

1. **What will be added:** three additive `businesses` columns (`organisation_type`,
   `operating_models[]`, sparse `capability_overrides` jsonb; optional `industry`); a code-side
   capability resolver + `useCapability`/`CapabilityGate`; a `pos` capability with a central
   nav/route gate; onboarding capture of type + operating models via optional defaulted RPC
   params; and (phase 2) an NGO foundation of `projects` + `funding_sources` tables with
   nullable memo dimensions on `journal_entries`/`expenses`, an `npo` COA template, and an AR
   ageing report screen over the existing view.
2. **What will be reused:** the double-entry ledger and posting primitives; the
   product/service + `track_inventory` model; POS engine and `can_operate_pos`; subscription
   `PlanCapability`, partner `feature_flags`, and the role/RLS system; existing dimensional
   columns (`branch_id`/`department_id`, `departments.cost_centre`); `contacts` (customers/
   suppliers/donors); the `v_ar_ageing` view; the dynamic `navConfig` engine.
3. **What must NOT be rewritten:** `journal_entries`/`journal_lines` and all `_ledgr_post_*`
   RPCs; COGS/`track_inventory` logic; POS posting; subscription/partner/role/RLS mechanisms;
   historical migrations; the offline queue.
4. **What must NOT change for existing businesses:** permissions, accessible modules, POS
   access, accounting/postings, reports, inventory behaviour, journals, subscriptions, partner
   behaviour, and their chart of accounts — pinned via `capability_overrides` and fail-open POS,
   unless an admin/product action explicitly changes it.
5. **NGO functionality explicitly deferred:** donor reporting/automation, restricted-fund
   engines, project budgets (`budget_lines.project_id`), structured invoice project/funding
   dimensions, advances/liquidations, activity hierarchies, funding agreements, implementing
   partners, and multi-tranche grant currency.

---

**No code, migrations, tables, database, POS, accounting engine, RLS, navigation, or onboarding
were modified by this task.** Implementation may begin only from the decisions frozen above,
subject to the §K product confirmations.
