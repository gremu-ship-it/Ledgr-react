export const AUTH_PERSISTENCE_MODE_KEY = 'ledgr-auth-persistence';
export const SESSION_ONLY_TAB_MARKER = 'ledgr-session-only';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memory = new Map<string, string>();
const memoryStorage: StorageLike = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value); },
  removeItem: (key) => { memory.delete(key); },
};

function stores(): { local: StorageLike; session: StorageLike } {
  if (typeof window === 'undefined') {
    return { local: memoryStorage, session: memoryStorage };
  }
  return { local: window.localStorage, session: window.sessionStorage };
}

function sessionOnly(): boolean {
  return stores().local.getItem(AUTH_PERSISTENCE_MODE_KEY) === 'session';
}

/** Configure storage before sign-in so Supabase never writes a session-only token to localStorage. */
export function setAuthPersistenceMode(remember: boolean): void {
  const { local, session } = stores();
  if (remember) {
    local.removeItem(AUTH_PERSISTENCE_MODE_KEY);
    session.removeItem(SESSION_ONLY_TAB_MARKER);
  } else {
    local.setItem(AUTH_PERSISTENCE_MODE_KEY, 'session');
    session.setItem(SESSION_ONLY_TAB_MARKER, '1');
  }
}

export function clearAuthPersistenceMode(): void {
  const { local, session } = stores();
  local.removeItem(AUTH_PERSISTENCE_MODE_KEY);
  session.removeItem(SESSION_ONLY_TAB_MARKER);
}

/**
 * Supabase-compatible storage adapter. Session mode keeps credentials only in
 * sessionStorage; removeItem always clears both stores so purge-before-signout
 * cannot change the mode marker early and leave a token behind.
 */
export const authStorage: StorageLike = {
  getItem(key) {
    const { local, session } = stores();
    if (sessionOnly()) {
      // Remove a token left by releases that implemented session-only mode as a
      // deferred next-boot sign-out while still persisting credentials locally.
      local.removeItem(key);
      return session.getItem(key);
    }
    session.removeItem(key);
    return local.getItem(key);
  },
  setItem(key, value) {
    const { local, session } = stores();
    if (sessionOnly()) {
      local.removeItem(key);
      session.setItem(key, value);
    } else {
      session.removeItem(key);
      local.setItem(key, value);
    }
  },
  removeItem(key) {
    const { local, session } = stores();
    local.removeItem(key);
    session.removeItem(key);
  },
};
