// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeAll, afterAll, beforeEach, expect, vi } from 'vitest';
import { offlineDB } from '@/offline/db';
import { enqueue, recoverStaleSyncClaims, STALE_SYNC_CLAIM_MS } from '@/offline/queueApi';
import Dexie from 'dexie';
import { wipeIdentityTransitionCaches, verifyBusinessCacheEmptiness, WORKBOX_API_CACHE_NAME, LEGACY_POS_QUEUE_KEY, RQ_PERSIST_DB_NAME } from '@/lib/cacheWipe';
import { MemoryCacheStorage } from '@/lib/cacheWipeTestAdapters';
import { createIDBPersister } from '@/lib/queryPersister';
import { syncQueue } from '@/offline/syncEngine';
import { buildPosSaleQueuePayload } from '@/services/posService';
import { realSupabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, key, expected } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test=evidenceSuite('offline-indexeddb-postgres');
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs:Awaited<ReturnType<typeof seedFixture>>;
let setupError='';
let simulateFailure=false;
beforeAll(async()=>{
  try { db=await createDatabaseFixture(); orgs=await seedFixture(db.client); }
  catch(e){setupError=safeError(e);}
});
beforeEach(async()=>{
  await offlineDB.open(); await offlineDB.queue.clear();
  simulateFailure=false; vi.restoreAllMocks();
  vi.spyOn(repos.invoice,'findByIdWithLines').mockImplementation(async(id:string)=>{
    const invoice=(await db.asRole('authenticated',identities.A_cashier.id,'select * from public.invoices where id=$1',[id])).rows[0];
    const lines=(await db.asRole('authenticated',identities.A_cashier.id,'select * from public.invoice_lines where invoice_id=$1',[id])).rows;
    return {invoice,lines};
  });
  vi.spyOn(realSupabase,'rpc').mockImplementation((async(name:string,args:Record<string,unknown>)=>{
    if(!db||!orgs) throw new Error('R13 fixture unavailable');
    if(simulateFailure) return {data:null,error:{code:'42501',message:'R13 synthetic denied operation'}};
    if(name!=='post_pos_sale') throw new Error('Unexpected RPC; no network fallback permitted');
    try {
      const result=await db.commitAsRole('authenticated',identities.A_cashier.id,'select public.post_pos_sale($1::jsonb) data',[JSON.stringify(args.p_payload)]);
      return {data:result.rows[0].data,error:null};
    } catch(e) {return {data:null,error:{code:(e as {code?:string}).code,message:'R13 database operation rejected'}};}
  }) as never);
});
afterAll(async()=>{await offlineDB.delete(); vi.restoreAllMocks(); if(db) await db.cleanup();});
const meta=(id:string,expectation:string)=>({id,expected:expectation,source:'src/offline/syncEngine.ts',remediation:'R09',layer:'fake IndexedDB + real syncEngine/POS RPC + disposable PostgreSQL; mocked transport, not browser/gateway'});
function ready(){if(!orgs)throw new Blocked(`Disposable database fixture unavailable: ${setupError}`);}
async function requireReadback(){
  const r=await db.client.query("select has_table_privilege('authenticated','public.invoices','SELECT') and has_table_privilege('authenticated','public.invoice_lines','SELECT') ok");
  if(!r.rows[0].ok) throw new Blocked('Post-sale caller readback lacks effective invoice/line SELECT grants in migration-only profile. No fake success or privileged read substituted.');
}
function payload(n:number){
  const p=buildPosSaleQueuePayload({businessId:orgs.A.business,shiftId:orgs.A.shift,cashierName:'R13 cashier',
    customerName:'R13 synthetic customer',items:[{product_id:orgs.A.product,name:'R13 item',quantity:1,unit_price:1500,line_total:1500}],
    payments:[{payment_method:'cash',amount:1500,tendered:1500}],totalPaid:1500,changeGiven:0}, {receiptNumber:`R13-OFF-${n}`});
  p.invoice.contact_id=orgs.A.customer;p.invoice.branch_id=orgs.A.branch;p.invoice.issue_date=DAY;
  return p;
}
async function queued(n:number){
  const id=await enqueue('pos_sale',orgs.A.business,payload(n));
  await offlineDB.queue.update(id,{clientKey:key(8000+n),createdAt:`${DAY}T08:00:00Z`,localUpdatedAt:`${DAY}T08:00:00Z`});
  return id;
}
test(meta('OFFLINE.REOPEN','Multiple pending sales survive close/reopen with IDs, timestamps, branch and keys; synchronize exactly once'),async()=>{
  ready();const ids=[await queued(1),await queued(2)];const before=await offlineDB.queue.toArray();
  offlineDB.close();await offlineDB.open();expect(await offlineDB.queue.toArray()).toEqual(before);
  await requireReadback();
  const result=await syncQueue();expect(result).toMatchObject({total:2,completed:2,failed:0});
  const rows=await offlineDB.queue.toArray();expect(rows.every(x=>x.status==='synced')).toBe(true);
  expect(rows.map(x=>x.clientKey)).toEqual(before.map(x=>x.clientKey));
  // Simulate lost local acknowledgements; replay the same durable identifiers.
  for(const id of ids) await offlineDB.queue.update(id,{status:'pending'});
  expect(await syncQueue()).toMatchObject({completed:2,failed:0});
  const r=await db.client.query('select count(*)::int n from public.invoices where business_id=$1 and client_key=any($2::uuid[])',[orgs.A.business,before.map(x=>x.clientKey)]);
  expect(r.rows[0].n).toBe(2);
  const payments=await db.client.query('select count(*)::int n from public.invoice_payments where invoice_id=any($1::uuid[])',[rows.map(x=>x.resolvedServerId)]);
  expect(payments.rows[0].n).toBe(2);
});
test(meta('OFFLINE.FAIL-PRESERVE','Denied sync preserves sole local record, payload, branch, timestamps and client key'),async()=>{
  ready();const id=await queued(3);const before=await offlineDB.queue.get(id);simulateFailure=true;
  expect(await syncQueue()).toMatchObject({completed:0,failed:1});
  const after=await offlineDB.queue.get(id);expect(after).toMatchObject({status:'failed',attemptCount:1,clientKey:before?.clientKey,createdAt:before?.createdAt});
  expect(after?.payload).toEqual(before?.payload);
  offlineDB.close();await offlineDB.open();expect(await offlineDB.queue.get(id)).toEqual(after);
  // Retry-success is independently gated below; failure preservation is not a claim of successful replay.
});
test(meta('OFFLINE.STALE-CLAIM','Stale syncing item returns to pending without losing metadata'),async()=>{
  ready();const id=await queued(4);
  await offlineDB.queue.update(id,{status:'syncing',lastAttemptAt:new Date(Date.now()-STALE_SYNC_CLAIM_MS-1000).toISOString()});
  expect(await recoverStaleSyncClaims()).toBe(1);expect((await offlineDB.queue.get(id))?.clientKey).toBe(key(8004));
});
test(meta('OFFLINE.CROSS-TENANT-PRESERVE','A session cannot sync B sale; B pending/failed payload is retained'),async()=>{
  ready();const p=payload(5);p.invoice.business_id=orgs.B.business;p.invoice.contact_id=orgs.B.customer;
  const id=await enqueue('pos_sale',orgs.B.business,p);const before=await offlineDB.queue.get(id);
  expect(await syncQueue()).toMatchObject({completed:0,failed:1});expect((await offlineDB.queue.get(id))?.payload).toEqual(before?.payload);
});
test(meta('OFFLINE.STATES','Reusable pending/failed/synced/conflicting timestamp fixtures preserve payloads'),async()=>{
  ready();const ids=[await queued(6),await queued(7),await queued(8)];
  await offlineDB.queue.update(ids[1],{status:'failed',attemptCount:2,lastError:'R13 synthetic conflict',localUpdatedAt:'2026-09-20T08:00:00Z'});
  await offlineDB.queue.update(ids[2],{status:'synced',resolvedServerId:key(9008)});
  offlineDB.close();await offlineDB.open();expect((await offlineDB.queue.toArray()).map(x=>x.status)).toEqual(['pending','failed','synced']);
  expect(expected.sale).toBe(1500);
});
for(const [id,reason] of [
  ['OFFLINE.BROWSER','No browser/service-worker runner; fake IndexedDB close/reopen is not browser process shutdown/cache proof.'],
  ['OFFLINE.ACTOR-BINDING','Queue has businessId but no durable originating-user/device contract; cannot assert current-user queue isolation by inventing fields.'],
  ['OFFLINE.CONFLICT','Timestamp fixtures exist; no approved conflict-resolution contract or generic queue update operation.'],
  ['OFFLINE.MULTITAB','Cross-tab concurrency/lease evidence needs approved client-identity contract and browser workers.'],
])test(meta(id,reason),()=>{throw new Blocked(reason);});


test(meta('OFFLINE.PRESERVE','Pending synthetic sale survives close/reopen with exact identifiers/timestamps/branch/payload'),async()=>{
  ready();const id=await queued(20);const before=await offlineDB.queue.get(id);
  offlineDB.close();await offlineDB.open();expect(await offlineDB.queue.get(id)).toEqual(before);
});
test(meta('OFFLINE.RETRY','Failed synthetic sale retries with same key and exactly one server invoice'),async()=>{
  ready();await requireReadback();const id=await queued(21);simulateFailure=true;
  await syncQueue();simulateFailure=false;expect(await syncQueue()).toMatchObject({completed:1,failed:0});
  const row=await offlineDB.queue.get(id);
  expect((await db.client.query('select count(*)::int n from public.invoices where business_id=$1 and client_key=$2',[orgs.A.business,row?.clientKey])).rows[0].n).toBe(1);
});

/* R09.1 cache confidentiality (D-5 wipe model) — additive evidence namespace R09.CACHE.* */

const wipeMeta=(id:string,expectation:string)=>({id,expected:expectation,source:'src/lib/cacheWipe.ts + public/sw-events.js + main.tsx/useAuthListener.ts hooks',remediation:'R09.1',layer:'fake IndexedDB + in-memory CacheStorage stub + jsdom web storage; verified-emptiness loop, no arbitrary timeout',productionVerificationRequired:false});
const countRQEntries=async()=>{const d=new Dexie(RQ_PERSIST_DB_NAME);await d.open();const n=d.tables.length===0?0:await d.table('cache').count();d.close();return n;};
const seedRQEntry=async()=>{const persister=createIDBPersister();await persister.persistClient({timestamp:Date.now(),buster:'r13-test',clientState:{mutations:[],queries:[{queryKey:['invoices','r13-business'],queryHash:'["invoices","r13-business"]',state:{status:'success',data:[{id:'r13-invoice',total:1500}]}}]}} as never);};

test(wipeMeta('R09.CACHE.WIPE-VERIFIED-EMPTY','Logout wipe removes persisted RQ DB contents and Workbox API cache; verified empty by read-back, not assumed'),async()=>{
  const stub=new MemoryCacheStorage().install(globalThis as unknown as Record<string,unknown>);
  stub.seed(WORKBOX_API_CACHE_NAME,['GET /rest/v1/invoices 200 r13-tenant-a']);
  await seedRQEntry();
  expect(await countRQEntries()).toBeGreaterThan(0);
  const result=await wipeIdentityTransitionCaches('signed-out');
  expect(result.rqEntriesRemaining).toBe(0);
  expect(result.apiCacheStillPresent).toBe(false);
  expect(result.verifiedEmpty).toBe(true);
  const probe=await verifyBusinessCacheEmptiness();
  expect(probe.rqEntries).toBe(0);
  expect(probe.apiCachePresent).toBe(false);
});

test(wipeMeta('R09.CACHE.EVIDENCE-PRESERVED','Offline financial queue (ledgr-offline) and legacy POS queue (ledgr_pos_offline_queue) survive the wipe byte-identical'),async()=>{
  new MemoryCacheStorage().install(globalThis as unknown as Record<string,unknown>);
  const legacy=JSON.stringify([{receiptNumber:'R13-LEGACY-1',payload:{total:1500},queuedAt:'2026-09-20T08:00:00Z'}]);
  window.localStorage.setItem(LEGACY_POS_QUEUE_KEY,legacy);
  const queueRow={sequence:900,operationType:'pos_sale',status:'pending',businessId:'r13-business',payload:{invoice:{},lines:[]},clientKey:'r13-wipe-survival',createdAt:'2026-09-22T08:00:00Z',attemptCount:0} as never;
  const id=await offlineDB.queue.add(queueRow);
  const result=await wipeIdentityTransitionCaches('signed-out');
  expect(result.storageKeysRemoved).not.toContain(LEGACY_POS_QUEUE_KEY);
  expect(window.localStorage.getItem(LEGACY_POS_QUEUE_KEY)).toBe(legacy);
  const rows=await offlineDB.queue.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0].localId).toBe(id);
});

test(wipeMeta('R09.CACHE.REPEAT-AND-EMPTY-SAFE','Repeated logout wipes are idempotent; wipe with no caches succeeds safely'),async()=>{
  new MemoryCacheStorage().install(globalThis as unknown as Record<string,unknown>);
  await seedRQEntry();
  const first=await wipeIdentityTransitionCaches('signed-out');
  const second=await wipeIdentityTransitionCaches('signed-out');
  expect(first.verifiedEmpty).toBe(true);expect(second.verifiedEmpty).toBe(true);
  expect(second.storageKeysRemoved).toEqual([]);
  window.sessionStorage.clear();
  const pristine=new MemoryCacheStorage().install(globalThis as unknown as Record<string,unknown>);
  expect(pristine.keysOf(WORKBOX_API_CACHE_NAME)).toEqual([]);
  const empty=await wipeIdentityTransitionCaches('signed-out');
  expect(empty.verifiedEmpty).toBe(true);expect(empty.apiCacheStillPresent).toBe(false);
});

test(wipeMeta('R09.CACHE.USER-SWITCH-ISOLATION','After a same-tab user switch wipe, the next user cannot read the prior user’s cached business data from any addressed layer'),async()=>{
  const stub=new MemoryCacheStorage().install(globalThis as unknown as Record<string,unknown>);
  stub.seed(WORKBOX_API_CACHE_NAME,['GET /rest/v1/journal_entries 200 user-a-data']);
  await seedRQEntry();
  window.sessionStorage.setItem('ledgr_draft_invoice-form_r13-biz-a',JSON.stringify({total:1500}));
  await wipeIdentityTransitionCaches('user-switch');
  // User B perspective: every surface the A session could have left must be empty.
  const probe=await verifyBusinessCacheEmptiness();
  expect(probe.rqEntries).toBe(0);expect(probe.apiCachePresent).toBe(false);
  expect(window.sessionStorage.getItem('ledgr_draft_invoice-form_r13-biz-a')).toBeNull();
});

test(wipeMeta('R09.CACHE.REPOPULATION-REENFORCED','In-flight SW repopulation race: a late cache.put after delete is re-defeated until the cache verifies empty'),async()=>{
  const stub=new MemoryCacheStorage().install(globalThis as unknown as Record<string,unknown>);
  stub.seed(WORKBOX_API_CACHE_NAME,['GET /rest/v1/invoices 200 pre-logout']);
  stub.scheduleRepopulate(WORKBOX_API_CACHE_NAME,['GET /rest/v1/invoices 200 late-1']);
  stub.scheduleRepopulate(WORKBOX_API_CACHE_NAME,['GET /rest/v1/invoices 200 late-2']);
  const result=await wipeIdentityTransitionCaches('signed-out');
  expect(result.apiCacheDeleteAttempts).toBeGreaterThanOrEqual(3);
  expect(result.apiCacheStillPresent).toBe(false);
  expect(stub.keysOf(WORKBOX_API_CACHE_NAME)).toEqual([]);
});

test(wipeMeta('R09.CACHE.NO-WILDCARD','Cache removal is per-key/per-store explicit: unrelated ledgr_* preference keys and preserved evidence are never enumerated by any wildcard'),async()=>{
  new MemoryCacheStorage().install(globalThis as unknown as Record<string,unknown>);
  window.localStorage.setItem('ledgr-mobile-dashboard-preferences','{"quickActions":["/invoices/new"]}');
  window.localStorage.setItem('ledgr_cookie_consent','accepted');
  window.localStorage.setItem(LEGACY_POS_QUEUE_KEY,'[]');
  window.sessionStorage.setItem('ledgr_draft_expense-form_r13-biz','{"amount":100}');
  const result=await wipeIdentityTransitionCaches('signed-out');
  expect(window.localStorage.getItem('ledgr-mobile-dashboard-preferences')).toBe('{"quickActions":["/invoices/new"]}');
  expect(window.localStorage.getItem('ledgr_cookie_consent')).toBe('accepted');
  expect(window.localStorage.getItem(LEGACY_POS_QUEUE_KEY)).toBe('[]');
  expect(result.storageKeysRemoved).toEqual(['ledgr_draft_expense-form_r13-biz']);
  for (const removed of result.storageKeysRemoved) expect(removed).not.toBe(LEGACY_POS_QUEUE_KEY);
});

