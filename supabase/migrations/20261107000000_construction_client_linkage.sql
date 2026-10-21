-- 20261107000000_construction_client_linkage.sql
--
-- P2-3: Link construction projects to contacts (clients).
--
-- WHAT THIS MIGRATION DOES
--   1. Adds construction_projects.client_id — a NULLABLE FK to contacts with
--      ON DELETE SET NULL (tender-stage projects may exist before the client
--      is in the system; client_name covers that case).
--   2. Backfills client_id by exact case-insensitive name match against
--      customer/both contacts of the SAME business — the same matching
--      _ledgr_construction_billing_contact uses. Ambiguous (multiple matches)
--      and unmatched projects are reported with RAISE NOTICE and left NULL.
--      No contacts are created during backfill.
--   3. Adds _ledgr_resolve_construction_client(p_project_id): prefers the FK,
--      falls back to the existing name bridge when client_id is NULL or
--      points at a deleted/wrong-type/foreign-business contact, and backfills
--      the FK after a successful bridge resolution.
--   4. Rewires generate_invoice_from_valuation to call the resolver instead
--      of the bridge directly. Function body otherwise byte-identical to
--      20261031000001 (single call swapped); signature and grants unchanged.
--   5. Extends create_project/update_project with p_client_id uuid DEFAULT
--      NULL so the RPC write path (table writes are REVOKEd from
--      authenticated) can carry the link. When p_client_id is provided the
--      contact is validated (same business, customer/both, not deleted) and
--      client_name is cached from the contact's name server-side. Positional
--      8-argument callers keep working via the DEFAULT.
--   6. Refreshes the public.projects compatibility view (guarded: only when
--      it is the security_invoker view, same guard as 20261030000000) so it
--      carries client_id.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   * Does NOT touch _ledgr_construction_billing_contact: signature, body
--     and ACLs stay exactly as 20261031000001 shipped them. It remains the
--     fallback inside the resolver.
--   * Does NOT drop or alter client_name: it stays NOT NULL DEFAULT '' as
--     the display cache and bridge fallback (constraint 9).
--   * Does NOT auto-create contacts during backfill (constraint 8).
--   * Does NOT touch grant_construction_procurement_capability, self-grant
--     rules or capability_overrides.
--   * Does NOT add client_id to any other table, and does NOT change the
--     contacts schema (the 'both' contact_type is already accepted by its
--     CHECK; only the UI exposes it, in this release's frontend changes).
--   * release_retention keeps calling the bridge directly (out of P2-3
--     scope); once the resolver backfills client_id on first valuation
--     billing, both paths resolve the same contact by construction.
--
-- Tenant hardening (deliberate, flagged in the PR): the resolver's FK
-- validity check includes business_id — an FK pointing at another tenant's
-- contact falls through to the name bridge instead of being trusted. It
-- deliberately does NOT require is_active: an explicitly linked but
-- deactivated client must not fall through to the bridge, which would
-- CREATE a duplicate contact — the exact failure mode P2-3 eliminates.
--
-- Layer: schema migration + RPC rewiring, applied by the normal migration
-- replay.

-- ── 1. The FK column ────────────────────────────────────────────────────────

ALTER TABLE public.construction_projects
  ADD COLUMN IF NOT EXISTS client_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_construction_projects_client_id
  ON public.construction_projects(client_id);

COMMENT ON COLUMN public.construction_projects.client_id IS
  'FK to contacts. Preferred over client_name for billing. Nullable for tender-stage projects.';

-- ── 2. Backfill: exact case-insensitive name match, report-not-guess ────────

DO $client_linkage_backfill$
DECLARE
  proj RECORD;
  matched_id uuid;
  match_count int;
BEGIN
  FOR proj IN
    SELECT id, client_name
    FROM public.construction_projects
    WHERE client_id IS NULL
      AND client_name IS NOT NULL
      AND trim(client_name) != ''
  LOOP
    SELECT c.id, count(*) OVER()
    INTO matched_id, match_count
    FROM public.contacts c
    WHERE c.business_id = (SELECT business_id FROM public.construction_projects WHERE id = proj.id)
      AND c.contact_type IN ('customer', 'both')
      AND c.deleted_at IS NULL
      AND lower(trim(c.name)) = lower(trim(proj.client_name))
    LIMIT 1;

    IF match_count = 1 THEN
      UPDATE public.construction_projects SET client_id = matched_id WHERE id = proj.id;
    ELSIF match_count > 1 THEN
      RAISE NOTICE 'AMBIGUOUS: project % client_name "%" matches % contacts — skipped',
        proj.id, proj.client_name, match_count;
    ELSE
      RAISE NOTICE 'NO MATCH: project % client_name "%" — skipped',
        proj.id, proj.client_name;
    END IF;
  END LOOP;
END
$client_linkage_backfill$;

-- ── 3. The resolver: prefer the FK, fall back to the frozen name bridge ─────

CREATE OR REPLACE FUNCTION public._ledgr_resolve_construction_client(
  p_project_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_id uuid;
  v_client_name text;
  v_business_id uuid;
  v_resolved_id uuid;
BEGIN
  SELECT client_id, client_name, business_id
  INTO v_client_id, v_client_name, v_business_id
  FROM public.construction_projects
  WHERE id = p_project_id;

  -- Prefer the FK
  IF v_client_id IS NOT NULL THEN
    -- Verify the contact still exists, belongs to the same business and is
    -- still a billing-eligible type. is_active is deliberately NOT checked:
    -- an explicitly linked, deactivated client must not fall through to the
    -- bridge, which would create a duplicate contact.
    IF EXISTS (
      SELECT 1 FROM public.contacts
      WHERE id = v_client_id
        AND business_id = v_business_id
        AND contact_type IN ('customer', 'both')
        AND deleted_at IS NULL
    ) THEN
      RETURN v_client_id;
    END IF;
    -- FK points to a deleted/invalid contact — fall through to name match
  END IF;

  -- Fallback: existing name-match bridge (unchanged, 20261031000001)
  IF v_client_name IS NOT NULL AND trim(v_client_name) != '' THEN
    v_resolved_id := public._ledgr_construction_billing_contact(v_business_id, v_client_name);
    -- If the name bridge resolved or created a contact, backfill the FK for next time
    IF v_resolved_id IS NOT NULL THEN
      UPDATE public.construction_projects
      SET client_id = v_resolved_id
      WHERE id = p_project_id AND client_id IS NULL;
    END IF;
    RETURN v_resolved_id;
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public._ledgr_resolve_construction_client IS
  'Resolves the billing contact for a construction project. Prefers client_id FK; falls back to _ledgr_construction_billing_contact name bridge.';

REVOKE ALL ON FUNCTION public._ledgr_resolve_construction_client(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ledgr_resolve_construction_client(uuid)
  TO authenticated;

-- ── 4. RPC write path carries the link ──────────────────────────────────────
-- Table-level writes are REVOKEd from authenticated (20261028000001), so
-- client_id must ride create_project/update_project. The new trailing
-- parameter defaults to NULL; existing positional callers are unaffected.
-- Old 8-argument signatures are dropped to avoid PostgREST overload
-- ambiguity. Error messages and SQLSTATEs for the legacy paths are
-- preserved verbatim.

DROP FUNCTION IF EXISTS public.create_project(uuid,text,text,numeric,numeric,numeric,date,date);
CREATE FUNCTION public.create_project(p_business_id uuid, p_name text, p_client_name text,
 p_contract_sum numeric, p_retention_pct numeric, p_budget numeric, p_start_date date, p_end_date date,
 p_client_id uuid DEFAULT NULL)
 RETURNS public.construction_projects LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid; v_row public.construction_projects; v_linked_name text;
BEGIN
 v_actor := public._ledgr_construction_actor(p_business_id,'procurement.master.manage');
 IF p_client_id IS NOT NULL THEN
  SELECT c.name INTO v_linked_name FROM public.contacts c
   WHERE c.id = p_client_id AND c.business_id = p_business_id
     AND c.contact_type IN ('customer','both') AND c.deleted_at IS NULL;
  IF v_linked_name IS NULL THEN
   RAISE EXCEPTION 'Linked client contact was not found for this business.' USING ERRCODE = '22023'; END IF;
 END IF;
 IF p_name IS NULL OR btrim(p_name) = '' OR (p_client_id IS NULL AND (p_client_name IS NULL OR btrim(p_client_name) = '')) THEN
  RAISE EXCEPTION 'Project name and client name are required.' USING ERRCODE = '22023'; END IF;
 IF p_contract_sum IS NULL OR p_contract_sum = 'NaN'::numeric OR p_contract_sum < 0 OR p_budget IS NULL OR p_budget = 'NaN'::numeric OR p_budget < 0 OR p_retention_pct IS NULL OR p_retention_pct NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Contract sum and budget must be non-negative; retention must be between 0 and 100.' USING ERRCODE = '22023'; END IF;
 IF p_start_date > p_end_date THEN RAISE EXCEPTION 'End date must be on or after start date.' USING ERRCODE = '22023'; END IF;
 INSERT INTO public.construction_projects(business_id,name,client_name,contract_sum,retention_pct,budget,start_date,end_date,created_by,client_id)
 VALUES(p_business_id,btrim(p_name),btrim(COALESCE(v_linked_name,p_client_name)),p_contract_sum,p_retention_pct,p_budget,p_start_date,p_end_date,v_actor,p_client_id) RETURNING * INTO v_row;
 RETURN v_row;
END $$;

DROP FUNCTION IF EXISTS public.update_project(uuid,text,text,numeric,numeric,numeric,date,date);
CREATE FUNCTION public.update_project(p_project_id uuid, p_name text, p_client_name text,
 p_contract_sum numeric, p_retention_pct numeric, p_budget numeric, p_start_date date, p_end_date date,
 p_client_id uuid DEFAULT NULL)
 RETURNS public.construction_projects LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.construction_projects; v_linked_name text;
BEGIN
 SELECT * INTO v_row FROM public.construction_projects WHERE id = p_project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002'; END IF;
 PERFORM public._ledgr_construction_actor(v_row.business_id,'procurement.master.manage');
 IF p_client_id IS NOT NULL THEN
  SELECT c.name INTO v_linked_name FROM public.contacts c
   WHERE c.id = p_client_id AND c.business_id = v_row.business_id
     AND c.contact_type IN ('customer','both') AND c.deleted_at IS NULL;
  IF v_linked_name IS NULL THEN
   RAISE EXCEPTION 'Linked client contact was not found for this business.' USING ERRCODE = '22023'; END IF;
 END IF;
 IF p_name IS NULL OR btrim(p_name) = '' OR (p_client_id IS NULL AND (p_client_name IS NULL OR btrim(p_client_name) = '')) THEN
  RAISE EXCEPTION 'Project name and client name are required.' USING ERRCODE = '22023'; END IF;
 IF p_contract_sum IS NULL OR p_contract_sum = 'NaN'::numeric OR p_contract_sum < 0 OR p_budget IS NULL OR p_budget = 'NaN'::numeric OR p_budget < 0 OR p_retention_pct IS NULL OR p_retention_pct NOT BETWEEN 0 AND 100 THEN
  RAISE EXCEPTION 'Contract sum and budget must be non-negative; retention must be between 0 and 100.' USING ERRCODE = '22023'; END IF;
 IF p_start_date > p_end_date THEN RAISE EXCEPTION 'End date must be on or after start date.' USING ERRCODE = '22023'; END IF;
 -- p_client_id NULL is an explicit unlink: the FK is cleared while the
 -- client_name display cache survives (constraint: never auto-clear the
 -- cache; the caller passes the retained text).
 UPDATE public.construction_projects SET name=btrim(p_name),client_name=btrim(COALESCE(v_linked_name,p_client_name)),contract_sum=p_contract_sum,
 retention_pct=p_retention_pct,budget=p_budget,start_date=p_start_date,end_date=p_end_date,client_id=p_client_id,updated_at=now()
 WHERE id=p_project_id RETURNING * INTO v_row;
 RETURN v_row;
END $$;

REVOKE ALL ON FUNCTION public.create_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.update_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid) TO authenticated;

-- ── 5. Valuation invoicing now resolves through the FK-first resolver ───────
-- Byte-identical to 20261031000001 except the single billing-contact call.
-- CREATE OR REPLACE keeps the existing signature and ACLs (the 20261031000001
-- tail block already granted EXECUTE to authenticated).

CREATE OR REPLACE FUNCTION public.generate_invoice_from_valuation(p_valuation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valuation public.project_valuations%ROWTYPE;
  v_project public.construction_projects%ROWTYPE;
  v_actor uuid;
  v_contact_id uuid;
  v_currency text;
  v_ar_account_id uuid;
  v_revenue_account_id uuid;
  v_retention_account_id uuid;
  v_credit_note_for uuid;
  v_invoice_type text;
  v_invoice_header jsonb;
  v_invoice_lines jsonb;
  v_invoice_result jsonb;
  v_invoice_id uuid;
  v_invoice_number text;
BEGIN
  SELECT * INTO v_valuation
    FROM public.project_valuations v
   WHERE v.id = p_valuation_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Valuation not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_project
    FROM public.construction_projects p
   WHERE p.id = v_valuation.project_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._ledgr_project_valuation_actor(
    v_project.business_id, ARRAY['procurement.master.manage']::text[]
  );

  -- An idempotent replay returns the committed invoice instead of creating a
  -- second invoice after a browser timeout.
  IF v_valuation.status = 'invoiced' AND v_valuation.invoice_id IS NOT NULL THEN
    RETURN public._ledgr_project_valuation_payload(v_valuation.id);
  END IF;
  IF v_valuation.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only submitted valuations can generate an invoice.' USING ERRCODE = '55000';
  END IF;

  -- P2-3: prefer the client_id FK; the name bridge remains the fallback.
  v_contact_id := public._ledgr_resolve_construction_client(v_project.id);
  SELECT b.base_currency INTO v_currency
    FROM public.businesses b
   WHERE b.id = v_project.business_id;
  v_currency := COALESCE(v_currency, 'MWK');

  SELECT a.id INTO v_ar_account_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND a.code = '1131'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_ar_account_id IS NULL THEN
    RAISE EXCEPTION 'Trade Debtors account 1131 is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;
  SELECT a.id INTO v_revenue_account_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND a.code = '4114'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_revenue_account_id IS NULL THEN
    SELECT a.id INTO v_revenue_account_id
      FROM public.accounts a
     WHERE a.business_id = v_project.business_id
       AND a.code = '4112'
       AND a.is_active AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
  END IF;
  IF v_revenue_account_id IS NULL THEN
    RAISE EXCEPTION 'Contract Revenue account is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;

  SELECT a.id INTO v_retention_account_id
    FROM public.accounts a
   WHERE a.business_id = v_project.business_id
     AND lower(btrim(a.name)) = lower('Retention Receivable')
     AND a.account_subtype = 'contra_ar'
     AND a.is_active AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_retention_account_id IS NULL THEN
    RAISE EXCEPTION 'Retention Receivable is missing from the Chart of Accounts.' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'line_number', q.line_number,
      'description', q.description || format(' (Valuation V-%s, %s%% complete)',
        lpad(v_valuation.valuation_number::text, 3, '0'),
        trim(to_char(q.cumulative_pct, 'FM990.00'))),
      'quantity', 1,
      'unit_price', abs(q.period_value),
      'discount_percent', 0,
      'discount_amount', 0,
      'line_subtotal', q.period_value,
      'tax_code', 'none',
      'tax_rate', 0,
      'tax_amount', 0,
      'line_total', q.period_value,
      'product_id', NULL,
      'account_id', v_revenue_account_id
    ) ORDER BY q.line_number), '[]'::jsonb)
    INTO v_invoice_lines
    FROM (
      SELECT row_number() OVER (ORDER BY b.sort_order, b.line_number, b.id)::integer AS line_number,
             b.description,
             vl.cumulative_pct,
             vl.period_value
        FROM public.project_valuation_lines vl
        JOIN public.project_boq_lines b ON b.id = vl.boq_line_id
       WHERE vl.valuation_id = v_valuation.id
         AND vl.period_value <> 0
    ) q;

  -- Invoice line quantity and unit_price stay non-negative per the existing
  -- Income schema. Signed period values are carried by line_subtotal/line_total.
  -- Retention is a separate signed deduction using the provisioned Retention
  -- Receivable account. A net-negative valuation becomes an existing-system
  -- credit_note: its signed per-account line values are inverted, so their net
  -- is positive while the existing revenue header totals remain negative.
  IF v_valuation.retention_amount <> 0 THEN
    v_invoice_lines := v_invoice_lines || jsonb_build_array(jsonb_build_object(
      'line_number', jsonb_array_length(v_invoice_lines) + 1,
      'description', CASE WHEN v_valuation.retention_amount > 0
        THEN format('Retention withheld (%s%%)', to_char(v_project.retention_pct, 'FM990.00'))
        ELSE 'Retention adjustment for downward valuation correction'
      END,
      'quantity', 1,
      'unit_price', abs(v_valuation.retention_amount),
      'discount_percent', 0,
      'discount_amount', 0,
      'line_subtotal', -v_valuation.retention_amount,
      'tax_code', 'none',
      'tax_rate', 0,
      'tax_amount', 0,
      'line_total', -v_valuation.retention_amount,
      'product_id', NULL,
      'account_id', v_retention_account_id
    ));
  END IF;

  IF v_valuation.net_amount < 0 THEN
    v_invoice_type := 'credit_note';
    SELECT prior.invoice_id INTO v_credit_note_for
      FROM public.project_valuations prior
     WHERE prior.project_id = v_project.id
       AND prior.valuation_number < v_valuation.valuation_number
       AND prior.invoice_id IS NOT NULL
     ORDER BY prior.valuation_number DESC
     LIMIT 1;
    -- Keep the per-account construction breakdown (including Retention
    -- Receivable) and invert its signed amounts into the existing credit-note
    -- convention: positive line values are debits, negative values are credits.
    SELECT COALESCE(jsonb_agg(
        jsonb_set(
          jsonb_set(value, '{line_subtotal}', to_jsonb(-((value->>'line_subtotal')::numeric))),
          '{line_total}', to_jsonb(-((value->>'line_total')::numeric))
        ) ORDER BY (value->>'line_number')::integer
      ), '[]'::jsonb)
      INTO v_invoice_lines
      FROM jsonb_array_elements(v_invoice_lines) AS item(value);
  ELSE
    v_invoice_type := 'invoice';
    v_credit_note_for := NULL;
  END IF;

  IF jsonb_array_length(v_invoice_lines) = 0 THEN
    RAISE EXCEPTION 'A zero-value valuation cannot generate an invoice.' USING ERRCODE = '22023';
  END IF;

  v_invoice_header := jsonb_build_object(
    'business_id', v_project.business_id,
    'invoice_type', v_invoice_type,
    'credit_note_for', v_credit_note_for,
    'status', 'draft',
    'contact_id', v_contact_id,
    'issue_date', v_valuation.valuation_date,
    'due_date', NULL,
    'currency', v_currency,
    'exchange_rate', 1,
    'original_currency', v_currency,
    'original_amount', v_valuation.net_amount,
    'functional_currency', v_currency,
    'functional_amount', v_valuation.net_amount,
    'rate_date', v_valuation.valuation_date,
    'rate_is_stale', false,
    'subtotal', v_valuation.net_amount,
    'discount_amount', 0,
    'discount_percent', 0,
    'taxable_amount', v_valuation.net_amount,
    'vat_amount', 0,
    'wht_amount', 0,
    'total_amount', v_valuation.net_amount,
    'amount_due', v_valuation.net_amount,
    'amount_paid', 0,
    'ar_account_id', v_ar_account_id,
    'revenue_account_id', v_revenue_account_id,
    'notes', concat('Construction project ', v_project.name, ' — valuation V-', lpad(v_valuation.valuation_number::text, 3, '0'),
      CASE WHEN nullif(btrim(v_valuation.notes), '') IS NULL THEN '' ELSE E'\n' || btrim(v_valuation.notes) END),
    'project_code', v_project.id::text,
    'template', 'professional',
    'created_by', v_actor::text
  );

  -- This invokes the existing atomic Income invoice command. It handles the
  -- invoice number, header, lines, RLS boundary, and client-key replay.
  v_invoice_result := public.create_invoice_with_lines(
    v_invoice_header, v_invoice_lines, v_valuation.id
  );
  v_invoice_id := (v_invoice_result->'invoice'->>'id')::uuid;
  v_invoice_number := v_invoice_result->'invoice'->>'invoice_number';
  IF v_invoice_id IS NULL THEN
    RAISE EXCEPTION 'The existing invoice command returned no invoice.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.project_valuations
     SET invoice_id = v_invoice_id, status = 'invoiced', updated_at = now()
   WHERE id = v_valuation.id;
  UPDATE public.project_retention_ledger
     SET invoice_id = v_invoice_id
   WHERE valuation_id = v_valuation.id;
  RETURN public._ledgr_project_valuation_payload(v_valuation.id);
END;
$$;

-- ── 6. Compatibility view refresh (guarded, same pattern as 20261030000000) ─

DO $refresh_projects_compatibility_view$
DECLARE v_projects_oid oid := to_regclass('public.projects');
BEGIN
 IF v_projects_oid IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_class
       WHERE oid = v_projects_oid
         AND relkind = 'v'
         AND reloptions @> ARRAY['security_invoker=true']
    )
    AND obj_description(v_projects_oid, 'pg_class') = 'Ledgr construction projects compatibility view' THEN
  EXECUTE 'CREATE OR REPLACE VIEW public.projects WITH (security_invoker = true) AS SELECT * FROM public.construction_projects';
 END IF;
END
$refresh_projects_compatibility_view$;

-- ── 7. Replay verifier ──────────────────────────────────────────────────────

DO $client_linkage_verify$
DECLARE
  v_definition text;
  v_confdel "char";
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'construction_projects'
       AND column_name = 'client_id' AND data_type = 'uuid' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'construction_projects.client_id must exist as a nullable uuid column.';
  END IF;

  SELECT c.confdeltype INTO v_confdel
    FROM pg_constraint c
   WHERE c.conrelid = 'public.construction_projects'::regclass
     AND c.confrelid = 'public.contacts'::regclass
     AND c.contype = 'f';
  IF v_confdel IS NULL OR v_confdel <> 'n' THEN
    RAISE EXCEPTION 'client_id must reference contacts(id) with ON DELETE SET NULL.';
  END IF;

  IF to_regclass('public.idx_construction_projects_client_id') IS NULL THEN
    RAISE EXCEPTION 'idx_construction_projects_client_id is missing.';
  END IF;

  -- client_name survives as the display cache (constraint 9).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'construction_projects'
       AND column_name = 'client_name' AND is_nullable = 'NO'
       AND column_default = '''''::text'
  ) THEN
    RAISE EXCEPTION 'client_name must remain NOT NULL DEFAULT ''''.';
  END IF;

  -- The frozen bridge keeps its exact signature and stays unexecutable by
  -- callers other than definer-internal use.
  IF to_regprocedure('public._ledgr_construction_billing_contact(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'The billing bridge signature must not change.';
  END IF;
  IF has_function_privilege('authenticated', 'public._ledgr_construction_billing_contact(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'The billing bridge must not be executable by authenticated.';
  END IF;

  -- The resolver exists, prefers the FK and wires the bridge as fallback.
  IF to_regprocedure('public._ledgr_resolve_construction_client(uuid)') IS NULL THEN
    RAISE EXCEPTION 'The client resolver RPC is missing.';
  END IF;
  v_definition := lower(pg_get_functiondef('public._ledgr_resolve_construction_client(uuid)'::regprocedure));
  IF position('client_id' IN v_definition) = 0
     OR position('public._ledgr_construction_billing_contact' IN v_definition) = 0
     OR position('business_id = v_business_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'The resolver must prefer the FK, tenant-check it, and fall back to the bridge.';
  END IF;

  -- Valuation invoicing goes through the resolver and no longer calls the
  -- bridge directly, while keeping the atomic invoice command wiring the
  -- 20261031000001 verifier pins.
  v_definition := lower(pg_get_functiondef('public.generate_invoice_from_valuation(uuid)'::regprocedure));
  IF position('public._ledgr_resolve_construction_client' IN v_definition) = 0
     OR position('_ledgr_construction_billing_contact' IN v_definition) <> 0
     OR position('create_invoice_with_lines' IN v_definition) = 0
     OR position('credit_note' IN v_definition) = 0
     OR position('v_retention_account_id' IN v_definition) = 0
     OR position('only submitted valuations can generate an invoice' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Valuation invoicing must resolve clients through the FK-first resolver.';
  END IF;

  -- The RPC write path carries the link with backward-compatible defaults.
  IF to_regprocedure('public.create_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid)') IS NULL
     OR to_regprocedure('public.update_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid)') IS NULL THEN
    RAISE EXCEPTION 'create_project/update_project must accept p_client_id.';
  END IF;
  IF to_regprocedure('public.create_project(uuid,text,text,numeric,numeric,numeric,date,date)') IS NOT NULL
     OR to_regprocedure('public.update_project(uuid,text,text,numeric,numeric,numeric,date,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'The old 8-argument project RPC overloads must be dropped (PostgREST ambiguity).';
  END IF;
  v_definition := lower(pg_get_functiondef('public.create_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid)'::regprocedure));
  IF position('p_client_id uuid default null' IN v_definition) = 0
     OR position('linked client contact was not found for this business' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'create_project must validate the linked contact against the project business.';
  END IF;
  v_definition := lower(pg_get_functiondef('public.update_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid)'::regprocedure));
  IF position('p_client_id uuid default null' IN v_definition) = 0
     OR position('client_id=p_client_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'update_project must persist explicit link and unlink intent.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public._ledgr_resolve_construction_client(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Project RPCs and the resolver must stay executable by authenticated.';
  END IF;
END;
$client_linkage_verify$;
