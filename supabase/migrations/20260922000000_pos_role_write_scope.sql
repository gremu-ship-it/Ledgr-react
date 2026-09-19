-- ============================================================================
-- 20260922000000_pos_role_write_scope.sql
--
-- Narrow the single canWrite tier for the two modules POS roles must not
-- touch. Background:
--
--   20260728000008 gave every writing role one blunt tier, can_write_business_data,
--   shared by 34 tables. That is correct for the six original roles but too
--   loose for the POS roles added in 20260920000000, whose whole point is a
--   constrained job:
--
--     cashier      — sells at the till. Has no expense UI and no expense duty
--                    (DEFAULT_ROLE_PERMISSIONS.cashier in src/types/pos.ts has
--                    no view_expenses), yet the shared tier let a cashier
--                    INSERT into expenses.
--     stock_clerk  — receives and transfers stock. Has no sales duty and no
--                    /pos route at all (usePermissions.isPathAllowedForRole),
--                    yet the shared tier let a stock clerk mint sales invoices.
--
--   This migration carves out two scoped tiers for those tables only. It does
--   NOT touch the ledger tier: posService.processSale posts the sales journal
--   from the browser (step 7, journalService) and records payments, so a
--   cashier session must keep INSERT on invoices/invoice_lines/
--   invoice_payments/journal_entries for the till to work at all. Restricting
--   the ledger requires moving sale posting behind a SECURITY DEFINER RPC
--   first; see the header of 20260920000000_pos_module.sql for the module's
--   own scope. Reads are deliberately unchanged (business-wide read tier).
--
--   Verification: tests/database/rls_security.test.js section "8B.4" asserts,
--   as SET ROLE authenticated, that
--     cashier     INSERT expenses  -> denied   INSERT invoices -> allowed
--     stock_clerk INSERT invoices  -> denied   INSERT stock_movements -> allowed
--     owner/admin/accountant INSERT expenses/invoices -> allowed (unchanged)
--   Run against a replayed schema via the embedded-postgres harness described
--   in docs/database/database-operations.md.
--
-- Idempotent. Touches no data.
-- ============================================================================


-- ── 1. Scoped write tiers ────────────────────────────────────────────────────
-- Same shape as can_write_business_data (SECURITY DEFINER so a policy can read
-- business_users without the caller holding a policy on it; search_path pinned
-- per Supabase linter 0011).

create or replace function public.can_write_sales_data(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- can_write_business_data minus 'stock_clerk'. Stock clerks hold no
        -- sales permission (DEFAULT_ROLE_PERMISSIONS.stock_clerk) and have no
        -- route into the POS or the income/invoice screens.
        'owner',
        'admin',
        'accountant',
        'supervisor',
        'data_entry',
        'inventory_manager',
        'sales_clerk',
        'purchasing_officer',
        'warehouse_worker',
        'sales_manager',
        'customer_service_rep',
        'tax_compliance_officer',
        'treasury_manager',
        'asset_manager',
        'branch_manager',
        'cashier',
        'manager'
      )
  );
$$;

comment on function public.can_write_sales_data(uuid) is
  'Write tier for sales documents (invoices, invoice_lines, invoice_payments): can_write_business_data minus stock_clerk, who has no sales duty or POS route. Cashiers MUST remain included — posService.postSale records the sale and its payments from the browser. Keep in sync with DEFAULT_ROLE_PERMISSIONS in src/types/pos.ts.';


create or replace function public.can_write_expense_data(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.business_users bu
    where bu.business_id = p_business_id
      and bu.user_id = auth.uid()
      and bu.is_active = true
      and bu.role::text in (
        -- can_write_business_data minus 'cashier' and 'stock_clerk'. Neither
        -- role has an expense screen (no view_expenses) and no POS or stock
        -- flow writes an expense row: till cash movements go to
        -- pos_cash_movements, stock receipts to stock_movements.
        'owner',
        'admin',
        'accountant',
        'supervisor',
        'data_entry',
        'inventory_manager',
        'sales_clerk',
        'purchasing_officer',
        'warehouse_worker',
        'sales_manager',
        'customer_service_rep',
        'tax_compliance_officer',
        'treasury_manager',
        'asset_manager',
        'branch_manager',
        'manager'
      )
  );
$$;

comment on function public.can_write_expense_data(uuid) is
  'Write tier for the expense module (expenses, expense_lines, expense_payments): can_write_business_data minus cashier and stock_clerk, who have no expense screen and no flow that writes an expense row. Mirrors the absence of view_expenses in DEFAULT_ROLE_PERMISSIONS for both roles.';


revoke all on function public.can_write_sales_data(uuid)   from public;
revoke all on function public.can_write_expense_data(uuid) from public;

grant execute on function public.can_write_sales_data(uuid)   to authenticated, service_role;
grant execute on function public.can_write_expense_data(uuid) to authenticated, service_role;


-- ── 2. Sales documents — writer tier minus stock_clerk ───────────────────────

drop policy if exists invoices_writer_insert on public.invoices;
create policy invoices_writer_insert on public.invoices
  for insert with check (public.can_write_sales_data(business_id));

drop policy if exists invoices_writer_update on public.invoices;
create policy invoices_writer_update on public.invoices
  for update using (public.can_write_sales_data(business_id))
            with check (public.can_write_sales_data(business_id));

drop policy if exists invoice_lines_writer_insert on public.invoice_lines;
create policy invoice_lines_writer_insert on public.invoice_lines
  for insert with check (public.can_write_sales_data(business_id));

drop policy if exists invoice_lines_writer_update on public.invoice_lines;
create policy invoice_lines_writer_update on public.invoice_lines
  for update using (public.can_write_sales_data(business_id))
            with check (public.can_write_sales_data(business_id));

drop policy if exists invoice_payments_writer_insert on public.invoice_payments;
create policy invoice_payments_writer_insert on public.invoice_payments
  for insert with check (public.can_write_sales_data(business_id));

drop policy if exists invoice_payments_writer_update on public.invoice_payments;
create policy invoice_payments_writer_update on public.invoice_payments
  for update using (public.can_write_sales_data(business_id))
            with check (public.can_write_sales_data(business_id));


-- ── 3. Expense module — writer tier minus cashier and stock_clerk ────────────

drop policy if exists expenses_writer_insert on public.expenses;
create policy expenses_writer_insert on public.expenses
  for insert with check (public.can_write_expense_data(business_id));

drop policy if exists expenses_writer_update on public.expenses;
create policy expenses_writer_update on public.expenses
  for update using (public.can_write_expense_data(business_id))
            with check (public.can_write_expense_data(business_id));

drop policy if exists expense_lines_writer_insert on public.expense_lines;
create policy expense_lines_writer_insert on public.expense_lines
  for insert with check (public.can_write_expense_data(business_id));

drop policy if exists expense_lines_writer_update on public.expense_lines;
create policy expense_lines_writer_update on public.expense_lines
  for update using (public.can_write_expense_data(business_id))
            with check (public.can_write_expense_data(business_id));

drop policy if exists expense_payments_writer_insert on public.expense_payments;
create policy expense_payments_writer_insert on public.expense_payments
  for insert with check (public.can_write_expense_data(business_id));

drop policy if exists expense_payments_writer_update on public.expense_payments;
create policy expense_payments_writer_update on public.expense_payments
  for update using (public.can_write_expense_data(business_id))
            with check (public.can_write_expense_data(business_id));
