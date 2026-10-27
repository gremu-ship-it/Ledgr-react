-- ============================================================================
-- Ledgr demo-data seed — construction + manufacturing + double-entry accounting
-- ----------------------------------------------------------------------------
-- Target business is supplied by the caller in the `ledgr.business_id` setting:
--   select set_config('ledgr.business_id', '<business-uuid>', false);
--
-- Idempotent by design: every insert is guarded by a natural key (name,
-- project, BOM version, posting_key, stock-movement reference) and no existing
-- row is ever deleted or updated. Safe to run repeatedly.
--
-- Schema note: this script targets the repository's real schema (accounts /
-- journal_lines / sale_price / unit_of_measure / project_valuations), not the
-- illustrative names in the brief. See DEMO_SEED_REPORT.md for the mapping.
-- ============================================================================

DO $seed$
DECLARE
  v_business_id uuid := nullif(current_setting('ledgr.business_id', true), '')::uuid;
  v_owner_id    uuid;
  v_owner_role  text;
  v_models      text[];
  v_branch_site uuid;
  v_branch_factory uuid;
  v_loc_site    uuid;
  v_loc_raw     uuid;
  v_loc_fg      uuid;
  v_ap          uuid;
  v_ar          uuid;
  v_retention   uuid;
  v_revenue_contract uuid;
  v_revenue_mfg uuid;
  v_cogs        uuid;
  v_stock_construction uuid;
  v_stock_raw   uuid;
  v_stock_fg    uuid;
  v_wip         uuid;
  v_currency    text;
  v_product_id  uuid;
  v_bom_id      uuid;
  v_wo_id       uuid;
  v_status      text;
  v_run_count   integer;
  v_amount      numeric;
  v_qty         numeric;
  v_unit_cost   numeric;
  v_ref         text;
  v_key         text;
  v_project_id  uuid;
  v_valuation_id uuid;
  v_gross       numeric;
  v_retention_amt numeric;
  v_net         numeric;
  v_previous    numeric;
  v_notes       text;
  v_bom_cost    numeric;
  r             record;
BEGIN
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Set ledgr.business_id before running the seed.';
  END IF;

  SELECT b.base_currency, b.operating_models
    INTO v_currency, v_models
    FROM public.businesses b
   WHERE b.id = v_business_id AND b.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Business % not found.', v_business_id;
  END IF;
  v_currency := COALESCE(v_currency, 'MWK');

  SELECT bu.user_id, bu.role::text
    INTO v_owner_id, v_owner_role
    FROM public.business_users bu
   WHERE bu.business_id = v_business_id AND bu.is_active
     AND bu.role::text IN ('owner','admin')
   ORDER BY CASE bu.role::text WHEN 'owner' THEN 0 ELSE 1 END, bu.created_at
   LIMIT 1;
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Business % has no active owner/admin to attribute demo data to.', v_business_id;
  END IF;

  -- auth.uid() is read by every manufacturing RPC. Local transaction scope only.
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- ── Provisioning (idempotent; no-ops when already present) ────────────────
  IF 'CONSTRUCTION' = ANY (v_models) THEN
    PERFORM public.provision_construction_defaults(v_business_id, v_owner_id);
    PERFORM public.provision_construction_coa_accounts(v_business_id);
  END IF;
  IF 'MANUFACTURING' = ANY (v_models) THEN
    PERFORM public.provision_manufacturing_defaults(v_business_id, v_owner_id);
    PERFORM public.provision_manufacturing_coa_accounts(v_business_id);
  END IF;

  -- ── Resolve accounts and locations ───────────────────────────────────────
  SELECT id INTO v_ap FROM public.accounts WHERE business_id = v_business_id AND code = '2111' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_ar FROM public.accounts WHERE business_id = v_business_id AND code = '1131' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_retention FROM public.accounts WHERE business_id = v_business_id AND lower(btrim(name)) = 'retention receivable' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_revenue_contract FROM public.accounts WHERE business_id = v_business_id AND code = '4114' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_revenue_mfg FROM public.accounts WHERE business_id = v_business_id AND code = '4113' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_cogs FROM public.accounts WHERE business_id = v_business_id AND code = '5100' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_stock_construction FROM public.accounts WHERE business_id = v_business_id AND code = '1141' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_stock_raw FROM public.accounts WHERE business_id = v_business_id AND code = '1143' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_stock_fg FROM public.accounts WHERE business_id = v_business_id AND code = '1142' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_wip FROM public.accounts WHERE business_id = v_business_id AND lower(btrim(name)) = 'wip inventory' AND deleted_at IS NULL LIMIT 1;

  IF v_ap IS NULL OR v_ar IS NULL OR v_cogs IS NULL THEN
    RAISE EXCEPTION 'Core chart of accounts is incomplete for business % (need 2111, 1131, 5100).', v_business_id;
  END IF;
  IF 'CONSTRUCTION' = ANY (v_models)
     AND (v_stock_construction IS NULL OR v_revenue_contract IS NULL) THEN
    RAISE EXCEPTION 'Construction chart of accounts is incomplete for business % (need 1141, 4114).', v_business_id;
  END IF;
  IF 'MANUFACTURING' = ANY (v_models)
     AND (v_stock_raw IS NULL OR v_stock_fg IS NULL OR v_wip IS NULL OR v_revenue_mfg IS NULL) THEN
    RAISE EXCEPTION 'Manufacturing chart of accounts is incomplete for business % (need 1142, 1143, 1200, 4113).', v_business_id;
  END IF;

  SELECT l.id, l.branch_id INTO v_loc_site, v_branch_site
    FROM public.inventory_locations l
   WHERE l.business_id = v_business_id AND l.location_type = 'warehouse'
   ORDER BY l.is_default DESC, l.created_at LIMIT 1;
  SELECT l.id, l.branch_id INTO v_loc_raw, v_branch_factory
    FROM public.inventory_locations l
   WHERE l.business_id = v_business_id AND l.location_type = 'raw_materials_store'
   ORDER BY l.created_at LIMIT 1;
  SELECT l.id INTO v_loc_fg
    FROM public.inventory_locations l
   WHERE l.business_id = v_business_id AND l.location_type = 'finished_goods_store'
   ORDER BY l.created_at LIMIT 1;

  IF 'CONSTRUCTION' = ANY (v_models) AND v_loc_site IS NULL THEN
    RAISE EXCEPTION 'Construction requires a warehouse/site location.';
  END IF;
  IF 'MANUFACTURING' = ANY (v_models) AND (v_loc_raw IS NULL OR v_loc_fg IS NULL) THEN
    RAISE EXCEPTION 'Manufacturing requires a raw_materials_store and a finished_goods_store location.';
  END IF;

  -- ==========================================================================
  -- 2a + 3a. PRODUCTS
  -- ==========================================================================
  CREATE TEMP TABLE _demo_products (
    name text PRIMARY KEY, model text, product_type text, purchase_price numeric,
    sale_price numeric, uom text, inv_code text, sales_code text
  ) ON COMMIT DROP;

  INSERT INTO _demo_products VALUES
    -- Construction materials (2a)
    ('Portland Cement 50kg','CONSTRUCTION','product',8500,10000,'Bag','1141','4110'),
    ('River Sand','CONSTRUCTION','product',25000,35000,'m³','1141','4110'),
    ('Crushed Stone 19mm','CONSTRUCTION','product',35000,45000,'m³','1141','4110'),
    ('Steel Rebar Y12','CONSTRUCTION','product',12000,15000,'Length','1141','4110'),
    ('Bricks (Burnt)','CONSTRUCTION','product',120,180,'Piece','1141','4110'),
    ('Timber 50x150mm','CONSTRUCTION','product',4500,6000,'Length','1141','4110'),
    ('Roofing Sheets IBR','CONSTRUCTION','product',5500,7500,'Sheet','1141','4110'),
    ('Plumbing Kit (Standard)','CONSTRUCTION','product',85000,120000,'Set','1141','4110'),
    ('Electrical Wire 2.5mm','CONSTRUCTION','product',45000,60000,'Roll','1141','4110'),
    ('Paint (Emulsion 20L)','CONSTRUCTION','product',65000,85000,'Bucket','1141','4110'),
    -- Manufacturing raw materials (3a)
    ('Cement (Bulk per ton)','MANUFACTURING','raw_material',170000,0,'Ton','1143','4113'),
    ('Fine Sand','MANUFACTURING','raw_material',25000,0,'m³','1143','4113'),
    ('Coarse Aggregate','MANUFACTURING','raw_material',35000,0,'m³','1143','4113'),
    ('Water (per 1000L)','MANUFACTURING','raw_material',5000,0,'kL','1143','4113'),
    ('Steel Fibre','MANUFACTURING','raw_material',450000,0,'Ton','1143','4113'),
    ('Pigment (Red Oxide)','MANUFACTURING','raw_material',85000,0,'Kg','1143','4113'),
    -- Finished goods (3a) — standard cost mirrors the BOM material cost
    ('Concrete Block (Hollow 200mm)','MANUFACTURING','finished_good',431.48,850,'Piece','1142','4113'),
    ('Concrete Block (Solid 150mm)','MANUFACTURING','finished_good',383.86,650,'Piece','1142','4113'),
    ('Paving Brick (Interlock)','MANUFACTURING','finished_good',333.83,450,'Piece','1142','4113'),
    ('Kerb Stone','MANUFACTURING','finished_good',523.84,3500,'Piece','1142','4113');

  INSERT INTO public.products (
    business_id, name, product_type, purchase_price, sale_price, cost_price,
    unit_of_measure, currency, purchase_tax_code, sales_tax_code,
    track_inventory, is_active, inventory_account_id, purchase_account_id,
    sales_account_id, cogs_account_id
  )
  SELECT v_business_id, d.name, d.product_type, d.purchase_price, d.sale_price,
         d.purchase_price, d.uom, v_currency::public.currency_code,
         'none'::public.tax_code, 'none'::public.tax_code,
         true, true,
         (SELECT a.id FROM public.accounts a WHERE a.business_id = v_business_id AND a.code = d.inv_code AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1),
         (SELECT a.id FROM public.accounts a WHERE a.business_id = v_business_id AND a.code = d.inv_code AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1),
         (SELECT a.id FROM public.accounts a WHERE a.business_id = v_business_id AND a.code = d.sales_code AND a.deleted_at IS NULL ORDER BY a.created_at LIMIT 1),
         v_cogs
    FROM _demo_products d
   WHERE ((d.model = 'CONSTRUCTION' AND 'CONSTRUCTION' = ANY (v_models))
       OR (d.model = 'MANUFACTURING' AND 'MANUFACTURING' = ANY (v_models)))
     AND NOT EXISTS (
     SELECT 1 FROM public.products p
      WHERE p.business_id = v_business_id AND p.name = d.name AND p.deleted_at IS NULL
   );

  -- ==========================================================================
  -- 2b. CONSTRUCTION PROJECTS
  -- ==========================================================================
  IF 'CONSTRUCTION' = ANY (v_models) THEN
    INSERT INTO public.construction_projects
      (business_id, name, client_name, contract_sum, retention_pct, budget,
       status, start_date, end_date, created_by)
    SELECT v_business_id, x.name, x.client_name, x.contract_sum, x.retention_pct,
           x.budget, 'active', x.start_date, x.end_date, v_owner_id
      FROM (VALUES
        ('Hospital Building','Ministry of Health',260000000.00,10.00,180000000.00,'2026-11-01'::date,'2027-09-30'::date),
        ('School Block Renovation','Lilongwe City Council',45000000.00,5.00,32000000.00,'2026-12-01'::date,'2027-04-30'::date)
      ) AS x(name, client_name, contract_sum, retention_pct, budget, start_date, end_date)
     WHERE NOT EXISTS (
       SELECT 1 FROM public.construction_projects p
        WHERE p.business_id = v_business_id AND p.name = x.name
     );

    -- ========================================================================
    -- 2c. CONSTRUCTION MATERIAL RECEIPTS (100 units each into the site store)
    -- ========================================================================
    FOR r IN
      SELECT d.name, 100::numeric AS qty, '2026-11-01'::date AS movement_date,
             'CONST-' || upper(replace(replace(replace(replace(d.name, ' ', '-'), '(', ''), ')', ''), '&', '')) AS slug
        FROM _demo_products d
       WHERE d.product_type = 'product'
       ORDER BY d.name
    LOOP
      SELECT p.id INTO v_product_id FROM public.products p
       WHERE p.business_id = v_business_id AND p.name = r.name AND p.deleted_at IS NULL LIMIT 1;
      v_amount := r.qty * (SELECT purchase_price FROM public.products WHERE id = v_product_id);
      v_ref := 'DEMO-SEED-RECEIPT-' || r.slug;

      IF NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.business_id = v_business_id AND sm.reference = v_ref) THEN
        INSERT INTO public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, total_cost, source_type, source_id, reference,
          created_by, notes
        ) VALUES (
          v_business_id, v_product_id, v_loc_site, 'purchase', r.movement_date,
          r.qty, v_amount / r.qty, v_amount, 'demo_seed', v_product_id::text, v_ref,
          v_owner_id::text, 'Demo seed — construction material received'
        );
      END IF;

      PERFORM public._ledgr_post_entry_keyed(
        v_business_id,
        'PURCHASE-' || v_product_id::text || '-' || to_char(r.movement_date, 'YYYY-MM-DD'),
        r.movement_date,
        'Demo seed — purchase ' || r.name || ' (' || r.qty || ' ' || (SELECT unit_of_measure FROM public.products WHERE id = v_product_id) || ')',
        'purchase_receipt', v_product_id::text, v_currency, 1, v_branch_site, NULL,
        jsonb_build_array(
          jsonb_build_object('account_id', v_stock_construction, 'description', 'Inventory received — ' || r.name,
            'is_debit', true, 'amount', v_amount, 'amount_base', v_amount, 'tax_code', 'none', 'tax_amount', 0),
          jsonb_build_object('account_id', v_ap, 'description', 'Supplier payable — ' || r.name,
            'is_debit', false, 'amount', v_amount, 'amount_base', v_amount, 'tax_code', 'none', 'tax_amount', 0)
        )
      );
    END LOOP;
  END IF;

  -- ==========================================================================
  -- 3b. MANUFACTURING RAW MATERIAL RECEIPTS
  -- ==========================================================================
  IF 'MANUFACTURING' = ANY (v_models) THEN
  FOR r IN
    SELECT * FROM (VALUES
      ('Cement (Bulk per ton)',10::numeric,'2026-11-05'::date),
      ('Fine Sand',20::numeric,'2026-11-05'::date),
      ('Coarse Aggregate',15::numeric,'2026-11-05'::date),
      ('Water (per 1000L)',5::numeric,'2026-11-05'::date),
      ('Steel Fibre',2::numeric,'2026-11-05'::date),
      ('Pigment (Red Oxide)',50::numeric,'2026-11-06'::date)
    ) AS x(name, qty, movement_date)
  LOOP
    SELECT p.id INTO v_product_id FROM public.products p
     WHERE p.business_id = v_business_id AND p.name = r.name AND p.deleted_at IS NULL LIMIT 1;
    v_amount := r.qty * (SELECT purchase_price FROM public.products WHERE id = v_product_id);
    v_ref := 'DEMO-SEED-RECEIPT-MFG-' || upper(replace(replace(replace(replace(r.name, ' ', '-'), '(', ''), ')', ''), '&', ''));

    IF NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.business_id = v_business_id AND sm.reference = v_ref) THEN
      INSERT INTO public.stock_movements (
        business_id, product_id, location_id, movement_type, movement_date,
        quantity, unit_cost, total_cost, source_type, source_id, reference,
        created_by, notes
      ) VALUES (
        v_business_id, v_product_id, v_loc_raw, 'purchase', r.movement_date,
        r.qty, v_amount / r.qty, v_amount, 'demo_seed', v_product_id::text, v_ref,
        v_owner_id::text, 'Demo seed — raw material received'
      );
    END IF;

    PERFORM public._ledgr_post_entry_keyed(
      v_business_id,
      'PURCHASE-' || v_product_id::text || '-' || to_char(r.movement_date, 'YYYY-MM-DD'),
      r.movement_date,
      'Demo seed — purchase ' || r.name || ' (' || r.qty || ' ' || (SELECT unit_of_measure FROM public.products WHERE id = v_product_id) || ')',
      'purchase_receipt', v_product_id::text, v_currency, 1, v_branch_factory, NULL,
      jsonb_build_array(
        jsonb_build_object('account_id', v_stock_raw, 'description', 'Raw materials received — ' || r.name,
          'is_debit', true, 'amount', v_amount, 'amount_base', v_amount, 'tax_code', 'none', 'tax_amount', 0),
        jsonb_build_object('account_id', v_ap, 'description', 'Supplier payable — ' || r.name,
          'is_debit', false, 'amount', v_amount, 'amount_base', v_amount, 'tax_code', 'none', 'tax_amount', 0)
      )
    );
  END LOOP;
  END IF;

  -- ==========================================================================
  -- 3c. BILLS OF MATERIALS (per ONE output unit, as this schema expects)
  -- ==========================================================================
  IF 'MANUFACTURING' = ANY (v_models) THEN
    CREATE TEMP TABLE _demo_bom_lines (
      output text, component text, qty numeric, scrap numeric
    ) ON COMMIT DROP;

    INSERT INTO _demo_bom_lines VALUES
      ('Concrete Block (Hollow 200mm)','Cement (Bulk per ton)',0.0015,2),
      ('Concrete Block (Hollow 200mm)','Fine Sand',0.0030,5),
      ('Concrete Block (Hollow 200mm)','Coarse Aggregate',0.0025,3),
      ('Concrete Block (Hollow 200mm)','Water (per 1000L)',0.0005,0),
      ('Paving Brick (Interlock)','Cement (Bulk per ton)',0.0012,2),
      ('Paving Brick (Interlock)','Fine Sand',0.0020,5),
      ('Paving Brick (Interlock)','Coarse Aggregate',0.0015,3),
      ('Paving Brick (Interlock)','Pigment (Red Oxide)',0.0002,1),
      ('Paving Brick (Interlock)','Water (per 1000L)',0.0004,0),
      ('Concrete Block (Solid 150mm)','Cement (Bulk per ton)',0.0012,2),
      ('Concrete Block (Solid 150mm)','Fine Sand',0.0025,5),
      ('Concrete Block (Solid 150mm)','Coarse Aggregate',0.0030,3),
      ('Concrete Block (Solid 150mm)','Water (per 1000L)',0.0004,0),
      ('Kerb Stone','Cement (Bulk per ton)',0.0018,2),
      ('Kerb Stone','Fine Sand',0.0030,5),
      ('Kerb Stone','Coarse Aggregate',0.0035,3),
      ('Kerb Stone','Water (per 1000L)',0.0005,0),
      ('Kerb Stone','Pigment (Red Oxide)',0.00005,1);

    FOR r IN SELECT DISTINCT output FROM _demo_bom_lines ORDER BY output LOOP
      SELECT p.id INTO v_product_id FROM public.products p
       WHERE p.business_id = v_business_id AND p.name = r.output AND p.deleted_at IS NULL LIMIT 1;

      SELECT b.id INTO v_bom_id FROM public.manufacturing_boms b
       WHERE b.business_id = v_business_id AND b.product_id = v_product_id AND b.version = 1 LIMIT 1;

      IF v_bom_id IS NULL THEN
        INSERT INTO public.manufacturing_boms (business_id, product_id, version, status, notes, created_by)
        VALUES (v_business_id, v_product_id, 1, 'draft', 'Demo seed BOM — quantities per one finished unit', v_owner_id)
        RETURNING id INTO v_bom_id;
      END IF;

      INSERT INTO public.manufacturing_bom_lines (bom_id, component_product_id, quantity, unit_of_measure, scrap_pct)
      SELECT v_bom_id, p.id, l.qty, p.unit_of_measure, l.scrap
        FROM _demo_bom_lines l
        JOIN public.products p ON p.business_id = v_business_id AND p.name = l.component AND p.deleted_at IS NULL
       WHERE l.output = r.output
      ON CONFLICT (bom_id, component_product_id) DO NOTHING;

      SELECT status INTO v_status FROM public.manufacturing_boms WHERE id = v_bom_id;
      IF v_status = 'draft' THEN
        PERFORM public.manufacturing_bom_activate(v_bom_id);
      END IF;
    END LOOP;
  END IF;

  -- ==========================================================================
  -- 3e. WORK ORDERS — full lifecycle through the production RPCs
  -- ==========================================================================
  IF 'MANUFACTURING' = ANY (v_models) THEN
    CREATE TEMP TABLE _demo_wos (
      seq int PRIMARY KEY, marker text, output text, planned numeric,
      planned_start date, planned_end date
    ) ON COMMIT DROP;

    INSERT INTO _demo_wos VALUES
      (1,'DEMO-SEED-WO-1','Concrete Block (Hollow 200mm)',5000,'2026-11-10','2026-11-14'),
      (2,'DEMO-SEED-WO-2','Paving Brick (Interlock)',2000,'2026-11-17','2026-11-21'),
      (3,'DEMO-SEED-WO-3','Concrete Block (Hollow 200mm)',500,'2026-12-01','2026-12-03');

    FOR r IN SELECT * FROM _demo_wos ORDER BY seq LOOP
      SELECT p.id INTO v_product_id FROM public.products p
       WHERE p.business_id = v_business_id AND p.name = r.output AND p.deleted_at IS NULL LIMIT 1;

      SELECT wo.id, wo.status INTO v_wo_id, v_status
        FROM public.manufacturing_work_orders wo
       WHERE wo.business_id = v_business_id AND wo.notes LIKE r.marker || '%'
       ORDER BY wo.created_at LIMIT 1;

      IF v_wo_id IS NULL THEN
        v_wo_id := public.manufacturing_wo_create(
          v_business_id, v_product_id, r.planned, r.planned_start, r.planned_end,
          NULL, NULL, r.marker || ' — demo seed');
        SELECT status INTO v_status FROM public.manufacturing_work_orders WHERE id = v_wo_id;
      END IF;

      IF r.seq = 1 THEN
        IF v_status = 'draft' THEN
          PERFORM public.manufacturing_wo_release(v_wo_id);
          v_status := 'released';
        END IF;
        IF v_status = 'released' THEN
          PERFORM public.manufacturing_wo_start(v_wo_id);
          v_status := 'in_progress';
        END IF;
        IF v_status IN ('released','in_progress') THEN
          SELECT count(*) INTO v_run_count FROM public.manufacturing_production_runs WHERE work_order_id = v_wo_id;
          IF v_run_count < 1 THEN
            PERFORM public.manufacturing_wo_record_run(v_wo_id, 2500, 50, r.marker || ' run 1');
            v_run_count := v_run_count + 1;
          END IF;
          IF v_run_count < 2 THEN
            PERFORM public.manufacturing_wo_record_run(v_wo_id, 2400, 80, r.marker || ' run 2');
          END IF;
          SELECT status INTO v_status FROM public.manufacturing_work_orders WHERE id = v_wo_id;
          IF v_status = 'in_progress' THEN
            PERFORM public.manufacturing_wo_complete(v_wo_id);
          END IF;
        END IF;

      ELSIF r.seq = 2 THEN
        IF v_status = 'draft' THEN
          PERFORM public.manufacturing_wo_release(v_wo_id);
          v_status := 'released';
        END IF;
        IF v_status = 'released' THEN
          PERFORM public.manufacturing_wo_start(v_wo_id);
          v_status := 'in_progress';
        END IF;
        IF v_status IN ('released','in_progress') THEN
          SELECT count(*) INTO v_run_count FROM public.manufacturing_production_runs WHERE work_order_id = v_wo_id;
          IF v_run_count < 1 THEN
            PERFORM public.manufacturing_wo_record_run(v_wo_id, 1000, 25, r.marker || ' run 1');
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM public.manufacturing_material_transactions mt
             WHERE mt.work_order_id = v_wo_id AND mt.notes LIKE 'Mix correction%'
          ) THEN
            SELECT p.id INTO v_product_id FROM public.products p
             WHERE p.business_id = v_business_id AND p.name = 'Cement (Bulk per ton)' AND p.deleted_at IS NULL LIMIT 1;
            PERFORM public.manufacturing_wo_record_consumption(
              v_wo_id, NULL, v_product_id, 0.05, NULL,
              'Mix correction — additional cement for strength');
          END IF;
        END IF;
        -- Deliberately left in_progress: more runs to come.
      END IF;
      -- r.seq = 3 stays draft.
    END LOOP;
  END IF;

  -- ==========================================================================
  -- 2d. CONSTRUCTION PROGRESS VALUATIONS (period amounts; cumulative tracked)
  -- ==========================================================================
  IF 'CONSTRUCTION' = ANY (v_models) THEN
    SELECT p.id INTO v_project_id FROM public.construction_projects p
     WHERE p.business_id = v_business_id AND p.name = 'Hospital Building' LIMIT 1;

    IF v_project_id IS NOT NULL THEN
      FOR r IN
        SELECT * FROM (VALUES
          (1, 26000000.00::numeric, 2600000.00::numeric, 0.00::numeric, '2026-11-30'::date),
          (2, 26000000.00::numeric, 2600000.00::numeric, 26000000.00::numeric, '2026-12-31'::date)
        ) AS x(num, gross, retention, previous, valuation_date)
      LOOP
        SELECT v.id, v.notes INTO v_valuation_id, v_notes FROM public.project_valuations v
         WHERE v.project_id = v_project_id AND v.valuation_number = r.num LIMIT 1;

        IF v_valuation_id IS NULL THEN
          INSERT INTO public.project_valuations (
            project_id, valuation_number, valuation_date, period_start, period_end,
            gross_amount, retention_amount, net_amount, previous_cumulative,
            status, notes, created_by
          ) VALUES (
            v_project_id, r.num, r.valuation_date,
            (r.valuation_date - INTERVAL '1 month')::date, r.valuation_date,
            r.gross, r.retention, r.gross - r.retention, r.previous,
            'submitted', 'Demo seed — certification-ready progress valuation', v_owner_id
          ) RETURNING id INTO v_valuation_id;
          v_notes := 'Demo seed — certification-ready progress valuation';
        END IF;

        SELECT v.gross_amount, v.retention_amount, v.net_amount, v.previous_cumulative
          INTO v_gross, v_retention_amt, v_net, v_previous
          FROM public.project_valuations v WHERE v.id = v_valuation_id;

        -- Never create a second ledger entry for a valuation that was not
        -- created by this seed. A pre-existing live valuation may already be
        -- invoiced/posted elsewhere; the posting key cannot tell us that.
        IF v_notes IS NULL OR v_notes NOT LIKE 'Demo seed%' THEN
          CONTINUE;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM public.project_retention_ledger l WHERE l.valuation_id = v_valuation_id
        ) THEN
          INSERT INTO public.project_retention_ledger (project_id, valuation_id, type, amount, description, created_by)
          VALUES (v_project_id, v_valuation_id, 'withheld', v_retention_amt,
                  'Demo seed — retention withheld on valuation V-' || lpad(r.num::text, 3, '0'), v_owner_id);
        END IF;

        PERFORM public._ledgr_post_entry_keyed(
          v_business_id,
          'DEMO-VALUATION-' || v_project_id::text || '-' || r.num,
          r.valuation_date,
          'Demo seed — progress valuation V-' || lpad(r.num::text, 3, '0') || ' certified',
          'construction_valuation', v_project_id::text, v_currency, 1, v_branch_site, NULL,
          jsonb_build_array(
            jsonb_build_object('account_id', v_ar, 'description', 'Receivable — valuation V-' || lpad(r.num::text, 3, '0'),
              'is_debit', true, 'amount', v_net, 'amount_base', v_net, 'tax_code', 'none', 'tax_amount', 0),
            jsonb_build_object('account_id', v_retention, 'description', 'Retention withheld — valuation V-' || lpad(r.num::text, 3, '0'),
              'is_debit', true, 'amount', v_retention_amt, 'amount_base', v_retention_amt, 'tax_code', 'none', 'tax_amount', 0),
            jsonb_build_object('account_id', v_revenue_contract, 'description', 'Contract revenue — valuation V-' || lpad(r.num::text, 3, '0'),
              'is_debit', false, 'amount', v_gross, 'amount_base', v_gross, 'tax_code', 'none', 'tax_amount', 0)
          )
        );
      END LOOP;
    END IF;
  END IF;

  -- ==========================================================================
  -- 4e. FINISHED-GOOD SALES (stock + revenue + COGS)
  -- ==========================================================================
  IF 'MANUFACTURING' = ANY (v_models) THEN
    SELECT p.id INTO v_product_id FROM public.products p
     WHERE p.business_id = v_business_id AND p.name = 'Concrete Block (Hollow 200mm)' AND p.deleted_at IS NULL LIMIT 1;
    SELECT b.id INTO v_bom_id FROM public.manufacturing_boms b
     WHERE b.business_id = v_business_id AND b.product_id = v_product_id AND b.status = 'active'
     ORDER BY b.version DESC LIMIT 1;
    v_bom_cost := public.manufacturing_bom_cost(v_bom_id);

    FOR r IN
      SELECT * FROM (VALUES
        (1, 500::numeric, '2026-12-05'::date, 'Kamuzu Hardware'),
        (2, 300::numeric, '2026-12-12'::date, 'Area 47 Builders'),
        (3, 200::numeric, '2026-12-18'::date, 'Mzuzu Trade Centre')
      ) AS x(num, qty, sale_date, customer)
    LOOP
      v_amount := r.qty * 850; -- selling_price of the hollow block
      v_unit_cost := round(v_bom_cost, 6);
      v_ref := 'DEMO-SEED-SALE-' || r.num;

      IF NOT EXISTS (SELECT 1 FROM public.stock_movements sm WHERE sm.business_id = v_business_id AND sm.reference = v_ref) THEN
        INSERT INTO public.stock_movements (
          business_id, product_id, location_id, movement_type, movement_date,
          quantity, unit_cost, total_cost, source_type, source_id, reference,
          created_by, notes
        ) VALUES (
          v_business_id, v_product_id, v_loc_fg, 'sale', r.sale_date,
          -r.qty, v_unit_cost, -round(r.qty * v_unit_cost, 2), 'demo_seed',
          v_product_id::text, v_ref, v_owner_id::text,
          'Demo seed — sale to ' || r.customer
        );
      END IF;

      PERFORM public._ledgr_post_entry_keyed(
        v_business_id, 'DEMO-SALE-' || r.num || '-REVENUE', r.sale_date,
        'Demo seed — sale of ' || r.qty || ' hollow blocks to ' || r.customer,
        'sale', NULL, v_currency, 1, v_branch_factory, NULL,
        jsonb_build_array(
          jsonb_build_object('account_id', v_ar, 'description', 'Receivable — ' || r.customer,
            'is_debit', true, 'amount', v_amount, 'amount_base', v_amount, 'tax_code', 'none', 'tax_amount', 0),
          jsonb_build_object('account_id', v_revenue_mfg, 'description', 'Manufacturing revenue — ' || r.customer,
            'is_debit', false, 'amount', v_amount, 'amount_base', v_amount, 'tax_code', 'none', 'tax_amount', 0)
        )
      );

      PERFORM public._ledgr_post_entry_keyed(
        v_business_id, 'DEMO-SALE-' || r.num || '-COGS', r.sale_date,
        'Demo seed — cost of goods sold, ' || r.qty || ' hollow blocks',
        'sale', NULL, v_currency, 1, v_branch_factory, NULL,
        jsonb_build_array(
          jsonb_build_object('account_id', v_cogs, 'description', 'COGS — hollow blocks',
            'is_debit', true, 'amount', round(r.qty * v_unit_cost, 2), 'amount_base', round(r.qty * v_unit_cost, 2), 'tax_code', 'none', 'tax_amount', 0),
          jsonb_build_object('account_id', v_stock_fg, 'description', 'Finished goods issued — hollow blocks',
            'is_debit', false, 'amount', round(r.qty * v_unit_cost, 2), 'amount_base', round(r.qty * v_unit_cost, 2), 'tax_code', 'none', 'tax_amount', 0)
        )
      );
    END LOOP;
  END IF;

  RAISE NOTICE 'Demo seed complete for business %', v_business_id;
END
$seed$;
