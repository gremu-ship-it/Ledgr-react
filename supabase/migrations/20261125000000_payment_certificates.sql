-- 5B-3b: construction payment certificates, built on the existing
-- period-valued project_valuations and their construction retention ledger.
-- This migration deliberately adds no replacement valuation or retention
-- ledger tables and does not alter any existing construction table or RPC.

CREATE TABLE IF NOT EXISTS public.payment_certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  valuation_id uuid NOT NULL REFERENCES public.project_valuations(id) ON DELETE RESTRICT,
  certificate_number integer NOT NULL CHECK (certificate_number > 0),
  certificate_date date NOT NULL,
  -- gross_amount is copied from the linked valuation and is for that period.
  gross_amount numeric(18,2) NOT NULL DEFAULT 0,
  retention_amount numeric(18,2) NOT NULL DEFAULT 0,
  advance_recovery numeric(18,2) NOT NULL DEFAULT 0,
  penalty_deductions numeric(18,2) NOT NULL DEFAULT 0,
  other_deductions numeric(18,2) NOT NULL DEFAULT 0,
  net_amount numeric(18,2) NOT NULL DEFAULT 0,
  retention_percentage numeric(5,2) NOT NULL DEFAULT 0
    CHECK (retention_percentage >= 0 AND retention_percentage <= 100),
  total_retention_held numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'issued', 'paid', 'partially_paid', 'cancelled')),
  issued_to_contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  payment_due_date date,
  paid_date date,
  paid_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, certificate_number),
  CHECK (gross_amount > 0),
  CHECK (retention_amount >= 0),
  CHECK (advance_recovery >= 0),
  CHECK (penalty_deductions >= 0),
  CHECK (other_deductions >= 0),
  CHECK (net_amount >= 0),
  CHECK (paid_amount <= net_amount)
);

CREATE INDEX IF NOT EXISTS payment_certificates_project_date_idx
  ON public.payment_certificates(project_id, certificate_date DESC);
CREATE INDEX IF NOT EXISTS payment_certificates_business_idx
  ON public.payment_certificates(business_id);
CREATE INDEX IF NOT EXISTS payment_certificates_valuation_idx
  ON public.payment_certificates(valuation_id);
CREATE UNIQUE INDEX IF NOT EXISTS payment_certificates_one_active_per_valuation_idx
  ON public.payment_certificates(valuation_id)
  WHERE status <> 'cancelled';

ALTER TABLE public.payment_certificates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_certificates_member_read ON public.payment_certificates;
CREATE POLICY payment_certificates_member_read
  ON public.payment_certificates FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.construction_projects p
       WHERE p.id = payment_certificates.project_id
         AND p.business_id = payment_certificates.business_id
         AND public.is_business_member(p.business_id)
         AND cardinality(public.construction_procurement_capabilities_for(p.business_id)) > 0
    )
  );

-- Writes are command-only. The SECURITY DEFINER RPCs below repeat the existing
-- construction actor/capability checks; the browser receives SELECT only.
REVOKE ALL ON public.payment_certificates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_certificates TO authenticated;

CREATE OR REPLACE FUNCTION public.create_certificate_from_valuation(
  p_valuation_id uuid,
  p_retention_percentage numeric DEFAULT 10,
  p_advance_recovery numeric DEFAULT 0,
  p_penalty_deductions numeric DEFAULT 0,
  p_other_deductions numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valuation public.project_valuations%ROWTYPE;
  v_project public.construction_projects%ROWTYPE;
  v_actor uuid;
  v_certificate_id uuid;
  v_certificate_number integer;
  v_total_retention numeric(18,2);
  v_advance_recovery numeric(18,2);
  v_penalty_deductions numeric(18,2);
  v_other_deductions numeric(18,2);
  v_net_amount numeric(18,2);
  v_contact_id uuid;
BEGIN
  IF p_valuation_id IS NULL THEN
    RAISE EXCEPTION 'Valuation is required.' USING ERRCODE = '22023';
  END IF;
  IF p_retention_percentage IS NULL
     OR p_retention_percentage IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_retention_percentage < 0 OR p_retention_percentage > 100 THEN
    RAISE EXCEPTION 'Retention percentage must be between 0 and 100.' USING ERRCODE = '22023';
  END IF;
  IF p_advance_recovery IS NULL OR p_penalty_deductions IS NULL OR p_other_deductions IS NULL
     OR p_advance_recovery IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_penalty_deductions IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_other_deductions IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_advance_recovery < 0 OR p_penalty_deductions < 0 OR p_other_deductions < 0 THEN
    RAISE EXCEPTION 'Certificate deductions must be finite non-negative amounts.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_valuation
    FROM public.project_valuations v
   WHERE v.id = p_valuation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valuation not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = v_valuation.project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_valuation
    FROM public.project_valuations v
   WHERE v.id = p_valuation_id
   FOR UPDATE;

  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id, ARRAY['procurement.master.manage']::text[]
  );
  IF v_valuation.status NOT IN ('submitted', 'invoiced') THEN
    RAISE EXCEPTION 'Valuation must be submitted or invoiced (current status: %).', v_valuation.status
      USING ERRCODE = '55000';
  END IF;
  IF v_valuation.gross_amount IS NULL OR v_valuation.gross_amount <= 0 THEN
    RAISE EXCEPTION 'Only positive period valuations can be certified for payment.' USING ERRCODE = '22023';
  END IF;
  -- Retention was already calculated and posted to the existing retention
  -- ledger by create_valuation. Require the certificate rate to agree with
  -- the period valuation; do not withhold it a second time from that ledger.
  IF round(v_valuation.gross_amount * p_retention_percentage / 100, 2)
       IS DISTINCT FROM v_valuation.retention_amount THEN
    RAISE EXCEPTION 'Retention percentage must match the amount withheld on this valuation.'
      USING ERRCODE = '22023';
  END IF;

  v_advance_recovery := round(p_advance_recovery, 2);
  v_penalty_deductions := round(p_penalty_deductions, 2);
  v_other_deductions := round(p_other_deductions, 2);
  v_net_amount := round(
    v_valuation.gross_amount - v_valuation.retention_amount
    - v_advance_recovery - v_penalty_deductions - v_other_deductions,
    2
  );
  IF v_net_amount < 0 THEN
    RAISE EXCEPTION 'Certificate deductions cannot exceed the period amount due.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_certificates c
     WHERE c.valuation_id = p_valuation_id AND c.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'A payment certificate already exists for this valuation.' USING ERRCODE = '23505';
  END IF;

  SELECT COALESCE(max(c.certificate_number), 0) + 1
    INTO v_certificate_number
    FROM public.payment_certificates c
   WHERE c.project_id = v_project.id;

  SELECT c.id INTO v_contact_id
    FROM public.contacts c
   WHERE c.id = v_project.client_id
     AND c.business_id = v_project.business_id
     AND c.contact_type IN ('customer', 'both')
     AND c.deleted_at IS NULL;

  SELECT greatest(
           COALESCE(sum(r.amount) FILTER (WHERE r.type = 'withheld'), 0)
           - COALESCE(sum(r.amount) FILTER (WHERE r.type = 'released'), 0),
           0
         )
    INTO v_total_retention
    FROM public.project_retention_ledger r
   WHERE r.project_id = v_project.id;

  INSERT INTO public.payment_certificates (
    business_id, project_id, valuation_id, certificate_number, certificate_date,
    gross_amount, retention_amount, advance_recovery, penalty_deductions,
    other_deductions, net_amount, retention_percentage, total_retention_held,
    issued_to_contact_id, created_by
  ) VALUES (
    v_project.business_id, v_project.id, v_valuation.id, v_certificate_number,
    v_valuation.valuation_date, v_valuation.gross_amount, v_valuation.retention_amount,
    v_advance_recovery, v_penalty_deductions,
    v_other_deductions, v_net_amount, p_retention_percentage,
    v_total_retention, v_contact_id, v_actor
  ) RETURNING id INTO v_certificate_id;

  RETURN v_certificate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.issue_payment_certificate(
  p_certificate_id uuid,
  p_payment_due_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_project public.construction_projects%ROWTYPE;
  v_certificate public.payment_certificates%ROWTYPE;
  v_actor uuid;
BEGIN
  SELECT c.project_id INTO v_project_id
    FROM public.payment_certificates c
   WHERE c.id = p_certificate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment certificate not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_project FROM public.construction_projects p
   WHERE p.id = v_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_certificate FROM public.payment_certificates c
   WHERE c.id = p_certificate_id FOR UPDATE;
  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id, ARRAY['procurement.master.manage']::text[]
  );
  IF v_certificate.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft certificates can be issued.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.payment_certificates
     SET status = 'issued', payment_due_date = p_payment_due_date, updated_at = now()
   WHERE id = p_certificate_id;
  RETURN p_certificate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payment_certificate_payment(
  p_certificate_id uuid,
  p_amount numeric,
  p_paid_date date DEFAULT CURRENT_DATE
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_project public.construction_projects%ROWTYPE;
  v_certificate public.payment_certificates%ROWTYPE;
  v_actor uuid;
  v_new_paid_amount numeric(18,2);
  v_new_status text;
BEGIN
  SELECT c.project_id INTO v_project_id
    FROM public.payment_certificates c
   WHERE c.id = p_certificate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment certificate not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_project FROM public.construction_projects p
   WHERE p.id = v_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_certificate FROM public.payment_certificates c
   WHERE c.id = p_certificate_id FOR UPDATE;
  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id, ARRAY['procurement.master.manage']::text[]
  );
  IF v_certificate.status NOT IN ('issued', 'partially_paid') THEN
    RAISE EXCEPTION 'Only issued certificates can record payment.' USING ERRCODE = '55000';
  END IF;
  IF p_amount IS NULL OR p_amount IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
     OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be a positive finite amount.' USING ERRCODE = '22023';
  END IF;
  v_new_paid_amount := round(v_certificate.paid_amount + p_amount, 2);
  IF v_new_paid_amount > v_certificate.net_amount THEN
    RAISE EXCEPTION 'Payment exceeds the certificate balance outstanding.' USING ERRCODE = '22023';
  END IF;
  v_new_status := CASE WHEN v_new_paid_amount = v_certificate.net_amount THEN 'paid' ELSE 'partially_paid' END;
  UPDATE public.payment_certificates
     SET paid_amount = v_new_paid_amount,
         paid_date = COALESCE(p_paid_date, CURRENT_DATE),
         status = v_new_status,
         updated_at = now()
   WHERE id = p_certificate_id;
  RETURN p_certificate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_payment_certificate(p_certificate_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_project public.construction_projects%ROWTYPE;
  v_certificate public.payment_certificates%ROWTYPE;
  v_actor uuid;
BEGIN
  SELECT c.project_id INTO v_project_id
    FROM public.payment_certificates c
   WHERE c.id = p_certificate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment certificate not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_project FROM public.construction_projects p
   WHERE p.id = v_project_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_certificate FROM public.payment_certificates c
   WHERE c.id = p_certificate_id FOR UPDATE;
  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id, ARRAY['procurement.master.manage']::text[]
  );
  IF v_certificate.status NOT IN ('draft', 'issued') OR v_certificate.paid_amount <> 0 THEN
    RAISE EXCEPTION 'Only unpaid draft or issued certificates can be cancelled.' USING ERRCODE = '55000';
  END IF;
  UPDATE public.payment_certificates SET status = 'cancelled', updated_at = now()
   WHERE id = p_certificate_id;
  RETURN p_certificate_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_certificate_from_valuation(uuid, numeric, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.issue_payment_certificate(uuid, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_payment_certificate_payment(uuid, numeric, date)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_payment_certificate(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_certificate_from_valuation(uuid, numeric, numeric, numeric, numeric)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.issue_payment_certificate(uuid, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_certificate_payment(uuid, numeric, date)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_payment_certificate(uuid)
  TO authenticated;
