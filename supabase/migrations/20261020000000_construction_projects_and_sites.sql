-- Phase 5B-1c: persisted construction workspace management.
-- construction_projects is an existing procurement table; extend it in place
-- and keep its current grant-based RLS policy untouched.

ALTER TABLE public.construction_projects
  ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE public.construction_projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

ALTER TABLE public.construction_projects
  ADD CONSTRAINT projects_status_check CHECK (
    status = ANY (ARRAY[
      'draft'::text,
      'tender'::text,
      'active'::text,
      'on_hold'::text,
      'practical_completion'::text,
      'defect_liability'::text,
      'completed'::text,
      'closed'::text
    ])
  );

CREATE TABLE IF NOT EXISTS public.construction_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  location_id uuid NULL REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  address text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS construction_sites_business_project_idx
  ON public.construction_sites (business_id, project_id, name);

ALTER TABLE public.construction_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS construction_sites_member_grants ON public.construction_sites;
CREATE POLICY construction_sites_member_grants
  ON public.construction_sites
  FOR ALL
  USING (
    public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0
  )
  WITH CHECK (
    public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.construction_sites TO authenticated;

CREATE OR REPLACE FUNCTION public._ledgr_validate_construction_site_scope()
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

  IF NEW.location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.inventory_locations l
    WHERE l.id = NEW.location_id AND l.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The selected inventory location must belong to this business.' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS construction_sites_validate_scope ON public.construction_sites;
CREATE TRIGGER construction_sites_validate_scope
  BEFORE INSERT OR UPDATE ON public.construction_sites
  FOR EACH ROW EXECUTE FUNCTION public._ledgr_validate_construction_site_scope();

CREATE OR REPLACE FUNCTION public._ledgr_validate_construction_project_status()
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
    WHEN 'draft' THEN NEW.status IN ('tender', 'active', 'on_hold')
    WHEN 'tender' THEN NEW.status IN ('active', 'on_hold')
    WHEN 'active' THEN NEW.status IN ('on_hold', 'practical_completion', 'completed')
    WHEN 'on_hold' THEN NEW.status IN ('draft', 'tender', 'active', 'completed')
    WHEN 'practical_completion' THEN NEW.status IN ('defect_liability', 'completed')
    WHEN 'defect_liability' THEN NEW.status = 'closed'
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid construction project status transition from % to %.', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS construction_projects_validate_status ON public.construction_projects;
CREATE TRIGGER construction_projects_validate_status
  BEFORE UPDATE OF status ON public.construction_projects
  FOR EACH ROW EXECUTE FUNCTION public._ledgr_validate_construction_project_status();

CREATE OR REPLACE FUNCTION public.set_construction_project_status(
  p_project_id uuid,
  p_new_status text,
  p_reason text DEFAULT NULL
)
RETURNS public.construction_projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_row public.construction_projects;
  v_actor uuid;
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_row
  FROM public.construction_projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Uses the existing procurement management capability check. Grant and
  -- self-grant behavior is intentionally unchanged by this workflow.
  v_actor := public._ledgr_construction_actor(v_row.business_id, 'procurement.master.manage');

  v_allowed := CASE v_row.status
    WHEN 'draft' THEN p_new_status IN ('tender', 'active', 'on_hold')
    WHEN 'tender' THEN p_new_status IN ('active', 'on_hold')
    WHEN 'active' THEN p_new_status IN ('on_hold', 'practical_completion', 'completed')
    WHEN 'on_hold' THEN p_new_status IN ('draft', 'tender', 'active', 'completed')
    WHEN 'practical_completion' THEN p_new_status IN ('defect_liability', 'completed')
    WHEN 'defect_liability' THEN p_new_status = 'closed'
    ELSE false
  END;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Invalid status transition from % to %.', v_row.status, p_new_status
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.project_status_log (project_id, from_status, to_status, changed_by, reason)
  VALUES (p_project_id, v_row.status, p_new_status, v_actor, nullif(btrim(p_reason), ''));

  UPDATE public.construction_projects
  SET status = p_new_status, updated_at = now()
  WHERE id = p_project_id
  RETURNING * INTO v_row;

  RETURN v_row;
END
$function$;

REVOKE ALL ON FUNCTION public.set_construction_project_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_construction_project_status(uuid, text, text) TO authenticated;
