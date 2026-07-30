-- Migration: increment_amount_paid RPC
-- Date: 2026-07-30
-- Purpose: Atomic increment of amount_paid for invoices and expenses
--
-- This RPC fixes a concurrency bug in the read-then-write pattern used by
-- InvoiceRepository.recordPayment() and ExpenseRepository.recordPayment().
-- Previously, two concurrent payments could both read the same stale
-- amount_paid value, causing one payment to be lost.
--
-- SQL equivalent:
--   UPDATE invoices SET amount_paid = amount_paid + $amount WHERE id = $id
--   UPDATE expenses SET amount_paid = amount_paid + $amount WHERE id = $id
--
-- Parameters:
--   p_table  - text: 'invoices' or 'expenses'
--   p_id     - uuid: record ID
--   p_amount - numeric: amount to add to amount_paid
--
-- Returns: void
-- Security: Uses SECURITY DEFINER to bypass RLS (called from authenticated context)

CREATE OR REPLACE FUNCTION increment_amount_paid(
  p_table text,
  p_id uuid,
  p_amount numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate table name to prevent SQL injection
  IF p_table NOT IN ('invoices', 'expenses') THEN
    RAISE EXCEPTION 'Invalid table name: %. Must be "invoices" or "expenses"', p_table;
  END IF;

  -- Validate amount is positive
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive, got %', p_amount;
  END IF;

  -- Execute atomic increment
  IF p_table = 'invoices' THEN
    UPDATE invoices
    SET amount_paid = amount_paid + p_amount
    WHERE id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invoice not found: %', p_id;
    END IF;
  ELSIF p_table = 'expenses' THEN
    UPDATE expenses
    SET amount_paid = amount_paid + p_amount
    WHERE id = p_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Expense not found: %', p_id;
    END IF;
  END IF;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_amount_paid(text, uuid, numeric) TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION increment_amount_paid(text, uuid, numeric) IS
  'Atomically increments amount_paid for invoices or expenses. '
  'Fixes concurrency bug in read-then-write payment recording. '
  'Parameters: p_table (invoices|expenses), p_id (record uuid), p_amount (positive numeric)';
