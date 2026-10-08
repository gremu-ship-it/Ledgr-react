# Ledgr — Multi-Vertical / Business-Type Platform Readiness

**Date:** 2026-10-08 · **Question asked:** can different users have a different
Ledgr "platform" depending on their type of organisation (NGO, retail,
manufacturer, …), and where do we stand?

**Method:** read the repository itself — schema (migrations + the 2026-08-15
live capture), frontend gates, Edge Functions, and the two prior audits that
bear on this question (`docs/audits/LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md` §5–6
and `docs/audits/LEDGR_RETAIL_READINESS_2026-09-27.md`). Every claim below cites
a file. Nothing here is planned work presented as existing.

---

## 1. Verdict

**Ledgr today is one shared application and one shared database, differentiated
along four *configuration* axes — none of which is "type of organisation".**

There is **no tenant-level business type / industry attribute, no module
registry, and no per-tenant module entitlement**:

- `businesses` has no type/industry column. The live capture's full column list
  (`artifacts/database/capture/tables.txt`, `businesses` block) contains no
  `business_type`, `industry`, `sector` or equivalent.
- Onboarding is `create_business_with_owner(...)`
  (`20260815000000_phase8b_reconstruct_rpcs.sql:419-438`) — 17 parameters
  (name, registration, TPIN, VAT, currency, fiscal year, timezone, contact,
  branding, document prefixes). **No type/industry parameter**, and its
  `coa_template` is hard-defaulted to `'gaap'`.
- The onboarding UI has four steps — Business details, Contact & location,
  Financial settings, Branding (`src/pages/CreateBusinessPage.tsx:70-73`) — and
  Settings → Business Profile exposes the same fields
  (`src/pages/SettingsPage.tsx:346-390`). No type selector anywhere.
- No `business_modules` / `tenant_modules` / `module_key` object exists in any
  migration.

**What does exist** is a billing-tier capability system, a partner (reseller)
feature-flag system, an accounting-standard COA switch, and a role/capability
system. Those four axes are described in §2. Only two of the four are enforced
anywhere outside the browser.

**The practical consequence:** "an NGO platform" or "a manufacturing platform"
is **not buildable today by configuration** — and would not be honestly
enforceable today even if the UI hid the wrong screens, because module
entitlements are UI-only (see §4.3). What *is* true today is that a shared
bookkeeping/POS substrate already covers large parts of several segments, and
that **retail is the one vertical with real depth** (§3).

---

## 2. The four axes that exist today

| # | Axis | Mechanism | Where it is enforced | Evidence | Limitation |
|---|---|---|---|---|---|
| 1 | **Billing plan** | 5 tiers with cumulative `PlanCapability` lists (`inventory`, `core_accounting`, `accounting_organisation`, `bank_reconciliation`, `ai_insights`, `api_access`, `webhooks`, `custom_branding`) | **UI only**, except the monthly document quota: `PlanGate` (`src/components/billing/PlanGate.tsx:33`), `PartnerPlanGate`, `PlanGuard` (`src/routes/PlanGuard.tsx:19`), nav filtering (`src/components/layout/navConfig.ts:148`). Server knows `plan_tier` → `effective_plan_tier()` and enforces **quota** in `_ledgr_assert_usage_limit` (`20261017000000_subscription_expiry_enforcement.sql`) | `src/lib/billing/plans.ts:15-32`; App routes wrapped in `PlanGate` (`src/App.tsx:249-295`) | No server-side check of `inventory`, `core_accounting`, `api_access` or `webhooks`: `supabase/functions/create-api-key/index.ts` and `supabase/functions/api/index.ts` contain no `plan_tier`/capability check. A business at any tier can reach the module's data paths (RLS is role-based, not plan-based) |
| 2 | **Partner white-label** | `partners`, `partner_feature_flags` (`ai_advisor`, `payroll`, `inventory`, `multi_currency`, `bank_reconciliation`), partner branding + client billing | UI gates via `PartnerPlanGate` / `usePartner().isFeatureEnabled` (`src/components/layout/BottomNav.tsx:107-126`); DB RLS on the partner tables (`20260727000004_white_label_partners_hardening.sql:143-171`) | seed list in `20260727000004_white_label_partners_hardening.sql:282-292` | This is a **reseller** axis, not a vertical axis. A partner can hide `inventory` for all its clients — but cannot give one client a different operating model from another except through plan + these five flags |
| 3 | **Accounting standard** | `businesses.coa_template` = `'gaap'` \| `'ifrs'` (`CoaTemplate`, `src/services/seedChartOfAccounts.ts:38`), 166 GAAP accounts + IFRS-only additions (e.g. IFRS 16 right-of-use), switchable via `switchCoaTemplate()` | Application service + seeded rows | `src/services/seedChartOfAccounts.ts:353-509`; `src/pages/AccountsPage.tsx:461-469` | It is a **reporting-standard** variant, not an industry template. There is no NGO/retail/manufacturing account layout or default account-mapping set |
| 4 | **Roles & permissions** | `user_role` enum (18+ values incl. `cashier`, `manager`, `stock_clerk`, `purchasing_officer`, `tax_compliance_officer`, `treasury_manager`…), SQL capability helpers (`can_view_payroll`, `can_write_business_data`, `can_read_audit` — `20260728000009_role_aware_user_has_role.sql`), POS write-scope policies, UI mirror in `src/hooks/usePermissions.ts` | **DB RLS** (the real enforcement) + UI | migrations listed above | Roles are operational, not vertical. A cashier exists because retail exists; there is no `grant_officer`, `production_planner`, etc. |

Two further structural facts matter for any vertical plan:

- **Dimensions today:** branch (with reporting) and department (`cost_centre`).
  There is **no project, fund, grant or job dimension** (§3 NGO/construction).
- **Build-time flags** (`VITE_FEATURE_*`, `src/lib/featureFlags.ts`) are
  per-deployment, not per-tenant.

---

## 3. Segment-by-segment readiness

Assessed against the 2026-09-21 multi-vertical review (which classified each
segment's gaps) **updated for what has landed since** — the POS module, R07
corrections, R08 shift/till context, R10 quota contract, and subscription-expiry
enforcement.

| Segment | Status today | What is missing | Evidence |
|---|---|---|---|
| **Retail / POS** | **Deepest vertical. Server-authoritative and tested:** cash/multi-product/split-tender/credit sales, discount caps, single-use supervisor override tokens, approval-gated refunds & voids with COGS mirroring and restock, shift open/close + Z-report, offline queue with idempotent replay, branch + tenant isolation | Declared module existence; production *use* (as of 2026-09-27 no shift had ever been opened in production — the till had never been used); printer/scanner hardware untested; P2 items from the retail audit | `docs/audits/LEDGR_RETAIL_READINESS_2026-09-27.md` §2, §12, §16, §18 |
| **Service / professional** | Supported by configuration on the common app (invoices without stock, expenses, payroll, journals, reports). Called "the strongest near-term non-POS segment" | Nothing structural; optional time/engagement entities only if sold | `LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md` §5-D |
| **NGO / donor-funded** | Generic bookkeeping only, plus departments as cost centres. Budgets are **schema-only** (`budgets`, `budget_lines` exist; no page/module) | Projects, funds/grants, award conditions, advances/liquidation, budget versions & approvals, expenditure-eligibility rules, donor reports, project/fund-scoped authorization | audit §5-A; `ls src/pages` (no budgets/projects page) |
| **Manufacturing** | Inventory is buy/sell/transfer + COGS. No production model | BOM, work orders/WIP, production costing, scrap/rework — nothing exists (`bill_of_materials`, `work_orders`, `production_orders` appear in **no** migration) | grep of `supabase/migrations/*.sql` |
| **Construction / project businesses** | Suppliers, purchases, stock locations, payroll, assets | Job/project costing, procurement (requisitions/orders/receipts), commitments, variations/retention, progress claims | audit §5-B |
| **Wholesale / distribution** | Credit invoices, suppliers, stock transfers | Order fulfilment, UOM conversion, delivery controls | audit §5 "Other target types" |
| **Public sector / statutory** | Departments, branches, expenditure, audit-event API, reports | Budget execution, delegated approvals, segregation-of-duties workflows; audit explicitly says *not appropriate yet* without foundational hardening | audit §5-C |

---

## 4. The architectural gap, stated precisely

### 4.1 No place for "type of organisation" to live
The tenant root is `businesses`. It carries branding, fiscal, tax and billing
attributes — nothing about the organisation's operating model. `coa_template`
(axis 3) is the only "profile" field, and it answers a different question
(IFRS vs local GAAP), not "what kind of organisation is this".

### 4.2 No module registry
Modules exist only as: nav items in a hard-coded tree
(`src/components/layout/navConfig.ts:51-104`), route wrappers in `App.tsx`,
and capability strings in `plans.ts`. There is no canonical list of modules, so
"which modules does this tenant have?" cannot be answered by the database, and
adding a vertical module means editing the nav tree, the routes, the plan lists
and the partner flag list in four places.

### 4.3 Entitlements are not enforced server-side (only the quota is)
Plan capabilities gate **screens**; they do not gate **data**. `roles` +
`business_id` RLS is the DB enforcement layer, so a business that is not
"entitled" to inventory can still create products and stock movements through
REST/`supabase-js`/offline replay. That is acceptable while modules are just
bundles of screens sold per tier; it becomes a real problem the moment a module
carries a *different operating model* (NGO fund accounting, manufacturing WIP),
because then "the platform is different" must mean the server behaves
differently, not that the menu is shorter.

### 4.4 No entitlement resolver
Three independent mechanisms answer "is this feature on?":
`hasCapability(planTier, …)`, partner `isFeatureEnabled(…)`, and nav
`minPlan`/`requiresCapability`. Adding a fourth (vertical modules) without a
resolver produces four places to keep consistent — the same class of
drift that produced today's production schema issues (see §6).

### 4.5 No vertical templates
Beyond the missing account templates (§2 axis 3), there are no presets for:
default document prefixes, tax configuration, stock locations, roles, or
dashboard composition per segment.

---

## 5. Recommended next steps

Sequenced cheapest-first. **Phase A makes the question answerable and
enforceable; it adds no new domain logic and no new vertical.** Do not start
with a module (§5.3) — the two prior audits independently say vertical modules
are not the constraint (`LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md`: *"Do not wait
for new vertical modules"*, *"No new vertical module is needed to complete
Phase 0"*).

### Phase A — the entitlement foundation (one additive migration + one hook)
1. **`public.modules`** — registry: `key` (pk), `name`, `category`
   (`operations`/`finance`/`inventory`/`accounting`/`organisation`/`platform`),
   `status` (`available`/`planned`), `requires_plan_tier` (nullable),
   `default_enabled`. Seed **exactly the modules that exist today** (dashboard,
   pos, income, expenses, invoices, payroll, inventory.products,
   inventory.warehouse, inventory.transfers, accounting.accounts, .tax, .assets,
   .capital, .reports, .journals, .bank_reconciliation, .periods, .audit,
   contacts, branches, departments, ai, api, webhooks, support). Nothing invented.
2. **`businesses.business_type`** — text + check constraint, default `'generic'`,
   values kept deliberately small to start: `generic | service | retail |
   ngo | manufacturing | construction | public_sector`. Additive; existing rows
   backfill to `'generic'`. (A reference table is not needed yet; a check
   constraint is easier to widen later than a FK is to migrate.)
3. **`public.business_modules`** — `(business_id, module_key, enabled, source)`
   with `source` ∈ `type_preset | plan | manual`. Plus **`public
   .effective_modules(p_business_id)`** (SECURITY DEFINER, `search_path` pinned,
   stable): resolver = type preset ∪ plan capabilities ∪ manual overrides,
   honouring `effective_plan_tier()`. This is the single question the UI and
   server should ask.
4. **One frontend resolver** — `useModules()` consuming
   `effective_modules`; refactor `navConfig` filtering, `PlanGate`,
   `PartnerPlanGate` and `BottomNav` to read it (partner flags stay a
   *subtractive* layer: partner ∧ plan ∧ module). Acceptance: the three current
   mechanisms produce identical results on today's data, proven by tests.
5. **Server-side assertion** — `_ledgr_assert_module(business_id, 'pos')` and
   use it in the POS/vertical RPCs and Edge Functions, mirroring how
   `_ledgr_assert_usage_limit` gates quota today. Rule: **a module that changes
   behaviour must be asserted server-side; a module that is only a bundle of
   screens may be UI-gated**, and the registry records which is which.
6. **Type presets** — per `business_type`, the default module set:
   `retail` → pos + inventory + accounting + contacts; `service` → income,
   expenses, invoices, payroll, accounting; `ngo` → everything generic today
   (no fake vertical screens until Phase C); etc. Changing type later =
   recompute preset with `source='type_preset'` rows only; never delete data.

### Phase B — vertical configuration (still no new domain tables)
7. **Industry COA templates**: widen `CoaTemplate` to
   `'gaap' | 'ifrs' | 'ngo' | 'retail' | 'manufacturing'` with per-template
   account sets and the default account mappings that today are inline in
   services (`journalService`, `inventoryJournalService`). This is where
   "different platform" becomes *visible* to an accountant at near-zero risk.
8. **Onboarding**: add a type step to `CreateBusinessPage` (and a
   `p_business_type` parameter to `create_business_with_owner`), which selects
   the COA template and the module preset. Backfill existing businesses as
   `generic`; expose the same choice in Settings with an explicit
   "adding modules does not delete data" behaviour.
9. **Vertical roles** (only as needed): the role enum already carries
   operational roles; add a role per vertical only when a real customer needs
   the separation (`grant_officer`, `production_planner`), never speculatively.

### Phase C — the first real vertical module (evidence-gated)
10. Pick **one** module, driven by paying-customer demand, and build it to the
    house standard: server-enforced entitlement + RLS scoped by the new
    dimension + an embedded-Postgres migration harness + a `§` doc entry.
    - **NGO first** if that is the commercial priority: `projects` and
      `funds`/`grants` as **first-class dimensions** (the audit's explicit
      warning: do not encode a project as free text on invoices, do not rename
      departments "projects", do not duplicate the account tree per grant),
      with budget versions and donor reports on top of the existing journals.
    - **Manufacturing** is the heaviest (BOM/WIP/costing-method decisions) and
      should not be first.
    - **Retail** already exists functionally: declaring it as a module in
      Phase A lets it be *sold* as one, and the retail audit's §17 checklist
      (production smoke sale, shift close, demo-business setup) is the real
      next step there.

### Phase D — governance
11. Every new module/vertical ships with: entitlement asserted server-side,
   RLS scoped by tenant *and* the vertical dimension, a migration test in
   `tests/database/`, a diagnostic script if it repairs data, and a
   documentation entry. Household rules already learned the hard way apply:
   migrations idempotent, extension functions schema-qualified, never write
   `cron.job` directly (`docs/database/database-operations.md` §9.9–9.10).

---

## 6. What not to do

From the 2026-09-21 audit, still valid today:

- **Do not fork the application or database per vertical.** One SPA, one
  tenant root (`businesses`), shared-schema tenancy stays.
- **Do not rename `businesses`** to make "organisation" language work; product
  language can say Organisation without renaming tables.
- **Do not add a column per industry** to documents, and do not overload
  free-text fields (`project_code`) as a substitute for a dimension.
- **Do not build vertical modules before the foundation** — the same audit:
  *"Do not wait for new vertical modules"* and hardening outranks breadth.
- **Do not ship UI-only vertical differentiation.** Today's production
  incidents are exactly the "configured in one layer, enforced in another"
  class; a vertical model that only exists in `navConfig.ts` will drift the
  same way.

## 7. Decisions needed from the owner

1. **Commercial priority order** for verticals (NGO vs manufacturing vs
   construction) — this decides Phase C, and nothing before it depends on the
   answer.
2. **Is a "type" a one-time onboarding choice or a switchable setting?**
   (Recommendation: switchable, additive presets, never destructive.)
3. **May partners override a tenant's vertical preset?** (Affects whether
   `effective_modules` takes a partner layer as subtractive-only.)
4. **Is module entitlement a *plan* feature (billing) or a *type* feature
   (fit)?** (Recommendation: both — plan sets the ceiling, type sets the
   default — which is exactly what `effective_modules` computes.)

---

## Appendix — evidence index

| Claim | Source |
|---|---|
| No `business_type`/industry column | `artifacts/database/capture/tables.txt` (`businesses` block); `20250101000000_base_schema.sql:313+` |
| Onboarding has no type parameter | `20260815000000_phase8b_reconstruct_rpcs.sql:409-438`; `src/pages/CreateBusinessPage.tsx:70-96` |
| Plan capabilities + tiers | `src/lib/billing/plans.ts:15-120` |
| UI gating of modules | `src/App.tsx:249-295`; `src/components/billing/PlanGate.tsx`; `src/routes/PlanGuard.tsx`; `src/components/layout/navConfig.ts:27-155` |
| Partner flags | `20260727000002_white_label_partners.sql:16-31`; `20260727000004_white_label_partners_hardening.sql:282-292`; `src/components/layout/BottomNav.tsx:107-126` |
| COA templates | `src/services/seedChartOfAccounts.ts:38,353-509`; `src/pages/AccountsPage.tsx:461-469` |
| Roles + capability helpers | `20250101000000_base_schema.sql:225-236`; `20260728000008/…09`; `src/hooks/usePermissions.ts` |
| Budgets schema-only | `budgets`/`budget_lines` in migrations + capture; no page in `src/pages/` |
| No manufacturing objects | grep: `bill_of_materials`, `work_orders`, `production_orders` absent from `supabase/migrations/` |
| Retail depth | `docs/audits/LEDGR_RETAIL_READINESS_2026-09-27.md` §2, §12, §16–18 |
| Segment gaps | `docs/audits/LEDGR_ARCHITECTURE_AUDIT_2026-09-21.md` §5 (`Multi-Vertical Scalability Review`) |
| Quota is the only server-enforced plan rule | `20261017000000_subscription_expiry_enforcement.sql` (`effective_plan_tier`, `_ledgr_assert_usage_limit`) |
