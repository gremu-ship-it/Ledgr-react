-- ============================================================================
-- 20261011000000_ic_contain_backfill_execute.sql
-- INCIDENT CONTAINMENT 2026-09-25 — P2: server-side block of
-- public.backfill_and_recalculate_inventory(uuid)
-- ============================================================================
-- Finding (docs/audits/LEDGR_EMERGENCY_INTEGRITY_PERFORMANCE_CRAWL_2026-09-25.md):
-- reproduced on local PostgreSQL that the function (latest body:
-- 20260926000001) has no invoice-status filter: draft, void and credit-note
-- invoice lines are "backfilled" as sale movements, consuming stock at the
-- current WAC with no journal. It is SECURITY DEFINER and was granted to
-- `authenticated`, so any signed-in user who passes its internal role check
-- could trigger it from the Warehouse page or directly via PostgREST.
--
-- Containment (least invasive): revoke EXECUTE from every client-facing role.
-- The function body is NOT modified, NOT dropped, and NOT executed here. Only
-- `service_role` (operator, server-side) keeps EXECUTE so the function stays
-- available for a future, separately authorised and reviewed repair.
--
-- No data is read or written by this migration.
-- Rollback (owner decision only): re-grant EXECUTE to authenticated.
-- ============================================================================

revoke all on function public.backfill_and_recalculate_inventory(uuid) from public;
revoke all on function public.backfill_and_recalculate_inventory(uuid) from anon;
revoke all on function public.backfill_and_recalculate_inventory(uuid) from authenticated;
grant execute on function public.backfill_and_recalculate_inventory(uuid) to service_role;

comment on function public.backfill_and_recalculate_inventory(uuid) is
  'CONTAINED 2026-09-25 (20261011000000): EXECUTE revoked from anon/authenticated/public. '
  'Known defect: no invoice-status filter (draft/void/credit-note lines consume stock). '
  'Do not re-grant or run without an owner-authorised, reviewed repair package.';
