-- Historical repair 2026-09 — SIZING (read-only; SELECT statements only).
-- Run through .github/workflows/repair-2026-09-inventory.yml (mode=size).
-- Requires migration 20261013000001_ledgr_repair_2026_09.sql to be deployed.
-- Output: per-business/category counts and amounts, the full proposed plan,
-- and the PLAN HASH the operator must copy into the apply run.

select 'plan_hash' as item, ledgr_repair.plan_hash_2026_09(null) as value;

select category, business_id, count(*) as rows, round(sum(coalesce(quantity, 0)), 4) as quantity,
       round(sum(coalesce(amount, 0)), 2) as amount
  from ledgr_repair.plan_2026_09(null)
 group by category, business_id
 order by business_id, category;

select category, business_id, object_ref, product_id, location_id, quantity, amount, detail
  from ledgr_repair.plan_2026_09(null)
 order by business_id, category, object_ref;

select run_id, evidence_ref, plan_hash, business_id, applied_at, applied_by, summary
  from ledgr_repair.runs order by applied_at;
