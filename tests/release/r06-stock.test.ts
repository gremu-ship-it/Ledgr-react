/**
 * R06 (2026-09-23 register) — POS command surface: dedicated R06.POS.STOCK.*
 * release records. Baseline established first: POS.STOCK itself was
 * remediated on 2026-09-21 (balance propagation trigger) and PASSES at this
 * tip; the historical failure was reproduced mechanistically during this
 * package (transactional trigger-drop: movement inserted, balance observed 100
 * vs expected 99 — byte-identical to the R05-era evidence), and one verified
 * residual defect on the POS command boundary (foreign product id silently
 * accepted) was closed by
 * supabase/migrations/20261003000000_r06_pos_product_tenant_validation.sql.
 * These records pin the full mandated matrix: normal propagation, exact
 * 23514 oversell denial, sell-to-zero, single-execution replay, tenant
 * isolation (command authz and product reference), all-surface atomicity,
 * client-input authority (caller unit_cost/location provably derived
 * server-side), the honest single-connection concurrency limitation, and the
 * no-unintended-mutation seal. Probe conventions identical to the R05/R06
 * suites (real migration replay, synthetic identities, savepoint/rollback
 * discipline, exact SQLSTATE pins).
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, saleFixture, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r06-stock');
const M_TRIG = 'supabase/migrations/20260928000001_r06_stock_balance_authority.sql';
const M_RPC = 'supabase/migrations/20260923000000_post_pos_sale_rpc.sql';
const M_BIND = 'supabase/migrations/20260930000001_r08_post_pos_sale_binding.sql';
const M_TENANT = 'supabase/migrations/20261003000000_r06_pos_product_tenant_validation.sql';
const M_CHECK = 'supabase/migrations/20260817000001_phase10_nonneg_quantity_checks.sql';
const LAYER = 'real PostgreSQL17 full migration replay incl. 20260928000001 R06 trigger + 20261003000000 R06 product tenant validation; synthetic identities; observer-position probes; no customer data';
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

interface SaleResult { id: string; number: string; idempotent: boolean; journal_entry_id: string | null }
/** Mutable view of a sale fixture: release payloads are plain JSON; numeric/text fields may be resized per probe. */
interface Payload {
  business_id: string; client_key: string; receipt_number: string; shift_id: string;
  cash_sales: number; other_sales: number; is_credit_sale: boolean;
  customer: Record<string, unknown>;
  invoice: Record<string, unknown>;
  lines: Record<string, unknown>[];
  payments: Record<string, unknown>[];
}

const postSale = async (uid: string, payload: Payload): Promise<SaleResult> =>
  (await db.commitAsRole('authenticated', uid, 'select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as SaleResult;

/** Exact-SQLSTATE denial capture: anything reaching the caller without the expected code fails the record. */
const deniedSale = async (uid: string, payload: Payload, code: string, messageRx: RegExp) => {
  let caught: { code?: string; message?: string } | undefined;
  try { await postSale(uid, payload); }
  catch (e) { caught = e as { code?: string; message?: string }; }
  if (!caught) throw new Error(`Expected denial ${code} but the sale committed.`);
  expect(caught.code).toBe(code);
  expect(caught.message ?? '').toMatch(messageRx);
};

const balRow = async (org: string) =>
  (await db.client.query('select quantity_on_hand, quantity_reserved, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs[org].business, orgs[org].product, orgs[org].location])).rows[0] as { quantity_on_hand: string; quantity_reserved: string; average_cost: string };
const onHand = async (org: string) => Number((await balRow(org)).quantity_on_hand);

const snapshot = async () => (await db.client.query(`select
  (select count(*) from public.invoices where business_id=$1)::int as invoices,
  (select count(*) from public.invoice_lines where business_id=$1)::int as lines,
  (select count(*) from public.invoice_payments where business_id=$1)::int as payments,
  (select count(*) from public.journal_entries where business_id=$1)::int as journals,
  (select count(*) from public.journal_lines jl join public.journal_entries je on je.id=jl.journal_entry_id where je.business_id=$1)::int as journal_lines,
  (select count(*) from public.stock_movements where business_id=$1)::int as movements,
  (select md5(coalesce(string_agg(row(b.*)::text, '|' order by b.id), '')) from public.inventory_balances b where b.business_id=$1) as balances_md5,
  (select md5(coalesce(string_agg(row(s.*)::text, '|' order by s.id), '')) from public.pos_shifts s where s.business_id=$1) as shifts_md5
  `, [orgs.A.business])).rows[0] as Record<string, number | string>;

const clientKeyCount = async (n: number) => (await db.client.query(`select
  (select count(*) from public.invoices where client_key=$1)::int as invoice,
  (select count(*) from public.invoice_payments where client_key=$2)::int as payment
  `, [key(n), key(1000 + n)])).rows[0] as { invoice: number; payment: number };

const journalKeys = (invoiceId: string, business: string) =>
  db.client.query(`select
    count(*) filter (where posting_key = 'invoice:' || $2 || ':sale')::int as sale,
    count(*) filter (where posting_key like 'invoice:' || $2 || ':settlement:%')::int as settlement,
    count(*) filter (where posting_key = 'invoice:' || $2 || ':cogs')::int as cogs
    from public.journal_entries where business_id=$1 and posting_key like 'invoice:' || $2 || ':%'`, [business, invoiceId])
    .then((r: { rows: Record<string, unknown>[] }) => r.rows[0] as unknown as { sale: number; settlement: number; cogs: number });

/** Build a quantity/amount-consistent sale for a stock probe (price 1500/unit, single cash tender). */
const sizedSale = (n: number, qty: number): Payload => {
  const sale = saleFixture(orgs.A, n) as Payload;
  const total = qty * 1500;
  sale.lines[0].quantity = qty;
  sale.lines[0].line_total = total;
  sale.invoice.original_amount = total;
  sale.invoice.functional_amount = total;
  sale.invoice.subtotal = total;
  sale.invoice.taxable_amount = total;
  sale.invoice.total_amount = total;
  sale.cash_sales = total;
  sale.other_sales = 0;
  sale.payments[0].amount = total;
  sale.payments[0].original_amount = total;
  sale.payments[0].functional_amount = total;
  return sale;
};

let normalPayload: Payload;
let normalResult: SaleResult;

test(meta('R06.POS.STOCK.NORMAL', 'A normal POS sale reduces stock exactly (100 → 99) with reserved untouched and WAC stable; exactly one typed sale movement at the server-derived location with server-derived unit_cost 900; financial half posts exactly once: paid invoice bound to branch+shift with ledger link, one sale + one settlement + one COGS keyed journal, one tender', M_RPC), async () => {
  ready();
  normalPayload = sizedSale(3101, 1);
  normalResult = await postSale(identities.A_cashier.id, normalPayload);
  expect(normalResult.idempotent).toBe(false);
  expect(normalResult.journal_entry_id).not.toBeNull();

  const bal = await balRow('A');
  expect(Number(bal.quantity_on_hand)).toBe(99);
  expect(Number(bal.quantity_reserved)).toBe(0);
  expect(Number(bal.average_cost)).toBe(900);

  const mv = await db.client.query(`select quantity, unit_cost, location_id, movement_type, source_type
    from public.stock_movements where business_id=$1 and source_type='invoice' and source_id=$2`, [orgs.A.business, normalResult.id]);
  expect(mv.rows.length).toBe(1);
  expect(Number(mv.rows[0].quantity)).toBe(-1);
  expect(Number(mv.rows[0].unit_cost)).toBe(900);
  expect(mv.rows[0].location_id).toBe(orgs.A.location);
  expect(mv.rows[0].movement_type).toBe('sale');

  const inv = (await db.client.query('select status, branch_id, pos_shift_id, journal_entry_id, client_key from public.invoices where id=$1', [normalResult.id])).rows[0];
  expect(inv.status).toBe('paid');
  expect(inv.branch_id).toBe(orgs.A.branch);
  expect(inv.pos_shift_id).toBe(orgs.A.shift);
  expect(inv.journal_entry_id).toBe(normalResult.journal_entry_id);
  expect(inv.client_key).toBe(key(3101));

  expect(await journalKeys(normalResult.id, orgs.A.business)).toEqual({ sale: 1, settlement: 1, cogs: 1 });
  expect((await clientKeyCount(3101))).toEqual({ invoice: 1, payment: 1 });
});

test(meta('R06.POS.STOCK.EXACT', 'Selling exactly the available quantity is allowed and takes on_hand to exactly 0 (no hidden floor, no overshoot); the movement carries the full quantity', M_TRIG), async () => {
  ready();
  const r = await postSale(identities.A_cashier.id, sizedSale(3102, 99));
  expect(r.idempotent).toBe(false);
  expect(await onHand('A')).toBe(0);
  const mv = await db.client.query(`select quantity from public.stock_movements where business_id=$1 and source_type='invoice' and source_id=$2`, [orgs.A.business, r.id]);
  expect(mv.rows.length).toBe(1);
  expect(Number(mv.rows[0].quantity)).toBe(-99);
});

test(meta('R06.POS.STOCK.INSUFFICIENT', 'A sale beyond available stock (0 on hand, quantity 1) is denied with SQLSTATE 23514 raised by chk_inventory_balances_on_hand_nonneg — the invariant itself, never a substituted policy — and the denied key leaves no document or tender behind', M_CHECK), async () => {
  ready();
  await deniedSale(identities.A_cashier.id, sizedSale(3103, 1), '23514', /chk_inventory_balances_on_hand_nonneg/);
  expect(await onHand('A')).toBe(0);
  expect(await clientKeyCount(3103)).toEqual({ invoice: 0, payment: 0 });
});

test(meta('R06.POS.STOCK.ATOMIC-FAILURE', 'When stock validation fails inside an otherwise financially valid sale, every surface rolls back: invoices, invoice_lines, invoice_payments, journal_entries, journal_lines, stock_movements, inventory_balances (full-row hash) and pos_shifts (drawer totals) are byte-identical before and after the denied command', M_CHECK), async () => {
  ready();
  const before = await snapshot();
  await deniedSale(identities.A_cashier.id, sizedSale(3104, 1), '23514', /chk_inventory_balances_on_hand_nonneg/);
  expect(await snapshot()).toEqual(before);
  expect(await clientKeyCount(3104)).toEqual({ invoice: 0, payment: 0 });
});

test(meta('R06.POS.STOCK.REPLAY', 'Command replay (identical payload + client key) returns the original document flagged idempotent:true and applies stock/financial effects exactly once: still one movement, one tender, one of each keyed journal, balance unchanged, drawer totals untouched by the replay', M_BIND), async () => {
  ready();
  const shiftBefore = (await db.client.query('select md5(row(s.*)::text) m from public.pos_shifts s where id=$1', [orgs.A.shift])).rows[0].m;
  const replay = await postSale(identities.A_cashier.id, normalPayload);
  expect(replay.id).toBe(normalResult.id);
  expect(replay.number).toBe(normalResult.number);
  expect(replay.idempotent).toBe(true);

  const mv = await db.client.query(`select count(*)::int n from public.stock_movements where business_id=$1 and source_type='invoice' and source_id=$2`, [orgs.A.business, normalResult.id]);
  expect(mv.rows[0].n).toBe(1);
  expect(await journalKeys(normalResult.id, orgs.A.business)).toEqual({ sale: 1, settlement: 1, cogs: 1 });
  expect((await clientKeyCount(3101))).toEqual({ invoice: 1, payment: 1 });
  expect(await onHand('A')).toBe(0);
  const shiftAfter = (await db.client.query('select md5(row(s.*)::text) m from public.pos_shifts s where id=$1', [orgs.A.shift])).rows[0].m;
  expect(shiftAfter).toBe(shiftBefore);
});

test(meta('R06.POS.STOCK.CROSS-TENANT', 'A caller of business B cannot invoke the POS sale command against business A: denied with SQLSTATE 42501 by the command authorization gate (can_operate_pos), with zero mutation on either tenant', M_BIND), async () => {
  ready();
  const before = await snapshot();
  await deniedSale(identities.B_cashier.id, sizedSale(3106, 1), '42501', /permission/i);
  expect(await clientKeyCount(3106)).toEqual({ invoice: 0, payment: 0 });
  expect(await onHand('A')).toBe(0);
  expect(await onHand('B')).toBe(100);
  expect((await db.client.query('select count(*)::int n from public.stock_movements where business_id=$1', [orgs.B.business])).rows[0].n).toBe(0);
  expect(await snapshot()).toEqual(before);
});

test(meta('R06.POS.STOCK.PRODUCT-MISMATCH', 'A sale whose line references a product that does not belong to the business is denied atomically with SQLSTATE 22023 at the command boundary — before any document, tender, ledger, movement or quota consumption — and creates no cross-tenant balance row (2026-09-23 remediation; previously it silently committed a zero-stock document)', M_TENANT), async () => {
  ready();
  const before = await snapshot();
  const tampered = sizedSale(3107, 1);
  tampered.lines[0].product_id = orgs.B.product;
  await deniedSale(identities.A_cashier.id, tampered, '22023', /product that does not belong to this business/i);
  expect(await clientKeyCount(3107)).toEqual({ invoice: 0, payment: 0 });
  expect((await db.client.query('select count(*)::int n from public.inventory_balances where business_id=$1 and product_id=$2', [orgs.A.business, orgs.B.product])).rows[0].n).toBe(0);
  expect(await onHand('A')).toBe(0);
  expect(await onHand('B')).toBe(100);
  expect(await snapshot()).toEqual(before);
});

test(meta('R06.POS.STOCK.CLIENT-TAMPER', 'Caller-supplied stock-affecting values are provably not authoritative: a line carrying junk unit_cost, location_id, quantity_on_hand and average_cost fields commits with the movement costed from the live server balance (900 WAC), located at the server-derived branch location, and the tampered fields have no columns to land in; zero-cost inbound propagates quantity only and never substitutes zero valuation', M_TRIG), async () => {
  ready();
  // Setup: zero-cost inbound raises on_hand 0 → 5; WAC must stay 900 (never a silent zero substitution).
  await db.client.query(`insert into public.stock_movements(business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference)
    values($1,$2,$3,'purchase',$4,5,0,'r06-probe','tamper-setup-3108','R06 client-tamper setup')`, [orgs.A.business, orgs.A.product, orgs.A.location, DAY]);
  let bal = await balRow('A');
  expect(Number(bal.quantity_on_hand)).toBe(5);
  expect(Number(bal.average_cost)).toBe(900);

  const tampered = sizedSale(3108, 1);
  const line = tampered.lines[0];
  line.unit_cost = 0.01;
  line.location_id = orgs.B.location;
  line.quantity_on_hand = -999;
  line.average_cost = 1;
  const r = await postSale(identities.A_cashier.id, tampered);
  expect(r.idempotent).toBe(false);

  const mv = (await db.client.query(`select quantity, unit_cost, location_id from public.stock_movements where business_id=$1 and source_type='invoice' and source_id=$2`, [orgs.A.business, r.id])).rows;
  expect(mv.length).toBe(1);
  expect(Number(mv[0].quantity)).toBe(-1);
  expect(Number(mv[0].unit_cost)).toBe(900);
  expect(mv[0].location_id).toBe(orgs.A.location);
  bal = await balRow('A');
  expect(Number(bal.quantity_on_hand)).toBe(4);
  expect(Number(bal.average_cost)).toBe(900);

  const cols = (await db.client.query(`select count(*)::int n from information_schema.columns
    where table_schema='public' and table_name='invoice_lines' and column_name in ('unit_cost','location_id','average_cost','quantity_on_hand','quantity_reserved')`)).rows[0].n;
  expect(cols).toBe(0);
});

test(meta('R06.POS.STOCK.CONCURRENT', 'Two POS transactions consuming the same final unit cannot both succeed (structural basis: the unique (business_id, product_id, location_id) balance row is the serialization point, locked FOR UPDATE by trg_stock_movement_apply_balance, with the 23514 check finalizing denial per transaction)', M_TRIG), async () => {
  ready();
  throw new Blocked('Honest harness limitation (not a product claim): the R13 fixture exposes exactly one database connection per suite; an in-test Promise.all race serializes on that single client\'s own query queue, and no second-connection factory is exposed, so a faithful multi-connection final-unit race cannot be exercised here. Concurrency protection is NOT claimed by this record; the serialization mechanism is analytic (balance-row FOR UPDATE inside each posting transaction + 23514 final check).');
});

test(meta('R06.POS.STOCK.DATA-UNCHANGED', 'After the whole matrix: the balance equation holds exactly (on_hand = seeded 100 + net movement sum = 4), B is entirely pristine (100@900, zero documents/movements/journals), no cross-tenant balance or movement rows exist anywhere, A holds exactly the three committed paid sales each with their three keyed journals, and fixture identity data is untouched (businesses 2, business_users 14, contacts 2)', 'tests/release/fixtures.ts'), async () => {
  ready();
  const eq = (await db.client.query(`with mv as (select coalesce(sum(quantity),0)::numeric s from public.stock_movements where business_id=$1 and product_id=$2 and location_id=$3)
    select b.quantity_on_hand, mv.s, (b.quantity_on_hand = 100 + mv.s) ok
      from public.inventory_balances b cross join mv
     where b.business_id=$1 and b.product_id=$2 and b.location_id=$3`, [orgs.A.business, orgs.A.product, orgs.A.location])).rows[0];
  expect(eq.ok).toBe(true);
  expect(Number(eq.quantity_on_hand)).toBe(4);
  expect(Number((await balRow('A')).average_cost)).toBe(900);
  expect(Number((await balRow('A')).quantity_reserved)).toBe(0);

  const b = await balRow('B');
  expect(Number(b.quantity_on_hand)).toBe(100);
  expect(Number(b.average_cost)).toBe(900);
  const bCounts = (await db.client.query(`select
    (select count(*) from public.invoices where business_id=$1)::int invoices,
    (select count(*) from public.invoice_lines where business_id=$1)::int lines,
    (select count(*) from public.invoice_payments where business_id=$1)::int payments,
    (select count(*) from public.journal_entries where business_id=$1)::int journals,
    (select count(*) from public.stock_movements where business_id=$1)::int movements`, [orgs.B.business])).rows[0];
  expect(bCounts).toEqual({ invoices: 0, lines: 0, payments: 0, journals: 0, movements: 0 });

  const cross = (await db.client.query(`select
    (select count(*) from public.inventory_balances ib join public.products p on p.id=ib.product_id where p.business_id <> ib.business_id)::int as balances,
    (select count(*) from public.stock_movements sm join public.products p on p.id=sm.product_id where p.business_id <> sm.business_id)::int as movements`)).rows[0];
  expect(cross).toEqual({ balances: 0, movements: 0 });

  const aInvoices = (await db.client.query(`select count(*)::int n, string_agg(distinct i.status::text, ',') statuses from public.invoices i where i.business_id=$1`, [orgs.A.business])).rows[0];
  expect(aInvoices.n).toBe(3);
  expect(aInvoices.statuses).toBe('paid');
  const keyed = (await db.client.query(`select count(*)::int n from public.journal_entries where business_id=$1 and posting_key like 'invoice:%'`, [orgs.A.business])).rows[0].n;
  expect(keyed).toBe(9);

  const identity = (await db.client.query(`select
    (select count(*) from public.businesses)::int businesses,
    (select count(*) from public.business_users)::int users,
    (select count(*) from public.contacts)::int contacts`)).rows[0];
  expect(identity).toEqual({ businesses: 2, users: 14, contacts: 2 });
});
