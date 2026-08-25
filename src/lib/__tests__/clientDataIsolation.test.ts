import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  queryClear: vi.fn(),
  capturedErrorsClear: vi.fn(),
  queueClear: vi.fn(async () => undefined),
  appReset: vi.fn(),
  notificationsClear: vi.fn(),
  notificationStorageClear: vi.fn(async () => undefined),
  subscribe: vi.fn((listener: unknown) => {
    void listener;
    return vi.fn();
  }),
}));

vi.mock('@/lib/queryClient', () => ({ queryClient: { clear: mocks.queryClear } }));
vi.mock('@/lib/errorCapture', () => ({ clearCapturedErrors: mocks.capturedErrorsClear }));
vi.mock('@/offline/db', () => ({ offlineDB: { queue: { clear: mocks.queueClear } } }));
vi.mock('@/store/useNotificationStore', () => ({
  useNotificationStore: Object.assign(
    () => undefined,
    {
      getState: () => ({ clearAll: mocks.notificationsClear }),
      persist: { clearStorage: mocks.notificationStorageClear },
    },
  ),
}));
vi.mock('@/store/useAppStore', () => ({
  useAppStore: Object.assign(
    () => undefined,
    {
      getState: () => ({ reset: mocks.appReset }),
      subscribe: mocks.subscribe,
    },
  ),
}));

class MemoryStorage {
  private values = new Map<string, string>();
  setItem(key: string, value: string) { this.values.set(key, value); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  clear() { this.values.clear(); }
  get length() { return this.values.size; }
}

describe('central client data purge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears query, notification, offline, storage and obsolete Cache Storage data', async () => {
    const localStorage = new MemoryStorage();
    const sessionStorage = new MemoryStorage();
    for (const key of [
      'ledgr-notifications',
      'ledgr-partner-cache',
      'ledgr-renewal-reminders-shown',
      'ledgr-auth-persistence',
      'onboardingSkipped',
    ]) localStorage.setItem(key, 'sensitive');
    sessionStorage.setItem('ledgr-session-only', '1');
    sessionStorage.setItem('ledgr_tax_reminder_shown', '1');

    const deleteCache = vi.fn(async () => true);
    const postMessage = vi.fn();
    vi.stubGlobal('window', {
      localStorage,
      sessionStorage,
      caches: {
        keys: vi.fn(async () => ['ledgr-api-cache', 'ledgr-static-assets', 'workbox-precache-safe']),
        delete: deleteCache,
      },
    });
    vi.stubGlobal('navigator', { serviceWorker: { controller: { postMessage } } });

    const { purgeSensitiveClientState } = await import('@/lib/clientDataIsolation');
    await purgeSensitiveClientState({ broadcast: false });

    expect(mocks.queryClear).toHaveBeenCalled();
    expect(mocks.appReset).toHaveBeenCalled();
    expect(mocks.notificationsClear).toHaveBeenCalled();
    expect(mocks.notificationStorageClear).toHaveBeenCalled();
    expect(mocks.queueClear).toHaveBeenCalled();
    expect(mocks.capturedErrorsClear).toHaveBeenCalled();
    expect(localStorage.getItem('ledgr-partner-cache')).toBeNull();
    expect(sessionStorage.getItem('ledgr-session-only')).toBeNull();
    expect(deleteCache).toHaveBeenCalledWith('ledgr-api-cache');
    expect(deleteCache).toHaveBeenCalledWith('ledgr-static-assets');
    expect(deleteCache).not.toHaveBeenCalledWith('workbox-precache-safe');
    expect(postMessage).toHaveBeenCalledWith({ type: 'LEDGR_CLEAR_PRIVATE_CACHES' });
  });

  it('clears in-memory caches on business switch and a purge broadcast from another tab', async () => {
    const channelHandler: { current?: (event: MessageEvent<unknown>) => void } = {};
    class FakeBroadcastChannel {
      addEventListener(_name: string, listener: (event: MessageEvent<unknown>) => void) {
        channelHandler.current = listener;
      }
      postMessage() {}
      close() {}
    }

    const storage = new MemoryStorage();
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('window', {
      BroadcastChannel: FakeBroadcastChannel,
      localStorage: storage,
      sessionStorage: new MemoryStorage(),
      addEventListener: vi.fn(),
      caches: { keys: vi.fn(async () => []), delete: vi.fn(async () => true) },
    });
    vi.stubGlobal('navigator', {});

    const {
      initializeClientDataIsolation,
      disposeClientDataIsolation,
    } = await import('@/lib/clientDataIsolation');
    initializeClientDataIsolation();

    const subscription = (mocks.subscribe.mock.calls[0] as unknown[])[0] as (
      state: { currentBusiness: { business: { id: string } } },
      previous: { currentBusiness: { business: { id: string } } },
    ) => void;
    mocks.queryClear.mockClear();
    subscription(
      { currentBusiness: { business: { id: 'business-b' } } },
      { currentBusiness: { business: { id: 'business-a' } } },
    );
    expect(mocks.queryClear).toHaveBeenCalledTimes(1);

    mocks.queryClear.mockClear();
    channelHandler.current?.({ data: { type: 'PURGE_USER_DATA' } } as MessageEvent<unknown>);
    await Promise.resolve();
    expect(mocks.queryClear).toHaveBeenCalled();
    disposeClientDataIsolation();
  });
});
