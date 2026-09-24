-- ============================================================================
-- 20261009000000_r06_single_stock_balance_writer.sql
--
-- R06 register anchor: "Version one authoritative stock-movement→balance
-- mechanism and test concurrent sales/receipts. Do not install a second
-- updater alongside an unknown live trigger."
--
-- Why this migration exists
-- ─────────────────────────
-- On 2026-09-24 the delivered chain contained TWO balance-maintaining triggers
-- on public.stock_movements at once:
--
--   trg_stock_movements_apply_inventory_balance -> public.update_inventory_balance()
--        (20260925000001, events INSERT/UPDATE/DELETE)
--   trg_stock_movement_apply_balance          -> public._ledgr_apply_stock_movement_balance()
--        (20260928000001, events INSERT then)
--
-- Both are additive, so every movement was applied twice: a sale of 1 took
-- quantity_on_hand 100 → 98, an inbound of 10 took it 100 → 120. That is the
-- same class of defect (10 received, 20 on hand) 20260925000001 was written to
-- end. It surfaced as 18 FAIL records in the R13 release evidence
-- (R06.POS.STOCK.*, R06.POS.*, R093.RECON.*).
--
-- 20260928000001 now drops every competing balance trigger before installing
-- its own and asserts the shape — that repairs the chain for every database
-- that has not yet applied it. This migration covers the one case that file
-- cannot reach: a database where 20260928000001 is ALREADY recorded as applied
-- (out-of-band `psql`/manual push, or a `migration repair --status applied`),
-- because an applied version is never re-run. The stock ledger is money; a
-- double-count must not be something only a fresh replay can detect.
--
-- Idempotent: on a database that already has exactly the R06 writer this file
-- drops nothing, creates nothing, and logs verification. It never rewrites a
-- balance row, so it cannot change stock levels.
-- ============================================================================

do $$
declare
    trigger_record record;
    v_names text;
    v_count integer;
begin
    -- 1. Remove every balance-maintaining trigger that is not the R06 writer.
    --    Predicate shared with 20260925000001/20260928000001: by trigger name,
    --    by function name, or by the function body writing inventory_balances.
    for trigger_record in
        select t.tgname, p.proname
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'public.stock_movements'::regclass
          and not t.tgisinternal
          and t.tgname <> 'trg_stock_movement_apply_balance'
          and (
            t.tgname ilike '%balance%'
            or p.proname ilike '%balance%'
            or p.prosrc ~* '(insert\s+into|update)\s+(public\.)?inventory_balances\M'
          )
        order by t.tgname
    loop
        raise notice 'R06 invariant: dropping competing balance trigger % (function %)',
            trigger_record.tgname, trigger_record.proname;
        execute format('drop trigger if exists %I on public.stock_movements', trigger_record.tgname);
    end loop;

    -- 2. Ensure the canonical R06 writer exists.
    if not exists (
        select 1 from pg_trigger
        where tgrelid = 'public.stock_movements'::regclass
          and tgname = 'trg_stock_movement_apply_balance'
          and not tgisinternal
    ) then
        if to_regprocedure('public._ledgr_apply_stock_movement_balance()') is null then
            raise exception 'R06 invariant: balance writer function missing; 20260928000001 did not apply'
              using errcode = 'undefined_function';
        end if;
        raise notice 'R06 invariant: installing missing canonical balance trigger';
        execute 'create trigger trg_stock_movement_apply_balance'
             || ' after insert or update or delete on public.stock_movements'
             || ' for each row execute function public._ledgr_apply_stock_movement_balance()';
    end if;

    -- 3. Assert the invariant this migration exists to protect.
    select count(*), string_agg(t.tgname, ', ' order by t.tgname)
      into v_count, v_names
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = 'public.stock_movements'::regclass
       and not t.tgisinternal
       and (
         t.tgname ilike '%balance%'
         or p.proname ilike '%balance%'
         or p.prosrc ~* '(insert\s+into|update)\s+(public\.)?inventory_balances\M'
       );

    if v_count <> 1 then
        raise exception 'R06 invariant violated: % balance-maintaining triggers on public.stock_movements (%)',
            v_count, coalesce(v_names, 'none')
          using errcode = 'check_violation';
    end if;

    raise notice 'R06 invariant verified: exactly one balance writer (%)', v_names;
end $$;
