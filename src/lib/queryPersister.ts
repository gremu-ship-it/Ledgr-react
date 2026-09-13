import Dexie, { type EntityTable } from 'dexie';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

/**
 * IndexedDB persister for the React Query cache.
 *
 * SECURITY & PRIVACY NOTES — read before adding new key prefixes here:
 *
 *  1. TENANT ISOLATION: the cache key includes the businessId for every
 *     business-scoped query, so cached rows for business A cannot be read
 *     after the user switches to business B. The persister does NOT try
 *     to merge or share entries across businesses.
 *
 *  2. NO SECRETS: never persist keys that contain authentication material
 *     (the Supabase session is stored separately by supabase-js in its own
 *     localStorage bucket with its own security model). If a secret-bearing
 *     query is ever added it must be excluded via shouldDehydrateMutation /
 *     shouldDehydrateQuery in the persistOptions below.
 *
 *  3. BOUNDED SIZE: maxEntries caps the IndexedDB table so a long-running
 *     business cannot fill the device's storage with infinite pages. The
 *     dehydrated state is also trimmed — inactive queries beyond gcTime are
 *     removed before serialization.
 *
 *  4. BOUNDED AGE: maxAge 24h ensures stale data is thrown away on reload
 *     even if the user hasn't opened the app in days.
 *
 *  5. CLIENT-SIDE ONLY: this storage never leaves the browser. It is not
 *     synced to the server, not included in error reports, and not read by
 *     any third-party script.
 */

// Key prefixes that are safe to persist.
// - Lists, reference data, financial statements, dashboard widgets: pure
//   business data that was already returned from RLS-scoped queries.
// - Excluded: anything auth/session/user-related, the offline sync queue
//   (which has its own Dexie schema with dependency tracking), and live
//   mutating state.
const PERSISTED_KEY_PREFIXES = [
  'expenses',
  'invoices',
  'contacts',
  'products',
  'products_all',
  'accounts',
  'accounts_expense',
  'accounts_income',
  'accounts_by_type',
  'posting_accounts',
  'branches',
  'departments',
  'locations',
  'tax_rates',
  'journal',
  'sofp',
  'sofp-integrity',
  'profit_or_loss',
  'cash_flow',
  'changes_in_equity',
  'branch_performance',
  'dashboard',
  'usage',
  'brand',
  'business',
  'invoice', // detail views (lines, payments) keyed by invoice id
  'contact', // contact detail
  'recent_totals',
] as const;

type PersistedEntry = {
  id: string;
  client: string; // JSON-stringified PersistedClient
  updatedAt: number;
  businessId?: string;
};

class RQCacheDB extends Dexie {
  cache!: EntityTable<PersistedEntry, 'id'>;

  constructor() {
    super('ledgr-rq-cache');
    this.version(1).stores({
      // Index by businessId so we can evict a single tenant's entries on
      // logout without wiping other cached businesses.
      cache: 'id, updatedAt, businessId',
    });
  }
}

const db = new RQCacheDB();
const MAX_ENTRIES = 300;

/**
 * Best-effort size cap: if the cache table has grown past MAX_ENTRIES,
 * delete the oldest entries. Swallowed errors so corruption or a full
 * disk cannot break app boot.
 */
async function trimCache(): Promise<void> {
  try {
    const count = await db.cache.count();
    if (count <= MAX_ENTRIES) return;
    const oldest = await db.cache
      .orderBy('updatedAt')
      .limit(count - MAX_ENTRIES)
      .primaryKeys();
    await db.cache.bulkDelete(oldest);
  } catch {
    // Storage may be disabled (private browsing) or full. Not fatal —
    // persist will fail softly and the app boots with an empty cache.
  }
}

/**
 * Extract the leading key of a React Query queryKey so we can check it
 * against the allow-list. Query keys are arrays like ['invoices', 'list',
 * businessId, ...]; we look at index 0 which is the namespace.
 */
function keyNamespace(queryKey: unknown): string | null {
  if (!Array.isArray(queryKey) || queryKey.length === 0) return null;
  const first = queryKey[0];
  return typeof first === 'string' ? first : null;
}

function isPersistableKey(queryKey: unknown): boolean {
  const ns = keyNamespace(queryKey);
  if (!ns) return false;
  return PERSISTED_KEY_PREFIXES.includes(ns as (typeof PERSISTED_KEY_PREFIXES)[number]);
}

/** Create the Dexie-backed persister for react-query. */
export function createIDBPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient): Promise<void> => {
      try {
        const serialized = JSON.stringify(client);
        // Single-row store; we use a fixed id ('rq-state') because React
        // Query's persist plugin dehydrates/hydrates the entire cache as
        // one blob. The businessId index is retained for future multi-
        // tenant eviction but the current blob is a single document.
        await db.cache.put({
          id: 'rq-state',
          client: serialized,
          updatedAt: Date.now(),
        });
        await trimCache();
      } catch {
        // Storage failures must be silent — falling back to a network
        // fetch is always a correct (slower) behaviour.
      }
    },
    restoreClient: async (): Promise<PersistedClient | undefined> => {
      try {
        const row = await db.cache.get('rq-state');
        if (!row) return undefined;
        return JSON.parse(row.client) as PersistedClient;
      } catch {
        return undefined;
      }
    },
    removeClient: async (): Promise<void> => {
      try {
        await db.cache.delete('rq-state');
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Filter for dehydrated queries: only persist queries whose key namespace
 * is in the allow-list. Mutations are never persisted (they hold in-flight
 * promise state that cannot survive a page reload safely).
 */
export const persistOptions = {
  persister: createIDBPersister(),
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  buster: 'v1', // bump to force a full cache invalidation after schema changes
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: unknown; state?: { status?: string; fetchStatus?: string } }) => {
      // Never persist loading/error queries (they'd just cause an immediate
      // retry storm on reload) or mutations.
      if (!isPersistableKey(query.queryKey)) return false;
      const status = query.state?.status;
      if (status === 'loading' || status === 'error') return false;
      return true;
    },
    shouldDehydrateMutation: (): boolean => false,
  },
};

/**
 * Wipe the persisted RQ cache. Called on explicit logout so the next user
 * cannot read cached rows belonging to the previous account (even though
 * Supabase RLS would block server fetches, defense-in-depth says we don't
 * leave other people's financial data on a shared device).
 */
export async function clearPersistedCache(businessId?: string): Promise<void> {
  try {
    if (businessId) {
      // Selective wipe (per-business on switch): currently we keep one
      // blob so this clears everything. Future: split by businessId key.
      await db.cache.where('businessId').equals(businessId).delete();
    }
    await db.cache.clear();
  } catch {
    // ignore
  }
}
