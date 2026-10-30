-- LIVE RPC GAP CHECK (read-only; safe to paste into Supabase SQL Editor)
-- Source snapshot: origin/main 0e2d5a080db56888c08f4ab036a5e44e41c42d1e.
-- Live target read-only checked: hsuhuvuxfuufrlejsatw; migration history through 20261126000000.
--
-- Discovery found all 136 current app RPC names in public.pg_proc. No function body needs
-- restoration on this target. This file intentionally contains NO CREATE OR REPLACE, DROP, or GRANT.
-- Replaying every historical migration function would overwrite live hardening fixes; blanket
-- GRANT EXECUTE to authenticated would expose private helpers and privileged operations.
-- Keep each migration's original REVOKE/GRANT ACL. In particular, backfill_and_recalculate_inventory
-- is intentionally service_role-only per 20261011000000_ic_contain_backfill_execute.sql and
-- 20261011000005_hardening_stock_cogs_backfill_grants.sql; do not grant it to authenticated.
--
-- Name clarifications from the request:
--   * `explode_bom` is not an app RPC; the current manufacturing helper is
--     `_mfg_execution_explode_order` (private), called inside the create-work-order path.
--   * `quick_save` is not the current RPC name; app calls save_quick_expense and save_quick_sale.
--   * `reserve_document_number` is not the current RPC name; app calls reserve_next_document_number.
-- A missing name reported below should be resolved by checking the exact target project and
-- migration version; do not copy an unrelated historical function into production.

-- App-call inventory: count overloads, signatures, and execute rights by role.
-- The one expected exception is backfill_and_recalculate_inventory (service_role only).
WITH expected(name) AS (
  VALUES
    ('_ledgr_resolve_construction_client'),
    ('accept_invitation'),
    ('act_on_approval'),
    ('add_partner_admin'),
    ('ai_context'),
    ('approve_construction_receipt_posting_policy'),
    ('approve_invoice'),
    ('authorize_construction_purchase_order'),
    ('authorize_pos_price_override'),
    ('backfill_and_recalculate_inventory'),
    ('bulk_upsert_boq_lines'),
    ('cancel_construction_purchase_order'),
    ('cancel_payment_certificate'),
    ('clear_partner_admins'),
    ('close_pos_shift_command'),
    ('complete_production_run'),
    ('construction_procurement_capabilities_for'),
    ('construction_procurement_open_items'),
    ('construction_project_material_cost'),
    ('convert_mrp_recommendation'),
    ('create_bank_reconciliation_matches'),
    ('create_boq_line'),
    ('create_business_with_owner'),
    ('create_certificate_from_valuation'),
    ('create_construction_purchase_order'),
    ('create_invoice_with_lines'),
    ('create_project'),
    ('create_project_purchase_order'),
    ('create_valuation'),
    ('create_work_order_from_bom'),
    ('delete_bank_reconciliation_match'),
    ('delete_boq_line'),
    ('delete_draft_bank_statement'),
    ('generate_cash_forecast'),
    ('generate_invoice_from_valuation'),
    ('get_approval_state'),
    ('get_bank_gl_book_balance'),
    ('get_bank_reconciliation_gl_lines'),
    ('get_boq_summary'),
    ('get_cost_breakdown_by_project'),
    ('get_dashboard_metrics'),
    ('get_portfolio_summary'),
    ('get_pos_shift_report'),
    ('get_project_cost_summary'),
    ('get_project_pnl'),
    ('get_project_valuation_trend'),
    ('get_retention_aging'),
    ('get_retention_summary'),
    ('get_trial_balance'),
    ('get_unreconciled_gl_lines'),
    ('get_valuation_history'),
    ('import_bank_statement'),
    ('increment_amount_paid'),
    ('invite_member'),
    ('issue_construction_materials_to_project'),
    ('issue_payment_certificate'),
    ('issue_project_materials'),
    ('ledgr_monthly_document_count'),
    ('link_site_to_project'),
    ('list_all_businesses'),
    ('list_partner_admins'),
    ('manufacturing_bom_activate'),
    ('manufacturing_bom_cost'),
    ('manufacturing_bom_new_version'),
    ('manufacturing_cost_variance'),
    ('manufacturing_dashboard_metrics'),
    ('manufacturing_production_summary'),
    ('manufacturing_throughput_trend'),
    ('manufacturing_wip_aging'),
    ('manufacturing_wo_cancel'),
    ('manufacturing_wo_close'),
    ('manufacturing_wo_complete'),
    ('manufacturing_wo_record_consumption'),
    ('manufacturing_wo_record_run'),
    ('manufacturing_wo_release'),
    ('manufacturing_wo_start'),
    ('manufacturing_yield_by_product'),
    ('match_construction_bill_line_to_receipt'),
    ('next_journal_entry_number'),
    ('open_pos_shift_command'),
    ('pos_stock_availability'),
    ('post_construction_receipt_movement'),
    ('post_pos_sale'),
    ('provision_construction_coa_accounts'),
    ('provision_construction_defaults'),
    ('provision_manufacturing_coa_accounts'),
    ('provision_manufacturing_defaults'),
    ('reclassify_construction_receipt_line'),
    ('reconcile_bank_statement'),
    ('reconcile_offline_queue_item'),
    ('record_business_terms_acceptance'),
    ('record_construction_delivery_note'),
    ('record_construction_delivery_note_exception'),
    ('record_construction_goods_receipt'),
    ('record_construction_receipt_cost_basis'),
    ('record_construction_receipt_inspection'),
    ('record_expense_payment'),
    ('record_inventory_journal_movement'),
    ('record_invoice_payment'),
    ('record_payment_certificate_payment'),
    ('record_pos_cash_movement_command'),
    ('record_sale_stock_and_cogs'),
    ('refund_pos_sale_command'),
    ('register_construction_procurement_site'),
    ('register_construction_product_uom_conversion'),
    ('register_construction_supplier_invoice_reference'),
    ('register_construction_supplier_invoice_reference_exception'),
    ('release_construction_receipt_hold'),
    ('release_retention'),
    ('remove_partner_admin'),
    ('reorder_boq_lines'),
    ('request_pos_approval'),
    ('request_pos_price_override'),
    ('requires_approval'),
    ('reserve_next_document_number'),
    ('resubmit_approval'),
    ('return_construction_materials_to_store'),
    ('return_project_materials'),
    ('run_mrp'),
    ('save_approval_workflow'),
    ('save_bom_version'),
    ('save_quick_expense'),
    ('save_quick_sale'),
    ('set_construction_procurement_site_status'),
    ('set_project_purchase_order_boq_link'),
    ('start_approval_workflow'),
    ('submit_valuation'),
    ('transition_project_status'),
    ('unlink_site_from_project'),
    ('unreconcile_bank_statement'),
    ('update_boq_line'),
    ('update_business_operating_models'),
    ('update_construction_procurement_site'),
    ('update_project'),
    ('update_valuation'),
    ('void_pos_sale_command')
),
actual AS (
  SELECT p.proname, p.oid,
         pg_get_function_identity_arguments(p.oid) AS args,
         p.prosecdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prokind = 'f'
)
SELECT e.name,
       count(a.oid)::integer AS overload_count,
       coalesce(string_agg(a.args, ' | ' ORDER BY a.args), '(MISSING)') AS signatures,
       coalesce(bool_or(has_function_privilege('authenticated', a.oid, 'EXECUTE')), false) AS authenticated_can_execute_any_overload,
       coalesce(bool_or(has_function_privilege('service_role', a.oid, 'EXECUTE')), false) AS service_role_can_execute_any_overload,
       CASE WHEN e.name = 'backfill_and_recalculate_inventory'
            THEN 'service_role only (intentional security boundary)'
            ELSE 'authenticated execution is expected for app RPC'
        END AS expected_access
  FROM expected e
  LEFT JOIN actual a ON a.proname = e.name
 GROUP BY e.name
 ORDER BY e.name;

-- Migration provenance (source definitions already exist on the inspected target):
-- Construction procurement: 20261021000000, 20261023000000, 20261025000000,
--   20261026000000, 20261028000000, 20261108000000, 20261123000000.
-- Project/valuation/certificate: 20261028000000, 20261030000000, 20261031000001,
--   20261101000000, 20261107000000, 20261125000000.
-- Manufacturing/MRP: 20261103000000 through 20261124000000.
-- Trial balance latest correction: 20261116000000_fix_trial_balance_opening_date_cast.sql.
-- Quick-save: 20260911000001 and 20260911000002.
-- The checked migration history includes these versions; verify any mismatched target before
-- considering a source-migration replay.

-- Run this after applying any separately reviewed repair to list all public functions.
SELECT proname, pronargs
FROM pg_proc
WHERE pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND prokind = 'f'
ORDER BY proname;
