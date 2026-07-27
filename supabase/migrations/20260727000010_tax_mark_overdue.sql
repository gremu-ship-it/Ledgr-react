-- ============================================================================
-- Migration: automatic overdue transition for tax returns
--
-- tax_return_status has always included 'overdue', findOpenByBusiness()
-- queries for it and markFiled() accepts it — but nothing ever performed the
-- transition, so returns sat at 'pending' indefinitely and the status was
-- effectively unreachable.
--
-- This adds a SECURITY DEFINER function that flips any pending/filed return
-- past its due date to 'overdue'. Scheduled daily below; the client also
-- calls TaxReturnRepository.markOverdueReturns() on dashboard load so the UI
-- is correct even if cron is not enabled.
-- ============================================================================

create or replace function public.mark_overdue_tax_returns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  update tax_returns
  set status = 'overdue'
  where status in ('pending', 'filed')
    and due_date < current_date;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.mark_overdue_tax_returns() is
  'Flips pending/filed tax returns past their due date to overdue. Run daily via pg_cron; also invoked client-side on dashboard load.';

-- Schedule daily at 01:00 UTC, before the alert sender runs at 07:00 so
-- alerts reflect the correct status.
select cron.schedule(
  'mark-overdue-tax-returns-daily',
  '0 1 * * *',
  $$ select public.mark_overdue_tax_returns(); $$
);
