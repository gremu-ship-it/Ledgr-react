-- Forward fix for deployments where audit_log.resource_id is UUID instead of
-- the reconstructed base schema's TEXT. Do not alter the audit table or rewrite
-- its history: both shapes accept the native UUID business id on INSERT.
-- audit_chain_hash still requires its resource-id argument cast to text.
-- Preserve the RPC signature, owner/admin authorization, vocabulary validation,
-- no-op behavior, audit values and hash format from 20261027000000 verbatim.

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
    'businesses', p_business_id, NULL,
    to_jsonb(COALESCE(v_old, ARRAY[]::text[])), to_jsonb(v_models),
    'Operating models updated from business settings',
    v_now, '0.0.0.0'::inet, v_prev, v_hash
  );

  RETURN v_models;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_business_operating_models(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_business_operating_models(uuid, text[]) TO authenticated;

DO $verify$
DECLARE v_def text;
BEGIN
 SELECT pg_get_functiondef('public.update_business_operating_models(uuid,text[])'::regprocedure) INTO v_def;
 IF NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.update_business_operating_models(uuid,text[])'::regprocedure)
    OR has_function_privilege('anon','public.update_business_operating_models(uuid,text[])','execute')
    OR NOT has_function_privilege('authenticated','public.update_business_operating_models(uuid,text[])','execute')
    OR position('_ledgr_member_role' IN v_def) = 0
    OR position('''businesses'', p_business_id, NULL' IN v_def) = 0 THEN
  RAISE EXCEPTION 'Business operating-model audit type fix or authorization was not applied correctly.';
 END IF;
END $verify$;
