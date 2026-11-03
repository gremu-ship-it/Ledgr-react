-- 20261105000001_manufacturing_work_orders.sql
--
-- Manufacturing Phase C — Work Orders & Production (single-level, material cost
-- only, backflush by default).
--
-- WHAT THIS MIGRATION DOES
--   1. Creates the four work-order tables: header, frozen BOM lines, optional
--      production runs, and material transactions.
--   2. Adds indexes, RLS (the Phase B business_members pattern) and grants.
--   3. Reuses public.set_updated_at() for the header's updated_at trigger.
--   4. Creates the ten work-order commands: create, release, start, record run,
--      record consumption, record return, complete, close, cancel, yield.
--
-- INTEGRATION POINTS (discovered — nothing parallel is introduced)
--   * INVENTORY: public.stock_movements is the single inventory transaction
--     table. A row inserted here is propagated to public.inventory_balances by
--     the one authoritative writer, trg_stock_movement_apply_balance ->
--     public._ledgr_apply_stock_movement_balance() (20260928000001 R06).
--     Quantities are SIGNED — inbound positive, outbound negative. No second
--     balance writer is installed and public.inventory_balances is never
--     written directly.
--   * LEDGER: public.journal_entries / public.journal_lines are posted through
--     the existing public._ledgr_post_entry_keyed(...) (20261015000000), which
--     is post-or-resume under the deterministic posting_key and delegates to
--     public._ledgr_post_entry(...). Entries are created already 'posted';
--     nothing UPDATEs a posted entry, so reversals are new reversing entries.
--   * ACCOUNTS: WIP Inventory (Phase A, first free code in 1200-1299, found by
--     name), Raw Materials (1143), Finished Goods (1142), both falling back to
--     Trading Stock (1141).
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO (Phase C scope)
--   * No multi-level BOM explosion — single level only.
--   * No labour or overhead absorption — material cost only (deferred to v2).
--   * No batch/lot, no machine/equipment, no scheduling or capacity planning.
--   * No new capability code — the surface stays behind manufacturing.bom.manage
--     and the MANUFACTURING operating model.
--   * No construction table, function or policy mutation.
--   * No change to the products.product_type CHECK constraint.
--   * No change to the Phase B manufacturing_boms / manufacturing_bom_lines
--     tables other than writing manufacturing_boms.bom_locked_at, which Phase B
--     reserved for exactly this phase.
--   * No physical stock routed through the Production Floor location: WIP is an
--     accounting concept. Materials come from the source location (default Raw
--     Materials Store) and output goes to the destination location (default
--     Finished Goods Store).
--
-- Layer: schema + command migration.
-- ============================================================================

-- ============================================================================
-- 0. Compatibility: business_members view for RLS policies
-- ============================================================================
-- Phase B (20261104000000) installs this projection of public.business_users so
-- the shipped membership table and the manufacturing policy text agree. It is
-- re-asserted here so this file stays replayable on its own; if the view
-- already exists this is a no-op.
DO $$
BEGIN
  IF to_regclass('public.business_members') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW public.business_members AS
      SELECT
        business_id,
        user_id,
        role,
        branch_id,
        is_active
      FROM public.business_users
    $view$;
  END IF;
END
$$;

-- ============================================================================
-- 2a. Work orders table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.manufacturing_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  work_order_number text NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  bom_id uuid NOT NULL REFERENCES public.manufacturing_boms(id) ON DELETE RESTRICT,
  planned_quantity numeric NOT NULL
    CONSTRAINT manufacturing_wo_qty_positive CHECK (planned_quantity > 0),
  completed_quantity numeric NOT NULL DEFAULT 0
    CONSTRAINT manufacturing_wo_completed_nonneg CHECK (completed_quantity >= 0),
  scrapped_quantity numeric NOT NULL DEFAULT 0
    CONSTRAINT manufacturing_wo_scrapped_nonneg CHECK (scrapped_quantity >= 0),
  status text NOT NULL DEFAULT 'draft'
    CONSTRAINT manufacturing_wo_status_check
    CHECK (status IN ('draft', 'released', 'in_progress', 'completed', 'closed', 'cancelled')),
  planned_start_date date,
  planned_end_date date,
  actual_start_date timestamptz,
  actual_end_date timestamptz,
  from_location_id uuid REFERENCES public.inventory_locations(id),
  to_location_id uuid REFERENCES public.inventory_locations(id),
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, work_order_number)
);

COMMENT ON TABLE public.manufacturing_work_orders IS
  'A manufacturing work order: one output product made to a frozen bill of materials. Forward-only lifecycle draft -> released -> in_progress -> completed -> closed, plus cancelled from any non-closed state.';

-- ============================================================================
-- 2b. Work order lines (frozen BOM)
-- ============================================================================
-- Populated once, at release, by exploding the active BOM. Quantities are fixed
-- at that moment, so a later BOM revision cannot change an open work order.
CREATE TABLE IF NOT EXISTS public.manufacturing_work_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL
    REFERENCES public.manufacturing_work_orders(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  planned_quantity numeric NOT NULL
    CONSTRAINT manufacturing_wo_line_qty_positive CHECK (planned_quantity > 0),
  actual_quantity_consumed numeric NOT NULL DEFAULT 0
    CONSTRAINT manufacturing_wo_line_consumed_nonneg
    CHECK (actual_quantity_consumed >= 0),
  unit_of_measure text,
  scrap_pct numeric NOT NULL DEFAULT 0
    CONSTRAINT manufacturing_wo_line_scrap_check
    CHECK (scrap_pct >= 0 AND scrap_pct < 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, component_product_id)
);

COMMENT ON TABLE public.manufacturing_work_order_lines IS
  'The BOM as it stood when the work order was released: component, scrap-inflated planned quantity for the whole order, and consumption recorded against it.';

-- ============================================================================
-- 2c. Production runs
-- ============================================================================
-- Optional. A work order may complete with no explicit run at all (one implicit
-- batch); runs exist only when the shop floor wants per-batch yield and scrap.
CREATE TABLE IF NOT EXISTS public.manufacturing_production_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL
    REFERENCES public.manufacturing_work_orders(id) ON DELETE CASCADE,
  run_number integer NOT NULL
    CONSTRAINT manufacturing_run_number_positive CHECK (run_number > 0),
  output_quantity numeric NOT NULL
    CONSTRAINT manufacturing_run_output_positive CHECK (output_quantity > 0),
  scrap_quantity numeric NOT NULL DEFAULT 0
    CONSTRAINT manufacturing_run_scrap_nonneg CHECK (scrap_quantity >= 0),
  status text NOT NULL DEFAULT 'completed'
    CONSTRAINT manufacturing_run_status_check
    CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id, run_number)
);

COMMENT ON TABLE public.manufacturing_production_runs IS
  'Optional per-batch output and scrap for a work order. Absent runs mean the order was completed as a single implicit batch.';

-- ============================================================================
-- 2d. Material transactions
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.manufacturing_material_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL
    REFERENCES public.manufacturing_work_orders(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.manufacturing_production_runs(id)
    ON DELETE SET NULL,
  component_product_id uuid NOT NULL
    REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL
    CONSTRAINT manufacturing_mat_txn_qty_positive CHECK (quantity > 0),
  transaction_type text NOT NULL
    CONSTRAINT manufacturing_mat_txn_type_check
    CHECK (transaction_type IN ('consume', 'return', 'adjustment')),
  from_location_id uuid REFERENCES public.inventory_locations(id),
  to_location_id uuid REFERENCES public.inventory_locations(id),
  recorded_by uuid NOT NULL REFERENCES auth.users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

COMMENT ON TABLE public.manufacturing_material_transactions IS
  'Every material movement against a work order: backflushed consumption, manual consumption, and returns. Quantity is always positive; the type states the direction.';

-- ============================================================================
-- 2e. Indexes
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_mfg_wo_business
  ON public.manufacturing_work_orders(business_id);
CREATE INDEX IF NOT EXISTS idx_mfg_wo_product
  ON public.manufacturing_work_orders(product_id);
CREATE INDEX IF NOT EXISTS idx_mfg_wo_status
  ON public.manufacturing_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_mfg_wo_lines_wo
  ON public.manufacturing_work_order_lines(work_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_runs_wo
  ON public.manufacturing_production_runs(work_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_mat_txn_wo
  ON public.manufacturing_material_transactions(work_order_id);
CREATE INDEX IF NOT EXISTS idx_mfg_mat_txn_run
  ON public.manufacturing_material_transactions(run_id);

-- ============================================================================
-- 2f. RLS — the Phase B business_members pattern, verbatim in shape
-- ============================================================================
-- Read for every member of the business; write for owner / admin / manager.
-- The three child tables reach the business through work_order_id, exactly as
-- manufacturing_bom_lines reaches it through bom_id.
ALTER TABLE public.manufacturing_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_work_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_production_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturing_material_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS manufacturing_work_orders_member_read ON public.manufacturing_work_orders;
CREATE POLICY manufacturing_work_orders_member_read
  ON public.manufacturing_work_orders FOR SELECT TO authenticated
  USING (business_id IN (
    SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS manufacturing_work_orders_member_write ON public.manufacturing_work_orders;
CREATE POLICY manufacturing_work_orders_member_write
  ON public.manufacturing_work_orders FOR ALL TO authenticated
  USING (business_id IN (
    SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
  ))
  WITH CHECK (business_id IN (
    SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
  ));

DROP POLICY IF EXISTS manufacturing_work_order_lines_member_read ON public.manufacturing_work_order_lines;
CREATE POLICY manufacturing_work_order_lines_member_read
  ON public.manufacturing_work_order_lines FOR SELECT TO authenticated
  USING (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid()
    )
  ));

DROP POLICY IF EXISTS manufacturing_work_order_lines_member_write ON public.manufacturing_work_order_lines;
CREATE POLICY manufacturing_work_order_lines_member_write
  ON public.manufacturing_work_order_lines FOR ALL TO authenticated
  USING (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ))
  WITH CHECK (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ));

DROP POLICY IF EXISTS manufacturing_production_runs_member_read ON public.manufacturing_production_runs;
CREATE POLICY manufacturing_production_runs_member_read
  ON public.manufacturing_production_runs FOR SELECT TO authenticated
  USING (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid()
    )
  ));

DROP POLICY IF EXISTS manufacturing_production_runs_member_write ON public.manufacturing_production_runs;
CREATE POLICY manufacturing_production_runs_member_write
  ON public.manufacturing_production_runs FOR ALL TO authenticated
  USING (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ))
  WITH CHECK (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ));

DROP POLICY IF EXISTS manufacturing_material_transactions_member_read ON public.manufacturing_material_transactions;
CREATE POLICY manufacturing_material_transactions_member_read
  ON public.manufacturing_material_transactions FOR SELECT TO authenticated
  USING (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid()
    )
  ));

DROP POLICY IF EXISTS manufacturing_material_transactions_member_write ON public.manufacturing_material_transactions;
CREATE POLICY manufacturing_material_transactions_member_write
  ON public.manufacturing_material_transactions FOR ALL TO authenticated
  USING (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ))
  WITH CHECK (work_order_id IN (
    SELECT id FROM public.manufacturing_work_orders
    WHERE business_id IN (
      SELECT business_id FROM public.business_members
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')
    )
  ));

-- ============================================================================
-- 2g. Grants
-- ============================================================================
REVOKE ALL ON public.manufacturing_work_orders,
  public.manufacturing_work_order_lines,
  public.manufacturing_production_runs,
  public.manufacturing_material_transactions
  FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.manufacturing_work_orders,
  public.manufacturing_work_order_lines,
  public.manufacturing_production_runs,
  public.manufacturing_material_transactions
  TO authenticated;

-- ============================================================================
-- 2h. Updated_at trigger (header only, per spec)
-- ============================================================================
-- Reuse the generic trigger function if it already exists (see 20260708000000,
-- 20260726000002 and 20261104000000). Otherwise create it.
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

DROP TRIGGER IF EXISTS trg_manufacturing_work_orders_updated_at ON public.manufacturing_work_orders;
CREATE TRIGGER trg_manufacturing_work_orders_updated_at
  BEFORE UPDATE ON public.manufacturing_work_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Private helpers
-- ============================================================================
-- Every helper is SECURITY DEFINER with a pinned search_path and is revoked
-- from PUBLIC/anon; the public surface is the manufacturing_wo_* commands only.

/** Signed-in member of the business, any role. Returns the actor id. */
CREATE OR REPLACE FUNCTION public._mfg_wo_actor(p_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_found boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to work with manufacturing orders.'
      USING ERRCODE = '42501';
  END IF;
  SELECT true INTO v_found
    FROM public.business_members
   WHERE business_id = p_business_id AND user_id = v_actor
   LIMIT 1;
  IF v_found IS NOT TRUE THEN
    RAISE EXCEPTION 'You are not a member of this business.' USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

/** Signed-in member who may WRITE: owner, admin or manager — the same tier the
 *  RLS write policies admit. Returns the actor id. */
CREATE OR REPLACE FUNCTION public._mfg_wo_writer(p_business_id uuid, p_action text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public._mfg_wo_actor(p_business_id);
  v_role text;
BEGIN
  SELECT b.role::text INTO v_role
    FROM public.business_members b
   WHERE b.business_id = p_business_id AND b.user_id = v_actor
   LIMIT 1;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin', 'manager') THEN
    RAISE EXCEPTION 'Only an owner, administrator or manager can %.', p_action
      USING ERRCODE = '42501';
  END IF;
  RETURN v_actor;
END;
$$;

/**
 * Next work order number: 'WO-YYYY-NNN', restarting at 001 each year, scoped to
 * the business. The advisory lock serialises concurrent creates so two
 * transactions cannot read the same MAX and then collide on the UNIQUE
 * (business_id, work_order_number) index.
 */
CREATE OR REPLACE FUNCTION public._mfg_wo_next_number(p_business_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year   text := to_char(now(), 'YYYY');
  v_prefix text := 'WO-' || to_char(now(), 'YYYY') || '-';
  v_max    integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('mfg_wo_number:' || p_business_id::text, 0));
  SELECT COALESCE(MAX(
           NULLIF(regexp_replace(work_order_number, '^WO-[0-9]{4}-', ''), '')::integer
         ), 0)
    INTO v_max
    FROM public.manufacturing_work_orders
   WHERE business_id = p_business_id
     AND work_order_number LIKE 'WO-' || v_year || '-%';
  RETURN v_prefix || lpad((v_max + 1)::text, 3, '0');
END;
$$;

/** Preferred location of a type for a business, else the business default. */
CREATE OR REPLACE FUNCTION public._mfg_wo_location(p_business_id uuid, p_location_type text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id
    FROM public.inventory_locations l
   WHERE l.business_id = p_business_id
   ORDER BY (l.location_type = p_location_type) DESC, l.is_default DESC, l.created_at, l.id
   LIMIT 1;
$$;

/** The WIP Inventory account Phase A provisioned (found by name, not code). */
CREATE OR REPLACE FUNCTION public._mfg_wo_wip_account(p_business_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
    FROM public.accounts a
   WHERE a.business_id = p_business_id
     AND lower(btrim(a.name)) = 'wip inventory'
     AND a.is_group = false
     AND a.deleted_at IS NULL
   ORDER BY a.code
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION
      'manufacturing-wip-account-missing: this business has no WIP Inventory account. Set up manufacturing accounts before posting production.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN v_id;
END;
$$;

/** A stock account by code with a fallback, e.g. 1143 Raw Materials -> 1141. */
CREATE OR REPLACE FUNCTION public._mfg_wo_stock_account(
  p_business_id uuid,
  p_code text,
  p_fallback_code text,
  p_role text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT a.id INTO v_id
    FROM public.accounts a
   WHERE a.business_id = p_business_id
     AND btrim(a.code) = p_code
     AND a.is_active = true
     AND a.is_group = false
     AND a.deleted_at IS NULL
   ORDER BY a.created_at, a.id
   LIMIT 1;
  IF v_id IS NULL AND p_fallback_code IS NOT NULL THEN
    SELECT a.id INTO v_id
      FROM public.accounts a
     WHERE a.business_id = p_business_id
       AND btrim(a.code) = p_fallback_code
       AND a.is_active = true
       AND a.is_group = false
       AND a.deleted_at IS NULL
     ORDER BY a.created_at, a.id
     LIMIT 1;
  END IF;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'manufacturing-account-missing: no % account (tried % and %).',
      p_role, p_code, COALESCE(p_fallback_code, 'nothing') USING ERRCODE = 'P0001';
  END IF;
  RETURN v_id;
END;
$$;

/**
 * One signed stock movement through the existing single-writer mechanism.
 * p_quantity is SIGNED (inbound positive, outbound negative) and is never zero,
 * which chk_stock_movements_quantity_nonzero requires.
 */
CREATE OR REPLACE FUNCTION public._mfg_wo_movement(
  p_business_id   uuid,
  p_product_id    uuid,
  p_location_id   uuid,
  p_movement_type text,
  p_movement_date date,
  p_quantity      numeric,
  p_unit_cost     numeric,
  p_source_id     uuid,
  p_reference     text,
  p_notes         text,
  p_actor         uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(p_quantity, 0) = 0 THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.stock_movements
    (business_id, product_id, location_id, movement_type, movement_date, quantity,
     unit_cost, total_cost, source_type, source_id, reference, created_by, notes)
  VALUES
    (p_business_id, p_product_id, p_location_id,
     p_movement_type::public.stock_movement_type, p_movement_date, p_quantity,
     COALESCE(p_unit_cost, 0), round(COALESCE(p_unit_cost, 0) * p_quantity, 6),
     'manufacturing_work_order', p_source_id, p_reference, p_actor, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

/**
 * One two-line journal entry through the existing ledger mechanism
 * (public._ledgr_post_entry_keyed — post-or-resume under a deterministic
 * posting_key, created already posted, never updated afterwards).
 * A zero-value entry is skipped rather than posted.
 */
CREATE OR REPLACE FUNCTION public._mfg_wo_post_entry(
  p_business_id       uuid,
  p_posting_key       text,
  p_entry_date        date,
  p_description       text,
  p_source_id         text,
  p_branch_id         uuid,
  p_debit_account_id  uuid,
  p_credit_account_id uuid,
  p_amount            numeric,
  p_debit_note        text,
  p_credit_note       text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_currency text;
  v_amount   numeric := round(COALESCE(p_amount, 0), 2);
  v_lines    jsonb;
BEGIN
  IF v_amount = 0 THEN
    RETURN NULL;
  END IF;
  SELECT b.base_currency INTO v_currency FROM public.businesses b WHERE b.id = p_business_id;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', p_debit_account_id,
      'description', COALESCE(p_debit_note, p_description),
      'is_debit', true,
      'amount', v_amount, 'amount_base', v_amount,
      'tax_code', 'none', 'tax_amount', 0
    ),
    jsonb_build_object(
      'account_id', p_credit_account_id,
      'description', COALESCE(p_credit_note, p_description),
      'is_debit', false,
      'amount', v_amount, 'amount_base', v_amount,
      'tax_code', 'none', 'tax_amount', 0
    )
  );

  RETURN public._ledgr_post_entry_keyed(
    p_business_id,
    p_posting_key,
    p_entry_date,
    p_description,
    'manufacturing_work_order',
    p_source_id,
    COALESCE(v_currency, 'MWK'),
    1,
    p_branch_id,
    NULL,
    v_lines
  );
END;
$$;

/**
 * Backflush: consume components in frozen-BOM proportion to the output,
 * move the finished output into the destination store, and post the two
 * material-cost journal entries.
 *
 *   DR  WIP Inventory        / CR  Raw Materials   — material issued
 *   DR  Finished Goods       / CR  WIP Inventory   — output received
 *
 * Material cost only: the component's purchase_price. No labour, no overhead.
 * Returns the total material cost consumed.
 */
CREATE OR REPLACE FUNCTION public._mfg_wo_backflush(
  p_work_order_id uuid,
  p_run_id        uuid,
  p_output_qty    numeric,
  p_batch_label   text,
  p_date          date,
  p_actor         uuid
)
RETURNS numeric
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo     public.manufacturing_work_orders%rowtype;
  v_line   record;
  v_consume numeric;
  v_unit   numeric;
  v_cost   numeric;
  v_total  numeric := 0;
  v_from   uuid;
  v_to     uuid;
  v_branch uuid;
  v_wip    uuid;
  v_rm     uuid;
  v_fg     uuid;
  v_key    text;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;

  v_from := COALESCE(v_wo.from_location_id,
                     public._mfg_wo_location(v_wo.business_id, 'raw_materials_store'));
  v_to   := COALESCE(v_wo.to_location_id,
                     public._mfg_wo_location(v_wo.business_id, 'finished_goods_store'));
  IF v_from IS NULL THEN
    RAISE EXCEPTION 'manufacturing-location-missing: no source location for this work order.';
  END IF;
  IF v_to IS NULL THEN
    RAISE EXCEPTION 'manufacturing-location-missing: no destination location for this work order.';
  END IF;

  v_wip    := public._mfg_wo_wip_account(v_wo.business_id);
  v_rm     := public._mfg_wo_stock_account(v_wo.business_id, '1143', '1141', 'Raw Materials');
  v_fg     := public._mfg_wo_stock_account(v_wo.business_id, '1142', '1141', 'Finished Goods');
  SELECT l.branch_id INTO v_branch FROM public.inventory_locations l WHERE l.id = v_from;

  FOR v_line IN
    SELECT wol.*, p.purchase_price, p.name AS component_name
      FROM public.manufacturing_work_order_lines wol
      JOIN public.products p ON p.id = wol.component_product_id
     WHERE wol.work_order_id = p_work_order_id
     ORDER BY p.name
  LOOP
    -- Consumption is proportional to output: a run making half the order
    -- consumes half of each component's planned quantity.
    v_consume := round((p_output_qty / v_wo.planned_quantity) * v_line.planned_quantity, 6);
    IF COALESCE(v_consume, 0) <= 0 THEN
      CONTINUE;
    END IF;

    v_unit := COALESCE(v_line.purchase_price, 0);
    v_cost := round(v_consume * v_unit, 2);
    v_total := v_total + v_cost;

    UPDATE public.manufacturing_work_order_lines
       SET actual_quantity_consumed = actual_quantity_consumed + v_consume,
           updated_at = now()
     WHERE id = v_line.id;

    INSERT INTO public.manufacturing_material_transactions
      (work_order_id, run_id, component_product_id, quantity, transaction_type,
       from_location_id, to_location_id, recorded_by, notes)
    VALUES
      (p_work_order_id, p_run_id, v_line.component_product_id, v_consume, 'consume',
       v_from, NULL, p_actor,
       'Backflush ' || p_batch_label || ' — ' || v_line.component_name);

    -- Outbound: negative quantity. The R06 single writer moves the balance.
    PERFORM public._mfg_wo_movement(
      v_wo.business_id, v_line.component_product_id, v_from, 'manufacturing_issue',
      p_date, -v_consume, v_unit, p_work_order_id, v_wo.work_order_number,
      'Work order ' || v_wo.work_order_number || ' — ' || p_batch_label, p_actor);
  END LOOP;

  v_key := 'mfg_wo:' || p_work_order_id::text || ':' ||
           COALESCE(p_run_id::text, 'implicit') || ':consume';
  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id, v_key, p_date,
    'Work order ' || v_wo.work_order_number || ' — materials issued to production (' || p_batch_label || ')',
    p_work_order_id::text, v_branch, v_wip, v_rm, v_total,
    'WIP — materials issued', 'Raw materials consumed');

  -- Receive the output. Valued at the material cost actually issued, so the
  -- WIP debit is cleared in full by the matching credit.
  v_key := 'mfg_wo:' || p_work_order_id::text || ':' ||
           COALESCE(p_run_id::text, 'implicit') || ':receipt';
  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id, v_key, p_date,
    'Work order ' || v_wo.work_order_number || ' — finished goods received (' || p_batch_label || ')',
    p_work_order_id::text, v_branch, v_fg, v_wip, v_total,
    'Finished goods received', 'WIP cleared to finished goods');

  PERFORM public._mfg_wo_movement(
    v_wo.business_id, v_wo.product_id, v_to, 'manufacturing_receipt',
    p_date, p_output_qty,
    CASE WHEN p_output_qty > 0 THEN round(v_total / p_output_qty, 6) ELSE 0 END,
    p_work_order_id, v_wo.work_order_number,
    'Work order ' || v_wo.work_order_number || ' — ' || p_batch_label, p_actor);

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public._mfg_wo_actor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_writer(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_next_number(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_location(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_wip_account(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_stock_account(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_movement(uuid, uuid, uuid, text, date, numeric, numeric, uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_post_entry(uuid, text, date, text, text, uuid, uuid, uuid, numeric, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_backflush(uuid, uuid, numeric, text, date, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2i/2j. Work order commands
-- ============================================================================

-- ── manufacturing_wo_create ──────────────────────────────────────────────────
-- Creates a DRAFT work order. The active BOM is resolved and referenced but NOT
-- frozen yet: freezing happens at release, so a BOM revision made before release
-- is still picked up by the next release.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_create(
  p_business_id      uuid,
  p_product_id       uuid,
  p_planned_qty      numeric,
  p_planned_start    date,
  p_planned_end      date,
  p_from_location_id uuid,
  p_to_location_id   uuid,
  p_notes            text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public._mfg_wo_writer(p_business_id, 'create a work order');
  v_bom_id uuid;
  v_number text;
  v_wo_id uuid;
  v_from uuid;
  v_to uuid;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'An output product is required.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_planned_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'The planned quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  SELECT b.id INTO v_bom_id
    FROM public.manufacturing_boms b
   WHERE b.business_id = p_business_id
     AND b.product_id = p_product_id
     AND b.status = 'active'
   ORDER BY b.version DESC, b.created_at DESC
   LIMIT 1;
  IF v_bom_id IS NULL THEN
    RAISE EXCEPTION
      'manufacturing-no-active-bom: this product has no active bill of materials. Activate a BOM before creating a work order.'
      USING ERRCODE = '22023';
  END IF;

  v_from := COALESCE(p_from_location_id,
                     public._mfg_wo_location(p_business_id, 'raw_materials_store'));
  v_to   := COALESCE(p_to_location_id,
                     public._mfg_wo_location(p_business_id, 'finished_goods_store'));

  v_number := public._mfg_wo_next_number(p_business_id);

  INSERT INTO public.manufacturing_work_orders
    (business_id, work_order_number, product_id, bom_id, planned_quantity, status,
     planned_start_date, planned_end_date, from_location_id, to_location_id,
     notes, created_by)
  VALUES
    (p_business_id, v_number, p_product_id, v_bom_id, p_planned_qty, 'draft',
     p_planned_start, p_planned_end, v_from, v_to,
     NULLIF(btrim(COALESCE(p_notes, '')), ''), v_actor)
  RETURNING id INTO v_wo_id;

  RETURN v_wo_id;
END;
$$;

-- ── manufacturing_wo_release ─────────────────────────────────────────────────
-- draft -> released. Freezes the BOM: locks it and copies its lines into
-- manufacturing_work_order_lines with fixed, scrap-inflated quantities.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_release(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
BEGIN
  IF p_work_order_id IS NULL THEN
    RAISE EXCEPTION 'A work order is required.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'release a work order');

  IF v_wo.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft work order can be released; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  -- The BOM is frozen from here on: locked against further editing, and its
  -- lines are copied so a later BOM revision cannot change this order.
  UPDATE public.manufacturing_boms
     SET bom_locked_at = now(), updated_at = now()
   WHERE id = v_wo.bom_id
     AND bom_locked_at IS NULL;

  -- The BOM expresses one unit of output, so every line is multiplied by the
  -- order quantity. Scrap inflation is already part of the line quantity.
  INSERT INTO public.manufacturing_work_order_lines
    (work_order_id, component_product_id, planned_quantity, unit_of_measure, scrap_pct, notes)
  SELECT p_work_order_id,
         bl.component_product_id,
         round(bl.quantity * (1 + bl.scrap_pct / 100) * v_wo.planned_quantity, 6),
         bl.unit_of_measure,
         bl.scrap_pct,
         bl.notes
    FROM public.manufacturing_bom_lines bl
   WHERE bl.bom_id = v_wo.bom_id
  ON CONFLICT (work_order_id, component_product_id) DO UPDATE
    SET planned_quantity = EXCLUDED.planned_quantity,
        unit_of_measure = EXCLUDED.unit_of_measure,
        scrap_pct = EXCLUDED.scrap_pct,
        updated_at = now();

  UPDATE public.manufacturing_work_orders
     SET status = 'released', updated_at = now()
   WHERE id = p_work_order_id;
END;
$$;

-- ── manufacturing_wo_start ───────────────────────────────────────────────────
-- released -> in_progress. Idempotent: already in progress is a no-op.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_start(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'start production');

  IF v_wo.status = 'in_progress' THEN
    RETURN; -- no-op: already started
  END IF;
  IF v_wo.status <> 'released' THEN
    RAISE EXCEPTION 'Only a released work order can start production; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_work_orders
     SET status = 'in_progress',
         actual_start_date = COALESCE(actual_start_date, now()),
         updated_at = now()
   WHERE id = p_work_order_id;
END;
$$;

-- ── manufacturing_wo_record_run ──────────────────────────────────────────────
-- Records one production run and backflushes its materials. Auto-starts a
-- released order. Overproduction above planned + 10% is refused.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_record_run(
  p_work_order_id uuid,
  p_output_qty    numeric,
  p_scrap_qty     numeric,
  p_notes         text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
  v_run_number integer;
  v_run_id uuid;
  v_date date := current_date;
  v_scrap numeric := COALESCE(p_scrap_qty, 0);
  v_cost numeric;
BEGIN
  IF COALESCE(p_output_qty, 0) <= 0 THEN
    RAISE EXCEPTION 'The output quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;
  IF v_scrap < 0 THEN
    RAISE EXCEPTION 'The scrap quantity cannot be negative.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'record a production run');

  IF v_wo.status = 'released' THEN
    UPDATE public.manufacturing_work_orders
       SET status = 'in_progress',
           actual_start_date = COALESCE(actual_start_date, now()),
           updated_at = now()
     WHERE id = p_work_order_id;
    v_wo.status := 'in_progress';
  ELSIF v_wo.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Production can only be recorded against a released or in-progress work order; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  -- 10% overproduction tolerance, against cumulative output.
  IF v_wo.completed_quantity + p_output_qty > v_wo.planned_quantity * 1.10 THEN
    RAISE EXCEPTION
      'manufacturing-overproduction: completing % of % would exceed the planned quantity by more than 10%%.',
      round(v_wo.completed_quantity + p_output_qty, 4), round(v_wo.planned_quantity, 4)
      USING ERRCODE = '22023';
  END IF;

  PERFORM public._ledgr_assert_period_open(v_wo.business_id, v_date, 'Production run');

  SELECT COALESCE(MAX(run_number), 0) + 1 INTO v_run_number
    FROM public.manufacturing_production_runs
   WHERE work_order_id = p_work_order_id;

  INSERT INTO public.manufacturing_production_runs
    (work_order_id, run_number, output_quantity, scrap_quantity, status,
     started_at, completed_at, notes, created_by)
  VALUES
    (p_work_order_id, v_run_number, p_output_qty, v_scrap, 'completed',
     now(), now(), NULLIF(btrim(COALESCE(p_notes, '')), ''), v_actor)
  RETURNING id INTO v_run_id;

  v_cost := public._mfg_wo_backflush(
    p_work_order_id, v_run_id, p_output_qty, 'run ' || v_run_number, v_date, v_actor);

  UPDATE public.manufacturing_work_orders
     SET completed_quantity = completed_quantity + p_output_qty,
         scrapped_quantity = scrapped_quantity + v_scrap,
         updated_at = now()
   WHERE id = p_work_order_id;

  RETURN v_run_id;
END;
$$;

-- ── manufacturing_wo_record_consumption ──────────────────────────────────────
-- Manual material issue on top of (or instead of) the backflush.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_record_consumption(
  p_work_order_id   uuid,
  p_run_id          uuid,
  p_component_id    uuid,
  p_quantity        numeric,
  p_from_location_id uuid,
  p_notes           text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
  v_date date := current_date;
  v_from uuid;
  v_branch uuid;
  v_unit numeric;
  v_txn_id uuid;
BEGIN
  IF COALESCE(p_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'The quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'record material consumption');

  IF v_wo.status NOT IN ('released', 'in_progress') THEN
    RAISE EXCEPTION 'Materials can only be consumed against a released or in-progress work order; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.manufacturing_work_order_lines
     WHERE work_order_id = p_work_order_id AND component_product_id = p_component_id
  ) THEN
    RAISE EXCEPTION 'That product is not a component of this work order.' USING ERRCODE = '22023';
  END IF;

  v_from := COALESCE(p_from_location_id, v_wo.from_location_id,
                     public._mfg_wo_location(v_wo.business_id, 'raw_materials_store'));
  SELECT l.branch_id INTO v_branch FROM public.inventory_locations l WHERE l.id = v_from;
  SELECT purchase_price INTO v_unit FROM public.products WHERE id = p_component_id;

  PERFORM public._ledgr_assert_period_open(v_wo.business_id, v_date, 'Material consumption');

  UPDATE public.manufacturing_work_order_lines
     SET actual_quantity_consumed = actual_quantity_consumed + p_quantity,
         updated_at = now()
   WHERE work_order_id = p_work_order_id AND component_product_id = p_component_id;

  INSERT INTO public.manufacturing_material_transactions
    (work_order_id, run_id, component_product_id, quantity, transaction_type,
     from_location_id, recorded_by, notes)
  VALUES
    (p_work_order_id, p_run_id, p_component_id, p_quantity, 'consume',
     v_from, v_actor, NULLIF(btrim(COALESCE(p_notes, '')), ''))
  RETURNING id INTO v_txn_id;

  PERFORM public._mfg_wo_movement(
    v_wo.business_id, p_component_id, v_from, 'manufacturing_issue',
    v_date, -p_quantity, COALESCE(v_unit, 0), p_work_order_id,
    v_wo.work_order_number, 'Work order ' || v_wo.work_order_number || ' — manual issue', v_actor);

  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id,
    'mfg_wo:' || p_work_order_id::text || ':consume:' || v_txn_id::text,
    v_date,
    'Work order ' || v_wo.work_order_number || ' — materials issued to production',
    p_work_order_id::text, v_branch,
    public._mfg_wo_wip_account(v_wo.business_id),
    public._mfg_wo_stock_account(v_wo.business_id, '1143', '1141', 'Raw Materials'),
    round(p_quantity * COALESCE(v_unit, 0), 2),
    'WIP — materials issued', 'Raw materials consumed');

  RETURN v_txn_id;
END;
$$;

-- ── manufacturing_wo_record_return ───────────────────────────────────────────
-- Unused material back to the store: the mirror of a consumption.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_record_return(
  p_work_order_id uuid,
  p_run_id        uuid,
  p_component_id  uuid,
  p_quantity      numeric,
  p_to_location_id uuid,
  p_notes         text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
  v_date date := current_date;
  v_to uuid;
  v_branch uuid;
  v_unit numeric;
  v_txn_id uuid;
BEGIN
  IF COALESCE(p_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'The quantity must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'record a material return');

  IF v_wo.status NOT IN ('released', 'in_progress') THEN
    RAISE EXCEPTION 'Materials can only be returned against a released or in-progress work order; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.manufacturing_work_order_lines
     WHERE work_order_id = p_work_order_id AND component_product_id = p_component_id
  ) THEN
    RAISE EXCEPTION 'That product is not a component of this work order.' USING ERRCODE = '22023';
  END IF;

  v_to := COALESCE(p_to_location_id, v_wo.from_location_id,
                   public._mfg_wo_location(v_wo.business_id, 'raw_materials_store'));
  SELECT l.branch_id INTO v_branch FROM public.inventory_locations l WHERE l.id = v_to;
  SELECT purchase_price INTO v_unit FROM public.products WHERE id = p_component_id;

  PERFORM public._ledgr_assert_period_open(v_wo.business_id, v_date, 'Material return');

  UPDATE public.manufacturing_work_order_lines
     SET actual_quantity_consumed = GREATEST(actual_quantity_consumed - p_quantity, 0),
         updated_at = now()
   WHERE work_order_id = p_work_order_id AND component_product_id = p_component_id;

  INSERT INTO public.manufacturing_material_transactions
    (work_order_id, run_id, component_product_id, quantity, transaction_type,
     to_location_id, recorded_by, notes)
  VALUES
    (p_work_order_id, p_run_id, p_component_id, p_quantity, 'return',
     v_to, v_actor, NULLIF(btrim(COALESCE(p_notes, '')), ''))
  RETURNING id INTO v_txn_id;

  -- Inbound: positive quantity.
  PERFORM public._mfg_wo_movement(
    v_wo.business_id, p_component_id, v_to, 'manufacturing_return',
    v_date, p_quantity, COALESCE(v_unit, 0), p_work_order_id,
    v_wo.work_order_number, 'Work order ' || v_wo.work_order_number || ' — material return', v_actor);

  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id,
    'mfg_wo:' || p_work_order_id::text || ':return:' || v_txn_id::text,
    v_date,
    'Work order ' || v_wo.work_order_number || ' — materials returned from production',
    p_work_order_id::text, v_branch,
    public._mfg_wo_stock_account(v_wo.business_id, '1143', '1141', 'Raw Materials'),
    public._mfg_wo_wip_account(v_wo.business_id),
    round(p_quantity * COALESCE(v_unit, 0), 2),
    'Raw materials returned', 'WIP reduced by the return');

  RETURN v_txn_id;
END;
$$;

-- ── manufacturing_wo_complete ────────────────────────────────────────────────
-- in_progress -> completed. With no explicit runs, one implicit backflush for
-- the whole planned quantity (a backflush-only order needs no shop-floor data).
CREATE OR REPLACE FUNCTION public.manufacturing_wo_complete(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
  v_date date := current_date;
  v_runs integer;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'complete a work order');

  IF v_wo.status NOT IN ('released', 'in_progress') THEN
    RAISE EXCEPTION 'Only a released or in-progress work order can be completed; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_runs
    FROM public.manufacturing_production_runs
   WHERE work_order_id = p_work_order_id;

  IF v_runs = 0 THEN
    -- Backflush-only: one implicit batch for the full planned quantity.
    PERFORM public._ledgr_assert_period_open(v_wo.business_id, v_date, 'Work order completion');
    PERFORM public._mfg_wo_backflush(
      p_work_order_id, NULL, v_wo.planned_quantity, 'implicit batch', v_date, v_actor);
    UPDATE public.manufacturing_work_orders
       SET completed_quantity = planned_quantity,
           actual_start_date = COALESCE(actual_start_date, now()),
           updated_at = now()
     WHERE id = p_work_order_id;
    SELECT * INTO v_wo FROM public.manufacturing_work_orders WHERE id = p_work_order_id;
  END IF;

  IF COALESCE(v_wo.completed_quantity, 0) <= 0 THEN
    RAISE EXCEPTION 'A work order with no completed output cannot be completed.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_work_orders
     SET status = 'completed',
         actual_end_date = COALESCE(actual_end_date, now()),
         updated_at = now()
   WHERE id = p_work_order_id;
END;
$$;

-- ── manufacturing_wo_close ───────────────────────────────────────────────────
-- completed -> closed. Final state: no further change of any kind.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_close(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'close a work order');

  IF v_wo.status = 'closed' THEN
    RETURN; -- already final
  END IF;
  IF v_wo.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed work order can be closed; this one is %.', v_wo.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.manufacturing_work_orders
     SET status = 'closed', updated_at = now()
   WHERE id = p_work_order_id;
END;
$$;

-- ── manufacturing_wo_cancel ──────────────────────────────────────────────────
-- Any non-closed, non-cancelled state -> cancelled. Every stock movement and
-- journal posting already made is reversed with a new movement and a new
-- reversing entry: a posted journal entry is immutable, so nothing is edited or
-- deleted. The BOM is unlocked when no other live order still references it.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_cancel(p_work_order_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
  v_actor uuid;
  v_date date := current_date;
  v_row record;
  v_branch uuid;
  v_wip uuid;
  v_rm uuid;
  v_fg uuid;
  v_unit numeric;
  v_txn_id uuid;
  v_seq integer := 0;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'cancel a work order');

  IF v_wo.status = 'closed' THEN
    RAISE EXCEPTION 'A closed work order cannot be cancelled.' USING ERRCODE = '22023';
  END IF;
  IF v_wo.status = 'cancelled' THEN
    RETURN;
  END IF;

  PERFORM public._ledgr_assert_period_open(v_wo.business_id, v_date, 'Work order cancellation');

  v_wip := public._mfg_wo_wip_account(v_wo.business_id);
  v_rm  := public._mfg_wo_stock_account(v_wo.business_id, '1143', '1141', 'Raw Materials');
  v_fg  := public._mfg_wo_stock_account(v_wo.business_id, '1142', '1141', 'Finished Goods');
  SELECT l.branch_id INTO v_branch
    FROM public.inventory_locations l
   WHERE l.id = COALESCE(v_wo.from_location_id,
                         public._mfg_wo_location(v_wo.business_id, 'raw_materials_store'));

  -- 1. Materials: put back the NET consumed quantity of every component.
  --    Net, because a manual return may already have given some of it back.
  FOR v_row IN
    SELECT t.component_product_id,
           SUM(CASE WHEN t.transaction_type IN ('consume', 'adjustment') THEN t.quantity
                    WHEN t.transaction_type = 'return' THEN -t.quantity
                    ELSE 0 END) AS net_quantity
      FROM public.manufacturing_material_transactions t
     WHERE t.work_order_id = p_work_order_id
     GROUP BY t.component_product_id
  LOOP
    IF COALESCE(v_row.net_quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    SELECT purchase_price INTO v_unit FROM public.products WHERE id = v_row.component_product_id;
    v_seq := v_seq + 1;

    INSERT INTO public.manufacturing_material_transactions
      (work_order_id, run_id, component_product_id, quantity, transaction_type,
       to_location_id, recorded_by, notes)
    VALUES
      (p_work_order_id, NULL, v_row.component_product_id, v_row.net_quantity, 'return',
       COALESCE(v_wo.from_location_id,
                public._mfg_wo_location(v_wo.business_id, 'raw_materials_store')),
       v_actor, 'Cancellation reversal for ' || v_wo.work_order_number)
    RETURNING id INTO v_txn_id;

    -- Inbound reversal of the outbound issue.
    PERFORM public._mfg_wo_movement(
      v_wo.business_id, v_row.component_product_id,
      COALESCE(v_wo.from_location_id,
               public._mfg_wo_location(v_wo.business_id, 'raw_materials_store')),
      'manufacturing_return', v_date, v_row.net_quantity, COALESCE(v_unit, 0),
      p_work_order_id, v_wo.work_order_number,
      'Cancellation reversal — ' || v_wo.work_order_number, v_actor);

    PERFORM public._mfg_wo_post_entry(
      v_wo.business_id,
      'mfg_wo:' || p_work_order_id::text || ':cancel:material:' || v_seq::text,
      v_date,
      'Cancellation of work order ' || v_wo.work_order_number || ' — materials returned to store',
      p_work_order_id::text, v_branch, v_rm, v_wip,
      round(v_row.net_quantity * COALESCE(v_unit, 0), 2),
      'Raw materials returned', 'WIP reversed');

    UPDATE public.manufacturing_work_order_lines
       SET actual_quantity_consumed = 0, updated_at = now()
     WHERE work_order_id = p_work_order_id AND component_product_id = v_row.component_product_id;
  END LOOP;

  -- 2. Finished goods: take back what was received.
  IF COALESCE(v_wo.completed_quantity, 0) > 0 THEN
    PERFORM public._mfg_wo_movement(
      v_wo.business_id, v_wo.product_id,
      COALESCE(v_wo.to_location_id,
               public._mfg_wo_location(v_wo.business_id, 'finished_goods_store')),
      'manufacturing_receipt', v_date, -v_wo.completed_quantity, 0,
      p_work_order_id, v_wo.work_order_number,
      'Cancellation reversal — ' || v_wo.work_order_number, v_actor);

    PERFORM public._mfg_wo_post_entry(
      v_wo.business_id,
      'mfg_wo:' || p_work_order_id::text || ':cancel:output',
      v_date,
      'Cancellation of work order ' || v_wo.work_order_number || ' — finished goods reversed',
      p_work_order_id::text, v_branch, v_wip, v_fg,
      (SELECT COALESCE(ABS(SUM(CASE WHEN jl.account_id = v_fg AND jl.is_debit THEN jl.amount_base
                                    WHEN jl.account_id = v_fg AND NOT jl.is_debit THEN -jl.amount_base
                                    ELSE 0 END)), 0)
         FROM public.journal_lines jl
        WHERE jl.business_id = v_wo.business_id
          AND jl.journal_entry_id IN (
            SELECT je.id FROM public.journal_entries je
             WHERE je.business_id = v_wo.business_id
               AND je.source_type = 'manufacturing_work_order'
               AND je.source_id::text = p_work_order_id::text)),
      'WIP reinstated', 'Finished goods reversed');
  END IF;

  UPDATE public.manufacturing_work_orders
     SET status = 'cancelled',
         completed_quantity = 0,
         scrapped_quantity = 0,
         updated_at = now()
   WHERE id = p_work_order_id;

  -- 3. Unlock the BOM when no other live order still references it.
  UPDATE public.manufacturing_boms
     SET bom_locked_at = NULL, updated_at = now()
   WHERE id = v_wo.bom_id
     AND NOT EXISTS (
       SELECT 1 FROM public.manufacturing_work_orders w
        WHERE w.bom_id = v_wo.bom_id
          AND w.id <> p_work_order_id
          AND w.status NOT IN ('cancelled', 'closed')
     );
END;
$$;

-- ── manufacturing_wo_yield ───────────────────────────────────────────────────
-- Order-level yield plus per-component consumption variance. One row per
-- component, with the order-level figures repeated on every row so a caller can
-- read either shape from a single query.
CREATE OR REPLACE FUNCTION public.manufacturing_wo_yield(p_work_order_id uuid)
RETURNS TABLE (
  work_order_id               uuid,
  work_order_number           text,
  status                      text,
  planned_quantity            numeric,
  completed_quantity          numeric,
  scrapped_quantity           numeric,
  yield_pct                   numeric,
  component_product_id        uuid,
  component_name              text,
  component_planned_quantity  numeric,
  component_actual_quantity   numeric,
  consumption_variance        numeric,
  consumption_variance_pct    numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wo public.manufacturing_work_orders%rowtype;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders WHERE id = p_work_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public._mfg_wo_actor(v_wo.business_id);

  RETURN QUERY
  SELECT
    v_wo.id,
    v_wo.work_order_number,
    v_wo.status,
    v_wo.planned_quantity,
    v_wo.completed_quantity,
    v_wo.scrapped_quantity,
    CASE WHEN (v_wo.completed_quantity + v_wo.scrapped_quantity) > 0
         THEN round(v_wo.completed_quantity
                    / (v_wo.completed_quantity + v_wo.scrapped_quantity) * 100, 2)
         ELSE NULL END,
    p.id,
    p.name,
    l.planned_quantity,
    l.actual_quantity_consumed,
    round(l.actual_quantity_consumed - l.planned_quantity, 6),
    CASE WHEN l.planned_quantity > 0
         THEN round((l.actual_quantity_consumed - l.planned_quantity)
                    / l.planned_quantity * 100, 2)
         ELSE NULL END
  FROM public.manufacturing_work_order_lines l
  JOIN public.products p ON p.id = l.component_product_id
  WHERE l.work_order_id = p_work_order_id
  ORDER BY p.name;
END;
$$;

-- ── Grants on the public command surface ─────────────────────────────────────
REVOKE ALL ON FUNCTION public.manufacturing_wo_create(uuid, uuid, numeric, date, date, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_create(uuid, uuid, numeric, date, date, uuid, uuid, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_release(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_release(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_start(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_record_run(uuid, numeric, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_record_run(uuid, numeric, numeric, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_record_consumption(uuid, uuid, uuid, numeric, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_record_consumption(uuid, uuid, uuid, numeric, uuid, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_record_return(uuid, uuid, uuid, numeric, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_record_return(uuid, uuid, uuid, numeric, uuid, text)
  TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_complete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_complete(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_close(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_close(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_cancel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_cancel(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.manufacturing_wo_yield(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.manufacturing_wo_yield(uuid) TO authenticated;

-- ============================================================================
-- SELF-VERIFICATION (fails the migration if the contract is incomplete)
-- ============================================================================
DO $verify$
DECLARE
  v_missing text := '';
  v_count integer;
BEGIN
  -- Tables
  IF to_regclass('public.manufacturing_work_orders') IS NULL THEN
    v_missing := v_missing || 'manufacturing_work_orders missing; ';
  END IF;
  IF to_regclass('public.manufacturing_work_order_lines') IS NULL THEN
    v_missing := v_missing || 'manufacturing_work_order_lines missing; ';
  END IF;
  IF to_regclass('public.manufacturing_production_runs') IS NULL THEN
    v_missing := v_missing || 'manufacturing_production_runs missing; ';
  END IF;
  IF to_regclass('public.manufacturing_material_transactions') IS NULL THEN
    v_missing := v_missing || 'manufacturing_material_transactions missing; ';
  END IF;

  -- Constraints named by the spec
  FOR v_count IN
    SELECT 1 FROM (VALUES
      ('public.manufacturing_work_orders', 'manufacturing_wo_qty_positive'),
      ('public.manufacturing_work_orders', 'manufacturing_wo_completed_nonneg'),
      ('public.manufacturing_work_orders', 'manufacturing_wo_scrapped_nonneg'),
      ('public.manufacturing_work_orders', 'manufacturing_wo_status_check'),
      ('public.manufacturing_work_order_lines', 'manufacturing_wo_line_qty_positive'),
      ('public.manufacturing_work_order_lines', 'manufacturing_wo_line_consumed_nonneg'),
      ('public.manufacturing_production_runs', 'manufacturing_run_output_positive'),
      ('public.manufacturing_production_runs', 'manufacturing_run_scrap_nonneg'),
      ('public.manufacturing_production_runs', 'manufacturing_run_status_check'),
      ('public.manufacturing_material_transactions', 'manufacturing_mat_txn_qty_positive'),
      ('public.manufacturing_material_transactions', 'manufacturing_mat_txn_type_check')
    ) AS t(relname, conname)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = t.relname::regclass AND c.conname = t.conname
    )
  LOOP
    v_missing := v_missing || 'a named constraint is missing; ';
  END LOOP;

  -- RLS enabled on all four tables
  FOR v_count IN
    SELECT 1 FROM (VALUES
      ('public.manufacturing_work_orders'),
      ('public.manufacturing_work_order_lines'),
      ('public.manufacturing_production_runs'),
      ('public.manufacturing_material_transactions')
    ) AS t(relname)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_class c
       WHERE c.oid = t.relname::regclass AND c.relrowsecurity
    )
  LOOP
    v_missing := v_missing || 'RLS is not enabled on every work order table; ';
  END LOOP;

  -- Read and write policies on all four tables
  FOR v_count IN
    SELECT 1 FROM (VALUES
      ('public.manufacturing_work_orders', 'manufacturing_work_orders_member_read'),
      ('public.manufacturing_work_orders', 'manufacturing_work_orders_member_write'),
      ('public.manufacturing_work_order_lines', 'manufacturing_work_order_lines_member_read'),
      ('public.manufacturing_work_order_lines', 'manufacturing_work_order_lines_member_write'),
      ('public.manufacturing_production_runs', 'manufacturing_production_runs_member_read'),
      ('public.manufacturing_production_runs', 'manufacturing_production_runs_member_write'),
      ('public.manufacturing_material_transactions', 'manufacturing_material_transactions_member_read'),
      ('public.manufacturing_material_transactions', 'manufacturing_material_transactions_member_write')
    ) AS t(relname, polname)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_policy p
       WHERE p.polrelid = t.relname::regclass AND p.polname = t.polname
    )
  LOOP
    v_missing := v_missing || 'a member read/write policy is missing; ';
  END LOOP;

  -- Commands
  IF to_regprocedure('public.manufacturing_wo_create(uuid, uuid, numeric, date, date, uuid, uuid, text)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_create missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_release(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_release missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_start(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_start missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_record_run(uuid, numeric, numeric, text)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_record_run missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_record_consumption(uuid, uuid, uuid, numeric, uuid, text)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_record_consumption missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_record_return(uuid, uuid, uuid, numeric, uuid, text)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_record_return missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_complete(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_complete missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_close(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_close missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_cancel(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_cancel missing; ';
  END IF;
  IF to_regprocedure('public.manufacturing_wo_yield(uuid)') IS NULL THEN
    v_missing := v_missing || 'manufacturing_wo_yield missing; ';
  END IF;

  -- anon must not be able to execute any work order command
  IF has_function_privilege('anon', 'public.manufacturing_wo_create(uuid, uuid, numeric, date, date, uuid, uuid, text)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_release(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_start(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_record_run(uuid, numeric, numeric, text)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_record_consumption(uuid, uuid, uuid, numeric, uuid, text)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_record_return(uuid, uuid, uuid, numeric, uuid, text)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_complete(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_close(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_cancel(uuid)', 'execute')
     OR has_function_privilege('anon', 'public.manufacturing_wo_yield(uuid)', 'execute') THEN
    v_missing := v_missing || 'anon can execute a manufacturing work order command; ';
  END IF;

  -- authenticated can read the header
  IF NOT has_table_privilege('authenticated', 'public.manufacturing_work_orders', 'select') THEN
    v_missing := v_missing || 'authenticated cannot select manufacturing_work_orders; ';
  END IF;

  -- The three movement types this file depends on must exist.
  SELECT COUNT(*) INTO v_count
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'stock_movement_type'
     AND e.enumlabel IN ('manufacturing_issue', 'manufacturing_return', 'manufacturing_receipt');
  IF v_count <> 3 THEN
    v_missing := v_missing || 'the manufacturing stock_movement_type labels are missing; ';
  END IF;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'Manufacturing work orders not applied correctly: %', v_missing
      USING ERRCODE = '42501';
  END IF;
END
$verify$;
