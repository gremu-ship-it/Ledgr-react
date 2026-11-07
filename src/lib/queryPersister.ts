import Dexie, { type EntityTable } from 'dexie';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { isDemoMode } from '@/lib/demo/mode';
import { supabase } from '@/lib/supabase';

/**
 * IndexedDB persister for the React Query cache. Every saved client is bound to
 * one authenticated principal and one business tenant; a cache is restored only
 * after both identities have been resolved and verified against Supabase Auth.
 *
 * The database is deliberately separate from `ledgr-offline`: accepted offline
 * financial evidence is not cache and must never be removed by this persister.
 */

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
  'invoice',
  'contact',
  'recent_totals',
] as const;

export interface PersistedCacheIdentity {
  userId: string;
  businessId: string;
}

type PersistedEntry = {
  id: string;
  client: string;
  updatedAt: number;
  userId: string;
  businessId: string;
};

class RQCacheDB extends Dexie {
  cache!: EntityTable<PersistedEntry, 'id'>;

  constructor() {
    super('ledgr-rq-cache');
    this.version(1).stores({
      cache: 'id, updatedAt, businessId',
    });
    this.version(2).stores({
      cache: 'id, updatedAt, businessId, userId',
    });
  }
}

const db = new RQCacheDB();
const MAX_ENTRIES = 300;
let activeIdentity: PersistedCacheIdentity | null = null;

/** The persisted database key is an explicit principal + tenant namespace. */
export function getPersistedCacheKey(userId: string, businessId: string): string {
  return `rq-state-${userId}-${businessId}`;
}

/** Set only after auth and the active business have been resolved. */
export function setActivePersistedCacheIdentity(
  userId: string | null | undefined,
  businessId: string | null | undefined,
): void {
  activeIdentity = userId && businessId ? { userId, businessId } : null;
}

async function currentSessionUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.user.id ?? null;
}

async function trimCache(): Promise<void> {
  try {
    const count = await db.cache.count();
    if (count <= MAX_ENTRIES) return;
    const oldest = await db.cache.orderBy('updatedAt').limit(count - MAX_ENTRIES).primaryKeys();
    await db.cache.bulkDelete(oldest);
  } catch {
    // Storage may be disabled or full. Persistence is best-effort only.
  }
}

async function discardOtherNamespaces(keepId?: string): Promise<void> {
  const rows = await db.cache.toArray();
  const staleIds = rows
    .filter((row) => row.id === 'rq-state' || row.id.startsWith('rq-state-'))
    .filter((row) => row.id !== keepId)
    .map((row) => row.id);
  if (staleIds.length) await db.cache.bulkDelete(staleIds);
}

function sameIdentity(
  left: PersistedCacheIdentity | null,
  right: PersistedCacheIdentity | null,
): boolean {
  return Boolean(
    left && right && left.userId === right.userId && left.businessId === right.businessId,
  );
}

export interface IDBPersisterOptions {
  /** Injectable identity/session readers keep persistence verifiable in tests. */
  getIdentity?: () => PersistedCacheIdentity | null;
  getSessionUserId?: () => Promise<string | null>;
}

/** Create the Dexie-backed persister for react-query. */
export function createIDBPersister(options: IDBPersisterOptions = {}): Persister {
  const getIdentity = options.getIdentity ?? (() => activeIdentity);
  const getSessionUserId = options.getSessionUserId ?? currentSessionUserId;

  return {
    persistClient: async (client: PersistedClient): Promise<void> => {
      if (isDemoMode()) return;
      const identity = getIdentity();
      if (!identity) return;

      try {
        const sessionUserId = await getSessionUserId();
        if (sessionUserId !== identity.userId || !sameIdentity(identity, getIdentity())) return;

        const serialized = JSON.stringify(client);
        await db.cache.put({
          id: getPersistedCacheKey(identity.userId, identity.businessId),
          client: serialized,
          updatedAt: Date.now(),
          userId: identity.userId,
          businessId: identity.businessId,
        });
        await trimCache();
      } catch {
        // Storage failures must be silent — a network fetch is always correct.
      }
    },

    restoreClient: async (): Promise<PersistedClient | undefined> => {
      try {
        const identity = getIdentity();
        if (isDemoMode() || !identity) {
          await discardOtherNamespaces();
          return undefined;
        }

        const sessionUserId = await getSessionUserId();
        if (
          sessionUserId !== identity.userId ||
          !sameIdentity(identity, getIdentity())
        ) {
          await discardOtherNamespaces();
          return undefined;
        }

        const key = getPersistedCacheKey(identity.userId, identity.businessId);
        const row = await db.cache.get(key);
        // Delete every other principal/tenant namespace before returning any
        // bytes, including the legacy fixed `rq-state` row from older builds.
        await discardOtherNamespaces(key);
        if (
          !row ||
          row.userId !== identity.userId ||
          row.businessId !== identity.businessId ||
          !sameIdentity(identity, getIdentity())
        ) {
          if (row) await db.cache.delete(key);
          return undefined;
        }

        try {
          return JSON.parse(row.client) as PersistedClient;
        } catch {
          await db.cache.delete(key);
          return undefined;
        }
      } catch {
        // If auth or storage cannot be verified, fail closed and discard RQ
        // cache entries. The offline financial queue is in another database.
        try {
          await discardOtherNamespaces();
        } catch {
          // ignore storage failures
        }
        return undefined;
      }
    },

    removeClient: async (): Promise<void> => {
      try {
        const identity = getIdentity();
        if (identity) {
          await db.cache.delete(getPersistedCacheKey(identity.userId, identity.businessId));
        } else {
          await discardOtherNamespaces();
        }
      } catch {
        // ignore
      }
    },
  };
}

export const persistOptions = {
  persister: createIDBPersister(),
  maxAge: 24 * 60 * 60 * 1000,
  buster: 'v2-principal-business',
  dehydrateOptions: {
    shouldDehydrateQuery: (query: { queryKey: unknown; state?: { status?: string; fetchStatus?: string } }) => {
      const ns = Array.isArray(query.queryKey) ? query.queryKey[0] : null;
      if (typeof ns !== 'string' || !PERSISTED_KEY_PREFIXES.includes(ns as (typeof PERSISTED_KEY_PREFIXES)[number])) {
        return false;
      }
      const status = query.state?.status;
      return status !== 'loading' && status !== 'error';
    },
    shouldDehydrateMutation: (): boolean => false,
  },
};

/** Clear persisted React Query state only; offline evidence lives elsewhere. */
export async function clearPersistedCache(businessId?: string): Promise<void> {
  try {
    if (businessId) {
      await db.cache.where('businessId').equals(businessId).delete();
    } else {
      await db.cache.clear();
    }
  } catch {
    // ignore
  }
}

/** Remove the exact outgoing user/business namespace on a tenant switch. */
export async function clearPersistedCacheForIdentity(
  userId: string,
  businessId: string,
): Promise<void> {
  try {
    await db.cache.delete(getPersistedCacheKey(userId, businessId));
  } catch {
    // ignore
  }
}
