// Vercel serverless function — the uptime-monitoring target.
//
// Better Uptime (and any other monitor) pings  https://<domain>/api/health
// once a minute. Global security headers (CSP, HSTS, X-Frame-Options, ...) are
// applied to every response by vercel.json, so this endpoint is already
// hardened. A deeper dependency check (e.g. Supabase reachability) can be added
// here later; for uptime purposes a 200 with a timestamp is what we assert on.
//
// The VercelRequest/VercelResponse types are defined locally as structural
// interfaces instead of importing `@vercel/node`: that devDependency is the
// root of a large vulnerable transitive tree (tar, ajv, undici,
// path-to-regexp, ...), and this handler only needs a sliver of its surface.

interface VercelRequest {
  method?: string;
  url?: string;
  query: Record<string, string | string[]>;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface VercelResponse {
  setHeader(name: string, value: string): this;
  // Mirrors @vercel/node's VercelResponse: .status() and .json() both return
  // the response itself so calls chain (res.status(200).json(...)). Declared
  // on the interface — not as a nested object-literal type — because a `this`
  // type is only legal in class/interface members (TS2526).
  status(code: number): VercelResponse;
  json(body: unknown): this;
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
