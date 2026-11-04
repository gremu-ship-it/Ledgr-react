-- Budget workflow lifecycle and server-side protection for budget contents.
-- Existing active budgets retain their usable state; new budgets start in draft.

ALTER TABLE public.budgets
  ADD COLUMN IF NOT EXISTS status text;

UPDATE public.budgets
SET status = CASE WHEN is_active THEN 'active' ELSE 'closed' END
WHERE status IS NULL;

ALTER TABLE public.budgets
  ALTER COLUMN status SET DEFAULT 'draft',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.budgets
  DROP CONSTRAINT IF EXISTS budgets_status_check;
ALTER TABLE public.budgets
  ADD CONSTRAINT budgets_status_check CHECK (status IN ('draft', 'active', 'closed'));

CREATE INDEX IF NOT EXISTS idx_budgets_business_status_period
  ON public.budgets (business_id, status, period_start, period_end);

CREATE OR REPLACE FUNCTION public.enforce_budget_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN
      RAISE EXCEPTION 'Budgets must be created as drafts' USING ERRCODE = '23514';
    END IF;
    NEW.is_active := false;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT ((OLD.status = 'draft' AND NEW.status = 'active')
           OR (OLD.status = 'active' AND NEW.status = 'closed')) THEN
    RAISE EXCEPTION 'Budgets may only transition from draft to active or active to closed'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> 'draft'
     AND (NEW.name IS DISTINCT FROM OLD.name
       OR NEW.fiscal_year IS DISTINCT FROM OLD.fiscal_year
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.notes IS DISTINCT FROM OLD.notes) THEN
    RAISE EXCEPTION 'Only draft budgets may be edited' USING ERRCODE = '23514';
  END IF;

  NEW.is_active := NEW.status = 'active';
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_budget_lifecycle ON public.budgets;
CREATE TRIGGER trg_enforce_budget_lifecycle
  BEFORE INSERT OR UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_budget_lifecycle();

CREATE OR REPLACE FUNCTION public.enforce_draft_budget_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_budget_id uuid;
  v_business_id uuid;
  v_status text;
  v_account_business_id uuid;
  v_account_type public.account_type;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.budget_id IS DISTINCT FROM OLD.budget_id
       OR NEW.business_id IS DISTINCT FROM OLD.business_id) THEN
    RAISE EXCEPTION 'Budget lines cannot be moved between budgets or businesses'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_budget_id := OLD.budget_id;
    v_business_id := OLD.business_id;
  ELSE
    v_budget_id := NEW.budget_id;
    v_business_id := NEW.business_id;
  END IF;

  SELECT status INTO v_status
  FROM public.budgets
  WHERE id = v_budget_id AND business_id = v_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget line must belong to a budget in the same business'
      USING ERRCODE = '23503';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Budget lines may only be changed while the budget is a draft'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT business_id, account_type INTO v_account_business_id, v_account_type
    FROM public.accounts WHERE id = NEW.account_id;
    IF NOT FOUND OR v_account_business_id <> NEW.business_id THEN
      RAISE EXCEPTION 'Budget account must belong to the same business'
        USING ERRCODE = '23503';
    END IF;
    IF v_account_type NOT IN ('income', 'expense') THEN
      RAISE EXCEPTION 'Budget lines may only reference income or expense accounts'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_draft_budget_line ON public.budget_lines;
CREATE TRIGGER trg_enforce_draft_budget_line
  BEFORE INSERT OR UPDATE OR DELETE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_draft_budget_line();
