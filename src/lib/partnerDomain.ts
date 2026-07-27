/**
 * Resolves which partner tenant the current browser host belongs to.
 *
 * Two shapes are supported:
 *   • subdomain of the platform root:  nbs.ledgr.com  → slug "nbs"
 *   • fully custom vanity domain:      accounting.nbsmw.com → custom domain
 *
 * The platform root itself (ledgr.com / www.ledgr.com), the partner admin
 * portal (admin.ledgr.com) and local dev hosts are *not* partner tenants.
 */

export const PLATFORM_ROOT_DOMAIN =
  (import.meta.env.VITE_PLATFORM_ROOT_DOMAIN as string | undefined) ?? 'ledgr.com';

export const ADMIN_SUBDOMAIN = 'admin';

/** Reserved subdomains that never map to a partner. */
const RESERVED = new Set(['www', 'app', ADMIN_SUBDOMAIN, 'api', 'staging', 'preview']);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

export interface HostResolution {
  /** Subdomain label under the platform root, if any. */
  slug: string | null;
  /** Full host when it is a vanity/custom domain. */
  customDomain: string | null;
  /** True when the host is admin.ledgr.com (the partner admin portal). */
  isAdminHost: boolean;
  /** True when the host is the plain platform root — no partner branding. */
  isPlatformHost: boolean;
}

function stripPort(host: string): string {
  return host.replace(/:\d+$/, '').toLowerCase();
}

export function resolveHost(hostname: string = window.location.hostname): HostResolution {
  const host = stripPort(hostname);
  const root = PLATFORM_ROOT_DOMAIN.toLowerCase();

  // Local dev: allow ?partner=nbs / nbs.localhost to simulate a tenant.
  if (LOCAL_HOSTS.has(host) || host.endsWith('.localhost')) {
    const override = localDevOverride(host);
    return {
      slug: override,
      customDomain: null,
      isAdminHost: override === ADMIN_SUBDOMAIN,
      isPlatformHost: override === null,
    };
  }

  if (host === root || host === `www.${root}`) {
    return { slug: null, customDomain: null, isAdminHost: false, isPlatformHost: true };
  }

  if (host.endsWith(`.${root}`)) {
    const label = host.slice(0, -(root.length + 1));
    // Only single-level subdomains map to partners (nbs.ledgr.com).
    const slug = label.includes('.') ? label.split('.').pop()! : label;
    if (slug === ADMIN_SUBDOMAIN) {
      return { slug: null, customDomain: null, isAdminHost: true, isPlatformHost: false };
    }
    if (RESERVED.has(slug)) {
      return { slug: null, customDomain: null, isAdminHost: false, isPlatformHost: true };
    }
    return { slug, customDomain: null, isAdminHost: false, isPlatformHost: false };
  }

  return { slug: null, customDomain: host, isAdminHost: false, isPlatformHost: false };
}

/**
 * In development there are no real subdomains, so allow:
 *   • nbs.localhost
 *   • ?partner=nbs  (persisted to localStorage so it survives navigation)
 */
function localDevOverride(host: string): string | null {
  if (typeof window === 'undefined') return null;

  const fromQuery = new URLSearchParams(window.location.search).get('partner');
  if (fromQuery !== null) {
    if (fromQuery === '') {
      window.localStorage.removeItem('ledgr-partner-override');
      return null;
    }
    window.localStorage.setItem('ledgr-partner-override', fromQuery);
    return fromQuery;
  }

  const stored = window.localStorage.getItem('ledgr-partner-override');
  if (stored) return stored;

  if (host.endsWith('.localhost')) {
    const label = host.slice(0, -'.localhost'.length);
    return RESERVED.has(label) && label !== ADMIN_SUBDOMAIN ? null : label;
  }
  return null;
}

/** True when the app is being served as the partner admin portal. */
export function isAdminPortalHost(hostname?: string): boolean {
  return resolveHost(hostname).isAdminHost;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
