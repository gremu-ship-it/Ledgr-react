/**
 * R09.4 harness bundle entry. Runs INSIDE the real browser against real
 * IndexedDB / real CacheStorage / real BroadcastChannel semantics, importing
 * the actual shipped offline/cache modules. Only two seams are mocked:
 *  - '@/lib/supabase'          → origin-stubbed real supabase-js client
 *  - '@/store/useAppStore'     → scenario-controlled hydrated actor
 *  - drawer contexts           → scenario-controlled role/online (drawer only)
 * Everything else — db, queueApi, provenance, payloadIntegrity, lease,
 * exceptions, syncEngine, reconciliation, cacheWipe, OfflineQueueDrawer — is
 * the production code.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { offlineDB, type QueueItem } from '@/offline/db';
import { enqueue, getPendingItems, getQueueForBusiness, removeQueueItem } from '@/offline/queueApi';
import { replayViolation, hasTrustworthyProvenance, QUEUE_PAYLOAD_VERSION } from '@/offline/provenance';
import { hashQueuePayload, verifyPayloadIntegrity, canonicalPayloadJson } from '@/offline/payloadIntegrity';
import { claimLease, renewLease, releaseLease, verifyLeaseOwnership, isLeaseExpired, LEASE_TTL_MS } from '@/offline/lease';
import { syncQueue } from '@/offline/syncEngine';
import { isReconcilable, reconcileQueueItem, getExceptionItems } from '@/offline/reconciliation';
import {
  wipeIdentityTransitionCaches, verifyBusinessCacheEmptiness,
  WORKBOX_API_CACHE_NAME, RQ_PERSIST_DB_NAME, OFFLINE_QUEUE_DB_NAME, LEGACY_POS_QUEUE_KEY,
} from '@/lib/cacheWipe';
import { r094SetCurrentUser, r094SetCurrentBusiness } from '@tests/mock-appstore';
import { OfflineQueueDrawer } from '@/components/layout/OfflineQueueDrawer';
import type { PosSaleQueuePayload } from '@/offline/payloads';

declare global {
  interface Window { r094: Record<string, unknown>; R094_STUB_ORIGIN?: string }
}

/** Synthetic POS queue payload in EXACTLY the shipped PosSaleQueuePayload shape. */
function queuePayloadFor(n: number, org: { business: string; branch: string; product: string; shift: string; terminal: string }, qty = 1, unitPrice = 1500): PosSaleQueuePayload {
  const total = qty * unitPrice;
  return {
    invoice: {
      business_id: org.business, invoice_number: `R094-LEGACY-${n}`, invoice_type: 'sales', status: 'paid',
      contact_id: null, issue_date: '2026-09-23', due_date: '2026-09-23',
      currency: 'MWK', exchange_rate: 1, original_currency: 'MWK', original_amount: total,
      functional_currency: 'MWK', functional_amount: total, subtotal: total,
      discount_amount: 0, discount_percent: 0, taxable_amount: total, vat_amount: 0, wht_amount: 0,
      total_amount: total, amount_paid: total, branch_id: org.branch,
    } as PosSaleQueuePayload['invoice'],
    lines: [{
      line_number: 1, description: 'R09.4 synthetic stock item', quantity: qty,
      unit_price: unitPrice, discount_percent: 0, discount_amount: 0, tax_code: 'none',
      tax_rate: 0, tax_amount: 0, line_total: total, product_id: org.product,
    }] as PosSaleQueuePayload['lines'],
    payments: [{
      amount: total, payment_method: 'cash', currency: 'MWK', exchange_rate: 1,
      original_amount: total, original_currency: 'MWK', functional_amount: total,
      payment_date: '2026-09-23',
    }] as PosSaleQueuePayload['payments'],
    customer: { name: 'R09.4 synthetic customer' },
    shiftId: org.shift, terminalId: org.terminal,
    cashSales: total, otherSales: 0,
    receiptNumber: `R094-${n}`, cashierId: null, cashierName: 'R09.4 cashier',
  } as PosSaleQueuePayload;
}

async function resetAll(): Promise<void> {
  await offlineDB.queue.clear();
  try { const cols = indexedDB.databases ? await indexedDB.databases() : []; } catch { /* enumeration optional */ }
  if ('caches' in window) for (const name of await caches.keys()) await caches.delete(name);
  sessionStorage.clear();
  // PRESERVE localStorage wholesale here (device/install id + legacy POS queue
  // live there); tests remove only what they must.
}

/** Read every store entry of a Dexie-backed IDB by raw IndexedDB (schema-agnostic enumeration for evidence). */
async function idbSnapshot(dbName: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const db = await new Promise<IDBDatabase | null>((res) => {
    const r = indexedDB.open(dbName); r.onsuccess = () => { const d = r.result; res(d); }; r.onerror = () => res(null);
    r.onupgradeneeded = () => r.result; // never triggered for existing
  }).catch(() => null);
  if (!db) { out.__missing__ = 1; return out; }
  for (const s of Array.from(db.objectStoreNames)) {
    out[s] = await new Promise((res) => { const t = db.transaction(s, 'readonly'); const c = t.objectStore(s).count(); c.onsuccess = () => res(c.result as number); c.onerror = () => res(-1); });
    db.transaction(s, 'readonly');
  }
  db.close();
  return out;
}

/**
 * Enumerate the persisted React-Query cache blob (single-row 'rq-state'):
 * returns each dehydrated query's key and a compact data-marker string so
 * confidentiality records can assert which business markers survive.
 */
async function rqCacheEntries(): Promise<{ blobFound: boolean; queries: Array<{ queryKey: unknown; dataJson: string }> }> {
  const db = await new Promise<IDBDatabase | null>((res) => { const r = indexedDB.open(RQ_PERSIST_DB_NAME); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }).catch(() => null);
  if (!db || !db.objectStoreNames.contains('cache')) return { blobFound: false, queries: [] };
  const row: any = await new Promise((res) => {
    const g = db.transaction('cache', 'readonly').objectStore('cache').get('rq-state');
    g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null);
  });
  if (!row?.client) return { blobFound: false, queries: [] };
  try {
    const parsed = JSON.parse(row.client as string);
    const queries: any[] = parsed?.clientState?.queries ?? [];
    return {
      blobFound: true,
      queries: queries.map((q: any) => ({ queryKey: q?.queryKey, dataJson: JSON.stringify(q?.state?.data ?? null) })),
    };
  } catch {
    return { blobFound: true, queries: [{ queryKey: null, dataJson: '<unparseable>' }] };
  }
}

/** Warm the real persisted React-Query cache via the app's own persister shape. */
async function warmRqPersist(businessId: string, marker: string): Promise<void> {
  const { persistQueryClientSave } = await import('@tanstack/react-query-persist-client');
  const { QueryClient } = await import('@tanstack/react-query');
  const { createIDBPersister } = await import('@/lib/queryPersister');
  const qc = new QueryClient();
  qc.setQueryData(['products', businessId], [{ id: marker, name: `R09.4 marker ${marker}` }]);
  qc.setQueryData(['invoices', businessId], [{ id: marker }]);
  await persistQueryClientSave({
    queryClient: qc,
    persister: createIDBPersister(),
    buster: `r094-${marker}`,
    dehydrateOptions: { shouldDehydrateQuery: () => true },
  });
}

/** Warm the workbox runtime API cache with a real CacheStorage write (labelled harness-assisted). */
async function warmApiCache(marker: string): Promise<void> {
  const c = await caches.open(WORKBOX_API_CACHE_NAME);
  await c.put(new Request(`/rest/v1/products?marker=${marker}`), new Response(JSON.stringify([{ id: marker }]), { headers: { 'content-type': 'application/json' } }));
}

async function storageSnapshot(): Promise<Record<string, unknown>> {
  return {
    queueDb: await idbSnapshot(OFFLINE_QUEUE_DB_NAME),
    rqDb: await rqCacheEntries(),
    caches: ('caches' in window) ? await caches.keys() : [],
    sessionKeys: Object.keys(sessionStorage),
    localKeys: Object.keys(localStorage),
    legacyQueuePresent: localStorage.getItem(LEGACY_POS_QUEUE_KEY) !== null,
  };
}

async function setSessionMarker(key: string, value: string): Promise<void> { sessionStorage.setItem(key, value); }
function setLegacyQueueMarker(value: unknown[]): void { localStorage.setItem(LEGACY_POS_QUEUE_KEY, JSON.stringify(value)); }

const r094: Record<string, unknown> = {
  // actor / org scenario
  setCurrentUser: r094SetCurrentUser,
  setCurrentBusiness: r094SetCurrentBusiness,
  queuePayloadFor,
  // queue api (production code)
  enqueuePosSale: async (businessId: string, payload: PosSaleQueuePayload) => enqueue('pos_sale', businessId, payload),
  pending: getPendingItems,
  queueForBusiness: getQueueForBusiness,
  removeItem: removeQueueItem,
  getItem: async (localId: number) => offlineDB.queue.get(localId),
  deleteItem: async (localId: number) => offlineDB.queue.delete(localId),
  updateItem: async (localId: number, changes: Partial<QueueItem>) => offlineDB.queue.update(localId, changes),
  queueCount: async () => offlineDB.queue.count(),
  // provenance / integrity (production code)
  replayViolation,
  hasTrustworthyProvenance,
  payloadVersionNow: QUEUE_PAYLOAD_VERSION,
  hashQueuePayload,
  verifyPayloadIntegrity,
  canonicalPayloadJson,
  // lease (production code)
  claimLease, renewLease, releaseLease, verifyLeaseOwnership, isLeaseExpired, LEASE_TTL_MS,
  // sync engine (production code)
  syncQueue,
  // reconciliation (production code)
  isReconcilable, reconcileQueueItem, getExceptionItems,
  // cache wipe (production code)
  wipeIdentityTransitionCaches,
  verifyBusinessCacheEmptiness,
  WORKBOX_API_CACHE_NAME, RQ_PERSIST_DB_NAME, OFFLINE_QUEUE_DB_NAME, LEGACY_POS_QUEUE_KEY,
  // fixture helpers (labelled harness-assisted where used)
  resetAll,
  warmRqPersist, warmApiCache, rqCacheEntries, storageSnapshot, setSessionMarker, setLegacyQueueMarker,
  // drawer (production component, scenario-context role)
  mountDrawer: (selector: string) => {
    const el = document.querySelector(selector) as HTMLElement;
    const root = createRoot(el);
    root.render(React.createElement(OfflineQueueDrawer));
    return true;
  },
};

window.r094 = r094;
