# Full Application Audit

**Audit date:** 2026-10-27  
**Repository snapshot:** `arena/48af1f5c-ledgr-react` at `09b30a1` (`Merge pull request #213 from gremu-ship-it/main`)  
**Mode:** Read-only audit. No application code, routes, dependencies, migrations, or database objects were changed.

## Scope and evidence

This report describes the checked-out repository, not a hypothetical newer branch. I inspected `src/App.tsx`, `src/components/layout/navConfig.ts`, `src/components/layout/Sidebar.tsx`, route/page implementations, generated Supabase types, repository/service code, source tests, and migration files. I also queried read-only metadata and exact row counts from the active Supabase project named **Ledgr** on 2026-10-27. The live database is ahead of this source snapshot in some vertical areas: it has construction and manufacturing tables/data that are not routed to operational pages in this checkout. Do not infer that a database object is a user-facing feature.

Quality marks in Section 4 are source inspection findings; this audit did not run the test suite or build. `✅` = clearly present, `⚠️` = partial/inconsistent, `❌` = absent or materially deficient.

---

## 1. Route Inventory

All application route definitions are in `src/App.tsx`. Authenticated business routes are wrapped by `ProtectedRoute` and `AppLayout`; most business routes are also inside `RoleRoute`, which sends users without a route role to their role home. The two construction draft aliases are outside `RoleRoute`. Plan gates are soft gates: the route exists, but the page content is replaced by the upgrade screen when the plan lacks the capability.

Data-source abbreviations: **DB** = direct Supabase table/view query; **RPC** = Supabase RPC; **Repo** = DAL/repository; **Local** = browser-only/demo/local state; **—** = no application data query.

| Route path | Component file | Renders real UI? | Data source | Plan gate | Vertical gate | i18n? |
|---|---|---|---|---|---|---|
| `/login` | `src/pages/LoginPage.tsx` | Yes — sign-in | Supabase Auth | None | Public-only while signed out | Yes |
| `/register` | `src/pages/RegisterPage.tsx` | Yes — registration | Supabase Auth | None | Public-only while signed out | Yes |
| `/forgot-password` | `src/pages/auth/ForgotPasswordPage.tsx` | Yes — password reset request | Supabase Auth | None | Public-only while signed out | Yes |
| `/terms-and-conditions` | `src/pages/TermsAndConditionsPage.tsx` | Yes — static legal text | — | None | Public | No |
| `/demo` | `src/pages/DemoPage.tsx` | Yes — static product tour, not tenant data | Local/static | None | Public | Partial |
| `/demo/enter` | `src/pages/DemoEntryPage.tsx` | Yes — enters seeded browser-local demo | Local/demo mode + Auth | None | Public entry | No |
| `/reset-password` | `src/pages/auth/ResetPasswordPage.tsx` | Yes — password update | Supabase Auth | None | Standalone password-recovery flow | Yes |
| `/accept-invitation` | `src/pages/AcceptInvitationPage.tsx` | Yes — invitation acceptance | RPC/Auth | None | Standalone invite flow | Yes |
| `/create-business` | `src/pages/CreateBusinessPage.tsx` | Yes — business setup | RPC + Supabase | None | Authenticated | No |
| `/admin/billing` | `src/pages/admin/AdminBillingPage.tsx` | Yes — platform billing administration | DB/RPC | None | `PlatformAdminRoute` | No |
| `/admin/businesses` | `src/pages/admin/AdminBusinessesPage.tsx` | Yes — platform business administration | DB/RPC | None | `PlatformAdminRoute` | No |
| `/partner-admin` | `src/pages/partner-admin/PartnerAdminDashboard.tsx` | Yes — partner portal | DB/repositories | None | `PartnerAdminRoute` | No |
| `/partner-admin/partners/:id` | `src/pages/partner-admin/PartnerOverviewPage.tsx` | Yes — partner detail | DB/repositories | None | `PartnerAdminRoute` | No |
| `/partner-admin/partners/:id/settings` | `src/pages/partner-admin/PartnerSettingsPage.tsx` | Yes — partner configuration | DB | None | `PartnerAdminRoute` | No |
| `/partner-admin/partners/:id/clients` | `src/pages/partner-admin/PartnerClientsPage.tsx` | Yes — client management | DB | None | `PartnerAdminRoute` | No |
| `/partner-admin/partners/:id/billing` | `src/pages/partner-admin/PartnerBillingPage.tsx` | Yes — partner billing | DB/RPC | None | `PartnerAdminRoute` | No |
| `/projects-funding-sources/construction-draft` | `src/pages/ConstructionProjectSetupDraftPage.tsx` | Draft UI only — not a posted or server-backed project workflow | Local draft storage | None | None; outside `RoleRoute` | No |
| `/construction` | `src/pages/ConstructionProjectSetupDraftPage.tsx` | Draft UI only — route comment explicitly says no repository/backend/auth path | Local draft storage | None | None; outside `RoleRoute` | No |
| `/dashboard` | `src/pages/DashboardPage.tsx` | Yes — business dashboard | DB/repositories | None | `RoleRoute`; capability-aware home | Yes |
| `/pos` | `src/pages/PosPage.tsx` | Yes — POS, shifts, sales, returns, discounts, split tender | RPC/services + DB reads | No explicit `PlanGate`; `CapabilityGate(pos)` | Organisation capability `pos`; role route | No |
| `/income` | `src/pages/IncomePage.tsx` | Yes — income/receipt creation | DB/services + ledger posting | None | Role route | No |
| `/expenses` | `src/pages/ExpensesPage.tsx` | Yes — expense entry and payments | DB/services + ledger posting | None | Role route | No |
| `/invoices` | `src/pages/InvoicesPage.tsx` | Yes — invoice lifecycle | DB/services/RPC in write paths | None | Role route | No |
| `/payroll` | `src/pages/PayrollPage.tsx` | Yes — payroll | DB/repositories | Partner feature `payroll` | Role route | No |
| `/products` | `src/pages/ProductsPage.tsx` | Yes — product catalogue | DB/repositories | Partner `inventory` + plan capability `inventory` | Organisation capability `inventory` | No |
| `/inventory` | `src/pages/InventoryPage.tsx` | **No — placeholder** (“Coming soon.”) | None | Partner `inventory` + plan capability `inventory` | Organisation capability `inventory` | No |
| `/warehouse` | `src/pages/WarehousePage.tsx` | Yes — warehouse UI, but stock synchronization is explicitly suspended | DB/repositories | Partner `inventory` + plan capability `inventory` | Organisation capability `inventory` | No |
| `/transfers` | `src/pages/TransfersPage.tsx` | Yes — stock transfers | DB/services | Partner `inventory` + plan capability `inventory` | Organisation capability `inventory` | No |
| `/accounts` | `src/pages/AccountsPage.tsx` | Yes — chart of accounts | DB/repositories | `core_accounting` (Starter+) | Role route | No |
| `/assets` | `src/pages/AssetsPage.tsx` | Yes — fixed asset register/depreciation | DB/repositories | `core_accounting` (Starter+) | Role route | No |
| `/capital` | `src/pages/CapitalPage.tsx` | Yes — loans/share capital | DB/repositories | `core_accounting` (Starter+) | Role route | No |
| `/tax` | `src/pages/TaxPage.tsx` | Yes — tax configuration and PAYE bands; not a tax-return report | DB | `core_accounting` (Starter+) | Role route | No |
| `/reports` | `src/pages/ReportsPage.tsx` | Yes — combined tabbed reporting surface | View, DB, repository; see Section 5 | `core_accounting` (Starter+) | Role route | **No** — tab/filter text is hardcoded |
| `/journals` | `src/pages/JournalsPage.tsx` | Yes — journal entry workflow | DB/repositories/services | `accounting_organisation` (Growth+) | Role route | No |
| `/periods` | `src/pages/PeriodManagementPage.tsx` | Yes — accounting-period management | DB/RPC | `accounting_organisation` (Growth+) | Role route | No |
| `/bank-reconcile` | `src/components/bank/BankReconciliation.tsx` | Yes — one reconciliation surface, including statement/account workflow | DB; some direct writes | Partner feature + `bank_reconciliation` (Growth+) | Role route | No |
| `/audit` | `src/pages/AuditLogPage.tsx` | Yes — audit log and exports | DB + audit-chain RPCs | `accounting_organisation` (Growth+) | Role route | No |
| `/contacts` | `src/pages/ContactsPage.tsx` | Yes — customer/supplier contacts | DB/repositories | `accounting_organisation` (Growth+) | Role route | No |
| `/branches` | `src/pages/BranchesPage.tsx` | Yes — branch management | DB | `accounting_organisation` (Growth+) | Role route and branch-aware access | No |
| `/departments` | `src/pages/DepartmentsPage.tsx` | Yes — department management | DB | `accounting_organisation` (Growth+) | Role route | No |
| `/api-docs` | `src/pages/ApiDocumentationPage.tsx` | Yes — API documentation | Static | `api_access` (Pro+) | Role route | Yes |
| `/api-keys` | `src/pages/ApiKeysPage.tsx` | Yes — API-key management | DB | `api_access` (Pro+) | Role route | Yes |
| `/zapier` | `src/pages/ZapierIntegrationPage.tsx` | Yes — webhook/Zapier configuration | DB | `webhooks` (Pro+) | Role route | Yes |
| `/ai` | `src/pages/AiInsightsPage.tsx` | Yes — AI insights/chat | Edge function/DB context | Partner AI feature + `ai_insights` (Pro+) | Role route | No |
| `/chat` | `Navigate` to `/ai` | No separate UI — redirect | — | Inherits `/ai` gate | Role route | N/A |
| `/settings` | `src/pages/SettingsPage.tsx` | Yes — business/settings tabs | DB | None | Role route | No |
| `/settings/repair-coa` | `src/pages/RepairCoaPage.tsx` | Yes — chart repair utility | DB/RPC | None | Role route | No |
| `/support` | `src/pages/SupportPage.tsx` | Yes — support surface | Static/edge knowledge base | None | Role route | Yes |
| `/tools` | `src/pages/ToolsPage.tsx` (default export) | Yes — tools catalogue | Mixed/local | None | Role route | No |
| `/import` | `src/pages/DataImportPage.tsx` | Yes — CSV import | DB/services | None | Role route | No |
| `/data-import` | `src/pages/DataImportPage.tsx` | Same import UI alias | DB/services | None | Role route | No |
| `/onboarding/import` | `src/pages/DataImportPage.tsx` | Same import UI alias | DB/services | None | Role route | No |
| `/` | `Navigate` to computed home | Redirect only | — | Computed by home route | Auth/role-dependent | N/A |
| `*` | `Navigate` to computed home | Redirect only | — | Computed by home route | Auth/role-dependent | N/A |

**Important gate behavior:** `PlanGate` is soft gating, not route removal. `/accounts`, `/tax`, `/assets`, and `/reports` are Starter+; `/journals`, `/periods`, `/audit`, and organisation surfaces are Growth+; API and AI surfaces are Pro+. `CapabilityGate` handles operating-model access. Not every `featureName` string in route wrappers is translated.

---

## 2. Sidebar Navigation Structure

`src/components/layout/navConfig.ts` supplies flat section arrays; `src/components/layout/Sidebar.tsx` renders each section as a heading and a single `<ul>`. **There are no nested submenus or sub-submenus.** Every configured route is one level under its section. Section/item labels are i18n keys, not literal English; most page content itself is not localized.

| Section label key | Item label key | Route | Nesting | Visibility/gating in code | Route status |
|---|---|---|---|---|---|
| `navigation.sections.overview` | `navigation.items.dashboard` | `/dashboard` | Section → item | Role path filter | Exists; live dashboard |
| `navigation.sections.overview` | `navigation.items.pos` | `/pos` | Section → item | `requiresOrgCapability: pos`; route `CapabilityGate(pos)` | Exists; operational POS |
| `navigation.sections.finance` | `navigation.items.income` | `/income` | Section → item | Role path filter | Exists; operational |
| `navigation.sections.finance` | `navigation.items.expenses` | `/expenses` | Section → item | Role path filter | Exists; operational |
| `navigation.sections.finance` | `navigation.items.invoices` | `/invoices` | Section → item | Role path filter | Exists; operational |
| `navigation.sections.finance` | `navigation.items.payroll` | `/payroll` | Section → item | Partner feature `payroll`; route partner gate | Exists; operational |
| `navigation.sections.inventory` | `navigation.items.products` | `/products` | Section → item | Partner `inventory`; plan `inventory`; org capability `inventory` | Exists; operational |
| `navigation.sections.inventory` | `navigation.items.warehouse` | `/warehouse` | Section → item | Partner `inventory`; plan `inventory`; org capability `inventory` | Exists; UI present, stock sync suspended |
| `navigation.sections.inventory` | `navigation.items.transfers` | `/transfers` | Section → item | Partner `inventory`; plan `inventory`; org capability `inventory` | Exists; operational stock transfers |
| `navigation.sections.accounting` | `navigation.items.accounts` | `/accounts` | Section → item | `core_accounting` (Starter+) | Exists; operational |
| `navigation.sections.accounting` | `navigation.items.tax` | `/tax` | Section → item | `core_accounting` (Starter+) | Exists; tax setup, not filing report |
| `navigation.sections.accounting` | `navigation.items.assets` | `/assets` | Section → item | `core_accounting` (Starter+) | Exists; operational |
| `navigation.sections.accounting` | `navigation.items.capital` | `/capital` | Section → item | `core_accounting` (Starter+) | Exists; operational |
| `navigation.sections.accounting` | `navigation.items.reports` | `/reports` | Section → item | `core_accounting` (Starter+) | Exists; combined reports, quality issues below |
| `navigation.sections.accounting` | `navigation.items.journals` | `/journals` | Section → item | `accounting_organisation` (Growth+) | Exists; operational |
| `navigation.sections.accounting` | `navigation.items.bankReconciliation` | `/bank-reconcile` | Section → item | Partner `bank_reconciliation`; capability `bank_reconciliation`; Growth+ | Exists; one combined workflow |
| `navigation.sections.accounting` | `navigation.items.periods` | `/periods` | Section → item | `accounting_organisation` (Growth+) | Exists; operational |
| `navigation.sections.accounting` | `navigation.items.auditLog` | `/audit` | Section → item | `accounting_organisation` (Growth+) | Exists; audit log |
| `navigation.sections.organisation` | `navigation.items.contacts` | `/contacts` | Section → item | `accounting_organisation` (Growth+) | Exists; operational |
| `navigation.sections.organisation` | `navigation.items.branches` | `/branches` | Section → item | `accounting_organisation` (Growth+) | Exists; operational |
| `navigation.sections.organisation` | `navigation.items.departments` | `/departments` | Section → item | `accounting_organisation` (Growth+) | Exists; operational |
| `navigation.sections.construction` | `navigation.items.constructionWorkspace` | `/construction` | Section → item | `allowAllAuthenticatedRoles`; no plan or vertical gate in nav | Exists, but only local draft page; not an operational workspace |
| `navigation.sections.ai` | `navigation.items.ledgrAi` | `/ai` | Section → item | Partner `ai_advisor`; `ai_insights` (Pro+) | Exists; operational AI surface |
| `navigation.sections.support` | `navigation.items.support` | `/support` | Section → item | Role path filter | Exists; support UI |
| `navigation.sections.admin` (Sidebar-only) | `navigation.items.businesses` | `/admin/businesses` | Admin section → item | Platform admin only | Exists; operational |
| `navigation.sections.admin` (Sidebar-only) | `navigation.items.adminBilling` | `/admin/billing` | Admin section → item | Platform admin only | Exists; operational |

The route guard separately blocks role-ineligible business routes. Locked items remain visible and show an upgrade lock; partner feature and organisation-capability filters remove items. The construction link is the exception: it deliberately bypasses the role filter and, in this checkout, exposes a draft page without Enterprise or construction-model gating. `/inventory` is not in the main sidebar, but appears in the Tools catalogue. A shared navigation helper maps that path to the Products nav item, while `App.tsx` still routes `/inventory` to the “Coming soon” placeholder; these alternate navigation surfaces therefore disagree about what the route does.

---

## 3. Database Schema Summary

### Source and count methodology

The live **Ledgr** Supabase project was queried read-only on 2026-10-27. It reported **124 public base tables**, **308 policies across 112 tables**, and 12 other public tables with RLS enabled but no policies (therefore default-deny for ordinary roles). `pg_class.reltuples` values below are approximate planner estimates; unknown/negative estimates are represented as `0~`, which does **not** mean an exact empty table. Exact counts were separately queried for key tables. These figures are a live-DB snapshot, not necessarily the schema state represented by this older source commit.

#### Public tables and estimated rows

`0~` denotes an unavailable/zero planner estimate; other numbers are the `reltuples` estimate.

```text
accounting_period_events:0~, accounting_periods:10, accounts:2613, ai_insights_usage:1, api_keys:0~, api_usage:0~, approval_history:0~, approval_request_steps:0~, approval_requests:0~, approval_workflow_steps:0~, approval_workflows:0~, asset_categories:71, audit_20260927_sent_to_paid:0~, audit_log:21309, bank_accounts:0~, bank_reconciliation_matches:0~, bank_statement_import_metadata:0~, bank_statement_lines:0~, bank_statements:0~, branches:19, budget_lines:0~, budgets:0~, business_invitations:2, business_terms_acceptances:0~, business_users:19, businesses:13,
construction_delivery_note_lines:0~, construction_delivery_notes:0~, construction_goods_receipt_holds:0~, construction_goods_receipt_lines:0~, construction_goods_receipt_notes:0~, construction_material_issues:0~, construction_material_returns:0~, construction_procurement_capabilities:0~, construction_procurement_grants:0~, construction_procurement_sites:0~, construction_product_uom_conversions:0~, construction_projects:5, construction_purchase_order_events:0~, construction_purchase_order_lines:0~, construction_purchase_orders:0~, construction_receipt_bill_allocations:0~, construction_receipt_cost_bases:0~, construction_receipt_inspections:0~, construction_receipt_line_reclassifications:0~, construction_receipt_posting_policies:0~, construction_supplier_invoice_references:0~, contacts:10, currencies:155, departments:7, depreciation_schedules:1, employee_allowances:0~, employee_deductions:0~, employees:20, exchange_rates:0~,
expense_lines:499, expense_payments:0~, expenses:514, fixed_assets:4, fx_revaluations:0~, inventory_balances:94, inventory_locations:25, invoice_approval_policies:0~, invoice_approvals:0~, invoice_delivery_events:0~, invoice_lines:561, invoice_payments:4, invoices:513, journal_entries:2124, journal_lines:4511, loan_repayments:6, loans:4, manufacturing_bom_lines:0~, manufacturing_boms:0~, manufacturing_capabilities:0~, manufacturing_capability_grants:0~, manufacturing_material_transactions:0~, manufacturing_production_runs:0~, manufacturing_work_order_lines:0~, manufacturing_work_orders:0~, offline_queue_reconciliations:0~, partner_admins:0~, partner_clients:0~, partner_feature_flags:0~, partner_invoices:0~, partners:0~,
paye_bands:59, payroll_employee_lines:3, payroll_runs:5, phone_accounts:0~, pos_approvals:0~, pos_cash_movements:0~, pos_corrections:0~, pos_price_overrides:0~, pos_settings:0~, pos_shift_closes:0~, pos_shift_late_adjustments:0~, pos_shifts:0~, pos_terminals:0~, product_categories:0~, products:38, profiles:0~, project_boq_lines:0~, project_retention_ledger:0~, project_status_log:0~, project_valuation_lines:0~, project_valuations:0~, recurring_invoices:0~, share_transactions:6, stock_movements:896, stock_transfer_lines:85, stock_transfers:53, subscription_payments:29, subscription_reminders_sent:0~, subscriptions:0~, support_agent_usage:8, tax_alerts:0~, tax_configurations:120, tax_payments:0~, tax_returns:0~, usage_counters:0~, user_profiles:16, webhook_deliveries:0~, webhooks:0~
```

#### Exact counts for selected tables

| Table | Exact rows | Table | Exact rows |
|---|---:|---|---:|
| `businesses` | 13 | `accounts` | 2,616 |
| `branches` | 25 | `contacts` | 14 |
| `journal_entries` | 2,260 | `journal_lines` | 4,577 |
| `invoices` | 563 | `expenses` | 528 |
| `products` | 82 | `stock_movements` | 907 |
| `fixed_assets` | 8 | `bank_statements` | 0 |
| `budgets` | 0 | `recurring_invoices` | 0 |
| `tax_returns` | 8 | `construction_projects` | 5 |
| `manufacturing_boms` | 8 | `manufacturing_work_orders` | 7 |

### RPC/function inventory

The source code's explicit `.rpc()` call names are: `accept_invitation`, `create_business_with_owner`, `pos_stock_availability`, plus dynamically selected `quickSaveService` commands. Database metadata shows a much wider public routine surface. The following are 174 unique, non-extension public function names after excluding underscore-prefixed private helpers and trigger-returning functions; `×2` indicates overloads. `rls_auto_enable` is an event-trigger helper, not a client RPC. The list includes security/helper functions as well as business commands, so it should not be mistaken for a list of safe client-callable operations.

```text
accept_invitation, accept_invitation_membership, act_on_approval, add_partner_admin, ai_context×2, apply_subscription_payment, approve_construction_receipt_posting_policy, approve_invoice, audit_chain_hash, authorize_construction_purchase_order, authorize_pos_approval, authorize_pos_price_override, backfill_and_recalculate_inventory, bulk_upsert_boq_lines, business_partner_id, can_access_branch, can_access_location, can_admin_business_data, can_approve_step, can_operate_pos, can_read_audit, can_read_partner_client, can_read_partner_peer_business, can_view_payroll, can_write_business_data, can_write_contacts_data, can_write_expense_data, can_write_ledger_directly, can_write_payroll, can_write_sales_data, cancel_construction_purchase_order, clear_partner_admins, close_accounting_period, close_pos_shift_command, construction_procurement_capabilities_for, construction_procurement_open_items, construction_project_material_cost, construction_supplier_reference_visible, consume_api_rate_limit, create_api_journal_entry, create_bank_reconciliation_matches, create_boq_line, create_business_with_owner, create_construction_purchase_order, create_invoice_with_lines, create_project, create_project_purchase_order, create_valuation, current_partner_ids, current_user_role, delete_bank_reconciliation_match, delete_boq_line, delete_draft_bank_statement, diagnose_user_login, effective_plan_tier, find_user_by_email, generate_invoice_from_valuation, get_approval_state, get_bank_gl_book_balance, get_bank_reconciliation_gl_lines, get_boq_summary, get_cost_breakdown_by_project, get_dashboard_metrics×2, get_enum_values, get_portfolio_summary, get_pos_shift_report, get_project_cost_summary, get_project_pnl, get_project_valuation_trend, get_retention_aging, get_retention_summary, get_trial_balance, get_unreconciled_gl_lines, get_user_role, get_valuation_history, get_valuation_trend, grant_construction_procurement_capability, grant_user_business_access, import_bank_statement, increment_amount_paid, invite_member, is_business_member, is_partner_admin, is_partner_business_admin, is_platform_admin, issue_construction_materials_to_project, issue_project_materials, ledgr_monthly_document_count, link_site_to_project, list_all_businesses, list_partner_admins, log_manual_audit_event×2, manufacturing_bom_activate, manufacturing_bom_cost, manufacturing_bom_new_version, manufacturing_cost_variance, manufacturing_dashboard_metrics, manufacturing_production_summary, manufacturing_throughput_trend, manufacturing_wip_aging, manufacturing_wo_cancel, manufacturing_wo_close, manufacturing_wo_complete, manufacturing_wo_create, manufacturing_wo_record_consumption, manufacturing_wo_record_return, manufacturing_wo_record_run, manufacturing_wo_release, manufacturing_wo_start, manufacturing_wo_yield, manufacturing_yield_by_product, match_construction_bill_line_to_receipt, next_journal_entry_number, open_pos_shift_command, plan_tier_rank, pos_stock_availability, post_construction_receipt_movement, post_pos_sale, provision_construction_coa_accounts, provision_construction_defaults, provision_manufacturing_coa_accounts, provision_manufacturing_defaults, reclassify_construction_receipt_line, reconcile_bank_statement, reconcile_offline_queue_item, record_business_terms_acceptance, record_construction_delivery_note, record_construction_delivery_note_exception, record_construction_goods_receipt, record_construction_receipt_cost_basis, record_construction_receipt_inspection, record_expense_payment, record_inventory_journal_movement, record_invoice_payment, record_pos_cash_movement_command, record_sale_stock_and_cogs, refund_pos_sale_command, register_construction_procurement_site, register_construction_product_uom_conversion, register_construction_supplier_invoice_reference, register_construction_supplier_invoice_reference_exception, release_construction_receipt_hold, release_retention, remove_partner_admin, reopen_accounting_period, reorder_boq_lines, request_pos_approval, request_pos_price_override, requires_approval, reserve_next_document_number, resubmit_approval, return_construction_materials_to_store, return_project_materials, revoke_construction_procurement_capability, save_approval_workflow, save_quick_expense, save_quick_sale, seed_new_business×2, set_construction_procurement_site_status, set_invoice_approval_policy, set_user_business_access, start_approval_workflow, submit_valuation, transition_project_status, unlink_site_from_project, unreconcile_bank_statement, update_boq_line, update_business_operating_models, update_construction_procurement_site, update_project, update_valuation, user_has_role, verify_audit_chain, void_pos_sale_command
```

### RLS policy inventory

Live catalog: 308 policies on 112 tables. `public` below is the PostgreSQL `PUBLIC` role; `authenticated` and `anon` are explicit roles. Commands are `ALL`, `SELECT`, `INSERT`, `UPDATE`, or `DELETE`. Policies' `USING`/`WITH CHECK` expressions are not repeated here; role/command/name are as requested. Twelve tables have RLS enabled but zero policies: `ai_insights_usage`, `api_usage`, `audit_20260927_sent_to_paid`, `business_terms_acceptances`, `phone_accounts`, `pos_approvals`, `pos_corrections`, `profiles`, `subscription_reminders_sent`, `subscriptions`, `support_agent_usage`, `usage_counters` (default-deny for normal roles).

| Table | Policies (policy name [role command]) |
|---|---|
| `accounting_period_events` | `period_events_member_read` [authenticated SELECT] |
| `accounting_periods` | `accounting_periods_admin_delete` [public DELETE]; `accounting_periods_member_read` [public SELECT]; `accounting_periods_platform_admin_read` [public SELECT]; `accounting_periods_writer_insert` [public INSERT]; `accounting_periods_writer_update` [public UPDATE] |
| `accounts` | `accounts_admin_delete` [public DELETE]; `accounts_member_read` [public SELECT]; `accounts_platform_admin_read` [public SELECT]; `accounts_writer_insert` [public INSERT]; `accounts_writer_update` [public UPDATE] |
| `api_keys` | `Users can manage their business api keys` [public ALL]; `api_keys_business_read` [public SELECT]; `api_keys_business_update` [public UPDATE] |
| `approval_history` | `approval_history_member_read` [authenticated SELECT] |
| `approval_request_steps` | `approval_request_steps_member_read` [authenticated SELECT] |
| `approval_requests` | `approval_requests_member_read` [authenticated SELECT] |
| `approval_workflow_steps` | `approval_workflow_steps_member_read` [authenticated SELECT] |
| `approval_workflows` | `approval_workflows_member_read` [authenticated SELECT] |
| `asset_categories` | `asset_categories_admin_delete` [public DELETE]; `asset_categories_member_read` [public SELECT]; `asset_categories_platform_admin_read` [public SELECT]; `asset_categories_writer_insert` [public INSERT]; `asset_categories_writer_update` [public UPDATE] |
| `audit_log` | `audit_log_insert` [authenticated INSERT]; `audit_log_platform_admin_read` [public SELECT]; `audit_log_read` [public SELECT]; `audit_log_select` [public SELECT] |
| `bank_accounts` | `bank_accounts_admin_delete` [authenticated DELETE]; `bank_accounts_member_read` [authenticated SELECT]; `bank_accounts_writer_insert` [authenticated INSERT]; `bank_accounts_writer_update` [authenticated UPDATE] |
| `bank_reconciliation_matches` | `bank_recon_matches_member_read` [authenticated SELECT]; `bank_recon_matches_writer_delete` [authenticated DELETE]; `bank_recon_matches_writer_insert` [authenticated INSERT] |
| `bank_statement_import_metadata` | `bank_statement_import_metadata_admin_delete` [authenticated DELETE]; `bank_statement_import_metadata_member_read` [authenticated SELECT]; `bank_statement_import_metadata_writer_insert` [authenticated INSERT]; `bank_statement_import_metadata_writer_update` [authenticated UPDATE] |
| `bank_statement_lines` | `bank_statement_lines_admin_delete` [public DELETE]; `bank_statement_lines_member_read` [public SELECT]; `bank_statement_lines_platform_admin_read` [public SELECT]; `bank_statement_lines_writer_insert` [public INSERT]; `bank_statement_lines_writer_update` [public UPDATE] |
| `bank_statements` | `bank_statements_admin_delete` [public DELETE]; `bank_statements_member_read` [public SELECT]; `bank_statements_platform_admin_read` [public SELECT]; `bank_statements_writer_insert` [public INSERT]; `bank_statements_writer_update` [public UPDATE] |
| `branches` | `branches_admin_delete` [public DELETE]; `branches_member_read` [public SELECT]; `branches_platform_admin_read` [public SELECT]; `branches_writer_insert` [public INSERT]; `branches_writer_update` [public UPDATE] |
| `budget_lines` | `budget_lines_admin_delete` [public DELETE]; `budget_lines_member_read` [public SELECT]; `budget_lines_platform_admin_read` [public SELECT]; `budget_lines_writer_insert` [public INSERT]; `budget_lines_writer_update` [public UPDATE] |
| `budgets` | `budgets_admin_delete` [public DELETE]; `budgets_member_read` [public SELECT]; `budgets_platform_admin_read` [public SELECT]; `budgets_writer_insert` [public INSERT]; `budgets_writer_update` [public UPDATE] |
| `business_invitations` | `business_invitations_business_access` [public ALL] |
| `business_users` | `Users can read own memberships` [public SELECT]; `bu_delete` [public DELETE]; `bu_insert_self` [anon,authenticated INSERT]; `bu_select` [public SELECT]; `bu_update` [public UPDATE]; `business_users_accept_invitation` [authenticated SELECT]; `business_users_admin_delete` [public DELETE]; `business_users_admin_update` [public UPDATE]; `business_users_admin_write` [public INSERT]; `business_users_member_read` [public SELECT]; `business_users_platform_admin_read` [public SELECT] |
| `businesses` | `businesses_delete` [public DELETE]; `businesses_insert` [authenticated INSERT]; `businesses_member_read` [public SELECT]; `businesses_partner_admin_read` [public SELECT]; `businesses_partner_peer_read` [public SELECT]; `businesses_platform_admin_read` [public SELECT]; `businesses_update` [public UPDATE] |
| `construction_delivery_note_lines` | `construction_delivery_note_lines_member_read` [authenticated SELECT] |
| `construction_delivery_notes` | `construction_delivery_notes_member_read` [authenticated SELECT] |
| `construction_goods_receipt_holds` | `construction_goods_receipt_holds_member_read` [authenticated SELECT] |
| `construction_goods_receipt_lines` | `construction_goods_receipt_lines_member_read` [authenticated SELECT] |
| `construction_goods_receipt_notes` | `construction_goods_receipt_notes_member_read` [authenticated SELECT] |
| `construction_material_issues` | `construction_material_issues_member_read` [authenticated SELECT] |
| `construction_material_returns` | `construction_material_returns_member_read` [authenticated SELECT] |
| `construction_procurement_capabilities` | `construction_procurement_capabilities_read` [authenticated SELECT] |
| `construction_procurement_grants` | `construction_procurement_grants_member_read` [authenticated SELECT] |
| `construction_procurement_sites` | `construction_procurement_sites_member_read` [authenticated SELECT] |
| `construction_product_uom_conversions` | `construction_product_uom_conversions_member_read` [authenticated SELECT] |
| `construction_projects` | `projects_member_grants` [authenticated ALL] |
| `construction_purchase_order_events` | `construction_purchase_order_events_member_read` [authenticated SELECT] |
| `construction_purchase_order_lines` | `construction_purchase_order_lines_member_read` [authenticated SELECT] |
| `construction_purchase_orders` | `construction_purchase_orders_member_read` [authenticated SELECT] |
| `construction_receipt_bill_allocations` | `construction_receipt_bill_allocations_member_read` [authenticated SELECT] |
| `construction_receipt_cost_bases` | `construction_receipt_cost_bases_member_read` [authenticated SELECT] |
| `construction_receipt_inspections` | `construction_receipt_inspections_member_read` [authenticated SELECT] |
| `construction_receipt_line_reclassifications` | `construction_receipt_line_reclassifications_member_read` [authenticated SELECT] |
| `construction_receipt_posting_policies` | `construction_receipt_posting_policies_member_read` [authenticated SELECT] |
| `construction_supplier_invoice_references` | `construction_supplier_invoice_references_member_read` [authenticated SELECT] |
| `contacts` | `contacts_admin_delete` [public DELETE]; `contacts_member_read` [public SELECT]; `contacts_platform_admin_read` [public SELECT]; `contacts_writer_insert` [public INSERT]; `contacts_writer_update` [public UPDATE] |
| `currencies` | `currencies_read` [authenticated SELECT] |
| `departments` | `departments_admin_delete` [public DELETE]; `departments_member_read` [public SELECT]; `departments_platform_admin_read` [public SELECT]; `departments_writer_insert` [public INSERT]; `departments_writer_update` [public UPDATE] |
| `depreciation_schedules` | `depreciation_schedules_admin_delete` [public DELETE]; `depreciation_schedules_member_read` [public SELECT]; `depreciation_schedules_platform_admin_read` [public SELECT]; `depreciation_schedules_writer_insert` [public INSERT]; `depreciation_schedules_writer_update` [public UPDATE] |
| `employee_allowances` | `employee_allowances_payroll_delete` [public DELETE]; `employee_allowances_payroll_insert` [public INSERT]; `employee_allowances_payroll_read` [public SELECT]; `employee_allowances_payroll_update` [public UPDATE] |
| `employee_deductions` | `employee_deductions_payroll_delete` [public DELETE]; `employee_deductions_payroll_insert` [public INSERT]; `employee_deductions_payroll_read` [public SELECT]; `employee_deductions_payroll_update` [public UPDATE] |
| `employees` | `employees_admin_delete` [public DELETE]; `employees_member_read` [public SELECT]; `employees_platform_admin_read` [public SELECT]; `employees_writer_insert` [public INSERT]; `employees_writer_update` [public UPDATE] |
| `exchange_rates` | `exchange_rates_business_read` [public SELECT]; `exchange_rates_business_write` [public INSERT]; `exchange_rates_delete` [public DELETE]; `exchange_rates_insert` [public INSERT]; `exchange_rates_select` [public SELECT]; `exchange_rates_update` [public UPDATE] |
| `expense_lines` | `expense_lines_admin_delete` [public DELETE]; `expense_lines_member_read` [public SELECT]; `expense_lines_platform_admin_read` [public SELECT]; `expense_lines_writer_insert` [public INSERT]; `expense_lines_writer_update` [public UPDATE] |
| `expense_payments` | `expense_payments_admin_delete` [public DELETE]; `expense_payments_member_read` [public SELECT]; `expense_payments_platform_admin_read` [public SELECT]; `expense_payments_writer_insert` [public INSERT]; `expense_payments_writer_update` [public UPDATE] |
| `expenses` | `expenses_admin_delete` [public DELETE]; `expenses_member_read` [public SELECT]; `expenses_platform_admin_read` [public SELECT]; `expenses_writer_insert` [public INSERT]; `expenses_writer_update` [public UPDATE] |
| `fixed_assets` | `fixed_assets_admin_delete` [public DELETE]; `fixed_assets_member_read` [public SELECT]; `fixed_assets_platform_admin_read` [public SELECT]; `fixed_assets_writer_insert` [public INSERT]; `fixed_assets_writer_update` [public UPDATE] |
| `fx_revaluations` | `fx_revaluations_business_read` [public SELECT] |
| `inventory_balances` | `inventory_balances_admin_delete` [public DELETE]; `inventory_balances_member_read` [public SELECT]; `inventory_balances_platform_admin_read` [public SELECT]; `inventory_balances_writer_insert` [public INSERT]; `inventory_balances_writer_update` [public UPDATE] |
| `inventory_locations` | `inventory_locations_admin_delete` [public DELETE]; `inventory_locations_member_read` [public SELECT]; `inventory_locations_platform_admin_read` [public SELECT]; `inventory_locations_writer_insert` [public INSERT]; `inventory_locations_writer_update` [public UPDATE] |
| `invoice_approval_policies` | `invoice_approval_policies_member_read` [authenticated SELECT] |
| `invoice_approvals` | `invoice_approvals_member_read` [authenticated SELECT] |
| `invoice_delivery_events` | `invoice_delivery_events_member_read` [public SELECT]; `invoice_delivery_events_writer_insert` [public INSERT] |
| `invoice_lines` | `invoice_lines_admin_delete` [public DELETE]; `invoice_lines_member_read` [public SELECT]; `invoice_lines_platform_admin_read` [public SELECT]; `invoice_lines_writer_insert` [public INSERT]; `invoice_lines_writer_update` [public UPDATE] |
| `invoice_payments` | `invoice_payments_admin_delete` [public DELETE]; `invoice_payments_member_read` [public SELECT]; `invoice_payments_platform_admin_read` [public SELECT]; `invoice_payments_writer_insert` [public INSERT]; `invoice_payments_writer_update` [public UPDATE] |
| `invoices` | `invoices_admin_delete` [public DELETE]; `invoices_member_read` [public SELECT]; `invoices_platform_admin_read` [public SELECT]; `invoices_writer_insert` [public INSERT]; `invoices_writer_update` [public UPDATE] |
| `journal_entries` | `journal_entries_admin_delete` [public DELETE]; `journal_entries_member_read` [public SELECT]; `journal_entries_platform_admin_read` [public SELECT]; `journal_entries_writer_insert` [public INSERT]; `journal_entries_writer_update` [public UPDATE] |
| `journal_lines` | `journal_lines_admin_delete` [public DELETE]; `journal_lines_member_read` [public SELECT]; `journal_lines_platform_admin_read` [public SELECT]; `journal_lines_writer_insert` [public INSERT]; `journal_lines_writer_update` [public UPDATE] |
| `loan_repayments` | `loan_repayments_business_access` [public ALL] |
| `loans` | `loans_business_access` [public ALL] |
| `manufacturing_bom_lines` | `manufacturing_bom_lines_member_read` [authenticated SELECT]; `manufacturing_bom_lines_member_write` [authenticated ALL] |
| `manufacturing_boms` | `manufacturing_boms_member_read` [authenticated SELECT]; `manufacturing_boms_member_write` [authenticated ALL] |
| `manufacturing_capabilities` | `manufacturing_capabilities_read` [authenticated SELECT] |
| `manufacturing_capability_grants` | `manufacturing_capability_grants_member_read` [authenticated SELECT] |
| `manufacturing_material_transactions` | `manufacturing_material_transactions_member_read` [authenticated SELECT]; `manufacturing_material_transactions_member_write` [authenticated ALL] |
| `manufacturing_production_runs` | `manufacturing_production_runs_member_read` [authenticated SELECT]; `manufacturing_production_runs_member_write` [authenticated ALL] |
| `manufacturing_work_order_lines` | `manufacturing_work_order_lines_member_read` [authenticated SELECT]; `manufacturing_work_order_lines_member_write` [authenticated ALL] |
| `manufacturing_work_orders` | `manufacturing_work_orders_member_read` [authenticated SELECT]; `manufacturing_work_orders_member_write` [authenticated ALL] |
| `offline_queue_reconciliations` | `offline_queue_reconciliations_member_read` [public SELECT] |
| `partner_admins` | `partner_admins_read` [public SELECT]; `partner_admins_write` [public ALL] |
| `partner_clients` | `partner_clients_read` [public SELECT]; `partner_clients_write` [public ALL] |
| `partner_feature_flags` | `partner_feature_flags_read` [public SELECT]; `partner_feature_flags_write` [public ALL] |
| `partner_invoices` | `partner_invoices_read` [public SELECT]; `partner_invoices_write` [public ALL] |
| `partners` | `partners_admin_write` [public ALL]; `partners_partner_admin_update` [public UPDATE]; `partners_public_read` [public SELECT] |
| `paye_bands` | `paye_bands_admin_delete` [public DELETE]; `paye_bands_member_read` [public SELECT]; `paye_bands_platform_admin_read` [public SELECT]; `paye_bands_writer_insert` [public INSERT]; `paye_bands_writer_update` [public UPDATE] |
| `payroll_employee_lines` | `payroll_employee_lines_payroll_delete` [public DELETE]; `payroll_employee_lines_payroll_insert` [public INSERT]; `payroll_employee_lines_payroll_read` [public SELECT]; `payroll_employee_lines_payroll_update` [public UPDATE] |
| `payroll_runs` | `payroll_runs_payroll_delete` [public DELETE]; `payroll_runs_payroll_insert` [public INSERT]; `payroll_runs_payroll_read` [public SELECT]; `payroll_runs_payroll_update` [public UPDATE] |
| `pos_cash_movements` | `pos_cash_movements_delete` [public DELETE]; `pos_cash_movements_select` [public SELECT] |
| `pos_price_overrides` | `pos_price_overrides_member_read` [public SELECT] |
| `pos_settings` | `pos_settings_delete` [public DELETE]; `pos_settings_insert` [public INSERT]; `pos_settings_select` [public SELECT]; `pos_settings_update` [public UPDATE] |
| `pos_shift_closes` | `pos_shift_closes_select` [public SELECT] |
| `pos_shift_late_adjustments` | `pos_shift_late_adjust_select` [public SELECT] |
| `pos_shifts` | `pos_shifts_delete` [public DELETE]; `pos_shifts_select` [public SELECT] |
| `pos_terminals` | `pos_terminals_select` [public SELECT]; `pos_terminals_update` [public UPDATE]; `pos_terminals_write` [public INSERT] |
| `product_categories` | `product_categories_admin_delete` [public DELETE]; `product_categories_member_read` [public SELECT]; `product_categories_platform_admin_read` [public SELECT]; `product_categories_writer_insert` [public INSERT]; `product_categories_writer_update` [public UPDATE] |
| `products` | `products_admin_delete` [public DELETE]; `products_member_read` [public SELECT]; `products_platform_admin_read` [public SELECT]; `products_writer_insert` [public INSERT]; `products_writer_update` [public UPDATE] |
| `project_boq_lines` | `project_boq_lines_member_grants` [authenticated ALL] |
| `project_retention_ledger` | `project_retention_ledger_member_grants` [authenticated ALL] |
| `project_status_log` | `project_log_member_grants` [authenticated ALL] |
| `project_valuation_lines` | `project_valuation_lines_member_grants` [authenticated ALL] |
| `project_valuations` | `project_valuations_member_grants` [authenticated ALL] |
| `recurring_invoices` | `recurring_invoices_admin_delete` [public DELETE]; `recurring_invoices_member_read` [public SELECT]; `recurring_invoices_writer_insert` [public INSERT]; `recurring_invoices_writer_update` [public UPDATE] |
| `share_transactions` | `share_transactions_business_access` [public ALL] |
| `stock_movements` | `stock_movements_admin_delete` [public DELETE]; `stock_movements_member_read` [public SELECT]; `stock_movements_platform_admin_read` [public SELECT]; `stock_movements_writer_insert` [public INSERT]; `stock_movements_writer_update` [public UPDATE] |
| `stock_transfer_lines` | `stock_transfer_lines_admin_delete` [public DELETE]; `stock_transfer_lines_member_read` [public SELECT]; `stock_transfer_lines_platform_admin_read` [public SELECT]; `stock_transfer_lines_writer_insert` [public INSERT]; `stock_transfer_lines_writer_update` [public UPDATE] |
| `stock_transfers` | `stock_transfers_admin_delete` [public DELETE]; `stock_transfers_member_read` [public SELECT]; `stock_transfers_platform_admin_read` [public SELECT]; `stock_transfers_writer_insert` [public INSERT]; `stock_transfers_writer_update` [public UPDATE] |
| `subscription_payments` | `subscription_payments_platform_admin_read` [public SELECT]; `subscription_payments_read` [public SELECT] |
| `tax_alerts` | `tax_alerts_business_access` [public ALL] |
| `tax_configurations` | `tax_configurations_admin_delete` [public DELETE]; `tax_configurations_member_read` [public SELECT]; `tax_configurations_platform_admin_read` [public SELECT]; `tax_configurations_writer_insert` [public INSERT]; `tax_configurations_writer_update` [public UPDATE] |
| `tax_payments` | `tax_payments_business_access` [public ALL] |
| `tax_returns` | `tax_returns_business_access` [public ALL] |
| `user_profiles` | `profiles_own` [public ALL]; `user_profiles_own_read` [public SELECT]; `user_profiles_own_update` [public UPDATE]; `user_profiles_platform_admin_read` [public SELECT] |
| `webhook_deliveries` | `webhook_deliveries_business_read` [public SELECT] |
| `webhooks` | `Users can manage their business webhooks` [public ALL]; `webhooks_business_insert` [public INSERT]; `webhooks_business_read` [public SELECT]; `webhooks_business_update` [public UPDATE] |

---

## 4. Feature Quality Assessment

| Feature | Clean RPC? | Branch-scoped? | i18n? | Export? | Error/empty states? | Responsive? | Type-safe? | Tests? |
|---|---|---|---|---|---|---|---|---|
| Dashboard | ⚠️ mixed read queries | ⚠️ varies by widget | ✅ | ❌ | ✅ | ✅ | ⚠️ | ⚠️ no page-focused test found |
| Income / receipts | ⚠️ service + direct writes | ⚠️ branch field exists; audit query paths | ❌ | ⚠️ receipt/doc output | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Expenses | ⚠️ service + direct writes | ⚠️ | ❌ | ⚠️ receipt data, no general report export | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Invoices | ⚠️ mixed DB/RPC | ⚠️ | ❌ | ✅ document/PDF | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| POS | ✅ server commands cover sale/void/refund/approval | ✅ branch/shift context is used | ❌ | ✅ receipt/Z report | ✅ | ✅ | ✅ | ✅ POS workflow/approval tests |
| Products | ⚠️ direct CRUD + service operations | ⚠️ | ❌ | ⚠️ import/export utilities exist | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| `/inventory` | ❌ | ❌ | ❌ | ❌ | ❌ placeholder only | ⚠️ | ✅ trivial | ❌ |
| Warehouse | ⚠️ | ⚠️ | ❌ | ⚠️ | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Stock transfers | ⚠️ direct/service workflow | ✅ branch/location fields | ❌ | ❌ | ⚠️ | ✅ | ⚠️ | ⚠️ shared preparation tests only |
| Chart of accounts | ⚠️ direct table CRUD | ⚠️ branch-aware schema/access | ❌ | ⚠️ template/import paths | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Journals / periods | ⚠️ mixed direct/repository/RPC | ⚠️ | ❌ | ⚠️ | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Tax configuration | ❌ direct CRUD | ⚠️ business-scoped; some branch relevance | ❌ | ❌ | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Fixed assets / capital | ⚠️ direct + repository operations | ⚠️ | ❌ | ✅ at least some CSV/PDF | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Combined financial reports | ❌ mostly views/direct table reads | ❌ several reports lack branch filter | ❌ tabs/filter hardcoded | ✅ PDF/XBRL in several statements | ⚠️ mixed; error boundary on some tabs | ✅ tables scroll | ⚠️ mostly TS, direct casts remain | ❌ no report-page/component test suite found in this checkout |
| Bank reconciliation | ❌ direct client-side statement/journal writes remain | ⚠️ business-scoped, explicit branch workflow incomplete | ❌ | ⚠️ statement import/export | ⚠️ | ✅ | ⚠️ | ❌ focused tests not found |
| Contacts / branches / departments | ❌ direct CRUD | ⚠️ fields/queries vary | ❌ | ❌ | ⚠️ | ✅ | ⚠️ | ❌ page-focused tests not found |
| CSV import | ❌ direct bulk writes | ⚠️ business scope; destination-specific branches vary | ❌ | ✅ CSV input/template | ✅ import feedback | ✅ | ⚠️ | ⚠️ service/parser coverage, no full page flow test found |
| AI/support | ⚠️ edge function/repository mix | ⚠️ context can accept branch but not every surface | ⚠️ support localized; AI page mostly hardcoded | ❌ | ✅ fallback/error paths | ✅ | ⚠️ | ✅ AI/provider/support unit coverage |
| Audit log | ⚠️ direct reads + verification RPC | ⚠️ business/resource scope | ❌ | ✅ CSV/PDF | ✅ | ✅ | ⚠️ | ❌ page-focused tests not found |
| Construction (current routed page) | ❌ no server workflow | ❌ local draft has no branch authorization | ❌ | ❌ | ⚠️ validation only | ✅ | ✅ local draft contracts | ✅ draft validation/page tests |
| Manufacturing (current frontend checkout) | N/A — no routed UI | N/A | N/A | N/A | N/A | N/A | N/A | ❌ no manufacturing UI/tests |

**Assessment notes:** Most mature transactional write paths are POS and selected invoice/expense services; many screens still query/write Supabase tables directly. The repository has useful reusable typed repositories and shared export helpers, but their adoption is uneven. `useTranslation` is absent from most operational screens (the report tabs are entirely hardcoded), despite English locale resources being present. `WarehousePage.tsx` sets `STOCK_SYNC_SUSPENDED = true`, so its presence should not be read as end-to-end stock availability.

---

## 5. Duplicate Detection

The requested “Reports submenu vs standalone Phase 4 route” premise does **not** match this checkout. The only report route is `/reports`; it contains tabs in `ReportsPage.tsx`. There are no `/reports/trial-balance`, `/reports/profit-loss`, `/reports/balance-sheet`, `/reports/cash-flow`, `/reports/vat-return`, or `/reports/wht-schedule` route definitions and no such navigation items. Do not move links to nonexistent routes as part of a nav reorganization.

| Concept | Versions actually present | Feature/accuracy/architecture comparison | Recommendation |
|---|---|---|---|
| Trial Balance | One tab in `/reports` → `TrialBalanceReport` | Reads `v_trial_balance` directly; query key is only business ID, does not use the report date range and has no branch filter. It says “all posted journal entries.” It has a PDF export and empty state but no isolated route. No newer alternate implementation exists in this checkout. | **Keep the single surface, rebuild the report query contract**: date/branch controls and one typed repository/RPC result should be wired before considering another route. |
| P&L | One `/reports` tab → `StatementOfProfitOrLoss` | Uses the date range and comparative option, typed `FinancialStatementRepository` transforms, localized portions, PDF/XBRL. Direct route `/reports/profit-loss` is absent. | **Keep** the current statement component; improve localization/branch scoping and add component tests before splitting routes. |
| Balance Sheet / SOFP | One `/reports` tab → `StatementOfFinancialPosition` | Uses as-of date, typed repository, comparative support, balance/integrity warnings, PDF/XBRL. No separate `/reports/balance-sheet` route. | **Keep** the single implementation; add branch support and tests, do not duplicate it. |
| Cash Flow | One `/reports` tab → `CashFlowStatement` | Reads `v_cash_flow`, date range supplied, localized UI and PDF/XBRL; no separate `/reports/cash-flow` route. Branch filtering is not exposed by the parent page. | **Keep** the single implementation; make branch scope explicit and test reconciliation. |
| Changes in Equity | One `/reports` tab → `StatementOfChangesInEquity` | Typed statement-style report, date range and export support; not a separate route. | **Keep**; no duplicate found. |
| Revenue Breakdown | One `/reports` tab → `RevenueBreakdownReport` | Direct invoice/line/product reads and date filters; no separate route. Scope/export/localization are weaker than statement components. | **Keep one tab, improve data layer**; do not add another link to an absent route. |
| Branch Performance | One `/reports` tab → `BranchPerformanceReport` | Uses branch and journal data; branch-aware logic exists, but no separate route. | **Keep**; add query tests and align exports/i18n. |
| Multi-Currency | One `/reports` tab → `MultiCurrencyReport` | Direct journal-line query, no date filter in parent UI for this tab, no branch filter; PDF output. Not a duplicate route. | **Rebuild report query/filtering**, retain the single tab until scope/accuracy are corrected. |
| Bank Reconciliation | One Accounting nav item `/bank-reconcile` → `BankReconciliation` component | No `/bank-reconciliation/accounts`, `/bank-reconciliation/statements`, or `/bank-reconciliation` routes in App. The single component owns account/statement/reconcile UI and uses direct DB writes in places. | **Keep one nav entry for now;** split into route-level surfaces only after access and transactional boundaries are designed. |
| Tax | `/tax` only → tax configuration/PAYE management | No VAT Return or WHT Schedule report pages/routes in this checkout. `tax_returns`/`tax_payments` tables are not equivalent to a generated filing schedule. | **Keep `/tax` as configuration;** treat VAT/WHT reports as new features, not duplicates to merge. |
| CSV import URLs | `/import`, `/data-import`, and `/onboarding/import` all render `DataImportPage` | Three direct aliases to the same UI; no differences in workflow or data source. | **Keep one canonical URL and redirect the aliases** when link compatibility is confirmed | The aliases are route-level duplication, not distinct import products. |
| Construction draft URLs | `/construction` and `/projects-funding-sources/construction-draft` both render `ConstructionProjectSetupDraftPage` | Same local-only draft, no server-backed projects or authorization difference; route is outside `RoleRoute`. | **Replace** with one approved future project route; keep legacy aliases only as redirects if draft persistence/deep links require them | Two paths overstate the number and maturity of construction workflows. |
| AI chat URL | `/chat` redirects to `/ai` | No second chat implementation; the target route has Pro/partner gates. | **Keep redirect** only for backwards compatibility; use `/ai` canonically | This is a true compatibility alias, not a separate feature. |
| Password reset source files | `src/pages/ResetPasswordPage.tsx` and `src/pages/auth/ResetPasswordPage.tsx`; only the `auth/` version is imported by `App.tsx` | Two implementations of the same recovery flow; the active one uses i18n, while the unreferenced root-page implementation uses hardcoded text and extra explanatory comments. | **Retire the unreferenced file** after import/test search | Avoid future fixes landing in the inactive implementation. |
| Inventory navigation mapping | `ToolsPage` exposes `/inventory`; `navItemForPath('/inventory')` canonicalizes to Products, but the router renders `InventoryPage` placeholder | The secondary navigation helper and route disagree; the sidebar itself points to `/products`. | **Replace with a redirect to `/products` or remove the Tools entry** | Otherwise one “Inventory” link resolves to a coming-soon screen while other navigation surfaces treat it as Products. |

The supplied standalone Phase 4 destinations and `/bank-reconciliation/*` destinations are not merely duplicate implementations—they are absent from this router. The current tabbed report page does have multiple report types under one pathname, so URL-driven tabs/deep links would be a separate product decision.

---

## 6. Gap Analysis

### All verticals

| Capability | Current state in this checkout | Evidence / gap |
|---|---|---|
| Multi-currency transactions and reporting | **Partial** | Income/expense/invoice and journal records carry currency, original amount, exchange rate, and base/functional amounts. A Multi-currency report exists, but lacks period/branch filtering. Live `exchange_rates` exact count is 0, so reliable rate coverage is not demonstrated. |
| File attachments on transactions | **Partial, not general** | Live `expenses` has receipt URL/filename/size/MIME fields; this is a receipt link, not a consistent storage-backed attachment model across invoices, journals, contacts, POS, and project transactions. No general transaction attachment UI/service was found. |
| CSV bulk import (contacts, products, CoA) | **Present** | `/import`, `/data-import`, `/onboarding/import` use `DataImportPage`; supported entities include contacts, products, chart of accounts, opening balances, and trial balance. Bulk write flow appears service/direct-table based rather than a single atomic import RPC. |
| Advanced role-based permissions | **Partial** | `RoleRoute`, path policy, plan/partner/capability gates, database RLS and invite roles exist. This is fixed-role/path gating, not a tenant-configurable permissions matrix; page-level hardcoded strings and differing direct-write paths complicate consistent enforcement. |
| Recurring transactions | **Schema only / no UI** | `recurring_invoices` exists, but exact live count is 0 and no route/component for recurring invoice setup/run was found. |
| Budget vs Actual | **Schema only / no UI/report** | `budgets` and `budget_lines` exist; exact live count is 0 for budgets. No budget-vs-actual route/report found. |

### Construction

| Need | Current state | Evidence / gap |
|---|---|---|
| Multi-level BOM | Not applicable to current construction UI | No operational construction workspace in this checkout; construction is not a BOM feature here. |
| Subcontractor management | Missing in current UI | No subcontractor workflow/route found. Supplier references in live schema are procurement evidence, not a subcontractor management module. |
| Retention tracking | Backend/schema present in live DB; no current frontend workflow | `project_retention_ledger` and retention RPCs exist in live DB, but the checkout routes `/construction` to a local draft page and has no project retention UI. Live exact project count is 5; retention-ledger rows are estimated 0~. |
| Project cash-flow forecasting | Missing | No forecast or project cashflow UI/report found. Existing project portfolio/P&L RPC metadata in the live DB is not surfaced by this checkout. |
| Health & safety compliance | Missing | No safety register, incident, permit, or compliance workflow/table/route found. |

### Manufacturing

| Need | Current state | Evidence / gap |
|---|---|---|
| Multi-level BOM | Single-level schema shape in live DB; not surfaced in current source | Live `manufacturing_bom_lines` has `bom_id`, `component_product_id`, quantity and scrap percent, but no child-BOM/component-BOM reference. Live DB has 8 BOM headers. This checkout has no manufacturing pages/routes. |
| MRP / production planning | Missing from current UI | No MRP or material-demand planning route. Live DB work-order tables/RPCs exist; 7 work orders are present, but not integrated by this frontend snapshot. |
| Quality control / inspection | Backend objects only in live DB | A construction receipt inspection table exists; no manufacturing inspection UI/route or quality release workflow found in this checkout. |
| Work-centre scheduling | Missing | No work-centre entity or schedule UI found in source or inspected live schema fields. |
| Scrap and rework tracking | Partial backend data only | Live manufacturing work orders have `scrapped_quantity`, BOM lines `scrap_pct`, but no frontend workflow, rework disposition or operational reporting in this source branch. |

### Retail

| Need | Current state | Evidence / gap |
|---|---|---|
| POS returns, discounts, split payments | **Present** | POS supports discounts, split tenders, returns/refunds, manager approval, shifts and receipts. Server command paths and POS-focused tests are present. Live operational POS table estimates are sparse/unknown. |
| Loyalty program | Missing | No loyalty points, rewards, customer tier or redemption workflow found. |
| Multi-store inventory transfers | **Partial/present** | Stock transfer route and branch/location fields exist; exact live counts: 53 transfer headers, 85 lines. Confirm location/branch authorization for all write paths. |
| E-commerce integration hooks | Missing | Zapier/webhooks exist generally; no commerce order/catalog sync or e-commerce adapter contract found. |

---

## 7. Replace vs Rebuild vs Keep Decisions

| Feature | Current quality | Overlap with | Recommendation | Rationale |
|---|---|---|---|---|
| Combined `/reports` page | Mixed; statement tabs are materially stronger than the Trial Balance and Multi-currency tabs | No separate report routes in this checkout | **Keep** the single surface, **rebuild** weak report data contracts | Avoid duplicate report navigation. Keep typed statement repository/components; fix TB period/branch scoping and Multi-currency filters before route splitting. |
| Trial Balance tab | Weak for period reporting | The `v_trial_balance` view is only implementation | **Rebuild** | Query does not consume selected period or branch and bypasses the typed report repository contract. This undermines period comparison and branch reporting. |
| `/inventory` page | Placeholder (“Coming soon”) | Products, Warehouse, Transfers are working routes | **Retire** or redirect to `/products` after link/deep-link review | Keeping a prominent route that renders no functionality is confusing; do not rebuild a second inventory surface when operational screens already exist. |
| `/construction` alias | Local-only draft; no server-side project path | `ConstructionProjectSetupDraftPage` is also aliased under `/projects-funding-sources/construction-draft` | **Replace** only after the operational construction workspace is ready; until then classify as draft, not launched feature | Route is auth-only and explicitly bypasses role/plan/vertical gates. Do not present it as a live construction module. Preserve existing draft data during any retirement decision. |
| `WarehousePage` | UI exists, but `STOCK_SYNC_SUSPENDED = true` | Products and inventory balances | **Rebuild/fix before marketing as operational** | User-visible warehouse workflows are undermined by explicit stock-sync suspension. Resolve stock truth/command semantics and add end-to-end tests. |
| Bank reconciliation | One route; mixed direct queries/writes | No duplicate bank subroutes | **Keep** the single route; **rebuild** the write boundary incrementally | Existing match/reconcile backend functions are available in live DB, but current component still writes journal data directly. Move money/ledger mutations behind validated RPCs and test branch constraints. |
| Tax configuration | Functional configuration UI, hardcoded copy | No VAT/WHT report routes in this checkout | **Keep** configuration; build reports as new features | Configuration and filing/schedule reporting are different capabilities, not duplicates. |
| Multi-currency report | Partial and unfiltered by reporting period/branch | Currency-aware forms/journal lines | **Rebuild** report query/filters | Current report is not a complete scoped report. Reuse transaction snapshots and add branch/date filtering before presenting totals. |
| CSV import flow | Useful, but mixed direct writes and page-only validation | No competing import page | **Keep**, then strengthen | Supports required entities, but needs import preview, per-row validation, durable failure report and transactional/rollback semantics. |
| Recurring invoices | No user-facing feature | `recurring_invoices` table only | **Rebuild** if product requirement remains; otherwise **retire unused schema only in a separately approved migration** | Table exists with 0 rows but no setup/scheduler UI surfaced. Audit makes no schema recommendation to execute now. |
| Construction/manufacturing backend surfaces | Live DB tables/RPCs exist; current frontend source has no routes | Draft construction route; no manufacturing navigation | **Rebuild/integrate** | Avoid claiming DB-backed workflows as launched product functionality. Match frontend scope and route gates to existing server-side commands. |

---

## 8. Prioritized Roadmap Recommendation

Estimates are engineering days for a small team, excluding customer rollout/support; ranges are intentionally approximate. This is a recommendation only, not an implementation plan.

| Phase | Suggested scope | Effort | User impact | Why / exit criteria |
|---|---|---:|---|---|
| **Phase 5A — Quick wins** | Audit-informed nav regrouping; keep exact URLs; remove/redirect the dead `/inventory` placeholder only after a link scan; correct report duplicate assumptions; add date/branch scoping to Trial Balance and Multi-currency tabs; translate Reports and key report empty/error states; restore or clearly disable Warehouse workflows; add route/nav smoke tests. | **6–10 days** | **High** | Fixes navigation trust and report correctness without schema work. Exit when every visible nav item lands on functional or clearly gated UI, reports reflect selected period/branch, and stale routes are explicitly handled. |
| **Phase 5B — Vertical deepening** | Integrate live construction project/retention/procurement capabilities into protected routes; complete subcontractor/forecast/H&S product decisions; manufacturing workspace with multi-level BOM design, MRP, inspection, work-centre scheduling and scrap/rework; reconcile frontend permissions with database command gates. | **25–40 days** | **High** | Vertical schemas/RPCs are ahead of this source tree. Scope should begin with UX/service contracts and vertical access tests, then build workflows against proven command APIs. Multi-level BOM and scheduling require domain decisions, so estimate is larger. |
| **Phase 6 — Platform infrastructure** | Common attachment/storage contract for invoices/expenses/journals; multi-currency rate lifecycle and complete date/branch reports; import preview/validation/rollback; recurring transaction lifecycle; budget-vs-actual reporting; audit-event coverage and evidence retention. | **20–35 days** | **High** | Closes cross-vertical capabilities. Existing currency, budget, recurring, receipt and audit schema provides a starting point, but live row counts and current UI integration are uneven. Prioritize transaction integrity and attachment authorization before expanding exports. |

**Recommended sequencing:** review and approve this audit first. Then turn Phase 5A into a separate navigation/report-quality PR based on the actual route inventory above. Do not use the supplied assumed `/reports/*` destinations or bank subroutes until they exist and are explicitly approved; this checkout currently has one `/reports` surface and one `/bank-reconcile` surface.
