# Phase 5B-4 Audit — Construction Controls

**Audit snapshot:** `origin/main` at `0e2d5a080db56888c08f4ab036a5e44e41c42d1e` (main after PR #276; includes the #257–#275 feature stack). The active audit branch remains `arena/d14e4c8f-ledgr-react`; this report uses the main snapshot because that is the codebase described in the brief. **Read-only:** no source, migration, route, or navigation file was changed. This report is the sole deliverable.

## Executive summary

The audited main snapshot has mature project, procurement, BOQ, valuation, subcontract, retention and certificate building blocks, but no project-control feature set for RFIs, change orders, project-level quality inspections, HSE incident management, or task scheduling/CPM. The existing `construction_receipt_inspections` table is a goods-receipt/quality-hold workflow, not an ITP or work-inspection system. `construction_projects.start_date` / `end_date` are project bounds only; there are no WBS tasks, milestones, baselines, dependencies or critical-path fields.

**Recommended order:** 5B-4a RFIs (fastest, low coupling); 5B-4b Change Orders (formal approvals and approved-scope/contract delta ledger); 5B-4c Quality + HSE controls (separate data models, shared attachment/evidence infrastructure); 5B-4d Scheduling MVP (WBS and dependency records first; defer automated CPM/resource leveling). RFI and HSE can ship independently; change orders should precede schedule-to-change-order integration. Do not mutate existing project, valuation, certificate, retention, procurement or route contracts.

Every new feature must be **Enterprise AND `PROJECT_BASED`**. `businesses.operating_models` is generated as `string[]` and stored as `text[]`; use `.includes('PROJECT_BASED')` in TypeScript and `'PROJECT_BASED' = ANY(COALESCE(b.operating_models, ARRAY[]::text[]))` in SQL. Do not treat `CONSTRUCTION` as equivalent. UI gates are not an authorization boundary: new command RPCs must repeat membership, feature entitlement, project/business scope and capability checks server-side.

## 0. Schema and code discovery

### 0a. Construction-related tables and columns

The lists below are the complete construction/project/BOQ/subcontract/certificate set represented under `public.Tables` in `src/dal/types/database.generated.ts`, plus the shared `inventory_locations` table used as a construction site location. Column names and TypeScript row types are copied from that generated snapshot (`string` includes UUID/date/timestamp/text as generated; `number` represents numeric/integer fields). `contacts` is a shared identity table and is referenced by FKs; its schema is not duplicated here.

**Important naming correction:** there is no `public.construction_sites` table in the audited schema. There is `construction_procurement_sites` for procurement sites, and generic `inventory_locations` linked by `project_id`. `construction_procurement_sites` has `is_active`, not a status enum. The site-lifecycle migration explicitly says it does not create a separate `sites` table.

### Project, BOQ, valuation, and certificate tables

| Table | `Row` columns from generated types |
|---|---|
| `construction_projects` | `boq_locked_at`: `string | null`, `budget`: `number`, `business_id`: `string`, `client_id`: `string | null`, `client_name`: `string`, `contract_sum`: `number`, `created_at`: `string`, `created_by`: `string`, `end_date`: `string | null`, `id`: `string`, `name`: `string`, `retention_pct`: `number`, `start_date`: `string | null`, `status`: `string`, `updated_at`: `string` |
| `project_status_log` | `changed_at`: `string`, `changed_by`: `string`, `from_status`: `string`, `id`: `string`, `project_id`: `string`, `reason`: `string | null`, `to_status`: `string` |
| `project_boq_lines` | `created_at`: `string`, `description`: `string`, `id`: `string`, `line_number`: `string`, `project_id`: `string`, `quantity`: `number`, `rate`: `number`, `sort_order`: `number`, `total_value`: `number`, `unit`: `string`, `updated_at`: `string` |
| `boq_versions` | `business_id`: `string`, `created_at`: `string`, `created_by`: `string | null`, `currency`: `string`, `id`: `string`, `notes`: `string | null`, `project_id`: `string`, `status`: `string`, `total_value`: `number`, `version_label`: `string | null`, `version_number`: `number` |
| `boq_sections` | `boq_version_id`: `string`, `business_id`: `string`, `code`: `string`, `description`: `string | null`, `id`: `string`, `level`: `number`, `parent_section_id`: `string | null`, `sort_order`: `number`, `title`: `string` |
| `boq_items` | `amount`: `number`, `boq_version_id`: `string`, `business_id`: `string`, `cost_code`: `string | null`, `description`: `string`, `id`: `string`, `is_provisional`: `boolean`, `item_number`: `string`, `notes`: `string | null`, `product_id`: `string | null`, `quantity`: `number`, `rate`: `number`, `section_id`: `string`, `sort_order`: `number`, `unit_of_measure`: `string` |
| `project_purchase_order_boq_links` | `id`: `string`, `business_id`: `string`, `project_id`: `string`, `purchase_order_line_id`: `string`, `boq_item_id`: `string`, `created_at`: `string`, `created_by`: `string | null` |
| `project_valuation_lines` | `boq_line_id`: `string`, `cumulative_pct`: `number`, `cumulative_value`: `number`, `id`: `string`, `notes`: `string | null`, `period_value`: `number`, `previous_cumulative_value`: `number`, `valuation_id`: `string` |
| `project_valuations` | `created_at`: `string`, `created_by`: `string`, `gross_amount`: `number`, `id`: `string`, `invoice_id`: `string | null`, `net_amount`: `number`, `notes`: `string | null`, `period_end`: `string | null`, `period_start`: `string | null`, `previous_cumulative`: `number`, `project_id`: `string`, `retention_amount`: `number`, `status`: `string`, `updated_at`: `string`, `valuation_date`: `string`, `valuation_number`: `number` |
| `project_retention_ledger` | `amount`: `number`, `created_at`: `string`, `created_by`: `string`, `description`: `string | null`, `id`: `string`, `invoice_id`: `string | null`, `project_id`: `string`, `type`: `string`, `valuation_id`: `string | null` |
| `payment_certificates` | `advance_recovery`: `number`, `business_id`: `string`, `certificate_date`: `string`, `certificate_number`: `number`, `created_at`: `string`, `created_by`: `string`, `gross_amount`: `number`, `id`: `string`, `issued_to_contact_id`: `string | null`, `net_amount`: `number`, `notes`: `string | null`, `other_deductions`: `number`, `paid_amount`: `number`, `paid_date`: `string | null`, `payment_due_date`: `string | null`, `penalty_deductions`: `number`, `project_id`: `string`, `retention_amount`: `number`, `retention_percentage`: `number`, `status`: `string`, `total_retention_held`: `number`, `updated_at`: `string`, `valuation_id`: `string` |

### Subcontract tables

| Table | `Row` columns from generated types |
|---|---|
| `subcontractor_profiles` | `business_id`: `string`, `compliance_notes`: `string | null`, `contact_id`: `string`, `created_at`: `string`, `id`: `string`, `insurance_expiry`: `string | null`, `insurance_policy_number`: `string | null`, `insurance_provider`: `string | null`, `is_active`: `boolean`, `license_expiry`: `string | null`, `license_number`: `string | null`, `preferred`: `boolean`, `safety_rating`: `string | null`, `trade`: `string`, `updated_at`: `string` |
| `subcontracts` | `business_id`: `string`, `contract_value`: `number`, `created_at`: `string`, `created_by`: `string | null`, `currency`: `string`, `defects_liability_months`: `number | null`, `description`: `string | null`, `end_date`: `string | null`, `id`: `string`, `notes`: `string | null`, `payment_terms`: `string | null`, `project_id`: `string`, `reference`: `string`, `retention_percentage`: `number | null`, `scope_of_work`: `string | null`, `start_date`: `string | null`, `status`: `string`, `subcontractor_profile_id`: `string`, `title`: `string`, `updated_at`: `string` |

### Construction sites and procurement/material tables

| Table | `Row` columns from generated types |
|---|---|
| `construction_procurement_sites` | `branch_id`: `string`, `business_id`: `string`, `created_at`: `string`, `created_by`: `string`, `id`: `string`, `is_active`: `boolean`, `location_id`: `string`, `project_id`: `string | null`, `project_ref`: `string`, `site_code`: `string`, `site_name`: `string`, `updated_at`: `string` |
| `construction_procurement_capabilities` | `code`: `string`, `description`: `string` |
| `construction_procurement_grants` | `business_id`: `string`, `capability`: `string`, `grant_reason`: `string`, `granted_at`: `string`, `granted_by`: `string`, `id`: `string`, `revoked_at`: `string | null`, `revoked_by`: `string | null`, `revoked_reason`: `string | null`, `source`: `string`, `user_id`: `string` |
| `construction_product_uom_conversions` | `approved_at`: `string`, `approved_by`: `string`, `business_id`: `string`, `evidence_reference`: `string`, `factor`: `number`, `from_uom`: `string`, `id`: `string`, `is_active`: `boolean`, `product_id`: `string`, `to_uom`: `string` |
| `construction_purchase_orders` | `authorized_at`: `string | null`, `authorized_by`: `string | null`, `branch_id`: `string`, `business_id`: `string`, `cancel_reason`: `string | null`, `cancelled_at`: `string | null`, `cancelled_by`: `string | null`, `client_key`: `string`, `created_at`: `string`, `created_by`: `string`, `currency`: `string`, `id`: `string`, `notes`: `string | null`, `po_number`: `string`, `project_id`: `string | null`, `project_ref`: `string`, `site_id`: `string`, `status`: `string`, `supplier_contact_id`: `string`, `updated_at`: `string` |
| `construction_purchase_order_lines` | `business_id`: `string`, `created_at`: `string`, `expected_unit_price`: `number | null`, `id`: `string`, `line_note`: `string | null`, `line_number`: `number`, `po_id`: `string`, `product_id`: `string`, `quantity_ordered`: `number`, `quantity_ordered_base`: `number`, `uom`: `string` |
| `construction_purchase_order_events` | `action`: `string`, `actor`: `string | null`, `business_id`: `string`, `created_at`: `string`, `detail`: `string | null`, `id`: `number`, `po_id`: `string` |
| `construction_delivery_notes` | `business_id`: `string`, `client_key`: `string`, `delivery_note_number`: `string`, `document_date`: `string`, `document_received_by`: `string | null`, `evidence_reference`: `string`, `exception_evidence`: `string | null`, `exception_of`: `string | null`, `exception_reason`: `string | null`, `id`: `string`, `is_exception`: `boolean`, `normalized_reference`: `string`, `notes`: `string | null`, `po_id`: `string`, `recorded_at`: `string`, `recorded_by`: `string`, `supplier_contact_id`: `string` |
| `construction_delivery_note_lines` | `business_id`: `string`, `created_at`: `string`, `delivery_note_id`: `string`, `id`: `string`, `line_note`: `string | null`, `line_number`: `number`, `po_line_id`: `string`, `product_id`: `string`, `quantity_declared`: `number`, `quantity_declared_base`: `number`, `uom`: `string` |
| `construction_goods_receipt_notes` | `branch_id`: `string`, `business_id`: `string`, `client_key`: `string`, `created_at`: `string`, `created_by`: `string`, `delivery_note_id`: `string | null`, `grn_number`: `string`, `id`: `string`, `location_id`: `string`, `notes`: `string | null`, `po_id`: `string`, `project_ref`: `string`, `receipt_date`: `string`, `site_id`: `string` |
| `construction_goods_receipt_lines` | `accepted_base`: `number`, `business_id`: `string`, `created_at`: `string`, `disputed_base`: `number`, `grn_id`: `string`, `id`: `string`, `line_note`: `string | null`, `line_number`: `number`, `over_receipt_authorized_by`: `string | null`, `over_receipt_evidence`: `string | null`, `over_receipt_exception`: `boolean`, `over_receipt_reason`: `string | null`, `po_line_id`: `string`, `product_id`: `string`, `quantity_accepted`: `number`, `quantity_disputed`: `number`, `quantity_posted_base`: `number`, `quantity_quarantined`: `number`, `quantity_received`: `number`, `quantity_rejected`: `number`, `quarantined_base`: `number`, `received_base`: `number`, `rejected_base`: `number`, `uom`: `string` |
| `construction_goods_receipt_holds` | `business_id`: `string`, `created_at`: `string`, `created_by`: `string`, `evidence_reference`: `string`, `grn_line_id`: `string`, `hold_type`: `string`, `id`: `string`, `quantity`: `number`, `quantity_base`: `number`, `reason`: `string`, `release_reason`: `string | null`, `released_at`: `string | null`, `released_by`: `string | null`, `status`: `string` |
| `construction_receipt_bill_allocations` | `bill_quantity`: `number`, `bill_quantity_base`: `number`, `bill_uom`: `string`, `business_id`: `string`, `client_key`: `string`, `exception_evidence`: `string | null`, `exception_reason`: `string | null`, `expense_id`: `string`, `expense_line_id`: `string`, `grn_line_id`: `string`, `id`: `string`, `is_exception`: `boolean`, `matched_at`: `string`, `matched_by`: `string`, `receipt_quantity`: `number`, `receipt_quantity_base`: `number`, `receipt_uom`: `string` |
| `construction_receipt_cost_bases` | `allocation_id`: `string`, `bill_unit_cost`: `number | null`, `business_id`: `string`, `claimed_at`: `string`, `claimed_by`: `string`, `client_key`: `string`, `cost_currency`: `string`, `discount_deducted`: `number`, `evidence_reference`: `string`, `exchange_rate_used`: `number`, `expense_line_id`: `string`, `grn_line_id`: `string`, `id`: `string`, `nonrecoverable_tax`: `number`, `quantity_base`: `number`, `unit_cost_base`: `number`, `vat_recoverable`: `boolean` |
| `construction_receipt_inspections` | `business_id`: `string`, `certificate_reference`: `string | null`, `client_key`: `string`, `evidence_reference`: `string`, `grn_line_id`: `string`, `id`: `string`, `inspected_at`: `string`, `inspected_by`: `string`, `inspection_date`: `string`, `method`: `string`, `notes`: `string | null`, `outcome`: `string`, `quantity_inspected`: `number`, `quantity_inspected_base`: `number` |
| `construction_receipt_line_reclassifications` | `accepted_after_base`: `number`, `accepted_before_base`: `number`, `business_id`: `string`, `client_key`: `string`, `evidence_reference`: `string`, `from_bucket`: `string`, `grn_line_id`: `string`, `id`: `string`, `inspection_id`: `string`, `quantity`: `number`, `quantity_base`: `number`, `reason`: `string`, `reclassified_at`: `string`, `reclassified_by`: `string`, `to_bucket`: `string` |
| `construction_receipt_posting_policies` | `approved_at`: `string | null`, `approved_by`: `string | null`, `approved_evidence`: `string | null`, `approved_reason`: `string | null`, `business_id`: `string`, `cost_basis_source`: `string | null`, `gl_posting_enabled`: `boolean`, `movement_posting_enabled`: `boolean`, `updated_at`: `string` |
| `construction_supplier_invoice_references` | `business_id`: `string`, `exception_evidence`: `string | null`, `exception_of`: `string | null`, `exception_reason`: `string | null`, `expense_id`: `string`, `id`: `string`, `recorded_at`: `string`, `recorded_by`: `string`, `reference_normalized`: `string`, `reference_raw`: `string`, `source`: `string`, `status`: `string`, `supplier_contact_id`: `string` |
| `construction_material_issues` | `branch_id`: `string`, `business_id`: `string`, `client_key`: `string`, `currency`: `string`, `evidence_reference`: `string`, `id`: `string`, `issue_date`: `string`, `issued_at`: `string`, `issued_by`: `string`, `issued_to`: `string | null`, `location_id`: `string`, `notes`: `string | null`, `product_id`: `string`, `project_id`: `string | null`, `project_ref`: `string`, `quantity`: `number`, `quantity_base`: `number`, `site_id`: `string`, `stock_movement_id`: `string`, `total_cost_base`: `number`, `unit_cost_base`: `number`, `uom`: `string` |
| `construction_material_returns` | `branch_id`: `string`, `business_id`: `string`, `client_key`: `string`, `condition`: `string`, `created_at`: `string`, `created_by`: `string`, `currency`: `string`, `evidence_reference`: `string`, `id`: `string`, `location_id`: `string`, `notes`: `string | null`, `product_id`: `string`, `project_id`: `string | null`, `project_ref`: `string`, `quantity`: `number`, `quantity_base`: `number`, `reason`: `string`, `received_by`: `string | null`, `return_date`: `string`, `site_id`: `string`, `source_issue_id`: `string`, `stock_movement_id`: `string`, `total_cost_base`: `number`, `unit_cost_base`: `number`, `uom`: `string` |

### Shared site-location table used by Construction

| Table | `Row` columns from generated types |
|---|---|
| `inventory_locations` | `branch_id`: `string | null`, `business_id`: `string`, `code`: `string | null`, `created_at`: `string`, `id`: `string`, `is_active`: `boolean`, `is_default`: `boolean`, `location_type`: `string`, `name`: `string`, `project_id`: `string | null` |


**Highlighted existing contracts**

- `construction_projects`: columns include `status`, `start_date`, `end_date`, `budget`, `contract_sum`, `retention_pct`, `client_id`, `client_name`, `boq_locked_at`. There is no `contract_amount` column and no scheduling column beyond the project-level dates. Status is text constrained to `tender`, `active`, `practical_completion`, `defect_liability`, `closed`; `transition_project_status` permits only the linear next transition in that order and writes `project_status_log`.
- `boq_items`: `quantity`, `rate`, and `amount` are numeric; `is_provisional` is boolean. `calculate_boq_item_amount()` sets `amount = round(quantity * rate, 2)`. Version state is `draft | active | archived`; one active version per project is enforced.
- `project_boq_lines` remains the schedule-of-values relation used by shipped `project_valuation_lines` and valuation RPCs. `20261122000000_construction_multilevel_boq.sql` imports/synchronizes the newer versioned `boq_items` into it while the project is not locked. New controls should use BOQ item/section IDs and an explicit bridge; do not assume valuation lines already FK to `boq_items`.
- `project_valuations`: state is `draft | submitted | invoiced`; amount fields are `gross_amount`, `retention_amount`, `net_amount`, `previous_cumulative`. Submission/invoicing are RPC-controlled.
- `payment_certificates`: state is `draft | issued | paid | partially_paid | cancelled`; amounts include gross, retention, advance recovery, penalty/other deductions, net, total retention held, paid amount; one non-cancelled certificate per valuation is enforced. Certificates are derived from submitted/invoiced valuations, not a replacement valuation ledger.
- `subcontracts`: state is `draft | active | on_hold | completed | terminated`, with guarded transitions. `subcontractor_profiles.safety_rating` (`A/B/C/D/unrated`) is a subcontractor profile rating, not an HSE incident/severity model.

### 0b. Existing construction-related RPCs

Inventory is based on migration-defined public functions in the construction/project/BOQ/valuation/certificate families, with final signatures after migrations that replace earlier overloads. Trigger functions and private helpers are listed separately; they are not client RPCs. This includes the name/signature search requested in the brief plus generic project-report functions defined in the construction reporting migration.

#### Callable project, site, procurement, BOQ, valuation and certificate functions

| Function and parameters | Purpose |
|---|---|
| `construction_procurement_capabilities_for(p_business_id uuid)` | Reads the caller’s effective construction procurement capability codes. |
| `grant_construction_procurement_capability(p_business_id uuid, p_user_id uuid, p_capability text, p_reason text)` / `revoke_construction_procurement_capability(p_grant_id uuid, p_reason text)` | Grant/revoke a scoped procurement capability with reason/evidence and actor checks. |
| `register_construction_procurement_site(p_business_id uuid, p_branch_id uuid, p_location_id uuid, p_site_code text, p_site_name text, p_project_ref text)` | Idempotently registers a procurement site against a business, branch and inventory location. |
| `set_construction_procurement_site_status(p_site_id uuid, p_active boolean, p_reason text DEFAULT NULL)` / `update_construction_procurement_site(p_site_id uuid, p_site_name text DEFAULT NULL, p_project_id uuid DEFAULT NULL, p_project_ref text DEFAULT NULL, p_set_project boolean DEFAULT false)` | Deactivates/reactivates a site with open-PO/stock checks; updates its name or explicit project link/unlink. |
| `register_construction_product_uom_conversion(p_business_id uuid, p_product_id uuid, p_from_uom text, p_to_uom text, p_factor numeric, p_evidence_reference text)` | Registers an evidence-backed product-specific unit conversion. |
| `create_construction_purchase_order(p_payload jsonb, p_client_key uuid)` / `authorize_construction_purchase_order(p_po_id uuid)` / `cancel_construction_purchase_order(p_po_id uuid, p_reason text)` | Creates an idempotent PO, authorizes it, or cancels it through command RPCs. |
| `record_construction_delivery_note(p_payload jsonb, p_client_key uuid)` / `record_construction_delivery_note_exception(p_payload jsonb, p_client_key uuid)` | Records delivery evidence or a reasoned exception against a PO. |
| `record_construction_goods_receipt(p_payload jsonb, p_client_key uuid)` / `release_construction_receipt_hold(p_hold_id uuid, p_reason text)` | Records accepted/rejected/quarantined receipt lines and authorized release of a hold. |
| `record_construction_receipt_inspection(p_payload jsonb, p_client_key uuid)` / `reclassify_construction_receipt_line(p_payload jsonb, p_client_key uuid)` | Captures receipt-line inspection results and evidence-backed reclassification between receipt buckets. This is incoming-material QA, not work/ITP inspection. |
| `register_construction_supplier_invoice_reference(p_expense_id uuid)` / `register_construction_supplier_invoice_reference_exception(p_expense_id uuid, p_exception_of uuid, p_reason text, p_evidence text)` / `match_construction_bill_line_to_receipt(p_payload jsonb, p_client_key uuid)` | Links supplier bill references to receipt evidence, records exceptions, and allocates bill lines to receipts. |
| `approve_construction_receipt_posting_policy(p_business_id uuid, p_enable boolean, p_reason text, p_evidence text)` / `record_construction_receipt_cost_basis(p_grn_line_id uuid, p_expense_line_id uuid, p_quantity numeric, p_evidence text, p_client_key uuid)` / `post_construction_receipt_movement(p_grn_id uuid)` | Explicitly enables/disables per-business receipt movement policy, records matched-bill cost basis, and posts a receipt stock movement only under that policy. GL posting remains constrained off. |
| `issue_construction_materials_to_project(p_payload jsonb, p_client_key uuid)` / `return_construction_materials_to_store(p_payload jsonb, p_client_key uuid)` | Records project material issue/return against stock with idempotency and evidence. |
| `construction_project_material_cost(p_business_id uuid)` / `construction_procurement_open_items(p_business_id uuid)` / `construction_supplier_reference_visible(p_business_id uuid, p_expense_id uuid)` | Project cost aggregation, procurement open-item report, and branch-aware supplier-reference visibility. The cost/open-item functions are replaced by later migrations while keeping their signatures. |
| `provision_construction_defaults(p_business_id uuid, p_owner_user_id uuid)` | Sets up construction defaults and capability/provisioning state for a business. |
| `create_project(p_business_id uuid, p_name text, p_client_name text, p_contract_sum numeric, p_retention_pct numeric, p_budget numeric, p_start_date date, p_end_date date, p_client_id uuid DEFAULT NULL)` / `update_project(p_project_id uuid, p_name text, p_client_name text, p_contract_sum numeric, p_retention_pct numeric, p_budget numeric, p_start_date date, p_end_date date, p_client_id uuid DEFAULT NULL)` | Creates/updates the project including optional customer contact link. The historical eight-argument signatures are dropped to avoid PostgREST overload ambiguity. |
| `transition_project_status(p_project_id uuid, p_new_status text, p_reason text DEFAULT NULL)` | Enforces the next legal project transition and appends a status-log row. |
| `link_site_to_project(p_location_id uuid, p_project_id uuid)` / `unlink_site_from_project(p_location_id uuid)` | Links/unlinks an `inventory_locations` row to a same-business construction project. |
| `get_project_cost_summary(p_project_id uuid)` / `get_project_pnl(p_project_id uuid)` | Project cost summary and project P&L reporting. |
| `create_project_purchase_order(p_payload jsonb, p_client_key uuid, p_project_id uuid)` / `issue_project_materials(p_payload jsonb, p_client_key uuid, p_project_id uuid)` / `return_project_materials(p_payload jsonb, p_client_key uuid, p_project_id uuid)` | Earlier project-bound command entry points retained alongside the more general construction procurement commands. |
| `create_boq_line(p_project_id uuid, p_line_number text, p_description text, p_quantity numeric, p_unit text, p_rate numeric, p_sort_order int)` / `update_boq_line(p_line_id uuid, p_line_number text, p_description text, p_quantity numeric, p_unit text, p_rate numeric, p_sort_order int)` / `delete_boq_line(p_line_id uuid)` | CRUD for legacy project schedule-of-values/BOQ lines. |
| `reorder_boq_lines(p_project_id uuid, p_line_ids uuid[])` / `bulk_upsert_boq_lines(p_project_id uuid, p_lines jsonb)` / `get_boq_summary(p_project_id uuid)` | Reorders, bulk-upserts, or summarizes legacy project BOQ lines. |
| `set_project_purchase_order_boq_link(p_business_id uuid, p_project_id uuid, p_purchase_order_line_id uuid, p_boq_item_id uuid DEFAULT NULL)` | Adds/removes the link from a PO line to a same-project BOQ item. |
| `provision_construction_coa_accounts(p_business_id uuid)` | Idempotently provisions the construction chart-of-accounts entries after checking actor, business model and existing account conflicts. |
| `create_valuation(p_project_id uuid, p_valuation_date date, p_period_start date, p_period_end date, p_lines jsonb, p_notes text DEFAULT NULL)` / `update_valuation(p_valuation_id uuid, p_valuation_date date, p_period_start date, p_period_end date, p_lines jsonb, p_notes text DEFAULT NULL)` / `submit_valuation(p_valuation_id uuid)` | Creates/updates valuation detail lines and submits a draft valuation. |
| `generate_invoice_from_valuation(p_valuation_id uuid)` | Generates the customer invoice from an eligible valuation using the project client contact bridge. |
| `release_retention(p_project_id uuid, p_amount numeric, p_description text)` / `get_retention_summary(p_project_id uuid)` / `get_retention_aging(p_business_id uuid)` | Releases eligible retention through the existing ledger and reports project balance/portfolio aging. |
| `get_valuation_history(p_project_id uuid)` / `get_project_valuation_trend(p_project_id uuid)` / `get_valuation_trend(p_project_id uuid)` | Returns valuation and retention history or valuation trend data. |
| `get_portfolio_summary(p_business_id uuid)` / `get_dashboard_metrics(p_business_id uuid)` / `get_dashboard_metrics(p_business_id uuid, p_months integer)` / `get_cost_breakdown_by_project(p_business_id uuid)` | Construction portfolio/dashboard/reporting functions; both dashboard-metrics overloads exist. |
| `create_certificate_from_valuation(p_valuation_id uuid, p_retention_percentage numeric DEFAULT 10, p_advance_recovery numeric DEFAULT 0, p_penalty_deductions numeric DEFAULT 0, p_other_deductions numeric DEFAULT 0)` | Creates a payment certificate from a submitted/invoiced valuation with retention and deductions. |
| `issue_payment_certificate(p_certificate_id uuid, p_payment_due_date date DEFAULT NULL)` / `record_payment_certificate_payment(p_certificate_id uuid, p_amount numeric, p_paid_date date DEFAULT CURRENT_DATE)` / `cancel_payment_certificate(p_certificate_id uuid)` | Issues a certificate, records partial/full payment, or cancels it under certificate state rules. |

#### Private helpers and trigger functions (not client RPCs)

| Function/signature group | Purpose |
|---|---|
| `_ledgr_construction_capability(p_business uuid, p_user uuid, p_capability text)`, `_ledgr_construction_actor(p_business uuid, p_capability text)`, `_ledgr_construction_uuid(p_value text, p_label text)`, `_ledgr_construction_date(p_value text, p_label text)`, `_ledgr_construction_text(p_value text, p_label text)`, `_ledgr_construction_reason_present(p_reason text)` | Capability/actor checks and strict payload validation. |
| `_ledgr_construction_site(p_business uuid, p_site uuid)`, `_ledgr_construction_base_uom(p_business uuid, p_product uuid)`, `_ledgr_construction_to_base(p_business uuid, p_product uuid, p_uom text, p_quantity numeric, p_label text)`, `_ledgr_construction_normalize_reference(p_text text)`, `_ledgr_construction_bill(p_business uuid, p_expense uuid)`, `_ledgr_construction_assert_bill_not_inventoried(p_business uuid, p_expense uuid)` | Same-tenant site, product/UOM, bill, and invoice/reference resolution/guards. |
| `_ledgr_construction_guard_conversion()`, `_ledgr_construction_guard_po()`, `_ledgr_construction_guard_po_line()`, `_ledgr_construction_guard_po_line_frozen()`, `_ledgr_construction_guard_dn()`, `_ledgr_construction_guard_dn_line()`, `_ledgr_construction_guard_grn()`, `_ledgr_construction_guard_grn_line()`, `_ledgr_construction_guard_hold()`, `_ledgr_construction_append_only()` | Trigger validators for tenant scope, lifecycle, stock/quantity invariants and the command-token append-only policy. All return `trigger` and take no SQL arguments. |
| `_ledgr_project_next_status(p_status text)`, `_ledgr_project_procurement_tag()`, `_ledgr_project_location_guard()` | Project lifecycle helper, tags procurement rows with their project, and validates project/location scope. Trigger helpers return `trigger` where bound. |
| `_ledgr_project_valuation_actor(p_business_id uuid, p_required_capabilities text[] DEFAULT NULL)`, `_ledgr_rebuild_project_valuation_lines(p_project_id uuid, p_valuation_id uuid, p_valuation_number integer, p_lines jsonb, p_notes text)`, `_ledgr_project_valuation_payload(p_valuation_id uuid)`, `_ledgr_construction_billing_contact(p_business_id uuid, p_client_name text)`, `_ledgr_resolve_construction_client(p_project_id uuid)` | Valuation authorization, line rebuild, payload formatting, and customer-contact resolution. |
| `_ledgr_validate_subcontractor_profile_scope()`, `_ledgr_validate_subcontract_scope()`, `_ledgr_validate_subcontract_status_transition()` | Trigger guards for same-business subcontractor/contact/project relations and allowed subcontract status transitions. |
| `calculate_boq_item_amount()`, `recalculate_boq_total(p_boq_version_id uuid)`, `_boq_version_guard()`, `_boq_section_guard()`, `_boq_item_guard()`, `_boq_recalculate_total_after_item_change()` | BOQ amount/total maintenance and draft/project/tenant/lock guard triggers. |
| `_project_po_boq_link_guard()` | Validates PO-line-to-BOQ-item project/business scope and lifecycle. |

Subcontractor CRUD is currently table/RLS-backed (no dedicated subcontract command RPCs found). `construction_receipt_inspections` is the only existing inspection-shaped write workflow. No RFI, change-order, project-QC/ITP, HSE incident/action, or scheduling/task RPC exists.

### 0c. Existing pages and routes

#### App routes

`src/App.tsx` declares three dedicated paths and one protected wildcard:

- `/construction/subcontractors` — Enterprise + construction capability; subcontractor directory/profile management.
- `/construction/certificates` — Enterprise + `PROJECT_BASED` + construction capability; payment certificates.
- `/construction/retention-register` — Enterprise + `PROJECT_BASED` + construction capability; retention history/release.
- `/construction/*` — Enterprise + construction capability; `ConstructionWorkspacePage` handles workspace sections and deep links. Effective in-app locations include `/construction`, `/construction/projects`, `/construction/projects/:projectId`, `/construction/retention`, `/construction/purchase-orders`, `/construction/receipts`, `/construction/bill-matching`, `/construction/material-issues`, `/construction/returns`, `/construction/setup`. Existing URLs must remain unchanged.

The current workspace, subcontractor and certificates routes are not all gated identically for `PROJECT_BASED`. Phase 5B-4 must add the explicit dual gate to every new feature without broadening or renaming these existing routes.

#### `src/pages/construction/` files

| File | Purpose |
|---|---|
| `ConstructionWorkspacePage.tsx` | Project list/detail and tabbed overview, PO, receipts, bill matching, material issues, returns, setup and retention-aging views. |
| `PaymentCertificatesPage.tsx` | Lists eligible valuations, creates/issues certificates and records payments/cancellation. |
| `RetentionRegisterPage.tsx` | Reads project retention history/balance and invokes `release_retention`. |
| `SubcontractorsPage.tsx` | Contact-backed subcontractor profile and subcontract management UI. |
| `SubcontractorsPage.test.tsx` | UI test for subcontractor page flows. |
| `subcontractsPersistence.test.ts` | Persistence/contract coverage for subcontract records. |
| `__tests__/ConstructionBillMatching.test.tsx` | Bill-to-receipt matching UI coverage. |
| `__tests__/ConstructionBusinessScope.test.tsx` | Tenant/business boundary coverage. |
| `__tests__/ConstructionExceptionFlows.test.tsx` | Delivery-note/receipt exception handling. |
| `__tests__/ConstructionWorkspacePage.test.tsx` | Workspace/overview interactions. |
| `__tests__/PaymentCertificatesPage.test.tsx` | Certificate lifecycle UI coverage. |
| `__tests__/RetentionRegisterPage.test.tsx` | Retention register/release UI coverage. |

#### Construction nav (`src/components/layout/navConfig.ts`)

The section currently contains four items: Construction workspace `/construction`; Subcontractors `/construction/subcontractors`; Payment Certificates `/construction/certificates` (currently `requiredOperatingModels: ['PROJECT_BASED']`); Retention Register `/construction/retention-register` (also `PROJECT_BASED`). All are Enterprise and construction-organization-capability gated. No new 5B-4 nav item exists.

### 0d. Existing controls-related code search

The requested source search returns no project RFI, change-order, HSE incident/action, WBS, Gantt, predecessor or critical-path feature in `src/`. Matches are unrelated general schedules/timelines, general safety/error-boundary text, the subcontractor profile `safety_rating`, manufacturing quality checkpoints, and construction procurement receipt inspections. The requested migration search similarly returns no RFIs/change orders/HSE/schedule-task model; relevant false positives are the project BOQ “schedule of values”, receiving inspections/holds, and manufacturing `is_quality_checkpoint`. `construction_receipt_inspections` must not be relabeled as project work inspection.

### 0e. Existing enum types

No Construction-specific PostgreSQL enum type exists. Construction statuses and `safety_rating` use `text` plus `CHECK` constraints. The requested `CREATE TYPE` name filter finds generic enums such as `account_subtype`, `account_type`, `asset_status`, `currency_code`, `depreciation_method`, `invoice_status`, `journal_status`, `payment_method`, `payroll_status`, `stock_movement_type`, `tax_code`, `tax_return_status`, `tax_alert_type`, `tax_alert_channel`, `tax_alert_status`, and `user_role`; none model project RFI/CO/quality/HSE/schedule states. Recommendation: use `text` with explicit CHECK vocabularies for new lifecycle fields so adding a state is a migration-controlled change and avoids enum evolution friction.

## 1. Domain analysis

### 1a. RFIs

Formal traceable question/answer between contractor, consultant and client. Keep the lifecycle Draft → Submitted → Under Review → Answered → Closed (plus Withdrawn/Cancelled only if product owner approves). Store a project-local `RFI-0001` sequence separate from CSI MasterFormat/drawing references. Support subject, question, drawing/spec reference, optional site/BOQ item, priority, contractual due date, answer, responder, response time and evidence attachment. Default response target can be configurable (industry practice often uses a 7–14 day window), but the contract/calendar—not an assumed global SLA—must be the authoritative due date. Link to `contacts` for external parties; retain authenticated actor IDs separately for audit.

### 1b. Change Orders

Formal scope/contract/time change. Lifecycle Draft → Submitted → Under Review → Approved or Rejected → Implemented (with Withdrawn/Cancelled only if explicitly supported). Store reason category (design change, site condition, client request, statutory/compliance, other), signed cost impact, signed time impact in days, affected BOQ lines, approval evidence and approver decisions. **Do not overwrite `construction_projects.contract_sum` or historical BOQ/valuation/certificate rows.** Keep original contract sum immutable from the new feature, derive adjusted contract sum as original plus approved COs, and implement approved scope by creating/activating a new BOQ version (using existing versioned BOQ mechanism) or a separately tracked delta. Future valuations may consume the approved/revised scope; issued certificates remain historical snapshots.

### 1c. Quality inspections

Project work verification (ITP/hold-point/witness-point), distinct from receipt inspection. Lifecycle Planned → In Progress → Passed / Failed → Rectification Required → Re-inspection → Closed. Record inspection type/trade, site/area, BOQ item/section, specification and acceptance criteria, inspector, timestamps, results, notes and photo/document evidence. A failed hold point may block a configured valuation submission/release; default should be informational until business rules are approved. A checklist line table is needed for per-item results and re-inspection history. ITP templates can be a later phase; MVP allows a fixed checklist snapshot per inspection.

### 1d. HSE incidents

Record near miss, injury, environmental event and property damage; lifecycle Reported → Investigating → Actions Assigned → Actions Completed → Closed. Store event date/time, site/location, persons involved (contacts where appropriate), description, initial and final severity, root cause, regulator notification flag/reference, injury/lost-time fields only where legally appropriate, investigator, and corrective/preventive actions with owner/due/completion/evidence. OSHA/ISO 45001 vocabulary can inform a configurable classification but must not be treated as a substitute for local Malawi/regional legal reporting rules. Restrict personally identifying/medical details more tightly than general project data.

### 1e. Project scheduling

Project timeline management. MVP lifecycle is task creation → dependency/baseline definition → progress updates → completion; retain actual dates separately from planned dates. Data includes WBS hierarchy, name/description, task vs milestone, planned/actual start/end, duration, percent complete, dependency type/lag, assigned contact/subcontractor and optional BOQ section/site. Scheduling is the largest scope: do not imply critical-path truth until dependency cycle prevention, calendars, lag rules, progress rules and baseline comparison are validated. Start with a list/board and a lightweight visual timeline; add CPM as a separately audited capability.

## 2. Proposed data model (new tables only)

All proposed tables are additive; the audit does not alter existing tables/RPCs/routes. Every tenant-owned row carries `business_id`, `project_id` where meaningful, UUID identity, actor and timestamps. Parent/business consistency must be verified inside SECURITY DEFINER commands (or same-project child FKs); existing `construction_projects` does not expose a `(business_id,id)` unique key that can safely be assumed for composite FKs. Use `is_business_member(business_id)` in RLS plus exact same-business checks. Prefer member SELECT and command-only writes; revoke direct anon/authenticated writes where RPCs own lifecycle. Every new RPC must enforce Enterprise plus `PROJECT_BASED`, membership, capability, input bounds and audit evidence server-side.

### Shared evidence/attachment link

**Table: `construction_control_attachments`**

Columns: `id uuid PK`; `business_id uuid FK → businesses`; `project_id uuid FK → construction_projects`; exactly one parent FK (`rfi_id`, `change_order_id`, `quality_inspection_id`, `hse_incident_id`); `storage_path text`; `file_name text`; `content_type text`; `size_bytes bigint`; `uploaded_by uuid FK → auth.users`; `created_at timestamptz`. CHECK that exactly one parent is non-NULL; verify its project/business with a trigger/RPC. Store object path, not public URL; signed access follows membership/feature policy. Index `(business_id,project_id)` and each parent FK. RLS: authenticated project members only; no public bucket reads.

### RFIs

**Table: `construction_project_rfis`**

Columns: `id uuid PK`; `business_id uuid FK`; `project_id uuid FK`; `site_id uuid NULL FK → construction_procurement_sites`; `rfi_number integer`; `subject text`; `question text`; `reference_drawing text NULL`; `reference_specification text NULL`; `boq_item_id uuid NULL FK → boq_items`; `priority text CHECK (low, normal, high, urgent)`; `status text CHECK (draft, submitted, under_review, answered, closed, withdrawn)`; `due_at timestamptz NULL`; `answer text NULL`; `raised_by_contact_id uuid NULL FK → contacts`; `assigned_to_contact_id uuid NULL FK → contacts`; `responded_by_contact_id uuid NULL FK → contacts`; `submitted_at/answered_at/closed_at timestamptz NULL`; `created_by uuid FK → auth.users`; `created_at/updated_at timestamptz`. Indexes: unique `(business_id,project_id,rfi_number)`; `(business_id,project_id,status,due_at)`; `(project_id,boq_item_id)`; partial overdue index. RLS: business-member SELECT; lifecycle writes through RPC.

### Change orders

**Table: `construction_change_orders`**

Columns: `id uuid PK`; `business_id/project_id FK`; `change_order_number integer`; `title text`; `description text`; `reason_code text CHECK` (approved vocabulary); `status text CHECK (draft, submitted, under_review, approved, rejected, implemented, withdrawn)`; `cost_impact numeric(18,2)` signed; `time_impact_days integer` signed; `source_rfi_id uuid NULL FK → construction_project_rfis`; `approved_boq_version_id uuid NULL FK → boq_versions`; `submitted_at/decided_at/implemented_at timestamptz NULL`; `created_by/decided_by uuid`; `decision_reason text NULL`; `created_at/updated_at timestamptz`. Unique `(business_id,project_id,change_order_number)`; indexes `(project_id,status,created_at)` and `(business_id,project_id)`.

**Table: `construction_change_order_items`**

Columns: `id uuid PK`; `business_id/project_id`; `change_order_id uuid FK`; `boq_item_id uuid NULL FK → boq_items` (NULL for a proposed new line); `action text CHECK (add, revise, omit)`; `description text`; `quantity_delta numeric(14,4)`; `unit text`; `rate numeric(14,4)`; `amount_delta numeric(18,2)`; `created_at/updated_at timestamptz`. Index `(change_order_id)` and `(project_id,boq_item_id)`. Validate item/project/business in command; never mutate historical item/valuation lines in place.

**Table: `construction_change_order_approvals`**

Columns: `id uuid PK`; `business_id/project_id`; `change_order_id uuid FK`; `step_order integer`; `approver_contact_id uuid NULL FK → contacts`; `approver_user_id uuid FK → auth.users`; `decision text CHECK (pending, approved, rejected)`; `decision_reason text`; `decided_at timestamptz NULL`; `created_at timestamptz`. Unique `(change_order_id,step_order)`; index `(change_order_id,decision)`. Append decisions through an approval RPC; no client-side self-approval shortcut.

Cumulative contract change is a derived sum of `cost_impact` for approved/implemented change orders. Provide a new read RPC/view for original, approved delta and adjusted sum; do not update the existing project contract sum. Approval → implementation is the only point that permits creating a new active BOQ version and making the revised scope visible to future valuation commands.

### Quality

**Table: `construction_quality_inspections`**

Columns: `id uuid PK`; `business_id/project_id`; `site_id uuid NULL FK → construction_procurement_sites`; `inspection_number integer`; `inspection_type text`; `status text CHECK (planned, in_progress, passed, failed, rectification_required, reinspect, closed, cancelled)`; `hold_point boolean`; `witness_point boolean`; `boq_item_id uuid NULL FK → boq_items`; `boq_section_id uuid NULL FK → boq_sections`; `area_description text`; `specification_reference text`; `planned_at/inspected_at/closed_at timestamptz NULL`; `inspector_contact_id uuid NULL FK → contacts`; `reinspection_of_id uuid NULL FK → construction_quality_inspections`; `result_summary text`; `created_by uuid`; `created_at/updated_at timestamptz`. Unique `(project_id,inspection_number)`; indexes `(project_id,status,planned_at)`, `(project_id,boq_item_id)`, `(site_id,status)`.

**Table: `construction_quality_inspection_items`**

Columns: `id uuid PK`; `business_id/project_id`; `inspection_id uuid FK`; `sequence integer`; `check_item text`; `acceptance_criteria text`; `result text CHECK (pending, pass, fail, not_applicable)`; `notes text NULL`; `evidence_reference text NULL`; `rectification_required boolean`; `rechecked_at timestamptz NULL`; `created_at/updated_at timestamptz`. Unique `(inspection_id,sequence)`; index `(inspection_id,result)`. Separate rows rather than JSONB so individual checklist results, rechecks, and hold-point failures are queryable/auditable. Versioned reusable templates are deferred.

### HSE

**Table: `construction_hse_incidents`**

Columns: `id uuid PK`; `business_id/project_id`; `site_id uuid NULL FK`; `incident_number integer`; `incident_type text CHECK (near_miss, injury, environmental, property_damage, other)`; `severity text` using an owner-approved local policy; `status text CHECK (reported, investigating, actions_assigned, actions_completed, closed, reopened)`; `occurred_at timestamptz`; `reported_at timestamptz`; `area_description text`; `description text`; `persons_involved jsonb` (minimal identifiers; avoid medical detail); `root_cause text NULL`; `lost_time_days numeric(8,2) NULL`; `regulator_notified boolean`; `regulator_reference text NULL`; `investigator_user_id uuid NULL`; `closed_at timestamptz NULL`; `created_by uuid`; `created_at/updated_at timestamptz`. Unique `(project_id,incident_number)`; indexes `(project_id,status,occurred_at DESC)`, `(business_id,severity,status)`. Restrict PII/medical fields to a separately authorized role if collected.

**Table: `construction_hse_corrective_actions`**

Columns: `id uuid PK`; `business_id/project_id`; `incident_id uuid FK`; `action_number integer`; `action text`; `owner_contact_id uuid NULL FK → contacts`; `owner_user_id uuid NULL FK → auth.users`; `due_at timestamptz`; `status text CHECK (open, in_progress, completed, verified, cancelled)`; `completed_at/verified_at timestamptz NULL`; `completion_evidence text NULL`; `created_at/updated_at timestamptz`. Unique `(incident_id,action_number)`; indexes `(project_id,status,due_at)`, `(incident_id,status)`. Child rows are preferable to a JSONB action array for ownership, overdue reporting and closure checks.

### Scheduling

**Table: `construction_schedule_tasks`**

Columns: `id uuid PK`; `business_id/project_id`; `parent_task_id uuid NULL FK → construction_schedule_tasks`; `site_id uuid NULL FK`; `boq_section_id uuid NULL FK → boq_sections`; `wbs_code text`; `name text`; `description text NULL`; `task_kind text CHECK (task, milestone)`; `status text CHECK (not_started, in_progress, blocked, complete, cancelled)`; `planned_start/planned_finish date`; `actual_start/actual_finish date NULL`; `duration_workdays integer`; `percent_complete numeric(5,2)`; `assigned_contact_id uuid NULL FK → contacts`; `subcontract_id uuid NULL FK → subcontracts`; `created_by uuid`; `created_at/updated_at timestamptz`. Unique `(project_id,wbs_code)`; indexes `(project_id,parent_task_id)`, `(project_id,status,planned_start)`, `(project_id,boq_section_id)`. Task/milestone share one table through `task_kind`; a milestone has zero duration and same start/finish date.

**Table: `construction_schedule_dependencies`**

Columns: `id uuid PK`; `business_id/project_id`; `predecessor_task_id uuid FK → construction_schedule_tasks`; `successor_task_id uuid FK → construction_schedule_tasks`; `dependency_type text CHECK (FS, SS, FF, SF)`; `lag_workdays integer DEFAULT 0`; `created_by uuid`; `created_at timestamptz`. Unique `(predecessor_task_id,successor_task_id,dependency_type)`; indexes `(project_id,successor_task_id)` and `(project_id,predecessor_task_id)`. Validate both endpoints belong to same business/project; reject self-links and cycles in a serialized RPC.

**Table: `construction_schedule_baselines`**

Columns: `id uuid PK`; `business_id/project_id`; `baseline_number integer`; `name text`; `status text CHECK (draft, approved, superseded)`; `approved_by uuid NULL`; `approved_at timestamptz NULL`; `created_by uuid`; `created_at timestamptz`. Unique `(project_id,baseline_number)`; index `(project_id,status)`.

**Table: `construction_schedule_baseline_tasks`**

Columns: `id uuid PK`; `business_id/project_id`; `baseline_id uuid FK`; `task_id uuid FK`; `wbs_code text`; `planned_start/planned_finish date`; `duration_workdays integer`; `parent_wbs_code text NULL`; `created_at timestamptz`. Unique `(baseline_id,task_id)`; index `(project_id,baseline_id)`. Snapshot rows are immutable after baseline approval; actual progress stays on task rows.

**Scheduling key decision:** use a flat task table with `parent_task_id` for WBS and a separate predecessor/successor edge table; use actual dependency records rather than a single unstructured predecessor field. MVP dates/duration plus dependency validation, no auto-resource leveling or authoritative critical-path calculation. Critical-path flag is derived later, not user-editable.

## 3. Integration analysis

Legend: `Y` = direct relationship/controlled workflow; `Indirect` = only through a new valuation/BOQ snapshot; `No` = no first-release mutation.

| Control | Affects BOQ? | Affects valuations? | Affects certificates? | Affects procurement? | Affects materials? |
|---|---|---|---|---|---|
| RFIs | Y — optional BOQ item FK/reference | No — context only; never auto-create valuation lines | No | Indirect — optional PO/RFI cross-reference for clarification | No |
| Change Orders | Y — approved delta becomes a new active BOQ version, preserving old snapshots | Y — only future valuations consume approved revised BOQ/delta; do not rewrite history | Indirect — certificate remains linked to its source valuation; revised amount flows via a new valuation | Y — approved scope may create or amend commands only through existing/new PO RPCs with CO reference | Indirect — new/omitted quantities affect future work packs; no backdated stock posting |
| Quality | Y — inspection links to BOQ item/section | Y — configured failed hold point can block new valuation submission through a new command guard | Indirect — certificate issuance requires eligible valuation; no direct QC edit to certificate | Y — receipt inspection already exists; project inspection is separate and may reference receipt/site | Indirect — rework/return/issue remains through material command RPCs; no automatic stock movement |
| HSE | No direct financial/BOQ mutation; optional WBS/BOQ reference | No | No | Optional reference to PO/site only | Optional incident context only; never posts stock |
| Scheduling | Y — link task to BOQ section/work package | Indirect — actual progress may inform future valuation UI; valuation lines still require existing valuation RPC | Indirect through future valuation only | Indirect — planned need/delivery dates can be displayed, not auto-order | Indirect — planned tasks may propose material issues, but actual issues use the existing stock command |

Keep cross-feature effects one-way and command-mediated. Avoid database triggers that silently alter existing valuation, certificate, stock or journal data. Read-side widgets may aggregate; every financial/material mutation must reuse the existing command boundary or a new narrowly scoped RPC.

## 4. Implementation sequence and PR estimate

| Sub-Phase | Scope | Tables | Pages | RPCs | Est. PRs |
|---|---|---|---|---|---:|
| 5B-4a | Shared control attachments/audit contract and RFI lifecycle | `construction_project_rfis`, `construction_control_attachments` | RFI list/detail/create/answer | create, submit, assign, answer, close, list/report (new) | 2 |
| 5B-4b | Change-order proposals, approval chain, BOQ version bridge, cumulative contract delta report | `construction_change_orders`, `_items`, `_approvals` | Change-order register/detail/approval queue | draft/submit/approve/reject/implement + adjusted-contract report (new) | 3 |
| 5B-4c | Project Quality ITP inspections and HSE incidents/actions; keep receipt inspections separate | `construction_quality_inspections`, `_items`, `construction_hse_incidents`, `_corrective_actions` | Quality register/detail; HSE register/detail | inspection lifecycle/checklist; incident/action lifecycle/report (new) | 3 |
| 5B-4d | Scheduling MVP: WBS, dates, dependency graph, approved baseline and visual timeline | `construction_schedule_tasks`, `_dependencies`, `_baselines`, `_baseline_tasks` | Task list, timeline/Gantt-lite, baseline comparison | task CRUD/progress, dependencies, baseline save/approve, schedule rollup (new) | 3 |

**Total estimate: ~11 PRs** (small contracts-first PRs; excludes a full CPM engine). First PR in each slice should be schema/RLS/contract tests; second should be command RPCs and evidence tests; UI/analytics can follow. 5B-4c can split Quality and HSE if requirements diverge.

**Sequencing rationale:** RFIs have few dependencies and deliver early coordination value. Change Orders need stable reference/approval semantics before they can provide the authoritative cost/time change record; schedule can then snapshot approved time changes. HSE can ship independently and has high safety value. Quality should ship before any valuation hold-point coupling. Scheduling is independently useful as a WBS/date tool, but becomes more useful after CO baseline changes are explicit. Do not hold RFI/HSE for CPM.

## 5. UI/UX recommendations

All five surfaces should use existing project/site selectors and respect the same business context. Show tenant/project and Enterprise + Project-Based entitlement states. Record actors, times, reasons and evidence; distinguish “draft” from “submitted” and read-only historical states. Keep new deep links under the existing `/construction/*` wildcard and leave current URLs untouched.

| Area | List page | Detail page | Create/transition flow | Dashboard widgets |
|---|---|---|---|---|
| RFI | RFI number, subject, project/site, priority, assigned party, due date, status; filters for status/overdue/priority/BOQ | Question, references, chronological answer/activity, attachments, due/SLA, audit history | Draft → validate subject/question/refs → submit/assign → answer with evidence → close; warn before closing unanswered | Open; overdue; due this week; median response time; unanswered high-priority |
| Change Orders | Number, title/reason, status, cost/time delta, submit/decision date, approver | Scope summary, affected BOQ lines, attachment/evidence, approval steps, original vs adjusted contract, implementation/version link | Draft lines → submit → sequential approvals/rejection → implement into a new BOQ version; never edit old valuation/certificate | Pending approvals; approved cost delta; approved days added/removed; adjusted contract sum |
| Quality | Inspection ID/type, site/area, planned date, inspector, result/hold-point, linked BOQ | Checklist with per-item result, criteria, evidence, nonconformance/rectification and reinspection thread | Select project/site/BOQ → load or define snapshot checklist → record outcomes/photos → require rectification/reinspection for failed items → close | Planned inspections; failed/open hold points; overdue re-inspection; first-pass rate (once enough data) |
| HSE | Incident ref/type/severity/date/site/status, lost-time indicator only if allowed, open actions | Restricted incident narrative, persons/records, investigation, root cause, action owners/due dates, evidence and closure | Report near miss/injury/etc. quickly → investigator triages → create corrective actions → verify completion → close | Open incidents by severity; overdue corrective actions; days since lost-time incident only if owner/legal approval |
| Scheduling | WBS, task/milestone, planned/actual dates, % complete, owner, dependency/late badge | WBS tree, predecessor/successor, progress history, approved baseline vs current dates, BOQ section link | Create parent/task/milestone → dates/duration → dependencies with cycle check → save baseline → update actual progress | Overdue tasks; milestones due; completion vs baseline; dependency-blocked tasks; schedule variance |

**Scheduling UI choice:** do not add a Gantt dependency before scoping a third-party license/security footprint. MVP should be an accessible WBS table plus CSS/SVG timeline (dragless first), date/percent editing via validated commands, and simple FS dependencies. Consider `frappe-gantt`/`dhtmlx-gantt` only after license, bundle size, accessibility, timezone/calendar semantics and maintenance are reviewed. Do not claim critical path in MVP; CPM needs calendars, working-day holidays, lag/lead, multiple calendars, constraints, actual-progress rules, cycle handling and baseline semantics.

## 6. Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scheduling complexity exceeds scope | High | High | Cap MVP at WBS/date/progress/basic dependencies and immutable baseline snapshots; defer CPM, resource leveling and automatic date shifting. |
| Change Order ↔ Valuation circular dependency | Medium–High | High | Separate approval from implementation; approved CO creates a new BOQ version; valuations consume a one-way scope snapshot; no retroactive valuation/certificate rewrites. |
| Checklist flexibility vs simplicity | Medium | Medium–High | Snapshot structured checklist items per inspection; pilot fixed template set; version templates later; store per-item outcomes, not opaque JSONB only. |
| HSE requirements vary by jurisdiction | High | High | Owner/legal review for Malawi and any operating jurisdiction; configurable type/severity/reportable fields; minimal PII; no compliance claim until reviewed. |
| Cross-tenant/project foreign-key mismatch | Medium | High | Every command revalidates business/project/site/BOQ/contact scope; child rows carry tenant/project IDs consistently; tests include forged cross-business IDs. |
| UI gate mistaken for security | Medium | Critical | Enforce Enterprise + `PROJECT_BASED`, membership and capability in every RPC/RLS path; deny direct writes; add anonymous, wrong-plan, wrong-model and cross-tenant tests. |
| CO cost double-counted in contract/valuation/certificate | Medium | High | Keep original sum distinct from approved CO delta; snapshot each new valuation/certificate; idempotent implement command; reconciliation tests. |
| Personal injury/medical data exposure | Medium | High | Separate restricted details or avoid collection; least-privilege role and storage; audit access, retention/deletion schedule and incident export policy. |
| Attachment object leakage | Medium | High | Private storage; store object paths only; short-lived signed URLs after project entitlement/RLS check; test unauthorized IDs and user switching. |

## Open decisions for product/owner

1. RFI numbering prefix and sequence scope (project vs business); working-day/calendar-day SLA and who can respond (internal contacts vs external portal).
2. Change-order approval levels, monetary/time thresholds, authority roles, required evidence, and whether “approved” automatically permits implementation or needs a second action.
3. Contract display semantics: keep `contract_sum` as original and calculate adjusted contract in reports, or expose a new derived header without altering existing column semantics.
4. Whether approved CO changes create a fresh active BOQ version immediately; how proposed add/omit lines map to existing multi-level BOQ and the `project_boq_lines` valuation compatibility bridge.
5. Which inspection types/ITP templates/hold points are mandatory, and whether failed quality hold points block valuation submission in the first release.
6. HSE severity/reporting vocabulary, regulator notification requirements, lost-time definition, PII/medical scope, retention and access roles for Malawi and other target jurisdictions.
7. Scheduling workday calendar/timezone, date-only vs timestamp behavior, baseline approval rights, dependency types supported in MVP, and whether schedule variance is a contractual report.
8. Shared project capability codes for each control, and how Enterprise entitlement is queried server-side consistently with current billing infrastructure.
9. Attachment bucket and retention/virus-scanning policy, external-party access and audit/export requirements.

## Audit conclusion

The existing construction foundation provides durable project identity, BOQ versions, procurement evidence, valuations, certificates and retention. 5B-4 should add controls as separate, command-guarded domain tables. Use the existing project/site/BOQ/contact references, preserve all current route and RPC contracts, keep `PROJECT_BASED` as an explicit `text[]` gate, and make contract/valuation/schedule effects forward-only and auditable. Start with RFI, then approved Change Orders, ship Quality and HSE without coupling them to stock/GL, and finish with a deliberately limited WBS scheduling MVP.
