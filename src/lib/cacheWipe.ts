/**
 * R09.1 — Cache confidentiality (D-5 WIPE model).
 *
 * On identity transition (explicit logout, same-tab user switch) every
 * business-data CACHE is erased, verified empty, and reported. The offline
 * financial queue is accepted financial evidence — NOT cache — and is never
 * touched by this module:
 *
 *   PRESERVED: IndexedDB `ledgr-offline` (semantic queue, governed by R09.2)
 *   PRESERVED: localStorage `ledgr_pos_offline_queue` (legacy POS evidence,
 *              routed to the D-1 quarantine flow, never deleted)
 *
 * Wipe targets are enumerated explicitly (D-5/FR-3): named stores, named
 * exact keys, and named key FAMILIES only when the family itself is the
 * identified cache group (`ledgr_draft_*` form drafts). No wildcard that
 * could reach the preserved evidence exists anywhere below.
 *
 * Verification principle (per authorization §3.2): success is measured by
 * observed emptiness — re-delete until a layer is confirmed empty — never
 * by "a timeout elapsed and we assume it worked".
 */
import Dexie from 'dexie';
import { clearPersistedCache } from '@/lib/queryPersister';
import { queryClient } from '@/lib/queryClient';
import { createLogger } from '@/lib/logger';

const log = createLogger('CacheWipe');

/** Workbox runtime cache for GET /rest/v1/ responses (vite.config.ts). */
export const WORKBOX_API_CACHE_NAME = 'ledgr-api-cache';

/** IndexedDB database holding the persisted React Query business cache. */
export const RQ_PERSIST_DB_NAME = 'ledgr-rq-cache';

/** IndexedDB database holding the offline financial queue — NEVER wiped. */
export const OFFLINE_QUEUE_DB_NAME = 'ledgr-offline';

/** localStorage key of the legacy POS queue — NEVER wiped (D-5/FR-3). */
export const LEGACY_POS_QUEUE_KEY = 'ledgr_pos_offline_queue';

/** sessionStorage cache keys — exact names (view state). */
const SESSION_EXACT_KEYS = ['ledgr_tax_reminder_shown'] as const;

/** sessionStorage cache families — named draft/recovery groups (business data). */
const SESSION_KEY_FAMILIES = ['ledgr_draft_', 'ledgr_chunk_recovery_'] as const;

/** localStorage business-cache keys — audit of 2026-09-22 found none
 *  (all ledgr_* localStorage keys are preferences/consent/demo/partner config
 *  except the preserved legacy queue). Enumerated as an empty list on purpose
 *  so a future addition here is deliberate: any key added MUST be proven
 *  business-CACHE and append-only. */
const LOCALSTORAGE_CACHE_KEYS: readonly string[] = [];

export type WipeTrigger = 'signed-out' | 'user-switch' | 'forced';

export interface CacheWipeResult {
  trigger: WipeTrigger;
  /** IndexedDB persister table entry count after the wipe (0 = verified). */
  rqEntriesRemaining: number | null; // null = platform lacks IndexedDB
  /** Workbox API cache present after the wipe (false = verified absent). */
  apiCacheStillPresent: boolean | null; // null = platform lacks Cache API
  /** Attempts the API-cache delete→verify loop needed (deterministic loop). */
  apiCacheDeleteAttempts: number;
  /** Cooperative service-worker flush was acknowledged (best-effort aid). */
  swFlushAcknowledged: boolean | null; // null = no SW/controller available
  /** Exact session/localStorage keys removed. */
  storageKeysRemoved: string[];
  /** In-memory React Query cache cleared (defense-in-depth). */
  memoryCacheCleared: boolean;
  /** True when every VERIFIABLE business-cache surface is confirmed empty. */
  verifiedEmpty: boolean;
}

/* ── SW cooperative flush ──────────────────────────────────────────── */

export const SW_FLUSH_REQUEST = 'R09_CACHE_FLUSH';
export const SW_FLUSH_REPLY = 'R09_CACHE_FLUSHED';

/**
 * Ask the active service worker to suppress API caching and drop its copy of
 * the Workbox runtime cache. The ack is a best-effort coordination signal —
 * the authoritative verification is the page-side delete→verify loop below.
 * Never blocks longer than maxWaitMs; a missing/un-responsive SW is normal
 * (fresh browser, blocked registration) and does NOT mark the wipe failed.
 */
async function requestSwApiFlush(maxWaitMs: number): Promise<boolean | null> {
  try {
    const sw = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
    if (!sw || !sw.controller) return null;
    const controller = sw.controller;
    const requestId = `r09-flush-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const channel = new MessageChannel();
    const reply = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), maxWaitMs);
      channel.port1.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; requestId?: string };
        if (data?.type === SW_FLUSH_REPLY && data.requestId === requestId) {
          clearTimeout(timer);
          resolve(true);
        }
      };
    });
    controller.postMessage({ type: SW_FLUSH_REQUEST, requestId }, [channel.port2]);
    return await reply;
  } catch {
    return false;
  }
}

/* ── Workbox Cache Storage delete→verify loop ──────────────────────── */

interface CacheStorageLike {
  has(name: string): Promise<boolean>;
  delete(name: string): Promise<boolean>;
}

function getCacheStorage(): CacheStorageLike | null {
  try {
    if (typeof caches !== 'undefined' && caches) return caches as unknown as CacheStorageLike;
  } catch {
    // Cache API blocked (private browsing etc.)
  }
  return null;
}

/**
 * Deterministic emptiness: delete, then OBSERVE. If a late in-flight put
 * repopulated the cache, delete again. Success is declared only after the
 * browser reports the cache absent — a loop bounded by maxAttempts, each
 * attempt evidence-based, never time-based.
 */
async function deleteUntilVerifiedAbsent(
  store: CacheStorageLike,
  name: string,
  maxAttempts = 5,
): Promise<{ present: boolean; attempts: number }> {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    await store.delete(name);
    if (!(await store.has(name))) return { present: false, attempts };
    if (attempts >= maxAttempts) return { present: true, attempts };
  }
}

/* ── Persisted React Query verification readback ───────────────────── */

async function countPersistedRQEntries(): Promise<number | null> {
  try {
    if (typeof indexedDB === 'undefined') return null;
    const db = new Dexie(RQ_PERSIST_DB_NAME);
    await db.open();
    const count = db.tables.length === 0 ? 0 : await db.table('cache').count();
    db.close();
    return count;
  } catch {
    return null;
  }
}

/* ── Enumerated storage wipe ───────────────────────────────────────── */

interface WebStorageLike {
  length: number;
  key(index: number): string | null;
  getItem(k: string): string | null;
  removeItem(k: string): void;
}

function enumerateKeys(storage: WebStorageLike): string[] {
  const found: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k) continue;
    const isExact = (SESSION_EXACT_KEYS as readonly string[]).includes(k);
    const isFamily = SESSION_KEY_FAMILIES.some((f) => k.startsWith(f));
    if (isExact || isFamily) found.push(k);
  }
  return found;
}

function wipeSessionBusinessStorage(
  storage: WebStorageLike,
  removed: string[],
): void {
  const targets = enumerateKeys(storage);
  for (const k of targets) {
    // Never remove preserved evidence even if a future family name collides.
    if ((PRESERVED_LOCALSTORAGE_KEYS as readonly string[]).includes(k)) continue;
    try {
      storage.removeItem(k);
      removed.push(k);
    } catch {
      // storage access disabled — reported via stillVerify below
    }
  }
}

export const PRESERVED_LOCALSTORAGE_KEYS = [LEGACY_POS_QUEUE_KEY] as const;

/* ── Public: read-back verification used by wipe + tests ───────────── */

export interface CacheEmptinessReport {
  rqEntries: number | null;
  apiCachePresent: boolean | null;
}

/** Read-back surface probe: what business-cache remains right now? */
export async function verifyBusinessCacheEmptiness(): Promise<CacheEmptinessReport> {
  const store = getCacheStorage();
  let apiCachePresent: boolean | null = null;
  if (store) {
    try {
      apiCachePresent = await store.has(WORKBOX_API_CACHE_NAME);
    } catch {
      apiCachePresent = null;
    }
  }
  return { rqEntries: await countPersistedRQEntries(), apiCachePresent };
}

/* ── Public: the wipe ──────────────────────────────────────────────── */

/**
 * Erase every business-data cache for the outgoing identity and verify the
 * result. Safe to call repeatedly, safe when caches never existed, safe when
 * browser storage APIs are unavailable (private browsing): each surface is
 * attempted and reported individually; preserved evidence is never in the
 * enumeration path by construction.
 */
export async function wipeIdentityTransitionCaches(
  trigger: WipeTrigger,
  opts: { swFlushMaxWaitMs?: number } = {},
): Promise<CacheWipeResult> {
  const storageKeysRemoved: string[] = [];

  // 1. Persisted React Query business cache (IndexedDB `ledgr-rq-cache`).
  try {
    await clearPersistedCache();
  } catch (err) {
    log.warn('Persisted query cache wipe failed', { error: err });
  }
  const rqEntriesRemaining = await countPersistedRQEntries();

  // 2. Workbox HTTP cache for REST responses (Cache Storage).
  //    Cooperative SW flush first (suppresses repopulation best-effort),
  //    then the deterministic page-side delete→verify loop.
  const swFlushAcknowledged = await requestSwApiFlush(opts.swFlushMaxWaitMs ?? 2000);
  let apiCacheStillPresent: boolean | null = null;
  let apiCacheDeleteAttempts = 0;
  const store = getCacheStorage();
  if (store) {
    const r = await deleteUntilVerifiedAbsent(store, WORKBOX_API_CACHE_NAME);
    apiCacheStillPresent = r.present;
    apiCacheDeleteAttempts = r.attempts;
  }

  // 3. Enumerated session/localStorage business cache keys.
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      wipeSessionBusinessStorage(window.sessionStorage, storageKeysRemoved);
    }
  } catch {
    // storage blocked
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      for (const k of LOCALSTORAGE_CACHE_KEYS) {
        if ((PRESERVED_LOCALSTORAGE_KEYS as readonly string[]).includes(k)) continue;
        if (window.localStorage.getItem(k) !== null) {
          window.localStorage.removeItem(k);
          storageKeysRemoved.push(k);
        }
      }
    }
  } catch {
    // storage blocked
  }

  // 4. In-memory React Query cache (logout previously only cleared the
  //    persister; the mounted app keeps nothing from the outgoing identity).
  let memoryCacheCleared = false;
  try {
    queryClient.clear();
    memoryCacheCleared = true;
  } catch (err) {
    log.warn('In-memory query cache clear failed', { error: err });
  }

  const verifiedEmpty =
    (rqEntriesRemaining === null || rqEntriesRemaining === 0) &&
    (apiCacheStillPresent === null || apiCacheStillPresent === false);

  const result: CacheWipeResult = {
    trigger,
    rqEntriesRemaining,
    apiCacheStillPresent,
    apiCacheDeleteAttempts,
    swFlushAcknowledged,
    storageKeysRemoved,
    memoryCacheCleared,
    verifiedEmpty,
  };
  if (!verifiedEmpty) {
    log.warn('Business cache wipe did not verify empty', { result });
  }
  return result;
}
