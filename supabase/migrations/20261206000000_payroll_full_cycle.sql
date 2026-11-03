-- Phase 6D-1 — Payroll full-cycle schema, tax configuration and seed data.
--
-- Discovery (2026-11-03): this repository already has employees,
-- payroll_runs, payroll_employee_lines, paye_bands, tax_configurations,
-- employee_allowances and employee_deductions. The legacy annual PAYE bands
-- and payroll tables remain in place for the existing PayrollPage. This
-- migration extends employees in place, preserves those legacy tables and
-- adds the new period-based full-cycle tables alongside them. No PAYE or
-- pension pay_components existed; the default catalog is seeded once per
-- business. The existing 2026/27 PAYE reference bands in paye_bands are not
-- overwritten; tax_bands stores the monthly, fractional-rate table required
-- by the new RPCs.

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.employee_status AS ENUM ('active', 'on_leave', 'terminated', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.pay_run_status AS ENUM ('draft', 'calculated', 'approved', 'posted', 'reversed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- RLS helper requested by this phase. The existing membership predicate is the
-- canonical source of business read access in the current schema.
CREATE OR REPLACE FUNCTION public.can_read_business_data(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_business_member(p_business_id)
$$;
REVOKE ALL ON FUNCTION public.can_read_business_data(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.can_read_business_data(uuid) TO authenticated, service_role;

-- ── Existing employees table: extend, do not recreate ────────────────────────
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS tax_id text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS hire_date date;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS termination_date date;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department text;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS status public.employee_status NOT NULL DEFAULT 'active';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);

UPDATE public.employees
SET tax_id = COALESCE(tax_id, tpin),
    hire_date = COALESCE(hire_date, start_date),
    termination_date = COALESCE(termination_date, end_date),
    department = COALESCE(department, (
      SELECT d.name FROM public.departments d
      WHERE d.id = employees.department_id AND d.business_id = employees.business_id
    )),
    status = CASE
      WHEN COALESCE(end_date, termination_date) IS NOT NULL THEN 'terminated'::public.employee_status
      WHEN is_active IS FALSE THEN 'suspended'::public.employee_status
      ELSE 'active'::public.employee_status
    END;

-- The legacy PayrollPage writes start_date but does not know about hire_date.
-- Leave the new column without a default and derive it on insert so those
-- existing writes retain their intended start date instead of today's date.
ALTER TABLE public.employees ALTER COLUMN hire_date DROP DEFAULT;
ALTER TABLE public.employees ALTER COLUMN hire_date SET NOT NULL;

CREATE OR REPLACE FUNCTION public.set_employee_hire_date_from_start_date()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.hire_date IS NULL THEN NEW.hire_date := NEW.start_date; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS employees_fill_hire_date ON public.employees;
CREATE TRIGGER employees_fill_hire_date
BEFORE INSERT ON public.employees FOR EACH ROW
EXECUTE FUNCTION public.set_employee_hire_date_from_start_date();

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM public.employees
    GROUP BY business_id, employee_number
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce employee-number uniqueness: duplicate employee numbers exist within a business.'
      USING ERRCODE = '23505', HINT = 'Reconcile duplicate employees.employee_number values and retry the migration.';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS employees_business_employee_number_uidx
  ON public.employees (business_id, employee_number);
CREATE INDEX IF NOT EXISTS employees_business_status_idx
  ON public.employees (business_id, status);
CREATE INDEX IF NOT EXISTS employees_business_last_name_idx
  ON public.employees (business_id, last_name);

-- Composite keys let every tenant-scoped foreign key prove that related
-- records belong to the same business, not merely that their UUID exists.
CREATE UNIQUE INDEX IF NOT EXISTS employees_business_id_id_uq ON public.employees (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_business_id_id_uq ON public.accounts (business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_business_id_id_uq ON public.journal_entries (business_id, id);

-- ── New tables (legacy payroll tables above are intentionally retained) ──────
CREATE TABLE IF NOT EXISTS public.employee_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  pay_frequency text NOT NULL DEFAULT 'monthly',
  gross_salary numeric NOT NULL,
  currency text NOT NULL,
  contract_type text NOT NULL DEFAULT 'permanent',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_contracts_frequency_check CHECK (pay_frequency IN ('monthly', 'biweekly', 'weekly')),
  CONSTRAINT employee_contracts_type_check CHECK (contract_type IN ('permanent', 'contract', 'casual')),
  CONSTRAINT employee_contracts_date_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_contracts_employee_business_fk FOREIGN KEY (business_id, employee_id)
    REFERENCES public.employees (business_id, id) ON DELETE CASCADE,
  UNIQUE (business_id, employee_id, effective_from)
);

CREATE TABLE IF NOT EXISTS public.pay_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  component_type text NOT NULL,
  calculation_basis text NOT NULL DEFAULT 'fixed',
  default_amount numeric DEFAULT 0,
  default_rate numeric DEFAULT 0,
  is_taxable boolean NOT NULL DEFAULT true,
  is_statutory boolean NOT NULL DEFAULT false,
  gl_account_id uuid,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code),
  CONSTRAINT pay_components_account_business_fk FOREIGN KEY (business_id, gl_account_id)
    REFERENCES public.accounts (business_id, id),
  CONSTRAINT pay_components_type_check CHECK (component_type IN ('earning', 'deduction')),
  CONSTRAINT pay_components_basis_check CHECK (calculation_basis IN ('fixed', 'percentage_of_gross', 'tax_table', 'overtime_multiplier')),
  CONSTRAINT pay_components_nonnegative_check CHECK (COALESCE(default_amount, 0) >= 0 AND COALESCE(default_rate, 0) >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_components_business_id_id_uq ON public.pay_components (business_id, id);

CREATE TABLE IF NOT EXISTS public.employee_pay_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  pay_component_id uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  override_amount numeric,
  override_rate numeric,
  CONSTRAINT employee_pay_components_date_check CHECK (effective_to IS NULL OR effective_to >= effective_from),
  CONSTRAINT employee_pay_components_employee_business_fk FOREIGN KEY (business_id, employee_id)
    REFERENCES public.employees (business_id, id) ON DELETE CASCADE,
  CONSTRAINT employee_pay_components_component_business_fk FOREIGN KEY (business_id, pay_component_id)
    REFERENCES public.pay_components (business_id, id) ON DELETE CASCADE,
  UNIQUE (business_id, employee_id, pay_component_id, effective_from)
);

CREATE TABLE IF NOT EXISTS public.tax_bands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  fiscal_year int NOT NULL,
  band_number int NOT NULL,
  lower_bound numeric NOT NULL,
  upper_bound numeric,
  rate numeric NOT NULL,
  currency text NOT NULL,
  UNIQUE (business_id, fiscal_year, band_number),
  CONSTRAINT tax_bands_rate_check CHECK (rate >= 0 AND rate <= 1),
  CONSTRAINT tax_bands_lower_bound_check CHECK (lower_bound >= 0),
  CONSTRAINT tax_bands_bounds_check CHECK (upper_bound IS NULL OR upper_bound > lower_bound)
);

CREATE TABLE IF NOT EXISTS public.pay_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  pay_date date NOT NULL,
  status public.pay_run_status NOT NULL DEFAULT 'draft',
  total_gross numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  total_net numeric NOT NULL DEFAULT 0,
  total_employer_cost numeric NOT NULL DEFAULT 0,
  employee_count int NOT NULL DEFAULT 0,
  journal_entry_id uuid,
  calculated_by uuid REFERENCES auth.users(id),
  approved_by uuid REFERENCES auth.users(id),
  posted_by uuid REFERENCES auth.users(id),
  calculated_at timestamptz,
  approved_at timestamptz,
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pay_runs_period_check CHECK (period_end >= period_start),
  CONSTRAINT pay_runs_journal_business_fk FOREIGN KEY (business_id, journal_entry_id)
    REFERENCES public.journal_entries (business_id, id),
  UNIQUE (business_id, period_start, period_end)
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_runs_business_id_id_uq ON public.pay_runs (business_id, id);

CREATE TABLE IF NOT EXISTS public.pay_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  pay_run_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  gross_pay numeric NOT NULL DEFAULT 0,
  taxable_pay numeric NOT NULL DEFAULT 0,
  total_deductions numeric NOT NULL DEFAULT 0,
  net_pay numeric NOT NULL DEFAULT 0,
  paye_amount numeric NOT NULL DEFAULT 0,
  days_worked int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'included',
  UNIQUE (pay_run_id, employee_id),
  CONSTRAINT pay_run_lines_run_business_fk FOREIGN KEY (business_id, pay_run_id)
    REFERENCES public.pay_runs (business_id, id) ON DELETE CASCADE,
  CONSTRAINT pay_run_lines_employee_business_fk FOREIGN KEY (business_id, employee_id)
    REFERENCES public.employees (business_id, id) ON DELETE CASCADE,
  CONSTRAINT pay_run_lines_status_check CHECK (status IN ('included', 'excluded')),
  CONSTRAINT pay_run_lines_amounts_check CHECK (gross_pay >= 0 AND taxable_pay >= 0 AND total_deductions >= 0 AND net_pay >= 0 AND paye_amount >= 0 AND days_worked >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS pay_run_lines_business_id_id_uq ON public.pay_run_lines (business_id, id);

CREATE TABLE IF NOT EXISTS public.pay_run_component_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  pay_run_line_id uuid NOT NULL,
  pay_component_id uuid NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  is_earning boolean NOT NULL,
  UNIQUE (pay_run_line_id, pay_component_id),
  CONSTRAINT pay_run_component_details_line_business_fk FOREIGN KEY (business_id, pay_run_line_id)
    REFERENCES public.pay_run_lines (business_id, id) ON DELETE CASCADE,
  CONSTRAINT pay_run_component_details_component_business_fk FOREIGN KEY (business_id, pay_component_id)
    REFERENCES public.pay_components (business_id, id),
  CONSTRAINT pay_run_component_details_amount_check CHECK (amount >= 0)
);

CREATE TABLE IF NOT EXISTS public.leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  annual_entitlement_days numeric NOT NULL DEFAULT 0,
  is_paid boolean NOT NULL DEFAULT true,
  requires_approval boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code),
  CONSTRAINT leave_types_entitlement_check CHECK (annual_entitlement_days >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS leave_types_business_id_id_uq ON public.leave_types (business_id, id);

CREATE TABLE IF NOT EXISTS public.leave_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  year int NOT NULL,
  entitled_days numeric NOT NULL DEFAULT 0,
  used_days numeric NOT NULL DEFAULT 0,
  carried_forward numeric NOT NULL DEFAULT 0,
  last_accrued_month date,
  CONSTRAINT leave_balances_employee_business_fk FOREIGN KEY (business_id, employee_id)
    REFERENCES public.employees (business_id, id) ON DELETE CASCADE,
  CONSTRAINT leave_balances_type_business_fk FOREIGN KEY (business_id, leave_type_id)
    REFERENCES public.leave_types (business_id, id) ON DELETE CASCADE,
  UNIQUE (business_id, employee_id, leave_type_id, year),
  CONSTRAINT leave_balances_amounts_check CHECK (entitled_days >= 0 AND used_days >= 0 AND carried_forward >= 0)
);
ALTER TABLE public.leave_balances ADD COLUMN IF NOT EXISTS last_accrued_month date;

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  total_days numeric NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_employee_business_fk FOREIGN KEY (business_id, employee_id)
    REFERENCES public.employees (business_id, id) ON DELETE CASCADE,
  CONSTRAINT leave_requests_type_business_fk FOREIGN KEY (business_id, leave_type_id)
    REFERENCES public.leave_types (business_id, id),
  CONSTRAINT leave_requests_status_check CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT leave_requests_dates_check CHECK (end_date >= start_date AND total_days > 0)
);

-- Backfill the existing employee salary into an effective-dated contract.
-- Existing allowance/deduction and payroll run rows are left untouched.
INSERT INTO public.employee_contracts (
  business_id, employee_id, effective_from, effective_to, pay_frequency,
  gross_salary, currency, contract_type
)
SELECT e.business_id, e.id, COALESCE(e.hire_date, e.start_date),
       COALESCE(e.termination_date, e.end_date),
       CASE WHEN e.pay_frequency IN ('weekly', 'biweekly') THEN e.pay_frequency ELSE 'monthly' END,
       e.gross_salary, e.currency::text,
       CASE WHEN e.employment_type IN ('contract', 'casual') THEN e.employment_type ELSE 'permanent' END
FROM public.employees e
WHERE NOT EXISTS (
  SELECT 1 FROM public.employee_contracts ec
  WHERE ec.business_id = e.business_id AND ec.employee_id = e.id
);

-- ── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS employee_contracts_current_lookup_idx
  ON public.employee_contracts (business_id, employee_id, effective_from DESC, effective_to);
CREATE INDEX IF NOT EXISTS pay_components_business_active_sort_idx
  ON public.pay_components (business_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS employee_pay_components_current_idx
  ON public.employee_pay_components (business_id, employee_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS tax_bands_business_year_order_idx
  ON public.tax_bands (business_id, fiscal_year, band_number);
CREATE INDEX IF NOT EXISTS pay_runs_business_period_idx
  ON public.pay_runs (business_id, period_end DESC);
CREATE INDEX IF NOT EXISTS pay_run_lines_business_run_idx
  ON public.pay_run_lines (business_id, pay_run_id);
CREATE INDEX IF NOT EXISTS pay_run_component_details_business_line_idx
  ON public.pay_run_component_details (business_id, pay_run_line_id);
CREATE INDEX IF NOT EXISTS leave_balances_business_employee_year_idx
  ON public.leave_balances (business_id, employee_id, year);
CREATE INDEX IF NOT EXISTS leave_requests_business_employee_status_idx
  ON public.leave_requests (business_id, employee_id, status, start_date);

-- ── Uniform RLS on the 11 full-cycle tables ─────────────────────────────────
DO $$
DECLARE
  v_table text;
  v_policy record;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'employees', 'employee_contracts', 'pay_components', 'employee_pay_components',
    'tax_bands', 'pay_runs', 'pay_run_lines', 'pay_run_component_details',
    'leave_types', 'leave_balances', 'leave_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    FOR v_policy IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT USING (public.can_read_business_data(business_id))',
      v_table || '_select', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (public.can_write_business_data(business_id))',
      v_table || '_insert', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (public.can_write_business_data(business_id)) WITH CHECK (public.can_write_business_data(business_id))',
      v_table || '_update', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (public.can_write_business_data(business_id))',
      v_table || '_delete', v_table
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', v_table);
  END LOOP;
END
$$;

-- ── Seed Malawi tax bands (monthly thresholds, rates as fractions) ───────────
INSERT INTO public.tax_bands (business_id, fiscal_year, band_number, lower_bound, upper_bound, rate, currency)
SELECT b.id, 2026, bands.band_number, bands.lower_bound, bands.upper_bound, bands.rate, b.base_currency
FROM public.businesses b
CROSS JOIN (VALUES
  (1, 0::numeric, 170000::numeric, 0::numeric),
  (2, 170000::numeric, 1570000::numeric, 0.30::numeric),
  (3, 1570000::numeric, 10000000::numeric, 0.35::numeric),
  (4, 10000000::numeric, NULL::numeric, 0.40::numeric)
) AS bands(band_number, lower_bound, upper_bound, rate)
WHERE b.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tax_bands tb
    WHERE tb.business_id = b.id AND tb.fiscal_year = 2026
  )
ON CONFLICT (business_id, fiscal_year, band_number) DO NOTHING;

-- Seed statutory defaults for every existing business. Account references are
-- resolved by code where that account exists; components may be linked to a
-- tenant-specific account later if its chart uses different codes.
INSERT INTO public.pay_components (
  business_id, code, name, component_type, calculation_basis, default_amount,
  default_rate, is_taxable, is_statutory, gl_account_id, sort_order, is_active
)
SELECT b.id, seed.code, seed.name, seed.component_type, seed.calculation_basis,
       seed.default_amount, seed.default_rate, seed.is_taxable, seed.is_statutory,
       a.id, seed.sort_order, true
FROM public.businesses b
LEFT JOIN LATERAL (
  SELECT tc.employee_rate, tc.employer_rate
  FROM public.tax_configurations tc
  WHERE tc.business_id = b.id AND tc.tax_code = 'tpr_pension'::public.tax_code
    AND tc.is_active IS TRUE
  ORDER BY tc.effective_from DESC
  LIMIT 1
) pension ON true
CROSS JOIN (VALUES
  ('BASIC', 'Basic Salary', 'earning', 'fixed', 0::numeric, 0::numeric, true, true, '6110', 1),
  ('HOUSING', 'Housing Allowance', 'earning', 'fixed', 0::numeric, 0::numeric, true, false, '6111', 2),
  ('TRANSPORT', 'Transport Allowance', 'earning', 'fixed', 0::numeric, 0::numeric, true, false, '6111', 3),
  ('OVERTIME', 'Overtime', 'earning', 'overtime_multiplier', 0::numeric, 0::numeric, true, false, '6111', 4),
  ('PAYE', 'PAYE Tax', 'deduction', 'tax_table', 0::numeric, 0::numeric, false, true, '2122', 10),
  ('PENSION_EE', 'Pension (Employee)', 'deduction', 'percentage_of_gross', 0::numeric, COALESCE(pension.employee_rate, 5)::numeric, false, true, '2132', 11),
  ('PENSION_ER', 'Pension (Employer)', 'earning', 'percentage_of_gross', 0::numeric, COALESCE(pension.employer_rate, 10)::numeric, false, true, '6112', 12)
) AS seed(code, name, component_type, calculation_basis, default_amount, default_rate, is_taxable, is_statutory, gl_code, sort_order)
LEFT JOIN LATERAL (
  SELECT ac.id FROM public.accounts ac
  WHERE ac.business_id = b.id AND ac.code = seed.gl_code
    AND ac.is_active IS TRUE AND ac.deleted_at IS NULL
  LIMIT 1
) a ON true
WHERE b.deleted_at IS NULL
ON CONFLICT (business_id, code) DO UPDATE SET
  name = EXCLUDED.name,
  component_type = EXCLUDED.component_type,
  calculation_basis = EXCLUDED.calculation_basis,
  default_amount = EXCLUDED.default_amount,
  default_rate = EXCLUDED.default_rate,
  is_taxable = EXCLUDED.is_taxable,
  is_statutory = EXCLUDED.is_statutory,
  gl_account_id = COALESCE(EXCLUDED.gl_account_id, pay_components.gl_account_id),
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = now();

INSERT INTO public.leave_types (business_id, code, name, annual_entitlement_days, is_paid, requires_approval, is_active)
SELECT b.id, seed.code, seed.name, seed.annual_entitlement_days, seed.is_paid, seed.requires_approval, true
FROM public.businesses b
CROSS JOIN (VALUES
  ('ANNUAL', 'Annual Leave', 18::numeric, true, true),
  ('SICK', 'Sick Leave', 12::numeric, true, true),
  ('MATERNITY', 'Maternity Leave', 84::numeric, true, true),
  ('PATERNITY', 'Paternity Leave', 5::numeric, true, true),
  ('COMPASSIONATE', 'Compassionate Leave', 5::numeric, true, false)
) AS seed(code, name, annual_entitlement_days, is_paid, requires_approval)
WHERE b.deleted_at IS NULL
ON CONFLICT (business_id, code) DO NOTHING;

-- Keep defaults available to businesses created after this migration as well.
-- seed_new_business inserts the business row before its chart of accounts, so
-- a separate accounts trigger fills any initially unresolved GL references.
CREATE OR REPLACE FUNCTION public.seed_payroll_defaults_for_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fiscal_year integer := CASE
    WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 7 THEN EXTRACT(YEAR FROM CURRENT_DATE)::integer
    ELSE EXTRACT(YEAR FROM CURRENT_DATE)::integer - 1
  END;
BEGIN
  INSERT INTO public.tax_bands (business_id, fiscal_year, band_number, lower_bound, upper_bound, rate, currency)
  VALUES
    (NEW.id, v_fiscal_year, 1, 0, 170000, 0, NEW.base_currency),
    (NEW.id, v_fiscal_year, 2, 170000, 1570000, 0.30, NEW.base_currency),
    (NEW.id, v_fiscal_year, 3, 1570000, 10000000, 0.35, NEW.base_currency),
    (NEW.id, v_fiscal_year, 4, 10000000, NULL, 0.40, NEW.base_currency)
  ON CONFLICT (business_id, fiscal_year, band_number) DO NOTHING;

  INSERT INTO public.pay_components (
    business_id, code, name, component_type, calculation_basis, default_amount,
    default_rate, is_taxable, is_statutory, gl_account_id, sort_order, is_active
  )
  SELECT NEW.id, seed.code, seed.name, seed.component_type, seed.calculation_basis,
         seed.default_amount, seed.default_rate, seed.is_taxable, seed.is_statutory,
         account.id, seed.sort_order, true
  FROM (VALUES
    ('BASIC', 'Basic Salary', 'earning', 'fixed', 0::numeric, 0::numeric, true, true, '6110', 1),
    ('HOUSING', 'Housing Allowance', 'earning', 'fixed', 0::numeric, 0::numeric, true, false, '6111', 2),
    ('TRANSPORT', 'Transport Allowance', 'earning', 'fixed', 0::numeric, 0::numeric, true, false, '6111', 3),
    ('OVERTIME', 'Overtime', 'earning', 'overtime_multiplier', 0::numeric, 0::numeric, true, false, '6111', 4),
    ('PAYE', 'PAYE Tax', 'deduction', 'tax_table', 0::numeric, 0::numeric, false, true, '2122', 10),
    ('PENSION_EE', 'Pension (Employee)', 'deduction', 'percentage_of_gross', 0::numeric, 5::numeric, false, true, '2132', 11),
    ('PENSION_ER', 'Pension (Employer)', 'earning', 'percentage_of_gross', 0::numeric, 10::numeric, false, true, '6112', 12)
  ) AS seed(code, name, component_type, calculation_basis, default_amount, default_rate, is_taxable, is_statutory, gl_code, sort_order)
  LEFT JOIN LATERAL (
    SELECT a.id FROM public.accounts a
    WHERE a.business_id = NEW.id AND a.code = seed.gl_code
      AND a.is_active IS TRUE AND a.deleted_at IS NULL
    LIMIT 1
  ) account ON true
  ON CONFLICT (business_id, code) DO NOTHING;

  INSERT INTO public.leave_types (business_id, code, name, annual_entitlement_days, is_paid, requires_approval, is_active)
  VALUES
    (NEW.id, 'ANNUAL', 'Annual Leave', 18, true, true, true),
    (NEW.id, 'SICK', 'Sick Leave', 12, true, true, true),
    (NEW.id, 'MATERNITY', 'Maternity Leave', 84, true, true, true),
    (NEW.id, 'PATERNITY', 'Paternity Leave', 5, true, true, true),
    (NEW.id, 'COMPASSIONATE', 'Compassionate Leave', 5, true, false, true)
  ON CONFLICT (business_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_payroll_component_account()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.pay_components pc
  SET gl_account_id = NEW.id, updated_at = now()
  WHERE pc.business_id = NEW.business_id AND pc.gl_account_id IS NULL
    AND ((NEW.code = '6110' AND pc.code = 'BASIC')
      OR (NEW.code = '6111' AND pc.code IN ('HOUSING', 'TRANSPORT', 'OVERTIME'))
      OR (NEW.code = '6112' AND pc.code = 'PENSION_ER')
      OR (NEW.code = '2122' AND pc.code = 'PAYE')
      OR (NEW.code = '2132' AND pc.code = 'PENSION_EE'));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_payroll_defaults_for_business() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_payroll_component_account() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS businesses_seed_payroll_defaults ON public.businesses;
CREATE TRIGGER businesses_seed_payroll_defaults
AFTER INSERT ON public.businesses FOR EACH ROW
EXECUTE FUNCTION public.seed_payroll_defaults_for_business();
DROP TRIGGER IF EXISTS accounts_sync_payroll_component_account ON public.accounts;
CREATE TRIGGER accounts_sync_payroll_component_account
AFTER INSERT ON public.accounts FOR EACH ROW
EXECUTE FUNCTION public.sync_payroll_component_account();

-- ── RPC: calculate and persist a full-cycle pay run ──────────────────────────
CREATE OR REPLACE FUNCTION public.calculate_pay_run(
  p_business_id uuid,
  p_period_start date,
  p_period_end date,
  p_pay_date date
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.pay_runs%ROWTYPE;
  v_employee record;
  v_contract record;
  v_component record;
  v_band record;
  v_override record;
  v_run_id uuid;
  v_line_id uuid;
  v_paye_component_id uuid;
  v_total_days integer;
  v_days_worked integer;
  v_salary numeric;
  v_basic_gross numeric;
  v_component_amount numeric;
  v_gross numeric;
  v_taxable numeric;
  v_other_deductions numeric;
  v_paye numeric;
  v_pension_employer numeric;
  v_net numeric;
  v_total_gross numeric := 0;
  v_total_deductions numeric := 0;
  v_total_net numeric := 0;
  v_total_employer_cost numeric := 0;
  v_employee_count integer := 0;
  v_fiscal_year integer;
  v_band_count integer;
  v_details jsonb;
  v_lines jsonb;
  v_contract_found boolean;
BEGIN
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'You do not have permission to calculate payroll for this business.' USING ERRCODE = '42501';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_pay_date IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'A valid payroll period and pay date are required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM public.pay_runs
  WHERE business_id = p_business_id AND period_start = p_period_start AND period_end = p_period_end
  FOR UPDATE;
  IF FOUND THEN
    IF v_run.status NOT IN ('draft', 'calculated') THEN
      RAISE EXCEPTION 'Only a draft or calculated pay run can be recalculated.' USING ERRCODE = '55000';
    END IF;
    v_run_id := v_run.id;
    DELETE FROM public.pay_run_lines WHERE business_id = p_business_id AND pay_run_id = v_run_id;
    UPDATE public.pay_runs SET pay_date = p_pay_date, status = 'draft', total_gross = 0,
      total_deductions = 0, total_net = 0, total_employer_cost = 0, employee_count = 0,
      calculated_by = auth.uid(), calculated_at = NULL, updated_at = now()
    WHERE id = v_run_id;
  ELSE
    INSERT INTO public.pay_runs (business_id, period_start, period_end, pay_date, status)
    VALUES (p_business_id, p_period_start, p_period_end, p_pay_date, 'draft')
    RETURNING id INTO v_run_id;
  END IF;

  v_total_days := p_period_end - p_period_start + 1;
  v_fiscal_year := CASE
    WHEN EXTRACT(MONTH FROM p_pay_date) >= 7 THEN EXTRACT(YEAR FROM p_pay_date)::integer
    ELSE EXTRACT(YEAR FROM p_pay_date)::integer - 1
  END;

  FOR v_employee IN
    SELECT e.*
    FROM public.employees e
    WHERE e.business_id = p_business_id
      AND e.status IN ('active', 'terminated')
      AND (e.is_active IS TRUE OR (e.status = 'terminated'
        AND COALESCE(LEAST(e.termination_date, e.end_date), e.termination_date, e.end_date) >= p_period_start))
      AND COALESCE(LEAST(e.termination_date, e.end_date), e.termination_date, e.end_date, p_period_end) >= p_period_start
      AND e.deleted_at IS NULL
    ORDER BY e.last_name, e.first_name
  LOOP
    SELECT ec.gross_salary, ec.currency, ec.pay_frequency
    INTO v_contract
    FROM public.employee_contracts ec
    WHERE ec.business_id = p_business_id AND ec.employee_id = v_employee.id
      AND ec.effective_from <= p_period_end
      AND (ec.effective_to IS NULL OR ec.effective_to >= p_period_start)
    ORDER BY ec.effective_from DESC
    LIMIT 1;
    v_contract_found := FOUND;
    -- Legacy PayrollPage writes employees directly. Keep those records usable
    -- until all writers have moved to employee_contracts.
    IF v_contract_found THEN
      v_salary := v_contract.gross_salary;
    ELSE
      v_salary := v_employee.gross_salary;
    END IF;

    v_days_worked := GREATEST(0,
      LEAST(p_period_end, COALESCE(LEAST(v_employee.termination_date, v_employee.end_date), v_employee.termination_date, v_employee.end_date, p_period_end))
      - GREATEST(p_period_start, v_employee.hire_date, v_employee.start_date) + 1
    );
    IF v_days_worked = 0 OR v_salary <= 0 THEN CONTINUE; END IF;

    v_gross := round(v_salary * v_days_worked::numeric / v_total_days, 2);
    v_basic_gross := v_gross;
    v_taxable := 0;
    v_other_deductions := 0;
    v_pension_employer := 0;
    v_details := '[]'::jsonb;

    -- Basic salary is the effective-dated contract amount; all other active
    -- components are applied using an effective employee override or default.
    FOR v_component IN
      SELECT pc.*
      FROM public.pay_components pc
      WHERE pc.business_id = p_business_id AND pc.is_active IS TRUE
      ORDER BY pc.sort_order, pc.code
    LOOP
      IF v_component.code = 'PAYE' THEN CONTINUE; END IF;
      SELECT epc.override_amount, epc.override_rate
      INTO v_override
      FROM public.employee_pay_components epc
      WHERE epc.business_id = p_business_id AND epc.employee_id = v_employee.id
        AND epc.pay_component_id = v_component.id
        AND epc.effective_from <= p_period_end
        AND (epc.effective_to IS NULL OR epc.effective_to >= p_period_start)
      ORDER BY epc.effective_from DESC
      LIMIT 1;

      IF v_component.code = 'BASIC' THEN
        v_component_amount := v_basic_gross;
      ELSIF v_component.calculation_basis = 'fixed' THEN
        v_component_amount := COALESCE(v_override.override_amount, v_component.default_amount, 0)
          * v_days_worked::numeric / v_total_days;
      ELSIF v_component.calculation_basis = 'percentage_of_gross' THEN
        v_component_amount := v_basic_gross * COALESCE(v_override.override_rate, v_component.default_rate, 0) / 100;
      ELSIF v_component.calculation_basis = 'overtime_multiplier' THEN
        v_component_amount := COALESCE(v_override.override_amount, v_component.default_amount, 0);
      ELSE
        v_component_amount := 0;
      END IF;
      v_component_amount := round(GREATEST(v_component_amount, 0), 2);

      IF v_component.code = 'BASIC' THEN
        IF v_component.is_taxable THEN v_taxable := v_taxable + v_component_amount; END IF;
      ELSIF v_component.code = 'PENSION_ER' THEN
        v_pension_employer := v_pension_employer + v_component_amount;
      ELSIF v_component.component_type = 'earning' THEN
        v_gross := v_gross + v_component_amount;
        IF v_component.is_taxable THEN v_taxable := v_taxable + v_component_amount; END IF;
      ELSE
        v_other_deductions := v_other_deductions + v_component_amount;
      END IF;
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'component_id', v_component.id,
        'amount', v_component_amount,
        'is_earning', v_component.component_type = 'earning'
      ));
    END LOOP;

    SELECT COUNT(*) INTO v_band_count FROM public.tax_bands tb
    WHERE tb.business_id = p_business_id AND tb.fiscal_year = v_fiscal_year;
    IF v_band_count = 0 THEN
      RAISE EXCEPTION 'No PAYE tax bands are configured for fiscal year %.', v_fiscal_year USING ERRCODE = 'P0001';
    END IF;
    v_paye := 0;
    IF v_employee.tax_exempt IS NOT TRUE THEN
      FOR v_band IN
        SELECT tb.lower_bound, tb.upper_bound, tb.rate
        FROM public.tax_bands tb
        WHERE tb.business_id = p_business_id AND tb.fiscal_year = v_fiscal_year
        ORDER BY tb.band_number
      LOOP
        v_paye := COALESCE(v_paye, 0)
          + GREATEST(0, LEAST(v_taxable, COALESCE(v_band.upper_bound, v_taxable)) - v_band.lower_bound) * v_band.rate;
      END LOOP;
    ELSE
      v_paye := 0;
    END IF;
    v_paye := round(COALESCE(v_paye, 0), 2);
    SELECT pc.id INTO v_paye_component_id FROM public.pay_components pc
    WHERE pc.business_id = p_business_id AND pc.code = 'PAYE' AND pc.is_active IS TRUE;
    IF v_paye_component_id IS NOT NULL THEN
      v_details := v_details || jsonb_build_array(jsonb_build_object(
        'component_id', v_paye_component_id, 'amount', v_paye, 'is_earning', false
      ));
    END IF;

    IF v_other_deductions + v_paye > v_gross THEN
      RAISE EXCEPTION 'Deductions exceed gross pay for employee %.', v_employee.employee_number USING ERRCODE = '23514';
    END IF;
    v_net := round(v_gross - v_other_deductions - v_paye, 2);
    v_other_deductions := round(v_other_deductions + v_paye, 2);
    v_total_gross := v_total_gross + v_gross;
    v_total_deductions := v_total_deductions + v_other_deductions;
    v_total_net := v_total_net + v_net;
    v_total_employer_cost := v_total_employer_cost + v_gross + v_pension_employer;
    v_employee_count := v_employee_count + 1;

    INSERT INTO public.pay_run_lines (
      business_id, pay_run_id, employee_id, gross_pay, taxable_pay,
      total_deductions, net_pay, paye_amount, days_worked, status
    ) VALUES (
      p_business_id, v_run_id, v_employee.id, round(v_gross, 2), round(v_taxable, 2),
      round(v_other_deductions, 2), v_net, v_paye, v_days_worked, 'included'
    ) RETURNING id INTO v_line_id;

    INSERT INTO public.pay_run_component_details (business_id, pay_run_line_id, pay_component_id, amount, is_earning)
    SELECT p_business_id, v_line_id, (detail.value->>'component_id')::uuid,
           (detail.value->>'amount')::numeric, (detail.value->>'is_earning')::boolean
    FROM jsonb_array_elements(v_details) AS detail(value)
    WHERE (detail.value->>'amount')::numeric > 0
    ON CONFLICT (pay_run_line_id, pay_component_id) DO UPDATE
      SET amount = EXCLUDED.amount, is_earning = EXCLUDED.is_earning;

    v_paye := 0;
  END LOOP;

  UPDATE public.pay_runs
  SET status = 'calculated', total_gross = round(v_total_gross, 2),
      total_deductions = round(v_total_deductions, 2), total_net = round(v_total_net, 2),
      total_employer_cost = round(v_total_employer_cost, 2), employee_count = v_employee_count,
      calculated_by = auth.uid(), calculated_at = now(), updated_at = now()
  WHERE id = v_run_id AND business_id = p_business_id
  RETURNING * INTO v_run;

  SELECT COALESCE(jsonb_agg(
    to_jsonb(line) || jsonb_build_object('components', COALESCE((
      SELECT jsonb_agg(to_jsonb(detail) ORDER BY detail.id)
      FROM public.pay_run_component_details detail WHERE detail.pay_run_line_id = line.id
    ), '[]'::jsonb)) ORDER BY employee.last_name, employee.first_name
  ), '[]'::jsonb) INTO v_lines
  FROM public.pay_run_lines line
  JOIN public.employees employee ON employee.id = line.employee_id
  WHERE line.business_id = p_business_id AND line.pay_run_id = v_run_id;

  RETURN jsonb_build_object(
    'payRunId', v_run_id, 'employeeCount', v_employee_count,
    'totalGross', round(v_total_gross, 2), 'totalDeductions', round(v_total_deductions, 2),
    'totalNet', round(v_total_net, 2), 'lines', v_lines
  );
END;
$$;

-- ── RPC: post one balanced, functional-currency payroll journal ───────────────
CREATE OR REPLACE FUNCTION public.post_pay_run(p_pay_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_run public.pay_runs%ROWTYPE;
  v_line record;
  v_business public.businesses%ROWTYPE;
  v_journal_id uuid;
  v_journal_number text;
  v_bank_account_id uuid;
  v_pension_payable_id uuid;
  v_line_no integer := 0;
  v_total_debits numeric := 0;
  v_total_credits numeric := 0;
  v_amount numeric;
  v_account_business uuid;
BEGIN
  SELECT * INTO v_run FROM public.pay_runs WHERE id = p_pay_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pay run % was not found.', p_pay_run_id USING ERRCODE = 'P0002'; END IF;
  IF NOT public.can_write_business_data(v_run.business_id) THEN
    RAISE EXCEPTION 'You do not have permission to post payroll for this business.' USING ERRCODE = '42501';
  END IF;
  IF v_run.status = 'posted' AND v_run.journal_entry_id IS NOT NULL THEN
    RETURN jsonb_build_object('payRunId', v_run.id, 'journalEntryId', v_run.journal_entry_id, 'status', 'posted');
  END IF;
  IF v_run.status NOT IN ('calculated', 'approved') THEN
    RAISE EXCEPTION 'Only calculated or approved pay runs can be posted.' USING ERRCODE = '55000';
  END IF;
  IF v_run.employee_count = 0 THEN RAISE EXCEPTION 'A pay run with no included employees cannot be posted.' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_business FROM public.businesses WHERE id = v_run.business_id;
  -- Current default-bank convention: choose an active, non-group bank account,
  -- preferring the first current-account code. No FX is used in payroll.
  SELECT a.id INTO v_bank_account_id FROM public.accounts a
  WHERE a.business_id = v_run.business_id AND a.is_bank_account IS TRUE
    AND a.is_active IS TRUE AND a.is_group IS FALSE AND a.deleted_at IS NULL
  ORDER BY CASE WHEN a.code IN ('1121', '1122', '1123', '1124') THEN 0 ELSE 1 END, a.code
  LIMIT 1;
  IF v_bank_account_id IS NULL THEN
    RAISE EXCEPTION 'Link an active bank account before posting payroll.' USING ERRCODE = '23502';
  END IF;
  SELECT a.id INTO v_pension_payable_id FROM public.accounts a
  WHERE a.business_id = v_run.business_id AND a.code = '2132' AND a.is_active IS TRUE AND a.deleted_at IS NULL
  LIMIT 1;

  v_journal_number := public.next_journal_entry_number(v_run.business_id);
  INSERT INTO public.journal_entries (
    business_id, entry_number, entry_date, description, reference, source_type,
    source_id, currency, exchange_rate, status, created_by
  ) VALUES (
    v_run.business_id, v_journal_number, v_run.pay_date,
    'Payroll for ' || to_char(v_run.period_start, 'YYYY-MM-DD') || ' to ' || to_char(v_run.period_end, 'YYYY-MM-DD'),
    v_run.id::text, 'payroll', v_run.id::text, v_business.base_currency, 1, 'draft', auth.uid()::text
  ) RETURNING id INTO v_journal_id;

  -- Debit each earning component to its configured expense account.
  FOR v_line IN
    SELECT pc.gl_account_id, pc.code, SUM(detail.amount) AS amount
    FROM public.pay_run_component_details detail
    JOIN public.pay_run_lines line ON line.id = detail.pay_run_line_id
    JOIN public.pay_components pc ON pc.id = detail.pay_component_id
    WHERE line.business_id = v_run.business_id AND line.pay_run_id = v_run.id
      AND pc.component_type = 'earning' AND detail.amount > 0
    GROUP BY pc.gl_account_id, pc.code
  LOOP
    IF v_line.gl_account_id IS NULL THEN RAISE EXCEPTION 'Set an expense account on payroll component % before posting.', v_line.code USING ERRCODE = '23502'; END IF;
    SELECT a.business_id INTO v_account_business FROM public.accounts a WHERE a.id = v_line.gl_account_id;
    IF v_account_business IS DISTINCT FROM v_run.business_id THEN RAISE EXCEPTION 'Payroll component % points to an account outside this business.', v_line.code USING ERRCODE = '23503'; END IF;
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_line.gl_account_id, 'Payroll ' || v_line.code, true, v_line.amount, v_line.amount, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_debits := v_total_debits + v_line.amount;
  END LOOP;

  -- Credit component-specific deduction liabilities (PAYE, employee pension,
  -- and any configured deductions). Employer pension is an earning component
  -- for cost reporting but is credited to the pension payable account as well.
  FOR v_line IN
    SELECT pc.gl_account_id, pc.code, pc.component_type, SUM(detail.amount) AS amount
    FROM public.pay_run_component_details detail
    JOIN public.pay_run_lines line ON line.id = detail.pay_run_line_id
    JOIN public.pay_components pc ON pc.id = detail.pay_component_id
    WHERE line.business_id = v_run.business_id AND line.pay_run_id = v_run.id
      AND pc.component_type = 'deduction' AND detail.amount > 0
    GROUP BY pc.gl_account_id, pc.code, pc.component_type
  LOOP
    IF v_line.gl_account_id IS NULL THEN RAISE EXCEPTION 'Set a liability account on payroll component % before posting.', v_line.code USING ERRCODE = '23502'; END IF;
    SELECT a.business_id INTO v_account_business FROM public.accounts a WHERE a.id = v_line.gl_account_id;
    IF v_account_business IS DISTINCT FROM v_run.business_id THEN RAISE EXCEPTION 'Payroll component % points to an account outside this business.', v_line.code USING ERRCODE = '23503'; END IF;
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_line.gl_account_id, 'Payroll deduction ' || v_line.code, false, v_line.amount, v_line.amount, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_credits := v_total_credits + v_line.amount;
  END LOOP;

  SELECT COALESCE(SUM(detail.amount), 0) INTO v_amount
  FROM public.pay_run_component_details detail
  JOIN public.pay_run_lines line ON line.id = detail.pay_run_line_id
  JOIN public.pay_components pc ON pc.id = detail.pay_component_id
  WHERE line.business_id = v_run.business_id AND line.pay_run_id = v_run.id AND pc.code = 'PENSION_ER';
  IF v_amount > 0 THEN
    IF v_pension_payable_id IS NULL THEN RAISE EXCEPTION 'Pension Payable account (2132) is not configured.' USING ERRCODE = '23502'; END IF;
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_pension_payable_id, 'Employer pension payable', false, v_amount, v_amount, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_credits := v_total_credits + v_amount;
  END IF;

  -- Credit net pay to the business's active default bank account.
  IF v_run.total_net > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (business_id, journal_entry_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_code, tax_amount, reconciled, rate_is_stale)
    VALUES (v_run.business_id, v_journal_id, v_line_no, v_bank_account_id, 'Net payroll payable', false, v_run.total_net, v_run.total_net, v_business.base_currency, 1, 'none', 0, false, false);
    v_total_credits := v_total_credits + v_run.total_net;
  END IF;

  IF v_line_no < 2 OR ABS(v_total_debits - v_total_credits) > 0.005 THEN
    RAISE EXCEPTION 'Payroll journal does not balance: debits %, credits %.', v_total_debits, v_total_credits USING ERRCODE = '23514';
  END IF;

  UPDATE public.journal_entries SET status = 'posted', posted_at = now(), posted_by = auth.uid()::text
  WHERE id = v_journal_id AND status = 'draft';
  UPDATE public.pay_runs SET status = 'posted', journal_entry_id = v_journal_id,
    posted_at = now(), posted_by = auth.uid(), updated_at = now()
  WHERE id = v_run.id AND business_id = v_run.business_id;

  RETURN jsonb_build_object('payRunId', v_run.id, 'journalEntryId', v_journal_id, 'status', 'posted');
END;
$$;

-- ── RPC: monthly leave accrual with a per-balance idempotency marker ──────────
CREATE OR REPLACE FUNCTION public.accrue_leave(p_business_id uuid, p_year int, p_month int)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_month date;
  v_employee_count integer := 0;
  v_type_count integer := 0;
BEGIN
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'You do not have permission to accrue leave for this business.' USING ERRCODE = '42501';
  END IF;
  IF p_year < 1900 OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'A valid leave accrual year and month are required.' USING ERRCODE = '22023';
  END IF;
  v_month := make_date(p_year, p_month, 1);

  WITH active_employees AS (
    SELECT e.id FROM public.employees e
    WHERE e.business_id = p_business_id AND e.is_active IS TRUE
      AND e.status = 'active' AND e.deleted_at IS NULL
  ), active_types AS (
    SELECT lt.id, lt.annual_entitlement_days FROM public.leave_types lt
    WHERE lt.business_id = p_business_id AND lt.is_active IS TRUE
  ), accruals AS (
    SELECT e.id AS employee_id, lt.id AS leave_type_id, lt.annual_entitlement_days / 12 AS monthly_days
    FROM active_employees e CROSS JOIN active_types lt
  )
  INSERT INTO public.leave_balances (business_id, employee_id, leave_type_id, year, entitled_days, last_accrued_month)
  SELECT p_business_id, a.employee_id, a.leave_type_id, p_year, a.monthly_days, v_month
  FROM accruals a
  ON CONFLICT (business_id, employee_id, leave_type_id, year) DO UPDATE
  SET entitled_days = leave_balances.entitled_days + EXCLUDED.entitled_days,
      last_accrued_month = EXCLUDED.last_accrued_month
  WHERE leave_balances.last_accrued_month IS NULL OR leave_balances.last_accrued_month < EXCLUDED.last_accrued_month;

  SELECT COUNT(*) INTO v_employee_count FROM public.employees e
  WHERE e.business_id = p_business_id AND e.is_active IS TRUE AND e.status = 'active' AND e.deleted_at IS NULL;
  SELECT COUNT(*) INTO v_type_count FROM public.leave_types lt
  WHERE lt.business_id = p_business_id AND lt.is_active IS TRUE;
  RETURN jsonb_build_object('employeesProcessed', v_employee_count, 'leaveTypesProcessed', v_type_count);
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_pay_run(uuid, date, date, date) FROM public, anon;
REVOKE ALL ON FUNCTION public.post_pay_run(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.accrue_leave(uuid, int, int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.calculate_pay_run(uuid, date, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_pay_run(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accrue_leave(uuid, int, int) TO authenticated, service_role;

COMMENT ON FUNCTION public.calculate_pay_run(uuid, date, date, date) IS
  'Calculates and persists employee payroll for a date range, applying configured tax_bands and effective component overrides. All amounts are in the business functional currency.';
COMMENT ON FUNCTION public.post_pay_run(uuid) IS
  'Posts a balanced functional-currency payroll journal with source_type=payroll and source_id=pay_run.id::text; repeated calls return the existing posted entry.';
COMMENT ON FUNCTION public.accrue_leave(uuid, int, int) IS
  'Accrues monthly leave entitlement. leave_balances.last_accrued_month prevents duplicate accrual for a month.';
