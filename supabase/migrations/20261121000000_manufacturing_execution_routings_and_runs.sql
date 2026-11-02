-- Phase 5B-2a: work centres, routings, recursive work-order planning, and
-- explicit production-run execution.
--
-- The BOM/work-order foundation already exists as manufacturing_boms,
-- manufacturing_bom_lines, manufacturing_work_orders,
-- manufacturing_work_order_lines, and manufacturing_production_runs. Reuse
-- those tables; do not create parallel work-order or inventory ledgers.
-- Component quantities and scrap_pct are per one unit of their parent BOM.

CREATE TABLE IF NOT EXISTS public.work_centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  centre_type text NOT NULL DEFAULT 'machine'
    CHECK (centre_type IN ('machine', 'labor', 'cell', 'outsourced')),
  capacity_hours_per_day numeric(6,2) NOT NULL DEFAULT 8 CHECK (capacity_hours_per_day >= 0),
  cost_rate_per_hour numeric(12,2) NOT NULL DEFAULT 0 CHECK (cost_rate_per_hour >= 0),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code)
);
CREATE INDEX IF NOT EXISTS idx_work_centres_business ON public.work_centres(business_id);
ALTER TABLE public.work_centres ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_centres_member_read ON public.work_centres;
CREATE POLICY work_centres_member_read ON public.work_centres FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
DROP POLICY IF EXISTS work_centres_manager_write ON public.work_centres;
CREATE POLICY work_centres_manager_write ON public.work_centres FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')))
  WITH CHECK (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')));
REVOKE ALL ON public.work_centres FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_centres TO authenticated;

CREATE TABLE IF NOT EXISTS public.routings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  bom_version_id uuid REFERENCES public.manufacturing_boms(id) ON DELETE SET NULL,
  code text NOT NULL,
  name text NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  total_setup_minutes numeric(8,2) NOT NULL DEFAULT 0 CHECK (total_setup_minutes >= 0),
  total_run_minutes_per_unit numeric(8,2) NOT NULL DEFAULT 0 CHECK (total_run_minutes_per_unit >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, code, version_number)
);
CREATE INDEX IF NOT EXISTS idx_routings_business_product ON public.routings(business_id, product_id, status);
ALTER TABLE public.routings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routings_member_read ON public.routings;
CREATE POLICY routings_member_read ON public.routings FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
DROP POLICY IF EXISTS routings_manager_write ON public.routings;
CREATE POLICY routings_manager_write ON public.routings FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')))
  WITH CHECK (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')));
REVOKE ALL ON public.routings FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routings TO authenticated;

CREATE TABLE IF NOT EXISTS public.routing_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  routing_id uuid NOT NULL REFERENCES public.routings(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  work_centre_id uuid NOT NULL REFERENCES public.work_centres(id) ON DELETE RESTRICT,
  operation_name text NOT NULL,
  setup_time_minutes numeric(8,2) NOT NULL DEFAULT 0 CHECK (setup_time_minutes >= 0),
  run_time_per_unit_minutes numeric(8,2) NOT NULL DEFAULT 0 CHECK (run_time_per_unit_minutes >= 0),
  queue_time_minutes numeric(8,2) NOT NULL DEFAULT 0 CHECK (queue_time_minutes >= 0),
  is_quality_checkpoint boolean NOT NULL DEFAULT false,
  notes text,
  UNIQUE (routing_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_routing_steps_routing ON public.routing_steps(routing_id, sequence);
CREATE INDEX IF NOT EXISTS idx_routing_steps_work_centre ON public.routing_steps(work_centre_id);
ALTER TABLE public.routing_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routing_steps_member_read ON public.routing_steps;
CREATE POLICY routing_steps_member_read ON public.routing_steps FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
DROP POLICY IF EXISTS routing_steps_manager_write ON public.routing_steps;
CREATE POLICY routing_steps_manager_write ON public.routing_steps FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')))
  WITH CHECK (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')));
REVOKE ALL ON public.routing_steps FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routing_steps TO authenticated;

-- Extend the existing Phase C work-order ledger instead of creating a second
-- set of work_orders/work_order_lines/production_runs tables.
ALTER TABLE public.manufacturing_work_orders
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  ADD COLUMN IF NOT EXISTS routing_id uuid REFERENCES public.routings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_mfg_wo_priority ON public.manufacturing_work_orders(business_id, priority);
CREATE INDEX IF NOT EXISTS idx_mfg_wo_routing ON public.manufacturing_work_orders(routing_id);

ALTER TABLE public.manufacturing_production_runs
  ADD COLUMN IF NOT EXISTS output_location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL;
ALTER TABLE public.manufacturing_production_runs
  DROP CONSTRAINT IF EXISTS manufacturing_run_output_positive;
ALTER TABLE public.manufacturing_production_runs
  ADD CONSTRAINT manufacturing_run_output_nonnegative CHECK (output_quantity >= 0);
ALTER TABLE public.manufacturing_production_runs
  ADD CONSTRAINT manufacturing_run_completed_output_positive
    CHECK (status IN ('in_progress', 'aborted', 'cancelled') OR output_quantity > 0);
ALTER TABLE public.manufacturing_production_runs
  DROP CONSTRAINT IF EXISTS manufacturing_run_status_check;
ALTER TABLE public.manufacturing_production_runs
  ADD CONSTRAINT manufacturing_run_status_check
    CHECK (status IN ('in_progress', 'completed', 'cancelled', 'aborted'));

CREATE TABLE IF NOT EXISTS public.manufacturing_production_run_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_run_id uuid NOT NULL REFERENCES public.manufacturing_production_runs(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  component_product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity_consumed numeric(18,6) NOT NULL DEFAULT 0 CHECK (quantity_consumed >= 0),
  quantity_expected numeric(18,6) NOT NULL DEFAULT 0 CHECK (quantity_expected >= 0),
  unit_of_measure text NOT NULL DEFAULT 'ea',
  UNIQUE (production_run_id, component_product_id)
);
CREATE INDEX IF NOT EXISTS idx_mfg_production_run_lines_run
  ON public.manufacturing_production_run_lines(production_run_id);
CREATE INDEX IF NOT EXISTS idx_mfg_production_run_lines_business
  ON public.manufacturing_production_run_lines(business_id);
ALTER TABLE public.manufacturing_production_run_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS manufacturing_run_lines_member_read ON public.manufacturing_production_run_lines;
CREATE POLICY manufacturing_run_lines_member_read
  ON public.manufacturing_production_run_lines FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));
DROP POLICY IF EXISTS manufacturing_run_lines_manager_write ON public.manufacturing_production_run_lines;
CREATE POLICY manufacturing_run_lines_manager_write
  ON public.manufacturing_production_run_lines FOR ALL TO authenticated
  USING (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')))
  WITH CHECK (business_id IN (SELECT business_id FROM public.business_members
    WHERE user_id = auth.uid() AND role IN ('owner', 'admin', 'manager')));
REVOKE ALL ON public.manufacturing_production_run_lines FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_production_run_lines TO authenticated;

-- The child business ids are deliberately checked against their parent rows;
-- they are never trusted as a client-supplied tenant selector.
CREATE OR REPLACE FUNCTION public._mfg_execution_validate_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_business_id uuid;
  v_product_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'routings' THEN
    IF NOT EXISTS (SELECT 1 FROM public.products p
      WHERE p.id = NEW.product_id AND p.business_id = NEW.business_id) THEN
      RAISE EXCEPTION 'Routing product must belong to the same business.' USING ERRCODE = '23514';
    END IF;
    IF NEW.bom_version_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.manufacturing_boms b
      WHERE b.id = NEW.bom_version_id AND b.business_id = NEW.business_id
        AND b.product_id = NEW.product_id
    ) THEN
      RAISE EXCEPTION 'Routing BOM version must match its product and business.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'routing_steps' THEN
    IF NOT EXISTS (SELECT 1 FROM public.routings r
      WHERE r.id = NEW.routing_id AND r.business_id = NEW.business_id)
      OR NOT EXISTS (SELECT 1 FROM public.work_centres w
      WHERE w.id = NEW.work_centre_id AND w.business_id = NEW.business_id AND w.is_active) THEN
      RAISE EXCEPTION 'Routing steps and work centres must belong to the same business.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'manufacturing_work_orders' THEN
    IF NEW.routing_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.routings r
      WHERE r.id = NEW.routing_id AND r.business_id = NEW.business_id
        AND r.product_id = NEW.product_id
    ) THEN
      RAISE EXCEPTION 'Work-order routing must belong to the same product and business.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  ELSIF TG_TABLE_NAME = 'manufacturing_production_run_lines' THEN
    SELECT wo.business_id INTO v_business_id
    FROM public.manufacturing_production_runs run
    JOIN public.manufacturing_work_orders wo ON wo.id = run.work_order_id
    WHERE run.id = NEW.production_run_id;
    IF v_business_id IS NULL OR v_business_id <> NEW.business_id OR NOT EXISTS (
      SELECT 1 FROM public.products p WHERE p.id = NEW.component_product_id AND p.business_id = NEW.business_id
    ) THEN
      RAISE EXCEPTION 'Production-run lines must match the run and product business.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END
$function$;
DROP TRIGGER IF EXISTS work_centres_set_updated_at ON public.work_centres;
CREATE TRIGGER work_centres_set_updated_at BEFORE UPDATE ON public.work_centres
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS routings_set_updated_at ON public.routings;
CREATE TRIGGER routings_set_updated_at BEFORE UPDATE ON public.routings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS work_orders_execution_scope ON public.manufacturing_work_orders;
CREATE TRIGGER work_orders_execution_scope BEFORE INSERT OR UPDATE OF business_id, product_id, routing_id
  ON public.manufacturing_work_orders FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_validate_scope();
DROP TRIGGER IF EXISTS routings_execution_scope ON public.routings;
CREATE TRIGGER routings_execution_scope BEFORE INSERT OR UPDATE OF business_id, product_id, bom_version_id
  ON public.routings FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_validate_scope();
DROP TRIGGER IF EXISTS routing_steps_execution_scope ON public.routing_steps;
CREATE TRIGGER routing_steps_execution_scope BEFORE INSERT OR UPDATE OF business_id, routing_id, work_centre_id
  ON public.routing_steps FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_validate_scope();
DROP TRIGGER IF EXISTS manufacturing_run_lines_execution_scope ON public.manufacturing_production_run_lines;
CREATE TRIGGER manufacturing_run_lines_execution_scope BEFORE INSERT OR UPDATE OF business_id, production_run_id, component_product_id
  ON public.manufacturing_production_run_lines FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_validate_scope();

-- A depth-limited, cycle-safe BOM explosion used both when a new order is
-- created and by the existing release flow. The BOM graph is read-only here.
CREATE OR REPLACE FUNCTION public._mfg_execution_explode_order(p_work_order_id uuid, p_max_depth integer DEFAULT 20)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_wo public.manufacturing_work_orders%ROWTYPE;
  v_cycle boolean;
  v_too_deep boolean;
BEGIN
  SELECT * INTO v_wo FROM public.manufacturing_work_orders WHERE id = p_work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002'; END IF;

  WITH RECURSIVE walk(component_product_id, component_bom_id, quantity_factor, unit_of_measure,
                      scrap_pct, notes, depth, bom_path, cycle_found) AS (
    SELECT line.component_product_id, line.component_bom_id,
           line.quantity * (1 + line.scrap_pct / 100), line.unit_of_measure,
           line.scrap_pct, line.notes, 1,
           ARRAY[v_wo.bom_id]::uuid[],
           COALESCE(line.component_bom_id = ANY(ARRAY[v_wo.bom_id]::uuid[]), false)
    FROM public.manufacturing_bom_lines line
    WHERE line.bom_id = v_wo.bom_id
    UNION ALL
    SELECT line.component_product_id, line.component_bom_id,
           walk.quantity_factor * line.quantity * (1 + line.scrap_pct / 100),
           line.unit_of_measure, line.scrap_pct, line.notes, walk.depth + 1,
           walk.bom_path || walk.component_bom_id,
           COALESCE(line.component_bom_id = ANY(walk.bom_path || walk.component_bom_id), false)
    FROM walk
    JOIN public.manufacturing_bom_lines line ON line.bom_id = walk.component_bom_id
    WHERE walk.component_bom_id IS NOT NULL AND NOT walk.cycle_found AND walk.depth < p_max_depth
  )
  SELECT COALESCE(bool_or(cycle_found), false),
         COALESCE(bool_or(depth = p_max_depth AND component_bom_id IS NOT NULL AND NOT cycle_found), false)
    INTO v_cycle, v_too_deep
  FROM walk;
  IF v_cycle THEN RAISE EXCEPTION 'BOM cycle detected during work-order explosion.' USING ERRCODE = '23514'; END IF;
  IF v_too_deep THEN RAISE EXCEPTION 'BOM nesting exceeds the supported work-order depth of %.', p_max_depth USING ERRCODE = '22023'; END IF;

  WITH RECURSIVE walk(component_product_id, component_bom_id, quantity_factor, unit_of_measure,
                      scrap_pct, notes, depth, bom_path, cycle_found) AS (
    SELECT line.component_product_id, line.component_bom_id,
           line.quantity * (1 + line.scrap_pct / 100), line.unit_of_measure,
           line.scrap_pct, line.notes, 1,
           ARRAY[v_wo.bom_id]::uuid[],
           COALESCE(line.component_bom_id = ANY(ARRAY[v_wo.bom_id]::uuid[]), false)
    FROM public.manufacturing_bom_lines line
    WHERE line.bom_id = v_wo.bom_id
    UNION ALL
    SELECT line.component_product_id, line.component_bom_id,
           walk.quantity_factor * line.quantity * (1 + line.scrap_pct / 100),
           line.unit_of_measure, line.scrap_pct, line.notes, walk.depth + 1,
           walk.bom_path || walk.component_bom_id,
           COALESCE(line.component_bom_id = ANY(walk.bom_path || walk.component_bom_id), false)
    FROM walk
    JOIN public.manufacturing_bom_lines line ON line.bom_id = walk.component_bom_id
    WHERE walk.component_bom_id IS NOT NULL AND NOT walk.cycle_found AND walk.depth < p_max_depth
  ), requirements AS (
    SELECT component_product_id, quantity_factor, unit_of_measure, scrap_pct, notes
    FROM walk WHERE component_bom_id IS NULL AND component_product_id IS NOT NULL AND NOT cycle_found
  )
  INSERT INTO public.manufacturing_work_order_lines
    (work_order_id, component_product_id, planned_quantity, actual_quantity_consumed,
     unit_of_measure, scrap_pct, notes)
  SELECT p_work_order_id, requirements.component_product_id,
         round(sum(requirements.quantity_factor) * v_wo.planned_quantity, 6), 0,
         COALESCE(product.unit_of_measure, min(requirements.unit_of_measure)),
         max(requirements.scrap_pct),
         NULLIF(string_agg(DISTINCT NULLIF(requirements.notes, ''), '; ')
           FILTER (WHERE NULLIF(requirements.notes, '') IS NOT NULL), '')
  FROM requirements
  JOIN public.products product ON product.id = requirements.component_product_id
    AND product.business_id = v_wo.business_id
  GROUP BY requirements.component_product_id, product.unit_of_measure
  ON CONFLICT (work_order_id, component_product_id) DO UPDATE
    SET planned_quantity = EXCLUDED.planned_quantity,
        unit_of_measure = EXCLUDED.unit_of_measure,
        scrap_pct = EXCLUDED.scrap_pct,
        notes = EXCLUDED.notes,
        updated_at = now();

  IF NOT EXISTS (SELECT 1 FROM public.manufacturing_work_order_lines WHERE work_order_id = p_work_order_id) THEN
    RAISE EXCEPTION 'The selected BOM contains no raw material components.' USING ERRCODE = '22023';
  END IF;
END
$function$;

-- Canonical create command: it persists the active BOM explosion immediately,
-- so the work order detail always shows the frozen component requirement list.
CREATE OR REPLACE FUNCTION public.create_work_order_from_bom(
  p_business_id uuid,
  p_product_id uuid,
  p_bom_version_id uuid,
  p_routing_id uuid,
  p_quantity numeric,
  p_reference text,
  p_planned_start date,
  p_planned_end date,
  p_priority text,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_notes text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor uuid;
  v_bom public.manufacturing_boms%ROWTYPE;
  v_route public.routings%ROWTYPE;
  v_reference text;
  v_work_order_id uuid;
BEGIN
  IF p_business_id IS NULL THEN RAISE EXCEPTION 'A business is required.' USING ERRCODE = '22023'; END IF;
  v_actor := public._mfg_wo_writer(p_business_id, 'create a work order');
  IF COALESCE(p_quantity, 0) <= 0 THEN RAISE EXCEPTION 'Quantity must be greater than zero.' USING ERRCODE = '22023'; END IF;
  IF COALESCE(p_priority, 'normal') NOT IN ('low', 'normal', 'high', 'urgent') THEN
    RAISE EXCEPTION 'Priority must be low, normal, high, or urgent.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bom FROM public.manufacturing_boms
    WHERE id = p_bom_version_id AND business_id = p_business_id AND status = 'active';
  IF NOT FOUND OR v_bom.product_id <> p_product_id THEN
    RAISE EXCEPTION 'An active BOM version for this product and business is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products p
    WHERE p.id = p_product_id AND p.business_id = p_business_id AND p.is_active) THEN
    RAISE EXCEPTION 'The output product must be active and belong to this business.' USING ERRCODE = '23514';
  END IF;
  IF p_from_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_locations l
    WHERE l.id = p_from_location_id AND l.business_id = p_business_id AND l.is_active) THEN
    RAISE EXCEPTION 'The material source location must be active and belong to this business.' USING ERRCODE = '23514';
  END IF;
  IF p_to_location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.inventory_locations l
    WHERE l.id = p_to_location_id AND l.business_id = p_business_id AND l.is_active) THEN
    RAISE EXCEPTION 'The finished-goods location must be active and belong to this business.' USING ERRCODE = '23514';
  END IF;

  IF p_routing_id IS NOT NULL THEN
    SELECT * INTO v_route FROM public.routings r
      WHERE r.id = p_routing_id AND r.business_id = p_business_id
        AND r.product_id = p_product_id AND r.status = 'active';
    IF NOT FOUND OR (v_route.bom_version_id IS NOT NULL AND v_route.bom_version_id <> p_bom_version_id) THEN
      RAISE EXCEPTION 'The selected routing must be active and match the product and BOM.' USING ERRCODE = '23514';
    END IF;
  END IF;

  v_reference := NULLIF(btrim(COALESCE(p_reference, '')), '');
  IF v_reference IS NULL THEN v_reference := public._mfg_wo_next_number(p_business_id); END IF;
  INSERT INTO public.manufacturing_work_orders
    (business_id, work_order_number, product_id, bom_id, planned_quantity, status,
     planned_start_date, planned_end_date, from_location_id, to_location_id, notes, created_by, priority, routing_id)
  VALUES
    (p_business_id, v_reference, p_product_id, p_bom_version_id, p_quantity, 'draft',
     p_planned_start, p_planned_end, p_from_location_id, p_to_location_id,
     NULLIF(btrim(COALESCE(p_notes, '')), ''), v_actor, COALESCE(p_priority, 'normal'), p_routing_id)
  RETURNING id INTO v_work_order_id;

  PERFORM public._mfg_execution_explode_order(v_work_order_id, 20);
  RETURN v_work_order_id;
END
$function$;
REVOKE ALL ON FUNCTION public._mfg_execution_explode_order(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_work_order_from_bom(uuid, uuid, uuid, uuid, numeric, text, date, date, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_work_order_from_bom(uuid, uuid, uuid, uuid, numeric, text, date, date, text, uuid, uuid, text) TO authenticated;

-- Start a run in an open state; the matching complete RPC posts all consumption
-- and finished output in the same database transaction.
CREATE OR REPLACE FUNCTION public._mfg_execution_prepare_run()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_wo public.manufacturing_work_orders%ROWTYPE;
  v_actor uuid;
BEGIN
  -- Legacy manufacturing_wo_record_run inserts completed rows directly; only
  -- the explicit in-progress path is augmented with run sequencing/snapshots.
  IF NEW.status <> 'in_progress' THEN RETURN NEW; END IF;
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
   WHERE id = NEW.work_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work order not found.' USING ERRCODE = 'P0002'; END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'start a production run');
  IF v_wo.status NOT IN ('released', 'in_progress') THEN
    RAISE EXCEPTION 'Only released or in-progress work orders can start a production run.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.manufacturing_work_order_lines WHERE work_order_id = v_wo.id) THEN
    RAISE EXCEPTION 'Release the work order before starting a run.' USING ERRCODE = '22023';
  END IF;
  IF NEW.output_location_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_locations l
    WHERE l.id = NEW.output_location_id AND l.business_id = v_wo.business_id AND l.is_active) THEN
    RAISE EXCEPTION 'An active finished-goods location belonging to this business is required.' USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(max(run_number), 0) + 1 INTO NEW.run_number
    FROM public.manufacturing_production_runs WHERE work_order_id = NEW.work_order_id;
  NEW.output_quantity := 0;
  NEW.scrap_quantity := 0;
  NEW.status := 'in_progress';
  NEW.started_at := COALESCE(NEW.started_at, now());
  NEW.completed_at := NULL;
  NEW.created_by := v_actor;
  IF v_wo.status = 'released' THEN
    UPDATE public.manufacturing_work_orders SET status = 'in_progress',
      actual_start_date = COALESCE(actual_start_date, now()), updated_at = now()
     WHERE id = v_wo.id;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public._mfg_execution_snapshot_run_lines()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_wo public.manufacturing_work_orders%ROWTYPE;
BEGIN
  IF NEW.status <> 'in_progress' THEN RETURN NEW; END IF;
  SELECT * INTO v_wo FROM public.manufacturing_work_orders WHERE id = NEW.work_order_id;
  INSERT INTO public.manufacturing_production_run_lines
    (production_run_id, business_id, component_product_id, quantity_expected, unit_of_measure)
  SELECT NEW.id, v_wo.business_id, wol.component_product_id, wol.planned_quantity,
         COALESCE(wol.unit_of_measure, p.unit_of_measure, 'ea')
    FROM public.manufacturing_work_order_lines wol
    JOIN public.products p ON p.id = wol.component_product_id AND p.business_id = v_wo.business_id
   WHERE wol.work_order_id = NEW.work_order_id;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public._mfg_execution_guard_run_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_business_id uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NOT ((OLD.status = 'in_progress' AND NEW.status IN ('completed', 'aborted', 'cancelled'))
      OR (OLD.status = 'completed' AND NEW.status = 'cancelled')) THEN
    RAISE EXCEPTION 'Invalid production-run status transition from % to %.', OLD.status, NEW.status USING ERRCODE = '22023';
  END IF;
  SELECT business_id INTO v_business_id FROM public.manufacturing_work_orders WHERE id = NEW.work_order_id;
  PERFORM public._mfg_wo_writer(v_business_id, 'update a production run');
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS manufacturing_run_prepare ON public.manufacturing_production_runs;
CREATE TRIGGER manufacturing_run_prepare BEFORE INSERT ON public.manufacturing_production_runs
  FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_prepare_run();
DROP TRIGGER IF EXISTS manufacturing_run_snapshot_lines ON public.manufacturing_production_runs;
CREATE TRIGGER manufacturing_run_snapshot_lines AFTER INSERT ON public.manufacturing_production_runs
  FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_snapshot_run_lines();
DROP TRIGGER IF EXISTS manufacturing_run_status_guard ON public.manufacturing_production_runs;
CREATE TRIGGER manufacturing_run_status_guard BEFORE UPDATE OF status ON public.manufacturing_production_runs
  FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_guard_run_status();

-- Extended stock posting helper: same stock_movements table and the existing
-- trg_stock_movement_apply_balance trigger; inventory_balances is never written
-- here. This is the production-run source-aware overload of the existing
-- _mfg_wo_movement posting helper.
CREATE OR REPLACE FUNCTION public._mfg_wo_movement(
  p_business_id uuid, p_product_id uuid, p_location_id uuid,
  p_movement_type text, p_movement_date date, p_quantity numeric,
  p_unit_cost numeric, p_source_id uuid, p_reference text, p_notes text,
  p_actor uuid, p_source_type text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(p_quantity, 0) = 0 THEN RETURN NULL; END IF;
  IF p_source_type NOT IN ('production_run', 'manufacturing_work_order') THEN
    RAISE EXCEPTION 'Unsupported manufacturing stock movement source.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.stock_movements
    (business_id, product_id, location_id, movement_type, movement_date, quantity,
     unit_cost, source_type, source_id, reference, created_by, notes)
  VALUES
    (p_business_id, p_product_id, p_location_id,
     p_movement_type::public.stock_movement_type, p_movement_date, p_quantity,
     COALESCE(p_unit_cost, 0), p_source_type, p_source_id::text, p_reference, p_actor, p_notes)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$function$;

CREATE OR REPLACE FUNCTION public.complete_production_run(
  p_business_id uuid,
  p_run_id uuid,
  p_quantity_produced numeric,
  p_quantity_scrapped numeric,
  p_scrap_reason text,
  p_output_location_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_run public.manufacturing_production_runs%ROWTYPE;
  v_wo public.manufacturing_work_orders%ROWTYPE;
  v_actor uuid;
  v_location_id uuid;
  v_from uuid;
  v_line record;
  v_consume numeric;
  v_unit numeric;
  v_total_cost numeric := 0;
  v_line_cost numeric;
  v_branch uuid;
  v_wip uuid;
  v_rm uuid;
  v_fg uuid;
  v_wo_updated public.manufacturing_work_orders%ROWTYPE;
  v_run_updated public.manufacturing_production_runs%ROWTYPE;
BEGIN
  IF COALESCE(p_quantity_produced, 0) <= 0 OR COALESCE(p_quantity_scrapped, 0) < 0 THEN
    RAISE EXCEPTION 'Produced quantity must be positive and scrapped quantity cannot be negative.' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_quantity_scrapped, 0) > 0 AND NULLIF(btrim(COALESCE(p_scrap_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'A scrap reason is required when production is scrapped.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM public.manufacturing_production_runs
    WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found.' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_wo FROM public.manufacturing_work_orders
    WHERE id = v_run.work_order_id AND business_id = p_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Production run not found for this business.' USING ERRCODE = 'P0002'; END IF;
  v_actor := public._mfg_wo_writer(v_wo.business_id, 'complete a production run');
  IF v_run.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Only an in-progress production run can be completed.' USING ERRCODE = '22023';
  END IF;
  IF v_wo.status NOT IN ('released', 'in_progress') THEN
    RAISE EXCEPTION 'The parent work order is not open for production.' USING ERRCODE = '22023';
  END IF;
  IF v_wo.completed_quantity + p_quantity_produced + p_quantity_scrapped > v_wo.planned_quantity * 1.10 THEN
    RAISE EXCEPTION 'Production output exceeds the allowed overproduction tolerance.' USING ERRCODE = '22023';
  END IF;
  v_location_id := COALESCE(p_output_location_id, v_run.output_location_id, v_wo.to_location_id);
  IF v_location_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_locations l
    WHERE l.id = v_location_id AND l.business_id = p_business_id AND l.is_active) THEN
    RAISE EXCEPTION 'An active output location belonging to this business is required.' USING ERRCODE = '23514';
  END IF;
  PERFORM public._ledgr_assert_period_open(v_wo.business_id, current_date, 'Production run');
  v_from := COALESCE(v_wo.from_location_id, public._mfg_wo_location(v_wo.business_id, 'raw_materials_store'));
  IF v_from IS NULL OR NOT EXISTS (SELECT 1 FROM public.inventory_locations l WHERE l.id = v_from AND l.business_id = p_business_id AND l.is_active) THEN
    RAISE EXCEPTION 'An active raw-material location belonging to this business is required.' USING ERRCODE = '23514';
  END IF;
  SELECT l.branch_id INTO v_branch FROM public.inventory_locations l WHERE l.id = v_from;
  v_wip := public._mfg_wo_wip_account(v_wo.business_id);
  v_rm := public._mfg_wo_stock_account(v_wo.business_id, '1143', '1141', 'Raw Materials');
  v_fg := public._mfg_wo_stock_account(v_wo.business_id, '1142', '1141', 'Finished Goods');

  UPDATE public.manufacturing_production_runs
    SET output_quantity = p_quantity_produced, scrap_quantity = p_quantity_scrapped,
        status = 'completed', completed_at = now(), output_location_id = v_location_id,
        notes = concat_ws(E'\n', NULLIF(notes, ''), NULLIF(btrim(COALESCE(p_scrap_reason, '')), ''))
    WHERE id = p_run_id;

  FOR v_line IN
    SELECT run_line.*, p.purchase_price, p.name AS product_name
    FROM public.manufacturing_production_run_lines run_line
    JOIN public.products p ON p.id = run_line.component_product_id AND p.business_id = p_business_id
    WHERE run_line.production_run_id = p_run_id AND run_line.business_id = p_business_id
    ORDER BY run_line.component_product_id
  LOOP
    v_consume := round((v_line.quantity_expected / v_wo.planned_quantity) * (p_quantity_produced + p_quantity_scrapped), 6);
    IF v_consume <= 0 THEN CONTINUE; END IF;
    v_unit := COALESCE(v_line.purchase_price, 0);
    v_line_cost := round(v_consume * v_unit, 2);
    v_total_cost := v_total_cost + v_line_cost;
    UPDATE public.manufacturing_production_run_lines
      SET quantity_consumed = v_consume WHERE id = v_line.id;
    UPDATE public.manufacturing_work_order_lines
      SET actual_quantity_consumed = actual_quantity_consumed + v_consume, updated_at = now()
      WHERE work_order_id = v_wo.id AND component_product_id = v_line.component_product_id;
    INSERT INTO public.manufacturing_material_transactions
      (work_order_id, run_id, component_product_id, quantity, transaction_type,
       from_location_id, recorded_by, notes)
    VALUES (v_wo.id, p_run_id, v_line.component_product_id, v_consume, 'consume',
      v_from, v_actor, 'Production run ' || v_run.run_number || ' — ' || v_line.product_name);
    PERFORM public._mfg_wo_movement(
      v_wo.business_id, v_line.component_product_id, v_from,
      'manufacturing_issue', current_date, -v_consume, v_unit, p_run_id,
      v_wo.work_order_number || '/RUN-' || v_run.run_number,
      'Production run ' || v_run.run_number || ' — component consumption', v_actor, 'production_run');
  END LOOP;

  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id, 'mfg_run:' || p_run_id::text || ':consume', current_date,
    'Production run ' || v_run.run_number || ' — materials consumed', p_run_id::text,
    v_branch, v_wip, v_rm, v_total_cost, 'WIP — materials issued', 'Raw materials consumed');
  PERFORM public._mfg_wo_post_entry(
    v_wo.business_id, 'mfg_run:' || p_run_id::text || ':receipt', current_date,
    'Production run ' || v_run.run_number || ' — finished goods received', p_run_id::text,
    v_branch, v_fg, v_wip, v_total_cost, 'Finished goods received', 'WIP cleared to finished goods');
  PERFORM public._mfg_wo_movement(
    v_wo.business_id, v_wo.product_id, v_location_id, 'manufacturing_receipt', current_date,
    p_quantity_produced, CASE WHEN p_quantity_produced > 0 THEN round(v_total_cost / p_quantity_produced, 6) ELSE 0 END,
    p_run_id, v_wo.work_order_number || '/RUN-' || v_run.run_number,
    'Production run ' || v_run.run_number || ' — finished goods output', v_actor, 'production_run');

  UPDATE public.manufacturing_work_orders
    SET completed_quantity = completed_quantity + p_quantity_produced,
        scrapped_quantity = scrapped_quantity + p_quantity_scrapped,
        status = CASE WHEN completed_quantity + p_quantity_produced >= planned_quantity THEN 'completed' ELSE status END,
        actual_end_date = CASE WHEN completed_quantity + p_quantity_produced >= planned_quantity THEN now() ELSE actual_end_date END,
        updated_at = now()
    WHERE id = v_wo.id;
  SELECT * INTO v_run_updated FROM public.manufacturing_production_runs WHERE id = p_run_id;
  SELECT * INTO v_wo_updated FROM public.manufacturing_work_orders WHERE id = v_wo.id;
  RETURN jsonb_build_object('run', to_jsonb(v_run_updated), 'work_order', to_jsonb(v_wo_updated));
END
$function$;

CREATE OR REPLACE FUNCTION public._mfg_execution_guard_routing_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'New routings must start as drafts.' USING ERRCODE = '22023'; END IF;
    PERFORM public._mfg_wo_writer(NEW.business_id, 'create a manufacturing routing');
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND
     ROW(NEW.business_id, NEW.product_id, NEW.bom_version_id, NEW.code, NEW.name, NEW.version_number, NEW.notes)
       IS DISTINCT FROM
     ROW(OLD.business_id, OLD.product_id, OLD.bom_version_id, OLD.code, OLD.name, OLD.version_number, OLD.notes) THEN
    RAISE EXCEPTION 'Only a draft routing can be edited.' USING ERRCODE = '22023';
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  v_actor := public._mfg_wo_writer(NEW.business_id, 'change a manufacturing routing status');
  IF NEW.status = 'active' AND OLD.status = 'draft' THEN
    IF NOT EXISTS (SELECT 1 FROM public.routing_steps WHERE routing_id = NEW.id AND business_id = NEW.business_id) THEN
      RAISE EXCEPTION 'A routing needs at least one step before activation.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.routing_steps rs LEFT JOIN public.work_centres wc ON wc.id = rs.work_centre_id
      WHERE rs.routing_id = NEW.id AND (wc.id IS NULL OR wc.business_id <> NEW.business_id OR NOT wc.is_active)) THEN
      RAISE EXCEPTION 'All routing work centres must be active before activation.' USING ERRCODE = '22023';
    END IF;
  ELSIF NEW.status = 'archived' AND OLD.status IN ('draft', 'active') THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Invalid routing status transition from % to %.', OLD.status, NEW.status USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public._mfg_execution_guard_routing_step()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE v_routing_id uuid; v_status text;
BEGIN
  v_routing_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.routing_id ELSE NEW.routing_id END;
  SELECT status INTO v_status FROM public.routings WHERE id = v_routing_id;
  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft routing steps can be changed.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END
$function$;
DROP TRIGGER IF EXISTS routings_status_guard ON public.routings;
CREATE TRIGGER routings_status_guard BEFORE INSERT OR UPDATE OF status, business_id, product_id, bom_version_id, code, name, version_number, notes
  ON public.routings FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_guard_routing_status();
DROP TRIGGER IF EXISTS routing_steps_draft_guard ON public.routing_steps;
CREATE TRIGGER routing_steps_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON public.routing_steps
  FOR EACH ROW EXECUTE FUNCTION public._mfg_execution_guard_routing_step();

REVOKE ALL ON FUNCTION public._mfg_execution_validate_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_execution_prepare_run() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_execution_snapshot_run_lines() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_execution_guard_run_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_execution_guard_routing_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_execution_guard_routing_step() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._mfg_wo_movement(uuid, uuid, uuid, text, date, numeric, numeric, uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_production_run(uuid, uuid, numeric, numeric, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_production_run(uuid, uuid, numeric, numeric, text, uuid) TO authenticated;
