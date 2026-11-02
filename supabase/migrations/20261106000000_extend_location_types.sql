-- 20261106000000_extend_location_types.sql
--
-- P2-2: Extend inventory_locations.location_type with construction values.
--
-- WHAT THIS MIGRATION DOES
--   Replaces the inventory_locations_location_type_check constraint with a
--   strict superset of the manufacturing vocabulary, adding the three
--   construction store roles:
--
--     warehouse             — universal (default; every business)
--     raw_materials_store   — manufacturing (20261103000000 §3)
--     production_floor      — manufacturing
--     finished_goods_store  — manufacturing
--     job_site              — construction (NEW)
--     site_office           — construction (NEW)
--     material_yard         — construction (NEW)
--
--   Additive only: no column is added or altered, no row is rewritten, and
--   every value stored under the old constraint remains valid under the new
--   one, so ADD CONSTRAINT's validation scan always passes.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No RLS policy, grant or privilege change on inventory_locations. The
--     role-aware master-data policies (20260728000008) already govern writes:
--     member read, can_write_business_data insert/update, can_admin_business_data
--     delete. The new Settings → Locations tab rides exactly that tier.
--   * No change to provision_construction_defaults or
--     provision_manufacturing_defaults: both keep creating the same stores
--     with the same types. The 20261103000000 $verify$ block asserts the
--     constraint LIKE '%production_floor%' — a containment check this superset
--     still satisfies on replay.
--   * No vertical gating in the database: which location_type values a
--     business's UI offers is a presentation decision (useLocationTypes, gated
--     by businesses.operating_models). The CHECK stays vertical-neutral so a
--     business that removes an operating model keeps its already-typed stores
--     valid — the same "removing the model revokes nothing" doctrine the
--     provisioning migrations follow.
--
-- Layer: schema migration, applied by the normal migration replay.

ALTER TABLE public.inventory_locations
  DROP CONSTRAINT IF EXISTS inventory_locations_location_type_check;

ALTER TABLE public.inventory_locations
  ADD CONSTRAINT inventory_locations_location_type_check
  CHECK (location_type IN (
    'warehouse',
    -- Manufacturing (existing, 20261103000000 §3)
    'raw_materials_store',
    'production_floor',
    'finished_goods_store',
    -- Construction (new)
    'job_site',
    'site_office',
    'material_yard'
  ));

COMMENT ON COLUMN public.inventory_locations.location_type IS
  'Physical classification. warehouse=universal; raw_materials_store/production_floor/finished_goods_store=manufacturing; job_site/site_office/material_yard=construction. Manufacturing provisioning creates one of each manufacturing store type; the UI offers construction types only to CONSTRUCTION businesses and manufacturing types only to MANUFACTURING businesses.';
