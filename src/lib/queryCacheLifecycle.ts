type ClearQueryCache = () => void;

let clearQueryCache: ClearQueryCache = () => undefined;

/** Register the application QueryClient without coupling the auth store to React Query. */
export function registerQueryCacheClearer(clearer: ClearQueryCache): void {
  clearQueryCache = clearer;
}

/** Synchronously clear in-memory query state before a tenant scope changes. */
export function clearQueryCacheImmediately(): void {
  clearQueryCache();
}
