-- Phase 6E-1 — POS register metadata and shift surfaces.
--
-- Schema discovery (staging, 2026-11-04) confirmed that R08 already made
-- public.pos_terminals the durable register identity and that public.pos_shifts
-- is already linked to it. Shifts, cash movements, immutable close snapshots,
-- branch RLS, and open/close/cash-movement command RPCs are established and
-- protected. Extend the canonical terminal rather than creating a parallel
-- pos_registers / pos_shifts model or replacing the signed R08 command surface.
--
-- This project scopes POS data by businesses.business_id (not organisations).
-- Each DDL block is independently repeatable; the migration intentionally has
-- no outer transaction wrapper.

-- ── Register metadata ────────────────────────────────────────────────────────
ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS code text;

ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS default_cash_account_id uuid;

ALTER TABLE public.pos_terminals
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Give existing named tills stable, unique display codes without changing any
-- shift, sale, terminal, or cash data already attached to them.
UPDATE public.pos_terminals
   SET code = 'REG-' || upper(substr(replace(id::text, '-', ''), 1, 12))
 WHERE code IS NULL OR btrim(code) = '';

ALTER TABLE public.pos_terminals
  ALTER COLUMN code SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.pos_terminals'::regclass
       AND conname = 'pos_terminals_code_format_check'
  ) THEN
    ALTER TABLE public.pos_terminals
      ADD CONSTRAINT pos_terminals_code_format_check
      CHECK (code = upper(btrim(code)) AND code ~ '^[A-Z0-9_-]{1,48}$');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS pos_terminals_business_code_uidx
  ON public.pos_terminals (business_id, code);

-- A till may only point to a cash account owned by the same business. The
-- composite unique index is established by the accounting/payroll schema.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.pos_terminals'::regclass
       AND conname = 'pos_terminals_business_cash_account_fkey'
  ) THEN
    ALTER TABLE public.pos_terminals
      ADD CONSTRAINT pos_terminals_business_cash_account_fkey
      FOREIGN KEY (business_id, default_cash_account_id)
      REFERENCES public.accounts (business_id, id)
      ON DELETE SET NULL (default_cash_account_id);
  END IF;
END $$;

-- Existing pos_terminals RLS remains authoritative: members can read, while
-- can_admin_business_data(business_id) controls insert/update. The authenticated
-- role still has no DELETE grant. Keep updated_at current on edits.
CREATE OR REPLACE FUNCTION public.set_pos_terminal_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pos_terminals_set_updated_at ON public.pos_terminals;
CREATE TRIGGER pos_terminals_set_updated_at
  BEFORE UPDATE ON public.pos_terminals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pos_terminal_updated_at();

COMMENT ON COLUMN public.pos_terminals.code IS
  'Stable business-unique register code for POS register management.';
COMMENT ON COLUMN public.pos_terminals.default_cash_account_id IS
  'Optional cash account for this register; constrained to the same business.';

-- ── Preserve the R08 single-open invariants ───────────────────────────────────
-- These indexes are already installed by R08; keep them explicit here as the
-- invariant this phase depends on. No new direct-write shift RPCs are created.
CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_terminal
  ON public.pos_shifts (business_id, terminal_id)
  WHERE status = 'open' AND terminal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pos_shifts_one_open_per_cashier
  ON public.pos_shifts (business_id, cashier_id)
  WHERE status = 'open' AND terminal_id IS NOT NULL;

COMMENT ON TABLE public.pos_terminals IS
  'Durable POS register/till identity (R08). Phase 6E-1 adds stable register codes and a same-business default cash account; shifts continue to reference terminal_id and open/close only through the R08 command RPCs.';
