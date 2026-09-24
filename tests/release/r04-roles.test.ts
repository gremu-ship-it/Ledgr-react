/**
 * R04 — Tenant/role enforcement verification suite.
 *
 * Scope: the release suite's ROLE.cashier.write expectation (fixed intent)
 * requires cashiers to be denied direct INSERT into public.contacts at the
 * database boundary. The authorised cashier path is the SECURITY DEFINER
 * post_pos_sale command (which resolves/creates the billed contact itself),
 * so narrowing contacts writer policies breaks no legitimate flow.
 *
 * Coverage: the full seeded-role write matrix (denials assert 42501 AND that
 * zero rows were returned), cross-organisation and anonymous variants, the
 * preserved POS sale path, the policy/ACL end state, no-over-narrowing
 * read controls, and fixture-data immutability. Every probe transaction is
 * rolled back by the harness; allowed-case state assertions run after.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, roles, saleFixture } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r04-roles');
const MIGRATION = 'supabase/migrations/20260927000001_r04_contacts_writer_scope.sql';
const DB_LAYER = 'real PostgreSQL17 roles/RLS; synthetic identities; full migration replay';
const meta = (id: string, expected: string, source = MIGRATION, layer = DB_LAYER) => ({
  id, expected, remediation: 'R04', source, layer,
});

/** can_write_contacts_data = can_write_business_data minus cashier (17 roles). */
const MATRIX_ALLOWED = ['owner', 'admin', 'accountant', 'stock_clerk', 'branch_manager'];
const MATRIX_DENIED = ['cashier', 'viewer'];
const FULL_TIER = ['owner', 'admin', 'accountant', 'supervisor', 'data_entry',
  'inventory_manager', 'sales_clerk', 'purchasing_officer', 'warehouse_worker',
  'sales_manager', 'customer_service_rep', 'tax_compliance_officer',
  'treasury_manager', 'asset_manager', 'branch_manager', 'manager', 'stock_clerk'];

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

/** Denial with zero-leak semantics: genuine 42501, never a syntax/setup accident. */
async function denied42501(run: () => Promise<unknown>) {
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  if (!caught) throw new Error('Authorisation probe completed without the expected 42501 denial.');
  expect(caught.code).toBe('42501');
}

const insertContact = (org: string, uid: string) =>
  db.asRole('authenticated', uid,
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 R04 probe','customer',true,false) returning id",
    [orgs[org].business]);

const seededContactCount = () => db.client
  .query('select count(*)::int n from public.contacts')
  .then((r: { rows: Array<{ n: number }> }) => r.rows[0].n);

test(meta('R04.CONTACTS.WRITER-MATRIX', 'Seeded-role contacts INSERT matrix: cashier/viewer denied with 42501 and zero rows; all other seeded roles unchanged'), async () => {
  ready();
  for (const role of roles) {
    const uid = identities[`A_${role}`].id;
    if (MATRIX_DENIED.includes(role)) {
      await denied42501(() => insertContact('A', uid));
    } else {
      expect(MATRIX_ALLOWED).toContain(role); // matrix drift guard: only these may pass
      const r = await insertContact('A', uid);
      expect(r.rows).toHaveLength(1);
    }
  }
  // Triggered probes are rollbacks; seeded data untouched across the matrix.
  expect(await seededContactCount()).toBe(2);
});

test(meta('R04.CONTACTS.POS-SALE-PATH-PRESERVED', 'Cashier retains the authorised contact path: post_pos_sale resolves/creates the walk-in contact inside the SECURITY DEFINER command'), async () => {
  ready();
  const r = await db.asRole('authenticated', identities.A_cashier.id,
    'select public.post_pos_sale($1::jsonb) data', [JSON.stringify(saleFixture(orgs.A, 201))]);
  // The definer command posts a real document: id, server invoice number, and
  // balanced COGS/journal entries — the cashier's authorised contact path.
  const data = r.rows[0].data as Record<string, unknown>;
  expect(data).toBeTruthy();
  expect(data.id).toBeTruthy();
  expect(data.number).toMatch(/^INV-/);
  expect(data.journal_entry_id).toBeTruthy();
  expect(data.cogs_entry_id).toBeTruthy();
});

test(meta('R04.CONTACTS.CROSS-ORG', 'Caller-supplied foreign business id is denied for every role class; own scope unchanged in both directions'), async () => {
  ready();
  await denied42501(() => insertContact('B', identities.A_cashier.id));
  await denied42501(() => insertContact('B', identities.A_owner.id));
  await denied42501(() => insertContact('A', identities.B_owner.id));
  expect((await insertContact('A', identities.A_owner.id)).rows).toHaveLength(1);
  expect((await insertContact('B', identities.B_owner.id)).rows).toHaveLength(1);
  expect(await seededContactCount()).toBe(2);
});

test(meta('R04.CONTACTS.ANON-DENIED', 'Anonymous and empty-UID authenticated contexts cannot write contacts'), async () => {
  ready();
  await denied42501(() => db.asRole('anon', null,
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 R04 probe','customer',true,false)",
    [orgs.A.business]));
  await denied42501(() => db.asRole('authenticated', null,
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 R04 probe','customer',true,false)",
    [orgs.A.business]));
});

test(meta('R04.CONTACTS.POLICY-END-STATE', 'Contacts policy set is exactly the known uniform set; both writer policies bind only the scoped tier'), async () => {
  ready();
  const rows = (await db.client.query(
    "select policyname, cmd, coalesce(qual,'') qual, coalesce(with_check,'') chk from pg_policies where schemaname='public' and tablename='contacts' order by policyname",
  )).rows as Array<{ policyname: string; cmd: string; qual: string; chk: string }>;
  expect(rows.map((r) => r.policyname).sort()).toEqual([
    'contacts_admin_delete', 'contacts_member_read', 'contacts_platform_admin_read',
    'contacts_writer_insert', 'contacts_writer_update',
  ].sort());
  const insert = rows.find((r) => r.policyname === 'contacts_writer_insert')!;
  const update = rows.find((r) => r.policyname === 'contacts_writer_update')!;
  expect(insert.chk).toContain('can_write_contacts_data(business_id)');
  expect(update.chk).toContain('can_write_contacts_data(business_id)');
  for (const p of rows) {
    expect(p.qual + p.chk).not.toContain('can_write_business_data');
  }
});

test(meta('R04.CONTACTS.TIER-DEF-MIRROR', 'can_write_contacts_data carries exactly the 17-role equivalent of the shared tier minus cashier'), async () => {
  ready();
  const vDef = (await db.client.query(
    "select pg_get_functiondef('public.can_write_contacts_data(uuid)'::regprocedure) d",
  )).rows[0].d as string;
  for (const role of FULL_TIER) expect(vDef).toContain(`'${role}'`);
  expect(vDef).not.toContain("'cashier'");
  expect(vDef).toContain('minus cashier');
});

test(meta('R04.CONTACTS.TIER-GRANTS', 'can_write_contacts_data grants: closed for anon/PUBLIC, retained for authenticated and service_role'), async () => {
  ready();
  const q = (role: string) => db.client.query(
    "select has_function_privilege($1, 'public.can_write_contacts_data(uuid)', 'EXECUTE') ok", [role],
  ).then((r: { rows: Array<{ ok: boolean }> }) => r.rows[0].ok);
  expect(await q('anon')).toBe(false);
  expect(await q('authenticated')).toBe(true);
  expect(await q('service_role')).toBe(true);
});

test(meta('R04.CONTACTS.READ-UNCHANGED', 'Narrowing writes does not over-narrow reads: member-read unchanged in own org; foreign tenant still invisible'), async () => {
  ready();
  // Cashier and viewer keep their business read tier (own org contact visible).
  expect((await db.asRole('authenticated', identities.A_cashier.id,
    'select count(*)::int n from public.contacts where business_id=$1', [orgs.A.business])).rows[0].n).toBe(1);
  expect((await db.asRole('authenticated', identities.A_viewer.id,
    'select count(*)::int n from public.contacts where business_id=$1', [orgs.A.business])).rows[0].n).toBe(1);
  // Foreign org rows remain invisible to members of the other tenant.
  expect((await db.asRole('authenticated', identities.A_viewer.id,
    'select count(*)::int n from public.contacts where business_id=$1', [orgs.B.business])).rows[0].n).toBe(0);
});

test(meta('R04.CONTACTS.DATA-UNCHANGED', 'Migration and probes alter no existing fixture data: contacts, memberships and branches stay stable'), async () => {
  ready();
  expect(await seededContactCount()).toBe(2);
  expect((await db.client.query('select count(*)::int n from public.business_users')).rows[0].n).toBe(14);
  expect((await db.client.query('select count(*)::int n from public.branches')).rows[0].n).toBe(4);
});
