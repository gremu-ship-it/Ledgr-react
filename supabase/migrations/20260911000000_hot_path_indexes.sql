-- ============================================================================
-- 20260911000000_hot_path_indexes.sql
--
-- Transaction save-path and list-query indexes.
--
-- WHY: the base schema created NO indexes on the core business tables
-- (invoices, expenses, journal_entries, journal_lines, expense_lines,
-- invoice_lines, contacts, products, accounts, stock_movements,
-- inventory_balances, business_users). Every table has only its surrogate
-- `id` primary key, so every business-scoped query — and every RLS policy
-- check, which calls is_business_member()/can_write_business_data() and
-- scans business_users — degrades to a sequential scan as data grows.
--
-- The transaction save path touches most of these tables on EVERY save:
-- reserve_next_document_number → expenses insert → expense_lines insert →
-- journal_entries count (usage limit) → journal_entries insert →
-- journal_lines insert → journal_entries post → stock_movements insert →
-- inventory_balances recalc.
--
-- All statements are `create index if not exists` — idempotent, additive,
-- touch no data, safe to re-run. Each name is prefixed `idx_ledgr_` to
-- avoid collisions with indexes created out-of-band in the live project.
-- ============================================================================

-- ── 1. Header → detail lookups (run on every save and every document read) ──
create index if not exists idx_ledgr_invoice_lines_invoice
  on public.invoice_lines(invoice_id);
create index if not exists idx_ledgr_expense_lines_expense
  on public.expense_lines(expense_id);
create index if not exists idx_ledgr_invoice_payments_invoice
  on public.invoice_payments(invoice_id);
create index if not exists idx_ledgr_expense_payments_expense
  on public.expense_payments(expense_id);
create index if not exists idx_ledgr_journal_lines_entry
  on public.journal_lines(journal_entry_id);

-- ── 2. Business-scoped transaction lists (RLS filter + app sort columns) ────
-- Composite (business_id, date) serves both the business_id equality filter
-- (app + RLS) and the date sorts/ranges the pages use.
create index if not exists idx_ledgr_invoices_business_issue
  on public.invoices(business_id, issue_date desc);
create index if not exists idx_ledgr_expenses_business_date
  on public.expenses(business_id, expense_date desc);
-- Usage limit counts journal_entries by (business_id, entry_date >= month
-- start) on EVERY save; statements filter the same way.
create index if not exists idx_ledgr_journal_entries_business_date
  on public.journal_entries(business_id, entry_date);
create index if not exists idx_ledgr_journal_entries_source
  on public.journal_entries(source_type, source_id);

-- ── 3. Master data pickers (contacts/products/accounts on every form) ───────
create index if not exists idx_ledgr_contacts_business_type
  on public.contacts(business_id, contact_type);
create index if not exists idx_ledgr_products_business_active
  on public.products(business_id, is_active);
create index if not exists idx_ledgr_accounts_business_code
  on public.accounts(business_id, code);

-- ── 4. Inventory movements and balances ─────────────────────────────────────
create index if not exists idx_ledgr_stock_movements_product
  on public.stock_movements(product_id);
create index if not exists idx_ledgr_stock_movements_business_date
  on public.stock_movements(business_id, movement_date desc);
create index if not exists idx_ledgr_inventory_balances_product
  on public.inventory_balances(business_id, product_id);

-- ── 5. RLS membership lookups ───────────────────────────────────────────────
-- is_business_member()/can_write_business_data() scan business_users on
-- EVERY row of EVERY business-scoped query. This index turns that scan
-- into a single index probe.
create index if not exists idx_ledgr_business_users_business_user
  on public.business_users(business_id, user_id);
