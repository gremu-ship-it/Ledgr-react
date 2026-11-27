-- Migration: 20261229000000_healthcare_clinic_foundation.sql
-- Description: Healthcare and Clinic Management Schema (Patients, Visits, Vitals,
--              Consultations, Prescriptions, Lab Orders) and their role-aware RLS.
--
-- The healthcare vertical is an Enterprise module. The schema is tenant-scoped
-- on business_id in every table; child tables (prescription_items and
-- lab_order_items) inherit the tenant from their parent so a read can never
-- cross a business boundary.
--
-- Financial authority mirrors the existing accounting surfaces:
--   * reads  -> public.can_read_financial_data(business_id)
--   * writes -> public.can_write_financial_data(business_id)
-- A clinician must be allowed to raise a bill, so healthcare uses the same
-- financial helpers as invoicing rather than a new privileged role.


-- 0. OPERATING-MODEL VOCABULARY — ADD HEALTHCARE
-- ---------------------------------------------------------------------------
-- The clinic vertical is selected through the same operating-model multi-select
-- as every other vertical. Both the table CHECK and the two validating RPCs are
-- extended together; otherwise the UI would offer "Healthcare & clinic" and the
-- database would reject the save. No existing value is removed.
-- ---------------------------------------------------------------------------
ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_operating_models_check;

ALTER TABLE public.businesses
  ADD CONSTRAINT businesses_operating_models_check
  CHECK (operating_models <@ ARRAY[
    'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
    'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION', 'MANUFACTURING',
    'HEALTHCARE'
  ]::text[]);

COMMENT ON COLUMN public.businesses.operating_models IS
  'Multi-select operating model profile; values: RETAIL, WHOLESALE, PRODUCT_SALES, SERVICE_SALES, PROJECT_BASED, GRANT_FUNDED, CONSTRUCTION, MANUFACTURING, HEALTHCARE. PROJECT_BASED is reserved and inert.';

-- Signatures are unchanged, so CREATE OR REPLACE keeps the existing ACLs.
CREATE OR REPLACE FUNCTION public.create_business_with_owner(
  p_name text,
  p_trading_name text,
  p_registration_number text,
  p_tpin text,
  p_vat_number text,
  p_vat_registered boolean,
  p_base_currency text,
  p_financial_year_start text,
  p_timezone text,
  p_address_line1 text,
  p_city text,
  p_country text,
  p_phone text,
  p_email text,
  p_brand_color text,
  p_invoice_prefix text,
  p_expense_prefix text,
  p_payroll_prefix text,
  p_organisation_type text DEFAULT 'FOR_PROFIT',
  p_operating_models text[] DEFAULT ARRAY[]::text[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_business_id uuid;
  v_operating_models text[] := COALESCE(p_operating_models, ARRAY[]::text[]);
  v_distinct_models integer;
BEGIN
  IF p_organisation_type IS NULL OR p_organisation_type NOT IN (
    'FOR_PROFIT', 'NON_PROFIT', 'GOVERNMENT', 'OTHER'
  ) THEN
    RAISE EXCEPTION 'Invalid organisation_type %', p_organisation_type
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_operating_models) AS model(value)
     WHERE value IS NULL OR value NOT IN (
       'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
       'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION', 'MANUFACTURING',
       'HEALTHCARE'
     )
  ) THEN
    RAISE EXCEPTION 'Invalid operating_models value.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT value)::integer
    INTO v_distinct_models
    FROM unnest(v_operating_models) AS model(value);
  IF cardinality(v_operating_models) <> v_distinct_models THEN
    RAISE EXCEPTION 'operating_models must not contain duplicates.'
      USING ERRCODE = '22023';
  END IF;

  v_business_id := public._ledgr_create_business_with_owner_core(
    p_name,
    p_trading_name,
    p_registration_number,
    p_tpin,
    p_vat_number,
    p_vat_registered,
    p_base_currency,
    p_financial_year_start,
    p_timezone,
    p_address_line1,
    p_city,
    p_country,
    p_phone,
    p_email,
    p_brand_color,
    p_invoice_prefix,
    p_expense_prefix,
    p_payroll_prefix
  );

  UPDATE public.businesses
     SET organisation_type = p_organisation_type,
         operating_models = v_operating_models,
         capability_overrides = '{}'::jsonb
   WHERE id = v_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Created business % could not be updated with its profile.', v_business_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_business_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_business_operating_models(
  p_business_id      uuid,
  p_operating_models text[]
)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor          uuid := auth.uid();
  v_role           text;
  v_models         text[] := COALESCE(p_operating_models, ARRAY[]::text[]);
  v_old            text[];
  v_distinct       integer;
  v_now            timestamptz := now();
  v_prev           text;
  v_hash           text;
  v_email          text;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;

  v_role := public._ledgr_member_role(p_business_id, v_actor);
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only an owner or administrator can change the operating models.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_models) AS model(value)
     WHERE value IS NULL OR value NOT IN (
       'RETAIL', 'WHOLESALE', 'PRODUCT_SALES', 'SERVICE_SALES',
       'PROJECT_BASED', 'GRANT_FUNDED', 'CONSTRUCTION', 'MANUFACTURING',
       'HEALTHCARE'
     )
  ) THEN
    RAISE EXCEPTION 'Invalid operating_models value.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT value)::integer INTO v_distinct FROM unnest(v_models) AS model(value);
  IF cardinality(v_models) <> v_distinct THEN
    RAISE EXCEPTION 'operating_models must not contain duplicates.' USING ERRCODE = '22023';
  END IF;

  SELECT b.operating_models
    INTO v_old
    FROM public.businesses b
   WHERE b.id = p_business_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business not found.' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_old, ARRAY[]::text[]) = v_models THEN
    RETURN v_models;
  END IF;

  UPDATE public.businesses
     SET operating_models = v_models,
         updated_at = now()
   WHERE id = p_business_id;

  SELECT email INTO v_email FROM auth.users WHERE id = v_actor;
  SELECT entry_hash INTO v_prev
    FROM public.audit_log
   WHERE business_id = p_business_id
   ORDER BY id DESC
   LIMIT 1;

  v_hash := public.audit_chain_hash(
    v_prev, p_business_id, v_actor, v_now,
    'business_operating_models_updated', 'businesses', p_business_id::text, NULL,
    to_jsonb(COALESCE(v_old, ARRAY[]::text[])), to_jsonb(v_models),
    'Operating models updated from business settings'
  );

  INSERT INTO public.audit_log (
    business_id, user_id, user_email, event_type, resource_type, resource_id,
    resource_ref, old_values, new_values, notes, occurred_at, ip_address,
    prev_hash, entry_hash
  ) VALUES (
    p_business_id, v_actor, v_email, 'business_operating_models_updated',
    'businesses', p_business_id, NULL,
    to_jsonb(COALESCE(v_old, ARRAY[]::text[])), to_jsonb(v_models),
    'Operating models updated from business settings',
    v_now, '0.0.0.0'::inet, v_prev, v_hash
  );

  RETURN v_models;
END;
$function$;

-- 1. Patients Table (Master Patient Registry)
CREATE TABLE IF NOT EXISTS public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  mrn text NOT NULL, -- Medical Record Number e.g. PAT-2026-0001
  first_name text NOT NULL,
  last_name text NOT NULL,
  date_of_birth date,
  gender text CHECK (gender IN ('male', 'female', 'other')),
  phone text,
  email text,
  address text,
  national_id text,
  blood_group text CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown')),
  allergies text[], -- Array of known drug/food allergies
  chronic_conditions text[],
  emergency_contact_name text,
  emergency_contact_phone text,
  billing_type text NOT NULL DEFAULT 'cash' CHECK (billing_type IN ('cash', 'insurance', 'corporate')),
  insurance_provider text,
  insurance_policy_number text,
  insurance_member_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_patients_business_mrn UNIQUE (business_id, mrn)
);

CREATE INDEX IF NOT EXISTS idx_patients_business_name ON public.patients(business_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_patients_business_phone ON public.patients(business_id, phone);
CREATE INDEX IF NOT EXISTS idx_patients_business_status ON public.patients(business_id, status);

-- 2. Patient Visits (Episode of Care & Queue Management)
CREATE TABLE IF NOT EXISTS public.patient_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_number text NOT NULL, -- e.g. VST-2026-0001
  visit_date date NOT NULL DEFAULT CURRENT_DATE,
  visit_type text NOT NULL DEFAULT 'outpatient' CHECK (visit_type IN ('outpatient', 'emergency', 'follow_up', 'routine_checkup')),
  stage text NOT NULL DEFAULT 'registered' CHECK (stage IN ('registered', 'triaged', 'with_doctor', 'in_lab', 'at_pharmacy', 'in_billing', 'completed', 'cancelled')),
  attending_doctor_id uuid,
  -- Triage Vital Signs
  systolic_bp integer,
  diastolic_bp integer,
  heart_rate integer,
  temperature numeric(4, 1),
  respiratory_rate integer,
  oxygen_saturation numeric(4, 1),
  weight_kg numeric(5, 2),
  height_cm numeric(5, 2),
  blood_sugar_mg_dl numeric(5, 1),
  triage_notes text,
  triaged_at timestamptz,
  triaged_by uuid,
  completed_at timestamptz,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- The app reserves the next number from the highest existing row. The
  -- constraint turns a lost race into a visible error instead of two patients
  -- sharing a file number.
  CONSTRAINT uq_patient_visits_business_number UNIQUE (business_id, visit_number)
);

CREATE INDEX IF NOT EXISTS idx_patient_visits_business_stage ON public.patient_visits(business_id, stage, visit_date);
CREATE INDEX IF NOT EXISTS idx_patient_visits_patient ON public.patient_visits(business_id, patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_patient_visits_invoice ON public.patient_visits(invoice_id) WHERE invoice_id IS NOT NULL;

-- 3. Clinical Consultations
CREATE TABLE IF NOT EXISTS public.clinical_consultations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL,
  chief_complaint text NOT NULL,
  history_of_present_illness text,
  physical_examination text,
  diagnosis text NOT NULL,
  icd10_code text,
  treatment_plan text,
  doctor_notes text,
  follow_up_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinical_consultations_visit ON public.clinical_consultations(business_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_clinical_consultations_patient ON public.clinical_consultations(business_id, patient_id, created_at DESC);

-- 4. Prescriptions & Prescription Items
CREATE TABLE IF NOT EXISTS public.prescriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dispensed', 'cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_visit ON public.prescriptions(business_id, visit_id);

CREATE TABLE IF NOT EXISTS public.prescription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  medication_name text NOT NULL,
  dosage text NOT NULL, -- e.g. 500mg
  frequency text NOT NULL, -- e.g. TDS (3 times daily)
  duration_days integer NOT NULL DEFAULT 5,
  quantity integer NOT NULL DEFAULT 1,
  unit_price numeric(15, 2) NOT NULL DEFAULT 0,
  instructions text,
  is_dispensed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prescription_items_prescription ON public.prescription_items(prescription_id);

-- 5. Lab Orders & Lab Items
CREATE TABLE IF NOT EXISTS public.lab_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'sample_collected', 'completed', 'cancelled')),
  clinical_indication text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_orders_visit ON public.lab_orders(business_id, visit_id);

CREATE TABLE IF NOT EXISTS public.lab_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_order_id uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  test_name text NOT NULL,
  test_code text,
  unit_price numeric(15, 2) NOT NULL DEFAULT 0,
  result_value text,
  reference_range text,
  result_status text NOT NULL DEFAULT 'pending' CHECK (result_status IN ('pending', 'normal', 'abnormal', 'critical')),
  technician_notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lab_order_items_order ON public.lab_order_items(lab_order_id);

-- 6. Keep updated_at honest on every editable healthcare header.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'set_updated_at'
      AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE $func$
      CREATE OR REPLACE FUNCTION public.set_updated_at()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $inner$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $inner$;
    $func$;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_patients_updated_at ON public.patients;
CREATE TRIGGER trg_patients_updated_at
  BEFORE UPDATE ON public.patients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_patient_visits_updated_at ON public.patient_visits;
CREATE TRIGGER trg_patient_visits_updated_at
  BEFORE UPDATE ON public.patient_visits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_clinical_consultations_updated_at ON public.clinical_consultations;
CREATE TRIGGER trg_clinical_consultations_updated_at
  BEFORE UPDATE ON public.clinical_consultations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_prescriptions_updated_at ON public.prescriptions;
CREATE TRIGGER trg_prescriptions_updated_at
  BEFORE UPDATE ON public.prescriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_lab_orders_updated_at ON public.lab_orders;
CREATE TRIGGER trg_lab_orders_updated_at
  BEFORE UPDATE ON public.lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Enable RLS and apply the role-aware financial helper policies.
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "patients_select" ON public.patients;
DROP POLICY IF EXISTS "patients_write" ON public.patients;
CREATE POLICY "patients_select" ON public.patients FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "patients_write" ON public.patients FOR ALL TO authenticated USING (public.can_write_financial_data(business_id)) WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "patient_visits_select" ON public.patient_visits;
DROP POLICY IF EXISTS "patient_visits_write" ON public.patient_visits;
CREATE POLICY "patient_visits_select" ON public.patient_visits FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "patient_visits_write" ON public.patient_visits FOR ALL TO authenticated USING (public.can_write_financial_data(business_id)) WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "clinical_consultations_select" ON public.clinical_consultations;
DROP POLICY IF EXISTS "clinical_consultations_write" ON public.clinical_consultations;
CREATE POLICY "clinical_consultations_select" ON public.clinical_consultations FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "clinical_consultations_write" ON public.clinical_consultations FOR ALL TO authenticated USING (public.can_write_financial_data(business_id)) WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "prescriptions_select" ON public.prescriptions;
DROP POLICY IF EXISTS "prescriptions_write" ON public.prescriptions;
CREATE POLICY "prescriptions_select" ON public.prescriptions FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "prescriptions_write" ON public.prescriptions FOR ALL TO authenticated USING (public.can_write_financial_data(business_id)) WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "prescription_items_select" ON public.prescription_items;
DROP POLICY IF EXISTS "prescription_items_write" ON public.prescription_items;
CREATE POLICY "prescription_items_select" ON public.prescription_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.prescriptions p WHERE p.id = prescription_items.prescription_id AND public.can_read_financial_data(p.business_id))
);
CREATE POLICY "prescription_items_write" ON public.prescription_items FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.prescriptions p WHERE p.id = prescription_items.prescription_id AND public.can_write_financial_data(p.business_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.prescriptions p WHERE p.id = prescription_items.prescription_id AND public.can_write_financial_data(p.business_id))
);

DROP POLICY IF EXISTS "lab_orders_select" ON public.lab_orders;
DROP POLICY IF EXISTS "lab_orders_write" ON public.lab_orders;
CREATE POLICY "lab_orders_select" ON public.lab_orders FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "lab_orders_write" ON public.lab_orders FOR ALL TO authenticated USING (public.can_write_financial_data(business_id)) WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "lab_order_items_select" ON public.lab_order_items;
DROP POLICY IF EXISTS "lab_order_items_write" ON public.lab_order_items;
CREATE POLICY "lab_order_items_select" ON public.lab_order_items FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.lab_orders lo WHERE lo.id = lab_order_items.lab_order_id AND public.can_read_financial_data(lo.business_id))
);
CREATE POLICY "lab_order_items_write" ON public.lab_order_items FOR ALL TO authenticated USING (
  EXISTS (SELECT 1 FROM public.lab_orders lo WHERE lo.id = lab_order_items.lab_order_id AND public.can_write_financial_data(lo.business_id))
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.lab_orders lo WHERE lo.id = lab_order_items.lab_order_id AND public.can_write_financial_data(lo.business_id))
);

-- 8. Table privileges. RLS still decides which rows a member may touch.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_visits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_consultations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prescriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prescription_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_order_items TO authenticated;
