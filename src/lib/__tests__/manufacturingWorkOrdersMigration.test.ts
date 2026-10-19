import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const TYPES_SQL = readFileSync(
  'supabase/migrations/20261105000000_stock_movement_type_manufacturing.sql',
  'utf8',
);
const SQL = readFileSync(
  'supabase/migrations/20261105000001_manufacturing_work_orders.sql',
  'utf8',
);
const BOM_SQL = readFileSync('supabase/migrations/20261104000000_manufacturing_bom.sql', 'utf8');

/**
 * The migration with `--` line comments removed, so an assertion about what the
 * SQL does is never satisfied (or defeated) by prose that merely describes it.
 * Dollar-quoted bodies contain no `--` comments, so this is safe here.
 */
const CODE_ONLY = SQL.replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map((line) => line.replace(/--[^$]*$/, ''))
  .join('\n');

/**
 * Static contract for Manufacturing Phase C — Work Orders & Production.
 *
 * These assertions guard the migration shape in the fast suite; the behaviour
 * they describe (constraints enforced, BOM frozen on release, backflush,
 * reversals, RLS) is proved against a real PostgreSQL 17 in
 * tests/release/manufacturing-work-orders.test.ts.
 */
describe('manufacturing work orders migration contract', () => {
  it('uses the next available timestamps after the Phase B BOM migration', () => {
    const files = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const versions = files.map((f) => f.split('_')[0]);
    const idxBom = versions.indexOf('20261104000000');
    const idxTypes = versions.indexOf('20261105000000');
    const idxWorkOrders = versions.indexOf('20261105000001');
    const idxDashboard = versions.indexOf('20261105000002');
    expect(idxBom).toBeGreaterThan(-1);
    expect(idxTypes).toBe(idxBom + 1);
    expect(idxWorkOrders).toBe(idxTypes + 1);
    expect(idxDashboard).toBe(idxWorkOrders + 1);
    expect(idxDashboard).toBe(versions.length - 1);
    for (const version of ['20261105000000', '20261105000001', '20261105000002']) {
      expect(versions.filter((v) => v === version)).toHaveLength(1);
    }
  });

  it('adds the three manufacturing movement types in their own committing migration', () => {
    // PostgreSQL refuses to USE an enum value in the same transaction that added
    // it, so the labels must commit before the migration that consumes them.
    expect(TYPES_SQL).toContain("alter type public.stock_movement_type add value if not exists 'manufacturing_issue'");
    expect(TYPES_SQL).toContain("alter type public.stock_movement_type add value if not exists 'manufacturing_return'");
    expect(TYPES_SQL).toContain("alter type public.stock_movement_type add value if not exists 'manufacturing_receipt'");
    expect(TYPES_SQL).not.toMatch(/create\s+table/i);
    expect(TYPES_SQL).not.toMatch(/create\s+or\s+replace\s+function/i);
  });

  describe('2a. Work orders header', () => {
    it('creates manufacturing_work_orders with the specified columns and constraints', () => {
      expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_work_orders');
      expect(SQL).toContain('business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE');
      expect(SQL).toContain('work_order_number text NOT NULL');
      expect(SQL).toContain('product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT');
      expect(SQL).toContain('bom_id uuid NOT NULL REFERENCES public.manufacturing_boms(id) ON DELETE RESTRICT');
      expect(SQL).toContain('manufacturing_wo_qty_positive CHECK (planned_quantity > 0)');
      expect(SQL).toContain('manufacturing_wo_completed_nonneg CHECK (completed_quantity >= 0)');
      expect(SQL).toContain('manufacturing_wo_scrapped_nonneg CHECK (scrapped_quantity >= 0)');
      expect(SQL).toContain("status text NOT NULL DEFAULT 'draft'");
      expect(SQL).toContain('manufacturing_wo_status_check');
      expect(SQL).toContain(
        "CHECK (status IN ('draft', 'released', 'in_progress', 'completed', 'closed', 'cancelled'))",
      );
      expect(SQL).toContain('from_location_id uuid REFERENCES public.inventory_locations(id)');
      expect(SQL).toContain('to_location_id uuid REFERENCES public.inventory_locations(id)');
      expect(SQL).toContain('created_by uuid NOT NULL REFERENCES auth.users(id)');
      expect(SQL).toContain('UNIQUE (business_id, work_order_number)');
    });
  });

  describe('2b. Frozen BOM lines', () => {
    it('creates manufacturing_work_order_lines with the specified constraints', () => {
      expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_work_order_lines');
      expect(SQL).toContain(
        'work_order_id uuid NOT NULL\n    REFERENCES public.manufacturing_work_orders(id) ON DELETE CASCADE',
      );
      expect(SQL).toContain(
        'component_product_id uuid NOT NULL\n    REFERENCES public.products(id) ON DELETE RESTRICT',
      );
      expect(SQL).toContain(
        'manufacturing_wo_line_qty_positive CHECK (planned_quantity > 0)',
      );
      expect(SQL).toContain(
        'manufacturing_wo_line_consumed_nonneg\n    CHECK (actual_quantity_consumed >= 0)',
      );
      expect(SQL).toContain('CHECK (scrap_pct >= 0 AND scrap_pct < 100)');
      expect(SQL).toContain('UNIQUE (work_order_id, component_product_id)');
    });
  });

  describe('2c. Production runs', () => {
    it('creates manufacturing_production_runs with the specified constraints', () => {
      expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_production_runs');
      expect(SQL).toContain('run_number integer NOT NULL');
      expect(SQL).toContain('manufacturing_run_output_positive CHECK (output_quantity > 0)');
      expect(SQL).toContain('manufacturing_run_scrap_nonneg CHECK (scrap_quantity >= 0)');
      expect(SQL).toContain(
        "CHECK (status IN ('in_progress', 'completed', 'cancelled'))",
      );
      expect(SQL).toContain('UNIQUE (work_order_id, run_number)');
    });
  });

  describe('2d. Material transactions', () => {
    it('creates manufacturing_material_transactions with the specified constraints', () => {
      expect(SQL).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_material_transactions');
      expect(SQL).toContain('manufacturing_mat_txn_qty_positive CHECK (quantity > 0)');
      expect(SQL).toContain(
        "CHECK (transaction_type IN ('consume', 'return', 'adjustment'))",
      );
      expect(SQL).toContain(
        'run_id uuid REFERENCES public.manufacturing_production_runs(id)\n    ON DELETE SET NULL',
      );
      expect(SQL).toContain('recorded_by uuid NOT NULL REFERENCES auth.users(id)');
    });
  });

  describe('2e. Indexes', () => {
    it('creates all eight indexes', () => {
      for (const [name, target] of [
        ['idx_mfg_wo_business', 'manufacturing_work_orders(business_id)'],
        ['idx_mfg_wo_product', 'manufacturing_work_orders(product_id)'],
        ['idx_mfg_wo_status', 'manufacturing_work_orders(status)'],
        ['idx_mfg_wo_lines_wo', 'manufacturing_work_order_lines(work_order_id)'],
        ['idx_mfg_runs_wo', 'manufacturing_production_runs(work_order_id)'],
        ['idx_mfg_mat_txn_wo', 'manufacturing_material_transactions(work_order_id)'],
        ['idx_mfg_mat_txn_run', 'manufacturing_material_transactions(run_id)'],
      ] as const) {
        expect(SQL).toContain(`CREATE INDEX IF NOT EXISTS ${name}`);
        expect(SQL).toContain(`ON public.${target}`);
      }
    });
  });

  describe('2f. RLS', () => {
    it('enables RLS on all four tables', () => {
      for (const table of [
        'manufacturing_work_orders',
        'manufacturing_work_order_lines',
        'manufacturing_production_runs',
        'manufacturing_material_transactions',
      ]) {
        expect(SQL).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      }
    });

    it('uses the Phase B business_members pattern verbatim in shape', () => {
      expect(SQL).toContain('manufacturing_work_orders_member_read');
      expect(SQL).toContain('manufacturing_work_orders_member_write');
      expect(SQL).toContain('business_id IN (');
      expect(SQL).toContain('SELECT business_id FROM public.business_members');
      expect(SQL).toContain('WHERE user_id = auth.uid()');
      expect(SQL).toContain("role IN ('owner', 'admin', 'manager')");
      // Construction's actor key is never reused in manufacturing.
      expect(SQL).not.toContain('_ledgr_construction_actor');
    });

    it('reaches the business through work_order_id on the three child tables', () => {
      expect(SQL).toContain('manufacturing_work_order_lines_member_read');
      expect(SQL).toContain('manufacturing_work_order_lines_member_write');
      expect(SQL).toContain('manufacturing_production_runs_member_read');
      expect(SQL).toContain('manufacturing_production_runs_member_write');
      expect(SQL).toContain('manufacturing_material_transactions_member_read');
      expect(SQL).toContain('manufacturing_material_transactions_member_write');
      // Three child tables × (USING + WITH CHECK on write, USING on read) = 9
      // traversals of work_order_id, plus the header's 'business_id IN (' policies.
      expect(SQL.split('work_order_id IN (').length - 1).toBe(9);
      expect(SQL).toContain('SELECT id FROM public.manufacturing_work_orders');
    });
  });

  describe('2g. Grants', () => {
    it('revokes public/anon and grants authenticated on all four tables', () => {
      expect(SQL).toContain(
        'REVOKE ALL ON public.manufacturing_work_orders,\n  public.manufacturing_work_order_lines,\n  public.manufacturing_production_runs,\n  public.manufacturing_material_transactions\n  FROM PUBLIC, anon;',
      );
      expect(SQL).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON');
      expect(SQL).toContain('TO authenticated');
    });
  });

  describe('2h. Updated_at trigger', () => {
    it('reuses set_updated_at and applies it to the header only', () => {
      expect(SQL).toContain('set_updated_at');
      expect(SQL).toContain('trg_manufacturing_work_orders_updated_at');
      expect(SQL).toContain('BEFORE UPDATE ON public.manufacturing_work_orders');
      // Per spec: the header only.
      expect(SQL).not.toContain('BEFORE UPDATE ON public.manufacturing_work_order_lines');
      expect(SQL).not.toContain('BEFORE UPDATE ON public.manufacturing_production_runs');
      expect(SQL).not.toContain('BEFORE UPDATE ON public.manufacturing_material_transactions');
    });
  });

  describe('2i. Work order numbering', () => {
    it('generates WO-YYYY-NNN per business, serialised and year-scoped', () => {
      expect(SQL).toContain("'WO-' || to_char(now(), 'YYYY') || '-'");
      expect(SQL).toContain("lpad((v_max + 1)::text, 3, '0')");
      expect(SQL).toContain("regexp_replace(work_order_number, '^WO-[0-9]{4}-', '')");
      expect(SQL).toContain('AND work_order_number LIKE ');
      expect(SQL).toContain('pg_advisory_xact_lock');
    });
  });

  describe('2j. Commands', () => {
    it('creates every work order command with the specified signature', () => {
      expect(SQL).toContain(
        'CREATE OR REPLACE FUNCTION public.manufacturing_wo_create(\n  p_business_id      uuid,\n  p_product_id       uuid,\n  p_planned_qty      numeric,\n  p_planned_start    date,\n  p_planned_end      date,\n  p_from_location_id uuid,\n  p_to_location_id   uuid,\n  p_notes            text\n)',
      );
      expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_wo_release(p_work_order_id uuid)');
      expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_wo_start(p_work_order_id uuid)');
      expect(SQL).toContain('public.manufacturing_wo_record_run(\n  p_work_order_id uuid,\n  p_output_qty    numeric,\n  p_scrap_qty     numeric,\n  p_notes         text\n)');
      expect(SQL).toContain('public.manufacturing_wo_record_consumption(\n  p_work_order_id   uuid,\n  p_run_id          uuid,\n  p_component_id    uuid,\n  p_quantity        numeric,\n  p_from_location_id uuid,\n  p_notes           text\n)');
      expect(SQL).toContain('public.manufacturing_wo_record_return(\n  p_work_order_id uuid,\n  p_run_id        uuid,\n  p_component_id  uuid,\n  p_quantity      numeric,\n  p_to_location_id uuid,\n  p_notes         text\n)');
      expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_wo_complete(p_work_order_id uuid)');
      expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_wo_close(p_work_order_id uuid)');
      expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_wo_cancel(p_work_order_id uuid)');
      expect(SQL).toContain('CREATE OR REPLACE FUNCTION public.manufacturing_wo_yield(p_work_order_id uuid)');
    });

    it('freezes the BOM on release with scrap-inflated quantities', () => {
      expect(SQL).toContain('SET bom_locked_at = now()');
      expect(SQL).toContain(
        'round(bl.quantity * (1 + bl.scrap_pct / 100) * v_wo.planned_quantity, 6)',
      );
      expect(SQL).toContain("SET status = 'released'");
    });

    it('applies the 10% overproduction tolerance', () => {
      expect(SQL).toContain('v_wo.completed_quantity + p_output_qty > v_wo.planned_quantity * 1.10');
      expect(SQL).toContain('manufacturing-overproduction');
    });

    it('backflushes proportionally to output', () => {
      expect(SQL).toContain(
        'v_consume := round((p_output_qty / v_wo.planned_quantity) * v_line.planned_quantity, 6)',
      );
    });

    it('performs one implicit backflush when completing with no runs', () => {
      expect(SQL).toContain("'implicit batch'");
      expect(SQL).toContain('SET completed_quantity = planned_quantity');
    });

    it('unlocks the BOM on cancel only when no other live order references it', () => {
      expect(SQL).toContain('SET bom_locked_at = NULL, updated_at = now()');
      expect(SQL).toContain("AND w.status NOT IN ('cancelled', 'closed')");
    });

    it('revokes anon from every command', () => {
      for (const command of [
        'manufacturing_wo_create',
        'manufacturing_wo_release',
        'manufacturing_wo_start',
        'manufacturing_wo_record_run',
        'manufacturing_wo_record_consumption',
        'manufacturing_wo_record_return',
        'manufacturing_wo_complete',
        'manufacturing_wo_close',
        'manufacturing_wo_cancel',
        'manufacturing_wo_yield',
      ]) {
        expect(SQL).toContain(`REVOKE ALL ON FUNCTION public.${command}`);
        expect(SQL).toContain(`GRANT EXECUTE ON FUNCTION public.${command}`);
      }
    });
  });

  describe('integration with the existing inventory and ledger', () => {
    it('moves stock through public.stock_movements, not a parallel table', () => {
      expect(SQL).toContain('INSERT INTO public.stock_movements');
      expect(SQL).toContain("'manufacturing_work_order'");
      // No second balance writer and no direct balance write.
      expect(SQL).not.toMatch(/insert\s+into\s+public\.inventory_balances/i);
      expect(SQL).not.toMatch(/update\s+public\.inventory_balances/i);
      expect(SQL).not.toContain('create trigger');
    });

    it('posts through the existing journal mechanism', () => {
      expect(SQL).toContain('public._ledgr_post_entry_keyed(');
      expect(SQL).not.toMatch(/insert\s+into\s+public\.journal_entries/i);
      expect(SQL).not.toMatch(/insert\s+into\s+public\.journal_lines/i);
    });

    it('routes WIP through the Phase A account and materials/finished goods through the stock accounts', () => {
      expect(SQL).toContain("lower(btrim(a.name)) = 'wip inventory'");
      expect(SQL).toContain("'1143', '1141'"); // Raw Materials, fallback Trading Stock
      expect(SQL).toContain("'1142', '1141'"); // Finished Goods, fallback Trading Stock
    });

    it('values material cost from purchase_price only', () => {
      expect(SQL).toContain('v_unit := COALESCE(v_line.purchase_price, 0)');
      expect(CODE_ONLY).not.toMatch(/labour|labor|overhead/i);
    });
  });

  describe('scope guards', () => {
    it('does not touch construction tables or the product_type CHECK', () => {
      expect(SQL).not.toMatch(/alter\s+table\s+public\.construction/i);
      expect(SQL).not.toMatch(/create\s+table.*public\.construction/i);
      expect(SQL).not.toContain('products_product_type_check');
    });

    it('does not add a new capability code', () => {
      expect(SQL).not.toMatch(/manufacturing\.[a-z_]+\.manage\s*'/);
      expect(SQL).not.toContain('manufacturing_capability_grants');
    });

    it('does not flip the capability org layer kill switch', () => {
      expect(SQL).not.toContain('capability_org_layer');
    });

    it('does not mutate the Phase B BOM tables beyond bom_locked_at', () => {
      // bom_locked_at is written by release and by cancel — and nowhere else.
      const writes = SQL.split('manufacturing_boms').length - 1;
      expect(writes).toBeGreaterThan(0);
      expect(SQL).not.toMatch(/alter\s+table\s+public\.manufacturing_bom/i);
      expect(SQL).not.toMatch(/drop\s+table\s+public\.manufacturing_bom/i);
      expect(SQL).toContain("SET bom_locked_at = now()");
    });
  });

  it('includes self-verification', () => {
    expect(SQL).toContain('Manufacturing work orders not applied correctly');
    expect(SQL).toContain('has_function_privilege');
  });

  it('leaves the Phase B BOM migration untouched', () => {
    // Phase C adds files; it does not rewrite Phase B.
    expect(BOM_SQL).toContain('CREATE TABLE IF NOT EXISTS public.manufacturing_boms');
    expect(BOM_SQL).toContain('bom_locked_at timestamptz');
  });
});
