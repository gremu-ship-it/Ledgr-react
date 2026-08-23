import { registerSW } from 'virtual:pwa-register';

let updateAvailable = false;
let registrationStarted = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;

function dispatch(name: string, detail?: unknown) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/** Register the Workbox service worker once, as early as possible. */
export function registerLedgrServiceWorker(): void {
  if (
    registrationStarted ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return;
  }

  registrationStarted = true;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Keep module state as well as emitting an event: a very fast worker can
      // become ready before React mounts its banner listener.
      updateAvailable = true;
      dispatch('app:update-available');
    },
    onOfflineReady() {
      dispatch('app:offline-ready');
    },
    onRegisteredSW(_serviceWorkerUrl, registration) {
      dispatch('app:sw-registered', registration);
    },
    onRegisterError(error) {
      // Registration failure must not stop the online app from loading. The
      // event lets observability/UI integrations report it without coupling
      // this low-level module to Sentry or React.
      console.error('[service-worker] Registration failed.', error);
      dispatch('app:sw-registration-error', error);
    },
  });
}

export function isServiceWorkerUpdateAvailable(): boolean {
  return updateAvailable;
}

/** Activate a waiting build before reloading, avoiding a reload loop on the old worker. */
export async function activateServiceWorkerUpdate(): Promise<void> {
  if (updateServiceWorker) {
    await updateServiceWorker(true);
    return;
  }

  window.location.reload();
}
