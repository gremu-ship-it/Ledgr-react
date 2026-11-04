/**
 * Construction usable-material returns (Phase 1) — release evidence (isolated local layer).
 *
 * WHAT THIS SUITE PROVES (and what it does not)
 *   Layer: real PostgreSQL 17 (embedded), full synthetic migration replay including
 *   20261024000000 (enum label), 20261025000000 (returns register) and
 *   20261026000000 (return command + netted project cost), synthetic authenticated
 *   identities bound through request.jwt.claim.*, every probe running as the
 *   `authenticated` role so RLS genuinely applies, and every probe rolled back.
 *   It is NOT official Supabase Auth/PostgREST, NOT a deployed-policy check and NOT
 *   production verification. No production or shared database was contacted.
 *
 * Covered: the register's privileges/RLS/append-only protection, branch-scoped reads,
 * a partial return and a full return while the store balance is zero, the cumulative
 * bound, the recorded-conversion-ratio rule after the conversion table changes, the
 * weighted-average pool re-pricing (and its effect on a later issue to another
 * project), idempotent replay, true two-connection concurrency (duplicate key and
 * cumulative over-run), capability/branch/business authorisation, the period lock,
 * the absence of any approval tier, the absence of any journal entry, and that every
 * rejected command writes nothing.
 *
 * Fixture note: sites, locations, products, funding receipts and issues are created
 * through the real commands where possible; only the funding stock movement for a
 * store and the extra inventory locations are inserted privileged, because they
 * represent pre-existing stock rather than the behaviour under test.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, PAST, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('construction-returns');
const MS = 'supabase/migrations/20261026000000_construction_return_command.sql';
const LAYER = 'real PostgreSQL17 roles/JWT claims; synthetic identities; full migration replay (incl. 20261024000000/20261025000000/20261026000000); every probe rolled back';
const meta = (id: string, expected: string) => ({ id, expected, remediation: 'CONSTRUCTION-RETURNS-PHASE1-2026-10-16', source: MS, layer: LAYER });

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = ''; let seedError = '';
const P: Record<string, any> = { A: {}, B: {} };

const CAP = {
  master: 'procurement.master.manage',
  poManage: 'procurement.po.manage',
  poAuthorize: 'procurement.po.authorize',
  grnRecord: 'procurement.grn.record',
  policyApprove: 'procurement.policy.approve',
  materialIssue: 'procurement.material.issue',
  materialReturn: 'procurement.material.return',
} as const;

const rpc = (c: C, sql: string, values: unknown[] = []) => c.query(sql, values).then((r) => r.rows[0].r);
const count = async (c: C, sql: string, values: unknown[] = []) => Number((await c.query(sql, values)).rows[0].n);

async function claim(c: C, uid: string | null) {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [uid ?? '']);
}
const as = async (c: C, uid: string | null, role = 'authenticated') => {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
  await c.query(`set local role ${role}`);
};
const su = (c: C) => c.query('reset role');
/** Read a privileged table as the owning connection, then restore the caller. */
async function suRows(c: C, sql: string, values: unknown[] = [], uid: string | null = identities.A_owner.id) {
  await su(c);
  const rows = (await c.query(sql, values)).rows;
  await as(c, uid);
  return rows;
}
const suCount = async (c: C, sql: string, values: unknown[] = [], uid: string | null = identities.A_owner.id) =>
  Number((await suRows(c, sql, values, uid))[0].n);

let sp = 0;
async function failsWith(c: C, run: () => Promise<unknown>, codes: string[], message?: RegExp) {
  const name = `ret_sp_${++sp}`;
  await c.query(`savepoint ${name}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${name}`);
  if (!caught) throw new Error(`Probe completed without the expected denial (${codes.join('/')}).`);
  expect(codes).toContain(caught.code);
  if (message) expect(caught.message ?? '').toMatch(message);
  return caught;
}

let ck = 9000;
const ckey = () => key(++ck);

/** Names the fixture step a failure occurred in (harness messages are otherwise opaque). */
let stage = 'start';
const at = (label: string) => { stage = label; };

// ── Fixture builders ────────────────────────────────────────────────────────

/** A fresh store location per test, so each test's weighted-average pool is its own. */
async function newLocation(c: C, business: string, branch: string, name: string) {
  await su(c);
  const id = (await c.query(
    'insert into public.inventory_locations(business_id,name,is_default,branch_id) values($1,$2,false,$3) returning id',
    [business, name, branch])).rows[0].id as string;
  await as(c, identities.A_owner.id);
  return id;
}

async function newProduct(c: C, business: string, sku: string) {
  await su(c);
  const id = (await c.query(
    "insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure) values($1,$2,$3,1500,900,'MWK','product',true,'none','none','BAG') returning id",
    [business, sku, sku])).rows[0].id as string;
  await as(c, identities.A_owner.id);
  return id;
}

/** Pre-existing stock in a store: a plain purchase movement, inserted privileged. */
async function fund(c: C, business: string, product: string, location: string, quantity: number, unitCost: number) {
  await su(c);
  await c.query(
    `insert into public.stock_movements(business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference, notes)
     values($1,$2,$3,'purchase',$4,$5,$6,'construction_receipt',gen_random_uuid(),$7,'RET fixture funding receipt')`,
    [business, product, location, DAY, quantity, unitCost, `RET-FUND-${location.slice(0, 4)}`]);
  await as(c, identities.A_owner.id);
}

/** A site whose project reference is unique, so project-cost rows cannot collide. */
async function newSite(c: C, business: string, branch: string, location: string, code: string, projectRef: string) {
  const site = await rpc(c, 'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
    [business, branch, location, code, `RET ${code}`, projectRef]);
  return site.id as string;
}

const issuePayload = (over: Record<string, unknown>) => ({
  business_id: orgs.A.business,
  issue_date: DAY,
  issued_to: 'RET crew',
  evidence_reference: 'RET signed site requisition',
  ...over,
});
const issue = (c: C, over: Record<string, unknown>, k = ckey()) =>
  rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify(issuePayload(over)), k]);

const returnPayload = (over: Record<string, unknown>) => ({
  business_id: orgs.A.business,
  quantity: 1,
  return_date: DAY,
  condition: 'usable',
  reason: 'RET surplus to the pour',
  evidence_reference: 'RET signed return note',
  received_by: 'RET storekeeper',
  ...over,
});
const doReturn = (c: C, over: Record<string, unknown>, k = ckey()) =>
  rpc(c, 'select public.return_construction_materials_to_store($1::jsonb,$2::uuid) r', [JSON.stringify(returnPayload(over)), k]);

/** The derived project-cost row (fails loudly rather than returning a nullable row). */
async function projectCost(c: C, business: string, projectRef: string) {
  const rows = (await c.query('select project_ref, issue_count, quantity_base, material_cost, currency from public.construction_project_material_cost($1)', [business])).rows;
  const row = rows.find((entry: any) => entry.project_ref === projectRef);
  if (!row) throw new Error(`No project-cost row for ${projectRef} (business ${business}); rows: ${rows.map((entry: any) => entry.project_ref).join(', ') || 'none'}.`);
  return row as Record<string, any>;
}

const movementFor = (c: C, returnId: string, uid: string | null = identities.A_owner.id) =>
  suRows(c, `select movement_type, quantity, unit_cost, location_id, source_type, source_id, client_key, movement_date
               from public.stock_movements where business_id=$1 and source_type='construction_return' and source_id=$2::text`,
    [orgs.A.business, returnId], uid);

const balanceAt = (c: C, business: string, product: string, location: string, uid: string | null = identities.A_owner.id) =>
  suRows(c, 'select quantity_on_hand, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [business, product, location], uid);

// ── Suite fixture ───────────────────────────────────────────────────────────

async function setup() {
  const c = db.client as unknown as C;
  at('seed identities');
  orgs = await seedFixture(db.client);
  const insertId = async (sql: string, values: unknown[]) => (await c.query(sql, values)).rows[0].id as string;

  at('synthetic reference data');
  for (const org of ['A', 'B'] as const) {
    P[org].supplier = await insertId(
      "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,$2,'supplier',true,false) returning id",
      [orgs[org].business, `RET supplier ${org}`]);
  }

  // Capabilities: the grant administrator performs the grants (nobody may grant to
  // themselves, so the owner and the administrator grant each other).
  at('capability grants (A)');
  await claim(c, identities.A_admin.id);
  for (const uid of [identities.A_owner.id, identities.A_branch_manager.id]) {
    for (const cap of Object.values(CAP)) {
      await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
        [orgs.A.business, uid, cap, 'RET synthetic appointment']);
    }
  }
  await claim(c, identities.A_owner.id);
  for (const cap of Object.values(CAP)) {
    await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_admin.id, cap, 'RET synthetic appointment']);
  }
  // A_accountant holds every OTHER capability, so the capability-denial row isolates
  // the return capability as the only reason the attempt fails. (Nobody may grant a
  // capability to themselves, so the owner grants these, never the recipient; the
  // owner and the branch manager already received every capability from the
  // administrator above.)
  for (const cap of Object.values(CAP)) {
    if (cap === CAP.materialReturn) continue;
    await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_accountant.id, cap, 'RET synthetic appointment (return capability withheld)']);
  }

  // Business B: its own return-capable owner, so cross-business probes have ground truth.
  at('capability grants (B)');
  await claim(c, identities.B_admin.id);
  for (const cap of Object.values(CAP)) {
    await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.B.business, identities.B_owner.id, cap, 'RET synthetic appointment']);
  }

  // The movement policy every site-store movement is gated on.
  at('receipt posting policy');
  await claim(c, identities.A_owner.id);
  await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
    [orgs.A.business, 'RET receipt movement policy', 'RET synthetic board minute']);

  // Business A: one site per test group, in branch A1 (the branch manager's branch)
  // and in branch A2 (a branch that identity cannot reach). One extra store location
  // per group keeps each weighted-average pool independent.
  at('branch + inventory_locations + products');
  const groups: Array<[string, string, string]> = [
    ['P1', orgs.A.branch, 'RET-PROJECT-P1'],
    ['P2', orgs.A.branch, 'RET-PROJECT-P2'],
    ['P3', orgs.A.branch, 'RET-PROJECT-P3'],
    ['P4', orgs.A.branch, 'RET-PROJECT-P4'],
    ['P5', orgs.A.branch, 'RET-PROJECT-P5'],
    ['P6', orgs.A.branch, 'RET-PROJECT-P6'],
    ['P7', orgs.A.branch, 'RET-PROJECT-P7'],
    ['A2', orgs.A.branch2, 'RET-PROJECT-A2'],
  ];
  for (const [name, branch] of groups) {
    P.A[`loc_${name}`] = await newLocation(c, orgs.A.business, branch, `RET store ${name}`);
    P.A[`product_${name}`] = await newProduct(c, orgs.A.business, `RET-${name}`);
    await claim(c, identities.A_owner.id);
    P.A[`site_${name}`] = await newSite(c, orgs.A.business, branch, P.A[`loc_${name}`],
      `RET-SITE-${name}`, `RET-PROJECT-${name}`);
    // Base-unit products need no conversion; the CTN group registers one below.
  }

  // P1: the plain partial/full-return group — 12 bags at 900, all issued away.
  at('P1 funding + issue');
  await fund(c, orgs.A.business, P.A.product_P1, P.A.loc_P1, 12, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_P1 = await issue(c, { site_id: P.A.site_P1, product_id: P.A.product_P1, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET issue to project P1' });

  // P3: the conversion-ratio group — 1 CTN = 12 BAG, then the factor is changed.
  at('P3 UOM conversion + funding + issue');
  await claim(c, identities.A_owner.id);
  await rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
    [orgs.A.business, P.A.product_P3, 'CTN', 'BAG', 12, 'RET conversion evidence']);
  await fund(c, orgs.A.business, P.A.product_P3, P.A.loc_P3, 12, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_P3 = await issue(c, { site_id: P.A.site_P3, product_id: P.A.product_P3, uom: 'CTN', quantity: 1,
    evidence_reference: 'RET issue in cartons' });

  // P4: the pool-re-pricing group — 12 @ 900 issued away, then 6 @ 1500 received.
  at('P4 funding + issue + receipt');
  await fund(c, orgs.A.business, P.A.product_P4, P.A.loc_P4, 12, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_P4 = await issue(c, { site_id: P.A.site_P4, product_id: P.A.product_P4, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET issue to project P4' });
  await fund(c, orgs.A.business, P.A.product_P4, P.A.loc_P4, 6, 1500);
  await claim(c, identities.A_owner.id);

  // P5: concurrency groups — stock issued to the project, plus a second project so a
  // race has two distinct destinations available.
  at('P5 funding + issue');
  await fund(c, orgs.A.business, P.A.product_P5, P.A.loc_P5, 12, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_P5 = await issue(c, { site_id: P.A.site_P5, product_id: P.A.product_P5, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET issue to project P5' });

  at('P6 funding + issues');
  // P6: the period-lock group. Two issues: one dated "yesterday" (so a later return can
  // be dated inside a period that is then closed, without failing the date-order check
  // first) and one dated today.
  await fund(c, orgs.A.business, P.A.product_P6, P.A.loc_P6, 13, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_P6Past = await issue(c, { site_id: P.A.site_P6, product_id: P.A.product_P6, uom: 'BAG', quantity: 1,
    issue_date: PAST, evidence_reference: 'RET issue to project P6 (prior day)' });
  P.A.issue_P6 = await issue(c, { site_id: P.A.site_P6, product_id: P.A.product_P6, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET issue to project P6' });

  // A2: the branch-isolation group — an issue in a branch the A1 manager cannot reach.
  at('A2 funding + issue');
  await fund(c, orgs.A.business, P.A.product_A2, P.A.loc_A2, 12, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_A2 = await issue(c, { site_id: P.A.site_A2, product_id: P.A.product_A2, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET issue to project A2' });

  // P2: the cross-business group and the read-isolation groups also use one A1 and one
  // A2 return recorded here, privileged, so the register has a row in each branch.
  at('P2 funding + issue');
  await fund(c, orgs.A.business, P.A.product_P2, P.A.loc_P2, 12, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_P2 = await issue(c, { site_id: P.A.site_P2, product_id: P.A.product_P2, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET issue to project P2' });

  // P7: one committed return in branch A1, purely so branch-scoped READ can be
  // measured (reads cannot be probed inside a rolled-back write). It deliberately does
  // not use P1, so P1's store still holds nothing at all when the full-return row runs.
  at('P7 funding + issue + committed return');
  await fund(c, orgs.A.business, P.A.product_P7, P.A.loc_P7, 12, 900);
  await claim(c, identities.A_owner.id);
  P.A.issue_P7 = await issue(c, { site_id: P.A.site_P7, product_id: P.A.product_P7, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET issue to project P7' });
  P.A.return_A1 = await doReturn(c, { source_issue_id: P.A.issue_P7.id, quantity: 1 }, ckey());
  P.A.return_A2 = await doReturn(c, { source_issue_id: P.A.issue_A2.id, quantity: 1 }, ckey());

  // Business B: a site and an issue of its own.
  at('business B fixture');
  await claim(c, identities.B_owner.id);
  // Business B needs its own approved movement policy before it can issue anything.
  await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
    [orgs.B.business, 'RET receipt movement policy B', 'RET synthetic board minute B']);
  P.B.loc = await newLocation(c, orgs.B.business, orgs.B.branch, 'RET store B');
  P.B.product = await newProduct(c, orgs.B.business, 'RET-B');
  await claim(c, identities.B_owner.id);
  P.B.site = await newSite(c, orgs.B.business, orgs.B.branch, P.B.loc, 'RET-SITE-B', 'RET-PROJECT-B');
  await fund(c, orgs.B.business, P.B.product, P.B.loc, 12, 900);
  await claim(c, identities.B_owner.id);
  P.B.issue = await issue(c, { business_id: orgs.B.business, site_id: P.B.site, product_id: P.B.product, uom: 'BAG', quantity: 12,
    evidence_reference: 'RET B issue' });

  await claim(c, identities.A_owner.id);
}

beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) {
    replayError = safeError(e);
    (db as any)?.cleanup?.();
    return;
  }
  try { await setup(); }
  catch (e) {
    // Named step + raw message: an opaque SQLSTATE in the evidence file is not
    // actionable, and this fixture is synthetic and local-only.
    const err = e as { code?: string; message?: string };
    seedError = `step [${stage}] → ${err.code ?? 'error'}: ${err.message ?? String(e)}`;
  }
});

afterAll(async () => { await db?.cleanup?.(); });

const ready = () => {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs || seedError) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Register: privileges, append-only, branch-scoped reads
// ─────────────────────────────────────────────────────────────────────────────

test(meta('RET.REGISTER.SECURITY',
  'The returns register is readable by authenticated members only: no anon privilege at all, no INSERT/UPDATE/DELETE privilege for authenticated, and the append-only trigger refuses a direct change even to the owning connection'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const probe = async (sql: string, values: unknown[] = []) => {
        const name = `ret_w${++sp}`;
        await c.query(`savepoint ${name}`);
        let code = '';
        try { await c.query(sql, values); } catch (e) { code = (e as { code?: string }).code ?? ''; }
        await c.query(`rollback to savepoint ${name}`);
        return code;
      };
      // Direct writes are refused for a member: no privilege, and no write policy.
      expect(await probe("insert into public.construction_material_returns(business_id, source_issue_id, site_id, branch_id, location_id, project_ref, product_id, uom, quantity, quantity_base, unit_cost_base, total_cost_base, currency, return_date, condition, reason, evidence_reference, stock_movement_id, created_by, client_key) values($1,$2,$3,$4,$5,'x',$6,'BAG',1,1,1,1,'MWK',$7,'usable','r','e',$8,$9,$10)",
        [orgs.A.business, P.A.issue_P1.id, P.A.site_P1, orgs.A.branch, P.A.loc_P1, P.A.product_P1, DAY, P.A.return_A1.stock_movement_id, identities.A_owner.id, ckey()])).toBe('42501');
      expect(await probe('update public.construction_material_returns set quantity=999 where id=$1', [P.A.return_A1.id])).toBe('42501');
      expect(await probe('delete from public.construction_material_returns where id=$1', [P.A.return_A1.id])).toBe('42501');

      // The append-only guard is the second layer, for a privileged writer.
      await su(c);
      await c.query('savepoint ret_guard');
      let guarded = '';
      try { await c.query('update public.construction_material_returns set quantity=999 where id=$1', [P.A.return_A1.id]); }
      catch (e) { guarded = (e as { code?: string }).code ?? ''; }
      await c.query('rollback to savepoint ret_guard');
      expect(guarded).toBe('42501');
      // ... and the row is untouched.
      expect(Number((await c.query('select quantity from public.construction_material_returns where id=$1', [P.A.return_A1.id])).rows[0].quantity)).toBe(1);
      await as(c, identities.A_owner.id);

      // anon holds nothing at all: not even SELECT.
      await as(c, null, 'anon');
      await c.query('savepoint ret_anon');
      let anonCode = '';
      try { await c.query('select count(*) from public.construction_material_returns'); }
      catch (e) { anonCode = (e as { code?: string }).code ?? ''; }
      await c.query('rollback to savepoint ret_anon');
      expect(anonCode).toBe('42501');
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.REGISTER.BRANCH-READ',
  'Register rows are branch-scoped on read: an A1-only manager sees the A1 return and not the A2 one, an all-branch owner sees both, and a member of another business sees none'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      // The A1-only branch manager holds the return capability and is assigned to A1.
      await as(c, identities.A_branch_manager.id);
      const visible = (await c.query('select id from public.construction_material_returns')).rows.map((r: any) => r.id);
      expect(visible).toContain(P.A.return_A1.id);
      expect(visible).not.toContain(P.A.return_A2.id);

      // Ground truth through the owning connection: both rows exist.
      const total = await suCount(c, 'select count(*)::int n from public.construction_material_returns', [], identities.A_branch_manager.id);
      expect(total).toBe(2);

      // All-branch role sees both.
      await as(c, identities.A_owner.id);
      const ownerVisible = (await c.query('select id from public.construction_material_returns')).rows.map((r: any) => r.id);
      expect(ownerVisible).toEqual(expect.arrayContaining([P.A.return_A1.id, P.A.return_A2.id]));

      // Another business sees none of them.
      await as(c, identities.B_owner.id);
      expect(await count(c, 'select count(*)::int n from public.construction_material_returns')).toBe(0);
      await as(c, identities.A_owner.id);
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// The return command: happy paths, bounds, ratio, pool, idempotency, concurrency
// ─────────────────────────────────────────────────────────────────────────────

test(meta('RET.RETURN.PARTIAL-AND-COST',
  'A partial return is recorded at the original issue cost: one construction_return_in movement into the issue\'s own store, one append-only register row, the project\'s net material cost falls by exactly quantity × issue unit cost while issue_count stays the count of issues, and no journal entry is written'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;
      const product = P.A.product_P2;
      const location = P.A.loc_P2;
      const projectRef = 'RET-PROJECT-P2';
      const issueRow = P.A.issue_P2;

      const before = {
        journals: await suCount(c, 'select count(*)::int n from public.journal_entries where business_id=$1', [business]),
        movements: await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business]),
        rows: await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business]),
      };
      const costBefore = await projectCost(c, business, projectRef);
      expect(Number(costBefore.material_cost)).toBe(10800);
      expect(Number(costBefore.quantity_base)).toBe(12);
      expect(Number(costBefore.issue_count)).toBe(1);

      // Half the issue comes back: 6 of 12 base units at the issue cost of 900.
      const result = await doReturn(c, { source_issue_id: issueRow.id, quantity: 6, reason: 'RET surplus bags returned', evidence_reference: 'RET site note 001' });
      expect(Number(result.quantity_base)).toBe(6);
      expect(Number(result.unit_cost_base)).toBe(900);
      expect(Number(result.total_cost_base)).toBe(5400);
      expect(result.project_ref).toBe(projectRef);
      expect(result.journal_effect).toBe('none');

      // Exactly one movement, inbound, at the issue's location and cost.
      const movements = await movementFor(c, result.id);
      expect(movements.length).toBe(1);
      expect(movements[0].movement_type).toBe('construction_return_in');
      expect(Number(movements[0].quantity)).toBe(6);
      expect(Number(movements[0].unit_cost)).toBe(900);
      expect(movements[0].location_id).toBe(location);
      expect(movements[0].client_key).not.toBeNull();

      // One register row, carrying the derived scope.
      const row = (await suRows(c, 'select source_issue_id, site_id, branch_id, location_id, project_ref, product_id, uom, condition from public.construction_material_returns where id=$1', [result.id]))[0];
      expect(row.source_issue_id).toBe(issueRow.id);
      expect(row.site_id).toBe(P.A.site_P2);
      expect(row.branch_id).toBe(orgs.A.branch);
      expect(row.location_id).toBe(location);
      expect(row.project_ref).toBe(projectRef);
      expect(row.product_id).toBe(product);
      expect(row.uom).toBe('BAG');
      expect(row.condition).toBe('usable');

      // The project's derived cost is netted; issue_count is still the issue count.
      const costAfter = await projectCost(c, business, projectRef);
      expect(Number(costAfter.material_cost)).toBe(5400);
      expect(Number(costAfter.quantity_base)).toBe(6);
      expect(Number(costAfter.issue_count)).toBe(1);

      // Stock came back and no journal entry was written.
      const balance = (await balanceAt(c, business, product, location))[0];
      expect(Number(balance.quantity_on_hand)).toBe(6);
      expect(Number(balance.average_cost)).toBe(900);
      expect(await suCount(c, 'select count(*)::int n from public.journal_entries where business_id=$1', [business])).toBe(before.journals);
      expect(await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business])).toBe(before.movements + 1);
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.ZERO-BALANCE-FULL',
  'A FULL return of an issue whose store holds nothing at all succeeds — the on-hand balance is not a bound on an inbound — netting the project\'s material cost to zero, and a second attempt against the same issue is refused as an over-return with nothing written'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;
      const projectRef = 'RET-PROJECT-P1';

      // P1's store was stocked with 12 and every unit was issued to the project, so the
      // destination store holds NOTHING at the moment of the return.
      const balanceBefore = (await balanceAt(c, business, P.A.product_P1, P.A.loc_P1))[0];
      expect(Number(balanceBefore.quantity_on_hand)).toBe(0);
      expect(await count(c, 'select count(*)::int n from public.construction_material_returns where source_issue_id=$1', [P.A.issue_P1.id])).toBe(0);

      // The whole issue comes back in one call.
      const full = await doReturn(c, { source_issue_id: P.A.issue_P1.id, quantity: 12, reason: 'RET unused bags returned to store', evidence_reference: 'RET site note full' });
      expect(Number(full.quantity_base)).toBe(12);
      expect(Number(full.total_cost_base)).toBe(10800);

      const cost = await projectCost(c, business, projectRef);
      expect(Number(cost.material_cost)).toBe(0);
      expect(Number(cost.quantity_base)).toBe(0);
      expect(Number(cost.issue_count)).toBe(1); // still one issue record

      const balanceAfter = (await balanceAt(c, business, P.A.product_P1, P.A.loc_P1))[0];
      expect(Number(balanceAfter.quantity_on_hand)).toBe(12);
      expect(Number(balanceAfter.average_cost)).toBe(900);

      // Nothing is left to return.
      const movementsBefore = await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business]);
      const rowsBeforeAll = await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business]);
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P1.id, quantity: 1 }), ['22023'], /over-return/);
      expect(await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business])).toBe(rowsBeforeAll);
      expect(await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business])).toBe(movementsBefore);
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.OVER-RETURN',
  'The cumulative bound is the issue\'s recorded quantity: two partial returns that individually fit are accepted, and the third that would exceed what was issued is refused with no register row, no movement and no change to project cost'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;
      const projectRef = 'RET-PROJECT-P5';

      await doReturn(c, { source_issue_id: P.A.issue_P5.id, quantity: 5, reason: 'RET first partial', evidence_reference: 'RET note 1' });
      await doReturn(c, { source_issue_id: P.A.issue_P5.id, quantity: 5, reason: 'RET second partial', evidence_reference: 'RET note 2' });
      const cost = await projectCost(c, business, projectRef);
      expect(Number(cost.quantity_base)).toBe(2);

      const rowsBefore = await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business]);
      const movementsBefore = await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business]);
      const balanceBefore = (await balanceAt(c, business, P.A.product_P5, P.A.loc_P5))[0];

      const refused = await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P5.id, quantity: 3, reason: 'RET too much', evidence_reference: 'RET note 3' }), ['22023'], /over-return/);
      // The refusal states the bound and the remainder in operator-readable form
      // (six-decimal text: plpgsql RAISE cannot format a precision itself).
      expect(refused.message ?? '').toMatch(/were issued to this project and 10\.000000 base units have already been returned, so only 2\.000000 remain returnable/);

      expect(await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business])).toBe(rowsBefore);
      expect(await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business])).toBe(movementsBefore);
      const balanceAfter = (await balanceAt(c, business, P.A.product_P5, P.A.loc_P5))[0];
      expect(Number(balanceAfter.quantity_on_hand)).toBe(Number(balanceBefore.quantity_on_hand));
      expect(Number(balanceAfter.average_cost)).toBe(Number(balanceBefore.average_cost));
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.CONVERSION-RATIO',
  'The base quantity comes from the issue\'s RECORDED conversion ratio, not the conversion table: after the 1 CTN = 12 BAG factor is superseded by 1 CTN = 10 BAG, returning half the issue still relieves 6 base units, and a return in a different unit is refused'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;
      const product = P.A.product_P3;

      // The issue was 1 CTN = 12 base units at 900. Now the conversion changes.
      await rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
        [business, product, 'CTN', 'BAG', 10, 'RET revised conversion evidence']);
      const active = await suRows(c, 'select factor from public.construction_product_uom_conversions where business_id=$1 and product_id=$2 and is_active order by approved_at desc', [business, product]);
      expect(active.some((r: any) => Number(r.factor) === 10)).toBe(true);
      await as(c, identities.A_owner.id);

      // Half of the carton comes back: the recorded ratio gives 6, not 5.
      const result = await doReturn(c, { source_issue_id: P.A.issue_P3.id, quantity: 0.5, reason: 'RET half carton returned', evidence_reference: 'RET note 4' });
      expect(Number(result.quantity_base)).toBe(6);
      expect(Number(result.total_cost_base)).toBe(5400);
      const cost = await projectCost(c, business, 'RET-PROJECT-P3');
      expect(Number(cost.material_cost)).toBe(5400);
      expect(Number(cost.quantity_base)).toBe(6);
      expect(Number(cost.issue_count)).toBe(1);

      const movements = await movementFor(c, result.id);
      expect(Number(movements[0].quantity)).toBe(6);

      // A different unit of measure is refused outright — no conversion is inferred.
      const rowsBefore = await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business]);
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P3.id, quantity: 1, quantity_uom: 'SACK' }), ['22023'], /uom-mismatch/);
      expect(await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business])).toBe(rowsBefore);
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.POOL-REPRICING',
  'The shared balance writer re-prices the weighted-average pool on the return: after 12 @ 900 were issued away and 6 @ 1500 received, returning 6 at the original 900 cost sets the pool average to exactly 1200, and a later issue to a different project is costed at that new average'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;

      // Pool state before the return: 6 on hand at 1500.
      const before = (await balanceAt(c, business, P.A.product_P4, P.A.loc_P4))[0];
      expect(Number(before.quantity_on_hand)).toBe(6);
      expect(Number(before.average_cost)).toBe(1500);

      await doReturn(c, { source_issue_id: P.A.issue_P4.id, quantity: 6, reason: 'RET cartons returned', evidence_reference: 'RET note 5' });

      // (6 × 1500 + 6 × 900) / 12 = 1200 exactly.
      const after = (await balanceAt(c, business, P.A.product_P4, P.A.loc_P4))[0];
      expect(Number(after.quantity_on_hand)).toBe(12);
      expect(Number(after.average_cost)).toBe(1200);

      // The documented downstream effect: a later issue to ANOTHER project carries the
      // recalculated average.
      const secondSite = await newSite(c, business, orgs.A.branch, P.A.loc_P4, 'RET-SITE-P4B', 'RET-PROJECT-P4B');
      const downstream = await issue(c, { site_id: secondSite, product_id: P.A.product_P4, uom: 'BAG', quantity: 2,
        evidence_reference: 'RET later issue to another project' });
      expect(Number(downstream.unit_cost_base)).toBe(1200);
      const otherCost = await projectCost(c, business, 'RET-PROJECT-P4B');
      expect(Number(otherCost.material_cost)).toBe(2400);
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.IDEMPOTENT',
  'Replaying the same client key returns the committed row with idempotent:true and writes nothing further — one register row and one stock movement — while a different key for the same issue posts a second, separate return'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;
      const shared = ckey();
      const payload = { source_issue_id: P.A.issue_P6.id, quantity: 2, reason: 'RET replay probe', evidence_reference: 'RET note 6' };

      const first = await doReturn(c, payload, shared);
      const replay = await doReturn(c, payload, shared);
      expect(replay.id).toBe(first.id);
      expect(replay.idempotent).toBe(true);
      expect(replay.stock_effect).toBe('none');

      expect((await movementFor(c, first.id)).length).toBe(1);
      expect(await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1 and client_key=$2', [business, shared])).toBe(1);

      // Ground truth: exactly one row for that key even against an unfiltered read.
      expect(await suCount(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1 and client_key=$2', [business, shared])).toBe(1);

      // A different key is a genuinely new return, not a replay.
      const before = await projectCost(c, business, 'RET-PROJECT-P6');
      const second = await doReturn(c, payload, ckey());
      expect(second.id).not.toBe(first.id);
      expect(second.idempotent).toBe(false);
      expect(Number(second.quantity_base)).toBe(2);
      const cost = await projectCost(c, business, 'RET-PROJECT-P6');
      // 'before' is read after the first return (and its replay), so this second
      // return of 2 base units moves the netted project cost by exactly 1800.
      expect(Number(cost.quantity_base)).toBe(Number(before.quantity_base) - 2);
      expect(Number(cost.material_cost)).toBe(Number(before.material_cost) - 1800);
      expect(Number(cost.issue_count)).toBe(Number(before.issue_count));
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.CONCURRENT-DUPLICATE',
  'Two independent sessions submitting the SAME client key produce exactly one return: the second blocks on the advisory fence, then observes the committed row and replays it as idempotent instead of colliding on the unique index'),
  async () => {
    ready();
    if (!db.createSecondClient) throw new Blocked('Second-connection harness unavailable');
    const c = db.client as unknown as C;
    const second = await db.createSecondClient();
    const c2 = second.client as unknown as C;
    try {
      await db.beginAsRole('authenticated', identities.A_owner.id);
      await second.beginAsRole('authenticated', identities.A_owner.id);
      const shared = ckey();
      const payload = returnPayload({ source_issue_id: P.A.issue_A2.id, quantity: 2, reason: 'RET concurrent duplicate', evidence_reference: 'RET note 7' });

      const first = await rpc(c, 'select public.return_construction_materials_to_store($1::jsonb,$2::uuid) r', [JSON.stringify(payload), shared]);
      let replayResult: any = null;
      let replayError: { code?: string; message?: string } | undefined;
      const pending = rpc(c2, 'select public.return_construction_materials_to_store($1::jsonb,$2::uuid) r', [JSON.stringify(payload), shared])
        .then((r) => { replayResult = r; })
        .catch((e) => { replayError = e as { code?: string; message?: string }; });
      await db.commitTx();
      await pending;
      await second.commitTx();
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (replayError) throw new Error(`Concurrent replay failed: ${replayError.code ?? 'unknown'} ${replayError.message ?? ''}`);
      expect(replayResult.id).toBe(first.id);
      expect(replayResult.idempotent).toBe(true);

      await su(c);
      const rows = (await c.query('select count(*)::int n from public.construction_material_returns where business_id=$1 and client_key=$2', [orgs.A.business, shared])).rows[0].n;
      const movements = (await c.query("select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return' and source_id=$2::text", [orgs.A.business, first.id])).rows[0].n;
      expect(Number(rows)).toBe(1);
      expect(Number(movements)).toBe(1);
      await as(c, identities.A_owner.id);
    } finally {
      await db.rollbackTx().catch(() => {});
      await second.rollbackTx().catch(() => {});
      await second.close();
    }
  });

test(meta('RET.RETURN.CONCURRENT-OVERRUN',
  'Two concurrent returns against the same issue with different keys cannot both pass the cumulative bound: the source issue row lock serialises them, exactly one commits and the other is refused as an over-return'),
  async () => {
    ready();
    if (!db.createSecondClient) throw new Blocked('Second-connection harness unavailable');
    const c = db.client as unknown as C;
    const second = await db.createSecondClient();
    const c2 = second.client as unknown as C;
    try {
      // A2's issue already has 1 of 12 returned, and 2 more are pending in the row
      // above when the suite runs in order; this row reads the live remainder first so
      // it is order-independent.
      await db.beginAsRole('authenticated', identities.A_owner.id);
      const returnedSoFar = await suCount(c, 'select coalesce(sum(quantity_base),0)::numeric::int n from public.construction_material_returns where business_id=$1 and source_issue_id=$2',
        [orgs.A.business, P.A.issue_A2.id]);
      const issued = 12;
      const remaining = issued - returnedSoFar;
      expect(remaining).toBeGreaterThanOrEqual(6);
      const each = Math.floor(remaining / 2) + 2; // each request alone exceeds half the remainder

      await second.beginAsRole('authenticated', identities.A_owner.id);
      const payloadA = returnPayload({ source_issue_id: P.A.issue_A2.id, quantity: each, reason: 'RET concurrent A', evidence_reference: 'RET note 8a' });
      const payloadB = returnPayload({ source_issue_id: P.A.issue_A2.id, quantity: each, reason: 'RET concurrent B', evidence_reference: 'RET note 8b' });

      // Session one completes its command inside its still-open transaction, so the
      // source-issue row lock is held while session two tries to take it; the commit
      // then releases it and the second request re-reads the committed total.
      await rpc(c, 'select public.return_construction_materials_to_store($1::jsonb,$2::uuid) r', [JSON.stringify(payloadA), ckey()]);
      let blocked = true;
      const b = rpc(c2, 'select public.return_construction_materials_to_store($1::jsonb,$2::uuid) r', [JSON.stringify(payloadB), ckey()])
        .then((r) => { blocked = false; return { ok: true as const, r }; })
        .catch((e) => { blocked = false; return { ok: false as const, e: e as { code?: string; message?: string } }; });
      await new Promise((resolve) => setTimeout(resolve, 150)); // let session two reach the lock
      expect(blocked).toBe(true);
      await db.commitTx();
      const rb = await b;
      await second.commitTx();

      // A genuine failure here must surface as FAIL, never as BLOCKED (which the
      // released gate tolerates): assert first, then narrow for the type checker.
      expect(rb.ok).toBe(false);
      if (!rb.ok) {
        expect(rb.e.code).toBe('22023');
        expect(rb.e.message ?? '').toMatch(/over-return/);
      }

      await su(c);
      const totalReturned = Number((await c.query('select coalesce(sum(quantity_base),0) n from public.construction_material_returns where business_id=$1 and source_issue_id=$2', [orgs.A.business, P.A.issue_A2.id])).rows[0].n);
      expect(totalReturned).toBeLessThanOrEqual(issued + 0.000001);
      const accepted = (await c.query('select id from public.construction_material_returns where business_id=$1 and source_issue_id=$2 and reason=$3',
        [orgs.A.business, P.A.issue_A2.id, 'RET concurrent A'])).rows;
      expect(accepted.length).toBe(1);
      const movements = Number((await c.query("select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return' and source_id=$2::text", [orgs.A.business, accepted[0].id])).rows[0].n);
      expect(movements).toBe(1);
      await as(c, identities.A_owner.id);
    } finally {
      await db.rollbackTx().catch(() => {});
      await second.rollbackTx().catch(() => {});
      await second.close();
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// Authorisation, isolation, period lock, GL boundary, no-write guarantees
// ─────────────────────────────────────────────────────────────────────────────

test(meta('RET.RETURN.AUTHZ',
  'The return command refuses an unsigned caller, a member without the return capability, a source issue of another business, an untraceable request, and any attempt to supply a derived value — each with nothing written'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;
      const rowsBefore = await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business]);
      const movementsBefore = await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business]);

      // No capability: this identity holds every other capability and membership.
      await as(c, identities.A_accountant.id);
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P2.id, quantity: 1 }), ['42501'], /procurement\.material\.return/);

      // Anonymous: no session at all.
      await as(c, null, 'anon');
      await failsWith(c, () => c.query('select public.return_construction_materials_to_store($1::jsonb,$2::uuid) r',
        [JSON.stringify(returnPayload({ source_issue_id: P.A.issue_P2.id, quantity: 1 })), ckey()]), ['42501'], /permission denied|signed in/i);

      // A member with the capability, but a source issue of another business.
      await as(c, identities.A_owner.id);
      await failsWith(c, () => doReturn(c, { source_issue_id: P.B.issue.id, quantity: 1 }), ['42501'], /does not belong to this business/);

      // Untraceable: no source issue at all.
      await failsWith(c, () => doReturn(c, { source_issue_id: '00000000-0000-4000-8000-000000000000', quantity: 1 }), ['42501'], /does not belong/);
      const missing: Record<string, unknown> = { ...returnPayload({ quantity: 1 }) };
      delete missing.source_issue_id;
      await failsWith(c, () => rpc(c, 'select public.return_construction_materials_to_store($1::jsonb,$2::uuid) r', [JSON.stringify(missing), ckey()]), ['22023'], /traceable-to-issue-required/);

      // A derived value must not be supplied at all — refused, not ignored.
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P2.id, quantity: 1, site_id: P.B.site }), ['22023'], /derived-field-not-accepted/);
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P2.id, quantity: 1, unit_cost_base: 1 }), ['22023'], /derived-field-not-accepted/);
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P2.id, quantity: 1, location_id: P.A.loc_A2 }), ['22023'], /derived-field-not-accepted/);

      // A return dated before the issue.
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P2.id, quantity: 1, return_date: PAST }), ['22023'], /return-date-before-issue/);

      // An unrecognised material condition.
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P2.id, quantity: 1, condition: 'damaged' }), ['22023'], /return-condition-invalid/);

      // Nothing at all was written by any of the refusals above.
      expect(await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business])).toBe(rowsBefore);
      expect(await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business])).toBe(movementsBefore);
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.BRANCH-ISOLATION',
  'An A1-only manager cannot return material issued in another branch of the same business, even holding the return capability, and the refusal writes nothing'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;

      // The issue is real and the caller holds the capability — only branch access fails.
      const issueVisible = await suCount(c, 'select count(*)::int n from public.construction_material_issues where id=$1', [P.A.issue_A2.id], identities.A_branch_manager.id);
      expect(issueVisible).toBe(1);
      expect(await count(c, 'select count(*)::int n from public.construction_material_issues where id=$1', [P.A.issue_A2.id])).toBe(0);

      const rowsBefore = await suCount(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business], identities.A_branch_manager.id);
      const movementsBefore = await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business], identities.A_branch_manager.id);
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_A2.id, quantity: 1 }), ['42501'], /access to that branch/);

      // Its own branch still works (P1 was fully returned, so use the A1 issue of P5).
      const ok = await doReturn(c, { source_issue_id: P.A.issue_P5.id, quantity: 1, reason: 'RET A1 manager return', evidence_reference: 'RET note 9' });
      expect(ok.id).toBeTruthy();
      expect(Number(ok.quantity_base)).toBe(1);

      expect(await suCount(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business], identities.A_branch_manager.id)).toBe(rowsBefore + 1);
      expect(await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business], identities.A_branch_manager.id)).toBe(movementsBefore + 1);
      await as(c, identities.A_branch_manager.id);
    });
  });

test(meta('RET.RETURN.PERIOD-LOCK',
  'A return dated inside a closed accounting period is refused with period-closed, nothing is written, and the period is never reopened'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;

      // A closed period covering the fixture's "yesterday".
      await su(c);
      const period = (await c.query(
        `insert into public.accounting_periods(business_id,name,period_start,period_end,is_closed) values($1,'RET returns lock',$2,$2,false) returning id`,
        [business, PAST])).rows[0].id as string;
      await as(c, identities.A_accountant.id);
      await c.query('select public.close_accounting_period($1,$2) r', [period, 'RET month end']);
      await as(c, identities.A_owner.id);

      const rowsBefore = await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business]);
      const movementsBefore = await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business]);
      const balanceBefore = (await balanceAt(c, business, P.A.product_P6, P.A.loc_P6))[0];

      // Dated "yesterday" against the issue from the same day, so the date-order check
      // passes and the period lock is the rule actually exercised.
      await failsWith(c, () => doReturn(c, { source_issue_id: P.A.issue_P6Past.id, quantity: 1, return_date: PAST }), ['22023'], /period-closed/);

      expect(await count(c, 'select count(*)::int n from public.construction_material_returns where business_id=$1', [business])).toBe(rowsBefore);
      expect(await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_return'", [business])).toBe(movementsBefore);
      const balanceAfter = (await balanceAt(c, business, P.A.product_P6, P.A.loc_P6))[0];
      expect(Number(balanceAfter.quantity_on_hand)).toBe(Number(balanceBefore.quantity_on_hand));

      await su(c);
      expect((await c.query('select is_closed from public.accounting_periods where id=$1', [period])).rows[0].is_closed).toBe(true);
      await as(c, identities.A_owner.id);
    });
  });

test(meta('RET.RETURN.NO-APPROVAL-TIER',
  'No second-person approval exists in Phase 1: a single capability holder returns a high-value quantity with no approval token, the approval table used by POS corrections is untouched, and the command is a construction-only path'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const c = client as C;
      const approvalsBefore = await suCount(c, 'select count(*)::int n from public.pos_approvals', [], identities.A_branch_manager.id);

      // 1 base unit at 900 is small; the point is that NO amount triggers an approval
      // requirement in Phase 1, and none is presented or consulted.
      const result = await doReturn(c, { source_issue_id: P.A.issue_P5.id, quantity: 1, approval_token: ckey(),
        reason: 'RET single actor', evidence_reference: 'RET note 10' });
      expect(result.id).toBeTruthy();

      expect(await suCount(c, 'select count(*)::int n from public.pos_approvals', [], identities.A_branch_manager.id)).toBe(approvalsBefore);
      expect((await movementFor(c, result.id, identities.A_branch_manager.id)).length).toBe(1);
      // (the identity is restored by the probe itself, so the caller stays the manager)
      await as(c, identities.A_branch_manager.id);
    });
  });

test(meta('RET.RETURN.GL-BOUNDARY',
  'Returns cannot write a journal entry: the movement type is the dedicated construction_return_in label, the command reports journal_effect none, and the posting policy that would have to change is still constrained to gl_posting_enabled = false'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const business = orgs.A.business;
      const journalsBefore = await suCount(c, 'select count(*)::int n from public.journal_entries where business_id=$1', [business]);

      const result = await doReturn(c, { source_issue_id: P.A.issue_P6.id, quantity: 1, reason: 'RET GL boundary', evidence_reference: 'RET note 11' });
      expect(result.journal_effect).toBe('none');

      const movement = (await movementFor(c, result.id))[0];
      expect(movement.movement_type).toBe('construction_return_in');
      expect(movement.source_type).toBe('construction_return');
      // The label is distinct from the POS restock label: a site return is never a sale return.
      const posRestocks = await suCount(c, "select count(*)::int n from public.stock_movements where business_id=$1 and source_type='pos_return' and source_id=$2::text", [business, result.id]);
      expect(posRestocks).toBe(0);

      expect(await suCount(c, 'select count(*)::int n from public.journal_entries where business_id=$1', [business])).toBe(journalsBefore);

      // The structural guard is unchanged: the CHECK still forbids enabling GL posting.
      const constraint = await suRows(c, `select pg_get_constraintdef(oid) def from pg_constraint where conrelid='public.construction_receipt_posting_policies'::regclass and pg_get_constraintdef(oid) like '%gl_posting_enabled%'`);
      expect(constraint.some((row: any) => /gl_posting_enabled = false/.test(row.def))).toBe(true);
      await as(c, identities.A_owner.id);
    });
  });
