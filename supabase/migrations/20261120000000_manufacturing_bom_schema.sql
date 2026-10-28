-- Versioned, tenant-scoped bill of materials with nested sub-assemblies.
CREATE TABLE public.boms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  code text NOT NULL,
  name text NOT NULL,
  description text,
  unit_of_measure text NOT NULL DEFAULT 'ea',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT boms_business_code_unique UNIQUE (business_id, code),
  CONSTRAINT boms_code_not_blank CHECK (length(btrim(code)) > 0),
  CONSTRAINT boms_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX boms_business_product_idx ON public.boms (business_id, product_id);

CREATE TABLE public.bom_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  bom_id uuid NOT NULL REFERENCES public.boms(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  version_label text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  effective_from date,
  effective_to date,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bom_versions_bom_number_unique UNIQUE (bom_id, version_number),
  CONSTRAINT bom_versions_effective_dates_check CHECK (
    effective_from IS NULL OR effective_to IS NULL OR effective_to >= effective_from
  )
);

CREATE INDEX bom_versions_business_bom_idx ON public.bom_versions (business_id, bom_id, version_number DESC);
CREATE UNIQUE INDEX bom_versions_one_active_per_bom_idx
  ON public.bom_versions (bom_id) WHERE status = 'active';

CREATE TABLE public.bom_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  bom_version_id uuid NOT NULL REFERENCES public.bom_versions(id) ON DELETE CASCADE,
  component_product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  component_bom_version_id uuid REFERENCES public.bom_versions(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit_of_measure text NOT NULL DEFAULT 'ea',
  scrap_percentage numeric NOT NULL DEFAULT 0 CHECK (scrap_percentage >= 0 AND scrap_percentage < 100),
  sort_order integer NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bom_components_exactly_one_reference CHECK (
    (component_product_id IS NOT NULL AND component_bom_version_id IS NULL)
    OR (component_product_id IS NULL AND component_bom_version_id IS NOT NULL)
  )
);

CREATE INDEX bom_components_version_order_idx ON public.bom_components (bom_version_id, sort_order, id);
CREATE INDEX bom_components_product_idx ON public.bom_components (business_id, component_product_id) WHERE component_product_id IS NOT NULL;
CREATE INDEX bom_components_subassembly_idx ON public.bom_components (business_id, component_bom_version_id) WHERE component_bom_version_id IS NOT NULL;

COMMENT ON COLUMN public.bom_components.quantity IS
  'Component quantity required to produce exactly one output unit of the parent BOM.';

ALTER TABLE public.boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boms_select_member" ON public.boms
  FOR SELECT USING (public.is_business_member(business_id));
CREATE POLICY "boms_insert_member" ON public.boms
  FOR INSERT WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "boms_update_member" ON public.boms
  FOR UPDATE USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "boms_delete_member" ON public.boms
  FOR DELETE USING (public.is_business_member(business_id));

CREATE POLICY "bom_versions_select_member" ON public.bom_versions
  FOR SELECT USING (public.is_business_member(business_id));
CREATE POLICY "bom_versions_insert_member" ON public.bom_versions
  FOR INSERT WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "bom_versions_update_member" ON public.bom_versions
  FOR UPDATE USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "bom_versions_delete_member" ON public.bom_versions
  FOR DELETE USING (public.is_business_member(business_id));

CREATE POLICY "bom_components_select_member" ON public.bom_components
  FOR SELECT USING (public.is_business_member(business_id));
CREATE POLICY "bom_components_insert_member" ON public.bom_components
  FOR INSERT WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "bom_components_update_member" ON public.bom_components
  FOR UPDATE USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "bom_components_delete_member" ON public.bom_components
  FOR DELETE USING (public.is_business_member(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.boms TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bom_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bom_components TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_bom_business_product()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.product_id AND p.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'BOM output product must belong to the same business'
      USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.product_id IS DISTINCT FROM OLD.product_id AND EXISTS (
    SELECT 1 FROM public.bom_versions v WHERE v.bom_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'The output product cannot be changed after BOM versions exist'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER boms_validate_business_product
  BEFORE INSERT OR UPDATE OF business_id, product_id ON public.boms
  FOR EACH ROW EXECUTE FUNCTION public.validate_bom_business_product();

CREATE OR REPLACE FUNCTION public.validate_bom_version_business()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.boms b
    WHERE b.id = NEW.bom_id AND b.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'BOM version must belong to the same business as its BOM'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bom_versions_validate_business
  BEFORE INSERT OR UPDATE OF business_id, bom_id ON public.bom_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_bom_version_business();

CREATE OR REPLACE FUNCTION public.validate_bom_component()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_bom_id uuid;
  v_parent_status text;
  v_child_bom_id uuid;
  v_cycle_found boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT v.status INTO v_parent_status
    FROM public.bom_versions v
    WHERE v.id = OLD.bom_version_id AND v.business_id = OLD.business_id;
    IF v_parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Components can only be changed on draft BOM versions'
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;

  SELECT v.bom_id, v.status INTO v_parent_bom_id, v_parent_status
  FROM public.bom_versions v
  WHERE v.id = NEW.bom_version_id AND v.business_id = NEW.business_id;
  IF v_parent_bom_id IS NULL THEN
    RAISE EXCEPTION 'BOM component version must belong to the same business'
      USING ERRCODE = '23514';
  END IF;
  IF v_parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Components can only be changed on draft BOM versions'
      USING ERRCODE = '55000';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT v.status INTO v_parent_status
    FROM public.bom_versions v
    WHERE v.id = OLD.bom_version_id AND v.business_id = OLD.business_id;
    IF v_parent_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Components can only be changed on draft BOM versions'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF NEW.component_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.id = NEW.component_product_id AND p.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'BOM component product must belong to the same business'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.component_bom_version_id IS NOT NULL THEN
    SELECT v.bom_id INTO v_child_bom_id
    FROM public.bom_versions v
    WHERE v.id = NEW.component_bom_version_id AND v.business_id = NEW.business_id;
    IF v_child_bom_id IS NULL THEN
      RAISE EXCEPTION 'Sub-assembly version must belong to the same business'
        USING ERRCODE = '23514';
    END IF;

    WITH RECURSIVE subassembly_versions(version_id, bom_id, path) AS (
      SELECT v.id, v.bom_id, ARRAY[v.id]
      FROM public.bom_versions v
      WHERE v.id = NEW.component_bom_version_id AND v.business_id = NEW.business_id
      UNION ALL
      SELECT child.id, child.bom_id, graph.path || child.id
      FROM subassembly_versions graph
      JOIN public.bom_components c ON c.bom_version_id = graph.version_id
      JOIN public.bom_versions child ON child.id = c.component_bom_version_id
        AND child.business_id = NEW.business_id
      WHERE NOT child.id = ANY(graph.path)
    )
    SELECT EXISTS (
      SELECT 1 FROM subassembly_versions graph WHERE graph.bom_id = v_parent_bom_id
    ) INTO v_cycle_found;

    IF v_cycle_found THEN
      RAISE EXCEPTION 'BOM cycle detected: version % references itself through sub-assemblies', NEW.bom_version_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER bom_components_validate_integrity
  BEFORE INSERT OR UPDATE OR DELETE ON public.bom_components
  FOR EACH ROW EXECUTE FUNCTION public.validate_bom_component();

CREATE TRIGGER boms_set_updated_at
  BEFORE UPDATE ON public.boms
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
