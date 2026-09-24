-- R06 — Single authoritative stock-movement → balance propagation.
--
-- Register anchor (R06): "Version one authoritative stock-movement→balance
-- mechanism and test concurrent sales/receipts. Do not install a second
-- updater alongside an unknown live trigger."
--
-- Pre-migration inventory (verified mechanically before authoring, on the
-- database that authoring was pointed at):
--   * That database carried NO trigger on public.stock_movements. Its migration
--     history stopped before 20260925000001_stock_movement_balance_delta_trigger
--     .sql — so this claim was true OF THAT DATABASE and false of the shipped
--     chain. The delivered chain already installs
--     trg_stock_movements_apply_inventory_balance (20260925000001, events
--     INSERT/UPDATE/DELETE, function public.update_inventory_balance()).
--     (Corrected 2026-09-24; see "Single-writer reconciliation" at the bottom
--     for the consequence and the fix. Installing this file's writer next to
--     that one applied every movement twice: a sale of 1 took 100 -> 98. That
--     is the same "two additive triggers on one insert" defect 20260925000001
--     was written to end, re-introduced by an inventory verified against a
--     database that was behind the chain.)
--   * The only writers of public.inventory_balances in the entire migration
--     chain are the offline/backfill reconciliation RPCs
--     (20260728000002_recalculate_historical_inventory_stock.sql and its fix
--     20260730000005_fix_inventory_backfill_costing_and_authz.sql), which
--     REBUILD balances from stock_movements in batch — they are reconcilers,
--     not an online propagation mechanism.
--   * Online posting commands (post_pos_sale / _ledgr_complete_pos_sale,
--     quick_save_rpc) INSERT stock_movements rows only; balances never moved
--     on the hot path (evidence POS.STOCK: sale inserted a movement while
--     quantity_on_hand stayed at the seeded value).
--
-- This migration therefore installs THE online propagation mechanism, and —
-- since that inventory turned out to be stale — it removes every OTHER
-- balance-maintaining trigger before installing its own, then asserts the
-- resulting shape. It never assumes a database is behind the chain.
--
-- Semantics (deliberately minimal, movement-sign driven):
--   * Movement quantities are signed by convention everywhere in the chain:
--     inbound (purchase/receipt) positive, outbound (sale) negative. The
--     balance simply applies NEW.quantity.
--   * Inbound movements with a positive unit_cost update the weighted-average
--     cost. Inbound with null/zero cost propagates quantity only and leaves
--     average_cost unchanged — zero/unknown cost is never silently substituted
--     into valuation (register R06 unknown-cost rule; a valuation-policy
--     decision for missing cost is finance-owned, not invented here).
--   * Outbound constraint: the existing chk_inventory_balances_on_hand_nonneg
--     check (20260817000001) is the approved oversell policy — a movement that
--     would take on_hand negative raises 23514 inside the posting command's
--     transaction. Concurrent sales of the final unit serialize on the locked
--     balance row; the later commit fails with the same denial.
--   * Exactly-once: balance effects happen exactly once per inserted movement
--     row — which requires that this is the ONLY balance-maintaining trigger on
--     public.stock_movements. The posting commands already gate movement
--     insertion per
--     (business_id, source_type, source_id), so command replay does not
--     re-apply (verified by R06.POS.REPLAY-EXACTLY-ONCE).
--
-- Backfill interplay: the reconciliation RPCs insert missing movement rows and
-- then rebuild the balance rows wholesale from movements; each inserted
-- movement propagates through this trigger first and the subsequent rebuild
-- converges to the same canonical values — no double count.

-- One authoritative balance row per logical key is already enforced by the
-- base schema's `unique (business_id, product_id, location_id)` constraint on
-- public.inventory_balances (20250101000000, line ~2191 — sanctioned
-- "migrations use ON CONFLICT on these columns"). That constraint is the
-- row-level serialization point this trigger locks; no new index needed.

create or replace function public._ledgr_apply_stock_movement_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $func$
declare
    v_balance record;
    v_new_on_hand numeric;
    v_new_avg numeric;
    v_quantity_available_is_generated boolean := false;
begin
    -- The R06 writer owns INSERT — the only path the posting commands use, and
    -- the path this migration's valuation policy is specified for. UPDATE and
    -- DELETE of a movement are out-of-band (movements are append-only by
    -- convention: post_pos_sale / quick_save / the R07 corrections all INSERT).
    -- They are still handled, by the net-delta helper 20260925000001 already
    -- ships, so that a direct edit or removal cannot silently desynchronise the
    -- balance row behind a green deploy.
    if tg_op <> 'INSERT' then
        if tg_op = 'DELETE' then
            perform public._ledgr_apply_stock_movement_delta(
                old.business_id, old.product_id, old.location_id, -old.quantity, null, null
            );
            return old;
        end if;
        if new.business_id = old.business_id
           and new.product_id = old.product_id
           and new.location_id = old.location_id then
            if new.quantity <> old.quantity then
                perform public._ledgr_apply_stock_movement_delta(
                    new.business_id, new.product_id, new.location_id,
                    new.quantity - old.quantity, new.unit_cost, coalesce(new.created_at, now())
                );
            end if;
        else
            perform public._ledgr_apply_stock_movement_delta(
                old.business_id, old.product_id, old.location_id, -old.quantity, null, null
            );
            perform public._ledgr_apply_stock_movement_delta(
                new.business_id, new.product_id, new.location_id,
                new.quantity, new.unit_cost, coalesce(new.created_at, now())
            );
        end if;
        return new;
    end if;

    -- Ensure the authoritative balance row exists, then lock it for this
    -- posting's propagation. Concurrent postings serialize on this row.
    insert into public.inventory_balances
        (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, average_cost, last_movement_at)
    values
        (NEW.business_id, NEW.product_id, NEW.location_id, 0, 0, 0, now())
    on conflict (business_id, product_id, location_id) do nothing;

    select *
      into v_balance
      from public.inventory_balances
     where business_id = NEW.business_id
       and product_id = NEW.product_id
       and location_id = NEW.location_id
     for update;

    if not found then
        raise exception 'Stock balance row unavailable for business %, product %, location %',
            NEW.business_id, NEW.product_id, NEW.location_id
          using errcode = 'check_violation';
    end if;

    v_new_on_hand := coalesce(v_balance.quantity_on_hand, 0) + coalesce(NEW.quantity, 0);

    -- Weighted-average cost on costed inbound only; everything else keeps the
    -- incumbent average (outbound never re-prices; zero-cost inbound does not
    -- silently substitute zero valuation).
    if coalesce(NEW.quantity, 0) > 0
       and coalesce(NEW.unit_cost, 0) > 0
       and v_new_on_hand > 0 then
        v_new_avg := (coalesce(v_balance.quantity_on_hand, 0) * coalesce(v_balance.average_cost, 0)
                      + coalesce(NEW.quantity, 0) * coalesce(NEW.unit_cost, 0))
                     / v_new_on_hand;
    else
        v_new_avg := coalesce(v_balance.average_cost, 0);
    end if;

    update public.inventory_balances
       set quantity_on_hand = v_new_on_hand,
           average_cost = v_new_avg,
           last_movement_at = now()
     where id = v_balance.id;

    -- quantity_available is derived (on_hand - reserved). On the hosted project
    -- it is a STORED GENERATED column and must never be written (SQLSTATE
    -- 428C9); in repository-built environments it is a plain column and has to
    -- be kept in sync explicitly, exactly as 20260925000001 does.
    select exists (
      select 1 from pg_attribute
       where attrelid = 'public.inventory_balances'::regclass
         and attname = 'quantity_available'
         and attgenerated = 's'
    ) into v_quantity_available_is_generated;

    if not v_quantity_available_is_generated then
      update public.inventory_balances
         set quantity_available = v_new_on_hand - coalesce(v_balance.quantity_reserved, 0)
       where id = v_balance.id;
    end if;

    return NEW;
end;
$func$;

-- ── Single-writer reconciliation (2026-09-24) ───────────────────────────────
-- The chain already contains a balance writer: 20260925000001 installs
-- trg_stock_movements_apply_inventory_balance -> public.update_inventory_balance()
-- (INSERT/UPDATE/DELETE). Two additive writers on one INSERT is the exact
-- double-count 20260925000001 was written to end (10 in, 20 on hand), so the
-- R06 writer must not be installed alongside it.
--
-- Drop every trigger on public.stock_movements that maintains
-- public.inventory_balances — by name, by function name, or by function body —
-- keeping unrelated guards (trg_stock_immutable is a guard, not a writer). The
-- predicate is 20260925000001's own, so both migrations agree on what a
-- balance-maintaining trigger is. Every decision is logged for the deploy log.
do $$
declare
    trigger_record record;
begin
    for trigger_record in
        select
            t.tgname,
            p.proname,
            (
                t.tgname ilike '%balance%'
                or p.proname ilike '%balance%'
                or p.prosrc ~* '(insert\s+into|update)\s+(public\.)?inventory_balances\M'
            ) as maintains_balances
        from pg_trigger t
        join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = 'public.stock_movements'::regclass
          and not t.tgisinternal
        order by t.tgname
    loop
        if trigger_record.maintains_balances then
            raise notice 'R06 dropping previous balance trigger % (function %) on public.stock_movements',
                trigger_record.tgname, trigger_record.proname;
            execute format('drop trigger if exists %I on public.stock_movements', trigger_record.tgname);
        else
            raise notice 'R06 keeping unrelated trigger % (function %) on public.stock_movements',
                trigger_record.tgname, trigger_record.proname;
        end if;
    end loop;
end $$;

create trigger trg_stock_movement_apply_balance
    after insert or update or delete on public.stock_movements
    for each row execute function public._ledgr_apply_stock_movement_balance();

-- Assert the shape this file promises: exactly one balance-maintaining trigger
-- remains. A second writer fails the migration (and therefore the deploy)
-- loudly instead of silently double-counting stock again.
do $$
declare
    v_count integer;
    v_names text;
begin
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
        raise exception 'R06 requires exactly one balance-maintaining trigger on public.stock_movements; found % (%)', v_count, coalesce(v_names, 'none')
          using errcode = 'check_violation';
    end if;

    raise notice 'R06 single balance writer verified: %', v_names;
end $$;

comment on function public._ledgr_apply_stock_movement_balance() is
    'R06 single authoritative online stock-movement → balance propagation: applies the signed movement quantity to the one balance row per (business, product, location); weighted-average cost updates on costed inbound only (never silent zero-cost substitution); oversell denial delegated to chk_inventory_balances_on_hand_nonneg (23514). Fires on INSERT (the posting-command path this policy is specified for); movement UPDATE/DELETE — out-of-band, movements being append-only by convention — are net-deltaed through public._ledgr_apply_stock_movement_delta so a direct edit cannot desynchronise the balance. Movement insertion remains gated per (business_id, source_type, source_id) by the posting commands, so balance effects apply exactly once per posted document.';
