/** P4C approval workflows — disposable PostgreSQL release evidence. */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { evidenceSuite, Blocked, safeError } from './evidence';
import { identities, seedFixture, DAY } from './fixtures';

const test = evidenceSuite('approval-workflows');
const MS = 'supabase/migrations/20261110000002_p4c_approval_workflows.sql';
const meta = (id: string, expected: string) => ({
  id: `APPROVAL.${id}`,
  expected,
  source: MS,
  remediation: 'P4C-APPROVAL-WORKFLOWS',
  layer: 'Disposable PostgreSQL 17; full migration replay; synthetic users and documents; authenticated JWT claims',
});

let db: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let setupError = '';
let cashAccount = '';
let equityAccount = '';
let supplier = '';
let product = '';
let site = '';
let poCounter = 0;
let entryCounter = 0;

const roleSql = async (uid: string, sql: string, values: unknown[] = []) =>
  db!.commitAsRole('authenticated', uid, sql, values);

async function setup() {
  db = await createDatabaseFixture();
  orgs = await seedFixture(db.client);
  await db.client.query("update public.businesses set plan_tier='enterprise', plan_expires_at='2099-01-01' where id=$1", [orgs.A.business]);

  const insertAccount = async (code: string, name: string, type: string, parentId: string | null, isGroup: boolean) => {
    const result = await db!.client.query(
      `insert into public.accounts(
         business_id, code, name, account_type, normal_balance, currency,
         opening_balance, is_bank_account, is_group, is_system, parent_id
       ) values($1,$2,$3,$4,$5,'MWK',0,false,$6,true,$7) returning id`,
      [orgs.A.business, code, name, type, type === 'equity' ? 'credit' : 'debit', isGroup, parentId],
    );
    return result.rows[0].id as string;
  };
  const assets = await insertAccount('9850', 'Approval test assets', 'asset', null, true);
  cashAccount = await insertAccount('9851', 'Approval test cash', 'asset', assets, false);
  equityAccount = await insertAccount('9852', 'Approval test equity', 'equity', null, false);

  supplier = (await db.client.query(
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'Approval test supplier','supplier',true,false) returning id",
    [orgs.A.business],
  )).rows[0].id;
  product = (await db.client.query(
    "insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure) values($1,'Approval test item','R13-APPROVAL-ITEM',100,80,'MWK','product',true,'none','none','BAG') returning id",
    [orgs.A.business],
  )).rows[0].id;

  // Capability appointment uses the existing owner/admin grant rules unchanged.
  for (const capability of ['procurement.master.manage', 'procurement.po.manage']) {
    await roleSql(identities.A_admin.id,
      'select public.grant_construction_procurement_capability($1,$2,$3,$4)',
      [orgs.A.business, identities.A_owner.id, capability, 'Synthetic P4C fixture appointment']);
  }
  await roleSql(identities.A_owner.id,
    'select public.grant_construction_procurement_capability($1,$2,$3,$4)',
    [orgs.A.business, identities.A_admin.id, 'procurement.po.authorize', 'Synthetic P4C fixture appointment']);
  site = (await roleSql(identities.A_owner.id,
    'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) as result',
    [orgs.A.business, orgs.A.branch, orgs.A.location, 'R13-APPROVAL', 'Approval test site', 'R13-APPROVAL-PROJECT'])).rows[0].result.id;
}

beforeAll(async () => {
  try { await setup(); }
  catch (error) { setupError = safeError(error); }
});
afterAll(async () => { await db?.cleanup(); });
function ready() {
  if (!db || setupError) throw new Blocked(`Local approval fixture unavailable: ${setupError || 'database not initialized'}`);
}

async function saveWorkflow(type: 'purchase_order' | 'journal_entry', active: boolean, roles: string[]) {
  ready();
  const steps = roles.map((required_role, index) => ({
    required_role,
    description: `Synthetic approval step ${index + 1}`,
  }));
  return roleSql(identities.A_admin.id,
    'select public.save_approval_workflow($1,$2,$3,$4,$5::jsonb) as id',
    [orgs.A.business, type, `R13 ${type} approvals`, active, JSON.stringify(steps)]);
}

async function privilegedJournalPost(uid: string, entryId: string) {
  await db!.client.query('begin');
  await db!.client.query("select set_config('request.jwt.claim.sub',$1,true)", [uid]);
  try {
    await db!.client.query("update public.journal_entries set status='posted', posted_by=$2, posted_at=now() where id=$1", [entryId, uid]);
    await db!.client.query('commit');
  } catch (error) {
    await db!.client.query('rollback');
    throw error;
  }
}

async function createDraftJournal() {
  ready();
  entryCounter += 1;
  const number = `R13-APP-JE-${entryCounter}`;
  const entryId = (await db!.client.query(
    `insert into public.journal_entries(
       business_id, branch_id, currency, description, entry_date, entry_number,
       exchange_rate, status, source_type, created_by
     ) values($1,$2,'MWK','Synthetic approval journal',$3,$4,1,'draft',null,$5) returning id`,
    [orgs.A.business, orgs.A.branch, DAY, number, identities.A_owner.id],
  )).rows[0].id as string;
  for (const [accountId, isDebit, lineNumber] of [[cashAccount, true, 1], [equityAccount, false, 2]] as const) {
    await db!.client.query(
      `insert into public.journal_lines(
         business_id,journal_entry_id,account_id,branch_id,line_number,is_debit,
         amount,amount_base,currency,exchange_rate,rate_is_stale,reconciled,tax_amount
       ) values($1,$2,$3,$4,$5,$6,100,100,'MWK',1,false,false,0)`,
      [orgs.A.business, entryId, accountId, orgs.A.branch, lineNumber, isDebit],
    );
  }
  return entryId;
}

async function createDraftPo() {
  ready();
  poCounter += 1;
  const payload = {
    business_id: orgs.A.business,
    site_id: site,
    supplier_contact_id: supplier,
    currency: 'MWK',
    lines: [{ product_id: product, uom: 'BAG', quantity_ordered: 2 }],
  };
  const result = await roleSql(identities.A_owner.id,
    'select public.create_construction_purchase_order($1::jsonb,$2::uuid) as result',
    [JSON.stringify(payload), `16000000-0000-4000-8000-${String(poCounter).padStart(12, '0')}`]);
  return result.rows[0].result.id as string;
}

test(meta('PLAN-AND-OPT-IN', 'No configured workflow preserves direct manual journal posting; only Enterprise businesses can configure workflows'), async () => {
  ready();
  const entryId = await createDraftJournal();
  const noWorkflow = await roleSql(identities.A_owner.id,
    'select public.start_approval_workflow($1,\'journal_entry\',$2) as result', [orgs.A.business, entryId]);
  expect(noWorkflow.rows[0].result).toMatchObject({ required: false, status: 'not_required' });
  await privilegedJournalPost(identities.A_owner.id, entryId);
  const status = await db!.client.query('select status from public.journal_entries where id=$1', [entryId]);
  expect(status.rows[0].status).toBe('posted');

  await db!.client.query("update public.businesses set plan_tier='growth', plan_expires_at='2099-01-01' where id=$1", [orgs.A.business]);
  await expect(roleSql(identities.A_admin.id,
    'select public.save_approval_workflow($1,\'journal_entry\',$2,true,$3::jsonb)',
    [orgs.A.business, 'forbidden', JSON.stringify([{ required_role: 'admin' }])])).rejects.toThrow();
  await db!.client.query("update public.businesses set plan_tier='enterprise', plan_expires_at='2099-01-01' where id=$1", [orgs.A.business]);
});

test(meta('JOURNAL-CHAIN-REJECT-RESUBMIT', 'A manual journal entry remains draft until all ordered role steps approve; unauthorized roles fail, rejection records its reason, and its author can resubmit to step one'), async () => {
  ready();
  await saveWorkflow('journal_entry', true, ['accountant', 'admin']);
  const entryId = await createDraftJournal();
  const start = await roleSql(identities.A_owner.id,
    'select public.start_approval_workflow($1,\'journal_entry\',$2) as result', [orgs.A.business, entryId]);
  const requestId = start.rows[0].result.request_id as string;

  await expect(roleSql(identities.A_viewer.id,
    'select public.act_on_approval($1,\'approved\',null)', [requestId])).rejects.toThrow();
  await expect(privilegedJournalPost(identities.A_owner.id, entryId)).rejects.toThrow();
  expect((await db!.client.query('select status from public.journal_entries where id=$1', [entryId])).rows[0].status).toBe('draft');

  await roleSql(identities.A_accountant.id,
    'select public.act_on_approval($1,\'approved\',null)', [requestId]);
  const state = await roleSql(identities.A_admin.id,
    'select public.get_approval_state($1,\'journal_entry\',$2) as result', [orgs.A.business, entryId]);
  expect(state.rows[0].result.request).toMatchObject({ status: 'pending', current_step: 2, total_steps: 2, can_approve: true });
  expect((await db!.client.query('select status from public.journal_entries where id=$1', [entryId])).rows[0].status).toBe('draft');

  await roleSql(identities.A_admin.id,
    'select public.act_on_approval($1,\'approved\',\'Final synthetic approval\')', [requestId]);
  expect((await db!.client.query('select status, posted_by from public.journal_entries where id=$1', [entryId])).rows[0])
    .toMatchObject({ status: 'posted', posted_by: identities.A_admin.id });
  const history = await db!.client.query('select action, step_order from public.approval_history where request_id=$1 order by id', [requestId]);
  expect(history.rows.map((row: { action: string }) => row.action)).toEqual(['submitted', 'approved', 'approved']);

  const rejectedEntry = await createDraftJournal();
  const rejectedStart = await roleSql(identities.A_owner.id,
    'select public.start_approval_workflow($1,\'journal_entry\',$2) as result', [orgs.A.business, rejectedEntry]);
  const rejectedRequest = rejectedStart.rows[0].result.request_id as string;
  await expect(roleSql(identities.A_accountant.id,
    'select public.act_on_approval($1,\'rejected\',null)', [rejectedRequest])).rejects.toThrow();
  await roleSql(identities.A_accountant.id,
    'select public.act_on_approval($1,\'rejected\',$2)', [rejectedRequest, 'Synthetic rejection reason']);
  const rejectedState = await roleSql(identities.A_owner.id,
    'select public.get_approval_state($1,\'journal_entry\',$2) as result', [orgs.A.business, rejectedEntry]);
  expect(rejectedState.rows[0].result.request).toMatchObject({ status: 'rejected', is_author: true });
  expect(rejectedState.rows[0].result.request.history.some((item: any) => item.comments === 'Synthetic rejection reason')).toBe(true);
  await expect(roleSql(identities.A_admin.id,
    'select public.start_approval_workflow($1,\'journal_entry\',$2)', [orgs.A.business, rejectedEntry])).rejects.toThrow();
  await roleSql(identities.A_owner.id,
    'select public.resubmit_approval($1)', [rejectedRequest]);
  const resubmitted = await roleSql(identities.A_owner.id,
    'select public.get_approval_state($1,\'journal_entry\',$2) as result', [orgs.A.business, rejectedEntry]);
  expect(resubmitted.rows[0].result.request).toMatchObject({ status: 'pending', current_step: 1, total_steps: 2 });
  expect(resubmitted.rows[0].result.request.history.some((item: any) => item.action === 'resubmitted')).toBe(true);
});

test(meta('PURCHASE-ORDER-GUARD-AND-DEACTIVATION', 'An active PO workflow intercepts authorization, keeps the PO draft through earlier approvals, blocks bypass, and preserves pending requests after deactivation'), async () => {
  ready();
  await saveWorkflow('purchase_order', true, ['accountant', 'admin']);
  const poId = await createDraftPo();
  const started = await roleSql(identities.A_owner.id,
    'select public.start_approval_workflow($1,\'purchase_order\',$2) as result', [orgs.A.business, poId]);
  const requestId = started.rows[0].result.request_id as string;
  await expect(roleSql(identities.A_admin.id,
    'select public.authorize_construction_purchase_order($1)', [poId])).rejects.toThrow();
  await roleSql(identities.A_accountant.id,
    'select public.act_on_approval($1,\'approved\',null)', [requestId]);
  expect((await db!.client.query('select status from public.construction_purchase_orders where id=$1', [poId])).rows[0].status).toBe('draft');

  await saveWorkflow('purchase_order', false, ['accountant', 'admin']);
  await expect(roleSql(identities.A_admin.id,
    'select public.authorize_construction_purchase_order($1)', [poId])).rejects.toThrow();
  await roleSql(identities.A_admin.id,
    'select public.act_on_approval($1,\'approved\',null)', [requestId]);
  expect((await db!.client.query('select status, authorized_by from public.construction_purchase_orders where id=$1', [poId])).rows[0])
    .toMatchObject({ status: 'authorized', authorized_by: identities.A_admin.id });

  const newPo = await createDraftPo();
  await expect(roleSql(identities.A_admin.id,
    'select public.authorize_construction_purchase_order($1)', [newPo])).resolves.toBeDefined();
  expect((await db!.client.query('select status from public.construction_purchase_orders where id=$1', [newPo])).rows[0].status).toBe('authorized');
});
