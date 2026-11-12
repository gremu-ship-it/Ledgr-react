-- Phase 8D SEC-05 / SEC-06: complete employee audit coverage, redact PII,
-- and verify the full audit chain before applying any resource-type filter.
-- Replay-safe: functions are replaced in place and the trigger is dropped
-- before recreation. Existing audit RPC signatures and result columns remain.

CREATE OR REPLACE FUNCTION public._redact_audit_pii(p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_data IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_data) <> 'object' THEN
    RETURN p_data;
  END IF;

  RETURN p_data
    || CASE WHEN p_data ? 'bank_account_number' THEN jsonb_build_object('bank_account_number', '[REDACTED]') ELSE '{}'::jsonb END
    || CASE WHEN p_data ? 'national_id' THEN jsonb_build_object('national_id', '[REDACTED]') ELSE '{}'::jsonb END
    || CASE WHEN p_data ? 'tpin' THEN jsonb_build_object('tpin', '[REDACTED]') ELSE '{}'::jsonb END
    || CASE WHEN p_data ? 'temporary_password' THEN jsonb_build_object('temporary_password', '[REDACTED]') ELSE '{}'::jsonb END
    || CASE WHEN p_data ? 'tax_identification_number' THEN jsonb_build_object('tax_identification_number', '[REDACTED]') ELSE '{}'::jsonb END;
END;
$$;

-- PostgREST/Supabase makes request headers available through this GUC. Use
-- the caller IP supplied by the request context when present, then the direct
-- connection address, and retain 0.0.0.0 only as the final no-context fallback.
CREATE OR REPLACE FUNCTION public._audit_request_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_headers jsonb;
  v_candidate text;
  v_ip_text text;
BEGIN
  BEGIN
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  FOR v_candidate IN
    SELECT unnest(ARRAY[
      v_headers ->> 'x-forwarded-for',
      v_headers ->> 'X-Forwarded-For',
      v_headers ->> 'x-real-ip',
      v_headers ->> 'X-Real-IP',
      nullif(current_setting('request.remote_addr', true), ''),
      inet_client_addr()::text
    ])
  LOOP
    v_ip_text := nullif(btrim(split_part(coalesce(v_candidate, ''), ',', 1)), '');
    IF v_ip_text IS NOT NULL THEN
      BEGIN
        RETURN v_ip_text::inet;
      EXCEPTION WHEN invalid_text_representation THEN
        NULL;
      END;
    END IF;
  END LOOP;

  RETURN '0.0.0.0'::inet;
END;
$$;

-- Keep the existing manual-audit RPC contract while ensuring caller context
-- and sanitized snapshots are used consistently for both hashing and storage.
CREATE OR REPLACE FUNCTION public.log_manual_audit_event(
  p_business_id uuid,
  p_event_type text,
  p_resource_type text,
  p_resource_id text,
  p_resource_ref text DEFAULT NULL,
  p_old_values jsonb DEFAULT NULL,
  p_new_values jsonb DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_now timestamptz := now();
  v_prev text;
  v_hash text;
  v_old_values jsonb := public._redact_audit_pii(p_old_values);
  v_new_values jsonb := public._redact_audit_pii(p_new_values);
  v_ip inet := public._audit_request_ip();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING errcode = '42501';
  END IF;
  IF NOT public.can_write_business_data(p_business_id) THEN
    RAISE EXCEPTION 'You do not have permission to write audit entries for this business.'
      USING errcode = '42501';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  SELECT entry_hash INTO v_prev
    FROM public.audit_log
   WHERE business_id = p_business_id
   ORDER BY id DESC
   LIMIT 1;

  v_hash := public.audit_chain_hash(
    v_prev, p_business_id, v_user_id, v_now, p_event_type, p_resource_type,
    p_resource_id, p_resource_ref, v_old_values, v_new_values, p_notes
  );

  INSERT INTO public.audit_log (
    business_id, user_id, user_email, event_type, resource_type, resource_id,
    resource_ref, old_values, new_values, notes, occurred_at, ip_address,
    prev_hash, entry_hash
  ) VALUES (
    p_business_id, v_user_id, v_email, p_event_type, p_resource_type,
    p_resource_id, p_resource_ref, v_old_values, v_new_values, p_notes,
    v_now, v_ip, v_prev, v_hash
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.log_employee_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_user_id uuid := auth.uid();
  v_email text;
  v_now timestamptz := now();
  v_prev text;
  v_hash text;
  v_old_values jsonb;
  v_new_values jsonb;
  v_event_type text;
  v_resource_id text;
  v_resource_ref text;
  v_ip inet := public._audit_request_ip();
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_business_id := NEW.business_id;
    v_old_values := NULL;
    v_new_values := public._redact_audit_pii(to_jsonb(NEW));
    v_event_type := 'employee_created';
    v_resource_id := NEW.id::text;
    v_resource_ref := NEW.employee_number;
  ELSIF TG_OP = 'UPDATE' THEN
    v_business_id := NEW.business_id;
    v_old_values := public._redact_audit_pii(to_jsonb(OLD));
    v_new_values := public._redact_audit_pii(to_jsonb(NEW));
    v_event_type := 'employee_updated';
    v_resource_id := NEW.id::text;
    v_resource_ref := NEW.employee_number;
  ELSE
    v_business_id := OLD.business_id;
    v_old_values := public._redact_audit_pii(to_jsonb(OLD));
    v_new_values := NULL;
    v_event_type := 'employee_deleted';
    v_resource_id := OLD.id::text;
    v_resource_ref := OLD.employee_number;
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  SELECT entry_hash INTO v_prev
    FROM public.audit_log
   WHERE business_id = v_business_id
   ORDER BY id DESC
   LIMIT 1;

  v_hash := public.audit_chain_hash(
    v_prev, v_business_id, v_user_id, v_now, v_event_type, 'employees',
    v_resource_id, v_resource_ref, v_old_values, v_new_values, NULL
  );

  INSERT INTO public.audit_log (
    business_id, user_id, user_email, event_type, resource_type, resource_id,
    resource_ref, old_values, new_values, notes, occurred_at, ip_address,
    prev_hash, entry_hash
  ) VALUES (
    v_business_id, v_user_id, v_email, v_event_type, 'employees', v_resource_id,
    v_resource_ref, v_old_values, v_new_values, NULL, v_now, v_ip,
    v_prev, v_hash
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_employees ON public.employees;
CREATE TRIGGER trg_audit_employees
  AFTER INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.log_employee_audit_event();

-- Do not filter the cursor by resource type: every event contributes to the
-- business-wide predecessor chain. Filtering happens only after each row has
-- been verified. audit_log's timestamp column is `occurred_at` in this schema.
CREATE OR REPLACE FUNCTION public.verify_audit_chain(
  p_business_id uuid,
  p_resource_type text DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  occurred_at timestamptz,
  resource_type text,
  resource_id text,
  event_type text,
  entry_hash text,
  prev_hash text,
  chain_valid boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_expected text;
  v_prev_entry text := NULL;
BEGIN
  IF NOT public.can_read_audit(p_business_id) THEN
    RAISE EXCEPTION 'You do not have permission to read the audit log.'
      USING errcode = '42501';
  END IF;

  FOR r IN
    SELECT al.id, al.occurred_at, al.resource_type, al.resource_id, al.event_type,
           al.entry_hash, al.prev_hash, al.user_id, al.resource_ref,
           al.old_values, al.new_values, al.notes
      FROM public.audit_log al
     WHERE al.business_id = p_business_id
     ORDER BY al.occurred_at ASC, al.id ASC
  LOOP
    v_expected := public.audit_chain_hash(
      r.prev_hash, p_business_id, r.user_id, r.occurred_at,
      r.event_type, r.resource_type, r.resource_id, r.resource_ref,
      r.old_values, r.new_values, r.notes
    );

    IF p_resource_type IS NULL OR r.resource_type = p_resource_type THEN
      id := r.id;
      occurred_at := r.occurred_at;
      resource_type := r.resource_type;
      resource_id := r.resource_id;
      event_type := r.event_type;
      entry_hash := r.entry_hash;
      prev_hash := r.prev_hash;
      chain_valid := (r.entry_hash = v_expected)
                     AND (r.prev_hash IS NOT DISTINCT FROM v_prev_entry);
      RETURN NEXT;
    END IF;

    v_prev_entry := r.entry_hash;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._redact_audit_pii(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._audit_request_ip() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_employee_audit_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_audit_chain(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_audit_chain(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.log_manual_audit_event(uuid, text, text, text, text, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_manual_audit_event(uuid, text, text, text, text, jsonb, jsonb, text) TO authenticated, service_role;
