export const LEDGR_BACKGROUND_SYNC_TAG = 'ledgr-offline-queue';
export const LEDGR_SYNC_REQUESTED = 'LEDGR_SYNC_REQUESTED';

interface BackgroundSyncManager {
  register(tag: string): Promise<void>;
}

type BackgroundSyncRegistration = ServiceWorkerRegistration & {
  sync?: BackgroundSyncManager;
};

export interface LedgrServiceWorkerMessage {
  type: typeof LEDGR_SYNC_REQUESTED;
}

/**
 * Ask the service worker to wake the app's queue processor when connectivity
 * returns. Background Sync is progressive enhancement: Safari and some
 * privacy-focused browsers do not expose it, so online events and the
 * mount-time queue check remain the universal fallback.
 */
export async function requestBackgroundSync(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }

  try {
    // getRegistration() resolves even when there is no worker. In contrast,
    // navigator.serviceWorker.ready can remain pending forever after a blocked
    // or failed registration.
    const registration = (await navigator.serviceWorker.getRegistration()) as
      | BackgroundSyncRegistration
      | undefined;
    if (!registration?.sync) return false;

    await registration.sync.register(LEDGR_BACKGROUND_SYNC_TAG);
    return true;
  } catch {
    // Permission policy, private browsing, and browser settings can reject a
    // registration. Queue durability must never depend on this optional API.
    return false;
  }
}

export function isServiceWorkerSyncRequest(
  data: unknown,
): data is LedgrServiceWorkerMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    data.type === LEDGR_SYNC_REQUESTED
  );
}
