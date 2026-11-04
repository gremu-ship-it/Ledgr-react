-- Phase 6D-4: Leave Management UI and payroll reversal RPCs.
-- These transactional RPCs keep status changes, balance updates, and journal
-- reversal entries atomic and tenant-scoped.

-- Persist the reversal link so the pay-run detail page can open it after reload.
ALTER TABLE public.pay_runs
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pay_runs_reversal_journal_business_fk'
      AND conrelid = 'public.pay_runs'::regclass
  ) THEN
    ALTER TABLE public.pay_runs
      ADD CONSTRAINT pay_runs_reversal_journal_business_fk
      FOREIGN KEY (business_id, reversal_journal_entry_id)
      REFERENCES public.journal_entries (business_id, id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_pay_run(p_pay_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.pay_runs%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_original_je public.journal_entries%ROWTYPE;
  v_reversal_je_id uuid;
  v_reversal_number text;
  v_line record;
  v_line_no integer := 0;
  v_total_debits numeric := 0;
  v_total_credits numeric := 0;
BEGIN
  SELECT * INTO v_run
  FROM public.pay_runs
  WHERE id = p_pay_run_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay run % was not found.', p_pay_run_id USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_write_business_data(v_run.business_id) THEN
    RAISE EXCEPTION 'You do not have permission to reverse payroll for this business.' USING ERRCODE = '42501';
  END IF;
  IF v_run.status <> 'posted' THEN
    RAISE EXCEPTION 'Only posted pay runs can be reversed.' USING ERRCODE = '55000';
  END IF;
  IF v_run.journal_entry_id IS NULL THEN
    RAISE EXCEPTION 'Pay run has no linked journal entry to reverse.' USING ERRCODE = '23502';
  END IF;

  SELECT * INTO v_original_je
  FROM public.journal_entries
  WHERE id = v_run.journal_entry_id
    AND business_id = v_run.business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Original journal entry % not found.', v_run.journal_entry_id USING ERRCODE = 'P0002';
  END IF;
  IF v_original_je.status <> 'posted' OR v_original_je.reversed_by IS NOT NULL THEN
    RAISE EXCEPTION 'The linked payroll journal entry is not available for reversal.' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_business FROM public.businesses WHERE id = v_run.business_id;
  v_reversal_number := public.next_journal_entry_number(v_run.business_id);
  INSERT INTO public.journal_entries (
    business_id, branch_id, department_id, entry_number, entry_date, description,
    reference, source_type, source_id, currency, exchange_rate, status, created_by, reversal_of
  ) VALUES (
    v_run.business_id, v_original_je.branch_id, v_original_je.department_id,
    v_reversal_number, CURRENT_DATE,
    'REVERSAL: ' || v_original_je.description,
    v_original_je.entry_number, 'payroll', p_pay_run_id::text,
    v_business.base_currency, 1, 'draft', auth.uid()::text, v_original_je.id
  ) RETURNING id INTO v_reversal_je_id;

  -- Reverse each journal line by swapping its debit/credit side while
  -- preserving its original and functional-currency amounts and dimensions.
  FOR v_line IN
    SELECT *
    FROM public.journal_lines
    WHERE journal_entry_id = v_original_je.id
      AND business_id = v_run.business_id
    ORDER BY line_number
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      business_id, journal_entry_id, line_number, account_id, branch_id, department_id,
      description, is_debit, amount, amount_base, original_amount, original_currency,
      currency, exchange_rate, rate_date, tax_code, tax_amount, reconciled,
      reconciled_at, rate_is_stale
    ) VALUES (
      v_run.business_id, v_reversal_je_id, v_line_no, v_line.account_id,
      v_line.branch_id, v_line.department_id, 'REVERSAL: ' || COALESCE(v_line.description, ''),
      NOT v_line.is_debit, v_line.amount, v_line.amount_base,
      v_line.original_amount, v_line.original_currency, v_line.currency,
      v_line.exchange_rate, v_line.rate_date, v_line.tax_code, v_line.tax_amount,
      false, NULL, v_line.rate_is_stale
    );
    IF NOT v_line.is_debit THEN
      v_total_debits := v_total_debits + v_line.amount_base;
    ELSE
      v_total_credits := v_total_credits + v_line.amount_base;
    END IF;
  END LOOP;

  IF v_line_no = 0 OR ABS(v_total_debits - v_total_credits) > 0.005 THEN
    RAISE EXCEPTION 'Reversal journal does not balance.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.journal_entries
  SET status = 'posted', posted_at = now(), posted_by = auth.uid()::text
  WHERE id = v_reversal_je_id AND status = 'draft';

  UPDATE public.journal_entries
  SET reversed_by = v_reversal_je_id
  WHERE id = v_original_je.id AND business_id = v_run.business_id;

  UPDATE public.pay_runs
  SET status = 'reversed', reversal_journal_entry_id = v_reversal_je_id, updated_at = now()
  WHERE id = v_run.id AND business_id = v_run.business_id;

  RETURN jsonb_build_object(
    'payRunId', v_run.id,
    'reversalJournalEntryId', v_reversal_je_id,
    'status', 'reversed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_pay_run(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.reverse_pay_run(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_leave_request(
  p_business_id uuid,
  p_employee_id uuid,
  p_leave_type_id uuid,
  p_start_date date,
  p_end_date date,
  p_total_days numeric,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request_id uuid;
  v_balance record;
  v_available numeric;
BEGIN
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
  END IF;
  IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
    RAISE EXCEPTION 'End date must be on or after start date.' USING ERRCODE = '22023';
  END IF;
  IF p_total_days IS NULL OR p_total_days <= 0 THEN
    RAISE EXCEPTION 'Total days must be positive.' USING ERRCODE = '22023';
  END IF;

  -- Serialize checks against existing balances. A missing balance leaves the
  -- request pending; approval will re-check the available balance atomically.
  SELECT lb.entitled_days, lb.used_days, lb.carried_forward
  INTO v_balance
  FROM public.leave_balances lb
  WHERE lb.business_id = p_business_id
    AND lb.employee_id = p_employee_id
    AND lb.leave_type_id = p_leave_type_id
    AND lb.year = EXTRACT(YEAR FROM p_start_date)::int
  FOR UPDATE;

  IF FOUND THEN
    v_available := v_balance.entitled_days + v_balance.carried_forward - v_balance.used_days;
    IF p_total_days > v_available THEN
      RAISE EXCEPTION 'Insufficient leave balance. Available: % days, requested: % days.',
        v_available, p_total_days USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.leave_requests (
    business_id, employee_id, leave_type_id, start_date, end_date, total_days, reason, status
  ) VALUES (
    p_business_id, p_employee_id, p_leave_type_id, p_start_date, p_end_date,
    p_total_days, p_reason, 'pending'
  ) RETURNING id INTO v_request_id;

  RETURN jsonb_build_object('requestId', v_request_id, 'status', 'pending');
END;
$$;

REVOKE ALL ON FUNCTION public.submit_leave_request(uuid, uuid, uuid, date, date, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_leave_request(uuid, uuid, uuid, date, date, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.approve_leave_request(
  p_request_id uuid,
  p_approved boolean
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_request public.leave_requests%ROWTYPE;
  v_balance public.leave_balances%ROWTYPE;
  v_available numeric;
BEGIN
  SELECT * INTO v_request
  FROM public.leave_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave request not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.can_write_business_data(v_request.business_id) THEN
    RAISE EXCEPTION 'Permission denied.' USING ERRCODE = '42501';
  END IF;
  IF v_request.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending leave requests can be approved or rejected.' USING ERRCODE = '55000';
  END IF;
  IF p_approved IS NULL THEN
    RAISE EXCEPTION 'An approval decision is required.' USING ERRCODE = '22023';
  END IF;

  IF p_approved THEN
    SELECT * INTO v_balance
    FROM public.leave_balances
    WHERE business_id = v_request.business_id
      AND employee_id = v_request.employee_id
      AND leave_type_id = v_request.leave_type_id
      AND year = EXTRACT(YEAR FROM v_request.start_date)::int
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Insufficient leave balance. Available: 0 days, requested: % days.',
        v_request.total_days USING ERRCODE = '23514';
    END IF;
    v_available := v_balance.entitled_days + v_balance.carried_forward - v_balance.used_days;
    IF v_request.total_days > v_available THEN
      RAISE EXCEPTION 'Insufficient leave balance. Available: % days, requested: % days.',
        v_available, v_request.total_days USING ERRCODE = '23514';
    END IF;

    UPDATE public.leave_balances
    SET used_days = used_days + v_request.total_days
    WHERE id = v_balance.id;
    UPDATE public.leave_requests
    SET status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  ELSE
    UPDATE public.leave_requests
    SET status = 'rejected', approved_by = auth.uid(), approved_at = now(), updated_at = now()
    WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'requestId', p_request_id,
    'status', CASE WHEN p_approved THEN 'approved' ELSE 'rejected' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_leave_request(uuid, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.approve_leave_request(uuid, boolean) TO authenticated, service_role;
