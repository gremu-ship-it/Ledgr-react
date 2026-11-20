-- ============================================================================
-- 20261225000001_post_financial_journal_rpc.sql
--
-- SECURITY DEFINER command for client-initiated balanced journal entries.
--
-- WHY
--   `20261218000000_role_aware_financial_rls.sql` made journal DML command-only
--   for every application role:
--
--       journal_entries_command_insert  WITH CHECK (false)
--       journal_lines_command_insert    WITH CHECK (false)
--       … and the same for UPDATE/DELETE.
--
--   That is the right boundary — direct table writes skip balancing, period
--   locks, entry numbering and the audit trail — but the client kept calling
--   `JournalRepository.createBalancedEntry()`/`post()`, which insert into
--   `journal_entries` directly. Every such call therefore failed with
--
--       new row violates row-level security policy for table "journal_entries"
--
--   regardless of the caller's role, including owner. Issue Shares, loans,
--   depreciation, fixed assets, payroll accruals, tax accruals and the
--   inventory journal all post through that path.
--
--   This migration supplies the missing command and keeps the table
--   command-only: the browser may no longer write the ledger directly, but it
--   may ask the server to do so, and the server re-checks everything.
--
-- SCHEMA (this database, not the specification sketch)
--   * Ledger lines live in `journal_lines`, not `journal_entry_lines`.
--   * There is no `metadata` column and no `debit`/`credit` pair: lines carry
--     `is_debit`, `amount` (transaction currency) and `amount_base` (functional
--     currency). `amount_base` is what balancing is measured on.
--   * `journal_entries` has `reference`, `source_type`, `source_id`, `status`,
--     `posting_key` and `created_by text`; `entry_number` and `currency` are
--     NOT NULL and are therefore derived server-side when not supplied.
--   * `business_users` has no `status` column; membership authority is already
--     expressed by the `can_*_data` helpers on `business_users.is_active`.
--
-- SECURITY
--   * SECURITY DEFINER, `search_path = public`, EXECUTE revoked from PUBLIC and
--     anon, granted to authenticated only (plus service_role for jobs).
--   * Authority is the existing helper: `can_write_financial_data(business_id)`
--     — platform admin, or an active owner/admin/accountant. Supervisors keep
--     their read visibility and gain no posting authority (see R04).
--   * Balance is verified here; accounts are verified through the existing
--     `_ledgr_assert_account`; period locks and entry immutability are enforced
--     by the existing BEFORE triggers (`trg_aa_period_lock`), which fire for a
--     definer function exactly as they do for a direct write.
--   * Entry numbers come from `next_journal_entry_number`, so concurrent
--     posters cannot collide.
--
-- REPLAY SAFE
--   `create or replace` for both commands, policy drops are catalog-guarded by
--   `drop policy if exists`, and no data is touched.
-- ============================================================================

-- ── 1. Post a balanced journal entry ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_financial_journal(
  p_business_id uuid,
  p_entry_date date,
  p_description text,
  p_reference text DEFAULT NULL,
  p_source_type text DEFAULT 'manual',
  p_source_id text DEFAULT NULL,
  p_lines jsonb DEFAULT '[]'::jsonb,
  p_currency text DEFAULT NULL,
  p_exchange_rate numeric DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL,
  p_status text DEFAULT 'posted',
  p_entry_number text DEFAULT NULL,
  p_posting_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_line jsonb;
  v_line_no integer := 0;
  v_norm jsonb := '[]'::jsonb;
  v_is_debit boolean;
  v_debit numeric;
  v_credit numeric;
  v_amount numeric;
  v_amount_base numeric;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_account_id uuid;
  v_currency text;
  v_rate numeric;
  v_status public.journal_status;
  v_entry_id uuid;
  v_existing uuid;
BEGIN
  -- ── Identity and authority ────────────────────────────────────────────────
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to post a journal entry.' USING ERRCODE = '42501';
  END IF;

  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required to post a journal entry.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_write_financial_data(p_business_id) THEN
    RAISE EXCEPTION 'Not authorised to post financial journals for this business.'
      USING ERRCODE = '42501';
  END IF;

  IF p_entry_date IS NULL THEN
    RAISE EXCEPTION 'A journal date is required.' USING ERRCODE = '22023';
  END IF;

  IF coalesce(btrim(p_description), '') = '' THEN
    RAISE EXCEPTION 'A journal description is required.' USING ERRCODE = '22023';
  END IF;

  -- ── Status: a command may create a draft or a posted entry, never a
  --    reversed one (reversal goes through reverse_journal_entry). ───────────
  BEGIN
    v_status := coalesce(nullif(btrim(p_status), ''), 'posted')::public.journal_status;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Unsupported journal status "%".', p_status USING ERRCODE = '22023';
  END;

  IF v_status NOT IN ('draft', 'posted') THEN
    RAISE EXCEPTION 'A journal command can only create a draft or a posted entry (got "%").', p_status
      USING ERRCODE = '22023';
  END IF;

  -- ── Idempotency: a keyed posting returns the entry that key already made. ─
  IF p_posting_key IS NOT NULL THEN
    SELECT id INTO v_existing
      FROM public.journal_entries
     WHERE business_id = p_business_id
       AND posting_key = p_posting_key
     LIMIT 1;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- ── Lines: at least one debit and one credit ──────────────────────────────
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) < 2 THEN
    RAISE EXCEPTION 'A journal entry requires at least two lines (one debit and one credit).'
      USING ERRCODE = '22023';
  END IF;

  -- Normalise each line to the schema's shape. The canonical input is
  -- {account_id, is_debit, amount, amount_base, description, tax_code,
  --  tax_amount}; a {debit, credit} pair is also accepted so callers written
  -- against the debit/credit vocabulary do not have to convert.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF coalesce(v_line->>'account_id', '') !~ '^[0-9a-fA-F-]{36}$' THEN
      RAISE EXCEPTION 'Every journal line needs a valid account id.' USING ERRCODE = '22023';
    END IF;
    v_account_id := (v_line->>'account_id')::uuid;

    v_debit := nullif(v_line->>'debit', '')::numeric;
    v_credit := nullif(v_line->>'credit', '')::numeric;

    IF v_line ? 'is_debit' THEN
      v_is_debit := (v_line->>'is_debit')::boolean;
    ELSIF v_debit IS NOT NULL OR v_credit IS NOT NULL THEN
      -- A {debit, credit} pair is accepted; the non-zero side decides.
      v_is_debit := coalesce(nullif(v_debit, 0), 0) > 0;
    ELSE
      RAISE EXCEPTION 'Journal line % must say whether it is a debit or a credit.', v_line_no + 1
        USING ERRCODE = '22023';
    END IF;

    v_amount := coalesce(
      nullif(v_line->>'amount', '')::numeric,
      nullif(v_line->>'amount_base', '')::numeric
    );

    -- Fall back to the debit/credit vocabulary when the canonical fields are
    -- absent: the side named by is_debit wins, the other side is a safety net.
    IF v_amount IS NULL THEN
      v_amount := CASE WHEN v_is_debit
                       THEN coalesce(nullif(v_debit, 0), nullif(v_credit, 0))
                       ELSE coalesce(nullif(v_credit, 0), nullif(v_debit, 0)) END;
    END IF;

    -- Functional-currency amount: what balancing is measured on.
    v_amount_base := coalesce(
      nullif(v_line->>'amount_base', '')::numeric,
      nullif(v_line->>'amount', '')::numeric,
      v_amount
    );

    -- A line must carry a functional-currency amount. Sign and zero are not
    -- restricted here: the balance check below plus the requirement that the
    -- entry move value are what make an entry meaningful, and posting code
    -- already models a credit as its own line rather than a negative debit.
    IF v_amount IS NULL OR v_amount_base IS NULL THEN
      RAISE EXCEPTION 'Journal line % must have an amount.', v_line_no + 1
        USING ERRCODE = '22023';
    END IF;

    v_line_no := v_line_no + 1;
    IF v_is_debit THEN
      v_debits := v_debits + v_amount_base;
    ELSE
      v_credits := v_credits + v_amount_base;
    END IF;

    v_norm := v_norm || jsonb_build_object(
      'account_id', v_account_id,
      'is_debit', v_is_debit,
      'amount', v_amount,
      'amount_base', v_amount_base,
      'description', coalesce(nullif(v_line->>'description', ''), p_description),
      'tax_code', coalesce(nullif(v_line->>'tax_code', ''), 'none'),
      'tax_amount', coalesce(nullif(v_line->>'tax_amount', '')::numeric, 0)
    );
  END LOOP;

  IF round(v_debits, 2) <> round(v_credits, 2) OR v_debits <= 0 THEN
    RAISE EXCEPTION 'Unbalanced journal entry: debits (%) must equal credits (%) and be greater than zero.',
      round(v_debits, 2), round(v_credits, 2)
      USING ERRCODE = '22023';
  END IF;

  -- ── Header defaults derived server-side ───────────────────────────────────
  SELECT coalesce(nullif(btrim(p_currency), ''), nullif(btrim(b.base_currency), ''), 'MWK')
    INTO v_currency
    FROM public.businesses b
   WHERE b.id = p_business_id;

  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Business % was not found.', p_business_id USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.currencies c WHERE c.code = v_currency) THEN
    RAISE EXCEPTION 'Currency "%" is not configured.', v_currency USING ERRCODE = '22023';
  END IF;

  v_rate := coalesce(p_exchange_rate, 1);
  IF v_rate <= 0 THEN
    RAISE EXCEPTION 'The exchange rate must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  -- Scope guard: a branch or department of another tenant must not be attached
  -- to this business's ledger.
  IF p_branch_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.business_id = p_business_id)
  THEN
    RAISE EXCEPTION 'Branch % does not belong to this business.', p_branch_id USING ERRCODE = '22023';
  END IF;

  IF p_department_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = p_department_id AND d.business_id = p_business_id)
  THEN
    RAISE EXCEPTION 'Department % does not belong to this business.', p_department_id USING ERRCODE = '22023';
  END IF;

  -- ── Insert the entry ──────────────────────────────────────────────────────
  -- trg_aa_period_lock fires here: a closed period refuses the whole command.
  INSERT INTO public.journal_entries (
    business_id, entry_number, entry_date, description, reference,
    source_type, source_id, currency, exchange_rate, branch_id, department_id,
    status, posting_key, created_by, posted_at, posted_by
  ) VALUES (
    p_business_id,
    coalesce(nullif(btrim(p_entry_number), ''), public.next_journal_entry_number(p_business_id)),
    p_entry_date,
    p_description,
    p_reference,
    coalesce(nullif(btrim(p_source_type), ''), 'manual'),
    p_source_id,
    v_currency,
    v_rate,
    p_branch_id,
    p_department_id,
    v_status,
    p_posting_key,
    v_user::text,
    CASE WHEN v_status = 'posted' THEN now() ELSE NULL END,
    CASE WHEN v_status = 'posted' THEN v_user::text ELSE NULL END
  )
  RETURNING id INTO v_entry_id;

  -- ── Insert the lines ──────────────────────────────────────────────────────
  v_line_no := 0;
  FOR v_line IN SELECT * FROM jsonb_array_elements(v_norm) LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.journal_lines (
      journal_entry_id, business_id, line_number, account_id, description,
      is_debit, amount, amount_base, currency, exchange_rate,
      tax_code, tax_amount, reconciled
    ) VALUES (
      v_entry_id,
      p_business_id,
      v_line_no,
      public._ledgr_assert_account((v_line->>'account_id')::uuid, p_business_id, 'journal'),
      v_line->>'description',
      (v_line->>'is_debit')::boolean,
      (v_line->>'amount')::numeric,
      (v_line->>'amount_base')::numeric,
      v_currency,
      v_rate,
      (v_line->>'tax_code')::public.tax_code,
      (v_line->>'tax_amount')::numeric,
      false
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

COMMENT ON FUNCTION public.post_financial_journal(
  uuid, date, text, text, text, text, jsonb, text, numeric, uuid, uuid, text, text, text
) IS
  'SEC-01 command: creates a balanced journal entry (draft or posted) for a financial writer (can_write_financial_data). Validates debits=credits in functional currency, resolves the entry number server-side, asserts each account belongs to the business, and relies on trg_aa_period_lock for the period lock. Journal tables stay command-only: this is the only client-reachable insert path.';

REVOKE ALL ON FUNCTION public.post_financial_journal(
  uuid, date, text, text, text, text, jsonb, text, numeric, uuid, uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_financial_journal(
  uuid, date, text, text, text, text, jsonb, text, numeric, uuid, uuid, text, text, text
) TO authenticated, service_role;

-- ── 2. Post an existing draft ───────────────────────────────────────────────
-- `JournalRepository.post()` used to UPDATE the row directly, which the
-- command-only UPDATE policy refuses. The draft→posted transition lives here so
-- the same authority and period checks apply.
CREATE OR REPLACE FUNCTION public.post_draft_financial_journal(
  p_entry_id uuid,
  p_posted_by text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_entry public.journal_entries%ROWTYPE;
  v_posted_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to post a journal entry.' USING ERRCODE = '42501';
  END IF;

  IF p_entry_id IS NULL THEN
    RAISE EXCEPTION 'A journal entry id is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_entry
    FROM public.journal_entries
   WHERE id = p_entry_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % was not found.', p_entry_id USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_write_financial_data(v_entry.business_id) THEN
    RAISE EXCEPTION 'Not authorised to post financial journals for this business.'
      USING ERRCODE = '42501';
  END IF;

  -- Posting immutability: only a draft may be posted. To correct a posted
  -- entry, create a reversal.
  IF v_entry.status::text <> 'draft' THEN
    RAISE EXCEPTION 'Cannot post journal entry %: current status is ''%''. Only ''draft'' entries may be posted. To correct a posted entry, create a reversal.',
      p_entry_id, v_entry.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.journal_entries
     SET status = 'posted',
         posted_at = now(),
         posted_by = coalesce(nullif(btrim(p_posted_by), ''), v_user::text)
   WHERE id = p_entry_id
     AND status = 'draft'
  RETURNING id INTO v_posted_id;

  IF v_posted_id IS NULL THEN
    RAISE EXCEPTION 'Cannot post journal entry %: it was just posted by another session. Refresh to see its current status.',
      p_entry_id
      USING ERRCODE = '22023';
  END IF;

  RETURN p_entry_id;
END;
$$;

COMMENT ON FUNCTION public.post_draft_financial_journal(uuid, text) IS
  'SEC-01 command: draft→posted transition for a financial writer (can_write_financial_data). Refuses any non-draft entry, so posted entries stay immutable; trg_aa_period_lock refuses the update when the entry date falls in a closed period.';

REVOKE ALL ON FUNCTION public.post_draft_financial_journal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_draft_financial_journal(uuid, text)
  TO authenticated, service_role;

-- ── 3. share_transactions: financial authority instead of bare membership ───
-- The table was created with a single `for all` membership policy
-- (share_transactions_business_access, 20260723000000), which let any active
-- member — cashier and stock_clerk included — insert share capital. Issuing
-- shares posts to the ledger, so it follows the financial tier.
ALTER TABLE public.share_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.share_transactions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.share_transactions TO authenticated;
GRANT ALL ON TABLE public.share_transactions TO service_role;

DROP POLICY IF EXISTS "share_transactions_business_access" ON public.share_transactions;
DROP POLICY IF EXISTS "share_transactions_select" ON public.share_transactions;
DROP POLICY IF EXISTS "share_transactions_insert" ON public.share_transactions;
DROP POLICY IF EXISTS "share_transactions_update" ON public.share_transactions;

CREATE POLICY "share_transactions_select" ON public.share_transactions
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

CREATE POLICY "share_transactions_insert" ON public.share_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY "share_transactions_update" ON public.share_transactions
  FOR UPDATE TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

-- ── 4. Re-assign a journal entry's cost centre ──────────────────────────────
-- `JournalRepository.assignCostCentre()` (used by the journal detail modal to
-- give an unassigned entry a branch/department) updated journal_entries and
-- journal_lines from the browser, which the command-only UPDATE policies refuse
-- with the same RLS error as the posting path. The write belongs on the server
-- for the same reason: it touches an accounting document and every line of it.
CREATE OR REPLACE FUNCTION public.assign_financial_journal_cost_centre(
  p_entry_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_department_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_entry public.journal_entries%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Sign in to change a journal entry.' USING ERRCODE = '42501';
  END IF;

  IF p_entry_id IS NULL THEN
    RAISE EXCEPTION 'A journal entry id is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_entry
    FROM public.journal_entries
   WHERE id = p_entry_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Journal entry % was not found.', p_entry_id USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_write_financial_data(v_entry.business_id) THEN
    RAISE EXCEPTION 'Not authorised to change financial journals for this business.'
      USING ERRCODE = '42501';
  END IF;

  IF p_branch_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.branches br WHERE br.id = p_branch_id AND br.business_id = v_entry.business_id)
  THEN
    RAISE EXCEPTION 'Branch % does not belong to this business.', p_branch_id USING ERRCODE = '22023';
  END IF;

  IF p_department_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.departments d WHERE d.id = p_department_id AND d.business_id = v_entry.business_id)
  THEN
    RAISE EXCEPTION 'Department % does not belong to this business.', p_department_id USING ERRCODE = '22023';
  END IF;

  -- trg_aa_period_lock refuses this for an entry dated in a closed period.
  UPDATE public.journal_entries
     SET branch_id = p_branch_id,
         department_id = p_department_id
   WHERE id = p_entry_id
     AND business_id = v_entry.business_id;

  UPDATE public.journal_lines
     SET branch_id = p_branch_id,
         department_id = p_department_id
   WHERE journal_entry_id = p_entry_id
     AND business_id = v_entry.business_id;

  -- Keep the document that produced the entry in step with its ledger rows.
  IF v_entry.source_id IS NOT NULL AND v_entry.source_id ~ '^[0-9a-fA-F-]{36}$' THEN
    IF v_entry.source_type = 'invoice' THEN
      UPDATE public.invoices SET branch_id = p_branch_id, department_id = p_department_id
       WHERE id = v_entry.source_id::uuid AND business_id = v_entry.business_id;
    ELSIF v_entry.source_type = 'expense' THEN
      UPDATE public.expenses SET branch_id = p_branch_id, department_id = p_department_id
       WHERE id = v_entry.source_id::uuid AND business_id = v_entry.business_id;
    ELSIF v_entry.source_type = 'payroll' THEN
      UPDATE public.payroll_runs SET branch_id = p_branch_id, department_id = p_department_id
       WHERE id = v_entry.source_id::uuid AND business_id = v_entry.business_id;
    END IF;
  END IF;

  RETURN p_entry_id;
END;
$$;

COMMENT ON FUNCTION public.assign_financial_journal_cost_centre(uuid, uuid, uuid) IS
  'SEC-01 command: assigns a branch/department to a journal entry, all of its lines and the document that produced it, for a financial writer (can_write_financial_data). Tenant-scoped on business_id and subject to trg_aa_period_lock.';

REVOKE ALL ON FUNCTION public.assign_financial_journal_cost_centre(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_financial_journal_cost_centre(uuid, uuid, uuid)
  TO authenticated, service_role;
