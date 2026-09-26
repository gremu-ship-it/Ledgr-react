/**
 * OWNER DECISIONS 2026-09-26 — release evidence.
 *   OD.PRICE.*   only a supervisor may override a till price / exceed the discount cap (server-enforced)
 *   OD.BRANCH.*  POS sales deduct from the BRANCH location, never a warehouse fallback
 *   OD.REPAIR.*  the additive, evidence-gated historical repair (ledgr_repair schema), exercised on a
 *                SYNTHETIC reproduction only — this proves the mechanism, not that it ran in production.
 * Every probe runs inside a transaction that is rolled back.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, key, saleFixture } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('od-owner-decisions');
const LAYER = 'real PostgreSQL17 roles/JWT claims; synthetic identities; full migration replay (incl. 20261013000000–01)';
const MD = 'supabase/migrations/20261013000000_owner_decisions_price_override_branch_stock.sql';
const MR = 'supabase/migrations/20261013000001_ledgr_repair_2026_09.sql';
const meta = (id: string, expected: string, source: string) => ({ id, expected, remediation: 'OWNER-DECISIONS-2026-09-26', source, layer: LAYER });

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';
beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try { orgs = await seedFixture(db.client); } catch (e) { seedError = safeError(e); }
}, 600000);
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}

let sp = 0;
async function failsWith(c: C, run: () => Promise<unknown>, codes: string[], message?: RegExp) {
  const name = `od_sp_${++sp}`;
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
/** Superuser transaction that is always rolled back. */
async function rolledBack(fn: (c: C) => Promise<void>) {
  const c = db.client as unknown as C;
  await c.query('begin');
  try { await fn(c); } finally { await c.query('rollback'); }
}
const posSale = (c: C, p: unknown) => c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(p)]).then((r) => r.rows[0].r as Record<string, any>);
const invoicesByKey = async (c: C, k: string) => (await c.query('select count(*)::int n from public.invoices where client_key::text=$1', [k])).rows[0].n as number;
const qtyAt = async (c: C, location: string, org = 'A') =>
  Number((await c.query('select coalesce(sum(quantity_on_hand),0) q from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs[org].business, orgs[org].product, location])).rows[0].q);

/** Consistent sale of 1 unit at an arbitrary price (arithmetic valid, so only authority is under test). */
const pricedSale = (n: number, price: number) => {
  const s = saleFixture(orgs.A, n) as any;
  Object.assign(s.lines[0], { quantity: 1, unit_price: price, discount_amount: 0, line_total: price });
  Object.assign(s.invoice, { discount_amount: 0, discount_percent: 0, total_amount: price, subtotal: price, taxable_amount: price, original_amount: price, functional_amount: price, vat_amount: 0 });
  s.cash_sales = price; s.payments[0].amount = price; s.payments[0].functional_amount = price;
  return s;
};
/** 1 × 1500 with an order discount of pct % (consistent arithmetic). */
const discountSale = (n: number, pct: number) => {
  const d = Math.round(1500 * pct) / 100; const t = 1500 - d;
  const s = saleFixture(orgs.A, n) as any;
  Object.assign(s.invoice, { discount_amount: d, discount_percent: pct, total_amount: t, subtotal: t, taxable_amount: t, original_amount: t, functional_amount: t, vat_amount: 0 });
  s.cash_sales = t; s.payments[0].amount = t; s.payments[0].functional_amount = t;
  return s;
};
const requestOverride = (c: C, kind: 'price' | 'discount', opts: { price?: number; pct?: number }) =>
  c.query('select public.request_pos_price_override($1,$2,$3,$4,$5,$6) r',
    [orgs.A.business, kind, kind === 'price' ? orgs.A.product : null, opts.price ?? null, opts.pct ?? null, 'OD synthetic'])
    .then((r) => r.rows[0].r as { token: string });
const authorize = (c: C, token: string) => c.query('select public.authorize_pos_price_override($1::uuid) r', [token]);

// ═════════════════════════════ D-PRICE ═════════════════════════════════════
test(meta('OD.PRICE.CASHIER-OVERRIDE-REFUSED', 'A cashier selling the catalogue item (sale_price 1500) at 1400 — arithmetic otherwise consistent — is refused 22023 price-override-required; nothing is written (no invoice, stock unchanged). The catalogue price itself posts', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await su(c); const before = await qtyAt(c, orgs.A.location); await as(c, identities.A_cashier.id);
    await failsWith(c, () => posSale(c, pricedSale(1301, 1400)), ['22023'], /price-override-required/);
    await failsWith(c, () => posSale(c, pricedSale(1302, 1600)), ['22023'], /price-override-required/);
    await su(c);
    expect(await invoicesByKey(c, key(1301))).toBe(0);
    expect(await qtyAt(c, orgs.A.location)).toBe(before);
    await as(c, identities.A_cashier.id);
    await posSale(c, pricedSale(1303, 1500));
  });
});

test(meta('OD.PRICE.SUPERVISOR-DIRECT', 'A supervisor (branch_manager, owner) operating the till may set a different unit price directly without a token; the sale posts at that price', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_branch_manager.id, async (c: C) => {
    await su(c); await c.query('update public.pos_shifts set cashier_id=$1 where id=$2', [identities.A_branch_manager.id, orgs.A.shift]);
    await as(c, identities.A_branch_manager.id);
    await posSale(c, pricedSale(1311, 1400));
    await su(c);
    expect(Number((await c.query('select l.unit_price from public.invoice_lines l join public.invoices i on i.id=l.invoice_id where i.client_key::text=$1', [key(1311)])).rows[0].unit_price)).toBe(1400);
  });
});

test(meta('OD.PRICE.TOKEN-FLOW', 'Cashier requests a price override (1400) → cannot self-authorise (42501, not a supervisor) → an unauthorised token is refused at sale → a supervisor (branch_manager) authorises → the sale posts; the token is single-use (a second sale with it is refused 22023) and bound to product+price (a different price with the token is refused)', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const { token } = await requestOverride(c, 'price', { price: 1400 });
    await failsWith(c, () => authorize(c, token), ['42501']);
    const s1 = pricedSale(1321, 1400); s1.lines[0].price_override_token = token;
    await failsWith(c, () => posSale(c, s1), ['22023'], /price-override-required/);
    await as(c, identities.A_branch_manager.id);
    await authorize(c, token);
    await as(c, identities.A_cashier.id);
    const s2 = pricedSale(1322, 1300); s2.lines[0].price_override_token = token;
    await failsWith(c, () => posSale(c, s2), ['22023'], /price-override-required/);
    await posSale(c, s1);
    await posSale(c, s1);  // idempotent replay of the same client_key does not need the token again
    const s3 = pricedSale(1323, 1400); s3.lines[0].price_override_token = token;
    await failsWith(c, () => posSale(c, s3), ['22023'], /price-override-required/);
    await su(c);
    expect(await invoicesByKey(c, key(1321))).toBe(1);
    const row = (await c.query('select consumed_at, authorized_by from public.pos_price_overrides where token=$1', [token])).rows[0];
    expect(row.consumed_at).not.toBeNull();
    expect(String(row.authorized_by)).toBe(identities.A_branch_manager.id);
  });
});

test(meta('OD.PRICE.AUTHORIZER-SCOPE', 'Only supervisors of the SAME business authorise: viewer, accountant, stock_clerk of A → 42501; owner of B → 42501 (not a member/supervisor of A); the requester cannot authorise their own request even as a supervisor (22023); anon cannot request (42501)', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const { token } = await requestOverride(c, 'price', { price: 1400 });
    for (const who of ['A_viewer', 'A_accountant', 'A_stock_clerk', 'B_owner']) {
      await as(c, identities[who].id);
      await failsWith(c, () => authorize(c, token), ['42501']);
    }
    await as(c, identities.A_branch_manager.id);
    const own = await requestOverride(c, 'price', { price: 1450 });
    await failsWith(c, () => authorize(c, own.token), ['22023'], /own override/);
  });
  await db.asRole('anon', null, async (c: C) => {
    await failsWith(c, () => requestOverride(c, 'price', { price: 1400 }), ['42501']);
  });
});

test(meta('OD.PRICE.DISCOUNT-CAP-SERVER', 'Discount caps are enforced by the server per role (no pos_settings row: cashier 10 %, manager 25 %, owner 100 %): cashier 8 % posts; cashier 20 % is refused 22023 discount-override-required; a branch_manager-authorised 20 % token lets it post; a 30 % request is beyond the branch_manager cap (authorise 42501) but an owner may authorise it', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await posSale(c, discountSale(1331, 8));
    await failsWith(c, () => posSale(c, discountSale(1332, 20)), ['22023'], /discount-override-required/);
    const t20 = await requestOverride(c, 'discount', { pct: 20 });
    await as(c, identities.A_branch_manager.id); await authorize(c, t20.token);
    await as(c, identities.A_cashier.id);
    const s = discountSale(1332, 20); s.invoice.discount_override_token = t20.token;
    await posSale(c, s);
    const t30 = await requestOverride(c, 'discount', { pct: 30 });
    await as(c, identities.A_branch_manager.id);
    await failsWith(c, () => authorize(c, t30.token), ['42501'], /above your own approval limit/);
    await as(c, identities.A_owner.id); await authorize(c, t30.token);
    await as(c, identities.A_cashier.id);
    const s30 = discountSale(1333, 30); s30.invoice.discount_override_token = t30.token;
    await posSale(c, s30);
    await su(c);
    for (const n of [1331, 1332, 1333]) expect(await invoicesByKey(c, key(n))).toBe(1);
  });
});

test(meta('OD.PRICE.POS-SETTINGS-HONOURED', 'When pos_settings defines caps they replace the fallbacks: cashier_max_discount_percent=5 → a cashier 8 % discount is refused 22023; manager_max_discount_percent=15 → a branch_manager may not authorise 20 % (42501)', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await su(c);
    await c.query('insert into public.pos_settings(business_id, cashier_max_discount_percent, manager_max_discount_percent) values($1,5,15) on conflict (business_id) do update set cashier_max_discount_percent=5, manager_max_discount_percent=15', [orgs.A.business]);
    await as(c, identities.A_cashier.id);
    await failsWith(c, () => posSale(c, discountSale(1341, 8)), ['22023'], /discount-override-required/);
    const t = await requestOverride(c, 'discount', { pct: 20 });
    await as(c, identities.A_branch_manager.id);
    await failsWith(c, () => authorize(c, t.token), ['42501']);
  });
});

test(meta('OD.PRICE.TABLE-NOT-WRITABLE', 'pos_price_overrides cannot be written directly by authenticated callers (insert/update → 42501): an override can only come from request/authorize commands; the helper functions are not executable by authenticated', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await failsWith(c, () => c.query("insert into public.pos_price_overrides(business_id,kind,requested_by,expires_at,authorized_at,authorized_by) values($1,'discount',$2,now()+interval '1 hour',now(),$2)", [orgs.A.business, identities.A_owner.id]), ['42501']);
    await failsWith(c, () => c.query('update public.pos_price_overrides set authorized_at=now()'), ['42501']);
    await failsWith(c, () => c.query("select public._ledgr_consume_price_override($1,'{}'::uuid[],'price',null,null,null)", [orgs.A.business]), ['42501']);
  });
});

// ═════════════════════════════ D-BRANCH ════════════════════════════════════
test(meta('OD.BRANCH.DEDUCTS-BRANCH-NOT-WAREHOUSE', 'With a business DEFAULT warehouse (no branch) that also stocks the item, a POS sale on branch A1 deducts from the A1 location (100→99) and leaves the warehouse untouched (40→40); availability shows the A1 location, is_fallback=false', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await su(c);
    await c.query('update public.inventory_locations set is_default=false where id=$1', [orgs.A.location]);
    const wh = String((await c.query('insert into public.inventory_locations(business_id,name,is_default,branch_id) values($1,$2,true,null) returning id', [orgs.A.business, 'OD warehouse'])).rows[0].id);
    await c.query("insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id) values($1,$2,$3,'adjustment_in',current_date,40,900,'manual','od-wh-seed')", [orgs.A.business, orgs.A.product, wh]);
    const a1 = await qtyAt(c, orgs.A.location);
    await as(c, identities.A_cashier.id);
    const av = (await c.query('select public.pos_stock_availability($1,$2) r', [orgs.A.business, orgs.A.branch])).rows[0].r;
    expect(av.location.id).toBe(orgs.A.location); expect(av.is_fallback).toBe(false);
    await posSale(c, saleFixture(orgs.A, 1351));
    await su(c);
    expect(await qtyAt(c, orgs.A.location)).toBe(a1 - 1);
    expect(await qtyAt(c, wh)).toBe(40);
  });
});

test(meta('OD.BRANCH.NO-LOCATION-REFUSED', 'If the sale branch has no location of its own the sale is refused P0001 branch-location-missing (even though a default warehouse holds stock); nothing is written: no invoice, no movement, warehouse quantity unchanged', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await su(c);
    await c.query('update public.inventory_locations set branch_id=null where id=$1', [orgs.A.location]);  // A1 loses its own location; it remains the default warehouse
    const wh = await qtyAt(c, orgs.A.location);
    await as(c, identities.A_cashier.id);
    const av = (await c.query('select public.pos_stock_availability($1,$2) r', [orgs.A.business, orgs.A.branch])).rows[0].r;
    expect(av.branch_location_missing).toBe(true);
    await failsWith(c, () => posSale(c, saleFixture(orgs.A, 1361)), ['P0001'], /branch-location-missing/);
    await su(c);
    expect(await invoicesByKey(c, key(1361))).toBe(0);
    expect(await qtyAt(c, orgs.A.location)).toBe(wh);
  });
});

test(meta('OD.BRANCH.SERVICE-LINES-UNAFFECTED', 'A branch with no location can still sell a NON-stock (service) line: the branch rule applies only to tracked stock', MD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await su(c);
    await c.query('update public.inventory_locations set branch_id=null where id=$1', [orgs.A.location]);
    await c.query('update public.products set track_inventory=false where id=$1', [orgs.A.product]);
    await as(c, identities.A_cashier.id);
    await posSale(c, saleFixture(orgs.A, 1371));
    await su(c);
    expect(await invoicesByKey(c, key(1371))).toBe(1);
  });
});

// ═════════════════════════════ REPAIR ══════════════════════════════════════
const EMPTY = 'd41d8cd98f00b204e9800998ecf8427e';
const insertInvoice = async (c: C, org: string, status: string, n: number, type = 'invoice') =>
  String((await c.query(`insert into public.invoices(business_id,contact_id,branch_id,invoice_number,invoice_type,status,issue_date,due_date,currency,original_currency,exchange_rate,functional_currency,
      subtotal,taxable_amount,discount_amount,discount_percent,vat_amount,wht_amount,total_amount,original_amount,functional_amount,amount_paid,rate_date,rate_is_stale)
    values($1,$2,$3,$4,$5,$6::invoice_status,$7,$7,'MWK','MWK',1,'MWK',1500,1500,0,0,0,0,1500,1500,1500,0,$7,false) returning id`,
    [orgs[org].business, orgs[org].customer, orgs[org].branch, `OD-REP-${n}`, type, status, DAY])).rows[0].id);
const saleMove = (c: C, org: string, inv: string, qty: number) =>
  c.query("insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id) values($1,$2,$3,'sale',$4,$5,900,'invoice',$6)",
    [orgs[org].business, orgs[org].product, orgs[org].location, DAY, -qty, inv]);
/** Synthetic reproduction of the 2026-09 defects in business B. */
async function reproduce(c: C) {
  await c.query("set local session_replication_role = replica");  // bypass the H-4 direct-write guards for fixture setup only
  const draft = await insertInvoice(c, 'B', 'draft', 1);
  const voided = await insertInvoice(c, 'B', 'void', 2);
  const cn = await insertInvoice(c, 'B', 'credit_note', 3, 'credit_note');
  const sent = await insertInvoice(c, 'B', 'sent', 4);
  await c.query("set local session_replication_role = origin");
  await saleMove(c, 'B', draft, 2);   // backfill status defect
  await saleMove(c, 'B', voided, 1);  // void, never returned
  await saleMove(c, 'B', cn, 1);      // credit note released stock
  await saleMove(c, 'B', sent, 3);    // live sale, COGS never posted (legacy client partial)
  // 20261010000000-style direct balance rewrite: quantity changed with no movement and no journal.
  await c.query('update public.inventory_balances set average_cost=900 where business_id=$1', [orgs.B.business]);
  return { draft, voided, cn, sent };
}
const plan = async (c: C) => (await c.query('select * from ledgr_repair.plan_2026_09($1) order by category, object_ref', [orgs.B.business])).rows;
const planHash = async (c: C) => String((await c.query('select ledgr_repair.plan_hash_2026_09($1) h', [orgs.B.business])).rows[0].h);
const apply = (c: C, ev: string | null, hash: string | null) =>
  c.query('select ledgr_repair.apply_2026_09($1,$2,$3) r', [ev, hash, orgs.B.business]).then((r) => r.rows[0].r as Record<string, any>);
const glVsSub = async (c: C) => {
  const r = (await c.query('select ledgr_repair._gl_inventory($1) gl, ledgr_repair._subledger_value($1) sub', [orgs.B.business])).rows[0];
  return { gl: Math.round(Number(r.gl) * 100) / 100, sub: Math.round(Number(r.sub) * 100) / 100 };
};

test(meta('OD.REPAIR.PLAN-SIZES-DEFECTS', 'On a synthetic reproduction the read-only plan lists D1 compensations for the draft (2), void-not-returned (1) and credit-note (1) invoices, D2 missing COGS for the sent invoice (3 × 900 = 2700), and one D3 GL true-up; the live sent invoice gets NO D1 row; sizing writes nothing', MR), async () => {
  ready();
  await rolledBack(async (c) => {
    const ids = await reproduce(c);
    const before = (await c.query('select (select count(*) from public.stock_movements)::int m, (select count(*) from public.journal_entries)::int j')).rows[0];
    const rows = await plan(c);
    const d1 = rows.filter((r) => r.category === 'D1_INVALID_SALE_MOVEMENT');
    expect(Object.fromEntries(d1.map((r) => [r.object_ref, Number(r.quantity)]))).toEqual({ [ids.draft]: 2, [ids.voided]: 1, [ids.cn]: 1 });
    const d2 = rows.filter((r) => r.category === 'D2_MISSING_COGS');
    expect(d2.map((r) => [r.object_ref, Number(r.amount)])).toEqual([[ids.sent, 2700]]);
    expect(rows.filter((r) => r.category === 'D3_GL_RECONCILIATION').length).toBe(1);
    const after = (await c.query('select (select count(*) from public.stock_movements)::int m, (select count(*) from public.journal_entries)::int j')).rows[0];
    expect(after).toEqual(before);
  });
});

test(meta('OD.REPAIR.REFUSES-WITHOUT-EVIDENCE-OR-HASH', 'apply refuses 22023 without an evidence reference, with a too-short one, with no plan hash, and with a stale/wrong plan hash; nothing is written (no run row, no movement, no journal)', MR), async () => {
  ready();
  await rolledBack(async (c) => {
    await reproduce(c);
    const h = await planHash(c);
    const count = async () => (await c.query('select (select count(*) from public.stock_movements)::int m, (select count(*) from public.journal_entries)::int j, (select count(*) from ledgr_repair.runs)::int r')).rows[0];
    const before = await count();
    await failsWith(c, () => apply(c, null, h), ['22023'], /evidence reference/);
    await failsWith(c, () => apply(c, 'short', h), ['22023'], /evidence reference/);
    await failsWith(c, () => apply(c, 'EVIDENCE-OD-SYNTHETIC-1', null), ['22023'], /plan changed/);
    await failsWith(c, () => apply(c, 'EVIDENCE-OD-SYNTHETIC-1', EMPTY), ['22023'], /plan changed/);
    expect(await count()).toEqual(before);
  });
});

test(meta('OD.REPAIR.APPLY-ADDITIVE-AND-BALANCED', 'apply with evidence + the reviewed hash: 3 compensating adjustment_in movements (source_type repair_2026_09), 1 keyed COGS entry (invoice:<id>:cogs, 2700), 1 keyed reconciliation entry; afterwards inventory GL = stock subledger, the remaining plan is empty (hash of nothing), NOTHING pre-existing was deleted or altered (every prior movement/journal id and quantity still present), and every correction is in repair_log with the evidence ref', MR), async () => {
  ready();
  await rolledBack(async (c) => {
    const ids = await reproduce(c);
    const snapshot = async () => (await c.query("select 'm:'||id||':'||quantity k from public.stock_movements union all select 'j:'||id||':'||status from public.journal_entries union all select 'i:'||id||':'||status from public.invoices")).rows.map((r) => r.k as string).sort();
    const prior = await snapshot();
    const h = await planHash(c);
    const r = await apply(c, 'EVIDENCE-OD-SYNTHETIC-1', h);
    expect([r.d1_movements, r.d2_cogs_entries, r.d3_reconciliations]).toEqual([3, 1, 1]);
    expect(r.remaining_plan_hash).toBe(EMPTY);
    const now = new Set(await snapshot());
    for (const k of prior) expect(now.has(k)).toBe(true);
    const moves = (await c.query("select source_id, quantity from public.stock_movements where source_type='repair_2026_09' order by source_id")).rows;
    expect(moves.length).toBe(3);
    expect(Object.fromEntries(moves.map((m) => [m.source_id, Number(m.quantity)]))).toEqual({ [ids.draft]: 2, [ids.voided]: 1, [ids.cn]: 1 });
    expect((await c.query('select count(*)::int n from public.journal_entries where posting_key=$1', [`invoice:${ids.sent}:cogs`])).rows[0].n).toBe(1);
    const { gl, sub } = await glVsSub(c);
    expect(gl).toBe(sub);
    const log = (await c.query('select count(*)::int n from ledgr_repair.repair_log l join ledgr_repair.runs r using (run_id) where r.evidence_ref=$1', ['EVIDENCE-OD-SYNTHETIC-1'])).rows[0].n;
    expect(log).toBe(5);
  });
});

test(meta('OD.REPAIR.IDEMPOTENT', 'A second apply (with the new, empty plan hash) makes no change: 0/0/0 corrections, no new movement or journal; the first run hash can no longer be replayed (22023)', MR), async () => {
  ready();
  await rolledBack(async (c) => {
    await reproduce(c);
    const h = await planHash(c);
    await apply(c, 'EVIDENCE-OD-SYNTHETIC-1', h);
    const count = async () => (await c.query('select (select count(*) from public.stock_movements)::int m, (select count(*) from public.journal_entries)::int j')).rows[0];
    const before = await count();
    await failsWith(c, () => apply(c, 'EVIDENCE-OD-SYNTHETIC-1', h), ['22023'], /plan changed/);
    const again = await apply(c, 'EVIDENCE-OD-SYNTHETIC-2', await planHash(c));
    expect([again.d1_movements, again.d2_cogs_entries, again.d3_reconciliations]).toEqual([0, 0, 0]);
    expect(await count()).toEqual(before);
  });
});

test(meta('OD.REPAIR.NOT-CALLABLE-FROM-APP', 'The repair is operator-only: authenticated callers (even an owner) and anon cannot use the ledgr_repair schema or execute plan/apply (42501)', MR), async () => {
  ready();
  for (const [role, uid] of [['authenticated', identities.B_owner.id], ['anon', null]] as const) {
    await db.asRole(role, uid, async (c: C) => {
      await failsWith(c, () => c.query('select ledgr_repair.plan_hash_2026_09(null)'), ['42501']);
      await failsWith(c, () => c.query("select ledgr_repair.apply_2026_09('EVIDENCE-OD-SYNTHETIC-1', 'x', null)"), ['42501']);
      await failsWith(c, () => c.query('select * from ledgr_repair.runs'), ['42501']);
    });
  }
});
