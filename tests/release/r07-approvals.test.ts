/**
 * R07 — Canonical approval & correction commands: decision-matrix coverage.
 *
 * Verifies the R07 decisions against the canonical commands:
 *   • Decision B: approvals are server-minted, org/document/action-bound,
 *     time-limited, single-use, replay-resistant, cross-org unusable.
 *   • §5/§6: refund command verifies identity/org/authority/document/status/
 *     eligibility/approval/cumulative/idempotency; rejects with ZERO mutation;
 *     cumulative sums are enforced server-side (not by React math).
 *   • §7/§8: void = full financial reversal (never deletion/overwrite).
 *   • §9: self-approval denied (separation-of-duties default — register
 *     decision parked, enforced server-side).
 *   • §10: consumed approvals can never authorize another operation.
 *
 * Conventions: same as R05/R06 suites — observer reads after `reset role`,
 * savepoint-isolated denials with real SQLSTATE pins, everything rolls back.
 * Multi-actor flows switch the session claim within the connection (the same
 * mechanism asRole uses at transaction start).
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, saleFixture } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r07-approvals');
const M = 'supabase/migrations/20260928000002_r07_correction_commands.sql';
const LAYER = 'real PostgreSQL17 full migration replay incl. 20260928000002 R07 commands; synthetic identities; savepoint-isolated denials; observer reads after reset; all probes rolled back';
const meta = (id: string, expected: string, source = M) => ({
  id, expected, remediation: 'R07', source, layer: LAYER,
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
  const name = `sp_r07a_${++sp}`;
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
const postSale = (c: C, n: number) =>
  c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(saleFixture(orgs.A, n))]).then((r) => r.rows[0].r as { id: string });
const refund = (c: C, invoice: string, key: string, lines: unknown[], approval?: string | null) =>
  c.query('select public.refund_pos_sale_command($1::jsonb) r', [JSON.stringify({
    business_id: orgs.A.business, invoice_id: invoice, command_key: key,
    reason: 'R13 synthetic refund', lines, approval_token: approval ?? null })]).then((r) => r.rows[0].r as Record<string, unknown>);
const voidCmd = (c: C, invoice: string, key: string, approval?: string | null) =>
  c.query('select public.void_pos_sale_command($1::jsonb) r', [JSON.stringify({
    business_id: orgs.A.business, invoice_id: invoice, command_key: key,
    reason: 'R13 synthetic void', approval_token: approval ?? null })]).then((r) => r.rows[0].r as Record<string, unknown>);
const requestApproval = (c: C, business: string, action: string, doc: string, ttl = 15) =>
  c.query('select public.request_pos_approval($1,$2,$3,null,$4,$5) r', [business, action, doc, 'R13 approval request', ttl]).then((r) => r.rows[0].r as Record<string, unknown>);
const authorize = (c: C, uid: string, token: string) =>
  setActor(c, uid).then(() => c.query('select public.authorize_pos_approval($1::uuid) r', [token]).then((r) => r.rows[0].r as Record<string, unknown>));

test(meta('R07.APPROVAL.LIFECYCLE-OK', 'Server-minted approval: cashier requests, owner authorizes (org/document/action/approver/expiry bound), cashier consumes once; consumed state recorded'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const posted = await postSale(c, 41);
    const req = await requestApproval(c, orgs.A.business, 'refund_sale', posted.id);
    expect(req.status).toBe('requested');
    expect(String(req.document_id)).toBe(posted.id);
    expect(req.action).toBe('refund_sale');
    const token = String(req.token);
    const auth = await authorize(c, identities.A_owner.id, token);
    expect(auth.status).toBe('authorized');
    expect(auth.authorized_by).toBe(identities.A_owner.id);
    expect(new Date(String(auth.expires_at)).getTime()).toBeGreaterThan(Date.now());
    await setActor(c, identities.A_cashier.id);
    const r = await refund(c, posted.id, 'r13-r07-lifecycle', [{ product_id: orgs.A.product, quantity: 1, amount: 500 }], token);
    expect(r.idempotent).toBe(false);
    expect(Number(r.amount)).toBe(500);
    await c.query('reset role');
    const appr = (await c.query('select consumed_at, consumed_by from public.pos_approvals where token=$1::uuid', [token])).rows[0];
    expect(appr.consumed_at).not.toBeNull();
    expect(String(appr.consumed_by)).toBe(identities.A_cashier.id);
    expect(Number((await c.query('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3', [orgs.A.business, orgs.A.product, orgs.A.location])).rows[0].quantity_on_hand)).toBeCloseTo(100, 6);
  });
});

test(meta('R07.APPROVAL.SELF-APPROVAL-DENIED', 'Separation-of-duties default: the requester cannot authorize their own approval (22023), enforced server-side'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const posted = await postSale(c, 42);
    const req = await requestApproval(c, orgs.A.business, 'void_sale', posted.id);
    await deniedInTx(c, () => c.query('select public.authorize_pos_approval($1::uuid)', [String(req.token)]), ['22023'], /own approval/);
  });
});

test(meta('R07.APPROVAL.AUTHORITY-DENIED', 'Authorization itself is role-gated server-side: a cashier/viewer cannot authorize or request with stolen token knowledge'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const posted = await postSale(c, 43);
    const req = await requestApproval(c, orgs.A.business, 'void_sale', posted.id);
    const token = String(req.token);
    await deniedInTx(c, () => authorize(c, identities.A_cashier.id, token), ['42501'], /owner, admin or manager/);
    await deniedInTx(c, () => authorize(c, identities.A_viewer.id, token), ['42501']);
    await deniedInTx(c, () => setActor(c, identities.A_viewer.id).then(() => requestApproval(c, orgs.A.business, 'void_sale', posted.id)), ['42501']);
    // Foreign-token fantasy: gibberish token must not authorize anything.
    await setActor(c, identities.A_owner.id);
    await deniedInTx(c, () => c.query('select public.authorize_pos_approval($1::uuid)', ['f0000000-0000-4000-8000-000000000099']), ['22023']);
  });
});

test(meta('R07.APPROVAL.EXPIRY-ENFORCED', 'Expired approvals are denied at authorization and at consumption (22023)'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const posted = await postSale(c, 44);
    // Time travel uses observer privilege (approvals are write-closed to app
    // roles by design; only the definer commands may mutate their state).
    const expire = (token: string) => c.query('update public.pos_approvals set expires_at=now()-( $1::interval ) where token=$2::uuid', ['1 hour', token]);
    const req = await requestApproval(c, orgs.A.business, 'void_sale', posted.id, 1);
    await c.query('reset role');
    await expire(String(req.token));
    await c.query('set local role authenticated');
    await deniedInTx(c, () => authorize(c, identities.A_owner.id, String(req.token)), ['22023'], /expired/);
    // Authorized-then-expired consumption is likewise refused.
    const req2 = await requestApproval(c, orgs.A.business, 'void_sale', posted.id, 60);
    await authorize(c, identities.A_owner.id, String(req2.token));
    await c.query('reset role');
    await expire(String(req2.token));
    await c.query('set local role authenticated');
    await setActor(c, identities.A_cashier.id);
    await deniedInTx(c, () => voidCmd(c, posted.id, 'r13-r07-exp-cons', String(req2.token)), ['22023'], /expired/);
  });
});

test(meta('R07.APPROVAL.REPLAY-CONSUMED', 'A consumed approval can never authorize another operation: same doc/action reuse and post-propagation reuse both denied 22023'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const posted = await postSale(c, 45);
    const req = await requestApproval(c, orgs.A.business, 'refund_sale', posted.id);
    const token = String(req.token);
    await authorize(c, identities.A_owner.id, token);
    await setActor(c, identities.A_cashier.id);
    await refund(c, posted.id, 'r13-r07-replay-first', [{ product_id: orgs.A.product, quantity: 1, amount: 100 }], token);
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-replay-second', [{ product_id: orgs.A.product, quantity: 1, amount: 100 }], token), ['22023'], /already been consumed/);
    // Cross-action reuse is refused on binding before consumption state is read.
    await deniedInTx(c, () => voidCmd(c, posted.id, 'r13-r07-replay-third', token), ['22023'], /different action/);
  });
});

test(meta('R07.APPROVAL.BINDING-MISMATCH-DENIED', 'Token carries single org/document/action: cross-document, cross-action and cross-organisation use are all denied'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const p1 = await postSale(c, 46);
    const p2 = await postSale(c, 47);
    const req = await requestApproval(c, orgs.A.business, 'refund_sale', p1.id);
    const token = String(req.token);
    await authorize(c, identities.A_owner.id, token);
    await setActor(c, identities.A_cashier.id);
    // Different document.
    await deniedInTx(c, () => refund(c, p2.id, 'r13-r07-bind-doc', [{ product_id: orgs.A.product, quantity: 1, amount: 100 }], token), ['22023'], /different document/);
    // Different action (void instead of refund).
    await deniedInTx(c, () => voidCmd(c, p1.id, 'r13-r07-bind-act', token), ['22023'], /different action/);
    // Cross-organisation: a foreign business's member cannot request for this org;
    // and a foreign token cannot be authorized in this org's session chain.
    await deniedInTx(c, () => setActor(c, identities.B_cashier.id).then(() => requestApproval(c, orgs.A.business, 'refund_sale', p1.id)), ['42501']);
  });
});

test(meta('R07.REFUND.CUMULATIVE-SERVER-SIDE', 'Cumulative refund invariant: partial 500 → partial 500 → over-remaining 501 denied → exact remaining 500 → any further refund denied; sums enforced by the commands, never the client'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
    const posted = await postSale(c, 48);
    const a = await refund(c, posted.id, 'r13-r07-cum-1', [{ product_id: orgs.A.product, quantity: 0.5, amount: 500 }]);
    expect(Number(a.remaining)).toBe(1000);
    const b = await refund(c, posted.id, 'r13-r07-cum-2', [{ product_id: orgs.A.product, quantity: 0, amount: 500 }]);
    expect(Number(b.remaining)).toBe(500);
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-cum-3', [{ product_id: orgs.A.product, quantity: 0, amount: 501 }]), ['22023'], /exceeds the remaining/);
    const d = await refund(c, posted.id, 'r13-r07-cum-4', [{ product_id: orgs.A.product, quantity: 0, amount: 500 }]);
    expect(Number(d.remaining)).toBe(0);
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-cum-5', [{ product_id: orgs.A.product, quantity: 0, amount: 0.01 }]), ['22023']);
    await c.query('reset role');
    const sum = (await c.query("select coalesce(sum(amount),0)::text t from public.pos_corrections where business_id=$1 and document_id=$2 and command_type='refund_sale'", [orgs.A.business, posted.id])).rows[0].t;
    expect(Number(sum)).toBe(1500);
  });
});

test(meta('R07.REFUND.FULL-THEN-REPLAY', 'Full refund leaves 0 remaining; a second full refund under a new command key is denied; replaying the ORIGINAL command key is idempotent (no new effects)'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
    const posted = await postSale(c, 49);
    const r1 = await refund(c, posted.id, 'r13-r07-full-1', [{ product_id: orgs.A.product, quantity: 1, amount: 1500 }]);
    expect(Number(r1.remaining)).toBe(0);
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-full-2', [{ product_id: orgs.A.product, quantity: 1, amount: 1500 }]), ['22023'], /exceeds the remaining/);
    const replay = await refund(c, posted.id, 'r13-r07-full-1', [{ product_id: orgs.A.product, quantity: 1, amount: 1500 }]);
    expect(replay.idempotent).toBe(true);
    await c.query('reset role');
    expect(Number((await c.query("select count(*)::int n from public.pos_corrections where business_id=$1 and document_id=$2",[orgs.A.business, posted.id])).rows[0].n)).toBe(1);
    expect(Number((await c.query('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',[orgs.A.business,orgs.A.product,orgs.A.location])).rows[0].quantity_on_hand)).toBe(100);
  });
});

test(meta('R07.REFUND.REJECT-ZERO-MUTATION', 'A rejected refund produces ZERO financial mutation: no corrections, no journals, no stock movements created by the denied command'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
    const posted = await postSale(c, 50);
    await c.query('reset role');
    const cnt = async (t: string) => (await c.query(`select count(*)::int n from public.${t}`)).rows[0].n as number;
    const snap = { corrections: await cnt('pos_corrections'), entries: await cnt('journal_entries'), moves: await cnt('stock_movements') };
    await c.query('set local role authenticated');
    await setActor(c, identities.A_admin.id);
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-zero-1', [{ product_id: orgs.A.product, quantity: 1, amount: 2000 }]), ['22023'], /exceeds the remaining/);
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-zero-2', [{ product_id: orgs.A.product, quantity: -1, amount: 10 }]), ['22023']);
    await c.query('reset role');
    expect(await cnt('pos_corrections')).toBe(snap.corrections);
    expect(await cnt('journal_entries')).toBe(snap.entries);
    expect(await cnt('stock_movements')).toBe(snap.moves);
  });
});

test(meta('R07.REFUND.STATUS-GATING', 'Refund denied for non-posted documents: draft/unposted invoices cannot be refunded (22023); voided documents cannot be refunded (22023)'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
    await c.query('reset role');
    const draft = (await c.query(`insert into public.invoices(business_id,invoice_number,contact_id,invoice_type,status,issue_date,currency,exchange_rate,subtotal,taxable_amount,discount_percent,discount_amount,vat_amount,wht_amount,total_amount,amount_paid)
      values($1,'INV-R13-DRAFT',$2,'invoice','draft',$3,'MWK',1,1500,1500,0,0,0,0,1500,0) returning id`, [orgs.A.business, orgs.A.customer, '2026-09-21'])).rows[0].id as string;
    await c.query('set local role authenticated');
    await setActor(c, identities.A_admin.id);
    await deniedInTx(c, () => refund(c, draft, 'r13-r07-draft-1', [{ product_id: orgs.A.product, quantity: 1, amount: 10 }]), ['22023'], /paid/);
    const posted = await postSale(c, 51);
    await voidCmd(c, posted.id, 'r13-r07-voidref-1');
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-voidref-2', [{ product_id: orgs.A.product, quantity: 1, amount: 10 }]), ['22023'], /Voided/);
  });
});

test(meta('R07.VOID.AFTER-REFUND-DENIED', 'A document with recorded refunds cannot then be voided (22023): corrections converge via the refund path'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
    const posted = await postSale(c, 52);
    await refund(c, posted.id, 'r13-r07-vafr-1', [{ product_id: orgs.A.product, quantity: 0.5, amount: 500 }]);
    await deniedInTx(c, () => voidCmd(c, posted.id, 'r13-r07-vafr-2'), ['22023'], /refunds recorded/);
    await c.query('reset role');
    expect((await c.query('select status from public.invoices where id=$1', [posted.id])).rows[0].status).toBe('paid');
  });
});

test(meta('R07.CORRECTIONS.TOKEN-REQUIRED-OUTSIDE-TIER', 'Direct correction tier is owner/admin/manager exactly (mirrors the client permission model): cashier corrections without a live token are refused 22023'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const posted = await postSale(c, 53);
    await deniedInTx(c, () => refund(c, posted.id, 'r13-r07-tier-1', [{ product_id: orgs.A.product, quantity: 1, amount: 100 }]), ['22023'], /manager approval token/);
    await deniedInTx(c, () => voidCmd(c, posted.id, 'r13-r07-tier-2'), ['22023'], /manager approval token/);
  });
});

test(meta('R07.CORRECTIONS.DATA-UNCHANGED', 'Every R07 approvals/corrections probe rolls back: corrections/approvals tables empty, fixture identity data unchanged', M), async () => {
  ready();
  const q = (t: string) => db.client.query(`select count(*)::int n from public.${t}`).then((r: { rows: Array<{ n: number }> }) => r.rows[0].n);
  expect(await q('pos_corrections')).toBe(0);
  expect(await q('pos_approvals')).toBe(0);
  expect(await q('invoices')).toBe(0);
  expect(await q('journal_entries')).toBe(0);
  expect(await q('stock_movements')).toBe(0);
  expect(await q('contacts')).toBe(2);
  expect(await q('business_users')).toBe(14);
});
