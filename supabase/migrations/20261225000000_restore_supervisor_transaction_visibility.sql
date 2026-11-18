-- ============================================================================
-- 20261225000000_restore_supervisor_transaction_visibility.sql
--
-- Supervisor ("site supervisor") transaction visibility.
--
-- A supervisor signs a site's delivery notes and receives its goods, but until
-- 20261224000000 the financial read helper did not include them, so the same
-- person could not see the ledger rows, expenses, invoices or purchase orders
-- those documents produced. 20261224000000 added 'supervisor' to the read tier;
-- this migration restates that definition as the authoritative one for
-- financial transaction visibility, so the state is explicit in the chain
-- rather than implied by an earlier file, and re-issues the function grants.
--
-- Scope: READ authority only. `can_write_financial_data` is deliberately not
-- touched here — supervisors remain outside it, so manual journal entry
-- creation/editing is still owner/admin/accountant (and, in this schema, only
-- through the posting commands: direct journal DML is command-only for every
-- app role).
--
-- Schema note: membership is read from `business_users.is_active` — the column
-- this database actually has. There is no `status` column on `business_users`;
-- a helper written against `status = 'active'` would fail at replay and take
-- every financial read policy down with it. `20261218000000` and
-- `20261224000000` both use `is_active`, and this file keeps that shape.
--
-- Role note: `business_users.role` is the `public.user_role` enum, whose values
-- today include 'supervisor' but not 'site_supervisor'. The latter is kept in
-- the list as forward tolerance for a site-scoped alias — `role::text` can
-- never equal it until the enum gains the value, so it grants nothing today and
-- costs no further migration if the alias is introduced later.
--
-- Replay-safe: function bodies are CREATE OR REPLACE, grants are idempotent, no
-- data and no policy definitions are touched.
-- ============================================================================

-- ── Financial read authority ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_read_financial_data(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_role text;
BEGIN
  IF v_user_id IS NULL OR p_business_id IS NULL THEN
    RETURN false;
  END IF;

  -- 1. Platform support override, derived from the JWT rather than any caller
  --    supplied value.
  IF EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = v_user_id
      AND up.is_platform_admin IS TRUE
  ) THEN
    RETURN true;
  END IF;

  -- 2. Active membership of this business.
  SELECT bu.role::text
    INTO v_role
  FROM public.business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = v_user_id
    AND bu.is_active IS TRUE;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  -- 3. Financial readers, supervisors included. Writes are a narrower tier
  --    (can_write_financial_data) and are unaffected by this list.
  RETURN v_role IN (
    'owner', 'admin', 'accountant', 'auditor',
    'payroll_manager', 'manager', 'board_member',
    'supervisor', 'site_supervisor'
  );
END;
$$;

COMMENT ON FUNCTION public.can_read_financial_data(uuid) IS
  'Read access to core financial records (ledger, budgets, bank statements, FX, expenses). Platform admins, or active business roles owner/admin/accountant/auditor/payroll_manager/manager/board_member, plus supervisors and site supervisors for operational transaction visibility. Read-only: supervisor write authority stays with can_write_financial_data (owner/admin/accountant).';

REVOKE ALL ON FUNCTION public.can_read_financial_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_financial_data(uuid) TO authenticated, service_role;
