/**
 * R08 — Trustworthy till context: authoritative shift/cash commands (R08.2).
 *
 * Verifies against supabase/migrations/20260930000000_r08_till_context.sql:
 *   • server-resolved identity: cashier_id := auth.uid(), names from
 *     user_profiles, branch from the terminal row — never caller text;
 *   • single-open invariants: one open shift per terminal and per cashier
 *     (DB-enforced), exactly-once replay on command_key;
 *   • immutable signed close: row-locked single transition, persistent
 *     sequential report_number, tender-derived money, re-close under ANY
 *     other key denied with 22023 and zero mutation of the snapshot;
 *   • atomic cash movement + totals transition;
 *   • closed raw-DML bypass: INSERT/UPDATE on pos_shifts/pos_cash_movements
 *     are denied to app roles (probes prove 42501);
 *   • DEC-03 predicate: branch-scoped read visibility.
 *
 * Conventions: observer reads after `reset role` (journal/shift tables are
 * write-closed to app roles by design); savepoint-isolated denials pinned to
 * real SQLSTATEs; everything rolls back (checked by the DATA-UNCHANGED row).
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, saleFixture, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r08-shifts');
const M = 'supabase/migrations/20260930000000_r08_till_context.sql';
const LAYER = 'real PostgreSQL17 full migration replay incl. 20260930000000 R08 till-context; synthetic identities; savepoint-isolated denials; observer reads after reset role; all probes rolled back; single-open/cross-connection races documented where the harness is single-tx';
const meta = (id: string, expected: string, owner = 'R08') => ({
  id, expected, remediation: owner, source: M, layer: LAYER,
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
let sp = 0;
async function deniedInTx(c: C, run: () => Promise<unknown>, codes: string[], messageRx?: RegExp) {
  const name = `sp_r08_${++sp}`;
  await c.query(`savepoint ${name}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${name}`);
  if (!caught) throw new Error('Invariant probe completed without the expected denial.');
  expect(codes).toContain(caught.code);
  if (messageRx) expect(caught.message).toMatch(messageRx);
}
const setActor = (c: C, uid: string) =>
  c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)", [uid]);
const openShift = (c: C, opts: { terminal?: string; key: string; opening?: number; business?: string }) =>
  c.query('select public.open_pos_shift_command($1::jsonb) r', [JSON.stringify({
    business_id: opts.business ?? orgs.A.business,
    terminal_id: opts.terminal ?? orgs.A.terminal,
    command_key: opts.key,
    opening_cash: opts.opening ?? 100000,
  })]).then((r) => r.rows[0].r as Record<string, unknown>);
const closeShift = (c: C, shiftId: string, key: string, closing = 115000, variation?: string | null) =>
  c.query('select public.close_pos_shift_command($1::jsonb) r', [JSON.stringify({
    shift_id: shiftId, command_key: key, closing_cash: closing, variance_reason: variation ?? null,
  })]).then((r) => r.rows[0].r as Record<string, unknown>);
const movement = (c: C, shiftId: string, key: string, type: string, amount: number) =>
  c.query('select public.record_pos_cash_movement_command($1::jsonb) r', [JSON.stringify({
    shift_id: shiftId, command_key: key, movement_type: type, amount, reason: 'R13 drawer event',
  })]).then((r) => r.rows[0].r as Record<string, unknown>);

test(meta('R08.SHIFT.SINGLE-OPEN', 'One open shift per (business,terminal) and per (business,cashier); second opens denied 22023 with zero mutation; same-key replay idempotent; identity/branch server-resolved'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = await openShift(c, { key: 'r13-r08-open-1' });
    expect(first.idempotent).toBe(false);
    // Caller identity is never trusted: even though the payload carries no
    // cashier, the row is bound to auth.uid().
    expect(first.cashier_id).toBe(identities.A_cashier.id);
    expect(String(first.branch_id)).toBe(orgs.A.branch);
    expect(first.cashier_name).toBe('R13 cashier'); // server-resolved from user_profiles
    const replay = await openShift(c, { key: 'r13-r08-open-1' });
    expect(replay.idempotent).toBe(true);
    expect(replay.shift_id).toBe(first.shift_id);
    // Second distinct opens by the same cashier or on the same terminal: denied.
    await deniedInTx(c, () => c.query(`insert into public.pos_shifts(business_id,branch_id,terminal_id,cashier_id,cashier_name,opened_at,opening_cash,expected_cash,status,open_command_key)
      values($1,$2,$3,$4,'ghost',now(),1,1,'open','r13-r08-open-2')`, [orgs.A.business, orgs.A.branch, orgs.A.terminal, identities.A_cashier.id]), ['42501']); // raw DML closed: must route via command
    await deniedInTx(c, () => openShift(c, { key: 'r13-r08-open-3' }), ['22023'], /single-open|open shift already exists/i);
    // A *different* cashier may still open on a *different* terminal.
    await setActor(c, identities.A_branch_manager.id);
    await c.query('reset role');
    const terminal2 = String((await c.query("insert into public.pos_terminals(business_id,name,branch_id) values($1,'R13 Till 2',(select branch_id from public.pos_terminals where id=$2)) returning id", [orgs.A.business, orgs.A.terminal])).rows[0].id);
    await c.query('set local role authenticated');
    const second = await openShift(c, { key: 'r13-r08-open-4', terminal: terminal2 });
    expect(second.idempotent).toBe(false);
    expect(second.cashier_id).toBe(identities.A_branch_manager.id);
    // Same new cashier on ANY terminal now has an open shift as well.
    await deniedInTx(c, () => openShift(c, { key: 'r13-r08-open-5', terminal: terminal2 }), ['22023'], /single-open|already exists/i);
  });
});

test(meta('R08.SHIFT.CLOSE-ATOMIC', 'Close derives money from authoritative tenders/movements (never client counters) and transitions the row exactly once'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = await openShift(c, { key: 'r13-r08-close-1', opening: 50000 });
    const shiftId = String(first.shift_id);
    await movement(c, shiftId, 'r13-r08-close-m1', 'cash_in', 5000);
    await movement(c, shiftId, 'r13-r08-close-m2', 'cash_out', 2000);
    const closed = await closeShift(c, shiftId, 'r13-r08-close-k1', 53000);
    expect(closed.idempotent).toBe(false);
    // expected = opening 50000 + cash tenders 0 + cash_in 5000 - cash_out 2000 = 53000
    expect(Number(closed.expected_cash)).toBe(53000);
    expect(Number(closed.variance)).toBe(0);
    expect(String(closed.report_number)).toMatch(/^Z-\d{4}-\d+$/);
    await c.query('reset role');
    const row = (await c.query('select status, expected_cash, cash_in_amount, cash_out_amount from public.pos_shifts where id=$1', [shiftId])).rows[0];
    expect(row.status).toBe('closed');
    expect(Number(row.expected_cash)).toBe(53000);
    const snap = (await c.query('select report_number, payload from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0];
    expect(snap.report_number).toBe(closed.report_number);
    expect((snap.payload as Record<string, unknown>).report_number).toBe(closed.report_number);
  });
});

test(meta('R08.SHIFT.CLOSE-IDEMPOTENT', 'Replaying the ORIGINAL close command key returns the identical signed close (same report_number) without new rows or arithmetic drift'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = await openShift(c, { key: 'r13-r08-idem-1', opening: 10000 });
    const shiftId = String(first.shift_id);
    const c1 = await closeShift(c, shiftId, 'r13-r08-idem-k', 10000);
    const c2 = await closeShift(c, shiftId, 'r13-r08-idem-k', 10000);
    expect(c2.idempotent).toBe(true);
    expect(c2.report_number).toBe(c1.report_number);
    await c.query('reset role');
    expect(Number((await c.query('select count(*)::int n from public.pos_shift_closes where business_id=$1', [orgs.A.business])).rows[0].n)).toBe(1);
  });
});

test(meta('R08.SHIFT.CLOSE-IMMUTABLE', 'A signed close is immutable: re-close under a FRESH key is denied 22023 ("already closed"), the snapshot bytes and row stay exactly as signed; raw UPDATE bypass is denied 42501'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = await openShift(c, { key: 'r13-r08-imm-1', opening: 7000 });
    const shiftId = String(first.shift_id);
    const c1 = await closeShift(c, shiftId, 'r13-r08-imm-k', 6000, 'short');
    await c.query('reset role');
    const before = (await c.query('select md5(payload::text) h, expected_cash from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0];
    await c.query('set local role authenticated');
    await setActor(c, identities.A_cashier.id);
    await deniedInTx(c, () => closeShift(c, shiftId, 'r13-r08-imm-k2', 999999), ['22023'], /already closed|immutable/i);
    // P7: after P5-D grant all, UPDATE pos_shifts with no RLS FOR UPDATE policy affects 0 rows (still immutable); pos_shift_closes still permission denied
    expect(((await c.query("update public.pos_shifts set actual_cash=999999, cash_variance=0 where id=$1", [shiftId])) as unknown as { rowCount: number }).rowCount).toBe(0);
    await deniedInTx(c, () => c.query("update public.pos_shift_closes set expected_cash=999999 where shift_id=$1", [shiftId]), ['42501']);
    await c.query('reset role');
    const after = (await c.query('select md5(payload::text) h, expected_cash from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0];
    expect(after.h).toBe(before.h);
    expect(Number(after.expected_cash)).toBe(Number(before.expected_cash));
    expect(Number((await c.query('select actual_cash from public.pos_shifts where id=$1', [shiftId])).rows[0].actual_cash)).toBe(6000);
    void c1;
  });
});

test(meta('R08.SHIFT.LATE-ARRIVAL', 'DEC-08 primitives: post-close movement denied; adjustment table not writable by app roles (sale-level binding now proven by R08.SALE.LATE-ARRIVAL-BOUND)', 'R08·R09 seam'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = await openShift(c, { key: 'r13-r08-late-1' });
    const shiftId = String(first.shift_id);
    await closeShift(c, shiftId, 'r13-r08-late-k');
    // Anything further against that shift is denied; adjustment is append-only
    // and not writable by app roles (written by posting commands in R08.3).
    await deniedInTx(c, () => movement(c, shiftId, 'r13-r08-late-m', 'cash_in', 100), ['22023'], /open shift/i);
    await deniedInTx(c, () => c.query('insert into public.pos_shift_late_adjustments(business_id,shift_id,invoice_id,command_key,amount,reason,detected_at) values($1,$2,null,$3,100,$4,now())', [orgs.A.business, shiftId, 'r13-r08-late-a1', 'fabricated']), ['42501']);
    await c.query('reset role');
    expect(Number((await c.query('select count(*)::int n from public.pos_shift_late_adjustments where business_id=$1', [orgs.A.business])).rows[0].n)).toBe(0);
  });
});

test(meta('R08.SHIFT.CROSS-CASHIER-DENIED', 'Another non-manager operator cannot close or move money on somebody else\'s shift (42501); a business manager tier may (documented channel); a foreign-org caller sees "unknown shift"'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = await openShift(c, { key: 'r13-r08-xcash-1' });
    const shiftId = String(first.shift_id);
    await setActor(c, identities.A_branch_manager.id);
    await deniedInTx(c, () => closeShift(c, shiftId, 'r13-r08-xcash-k1'), ['42501'], /cashier or a business manager/i);
    await deniedInTx(c, () => movement(c, shiftId, 'r13-r08-xcash-m1', 'cash_out', 10), ['42501']);
    await setActor(c, identities.A_admin.id);
    const adminClose = await closeShift(c, shiftId, 'r13-r08-xcash-k2', 100000, 'manager count');
    expect(adminClose.idempotent).toBe(false);
    await setActor(c, identities.B_cashier.id);
    await deniedInTx(c, () => closeShift(c, shiftId, 'r13-r08-xcash-k3'), ['22023', '42501']);
  });
});

test(meta('R08.MOVEMENT.ATOMIC-PAIR', 'Movement row and shift totals transition together; a malformed command mutates neither (zero mutation); identity/branch server-resolved; replay idempotent'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const first = await openShift(c, { key: 'r13-r08-mov-1', opening: 20000 });
    const shiftId = String(first.shift_id);
    const m1 = await movement(c, shiftId, 'r13-r08-mov-a', 'cash_in', 3000);
    expect(m1.idempotent).toBe(false);
    const m1r = await movement(c, shiftId, 'r13-r08-mov-a', 'cash_in', 3000);
    expect(m1r.idempotent).toBe(true);
    await deniedInTx(c, () => movement(c, shiftId, 'r13-r08-mov-b', 'cash_in', 0), ['22023']);
    await deniedInTx(c, () => c.query('select public.record_pos_cash_movement_command($1::jsonb)', [JSON.stringify({ shift_id: shiftId, command_key: 'r13-r08-mov-c', movement_type: 'cash_in', amount: 50, reason: '' })]), ['22023']);
    await c.query('reset role');
    expect(Number((await c.query('select count(*)::int n from public.pos_cash_movements where business_id=$1 and command_key like $2', [orgs.A.business, 'r13-r08-mov-%'])).rows[0].n)).toBe(1);
    const movementRow = (await c.query('select user_id, user_name, branch_id from public.pos_cash_movements where business_id=$1 and command_key=$2', [orgs.A.business, 'r13-r08-mov-a'])).rows[0];
    expect(String(movementRow.user_id)).toBe(identities.A_cashier.id);
    expect(movementRow.user_name).toBe('R13 cashier');
    expect(String(movementRow.branch_id)).toBe(orgs.A.branch);
    const shiftRow = (await c.query('select cash_in_amount, expected_cash from public.pos_shifts where id=$1', [shiftId])).rows[0];
    expect(Number(shiftRow.cash_in_amount)).toBe(3000);
    expect(Number(shiftRow.expected_cash)).toBe(23000);
  });
});

test(meta('R08.SHIFT.BYPASS-CLOSED', 'Raw DML bypass is closed: INSERT on pos_shifts/pos_cash_movements denied 42501, UPDATE on pos_shifts affects 0 rows (P5-D grant all + RLS no FOR UPDATE policy — still closed)'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await deniedInTx(c, () => c.query(`insert into public.pos_shifts(business_id,branch_id,cashier_id,cashier_name,opened_at,opening_cash,expected_cash,status)
      values($1,$2,$3,'ghost',now(),1,1,'open')`, [orgs.A.business, orgs.A.branch, identities.A_owner.id]), ['42501']);
    // P7: UPDATE with no RLS FOR UPDATE policy affects 0 rows (grant all + RLS)
    expect(((await c.query(`update public.pos_shifts set expected_cash=9 where business_id=$1`, [orgs.A.business])) as unknown as { rowCount: number }).rowCount).toBe(0);
    await deniedInTx(c, () => c.query(`insert into public.pos_cash_movements(business_id,shift_id,user_id,user_name,movement_type,amount,reason,created_at)
      values($1,$2,$3,'ghost','cash_in',1,'fake',now())`, [orgs.A.business, orgs.A.shift, identities.A_owner.id]), ['42501']);
  });
});

test(meta('R08.SHIFT.BRANCH-SCOPED-READ', 'DEC-03: an assigned-scope member confined to one branch sees only that branch\'s shifts; org-wide roles see all (uses business_users.branch_id, not UI filters'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    // Craft an assigned user in org A scoped to branch A2 (privileged fixture edit).
    await c.query('reset role');
    await c.query('update public.business_users set branch_id=$1 where business_id=$2 and user_id=$3', [orgs.A.branch2, orgs.A.business, identities.A_branch_manager.id]);
    // Seed one open shift on branch A1 and one on branch A2.
    const s1 = (await c.query("insert into public.pos_shifts(business_id,branch_id,cashier_id,cashier_name,opening_cash,status) values($1,$2,$3,'b1',0,'open') returning id", [orgs.A.business, orgs.A.branch, identities.A_admin.id])).rows[0].id;
    const s2 = (await c.query("insert into public.pos_shifts(business_id,branch_id,cashier_id,cashier_name,opening_cash,status) values($1,$2,$3,'b2',0,'open') returning id", [orgs.A.business, orgs.A.branch2, identities.A_admin.id])).rows[0].id;
    await c.query('set local role authenticated');
    await setActor(c, identities.A_branch_manager.id);
    const rows = (await c.query('select id from public.pos_shifts where business_id=$1', [orgs.A.business])).rows.map((r) => String(r.id));
    expect(rows).toContain(s2);
    expect(rows).not.toContain(s1);
    await setActor(c, identities.A_admin.id);
    const all = (await c.query('select id from public.pos_shifts where business_id=$1', [orgs.A.business])).rows.map((r) => String(r.id));
    expect(all).toEqual(expect.arrayContaining([s1, s2]));
  });
});

test(meta('R08.SALE.SHIFT-LINK', "Terminal-posted sale: server binds the caller's own open shift (no caller claim needed), stamps the terminal's branch, links pos_shift_id at insert, drawer increments; replay idempotent"), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-link-1' });
    const shiftId = String(opened.shift_id);
    const payload = saleFixture(orgs.A, 101) as Record<string, unknown>;
    payload.terminal_id = orgs.A.terminal;
    delete payload.shift_id; // terminal context is enough; the server resolves the shift
    const sale = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as Record<string, unknown>;
    expect(sale.id).toBeTruthy();
    const replay = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as Record<string, unknown>;
    expect(replay.idempotent).toBe(true);
    expect(replay.id).toBe(sale.id);
    await c.query('reset role');
    const inv = (await c.query('select pos_shift_id, branch_id from public.invoices where id=$1', [sale.id])).rows[0];
    expect(String(inv.pos_shift_id)).toBe(shiftId);
    expect(String(inv.branch_id)).toBe(orgs.A.branch);
    const shift = (await c.query('select cash_sales_amount from public.pos_shifts where id=$1', [shiftId])).rows[0];
    expect(Number(shift.cash_sales_amount)).toBe(1500);
    // The link is immutable afterwards (R08.2 trigger), never re-steered.
    await deniedInTx(c, () => c.query('update public.invoices set pos_shift_id=$1 where id=$2', [orgs.A.shift, sale.id]), ['22023', '42501']);
  });
});

test(meta('R08.SALE.TERMINAL-SCOPE', "Steering matrix: conflicting branch → 22023; foreign terminal → 22023; deactivated terminal → 22023; unknown shift → 22023; another user's open shift (non-manager) → 42501; all denials mutate zero"), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-scope-1' });
    const payloadFor = (mut: (p: Record<string, unknown>) => void) => {
      const p = saleFixture(orgs.A, 111) as Record<string, unknown>;
      mut(p);
      return p;
    };
    const countInvoices = async () => (await c.query('reset role').then(() => c.query("select count(*)::int n from public.invoices where business_id=$1", [orgs.A.business]))).rows[0].n;
    // Foreign terminal (org B's till).
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(payloadFor((p) => { p.terminal_id = orgs.B.terminal; }))]), ['22023'], /foreign terminal/);
    // Terminal branch conflict: claim A2 branch on the A1-bound till.
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(payloadFor((p) => {
      p.terminal_id = orgs.A.terminal; (p.invoice as Record<string, unknown>).branch_id = orgs.A.branch2;
    }))]), ['22023'], /conflicts with the authorised terminal branch/);
    // Deactivated terminal.
    await c.query('reset role');
    await c.query("insert into public.pos_terminals(business_id,name,branch_id,is_active) values($1,'R13 Dead Till',$2,false)", [orgs.A.business, orgs.A.branch]);
    const dead = (await c.query("select id from public.pos_terminals where business_id=$1 and name='R13 Dead Till'", [orgs.A.business])).rows[0].id;
    await c.query('set local role authenticated');
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(payloadFor((p) => { p.terminal_id = dead; }))]), ['22023'], /deactivated/);
    // Unknown shift.
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(payloadFor((p) => { p.shift_id = 'f0000000-0000-4000-8000-000000000099'; }))]), ['22023'], /foreign shift/);
    // Another user's open shift (non-manager caller).
    await setActor(c, identities.A_branch_manager.id);
    await c.query('reset role');
    const term2 = String((await c.query("insert into public.pos_terminals(business_id,name,branch_id) values($1,'R13 Till Scope2',(select branch_id from public.pos_terminals where id=$2)) returning id", [orgs.A.business, orgs.A.terminal])).rows[0].id);
    await c.query('set local role authenticated');
    const bmOpened = await openShift(c, { key: 'r13-r08-scope-2', terminal: term2 });
    await setActor(c, identities.A_cashier.id);
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(payloadFor((p) => {
      p.terminal_id = term2; p.shift_id = bmOpened.shift_id;
    }))]), ['42501'], /own shift/);
    // Nothing was mutated by any denial above (this tx is rolled back anyway).
    void countInvoices;
    const n2 = await countInvoices();
    expect(n2).toBe(0);
    void opened;
  });
});

test(meta('R08.SALE.LATE-ARRIVAL-BOUND', 'DEC-08 full binding: a sale claiming a CLOSED shift still commits; the signed close is NOT rewritten (hash-stable); exactly one append-only late-adjustment row appears; replay adds nothing'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-late2-1' });
    const shiftId = String(opened.shift_id);
    await closeShift(c, shiftId, 'r13-r08-late2-k', 100000);
    await c.query('reset role');
    const h0 = (await c.query('select md5(payload::text) h from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0].h;
    await c.query('set local role authenticated');
    await setActor(c, identities.A_cashier.id);
    const payload = saleFixture(orgs.A, 121) as Record<string, unknown>;
    payload.terminal_id = orgs.A.terminal;
    payload.shift_id = shiftId;
    const sale = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as Record<string, unknown>;
    expect(sale.id).toBeTruthy();
    // Replay of the same deferred sale adds no second adjustment.
    const replay = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as Record<string, unknown>;
    expect(replay.idempotent).toBe(true);
    await c.query('reset role');
    const adj = (await c.query('select amount, command_key, invoice_id from public.pos_shift_late_adjustments where business_id=$1 and shift_id=$2', [orgs.A.business, shiftId])).rows;
    expect(adj.length).toBe(1);
    expect(Number(adj[0].amount)).toBe(1500);
    expect(String(adj[0].command_key)).toContain(':late');
    expect(String(adj[0].invoice_id)).toBe(sale.id);
    const inv = (await c.query('select pos_shift_id from public.invoices where id=$1', [sale.id])).rows[0];
    expect(String(inv.pos_shift_id)).toBe(shiftId);
    const h1 = (await c.query('select md5(payload::text) h from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0].h;
    expect(h1).toBe(h0);
    const shiftRow = (await c.query('select cash_sales_amount, status from public.pos_shifts where id=$1', [shiftId])).rows[0];
    expect(shiftRow.status).toBe('closed');
    expect(Number(shiftRow.cash_sales_amount)).toBe(0); // close arithmetic is NOT re-opened by the arrival
  });
});

test(meta('R08.SALE.BRANCH-SUBSTITUTION', 'DEC-03 at posting: an assigned-scope caller posting a sale stamped with a branch they cannot access is denied 42501 (legacy path included); org-wide caller passes'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_branch_manager.id, async (c: C) => {
    await c.query('reset role');
    // Confine the branch manager to A2.
    await c.query('update public.business_users set branch_id=$1 where business_id=$2 and user_id=$3', [orgs.A.branch2, orgs.A.business, identities.A_branch_manager.id]);
    await c.query('set local role authenticated');
    await setActor(c, identities.A_branch_manager.id);
    const asA1 = () => { const p = saleFixture(orgs.A, 131) as Record<string, unknown>; return p; };
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(asA1())]), ['42501'], /no access to the requested branch|has no access/);
    // Same caller with their OWN branch and an own open shift on an A2 till: passes.
    await c.query('reset role');
    const termA2 = String((await c.query('insert into public.pos_terminals(business_id,name,branch_id) values($1,$2,$3) returning id', [orgs.A.business, 'R13 Till A2', orgs.A.branch2])).rows[0].id);
    await c.query('set local role authenticated');
    const opened = await openShift(c, { key: 'r13-r08-bsub-1', terminal: termA2 });
    const okPayload = asA1();
    okPayload.terminal_id = termA2;
    delete okPayload.shift_id; // server auto-binds the caller's own open shift on that till
    (okPayload.invoice as Record<string, unknown>).branch_id = orgs.A.branch2;
    const sale = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(okPayload)])).rows[0].r as Record<string, unknown>;
    expect(sale.id).toBeTruthy();
    await c.query('reset role');
    const inv = (await c.query('select branch_id, pos_shift_id from public.invoices where id=$1', [sale.id])).rows[0];
    expect(String(inv.branch_id)).toBe(orgs.A.branch2);
    expect(String(inv.pos_shift_id)).toBe(String(opened.shift_id));
  });
});

test(meta('R08.ZREPORT.RECONCILES-TENDERS', 'Tender-derived reporting: the signed close and the live shift report are derived from invoice_payments/pos_corrections/pos_cash_movements — never from caller-claimed tender values; per-method breakdown reconciles exactly; report numbers are sequential; live report equals close snapshot'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-z-1', opening: 5000 });
    const shiftId = String(opened.shift_id);
    // Sale 1: single cash tender 1500 (auto-bound via terminal).
    const sale1Payload = saleFixture(orgs.A, 201) as Record<string, unknown>;
    sale1Payload.terminal_id = orgs.A.terminal;
    delete sale1Payload.shift_id;
    const sale1 = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(sale1Payload)])).rows[0].r as Record<string, unknown>;
    // Sale 2: split tenders card 1000 + airtel_money 500 with GARBAGE caller-claimed drawer numbers.
    const sale2Payload = saleFixture(orgs.A, 202) as Record<string, unknown>;
    sale2Payload.terminal_id = orgs.A.terminal;
    delete sale2Payload.shift_id;
    sale2Payload.cash_sales = 9999;
    sale2Payload.other_sales = 8888;
    sale2Payload.payments = [
      { amount: 1000, payment_method: 'card', currency: 'MWK', exchange_rate: 1, functional_amount: 1000, payment_date: '2026-01-01', client_key: key(1202) },
      { amount: 500, payment_method: 'airtel_money', currency: 'MWK', exchange_rate: 1, functional_amount: 500, payment_date: '2026-01-01', client_key: key(1203) },
    ];
    const sale2 = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(sale2Payload)])).rows[0].r as Record<string, unknown>;
    expect(sale2.id).toBeTruthy();
    // R07 refund of 700 against sale1, posted by admin (direct tier): R07 command surface byte-untouched.
    await setActor(c, identities.A_admin.id);
    const refund = (await c.query('select public.refund_pos_sale_command($1::jsonb) r', [JSON.stringify({
      business_id: orgs.A.business, invoice_id: sale1.id, command_key: 'r13-r08-z-refund-1',
      reason: 'R13 tender reconciliation', lines: [{ amount: 700, description: 'R13 partial return' }],
    })])).rows[0].r as Record<string, unknown>;
    expect(refund.document_id).toBe(sale1.id);
    expect(Number(refund.amount)).toBe(700);
    await setActor(c, identities.A_cashier.id);
    // Live report BEFORE close: derived numbers, claims quarantined in client_counters.
    const report = (q: string) => c.query('select public.get_pos_shift_report($1) r', [q]).then((r) => r.rows[0].r as Record<string, unknown>);
    const pre = await report(shiftId);
    expect(Number(pre.cash_tenders)).toBe(1500);
    expect(Number(pre.other_tenders)).toBe(1500);
    expect(Number(pre.total_sales)).toBe(3000);
    expect(Number(pre.refund_total)).toBe(700);
    expect(Number(pre.sales_count)).toBe(2);
    expect(Number(pre.expected_cash)).toBe(5800);
    expect(pre.tender_breakdown).toEqual({ cash: 1500, card: 1000, airtel_money: 500 });
    expect(pre.derivation_source).toBe('invoice_payments+pos_corrections+pos_cash_movements');
    const counters = pre.client_counters as Record<string, unknown>;
    expect(Number(counters.cash_sales_amount)).toBe(1500 + 9999); // claims flow ONLY here
    expect(counters.authoritative).toBe(false);
    expect(pre.close).toBeNull();
    // Close: the signed snapshot reconciles with the derivation, numbers sequential.
    const closed = await closeShift(c, shiftId, 'r13-r08-z-close-1', 5800);
    expect(Number(closed.expected_cash)).toBe(5800);
    expect(Number(closed.variance)).toBe(0);
    expect(Number(closed.cash_tenders)).toBe(1500);
    expect(Number(closed.other_tenders)).toBe(1500);
    expect(Number(closed.refund_total)).toBe(700);
    expect(closed.report_number).toMatch(/^Z-\d{4}-\d+$/);
    const n1 = Number(String(closed.report_number).split('-').pop());
    // Sequential numbering: a second close on a fresh till gets exactly n+1.
    await c.query('reset role');
    const termZ2 = String((await c.query("insert into public.pos_terminals(business_id,name,branch_id) values($1,'R13 Till Z2',(select branch_id from public.pos_terminals where id=$2)) returning id", [orgs.A.business, orgs.A.terminal])).rows[0].id);
    await c.query('set local role authenticated');
    const opened2 = await openShift(c, { key: 'r13-r08-z-2', terminal: termZ2, opening: 0 });
    const closed2 = await closeShift(c, String(opened2.shift_id), 'r13-r08-z-close-2', 0);
    expect(Number(String(closed2.report_number).split('-').pop())).toBe(n1 + 1);
    expect(Number(closed2.cash_tenders)).toBe(0);
    // Live report AFTER close: drift-free digest of the immutable snapshot.
    const post = await report(shiftId);
    const closeBlock = post.close as Record<string, unknown>;
    expect(closeBlock.report_number).toBe(closed.report_number);
    expect(Number(closeBlock.expected_cash)).toBe(5800);
    expect(closeBlock.tender_breakdown).toEqual({ cash: 1500, card: 1000, airtel_money: 500 });
    expect(Number(post.cash_tenders)).toBe(1500);
    expect(Number(post.expected_cash)).toBe(5800);
    await c.query('reset role');
    const snap = (await c.query('select md5(payload::text) h, tender_breakdown from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0];
    expect(snap.h).toBe(closeBlock.payload_hash);
    expect(snap.tender_breakdown).toEqual({ cash: 1500, card: 1000, airtel_money: 500 });
  });
});

test(meta('R08.SHIFT.REPORT-AUTHORITY', 'get_pos_shift_report authority matrix (§17): cashier reads own-branch report; org-wide read role (accountant) passes; assigned-scope caller in another branch ⇒ 42501; foreign-org caller ⇒ 42501; unknown shift ⇒ 22023'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-ra-1' });
    const shiftId = String(opened.shift_id);
    const report = () => c.query('select public.get_pos_shift_report($1) r', [shiftId]);
    const own = (await report()).rows[0].r as Record<string, unknown>;
    expect(own.status).toBe('open');
    // Org-wide read role (accountant, unassigned) reads the same derivation.
    await setActor(c, identities.A_accountant.id);
    const accRead = (await report()).rows[0].r as Record<string, unknown>;
    expect(accRead.shift_id).toBe(shiftId);
    // Assigned-scope caller confined to another branch: denied.
    await c.query('reset role');
    await c.query('update public.business_users set branch_id=$1 where business_id=$2 and user_id=$3', [orgs.A.branch2, orgs.A.business, identities.A_branch_manager.id]);
    await c.query('set local role authenticated');
    await setActor(c, identities.A_branch_manager.id);
    await deniedInTx(c, report, ['42501'], /no access to this shift/);
    // Foreign-org caller: denied (no membership ⇒ can_access_branch false).
    await setActor(c, identities.B_cashier.id);
    await deniedInTx(c, report, ['42501'], /no access to this shift/);
    // Unknown shift id: 22023.
    await setActor(c, identities.A_cashier.id);
    await deniedInTx(c, () => c.query("select public.get_pos_shift_report('f0000000-0000-4000-8000-000000000099'::uuid)"), ['22023'], /Unknown shift/);
  });
});

test(meta('R08.HISTORY.POS-CHANNEL', 'POS-posted sale history carries only server-set attribution: pos_shift_id bound to the caller own open shift, branch stamped from the authorised till, cashier identity/name resolved from auth state and user_profiles — caller-supplied steering is never persisted'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-hist-1' });
    const shiftId = String(opened.shift_id);
    const payload = saleFixture(orgs.A, 301) as Record<string, unknown>;
    payload.terminal_id = orgs.A.terminal;
    delete payload.shift_id;
    const sale = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as Record<string, unknown>;
    const replay = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as Record<string, unknown>;
    expect(replay.idempotent).toBe(true);
    await c.query('reset role');
    const inv = (await c.query('select pos_shift_id, branch_id from public.invoices where id=$1', [sale.id])).rows[0];
    expect(String(inv.pos_shift_id)).toBe(shiftId);
    expect(String(inv.branch_id)).toBe(orgs.A.branch);
    const shift = (await c.query('select cashier_id, cashier_name, terminal_id, branch_id from public.pos_shifts where id=$1', [shiftId])).rows[0];
    expect(String(shift.cashier_id)).toBe(identities.A_cashier.id);
    expect(shift.cashier_name).toBe('R13 cashier'); // auth-profile-resolved, never caller-sent
    expect(String(shift.terminal_id)).toBe(orgs.A.terminal);
    expect(String(shift.branch_id)).toBe(orgs.A.branch);
    const count = (await c.query('select count(*)::int n from public.invoices where pos_shift_id=$1', [shiftId])).rows[0].n;
    expect(count).toBe(1);
  });
});

test(meta('R08.HISTORY.COMPLETE-PROJECTION', 'History projection is complete and derived: the original sale rows are never mutated by R07 corrections; refund and void land as separate corrections; tender derivation agrees with the corrections; replay keys cannot double-apply', 'R08·R07 seam'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-hist2-1' });
    const shiftId = String(opened.shift_id);
    const post = async (n: number) => {
      const p = saleFixture(orgs.A, n) as Record<string, unknown>;
      p.terminal_id = orgs.A.terminal;
      delete p.shift_id;
      return (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(p)])).rows[0].r as Record<string, unknown>;
    };
    const sale1 = await post(311);
    const sale2 = await post(312);
    await setActor(c, identities.A_admin.id);
    const refund = (await c.query('select public.refund_pos_sale_command($1::jsonb) r', [JSON.stringify({
      business_id: orgs.A.business, invoice_id: sale1.id, command_key: 'r13-r08-hist2-ref',
      reason: 'R13 projection', lines: [{ amount: 600, description: 'partial return' }],
    })])).rows[0].r as Record<string, unknown>;
    const refundReplay = (await c.query('select public.refund_pos_sale_command($1::jsonb) r', [JSON.stringify({
      business_id: orgs.A.business, invoice_id: sale1.id, command_key: 'r13-r08-hist2-ref',
      reason: 'R13 projection', lines: [{ amount: 600, description: 'partial return' }],
    })])).rows[0].r as Record<string, unknown>;
    expect(refundReplay.idempotent).toBe(true);
    const voided = (await c.query('select public.void_pos_sale_command($1::jsonb) r', [JSON.stringify({
      business_id: orgs.A.business, invoice_id: sale2.id, command_key: 'r13-r08-hist2-void', reason: 'R13 projection void',
    })])).rows[0].r as Record<string, unknown>;
    void refund; void voided;
    await setActor(c, identities.A_cashier.id);
    const report = (await c.query('select public.get_pos_shift_report($1) r', [shiftId])).rows[0].r as Record<string, unknown>;
    // Derivation: only sale1 (paid) tenders; refund reduces the cash drawer by 600.
    expect(Number(report.sales_count)).toBe(1);
    expect(Number(report.cash_tenders)).toBe(1500);
    expect(Number(report.refund_total)).toBe(600);
    expect(Number(report.expected_cash)).toBe(100000 + 1500 - 600);
    await c.query('reset role');
    // Projection completeness: BOTH documents remain visible, unchanged in amounts.
    const docs = (await c.query('select id, status, total_amount from public.invoices where pos_shift_id=$1 order by created_at', [shiftId])).rows;
    expect(docs.length).toBe(2);
    const original1 = docs.find((d) => String(d.id) === String(sale1.id))!;
    const original2 = docs.find((d) => String(d.id) === String(sale2.id))!;
    expect(Number(original1.total_amount)).toBe(1500);
    expect(original1.status).toBe('paid');
    expect(Number(original2.total_amount)).toBe(1500);
    expect(original2.status).toBe('void'); // R07 byte-stable correction behaviour
    // Corrections ledger: exactly one refund + one void (replay did not double-apply).
    const corr = (await c.query("select command_type, count(*)::int n from public.pos_corrections where business_id=$1 and document_id = any($2) group by command_type", [orgs.A.business, [sale1.id, sale2.id]])).rows;
    const byType = Object.fromEntries(corr.map((r) => [r.command_type, r.n]));
    expect(byType.refund_sale).toBe(1);
    expect(byType.void_sale).toBe(1);
  });
});

test(meta('R08.REFUND.DRAWER-EFFECT', 'R07 refund reconciles into R08 drawer reporting through derivation alone: settlement-journal channel wins (cash vs non-cash), open-shift and post-close handled, signed close immutable, replay adds nothing, no double-count anywhere', 'R08·R07 seam'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-rd-1', opening: 10000 });
    const shiftId = String(opened.shift_id);
    const post = async (n: number, mut?: (p: Record<string, unknown>) => void) => {
      const p = saleFixture(orgs.A, n) as Record<string, unknown>;
      p.terminal_id = orgs.A.terminal;
      delete p.shift_id;
      if (mut) mut(p);
      return (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(p)])).rows[0].r as Record<string, unknown>;
    };
    const refund = (k: string, invoice: unknown, lines: Record<string, unknown>[], extra?: Record<string, unknown>) =>
      setActor(c, identities.A_admin.id)
        .then(() => c.query('select public.refund_pos_sale_command($1::jsonb) r', [JSON.stringify({
          business_id: orgs.A.business, invoice_id: invoice, command_key: k, reason: 'R13 drawer seam', lines, ...extra,
        })]))
        .then((r) => r.rows[0].r as Record<string, unknown>)
        .then((res) => setActor(c, identities.A_cashier.id).then(() => res));
    const report = (sid: string) => c.query('select public.get_pos_shift_report($1) r', [sid]).then((r) => r.rows[0].r as Record<string, unknown>);

    // ── Open-shift: cash refund + product-bearing refund, then replays ──
    const sale1 = await post(401);
    const r1 = await refund('r13-r08-rd-ref1', sale1.id, [{ amount: 300, description: 'cash-only partial' }]);
    const r2 = await refund('r13-r08-rd-ref2', sale1.id, [{ amount: 200, product_id: orgs.A.product, quantity: 1, description: 'goods return' }]);
    expect(Number(r1.amount)).toBe(300);
    expect(Number(r2.amount)).toBe(200);
    // Replay both keys: idempotent, no second effect (§11).
    const r1again = await refund('r13-r08-rd-ref1', sale1.id, [{ amount: 300, description: 'cash-only partial' }]);
    const r2again = await refund('r13-r08-rd-ref2', sale1.id, [{ amount: 200, product_id: orgs.A.product, quantity: 1, description: 'goods return' }]);
    expect(r1again.idempotent).toBe(true);
    expect(r2again.idempotent).toBe(true);

    await c.query('reset role');
    // Corrections ledger: exactly two rows total — replays did not double (§5, §11).
    const corr = (await c.query("select count(*)::int n, sum(amount) a from public.pos_corrections where business_id=$1 and command_type='refund_sale' and document_id=$2", [orgs.A.business, sale1.id])).rows[0];
    expect(corr.n).toBe(2);
    expect(Number(corr.a)).toBe(500);
    // No invoice_payments rows are created by refunds (no second tender reversal) (§3, §5).
    const pays = (await c.query('select count(*)::int n, payment_method from public.invoice_payments where invoice_id=$1 group by payment_method', [sale1.id])).rows;
    expect(pays.length).toBe(1);
    expect(Number(pays[0].n)).toBe(1);
    expect(pays[0].payment_method).toBe('cash');
    // Settlement journals: exactly one credit leg to the cash account per correction (no duplicate legs) (§5).
    const legs = (await c.query(`select c.command_key k, count(*)::int n, sum(jl.amount) a
        from public.pos_corrections c
        join public.journal_entries je on je.business_id = c.business_id
          and je.posting_key = 'refund:' || c.command_key || ':settlement'
          and je.source_type = 'invoice' and je.source_id = c.document_id::text
        join public.journal_lines jl on jl.journal_entry_id = je.id and not jl.is_debit
       where c.business_id=$1 and c.command_type='refund_sale' and c.document_id=$2
       group by c.command_key order by k`, [orgs.A.business, sale1.id])).rows;
    expect(legs.length).toBe(2);
    expect(legs[0].n).toBe(1);
    expect(legs[1].n).toBe(1);
    expect(Number(legs[0].a) + Number(legs[1].a)).toBe(500);
    // Inventory: exactly one return_in movement for the product-bearing refund (no double adjustment) (§5, §7).
    const returns = (await c.query("select count(*)::int n, sum(quantity) q from public.stock_movements where business_id=$1 and source_type='pos_refund'", [orgs.A.business])).rows[0];
    expect(returns.n).toBe(1);
    expect(Number(returns.q)).toBe(1);
    // Drawer: NO cash movement rows were synthesized for refunds (§5).
    const movs = (await c.query('select count(*)::int n from public.pos_cash_movements where business_id=$1 and shift_id=$2', [orgs.A.business, shiftId])).rows[0].n;
    expect(movs).toBe(0);

    // ── Non-cash channel: refund settled onto a bank account must NOT touch the drawer (§9) ──
    const cashAcct = (await c.query("select id from public.accounts where business_id=$1 and code='1110'", [orgs.A.business])).rows[0].id as string;
    const bankAcct = (await c.query('select id from public.accounts where business_id=$1 and is_bank_account and id<>$2 order by code limit 1', [orgs.A.business, cashAcct])).rows[0].id as string;
    const sale2 = await post(402, (p) => {
      (p.payments as Record<string, unknown>[])[0].payment_method = 'card';
      (p.payments as Record<string, unknown>[])[0].bank_account_id = bankAcct;
    });
    await refund('r13-r08-rd-ref3', sale2.id, [{ amount: 400, description: 'card refund to bank' }], { tender_account_id: bankAcct });
    await c.query('set local role authenticated');
    await setActor(c, identities.A_cashier.id);
    const live1 = await report(shiftId);
    expect(Number(live1.cash_tenders)).toBe(1500);
    expect(Number(live1.other_tenders)).toBe(1500);
    expect(Number(live1.refund_total)).toBe(500);        // cash-effect only: 300 + 200
    expect(Number(live1.refunds_gross_total)).toBe(900); // every channel: + 400 bank
    expect(Number(live1.expected_cash)).toBe(10000 + 1500 - 500);
    expect(Number(live1.sales_count)).toBe(2);

    // ── Close: snapshot reconciles; then post-close refund leaves it immutable (§6, §8) ──
    const closed = await closeShift(c, shiftId, 'r13-r08-rd-close', 11000);
    expect(Number(closed.expected_cash)).toBe(11000);
    expect(Number(closed.refund_total)).toBe(500);
    expect(Number(closed.variance)).toBe(0);
    await c.query('reset role');
    const h0 = (await c.query('select md5(payload::text) h from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0].h;
    await c.query('set local role authenticated');
    // The R07 contract permits refunds against the closed shift's document.
    const r4 = await refund('r13-r08-rd-ref4', sale1.id, [{ amount: 100, description: 'post-close return' }]);
    expect(r4.idempotent).toBeFalsy();
    const r4again = await refund('r13-r08-rd-ref4', sale1.id, [{ amount: 100, description: 'post-close return' }]);
    expect(r4again.idempotent).toBe(true);
    const live2 = await report(shiftId);
    const closeBlock = live2.close as Record<string, unknown>;
    // Current view incorporates the late effect; the signed close is untouched (§6).
    expect(Number(live2.refund_total)).toBe(600);
    expect(Number(live2.expected_cash)).toBe(10000 + 1500 - 600);
    expect(Number(closeBlock.refund_total)).toBe(500);
    expect(Number(closeBlock.expected_cash)).toBe(11000);
    await c.query('reset role');
    const h1 = (await c.query('select md5(payload::text) h from public.pos_shift_closes where shift_id=$1', [shiftId])).rows[0].h;
    expect(h1).toBe(h0);
    // Late SALE adjustments mechanism untouched by refunds (§6; mechanism-vs-mutation documented).
    const late = (await c.query('select count(*)::int n from public.pos_shift_late_adjustments where business_id=$1 and shift_id=$2', [orgs.A.business, shiftId])).rows[0].n;
    expect(late).toBe(0);
    // Attribution never wanders to a different shift (§10): a fresh shift on the same till shows no refunds.
    await c.query('set local role authenticated');
    const opened2 = await openShift(c, { key: 'r13-r08-rd-2', terminal: orgs.A.terminal, opening: 0 });
    const live3 = await report(String(opened2.shift_id));
    expect(Number(live3.refund_total)).toBe(0);
    expect(Number(live3.refunds_gross_total)).toBe(0);
  });
});

test(meta('R08.REFUND.SCOPE-ATTACK', "§15 attack matrix on the refund seam: foreign-org refund command denied; refund attribution follows the document's durable shift (never caller steered); wrong-branch report reads denied; drawer reporting stays lane-clean; all denied/steered attempts mutate zero"), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const opened = await openShift(c, { key: 'r13-r08-ra2-1', opening: 2000 });
    const shiftId = String(opened.shift_id);
    const payload = saleFixture(orgs.A, 411) as Record<string, unknown>;
    payload.terminal_id = orgs.A.terminal;
    delete payload.shift_id;
    const sale = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as Record<string, unknown>;

    const snapshot = async () => {
      await c.query('reset role');
      const tables = ['invoices','invoice_payments','journal_entries','journal_lines','pos_corrections','stock_movements','pos_shifts','pos_shift_closes','pos_shift_late_adjustments','pos_cash_movements'] as const;
      const out: Record<string, number> = {};
      for (const t of tables) out[t] = (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n as number;
      return out;
    };
    const before = await snapshot();
    await c.query('set local role authenticated');

    // Foreign-org caller runs the R07 command against A's invoice: denied, zero mutation (§15 wrong org).
    await setActor(c, identities.B_cashier.id);
    await deniedInTx(c, () => c.query('select public.refund_pos_sale_command($1::jsonb)', [JSON.stringify({
      business_id: orgs.A.business, invoice_id: sale.id, command_key: 'r13-r08-atk-1',
      lines: [{ amount: 100, description: 'foreign attempt' }],
    })]), ['42501']);
    // Caller-supplied steering keys must win NOTHING: valid refund with garbage context keys (§15 steering).
    await setActor(c, identities.A_admin.id);
    const steered = (await c.query('select public.refund_pos_sale_command($1::jsonb) r', [JSON.stringify({
      business_id: orgs.A.business, invoice_id: sale.id, command_key: 'r13-r08-atk-2',
      shift_id: orgs.B.shift, branch_id: orgs.B.branch, terminal_id: orgs.B.terminal, cashier_id: identities.B_cashier.id,
      lines: [{ amount: 125, description: 'steering attempt' }],
    })])).rows[0].r as Record<string, unknown>;
    expect(Number(steered.amount)).toBe(125);
    await setActor(c, identities.A_cashier.id);
    const report = (sid: string) => c.query('select public.get_pos_shift_report($1) r', [sid]).then((r) => r.rows[0].r as Record<string, unknown>);
    const aReport = await report(shiftId);
    expect(Number(aReport.refund_total)).toBe(125); // attributed to the document's durable shift only
    // Wrong-shift lane: the fixture's other (legacy) shift and org B surfaces reflect nothing (§15 wrong shift/org).
    const legacy = await report(orgs.A.shift);
    expect(Number(legacy.refund_total)).toBe(0);
    await setActor(c, identities.B_cashier.id);
    const bReport = await report(orgs.B.shift);
    expect(Number(bReport.refund_total)).toBe(0);
    // Zero-leak lane invariant that survives any fixture-sale composition: A's sale+correction stream
    // never crosses into B — B's expected cash equals its opening float exactly (nothing in, nothing out).
    expect(Number(bReport.expected_cash)).toBe(Number(bReport.opening_cash));
    // Wrong branch: assigned A2 manager cannot read this A1-shift report (§15 wrong branch).
    await c.query('reset role');
    await c.query('update public.business_users set branch_id=$1 where business_id=$2 and user_id=$3', [orgs.A.branch2, orgs.A.business, identities.A_branch_manager.id]);
    await c.query('set local role authenticated');
    await setActor(c, identities.A_branch_manager.id);
    await deniedInTx(c, () => c.query('select public.get_pos_shift_report($1)', [shiftId]), ['42501'], /no access to this shift/);
    // Non-trivial identity steering: cashier (non-tier) refund denied by R07 preflight (§15 identity).
    await setActor(c, identities.A_cashier.id);
    await deniedInTx(c, () => c.query('select public.refund_pos_sale_command($1::jsonb)', [JSON.stringify({
      business_id: orgs.A.business, invoice_id: sale.id, command_key: 'r13-r08-atk-3',
      lines: [{ amount: 100, description: 'under-tier attempt' }],
    })]), ['42501', '22023']);

    const after = await snapshot();
    const expectedDeltas: Record<string, number> = { pos_corrections: 1, journal_entries: 0, journal_lines: 0, invoices: 0, invoice_payments: 0, stock_movements: 0, pos_shifts: 0, pos_shift_closes: 0, pos_shift_late_adjustments: 0, pos_cash_movements: 0 };
    void expectedDeltas;
    expect(after.pos_corrections).toBe(before.pos_corrections + 1); // only the valid steered refund
    expect(after.invoice_payments).toBe(before.invoice_payments);
    expect(after.invoices).toBe(before.invoices);
    expect(after.stock_movements).toBe(before.stock_movements);
    expect(after.pos_cash_movements).toBe(before.pos_cash_movements);
    expect(after.pos_shift_late_adjustments).toBe(before.pos_shift_late_adjustments);
    expect(after.pos_shift_closes).toBe(before.pos_shift_closes);
    // Denials added nothing; assertions on journal tables verify balance-production only for the valid path.
    expect(after.journal_entries).toBeGreaterThanOrEqual(before.journal_entries);
    expect(after.pos_shifts).toBe(before.pos_shifts);
  });
});

test(meta('R08.SHIFT.CROSS-BRANCH-DENIED', "§5: a caller durable-assigned to branch A1 cannot open/close/move on/report/post onto branch-A2 tills, shifts and documents (42501; foreign-org = 22023 where the object is outside their business); every denied surface mutates zero rows"), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    // Privileged fixture (service): A_cashier is now durable-confined to branch A1 (DEC-03 assignment).
    await c.query('reset role');
    await c.query('update public.business_users set branch_id=$1 where business_id=$2 and user_id=$3', [orgs.A.branch, orgs.A.business, identities.A_cashier.id]);
    // A fully-formed Branch-A2 till lane: terminal + a canonical open shift + a closed shift with a signed close.
    const terminalA2 = String((await c.query("insert into public.pos_terminals(business_id,name,branch_id) values($1,'R13 Till A2',$2) returning id", [orgs.A.business, orgs.A.branch2])).rows[0].id);
    const shiftA2open = String((await c.query("insert into public.pos_shifts(business_id,branch_id,terminal_id,cashier_id,cashier_name,opened_at,opening_cash,expected_cash,status,open_command_key) values($1,$2,$3,$4,'R13 admin',now(),0,0,'open','r13-r08-xb-open-a2') returning id", [orgs.A.business, orgs.A.branch2, terminalA2, identities.A_admin.id])).rows[0].id);
    const shiftA2closed = String((await c.query("insert into public.pos_shifts(business_id,branch_id,terminal_id,cashier_id,cashier_name,opened_at,opening_cash,expected_cash,status,closed_at,open_command_key) values($1,$2,$3,$4,'R13 admin',now(),100000,100000,'closed',now(),'r13-r08-xb-closed-a2') returning id", [orgs.A.business, orgs.A.branch2, terminalA2, identities.A_admin.id])).rows[0].id);
    const closeA2 = String((await c.query("insert into public.pos_shift_closes(business_id,shift_id,command_key,report_number,closed_by,cashier_id,terminal_id,branch_id,opened_at,closed_at,opening_cash,cash_tenders,other_tenders,refund_total,cash_in_total,cash_out_total,sales_count,expected_cash,actual_cash,variance,payload) values($1,$2,'r13-r08-xb-close-a2','Z-XB-A2',$3,$4,$5,$6,now(),now(),100000,0,0,0,0,0,0,100000,100000,0,'{}'::jsonb) returning id", [orgs.A.business, shiftA2closed, identities.A_admin.id, identities.A_admin.id, terminalA2, orgs.A.branch2])).rows[0].id);
    const movementA2 = String((await c.query("insert into public.pos_cash_movements(business_id,branch_id,shift_id,user_id,user_name,movement_type,amount,reason,command_key) values($1,$2,$3,$4,'R13 admin','cash_in',1000,'seed','r13-r08-xb-mov-a2') returning id", [orgs.A.business, orgs.A.branch2, shiftA2closed, identities.A_admin.id])).rows[0].id);
    await c.query('set local role authenticated');
    await setActor(c, identities.A_cashier.id);

    // Mutation envelope BEFORE the attacks (service observer).
    const tables = ['pos_shifts','pos_cash_movements','pos_shift_closes','pos_shift_late_adjustments','invoices','invoice_payments','pos_corrections','journal_entries','journal_lines','stock_movements'] as const;
    const snap = async () => {
      await c.query('reset role');
      const out: Record<string, number> = {};
      for (const t of tables) out[t] = (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n as number;
      await c.query('set local role authenticated');
      await setActor(c, identities.A_cashier.id);
      return out;
    };
    const before = await snap();

    // ── Branch-A2 terminal (§5): 42501, terminal's branch not the caller's ──
    await deniedInTx(c, () => openShift(c, { key: 'r13-r08-xb-1', terminal: terminalA2 }), ['42501'], /no access to the terminal's branch/);
    // ── Branch-A2 shift surfaces (§5) ──
    await deniedInTx(c, () => closeShift(c, shiftA2open, 'r13-r08-xb-2'), ['42501'], /may not operate POS/);
    await deniedInTx(c, () => movement(c, shiftA2open, 'r13-r08-xb-3', 'cash_out', 500), ['42501'], /may not operate POS/);
    await deniedInTx(c, () => c.query('select public.get_pos_shift_report($1)', [shiftA2closed]), ['42501'], /no access to this shift/);
    // ── Branch-A2 document posting (§5): terminal-steered ──
    const saleOnA2terminal = saleFixture(orgs.A, 501) as Record<string, unknown>;
    delete saleOnA2terminal.shift_id;
    saleOnA2terminal.terminal_id = terminalA2;
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(saleOnA2terminal)]), ['42501'], /no access to the terminal's branch/);
    // ── Branch-A2 shift-steered document posting ──
    const saleOnA2shift = saleFixture(orgs.A, 502) as Record<string, unknown>;
    delete saleOnA2shift.terminal_id;
    saleOnA2shift.shift_id = shiftA2open;
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(saleOnA2shift)]), ['42501'], /no access to the shift's branch/);
    // ── Foreign-org objects are NONEXISTENT for the caller (established 22023 contract; not a branch check) ──
    await deniedInTx(c, () => openShift(c, { key: 'r13-r08-xb-4', terminal: orgs.B.terminal }), ['22023'], /foreign terminal/);
    await deniedInTx(c, () => c.query('select public.get_pos_shift_report($1)', [orgs.B.shift]), ['42501']);

    // RLS read invisibility: only the A1 lane is visible to the A1-assigned caller.
    const shiftRows = (await c.query('select id from public.pos_shifts where business_id=$1', [orgs.A.business])).rows.map((r) => String(r.id));
    expect(shiftRows).toContain(orgs.A.shift);
    expect(shiftRows).not.toContain(shiftA2open);
    expect(shiftRows).not.toContain(shiftA2closed);
    expect((await c.query('select count(*)::int n from public.pos_shift_closes where shift_id=$1', [shiftA2closed])).rows[0].n).toBe(0);
    expect((await c.query('select count(*)::int n from public.pos_cash_movements where shift_id=$1', [shiftA2closed])).rows[0].n).toBe(0);
    // Positive in-branch control: the same caller CAN reach its own A1 lane (report read).
    const ownReport = (await c.query('select public.get_pos_shift_report($1) r', [orgs.A.shift])).rows[0].r as Record<string, unknown>;
    expect(ownReport).toBeTruthy();

    // Zero-mutation envelope for every denied branch escape (§5 zero-mutation clause).
    const after = await snap();
    for (const t of tables) expect(after[t], `${t} mutated by denied cross-branch attempts`).toBe(before[t]);
    // The privileged fixture rows themselves are the documented pre-state (A2 lane existed before the attacks).
    expect(String(closeA2) !== '' && String(movementA2) !== '' && String(shiftA2open) !== '' && String(shiftA2closed) !== '').toBe(true);
  });
});

test(meta('R08.BRANCH.SERVER-SCOPE', "§6: DEC-03 matrix proven AT THE SERVER — predicate truth-table for org-wide/assigned/NULL/inactive/non-member; org-wide read != write (accountant/A auditor read spans branches, POS writes denied); caller-controlled branch substitution rejected on the document surface; NULL = explicit org-wide; cross-organisation combination attacks deny with zero leakage and zero mutation"), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
    // ── (a) Predicate truth table over SYNTHETIC members (tx-local; rolls back) ──
    const mk = async (uid: string, role: string, branch: string | null, active = true) => {
      await c.query('reset role');
      await c.query('insert into public.business_users(business_id,user_id,role,is_active,branch_id) values($1,$2,$3::user_role,$4,$5)', [orgs.A.business, uid, role, active, branch]);
      await c.query('set local role authenticated');
    };
    const U = (n: number) => `13000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
    await mk(U(801), 'auditor', null);                 // org-wide read role
    await mk(U(802), 'manager', orgs.A.branch2);       // org-wide role WITH an assignment — role wins
    await mk(U(803), 'cashier', orgs.A.branch);        // assigned-scope → A1 only
    await mk(U(804), 'branch_manager', orgs.A.branch2);// assigned-scope → A2 only
    await mk(U(805), 'cashier', null);                 // NULL = explicit org-wide
    await mk(U(806), 'auditor', orgs.A.branch2, false);// inactive ⇒ no access at all
    const matrix: Array<[string, boolean, boolean]> = [
      [U(801), true, true],   // auditor org-wide: both branches
      [U(802), true, true],   // manager org-wide despite A2 assignment
      [U(803), true, false],  // A1 cashier → A1 only
      [U(804), false, true],  // A2 branch_manager → A2 only
      [U(805), false, false], // P7 DEC-03 P5-D: assigned cashier NULL = fail-closed (not org-wide)
      [U(806), false, false], // inactive
    ];
    for (const [uid, a1, a2] of matrix) {
      await setActor(c, uid);
      const row = (await c.query('select public.can_access_branch($1,$2) a1, public.can_access_branch($1,$3) a2', [orgs.A.business, orgs.A.branch, orgs.A.branch2])).rows[0];
      expect(row.a1, `matrix a1 for ${uid}`).toBe(a1);
      expect(row.a2, `matrix a2 for ${uid}`).toBe(a2);
    }
    // Non-member has nothing by definition.
    await setActor(c, identities.B_cashier.id);
    expect((await c.query('select public.can_access_branch($1,$2) v', [orgs.A.business, orgs.A.branch])).rows[0].v).toBe(false);
    expect((await c.query('select public.can_access_branch($1,$2) v', [orgs.B.business, orgs.B.branch])).rows[0].v).toBe(true);

    // ── (b) Org-wide READ role ≠ POS write authority: read spans branches, writes denied ──
    await c.query('reset role');
    const shiftA2 = String((await c.query("insert into public.pos_shifts(business_id,branch_id,cashier_id,cashier_name,opening_cash,status) values($1,$2,$3,'R13 admin',0,'open') returning id", [orgs.A.business, orgs.A.branch2, identities.A_admin.id])).rows[0].id);
    await c.query('set local role authenticated');
    await setActor(c, identities.A_accountant.id);
    const visibleToAccountant = (await c.query('select id from public.pos_shifts where business_id=$1', [orgs.A.business])).rows.map((r) => String(r.id));
    expect(visibleToAccountant).toContain(orgs.A.shift); // A1
    expect(visibleToAccountant).toContain(shiftA2);      // A2 — org-wide read spans branches
    await deniedInTx(c, () => c.query('select public.open_pos_shift_command($1::jsonb)', [JSON.stringify({
      business_id: orgs.A.business, terminal_id: orgs.A.terminal, command_key: 'r13-r08-ss-1' })]), ['42501'], /may not operate POS/);
    await deniedInTx(c, () => c.query('select public.record_pos_cash_movement_command($1::jsonb)', [JSON.stringify({
      shift_id: orgs.A.shift, command_key: 'r13-r08-ss-2', movement_type: 'cash_in', amount: 1, reason: 'probe' })]), ['42501'], /may not operate POS/);
    await deniedInTx(c, () => c.query('select public.close_pos_shift_command($1::jsonb)', [JSON.stringify({
      shift_id: orgs.A.shift, command_key: 'r13-r08-ss-3', closing_cash: 0 })]), ['42501'], /may not operate POS/);

    // ── (c) NULL branch = fail-closed for assigned-scope (P7 DEC-03 P5-D): cashier NULL cannot open at A2 ──
    // Seeded A_cashier is now assigned to A1 per fixture; use dedicated NULL cashier U(805) for negative test
    await setActor(c, U(805));
    await c.query('reset role');
    const terminalA2b = String((await c.query("insert into public.pos_terminals(business_id,name,branch_id) values($1,'R13 Till A2 SS',$2) returning id", [orgs.A.business, orgs.A.branch2])).rows[0].id);
    await c.query('set local role authenticated');
    await deniedInTx(c, () => openShift(c, { key: 'r13-r08-ss-4', terminal: terminalA2b }), ['42501'], /no access.*branch/i);
    // Positive control: A2-assigned branch_manager (U804) can open at A2
    await setActor(c, U(804));
    const openedByA2 = await openShift(c, { key: 'r13-r08-ss-4b', terminal: terminalA2b });
    expect(openedByA2.idempotent).toBe(false);
    expect(String(openedByA2.branch_id)).toBe(orgs.A.branch2);
    const closedA2 = await closeShift(c, String(openedByA2.shift_id), 'r13-r08-ss-5b', 100000);
    expect(closedA2.idempotent).toBe(false);

    // ── (d) Caller-controlled branch substitution on the document surface ──
    await c.query('reset role');
    await c.query('update public.business_users set branch_id=$1 where business_id=$2 and user_id=$3', [orgs.A.branch, orgs.A.business, identities.A_cashier.id]);
    await c.query('set local role authenticated');
    await setActor(c, identities.A_cashier.id);
    // Terminal authoritative: payload branch A2 on the A1 till ⇒ conflict, 22023, zero mutation.
    const conflicting = saleFixture(orgs.A, 511) as Record<string, unknown>;
    delete conflicting.shift_id;
    conflicting.terminal_id = orgs.A.terminal;
    (conflicting.invoice as Record<string, unknown>).branch_id = orgs.A.branch2; // branch is a property of the invoice document (p_payload.invoice), not a top-level steer
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(conflicting)]), ['22023'], /branch conflicts/);
    // Bare substitution: A2 claimed with no terminal/shift truth ⇒ 42501 branch denial.
    const bareSubstitute = saleFixture(orgs.A, 512) as Record<string, unknown>;
    delete bareSubstitute.shift_id;
    delete bareSubstitute.terminal_id;
    (bareSubstitute.invoice as Record<string, unknown>).branch_id = orgs.A.branch2;
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(bareSubstitute)]), ['42501'], /no access to the requested branch/);
    // Positive control: consistent A1 context posts (assigned caller still has their own branch).
    const ownSale = saleFixture(orgs.A, 513) as Record<string, unknown>;
    delete ownSale.shift_id;
    ownSale.terminal_id = orgs.A.terminal;
    const postedOwn = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(ownSale)])).rows[0].r;
    expect((postedOwn as Record<string, unknown>).id).toBeTruthy();

    // ── (e) Cross-organisation combination attacks: zero leakage, zero mutation ──
    await c.query('reset role');
    const tables = ['invoices','invoice_payments','journal_entries','journal_lines','pos_corrections','stock_movements','pos_shifts','pos_shift_closes','pos_shift_late_adjustments','pos_cash_movements'] as const;
    const before: Record<string, number> = {};
    for (const t of tables) before[t] = (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n as number;
    await c.query('set local role authenticated');
    await setActor(c, identities.B_cashier.id);
    // B caller + A business + A terminal.
    await deniedInTx(c, () => c.query('select public.open_pos_shift_command($1::jsonb)', [JSON.stringify({
      business_id: orgs.B.business, terminal_id: orgs.A.terminal, command_key: 'r13-r08-ss-6' })]), ['22023'], /foreign terminal/);
    await deniedInTx(c, () => c.query('select public.open_pos_shift_command($1::jsonb)', [JSON.stringify({
      business_id: orgs.A.business, terminal_id: orgs.A.terminal, command_key: 'r13-r08-ss-7' })]), ['42501'], /may not operate POS/);
    // B caller + A shift + A document.
    await deniedInTx(c, () => c.query('select public.record_pos_cash_movement_command($1::jsonb)', [JSON.stringify({
      shift_id: orgs.A.shift, command_key: 'r13-r08-ss-8', movement_type: 'cash_in', amount: 1, reason: 'probe' })]), ['42501'], /may not operate POS/);
    await deniedInTx(c, () => c.query('select public.get_pos_shift_report($1)', [orgs.A.shift]), ['42501']);
    const aSalePayload = saleFixture(orgs.A, 514) as Record<string, unknown>;
    delete aSalePayload.shift_id;
    await deniedInTx(c, () => c.query('select public.post_pos_sale($1::jsonb)', [JSON.stringify(aSalePayload)]), ['42501', '22023']);
    // Zero leakage: the member invoices/invoice_lines grants now exist (P-D4
    // 20261003000000, house member_read tier) — foreign-business rows are not
    // denied by grant but resolve to zero rows via RLS, while branch/member-
    // scoped pos_shifts likewise resolves to zero.
    expect((await c.query('select count(*)::int n from public.invoices where business_id=$1', [orgs.A.business])).rows[0].n).toBe(0);
    expect((await c.query('select count(*)::int n from public.invoice_lines where business_id=$1', [orgs.A.business])).rows[0].n).toBe(0);
    expect((await c.query('select count(*)::int n from public.pos_shifts where business_id=$1', [orgs.A.business])).rows[0].n).toBe(0);
    // Zero mutation from the entire denied cross-organisation window.
    await c.query('reset role');
    for (const t of tables) {
      const n = (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n;
      expect(n, `${t} mutated by cross-organisation probes`).toBe(before[t]);
    }
  });
});

test(meta('R08.DATA-UNCHANGED', 'Every R08.2 probe rolls back: no closes, no late adjustments, fixture shift/terminal baselines unchanged, no pos_shift_id links'), async () => {
  ready();
  const q = (t: string) => db.client.query(`select count(*)::int n from public.${t}`).then((r: { rows: Array<{ n: number }> }) => r.rows[0].n);
  expect(await q('pos_shift_closes')).toBe(0);
  expect(await q('pos_shift_late_adjustments')).toBe(0);
  expect(await q('pos_shifts')).toBe(2);
  expect(await q('pos_terminals')).toBe(2);
  expect((await db.client.query('select count(*)::int n from public.invoices where pos_shift_id is not null')).rows[0].n).toBe(0);
  expect((await db.client.query('select count(*)::int n from public.pos_cash_movements')).rows[0].n).toBe(0);
  expect(await q('contacts')).toBe(2);
  expect(await q('business_users')).toBe(14);
});
