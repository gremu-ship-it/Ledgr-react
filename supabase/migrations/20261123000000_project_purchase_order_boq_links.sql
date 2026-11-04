-- Phase 5B-2c project procurement ↔ BOQ association.
-- The existing construction purchase-order, receipt, bill-matching, issue and
-- return commands remain the source of truth. This additive relation links an
-- existing project purchase-order line to an active BOQ item without altering
-- any prior construction, inventory or accounting table.

CREATE TABLE IF NOT EXISTS public.project_purchase_order_boq_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  purchase_order_line_id uuid NOT NULL REFERENCES public.construction_purchase_order_lines(id) ON DELETE CASCADE,
  boq_item_id uuid NOT NULL REFERENCES public.boq_items(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  UNIQUE (business_id, purchase_order_line_id)
);

CREATE INDEX IF NOT EXISTS idx_project_po_boq_links_project
  ON public.project_purchase_order_boq_links (business_id, project_id);
CREATE INDEX IF NOT EXISTS idx_project_po_boq_links_boq_item
  ON public.project_purchase_order_boq_links (boq_item_id);

ALTER TABLE public.project_purchase_order_boq_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS project_po_boq_links_member_read ON public.project_purchase_order_boq_links;
CREATE POLICY project_po_boq_links_member_read
  ON public.project_purchase_order_boq_links FOR SELECT TO authenticated
  USING (public.is_business_member(business_id)
    AND cardinality(public.construction_procurement_capabilities_for(business_id)) > 0);
DROP POLICY IF EXISTS project_po_boq_links_member_write ON public.project_purchase_order_boq_links;
REVOKE ALL ON public.project_purchase_order_boq_links FROM PUBLIC, anon;
GRANT SELECT ON public.project_purchase_order_boq_links TO authenticated;

CREATE OR REPLACE FUNCTION public._project_po_boq_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_project_id uuid;
  v_po_status text;
  v_item_project_id uuid;
  v_item_status text;
  v_po_product uuid;
  v_boq_product uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public._ledgr_construction_actor(OLD.business_id, 'procurement.po.manage');
    SELECT po.project_id, po.status INTO v_project_id, v_po_status
      FROM public.construction_purchase_order_lines l
      JOIN public.construction_purchase_orders po ON po.id = l.po_id AND po.business_id = l.business_id
     WHERE l.id = OLD.purchase_order_line_id AND l.business_id = OLD.business_id
     FOR UPDATE OF po;
    IF NOT FOUND OR v_project_id IS DISTINCT FROM OLD.project_id OR v_po_status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft purchase-order lines in this project can change their BOQ link.' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  PERFORM public._ledgr_construction_actor(NEW.business_id, 'procurement.po.manage');
  IF TG_OP = 'UPDATE' AND ROW(NEW.id, NEW.business_id, NEW.project_id, NEW.purchase_order_line_id, NEW.created_at, NEW.created_by)
      IS DISTINCT FROM ROW(OLD.id, OLD.business_id, OLD.project_id, OLD.purchase_order_line_id, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'BOQ link identity fields are immutable.' USING ERRCODE = '22023';
  END IF;

  SELECT po.project_id, po.status, l.product_id
    INTO v_project_id, v_po_status, v_po_product
    FROM public.construction_purchase_order_lines l
    JOIN public.construction_purchase_orders po ON po.id = l.po_id AND po.business_id = l.business_id
   WHERE l.id = NEW.purchase_order_line_id AND l.business_id = NEW.business_id
   FOR UPDATE OF po;
  IF NOT FOUND OR v_project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'Purchase-order line must belong to the same business and project.' USING ERRCODE = '23514';
  END IF;
  IF v_po_status <> 'draft' THEN
    RAISE EXCEPTION 'BOQ links can only be changed while the purchase order is a draft.' USING ERRCODE = '55000';
  END IF;

  SELECT v.project_id, v.status, i.product_id
    INTO v_item_project_id, v_item_status, v_boq_product
    FROM public.boq_items i
    JOIN public.boq_versions v ON v.id = i.boq_version_id AND v.business_id = i.business_id
   WHERE i.id = NEW.boq_item_id AND i.business_id = NEW.business_id
   FOR KEY SHARE OF v;
  IF NOT FOUND OR v_item_project_id IS DISTINCT FROM NEW.project_id OR v_item_status <> 'active' THEN
    RAISE EXCEPTION 'BOQ item must belong to an active version of this project.' USING ERRCODE = '23514';
  END IF;
  IF v_po_product IS NOT NULL AND v_boq_product IS NOT NULL AND v_po_product <> v_boq_product THEN
    RAISE EXCEPTION 'The purchase-order product does not match the linked BOQ item.' USING ERRCODE = '23514';
  END IF;
  NEW.created_by := auth.uid();
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public._project_po_boq_link_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS project_po_boq_links_guard ON public.project_purchase_order_boq_links;
CREATE TRIGGER project_po_boq_links_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_purchase_order_boq_links
  FOR EACH ROW EXECUTE FUNCTION public._project_po_boq_link_guard();

CREATE OR REPLACE FUNCTION public.set_project_purchase_order_boq_link(
  p_business_id uuid,
  p_project_id uuid,
  p_purchase_order_line_id uuid,
  p_boq_item_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_project_business uuid;
  v_line_business uuid;
  v_project_id uuid;
  v_status text;
  v_link public.project_purchase_order_boq_links%ROWTYPE;
BEGIN
  PERFORM public._ledgr_construction_actor(p_business_id, 'procurement.po.manage');
  SELECT business_id INTO v_project_business FROM public.construction_projects WHERE id = p_project_id FOR UPDATE;
  IF NOT FOUND OR v_project_business IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'Project does not belong to this business.' USING ERRCODE = '42501';
  END IF;
  SELECT po.business_id, po.project_id, po.status
    INTO v_line_business, v_project_id, v_status
    FROM public.construction_purchase_order_lines l
    JOIN public.construction_purchase_orders po ON po.id = l.po_id AND po.business_id = l.business_id
   WHERE l.id = p_purchase_order_line_id
   FOR UPDATE OF po;
  IF NOT FOUND OR v_line_business IS DISTINCT FROM p_business_id OR v_project_id IS DISTINCT FROM p_project_id THEN
    RAISE EXCEPTION 'Purchase-order line does not belong to this project.' USING ERRCODE = '42501';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'BOQ links can only be changed while the purchase order is a draft.' USING ERRCODE = '55000';
  END IF;

  DELETE FROM public.project_purchase_order_boq_links
   WHERE business_id = p_business_id AND project_id = p_project_id
     AND purchase_order_line_id = p_purchase_order_line_id;
  IF p_boq_item_id IS NULL THEN
    RETURN jsonb_build_object('id', NULL, 'purchase_order_line_id', p_purchase_order_line_id,
      'project_id', p_project_id, 'boq_item_id', NULL);
  END IF;
  INSERT INTO public.project_purchase_order_boq_links
    (business_id, project_id, purchase_order_line_id, boq_item_id)
  VALUES (p_business_id, p_project_id, p_purchase_order_line_id, p_boq_item_id)
  RETURNING * INTO v_link;
  RETURN to_jsonb(v_link);
END
$function$;
REVOKE ALL ON FUNCTION public.set_project_purchase_order_boq_link(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_project_purchase_order_boq_link(uuid, uuid, uuid, uuid) TO authenticated;
