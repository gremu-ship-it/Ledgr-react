import { requestPersistentStorage } from './services/offlineSyncService';

export function registerServiceWorker(): void {
  if (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    process.env.NODE_ENV === 'production'
  ) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[Ledgr PWA] Service Worker registered with scope:', reg.scope);
          // Request persistent OS storage
          requestPersistentStorage().catch(() => {});
        })
        .catch((err) => {
          console.warn('[Ledgr PWA] Service Worker registration failed:', err);
        });
    });
  }
}
