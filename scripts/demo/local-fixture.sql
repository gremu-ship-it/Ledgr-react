-- ============================================================================
-- LOCAL-ONLY FIXTURE — DO NOT RUN AGAINST A HOSTED PROJECT
-- ----------------------------------------------------------------------------
-- Creates the target business, its owner and the default chart of accounts in
-- the disposable migration-replay database under .cache/ledgr-demo.
--
-- It refuses to run if the business ID already exists, so it cannot attach a
-- synthetic owner/COA to a real tenant by accident.
-- ============================================================================
DO $fixture$
DECLARE
  v_business_id uuid := '487334df-a057-45c3-b088-85e6c0a6aeb3';
  v_owner_id    uuid := '9d2b7f4e-6a1c-4c8e-9f3a-2b5d7e8c1a40';
BEGIN
  IF EXISTS (SELECT 1 FROM public.businesses WHERE id = v_business_id) THEN
    RAISE EXCEPTION
      'LOCAL-ONLY fixture refused: business % already exists. Use seed_demo_business.sql for an existing tenant.',
      v_business_id;
  END IF;

  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_owner_id, 'demo.owner@ledgr.test', '{"full_name":"Demo Owner"}'::jsonb)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.businesses (
    id, name, trading_name, base_currency, coa_template, financial_year_start, timezone,
    invoice_next_number, expense_next_number, payroll_next_number, vat_registered,
    organisation_type, operating_models, capability_overrides, plan_tier, is_active
  ) VALUES (
    v_business_id, 'Nkhotakota Build & Block Ltd', 'Nkhotakota Build & Block',
    'MWK', 'gaap', '01-07', 'Africa/Blantyre', 1, 1, 1, false,
    'FOR_PROFIT', ARRAY['CONSTRUCTION','MANUFACTURING']::text[], '{}'::jsonb, 'enterprise', true
  );

  INSERT INTO public.business_users (business_id, user_id, role, is_active, accepted_at)
  VALUES (v_business_id, v_owner_id, 'owner', true, now());

  PERFORM public.seed_new_business(jsonb_build_object(
    'business_id', v_business_id,
    'base_currency', 'MWK',
    'coa_template', 'gaap'
  ));

  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);

  PERFORM public.provision_construction_defaults(v_business_id, v_owner_id);
  PERFORM public.provision_construction_coa_accounts(v_business_id);
  PERFORM public.provision_manufacturing_defaults(v_business_id, v_owner_id);
  PERFORM public.provision_manufacturing_coa_accounts(v_business_id);
END
$fixture$;
