-- Phase 1 MUST — additive organisation profile and capability pinning.
--
-- Organisation capabilities are a UI/reachability layer only. This migration
-- does not alter RLS, permissions, posting RPCs, or accounting behaviour.
-- Existing businesses are pinned open for every Phase-1 org capability so the
-- new layer cannot change the modules they could reach before this migration.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS organisation_type text NOT NULL DEFAULT 'FOR_PROFIT',
  ADD COLUMN IF NOT EXISTS operating_models text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS capability_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.businesses'::regclass
       AND conname = 'businesses_organisation_type_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_organisation_type_check
      CHECK (organisation_type IN ('FOR_PROFIT', 'NON_PROFIT', 'GOVERNMENT', 'OTHER'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.businesses'::regclass
       AND conname = 'businesses_operating_models_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_operating_models_check
      CHECK (operating_models <@ ARRAY[
        'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
        'PROJECT_BASED', 'GRANT_FUNDED'
      ]::text[]);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.businesses'::regclass
       AND conname = 'businesses_capability_overrides_object_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_capability_overrides_object_check
      CHECK (jsonb_typeof(capability_overrides) = 'object');
  END IF;
END;
$constraints$;

-- Strategy A / backward-compatibility pin. The organization layer is an AND
-- factor, so pin every existing tenant's current UI surfaces to true. Plan,
-- partner, and role gates continue to apply independently. In particular,
-- POS is true for every existing business, regardless of usage history.
UPDATE public.businesses
   SET organisation_type = COALESCE(organisation_type, 'FOR_PROFIT'),
       operating_models = COALESCE(operating_models, ARRAY[]::text[]),
       capability_overrides = COALESCE(capability_overrides, '{}'::jsonb)
         || jsonb_build_object(
              'sales', true,
              'pos', true,
              'inventory', true,
              'services', true
            );

COMMENT ON COLUMN public.businesses.organisation_type IS
  'Organisation profile label; Phase-1 values: FOR_PROFIT, NON_PROFIT, GOVERNMENT, OTHER.';
COMMENT ON COLUMN public.businesses.operating_models IS
  'Multi-select operating model profile; values: RETAIL, WHOLESALE, PRODUCT_SALES, SERVICE_SALES, PROJECT_BASED, GRANT_FUNDED.';
COMMENT ON COLUMN public.businesses.capability_overrides IS
  'Sparse explicit organisation-capability decisions. Existing businesses are pinned open by the Phase-1 migration.';

-- PostgreSQL cannot change a function's input signature with CREATE OR REPLACE.
-- Rename the 18-argument implementation as an unexposed private core, then
-- publish the same contract with the two new, appended SQL-defaulted arguments.
-- This leaves exactly one PostgREST-visible function name/signature family, so
-- old 18-argument callers resolve through the defaults without overload
-- ambiguity. The core still performs the original creation flow unchanged.
ALTER FUNCTION public.create_business_with_owner(
  text, text, text, text, text, boolean, text, text, text,
  text, text, text, text, text, text, text, text, text
) RENAME TO _ledgr_create_business_with_owner_core;

REVOKE ALL ON FUNCTION public._ledgr_create_business_with_owner_core(
  text, text, text, text, text, boolean, text, text, text,
  text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.create_business_with_owner(
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
       'PROJECT_BASED', 'GRANT_FUNDED'
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

REVOKE ALL ON FUNCTION public.create_business_with_owner(
  text, text, text, text, text, boolean, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_business_with_owner(
  text, text, text, text, text, boolean, text, text, text,
  text, text, text, text, text, text, text, text, text, text, text[]
) TO authenticated, service_role;
