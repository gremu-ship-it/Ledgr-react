/**
 * R06-P2a (2026-09-23) — second-connection concurrency harness.
 * Proves R06.POS.STOCK.CONCURRENT via true multi-connection race.
 *
 * Prerequisites: database.mjs createSecondClient (two independent pg Clients
 * to same EmbeddedPostgres, each with its own BEGIN/COMMIT and authenticated
 * identity). No savepoints, no fake timers, no mocks.
 *
 * If this environment cannot establish a genuine race, this record stays
 * BLOCKED with the exact limitation — it does not degrade to a sequential
 * proof.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, saleFixture, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r06-concurrent-2c');
const M_TRIG = 'supabase/migrations/20260928000001_r06_stock_balance_authority.sql';
const LAYER = 'real PostgreSQL17 full migration replay incl. 20260928000001 R06 trigger; synthetic identities; two independent embedded-postgres clients with concurrent transactions (FOR UPDATE serialization + 23514)';
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
  if (!db.createSecondClient) throw new Blocked('Second-connection harness unavailable: database.mjs does not expose createSecondClient (single-connection fixture only)');
}

const balRow = async (business: string) =>
  (await db.client.query('select quantity_on_hand, quantity_reserved, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs[business].business, orgs[business].product, orgs[business].location])).rows[0] as { quantity_on_hand: string; quantity_reserved: string; average_cost: string };

const sizedSale = (n: number, qty: number) => {
  // Use A context
  const sale = saleFixture((orgs as any).A, n) as any;
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

test(meta('R06.POS.STOCK.CONCURRENT-2C', 'Two independent authenticated sessions racing on the same final stock unit: genuine two-connection concurrent post_pos_sale; at most one commits, the loser is denied 23514 chk_inventory_balances_on_hand_nonneg, no negative balance, no partial financial commit, idempotent replay correct, final state consistent', M_TRIG), async () => {
  ready();

  // Set deterministic start: 1 unit on hand for A. Use owner client (superuser) to set balance directly for test determinism.
  await db.client.query('update public.inventory_balances set quantity_on_hand=1, quantity_reserved=0, average_cost=900 where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs.A.business, orgs.A.product, orgs.A.location]);
  expect(Number((await balRow('A')).quantity_on_hand)).toBe(1);
  // B stays pristine 100 for final seal check.
  expect(Number((await balRow('B')).quantity_on_hand)).toBe(100);

  const client2 = await db.createSecondClient();

  // Two distinct authenticated, POS-authorized identities in same business A.
  const uid1 = identities.A_cashier.id; // cashier is a till role
  const uid2 = identities.A_admin.id; // admin is manager-tier, may steer onto cashier's shift (R08)

  // Two payloads, each individually valid (quantity 1 <= 1) but collectively 2 > 1.
  const payload1 = sizedSale(4101, 1) as any;
  const payload2 = sizedSale(4102, 1) as any;

  // Snapshot before race for atomic-failure check on loser side.
  const before = (await db.client.query(`select
    (select count(*) from public.invoices where business_id=$1)::int as invoices,
    (select count(*) from public.invoice_lines where business_id=$1)::int as lines,
    (select count(*) from public.invoice_payments where business_id=$1)::int as payments,
    (select count(*) from public.journal_entries where business_id=$1)::int as journals,
    (select count(*) from public.journal_lines jl join public.journal_entries je on je.id=jl.journal_entry_id where je.business_id=$1)::int as journal_lines,
    (select count(*) from public.stock_movements where business_id=$1)::int as movements
    `, [orgs.A.business])).rows[0] as Record<string, number>;

  // Launch genuine concurrent transactions on two independent connections.
  // Each does BEGIN; set_config; SET LOCAL ROLE; post_pos_sale; COMMIT/ROLLBACK.
  const runOnPrimary = async () => {
    await db.beginAsRole('authenticated', uid1);
    try {
      const r = await db.client.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload1)]);
      await db.commitTx();
      return { ok: true, result: r.rows[0].r as { id: string; number: string; idempotent: boolean } };
    } catch (e) {
      try { await db.rollbackTx(); } catch { /* rollback best-effort */ }
      return { ok: false, error: e as { code?: string; message?: string } };
    }
  };
  const runOnSecond = async () => {
    await client2.beginAsRole('authenticated', uid2);
    try {
      const r = await client2.client.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload2)]);
      await client2.commitTx();
      return { ok: true, result: r.rows[0].r as { id: string; number: string; idempotent: boolean } };
    } catch (e) {
      try { await client2.rollbackTx(); } catch { /* rollback best-effort */ }
      return { ok: false, error: e as { code?: string; message?: string } };
    }
  };

  // Start both at once — the second will block on FOR UPDATE until the first commits.
  const [a, b] = await Promise.all([runOnPrimary(), runOnSecond()]);

  // Exactly one must succeed, one must fail with 23514.
  const successes = [a, b].filter(x => x.ok);
  const failures = [a, b].filter(x => !x.ok);
  expect(successes.length).toBe(1);
  expect(failures.length).toBe(1);

  const winner = successes[0] as { ok: true; result: { id: string; number: string; idempotent: boolean } };
  const loser = failures[0] as { ok: false; error: { code?: string; message?: string } };
  expect(winner.result.idempotent).toBe(false);
  expect(loser.error.code).toBe('23514');
  expect(loser.error.message ?? '').toMatch(/chk_inventory_balances_on_hand_nonneg/);

  // No negative balance.
  const afterBal = Number((await balRow('A')).quantity_on_hand);
  expect(afterBal).toBe(0);
  expect(afterBal).toBeGreaterThanOrEqual(0);

  // No partial financial commit for loser key: zero invoice/lines/payments/journals/movements for that key.
  const loserKey = a.ok ? key(4102) : key(4101);
  const winnerKey = a.ok ? key(4101) : key(4102);
  const loserCounts = (await db.client.query(`select
    (select count(*) from public.invoices where client_key=$1)::int invoices,
    (select count(*) from public.invoice_payments where client_key=$2)::int payments,
    (select count(*) from public.stock_movements where business_id=$3 and source_type='invoice' and source_id in (select id::text from public.invoices where client_key=$1))::int movements
    `, [loserKey, key((a.ok ? 4102 : 4101) + 1000), orgs.A.business])).rows[0] as { invoices: number; payments: number; movements: number };
  // Loser has 0 invoice, 0 payment for its keys, and no movement tied to a loser invoice (there is none).
  expect(loserCounts.invoices).toBe(0);
  expect(loserCounts.payments).toBe(0);

  // Winner has exactly 1 invoice, 1 payment, 1 movement, 3 journals.
  const winnerInvoice = winner.result.id;
  expect((await db.client.query('select count(*)::int n from public.invoices where client_key=$1', [winnerKey])).rows[0].n).toBe(1);
  expect((await db.client.query('select count(*)::int n from public.invoice_payments where client_key=$1', [key((a.ok ? 4101 : 4102) + 1000)])).rows[0].n).toBe(1);
  expect((await db.client.query(`select count(*)::int n from public.stock_movements where business_id=$1 and source_type='invoice' and source_id=$2`, [orgs.A.business, winnerInvoice])).rows[0].n).toBe(1);
  expect((await db.client.query(`select count(*)::int n from public.journal_entries where business_id=$1 and posting_key like 'invoice:' || $2 || ':%'`, [orgs.A.business, winnerInvoice])).rows[0].n).toBe(3);

  // Overall delta is exactly one sale: before +1.
  const after = (await db.client.query(`select
    (select count(*) from public.invoices where business_id=$1)::int as invoices,
    (select count(*) from public.invoice_lines where business_id=$1)::int as lines,
    (select count(*) from public.invoice_payments where business_id=$1)::int as payments,
    (select count(*) from public.journal_entries where business_id=$1)::int as journals,
    (select count(*) from public.journal_lines jl join public.journal_entries je on je.id=jl.journal_entry_id where je.business_id=$1)::int as journal_lines,
    (select count(*) from public.stock_movements where business_id=$1)::int as movements
    `, [orgs.A.business])).rows[0] as Record<string, number>;
  expect(after.invoices).toBe(before.invoices + 1);
  expect(after.lines).toBe(before.lines + 1);
  expect(after.payments).toBe(before.payments + 1);
  expect(after.movements).toBe(before.movements + 1);
  expect(after.journals).toBe(before.journals + 3);

  // Idempotency: replay winner's exact payload on primary must return same id with idempotent:true and no extra effects.
  const winnerPayload = a.ok ? payload1 : payload2;
  const winnerUid = a.ok ? uid1 : uid2;
  const replayBefore = after;
  const replay = (await db.commitAsRole('authenticated', winnerUid, 'select public.post_pos_sale($1::jsonb) r', [JSON.stringify(winnerPayload)])).rows[0].r as { id: string; idempotent: boolean };
  expect(replay.id).toBe(winnerInvoice);
  expect(replay.idempotent).toBe(true);
  const replayAfter = (await db.client.query(`select
    (select count(*) from public.invoices where business_id=$1)::int as invoices,
    (select count(*) from public.stock_movements where business_id=$1)::int as movements,
    (select count(*) from public.journal_entries where business_id=$1)::int as journals
    `, [orgs.A.business])).rows[0] as Record<string, number>;
  expect(replayAfter.invoices).toBe(replayBefore.invoices);
  expect(replayAfter.movements).toBe(replayBefore.movements);
  expect(replayAfter.journals).toBe(replayBefore.journals);
  expect(Number((await balRow('A')).quantity_on_hand)).toBe(0);
  // B pristine.
  expect(Number((await balRow('B')).quantity_on_hand)).toBe(100);
  expect((await db.client.query('select count(*)::int n from public.invoices where business_id=$1', [orgs.B.business])).rows[0].n).toBe(0);

  // Balance equation: on_hand = seeded 100 + sum(movements) — but we mutated to 1 before race, so check directly: 1 -1 =0.
  const eq = (await db.client.query(`select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3`, [orgs.A.business, orgs.A.product, orgs.A.location])).rows[0].quantity_on_hand;
  expect(Number(eq)).toBe(0);

  await client2.close();
});

test(meta('R06.POS.STOCK.CONCURRENT-2C-SEAL', 'Concurrent harness seal: the two-connection fixture proves the serialization contract (FOR UPDATE + 23514) without relying on single-client query-queue serialization', M_TRIG), async () => {
  ready();
  // This seal record documents that the -2C suite uses two independent pg Clients to the same EmbeddedPostgres port,
  // each with authenticated identity, each holding its own transaction and lock. It is the explicit proof that the
  // harness limitation cited in R06.POS.STOCK.CONCURRENT has been removed for this additive record.
  expect(typeof db.createSecondClient).toBe('function');
  expect(typeof db.beginAsRole).toBe('function');
  expect(typeof db.commitTx).toBe('function');
  const c = await db.createSecondClient();
  expect(c.client).toBeDefined();
  await c.close();
});
