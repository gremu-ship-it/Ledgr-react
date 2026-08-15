-- ============================================================================
-- Phase 8B — Fix defaults shadowed by the Phase 8A.1 base migration
-- ============================================================================
--
-- PROBLEM
--   The Phase 8A.1 base migration (20250101000000_base_schema.sql) created
--   several NOT NULL columns from the live-staging-derived types WITHOUT the
--   defaults that incremental migrations already specify for those columns.
--   Because the incremental migrations use `add column if not exists`, they
--   became no-ops on the fresh database, leaving the columns NOT NULL with no
--   default:
--
--     user_profiles.is_platform_admin    (intended default false —
--                                         20260726000004_platform_admin_and_reminders.sql)
--     invoices.rate_is_stale             (intended default false — IAS21,
--     invoice_payments.rate_is_stale      20260727000000_multi_currency_ias21.sql)
--     expenses.rate_is_stale
--     expense_payments.rate_is_stale
--     journal_lines.rate_is_stale
--
--   Confirmed on the live staging capture (2026-08-15): all six columns are
--   NOT NULL with default NULL, so any client insert that omits them fails.
--
-- FIX
--   Restore the defaults exactly as the incremental migrations declared them.
--   Idempotent; safe on every environment (the legacy database already has
--   these defaults, so this is a no-op there).
-- ============================================================================

alter table public.user_profiles
  alter column is_platform_admin set default false;

alter table public.invoices
  alter column rate_is_stale set default false;

alter table public.invoice_payments
  alter column rate_is_stale set default false;

alter table public.expenses
  alter column rate_is_stale set default false;

alter table public.expense_payments
  alter column rate_is_stale set default false;

alter table public.journal_lines
  alter column rate_is_stale set default false;

-- Also pin the same defaults on the base columns the IAS21 migration
-- shadowed for the original-currency snapshot columns (functional columns
-- are nullable, so nothing to fix there).
