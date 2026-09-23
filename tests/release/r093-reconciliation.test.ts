// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeAll, afterAll, beforeEach, expect, vi } from 'vitest';
import { offlineDB, type QueueItem } from '@/offline/db';
import { enqueue } from '@/offline/queueApi';
import { syncQueue } from '@/offline/syncEngine';
import { reconcileQueueItem, isReconcilable } from '@/offline/reconciliation';
import { claimLease } from '@/offline/lease';
import { enqueueQuarantinedLegacy } from '@/offline/legacyPosQueue';
import { useAppStore } from '@/store/useAppStore';
import { buildPosSaleQueuePayload } from '@/services/posService';
import { buildPosSaleRpcPayload } from '@/services/posSaleRpc';
import { realSupabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

/**
 * R09.3 (P-D3-FINAL = Model 3 + Model 4) release evidence.
 *
 * Layer contract:
 *  - fake IndexedDB holds the real offline queue (src/offline/*);
 *  - the mocked transport routes ONLY post_pos_sale and
 *    reconcile_offline_queue_item into the disposable PostgreSQL fixture as
 *    the test-declared actor — every server authority (membership, branch,
 *    shift, R10 P0QLT quota, R06 23514 stock invariant, client-key
 *    idempotency, DEC-08 late arrival) is the REAL code, not a stub;
 *  - raw PG message text flows to the classifier (it never reaches evidence:
 *    safeError retains only SQLSTATE codes);
 *  - assertion readback uses the fixture oracle client, the same convention
 *    as the existing OFFLINE.* and R10.QUOTA.* records.
 *
 * No authenticated invoice readback is required anywhere in this suite:
 * exception entries are denial paths (nothing committed), and reconciliation
 * is answered by the server function itself (document id returned in the
 * RPC payload), so the migration-only grant profile is never stretched.
 */
const test = evidenceSuite('r093-reconciliation');
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let setupError = '';
const rpcCalls: string[] = [];
let rpcActor: string = identities.A_cashier.id;
let transientFailuresRemaining = 0;
let usageSeededB = false;

beforeAll(async () => {
  try {
    db = await createDatabaseFixture();
    orgs = await seedFixture(db.client);
  } catch (e) {
    setupError = safeError(e);
  }
});

const qUser = (id: string, email: string) =>
  useAppStore.setState({ currentUser: { id, email, profile: null } });
const qCashierA = () => qUser(identities.A_cashier.id, 'a-cashier@r13.test');

beforeEach(async () => {
  await offlineDB.open();
  await offlineDB.queue.clear();
  qCashierA();
  rpcActor = identities.A_cashier.id;
  rpcCalls.length = 0;
  vi.restoreAllMocks();
  // No client readback fallback is permitted on this suite's success paths:
  // reconciliation answers from the server function's own response.
  vi.spyOn(repos.invoice, 'findByIdWithLines').mockImplementation(async () => {
    throw new Error('No network/readback fallback permitted (R09.3)');
  });
  vi.spyOn(realSupabase, 'rpc').mockImplementation((async (name: string, args: Record<string, unknown>) => {
    if (!db || !orgs) throw new Error('R13 fixture unavailable');
    rpcCalls.push(name);
    // R093.EXCEPTION.TRANSIENT-ORDINARY-RETRY knob: transport-level failure
    // with NO SQLSTATE and no typed business code on the next N post_pos_sale
    // attempts (the server is never reached). Test-only fixture signaling.
    if (name === 'post_pos_sale' && transientFailuresRemaining > 0) {
      transientFailuresRemaining -= 1;
      return { data: null, error: { message: 'R093 synthetic transport failure: network request failed' } };
    }
    if (name === 'post_pos_sale') {
      try {
        const result = await db.commitAsRole('authenticated', rpcActor, 'select public.post_pos_sale($1::jsonb) data', [JSON.stringify(args.p_payload)]);
        return { data: result.rows[0].data, error: null };
      } catch (e) {
        // Raw PG system text for the classifier; evidence keeps only SQLSTATE.
        return { data: null, error: { code: (e as { code?: string }).code, message: (e as Error).message } };
      }
    }
    if (name === 'reconcile_offline_queue_item') {
      try {
        const result = await db.commitAsRole('authenticated', rpcActor, 'select public.reconcile_offline_queue_item($1::jsonb) data', [JSON.stringify(args.p_request)]);
        return { data: result.rows[0].data, error: null };
      } catch (e) {
        return { data: null, error: { code: (e as { code?: string }).code, message: (e as Error).message } };
      }
    }
    throw new Error(`Unexpected RPC '${name}'; no network fallback permitted`);
  }) as never);
});

afterAll(async () => {
  await offlineDB.delete();
  vi.restoreAllMocks();
  if (db) await db.cleanup();
});

const meta = (id: string, expectation: string) => ({
  id,
  expected: expectation,
  source: 'src/offline/{exceptions,payloadIntegrity,reconciliation,syncEngine,queueApi,provenance,db}.ts + supabase/migrations/20261002000000_r093_offline_reconciliation.sql',
  remediation: 'R09.3',
  layer: 'fake IndexedDB + real syncEngine/reconciliation + real post_pos_sale/reconcile_offline_queue_item on disposable PostgreSQL; assertion reads via fixture oracle; no authenticated invoice readback needed',
  productionVerificationRequired: false,
});

function ready() {
  if (!orgs) throw new Blocked(`Disposable database fixture unavailable: ${setupError}`);
}

type OrgKey = 'A' | 'B';
function salePayload(n: number, org: OrgKey, quantity = 1) {
  const o = orgs[org];
  const p = buildPosSaleQueuePayload(
    {
      businessId: o.business,
      shiftId: o.shift,
      cashierName: 'R13 cashier',
      customerName: 'R13 synthetic customer',
      items: [{ product_id: o.product, name: 'R13 item', quantity, unit_price: 1500, line_total: 1500 * quantity }],
      payments: [{ payment_method: 'cash', amount: 1500 * quantity, tendered: 1500 * quantity }],
      totalPaid: 1500 * quantity,
      changeGiven: 0,
    },
    { receiptNumber: `R093-${org}-${n}` },
  );
  p.invoice.contact_id = o.customer;
  p.invoice.branch_id = o.branch;
  p.invoice.issue_date = DAY;
  return p;
}

async function queued(n: number, org: OrgKey = 'A', quantity = 1): Promise<number> {
  const biz = orgs[org].business;
  const id = await enqueue('pos_sale', biz, salePayload(n, org, quantity));
  await offlineDB.queue.update(id, {
    clientKey: key(20000 + n),
    createdAt: `${DAY}T08:00:00Z`,
    localUpdatedAt: `${DAY}T08:00:00Z`,
  });
  return id;
}
const clientKeyOf = (n: number) => key(20000 + n);

/** Zero-mutation oracle for one transaction: no document, tenders, stock or ledger rows may exist for the client key. */
async function financialMutationCount(business: string, clientKey: string): Promise<number> {
  const invoices = await db.client.query('select id from public.invoices where business_id=$1 and client_key=$2', [business, clientKey]);
  if (invoices.rows.length > 0) return invoices.rows.length;
  const payments = await db.client.query(
    'select count(*)::int n from public.invoice_payments where business_id=$1 and client_key is not null and client_key::text like $2',
    [business, `${clientKey.slice(0, 8)}%`],
  );
  return Number(payments.rows[0].n);
}
async function invoiceCountFor(clientKey: string): Promise<number> {
  const r = await db.client.query('select count(*)::int n from public.invoices where client_key=$1', [clientKey]);
  return Number(r.rows[0].n);
}
async function auditRowsFor(clientKey: string) {
  const r = await db.client.query(
    'select * from public.offline_queue_reconciliations where client_key=$1 order by created_at',
    [clientKey],
  );
  return r.rows;
}
async function stockOnHand(org: OrgKey): Promise<number> {
  const o = orgs[org];
  const r = await db.client.query(
    'select quantity_on_hand::float n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [o.business, o.product, o.location],
  );
  return Number(r.rows[0]?.n ?? 0);
}
async function seedUsageToLimitB(n = 50) {
  // Same sanctioned fixture shape as the R10 records: free-tier limit 50.
  await db.client.query(
    `insert into public.invoices(business_id,contact_id,branch_id,invoice_number,invoice_type,status,issue_date,due_date,amount_paid,currency,original_currency,exchange_rate,original_amount,functional_currency,functional_amount,subtotal,taxable_amount,discount_amount,discount_percent,vat_amount,wht_amount,total_amount,rate_date,rate_is_stale,client_key)
     select $1,$2,$3,'R093-USG-'||gs,'sales','paid',$4,$4,0,'MWK','MWK',1,1500,'MWK',1500,1500,1500,0,0,0,0,1500,$4,false,gen_random_uuid() from generate_series(1,$5::int) gs`,
    [orgs.B.business, orgs.B.customer, orgs.B.branch, DAY, n],
  );
  usageSeededB = true;
}
const REASON = 'R09.3 synthetic manager decision: verified shelf restock against delivery note R093.';

/* ── Model 3: typed exceptions at the replay boundary ───────────────────── */

test(meta('R093.EXCEPTION.STOCK-DENIED', 'A replay refused by the R06 on-hand invariant (23514) becomes a durable stock-denied exception: failed + typed class + payload/provenance/client key preserved byte-exact, zero financial mutation'), async () => {
  ready();
  const id = await queued(1, 'A', 150); // 150 > 100 on hand
  const before = (await offlineDB.queue.get(id))!;
  const result = await syncQueue();
  expect(result.failed).toBe(1);
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('failed');
  expect(item.exceptionClass).toBe('stock-denied');
  expect(item.lastErrorCode).toBeNull(); // the quota discriminator stays clean
  expect(item.exceptionAt).toBeTruthy();
  expect(item.exceptionDetails).toMatch(/stock/i);
  expect(item.quarantineReason ?? null).toBeNull();
  expect(item.payload).toEqual(before.payload);
  expect(item.clientKey).toBe(before.clientKey);
  expect(item.originUserId).toBe(before.originUserId);
  expect(item.payloadHash).toBe(before.payloadHash);
  expect(rpcCalls).toEqual(['post_pos_sale']);
  // Zero unintended financial mutation: atomic denial, nothing committed.
  expect(await financialMutationCount(orgs.A.business, before.clientKey!)).toBe(0);
  expect(await invoiceCountFor(before.clientKey!)).toBe(0);
  // Stock untouched by the denied sale.
  expect(await stockOnHand('A')).toBe(100);
});

test(meta('R093.EXCEPTION.NO-BLIND-RETRY', 'A typed exception never re-enters the ordinary retry path: further sync passes skip it with zero network calls; identity and evidence stay intact'), async () => {
  ready();
  const id = await queued(2, 'A', 150);
  await syncQueue(); // → stock-denied exception
  rpcCalls.length = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    const again = await syncQueue();
    expect(again.completed).toBe(0);
    expect(again.failed).toBe(0);
  }
  expect(rpcCalls).toHaveLength(0); // zero burned attempts across 3 passes
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('failed');
  expect(item.exceptionClass).toBe('stock-denied');
  expect(item.attemptCount).toBe(1); // exactly the one authoritative attempt
  expect(await invoiceCountFor(clientKeyOf(2))).toBe(0);
});

test(meta('R093.TAMPER.QUARANTINED', 'A payload edited after capture (Integrity-hash mismatch) is quarantined payload-tampered before any network call; durable across reload; reconciliation refuses it locally with zero mutation'), async () => {
  ready();
  const id = await queued(3);
  const captured = (await offlineDB.queue.get(id))!;
  const tampered = JSON.parse(JSON.stringify(captured.payload)) as QueueItem['payload'];
  (tampered as { total: number }).total = 1; // local edit: financial meaning changed
  await offlineDB.queue.update(id, { payload: tampered });
  const result = await syncQueue();
  expect(result.completed).toBe(0);
  expect(result.failed).toBe(0);
  expect(rpcCalls).toHaveLength(0);
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('quarantined');
  expect(item.quarantineReason).toBe('payload-tampered');
  expect(item.exceptionClass).toBeNull();
  expect(await invoiceCountFor(captured.clientKey!)).toBe(0);
  // Durable: byte-identical across reload.
  offlineDB.close();
  await offlineDB.open();
  const after = (await offlineDB.queue.get(id))!;
  expect(after.status).toBe('quarantined');
  expect(after.payload).toEqual(item.payload); // tampered bytes kept as evidence
  expect(after.quarantinedAt).toBe(item.quarantinedAt);
  // Never reconcilable: local refusal, zero network, zero mutation.
  const recon = await reconcileQueueItem(id, REASON);
  expect(recon.ok).toBe(false);
  expect(recon.disposition).toBe('rejected');
  expect(rpcCalls).toHaveLength(0);
  expect((await auditRowsFor(captured.clientKey!))).toHaveLength(0);
});

/* ── Model 4: authorized reconciliation ─────────────────────────────────── */

test(meta('R093.RECON.STOCK-RESOLVED', 'After a real restock, a manager-tier reconciliation of a stock-denied sale replays the ORIGINAL payload under the ORIGINAL client key: synced exactly once, stock authoritatively deducted, audit row preserves origin actor vs reconciliation actor'), async () => {
  ready();
  const id = await queued(4, 'A', 150);
  await syncQueue(); // stock-denied (100 on hand)
  expect(((await offlineDB.queue.get(id))!).exceptionClass).toBe('stock-denied');
  rpcCalls.length = 0;
  const before = (await offlineDB.queue.get(id))!;
  // Authorized resolution condition now exists (setup privilege restock).
  await db.client.query(
    'update public.inventory_balances set quantity_on_hand=250 where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs.A.business, orgs.A.product, orgs.A.location],
  );
  // Reconciliation actor: A_owner (manager tier). Origin actor was A_cashier.
  rpcActor = identities.A_owner.id;
  const result = await reconcileQueueItem(id, REASON);
  expect(result.ok).toBe(true);
  expect(result.disposition).toBe('replay-accepted');
  expect(result.idempotent).toBe(false);
  expect(result.documentId).toBeTruthy();
  expect(rpcCalls).toEqual(['reconcile_offline_queue_item']);
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('synced');
  expect(item.resolvedServerId).toBe(result.documentId);
  // Original transaction identity + provenance byte-preserved (Part B.7).
  expect(item.payload).toEqual(before.payload);
  expect(item.clientKey).toBe(before.clientKey);
  expect(item.originUserId).toBe(identities.A_cashier.id); // never replaced
  expect(item.originDeviceId).toBe(before.originDeviceId);
  expect(item.capturedAt).toBe(before.capturedAt);
  expect(item.exceptionClass).toBe('stock-denied'); // kept as evidence
  expect(item.reconcileAttempts).toBe(1);
  expect(item.lease).toBeNull();
  // Exactly-once authoritative result: one document, stock 250→100.
  expect(await invoiceCountFor(before.clientKey!)).toBe(1);
  const inv = await db.client.query('select id, pos_shift_id from public.invoices where client_key=$1', [before.clientKey]);
  expect(inv.rows[0].id).toBe(result.documentId);
  expect(inv.rows[0].pos_shift_id).toBe(orgs.A.shift); // R08 shift binding intact
  expect(await stockOnHand('A')).toBe(100);
  // Server audit: decision recorded with BOTH actors, class, reason, result.
  const audit = await auditRowsFor(before.clientKey!);
  expect(audit).toHaveLength(1);
  expect(audit[0].disposition).toBe('replay-accepted');
  expect(audit[0].exception_class).toBe('stock-denied');
  expect(audit[0].origin_user_id).toBe(identities.A_cashier.id);
  expect(audit[0].reconciled_by).toBe(identities.A_owner.id);
  expect(audit[0].reason).toBe(REASON);
  expect(audit[0].replayed_document_id).toBe(result.documentId);
  expect(audit[0].client_key).toBe(before.clientKey);
  expect(audit[0].operation_type).toBe('pos_sale');
  expect(audit[0].revalidation.fresh_authority).toBe(true);
  expect(audit[0].denial_code).toBeNull();
});

test(meta('R093.RECON.IDEMPOTENT-LOST-ACK', 'A reconciliation whose response is lost is not duplicated: the repeated reconcile with the SAME client key resolves against the committed document (idempotent), still exactly one invoice/payment set and one stock deduction'), async () => {
  ready();
  const id = await queued(5, 'A', 120);
  await syncQueue(); // stock-denied
  await db.client.query(
    'update public.inventory_balances set quantity_on_hand=250 where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs.A.business, orgs.A.product, orgs.A.location],
  );
  rpcActor = identities.A_owner.id;
  const first = await reconcileQueueItem(id, REASON);
  expect(first.ok).toBe(true);
  const docId = first.documentId;
  // Simulate lost local acknowledgement: the durable item still looks like an
  // unresolved exception (server committed, response dropped).
  await offlineDB.queue.update(id, { status: 'failed', resolvedServerId: undefined });
  const second = await reconcileQueueItem(id, REASON);
  expect(second.ok).toBe(true);
  expect(second.idempotent).toBe(true);
  expect(second.documentId).toBe(docId); // same authoritative document
  const ck = clientKeyOf(5);
  expect(await invoiceCountFor(ck)).toBe(1);
  const payments = await db.client.query(
    'select count(*)::int n from public.invoice_payments p join public.invoices i on i.id=p.invoice_id where i.client_key=$1',
    [ck],
  );
  expect(Number(payments.rows[0].n)).toBe(1);
  expect(await stockOnHand('A')).toBe(130); // 250 − 120 exactly once
  // Both decisions audited; no duplicate financial posting.
  const audit = await auditRowsFor(ck);
  expect(audit).toHaveLength(2);
  expect(audit.every((r: { disposition?: unknown }) => r.disposition === 'replay-accepted')).toBe(true);
  expect(new Set(audit.map((r: { replayed_document_id?: unknown }) => r.replayed_document_id))).toEqual(new Set([docId]));
});

test(meta('R093.RECON.PAYLOAD-IMMUTABLE', 'A denied replay leaves the original payload, client key, provenance and exception identity byte-identical; the manager decision is recorded server-side as replay-denied with the typed code'), async () => {
  ready();
  const id = await queued(7, 'A', 150); // still only 100 on hand → stays denied
  await syncQueue();
  const before = (await offlineDB.queue.get(id))!;
  rpcActor = identities.A_owner.id;
  const result = await reconcileQueueItem(id, REASON);
  expect(result.ok).toBe(false);
  expect(result.disposition).toBe('replay-denied');
  expect(result.code).toBe('23514'); // fresh stock validation still refuses
  const after = (await offlineDB.queue.get(id))!;
  expect(after.status).toBe('failed');
  expect(after.exceptionClass).toBe('stock-denied'); // still a live exception
  expect(after.payload).toEqual(before.payload); // never altered
  expect(after.clientKey).toBe(before.clientKey); // never re-minted
  expect(after.createdAt).toBe(before.createdAt);
  expect(after.originUserId).toBe(before.originUserId);
  expect(after.payloadHash).toBe(before.payloadHash);
  expect(after.reconcileAttempts).toBe(1);
  expect(after.lease).toBeNull(); // never retains an unusable lock
  expect(await financialMutationCount(orgs.A.business, before.clientKey!)).toBe(0);
  const audit = await auditRowsFor(before.clientKey!);
  expect(audit).toHaveLength(1);
  expect(audit[0].disposition).toBe('replay-denied');
  expect(audit[0].denial_code).toBe('23514');
  expect(audit[0].replayed_document_id).toBeNull();
});

test(meta('R093.RECON.LEASE-EXCLUSIVE', 'Two tabs cannot double-reconcile: while another claimant holds the item lease, reconciliation refuses locally with zero mutation and the exception state is untouched'), async () => {
  ready();
  const id = await queued(8, 'A', 150);
  await syncQueue(); // exception
  rpcCalls.length = 0;
  const held = await claimLease(id, 'r13-install-x/tab-other');
  expect(held.ok).toBe(true);
  rpcActor = identities.A_owner.id;
  const result = await reconcileQueueItem(id, REASON);
  expect(result.ok).toBe(false);
  expect(result.disposition).toBe('rejected');
  expect(result.code).toBe('lease-held');
  expect(rpcCalls).toHaveLength(0); // never reached the network
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('failed');
  expect(item.exceptionClass).toBe('stock-denied');
  expect(item.reconcileAttempts ?? 0).toBe(0);
  expect((await auditRowsFor(clientKeyOf(8)))).toHaveLength(0);
  expect(await invoiceCountFor(clientKeyOf(8))).toBe(0);
});

test(meta('R093.RECON.TAMPER-BLOCKED', 'A typed exception whose payload is later edited cannot be reconciled: the integrity check quarantines it payload-tampered before any network call, with zero mutation and zero audit'), async () => {
  ready();
  const id = await queued(9, 'A', 150);
  await syncQueue(); // exception
  const before = (await offlineDB.queue.get(id))!;
  rpcCalls.length = 0;
  const tampered = JSON.parse(JSON.stringify(before.payload)) as QueueItem['payload'];
  const lines = (tampered as { lines: { quantity: number }[] }).lines;
  lines[0].quantity = 1; // local edit after the exception existed
  await offlineDB.queue.update(id, { payload: tampered });
  rpcActor = identities.A_owner.id;
  const result = await reconcileQueueItem(id, REASON);
  expect(result.ok).toBe(false);
  expect(result.disposition).toBe('rejected');
  expect(result.code).toBe('payload-tampered');
  expect(rpcCalls).toHaveLength(0);
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('quarantined');
  expect(item.quarantineReason).toBe('payload-tampered');
  expect(await invoiceCountFor(before.clientKey!)).toBe(0);
  expect((await auditRowsFor(before.clientKey!))).toHaveLength(0);
});

test(meta('R093.EVIDENCE.DURABLE', 'Exception evidence (class, timestamp, detail, hash, provenance) survives a device close/reopen byte-identical; R09.2 quarantine metadata stays untouched'), async () => {
  ready();
  const id = await queued(10, 'A', 150);
  await syncQueue();
  const before = (await offlineDB.queue.get(id))!;
  offlineDB.close();
  await offlineDB.open();
  const after = (await offlineDB.queue.get(id))!;
  expect(after.status).toBe('failed');
  expect(after.exceptionClass).toBe('stock-denied');
  expect(after.exceptionAt).toBe(before.exceptionAt);
  expect(after.exceptionDetails).toBe(before.exceptionDetails);
  expect(after.payloadHash).toBe(before.payloadHash);
  expect(after.payload).toEqual(before.payload);
  expect(after.originUserId).toBe(before.originUserId);
  expect(after.originDeviceId).toBe(before.originDeviceId);
  expect(after.capturedAt).toBe(before.capturedAt);
  expect(after.quarantineReason ?? null).toBeNull();
  expect(after.quarantinedAt ?? null).toBeNull();
  expect(isReconcilable(after)).toBe(true);
});

test(meta('R093.MATRIX.AUTHORITY-NOT-OVERRIDDEN', 'Authority failures (42501) stay authoritative: ordinary failed evidence, NO exception class, NO quota discriminator — never converted into a manager-override surface'), async () => {
  ready();
  // A_cashier is not a member of org B: the server refuses 42501.
  const id = await queued(11, 'B');
  const result = await syncQueue();
  expect(result.failed).toBe(1);
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('failed');
  expect(item.exceptionClass).toBeNull();
  expect(item.lastErrorCode).toBeNull();
  expect(item.quarantineReason ?? null).toBeNull();
  expect(await invoiceCountFor(clientKeyOf(11))).toBe(0);
});

test(meta('R093.RECON.UNAUTHORIZED', 'A non-manager reconciliation is denied server-side (42501) with zero financial mutation, zero audit rows, and the durable exception unchanged'), async () => {
  ready();
  const id = await queued(12, 'A', 150);
  await syncQueue(); // stock-denied exception
  const before = (await offlineDB.queue.get(id))!;
  rpcActor = identities.A_cashier.id; // till role — NOT in the manager tier
  const result = await reconcileQueueItem(id, REASON);
  expect(result.ok).toBe(false);
  expect(result.disposition).toBe('rejected');
  expect(result.code).toBe('42501');
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('failed');
  expect(item.exceptionClass).toBe('stock-denied');
  expect(item.payload).toEqual(before.payload);
  expect(await financialMutationCount(orgs.A.business, before.clientKey!)).toBe(0);
  expect((await auditRowsFor(before.clientKey!))).toHaveLength(0); // no fake decision
});

test(meta('R093.RECON.CROSS-BUSINESS', 'A manager of org B cannot reconcile an org A exception: denied server-side (42501) with zero financial mutation and zero audit rows'), async () => {
  ready();
  const id = await queued(13, 'A', 150);
  await syncQueue(); // org A exception
  rpcActor = identities.B_owner.id; // manager tier — of the WRONG tenant
  const result = await reconcileQueueItem(id, REASON);
  expect(result.ok).toBe(false);
  expect(result.disposition).toBe('rejected');
  expect(result.code).toBe('42501');
  expect(await invoiceCountFor(clientKeyOf(13))).toBe(0);
  expect((await auditRowsFor(clientKeyOf(13)))).toHaveLength(0);
});

test(meta('R093.RECON.INTEGRITY-REFUSED', 'R09.2 integrity quarantines (actor-mismatch, missing-provenance, legacy) never enter Model 4: local refusal with zero mutation, and the server raises 22023 for any integrity class named directly'), async () => {
  ready();
  // actor-mismatch (Case B against an exception-bearing peer is separately
  // exempted, but a REAL actor-mismatch quarantine stays irreconcilable).
  const idMismatch = await queued(14);
  await syncQueue(undefined, { currentUserId: identities.B_cashier.id });
  expect(((await offlineDB.queue.get(idMismatch))!).quarantineReason).toBe('actor-mismatch');
  // missing-provenance (v1-shape row).
  qCashierA();
  const idMissing = (await offlineDB.queue.add({
    sequence: 9901, operationType: 'pos_sale', status: 'pending', businessId: orgs.A.business,
    payload: salePayload(15, 'A'), clientKey: clientKeyOf(15), createdAt: `${DAY}T08:00:00Z`, attemptCount: 0,
  })) as number;
  await syncQueue();
  expect(((await offlineDB.queue.get(idMissing))!).quarantineReason).toBe('missing-provenance');
  // legacy queue lineage.
  const idLegacy = await enqueueQuarantinedLegacy(orgs.A.business, salePayload(16, 'A'), '2026-09-20T07:30:00.000Z');
  rpcCalls.length = 0;
  for (const id of [idMismatch, idMissing, idLegacy]) {
    const result = await reconcileQueueItem(id, REASON);
    expect(result.ok).toBe(false);
    expect(result.disposition).toBe('rejected');
    expect((await offlineDB.queue.get(id))!.status).toBe('quarantined');
  }
  expect(rpcCalls).toHaveLength(0); // all refused client-side
  // Server-side defense for the same classes, probed directly as a manager.
  for (const cls of ['actor-mismatch', 'missing-provenance', 'legacy', 'payload-tampered']) {
    const probe = await db
      .commitAsRole('authenticated', identities.A_owner.id, 'select public.reconcile_offline_queue_item($1::jsonb) data', [
        JSON.stringify({
          business_id: orgs.A.business,
          client_key: key(29900),
          operation_type: 'pos_sale',
          exception_class: cls,
          reason: REASON,
          payload: { business_id: orgs.A.business, client_key: key(29900) },
        }),
      ])
      .then(() => ({ code: null as string | null }))
      .catch((e) => ({ code: (e as { code?: string }).code ?? null }));
    expect(probe.code).toBe('22023');
  }
  expect((await auditRowsFor(key(29900)))).toHaveLength(0);
});

test(meta('R093.RECON.CLOSED-SHIFT-LATE-ARRIVAL', 'Reconciling against a shift that closed meanwhile keeps R08 DEC-08 semantics: the original sale posts unchanged as a late arrival (append-only adjustment), never an error and never a rewritten close'), async () => {
  ready();
  const id = await queued(6, 'A', 150);
  await syncQueue(); // stock-denied
  await db.client.query(
    'update public.inventory_balances set quantity_on_hand=250 where business_id=$1 and product_id=$2 and location_id=$3',
    [orgs.A.business, orgs.A.product, orgs.A.location],
  );
  // The shift closes while the exception waits (trusted state, setup layer).
  await db.client.query("update public.pos_shifts set status='closed', closed_at=now() where id=$1", [orgs.A.shift]);
  rpcActor = identities.A_owner.id;
  const result = await reconcileQueueItem(id, REASON);
  expect(result.ok).toBe(true);
  const ck = clientKeyOf(6);
  expect(await invoiceCountFor(ck)).toBe(1);
  const late = await db.client.query(
    'select * from public.pos_shift_late_adjustments where business_id=$1 and command_key=$2',
    [orgs.A.business, `${ck}:late`],
  );
  expect(late.rows).toHaveLength(1);
  expect(late.rows[0].invoice_id).toBe(result.documentId);
  const audit = await auditRowsFor(ck);
  expect(audit[0].disposition).toBe('replay-accepted');
});

/* ── R10 quota contract under Model 3 + Model 4 (org B isolation) ───────── */

test(meta('R093.EXCEPTION.POLICY-DENIED', 'A replay refused by the R10 quota contract (P0QLT) becomes a durable policy-denied exception: lastErrorCode stays P0QLT, payload preserved, zero financial mutation, never blind-retried'), async () => {
  ready();
  if (!usageSeededB) await seedUsageToLimitB();
  qUser(identities.B_cashier.id, 'b-cashier@r13.test');
  rpcActor = identities.B_cashier.id;
  const id = await queued(17, 'B');
  const before = (await offlineDB.queue.get(id))!;
  const result = await syncQueue();
  expect(result.failed).toBe(1);
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('failed');
  expect(item.exceptionClass).toBe('policy-denied');
  expect(item.lastErrorCode).toBe('P0QLT'); // R10 discriminator unchanged
  expect(item.payload).toEqual(before.payload);
  expect(await invoiceCountFor(before.clientKey!)).toBe(0);
  // Never a transient loop victim.
  rpcCalls.length = 0;
  const again = await syncQueue();
  expect(again.completed).toBe(0);
  expect(again.failed).toBe(0);
  expect(rpcCalls).toHaveLength(0);
  expect(((await offlineDB.queue.get(id))!).exceptionClass).toBe('policy-denied');
});

test(meta('R093.RECON.POLICY-REVALIDATION', 'Reconciling a quota exception while the limit still applies revalidates quota server-side: replay-denied with P0QLT preserved, exception and zero-mutation state unchanged, denial audited'), async () => {
  ready();
  if (!usageSeededB) await seedUsageToLimitB();
  qUser(identities.B_cashier.id, 'b-cashier@r13.test');
  rpcActor = identities.B_cashier.id;
  const id = await queued(18, 'B');
  await syncQueue(); // policy-denied
  const before = (await offlineDB.queue.get(id))!;
  expect(before.exceptionClass).toBe('policy-denied');
  // Manager tier of org B reconciles; the plan limit is unchanged.
  rpcActor = identities.B_owner.id;
  const result = await reconcileQueueItem(id, 'R09.3 synthetic manager decision: plan upgrade requested; retry authorized pending activation.');
  expect(result.ok).toBe(false);
  expect(result.disposition).toBe('replay-denied');
  expect(result.code).toBe('P0QLT'); // fresh server quota validation spoke
  const item = (await offlineDB.queue.get(id))!;
  expect(item.status).toBe('failed');
  expect(item.exceptionClass).toBe('policy-denied');
  expect(item.payload).toEqual(before.payload); // never altered
  expect(item.clientKey).toBe(before.clientKey); // never re-minted
  expect(await invoiceCountFor(before.clientKey!)).toBe(0);
  const audit = await auditRowsFor(before.clientKey!);
  expect(audit).toHaveLength(1);
  expect(audit[0].disposition).toBe('replay-denied');
  expect(audit[0].denial_code).toBe('P0QLT');
  expect(audit[0].exception_class).toBe('policy-denied');
  expect(audit[0].origin_user_id).toBe(identities.B_cashier.id);
  expect(audit[0].reconciled_by).toBe(identities.B_owner.id);
});

/* ── P-D3-FINAL §13.12: transient failures keep the ordinary retry path ─ */

test(meta('R093.EXCEPTION.TRANSIENT-ORDINARY-RETRY', 'A transient/transport failure (no SQLSTATE, no typed business code) keeps the ordinary failure path exactly as R09.2 defines it — status failed, NO exceptionClass, NO lastErrorCode, payload/provenance/client key preserved, zero financial mutation; the production single internal transient retry (same client key) is exercised; and subsequent sync passes keep REPLAYING the item (never classified as a policy exception merely for being offline-originated) until the real post_pos_sale accepts it exactly once under the ORIGINAL client key, with later passes resolving idempotently against the committed document (no second financial mutation)'), async () => {
  ready();
  const id = await queued(40);
  const before = (await offlineDB.queue.get(id))!;
  // Two transport failures cover the production single internal retry
  // (transient error text matches posSaleRpc's retriable-transient pattern).
  transientFailuresRemaining = 2;
  const first = await syncQueue();
  transientFailuresRemaining = 0;
  expect(first.failed).toBe(1);
  expect(rpcCalls.filter((n) => n === 'post_pos_sale')).toHaveLength(2); // production internal retry, same key
  const failedItem = (await offlineDB.queue.get(id))!;
  expect(failedItem.status).toBe('failed');
  expect(failedItem.exceptionClass ?? null).toBeNull(); // transient is never a policy exception
  expect(failedItem.lastErrorCode ?? null).toBeNull(); // the quota discriminator stays clean
  expect(failedItem.quarantineReason ?? null).toBeNull();
  expect(failedItem.payload).toEqual(before.payload);
  expect(failedItem.clientKey).toBe(before.clientKey);
  expect(await financialMutationCount(orgs.A.business, before.clientKey!)).toBe(0);
  expect(await invoiceCountFor(before.clientKey!)).toBe(0);
  // Retry behavior retained: the next pass reaches the server again with the
  // same client key, and the REAL post_pos_sale accepts it. Exactly-once is
  // pinned at the server oracle; the queue item keeps status 'failed' in
  // this suite because its local success decoration reads
  // repos.invoice.findByIdWithLines, which this suite's fixture guard
  // intentionally refuses (the sealed-pair authenticated-readback
  // limitation, filed in R093.SEALED-PAIR.READBACK-INVESTIGATION) — that
  // refusal carries no SQLSTATE, so the classification contract is also
  // verified across the successful-commit passes below.
  const second = await syncQueue();
  expect(rpcCalls.filter((n) => n === 'post_pos_sale')).toHaveLength(3); // replayed, not skipped
  expect(await invoiceCountFor(before.clientKey!)).toBe(1); // committed exactly once, original key
  const afterSecond = (await offlineDB.queue.get(id))!;
  expect(afterSecond.exceptionClass ?? null).toBeNull();
  expect(afterSecond.lastErrorCode ?? null).toBeNull();
  // Third pass: the replay contract stays exactly-once against the committed
  // document (lost-ack shape), still with no classification drift.
  const third = await syncQueue();
  expect(rpcCalls.filter((n) => n === 'post_pos_sale')).toHaveLength(4);
  expect(await invoiceCountFor(before.clientKey!)).toBe(1);
  const afterThird = (await offlineDB.queue.get(id))!;
  expect(afterThird.exceptionClass ?? null).toBeNull();
  expect(afterThird.clientKey).toBe(before.clientKey);
  expect(afterThird.payload).toEqual(before.payload);
  void second;
  void third;
});

/* ── P-D3-FINAL §8: D-4 legacy branch-resolution rider evidence ─────────── */

test(meta('R093.D4.LEGACY-BRANCH-RIDER', 'D-4 rider (shape tolerance, not authority tolerance) at the real posting boundary: a legacy pre-R08 branch-less payload (built by the same capture builder the offline queue uses, with the branch field absent) claiming the caller\'s own open shift resolves the branch server-side from the shift (post_pos_sale coalesce rider, 20260930000001) and commits exactly once under its client key; the identical branch-less shape claiming ANOTHER user\'s same-business shift is denied by server steering (42501, zero financial mutation); and a branch-less claim onto a foreign-business shift is refused as unknown/foreign (22023, zero mutation). Branch-less tolerance never extends authority'), async () => {
  ready();
  const legacyQueue = (n: number) => {
    const q = salePayload(n, 'A'); // the queue capture builder used by the offline path
    delete (q.invoice as Record<string, unknown>).branch_id; // pre-R08 branch-less shape
    return q;
  };
  // Generated Database types only carry RPC names from earlier migrations;
  // post_pos_sale reaches the same (mocked) transport through a narrow cast —
  // the identical convention reconciliation.ts uses for reconcile_offline_queue_item.
  type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: { id?: string } | null; error: { code?: string; message?: string } | null }> };
  const rpcClient = realSupabase as unknown as RpcClient;
  const post = (queuePayload: ReturnType<typeof salePayload>, clientKey: string) =>
    rpcClient.rpc('post_pos_sale', {
      p_payload: buildPosSaleRpcPayload(queuePayload, orgs.A.business, clientKey),
    });

  // (a) Shape tolerance: branch-less + own shift → shift.branch server-side.
  const a = await post(legacyQueue(41), key(21041));
  expect(a.error).toBeNull();
  expect(typeof a.data?.id).toBe('string');
  const inv = await db.client.query('select branch_id, pos_shift_id from public.invoices where business_id=$1 and client_key=$2', [orgs.A.business, key(21041)]);
  expect(inv.rows).toHaveLength(1); // exactly once under the original key
  expect(inv.rows[0].branch_id).toBe(orgs.A.branch); // shift.branch resolved server-side
  expect(inv.rows[0].pos_shift_id).toBe(orgs.A.shift);

  // (b) Not authority tolerance: branch-less + another user's same-business
  //     shift → server steering denies; zero financial mutation.
  const otherShift = (await db.client.query(
    "insert into public.pos_shifts(business_id,cashier_id,cashier_name,opening_cash,status,branch_id) values($1,$2,'R13 other cashier',50000,'open',$3) returning id",
    [orgs.A.business, identities.B_cashier.id, orgs.A.branch],
  )).rows[0];
  const bPayload = legacyQueue(42);
  bPayload.shiftId = otherShift.id as string;
  const b = await post(bPayload, key(21042));
  expect(b.error).not.toBeNull();
  expect(b.error?.code).toBe('42501'); // steering authority denial
  expect(await financialMutationCount(orgs.A.business, key(21042))).toBe(0);
  expect(await invoiceCountFor(key(21042))).toBe(0);

  // (c) Branch-less + foreign-business shift → unknown/foreign shift (22023), zero mutation.
  const cPayload = legacyQueue(43);
  cPayload.shiftId = orgs.B.shift;
  const c = await post(cPayload, key(21043));
  expect(c.error).not.toBeNull();
  expect(c.error?.code).toBe('22023');
  expect(await financialMutationCount(orgs.A.business, key(21043))).toBe(0);
  expect(await invoiceCountFor(key(21043))).toBe(0);
});

/* ── P-D3-FINAL §11: sealed R09.2 pair readback investigation (honest limitation filing) ─ */

test(meta('R093.SEALED-PAIR.READBACK-INVESTIGATION', 'P-D3-FINAL §11 investigation of the two sealed R09.2 acceptance records (R09.QUEUE.ACTOR-BINDING.SAME-USER, R09.QUEUE.REGRESSION.REPLAY-CONTRACT): whether authenticated invoice readback required by requireReadback is genuinely available under the migration-declared schema — probed live against the replayed migration set; not available → both records stay BLOCKED, no grants added, no privileged readback fabricated'), async () => {
  ready();
  // Live probe 1: authenticated table privileges on the two readback tables.
  const priv = await db.client.query(
    "select has_table_privilege('authenticated','public.invoices','SELECT') inv, has_table_privilege('authenticated','public.invoice_lines','SELECT') lines",
  );
  // Live probe 2: every SELECT policy on the two tables, from the catalog.
  const pol = await db.client.query(
    "select tablename, policyname from pg_policies where schemaname='public' and tablename in ('invoices','invoice_lines') and (cmd = 'SELECT' or cmd = 'ALL')",
  );
  throw new Blocked(
    'P-D3-FINAL §11 outcome: the sealed R09.2 pair stays BLOCKED — genuine authenticated invoice readback is NOT available under the migration-declared schema. Live-probed facts: '
    + `has_table_privilege(authenticated,public.invoices,SELECT)=${priv.rows[0].inv}, has_table_privilege(authenticated,public.invoice_lines,SELECT)=${priv.rows[0].lines}; `
    + `SELECT/ALL policies on those tables in pg_policies=${JSON.stringify(pol.rows)} (zero exist anywhere in the 20250101..20261002 migration chain — the only invoice policies are writer insert/update in 20260922000000). `
    + 'requireReadback therefore cannot honestly activate: activating it would require an authenticated SELECT grant plus a member-scoped SELECT RLS policy on public.invoices/public.invoice_lines — a product read-surface/schema decision that P-D3-FINAL §12 (NOT AUTHORIZED) and §14 (STOP-and-report, never opportunistic) place outside this package. No grants were added solely to make records pass; no privileged (fixture-oracle) readback was substituted. The same limitation also guards local success decoration in this suite (repos.invoice.findByIdWithLines refusal), pinned as evidence in R093.EXCEPTION.TRANSIENT-ORDINARY-RETRY. '
    + 'Activation prerequisite (exact): an owner-level decision authorizing member invoice readback migrations (grant select to authenticated plus a business-scoped select policy); the existing requireReadback() gate in tests/release/offline.test.ts then activates both sealed records unchanged. '
    + 'Adjacent-requirement report (§14, documentation only): production reads through InvoiceRepository.findByIdWithLines/IncomeRepository/.from(\'invoices\') currently depend on out-of-band platform privileges not declared in the migration chain; the migration-only deployment profile has no invoice read path for authenticated members.',
  );
});
