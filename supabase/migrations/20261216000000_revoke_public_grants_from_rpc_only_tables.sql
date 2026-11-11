-- Production-readiness audit (2026-11-06): the live database enabled RLS, but
-- PostgreSQL's default table ACL grants still gave anon/authenticated TRUNCATE
-- on 69 public tables (and authenticated TRUNCATE on 128). RLS does not apply
-- to TRUNCATE. Remove that privilege globally; application repositories use
-- row-level INSERT/UPDATE/DELETE and no client workflow needs table truncation.
--
-- Safe revocation of default TRUNCATE privileges in public schema. A managed
-- Supabase migration role may not be permitted to alter another role's default
-- privileges, so skip only those default-ACL changes while continuing with the
-- explicit revocation from existing tables below.
DO $$
BEGIN
  -- Attempt default privilege revocation for current executing role.
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping ALTER DEFAULT PRIVILEGES for current role due to insufficient_privilege (42501)';
END $$;

-- Attempt default privilege revocation for postgres role if applicable.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping ALTER DEFAULT PRIVILEGES FOR ROLE postgres due to insufficient_privilege (42501)';
  WHEN undefined_object OR invalid_parameter_value THEN
    RAISE NOTICE 'Role postgres does not exist or is not applicable';
END $$;

-- Attempt default privilege revocation for supabase_admin role if applicable.
DO $$
BEGIN
  EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM PUBLIC, anon, authenticated';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin due to insufficient_privilege (42501)';
  WHEN undefined_object OR invalid_parameter_value THEN
    RAISE NOTICE 'Role supabase_admin does not exist or is not applicable';
END $$;

REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;

-- These tables are intentionally RPC-/service-role-only (or legacy and unused)
-- and have no row policies. Strip all direct client grants, not just TRUNCATE.
-- Their SECURITY DEFINER RPCs and Edge Functions continue to run as their
-- owner/service_role. Some are legacy deployment tables absent from a fresh
-- migration replay, so skip only names that are not present in that database.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'ai_insights_usage',
    'api_usage',
    'audit_20260927_sent_to_paid',
    'business_terms_acceptances',
    'partner_staff',
    'phone_accounts',
    'pos_approvals',
    'pos_corrections',
    'pos_held_orders',
    'profiles',
    'subscription_reminders_sent',
    'subscriptions',
    'support_agent_usage',
    'usage_counters'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated',
        v_table
      );
    END IF;
  END LOOP;
END
$$;
