-- Migration: 20261231000000_healthcare_insurance_and_commissions.sql
-- Description: Healthcare Phase 3 — insurance provider directory, split-billing
--              claims, remittance settlement, doctor fee contracts and accrued
--              commissions.
--
-- Financial boundary
-- ------------------
-- `journal_entries` is protected by RLS and may only be written by
-- `public.post_financial_journal`. Nothing in this migration inserts a journal
-- directly. Claim-settlement adjustments and doctor commission accruals are
-- posted by the application through that RPC (see insuranceService /
-- doctorFeeService), so debits and credits stay balanced and period checks run
-- in one place.
--
-- Tenant boundary
-- ---------------
-- Every table carries `business_id`. RLS uses the same financial helpers as
-- invoicing:
--   * reads  -> public.can_read_financial_data(business_id)
--   * writes -> public.can_write_financial_data(business_id)
-- Child rows additionally pass a tenant guard trigger that proves the visit,
-- patient, provider, invoice, account and doctor all belong to the same
-- business as the row being written.

-- ============================================================================
-- 1. INSURANCE PROVIDERS (HMOs & CORPORATE PAYERS)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.insurance_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    payer_code TEXT,
    contact_person TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    billing_address TEXT,
    default_copay_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (default_copay_percent BETWEEN 0 AND 100),
    credit_period_days INT NOT NULL DEFAULT 30 CHECK (credit_period_days >= 0),
    -- The AR control account this payer's claims are posted against.
    receivable_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    -- Optional defaults used by the remittance screen; both are validated by
    -- the tenant guard below so a provider cannot point at another tenant's
    -- chart of accounts.
    settlement_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    write_off_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_insurance_provider_name UNIQUE (business_id, name),
    CONSTRAINT insurance_provider_name_not_blank CHECK (btrim(name) <> '')
);

-- ============================================================================
-- 2. INSURANCE CLAIMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.insurance_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    visit_id UUID NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.insurance_providers(id) ON DELETE RESTRICT,
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    claim_number TEXT NOT NULL,
    policy_number TEXT,
    member_id TEXT,
    pre_auth_code TEXT,
    total_bill_amount NUMERIC(12,2) NOT NULL CHECK (total_bill_amount >= 0),
    patient_copay_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (patient_copay_amount >= 0),
    insurer_claim_amount NUMERIC(12,2) NOT NULL CHECK (insurer_claim_amount >= 0),
    approved_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (approved_amount >= 0),
    settled_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (settled_amount >= 0),
    disallowance_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (disallowance_amount >= 0),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'settled', 'disputed')),
    submission_date DATE,
    settlement_date DATE,
    rejection_reason TEXT,
    remittance_reference TEXT,
    -- The journal produced when the remittance is reconciled. The journal
    -- itself is written by post_financial_journal, never by this table.
    settlement_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_business_claim_number UNIQUE (business_id, claim_number),
    CONSTRAINT insurance_claim_number_not_blank CHECK (btrim(claim_number) <> ''),
    -- A split bill must add back to the gross bill. Numeric amounts are dollars
    -- and cents, so the tolerance is half a cent.
    CONSTRAINT insurance_claim_split_balances CHECK (
        abs((patient_copay_amount + insurer_claim_amount) - total_bill_amount) < 0.01
    ),
    CONSTRAINT insurance_claim_settled_within_claim CHECK (
        settled_amount <= insurer_claim_amount
    )
);

-- ============================================================================
-- 3. INSURANCE CLAIM LINE ITEMS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.insurance_claim_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    claim_id UUID NOT NULL REFERENCES public.insurance_claims(id) ON DELETE CASCADE,
    service_category TEXT NOT NULL
        CHECK (service_category IN ('consultation', 'medication', 'laboratory', 'procedure', 'other')),
    item_description TEXT NOT NULL,
    gross_amount NUMERIC(12,2) NOT NULL CHECK (gross_amount >= 0),
    patient_share NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (patient_share >= 0),
    insurer_share NUMERIC(12,2) NOT NULL CHECK (insurer_share >= 0),
    status TEXT NOT NULL DEFAULT 'approved'
        CHECK (status IN ('approved', 'rejected', 'adjusted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT insurance_claim_item_split_balances CHECK (
        abs((patient_share + insurer_share) - gross_amount) < 0.01
    )
);

-- ============================================================================
-- 4. DOCTOR FEE & REVENUE SHARE CONTRACTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.doctor_fee_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    contract_type TEXT NOT NULL DEFAULT 'percentage'
        CHECK (contract_type IN ('percentage', 'fixed', 'hybrid')),
    consultation_share_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (consultation_share_percent BETWEEN 0 AND 100),
    fixed_consultation_fee NUMERIC(12,2) NOT NULL DEFAULT 0
        CHECK (fixed_consultation_fee >= 0),
    lab_procedure_share_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (lab_procedure_share_percent BETWEEN 0 AND 100),
    pharmacy_share_percent NUMERIC(5,2) NOT NULL DEFAULT 0
        CHECK (pharmacy_share_percent BETWEEN 0 AND 100),
    expense_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    payable_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doctor_contract UNIQUE (business_id, doctor_id)
);

-- ============================================================================
-- 5. DOCTOR EARNINGS LEDGER
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.doctor_fee_earnings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
    doctor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    visit_id UUID NOT NULL REFERENCES public.patient_visits(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
    consultation_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (consultation_amount >= 0),
    lab_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (lab_amount >= 0),
    pharmacy_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (pharmacy_amount >= 0),
    earned_commission NUMERIC(12,2) NOT NULL CHECK (earned_commission >= 0),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'posted', 'paid')),
    journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    payout_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
    posted_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One commission accrual per doctor per visit per invoice. This makes the
    -- automatic accrual during invoice creation idempotent under retries.
    CONSTRAINT uq_doctor_earning_invoice UNIQUE (business_id, doctor_id, visit_id, invoice_id)
);

-- ============================================================================
-- 6. UPDATED_AT TRIGGERS
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.proname = 'set_updated_at' AND n.nspname = 'public'
  ) THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_insurance_providers_updated_at ON public.insurance_providers;
CREATE TRIGGER trg_insurance_providers_updated_at
  BEFORE UPDATE ON public.insurance_providers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_insurance_claims_updated_at ON public.insurance_claims;
CREATE TRIGGER trg_insurance_claims_updated_at
  BEFORE UPDATE ON public.insurance_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_doctor_fee_contracts_updated_at ON public.doctor_fee_contracts;
CREATE TRIGGER trg_doctor_fee_contracts_updated_at
  BEFORE UPDATE ON public.doctor_fee_contracts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- 7. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_claims_provider
  ON public.insurance_claims (business_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_claims_status
  ON public.insurance_claims (business_id, status);
CREATE INDEX IF NOT EXISTS idx_claims_visit
  ON public.insurance_claims (business_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_claims_patient
  ON public.insurance_claims (business_id, patient_id);
CREATE INDEX IF NOT EXISTS idx_claim_items_claim
  ON public.insurance_claim_items (business_id, claim_id);
CREATE INDEX IF NOT EXISTS idx_doctor_contracts_business
  ON public.doctor_fee_contracts (business_id, is_active);
CREATE INDEX IF NOT EXISTS idx_doctor_earnings_doc
  ON public.doctor_fee_earnings (business_id, doctor_id, status);
CREATE INDEX IF NOT EXISTS idx_doctor_earnings_visit
  ON public.doctor_fee_earnings (business_id, visit_id);
CREATE INDEX IF NOT EXISTS idx_doctor_earnings_status
  ON public.doctor_fee_earnings (business_id, status);

-- ============================================================================
-- 8. TENANT GUARDS
-- ============================================================================
-- Foreign keys prove the row exists, not that it belongs to the same tenant.
-- These triggers close that gap for every cross-table reference.
CREATE OR REPLACE FUNCTION public.healthcare_assert_insurance_provider_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.receivable_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id = NEW.receivable_account_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The receivable account belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.settlement_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id = NEW.settlement_account_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The settlement account belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.write_off_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id = NEW.write_off_account_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The write-off account belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insurance_provider_scope ON public.insurance_providers;
CREATE TRIGGER trg_insurance_provider_scope
  BEFORE INSERT OR UPDATE ON public.insurance_providers
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_insurance_provider_scope();

CREATE OR REPLACE FUNCTION public.healthcare_assert_insurance_claim_scope()
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
    RAISE EXCEPTION 'The visit and patient must belong to the claim business.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.insurance_providers p
     WHERE p.id = NEW.provider_id AND p.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The insurance provider belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = NEW.invoice_id AND i.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The invoice belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.settlement_journal_entry_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.journal_entries j
     WHERE j.id = NEW.settlement_journal_entry_id AND j.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The settlement journal belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insurance_claim_scope ON public.insurance_claims;
CREATE TRIGGER trg_insurance_claim_scope
  BEFORE INSERT OR UPDATE ON public.insurance_claims
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_insurance_claim_scope();

CREATE OR REPLACE FUNCTION public.healthcare_assert_insurance_claim_item_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.insurance_claims c
     WHERE c.id = NEW.claim_id AND c.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The claim belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_insurance_claim_item_scope ON public.insurance_claim_items;
CREATE TRIGGER trg_insurance_claim_item_scope
  BEFORE INSERT OR UPDATE ON public.insurance_claim_items
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_insurance_claim_item_scope();

CREATE OR REPLACE FUNCTION public.healthcare_assert_doctor_contract_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.business_users bu
     WHERE bu.business_id = NEW.business_id
       AND bu.user_id = NEW.doctor_id
       AND bu.is_active
  ) THEN
    RAISE EXCEPTION 'The doctor is not an active member of this business.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.expense_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id = NEW.expense_account_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The expense account belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.payable_account_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts a
     WHERE a.id = NEW.payable_account_id AND a.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The payable account belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doctor_contract_scope ON public.doctor_fee_contracts;
CREATE TRIGGER trg_doctor_contract_scope
  BEFORE INSERT OR UPDATE ON public.doctor_fee_contracts
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_doctor_contract_scope();

CREATE OR REPLACE FUNCTION public.healthcare_assert_doctor_earning_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.patient_visits v
     WHERE v.id = NEW.visit_id AND v.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The visit belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.business_users bu
     WHERE bu.business_id = NEW.business_id
       AND bu.user_id = NEW.doctor_id
       AND bu.is_active
  ) THEN
    RAISE EXCEPTION 'The doctor is not an active member of this business.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.invoice_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.invoices i
     WHERE i.id = NEW.invoice_id AND i.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'The invoice belongs to another business.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_doctor_earning_scope ON public.doctor_fee_earnings;
CREATE TRIGGER trg_doctor_earning_scope
  BEFORE INSERT ON public.doctor_fee_earnings
  FOR EACH ROW EXECUTE FUNCTION public.healthcare_assert_doctor_earning_scope();

-- ============================================================================
-- 9. CLAIM NUMBER SEQUENCING
-- ============================================================================
-- The UI also has a client-side generator for offline/demo use. This server
-- helper is race-safe: the advisory lock serialises two cashiers submitting at
-- the same instant, and MAX() tolerates gaps and rejected/deleted drafts.
CREATE OR REPLACE FUNCTION public.next_claim_number(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_year integer := extract(year FROM current_date)::integer;
  v_prefix text := 'CLM-' || v_year::text || '-';
  v_next integer;
BEGIN
  IF v_user IS NOT NULL AND NOT public.can_write_financial_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorised to create claims for this business.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_business_id::text || ':' || v_year::text, 0));

  SELECT COALESCE(MAX(
           NULLIF(regexp_replace(claim_number, '^CLM-[0-9]{4}-', ''), '')::integer
         ), 0) + 1
    INTO v_next
    FROM public.insurance_claims
   WHERE business_id = p_business_id
     AND claim_number LIKE v_prefix || '%'
     AND claim_number ~ '^CLM-[0-9]{4}-[0-9]+$';

  RETURN v_prefix || lpad(v_next::text, 4, '0');
END;
$$;

COMMENT ON FUNCTION public.next_claim_number(uuid) IS
  'Race-safe CLM-YYYY-NNNN allocator for insurance claims.';

-- ============================================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.insurance_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_claim_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_fee_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_fee_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "insurance_providers_select" ON public.insurance_providers;
CREATE POLICY "insurance_providers_select" ON public.insurance_providers
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

DROP POLICY IF EXISTS "insurance_providers_modify" ON public.insurance_providers;
CREATE POLICY "insurance_providers_modify" ON public.insurance_providers
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "insurance_claims_select" ON public.insurance_claims;
CREATE POLICY "insurance_claims_select" ON public.insurance_claims
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

DROP POLICY IF EXISTS "insurance_claims_modify" ON public.insurance_claims;
CREATE POLICY "insurance_claims_modify" ON public.insurance_claims
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "insurance_claim_items_select" ON public.insurance_claim_items;
CREATE POLICY "insurance_claim_items_select" ON public.insurance_claim_items
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

DROP POLICY IF EXISTS "insurance_claim_items_modify" ON public.insurance_claim_items;
CREATE POLICY "insurance_claim_items_modify" ON public.insurance_claim_items
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "doctor_fee_contracts_select" ON public.doctor_fee_contracts;
CREATE POLICY "doctor_fee_contracts_select" ON public.doctor_fee_contracts
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

DROP POLICY IF EXISTS "doctor_fee_contracts_modify" ON public.doctor_fee_contracts;
CREATE POLICY "doctor_fee_contracts_modify" ON public.doctor_fee_contracts
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

DROP POLICY IF EXISTS "doctor_fee_earnings_select" ON public.doctor_fee_earnings;
CREATE POLICY "doctor_fee_earnings_select" ON public.doctor_fee_earnings
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

DROP POLICY IF EXISTS "doctor_fee_earnings_modify" ON public.doctor_fee_earnings;
CREATE POLICY "doctor_fee_earnings_modify" ON public.doctor_fee_earnings
  FOR ALL TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

-- ============================================================================
-- 11. GRANTS
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_providers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_claims TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.insurance_claim_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_fee_contracts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.doctor_fee_earnings TO authenticated;
REVOKE ALL ON FUNCTION public.next_claim_number(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_claim_number(uuid) TO authenticated;
