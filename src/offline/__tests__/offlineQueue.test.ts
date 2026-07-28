import { describe, it, expect, vi, afterEach } from 'vitest';
import { isOfflineError, generateOfflineNumber } from '@/offline/queueApi';

describe('isOfflineError', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when navigator.onLine is false', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOfflineError(new Error('Any error'))).toBe(true);
  });

  it('returns true for fetch / network failure messages', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOfflineError(new Error('Failed to fetch'))).toBe(true);
    expect(isOfflineError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isOfflineError('ERR_INTERNET_DISCONNECTED')).toBe(true);
  });

  it('returns false for unrelated business logic errors', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOfflineError(new Error('Validation failed: amount must be positive'))).toBe(false);
  });
});

describe('generateOfflineNumber', () => {
  it('generates a unique temporary prefix number', () => {
    const expNum = generateOfflineNumber('EXP');
    const invNum = generateOfflineNumber('INV');

    expect(expNum).toMatch(/^EXP-OFFLINE-\d+$/);
    expect(invNum).toMatch(/^INV-OFFLINE-\d+$/);
    expect(expNum).not.toBe(invNum);
  });
});
