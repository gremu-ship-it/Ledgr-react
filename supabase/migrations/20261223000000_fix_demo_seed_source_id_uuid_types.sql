-- Keep source identifiers in their native UUID type on the seeder's
-- cash-deposit, manufacturing-run, and payroll posting paths. Live journal_entries
-- and stock_movements use UUID source_id (and journal audit actors are UUIDs).
-- The original routines cast these UUIDs to text before inserting, which fails
-- on production-shaped schemas with "column source_id is of type uuid but
-- expression is of type text".

create or replace function public.post_cash_deposit(p_deposit_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.cash_deposits%rowtype;
  v_business_id uuid;
  v_actor text;
  v_bank public.accounts%rowtype;
  v_currency text;
  v_total numeric(20, 4);
  v_line_count integer;
  v_journal_id uuid;
  v_entry_number text;
begin
  v_actor := auth.uid()::text;
  if v_actor is null then
    raise exception 'Authentication is required to post a cash deposit.' using errcode = '42501';
  end if;

  select d.* into v_deposit
  from public.cash_deposits d
  where d.id = p_deposit_id
  for update;
  if not found then raise exception 'Cash deposit not found.' using errcode = 'P0002'; end if;
  v_business_id := v_deposit.business_id;
  if not public.is_business_member(v_business_id) then
    raise exception 'Not authorised for this business.' using errcode = '42501';
  end if;

  if v_deposit.status = 'posted' and v_deposit.journal_entry_id is not null then
    return v_deposit.journal_entry_id;
  end if;
  if v_deposit.status <> 'draft' then
    raise exception 'Only draft cash deposits can be posted.' using errcode = '22023';
  end if;

  select b.base_currency into v_currency
  from public.businesses b where b.id = v_business_id;
  if v_currency is null then
    raise exception 'Business functional currency could not be determined.' using errcode = '22023';
  end if;

  select a.* into v_bank
  from public.accounts a
  where a.id = v_deposit.bank_account_id
    and a.business_id = v_business_id
    and a.is_active = true
    and a.is_group = false
    and a.account_type = 'asset'
    and a.is_bank_account = true
    and (a.code like '111%' or a.code like '112%')
    and coalesce(a.currency, v_currency) = v_currency;
  if not found then
    raise exception 'Select an active bank asset account belonging to this business.' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(l.amount), 0)
    into v_line_count, v_total
  from public.cash_deposit_lines l
  where l.business_id = v_business_id and l.deposit_id = p_deposit_id;
  if v_line_count = 0 or v_total <= 0 then
    raise exception 'Add at least one positive cash source line.' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.cash_deposit_lines l
    left join public.accounts a on a.id = l.source_account_id
      and a.business_id = v_business_id
    where l.business_id = v_business_id and l.deposit_id = p_deposit_id
      and (a.id is null or a.is_active is not true or a.is_group is true
        or a.account_type is distinct from 'asset' or a.id = v_bank.id
        or not (a.code like '111%' or a.code like '112%')
        or a.is_bank_account is true
        or coalesce(a.currency, v_currency) <> v_currency)
  ) then
    raise exception 'Every source must be a different active cash asset account in the same currency as the bank account.' using errcode = '22023';
  end if;

  v_entry_number := public.next_journal_entry_number(v_business_id);
  insert into public.journal_entries (
    business_id, entry_number, entry_date, description, source_type, source_id,
    currency, exchange_rate, status, created_by, posted_by, posted_at
  ) values (
    v_business_id, v_entry_number, v_deposit.deposit_date,
    coalesce(nullif(trim(v_deposit.reference), ''), 'Cash deposit') || ' — cash deposit',
    'cash_deposit', p_deposit_id,
    v_currency, 1, 'posted', v_actor::uuid, v_actor::uuid, now()
  ) returning id into v_journal_id;

  insert into public.journal_lines (
    business_id, journal_entry_id, line_number, account_id, description,
    is_debit, amount, amount_base, currency, exchange_rate, rate_is_stale,
    reconciled, tax_amount
  ) values (
    v_business_id, v_journal_id, 1, v_bank.id,
    coalesce(nullif(trim(v_deposit.reference), ''), 'Cash deposit') || ' — bank deposit',
    true, v_total, v_total, v_currency, 1, false, false, 0
  );

  insert into public.journal_lines (
    business_id, journal_entry_id, line_number, account_id, description,
    is_debit, amount, amount_base, currency, exchange_rate, rate_is_stale,
    reconciled, tax_amount
  )
  select v_business_id, v_journal_id, l.line_number + 1, l.source_account_id,
    coalesce(nullif(trim(l.description), ''), 'Cash source transfer'),
    false, l.amount, l.amount, v_currency, 1, false, false, 0
  from public.cash_deposit_lines l
  where l.business_id = v_business_id and l.deposit_id = p_deposit_id
  order by l.line_number;

  update public.cash_deposits
  set status = 'posted', journal_entry_id = v_journal_id,
      posted_by = v_actor, posted_at = now(), updated_at = now()
  where id = p_deposit_id and business_id = v_business_id;
  return v_journal_id;
end;
$$;

CREATE OR REPLACE FUNCTION public._mfg_wo_movement(
  p_business_id uuid, p_product_id uuid, p_location_id uuid,
  p_movement_type text, p_movement_date date, p_quantity numeric,
  p_unit_cost numeric, p_source_id uuid, p_reference text, p_notes text,
  p_actor uuid, p_source_type text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(p_quantity, 0) = 0 THEN RETURN NULL; END IF;
  IF p_source_type NOT IN ('production_run', 'manufacturing_work_order') THEN
    RAISE EXCEPTION 'Unsupported manufacturing stock movement source.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stock_movements
    (business_id, product_id, location_id, movement_type, movement_date, quantity,
     unit_cost, source_type, source_id, reference, created_by, notes)
  VALUES
    (p_business_id, p_product_id, p_location_id,
     p_movement_type::public.stock_movement_type, p_movement_date, p_quantity,
     COALESCE(p_unit_cost, 0), p_source_type, p_source_id, p_reference, p_actor, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.post_pay_run(p_pay_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.pay_runs%ROWTYPE;
  v_line record;
  v_business public.businesses%ROWTYPE;
  v_journal_id uuid;
  v_journal_number text;
  v_bank_account_id uuid;
  v_pension_payable_id uuid;
  v_line_no integer := 0;
  v_total_debits numeric := 0;
  v_total_credits numeric := 0;
  v_amount numeric;
  v_account_business uuid;
BEGIN
  SELECT * INTO v_run FROM public.pay_runs WHERE id = p_pay_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pay run % was not found.', p_pay_run_id USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_write_business_data(v_run.business_id) THEN
    RAISE EXCEPTION 'You do not have permission to post payroll for this business.' USING ERRCODE = '42501';
  END IF;
  IF v_run.status = 'posted' AND v_run.journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('payRunId', v_run.id, 'journalEntryId', v_run.journal_entry_id, 'status', 'posted');
  END IF;
  IF v_run.status NOT IN ('calculated', 'approved') THEN
    RAISE EXCEPTION 'Only calculated or approved pay runs can be posted.' USING ERRCODE = '55000';
  END IF;
  IF v_run.employee_count = 0 THEN RAISE EXCEPTION 'A pay run with no included employees cannot be posted.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_business FROM public.businesses WHERE id = v_run.business_id;
  -- Current default-bank convention: choose an active, non-group bank account,
  -- preferring the first current-account code. No FX is used in payroll.
  SELECT a.id INTO v_bank_account_id FROM public.accounts a
  WHERE a.business_id = v_run.business_id AND a.is_bank_account IS TRUE
    AND a.is_active IS TRUE AND a.is_group IS FALSE AND a.deleted_at IS NULL
  ORDER BY CASE WHEN a.code IN ('1121', '1122', '1123', '1124') THEN 0 ELSE 1 END, a.code
  LIMIT 1;
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Link an active bank account before posting payroll.' USING ERRCODE = '23502';
  END IF;
  SELECT a.id INTO v_pension_payable_id FROM public.accounts a
  WHERE a.business_id = v_run.business_id AND a.code = '2132' AND a.is_active IS TRUE AND a.deleted_at IS NULL
  LIMIT 1;

  v_journal_number := public.next_journal_entry_number(v_run.business_id);
  INSERT INTO public.journal_entries (
    business_id, entry_number, entry_date, description, reference, source_type,
    source_id, currency, exchange_rate, status, created_by
  ) VALUES (
    v_run.business_id, v_journal_number, v_run.pay_date,
    'Payroll for ' || to_char(v_run.period_start, 'YYYY-MM-DD') || ' to ' || to_char(v_run.period_end, 'YYYY-MM-DD'),
    v_run.id::text, 'payroll', v_run.id, v_business.base_currency, 1, 'draft', auth.uid()
  ) RETURNING id INTO v_journal_id;

  -- Debit each earning component to its configured expense account.
  FOR v_line IN
    SELECT pc.gl_account_id, pc.code, SUM(detail.amount) AS amount
    FROM public.pay_run_component_details detail
    JOIN public.pay_run_lines line ON line.id = detail.pay_run_line_id
    JOIN public.pay_components pc ON pc.id = detail.pay_component_id
    WHERE line.business_id = v_run.business_id AND line.pay_run_id = v_run.id
      AND pc.component_type = 'earning' AND detail.amount > 0
    GROUP BY pc.gl_account_id, pc.code
  LOOP
    IF v_line.gl_account_id IS NULL THEN RAISE EXCEPTION 'Set an expense account on payroll component % before posting.', v_line.code USING ERRCODE = '23502'; END IF;
    SELECT a.business_id INTO v_account_business FROM public.accounts a WHERE a.id = v_line.gl_account_id;
    IF v_account_business IS DISTINCT FROM v_run.business_id THEN RAISE EXCEPTION 'Payroll component % points to an account outside this business.', v_line.code USING ERRCODE = '23503'; END IF;
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_line.gl_account_id, 'Payroll ' || v_line.code, true, v_line.amount, v_line.amount, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_debits := v_total_debits + v_line.amount;
  END LOOP;

  -- Credit component-specific deduction liabilities (PAYE, employee pension,
  -- and any configured deductions). Employer pension is an earning component
  -- for cost reporting but is credited to the pension payable account as well.
  FOR v_line IN
    SELECT pc.gl_account_id, pc.code, pc.component_type, SUM(detail.amount) AS amount
    FROM public.pay_run_component_details detail
    JOIN public.pay_run_lines line ON line.id = detail.pay_run_line_id
    JOIN public.pay_components pc ON pc.id = detail.pay_component_id
    WHERE line.business_id = v_run.business_id AND line.pay_run_id = v_run.id
      AND pc.component_type = 'deduction' AND detail.amount > 0
    GROUP BY pc.gl_account_id, pc.code, pc.component_type
  LOOP
    IF v_line.gl_account_id IS NULL THEN RAISE EXCEPTION 'Set a liability account on payroll component % before posting.', v_line.code USING ERRCODE = '23502'; END IF;
    SELECT a.business_id INTO v_account_business FROM public.accounts a WHERE a.id = v_line.gl_account_id;
    IF v_account_business IS DISTINCT FROM v_run.business_id THEN RAISE EXCEPTION 'Payroll component % points to an account outside this business.', v_line.code USING ERRCODE = '23503'; END IF;
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_line.gl_account_id, 'Payroll deduction ' || v_line.code, false, v_line.amount, v_line.amount, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_credits := v_total_credits + v_line.amount;
  END LOOP;

  SELECT COALESCE(SUM(detail.amount), 0) INTO v_amount
  FROM public.pay_run_component_details detail
  JOIN public.pay_run_lines line ON line.id = detail.pay_run_line_id
  JOIN public.pay_components pc ON pc.id = detail.pay_component_id
  WHERE line.business_id = v_run.business_id AND line.pay_run_id = v_run.id AND pc.code = 'PENSION_ER';
  IF v_amount > 0 THEN
    IF v_pension_payable_id IS NULL THEN RAISE EXCEPTION 'Pension Payable account (2132) is not configured.' USING ERRCODE = '23502'; END IF;
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_pension_payable_id, 'Employer pension payable', false, v_amount, v_amount, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_credits := v_total_credits + v_amount;
  END IF;

  -- Credit net pay to the business's active default bank account.
  IF v_run.total_net > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_bank_account_id, 'Net payroll payable', false, v_run.total_net, v_run.total_net, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_credits := v_total_credits + v_run.total_net;
  END IF;

  IF v_line_no < 2 OR ABS(v_total_debits - v_total_credits) > 0.005 THEN
    RAISE EXCEPTION 'Payroll journal does not balance: debits %, credits %.', v_total_debits, v_total_credits USING ERRCODE = '23514';
  END IF;

  UPDATE public.journal_entries SET status = 'posted', posted_at = now(), posted_by = auth.uid()
  WHERE id = v_journal_id AND status = 'draft';
  UPDATE public.pay_runs SET status = 'posted', journal_entry_id = v_journal_id,
    posted_at = now(), posted_by = auth.uid(), updated_at = now()
  WHERE id = v_run.id AND business_id = v_run.business_id;

  RETURN jsonb_build_object('payRunId', v_run.id, 'journalEntryId', v_journal_id, 'status', 'posted');
END;
$$;

COMMENT ON FUNCTION public.post_pay_run(uuid) IS
  'Posts balanced functional-currency payroll; source_id is the native pay_run UUID and repeated calls return the existing posted entry.';
