-- ============================================================================
-- Block payments against cancelled documents (C-03) at the DATABASE layer.
--
-- The previous guard lived only in the UI (InvoicesPage) and used status
-- values that do not exist in the schema ('voided', 'credited'). A direct
-- client/API write could still record a payment and inflate amount_paid on a
-- void or credit_note invoice. This migration enforces the rule in the
-- database, fail-closed, for both invoices and expenses.
--
-- Model:
--   invoices.status enum:  draft | sent | partially_paid | paid | overdue | void | credit_note
--   expenses.status:       draft | approved | paid | void
--
-- A payment may only be recorded against an invoice that is not void/credit_note,
-- and against an expense that is not void.
--
-- Guarded with to_regclass() because the core financial tables are created
-- out-of-band (schema.sql is empty) and may not exist on a fresh checkout.
-- Idempotent: create or replace function + drop trigger if exists.
-- ============================================================================

-- ── Invoices ─────────────────────────────────────────────────────────────────
create or replace function public.enforce_invoice_payment_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.invoices
   where id = new.invoice_id;

  if v_status in ('void', 'credit_note') then
    raise exception 'Cannot record a payment against a % invoice.', v_status
      using errcode = '22023';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.invoice_payments') is not null then
    drop trigger if exists invoice_payments_status_guard on public.invoice_payments;
    create trigger invoice_payments_status_guard
      before insert or update on public.invoice_payments
      for each row execute function public.enforce_invoice_payment_allowed();
  end if;
end;
$$;

-- ── Expenses ─────────────────────────────────────────────────────────────────
create or replace function public.enforce_expense_payment_allowed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status into v_status
    from public.expenses
   where id = new.expense_id;

  if v_status = 'void' then
    raise exception 'Cannot record a payment against a void expense.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

do $$
begin
  if to_regclass('public.expense_payments') is not null then
    drop trigger if exists expense_payments_status_guard on public.expense_payments;
    create trigger expense_payments_status_guard
      before insert or update on public.expense_payments
      for each row execute function public.enforce_expense_payment_allowed();
  end if;
end;
$$;
