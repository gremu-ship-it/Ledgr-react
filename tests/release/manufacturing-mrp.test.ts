/** Database-boundary tests for MRP explosion, netting and explicit conversion. */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { identities, seedFixture } from './fixtures';
import { Blocked, evidenceSuite, safeError } from './evidence';

const test = evidenceSuite('r13-manufacturing-mrp');
const migration = 'supabase/migrations/20261124000000_manufacturing_mrp.sql';
const layer = 'Isolated PostgreSQL 17 full migration replay; synthetic tenant identities/products; authenticated-owner RPC calls; no customer data.';
const meta = (id: string, expected: string) => ({ id, expected, remediation: 'Phase 5B-3a', source: migration, layer });

type QueryClient = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

let db: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let orgs: Awaited<ReturnType<typeof seedFixture>> | undefined;
let businessId = '';
let rawLocationId = '';
let setupError = '';
let sku = 0;

const ownerId = identities.A_owner.id;

async function scalar(sql: string, values: unknown[] = []) {
  const result = await db!.client.query(sql, values);
  return Object.values(result.rows[0] ?? {})[0];
}

async function commitScalar(sql: string, values: unknown[] = []) {
  const result = await db!.commitAsRole('authenticated', ownerId, sql, values);
  return Object.values(result.rows[0] ?? {})[0];
}

async function newProduct(name: string, type: string) {
  return scalar(
    `insert into public.products
      (business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code)
     values($1,$2,$3,0,10,'MWK',$4,true,'none','none') returning id`,
    [businessId, `R13 MRP ${name}`, `R13-MRP-${++sku}`, type],
  ) as Promise<string>;
}

async function createBom(productId: string, component: { productId?: string; bomId?: string; quantity: number }) {
  const bomId = await commitScalar(
    `insert into public.manufacturing_boms(business_id,product_id,version,status,created_by)
     values($1,$2,1,'draft',$3) returning id`,
    [businessId, productId, ownerId],
  ) as string;
  await db!.client.query(
    `insert into public.manufacturing_bom_lines
       (bom_id,component_product_id,component_bom_id,quantity,unit_of_measure,scrap_pct)
     values($1,$2,$3,$4,'ea',0)`,
    [bomId, component.productId ?? null, component.bomId ?? null, component.quantity],
  );
  await commitScalar('select public.manufacturing_bom_activate($1::uuid)', [bomId]);
  return bomId;
}

beforeAll(async () => {
  try {
    db = await createDatabaseFixture();
    orgs = await seedFixture(db.client);
    businessId = await commitScalar(
      `select public.create_business_with_owner(
         'R13 MRP Co','R13',null,null,null,false,'MWK','07-01','UTC',
         null,null,'Malawi',null,null,null,'INV','EXP','PAY','FOR_PROFIT',array['MANUFACTURING']) as id`,
    ) as string;
    await commitScalar('select public.provision_manufacturing_defaults($1,$2)', [businessId, ownerId]);
    const result = await db!.client.query(
      `select id from public.inventory_locations
       where business_id=$1 and location_type='raw_materials_store' limit 1`,
      [businessId],
    );
    rawLocationId = result.rows[0]?.id as string;
  } catch (error) {
    setupError = safeError(error);
    await db?.cleanup();
    db = undefined;
  }
});

afterAll(async () => { await db?.cleanup(); });

function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${setupError}`);
  if (!orgs || !businessId || !rawLocationId) throw new Blocked(`Synthetic fixture setup unavailable: ${setupError}`);
}

test(meta(
  'R13.MRP.NETTED-MULTI-LEVEL',
  'Demand for 10 assemblies with per-unit BOM quantities 2 and 3, plus stock of 2 assemblies, 4 subassemblies and 10 components, nets to make 8, make 12 and buy 26 on the same required date.',
), async () => {
  ready();
  const assembly = await newProduct('Assembly', 'finished_good');
  const subassembly = await newProduct('Subassembly', 'wip');
  const component = await newProduct('Component', 'raw_material');
  const subassemblyBom = await createBom(subassembly, { productId: component, quantity: 3 });
  await createBom(assembly, { bomId: subassemblyBom, quantity: 2 });

  for (const [productId, quantity] of [[assembly, 2], [subassembly, 4], [component, 10]] as const) {
    await db!.client.query(
      `insert into public.inventory_balances
         (business_id,product_id,location_id,quantity_on_hand,quantity_reserved,average_cost)
       values($1,$2,$3,$4,0,10)`,
      [businessId, productId, rawLocationId, quantity],
    );
  }

  const horizon = String(await scalar('select current_date::text'));
  const runId = await commitScalar(
    'select public.run_mrp($1::uuid,$2::date,$3::date,$4::jsonb) as id',
    [businessId, horizon, horizon, JSON.stringify([{ product_id: assembly, quantity: 10, required_date: horizon }])],
  ) as string;

  const rows: Array<Record<string, unknown>> = await db!.asRole('authenticated', ownerId, async (client: QueryClient) => {
    const result = await client.query(
      `select product_id,recommendation_type,gross_requirement,on_hand_quantity,
              net_requirement,required_date::text as required_date
         from public.manufacturing_mrp_recommendations
        where run_id=$1`,
      [runId],
    );
    return result.rows;
  });
  expect(rows).toHaveLength(3);
  const byProduct = new Map(rows.map((row) => [row.product_id, row]));
  expect(byProduct.get(assembly)).toMatchObject({ recommendation_type: 'make', gross_requirement: '10.000000', on_hand_quantity: '2.000000', net_requirement: '8.000000', required_date: horizon });
  expect(byProduct.get(subassembly)).toMatchObject({ recommendation_type: 'make', gross_requirement: '16.000000', on_hand_quantity: '4.000000', net_requirement: '12.000000', required_date: horizon });
  expect(byProduct.get(component)).toMatchObject({ recommendation_type: 'buy', gross_requirement: '36.000000', on_hand_quantity: '10.000000', net_requirement: '26.000000', required_date: horizon });

  const workOrdersBefore = await scalar('select count(*)::int from public.manufacturing_work_orders where business_id=$1', [businessId]);
  expect(workOrdersBefore).toBe(0);

  const workOrderId = await commitScalar(
    `select public.convert_mrp_recommendation(id) as id
       from public.manufacturing_mrp_recommendations
      where run_id=$1 and product_id=$2`,
    [runId, assembly],
  ) as string;
  const converted = await db!.client.query(
    `select wo.status,wo.planned_quantity,rec.status as recommendation_status,
            rec.converted_work_order_id
       from public.manufacturing_work_orders wo
       join public.manufacturing_mrp_recommendations rec
         on rec.converted_work_order_id=wo.id
      where wo.id=$1`,
    [workOrderId],
  );
  expect(converted.rows[0]).toMatchObject({
    status: 'draft',
    planned_quantity: '8.000000',
    recommendation_status: 'converted',
    converted_work_order_id: workOrderId,
  });
});
