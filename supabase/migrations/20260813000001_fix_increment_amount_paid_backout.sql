-- ============================================================================
-- Fix increment_amount_paid: support payment backout + enforce ownership.
--
-- ROOT CAUSE
--   The previous version rejected any p_amount <= 0 ("Amount must be positive").
--   JournalRepository.reverse() back out a payment by calling it with a
--   NEGATIVE amount, so the decrement silently failed (the error object was
--   discarded) and the invoice was left with amount_paid at the paid total
--   while status was recomputed to partially_paid/sent — a self-inconsistent
--   invoice. See POST_REMEDIATION_VERIFICATION.md (C-02).
--
-- FIX
--   1. Accept a negative p_amount as an atomic back-out (decrement), while
--      still rejecting zero and preventing amount_paid from going negative.
--   2. Enforce tenant ownership: the caller must be a writer of the
--      invoice/expense's business (can_write_business_data). Previously the
--      function had no ownership check, so any authenticated user could
--      mutate any invoice's amount_paid by id — a cross-tenant write vector.
--   3. Restrict execute to authenticated + service_role (previously left to
--      PUBLIC default), so anon cannot call it.
--
-- ATOMICITY
--   The UPDATE carries `amount_paid + p_amount >= 0` in its WHERE clause, so
--   concurrent callers serialise on the row lock and cannot push the balance
--   below zero or lose an increment.
--
-- IDEMPOTENT. create or replace; touches no data.
-- ============================================================================

create or replace function public.increment_amount_paid(
  p_table  text,
  p_id     uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Validate table name to prevent SQL injection.
  if p_table not in ('invoices', 'expenses') then
    raise exception 'Invalid table name: %. Must be "invoices" or "expenses"', p_table
      using errcode = '22023';
  end if;

  -- Zero is a no-op and almost certainly a caller bug; negative is a valid
  -- back-out (payment reversal).
  if p_amount = 0 then
    raise exception 'Amount must be non-zero', p_amount
      using errcode = '22023';
  end if;

  if p_table = 'invoices' then
    -- Ownership: caller must be a writer of this invoice's business.
    if not exists (
      select 1 from public.invoices i
      where i.id = p_id
        and public.can_write_business_data(i.business_id)
    ) then
      raise exception 'Invoice % not found or you lack permission to update it', p_id
        using errcode = 'P0002';
    end if;

    update public.invoices
       set amount_paid = amount_paid + p_amount
     where id = p_id
       and amount_paid + p_amount >= 0;

    if not found then
      raise exception 'Reversal exceeds amount paid for invoice %', p_id
        using errcode = '22023';
    end if;

  elsif p_table = 'expenses' then
    if not exists (
      select 1 from public.expenses e
      where e.id = p_id
        and public.can_write_business_data(e.business_id)
    ) then
      raise exception 'Expense % not found or you lack permission to update it', p_id
        using errcode = 'P0002';
    end if;

    update public.expenses
       set amount_paid = amount_paid + p_amount
     where id = p_id
       and amount_paid + p_amount >= 0;

    if not found then
      raise exception 'Reversal exceeds amount paid for expense %', p_id
        using errcode = '22023';
    end if;
  end if;
end;
$$;

revoke all on function public.increment_amount_paid(text, uuid, numeric) from public, anon;
grant execute on function public.increment_amount_paid(text, uuid, numeric) to authenticated, service_role;

comment on function public.increment_amount_paid(text, uuid, numeric) is
  'Atomically adjusts amount_paid for an invoice or expense. Positive p_amount records a payment; negative p_amount backs out a payment (reversal). Enforces tenant ownership via can_write_business_data and never lets amount_paid go negative. Parameters: p_table (invoices|expenses), p_id (record uuid), p_amount (non-zero numeric).';
