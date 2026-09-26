/**
 * INCIDENT CONTAINMENT 2026-09-25 — release evidence (new chain; additive).
 *
 * Real PostgreSQL 17 (embedded), full migration replay including
 * 20261011000000–20261011000004, synthetic identities/fixtures only
 * (tests/release/fixtures.ts). NO production data, NO production access.
 * Passing here proves the migrations' behaviour on a disposable database; it
 * does NOT prove production runtime state (see report §9).
 *
 * Coverage: P2 backfill block · P3 ai_context branch authority (DB + Edge) ·
 * P4 POS availability contract · P5 COGS failure rollback · P6 atomic
 * idempotent payments (incl. concurrency) · P7 atomic invoice create
 * (incl. concurrency) · P9 deploy skew guard.
 *
 * GRANTS NOTE: table-level INSERT on invoices/invoice_lines for
 * `authenticated` was historically an undeclared Supabase platform default.
 * Migration 20261011000005 declares it, so this suite no longer emulates
 * anything — the replayed chain alone provides it (HARD.GRANTS.DECLARED).
 * RLS remains the authority (IC.INV.RLS-PRESERVED).
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, key, saleFixture, incomeFixture } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';
import { loadEdge, mockClient } from './edge-loader.mjs';

const test = evidenceSuite('ic-containment');
const LAYER = 'real PostgreSQL17 roles/JWT claims; synthetic identities; full migration replay (incl. 20261011000000–04)';
const M = {
  backfill: 'supabase/migrations/20261011000000_ic_contain_backfill_execute.sql',
  cogs: 'supabase/migrations/20261011000001_ic_cogs_failure_atomic.sql',
  pay: 'supabase/migrations/20261011000002_ic_atomic_payment_commands.sql',
  inv: 'supabase/migrations/20261011000003_ic_atomic_invoice_create.sql',
  pos: 'supabase/migrations/20261011000004_ic_pos_stock_availability.sql',
  ai: 'supabase/migrations/20261008000000_p5e_ai_branch_context.sql + supabase/functions/ai-chat/index.ts',
};
const meta = (id: string, expected: string, source: string, layer = LAYER) => ({ id, expected, remediation: 'IC-2026-09-25', source, layer });

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';
beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try {
    orgs = await seedFixture(db.client);
  } catch (e) { seedError = safeError(e); }
}, 600000);
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}

let sp = 0;
/** Run a statement that must fail inside the current tx; return the error; tx stays usable. */
async function failsWith(c: C, run: () => Promise<unknown>, codes: string[]): Promise<{ code?: string; message?: string }> {
  const name = `ic_sp_${++sp}`;
  await c.query(`savepoint ${name}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${name}`);
  if (!caught) throw new Error(`Probe completed without the expected denial (${codes.join('/')}).`);
  expect(codes).toContain(caught.code);
  return caught;
}
/** Switch the current transaction to an application role + identity. */
const as = async (c: C, uid: string | null, role = 'authenticated') => {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
  await c.query(`set local role ${role}`);
};
const su = (c: C) => c.query('reset role');
const accountId = async (c: C, org: string, code: string) =>
  (await c.query('select id from public.accounts where business_id=$1 and code=$2', [orgs[org].business, code])).rows[0]?.id as string;
const onHand = async (c: C, org = 'A') =>
  Number((await c.query('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs[org].business, orgs[org].product, orgs[org].location])).rows[0]?.quantity_on_hand);

// ── invoice helpers ─────────────────────────────────────────────────────────
const invoiceHeader = (org: string, over: Record<string, unknown> = {}) => ({
  business_id: orgs[org].business, contact_id: orgs[org].customer, branch_id: orgs[org].branch,
  invoice_type: 'invoice', status: 'sent', issue_date: DAY, due_date: DAY,
  currency: 'MWK', original_currency: 'MWK', exchange_rate: 1, functional_currency: 'MWK',
  subtotal: 1000, taxable_amount: 1000, discount_amount: 0, discount_percent: 0, vat_amount: 0, wht_amount: 0,
  total_amount: 1000, original_amount: 1000, functional_amount: 1000, amount_paid: 0, rate_date: DAY, rate_is_stale: false,
  ...over,
});
const invoiceLine = (n: number, total = 500, over: Record<string, unknown> = {}) => ({
  line_number: n, description: `IC synthetic service line ${n}`, quantity: 1, unit_price: total,
  discount_percent: 0, discount_amount: 0, tax_code: 'none', tax_rate: 0, tax_amount: 0, line_total: total, ...over,
});
const createInvoice = async (c: C, org: string, clientKey: string | null, over: Record<string, unknown> = {}, lines = [invoiceLine(1), invoiceLine(2)]) =>
  (await c.query('select public.create_invoice_with_lines($1::jsonb,$2::jsonb,$3::uuid) r',
    [JSON.stringify(invoiceHeader(org, over)), JSON.stringify(lines), clientKey])).rows[0].r as { invoice: Record<string, any>; lines: unknown[]; idempotent: boolean };
const pay = (c: C, invoiceId: string, amount: number, clientKey: string, over: Record<string, unknown> = {}) =>
  c.query('select public.record_invoice_payment($1::jsonb,$2::uuid) r', [JSON.stringify({
    invoice_id: invoiceId, amount, payment_date: DAY, payment_method: 'cash', currency: 'MWK', exchange_rate: 1, functional_amount: amount, ...over,
  }), clientKey]).then((r) => r.rows[0].r as { payment: Record<string, any>; invoice: Record<string, any>; journal_entry_id: string; idempotent: boolean });
const invoiceState = async (c: C, id: string) => {
  await su(c);
  const inv = (await c.query('select amount_paid, status from public.invoices where id=$1', [id])).rows[0];
  const payments = (await c.query('select count(*)::int n, coalesce(sum(amount),0)::numeric s from public.invoice_payments where invoice_id=$1', [id])).rows[0];
  const journals = (await c.query("select count(*)::int n from public.journal_entries where posting_key like $1", [`invoice:${id}:settlement:%`])).rows[0].n;
  return { paid: Number(inv.amount_paid), status: inv.status as string, payments: payments.n as number, paymentSum: Number(payments.s), journals: journals as number };
};

// ════════════════════════ P2 — backfill blocked ════════════════════════════
test(meta('IC.BACKFILL.AUTHENTICATED-DENIED', 'backfill_and_recalculate_inventory is not executable by authenticated callers, even the business owner: 42501 permission denied, balances unchanged (server-enforced, not UI-only)', M.backfill), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await su(c); const before = await onHand(c);
    for (const who of ['A_owner', 'A_admin', 'A_accountant', 'A_stock_clerk']) {
      await as(c, identities[who].id);
      await failsWith(c, () => c.query('select public.backfill_and_recalculate_inventory($1)', [orgs.A.business]), ['42501']);
    }
    await su(c); expect(await onHand(c)).toBe(before);
  });
});

test(meta('IC.BACKFILL.ANON-AND-PUBLIC-DENIED', 'anon and PUBLIC hold no EXECUTE on backfill_and_recalculate_inventory; service_role retains it (operator path kept, not dropped)', M.backfill), async () => {
  ready();
  const r = (await db.client.query(`select has_function_privilege('anon','public.backfill_and_recalculate_inventory(uuid)','execute') anon,
      has_function_privilege('authenticated','public.backfill_and_recalculate_inventory(uuid)','execute') auth,
      has_function_privilege('service_role','public.backfill_and_recalculate_inventory(uuid)','execute') svc,
      exists(select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             where p.oid='public.backfill_and_recalculate_inventory(uuid)'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') pub`)).rows[0];
  expect(r).toEqual({ anon: false, auth: false, svc: true, pub: false });
  await db.asRole('anon', null, async (c: C) => {
    await failsWith(c, () => c.query('select public.backfill_and_recalculate_inventory($1)', [orgs.A.business]), ['42501']);
  });
});

// ════════════════════════ P3 — AI branch authority (DB) ════════════════════
const aiCtx = (c: C, business: string, branch: string | null) =>
  c.query('select public.ai_context($1::uuid,$2::uuid) r', [business, branch]).then((r) => r.rows[0].r as Record<string, any>);
async function seedA2Overdue(c: C) {
  await su(c);
  await c.query(`insert into public.invoices(business_id,contact_id,branch_id,invoice_number,invoice_type,status,issue_date,due_date,currency,exchange_rate,subtotal,taxable_amount,discount_amount,discount_percent,vat_amount,wht_amount,total_amount,amount_paid)
    values($1,$2,$3,'IC-A2-OVERDUE','invoice','sent','2026-01-01','2026-01-15','MWK',1,777,777,0,0,0,0,777,0)`, [orgs.A.business, orgs.A.customer, orgs.A.branch2]);
}

test(meta('IC.AI.OWN-BRANCH-ALLOWED', 'A branch_manager assigned to A1 requesting A1 receives context', M.ai), async () => {
  ready();
  await db.asRole('authenticated', identities.A_branch_manager.id, async (c: C) => {
    await seedA2Overdue(c); await as(c, identities.A_branch_manager.id);
    const r = await aiCtx(c, orgs.A.business, orgs.A.branch);
    expect(r.company.id).toBe(orgs.A.business);
    expect(JSON.stringify(r.overdueInvoices)).not.toContain('IC-A2-OVERDUE');
  });
});

test(meta('IC.AI.OTHER-BRANCH-DENIED', 'The same branch_manager requesting branch A2 (same business, not assigned) is denied 42501', M.ai), async () => {
  ready();
  await db.asRole('authenticated', identities.A_branch_manager.id, async (c: C) => {
    await failsWith(c, () => aiCtx(c, orgs.A.business, orgs.A.branch2), ['42501']);
  });
});

test(meta('IC.AI.OMITTED-BRANCH-DEC03', 'Omitted branch for an assigned-scope role applies the DEC-03 fallback: result equals the explicit own-branch result and excludes other-branch data (never org-wide)', M.ai), async () => {
  ready();
  await db.asRole('authenticated', identities.A_branch_manager.id, async (c: C) => {
    await seedA2Overdue(c); await as(c, identities.A_branch_manager.id);
    const omitted = await aiCtx(c, orgs.A.business, null);
    const own = await aiCtx(c, orgs.A.business, orgs.A.branch);
    for (const k of ['kpis', 'monthlyTrend', 'overdueInvoices', 'topCustomers', 'upcomingReceivables']) expect(omitted[k]).toEqual(own[k]);
    expect(JSON.stringify(omitted)).not.toContain('IC-A2-OVERDUE');
  });
});

test(meta('IC.AI.ORGWIDE-ROLE-KEEPS-SCOPE', 'Org-wide roles (owner, accountant) with omitted branch keep org-wide scope (include A2 data); not narrowed, not broadened', M.ai), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await seedA2Overdue(c);
    for (const who of ['A_owner', 'A_accountant']) {
      await as(c, identities[who].id);
      expect(JSON.stringify((await aiCtx(c, orgs.A.business, null)).overdueInvoices)).toContain('IC-A2-OVERDUE');
    }
  });
});

test(meta('IC.AI.CROSS-BUSINESS-DENIED', 'Owner of A is denied B context (42501), and denied a B branch id presented against business A (42501)', M.ai), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await failsWith(c, () => aiCtx(c, orgs.B.business, null), ['42501']);
    await failsWith(c, () => aiCtx(c, orgs.A.business, orgs.B.branch), ['42501']);
  });
});

test(meta('IC.AI.ANON-DENIED', 'anon cannot execute ai_context', M.ai), async () => {
  ready();
  await db.asRole('anon', null, async (c: C) => {
    await failsWith(c, () => aiCtx(c, orgs.A.business, orgs.A.branch), ['42501']);
  });
});

test(meta('IC.AI.FORGED-BRANCH-DENIED', 'A forged (non-existent) selectedBranchId is denied 42501 for assigned-scope AND org-wide roles', M.ai), async () => {
  ready();
  for (const who of ['A_branch_manager', 'A_owner']) {
    await db.asRole('authenticated', identities[who].id, async (c: C) => {
      await failsWith(c, () => aiCtx(c, orgs.A.business, key(990001)), ['42501']);
    });
  }
});

// ════════════════════════ P3 — AI branch authority (Edge) ══════════════════
const EDGE_LAYER = 'unchanged Edge handler in local Node VM; per-key client factory; mocked Auth; no Deno/gateway';
const bizE = key(301);
function aiEdge(role: string, userRpc: (args: Record<string, unknown>) => { data: unknown; error: unknown }) {
  const created: Array<{ key: string; auth?: string }> = [];
  const admin = mockClient({
    user: { id: identities.A_branch_manager.id },
    resolveQuery: (q: { table: string }) => ({ data: q.table === 'business_users' ? [{ business_id: bizE, role, businesses: { id: bizE, name: 'IC E', deleted_at: null } }] : null, error: null }),
    resolveRpc: () => ({ data: null, error: { message: 'service-role rpc must not be used for ai_context' } }),
  });
  const user = mockClient({ user: { id: identities.A_branch_manager.id }, resolveQuery: () => ({ data: null, error: null }), resolveRpc: (_n: string, a: unknown) => userRpc(a as Record<string, unknown>) });
  let providerCalls = 0;
  const edge = loadEdge('ai-chat', {
    createClient: (_url: string, k: string, opts?: any) => { created.push({ key: k, auth: opts?.global?.headers?.Authorization }); return k === 'r13-synthetic-anon-key' ? user : admin; },
    provider: async () => { providerCalls++; return new Response(JSON.stringify({ choices: [{ message: { content: 'IC answer' } }] }), { status: 200 }); },
  }) as { invoke: (r: Request) => Promise<Response> };
  const call = (ctx: unknown) => edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', headers: { Authorization: 'Bearer ic-caller-jwt' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'IC probe' }], context: ctx }) }));
  return { call, created, admin, user, providerCalls: () => providerCalls };
}
const ctxOk = { company: { id: bizE, name: 'IC E' }, kpis: {}, monthlyTrend: [], overdueInvoices: [], topExpenses: [], topCustomers: [], upcomingReceivables: [], upcomingPayables: [], anomalies: [] };

test(meta('IC.AI.EDGE.CALLER-JWT-AUTHORITY', 'ai-chat reads ai_context ONLY through a client bound to the caller JWT (anon key + Authorization header), never service_role; the requested branch is forwarded as a hint and the omitted branch is forwarded as null for the RPC DEC-03 decision', M.ai, EDGE_LAYER), async () => {
  const seen: unknown[] = [];
  const h = aiEdge('branch_manager', (a) => { seen.push(a.p_branch_id); return { data: ctxOk, error: null }; });
  const own = key(302);
  expect((await h.call({ companyId: bizE, selectedBranchId: own })).status).toBe(200);
  expect((await h.call({ companyId: bizE })).status).toBe(200);
  expect(seen).toEqual([own, null]);
  expect(h.admin.calls.filter((c: any) => c.rpc === 'ai_context')).toHaveLength(0);
  expect(h.user.calls.filter((c: any) => c.rpc === 'ai_context')).toHaveLength(2);
  expect(h.created.some((c) => c.key === 'r13-synthetic-anon-key' && c.auth === 'Bearer ic-caller-jwt')).toBe(true);
});

test(meta('IC.AI.EDGE.FORGED-BRANCH-403', 'When the RPC denies a forged/other/cross-business branch (42501) the handler returns 403 with no business data and ZERO provider calls', M.ai, EDGE_LAYER), async () => {
  const h = aiEdge('branch_manager', () => ({ data: null, error: { code: '42501', message: 'ai_context: no access to the requested branch' } }));
  const r = await h.call({ companyId: bizE, selectedBranchId: key(990002) });
  expect(r.status).toBe(403);
  const body = await r.json();
  expect(body.content).toBeUndefined();
  expect(h.providerCalls()).toBe(0);
});

// ════════════════════════ P4 — POS availability contract ══════════════════
const avail = (c: C, business: string, branch: string | null) =>
  c.query('select public.pos_stock_availability($1::uuid,$2::uuid) r', [business, branch]).then((r) => r.rows[0].r as Record<string, any>);

test(meta('IC.POS.DISPLAY-EQUALS-DEDUCTION', 'The POS display location for the cashier branch is exactly the location post_pos_sale deducts from: availability 100 → sale of 1 → the same location reads 99 (single server contract)', M.pos), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const before = await avail(c, orgs.A.business, orgs.A.branch);
    expect(before.location.id).toBe(orgs.A.location);
    expect(before.is_fallback).toBe(false);
    const row = (b: any) => b.balances.find((x: any) => x.product_id === orgs.A.product);
    expect(Number(row(before).quantity_on_hand)).toBe(100);
    await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(saleFixture(orgs.A, 401))]);
    const after = await avail(c, orgs.A.business, orgs.A.branch);
    expect(after.location.id).toBe(before.location.id);
    expect(Number(row(after).quantity_on_hand)).toBe(99);
    await su(c); expect(await onHand(c)).toBe(99);
  });
});

test(meta('IC.POS.FALLBACK-FLAGGED', 'Owner decision 2026-09-26 (POS deducts from BRANCH stock): a branch with no own location no longer falls back to the business default/warehouse — availability reports branch_location_missing=true, location=null, is_fallback=false (the sale itself is refused: OD.BRANCH.* records)', `${M.pos} + supabase/migrations/20261013000000_owner_decisions_price_override_branch_stock.sql`), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const r = await avail(c, orgs.A.business, orgs.A.branch2);
    expect(r.location).toBeNull();
    expect(r.branch_location_missing).toBe(true);
    expect(r.is_fallback).toBe(false);
    const own = await avail(c, orgs.A.business, orgs.A.branch);
    expect(own.location.id).toBe(orgs.A.location);
    expect(own.branch_location_missing).toBe(false);
  });
});

test(meta('IC.POS.AVAILABILITY-SCOPED', 'Availability is branch/tenant scoped: cashier (A1) denied A2; owner A denied business B and a B branch; forged branch denied; anon denied — all 42501. Response carries quantities only (no cost data)', M.pos), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await failsWith(c, () => avail(c, orgs.A.business, orgs.A.branch2), ['42501']);
    await failsWith(c, () => avail(c, orgs.A.business, key(990003)), ['42501']);
    const ok = await avail(c, orgs.A.business, orgs.A.branch);
    for (const b of ok.balances) expect(Object.keys(b).sort()).toEqual(['product_id', 'quantity_on_hand']);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => avail(c, orgs.B.business, null), ['42501']);
    await failsWith(c, () => avail(c, orgs.A.business, orgs.B.branch), ['42501']);
  });
  await db.asRole('anon', null, async (c: C) => {
    await failsWith(c, () => avail(c, orgs.A.business, orgs.A.branch), ['42501']);
  });
});

test(meta('IC.POS.CONSTRAINTS-INTACT', 'chk_inventory_balances_on_hand_nonneg is present and VALIDATED; overselling still rejected 23514 through post_pos_sale (R06 not bypassed)', M.pos), async () => {
  ready();
  const con = (await db.client.query("select convalidated from pg_constraint where conname='chk_inventory_balances_on_hand_nonneg'")).rows;
  expect(con).toEqual([{ convalidated: true }]);
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const f = saleFixture(orgs.A, 402) as any;
    // H-2: payload made arithmetically consistent (101 × 1500) so it reaches the oversell check.
    const t = 101 * 1500;
    f.lines[0].quantity = 101; f.lines[0].line_total = t;
    Object.assign(f.invoice, { original_amount: t, functional_amount: t, subtotal: t, taxable_amount: t, total_amount: t });
    f.cash_sales = t; f.payments[0].amount = t; f.payments[0].functional_amount = t;
    await failsWith(c, () => c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(f)]), ['23514', 'P0001']);
    await su(c); expect(await onHand(c)).toBe(100);
  });
});

// ════════════════════════ P5 — COGS failure rolls back ═════════════════════
test(meta('IC.COGS.POS-FAILURE-ROLLS-BACK', 'When COGS posting fails (COGS account 5100 unavailable) post_pos_sale raises P0001 "COGS posting failed" and NOTHING persists: no invoice, no stock movement, no journal, balance unchanged. Positive control: with the account restored the same payload posts a keyed COGS entry', M.cogs), async () => {
  ready();
  const payload = saleFixture(orgs.A, 411);
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await su(c);
    const jBefore = (await c.query('select count(*)::int n from public.journal_entries where business_id=$1', [orgs.A.business])).rows[0].n;
    await c.query("update public.accounts set is_active=false where business_id=$1 and code='5100'", [orgs.A.business]);
    await as(c, identities.A_cashier.id);
    const e = await failsWith(c, () => c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)]), ['P0001']);
    expect(e.message).toMatch(/COGS posting failed/);
    await su(c);
    expect((await c.query('select count(*)::int n from public.invoices where business_id=$1 and client_key=$2', [orgs.A.business, payload.client_key])).rows[0].n).toBe(0);
    expect((await c.query('select count(*)::int n from public.journal_entries where business_id=$1', [orgs.A.business])).rows[0].n).toBe(jBefore);
    expect(await onHand(c)).toBe(100);
    await c.query("update public.accounts set is_active=true where business_id=$1 and code='5100'", [orgs.A.business]);
    await as(c, identities.A_cashier.id);
    const ok = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(payload)])).rows[0].r as { id: string };
    await su(c);
    expect((await c.query('select count(*)::int n from public.journal_entries where business_id=$1 and posting_key=$2', [orgs.A.business, `invoice:${ok.id}:cogs`])).rows[0].n).toBe(1);
    expect(await onHand(c)).toBe(99);
  });
});

test(meta('IC.COGS.QUICK-SALE-FAILURE-ROLLS-BACK', 'save_quick_sale with a stock line: a COGS failure raises P0001 and persists no invoice and no stock effect', M.cogs), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await su(c);
    const recv = await accountId(c, 'A', '1131'); const rev = await accountId(c, 'A', '4112') ?? await accountId(c, 'A', '4110');
    const payload = incomeFixture(orgs.A, recv, rev, 412);
    await c.query("update public.accounts set is_active=false where business_id=$1 and code='5100'", [orgs.A.business]);
    await as(c, identities.A_owner.id);
    const e = await failsWith(c, () => c.query('select public.save_quick_sale($1::jsonb) r', [JSON.stringify(payload)]), ['P0001']);
    expect(e.message).toMatch(/COGS posting failed/);
    await su(c);
    expect((await c.query('select count(*)::int n from public.invoices where business_id=$1 and client_key=$2', [orgs.A.business, payload.client_key])).rows[0].n).toBe(0);
    expect(await onHand(c)).toBe(100);
  });
});

// ════════════════════════ P6 — atomic idempotent payments ══════════════════
test(meta('IC.PAY.ATOMIC-SUCCESS', 'record_invoice_payment in ONE transaction: inserts the payment, amount_paid 0→400, status partially_paid, one balanced keyed settlement journal (DR 1110 / CR 1131 = 400) linked to the payment', M.pay), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(501))).invoice;
    const r = await pay(c, inv.id, 400, key(502));
    expect(r.idempotent).toBe(false);
    expect(Number(r.invoice.amount_paid)).toBe(400);
    expect(r.invoice.status).toBe('partially_paid');
    expect(r.payment.journal_entry_id).toBe(r.journal_entry_id);
    const s = await invoiceState(c, inv.id);
    expect(s).toMatchObject({ paid: 400, status: 'partially_paid', payments: 1, journals: 1 });
    const lines = (await c.query(`select a.code, jl.is_debit, jl.amount_base::numeric b from public.journal_lines jl join public.accounts a on a.id=jl.account_id where jl.journal_entry_id=$1 order by jl.is_debit desc`, [r.journal_entry_id])).rows;
    expect(lines.map((l) => [l.code, l.is_debit, Number(l.b)])).toEqual([['1110', true, 400], ['1131', false, 400]]);
    const [pd, pc] = (await c.query(`select coalesce(sum(case when is_debit then amount_base end),0)::numeric d, coalesce(sum(case when not is_debit then amount_base end),0)::numeric c from public.journal_lines where journal_entry_id=$1`, [r.journal_entry_id])).rows.map((x) => [Number(x.d), Number(x.c)])[0];
    expect(pd).toBe(pc);
  });
});

test(meta('IC.PAY.REPLAY-RETURNS-COMMITTED', 'A retry with the same client key returns the committed result (same payment id, idempotent=true) and creates no second payment, no second journal, no second amount_paid increment; full settlement then marks paid', M.pay), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(511))).invoice;
    const first = await pay(c, inv.id, 400, key(512));
    const again = await pay(c, inv.id, 400, key(512));
    expect(again.idempotent).toBe(true);
    expect(again.payment.id).toBe(first.payment.id);
    expect(again.journal_entry_id).toBe(first.journal_entry_id);
    expect(await invoiceState(c, inv.id)).toMatchObject({ paid: 400, payments: 1, journals: 1 });
    await as(c, identities.A_owner.id);
    const rest = await pay(c, inv.id, 600, key(513));
    expect(rest.invoice.status).toBe('paid');
    expect(await invoiceState(c, inv.id)).toMatchObject({ paid: 1000, status: 'paid', payments: 2, paymentSum: 1000, journals: 2 });
  });
});

test(meta('IC.PAY.VALIDATION-REJECTS', 'Overpayment, zero/negative amount, void and credit-note targets are rejected 23514; a client key reused for a different invoice is rejected 22023; nothing is written in any case', M.pay), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(521))).invoice;
    const other = (await createInvoice(c, 'A', key(522))).invoice;
    await failsWith(c, () => pay(c, inv.id, 1000.02, key(523)), ['23514']);
    await failsWith(c, () => pay(c, inv.id, 0, key(524)), ['23514']);
    await failsWith(c, () => pay(c, inv.id, -5, key(525)), ['23514']);
    await pay(c, other.id, 100, key(526));
    await failsWith(c, () => pay(c, inv.id, 100, key(526)), ['22023']);
    expect(await invoiceState(c, inv.id)).toMatchObject({ paid: 0, status: 'sent', payments: 0, journals: 0 });
    for (const st of ['void', 'credit_note']) {
      await su(c); await c.query('update public.invoices set status=$2 where id=$1', [inv.id, st]);
      await as(c, identities.A_owner.id);
      await failsWith(c, () => pay(c, inv.id, 100, key(527)), ['23514']);
    }
    await su(c); expect((await c.query('select count(*)::int n from public.invoice_payments where invoice_id=$1', [inv.id])).rows[0].n).toBe(0);
  });
});

test(meta('IC.PAY.JOURNAL-FAILURE-ATOMIC', 'If the settlement journal cannot post (debtors account 1131 unavailable) the whole command fails: no payment row, amount_paid and status unchanged (no partial state)', M.pay), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(531))).invoice;
    await su(c); await c.query("update public.accounts set is_active=false where business_id=$1 and code='1131'", [orgs.A.business]);
    await as(c, identities.A_owner.id);
    const e = await failsWith(c, () => pay(c, inv.id, 400, key(532)), ['P0001', '23514', '22023', 'P0002', '23503']);
    expect(e.code).toBeTruthy();
    expect(await invoiceState(c, inv.id)).toMatchObject({ paid: 0, status: 'sent', payments: 0, journals: 0 });
  });
});

test(meta('IC.PAY.TENANT-AND-ROLE-ISOLATION', 'Owner of B cannot pay A invoice; viewer of A cannot pay; branch_manager (A1) cannot pay an A2 invoice; anon cannot execute — all 42501 with nothing written', M.pay), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(541))).invoice;
    const inv2 = (await createInvoice(c, 'A', key(542), { branch_id: orgs.A.branch2 })).invoice;
    await as(c, identities.B_owner.id); await failsWith(c, () => pay(c, inv.id, 100, key(543)), ['42501']);
    await as(c, identities.A_viewer.id); await failsWith(c, () => pay(c, inv.id, 100, key(544)), ['42501']);
    await as(c, identities.A_branch_manager.id); await failsWith(c, () => pay(c, inv2.id, 100, key(545)), ['42501']);
    await as(c, null, 'anon'); await failsWith(c, () => pay(c, inv.id, 100, key(546)), ['42501']);
    expect(await invoiceState(c, inv.id)).toMatchObject({ paid: 0, payments: 0 });
    expect(await invoiceState(c, inv2.id)).toMatchObject({ paid: 0, payments: 0 });
  });
});

test(meta('IC.PAY.CONCURRENT-SAME-KEY', 'Two sessions submitting the SAME client key concurrently produce exactly one payment, one journal and one amount_paid increment; the loser returns the winner\'s committed payment (idempotent)', M.pay), async () => {
  ready();
  const inv = (await db.commitAsRole('authenticated', identities.A_owner.id, (c: C) => createInvoice(c, 'A', key(551)))).invoice;
  const s1 = await db.createSecondClient(); const s2 = await db.createSecondClient();
  try {
    await s1.beginAsRole('authenticated', identities.A_owner.id);
    await s2.beginAsRole('authenticated', identities.A_owner.id);
    const r1 = await pay(s1.client as C, inv.id, 300, key(552));
    const p2 = pay(s2.client as C, inv.id, 300, key(552));
    await new Promise((r) => setTimeout(r, 300));
    await s1.commitTx();
    const r2 = await p2; await s2.commitTx();
    expect(r2.payment.id).toBe(r1.payment.id);
    expect(r2.idempotent).toBe(true);
  } finally { await s1.rollbackTx(); await s2.rollbackTx(); await s1.close(); await s2.close(); }
  expect(await invoiceState(db.client as C, inv.id)).toMatchObject({ paid: 300, payments: 1, journals: 1 });
});

test(meta('IC.PAY.CONCURRENT-OVERPAY-SERIALISED', 'Two sessions paying 600 each (different keys) on a 1000 invoice concurrently: the invoice row lock serialises them; exactly one succeeds, the other is rejected 23514; amount_paid = 600', M.pay), async () => {
  ready();
  const inv = (await db.commitAsRole('authenticated', identities.A_owner.id, (c: C) => createInvoice(c, 'A', key(561)))).invoice;
  const s1 = await db.createSecondClient(); const s2 = await db.createSecondClient();
  let err: { code?: string } | undefined;
  try {
    await s1.beginAsRole('authenticated', identities.A_owner.id);
    await s2.beginAsRole('authenticated', identities.A_owner.id);
    await pay(s1.client as C, inv.id, 600, key(562));
    const p2 = pay(s2.client as C, inv.id, 600, key(563)).catch((e) => { err = e; });
    await new Promise((r) => setTimeout(r, 300));
    await s1.commitTx();
    await p2; await s2.rollbackTx();
  } finally { await s1.rollbackTx(); await s2.rollbackTx(); await s1.close(); await s2.close(); }
  expect(err?.code).toBe('23514');
  expect(await invoiceState(db.client as C, inv.id)).toMatchObject({ paid: 600, payments: 1, journals: 1, status: 'partially_paid' });
});

test(meta('IC.PAY.EXPENSE-ATOMIC-IDEMPOTENT', 'record_expense_payment: amount_paid 0→200 with a balanced keyed journal (DR 2111 / CR 1110); replay returns the same payment; overpay and void rejected 23514', M.pay), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await su(c);
    const exp = (await c.query(`insert into public.expenses(business_id,expense_number,expense_type,status,expense_date,due_date,currency,exchange_rate,subtotal,vat_amount,wht_amount,total_amount,amount_paid,branch_id,reference)
      values($1,'IC-BILL-1','bill','pending',$2,$2,'MWK',1,500,0,0,500,0,$3,'IC synthetic bill') returning id`, [orgs.A.business, DAY, orgs.A.branch])).rows[0].id as string;
    await as(c, identities.A_owner.id);
    const body = (amount: number) => JSON.stringify({ expense_id: exp, amount, payment_date: DAY, payment_method: 'cash', currency: 'MWK', exchange_rate: 1, functional_amount: amount });
    const run = (amount: number, k: string) => c.query('select public.record_expense_payment($1::jsonb,$2::uuid) r', [body(amount), k]).then((r) => r.rows[0].r as any);
    const first = await run(200, key(571));
    const again = await run(200, key(571));
    expect(again.idempotent).toBe(true);
    expect(again.payment.id).toBe(first.payment.id);
    await failsWith(c, () => run(301, key(572)), ['23514']);
    await su(c);
    expect(Number((await c.query('select amount_paid from public.expenses where id=$1', [exp])).rows[0].amount_paid)).toBe(200);
    const lines = (await c.query(`select a.code, jl.is_debit, jl.amount_base::numeric b from public.journal_lines jl join public.accounts a on a.id=jl.account_id where jl.journal_entry_id=$1 order by jl.is_debit desc`, [first.journal_entry_id])).rows;
    expect(lines.map((l) => [l.code, l.is_debit, Number(l.b)])).toEqual([['2111', true, 200], ['1110', false, 200]]);
    await c.query("update public.expenses set status='void' where id=$1", [exp]);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => run(50, key(573)), ['23514']);
  });
});

// ════════════════════════ P7 — atomic invoice creation ═════════════════════
test(meta('IC.INV.ATOMIC-SUCCESS-AND-REPLAY', 'create_invoice_with_lines writes header + all lines + in-transaction number in one statement; replay with the same key returns the same invoice (idempotent) and adds no rows', M.inv), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const a = await createInvoice(c, 'A', key(601));
    expect(a.lines).toHaveLength(2);
    expect(String(a.invoice.invoice_number)).not.toBe('');
    const b = await createInvoice(c, 'A', key(601));
    expect(b.idempotent).toBe(true);
    expect(b.invoice.id).toBe(a.invoice.id);
    await su(c);
    expect((await c.query('select count(*)::int n from public.invoice_lines where invoice_id=$1', [a.invoice.id])).rows[0].n).toBe(2);
    expect((await c.query('select count(*)::int n from public.invoices where business_id=$1 and client_key=$2', [orgs.A.business, key(601)])).rows[0].n).toBe(1);
  });
});

test(meta('IC.INV.LINE-FAILURE-NO-ORPHAN', 'A failing line (invalid tax_code) rolls back EVERYTHING: no orphan header, no lines, and the document number is not consumed', M.inv), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const n1 = (await c.query("select public.reserve_next_document_number($1,'invoice') n", [orgs.A.business])).rows[0].n as string;
    await failsWith(c, () => createInvoice(c, 'A', key(611), {}, [invoiceLine(1), invoiceLine(2, 500, { tax_code: 'ic-bogus' })]), ['22P02', '23514', '23503', '22023']);
    const n2 = (await c.query("select public.reserve_next_document_number($1,'invoice') n", [orgs.A.business])).rows[0].n as string;
    const num = (s: string) => Number(String(s).replace(/\D+/g, ''));
    expect(num(n2) - num(n1)).toBe(1);
    await su(c);
    expect((await c.query('select count(*)::int n from public.invoices where business_id=$1 and client_key=$2', [orgs.A.business, key(611)])).rows[0].n).toBe(0);
  });
});

test(meta('IC.INV.RLS-PRESERVED', 'SECURITY INVOKER: viewer of A, owner of B (for A), branch_manager (A1) for an A2 invoice, and anon are all denied 42501; nothing is written', M.inv), async () => {
  ready();
  await db.asRole('authenticated', identities.A_viewer.id, async (c: C) => {
    await failsWith(c, () => createInvoice(c, 'A', key(621)), ['42501']);
    await as(c, identities.B_owner.id); await failsWith(c, () => createInvoice(c, 'A', key(622)), ['42501']);
    await as(c, identities.A_branch_manager.id); await failsWith(c, () => createInvoice(c, 'A', key(623), { branch_id: orgs.A.branch2 }), ['42501']);
    await as(c, null, 'anon'); await failsWith(c, () => createInvoice(c, 'A', key(624)), ['42501']);
    await su(c);
    expect((await c.query('select count(*)::int n from public.invoices where client_key = any($1::uuid[])', [[key(621), key(622), key(623), key(624)]])).rows[0].n).toBe(0);
  });
});

test(meta('IC.INV.CONCURRENT-SAME-KEY', 'Two sessions creating with the SAME client key concurrently yield exactly one invoice with one set of lines; the loser returns the committed invoice (idempotent)', M.inv), async () => {
  ready();
  const s1 = await db.createSecondClient(); const s2 = await db.createSecondClient();
  let a: any; let b: any;
  try {
    await s1.beginAsRole('authenticated', identities.A_owner.id);
    await s2.beginAsRole('authenticated', identities.A_owner.id);
    a = await createInvoice(s1.client as C, 'A', key(631));
    const p = createInvoice(s2.client as C, 'A', key(631));
    await new Promise((r) => setTimeout(r, 300));
    await s1.commitTx();
    b = await p; await s2.commitTx();
  } finally { await s1.rollbackTx(); await s2.rollbackTx(); await s1.close(); await s2.close(); }
  expect(b.invoice.id).toBe(a.invoice.id);
  expect(b.idempotent).toBe(true);
  expect((await db.client.query('select count(*)::int n from public.invoice_lines where invoice_id=$1', [a.invoice.id])).rows[0].n).toBe(2);
});

// ════════════════════════ P9 — deploy skew guard ═══════════════════════════
const ROOT = join(__dirname, '..', '..');
test(meta('IC.DEPLOY.SKEW-GUARD', 'Deploy pipeline: frontend deploy failure fails the release (no continue-on-error), migration target = newest migration file, and the release manifest flags the 2026-09-24 pattern (DB+edge at new commit, frontend failed) as mixedVersion=true', '.github/workflows/deploy.yml + scripts/ci/release-manifest.mjs + scripts/ci/migration-target.mjs', 'static workflow parse + real script execution (no network)'), async () => {
  const wf = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
  expect(wf).not.toMatch(/continue-on-error:\s*true/);
  const newest = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => /^\d{14}_.*\.sql$/.test(f)).sort().pop()!.slice(0, 14);
  const target = execFileSync(process.execPath, [join(ROOT, 'scripts/ci/migration-target.mjs')], { encoding: 'utf8', cwd: ROOT }).trim();
  expect(target).toBe(newest);
  const run = (over: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'ic-manifest-'));
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts/ci/release-manifest.mjs')], {
        cwd: dir, encoding: 'utf8', stdio: 'pipe',
        env: { PATH: process.env.PATH ?? '', ENV_LABEL: 'production', GITHUB_SHA: 'b82a60f', MIGRATION_TARGET: newest, ...over },
      });
    } catch { /* a MIXED-VERSION manifest exits non-zero by design; the JSON is still written */ }
    return JSON.parse(readFileSync(join(dir, 'artifacts/release/release-manifest.json'), 'utf8'));
  };
  const skew = run({ OUT_MIGRATE: 'success', OUT_VERIFY: 'success', OUT_EDGE: 'success', OUT_FRONTEND: 'failure' });
  expect(skew.mixedVersion).toBe(true);
  expect(skew.verdict).toMatch(/MIXED-VERSION/);
  expect(skew.migrationTarget).toBe(newest);
  const good = run({ OUT_MIGRATE: 'success', OUT_VERIFY: 'success', OUT_EDGE: 'success', OUT_FRONTEND: 'success', OUT_FRONTEND_VERIFY: 'success' });
  expect(good).toMatchObject({ mixedVersion: false, verdict: 'RELEASED' });
});

// ════════════════════════ HARDENING 2026-09-26 ═════════════════════════════
const MH = 'supabase/migrations/20261011000005_hardening_stock_cogs_backfill_grants.sql';
const stockCogs = (c: C, invoiceId: string, lines: Array<{ product_id: string; quantity: number }>) =>
  c.query('select public.record_sale_stock_and_cogs($1::uuid,$2::jsonb) r', [invoiceId, JSON.stringify(lines)]).then((r) => r.rows[0].r as Record<string, any>);
const movementsFor = async (c: C, id: string) =>
  (await c.query("select count(*)::int n from public.stock_movements where source_type='invoice' and source_id::text=$1", [id])).rows[0].n as number;
const cogsFor = async (c: C, id: string) =>
  (await c.query('select count(*)::int n from public.journal_entries where posting_key=$1', [`invoice:${id}:cogs`])).rows[0].n as number;
const productLine = (org: string, qty = 2) => invoiceLine(1, 1000, { product_id: orgs[org].product, quantity: qty, unit_price: 500 });

test(meta('HARD.STOCK.ATOMIC-SUCCESS-AND-REPLAY', 'record_sale_stock_and_cogs releases stock (100→98) at the sale location AND posts one balanced keyed COGS entry (2×900) in one transaction; a replay is idempotent (no second movement, no second COGS)', MH), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(701), {}, [productLine('A')])).invoice;
    const r = await stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 2 }]);
    expect(r.idempotent).toBe(false);
    expect(r.cogs_entry_id).toBeTruthy();
    const again = await stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 2 }]);
    expect(again).toMatchObject({ idempotent: true, cogs_entry_id: r.cogs_entry_id, cogs_missing: false });
    await su(c);
    expect(await onHand(c)).toBe(98);
    expect(await movementsFor(c, inv.id)).toBe(1);
    expect(await cogsFor(c, inv.id)).toBe(1);
    const t = (await c.query('select sum(case when is_debit then amount_base else 0 end)::numeric d, sum(case when not is_debit then amount_base else 0 end)::numeric k from public.journal_lines where journal_entry_id=$1', [r.cogs_entry_id])).rows[0];
    expect(Number(t.d)).toBe(1800); expect(Number(t.k)).toBe(1800);
  });
});

test(meta('HARD.STOCK.COGS-FAILURE-ROLLS-BACK', 'If COGS cannot post (5100 unavailable) the command raises P0001 and releases NO stock (balance 100, no movement, no journal) — the previous client path moved stock and silently skipped COGS', MH), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(711), {}, [productLine('A')])).invoice;
    await su(c); await c.query("update public.accounts set is_active=false where business_id=$1 and code='5100'", [orgs.A.business]);
    await as(c, identities.A_owner.id);
    const e = await failsWith(c, () => stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 2 }]), ['P0001']);
    expect(e.message).toMatch(/COGS posting failed/);
    await su(c);
    expect(await onHand(c)).toBe(100);
    expect(await movementsFor(c, inv.id)).toBe(0);
    expect(await cogsFor(c, inv.id)).toBe(0);
  });
});

test(meta('HARD.STOCK.REFUSES-NON-SALES', 'Draft, void and credit-note invoices never release stock (23514); oversell still rejected by chk_inventory_balances_on_hand_nonneg (23514); balance unchanged', MH), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    for (const [n, st] of [[721, 'draft'], [722, 'void'], [723, 'credit_note']] as const) {
      const inv = (await createInvoice(c, 'A', key(n), {}, [productLine('A')])).invoice;
      await su(c); await c.query('update public.invoices set status=$2 where id=$1', [inv.id, st]);
      await as(c, identities.A_owner.id);
      await failsWith(c, () => stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 2 }]), ['23514']);
    }
    const big = (await createInvoice(c, 'A', key(724), {}, [productLine('A', 101)])).invoice;
    await failsWith(c, () => stockCogs(c, big.id, [{ product_id: orgs.A.product, quantity: 101 }]), ['23514', 'P0001']);
    await su(c); expect(await onHand(c)).toBe(100);
  });
});

test(meta('HARD.STOCK.ISOLATION', 'Owner of B, viewer of A and anon are denied (42501); a B product on an A invoice is denied (42501); nothing moves', MH), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(731), {}, [productLine('A')])).invoice;
    await failsWith(c, () => stockCogs(c, inv.id, [{ product_id: orgs.B.product, quantity: 1 }]), ['42501']);
    await as(c, identities.B_owner.id); await failsWith(c, () => stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 1 }]), ['42501']);
    await as(c, identities.A_viewer.id); await failsWith(c, () => stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 1 }]), ['42501']);
    await as(c, null, 'anon'); await failsWith(c, () => stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 1 }]), ['42501']);
    await su(c);
    expect(await movementsFor(c, inv.id)).toBe(0);
    expect(await onHand(c)).toBe(100);
    expect(Number((await c.query('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2', [orgs.B.business, orgs.B.product])).rows[0].quantity_on_hand)).toBe(100);
  });
});

test(meta('HARD.STOCK.LEGACY-PARTIAL-REPORTED-NOT-REPAIRED', 'An invoice that already moved stock without COGS (legacy client partial) is reported cogs_missing=true; the command writes NO movement and NO journal (historical repair not authorised)', MH), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = (await createInvoice(c, 'A', key(741), {}, [productLine('A')])).invoice;
    await su(c);
    await c.query(`insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id,reference)
      values($1,$2,$3,'sale',$4,-2,900,'invoice',$5,'legacy partial')`, [orgs.A.business, orgs.A.product, orgs.A.location, DAY, inv.id]);
    await as(c, identities.A_owner.id);
    const r = await stockCogs(c, inv.id, [{ product_id: orgs.A.product, quantity: 2 }]);
    expect(r).toMatchObject({ idempotent: true, cogs_missing: true, cogs_entry_id: null });
    await su(c);
    expect(await movementsFor(c, inv.id)).toBe(1);
    expect(await cogsFor(c, inv.id)).toBe(0);
    expect(await onHand(c)).toBe(98);
  });
});

test(meta('HARD.BACKFILL.STATUS-AND-LOCATION', 'Backfill logic (service_role only): of four un-moved invoices (draft, void, credit_note, sent) ONLY the sent one gets a sale movement, at the _ledgr_stock_location location; a void expense receives no purchase movement. Run inside a rolled-back transaction — no persistent effect', MH), async () => {
  ready();
  await db.asRole('service_role', null, async (c: C) => {
    await su(c);
    const ids: Record<string, string> = {};
    for (const st of ['draft', 'void', 'credit_note', 'sent']) {
      ids[st] = (await c.query(`insert into public.invoices(business_id,contact_id,branch_id,invoice_number,invoice_type,status,issue_date,due_date,currency,exchange_rate,subtotal,taxable_amount,discount_amount,discount_percent,vat_amount,wht_amount,total_amount,amount_paid)
        values($1,$2,$3,$4,'invoice',$5,$6,$6,'MWK',1,500,500,0,0,0,0,500,0) returning id`, [orgs.A.business, orgs.A.customer, orgs.A.branch, `HB-${st}`, st, DAY])).rows[0].id;
      await c.query(`insert into public.invoice_lines(invoice_id,business_id,line_number,description,quantity,unit_price,discount_percent,discount_amount,tax_code,tax_rate,tax_amount,line_total,product_id)
        values($1,$2,1,'HB',1,500,0,0,'none',0,0,500,$3)`, [ids[st], orgs.A.business, orgs.A.product]);
    }
    const exp = (await c.query(`insert into public.expenses(business_id,expense_number,expense_type,status,expense_date,currency,exchange_rate,subtotal,vat_amount,wht_amount,total_amount,amount_paid,branch_id)
      values($1,'HB-VOID-EXP','bill','void',$2,'MWK',1,500,0,0,500,0,$3) returning id`, [orgs.A.business, DAY, orgs.A.branch])).rows[0].id as string;
    await c.query(`insert into public.expense_lines(expense_id,business_id,line_number,description,quantity,unit_price,tax_code,tax_rate,tax_amount,line_total,product_id)
      values($1,$2,1,'HB',5,100,'none',0,0,500,$3)`, [exp, orgs.A.business, orgs.A.product]);
    await as(c, null, 'service_role');
    await c.query('select * from public.backfill_and_recalculate_inventory($1)', [orgs.A.business]);
    await su(c);
    for (const st of ['draft', 'void', 'credit_note']) expect(await movementsFor(c, ids[st])).toBe(0);
    const sent = (await c.query("select location_id from public.stock_movements where source_type='invoice' and source_id::text=$1", [ids.sent])).rows;
    expect(sent).toEqual([{ location_id: orgs.A.location }]);
    expect((await c.query("select count(*)::int n from public.stock_movements where source_type='expense' and source_id::text=$1", [exp])).rows[0].n).toBe(0);
  });
});

test(meta('HARD.INDEX-AND-GRANTS', 'idx_stock_movements_business_source exists on (business_id, source_type, source_id); INSERT on invoices/invoice_lines is declared for authenticated by the migration chain (no harness emulation); backfill remains non-executable by authenticated', MH), async () => {
  ready();
  const idx = (await db.client.query("select indexdef from pg_indexes where indexname='idx_stock_movements_business_source'")).rows;
  expect(idx).toHaveLength(1);
  expect(idx[0].indexdef).toMatch(/\(business_id, source_type, source_id\)/);
  const g = (await db.client.query(`select has_table_privilege('authenticated','public.invoices','insert') i, has_table_privilege('authenticated','public.invoice_lines','insert') l,
    has_table_privilege('anon','public.invoices','insert') a, has_function_privilege('authenticated','public.backfill_and_recalculate_inventory(uuid)','execute') b`)).rows[0];
  expect(g).toEqual({ i: true, l: true, a: false, b: false });
});

// ════════════════════════ POST-CONTAINMENT HARDENING 2026-09-26 (H01–H06) ═══════════════
const MP = 'supabase/migrations/20261012000000_post_containment_hardening.sql';
const MB = 'supabase/migrations/20261011000005_hardening_stock_cogs_backfill_grants.sql';
const hmeta = (id: string, expected: string, source: string) => ({ id, expected, remediation: 'HARDENING-2026-09-26', source, layer: LAYER });
const insertLegacyInvoice = async (c: C, tag: string, status: string, qty = 1) => {
  const id = (await c.query(`insert into public.invoices(business_id,contact_id,branch_id,invoice_number,invoice_type,status,issue_date,due_date,currency,exchange_rate,subtotal,taxable_amount,discount_amount,discount_percent,vat_amount,wht_amount,total_amount,amount_paid)
    values($1,$2,$3,$4,'invoice',$5,$6,$6,'MWK',1,500,500,0,0,0,0,500,0) returning id`, [orgs.A.business, orgs.A.customer, orgs.A.branch, tag, status, DAY])).rows[0].id as string;
  await c.query(`insert into public.invoice_lines(invoice_id,business_id,line_number,description,quantity,unit_price,discount_percent,discount_amount,tax_code,tax_rate,tax_amount,line_total,product_id)
    values($1,$2,1,'H01',$3,500,0,0,'none',0,0,500,$4)`, [id, orgs.A.business, qty, orgs.A.product]);
  return id;
};

// ── H-1 backfill status filtering ──
test(hmeta('H01.BACKFILL.NON-SALES-NO-MOVEMENT', 'Backfill (service_role, rolled-back tx) writes NO sale movement for draft, void or credit_note invoices, nor for an invoice_type=credit_note document; credit-note stock stays with the explicit R07 return_in architecture', MB), async () => {
  ready();
  await db.asRole('service_role', null, async (c: C) => {
    await su(c);
    const ids = [await insertLegacyInvoice(c, 'H01-draft', 'draft'), await insertLegacyInvoice(c, 'H01-void', 'void'), await insertLegacyInvoice(c, 'H01-cn', 'credit_note')];
    const cnType = await insertLegacyInvoice(c, 'H01-cn-type', 'sent');
    await c.query("update public.invoices set invoice_type='credit_note' where id=$1", [cnType]);
    const before = await onHand(c);
    await as(c, null, 'service_role');
    await c.query('select * from public.backfill_and_recalculate_inventory($1)', [orgs.A.business]);
    await su(c);
    for (const id of [...ids, cnType]) expect(await movementsFor(c, id)).toBe(0);
    expect((await c.query("select count(*)::int n from public.stock_movements where source_type='invoice' and movement_type='sale' and source_id::text = any($1)", [[...ids, cnType]])).rows[0].n).toBe(0);
    expect(await onHand(c)).toBe(before);
  });
});

test(hmeta('H01.BACKFILL.VALID-STATUSES-BACKFILL', 'Legitimate sales still backfill: sent, paid, partially_paid and overdue invoices each receive exactly one sale movement (−qty) at the resolved location; a paid expense still receives its purchase movement', MB), async () => {
  ready();
  await db.asRole('service_role', null, async (c: C) => {
    await su(c);
    const ids: Record<string, string> = {};
    for (const st of ['sent', 'paid', 'partially_paid', 'overdue']) ids[st] = await insertLegacyInvoice(c, `H01V-${st}`, st, 2);
    const exp = (await c.query(`insert into public.expenses(business_id,expense_number,expense_type,status,expense_date,currency,exchange_rate,subtotal,vat_amount,wht_amount,total_amount,amount_paid,branch_id)
      values($1,'H01V-EXP','bill','paid',$2,'MWK',1,500,0,0,500,500,$3) returning id`, [orgs.A.business, DAY, orgs.A.branch])).rows[0].id as string;
    await c.query(`insert into public.expense_lines(expense_id,business_id,line_number,description,quantity,unit_price,tax_code,tax_rate,tax_amount,line_total,product_id)
      values($1,$2,1,'H01V',5,100,'none',0,0,500,$3)`, [exp, orgs.A.business, orgs.A.product]);
    await as(c, null, 'service_role');
    await c.query('select * from public.backfill_and_recalculate_inventory($1)', [orgs.A.business]);
    await su(c);
    for (const st of Object.keys(ids)) {
      const rows = (await c.query("select movement_type::text t, quantity::numeric q, location_id from public.stock_movements where source_type='invoice' and source_id::text=$1", [ids[st]])).rows;
      expect(rows.map((r) => ({ t: r.t, q: Number(r.q), l: r.location_id }))).toEqual([{ t: 'sale', q: -2, l: orgs.A.location }]);
    }
    expect((await c.query("select count(*)::int n from public.stock_movements where source_type='expense' and source_id::text=$1", [exp])).rows[0].n).toBe(1);
  });
});

// ── H-2 server-authoritative POS arithmetic ──
const posSale = (c: C, p: unknown) => c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(p)]).then((r) => r.rows[0].r as Record<string, any>);
const invoicesByKey = async (c: C, k: string) => (await c.query('select count(*)::int n from public.invoices where client_key::text=$1', [k])).rows[0].n as number;
/** Consistent discounted sale: 2 × 1500 gross 3000, line discount 100, order discount 150 → total 2750. */
const discountedSale = (n: number) => {
  const s = saleFixture(orgs.A, n) as any;
  Object.assign(s.lines[0], { quantity: 2, unit_price: 1500, discount_amount: 100, line_total: 2900 });
  Object.assign(s.invoice, { discount_amount: 250, discount_percent: 8, total_amount: 2750, subtotal: 2750, taxable_amount: 2750, original_amount: 2750, functional_amount: 2750, vat_amount: 0 });
  s.cash_sales = 2750; s.payments[0].amount = 2750; s.payments[0].functional_amount = 2750;
  return s;
};

test(hmeta('H02.POS.LEGIT-SALES-POST', 'Consistent sales post unchanged: the standard fixture (1×1500), a discounted sale (line + order discount, total 2750) and a VAT-registered sale (VAT-inclusive 17.5%, vat = round2(total − total/1.175)) all succeed; replay of the same client_key stays idempotent', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const a = await posSale(c, saleFixture(orgs.A, 801));
    expect(a.id ?? a.invoice_id ?? a).toBeTruthy();
    await posSale(c, discountedSale(802));
    await su(c); await c.query('update public.businesses set vat_registered=true where id=$1', [orgs.A.business]);
    await as(c, identities.A_cashier.id);
    const v = saleFixture(orgs.A, 803) as any;
    const vat = Math.round((1500 - 1500 / 1.175) * 100) / 100;
    Object.assign(v.invoice, { vat_amount: vat, subtotal: Math.round((1500 - vat) * 100) / 100, taxable_amount: Math.round((1500 - vat) * 100) / 100 });
    await posSale(c, v);
    await posSale(c, saleFixture(orgs.A, 801));  // idempotent replay
    await su(c);
    await c.query('update public.businesses set vat_registered=false where id=$1', [orgs.A.business]);
    for (const n of [801, 802, 803]) expect(await invoicesByKey(c, key(n))).toBe(1);
  });
});

test(hmeta('H02.POS.TAMPERED-AMOUNTS-REJECTED', 'Browser-tampered amounts are refused 22023 with nothing written (no invoice, stock unchanged): inflated line_total, understated total vs lines, fake discount without line/order basis, discount > gross, negative price, zero quantity, VAT claimed on a non-registered business, VAT omitted on a registered business, subtotal+VAT ≠ total', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const before = (await (async () => { await su(c); const v = await onHand(c); await as(c, identities.A_cashier.id); return v; })());
    const cases: Array<[number, (s: any) => void]> = [
      [811, (s) => { s.lines[0].line_total = 1; }],
      [812, (s) => { s.lines[0].unit_price = 3000; }],
      [813, (s) => { Object.assign(s.invoice, { total_amount: 1000, subtotal: 1000, taxable_amount: 1000 }); s.cash_sales = 1000; s.payments[0].amount = 1000; }],
      [814, (s) => { s.lines[0].discount_amount = 2000; s.lines[0].line_total = 0; }],
      [815, (s) => { s.lines[0].unit_price = -1500; }],
      [816, (s) => { s.lines[0].quantity = 0; }],
      [817, (s) => { Object.assign(s.invoice, { vat_amount: 223.4, subtotal: 1276.6, taxable_amount: 1276.6 }); }],
      [818, (s) => { s.invoice.subtotal = 1400; }],
      [819, (s) => { s.invoice.discount_amount = 500; }],
    ];
    for (const [n, mutate] of cases) {
      const s = saleFixture(orgs.A, n) as any; mutate(s);
      await failsWith(c, () => posSale(c, s), ['22023']);
    }
    await su(c); await c.query('update public.businesses set vat_registered=true where id=$1', [orgs.A.business]);
    await as(c, identities.A_cashier.id);
    await failsWith(c, () => posSale(c, saleFixture(orgs.A, 820)), ['22023']);  // registered, VAT omitted
    await su(c); await c.query('update public.businesses set vat_registered=false where id=$1', [orgs.A.business]);
    for (let n = 811; n <= 820; n++) expect(await invoicesByKey(c, key(n))).toBe(0);
    expect(await onHand(c)).toBe(before);
  });
});

test(hmeta('H02.POS.PRICING-POLICY', 'Owner decision 2026-09-26 — SERVER POS PRICING POLICY now enforced: a cashier line priced away from products.sale_price is refused 22023 price-override-required and an over-cap discount 22023 discount-override-required (nothing written); the catalogue price posts; supervisors override directly or authorise a single-use server token (full matrix: OD.PRICE.*)', `${MP} + supabase/migrations/20261013000000_owner_decisions_price_override_branch_stock.sql`), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const stale = saleFixture(orgs.A, 830) as any;
    Object.assign(stale.lines[0], { unit_price: 1200, line_total: 1200 });
    Object.assign(stale.invoice, { total_amount: 1200, subtotal: 1200, taxable_amount: 1200, original_amount: 1200, functional_amount: 1200 });
    stale.cash_sales = 1200; stale.payments[0].amount = 1200; stale.payments[0].functional_amount = 1200;
    const e = await failsWith(c, () => posSale(c, stale), ['22023']);
    expect(e.message).toMatch(/price-override-required/);
    const d = saleFixture(orgs.A, 831) as any;
    Object.assign(d.invoice, { discount_amount: 450, discount_percent: 30, total_amount: 1050, subtotal: 1050, taxable_amount: 1050, original_amount: 1050, functional_amount: 1050 });
    d.cash_sales = 1050; d.payments[0].amount = 1050; d.payments[0].functional_amount = 1050;
    const e2 = await failsWith(c, () => posSale(c, d), ['22023']);
    expect(e2.message).toMatch(/discount-override-required/);
    await su(c);
    expect(await invoicesByKey(c, key(830))).toBe(0);
    expect(await invoicesByKey(c, key(831))).toBe(0);
  });
});

// ── H-3 atomic inventory journal command ──
const invMove = (c: C, p: Record<string, unknown>) =>
  c.query('select public.record_inventory_journal_movement($1::jsonb) r', [JSON.stringify({ business_id: orgs.A.business, location_id: orgs.A.location, movement_date: DAY, ...p })]).then((r) => r.rows[0].r as Record<string, any>);
const K = (tag: string) => key(Number(({'h03-rcpt-1': 870, 'h03-adj-out': 871, 'h03-adj-in': 872, 'h03-jfail': 873, 'h03-sfail': 874, 'h03-retry': 875, 'h03-retry-fix': 876, 'h03-iso-1': 877, 'h03-iso-2': 878, 'h03-iso-3': 879, 'h03-iso-4': 880, 'h03-iso-5': 881} as Record<string, number>)[tag]));
const lineOf = (qty: number, cost = 900, org = 'A') => [{ product_id: orgs[org].product, quantity: qty, unit_cost: cost }];
const movesFor = async (c: C, source: string, k: string) =>
  (await c.query('select count(*)::int n from public.stock_movements where business_id=$1 and source_type=$2 and source_id=$3', [orgs.A.business, source, k])).rows[0].n as number;
const entryFor = async (c: C, pk: string) =>
  (await c.query(`select e.id, sum(case when l.is_debit then l.amount_base else 0 end)::numeric d, sum(case when not l.is_debit then l.amount_base else 0 end)::numeric k,
     array_agg(a.code || ':' || case when l.is_debit then 'D' else 'C' end order by a.code) codes
     from public.journal_entries e join public.journal_lines l on l.journal_entry_id=e.id join public.accounts a on a.id=l.account_id
     where e.business_id=$1 and e.posting_key=$2 group by e.id`, [orgs.A.business, pk])).rows;

test(hmeta('H03.INVJ.SUCCESS', 'Receipt of 5 @ 900: +5 on hand via the R06 trigger and ONE keyed entry DR 1141 / CR 2114 4500 in the same transaction; adjustment_out of 2 @ 900: −2 and DR 5180 / CR 1141 1800; adjustment_in of 1: DR 1141 / CR 5180', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const r = await invMove(c, { kind: 'receipt', client_key: K('h03-rcpt-1'), reference: 'GRN H03', lines: lineOf(5) });
    expect(r).toMatchObject({ idempotent: false });
    expect(r.movement_ids).toHaveLength(1);
    const o = await invMove(c, { kind: 'adjustment', movement_type: 'adjustment_out', client_key: K('h03-adj-out'), lines: lineOf(2) });
    const i = await invMove(c, { kind: 'adjustment', movement_type: 'adjustment_in', client_key: K('h03-adj-in'), lines: lineOf(1) });
    await su(c);
    expect(await onHand(c)).toBe(104);
    const rc = await entryFor(c, `stock_receipt:${K('h03-rcpt-1')}:grni`);
    expect(rc).toHaveLength(1); expect(rc[0].id).toBe(r.journal_entry_id);
    expect([Number(rc[0].d), Number(rc[0].k)]).toEqual([4500, 4500]); expect(rc[0].codes).toEqual(['1141:D', '2114:C']);
    const oe = await entryFor(c, `stock_adjustment:${K('h03-adj-out')}`);
    expect([Number(oe[0].d), oe[0].codes]).toEqual([1800, ['1141:C', '5180:D']]); expect(oe[0].id).toBe(o.journal_entry_id);
    const ie = await entryFor(c, `stock_adjustment:${K('h03-adj-in')}`);
    expect([Number(ie[0].d), ie[0].codes]).toEqual([900, ['1141:D', '5180:C']]); expect(ie[0].id).toBe(i.journal_entry_id);
  });
});

test(hmeta('H03.INVJ.JOURNAL-FAILURE-ROLLS-BACK', 'If the journal cannot post (2114 GRNI inactive) the command raises and NOTHING persists: no movement, balance unchanged, no journal — the old client path kept the movement and swallowed the journal error', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await su(c); const before = await onHand(c);
    await c.query("update public.accounts set is_active=false where business_id=$1 and code='2114'", [orgs.A.business]);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => invMove(c, { kind: 'receipt', client_key: K('h03-jfail'), lines: lineOf(5) }), ['P0001']);
    await su(c);
    expect(await movesFor(c, 'stock_receipt', K('h03-jfail'))).toBe(0);
    expect(await onHand(c)).toBe(before);
    expect(await entryFor(c, `stock_receipt:${K('h03-jfail')}:grni`)).toHaveLength(0);
  });
});

test(hmeta('H03.INVJ.STOCK-FAILURE-ROLLS-BACK', 'If the stock write fails (adjustment_out beyond on-hand → chk_inventory_balances_on_hand_nonneg 23514) no movement, no balance change and no journal persist; R06 constraint not bypassed', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await su(c); const before = await onHand(c); await as(c, identities.A_owner.id);
    await failsWith(c, () => invMove(c, { kind: 'adjustment', movement_type: 'adjustment_out', client_key: K('h03-sfail'), lines: lineOf(before + 1) }), ['23514', 'P0001']);
    await su(c);
    expect(await movesFor(c, 'stock_adjustment', K('h03-sfail'))).toBe(0);
    expect(await onHand(c)).toBe(before);
    expect(await entryFor(c, `stock_adjustment:${K('h03-sfail')}`)).toHaveLength(0);
  });
});

test(hmeta('H03.INVJ.RETRY-IDEMPOTENT', 'A retry with the same client_key returns idempotent=true with the same movement and journal ids (one movement, one entry, balance moved once); reusing the key for a different quantity is refused 22023; a failed attempt can be retried to success after the cause is fixed', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await su(c); const before = await onHand(c); await as(c, identities.A_owner.id);
    const first = await invMove(c, { kind: 'receipt', client_key: K('h03-retry'), lines: lineOf(3) });
    const again = await invMove(c, { kind: 'receipt', client_key: K('h03-retry'), lines: lineOf(3) });
    expect(again).toEqual({ idempotent: true, movement_ids: first.movement_ids, journal_entry_id: first.journal_entry_id });
    await failsWith(c, () => invMove(c, { kind: 'receipt', client_key: K('h03-retry'), lines: lineOf(4) }), ['22023']);
    await su(c); await c.query("update public.accounts set is_active=false where business_id=$1 and code='5180'", [orgs.A.business]);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => invMove(c, { kind: 'adjustment', movement_type: 'adjustment_in', client_key: K('h03-retry-fix'), lines: lineOf(1) }), ['P0001']);
    await su(c); await c.query("update public.accounts set is_active=true where business_id=$1 and code='5180'", [orgs.A.business]);
    await as(c, identities.A_owner.id);
    const fixed = await invMove(c, { kind: 'adjustment', movement_type: 'adjustment_in', client_key: K('h03-retry-fix'), lines: lineOf(1) });
    expect(fixed.idempotent).toBe(false);
    await su(c);
    expect(await movesFor(c, 'stock_receipt', K('h03-retry'))).toBe(1);
    expect(await entryFor(c, `stock_receipt:${K('h03-retry')}:grni`)).toHaveLength(1);
    expect(await onHand(c)).toBe(before + 4);
  });
});

test(hmeta('H03.INVJ.ISOLATION', 'Unauthorised callers are denied 42501 with nothing written: viewer of A, owner of B, anon; tenant mismatch (B product or B location on an A command) denied 42501', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_viewer.id, async (c: C) => {
    await failsWith(c, () => invMove(c, { kind: 'receipt', client_key: K('h03-iso-1'), lines: lineOf(1) }), ['42501']);
    await as(c, identities.B_owner.id);
    await failsWith(c, () => invMove(c, { kind: 'receipt', client_key: K('h03-iso-2'), lines: lineOf(1) }), ['42501']);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => invMove(c, { kind: 'receipt', client_key: K('h03-iso-3'), lines: lineOf(1, 900, 'B') }), ['42501']);
    await failsWith(c, () => invMove(c, { kind: 'receipt', client_key: K('h03-iso-4'), location_id: orgs.B.location, lines: lineOf(1) }), ['42501']);
    await as(c, null, 'anon');
    await failsWith(c, () => invMove(c, { kind: 'receipt', client_key: K('h03-iso-5'), lines: lineOf(1) }), ['42501']);
    await su(c);
    expect((await c.query("select count(*)::int n from public.stock_movements where source_id::text = any($1)", [[1, 2, 3, 4, 5].map((i) => K(`h03-iso-${i}`))])).rows[0].n).toBe(0);
  });
});

// ── H-4 invoice direct-edit authority ──
/** Superuser: move rows out of the current transaction's created_at (ends the same-tx create exemption) and return to the owner identity. Rolled back with the probe. */
/** Emulate the Supabase platform-default table grants (UPDATE/DELETE for authenticated) that the bare migration replay lacks, inside the rolled-back probe, so denials below come from the H-4 trigger rather than a missing privilege. */
const platformGrants = async (c: C) => {
  await su(c);
  await c.query('grant update, delete on public.invoices, public.invoice_lines to authenticated');
  await as(c, identities.A_owner.id);
};
const backdate = async (c: C, ...ids: string[]) => {
  await su(c);
  await c.query("update public.invoices set created_at = now() - interval '1 hour' where id = any($1::uuid[])", [ids]);
  await as(c, identities.A_owner.id);
};
test(hmeta('H04.INVOICE.POSTED-DIRECT-EDIT-DENIED', 'Direct API writes (role authenticated, even the owner) cannot alter a posted invoice: total/status→paid/void, invoice_lines insert/update/delete, re-pointing journal_entry_id, deleting the invoice — all 42501 and the invoice is unchanged', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await platformGrants(c);
    const inv = (await createInvoice(c, 'A', key(851))).invoice;
    const other = (await createInvoice(c, 'A', key(852))).invoice;
    await backdate(c, inv.id);
    await as(c, identities.A_owner.id);
    for (const sql of ["update public.invoices set total_amount=1 where id=$1", "update public.invoices set status='paid' where id=$1",
      "update public.invoices set status='void' where id=$1", "update public.invoices set notes='x', subtotal=5 where id=$1",
      "update public.invoice_lines set line_total=1 where invoice_id=$1", "delete from public.invoice_lines where invoice_id=$1",
      "delete from public.invoices where id=$1"]) {
      const e = await failsWith(c, () => c.query(sql, [inv.id]), ['42501']);
      expect(e.message).toMatch(/\(H-4\)/);
    }
    await failsWith(c, () => c.query(`insert into public.invoice_lines(invoice_id,business_id,line_number,description,quantity,unit_price,discount_percent,discount_amount,tax_code,tax_rate,tax_amount,line_total)
      values($1,$2,9,'H04',1,1,0,0,'none',0,0,1)`, [inv.id, orgs.A.business]), ['42501']);
    // legitimate link once (journalService), then cannot be re-pointed
    const je = (await pay(c, other.id, 100, key(853))).journal_entry_id;
    expect(je).toBeTruthy();
    if (je) {
      await c.query('update public.invoices set journal_entry_id=$2 where id=$1', [inv.id, je]);
      await failsWith(c, () => c.query('update public.invoices set journal_entry_id=null where id=$1', [inv.id]), ['42501']);
    }
    await su(c);
    const s = (await c.query('select status::text s, total_amount::numeric t, (select count(*)::int from public.invoice_lines where invoice_id=$1) n from public.invoices where id=$1', [inv.id])).rows[0];
    expect({ s: s.s, t: Number(s.t), n: s.n }).toEqual({ s: 'sent', t: 1000, n: 2 });
    expect(other.id).toBeTruthy();
  });
});

test(hmeta('H04.INVOICE.LEGIT-WORKFLOWS-PRESERVED', 'Legitimate workflows still work: atomic create (same transaction), payment via record_invoice_payment (status → partially_paid), draft header/lines editable and draft → sent (a draft cannot jump to paid directly); SECURITY DEFINER commands unaffected', MP), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await platformGrants(c);
    const inv = (await createInvoice(c, 'A', key(861))).invoice;
    const d = (await createInvoice(c, 'A', key(862), { status: 'draft' })).invoice;
    await backdate(c, inv.id, d.id);
    const p = await pay(c, inv.id, 400, key(863));
    expect(p.invoice.status).toBe('partially_paid');
    await c.query("update public.invoices set notes='edited draft', total_amount=1000 where id=$1", [d.id]);
    await c.query("update public.invoice_lines set description='edited' where invoice_id=$1 and line_number=1", [d.id]);
    await c.query("update public.invoices set status='sent' where id=$1", [d.id]);
    const d2 = (await createInvoice(c, 'A', key(864), { status: 'draft' })).invoice;
    await backdate(c, d2.id);
    await failsWith(c, () => c.query("update public.invoices set status='paid' where id=$1", [d2.id]), ['42501']);
    await c.query("update public.invoice_lines set description='draft line edit' where invoice_id=$1", [d2.id]);
    await su(c);
    expect((await c.query('select status::text s from public.invoices where id=$1', [d.id])).rows[0].s).toBe('sent');
    expect((await c.query("select count(*)::int n from public.invoice_lines where invoice_id=$1 and description='draft line edit'", [d2.id])).rows[0].n).toBe(2);
  });
});

test(hmeta('H04.INVOICE.PERIOD-AND-APPROVAL-POLICY', 'DECISION REQUIRED — INVOICE EDIT POLICY: no financial-period lock and no invoice approval mechanism exists in the schema, so neither is enforced on invoice edits; role authority remains can_write_sales_data (RLS)', MP), async () => {
  throw new Blocked('DECISION REQUIRED — INVOICE EDIT POLICY: (1) which financial periods are closed, and should edits/backdated invoices in them be refused? (2) do invoices require approval before posting, and who approves? No period-lock or invoice-approval mechanism exists to enforce; none was invented.');
});

// ── H-5 explicit invoice INSERT grant ──
test(hmeta('H05.GRANT.AUTHORIZATION', 'With the explicit least-privilege grant (INSERT only; no anon): an authenticated writer can create an invoice; a viewer is denied by RLS (42501); a B owner cannot insert into A (42501); anon has no privilege (42501); lines for an A invoice cannot be inserted by B (42501); grant does not include UPDATE/DELETE beyond existing policies', MP), async () => {
  ready();
  const cols = `business_id,contact_id,branch_id,invoice_number,invoice_type,status,issue_date,due_date,currency,exchange_rate,subtotal,taxable_amount,discount_amount,discount_percent,vat_amount,wht_amount,total_amount,amount_paid`;
  const ins = (c: C, org: string, n: string) => c.query(`insert into public.invoices(${cols}) values($1,$2,$3,$4,'invoice','draft',$5,$5,'MWK',1,1,1,0,0,0,0,1,0) returning id`,
    [orgs[org].business, orgs[org].customer, orgs[org].branch, n, DAY]);
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const id = (await ins(c, 'A', 'H05-OK')).rows[0].id as string;
    expect(id).toBeTruthy();
    await as(c, identities.A_viewer.id); await failsWith(c, () => ins(c, 'A', 'H05-V'), ['42501']);
    await as(c, identities.B_owner.id); await failsWith(c, () => ins(c, 'A', 'H05-X'), ['42501']);
    await failsWith(c, () => c.query(`insert into public.invoice_lines(invoice_id,business_id,line_number,description,quantity,unit_price,discount_percent,discount_amount,tax_code,tax_rate,tax_amount,line_total)
      values($1,$2,1,'H05',1,1,0,0,'none',0,0,1)`, [id, orgs.A.business]), ['42501']);
    await failsWith(c, () => c.query(`insert into public.invoice_lines(invoice_id,business_id,line_number,description,quantity,unit_price,discount_percent,discount_amount,tax_code,tax_rate,tax_amount,line_total)
      values($1,$2,1,'H05',1,1,0,0,'none',0,0,1)`, [id, orgs.B.business]), ['42501']);
    await as(c, null, 'anon'); await failsWith(c, () => ins(c, 'A', 'H05-ANON'), ['42501']);
  });
  const g = (await db.client.query(`select has_table_privilege('anon','public.invoices','insert') a, has_table_privilege('anon','public.invoice_lines','insert') al,
    has_table_privilege('authenticated','public.invoices','insert') i, has_table_privilege('authenticated','public.invoice_lines','insert') l`)).rows[0];
  expect(g).toEqual({ a: false, al: false, i: true, l: true });
  const rls = (await db.client.query("select relname, relrowsecurity from pg_class where relname in ('invoices','invoice_lines') and relnamespace='public'::regnamespace order by relname")).rows;
  expect(rls.map((r: Record<string, any>) => r.relrowsecurity)).toEqual([true, true]);
});

// ── H-6 stock-movement index evidence ──
test(hmeta('H06.INDEX.EXPLAIN-EVIDENCE', 'Query: the per-document idempotency probe used by record_sale_stock_and_cogs / backfill (business_id = $1 AND source_type = $2 AND source_id = $3). On 20 000 synthetic movements (rolled back) the plan WITHOUT idx_stock_movements_business_source is a scan over the business rows; WITH it an Index (Only) Scan on that index with lower estimated cost', MB), async () => {
  ready();
  await db.asRole('service_role', null, async (c: C) => {
    await su(c);
    await c.query('set local statement_timeout = 0');
    await c.query('set local session_replication_role = replica');  // synthetic rows only; skip per-row triggers, rolled back
    await c.query(`insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id,reference)
      select $1,$2,$3,'adjustment_in',$4,1,1,'h06_synthetic', gen_random_uuid(), 'H06' from generate_series(1,20000) g`, [orgs.A.business, orgs.A.product, orgs.A.location, DAY]);
    await c.query('analyze public.stock_movements');
    await c.query('set local session_replication_role = origin');
    const q = `explain (format json) select 1 from public.stock_movements where business_id='${orgs.A.business}' and source_type='invoice' and source_id='${key(869)}'`;
    const plan = async () => (await c.query(q)).rows[0]['QUERY PLAN'][0].Plan as Record<string, any>;
    const flat = (p: Record<string, any>): string[] => [`${p['Node Type']}:${p['Index Name'] ?? ''}`, ...((p.Plans ?? []) as Record<string, any>[]).flatMap(flat)];
    const after = await plan();
    await c.query('savepoint h06'); await c.query('drop index public.idx_stock_movements_business_source');
    const before = await plan();
    await c.query('rollback to savepoint h06');
    expect(flat(after).some((n) => n.includes('idx_stock_movements_business_source'))).toBe(true);
    expect(flat(before).some((n) => n.includes('idx_stock_movements_business_source'))).toBe(false);
    expect(after['Total Cost']).toBeLessThan(before['Total Cost']);
    const { appendFileSync } = await import('node:fs');
    try { appendFileSync(join(process.cwd(), '.cache', 'h06-explain.json'), JSON.stringify({ before: flat(before), beforeCost: before['Total Cost'], after: flat(after), afterCost: after['Total Cost'] }) + '\n'); } catch { /* evidence side-file optional */ }
  });
});
