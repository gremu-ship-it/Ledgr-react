-- Migration: 20261226000000_subscription_lease_engine.sql
-- Description: Server-side cryptographic subscription lease issuer for local/offline desktop operation

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- RPC: issue_subscription_lease
CREATE OR REPLACE FUNCTION public.issue_subscription_lease(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_plan text;
  v_models text[];
  v_now_epoch bigint;
  v_valid_until bigint;
  v_grace_until bigint;
  v_payload jsonb;
  v_signature text;
  v_secret text;
BEGIN
  v_user_id := auth.uid();

  -- 1. Authorization: User must be active member of business
  IF NOT EXISTS (
    SELECT 1 FROM public.business_users
    WHERE business_id = p_business_id
      AND user_id = v_user_id
      AND is_active = true
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = v_user_id AND is_platform_admin = true
  ) THEN
    RAISE EXCEPTION 'Access denied: User is not an active member of business %', p_business_id
      USING ERRCODE = '42501';
  END IF;

  -- 2. Fetch business plan and operating models
  SELECT
    COALESCE(subscription_plan, 'starter'),
    COALESCE(operating_models, ARRAY['PRODUCT_SALES']::text[])
  INTO v_plan, v_models
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Business % not found', p_business_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Calculate lease epochs (14 days active + 3 days grace)
  v_now_epoch := EXTRACT(EPOCH FROM clock_timestamp())::bigint;
  v_valid_until := v_now_epoch + 1209600; -- +14 days
  v_grace_until := v_valid_until + 259200; -- +3 days grace

  -- 4. Construct payload
  v_payload := jsonb_build_object(
    'business_id', p_business_id,
    'issued_to_user', v_user_id,
    'plan', LOWER(v_plan),
    'operating_models', v_models,
    'issued_at', v_now_epoch,
    'valid_until', v_valid_until,
    'grace_until', v_grace_until
  );

  -- 5. Cryptographic signature using HMAC-SHA256 with tenant-derived salt
  -- In production, this uses an app-level signing key
  v_secret := COALESCE(
    current_setting('app.settings.lease_signing_key', true),
    'ledgr-erp-offline-lease-secure-salt-2026'
  );

  v_signature := encode(
    hmac(v_payload::text, v_secret || p_business_id::text, 'sha256'),
    'hex'
  );

  RETURN jsonb_build_object(
    'payload', v_payload,
    'signature', v_signature,
    'algorithm', 'HMAC-SHA256'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_subscription_lease TO authenticated;
