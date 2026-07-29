-- ============================================================================
-- reserve_next_document_number(): atomic counter reservation for writers
--
-- THE BUG
-- -------
--   Quick Expense Entry, as a supervisor:
--     businesses with id "d38e4ce8-..." was not found.
--   on a live business where the supervisor's membership is active.
--
-- This is NOT the SELECT problem fixed in 20260728000010. Recording any
-- transaction reserves a document number first:
--
--   QuickExpenseMobile.tsx  -> repos.business.reserveNextExpenseNumber()
--   BusinessRepository.reserveNextExpenseNumber():
--       const business = await this.findById(businessId);          -- SELECT
--       await this.update(businessId, { expense_next_number: n+1 }); -- UPDATE
--
-- The UPDATE goes through BaseRepository.update(), which does
--     .update(dto).eq('id', id).select('*').maybeSingle()
--     if (!data) throw new NotFoundError(table, id)
--
-- Under RLS an UPDATE the caller may not perform does not raise; it simply
-- matches zero rows. PostgREST then returns no row, `data` is null, and the
-- generic "not found" is thrown against the businesses table — which is why
-- the message names businesses even though the business is present and
-- readable. The SELECT on the line above had already succeeded.
--
-- businesses_update required role = 'owner' exactly. 20260728000010 widened it
-- to owner + admin, which is right for editing Settings but still excludes
-- every other writer role, so supervisors, sales clerks and data entry users
-- remain unable to record a transaction. Widening businesses_update far enough
-- to cover them is the wrong fix: that policy governs the whole row, including
-- name, plan_tier and branding, and a sales clerk must not be able to rename
-- the company or change its plan just to raise an invoice.
--
-- THE FIX
-- -------
-- Separate "increment a counter" from "edit the business". A SECURITY DEFINER
-- function performs the increment, so the caller needs no UPDATE privilege on
-- businesses at all; the function enforces its own permission check and can
-- only ever touch the three counter columns.
--
-- This also removes the concurrency hazard flagged in BusinessRepository:
--     "Concurrency risk - documented. Replace with Postgres RPC for
--      multi-user deployments."
-- The old read-then-write pattern let two users reserve the same number. The
-- UPDATE ... RETURNING here is atomic: concurrent callers serialise on the row
-- lock and each receives a distinct number.
--
-- Permissions:
--   invoice / expense  -> can_write_business_data()  (the canWrite set)
--   payroll            -> can_write_payroll()        (payroll roles only)
--
-- Idempotent. Touches no data beyond the counter it is asked to advance.
-- ============================================================================

create or replace function public.reserve_next_document_number(
  p_business_id uuid,
  p_kind        text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_number integer;
  v_prefix text;
  v_allowed boolean;
begin
  if p_kind not in ('invoice', 'expense', 'payroll') then
    raise exception 'Unknown document kind %. Expected invoice, expense or payroll.', p_kind
      using errcode = '22023';
  end if;

  -- Payroll numbers are reserved only by payroll roles; everything else by the
  -- general writer set. Checked before the row is touched.
  if p_kind = 'payroll' then
    v_allowed := public.can_write_payroll(p_business_id);
  else
    v_allowed := public.can_write_business_data(p_business_id);
  end if;

  if not v_allowed then
    raise exception 'You do not have permission to record % documents for this business.', p_kind
      using errcode = '42501';   -- insufficient_privilege, mapped to UnauthorizedError
  end if;

  -- Atomic read-and-increment. The row lock serialises concurrent callers, so
  -- two users cannot receive the same number.
  if p_kind = 'invoice' then
    update public.businesses
       set invoice_next_number = invoice_next_number + 1,
           updated_at          = now()
     where id = p_business_id
       and deleted_at is null
    returning invoice_next_number - 1, coalesce(invoice_prefix, 'INV')
      into v_number, v_prefix;

  elsif p_kind = 'expense' then
    update public.businesses
       set expense_next_number = expense_next_number + 1,
           updated_at          = now()
     where id = p_business_id
       and deleted_at is null
    returning expense_next_number - 1, coalesce(expense_prefix, 'EXP')
      into v_number, v_prefix;

  else
    update public.businesses
       set payroll_next_number = payroll_next_number + 1,
           updated_at          = now()
     where id = p_business_id
       and deleted_at is null
    returning payroll_next_number - 1, coalesce(payroll_prefix, 'PAY')
      into v_number, v_prefix;
  end if;

  -- Distinguish a genuinely absent business from a permission problem. The
  -- permission case already returned above, so reaching here means no row.
  if v_number is null then
    raise exception 'Business % does not exist or has been deleted.', p_business_id
      using errcode = 'P0002';   -- no_data_found
  end if;

  return v_prefix || '-' || lpad(v_number::text, 4, '0');
end;
$$;

comment on function public.reserve_next_document_number(uuid, text) is
  'Atomically reserves the next invoice/expense/payroll document number and returns it formatted, e.g. EXP-0007. SECURITY DEFINER so recording a transaction does not require UPDATE on the whole businesses row: a writer must be able to advance a counter without being able to rename the company or change its plan. Enforces can_write_business_data (invoice/expense) or can_write_payroll (payroll). Replaces the read-then-write in BusinessRepository, which could hand the same number to two concurrent users.';

revoke all on function public.reserve_next_document_number(uuid, text) from public;
grant execute on function public.reserve_next_document_number(uuid, text) to authenticated, service_role;
