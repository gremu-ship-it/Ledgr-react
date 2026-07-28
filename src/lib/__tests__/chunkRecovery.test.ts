import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isChunkLoadError,
  attemptChunkRecovery,
  clearChunkRecovery,
} from '@/lib/chunkRecovery';

describe('isChunkLoadError', () => {
  it('identifies Vite dynamic import errors', () => {
    const err = new TypeError(
      'Failed to fetch dynamically imported module: https://ledgr-react.vercel.app/assets/ExpensesPage-CMk2Yelt.js',
    );
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('identifies Safari/Firefox dynamic import script failure', () => {
    const err = new Error('Importing a module script failed.');
    expect(isChunkLoadError(err)).toBe(true);
  });

  it('identifies general chunk load failures', () => {
    expect(isChunkLoadError('Loading chunk 123 failed')).toBe(true);
    expect(isChunkLoadError(new Error('Failed to fetch'))).toBe(true);
  });

  it('returns false for unrelated errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('attemptChunkRecovery & clearChunkRecovery in node / mock window', () => {
  let reloadMock: ReturnType<typeof vi.fn>;
  let storage: Record<string, string>;

  beforeEach(() => {
    reloadMock = vi.fn();
    storage = {};

    const fakeSessionStorage = {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      clear: vi.fn(() => {
        storage = {};
      }),
    };

    vi.stubGlobal('window', {
      sessionStorage: fakeSessionStorage,
      location: {
        reload: reloadMock,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sets recovery flag in sessionStorage and triggers reload on first failure', () => {
    const result = attemptChunkRecovery('ExpensesPage');
    expect(result).toBe(true);
    expect(storage['ledgr_chunk_recovery_ExpensesPage']).toBe('true');
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('returns false and does not reload if already reloaded for that key', () => {
    storage['ledgr_chunk_recovery_ExpensesPage'] = 'true';
    const result = attemptChunkRecovery('ExpensesPage');
    expect(result).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it('clears recovery flag after successful load', () => {
    storage['ledgr_chunk_recovery_ExpensesPage'] = 'true';
    clearChunkRecovery('ExpensesPage');
    expect(storage['ledgr_chunk_recovery_ExpensesPage']).toBeUndefined();
  });
});
