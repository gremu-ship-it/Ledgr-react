-- Phase 5B-1d: subcontractor extensions and project agreements.
-- Contact remains the identity source; these tables contain construction-only data.

CREATE TABLE IF NOT EXISTS public.subcontractor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  trade text NOT NULL CHECK (length(btrim(trade)) > 0),
  license_number text,
  license_expiry date,
  insurance_provider text,
  insurance_policy_number text,
  insurance_expiry date,
  compliance_notes text,
  safety_rating text CHECK (safety_rating IN ('A', 'B', 'C', 'D', 'unrated')),
  preferred boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subcontractor_profiles_business_contact_key UNIQUE (business_id, contact_id)
);

CREATE TABLE IF NOT EXISTS public.subcontracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  subcontractor_profile_id uuid NOT NULL REFERENCES public.subcontractor_profiles(id) ON DELETE RESTRICT,
  reference text NOT NULL CHECK (length(btrim(reference)) > 0),
  title text NOT NULL CHECK (length(btrim(title)) > 0),
  description text,
  scope_of_work text,
  contract_value numeric(18,2) NOT NULL DEFAULT 0 CHECK (contract_value >= 0),
  currency text NOT NULL DEFAULT 'MWK',
  retention_percentage numeric(5,2) DEFAULT 0 CHECK (retention_percentage >= 0 AND retention_percentage <= 100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'on_hold', 'completed', 'terminated')),
  start_date date,
  end_date date,
  defects_liability_months integer DEFAULT 12 CHECK (defects_liability_months >= 0),
  payment_terms text,
  CONSTRAINT subcontracts_date_order_check CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  CONSTRAINT subcontracts_business_reference_key UNIQUE (business_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_subcontractor_profiles_business
  ON public.subcontractor_profiles (business_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_profiles_contact
  ON public.subcontractor_profiles (contact_id);
CREATE INDEX IF NOT EXISTS idx_subcontractor_profiles_trade
  ON public.subcontractor_profiles (business_id, trade);
CREATE INDEX IF NOT EXISTS idx_subcontracts_business
  ON public.subcontracts (business_id);
CREATE INDEX IF NOT EXISTS idx_subcontracts_project
  ON public.subcontracts (project_id);
CREATE INDEX IF NOT EXISTS idx_subcontracts_subcontractor
  ON public.subcontracts (subcontractor_profile_id);
CREATE INDEX IF NOT EXISTS idx_subcontracts_status
  ON public.subcontracts (business_id, status);

ALTER TABLE public.subcontractor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subcontractor_profiles_select ON public.subcontractor_profiles;
CREATE POLICY subcontractor_profiles_select ON public.subcontractor_profiles FOR SELECT
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS subcontractor_profiles_insert ON public.subcontractor_profiles;
CREATE POLICY subcontractor_profiles_insert ON public.subcontractor_profiles FOR INSERT
  WITH CHECK (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS subcontractor_profiles_update ON public.subcontractor_profiles;
CREATE POLICY subcontractor_profiles_update ON public.subcontractor_profiles FOR UPDATE
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
  WITH CHECK (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS subcontractor_profiles_delete ON public.subcontractor_profiles;
CREATE POLICY subcontractor_profiles_delete ON public.subcontractor_profiles FOR DELETE
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);

DROP POLICY IF EXISTS subcontracts_select ON public.subcontracts;
CREATE POLICY subcontracts_select ON public.subcontracts FOR SELECT
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS subcontracts_insert ON public.subcontracts;
CREATE POLICY subcontracts_insert ON public.subcontracts FOR INSERT
  WITH CHECK (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS subcontracts_update ON public.subcontracts;
CREATE POLICY subcontracts_update ON public.subcontracts FOR UPDATE
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
  WITH CHECK (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS subcontracts_delete ON public.subcontracts;
CREATE POLICY subcontracts_delete ON public.subcontracts FOR DELETE
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subcontractor_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subcontracts TO authenticated;

-- Guard tenant ownership across globally unique foreign keys. These checks
-- leave contacts, construction_projects, and construction_sites unchanged.
CREATE OR REPLACE FUNCTION public._ledgr_validate_subcontractor_profile_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.contacts c
    WHERE c.id = NEW.contact_id
      AND c.business_id = NEW.business_id
      AND c.contact_type IN ('supplier', 'both')
      AND c.is_active
      AND c.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Subcontractor profiles require an active supplier contact from the same business.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS subcontractor_profiles_validate_scope ON public.subcontractor_profiles;
CREATE TRIGGER subcontractor_profiles_validate_scope
  BEFORE INSERT OR UPDATE OF business_id, contact_id ON public.subcontractor_profiles
  FOR EACH ROW EXECUTE FUNCTION public._ledgr_validate_subcontractor_profile_scope();

CREATE OR REPLACE FUNCTION public._ledgr_validate_subcontract_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.construction_projects p
    WHERE p.id = NEW.project_id AND p.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The selected project must belong to this business.' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.subcontractor_profiles sp
    WHERE sp.id = NEW.subcontractor_profile_id AND sp.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The selected subcontractor must belong to this business.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS subcontracts_validate_scope ON public.subcontracts;
CREATE TRIGGER subcontracts_validate_scope
  BEFORE INSERT OR UPDATE OF business_id, project_id, subcontractor_profile_id ON public.subcontracts
  FOR EACH ROW EXECUTE FUNCTION public._ledgr_validate_subcontract_scope();

-- Keep the agreement lifecycle valid even for direct table updates.
CREATE OR REPLACE FUNCTION public._ledgr_validate_subcontract_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_allowed boolean := false;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  v_allowed := CASE OLD.status
    WHEN 'draft' THEN NEW.status IN ('active', 'on_hold', 'terminated')
    WHEN 'active' THEN NEW.status IN ('on_hold', 'completed', 'terminated')
    WHEN 'on_hold' THEN NEW.status IN ('active', 'completed', 'terminated')
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid subcontract status transition from % to %.', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS subcontracts_validate_status_transition ON public.subcontracts;
CREATE TRIGGER subcontracts_validate_status_transition
  BEFORE UPDATE OF status ON public.subcontracts
  FOR EACH ROW EXECUTE FUNCTION public._ledgr_validate_subcontract_status_transition();

DROP TRIGGER IF EXISTS subcontractor_profiles_set_updated_at ON public.subcontractor_profiles;
CREATE TRIGGER subcontractor_profiles_set_updated_at
  BEFORE UPDATE ON public.subcontractor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS subcontracts_set_updated_at ON public.subcontracts;
CREATE TRIGGER subcontracts_set_updated_at
  BEFORE UPDATE ON public.subcontracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
