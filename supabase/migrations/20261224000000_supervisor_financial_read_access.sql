-- Allow supervisors to read financial records, matching the finance-view
-- capability already granted by the application. This changes only the read
-- helper; supervisors remain excluded from direct financial writes.
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

  -- Platform support override is explicit and derives identity from the JWT.
  IF EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = v_user_id
      AND up.is_platform_admin IS TRUE
  ) THEN
    RETURN true;
  END IF;

  SELECT bu.role::text
    INTO v_role
  FROM public.business_users bu
  WHERE bu.business_id = p_business_id
    AND bu.user_id = v_user_id
    AND bu.is_active IS TRUE;

  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  RETURN v_role IN (
    'owner', 'admin', 'accountant', 'auditor',
    'payroll_manager', 'manager', 'board_member', 'supervisor'
  );
END;
$$;

COMMENT ON FUNCTION public.can_read_financial_data(uuid) IS
  'Read access to core financial records. Platform admins or active business roles owner/admin/accountant/auditor/payroll_manager/manager/board_member/supervisor. Supervisors have read-only finance access.';

REVOKE ALL ON FUNCTION public.can_read_financial_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_financial_data(uuid) TO authenticated, service_role;
