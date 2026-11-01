import { describe, expect, it } from 'vitest';
import { resolveHost } from '../partnerDomain';

describe('resolveHost', () => {
  it.each([
    'ledgr-react.vercel.app',
    'ledgr-react-prod.vercel.app',
    'ledgr-react-git-fix-partner-domain.vercel.app',
  ])('treats Vercel deployment host %s as the platform, not a partner tenant', (hostname) => {
    expect(resolveHost(hostname)).toEqual({
      slug: null,
      customDomain: null,
      isAdminHost: false,
      isPlatformHost: true,
    });
  });

  it('continues to resolve real vanity domains as partner tenants', () => {
    expect(resolveHost('accounting.nbsmw.com')).toEqual({
      slug: null,
      customDomain: 'accounting.nbsmw.com',
      isAdminHost: false,
      isPlatformHost: false,
    });
  });
});
