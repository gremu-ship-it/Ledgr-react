-- ============================================================================
-- 20261218000000_role_aware_financial_rls.sql
-- SEC-01 — align core financial RLS with server-side accounting roles.
--
-- Member-wide policies previously allowed operational roles to read arbitrary
-- ledger rows and, for some tables, to write them directly through PostgREST.
-- These policies are the database boundary; route/navigation checks are not.
--
-- POS invoices remain a scoped exception: sales-capable roles (including
-- cashiers) can work with sales invoices, but cannot create general-ledger
-- entries, modify budgets, or read the full expense/bank-statement ledger.
-- POS posting RPCs continue to run as SECURITY DEFINER and retain their API.
--
-- Replay-safe: functions are CREATE OR REPLACE; existing policies are dropped
-- by catalog name before the new policy set is installed.
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
    'payroll_manager', 'manager', 'board_member'
  );
END;
$$;

COMMENT ON FUNCTION public.can_read_financial_data(uuid) IS
  'SEC-01: read access to core financial records. Platform admins or active business roles owner/admin/accountant/auditor/payroll_manager/manager/board_member. Uses business_users.is_active (the current membership schema).';

-- ── Financial write authority ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.can_write_financial_data(p_business_id uuid)
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

  RETURN v_role IN ('owner', 'admin', 'accountant');
END;
$$;

COMMENT ON FUNCTION public.can_write_financial_data(uuid) IS
  'SEC-01: write access to core financial records. Platform admins or active business roles owner/admin/accountant. Operational roles cannot directly mutate the general ledger, budgets, expenses or bank statements.';

-- Invoices are operational sales documents as well as accounting records. Keep
-- cashier and named sales roles on the sales-document path only; this helper
-- is never used for journal, budget, expense, bank-statement or FX policies.
CREATE OR REPLACE FUNCTION public.can_write_sales_invoice_data(p_business_id uuid)
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

  RETURN coalesce(v_role IN (
    'owner', 'admin', 'accountant', 'cashier',
    'sales_clerk', 'sales_manager', 'customer_service_rep',
    'branch_manager', 'manager'
  ), false);
END;
$$;

COMMENT ON FUNCTION public.can_write_sales_invoice_data(uuid) IS
  'SEC-01 sales-document exception only: financial writers plus cashier and named sales/branch roles may create and service invoices; never grants journal, budget, expense, bank-statement or FX access.';

REVOKE ALL ON FUNCTION public.can_read_financial_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_financial_data(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_write_sales_invoice_data(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_financial_data(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_financial_data(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_sales_invoice_data(uuid) TO authenticated, service_role;

-- Reporting views must execute with the caller's privileges. PostgreSQL views
-- default to owner rights unless security_invoker is explicitly set, which
-- would otherwise bypass the underlying role-aware RLS policies.
ALTER VIEW IF EXISTS public.v_trial_balance SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_ar_ageing SET (security_invoker = true);

-- Clear every prior permissive policy on the affected tables. This also removes
-- any historically named member/platform-admin policy that could OR around the
-- new role restrictions. Platform admins are handled inside the helpers above.
DO $$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'journal_entries', 'journal_lines',
    'budgets', 'budget_lines',
    'bank_statements', 'bank_statement_lines',
    'fx_revaluations',
    'invoices', 'invoice_lines', 'invoice_payments',
    'expenses', 'expense_lines', 'expense_payments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    -- RLS only filters rows; it does not grant table access. Keep authenticated
    -- CRUD available to valid policy roles and remove anonymous table access.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v_table);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated',
      v_table
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);

    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
    LOOP
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        v_policy.policyname,
        v_table
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ── General ledger: journals ─────────────────────────────────────────────────
CREATE POLICY journal_entries_financial_read
  ON public.journal_entries FOR SELECT TO authenticated
  USING (
    public.can_read_financial_data(business_id)
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

-- Journal DML is deliberately command-only across all app roles. Financial
-- writers must use the existing SECURITY DEFINER posting commands so balancing,
-- period locks, idempotency, approvals and audit triggers remain authoritative.
CREATE POLICY journal_entries_command_insert
  ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY journal_entries_command_update
  ON public.journal_entries FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY journal_entries_command_delete
  ON public.journal_entries FOR DELETE TO authenticated
  USING (false);

CREATE POLICY journal_lines_financial_read
  ON public.journal_lines FOR SELECT TO authenticated
  USING (
    public.can_read_financial_data(business_id)
    AND EXISTS (
      SELECT 1
      FROM public.journal_entries je
      WHERE je.id = journal_lines.journal_entry_id
        AND je.business_id = journal_lines.business_id
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(
            journal_lines.business_id,
            coalesce(journal_lines.branch_id, je.branch_id)
          )
        )
    )
  );

CREATE POLICY journal_lines_command_insert
  ON public.journal_lines FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY journal_lines_command_update
  ON public.journal_lines FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE POLICY journal_lines_command_delete
  ON public.journal_lines FOR DELETE TO authenticated
  USING (false);

-- ── Budgets ──────────────────────────────────────────────────────────────────
CREATE POLICY budgets_financial_read
  ON public.budgets FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

CREATE POLICY budgets_financial_insert
  ON public.budgets FOR INSERT TO authenticated
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY budgets_financial_update
  ON public.budgets FOR UPDATE TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY budgets_financial_delete
  ON public.budgets FOR DELETE TO authenticated
  USING (public.can_write_financial_data(business_id));

CREATE POLICY budget_lines_financial_read
  ON public.budget_lines FOR SELECT TO authenticated
  USING (
    public.can_read_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.business_id = budget_lines.business_id
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY budget_lines_financial_insert
  ON public.budget_lines FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.business_id = budget_lines.business_id
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY budget_lines_financial_update
  ON public.budget_lines FOR UPDATE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.business_id = budget_lines.business_id
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  )
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.business_id = budget_lines.business_id
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY budget_lines_financial_delete
  ON public.budget_lines FOR DELETE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.budgets b
      WHERE b.id = budget_lines.budget_id
        AND b.business_id = budget_lines.business_id
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

-- ── Bank statements and statement lines ──────────────────────────────────────
CREATE POLICY bank_statements_financial_read
  ON public.bank_statements FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

CREATE POLICY bank_statements_financial_insert
  ON public.bank_statements FOR INSERT TO authenticated
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY bank_statements_financial_update
  ON public.bank_statements FOR UPDATE TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY bank_statements_financial_delete
  ON public.bank_statements FOR DELETE TO authenticated
  USING (public.can_write_financial_data(business_id));

CREATE POLICY bank_statement_lines_financial_read
  ON public.bank_statement_lines FOR SELECT TO authenticated
  USING (
    public.can_read_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = bank_statement_lines.statement_id
        AND bs.business_id = bank_statement_lines.business_id
    )
  );

CREATE POLICY bank_statement_lines_financial_insert
  ON public.bank_statement_lines FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = bank_statement_lines.statement_id
        AND bs.business_id = bank_statement_lines.business_id
    )
  );

CREATE POLICY bank_statement_lines_financial_update
  ON public.bank_statement_lines FOR UPDATE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = bank_statement_lines.statement_id
        AND bs.business_id = bank_statement_lines.business_id
    )
  )
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = bank_statement_lines.statement_id
        AND bs.business_id = bank_statement_lines.business_id
    )
  );

CREATE POLICY bank_statement_lines_financial_delete
  ON public.bank_statement_lines FOR DELETE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.bank_statements bs
      WHERE bs.id = bank_statement_lines.statement_id
        AND bs.business_id = bank_statement_lines.business_id
    )
  );

-- ── FX revaluations ──────────────────────────────────────────────────────────
CREATE POLICY fx_revaluations_financial_read
  ON public.fx_revaluations FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

CREATE POLICY fx_revaluations_financial_insert
  ON public.fx_revaluations FOR INSERT TO authenticated
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY fx_revaluations_financial_update
  ON public.fx_revaluations FOR UPDATE TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY fx_revaluations_financial_delete
  ON public.fx_revaluations FOR DELETE TO authenticated
  USING (public.can_write_financial_data(business_id));

-- ── Expenses and the full expense ledger ─────────────────────────────────────
CREATE POLICY expenses_financial_read
  ON public.expenses FOR SELECT TO authenticated
  USING (
    public.can_read_financial_data(business_id)
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY expenses_financial_insert
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY expenses_financial_update
  ON public.expenses FOR UPDATE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  )
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY expenses_financial_delete
  ON public.expenses FOR DELETE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY expense_lines_financial_read
  ON public.expense_lines FOR SELECT TO authenticated
  USING (
    public.can_read_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_lines.expense_id
        AND e.business_id = expense_lines.business_id
    )
  );

CREATE POLICY expense_lines_financial_insert
  ON public.expense_lines FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_lines.expense_id
        AND e.business_id = expense_lines.business_id
    )
  );

CREATE POLICY expense_lines_financial_update
  ON public.expense_lines FOR UPDATE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_lines.expense_id
        AND e.business_id = expense_lines.business_id
    )
  )
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_lines.expense_id
        AND e.business_id = expense_lines.business_id
    )
  );

CREATE POLICY expense_lines_financial_delete
  ON public.expense_lines FOR DELETE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_lines.expense_id
        AND e.business_id = expense_lines.business_id
    )
  );

CREATE POLICY expense_payments_financial_read
  ON public.expense_payments FOR SELECT TO authenticated
  USING (
    public.can_read_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_payments.expense_id
        AND e.business_id = expense_payments.business_id
    )
  );

CREATE POLICY expense_payments_financial_insert
  ON public.expense_payments FOR INSERT TO authenticated
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_payments.expense_id
        AND e.business_id = expense_payments.business_id
    )
  );

CREATE POLICY expense_payments_financial_update
  ON public.expense_payments FOR UPDATE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_payments.expense_id
        AND e.business_id = expense_payments.business_id
    )
  )
  WITH CHECK (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_payments.expense_id
        AND e.business_id = expense_payments.business_id
    )
  );

CREATE POLICY expense_payments_financial_delete
  ON public.expense_payments FOR DELETE TO authenticated
  USING (
    public.can_write_financial_data(business_id)
    AND EXISTS (
      SELECT 1 FROM public.expenses e
      WHERE e.id = expense_payments.expense_id
        AND e.business_id = expense_payments.business_id
    )
  );

-- ── Sales invoices: role-limited exception for POS ───────────────────────────
CREATE POLICY invoices_financial_or_sales_read
  ON public.invoices FOR SELECT TO authenticated
  USING (
    (
      public.can_read_financial_data(business_id)
      OR public.can_write_sales_invoice_data(business_id)
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY invoices_financial_or_sales_insert
  ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.can_write_financial_data(business_id)
      OR (
        public.can_write_sales_invoice_data(business_id)
        AND invoice_type IN ('invoice', 'sales')
      )
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY invoices_financial_or_sales_update
  ON public.invoices FOR UPDATE TO authenticated
  USING (
    (
      public.can_write_financial_data(business_id)
      OR (
        public.can_write_sales_invoice_data(business_id)
        AND invoice_type IN ('invoice', 'sales')
      )
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  )
  WITH CHECK (
    (
      public.can_write_financial_data(business_id)
      OR (
        public.can_write_sales_invoice_data(business_id)
        AND invoice_type IN ('invoice', 'sales')
      )
    )
    AND (
      public.is_platform_admin(auth.uid())
      OR public.can_access_branch(business_id, branch_id)
    )
  );

CREATE POLICY invoices_financial_delete
  ON public.invoices FOR DELETE TO authenticated
  USING (
    public.can_admin_business_data(business_id)
    OR public.is_platform_admin(auth.uid())
  );

CREATE POLICY invoice_lines_financial_or_sales_read
  ON public.invoice_lines FOR SELECT TO authenticated
  USING (
    (
      public.can_read_financial_data(business_id)
      OR public.can_write_sales_invoice_data(business_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND i.business_id = invoice_lines.business_id
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  );

CREATE POLICY invoice_lines_financial_or_sales_insert
  ON public.invoice_lines FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND i.business_id = invoice_lines.business_id
        AND (
          public.can_write_financial_data(invoice_lines.business_id)
          OR (
            public.can_write_sales_invoice_data(invoice_lines.business_id)
            AND i.invoice_type IN ('invoice', 'sales')
          )
        )
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  );

CREATE POLICY invoice_lines_financial_or_sales_update
  ON public.invoice_lines FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND i.business_id = invoice_lines.business_id
        AND (
          public.can_write_financial_data(invoice_lines.business_id)
          OR (
            public.can_write_sales_invoice_data(invoice_lines.business_id)
            AND i.invoice_type IN ('invoice', 'sales')
          )
        )
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_lines.invoice_id
        AND i.business_id = invoice_lines.business_id
        AND (
          public.can_write_financial_data(invoice_lines.business_id)
          OR (
            public.can_write_sales_invoice_data(invoice_lines.business_id)
            AND i.invoice_type IN ('invoice', 'sales')
          )
        )
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  );

CREATE POLICY invoice_lines_financial_delete
  ON public.invoice_lines FOR DELETE TO authenticated
  USING (
    public.can_admin_business_data(business_id)
    OR public.is_platform_admin(auth.uid())
  );

CREATE POLICY invoice_payments_financial_or_sales_read
  ON public.invoice_payments FOR SELECT TO authenticated
  USING (
    (
      public.can_read_financial_data(business_id)
      OR public.can_write_sales_invoice_data(business_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND i.business_id = invoice_payments.business_id
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  );

CREATE POLICY invoice_payments_financial_or_sales_insert
  ON public.invoice_payments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND i.business_id = invoice_payments.business_id
        AND (
          public.can_write_financial_data(invoice_payments.business_id)
          OR (
            public.can_write_sales_invoice_data(invoice_payments.business_id)
            AND i.invoice_type IN ('invoice', 'sales')
          )
        )
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  );

CREATE POLICY invoice_payments_financial_or_sales_update
  ON public.invoice_payments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND i.business_id = invoice_payments.business_id
        AND (
          public.can_write_financial_data(invoice_payments.business_id)
          OR (
            public.can_write_sales_invoice_data(invoice_payments.business_id)
            AND i.invoice_type IN ('invoice', 'sales')
          )
        )
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.invoices i
      WHERE i.id = invoice_payments.invoice_id
        AND i.business_id = invoice_payments.business_id
        AND (
          public.can_write_financial_data(invoice_payments.business_id)
          OR (
            public.can_write_sales_invoice_data(invoice_payments.business_id)
            AND i.invoice_type IN ('invoice', 'sales')
          )
        )
        AND (
          public.is_platform_admin(auth.uid())
          OR public.can_access_branch(i.business_id, i.branch_id)
        )
    )
  );

CREATE POLICY invoice_payments_financial_delete
  ON public.invoice_payments FOR DELETE TO authenticated
  USING (
    public.can_admin_business_data(business_id)
    OR public.is_platform_admin(auth.uid())
  );
