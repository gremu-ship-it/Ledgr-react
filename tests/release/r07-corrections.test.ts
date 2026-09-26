/**
 * R07 — Approvals, refunds, voids and correction safety: boundary evidence.
 *
 * Investigation result (traced end-to-end before writing this suite):
 *   UI: PosCart/PosSalesHistoryModal ask for "manager approval" via
 *   PosManagerApprovalModal, whose ONLY check is `pin.length >= 4` in the
 *   browser. handleManagerApproved closes the modal and invokes the pending
 *   action callback with a free-text name; the name is never even forwarded
 *   to processReturn/processVoid, which perform the financial mutation with
 *   raw client DML (invoice update / credit-note insert / movement insert).
 *   Server (post decision): canonical correction surface implemented in
 *   20260928000002 (commands + minimal state); the pre-implementation absence
 *   proofs below were superseded by presence records under the same identities.
 *
 * The anchored R07 records remain BLOCKED (POS.VOID, POS.REFUND,
 * FINANCE.REVERSAL — canonical command/approval/entitlement contract not yet
 * approved; no substitute command invented). This suite converts the
 * investigation into permanent machine-verified boundary facts: it attests
 * WHAT the migration chain enforces today and WHERE the false-approval attack
 * lands, so the decision-gated correction package has a deterministic
 * regression net the moment it is approved. No remediation is claimed here —
 * documentation-level verification records only (catalog/boundary truths),
 * mirroring the DEF-MIRROR/absence-proof precedent.
 *
 * All probes roll back; fixture immutability is proven afterwards.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r07-corrections');
const LAYER = 'real PostgreSQL17 full migration replay; synthetic identities; catalog and role-boundary probes inside rolled-back transactions; characterization records (boundary facts), no enforcement claimed';
const meta = (id: string, expected: string, source: string) => ({
  id, expected, remediation: 'R07', source, layer: LAYER,
});

let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let auditBaseline = -1;
let seedError = '';
beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try { orgs = await seedFixture(db.client);
    auditBaseline = (await db.client.query('select count(*)::int n from public.audit_log')).rows[0].n as number; }
  catch (e) { seedError = safeError(e); }
});
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}
type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

test(meta('R07.APPROVAL.SERVER-COMMAND-SURFACE', 'The correction surface is now server-bound: exactly the canonical R07 commands exist (request/authorize/consume/preflight/void/refund) and nothing else correction-shaped; raw approval "permissions" remain client-free', 'supabase/migrations/20260928000002_r07_correction_commands.sql'), async () => {
  ready();
  // Supersedes the pre-remediation absence record (R07.APPROVAL.NO-SERVER-COMMAND):
  // implementing the mandated contract makes the old "nothing exists" truth false.
  const names = (await db.client.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows.map((r: { proname: string }) => r.proname);
  const hits = names.filter((n: string) => /approv|refund|void|revers|correct|unpost/i.test(n));
  for (const expected of ['request_pos_approval','authorize_pos_approval','_ledgr_consume_pos_approval','_ledgr_correction_preflight','void_pos_sale_command','refund_pos_sale_command']) {
    expect(hits).toContain(expected);
  }
  // No foreign or duplicated correction-shaped entrypoints beyond the canonical six.
  expect(hits.sort()).toEqual(['_ledgr_consume_pos_approval','_ledgr_correction_preflight','authorize_pos_approval','refund_pos_sale_command','request_pos_approval','void_pos_sale_command']);
});

test(meta('R07.APPROVAL.SERVER-STATE', 'Minimal authoritative approval state exists server-side: pos_approvals (org/document/action/requester/approver/expiry/single-use) + pos_corrections ledger; financial documents remain untouched by approval columns; authorization never takes a PIN', 'supabase/migrations/20260928000002_r07_correction_commands.sql'), async () => {
  ready();
  // Supersedes the pre-remediation absence record (R07.APPROVAL.NO-SERVER-STATE).
  const tables = (await db.client.query("select table_name from information_schema.tables where table_schema='public' and table_name in ('pos_approvals','pos_corrections') order by 1")).rows.map((r: { table_name: string }) => r.table_name);
  expect(tables).toEqual(['pos_approvals', 'pos_corrections']);
  const apprCols = (await db.client.query("select column_name from information_schema.columns where table_schema='public' and table_name='pos_approvals'")).rows.map((r: { column_name: string }) => r.column_name);
  for (const col of ['business_id','document_id','action','requested_by','authorized_by','expires_at','consumed_at','consumed_by','token']) {
    expect(apprCols).toContain(col);
  }
  const cols = (await db.client.query("select table_name||'.'||column_name n from information_schema.columns where table_schema='public'")).rows.map((r: { n: string }) => r.n);
  const touchedDocs = cols.filter((entry: string) => entry.indexOf('.') > 0 && /approv|manager_pin/i.test(entry.split('.').pop() ?? '') && ['invoices','invoice_payments','invoice_lines','journal_entries'].indexOf(entry.split('.')[0]) >= 0);
  expect(touchedDocs).toEqual([]);
  const fns = (await db.client.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")).rows.map((r: { proname: string }) => r.proname);
  expect(fns.filter((f: string) => /pin/i.test(f))).toEqual([]);
});

// SUPERSEDED IN PLACE by POST-CONTAINMENT HARDENING H-4 (2026-09-26), per
// this suite's precedent (absence proof → presence record, same identity).
// Original expectation (pre-H-4, verbatim): "The invoices table has no
// status-transition guard trigger (existing triggers only sync amount_due /
// updated_at): a void is executable by raw DML wherever permissions allow
// UPDATE". Migration 20261012000000 adds the direct-write guard; the
// behavioural proof is H04.INVOICE.POSTED-DIRECT-EDIT-DENIED (ic-containment).
test(meta('R07.VOID.NO-STATUS-GUARD', 'SUPERSEDED by H-4 (20261012000000): exactly one invoices trigger now references void — trg_invoices_zz_direct_write_guard, which refuses a direct (authenticated/anon) status→void/credit_note or edit of a posted invoice; void remains reachable only through the R07 SECURITY DEFINER commands. No other invoices trigger references void', 'supabase/migrations (chain-wide trigger scan) + supabase/migrations/20261012000000_post_containment_hardening.sql'), async () => {
  ready();
  const trg = (await db.client.query("select tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='invoices' and not t.tgisinternal order by 1")).rows.map((r: { tgname: string }) => r.tgname);
  expect(trg.length).toBeGreaterThan(0); // table is not trigger-free (inventory truth)
  const referencingVoid: string[] = [];
  for (const name of trg) {
    const def = (await db.client.query('select pg_get_functiondef(t.tgfoid) d from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname=$1 and t.tgname=$2', ['invoices', name])).rows[0].d as string;
    if (/void/i.test(def)) referencingVoid.push(name);
  }
  expect(referencingVoid).toEqual(['trg_invoices_zz_direct_write_guard']);
});

test(meta('R07.AUDIT.SAME-TENANT-FABRICATED-ACCEPTED', 'Boundary fact: log_manual_audit_event accepts caller-fabricated event content (e.g., a forged approver string) for the caller own business; only the ACTOR is server-derived', 'supabase/migrations/20260815000000_phase8b_reconstruct_rpcs.sql'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    await c.query("select public.log_manual_audit_event($1,'pos_refund','invoices',$2,$3,null,$4::jsonb,$5)",
      [orgs.A.business, 'r13-forged-resource', 'REC-000', JSON.stringify({ approverName: 'Ghost Manager', refundAmount: 1500 }), 'POS Refund of MK 1,500 for #REC-000 (Approved: Ghost Manager)']);
    // The audit READ tier does not include cashier (can_read_audit) — verify
    // what was written from the privileged observer position on the same
    // rolled-back connection (harness POS.SALE precedent).
    await c.query('reset role');
    const row = (await c.query("select notes, user_id from public.audit_log where business_id=$1 and resource_ref='REC-000'", [orgs.A.business])).rows[0];
    expect(row.notes as string).toContain('Ghost Manager');
    expect(String(row.user_id)).toBe(identities.A_cashier.id);
  });
});

test(meta('R07.AUDIT.CROSS-TENANT-DENIED', 'The audit write path still enforces tenant membership: the same fabrication attempt against a foreign business raises 42501', 'supabase/migrations/20260815000000_phase8b_reconstruct_rpcs.sql'), async () => {
  ready();
  let caught: { code?: string } | undefined;
  try {
    await db.asRole('authenticated', identities.A_cashier.id,
      "select public.log_manual_audit_event($1,'pos_refund','invoices',$2,$3,null,$4::jsonb,$5)",
      [orgs.B.business, 'r13-forged-x', 'REC-000', JSON.stringify({ approverName: 'Ghost Manager' }), 'Cross-tenant forged refund for org B REC-000']);
  } catch (e) { caught = e as { code?: string }; }
  expect(caught?.code).toBe('42501');
});

test(meta('R07.DATA-UNCHANGED', 'All R07 probes roll back: audit log, invoices and identity tables unchanged after the suite', 'tests/release/r07-corrections.test.ts'), async () => {
  ready();
  const q = (t: string) => db.client.query(`select count(*)::int n from public.${t}`).then((r: { rows: Array<{ n: number }> }) => r.rows[0].n);
  expect(await q('audit_log')).toBe(auditBaseline);
  expect(await q('invoices')).toBe(0);
  expect(await q('stock_movements')).toBe(0);
  expect(await q('contacts')).toBe(2);
  expect(await q('business_users')).toBe(14);
});
