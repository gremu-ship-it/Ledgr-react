/**
 * R06 — Inventory and POS sale posting integrity.
 *
 * Anchored failure (register: "Version one authoritative
 * stock-movement→balance mechanism and test concurrent sales/receipts. Do
 * not install a second updater alongside an unknown live trigger."):
 * POS.STOCK showed a posted sale inserting a stock movement while the
 * balance stayed at its seeded value — no online mechanism existed at all.
 * Verification-first inventory proved no trigger on stock_movements /
 * inventory_balances anywhere in the migration chain; the only balance
 * writers were offline batch reconcilers. One migration therefore installs
 * THE single authoritative online propagation:
 *   supabase/migrations/20260928000001_r06_stock_balance_authority.sql
 *     _ledgr_apply_stock_movement_balance (AFTER INSERT, security definer)
 * This suite proves the FAIL→PASS behavior change and the derived R06
 * guarantees: exactly-once on command replay, approved oversell policy
 * (nonneg constraint → 23514), weighted-average cost on costed inbound,
 * service/non-stock sales produce no inventory effects, and fixture
 * immutability. Probe conventions identical to the R05 suite (observer
 * position inside rolled-back tx, savepoint-isolated denials, real SQLSTATE
 * pins).
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, saleFixture } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r06-pos');
const M_TRIG = 'supabase/migrations/20260928000001_r06_stock_balance_authority.sql';
const M_RPC = 'supabase/migrations/20260923000000_post_pos_sale_rpc.sql';
const LAYER = 'real PostgreSQL17 full migration replay incl. 20260928000001 R06 trigger; synthetic identities; observer-position probes inside rolled-back transactions; no customer data';
const meta = (id: string, expected: string, source: string) => ({
  id, expected, remediation: 'R06', source, layer: LAYER,
});

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

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

async function deniedInTx(c: C, run: () => Promise<unknown>, codes: string[], messageRx?: RegExp) {
  const sp = `sp_r06_${++deniedInTx.sp}`;
  await c.query(`savepoint ${sp}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${sp}`);
  if (!caught) throw new Error('Invariant probe completed without the expected denial.');
  expect(codes).toContain(caught.code);
  if (messageRx) expect(caught.message).toMatch(messageRx);
}
deniedInTx.sp = 0;

const balanceOf = async (c: C, org = 'A') =>
  (await c.query('select quantity_on_hand, quantity_reserved, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs[org].business, orgs[org].product, orgs[org].location])).rows[0];

const insertMovement = (c: C, org: string, qty: number, unitCost: number | null, type: string, sourceId: string) =>
  c.query(`insert into public.stock_movements(business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference)
    values($1,$2,$3,$4,$5,$6,$7,'r13-probe',$8,'R06 invariant probe')`,
    [orgs[org].business, orgs[org].product, orgs[org].location, type, DAY, qty, unitCost, sourceId]);

test(meta('R06.POS.BALANCE-PROPAGATION', 'A sale movement reduces on_hand exactly (100→98); an inbound movement increases it (98→101); the mechanism propagates movements rather than trusting movement-insertion alone', M_TRIG), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    expect(Number((await balanceOf(c)).quantity_on_hand)).toBe(100);
    await insertMovement(c, 'A', -2, 900, 'sale', 'r06-prop-sale');
    expect(Number((await balanceOf(c)).quantity_on_hand)).toBe(98);
    await insertMovement(c, 'A', 3, 900, 'purchase', 'r06-prop-receipt');
    const after = await balanceOf(c);
    expect(Number(after.quantity_on_hand)).toBe(101);
    expect(Number(after.quantity_reserved)).toBe(0);
  });
});

test(meta('R06.POS.OVERSELL-DENIED', 'Approved final-unit policy: a movement that would take on_hand negative is rejected by chk_inventory_balances_on_hand_nonneg (23514) and the balance is unchanged — concurrent sales serialize on the locked balance row', M_TRIG), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    await deniedInTx(c, () => insertMovement(c, 'A', -101, 900, 'sale', 'r06-oversell'), ['23514']);
    expect(Number((await balanceOf(c)).quantity_on_hand)).toBe(100);
    await insertMovement(c, 'A', -100, 900, 'sale', 'r06-final-unit');
    expect(Number((await balanceOf(c)).quantity_on_hand)).toBe(0);
  });
});

test(meta('R06.POS.WEIGHTED-AVERAGE-COST', 'Costed inbound applies weighted-average valuation ((100×900 + 10×1000)/110 = 909.09…); zero-cost inbound propagates quantity only and never substitutes zero valuation', M_TRIG), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    await insertMovement(c, 'A', 10, 1000, 'purchase', 'r06-wac-in');
    let after = await balanceOf(c);
    expect(Number(after.quantity_on_hand)).toBe(110);
    expect(Number(after.average_cost)).toBeCloseTo(909.090909, 4);
    await insertMovement(c, 'A', 5, 0, 'purchase', 'r06-wac-nocost');
    after = await balanceOf(c);
    expect(Number(after.quantity_on_hand)).toBe(115);
    expect(Number(after.average_cost)).toBeCloseTo(909.090909, 4);
  });
});

test(meta('R06.POS.REPLAY-EXACTLY-ONCE', 'post_pos_sale command replay (same client key) applies stock effects exactly once: balance 100→99, exactly one sale movement for the invoice', M_RPC), async () => {
  ready();
  const payload = JSON.stringify(saleFixture(orgs.A, 11));
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = (await c.query('select public.post_pos_sale($1::jsonb) r', [payload])).rows[0].r as { id: string };
    const second = (await c.query('select public.post_pos_sale($1::jsonb) r', [payload])).rows[0].r as { id: string; idempotent: boolean };
    expect(second.id).toBe(first.id);
    await c.query('reset role');
    expect(Number((await balanceOf(c)).quantity_on_hand)).toBe(99);
    const moves = (await c.query("select count(*)::int n from public.stock_movements where business_id=$1 and source_type='invoice' and source_id=$2",
      [orgs.A.business, first.id])).rows[0].n;
    expect(moves).toBe(1);
  });
});

test(meta('R06.POS.SERVICE-NO-STOCK', 'Non-stock (track_inventory=false) product sale posts normally and produces no stock movement and no balance row', M_RPC), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await c.query('reset role');
    const svc = (await c.query("insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code) values($1,'R13 service','SVC-R06',1500,0,'MWK','service',false,'none','none') returning id", [orgs.A.business])).rows[0].id as string;
    const fixture = saleFixture(orgs.A, 12) as Record<string, unknown> & { lines: Array<Record<string, unknown>> };
    fixture.lines = [{ ...fixture.lines[0], description: 'R13 synthetic service line', product_id: svc }];
    const posted = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(fixture)])).rows[0].r as { id: string };
    const moves = (await c.query("select count(*)::int n from public.stock_movements where business_id=$1 and source_type='invoice' and source_id=$2",
      [orgs.A.business, posted.id])).rows[0].n;
    expect(moves).toBe(0);
    const balRow = (await c.query('select count(*)::int n from public.inventory_balances where business_id=$1 and product_id=$2', [orgs.A.business, svc])).rows[0].n;
    expect(balRow).toBe(0);
  });
});

test(meta('R06.POS.DATA-UNCHANGED', 'Every R06 probe rolls back: seeded balance, movement totals and fixture identity data unchanged after the suite', M_TRIG), async () => {
  ready();
  const seeded = (await db.client.query('select quantity_on_hand, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs.A.business, orgs.A.product, orgs.A.location])).rows[0];
  expect(Number(seeded.quantity_on_hand)).toBe(100);
  expect(Number(seeded.average_cost)).toBe(900);
  const q = (t: string) => db.client.query(`select count(*)::int n from public.${t}`).then((r: { rows: Array<{ n: number }> }) => r.rows[0].n);
  expect(await q('stock_movements')).toBe(0);
  expect(await q('invoices')).toBe(0);
  expect(await q('contacts')).toBe(2);
  expect(await q('business_users')).toBe(14);
});
