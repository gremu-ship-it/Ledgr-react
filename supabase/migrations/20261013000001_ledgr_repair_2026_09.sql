-- HISTORICAL DATA REPAIR 2026-09 — owner authorised 2026-09-26 (A. Gremu).
--
-- THIS MIGRATION CHANGES NO DATA. It installs a private, non-API schema
-- `ledgr_repair` with:
--   * plan_2026_09(business?)      read-only sizing: every proposed correction
--   * plan_hash_2026_09(business?) fingerprint of that plan
--   * apply_2026_09(evidence_ref, expected_plan_hash, business?)
--         applies EXACTLY the reviewed plan in ONE transaction, or nothing.
-- Nothing is executable by anon/authenticated and the schema is not exposed
-- through PostgREST. Operators run it via the Management API workflow
-- (.github/workflows/repair-2026-09-inventory.yml): size → review → apply.
--
-- Principles: no DELETE, no UPDATE of historical movements/journals/invoices/
-- payments, no direct inventory_balances writes. Every correction is a NEW,
-- labelled, idempotent row (compensating movement through the R06 trigger, or
-- a keyed journal entry) and is logged in ledgr_repair.repair_log.
--
-- Categories
--   D0_QTY_DRIFT             inventory_balances ≠ Σ movements. REPORT ONLY: a
--                            movement cannot close it (the trigger moves both
--                            sides); resolve by physical count.
--   D1_INVALID_SALE_MOVEMENT stock released for a draft / credit-note invoice,
--                            or for a void invoice with no offsetting return
--                            (the backfill status defect). Fix: compensating
--                            adjustment_in at the original unit cost.
--   D2_MISSING_COGS          a live sale moved stock but no COGS entry exists
--                            (legacy client partials). Fix: post the keyed
--                            COGS entry (invoice:<id>:cogs) at movement cost.
--   D3_GL_RECONCILIATION     inventory GL (114* + linked product accounts,
--                            opening + posted/reversed lines — the SOFP
--                            number) ≠ stock subledger (Σ qty × average_cost)
--                            AFTER D1/D2, incl. the 20261010000000 balance
--                            rewrite and swallowed receipt/adjustment
--                            journals. Fix: one keyed true-up per business,
--                            1141 ↔ 5180 (the app's reconciliation rule).

create schema if not exists ledgr_repair;
revoke all on schema ledgr_repair from public, anon, authenticated;
grant usage on schema ledgr_repair to service_role;

create table if not exists ledgr_repair.runs (
  run_id       uuid primary key default gen_random_uuid(),
  evidence_ref text not null check (length(btrim(evidence_ref)) >= 8),
  plan_hash    text not null,
  business_id  uuid,
  applied_at   timestamptz not null default now(),
  applied_by   text not null default current_user,
  summary      jsonb not null default '{}'::jsonb
);
create table if not exists ledgr_repair.repair_log (
  id          bigserial primary key,
  run_id      uuid not null references ledgr_repair.runs(run_id),
  business_id uuid not null,
  category    text not null,
  object_ref  text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
revoke all on all tables in schema ledgr_repair from public, anon, authenticated;
revoke all on all sequences in schema ledgr_repair from public, anon, authenticated;

-- Inventory GL balance per business, mirroring computeInventoryLedgerBalance.
create or replace function ledgr_repair._gl_inventory(p_business uuid)
returns numeric language sql stable set search_path = public as $$
  with accts as (
    select a.id, a.normal_balance, coalesce(a.opening_balance, 0) ob
      from public.accounts a
     where a.business_id = p_business and not a.is_group
       and (a.code like '114%' or a.id in (select inventory_account_id from public.products
                                           where business_id = p_business and inventory_account_id is not null))
  )
  select coalesce((select sum(ob) from accts), 0) + coalesce((
    select sum(case when a.normal_balance = 'credit' then -1 else 1 end
               * case when l.is_debit then l.amount_base else -l.amount_base end)
      from public.journal_lines l
      join public.journal_entries e on e.id = l.journal_entry_id
      join accts a on a.id = l.account_id
     where e.business_id = p_business and e.status in ('posted', 'reversed')), 0);
$$;

create or replace function ledgr_repair._subledger_value(p_business uuid)
returns numeric language sql stable set search_path = public as $$
  select coalesce(sum(quantity_on_hand * average_cost), 0) from public.inventory_balances where business_id = p_business;
$$;

create or replace function ledgr_repair.plan_2026_09(p_business uuid default null)
returns table (category text, business_id uuid, object_ref text, product_id uuid, location_id uuid,
               quantity numeric, amount numeric, detail jsonb)
language sql stable set search_path = public
as $$
  with
  inv as (
    select i.* from public.invoices i where p_business is null or i.business_id = p_business
  ),
  refs as (  -- every movement that references an invoice (sale, R07/legacy returns, prior repair)
    select i.id invoice_id, sm.*
      from inv i
      join public.stock_movements sm
        on sm.business_id = i.business_id
       and (sm.source_id = i.id::text or sm.source_id like i.id::text || ':%')
  ),
  d1_candidates as (
    select i.id, i.business_id, i.invoice_number, i.status::text st,
           (i.status::text = 'credit_note' or coalesce(i.invoice_type, '') = 'credit_note') is_cn
      from inv i
     where (i.status::text in ('draft', 'void', 'credit_note') or coalesce(i.invoice_type, '') = 'credit_note')
       and not exists (select 1 from public.stock_movements r
                        where r.business_id = i.business_id and r.source_type = 'repair_2026_09'
                          and r.source_id = i.id::text)
  ),
  d1 as (
    select 'D1_INVALID_SALE_MOVEMENT'::text category, c.business_id, c.id::text object_ref, s.product_id,
           s.location_id,
           -- draft / credit note: every ordinary sale release was invalid.
           -- void: only the part not already offset by a return.
           case when c.st = 'draft' or c.is_cn then -s.sale_qty
                else least(-s.sale_qty, -coalesce(n.net_qty, 0)) end quantity,
           s.unit_cost,
           c.invoice_number, c.st
      from d1_candidates c
      join lateral (
        select r.product_id, max(r.location_id::text)::uuid location_id, sum(r.quantity) sale_qty,
               round(sum(r.quantity * r.unit_cost) / nullif(sum(r.quantity), 0), 6) unit_cost
          from refs r
         where r.invoice_id = c.id and r.source_type = 'invoice' and r.movement_type::text = 'sale' and r.quantity < 0
         group by r.product_id
      ) s on true
      left join lateral (
        select sum(r.quantity) net_qty from refs r where r.invoice_id = c.id and r.product_id = s.product_id
      ) n on true
  ),
  d2_inv as (
    select i.id, i.business_id, i.invoice_number
      from inv i
     where i.status::text in ('sent', 'paid', 'partially_paid', 'overdue')
       and coalesce(i.invoice_type, '') <> 'credit_note'
       and not exists (select 1 from public.journal_entries e
                        where e.business_id = i.business_id
                          and ((e.source_type = 'inventory_cogs' and e.source_id = i.id::text)
                               or e.posting_key = 'invoice:' || i.id::text || ':cogs'))
  ),
  d2 as (
    select 'D2_MISSING_COGS'::text category, d.business_id, d.id::text object_ref, r.product_id, null::uuid location_id,
           -sum(r.quantity) quantity, round(sum(-r.quantity * r.unit_cost), 2) amount, d.invoice_number
      from d2_inv d
      join refs r on r.invoice_id = d.id and r.source_type = 'invoice' and r.movement_type::text = 'sale' and r.quantity < 0
      join public.products p on p.id = r.product_id and coalesce(p.track_inventory, true)
     group by d.business_id, d.id, d.invoice_number, r.product_id
    having round(sum(-r.quantity * r.unit_cost), 2) >= 0.01
  ),
  biz as (
    select b.id from public.businesses b where p_business is null or b.id = p_business
  ),
  d3 as (
    select 'D3_GL_RECONCILIATION'::text category, b.id business_id, b.id::text object_ref,
           round(ledgr_repair._subledger_value(b.id)
                 + coalesce((select sum(x.quantity * x.unit_cost) from d1 x where x.business_id = b.id and x.quantity > 0), 0), 2) projected_subledger,
           round(ledgr_repair._gl_inventory(b.id)
                 - coalesce((select sum(x.amount) from d2 x where x.business_id = b.id), 0), 2) projected_gl
      from biz b
  )
  select 'D0_QTY_DRIFT', d.business_id, d.product_id::text || '@' || d.location_id::text, d.product_id, d.location_id,
         d.difference, null::numeric,
         jsonb_build_object('balance_qty', d.quantity_on_hand, 'movement_qty', d.ledger_quantity, 'movements', d.movement_count,
                            'action', 'report only — resolve by physical stock count')
    from public.v_inventory_balance_ledger_drift d
   where p_business is null or d.business_id = p_business
  union all
  select category, business_id, object_ref, product_id, location_id, quantity, round(quantity * unit_cost, 2),
         jsonb_build_object('invoice_number', invoice_number, 'invoice_status', st, 'unit_cost', unit_cost,
                            'action', 'compensating adjustment_in (source_type repair_2026_09)')
    from d1 where quantity > 0
  union all
  select category, business_id, object_ref, product_id, location_id, quantity, amount,
         jsonb_build_object('invoice_number', invoice_number, 'action', 'post keyed COGS entry invoice:<id>:cogs')
    from d2
  union all
  select category, business_id, object_ref, null, null, null, round(projected_subledger - projected_gl, 2),
         jsonb_build_object('projected_subledger', projected_subledger, 'projected_gl', projected_gl,
                            'action', case when projected_subledger > projected_gl then 'DR 1141 / CR 5180' else 'DR 5180 / CR 1141' end)
    from d3 where abs(projected_subledger - projected_gl) >= 0.01;
$$;

create or replace function ledgr_repair.plan_hash_2026_09(p_business uuid default null)
returns text language sql stable set search_path = public as $$
  select md5(coalesce(string_agg(
           concat_ws('|', category, business_id, object_ref, product_id, location_id, round(quantity, 4), round(amount, 2)),
           E'\n' order by category, business_id, object_ref, product_id, location_id), ''))
    from ledgr_repair.plan_2026_09(p_business)
   where category <> 'D0_QTY_DRIFT';
$$;

create or replace function ledgr_repair.apply_2026_09(
  p_evidence_ref text, p_expected_plan_hash text, p_business uuid default null
) returns jsonb
language plpgsql volatile set search_path = public
as $$
declare
  v_hash text;
  v_run uuid;
  r record;
  v_inv public.invoices%rowtype;
  v_entry uuid;
  v_lines jsonb;
  v_n1 int := 0; v_n2 int := 0; v_n3 int := 0;
  v_sub numeric; v_gl numeric; v_var numeric; v_proj numeric;
  v_inv_acct uuid; v_adj_acct uuid; v_ccy text;
begin
  if p_evidence_ref is null or length(btrim(p_evidence_ref)) < 8 then
    raise exception 'Refused: an evidence reference (P0 evidence-preservation snapshot/export id) is required before any repair.'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ledgr_repair_2026_09', 0));
  v_hash := ledgr_repair.plan_hash_2026_09(p_business);
  if p_expected_plan_hash is null or v_hash <> p_expected_plan_hash then
    raise exception 'Refused: the plan changed since it was reviewed (expected %, now %). Re-run sizing and review again.',
      coalesce(p_expected_plan_hash, '<none>'), v_hash using errcode = '22023';
  end if;

  insert into ledgr_repair.runs (evidence_ref, plan_hash, business_id)
  values (btrim(p_evidence_ref), v_hash, p_business) returning run_id into v_run;

  drop table if exists pg_temp._plan;
  create temporary table _plan on commit drop as select * from ledgr_repair.plan_2026_09(p_business);

  -- D1: compensating movements (balance via the R06 trigger).
  for r in select * from _plan where category = 'D1_INVALID_SALE_MOVEMENT' order by business_id, object_ref, product_id loop
    insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, source_type, source_id, reference, notes)
    values (r.business_id, r.product_id, r.location_id, 'adjustment_in', current_date,
        r.quantity, coalesce((r.detail->>'unit_cost')::numeric, 0), 'repair_2026_09', r.object_ref,
        'Repair 2026-09: reverse invalid sale release on ' || coalesce(r.detail->>'invoice_status', '') || ' invoice ' || coalesce(r.detail->>'invoice_number', r.object_ref),
        'evidence ' || btrim(p_evidence_ref) || ' · run ' || v_run);
    insert into ledgr_repair.repair_log (run_id, business_id, category, object_ref, detail)
    values (v_run, r.business_id, r.category, r.object_ref, to_jsonb(r));
    v_n1 := v_n1 + 1;
  end loop;

  -- D2: missing COGS, one keyed entry per invoice.
  for r in select business_id, object_ref,
                  jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity,
                            'unit_cost', round(amount / nullif(quantity, 0), 6))) cost_lines,
                  sum(amount) total
             from _plan where category = 'D2_MISSING_COGS'
            group by business_id, object_ref order by business_id, object_ref loop
    select * into v_inv from public.invoices where id = r.object_ref::uuid;
    v_entry := public._ledgr_post_cogs(v_inv.business_id, v_inv.id, v_inv.invoice_number,
      coalesce(v_inv.issue_date, current_date), v_inv.branch_id, v_inv.department_id, r.cost_lines);
    if v_entry is not null then
      update public.journal_entries set posting_key = 'invoice:' || v_inv.id::text || ':cogs' where id = v_entry;
    end if;
    insert into ledgr_repair.repair_log (run_id, business_id, category, object_ref, detail)
    values (v_run, r.business_id, 'D2_MISSING_COGS', r.object_ref,
            jsonb_build_object('journal_entry_id', v_entry, 'amount', r.total, 'cost_lines', r.cost_lines));
    v_n2 := v_n2 + 1;
  end loop;

  -- D3: true-up per business on the ACTUAL post-D1/D2 figures; must match the
  -- reviewed projection (value is additive), otherwise roll everything back.
  for r in select * from _plan where category = 'D3_GL_RECONCILIATION' order by business_id loop
    v_sub := round(ledgr_repair._subledger_value(r.business_id), 2);
    v_gl := round(ledgr_repair._gl_inventory(r.business_id), 2);
    v_var := v_sub - v_gl;
    v_proj := r.amount;
    if abs(v_var - v_proj) > 0.05 then
      raise exception 'Refused: business % reconciliation moved from the reviewed % to % during apply; nothing was changed.',
        r.business_id, v_proj, v_var using errcode = 'P0001';
    end if;
    if abs(v_var) >= 0.01 then
      v_inv_acct := public._ledgr_account_by_code(r.business_id, '1141');
      v_adj_acct := public._ledgr_account_by_code(r.business_id, '5180');
      select coalesce(base_currency, 'MWK') into v_ccy from public.businesses where id = r.business_id;
      v_lines := jsonb_build_array(
        jsonb_build_object('account_id', v_inv_acct, 'is_debit', v_var > 0, 'amount', abs(v_var), 'amount_base', abs(v_var),
                           'description', 'Repair 2026-09: inventory GL to stock subledger'),
        jsonb_build_object('account_id', v_adj_acct, 'is_debit', v_var < 0, 'amount', abs(v_var), 'amount_base', abs(v_var),
                           'description', 'Repair 2026-09: inventory GL to stock subledger'));
      v_entry := public._ledgr_post_entry_keyed(r.business_id,
        'repair:2026-09:inventory-reconciliation:' || r.business_id::text || ':' || v_run::text, current_date,
        'Inventory reconciliation — historical repair 2026-09 (evidence ' || btrim(p_evidence_ref) || ')',
        'inventory_reconciliation', v_run::text, v_ccy, 1, null, null, v_lines);
      insert into ledgr_repair.repair_log (run_id, business_id, category, object_ref, detail)
      values (v_run, r.business_id, r.category, r.object_ref,
              jsonb_build_object('journal_entry_id', v_entry, 'subledger', v_sub, 'gl_before', v_gl, 'variance', v_var, 'projected', v_proj));
      v_n3 := v_n3 + 1;
    end if;
  end loop;

  update ledgr_repair.runs set summary = jsonb_build_object(
    'd1_movements', v_n1, 'd2_cogs_entries', v_n2, 'd3_reconciliations', v_n3,
    'd0_drift_rows_reported', (select count(*) from _plan where category = 'D0_QTY_DRIFT'))
   where run_id = v_run;
  return jsonb_build_object('run_id', v_run, 'plan_hash', v_hash,
    'd1_movements', v_n1, 'd2_cogs_entries', v_n2, 'd3_reconciliations', v_n3,
    'remaining_plan_hash', ledgr_repair.plan_hash_2026_09(p_business));
end;
$$;

revoke all on all functions in schema ledgr_repair from public, anon, authenticated;
comment on schema ledgr_repair is
  'Private operator schema for the owner-authorised 2026-09 historical repair. Not exposed via the API; no grants to anon/authenticated. See docs/runbooks/REPAIR_2026-09_INVENTORY.md.';
