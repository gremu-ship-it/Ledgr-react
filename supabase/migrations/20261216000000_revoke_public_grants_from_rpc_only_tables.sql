-- Production-readiness audit (2026-11-06): the live database enabled RLS, but
-- PostgreSQL's default table ACL grants still gave anon/authenticated TRUNCATE
-- on 69 public tables (and authenticated TRUNCATE on 128). RLS does not apply
-- to TRUNCATE. Remove that privilege globally; application repositories use
-- row-level INSERT/UPDATE/DELETE and no client workflow needs table truncation.
--
-- The default is created by both postgres and supabase_admin in the live
-- project. Remove only TRUNCATE from future table ACLs for those owners too;
-- keep their other Supabase defaults intact. The role guard keeps local replay
-- environments without supabase_admin compatible.
DO $$
DECLARE
  v_owner text;
BEGIN
  FOR v_owner IN
    SELECT rolname FROM pg_roles WHERE rolname IN ('postgres', 'supabase_admin')
  LOOP
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated',
      v_owner
    );
  END LOOP;
END
$$;

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
