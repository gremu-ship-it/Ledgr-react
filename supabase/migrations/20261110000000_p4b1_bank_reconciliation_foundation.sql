-- P4B-1: Bank reconciliation account setup and atomic statement import.
--
-- Schema discovery found bank_statements and bank_statement_lines already exist
-- and are used by the legacy /bank-reconcile route. They are intentionally not
-- altered here (including their existing policies and locked-line trigger).
-- bank_statements.account_id + its existing UNIQUE(business_id, account_id,
-- statement_date) constraint provide the idempotency key for a mapped bank
-- account. Existing statement line debit_amount/credit_amount/balance columns
-- are used for signed amounts and running balances.

CREATE TABLE public.bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT,
  bank_name text NOT NULL CHECK (length(btrim(bank_name)) > 0),
  account_number text NOT NULL CHECK (length(btrim(account_number)) > 0),
  branch_name text,
  currency text NOT NULL DEFAULT 'MWK',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, account_id)
);

CREATE INDEX idx_bank_accounts_business ON public.bank_accounts(business_id);

COMMENT ON TABLE public.bank_accounts IS
  'Maps CoA cash/bank accounts to real bank account details for reconciliation.';

-- The legacy bank_statements table has no period_start column. Store the
-- selected start date in a sidecar so its existing schema remains untouched.
CREATE TABLE public.bank_statement_import_metadata (
  statement_id uuid PRIMARY KEY REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_statement_import_metadata_business
  ON public.bank_statement_import_metadata(business_id);

COMMENT ON TABLE public.bank_statement_import_metadata IS
  'P4B import metadata not represented by the pre-existing bank_statements schema.';

CREATE TABLE public.bank_reconciliation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  statement_line_id uuid NOT NULL
    REFERENCES public.bank_statement_lines(id) ON DELETE CASCADE,
  journal_line_id uuid NOT NULL
    REFERENCES public.journal_lines(id) ON DELETE RESTRICT,
  matched_amount numeric(18,4) NOT NULL CHECK (matched_amount > 0),
  is_auto_match boolean NOT NULL DEFAULT false,
  matched_by uuid NOT NULL REFERENCES auth.users(id),
  matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (statement_line_id, journal_line_id)
);

CREATE INDEX idx_bank_recon_matches_statement
  ON public.bank_reconciliation_matches(statement_line_id);
CREATE INDEX idx_bank_recon_matches_journal
  ON public.bank_reconciliation_matches(journal_line_id);

COMMENT ON TABLE public.bank_reconciliation_matches IS
  'P4B-2-ready relation between statement and GL lines; matching UI is not included in P4B-1.';

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_statement_import_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_reconciliation_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY bank_accounts_member_read ON public.bank_accounts
  FOR SELECT TO authenticated
  USING (is_business_member(business_id));
CREATE POLICY bank_accounts_writer_insert ON public.bank_accounts
  FOR INSERT TO authenticated
  WITH CHECK (can_write_business_data(business_id));
CREATE POLICY bank_accounts_writer_update ON public.bank_accounts
  FOR UPDATE TO authenticated
  USING (can_write_business_data(business_id))
  WITH CHECK (can_write_business_data(business_id));
CREATE POLICY bank_accounts_admin_delete ON public.bank_accounts
  FOR DELETE TO authenticated
  USING (can_admin_business_data(business_id));

CREATE POLICY bank_statement_import_metadata_member_read
  ON public.bank_statement_import_metadata
  FOR SELECT TO authenticated
  USING (is_business_member(business_id));
CREATE POLICY bank_statement_import_metadata_writer_insert
  ON public.bank_statement_import_metadata
  FOR INSERT TO authenticated
  WITH CHECK (can_write_business_data(business_id));
CREATE POLICY bank_statement_import_metadata_writer_update
  ON public.bank_statement_import_metadata
  FOR UPDATE TO authenticated
  USING (can_write_business_data(business_id))
  WITH CHECK (can_write_business_data(business_id));
CREATE POLICY bank_statement_import_metadata_admin_delete
  ON public.bank_statement_import_metadata
  FOR DELETE TO authenticated
  USING (can_admin_business_data(business_id));

CREATE POLICY bank_recon_matches_member_read ON public.bank_reconciliation_matches
  FOR SELECT TO authenticated
  USING (is_business_member(business_id));
CREATE POLICY bank_recon_matches_writer_insert ON public.bank_reconciliation_matches
  FOR INSERT TO authenticated
  WITH CHECK (can_write_business_data(business_id));
CREATE POLICY bank_recon_matches_writer_delete ON public.bank_reconciliation_matches
  FOR DELETE TO authenticated
  USING (can_write_business_data(business_id));

CREATE FUNCTION public.guard_bank_account_business_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_business_id uuid;
  v_account_code text;
  v_account_type text;
  v_is_group boolean;
BEGIN
  SELECT business_id, code, account_type::text, is_group
    INTO v_account_business_id, v_account_code, v_account_type, v_is_group
  FROM public.accounts
  WHERE id = NEW.account_id;

  IF v_account_business_id IS NULL OR v_account_business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'Linked chart-of-accounts record must belong to the same business';
  END IF;
  IF v_account_type <> 'asset' OR v_is_group OR
     (v_account_code NOT LIKE '111%' AND v_account_code NOT LIKE '112%') THEN
    RAISE EXCEPTION 'Bank accounts must link to a cash or bank asset account';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_account_business_scope_guard
  BEFORE INSERT OR UPDATE OF business_id, account_id ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_account_business_scope();

CREATE FUNCTION public.guard_bank_statement_metadata_business_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement_business_id uuid;
BEGIN
  SELECT business_id INTO v_statement_business_id
  FROM public.bank_statements
  WHERE id = NEW.statement_id;
  IF v_statement_business_id IS NULL OR v_statement_business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'Statement metadata must belong to the same business as its statement';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_statement_metadata_business_scope_guard
  BEFORE INSERT OR UPDATE OF statement_id, business_id
  ON public.bank_statement_import_metadata
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_statement_metadata_business_scope();

CREATE TRIGGER set_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Keep future P4B-2 matches inside one business without changing existing
-- statement/journal tables or their RLS policies.
CREATE FUNCTION public.guard_bank_reconciliation_match_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement_business_id uuid;
  v_journal_business_id uuid;
BEGIN
  SELECT business_id INTO v_statement_business_id
  FROM public.bank_statement_lines
  WHERE id = NEW.statement_line_id;

  SELECT business_id INTO v_journal_business_id
  FROM public.journal_lines
  WHERE id = NEW.journal_line_id;

  IF v_statement_business_id IS NULL OR v_statement_business_id <> NEW.business_id
     OR v_journal_business_id IS NULL OR v_journal_business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'Bank reconciliation match must reference lines in the same business';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_reconciliation_match_business_guard
  BEFORE INSERT OR UPDATE ON public.bank_reconciliation_matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_reconciliation_match_business();

COMMENT ON FUNCTION public.guard_bank_reconciliation_match_business() IS
  'Prevents a bank reconciliation match from crossing business boundaries.';

-- Import through one transaction so a malformed insert cannot leave a partial
-- statement. The existing bank_statements unique key makes repeated imports
-- for the same business/account/date update the draft statement and replace its
-- lines rather than duplicating it.
CREATE FUNCTION public.import_bank_statement(
  p_business_id uuid,
  p_bank_account_id uuid,
  p_statement_date date,
  p_period_start date,
  p_opening_balance numeric,
  p_closing_balance numeric,
  p_lines jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_statement_id uuid;
  v_line jsonb;
  v_line_date date;
  v_description text;
  v_amount numeric;
  v_balance numeric;
  v_reference text;
BEGIN
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to import bank statements';
  END IF;
  IF p_statement_date IS NULL OR p_period_start IS NULL OR p_period_start > p_statement_date THEN
    RAISE EXCEPTION 'Invalid statement period';
  END IF;
  IF p_opening_balance IS NULL OR p_closing_balance IS NULL THEN
    RAISE EXCEPTION 'Statement balances are required';
  END IF;
  IF jsonb_typeof(p_lines) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Statement lines must be an array';
  END IF;
  IF jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'A statement must contain at least one transaction';
  END IF;

  SELECT account_id INTO v_account_id
  FROM public.bank_accounts
  WHERE id = p_bank_account_id
    AND business_id = p_business_id
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active bank account not found';
  END IF;

  -- Validate every line before touching the existing or new statement.
  FOR v_line IN SELECT item.value FROM jsonb_array_elements(p_lines) AS item(value) LOOP
    BEGIN
      v_line_date := (v_line->>'transaction_date')::date;
      v_amount := (v_line->>'amount')::numeric;
      v_balance := NULLIF(v_line->>'running_balance', '')::numeric;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid date or amount in imported statement line';
    END;
    v_description := btrim(coalesce(v_line->>'description', ''));
    IF v_line_date IS NULL OR v_line_date < p_period_start OR v_line_date > p_statement_date THEN
      RAISE EXCEPTION 'Statement line date is outside the selected period';
    END IF;
    IF v_description = '' OR v_amount IS NULL
       OR v_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Statement lines require a description and finite amount';
    END IF;
    IF v_balance IS NOT NULL AND v_balance::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Statement line balance must be finite';
    END IF;
  END LOOP;

  INSERT INTO public.bank_statements (
    business_id, account_id, statement_date, opening_balance, closing_balance, source, uploaded_by
  ) VALUES (
    p_business_id, v_account_id, p_statement_date, p_opening_balance, p_closing_balance,
    'csv_import', auth.uid()::text
  )
  ON CONFLICT (business_id, account_id, statement_date)
  DO UPDATE SET
    opening_balance = EXCLUDED.opening_balance,
    closing_balance = EXCLUDED.closing_balance,
    source = EXCLUDED.source,
    uploaded_by = EXCLUDED.uploaded_by
  WHERE NOT bank_statements.is_locked
    AND bank_statements.reconciled_at IS NULL
  RETURNING id INTO v_statement_id;

  IF v_statement_id IS NULL THEN
    RAISE EXCEPTION 'A reconciled statement cannot be re-imported';
  END IF;

  DELETE FROM public.bank_statement_lines
  WHERE statement_id = v_statement_id AND business_id = p_business_id;

  INSERT INTO public.bank_statement_import_metadata(statement_id, business_id, period_start)
  VALUES (v_statement_id, p_business_id, p_period_start)
  ON CONFLICT (statement_id)
  DO UPDATE SET business_id = EXCLUDED.business_id, period_start = EXCLUDED.period_start;

  FOR v_line IN SELECT item.value FROM jsonb_array_elements(p_lines) AS item(value) LOOP
    v_line_date := (v_line->>'transaction_date')::date;
    v_description := btrim(v_line->>'description');
    v_amount := (v_line->>'amount')::numeric;
    v_balance := NULLIF(v_line->>'running_balance', '')::numeric;
    v_reference := NULLIF(btrim(coalesce(v_line->>'reference', '')), '');

    INSERT INTO public.bank_statement_lines (
      statement_id, business_id, transaction_date, description, reference,
      debit_amount, credit_amount, balance, is_reconciled
    ) VALUES (
      v_statement_id, p_business_id, v_line_date, v_description, v_reference,
      CASE WHEN v_amount < 0 THEN abs(v_amount) ELSE 0 END,
      CASE WHEN v_amount > 0 THEN v_amount ELSE 0 END,
      v_balance,
      false
    );
  END LOOP;

  RETURN v_statement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_bank_statement(uuid, uuid, date, date, numeric, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_bank_statement(uuid, uuid, date, date, numeric, numeric, jsonb) TO authenticated;

CREATE FUNCTION public.delete_draft_bank_statement(p_business_id uuid, p_statement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked boolean;
  v_reconciled_at timestamptz;
BEGIN
  IF NOT public.can_admin_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to delete bank statements';
  END IF;

  SELECT is_locked, reconciled_at INTO v_locked, v_reconciled_at
  FROM public.bank_statements
  WHERE id = p_statement_id AND business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank statement not found';
  END IF;
  IF coalesce(v_locked, false) OR v_reconciled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only draft statements can be deleted';
  END IF;

  DELETE FROM public.bank_statement_lines
  WHERE statement_id = p_statement_id AND business_id = p_business_id;
  DELETE FROM public.bank_statements
  WHERE id = p_statement_id AND business_id = p_business_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_draft_bank_statement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_draft_bank_statement(uuid, uuid) TO authenticated;

-- Phase 4B-2 matching query helper. journal_entries.status is the journal_status
-- enum with the evidenced posted value; journal_lines.reconciled is the legacy
-- single-match marker and is respected alongside the new many-to-many table.
CREATE FUNCTION public.get_unreconciled_gl_lines(
  p_business_id uuid,
  p_bank_account_id uuid,
  p_date_from date,
  p_date_to date
)
RETURNS TABLE (
  journal_line_id uuid,
  entry_date date,
  description text,
  entry_number text,
  is_debit boolean,
  amount numeric,
  account_id uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT ba.account_id INTO v_account_id
  FROM public.bank_accounts ba
  WHERE ba.id = p_bank_account_id
    AND ba.business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid GL date range';
  END IF;

  RETURN QUERY
  SELECT jl.id, je.entry_date, coalesce(jl.description, je.description), je.entry_number,
         jl.is_debit, jl.amount, jl.account_id
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE je.business_id = p_business_id
    AND jl.business_id = p_business_id
    AND je.status = 'posted'
    AND jl.account_id = v_account_id
    AND je.entry_date BETWEEN p_date_from AND p_date_to
    AND jl.reconciled = false
    AND NOT EXISTS (
      SELECT 1 FROM public.bank_reconciliation_matches m
      WHERE m.business_id = p_business_id AND m.journal_line_id = jl.id
    )
  ORDER BY je.entry_date, je.entry_number;
END;
$$;

REVOKE ALL ON FUNCTION public.get_unreconciled_gl_lines(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_unreconciled_gl_lines(uuid, uuid, date, date) TO authenticated;

COMMENT ON FUNCTION public.get_unreconciled_gl_lines(uuid, uuid, date, date) IS
  'P4B-2 helper: returns visible posted GL lines for an active bank account that have not been reconciled or matched.';
