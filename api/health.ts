// Vercel serverless function — the uptime-monitoring target.
//
// Better Uptime (and any other monitor) pings  https://<domain>/api/health
// once a minute. Global security headers (CSP, HSTS, X-Frame-Options, ...) are
// applied to every response by vercel.json, so this endpoint is already
// hardened. A deeper dependency check (e.g. Supabase reachability) can be added
// here later; for uptime purposes a 200 with a timestamp is what we assert on.

import type { VercelRequest, VercelResponse } from '@vercel/node';

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
