-- ============================================================================
-- Deterministic idempotency key for ledger postings.
--
-- Every posting this app makes now carries a stable key in the new
-- journal_entries.posting_key column, e.g.
--   invoice:<uuid>:sale              the revenue/receivable entry for a sale
--   invoice:<uuid>:receipt           the auto-receipt for a paid invoice
--   invoice:<uuid>:settlement:<uuid> one payment against an invoice
--   expense:<uuid>:payment:<uuid>    one payment against an expense
--   payroll:<uuid>                   a payroll run
--   invoice:<uuid>:cogs              cost of sales released for a sale
--
-- The posting functions read the key before writing: if the entry is already
-- there they resume it (posting it if a crash left it as a draft) instead of
-- creating a second one.
--
-- Why this is needed: writers are retried. A client-side timeout or a lost
-- response *after* the server committed leaves the caller believing the write
-- failed, so `retryNonCritical` (or a queue replay) runs it again. Without a
-- key the second attempt posted the same revenue, cash, receivable and cost
-- of sales twice.
--
-- Why a new column instead of the existing reference:
--   `reference` is free text typed by users in the journal-entry form and
--   searched in the Journals list. A unique index on it would reject a second
--   manual entry that legitimately repeats a reference ("March rent"), which
--   is a user-facing behaviour change no accounting feature should make.
--   `posting_key` is internal, machine-generated, and never shown or typed.
--
-- This index is the backstop: even if a client-side lookup is skipped or
-- races, (business_id, posting_key) can only exist once, so a duplicate
-- insert is rejected by the database rather than silently corrupting the
-- ledger.
--
-- Partial (WHERE posting_key IS NOT NULL) so historical entries and
-- non-keyed postings (manual entries, reversals, imports) stay unrestricted.
--
-- Guarded with to_regclass() because the core financial tables are created
-- out-of-band (schema.sql is empty) in some environments. Idempotent.
-- ============================================================================

do $$
begin
  if to_regclass('public.journal_entries') is null then
    raise notice 'Table public.journal_entries not found, skipping posting_key index.';
    return;
  end if;

  execute 'alter table public.journal_entries add column if not exists posting_key text';

  execute $ddl$
    create unique index if not exists journal_entries_posting_key_uidx
      on public.journal_entries (business_id, posting_key)
      where posting_key is not null
  $ddl$;
end;
$$;

comment on column public.journal_entries.posting_key is
  'Deterministic posting key (e.g. invoice:<id>:sale). Unique per business when set; lets a retried posting resume the entry it already made instead of duplicating it. Internal — never shown to users. See migration 20260921000000.';

-- Fast lookup for the resumption path (`findByPostingKey`). The unique index
-- above already serves it; this comment records the intent so a future schema
-- cleanup does not drop it as redundant.
