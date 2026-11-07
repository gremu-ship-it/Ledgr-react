-- The employee audit trigger passed a text resource ID into audit_log.resource_id.
-- Production stores that column as UUID, so every employee INSERT raised
-- SQLSTATE 42804 inside the AFTER INSERT trigger and rolled back the employee.
-- Keep the resource ID as UUID for the audit row, casting only for the
-- audit_chain_hash signature, which intentionally accepts text.
CREATE OR REPLACE FUNCTION public.log_employee_audit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  v_resource_id uuid;
  v_resource_ref text;
  v_ip inet := public._audit_request_ip();
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_business_id := NEW.business_id;
    v_old_values := NULL;
    v_new_values := public._redact_audit_pii(to_jsonb(NEW));
    v_event_type := 'employee_created';
    v_resource_id := NEW.id;
    v_resource_ref := NEW.employee_number;
  ELSIF TG_OP = 'UPDATE' THEN
    v_business_id := NEW.business_id;
    v_old_values := public._redact_audit_pii(to_jsonb(OLD));
    v_new_values := public._redact_audit_pii(to_jsonb(NEW));
    v_event_type := 'employee_updated';
    v_resource_id := NEW.id;
    v_resource_ref := NEW.employee_number;
  ELSE
    v_business_id := OLD.business_id;
    v_old_values := public._redact_audit_pii(to_jsonb(OLD));
    v_new_values := NULL;
    v_event_type := 'employee_deleted';
    v_resource_id := OLD.id;
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
    v_resource_id::text, v_resource_ref, v_old_values, v_new_values, NULL
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
$function$;

DO $verify$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('public.log_employee_audit_event()'::regprocedure)
    INTO v_definition;

  IF position('v_resource_id uuid' IN v_definition) = 0
     OR position('v_resource_id::text' IN v_definition) = 0
     OR position('v_resource_id text' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'Employee audit resource_id type fix was not applied correctly.';
  END IF;
END;
$verify$;
