-- ============================================================================
-- Migration: Add Exhaustive Specialized Roles to user_role Enum
-- Adds: purchasing_officer, warehouse_worker, sales_manager, customer_service_rep,
--       tax_compliance_officer, treasury_manager, asset_manager, board_member, branch_manager
-- ============================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'purchasing_officer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'warehouse_worker';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'sales_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'customer_service_rep';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'tax_compliance_officer';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'treasury_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'asset_manager';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'board_member';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'branch_manager';
