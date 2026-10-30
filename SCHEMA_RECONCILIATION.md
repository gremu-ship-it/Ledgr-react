# Schema Reconciliation — Construction Tables (Live vs App Code)

**Discovery snapshot:** `origin/main` at `0e2d5a080db56888c08f4ab036a5e44e41c42d1e`, inspected without switching the active Arena branch (`arena/d14e4c8f-ledgr-react`).

**Live schema snapshot:** Supabase project **Ledgr**, ref `hsuhuvuxfuufrlejsatw`, queried read-only on 2026-10-30. The account also has an active `ledgr-staging` project; that project was not queried. Confirm the intended target before running either SQL file. Its migration history already contains version `20261126000000`; the proposed migration is timestamped `20261127000000` so it sorts after the latest recorded version. No remote DDL, DML, migration, or migration-history change was performed. This file and the SQL files are proposed outputs only; the live SQL has not been executed.

## Executive finding

The app's canonical procurement and project-control storage is the existing `construction_*` family plus selected existing `project_*` tables. `src/` does not query the parallel manual tables `project_purchase_orders`, `project_goods_receipts`, `project_material_issues`, or `project_material_returns` (including their line tables). They are absent from `database.generated.ts` and from `origin/main` migrations. All eight were confirmed to have **0 rows** in the live database during discovery. A migration is provided that recounts them at execution time and drops them only if they are still empty, have RLS, and have no outside foreign-key consumer. It uses `RESTRICT`, never `CASCADE`.

`construction_sites` is not the app's canonical site table, but it is a live legacy table with RLS/policies and historical migration references; it is **preserved**. App and new Phase 5B-4 code should use `construction_procurement_sites` as the site record and `inventory_locations` for stock-location identity.

No new table, column, or compatibility view is needed for current `origin/main`. No pre-existing production `construction_*` schema is altered. The migration validates RLS and the read/write grant boundary rather than changing it.

## 1. App-code discovery (origin/main)

### Candidate table search

Searched all `src/**/*.ts` and `src/**/*.tsx` in the inspected `origin/main` snapshot for the ten requested table-name families, including `.from(...)` calls and generated types.

| Candidate name(s) | Runtime `.from(...)` / repository use | Files and observed fields / filters | Decision |
|---|---|---|---|
| `construction_sites` | **No runtime query.** Textual mentions are comments/tests, including an assertion that the migration must not alter it. | `src/lib/__tests__/constructionSiteLifecycleMigration.test.ts`, `src/pages/construction/subcontractsPersistence.test.ts`, comments in project/subcontract migrations. It is not a `public.Tables` entry. | Preserve the live legacy table. It is not interchangeable with the procurement site record; keep it out of new FK design. |
| `construction_procurement_sites` | Yes. Direct `LocationRepository` query and typed repository reads. | `src/dal/repositories/LocationRepository.ts`: `.select('id')`, filters `business_id`, `location_id`, `is_active`. `src/dal/repositories/ConstructionProcurementRepository.ts`: generic `.select('*')`, filters `business_id` and optional `project_id`, sort `site_code`; lifecycle reads include unlinked `project_id IS NULL`. | Canonical site record; keep. |
| `project_purchase_orders`, `project_purchase_order_lines` | No runtime query; absent from generated types and migrations. | No runtime `.from('project_purchase_orders')` or `.from('project_purchase_order_lines')` in `src/`. | Empty manual parallel tables; conditionally drop. |
| `construction_purchase_orders`, `construction_purchase_order_lines` | Yes, via typed generic read helper. Writes go through RPCs. | `ConstructionProcurementRepository.ts`: `SELECT *`, PO filters `business_id` / optional `project_id`, `created_at`; PO lines filter `po_id`, order `line_number`. | Canonical purchase orders/lines; keep. |
| `project_goods_receipts`, `project_goods_receipt_lines` | No runtime query; absent from generated types and migrations. | No runtime `.from(...)` use in `src/`. | Empty manual parallel tables; conditionally drop. |
| `construction_goods_receipt_notes`, `construction_goods_receipt_lines` | Yes, via typed generic read helper. Writes go through RPCs. | `ConstructionProcurementRepository.ts`: `SELECT *`, headers filter by `business_id`; lines filter `grn_id` or `business_id` and sort `line_number`. Project scoping is derived through the canonical project PO IDs. | Canonical GRN tables; keep. |
| `project_material_issues`, `project_material_issue_lines` | No runtime query; absent from generated types and migrations. | No runtime `.from(...)` use in `src/`. | Empty manual parallel tables; conditionally drop. |
| `construction_material_issues` | Yes, via typed generic read helper. Writes go through RPCs. | `ConstructionProcurementRepository.ts`: `SELECT *`, filters `business_id`, optional `project_id`, order `issued_at`. | Canonical append-only stock issue register; keep. |
| `project_material_returns`, `project_material_return_lines` | No runtime query; absent from generated types and migrations. | No runtime `.from(...)` use in `src/`. | Empty manual parallel tables; conditionally drop. |
| `construction_material_returns` | Yes, via typed generic read helper. Writes go through RPCs. | `ConstructionProcurementRepository.ts`: `SELECT *`, filters `business_id`, optional `project_id`, order `created_at`. | Canonical append-only stock return register; keep. |

The generic reader is implemented as `client.from(table).select('*')` in `ConstructionProcurementRepository.ts`; its call sites pass the canonical table names above. No direct insert/update/delete is performed against those core construction registers by the repository. The RPC command boundary is preserved.

### Other live app table queries relevant to construction

- `src/dal/repositories/ProjectRepository.ts`: `construction_projects` uses `SELECT *`, filters `business_id`, optional `status`, `id`; `project_boq_lines` uses `SELECT *`, filters `project_id`, orders `sort_order`; `project_valuations` reads `project_id` by valuation ID.
- `src/components/settings/LocationsTab.tsx`: `construction_projects` selects `id,name`, filters `business_id`, orders `name`.
- `src/dal/repositories/ConstructionCertificatesRepository.ts`: `payment_certificates` uses `SELECT *`, filters `business_id` and `project_id`, orders `certificate_number`.
- BOQ editor queries `products` and uses the existing BOQ APIs; it does not query the candidate `project_*` purchase/receipt/issue/return tables.
- `project_purchase_order_boq_links` is read through the typed construction procurement repository and written by `set_project_purchase_order_boq_link`; it is a legitimate, migration-backed table and is **not** part of the cleanup list.

## 2. Generated public table inventory

The following is the complete construction-related inventory found under `public.Tables` in `origin/main:src/dal/types/database.generated.ts`. Supabase's generated TypeScript mapping is `string` for SQL UUID/text/date/timestamp fields, `number` for numeric/integer/bigint fields, `boolean` for booleans, with nullable SQL columns marked `| null`. The field lists below are the exact generated `Row` names and their generated TypeScript types.

### `construction_*`

- `construction_delivery_note_lines`: `business_id string`, `created_at string`, `delivery_note_id string`, `id string`, `line_note string | null`, `line_number number`, `po_line_id string`, `product_id string`, `quantity_declared number`, `quantity_declared_base number`, `uom string`.
- `construction_delivery_notes`: `business_id string`, `client_key string`, `delivery_note_number string`, `document_date string`, `document_received_by string | null`, `evidence_reference string`, `exception_evidence string | null`, `exception_of string | null`, `exception_reason string | null`, `id string`, `is_exception boolean`, `normalized_reference string`, `notes string | null`, `po_id string`, `recorded_at string`, `recorded_by string`, `supplier_contact_id string`.
- `construction_goods_receipt_holds`: `business_id string`, `created_at string`, `created_by string`, `evidence_reference string`, `grn_line_id string`, `hold_type string`, `id string`, `quantity number`, `quantity_base number`, `reason string`, `release_reason string | null`, `released_at string | null`, `released_by string | null`, `status string`.
- `construction_goods_receipt_lines`: `accepted_base number`, `business_id string`, `created_at string`, `disputed_base number`, `grn_id string`, `id string`, `line_note string | null`, `line_number number`, `over_receipt_authorized_by string | null`, `over_receipt_evidence string | null`, `over_receipt_exception boolean`, `over_receipt_reason string | null`, `po_line_id string`, `product_id string`, `quantity_accepted number`, `quantity_disputed number`, `quantity_posted_base number`, `quantity_quarantined number`, `quantity_received number`, `quantity_rejected number`, `quarantined_base number`, `received_base number`, `rejected_base number`, `uom string`.
- `construction_goods_receipt_notes`: `branch_id string`, `business_id string`, `client_key string`, `created_at string`, `created_by string`, `delivery_note_id string | null`, `grn_number string`, `id string`, `location_id string`, `notes string | null`, `po_id string`, `project_ref string`, `receipt_date string`, `site_id string`.
- `construction_material_issues`: `branch_id string`, `business_id string`, `client_key string`, `currency string`, `evidence_reference string`, `id string`, `issue_date string`, `issued_at string`, `issued_by string`, `issued_to string | null`, `location_id string`, `notes string | null`, `product_id string`, `project_id string | null`, `project_ref string`, `quantity number`, `quantity_base number`, `site_id string`, `stock_movement_id string`, `total_cost_base number`, `unit_cost_base number`, `uom string`.
- `construction_material_returns`: `branch_id string`, `business_id string`, `client_key string`, `condition string`, `created_at string`, `created_by string`, `currency string`, `evidence_reference string`, `id string`, `location_id string`, `notes string | null`, `product_id string`, `project_id string | null`, `project_ref string`, `quantity number`, `quantity_base number`, `reason string`, `received_by string | null`, `return_date string`, `site_id string`, `source_issue_id string`, `stock_movement_id string`, `total_cost_base number`, `unit_cost_base number`, `uom string`.
- `construction_procurement_capabilities`: `code string`, `description string`.
- `construction_procurement_grants`: `business_id string`, `capability string`, `grant_reason string`, `granted_at string`, `granted_by string`, `id string`, `revoked_at string | null`, `revoked_by string | null`, `revoked_reason string | null`, `source string`, `user_id string`.
- `construction_procurement_sites`: `branch_id string`, `business_id string`, `created_at string`, `created_by string`, `id string`, `is_active boolean`, `location_id string`, `project_id string | null`, `project_ref string`, `site_code string`, `site_name string`, `updated_at string`.
- `construction_product_uom_conversions`: `approved_at string`, `approved_by string`, `business_id string`, `evidence_reference string`, `factor number`, `from_uom string`, `id string`, `is_active boolean`, `product_id string`, `to_uom string`.
- `construction_projects`: `boq_locked_at string | null`, `budget number`, `business_id string`, `client_id string | null`, `client_name string`, `contract_sum number`, `created_at string`, `created_by string`, `end_date string | null`, `id string`, `name string`, `retention_pct number`, `start_date string | null`, `status string`, `updated_at string`.
- `construction_purchase_order_events`: `action string`, `actor string | null`, `business_id string`, `created_at string`, `detail string | null`, `id number`, `po_id string`.
- `construction_purchase_order_lines`: `business_id string`, `created_at string`, `expected_unit_price number | null`, `id string`, `line_note string | null`, `line_number number`, `po_id string`, `product_id string`, `quantity_ordered number`, `quantity_ordered_base number`, `uom string`.
- `construction_purchase_orders`: `authorized_at string | null`, `authorized_by string | null`, `branch_id string`, `business_id string`, `cancel_reason string | null`, `cancelled_at string | null`, `cancelled_by string | null`, `client_key string`, `created_at string`, `created_by string`, `currency string`, `id string`, `notes string | null`, `po_number string`, `project_id string | null`, `project_ref string`, `site_id string`, `status string`, `supplier_contact_id string`, `updated_at string`.
- `construction_receipt_bill_allocations`: `bill_quantity number`, `bill_quantity_base number`, `bill_uom string`, `business_id string`, `client_key string`, `exception_evidence string | null`, `exception_reason string | null`, `expense_id string`, `expense_line_id string`, `grn_line_id string`, `id string`, `is_exception boolean`, `matched_at string`, `matched_by string`, `receipt_quantity number`, `receipt_quantity_base number`, `receipt_uom string`.
- `construction_receipt_cost_bases`: `allocation_id string`, `bill_unit_cost number | null`, `business_id string`, `claimed_at string`, `claimed_by string`, `client_key string`, `cost_currency string`, `discount_deducted number`, `evidence_reference string`, `exchange_rate_used number`, `expense_line_id string`, `grn_line_id string`, `id string`, `nonrecoverable_tax number`, `quantity_base number`, `unit_cost_base number`, `vat_recoverable boolean`.
- `construction_receipt_inspections`: `business_id string`, `certificate_reference string | null`, `client_key string`, `evidence_reference string`, `grn_line_id string`, `id string`, `inspected_at string`, `inspected_by string`, `inspection_date string`, `method string`, `notes string | null`, `outcome string`, `quantity_inspected number`, `quantity_inspected_base number`.
- `construction_receipt_line_reclassifications`: `accepted_after_base number`, `accepted_before_base number`, `business_id string`, `client_key string`, `evidence_reference string`, `from_bucket string`, `grn_line_id string`, `id string`, `inspection_id string`, `quantity number`, `quantity_base number`, `reason string`, `reclassified_at string`, `reclassified_by string`, `to_bucket string`.
- `construction_receipt_posting_policies`: `approved_at string | null`, `approved_by string | null`, `approved_evidence string | null`, `approved_reason string | null`, `business_id string`, `cost_basis_source string | null`, `gl_posting_enabled boolean`, `movement_posting_enabled boolean`, `updated_at string`.
- `construction_supplier_invoice_references`: `business_id string`, `exception_evidence string | null`, `exception_of string | null`, `exception_reason string | null`, `expense_id string`, `id string`, `recorded_at string`, `recorded_by string`, `reference_normalized string`, `reference_raw string`, `source string`, `status string`, `supplier_contact_id string`.

### Related generated project/BOQ/certificate/subcontract tables

- `boq_versions`: `business_id string`, `created_at string`, `created_by string | null`, `currency string`, `id string`, `notes string | null`, `project_id string`, `status string`, `total_value number`, `version_label string | null`, `version_number number`.
- `boq_sections`: `boq_version_id string`, `business_id string`, `code string`, `description string | null`, `id string`, `level number`, `parent_section_id string | null`, `sort_order number`, `title string`.
- `boq_items`: `amount number`, `boq_version_id string`, `business_id string`, `cost_code string | null`, `description string`, `id string`, `is_provisional boolean`, `item_number string`, `notes string | null`, `product_id string | null`, `quantity number`, `rate number`, `section_id string`, `sort_order number`, `unit_of_measure string`.
- `project_boq_lines`: `created_at string`, `description string`, `id string`, `line_number string`, `project_id string`, `quantity number`, `rate number`, `sort_order number`, `total_value number`, `unit string`, `updated_at string`.
- `project_purchase_order_boq_links`: `id string`, `business_id string`, `project_id string`, `purchase_order_line_id string`, `boq_item_id string`, `created_at string`, `created_by string | null`.
- `project_retention_ledger`: `amount number`, `created_at string`, `created_by string`, `description string | null`, `id string`, `invoice_id string | null`, `project_id string`, `type string`, `valuation_id string | null`.
- `project_status_log`: `changed_at string`, `changed_by string`, `from_status string`, `id string`, `project_id string`, `reason string | null`, `to_status string`.
- `project_valuation_lines`: `boq_line_id string`, `cumulative_pct number`, `cumulative_value number`, `id string`, `notes string | null`, `period_value number`, `previous_cumulative_value number`, `valuation_id string`.
- `project_valuations`: `created_at string`, `created_by string`, `gross_amount number`, `id string`, `invoice_id string | null`, `net_amount number`, `notes string | null`, `period_end string | null`, `period_start string | null`, `previous_cumulative number`, `project_id string`, `retention_amount number`, `status string`, `updated_at string`, `valuation_date string`, `valuation_number number`.
- `payment_certificates`: `advance_recovery number`, `business_id string`, `certificate_date string`, `certificate_number number`, `created_at string`, `created_by string`, `gross_amount number`, `id string`, `issued_to_contact_id string | null`, `net_amount number`, `notes string | null`, `other_deductions number`, `paid_amount number`, `paid_date string | null`, `payment_due_date string | null`, `penalty_deductions number`, `project_id string`, `retention_amount number`, `retention_percentage number`, `status string`, `total_retention_held number`, `updated_at string`, `valuation_id string`.
- `subcontractor_profiles`: `business_id string`, `compliance_notes string | null`, `contact_id string`, `created_at string`, `id string`, `insurance_expiry string | null`, `insurance_policy_number string | null`, `insurance_provider string | null`, `is_active boolean`, `license_expiry string | null`, `license_number string | null`, `preferred boolean`, `safety_rating string | null`, `trade string`, `updated_at string`.
- `subcontracts`: `business_id string`, `contract_value number`, `created_at string`, `created_by string | null`, `currency string`, `defects_liability_months number | null`, `description string | null`, `end_date string | null`, `id string`, `notes string | null`, `payment_terms string | null`, `project_id string`, `reference string`, `retention_percentage number | null`, `scope_of_work string | null`, `start_date string | null`, `status string`, `subcontractor_profile_id string`, `title string`, `updated_at string`.

The live inventory also contains `mrp_runs` and `mrp_recommendations`; they are in the requested verification scope, but they are not project-procurement tables and are not part of this reconciliation. The manual parallel tables are not represented in generated types.

## 3. Migration and live-schema findings

Reviewed the matching construction/procurement/project migrations on `origin/main`, including their CREATE/ALTER, RLS/policy, grant, trigger, and RPC changes:

- `20261020500000_stock_movement_type_construction_issue.sql` and `20261024000000_stock_movement_type_construction_return.sql`: extend the stock-movement vocabulary for the canonical issue/return commands; they do not create competing project header/line tables.
- `20261021000000_construction_procurement_traceability.sql`: canonical `construction_procurement_sites`, construction PO/line, delivery-note/line, GRN/line, issue, receipt quality/evidence and related command/RLS setup. Sites map to a branch and `inventory_locations`; commands use that explicit mapping.
- `20261023000000_construction_branch_scope.sql`: branch-scope additions/hardening.
- `20261025000000_construction_material_returns.sql` and `20261026000000_construction_return_command.sql`: canonical append-only construction material returns linked to the source issue and stock movement.
- `20261027000000_construction_operating_model_defaults.sql`: construction entitlement/capability defaults and provisioning; no competing operational tables.
- `20261028000000_construction_projects.sql` and `20261028000001_construction_projects_namespace.sql`: `construction_projects`/project status log and project linkage; canonical procurement rows receive nullable `project_id` columns. No change to `construction_sites` is made.
- `20261030000000_construction_project_boq.sql`: compatibility `project_boq_lines` schedule.
- `20261031000000_construction_retention_receivable_subtype.sql`: accounting subtype support, not a replacement procurement table.
- `20261031000001_construction_progress_valuations.sql` and `20261101000000_construction_project_reporting.sql`: project valuation/retention tables and reporting RPCs; RLS and grants keep table writes behind existing command boundaries.
- `20261107000000_construction_client_linkage.sql`: client linkage on `construction_projects` and command-function revisions.
- `20261108000000_construction_site_lifecycle.sql`: lifecycle for the canonical `construction_procurement_sites` table.
- `20261122000000_construction_multilevel_boq.sql`: versioned `boq_versions`, `boq_sections`, `boq_items`.
- `20261123000000_project_purchase_order_boq_links.sql`: explicitly links existing `construction_purchase_order_lines` to `boq_items`; it does not create another PO table.
- `20261125000000_payment_certificates.sql`: existing certificates reference project valuations.
- `20261117000000_subcontractor_profiles_and_subcontracts.sql` explicitly says to leave legacy `construction_sites` unchanged.

The current `origin/main` migration tree contains no creation of the eight manual `project_*` tables and does not create a table named `construction_sites`. That is not evidence that `construction_sites` is safe to remove: it is present in the live DB, has established RLS/policies and foreign keys from the manual issue/return tables, and a shipped migration explicitly leaves it unchanged.

### Live tables / row-count check

The live `public` inventory query returned 45 matching tables across the user-requested prefixes. Exact `count(*)` checks for the following candidates returned zero rows at discovery time:

| Live manual candidate | Rows at discovery | RLS | App/generated/migration status |
|---|---:|---|---|
| `project_purchase_orders` | 0 | enabled | unused; not generated or migration-backed |
| `project_purchase_order_lines` | 0 | enabled | unused; not generated or migration-backed |
| `project_goods_receipts` | 0 | enabled | unused; not generated or migration-backed |
| `project_goods_receipt_lines` | 0 | enabled | unused; not generated or migration-backed |
| `project_material_issues` | 0 | enabled | unused; not generated or migration-backed |
| `project_material_issue_lines` | 0 | enabled | unused; not generated or migration-backed |
| `project_material_returns` | 0 | enabled | unused; not generated or migration-backed |
| `project_material_return_lines` | 0 | enabled | unused; not generated or migration-backed |
| `construction_sites` | 0 | enabled | legacy/non-canonical table; preserve, not in the cleanup allow-list |

The eight `project_*` tables have internal parent/line FKs and FKs to existing business/project/site/product tables. The live catalog check found no non-candidate table referring to those eight tables; the migration repeats that check before dropping and uses `RESTRICT` as a second safety barrier. The remaining project tables such as `project_boq_lines`, `project_valuations`, `project_valuation_lines`, `project_status_log`, `project_retention_ledger`, and `project_purchase_order_boq_links` are real migration-backed app tables and are never named in the DROP list.

The parallel table shapes are not identical copies of canonical schemas (for example, manual lines have nullable `business_id`, while the production construction registers have required tenant scope, stock movement evidence, branch/site data and command-managed lifecycle). Therefore the decision is not to merge/copy rows or create compatibility views; it is to remove only the empty, unreferenced parallel table set.

### RLS and grants

Read-only catalog inspection found RLS enabled for every table in the requested construction/project/BOQ/payment/MRP/subcontract prefixes. Canonical `construction_*` tables other than the legacy `construction_sites` expose authenticated `SELECT` and have no direct anon read or authenticated `INSERT`/`UPDATE`/`DELETE` grants; writes are RPC-mediated. The migration validates these facts and aborts rather than changing pre-existing policies/grants if they drift.

The eight unused manual tables also have RLS enabled, but currently carry broad table-level privileges for `anon` and `authenticated` plus SELECT/INSERT/UPDATE/DELETE policies using `is_business_member(business_id)`. If any manual candidate gains data before the migration runs, the no-data-loss guard leaves **all eight** in place and emits a NOTICE; it does not attempt to fix their grants because they are unused and their data/consumers would need review first. Treat any such NOTICE as a manual security cleanup/ownership decision, not as a successful deletion.

`construction_sites` has authenticated and anon table-level privileges and business-membership policies. It is excluded from the migration's grant assertion and is not altered; review its historical security contract separately before any cleanup. Do not mistake RLS being enabled for a reason to use it as the new canonical site FK.

## 4. Reconciliation matrix

| App-code target | Canonical pre-existing table | Manual parallel table | Decision |
|---|---|---|---|
| Site | `construction_procurement_sites` (links branch + `location_id`, now also `project_id`) | `construction_sites` | Keep canonical `construction_procurement_sites`. Preserve the legacy `construction_sites`; do not create a view or alter it. |
| PO header | `construction_purchase_orders` | `project_purchase_orders` | Keep canonical table; drop manual table only if still empty and no external dependencies. |
| PO line | `construction_purchase_order_lines` | `project_purchase_order_lines` | Keep canonical line table; drop manual table only if still empty and no external dependencies. |
| GRN header | `construction_goods_receipt_notes` | `project_goods_receipts` | Keep canonical GRN table; drop manual table only if still empty and no external dependencies. |
| GRN line | `construction_goods_receipt_lines` | `project_goods_receipt_lines` | Keep canonical GRN line table; drop manual table only if still empty and no external dependencies. |
| Material issue | `construction_material_issues` | `project_material_issues` | Keep canonical stock-linked issue register; drop manual table only if still empty and no external dependencies. |
| Material issue line | Single issue header row per command; no canonical `construction_material_issue_lines` table | `project_material_issue_lines` | Do not create a replacement line table. Drop the unused manual line table only if still empty and no external dependencies. |
| Material return | `construction_material_returns` | `project_material_returns` | Keep canonical append-only stock-linked return register; drop manual table only if still empty and no external dependencies. |
| Material return line | Single return header row per command; no canonical `construction_material_return_lines` table | `project_material_return_lines` | Do not create a replacement line table. Drop the unused manual line table only if still empty and no external dependencies. |
| PO ↔ BOQ link | Canonical `project_purchase_order_boq_links` points to `construction_purchase_order_lines` | None | Keep. This is a real generated/migration-backed table, not the duplicate PO header set. |

## 5. Missing columns / new tables / views

No missing app-required columns were found in the canonical live tables:

- `construction_procurement_sites.project_id` exists and is nullable; `business_id`, `location_id`, `site_code`, and active state exist.
- `construction_purchase_orders.project_id` exists and is nullable; the canonical header has `site_id`, `branch_id`, `business_id`, supplier, status, idempotency key and lifecycle fields.
- `construction_material_issues.project_id` and `construction_material_returns.project_id` exist and are nullable; their stock movement, site/location, business and project reference fields exist.
- `construction_goods_receipt_notes` uses `project_ref` and canonical `po_id`, not a parallel `project_id`; app project filtering follows the canonical PO relation.

No `ALTER TABLE` is included because modifying existing construction production schemas is prohibited and unnecessary. No new table or view is needed. No TypeScript/generated-type update is included.

## 6. FK guidance for Phase 5B-4

Use these targets for new controls and avoid the legacy/manual names:

1. **Sites:** FK to `construction_procurement_sites(id)` for a project site. That row is the canonical construction site and carries `business_id`, optional `project_id`, `branch_id`, and `location_id`. Use `inventory_locations(id)` only when the FK means a stock ledger location, not a construction site. Do not target `construction_sites`.
2. **Purchase orders:** FK to `construction_purchase_orders(id)`; PO line references use `construction_purchase_order_lines(id)`. The existing `project_purchase_order_boq_links.purchase_order_line_id` already confirms this canonical linkage.
3. **Goods receipts:** FK to `construction_goods_receipt_notes(id)` and, where line-level evidence is required, `construction_goods_receipt_lines(id)`. These are procurement receipt records; project QC/ITP inspections are a separate domain and must not be conflated with GRN receipt inspection.
4. **Material issues:** FK to `construction_material_issues(id)`. There is no canonical issue-lines table; current issue command records one product/quantity per issue row.
5. **Material returns:** FK to `construction_material_returns(id)`; its `source_issue_id` references `construction_material_issues(id)`. There is no canonical return-lines table.
6. Every new 5B-4 tenant-owned table still needs `business_id`; enforce cross-business/project consistency in constraints/triggers/RPCs as designed. Do not reuse the manual nullable `business_id` line-table design.

## 7. Cleanup recommendation and execution behavior

1. Review `supabase/migrations/20261127000000_reconcile_construction_tables.sql` and the copy-paste companion `LIVE_SCHEMA_FIX.sql`.
2. The migration checks each candidate with runtime `SELECT count(*)` immediately before any DROP. If any one is non-empty, it retains all eight. It also verifies RLS, checks that no outside FK references the candidates, and uses `DROP TABLE IF EXISTS ... RESTRICT`; it never cascades.
3. Preserve `construction_sites`; do not add it to a wildcard cleanup. Keep the real migration-backed `project_*` tables listed above.
4. If the migration skips due data, inspect ownership and cross-references manually before deciding whether to migrate or remove the data. Review the manual tables' broad grants as a separate security decision.
5. The SQL was **not applied** to Supabase. Use a reviewed migration deployment for production; do not paste/run the live fix until the output is approved.

### Verification checklist

- [x] Current `origin/main` `src/` code inspected; none of the eight parallel project PO/receipt/issue/return tables is queried.
- [x] Canonical app table fields/filters exist in live schema and generated `Row` types.
- [x] No pre-existing construction table is altered; `construction_sites` is retained.
- [x] No new tables are introduced. Existing scoped-table RLS is asserted enabled.
- [x] Canonical construction read/write grants are validated without being changed.
- [x] 5B-4 FK guidance names the canonical site, PO, GRN, issue, and return records.
- [x] Candidate rows were counted read-only; all eight removable candidates were empty at discovery time, and SQL recounts before it can drop anything.
