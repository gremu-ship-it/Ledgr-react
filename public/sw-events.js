/*
 * Extra service-worker capabilities loaded by the Workbox-generated worker.
 *
 * Workbox owns precaching, navigation fallback, and runtime caching. This file
 * owns browser events that generateSW does not create for us: Web Push,
 * notification clicks, and Background Sync messages.
 */
'use strict';

const LEDGR_BACKGROUND_SYNC_TAG = 'ledgr-offline-queue';
const LEDGR_SYNC_REQUESTED = 'LEDGR_SYNC_REQUESTED';

function safeNotificationUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/', self.location.origin);
    if (url.origin !== self.location.origin) return '/';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

function limitedText(value, fallback, maxLength) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

function readPushPayload(event) {
  if (!event.data) return {};

  try {
    const payload = event.data.json();
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return { body: event.data.text() };
  }
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  const title = limitedText(payload.title, 'Ledgr', 100);
  const body = limitedText(payload.body, 'You have a new Ledgr notification.', 300);
  const url = safeNotificationUrl(payload.url ?? payload.link);
  const tag = limitedText(payload.tag, 'ledgr-notification', 100);

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const relativeUrl = safeNotificationUrl(event.notification.data?.url);
  const targetUrl = new URL(relativeUrl, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(async (windowClients) => {
        const exactClient = windowClients.find((client) => client.url === targetUrl);
        if (exactClient) return exactClient.focus();

        const sameOriginClient = windowClients.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (sameOriginClient) {
          if ('navigate' in sameOriginClient) await sameOriginClient.navigate(targetUrl);
          return sameOriginClient.focus();
        }

        return self.clients.openWindow(targetUrl);
      }),
  );
});

/*
 * Financial queue items are semantic operations stored in IndexedDB rather
 * than replayable raw HTTP requests. The worker therefore wakes any open app
 * client when connectivity returns; the app's idempotent sync engine performs
 * the operation with the current auth session. If no client is open, the
 * queue remains durable and the app's mount-time sync picks it up next launch.
 */
self.addEventListener('sync', (event) => {
  if (event.tag !== LEDGR_BACKGROUND_SYNC_TAG) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        for (const client of windowClients) {
          client.postMessage({ type: LEDGR_SYNC_REQUESTED });
        }
      }),
  );
});

/*
 * R09.1 cache confidentiality (D-5 wipe model): cooperative API-cache flush.
 * On identity transition the page asks the active worker to drop the Workbox
 * runtime cache from its side as well. The reply is advisory coordination —
 * the page ALSO deletes the cache from its own origin view and verifies
 * emptiness before reporting the wipe complete, so a missing/slow worker can
 * never turn a wipe into a silent skip. The page owns verification; this
 * listener only makes the race window smaller and explicit.
 */
const R09_CACHE_FLUSH = 'R09_CACHE_FLUSH';
const R09_CACHE_FLUSHED = 'R09_CACHE_FLUSHED';
const R09_API_CACHE_NAME = 'ledgr-api-cache';

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== R09_CACHE_FLUSH) return;
  const port = event.ports && event.ports[0];
  event.waitUntil(
    (async () => {
      try {
        await self.caches.delete(R09_API_CACHE_NAME);
      } catch {
        // Cache API unavailable in this context — the page-side loop still
        // owns the deterministic delete→verify of the same origin storage.
      }
      if (port) {
        port.postMessage({ type: R09_CACHE_FLUSHED, requestId: data.requestId });
      }
    })(),
  );
});
