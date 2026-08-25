const GATEWAY_ORIGIN = 'http://ledgr-gateway.invalid';
const API_PATH = /^\/api\/v1\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;

/**
 * Resolve a gateway request beneath the configured Edge Function base URL.
 * The caller controls only path/query; scheme, credentials and authority always
 * come from TARGET_URL. This preserves a target such as /functions/v1/api while
 * preventing protocol-relative URLs or backslash-based authority confusion.
 */
export function resolveProxyTarget(targetUrl: string, originalUrl: string): URL {
  const target = new URL(targetUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    throw new Error('TARGET_URL must be an HTTP(S) URL without embedded credentials.');
  }
  if (target.search || target.hash) {
    throw new Error('TARGET_URL must not include a query string or fragment.');
  }
  if (!originalUrl.startsWith('/api/v1/')) {
    throw new Error('Path is outside the /api/v1 gateway namespace.');
  }

  const incoming = new URL(originalUrl, GATEWAY_ORIGIN);
  if (incoming.origin !== GATEWAY_ORIGIN || !API_PATH.test(incoming.pathname)) {
    throw new Error('Path escapes the configured target.');
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(incoming.pathname);
  } catch {
    throw new Error('Path contains invalid percent encoding.');
  }
  if (decodedPath.includes('\\') || decodedPath.includes('\0')) {
    throw new Error('Path contains a forbidden separator.');
  }

  const basePath = target.pathname.replace(/\/+$/, '');
  const resolved = new URL(target.origin);
  resolved.pathname = `${basePath}${incoming.pathname}`;
  resolved.search = incoming.search;
  return resolved;
}
