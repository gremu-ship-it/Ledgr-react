-- P4B-2: matching safeguards, reconciliation status RPCs, and report data.
-- This migration uses the existing P4B-1 statement/match tables and the
-- discovered bank_statements.is_locked/reconciled_at status columns. It does
-- not alter legacy statement/line schemas or replace existing functions.

CREATE FUNCTION public.guard_bank_reconciliation_match_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement_id uuid;
  v_statement_business_id uuid;
  v_statement_locked boolean;
  v_reconciled_at timestamptz;
  v_statement_date date;
  v_period_start date;
  v_account_id uuid;
  v_bank_amount numeric;
  v_bank_signed_amount numeric;
  v_bank_line_reconciled boolean;
  v_journal_amount numeric;
  v_journal_is_debit boolean;
  v_journal_business_id uuid;
  v_journal_account_id uuid;
  v_journal_date date;
  v_journal_status text;
  v_journal_reconciled boolean;
  v_other_bank_matched numeric;
  v_other_gl_matched numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT s.id, s.business_id, s.is_locked, s.reconciled_at
      INTO v_statement_id, v_statement_business_id, v_statement_locked, v_reconciled_at
    FROM public.bank_statement_lines bsl
    JOIN public.bank_statements s ON s.id = bsl.statement_id
    WHERE bsl.id = OLD.statement_line_id
    FOR UPDATE OF s;
    IF NOT FOUND THEN
      -- Draft statement replacement/deletion cascades match rows after the
      -- referenced line is removed; the parent statement RPC already locks
      -- and authorizes that operation.
      IF pg_trigger_depth() > 1 THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'Statement line not found';
    END IF;
    IF coalesce(v_statement_locked, false) OR v_reconciled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Unreconcile the statement before changing matches';
    END IF;
    RETURN OLD;
  END IF;

  SELECT s.id, s.business_id, s.is_locked, s.reconciled_at, s.statement_date,
         coalesce(meta.period_start, date_trunc('month', s.statement_date)::date), ba.account_id,
         abs(coalesce(bsl.credit_amount, 0) - coalesce(bsl.debit_amount, 0)),
         coalesce(bsl.credit_amount, 0) - coalesce(bsl.debit_amount, 0),
         bsl.is_reconciled
    INTO v_statement_id, v_statement_business_id, v_statement_locked, v_reconciled_at,
         v_statement_date, v_period_start, v_account_id, v_bank_amount, v_bank_signed_amount,
         v_bank_line_reconciled
  FROM public.bank_statement_lines bsl
  JOIN public.bank_statements s ON s.id = bsl.statement_id
  JOIN public.bank_accounts ba ON ba.business_id = s.business_id AND ba.account_id = s.account_id
  LEFT JOIN public.bank_statement_import_metadata meta ON meta.statement_id = s.id
  WHERE bsl.id = NEW.statement_line_id
  FOR UPDATE OF s, bsl;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement line not found for the selected bank account';
  END IF;
  IF v_statement_business_id <> NEW.business_id THEN
    RAISE EXCEPTION 'Match must belong to the statement business';
  END IF;
  IF coalesce(v_statement_locked, false) OR v_reconciled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Unreconcile the statement before changing matches';
  END IF;
  IF v_bank_line_reconciled THEN
    RAISE EXCEPTION 'Legacy-reconciled statement lines cannot be rematched';
  END IF;
  IF NEW.matched_amount IS NULL OR NEW.matched_amount <= 0
     OR NEW.matched_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
    RAISE EXCEPTION 'Matched amount must be positive and finite';
  END IF;
  IF NEW.statement_line_id IS NULL OR NEW.journal_line_id IS NULL THEN
    RAISE EXCEPTION 'Both statement and journal lines are required';
  END IF;

  SELECT jl.business_id, jl.account_id, je.entry_date, je.status::text,
         jl.reconciled, abs(jl.amount), jl.is_debit
    INTO v_journal_business_id, v_journal_account_id, v_journal_date, v_journal_status,
         v_journal_reconciled, v_journal_amount, v_journal_is_debit
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.id = NEW.journal_line_id
  FOR UPDATE OF jl;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal line not found';
  END IF;
  IF v_journal_business_id <> NEW.business_id OR v_journal_account_id <> v_account_id THEN
    RAISE EXCEPTION 'Journal line must use the same business bank account';
  END IF;
  IF v_journal_status <> 'posted' OR v_journal_reconciled
     OR v_journal_date < v_period_start OR v_journal_date > v_statement_date THEN
    RAISE EXCEPTION 'Journal line is not eligible for this statement period';
  END IF;
  IF (v_bank_signed_amount > 0 AND NOT v_journal_is_debit)
     OR (v_bank_signed_amount < 0 AND v_journal_is_debit) THEN
    RAISE EXCEPTION 'Bank and journal lines must have the same cash-flow direction';
  END IF;
  IF v_bank_amount <= 0 OR NEW.matched_amount > v_bank_amount OR NEW.matched_amount > v_journal_amount THEN
    RAISE EXCEPTION 'Matched amount exceeds the available line amount';
  END IF;

  SELECT coalesce(sum(m.matched_amount), 0) INTO v_other_bank_matched
  FROM public.bank_reconciliation_matches m
  WHERE m.statement_line_id = NEW.statement_line_id
    AND (TG_OP <> 'UPDATE' OR m.id <> NEW.id);
  SELECT coalesce(sum(m.matched_amount), 0) INTO v_other_gl_matched
  FROM public.bank_reconciliation_matches m
  WHERE m.journal_line_id = NEW.journal_line_id
    AND (TG_OP <> 'UPDATE' OR m.id <> NEW.id);
  IF v_other_bank_matched + NEW.matched_amount > v_bank_amount
     OR v_other_gl_matched + NEW.matched_amount > v_journal_amount THEN
    RAISE EXCEPTION 'Match would exceed the remaining amount on a line';
  END IF;

  NEW.matched_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER bank_reconciliation_match_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.bank_reconciliation_matches
  FOR EACH ROW EXECUTE FUNCTION public.guard_bank_reconciliation_match_mutation();

REVOKE ALL ON FUNCTION public.guard_bank_reconciliation_match_mutation() FROM PUBLIC;

COMMENT ON FUNCTION public.guard_bank_reconciliation_match_mutation() IS
  'Enforces statement lock state, same-business/account scope, posted GL eligibility, and partial-match amount limits.';

CREATE FUNCTION public.create_bank_reconciliation_matches(
  p_business_id uuid,
  p_statement_id uuid,
  p_matches jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement public.bank_statements%ROWTYPE;
  v_item jsonb;
  v_bank_line_id uuid;
  v_journal_line_id uuid;
  v_matched_amount numeric;
  v_is_auto_match boolean;
  v_existing_match_id uuid;
  v_existing_amount numeric;
  v_existing_auto_match boolean;
  v_count integer := 0;
BEGIN
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to create bank reconciliation matches';
  END IF;
  IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_matches) = 0 THEN
    RAISE EXCEPTION 'At least one match is required';
  END IF;

  SELECT * INTO v_statement
  FROM public.bank_statements
  WHERE id = p_statement_id AND business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF coalesce(v_statement.is_locked, false) OR v_statement.reconciled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Unreconcile the statement before adding matches';
  END IF;

  FOR v_item IN
    SELECT item.value
    FROM jsonb_array_elements(p_matches) AS item(value)
    ORDER BY item.value->>'journal_line_id', item.value->>'statement_line_id'
  LOOP
    BEGIN
      v_bank_line_id := (v_item->>'statement_line_id')::uuid;
      v_journal_line_id := (v_item->>'journal_line_id')::uuid;
      v_matched_amount := (v_item->>'matched_amount')::numeric;
      v_is_auto_match := coalesce((v_item->>'is_auto_match')::boolean, false);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Invalid bank reconciliation match payload';
    END;
    IF v_matched_amount IS NULL OR v_matched_amount <= 0
       OR v_matched_amount::text IN ('NaN', 'Infinity', '-Infinity') THEN
      RAISE EXCEPTION 'Matched amount must be positive and finite';
    END IF;

    SELECT m.id, m.matched_amount, m.is_auto_match
      INTO v_existing_match_id, v_existing_amount, v_existing_auto_match
    FROM public.bank_reconciliation_matches m
    WHERE m.statement_line_id = v_bank_line_id AND m.journal_line_id = v_journal_line_id
    FOR UPDATE;

    IF FOUND THEN
      UPDATE public.bank_reconciliation_matches
      SET matched_amount = v_existing_amount + v_matched_amount,
          is_auto_match = v_existing_auto_match AND v_is_auto_match
      WHERE id = v_existing_match_id;
    ELSE
      INSERT INTO public.bank_reconciliation_matches (
        business_id, statement_line_id, journal_line_id, matched_amount, is_auto_match, matched_by
      ) VALUES (
        p_business_id, v_bank_line_id, v_journal_line_id, v_matched_amount, v_is_auto_match, auth.uid()
      );
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.create_bank_reconciliation_matches(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_bank_reconciliation_matches(uuid, uuid, jsonb) TO authenticated;

CREATE FUNCTION public.delete_bank_reconciliation_match(
  p_business_id uuid,
  p_match_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to delete bank reconciliation matches';
  END IF;
  DELETE FROM public.bank_reconciliation_matches
  WHERE id = p_match_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank reconciliation match not found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_bank_reconciliation_match(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_bank_reconciliation_match(uuid, uuid) TO authenticated;

CREATE FUNCTION public.reconcile_bank_statement(
  p_business_id uuid,
  p_statement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement public.bank_statements%ROWTYPE;
  v_unmatched_bank integer;
BEGIN
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorized to reconcile bank statements';
  END IF;
  SELECT * INTO v_statement
  FROM public.bank_statements
  WHERE id = p_statement_id AND business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF coalesce(v_statement.is_locked, false) OR v_statement.reconciled_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_reconciled');
  END IF;

  SELECT count(*)::integer INTO v_unmatched_bank
  FROM public.bank_statement_lines bsl
  WHERE bsl.statement_id = p_statement_id
    AND bsl.is_reconciled = false
    AND abs(coalesce(bsl.credit_amount, 0) - coalesce(bsl.debit_amount, 0)) > coalesce((
      SELECT sum(m.matched_amount)
      FROM public.bank_reconciliation_matches m
      WHERE m.statement_line_id = bsl.id
    ), 0);

  UPDATE public.bank_statements
  SET is_locked = true, reconciled_at = now()
  WHERE id = p_statement_id AND business_id = p_business_id;

  RETURN jsonb_build_object('status', 'ok', 'unmatched_bank_lines', v_unmatched_bank);
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_bank_statement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_bank_statement(uuid, uuid) TO authenticated;

CREATE FUNCTION public.unreconcile_bank_statement(
  p_business_id uuid,
  p_statement_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_statement public.bank_statements%ROWTYPE;
BEGIN
  IF NOT public.can_admin_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Admin permission required to unreconcile';
  END IF;
  SELECT * INTO v_statement
  FROM public.bank_statements
  WHERE id = p_statement_id AND business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Statement not found';
  END IF;
  IF NOT coalesce(v_statement.is_locked, false) AND v_statement.reconciled_at IS NULL THEN
    RETURN jsonb_build_object('status', 'already_draft');
  END IF;

  UPDATE public.bank_statements
  SET is_locked = false, reconciled_at = NULL
  WHERE id = p_statement_id AND business_id = p_business_id;
  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE ALL ON FUNCTION public.unreconcile_bank_statement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unreconcile_bank_statement(uuid, uuid) TO authenticated;

CREATE FUNCTION public.get_bank_reconciliation_gl_lines(
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
  account_id uuid,
  matched_amount numeric
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
  WHERE ba.id = p_bank_account_id AND ba.business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_from > p_date_to THEN
    RAISE EXCEPTION 'Invalid GL date range';
  END IF;

  RETURN QUERY
  SELECT jl.id, je.entry_date, coalesce(jl.description, je.description), je.entry_number,
         jl.is_debit, abs(jl.amount), jl.account_id,
         coalesce(sum(m.matched_amount), 0)::numeric
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  LEFT JOIN public.bank_reconciliation_matches m
    ON m.journal_line_id = jl.id AND m.business_id = p_business_id
  WHERE jl.business_id = p_business_id
    AND je.business_id = p_business_id
    AND jl.account_id = v_account_id
    AND je.status = 'posted'
    AND je.entry_date BETWEEN p_date_from AND p_date_to
    AND jl.reconciled = false
  GROUP BY jl.id, je.entry_date, jl.description, je.description, je.entry_number,
           jl.is_debit, jl.amount, jl.account_id
  ORDER BY je.entry_date, je.entry_number;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bank_reconciliation_gl_lines(uuid, uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bank_reconciliation_gl_lines(uuid, uuid, date, date) TO authenticated;

CREATE FUNCTION public.get_bank_gl_book_balance(
  p_business_id uuid,
  p_bank_account_id uuid,
  p_as_of_date date
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_balance numeric;
BEGIN
  SELECT ba.account_id INTO v_account_id
  FROM public.bank_accounts ba
  WHERE ba.id = p_bank_account_id AND ba.business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank account not found';
  END IF;
  IF p_as_of_date IS NULL THEN
    RAISE EXCEPTION 'Balance date is required';
  END IF;

  SELECT coalesce(sum(CASE WHEN jl.is_debit THEN abs(jl.amount) ELSE -abs(jl.amount) END), 0)
    INTO v_balance
  FROM public.journal_lines jl
  JOIN public.journal_entries je ON je.id = jl.journal_entry_id
  WHERE jl.business_id = p_business_id
    AND je.business_id = p_business_id
    AND jl.account_id = v_account_id
    AND je.status = 'posted'
    AND je.entry_date <= p_as_of_date;
  RETURN v_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.get_bank_gl_book_balance(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_bank_gl_book_balance(uuid, uuid, date) TO authenticated;
