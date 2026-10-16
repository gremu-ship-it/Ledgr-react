/**
 * Construction procurement traceability — release evidence (isolated local layer).
 *
 * WHAT THIS SUITE PROVES (and what it does not)
 *   Layer: real PostgreSQL 17 (embedded), full synthetic migration replay including
 *   20261021000000_construction_procurement_traceability.sql, synthetic
 *   authenticated identities bound through request.jwt.claim.*, every probe running
 *   in a transaction that is rolled back.
 *   It is NOT official Supabase Auth/PostgREST, NOT a deployed-policy check and NOT
 *   production verification. No production or shared database was contacted.
 *
 * Covered: the PO → delivery-note evidence → partial/held GRN → bill matching flow,
 * duplicate supplier-reference prevention with an evidenced exception path, explicit
 * product UOM conversions, forged/cross-tenant/cross-branch identifiers, unauthorized
 * approval and escalation, direct DML denial, idempotency, true two-connection
 * concurrency, rollback, and the absence of any unintended stock movement or journal
 * entry.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, PAST, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('construction-procurement');
const MS = 'supabase/migrations/20261021000000_construction_procurement_traceability.sql';
const LAYER = 'real PostgreSQL17 roles/JWT claims; synthetic identities; full migration replay (incl. 20261021000000); every probe rolled back';
const meta = (id: string, expected: string) => ({ id, expected, remediation: 'CONSTRUCTION-PROCUREMENT-2026-10-16', source: MS, layer: LAYER });

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = ''; let seedError = '';
const CAP = {
  master: 'procurement.master.manage',
  poManage: 'procurement.po.manage',
  poAuthorize: 'procurement.po.authorize',
  dnRecord: 'procurement.delivery_note.record',
  grnRecord: 'procurement.grn.record',
  inspect: 'procurement.receipt.inspect',
  exception: 'procurement.exception.authorize',
  billMatch: 'procurement.bill.match',
  receiptPost: 'procurement.receipt.post',
  policyApprove: 'procurement.policy.approve',
  materialIssue: 'procurement.material.issue',
} as const;

/** Durable synthetic reference data for this suite (business A and B). */
const P: Record<string, any> = { A: {}, B: {} };

async function claim(c: C, uid: string | null) {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','authenticated',false)", [uid ?? '']);
}
const rpc = (c: C, sql: string, values: unknown[] = []) => c.query(sql, values).then((r) => r.rows[0].r);

async function setup() {
  const c = db.client as unknown as C;
  orgs = await seedFixture(db.client);

  const insertId = async (sql: string, values: unknown[]) => (await c.query(sql, values)).rows[0].id as string;

  for (const org of ['A', 'B'] as const) {
    const b = orgs[org].business;
    P[org].productBag = await insertId(
      "insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure) values($1,$2,$3,1500,900,'MWK','product',true,'none','none','BAG') returning id",
      [b, `R13 construction bag ${org}`, `R13-CBAG-${org}`]);
    P[org].productOther = await insertId(
      "insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure) values($1,$2,$3,1500,900,'MWK','product',true,'none','none','BAG') returning id",
      [b, `R13 construction other ${org}`, `R13-COTH-${org}`]);
    P[org].productSack = await insertId(
      "insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure) values($1,$2,$3,1500,900,'MWK','product',true,'none','none','BAG') returning id",
      [b, `R13 construction no-conversion ${org}`, `R13-CSACK-${org}`]);
    P[org].productNoUom = await insertId(
      "insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure) values($1,$2,$3,1500,900,'MWK','product',true,'none','none',null) returning id",
      [b, `R13 construction no base unit ${org}`, `R13-CNOUOM-${org}`]);
    P[org].supplier = await insertId(
      "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,$2,'supplier',true,false) returning id",
      [b, `R13 construction supplier ${org}`]);
    P[org].supplier2 = await insertId(
      "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,$2,'supplier',true,false) returning id",
      [b, `R13 construction supplier 2 ${org}`]);
    P[org].location2 = await insertId(
      'insert into public.inventory_locations(business_id,name,is_default,branch_id) values($1,$2,false,$3) returning id',
      [b, `R13 construction site store ${org}`, orgs[org].branch2]);
  }

  // Capability grants: only an owner/admin may grant, only to another active member,
  // always with a written reason. A_admin is the grant administrator and holds no
  // operational capability of its own.
  await claim(c, identities.A_admin.id);
  const grant = (uid: string, capability: string) => rpc(c,
    'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
    [orgs.A.business, uid, capability, 'R13 synthetic appointment record']);
  for (const capability of Object.values(CAP)) {
    await grant(identities.A_owner.id, capability);
  }
  for (const capability of [CAP.poManage, CAP.grnRecord, CAP.dnRecord, CAP.billMatch, CAP.inspect]) {
    await grant(identities.A_stock_clerk.id, capability);
  }
  for (const capability of [CAP.poAuthorize, CAP.exception]) {
    await grant(identities.A_branch_manager.id, capability);
  }

  // The org-wide administrator drafts the cross-branch probe order. Self-grant is
  // refused by design, so the owner is the grantor.
  await claim(c, identities.A_owner.id);
  await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
    [orgs.A.business, identities.A_admin.id, CAP.poManage, 'R13 synthetic appointment record']);

  // VAT registration is a fact about the business that decides whether input VAT is
  // recoverable (IAS 2 paragraph 11), so the fixture states it explicitly.
  await c.query('update public.businesses set vat_registered = true where id = $1', [orgs.A.business]);
  await c.query('update public.businesses set vat_registered = false where id = $1', [orgs.B.business]);

  // Durable operational evidence: the site→location mapping and the explicit
  // product-specific UOM conversion, both registered by a capability holder.
  await claim(c, identities.A_owner.id);
  P.A.site1 = (await rpc(c, 'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
    [orgs.A.business, orgs.A.branch, orgs.A.location, 'R13-SITE-1', 'R13 site one', 'R13-PROJECT-1'])).id;
  P.A.site2 = (await rpc(c, 'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
    [orgs.A.business, orgs.A.branch2, P.A.location2, 'R13-SITE-2', 'R13 site two', 'R13-PROJECT-2'])).id;
  P.A.conversion = (await rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
    [orgs.A.business, P.A.productBag, 'CTN', 'BAG', 12, 'R13 synthetic supplier packing specification'])).id;

  // Business B's own site, registered by B's own owner: only used to prove that a
  // cross-tenant site identifier is refused for business A.
  await claim(c, identities.B_admin.id);
  await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
    [orgs.B.business, identities.B_owner.id, CAP.master, 'R13 synthetic appointment record']);
  await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
    [orgs.B.business, identities.B_owner.id, CAP.poManage, 'R13 synthetic appointment record']);
  await claim(c, identities.B_owner.id);
  P.B.site1 = (await rpc(c, 'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
    [orgs.B.business, orgs.B.branch, orgs.B.location, 'R13-SITE-B1', 'R13 site B one', 'R13-PROJECT-B1'])).id;
  P.B.po = (await rpc(c, 'select public.create_construction_purchase_order($1::jsonb,$2::uuid) r', [JSON.stringify({
    business_id: orgs.B.business, site_id: P.B.site1, supplier_contact_id: P.B.supplier, currency: 'MWK',
    lines: [{ product_id: P.B.productBag, uom: 'BAG', quantity_ordered: 3 }] }), ckey()])).id;
  await claim(c, null);
}

beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try { await setup(); }
  catch (e) {
    seedError = safeError(e);
    // A partially applied fixture must never be used silently by the probes below.
    // eslint-disable-next-line no-console
    console.error('construction-procurement fixture setup failed:', seedError);
  }
}, 600000);
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs || seedError) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}

let sp = 0;
async function failsWith(c: C, run: () => Promise<unknown>, codes: string[], message?: RegExp) {
  const name = `cp_sp_${++sp}`;
  await c.query(`savepoint ${name}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${name}`);
  if (!caught) throw new Error(`Probe completed without the expected denial (${codes.join('/')}).`);
  expect(codes).toContain(caught.code);
  if (message) expect(caught.message ?? '').toMatch(message);
  return caught;
}
const as = async (c: C, uid: string | null, role = 'authenticated') => {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
  await c.query(`set local role ${role}`);
};
const su = (c: C) => c.query('reset role');
/**
 * Read a privileged table (stock_movements, journal_entries, ...) as the owning
 * connection, then restore the caller's role. `authenticated` deliberately has no
 * SELECT there, so an in-role read would fail for the wrong reason.
 */
async function suCount(c: C, sql: string, values: unknown[] = [], uid: string | null = identities.A_owner.id) {
  await su(c);
  const n = Number((await c.query(sql, values)).rows[0].n);
  await as(c, uid);
  return n;
}
async function suRows(c: C, sql: string, values: unknown[] = [], uid: string | null = identities.A_owner.id) {
  await su(c);
  const rows = (await c.query(sql, values)).rows;
  await as(c, uid);
  return rows;
}
const count = async (c: C, sql: string, values: unknown[] = []) => Number((await c.query(sql, values)).rows[0].n);

let ck = 3000;
const ckey = () => key(++ck);

const poPayload = (over: Record<string, unknown> = {}, org = 'A') => ({
  business_id: orgs[org].business,
  site_id: P[org].site1,
  supplier_contact_id: P[org].supplier,
  currency: 'MWK',
  lines: [{ product_id: P[org].productBag, uom: 'BAG', quantity_ordered: 10 }],
  ...over,
});
const createPo = (c: C, payload: Record<string, unknown>, k: string = ckey()) =>
  rpc(c, 'select public.create_construction_purchase_order($1::jsonb,$2::uuid) r', [JSON.stringify(payload), k]) as Promise<any>;
const authorizePo = (c: C, id: string) =>
  rpc(c, 'select public.authorize_construction_purchase_order($1) r', [id]) as Promise<any>;
const poLines = async (c: C, po: string) =>
  (await c.query('select id, line_number, product_id, uom, quantity_ordered, quantity_ordered_base from public.construction_purchase_order_lines where po_id=$1 order by line_number', [po])).rows;

const grnPayload = (over: Record<string, unknown> = {}, poId?: string) => ({
  business_id: orgs.A.business,
  po_id: poId ?? over.po_id,
  receipt_date: DAY,
  ...over,
});
const recordGrn = (c: C, payload: Record<string, unknown>, k: string = ckey()) =>
  rpc(c, 'select public.record_construction_goods_receipt($1::jsonb,$2::uuid) r', [JSON.stringify(payload), k]) as Promise<any>;
const grnLines = async (c: C, grn: string) =>
  (await c.query(`select id, line_number, product_id, uom, quantity_received, quantity_accepted, quantity_rejected,
                          quantity_quarantined, quantity_disputed, received_base, accepted_base, rejected_base,
                          quarantined_base, disputed_base, over_receipt_exception
                     from public.construction_goods_receipt_lines where grn_id=$1 order by line_number`, [grn])).rows;

/** An authorized PO with one 10 BAG line at unit price 900, ready for receiving. */
async function authorizedPo(c: C, over: Record<string, unknown> = {}) {
  const po = await createPo(c, poPayload(over));
  await as(c, identities.A_branch_manager.id);
  await authorizePo(c, po.id);
  await as(c, identities.A_owner.id);
  const [line] = await poLines(c, po.id);
  return { po, line };
}

/** An authorized PO plus a receipt of exactly `quantity` accepted, ready to match. */
async function freshReceipt(c: C, opts: { quantity: number; currency?: string } = { quantity: 5 }) {
  const over: Record<string, unknown> = { lines: [{ product_id: P.A.productBag, uom: 'BAG', quantity_ordered: opts.quantity }] };
  if (opts.currency) over.currency = opts.currency;
  const { po, line } = await authorizedPo(c, over);
  const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: opts.quantity, quantity_accepted: opts.quantity }] }));
  const [grnLine] = await grnLines(c, grn.id);
  return { po, line, grn, grnLine };
}

/** Register the bill reference, match it to a receipt line and claim the cost. */
async function matchedCostBasis(c: C, grnLineId: string, bill: { expense: string; line: string }, quantity: number, billUom = 'BAG') {
  await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [bill.expense]);
  if (billUom !== 'BAG') {
    await match(c, matchPayload({ grn_line_id: grnLineId, expense_line_id: bill.line, bill_uom: billUom, bill_quantity: quantity, receipt_quantity: quantity }));
  } else {
    await match(c, matchPayload({ grn_line_id: grnLineId, expense_line_id: bill.line, bill_quantity: quantity, receipt_quantity: quantity }));
  }
  return rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
    [grnLineId, bill.line, quantity, 'R13 supplier bill file', ckey()]) as Promise<any>;
}

/** A supplier bill (existing expenses/expense_lines contract) for business A. */
async function supplierBill(c: C, over: Record<string, unknown> = {}) {
  const cols = { reference: `R13-SUP-INV-${ck}` as string | null, contact: P.A.supplier as string | null, product: P.A.productBag as string | null, quantity: 10, unit_price: 900, tax_code: 'none', tax_rate: 0, tax_amount: 0, discount_amount: 0, discount_percent: 0, currency: 'MWK', exchange_rate: 1, rate_is_stale: false, functional_amount: null as number | null, original_amount: null as number | null, ...over };
  // IAS 21 paragraph 21: the functional amount is the original amount at the rate
  // recorded for the transaction date, so the fixture must stay internally
  // coherent or the cost-basis controls (correctly) refuse it.
  const originalAmount = (cols.original_amount ?? cols.quantity * cols.unit_price) as number;
  const functionalAmount = (cols.functional_amount ?? originalAmount * (cols.exchange_rate as number)) as number;
  await su(c);
  const expense = (await c.query(
    `insert into public.expenses(business_id, expense_number, expense_type, status, expense_date, currency, exchange_rate,
       original_currency, original_amount, functional_currency, functional_amount, rate_date, rate_is_stale, subtotal,
       vat_amount, wht_amount, total_amount, amount_paid, contact_id, branch_id, reference)
     values($1,$2,'bill','draft',$3,$4,$5,$4,$6,'MWK',$7,$3,$8,$6,0,0,$6,0,$9,$10,$11) returning id`,
    [orgs.A.business, `R13-BILL-${ck}`, DAY, cols.currency, cols.exchange_rate, originalAmount, functionalAmount,
      cols.rate_is_stale, cols.contact, orgs.A.branch, cols.reference])).rows[0].id as string;
  const line = (await c.query(
    `insert into public.expense_lines(business_id, expense_id, line_number, description, quantity, unit_price,
       discount_percent, discount_amount, tax_code, tax_rate, tax_amount, line_total, product_id)
     values($1,$2,1,'R13 construction materials',$3,$4,$5,$6,$7::tax_code,$8,$9,$10,$11) returning id`,
    [orgs.A.business, expense, cols.quantity, cols.unit_price, cols.discount_percent, cols.discount_amount,
      cols.tax_code, cols.tax_rate, cols.tax_amount, cols.quantity * cols.unit_price + Number(cols.tax_amount), cols.product])).rows[0].id as string;
  await as(c, identities.A_owner.id);
  return { expense, line };
}

/** The ledger/inventory effects a construction command must never have. */
const ledgerState = async (c: C) => {
  await su(c);
  const row = (await c.query(
    `select
       (select count(*) from public.journal_entries where business_id=$1) as journals,
       (select count(*) from public.stock_movements where business_id=$1) as movements,
       (select coalesce(sum(quantity_on_hand),0) from public.inventory_balances where business_id=$1) as on_hand`,
    [orgs.A.business])).rows[0];
  await as(c, identities.A_owner.id);
  return { journals: Number(row.journals), movements: Number(row.movements), on_hand: Number(row.on_hand) };
};

// ═══════════════════════════ AUTHORIZATION ══════════════════════════════════

test(meta('CP.CAPABILITY.EXPLICIT-GRANTS', 'Operation authority comes only from an explicit capability grant plus active membership: an active member holding no grant, a cashier, an accountant, a viewer and anon are all refused 42501 on create/authorize/receive/match/policy, while a grantee succeeds; role names alone grant nothing'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_viewer.id, async (c: C) => {
    await failsWith(c, () => createPo(c, poPayload()), ['42501'], /capability has not been granted/);
    await failsWith(c, () => rpc(c, 'select public.record_construction_goods_receipt($1::jsonb,$2::uuid) r', [JSON.stringify(grnPayload({ po_id: orgs.A.business })), ckey()]), ['42501']);
    await failsWith(c, () => rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r', [orgs.A.business, 'x', 'y']), ['42501']);
    await failsWith(c, () => rpc(c, 'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, orgs.A.branch, orgs.A.location, 'R13-X', 'R13 x', 'R13-P']), ['42501']);
  });
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await failsWith(c, () => createPo(c, poPayload()), ['42501']);
  });
  await db.asRole('authenticated', identities.A_accountant.id, async (c: C) => {
    // A senior role name is still not authority for an operation.
    await failsWith(c, () => createPo(c, poPayload()), ['42501']);
    await failsWith(c, () => rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_viewer.id, CAP.billMatch, 'R13 attempt']), ['42501'], /owner or an admin/);
  });
  await db.asRole('anon', null, async (c: C) => {
    // anon cannot even execute the command: EXECUTE is revoked from public/anon.
    await failsWith(c, () => createPo(c, poPayload()), ['42501'], /permission denied for function/);
    await failsWith(c, () => c.query('select count(*) from public.construction_purchase_orders'), ['42501'], /permission denied/);
  });
  // A capability holder is refused the operation they were NOT granted.
  await db.asRole('authenticated', identities.A_stock_clerk.id, async (c: C) => {
    const po = await createPo(c, poPayload());
    expect(po.status).toBe('draft');
    await failsWith(c, () => authorizePo(c, po.id), ['42501'], /procurement.po.authorize/);
    await failsWith(c, () => rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 reason', 'R13 evidence']), ['42501']);
    await failsWith(c, () => rpc(c, 'select public.post_construction_receipt_movement($1) r', [po.id]), ['42501']);
    // Recording receipts is not authority to consume what was received.
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'BAG', quantity: 1,
      issue_date: DAY, evidence_reference: 'R13 requisition' }), ckey()]), ['42501'], /procurement.material.issue/);
  });
  // Grant governance: self-grant, non-member, cross-tenant member and empty reason
  // are all refused; a revoked grant stops working immediately.
  await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
    await failsWith(c, () => rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_admin.id, CAP.billMatch, 'R13 self appointment']), ['22023'], /cannot grant .* to yourself/);
    await failsWith(c, () => rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, '13000000-0000-4000-8000-000000009999', CAP.billMatch, 'R13 outsider']), ['22023'], /not an active member/);
    await failsWith(c, () => rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.B_stock_clerk.id, CAP.billMatch, 'R13 cross tenant']), ['22023'], /not an active member/);
    await failsWith(c, () => rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_branch_manager.id, 'procurement.not.a.capability', 'R13 unknown']), ['22023'], /Unknown construction/);
    await failsWith(c, () => rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_branch_manager.id, CAP.billMatch, '   ']), ['22023'], /written reason/);

    const granted = await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_branch_manager.id, CAP.billMatch, 'R13 temporary covering appointment']);
    expect(granted.idempotent).toBe(false);
    const again = await rpc(c, 'select public.grant_construction_procurement_capability($1,$2,$3,$4) r',
      [orgs.A.business, identities.A_branch_manager.id, CAP.billMatch, 'R13 temporary covering appointment']);
    expect(again.idempotent).toBe(true);
    const revoked = await rpc(c, 'select public.revoke_construction_procurement_capability($1,$2) r',
      [granted.id, 'R13 covering appointment ended']);
    expect(revoked.idempotent).toBe(false);
    expect((await rpc(c, 'select public.revoke_construction_procurement_capability($1,$2) r',
      [granted.id, 'R13 covering appointment ended'])).idempotent).toBe(true);
    await failsWith(c, () => rpc(c, 'select public.revoke_construction_procurement_capability($1,$2) r',
      ['00000000-0000-4000-8000-000000000000', 'R13 unknown grant']), ['42501'], /not found/);
  });
  await db.asRole('authenticated', identities.A_branch_manager.id, async (c: C) => {
    await failsWith(c, () => createPo(c, poPayload()), ['42501'], /procurement.po.manage/);
    const caps = (await c.query('select public.construction_procurement_capabilities_for($1) c', [orgs.A.business])).rows[0].c as string[];
    expect(caps).not.toContain(CAP.billMatch);
  });
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const caps = (await c.query('select public.construction_procurement_capabilities_for($1) c', [orgs.A.business])).rows[0].c as string[];
    expect(caps.sort()).toEqual(Object.values(CAP).sort());
    await failsWith(c, () => c.query('insert into public.construction_procurement_grants(business_id,user_id,capability,granted_by,grant_reason) values($1,$2,$3,$4,$5)',
      [orgs.A.business, identities.A_viewer.id, CAP.poManage, identities.A_owner.id, 'R13 direct write']), ['42501'], /permission denied/);
  });
});

test(meta('CP.SCOPE.TENANT-BRANCH-FORGERY', 'Business, branch, project and site scope are preserved: a forged site, a site/branch/location of another tenant, a supplier of another tenant, a PO of another tenant and a cross-branch PO are all refused, the caller cannot supply the receipt location at all, and RLS grants reads only inside the caller’s business'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    // Forged and foreign identifiers.
    await failsWith(c, () => createPo(c, poPayload({ site_id: '00000000-0000-4000-8000-000000000000' })), ['42501'], /does not belong to this business/);
    await failsWith(c, () => createPo(c, poPayload({ supplier_contact_id: orgs.B.customer })), ['22023'], /active supplier contact/);
    await failsWith(c, () => createPo(c, poPayload({ supplier_contact_id: '00000000-0000-4000-8000-000000000000' })), ['22023']);
    await failsWith(c, () => createPo(c, poPayload({ site_id: P.B.site1 })), ['42501'], /does not belong to this business/);
    await failsWith(c, () => createPo(c, poPayload({ business_id: orgs.B.business })), ['42501'], /not an active member/);
    await failsWith(c, () => createPo(c, poPayload({ site_id: 'not-a-uuid' })), ['22023'], /valid identifier/);
    await failsWith(c, () => createPo(c, poPayload({ lines: [] })), ['22023'], /at least one line/);
    await failsWith(c, () => createPo(c, poPayload({ lines: [{ product_id: P.B.productBag, uom: 'BAG', quantity_ordered: 5 }] })), ['42501'], /does not belong to this business/);

    // The PO inherits branch, project and site from the registered mapping.
    const po = await createPo(c, poPayload());
    const row = (await c.query('select o.branch_id, o.site_id, o.project_ref from public.construction_purchase_orders o where o.id=$1', [po.id])).rows[0];
    expect(row.project_ref).toBe('R13-PROJECT-1');
    expect(row.site_id).toBe(P.A.site1);
    expect(row.branch_id).toBe(orgs.A.branch);

    // A receipt declares no location, branch or site: only the purchase order.
    await as(c, identities.A_branch_manager.id);
    await authorizePo(c, po.id);
    await as(c, identities.A_owner.id);
    const forged = await failsWith(c, () => recordGrn(c, grnPayload({
      po_id: po.id, site_id: P.A.site2, location_id: P.A.location2, branch_id: orgs.A.branch2,
      lines: [{ po_line_id: '00000000-0000-4000-8000-000000000000', quantity_received: 1, quantity_accepted: 1 }],
    })), ['42501'], /does not belong to this purchase order/);
    expect(forged.message).toBeTruthy();

    // Cross-branch: a branch-scoped authorizer cannot authorize a PO raised for
    // another branch (the owner, who is organisation-wide, can).
    await as(c, identities.A_admin.id);
    const po2 = await createPo(c, poPayload({ site_id: P.A.site2 }));
    await as(c, identities.A_branch_manager.id);
    await failsWith(c, () => authorizePo(c, po2.id), ['42501'], /access to that branch/);
    await as(c, identities.A_owner.id);
    await authorizePo(c, po2.id);
    // ... and a branch-scoped receiver cannot receive it either.
    await as(c, identities.A_stock_clerk.id);
    const [line2] = await poLines(c, po2.id);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po2.id, lines: [{ po_line_id: line2.id, quantity_received: 1, quantity_accepted: 1 }] })), ['42501'], /access to that branch|access to that inventory location/);

    // The database guard refuses an out-of-band receipt row whose site, branch or
    // location is not exactly the PO's, even for a privileged writer.
    await su(c);
    await failsWith(c, () => c.query(
      `insert into public.construction_goods_receipt_notes(business_id,branch_id,site_id,location_id,project_ref,po_id,grn_number,receipt_date,client_key,created_by)
       values($1,$2,$3,$4,$5,$6,'R13-FORGED',$7,gen_random_uuid(),$8)`,
      [orgs.A.business, orgs.A.branch2, P.A.site2, P.A.location2, 'R13-PROJECT-2', po.id, DAY, identities.A_owner.id]),
    ['22023'], /must be exactly those of its purchase order/);
    await as(c, identities.A_owner.id);

    // RLS: reads stay inside the caller's business, and a foreign row is invisible.
    const own = await count(c, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.A.business]);
    expect(own).toBeGreaterThan(0);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.B.business])).toBe(0);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_orders where id=$1', [po2.id])).toBe(1);
    // Business B really does have a purchase order (it is not merely empty), and
    // A_owner cannot see it even by primary key.
    expect(await suCount(c, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.B.business])).toBe(1);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_orders where id=$1', [P.B.po])).toBe(0);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_order_lines where po_id=$1', [P.B.po])).toBe(0);
    // No write path through the tables at all.
    await failsWith(c, () => c.query('update public.construction_purchase_orders set status=$1 where id=$2', ['authorized', po.id]), ['42501']);
    await failsWith(c, () => c.query('delete from public.construction_purchase_orders where id=$1', [po.id]), ['42501']);
    await failsWith(c, () => c.query('insert into public.construction_goods_receipt_lines(business_id,grn_id,line_number,po_line_id,product_id,uom,quantity_received,received_base) values($1,gen_random_uuid(),1,$2,$3,$4,1,1)',
      [orgs.A.business, '00000000-0000-4000-8000-000000000000', P.A.productBag, 'BAG']), ['42501']);
  });
  await db.asRole('authenticated', identities.A_viewer.id, async (c: C) => {
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.B.business])).toBe(0);
  });
  await db.asRole('anon', null, async (c: C) => {
    await failsWith(c, () => c.query('select count(*) from public.construction_purchase_orders'), ['42501'], /permission denied/);
  });
});

// ═══════════════════════════ PURCHASE ORDERS ═══════════════════════════════

test(meta('CP.PO.AUTHORIZES-PROCUREMENT-ONLY', 'A draft PO authorizes nothing: receiving against it is refused 22023; authorization needs a different capability holder and a different person (self-authorization refused); authorizing creates no stock movement, no journal entry and no inventory change; replay is idempotent; a PO with a receipt cannot be cancelled'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_stock_clerk.id, async (c: C) => {
    const before = await ledgerState(c);
    const po = await createPo(c, poPayload());
    expect(po.idempotent).toBe(false);

    // Receiving against a draft is refused.
    const [line] = await poLines(c, po.id);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 1, quantity_accepted: 1 }] })),
      ['22023'], /only be recorded against an authorized purchase order/);
    // A delivery note against a draft is likewise evidence-invalid.
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'R13-DN-DRAFT', document_date: DAY,
      evidence_reference: 'R13 synthetic DN file', lines: [{ po_line_id: line.id, uom: 'BAG', quantity_declared: 5 }],
    }), ckey()]), ['22023'], /authorized purchase order/);

    // A PO line cannot be added or changed once the order leaves draft.
    await as(c, identities.A_branch_manager.id);
    await authorizePo(c, po.id);
    await as(c, identities.A_stock_clerk.id);
    await su(c);
    await failsWith(c, () => c.query(
      'insert into public.construction_purchase_order_lines(business_id,po_id,line_number,product_id,uom,quantity_ordered,quantity_ordered_base) values($1,$2,9,$3,$4,1,1)',
      [orgs.A.business, po.id, P.A.productBag, 'BAG']), ['22023'], /only be changed while it is a draft/);
    await as(c, identities.A_stock_clerk.id);

    const after = await ledgerState(c);
    expect(after).toEqual(before);
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where business_id=$1 and source_type in ('construction_grn','construction_po')`, [orgs.A.business])).toBe(0);
  });

  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const before = await ledgerState(c);
    const po = await createPo(c, poPayload());
    // Four eyes: the creator may not authorize their own order.
    await failsWith(c, () => authorizePo(c, po.id), ['22023'], /different person/);
    await su(c);
    const second = await createPo(c, poPayload());
    await su(c);
    await as(c, identities.A_branch_manager.id);
    const authorized = await authorizePo(c, second.id);
    expect(authorized.status).toBe('authorized');
    expect(authorized.idempotent).toBe(false);
    expect((await authorizePo(c, second.id)).idempotent).toBe(true);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_order_events where po_id=$1 and action=$2', [second.id, 'authorized'])).toBeGreaterThan(0);
    // Authorizing changed no ledger state.
    const after = await ledgerState(c);
    expect(after).toEqual(before);

    // Cancellation: reason required, capability required, refused once received.
    await as(c, identities.A_accountant.id);
    await failsWith(c, () => rpc(c, 'select public.cancel_construction_purchase_order($1,$2) r', [po.id, 'R13 stop']), ['42501']);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.cancel_construction_purchase_order($1,$2) r', [po.id, '  ']), ['22023'], /written reason/);
    const cancelled = await rpc(c, 'select public.cancel_construction_purchase_order($1,$2) r', [po.id, 'R13 no longer required']);
    expect(cancelled.status).toBe('cancelled');
    expect((await rpc(c, 'select public.cancel_construction_purchase_order($1,$2) r', [po.id, 'R13 no longer required'])).idempotent).toBe(true);
    await failsWith(c, () => authorizePo(c, po.id), ['22023'], /cancelled purchase order/);

    const [line2] = await poLines(c, second.id);
    await as(c, identities.A_stock_clerk.id);
    await recordGrn(c, grnPayload({ po_id: second.id, lines: [{ po_line_id: line2.id, quantity_received: 2, quantity_accepted: 2 }] }));
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.cancel_construction_purchase_order($1,$2) r', [second.id, 'R13 try to cancel a received order']),
      ['22023'], /already has a goods receipt/);
  });
});

// ═══════════════════════════ EXPLICIT UOM ══════════════════════════════════

test(meta('CP.UOM.EXPLICIT-CONVERSION-ONLY', 'A quantity only reaches the product base unit through an exact base unit match or an explicit, evidenced, product-specific conversion: a product with no declared base unit, a unit with no conversion, a foreign product’s conversion and a chained conversion are all refused 22023, and a stored base quantity that does not match the conversion is rejected by the database guard'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    // No declared base unit at all.
    await failsWith(c, () => createPo(c, poPayload({ lines: [{ product_id: P.A.productNoUom, uom: 'BAG', quantity_ordered: 1 }] })),
      ['22023'], /no declared base unit/);
    // Base unit match is accepted exactly, and case-insensitively.
    const exact = await createPo(c, poPayload({ lines: [{ product_id: P.A.productBag, uom: 'bag', quantity_ordered: 2 }] }));
    const [exactLine] = await poLines(c, exact.id);
    expect(Number(exactLine.quantity_ordered_base)).toBe(2);
    expect(exactLine.uom).toBe('BAG');
    // Registered conversion: 3 cartons × 12 = 36 bags.
    const converted = await createPo(c, poPayload({ lines: [{ product_id: P.A.productBag, uom: 'ctn', quantity_ordered: 3 }] }));
    const [convertedLine] = await poLines(c, converted.id);
    expect(Number(convertedLine.quantity_ordered_base)).toBe(36);
    // No conversion for this unit, and no conversion for this product.
    await failsWith(c, () => createPo(c, poPayload({ lines: [{ product_id: P.A.productBag, uom: 'SACK', quantity_ordered: 1 }] })),
      ['22023'], /no approved conversion/);
    await failsWith(c, () => createPo(c, poPayload({ lines: [{ product_id: P.A.productSack, uom: 'CTN', quantity_ordered: 1 }] })),
      ['22023'], /no approved conversion/, );
    // The conversion is product-specific: another product never inherits it.
    expect(await count(c, 'select count(*)::int n from public.construction_product_uom_conversions where business_id=$1 and product_id=$2',
      [orgs.A.business, P.A.productSack])).toBe(0);

    // Registering a conversion: capability, target unit, positive factor and evidence.
    await failsWith(c, () => rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, P.A.productBag, 'PAL', 'BAG', 0, 'R13 evidence']), ['22023'], /greater than zero/);
    await failsWith(c, () => rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, P.A.productBag, 'PAL', 'BOX', 4, 'R13 evidence']), ['22023'], /target the product base unit/);
    await failsWith(c, () => rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, P.A.productBag, 'PAL', 'BAG', 4, '   ']), ['22023'], /evidence reference/);
    await failsWith(c, () => rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, P.A.productNoUom, 'PAL', 'BAG', 4, 'R13 evidence']), ['22023'], /Declare the product base unit/);
    await failsWith(c, () => rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, P.B.productBag, 'PAL', 'BAG', 4, 'R13 evidence']), ['42501'], /does not belong to this business/);
  });
  await db.asRole('authenticated', identities.A_stock_clerk.id, async (c: C) => {
    await failsWith(c, () => rpc(c, 'select public.register_construction_product_uom_conversion($1,$2,$3,$4,$5,$6) r',
      [orgs.A.business, P.A.productSack, 'CTN', 'BAG', 2, 'R13 evidence']), ['42501']);
  });
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    // A privileged writer still cannot store a base quantity the conversion does not support.
    await su(c);
    const po = (await c.query(
      `insert into public.construction_purchase_orders(business_id,branch_id,site_id,project_ref,supplier_contact_id,po_number,currency,client_key,created_by)
       values($1,$2,$3,'R13-PROJECT-1',$4,'R13-UOM-GUARD','MWK',gen_random_uuid(),$5) returning id`,
      [orgs.A.business, orgs.A.branch, P.A.site1, P.A.supplier, identities.A_owner.id])).rows[0].id as string;
    await failsWith(c, () => c.query(
      `insert into public.construction_purchase_order_lines(business_id,po_id,line_number,product_id,uom,quantity_ordered,quantity_ordered_base)
       values($1,$2,1,$3,'CTN',2,999)`, [orgs.A.business, po, P.A.productBag]), ['22023'], /does not match the explicit UOM conversion/);
    await as(c, identities.A_owner.id);
  });
});

// ═══════════════════════════ DELIVERY NOTES (EVIDENCE ONLY) ═════════════════

test(meta('CP.EVIDENCE.DELIVERY-NOTE-ONLY', 'A supplier delivery note is recorded as evidence with no stock movement, no journal entry and no inventory change; a repeated supplier note number is refused and can only be recorded through the evidenced, capability-gated exception path that names the note it duplicates'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const before = await ledgerState(c);
    const { po, line } = await authorizedPo(c);

    const dn = await rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'R13 DN 0042', document_date: DAY,
      evidence_reference: 'R13 synthetic scanned delivery note', document_received_by: 'R13 site clerk',
      lines: [{ po_line_id: line.id, uom: 'CTN', quantity_declared: 1 }],
    }), ckey()]);
    expect(dn.stock_effect).toBe('none');
    expect(dn.journal_effect).toBe('none');
    const stored = (await c.query('select normalized_reference, quantity_declared_base from public.construction_delivery_note_lines l join public.construction_delivery_notes n on n.id=l.delivery_note_id where n.id=$1', [dn.id])).rows[0];
    expect(stored.normalized_reference).toBe('R13 DN 0042');
    expect(Number(stored.quantity_declared_base)).toBe(12); // 1 CTN × 12 BAG, explicit conversion

    // Missing evidence reference and an unknown PO line are refused.
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'R13 DN 0043', document_date: DAY,
      lines: [{ po_line_id: line.id, uom: 'BAG', quantity_declared: 1 }],
    }), ckey()]), ['22023'], /evidence reference/);
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'R13 DN 0044', document_date: DAY,
      evidence_reference: 'R13 file', lines: [{ po_line_id: '00000000-0000-4000-8000-000000000000', uom: 'BAG', quantity_declared: 1 }],
    }), ckey()]), ['42501'], /does not belong to this purchase order/);

    // A repeated supplier note number for the same supplier is refused...
    const duplicate = async (k: string) => rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: '  r13   dn 0042 ', document_date: DAY,
      evidence_reference: 'R13 file', lines: [{ po_line_id: line.id, uom: 'BAG', quantity_declared: 1 }],
    }), k]);
    await failsWith(c, () => duplicate(ckey()), ['22023'], /supplier-delivery-note-duplicate/);
    // ... including when the exception fields are supplied but the capability is absent.
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note_exception($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'r13 dn 0042', document_date: DAY,
      evidence_reference: 'R13 file', exception_of: dn.id, exception_reason: 'R13 supplier reissued the note',
      exception_evidence: 'R13 supplier email 2026-10-16', lines: [{ po_line_id: line.id, uom: 'BAG', quantity_declared: 1 }],
    }), ckey()]), ['42501'], /procurement.exception.authorize/);

    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note_exception($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'r13 dn 0042', document_date: DAY,
      evidence_reference: 'R13 file', exception_of: dn.id, exception_reason: 'R13 supplier reissued the note',
      lines: [{ po_line_id: line.id, uom: 'BAG', quantity_declared: 1 }],
    }), ckey()]), ['22023'], /evidence reference are required/);
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note_exception($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'r13 dn 0099', document_date: DAY,
      evidence_reference: 'R13 file', exception_of: dn.id, exception_reason: 'R13 wrong note named',
      exception_evidence: 'R13 supplier email', lines: [{ po_line_id: line.id, uom: 'BAG', quantity_declared: 1 }],
    }), ckey()]), ['22023'], /same delivery note number/);

    const excepted = await rpc(c, 'select public.record_construction_delivery_note_exception($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'r13 dn 0042', document_date: DAY,
      evidence_reference: 'R13 reissued document file', exception_of: dn.id,
      exception_reason: 'R13 supplier reissued the same note number for a second delivery',
      exception_evidence: 'R13 supplier email thread 2026-10-16', lines: [{ po_line_id: line.id, uom: 'CTN', quantity_declared: 1 }],
    }), ckey()]);
    expect(excepted.exception_of).toBe(dn.id);
    expect(await count(c, 'select count(*)::int n from public.construction_delivery_notes where supplier_contact_id=$1', [P.A.supplier])).toBe(2);

    // Evidence only: nothing moved and nothing posted.
    const after = await ledgerState(c);
    expect(after).toEqual(before);
  });
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const { po } = await authorizedPo(c);
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.B.business, po_id: po.id, delivery_note_number: 'R13 DN X', document_date: DAY,
      evidence_reference: 'R13 file', lines: [],
    }), ckey()]), ['42501'], /not an active member/);
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'R13 DN Y', document_date: DAY, evidence_reference: 'R13 file', lines: [],
    }), ckey()]), ['22023'], /at least one line/);
    await failsWith(c, () => rpc(c, 'select public.record_construction_delivery_note($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, po_id: po.id, delivery_note_number: 'R13 DN Z', document_date: '2026-02-30', evidence_reference: 'R13 file', lines: [],
    }), ckey()]), ['22023']);
  });
});

// ═══════════════════════════ GOODS RECEIPT NOTES ═══════════════════════════

test(meta('CP.GRN.CLASSIFICATION-AND-HOLDS', 'A GRN distinguishes received, accepted, rejected, quarantined and disputed quantities, refuses an unclassified remainder 22023, requires an evidenced hold for every rejected/quarantined/disputed quantity, refuses a hold that exceeds or does not match its bucket, supports partial receipts against one PO and gates an over-receipt behind the exception capability with written reason and evidence'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const before = await ledgerState(c);
    const { po, line } = await authorizedPo(c);

    // The whole received quantity must be classified.
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 6, quantity_accepted: 5 }] })),
      ['22023'], /receipt-classification-incomplete/);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 6, quantity_accepted: 7 }] })),
      ['22023'], /receipt-classification-incomplete/);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 0, quantity_accepted: 0 }] })),
      ['22023'], /greater than zero/);
    // A rejection without an evidenced hold is refused, as is an incomplete hold total.
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [
      { po_line_id: line.id, quantity_received: 6, quantity_accepted: 5, quantity_rejected: 1 }] })),
      ['22023'], /require an explicit hold/);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [
      { po_line_id: line.id, quantity_received: 6, quantity_accepted: 5, quantity_rejected: 1,
        holds: [{ hold_type: 'rejected', quantity: 1, reason: 'R13 damaged', evidence_reference: 'R13 photo' },
                { hold_type: 'rejected', quantity: 0.5, reason: 'R13 damaged', evidence_reference: 'R13 photo' }] }] })),
      ['22023']);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [
      { po_line_id: line.id, quantity_received: 6, quantity_accepted: 5, quantity_rejected: 1,
        holds: [{ hold_type: 'quarantined', quantity: 1, reason: 'R13 inspection', evidence_reference: 'R13 photo' }] }] })),
      ['22023'], /no quarantined quantity/);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [
      { po_line_id: line.id, quantity_received: 6, quantity_accepted: 5, quantity_rejected: 1,
        holds: [{ hold_type: 'rejected', quantity: 1, reason: 'R13 damaged' }] }] })),
      ['22023'], /hold evidence reference/);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [
      { po_line_id: line.id, quantity_received: 6, quantity_accepted: 5, quantity_rejected: 1, holds: 'not-an-array' }] })),
      ['22023']);

    // Classifying a rejection is an inspection act: recording is not inspecting.
    const revoked = await rpc(c, `with g as (
        select id from public.construction_procurement_grants
         where business_id=$1 and user_id=$2 and capability='procurement.receipt.inspect' and revoked_at is null)
      select public.revoke_construction_procurement_capability(g.id, 'R13 inspection authority withdrawn') r from g`,
      [orgs.A.business, identities.A_stock_clerk.id]);
    expect(revoked).toBeTruthy();
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [{
      po_line_id: line.id, quantity_received: 2, quantity_accepted: 1, quantity_rejected: 1,
      holds: [{ hold_type: 'rejected', quantity: 1, reason: 'R13 torn bags', evidence_reference: 'R13 site photo' }] }] })),
    ['42501'], /receipt-inspection-denied/);
    await as(c, identities.A_owner.id);

    // A full five-way classification with holds, across a partial receipt.
    const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{
      po_line_id: line.id, quantity_received: 6, quantity_accepted: 3, quantity_rejected: 1, quantity_quarantined: 1, quantity_disputed: 1,
      holds: [
        { hold_type: 'rejected', quantity: 1, reason: 'R13 torn bags on arrival', evidence_reference: 'R13 site photo 1' },
        { hold_type: 'quarantined', quantity: 1, reason: 'R13 awaiting quality inspection', evidence_reference: 'R13 inspection log' },
        { hold_type: 'disputed', quantity: 1, reason: 'R13 supplier paperwork mismatch', evidence_reference: 'R13 correspondence' },
      ] }] }));
    expect(grn.stock_effect).toBe('none');
    expect(grn.journal_effect).toBe('none');
    expect(grn.posting).toBe('not-approved');
    const [stored] = await grnLines(c, grn.id);
    expect({
      received: Number(stored.quantity_received), accepted: Number(stored.quantity_accepted),
      rejected: Number(stored.quantity_rejected), quarantined: Number(stored.quantity_quarantined),
      disputed: Number(stored.quantity_disputed),
    }).toEqual({ received: 6, accepted: 3, rejected: 1, quarantined: 1, disputed: 1 });
    expect(Number(stored.accepted_base)).toBe(3);
    expect(await count(c, 'select count(*)::int n from public.construction_goods_receipt_holds where grn_line_id=$1', [stored.id])).toBe(3);

    // Hold release: capability + written reason, idempotent replay.
    const hold = (await c.query('select id from public.construction_goods_receipt_holds where grn_line_id=$1 and hold_type=$2', [stored.id, 'quarantined'])).rows[0].id as string;
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => rpc(c, 'select public.release_construction_receipt_hold($1,$2) r', [hold, 'R13 released']), ['42501']);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.release_construction_receipt_hold($1,$2) r', [hold, '  ']), ['22023'], /written reason/);
    expect((await rpc(c, 'select public.release_construction_receipt_hold($1,$2) r', [hold, 'R13 inspection passed'])).status).toBe('released');
    expect((await rpc(c, 'select public.release_construction_receipt_hold($1,$2) r', [hold, 'R13 inspection passed'])).idempotent).toBe(true);
    await su(c);
    const held = (await c.query('select status, released_by, release_reason from public.construction_goods_receipt_holds where id=$1', [hold])).rows[0];
    expect(held.status).toBe('released');
    expect(held.released_by).toBe(identities.A_owner.id);
    await as(c, identities.A_owner.id);

    // Partial receipt: a second GRN against the same line.
    const grn2 = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 2, quantity_accepted: 2 }] }));
    expect(grn2.id).not.toBe(grn.id);
    expect(await count(c, 'select count(*)::int n from public.construction_goods_receipt_lines where po_line_id=$1', [line.id])).toBe(2);

    // Over-receipt (3 + 2 accepted is fine; a further 6 would exceed the 10 ordered).
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 6, quantity_accepted: 6 }] })),
      ['22023'], /over-receipt-exception-required/);
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [{
      po_line_id: line.id, quantity_received: 6, quantity_accepted: 6,
      over_receipt_reason: 'R13 supplier delivered a full extra pallet', over_receipt_evidence: 'R13 delivery note' }] })),
      ['42501'], /over-receipt-exception-denied/);
    await as(c, identities.A_owner.id);
    const over = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{
      po_line_id: line.id, quantity_received: 6, quantity_accepted: 6,
      over_receipt_reason: 'R13 supplier delivered a full extra pallet', over_receipt_evidence: 'R13 delivery note 0042' }] }));
    const [overLine] = await grnLines(c, over.id);
    expect(overLine.over_receipt_exception).toBe(true);

    // Still no inventory or ledger effect anywhere in this test.
    const after = await ledgerState(c);
    expect(after).toEqual(before);
  });
});

// ═══════════════════════════ SUPPLIER REFERENCE ════════════════════════════

test(meta('CP.BILL.REFERENCE-REGISTRY', 'The supplier’s external invoice reference is the EXISTING expenses.reference, registered in a conservative normalized form: a bill with no reference is refused, the same reference for the same supplier is a duplicate, a case/whitespace variant is the same reference, the duplicate is recordable only through the evidenced, capability-gated exception that names the conflicting registration, and no second invoice source is created'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const noRef = await supplierBill(c, { reference: null });
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [noRef.expense]),
      ['22023'], /supplier-reference-missing/);

    const first = await supplierBill(c, { reference: 'INV 001/2026' });
    const registered = await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [first.expense]);
    expect(registered.reference_normalized).toBe('INV 001/2026');
    expect(registered.idempotent).toBe(false);
    expect((await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [first.expense])).idempotent).toBe(true);
    await su(c);
    expect((await c.query('select reference_raw from public.construction_supplier_invoice_references where id=$1', [registered.id])).rows[0].reference_raw).toBe('INV 001/2026');
    await as(c, identities.A_owner.id);

    // A conservative normalization: case and internal whitespace only.
    const second = await supplierBill(c, { reference: '  inv   001/2026 ' });
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [second.expense]),
      ['22023'], /supplier-invoice-reference-duplicate/);
    // A genuinely different reference is not a duplicate.
    const third = await supplierBill(c, { reference: 'INV 002/2026' });
    const thirdReg = await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [third.expense]);
    expect(thirdReg.idempotent).toBe(false);
    // A different supplier may reuse the same supplier-side number.
    const otherSupplier = await supplierBill(c, { reference: 'INV 001/2026', contact: P.A.supplier2 });
    expect((await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [otherSupplier.expense])).idempotent).toBe(false);
    // Punctuation is NOT stripped: over-normalizing could merge two real invoices.
    const punctuation = await supplierBill(c, { reference: 'INV001/2026' });
    expect((await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [punctuation.expense])).idempotent).toBe(false);

    // Exception path: evidenced, capability-gated and must name the conflict.
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [first.expense, registered.id, 'R13 duplicate issued by supplier', 'R13 supplier statement']), ['22023'], /already has a registered/);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      ['00000000-0000-4000-8000-000000000000', registered.id, 'R13 unknown bill', 'R13 statement']), ['42501'], /not belong to this business|not found/);
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [second.expense, registered.id, 'R13 duplicate issued by supplier', 'R13 supplier statement']), ['42501'], /procurement.exception.authorize/);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [second.expense, registered.id, '   ', 'R13 supplier statement']), ['22023'], /written reason and an evidence reference/);
    // A bill cannot be its own duplicate exception.
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [first.expense, registered.id, 'R13 self', 'R13 statement']), ['22023']);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [second.expense, '00000000-0000-4000-8000-000000000000', 'R13 duplicate issued by supplier', 'R13 statement']), ['22023'], /not an active registration/);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [second.expense, thirdReg.id, 'R13 wrong conflict named', 'R13 statement']), ['22023'], /same normalized reference/);
    const excepted = await rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [second.expense, registered.id, 'R13 supplier reissued the same number for a separate delivery', 'R13 supplier statement 2026-10-16']);
    expect(excepted.exception_of).toBe(registered.id);
    await su(c);
    const rows = (await c.query('select status, exception_reason, exception_evidence from public.construction_supplier_invoice_references where id=$1', [excepted.id])).rows[0];
    expect(rows.status).toBe('exception');
    expect(rows.exception_reason).toBeTruthy();
    expect(rows.exception_evidence).toBeTruthy();
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference_exception($1,$2,$3,$4) r',
      [first.expense, excepted.id, 'R13 attempting a second exception for one bill', 'R13 statement']), ['22023'], /already has a registered/);
    // The exception row names the registration it duplicates and keeps its own evidence.
    await su(c);
    const link = (await c.query('select status, exception_of from public.construction_supplier_invoice_references where id=$1', [excepted.id])).rows[0];
    expect(link.status).toBe('exception');
    expect(link.exception_of).toBe(registered.id);
    await as(c, identities.A_owner.id);

    // Scope: another tenant's bill, and a bill that is not a supplier bill.
    await su(c);
    const foreignBill = (await c.query(
      `insert into public.expenses(business_id, expense_number, expense_type, status, expense_date, currency, exchange_rate,
         original_currency, original_amount, functional_currency, functional_amount, rate_date, rate_is_stale, subtotal,
         vat_amount, wht_amount, total_amount, amount_paid, contact_id, reference)
       values($1,'R13-BILL-B','bill','draft',$2,'MWK',1,'MWK',1,'MWK',1,$2,false,1,0,0,1,0,$3,'R13-SUP-INV-B') returning id`,
      [orgs.B.business, DAY, orgs.B.customer])).rows[0].id as string;
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [foreignBill]),
      ['42501'], /not an active member/);
    await su(c);
    const quick = (await c.query(
      `insert into public.expenses(business_id, expense_number, expense_type, status, expense_date, currency, exchange_rate,
         original_currency, original_amount, functional_currency, functional_amount, rate_date, rate_is_stale, subtotal,
         vat_amount, wht_amount, total_amount, amount_paid, reference)
       values($1,'R13-QUICK-1','receipt','paid',$2,'MWK',1,'MWK',1,'MWK',1,$2,false,1,0,0,1,1,'R13-QUICK-REF') returning id`,
      [orgs.A.business, DAY])).rows[0].id as string;
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [quick]),
      ['22023'], /Only a supplier bill/);
    const orphan = await supplierBill(c, { reference: 'INV 777/2026', contact: null });
    await failsWith(c, () => rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [orphan.expense]),
      ['22023'], /Record the supplier/);
    await failsWith(c, () => c.query('update public.construction_supplier_invoice_references set reference_normalized=$1 where id=$2', ['X', registered.id]),
      ['42501']);
  });
});

// ═══════════════════════════ BILL MATCHING (NEVER A RECEIPT) ═══════════════

const matchPayload = (over: Record<string, unknown>) => ({
  business_id: orgs.A.business, bill_uom: 'BAG', ...over,
});
const match = (c: C, payload: Record<string, unknown>, k: string = ckey()) =>
  rpc(c, 'select public.match_construction_bill_line_to_receipt($1::jsonb,$2::uuid) r', [JSON.stringify(payload), k]) as Promise<any>;

test(meta('CP.MATCH.NO-DOUBLE-POST', 'Matching a receipt line to a supplier bill line requires the exact product, the PO’s supplier and a registered supplier reference; a bill whose expense already moved stock through the legacy hook is refused 22023 bill-already-inventoried; split allocations across partial receipts and combined allocations to several bill lines are supported; the receipt and bill caps are enforced; a quantity difference requires the exception capability with reason and evidence; and matching inserts no stock movement and no journal entry'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const before = await ledgerState(c);
    const { po, line } = await authorizedPo(c);
    const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 8, quantity_accepted: 8 }] }));
    const [grnLine] = await grnLines(c, grn.id);

    const bill = await supplierBill(c, { quantity: 8, unit_price: 900 });
    // The reference must be registered first.
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 8, receipt_quantity: 8 })),
      ['22023'], /supplier-reference-not-registered/);
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [bill.expense]);

    // Exact product identity only.
    const wrongProduct = await supplierBill(c, { product: P.A.productOther, reference: 'R13-OTHER-1' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [wrongProduct.expense]);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: wrongProduct.line, bill_quantity: 8, receipt_quantity: 8 })),
      ['22023'], /product-mismatch/);
    // The bill must belong to the purchase order's supplier.
    const wrongSupplier = await supplierBill(c, { contact: P.A.supplier2, reference: 'R13-OTHER-2' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [wrongSupplier.expense]);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: wrongSupplier.line, bill_quantity: 8, receipt_quantity: 8 })),
      ['22023'], /supplier-mismatch/);
    // No exchange-rate rule: a bill raised in another currency is refused outright.
    const usd = await supplierBill(c, { currency: 'USD', reference: 'R13-USD-1' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [usd.expense]);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: usd.line, bill_quantity: 1, receipt_quantity: 1 })),
      ['22023'], /bill-currency-mismatch/);

    // Unknown units and zero quantities are refused.
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_uom: 'SACK', bill_quantity: 8, receipt_quantity: 8 })),
      ['22023'], /no approved conversion/);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 0, receipt_quantity: 1 })),
      ['22023'], /greater than zero/);

    // Caps: the receipt line only has 8 accepted, the bill line only 8.
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 9, receipt_quantity: 9 })),
      ['22023'], /receipt-quantity-exceeded|bill-quantity-exceeded/);

    // Split across partial receipts: 3 now, 5 later.
    const firstKey = ckey();
    const first = await match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 3, receipt_quantity: 3 }), firstKey);
    expect(first.stock_effect).toBe('none');
    expect(first.is_exception).toBe(false);
    const replayed = await match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 3, receipt_quantity: 3 }), firstKey);
    expect(replayed.id).toBe(first.id);
    expect(replayed.idempotent).toBe(true);
    const second = await match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 5, receipt_quantity: 5 }));
    expect(second.is_exception).toBe(false);
    // The bill line is now fully allocated.
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 1, receipt_quantity: 1 })),
      ['22023'], /bill-quantity-exceeded|receipt-quantity-exceeded/);
    // Unit switching on one bill line is refused, so the cap cannot be gamed.
    const combined = await supplierBill(c, { quantity: 24, unit_price: 900, reference: 'R13-COMBINED-1' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [combined.expense]);
    const secondGrn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 2, quantity_accepted: 2 }] }));
    const [grnLine2] = await grnLines(c, secondGrn.id);
    // Combined: one receipt line allocated to two bill lines.
    const combo = await match(c, matchPayload({ grn_line_id: grnLine2.id, expense_line_id: combined.line, bill_quantity: 1, receipt_quantity: 1 }));
    expect(combo.is_exception).toBe(false);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine2.id, expense_line_id: combined.line, bill_uom: 'CTN', bill_quantity: 1, receipt_quantity: 1 })),
      ['22023'], /bill-uom-inconsistent/);

    // A quantity difference is an exception: reason + evidence + capability.
    // 8 + 2 already received; a further 0.5 exceeds the 10 ordered, so this
    // receipt itself carries an authorized, evidenced over-receipt exception.
    const thirdGrn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{
      po_line_id: line.id, quantity_received: 0.5, quantity_accepted: 0.5,
      over_receipt_reason: 'R13 part-load delivered after the final scheduled receipt',
      over_receipt_evidence: 'R13 supplier delivery note 0091' }] }));
    const [grnLine3] = await grnLines(c, thirdGrn.id);
    const shortBill = await supplierBill(c, { quantity: 1, unit_price: 900, reference: 'R13-SHORT-1' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [shortBill.expense]);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine3.id, expense_line_id: shortBill.line, bill_quantity: 1, receipt_quantity: 0.5 })),
      ['22023'], /quantity-exception-required/);
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => match(c, matchPayload({
      grn_line_id: grnLine3.id, expense_line_id: shortBill.line, bill_quantity: 1, receipt_quantity: 0.5,
      exception_reason: 'R13 billed for a full bag, half spilled in transit', exception_evidence: 'R13 site incident report' })),
      ['42501'], /quantity-exception-denied/);
    await as(c, identities.A_owner.id);
    const exception = await match(c, matchPayload({
      grn_line_id: grnLine3.id, expense_line_id: shortBill.line, bill_quantity: 1, receipt_quantity: 0.5,
      exception_reason: 'R13 billed for a full bag, half spilled in transit', exception_evidence: 'R13 site incident report' }));
    expect(exception.is_exception).toBe(true);
    await su(c);
    const stored = (await c.query('select bill_quantity_base, receipt_quantity_base, exception_reason, exception_evidence from public.construction_receipt_bill_allocations where id=$1', [exception.id])).rows[0];
    expect(Number(stored.bill_quantity_base)).toBe(1);
    expect(Number(stored.receipt_quantity_base)).toBe(0.5);
    expect(stored.exception_reason).toBeTruthy();
    await as(c, identities.A_owner.id);

    // NO double post: the legacy stock hook on the bill is detected and refused.
    await su(c);
    await c.query(
      `insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id,created_by)
       values($1,$2,$3,'purchase',$4,1,900,'expense',$5,$6)`,
      [orgs.A.business, P.A.productBag, orgs.A.location, DAY, shortBill.expense, identities.A_owner.id]);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: grnLine3.id, expense_line_id: shortBill.line, bill_quantity: 0.5, receipt_quantity: 0.5 })),
      ['22023'], /bill-already-inventoried/);

    // Matching never moved stock and never posted: only the movement the probe
    // itself inserted above is new.
    const after = await ledgerState(c);
    expect(after.movements).toBe(before.movements + 1);
    expect(after.journals).toBe(before.journals);
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_grn'`, [orgs.A.business])).toBe(0);
  });
});

test(meta('CP.MATCH.CONCURRENT-ALLOCATION', 'Two independent sessions racing to allocate the same accepted receipt quantity serialize on the receipt-line row lock: the first commits 3 of the 5 accepted, the second then re-reads the committed allocation and is denied 22023 receipt-quantity-exceeded, so the accepted quantity is never over-allocated'), async () => {
  ready();
  if (!db.createSecondClient) throw new Blocked('Second-connection harness unavailable');

  // All fixture documents are created and committed first: creating a purchase
  // order in the same business takes a per-business document lock, so two
  // sessions cannot prepare documents simultaneously by design.
  const fixture = await db.commitAsRole('authenticated', identities.A_owner.id, async (c: C) => {
    const { po, line } = await authorizedPo(c);
    const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 5, quantity_accepted: 5 }] }));
    const [grnLine] = await grnLines(c, grn.id);
    const bill = await supplierBill(c, { quantity: 10, unit_price: 900 });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [bill.expense]);
    return { grnLine, bill };
  });
  const { grnLine, bill } = fixture;

  const second = await db.createSecondClient();
  try {
    // Session A opens a transaction and allocates 3 of the 5 accepted, holding the
    // receipt-line row lock without committing.
    await db.beginAsRole('authenticated', identities.A_owner.id);
    const first = await match(db.client as unknown as C,
      matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 3, receipt_quantity: 3 }));
    expect(first.is_exception).toBe(false);

    // Session B asks for 3 of the same 5: each request alone fits, the two together
    // do not. B blocks on A's row lock.
    await second.beginAsRole('authenticated', identities.A_owner.id);
    let loser: { code?: string; message?: string } | undefined;
    const pending = match(second.client as unknown as C,
      matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 3, receipt_quantity: 3 }))
      .then(() => null)
      .catch((e) => { loser = e as { code?: string; message?: string }; return null; });

    await db.commitTx();
    const loserResult = await pending;
    await second.commitTx();

    expect(loserResult).toBeNull();
    expect(loser?.code).toBe('22023');
    expect(loser?.message ?? '').toMatch(/receipt-quantity-exceeded/);
    const total = await suCount(db.client as unknown as C,
      'select coalesce(sum(receipt_quantity_base),0)::numeric n from public.construction_receipt_bill_allocations where grn_line_id=$1', [grnLine.id]);
    expect(Number(total)).toBe(3);
    expect(await suCount(db.client as unknown as C, 'select count(*)::int n from public.construction_receipt_bill_allocations where grn_line_id=$1', [grnLine.id])).toBe(1);
    // The losing session's rollback left no allocation and no stock movement behind.
    expect(await suCount(db.client as unknown as C,
      `select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_grn'`, [orgs.A.business])).toBe(0);
  } finally {
    await db.rollbackTx().catch(() => {});
    await second.rollbackTx();
    await second.close();
  }
});

test(meta('CP.IDEMPOTENCY.CONCURRENT-GRN', 'Two independent sessions submitting the SAME client key produce exactly one goods receipt: the second blocks on the per-business document lock, observes the committed row and returns it as an idempotent replay instead of colliding on the unique index'), async () => {
  ready();
  if (!db.createSecondClient) throw new Blocked('Second-connection harness unavailable');

  const second = await db.createSecondClient();
  try {
    await db.beginAsRole('authenticated', identities.A_owner.id);
    await second.beginAsRole('authenticated', identities.A_owner.id);
    const { po, line } = await authorizedPo(db.client as unknown as C);
    // The PO must be visible to the second session.
    await second.client.query('select 1 from public.construction_purchase_orders where id=$1', [po.id]);
    const sharedKey = ckey();
    const payload = grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 4, quantity_accepted: 4 }] });

    const first = await recordGrn(db.client as unknown as C, payload, sharedKey);
    let replayResult: any = null;
    let replayError: { code?: string; message?: string } | undefined;
    const pending = recordGrn(second.client as unknown as C, payload, sharedKey)
      .then((r) => { replayResult = r; })
      .catch((e) => { replayError = e as { code?: string; message?: string }; });
    await db.commitTx();
    await pending;
    await second.commitTx();
    // Wait for the pending promise to settle.
    await new Promise((resolve) => setTimeout(resolve, 25));
    if (replayError) throw new Error(`Concurrent replay failed: ${replayError.code ?? 'unknown'} ${replayError.message ?? ''}`);
    expect(replayResult.id).toBe(first.id);
    expect(replayResult.idempotent).toBe(true);
    expect(await count(db.client as unknown as C, 'select count(*)::int n from public.construction_goods_receipt_notes where client_key=$1', [sharedKey])).toBe(1);
    expect(await count(db.client as unknown as C, 'select count(*)::int n from public.construction_goods_receipt_lines l join public.construction_goods_receipt_notes g on g.id=l.grn_id where g.client_key=$1', [sharedKey])).toBe(1);
  } finally {
    await db.rollbackTx().catch(() => {});
    await second.rollbackTx();
    await second.close();
  }
});

// ═══════════════════════════ POSTING BOUNDARY ══════════════════════════════

test(meta('CP.POSTING.POLICY-GATED', 'With no approved policy row a receipt cost basis and a receipt movement are both refused 22023 receipt-posting-not-approved and nothing reaches stock; with an approved policy the movement is written through the single shared balance writer, dated in an open period, with no journal entry; a closed period is denied 22023 and never reopened; GL posting is structurally impossible because the policy CHECK forbids it'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const before = await ledgerState(c);
    expect(await count(c, 'select count(*)::int n from public.construction_receipt_posting_policies')).toBe(0);

    const { po, line } = await authorizedPo(c);
    const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 4, quantity_accepted: 4 }] }));
    const [grnLine] = await grnLines(c, grn.id);
    const bill = await supplierBill(c, { quantity: 4, unit_price: 900 });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [bill.expense]);
    await match(c, matchPayload({ grn_line_id: grnLine.id, expense_line_id: bill.line, bill_quantity: 4, receipt_quantity: 4 }));

    // Gate one: no policy row at all.
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [grnLine.id, bill.line, 4, 'R13 bill file', ckey()]), ['22023'], /receipt-posting-not-approved/);
    await failsWith(c, () => rpc(c, 'select public.post_construction_receipt_movement($1) r', [grn.id]), ['22023'], /receipt-posting-not-approved/);
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_grn'`, [orgs.A.business])).toBe(0);

    // Gate two: the policy switch itself.
    await failsWith(c, () => rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, '   ', 'R13 board minute']), ['22023'], /written reason and an evidence reference/);
    await failsWith(c, () => rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 policy', '  ']), ['22023'], /written reason and an evidence reference/);
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 policy', 'R13 board minute']), ['42501']);
    await as(c, identities.A_owner.id);
    const policy = await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 receipt movement policy for the pilot site', 'R13 synthetic board minute 2026-10-16']);
    expect(policy.movement_posting_enabled).toBe(true);
    expect(policy.gl_posting_enabled).toBe(false);

    // GL posting is structurally impossible, even for a privileged writer, and the
    // policy switch cannot be flipped outside its command.
    await su(c);
    // Every mutation of the policy table outside its own command is refused.
    await failsWith(c, () => c.query('update public.construction_receipt_posting_policies set gl_posting_enabled=true where business_id=$1', [orgs.A.business]),
      ['42501'], /append-only/);
    await failsWith(c, () => c.query('update public.construction_receipt_posting_policies set movement_posting_enabled=false where business_id=$1', [orgs.A.business]),
      ['42501'], /append-only/);
    // A directly inserted policy row is refused by the table's own CHECKs: a
    // GL-enabled policy is impossible, and a movement-enabled one needs an approval.
    await failsWith(c, () => c.query(
      `insert into public.construction_receipt_posting_policies(business_id, movement_posting_enabled, gl_posting_enabled, approved_by, approved_at, approved_reason, approved_evidence)
       values($1,true,true,$2,now(),'R13 direct policy','R13 direct policy evidence')`, [orgs.B.business, identities.A_owner.id]),
    ['23514'], /chk_crpp_gl/);
    // A movement-enabled policy with no recorded approver is refused by the table.
    await failsWith(c, () => c.query(
      `insert into public.construction_receipt_posting_policies(business_id, movement_posting_enabled, cost_basis_source, gl_posting_enabled, approved_by, approved_at, approved_reason, approved_evidence)
       values($1,true,'matched_supplier_bill_line',false,null,null,null,null)`, [orgs.B.business]),
    ['23514'], /chk_crpp_approval/);
    // ... and with triggers bypassed the CHECK still refuses the GL row.
    await c.query('set local session_replication_role = replica');
    await failsWith(c, () => c.query(
      `insert into public.construction_receipt_posting_policies(business_id, movement_posting_enabled, gl_posting_enabled, approved_by, approved_at, approved_reason, approved_evidence)
       values($1,true,true,$2,now(),'R13 direct policy','R13 direct policy evidence')`, [orgs.B.business, identities.A_owner.id]),
    ['23514'], /chk_crpp_gl/);
    await c.query('set local session_replication_role = origin');
    await as(c, identities.A_owner.id);

    // Gate three: the cost basis. An unmatched bill line and a bill line priced in
    // a converted unit are refused; a claim beyond what was matched is refused; and
    // evidence is mandatory.
    const basisGrn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 3, quantity_accepted: 3 }] }));
    const [basisLine] = await grnLines(c, basisGrn.id);
    const unmatched = await supplierBill(c, { quantity: 1, unit_price: 900, reference: 'R13-UNMATCHED-1' });
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [basisLine.id, unmatched.line, 1, 'R13 file', ckey()]), ['22023'], /cost-basis-unmatched/);
    // The bill line is priced per carton while the receipt is in the base unit: the
    // match reconciles through the explicit conversion (1 CTN = 12 BAG), but a COST
    // BASIS in a converted unit is refused rather than converted by assumption.
    const ctPo = await createPo(c, poPayload({ lines: [{ product_id: P.A.productBag, uom: 'BAG', quantity_ordered: 12 }] }));
    await as(c, identities.A_branch_manager.id);
    await authorizePo(c, ctPo.id);
    await as(c, identities.A_owner.id);
    const [ctLine] = await poLines(c, ctPo.id);
    const ctGrn = await recordGrn(c, grnPayload({ po_id: ctPo.id, lines: [{ po_line_id: ctLine.id, quantity_received: 12, quantity_accepted: 12 }] }));
    const [ctGrnLine] = await grnLines(c, ctGrn.id);
    const cartonBill = await supplierBill(c, { quantity: 1, unit_price: 10800, reference: 'R13-CTN-1' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [cartonBill.expense]);
    const cartonMatch = await match(c, matchPayload({ grn_line_id: ctGrnLine.id, expense_line_id: cartonBill.line, bill_uom: 'CTN', bill_quantity: 1, receipt_quantity: 12 }));
    expect(cartonMatch.is_exception).toBe(false);
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [ctGrnLine.id, cartonBill.line, 12, 'R13 file', ckey()]), ['22023'], /cost-basis-uom-unsupported/);
    // A claim cannot exceed what was matched, and evidence is mandatory.
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [grnLine.id, bill.line, 5, 'R13 bill file', ckey()]), ['22023'], /cost-basis-quantity-exceeded/);
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [grnLine.id, bill.line, 4, '  ', ckey()]), ['22023'], /evidence reference/);
    // Posting a receipt whose accepted quantity is not fully costed posts NOTHING.
    await failsWith(c, () => rpc(c, 'select public.post_construction_receipt_movement($1) r', [basisGrn.id]),
      ['22023'], /receipt-cost-basis-incomplete/);
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_grn'`, [orgs.A.business])).toBe(0);

    // Cost basis for the first receipt, then the movement itself.
    const basisKey = ckey();
    const basis = await rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [grnLine.id, bill.line, 4, 'R13 supplier bill file', basisKey]);
    expect(Number(basis.unit_cost_base)).toBe(900);
    expect((await rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [grnLine.id, bill.line, 4, 'R13 supplier bill file', basisKey])).idempotent).toBe(true);
    const posted = await rpc(c, 'select public.post_construction_receipt_movement($1) r', [grn.id]);
    expect(posted.movements).toBe(1);
    expect(posted.journal_effect).toBe('none');
    const replay = await rpc(c, 'select public.post_construction_receipt_movement($1) r', [grn.id]);
    expect(replay.idempotent).toBe(true);
    expect(replay.movements).toBe(0);
    const movement = await suRows(c, `select movement_type, quantity, unit_cost, movement_date, source_type
        from public.stock_movements where business_id=$1 and source_type='construction_grn'`, [orgs.A.business]);
    expect(movement.length).toBe(1);
    expect(movement[0].movement_type).toBe('purchase');
    expect(Number(movement[0].quantity)).toBe(4);
    expect(Number(movement[0].unit_cost)).toBe(900);
    expect(await suCount(c, 'select count(*)::int n from public.journal_entries where business_id=$1', [orgs.A.business])).toBe(before.journals);
    // Exactly one movement, so the balance moved exactly once through the shared writer.
    const balance = (await suRows(c, 'select quantity_on_hand, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [orgs.A.business, P.A.productBag, orgs.A.location]))[0];
    expect(Number(balance.quantity_on_hand)).toBe(4);
    expect(Number(balance.average_cost)).toBe(900);
    await as(c, identities.A_owner.id);

    // The period lock is absolute and this file never reopens a period.
    const backdated = await recordGrn(c, grnPayload({ po_id: po.id, receipt_date: PAST, lines: [{ po_line_id: line.id, quantity_received: 1, quantity_accepted: 1 }] }));
    const [backLine] = await grnLines(c, backdated.id);
    const backBill = await supplierBill(c, { quantity: 1, unit_price: 900, reference: 'R13-BACKDATED-1' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [backBill.expense]);
    await match(c, matchPayload({ grn_line_id: backLine.id, expense_line_id: backBill.line, bill_quantity: 1, receipt_quantity: 1 }));
    await rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r', [backLine.id, backBill.line, 1, 'R13 bill file', ckey()]);
    await su(c);
    const period = (await c.query(
      `insert into public.accounting_periods(business_id,name,period_start,period_end,is_closed) values($1,'R13 construction lock',$2,$2,false) returning id`,
      [orgs.A.business, PAST])).rows[0].id as string;
    await as(c, identities.A_accountant.id);
    await c.query('select public.close_accounting_period($1,$2) r', [period, 'R13 month end']);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => rpc(c, 'select public.post_construction_receipt_movement($1) r', [backdated.id]), ['22023'], /period-closed/);
    await su(c);
    expect((await c.query('select is_closed from public.accounting_periods where id=$1', [period])).rows[0].is_closed).toBe(true);
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_grn'`, [orgs.A.business])).toBe(1);
    await as(c, identities.A_owner.id);
  });
});

// ═══════════════════════════ ATOMICITY ═════════════════════════════════════

test(meta('CP.ROLLBACK.ATOMIC-COMMANDS', 'A command that fails anywhere leaves nothing behind: an invalid second purchase-order line persists no order and no first line, an invalid second receipt line persists no receipt, no lines and no holds, and a replayed client key with a different payload returns the original document instead of creating a second one'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const before = await ledgerState(c);
    // Two counts: what the member can see through RLS, and the un-filtered total
    // read as the owning connection. Both must be unchanged by a failed command.
    const ordersBefore = await count(c, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.A.business]);
    const allOrdersBefore = await suCount(c, 'select count(*)::int n from public.construction_purchase_orders');
    const linesBefore = await suCount(c, `select count(*)::int n from public.construction_purchase_order_lines l
      join public.construction_purchase_orders o on o.id = l.po_id`);

    // Second PO line invalid → the whole order is rolled back.
    await failsWith(c, () => createPo(c, poPayload({ lines: [
      { product_id: P.A.productBag, uom: 'BAG', quantity_ordered: 1 },
      { product_id: '00000000-0000-4000-8000-000000000000', uom: 'BAG', quantity_ordered: 1 },
    ] })), ['42501']);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_orders where business_id=$1', [orgs.A.business])).toBe(ordersBefore);
    expect(await suCount(c, 'select count(*)::int n from public.construction_purchase_orders')).toBe(allOrdersBefore);
    expect(await suCount(c, `select count(*)::int n from public.construction_purchase_order_lines l
      join public.construction_purchase_orders o on o.id = l.po_id`)).toBe(linesBefore);

    // Second receipt line invalid → no receipt, no lines, no holds, no movements.
    const { po, line } = await authorizedPo(c);
    const grnCount = async () => count(c, 'select count(*)::int n from public.construction_goods_receipt_notes where po_id=$1', [po.id]);
    const before1 = await grnCount();
    await failsWith(c, () => recordGrn(c, grnPayload({ po_id: po.id, lines: [
      { po_line_id: line.id, quantity_received: 2, quantity_accepted: 2 },
      { po_line_id: line.id, quantity_received: 5, quantity_accepted: 5,
        holds: [{ hold_type: 'rejected', quantity: 1, reason: 'R13 x', evidence_reference: 'R13 y' }] },
    ] })), ['22023']);
    expect(await grnCount()).toBe(before1);
    expect(await count(c, `select count(*)::int n from public.construction_goods_receipt_lines l
      join public.construction_goods_receipt_notes g on g.id = l.grn_id where g.po_id=$1`, [po.id])).toBe(0);
    expect(await count(c, 'select count(*)::int n from public.construction_goods_receipt_holds h join public.construction_goods_receipt_lines l on l.id=h.grn_line_id where l.po_line_id=$1', [line.id])).toBe(0);
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where business_id=$1 and source_type='construction_grn'`, [orgs.A.business])).toBe(0);

    // Idempotent replay of a PO returns the original document, never a duplicate.
    const k = ckey();
    const one = await createPo(c, poPayload(), k);
    const two = await createPo(c, poPayload({ lines: [{ product_id: P.A.productBag, uom: 'BAG', quantity_ordered: 99 }] }), k);
    expect(two.id).toBe(one.id);
    expect(two.idempotent).toBe(true);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_order_lines where po_id=$1', [one.id])).toBe(1);
    expect(Number((await poLines(c, one.id))[0].quantity_ordered)).toBe(10);

    const after = await ledgerState(c);
    expect(after).toEqual(before);
  });
});

// ═══════════════ COST DERIVATION — IAS 2 AND IAS 21 ALIGNMENT ══════════════

test(meta('CP.COST.IAS2-DERIVATION', 'Receipt cost follows IAS 2 paragraph 11: the purchase price net of the trade discount stated on the bill line, plus tax only when the tax is NOT recoverable by the business (businesses.vat_registered decides, using the tax amount actually recorded on the supplier line). A discount whose amount and percentage disagree, a standard-rated line with no tax recorded, a non-purchase tax code, and a zero-tax line that states tax are all refused rather than assumed'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const policy = await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 receipt movement policy for the pilot site', 'R13 synthetic board minute 2026-10-16']);
    expect(policy.movement_posting_enabled).toBe(true);

    // (1) Trade discount deducted from cost: 10 x 900 less 10% = 8,100 / 10 = 810.
    const disc = await freshReceipt(c, { quantity: 10 });
    const discBill = await supplierBill(c, { quantity: 10, unit_price: 900, discount_percent: 10, reference: 'R13-IAS2-DISC' });
    const discBasis = await matchedCostBasis(c, disc.grnLine.id, discBill, 10);
    expect(Number(discBasis.unit_cost_base)).toBe(810);
    expect(Number(discBasis.discount_deducted)).toBe(900);
    expect(discBasis.vat_recoverable).toBe(false);
    // The same discount written as an amount is the same cost.
    const disc2 = await freshReceipt(c, { quantity: 10 });
    const disc2Bill = await supplierBill(c, { quantity: 10, unit_price: 900, discount_amount: 900, reference: 'R13-IAS2-DISC2' });
    expect(Number((await matchedCostBasis(c, disc2.grnLine.id, disc2Bill, 10)).unit_cost_base)).toBe(810);
    // An amount and a percentage that disagree is not a discount rule: refused.
    const bad = await freshReceipt(c, { quantity: 10 });
    const badBill = await supplierBill(c, { quantity: 10, unit_price: 900, discount_amount: 500, discount_percent: 10, reference: 'R13-IAS2-BADDISC' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [badBill.expense]);
    await match(c, matchPayload({ grn_line_id: bad.grnLine.id, expense_line_id: badBill.line, bill_quantity: 10, receipt_quantity: 10 }));
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [bad.grnLine.id, badBill.line, 10, 'R13 bill file', ckey()]), ['22023'], /cost-basis-discount-inconsistent/);

    // (2) Recoverable VAT is EXCLUDED: A is VAT registered, so 5 x 900 with 17.5%
    //     tax costs 900 per bag, not 1,057.50.
    const vatReg = await freshReceipt(c, { quantity: 5 });
    const vatRegBill = await supplierBill(c, { quantity: 5, unit_price: 900, tax_code: 'vat_standard', tax_rate: 17.5, tax_amount: 787.5, reference: 'R13-IAS2-VATREC' });
    const vatRegBasis = await matchedCostBasis(c, vatReg.grnLine.id, vatRegBill, 5);
    expect(Number(vatRegBasis.unit_cost_base)).toBe(900);
    expect(vatRegBasis.vat_recoverable).toBe(true);
    expect(Number(vatRegBasis.nonrecoverable_tax)).toBe(0);

    // (3) Non-recoverable tax is INCLUDED: the same bill for an unregistered
    //     business costs 1,057.50 per bag.
    await su(c);
    await c.query('update public.businesses set vat_registered = false where id = $1', [orgs.A.business]);
    await as(c, identities.A_owner.id);
    const vatUnreg = await freshReceipt(c, { quantity: 5 });
    const vatUnregBill = await supplierBill(c, { quantity: 5, unit_price: 900, tax_code: 'vat_standard', tax_rate: 17.5, tax_amount: 787.5, reference: 'R13-IAS2-VATNONREC' });
    const vatUnregBasis = await matchedCostBasis(c, vatUnreg.grnLine.id, vatUnregBill, 5);
    expect(Number(vatUnregBasis.unit_cost_base)).toBe(1057.5);
    expect(vatUnregBasis.vat_recoverable).toBe(false);
    expect(Number(vatUnregBasis.nonrecoverable_tax)).toBe(787.5);
    await su(c);
    await c.query('update public.businesses set vat_registered = true where id = $1', [orgs.A.business]);
    await as(c, identities.A_owner.id);

    // (4) A standard-rated line that records no tax cannot be costed.
    const noTax = await freshReceipt(c, { quantity: 2 });
    const noTaxBill = await supplierBill(c, { quantity: 2, unit_price: 900, tax_code: 'vat_standard', tax_rate: 17.5, tax_amount: 0, reference: 'R13-IAS2-NOTAX' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [noTaxBill.expense]);
    await match(c, matchPayload({ grn_line_id: noTax.grnLine.id, expense_line_id: noTaxBill.line, bill_quantity: 2, receipt_quantity: 2 }));
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [noTax.grnLine.id, noTaxBill.line, 2, 'R13 bill file', ckey()]), ['22023'], /cost-basis-tax-missing/);
    // (5) A non-purchase tax code is not part of the cost of purchase.
    const wht = await freshReceipt(c, { quantity: 2 });
    const whtBill = await supplierBill(c, { quantity: 2, unit_price: 900, tax_code: 'wht_15', tax_rate: 15, tax_amount: 270, reference: 'R13-IAS2-WHT' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [whtBill.expense]);
    await match(c, matchPayload({ grn_line_id: wht.grnLine.id, expense_line_id: whtBill.line, bill_quantity: 2, receipt_quantity: 2 }));
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [wht.grnLine.id, whtBill.line, 2, 'R13 bill file', ckey()]), ['22023'], /cost-basis-tax-unsupported/);
    // (6) A zero-rated line that states an amount contradicts itself.
    const zero = await freshReceipt(c, { quantity: 2 });
    const zeroBill = await supplierBill(c, { quantity: 2, unit_price: 900, tax_code: 'vat_zero', tax_amount: 100, reference: 'R13-IAS2-ZEROTAX' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [zeroBill.expense]);
    await match(c, matchPayload({ grn_line_id: zero.grnLine.id, expense_line_id: zeroBill.line, bill_quantity: 2, receipt_quantity: 2 }));
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [zero.grnLine.id, zeroBill.line, 2, 'R13 bill file', ckey()]), ['22023'], /cost-basis-tax-inconsistent/);
  });
});

test(meta('CP.COST.IAS21-TRANSACTION-DATE-RATE', 'A bill raised in another currency is valued at the exchange rate recorded for the transaction date (IAS 21 paragraph 21) and that functional cost is frozen into the pool, so a later rate movement cannot restate inventory (IAS 21 paragraphs 23(b) and 28 keep exchange differences in profit or loss). A stale rate, a rate date that is not the bill date, a functional amount that disagrees with original x rate, and a bill in a different currency from its purchase order are all refused'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 receipt movement policy for the pilot site', 'R13 synthetic board minute 2026-10-16']);

    // A USD purchase order and a USD bill for an MWK-functional business.
    const usd = await freshReceipt(c, { quantity: 12, currency: 'USD' });
    const usdBill = await supplierBill(c, {
      quantity: 12, unit_price: 60, currency: 'USD', exchange_rate: 1.5,
      reference: 'R13-IAS21-USD', original_amount: 720, functional_amount: 1080,
    });
    const basis = await matchedCostBasis(c, usd.grnLine.id, usdBill, 12);
    // 60 USD per bag at the transaction-date rate 1.5 = 90 MWK, frozen.
    expect(Number(basis.unit_cost_base)).toBe(90);
    expect(Number(basis.exchange_rate_used)).toBe(1.5);
    expect(basis.cost_currency).toBe('MWK');
    expect(Number(basis.bill_unit_cost)).toBe(60);

    // The same receipt can be posted and the pool holds the frozen functional cost.
    const posted = await rpc(c, 'select public.post_construction_receipt_movement($1) r', [usd.grn.id]);
    expect(posted.movements).toBe(1);
    const movement = await suRows(c, `select quantity, unit_cost from public.stock_movements
        where business_id=$1 and source_type='construction_grn' and source_id=$2`, [orgs.A.business, usd.grn.id]);
    expect(Number(movement[0].unit_cost)).toBe(90);
    const balance = await suRows(c, 'select quantity_on_hand, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [orgs.A.business, P.A.productBag, orgs.A.location]);
    expect(Number(balance[0].average_cost)).toBe(90);
    // Changing the rate later cannot restate the frozen cost: the movement and the
    // basis are append-only, and a second posting is an idempotent no-op.
    const replay = await rpc(c, 'select public.post_construction_receipt_movement($1) r', [usd.grn.id]);
    expect(replay.movements).toBe(0);
    expect(replay.idempotent).toBe(true);

    // A stale rate is refused (no approximated rate is applied to inventory).
    const stale = await freshReceipt(c, { quantity: 4, currency: 'USD' });
    const staleBill = await supplierBill(c, { quantity: 4, unit_price: 60, currency: 'USD', exchange_rate: 1.5, rate_is_stale: true, reference: 'R13-IAS21-STALE' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [staleBill.expense]);
    await match(c, matchPayload({ grn_line_id: stale.grnLine.id, expense_line_id: staleBill.line, bill_quantity: 4, receipt_quantity: 4 }));
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [stale.grnLine.id, staleBill.line, 4, 'R13 bill file', ckey()]), ['22023'], /bill-fx-inconsistent/);

    // A functional amount that disagrees with original x rate is refused.
    const incoherent = await freshReceipt(c, { quantity: 4, currency: 'USD' });
    const incoherentBill = await supplierBill(c, { quantity: 4, unit_price: 60, currency: 'USD', exchange_rate: 1.5, reference: 'R13-IAS21-INCOHERENT', functional_amount: 240 });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [incoherentBill.expense]);
    await match(c, matchPayload({ grn_line_id: incoherent.grnLine.id, expense_line_id: incoherentBill.line, bill_quantity: 4, receipt_quantity: 4 }));
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [incoherent.grnLine.id, incoherentBill.line, 4, 'R13 bill file', ckey()]), ['22023'], /bill-fx-inconsistent/);

    // An MWK bill carrying a non-unit rate would misstate the functional cost.
    const mismatched = await freshReceipt(c, { quantity: 2 });
    const mismatchedBill = await supplierBill(c, { quantity: 2, unit_price: 900, exchange_rate: 1.5, reference: 'R13-IAS21-MWK-RATE' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [mismatchedBill.expense]);
    await match(c, matchPayload({ grn_line_id: mismatched.grnLine.id, expense_line_id: mismatchedBill.line, bill_quantity: 2, receipt_quantity: 2 }));
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_cost_basis($1,$2,$3,$4,$5) r',
      [mismatched.grnLine.id, mismatchedBill.line, 2, 'R13 bill file', ckey()]), ['22023'], /bill-fx-inconsistent/);

    // A bill in a different currency from its purchase order is refused at match.
    const usdPo = await freshReceipt(c, { quantity: 2, currency: 'USD' });
    const mwkBill = await supplierBill(c, { quantity: 2, unit_price: 900, reference: 'R13-IAS21-CURMIX' });
    await rpc(c, 'select public.register_construction_supplier_invoice_reference($1) r', [mwkBill.expense]);
    await failsWith(c, () => match(c, matchPayload({ grn_line_id: usdPo.grnLine.id, expense_line_id: mwkBill.line, bill_quantity: 2, receipt_quantity: 2 })),
      ['22023'], /bill-currency-mismatch/);
  });
});

// ═══════════ INSPECTION, QUALITY RELEASE AND CONSUMPTION ═══════════════════

test(meta('CP.INSPECT.QUALITY-RELEASE', 'Quarantined or disputed material never enters stock; it becomes movement-eligible only through a quality release that cites a PASSED inspection of that receipt line, with the inspection capability and the exception authority, a written reason and evidence. Rejected material can never be released (it is the supplier\'s), an accepted quantity can never be released back out (that would be an IAS 2 paragraph 28 write-down with no approved net realisable value basis), and a release made after posting is posted as a delta instead of being stranded'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 receipt movement policy for the pilot site', 'R13 synthetic board minute 2026-10-16']);

    // A receipt that takes 2 into stock and quarantines 2.
    const { po, line } = await authorizedPo(c);
    const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{
      po_line_id: line.id, quantity_received: 4, quantity_accepted: 2, quantity_quarantined: 2,
      holds: [{ hold_type: 'quarantined', quantity: 2, reason: 'R13 awaiting quality inspection', evidence_reference: 'R13 inspection log' }] }] }));
    const [grnLine] = await grnLines(c, grn.id);
    expect(Number(grnLine.accepted_base)).toBe(2);
    expect(Number(grnLine.quarantined_base)).toBe(2);

    const firstBill = await supplierBill(c, { quantity: 2, unit_price: 900, reference: 'R13-QR-1' });
    await matchedCostBasis(c, grnLine.id, firstBill, 2);
    expect((await rpc(c, 'select public.post_construction_receipt_movement($1) r', [grn.id])).movements).toBe(1);
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where source_id=$1 and source_type='construction_grn'`, [grn.id])).toBe(1);

    // A release with no inspection is refused; so is a failed inspection.
    await failsWith(c, () => rpc(c, 'select public.reclassify_construction_receipt_line($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: grnLine.id, from_bucket: 'quarantined', quantity: 2,
      inspection_id: '00000000-0000-4000-8000-000000000000', reason: 'R13 released', evidence_reference: 'R13 log' }), ckey()]),
    ['22023'], /release-inspection-required/);

    const failedInsp = await rpc(c, 'select public.record_construction_receipt_inspection($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: grnLine.id, inspection_date: DAY, outcome: 'failed',
      quantity_inspected: 2, method: 'R13 laboratory test', evidence_reference: 'R13 lab report' }), ckey()]);
    // A naive caller could cite the inspection record of ANOTHER receipt line.
    const otherLineInspection = failedInsp.id;
    await failsWith(c, () => rpc(c, 'select public.reclassify_construction_receipt_line($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: grnLine.id, from_bucket: 'quarantined', quantity: 2,
      inspection_id: otherLineInspection, reason: 'R13 released', evidence_reference: 'R13 log' }), ckey()]),
    ['22023'], /release-inspection-failed/);
    await failsWith(c, () => rpc(c, 'select public.record_construction_receipt_inspection($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: grnLine.id, inspection_date: DAY, outcome: 'passed',
      quantity_inspected: 9, method: 'R13 visual', evidence_reference: 'R13 log' }), ckey()]),
    ['22023'], /inspection-quantity-exceeded/);

    const inspPayload = {
      business_id: orgs.A.business, grn_line_id: grnLine.id, inspection_date: DAY, outcome: 'passed',
      quantity_inspected: 2, method: 'R13 laboratory test', certificate_reference: 'R13 cert 88',
      evidence_reference: 'R13 lab report 2026-10-16' };
    const inspKey = ckey();
    const passed = await rpc(c, 'select public.record_construction_receipt_inspection($1::jsonb,$2::uuid) r', [JSON.stringify(inspPayload), inspKey]);
    const inspReplay = await rpc(c, 'select public.record_construction_receipt_inspection($1::jsonb,$2::uuid) r', [JSON.stringify(inspPayload), inspKey]);
    expect(inspReplay.id).toBe(passed.id);
    expect(inspReplay.idempotent).toBe(true);

    // Inspection alone moves nothing.
    expect(await suCount(c, `select count(*)::int n from public.stock_movements where source_id=$1 and source_type='construction_grn'`, [grn.id])).toBe(1);
    expect(Number((await grnLines(c, grn.id))[0].accepted_base)).toBe(2);

    // Rejected material can never be released; accepted material can never be
    // released back out (that would be an unapproved write-down).
    const rejPo = await authorizedPo(c);
    const rejGrn = await recordGrn(c, grnPayload({ po_id: rejPo.po.id, lines: [{
      po_line_id: rejPo.line.id, quantity_received: 1, quantity_accepted: 0, quantity_rejected: 1,
      holds: [{ hold_type: 'rejected', quantity: 1, reason: 'R13 torn bags', evidence_reference: 'R13 photo' }] }] }));
    const [rejLine] = await grnLines(c, rejGrn.id);
    const rejInsp = await rpc(c, 'select public.record_construction_receipt_inspection($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: rejLine.id, inspection_date: DAY, outcome: 'passed',
      quantity_inspected: 1, method: 'R13 visual', evidence_reference: 'R13 photo review' }), ckey()]);
    await failsWith(c, () => rpc(c, 'select public.reclassify_construction_receipt_line($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: rejLine.id, from_bucket: 'rejected', quantity: 1,
      inspection_id: rejInsp.id, reason: 'R13 release rejected', evidence_reference: 'R13 photo' }), ckey()]),
    ['22023'], /rejected-release-unsupported/);
    await failsWith(c, () => rpc(c, 'select public.reclassify_construction_receipt_line($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: grnLine.id, from_bucket: 'accepted', quantity: 1,
      inspection_id: passed.id, reason: 'R13 damaged after acceptance', evidence_reference: 'R13 photo' }), ckey()]),
    ['22023'], /accepted-release-unsupported/);
    // An unauthorized member cannot release, even with a passed inspection.
    await as(c, identities.A_stock_clerk.id);
    await failsWith(c, () => rpc(c, 'select public.reclassify_construction_receipt_line($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: grnLine.id, from_bucket: 'quarantined', quantity: 2,
      inspection_id: passed.id, reason: 'R13 released', evidence_reference: 'R13 log' }), ckey()]),
    ['42501'], /reclassification-exception-denied/);
    await as(c, identities.A_owner.id);

    // The evidenced release: quarantined -> accepted, with the hold closed.
    const released = await rpc(c, 'select public.reclassify_construction_receipt_line($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, grn_line_id: grnLine.id, from_bucket: 'quarantined', quantity: 2,
      inspection_id: passed.id, reason: 'R13 laboratory test passed', evidence_reference: 'R13 lab report 2026-10-16' }), ckey()]);
    expect(Number(released.accepted_before_base)).toBe(2);
    expect(Number(released.accepted_after_base)).toBe(4);
    expect(released.stock_effect).toBe('none');
    const afterRelease = (await grnLines(c, grn.id))[0];
    expect(Number(afterRelease.quantity_accepted)).toBe(4);
    expect(Number(afterRelease.quantity_quarantined)).toBe(0);
    expect(await count(c, 'select count(*)::int n from public.construction_goods_receipt_holds where grn_line_id=$1 and status=$2', [grnLine.id, 'open'])).toBe(0);

    // The released quantity still needs an evidenced cost, and only then is the
    // DELTA posted — a release after posting is not stranded.
    await failsWith(c, () => rpc(c, 'select public.post_construction_receipt_movement($1) r', [grn.id]),
      ['22023'], /receipt-cost-basis-incomplete/);
    const secondBill = await supplierBill(c, { quantity: 2, unit_price: 900, reference: 'R13-QR-2' });
    await matchedCostBasis(c, grnLine.id, secondBill, 2);
    const delta = await rpc(c, 'select public.post_construction_receipt_movement($1) r', [grn.id]);
    expect(delta.movements).toBe(1);
    expect(delta.idempotent).toBe(false);
    const movements = await suRows(c, `select quantity, unit_cost from public.stock_movements
        where source_id=$1 and source_type='construction_grn' order by created_at`, [grn.id]);
    expect(movements.length).toBe(2);
    expect(Number(movements[0].quantity) + Number(movements[1].quantity)).toBe(4);
    const balance = await suRows(c, 'select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [orgs.A.business, P.A.productBag, orgs.A.location]);
    expect(Number(balance[0].quantity_on_hand)).toBe(4);
    expect(await suCount(c, 'select count(*)::int n from public.journal_entries where business_id=$1', [orgs.A.business])).toBe(0);
  });
});

test(meta('CP.ISSUE.PROJECT-COST', 'Material issued from a store to a construction site leaves stock at the pool weighted-average cost through the single shared balance writer (one outbound issue_out movement, no GL entry), project material cost is derived from the issue register per project_ref, and the command is gated on the approved movement policy, exact site scope, an explicit UOM conversion, an open period, available stock and a known pool cost'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    // No approved policy: nothing leaves stock.
    const { po, line } = await authorizedPo(c, { lines: [{ product_id: P.A.productBag, uom: 'BAG', quantity_ordered: 12 }] });
    const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{ po_line_id: line.id, quantity_received: 12, quantity_accepted: 12 }] }));
    const [grnLine] = await grnLines(c, grn.id);
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'BAG', quantity: 1,
      issue_date: DAY, evidence_reference: 'R13 site requisition' }), ckey()]), ['22023'], /issue-posting-not-approved/);
    await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 receipt movement policy for the pilot site', 'R13 synthetic board minute 2026-10-16']);

    // Stock the site store at 900 per bag through a receipt.
    const bill = await supplierBill(c, { quantity: 12, unit_price: 900, reference: 'R13-ISSUE-STOCK' });
    await matchedCostBasis(c, grnLine.id, bill, 12);
    expect((await rpc(c, 'select public.post_construction_receipt_movement($1) r', [grn.id])).movements).toBe(1);
    const before = await ledgerState(c);

    // Scope: another tenant's site cannot be issued to; a foreign product is refused.
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.B.site1, product_id: P.A.productBag, uom: 'BAG', quantity: 1,
      issue_date: DAY, evidence_reference: 'R13 requisition' }), ckey()]), ['42501'], /does not belong to this business/);
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.B.productBag, uom: 'BAG', quantity: 1,
      issue_date: DAY, evidence_reference: 'R13 requisition' }), ckey()]), ['42501'], /does not belong to this business/);
    // Unknown unit and a missing evidence reference are refused.
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'SACK', quantity: 1,
      issue_date: DAY, evidence_reference: 'R13 requisition' }), ckey()]), ['22023'], /no approved conversion/);
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'BAG', quantity: 1,
      issue_date: DAY }), ckey()]), ['22023'], /evidence reference/);
    // More than is available is refused: no negative stock.
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'BAG', quantity: 13,
      issue_date: DAY, evidence_reference: 'R13 requisition' }), ckey()]), ['22023'], /insufficient-stock/);

    // A real issue of 1 CTN = 12 BAG at the pool cost of 900 per bag.
    const issueKey = ckey();
    const issue = await rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'CTN', quantity: 1,
      issue_date: DAY, issued_to: 'R13 substructure crew', evidence_reference: 'R13 signed site requisition 2026-10-16' }), issueKey]);
    expect(Number(issue.quantity_base)).toBe(12);
    expect(Number(issue.unit_cost_base)).toBe(900);
    expect(Number(issue.total_cost_base)).toBe(10800);
    expect(issue.project_ref).toBe('R13-PROJECT-1');
    expect(issue.journal_effect).toBe('none');
    const replay = await rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'CTN', quantity: 1,
      issue_date: DAY, issued_to: 'R13 substructure crew', evidence_reference: 'R13 signed site requisition 2026-10-16' }), issueKey]);
    expect(replay.idempotent).toBe(true);

    // Exactly one outbound movement, valued at the pool cost; the pool quantity
    // falls and its average cost is unchanged; no journal entry was written.
    const movements = await suRows(c, `select movement_type, quantity, unit_cost, source_type, location_id
        from public.stock_movements where source_id=$1`, [issue.id]);
    expect(movements.length).toBe(1);
    expect(movements[0].movement_type).toBe('issue_out');
    expect(Number(movements[0].quantity)).toBe(-12);
    expect(Number(movements[0].unit_cost)).toBe(900);
    expect(movements[0].location_id).toBe(orgs.A.location);
    const balance = await suRows(c, 'select quantity_on_hand, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [orgs.A.business, P.A.productBag, orgs.A.location]);
    expect(Number(balance[0].quantity_on_hand)).toBe(0);
    expect(Number(balance[0].average_cost)).toBe(900);
    const after = await ledgerState(c);
    expect(after.journals).toBe(before.journals);
    expect(after.movements).toBe(before.movements + 1);

    // Nothing left: a further issue is refused.
    await failsWith(c, () => rpc(c, 'select public.issue_construction_materials_to_project($1::jsonb,$2::uuid) r', [JSON.stringify({
      business_id: orgs.A.business, site_id: P.A.site1, product_id: P.A.productBag, uom: 'BAG', quantity: 1,
      issue_date: DAY, evidence_reference: 'R13 requisition' }), ckey()]), ['22023'], /insufficient-stock/);

    // Project material cost is derived from the register, per project.
    const costs = (await c.query('select project_ref, issue_count, quantity_base, material_cost, currency from public.construction_project_material_cost($1)',
      [orgs.A.business])).rows;
    expect(costs.length).toBe(1);
    expect(costs[0].project_ref).toBe('R13-PROJECT-1');
    expect(Number(costs[0].issue_count)).toBe(1);
    expect(Number(costs[0].material_cost)).toBe(10800);
    expect(costs[0].currency).toBe('MWK');
  });
});

test(meta('CP.CUTOVER.OPEN-ITEMS', 'The cutover/close report is read-only and member-scoped: it lists receipts awaiting an evidenced cost basis, accepted quantities not yet posted, open quality holds with their age, outstanding supplier claims for rejected/quarantined/disputed material, and bills blocked by a legacy stock movement — and it is refused for a non-member. Document numbers are never reused after a cancellation, and a rolled-back creation leaves no gap'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await rpc(c, 'select public.approve_construction_receipt_posting_policy($1,true,$2,$3) r',
      [orgs.A.business, 'R13 receipt movement policy for the pilot site', 'R13 synthetic board minute 2026-10-16']);

    // One receipt with an unmatched accepted quantity, one hold, one rejected claim.
    const { po, line } = await authorizedPo(c);
    const grn = await recordGrn(c, grnPayload({ po_id: po.id, lines: [{
      po_line_id: line.id, quantity_received: 5, quantity_accepted: 3, quantity_rejected: 1, quantity_quarantined: 1,
      holds: [
        { hold_type: 'rejected', quantity: 1, reason: 'R13 torn bags', evidence_reference: 'R13 site photo' },
        { hold_type: 'quarantined', quantity: 1, reason: 'R13 awaiting inspection', evidence_reference: 'R13 inspection log' },
      ] }] }));
    const [grnLine] = await grnLines(c, grn.id);

    // A bill blocked by the legacy purchase hook.
    await su(c);
    const blockedBill = (await c.query(
      `insert into public.expenses(business_id, expense_number, expense_type, status, expense_date, currency, exchange_rate,
         original_currency, original_amount, functional_currency, functional_amount, rate_date, rate_is_stale, subtotal,
         vat_amount, wht_amount, total_amount, amount_paid, contact_id, branch_id, reference)
       values($1,'R13-BLOCKED-BILL','bill','draft',$2,'MWK',1,'MWK',900,'MWK',900,$2,false,900,0,0,900,0,$3,$4,'R13-BLOCKED-REF') returning id`,
      [orgs.A.business, DAY, P.A.supplier, orgs.A.branch])).rows[0].id as string;
    await c.query(
      `insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id,created_by)
       values($1,$2,$3,'purchase',$4,1,900,'expense',$5,$6)`,
      [orgs.A.business, P.A.productBag, orgs.A.location, DAY, blockedBill, identities.A_owner.id]);
    await as(c, identities.A_owner.id);

    const items = await rpc(c, 'select public.construction_procurement_open_items($1) r', [orgs.A.business]);
    expect(items.movement_posting_enabled).toBe(true);
    expect(items.gl_posting_enabled).toBe(false);
    expect(items.grants_in_force).toBeGreaterThan(0);
    expect(items.awaiting_cost_basis.length).toBeGreaterThan(0);
    expect(items.awaiting_posting.length).toBeGreaterThan(0);
    expect(items.open_holds.length).toBe(2);
    expect(items.open_holds.map((h: { hold_type: string }) => h.hold_type).sort()).toEqual(['quarantined', 'rejected']);
    const claim = items.outstanding_supplier_claims.find((x: { receipt_date: string }) => x.receipt_date === DAY);
    expect(claim).toBeTruthy();
    expect(Number(claim.outstanding_base)).toBe(2);
    expect(claim.supplier).toContain('R13 construction supplier A');
    expect(items.blocked_bills.some((b: { reference: string }) => b.reference === 'R13-BLOCKED-REF')).toBe(true);
    // The rejected quantity is NOT movement-eligible: only the accepted 3 can ever post.
    expect(Number(grnLine.accepted_base)).toBe(3);

    // A non-member of the business is refused the report.
    await su(c);
    await as(c, identities.B_owner.id);
    await failsWith(c, () => rpc(c, 'select public.construction_procurement_open_items($1) r', [orgs.A.business]),
      ['42501'], /not an active member/);
    await as(c, identities.A_owner.id);

    // Numbering: per business, monotonic, never reused after a cancellation, and a
    // rolled-back creation consumes no number.
    const n1 = await createPo(c, poPayload());
    const cancelled = await createPo(c, poPayload());
    await rpc(c, 'select public.cancel_construction_purchase_order($1,$2) r', [cancelled.id, 'R13 duplicate requirement']);
    const n3 = await createPo(c, poPayload());
    const numbers = [n1.number, cancelled.number, n3.number] as string[];
    expect(new Set(numbers).size).toBe(3);
    expect(numbers[0] < numbers[1] && numbers[1] < numbers[2]).toBe(true);
    // A failed creation (rolled back inside its own savepoint) leaves no gap.
    await failsWith(c, () => createPo(c, poPayload({ lines: [] })), ['22023']);
    const n4 = await createPo(c, poPayload());
    expect(n4.number > n3.number).toBe(true);
    expect(await count(c, 'select count(*)::int n from public.construction_purchase_orders where po_number=$1', [cancelled.number])).toBe(1);
  });
});
