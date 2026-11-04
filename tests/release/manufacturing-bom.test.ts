/** Database-boundary tests for versioned multi-level manufacturing BOMs. */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { identities, seedFixture } from './fixtures';
import type { BomComponentDraft } from '../../src/dal/repositories/BomRepository';
import { Blocked, evidenceSuite, safeError } from './evidence';

const test = evidenceSuite('r13-manufacturing-bom');
const migration = 'supabase/migrations/20261120000000_manufacturing_bom_schema.sql';
const commands = 'supabase/migrations/20261120000001_manufacturing_bom_rpcs.sql';
const OBS = 'Isolated PostgreSQL 17 full migration replay; synthetic tenant identities and products; authenticated-owner RPC calls; no customer data.';
const meta = (id: string, expected: string, source = commands) => ({ id, expected, remediation: 'Phase 5B-1b', source, layer: OBS });

let db: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let orgs: Awaited<ReturnType<typeof seedFixture>> | undefined;
let replayError = '';
let seedError = '';
let skuCounter = 0;

beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (error) { replayError = String((error as Error).message).startsWith('Migration ') ? (error as Error).message : safeError(error); return; }
  try { orgs = await seedFixture(db.client); }
  catch (error) { seedError = safeError(error); }
});
afterAll(async () => { if (db) await db.cleanup(); });

function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}

async function newProduct(businessId: string, name: string, productType = 'finished_good') {
  const result = await db!.client.query(
    `insert into public.products
      (business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code)
     values($1,$2,$3,0,10,'MWK',$4,true,'none','none') returning id`,
    [businessId, `R13 BOM ${name}`, `R13-BOM-${++skuCounter}`, productType],
  );
  return result.rows[0].id as string;
}

function productComponent(productId: string, quantity = 2): BomComponentDraft {
  return {
    component_product_id: productId,
    component_bom_id: null,
    quantity,
    unit_of_measure: 'ea',
    scrap_pct: 0,
    notes: null,
  };
}

function subassemblyComponent(bomId: string, quantity = 1): BomComponentDraft {
  return {
    component_product_id: null,
    component_bom_id: bomId,
    quantity,
    unit_of_measure: 'ea',
    scrap_pct: 0,
    notes: null,
  };
}

async function saveVersion(
  businessId: string,
  bomId: string | null,
  productId: string,
  components: BomComponentDraft[],
  userId = identities.A_owner.id,
) {
  const result = await db!.commitAsRole(
    'authenticated', userId,
    'select public.save_bom_version($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb) as id',
    [businessId, bomId, productId, null, JSON.stringify(components)],
  );
  return result.rows[0].id as string;
}

type ReleaseQueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

async function activateVersion(versionId: string, userId = identities.A_owner.id) {
  return db!.commitAsRole('authenticated', userId, async (client: ReleaseQueryClient) => {
    await client.query('select public.manufacturing_bom_activate($1::uuid)', [versionId]);
    return client.query('select id,status from public.manufacturing_boms where id=$1', [versionId]);
  });
}

async function captureError(run: () => Promise<unknown>) {
  try { await run(); }
  catch (error) { return error as { code?: string; message?: string }; }
  throw new Error('Expected database operation to be rejected');
}

test(meta(
  'R13.BOM.MULTI-LEVEL',
  'Assembly → Sub-assembly → Component persists as version-specific links, with quantities per one parent output unit.',
  migration,
), async () => {
  ready();
  const businessId = orgs!.A.business;
  const rawProductId = orgs!.A.product;
  const componentOutputId = await newProduct(businessId, 'Component', 'wip');
  const subassemblyOutputId = await newProduct(businessId, 'Sub-assembly', 'wip');
  const assemblyOutputId = await newProduct(businessId, 'Assembly');

  const componentBomId = await saveVersion(businessId, null, componentOutputId, [productComponent(rawProductId, 3)]);
  const subassemblyBomId = await saveVersion(businessId, null, subassemblyOutputId, [subassemblyComponent(componentBomId, 2)]);
  const assemblyBomId = await saveVersion(businessId, null, assemblyOutputId, [subassemblyComponent(subassemblyBomId, 4)]);

  const result = await db!.client.query(
    `select root.product_id as assembly_product_id, root.version as assembly_version,
            outer_line.quantity as assembly_quantity, child.product_id as subassembly_product_id,
            child_line.quantity as subassembly_quantity, leaf.product_id as component_product_id,
            leaf_line.quantity as leaf_quantity
       from public.manufacturing_boms root
       join public.manufacturing_bom_lines outer_line on outer_line.bom_id=root.id
       join public.manufacturing_boms child on child.id=outer_line.component_bom_id
       join public.manufacturing_bom_lines child_line on child_line.bom_id=child.id
       join public.manufacturing_boms leaf on leaf.id=child_line.component_bom_id
       join public.manufacturing_bom_lines leaf_line on leaf_line.bom_id=leaf.id
      where root.id=$1 and leaf_line.component_product_id=$2`,
    [assemblyBomId, rawProductId],
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    assembly_product_id: assemblyOutputId,
    assembly_version: 1,
    assembly_quantity: '4',
    subassembly_product_id: subassemblyOutputId,
    subassembly_quantity: '2',
    component_product_id: componentOutputId,
    leaf_quantity: '3',
  });
});

test(meta(
  'R13.BOM.CYCLE-REJECTED',
  'A transitive loop across BOM products/versions is rejected with SQLSTATE 23514 and leaves the draft unchanged.',
), async () => {
  ready();
  const businessId = orgs!.A.business;
  const rawProductId = orgs!.A.product;
  const productA = await newProduct(businessId, 'Cycle A', 'wip');
  const productB = await newProduct(businessId, 'Cycle B', 'wip');
  const productC = await newProduct(businessId, 'Cycle C', 'wip');
  const bomC = await saveVersion(businessId, null, productC, [productComponent(rawProductId)]);
  const bomB = await saveVersion(businessId, null, productB, [subassemblyComponent(bomC)]);
  const bomA = await saveVersion(businessId, null, productA, [subassemblyComponent(bomB)]);

  const error = await captureError(() => saveVersion(
    businessId, bomC, productC, [subassemblyComponent(bomA)],
  ));
  expect(error.code).toBe('23514');
  expect(error.message).toMatch(/BOM cycle detected/i);
  const lines = await db!.client.query('select count(*)::int as count from public.manufacturing_bom_lines where bom_id=$1', [bomC]);
  expect(lines.rows[0].count).toBe(1);
});

test(meta(
  'R13.BOM.ACTIVATION-ARCHIVES',
  'Activating a new draft archives the former active revision only after save and returns the activated row.',
), async () => {
  ready();
  const businessId = orgs!.A.business;
  const productId = await newProduct(businessId, 'Activation output');
  const rawProductId = orgs!.A.product;
  const first = await saveVersion(businessId, null, productId, [productComponent(rawProductId)]);
  await activateVersion(first);

  const second = await saveVersion(businessId, first, productId, [productComponent(rawProductId, 5)]);
  const beforeActivation = await db!.client.query(
    "select id,status from public.manufacturing_boms where business_id=$1 and product_id=$2 order by version",
    [businessId, productId],
  );
  expect(beforeActivation.rows).toMatchObject([{ id: first, status: 'active' }, { id: second, status: 'draft' }]);

  const activated = await activateVersion(second);
  expect(activated.rows[0]).toMatchObject({ id: second, status: 'active' });
  const versions = await db!.client.query(
    'select id,status from public.manufacturing_boms where business_id=$1 and product_id=$2 order by version',
    [businessId, productId],
  );
  expect(versions.rows).toMatchObject([{ id: first, status: 'archived' }, { id: second, status: 'active' }]);
});

test(meta(
  'R13.BOM.TENANT-BOUNDARY',
  'Only an active business member with a write role can save BOMs for that tenant, and cross-business output products are rejected.',
), async () => {
  ready();
  const businessA = orgs!.A.business;
  const businessB = orgs!.B.business;
  const productA = await newProduct(businessA, 'Tenant A output');
  const memberError = await captureError(() => saveVersion(
    businessB, null, orgs!.B.product, [productComponent(orgs!.B.product)], identities.A_owner.id,
  ));
  expect(memberError.code).toBe('42501');
  const productError = await captureError(() => saveVersion(
    businessA, null, orgs!.B.product, [productComponent(productA)], identities.A_owner.id,
  ));
  expect(productError.code).toBe('23514');
  const visible = await db!.asRole('authenticated', identities.A_owner.id,
    'select count(*)::int as count from public.manufacturing_boms where business_id=$1', [businessB]);
  expect(visible.rows[0].count).toBe(0);
});
