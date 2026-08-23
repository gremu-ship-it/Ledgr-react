import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEDGR_BACKGROUND_SYNC_TAG,
  isServiceWorkerSyncRequest,
  requestBackgroundSync,
} from '@/offline/backgroundSync';

describe('requestBackgroundSync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers the durable queue tag when the browser supports it', async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const getRegistration = vi.fn().mockResolvedValue({ sync: { register } });
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration } });

    await expect(requestBackgroundSync()).resolves.toBe(true);
    expect(getRegistration).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(LEDGR_BACKGROUND_SYNC_TAG);
  });

  it('falls back cleanly when Background Sync is unavailable', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: { getRegistration: vi.fn().mockResolvedValue({}) },
    });

    await expect(requestBackgroundSync()).resolves.toBe(false);
  });

  it('does not make queue persistence fail when registration is rejected', async () => {
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: vi.fn().mockRejectedValue(new Error('Not allowed')),
      },
    });

    await expect(requestBackgroundSync()).resolves.toBe(false);
  });
});

describe('isServiceWorkerSyncRequest', () => {
  it('only accepts the expected worker message', () => {
    expect(isServiceWorkerSyncRequest({ type: 'LEDGR_SYNC_REQUESTED' })).toBe(true);
    expect(isServiceWorkerSyncRequest({ type: 'OTHER' })).toBe(false);
    expect(isServiceWorkerSyncRequest(null)).toBe(false);
  });
});
