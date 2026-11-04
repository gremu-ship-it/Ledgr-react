# Construction Vertical — Organisational Customisation Audit

**Phase 1 deliverable — audit only. No code changes accompany this document.**

| | |
| --- | --- |
| **Date** | 2026-10-21 |
| **Repo evidence base** | `gremu-ship-it/Ledgr-react` @ `8032074` (tip of `main`, merge of PR #238) |
| **Live DB evidence base** | Supabase project `hsuhuvuxfuufrlejsatw` ("Ledgr", eu-west-1, production) — `information_schema`, `pg_constraint`, `pg_policies`, `pg_proc` and demo-business data queried read-only on 2026-10-21 |
| **Demo business** | `d38e4ce8-324b-4d27-b42d-74c25c5288a7` — "Demo company Ltd", `plan_tier = enterprise` |
| **Status** | 🔎 **For review — Phase 2 scope requires approval of this report first** |

> **Note on the checkout.** The audit branch was cut from an older commit (PR #213 era) that
> pre-dated the entire construction/manufacturing codebase. The branch was fast-forwarded to
> `origin/main` (`8032074`) before the audit so that every file path and line reference below
> is against the code that is actually live. The only commit added by this phase is this
> document.

---

## Executive summary

1. **The construction vertical is far more built-out than the task brief assumed.** The live
   database carries 21 `construction_*` tables plus `project_*` tables (BOQ, valuations,
   retention ledger, status log), ~76 construction/manufacturing RPCs, and the repo carries a
   full Construction workspace (`/construction/*`), Manufacturing module (`/manufacturing/*`),
   capability gating, and vocabulary swaps. `construction_projects` **does** exist and has full
   CRUD UI.
2. **The core reported gap is real: `inventory_locations` has no CRUD UI anywhere.** Locations
   can only be born as side effects — paired 1:1 with a branch on the Branches page, created by
   the provisioning RPCs, or linked to a project as a "site". They can never be renamed,
   re-typed, re-defaulted, deactivated on their own, or created standalone. `WarehousePage.tsx`
   even tells users *"Go to Settings → Locations to add one first"* — **that tab does not
   exist** (Settings tabs are business/financial/profile/security/team/privacy/api/billing/
   appearance).
3. **"Sites" already exist — twice, and they overlap.** (a) `construction_procurement_sites`
   (branch + inventory location + free-text `project_ref`), registered from Construction →
   Setup, create/upsert only, no edit or deactivate UI; and (b) "project sites" =
   `inventory_locations.project_id` links managed from the Project detail → Sites tab. Neither
   is a `location_type`; the `location_type` CHECK constraint admits **only manufacturing
   vocabulary** (`warehouse`, `raw_materials_store`, `production_floor`, `finished_goods_store`).
   There is no `job_site` / `site_office` / `material_yard` value, and **no "WIP Store"**
   location type exists anywhere (WIP is a CoA account + dashboard metric, not a store).
4. **Cost centres do not exist as an entity.** The only concept is a free-text
   `departments.cost_centre` code consumed by payroll import and journal-entry labels.
5. **Construction clients are free text.** `construction_projects.client_name` is bridged to
   `contacts` **by name matching** at valuation-invoice time
   (`_ledgr_construction_billing_contact`), which auto-creates a customer contact on miss. The
   demo business already shows the risk this creates: projects billed to both `"MOH"` and
   `"Ministry of Health"` — two name variants of one client, which name-matching will treat as
   two contacts.
6. **i18n is inconsistent across the vertical.** Construction *projects/reports/dashboard* UI is
   fully translated (`construction.*` keys), and manufacturing UI is translated
   (`manufacturing.*`), but **all 12 construction procurement components** (Setup, POs,
   receipts, bill matching, material issues, returns, overview, delivery note/GRN forms,
   shared `constructionUi.tsx`) ship **hard-coded English** — including the site registration
   form. Several workspace tab labels in `ConstructionWorkspacePage.tsx` are hard-coded too.
7. **`src/dal/types/database.generated.ts` is stale.** It pre-dates the construction and
   manufacturing schemas (no `construction_projects`, no `location_type`, no `project_id` on
   locations). Construction code compensates with hand-written interfaces
   (`ProjectRepository.ts`, `LocationRow` in `WorkOrderCreatePage.tsx`), so type safety in the
   vertical is locally maintained, not generated.

**Recommended Phase 2 scope** (detail in §1.2/§1.4): Settings → Locations tab (biggest unblock,
no migration needed for the minimum), construction `location_type` values (small migration),
construction client linkage on projects (migration + backfill), site status management
(new RPC + UI), and i18n keys for everything new. A standalone cost-centre entity is
**recommended against** for Phase 2 (cross-vertical ledger concern, see §1.4.2).

---

## 1.1 Inventory & reality check

Legend — **Table**: live DB object. **Migration**: where the repo defines/converges it.
**CRUD UI**: user-reachable create/read/update/delete. **Consumers**: dropdowns, selectors,
forms. **Construction-aware**: vertical filtering, fields, vocabulary.

### 1.1.1 Inventory locations / stores — `public.inventory_locations`

| Aspect | Finding |
| --- | --- |
| **Table exists?** | ✅ Yes. Live columns: `id, business_id, branch_id (FK branches, nullable), name, code, is_default, is_active, created_at, project_id (FK construction_projects ON DELETE SET NULL, nullable), location_type (text NOT NULL DEFAULT 'warehouse', CHECK)`. |
| **Migrations** | Base table: `supabase/migrations/20250101000000_base_schema.sql` (line 665). `project_id` FK: `20261028000000_construction_projects.sql` (line 599). `location_type` + CHECK: `20261103000000_manufacturing_foundation.sql` §3 (lines 314–345). Role-aware RLS: `20260728000008_role_aware_master_data_rls.sql`. Branch-scoped access: `can_access_location()` in `20261007000000_p5d_branch_scope_remediation.sql` (line 80). Project-link guard trigger `_ledgr_project_location_guard`: `20261028000000_construction_projects.sql` (line 820). |
| **CRUD UI?** | 🔴 **No dedicated UI.** Create happens only as a side effect: (a) `BranchRepository.createWithLocation()` (`src/dal/repositories/BranchRepository.ts` lines 56–80) auto-inserts one location per new branch from `src/pages/BranchesPage.tsx`; (b) provisioning RPCs (§1.3); (c) `link_site_to_project` / `unlink_site_from_project` RPCs set `project_id` from Project detail → Sites tab (`src/components/construction/projects/ProjectDetail.tsx` lines 243–330). Update: only `is_active=false` cascade when a branch is deactivated (`BranchRepository.deactivateBranch`, lines 90–101). **No rename, no code edit, no default-flag control, no type change, no standalone create, no reactivate, no delete UI.** |
| **Referenced where?** | Warehouse/"Site Stores" page — receive-into location picker + location filter (`src/pages/WarehousePage.tsx` lines 103–125, 553+); Transfers — from/to pickers (`src/pages/TransfersPage.tsx` lines 179–187, 511+); Products — stock adjustment location (`src/pages/ProductsPage.tsx` lines 582, 720+); Branches — read-only "Stock location" card (`BranchesPage.tsx` lines 123–125, 166–171, 309); Work orders — source/destination pickers with type-based defaults (`src/pages/manufacturing/WorkOrderCreatePage.tsx` lines 26–38, 69, 226–260; `WorkOrderDetailPage.tsx` consumption/return flows); Construction setup — branch→location cascade in `SiteForm` (`src/components/construction/ConstructionSetupSection.tsx` lines 41–49, 219–232); material issues/returns resolve stock via `site.location_id` (`ConstructionMaterialIssuesSection.tsx` lines 64–74); PO→GRN documents inherit the site's location server-side; POS resolves a till location via `_ledgr_pos_stock_location` (live RPC); balances are per business × product × location (`inventory_balances`). |
| **Construction-aware?** | 🟡 Partial. Yes: `project_id` FK makes a location a *project site*; `can_access_location` enforces branch scope; nav/page vocabulary swaps "Warehouse"→"Site Stores" (`CONSTRUCTION_LABEL_OVERRIDES` in `src/components/layout/navConfig.ts` lines 192–196; `src/hooks/useInventoryPageLabels.ts`; `pages.inventory.siteStores` keys in `en.json`). No: `location_type` has **zero construction values** — the CHECK admits only `warehouse`, `raw_materials_store`, `production_floor`, `finished_goods_store` (manufacturing vocabulary). |
| **RLS (live)** | `inventory_locations_member_read` (SELECT, any member), `inventory_locations_writer_insert` / `inventory_locations_writer_update` (`can_write_business_data`), `inventory_locations_admin_delete` (`can_admin_business_data`). **A UI can therefore write locations directly — no new RPC is strictly required for basic CRUD** (unlike the construction tables, which are RPC-only). |
| **Demo business live data** | 8 active locations: Blantyre Branch, Lilongwe Branch, Head Office, Mchinji Branch (all `warehouse`, paired to branches), **Main Store** (`warehouse`, `is_default`, project-linked), **Raw Materials Store** (`raw_materials_store`), **Production Floor** (`production_floor`), **Finished Goods Store** (`finished_goods_store`). Two locations carry `project_id = 74093a8b…` (Main Store and the Blantyre Branch store are linked as sites of one project). |

### 1.1.2 Branches — `public.branches`

| Aspect | Finding |
| --- | --- |
| **Table exists?** | ✅ Yes. Columns: `id, business_id, name, code, location (free text), manager_id, is_active, created_at, updated_at, deleted_at`. Base schema (`20250101000000_base_schema.sql`). |
| **CRUD UI?** | ✅ `src/pages/BranchesPage.tsx` (route `/branches`, nav `minPlan: 'growth'`): create (auto-pairs a location), edit (name/code/location text), deactivate (soft-deletes branch **and** deactivates its locations). No hard delete, no reactivate (deactivate sets `deleted_at`, and the list filters it out). |
| **Referenced where?** | Departments (branch link), POS/tills, stock movements & branch scoping (`can_access_branch`, `20261007000000_p5d_branch_scope_remediation.sql`), construction sites (`construction_procurement_sites.branch_id NOT NULL`), construction branch scope (`20261023000000_construction_branch_scope.sql`), AI branch context (`20261008000000_p5e_ai_branch_context.sql`). |
| **Construction-aware?** | 🟡 Conceptually yes, structurally no. Construction provisioning creates a **"Main Site"** branch (code `MAIN`) as the site anchor, and every procurement site must map to a branch; construction branches appear in site/PO flows. But `branches` itself has no vertical fields, and the retail vocabulary ("Branches", "selling points") is **not** swapped for construction (only Products/Warehouse/Transfers got the vocabulary pass). |
| **Known rough edges** | Renaming a branch does **not** rename its paired location (`BranchRepository.updateBranch` touches only `branches`) → name drift between "Blantyre Branch" (branch) and its store. Deactivated locations/branches cannot be reactivated from UI. |
| **Demo business live data** | 6 branches: Blantyre, Lilongwe, Head Office, Mchinji + **Main Site** (construction provisioning) + **Main Factory** (manufacturing provisioning). |

### 1.1.3 Contacts / clients — `public.contacts`

| Aspect | Finding |
| --- | --- |
| **Table exists?** | ✅ Yes. `contact_type` CHECK (live): `customer \| supplier \| both`. Rich fields: TPIN, VAT, mobile money, credit limit/terms, `ar_account_id`/`ap_account_id`, WHT exemption, soft delete. Base schema + `20260927000001_r04_contacts_writer_scope.sql`. |
| **CRUD UI?** | ✅ `src/pages/ContactsPage.tsx` (route `/contacts`, `minPlan: 'growth'`): customer/supplier tabs, add/edit modal, soft delete (`ContactRepository.deleteContact` sets `deleted_at`). The `'both'` type is accepted by the DB but **not selectable in the UI**. |
| **Construction clients?** | 🔴 **No client entity link.** `construction_projects.client_name` is free text (NOT NULL DEFAULT `''`). When a valuation generates an invoice, `_ledgr_construction_billing_contact(business, client_name)` (`20261031000001_construction_progress_valuations.sql` line 1072) resolves a contact by **case-insensitive exact name match** (`contact_type IN ('customer','both')`) or **auto-creates** a bare customer contact. There is no FK, no picker, no per-client retention preference, no multi-contract view. Live demo data already shows the failure mode: projects against `"MOH"` and `"Ministry of Health"` — the same real client under two names → two contacts on first billing. |
| **Construction-aware?** | 🟡 Only via that billing bridge and supplier validation (below). ContactsPage itself is vertical-neutral (no construction vocabulary, no client-vs-customer distinction). |
| **Demo business live data** | 4 contacts, all `customer` (Walk-in Customer, BioLabs Foundation LTD, ENHHL Ltd.co, Titus). **0 suppliers** — which blocks construction PO creation until one is added (PO command validates an active supplier contact). |

### 1.1.4 Departments — `public.departments`

| Aspect | Finding |
| --- | --- |
| **Table exists?** | ✅ Yes. Columns include `branch_id` (nullable), `code`, **`cost_centre` (free text)**, `head_user_id`, soft delete. Base schema. |
| **CRUD UI?** | ✅ `src/pages/DepartmentsPage.tsx` (route `/departments`, `minPlan: 'growth'`): create/edit modal (name, code, cost centre text, optional branch), deactivate. |
| **Referenced where?** | Payroll — employee department pickers show `Name [cost_centre]` (`src/components/payroll/EditEmployeeModal.tsx` line 252), CSV import matches on `cost_centre_code` (`ImportEmployeesModal.tsx` lines 51, 244–284), `PayrollRepository.ts` line 114; Journals — department selector with cost-centre label (`NewJournalEntryModal.tsx` lines 80, 312; `JournalEntryDetailModal.tsx` line 259). RLS read note in `20260728000008` explicitly cites "payroll_manager needs departments for cost centres". |
| **Construction-aware?** | 🔴 No. Nothing seeds or labels departments for construction (no Civil / M&E / Finishing / Admin defaults from `provision_construction_defaults`), and no construction flow reads departments. They are available and usable, just generic. |
| **Demo business live data** | 2 departments (Sales & Marketing, Finance & Accounting), both with `cost_centre = NULL`. |

### 1.1.5 Cost centres

| Aspect | Finding |
| --- | --- |
| **Table exists?** | 🔴 **No `cost_centres` table** (verified against live `information_schema` — no match for `%cost_centre%`). The only concept is `departments.cost_centre`, a free-text reference code. |
| **CRUD UI?** | Only as the text field inside the Departments form ("Optional reference code used in ledger reporting", `DepartmentsPage.tsx` line 86). |
| **Referenced where?** | Payroll import/labels and journal-entry department labels (above). **Not** a posting dimension: `journal_lines` has no cost-centre column; overhead allocation cannot be posted against it. |
| **Construction substitute today** | Project-level costing: `construction_project_material_cost()` RPC, Project P&L overview (`ProjectPnlOverview.tsx`), PO/issue/return values per project (`get_project_cost_summary`). Direct costs land on `construction_projects`; **overheads have no allocation target** beyond the decorative department code. |

### 1.1.6 Sites / projects — `construction_projects`, `construction_procurement_sites`, `projects` (view)

| Aspect | Finding |
| --- | --- |
| **Tables exist?** | ✅ `construction_projects` (live columns exactly as briefed: `id, business_id, name, client_name, contract_sum, retention_pct, budget, status, start_date, end_date, created_by, boq_locked_at` + timestamps; `status` CHECK: `tender, active, practical_completion, defect_liability, closed`). ✅ `construction_procurement_sites` (`business_id, branch_id NOT NULL, location_id NOT NULL, site_code, site_name, project_ref TEXT NOT NULL, is_active, created_by`). ✅ `public.projects` — **a compatibility VIEW** over `construction_projects` (verified live `relkind='v'`), left from the namespace repair. |
| **Migrations** | `20261028000000_construction_projects.sql` (table originally as `projects`, lifecycle RPCs `create_project`/`update_project`/`transition_project_status` at lines 611–660, site-link RPCs `link_site_to_project`/`unlink_site_from_project` at lines 661–694, `project_status_log`); `20261028000001_construction_projects_namespace.sql` (rename `projects`→`construction_projects` + view); BOQ `20261030000000`; retention `20261031000000`; valuations `20261031000001`; reporting `20261101000000`; sites registry `20261021000000_construction_procurement_traceability.sql` (`register_construction_procurement_site` at line 556). |
| **CRUD UI?** | **Projects: ✅ complete.** `/construction/projects` → `ProjectsSection.tsx` (list, filter by status, pagination, create), `ProjectForm.tsx` (create/edit, i18n'd), `ProjectDetail.tsx` (overview, status transitions with confirm + reason, **Sites tab**, Procurement tab, BOQ editor, valuations panel + invoice generation + retention release). **Procurement sites: 🟡 create/upsert only** — `ConstructionSetupSection.tsx` `SiteForm` (lines 177–268) calls `register_construction_procurement_site`, which is an **idempotent upsert on `(business, site_code)`** (re-registering the same code re-points branch/location/name/project_ref and forces `is_active=true`). No edit affordance is presented as such, **no deactivate command or UI exists at all** (the table is append-only-guarded; direct writes are refused — see decision matrix §2), and the registered-sites table is read-only. **Project sites (locations): link/unlink only** from ProjectDetail Sites tab. |
| **Referenced where?** | POs, GRNs, delivery notes, material issues/returns all carry `site_id` and inherit branch/location/`project_ref` server-side (caller cannot supply them — `20261021000000` decision matrix §2). `inventory_locations.project_id` + `_ledgr_project_location_guard` trigger. POs/issues/returns also carry `construction_projects.id` FK columns (`20261028000000` lines 596–599). Valuations/BOQ/retention ledger hang off projects. Smart default home route sends CONSTRUCTION businesses to `/construction` (`src/hooks/useDefaultRoute.ts` line 11). |
| **Is a "site" the same as a project?** | **No — and today the codebase encodes "site" twice, neither time as a first-class organisational entity:** (a) a *procurement site* = an operational mapping (one branch + one inventory location + a **free-text** `project_ref` that is *not* an FK to `construction_projects`); (b) a *project site* = any inventory location with `project_id` set. A location can be linked to at most one project at a time; a site's `project_ref` can be re-pointed by re-registration, so "a site hosting multiple projects over time" is *technically* expressible but leaves no history and no linkage between the two site concepts. |
| **Demo business live data** | 5 projects (Hospital Building/MOH, School Block Renovation/Ministry of Education ×2 — duplicated, Lilongwe Hospital Building/Ministry of Health, Blantyre Residential Complex/Private Developer; all `active`). **0 registered procurement sites** — so POs, GRNs and material issues are all blocked in the demo business until someone with `procurement.master.manage` registers one (12 active grants exist, so the capability is held). |

### 1.1.7 Suppliers / vendors

| Aspect | Finding |
| --- | --- |
| **Table exists?** | No dedicated table — suppliers are `contacts` with `contact_type IN ('supplier','both')` (live CHECK confirms the vocabulary). |
| **CRUD UI?** | ✅ ContactsPage → Suppliers tab (same CRUD as customers). |
| **Construction-aware?** | ✅ Meaningfully. `create_construction_purchase_order` **requires an active supplier contact of the business** (server-side validation, decision matrix §2); the PO form lists only suppliers (`ConstructionPurchaseOrdersSection.tsx` lines 92–94); supplier bills live in the existing `expenses` module with a construction switch that suppresses the legacy stock hook (`src/pages/ExpensesPage.tsx` lines 367–369, 1003, 1125–1146); `register_construction_supplier_invoice_reference` records the supplier's own invoice reference with duplicate refusal + evidenced exceptions (`construction_supplier_invoice_references` table). |
| **Gaps** | No construction-specific supplier attributes (prequalification, retention held on payables, approved-vendor lists per site). `'both'` type unreachable from UI. Demo business has **0 suppliers**, silently blocking the whole procurement chain until a contact is added. |

---

## 1.2 Gap analysis

| # | Entity | Status | Why |
| --- | --- | --- | --- |
| 1 | Inventory locations | 🟡 **Partial** | Table + RLS + consumers complete; **no CRUD UI**; dangling "Settings → Locations" pointer; no construction `location_type` values |
| 2 | Branches | ✅ **Complete** (minor caveats) | Table + full CRUD UI + used as construction site anchor; caveats: branch↔location name drift on rename, no reactivation |
| 3 | Contacts / clients | 🟡 **Partial** | Retail customer/supplier CRUD complete and construction-procurement-aware for suppliers; **construction clients are free text with a name-match billing bridge**; `'both'` type not exposed |
| 4 | Departments | ✅ **Complete** (for its purpose) | Table + CRUD UI + payroll/journal consumers; not construction-aware, but no construction flow depends on departments today |
| 5 | Cost centres | 🔴 **Missing** | No table; only `departments.cost_centre` free text; not a posting dimension |
| 6 | Sites / projects | Projects ✅ / Sites 🟡 | Projects: full CRUD + lifecycle + BOQ + valuations. Sites: two overlapping half-entities; procurement sites create-only (no edit/deactivate UI, free-text `project_ref`); project-site links are a boolean-ish toggle with no site attributes |
| 7 | Suppliers | ✅ **Complete** (minor caveats) | Contacts-as-suppliers + hard server-side validation in construction procurement + invoice-reference registry; no vertical-specific supplier fields |

### Proposed fixes for each 🟡 / 🔴

#### 1. Inventory locations — 🟡

- **Minimum viable fix (unblock users):** *Settings → Locations* tab with full CRUD against the
  existing table: list (name, code, type, branch, default, active, project), create, edit
  name/code/branch/type, set-default (single-default invariant enforced client + server),
  deactivate/reactivate. **No migration required** — existing role-aware RLS already permits
  writer-tier INSERT/UPDATE and admin-tier DELETE. Also fix the `WarehousePage.tsx:110` message
  to deep-link to the real tab (`/settings?tab=locations`). Reuse the existing vocabulary hook
  so construction businesses read "Site Stores". Guard rails: refuse deactivating a location
  with non-zero `inventory_balances` or open construction documents; refuse deactivating the
  last default; keep branch-paired locations in sync on rename (fixes the drift caveat).
- **Full fix (proper multi-vertical):** the above **plus** (a) construction `location_type`
  values (see §1.3/§1.4.1) gated by `useBusinessProfile()` so non-construction businesses never
  see them (absent, not locked — matches the navConfig pass-1 doctrine); (b) show `project_id`
  linkage read-only with a jump to the project; (c) regenerate `database.generated.ts` so
  `location_type`/`project_id` are typed instead of hand-rolled; (d) location-type labels via
  `manufacturing.locationType.*` extended with `warehouse` + construction keys.
- **Effort:** minimum ≈ **2–3 dev-days** (UI + tests, no migration). Full ≈ **4–6 dev-days**
  (adds ~0.5-day constraint migration, i18n retrofit of the touched strings, type regen).

#### 3. Contacts / clients — 🟡

- **Minimum viable fix:** in `ProjectForm`, replace the free-text client field with a **client
  picker over `contacts` (customer/both)** that still writes `client_name` (display cache) and
  optionally stores the chosen contact id in the existing `notes`-free schema — *without* a
  migration this can only be a picker that guarantees the name matches an existing contact
  (or creates one inline), which already eliminates the MOH/"Ministry of Health" split.
- **Full fix:** add `construction_projects.client_id uuid NULL REFERENCES contacts(id) ON DELETE
  SET NULL`; backfill with the same name-match logic `_ledgr_construction_billing_contact`
  already uses (and report ambiguous/zero matches instead of guessing); switch
  `generate_invoice_from_valuation` to prefer `client_id` and fall back to name; expose
  per-client construction defaults later (e.g. default `retention_pct`) as a follow-up, since
  retention is contract-level today and correctly lives on the project. Multi-contract tracking
  = "projects where client_id = X" (a filter on ProjectsSection).
- **Effort:** minimum ≈ **1 dev-day**. Full ≈ **2.5–3.5 dev-days** (migration + backfill +
  repository/RPC changes + UI + tests).

#### 5. Cost centres — 🔴

- **Minimum viable fix:** *don't build an entity yet.* Formalise what exists: label
  `departments.cost_centre` consistently ("Cost centre code"), document it, and use
  projects as the construction cost object (they already are — material cost, PO value,
  valuations all roll up per project).
- **Full fix (if overhead allocation is a real requirement):** a `cost_centres` table
  (business-scoped, code, name, type: project/department/overhead, active) **plus a posting
  dimension** (`journal_lines.cost_centre_id`) — that is a cross-vertical ledger change
  touching journal validation, reports and the AI views, and it collides conceptually with
  both projects (construction) and departments (payroll). Should be its own epic with its own
  decision record, **not** Phase 2 of a construction-organisational pass.
- **Effort:** minimum ≈ **0.5 dev-day** (docs/labels). Full ≈ **8–12 dev-days** and an ADR —
  recommend deferring.

#### 6. Sites — 🟡

- **Minimum viable fix:** give `construction_procurement_sites` a management surface: a
  **status command RPC** (`set_construction_procurement_site_status(site, active, reason)` —
  new function; the append-only trigger marker pattern already exists for `site_upsert`) and
  an edit/deactivate affordance in the Construction → Setup "Registered sites" table
  (re-registration via the existing upsert already covers "edit"; make that explicit in the UI
  by pre-filling the form from a row). Capability-gated by `procurement.master.manage` exactly
  like registration. **Does not touch `grant_construction_procurement_capability` or any
  self-grant rule.**
- **Full fix:** unify the two site concepts: add `project_id uuid NULL REFERENCES
  construction_projects(id)` to `construction_procurement_sites` (keep `project_ref` text as
  the display/legacy reference), let the SiteForm pick a real project, and cross-link the
  ProjectDetail Sites tab with registered procurement sites so one screen shows both the
  location links and the procurement mapping. Add construction `location_type` values (§1.4.1)
  so a site's store can be typed `job_site`/`material_yard` rather than an untyped `warehouse`.
- **Effort:** minimum ≈ **1.5–2 dev-days** (RPC migration + UI + tests). Full ≈ **4–5 dev-days**.

---

## 1.3 Specific investigation: inventory locations

### Which provisioning function creates the demo stores?

Two functions, both idempotent, both SECURITY DEFINER, both owner/admin-only, both refusing
unless the matching operating model is present (verified in repo **and** live `pg_proc`):

1. **`provision_construction_defaults(business, owner)`** —
   `20261027000000_construction_operating_model_defaults.sql` (function at line 189). Creates
   the **"Main Site" branch** (code `MAIN`), its **"Main Store"** inventory location (claims
   `is_default` only if the business has none), and the twelve `procurement.*` capability
   grants for the owner (source `registration_bootstrap`, deliberately bypassing — not
   modifying — `grant_construction_procurement_capability`'s self-grant prohibition).
2. **`provision_manufacturing_defaults(business, owner)`** —
   `20261103000000_manufacturing_foundation.sql` (function at line 670). Creates the
   **"Main Factory" branch** (code `FACTORY`) and the three typed stores — **Raw Materials
   Store** (`raw_materials_store`), **Production Floor** (`production_floor`), **Finished Goods
   Store** (`finished_goods_store`) — plus the `manufacturing.bom.manage` grant.

Call sites: registration (`src/pages/CreateBusinessPage.tsx` lines ~658, ~681) and Settings →
Business profile when CONSTRUCTION / MANUFACTURING is newly added to `operating_models`
(`src/pages/SettingsPage.tsx` `BusinessProfileTab` mutation; repository wrappers in
`src/dal/repositories/BusinessRepository.ts` lines 157–206). Removing a model **revokes
nothing** by design ("the site, location and grants stay for a later re-add").

**Live demo-business confirmation:** branches include Main Site + Main Factory; the four
stores exist with the exact types above. Note two discrepancies with the task brief:
- The demo business actually has **8** locations, not 4 — the four branch-named `warehouse`
  locations (Blantyre/Lilongwe/Head Office/Mchinji) came from branch creation pairing.
- There is **no "WIP Store"** location anywhere (repo or live): the CHECK constraint has no
  such value and no code seeds one. "WIP" exists only as the *WIP Inventory* CoA account
  (`provision_manufacturing_coa_accounts`, codes 1200–1299) and as work-order WIP metrics on
  the manufacturing dashboard. The brief's dropdown list most closely matches the work-order
  **source/destination** pickers (`WorkOrderCreatePage.tsx`), which list *all* locations and
  pre-select by type: source → `raw_materials_store`, destination → `finished_goods_store`
  (falling back to the business default when the type is absent).
- The live `operating_models` for the demo business are
  `{PROJECT_BASED, SERVICE_SALES, PRODUCT_SALES, GRANT_FUNDED, CONSTRUCTION}` — MANUFACTURING
  is **not currently** in the array even though its stores exist, consistent with the
  "removing the model revokes nothing" design — MANUFACTURING was enabled for the demo
  business at some point (running `provision_manufacturing_defaults`), then removed without
  cleanup. (Open PR #237 proposes an idempotent construction + manufacturing demo seed; if it
  merges, this state becomes reproducible by design.)

### Can users add new locations via UI anywhere?

**Only indirectly, and only one per branch.** The sole user-reachable INSERT path is
`BranchRepository.createWithLocation()` behind the Branches page "Add branch" form, which
hard-codes `is_default: false`, no `location_type` (defaults to `warehouse`), and a code
derived from the branch. Everything else is machine-made (provisioning RPCs) or mutation of
existing rows (`link_site_to_project`, branch-deactivation cascade). There is no way to:
create a store without a branch (e.g. a second store at one site, a material yard, a site
office), rename/re-code a location, change its type, move the default flag, deactivate one
location without killing its branch, or reactivate anything.

### Does the Settings page have a Locations tab?

**No.** `src/pages/SettingsPage.tsx` line 119:
`type Tab = 'business' | 'financial' | 'profile' | 'security' | 'team' | 'privacy' | 'api' | 'billing' | 'appearance'`.
The only in-app reference to such a tab is the dead-end message in the Warehouse receive modal
(`src/pages/WarehousePage.tsx` line 110): *"No warehouse locations found. Go to Settings →
Locations to add one first."* — a business hitting that state has no way to comply except by
creating a branch.

### Are construction-specific location types supported?

**No.** `location_type` is plain `text` (not an enum) with CHECK constraint
`inventory_locations_location_type_check` admitting exactly
`warehouse | raw_materials_store | production_floor | finished_goods_store`
(`20261103000000_manufacturing_foundation.sql` lines 318–341; constraint verified live).
`job_site`, `site_office`, `material_yard` would be rejected with SQLSTATE 23514. Construction
instead expresses site-ness structurally: `project_id` FK (project sites) and
`construction_procurement_sites` (procurement sites). Extending the CHECK is an additive,
low-risk migration (replace constraint with a superset; no data rewrite), but per the vertical
-isolation rule the **UI must offer construction types only to CONSTRUCTION businesses**
(`'CONSTRUCTION' = ANY(profile.operating_models)` via `useBusinessProfile()`), and the
manufacturing types arguably should be offered only to MANUFACTURING businesses — `warehouse`
stays universal.

---

## 1.4 Construction-specific recommendations

### 1.4.1 Should construction have **Sites** as a distinct entity from `construction_projects`?

**Yes — and it already does, twice. The recommendation is to converge, not to add a third.**

- A *project* is a contract (client, contract sum, retention, BOQ, valuations, lifecycle).
  A *site* is a place where material lives and work happens. One site can host projects over
  time; one project can span stores. The current schema accepts that: `project_id` on
  locations is `ON DELETE SET NULL` and can be unlinked/relinked; `site_code` upsert can
  re-point `project_ref`.
- The problem is the **duplication and weak linkage**: `construction_procurement_sites.project_ref`
  is free text (not an FK), while `inventory_locations.project_id` is a real FK — two site
  notions that never meet, and the demo business uses neither (0 procurement sites registered,
  2 locations project-linked).
- **Recommendation (Phase 2 candidate):** keep `construction_procurement_sites` as the canonical
  site registry; add nullable `project_id` FK to it (retain `project_ref` as display text);
  surface registered sites in ProjectDetail (and project links in Setup); add the missing
  deactivate/edit lifecycle (§1.2 item 6). **Do not** create a new `sites` table — a third
  concept would worsen exactly the confusion this audit found.
- **Location typing:** add `job_site`, `site_office`, `material_yard` to the `location_type`
  CHECK so a construction store stops masquerading as a generic `warehouse`; gate the options
  by operating model in the new Locations UI.

### 1.4.2 Should construction have **Cost Centres** separate from projects?

**Not in Phase 2.** Construction *direct* cost is already project-centric and well-instrumented
(PO → GRN → bill match → cost basis → material issue at weighted-average cost →
`construction_project_material_cost` → Project P&L). What's missing is **overhead allocation**,
and that is not a construction feature: it is a ledger posting dimension (journal lines,
reports, budgets) shared by every vertical, and it would collide with both `departments.cost_centre`
(payroll) and projects. Building a construction-only cost-centre table would fragment the chart
of accounts story the vertical deliberately avoids (the construction module posts **nothing**
to the GL by design — see `JOURNAL_BOUNDARY_NOTE` and the receipt posting policy).
**Recommendation:** treat cost centres as a separate cross-vertical epic with an ADR; in the
meantime document `departments.cost_centre` as the overhead reference and keep project =
construction cost object.

### 1.4.3 How should **Clients** differ from retail contacts?

A construction client *is* a contact (it bills through the same AR/invoice machinery —
`generate_invoice_from_valuation` proves it), but the relationship differs:

| Need | Retail contact today | Construction requirement |
| --- | --- | --- |
| Identity | Typed `customer` | Same person, but referenced from projects by **free text** — must become an FK (`client_id`) with name retained as display cache |
| Contracts | Invoices | **Many concurrent contracts** (projects) → client view = filter projects by client; per-client revenue/retention rollup |
| Retention | n/a | `retention_pct` is per-contract (correct place); a per-client *default* retention is a convenience, not a requirement — defer |
| Billing precision | Name typos are cosmetic | Name typos **create duplicate contacts** via the auto-create bridge (live evidence: MOH vs Ministry of Health) — the FK + picker fixes this at the root |
| WHT/TPIN | Already on contacts | Reuse as-is |

**Recommendation (Phase 2 candidate):** add `construction_projects.client_id` (nullable FK,
backfill by exact name match with an ambiguity report), client picker + inline "create
customer" in `ProjectForm`, prefer `client_id` in the valuation invoice path with the existing
name-bridge as fallback. Expose `'both'` contact type in the UI while we're there (suppliers
who are also clients are common in construction).

### 1.4.4 Should **Departments** exist in construction?

**Yes — unchanged.** Departments (Civil, M&E, Finishing, Admin) are an org-structure concern
that the existing DepartmentsPage already serves; nothing in the construction command layer
needs a department FK, and payroll already binds employees to departments. **Recommendation:**
no schema work. Optional low-cost polish: when CONSTRUCTION is newly enabled, offer (not
force) a department template — but provisioning that writes rows the user didn't ask for
conflicts with the "removing the model revokes nothing / provisioning is minimal" doctrine, so
this is a **won't-do unless requested**.

---

## Cross-cutting findings (affect any Phase 2 work)

1. **i18n debt in construction procurement.** All 12 components under
   `src/components/construction/` *except* the `projects/`, `reports/`, `dashboard/` subtrees
   are hard-coded English (verified: no `useTranslation` import), as are several workspace tab
   labels in `ConstructionWorkspacePage.tsx` (`SECTIONS` mixes i18n keys and literals). Phase 2
   must i18n everything **it adds**; retrofitting the existing procurement screens is a
   separate ~2–3-day task that should be explicitly in or out of scope.
2. **Generated types are stale.** `src/dal/types/database.generated.ts` has no construction or
   manufacturing objects; hand-written interfaces fill the gap. Any Phase 2 migration should be
   accompanied by a type regeneration (or at least a targeted supplement) to keep the DAL
   honest.
3. **Write-authority split.** Master-data tables (locations, branches, contacts, departments)
   are directly writable under role-aware RLS (`can_write_business_data` /
   `can_admin_business_data`); construction tables are SELECT-only with append-only triggers —
   every write goes through a capability-checked RPC. New location CRUD can ride the RLS tier;
   new site lifecycle commands must be RPCs with markers, mirroring `site_upsert`.
4. **Gating invariants to preserve** (verified in `navConfig.ts`, `useCapability.ts`,
   `plans.ts`, `App.tsx`): construction/manufacturing are Enterprise-only plan capabilities;
   nav pass 1 **removes** (never locks) items for businesses without the org capability;
   `capability_overrides` can only narrow; routes sit behind `CapabilityGate`; per-operation
   authority stays server-side in capability grants. Nothing in the proposed Phase 2 items
   touches `grant_construction_procurement_capability` or the self-grant rules.
5. **Demo-data reality:** the demo business cannot exercise the procurement chain end-to-end
   today (0 suppliers, 0 registered sites). Whatever Phase 2 builds should be demoed after
   fixing those two data gaps (or alongside open PR #237's demo seed).

## Suggested Phase 2 scope (for approval — NOT started)

Ordered by user-unblock value:

| # | Item | Migration? | Est. |
| --- | --- | --- | --- |
| P2-1 | Settings → **Locations tab** (full CRUD, default handling, branch pairing sync, safe-deactivate guards, vertical-aware type picker, fix WarehousePage dead-end link) | Only if P2-2 included | 2–3 d |
| P2-2 | Extend `location_type` CHECK with `job_site`, `site_office`, `material_yard` (additive superset; options gated by `operating_models`) | Yes (small) | 0.5–1 d |
| P2-3 | **Client linkage**: `construction_projects.client_id` FK + name-match backfill + client picker in ProjectForm + invoice path prefers FK | Yes | 2.5–3.5 d |
| P2-4 | **Site lifecycle**: `set_construction_procurement_site_status` RPC + edit/deactivate UI in Construction → Setup; optional `project_id` FK on sites | Yes | 1.5–3 d |
| P2-5 | i18n for all new strings in `src/i18n/locales/en.json` (+ existing `manufacturing.locationType` extended); optional procurement-component retrofit | No | 0.5–1 d (+2–3 d retrofit) |
| — | Cost centres entity | — | **Deferred** (cross-vertical epic, ADR first) |

Constraints already honoured by this plan: no URL changes; no changes to
`grant_construction_procurement_capability` or self-grant rules; Enterprise gating untouched;
construction-only surfaces remain *absent* (not locked) for non-construction businesses;
`useBusinessProfile().operating_models` (`string[]`) is the membership check; all DB changes
via timestamped migrations in `supabase/migrations/`.

---

## Appendix A — evidence index

**Repo (paths relative to root @ `8032074`):**
`supabase/migrations/20261019000001_business_profile_capabilities.sql` (profile columns) ·
`20261021000000_construction_procurement_traceability.sql` (sites registry L556, capability vocabulary L173–183) ·
`20261023000000_construction_branch_scope.sql` ·
`20261027000000_construction_operating_model_defaults.sql` (`provision_construction_defaults` L189, `update_business_operating_models` §4) ·
`20261028000000_construction_projects.sql` (project_id FK L599, site-link RPCs L661–694) ·
`20261028000001_construction_projects_namespace.sql` (rename + `projects` view) ·
`20261030000000_construction_project_boq.sql` · `20261031000001_construction_progress_valuations.sql` (`_ledgr_construction_billing_contact` L1072) ·
`20261101000000_construction_project_reporting.sql` ·
`20261103000000_manufacturing_foundation.sql` (location_type L314–345, `provision_manufacturing_defaults` L670) ·
`20261104000000_manufacturing_bom.sql` · `20261105000001_manufacturing_work_orders.sql` ·
`20260728000008_role_aware_master_data_rls.sql` (RLS tiers) ·
`20261007000000_p5d_branch_scope_remediation.sql` (`can_access_location` L80) ·
`src/pages/SettingsPage.tsx` L119 (tabs) · `src/pages/WarehousePage.tsx` L110 (dead-end message) ·
`src/pages/BranchesPage.tsx` · `src/pages/ContactsPage.tsx` · `src/pages/DepartmentsPage.tsx` ·
`src/dal/repositories/BranchRepository.ts` L56–101 · `src/dal/repositories/ContactRepository.ts` ·
`src/dal/repositories/ProjectRepository.ts` · `src/dal/repositories/ConstructionProcurementRepository.ts` L694, L895 ·
`src/components/construction/ConstructionSetupSection.tsx` (SiteForm) ·
`src/components/construction/projects/ProjectDetail.tsx` L140, L243 (Sites tab) ·
`src/pages/construction/ConstructionWorkspacePage.tsx` L37–47 (sections) ·
`src/pages/manufacturing/WorkOrderCreatePage.tsx` L26–38 (type-based defaults) ·
`src/components/layout/navConfig.ts` L92–126, L192–196 · `src/hooks/useCapability.ts` ·
`src/hooks/useBusinessProfile.ts` · `src/hooks/useInventoryPageLabels.ts` ·
`src/lib/capabilities/profile.ts` · `src/lib/billing/plans.ts` L93–100 ·
`src/i18n/locales/en.json` (`construction.*`, `manufacturing.locationType` L1064, `pages.inventory.siteStores`) ·
`docs/architecture/CONSTRUCTION_INVENTORY_DECISION_MATRIX_2026-10-16.md` (command/authority matrix).

**Live DB (project `hsuhuvuxfuufrlejsatw`, read-only, 2026-10-21):**
table inventory (33 location/site/project/contact matches) · column dumps for the seven
entities · `inventory_locations_location_type_check` and `contacts_contact_type_check`
constraint defs · `projects` confirmed `relkind='v'` · RLS policy list for the six tables ·
76 construction/manufacturing `pg_proc` entries incl. both provisioning functions ·
12 `construction_procurement_capabilities` rows · demo-business counts: 8 locations,
6 branches, 5 projects, 4 contacts (0 suppliers), 2 departments (cost_centre NULL),
0 procurement sites, 12 active grants; `businesses.operating_models` and `plan_tier` as
quoted above.
