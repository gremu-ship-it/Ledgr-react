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
-- SCHEMA DIVERGENCE (discovered 2026-08-19 on the PRODUCTION deploy)
--   The original PRODUCTION schema defines amount_due as a GENERATED column:
--     amount_due numeric GENERATED ALWAYS AS (total_amount - amount_paid) STORED
--   A generated column self-maintains, and any UPDATE/trigger assignment to
--   it fails with SQLSTATE 428C9 ("column can only be updated to DEFAULT").
--   STAGING and fresh replays use the reconstructed base schema, where
--   amount_due is a PLAIN nullable numeric.
--
-- FIX (schema-aware, idempotent)
--   * GENERATED column (production): nothing to maintain. Drop the Phase 10.1
--     trigger if a previous partial run created it — a BEFORE trigger that
--     assigns to a generated column would fail EVERY invoice write with
--     428C9. Also drop the now-unused helper function.
--   * PLAIN column (staging / fresh DBs): install the BEFORE INSERT OR
--     UPDATE trigger that keeps amount_due = total_amount - amount_paid on
--     every write path (web, mobile, offline sync, partner billing, edge
--     functions, API) — no app call-site can forget it again. This also
--     keeps amount_due correct under increment_amount_paid and payment
--     back-out (negative increment). Then backfill existing rows.
-- ============================================================================

do $phase10_a03$
declare
  v_generated text;
begin
  select is_generated into v_generated
    from information_schema.columns
   where table_schema = 'public'
     and table_name  = 'invoices'
     and column_name = 'amount_due';

  if v_generated = 'ALWAYS' then
    -- Production shape: the column self-maintains. A leftover trigger from a
    -- partial apply of this migration (pre-2026-08-19 version) would break
    -- every invoice write — drop it.
    drop trigger if exists trg_invoices_sync_amount_due on public.invoices;
    drop function if exists public.sync_invoice_amount_due();
    raise notice 'phase10 A-03: invoices.amount_due is GENERATED — column self-maintains; no trigger installed.';
  else
    -- Staging / fresh-DB shape: plain column needs the trigger + backfill.
    create or replace function public.sync_invoice_amount_due()
    returns trigger
    language plpgsql
    set search_path = public
    as $function$
    begin
      new.amount_due := new.total_amount - new.amount_paid;
      return new;
    end;
    $function$;

    comment on function public.sync_invoice_amount_due() is
      'Phase 10 A-03: keeps invoices.amount_due = total_amount - amount_paid on insert and on any change of total_amount/amount_paid (including increment_amount_paid and payment back-out).';

    drop trigger if exists trg_invoices_sync_amount_due on public.invoices;

    create trigger trg_invoices_sync_amount_due
      before insert or update of total_amount, amount_paid on public.invoices
      for each row execute function public.sync_invoice_amount_due();

    -- Backfill existing rows (idempotent — no-op when already consistent).
    update public.invoices
       set amount_due = total_amount - amount_paid
     where amount_due is distinct from (total_amount - amount_paid);

    raise notice 'phase10 A-03: invoices.amount_due is a PLAIN column — trigger installed and existing rows backfilled.';
  end if;
end
$phase10_a03$;
