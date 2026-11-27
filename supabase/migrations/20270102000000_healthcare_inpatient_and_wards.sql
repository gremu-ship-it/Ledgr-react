-- ============================================================================
-- HEALTHCARE PHASE 4: WARDS, BEDS, INPATIENT ADT & CARE LOGS
-- ============================================================================
-- Every table is tenant-scoped on business_id and uses the shared financial
-- authority helpers: can_read_financial_data for SELECT and
-- can_write_financial_data for INSERT/UPDATE/DELETE.
--
-- Bed lifecycle:
--   available -> occupied (admission)
--   occupied  -> cleaning  + active allocation released (discharge/transfer)
--   cleaning  -> available (housekeeping)
--   any       -> maintenance (facilities), maintenance -> available
-- ============================================================================

-- ── 1. Hospital wards ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hospital_wards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ward_type TEXT NOT NULL CHECK (ward_type IN (
    'general', 'semi_private', 'private', 'vip', 'icu',
    'high_dependency', 'isolation', 'maternity', 'pediatric',
    'surgical', 'emergency_observation'
  )),
  floor_number TEXT,
  gender_restriction TEXT NOT NULL DEFAULT 'mixed'
    CHECK (gender_restriction IN ('male_only', 'female_only', 'mixed', 'pediatric')),
  total_capacity INT NOT NULL DEFAULT 1 CHECK (total_capacity > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ward_name UNIQUE (business_id, name)
);

-- ── 2. Physical beds ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hospital_beds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  ward_id UUID NOT NULL REFERENCES public.hospital_wards(id) ON DELETE CASCADE,
  bed_number TEXT NOT NULL,
  daily_rate NUMERIC(12,2) NOT NULL CHECK (daily_rate >= 0),
  hourly_rate NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (hourly_rate >= 0),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'cleaning', 'maintenance', 'reserved')),
  current_admission_id UUID,
  amenities TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ward_bed UNIQUE (business_id, ward_id, bed_number),
  CONSTRAINT ck_bed_occupancy_state
    CHECK ((status = 'occupied') = (current_admission_id IS NOT NULL))
);

-- ── 3. Patient admissions (ADT core) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.patient_admissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  admission_number TEXT NOT NULL,
  admitting_doctor_id UUID NOT NULL REFERENCES auth.users(id),
  attending_doctor_id UUID NOT NULL REFERENCES auth.users(id),
  admission_reason TEXT NOT NULL,
  admitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expected_discharge_date DATE,
  discharged_at TIMESTAMPTZ,
  discharge_summary TEXT,
  discharge_condition TEXT CHECK (discharge_condition IN (
    'recovered', 'improved', 'stable', 'referred',
    'discharged_against_medical_advice', 'deceased'
  )),
  status TEXT NOT NULL DEFAULT 'admitted'
    CHECK (status IN ('admitted', 'discharged', 'transferred', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_admission_number UNIQUE (business_id, admission_number)
);

-- Circular reference added after both tables exist. Keep the block idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fk_bed_current_admission'
       AND conrelid = 'public.hospital_beds'::regclass
  ) THEN
    ALTER TABLE public.hospital_beds
      ADD CONSTRAINT fk_bed_current_admission
      FOREIGN KEY (current_admission_id)
      REFERENCES public.patient_admissions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 4. Bed allocations (transfer & stay history) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.bed_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  admission_id UUID NOT NULL REFERENCES public.patient_admissions(id) ON DELETE CASCADE,
  bed_id UUID NOT NULL REFERENCES public.hospital_beds(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_at TIMESTAMPTZ,
  daily_rate_applied NUMERIC(12,2) NOT NULL CHECK (daily_rate_applied >= 0),
  billing_mode TEXT NOT NULL DEFAULT 'daily' CHECK (billing_mode IN ('daily', 'hourly')),
  transfer_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_allocation_release_order CHECK (released_at IS NULL OR released_at >= assigned_at)
);

-- ── 5. Inpatient care & daily rounds ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inpatient_care_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  admission_id UUID NOT NULL REFERENCES public.patient_admissions(id) ON DELETE CASCADE,
  recorded_by UUID NOT NULL REFERENCES auth.users(id),
  log_type TEXT NOT NULL CHECK (log_type IN (
    'doctor_round', 'nurse_note', 'dietary', 'physiotherapy', 'incident'
  )),
  note TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. Inpatient billing policy on the payer directory ──────────────────────
-- A daily bed cap lets an HMO limit accommodation cover; the differential on a
-- private/upgraded room can be charged to the patient. NULL means no cap.
ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS bed_daily_cap NUMERIC(12,2)
    CHECK (bed_daily_cap IS NULL OR bed_daily_cap >= 0);
ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS room_upgrade_charge_to_patient BOOLEAN NOT NULL DEFAULT true;

-- Accommodation is a first-class claim line category.
ALTER TABLE public.insurance_claim_items
  DROP CONSTRAINT IF EXISTS insurance_claim_items_service_category_check;
ALTER TABLE public.insurance_claim_items
  ADD CONSTRAINT insurance_claim_items_service_category_check
  CHECK (service_category IN ('consultation', 'medication', 'laboratory', 'procedure', 'accommodation', 'other'));

-- ── 7. Indexes ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_hospital_wards_business
  ON public.hospital_wards (business_id, is_active, name);
CREATE INDEX IF NOT EXISTS idx_beds_ward
  ON public.hospital_beds (business_id, ward_id, status);
CREATE INDEX IF NOT EXISTS idx_beds_current_admission
  ON public.hospital_beds (current_admission_id)
  WHERE current_admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admissions_patient
  ON public.patient_admissions (business_id, patient_id, status);
CREATE INDEX IF NOT EXISTS idx_admissions_visit
  ON public.patient_admissions (business_id, visit_id, status);
-- One open admission per patient, and one admission may occupy only one bed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_patient_admission
  ON public.patient_admissions (business_id, patient_id)
  WHERE status = 'admitted';
CREATE UNIQUE INDEX IF NOT EXISTS uq_bed_current_admission
  ON public.hospital_beds (current_admission_id)
  WHERE current_admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_allocations_admission
  ON public.bed_allocations (business_id, admission_id, assigned_at);
-- A patient can have at most one open bed allocation.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_bed_allocation
  ON public.bed_allocations (business_id, admission_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_care_logs_admission
  ON public.inpatient_care_logs (business_id, admission_id, recorded_at DESC);

-- ── 8. updated_at triggers ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_hospital_wards_updated_at ON public.hospital_wards;
CREATE TRIGGER trg_hospital_wards_updated_at
  BEFORE UPDATE ON public.hospital_wards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_hospital_beds_updated_at ON public.hospital_beds;
CREATE TRIGGER trg_hospital_beds_updated_at
  BEFORE UPDATE ON public.hospital_beds
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_patient_admissions_updated_at ON public.patient_admissions;
CREATE TRIGGER trg_patient_admissions_updated_at
  BEFORE UPDATE ON public.patient_admissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 9. Tenant-integrity guards ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.healthcare_assert_bed_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- The circular ON DELETE SET NULL clears the admission id when a visit,
  -- patient or admission is deleted. Move the now-unreferenced bed to
  -- housekeeping so the occupancy check constraint stays satisfied.
  IF NEW.current_admission_id IS NULL AND NEW.status = 'occupied' THEN
    NEW.status := 'cleaning';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hospital_wards w
     WHERE w.id = NEW.ward_id AND w.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The bed ward must belong to the same business.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.current_admission_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.patient_admissions a
     WHERE a.id = NEW.current_admission_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The current admission must belong to the same business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hospital_bed_scope ON public.hospital_beds;
CREATE TRIGGER trg_hospital_bed_scope
  BEFORE INSERT OR UPDATE ON public.hospital_beds
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_bed_scope();

CREATE OR REPLACE FUNCTION public.healthcare_assert_admission_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_visits v
     WHERE v.id = NEW.visit_id
       AND v.business_id = NEW.business_id
       AND v.patient_id = NEW.patient_id
  ) THEN
    RAISE EXCEPTION 'The admission visit and patient must belong to the same business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_patient_admission_scope ON public.patient_admissions;
CREATE TRIGGER trg_patient_admission_scope
  BEFORE INSERT OR UPDATE ON public.patient_admissions
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_admission_scope();

CREATE OR REPLACE FUNCTION public.healthcare_assert_allocation_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_admissions a
     WHERE a.id = NEW.admission_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The allocation admission must belong to the same business.'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hospital_beds b
     WHERE b.id = NEW.bed_id AND b.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The allocated bed must belong to the same business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bed_allocation_scope ON public.bed_allocations;
CREATE TRIGGER trg_bed_allocation_scope
  BEFORE INSERT OR UPDATE ON public.bed_allocations
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_allocation_scope();

CREATE OR REPLACE FUNCTION public.healthcare_assert_care_log_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_admissions a
     WHERE a.id = NEW.admission_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The care-log admission must belong to the same business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inpatient_care_log_scope ON public.inpatient_care_logs;
CREATE TRIGGER trg_inpatient_care_log_scope
  BEFORE INSERT OR UPDATE ON public.inpatient_care_logs
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_care_log_scope();

-- ── 10. Admission number sequencing ────────────────────────────────────────
-- Race-safe ADM-YYYY-NNNN allocator. MAX() tolerates gaps and cancelled rows.
CREATE OR REPLACE FUNCTION public.next_admission_number(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_year integer := extract(year FROM current_date)::integer;
  v_prefix text := 'ADM-' || v_year::text || '-';
  v_next integer;
BEGIN
  IF v_user IS NOT NULL AND NOT public.can_write_financial_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorised to admit patients for this business.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':ADM:' || v_year::text, 0));

  SELECT COALESCE(MAX(
           NULLIF(regexp_replace(admission_number, '^ADM-[0-9]{4}-', ''), '')::integer
         ), 0) + 1
    INTO v_next
    FROM public.patient_admissions
   WHERE business_id = p_business_id
     AND admission_number LIKE v_prefix || '%'
     AND admission_number ~ '^ADM-[0-9]{4}-[0-9]+$';

  RETURN v_prefix || lpad(v_next::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_admission_number(uuid) IS
  'Race-safe ADM-YYYY-NNNN allocator for inpatient admissions.';

-- ── 11. Row-level security ──────────────────────────────────────────────────
ALTER TABLE public.hospital_wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bed_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inpatient_care_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hospital_wards_select" ON public.hospital_wards;
CREATE POLICY "hospital_wards_select" ON public.hospital_wards
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
DROP POLICY IF EXISTS "hospital_wards_modify" ON public.hospital_wards;
CREATE POLICY "hospital_wards_modify" ON public.hospital_wards
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "hospital_beds_select" ON public.hospital_beds;
CREATE POLICY "hospital_beds_select" ON public.hospital_beds
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
DROP POLICY IF EXISTS "hospital_beds_modify" ON public.hospital_beds;
CREATE POLICY "hospital_beds_modify" ON public.hospital_beds
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "patient_admissions_select" ON public.patient_admissions;
CREATE POLICY "patient_admissions_select" ON public.patient_admissions
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
DROP POLICY IF EXISTS "patient_admissions_modify" ON public.patient_admissions;
CREATE POLICY "patient_admissions_modify" ON public.patient_admissions
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "bed_allocations_select" ON public.bed_allocations;
CREATE POLICY "bed_allocations_select" ON public.bed_allocations
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
DROP POLICY IF EXISTS "bed_allocations_modify" ON public.bed_allocations;
CREATE POLICY "bed_allocations_modify" ON public.bed_allocations
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "inpatient_care_logs_select" ON public.inpatient_care_logs;
CREATE POLICY "inpatient_care_logs_select" ON public.inpatient_care_logs
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
DROP POLICY IF EXISTS "inpatient_care_logs_modify" ON public.inpatient_care_logs;
CREATE POLICY "inpatient_care_logs_modify" ON public.inpatient_care_logs
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

-- ── 12. Grants ──────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_wards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_beds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_admissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bed_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inpatient_care_logs TO authenticated;
REVOKE ALL ON FUNCTION public.next_admission_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_admission_number(uuid) TO authenticated;
