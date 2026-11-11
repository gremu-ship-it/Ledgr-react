-- Journal entries and their lines are command-only under RLS. Keep reversal
-- creation, posting, and source marking inside one authorized transaction
-- instead of attempting client-side INSERT/UPDATE requests.
CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_original_id uuid,
  p_entry_number text,
  p_reversal_date date,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_original public.journal_entries%ROWTYPE;
  v_reversal_id uuid;
  v_period_id uuid;
  v_line record;
  v_line_number integer := 0;
  v_total_debits numeric := 0;
  v_total_credits numeric := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to reverse a journal entry.'
      USING ERRCODE = '42501';
  END IF;
  IF p_entry_number IS NULL OR btrim(p_entry_number) = '' THEN
    RAISE EXCEPTION 'A journal entry number is required for the reversal.'
      USING ERRCODE = '22023';
  END IF;
  IF p_reversal_date IS NULL THEN
    RAISE EXCEPTION 'A reversal date is required.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to reverse a journal entry.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_original
  FROM public.journal_entries
  WHERE id = p_original_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % was not found.', p_original_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.can_write_financial_data(v_original.business_id) THEN
    RAISE EXCEPTION 'You do not have permission to reverse journal entries for this business.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT (
    public.is_platform_admin(v_user_id)
    OR public.can_access_branch(v_original.business_id, v_original.branch_id)
  ) THEN
    RAISE EXCEPTION 'You do not have access to the journal entry branch.'
      USING ERRCODE = '42501';
  END IF;
  IF v_original.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted journal entries can be reversed (current status: %).', v_original.status
      USING ERRCODE = '55000';
  END IF;
  IF v_original.reversed_by IS NOT NULL THEN
    RAISE EXCEPTION 'Journal entry % has already been reversed.', p_original_id
      USING ERRCODE = '55000';
  END IF;
  IF v_original.reversal_of IS NOT NULL THEN
    RAISE EXCEPTION 'A reversal journal entry cannot itself be reversed.'
      USING ERRCODE = '55000';
  END IF;

  SELECT ap.id INTO v_period_id
  FROM public.accounting_periods ap
  WHERE ap.business_id = v_original.business_id
    AND p_reversal_date BETWEEN ap.period_start AND ap.period_end
  ORDER BY ap.period_start DESC
  LIMIT 1;

  INSERT INTO public.journal_entries (
    business_id, branch_id, department_id, entry_number, entry_date,
    description, source_type, source_id, currency, exchange_rate,
    status, reversal_of, created_by, period_id
  ) VALUES (
    v_original.business_id, v_original.branch_id, v_original.department_id,
    btrim(p_entry_number), p_reversal_date,
    'Reversal of ' || v_original.entry_number || ': ' || COALESCE(v_original.description, ''),
    'reversal', v_original.source_id, v_original.currency, v_original.exchange_rate,
    'draft', v_original.id, v_user_id::text, v_period_id
  ) RETURNING id INTO v_reversal_id;

  FOR v_line IN
    SELECT *
    FROM public.journal_lines
    WHERE journal_entry_id = v_original.id
      AND business_id = v_original.business_id
    ORDER BY line_number
  LOOP
    v_line_number := v_line_number + 1;
    INSERT INTO public.journal_lines (
      business_id, journal_entry_id, line_number, account_id, description,
      is_debit, amount, amount_base, currency, exchange_rate,
      original_currency, original_amount, rate_date, rate_is_stale,
      tax_code, tax_amount, branch_id, department_id, reconciled
    ) VALUES (
      v_original.business_id, v_reversal_id, v_line_number, v_line.account_id,
      'Reversal of: ' || COALESCE(v_line.description, v_original.description, 'journal entry'),
      NOT v_line.is_debit, v_line.amount, v_line.amount_base, v_line.currency,
      v_line.exchange_rate, v_line.original_currency, v_line.original_amount,
      v_line.rate_date, v_line.rate_is_stale, v_line.tax_code, v_line.tax_amount,
      v_line.branch_id, v_line.department_id, false
    );

    IF NOT v_line.is_debit THEN
      v_total_debits := v_total_debits + v_line.amount_base;
    ELSE
      v_total_credits := v_total_credits + v_line.amount_base;
    END IF;
  END LOOP;

  IF v_line_number < 2 OR ABS(v_total_debits - v_total_credits) > 0.005 THEN
    RAISE EXCEPTION 'Reversal journal entry does not balance.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.journal_entries
  SET status = 'posted', posted_by = v_user_id::text, posted_at = now()
  WHERE id = v_reversal_id
    AND business_id = v_original.business_id
    AND status = 'draft';

  UPDATE public.journal_entries
  SET status = 'reversed', reversed_by = v_reversal_id
  WHERE id = v_original.id
    AND business_id = v_original.business_id
    AND status = 'posted'
    AND reversed_by IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % was already reversed.', p_original_id
      USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object('reversalJournalEntryId', v_reversal_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_journal_entry(uuid, text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(uuid, text, date, text) TO authenticated, service_role;
