-- The employee form and employee_contracts use the canonical value `biweekly`,
-- but the legacy employees constraint only allowed `bi_weekly`. Keep the
-- legacy spelling readable for existing rows while allowing new UI writes.
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_pay_frequency_check;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_pay_frequency_check
  CHECK (pay_frequency IN ('monthly', 'biweekly', 'bi_weekly', 'weekly'));
