-- Migration: 20261227000000_manufacturing_costing_engine.sql
-- Description: Manufacturing Cost Sheets and Pricing Simulation

CREATE TABLE IF NOT EXISTS public.manufacturing_cost_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  bom_id uuid,
  material_cost_unit numeric(15, 4) NOT NULL DEFAULT 0,
  labor_cost_unit numeric(15, 4) NOT NULL DEFAULT 0,
  overhead_cost_unit numeric(15, 4) NOT NULL DEFAULT 0,
  total_unit_cost numeric(15, 4) NOT NULL DEFAULT 0,
  pricing_strategy text NOT NULL DEFAULT 'margin', -- 'margin' | 'markup'
  target_margin_pct numeric(8, 2) NOT NULL DEFAULT 35.00,
  target_markup_pct numeric(8, 2) NOT NULL DEFAULT 50.00,
  recommended_price numeric(15, 2) NOT NULL DEFAULT 0,
  current_catalog_price numeric(15, 2) NOT NULL DEFAULT 0,
  cost_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_pricing_strategy CHECK (pricing_strategy IN ('margin', 'markup'))
);

CREATE INDEX IF NOT EXISTS idx_mfg_cost_sheets_business_product
  ON public.manufacturing_cost_sheets(business_id, product_id);

ALTER TABLE public.manufacturing_cost_sheets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mfg_cost_sheets_select" ON public.manufacturing_cost_sheets;
DROP POLICY IF EXISTS "mfg_cost_sheets_insert" ON public.manufacturing_cost_sheets;
DROP POLICY IF EXISTS "mfg_cost_sheets_update" ON public.manufacturing_cost_sheets;
DROP POLICY IF EXISTS "mfg_cost_sheets_delete" ON public.manufacturing_cost_sheets;

CREATE POLICY "mfg_cost_sheets_select" ON public.manufacturing_cost_sheets
  FOR SELECT TO authenticated
  USING (public.can_read_financial_data(business_id));

CREATE POLICY "mfg_cost_sheets_insert" ON public.manufacturing_cost_sheets
  FOR INSERT TO authenticated
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY "mfg_cost_sheets_update" ON public.manufacturing_cost_sheets
  FOR UPDATE TO authenticated
  USING (public.can_write_financial_data(business_id))
  WITH CHECK (public.can_write_financial_data(business_id));

CREATE POLICY "mfg_cost_sheets_delete" ON public.manufacturing_cost_sheets
  FOR DELETE TO authenticated
  USING (public.can_write_financial_data(business_id));

-- ----------------------------------------------------------------------------
-- Catalog/POS selling price compatibility: the pricing engine writes the
-- canonical `unit_price`, while existing POS/catalog screens read `sale_price`.
-- Keep both columns in step so a simulated price is visible everywhere.
-- ----------------------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_price numeric(15, 2);
UPDATE public.products SET unit_price = sale_price WHERE unit_price IS NULL;

CREATE OR REPLACE FUNCTION public.products_sale_unit_price_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.unit_price IS NULL THEN
      NEW.unit_price := NEW.sale_price;
    ELSIF NEW.sale_price = 0 THEN
      NEW.sale_price := NEW.unit_price;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.unit_price IS DISTINCT FROM OLD.unit_price AND NEW.sale_price = OLD.sale_price THEN
      NEW.sale_price := NEW.unit_price;
    ELSIF NEW.sale_price IS DISTINCT FROM OLD.sale_price AND NEW.unit_price = OLD.unit_price THEN
      NEW.unit_price := NEW.sale_price;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_sale_unit_price_sync ON public.products;
CREATE TRIGGER trg_products_sale_unit_price_sync
  BEFORE INSERT OR UPDATE OF sale_price, unit_price ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_sale_unit_price_sync();

-- Cost sheets are financial data: never reachable by anonymous clients.
REVOKE ALL ON public.manufacturing_cost_sheets FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_cost_sheets TO authenticated;
