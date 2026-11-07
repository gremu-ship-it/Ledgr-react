import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearPartnerClientContext, readPartnerClientContext, resolveOriginalBusiness, savePartnerClientContext } from './partnerClientContext';

const context = {
  version: 1 as const,
  partnerId: '11111111-1111-4111-8111-111111111111',
  businessId: '22222222-2222-4222-8222-222222222222',
  businessName: 'Acme Books',
  returnTo: '/partner-admin/partners/11111111-1111-4111-8111-111111111111/clients',
  originalBusinessId: '33333333-3333-4333-8333-333333333333',
  enteredAt: '2026-11-05T00:00:00.000Z',
};

function stubSessionStorage() {
  const values = new Map<string, string>();
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
  };
  vi.stubGlobal('window', {
    sessionStorage: storage,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  return { values, storage };
}

afterEach(() => vi.unstubAllGlobals());

describe('partner client context session', () => {
  it('stores the return route and restores only a current authorized membership', () => {
    const { storage } = stubSessionStorage();
    savePartnerClientContext(context);
    expect(readPartnerClientContext()).toEqual(context);
    const membership = { role: 'owner', business: { id: context.originalBusinessId, name: 'Partner books' } };
    expect(resolveOriginalBusiness(context, [membership])).toBe(membership);
    expect(resolveOriginalBusiness(context, [])).toBeNull();
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it('rejects malformed or unsafe return routes and clears the session', () => {
    const { values, storage } = stubSessionStorage();
    values.set('ledgr.partner-client-context.v1', JSON.stringify({ ...context, returnTo: 'https://attacker.example' }));
    expect(readPartnerClientContext()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledOnce();
  });

  it('clears the tab-scoped context on exit', () => {
    const { values } = stubSessionStorage();
    savePartnerClientContext(context);
    clearPartnerClientContext();
    expect(readPartnerClientContext()).toBeNull();
    expect(values.size).toBe(0);
  });
});
