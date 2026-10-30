-- Construction RFIs (5B-4a)
-- Canonical RFI register. Authenticated clients read through RLS; all writes go
-- through narrowly scoped command RPCs so no direct DML grant is needed.

-- New capability is administered by the existing admin-only capability RPC.
-- This adds a capability code only; it does not alter grant/self-grant rules.
INSERT INTO public.construction_procurement_capabilities (code, description)
VALUES ('project.rfi.manage', 'Create, update, transition, and delete construction RFIs.')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.construction_rfis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE RESTRICT,
  site_id uuid REFERENCES public.construction_procurement_sites(id) ON DELETE RESTRICT,
  rfi_number text NOT NULL,
  title text NOT NULL,
  question text NOT NULL,
  response text,
  evidence text,
  status text NOT NULL DEFAULT 'draft',
  priority text NOT NULL DEFAULT 'normal',
  due_date date,
  answered_at timestamptz,
  closed_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT construction_rfis_number_nonblank CHECK (length(btrim(rfi_number)) BETWEEN 1 AND 80),
  CONSTRAINT construction_rfis_title_nonblank CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT construction_rfis_question_nonblank CHECK (length(btrim(question)) BETWEEN 1 AND 20000),
  CONSTRAINT construction_rfis_status_check CHECK (status IN ('draft', 'open', 'answered', 'closed')),
  CONSTRAINT construction_rfis_priority_check CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  CONSTRAINT construction_rfis_business_number_key UNIQUE (business_id, rfi_number)
);

CREATE INDEX IF NOT EXISTS construction_rfis_project_status_idx
  ON public.construction_rfis (project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS construction_rfis_business_due_date_idx
  ON public.construction_rfis (business_id, due_date)
  WHERE status IN ('open', 'answered');
CREATE INDEX IF NOT EXISTS construction_rfis_site_idx
  ON public.construction_rfis (site_id)
  WHERE site_id IS NOT NULL;

ALTER TABLE public.construction_rfis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS construction_rfis_business_member_select ON public.construction_rfis;
CREATE POLICY construction_rfis_business_member_select
  ON public.construction_rfis
  FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id));

-- Keep construction registers read-only to authenticated clients. The write
-- command functions below are SECURITY DEFINER and enforce scoped authority.
REVOKE ALL ON TABLE public.construction_rfis FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.construction_rfis TO authenticated;
GRANT ALL ON TABLE public.construction_rfis TO service_role;

CREATE OR REPLACE FUNCTION public._ledgr_construction_rfi_actor(p_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
  v_effective_plan text;
  v_operating_models text[];
BEGIN
  v_actor := public._ledgr_construction_actor(p_business_id, 'project.rfi.manage');

  SELECT public.effective_plan_tier(b.plan_tier, b.plan_expires_at), b.operating_models
    INTO v_effective_plan, v_operating_models
    FROM public.businesses b
   WHERE b.id = p_business_id
     AND b.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business is unavailable.' USING ERRCODE = '42501';
  END IF;
  IF v_effective_plan <> 'enterprise'
     OR NOT ('PROJECT_BASED' = ANY(coalesce(v_operating_models, ARRAY[]::text[]))) THEN
    RAISE EXCEPTION 'Construction RFIs require an active Enterprise project-based business.'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_actor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_construction_rfi(
  p_business_id uuid,
  p_project_id uuid,
  p_site_id uuid,
  p_rfi_number text,
  p_title text,
  p_question text,
  p_priority text DEFAULT 'normal',
  p_due_date date DEFAULT NULL,
  p_evidence text DEFAULT NULL
)
RETURNS public.construction_rfis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
  v_rfi public.construction_rfis%ROWTYPE;
BEGIN
  v_actor := public._ledgr_construction_rfi_actor(p_business_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.construction_projects p
     WHERE p.id = p_project_id AND p.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Project is outside the requested business.' USING ERRCODE = '42501';
  END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.construction_procurement_sites s
     WHERE s.id = p_site_id
       AND s.business_id = p_business_id
       AND s.project_id = p_project_id
       AND s.is_active
  ) THEN
    RAISE EXCEPTION 'Site is outside the requested project and business.' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_rfi_number, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_title, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_question, '')), '') IS NULL THEN
    RAISE EXCEPTION 'RFI number, title, and question are required.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_priority, 'normal') NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Unsupported RFI priority.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.construction_rfis (
    business_id, project_id, site_id, rfi_number, title, question,
    priority, due_date, evidence, created_by, updated_by
  ) VALUES (
    p_business_id, p_project_id, p_site_id, btrim(p_rfi_number), btrim(p_title), btrim(p_question),
    coalesce(p_priority, 'normal'), p_due_date, p_evidence, v_actor, v_actor
  ) RETURNING * INTO v_rfi;

  RETURN v_rfi;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_construction_rfi(
  p_rfi_id uuid,
  p_payload jsonb
)
RETURNS public.construction_rfis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rfi public.construction_rfis%ROWTYPE;
  v_actor uuid;
  v_title text;
  v_question text;
  v_priority text;
  v_due_date date;
  v_evidence text;
  v_key text;
BEGIN
  SELECT * INTO v_rfi FROM public.construction_rfis WHERE id = p_rfi_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFI was not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_construction_rfi_actor(v_rfi.business_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.construction_projects p
     WHERE p.id = v_rfi.project_id AND p.business_id = v_rfi.business_id
  ) THEN
    RAISE EXCEPTION 'RFI project is outside its business.' USING ERRCODE = '42501';
  END IF;
  IF v_rfi.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.construction_procurement_sites s
     WHERE s.id = v_rfi.site_id
       AND s.business_id = v_rfi.business_id
       AND s.project_id = v_rfi.project_id
  ) THEN
    RAISE EXCEPTION 'RFI site is outside its project and business.' USING ERRCODE = '42501';
  END IF;
  IF v_rfi.status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION 'Only draft or open RFIs can be edited.' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'RFI update payload must be an object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF v_key NOT IN ('title', 'question', 'priority', 'due_date', 'evidence') THEN
      RAISE EXCEPTION 'Unsupported RFI update field: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_title := v_rfi.title;
  v_question := v_rfi.question;
  v_priority := v_rfi.priority;
  v_due_date := v_rfi.due_date;
  v_evidence := v_rfi.evidence;

  IF p_payload ? 'title' THEN
    v_title := nullif(btrim(p_payload->>'title'), '');
    IF v_title IS NULL THEN RAISE EXCEPTION 'RFI title is required.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_payload ? 'question' THEN
    v_question := nullif(btrim(p_payload->>'question'), '');
    IF v_question IS NULL THEN RAISE EXCEPTION 'RFI question is required.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_payload ? 'priority' THEN
    v_priority := p_payload->>'priority';
    IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
      RAISE EXCEPTION 'Unsupported RFI priority.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_payload ? 'due_date' THEN
    v_due_date := CASE WHEN p_payload->'due_date' = 'null'::jsonb THEN NULL
                       ELSE (p_payload->>'due_date')::date END;
  END IF;
  IF p_payload ? 'evidence' THEN
    v_evidence := CASE WHEN p_payload->'evidence' = 'null'::jsonb THEN NULL
                       ELSE p_payload->>'evidence' END;
  END IF;

  UPDATE public.construction_rfis
     SET title = v_title,
         question = v_question,
         priority = v_priority,
         due_date = v_due_date,
         evidence = v_evidence,
         updated_by = v_actor,
         updated_at = now()
   WHERE id = p_rfi_id
   RETURNING * INTO v_rfi;
  RETURN v_rfi;
END;
$function$;

CREATE OR REPLACE FUNCTION public.transition_construction_rfi(
  p_rfi_id uuid,
  p_new_status text,
  p_response text DEFAULT NULL
)
RETURNS public.construction_rfis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rfi public.construction_rfis%ROWTYPE;
  v_actor uuid;
  v_response text;
BEGIN
  SELECT * INTO v_rfi FROM public.construction_rfis WHERE id = p_rfi_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFI was not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_construction_rfi_actor(v_rfi.business_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.construction_projects p
     WHERE p.id = v_rfi.project_id AND p.business_id = v_rfi.business_id
  ) THEN
    RAISE EXCEPTION 'RFI project is outside its business.' USING ERRCODE = '42501';
  END IF;
  IF v_rfi.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.construction_procurement_sites s
     WHERE s.id = v_rfi.site_id
       AND s.business_id = v_rfi.business_id
       AND s.project_id = v_rfi.project_id
  ) THEN
    RAISE EXCEPTION 'RFI site is outside its project and business.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    (v_rfi.status = 'draft' AND p_new_status = 'open') OR
    (v_rfi.status = 'open' AND p_new_status IN ('answered', 'closed')) OR
    (v_rfi.status = 'answered' AND p_new_status IN ('open', 'closed'))
  ) THEN
    RAISE EXCEPTION 'Invalid RFI status transition: % -> %.', v_rfi.status, p_new_status
      USING ERRCODE = '22023';
  END IF;

  v_response := coalesce(nullif(btrim(p_response), ''), v_rfi.response);
  IF p_new_status = 'answered' AND nullif(btrim(coalesce(v_response, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A response is required before marking an RFI answered.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.construction_rfis
     SET status = p_new_status,
         response = CASE WHEN p_new_status = 'answered' THEN v_response ELSE response END,
         answered_at = CASE WHEN p_new_status = 'answered' THEN coalesce(answered_at, now())
                            WHEN p_new_status = 'open' THEN NULL ELSE answered_at END,
         closed_at = CASE WHEN p_new_status = 'closed' THEN now() ELSE NULL END,
         updated_by = v_actor,
         updated_at = now()
   WHERE id = p_rfi_id
   RETURNING * INTO v_rfi;
  RETURN v_rfi;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_construction_rfi(p_rfi_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rfi public.construction_rfis%ROWTYPE;
  v_actor uuid;
BEGIN
  SELECT * INTO v_rfi FROM public.construction_rfis WHERE id = p_rfi_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RFI was not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_construction_rfi_actor(v_rfi.business_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.construction_projects p
     WHERE p.id = v_rfi.project_id AND p.business_id = v_rfi.business_id
  ) THEN
    RAISE EXCEPTION 'RFI project is outside its business.' USING ERRCODE = '42501';
  END IF;
  IF v_rfi.site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.construction_procurement_sites s
     WHERE s.id = v_rfi.site_id
       AND s.business_id = v_rfi.business_id
       AND s.project_id = v_rfi.project_id
  ) THEN
    RAISE EXCEPTION 'RFI site is outside its project and business.' USING ERRCODE = '42501';
  END IF;
  IF v_rfi.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft RFIs can be deleted.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.construction_rfis WHERE id = p_rfi_id;
  RETURN true;
END;
$function$;

-- SECURITY DEFINER command functions are callable only by signed-in clients;
-- authorization, Enterprise/project-based entitlement, capability, membership,
-- and tenant/project/site scope are checked inside each command path.
REVOKE ALL ON FUNCTION public._ledgr_construction_rfi_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_construction_rfi(uuid, uuid, uuid, text, text, text, text, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_construction_rfi(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_construction_rfi(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.delete_construction_rfi(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_construction_rfi(uuid, uuid, uuid, text, text, text, text, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_construction_rfi(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_construction_rfi(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_construction_rfi(uuid) TO authenticated;
