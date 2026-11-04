-- Extend construction RFIs to support the full project correspondence workflow.
-- This migration is committed for manual application; do not run it in this task.

ALTER TABLE public.construction_rfis
  ADD COLUMN IF NOT EXISTS proposed_solution text,
  ADD COLUMN IF NOT EXISTS boq_item_id uuid REFERENCES public.boq_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subcontract_id uuid REFERENCES public.subcontracts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS drawing_reference text,
  ADD COLUMN IF NOT EXISTS answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.construction_rfis
  DROP CONSTRAINT IF EXISTS construction_rfis_status_check;
ALTER TABLE public.construction_rfis
  ADD CONSTRAINT construction_rfis_status_check
  CHECK (status IN ('draft', 'open', 'submitted', 'answered', 'closed', 'cancelled'));

-- Replace the original command signature with the expanded optional payload.
DROP FUNCTION IF EXISTS public.create_construction_rfi(uuid, uuid, uuid, text, text, text, text, date, text);
CREATE OR REPLACE FUNCTION public.create_construction_rfi(
  p_business_id uuid,
  p_project_id uuid,
  p_site_id uuid,
  p_rfi_number text,
  p_title text,
  p_question text,
  p_priority text DEFAULT 'normal',
  p_due_date date DEFAULT NULL,
  p_evidence text DEFAULT NULL,
  p_proposed_solution text DEFAULT NULL,
  p_boq_item_id uuid DEFAULT NULL,
  p_subcontract_id uuid DEFAULT NULL,
  p_drawing_reference text DEFAULT NULL
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
  IF p_boq_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.boq_items i
      JOIN public.boq_versions v ON v.id = i.boq_version_id
     WHERE i.id = p_boq_item_id
       AND i.business_id = p_business_id
       AND v.business_id = p_business_id
       AND v.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'BOQ item is outside the requested project and business.' USING ERRCODE = '42501';
  END IF;
  IF p_subcontract_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subcontracts s
     WHERE s.id = p_subcontract_id
       AND s.business_id = p_business_id
       AND s.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'Subcontract is outside the requested project and business.' USING ERRCODE = '42501';
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
    business_id, project_id, site_id, rfi_number, title, question, priority,
    due_date, evidence, proposed_solution, boq_item_id, subcontract_id,
    drawing_reference, created_by, updated_by
  ) VALUES (
    p_business_id, p_project_id, p_site_id, btrim(p_rfi_number), btrim(p_title), btrim(p_question),
    coalesce(p_priority, 'normal'), p_due_date, p_evidence, p_proposed_solution,
    p_boq_item_id, p_subcontract_id, p_drawing_reference, v_actor, v_actor
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
  v_proposed_solution text;
  v_boq_item_id uuid;
  v_subcontract_id uuid;
  v_drawing_reference text;
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
  IF v_rfi.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft RFIs can be edited.' USING ERRCODE = '22023';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'RFI update payload must be an object.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF v_key NOT IN (
      'title', 'question', 'priority', 'due_date', 'evidence', 'proposed_solution',
      'boq_item_id', 'subcontract_id', 'drawing_reference'
    ) THEN
      RAISE EXCEPTION 'Unsupported RFI update field: %', v_key USING ERRCODE = '22023';
    END IF;
  END LOOP;

  v_title := v_rfi.title;
  v_question := v_rfi.question;
  v_priority := v_rfi.priority;
  v_due_date := v_rfi.due_date;
  v_evidence := v_rfi.evidence;
  v_proposed_solution := v_rfi.proposed_solution;
  v_boq_item_id := v_rfi.boq_item_id;
  v_subcontract_id := v_rfi.subcontract_id;
  v_drawing_reference := v_rfi.drawing_reference;

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
                       ELSE nullif(btrim(p_payload->>'evidence'), '') END;
  END IF;
  IF p_payload ? 'proposed_solution' THEN
    v_proposed_solution := nullif(btrim(p_payload->>'proposed_solution'), '');
  END IF;
  IF p_payload ? 'boq_item_id' THEN
    v_boq_item_id := nullif(p_payload->>'boq_item_id', '')::uuid;
  END IF;
  IF p_payload ? 'subcontract_id' THEN
    v_subcontract_id := nullif(p_payload->>'subcontract_id', '')::uuid;
  END IF;
  IF p_payload ? 'drawing_reference' THEN
    v_drawing_reference := nullif(btrim(p_payload->>'drawing_reference'), '');
  END IF;

  IF v_boq_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.boq_items i
      JOIN public.boq_versions v ON v.id = i.boq_version_id
     WHERE i.id = v_boq_item_id
       AND i.business_id = v_rfi.business_id
       AND v.business_id = v_rfi.business_id
       AND v.project_id = v_rfi.project_id
  ) THEN
    RAISE EXCEPTION 'BOQ item is outside the RFI project and business.' USING ERRCODE = '42501';
  END IF;
  IF v_subcontract_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subcontracts s
     WHERE s.id = v_subcontract_id
       AND s.business_id = v_rfi.business_id
       AND s.project_id = v_rfi.project_id
  ) THEN
    RAISE EXCEPTION 'Subcontract is outside the RFI project and business.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.construction_rfis
     SET title = v_title,
         question = v_question,
         priority = v_priority,
         due_date = v_due_date,
         evidence = v_evidence,
         proposed_solution = v_proposed_solution,
         boq_item_id = v_boq_item_id,
         subcontract_id = v_subcontract_id,
         drawing_reference = v_drawing_reference,
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
    (v_rfi.status = 'draft' AND p_new_status IN ('open', 'submitted', 'cancelled')) OR
    (v_rfi.status = 'open' AND p_new_status IN ('answered', 'closed', 'cancelled')) OR
    (v_rfi.status = 'submitted' AND p_new_status IN ('answered', 'closed', 'cancelled')) OR
    (v_rfi.status = 'answered' AND p_new_status IN ('open', 'closed', 'cancelled'))
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
         answered_by = CASE WHEN p_new_status = 'answered' THEN v_actor
                            WHEN p_new_status = 'open' THEN NULL ELSE answered_by END,
         closed_at = CASE WHEN p_new_status IN ('closed', 'cancelled') THEN now() ELSE NULL END,
         updated_by = v_actor,
         updated_at = now()
   WHERE id = p_rfi_id
   RETURNING * INTO v_rfi;
  RETURN v_rfi;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_construction_rfi(uuid, uuid, uuid, text, text, text, text, date, text, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_construction_rfi(uuid, uuid, uuid, text, text, text, text, date, text, text, uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
