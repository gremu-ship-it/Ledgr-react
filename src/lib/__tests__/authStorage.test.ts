import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTH_PERSISTENCE_MODE_KEY,
  SESSION_ONLY_TAB_MARKER,
  authStorage,
  setAuthPersistenceMode,
} from '../authStorage';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

afterEach(() => vi.unstubAllGlobals());

describe('Supabase auth storage mode', () => {
  it('keeps session-only credentials out of localStorage', () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });

    setAuthPersistenceMode(false);
    authStorage.setItem('sb-auth-token', 'session-secret');

    expect(localStorage.getItem(AUTH_PERSISTENCE_MODE_KEY)).toBe('session');
    expect(sessionStorage.getItem(SESSION_ONLY_TAB_MARKER)).toBe('1');
    expect(localStorage.getItem('sb-auth-token')).toBeNull();
    expect(sessionStorage.getItem('sb-auth-token')).toBe('session-secret');
  });

  it('cannot restore a session-only credential after the tab store disappears', () => {
    const localStorage = new MemoryStorage();
    const firstTab = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage: firstTab });
    setAuthPersistenceMode(false);
    authStorage.setItem('sb-auth-token', 'session-secret');

    const reopenedTab = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage: reopenedTab });
    expect(authStorage.getItem('sb-auth-token')).toBeNull();
  });

  it('stores remembered credentials locally and clears both stores on removal', () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });

    setAuthPersistenceMode(true);
    authStorage.setItem('sb-auth-token', 'remembered-secret');
    expect(localStorage.getItem('sb-auth-token')).toBe('remembered-secret');
    expect(sessionStorage.getItem('sb-auth-token')).toBeNull();

    sessionStorage.setItem('sb-auth-token', 'stale-copy');
    authStorage.removeItem('sb-auth-token');
    expect(localStorage.getItem('sb-auth-token')).toBeNull();
    expect(sessionStorage.getItem('sb-auth-token')).toBeNull();
  });
});
