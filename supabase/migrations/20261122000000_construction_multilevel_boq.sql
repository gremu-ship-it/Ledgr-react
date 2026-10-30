-- Phase 5B-2b: versioned, hierarchical construction Bills of Quantities.
-- BOQ quantities/rates describe project scope; these tables are independent of
-- manufacturing BOMs. Existing project_boq_lines remain the compatibility
-- schedule consumed by the shipped valuation RPCs and are synchronized from
-- the active BOQ only while the project has not yet been locked by a valuation.

CREATE TABLE IF NOT EXISTS public.boq_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  version_label text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  total_value numeric(18,2) NOT NULL DEFAULT 0 CHECK (total_value >= 0 AND total_value < 'Infinity'::numeric AND total_value <> 'NaN'::numeric),
  currency text NOT NULL DEFAULT 'MWK',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (project_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_boq_versions_project ON public.boq_versions(project_id);
CREATE INDEX IF NOT EXISTS idx_boq_versions_status ON public.boq_versions(project_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_boq_versions_one_active_per_project
  ON public.boq_versions(project_id) WHERE status = 'active';
ALTER TABLE public.boq_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS boq_versions_member_read ON public.boq_versions;
CREATE POLICY boq_versions_member_read ON public.boq_versions FOR SELECT TO authenticated
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS boq_versions_member_write ON public.boq_versions;
CREATE POLICY boq_versions_member_write ON public.boq_versions FOR ALL TO authenticated
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
  WITH CHECK (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
REVOKE ALL ON public.boq_versions FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boq_versions TO authenticated;

CREATE TABLE IF NOT EXISTS public.boq_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_version_id uuid NOT NULL REFERENCES public.boq_versions(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  parent_section_id uuid REFERENCES public.boq_sections(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  level integer NOT NULL DEFAULT 0 CHECK (level >= 0),
  UNIQUE (boq_version_id, code),
  UNIQUE (id, boq_version_id, business_id),
  FOREIGN KEY (parent_section_id, boq_version_id, business_id)
    REFERENCES public.boq_sections(id, boq_version_id, business_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_boq_sections_version ON public.boq_sections(boq_version_id);
CREATE INDEX IF NOT EXISTS idx_boq_sections_parent ON public.boq_sections(parent_section_id);
ALTER TABLE public.boq_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS boq_sections_member_read ON public.boq_sections;
CREATE POLICY boq_sections_member_read ON public.boq_sections FOR SELECT TO authenticated
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS boq_sections_member_write ON public.boq_sections;
CREATE POLICY boq_sections_member_write ON public.boq_sections FOR ALL TO authenticated
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
  WITH CHECK (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
REVOKE ALL ON public.boq_sections FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boq_sections TO authenticated;

CREATE TABLE IF NOT EXISTS public.boq_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boq_version_id uuid NOT NULL REFERENCES public.boq_versions(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES public.boq_sections(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  item_number text NOT NULL,
  description text NOT NULL,
  unit_of_measure text NOT NULL DEFAULT 'm²',
  quantity numeric(14,4) NOT NULL DEFAULT 0
    CHECK (quantity >= 0 AND quantity < 'Infinity'::numeric AND quantity <> 'NaN'::numeric),
  rate numeric(14,4) NOT NULL DEFAULT 0
    CHECK (rate >= 0 AND rate < 'Infinity'::numeric AND rate <> 'NaN'::numeric),
  amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (amount >= 0 AND amount < 'Infinity'::numeric AND amount <> 'NaN'::numeric),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  cost_code text,
  is_provisional boolean NOT NULL DEFAULT false,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  UNIQUE (boq_version_id, item_number)
);
CREATE INDEX IF NOT EXISTS idx_boq_items_version ON public.boq_items(boq_version_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_section ON public.boq_items(section_id);
ALTER TABLE public.boq_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS boq_items_member_read ON public.boq_items;
CREATE POLICY boq_items_member_read ON public.boq_items FOR SELECT TO authenticated
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS boq_items_member_write ON public.boq_items;
CREATE POLICY boq_items_member_write ON public.boq_items FOR ALL TO authenticated
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0)
  WITH CHECK (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
REVOKE ALL ON public.boq_items FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boq_items TO authenticated;

-- Preserve existing schedule-of-values/valuation history by importing current
-- lines into version 1 with their stable line ids. The project row is only read.
INSERT INTO public.boq_versions
  (id, business_id, project_id, version_number, version_label, status, total_value, currency, created_by)
SELECT p.id, p.business_id, p.id, 1, NULL, 'active',
       round(coalesce(sum(l.quantity * l.rate), 0), 2), coalesce(b.base_currency, 'MWK'), NULL
  FROM public.construction_projects p
  JOIN public.businesses b ON b.id = p.business_id
  JOIN public.project_boq_lines l ON l.project_id = p.id
 GROUP BY p.id, p.business_id, b.base_currency
ON CONFLICT (project_id, version_number) DO NOTHING;

INSERT INTO public.boq_sections
  (id, boq_version_id, business_id, parent_section_id, code, title, description, sort_order, level)
SELECT md5(p.id::text || ':boq-existing-root')::uuid, p.id, p.business_id, NULL,
       '1', p.name, NULL, 0, 0
  FROM public.construction_projects p
 WHERE EXISTS (SELECT 1 FROM public.project_boq_lines l WHERE l.project_id = p.id)
ON CONFLICT (boq_version_id, code) DO NOTHING;

WITH numbered AS (
  SELECT l.*, row_number() OVER (PARTITION BY l.project_id ORDER BY l.sort_order, l.line_number, l.id) AS line_idx
    FROM public.project_boq_lines l
)
INSERT INTO public.boq_items
  (id, boq_version_id, section_id, business_id, item_number, description, unit_of_measure,
   quantity, rate, amount, product_id, cost_code, is_provisional, notes, sort_order)
SELECT l.id, l.project_id, md5(l.project_id::text || ':boq-existing-root')::uuid,
       p.business_id, '1.' || l.line_idx::text, l.description, coalesce(nullif(l.unit, ''), 'ea'),
       l.quantity, l.rate, round(l.quantity * l.rate, 2), NULL, NULL, false, NULL, l.sort_order
  FROM numbered l
  JOIN public.construction_projects p ON p.id = l.project_id
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.calculate_boq_item_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  NEW.amount := round(NEW.quantity * NEW.rate, 2);
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.calculate_boq_item_amount() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.recalculate_boq_total(p_boq_version_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  UPDATE public.boq_versions v
     SET total_value = (SELECT coalesce(sum(i.amount), 0)::numeric
                          FROM public.boq_items i
                         WHERE i.boq_version_id = p_boq_version_id)
   WHERE v.id = p_boq_version_id
  RETURNING total_value
$function$;
REVOKE ALL ON FUNCTION public.recalculate_boq_total(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._boq_version_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_project public.construction_projects%ROWTYPE;
  v_actor uuid;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_actor := public._ledgr_construction_actor(NEW.business_id, 'procurement.master.manage');
    SELECT * INTO v_project FROM public.construction_projects
     WHERE id = NEW.project_id AND business_id = NEW.business_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The BOQ project must belong to this business.' USING ERRCODE = '23514'; END IF;
    IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be edited.' USING ERRCODE = '55000'; END IF;
    IF NEW.status <> 'draft' THEN RAISE EXCEPTION 'New BOQ versions must start as drafts.' USING ERRCODE = '22023'; END IF;
    NEW.created_by := v_actor;
    NEW.total_value := 0;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_actor := public._ledgr_construction_actor(OLD.business_id, 'procurement.master.manage');
    SELECT * INTO v_project FROM public.construction_projects
     WHERE id = OLD.project_id AND business_id = OLD.business_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'BOQ project not found.' USING ERRCODE = 'P0002'; END IF;
    IF v_project.boq_locked_at IS NOT NULL OR OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Only unlocked draft BOQ versions can be deleted.' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  v_actor := public._ledgr_construction_actor(NEW.business_id, 'procurement.master.manage');
  IF ROW(NEW.id, NEW.business_id, NEW.project_id, NEW.version_number, NEW.created_at, NEW.created_by)
       IS DISTINCT FROM ROW(OLD.id, OLD.business_id, OLD.project_id, OLD.version_number, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'BOQ version identity fields are immutable.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_project FROM public.construction_projects
   WHERE id = NEW.project_id AND business_id = NEW.business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOQ project not found.' USING ERRCODE = 'P0002'; END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF ROW(NEW.version_label, NEW.currency, NEW.notes) IS DISTINCT FROM ROW(OLD.version_label, OLD.currency, OLD.notes)
       AND (OLD.status <> 'draft' OR v_project.boq_locked_at IS NOT NULL) THEN
      RAISE EXCEPTION 'Only an unlocked draft BOQ version can be edited.' USING ERRCODE = '55000';
    END IF;
    IF v_project.boq_locked_at IS NOT NULL AND OLD.status = 'draft' THEN
      RAISE EXCEPTION 'BOQ is locked and cannot be edited.' USING ERRCODE = '55000';
    END IF;
    NEW.total_value := (SELECT coalesce(sum(i.amount), 0)::numeric
                          FROM public.boq_items i WHERE i.boq_version_id = NEW.id);
    RETURN NEW;
  END IF;

  IF OLD.status = 'draft' AND NEW.status = 'active' THEN
    IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'BOQ is locked and cannot be activated.' USING ERRCODE = '55000'; END IF;
    UPDATE public.boq_versions SET status = 'archived'
     WHERE project_id = NEW.project_id AND status = 'active' AND id <> NEW.id;
    NEW.total_value := (SELECT coalesce(sum(i.amount), 0)::numeric
                          FROM public.boq_items i WHERE i.boq_version_id = NEW.id);
    -- Keep the established schedule-of-values reader used by progress valuations
    -- aligned with the active version. Once a valuation sets boq_locked_at, this
    -- synchronization and all subsequent BOQ revisions are refused above.
    DELETE FROM public.project_boq_lines WHERE project_id = NEW.project_id;
    WITH RECURSIVE section_order AS (
      SELECT s.id, s.parent_section_id, s.sort_order, ARRAY[s.sort_order]::integer[] AS order_path
        FROM public.boq_sections s
       WHERE s.boq_version_id = NEW.id AND s.parent_section_id IS NULL
      UNION ALL
      SELECT child.id, child.parent_section_id, child.sort_order, parent.order_path || child.sort_order
        FROM public.boq_sections child
        JOIN section_order parent ON parent.id = child.parent_section_id
       WHERE child.boq_version_id = NEW.id
    ), ordered_items AS (
      SELECT i.*, row_number() OVER (ORDER BY s.order_path, i.sort_order, i.item_number, i.id) - 1 AS ordinal
        FROM public.boq_items i
        JOIN section_order s ON s.id = i.section_id
       WHERE i.boq_version_id = NEW.id
    )
    INSERT INTO public.project_boq_lines
      (id, project_id, line_number, description, quantity, unit, rate, total_value, sort_order)
    SELECT i.id, NEW.project_id, i.item_number, i.description, i.quantity, i.unit_of_measure,
           i.rate, i.amount, i.ordinal::integer
      FROM ordered_items i;
  ELSIF OLD.status = 'active' AND NEW.status = 'archived' THEN
    IF v_project.boq_locked_at IS NOT NULL THEN RAISE EXCEPTION 'A valued BOQ version cannot be archived.' USING ERRCODE = '55000'; END IF;
  ELSE
    RAISE EXCEPTION 'Invalid BOQ version status transition from % to %.', OLD.status, NEW.status USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public._boq_version_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS boq_versions_guard ON public.boq_versions;
CREATE TRIGGER boq_versions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.boq_versions
  FOR EACH ROW EXECUTE FUNCTION public._boq_version_guard();

CREATE OR REPLACE FUNCTION public._boq_section_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_business_id uuid;
  v_version_id uuid;
  v_status text;
  v_project_id uuid;
  v_locked_at timestamptz;
  v_parent public.boq_sections%ROWTYPE;
  v_actor uuid;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'DELETE' THEN
    v_business_id := OLD.business_id;
    v_version_id := OLD.boq_version_id;
  ELSE
    v_business_id := NEW.business_id;
    v_version_id := NEW.boq_version_id;
  END IF;
  v_actor := public._ledgr_construction_actor(v_business_id, 'procurement.master.manage');
  SELECT v.status, v.project_id, p.boq_locked_at INTO v_status, v_project_id, v_locked_at
    FROM public.boq_versions v
    JOIN public.construction_projects p ON p.id = v.project_id AND p.business_id = v.business_id
   WHERE v.id = v_version_id AND v.business_id = v_business_id FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOQ version was not found for this business.' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'draft' OR v_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only unlocked draft BOQ sections can be changed.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW.boq_version_id, NEW.business_id)
      IS DISTINCT FROM ROW(OLD.id, OLD.boq_version_id, OLD.business_id) THEN
    RAISE EXCEPTION 'BOQ section identity fields are immutable.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_section_id IS DISTINCT FROM OLD.parent_section_id THEN
    RAISE EXCEPTION 'A BOQ section cannot be moved after creation.' USING ERRCODE = '22023';
  END IF;
  IF NEW.parent_section_id IS NULL THEN
    NEW.level := 0;
  ELSE
    SELECT * INTO v_parent FROM public.boq_sections
     WHERE id = NEW.parent_section_id AND boq_version_id = NEW.boq_version_id AND business_id = NEW.business_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Parent section must belong to the same BOQ version.' USING ERRCODE = '23514'; END IF;
    IF TG_OP = 'UPDATE' THEN
      IF EXISTS (
        WITH RECURSIVE descendants(id) AS (
          SELECT NEW.id
          UNION ALL
          SELECT child.id FROM public.boq_sections child JOIN descendants d ON child.parent_section_id = d.id
        ) SELECT 1 FROM descendants WHERE id = NEW.parent_section_id
      ) THEN RAISE EXCEPTION 'A BOQ section cannot be nested under itself or one of its descendants.' USING ERRCODE = '23514'; END IF;
    END IF;
    NEW.level := v_parent.level + 1;
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public._boq_section_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS boq_sections_guard ON public.boq_sections;
CREATE TRIGGER boq_sections_guard BEFORE INSERT OR UPDATE OR DELETE ON public.boq_sections
  FOR EACH ROW EXECUTE FUNCTION public._boq_section_guard();

CREATE OR REPLACE FUNCTION public._boq_item_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_status text;
  v_project_id uuid;
  v_locked_at timestamptz;
  v_actor uuid;
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  v_actor := public._ledgr_construction_actor(CASE WHEN TG_OP = 'DELETE' THEN OLD.business_id ELSE NEW.business_id END,
    'procurement.master.manage');
  SELECT v.status, v.project_id, p.boq_locked_at INTO v_status, v_project_id, v_locked_at
    FROM public.boq_versions v
    JOIN public.construction_projects p ON p.id = v.project_id AND p.business_id = v.business_id
   WHERE v.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.boq_version_id ELSE NEW.boq_version_id END
     AND v.business_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.business_id ELSE NEW.business_id END
   FOR UPDATE OF p;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOQ version was not found for this business.' USING ERRCODE = 'P0002'; END IF;
  IF v_status <> 'draft' OR v_locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only unlocked draft BOQ items can be changed.' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW.business_id, NEW.boq_version_id)
      IS DISTINCT FROM ROW(OLD.id, OLD.business_id, OLD.boq_version_id) THEN
    RAISE EXCEPTION 'BOQ item identity fields are immutable.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.boq_sections s
    WHERE s.id = NEW.section_id AND s.boq_version_id = NEW.boq_version_id AND s.business_id = NEW.business_id) THEN
    RAISE EXCEPTION 'BOQ item section must belong to the same version and business.' USING ERRCODE = '23514';
  END IF;
  IF NEW.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.business_id = NEW.business_id) THEN
    RAISE EXCEPTION 'BOQ product must belong to the same business.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public._boq_item_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS boq_items_guard ON public.boq_items;
CREATE TRIGGER boq_items_guard BEFORE INSERT OR UPDATE OR DELETE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public._boq_item_guard();

CREATE OR REPLACE FUNCTION public._boq_recalculate_total_after_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalculate_boq_total(OLD.boq_version_id);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.boq_version_id = NEW.boq_version_id
      AND OLD.amount IS NOT DISTINCT FROM NEW.amount THEN
    RETURN NEW;
  END IF;
  PERFORM public.recalculate_boq_total(NEW.boq_version_id);
  IF TG_OP = 'UPDATE' AND OLD.boq_version_id <> NEW.boq_version_id THEN
    PERFORM public.recalculate_boq_total(OLD.boq_version_id);
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public._boq_recalculate_total_after_item_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS boq_items_recalculate_total ON public.boq_items;
CREATE TRIGGER boq_items_recalculate_total AFTER INSERT OR UPDATE OR DELETE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public._boq_recalculate_total_after_item_change();
DROP TRIGGER IF EXISTS trg_boq_item_amount ON public.boq_items;
CREATE TRIGGER trg_boq_item_amount BEFORE INSERT OR UPDATE ON public.boq_items
  FOR EACH ROW EXECUTE FUNCTION public.calculate_boq_item_amount();

REVOKE ALL ON FUNCTION public._boq_version_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._boq_section_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._boq_item_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._boq_recalculate_total_after_item_change() FROM PUBLIC, anon, authenticated;
