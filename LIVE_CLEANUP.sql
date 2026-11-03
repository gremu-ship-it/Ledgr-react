-- Optional, separately reviewed cleanup for the empty legacy public.construction_sites table.
-- Live read-only discovery (2026-10-30): count(*) = 0; no inbound foreign keys were present.
-- Runtime recount is performed under ACCESS EXCLUSIVE lock to prevent a concurrent insert
-- between the count and DROP. If any row or inbound FK exists, the table is retained.
-- DROP uses RESTRICT, never CASCADE. This is not executed by the agent.
-- Note: migration 20261117000000_subcontractor_profiles_and_subcontracts.sql says to leave
-- construction_sites unchanged; the current requested cleanup is an explicit follow-up choice.

DO $safe_drop_legacy_construction_sites$
DECLARE
  v_rel regclass;
  v_rows bigint;
  v_has_inbound_fk boolean;
BEGIN
  v_rel := to_regclass('public.construction_sites');
  IF v_rel IS NULL THEN
    RAISE NOTICE 'public.construction_sites does not exist; nothing to drop.';
    RETURN;
  END IF;

  -- Serialize against inserts/updates/deletes, then check the exact row count.
  LOCK TABLE public.construction_sites IN ACCESS EXCLUSIVE MODE;
  SELECT count(*) INTO v_rows FROM public.construction_sites;
  IF v_rows <> 0 THEN
    RAISE NOTICE 'public.construction_sites has % row(s) — NOT dropped.', v_rows;
    RETURN;
  END IF;

  -- Keep the table if any outside FK references it. Outgoing FKs from this table
  -- to businesses/inventory_locations/construction_projects do not block this check.
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = v_rel
       AND c.conrelid <> v_rel
  ) INTO v_has_inbound_fk;

  IF v_has_inbound_fk THEN
    RAISE NOTICE 'public.construction_sites has an inbound foreign key — NOT dropped.';
    RETURN;
  END IF;

  BEGIN
    DROP TABLE IF EXISTS public.construction_sites RESTRICT;
    RAISE NOTICE 'Dropped empty public.construction_sites without CASCADE.';
  EXCEPTION
    WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'A view or other database dependency exists — public.construction_sites NOT dropped.';
  END;
END
$safe_drop_legacy_construction_sites$;

-- Read-only post-check: expected result is zero rows if the table was safely dropped.
SELECT table_schema, table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name = 'construction_sites';
