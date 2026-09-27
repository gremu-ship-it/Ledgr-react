/**
 * RETAIL CUSTOMER WORKFLOW SIMULATION (2026-09-27 audit)
 *
 * One realistic retail business — Business → Branch → Inventory location →
 * Products → Opening stock → Sale prices → Cashier → Manager/supervisor →
 * Till → Shift — then the 12 mandated scenarios from cash sale to replay,
 * executed against a full migration replay of the CURRENT branch with the
 * PRODUCTION-shaped schema (uuid source_id/created_by columns), using the REAL
 * client payload builders (buildPosSaleQueuePayload → buildPosSaleRpcPayload).
 *
 * Every scenario asserts observable database truth: tables, rows, journal
 * lines, stock balances, shift numbers. Nothing is inferred from function
 * names. This suite is NOT part of the release gate; it is the audit's
 * end-to-end retail journey.
 */
import { beforeAll, afterAll, test, expect } from 'vitest';
import { createDatabaseFixture } from '../release/database.mjs';
import { buildPosSaleQueuePayload, calculateCartTotals } from '@/services/posService';
import { buildPosSaleRpcPayload } from '@/services/posSaleRpc';
import type { PosCartItem, PosSalePayload } from '@/types/pos';

type Q = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let q: Q; // shared client; role switching below
const uid = (n: number) => `14000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const key = (n: number) => `14000000-1000-4000-8000-${String(n).padStart(12, '0')}`;

const OWNER = uid(1), MANAGER = uid(2), CASHIER = uid(3), FOREIGN = uid(9);
const DAY = new Date().toISOString().slice(0, 10);

let business = '', branch = '', branchNoLoc = '', location = '', terminal = '', shift: string | null = null;
const products: Record<string, { id: string; name: string; price: number; cost: number; qty: number }> = {};

/** Session-level role switch (state persists across statements — scenarios COMMIT). */
async function as(user: string | null) {
  await q.query('reset role');
  await q.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role',$2,false)", [user ?? '', user ? 'authenticated' : 'postgres']);
  if (user) await q.query('set role authenticated');
}
const su = () => as(null);

async function call(sql: string, values: unknown[] = []): Promise<any> {
  const r = await q.query(sql, values);
  return r.rows[0]?.r ?? r.rows[0];
}
const rpc = <T = any>(fn: string, payload: unknown, user: string): Promise<T> =>
  (as(user).then(() => q.query(`select public.${fn}($1::jsonb) r`, [JSON.stringify(payload)])) as Promise<{ rows: { r: T }[] }>).then((r) => r.rows[0].r);
const rpcArgs = <T = any>(fnAndArgs: string, user: string, values: unknown[] = []): Promise<T> =>
  (as(user).then(() => q.query(`select ${fnAndArgs} r`, values)) as Promise<{ rows: { r: T }[] }>).then((r) => r.rows[0].r);

async function expectDenial(fn: () => Promise<unknown>, code: string, message?: RegExp) {
  let caught: { code?: string; message?: string } | undefined;
  try { await fn(); } catch (e) { caught = e as { code?: string; message?: string }; }
  if (!caught) throw new Error(`Expected denial ${code}, but the call succeeded.`);
  expect(caught.code).toBe(code);
  if (message) expect(caught.message ?? '').toMatch(message);
  return caught;
}

/** The exact client payload the till builds (PosPaymentModal → processSale). */
function salePayload(opts: {
  n: number; items: PosCartItem[]; payments: { payment_method: string; amount: number; bank_account_id?: string | null }[];
  credit?: boolean; customerName?: string; orderDiscount?: { type: 'percent'; value: number };
  discountToken?: string | null; lineTokens?: (string | null)[];
}): { rpcPayload: Record<string, unknown>; clientKey: string } {
  const totals = calculateCartTotals(opts.items, opts.orderDiscount);
  const payload: PosSalePayload = {
    businessId: business,
    branchId: branch,
    shiftId: shift,
    cashierId: CASHIER,
    cashierName: 'Grace Cashier',
    customerName: opts.customerName ?? 'Walk-in Customer',
    customerId: null,
    items: opts.items,
    totals,
    orderDiscount: opts.orderDiscount,
    discountOverrideToken: opts.discountToken,
    payments: opts.credit ? [] : opts.payments,
    totalPaid: opts.credit ? 0 : opts.payments.reduce((s, p) => s + p.amount, 0),
    changeGiven: 0,
    isCreditSale: Boolean(opts.credit),
    notes: 'Retail scenario',
  } as unknown as PosSalePayload;
  const clientKey = key(opts.n);
  const queuePayload = buildPosSaleQueuePayload(payload, { clientKey, receiptNumber: `SCENARIO-${opts.n}` });
  if (opts.lineTokens || opts.discountToken) (queuePayload as any).overrides = { discountToken: opts.discountToken ?? null, lineTokens: opts.lineTokens ?? opts.items.map(() => null) };
  const rpcPayload = buildPosSaleRpcPayload(queuePayload, business, clientKey);
  return { rpcPayload, clientKey };
}

async function postSale(user: string, opts: Parameters<typeof salePayload>[0]) {
  const { rpcPayload } = salePayload(opts);
  (globalThis as any).__lastRpcPayload = rpcPayload;
  (globalThis as any).__lastRpcUser = user;
  return rpc('post_pos_sale', rpcPayload, user);
}

const item = (p: { id: string; name: string; price: number; qty: number; discount?: { type: 'percent'; value: number } }): PosCartItem =>
  ({ product_id: p.id, name: p.name, quantity: p.qty, unit_price: p.price,
     line_total: Math.round((p.qty * p.price - (p.discount ? (p.qty * p.price * p.discount.value) / 100 : 0)) * 100) / 100,
     discount: p.discount } as PosCartItem);

const n = async (sql: string, v?: unknown[]) => Number((await q.query(sql, v)).rows[0].n);
const stock = (code: string) => n('select coalesce(sum(quantity_on_hand),0) n from public.inventory_balances where product_id=$1 and location_id=$2', [products[code].id, location]);
const journalLines = (postingKeyLike: string) => q.query(
  `select a.code, l.amount, (l.is_debit::text = 'true' or l.is_debit::text = 't') as is_debit
     from public.journal_entries je
     join public.journal_lines l on l.journal_entry_id=je.id join public.accounts a on a.id=l.account_id
    where je.business_id=$1 and je.posting_key like $2 order by a.code, l.is_debit desc`, [business, postingKeyLike]);

beforeAll(async () => {
  db = await createDatabaseFixture();
  q = db.client as unknown as Q;
  await su();
  for (const [id, email, name] of [[OWNER, 'owner@kwacha.mw', 'A. Owner'], [MANAGER, 'manager@kwacha.mw', 'M. Manager'], [CASHIER, 'cashier@kwacha.mw', 'Grace Cashier'], [FOREIGN, 'foreign@other.mw', 'Foreign Owner']] as const) {
    await q.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)', [id, email, JSON.stringify({ full_name: name })]);
    await q.query('insert into public.user_profiles(id,full_name) values($1,$2) on conflict(id) do nothing', [id, name]);
  }
  await q.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','service_role',false)", [OWNER]);
  business = String((await q.query("select public.create_business_with_owner($1,'R13',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') id",
    ['Kwacha Retail Ltd'])).rows[0].id);
  await su();
  branch = String((await q.query('insert into public.branches(business_id,name,code) values($1,$2,$3) returning id', [business, 'Shop A', 'SA'])).rows[0].id);
  branchNoLoc = String((await q.query('insert into public.branches(business_id,name,code) values($1,$2,$3) returning id', [business, 'Shop B', 'SB'])).rows[0].id);
  location = String((await q.query('insert into public.inventory_locations(business_id,name,is_default,branch_id) values($1,$2,true,$3) returning id', [business, 'Shop A Stock', branch])).rows[0].id);
  await q.query("insert into public.business_users(business_id,user_id,role,is_active,branch_id) values($1,$2,'manager',true,null)", [business, MANAGER]);
  await q.query("insert into public.business_users(business_id,user_id,role,is_active,branch_id) values($1,$2,'cashier',true,$3)", [business, CASHIER, branch]);
  for (const [code, name, price, cost, qty] of [['CANDLE', 'Candle 2-Pack', 500, 300, 100], ['SOAP', 'Soap Bar', 1200, 700, 50], ['OIL', 'Cooking Oil 2L', 8500, 6000, 20]] as const) {
    const id = String((await q.query("insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code) values($1,$2,$3,$4,$5,'MWK','product',true,'none','none') returning id",
      [business, name, code, price, cost])).rows[0].id);
    products[code] = { id, name, price, cost, qty };
    await q.query("insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id,reference,notes) values($1,$2,$3,'opening_balance',$4,$5,$6,'manual',gen_random_uuid(),$7,'Retail scenario opening stock')",
      [business, id, location, DAY, qty, cost, `OPEN-${code}`]);
  }
  terminal = String((await q.query('insert into public.pos_terminals(business_id,name,branch_id) values($1,$2,$3) returning id', [business, 'Till 1', branch])).rows[0].id);
  // NOTE: no contacts exist — the first walk-in sale must still work (FIX D).
}, 600000);

afterAll(async () => { if (db) await db.cleanup(); });

test('scenario 0 — stock visibility and open shift', async () => {
  await su();
  const avail = await rpcArgs('public.pos_stock_availability($1,$2)', CASHIER, [business, branch]);
  expect(avail.branch_location_missing).toBe(false);
  const candle = (avail.balances ?? []).find((x: any) => x.product_id === products.CANDLE.id);
  expect(Number(candle?.quantity_on_hand ?? -1)).toBe(100);
  const opened = await rpc('open_pos_shift_command', { business_id: business, terminal_id: terminal, command_key: 'scenario-open-1', opening_cash: 10000 }, CASHIER);
  expect(opened.result).toBe('open');
  shift = String(opened.shift_id);
  await expectDenial(() => rpc('open_pos_shift_command', { business_id: business, terminal_id: terminal, command_key: 'scenario-open-2', opening_cash: 0 }, CASHIER), '22023');
});

test('scenario 1 — normal cash sale (1 product, 1 qty, cash)', async () => {
  const r = await postSale(CASHIER, { n: 1, items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 1 })], payments: [{ payment_method: 'cash', amount: 500 }] });
  expect(r.idempotent).toBe(false);
  const invId = String(r.id);
  (globalThis as any).__s1 = { invoiceId: invId, payload: (globalThis as any).__lastRpcPayload };
  const inv = (await su().then(() => q.query('select status, total_amount, amount_paid, amount_due, pos_shift_id, branch_id, contact_id, invoice_number, journal_entry_id from public.invoices where id=$1', [invId]))).rows[0];
  expect(inv.status).toBe('paid');            // FIX A: settled till sale lands paid
  expect(Number(inv.total_amount)).toBe(500);
  expect(Number(inv.amount_paid)).toBe(500);
  expect(Number(inv.amount_due)).toBe(0);
  expect(inv.pos_shift_id).toBe(shift);
  expect(inv.branch_id).toBe(branch);
  expect(inv.journal_entry_id).toBeTruthy();
  // Walk-in on a contact-less business still resolves (FIX D)
  const contact = (await q.query('select name from public.contacts where id=$1', [inv.contact_id])).rows[0];
  expect(contact.name).toBe('Walk-in Customer');
  expect(await n('select count(*) n from public.invoice_payments where invoice_id=$1', [invId])).toBe(1);
  expect(await stock('CANDLE')).toBe(99);
  const saleLines = await journalLines(`invoice:${invId}:sale`);
  expect(saleLines.rows.map((l: any) => [l.code, Number(l.amount), l.is_debit]).sort()).toEqual([['1131', 500, true], ['4112', 500, false]]);
  const setLines = await journalLines(`invoice:${invId}:settlement:%`);
  expect(setLines.rows.map((l: any) => [l.code, Number(l.amount), l.is_debit]).sort()).toEqual([['1110', 500, true], ['1131', 500, false]]);
  const cogsLines = await journalLines(`invoice:${invId}:cogs`);
  expect(cogsLines.rows.map((l: any) => [l.code, Number(l.amount), l.is_debit]).sort()).toEqual([['1141', 300, false], ['5100', 300, true]]);
  const s = (await q.query('select cash_sales_amount, expected_cash from public.pos_shifts where id=$1', [shift])).rows[0];
  expect(Number(s.cash_sales_amount)).toBe(500);
  expect(Number(s.expected_cash)).toBe(10500);
});

test('scenario 1b — sale WITHOUT a shift (no-shift path)', async () => {
  const shiftWas = shift;
  shift = null;
  const r = await postSale(CASHIER, { n: 11, items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 1 })], payments: [{ payment_method: 'cash', amount: 500 }] });
  shift = shiftWas;
  expect(String(r.id)).toBeTruthy(); // FIX C: no more 55000 crash
  const inv = (await su().then(() => q.query('select status, pos_shift_id from public.invoices where id=$1', [r.id]))).rows[0];
  expect(inv.status).toBe('paid');
  expect(inv.pos_shift_id).toBeNull();
});

test('scenario 2 — multiple products, different quantities', async () => {
  const r = await postSale(CASHIER, {
    n: 2,
    items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 2 }),
            item({ id: products.SOAP.id, name: products.SOAP.name, price: 1200, qty: 1 }),
            item({ id: products.OIL.id, name: products.OIL.name, price: 8500, qty: 1 })],
    payments: [{ payment_method: 'cash', amount: 10700 }],
  });
  const invId = String(r.id);
  (globalThis as any).__s2 = { invoiceId: invId };
  const lines = (await su().then(() => q.query('select product_id, quantity, line_total from public.invoice_lines where invoice_id=$1 order by line_number', [invId]))).rows;
  expect(lines.map((l: any) => [String(l.product_id), Number(l.quantity), Number(l.line_total)])).toEqual([
    [products.CANDLE.id, 2, 1000], [products.SOAP.id, 1, 1200], [products.OIL.id, 1, 8500]]);
  expect(await stock('CANDLE')).toBe(96); // 100 − 1 (s1) − 1 (s1b) − 2 (s2)
  const cogs = await journalLines(`invoice:${invId}:cogs`);
  // 2×300 + 700 + 6000 = 7300 per side
  const debits = cogs.rows.filter((l: any) => l.is_debit).reduce((s: number, l: any) => s + Number(l.amount), 0);
  expect(debits).toBe(7300);
  (globalThis as any).__s2 = { invoiceId: invId };
});

test('scenario 3 — split tender (cash + mobile money) reaches the correct accounts', async () => {
  const r = await postSale(CASHIER, {
    n: 3,
    items: [item({ id: products.SOAP.id, name: products.SOAP.name, price: 1200, qty: 1 })],
    payments: [{ payment_method: 'cash', amount: 700 }, { payment_method: 'airtel_money', amount: 500 }],
  });
  const invId = String(r.id);
  const setLines = await su().then(() => journalLines(`invoice:${invId}:settlement:%`));
  const debitAccounts = setLines.rows.filter((l: any) => l.is_debit).map((l: any) => l.code).sort();
  expect(debitAccounts).toEqual(['1110', '1125']); // FIX B: cash→1110, airtel→1125
  const pays = (await q.query('select payment_method, amount from public.invoice_payments where invoice_id=$1 order by payment_method', [invId])).rows;
  expect(pays.map((p: any) => [p.payment_method, Number(p.amount)]).sort()).toEqual([['airtel_money', 500], ['cash', 700]]);
});

test('scenario 4 — credit sale (customer, receivable, no fake payment)', async () => {
  await su();
  const mary = String((await q.query("insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt,phone) values($1,'Mary Banda','customer',true,false,'0888123456') returning id", [business])).rows[0].id);
  const saleOpts = { n: 4, credit: true, customerName: 'Mary Banda', customerId: mary,
    items: [item({ id: products.OIL.id, name: products.OIL.name, price: 8500, qty: 1 })],
    payments: [] } as any;
  const { rpcPayload } = salePayload(saleOpts);
  (rpcPayload.invoice as Record<string, unknown>).contact_id = mary; // the till sends the selected customer
  const r = await rpc('post_pos_sale', rpcPayload, CASHIER);
  const invId = String(r.id);
  const inv = (await su().then(() => q.query('select status, amount_paid, amount_due, contact_id from public.invoices where id=$1', [invId]))).rows[0];
  expect(inv.status).toBe('sent');           // credit sale stays unpaid
  expect(Number(inv.amount_paid)).toBe(0);
  expect(Number(inv.amount_due)).toBe(8500);
  expect(await n('select count(*) n from public.invoice_payments where invoice_id=$1', [invId])).toBe(0);
  const contact = (await q.query('select name from public.contacts where id=$1', [inv.contact_id])).rows[0];
  expect(contact.name).toContain('Mary');
  const saleLines = await journalLines(`invoice:${invId}:sale`);
  expect(saleLines.rows.map((l: any) => [l.code, Number(l.amount), l.is_debit]).sort()).toEqual([['1131', 8500, true], ['4112', 8500, false]]);
  expect(await n(`select count(*) n from public.journal_entries where business_id=$1 and posting_key like 'invoice:'||$2||':settlement:%'`, [business, invId])).toBe(0);
});

test('scenario 5 — discount within the cashier cap, then above it', async () => {
  const ok = await postSale(CASHIER, {
    n: 5, orderDiscount: { type: 'percent', value: 10 },
    items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 2 })],
    payments: [{ payment_method: 'cash', amount: 900 }],
  });
  expect(String(ok.id)).toBeTruthy();
  const before = await su().then(() => n('select count(*) n from public.invoices'));
  await expectDenial(() => postSale(CASHIER, {
    n: 6, orderDiscount: { type: 'percent', value: 30 },
    items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 2 })],
    payments: [{ payment_method: 'cash', amount: 700 }],
  }), '22023', /discount-override-required/);
  expect(await n('select count(*) n from public.invoices')).toBe(before);
});

test('scenario 5b — over-cap discount with a supervisor token (single use)', async () => {
  const req = await rpcArgs('public.request_pos_price_override($1,$2,null,null,$3,$4)', CASHIER, [business, 'discount', 30, 'Scenario 5b']);
  // A manager (cap 25) may NOT authorize a 30% discount — only the owner can.
  await expectDenial(() => rpcArgs('public.authorize_pos_price_override($1)', MANAGER, [req.token]), '42501', /above your own approval limit/i);
  expect(req.token).toBeTruthy();
  await expectDenial(() => rpcArgs('public.authorize_pos_price_override($1)', CASHIER, [req.token]), '42501');
  const auth = await rpcArgs('public.authorize_pos_price_override($1)', OWNER, [req.token]);
  expect(auth.status).toBe('authorized');
  const ok = await postSale(CASHIER, {
    n: 6, orderDiscount: { type: 'percent', value: 30 }, discountToken: req.token,
    items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 2 })],
    payments: [{ payment_method: 'cash', amount: 700 }],
  });
  expect(String(ok.id)).toBeTruthy();
  await expectDenial(() => postSale(CASHIER, {
    n: 7, orderDiscount: { type: 'percent', value: 30 }, discountToken: req.token,
    items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 2 })],
    payments: [{ payment_method: 'cash', amount: 700 }],
  }), '22023');
});

test('scenario 6 — price override: cashier refused, supervisor direct', async () => {
  await expectDenial(() => postSale(CASHIER, {
    n: 8,
    items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 400, qty: 1 })],
    payments: [{ payment_method: 'cash', amount: 400 }],
  }), '22023', /price-override-required/);
  const { rpcPayload } = salePayload({
    n: 8,
    items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 400, qty: 1 })],
    payments: [{ payment_method: 'cash', amount: 400 }],
  });
  const ok = await rpc('post_pos_sale', rpcPayload, MANAGER);
  expect(String(ok.id)).toBeTruthy();
});

test('scenario 7 — insufficient stock fails safely', async () => {
  await su();
  const invoicesBefore = await n('select count(*) n from public.invoices');
  const movesBefore = await n('select count(*) n from public.stock_movements');
  await expectDenial(() => postSale(CASHIER, {
    n: 9,
    items: [item({ id: products.OIL.id, name: products.OIL.name, price: 8500, qty: 500 })],
    payments: [{ payment_method: 'cash', amount: 4250000 }],
  }), '23514');
  await su();
  expect(await n('select count(*) n from public.invoices')).toBe(invoicesBefore);
  expect(await n('select count(*) n from public.stock_movements')).toBe(movesBefore);
});

test('scenario 8/12 — replay of the same sale and client key (offline reconnect)', async () => {
  // The offline queue stores the payload at receipt time and replays THAT object.
  const rpcPayload = (globalThis as any).__s1.payload;
  const replay = await rpc('post_pos_sale', rpcPayload, CASHIER);
  expect(replay.idempotent).toBe(true);
  const s1 = (globalThis as any).__s1.invoiceId;
  expect(String(replay.id)).toBe(s1);
  expect(await su().then(() => n('select count(*) n from public.invoices where client_key::text=$1', [key(1)]))).toBe(1);
  expect(await n('select count(*) n from public.invoice_payments where invoice_id=$1', [s1])).toBe(1);
  expect(await n('select count(*) n from public.stock_movements where source_type=\'invoice\' and source_id::text=$1', [s1])).toBe(1);
  expect(await n('select count(*) n from public.journal_entries where business_id=$1 and posting_key like \'invoice:\'||$2||\':%\'', [business, s1])).toBe(3);
  const tampered = JSON.parse(JSON.stringify(rpcPayload));
  tampered.invoice.total_amount = 999;
  await expectDenial(() => rpc('post_pos_sale', tampered, CASHIER), '22023', /mismatch/i);
});

test('scenario 9 — refund flow (approval, reversal, restock)', async () => {
  await su();
  const s1 = String((globalThis as any).__s1.invoiceId);
  const stockBefore = await stock('CANDLE');
  const req = await rpcArgs('public.request_pos_approval($1,$2,$3,$4,$5)', CASHIER, [business, 'refund_sale', s1, 500, 'Damaged goods']);
  await expectDenial(() => rpcArgs('public.authorize_pos_approval($1)', CASHIER, [req.token]), '42501'); // cashier holds no authority
  await rpcArgs('public.authorize_pos_approval($1)', MANAGER, [req.token]);
  const refundPayload = { business_id: business, invoice_id: s1, command_key: 'scenario-refund-1', reason: 'Damaged goods',
    approval_token: req.token,
    lines: [{ product_id: products.CANDLE.id, quantity: 1, amount: 500, description: 'Candle return' }], refund_method: 'cash' };
  const refund = await rpc('refund_pos_sale_command', refundPayload, CASHIER);
  expect(refund.idempotent).toBe(false);
  expect(Number(refund.amount)).toBe(500);
  await su();
  expect(await stock('CANDLE')).toBe(stockBefore + 1);
  expect(await n("select count(*) n from public.journal_entries where business_id=$1 and posting_key like 'refund:scenario-refund-1:%'", [business])).toBe(3); // sale + settlement + COGS mirrors
  const replay = await rpc('refund_pos_sale_command', refundPayload, CASHIER);
  expect(replay.idempotent).toBe(true);
  // A manager (direct tier, no approval needed) still cannot over-refund: the
  // cumulative cap is server-side.
  await expectDenial(() => rpc('refund_pos_sale_command', { ...refundPayload, command_key: 'scenario-refund-2', approval_token: null }, MANAGER), '22023', /exceeds the remaining refundable/i);
});

test('scenario 10 — void flow (approval, full reversal, restock)', async () => {
  await su();
  const s2 = String((globalThis as any).__s2.invoiceId);
  const before = { CANDLE: await stock('CANDLE'), SOAP: await stock('SOAP'), OIL: await stock('OIL') };
  const req = await rpcArgs('public.request_pos_approval($1,$2,$3,null,$4)', CASHIER, [business, 'void_sale', s2, 'Wrong sale']);
  await rpcArgs('public.authorize_pos_approval($1)', MANAGER, [req.token]);
  const voidPayload = { business_id: business, invoice_id: s2, command_key: 'scenario-void-1', reason: 'Wrong sale', approval_token: req.token };
  const voided = await rpc('void_pos_sale_command', voidPayload, CASHIER);
  expect(voided.status).toBe('void');
  await su();
  expect(await stock('CANDLE')).toBe(before.CANDLE + 2);
  expect(await stock('SOAP')).toBe(before.SOAP + 1);
  expect(await stock('OIL')).toBe(before.OIL + 1);
  expect(await n("select count(*) n from public.journal_entries where business_id=$1 and posting_key like 'void:%' and source_id::text=$2", [business, s2])).toBe(3);
  // FIX E: the COGS mirror must exist and balance the original COGS entry
  // (one line per product per side: 600 + 700 + 6000).
  const cogsMirror = await journalLines(`invoice:${s2}:cogs`);
  const voidCogs = await q.query(
    `select a.code, (l.is_debit::text = 'true' or l.is_debit::text = 't') is_debit, l.amount from public.journal_entries je
       join public.journal_lines l on l.journal_entry_id=je.id join public.accounts a on a.id=l.account_id
      where je.business_id=$1 and je.posting_key like 'void:%' and a.code in ('5100','1141')`, [business]);
  expect(voidCogs.rows.length).toBe(6); // 3 products × (DR Inventory 1141 / CR COGS 5100)
  const originalDebit = cogsMirror.rows.filter((l: any) => l.is_debit).reduce((s3: number, l: any) => s3 + Number(l.amount), 0);
  const voidedDebit = voidCogs.rows.filter((l: any) => l.is_debit).reduce((s3: number, l: any) => s3 + Number(l.amount), 0);
  const voidedCredit = voidCogs.rows.filter((l: any) => !l.is_debit).reduce((s3: number, l: any) => s3 + Number(l.amount), 0);
  expect(originalDebit).toBe(7300);
  expect(voidedDebit).toBe(7300);   // inventory restored
  expect(voidedCredit).toBe(7300);  // COGS reversed
  // Re-void refused (a manager executes it directly — the original approval
  // token was consumed single-use by the first void, as designed).
  await expectDenial(() => rpc('void_pos_sale_command', { ...voidPayload, command_key: 'scenario-void-2', approval_token: null }, MANAGER), '22023', /already been voided/i);
});

test('scenario 11 — close shift, Z-report, variance, late arrival', async () => {
  await su();
  await rpc('record_pos_cash_movement_command', { business_id: business, shift_id: shift, command_key: 'scenario-mv-1', movement_type: 'cash_in', amount: 2000, reason: 'Float top-up' }, CASHIER);
  await rpc('record_pos_cash_movement_command', { business_id: business, shift_id: shift, command_key: 'scenario-mv-2', movement_type: 'petty_cash', amount: 500, reason: 'Tea' }, CASHIER);
  const report = await rpcArgs('public.get_pos_shift_report($1)', CASHIER, [shift]);
  // Sales on THIS shift: s1 (cash 500) + s3 (cash 700 + airtel 500) + s5 (900 cash)
  // + s5b (700 cash) + s6-manager (400 cash). s1b has no shift; s2 is VOIDED; s4 credit (no tenders).
  expect(Number(report.cash_tenders)).toBe(3200);
  expect(Number(report.other_tenders)).toBe(500);
  expect(Number(report.sales_count)).toBe(5);
  expect(Number(report.refund_total)).toBe(500);
  expect(report.tender_breakdown).toEqual({ cash: 3200, airtel_money: 500 });
  // expected = 10000 + 3200 − 500 + 2000 − 500 = 14200
  expect(Number(report.expected_cash)).toBe(14200);
  const closed = await rpc('close_pos_shift_command', { shift_id: shift, command_key: 'scenario-close-1', closing_cash: 14200 }, CASHIER);
  expect(closed.report_number).toMatch(/^Z-\d{4}-\d+$/);
  expect(Number(closed.variance)).toBe(0);
  expect(Number(closed.cash_tenders)).toBe(3200);
  // Late arrival after close → append-only adjustment, close immutable.
  const late = await postSale(CASHIER, {
    n: 20, items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 1 })],
    payments: [{ payment_method: 'cash', amount: 500 }],
  });
  expect(String(late.id)).toBeTruthy();
  const adj = (await su().then(() => q.query('select amount from public.pos_shift_late_adjustments where shift_id=$1', [shift]))).rows;
  expect(adj.length).toBe(1);
  expect(Number(adj[0].amount)).toBe(500);
  await expectDenial(() => rpc('close_pos_shift_command', { shift_id: shift, command_key: 'scenario-close-2', closing_cash: 0 }, CASHIER), '22023', /immutable/i);
});

test('cross-tenant and branch-location guards', async () => {
  await su();
  // Foreign business + foreign cashier
  await q.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claim.role','service_role',false)", [FOREIGN]);
  const fb = String((await q.query("select public.create_business_with_owner($1,'R13',null,null,null,false,'MWK','07-01','UTC',null,null,'Malawi',null,null,null,'INV','EXP','PAY') id", ['Other Shop'])).rows[0].id);
  await q.query("insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'cashier',true)", [fb, uid(10)]);
  await su();
  const { rpcPayload } = salePayload({
    n: 30, items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 1 })],
    payments: [{ payment_method: 'cash', amount: 500 }],
  });
  rpcPayload.business_id = fb;
  await expectDenial(() => rpc('post_pos_sale', rpcPayload, FOREIGN), '22023');
  // Branch without a stock location: stock sale refused (owner decision, no fallback).
  const noLoc = salePayload({
    n: 31, items: [item({ id: products.CANDLE.id, name: products.CANDLE.name, price: 500, qty: 1 })],
    payments: [{ payment_method: 'cash', amount: 500 }],
  });
  (noLoc.rpcPayload.invoice as Record<string, unknown>).branch_id = branchNoLoc;
  await expectDenial(() => rpc('post_pos_sale', noLoc.rpcPayload, MANAGER), 'P0001', /branch-location-missing/i);
});

test('final ledger integrity — every journal entry balances', async () => {
  await su();
  const bad = (await q.query(`select je.entry_number, sum(case when l.is_debit then l.amount_base else -l.amount_base end) diff
    from public.journal_entries je join public.journal_lines l on l.journal_entry_id=je.id
    where je.business_id=$1 group by je.id, je.entry_number having abs(sum(case when l.is_debit then l.amount_base else -l.amount_base end)) > 0.005`, [business])).rows;
  expect(bad).toEqual([]);
});
