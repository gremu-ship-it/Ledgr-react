-- Restore the payroll-only authorization tier after the full-cycle migration
-- replaced the existing payroll policies with generic business-data policies.
-- Payroll managers may read/write payroll records, but must not receive general
-- business write access. Conversely, ordinary business writers must not gain
-- access to payroll PII or compensation data.

DO $payroll_policies$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'employees',
    'employee_contracts',
    'pay_components',
    'employee_pay_components',
    'tax_bands',
    'pay_runs',
    'pay_run_lines',
    'pay_run_component_details',
    'leave_types',
    'leave_balances',
    'leave_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);

    -- Replace every prior policy so a permissive generic policy cannot OR-open
    -- the dedicated payroll boundary.
    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.can_view_payroll(business_id))',
      v_table || '_payroll_read', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.can_write_payroll(business_id))',
      v_table || '_payroll_insert', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.can_write_payroll(business_id)) WITH CHECK (public.can_write_payroll(business_id))',
      v_table || '_payroll_update', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.can_admin_business_data(business_id))',
      v_table || '_payroll_delete', v_table
    );

    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_table);
  END LOOP;
END
$payroll_policies$;
