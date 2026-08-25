import { queryClient } from '@/lib/queryClient';
import { clearCapturedErrors } from '@/lib/errorCapture';
import { offlineDB } from '@/offline/db';
import { useAppStore } from '@/store/useAppStore';
import { useNotificationStore } from '@/store/useNotificationStore';

const ISOLATION_CHANNEL = 'ledgr-client-isolation-v1';
const ISOLATION_STORAGE_EVENT = 'ledgr-client-isolation-event';
const CLEAR_PRIVATE_CACHES_MESSAGE = 'LEDGR_CLEAR_PRIVATE_CACHES';

/** Runtime caches from releases that stored authenticated or remote resources. */
export const OBSOLETE_PRIVATE_CACHE_NAMES = [
  'ledgr-api-cache',
  'ledgr-static-assets',
] as const;

/** App-owned local/session keys that can contain user or tenant-specific state. */
const SENSITIVE_LOCAL_STORAGE_KEYS = [
  'ledgr-notifications',
  'ledgr-partner-cache',
  'ledgr-renewal-reminders-shown',
  'ledgr-auth-persistence',
  'onboardingSkipped',
] as const;

const SENSITIVE_SESSION_STORAGE_KEYS = [
  'ledgr-session-only',
  'ledgr_tax_reminder_shown',
] as const;

let cleanupInFlight: Promise<void> | null = null;
let isolationInitialized = false;
let businessSubscription: (() => void) | null = null;
let channel: BroadcastChannel | null = null;

function removeStorageKeys(storage: Storage | undefined, keys: readonly string[]): void {
  if (!storage) return;
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Storage may be unavailable in hardened/private browser modes.
    }
  }
}

function removeLegacySensitiveStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem('ledgr-partner-cache');
    if (raw) {
      const parsed = JSON.parse(raw) as { version?: number };
      if (parsed.version !== 2) window.localStorage.removeItem('ledgr-partner-cache');
    }
  } catch {
    // Storage is unavailable; no readable legacy value can be exposed.
  }
}

async function clearPrivateBrowserCaches(): Promise<void> {
  if (typeof window === 'undefined') return;

  if ('caches' in window) {
    try {
      const names = await window.caches.keys();
      await Promise.all(
        names
          .filter((name) => OBSOLETE_PRIVATE_CACHE_NAMES.includes(
            name as (typeof OBSOLETE_PRIVATE_CACHE_NAMES)[number],
          ))
          .map((name) => window.caches.delete(name)),
      );
    } catch {
      // Cache Storage is progressive enhancement; local cleanup continues.
    }
  }

  try {
    navigator.serviceWorker?.controller?.postMessage({ type: CLEAR_PRIVATE_CACHES_MESSAGE });
  } catch {
    // There may be no active controller yet.
  }
}

function broadcastPurge(): void {
  if (typeof window === 'undefined') return;
  const message = { type: 'PURGE_USER_DATA', nonce: crypto.randomUUID() };
  try {
    channel?.postMessage(message);
  } catch {
    // BroadcastChannel is optional.
  }
  try {
    window.localStorage.setItem(ISOLATION_STORAGE_EVENT, JSON.stringify(message));
    window.localStorage.removeItem(ISOLATION_STORAGE_EVENT);
  } catch {
    // The storage event is only a fallback for browsers without BroadcastChannel.
  }
}

export function isActiveClientContext(userId: string, businessId: string): boolean {
  const state = useAppStore.getState();
  return (
    state.currentUser?.id === userId &&
    state.currentBusiness?.business?.id === businessId
  );
}

/**
 * Purge all user/tenant-sensitive client state. UI-only preferences and the
 * static application shell are intentionally preserved.
 */
export function purgeSensitiveClientState(options: { broadcast?: boolean } = {}): Promise<void> {
  // These operations are synchronous and happen even when an async cleanup is
  // already running, so the current tab cannot render a stale query/notif while
  // IndexedDB and Cache Storage are being cleared.
  queryClient.clear();
  useNotificationStore.getState().clearAll();
  useAppStore.getState().reset();
  clearCapturedErrors();

  if (typeof window !== 'undefined') {
    removeStorageKeys(window.localStorage, SENSITIVE_LOCAL_STORAGE_KEYS);
    removeStorageKeys(window.sessionStorage, SENSITIVE_SESSION_STORAGE_KEYS);
  }

  if (!cleanupInFlight) {
    cleanupInFlight = Promise.allSettled([
      offlineDB.queue.clear(),
      Promise.resolve(useNotificationStore.persist.clearStorage()),
      clearPrivateBrowserCaches(),
    ]).then(() => undefined).finally(() => {
      cleanupInFlight = null;
    });
  }

  if (options.broadcast !== false) broadcastPurge();
  return cleanupInFlight;
}

/**
 * Install cross-tab purge handling and clear in-memory query state whenever the
 * selected business changes. Shared offline records remain available for the
 * same user, but sync is independently bound to the active user/business.
 */
export function initializeClientDataIsolation(): void {
  if (isolationInitialized || typeof window === 'undefined') return;
  isolationInitialized = true;
  removeLegacySensitiveStorage();

  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(ISOLATION_CHANNEL);
    channel.addEventListener('message', (event: MessageEvent<unknown>) => {
      const data = event.data as { type?: string } | null;
      if (data?.type === 'PURGE_USER_DATA') {
        void purgeSensitiveClientState({ broadcast: false });
      }
    });
  }

  window.addEventListener('storage', (event) => {
    if (event.key === ISOLATION_STORAGE_EVENT && event.newValue) {
      void purgeSensitiveClientState({ broadcast: false });
    }
  });

  businessSubscription = useAppStore.subscribe((state, previousState) => {
    const previousBusinessId = previousState.currentBusiness?.business?.id ?? null;
    const nextBusinessId = state.currentBusiness?.business?.id ?? null;
    const previousRole = previousState.currentBusiness?.role ?? null;
    const nextRole = state.currentBusiness?.role ?? null;
    const contextChanged =
      previousBusinessId &&
      nextBusinessId &&
      (previousBusinessId !== nextBusinessId || previousRole !== nextRole);
    if (contextChanged) {
      // clear() destroys/cancels query observers, including record-id detail
      // entries. Business and permission changes both re-fetch through RLS.
      queryClient.clear();
      clearCapturedErrors();
    }
  });
}

/** Test/teardown hook; not used by the production application. */
export function disposeClientDataIsolation(): void {
  businessSubscription?.();
  businessSubscription = null;
  channel?.close();
  channel = null;
  isolationInitialized = false;
}
