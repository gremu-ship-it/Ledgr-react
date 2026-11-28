-- ────────────────────────────────────────────────────────────────────────────
-- Hospital clinical patient flow, radiology / imaging station and the
-- telemedicine virtual clinic.
--
-- The clinic foundation already gave us patient_visits with a four-value
-- visit_type and an eight-value stage. This migration widens both vocabularies
-- in place (in_person/telemedicine/home_visit and the diagnostic stages) and
-- adds the queue, acuity, telemedicine and diagnostic-completion columns the
-- hospital flow engine needs. Radiology orders and treatment-room procedures
-- are new tenant-scoped tables, billed through the existing visit bill.
-- ────────────────────────────────────────────────────────────────────────────

-- 1. Patient visit flow columns -------------------------------------------------
ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS queue_token text;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS acuity_level text;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS meeting_url text;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS telemedicine_status text NOT NULL DEFAULT 'waiting';

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS telemedicine_started_at timestamptz;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS telemedicine_ended_at timestamptz;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS telemedicine_notes text;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS has_pending_lab boolean NOT NULL DEFAULT false;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS has_pending_radiology boolean NOT NULL DEFAULT false;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS has_pending_procedure boolean NOT NULL DEFAULT false;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS results_ready_for_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.patient_visits
  ADD COLUMN IF NOT EXISTS results_ready_at timestamptz;

-- Widen visit_type without losing the visit types the clinic already uses.
ALTER TABLE public.patient_visits
  DROP CONSTRAINT IF EXISTS patient_visits_visit_type_check;
ALTER TABLE public.patient_visits
  ADD CONSTRAINT patient_visits_visit_type_check
  CHECK (
    visit_type IN (
      'outpatient',
      'emergency',
      'follow_up',
      'routine_checkup',
      'in_person',
      'telemedicine',
      'home_visit'
    )
  );

-- Widen the stage ladder with the diagnostic and admission stages used by the
-- hospital flow engine. Existing rows remain valid.
ALTER TABLE public.patient_visits
  DROP CONSTRAINT IF EXISTS patient_visits_stage_check;
ALTER TABLE public.patient_visits
  ADD CONSTRAINT patient_visits_stage_check
  CHECK (
    stage IN (
      'registered',
      'triaged',
      'with_doctor',
      'in_lab',
      'in_radiology',
      'in_diagnostics',
      'results_review',
      'at_pharmacy',
      'in_billing',
      'admitted',
      'completed',
      'cancelled'
    )
  );

ALTER TABLE public.patient_visits
  DROP CONSTRAINT IF EXISTS patient_visits_acuity_level_check;
ALTER TABLE public.patient_visits
  ADD CONSTRAINT patient_visits_acuity_level_check
  CHECK (
    acuity_level IS NULL
    OR acuity_level IN ('emergency', 'urgent', 'priority', 'routine')
  );

ALTER TABLE public.patient_visits
  DROP CONSTRAINT IF EXISTS patient_visits_telemedicine_status_check;
ALTER TABLE public.patient_visits
  ADD CONSTRAINT patient_visits_telemedicine_status_check
  CHECK (
    telemedicine_status IN (
      'waiting',
      'link_sent',
      'in_call',
      'completed',
      'cancelled'
    )
  );

-- One queue token per business per visit day. The application allocates the
-- next Q-NNN under the visit-number pattern; this unique index makes a lost
-- race visible instead of giving two patients the same token.
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_visits_queue_token
  ON public.patient_visits (business_id, visit_date, queue_token)
  WHERE queue_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_visits_queue
  ON public.patient_visits (business_id, stage, visit_date, queue_token);

CREATE INDEX IF NOT EXISTS idx_patient_visits_acuity
  ON public.patient_visits (business_id, acuity_level, stage)
  WHERE acuity_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patient_visits_results_review
  ON public.patient_visits (business_id, results_ready_for_review)
  WHERE results_ready_for_review = true;

CREATE INDEX IF NOT EXISTS idx_patient_visits_telemedicine
  ON public.patient_visits (business_id, telemedicine_status, visit_date)
  WHERE visit_type = 'telemedicine';

-- 2. Radiology / imaging orders ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.radiology_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL,
  order_number text NOT NULL,
  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  urgency text NOT NULL DEFAULT 'routine'
    CHECK (urgency IN ('routine', 'urgent', 'stat')),
  clinical_indication text,
  ordered_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_radiology_orders_business_number UNIQUE (business_id, order_number)
);

CREATE INDEX IF NOT EXISTS idx_radiology_orders_visit
  ON public.radiology_orders (business_id, visit_id);

CREATE INDEX IF NOT EXISTS idx_radiology_orders_worklist
  ON public.radiology_orders (business_id, status, urgency, ordered_at);

CREATE INDEX IF NOT EXISTS idx_radiology_orders_patient
  ON public.radiology_orders (business_id, patient_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.radiology_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radiology_order_id uuid NOT NULL REFERENCES public.radiology_orders(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  modality text NOT NULL
    CHECK (modality IN ('xray', 'ultrasound', 'ct', 'mri', 'ecg', 'echo', 'mammography', 'other')),
  procedure_name text NOT NULL CHECK (length(btrim(procedure_name)) > 0),
  body_site text,
  unit_price numeric(15, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scheduled', 'in_progress', 'completed', 'cancelled')),
  findings text,
  impression text,
  recommendations text,
  image_urls text[] NOT NULL DEFAULT '{}',
  technician_id uuid,
  radiologist_id uuid,
  performed_at timestamptz,
  reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_radiology_items_order
  ON public.radiology_order_items (radiology_order_id);

CREATE INDEX IF NOT EXISTS idx_radiology_items_worklist
  ON public.radiology_order_items (business_id, status, modality, created_at);

-- 3. Treatment-room / minor procedure orders ----------------------------------
CREATE TABLE IF NOT EXISTS public.clinical_procedure_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  visit_id uuid NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
  patient_id uuid NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  doctor_id uuid NOT NULL,
  procedure_code text,
  procedure_name text NOT NULL CHECK (length(btrim(procedure_name)) > 0),
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('minor_surgery', 'wound_care', 'injection', 'dressing', 'diagnostic', 'other')),
  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'in_progress', 'completed', 'cancelled')),
  unit_price numeric(15, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  notes text,
  performed_by uuid,
  performed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_procedure_orders_visit
  ON public.clinical_procedure_orders (business_id, visit_id);

CREATE INDEX IF NOT EXISTS idx_procedure_orders_worklist
  ON public.clinical_procedure_orders (business_id, status, created_at);

-- 4. updated_at triggers -------------------------------------------------------
DROP TRIGGER IF EXISTS trg_radiology_orders_updated_at ON public.radiology_orders;
CREATE TRIGGER trg_radiology_orders_updated_at
  BEFORE UPDATE ON public.radiology_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_radiology_order_items_updated_at ON public.radiology_order_items;
CREATE TRIGGER trg_radiology_order_items_updated_at
  BEFORE UPDATE ON public.radiology_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_clinical_procedure_orders_updated_at ON public.clinical_procedure_orders;
CREATE TRIGGER trg_clinical_procedure_orders_updated_at
  BEFORE UPDATE ON public.clinical_procedure_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Row-level security --------------------------------------------------------
ALTER TABLE public.radiology_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radiology_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinical_procedure_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "radiology_orders_select" ON public.radiology_orders;
DROP POLICY IF EXISTS "radiology_orders_write" ON public.radiology_orders;
CREATE POLICY "radiology_orders_select" ON public.radiology_orders
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
CREATE POLICY "radiology_orders_write" ON public.radiology_orders
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "radiology_order_items_select" ON public.radiology_order_items;
DROP POLICY IF EXISTS "radiology_order_items_write" ON public.radiology_order_items;
CREATE POLICY "radiology_order_items_select" ON public.radiology_order_items
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
CREATE POLICY "radiology_order_items_write" ON public.radiology_order_items
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "clinical_procedure_orders_select" ON public.clinical_procedure_orders;
DROP POLICY IF EXISTS "clinical_procedure_orders_write" ON public.clinical_procedure_orders;
CREATE POLICY "clinical_procedure_orders_select" ON public.clinical_procedure_orders
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));
CREATE POLICY "clinical_procedure_orders_write" ON public.clinical_procedure_orders
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

-- 6. Table privileges. RLS decides which rows a member may touch. ------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.radiology_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.radiology_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinical_procedure_orders TO authenticated;
