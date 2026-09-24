import { readdirSync } from 'node:fs';
import { getTransactionLimit, hasCapability, type PlanTier } from '@/lib/billing/plans';
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, roles, saleFixture, expenseFixture, incomeFixture, correctionFixtures, key, expected, subscriptionStates } from './fixtures';
import { evidenceSuite, Blocked, safeError, ObservedFailure } from './evidence';

const test = evidenceSuite('database');
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';
beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try { orgs = await seedFixture(db.client); }
  catch (e) { seedError = safeError(e); }
});
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}
const meta = (id: string, expected: string, remediation = 'R04', source = 'supabase/migrations/20260815000003_phase8b_rls_policies.sql') => ({
  id, expected, remediation, source, layer: 'real PostgreSQL17 roles/RLS; synthetic Auth/Storage; migration-only public ACL',
});
async function denied(run: () => Promise<unknown>) {
  let caught: { code?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string }; }
  if (!caught) throw new ObservedFailure('Forbidden operation completed without permission denial.');
  expect(caught.code).toBe('42501'); // Syntax/constraint/setup errors must NOT pass a denial test.
}
async function ownContact(org: string) {
  const user = identities[`${org}_owner`];
  const r = await db.asRole('authenticated', user.id, 'select id from public.contacts where id=$1', [orgs[org].customer]);
  expect(r.rows).toHaveLength(1); // Positive control before every tenant-negative probe.
}

test(meta('DB.REPLAY', 'All source migrations replay with ONLY declared pg_cron/pg_net installation substitutions', 'R13'), () => {
  if (!db) throw new Blocked(`Replay failed: ${replayError}`);
  expect(db.migrations.map((m: {name:string})=>m.name)).toEqual(readdirSync('supabase/migrations').filter(n=>n.endsWith('.sql')).sort());
  expect(db.version).toMatch(/^17\./);
});
test(meta('DB.FIXTURE', 'Two organisations, fourteen role identities, four branches, stock and shifts seed', 'R13'), async () => {
  ready();
  expect((await db.client.query('select count(*)::int n from public.business_users')).rows[0].n).toBe(14);
  expect((await db.client.query('select count(*)::int n from public.branches')).rows[0].n).toBe(4);
});
test(meta('DB.NONOWNER-ROLE', 'RLS probes use non-superuser/non-bypass application roles', 'R13'), async () => {
  ready();
  const r = await db.asRole('authenticated', identities.A_owner.id,
    'select current_user,rolsuper,rolbypassrls from pg_roles where rolname=current_user');
  expect(r.rows[0]).toMatchObject({ current_user: 'authenticated', rolsuper: false, rolbypassrls: false });
});
for (const [own, foreign] of [['A','B'], ['B','A']]) {
  for (const operation of ['read','update','delete']) test(meta(`TENANT.${own}.${operation}`, `Org ${own} can read own contact but cannot ${operation} Org ${foreign} contact`), async () => {
    ready(); await ownContact(own);
    const sql = operation === 'read' ? 'select id from public.contacts where id=$1'
      : operation === 'update' ? "update public.contacts set name='R13 forbidden change' where id=$1 returning id"
      : 'delete from public.contacts where id=$1 returning id';
    const r = await db.asRole('authenticated', identities[`${own}_owner`].id, sql, [orgs[foreign].customer]);
    expect(r.rows).toHaveLength(0);
  });
  test(meta(`TENANT.${own}.storage`, 'Own logo visible, foreign logo hidden by storage object RLS'), async () => {
    ready();
    let r;
    try { r = await db.asRole('authenticated', identities[`${own}_owner`].id, 'select name from storage.objects'); }
    catch (e) { if ((e as {code?: string}).code==='42501') throw new Blocked('Own-logo positive control denied: storage policy depends on effective business_users SELECT grant absent from migration-only profile. No blanket grant added.'); throw e; }
    expect(r.rows.map((x: {name: string}) => x.name)).toEqual([`${orgs[own].business}/r13-logo.png`]);
  });
  test(meta(`TENANT.${own}.ai`, 'Own AI context available; foreign business RPC denied', 'R03', 'supabase/migrations/20260823000003_repair_ai_view_tenant_scope.sql'), async () => {
    ready();
    expect((await db.asRole('authenticated', identities[`${own}_owner`].id, 'select public.ai_context($1) data', [orgs[own].business])).rows[0].data).toBeTruthy();
    await denied(() => db.asRole('authenticated', identities[`${own}_owner`].id, 'select public.ai_context($1)', [orgs[foreign].business]));
  });
  test(meta(`TENANT.${own}.pos`, 'Foreign business sale RPC denied', 'R06', 'supabase/migrations/20260923000000_post_pos_sale_rpc.sql'), async () => {
    ready();
    const positive=await db.asRole('authenticated', identities[`${own}_cashier`].id, 'select public.post_pos_sale($1::jsonb) data', [JSON.stringify(saleFixture(orgs[own]))]);
    expect(positive.rows[0].data.id).toBeTruthy();
    await denied(() => db.asRole('authenticated', identities[`${own}_cashier`].id, 'select public.post_pos_sale($1::jsonb)', [JSON.stringify(saleFixture(orgs[foreign]))]));
  });
}
for (const role of roles) test(meta(`ROLE.${role}.write`, `${role}: permitted/denied contact creation at database boundary`), async () => {
  ready();
  const run = () => db.asRole('authenticated', identities[`A_${role}`].id,
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 role probe','customer',true,false) returning id", [orgs.A.business]);
  if (['viewer','cashier'].includes(role)) await denied(run);
  else expect((await run()).rows).toHaveLength(1);
});
test(meta('PRIV.PROFILE', 'Ordinary viewer cannot update own is_platform_admin', 'R01'), async () => {
  ready();
  const acl = await db.client.query("select has_column_privilege('authenticated','public.user_profiles','full_name','UPDATE') permitted");
  if (!acl.rows[0].permitted) throw new Blocked('Migration-only ACL lacks benign profile UPDATE; deployed column grants required. No synthetic grant added.');
  await denied(() => db.asRole('authenticated', identities.A_viewer.id, 'update public.user_profiles set is_platform_admin=true where id=$1 returning id', [identities.A_viewer.id]));
});
test(meta('PRIV.MEMBERSHIP', 'Viewer cannot promote own membership to owner', 'R01'), async () => {
  ready();
  const acl = await db.client.query("select has_table_privilege('authenticated','public.business_users','UPDATE') permitted");
  if (!acl.rows[0].permitted) throw new Blocked('Effective membership UPDATE grant not represented by migration-only ACL; no grant-all test bootstrap.');
  const r = await db.asRole('authenticated', identities.A_viewer.id,
    "update public.business_users set role='owner' where business_id=$1 and user_id=$2 returning id", [orgs.A.business, identities.A_viewer.id]);
  expect(r.rows).toHaveLength(0);
});
test(meta('AI.ANON', 'Null-UID anon cannot obtain business AI context', 'R03', 'supabase/migrations/20260823000003_repair_ai_view_tenant_scope.sql'), async () => {
  ready();
  await denied(() => db.asRole('anon', null, 'select public.ai_context($1)', [orgs.A.business]));
});
test(meta('AI.ROLE', 'Cashier cannot retrieve unrestricted business financial context', 'R11', 'supabase/migrations/20260823000003_repair_ai_view_tenant_scope.sql'), async () => {
  ready();
  await denied(() => db.asRole('authenticated', identities.A_cashier.id, 'select public.ai_context($1)', [orgs.A.business]));
});
const BRANCH_AUDIT: Record<string, string> = {
  read: 'R08.7 audit: branch-scoped ONLY on the till family (pos_shifts/pos_cash_movements/pos_shift_closes/pos_shift_late_adjustments SELECT policies use can_access_branch, proven by R08.SHIFT.BRANCH-SCOPED-READ). Core tables (invoices, contacts, journal_entries, products, inventory ...) keep org-wide is_business_member(business_id) SELECT policies (20260728000008 loop), so an A1-assigned user still reads A2 data server-side. Sealing needs an app-wide policy reshape + a signed contract for NULL-branch ROWS (DEC-03 fixes NULL semantics for USER assignment only; inventing row semantics is out of scope). Beyond R08.7 scope (do-not-expand).',
  create: 'R08.7 audit: post_pos_sale blocks cross-branch posting at the server (proven by R08.SALE.* / R08.BRANCH.SERVER-SCOPE), but raw writer policies (invoices_writer_insert = can_write_sales_data org-wide; contacts/branches/inventory loops = can_write_business_data org-wide) allow an A1-assigned caller to INSERT a document whose branch_id targets A2. ESCAPE PATH. Needs policy reshape + direct-API call-site audit. Stays BLOCKED rather than flip on partial enforcement.',
  modify: 'R08.7 audit: UPDATE writer policies (invoices_writer_update with check can_write_sales_data; 20260728000008 writer_update loops) are org-wide — no can_access_branch predicate. An A1-assigned caller can UPDATE A2 rows server-side. ESCAPE PATH. Same reshape requirement as BRANCH.create.',
  reports: 'R08.7 audit: the POS shift report IS branch-enforced (get_pos_shift_report 42501 wrong-branch — proven by R08.REFUND.SCOPE-ATTACK, R08.SHIFT.CROSS-BRANCH-DENIED, R08.BRANCH.SERVER-SCOPE). All other report surfaces derive from org-wide tables/views with no branch dimension; claiming "reports" branch-scoped app-wide would be manufactured. The proven POS-report subset is covered by the R08 records; a product-level decision + package is needed for general reporting.',
  inventory: 'R08.7 audit: inventory_locations carry branch_id but stock_movements/inventory_balances RLS is org-wide (can_write_business_data/is_business_member only). A1-assigned caller can read/move A2 stock. ESCAPE PATH. Needs scoped inventory policy work outside R08.7.',
  customers: 'R08.7 audit: contacts SELECT/INSERT/UPDATE are org-wide member/writer policies (20260728000008 loop + R04 contacts_writer_*). No branch predicate exists on the customer surface. ESCAPE PATH.',
  financial: 'R08.7 audit: journal_entries/journal_lines and finance views are org-wide RLS (tier-based write, member-based read); no branch dimension. A1-assigned user reads org-wide financial data; flip would overclaim.',
  'cross-branch-admin': 'R08.7 audit (two-sided): POS terminal admin is sealed — pos_terminals write/update + hard DELETE require can_admin_business_data (owner/admin, org-wide roles per DEC-03, so assigned-scope roles have zero terminal admin in any branch). ESCAPE: branches/departments/inventory_locations writer policies are the broad can_write_business_data tier (cashier/stock_clerk/sales_clerk/... included), letting an A1-assigned user create/rename another branch — cross-branch administration is NOT sealed app-wide. One sealed surface + one open surface ⇒ the family is not proven; stays BLOCKED with this citation.',
};
for (const operation of ['read','create','modify','reports','inventory','customers','financial','cross-branch-admin']) {
  test(meta(`BRANCH.${operation}`, `Assigned A1-only user cannot access A2 ${operation}; explicit all-branch role retains legitimate access`, 'R04/R08'), () => {
    ready();
    throw new Blocked(BRANCH_AUDIT[operation]);
  });
}
test(meta('POS.SALE', 'Cashier sale posts invoice/payment/balanced ledger and stable replay key', 'R05/R06', 'supabase/migrations/20260923000000_post_pos_sale_rpc.sql'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: typeof db.client) => {
    const payload = JSON.stringify(saleFixture(orgs.A));
    const first = (await c.query('select public.post_pos_sale($1::jsonb) data', [payload])).rows[0].data;
    const second = (await c.query('select public.post_pos_sale($1::jsonb) data', [payload])).rows[0].data;
    expect(first.id).toBeTruthy(); expect(second.id).toBe(first.id);
    // Privileged observer of effects only; the sale itself ran as cashier above.
    await c.query('reset role');
    expect((await c.query('select count(*)::int n,sum(amount)::numeric amount from public.invoice_payments where invoice_id=$1', [first.id])).rows[0]).toMatchObject({ n: 1, amount: '1500' });
    expect((await c.query(`select count(*)::int n from (select je.id from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id
      where je.business_id=$1 group by je.id having abs(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end))>0.005) x`, [orgs.A.business])).rows[0].n).toBe(0);
    expect((await c.query('select branch_id from public.invoices where id=$1', [first.id])).rows[0].branch_id).toBe(orgs.A.branch);
  });
});
test(meta('POS.STOCK', 'Sale reduces actual balance 100 → 99 (not merely movement insertion)', 'R06', 'supabase/migrations/20260923000000_post_pos_sale_rpc.sql'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: typeof db.client) => {
    await c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(saleFixture(orgs.A,2))]);
    await c.query('reset role');
    const row = (await c.query('select quantity_on_hand from public.inventory_balances where product_id=$1 and location_id=$2', [orgs.A.product,orgs.A.location])).rows[0];
    expect(Number(row.quantity_on_hand)).toBe(expected.stockAfterSale);
  });
});
for (const role of ['viewer','stock_clerk']) test(meta(`POS.DENY.${role}`, `${role} cannot invoke sale directly`, 'R06'), async () => {
  ready(); await denied(() => db.asRole('authenticated', identities[`A_${role}`].id, 'select public.post_pos_sale($1::jsonb)', [JSON.stringify(saleFixture(orgs.A))]));
});
test(meta('FINANCE.ORACLE', 'Deterministic fixture: 1500 sale − 900 COGS − 200 expense = 400 profit; cash 1300', 'R05', 'tests/release/fixtures.ts'), () => {
  const correction=correctionFixtures({business:key(1),customer:key(2),product:key(3),branch:key(4),shift:key(5)},key(6));
  expect(correction.refund.totalRefund).toBe(1500);expect(correction.voidSale.invoiceId).toBe(key(6));
  expect(expected.sale - expected.cost - expected.expense).toBe(expected.netProfit);
  expect(expected.sale - expected.expense).toBe(expected.netCash);
  expect(expected.openingStock - expected.saleQuantity).toBe(expected.stockAfterSale);
});
for (const state of subscriptionStates) test(meta(`BILLING.FIXTURE.${state.name}`, `Synthetic ${state.name} state can be represented without client privilege grants`, 'R10', 'supabase/migrations/20260726000002_subscription_payments.sql'), async () => {
  ready();
  await db.client.query('begin');
  try {
    await db.client.query('update public.businesses set plan_tier=$1,plan_expires_at=$2 where id=$3', [state.tier,state.expires,orgs.A.business]);
    const r = (await db.client.query('select plan_tier from public.businesses where id=$1', [orgs.A.business])).rows[0];
    expect(r.plan_tier).toBe(state.tier);
  } finally { await db.client.query('rollback'); }
});
test(meta('BILLING.ACTIVATION', 'Authenticated user cannot call service-only subscription activation', 'R10'), async () => {
  ready();
  await denied(() => db.asRole('authenticated', identities.A_owner.id,
    "select public.apply_subscription_payment('r13-nonexistent','success',null,'{}'::jsonb)"));
});
test(meta('POS.VOID','Authorized void has exactly-once reversal effects','R07','supabase/migrations/20260928000002_r07_correction_commands.sql'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async(c:typeof db.client)=>{
    const posted = (await c.query('select public.post_pos_sale($1::jsonb) r',[JSON.stringify(saleFixture(orgs.A,21))])).rows[0].r;
    const v1 = (await c.query('select public.void_pos_sale_command($1::jsonb) r',[JSON.stringify({business_id: orgs.A.business, invoice_id: posted.id, command_key: 'r13-r07-void-21', reason: 'R13 synthetic void'})])).rows[0].r;
    expect(v1.idempotent).toBe(false);
    expect(v1.journal_entries.length).toBeGreaterThan(0);
    // Exactly-once: replay returns the same answer and adds zero new entries.
    const v2 = (await c.query('select public.void_pos_sale_command($1::jsonb) r',[JSON.stringify({business_id: orgs.A.business, invoice_id: posted.id, command_key: 'r13-r07-void-21', reason: 'R13 synthetic void'})])).rows[0].r;
    expect(v2.idempotent).toBe(true);
    // A fresh attempt at the same document is refused by the status machine.
    let caught: { code?: string } | undefined;
    await c.query('savepoint r13v');
    try { await c.query('select public.void_pos_sale_command($1::jsonb)',[JSON.stringify({business_id: orgs.A.business, invoice_id: posted.id, command_key: 'r13-r07-void-22'})]); }
    catch (e) { caught = e as { code?: string }; }
    await c.query('rollback to savepoint r13v');
    expect(caught && caught.code).toBe('22023');
    // Privileged observer of effects only (financial tables are write-closed
    // to app roles: journal reads as 'authenticated' would hit the ledger
    // grant-closure, not the invariant under test).
    await c.query('reset role');
    const inv = (await c.query('select status from public.invoices where id=$1',[posted.id])).rows[0];
    expect(inv.status).toBe('void');
    const total = (await c.query("select count(*)::int n from public.journal_entries where business_id=$1 and source_type='invoice' and source_id=$2",[orgs.A.business,posted.id])).rows[0].n;
    const mirrored = (await c.query("select count(*)::int n from public.journal_entries where business_id=$1 and posting_key like 'void:%'", [orgs.A.business])).rows[0].n;
    expect(mirrored).toBe(v1.journal_entries.length);
    expect(total).toBe(v1.journal_entries.length * 2);
    expect(Number((await c.query('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',[orgs.A.business,orgs.A.product,orgs.A.location])).rows[0].quantity_on_hand)).toBe(100);
    expect(Number((await c.query('select average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',[orgs.A.business,orgs.A.product,orgs.A.location])).rows[0].average_cost)).toBe(900);
  });
});

test(meta('POS.REFUND','Authorized refund has correct original-cost and tender reversal','R07','supabase/migrations/20260928000002_r07_correction_commands.sql'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async(c:typeof db.client)=>{
    const posted = (await c.query('select public.post_pos_sale($1::jsonb) r',[JSON.stringify(saleFixture(orgs.A,22))])).rows[0].r;
    const r1 = (await c.query('select public.refund_pos_sale_command($1::jsonb) r',[JSON.stringify({
      business_id: orgs.A.business, invoice_id: posted.id, command_key: 'r13-r07-refund-22',
      reason: 'R13 synthetic partial refund',
      lines: [{product_id: orgs.A.product, quantity: 1, amount: 1500}]})])).rows[0].r;
    expect(r1.idempotent).toBe(false);
    expect(Number(r1.amount)).toBe(1500);
    expect(Number(r1.remaining)).toBe(0);
    const r2 = (await c.query('select public.refund_pos_sale_command($1::jsonb) r',[JSON.stringify({
      business_id: orgs.A.business, invoice_id: posted.id, command_key: 'r13-r07-refund-22',
      lines: [{product_id: orgs.A.product, quantity: 1, amount: 1500}]})])).rows[0].r;
    expect(r2.idempotent).toBe(true);
    expect(Number(r2.amount)).toBe(1500);
    await c.query('reset role');
    // Tender reversal: cash-out of the ORIGINAL tender account at the refund total.
    const settle = (await c.query("select jl.account_id, jl.is_debit, jl.amount_base from public.journal_lines jl join public.journal_entries je on je.id=jl.journal_entry_id where je.business_id=$1 and je.posting_key='refund:r13-r07-refund-22:settlement' order by jl.is_debit desc",[orgs.A.business])).rows;
    expect(settle).toHaveLength(2);
    expect(Number(Math.abs(settle[0].amount_base))).toBe(1500);
    expect(Number(Math.abs(settle[1].amount_base))).toBe(1500);
    const cash = (await db.client.query('select id from public.accounts where business_id=$1 and code=$2',[orgs.A.business,'1110'])).rows[0].id;
    const revenueLine = (await c.query("select is_debit, amount from public.journal_lines jl join public.journal_entries je on je.id=jl.journal_entry_id where je.business_id=$1 and je.posting_key like 'refund:r13-r07-refund-22:%' and je.posting_key not like '%:settlement' and je.posting_key not like '%:cogs' order by jl.is_debit desc limit 1",[orgs.A.business])).rows[0];
    expect(String(settle[1].account_id)).toBe(cash);
    expect(Number(revenueLine.amount)).toBe(1500);
    expect(revenueLine.is_debit).toBe(true); // revenue reversal debits the original revenue account
    // Original-cost restock: balance back to 100 and average cost unchanged at 900.
    const bal = (await c.query('select quantity_on_hand, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',[orgs.A.business,orgs.A.product,orgs.A.location])).rows[0];
    expect(Number(bal.quantity_on_hand)).toBe(100);
    expect(Number(bal.average_cost)).toBe(900);
    // COGS mirrored at original cost 900.
    const cogs = (await c.query("select amount from public.journal_lines jl join public.journal_entries je on je.id=jl.journal_entry_id where je.business_id=$1 and je.posting_key='refund:r13-r07-refund-22:cogs' and jl.is_debit=false",[orgs.A.business])).rows;
    expect(cogs.length).toBeGreaterThan(0);
    expect(Number(cogs[0].amount)).toBe(900);
  });
});

test(meta('FINANCE.REVERSAL','Approved immutable correction/reversal preserves history','R05/R07','supabase/migrations/20260928000002_r07_correction_commands.sql'), async () => {
  ready();
  // Multi-actor choreography inside ONE rolled-back connection: the harness's
  // session claims are switched per step so authorization really executes
  // under the approver's identity (same mechanism asRole uses at tx start).
  await db.asRole('authenticated', identities.A_cashier.id, async(c:typeof db.client)=>{
    const setActor = async (uid: string) => c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)",[uid]);
    await setActor(identities.A_cashier.id);
    const posted = (await c.query('select public.post_pos_sale($1::jsonb) r',[JSON.stringify(saleFixture(orgs.A,23))])).rows[0].r;
    const req = (await c.query('select public.request_pos_approval($1,$2,$3) r',[orgs.A.business,'void_sale',posted.id])).rows[0].r;
    const token = req.token;
    // Authorization executes under the approver's own verified session identity.
    await setActor(identities.A_owner.id);
    const auth = (await c.query('select public.authorize_pos_approval($1::uuid) r',[token])).rows[0].r;
    expect(auth.authorized_by).toBe(identities.A_owner.id);
    // The requester then consumes the token against the same document/action.
    await setActor(identities.A_cashier.id);
    const v = (await c.query('select public.void_pos_sale_command($1::jsonb) r',[JSON.stringify({
      business_id: orgs.A.business, invoice_id: posted.id, command_key: 'r13-r07-reversal-23',
      approval_token: token, reason: 'approved reversal'})])).rows[0].r;
    expect(v.idempotent).toBe(false);
    // Consumed approval cannot re-authorize a second operation.
    let caught: { code?: string } | undefined;
    await c.query('savepoint r13r');
    try { await c.query('select public.void_pos_sale_command($1::jsonb)',[JSON.stringify({
      business_id: orgs.A.business, invoice_id: posted.id, command_key: 'r13-r07-reversal-24',
      approval_token: token})]); }
    catch (e) { caught = e as { code?: string }; }
    await c.query('rollback to savepoint r13r');
    expect(caught && caught.code).toBe('22023');
    // Privileged observer of effects only.
    await c.query('reset role');
    const originals = (await c.query("select count(*)::int n from public.journal_entries where business_id=$1 and source_type='invoice' and source_id=$2 and posting_key not like 'void:%'",[orgs.A.business, posted.id])).rows[0].n;
    const reversals = (await c.query("select count(*)::int n from public.journal_entries where business_id=$1 and source_type='invoice' and source_id=$2 and posting_key like 'void:%'",[orgs.A.business, posted.id])).rows[0].n;
    expect(originals).toBeGreaterThan(0);
    expect(reversals).toBe(originals);
    const inv = (await c.query('select status from public.invoices where id=$1',[posted.id])).rows[0];
    expect(inv.status).toBe('void');
    expect(Number((await c.query('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',[orgs.A.business,orgs.A.product,orgs.A.location])).rows[0].quantity_on_hand)).toBe(100);
  });
});

for (const [id, expectedBehavior, owner] of [
  ['BILLING.SERVER-QUOTA','Concurrent expired/quota requests denied server-side','R10'],
]) test(meta(id,expectedBehavior,owner), () => {
  ready(); throw new Blocked('Required canonical command/approval/entitlement contract not yet approved or implemented. Existing unit scenarios remain separately runnable; no substitute command invented.');
});



test(meta('FINANCE.POSTING-TOTALS', 'Sale 1500, COGS 900 and expense 200 yield ledger profit 400 and cash 1300', 'R05/R06', 'tests/release/fixtures.ts'), async () => {
  ready();
  const account=(await db.client.query("select id from public.accounts where business_id=$1 and account_type='expense' and code='6110'",[orgs.A.business])).rows[0];
  if(!account) throw new Blocked('Seeded operating expense account 6110 absent; no product chart change made.');
  await db.asRole('authenticated',identities.A_owner.id,async(c:typeof db.client)=>{
    await c.query('select public.post_pos_sale($1::jsonb)',[JSON.stringify(saleFixture(orgs.A,101))]);
    const expense=(await c.query('select public.save_quick_expense($1::jsonb) data',[JSON.stringify(expenseFixture(orgs.A,account.id,102))])).rows[0].data;
    expect(expense.id).toBeTruthy();
    await c.query('reset role'); // Observer only; commands above ran as owner.
    const totals=(await c.query(`select
      sum(case when a.account_type in ('income','expense') then case when jl.is_debit then -jl.amount_base else jl.amount_base end else 0 end) profit,
      sum(case when a.code='1110' then case when jl.is_debit then jl.amount_base else -jl.amount_base end else 0 end) cash
      from public.journal_entries je join public.journal_lines jl on jl.journal_entry_id=je.id join public.accounts a on a.id=jl.account_id
      where je.business_id=$1`,[orgs.A.business])).rows[0];
    expect(Number(totals.profit)).toBe(expected.netProfit);expect(Number(totals.cash)).toBe(expected.netCash);
  });
});


test({id:'BILLING.CAPABILITIES',expected:'Local catalogue limits 50/200/500/2000/unlimited; AI insights not free but pro enabled',source:'src/lib/billing/plans.ts',remediation:'R10',layer:'client catalogue only, NOT server entitlement'},()=>{
  expect(['free','starter','growth','pro','enterprise'].map(t=>getTransactionLimit(t as PlanTier))).toEqual([50,200,500,2000,null]);
  expect(hasCapability('free','ai_insights')).toBe(false);expect(hasCapability('pro','ai_insights')).toBe(true);
});


test(meta('FINANCE.NONPOS-INCOME', 'Quick income posts a balanced document and stock movement without POS shift/till inputs', 'R05/R06', 'supabase/migrations/20260911000001_quick_save_rpc.sql'),async()=>{
  ready();
  const accounts=(await db.client.query("select id,code from public.accounts where business_id=$1 and code in ('1131','4110')",[orgs.A.business])).rows;
  const ar=accounts.find((a:{code:string})=>a.code==='1131');const revenue=accounts.find((a:{code:string})=>a.code==='4110');
  if(!ar||!revenue)throw new Blocked('Seeded quick-income accounts missing; no chart repair applied.');
  await db.asRole('authenticated',identities.A_owner.id,async(c:typeof db.client)=>{
    const posted=(await c.query('select public.save_quick_sale($1::jsonb) data',[JSON.stringify(incomeFixture(orgs.A,ar.id,revenue.id))])).rows[0].data;
    expect(posted.id).toBeTruthy();await c.query('reset role');
    const invoice=(await c.query('select journal_entry_id,total_amount from public.invoices where id=$1',[posted.id])).rows[0];
    expect(Number(invoice.total_amount)).toBe(1500);expect(invoice.journal_entry_id).toBeTruthy();
    const totals=(await c.query('select sum(case when is_debit then amount_base else -amount_base end) net from public.journal_lines where journal_entry_id=$1',[invoice.journal_entry_id])).rows[0];
    expect(Number(totals.net)).toBe(0);
    expect((await c.query('select count(*)::int n from public.stock_movements where business_id=$1 and source_id=$2',[orgs.A.business,posted.id])).rows[0].n).toBe(1);
  });
});


test(meta('DB.ANON-SERVICE-DISTINCT','Null UID does not conflate anon and service_role identities', 'R13'),async()=>{
  ready();
  for(const role of ['anon','service_role']) {
    const row=(await db.asRole(role,null,'select current_user,auth.uid() uid,auth.role() jwt_role,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
    expect(row.current_user).toBe(role);expect(row.jwt_role).toBe(role);expect(row.uid).toBeNull();
    expect(row.rolbypassrls).toBe(role==='service_role');
  }
});
test(meta('BILLING.SERVICE-ACTIVATION','Service-only activation resolves synthetic payment once and preserves legitimate growth entitlement on replay','R10','supabase/migrations/20260726000002_subscription_payments.sql'),async()=>{
  ready();
  await db.asRole('service_role',null,async(c:typeof db.client)=>{
    const sql="select to_jsonb(public.apply_subscription_payment('r13-payment-A','success','r13-provider-ref','{}'::jsonb)) data";
    const first=(await c.query(sql)).rows[0].data;const second=(await c.query(sql)).rows[0].data;
    expect(first.status).toBe('success');expect(second.id).toBe(first.id);
    await c.query('reset role');
    expect((await c.query('select plan_tier from public.businesses where id=$1',[orgs.A.business])).rows[0].plan_tier).toBe('growth');
  });
});
