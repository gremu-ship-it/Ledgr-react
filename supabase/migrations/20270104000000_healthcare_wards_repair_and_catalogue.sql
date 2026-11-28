-- ============================================================================
-- HEALTHCARE: WARD/ADT SCHEMA REPAIR + DRUG & SERVICE CATALOGUE
-- ============================================================================
-- The production Ledgr project received an early hand-rolled version of the
-- ward tables before the Phase 4 migration was recorded in
-- supabase_migrations.schema_migrations. That left hospital_beds without
-- current_admission_id/hourly_rate/amenities and left patient_admissions,
-- bed_allocations and inpatient_care_logs absent, so both the ward board and
-- the inpatient registry failed to load.
--
-- This migration is deliberately idempotent and additive:
--   * repairs legacy hospital_beds columns and resets orphaned occupancy,
--   * creates the missing ADT tables, guards, policies and allocator,
--   * gives products the healthcare item vocabulary used by the new
--     Drug & Service Catalogue (drug / supply / service / product).
--
-- It is safe to run on a database that already applied 20270102 because every
-- object is created with IF NOT EXISTS and constraints are guarded.
-- ============================================================================

-- ── 1. Repair the legacy physical-bed table ──────────────────────────────────
ALTER TABLE public.hospital_beds
  ADD COLUMN IF NOT EXISTS hourly_rate numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE public.hospital_beds
  ADD COLUMN IF NOT EXISTS amenities text[] DEFAULT '{}'::text[];
ALTER TABLE public.hospital_beds
  ADD COLUMN IF NOT EXISTS current_admission_id uuid;

-- An early schema stored a required bed_type on the physical bed. Canonical
-- healthcare inserts do not know that vocabulary; keep the legacy column but
-- stop it from blocking ward creation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'hospital_beds'
       AND column_name = 'bed_type'
       AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.hospital_beds ALTER COLUMN bed_type DROP NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hospital_beds_hourly_rate_check'
       AND conrelid = 'public.hospital_beds'::regclass
  ) THEN
    ALTER TABLE public.hospital_beds
      ADD CONSTRAINT hospital_beds_hourly_rate_check CHECK (hourly_rate >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hospital_beds_status_check'
       AND conrelid = 'public.hospital_beds'::regclass
  ) THEN
    ALTER TABLE public.hospital_beds
      ADD CONSTRAINT hospital_beds_status_check
      CHECK (status IN ('available', 'occupied', 'cleaning', 'maintenance', 'reserved'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_ward_name'
       AND conrelid = 'public.hospital_wards'::regclass
  ) THEN
    ALTER TABLE public.hospital_wards
      ADD CONSTRAINT uq_ward_name UNIQUE (business_id, name);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'uq_ward_bed'
       AND conrelid = 'public.hospital_beds'::regclass
  ) THEN
    ALTER TABLE public.hospital_beds
      ADD CONSTRAINT uq_ward_bed UNIQUE (business_id, ward_id, bed_number);
  END IF;
END $$;

-- Legacy "occupied" beds had no admission row to point at. Housekeeping is the
-- safe state until a real admission is recorded after this migration.
UPDATE public.hospital_beds
   SET status = 'cleaning'
 WHERE status = 'occupied'
   AND current_admission_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'ck_bed_occupancy_state'
       AND conrelid = 'public.hospital_beds'::regclass
  ) THEN
    ALTER TABLE public.hospital_beds
      ADD CONSTRAINT ck_bed_occupancy_state
      CHECK ((status = 'occupied') = (current_admission_id IS NOT NULL));
  END IF;
END $$;

-- ── 2. ADT core tables missing from the live project ────────────────────────
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

-- ── 3. Payer accommodation policy and claim category ────────────────────────
ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS bed_daily_cap NUMERIC(12,2)
    CHECK (bed_daily_cap IS NULL OR bed_daily_cap >= 0);
ALTER TABLE public.insurance_providers
  ADD COLUMN IF NOT EXISTS room_upgrade_charge_to_patient BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.insurance_claim_items
  DROP CONSTRAINT IF EXISTS insurance_claim_items_service_category_check;
ALTER TABLE public.insurance_claim_items
  ADD CONSTRAINT insurance_claim_items_service_category_check
  CHECK (service_category IN (
    'consultation', 'medication', 'laboratory', 'procedure', 'accommodation', 'other'
  ));

-- ── 4. Indexes ──────────────────────────────────────────────────────────────
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
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_patient_admission
  ON public.patient_admissions (business_id, patient_id)
  WHERE status = 'admitted';
CREATE UNIQUE INDEX IF NOT EXISTS uq_bed_current_admission
  ON public.hospital_beds (current_admission_id)
  WHERE current_admission_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_allocations_admission
  ON public.bed_allocations (business_id, admission_id, assigned_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_bed_allocation
  ON public.bed_allocations (business_id, admission_id)
  WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_care_logs_admission
  ON public.inpatient_care_logs (business_id, admission_id, recorded_at DESC);

-- ── 5. updated_at triggers ──────────────────────────────────────────────────
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

-- ── 6. Tenant-integrity guards ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.healthcare_assert_bed_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

-- ── 7. Admission number sequencing ─────────────────────────────────────────
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

-- ── 8. Row-level security ──────────────────────────────────────────────────
ALTER TABLE public.hospital_wards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hospital_beds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bed_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inpatient_care_logs ENABLE ROW LEVEL SECURITY;

-- Remove the blanket authenticated-tenant policies left by the early schema.
DROP POLICY IF EXISTS "tenant_isolation_hospital_wards" ON public.hospital_wards;
DROP POLICY IF EXISTS "tenant_isolation_hospital_beds" ON public.hospital_beds;

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

-- ── 9. Grants ──────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_wards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hospital_beds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_admissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bed_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inpatient_care_logs TO authenticated;
REVOKE ALL ON FUNCTION public.next_admission_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_admission_number(uuid) TO authenticated;

-- ── 10. Healthcare catalogue vocabulary on the shared products master ──────
-- products is already tenant-scoped and covered by products_* RLS. Healthcare
-- reuses it so a drug prescribed in the consultation room is the same record
-- received into pharmacy stock and sold on a patient invoice.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS healthcare_item_type text;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_dispensable boolean NOT NULL DEFAULT false;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS strength text;
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS dosage_form text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'products_healthcare_item_type_check'
       AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_healthcare_item_type_check
      CHECK (
        healthcare_item_type IS NULL
        OR healthcare_item_type IN ('drug', 'supply', 'service', 'product')
      );
  END IF;
END $$;

-- Existing service master records should be visible in the healthcare
-- catalogue immediately, without touching stock-tracked merchandise.
UPDATE public.products
   SET healthcare_item_type = 'service',
       is_dispensable = false
 WHERE product_type = 'service'
   AND healthcare_item_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_healthcare_catalogue
  ON public.products (business_id, healthcare_item_type, is_active)
  WHERE healthcare_item_type IS NOT NULL;

COMMENT ON COLUMN public.products.healthcare_item_type IS
  'Healthcare catalogue kind: drug, supply, service or product. NULL means a general inventory item.';
COMMENT ON COLUMN public.products.is_dispensable IS
  'True when the item can be received into medication batches and dispensed against a prescription.';
