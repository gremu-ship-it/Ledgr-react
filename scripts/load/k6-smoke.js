// Ledgr — k6 smoke/load script (Phase 10.4).
//
// Run against STAGING only (never production):
//   k6 run -e BASE_URL=https://ledgr-react-prod.vercel.app scripts/load/k6-smoke.js
//
// This exercises the public API edge function (functions/v1/api) with an
// anonymous key. Set the env vars first:
//   VITE_SUPABASE_URL_STAGING  (https://<ref>.supabase.co)
//   VITE_SUPABASE_ANON_KEY_STAGING
//
// Notes:
//   * The anon key is a publishable value (it ships in the frontend bundle).
//   * The API rate limiter allows 10 req/min per IP for unauthenticated
//     callers — a load test will hit 429s quickly, which is itself a useful
//     observation (limiter works), but for throughput testing use an API key
//     (100 req/min) or run against a dedicated test project.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE_URL || 'https://ledgr-react-prod.vercel.app';
const SUPABASE_URL = __ENV.VITE_SUPABASE_URL_STAGING || '';
const ANON_KEY = __ENV.VITE_SUPABASE_ANON_KEY_STAGING || '';

export const options = {
  // Smoke: 1 VU for a few iterations — validates the path end-to-end.
  vus: 1,
  iterations: 5,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000'],
  },
};

export default function () {
  // Frontend availability probe.
  const home = http.get(`${BASE}/`, { tags: { name: 'frontend' } });
  check(home, { 'frontend 200': (r) => r.status === 200 });

  // Gateway health (if deployed).
  const health = http.get(`${BASE}/api/health`, { tags: { name: 'health' } });
  check(health, { 'health ok': (r) => r.status === 200 && r.json('status') === 'ok' });

  if (SUPABASE_URL && ANON_KEY) {
    // Public API: list currencies (public endpoint) — expect 200 or 429
    // (rate limit); anything else is a regression.
    const api = http.get(
      `${SUPABASE_URL}/functions/v1/api/api/v1/currencies`,
      { headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` } },
      { tags: { name: 'api' } },
    );
    check(api, {
      'api 200 or 429': (r) => r.status === 200 || r.status === 429,
    });
  }

  sleep(1);
}
