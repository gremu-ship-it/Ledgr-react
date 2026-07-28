// Shared CORS origin allowlist for Ledgr Edge Functions.
//
// Previously every function hardcoded `Access-Control-Allow-Origin: '*'`.
// Impact was limited — these endpoints authenticate with a bearer token in the
// Authorization header rather than cookies, so a browser will not attach
// credentials automatically on a cross-origin request — but a wildcard still
// lets any origin read responses from a fetch the user's browser is tricked
// into making with a token the page already has, and it flatly contradicts the
// strict CSP shipped in vercel.json.
//
// Allowed origins come from ALLOWED_ORIGINS (comma-separated) falling back to
// APP_URL, which is already set for the payment return_url flow:
//
//   supabase secrets set ALLOWED_ORIGINS="https://app.ledgr.mw,https://ledgr-react.vercel.app"
//
// Behaviour notes:
//   * Vary: Origin is always sent so shared caches never serve one tenant's
//     allowed origin to another.
//   * If neither var is configured we fall back to '*' rather than breaking a
//     live deployment mid-rollout. Set ALLOWED_ORIGINS in production to get the
//     hardening; the fallback keeps this change non-breaking for anyone who
//     deploys the functions before setting the secret.
//   * localhost on any port is always allowed so `supabase functions serve`
//     and `vite dev` keep working.

const RAW_ALLOWED = Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('APP_URL') ?? '';

const ALLOWLIST = RAW_ALLOWED.split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type';

function isLocalhost(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

/** Resolve the Access-Control-Allow-Origin value for an incoming request. */
export function resolveOrigin(req: Request): string | null {
  const origin = req.headers.get('Origin');
  if (!origin) return null; // non-browser caller (cron, server-to-server)
  if (ALLOWLIST.length === 0) return '*'; // unconfigured: preserve old behaviour
  if (isLocalhost(origin)) return origin;
  return ALLOWLIST.includes(origin.replace(/\/+$/, '')) ? origin : null;
}

/**
 * CORS headers for a request. When the origin is not allowed, the
 * Access-Control-Allow-Origin header is omitted entirely, which makes the
 * browser block the response.
 */
export function corsHeaders(req: Request, methods = 'POST, OPTIONS'): Record<string, string> {
  const allowed = resolveOrigin(req);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Allow-Methods': methods,
    Vary: 'Origin',
  };
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
}

/** Standard preflight response. */
export function preflight(req: Request, methods = 'POST, OPTIONS'): Response {
  return new Response('ok', { headers: corsHeaders(req, methods) });
}

/**
 * Wraps a Deno.serve handler and enforces the origin allowlist on the way out.
 *
 * This is deliberately a wrapper rather than a rewrite of each function's
 * internal CORS_HEADERS constant: those constants are spread across dozens of
 * call sites per function, and rewriting them all by hand is far more likely to
 * introduce a bug than to fix one. The wrapper overrides
 * Access-Control-Allow-Origin on whatever response the handler produced, so the
 * existing `...CORS_HEADERS` spreads stay correct and the allowlist is applied
 * in exactly one place.
 *
 * Disallowed browser origins get the header stripped, so the browser blocks the
 * response even though the handler ran. Requests with no Origin header
 * (pg_cron, server-to-server, curl) are passed through untouched — CORS is a
 * browser mechanism and those callers are gated by their own auth.
 */
export function withCors(
  handler: (req: Request) => Response | Promise<Response>,
  methods = 'POST, OPTIONS',
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return preflight(req, methods);

    const res = await handler(req);
    const allowed = resolveOrigin(req);
    const headers = new Headers(res.headers);

    if (allowed) {
      headers.set('Access-Control-Allow-Origin', allowed);
    } else {
      headers.delete('Access-Control-Allow-Origin');
    }
    headers.set('Vary', 'Origin');

    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
