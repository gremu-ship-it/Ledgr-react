// Vercel serverless function — the uptime-monitoring target.
//
// Better Uptime (and any other monitor) pings  https://<domain>/api/health
// once a minute. Global security headers (CSP, HSTS, X-Frame-Options, ...) are
// applied to every response by vercel.json, so this endpoint is already
// hardened. A deeper dependency check (e.g. Supabase reachability) can be added
// here later; for uptime purposes a 200 with a timestamp is what we assert on.

// Types are declared locally rather than imported from '@vercel/node'. That
// package was a devDependency used for these two type imports only, but it
// pulls in @vercel/nft -> @mapbox/node-pre-gyp -> tar, which accounted for a
// critical and ~18 high advisories in `npm audit`. The runtime contract used
// here is a two-method subset of Node's ServerResponse that Vercel satisfies,
// so structural types cost nothing and drop the whole dependency tree.
interface VercelRequest {
  method?: string;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface VercelResponse {
  setHeader(name: string, value: string): void;
  status(code: number): VercelResponse;
  json(body: unknown): void;
}

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'ledgr-web',
    environment: process.env.VERCEL_ENV || 'unknown',
  });
}
