-- ============================================================================
-- 20260913000000_performance_list_queries.sql
--
-- Follow-up to 20260911000000_hot_path_indexes.sql.
--
-- WHY: every list view in the app filters by business_id AND
-- `deleted_at IS NULL` AND (often) `is_active = true` / status = '...',
-- then orders by issue_date/expense_date DESC. The existing composite
-- indexes lead on (business_id, date) and leave Postgres to re-check the
-- other predicates against the heap. Adding deleted_at/status into the
-- index key (or using partial indexes for the common "live data" case)
-- turns list views into pure index range scans — especially important
-- once a business has 1000+ invoices/expenses/contacts, which is where
-- the UI currently starts feeling sluggish.
--
-- Also adds a couple of targeted indexes the first migration missed:
-- client_key lookups (idempotency replay path for quick saves) and the
-- (business_id, is_active) combo on master-data tables the pickers hit.
--
-- IMPORTANT: not every table has a deleted_at column. The partial
-- indexes below only add `where deleted_at is null` on tables that
-- actually define the column (invoices, expenses, contacts, products,
-- accounts). Tables like journal_entries, journal_lines, *_payments,
-- business_users, stock_movements never had soft-delete added.
--
-- All `create index if not exists`, additive, safe to re-run.
-- ============================================================================

-- ── Partial indexes on LIVE rows ───────────────────────────────────────────
-- Partial indexes are SMALL (they only contain non-deleted rows) and match
-- the exact predicate used by 99% of queries. Only applied to tables that
-- actually have a deleted_at column.

create index if not exists idx_ledgr_invoices_live_recent
  on public.invoices(business_id, issue_date desc)
  where deleted_at is null;

create index if not exists idx_ledgr_expenses_live_recent
  on public.expenses(business_id, expense_date desc)
  where deleted_at is null;

create index if not exists idx_ledgr_contacts_live_active
  on public.contacts(business_id, contact_type, name)
  where deleted_at is null and is_active = true;

create index if not exists idx_ledgr_products_live_active
  on public.products(business_id, name)
  where deleted_at is null and is_active = true;

create index if not exists idx_ledgr_accounts_live
  on public.accounts(business_id, code)
  where deleted_at is null;

-- ── Status-filtered list views ─────────────────────────────────────────────
-- The dashboard and status tabs filter by status. A composite
-- (business_id, status, date) lets Postgres jump straight to the slice.

create index if not exists idx_ledgr_invoices_business_status_date
  on public.invoices(business_id, status, issue_date desc)
  where deleted_at is null;

create index if not exists idx_ledgr_expenses_business_status_date
  on public.expenses(business_id, status, expense_date desc)
  where deleted_at is null;

-- ── Idempotency replay lookups ────────────────────────────────────────────
-- 20260813000003_add_client_key_idempotency.sql already creates a UNIQUE
-- index on (business_id, client_key) for invoices, expenses,
-- invoice_payments, expense_payments, payroll_runs and stock_movements,
-- so client_key lookups already have a usable index — no duplicates needed.

-- ── Journal entries by status ──────────────────────────────────────────────
-- "Needs posting" filter on expenses scans for journal_entry_id is null;
-- journal_entries itself has NO deleted_at column (never soft-deleted —
-- entries are voided via a reversing entry, not removed).

create index if not exists idx_ledgr_expenses_unposted
  on public.expenses(business_id, expense_date desc)
  where journal_entry_id is null and deleted_at is null;

create index if not exists idx_ledgr_journal_entries_business_posted
  on public.journal_entries(business_id, entry_date desc);

-- ── Help Postgres pick good plans ─────────────────────────────────────────
analyse public.invoices;
analyse public.expenses;
analyse public.contacts;
analyse public.products;
analyse public.accounts;
analyse public.journal_entries;
analyse public.business_users;
