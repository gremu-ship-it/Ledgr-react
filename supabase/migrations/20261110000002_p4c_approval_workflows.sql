-- P4C: Enterprise approval workflows for purchase orders and manual journals.
-- Additive transition guards; existing command/RPC authorization logic remains intact.

CREATE TABLE public.approval_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type IN ('purchase_order', 'journal_entry')),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, document_type)
);
CREATE INDEX idx_approval_workflows_business ON public.approval_workflows(business_id);

CREATE TABLE public.approval_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.approval_workflows(id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  required_role public.user_role NOT NULL,
  description text,
  UNIQUE (workflow_id, step_order)
);

CREATE TABLE public.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.approval_workflows(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('purchase_order', 'journal_entry')),
  document_id uuid NOT NULL,
  document_snapshot jsonb NOT NULL,
  current_step integer NOT NULL DEFAULT 1 CHECK (current_step > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (id, workflow_id)
);
CREATE UNIQUE INDEX uq_approval_requests_pending_document
  ON public.approval_requests(business_id, document_type, document_id)
  WHERE status = 'pending';
CREATE INDEX idx_approval_requests_business_status
  ON public.approval_requests(business_id, status, requested_at DESC);
CREATE INDEX idx_approval_requests_document
  ON public.approval_requests(document_type, document_id, requested_at DESC);

-- A submission snapshots the ordered chain, so edits/deactivation of the
-- configured workflow do not rewrite the authority for already-pending work.
CREATE TABLE public.approval_request_steps (
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  required_role public.user_role NOT NULL,
  description text,
  PRIMARY KEY (request_id, step_order)
);

CREATE TABLE public.approval_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_id uuid NOT NULL REFERENCES public.approval_requests(id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order >= 0),
  action text NOT NULL CHECK (action IN ('submitted', 'approved', 'rejected', 'resubmitted')),
  acted_by uuid NOT NULL REFERENCES auth.users(id),
  acted_at timestamptz NOT NULL DEFAULT now(),
  comments text
);
CREATE INDEX idx_approval_history_request ON public.approval_history(request_id, id);

COMMENT ON TABLE public.approval_workflows IS
  'Enterprise linear approval workflow configuration, one per business and supported document type.';
COMMENT ON TABLE public.approval_workflow_steps IS
  'Ordered role-based approval steps. Submitted requests receive an immutable step snapshot.';
COMMENT ON TABLE public.approval_requests IS
  'Approval state for one purchase order or manual journal entry, with a server-captured document snapshot.';
COMMENT ON TABLE public.approval_request_steps IS
  'Immutable per-request snapshot of the ordered workflow roles and descriptions.';
COMMENT ON TABLE public.approval_history IS
  'Append-only approval activity history, including submission, approval, rejection and resubmission.';

ALTER TABLE public.approval_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_request_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approval_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY approval_workflows_member_read ON public.approval_workflows
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY approval_workflow_steps_member_read ON public.approval_workflow_steps
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.approval_workflows w
      WHERE w.id = workflow_id AND public.is_business_member(w.business_id))
  );
CREATE POLICY approval_requests_member_read ON public.approval_requests
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY approval_request_steps_member_read ON public.approval_request_steps
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.approval_requests r
      WHERE r.id = request_id AND public.is_business_member(r.business_id))
  );
CREATE POLICY approval_history_member_read ON public.approval_history
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.approval_requests r
      WHERE r.id = request_id AND public.is_business_member(r.business_id))
  );

REVOKE ALL ON public.approval_workflows, public.approval_workflow_steps,
  public.approval_requests, public.approval_request_steps, public.approval_history
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.approval_workflows, public.approval_workflow_steps,
  public.approval_requests, public.approval_request_steps, public.approval_history
  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approval_workflows,
  public.approval_workflow_steps, public.approval_requests,
  public.approval_request_steps, public.approval_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.approval_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public._approval_business_entitled(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id
      AND public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'
  );
$$;
REVOKE ALL ON FUNCTION public._approval_business_entitled(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._approval_document_snapshot(
  p_document_type text,
  p_document_id uuid,
  p_business_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF p_document_type = 'purchase_order' THEN
    SELECT jsonb_build_object(
      'document', to_jsonb(po) - ARRAY['status', 'authorized_by', 'authorized_at', 'updated_at'],
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(line) ORDER BY line.line_number, line.id)
        FROM public.construction_purchase_order_lines line
        WHERE line.po_id = po.id AND line.business_id = po.business_id
      ), '[]'::jsonb)
    ) INTO v_snapshot
    FROM public.construction_purchase_orders po
    WHERE po.id = p_document_id AND po.business_id = p_business_id;
  ELSIF p_document_type = 'journal_entry' THEN
    SELECT jsonb_build_object(
      'document', to_jsonb(entry) - ARRAY['status', 'posted_at', 'posted_by'],
      'lines', COALESCE((
        SELECT jsonb_agg(to_jsonb(line) ORDER BY line.line_number, line.id)
        FROM public.journal_lines line
        WHERE line.journal_entry_id = entry.id AND line.business_id = entry.business_id
      ), '[]'::jsonb)
    ) INTO v_snapshot
    FROM public.journal_entries entry
    WHERE entry.id = p_document_id AND entry.business_id = p_business_id
      AND entry.source_type IS NULL;
  ELSE
    RAISE EXCEPTION 'Unsupported approval document type.' USING ERRCODE = '22023';
  END IF;
  RETURN v_snapshot;
END;
$$;
REVOKE ALL ON FUNCTION public._approval_document_snapshot(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.requires_approval(
  p_business_id uuid,
  p_document_type text
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_document_type IN ('purchase_order', 'journal_entry')
    AND public._approval_business_entitled(p_business_id)
    AND EXISTS (
      SELECT 1 FROM public.approval_workflows w
      WHERE w.business_id = p_business_id
        AND w.document_type = p_document_type
        AND w.is_active
    );
$$;
REVOKE ALL ON FUNCTION public.requires_approval(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.requires_approval(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_approval_workflow(
  p_business_id uuid,
  p_document_type text,
  p_name text,
  p_is_active boolean,
  p_steps jsonb
) RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workflow_id uuid;
  v_step jsonb;
  v_order integer := 0;
  v_role public.user_role;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_admin_business_data(p_business_id) THEN
    RAISE EXCEPTION 'Workflow configuration requires a business administrator.' USING ERRCODE = '42501';
  END IF;
  IF NOT public._approval_business_entitled(p_business_id) THEN
    RAISE EXCEPTION 'Approval workflows require the Enterprise plan.' USING ERRCODE = '42501';
  END IF;
  IF p_document_type NOT IN ('purchase_order', 'journal_entry') THEN
    RAISE EXCEPTION 'Unsupported approval document type.' USING ERRCODE = '22023';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'A workflow name is required.' USING ERRCODE = '22023';
  END IF;
  IF p_steps IS NULL OR jsonb_typeof(p_steps) <> 'array' THEN
    RAISE EXCEPTION 'Workflow steps must be an array.' USING ERRCODE = '22023';
  END IF;
  IF p_is_active AND jsonb_array_length(p_steps) = 0 THEN
    RAISE EXCEPTION 'An active workflow requires at least one approval step.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.approval_workflows (business_id, document_type, name, is_active)
  VALUES (p_business_id, p_document_type, btrim(p_name), p_is_active)
  ON CONFLICT (business_id, document_type) DO UPDATE
    SET name = EXCLUDED.name, is_active = EXCLUDED.is_active, updated_at = now()
  RETURNING id INTO v_workflow_id;

  DELETE FROM public.approval_workflow_steps WHERE workflow_id = v_workflow_id;
  FOR v_step IN SELECT value FROM jsonb_array_elements(p_steps) LOOP
    v_order := v_order + 1;
    BEGIN
      v_role := (v_step->>'required_role')::public.user_role;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'A workflow step has an unsupported member role.' USING ERRCODE = '22023';
    END;
    INSERT INTO public.approval_workflow_steps(workflow_id, step_order, required_role, description)
    VALUES (v_workflow_id, v_order, v_role, nullif(btrim(v_step->>'description'), ''));
  END LOOP;
  RETURN v_workflow_id;
END;
$$;
REVOKE ALL ON FUNCTION public.save_approval_workflow(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_approval_workflow(uuid, text, text, boolean, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.start_approval_workflow(
  p_business_id uuid,
  p_document_type text,
  p_document_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_workflow public.approval_workflows%rowtype;
  v_request public.approval_requests%rowtype;
  v_previous_request public.approval_requests%rowtype;
  v_creator text;
  v_snapshot jsonb;
  v_source_type text;
BEGIN
  IF v_actor IS NULL OR NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'An active business membership is required.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.requires_approval(p_business_id, p_document_type) THEN
    RETURN jsonb_build_object('required', false, 'status', 'not_required');
  END IF;

  SELECT * INTO v_workflow FROM public.approval_workflows
  WHERE business_id = p_business_id AND document_type = p_document_type AND is_active
  FOR SHARE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.approval_workflow_steps s WHERE s.workflow_id = v_workflow.id) THEN
    RAISE EXCEPTION 'The active approval workflow has no configured steps.' USING ERRCODE = '55000';
  END IF;

  IF p_document_type = 'purchase_order' THEN
    IF public._ledgr_construction_capability(p_business_id, v_actor, 'procurement.po.manage') THEN
      PERFORM public._ledgr_construction_actor(p_business_id, 'procurement.po.manage');
    ELSE
      PERFORM public._ledgr_construction_actor(p_business_id, 'procurement.po.authorize');
    END IF;
    PERFORM 1
    FROM public.construction_purchase_orders po
    WHERE po.id = p_document_id AND po.business_id = p_business_id AND po.status = 'draft'
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'A draft purchase order is required.' USING ERRCODE = '22023'; END IF;
    v_snapshot := public._approval_document_snapshot(p_document_type, p_document_id, p_business_id);
  ELSIF p_document_type = 'journal_entry' THEN
    IF NOT public.can_write_business_data(p_business_id) THEN
      RAISE EXCEPTION 'Journal approval submission requires business write permission.' USING ERRCODE = '42501';
    END IF;
    SELECT entry.source_type INTO v_source_type
    FROM public.journal_entries entry
    WHERE entry.id = p_document_id AND entry.business_id = p_business_id AND entry.status = 'draft'
    FOR UPDATE;
    IF NOT FOUND OR v_source_type IS NOT NULL THEN
      RAISE EXCEPTION 'A draft manual journal entry is required.' USING ERRCODE = '22023';
    END IF;
    v_snapshot := public._approval_document_snapshot(p_document_type, p_document_id, p_business_id);
  ELSE
    RAISE EXCEPTION 'Unsupported approval document type.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_previous_request FROM public.approval_requests r
  WHERE r.business_id = p_business_id AND r.document_type = p_document_type
    AND r.document_id = p_document_id
  ORDER BY r.requested_at DESC, r.id DESC LIMIT 1
  FOR UPDATE;
  IF FOUND AND v_previous_request.status = 'rejected' THEN
    IF p_document_type = 'purchase_order' THEN
      SELECT po.created_by::text INTO v_creator FROM public.construction_purchase_orders po
      WHERE po.id = p_document_id AND po.business_id = p_business_id;
    ELSE
      SELECT entry.created_by::text INTO v_creator FROM public.journal_entries entry
      WHERE entry.id = p_document_id AND entry.business_id = p_business_id;
    END IF;
    IF v_creator IS DISTINCT FROM v_actor::text THEN
      RAISE EXCEPTION 'A rejected document must be resubmitted by its author.' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.approval_history(request_id, step_order, action, acted_by)
    VALUES (v_previous_request.id, 0, 'resubmitted', v_actor);
  END IF;

  SELECT * INTO v_request FROM public.approval_requests
  WHERE business_id = p_business_id AND document_type = p_document_type
    AND document_id = p_document_id AND status = 'pending'
  FOR UPDATE;
  IF FOUND THEN
    RETURN jsonb_build_object('required', true, 'request_id', v_request.id, 'status', v_request.status,
      'current_step', v_request.current_step);
  END IF;

  INSERT INTO public.approval_requests(
    business_id, workflow_id, document_type, document_id, document_snapshot, requested_by
  ) VALUES (p_business_id, v_workflow.id, p_document_type, p_document_id, v_snapshot, v_actor)
  RETURNING * INTO v_request;
  INSERT INTO public.approval_request_steps(request_id, step_order, required_role, description)
    SELECT v_request.id, s.step_order, s.required_role, s.description
    FROM public.approval_workflow_steps s WHERE s.workflow_id = v_workflow.id ORDER BY s.step_order;
  INSERT INTO public.approval_history(request_id, step_order, action, acted_by)
  VALUES (v_request.id, 0, 'submitted', v_actor);
  RETURN jsonb_build_object('required', true, 'request_id', v_request.id, 'status', v_request.status,
    'current_step', v_request.current_step);
END;
$$;
REVOKE ALL ON FUNCTION public.start_approval_workflow(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_approval_workflow(uuid, text, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_approve_step(p_request_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.approval_requests%rowtype;
  v_step public.approval_request_steps%rowtype;
  v_creator uuid;
  v_last_step integer;
BEGIN
  IF p_user_id IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN RETURN false; END IF;
  SELECT * INTO v_request FROM public.approval_requests
  WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_step FROM public.approval_request_steps
  WHERE request_id = v_request.id AND step_order = v_request.current_step;
  IF NOT FOUND THEN RETURN false; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = v_request.business_id AND bu.user_id = p_user_id
      AND bu.is_active AND bu.role = v_step.required_role) THEN RETURN false; END IF;

  -- Preserve the PO's existing four-eyes rule: its creator cannot be the
  -- final authorizer, even when assigned the final workflow role.
  IF v_request.document_type = 'purchase_order' THEN
    SELECT po.created_by INTO v_creator FROM public.construction_purchase_orders po
    WHERE po.id = v_request.document_id AND po.business_id = v_request.business_id;
    SELECT max(step_order) INTO v_last_step FROM public.approval_request_steps WHERE request_id = v_request.id;
    IF v_request.current_step = v_last_step AND v_creator = p_user_id THEN RETURN false; END IF;
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.can_approve_step(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_approve_step(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.resubmit_approval(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.approval_requests%rowtype;
  v_creator text;
  v_business_id uuid;
  v_type text;
  v_document_id uuid;
  v_started jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign-in is required.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_request FROM public.approval_requests
  WHERE id = p_request_id AND status = 'rejected' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'A rejected approval request is required.' USING ERRCODE = '22023'; END IF;
  v_business_id := v_request.business_id;
  v_type := v_request.document_type;
  v_document_id := v_request.document_id;

  IF v_type = 'purchase_order' THEN
    SELECT created_by::text INTO v_creator FROM public.construction_purchase_orders
    WHERE id = v_document_id AND business_id = v_business_id AND status = 'draft';
  ELSE
    SELECT created_by::text INTO v_creator FROM public.journal_entries
    WHERE id = v_document_id AND business_id = v_business_id AND status = 'draft' AND source_type IS NULL;
  END IF;
  IF v_creator IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'Only the document author may resubmit it.' USING ERRCODE = '42501';
  END IF;

  v_started := public.start_approval_workflow(v_business_id, v_type, v_document_id);
  IF coalesce((v_started->>'required')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'No active Enterprise approval workflow is configured.' USING ERRCODE = '55000';
  END IF;
  RETURN v_started;
END;
$$;
REVOKE ALL ON FUNCTION public.resubmit_approval(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_approval(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.act_on_approval(
  p_request_id uuid,
  p_action text,
  p_comments text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.approval_requests%rowtype;
  v_max_step integer;
  v_snapshot jsonb;
  v_result jsonb;
  v_actor uuid := auth.uid();
BEGIN
  IF p_action NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid approval action.' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign-in is required.' USING ERRCODE = '42501'; END IF;
  IF p_action = 'rejected' AND length(btrim(coalesce(p_comments, ''))) = 0 THEN
    RAISE EXCEPTION 'A rejection reason is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_request FROM public.approval_requests
  WHERE id = p_request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No pending approval request was found.' USING ERRCODE = '22023'; END IF;
  IF NOT public.can_approve_step(v_request.id, v_actor) THEN
    RAISE EXCEPTION 'You do not hold the role required for the current approval step.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.approval_history(request_id, step_order, action, acted_by, comments)
  VALUES (v_request.id, v_request.current_step, p_action, v_actor, nullif(btrim(p_comments), ''));

  IF p_action = 'rejected' THEN
    UPDATE public.approval_requests SET status = 'rejected', completed_at = now()
    WHERE id = v_request.id;
    RETURN jsonb_build_object('status', 'rejected', 'request_id', v_request.id,
      'current_step', v_request.current_step);
  END IF;

  SELECT max(step_order) INTO v_max_step FROM public.approval_request_steps WHERE request_id = v_request.id;
  IF v_request.current_step < v_max_step THEN
    UPDATE public.approval_requests SET current_step = current_step + 1 WHERE id = v_request.id;
    RETURN jsonb_build_object('status', 'advanced', 'request_id', v_request.id,
      'current_step', v_request.current_step + 1);
  END IF;

  v_snapshot := public._approval_document_snapshot(v_request.document_type, v_request.document_id, v_request.business_id);
  IF v_snapshot IS DISTINCT FROM v_request.document_snapshot THEN
    RAISE EXCEPTION 'The document changed after approval was requested. Reject and resubmit it.' USING ERRCODE = '55000';
  END IF;

  UPDATE public.approval_requests SET status = 'approved', completed_at = now() WHERE id = v_request.id;
  IF v_request.document_type = 'purchase_order' THEN
    v_result := public.authorize_construction_purchase_order(v_request.document_id);
  ELSE
    IF NOT public.can_write_business_data(v_request.business_id) THEN
      RAISE EXCEPTION 'Journal posting requires business write permission.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.journal_entries SET status = 'posted', posted_by = v_actor::text, posted_at = now()
    WHERE id = v_request.document_id AND business_id = v_request.business_id
      AND source_type IS NULL AND status = 'draft';
    IF NOT FOUND THEN RAISE EXCEPTION 'The draft journal entry could not be posted.' USING ERRCODE = '55000'; END IF;
    v_result := jsonb_build_object('status', 'posted', 'document_id', v_request.document_id);
  END IF;
  RETURN jsonb_build_object('status', 'fully_approved', 'request_id', v_request.id, 'document', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.act_on_approval(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.act_on_approval(uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_approval_state(
  p_business_id uuid,
  p_document_type text,
  p_document_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request public.approval_requests%rowtype;
  v_result jsonb;
  v_is_author boolean := false;
  v_can_approve boolean := false;
  v_step_count integer := 0;
BEGIN
  IF NOT public.is_business_member(p_business_id) THEN
    RAISE EXCEPTION 'An active business membership is required.' USING ERRCODE = '42501';
  END IF;
  IF p_document_type NOT IN ('purchase_order', 'journal_entry') THEN
    RAISE EXCEPTION 'Unsupported approval document type.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM public.approval_requests
  WHERE business_id = p_business_id AND document_type = p_document_type AND document_id = p_document_id
  ORDER BY requested_at DESC, id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('requires_approval', public.requires_approval(p_business_id, p_document_type), 'request', null);
  END IF;

  SELECT count(*) INTO v_step_count FROM public.approval_request_steps WHERE request_id = v_request.id;
  IF p_document_type = 'purchase_order' THEN
    SELECT po.created_by = auth.uid() INTO v_is_author FROM public.construction_purchase_orders po
    WHERE po.id = p_document_id AND po.business_id = p_business_id;
  ELSE
    SELECT entry.created_by::text = auth.uid()::text INTO v_is_author FROM public.journal_entries entry
    WHERE entry.id = p_document_id AND entry.business_id = p_business_id;
  END IF;
  v_can_approve := public.can_approve_step(v_request.id, auth.uid());

  SELECT jsonb_build_object(
    'id', v_request.id,
    'business_id', v_request.business_id,
    'document_type', v_request.document_type,
    'document_id', v_request.document_id,
    'status', v_request.status,
    'current_step', v_request.current_step,
    'total_steps', v_step_count,
    'requested_by', v_request.requested_by,
    'requested_by_name', coalesce(profile.full_name, v_request.requested_by::text),
    'requested_at', v_request.requested_at,
    'current_role', current_step.required_role::text,
    'current_description', current_step.description,
    'can_approve', v_can_approve,
    'is_author', coalesce(v_is_author, false),
    'history', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'action', h.action,
        'step_order', h.step_order,
        'comments', h.comments,
        'acted_at', h.acted_at,
        'actor_id', h.acted_by,
        'actor_name', coalesce(actor.full_name, h.acted_by::text)
      ) ORDER BY h.id)
      FROM public.approval_requests all_requests
      JOIN public.approval_history h ON h.request_id = all_requests.id
      LEFT JOIN public.user_profiles actor ON actor.id = h.acted_by
      WHERE all_requests.business_id = p_business_id
        AND all_requests.document_type = p_document_type AND all_requests.document_id = p_document_id
    ), '[]'::jsonb)
  ) INTO v_result
  FROM public.approval_requests req
  LEFT JOIN public.user_profiles profile ON profile.id = req.requested_by
  LEFT JOIN public.approval_request_steps current_step
    ON current_step.request_id = req.id AND current_step.step_order = req.current_step
  WHERE req.id = v_request.id;
  RETURN jsonb_build_object('requires_approval', public.requires_approval(p_business_id, p_document_type),
    'request', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.get_approval_state(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_approval_state(uuid, text, uuid) TO authenticated;

-- These guards keep direct table writes from bypassing an active workflow. The
-- existing PO command and journal repository authorization logic is untouched.
CREATE OR REPLACE FUNCTION public._approval_guard_purchase_order_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'authorized'
     AND (public.requires_approval(NEW.business_id, 'purchase_order') OR EXISTS (
       SELECT 1 FROM public.approval_requests r
       WHERE r.business_id = NEW.business_id AND r.document_type = 'purchase_order'
         AND r.document_id = NEW.id AND r.status = 'pending'
     )) THEN
    v_snapshot := public._approval_document_snapshot('purchase_order', NEW.id, NEW.business_id);
    IF NOT EXISTS (
      SELECT 1 FROM public.approval_requests r
      WHERE r.business_id = NEW.business_id AND r.document_type = 'purchase_order'
        AND r.document_id = NEW.id AND r.status = 'approved'
        AND r.document_snapshot = v_snapshot
    ) THEN
      RAISE EXCEPTION 'This purchase order requires approval before authorization.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._approval_guard_purchase_order_transition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER approval_guard_purchase_order_transition
  BEFORE UPDATE OF status ON public.construction_purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public._approval_guard_purchase_order_transition();

CREATE OR REPLACE FUNCTION public._approval_guard_journal_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_snapshot jsonb;
  v_business_id uuid;
  v_entry_id uuid;
BEGIN
  IF NEW.source_type IS NULL AND NEW.status = 'posted'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
     AND (public.requires_approval(NEW.business_id, 'journal_entry') OR EXISTS (
       SELECT 1 FROM public.approval_requests r
       WHERE r.business_id = NEW.business_id AND r.document_type = 'journal_entry'
         AND r.document_id = NEW.id AND r.status = 'pending'
     )) THEN
    v_entry_id := NEW.id;
    v_business_id := NEW.business_id;
    v_snapshot := public._approval_document_snapshot('journal_entry', v_entry_id, v_business_id);
    IF NOT EXISTS (
      SELECT 1 FROM public.approval_requests r
      WHERE r.business_id = v_business_id AND r.document_type = 'journal_entry'
        AND r.document_id = v_entry_id AND r.status = 'approved'
        AND r.document_snapshot = v_snapshot
    ) THEN
      RAISE EXCEPTION 'This journal entry requires approval before posting.' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._approval_guard_journal_transition() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER approval_guard_journal_transition
  BEFORE INSERT OR UPDATE OF status ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public._approval_guard_journal_transition();

CREATE OR REPLACE FUNCTION public._approval_guard_pending_line_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_document_id uuid;
  v_document_type text;
  v_business_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'construction_purchase_order_lines' THEN
    v_document_type := 'purchase_order';
    v_document_id := COALESCE(NEW.po_id, OLD.po_id);
    v_business_id := COALESCE(NEW.business_id, OLD.business_id);
  ELSE
    v_document_type := 'journal_entry';
    v_document_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    v_business_id := COALESCE(NEW.business_id, OLD.business_id);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.approval_requests r
    WHERE r.business_id = v_business_id AND r.document_type = v_document_type
      AND r.document_id = v_document_id AND r.status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Document lines cannot be changed while approval is pending.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public._approval_guard_pending_line_edit() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER approval_guard_pending_po_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.construction_purchase_order_lines
  FOR EACH ROW EXECUTE FUNCTION public._approval_guard_pending_line_edit();
CREATE TRIGGER approval_guard_pending_journal_lines
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_lines
  FOR EACH ROW EXECUTE FUNCTION public._approval_guard_pending_line_edit();

CREATE TRIGGER set_approval_workflows_updated_at
  BEFORE UPDATE ON public.approval_workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
