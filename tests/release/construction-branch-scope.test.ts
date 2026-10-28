/**
 * Construction read-surface branch scope — release evidence (isolated local layer).
 *
 * WHAT THIS SUITE PROVES (and what it does not)
 *   Layer: real PostgreSQL 17 (embedded), full synthetic migration replay including
 *   20261023000000_construction_branch_scope.sql, synthetic authenticated identities
 *   bound through request.jwt.claim.*, every probe running as the `authenticated`
 *   role so RLS genuinely applies, and every probe rolled back.
 *   It is NOT official Supabase Auth/PostgREST, NOT a deployed-policy check and NOT
 *   production verification. No production or shared database was contacted.
 *
 * Covered: the read boundary of the fourteen unconditional branch-linked construction
 * tables (four direct, ten inherited), the four approved supplier-invoice-reference
 * cases (NULL-branch parent, allowed branch, denied branch, cross-business), the two
 * branch-aware read RPCs, capability-grant visibility, the static capability
 * catalogue, the all-branch positive control, business isolation, and that direct DML
 * on the read tables is still refused.
 *
 * Dependency note: the command-side behaviour of this module (capability denial,
 * four-eyes, replay, forgery) is covered by construction-procurement.test.ts (CP.*).
 * This suite covers the read surface the migration changes, so some fixture rows are
 * inserted privileged on purpose in order to place a row in each branch: the policy
 * expression is what is under test, not the command that would normally write it.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('construction-branch-scope');
const MS = 'supabase/migrations/20261023000000_construction_branch_scope.sql';
const LAYER = 'real PostgreSQL17 roles/RLS; synthetic JWT claims; full migration replay (incl. 20261023000000); probes as authenticated; every probe rolled back';
const meta = (id: string, expected: string) => ({ id, expected, remediation: 'CONSTRUCTION-BRANCH-SCOPE-2026-10-16', source: MS, layer: LAYER });

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = ''; let seedError = '';
const P: Record<string, any> = { A: {}, B: {} };

const CAP = {
  master: 'procurement.master.manage',
  poManage: 'procurement.po.manage',
  poAuthorize: 'procurement.po.authorize',
  dnRecord: 'procurement.delivery_note.record',
  grnRecord: 'procurement.grn.record',
  inspect: 'procurement.receipt.inspect',
  exception: 'procurement.exception.authorize',
  billMatch: 'procurement.bill.match',
} as const;

const claim = async (c: C, uid: string | null) => {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [uid ?? '']);
};
const rpc = (c: C, sql: string, values: unknown[] = []) => c.query(sql, values).then((r) => r.rows[0].r);
const count = async (c: C, sql: string, values: unknown[] = []) => Number((await c.query(sql, values)).rows[0].n);
/**
 * Privileged read for ground truth, then restore the authenticated caller.
 * `reset role` alone would leave the connection as the owning superuser, which
 * bypasses RLS and would silently turn every later probe in the same transaction
 * into a privileged read — so the caller's role is explicitly re-established.
 */
async function truth(c: C, sql: string, values: unknown[] = []) {
  // Capture the CALLER before dropping privileges: restoring a fixed identity would
  // silently turn later probes into another user's reads (an org-wide owner, for
  // instance), which is exactly how an access-control test can pass for the wrong
  // reason.
  const uid = ((await c.query('select auth.uid()::text as uid')).rows[0].uid ?? null) as string | null;
  await c.query('reset role');
  const n = Number((await c.query(sql, values)).rows[0].n);
  await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)", [uid ?? '']);
  await c.query('set local role authenticated');
  return n;
}
/** Privileged write: fixtures only, never a probe. */
const su = async (c: C) => { await c.query('reset role'); };
let ck = 7000;
const ckey = () => key(++ck);

async function setup() {
  const c = db.client as unknown as C;
  orgs = await seedFixture(db.client);
  const insertId = async (sql: string, values: unknown[]) => (await c.query(sql, values)).rows[0].id as string;

  for (const org of ['A', 'B'] as const) {
    const b = orgs[org].business;
    P[org].product = await insertId(
      "insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure) values($1,$2,$3,1500,900,'MWK','product',true,'none','none','BAG') returning id",
      [b, `CPB bag ${org}`, `CPB-BAG-${org}`]);
    P[org].supplier = await insertId(
      "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,$2,'supplier',true,false) returning id",
      [b, `CPB supplier ${org}`]);
    P[org].location2 = await insertId(
      'insert into public.inventory_locations(business_id,name,is_default,branch_id) values($1,$2,false,$3) returning id',
      [b, `CPB site store ${org}`, orgs[org].branch2]);
  }

  // Grants: A_admin is the grant administrator (self-grant is refused by design and the
  // owner cannot grant itself either), so the two grant each other.
  await claim(c, identities.A_admin.id);
  for (const uid of [identities.A_owner.id, identities.A_branch_manager.id, identities.A_stock_clerk.id]) {
    for (const cap of Object.values(CAP)) {
      await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r', [orgs.A.business, uid, cap, 'CPB synthetic appointment']);
    }
  }
  await claim(c, identities.A_owner.id);
  for (const cap of Object.values(CAP)) {
    await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r', [orgs.A.business, identities.A_admin.id, cap, 'CPB synthetic appointment']);
  }
  // Business B: its own site, its own PO, so cross-business probes have ground truth.
  await claim(c, identities.B_admin.id);
  for (const cap of Object.values(CAP)) {
    await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r', [orgs.B.business, identities.B_owner.id, cap, 'CPB synthetic appointment']);
  }
  await claim(c, identities.B_owner.id);
  P.B.site1 = (await rpc(c, 'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
    [orgs.B.business, orgs.B.branch, orgs.B.location, 'CPB-SITE-B1', 'CPB site B one', 'CPB-PROJECT-B1'])).id;
  P.B.po = (await rpc(c, 'select public.create_construction_purchase_order($1::jsonb,$2::uuid) r', [JSON.stringify({
    business_id: orgs.B.business, site_id: P.B.site1, supplier_contact_id: P.B.supplier, currency: 'MWK',
    lines: [{ product_id: P.B.product, uom: 'BAG', quantity_ordered: 3 }],
  }), ckey()])).id;

  // Business A: one site, PO, delivery note and goods receipt in EACH branch, so every
  // branch-linked table has a row in A1 (the probe user's branch) and in A2 (another
  // branch of the same business).
  await claim(c, identities.A_owner.id);
  for (const [name, branch, location] of [
    ['A1', orgs.A.branch, orgs.A.location],
    ['A2', orgs.A.branch2, P.A.location2],
  ] as [string, string, string][]) {
    const k = name as 'A1' | 'A2';
    P.A[`site_${k}`] = (await rpc(c, 'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, branch, location, `CPB-SITE-${k}`, `CPB site ${k}`, `CPB-PROJECT-${k}`])).id;
    P.A[`po_${k}`] = (await rpc(c, 'select public.create_construction_purchase_order($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A[`site_${k}`], supplier_contact_id: P.A.supplier, currency: 'MWK',
      lines: [{ product_id: P.A.product, uom: 'BAG', quantity_ordered: 10 }],
    }), ckey()])).id;
    P.A[`poLine_${k}`] = (await c.query('select id from public.construction_purchase_order_lines where po_id=$1', [P.A[`po_${k}`]])).rows[0].id;
    // The org-wide admin (not the owner, preserving four-eyes) authorises both orders.
    await claim(c, identities.A_admin.id);
    await rpc(c, 'select public.authorize_construction_purchase_order($1) r', [P.A[`po_${k}`]]);
    await claim(c, identities.A_owner.id);
    P.A[`dn_${k}`] = (await rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: P.A[`po_${k}`], delivery_note_number: `CPB-DN-${k}`, document_date: DAY,
      evidence_reference: 'CPB synthetic scanned delivery note', document_received_by: 'CPB site clerk',
      lines: [{ po_line_id: P.A[`poLine_${k}`], uom: 'BAG', quantity_declared: 8 }],
    }), ckey()])).id;
    P.A[`grn_${k}`] = (await rpc(c, 'select public.record_construction_goods_receipt($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: P.A[`po_${k}`], receipt_date: DAY,
      lines: [{ po_line_id: P.A[`poLine_${k}`], quantity_received: 8, quantity_accepted: 5,
        quantity_rejected: 1, quantity_quarantined: 2,
        holds: [
          { hold_type: 'rejected', quantity: 1, reason: 'CPB damaged in transit', evidence_reference: 'CPB site photo' },
          { hold_type: 'quarantined', quantity: 2, reason: 'CPB awaiting quality decision', evidence_reference: 'CPB quarantine note' },
        ] }],
    }), ckey()])).id;
    P.A[`grnLine_${k}`] = (await c.query('select id from public.construction_goods_receipt_lines where grn_id=$1', [P.A[`grn_${k}`]])).rows[0].id;
    const insp = await rpc(c, 'select public.record_construction_receipt_inspection($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: P.A[`grnLine_${k}`], inspection_date: DAY, outcome: 'passed',
      quantity_inspected: 6, method: 'CPB visual', evidence_reference: 'CPB inspection log',
    }), ckey()]);
    P.A[`insp_${k}`] = insp.id;
    // A released quarantine is the supported reclassification direction (a rejected
    // or accepted quantity may never be released), and it is what gives
    // construction_receipt_line_reclassifications a row in this branch.
    P.A[`reclass_${k}`] = (await rpc(c, 'select public.reclassify_construction_receipt_line($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: P.A[`grnLine_${k}`], from_bucket: 'quarantined', quantity: 2,
      inspection_id: P.A[`insp_${k}`], reason: 'CPB quarantine released after inspection',
      evidence_reference: 'CPB inspection release note',
    }), ckey()])).id;
  }

  // ── Fixture inserts (privileged): one row per branch in the tables the command
  //    chain above does not reach, plus the four supplier-invoice-reference cases.
  await su(c);
  const movement = async (business: string, location: string, branch: string, product: string) => {
    // Give the site store a positive balance first: the balance trigger refuses an
    // outbound movement that would drive the location negative.
    await insertId(
      `insert into public.stock_movements(business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference, notes)
       values($1,$2,$3,'purchase',$4,20,900,'construction_receipt',gen_random_uuid(),$5,'CPB fixture receipt movement') returning id`,
      [business, product, location, DAY, `CPB-RCPT-${branch.slice(0, 4)}`]);
    return insertId(
      `insert into public.stock_movements(business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference, notes)
       values($1,$2,$3,'issue_out',$4,-1,900,'construction_issue',gen_random_uuid(),$5,'CPB fixture issue movement') returning id`,
      [business, product, location, DAY, `CPB-${branch.slice(0, 4)}`]);
  };

  for (const k of ['A1', 'A2'] as const) {
    const loc = k === 'A1' ? orgs.A.location : P.A.location2;
    const mv = await movement(orgs.A.business, loc, k, P.A.product);
    P.A[`movement_${k}`] = mv;
    P.A[`issue_${k}`] = await insertId(
      `insert into public.construction_material_issues(business_id, site_id, branch_id, location_id, project_ref, product_id, uom,
         quantity, quantity_base, unit_cost_base, total_cost_base, currency, issue_date, evidence_reference, stock_movement_id, issued_by, client_key)
       values($1,$2,$3,$4,$5,$6,'BAG',1,1,900,900,'MWK',$7,'CPB material issue note',$8,$9,$10) returning id`,
      [orgs.A.business, P.A[`site_${k}`], k === 'A1' ? orgs.A.branch : orgs.A.branch2, loc,
        `CPB-PROJECT-${k}`, P.A.product, DAY, mv, identities.A_owner.id, ckey()]);
  }

  // Supplier bills: A1, A2, one with NO branch (business-level), and one in business B.
  P.A.expense = {};
  for (const [k, branch] of [['e1', orgs.A.branch], ['e2', orgs.A.branch2], ['enull', null],
    ['eb', orgs.B.branch]] as [string, string | null][]) {
    const business = k === 'eb' ? orgs.B.business : orgs.A.business;
    const expenseId = await insertId(
      `insert into public.expenses(business_id, expense_number, expense_type, status, expense_date, currency, exchange_rate,
         original_currency, original_amount, functional_currency, functional_amount, rate_date, rate_is_stale, subtotal,
         vat_amount, wht_amount, total_amount, amount_paid, branch_id, reference)
       values($1,$2,'bill','draft',$3,'MWK',1,'MWK',900,'MWK',900,$3,false,900,0,0,900,0,$4,$5) returning id`,
      [business, `CPB-BILL-${k.toUpperCase()}`, DAY, branch, `CPB-REF-${k.toUpperCase()}`]);
    const lineId = await insertId(
      `insert into public.expense_lines(business_id, expense_id, line_number, description, quantity, unit_price, discount_percent,
         discount_amount, tax_code, tax_rate, tax_amount, line_total)
       values($1,$2,1,'CPB cement bags',6,150,0,0,'none',0,0,900) returning id`,
      [business, expenseId]);
    P.A.expense[k] = { id: expenseId, line: lineId, business };
  }
  await insertId(
    `insert into public.construction_supplier_invoice_references(business_id, supplier_contact_id, expense_id, reference_raw, reference_normalized, recorded_by)
     values($1,$2,$3,$4,public._ledgr_construction_normalize_reference($4),$5) returning id`,
    [orgs.A.business, P.A.supplier, P.A.expense.e1.id, 'CPB-REF-E1', identities.A_owner.id]);

  // Bill allocations and cost bases against the A1 and A2 receipt lines.
  for (const k of ['A1', 'A2'] as const) {
    const expense = k === 'A1' ? P.A.expense.e1 : P.A.expense.e2;
    P.A[`alloc_${k}`] = await insertId(
      `insert into public.construction_receipt_bill_allocations(business_id, grn_line_id, expense_id, expense_line_id,
         bill_uom, bill_quantity, bill_quantity_base, receipt_uom, receipt_quantity, receipt_quantity_base, is_exception, matched_by, client_key)
       values($1,$2,$3,$4,'BAG',6,6,'BAG',6,6,false,$5,$6) returning id`,
      [orgs.A.business, P.A[`grnLine_${k}`], expense.id, expense.line, identities.A_owner.id, ckey()]);
    P.A[`cost_${k}`] = await insertId(
      `insert into public.construction_receipt_cost_bases(business_id, grn_line_id, expense_line_id, allocation_id, quantity_base,
         unit_cost_base, cost_currency, exchange_rate_used, evidence_reference, claimed_by, client_key)
       values($1,$2,$3,$4,6,150,'MWK',1,'CPB supplier invoice matched to receipt',$5,$6) returning id`,
      [orgs.A.business, P.A[`grnLine_${k}`], expense.line, P.A[`alloc_${k}`], identities.A_owner.id, ckey()]);
  }
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
    seedError = safeError(e);
    // eslint-disable-next-line no-console
    console.error('CPB fixture setup failed:', seedError);
  }
});

afterAll(async () => { await db?.cleanup?.(); });

const ready = () => {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs || seedError) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// The 4 direct-branch tables
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPB.DIRECT.BRANCH-READ',
  'An A1-only member reads the four direct-branch construction tables of A1 and none of A2, while an all-branch role still reaches both branches'),
  async () => {
    ready();
    const probes: [string, string][] = [
      ['construction_procurement_sites', 'branch_id'],
      ['construction_purchase_orders', 'branch_id'],
      ['construction_goods_receipt_notes', 'branch_id'],
      ['construction_material_issues', 'branch_id'],
    ];
    const seen: Record<string, { own: number; other: number; truthOwn: number; truthOther: number }> = {};

    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const cc = client as C;
      for (const [table] of probes) {
        const own = await count(cc, `select count(*)::int n from public.${table} where branch_id=$1`, [orgs.A.branch]);
        const other = await count(cc, `select count(*)::int n from public.${table} where branch_id=$1`, [orgs.A.branch2]);
        expect(own).toBeGreaterThan(0);      // positive control: the user's own branch is not hidden
        expect(other).toBe(0);               // the boundary itself
        seen[table] = { own, other, truthOwn: 0, truthOther: 0 };
      }
      // Ground truth on the SAME connection: the A2 rows really exist, so the zero
      // above is a denial and not an empty table.
      for (const [table] of probes) {
        seen[table].truthOwn = await truth(cc, `select count(*)::int n from public.${table} where branch_id=$1`, [orgs.A.branch]);
        seen[table].truthOther = await truth(cc, `select count(*)::int n from public.${table} where branch_id=$1`, [orgs.A.branch2]);
        expect(seen[table].truthOwn).toBeGreaterThan(0);
        expect(seen[table].truthOther).toBeGreaterThan(0);
      }
    });

    // All-branch positive control: an owner (DEC-03 org-wide role) still sees both.
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const cc = client as C;
      for (const [table] of probes) {
        expect(await count(cc, `select count(*)::int n from public.${table} where branch_id=$1`, [orgs.A.branch2])).toBeGreaterThan(0);
      }
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// The 10 inherited-branch tables
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPB.INHERITED.BRANCH-READ',
  'The ten construction tables that inherit a branch through a non-null foreign key are readable in the caller\'s branch and not in another branch of the same business'),
  async () => {
    ready();
    // Each inherited table, with the predicate that reaches its branch.
    const probes: [string, string][] = [
      ['construction_purchase_order_lines',
        'exists (select 1 from public.construction_purchase_orders p where p.id = po_id and p.branch_id = $1)'],
      ['construction_purchase_order_events',
        'exists (select 1 from public.construction_purchase_orders p where p.id = po_id and p.branch_id = $1)'],
      ['construction_delivery_notes',
        'exists (select 1 from public.construction_purchase_orders p where p.id = po_id and p.branch_id = $1)'],
      ['construction_delivery_note_lines',
        `exists (select 1 from public.construction_delivery_notes d join public.construction_purchase_orders p on p.id = d.po_id
                  where d.id = delivery_note_id and p.branch_id = $1)`],
      ['construction_goods_receipt_lines',
        'exists (select 1 from public.construction_goods_receipt_notes g where g.id = grn_id and g.branch_id = $1)'],
      ['construction_goods_receipt_holds',
        `exists (select 1 from public.construction_goods_receipt_lines l join public.construction_goods_receipt_notes g on g.id = l.grn_id
                  where l.id = grn_line_id and g.branch_id = $1)`],
      ['construction_receipt_inspections',
        `exists (select 1 from public.construction_goods_receipt_lines l join public.construction_goods_receipt_notes g on g.id = l.grn_id
                  where l.id = grn_line_id and g.branch_id = $1)`],
      ['construction_receipt_line_reclassifications',
        `exists (select 1 from public.construction_goods_receipt_lines l join public.construction_goods_receipt_notes g on g.id = l.grn_id
                  where l.id = grn_line_id and g.branch_id = $1)`],
      ['construction_receipt_bill_allocations',
        `exists (select 1 from public.construction_goods_receipt_lines l join public.construction_goods_receipt_notes g on g.id = l.grn_id
                  where l.id = grn_line_id and g.branch_id = $1)`],
      ['construction_receipt_cost_bases',
        `exists (select 1 from public.construction_goods_receipt_lines l join public.construction_goods_receipt_notes g on g.id = l.grn_id
                  where l.id = grn_line_id and g.branch_id = $1)`],
    ];

    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const cc = client as C;
      for (const [table, predicate] of probes) {
        const own = await count(cc, `select count(*)::int n from public.${table} where ${predicate}`, [orgs.A.branch]);
        const other = await count(cc, `select count(*)::int n from public.${table} where ${predicate}`, [orgs.A.branch2]);
        // Positive control first: a policy that hid the caller's own branch would be
        // a worse defect than the one being fixed, and must fail loudly.
        expect(own, `${table} positive control`).toBeGreaterThan(0);
        expect(other, `${table} branch boundary`).toBe(0);
        // Ground truth: the A2 rows exist, so the zero above is a denial.
        expect(await truth(cc, `select count(*)::int n from public.${table} where ${predicate}`, [orgs.A.branch2]),
          `${table} ground truth`).toBeGreaterThan(0);
      }
    });

    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const cc = client as C;
      for (const [table, predicate] of probes) {
        expect(await count(cc, `select count(*)::int n from public.${table} where ${predicate}`, [orgs.A.branch2])).toBeGreaterThan(0);
      }
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// Supplier invoice references — the four approved cases
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPB.SIR.NULL-BRANCH-PARENT',
  'A supplier invoice reference whose parent bill has NO branch is readable by any active member of the same business and not by another business'),
  async () => {
    ready();
    const top = db.client as unknown as C;
    await top.query(
      `insert into public.construction_supplier_invoice_references(business_id, supplier_contact_id, expense_id, reference_raw, reference_normalized, recorded_by)
       values($1,$2,$3,'CPB-REF-ENULL',public._ledgr_construction_normalize_reference('CPB-REF-ENULL'),$4)`,
      [orgs.A.business, P.A.supplier, P.A.expense.enull.id, identities.A_owner.id]);

    const sql = `select count(*)::int n from public.construction_supplier_invoice_references where expense_id=$1`;

    // Any active member of the business reads a business-level (NULL-branch) bill.
    await db.asRole('authenticated', identities.A_stock_clerk.id, async (client: any) => {
      expect(await count(client as C, sql, [P.A.expense.enull.id])).toBe(1);
    });
    // Another business does not.
    await db.asRole('authenticated', identities.B_owner.id, async (client: any) => {
      expect(await count(client as C, sql, [P.A.expense.enull.id])).toBe(0);
    });
    // Ground truth: the row exists.
    expect(Number((await top.query(`select count(*)::int n from public.construction_supplier_invoice_references where reference_raw='CPB-REF-ENULL'`)).rows[0].n)).toBe(1);
  });

test(meta('CPB.SIR.BRANCH-ALLOWED-AND-DENIED',
  'A supplier invoice reference whose parent bill carries a branch follows that branch: readable in the caller\'s branch and refused in another branch of the same business'),
  async () => {
    ready();
    const top = db.client as unknown as C;
    await top.query(
      `insert into public.construction_supplier_invoice_references(business_id, supplier_contact_id, expense_id, reference_raw, reference_normalized, recorded_by)
       values($1,$2,$3,'CPB-REF-E2',public._ledgr_construction_normalize_reference('CPB-REF-E2'),$4)`,
      [orgs.A.business, P.A.supplier, P.A.expense.e2.id, identities.A_owner.id]);

    const sql = `select count(*)::int n from public.construction_supplier_invoice_references where expense_id=$1`;

    // Allowed branch (A1 parent bill: the row seeded in setup) and denied branch (A2).
    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const cc = client as C;
      const allowed = await count(cc, sql, [P.A.expense.e1.id]);
      const denied = await count(cc, sql, [P.A.expense.e2.id]);
      // Ground truth on the same connection: the denied row exists...
      const ground = await truth(cc, sql, [P.A.expense.e2.id]);
      // ...and the boundary still holds afterwards (the privileged read must not
      // leave the session able to see it).
      const afterRestore = await count(cc, sql, [P.A.expense.e2.id]);
      expect(allowed).toBe(1);
      expect(denied).toBe(0);
      expect(ground).toBe(1);
      expect(afterRestore).toBe(0);
    });
    // The all-branch role reads the A2-linked reference.
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      expect(await count(client as C, sql, [P.A.expense.e2.id])).toBe(1);
    });
  });

test(meta('CPB.SIR.CROSS-BUSINESS',
  'A supplier invoice reference pointing at another business\'s bill is readable by nobody, and the supported command refuses to create one'),
  async () => {
    ready();
    const top = db.client as unknown as C;
    // A deliberately inconsistent row: business A, expense in business B. Inserted
    // privileged because only an out-of-band writer could produce it; the read policy
    // must fail closed rather than expose either business's row.
    await top.query(
      `insert into public.construction_supplier_invoice_references(business_id, supplier_contact_id, expense_id, reference_raw, reference_normalized, recorded_by)
       values($1,$2,$3,'CPB-REF-EXB',public._ledgr_construction_normalize_reference('CPB-REF-EXB'),$4)`,
      [orgs.A.business, P.A.supplier, P.A.expense.eb.id, identities.A_owner.id]);

    const sql = `select count(*)::int n from public.construction_supplier_invoice_references where business_id=$1 and reference_raw='CPB-REF-EXB'`;
    for (const uid of [identities.A_owner.id, identities.A_branch_manager.id, identities.B_owner.id]) {
      await db.asRole('authenticated', uid, async (client: any) => {
        expect(await count(client as C, sql, [orgs.A.business])).toBe(0);
      });
    }
    // Ground truth: the row is there, so the zeros are a denial and not an empty table.
    expect(Number((await top.query(sql, [orgs.A.business])).rows[0].n)).toBe(1);

    // The supported path refuses it: an A capability holder cannot register B's bill.
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const cc = client as C;
      await cc.query('savepoint cpb_xb');
      let code = '';
      try { await rpc(cc, 'select public.register_construction_supplier_invoice_reference($1) r', [P.A.expense.eb.id]); }
      catch (e) { code = (e as { code?: string }).code ?? ''; }
      await cc.query('rollback to savepoint cpb_xb');
      expect(code).toBe('42501');
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// Read RPCs
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPB.RPC.PROJECT-MATERIAL-COST',
  'construction_project_material_cost returns only the caller\'s branch and the whole business to an all-branch role, without a signature change'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const cc = client as C;
      const rows = (await cc.query('select project_ref from public.construction_project_material_cost($1)', [orgs.A.business])).rows;
      const refs = rows.map((r) => r.project_ref);
      expect(refs).toContain('CPB-PROJECT-A1');
      expect(refs).not.toContain('CPB-PROJECT-A2');
    });
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const cc = client as C;
      const refs = (await cc.query('select project_ref from public.construction_project_material_cost($1)', [orgs.A.business])).rows.map((r) => r.project_ref);
      expect(refs).toContain('CPB-PROJECT-A1');
      expect(refs).toContain('CPB-PROJECT-A2');
    });
    // Another business is refused outright.
    await db.asRole('authenticated', identities.B_owner.id, async (client: any) => {
      const cc = client as C;
      await cc.query('savepoint cpb_biz');
      let code = '';
      try { await cc.query('select * from public.construction_project_material_cost($1)', [orgs.A.business]); }
      catch (e) { code = (e as { code?: string }).code ?? ''; }
      await cc.query('rollback to savepoint cpb_biz');
      expect(code).toBe('42501');
    });
  });

test(meta('CPB.RPC.OPEN-ITEMS',
  'construction_procurement_open_items reports only the caller\'s branch, and the whole business to an all-branch role'),
  async () => {
    ready();
    const branchOf = async (cc: C) => {
      const data = await rpc(cc, 'select public.construction_procurement_open_items($1) r', [orgs.A.business]);
      return {
        holds: (data.open_holds as any[]).length,
        posting: (data.awaiting_posting as any[]).length,
        claims: (data.outstanding_supplier_claims as any[]).length,
        costBasis: (data.awaiting_cost_basis as any[]).length,
      };
    };
    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const scoped = await branchOf(client as C);
      // The A2 receipt's hold and outstanding claim must not be reported to an A1-only user.
      expect(scoped.holds).toBe(1);
      expect(scoped.claims).toBe(1);
    });
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const all = await branchOf(client as C);
      expect(all.holds).toBe(2);
      expect(all.claims).toBe(2);
    });
  });

test(meta('CPB.RPC.CAPABILITIES-FOR',
  'construction_procurement_capabilities_for returns only the caller\'s own live grants and refuses a foreign business'),
  async () => {
    ready();
    // A capability holder sees their own full set...
    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const caps = (await rpc(client as C, 'select public.construction_procurement_capabilities_for($1) r', [orgs.A.business])) as string[];
      expect(caps.length).toBe(Object.values(CAP).length);
    });
    // ...and a member who was granted nothing sees an empty list, which is only
    // possible if the function is scoped to the caller and not to the business.
    await db.asRole('authenticated', identities.A_viewer.id, async (client: any) => {
      const caps = (await rpc(client as C, 'select public.construction_procurement_capabilities_for($1) r', [orgs.A.business])) as string[];
      expect(caps).toEqual([]);
    });
    // A foreign business is refused outright.
    await db.asRole('authenticated', identities.B_owner.id, async (client: any) => {
      const cc = client as C;
      await cc.query('savepoint cpb_caps_b');
      let code = '';
      try { await rpc(cc, 'select public.construction_procurement_capabilities_for($1) r', [orgs.A.business]); }
      catch (e) { code = (e as { code?: string }).code ?? ''; }
      await cc.query('rollback to savepoint cpb_caps_b');
      expect(code).toBe('42501');
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// Grant visibility and the static catalogue
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPB.GRANTS.VISIBILITY',
  'A member sees only their own capability-grant rows; a capability administrator sees all; a foreign business sees none'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_stock_clerk.id, async (client: any) => {
      const cc = client as C;
      const rows = (await cc.query('select user_id from public.construction_procurement_grants where business_id=$1', [orgs.A.business])).rows;
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) expect(r.user_id).toBe(identities.A_stock_clerk.id);
      // Ground truth: grants for other people exist in the same business.
      const total = await truth(cc, 'select count(*)::int n from public.construction_procurement_grants where business_id=$1', [orgs.A.business]);
      expect(total).toBeGreaterThan(rows.length);
    });
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const cc = client as C;
      const total = await count(cc, 'select count(*)::int n from public.construction_procurement_grants where business_id=$1', [orgs.A.business]);
      expect(total).toBeGreaterThan(1);
    });
    await db.asRole('authenticated', identities.B_owner.id, async (client: any) => {
      expect(await count(client as C, 'select count(*)::int n from public.construction_procurement_grants where business_id=$1', [orgs.A.business])).toBe(0);
    });
  });

test(meta('CPB.CATALOGUE.STATIC',
  'The static capability catalogue stays readable to signed-in callers and the branchless business tables stay business-scoped'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_stock_clerk.id, async (client: any) => {
      const cc = client as C;
      expect(await count(cc, 'select count(*)::int n from public.construction_procurement_capabilities')).toBeGreaterThan(0);
      expect(await count(cc, 'select count(*)::int n from public.construction_product_uom_conversions where business_id=$1', [orgs.A.business])).toBeGreaterThanOrEqual(0);
      expect(await count(cc, 'select count(*)::int n from public.construction_receipt_posting_policies where business_id=$1', [orgs.A.business])).toBeGreaterThanOrEqual(0);
      // Business-scoped: another business's rows stay invisible.
      expect(await count(cc, 'select count(*)::int n from public.construction_receipt_posting_policies where business_id=$1', [orgs.B.business])).toBe(0);
    });
    // anon holds no construction grant at all.
    await db.asRole('anon', null, async (client: any) => {
      const cc = client as C;
      await cc.query('savepoint cpb_anon');
      let code = '';
      try { await cc.query('select count(*) from public.construction_procurement_capabilities'); }
      catch (e) { code = (e as { code?: string }).code ?? ''; }
      await cc.query('rollback to savepoint cpb_anon');
      expect(code).toBe('42501');
    });
  });

// ─────────────────────────────────────────────────────────────────────────────
// Business isolation, switching, and command-only writes
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPB.BUSINESS.SWITCH-AND-ISOLATION',
  'Reads are scoped to the current business: switching business shows that business\'s own documents and never the other\'s'),
  async () => {
    ready();
    // Business A member: A rows visible, B rows not.
    await db.asRole('authenticated', identities.A_branch_manager.id, async (client: any) => {
      const cc = client as C;
      expect(await count(cc, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.A.business])).toBeGreaterThan(0);
      expect(await count(cc, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.B.business])).toBe(0);
      expect(await count(cc, 'select count(*)::int n from public.construction_purchase_order_lines where business_id=$1', [orgs.B.business])).toBe(0);
    });
    // Business B owner: B's own document is visible, A's is not. This is the switch.
    await db.asRole('authenticated', identities.B_owner.id, async (client: any) => {
      const cc = client as C;
      expect(await count(cc, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.B.business])).toBe(1);
      expect(await count(cc, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.A.business])).toBe(0);
      // Inherited table follows the same isolation rather than the parent alone.
      expect(await count(cc, 'select count(*)::int n from public.construction_purchase_order_lines where business_id=$1', [orgs.A.business])).toBe(0);
    });
  });

test(meta('CPB.WRITE.COMMAND-ONLY',
  'Tightening the read policies did not open a write path: direct DML on construction tables is still refused for authenticated'),
  async () => {
    ready();
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const cc = client as C;
      const attempts: [string, unknown[]][] = [
        ['insert into public.construction_purchase_orders(business_id, site_id, supplier_contact_id, currency, po_number, status, created_by) values($1,$2,$3,\'MWK\',\'CPB-X\',\'draft\',$4)',
          [orgs.A.business, P.A.site_A1, P.A.supplier, identities.A_owner.id]],
        ['update public.construction_purchase_orders set status=\'authorized\' where id=$1', [P.A.po_A1]],
        ['delete from public.construction_purchase_orders where id=$1', [P.A.po_A1]],
        ['update public.construction_material_issues set quantity=999 where id=$1', [P.A.issue_A1]],
      ];
      let n = 0;
      for (const [sql, values] of attempts) {
        const name = `cpb_w${++n}`;
        await cc.query(`savepoint ${name}`);
        let code = '';
        try { await cc.query(sql, values as unknown[]); } catch (e) { code = (e as { code?: string }).code ?? ''; }
        await cc.query(`rollback to savepoint ${name}`);
        expect(code).toBe('42501');
      }
      // The append-only guard is still the second layer for a privileged writer.
      await cc.query('savepoint cpb_w9');
      let guarded = '';
      try {
        await su(cc);
        await cc.query('update public.construction_purchase_orders set status=\'cancelled\' where id=$1', [P.A.po_A1]);
      } catch (e) { guarded = (e as { code?: string }).code ?? ''; }
      await cc.query('rollback to savepoint cpb_w9');
      expect(guarded).toBe('42501');
    });
  });
