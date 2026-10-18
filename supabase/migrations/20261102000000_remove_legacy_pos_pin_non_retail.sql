-- 20261102000000_remove_legacy_pos_pin_non_retail.sql
--
-- Data-only, forward-only fix. Removes the legacy Strategy-A `pos: true` pin
-- (written by 20261019000001) from businesses that do not have RETAIL in their
-- operating models, so POS visibility is computed from the operating-model
-- default (deriveOrganisationCapabilityDefaults), as intended after PR #226.
--
-- Scope:
--   * Only the `pos` key of capability_overrides is removed, and the key is
--     deleted rather than set to false, so a later RETAIL selection in Settings
--     is not blocked by a stale override.
--   * RETAIL businesses are not touched.
--   * `sales`, `inventory` and `services` pins are not touched.
--   * No RLS, grant, function, or application-code change.
--
-- Idempotent: the WHERE clause only matches rows that still carry a `pos` key
-- on a non-RETAIL business, so a second run updates nothing.

-- Snapshot the overrides before the change so the verification below can prove
-- that nothing outside the intended `pos` key moved.
-- DROP first: `supabase db push` normally gives each file its own transaction
-- (so ON COMMIT DROP is enough), but a session that re-runs this file — a manual
-- re-apply while reconciling the 2026-10-18 production collision, say — would
-- otherwise die on 42P07 for its own scratch table.
DROP TABLE IF EXISTS _pos_pin_snapshot;
CREATE TEMP TABLE _pos_pin_snapshot ON COMMIT DROP AS
SELECT id, operating_models, capability_overrides
  FROM public.businesses;

UPDATE public.businesses
   SET capability_overrides = capability_overrides - 'pos',
       updated_at = now()
 WHERE NOT ('RETAIL' = ANY(operating_models))
   AND capability_overrides ? 'pos';

DO $verify$
DECLARE
  v_non_retail_with_pos bigint;
  v_retail_with_pos_before bigint;
  v_retail_with_pos_after bigint;
  v_unexpected_changes bigint;
BEGIN
  -- 1. No non-RETAIL business keeps a pos override.
  SELECT count(*) INTO v_non_retail_with_pos
    FROM public.businesses
   WHERE NOT ('RETAIL' = ANY(operating_models))
     AND capability_overrides ? 'pos';
  IF v_non_retail_with_pos <> 0 THEN
    RAISE EXCEPTION 'pos pin removal incomplete: % non-RETAIL businesses still carry pos', v_non_retail_with_pos
      USING ERRCODE = 'P0001';
  END IF;

  -- 2. RETAIL businesses that carried a pos override still carry it.
  SELECT count(*) INTO v_retail_with_pos_before
    FROM _pos_pin_snapshot
   WHERE 'RETAIL' = ANY(operating_models)
     AND capability_overrides ? 'pos';
  SELECT count(*) INTO v_retail_with_pos_after
    FROM public.businesses b
    JOIN _pos_pin_snapshot s ON s.id = b.id
   WHERE 'RETAIL' = ANY(b.operating_models)
     AND b.capability_overrides ? 'pos';
  IF v_retail_with_pos_before <> v_retail_with_pos_after THEN
    RAISE EXCEPTION 'RETAIL pos overrides changed: before %, after %', v_retail_with_pos_before, v_retail_with_pos_after
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Every row equals its snapshot, minus only the pos key for non-RETAIL
  --    businesses. Any other key change (sales, inventory, services, or
  --    unrelated keys) fails the migration.
  SELECT count(*) INTO v_unexpected_changes
    FROM public.businesses b
    JOIN _pos_pin_snapshot s ON s.id = b.id
   WHERE b.capability_overrides IS DISTINCT FROM (
           CASE WHEN 'RETAIL' = ANY(s.operating_models)
                THEN s.capability_overrides
                ELSE s.capability_overrides - 'pos'
           END
         );
  IF v_unexpected_changes <> 0 THEN
    RAISE EXCEPTION 'capability_overrides changed outside the pos key on % businesses', v_unexpected_changes
      USING ERRCODE = 'P0001';
  END IF;
END;
$verify$;
