/**
 * Detects whether an error was caused by a dynamic import / chunk load failure.
 * This commonly happens in production SPAs when a new deployment invalidates
 * old asset hashes (e.g. ExpensesPage-CMk2Yelt.js) and open browser tabs attempt
 * to load a chunk that no longer exists on the server.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error);

  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('error loading dynamically imported module') ||
    message.includes('Loading chunk') ||
    message.includes('Failed to fetch') ||
    message.includes('Load failed') ||
    message.includes('NetworkError')
  );
}

/**
 * Attempts automatic recovery from a chunk load failure by refreshing the page
 * once per route/key so the browser fetches the latest index.html and bundle
 * hashes. Returns true if a reload was triggered.
 */
export function attemptChunkRecovery(key: string): boolean {
  if (typeof window === 'undefined') return false;
  const storageKey = `ledgr_chunk_recovery_${key}`;

  let hasReloaded = false;
  try {
    hasReloaded = window.sessionStorage?.getItem(storageKey) === 'true';
  } catch {
    // Ignore storage access errors (e.g. strict privacy modes)
  }

  if (!hasReloaded) {
    try {
      window.sessionStorage?.setItem(storageKey, 'true');
    } catch {
      // Ignore storage access errors
    }
    try {
      if (typeof window.location?.reload === 'function') {
        window.location.reload();
      }
    } catch {
      // Ignore reload errors in test environments
    }
    return true;
  }

  return false;
}

/**
 * Clears the recovery flag for a given key after a successful load.
 */
export function clearChunkRecovery(key: string): void {
  if (typeof window === 'undefined') return;
  const storageKey = `ledgr_chunk_recovery_${key}`;
  try {
    window.sessionStorage?.removeItem(storageKey);
  } catch {
    // Ignore storage access errors
  }
}
