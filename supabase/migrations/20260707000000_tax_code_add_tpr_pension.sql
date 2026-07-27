-- ============================================================================
-- Migration: add 'tpr_pension' to the tax_code enum
--
-- WHY THIS IS ITS OWN FILE:
-- Postgres allows ALTER TYPE ... ADD VALUE inside a transaction (PG12+), but
-- forbids *using* the new value in that same transaction. The Supabase CLI
-- wraps each migration file in a single transaction, so adding the value and
-- then INSERTing a row that uses it in one file fails with:
--
--   ERROR: unsafe use of new value "tpr_pension" of enum type tax_code
--
-- Splitting the ADD VALUE into this earlier-dated file means it is committed
-- before 20260708000000_tax_compliance_module.sql runs and seeds a
-- tax_configurations row with tax_code = 'tpr_pension'.
--
-- Idempotent: `if not exists` makes this safe to re-run, and safe on
-- environments where the value was already added out-of-band.
-- ============================================================================

alter type tax_code add value if not exists 'tpr_pension';
