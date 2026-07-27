-- ─────────────────────────────────────────────────────────────────────────
-- De-duplication for the monthly partner billing run
-- ─────────────────────────────────────────────────────────────────────────
-- generate-partner-invoices (pg_cron, monthly) raises one invoice per
-- partner per billing period. This unique index is what makes the job
-- safely re-runnable: a second run for the same period hits a 23505 and is
-- skipped instead of double-billing the bank.
--
-- Voided invoices are excluded so a mistaken invoice can be voided and
-- re-raised for the same period.

create unique index if not exists partner_invoices_period_key
  on public.partner_invoices (partner_id, period_start)
  where period_start is not null and status <> 'void';

comment on index public.partner_invoices_period_key is
  'One live invoice per partner per billing period — makes the monthly billing cron idempotent.';

-- Auto-numbering, so invoice_number is never null for generated invoices
-- and follows a readable sequence per partner (PINV-000001).
create sequence if not exists public.partner_invoice_number_seq;

create or replace function public.set_partner_invoice_number()
returns trigger
language plpgsql
as $$
begin
  if new.invoice_number is null then
    new.invoice_number := 'PINV-' || lpad(nextval('public.partner_invoice_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_partner_invoice_number on public.partner_invoices;
create trigger trg_set_partner_invoice_number
  before insert on public.partner_invoices
  for each row execute function public.set_partner_invoice_number();
