-- ============================================================================
-- Add a client-generated idempotency key to offline-created financial records.
--
-- The offline sync engine (src/offline/syncEngine.ts) previously performed
-- plain inserts with no idempotency. If the network dropped AFTER the server
-- committed a write but BEFORE the local queue item was marked 'synced', the
-- next sync pass re-inserted the same record — creating a duplicate invoice,
-- expense or payment, and double-counting in the ledger and reports.
--
-- Each offline queue item now carries a stable `client_key` (a UUID generated
-- once at enqueue time). The repository passes it through to the insert, and
-- the unique index below is the database backstop: a second insert of the
-- same (business_id, client_key) is rejected, and the caller re-reads the
-- existing row instead of creating a duplicate.
--
-- A full unique index (not partial) is used so Supabase's `.upsert()` /
-- `onConflict: 'business_id,client_key'` can target it. NULL client_key rows
-- (ordinary online writes) are treated as distinct by Postgres, so normal
-- traffic is unaffected.
--
-- Guarded with to_regclass() because the core financial tables are created
-- out-of-band (schema.sql is empty). Idempotent.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'invoices',
    'expenses',
    'invoice_payments',
    'expense_payments',
    'payroll_runs',
    'stock_movements'
  ]
  loop
    if to_regclass('public.' || t) is null then
      raise notice 'Table public.% not found, skipping client_key idempotency.', t;
      continue;
    end if;

    execute format('alter table public.%I add column if not exists client_key uuid', t);
    execute format(
      'create unique index if not exists %I on public.%I (business_id, client_key)',
      t || '_client_key_uidx', t
    );
  end loop;
end;
$$;
