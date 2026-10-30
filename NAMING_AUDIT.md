# Naming Audit — App References vs Live Supabase

**Source:** `origin/main` at `0e2d5a080db56888c08f4ab036a5e44e41c42d1e` (inspected without switching the active branch). **Live read-only target:** project `hsuhuvuxfuufrlejsatw`, queried 2026-10-30. Public inventory observed: 148 base tables and 23 views. User-provided post-cleanup RLS list contains 37 construction/project/BOQ/MRP/payment/subcontract tables; all shown had RLS enabled.

## Result

- Parsed 109 public relation names from literal `.from(...)` calls plus construction repository table names passed through its typed generic reader. All 109 SQL relation references exist on the inspected live schema. The one non-relation `.from()` match, `business-logos`, is a Supabase Storage bucket name, not a PostgreSQL table.
- Missing public table/view references: **0**. No app query uses `project_purchase_orders`, `project_goods_receipts`, `project_material_issues`, or `project_material_returns` (or their lines).
- At the audited `origin/main` baseline, generated table/view types had 135 table entries and 23 view entries. Every generated table type had a live relation; all generated view names were live. Three app-used relations lacked generated types.
- RPC audit: 136 current app-called function names were compared against the live catalog; none is missing. Authenticated execute is present for app RPCs except `backfill_and_recalculate_inventory`, which is intentionally service_role-only. See `LIVE_RPCS.sql`.

## Generated type gap resolution (2026-10-30)

The active branch's generated file was older than the audited `origin/main` baseline. With approval, `src/dal/types/database.generated.ts` was aligned to that audited generated-file baseline, then completed from the verified live catalog: all 13 live base tables absent at the baseline are now typed, and the app RPC type gaps are closed. A parser false positive had counted two existing overloaded RPCs (`ai_context` and `get_dashboard_metrics`) as missing; those were already represented as overload unions. Ten missing RPC entries were added. The resulting file has 148 public table entries and retains the 23 audited view entries. No migration or live database schema was changed.

## Complete app relation reconciliation matrix

`Typed` means a `public.Tables` or `public.Views` entry in the generated file at `origin/main`; “generic reader” denotes the construction repository’s `client.from(table).select('*')` helper with a literal typed table name at its callsite.

| App relation / bucket | Live status | Generated type | Source reference |
|---|---|---|---|
| `accounting_periods` | ✅ live | ✅ | `src/dal/repositories/JournalRepository.ts, src/dal/repositories/PeriodRepository.ts` |
| `accounts` | ✅ live | ✅ | `src/components/reports/RevenueBreakdownReport.tsx, src/dal/repositories/AccountRepository.ts` |
| `api_keys` | ✅ live | ✅ | `src/services/api/ApiKeyService.ts` |
| `approval_requests` | ✅ live | ✅ | `src/dal/repositories/ApprovalRepository.ts` |
| `approval_workflow_steps` | ✅ live | ✅ | `src/dal/repositories/ApprovalRepository.ts` |
| `approval_workflows` | ✅ live | ✅ | `src/dal/repositories/ApprovalRepository.ts` |
| `asset_categories` | ✅ live | ✅ | `src/dal/repositories/AssetRepository.ts, src/dal/repositories/FinancialStatementRepository.ts` |
| `audit_log` | ✅ live | ✅ | `src/dal/repositories/AuditLogRepository.ts` |
| `bank_accounts` | ✅ live | ❌ | `src/dal/repositories/BankReconciliationRepository.ts` |
| `bank_reconciliation_matches` | ✅ live | ❌ | `src/dal/repositories/BankReconciliationRepository.ts` |
| `bank_statement_import_metadata` | ✅ live | ❌ | `src/dal/repositories/BankReconciliationRepository.ts` |
| `bank_statement_lines` | ✅ live | ✅ | `src/dal/repositories/BankReconciliationRepository.ts` |
| `bank_statements` | ✅ live | ✅ | `src/dal/repositories/BankReconciliationRepository.ts, src/dal/repositories/FinancialStatementRepository.ts` |
| `boq_items` | ✅ live | ✅ | `src/dal/repositories/ProjectRepository.ts` |
| `boq_sections` | ✅ live | ✅ | `src/dal/repositories/ProjectRepository.ts` |
| `boq_versions` | ✅ live | ✅ | `src/dal/repositories/ProjectRepository.ts` |
| `branches` | ✅ live | ✅ | `src/components/ai/Assistant.tsx, src/dal/repositories/BranchRepository.ts` |
| `business-logos` | Storage bucket (not SQL relation) | n/a | `src/pages/SettingsPage.tsx` |
| `business_invitations` | ✅ live | ✅ | `src/pages/SettingsPage.tsx, src/pages/settings/TeamManagementPage.tsx` |
| `business_users` | ✅ live | ✅ | `src/dal/repositories/BusinessRepository.ts, src/pages/AcceptInvitationPage.tsx` |
| `businesses` | ✅ live | ✅ | `src/dal/repositories/BusinessRepository.ts, src/dal/repositories/FinancialStatementRepository.ts` |
| `cash_forecast_scenarios` | ✅ live | ✅ | `src/pages/reports/CashForecastPage.tsx` |
| `construction_delivery_note_lines` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_delivery_notes` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_goods_receipt_holds` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_goods_receipt_lines` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_goods_receipt_notes` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_material_issues` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_material_returns` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_procurement_sites` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader), src/dal/repositories/LocationRepository.ts` |
| `construction_product_uom_conversions` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_projects` | ✅ live | ✅ | `src/components/settings/LocationsTab.tsx, src/dal/repositories/ProjectRepository.ts` |
| `construction_purchase_order_events` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_purchase_order_lines` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_purchase_orders` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_receipt_bill_allocations` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_receipt_cost_bases` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_receipt_inspections` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_receipt_line_reclassifications` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_receipt_posting_policies` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `construction_supplier_invoice_references` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `contacts` | ✅ live | ✅ | `src/dal/repositories/ContactRepository.ts, src/pages/InvoicesPage.tsx` |
| `currencies` | ✅ live | ✅ | `src/components/CurrencySelector.tsx, src/services/exchangeRateService.ts` |
| `departments` | ✅ live | ✅ | `src/components/dashboard/NewJournalEntryModal.tsx, src/dal/repositories/DepartmentRepository.ts` |
| `depreciation_schedules` | ✅ live | ✅ | `src/dal/repositories/AssetRepository.ts` |
| `employees` | ✅ live | ✅ | `src/dal/repositories/PayrollRepository.ts, src/pages/PayrollPage.tsx` |
| `exchange_rates` | ✅ live | ✅ | `src/dal/repositories/ExchangeRateRepository.ts` |
| `expense_lines` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader), src/dal/repositories/ExpenseRepository.ts` |
| `expense_payments` | ✅ live | ✅ | `src/dal/repositories/ExpenseRepository.ts, src/dal/repositories/JournalRepository.ts` |
| `expenses` | ✅ live | ✅ | `src/dal/repositories/ExpenseRepository.ts` |
| `fixed_assets` | ✅ live | ✅ | `src/dal/repositories/AssetRepository.ts, src/dal/repositories/FinancialStatementRepository.ts` |
| `fx_revaluations` | ✅ live | ✅ | `src/services/FxRevaluationService.ts` |
| `inventory_balances` | ✅ live | ✅ | `src/dal/repositories/InventoryRepository.ts, src/dal/repositories/LocationRepository.ts` |
| `inventory_locations` | ✅ live | ✅ | `src/dal/repositories/BranchRepository.ts, src/dal/repositories/InventoryRepository.ts` |
| `invoice_approvals` | ✅ live | ✅ | `src/services/invoiceApprovalRpc.ts` |
| `invoice_lines` | ✅ live | ✅ | `src/components/reports/RevenueBreakdownReport.tsx, src/dal/repositories/InvoiceRepository.ts` |
| `invoice_payments` | ✅ live | ✅ | `src/dal/repositories/InvoiceRepository.ts, src/dal/repositories/JournalRepository.ts` |
| `invoices` | ✅ live | ✅ | `src/components/reports/RevenueBreakdownReport.tsx, src/dal/repositories/IncomeRepository.ts` |
| `journal_entries` | ✅ live | ✅ | `src/dal/repositories/FinancialStatementRepository.ts, src/dal/repositories/JournalRepository.ts` |
| `journal_lines` | ✅ live | ✅ | `src/components/reports/BranchPerformanceReport.tsx, src/dal/repositories/FinancialStatementRepository.ts` |
| `loan_repayments` | ✅ live | ✅ | `src/dal/repositories/LoanRepository.ts` |
| `loans` | ✅ live | ✅ | `src/dal/repositories/LoanRepository.ts` |
| `manufacturing_bom_lines` | ✅ live | ✅ | `src/dal/repositories/BomRepository.ts, src/pages/manufacturing/BomListPage.tsx` |
| `manufacturing_boms` | ✅ live | ✅ | `src/dal/repositories/BomRepository.ts, src/pages/manufacturing/BomDetailPage.tsx` |
| `manufacturing_material_transactions` | ✅ live | ✅ | `src/pages/manufacturing/WorkOrderDetailPage.tsx` |
| `manufacturing_mrp_recommendations` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts` |
| `manufacturing_mrp_runs` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts` |
| `manufacturing_production_run_lines` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts` |
| `manufacturing_production_runs` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts, src/pages/manufacturing/WorkOrderDetailPage.tsx` |
| `manufacturing_work_order_lines` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts, src/pages/manufacturing/WorkOrderDetailPage.tsx` |
| `manufacturing_work_orders` | ✅ live | ✅ | `src/dal/repositories/LocationRepository.ts, src/dal/repositories/ManufacturingRepository.ts` |
| `partner_admins` | ✅ live | ✅ | `src/dal/repositories/PartnerRepository.ts` |
| `partner_clients` | ✅ live | ✅ | `src/dal/repositories/BusinessRepository.ts, src/dal/repositories/PartnerClientRepository.ts` |
| `partner_feature_flags` | ✅ live | ✅ | `src/dal/repositories/PartnerRepository.ts` |
| `partner_invoices` | ✅ live | ✅ | `src/dal/repositories/PartnerBillingRepository.ts` |
| `partners` | ✅ live | ✅ | `src/dal/repositories/PartnerRepository.ts` |
| `paye_bands` | ✅ live | ✅ | `src/dal/repositories/PayrollRepository.ts, src/dal/repositories/TaxRepository.ts` |
| `payment_certificates` | ✅ live | ✅ | `src/dal/repositories/ConstructionCertificatesRepository.ts` |
| `payroll_employee_lines` | ✅ live | ✅ | `src/dal/repositories/PayrollRepository.ts` |
| `payroll_runs` | ✅ live | ✅ | `src/dal/repositories/PayrollRepository.ts` |
| `pos_cash_movements` | ✅ live | ✅ | `src/dal/repositories/PosRepository.ts` |
| `pos_settings` | ✅ live | ✅ | `src/dal/repositories/PosRepository.ts` |
| `pos_shifts` | ✅ live | ✅ | `src/dal/repositories/PosRepository.ts` |
| `pos_terminals` | ✅ live | ✅ | `src/dal/repositories/PosRepository.ts` |
| `products` | ✅ live | ✅ | `src/components/construction/projects/ProjectBoqVersionEditor.tsx, src/components/reports/RevenueBreakdownReport.tsx` |
| `project_boq_lines` | ✅ live | ✅ | `src/dal/repositories/ProjectRepository.ts` |
| `project_purchase_order_boq_links` | ✅ live | ✅ | `src/dal/repositories/ConstructionProcurementRepository.ts (generic typed reader)` |
| `project_valuations` | ✅ live | ✅ | `src/dal/repositories/ProjectRepository.ts` |
| `routing_steps` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts` |
| `routings` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts` |
| `share_transactions` | ✅ live | ✅ | `src/dal/repositories/ShareRepository.ts` |
| `stock_movements` | ✅ live | ✅ | `src/dal/repositories/InventoryRepository.ts, src/services/dataBackupService.ts` |
| `stock_transfer_lines` | ✅ live | ✅ | `src/dal/repositories/TransferRepository.ts` |
| `stock_transfers` | ✅ live | ✅ | `src/dal/repositories/TransferRepository.ts` |
| `subcontractor_profiles` | ✅ live | ✅ | `src/dal/repositories/SubcontractRepository.ts` |
| `subcontracts` | ✅ live | ✅ | `src/dal/repositories/SubcontractRepository.ts` |
| `subscription_payments` | ✅ live | ✅ | `src/services/billing/SubscriptionPaymentService.ts` |
| `tax_alerts` | ✅ live | ✅ | `src/dal/repositories/TaxReturnRepository.ts` |
| `tax_configurations` | ✅ live | ✅ | `src/dal/repositories/PayrollRepository.ts, src/dal/repositories/TaxRepository.ts` |
| `tax_payments` | ✅ live | ✅ | `src/dal/repositories/TaxPaymentRepository.ts, src/dal/repositories/TaxReturnRepository.ts` |
| `tax_returns` | ✅ live | ✅ | `src/dal/repositories/TaxPaymentRepository.ts, src/dal/repositories/TaxReturnRepository.ts` |
| `user_profiles` | ✅ live | ✅ | `src/components/DeleteAccountSection.tsx, src/components/i18n/LanguageSwitcher.tsx` |
| `v_ar_ageing` | ✅ live | ✅ | `src/dal/repositories/ContactRepository.ts` |
| `v_asset_register` | ✅ live | ✅ | `src/dal/repositories/AssetRepository.ts` |
| `v_partner_client_usage` | ✅ live | ✅ | `src/dal/repositories/PartnerRepository.ts` |
| `v_reorder_alerts` | ✅ live | ✅ | `src/dal/repositories/InventoryRepository.ts` |
| `v_trial_balance` | ✅ live | ✅ | `src/dal/repositories/IncomeRepository.ts` |
| `webhook_deliveries` | ✅ live | ✅ | `src/services/webhook/WebhookService.ts` |
| `webhooks` | ✅ live | ✅ | `src/services/webhook/WebhookService.ts` |
| `work_centres` | ✅ live | ✅ | `src/dal/repositories/ManufacturingRepository.ts` |

## Live tables that lack generated types

All 13 names below exist on live but are absent from `public.Tables` in the committed generated type file. Three are queried by app code and are the immediate type-drift items; the remainder are not direct app references in this scan and may be migration/back-end/legacy tables. No code/type file was changed in this task.

| Live base table without generated type | Queried directly/generically by app? |
|---|---|
| `bank_accounts` | Yes |
| `bank_reconciliation_matches` | Yes |
| `bank_statement_import_metadata` | Yes |
| `bom_components` | No direct/generic reference found |
| `bom_versions` | No direct/generic reference found |
| `boms` | No direct/generic reference found |
| `construction_sites` | No direct/generic reference found |
| `mrp_recommendations` | No direct/generic reference found |
| `mrp_runs` | No direct/generic reference found |
| `production_run_lines` | No direct/generic reference found |
| `production_runs` | No direct/generic reference found |
| `work_order_lines` | No direct/generic reference found |
| `work_orders` | No direct/generic reference found |

The app-used untyped table names are: `bank_accounts`, `bank_reconciliation_matches`, and `bank_statement_import_metadata`. Inspect their SQL column metadata and relationships before regenerating or hand-editing types. The other missing generated table names are `bom_components`, `bom_versions`, `boms`, `construction_sites`, `mrp_recommendations`, `mrp_runs`, `production_run_lines`, `production_runs`, `work_order_lines`, and `work_orders`.

## Live relations not found by the app relation scan

These names are live but have no literal `.from(...)` or typed construction generic-reader call in the scan. This is **not proof of orphaning**: RPCs, triggers, jobs, third-party clients, dynamic queries, or server-side code may use them. Do not drop them based on this list.

`accounting_period_events`, `ai_insights_usage`, `api_usage`, `approval_history`, `approval_request_steps`, `audit_20260927_sent_to_paid`, `bom_components`, `bom_versions`, `boms`, `budget_lines`, `budgets`, `business_members`, `business_terms_acceptances`, `construction_procurement_capabilities`, `construction_procurement_grants`, `construction_sites`, `employee_allowances`, `employee_deductions`, `invoice_approval_policies`, `invoice_delivery_events`, `manufacturing_capabilities`, `manufacturing_capability_grants`, `mrp_recommendations`, `mrp_runs`, `offline_queue_reconciliations`, `phone_accounts`, `pos_approvals`, `pos_corrections`, `pos_price_overrides`, `pos_shift_closes`, `pos_shift_late_adjustments`, `product_categories`, `production_run_lines`, `production_runs`, `profiles`, `project_retention_ledger`, `project_status_log`, `project_valuation_lines`, `projects`, `recurring_invoices`, `subscription_reminders_sent`, `subscriptions`, `support_agent_usage`, `usage_counters`, `v_ai_anomalies`, `v_ai_cash_accounts`, `v_ai_cash_movements`, `v_ai_customer_concentration`, `v_ai_expense_docs`, `v_ai_kpis`, `v_ai_monthly_trend`, `v_ai_overdue_invoices`, `v_ai_revenue_invoices`, `v_ai_top_customers`, `v_ai_top_expenses`, `v_ai_upcoming_payables`, `v_ai_upcoming_receivables`, `v_cash_flow`, `v_inventory_balance_ledger_drift`, `v_inventory_ledger_variance`, `work_order_lines`, `work_orders`

## Construction naming decisions

| App target | Live table | Type | Decision |
|---|---|---|---|
| `construction_procurement_sites` | ✅ | ✅ | Canonical site record. `construction_sites` is a separate live legacy table, not the app target. |
| `construction_purchase_orders` / `_lines` | ✅ | ✅ | Canonical purchase tables. |
| `construction_goods_receipt_notes` / `_lines` | ✅ | ✅ | Canonical GRN tables. |
| `construction_material_issues` | ✅ | ✅ | Canonical stock-linked issue register; no issue-lines table. |
| `construction_material_returns` | ✅ | ✅ | Canonical stock-linked return register; no return-lines table. |
| `project_purchase_order_boq_links` | ✅ | ✅ | Real migration-backed link table; keep distinct from manual project PO headers. |
| `project_purchase_orders`, `project_goods_receipts`, `project_material_issues`, `project_material_returns` and lines | ❌ (absent after cleanup) | ❌ | No current app query; do not recreate. |

`construction_sites` was read-only counted at zero rows on 2026-10-30. It has no runtime app `.from()` reference and no inbound FK was present in the live catalog at that time. It is omitted from generated types. It is a historical table explicitly left unchanged by a shipped migration; see `LIVE_CLEANUP.sql` for the requested guarded drop, which uses `RESTRICT` rather than `CASCADE`.

## RPC names that differ from labels in the request

- App uses `save_quick_expense` and `save_quick_sale`; not `quick_save`.
- App uses `reserve_next_document_number`; not `reserve_document_number`.
- There is no app RPC named `explode_bom`. Manufacturing uses `_mfg_execution_explode_order` as an internal helper in the work-order-from-BOM path.
- All current app-called RPC names exist in the live catalog. `backfill_and_recalculate_inventory` is intentionally denied to `authenticated` and granted to `service_role` only; do not change this ACL to satisfy a blanket grant requirement.

## Recommended action

1. Do not bulk-replay historical function definitions. The live migration history is current through `20261126000000`, and the app-RPC catalog check found no missing app names. A function body can be overwritten by `CREATE OR REPLACE`, and blanket authenticated grants would violate the deliberate private-helper and service-role boundaries.
2. Regenerate `database.generated.ts` from the confirmed target using the supported Supabase CLI workflow or inspect `REGENERATE_TYPES_QUERIES.sql`. Do not hand-edit types from a partial table-name scan.
3. If applying the orphan cleanup, review and run `LIVE_CLEANUP.sql` separately. Its runtime count/foreign-key checks skip the drop if the table is nonempty or has inbound FKs; it never uses `CASCADE`.

## Verification notes

- No `.ts`, `.tsx`, or migration files were modified.
- Live schema/catalog queries were read-only. No SQL file in this task was executed against Supabase.
- The project account also has a staging project; only `hsuhuvuxfuufrlejsatw` was inspected. Confirm the target before running any SQL.
