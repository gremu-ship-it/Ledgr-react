-- FX revaluation workflow hardening.
-- The currency/rate tables, lookup index, and one-run-per-business/date
-- constraint already exist in 20260727000000_multi_currency_ias21.sql.

-- Permit authorized finance writers to correct a manually entered rate for
-- its effective date. Frankfurter snapshots remain immutable in the client.
DROP POLICY IF EXISTS exchange_rates_business_update ON public.exchange_rates;
CREATE POLICY exchange_rates_business_update ON public.exchange_rates
  FOR UPDATE
  USING (public.can_write_business_data(business_id) AND source = 'manual')
  WITH CHECK (public.can_write_business_data(business_id) AND source = 'manual');

CREATE INDEX IF NOT EXISTS idx_fx_revaluation_journal_balance
  ON public.journal_lines (business_id, account_id, journal_entry_id);

-- Post the dedicated FX entry and audit row in one transaction. This keeps a
-- failed journal insert, balance check, or unique-date race from leaving an
-- orphaned posted entry. Existing journal entry creation flows are untouched.
CREATE OR REPLACE FUNCTION public.run_fx_revaluation(
  p_business_id uuid,
  p_revaluation_date date,
  p_functional_currency text,
  p_lines jsonb,
  p_total_unrealised_gain numeric,
  p_total_unrealised_loss numeric,
  p_closing_rate_source text DEFAULT 'manual/cache'
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.fx_revaluations%ROWTYPE;
  v_revaluation_id uuid := gen_random_uuid();
  v_journal_entry_id uuid;
  v_entry_number text;
  v_line jsonb;
  v_line_number integer := 0;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_line_count integer := 0;
  v_business_currency text;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.can_write_business_data(p_business_id), false) THEN
    RAISE EXCEPTION 'You do not have permission to run FX revaluation for this business.'
      USING ERRCODE = '42501';
  END IF;

  SELECT base_currency INTO v_business_currency
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_business_currency IS NULL OR p_functional_currency IS DISTINCT FROM v_business_currency THEN
    RAISE EXCEPTION 'FX revaluation currency must match the business functional currency.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.fx_revaluations
  WHERE business_id = p_business_id
    AND revaluation_date = p_revaluation_date;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'revaluationId', v_existing.id,
      'journalEntryId', v_existing.journal_entry_id,
      'lineCount', v_existing.line_count,
      'totalUnrealisedGain', v_existing.total_unrealised_gain,
      'totalUnrealisedLoss', v_existing.total_unrealised_loss
    );
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'FX revaluation journal lines must be an array.' USING ERRCODE = '22023';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF coalesce((v_line->>'amount')::numeric, 0) <= 0
      OR coalesce((v_line->>'amount_base')::numeric, 0) <= 0
      OR abs((v_line->>'amount')::numeric - (v_line->>'amount_base')::numeric) > 0.005
      OR (v_line->>'currency') IS DISTINCT FROM p_functional_currency
      OR coalesce((v_line->>'exchange_rate')::numeric, 1) <> 1
      OR jsonb_typeof(v_line->'is_debit') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'FX revaluation journal lines must use positive functional-currency amounts at rate one.' USING ERRCODE = '22023';
    END IF;
    IF coalesce((v_line->>'is_debit')::boolean, false) THEN
      v_debits := v_debits + coalesce((v_line->>'amount_base')::numeric, 0);
    ELSE
      v_credits := v_credits + coalesce((v_line->>'amount_base')::numeric, 0);
    END IF;
  END LOOP;

  v_line_count := jsonb_array_length(p_lines);
  IF coalesce(p_total_unrealised_gain, 0) < 0 OR coalesce(p_total_unrealised_loss, 0) < 0 THEN
    RAISE EXCEPTION 'FX revaluation gain and loss totals cannot be negative.' USING ERRCODE = '22023';
  END IF;
  IF v_line_count = 0 AND (abs(coalesce(p_total_unrealised_gain, 0)) > 0.005 OR abs(coalesce(p_total_unrealised_loss, 0)) > 0.005) THEN
    RAISE EXCEPTION 'An empty FX revaluation cannot have gain or loss totals.' USING ERRCODE = '22023';
  END IF;
  IF v_line_count > 0 AND v_line_count < 2 THEN
    RAISE EXCEPTION 'An FX revaluation journal needs at least two lines.' USING ERRCODE = '22023';
  END IF;
  IF abs(v_debits - v_credits) > 0.005 THEN
    RAISE EXCEPTION 'FX revaluation journal does not balance in functional currency.' USING ERRCODE = '23514';
  END IF;

  IF v_line_count > 0 THEN
    v_entry_number := public.next_journal_entry_number(p_business_id);
    INSERT INTO public.journal_entries (
      business_id, entry_number, entry_date, description, source_type, source_id,
      currency, exchange_rate, status, created_by, posted_at, posted_by
    ) VALUES (
      p_business_id, v_entry_number, p_revaluation_date,
      'FX revaluation ' || p_revaluation_date::text,
      'fx_revaluation', v_revaluation_id::text,
      p_functional_currency, 1, 'posted', auth.uid()::text, now(), auth.uid()::text
    ) RETURNING id INTO v_journal_entry_id;

    FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
      v_line_number := v_line_number + 1;
      INSERT INTO public.journal_lines (
        journal_entry_id, business_id, line_number, account_id, description,
        is_debit, amount, amount_base, currency, exchange_rate,
        functional_amount, functional_currency, original_amount, original_currency,
        rate_date, rate_is_stale, tax_code, tax_amount, reconciled
      ) VALUES (
        v_journal_entry_id, p_business_id,
        coalesce((v_line->>'line_number')::integer, v_line_number),
        public._ledgr_assert_account((v_line->>'account_id')::uuid, p_business_id, 'journal'),
        v_line->>'description',
        (v_line->>'is_debit')::boolean,
        (v_line->>'amount')::numeric,
        (v_line->>'amount_base')::numeric,
        coalesce(v_line->>'currency', p_functional_currency),
        coalesce((v_line->>'exchange_rate')::numeric, 1),
        coalesce((v_line->>'functional_amount')::numeric, (v_line->>'amount_base')::numeric),
        coalesce(v_line->>'functional_currency', p_functional_currency),
        coalesce((v_line->>'original_amount')::numeric, (v_line->>'amount')::numeric),
        coalesce(v_line->>'original_currency', v_line->>'currency', p_functional_currency),
        nullif(v_line->>'rate_date', '')::date,
        coalesce((v_line->>'rate_is_stale')::boolean, false),
        coalesce(v_line->>'tax_code', 'none')::public.tax_code,
        coalesce((v_line->>'tax_amount')::numeric, 0),
        false
      );
    END LOOP;
  END IF;

  INSERT INTO public.fx_revaluations (
    id, business_id, revaluation_date, journal_entry_id,
    total_unrealised_gain, total_unrealised_loss, line_count,
    closing_rate_source, status, created_by
  ) VALUES (
    v_revaluation_id, p_business_id, p_revaluation_date, v_journal_entry_id,
    round(coalesce(p_total_unrealised_gain, 0), 2),
    round(coalesce(p_total_unrealised_loss, 0), 2),
    v_line_count, coalesce(nullif(p_closing_rate_source, ''), 'manual/cache'),
    'posted', auth.uid()
  );

  RETURN jsonb_build_object(
    'revaluationId', v_revaluation_id,
    'journalEntryId', v_journal_entry_id,
    'lineCount', v_line_count,
    'totalUnrealisedGain', round(coalesce(p_total_unrealised_gain, 0), 2),
    'totalUnrealisedLoss', round(coalesce(p_total_unrealised_loss, 0), 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.run_fx_revaluation(uuid, date, text, jsonb, numeric, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_fx_revaluation(uuid, date, text, jsonb, numeric, numeric, text) TO authenticated;
