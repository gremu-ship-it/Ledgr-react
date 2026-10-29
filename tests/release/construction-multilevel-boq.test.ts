import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities } from './fixtures';
import { evidenceSuite } from './evidence';

const test = evidenceSuite('construction-multilevel-boq');
const meta = (id: string, expected: string) => ({
  id: `BOQ.${id}`,
  expected,
  source: 'supabase/migrations/20261122000000_construction_multilevel_boq.sql',
  remediation: 'CONSTRUCTION-PHASE-5B-2B',
  layer: 'Disposable PostgreSQL 17 full migration replay; authenticated capability actor; synthetic tenant/project data',
});
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let businessId: string;
let foreignBusinessId: string;
let foreignOwnerId: string;
let projectId: string;
let ownerId: string;
let firstItemId: string;

beforeAll(async () => {
  db = await createDatabaseFixture();
  const orgs = await seedFixture(db.client);
  businessId = orgs.A.business;
  foreignBusinessId = orgs.B.business;
  ownerId = identities.A_owner.id;
  foreignOwnerId = identities.B_owner.id;
  await db.client.query(
    "update public.businesses set operating_models=array['CONSTRUCTION'],plan_tier='enterprise',plan_expires_at='2099-01-01' where id=$1",
    [businessId],
  );
  await db.commitAsRole('authenticated', ownerId,
    'select public.provision_construction_defaults($1,$2)', [businessId, ownerId]);
  const project = await db.client.query(`
    insert into public.construction_projects
      (business_id,name,client_name,contract_sum,retention_pct,budget,status,created_by)
    values($1,'Synthetic BOQ project','Synthetic client',1000,10,900,'active',$2) returning id
  `, [businessId, ownerId]);
  projectId = project.rows[0].id;
});

afterAll(async () => { await db?.cleanup(); });

test(meta('NESTED-TOTALS-AND-VALUATION-BRIDGE',
  'Draft BOQ items calculate amounts and version totals, three-level sections roll into the legacy valuation schedule, and activation archives the prior version'), async () => {
  const firstVersion = await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_versions(business_id,project_id,version_number,version_label,currency)
    values($1,$2,1,'Tender issue','MWK') returning id
  `, [businessId, projectId]);
  const version1 = firstVersion.rows[0].id as string;
  const root = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_sections(business_id,boq_version_id,code,title,sort_order)
    values($1,$2,'1','Substructure',0) returning id,level
  `, [businessId, version1])).rows[0];
  expect(root.level).toBe(0);
  const child = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_sections(business_id,boq_version_id,parent_section_id,code,title,sort_order)
    values($1,$2,$3,'1.1','Concrete works',0) returning id,level
  `, [businessId, version1, root.id])).rows[0];
  expect(child.level).toBe(1);
  const leaf = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_sections(business_id,boq_version_id,parent_section_id,code,title,sort_order)
    values($1,$2,$3,'1.1.1','Foundations',0) returning id,level
  `, [businessId, version1, child.id])).rows[0];
  expect(leaf.level).toBe(2);
  const first = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_items(business_id,boq_version_id,section_id,item_number,description,unit_of_measure,quantity,rate)
    values($1,$2,$3,'1.1.1.1','Excavate footings','m³',2.5,20.1234) returning id,amount
  `, [businessId, version1, leaf.id])).rows[0];
  expect(Number(first.amount)).toBe(50.31);
  firstItemId = first.id;
  await db.commitAsRole('authenticated', ownerId,
    'update public.boq_items set amount=999 where id=$1', [firstItemId]);
  expect(Number((await db.asRole('authenticated', ownerId,
    'select amount from public.boq_items where id=$1', [firstItemId])).rows[0].amount)).toBe(50.31);
  const allowance = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_items(business_id,boq_version_id,section_id,item_number,description,unit_of_measure,quantity,rate,is_provisional)
    values($1,$2,$3,'1.1.2','Provisional allowance','lot',1,10,true) returning id
  `, [businessId, version1, child.id])).rows[0];
  expect(Number((await db.asRole('authenticated', ownerId,
    'select total_value from public.boq_versions where id=$1', [version1])).rows[0].total_value)).toBe(60.31);

  await db.commitAsRole('authenticated', ownerId,
    "update public.boq_versions set status='active' where id=$1", [version1]);
  const mirrored1 = await db.asRole('authenticated', ownerId,
    'select id,line_number,total_value from public.project_boq_lines where project_id=$1 order by line_number', [projectId]);
  expect(mirrored1.rows.map((line: { id: string }) => line.id)).toEqual(expect.arrayContaining([firstItemId, allowance.id]));
  expect(mirrored1.rows).toHaveLength(2);

  const discardedDraft = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_versions(business_id,project_id,version_number,currency)
    values($1,$2,2,'MWK') returning id
  `, [businessId, projectId])).rows[0].id as string;
  const discardedRoot = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_sections(business_id,boq_version_id,code,title)
    values($1,$2,'D','Discarded section') returning id
  `, [businessId, discardedDraft])).rows[0].id as string;
  const discardedChild = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_sections(business_id,boq_version_id,parent_section_id,code,title)
    values($1,$2,$3,'D.1','Discarded subsection') returning id
  `, [businessId, discardedDraft, discardedRoot])).rows[0].id as string;
  await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_items(business_id,boq_version_id,section_id,item_number,description)
    values($1,$2,$3,'D.1.1','Discarded item')
  `, [businessId, discardedDraft, discardedChild]);
  await db.commitAsRole('authenticated', ownerId,
    'delete from public.boq_versions where id=$1', [discardedDraft]);
  const remainingDraft = await db.asRole('authenticated', ownerId,
    'select (select count(*) from public.boq_sections where boq_version_id=$1) sections, (select count(*) from public.boq_items where boq_version_id=$1) items', [discardedDraft]);
  expect(remainingDraft.rows[0]).toEqual({ sections: '0', items: '0' });

  const secondVersion = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_versions(business_id,project_id,version_number,version_label,currency)
    values($1,$2,2,'Issued for construction','MWK') returning id
  `, [businessId, projectId])).rows[0].id as string;
  const secondSection = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_sections(business_id,boq_version_id,code,title)
    values($1,$2,'2','Superstructure') returning id
  `, [businessId, secondVersion])).rows[0].id as string;
  const secondItem = await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_items(business_id,boq_version_id,section_id,item_number,description,unit_of_measure,quantity,rate)
    values($1,$2,$3,'2.1','Concrete frame','m³',2,25) returning id
  `, [businessId, secondVersion, secondSection]);
  await db.commitAsRole('authenticated', ownerId,
    "update public.boq_versions set status='active' where id=$1", [secondVersion]);
  const statuses = await db.asRole('authenticated', ownerId,
    'select id,status from public.boq_versions where project_id=$1 order by version_number', [projectId]);
  expect(statuses.rows.map((row: { status: string }) => row.status)).toEqual(['archived', 'active']);
  const mirrored2 = await db.asRole('authenticated', ownerId,
    'select id,line_number from public.project_boq_lines where project_id=$1', [projectId]);
  expect(mirrored2.rows).toEqual([{ id: secondItem.rows[0].id, line_number: '2.1' }]);
});

test(meta('TENANT-ISOLATION',
  'A user from another business cannot read this tenant’s BOQ versions'), async () => {
  const result = await db.asRole('authenticated', foreignOwnerId,
    'select id from public.boq_versions where business_id=$1', [businessId]);
  expect(result.rows).toHaveLength(0);
  expect(foreignBusinessId).not.toBe(businessId);
});

test(meta('VALUATION-LOCK',
  'The existing project BOQ lock freezes draft edits and prevents creating later drafts'), async () => {
  const draftVersion = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_versions(business_id,project_id,version_number,version_label,currency)
    values($1,$2,3,'Post-valuation draft','MWK') returning id
  `, [businessId, projectId])).rows[0].id as string;
  const sectionId = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_sections(business_id,boq_version_id,code,title)
    values($1,$2,'3','Later works') returning id
  `, [businessId, draftVersion])).rows[0].id as string;
  const draftItemId = (await db.commitAsRole('authenticated', ownerId, `
    insert into public.boq_items(business_id,boq_version_id,section_id,item_number,description,quantity,rate)
    values($1,$2,$3,'3.1','Later work item',1,5) returning id
  `, [businessId, draftVersion, sectionId])).rows[0].id as string;
  await db.client.query('update public.construction_projects set boq_locked_at=now() where id=$1', [projectId]);
  let itemError: { code?: string } | undefined;
  try {
    await db.commitAsRole('authenticated', ownerId,
      'update public.boq_items set rate=30 where id=$1', [draftItemId]);
  } catch (error) { itemError = error as typeof itemError; }
  expect(itemError?.code).toBe('55000');
  let versionError: { code?: string } | undefined;
  try {
    await db.commitAsRole('authenticated', ownerId, `
      insert into public.boq_versions(business_id,project_id,version_number,currency)
      values($1,$2,4,'MWK')
    `, [businessId, projectId]);
  } catch (error) { versionError = error as typeof versionError; }
  expect(versionError?.code).toBe('55000');
});
