-- ============================================================================
-- Phase 10 remediation — A-03: invoices.amount_due is never maintained.
--
-- FINDING (audit, 2026-08-16)
--   Every app insert path created invoices without amount_due, so the column
--   stayed NULL. Readers that trust the column (customer balance queries,
--   direct SQL consumers) got NULL/0 even for unpaid invoices; the AR view
--   and IncomeRepository paper over the gap with COALESCE fallbacks, which
--   is why the defect went unnoticed.
--
-- FIX
--   1. BEFORE INSERT OR UPDATE trigger keeps amount_due = total_amount -
--      amount_paid on every write path (web, mobile, offline sync, partner
--      billing, edge functions, API) — no app call-site can forget it again.
--      This also keeps amount_due correct under increment_amount_paid and
--      payment back-out (negative increment), because both are plain
--      UPDATEs of amount_paid.
--   2. Backfill: every existing row gets amount_due = total_amount -
--      amount_paid (amount_due is a derived column; there is no legitimate
--      reason for it to differ from total − paid).
--
-- IDEMPOTENT: create-or-replace function, drop-then-create trigger,
-- backfill update is naturally a no-op when already consistent.
-- ============================================================================

create or replace function public.sync_invoice_amount_due()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.amount_due := new.total_amount - new.amount_paid;
  return new;
end;
$$;

drop trigger if exists trg_invoices_sync_amount_due on public.invoices;

create trigger trg_invoices_sync_amount_due
  before insert or update of total_amount, amount_paid on public.invoices
  for each row execute function public.sync_invoice_amount_due();

comment on function public.sync_invoice_amount_due() is
  'Phase 10 A-03: keeps invoices.amount_due = total_amount - amount_paid on insert and on any change of total_amount/amount_paid (including increment_amount_paid and payment back-out).';

-- Backfill existing rows (idempotent — no-op when already consistent).
update public.invoices
   set amount_due = total_amount - amount_paid
 where amount_due is distinct from (total_amount - amount_paid);
