-- ============================================================================
-- 20261225000002_fix_journal_source_id_uuid_cast.sql
--
-- Fix: `column "source_id" is of type uuid but expression is of type text`
--      (SQLSTATE 42804) when posting journals from Issue Shares, Loans,
--      Expenses and Invoices.
--
-- WHY
--   `post_financial_journal` (20261225000001) writes `p_source_id text` into
--   `journal_entries.source_id`. In this repository's base schema that column
--   is TEXT, so every replay and test passed; on the live database it is UUID
--   (evidence and precedent in 20260911000002 and 20261014000001). PostgreSQL
--   has no implicit text→uuid assignment, so the INSERT aborted with 42804 and
--   the whole posting rolled back — for every module that passes a source id.
--   `created_by` / `posted_by` have the same mismatch, so they would have
--   failed next, and `assign_financial_journal_cost_centre` compared the uuid
--   column with a text pattern (42883).
--
-- FIX
--   The physical type of `journal_entries.source_id` is read from
--   `information_schema` and the INSERT branches on it, so ONE function body is
--   correct on both shapes:
--     * uuid column   → the parameter is cast when it is a UUID and stored as
--                       NULL (with a WARNING) when it is not; the raw key stays
--                       in `posting_key`, which is what callers match on;
--     * text column   → the parameter is stored verbatim, exactly as before.
--   `created_by` / `posted_by` are written as uuid expressions, which a uuid
--   column accepts directly and a text column accepts through the uuid→text
--   assignment cast. The cost-centre command compares `source_id::text`.
--
--   No table, column, policy, grant or data is changed: `CREATE OR REPLACE
--   FUNCTION` only, with the grants re-asserted.
-- ============================================================================

-- ── 1. Post a balanced journal entry (uuid/text-safe) ───────────────────────
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
  -- journal_entries.source_id / created_by / posted_by are TEXT in this
  -- repository's base schema but UUID on the live database (see
  -- 20261014000001). The physical type is resolved at run time so a single
  -- body writes correctly on both shapes.
  v_source_id_type text;
  v_source_uuid uuid;
  v_source_text text;
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

  -- ── source_id: text parameter, uuid-or-text column ───────────────────────
  -- PostgreSQL has no implicit text→uuid cast, so handing the parameter straight
  -- to the INSERT raises 42804 ("column \"source_id\" is of type uuid but
  -- expression is of type text") on the live shape — the failure users saw from
  -- Issue Shares, Loans, Expenses and Invoices. Resolve the column's physical
  -- type once, then give the INSERT an expression of the matching type.
  SELECT c.data_type INTO v_source_id_type
    FROM information_schema.columns c
   WHERE c.table_schema = 'public'
     AND c.table_name = 'journal_entries'
     AND c.column_name = 'source_id';

  IF btrim(coalesce(p_source_id, '')) <> '' THEN
    v_source_text := btrim(p_source_id);
    IF v_source_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_source_uuid := v_source_text::uuid;
    ELSIF coalesce(v_source_id_type, 'text') = 'uuid' THEN
      -- A non-uuid key (the composite keys inventory builds, for example)
      -- cannot be represented in a uuid column. The posting must not fail for
      -- it: the ledger is the source of truth, and the key is already carried
      -- by `posting_key`, which is what callers match on.
      RAISE WARNING 'post_financial_journal: source_id % is not a UUID and cannot be stored on a uuid-shaped journal_entries.source_id; the entry is posted without it.', v_source_text;
      v_source_text := NULL;
    END IF;
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
  IF coalesce(v_source_id_type, 'text') = 'uuid' THEN
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
      v_source_uuid,
      v_currency,
      v_rate,
      p_branch_id,
      p_department_id,
      v_status,
      p_posting_key,
      v_user,
      CASE WHEN v_status = 'posted' THEN now() ELSE NULL END,
      CASE WHEN v_status = 'posted' THEN v_user ELSE NULL END
    )
    RETURNING id INTO v_entry_id;
  ELSE
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
      v_source_text,
      v_currency,
      v_rate,
      p_branch_id,
      p_department_id,
      v_status,
      p_posting_key,
      v_user,
      CASE WHEN v_status = 'posted' THEN now() ELSE NULL END,
      CASE WHEN v_status = 'posted' THEN v_user ELSE NULL END
    )
    RETURNING id INTO v_entry_id;
  END IF;

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
  'SEC-01 command: the only client-reachable way to write a balanced journal entry. Enforces can_write_financial_data, >=2 lines, a balanced functional-currency total, tenant-owned accounts/currency/branch/department and the period lock; idempotent on posting_key. Typed for BOTH journal_entries.source_id shapes (text in the repository schema, uuid in production).';

REVOKE ALL ON FUNCTION public.post_financial_journal(
  uuid, date, text, text, text, text, jsonb, text, numeric, uuid, uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_financial_journal(
  uuid, date, text, text, text, text, jsonb, text, numeric, uuid, uuid, text, text, text
) TO authenticated, service_role;

-- ── 2. Post an existing draft (uuid/text-safe posted_by) ────────────────────
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
         posted_by = CASE
           -- p_posted_by is a text parameter and posted_by a uuid column on the
           -- live shape: cast when it looks like a user id, else attribute the
           -- posting to the caller rather than failing the transition.
           WHEN btrim(coalesce(p_posted_by, ''))
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN btrim(p_posted_by)::uuid
           ELSE v_user
         END
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
  'SEC-01 command: draft→posted transition for a financial writer. Refuses any non-draft entry; trg_aa_period_lock refuses a closed period. Writes posted_by as a uuid expression, which both column shapes accept.';

REVOKE ALL ON FUNCTION public.post_draft_financial_journal(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_draft_financial_journal(uuid, text)
  TO authenticated, service_role;

-- ── 3. Re-assign a cost centre (uuid/text-safe source_id lookup) ────────────
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
  -- source_id is uuid on the live shape: compare as text so the '^...$' test
  -- works on both shapes, and cast back only when linking the source document.
  IF v_entry.source_id IS NOT NULL AND v_entry.source_id::text ~ '^[0-9a-fA-F-]{36}$' THEN
    IF v_entry.source_type = 'invoice' THEN
      UPDATE public.invoices SET branch_id = p_branch_id, department_id = p_department_id
       WHERE id = (v_entry.source_id::text)::uuid AND business_id = v_entry.business_id;
    ELSIF v_entry.source_type = 'expense' THEN
      UPDATE public.expenses SET branch_id = p_branch_id, department_id = p_department_id
       WHERE id = (v_entry.source_id::text)::uuid AND business_id = v_entry.business_id;
    ELSIF v_entry.source_type = 'payroll' THEN
      UPDATE public.payroll_runs SET branch_id = p_branch_id, department_id = p_department_id
       WHERE id = (v_entry.source_id::text)::uuid AND business_id = v_entry.business_id;
    END IF;
  END IF;

  RETURN p_entry_id;
END;
$$;

COMMENT ON FUNCTION public.assign_financial_journal_cost_centre(uuid, uuid, uuid) IS
  'SEC-01 command: assigns a branch/department to a journal entry, all of its lines and the document that produced it, for a financial writer. Tenant-scoped on business_id, period-locked, and typed for both journal_entries.source_id shapes.';

REVOKE ALL ON FUNCTION public.assign_financial_journal_cost_centre(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_financial_journal_cost_centre(uuid, uuid, uuid)
  TO authenticated, service_role;
