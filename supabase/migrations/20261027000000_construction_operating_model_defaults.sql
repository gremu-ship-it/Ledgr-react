-- 20261027000000_construction_operating_model_defaults.sql
--
-- Organisation type → feature defaults, first vertical: Construction.
--
-- WHAT THIS MIGRATION DOES
--   1. Adds 'CONSTRUCTION' to the operating-model vocabulary (the CHECK on
--      public.businesses and the validation inside create_business_with_owner,
--      which would otherwise reject the new value with 22023).
--   2. Records grant provenance: construction_procurement_grants gains a
--      `source` column so a one-time registration bootstrap is distinguishable
--      from a capability granted by a human through the existing grant command.
--   3. Creates public.provision_construction_defaults(business, owner) — the
--      idempotent registration/settings bootstrap that creates the "Main Site"
--      branch, its inventory location, and the twelve procurement capability
--      grants held by the nominated owner.
--   4. Creates public.update_business_operating_models(business, models) — the
--      Settings editor for the multi-select profile, with an audit entry.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * No RLS policy, grant-to-table or privilege change on any table. Both new
--     functions are SECURITY DEFINER with explicit membership checks, and
--     `authenticated` keeps SELECT-only access to every construction table.
--   * public.grant_construction_procurement_capability is NOT redefined. Its
--     self-grant prohibition stays exactly as shipped; provisioning inserts the
--     bootstrap rows directly, once, for the owner who just created the
--     business (or the owner/admin who just enabled the model in Settings).
--   * The two-person purchase-order authorisation is untouched: an owner with
--     every procurement grant still cannot authorise their own PO.
--   * capability_org_layer is not flipped. The Construction workspace is gated
--     by the Enterprise plan requirement plus the organisation profile, and
--     every command remains authorised server-side by explicit grants.
--   * PROJECT_BASED stays inert: it is neither renamed nor given defaults.
--
-- Layer: this is a schema + command migration. It is applied by the normal
-- migration replay; nothing here needs a hosted environment to be correct.

-- ============================================================================
-- 1. OPERATING-MODEL VOCABULARY
-- ============================================================================

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_operating_models_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_operating_models_check
  CHECK (operating_models <@ ARRAY[
    'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
    'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION'
  ]::text[]);

COMMENT ON COLUMN public.businesses.operating_models IS
  'Multi-select operating model profile; values: RETAIL, WHOLESALE, PRODUCT_SALES, SERVICE_SALES, PROJECT_BASED, GRANT_FUNDED, CONSTRUCTION. PROJECT_BASED is reserved and inert.';

-- create_business_with_owner validates the vocabulary itself so a bad value is
-- reported as an actionable 22023 rather than as a constraint violation. Its
-- signature is unchanged, so CREATE OR REPLACE keeps the existing ACLs.
CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text,
  p_trading_name text,
  p_registration_number text,
  p_tpin text,
  p_vat_number text,
  p_vat_registered boolean,
  p_base_currency text,
  p_financial_year_start text,
  p_timezone text,
  p_address_line1 text,
  p_city text,
  p_country text,
  p_phone text,
  p_email text,
  p_brand_color text,
  p_invoice_prefix text,
  p_expense_prefix text,
  p_payroll_prefix text,
  p_organisation_type text DEFAULT 'FOR_PROFIT',
  p_operating_models text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_business_id uuid;
  v_operating_models text[] := COALESCE(p_operating_models, ARRAY[]::text[]);
  v_distinct_models integer;
BEGIN
  IF p_organisation_type IS NULL OR p_organisation_type NOT IN (
    'FOR_PROFIT', 'NON_PROFIT', 'GOVERNMENT', 'OTHER'
  ) THEN
    RAISE EXCEPTION 'Invalid organisation_type %', p_organisation_type
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_operating_models) AS model(value)
     WHERE value IS NULL OR value NOT IN (
       'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
       'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION'
     )
  ) THEN
    RAISE EXCEPTION 'Invalid operating_models value.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT value)::integer
    INTO v_distinct_models
    FROM unnest(v_operating_models) AS model(value);
  IF cardinality(v_operating_models) <> v_distinct_models THEN
    RAISE EXCEPTION 'operating_models must not contain duplicates.'
      USING ERRCODE = '22023';
  END IF;

  v_business_id := public._ledgr_create_business_with_owner_core(
    p_name,
    p_trading_name,
    p_registration_number,
    p_tpin,
    p_vat_number,
    p_vat_registered,
    p_base_currency,
    p_financial_year_start,
    p_timezone,
    p_address_line1,
    p_city,
    p_country,
    p_phone,
    p_email,
    p_brand_color,
    p_invoice_prefix,
    p_expense_prefix,
    p_payroll_prefix
  );

  UPDATE public.businesses
     SET organisation_type = p_organisation_type,
         operating_models = v_operating_models,
         capability_overrides = '{}'::jsonb
   WHERE id = v_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Created business % could not be updated with its profile.', v_business_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_business_id;
END;
$function$;

-- ============================================================================
-- 2. GRANT PROVENANCE
-- ============================================================================
-- The registration bootstrap is the only writer that sets a non-default source.
-- Existing rows (and every row written by grant_construction_procurement_capability)
-- backfill to 'manual_grant' through the column default.

ALTER TABLE public.construction_procurement_grants
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual_grant';

COMMENT ON COLUMN public.construction_procurement_grants.source IS
  'Provenance of the grant: registration_bootstrap (one-time automatic provisioning for a Construction business) or manual_grant (grant_construction_procurement_capability).';

-- ============================================================================
-- 3. IDEMPOTENT CONSTRUCTION BOOTSTRAP
-- ============================================================================
-- Called by the registration flow immediately after create_business_with_owner
-- returns, and by Settings when an existing business adds CONSTRUCTION. It is
-- deliberately separate from the creation transaction: a provisioning failure
-- must not roll back the new business, and the caller reports the failure with a
-- pointer to Settings instead.
--
-- Checks (fail closed):
--   * the caller is signed in and is an active owner/admin member of the business;
--   * the nominated owner is also an active owner/admin member of that business;
--   * the business actually has CONSTRUCTION selected — so this function can
--     never become a general-purpose grant injector for a retail business.
--
-- Idempotency:
--   * the branch is reused by name within the business;
--   * the location is reused by branch + name;
--   * grants rely on the existing live-grant unique index (uq_cpg_live), so a
--     second call inserts nothing and leaves the first bootstrap intact.
--
-- Removed operating models never revoke anything: grants and the site created
-- here stay in force until a human revokes them through the existing command.

CREATE OR REPLACE FUNCTION public.provision_construction_defaults(
  p_business_id   uuid,
  p_owner_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           text;
  v_owner_role     text;
  v_models         text[];
  v_branch_id      uuid;
  v_location_id    uuid;
  v_branch_created boolean := false;
  v_location_created boolean := false;
  v_grants_created integer := 0;
  v_is_default     boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL OR p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'A business and an owner are required.' USING ERRCODE = '22023';
  END IF;

  SELECT b.operating_models
    INTO v_models
    FROM public.businesses b
   WHERE b.id = p_business_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = 'P0002';
  END IF;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator can provision a construction workspace.'
      USING ERRCODE = '42501';
  END IF;

  v_owner_role := public._ledgr_member_role(p_business_id, p_owner_user_id);
  IF v_owner_role IS NULL OR v_owner_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Construction provisioning must nominate an active owner or administrator.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT ('CONSTRUCTION' = ANY (COALESCE(v_models, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'This business is not configured for construction work.'
      USING ERRCODE = '22023';
  END IF;

  -- ── Main Site branch ──────────────────────────────────────────────────────
  SELECT b.id
    INTO v_branch_id
    FROM public.branches b
   WHERE b.business_id = p_business_id
     AND b.deleted_at IS NULL
     AND b.name = 'Main Site'
   ORDER BY b.created_at
   LIMIT 1;

  IF v_branch_id IS NULL THEN
    INSERT INTO public.branches (business_id, name, code, is_active)
    VALUES (p_business_id, 'Main Site', 'MAIN', true)
    RETURNING id INTO v_branch_id;
    v_branch_created := true;
  END IF;

  -- ── Its inventory location ────────────────────────────────────────────────
  SELECT l.id
    INTO v_location_id
    FROM public.inventory_locations l
   WHERE l.business_id = p_business_id
     AND l.branch_id = v_branch_id
     AND l.name = 'Main Store'
   ORDER BY l.created_at
   LIMIT 1;

  IF v_location_id IS NULL THEN
    -- Only claim the default flag when the business has no default yet, so
    -- provisioning can never produce two default locations.
    SELECT NOT EXISTS (
      SELECT 1 FROM public.inventory_locations
       WHERE business_id = p_business_id AND is_default
    ) INTO v_is_default;

    INSERT INTO public.inventory_locations (business_id, branch_id, name, is_default, is_active)
    VALUES (p_business_id, v_branch_id, 'Main Store', v_is_default, true)
    RETURNING id INTO v_location_id;
    v_location_created := true;
  END IF;

  -- ── The twelve procurement capability grants ─────────────────────────────
  -- Inserted directly, deliberately bypassing grant_construction_procurement_capability:
  -- that command refuses self-grants and is anchored on a separate grant
  -- administrator. The bootstrap is a one-time system event for the owner who
  -- just created the business, so it writes the rows itself and labels them.
  INSERT INTO public.construction_procurement_grants
    (business_id, user_id, capability, granted_by, granted_at, grant_reason, source)
  SELECT p_business_id,
         p_owner_user_id,
         c.code,
         p_owner_user_id,
         now(),
         'Automatic provisioning for construction business at registration',
         'registration_bootstrap'
    FROM (VALUES
      ('procurement.master.manage'),
      ('procurement.po.manage'),
      ('procurement.po.authorize'),
      ('procurement.delivery_note.record'),
      ('procurement.grn.record'),
      ('procurement.receipt.inspect'),
      ('procurement.exception.authorize'),
      ('procurement.bill.match'),
      ('procurement.receipt.post'),
      ('procurement.policy.approve'),
      ('procurement.material.issue'),
      ('procurement.material.return')
    ) AS c(code)
  ON CONFLICT (business_id, user_id, capability) WHERE revoked_at IS NULL DO NOTHING;

  GET DIAGNOSTICS v_grants_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'business_id', p_business_id,
    'branch_id', v_branch_id,
    'location_id', v_location_id,
    'branch_created', v_branch_created,
    'location_created', v_location_created,
    'grants_created', v_grants_created,
    'grants_in_force', (
      SELECT count(*)
        FROM public.construction_procurement_grants g
       WHERE g.business_id = p_business_id
         AND g.user_id = p_owner_user_id
         AND g.revoked_at IS NULL
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.provision_construction_defaults(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provision_construction_defaults(uuid, uuid) TO authenticated;

-- ============================================================================
-- 4. SETTINGS EDITOR FOR THE OPERATING-MODEL PROFILE
-- ============================================================================
-- Only the owner/admin of the business may change the profile. The function
-- validates the vocabulary itself (the table CHECK stays the last line of
-- defence), writes one audit entry describing the old and new selections, and
-- returns the stored value. Revoking a model never touches grants: removing
-- CONSTRUCTION hides the workspace surface but leaves the site, location and
-- capability grants in place so re-adding the model resumes without data loss.

CREATE OR REPLACE FUNCTION public.update_business_operating_models(
  p_business_id      uuid,
  p_operating_models text[]
)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           text;
  v_models         text[] := COALESCE(p_operating_models, ARRAY[]::text[]);
  v_old            text[];
  v_distinct       integer;
  v_now            timestamptz := now();
  v_prev           text;
  v_hash           text;
  v_email          text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator can change the operating models.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_models) AS model(value)
     WHERE value IS NULL OR value NOT IN (
       'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
       'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION'
     )
  ) THEN
    RAISE EXCEPTION 'Invalid operating_models value.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT value)::integer INTO v_distinct FROM unnest(v_models) AS model(value);
  IF cardinality(v_models) <> v_distinct THEN
    RAISE EXCEPTION 'operating_models must not contain duplicates.' USING ERRCODE = '22023';
  END IF;

  SELECT b.operating_models
    INTO v_old
    FROM public.businesses b
   WHERE b.id = p_business_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = 'P0002';
  END IF;

  -- A no-op save writes nothing and audits nothing.
  IF COALESCE(v_old, ARRAY[]::text[]) = v_models THEN
    RETURN v_models;
  END IF;

  UPDATE public.businesses
     SET operating_models = v_models,
         updated_at = now()
   WHERE id = p_business_id;

  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  SELECT entry_hash INTO v_prev
    FROM public.audit_log
   WHERE business_id = p_business_id
   ORDER BY id DESC
   LIMIT 1;

  v_hash := public.audit_chain_hash(
    v_prev, p_business_id, v_actor, v_now,
    'business_operating_models_updated', 'businesses', p_business_id::text, NULL,
    to_jsonb(COALESCE(v_old, ARRAY[]::text[])), to_jsonb(v_models),
    'Operating models updated from business settings'
  );

  INSERT INTO public.audit_log (
    business_id, user_id, user_email, event_type, resource_type, resource_id,
    resource_ref, old_values, new_values, notes, occurred_at, ip_address,
    prev_hash, entry_hash
  ) VALUES (
    p_business_id, v_actor, v_email, 'business_operating_models_updated',
    'businesses', p_business_id::text, NULL,
    to_jsonb(COALESCE(v_old, ARRAY[]::text[])), to_jsonb(v_models),
    'Operating models updated from business settings',
    v_now, '0.0.0.0'::inet, v_prev, v_hash
  );

  RETURN v_models;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_business_operating_models(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_business_operating_models(uuid, text[]) TO authenticated;

-- ============================================================================
-- 5. SELF-VERIFICATION
-- ============================================================================
-- Fails the migration (and therefore the replay) if a later edit weakens the
-- vocabulary, drops the provenance column, exposes a new write path, or leaves
-- the bootstrap non-idempotent.

DO $verify$
DECLARE
  v_missing text := '';
  v_def     text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.businesses'::regclass
       AND conname = 'businesses_operating_models_check'
       AND pg_get_constraintdef(oid) LIKE '%CONSTRUCTION%'
  ) THEN
    v_missing := v_missing || 'businesses_operating_models_check does not allow CONSTRUCTION; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'construction_procurement_grants'
       AND column_name = 'source'
       AND is_nullable = 'NO'
  ) THEN
    v_missing := v_missing || 'construction_procurement_grants.source is missing or nullable; ';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'uq_cpg_live'
  ) THEN
    v_missing := v_missing || 'the live-grant unique index is missing; ';
  END IF;

  -- Resolve by regprocedure (signature only) rather than by argument names: the
  -- function defines named parameters, so identity arguments include those names.
  IF to_regprocedure('public.provision_construction_defaults(uuid,uuid)') IS NULL THEN
    v_missing := v_missing || 'provision_construction_defaults(uuid,uuid) is missing; ';
  ELSE
    SELECT p.prosecdef::text || '|' || pg_get_functiondef(p.oid)
      INTO v_def
      FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.provision_construction_defaults(uuid,uuid)');
    IF v_def NOT LIKE 'true|%' THEN
      v_missing := v_missing || 'provision_construction_defaults is not SECURITY DEFINER; ';
    END IF;
    IF v_def NOT LIKE '%registration_bootstrap%' THEN
      v_missing := v_missing || 'provision_construction_defaults does not tag its bootstrap grants; ';
    END IF;
    IF v_def NOT ILIKE '%where revoked_at is null%' THEN
      v_missing := v_missing || 'provision_construction_defaults has no partial-index conflict target; ';
    END IF;
    IF v_def NOT LIKE '%''CONSTRUCTION'' = ANY%' THEN
      v_missing := v_missing || 'provision_construction_defaults does not require the CONSTRUCTION model; ';
    END IF;
  END IF;

  IF to_regprocedure('public.update_business_operating_models(uuid,text[])') IS NULL
     OR NOT (SELECT p.prosecdef FROM pg_proc p
              WHERE p.oid = to_regprocedure('public.update_business_operating_models(uuid,text[])')) THEN
    v_missing := v_missing || 'update_business_operating_models(uuid,text[]) is missing or not SECURITY DEFINER; ';
  END IF;

  -- No new write path: authenticated keeps SELECT-only access to the grants table.
  IF has_table_privilege('authenticated', 'public.construction_procurement_grants', 'insert')
     OR has_table_privilege('authenticated', 'public.construction_procurement_grants', 'update')
     OR has_table_privilege('authenticated', 'public.construction_procurement_grants', 'delete') THEN
    v_missing := v_missing || 'authenticated gained a write privilege on construction_procurement_grants; ';
  END IF;

  -- The new functions are callable by authenticated only.
  IF has_function_privilege('anon', 'public.provision_construction_defaults(uuid,uuid)', 'execute')
     OR has_function_privilege('anon', 'public.update_business_operating_models(uuid,text[])', 'execute') THEN
    v_missing := v_missing || 'anon can execute an operating-model function; ';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Construction operating-model defaults not applied correctly: %', v_missing
      USING ERRCODE = '42501';
  END IF;
END
$verify$;
