-- 5B-4c: Construction Quality (ITPs, inspections, NCRs) and HSE (incidents, toolbox talks)
-- Evidence is recorded as text references. No Supabase Storage objects are created.

-- ============================================
-- QUALITY: Inspection and Test Plans
-- ============================================

CREATE TABLE IF NOT EXISTS public.construction_itps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.construction_projects(id) ON DELETE RESTRICT,
  site_id UUID REFERENCES public.construction_procurement_sites(id) ON DELETE SET NULL,
  itp_number TEXT NOT NULL,
  title TEXT NOT NULL,
  scope TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  boq_section_id UUID REFERENCES public.boq_sections(id) ON DELETE SET NULL,
  subcontract_id UUID REFERENCES public.subcontracts(id) ON DELETE SET NULL,
  evidence_reference TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, itp_number)
);

CREATE TABLE IF NOT EXISTS public.construction_itp_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  itp_id UUID NOT NULL REFERENCES public.construction_itps(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL,
  activity TEXT NOT NULL,
  acceptance_criteria TEXT NOT NULL,
  hold_type TEXT NOT NULL DEFAULT 'witness'
    CHECK (hold_type IN ('hold', 'witness', 'review', 'surveillance')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'passed', 'failed', 'waived')),
  inspected_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  inspected_at TIMESTAMPTZ,
  notes TEXT,
  evidence_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- QUALITY: Non-Conformance Reports
-- ============================================

CREATE TABLE IF NOT EXISTS public.construction_ncrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.construction_projects(id) ON DELETE RESTRICT,
  site_id UUID REFERENCES public.construction_procurement_sites(id) ON DELETE SET NULL,
  ncr_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'corrective_action', 'closed', 'cancelled')),
  severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('minor', 'major', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  root_cause TEXT,
  corrective_action TEXT,
  preventive_action TEXT,
  itp_checkpoint_id UUID REFERENCES public.construction_itp_checkpoints(id) ON DELETE SET NULL,
  subcontract_id UUID REFERENCES public.subcontracts(id) ON DELETE SET NULL,
  evidence_reference TEXT,
  raised_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, ncr_number)
);

-- ============================================
-- HSE: Incidents
-- ============================================

CREATE TABLE IF NOT EXISTS public.construction_hse_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.construction_projects(id) ON DELETE RESTRICT,
  site_id UUID REFERENCES public.construction_procurement_sites(id) ON DELETE SET NULL,
  incident_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'reported'
    CHECK (status IN ('reported', 'investigating', 'resolved', 'closed')),
  severity TEXT NOT NULL DEFAULT 'minor'
    CHECK (severity IN ('near_miss', 'minor', 'major', 'critical', 'fatality')),
  incident_type TEXT NOT NULL DEFAULT 'injury'
    CHECK (incident_type IN ('injury', 'property_damage', 'environmental', 'near_miss', 'other')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  incident_date TIMESTAMPTZ NOT NULL,
  location_description TEXT,
  persons_involved INTEGER NOT NULL DEFAULT 0,
  root_cause TEXT,
  corrective_action TEXT,
  evidence_reference TEXT,
  reported_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  closed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, incident_number)
);

-- ============================================
-- HSE: Toolbox Talks
-- ============================================

CREATE TABLE IF NOT EXISTS public.construction_toolbox_talks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.construction_projects(id) ON DELETE RESTRICT,
  site_id UUID REFERENCES public.construction_procurement_sites(id) ON DELETE SET NULL,
  talk_date DATE NOT NULL,
  topic TEXT NOT NULL,
  presenter TEXT NOT NULL,
  attendees_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL,
  evidence_reference TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_itps_business_project
  ON public.construction_itps(business_id, project_id);
CREATE INDEX IF NOT EXISTS idx_itp_checkpoints_itp
  ON public.construction_itp_checkpoints(itp_id);
CREATE INDEX IF NOT EXISTS idx_ncrs_business_project
  ON public.construction_ncrs(business_id, project_id);
CREATE INDEX IF NOT EXISTS idx_ncrs_status
  ON public.construction_ncrs(business_id, status);
CREATE INDEX IF NOT EXISTS idx_hse_incidents_business
  ON public.construction_hse_incidents(business_id, project_id);
CREATE INDEX IF NOT EXISTS idx_hse_incidents_date
  ON public.construction_hse_incidents(business_id, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_toolbox_talks_business
  ON public.construction_toolbox_talks(business_id, project_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.construction_itps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.construction_itp_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.construction_ncrs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.construction_hse_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.construction_toolbox_talks ENABLE ROW LEVEL SECURITY;

-- Plan and operating-model entitlement is enforced in the database as well as
-- by future UI gates, so direct API access cannot bypass module eligibility.
CREATE OR REPLACE FUNCTION public._construction_quality_hse_entitled(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = p_business_id
      AND b.deleted_at IS NULL
      AND public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'
      AND 'PROJECT_BASED' = ANY(COALESCE(b.operating_models, ARRAY[]::TEXT[]))
  );
$$;
REVOKE ALL ON FUNCTION public._construction_quality_hse_entitled(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._construction_quality_hse_entitled(UUID) TO authenticated, service_role;

CREATE POLICY "itps_select" ON public.construction_itps
  FOR SELECT TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "itps_insert" ON public.construction_itps
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "itps_update" ON public.construction_itps
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id))
  WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "itps_delete" ON public.construction_itps
  FOR DELETE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id) AND status = 'draft');

CREATE POLICY "itp_cp_select" ON public.construction_itp_checkpoints
  FOR SELECT TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "itp_cp_insert" ON public.construction_itp_checkpoints
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "itp_cp_update" ON public.construction_itp_checkpoints
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id))
  WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "itp_cp_delete" ON public.construction_itp_checkpoints
  FOR DELETE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));

CREATE POLICY "ncrs_select" ON public.construction_ncrs
  FOR SELECT TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "ncrs_insert" ON public.construction_ncrs
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "ncrs_update" ON public.construction_ncrs
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id))
  WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "ncrs_delete" ON public.construction_ncrs
  FOR DELETE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id) AND status = 'open');

CREATE POLICY "hse_select" ON public.construction_hse_incidents
  FOR SELECT TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "hse_insert" ON public.construction_hse_incidents
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "hse_update" ON public.construction_hse_incidents
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id))
  WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));

CREATE POLICY "tt_select" ON public.construction_toolbox_talks
  FOR SELECT TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "tt_insert" ON public.construction_toolbox_talks
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "tt_update" ON public.construction_toolbox_talks
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id))
  WITH CHECK (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));
CREATE POLICY "tt_delete" ON public.construction_toolbox_talks
  FOR DELETE TO authenticated USING (public.is_business_member(business_id) AND public._construction_quality_hse_entitled(business_id));

-- ============================================
-- RPCs: Status transitions
-- ============================================

CREATE OR REPLACE FUNCTION public.transition_itp_status(
  p_itp_id UUID, p_new_status TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT; v_bid UUID;
BEGIN
  SELECT status, business_id INTO v_status, v_bid
  FROM public.construction_itps WHERE id = p_itp_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ITP not found'; END IF;
  IF NOT public.is_business_member(v_bid) OR NOT public._construction_quality_hse_entitled(v_bid) THEN
    RAISE EXCEPTION 'Not entitled or not a member';
  END IF;
  IF v_status = 'draft' AND p_new_status NOT IN ('active', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from draft to %', p_new_status;
  END IF;
  IF v_status = 'active' AND p_new_status NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from active to %', p_new_status;
  END IF;
  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot transition from %', v_status;
  END IF;
  UPDATE public.construction_itps SET status = p_new_status, updated_at = now()
  WHERE id = p_itp_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_ncr_status(
  p_ncr_id UUID, p_new_status TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT; v_bid UUID;
BEGIN
  SELECT status, business_id INTO v_status, v_bid
  FROM public.construction_ncrs WHERE id = p_ncr_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NCR not found'; END IF;
  IF NOT public.is_business_member(v_bid) OR NOT public._construction_quality_hse_entitled(v_bid) THEN
    RAISE EXCEPTION 'Not entitled or not a member';
  END IF;
  IF v_status = 'open' AND p_new_status NOT IN ('investigating', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from open to %', p_new_status;
  END IF;
  IF v_status = 'investigating' AND p_new_status NOT IN ('corrective_action', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid transition from investigating to %', p_new_status;
  END IF;
  IF v_status = 'corrective_action' AND p_new_status != 'closed' THEN
    RAISE EXCEPTION 'Invalid transition from corrective_action to %', p_new_status;
  END IF;
  IF v_status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION 'Cannot transition from %', v_status;
  END IF;
  UPDATE public.construction_ncrs SET
    status = p_new_status,
    closed_by = CASE WHEN p_new_status = 'closed' THEN auth.uid() ELSE closed_by END,
    closed_at = CASE WHEN p_new_status = 'closed' THEN now() ELSE closed_at END,
    updated_at = now()
  WHERE id = p_ncr_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_hse_incident_status(
  p_incident_id UUID, p_new_status TEXT
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status TEXT; v_bid UUID;
BEGIN
  SELECT status, business_id INTO v_status, v_bid
  FROM public.construction_hse_incidents WHERE id = p_incident_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Incident not found'; END IF;
  IF NOT public.is_business_member(v_bid) OR NOT public._construction_quality_hse_entitled(v_bid) THEN
    RAISE EXCEPTION 'Not entitled or not a member';
  END IF;
  IF v_status = 'reported' AND p_new_status != 'investigating' THEN
    RAISE EXCEPTION 'Invalid transition from reported to %', p_new_status;
  END IF;
  IF v_status = 'investigating' AND p_new_status != 'resolved' THEN
    RAISE EXCEPTION 'Invalid transition from investigating to %', p_new_status;
  END IF;
  IF v_status = 'resolved' AND p_new_status != 'closed' THEN
    RAISE EXCEPTION 'Invalid transition from resolved to %', p_new_status;
  END IF;
  IF v_status = 'closed' THEN
    RAISE EXCEPTION 'Cannot transition from closed';
  END IF;
  UPDATE public.construction_hse_incidents SET
    status = p_new_status,
    closed_by = CASE WHEN p_new_status = 'closed' THEN auth.uid() ELSE closed_by END,
    closed_at = CASE WHEN p_new_status = 'closed' THEN now() ELSE closed_at END,
    updated_at = now()
  WHERE id = p_incident_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transition_itp_status(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_ncr_status(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_hse_incident_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transition_itp_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_ncr_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_hse_incident_status(UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
