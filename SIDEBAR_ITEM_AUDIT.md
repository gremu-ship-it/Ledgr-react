# Sidebar Item Audit

**Audit date:** 2026-10-28<br>
**Snapshot:** Pre-Phase 5A-7 baseline. The current-state findings below describe the code as inspected before this PR's cleanup changes.<br>
**Scope:** Materials, Site Stores, Materials Transfer, Contacts, Branches, Sites, and Departments only. This is a source-level, read-only audit of the baseline branch; it is not a review of the complete navigation.

## Executive summary

The sidebar in this checkout does **not** contain Materials, Site Stores, Materials Transfer, or Sites. The live Inventory labels are **Products**, **Warehouse**, and **Transfers**; the live Organisation labels are **Contacts**, **Branches**, and **Departments**. Construction currently has one separate **Construction workspace** nav item.

The first three requested labels have close generic Inventory equivalents, but they are not three additional working modules: their production equivalents are `/products`, `/warehouse`, and `/transfers`. The construction draft page also contains receipt- and store-to-site-preparation sections, but these are explicitly local, in-memory notes—not saved materials, locations, receipts, or stock transfers. There is no Sites route or `sites` table in the checked-in generated database types/migrations. Branches and inventory locations are separate persisted entities; neither is a canonical construction-site record.

The current gate model also does not enforce the requested Construction/Manufacturing Enterprise policy. Construction is an authenticated, un-gated local draft route; Manufacturing is not represented as a model or route. POS defaults on for `RETAIL`, but the profile override mechanism can explicitly turn it on for another profile, so the current behavior is a default rather than an unbreakable Retail-only rule.

## Current-state table

“Plan gate” below means the application route/sidebar gate—not an assertion about database/RLS policy. Inventory routes also use a partner-feature gate and role checks. The row for each absent requested label names the closest live analogue; it does not imply that the absent label has its own route.

| Requested item | Current section | Path / route | Component | Current plan gate | Current vertical gate | Duplication / overlap | Notes from actual behavior |
|---|---|---|---|---|---|---|---|
| **Materials** | No such nav item; closest live item is **Inventory → Products** | No `/materials`; analogue `/products` (plus hidden `/inventory` route) | `ProductsPage`; `/inventory` renders the placeholder `InventoryPage` | `/products`: inventory capability (Starter+), partner `inventory`, org inventory capability, and role. No dedicated Materials gate. | Org inventory capability defaults on for the code models `RETAIL`, `WHOLESALE`, and `PRODUCT_SALES`; it is not keyed to the requested `construction` / `manufacturing` names. | Strong overlap with Products; construction receipt preparation uses free-text item labels, not the product catalog. | Products is the persisted product catalogue and works with inventory balances/locations. The “Materials” sidebar label and route do not exist. `/inventory` is especially inconsistent: `navItemForPath` treats it as an alias for Products, but `App.tsx` renders an empty “Coming soon” page there. |
| **Site Stores** | No such nav item; closest live item is **Inventory → Warehouse** | No `/site-stores`; analogue `/warehouse` | `WarehousePage` | Same inventory plan/partner/org-capability/role gates as Products. | Same current inventory-capability defaults; no separate construction/site-store gate. | Overlaps with the `inventory_locations` data used by Warehouse, Products, Transfers, and Branches. It is **not** a separate store/site data model. | Warehouse shows stock and receives stock into an `inventory_locations` row; it is not a site registry. The page says to add locations under Settings → Locations, but `SettingsPage` has no Locations tab. Branch creation is the only inspected UI path that creates a linked stock location. |
| **Materials Transfer** | No such nav item; closest live item is **Inventory → Transfers** | No `/materials-transfer`; analogue `/transfers` | `TransfersPage`; actual repository is `TransferRepository` | Same inventory plan/partner/org-capability/role gates. | Same current inventory-capability defaults; no separate construction/manufacturing gate. | Strong overlap with the production `stock_transfers` workflow. The construction “store-to-site transfer preparation” is separate only in name: it does not execute that workflow. | `/transfers` creates, approves, dispatches, and receives persisted stock transfers between inventory locations. The construction preparation section stores notes in React state only and explicitly does not reserve/decrease/increase stock, create in-transit stock, or post accounting. |
| **Contacts** | Organisation | `/contacts` | `ContactsPage` | Growth+ via `accounting_organisation`; also subject to role access. | No business-type/vertical filter in nav or route. | Customer and Supplier are tabs within one Contacts page and one `contacts` table—not separate routes/pages. | Page filters the shared table by `contact_type` (`customer` or `supplier`), edits/deletes contacts, and shows recent invoice/expense totals. The localized sidebar label is already “Contacts”; keep it. |
| **Branches** | Organisation | `/branches` | `BranchesPage` | Growth+ via `accounting_organisation`; also subject to role access. | No business-type/vertical filter. | Adjacent to Sites and inventory locations, but not the same entity. Branch creation also creates a linked stock location. | `branches` stores the operating/selling point and a free-text address; `inventory_locations` stores stock locations and may reference a `branch_id`. The page describes branches as selling points and stock locations. Its data model does not represent project/job sites. |
| **Sites** | No nav item. Site name/location are only fields in the Construction draft workspace. | No `/sites` or `/locations` route found. Related draft routes are `/construction` and `/projects-funding-sources/construction-draft`. | No `SitesPage`; fields appear in `ConstructionProjectSetupDraftPage`. Both draft routes render that same component. | No PlanGate, PartnerPlanGate, or CapabilityGate on the construction draft routes. Authenticated-only; the routes sit outside `RoleRoute`. | No construction-type check; route is not gated to Construction. No Manufacturing equivalent. | Semantically adjacent to Branches and `inventory_locations`, but no canonical Sites record exists to duplicate today. | `siteName` and `siteLocation` are free text in a local project draft. The page says it does not load or save project records and clears drafts on refresh/route exit/business switch. No `sites` table was found in generated types or migrations. |
| **Departments** | Organisation | `/departments` | `DepartmentsPage` | Growth+ via `accounting_organisation`; also subject to role access. | No business-type/vertical filter. | Related to Branches through optional `branch_id`, but not a duplicate: departments carry a cost-centre/accounting dimension. | `departments` has `name`, `code`, optional `cost_centre`, and optional `branch_id`. The UI supports company-wide or branch-linked departments. |

### Gate interpretation

- Inventory items are not hidden from the sidebar merely because a plan is too low: the sidebar marks plan-locked items and prevents navigation; route gates independently enforce access. For the Inventory analogues, the route wraps a `PartnerPlanGate` for the `inventory` partner feature and plan capability, then a `CapabilityGate` for organisation/role capability. The `inventory` plan capability starts at **Starter**.
- Contacts, Branches, and Departments are `minPlan: growth` in nav configuration and use `PlanGate capability="accounting_organisation"` in `App.tsx`; that capability first appears at **Growth**.
- Construction is the exception: `Construction workspace` has `allowAllAuthenticatedRoles: true`, and both draft routes are protected by authentication/layout but are outside the `RoleRoute` group and have no plan or vertical gate. This is inconsistent with the requested Construction Enterprise-only policy.
- The user-specified business categories are `construction`, `manufacturing`, `retail`, `services`, and `distribution`, and a business can select more than one. The checked-in `OPERATING_MODELS` vocabulary is instead `RETAIL`, `WHOLESALE`, `PRODUCT_SALES`, `SERVICE_SALES`, `PROJECT_BASED`, and `GRANT_FUNDED`. `construction`, `manufacturing`, and `distribution` are not selectable operating-model values; `services` is represented as `SERVICE_SALES`, and `RETAIL` is a direct match. Do not silently equate `PROJECT_BASED` with Construction or `WHOLESALE` with Distribution. `operating_models` is a `text[]`: any new business-type filter against the raw array should use `.includes()` and support multiple selections. The current capability-default helper normalizes that array to a `Set` and uses `.has()` internally; the business-creation form also treats selections as an array with `.includes()`.

## Five-pair duplication comparison

These are the five closest live comparisons among the requested labels and their existing equivalents/subtypes. A “merge” verdict means one nav destination and one underlying workflow, not necessarily that every label should be identical for every vertical.

| Pair | Route / component comparison | Data-table comparison | Verdict |
|---|---|---|---|
| **Materials ↔ Products** | No Materials route/component. `/products` → `ProductsPage`. A separate `/inventory` route exists but currently renders only “Coming soon.” | Products uses `products` and joins inventory behavior through balances and locations. Construction receipt notes accept free-text material names; they do not select or mutate a product. | **Merge as one catalog.** Keep one Products route/data model; optionally show the label “Materials” for a relevant vertical, but do not add a second catalogue/table. Redirect the placeholder `/inventory` route to `/products` or remove it after confirming callers. |
| **Site Stores ↔ Warehouse / stock locations** | No Site Stores route. `/warehouse` → `WarehousePage`; no standalone location-management page was found. | Warehouse uses `inventory_locations` and `inventory_balances`. Branches can create a location linked by `branch_id`; there is no `site_stores` table. | **Consolidate under one location concept.** Prefer “Stock locations” as the generic label; use “Site stores” only as contextual copy for a construction workflow. Add location CRUD before suggesting Settings → Locations or treating this as a complete site-store manager. |
| **Materials Transfer ↔ Transfers** | No Materials Transfer route. `/transfers` → `TransfersPage` backed by `TransferRepository`. Construction has a `MaterialTransferPreparationSection` embedded in the draft page, not a standalone page. | Real workflow: `stock_transfers` + `stock_transfer_lines`, with `stock_movements` recorded at dispatch/receipt. Draft preparation: no DB table; in-memory component state only. | **Merge for the production workflow.** Keep one real transfer route/table; contextualize its label if useful. Keep the preparation prototype clearly marked as local-only, or retire it when a real project-linked flow replaces it. Never count its notes as a posted transfer. |
| **Contacts ↔ Customers / Suppliers** | `/contacts` → one `ContactsPage`; customer and supplier are tabs, not separate routes/components. | Both are rows in `contacts`, distinguished by `contact_type`; invoice/expense relationships are shown on the same cards. | **Keep one Contacts item.** Retain Customer/Supplier tabs. Do not add separate top-level Customers and Suppliers destinations unless a genuinely different workflow is introduced. |
| **Branches ↔ Sites** | `/branches` → persisted `BranchesPage`; no `/sites` route or `SitesPage`. Site fields occur only in the local Construction draft. | Branches use `branches` and paired `inventory_locations`; no `sites` table or migration was found. Draft `siteName`/`siteLocation` are not persisted rows. | **Do not merge the concepts.** Branch = business operating/selling unit; Site = project/job location; inventory location = stock point. Add Sites as a distinct persisted entity only when project/site workflows require it, with explicit links rather than reusing branch/address fields. |

## Vertical-alignment matrix

The matrix distinguishes **what this checkout does** from the requested target policy. “Generic Inventory family” means the analogues for Materials, Site Stores, and Materials Transfer. Contacts, Branches, and Departments currently share the same Growth+ plan gate and have no vertical filter. Sites are absent. Construction/Manufacturing-specific behavior must be Enterprise-only; POS is included as a policy cross-check even though it is not one of the seven audited items.

| Business type | Generic Inventory family in current code | Contacts / Branches / Departments in current code | Sites in current code | Requested alignment / gate outcome |
|---|---|---|---|---|
| **Construction** | No direct `CONSTRUCTION` model/default. Inventory capability is off by default for unrecognized models, unless explicitly overridden. The local Construction draft is separate from inventory. | Growth+; no vertical filter. | No Sites record/route; only local draft text. | Construction-specific Materials/Site Stores/Materials Transfer/Sites behavior must require **Construction + Enterprise**. Do not substitute `PROJECT_BASED` without an approved mapping. |
| **Manufacturing** | No direct model, route, or default. A `MANUFACTURING` value is not one of the selectable current operating models. | Growth+; no vertical filter. | No Sites record/route. | Manufacturing-specific surfaces must require **Manufacturing + Enterprise**. The current code has no such vertical gate or product workspace. |
| **Retail** | Default inventory capability is enabled by `RETAIL`; therefore the three generic Inventory analogues can appear when plan, partner, and role gates pass. | Growth+; no vertical filter. | Absent. | Inventory family is aligned when Retail is selected. POS should be available only when Retail is selected; current defaults match, but an explicit capability override can enable POS outside Retail, so the invariant is not hard-enforced. |
| **Services** | `SERVICE_SALES` enables the services capability, not inventory by default. Inventory can be explicitly overridden. | Growth+; no vertical filter. | Absent. | Do not show construction/manufacturing-specific labels or Sites by implication. Generic inventory can remain available only if the business has a stock-related model or explicit eligible capability. POS must remain Retail-only even if another profile override is set. |
| **Distribution** | No direct `DISTRIBUTION` model. Inventory defaults on for `WHOLESALE`, but treating that as Distribution is a product mapping decision, not a current-code fact. | Growth+; no vertical filter. | Absent. | Decide and document whether Distribution maps to `WHOLESALE`; until then, do not claim the current vertical gate aligns. POS remains unavailable unless Retail is also selected. |

**Multi-type rule:** apply vertical match as an **any-selected-type** test over the `operating_models` array, then AND it with the independent plan, partner, role, and capability gates. Thus a mixed `construction + retail` business may satisfy the Retail-only POS vertical test, but its Construction-specific workflows still require Enterprise. A non-Retail type or a manual capability override must not bypass the Retail-only POS rule. For Construction/Manufacturing-specific surfaces, require the corresponding type and Enterprise; do not make the generic Starter+ Inventory tier Enterprise-only unless that broader policy is explicitly intended.

## Recommendations

### Keep, move, merge, or remove

1. **Keep one product catalogue.** Reuse `/products` and `products` for both generic Products and construction/manufacturing Materials. If wording should vary by vertical, make it a contextual label on the same route; never add a second “Materials” catalogue with duplicate product IDs/stock.
2. **Keep stock locations within Inventory.** Reuse `inventory_locations`; do not create a parallel `site_stores` table merely to change the sidebar label. Add a real location-management surface (or a clear location-management entry point) before calling `/warehouse` “Site Stores.” The current Warehouse page is primarily stock/receiving and the Settings → Locations instruction has no matching Settings tab.
3. **Keep one real transfer workflow.** Reuse `/transfers`, `stock_transfers`, and `stock_transfer_lines`. Use “Materials Transfer” only as contextual naming for construction/manufacturing if desired. The local draft preparation is not a substitute for dispatch/receipt. Preserve its explicit “local only” warning until it is integrated or remove the prototype from the production navigation.
4. **Keep Contacts unified.** Keep the current Contacts label and customer/supplier tabs. Do not split those tabs into duplicate sidebar items.
5. **Keep Branches distinct from Sites and inventory locations.** Branches are business units/selling points and can own a stock location; a project site is a different business concept. Do not repurpose `branches.location` or `inventory_locations.name` as the canonical project site.
6. **Add Sites only with persistence and a real workflow.** If Sites means construction project/job locations, add a canonical persisted site model and route with project/business ownership and optional relationships to a branch and/or stock location. Do not promote the draft’s free-text fields into a claim that saved Sites already exist.
7. **Keep Departments under Organisation.** Their cost-centre and optional branch association make them an accounting/org dimension, not a branch or site duplicate.
8. **Resolve the placeholder `/inventory` path.** The sidebar helper aliases it to Products while the route renders an empty “Coming soon” page. Redirect to `/products` or remove the placeholder route after checking incoming links; do not add it as another Inventory item.

### Naming and gating

- Prefer one canonical nav destination for each data/workflow concept. Recommended shared labels: **Products/Materials** (one catalogue), **Stock locations** (one location concept), and **Stock transfers/Materials transfers** (one transfer workflow). Avoid implying that Warehouse is a site registry.
- Keep the current generic inventory plan floor at Starter+ where that is intended. Apply an **Enterprise plan gate plus a matching Construction or Manufacturing business-type gate** to vertical-specific features. The current `PlanCapability` list has no construction/manufacturing capability and the Construction nav item has no `minPlan`.
- Enforce vertical gates in both sidebar visibility and the route/component boundary; a hidden nav item alone is not an access gate. Keep role and partner checks independent.
- Enforce **POS = Retail-only** as a hard business-type condition, not merely the current default profile value. Do not let `capability_overrides.pos = true` expose POS for Services, Construction, Manufacturing, or Distribution without Retail being selected.
- Represent multi-type eligibility as array membership over all selected values, with vertical matching OR-ed across selected types and plan/partner/role checks AND-ed. First establish explicit stored values/mappings for the five requested types; do not silently equate `PROJECT_BASED` with Construction or `WHOLESALE` with Distribution.

### Before / after navigation structures

**Before — current checked-in sidebar**

```text
Inventory
  Products       /products
  Warehouse      /warehouse
  Transfers      /transfers

Organisation
  Contacts       /contacts
  Branches       /branches
  Departments    /departments

Construction
  Construction workspace  /construction
```

There are no sidebar labels or paths for Materials, Site Stores, Materials Transfer, or Sites. `/inventory` exists as a non-sidebar placeholder route.

**After — recommended logical structure**

```text
Inventory
  Materials / Products          one catalogue and one /products route
  Stock locations               one location model; /warehouse plus location management
  Materials / Stock transfers   one real /transfers workflow

Organisation
  Contacts                      customer + supplier tabs
  Branches                      operating/selling units
  Sites                         new persisted project/site entity, if required
  Departments                   cost centres / branch-linked departments
```

Use the “Materials” and “Materials transfer” labels only as context-sensitive names for the same shared Inventory implementations. Keep Sites separate from Branches and stock locations. Keep the Construction workspace separate only if it becomes a persisted, Construction-gated Enterprise feature; until then, label it unmistakably as a local draft or remove it from production navigation.

## Source evidence reviewed

- Navigation definitions and filtering: `src/components/layout/navConfig.ts`; sidebar locked-item behavior: `src/components/layout/Sidebar.tsx`.
- Route wrappers and component mapping: `src/App.tsx`.
- English labels: `src/i18n/locales/en.json` (`navigation.sections` and `navigation.items`).
- Plan tiers/capabilities: `src/lib/billing/plans.ts`; business profile and capability defaults: `src/lib/capabilities/profile.ts`, `src/hooks/useCapability.ts`, and the operating-model form in `src/pages/CreateBusinessPage.tsx`.
- Construction draft behavior: `src/pages/ConstructionProjectSetupDraftPage.tsx`, `src/lib/projectsFundingSources/constructionWorkspaceDraftValidation.ts`, `src/components/construction/MaterialReceiptPreparationSection.tsx`, and `src/components/construction/MaterialTransferPreparationSection.tsx`.
- Persisted page/repository behavior: `src/pages/ProductsPage.tsx`, `src/pages/WarehousePage.tsx`, `src/pages/TransfersPage.tsx`, `src/pages/ContactsPage.tsx`, `src/pages/BranchesPage.tsx`, `src/pages/DepartmentsPage.tsx`; `src/dal/repositories/ContactRepository.ts`, `BranchRepository.ts`, `DepartmentRepository.ts`, `InventoryRepository.ts`, and `TransferRepository.ts`.
- Table evidence: `src/dal/types/database.generated.ts` includes `branches`, `contacts`, `departments`, `inventory_locations`, `products`, `inventory_balances`, `stock_transfers`, `stock_transfer_lines`, and `stock_movements`; no `sites` table was found. `src/pages/SettingsPage.tsx` has no Locations tab despite the Warehouse page’s Settings → Locations instruction.
