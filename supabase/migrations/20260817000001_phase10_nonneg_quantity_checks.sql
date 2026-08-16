-- ============================================================================
-- Phase 10 remediation — A-04: no DB CHECK against negative quantities/stock.
--
-- FINDING (audit, 2026-08-16)
--   Negative invoice/expense line quantities and negative inventory stock
--   were accepted by the database (app-level validation only). A hostile or
--   buggy write could corrupt inventory and revenue figures at the source.
--
-- FIX
--   CHECK constraints on every quantity/stock column:
--     invoice_lines.quantity, unit_price            >= 0
--     expense_lines.quantity, unit_price            >= 0
--     inventory_balances.quantity_on_hand           >= 0
--     inventory_balances.quantity_reserved          >= 0
--     stock_transfer_lines.quantity_{requested,
--       dispatched,received}                        >= 0
--     stock_movements.quantity                      <> 0
--   (stock_movements.quantity deliberately allows NEGATIVE values — the app
--   encodes direction as sign, e.g. inventoryJournalService writes
--   `quantity: -line.quantity` for issues/sales; only zero is meaningless.)
--
-- SAFETY vs LEGACY DATA
--   Constraints are added NOT VALID, then VALIDATED. If legacy rows from the
--   pre-React era violate a constraint, validation fails for that constraint
--   and the migration logs a WARNING (it does not abort the deploy): the
--   constraint remains NOT VALID — still fully enforced for all NEW writes —
--   while the offending rows are listed for manual remediation. On the
--   disposable replay DB (and any clean DB) validation passes outright.
--   Verification queries per constraint are included as comments.
--
-- IDEMPOTENT: drop-if-exists before add.
-- ============================================================================

alter table public.invoice_lines
  drop constraint if exists chk_invoice_lines_quantity_nonneg,
  add constraint chk_invoice_lines_quantity_nonneg check (quantity >= 0) not valid;
alter table public.invoice_lines
  drop constraint if exists chk_invoice_lines_unit_price_nonneg,
  add constraint chk_invoice_lines_unit_price_nonneg check (unit_price >= 0) not valid;

alter table public.expense_lines
  drop constraint if exists chk_expense_lines_quantity_nonneg,
  add constraint chk_expense_lines_quantity_nonneg check (quantity >= 0) not valid;
alter table public.expense_lines
  drop constraint if exists chk_expense_lines_unit_price_nonneg,
  add constraint chk_expense_lines_unit_price_nonneg check (unit_price >= 0) not valid;

alter table public.inventory_balances
  drop constraint if exists chk_inventory_balances_on_hand_nonneg,
  add constraint chk_inventory_balances_on_hand_nonneg check (quantity_on_hand >= 0) not valid;
alter table public.inventory_balances
  drop constraint if exists chk_inventory_balances_reserved_nonneg,
  add constraint chk_inventory_balances_reserved_nonneg check (quantity_reserved >= 0) not valid;

alter table public.stock_transfer_lines
  drop constraint if exists chk_stock_transfer_lines_requested_nonneg,
  add constraint chk_stock_transfer_lines_requested_nonneg check (quantity_requested >= 0) not valid;
alter table public.stock_transfer_lines
  drop constraint if exists chk_stock_transfer_lines_dispatched_nonneg,
  add constraint chk_stock_transfer_lines_dispatched_nonneg check (quantity_dispatched >= 0) not valid;
alter table public.stock_transfer_lines
  drop constraint if exists chk_stock_transfer_lines_received_nonneg,
  add constraint chk_stock_transfer_lines_received_nonneg check (quantity_received >= 0) not valid;

alter table public.stock_movements
  drop constraint if exists chk_stock_movements_quantity_nonzero,
  add constraint chk_stock_movements_quantity_nonzero check (quantity <> 0) not valid;

-- Validate each constraint; on legacy violation, warn instead of failing the
-- deploy. The constraint stays NOT VALID (enforced for new writes).
do $$
declare
  c record;
begin
  for c in
    select conname, conrelid::regclass::text as tbl
      from pg_constraint
     where connamespace = 'public'::regnamespace
       and contype = 'c'
       and conname like 'chk_%'
       and not convalidated
  loop
    begin
      execute format('alter table %s validate constraint %I', c.tbl, c.conname);
      raise notice 'phase10 A-04: validated % on %', c.conname, c.tbl;
    exception when check_violation then
      raise warning 'phase10 A-04: constraint % on % has LEGACY violating rows; stays NOT VALID (new writes still enforced). Fix the data, then run: alter table % validate constraint %;', c.conname, c.tbl, c.tbl, c.conname;
    end;
  end loop;
end;
$$;

-- Manual verification queries (run if a warning above names a constraint):
--   select id, quantity            from public.invoice_lines       where quantity        < 0;
--   select id, unit_price          from public.invoice_lines       where unit_price      < 0;
--   select id, quantity            from public.expense_lines       where quantity        < 0;
--   select id, unit_price          from public.expense_lines       where unit_price      < 0;
--   select id, quantity_on_hand    from public.inventory_balances  where quantity_on_hand < 0;
--   select id, quantity_reserved   from public.inventory_balances  where quantity_reserved < 0;
--   select id, quantity_requested  from public.stock_transfer_lines where quantity_requested < 0;
--   select id, quantity_dispatched from public.stock_transfer_lines where quantity_dispatched < 0;
--   select id, quantity_received   from public.stock_transfer_lines where quantity_received   < 0;
--   select id, quantity            from public.stock_movements     where quantity        = 0;
