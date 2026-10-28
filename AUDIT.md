# Ledgr React — corrected application audit (current `main`)

**Audit basis:** current `origin/main` source snapshot `a5360fb` (merge of PR #256; it includes the completed Phase 4 work in PRs #246–#256). That tree was read from Git objects without checking out or switching the session branch. The audit PR branch therefore contains this document only; route, type, and implementation citations below refer to the audited `main` snapshot.

**Method and limits:** read-only source audit. No live database was queried; schema inventory is only what `src/dal/types/database.generated.ts` declares, and RPC inventory is only what source `.rpc(...)` call sites invoke. No package install, migration, test, build, or runtime check was performed. A source path proves a declared client implementation, not that a remote migration is deployed or that a workflow succeeds against a live tenant. Facts not established by source are explicitly **Unknown** or **Requires runtime verification**. “i18n: yes/no” below means the routed page module directly imports/uses `useTranslation`; child components can make a page only partially localized.

**Phase labels:** P4 labels are mapped to the Phase 4 PR scopes (#246, #249–#256); #247 and #248 are dependency-only updates. Earlier product phase labels are recorded only when source/PR scope explicitly identifies them. Otherwise they are **Unknown** rather than inferred from route names. “Track A” remains deferred pending review and approval of this audit.

## 1. Complete route inventory

The router has three main families: public/public-only pages; platform/partner administration; and authenticated business routes. Business pages ordinarily sit inside `ProtectedRoute → AppLayout → RoleRoute`; vertical routes have their own capability gate. `ProtectedRoute` waits for auth/business loading, redirects anonymous users to login, and handles users with no accessible business (`src/routes/ProtectedRoute.tsx:8–35`). `CapabilityGate` composes organisation profile, plan, partner and role decisions through `useCapability` (`src/components/billing/CapabilityGate.tsx:23–52`; `src/hooks/useCapability.ts:14–43,60–85`). `PlanGate` is a soft gate which preserves the route and renders an upgrade prompt (`src/components/billing/PlanGate.tsx:25–60`). Exact plan mapping is in `src/lib/billing/plans.ts:8–19,32–109`.

| Route(s) | Routed page / purpose | Guard and plan / capability | i18n | Phase / note |
|---|---|---|---|---|
| `/login`, `/register`, `/forgot-password` | Login, registration, password request | `PublicOnlyRoute`; signed-in user is redirected to their default route | Yes | Auth; phase N/A |
| `/terms-and-conditions` | Legal terms | Public | No | Public; phase N/A |
| `/demo` | Product tour | Public; documented as no auth/tenant data | Yes | Demo; phase N/A |
| `/demo/enter` | Browser-local seeded demo entry | Public | No | Demo; phase N/A; local demo behavior is not a live tenant |
| `/reset-password` | Password recovery completion | Standalone; explicitly available during password recovery | Yes | Auth; phase N/A |
| `/accept-invitation` | Invitation acceptance | Standalone route; no route-level `ProtectedRoute` | Yes | Auth; phase N/A |
| `/create-business` | New business onboarding | `ProtectedRoute`, no `AppLayout`; no page-level plan gate in router | Yes | Onboarding; phase Unknown |
| `/admin/billing`, `/admin/businesses` | Platform billing and tenant administration | `PlatformAdminRoute → AdminLayout`; platform-admin check | No | Platform admin; phase Unknown |
| `/partner-admin` | Partner admin dashboard | `PartnerAdminRoute → PartnerAdminLayout` | No | Partner portal; phase Unknown |
| `/partner-admin/partners/:id`, `/partner-admin/partners/:id/settings`, `/partner-admin/partners/:id/clients`, `/partner-admin/partners/:id/billing` | Partner overview, settings, clients and billing | `PartnerAdminRoute → PartnerAdminLayout` | No | Partner portal; phase Unknown |
| `/projects-funding-sources/construction-draft` | Local construction project draft/preparation surface | Protected business layout + `CapabilityGate(construction)`; not inside the common `RoleRoute` wrapper, but capability resolution checks role | No | Legacy/local draft; phase Unknown. App comment says no repository/backend call (`src/App.tsx:370–400`); not the real project workspace |
| `/construction/*` (internal paths: `/construction` overview; `/construction/projects`; `/construction/projects/:projectId`; `/construction/retention`; `/construction/purchase-orders`; `/construction/receipts`; `/construction/bill-matching`; `/construction/material-issues`; `/construction/returns`; `/construction/setup`) | Real construction workspace; query-parameter deep links include `?po=`, `?grn=` and `?issue=` | Protected business layout + `CapabilityGate(construction)`; Enterprise plan, construction operating profile and role are effective requirements | Yes | Construction workspace; phase label Unknown. Path list and project-detail selection are in `src/pages/construction/ConstructionWorkspacePage.tsx:36–46,73–79,147–172` |
| `/manufacturing`, `/manufacturing/dashboard` | Same manufacturing dashboard | Protected business layout + `CapabilityGate(manufacturing)`; Enterprise, manufacturing profile and role | Yes | Dashboard; specific phase Unknown |
| `/manufacturing/bom` | BOM list | Same manufacturing capability gate | Yes | BOM workspace; Phase B label in nav source (`src/components/layout/navConfig.ts:123–129`); underlying PR phase number Unknown |
| `/manufacturing/bom/new` | BOM creation | Same manufacturing capability gate | Yes | BOM workspace; phase number Unknown |
| `/manufacturing/bom/:id` | BOM detail | Same manufacturing capability gate | Yes | BOM workspace; phase number Unknown |
| `/manufacturing/bom/:id/edit` | BOM edit | Same manufacturing capability gate | Yes | BOM workspace; phase number Unknown |
| `/manufacturing/production` | Work-order list | Same manufacturing capability gate | Yes | Production; Phase C label in nav source (`src/components/layout/navConfig.ts:131–137`); underlying PR phase number Unknown |
| `/manufacturing/production/new` | Work-order creation | Same manufacturing capability gate | Yes | Production; phase number Unknown |
| `/manufacturing/production/:id` | Work-order detail and run/consumption actions | Same manufacturing capability gate | Yes | Production; phase number Unknown |
| `/dashboard` | Business dashboard | Protected business layout + `RoleRoute`; no explicit route-level plan gate | Yes | Core; phase Unknown |
| `/pos` | Point of sale | Protected business layout + `RoleRoute` + `CapabilityGate(pos)`; profile and role; no explicit plan capability mapping | No | POS; phase Unknown |
| `/income`, `/expenses`, `/invoices` | Sales/income, expenses and invoices | Protected business layout + `RoleRoute`; no explicit router `PlanGate` | No | Core finance; phase Unknown |
| `/payroll` | Payroll | Protected business layout + `RoleRoute` + `PartnerPlanGate(featureKey="payroll")`; no `capability` prop, so no Ledgr plan tier is imposed by this wrapper | No | Partner package controls availability; phase Unknown |
| `/products` | Products | Protected business layout + `RoleRoute` + partner inventory feature + inventory plan and organisation capability | No | Inventory; Starter+ (`inventory` capability) and inventory profile/partner feature |
| `/inventory` | Inventory surface | Same partner/plan/profile gates; `rolePath="/inventory"` | No | Legacy/alias surface; phase Unknown |
| `/warehouse` | Warehouse / site stores | Same partner/plan/profile gates; `rolePath="/warehouse"` | Yes | Inventory; Starter+ |
| `/transfers` | Stock/material transfers | Same partner/plan/profile gates; `rolePath="/transfers"` | No | Inventory; Starter+ |
| `/accounts`, `/assets`, `/capital`, `/tax` | Chart of accounts, fixed assets, capital and tax | Protected business layout + `RoleRoute` + `PlanGate(core_accounting)` | Mixed: accounts yes; others no | Starter+; legacy/core phase Unknown |
| `/reports` | Legacy tabbed financial-report hub | Protected business layout + `RoleRoute` + `PlanGate(core_accounting)` | No at hub; child reports mixed | Legacy hub; phase Unknown; contains the old reports in Section 5 |
| `/reports/trial-balance` | New Trial Balance | Protected business layout + `RoleRoute` + `PlanGate(accounting_organisation)`; Growth+ | Yes | P4-1 / PR #246 |
| `/reports/profit-loss` | New Profit & Loss | Same; Growth+ | Yes | P4-2 / PR #249 |
| `/reports/balance-sheet` | New Balance Sheet | Same; Growth+ | Yes | P4-3 / PR #250 |
| `/reports/cash-flow` | New Cash Flow Statement | Same; Growth+ | Yes | P4-4 / PR #251 |
| `/reports/vat-return` | VAT Return | Same; Growth+ | Yes | P4-6 / PR #256 |
| `/reports/wht-schedule` | WHT Schedule | Same; Growth+ | Yes | P4-6 / PR #256 |
| `/journals` | Journal entries | Protected business layout + `RoleRoute` + `PlanGate(accounting_organisation)`; Growth+ | Yes | Legacy/core; phase Unknown |
| `/periods` | Period management | Same; Growth+ | No | Legacy/core; phase Unknown |
| `/bank-reconcile` | Legacy single-page bank reconciliation | Protected business layout + `RoleRoute` + `PartnerPlanGate(bank_reconciliation, bank_reconciliation capability)`; Growth+ and partner feature | No | Legacy; phase Unknown; preserved alongside P4B routes |
| `/bank-reconciliation/accounts` | Bank-account setup | Protected business layout + `RoleRoute` + `BankReconciliationPlanGate`; Growth+ | Yes | P4B-1 / PR #253 |
| `/bank-reconciliation/statements` | Statement history and import | Same; Growth+ | Yes | P4B-1 / PR #253 |
| `/bank-reconciliation/statements/:id` | Statement detail | Same; Growth+ | Yes | P4B-1 / PR #253 |
| `/bank-reconciliation/reconcile/:statementId` | Match and reconcile a selected statement | Same; Growth+ | Yes | P4B-2 / PR #254 |
| `/audit` | Audit log | Protected business layout + `RoleRoute` + `PlanGate(accounting_organisation)`; Growth+ | No | Legacy/core; phase Unknown |
| `/contacts`, `/branches`, `/locations`, `/departments` | Organisation master data | Protected business layout + `RoleRoute` + `PlanGate(accounting_organisation)`; Growth+ | No | Legacy/core; phase Unknown. For construction/manufacturing-only profiles, Branches may be hidden and `/branches` redirects to `/locations` (`src/components/layout/navConfig.ts:237–253`) |
| `/api-docs`, `/api-keys` | Public API documentation and key management | Protected business layout + `RoleRoute` + `PlanGate(api_access)`; Pro+ | Yes | Integrations; phase Unknown |
| `/zapier` | Zapier/webhook integration | Protected business layout + `RoleRoute` + `PlanGate(webhooks)`; Pro+ | Yes | Integrations; phase Unknown |
| `/ai` | AI insights | Protected business layout + `RoleRoute` + partner AI feature + `PlanGate(ai_insights)`; Pro+ | No | AI; phase Unknown |
| `/chat` | Redirect to `/ai` | Protected business layout + `RoleRoute`; `Navigate` only | N/A | Alias; phase Unknown |
| `/settings`, `/settings/approvals` | Same Settings page; the latter is a deep-link/alias into the approvals tab | Protected business layout + `RoleRoute`; approval UI itself is Enterprise-gated | Yes | General settings Unknown; approvals P4C / PR #255 |
| `/settings/repair-coa` | Chart-of-accounts repair | Protected business layout + `RoleRoute`; no explicit plan gate | No | Utility; phase Unknown |
| `/support` | Support | Protected business layout + `RoleRoute`; no explicit plan gate | Yes | Support; phase Unknown |
| `/tools` | Tools | Protected business layout + `RoleRoute`; no explicit plan gate | No | Utility; phase Unknown |
| `/import`, `/data-import`, `/onboarding/import` | Same data-import page at three paths | Protected business layout + `RoleRoute`; no explicit plan gate | No | Import aliases; phase Unknown |
| `/` and `*` | Smart default redirect; on admin portal host redirects to `/partner-admin` | No route-level auth wrapper; `SmartRedirect`/host redirect handles destination | N/A | Fallbacks; phase Unknown |

Router definitions and component imports are in `src/App.tsx:58–147,160–254,322–655`. The six report route wrappers and Growth+ gate are at `:176–254,550–555`; protected business routes start at `:370–377`; bank routes are `:566–582`. No bare `/bank-reconciliation` route is declared. The new Reconcile page requires `:statementId`; it is not the statements-list route.

**Plan mapping verified in source:** Free has no gated capabilities; Starter adds `inventory` and `core_accounting`; Growth adds `bank_reconciliation` and `accounting_organisation`; Pro adds AI/API/webhooks; Enterprise adds construction, manufacturing and approval workflows (`src/lib/billing/plans.ts:32–109`). `CapabilityGate` applies plan/partner/role/profile layers for construction and manufacturing (`src/hooks/useCapability.ts:14–43,60–85`). Exact effective business/role data at runtime is **Requires runtime verification**.

## 2. Exact sidebar and navigation structure

`NAV_SECTIONS` is the source of the ordinary sidebar order and item paths (`src/components/layout/navConfig.ts:70–189`). Sidebar renders visible sections, translated labels, active state and plan locks (`src/components/layout/Sidebar.tsx:116–191`). Admin links are separately rendered only for platform admins (`src/components/layout/Sidebar.tsx:193–249`).

| Order / section label key | Items in configured order (label key → path) | Visibility / plan notes |
|---|---|---|
| 1. `navigation.sections.overview` | Dashboard → `/dashboard`; POS → `/pos` | POS requires `requiresOrgCapability: pos`; no explicit min plan |
| 2. `navigation.sections.finance` | Income → `/income`; Expenses → `/expenses`; Invoices → `/invoices`; Payroll → `/payroll` | Payroll requires partner feature `payroll`; no capability is passed to its PartnerPlanGate |
| 3. `navigation.sections.inventory` | Products → `/products`; Warehouse → `/warehouse`; Transfers → `/transfers`; Construction workspace → `/construction` | First three require partner inventory feature + inventory plan/profile. Construction requires Enterprise and construction profile; construction/manufacturing profiles use Materials / Site Stores / Material Transfers label overrides |
| 4. `navigation.sections.manufacturing` | Manufacturing dashboard → `/manufacturing`; BOM → `/manufacturing/bom`; Production → `/manufacturing/production` | Enterprise + manufacturing profile; ordinary role filtering applies |
| 5. `navigation.sections.accounting` | Accounts → `/accounts`; Tax → `/tax`; Assets → `/assets`; Capital → `/capital`; Reports → `/reports`; Trial Balance → `/reports/trial-balance`; Profit & Loss → `/reports/profit-loss`; Balance Sheet → `/reports/balance-sheet`; Cash Flow → `/reports/cash-flow`; VAT Return → `/reports/vat-return`; WHT Schedule → `/reports/wht-schedule`; Journals → `/journals`; Bank Reconciliation → `/bank-reconcile`; Periods → `/periods`; Audit Log → `/audit` | Accounts/Tax/Assets/Capital/legacy Reports require Starter `core_accounting`. Six direct P4 reports, Journals, old-bank link, Periods and Audit are Growth+; old-bank link also has partner feature + capability |
| 6. `navigation.sections.bankReconciliation` | Bank accounts → `/bank-reconciliation/accounts`; Bank statements → `/bank-reconciliation/statements`; Reconcile → `/bank-reconciliation/statements` | All Growth+ and bank-reconciliation capability. **Reconcile and Statements point to the same list URL**; actual matching is reached from a statement detail/action |
| 7. `navigation.sections.organisation` | Contacts → `/contacts`; Branches → `/branches`; Locations → `/locations`; Departments → `/departments` | Growth+. Branches item is removed when construction/manufacturing sites vocabulary replaces it; retail-family operating models preserve it |
| 8. `navigation.sections.ai` | Ledgr AI → `/ai` | Partner feature `ai_advisor` + Pro `ai_insights` capability |
| 9. `navigation.sections.support` | Support → `/support` | No explicit plan gate |
| Separate Admin section | Businesses → `/admin/businesses`; Admin billing → `/admin/billing` | Only rendered when `isPlatformAdmin`; routes independently use `PlatformAdminRoute` |

`visibleSectionsFor` first removes items by organisation capability, site-vocabulary rule, partner feature and role reachability; then keeps plan-ineligible items but marks them locked; it rewrites labels for construction/manufacturing and removes empty sections (`src/components/layout/navConfig.ts:288–355,365–378`). This distinction is important: business-type/role absence is not the same as an upsell lock.

**Not in the ordinary sidebar:** P4 report export/detail controls, bank statement detail and `/bank-reconciliation/reconcile/:statementId`, construction workspace sections, manufacturing new/edit/detail routes, `/settings/approvals`, repair COA, tools/import aliases, API routes, and partner-admin portal routes. The legacy Reports hub and six P4 report links coexist; the legacy and new bank links also coexist. The nav’s “Reconcile” item is a duplicate destination, not a direct reconcile route.

## 3. Generated public schema and source RPC signatures

### Public type inventory

The source of truth for this section is **only** the current-main `src/dal/types/database.generated.ts`; counts below are declarations in that file, not production database inventory. It declares **121 public Tables, 23 public Views and 166 public Functions**. Section ranges are `Tables` at lines 36–10636, `Views` at 10638–11531, and `Functions` at 11533–13239. No live database access or schema introspection was done.

**Tables declared in the generated types, grouped by domain:**

- **Accounting, payments, tax and organisation:** `accounting_period_events`, `accounting_periods`, `accounts`, `asset_categories`, `audit_log`, `bank_statement_lines`, `bank_statements`, `branches`, `budget_lines`, `budgets`, `contacts`, `currencies`, `departments`, `depreciation_schedules`, `exchange_rates`, `expense_lines`, `expense_payments`, `expenses`, `fixed_assets`, `fx_revaluations`, `invoice_approval_policies`, `invoice_approvals`, `invoice_delivery_events`, `invoice_lines`, `invoice_payments`, `invoices`, `journal_entries`, `journal_lines`, `loan_repayments`, `loans`, `recurring_invoices`, `share_transactions`, `tax_alerts`, `tax_configurations`, `tax_payments`, `tax_returns`.
- **Construction / projects / procurement:** `construction_delivery_note_lines`, `construction_delivery_notes`, `construction_goods_receipt_holds`, `construction_goods_receipt_lines`, `construction_goods_receipt_notes`, `construction_material_issues`, `construction_material_returns`, `construction_procurement_capabilities`, `construction_procurement_grants`, `construction_procurement_sites`, `construction_product_uom_conversions`, `construction_projects`, `construction_purchase_order_events`, `construction_purchase_order_lines`, `construction_purchase_orders`, `construction_receipt_bill_allocations`, `construction_receipt_cost_bases`, `construction_receipt_inspections`, `construction_receipt_line_reclassifications`, `construction_receipt_posting_policies`, `construction_supplier_invoice_references`, `project_boq_lines`, `project_retention_ledger`, `project_status_log`, `project_valuation_lines`, `project_valuations`.
- **Manufacturing:** `manufacturing_bom_lines`, `manufacturing_boms`, `manufacturing_capabilities`, `manufacturing_capability_grants`, `manufacturing_material_transactions`, `manufacturing_production_runs`, `manufacturing_work_order_lines`, `manufacturing_work_orders`.
- **Inventory and POS:** `inventory_balances`, `inventory_locations`, `phone_accounts`, `pos_approvals`, `pos_cash_movements`, `pos_corrections`, `pos_price_overrides`, `pos_settings`, `pos_shift_closes`, `pos_shift_late_adjustments`, `pos_shifts`, `pos_terminals`, `product_categories`, `products`, `stock_movements`, `stock_transfer_lines`, `stock_transfers`.
- **People / payroll:** `employee_allowances`, `employee_deductions`, `employees`, `paye_bands`, `payroll_employee_lines`, `payroll_runs`.
- **Identity, approval, partner, platform, subscriptions and integration:** `approval_history`, `approval_request_steps`, `approval_requests`, `approval_workflow_steps`, `approval_workflows`, `ai_insights_usage`, `api_keys`, `api_usage`, `audit_20260927_sent_to_paid`, `business_invitations`, `business_terms_acceptances`, `business_users`, `businesses`, `offline_queue_reconciliations`, `partner_admins`, `partner_clients`, `partner_feature_flags`, `partner_invoices`, `partners`, `profiles`, `subscription_payments`, `subscription_reminders_sent`, `subscriptions`, `support_agent_usage`, `usage_counters`, `user_profiles`, `webhook_deliveries`, `webhooks`.

**Views declared:** `business_members`, `projects`, `v_ai_anomalies`, `v_ai_cash_accounts`, `v_ai_cash_movements`, `v_ai_customer_concentration`, `v_ai_expense_docs`, `v_ai_kpis`, `v_ai_monthly_trend`, `v_ai_overdue_invoices`, `v_ai_revenue_invoices`, `v_ai_top_customers`, `v_ai_top_expenses`, `v_ai_upcoming_payables`, `v_ai_upcoming_receivables`, `v_ar_ageing`, `v_asset_register`, `v_cash_flow`, `v_inventory_balance_ledger_drift`, `v_inventory_ledger_variance`, `v_partner_client_usage`, `v_reorder_alerts`, `v_trial_balance` (`src/dal/types/database.generated.ts:10638–11531`).

**Type-coverage caveat:** the generated table list contains `bank_statements` and `bank_statement_lines`, but does not declare the new bank-account/match tables used by the reconciliation implementation. The new bank repository uses type erasure/casts around some writes and RPCs. This is evidence of generated-type coverage drift, **not** evidence that a table/function is absent from a deployed database. See `src/dal/repositories/BankReconciliationRepository.ts:286–312,399–530` and the source signatures below.

### RPC inventory

A source scan of non-test `src` code found **89 unique literal `.rpc('name', …)` targets**, plus **37 additional computed targets** in construction procurement, manufacturing dashboard/work-order lifecycle and quick-save code: **126 distinct source-referenced RPC targets** total. Generated `Functions` declarations exist for 115 of these. The signatures below are `Args`/`Returns` from generated types where present; structured object return shapes are abbreviated as `object`/`object[]`, with their exact field declarations at the linked generated-source range. Eleven invoked targets are not declared in `Functions` and are marked accordingly; they must not be described as verified database functions solely from the client call.

Source call-site groups include `src/dal/repositories/ReportRepository.ts:22–36`, `src/dal/repositories/ApprovalRepository.ts:85–177`, `src/dal/repositories/BankReconciliationRepository.ts:399–530`; `src/dal/repositories/ConstructionProcurementRepository.ts` (dynamic construction command selection), `src/dal/repositories/ProjectRepository.ts:182–198,199+`, `src/dal/repositories/ManufacturingDashboardRepository.ts`, `src/pages/manufacturing/WorkOrderListPage.tsx`, `src/pages/manufacturing/WorkOrderDetailPage.tsx`, and `src/services/quickSaveService.ts`. The generated signature declarations are source-linked below; function references do not imply deployment/runtime verification.

| Source RPC signature (argument types from generated `Args`) | Generated declaration |
|---|---|
| `_ledgr_resolve_construction_client(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `accept_invitation(p_token: string) → Json` | `src/dal/types/database.generated.ts:12036–12036` |
| `act_on_approval(p_action: string; p_comments?: string \| null; p_request_id: string) → Json` | `src/dal/types/database.generated.ts:11534–11537` |
| `add_partner_admin(p_partner_id: string; p_role?: string; p_user_email_or_id: string) → undefined` | `src/dal/types/database.generated.ts:12045–12052` |
| `ai_context(p_business_id: string) → Json` | `src/dal/types/database.generated.ts:12053–12058` |
| `approve_construction_receipt_posting_policy(p_business_id: string; p_enable: boolean; p_evidence: string; p_reason: string) → Json` | `src/dal/types/database.generated.ts:12091–12099` |
| `approve_invoice(p_invoice_id: string; p_note?: string) → Json` | `src/dal/types/database.generated.ts:12100–12103` |
| `authorize_construction_purchase_order(p_po_id: string) → Json` | `src/dal/types/database.generated.ts:12120–12123` |
| `authorize_pos_price_override(p_token: string) → Json` | `src/dal/types/database.generated.ts:12125–12125` |
| `backfill_and_recalculate_inventory(p_business_id?: string) → object[]` | `src/dal/types/database.generated.ts:12126–12135` |
| `bulk_upsert_boq_lines(p_lines: Json; p_project_id: string) → object[]` | `src/dal/types/database.generated.ts:12136–12157` |
| `cancel_construction_purchase_order(p_po_id: string; p_reason: string) → Json` | `src/dal/types/database.generated.ts:12203–12206` |
| `clear_partner_admins(p_partner_id: string) → number` | `src/dal/types/database.generated.ts:12207–12207` |
| `close_pos_shift_command(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12212–12212` |
| `construction_procurement_capabilities_for(p_business_id: string) → string[]` | `src/dal/types/database.generated.ts:12213–12216` |
| `construction_procurement_open_items(p_business_id: string) → Json` | `src/dal/types/database.generated.ts:12217–12220` |
| `construction_project_material_cost(p_business_id: string) → object[]` | `src/dal/types/database.generated.ts:12221–12232` |
| `create_bank_reconciliation_matches(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `create_boq_line(p_description: string; p_line_number: string; p_project_id: string; p_quantity: number; p_rate: number; p_sort_order: number; p_unit: string) → object` | `src/dal/types/database.generated.ts:12245–12274` |
| `create_business_with_owner(p_address_line1: string; p_base_currency: string; p_brand_color: string; p_city: string; p_country: string; p_email: string; p_expense_prefix: string; p_financial_year_start: string; p_invoice_prefix: string; p_name: string; p_operating_models?: string[]; p_organisation_type?: string; p_payroll_prefix: string; p_phone: string; p_registration_number: string; p_timezone: string; p_tpin: string; p_trading_name: string; p_vat_number: string; p_vat_registered: boolean) → string` | `src/dal/types/database.generated.ts:12275–12299` |
| `create_construction_purchase_order(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12300–12303` |
| `create_invoice_with_lines(p_client_key?: string; p_invoice: Json; p_lines: Json) → Json` | `src/dal/types/database.generated.ts:12304–12307` |
| `create_project(p_budget: number; p_business_id: string; p_client_id?: string; p_client_name: string; p_contract_sum: number; p_end_date: string; p_name: string; p_retention_pct: number; p_start_date: string) → object` | `src/dal/types/database.generated.ts:12308–12343` |
| `create_project_purchase_order(p_client_key: string; p_payload: Json; p_project_id: string) → Json` | `src/dal/types/database.generated.ts:12344–12347` |
| `create_valuation(p_lines: Json; p_notes?: string; p_period_end: string; p_period_start: string; p_project_id: string; p_valuation_date: string) → Json` | `src/dal/types/database.generated.ts:12348–12358` |
| `delete_bank_reconciliation_match(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `delete_boq_line(p_line_id: string) → undefined` | `src/dal/types/database.generated.ts:12364–12364` |
| `delete_draft_bank_statement(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `generate_invoice_from_valuation(p_valuation_id: string) → Json` | `src/dal/types/database.generated.ts:12378–12381` |
| `get_approval_state(p_business_id: string; p_document_id: string; p_document_type: string) → Json` | `src/dal/types/database.generated.ts:11542–11545` |
| `get_bank_gl_book_balance(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `get_bank_reconciliation_gl_lines(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `get_boq_summary(p_project_id: string) → object[]` | `src/dal/types/database.generated.ts:12382–12391` |
| `get_cost_breakdown_by_project(p_business_id: string) → object[]` | `src/dal/types/database.generated.ts:12392–12404` |
| `get_dashboard_metrics(p_business_id: string) → object[]` | `src/dal/types/database.generated.ts:12405–12433` |
| `get_portfolio_summary(p_business_id: string) → object[]` | `src/dal/types/database.generated.ts:12435–12449` |
| `get_pos_shift_report(p_shift_id: string) → Json` | `src/dal/types/database.generated.ts:12450–12450` |
| `get_project_cost_summary(p_project_id: string) → object[]` | `src/dal/types/database.generated.ts:12451–12459` |
| `get_project_pnl(p_project_id: string) → object[]` | `src/dal/types/database.generated.ts:12460–12484` |
| `get_project_valuation_trend(p_project_id: string) → object[]` | `src/dal/types/database.generated.ts:12485–12495` |
| `get_retention_aging(p_business_id: string) → object[]` | `src/dal/types/database.generated.ts:12496–12507` |
| `get_retention_summary(p_project_id: string) → object[]` | `src/dal/types/database.generated.ts:12508–12517` |
| `get_trial_balance(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `get_unreconciled_gl_lines(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `get_valuation_history(p_project_id: string) → Json` | `src/dal/types/database.generated.ts:12522–12522` |
| `import_bank_statement(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `increment_amount_paid(p_amount: number; p_id: string; p_table: string) → undefined` | `src/dal/types/database.generated.ts:12556–12559` |
| `invite_member(p_business_id: string; p_email: string; p_role: Database["public"]["Enums"]["user_role"]) → string` | `src/dal/types/database.generated.ts:12560–12567` |
| `issue_construction_materials_to_project(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12572–12575` |
| `issue_project_materials(p_client_key: string; p_payload: Json; p_project_id: string) → Json` | `src/dal/types/database.generated.ts:12576–12579` |
| `ledgr_monthly_document_count(p_business_id: string) → number` | `src/dal/types/database.generated.ts:12580–12583` |
| `link_site_to_project(p_location_id: string; p_project_id: string) → object` | `src/dal/types/database.generated.ts:12584–12604` |
| `list_all_businesses() → object[]` | `src/dal/types/database.generated.ts:12605–12618` |
| `list_partner_admins(p_partner_id: string) → object[]` | `src/dal/types/database.generated.ts:12619–12628` |
| `manufacturing_bom_activate(p_bom_id: string) → undefined` | `src/dal/types/database.generated.ts:12656–12659` |
| `manufacturing_bom_cost(p_bom_id: string) → number` | `src/dal/types/database.generated.ts:12660–12660` |
| `manufacturing_bom_new_version(p_bom_id: string) → string` | `src/dal/types/database.generated.ts:12661–12664` |
| `manufacturing_cost_variance(p_business_id: string; p_end_date?: string; p_start_date?: string) → object[]` | `src/dal/types/database.generated.ts:12665–12680` |
| `manufacturing_dashboard_metrics(p_business_id: string; p_end_date?: string; p_start_date?: string) → Json` | `src/dal/types/database.generated.ts:12681–12688` |
| `manufacturing_production_summary(p_business_id: string; p_end_date?: string; p_start_date?: string) → object[]` | `src/dal/types/database.generated.ts:12689–12707` |
| `manufacturing_throughput_trend(p_business_id: string; p_end_date?: string; p_granularity?: string; p_start_date?: string) → object[]` | `src/dal/types/database.generated.ts:12708–12721` |
| `manufacturing_wip_aging(p_business_id: string) → object[]` | `src/dal/types/database.generated.ts:12722–12735` |
| `manufacturing_wo_cancel(p_work_order_id: string) → undefined` | `src/dal/types/database.generated.ts:12736–12739` |
| `manufacturing_wo_close(p_work_order_id: string) → undefined` | `src/dal/types/database.generated.ts:12740–12743` |
| `manufacturing_wo_complete(p_work_order_id: string) → undefined` | `src/dal/types/database.generated.ts:12744–12747` |
| `manufacturing_wo_create(p_business_id: string; p_from_location_id: string; p_notes: string; p_planned_end: string; p_planned_qty: number; p_planned_start: string; p_product_id: string; p_to_location_id: string) → string` | `src/dal/types/database.generated.ts:12748–12760` |
| `manufacturing_wo_record_consumption(p_component_id: string; p_from_location_id: string; p_notes: string; p_quantity: number; p_run_id: string; p_work_order_id: string) → string` | `src/dal/types/database.generated.ts:12761–12771` |
| `manufacturing_wo_record_run(p_notes: string; p_output_qty: number; p_scrap_qty: number; p_work_order_id: string) → string` | `src/dal/types/database.generated.ts:12783–12791` |
| `manufacturing_wo_release(p_work_order_id: string) → undefined` | `src/dal/types/database.generated.ts:12792–12795` |
| `manufacturing_wo_start(p_work_order_id: string) → undefined` | `src/dal/types/database.generated.ts:12796–12799` |
| `manufacturing_yield_by_product(p_business_id: string; p_end_date?: string; p_start_date?: string) → object[]` | `src/dal/types/database.generated.ts:12818–12832` |
| `match_construction_bill_line_to_receipt(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12833–12836` |
| `next_journal_entry_number(p_business_id?: string) → string` | `src/dal/types/database.generated.ts:12837–12840` |
| `open_pos_shift_command(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12841–12841` |
| `pos_stock_availability(p_branch_id?: string; p_business_id: string) → Json` | `src/dal/types/database.generated.ts:12843–12846` |
| `post_construction_receipt_movement(p_grn_id: string) → Json` | `src/dal/types/database.generated.ts:12847–12850` |
| `post_pos_sale(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12851–12851` |
| `provision_construction_coa_accounts(p_business_id: string) → string` | `src/dal/types/database.generated.ts:12852–12855` |
| `provision_construction_defaults(p_business_id: string; p_owner_user_id: string) → Json` | `src/dal/types/database.generated.ts:12856–12859` |
| `provision_manufacturing_coa_accounts(p_business_id: string) → string` | `src/dal/types/database.generated.ts:12860–12863` |
| `provision_manufacturing_defaults(p_business_id: string; p_owner_user_id: string) → Json` | `src/dal/types/database.generated.ts:12864–12867` |
| `reclassify_construction_receipt_line(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12868–12871` |
| `reconcile_bank_statement(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `reconcile_offline_queue_item(p_request: Json) → Json` | `src/dal/types/database.generated.ts:12872–12872` |
| `record_business_terms_acceptance(p_business_id: string; p_terms_version: string) → string` | `src/dal/types/database.generated.ts:12873–12876` |
| `record_construction_delivery_note(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12877–12880` |
| `record_construction_delivery_note_exception(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12881–12884` |
| `record_construction_goods_receipt(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12885–12888` |
| `record_construction_receipt_cost_basis(p_client_key: string; p_evidence: string; p_expense_line_id: string; p_grn_line_id: string; p_quantity: number) → Json` | `src/dal/types/database.generated.ts:12889–12898` |
| `record_construction_receipt_inspection(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12899–12902` |
| `record_expense_payment(p_client_key: string; p_payment: Json) → Json` | `src/dal/types/database.generated.ts:12903–12906` |
| `record_inventory_journal_movement(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12907–12910` |
| `record_invoice_payment(p_client_key: string; p_payment: Json) → Json` | `src/dal/types/database.generated.ts:12911–12914` |
| `record_pos_cash_movement_command(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12915–12918` |
| `record_sale_stock_and_cogs(p_invoice_id: string; p_lines: Json) → Json` | `src/dal/types/database.generated.ts:12919–12922` |
| `refund_pos_sale_command(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:12923–12923` |
| `register_construction_procurement_site(p_branch_id: string; p_business_id: string; p_location_id: string; p_project_ref: string; p_site_code: string; p_site_name: string) → Json` | `src/dal/types/database.generated.ts:12924–12934` |
| `register_construction_product_uom_conversion(p_business_id: string; p_evidence_reference: string; p_factor: number; p_from_uom: string; p_product_id: string; p_to_uom: string) → Json` | `src/dal/types/database.generated.ts:12935–12945` |
| `register_construction_supplier_invoice_reference(p_expense_id: string) → Json` | `src/dal/types/database.generated.ts:12946–12949` |
| `register_construction_supplier_invoice_reference_exception(p_evidence: string; p_exception_of: string; p_expense_id: string; p_reason: string) → Json` | `src/dal/types/database.generated.ts:12950–12958` |
| `release_construction_receipt_hold(p_hold_id: string; p_reason: string) → Json` | `src/dal/types/database.generated.ts:12959–12962` |
| `release_retention(p_amount: number; p_description: string; p_project_id: string) → Json` | `src/dal/types/database.generated.ts:12963–12966` |
| `remove_partner_admin(p_partner_id: string; p_user_email_or_id: string) → undefined` | `src/dal/types/database.generated.ts:12967–12970` |
| `reorder_boq_lines(p_line_ids: string[]; p_project_id: string) → object[]` | `src/dal/types/database.generated.ts:12975–12996` |
| `request_pos_approval(p_action: string; p_amount?: number; p_business_id: string; p_document_id: string; p_reason?: string; p_ttl_minutes?: number) → Json` | `src/dal/types/database.generated.ts:12997–13007` |
| `request_pos_price_override(p_business_id: string; p_kind: string; p_max_discount_percent?: number; p_product_id?: string; p_reason?: string; p_ttl_minutes?: number; p_unit_price?: number) → Json` | `src/dal/types/database.generated.ts:13008–13019` |
| `requires_approval(p_business_id: string; p_document_type: string) → boolean` | `src/dal/types/database.generated.ts:11546–11549` |
| `reserve_next_document_number(p_business_id: string; p_kind: string) → string` | `src/dal/types/database.generated.ts:13020–13023` |
| `resubmit_approval(p_request_id: string) → Json` | `src/dal/types/database.generated.ts:11550–11553` |
| `return_construction_materials_to_store(p_client_key: string; p_payload: Json) → Json` | `src/dal/types/database.generated.ts:13024–13027` |
| `return_project_materials(p_client_key: string; p_payload: Json; p_project_id: string) → Json` | `src/dal/types/database.generated.ts:13028–13031` |
| `save_approval_workflow(p_business_id: string; p_document_type: string; p_is_active: boolean; p_name: string; p_steps: Json) → string` | `src/dal/types/database.generated.ts:11554–11563` |
| `save_quick_expense(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:13036–13036` |
| `save_quick_sale(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:13037–13037` |
| `set_construction_procurement_site_status(p_active: boolean; p_reason?: string; p_site_id: string) → Json` | `src/dal/types/database.generated.ts:13051–13054` |
| `start_approval_workflow(p_business_id: string; p_document_id: string; p_document_type: string) → Json` | `src/dal/types/database.generated.ts:11564–12035` |
| `submit_valuation(p_valuation_id: string) → Json` | `src/dal/types/database.generated.ts:13080–13080` |
| `transition_project_status(p_new_status: string; p_project_id: string; p_reason?: string) → object` | `src/dal/types/database.generated.ts:13081–13106` |
| `unlink_site_from_project(p_location_id: string) → object` | `src/dal/types/database.generated.ts:13107–13127` |
| `unreconcile_bank_statement(source call; no generated Args/Returns)` | **Absent from generated Functions** |
| `update_boq_line(p_description: string; p_line_id: string; p_line_number: string; p_quantity: number; p_rate: number; p_sort_order: number; p_unit: string) → object` | `src/dal/types/database.generated.ts:13128–13157` |
| `update_business_operating_models(p_business_id: string; p_operating_models: string[]) → string[]` | `src/dal/types/database.generated.ts:13158–13161` |
| `update_construction_procurement_site(p_project_id?: string; p_project_ref?: string; p_set_project?: boolean; p_site_id: string; p_site_name?: string) → Json` | `src/dal/types/database.generated.ts:13162–13171` |
| `update_project(p_budget: number; p_client_id?: string; p_client_name: string; p_contract_sum: number; p_end_date: string; p_name: string; p_project_id: string; p_retention_pct: number; p_start_date: string) → object` | `src/dal/types/database.generated.ts:13172–13207` |
| `update_valuation(p_lines: Json; p_notes?: string; p_period_end: string; p_period_start: string; p_valuation_date: string; p_valuation_id: string) → Json` | `src/dal/types/database.generated.ts:13208–13218` |
| `void_pos_sale_command(p_payload: Json) → Json` | `src/dal/types/database.generated.ts:13239–13239` |

**Missing generated declarations (11):** `_ledgr_resolve_construction_client`, `create_bank_reconciliation_matches`, `delete_bank_reconciliation_match`, `delete_draft_bank_statement`, `get_bank_gl_book_balance`, `get_bank_reconciliation_gl_lines`, `get_trial_balance`, `get_unreconciled_gl_lines`, `import_bank_statement`, `reconcile_bank_statement`, `unreconcile_bank_statement`. The report repository calls `get_trial_balance` with business, inclusive date range and branch arguments (`src/dal/repositories/ReportRepository.ts:22–35`); new bank calls are in `src/dal/repositories/BankReconciliationRepository.ts:399–530`. Some functions expected to be type-drifted in an earlier audit are now present in this generated file: `ai_context` and `get_dashboard_metrics` are declared at `src/dal/types/database.generated.ts:12053–12058` and `src/dal/types/database.generated.ts:12405–12433` respectively.

## 4. Operational feature quality (source-level assessment)

This is a code-path assessment, not a runtime acceptance test. It distinguishes implemented surface from business outcome. Live authorization, migration deployment, real-world import variants, multi-user concurrency and resulting GL balances are **Requires runtime verification**.

### Phase 4 financial reports

| Route / phase | What current source implements | Quality / limits evidenced in source |
|---|---|---|
| `/reports/trial-balance` — P4-1 / #246 | Growth+ page queries `ReportRepository.getTrialBalance` with business, period and optional branch; builds expandable account hierarchy, aggregates debit/credit/balance, warns on imbalance and offers CSV (and post-P4-5 PDF/print) export. `src/pages/reports/TrialBalancePage.tsx:45–120,123+`; shared RPC adapter `src/dal/repositories/ReportRepository.ts:22–36` | Better scope and explicit states than the legacy tab. Tree roll-up is client-side; posted-only/date/branch server behavior is part of the named RPC contract in the PR/source, but the function has no generated `Functions` signature. Database behavior is **Requires runtime verification**. |
| `/reports/profit-loss` — P4-2 / #249 | Reuses Trial Balance rows for current and previous periods; default prior-period comparison, amount/percentage variance, branch and period selection; P&L sections computed by shared helper; CSV/PDF after #252. `src/pages/reports/ProfitLossPage.tsx:151–190,206–230,320–333` | Strong shared data/calculation path, but account classification depends on available account fields/codes because no account subtype is supplied by the source RPC; chart-of-accounts edge cases need runtime verification. |
| `/reports/balance-sheet` — P4-3 / #250 | Cumulative Trial Balance query through selected as-of date and branch; computes assets/liabilities/equity and retained earnings, balance check, CSV/PDF. `src/pages/reports/BalanceSheetPage.tsx:101–193,250–255` | Suitable cumulative architecture, but classification and retained-earnings behavior are client-side helper rules. No prior-year comparison control on this new page is visible in the inspected state; legacy SOFP does support comparative date. |
| `/reports/cash-flow` — P4-4 / #251 | Three parallel Trial Balance calls: period P&L, cumulative current balance and cumulative prior balance; indirect method, operating/investing/financing sections, reconciliation and branch/period filters. CSV/PDF. `src/pages/reports/CashFlowPage.tsx:57–204`; shared calculators under `src/lib/reports/` | Reuses common source, but cash-account and balance-sheet movement detection are heuristic/client-side. Source uses a fixed cumulative start date; cash-flow totals and account classifications require runtime/accounting review. |
| `/reports/vat-return` — P4-6 / #256 | Period type/month/quarter/year and branch; account list plus Trial Balance; account classification, output/input VAT and net payable; CSV only; loading/error/activity state. `src/pages/reports/VatReturnPage.tsx:105–195`; `src/lib/tax-accounts.ts:20–42` | Useful management schedule, not evidence of filing/submission/compliance workflow. Tax account classification is heuristic from code/name/type; CSV only. |
| `/reports/wht-schedule` — P4-6 / #256 | Monthly date range and branch; classifies payable accounts, fetches posted journal lines, groups tax-code rows, summarizes and exports CSV. `src/pages/reports/WhtSchedulePage.tsx:93–193` | Detailed trace to posted lines and explicit filters; unknown tax codes are retained as an `unknown` bucket. Tax-code normalization and filing requirements require runtime/product verification. CSV only. |

Phase 4 sequence from PR descriptions: #246 Trial Balance; #247 production dependency refresh (not a product feature); #248 development dependency refresh; #249 Profit & Loss; #250 Balance Sheet; #251 Cash Flow; #252 shared CSV/PDF exports for the first four; #253 bank account/statement import foundation; #254 matching/reconciliation report; #255 approval workflows; #256 VAT/WHT. PR descriptions and source were read, but their test/build claims were not rerun in this audit.

### Operational workspaces

- **New bank reconciliation:** distinct account setup, statement import/history/detail, match workspace, statement status and reconciliation report. `src/dal/repositories/BankReconciliationRepository.ts:286–312` uses direct bank-account table operations; `src/dal/repositories/BankReconciliationRepository.ts:399–530` uses RPCs for statement import/delete and match/reconcile transitions. The CSV parser validates headers/amounts/rows (`src/lib/bankReconciliation/statementCsv.ts:44–232+`). The matcher includes prioritized suggestions and ambiguity safeguards (`src/lib/reconciliation/matcher.ts`); reconcile page supports statement lock/unlock, auto-match, unmatch, manual partial/one-to-many matches, export and error states (`src/pages/bank-reconciliation/ReconcilePage.tsx:300–337,339–458`). This is a material improvement over one-shot reconciliation. It is not wholly RPC-only. Parser support is verified for CSV, not OFX/MT940; those formats are **Unknown** for the new flow. |
- **Legacy bank reconciliation:** single-page import/match/save flow with client-side suggestion scoring and optional `suggest-bank-matches` Edge Function (`src/components/bank/BankReconciliation.tsx:69–127,130–145,211–238`). It directly inserts draft journal entries/lines and persists statement/match/lock state through table writes (`:240–299,302–399`). The flow requires all lines matched and zero difference before save/lock (`:302–320`). It has more direct write surface, a hard-coded English UI, and less explicit lifecycle structure than the new workspace. |
- **Approval workflows (P4C / #255):** Enterprise capability, opt-in ordered steps only for purchase orders and manual journal entries; Settings UI configures those document types and surfaces save/error states (`src/pages/settings/ApprovalsTab.tsx:50–109,110–147,149–299`). Repository calls save/require/start/state/act/resubmit approval functions and lists pending requests (`src/dal/repositories/ApprovalRepository.ts:85–177`). `ApprovalBanner` loads state, invalidates approvals/journal/procurement queries, supports submit, approve/reject with comments, history and author resubmission after rejection (`src/components/approvals/ApprovalBanner.tsx:8–17,34–85,143–200+`). Rejection requires a nonblank comment; construction PO integration uses `showSubmit={false}` and refreshes related queries (`src/components/construction/ConstructionPurchaseOrdersSection.tsx:652–661`). No approval UI/configuration for invoices, expenses or other document types is verified. Direct PO authorization and journal posting remain when a workflow is not configured (PR #255 scope); runtime transition safeguards are not tested here. |
- **Construction workspace:** `/construction/*` is a real capability-gated workspace with projects, retention aging, procurement overview, purchase orders, receipts, bill matching, material issues/returns and setup (`src/pages/construction/ConstructionWorkspacePage.tsx:22–46,89–172`). It reads server capabilities and shows loading/error/held-capability state (`src/pages/construction/ConstructionWorkspacePage.tsx:55–70,131–145`). `src/dal/repositories/ProjectRepository.ts:8–15,38–64,65–169` models project lifecycle, flat BOQ, valuations, retention entries and summary RPCs; procurement command actions and server capability checks are presented as a boundary in `src/pages/construction/ConstructionWorkspacePage.tsx:22–33`. Retention aging is implemented, not a missing feature (`src/components/construction/reports/RetentionAgingReport.tsx:19–24,99–176`). The separate `/projects-funding-sources/construction-draft` is local React state with local IDs and drafts, no persistence (`src/pages/ConstructionProjectSetupDraftPage.tsx:25–37,89–109`; router comment `src/App.tsx:373–387`). |
- **Manufacturing:** Enterprise/profile/role-gated dashboard, versioned BOM list/editor/detail and work-order list/create/detail. BOM editor supports output, component lines, quantity/UOM/scrap percent, draft edits and activation (`src/pages/manufacturing/BomEditorPage.tsx:220–319,339–400`). Work orders expose lifecycle commands, consumption, production runs and scrap; run dialog sends output/scrap quantity (`src/pages/manufacturing/WorkOrderDetailPage.tsx:210–247,329–360,810–880`). Dashboard summaries and cost/yield/WIP measures are present through `src/dal/repositories/ManufacturingDashboardRepository.ts` and `ManufacturingDashboardPage.tsx`. This is a useful small production-control foundation, not a full MRP/MES suite. Generated BOM lines contain a BOM ID and component product ID but no child-BOM reference (`src/dal/types/database.generated.ts:6723–6773`); see the gap analysis. |

## 5. Corrected duplicate comparison: Phase 4, legacy reports and bank reconciliation

### Old `/reports` tabs vs Phase 4 routes

The old hub still contains eight tabs—Trial Balance, SOFP (IFRS), P&L (IFRS), Revenue Breakdown, Cash Flow (IFRS), Changes in Equity, Branch Performance and Multi-currency—and applies its parent date filter except for Trial Balance and Multi-currency (`src/pages/ReportsPage.tsx:370–414`). Only SOFP/P&L have the old prior-year comparison toggle (`:416–426`). These are live route implementations, not deleted by Phase 4.

| Old tab | Old implementation and scope | P4 overlap / difference | Decision |
|---|---|---|---|
| Trial Balance | Direct business-only `v_trial_balance` query, no report date/branch parameters; PDF output and loading/empty states; query does not expose an explicit error branch in the component (`src/pages/ReportsPage.tsx:101–117,126–181`). | Duplicates new `/reports/trial-balance`, which uses branch/date RPC inputs, tree/filters and CSV/PDF. Data source and control surface differ. | Replace the old tab’s canonical path with the new report after parity check; keep a redirect or compatibility entry during cutover. |
| SOFP (IFRS) | `FinancialStatementRepository.computeBalances` reads accounts and posted/reversed journal lines, filters by business/date, pages lines and uses `amount_base`; no branch input (`src/dal/repositories/FinancialStatementRepository.ts:170–253`). SOFP supports prior-date comparison, integrity checks for assets/bank/FX, and PDF/XBRL (`src/components/reports/StatementOfFinancialPosition.tsx:101–155,202–260` and export sections). | Overlaps new Balance Sheet. Legacy has explicit statement integrity checks and XBRL; P4 has Growth gate, branch filters and CSV/PDF, and uses the shared trial-balance RPC. New page does not expose the old comparative date control in inspected source. | Do not delete until balance, opening balance, integrity findings, comparison and export behavior are reconciled. Then make one canonical Balance Sheet route; preserve legacy integrity checks or extract them. |
| P&L (IFRS) | Repository computes period balances directly from GL, includes prior period comparison and PDF/XBRL; uses posted/reversed lines, `amount_base`, business/date filters but no branch (`src/dal/repositories/FinancialStatementRepository.ts:187–263`; `src/components/reports/StatementOfProfitOrLoss.tsx:115–132,214–273`; hub supplies date/comparative values at `src/pages/ReportsPage.tsx:444–450`). | Overlaps new `/reports/profit-loss`; new page is branch-aware, derives from Trial Balance RPC and has a CSV/PDF path after #252. Old XBRL and period semantics remain distinct. | Consolidate after output-level comparison; retain XBRL/notes if still a product requirement. |
| Cash Flow (IFRS) | Reads `v_cash_flow` by business and month range; it is a separate precomputed view path (`src/components/reports/CashFlowStatement.tsx:19–43,110–175`). No branch filter is passed in the shown query. | Overlaps new indirect-method `/reports/cash-flow`, which derives period/cumulative balance data from three trial-balance calls and supports branch (`src/pages/reports/CashFlowPage.tsx:70–120`). Formulas/data models are not a one-for-one replacement. | Keep both until opening/closing cash and operating/investing/financing reconciliation are proven equivalent; then retire/redirect the legacy tab. |
| Changes in Equity | Repository-backed roll-forward; exports PDF and XBRL; report displays opening equity, net profit allocation, contributions, drawings/dividends, other movements and closing equity (`src/components/reports/StatementOfChangesInEquity.tsx:53–70,72–172`). The inspected function accepts business/date only and hardcodes MWK formatting (`:53–70`). | No standalone P4 route replaces it. | Keep; improve currency/branch scope as needed and assess as a separate future report rather than removing it as duplicate. |
| Revenue Breakdown | Queries invoices, invoice lines, products and accounts by issue date and business; no branch filter; PDF; explicit loading/error/empty states (`src/components/reports/RevenueBreakdownReport.tsx:34–103,110–160`). | No equivalent P4 report; it is product/service invoice revenue attribution, not P&L. | Keep as a distinct report; later extract shared date/branch scope and localization. |
| Branch Performance | Fetches all branches and dated posted journal lines, shows all-branch totals/chart and a selected-branch detail table; table selection does not narrow the query; hard-coded English labels (`src/components/reports/BranchPerformanceReport.tsx:230–297,299–388`). | P4 reports can filter to a branch but do not reproduce this branch-comparison dashboard. | Keep as distinct until an explicit branch-consolidation replacement exists; localize. |
| Multi-currency | Reads the newest 200 posted journal lines for the business; no date filter in the query, excludes a date filter in hub; PDF and load/error states; no direct i18n hook (`src/pages/ReportsPage.tsx:238–261,263–304,413–415`). | No P4 equivalent. | Keep only if operationally required; otherwise rebuild with explicit date/branch/pagination and a documented FX basis before deciding retirement. |

**Important qualification:** labels such as “IFRS” in the legacy UI are labels, not independent evidence of compliance with a reporting standard. Standards compliance is **Requires runtime and accounting review**.

### Old `/bank-reconcile` vs new `/bank-reconciliation/*`

| Criterion | Legacy `/bank-reconcile` | New P4B workspace |
|---|---|---|
| Entry points | Single page at `/bank-reconcile`; nav item remains under Accounting | Account list/setup, statements list/import, statement detail, and `/reconcile/:statementId` are separate routes (`src/App.tsx:566–582`) |
| Data/write path | Direct journal entry/line insert and statement/line/lock writes; optional Edge Function suggestions (`src/components/bank/BankReconciliation.tsx:211–238,240–299,302–399`) | Direct bank-account CRUD plus RPC-backed statement import/delete, match and status changes (`src/dal/repositories/BankReconciliationRepository.ts:286–312,399–530`) |
| Import | `parseBankStatement(file)` call; legacy UI mentions common formats, but exact OFX/MT940 parser behavior is **Unknown** (`src/components/bank/BankReconciliation.tsx:130–145`) | Validated CSV import with recognized amount or debit/credit columns, period metadata and preview (`src/lib/bankReconciliation/statementCsv.ts:44–232+`; PR #253 scope). New OFX/MT940 support is not verified |
| Matching | Confidence score and optional AI/Edge suggestions; save requires all lines matched and zero difference (`src/components/bank/BankReconciliation.tsx:117–127,211–238,302–320`) | Prioritized auto-match, ambiguity-safe suggestions, manual partial/one-to-many matching, unmatch, lock/unlock, report and export (`src/pages/bank-reconciliation/ReconcilePage.tsx:308–337,339–458`; `src/lib/reconciliation/matcher.ts`; `src/lib/reconciliation/reconciliationReport.ts:73–134`) |
| Lifecycle / safeguards | User-driven save and lock through multiple direct writes | Draft/reconciled status, guarded transition RPCs, lock and admin-only unreconcile are in the #254 source scope; runtime behavior **Requires runtime verification** |
| Localization / plan | Hard-coded English; Growth+ plus partner feature | i18n-backed pages; Growth+ bank capability gate (no partner feature in the new route wrapper) |
| Duplication finding | Same business objective, but single-page model and data paths differ | Not a mere renamed route: adds account/statement lifecycle and different matching model. Both are still routable and linked from nav |

**Recommendation:** treat new routes as the target workflow, but do not delete/redirect the legacy page until data compatibility and user migration are verified. Then retire the old page or keep a deliberate redirect. Fix the sidebar “Reconcile” link to point to a real next step or remove it; currently it duplicates `/bank-reconciliation/statements`.

## 6. Vertical gap analysis

### Construction

**Implemented:** project lifecycle (`tender`, `active`, `practical_completion`, `defect_liability`, `closed`), client linkage, flat BOQ, valuations, retention ledger/release and aging report, project status, procurement sites, purchase orders, delivery notes, goods receipts, receipt inspections/holds, bill matching and cost basis, material issues/returns and capability checks. Evidence: `src/dal/repositories/ProjectRepository.ts:8–15,38–64,65–169`; table declarations in `database.generated.ts` public Tables block; workspace sections `src/pages/construction/ConstructionWorkspacePage.tsx:36–46,147–172`; retention summary/filter `src/components/construction/reports/RetentionAgingReport.tsx:99–176`.

**Checklist / gaps:**

- **Retention tracking/aging:** already implemented. It summarizes amount held, project count and average days, with status/sort filters (`src/components/construction/reports/RetentionAgingReport.tsx:99–176`). It is not a gap.
- **BOQ hierarchy / multi-level construction BoM:** current `project_boq_lines` model exposes line number, description, quantity, unit, rate, value and sort order, but no parent/child item field in the app-facing type (`src/dal/repositories/ProjectRepository.ts:42–63`). A hierarchical BOQ or construction “BOM tree” is **not evidenced**.
- **Subcontractors:** source has project client contacts and supplier invoice/procurement references, but no dedicated subcontract package, subcontractor contract, certified subcontract claim or retention-by-subcontractor workflow was found in the routes/types inspected. **Requires product/runtime confirmation.**
- **Project cash-flow forecasting:** project cost, P&L, portfolio, valuation and retention summaries exist; no forward cash-in/cash-out forecast surface or forecast table was identified in the route/type inventory. **Not evidenced; requirements confirmation needed.**
- **Site safety / HSE:** no safety inspection, permit-to-work, incident or toolbox-talk route/table surfaced in this audit. **Not evidenced; not a statement that no external process exists.**
- **Document control / site diary / RFIs / change orders:** no dedicated route was identified. **Unknown / requires product confirmation.**
- **Draft setup route:** `/projects-funding-sources/construction-draft` is browser component state and is not the backed construction-project repository. It should not be presented as saved project data (`src/pages/ConstructionProjectSetupDraftPage.tsx:25–37,89–109`).

### Manufacturing

**Implemented:** versioned BOM records with component lines, quantity/UOM/scrap percent; costing; work-order create/release/start/complete/close/cancel; material consumption/returns; production run output/scrap; dashboard metrics for throughput, yield, WIP aging and cost variance. Evidence: `src/pages/manufacturing/BomEditorPage.tsx:220–319,339–400`; `src/pages/manufacturing/WorkOrderDetailPage.tsx:210–247,329–360,810–880`; `src/dal/repositories/ManufacturingDashboardRepository.ts`; `src/dal/types/database.generated.ts:6723–6773,6775–6843,7059–7097`.

**Checklist / gaps:**

- **Multi-level BOM:** not represented by current BOM line model; each row points to a component product, not another BOM (`src/dal/types/database.generated.ts:6723–6773`). The editor filters the output product from the component list (`src/pages/manufacturing/BomEditorPage.tsx:339–343`). Treat current BOM as one-level unless a recursive composition path is demonstrated.
- **Routings / work centres / capacity scheduling / MRP:** no routed operation/work-centre/calendar demand model or scheduling surface was found in the audited routes/types. **Not evidenced; verify against product requirements.**
- **Quality inspection, non-conformance and rework:** production runs record output and scrap, but the inspected run form has output quantity, scrap quantity and notes only (`src/pages/manufacturing/WorkOrderDetailPage.tsx:810–880`). A quality/rework lifecycle is **not evidenced**.
- **Lot/batch/serial genealogy and traceability:** no dedicated lot/serial genealogy surface/table was found in the generated type inventory. **Not evidenced; runtime confirmation needed.**
- **Labor/machine time and maintenance:** no explicit labor booking, machine scheduling or maintenance route/table was found. **Not evidenced.**
- **Actual cost/yield/WIP:** dashboard and repository summaries exist, so these are present at a basic analytic level; cost model correctness and inventory/GL reconciliation are **Requires runtime verification**.

## 7. Explicit disposition decisions

| Decision | Areas | Rationale / condition |
|---|---|---|
| **Keep** | P4 report pages and shared report helpers; VAT/WHT schedules; new bank statement/reconciliation workspace; P4C approvals; backed construction project/procurement/retention workflow; manufacturing BOM/work-order foundation; distinct Revenue Breakdown, Branch Performance, Changes in Equity and Multi-currency reports pending product decision | These are implemented surfaces with distinct capabilities. Keep each until there is verified parity or a deliberate scope decision. Preserve old report capabilities (integrity checks, XBRL, notes) if still required. |
| **Replace** | Legacy Trial Balance, SOFP, P&L and Cash Flow tabs with canonical P4 destinations, **only after** line-by-line output, sign, opening balance, branch, date and export parity checks | Current duplicates use different data paths and may differ materially. Keep compatibility redirects during cutover; do not silently remove XBRL or SOFP integrity checks. |
| **Replace** | Legacy `/bank-reconcile` with new account/statement/match workflow after data and user migration | New route is structurally richer, but legacy writes directly and has an existing nav link. Migrate/verify first; then redirect or retire intentionally. |
| **Rebuild** | Common reporting query/calculation contract spanning new RPC reports and old repository/view-backed tabs | Align date semantics, branch visibility, posted/reversed treatment, currency, pagination, errors and exports. Keep accounting formulas pure and centrally tested; require accounting sign-off. |
| **Rebuild / complete** | Manufacturing BOM/production if roadmap needs full production planning | Current one-level BOM and run/scrap capture are a foundation, not multi-stage planning. Define routings, quality, traceability, capacity and costing before extending schema/UI. |
| **Retire** | `/projects-funding-sources/construction-draft` local-only surface after the backed project-creation flow is confirmed usable | Route stores drafts only in component memory and is not a durable project system. Retire/redirect only after product owner approval; do not imply current draft state migrates. |
| **Retire** | Old duplicate bank page and replaced legacy report tabs after parity and user cutover | Avoid two write paths/reporting definitions after the replacement is verified. Preserve useful integrity/export functions by extracting them first. |
| **Extract** | Shared report scope/filter, date-period helpers, branch access, typed query adapter, calculation helpers and export controls | P4 already extracts Trial Balance repository, period/branch controls and CSV/PDF utilities; the older repository/view reports still diverge. Extend the shared layer rather than duplicating another report stack. |
| **Extract** | Bank CSV validation/matcher/reconciliation report as independent tested modules | Already partly extracted (`statementCsv.ts`, `src/lib/reconciliation/matcher.ts`, `reconciliationReport.ts`); preserve these as the canonical reusable components and remove duplicate legacy logic only at cutover. |
| **Extract** | Approval state/actions from page-level UI into shared document integration | `ApprovalRepository` and `ApprovalBanner` already provide the base. Extend supported document types only through explicit policy and server-side transition design. |

## 8. Prioritized roadmap

1. **P0 — Review and approve this audit; keep Track A deferred until approval.** Resolve any scope, reporting-standard, construction and manufacturing assumptions before implementation. This audit did not test or query the live database.
2. **P1 — Close generated-type/RPC drift.** Reconcile the 11 source-invoked functions absent from generated `Functions`, especially `get_trial_balance` and the bank reconciliation RPCs; regenerate or deliberately type the client boundary. Align generated table declarations with bank account/match writes. Verify against migration source in a separate approved task; this audit did not inspect live schema.
3. **P1 — Establish the canonical reporting contract.** Compare legacy and P4 outputs on representative posted/reversed, opening-balance, multi-currency, branch and long-history cases. Document date inclusivity, natural-balance signs, retained-earnings calculation and account classifiers. Preserve/export XBRL and integrity checks where required. Then redirect duplicate Trial Balance/SOFP/P&L/Cash Flow tabs.
4. **P1 — Finish bank cutover deliberately.** Compare legacy import and matching to P4B, verify statement locking/unlocking and partial-match behavior, confirm file formats, migrate users/data, and remove duplicate nav destinations. Retain legacy route until acceptance; point “Reconcile” to a useful destination.
5. **P2 — Define construction product gaps.** Confirm need for subcontractors, project cash forecasts, hierarchical BOQ, HSE, RFIs/change control and durable draft migration. Use existing project/BOQ/valuation/retention command paths as the base; do not count retention aging as missing.
6. **P2 — Define manufacturing target scope.** If full manufacturing is intended, prioritize recursive/multi-level BOM/version effectivity, routings/work centres, demand/capacity planning, quality/rework, batch/serial genealogy and labor/machine capture. First validate current inventory and GL costing/reconciliation.
7. **P2 — Extend approvals by document only when policy is approved.** Current source supports PO and journal entries. Decide whether invoice/expense or other workflows are required; preserve direct authorization behavior when no workflow applies and verify rejection/resubmission server safeguards.
8. **P3 — Remove local-only and localization debt.** After product approval, retire or redirect the construction draft prototype; localize legacy report/bank/organisation pages; keep route/nav aliases only where backward compatibility is intentional.
9. **Release gate — Runtime verification is separate.** Once authorized, use a disposable/test environment to verify route guards, plan/profile/role outcomes, RPC signatures, statement formats, accounting outputs, exports, migrations, and concurrent approval/reconciliation transitions. No such checks were run for this audit.

---

## Citation index and source scope

All source references in this document are to the audited current-main snapshot `a5360fb`, not the pre-audit branch contents. Core locations:

- Router/lazy component map and report wrappers: `src/App.tsx:58–147,160–254,322–655`.
- Guards and plan layers: `src/routes/ProtectedRoute.tsx:8–80`; `src/components/billing/CapabilityGate.tsx:23–52`; `src/components/billing/PlanGate.tsx:25–60`; `src/hooks/useCapability.ts:14–43,60–85`; `src/lib/billing/plans.ts:8–19,32–109`.
- Sidebar and plan/visibility construction: `src/components/layout/navConfig.ts:70–189,288–378`; `src/components/layout/Sidebar.tsx:116–191,193–249`.
- Generated public schema and function declarations: `src/dal/types/database.generated.ts:36–13239`.
- Reporting: `src/dal/repositories/ReportRepository.ts:22–36`; `src/pages/reports/TrialBalancePage.tsx:45–120,123+`; `src/pages/reports/ProfitLossPage.tsx:151–190,206–230,320–333`; `src/pages/reports/BalanceSheetPage.tsx:101–193,250–255`; `src/pages/reports/CashFlowPage.tsx:57–204`; `src/pages/reports/VatReturnPage.tsx:105–195`; `src/pages/reports/WhtSchedulePage.tsx:93–193`; `src/lib/tax-accounts.ts:20–42`.
- Legacy reports and bank comparison: `src/pages/ReportsPage.tsx:101–181,238–304,370–450`; `src/dal/repositories/FinancialStatementRepository.ts:170–275`; `src/components/reports/StatementOfFinancialPosition.tsx:101–155,202–260`; `src/components/reports/StatementOfProfitOrLoss.tsx:115–132,214–273`; `src/components/reports/CashFlowStatement.tsx:19–43,110–175`; `src/components/reports/StatementOfChangesInEquity.tsx:53–172`; `src/components/reports/RevenueBreakdownReport.tsx:34–160`; `src/components/reports/BranchPerformanceReport.tsx:230–350`; `src/components/bank/BankReconciliation.tsx:117–145,211–238,240–399`.
- New bank and approval: `src/dal/repositories/BankReconciliationRepository.ts:286–312,399–530`; `src/lib/bankReconciliation/statementCsv.ts:44–232+`; `src/pages/bank-reconciliation/ReconcilePage.tsx:300–458`; `src/pages/settings/ApprovalsTab.tsx:50–299`; `src/dal/repositories/ApprovalRepository.ts:85–177`; `src/components/approvals/ApprovalBanner.tsx:8–200+`.
- Construction/manufacturing: `src/pages/construction/ConstructionWorkspacePage.tsx:22–46,55–79,89–172`; `src/dal/repositories/ProjectRepository.ts:8–15,38–64,65–169`; `src/components/construction/reports/RetentionAgingReport.tsx:19–24,99–176`; `src/pages/ConstructionProjectSetupDraftPage.tsx:25–37,89–109`; `src/pages/manufacturing/BomEditorPage.tsx:220–319,339–400`; `src/pages/manufacturing/WorkOrderDetailPage.tsx:210–247,329–360,810–880`; generated BOM schema `src/dal/types/database.generated.ts:6723–6773`.

Unknown or not established by source is deliberately left as **Unknown** / **Requires runtime verification**. This document does not assert production migration status, live table contents, actual tenant entitlements, or accounting-standard compliance.
