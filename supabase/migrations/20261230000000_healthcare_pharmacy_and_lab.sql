-- 20261230 healthcare_pharmacy_and_lab
-- Pharmacy dispensary (FEFO batches + dispensing audit trail) and laboratory
-- diagnostics (specimen tracking + reference ranges) for the HEALTHCARE
-- operating model introduced in 20261229_healthcare_clinic_foundation.
--
-- Design notes
--  * Every new table carries business_id and tenant RLS
--    (can_read_financial_data / can_write_financial_data), matching the Phase 1
--    clinic tables.
--  * Stock is held per medication batch so FEFO dispensing is possible. The
--    unique (business_id, medication_name, batch_number) key stops the same
--    delivery being received twice, and quantity_on_hand >= 0 is enforced by
--    the database, not just the service layer.
--  * dispense_prescription_item() is the only write path for dispensing. It
--    locks the batch row, refuses expired / under-stocked batches, decrements
--    stock, writes the audit row, accumulates the item's dispensed quantity
--    and, once every item is fully out, closes the prescription and moves the
--    visit to in_billing. This keeps the browser from ever holding a stale
--    quantity and lets one line be split across FEFO batches.
--  * lab_specimens is unique per business barcode. lab_order_items gains the
--    business_id / specimen link and numeric reference bounds used by the
--    result classification in labService.

-- ────────────────────────────────────────────────────────────────────────────
-- 0. Defensive additions to Phase 1 clinic tables
-- ────────────────────────────────────────────────────────────────────────────

-- A prescription can now be partly out of the dispensary, so the Phase 1
-- pending/dispensed/cancelled vocabulary needs a partial state. Audit columns
-- are added at the same time so the pharmacy log has a real timestamp.
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS dispensed_at timestamptz;
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS dispensed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.prescription_items
  ADD COLUMN IF NOT EXISTS dispensed_at timestamptz;
ALTER TABLE public.prescription_items
  ADD COLUMN IF NOT EXISTS quantity_dispensed numeric(14, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.prescriptions
  DROP CONSTRAINT IF EXISTS prescriptions_status_check;
ALTER TABLE public.prescriptions
  ADD CONSTRAINT prescriptions_status_check
  CHECK (status IN ('pending', 'partially_dispensed', 'dispensed', 'cancelled'));

-- Numeric, multi-tenant result metadata for laboratory tests.
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS business_id uuid;
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS unit_of_measure text;
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS min_normal numeric(12, 4);
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS max_normal numeric(12, 4);
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS critical_low numeric(12, 4);
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS critical_high numeric(12, 4);
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS technician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill the tenant from the parent order so NOT NULL can be applied safely.
UPDATE public.lab_order_items AS item
   SET business_id = lab.business_id
  FROM public.lab_orders AS lab
 WHERE item.lab_order_id = lab.id
   AND item.business_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.lab_order_items
     WHERE business_id IS NULL
  ) THEN
    RAISE EXCEPTION 'lab_order_items has rows without a lab order to inherit its business_id'
      USING ERRCODE = '23502';
  END IF;
END $$;

ALTER TABLE public.lab_order_items
  ALTER COLUMN business_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'lab_order_items_business_id_fkey'
       AND conrelid = 'public.lab_order_items'::regclass
  ) THEN
    ALTER TABLE public.lab_order_items
      ADD CONSTRAINT lab_order_items_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES public.businesses(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Laboratory order headers track verification (the Phase 1 table only had
-- created_at, so the station cannot tell a verified report from a draft).
ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.lab_orders
  ADD COLUMN IF NOT EXISTS technician_notes text;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Pharmacy stock batches (FEFO)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.medication_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  medication_name text NOT NULL CHECK (length(btrim(medication_name)) > 0),
  batch_number text NOT NULL CHECK (length(btrim(batch_number)) > 0),
  quantity_received numeric(14, 2) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
  quantity_on_hand numeric(14, 2) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  unit_cost numeric(14, 2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  expiry_date date NOT NULL,
  received_date date NOT NULL DEFAULT CURRENT_DATE,
  supplier_name text,
  storage_location text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medication_batches_unique_batch UNIQUE (business_id, medication_name, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_medication_batches_business_expiry
  ON public.medication_batches (business_id, expiry_date);
-- FEFO: available stock for a drug is read in expiry order.
CREATE INDEX IF NOT EXISTS idx_medication_batches_fefo
  ON public.medication_batches (business_id, medication_name, expiry_date);
CREATE INDEX IF NOT EXISTS idx_medication_batches_product
  ON public.medication_batches (business_id, product_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Dispensing audit trail
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dispensation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  prescription_item_id uuid NOT NULL REFERENCES public.prescription_items(id) ON DELETE RESTRICT,
  batch_id uuid NOT NULL REFERENCES public.medication_batches(id) ON DELETE RESTRICT,
  quantity_dispensed numeric(14, 2) NOT NULL CHECK (quantity_dispensed > 0),
  unit_price numeric(14, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  dispensed_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE RESTRICT,
  dispensed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX IF NOT EXISTS idx_dispensation_records_business_time
  ON public.dispensation_records (business_id, dispensed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispensation_records_item
  ON public.dispensation_records (prescription_item_id);
CREATE INDEX IF NOT EXISTS idx_dispensation_records_batch
  ON public.dispensation_records (batch_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Laboratory specimens
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lab_specimens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  lab_order_id uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  specimen_barcode text NOT NULL CHECK (length(btrim(specimen_barcode)) > 0),
  specimen_type text NOT NULL CHECK (specimen_type IN (
    'blood', 'urine', 'stool', 'sputum', 'swab', 'tissue', 'other'
  )),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'collected', 'in_analysis', 'rejected'
  )),
  collected_at timestamptz,
  collected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  rejection_reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lab_specimens_unique_barcode UNIQUE (business_id, specimen_barcode)
);

CREATE INDEX IF NOT EXISTS idx_lab_specimens_business_status
  ON public.lab_specimens (business_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lab_specimens_order
  ON public.lab_specimens (lab_order_id);

ALTER TABLE public.lab_order_items
  ADD COLUMN IF NOT EXISTS specimen_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'lab_order_items_specimen_id_fkey'
       AND conrelid = 'public.lab_order_items'::regclass
  ) THEN
    ALTER TABLE public.lab_order_items
      ADD CONSTRAINT lab_order_items_specimen_id_fkey
      FOREIGN KEY (specimen_id) REFERENCES public.lab_specimens(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lab_order_items_specimen
  ON public.lab_order_items (business_id, specimen_id);
CREATE INDEX IF NOT EXISTS idx_lab_order_items_status
  ON public.lab_order_items (business_id, result_status);

-- ────────────────────────────────────────────────────────────────────────────
-- 3a. Tenant guards for the child rows of a laboratory order
-- ────────────────────────────────────────────────────────────────────────────

-- Every lab item must inherit its tenant from the order, and a specimen may
-- never be attached to another tenant's order. The app sets both explicitly;
-- these guards make a missed column or a hand-crafted request fail closed.
CREATE OR REPLACE FUNCTION public.healthcare_lab_item_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_parent_business uuid;
BEGIN
  SELECT business_id INTO v_parent_business
    FROM public.lab_orders
   WHERE id = NEW.lab_order_id;

  IF v_parent_business IS NULL THEN
    RAISE EXCEPTION 'Laboratory order % was not found.', NEW.lab_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF NEW.business_id IS NULL THEN
    NEW.business_id := v_parent_business;
  ELSIF NEW.business_id <> v_parent_business THEN
    RAISE EXCEPTION 'Laboratory item tenant does not match its order.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lab_order_items_tenant ON public.lab_order_items;
CREATE TRIGGER trg_lab_order_items_tenant
  BEFORE INSERT OR UPDATE ON public.lab_order_items
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_lab_item_guard();

CREATE OR REPLACE FUNCTION public.healthcare_lab_specimen_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_parent_business uuid;
BEGIN
  SELECT business_id INTO v_parent_business
    FROM public.lab_orders
   WHERE id = NEW.lab_order_id;

  IF v_parent_business IS NULL THEN
    RAISE EXCEPTION 'Laboratory order % was not found.', NEW.lab_order_id
      USING ERRCODE = 'P0002';
  END IF;
  IF NEW.business_id IS NULL OR NEW.business_id <> v_parent_business THEN
    RAISE EXCEPTION 'Specimen tenant does not match its order.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_lab_specimens_tenant ON public.lab_specimens;
CREATE TRIGGER trg_lab_specimens_tenant
  BEFORE INSERT OR UPDATE ON public.lab_specimens
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_lab_specimen_guard();

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Numbering helpers
-- ────────────────────────────────────────────────────────────────────────────

-- Next SMP-YYYY-NNNN barcode for the business. Security definer so the sequence
-- can see every specimen of the tenant without leaking rows; still scoped to the
-- caller's membership.
CREATE OR REPLACE FUNCTION public.next_specimen_barcode(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_prefix text := 'SMP-' || to_char(CURRENT_DATE, 'YYYY') || '-';
  v_next   integer;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.can_read_financial_data(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to this business.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(substring(specimen_barcode FROM '[0-9]+$')::integer), 0) + 1
    INTO v_next
    FROM public.lab_specimens
   WHERE business_id = p_business_id
     AND specimen_barcode LIKE v_prefix || '%';

  RETURN v_prefix || lpad(v_next::text, 4, '0');
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Atomic FEFO dispensing
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.dispense_prescription_item(
  p_business_id          uuid,
  p_prescription_item_id uuid,
  p_batch_id             uuid,
  p_quantity             numeric,
  p_notes                text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor              uuid := auth.uid();
  v_quantity           numeric(14, 2) := round(COALESCE(p_quantity, 0), 2);
  v_item               record;
  v_batch              record;
  v_remaining          numeric(14, 2);
  v_open_items         integer;
  v_item_dispensed     boolean;
  v_item_remaining     numeric(14, 2);
  v_prescription_state text;
  v_visit_id           uuid;
  v_visit_stage        text;
  v_dispensation_id    uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to dispense medication.' USING ERRCODE = '42501';
  END IF;
  IF p_business_id IS NULL OR p_prescription_item_id IS NULL OR p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Business, prescription item and batch are required.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.can_write_financial_data(p_business_id) THEN
    RAISE EXCEPTION 'You do not have access to dispense for this business.' USING ERRCODE = '42501';
  END IF;
  IF v_quantity <= 0 THEN
    RAISE EXCEPTION 'Dispensing quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  SELECT item.id,
         item.prescription_id,
         item.medication_name,
         item.quantity,
         item.quantity_dispensed,
         item.unit_price,
         item.is_dispensed,
         prescription.status AS prescription_status,
         prescription.visit_id
    INTO v_item
    FROM public.prescription_items AS item
    JOIN public.prescriptions AS prescription ON prescription.id = item.prescription_id
   WHERE item.id = p_prescription_item_id
     AND prescription.business_id = p_business_id
   FOR UPDATE OF item, prescription;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prescription item not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.is_dispensed THEN
    RAISE EXCEPTION 'This prescription item has already been dispensed.' USING ERRCODE = '23505';
  END IF;
  IF v_item.prescription_status NOT IN ('pending', 'partially_dispensed') THEN
    RAISE EXCEPTION 'This prescription is no longer open for dispensing.' USING ERRCODE = '22023';
  END IF;
  IF v_quantity > round(v_item.quantity - COALESCE(v_item.quantity_dispensed, 0), 2) THEN
    RAISE EXCEPTION 'Quantity % exceeds the % still owed on this line.',
      v_quantity, round(v_item.quantity - COALESCE(v_item.quantity_dispensed, 0), 2)
      USING ERRCODE = '22023';
  END IF;

  v_visit_id := v_item.visit_id;
  SELECT visit.stage INTO v_visit_stage
    FROM public.patient_visits AS visit
   WHERE visit.id = v_visit_id
     AND visit.business_id = p_business_id;

  SELECT batch.id,
         batch.medication_name,
         batch.quantity_on_hand,
         batch.expiry_date
    INTO v_batch
    FROM public.medication_batches AS batch
   WHERE batch.id = p_batch_id
     AND batch.business_id = p_business_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication batch not found.' USING ERRCODE = 'P0002';
  END IF;
  IF v_batch.expiry_date <= CURRENT_DATE THEN
    RAISE EXCEPTION 'Batch % expired on %.', v_batch.medication_name, v_batch.expiry_date
      USING ERRCODE = '22023';
  END IF;
  IF lower(btrim(v_batch.medication_name)) <> lower(btrim(v_item.medication_name)) THEN
    RAISE EXCEPTION 'Batch % does not match the prescribed medication %.',
      v_batch.medication_name, v_item.medication_name
      USING ERRCODE = '22023';
  END IF;
  IF v_batch.quantity_on_hand < v_quantity THEN
    RAISE EXCEPTION 'Insufficient stock: % on hand, % requested.',
      v_batch.quantity_on_hand, v_quantity
      USING ERRCODE = '22023';
  END IF;

  -- FEFO is enforced, not merely suggested by the UI: stock with an earlier
  -- expiry must be used before a later batch of the same medication.
  IF EXISTS (
    SELECT 1
      FROM public.medication_batches AS earlier
     WHERE earlier.business_id = p_business_id
       AND lower(btrim(earlier.medication_name)) = lower(btrim(v_item.medication_name))
       AND earlier.id <> v_batch.id
       AND earlier.quantity_on_hand > 0
       AND earlier.expiry_date > CURRENT_DATE
       AND earlier.expiry_date < v_batch.expiry_date
  ) THEN
    RAISE EXCEPTION 'Use the earliest-expiring batch of % first.', v_item.medication_name
      USING ERRCODE = '22023';
  END IF;

  v_remaining := round(v_batch.quantity_on_hand - v_quantity, 2);

  UPDATE public.medication_batches
     SET quantity_on_hand = v_remaining,
         updated_at = now()
   WHERE id = v_batch.id;

  INSERT INTO public.dispensation_records (
    business_id, prescription_item_id, batch_id, quantity_dispensed,
    unit_price, dispensed_by, notes
  ) VALUES (
    p_business_id, v_item.id, v_batch.id, v_quantity,
    COALESCE(v_item.unit_price, 0), v_actor, NULLIF(btrim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO v_dispensation_id;

  -- A line may be split across FEFO batches: only a line whose cumulative
  -- hand-outs reach the prescribed quantity is closed.
  UPDATE public.prescription_items
     SET quantity_dispensed = round(quantity_dispensed + v_quantity, 2),
         is_dispensed = (quantity_dispensed + v_quantity >= quantity),
         dispensed_at = CASE
           WHEN quantity_dispensed + v_quantity >= quantity THEN now()
           ELSE dispensed_at
         END
   WHERE id = v_item.id
   RETURNING is_dispensed, round(quantity - quantity_dispensed, 2)
     INTO v_item_dispensed, v_item_remaining;

  SELECT COUNT(*)::integer
    INTO v_open_items
    FROM public.prescription_items
   WHERE prescription_id = v_item.prescription_id
     AND is_dispensed = false;

  IF v_open_items = 0 THEN
    UPDATE public.prescriptions
       SET status = 'dispensed',
           dispensed_at = now(),
           dispensed_by = v_actor
     WHERE id = v_item.prescription_id
     RETURNING status INTO v_prescription_state;

    -- Only leave the pharmacy when no other open script on this visit still
    -- owes medication; a second pending prescription keeps the patient here.
    IF v_visit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM public.prescriptions AS other
        JOIN public.prescription_items AS other_item
          ON other_item.prescription_id = other.id
       WHERE other.visit_id = v_visit_id
         AND other.business_id = p_business_id
         AND other.id <> v_item.prescription_id
         AND other.status IN ('pending', 'partially_dispensed')
         AND other_item.is_dispensed = false
    ) THEN
      UPDATE public.patient_visits
         SET stage = 'in_billing'
       WHERE id = v_visit_id
         AND business_id = p_business_id
         AND stage NOT IN ('in_billing', 'completed', 'cancelled')
       RETURNING stage INTO v_visit_stage;
    END IF;
  ELSE
    UPDATE public.prescriptions
       SET status = 'partially_dispensed'
     WHERE id = v_item.prescription_id
     RETURNING status INTO v_prescription_state;
  END IF;

  RETURN jsonb_build_object(
    'dispensationId', v_dispensation_id,
    'prescriptionItemId', v_item.id,
    'batchId', v_batch.id,
    'quantityDispensed', v_quantity,
    'batchQuantityRemaining', v_remaining,
    'prescriptionStatus', v_prescription_state,
    'itemFullyDispensed', v_item_dispensed,
    'quantityRemainingOnItem', GREATEST(v_item_remaining, 0),
    'visitStage', COALESCE(v_visit_stage, 'at_pharmacy')
  );
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Keep updated_at honest
-- ────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_medication_batches_updated_at ON public.medication_batches;
CREATE TRIGGER trg_medication_batches_updated_at
  BEFORE UPDATE ON public.medication_batches
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_lab_specimens_updated_at ON public.lab_specimens;
CREATE TRIGGER trg_lab_specimens_updated_at
  BEFORE UPDATE ON public.lab_specimens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_lab_order_items_updated_at ON public.lab_order_items;
CREATE TRIGGER trg_lab_order_items_updated_at
  BEFORE UPDATE ON public.lab_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_lab_orders_updated_at ON public.lab_orders;
CREATE TRIGGER trg_lab_orders_updated_at
  BEFORE UPDATE ON public.lab_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Tenant RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.medication_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispensation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_specimens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "medication_batches_select" ON public.medication_batches;
DROP POLICY IF EXISTS "medication_batches_write" ON public.medication_batches;
CREATE POLICY "medication_batches_select" ON public.medication_batches
  FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "medication_batches_write" ON public.medication_batches
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "dispensation_records_select" ON public.dispensation_records;
DROP POLICY IF EXISTS "dispensation_records_write" ON public.dispensation_records;
CREATE POLICY "dispensation_records_select" ON public.dispensation_records
  FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "dispensation_records_write" ON public.dispensation_records
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "lab_specimens_select" ON public.lab_specimens;
DROP POLICY IF EXISTS "lab_specimens_write" ON public.lab_specimens;
CREATE POLICY "lab_specimens_select" ON public.lab_specimens
  FOR SELECT TO authenticated USING (public.can_read_financial_data(business_id));
CREATE POLICY "lab_specimens_write" ON public.lab_specimens
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medication_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispensation_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_specimens TO authenticated;
GRANT EXECUTE ON FUNCTION public.next_specimen_barcode(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispense_prescription_item(uuid, uuid, uuid, numeric, text) TO authenticated;
