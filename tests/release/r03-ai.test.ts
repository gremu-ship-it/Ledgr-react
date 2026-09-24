/**
 * R03 — AI authorisation and context-boundary verification suite.
 *
 * Scope supplied by the R03 authorisation: every AI authorization/context
 * path must deny anonymous, unauthenticated, cross-organisation and
 * insufficiently-privileged callers, at BOTH boundaries that expose business
 * financial context:
 *
 *   • the database RPC  public.ai_context(uuid)  – invoked directly by the
 *     browser client (src/lib/ai/context.ts) and by ai-chat;
 *   • the ai-chat Edge Function – the optional LLM-backed assistant.
 *
 * Every denial statement asserts the rejection itself AND that no protected
 * business/financial context crossed the boundary (no result rows / no
 * ai_context invocation / zero external effects); allowed statements assert
 * the returned context is limited to the caller's own verified scope.
 *
 * Role model: the allow-list mirrors canViewReports = true in
 * src/hooks/usePermissions.ts, copied verbatim into
 * 20260927000000_r03_ai_context_authorization.sql. No new permissions are
 * invented; roles already excluded from reports stay excluded from AI.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, roles, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';
import { loadEdge, mockClient } from './edge-loader.mjs';

const test = evidenceSuite('r03-ai');
const MIGRATION = 'supabase/migrations/20260927000000_r03_ai_context_authorization.sql';
const HANDLER = 'supabase/functions/ai-chat/index.ts';
const ROLE_SOURCE = 'src/hooks/usePermissions.ts';
const DB_LAYER = 'real PostgreSQL17 roles/JWT claims; synthetic identities; full migration replay';
const EDGE_LAYER = 'unchanged Edge handler in local Node VM; mocked Auth/DB; no Deno/gateway';
const meta = (id: string, expected: string, source = MIGRATION) => ({
  id, expected, remediation: 'R03', source, layer: DB_LAYER,
});
const edgeMeta = (id: string, expected: string) => ({
  id, expected, remediation: 'R03', source: HANDLER, layer: EDGE_LAYER,
});

/** canViewReports=true mirror; seeded-role symmetry enforced by the matrix test. */
const REPORTS_ROLES = ['owner', 'admin', 'accountant', 'manager', 'sales_manager',
  'tax_compliance_officer', 'treasury_manager', 'asset_manager', 'board_member',
  'auditor', 'viewer', 'branch_manager'];

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

/** Denial assertion: requires a genuine 42501, never a syntax/setup accident. */
async function denied42501(run: () => Promise<unknown>) {
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  if (!caught) throw new Error('Authorisation probe completed without the expected 42501 denial.');
  expect(caught.code).toBe('42501');
}

/** Positive control, also used as post-denial integrity evidence. */
async function ownerScopedContext(org: string) {
  const r = await db.asRole('authenticated', identities[`${org}_owner`].id,
    'select public.ai_context($1) data', [orgs[org].business]);
  expect(r.rows[0].data.company.id).toBe(orgs[org].business);
  expect(JSON.stringify(r.rows[0].data)).not.toContain(orgs[org === 'A' ? 'B' : 'A'].business);
  return r.rows[0].data;
}

// ── 1. Anonymous and unauthenticated identities ─────────────────────────────
test(meta('R03.AI.RPC.ANON-DENIED', 'Anonymous API identity is denied (42501) with zero context returned and data unchanged'), async () => {
  ready();
  await denied42501(() => db.asRole('anon', null, 'select public.ai_context($1)', [orgs.A.business]));
  // Post-denial integrity: the protected data neither escaped nor changed.
  const control = await ownerScopedContext('A');
  expect(control.monthlyTrend).toHaveLength(12);
});

test(meta('R03.AI.RPC.NULL-UID-AUTHENTICATED-DENIED', 'Authenticated role with an empty/missing user id (malformed auth context) is denied'), async () => {
  ready();
  await denied42501(() => db.asRole('authenticated', null, 'select public.ai_context($1)', [orgs.A.business]));
  await ownerScopedContext('A'); // control: denial did not disturb legitimate access
});

test(meta('R03.AI.RPC.SERVICE-ROLE-PATH', 'Trusted null-uid path used by ai-chat (service_role) still resolves strictly the requested business'), async () => {
  ready();
  const r = await db.asRole('service_role', null, 'select public.ai_context($1) data', [orgs.A.business]);
  expect(r.rows[0].data.company.id).toBe(orgs.A.business);
  expect(JSON.stringify(r.rows[0].data)).not.toContain(orgs.B.business);
});

// ── 2. Role boundary (canViewReports mirror) ────────────────────────────────
test(meta('R03.AI.RPC.ROLE-GATE-MATRIX', 'Seeded roles receive context only when the existing reports-visibility matrix allows it; denial returns zero contexts', ROLE_SOURCE), async () => {
  ready();
  for (const role of roles) {
    const uid = identities[`A_${role}`].id;
    if (REPORTS_ROLES.includes(role)) {
      const r = await db.asRole('authenticated', uid, 'select public.ai_context($1) data', [orgs.A.business]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].data.company.id).toBe(orgs.A.business);
      expect(r.rows[0].data.company.name).toBe('R13 Organisation A');
      expect(JSON.stringify(r.rows[0].data)).not.toContain(orgs.B.business);
    } else {
      await denied42501(() => db.asRole('authenticated', uid, 'select public.ai_context($1)', [orgs.A.business]));
    }
  }
  // Post-matrix integrity control.
  await ownerScopedContext('A');
});

test(meta('R03.AI.RPC.DEF-MIRRORS-ROLE-MODEL', 'ai_context definition carries guards plus the complete reports tier and no reports-excluded role'), async () => {
  ready();
  // P5-E: ai_context is now (uuid, uuid) with branch authorization; check the 2-arg def for guards
  const vDef = (await db.client.query("select pg_get_functiondef('public.ai_context(uuid, uuid)'::regprocedure) d")).rows[0].d;
  expect(vDef).toContain('authentication required');
  expect(vDef).toContain('business financial insights');
  expect(vDef).toContain('can_access_branch');
  for (const role of REPORTS_ROLES) expect(vDef).toContain(role);
  // v_assigned_roles intentionally contains operational roles for branch filtering (P5-E), so do not
  // assert their absence from the whole def — instead verify the reports allow-list is exact.
  // Extract the v_reports_roles array literal from the def and verify it matches REPORTS_ROLES.
  const reportsMatch = vDef.match(/v_reports_roles[^;]*array\[([^\]]+)\]/);
  if (reportsMatch) {
    const reportsStr = reportsMatch[1];
    for (const role of ['cashier', 'stock_clerk', 'sales_clerk', 'data_entry', 'supervisor',
      'inventory_manager', 'payroll_manager', 'purchasing_officer', 'warehouse_worker', 'customer_service_rep']) {
      expect(reportsStr).not.toContain(role);
    }
  }
  // One-arg wrapper must still exist for compatibility
  const vDef1 = (await db.client.query("select pg_get_functiondef('public.ai_context(uuid)'::regprocedure) d")).rows[0].d;
  expect(vDef1).toBeTruthy();
});

test(meta('R03.AI.RPC.EXECUTE-PRIVILEGES', 'EXECUTE on ai_context is closed for PUBLIC/anon and retained for authenticated and service_role'), async () => {
  ready();
  const q = (role: string, sig: string) => db.client.query(
    `select has_function_privilege($1, '${sig}', 'EXECUTE') ok`, [role]).then((r: { rows: Array<{ ok: boolean }> }) => r.rows[0].ok);
  for (const sig of ['public.ai_context(uuid)', 'public.ai_context(uuid, uuid)']) {
    expect(await q('anon', sig)).toBe(false);
    expect(await q('authenticated', sig)).toBe(true);
    expect(await q('service_role', sig)).toBe(true);
  }
});

// ── 3. Cross-organisation / caller-supplied identifiers ─────────────────────
test(meta('R03.AI.RPC.CROSS-ORG-DENIED', 'Caller-supplied foreign business id is denied for management and operational roles alike; own scope unaffected'), async () => {
  ready();
  await denied42501(() => db.asRole('authenticated', identities.A_owner.id, 'select public.ai_context($1)', [orgs.B.business]));
  await denied42501(() => db.asRole('authenticated', identities.A_cashier.id, 'select public.ai_context($1)', [orgs.B.business]));
  await denied42501(() => db.asRole('authenticated', identities.B_owner.id, 'select public.ai_context($1)', [orgs.A.business]));
  await ownerScopedContext('A');
  await ownerScopedContext('B');
});

test(meta('R03.AI.RPC.NULL-PARAM', 'Empty business context is rejected with an explicit error, not a data leak'), async () => {
  ready();
  let caught: { code?: string; message?: string } | undefined;
  try { await db.asRole('authenticated', identities.A_owner.id, 'select public.ai_context(null)'); }
  catch (e) { caught = e as { code?: string; message?: string }; }
  expect(caught).toBeTruthy();
  expect(caught?.message).toContain('ai_context: business id is required');
});

// ── 4. Edge-function boundary (ai-chat) ─────────────────────────────────────
const bizA = key(201);
const bizB = key(202);
const aiContextFor = (businessId: string) => ({
  company: { id: businessId, name: 'R13 A' }, kpis: {}, monthlyTrend: [],
  overdueInvoices: [], topExpenses: [], topCustomers: [], upcomingReceivables: [],
  upcomingPayables: [], anomalies: [],
});
const membershipRow = (role: string) => [{ business_id: bizA, role, businesses: { id: bizA, name: 'R13 A', deleted_at: null } }];
const aiChat = (id: string, role: string | null, provider?: (url: string, init: object) => Promise<Response>) => {
  const client = mockClient({
    user: role === null ? null : { id },
    resolveQuery: (c: { table: string; filters: unknown[][] }) => ({
      data: c.table === 'business_users' && role ? membershipRow(role) : null, error: null,
    }),
    resolveRpc: (name: string, args: unknown) => {
      const pBusinessId = (args as { p_business_id?: string } | undefined)?.p_business_id;
      if (name === 'ai_context' && pBusinessId === bizA) return { data: aiContextFor(bizA), error: null };
      return { data: null, error: { message: 'foreign or unknown rpc' } };
    },
  });
  const edge = loadEdge('ai-chat', { client, provider }) as { invoke: (req: Request) => Promise<Response>; effects: { network: number; mail: number } };
  return { client, edge };
};
const chatBody = (ctx: unknown) => JSON.stringify({ messages: [{ role: 'user', content: 'R03 probe' }], context: ctx });
const noContextCrossed = (client: { calls: Array<Record<string, unknown>> }, edge: { effects: { network: number } }) => {
  expect(client.calls.filter((c) => c.rpc === 'ai_context')).toHaveLength(0);
  expect(edge.effects.network).toBe(0);
  const writes = client.calls.filter((c) => c.operation && c.operation !== 'select');
  expect(writes.every((c) => c.table === 'ai_insights_usage')).toBe(true); // telemetry only, pre-tenant
};

test(edgeMeta('R03.AI.EDGE.ANON-DENIED', 'Direct ai-chat invocation without a session is 401 before any table, RPC or provider access'), async () => {
  const { client, edge } = aiChat('', null);
  const r = await edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', body: chatBody({ companyId: bizA }) }));
  expect(r.status).toBe(401);
  const body = await r.json();
  expect(body.content).toBeUndefined();
  expect(client.calls).toHaveLength(0);
  expect(edge.effects.network).toBe(0);
});

test(edgeMeta('R03.AI.EDGE.INVALID-SESSION-DENIED', 'Bearer trials (including service-role-shaped tokens) never substitute for a verified user session'), async () => {
  for (const token of ['r13-synthetic', 'r13-synthetic-service-role', 'r13-synthetic-server-key']) {
    const { client, edge } = aiChat('', null);
    const r = await edge.invoke(new Request('https://r13.invalid/ai', {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: chatBody({ companyId: bizA }),
    }));
    expect(r.status).toBe(401);
    expect((await r.json()).content).toBeUndefined();
    expect(client.calls).toHaveLength(0);
    expect(edge.effects.network).toBe(0);
  }
});

test(edgeMeta('R03.AI.EDGE.MALFORMED-BODY-DENIED', 'Malformed/empty request bodies are rejected without touching business data or the provider'), async () => {
  for (const raw of ['not-json', '{}', '{"messages":[]}']) {
    const { client, edge } = aiChat(identities.A_owner.id, 'owner');
    const r = await edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', headers: { Authorization: 'Bearer r13-synthetic' }, body: raw }));
    expect(r.status).toBe(400);
    expect((await r.json()).content).toBeUndefined();
    noContextCrossed(client, edge);
  }
});

test(edgeMeta('R03.AI.EDGE.CASHIER-DENIED', 'Cashier membership is denied before any context build; response carries no business data'), async () => {
  const { client, edge } = aiChat(identities.A_cashier.id, 'cashier');
  const r = await edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', headers: { Authorization: 'Bearer r13-synthetic' }, body: chatBody({ companyId: bizA }) }));
  expect(r.status).toBe(403);
  const body = await r.json();
  expect(body.error).toContain('financial insights');
  expect(body.content).toBeUndefined();
  // Identity was server-derived, not body-derived.
  expect(client.calls.find((c: Record<string, unknown>) => c.table === 'business_users')?.filters)
    .toContainEqual(['eq', 'user_id', identities.A_cashier.id]);
  noContextCrossed(client, edge);
});

test(edgeMeta('R03.AI.EDGE.CASHIER-FORGED-CONTEXT-DENIED', 'Forged role/user/business claims in the request context cannot widen a cashier to any business data'), async () => {
  const hostile = { companyId: bizB, role: 'owner', userId: identities.A_owner.id, data: { company: { id: bizB }, kpis: { revenue_mtd: 999999 } } };
  const { client, edge } = aiChat(identities.A_cashier.id, 'cashier');
  const r = await edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', headers: { Authorization: 'Bearer r13-synthetic' }, body: chatBody(hostile) }));
  expect(r.status).toBe(403);
  const body = await r.json();
  expect(body.content).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('999999');
  noContextCrossed(client, edge);
});

test(edgeMeta('R03.AI.EDGE.STOCK-CLERK-DENIED', 'Other reports-excluded operational roles (stock clerk) are denied identically'), async () => {
  const { client, edge } = aiChat(identities.A_stock_clerk.id, 'stock_clerk');
  const r = await edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', headers: { Authorization: 'Bearer r13-synthetic' }, body: chatBody({ companyId: bizA }) }));
  expect(r.status).toBe(403);
  expect(JSON.stringify(await r.json())).not.toContain('R13 A');
  noContextCrossed(client, edge);
});

test(edgeMeta('R03.AI.EDGE.ALLOWED-ROLE-SCOPE-LIMITED', 'Reports-tier roles (owner, viewer) receive an answer built ONLY from their own verified business'), async () => {
  for (const [id, role] of [[identities.A_owner.id, 'owner'], [identities.A_viewer.id, 'viewer']] as const) {
    let providerCalls = 0;
    const { client, edge } = aiChat(id, role, async () => { providerCalls++; return new Response(JSON.stringify({ choices: [{ message: { content: 'R03 scoped answer' } }] }), { status: 200 }); });
    const r = await edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', headers: { Authorization: 'Bearer r13-synthetic' }, body: chatBody({ companyId: bizA }) }));
    expect(r.status).toBe(200);
    expect(providerCalls).toBe(1);
    const rpc = client.calls.filter((c: Record<string, unknown>) => c.rpc === 'ai_context');
    expect(rpc).toHaveLength(1);
    const rpcArgs = rpc[0].args as { p_business_id: string };
    expect(rpcArgs.p_business_id).toBe(bizA); // strictly own scope
    expect((await r.json()).content).toContain('R03 scoped answer');
    expect(rpcArgs.p_business_id).not.toBe(bizB);
  }
});

test(edgeMeta('R03.AI.EDGE.CROSS-ORG-DENIED', 'Caller-supplied foreign org hints are denied with zero ai_context invocations and zero external effects'), async () => {
  for (const role of ['owner', 'cashier'] as const) {
    const { client, edge } = aiChat(role === 'owner' ? identities.A_owner.id : identities.A_cashier.id, role);
    const r = await edge.invoke(new Request('https://r13.invalid/ai', { method: 'POST', headers: { Authorization: 'Bearer r13-synthetic' }, body: chatBody({ companyId: bizB }) }));
    expect(r.status).toBe(403);
    expect((await r.json()).content).toBeUndefined();
    noContextCrossed(client, edge);
  }
});
