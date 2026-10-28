/** Database-boundary tests for the versioned, multi-level BOM contract. */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { identities, seedFixture } from './fixtures';
import type { BomComponentDraft } from '../../src/dal/repositories/BomRepository';
import { Blocked, evidenceSuite, safeError } from './evidence';

const test = evidenceSuite('r13-manufacturing-bom');
const migration = 'supabase/migrations/20261120000000_manufacturing_bom_schema.sql';
const OBS = 'Isolated PostgreSQL 17 full migration replay; synthetic tenant identities and products; authenticated-owner RPC calls; no customer data.';
const meta = (id: string, expected: string) => ({ id, expected, remediation: 'Phase 5B-1b', source: migration, layer: OBS });

let db: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let orgs: Awaited<ReturnType<typeof seedFixture>> | undefined;
let replayError = '';
let seedError = '';

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

function productComponent(productId: string, quantity = 2) {
  return {
    component_product_id: productId,
    component_bom_version_id: null,
    quantity,
    unit_of_measure: 'kg',
    scrap_percentage: 0,
    sort_order: 0,
    notes: null,
  };
}

function subassemblyComponent(versionId: string, quantity = 1) {
  return {
    component_product_id: null,
    component_bom_version_id: versionId,
    quantity,
    unit_of_measure: 'ea',
    scrap_percentage: 0,
    sort_order: 0,
    notes: null,
  };
}

async function saveVersion(
  businessId: string,
  bomId: string | null,
  code: string,
  name: string,
  productId: string,
  components: BomComponentDraft[],
  userId = identities.A_owner.id,
) {
  const result = await db!.commitAsRole(
    'authenticated', userId,
    'select public.save_bom_version($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid,$6::text,$7::jsonb) as id',
    [businessId, bomId, code, name, productId, 'release-test', JSON.stringify(components)],
  );
  return result.rows[0].id as string;
}

async function activateVersion(businessId: string, versionId: string, userId = identities.A_owner.id) {
  return db!.commitAsRole(
    'authenticated', userId,
    'select (public.activate_bom_version($1::uuid,$2::uuid)).*',
    [businessId, versionId],
  );
}

async function captureError(run: () => Promise<unknown>) {
  try { await run(); }
  catch (error) { return error as { code?: string; message?: string }; }
  throw new Error('Expected database operation to be rejected');
}

test(meta(
  'R13.BOM.MULTI-LEVEL',
  'A valid Assembly → Sub-assembly → Component chain is saved, with each quantity scoped to one output unit of its parent.',
), async () => {
  ready();
  const businessId = orgs!.A.business;
  const productId = orgs!.A.product;
  const componentVersionId = await saveVersion(businessId, null, 'R13-COMP', 'Release Component BOM', productId, [productComponent(productId, 3)]);
  const componentBomId = (await db!.client.query('select bom_id from public.bom_versions where id=$1', [componentVersionId])).rows[0].bom_id as string;
  const subassemblyVersionId = await saveVersion(businessId, null, 'R13-SUB', 'Release Sub-assembly BOM', productId, [subassemblyComponent(componentVersionId, 2)]);
  const assemblyVersionId = await saveVersion(businessId, null, 'R13-ASM', 'Release Assembly BOM', productId, [subassemblyComponent(subassemblyVersionId, 4)]);

  const result = await db!.client.query(
    `select root.code as assembly_code, root_component.quantity as assembly_quantity,
            child.code as subassembly_code, child_component.quantity as subassembly_quantity,
            leaf_component.quantity as leaf_quantity
       from public.bom_versions root_version
       join public.boms root on root.id=root_version.bom_id
       join public.bom_components root_component on root_component.bom_version_id=root_version.id
       join public.bom_versions sub_version on sub_version.id=root_component.component_bom_version_id
       join public.boms child on child.id=sub_version.bom_id
       join public.bom_components child_component on child_component.bom_version_id=sub_version.id
       join public.bom_components leaf_component on leaf_component.bom_version_id=child_component.component_bom_version_id
      where root_version.id=$1 and root_version.business_id=$2`,
    [assemblyVersionId, businessId],
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    assembly_code: 'R13-ASM', assembly_quantity: '4',
    subassembly_code: 'R13-SUB', subassembly_quantity: '2', leaf_quantity: '3',
  });
  expect(componentBomId).toBeTruthy();
});

test(meta(
  'R13.BOM.CYCLE-REJECTED',
  'A new version that closes a transitive BOM loop is rejected by the database with SQLSTATE 23514.',
), async () => {
  ready();
  const businessId = orgs!.A.business;
  const productId = orgs!.A.product;
  const cVersion = await saveVersion(businessId, null, 'R13-CYCLE-C', 'Cycle C', productId, [productComponent(productId)]);
  const cBomId = (await db!.client.query('select bom_id from public.bom_versions where id=$1', [cVersion])).rows[0].bom_id as string;
  const bVersion = await saveVersion(businessId, null, 'R13-CYCLE-B', 'Cycle B', productId, [subassemblyComponent(cVersion)]);
  const aVersion = await saveVersion(businessId, null, 'R13-CYCLE-A', 'Cycle A', productId, [subassemblyComponent(bVersion)]);
  const error = await captureError(() => saveVersion(
    businessId, cBomId, 'R13-CYCLE-C', 'Cycle C', productId, [subassemblyComponent(aVersion)],
  ));
  expect(error.code).toBe('23514');
  expect(error.message).toMatch(/BOM cycle detected/);
  const revisions = await db!.client.query('select count(*)::int as count from public.bom_versions where bom_id=$1', [cBomId]);
  expect(revisions.rows[0].count).toBe(1);
});

test(meta(
  'R13.BOM.ACTIVATION-ARCHIVES',
  'Activating a second draft archives the prior active revision and leaves exactly one active version.',
), async () => {
  ready();
  const businessId = orgs!.A.business;
  const productId = orgs!.A.product;
  const firstVersion = await saveVersion(businessId, null, 'R13-ACT', 'Activation BOM', productId, [productComponent(productId)]);
  const bomId = (await db!.client.query('select bom_id from public.bom_versions where id=$1', [firstVersion])).rows[0].bom_id as string;
  await activateVersion(businessId, firstVersion);
  const secondVersion = await saveVersion(businessId, bomId, 'R13-ACT', 'Activation BOM', productId, [productComponent(productId, 5)]);
  await activateVersion(businessId, secondVersion);
  const rows = await db!.client.query(
    'select id,status,effective_from,effective_to from public.bom_versions where bom_id=$1 order by version_number',
    [bomId],
  );
  expect(rows.rows).toHaveLength(2);
  expect(rows.rows[0]).toMatchObject({ id: firstVersion, status: 'archived' });
  expect(rows.rows[0].effective_to).toBeTruthy();
  expect(rows.rows[1]).toMatchObject({ id: secondVersion, status: 'active' });
  expect(rows.rows[1].effective_from).toBeTruthy();
});

test(meta(
  'R13.BOM.TENANT-BOUNDARY',
  'Only an active business member can save BOMs for that tenant; cross-business output products are rejected.',
), async () => {
  ready();
  const businessA = orgs!.A.business;
  const businessB = orgs!.B.business;
  const memberError = await captureError(() => saveVersion(
    businessB, null, 'R13-NOT-MEMBER', 'Not a member', orgs!.B.product,
    [productComponent(orgs!.B.product)], identities.A_owner.id,
  ));
  expect(memberError.code).toBe('42501');
  const productError = await captureError(() => saveVersion(
    businessA, null, 'R13-CROSS-PRODUCT', 'Cross tenant output', orgs!.B.product,
    [productComponent(orgs!.A.product)], identities.A_owner.id,
  ));
  expect(productError.code).toBe('23514');
  const visible = await db!.asRole('authenticated', identities.A_owner.id,
    'select count(*)::int as count from public.boms where business_id=$1', [businessB]);
  expect(visible.rows[0].count).toBe(0);
});
