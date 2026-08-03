// supabase/functions/_shared/urlSafety.ts
//
// URL/IP safety helpers for outbound calls made by Edge Functions —
// the SSRF guard for user-configured webhook destinations, and the
// APP_URL normaliser for payment redirect links.
//
// Uses only Web-standard APIs, so it is unit-testable under Node/vitest
// (see _shared/__tests__/urlSafety.test.ts). `assertPublicWebhookDestination`
// stays in webhook-dispatcher because DNS resolution is a Deno-only API.

/**
 * True when `address` is a private, loopback, link-local, multicast,
 * reserved, or otherwise non-public IP (v4 or v6 literal).
 *
 * Coverage: RFC 1918 (10/8, 172.16/12, 192.168/16), loopback (127/8, ::1),
 * link-local (169.254/16, fe80::/10), CGNAT (100.64/10), documentation
 * ranges (192.0.2/24, 198.51.100/24 style — 192.0/24 block, 2001:db8::/32),
 * benchmarking (198.18/15), multicast/reserved (>=224), 6to4-relay and
 * IPv4-mapped IPv6 (::ffff:a.b.c.d), unique-local v6 (fc00::/7).
 */
export function isPrivateIp(address: string): boolean {
  const ip = address.toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((part) => part > 255)) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const normalized = ip.replace(/^\[|\]$/g, '');
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
    normalized.startsWith('fea') || normalized.startsWith('feb') || normalized.startsWith('2001:db8') ||
    (normalized.startsWith('::ffff:') && isPrivateIp(normalized.slice(7)));
}

/**
 * Parse the operator-configured APP_URL into a safe base for redirect links.
 *
 * Returns null when the value is missing or not an http(s) URL — callers must
 * treat null as "cannot redirect" and refuse rather than fall back to an
 * attacker-influenced URL. Be forgiving of operator paste errors: Markdown
 * link syntax `[label](https://…)`, extra prose around the URL, trailing
 * slashes.
 */
export function normalizeAppUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;

  // Be forgiving if APP_URL was accidentally pasted as Markdown, e.g.
  // [https://ledgr-react.vercel.app](https://ledgr-react.vercel.app).
  const markdownUrl = trimmed.match(/\((https?:\/\/[^)]+)\)/)?.[1];
  const plainUrl = markdownUrl ?? trimmed.match(/https?:\/\/[^\s\])]+/)?.[0] ?? trimmed;
  const withoutTrailingSlash = plainUrl.replace(/\/+$/, '');

  try {
    const url = new URL(withoutTrailingSlash);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return withoutTrailingSlash;
  } catch {
    return null;
  }
}
